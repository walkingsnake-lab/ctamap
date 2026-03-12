/**
 * Finds the nearest station name for a given position and optional legend filter.
 * Returns the station name string, or null if no station is within reasonable range.
 */
function nearestStationName(lon, lat, stations, legend) {
  let bestName = null;
  let bestDist = Infinity;
  for (const s of stations) {
    if (legend && !s.legends.includes(legend)) continue;
    const d = geoDist(lon, lat, s.lon, s.lat);
    if (d < bestDist) { bestDist = d; bestName = s.name; }
  }
  return bestName;
}

/**
 * Returns the name of the nearest station within `radius` degrees, or null.
 */
function nearestStationWithinRadius(lon, lat, stations, legend, radius) {
  let bestName = null, bestDist = Infinity;
  for (const s of stations) {
    if (legend && !s.legends.includes(legend)) continue;
    const d = geoDist(lon, lat, s.lon, s.lat);
    if (d < bestDist) { bestDist = d; bestName = s.name; }
  }
  return bestDist < radius ? bestName : null;
}

/**
 * Checks whether a position update matches a known phantom jump pattern.
 * Returns the matching rule, or null.
 */
function matchesKnownPhantomJump(legend, prevLon, prevLat, newLon, newLat, stations) {
  for (const rule of KNOWN_PHANTOM_JUMPS) {
    if (rule.legend !== legend) continue;
    const prevStation = nearestStationName(prevLon, prevLat, stations, legend);
    const newStation  = nearestStationName(newLon, newLat, stations, legend);
    if (!prevStation || !newStation) continue;
    // Check if nearest stations match any from→to combination in the rule,
    // and also verify the train is actually close to those stations (not just
    // "nearest" from 5km away).
    const fromMatch = rule.fromStations.some(s => prevStation === s) &&
      stations.some(s => s.name === prevStation && geoDist(prevLon, prevLat, s.lon, s.lat) < PHANTOM_STATION_RADIUS);
    const toMatch = rule.toStations.some(s => newStation === s) &&
      stations.some(s => s.name === newStation && geoDist(newLon, newLat, s.lon, s.lat) < PHANTOM_STATION_RADIUS);
    if (fromMatch && toMatch) return rule;
  }
  return null;
}

// Per-line destination substring that identifies the "northern" (higher-latitude)
// terminus.  Used by directionByTerminalWalk to convert a destination name into a
// segment-relative direction:  walk to both dead-ends, compare latitudes, and check
// whether the destination matches the northern one.
//
// Every line is listed here so that direction re-derivation on segment change,
// suspect-backward classification, and path-validation fallbacks all use the same
// unified config.  Previously this was split across two special-case configs
// (UNRELIABLE_HEADING_LINES for BL/YL, LOOP_EXIT_DIRECTION_LINES for OR); those
// are no longer needed because the terminal-walk-then-heading-fallback approach is
// now applied to ALL lines on every segment change.
const LINE_NORTH_DESTS = {
  RD: 'Howard',
  BL: 'O\'Hare',
  BR: 'Kimball',
  GR: 'Harlem',
  OR: 'Loop',
  PK: 'Loop',
  PR: 'Linden',
  YL: 'Skokie',
};

/**
 * Determines train direction by walking to both terminal dead-ends from trackPos
 * and comparing terminal latitudes against the destination name.
 * Returns +1 or -1, or null if neither terminal can be reached.
 *
 * For loop lines (PR, OR, PK, BR, GR), walking toward the downtown Loop enters
 * ML segments that circle back on themselves, hitting MAX_ITER without stopping.
 * When only ONE direction reaches a dead-end, we compare that terminal's latitude
 * to the current position to determine which way is "north."
 */
/**
 * Determines direction by probing toward the next station.
 * Walks a short distance in both directions from trackPos and returns whichever
 * direction gets closer to nextStn.  More reliable than terminal walk on the
 * ML loop, where latitude-based heuristics fail because the loop exit can be
 * in the opposite direction from the terminal.
 *
 * Returns +1 or -1, or null if ambiguous (e.g. train is at the station).
 */
function directionByNextStation(trackPos, nextStn, segs) {
  const PROBE_DIST = 0.015; // ~1.5km — long enough to reach around corners of the ML loop
  const curDist = geoDist(trackPos.lon, trackPos.lat, nextStn.lon, nextStn.lat);
  // When close to the station, scale the probe down so it stays short of the
  // station.  A probe that overshoots makes fwdDist > curDist in both
  // directions, causing a spurious null return.  0.9 keeps the probe at most
  // 90% of the way to the station — can't overshoot, but still long enough to
  // resolve direction on the ML loop where short probes on perpendicular
  // segments barely change distance to an off-loop station.
  const probeDist = Math.min(PROBE_DIST, Math.max(curDist * 0.9, 1e-5));
  const target = { targetLon: nextStn.lon, targetLat: nextStn.lat };
  const probeFwd = advanceOnTrack(trackPos, probeDist, +1, segs, target);
  const probeBwd = advanceOnTrack(trackPos, probeDist, -1, segs, target);
  const fwdDist = geoDist(probeFwd.lon, probeFwd.lat, nextStn.lon, nextStn.lat);
  const bwdDist = geoDist(probeBwd.lon, probeBwd.lat, nextStn.lon, nextStn.lat);
  if (fwdDist < bwdDist && fwdDist < curDist) return 1;
  if (bwdDist < fwdDist && bwdDist < curDist) return -1;
  return null;
}

