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
    _serverTrackPos:        t.trackPos,      // snapped position — used in initRealTrainAnimation
    _serverDirection:       t.direction,     // derived direction — skips client cascade
    _serverEffectiveDest:   t.effectiveDest,
    _serverHeld:            t.held,          // if true, server is holding at this position
    _serverHeldReason:      t.heldReason,
    _serverHoldCount:       t.holdCount      || 0,
    _serverHoldMax:         t.holdMax        || 0,
    _serverDirectionMethod: t.directionMethod || 'prev',
    _serverRetiring:        t.retiring        || false,
    _serverRetireElapsedMs: t.retireElapsedMs || 0,
  }));
}

/**
 * Initializes animation state (_trackPos, _direction) on real trains after an API refresh.
 * The server has already applied snapping, direction inference, and all hold logic.
 * This function only sets up the smooth visual correction animation (client-only concern).
 *
 * prevTrainMap: Map<rn, previousTrainObject> from before this refresh.
 */
function initRealTrainAnimation(trains, lineSegments, prevTrainMap, stations, lineNeighborMaps) {
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

      } else if (drift >= CORRECTION_SNAP_THRESHOLD) {
        // Large jump — snap directly (server already confirmed validity via its own hold logic)
        console.warn(`[CTA] Snap: rn=${train.rn} (${train.legend}→${train.destNm || '?'}) ${(drift * 111000).toFixed(0)}m`);
      }
    }

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

