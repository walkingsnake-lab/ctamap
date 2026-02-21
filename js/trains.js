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
 * Fetches real train positions from the CTA API.
 * Falls back to dummy data when API_KEY is not set.
 */
async function fetchTrains(geojson) {
  if (!API_KEY) {
    return null; // Caller should use dummy trains
  }

  const allTrains = [];

  for (const route of API_ROUTES) {
    try {
      const url = `${API_BASE}?key=${API_KEY}&rt=${route}&outputType=JSON`;
      const data = await d3.json(url);
      const ctatt = data.ctatt;

      if (ctatt.errCd !== '0' && ctatt.errCd !== 0) continue;

      const routeData = ctatt.route;
      if (!routeData) continue;

      // routeData may be an array or single object
      const routes = Array.isArray(routeData) ? routeData : [routeData];

      for (const r of routes) {
        let trainList = r.train;
        if (!trainList) continue;
        if (!Array.isArray(trainList)) trainList = [trainList];

        const legend = ROUTE_TO_LEGEND[route];
        for (const t of trainList) {
          allTrains.push({
            route,
            legend,
            lat: parseFloat(t.lat),
            lon: parseFloat(t.lon),
            heading: parseInt(t.heading, 10),
            rn: t.rn,
            destNm: t.destNm,
            isApp: t.isApp,
            isDly: t.isDly,
          });
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch trains for route ${route}:`, e);
    }
  }

  return allTrains;
}