function directionByTerminalWalk(trackPos, destNm, northDest, segs) {
  const termFwd = advanceOnTrack(trackPos, 9999, +1, segs);
  const termBwd = advanceOnTrack(trackPos, 9999, -1, segs);
  if (!termFwd.stopped && !termBwd.stopped) return null;
  const destIsNorth = destNm.includes(northDest);
  if (termFwd.stopped && termBwd.stopped) {
    // Check whether the two terminals are on opposite sides of the current
    // position.  On loop lines (OR, BR, PK, GR, PR) the terminal walk can
    // circle through the ML loop and exit back onto the same branch, reaching
    // the SAME dead-end from both directions.  When that happens the two
    // terminal latitudes are nearly identical and comparing them to each other
    // gives a meaningless result.  Detecting "same side" catches this: both
    // terminals north (or both south) of the train means one walk looped back.
    const northIsForward  = termFwd.lat > trackPos.lat;
    const northIsBackward = termBwd.lat > trackPos.lat;
    if (northIsForward === northIsBackward) {
      // Use local segment geometry to determine which direction is north.
      // This is more reliable than the CTA heading fallback, which can be
      // stale for stopped trains.  Guard against east-west segments where
      // the latitude delta is too small to be meaningful.
      const seg = segs[trackPos.segIdx];
      const pi = Math.min(trackPos.ptIdx, seg ? seg.length - 2 : 0);
      if (seg && pi >= 0) {
        const dy = seg[pi + 1][1] - seg[pi][1];
        const dx = seg[pi + 1][0] - seg[pi][0];
        if (Math.abs(dy) > Math.abs(dx) * 0.2) {
          return (destIsNorth === (dy > 0)) ? 1 : -1;
        }
      }
      // Local geometry too east-west (e.g. Brown line curve between Sedgwick
      // and Armitage, or ML extension segments).  Probe a short walk to see
      // which direction gains latitude — this follows the track through curves
      // and into a clearly north-south section.
      const probe = advanceOnTrack(trackPos, 0.01, +1, segs);
      const dLat = probe.lat - trackPos.lat;
      if (Math.abs(dLat) > 0.001) {
        return (destIsNorth === (dLat > 0)) ? 1 : -1;
      }
      return null;
    }
    return (destIsNorth === northIsForward) ? 1 : -1;
  }
  // Only one direction reached a dead-end — the other enters the Loop.
  // Compare the dead-end's latitude to the current position.
  if (termFwd.stopped) {
    const northIsForward = termFwd.lat > trackPos.lat;
    return (destIsNorth === northIsForward) ? 1 : -1;
  }
  // termBwd.stopped
  const northIsBackward = termBwd.lat > trackPos.lat;
  return (destIsNorth === !northIsBackward) ? 1 : -1;
}

/**
 * For all loop lines (OR, PK, BR, GR, PR), operators sometimes change the
 * destination signage before the train has actually entered or exited the loop.
 * For OR/PK the sign flips from "Loop" to the return destination (e.g. "Midway");
 * for BR/GR/PR the sign flips from "Loop" to the outbound terminal (e.g. "Kimball").
 * The CTA API reflects this early, causing directionByTerminalWalk to flip
 * direction prematurely — the train appears to move backward on the map.
 *
 * Detects this by checking the CTA API's nextStaNm field: if the next station
 * is closer to the Loop center than the train, the train is still heading
 * toward the Loop regardless of what the signage says.  Uses distance to Loop
 * center (not latitude) so this works for lines approaching from any direction.
 * Station lookup filters by the train's line to avoid same-named stations on
 * other lines (e.g. "Damen" on Blue vs Pink).
 *
 * Returns the destination name to use for direction calculation (may differ
 * from the displayed destNm).
 */
// Approximate center of the downtown Loop elevated
const LOOP_CENTER_LON = -87.630;
const LOOP_CENTER_LAT = 41.882;

/**
 * Finds the station object matching a train's nextStaNm, filtering by the
 * train's line to avoid same-named stations on other lines.
 * Returns the station object { name, lon, lat, legends } or null.
 */
function findNextStation(train, stations) {
  if (!train.nextStaNm || !stations) return null;
  const nextClean = cleanStationName(train.nextStaNm);
  for (const s of stations) {
    if (s.legends.includes(train.legend) && cleanStationName(s.name) === nextClean) {
      return s;
    }
  }
  // Try normalized matching if exact clean match fails
  const nextNorm = normalizeStationName(nextClean);
  for (const s of stations) {
    if (s.legends.includes(train.legend) && normalizeStationName(s.name) === nextNorm) {
      return s;
    }
  }
  return null;
}

