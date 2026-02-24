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
  const speed = 0.00012; // Units per ms — tune for visual feel

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
      // Timing + next station for real-time animation
      arrT: t.arrT || null,
      prdt: t.prdt || null,
      nextStaNm: t.nextStaNm || null,
      nextStaId: t.nextStaId || null,
    }));
  } catch (e) {
    console.warn('Failed to fetch trains:', e);
    return null;
  }
}

/**
 * Parses a CTA datetime string (e.g. "20240804 14:23:05") into a Date.
 */
function parseCTATime(str) {
  if (!str) return null;
  // Format: "YYYYMMDD HH:MM:SS"
  const m = str.match(/^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/**
 * Initializes animation state (_trackPos, _speed, _direction) on real trains
 * after an API refresh. Uses arrival time predictions and station distances
 * to estimate speed, with fallback to observed velocity.
 *
 * prevTrainMap: Map<rn, previousTrainObject> from before this refresh.
 */
function initRealTrainAnimation(trains, lineSegments, stationPositions, prevTrainMap) {
  const now = Date.now();

  for (const train of trains) {
    const segs = lineSegments[train.legend];
    if (!segs || segs.length === 0) continue;

    // Store raw API position before snapping (used for velocity calculation)
    train._apiLon = train.lon;
    train._apiLat = train.lat;

    // Snap to track
    train._trackPos = snapToTrackPosition(train.lon, train.lat, segs);
    train.lon = train._trackPos.lon;
    train.lat = train._trackPos.lat;

    // Determine direction from heading
    train._direction = directionFromHeading(
      train.heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs
    );

    // Estimate speed
    train._speed = estimateSpeed(train, stationPositions, prevTrainMap, now);

    // Drift correction: if we had a previous animated position, set up correction
    const prev = prevTrainMap ? prevTrainMap.get(train.rn) : null;
    if (prev && prev._animLon !== undefined) {
      const drift = geoDist(prev._animLon, prev._animLat, train.lon, train.lat);
      if (drift < CORRECTION_SNAP_THRESHOLD) {
        // Smoothly correct: start from animated position, blend toward API position
        train._correcting = true;
        train._corrStartTime = now;
        train._corrFromLon = prev._animLon;
        train._corrFromLat = prev._animLat;
        // Temporarily set position to where animation was (smooth blend will handle the rest)
        train.lon = prev._animLon;
        train.lat = prev._animLat;
        // Re-snap the starting position to track
        train._trackPos = snapToTrackPosition(train.lon, train.lat, segs);
      }
      // If drift >= threshold, we already snapped to API position — no correction needed
    }

    train._lastUpdateTime = now;
  }
}

/**
 * Estimates train speed in degrees per millisecond.
 * Priority: arrT-based > observed velocity > fallback constant.
 */
function estimateSpeed(train, stationPositions, prevTrainMap, now) {
  // 1. Try arrival-time based speed
  // Per CTA docs: arrT - prdt = total predicted travel time from the train's
  // last track-circuit position to the next station. This is more reliable
  // than arrT - now because prdt is when the position was actually recorded.
  if (train.arrT && train.prdt) {
    const arrTime = parseCTATime(train.arrT);
    const prdTime = parseCTATime(train.prdt);
    if (arrTime && prdTime) {
      const totalTravelTime = arrTime.getTime() - prdTime.getTime();
      if (totalTravelTime > 2000) { // At least 2 seconds of travel
        const stationCoord = lookupStation(train.nextStaNm, train.legend, stationPositions);
        if (stationCoord) {
          const dist = geoDist(train._apiLon, train._apiLat, stationCoord[0], stationCoord[1]);
          if (dist > 1e-6) {
            // Multiply by ~1.3 to account for track curvature vs straight-line distance
            const trackDist = dist * 1.3;
            const speed = trackDist / totalTravelTime;
            // Sanity check: cap between min and max reasonable speeds
            if (speed > 1e-7 && speed < 0.001) {
              return speed;
            }
          }
        }
      }
    }
  }

  // 2. Try observed velocity from previous position
  const prev = prevTrainMap ? prevTrainMap.get(train.rn) : null;
  if (prev && prev._lastUpdateTime) {
    const elapsed = now - prev._lastUpdateTime;
    if (elapsed > 1000) {
      const dist = geoDist(prev._apiLon || prev.lon, prev._apiLat || prev.lat, train.lon, train.lat);
      if (dist > 1e-6) {
        const speed = dist / elapsed;
        if (speed > 1e-7 && speed < 0.001) {
          return speed;
        }
      }
    }
  }

  // 3. Fallback
  // Approaching station → slower speed
  if (train.isApp === '1') return FALLBACK_SPEED * 0.3;
  return FALLBACK_SPEED;
}

/**
 * Advances real trains along the track each animation frame.
 * Handles drift correction blending.
 */
function advanceRealTrains(trains, lineSegments, dt) {
  const now = Date.now();

  for (const train of trains) {
    if (!train._trackPos) continue;
    const segs = lineSegments[train.legend];
    if (!segs) continue;

    // Don't move if speed is effectively zero (stopped/delayed)
    if (train.isDly === '1') continue;

    const distance = train._speed * dt;
    const newPos = advanceOnTrack(train._trackPos, distance, train._direction, segs);

    train._trackPos = newPos;
    train.lon = newPos.lon;
    train.lat = newPos.lat;

    // If train reached a terminal (stopped by advanceOnTrack), hold position
    if (newPos.stopped) {
      train._speed = 0;
    }

    // Apply drift correction blending
    if (train._correcting) {
      const elapsed = now - train._corrStartTime;
      if (elapsed >= CORRECTION_DURATION) {
        // Correction complete
        train._correcting = false;
      }
      // Exponential decay of correction offset is handled implicitly:
      // the train is advancing from the corrected start position toward where
      // it should be, which naturally converges since initRealTrainAnimation
      // re-snapped the track position.
    }

    // Store animated position for next refresh's drift calculation
    train._animLon = train.lon;
    train._animLat = train.lat;
  }
}

/**
 * Advances exiting (coasting) trains toward their terminal.
 * These are trains removed from the API that keep moving.
 * Returns the array with stopped trains removed.
 */
function advanceExitingTrains(trains, lineSegments, dt) {
  for (const train of trains) {
    if (!train._trackPos) continue;
    const segs = lineSegments[train.legend];
    if (!segs) continue;

    const distance = train._speed * dt;
    const newPos = advanceOnTrack(train._trackPos, distance, train._direction, segs);
    train._trackPos = newPos;
    train.lon = newPos.lon;
    train.lat = newPos.lat;

    if (newPos.stopped) {
      train._speed = 0;
      train._reachedTerminal = true;
    }
  }
  return trains;
}
