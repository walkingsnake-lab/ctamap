/**
 * Generates realistic dummy train positions by sampling points along GeoJSON line geometries.
 */
function generateDummyTrains(geojson) {
  const trains = [];
  let runNum = 100;

  // For each colored line, collect its segments and sample train positions
  const lineConfigs = [
    { legend: 'RD', count: 12, dest: ['Howard', '95th/Dan Ryan'] },
    { legend: 'BL', count: 14, dest: ['O\'Hare', 'Forest Park'] },
    { legend: 'BR', count: 8,  dest: ['Kimball', 'Loop'] },
    { legend: 'GR', count: 8,  dest: ['Harlem/Lake', 'Ashland/63rd', 'Cottage Grove'] },
    { legend: 'OR', count: 6,  dest: ['Midway', 'Loop'] },
    { legend: 'PK', count: 6,  dest: ['54th/Cermak', 'Loop'] },
    { legend: 'PR', count: 5,  dest: ['Linden', 'Howard', 'Loop'] },
    { legend: 'YL', count: 2,  dest: ['Skokie', 'Howard'] },
  ];

  for (const cfg of lineConfigs) {
    // Collect all coordinates from features matching this line
    const coords = collectLineCoords(geojson, cfg.legend);
    if (coords.length === 0) continue;

    // Also include ML segments for lines that traverse the Loop
    const mlCoords = ['BR', 'OR', 'PK', 'PR', 'GR'].includes(cfg.legend)
      ? collectLineCoords(geojson, 'ML')
      : [];

    const allCoords = coords.concat(mlCoords);

    for (let i = 0; i < cfg.count; i++) {
      // Pick a random segment and random position along it
      const seg = allCoords[Math.floor(Math.random() * allCoords.length)];
      if (seg.length < 2) continue;

      const idx = Math.floor(Math.random() * (seg.length - 1));
      const t = Math.random();
      const lon = seg[idx][0] + t * (seg[idx + 1][0] - seg[idx][0]);
      const lat = seg[idx][1] + t * (seg[idx + 1][1] - seg[idx][1]);

      // Heading from segment direction
      const dlon = seg[idx + 1][0] - seg[idx][0];
      const dlat = seg[idx + 1][1] - seg[idx][1];
      const heading = Math.round(((Math.atan2(dlon, dlat) * 180 / Math.PI) + 360) % 360);

      trains.push({
        route: LEGEND_TO_ROUTE[cfg.legend],
        legend: cfg.legend,
        lat, lon, heading,
        rn: String(runNum++),
        destNm: cfg.dest[Math.floor(Math.random() * cfg.dest.length)],
        isApp: Math.random() < 0.15 ? '1' : '0',
        isDly: Math.random() < 0.05 ? '1' : '0',
        // Animation state for dummy movement
        _segCoords: seg,
        _segIdx: idx,
        _segT: t,
        _direction: Math.random() < 0.5 ? 1 : -1,
      });
    }
  }

  return trains;
}

/**
 * Collects all coordinate arrays from GeoJSON features matching a legend code.
 * Returns array of line-strings (each is an array of [lon, lat] pairs).
 */
function collectLineCoords(geojson, legend) {
  const coords = [];
  for (const feature of geojson.features) {
    if (feature.properties.legend !== legend) continue;
    const geom = feature.geometry;
    if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) {
        coords.push(line);
      }
    } else if (geom.type === 'LineString') {
      coords.push(geom.coordinates);
    }
  }
  return coords;
}

/**
 * Advances dummy trains along their segments for animation.
 * Call this on each animation frame.
 */