function effectiveDestForDirection(train, northDest, stations) {
  if (!northDest) return train.destNm;

  // All loop lines (OR, PK, BR, GR, PR) can have premature signage changes
  // near the Loop.  For OR/PK the sign flips FROM "Loop" TO the return dest;
  // for BR/GR/PR the sign flips FROM "Loop" TO the outbound dest (Kimball,
  // Harlem, Linden).  In both cases the train is still physically heading
  // toward the Loop.  Detect by checking if nextStaNm is closer to the Loop
  // than the train.
  //
  // Skip the override when the dest already says "Loop" (train genuinely
  // heading to Loop) or when the line doesn't use the Loop at all (RD, BL, YL).
  const LOOP_LINES = new Set(['BR', 'OR', 'PK', 'PR', 'GR']);
  if (!LOOP_LINES.has(train.legend)) return train.destNm;
  if (!train.destNm || train.destNm.includes('Loop')) return train.destNm;

  const nextStn = findNextStation(train, stations);
  if (!nextStn) return train.destNm;

  // If the next station is closer to the Loop than the train, the train is
  // still heading toward the Loop — override the premature signage change.
  // Uses distance to Loop center rather than latitude so this works for lines
  // that approach the Loop from any direction (e.g. Pink Line from the west).
  //
  // A tiny noise margin (~22m) prevents GPS jitter from spuriously triggering
  // the override when the train is essentially AT the exit station (e.g. PR
  // at Merchandise Mart heading to Linden, where trainDistToLoop ≈
  // nextStnDistToLoop and GPS noise pushes it slightly outside).
  //
  // A proximity check (trainToNextStn < threshold) would be wrong here: it
  // stops the override while the train is still APPROACHING the exit station,
  // causing effectiveDest to change → destChanged fires → terminal walk
  // re-derives direction toward the outbound terminal → direction flip.
  // The correct guard is geometric: the override stops only once the train has
  // passed through the exit station (trainDistToLoop < nextStnDistToLoop).
  const GPS_NOISE = 0.0002;   // ~22 m — suppresses jitter at the exit station
  const trainDistToLoop = geoDist(train.lon, train.lat, LOOP_CENTER_LON, LOOP_CENTER_LAT);
  const nextStnDistToLoop = geoDist(nextStn.lon, nextStn.lat, LOOP_CENTER_LON, LOOP_CENTER_LAT);
  if (nextStnDistToLoop + GPS_NOISE < trainDistToLoop) {
    console.log(`[CTA] Dest override: rn=${train.rn} (${train.legend}) destNm="${train.destNm}" but nextStaNm="${train.nextStaNm}" is closer to Loop — using "Loop" for direction`);
    return 'Loop';
  }

  return train.destNm;
}

/**
 * Fetches real train positions from the CTA API via the server-side proxy.
 * The proxy fetches all routes in parallel and returns a combined response.
 */
async function fetchTrains() {
  if (!API_KEY) {
    return null;
  }

  try {
    const data = await d3.json(API_BASE);
    if (!data.trains || data.trains.length === 0) return null;

    return data.trains.map((t) => ({
      route: t.rt,
      legend: ROUTE_TO_LEGEND[t.rt],
      lat: parseFloat(t.lat),
      lon: parseFloat(t.lon),
      heading: parseInt(t.heading, 10),
      rn: t.rn,
      destNm: t.destNm,
      nextStaNm: t.nextStaNm,
      isApp: t.isApp,
      isDly: t.isDly,
      isSch: t.isSch,
    }));
  } catch (e) {
    console.warn('Failed to fetch trains:', e);
    return null;
  }
}

/**
 * Initializes animation state (_trackPos, _direction) on real trains after an API refresh.
 * Sets up drift correction to smoothly slide each train to its new API position.
 *
 * prevTrainMap: Map<rn, previousTrainObject> from before this refresh.
 */
