/**
 * Finds the nearest station name for a given position and optional legend filter.
 * Uses a spatial grid index (stations._index) when available for faster lookup.
 * Returns the station name string, or null if no station is found.
 */
function nearestStationName(lon, lat, stations, legend) {
  const idx = stations._index;
  if (!idx) {
    // Fallback: linear scan
    let bestName = null, bestDist = Infinity;
    for (const s of stations) {
      if (legend && !s.legends.includes(legend)) continue;
      const d = geoDist(lon, lat, s.lon, s.lat);
      if (d < bestDist) { bestDist = d; bestName = s.name; }
    }
    return bestName;
  }

  // Spatial index: expand search ring by ring until best candidate is
  // definitively closer than the nearest unchecked cell boundary.
  const { cells, CELL } = idx;
  const cx0 = Math.floor(lon / CELL);
  const cy0 = Math.floor(lat / CELL);
  let bestName = null, bestDist = Infinity;

  for (let r = 0; r <= 60; r++) {
    // Once the best found distance is less than the inner edge of this ring,
    // no outer cell can improve on it.
    if (r > 0 && bestDist < (r - 1) * CELL) break;
    for (let dcx = -r; dcx <= r; dcx++) {
      for (let dcy = -r; dcy <= r; dcy++) {
        if (Math.abs(dcx) !== r && Math.abs(dcy) !== r) continue; // ring only
        const bucket = cells.get((cx0 + dcx) + ',' + (cy0 + dcy));
        if (!bucket) continue;
        for (const s of bucket) {
          if (legend && !s.legends.includes(legend)) continue;
          const d = geoDist(lon, lat, s.lon, s.lat);
          if (d < bestDist) { bestDist = d; bestName = s.name; }
        }
      }
    }
  }
  return bestName;
}

/**
 * Returns the name of the nearest station within `radius` degrees, or null.
 * Uses spatial index (stations._index) when available — only checks cells
 * overlapping the search circle, typically 9 cells vs. full linear scan.
 */
function nearestStationWithinRadius(lon, lat, stations, legend, radius) {
  const idx = stations._index;
  if (!idx) {
    let bestName = null, bestDist = Infinity;
    for (const s of stations) {
      if (legend && !s.legends.includes(legend)) continue;
      const d = geoDist(lon, lat, s.lon, s.lat);
      if (d < bestDist) { bestDist = d; bestName = s.name; }
    }
    return bestDist < radius ? bestName : null;
  }

  const { cells, CELL } = idx;
  const cx0 = Math.floor(lon / CELL);
  const cy0 = Math.floor(lat / CELL);
  const cellR = Math.ceil(radius / CELL);
  let bestName = null, bestDist = radius; // use radius as upper bound

  for (let dcx = -cellR; dcx <= cellR; dcx++) {
    for (let dcy = -cellR; dcy <= cellR; dcy++) {
      const bucket = cells.get((cx0 + dcx) + ',' + (cy0 + dcy));
      if (!bucket) continue;
      for (const s of bucket) {
        if (legend && !s.legends.includes(legend)) continue;
        const d = geoDist(lon, lat, s.lon, s.lat);
        if (d < bestDist) { bestDist = d; bestName = s.name; }
      }
    }
  }
  return bestName;
}

/**
 * Checks whether a position update matches a known phantom jump pattern.
 * Returns the matching rule, or null.
 */