function advanceDummyTrains(trains, geojson, dt) {
  const speed = 1.2e-7; // degrees/ms — ~30mph for visual feel

  for (const train of trains) {
    if (!train._segCoords) continue;

    const seg = train._segCoords;
    train._segT += speed * dt * train._direction;

    // Move to next/prev point in the segment
    if (train._segT >= 1) {
      train._segT = 0;
      train._segIdx += 1;
      if (train._segIdx >= seg.length - 1) {
        // Reverse direction at end of segment
        train._segIdx = seg.length - 2;
        train._direction = -1;
        train._segT = 1;
      }
    } else if (train._segT <= 0) {
      train._segT = 1;
      train._segIdx -= 1;
      if (train._segIdx < 0) {
        train._segIdx = 0;
        train._direction = 1;
        train._segT = 0;
      }
    }

    const idx = train._segIdx;
    const t = train._segT;
    train.lon = seg[idx][0] + t * (seg[idx + 1][0] - seg[idx][0]);
    train.lat = seg[idx][1] + t * (seg[idx + 1][1] - seg[idx][1]);
  }
}

/**
 * Fetches real train positions from the CTA API via the server-side proxy.
 * The proxy fetches all routes in parallel and returns a combined response.
 * Falls back to dummy data when API_KEY is not set.
 */