function initRealTrainAnimation(trains, lineSegments, prevTrainMap, lineTerminals, stations) {
  const now = Date.now();
  const m = d => `${(d * 111000).toFixed(0)}m`;

  for (const train of trains) {
    const segs = lineSegments[train.legend];
    if (!segs || segs.length === 0) continue;

    // Store raw API position before snapping
    train._apiLon = train.lon;
    train._apiLat = train.lat;

    // Snap to track
    train._trackPos = snapToTrackPosition(train.lon, train.lat, segs);
    train.lon = train._trackPos.lon;
    train.lat = train._trackPos.lat;

    if (train.isSch === '1') {
      console.log(`[CTA] isSch=1: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) @ ${train._apiLat.toFixed(5)},${train._apiLon.toFixed(5)}`);
    }

    // Drift correction: smoothly slide from old visual position to new API position
    const prev = prevTrainMap ? prevTrainMap.get(train.rn) : null;

    // _direction is segment-relative (+1 = forward along point order, -1 = backward).
    // It becomes stale whenever the train crosses a segment boundary whose geometry runs
    // in the opposite orientation (e.g. BL at Loomis Junction, OR entering/exiting the
    // ML loop).  Re-derive on every segment change using a terminal walk when possible;
    // fall back to the CTA heading for positions on the ML loop where neither walk
    // reaches a dead-end (the loop connects back to itself).
    const northDest = LINE_NORTH_DESTS[train.legend];
    // Use effective destination for direction: detects premature signage
    // changes on all loop lines by checking if nextStaNm is still loop-bound.
    const effectiveDest = effectiveDestForDirection(train, northDest, stations);
    train._effectiveDest = effectiveDest;

    // Try next-station-based direction first — more reliable than terminal walk
    // on the ML loop where latitude heuristics fail (loop exit can be in the
    // opposite direction from the terminal).
    const nextStn = findNextStation(train, stations);
    let nextStnDir = nextStn
      ? directionByNextStation(train._trackPos, nextStn, segs)
      : null;
    // Guard against stale nextStaNm: when the train is close to the reported
    // next station and the probe would flip the established direction, the API
    // likely hasn't updated nextStaNm yet (it still points at a station the
    // train just passed).  Suppress the probe result so callers fall through to
    // terminal walk.  Only applies when an established direction exists — new
    // trains use the probe as-is and self-correct on subsequent polls.
    //
    // This is NOT a blanket distance cutoff — when the probe agrees with the
    // established direction (train genuinely approaching), it is trusted even
    // at close range.  This matters in dense station areas (subway trunk, Loop)
    // where stations are ~400m apart and a blanket 300m cutoff would disable
    // direction probing almost everywhere.
    if (nextStnDir !== null && prev && prev._direction !== undefined
        && nextStnDir !== prev._direction && nextStn
        && geoDist(train._trackPos.lon, train._trackPos.lat,
                   nextStn.lon, nextStn.lat) < 0.003) {
      nextStnDir = null;
    }

    if (prev && prev._direction !== undefined) {
      const segChanged = prev._trackPos && train._trackPos.segIdx !== prev._trackPos.segIdx;
      const destChanged = prev._effectiveDest && effectiveDest !== prev._effectiveDest;
      // For loop-line trains the direction can be wrongly initialised from a stale
      // CTA heading (both terminal walks circle back, returning null).  Re-derive
      // whenever next-station direction disagrees so the train self-corrects rather
      // than staying backwards indefinitely.
      const loopLineMismatch = ['BR', 'OR', 'PK', 'PR', 'GR'].includes(train.legend)
        && nextStnDir !== null && nextStnDir !== prev._direction;
      if ((segChanged || destChanged || loopLineMismatch) && northDest && effectiveDest) {
        // Segment or destination changed — re-derive direction.
        // Prefer next-station direction (handles ML loop topology correctly),
        // then terminal walk, then segment connectivity / heading fallbacks.
        if (nextStnDir !== null) {
          train._direction = nextStnDir;
        } else {
          const termDir = directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs);
          if (termDir !== null) {
            train._direction = termDir;
          } else if (segChanged) {
            // Terminal walk failed (e.g. both directions circle the ML loop).
            // Infer direction from segment connectivity: check which way the
            // previous segment connects to the new one.
            const prevSeg = segs[prev._trackPos.segIdx];
            const boundary = prev._direction > 0 ? prevSeg.length - 1 : 0;
            const connected = findConnectedSegment(
              prev._trackPos.segIdx, boundary, prevSeg, prev._direction, segs
            );
            if (connected && connected.segIdx === train._trackPos.segIdx) {
              train._direction = connected.direction;
            } else {
              train._direction = directionFromHeading(
                train.heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs
              );
            }
          } else {
            // Dest changed on same segment, terminal walk failed — keep direction.
            // The physical direction of travel doesn't change just because the
            // sign changed (the train continues around the loop to exit).
            train._direction = prev._direction;
          }
        }
      } else {
        train._direction = prev._direction;
      }
    } else if (northDest && effectiveDest) {
      // New train — prefer next-station direction, then terminal walk, then heading.
      if (nextStnDir !== null) {
        train._direction = nextStnDir;
      } else {
        const termDir = directionByTerminalWalk(train._trackPos, effectiveDest, northDest, segs);
        train._direction = termDir ?? directionFromHeading(
          train.heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs
        );
      }
    } else {
      train._direction = directionFromHeading(
        train.heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs
      );
    }

    if (prev && prev._animLon !== undefined) {
      const drift = geoDist(prev._animLon, prev._animLat, train.lon, train.lat);

      // Station names for structured logging — helps identify new phantom patterns
      const _fromStn = stations ? nearestStationName(prev._animLon, prev._animLat, stations, train.legend) : null;
      const _toStn   = stations ? nearestStationName(train.lon, train.lat, stations, train.legend) : null;
      const stnTag   = (_fromStn && _toStn && _fromStn !== _toStn) ? ` [${_fromStn} → ${_toStn}]` : (_fromStn ? ` [near ${_fromStn}]` : '');

      // Known phantom jump check — immediately reject known bad patterns
      if (stations && drift > 1e-7) {
        const phantomRule = matchesKnownPhantomJump(
          train.legend, prev._animLon, prev._animLat, train.lon, train.lat, stations
        );
        if (phantomRule) {
          train._trackPos = { ...prev._trackPos };
          train.lon = prev._animLon;
          train.lat = prev._animLat;
          train._direction = prev._direction;
          train._backwardHoldCount = 0;
          train._forwardHoldCount = 0;
          train._stationJumpHoldCount = 0;
          train._nearStation = stations ? nearestStationWithinRadius(train.lon, train.lat, stations, train.legend, STATION_JUMP_RADIUS) : null;
          console.warn(`[CTA] Phantom blocked: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag} — ${phantomRule.description}`);
          continue;
        }
      }

      if (train.isSch === '1' && prev._trackPos && drift > 1e-7) {
        // Schedule-based position — hold at previous position rather than jumping.
        // isSch=1 means CTA is projecting from schedule, not confirmed track-circuit
        // data. This is the tell for express-train phantom positions: the system
        // knows the Purple Express will skip to Wilson, so it briefly projects the
        // train there before the ATC circuit physically confirms it. On the next
        // poll the GPS-equivalent (circuit) position snaps back to Lawrence/Granville.
        // Holding prevents both the forward jump and the jarring backward correction.
        train._trackPos = { ...prev._trackPos };
        train.lon = prev._animLon;
        train.lat = prev._animLat;
        train._direction = prev._direction;
        console.warn(`[CTA] isSch hold: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag}`);
      } else if (drift < CORRECTION_SNAP_THRESHOLD && drift > 1e-7) {
        // Save the API-snapped target (where the train should end up)
        train._corrToTrackPos = { ...train._trackPos };
        // Use prev's maintained track position (avoids re-snapping to wrong segment)
        train._corrFromTrackPos = prev._trackPos
          ? { ...prev._trackPos }
          : snapToTrackPosition(prev._animLon, prev._animLat, segs);

        // Determine correction direction empirically: test one step in each
        // direction from the old position and pick whichever gets closer to target.
        // When the probe is ambiguous (both directions roughly equidistant — e.g.
        // near an ML loop corner where a small step in either direction is similar
        // distance from the target), fall back to the direction already derived
        // via the full cascade above.
        const toPos = train._corrToTrackPos;
        const testStep = Math.max(drift * 0.1, 1e-5);
        const fwdTest = advanceOnTrack(train._corrFromTrackPos, testStep, +1, segs);
        const bwdTest = advanceOnTrack(train._corrFromTrackPos, testStep, -1, segs);
        const fwdDist = geoDist(fwdTest.lon, fwdTest.lat, toPos.lon, toPos.lat);
        const bwdDist = geoDist(bwdTest.lon, bwdTest.lat, toPos.lon, toPos.lat);
        if (Math.abs(fwdDist - bwdDist) < testStep * 0.5) {
          // Ambiguous probe — trust the direction already derived above
          train._corrDirection = train._direction;
        } else {
          train._corrDirection = fwdDist <= bwdDist ? 1 : -1;
        }

        // Precompute track distance so we can advance proportionally each frame
        train._corrTotalDist = trackDistanceBetween(
          train._corrFromTrackPos, train._corrToTrackPos, train._corrDirection, segs
        );

        // Validate the correction path: advance the full distance and verify we land
        // near the target.  If not, the path took a detour — e.g. going around the
        // downtown Loop on loop exit, or correcting a bad API position jump (like a
        // Purple Express hop to Wilson that then snaps back to Howard).
        // In that case, snap directly and re-derive direction from the API heading.
        const _corrPathEnd = advanceOnTrack(
          train._corrFromTrackPos, train._corrTotalDist, train._corrDirection, segs,
          { targetLon: toPos.lon, targetLat: toPos.lat }
        );
        let _pvPathValid = geoDist(_corrPathEnd.lon, _corrPathEnd.lat, toPos.lon, toPos.lat) <= drift * 0.5;
        if (!_pvPathValid) {
          // Path validation failed — try the opposite direction before giving up.
          // This handles ML loop corners where the empirical probe picked the wrong
          // direction at a junction (both directions were near-equidistant from target
          // but one navigates a junction incorrectly).
          const altDir = train._corrDirection * -1;
          const altDist = trackDistanceBetween(
            train._corrFromTrackPos, train._corrToTrackPos, altDir, segs
          );
          const altEnd = advanceOnTrack(
            train._corrFromTrackPos, altDist, altDir, segs,
            { targetLon: toPos.lon, targetLat: toPos.lat }
          );
          if (geoDist(altEnd.lon, altEnd.lat, toPos.lon, toPos.lat) <= drift * 0.5) {
            // Opposite direction validates — use it
            train._corrDirection = altDir;
            train._corrTotalDist = altDist;
            _pvPathValid = true;
            console.log(`[CTA] Path validation: rn=${train.rn} (${train.legend}) flipped correction dir to ${altDir > 0 ? '+1' : '-1'}, drift=${m(drift)}`);
          } else {
            // Both directions fail — snap directly.
            console.warn(`[CTA] Path validation failed: rn=${train.rn} (${train.legend}) drift=${m(drift)} — snapping`);
            const _pvNorthDest = LINE_NORTH_DESTS[train.legend];
            const _pvTermDir = (_pvNorthDest && effectiveDest)
              ? directionByTerminalWalk(train._trackPos, effectiveDest, _pvNorthDest, segs)
              : null;
            if (_pvTermDir !== null) {
              train._direction = _pvTermDir;
            }
            // Leave _correcting = false — train stays at API-snapped position.
          }
        }
        if (_pvPathValid) {
          train._correcting = true;
          train._corrStartTime = now;
          // Set current visual position to the from track position
          train.lon = train._corrFromTrackPos.lon;
          train.lat = train._corrFromTrackPos.lat;

          // Suspect-move confirmation: hold and require BACKWARD_CONFIRM_POLLS consecutive
          // agreeing polls before committing to either:
          //   (a) a backward correction — likely a phantom-forward glitch that is now
          //       being "corrected" back, or a real but unconfirmed reversal.
          //   (b) a forward correction beyond FORWARD_PLAUSIBLE_DIST — almost always a
          //       phantom position injected by the schedule-projection system without isSch=1.
          //
          // Classify the correction as forward or backward by comparing _corrDirection
          // (empirical, which way gets closer) to the train's expected direction of
          // travel at corrFromTrackPos.  Use a terminal walk when possible (reliable on
          // non-loop segments and handles geometry-flip junctions); when terminal walk
          // returns null (ML-loop positions), use train._direction — the direction
          // already derived above with the full cascade (nextStnDir → termWalk →
          // connectivity → heading).  This is strictly better than prev._direction
          // which may be stale/wrong (e.g. initialised from a bad heading on the ML
          // loop).  On segment changes, _corrFromTrackPos is on the OLD segment while
          // train._direction is for the NEW one, but crossing a segment boundary is
          // inherently forward movement, so "not backward" is the correct classification.
          const _sbNorthDest = LINE_NORTH_DESTS[train.legend];
          const _headingDirFromPos = (_sbNorthDest && effectiveDest)
            ? (directionByTerminalWalk(train._corrFromTrackPos, effectiveDest,
                _sbNorthDest, segs)
              ?? train._direction)
            : train._direction;
          const isSuspectBackward = _headingDirFromPos !== train._corrDirection;
          const isSuspectForward  = !isSuspectBackward && drift > FORWARD_PLAUSIBLE_DIST;

          if (isSuspectBackward && drift < 0.00018) {
            // Micro-drift backward (<20m) — GPS/snap jitter, silently ignore
            train._correcting = false;
            train._trackPos = { ...prev._trackPos };
            train.lon = prev._animLon;
            train.lat = prev._animLat;
            train._backwardHoldCount = 0;
            train._forwardHoldCount = 0;
            train._stationJumpHoldCount = 0;
          } else if (isSuspectBackward) {
            train._forwardHoldCount = 0;
            train._stationJumpHoldCount = 0;
            train._backwardHoldCount = (prev._backwardHoldCount || 0) + 1;
            if (train._backwardHoldCount < BACKWARD_CONFIRM_POLLS) {
              train._correcting = false;
              train._trackPos = { ...prev._trackPos };
              train.lon = prev._animLon;
              train.lat = prev._animLat;
              console.log(`[CTA] Backward hold: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag} [${train._backwardHoldCount}/${BACKWARD_CONFIRM_POLLS}]`);
            } else {
              // Snap directly — never animate backwards
              train._correcting = false;
              train._trackPos = { ...train._corrToTrackPos };
              train.lon = train._corrToTrackPos.lon;
              train.lat = train._corrToTrackPos.lat;
              // Prefer to gate the direction update on the API heading agreeing with
              // the confirmed movement — that covers genuine reversals while leaving
              // API overshoot-corrections intact.
              // However, if _backwardHoldCount has grown to 5× the confirmation
              // threshold without ever clearing, the heading is almost certainly
              // stale/bad (e.g. train appeared with wrong heading and no ETA data).
              // A real API oscillation resets the count to 0 when the position
              // stabilises and forward movement resumes, so it never accumulates
              // this high. At 5× we trust the sustained empirical movement instead.
              const headingDir = directionFromHeading(
                train.heading, train._corrToTrackPos.segIdx, train._corrToTrackPos.ptIdx, segs
              );
              if (headingDir === train._corrDirection ||
                  train._backwardHoldCount >= 5 * BACKWARD_CONFIRM_POLLS) {
                train._direction = train._corrDirection;
              }
              console.log(`[CTA] Backward confirmed (snap): rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag} after ${train._backwardHoldCount} polls`);
            }
          } else if (isSuspectForward) {
            train._backwardHoldCount = 0;
            train._stationJumpHoldCount = 0;
            train._forwardHoldCount = (prev._forwardHoldCount || 0) + 1;
            if (train._forwardHoldCount < FORWARD_CONFIRM_POLLS) {
              train._correcting = false;
              train._trackPos = { ...prev._trackPos };
              train.lon = prev._animLon;
              train.lat = prev._animLat;
              console.log(`[CTA] Fast-forward hold: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag} [${train._forwardHoldCount}/${FORWARD_CONFIRM_POLLS}]`);
            } else {
              console.log(`[CTA] Fast-forward confirmed: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag} after ${train._forwardHoldCount} polls`);
            }
          } else {
            train._backwardHoldCount = 0;
            train._forwardHoldCount = 0;
            // Station-jump detection: if train was near a station and now appears
            // near a different station in a single poll, hold to distinguish
            // phantom jumps from real arrivals.  Express trains that skip stations
            // still take real time to travel, so the hold confirms naturally.
            if (prev._nearStation && stations) {
              const newNearStation = nearestStationWithinRadius(
                train.lon, train.lat, stations, train.legend, STATION_JUMP_RADIUS
              );
              if (newNearStation && newNearStation !== prev._nearStation && drift >= STATION_JUMP_MIN_DRIFT) {
                train._stationJumpHoldCount = (prev._stationJumpHoldCount || 0) + 1;
                if (train._stationJumpHoldCount < STATION_JUMP_CONFIRM_POLLS) {
                  train._correcting = false;
                  train._trackPos = { ...prev._trackPos };
                  train.lon = prev._animLon;
                  train.lat = prev._animLat;
                  console.log(`[CTA] Station-jump hold: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag} [${train._stationJumpHoldCount}/${STATION_JUMP_CONFIRM_POLLS}]`);
                } else {
                  console.log(`[CTA] Station-jump confirmed: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag} after ${train._stationJumpHoldCount} polls`);
                  train._stationJumpHoldCount = 0;
                }
              } else {
                train._stationJumpHoldCount = 0;
              }
            } else {
              train._stationJumpHoldCount = 0;
            }
          }
        }
      } else if (drift >= CORRECTION_SNAP_THRESHOLD) {
        // Snap-range jump: too large to interpolate and physically implausible
        // (>400 km/h at 30s poll). Apply the same confirmation-hold used for
        // suspect smooth corrections before accepting. If confirmed, re-derive
        // direction from the API heading since the preserved one may be stale
        // (e.g. after a terminus reversal that crossed the snap threshold).
        if (prev._trackPos) {
          // For snap-range jumps the tiny geometric probe (fwd/bwd step) is
          // unreliable — both probes land ~11 m from the old position while
          // the new position is kilometres away, so the distance difference is
          // noise. Use the API heading directly instead.
          const snapDir = directionFromHeading(
            train.heading, prev._trackPos.segIdx, prev._trackPos.ptIdx, segs
          );
          const isSuspectBackward = snapDir !== train._direction;
          const countKey = isSuspectBackward ? '_backwardHoldCount' : '_forwardHoldCount';
          const otherKey = isSuspectBackward ? '_forwardHoldCount' : '_backwardHoldCount';
          const confirmPolls = isSuspectBackward ? BACKWARD_CONFIRM_POLLS : FORWARD_SNAP_CONFIRM_POLLS;
          train[otherKey] = 0;
          train[countKey] = (prev[countKey] || 0) + 1;
          if (train[countKey] < confirmPolls) {
            train._trackPos = { ...prev._trackPos };
            train.lon = prev._animLon;
            train.lat = prev._animLat;
            console.log(`[CTA] Snap hold: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag} [${train[countKey]}/${confirmPolls}]`);
          } else {
            // Re-derive direction at the snapped position.  Terminal walk is
            // reliable on non-loop segments; fall back to heading for ML-loop
            // positions (where the CTA heading may still reflect a stale Loop
            // orientation, but is the only option when terminal walk returns null).
            const _snapNorthDest = LINE_NORTH_DESTS[train.legend];
            const _snapTermDir = (_snapNorthDest && effectiveDest)
              ? directionByTerminalWalk(train._trackPos, effectiveDest, _snapNorthDest, segs)
              : null;
            train._direction = _snapTermDir ?? directionFromHeading(
              train.heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs
            );
            console.warn(`[CTA] Snap confirmed: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag} after ${train[countKey]} polls`);
          }
        } else {
          const _npNorthDest = LINE_NORTH_DESTS[train.legend];
          const _npTermDir = (_npNorthDest && effectiveDest)
            ? directionByTerminalWalk(train._trackPos, effectiveDest, _npNorthDest, segs)
            : null;
          train._direction = _npTermDir ?? directionFromHeading(
            train.heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs
          );
          console.warn(`[CTA] Snap: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${m(drift)}${stnTag} — no prior position`);
        }
      }
    }

    // Track which station the train is near for station-jump detection on next poll
    train._nearStation = stations
      ? nearestStationWithinRadius(train.lon, train.lat, stations, train.legend, STATION_JUMP_RADIUS)
      : null;
  }
}


