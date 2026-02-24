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

    // Determine direction from heading
    train._direction = directionFromHeading(
      train.heading, train._trackPos.segIdx, train._trackPos.ptIdx, segs
    );

    // Drift correction: smoothly slide from old visual position to new API position
    const prev = prevTrainMap ? prevTrainMap.get(train.rn) : null;
    if (prev && prev._animLon !== undefined) {
      const drift = geoDist(prev._animLon, prev._animLat, train.lon, train.lat);
      if (drift < CORRECTION_SNAP_THRESHOLD && drift > 1e-7) {
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
        train._correcting = true;
        train._corrStartTime = now;
        // Set current visual position to the from track position
        train.lon = train._corrFromTrackPos.lon;
        train.lat = train._corrFromTrackPos.lat;
      } else if (drift >= CORRECTION_SNAP_THRESHOLD) {
        console.warn(`[CTA] Snap: rn=${train.rn} drift=${(drift * 111000).toFixed(0)}m — too far to interpolate`);
      }
    }
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
    if (train._correcting) {
      const elapsed = now - train._corrStartTime;
      if (elapsed >= CORRECTION_DURATION) {
        // Correction complete — snap to target and sit still until next refresh
        train._correcting = false;
        train._trackPos = train._corrToTrackPos;
        train.lon = train._corrToTrackPos.lon;
        train.lat = train._corrToTrackPos.lat;
      } else {
        // Smoothstep easing: accelerate then decelerate
        const t = elapsed / CORRECTION_DURATION;
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

