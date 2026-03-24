/**
 * Server-side train state machine.
 *
 * Replaces the client-side initRealTrainAnimation() logic for everything that
 * requires persistent per-train state across polls:
 *   - track snapping with affinity
 *   - direction inference (nextStation → terminalWalk → heading cascade)
 *   - phantom-jump detection (known rules)
 *   - isSch=1 hold
 *   - backward / fast-forward / station-jump confirmation holds
 *
 * Exposes processTrains(rawCTATrains) which returns { trains, stats }.
 * When a train is held, the returned lon/lat/trackPos are the held (previous)
 * values — clients just animate to whatever the server says.
 */
'use strict';

const C = require('./shared-config');
const {
  geoDist,
  snapToTrackWithAffinity,
  snapToTrackPosition,
  advanceOnTrack,
  directionFromHeading,
  directionByNextStation,
  directionByTerminalWalk,
  findConnectedSegment,
  effectiveDestForDirection,
  findNextStation,
  matchesKnownPhantomJump,
  nearestStationWithinRadius,
  nearestStationName,
} = require('./track-engine');

// Per-train state persisted across polls.
// { rt, legend, heading, destNm, lon, lat,
//   trackPos, direction, effectiveDest,
//   backwardHoldCount, forwardHoldCount,
//   nearStation }
const trainStateMap = new Map();

// Trains that disappeared from the CTA API near a terminal.
// Broadcast until TERMINUS_HOLD_MS expires.
// { rn, rt, legend, heading, destNm, terminalPos, direction, effectiveDest, retireStartMs }
const retiringTrainsMap = new Map();

// Timestamp of the last processTrains call — used to detect VM suspension/wakeup.
let lastProcessMs = 0;

// If the gap between polls exceeds this threshold, treat all prior state as stale
// and clear it so trains snap cleanly to current positions instead of triggering
// mass snap_forward holds after a Fly.io machine wakeup.
const STALE_POLL_GAP_MS = 90_000; // 90s ≈ 3 missed poll intervals

/**
 * Process a batch of raw CTA trains against persistent state.
 *
 * @param {object[]} rawTrains   — combined array from fetchAllTrains()
 * @param {object}   geo         — geo-state module (lineSegments, lineNeighborMaps, stations)
 * @returns {{ trains: object[], stats: object }} processed train objects + poll summary stats
 */