/**
 * Advances retiring trains toward their terminal station each frame.
 * Once the approach slide completes, starts the TERMINUS_HOLD_MS timer.
 * Sets _retireComplete = true when the hold expires so the caller can remove them.
 */
function advanceRetiringTrains(trains, lineSegments, dt) {
  const now = Date.now();

  for (const train of trains) {
    if (!train._trackPos) continue;
    // Use line's own segments if stored (avoids sliding onto shared track)
    const segs = train._retireSegs || lineSegments[train.legend];
    if (!segs) continue;

    if (train._correcting) {
      const elapsed = now - train._corrStartTime;
      if (elapsed >= TERMINAL_APPROACH_DURATION) {
        // Arrived at terminal — snap and start hold timer
        train._correcting = false;
        train._trackPos = train._corrToTrackPos;
        train.lon = train._corrToTrackPos.lon;
        train.lat = train._corrToTrackPos.lat;
        train._retireTime = now;
      } else {
        const t = elapsed / TERMINAL_APPROACH_DURATION;
        const eased = t * t * (3 - 2 * t); // smoothstep
        const pos = advanceOnTrack(
          train._corrFromTrackPos, eased * train._corrTotalDist, train._corrDirection, segs
        );
        train.lon = pos.lon;
        train.lat = pos.lat;
        train._trackPos = pos;
      }
    } else if (train._retireTime) {
      // Sitting at terminal — check if hold period has elapsed
      if (now - train._retireTime >= TERMINUS_HOLD_MS) {
        train._retireComplete = true;
      }
    }

    train._animLon = train.lon;
    train._animLat = train.lat;
  }
}