async function fetchTrains() {
  if (!API_KEY) {
    return null; // Caller should use dummy trains
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
function initRealTrainAnimation(trains, lineSegments, prevTrainMap) {
  const now = Date.now();

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
      console.log(`[CTA] isSch=1: rn=${train.rn} (${train.legend}) @ ${train._apiLat.toFixed(5)},${train._apiLon.toFixed(5)}`);
    }

    // Drift correction: smoothly slide from old visual position to new API position
    const prev = prevTrainMap ? prevTrainMap.get(train.rn) : null;

    // Preserve previously validated direction rather than re-deriving from the unreliable
    // CTA heading field (some lines, e.g. Yellow/Orange loop exit, report wrong headings).
    // Fall back to heading-based detection only for brand-new trains with no prior state.
    if (prev && prev._direction !== undefined) {
      train._direction = prev._direction;
    } else {
      train._direction = directionFromHeading(
        train.heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs
      );
    }

    if (prev && prev._animLon !== undefined) {
      const drift = geoDist(prev._animLon, prev._animLat, train.lon, train.lat);

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
        console.warn(`[CTA] Hold: rn=${train.rn} isSch=1, drift=${(drift * 111000).toFixed(0)}m — holding at circuit-confirmed position`);
      } else if (drift < CORRECTION_SNAP_THRESHOLD && drift > 1e-7) {
        // Save the API-snapped target (where the train should end up)
        train._corrToTrackPos = { ...train._trackPos };
        // Use prev's maintained track position (avoids re-snapping to wrong segment)
        train._corrFromTrackPos = prev._trackPos
          ? { ...prev._trackPos }
          : snapToTrackPosition(prev._animLon, prev._animLat, segs);

        // Determine correction direction empirically: test one step in each
        // direction from the old position and pick whichever gets closer to target
        const toPos = train._corrToTrackPos;
        const testStep = Math.max(drift * 0.1, 1e-5);
        const fwdTest = advanceOnTrack(train._corrFromTrackPos, testStep, +1, segs);
        const bwdTest = advanceOnTrack(train._corrFromTrackPos, testStep, -1, segs);
        const fwdDist = geoDist(fwdTest.lon, fwdTest.lat, toPos.lon, toPos.lat);
        const bwdDist = geoDist(bwdTest.lon, bwdTest.lat, toPos.lon, toPos.lat);
        train._corrDirection = fwdDist <= bwdDist ? 1 : -1;

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
          train._corrFromTrackPos, train._corrTotalDist, train._corrDirection, segs
        );
        if (geoDist(_corrPathEnd.lon, _corrPathEnd.lat, toPos.lon, toPos.lat) > drift * 0.5) {
          train._direction = directionFromHeading(
            train.heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs
          );
          // Leave _correcting = false — train stays at API-snapped position.
        } else {
          train._correcting = true;
          train._corrStartTime = now;
          // Set current visual position to the from track position
          train.lon = train._corrFromTrackPos.lon;
          train.lat = train._corrFromTrackPos.lat;

          // Suspect-move confirmation: hold and require BACKWARD_CONFIRM_POLLS consecutive
          // agreeing polls before committing to either:
          //   (a) a backward correction (against _direction) — likely a phantom-forward glitch
          //       that is now being "corrected" back, or a real but unconfirmed reversal.
          //   (b) a forward correction faster than any CTA train can physically travel
          //       (drift > FORWARD_PLAUSIBLE_DIST, implying >130 km/h) — almost always a
          //       phantom position injected by the schedule-projection system without isSch=1.
          const isSuspectBackward = train._corrDirection !== train._direction;
          const isSuspectForward  = !isSuspectBackward && drift > FORWARD_PLAUSIBLE_DIST;

          if (isSuspectBackward) {
            train._forwardHoldCount = 0;
            train._backwardHoldCount = (prev._backwardHoldCount || 0) + 1;
            if (train._backwardHoldCount < BACKWARD_CONFIRM_POLLS) {
              train._correcting = false;
              train._trackPos = { ...prev._trackPos };
              train.lon = prev._animLon;
              train.lat = prev._animLat;
              console.log(`[CTA] Backward hold: rn=${train.rn} [${train._backwardHoldCount}/${BACKWARD_CONFIRM_POLLS}] drift=${(drift * 111000).toFixed(0)}m`);
            } else {
              console.log(`[CTA] Backward confirmed: rn=${train.rn} after ${train._backwardHoldCount} polls, drift=${(drift * 111000).toFixed(0)}m`);
            }
          } else if (isSuspectForward) {
            train._backwardHoldCount = 0;
            train._forwardHoldCount = (prev._forwardHoldCount || 0) + 1;
            if (train._forwardHoldCount < BACKWARD_CONFIRM_POLLS) {
              train._correcting = false;
              train._trackPos = { ...prev._trackPos };
              train.lon = prev._animLon;
              train.lat = prev._animLat;
              console.log(`[CTA] Fast-forward hold: rn=${train.rn} [${train._forwardHoldCount}/${BACKWARD_CONFIRM_POLLS}] drift=${(drift * 111000).toFixed(0)}m`);
            } else {
              console.log(`[CTA] Fast-forward confirmed: rn=${train.rn} after ${train._forwardHoldCount} polls, drift=${(drift * 111000).toFixed(0)}m`);
            }
          } else {
            train._backwardHoldCount = 0;
            train._forwardHoldCount = 0;
          }
        }
      } else if (drift >= CORRECTION_SNAP_THRESHOLD) {
        console.warn(`[CTA] Snap: rn=${train.rn} drift=${(drift * 111000).toFixed(0)}m — too far to interpolate`);
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
        const finalPos = advanceOnTrack(
          train._corrFromTrackPos, train._corrTotalDist, train._corrDirection, segs
        );
        train._trackPos = finalPos;
        train.lon = finalPos.lon;
        train.lat = finalPos.lat;
        // finalPos.direction reflects any flip from crossing a segment boundary
        // (e.g. exiting the ML loop onto the own Orange segment where ±1 reverses),
        // so it is more reliable than _corrDirection for the post-correction state.
        //
        // However, only update _direction when the correction was going forward
        // (i.e. _corrDirection matches the train's established travel direction).
        // When we corrected backward — because the CTA API reported a position too
        // far ahead (e.g. Purple Express snap to Wilson that then corrects back
        // toward Howard, or a Red Line train prematurely placed at Howard) —
        // keeping the backward correction direction would flip the arrows to face
        // the wrong way.  In that case, leave _direction as the preserved value
        // set during initRealTrainAnimation.
        if (train._corrDirection === train._direction) {
          train._direction = finalPos.direction !== undefined ? finalPos.direction : train._corrDirection;
        }
      } else {
        // Smoothstep easing: accelerate then decelerate
        const t = elapsed / duration;
        const eased = t * t * (3 - 2 * t);
        const pos = advanceOnTrack(
          train._corrFromTrackPos, eased * train._corrTotalDist, train._corrDirection, segs
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

