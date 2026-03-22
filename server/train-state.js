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
 * Exposes processTrains(rawCTATrains) which returns a processed array suitable
 * for broadcasting over SSE.  When a train is held, the returned lon/lat/trackPos
 * are the held (previous) values — clients just animate to whatever the server says.
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
// { trackPos, direction, effectiveDest,
//   backwardHoldCount, forwardHoldCount, stationJumpHoldCount,
//   nearStation }
const trainStateMap = new Map();

/**
 * Process a batch of raw CTA trains against persistent state.
 *
 * @param {object[]} rawTrains   — combined array from fetchAllTrains()
 * @param {object}   geo         — geo-state module (lineSegments, lineNeighborMaps, stations)
 * @returns {object[]} processed train objects ready for SSE broadcast
 */
function processTrains(rawTrains, geo) {
  const { lineSegments, lineNeighborMaps, stations } = geo;
  const now = Date.now();
  const m   = d => `${(d * 111000).toFixed(0)}m`;

  // Track which rns appeared this poll — remove stale state for gone trains
  const seenRns = new Set();

  const processed = [];

  for (const raw of rawTrains) {
    const legend = C.ROUTE_TO_LEGEND[raw.rt];
    if (!legend) continue;

    const segs = lineSegments[legend];
    if (!segs || segs.length === 0) continue;

    seenRns.add(raw.rn);
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

    if (prev && prev.direction !== undefined) {
      const segChanged  = prev.trackPos && train._trackPos.segIdx !== prev.trackPos.segIdx;
      const destChanged = prev.effectiveDest && effectiveDest !== prev.effectiveDest;

      const nextStn = findNextStation(train, stations);
      let nextStnDir = nextStn
        ? directionByNextStation(train._trackPos, nextStn, segs, neighborMap)
        : null;
      const rawNextStnDir = nextStnDir;
      // Stale-nextStaNm guard
      if (nextStnDir !== null && nextStnDir !== prev.direction && nextStn
          && geoDist(train._trackPos.lon, train._trackPos.lat, nextStn.lon, nextStn.lat) < 0.003) {
        nextStnDir = null;
      }

      const loopLineMismatch = C.LOOP_LINE_CODES.includes(legend)
        && rawNextStnDir !== null && rawNextStnDir !== prev.direction;

      if ((segChanged || destChanged || loopLineMismatch) && northDest && effectiveDest) {
        const onlyLoopMismatch = loopLineMismatch && !segChanged && !destChanged;
        if (nextStnDir !== null && !onlyLoopMismatch) {
          direction = nextStnDir;
        } else if (segChanged && !destChanged && nextStn
            && geoDist(train._trackPos.lon, train._trackPos.lat, nextStn.lon, nextStn.lat) < 0.001) {
          const isLoopLine = C.LOOP_LINE_CODES.includes(legend);
          const verifyDir = (isLoopLine && northDest && effectiveDest)
            ? directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap)
            : null;
          direction = verifyDir !== null ? verifyDir : prev.direction;
        } else {
          const termDir = directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap);
          if (termDir !== null) {
            direction = termDir;
          } else if (nextStnDir !== null || (loopLineMismatch && rawNextStnDir !== null)) {
            direction = nextStnDir ?? rawNextStnDir;
          } else if (segChanged) {
            const prevSeg = segs[prev.trackPos.segIdx];
            const boundary = prev.direction > 0 ? prevSeg.length - 1 : 0;
            const connected = findConnectedSegment(
              prev.trackPos.segIdx, boundary, prevSeg, prev.direction, segs, undefined, undefined, neighborMap
            );
            if (connected && connected.segIdx === train._trackPos.segIdx) {
              direction = connected.direction;
            } else {
              direction = directionFromHeading(heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs);
            }
          } else {
            direction = prev.direction;
          }
        }
      } else {
        direction = prev.direction;
      }
    } else if (northDest && effectiveDest) {
      // New train
      const nextStn = findNextStation(train, stations);
      const nextStnDir = nextStn
        ? directionByNextStation(train._trackPos, nextStn, segs, neighborMap)
        : null;
      if (nextStnDir !== null) {
        direction = nextStnDir;
      } else {
        const termDir = directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap);
        direction = termDir ?? directionFromHeading(heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs);
      }
    } else {
      direction = directionFromHeading(heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs);
    }

    train._direction = direction;

    // --- 4 & 5. Phantom + isSch hold logic (requires prev position) ---
    let held = false;
    let heldReason = null;

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
          console.warn(`[CTA] isSch hold: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()}`);
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
              ? direction
              : (fwdD <= bwdD ? 1 : -1);

            // Classify backward vs forward
            const _headingDirFromPos = (northDest && effectiveDest)
              ? (directionByTerminalWalk(prev.trackPos, effectiveDest, northDest, segs, neighborMap)
                ?? directionFromHeading(heading, prev.trackPos.segIdx, prev.trackPos.ptIdx, segs)
                ?? direction)
              : direction;

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
                console.log(`[CTA] Backward hold: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} [${newCount}/${C.BACKWARD_CONFIRM_POLLS}]`);
                // persist incremented count below via nextState
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
                console.log(`[CTA] Fast-forward hold: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} [${newCount}/${C.FORWARD_CONFIRM_POLLS}]`);
              } else {
                console.log(`[CTA] Fast-forward confirmed: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} after ${newCount} polls`);
              }
              train._forwardHoldCount = newCount;
            } else {
              // Station-jump detection
              if (prev.nearStation && stations) {
                const newNearStation = nearestStationWithinRadius(
                  train.lon, train.lat, stations, legend, C.STATION_JUMP_RADIUS
                );
                if (newNearStation && newNearStation !== prev.nearStation && drift >= C.STATION_JUMP_MIN_DRIFT) {
                  const newCount = (prev.stationJumpHoldCount || 0) + 1;
                  if (newCount < C.STATION_JUMP_CONFIRM_POLLS) {
                    held = true;
                    heldReason = 'station_jump';
                    console.log(`[CTA] Station-jump hold: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} [${newCount}/${C.STATION_JUMP_CONFIRM_POLLS}]`);
                  } else {
                    console.log(`[CTA] Station-jump confirmed: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} after ${newCount} polls`);
                  }
                  train._stationJumpHoldCount = newCount;
                }
              }
            }
          } else {
            // Snap range (> CORRECTION_SNAP_THRESHOLD) — apply snap hold
            if (prev.trackPos) {
              const snapDir = directionFromHeading(heading, prev.trackPos.segIdx, prev.trackPos.ptIdx, segs);
              const isSuspectSnap = snapDir !== direction;
              const countKey = isSuspectSnap ? 'backwardHoldCount' : 'forwardHoldCount';
              const confirmPolls = isSuspectSnap ? C.BACKWARD_CONFIRM_POLLS : C.FORWARD_SNAP_CONFIRM_POLLS;
              const newCount = (prev[countKey] || 0) + 1;
              if (newCount < confirmPolls) {
                held = true;
                heldReason = isSuspectSnap ? 'snap_backward' : 'snap_forward';
                console.log(`[CTA] Snap hold: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} [${newCount}/${confirmPolls}]`);
              } else {
                // Re-derive direction at snapped position
                const snapTermDir = (northDest && effectiveDest)
                  ? directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap)
                  : null;
                train._direction = snapTermDir ?? directionFromHeading(heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs);
                direction = train._direction;
                console.warn(`[CTA] Snap confirmed: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} after ${newCount} polls`);
              }
              if (isSuspectSnap) train._backwardHoldCount = newCount;
              else               train._forwardHoldCount  = newCount;
            } else {
              const npTermDir = (northDest && effectiveDest)
                ? directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs, neighborMap)
                : null;
              train._direction = npTermDir ?? directionFromHeading(heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs);
              direction = train._direction;
              console.warn(`[CTA] Snap: rn=${train.rn} (${legend}→${train.destNm || '?'}) ${m(drift)}${stnTag()} — no prior position`);
            }
          }
        }
      }
    }

    // When held, revert position to previous
    if (held && prev && prev.trackPos) {
      train._trackPos  = { ...prev.trackPos };
      train.lon        = prev.trackPos.lon;
      train.lat        = prev.trackPos.lat;
      train._direction = prev.direction;
      direction        = prev.direction;
    }

    // --- 6. Update per-train state for next poll ---
    const nextNearStation = nearestStationWithinRadius(
      train.lon, train.lat, stations, legend, C.STATION_JUMP_RADIUS
    );

    trainStateMap.set(train.rn, {
      trackPos:            train._trackPos,
      direction:           direction,
      effectiveDest:       effectiveDest,
      backwardHoldCount:   held && (heldReason === 'backward'     || heldReason === 'snap_backward') ? (train._backwardHoldCount || 0) : (held ? (prev?.backwardHoldCount || 0) : 0),
      forwardHoldCount:    held && (heldReason === 'fast_forward' || heldReason === 'snap_forward')  ? (train._forwardHoldCount  || 0) : (held ? (prev?.forwardHoldCount  || 0) : 0),
      stationJumpHoldCount: held && heldReason === 'station_jump' ? (train._stationJumpHoldCount || 0) : (held ? (prev?.stationJumpHoldCount || 0) : 0),
      nearStation:         nextNearStation,
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
    });
  }

  // Prune state for trains that have disappeared from the API response
  for (const rn of trainStateMap.keys()) {
    if (!seenRns.has(rn)) trainStateMap.delete(rn);
  }

  return processed;
}

/** For diagnostics / testing: expose the state map size. */
function stateSize() { return trainStateMap.size; }

module.exports = { processTrains, stateSize };