/**
 * Advances real trains each animation frame.
 * During the correction window after a refresh, slides trains smoothly along
 * the track to their new API position. After that, trains sit still until
 * the next refresh.
 */
function advanceRealTrains(trains, lineSegments, dt) {
  const now = Date.now();

  for (const train of trains) {
    if (!train._trackPos) continue;
    const segs = lineSegments[train.legend];
    if (!segs) continue;

    // Drift correction: smoothly slide from old position to new API position
    // Spawning trains (new to the data) get a longer slide from the start of the line
    if (train._correcting) {
      const elapsed = now - train._corrStartTime;
      const duration = train._spawning ? TERMINAL_APPROACH_DURATION : CORRECTION_DURATION;
      if (elapsed >= duration) {
        // Correction complete — sit still until next refresh.
        train._correcting = false;
        train._spawning = false;
        // Use the track-path natural endpoint rather than the raw API snap.
        // _corrToTrackPos was computed by nearest-segment snap, which near junctions
        // (e.g. the downtown Loop) can land on an adjacent, differently-oriented
        // segment, causing the heading arrow to flip at the moment correction ends.
        // advanceOnTrack follows the same segment topology as the animation, so its
        // endpoint always has a consistent segIdx and direction.
        // Pass the correction target so junction selection at the downtown Loop
        // (where multiple ML segments meet) follows the correct branch.
        const corrTarget = train._corrToTrackPos
          ? { targetLon: train._corrToTrackPos.lon, targetLat: train._corrToTrackPos.lat }
          : undefined;
        const finalPos = advanceOnTrack(
          train._corrFromTrackPos, train._corrTotalDist, train._corrDirection, segs, corrTarget
        );
        train._trackPos = finalPos;
        train.lon = finalPos.lon;
        train.lat = finalPos.lat;
        // finalPos.direction reflects any flip from crossing a segment boundary
        // (e.g. exiting the ML loop onto the own Orange segment where ±1 reverses),
        // so it is more reliable than _corrDirection for the post-correction state.
        //
        // Update _direction when the correction moved in the established direction
        // (genuine forward progress). For backward corrections, also update when the
        // CTA heading confirms the new direction — this handles genuine terminus
        // reversals. If heading still points in the old direction the backward
        // correction was an API position glitch (e.g. Purple Express snapping to
        // Wilson then correcting back), so _direction is left unchanged.
        if (train._corrDirection === train._direction) {
          train._direction = finalPos.direction !== undefined ? finalPos.direction : train._corrDirection;
        } else {
          // Backward correction: use heading as tiebreaker.
          const headingDir = directionFromHeading(
            train.heading, finalPos.segIdx, finalPos.ptIdx, segs
          );
          if (headingDir === train._corrDirection) {
            // Heading confirms the correction direction — genuine reversal.
            train._direction = finalPos.direction !== undefined ? finalPos.direction : train._corrDirection;
          }
          // else: API position glitch; keep _direction as established value.
        }
      } else {
        // Smoothstep easing: accelerate then decelerate
        const t = elapsed / duration;
        const eased = t * t * (3 - 2 * t);
        const corrTarget = train._corrToTrackPos
          ? { targetLon: train._corrToTrackPos.lon, targetLat: train._corrToTrackPos.lat }
          : undefined;
        const pos = advanceOnTrack(
          train._corrFromTrackPos, eased * train._corrTotalDist, train._corrDirection, segs, corrTarget
        );
        train.lon = pos.lon;
        train.lat = pos.lat;
        train._trackPos = pos;
      }
    }

    // Always update animated position so drift calculation works on next refresh
    train._animLon = train.lon;
    train._animLat = train.lat;
  }
}