function processTrains(rawTrains, geo) {
  const { lineSegments, lineOwnSegments, lineTerminals, lineNeighborMaps, stations } = geo;
  const now = Date.now();
  const m   = d => `${(d * 111000).toFixed(0)}m`;

  // Detect VM wakeup (e.g. Fly.io machine suspension/resume).
  // A gap larger than STALE_POLL_GAP_MS means the process was paused; stale positions
  // would cause every train to trigger snap_forward holds for the next ~2.5 minutes,
  // so clear state to let trains snap directly to their current positions.
  if (lastProcessMs > 0 && (now - lastProcessMs) > STALE_POLL_GAP_MS) {
    const gapSec = ((now - lastProcessMs) / 1000).toFixed(0);
    console.warn(`[CTA] Poll gap ${gapSec}s > ${STALE_POLL_GAP_MS / 1000}s — clearing stale train state to avoid mass snap holds`);
    trainStateMap.clear();
    retiringTrainsMap.clear();
  }
  lastProcessMs = now;

  // Track which rns appeared this poll — remove stale state for gone trains
  const seenRns = new Set();

  const processed = [];

  // Per-poll stats for structured log summary
  const stats = {
    total: 0,
    held: {},      // heldReason → count
    dirMethod: {}, // 'probe'|'walk'|'segment'|'heading'|'prev' → count
  };

  for (const raw of rawTrains) {
    const legend = C.ROUTE_TO_LEGEND[raw.rt];
    if (!legend) continue;

    const segs = lineSegments[legend];
    if (!segs || segs.length === 0) continue;

    seenRns.add(raw.rn);
    // If this train was retiring and just reappeared, remove it from retirement
    if (retiringTrainsMap.has(raw.rn)) retiringTrainsMap.delete(raw.rn);
    const prev = trainStateMap.get(raw.rn) || null;
    const neighborMap = lineNeighborMaps[legend] || null;

    const rawLon = parseFloat(raw.lon);
    const rawLat = parseFloat(raw.lat);
    const heading = parseInt(raw.heading, 10) || 0;

    // Build a working train object similar to what the client used to build
    const train = {
      rn:       raw.rn,
      rt:       raw.rt,
      legend,
      lon:      rawLon,
      lat:      rawLat,
      heading,
      destNm:   raw.destNm   || '',
      nextStaNm: raw.nextStaNm || '',
      isApp:    raw.isApp,
      isDly:    raw.isDly,
      isSch:    raw.isSch,
    };

    // --- 1. Snap to track ---
    const prevTrackPos = prev ? prev.trackPos : null;
    train._trackPos = snapToTrackWithAffinity(rawLon, rawLat, segs, prevTrackPos, neighborMap);
    train.lon = train._trackPos.lon;
    train.lat = train._trackPos.lat;

    // --- 2. Effective destination (loop signage detection) ---
    const northDest    = C.LINE_NORTH_DESTS[legend];
    const effectiveDest = effectiveDestForDirection(train, northDest, stations);
    train._effectiveDest = effectiveDest;

    // --- 3. Direction cascade ---
    let direction = prev ? prev.direction : null;
    let dirMethod = 'prev'; // track which inference path was used

    if (prev && prev.direction !== undefined) {
      const segChanged  = prev.trackPos && train._trackPos.segIdx !== prev.trackPos.segIdx;
      const destChanged = prev.effectiveDest && effectiveDest !== prev.effectiveDest;

      const nextStn = findNextStation(train, stations);
      let nextStnDir = nextStn
        ? directionByNextStation(train._trackPos, nextStn, segs, neighborMap)
        : null;
      const rawNextStnDir = nextStnDir;
      // Stale-nextStaNm guard — skip on ML segments where the next-station probe
      // is the most reliable direction source (terminal walk always fails on ML
      // because the Loop has no dead ends, so we can't afford to discard the probe).
      const _isOnML = segs[train._trackPos.segIdx]?._isML;
      if (!_isOnML && nextStnDir !== null && nextStnDir !== prev.direction && nextStn) {
        const distToNext = geoDist(train._trackPos.lon, train._trackPos.lat, nextStn.lon, nextStn.lat);
        if (distToNext < 0.003) {
          // Very close to next station — likely stale (train just passed it)
          nextStnDir = null;
        } else if (northDest && effectiveDest) {
          // Cross-validate: if terminal walk agrees with prev.direction (not the
          // probe), the nextStaNm is stale — the train isn't actually heading toward
          // that station.  This catches cases where the CTA API reports a station
          // the train already passed (e.g. Wilson when the train is south of it
          // heading toward 95th/Dan Ryan).
          const termCheck = directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap, stations);
          if (termCheck !== null && termCheck === prev.direction && termCheck !== nextStnDir) {
            console.log(`[CTA] Stale nextStn guard: rn=${train.rn} (${legend}) probe=${nextStnDir} but termWalk=${termCheck} agrees with prev=${prev.direction} — discarding probe (nextStaNm="${train.nextStaNm}", dist=${distToNext.toFixed(4)})`);
            nextStnDir = null;
          }
        }
      }

      // probeMismatch: probe disagrees with stored direction — trigger re-evaluation on any line.
      // loopLineMismatch keeps the narrower check used by the onlyLoopMismatch guard below
      // (loop lines need extra caution because ML junctions can mislead the probe).
      const probeMismatch    = rawNextStnDir !== null && rawNextStnDir !== prev.direction;
      const loopLineMismatch = C.LOOP_LINE_CODES.includes(legend) && probeMismatch;

      // For loop lines (BR, OR, PK, PR, GR) on non-ML segments, validate
      // prev.direction against directionByTerminalWalk every poll.  These lines
      // have unambiguous dead-end terminals so termWalk is reliable; no branch
      // junction can mislead it the way O'Hare/Forest Park misleads Blue.
      // This catches trains whose direction was set wrong when nextStaNm was
      // absent (so probeMismatch never fired) and never got corrected.
      //
      // Non-loop lines (RD, BL) are excluded: their terminals have branch
      // junctions where termWalk may reach the wrong dead-end and flip a
      // correctly-directed train.  Those lines rely on probe + cascade triggers.
      const isLoopLineCode = C.LOOP_LINE_CODES.includes(legend);
      if (isLoopLineCode && !_isOnML && northDest && effectiveDest && prev.direction !== null) {
        const termCheck = directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap, stations);
        if (termCheck !== null && termCheck !== prev.direction) {
          console.log(`[CTA] Loop-line direction correction: rn=${train.rn} (${legend}→${train.destNm || '?'}) prev=${prev.direction} termWalk=${termCheck} — overriding`);
          direction = termCheck;
          dirMethod = 'walk';
        }
      }

      // On ML segments with only a probe mismatch (no segment or destination change),
      // terminal walk is unavailable (Loop has no dead ends) and the CTA API's stale
      // nextStaNm frequently points to a loop station the train already passed, causing
      // the probe to return the wrong direction.  Direction is reliably established when
      // entering ML (segChanged) and should be preserved rather than overridden by a
      // single potentially-stale probe result.
      const mlOnlyMismatch = _isOnML && loopLineMismatch && !segChanged && !destChanged;
      if (mlOnlyMismatch) {
        console.log(`[CTA] ML stale-probe guard: rn=${train.rn} (${legend}→${train.destNm || '?'}) probe=${rawNextStnDir} vs prev=${prev.direction} on ML — keeping prev (nextStaNm="${train.nextStaNm}")`);
      }

      if (!mlOnlyMismatch && (segChanged || destChanged || probeMismatch) && northDest && effectiveDest) {
        const onlyLoopMismatch = loopLineMismatch && !segChanged && !destChanged;
        if (nextStnDir !== null && !onlyLoopMismatch) {
          direction = nextStnDir;
          dirMethod = 'probe';
        } else if (segChanged && !destChanged && nextStn
            && geoDist(train._trackPos.lon, train._trackPos.lat, nextStn.lon, nextStn.lat) < 0.001) {
          const isLoopLine = C.LOOP_LINE_CODES.includes(legend);
          const verifyDir = (isLoopLine && northDest && effectiveDest)
            ? directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap, stations)
            : null;
          direction = verifyDir !== null ? verifyDir : (rawNextStnDir ?? prev.direction);
          dirMethod = verifyDir !== null ? 'walk' : (rawNextStnDir !== null ? 'probe' : 'prev');
        } else {
          const termDir = directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap, stations);
          if (termDir !== null) {
            direction = termDir;
            dirMethod = 'walk';
          } else if (nextStnDir !== null || (probeMismatch && rawNextStnDir !== null)) {
            direction = nextStnDir ?? rawNextStnDir;
            dirMethod = 'probe';
          } else if (segChanged) {
            const prevSeg = segs[prev.trackPos.segIdx];
            // Try both segment ends — prev.direction may have been wrong, so check the
            // end that prev.direction predicts first, then the opposite end as a fallback.
            const boundaryPri = prev.direction > 0 ? prevSeg.length - 1 : 0;
            const boundaryAlt = prev.direction > 0 ? 0 : prevSeg.length - 1;
            const connPri = findConnectedSegment(
              prev.trackPos.segIdx, boundaryPri, prevSeg, prev.direction, segs, undefined, undefined, neighborMap
            );
            const connAlt = connPri?.segIdx !== train._trackPos.segIdx
              ? findConnectedSegment(
                  prev.trackPos.segIdx, boundaryAlt, prevSeg, -prev.direction, segs, undefined, undefined, neighborMap
                )
              : null;
            const connected = connPri?.segIdx === train._trackPos.segIdx ? connPri
              : connAlt?.segIdx === train._trackPos.segIdx ? connAlt
              : null;
            if (connected) {
              direction = connected.direction;
              dirMethod = 'segment';
            } else {
              direction = directionFromHeading(heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs);
              dirMethod = 'heading';
            }
          } else {
            direction = prev.direction;
            // dirMethod stays 'prev'
          }
        }
      } else {
        direction = prev.direction;
        // dirMethod stays 'prev'
      }
    } else if (northDest && effectiveDest) {
      // New train — cross-validate probe against terminal walk
      const nextStn = findNextStation(train, stations);
      let nextStnDir = nextStn
        ? directionByNextStation(train._trackPos, nextStn, segs, neighborMap)
        : null;
      const termDir = directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap, stations);
      // If probe and terminal walk disagree, trust the terminal walk — it uses
      // the non-stale destNm rather than the potentially-stale nextStaNm.
      if (nextStnDir !== null && termDir !== null && nextStnDir !== termDir) {
        const _isOnML = segs[train._trackPos.segIdx]?._isML;
        if (!_isOnML) {
          console.log(`[CTA] New train stale guard: rn=${train.rn} (${legend}) probe=${nextStnDir} vs termWalk=${termDir} — using termWalk (nextStaNm="${train.nextStaNm}")`);
          nextStnDir = null;
        }
      }
      if (nextStnDir !== null) {
        direction = nextStnDir;
        dirMethod = 'probe';
      } else if (termDir !== null) {
        direction = termDir;
        dirMethod = 'walk';
      } else {
        direction = directionFromHeading(heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs);
        dirMethod = 'heading';
      }
    } else {
      direction = directionFromHeading(heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs);
      dirMethod = 'heading';
    }

    train._direction = direction;
    train._dirMethod = dirMethod;

    // --- 4 & 5. Phantom + isSch hold logic (requires prev position) ---
    let held = false;
    let heldReason = null;
    let holdCount = 0;
    let holdMax = 0;

    if (prev) {
      const prevLon = prev.trackPos ? prev.trackPos.lon : rawLon;
      const prevLat = prev.trackPos ? prev.trackPos.lat : rawLat;
      const drift   = geoDist(prevLon, prevLat, train.lon, train.lat);

      // Station names for logs
      let _stnTagCache = null;
      const stnTag = () => {
        if (_stnTagCache === null) {
          const from = nearestStationName(prevLon, prevLat, stations, legend);
          const to   = nearestStationName(train.lon, train.lat, stations, legend);
          _stnTagCache = (from && to && from !== to) ? ` [${from} → ${to}]` : (from ? ` [near ${from}]` : '');
        }
        return _stnTagCache;
      };

      if (drift > 1e-7) {
        // Known phantom jump
        const phantomRule = matchesKnownPhantomJump(legend, prevLon, prevLat, train.lon, train.lat, stations);
        if (phantomRule) {
          held = true;
          heldReason = 'phantom';
          console.warn(`[CTA] Phantom blocked: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} — ${phantomRule.description}`);
        }

        // isSch=1 hold
        if (!held && train.isSch === '1' && prev.trackPos) {
          held = true;
          heldReason = 'isch';
          // No per-train log — counted in poll summary
        }

        if (!held) {
          if (drift < C.CORRECTION_SNAP_THRESHOLD) {
            // Smooth correction range — apply backward/forward/station-jump holds
            const toPos = train._trackPos;
            const testStep = Math.max(drift * 0.1, 1e-5);
            const fwdTest = advanceOnTrack(prev.trackPos, testStep, +1, segs);
            const bwdTest = advanceOnTrack(prev.trackPos, testStep, -1, segs);
            const fwdD = geoDist(fwdTest.lon, fwdTest.lat, toPos.lon, toPos.lat);
            const bwdD = geoDist(bwdTest.lon, bwdTest.lat, toPos.lon, toPos.lat);
            const corrDir = Math.abs(fwdD - bwdD) < testStep * 0.5
              ? (prev.direction ?? direction)
              : (fwdD <= bwdD ? 1 : -1);

            // Classify backward vs forward.
            //
            // Determine the "expected" direction to compare against empirical drift:
            //
            // - If direction was just corrected by an authoritative source (walk-override
            //   or walk), use the corrected direction.  These methods use destNm which is
            //   non-stale and definitive for non-loop lines.  Using prev.direction here
            //   would cause the backward hold to fight the correction, since prev.direction
            //   is the value we're trying to fix.
            //
            // - On ML (Loop) segments, use `direction` (Step-3 output).  Step 3 correctly
            //   handles Loop polarity flips when segments change.
            //
            // - Otherwise, use prev.direction (the established travel direction).  It's
            //   immune to API glitches where both position and nextStaNm jump together.
            //   The 6-poll confirmation handles genuine terminus reversals.
            const _isOnMLForHold = segs[train._trackPos.segIdx]?._isML;
            const _useStepDir = _isOnMLForHold || dirMethod === 'walk';
            const _nextStnForHold = findNextStation(train, stations);
            const _nextStnDir = _nextStnForHold
              ? directionByNextStation(prev.trackPos, _nextStnForHold, segs, neighborMap)
              : null;
            const _headingDirFromPos = (_useStepDir ? direction : prev.direction)
              ?? _nextStnDir
              ?? directionFromHeading(heading, prev.trackPos.segIdx, prev.trackPos.ptIdx, segs)
              ?? direction;

            const isSuspectBackward = _headingDirFromPos !== corrDir;
            const isSuspectForward  = !isSuspectBackward && drift > C.FORWARD_PLAUSIBLE_DIST;

            if (isSuspectBackward && drift < 0.00018) {
              // Micro-drift backward — silently ignore
              held = true;
              heldReason = 'microdrift';
            } else if (isSuspectBackward) {
              const newCount = (prev.backwardHoldCount || 0) + 1;
              if (newCount < C.BACKWARD_CONFIRM_POLLS) {
                held = true;
                heldReason = 'backward';
                holdCount = newCount;
                holdMax   = C.BACKWARD_CONFIRM_POLLS;
                // Log only when hold first starts
                if (newCount === 1) {
                  console.log(`[CTA] Backward hold: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()}`);
                }
              } else {
                // Confirmed — snap (not held); update direction if heading agrees
                const headingDir = directionFromHeading(heading, toPos.segIdx, toPos.ptIdx, segs);
                if (headingDir === corrDir || newCount >= 5 * C.BACKWARD_CONFIRM_POLLS) {
                  train._direction = corrDir;
                  direction = corrDir;
                }
                console.log(`[CTA] Backward confirmed (snap): rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} after ${newCount} polls`);
              }
              // Store updated count in nextState (set below)
              train._backwardHoldCount = newCount;
            } else if (isSuspectForward) {
              const newCount = (prev.forwardHoldCount || 0) + 1;
              if (newCount < C.FORWARD_CONFIRM_POLLS) {
                held = true;
                heldReason = 'fast_forward';
                holdCount = newCount;
                holdMax   = C.FORWARD_CONFIRM_POLLS;
                // Log only when hold first starts
                if (newCount === 1) {
                  console.log(`[CTA] Fast-forward hold: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()}`);
                }
              } else {
                console.log(`[CTA] Fast-forward confirmed: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} after ${newCount} polls`);
              }
              train._forwardHoldCount = newCount;
            }
          } else {
            // Snap range (> CORRECTION_SNAP_THRESHOLD) — apply snap hold
            if (prev.trackPos) {
              const snapDir = directionFromHeading(heading, prev.trackPos.segIdx, prev.trackPos.ptIdx, segs);
              // Compare against prev.direction (the stable held direction) rather than the
              // freshly-derived direction from the far-ahead position, which can flip each
              // poll if the new snapped position is in a curved/ambiguous segment.
              const isSuspectSnap = snapDir !== (prev.direction ?? direction);
              const countKey = isSuspectSnap ? 'backwardHoldCount' : 'forwardHoldCount';
              const confirmPolls = isSuspectSnap ? C.BACKWARD_CONFIRM_POLLS : C.FORWARD_SNAP_CONFIRM_POLLS;
              const newCount = (prev[countKey] || 0) + 1;
              if (newCount < confirmPolls) {
                held = true;
                heldReason = isSuspectSnap ? 'snap_backward' : 'snap_forward';
                holdCount = newCount;
                holdMax   = confirmPolls;
                if (newCount === 1) {
                  console.log(`[CTA] Snap hold: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()}`);
                }
              } else {
                // Re-derive direction at snapped position: probe → walk → heading
                const _snapNextStn = findNextStation(train, stations);
                const snapProbeDir = _snapNextStn
                  ? directionByNextStation(train._trackPos, _snapNextStn, segs, neighborMap)
                  : null;
                const snapTermDir = (northDest && effectiveDest)
                  ? directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap, stations)
                  : null;
                train._direction = snapProbeDir ?? snapTermDir ?? directionFromHeading(heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs);
                direction = train._direction;
                console.warn(`[CTA] Snap confirmed: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} after ${newCount} polls`);
              }
              if (isSuspectSnap) train._backwardHoldCount = newCount;
              else               train._forwardHoldCount  = newCount;
            } else {
              // No prior position — probe → walk → heading
              const _npNextStn = findNextStation(train, stations);
              const npProbeDir = _npNextStn
                ? directionByNextStation(train._trackPos, _npNextStn, segs, neighborMap)
                : null;
              const npTermDir = (northDest && effectiveDest)
                ? directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap, stations)
                : null;
              train._direction = npProbeDir ?? npTermDir ?? directionFromHeading(heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs);
              direction = train._direction;
              console.warn(`[CTA] Snap: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} — no prior position`);
            }
          }
        }
      }
    }

    // When held, revert position to previous. Preserve direction only if it was
    // authoritatively corrected via terminal walk this poll (dirMethod === 'walk').
    if (held && prev && prev.trackPos) {
      train._trackPos  = { ...prev.trackPos };
      train.lon        = prev.trackPos.lon;
      train.lat        = prev.trackPos.lat;
      if (dirMethod !== 'walk') {
        train._direction = prev.direction;
        direction        = prev.direction;
      }
    }

    // --- 6. Update per-train state for next poll ---
    const nextNearStation = nearestStationWithinRadius(
      train.lon, train.lat, stations, legend, C.STATION_JUMP_RADIUS
    );

    trainStateMap.set(train.rn, {
      rt:                  train.rt,
      legend,
      heading,
      destNm:              train.destNm,
      lon:                 train.lon,
      lat:                 train.lat,
      trackPos:            train._trackPos,
      direction:           direction,
      effectiveDest:       effectiveDest,
      backwardHoldCount:   held && (heldReason === 'backward'     || heldReason === 'snap_backward') ? (train._backwardHoldCount || 0) : (held ? (prev?.backwardHoldCount || 0) : 0),
      forwardHoldCount:    held && (heldReason === 'fast_forward' || heldReason === 'snap_forward')  ? (train._forwardHoldCount  || 0) : (held ? (prev?.forwardHoldCount  || 0) : 0),
      nearStation:         nextNearStation,
      dirMethod,
    });

    // --- 7. Emit processed object ---
    processed.push({
      rn:           train.rn,
      rt:           train.rt,
      legend,
      lat:          train.lat,
      lon:          train.lon,
      heading,
      destNm:       train.destNm,
      nextStaNm:    train.nextStaNm,
      isApp:        train.isApp,
      isDly:        train.isDly,
      isSch:        train.isSch,
      trackPos:     train._trackPos,
      direction:    direction,
      effectiveDest: train._effectiveDest,
      held,
      heldReason,
      holdCount,
      holdMax,
      directionMethod: dirMethod,
    });

    // --- 8. Accumulate stats ---
    stats.total++;
    if (held && heldReason) stats.held[heldReason] = (stats.held[heldReason] || 0) + 1;
    stats.dirMethod[dirMethod] = (stats.dirMethod[dirMethod] || 0) + 1;
  }

  // Prune state for trains that have disappeared from the API response.
  // If they vanished near a terminal, track them as retiring.
  for (const rn of trainStateMap.keys()) {
    if (seenRns.has(rn)) continue;
    if (!retiringTrainsMap.has(rn)) {
      const prev = trainStateMap.get(rn);
      const terminals = (lineTerminals && lineTerminals[prev.legend]) || [];
      for (const term of terminals) {
        const d = geoDist(prev.lon, prev.lat, term.lon, term.lat);
        if (d < C.TERMINAL_PROXIMITY_THRESHOLD) {
          retiringTrainsMap.set(rn, {
            rn,
            rt:            prev.rt,
            legend:        prev.legend,
            heading:       prev.heading,
            destNm:        prev.destNm,
            terminalPos:   term,
            direction:     prev.direction,
            effectiveDest: prev.effectiveDest,
            retireStartMs: now,
          });
          break;
        }
      }
    }
    trainStateMap.delete(rn);
  }

  // Expire retiring trains whose hold period has elapsed.
  for (const [rn, r] of retiringTrainsMap) {
    if (now - r.retireStartMs >= C.TERMINUS_HOLD_MS) retiringTrainsMap.delete(rn);
  }

  // Append retiring trains to the broadcast — client places them at terminal.
  for (const r of retiringTrainsMap.values()) {
    processed.push({
      rn:           r.rn,
      rt:           r.rt,
      legend:       r.legend,
      lat:          r.terminalPos.lat,
      lon:          r.terminalPos.lon,
      heading:      r.heading,
      destNm:       r.destNm,
      nextStaNm:    '',
      isApp:        false,
      isDly:        false,
      isSch:        false,
      trackPos:     r.terminalPos,
      direction:    r.direction,
      effectiveDest: r.effectiveDest,
      held:         false,
      heldReason:   null,
      holdCount:    0,
      holdMax:      0,
      directionMethod: 'prev',
      retiring:     true,
      retireElapsedMs: now - r.retireStartMs,
    });
  }

  return { trains: processed, stats };
}

/** For diagnostics / testing: expose the state map size. */
function stateSize() { return trainStateMap.size; }

/** Returns a serializable snapshot of all current per-train state for /api/debug/trains. */
function getDebugState() {
  return {
    trains: [...trainStateMap.entries()].map(([rn, s]) => ({ rn, ...s })),
    retiring: [...retiringTrainsMap.entries()].map(([rn, r]) => ({ rn, ...r })),
    counts: { active: trainStateMap.size, retiring: retiringTrainsMap.size },
  };
}

module.exports = { processTrains, stateSize, getDebugState };