function matchesKnownPhantomJump(legend, prevLon, prevLat, newLon, newLat, stations) {
  const rules = PHANTOM_JUMP_BY_LEGEND.get(legend);
  if (!rules) return null;
  for (const rule of rules) {
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

// LINE_NORTH_DESTS is defined in config.js

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
function directionByNextStation(trackPos, nextStn, segs, neighborMap) {
  // PROBE_DIST defined in config.js (~1.5km — long enough to reach around corners of the ML loop)
  const curDist = geoDist(trackPos.lon, trackPos.lat, nextStn.lon, nextStn.lat);
  // When close to the station, scale the probe down so it stays short of the
  // station.  A probe that overshoots makes fwdDist > curDist in both
  // directions, causing a spurious null return.  0.9 keeps the probe at most
  // 90% of the way to the station — can't overshoot, but still long enough to
  // resolve direction on the ML loop where short probes on perpendicular
  // segments barely change distance to an off-loop station.
  const probeDist = Math.min(PROBE_DIST, Math.max(curDist * 0.9, 1e-5));
  const target = { targetLon: nextStn.lon, targetLat: nextStn.lat, neighborMap };
  const probeFwd = advanceOnTrack(trackPos, probeDist, +1, segs, target);
  const probeBwd = advanceOnTrack(trackPos, probeDist, -1, segs, target);
  const fwdDist = geoDist(probeFwd.lon, probeFwd.lat, nextStn.lon, nextStn.lat);
  const bwdDist = geoDist(probeBwd.lon, probeBwd.lat, nextStn.lon, nextStn.lat);
  if (fwdDist < bwdDist && fwdDist < curDist) return 1;
  if (bwdDist < fwdDist && bwdDist < curDist) return -1;
  return null;
}

function directionByTerminalWalk(trackPos, destNm, northDest, segs, neighborMap) {
  const nmOpts = neighborMap ? { neighborMap } : undefined;
  const termFwd = advanceOnTrack(trackPos, 9999, +1, segs, nmOpts);
  const termBwd = advanceOnTrack(trackPos, 9999, -1, segs, nmOpts);
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
      // and Armitage, or ML extension segments).  Probe both directions to see
      // which gains vs. loses latitude — reliable when one probe goes north and
      // the other south (opposite signs).  On the ML Loop's E-W Van Buren
      // segment both +1 and -1 turn north after a short east/west run (one via
      // Wabash, the other via Wells); in that case the signs are the same and
      // we return null so the loopLineMismatch path can use rawNextStnDir
      // instead of confirming the wrong direction.
      const probeFwd = advanceOnTrack(trackPos, 0.01, +1, segs, nmOpts);
      const probeBwd = advanceOnTrack(trackPos, 0.01, -1, segs, nmOpts);
      const dLatFwd = probeFwd.lat - trackPos.lat;
      const dLatBwd = probeBwd.lat - trackPos.lat;
      if (dLatFwd * dLatBwd < 0) {
        // One probe goes north, the other south — unambiguous.
        return (destIsNorth === (dLatFwd > dLatBwd)) ? 1 : -1;
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
// LOOP_CENTER defined in config.js

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

  // OR/PK/BR/PR can have premature signage changes near the Loop:
  //   OR/PK: sign flips FROM "Loop" TO the return dest (e.g. "Midway")
  //   BR/PR: sign flips FROM "Loop" TO the outbound dest (e.g. "Kimball")
  // In both cases the train is still physically heading toward the Loop.
  // Detect by checking if nextStaNm is closer to the Loop than the train.
  //
  // GR is excluded: although it traverses ML Loop segments, Green Line trains
  // never display "Loop" as a destination — they always show their terminal
  // ("Harlem/Lake", "Cottage Grove", "King Drive").  Applying this override
  // to GR incorrectly returns "Loop" as effectiveDest, which makes
  // destIsNorth false in directionByTerminalWalk (since "Loop" ∌ "Harlem")
  // and locks southbound-branch trains in the wrong direction.
  //
  // Skip entirely for lines that never show "Loop" as a destination (RD, BL, YL, GR).
  // When dest says "Loop", handle separately below (late-flip detection).
  const LOOP_DEST_LINE_SET = new Set(['BR', 'OR', 'PK', 'PR']);
  if (!LOOP_DEST_LINE_SET.has(train.legend)) return train.destNm;
  if (!train.destNm) return train.destNm;
  // A "Loop" destination is usually correct (train genuinely heading to Loop),
  // but the sign can also be a late flip — still saying "Loop" after the train
  // has already started heading outbound (the sign hasn't changed to e.g.
  // "54th/Cermak" yet).  Detect by checking if nextStaNm points to a station
  // that is farther from the Loop center than the train's current position —
  // if so, the train is heading outbound despite the stale "Loop" sign.
  if (train.destNm.includes('Loop')) {
    const nextStnLF = findNextStation(train, stations);
    if (nextStnLF) {
      const tDistLF = geoDist(train.lon, train.lat, LOOP_CENTER.lon, LOOP_CENTER.lat);
      const nDistLF = geoDist(nextStnLF.lon, nextStnLF.lat, LOOP_CENTER.lon, LOOP_CENTER.lat);
      if (nDistLF > tDistLF + 0.002) {
        // Next station is meaningfully farther from the Loop — late sign flip.
        // Return a non-Loop sentinel so directionByTerminalWalk treats the train
        // as outbound (destIsNorth = false for all loop lines where northDest
        // is "Loop").
        console.log(`[CTA] Dest override: rn=${train.rn} (${train.legend}) destNm="${train.destNm}" but nextStaNm="${train.nextStaNm}" is farther from Loop — late flip, treating as outbound`);
        return 'OUTBOUND';
      }
    }
    return train.destNm;
  }

  const nextStn = findNextStation(train, stations);
  if (!nextStn) return train.destNm;

  // If the next station is closer to the Loop than the train, the train is
  // still heading toward the Loop — override the premature signage change.
  // Uses distance to Loop center rather than latitude so this works for lines
  // that approach the Loop from any direction (e.g. Pink Line from the west).
  //
  // When the train is very close to the reported next station (~110m), the
  // normal comparison (nextStnDistToLoop < trainDistToLoop) can't help because
  // the station is at roughly the same position as the train.  Two cases:
  //
  //   (a) Genuine Loop exit: the train is physically AT a Loop-boundary station
  //       (e.g. Merchandise Mart for PR, Clinton for PK).  These stations are
  //       within ~0.014° of the Loop center.  Trust the sign.
  //
  //   (b) Stale nextStaNm: the API hasn't updated nextStaNm yet and still
  //       reports the station the train just passed (e.g. Brown Line reports
  //       nextStaNm="Chicago" while AT Chicago/Franklin heading south).  These
  //       approach stations are farther from the Loop (~0.016°+).  If the train
  //       itself is still within approach range (<0.025°), treat it as
  //       loop-bound regardless of the premature signage change.
  const trainToNextStn = geoDist(train.lon, train.lat, nextStn.lon, nextStn.lat);
  const trainDistToLoop = geoDist(train.lon, train.lat, LOOP_CENTER.lon, LOOP_CENTER.lat);
  const nextStnDistToLoop = geoDist(nextStn.lon, nextStn.lat, LOOP_CENTER.lon, LOOP_CENTER.lat);
  if (trainToNextStn < 0.001) {
    // Case (a): station is within Loop-exit range — genuinely at a boundary
    // station, trust the sign.
    if (nextStnDistToLoop <= 0.014) return train.destNm;
    // Case (b): station is farther out — likely a stale nextStaNm on an
    // approach segment.  Override to "Loop" if the train is still approaching,
    // but not if the train is already inside the Loop (circling to exit).
    if (trainDistToLoop >= LOOP_INNER_RADIUS && trainDistToLoop < 0.025) {
      console.log(`[CTA] Dest override: rn=${train.rn} (${train.legend}) destNm="${train.destNm}" but nextStaNm="${train.nextStaNm}" appears stale at approach station (dist-to-loop=${trainDistToLoop.toFixed(4)}) — using "Loop"`);
      return 'Loop';
    }
    return train.destNm;
  }
  // If the train is already inside the Loop, the sign is correct — the train
  // is circling to exit, not approaching from outside.  The "next station
  // closer to Loop" heuristic only applies on outer approach segments.
  if (trainDistToLoop < LOOP_INNER_RADIUS) {
    console.log(`[CTA] Inside Loop: rn=${train.rn} (${train.legend}) trusting destNm="${train.destNm}" (dist-to-loop=${trainDistToLoop.toFixed(4)})`);
    return train.destNm;
  }
  if (nextStnDistToLoop < trainDistToLoop) {
    // Guard: train is well outside the Loop approach corridor (>~5.5 km).
    // e.g. PR→Howard near Central (Evanston) — stale nextStaNm, not approaching.
    if (trainDistToLoop > 0.05) return train.destNm;
    console.log(`[CTA] Dest override: rn=${train.rn} (${train.legend}) destNm="${train.destNm}" but nextStaNm="${train.nextStaNm}" is closer to Loop — using "Loop" for direction`);
    return 'Loop';
  }

  return train.destNm;
}

/**
 * Fetches processed train state from the server REST endpoint.
 * Used as a one-shot fetch for the initial load and as a fallback when
 * the SSE stream is unavailable.  The server already applies snapping,
 * direction inference, and all hold logic — fields like `direction`,
 * `trackPos`, `effectiveDest`, and `held` are ready to use directly.
 */
async function fetchTrains() {
  if (!API_KEY) {
    return null;
  }

  try {
    const data = await d3.json(API_BASE);
    if (!data.trains || data.trains.length === 0) return null;
    return mapServerTrains(data.trains);
  } catch (e) {
    console.warn('Failed to fetch trains:', e);
    return null;
  }
}

/**
 * Maps a server-processed trains array to client train objects.
 * Server provides pre-computed direction, trackPos, effectiveDest, and held flag.
 */
function mapServerTrains(serverTrains) {
  return serverTrains.map((t) => ({
    route:         t.rt,
    legend:        t.legend,
    lat:           t.lat,           // already a float, already snapped
    lon:           t.lon,
    heading:       t.heading,
    rn:            t.rn,
    destNm:        t.destNm,
    nextStaNm:     t.nextStaNm,
    isApp:         t.isApp,
    isDly:         t.isDly,
    isSch:         t.isSch,
    // Server-computed fields:
    _serverTrackPos:    t.trackPos,      // snapped position — used in initRealTrainAnimation
    _serverDirection:   t.direction,     // derived direction — skips client cascade
    _serverEffectiveDest: t.effectiveDest,
    _serverHeld:        t.held,          // if true, server is holding at this position
    _serverHeldReason:  t.heldReason,
  }));
}

/**
 * Initializes animation state (_trackPos, _direction) on real trains after an API refresh.
 * The server has already applied snapping, direction inference, and all hold logic.
 * This function only sets up the smooth visual correction animation (client-only concern).
 *
 * prevTrainMap: Map<rn, previousTrainObject> from before this refresh.
 */
function initRealTrainAnimation(trains, lineSegments, prevTrainMap, lineTerminals, stations, lineNeighborMaps) {
  const now = Date.now();

  for (const train of trains) {
    const segs = lineSegments[train.legend];
    if (!segs || segs.length === 0) continue;

    const prev = prevTrainMap ? prevTrainMap.get(train.rn) : null;

    // Use server-computed track position and direction directly.
    // When the server held this train (_serverHeld), lon/lat/trackPos are already
    // the held values — treating them as any other position (drift ≈ 0) means
    // no correction animation is triggered, which is exactly right.
    train._trackPos     = train._serverTrackPos     ? { ...train._serverTrackPos }     : (prev ? { ...prev._trackPos } : null);
    train._direction    = train._serverDirection    !== undefined ? train._serverDirection    : (prev ? prev._direction    : 1);
    train._effectiveDest = train._serverEffectiveDest !== undefined ? train._serverEffectiveDest : (prev ? prev._effectiveDest : train.destNm);

    if (!train._trackPos) continue;

    train.lon = train._trackPos.lon;
    train.lat = train._trackPos.lat;

    if (prev && prev._animLon !== undefined) {
      const drift = geoDist(prev._animLon, prev._animLat, train.lon, train.lat);

      if (drift < CORRECTION_SNAP_THRESHOLD && drift > 1e-7) {
        // Set up smooth correction path (purely visual — server already validated position)
        train._corrToTrackPos   = { ...train._trackPos };
        train._corrFromTrackPos = prev._trackPos
          ? { ...prev._trackPos }
          : snapToTrackPosition(prev._animLon, prev._animLat, segs);

        // Determine correction direction empirically
        const toPos    = train._corrToTrackPos;
        const testStep = Math.max(drift * 0.1, 1e-5);
        const fwdTest  = advanceOnTrack(train._corrFromTrackPos, testStep, +1, segs);
        const bwdTest  = advanceOnTrack(train._corrFromTrackPos, testStep, -1, segs);
        const fwdDist  = geoDist(fwdTest.lon, fwdTest.lat, toPos.lon, toPos.lat);
        const bwdDist  = geoDist(bwdTest.lon, bwdTest.lat, toPos.lon, toPos.lat);
        if (Math.abs(fwdDist - bwdDist) < testStep * 0.5) {
          train._corrDirection = train._direction;
        } else {
          train._corrDirection = fwdDist <= bwdDist ? 1 : -1;
        }

        train._corrTotalDist = trackDistanceBetween(
          train._corrFromTrackPos, train._corrToTrackPos, train._corrDirection, segs
        );

        // Path validation — ensure correction doesn't take a detour (e.g. around the Loop)
        const _corrPathEnd = advanceOnTrack(
          train._corrFromTrackPos, train._corrTotalDist, train._corrDirection, segs,
          { targetLon: toPos.lon, targetLat: toPos.lat }
        );
        let _pvPathValid = geoDist(_corrPathEnd.lon, _corrPathEnd.lat, toPos.lon, toPos.lat) <= drift * 0.5;
        if (!_pvPathValid) {
          const altDir  = train._corrDirection * -1;
          const altDist = trackDistanceBetween(train._corrFromTrackPos, toPos, altDir, segs);
          const altEnd  = advanceOnTrack(
            train._corrFromTrackPos, altDist, altDir, segs,
            { targetLon: toPos.lon, targetLat: toPos.lat }
          );
          if (geoDist(altEnd.lon, altEnd.lat, toPos.lon, toPos.lat) <= drift * 0.5) {
            train._corrDirection = altDir;
            train._corrTotalDist = altDist;
            _pvPathValid = true;
            console.log(`[CTA] Path validation: rn=${train.rn} (${train.legend}) flipped correction dir to ${altDir > 0 ? '+1' : '-1'}, drift=${(drift * 111000).toFixed(0)}m`);
          } else {
            console.warn(`[CTA] Path validation failed: rn=${train.rn} (${train.legend}) drift=${(drift * 111000).toFixed(0)}m — snapping`);
          }
        }

        if (_pvPathValid) {
          train._correcting   = true;
          train._corrStartTime = now;
          train.lon = train._corrFromTrackPos.lon;
          train.lat = train._corrFromTrackPos.lat;
        }

        // Clear legacy hold counters — server manages these now
        train._backwardHoldCount    = 0;
        train._forwardHoldCount     = 0;
        train._stationJumpHoldCount = 0;

      } else if (drift >= CORRECTION_SNAP_THRESHOLD) {
        // Large jump — snap directly (server already confirmed validity via its own hold logic)
        console.warn(`[CTA] Snap: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${(drift * 111000).toFixed(0)}m`);
        train._backwardHoldCount    = 0;
        train._forwardHoldCount     = 0;
        train._stationJumpHoldCount = 0;
      }
    }

    // _nearStation no longer used for hold logic; server tracks it.
    // Still useful for display — keep the field but set lazily.
    train._nearStation = null;

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

