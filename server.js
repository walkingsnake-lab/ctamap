const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const CTA_KEY = '9e15fcfa75064b6db8ad034db11ea214';
const CTA_BASE = 'http://lapi.transitchicago.com/api/1.0/ttpositions.aspx';
const CTA_FOLLOW = 'http://lapi.transitchicago.com/api/1.0/ttfollow.aspx';
const ROUTES = ['red', 'blue', 'brn', 'G', 'org', 'P', 'pink', 'Y'];

// ---- Server-side constants (duplicated from js/config.js) ----
// Keep in sync with the frontend; extract to shared/constants.js when adding SQLite.

const ROUTE_TO_LEGEND = {
  red: 'RD', blue: 'BL', brn: 'BR', G: 'GR',
  org: 'OR', P: 'PR', pink: 'PK', Y: 'YL'
};

const LINE_NAME_TO_LEGEND = {
  'Red': 'RD', 'Blue': 'BL', 'Brown': 'BR', 'Green': 'GR',
  'Orange': 'OR', 'Pink': 'PK', 'Purple': 'PR', 'Yellow': 'YL'
};

const BRANCH_SUFFIXES = [
  'Ravenswood', "O'Hare", 'North Main', 'Lake', 'Congress',
  'Douglas', 'Midway', 'Dan Ryan', 'South Elevated', 'Evanston',
  'Skokie', 'Homan',
];

const STATION_NAME_OVERRIDES = {
  'Quincy/Wells': 'Quincy',
  'Roosevelt/Wabash': 'Roosevelt',
  'Harold Washington Library-State/Van Buren': 'Library',
  'Harold Washington Library': 'Library',
};

const PHANTOM_STATION_RADIUS = 0.005; // degrees (~550m)

const KNOWN_PHANTOM_JUMPS = [
  { legend: 'PR', fromStations: ['Wilson', 'Jarvis'], toStations: ['South Blvd'],
    description: 'Purple Express Wilson/Jarvis → South Blvd phantom' },
  { legend: 'PR', fromStations: ['Wilson', 'Jarvis'], toStations: ['Howard'],
    description: 'Purple Express Wilson/Jarvis → Howard phantom' },
  { legend: 'BL', fromStations: ['Harlem', 'Cumberland'], toStations: ['Jefferson Park'],
    description: 'Blue Line Harlem/Cumberland → Jefferson Park phantom' },
  { legend: 'BL', fromStations: ['Jefferson Park', 'Cumberland'], toStations: ['Harlem'],
    description: 'Blue Line Jefferson Park/Cumberland → Harlem phantom' },
  { legend: 'BL', fromStations: ['Harlem'], toStations: ['Cumberland'],
    description: 'Blue Line Harlem → Cumberland phantom' },
  { legend: 'BL', fromStations: ['Cumberland'], toStations: ['Harlem'],
    description: 'Blue Line Cumberland → Harlem phantom' },
  { legend: 'BL', fromStations: ["O'Hare Airport"], toStations: ['Rosemont'],
    description: "Blue Line O'Hare → Rosemont phantom" },
  { legend: 'BL', fromStations: ['Rosemont'], toStations: ["O'Hare Airport"],
    description: "Blue Line Rosemont → O'Hare phantom" },
  { legend: 'GR', fromStations: ['35-Bronzeville-IIT'], toStations: ['Cottage Grove'],
    description: 'Green Line 35-Bronzeville-IIT → Cottage Grove phantom' },
  { legend: 'GR', fromStations: ['Cottage Grove'], toStations: ['35-Bronzeville-IIT'],
    description: 'Green Line Cottage Grove → 35-Bronzeville-IIT phantom' },
  { legend: 'GR', fromStations: ['35-Bronzeville-IIT', 'Cermak-McCormick Place'],
    toStations: ['Cottage Grove', 'King Drive'],
    description: 'Green Line 35th area → Cottage Grove branch phantom' },
  { legend: 'GR', fromStations: ['Roosevelt'], toStations: ['Cermak-McCormick Place'],
    description: 'Green Line Roosevelt → Cermak-McCormick Place phantom' },
  { legend: 'GR', fromStations: ['Cermak-McCormick Place'], toStations: ['Roosevelt'],
    description: 'Green Line Cermak-McCormick Place → Roosevelt phantom' },
  { legend: 'RD', fromStations: ['Fullerton'], toStations: ['North/Clybourn'],
    description: 'Red Line Fullerton → North/Clybourn phantom' },
  { legend: 'RD', fromStations: ['North/Clybourn'], toStations: ['Fullerton'],
    description: 'Red Line North/Clybourn → Fullerton phantom' },
  { legend: 'RD', fromStations: ['Loyola'], toStations: ['Wilson'],
    description: 'Red Line Loyola → Wilson phantom' },
  { legend: 'RD', fromStations: ['Wilson'], toStations: ['Loyola'],
    description: 'Red Line Wilson → Loyola phantom' },
  { legend: 'RD', fromStations: ['Roosevelt'], toStations: ['Cermak-Chinatown'],
    description: 'Red Line Roosevelt → Cermak-Chinatown phantom' },
  { legend: 'RD', fromStations: ['Cermak-Chinatown'], toStations: ['Roosevelt'],
    description: 'Red Line Cermak-Chinatown → Roosevelt phantom' },
  { legend: 'PK', fromStations: ['Polk'], toStations: ['Ashland'],
    description: 'Pink Line Polk → Ashland phantom' },
  { legend: 'PK', fromStations: ['Ashland'], toStations: ['Polk'],
    description: 'Pink Line Ashland → Polk phantom' },
  { legend: 'BR', fromStations: ['Sedgwick'], toStations: ['Chicago'],
    description: 'Brown Line Sedgwick → Chicago phantom' },
  { legend: 'BR', fromStations: ['Chicago'], toStations: ['Sedgwick'],
    description: 'Brown Line Chicago → Sedgwick phantom' },
  { legend: 'PR', fromStations: ['Sedgwick'], toStations: ['Chicago'],
    description: 'Purple Line Sedgwick → Chicago phantom' },
  { legend: 'PR', fromStations: ['Chicago'], toStations: ['Sedgwick'],
    description: 'Purple Line Chicago → Sedgwick phantom' },
];

// Pre-index phantom jumps by legend for O(1) lookup
const PHANTOM_JUMP_BY_LEGEND = new Map();
for (const rule of KNOWN_PHANTOM_JUMPS) {
  if (!PHANTOM_JUMP_BY_LEGEND.has(rule.legend)) PHANTOM_JUMP_BY_LEGEND.set(rule.legend, []);
  PHANTOM_JUMP_BY_LEGEND.get(rule.legend).push(rule);
}

// ---- Phase 2: SQLite schema (not yet active) ----
// When ready, install better-sqlite3 and create these tables:
//
// CREATE TABLE positions (
//   id INTEGER PRIMARY KEY AUTOINCREMENT,
//   rn TEXT NOT NULL,
//   legend TEXT NOT NULL,
//   lat REAL NOT NULL,
//   lon REAL NOT NULL,
//   heading INTEGER,
//   next_sta_nm TEXT,
//   dest_nm TEXT,
//   is_sch TEXT,
//   polled_at INTEGER NOT NULL  -- unix ms, same for all trains in one batch
// );
// CREATE INDEX idx_positions_rn_time ON positions(rn, polled_at);
//
// CREATE TABLE suspected_jumps (
//   id INTEGER PRIMARY KEY AUTOINCREMENT,
//   rn TEXT NOT NULL,
//   legend TEXT NOT NULL,
//   from_lat REAL, from_lon REAL,
//   to_lat REAL, to_lon REAL,
//   from_station TEXT,
//   to_station TEXT,
//   distance REAL,           -- degrees
//   elapsed_s REAL,
//   jump_type TEXT,          -- 'teleport' | 'known_pattern'
//   jump_rule TEXT,          -- KNOWN_PHANTOM_JUMPS description
//   detected_at INTEGER NOT NULL
// );
// CREATE INDEX idx_jumps_legend ON suspected_jumps(legend);

// ---- Geometry helpers ----

/** Euclidean distance in degrees (good enough at Chicago's latitude). */
function geoDist(lon1, lat1, lon2, lat2) {
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---- Station extraction from GeoJSON ----
// Ported from js/path-follow.js buildUniqueStations + helpers.

function cleanStationName(name) {
  if (!name) return name;
  if (STATION_NAME_OVERRIDES[name]) return STATION_NAME_OVERRIDES[name];
  return name.replace(/\/(Dearborn|Franklin|State|Milwaukee)$/i, '');
}

function displayStationName(name) {
  for (const suffix of BRANCH_SUFFIXES) {
    if (name.endsWith('-' + suffix)) {
      return cleanStationName(name.slice(0, -(suffix.length + 1)));
    }
  }
  return cleanStationName(name);
}

function isInfrastructureName(name) {
  return /\b(junction|connector|tower|portal|yard|interlocking|wye)\b/i.test(name);
}

/**
 * Builds a spatial grid index over a stations array.
 * Cell size ~1.1 km (0.01 degrees).
 */
function buildStationIndex(stations) {
  const CELL = 0.01;
  const cells = new Map();
  for (const s of stations) {
    const cx = Math.floor(s.lon / CELL);
    const cy = Math.floor(s.lat / CELL);
    const k = cx + ',' + cy;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(s);
  }
  return { cells, CELL };
}

/**
 * Builds a deduplicated array of station objects from GeoJSON segment
 * descriptions.  Ported from js/path-follow.js buildUniqueStations.
 */
function buildServerStations(geojsonBuf) {
  const geojson = JSON.parse(geojsonBuf);
  const coordKey = (c) => c[0].toFixed(10) + ',' + c[1].toFixed(10);

  // Step 1: parse segments and build endpoint index
  const segments = [];
  for (const feature of geojson.features) {
    const desc = feature.properties.description || '';
    const match = desc.match(/^(.+?)\s+to\s+(.+)$/i);
    if (!match) continue;

    const coords = feature.geometry.coordinates;
    const line = feature.geometry.type === 'MultiLineString' ? coords[0] : coords;
    if (!line || line.length < 2) continue;

    const legends = [];
    const featureLegend = feature.properties.legend;
    if (featureLegend && featureLegend !== 'ML') legends.push(featureLegend);
    const linesProp = feature.properties.lines || '';
    for (const [lineName, code] of Object.entries(LINE_NAME_TO_LEGEND)) {
      if (linesProp.includes(lineName) && !legends.includes(code)) legends.push(code);
    }

    segments.push({
      nameA: match[1].trim(),
      nameB: match[2].trim(),
      start: line[0],
      end: line[line.length - 1],
      legends,
    });
  }

  // Map each unique endpoint coordinate to segment indices that use it
  const endpointMap = new Map();
  for (let i = 0; i < segments.length; i++) {
    for (const pt of [segments[i].start, segments[i].end]) {
      const key = coordKey(pt);
      if (!endpointMap.has(key)) endpointMap.set(key, []);
      endpointMap.get(key).push(i);
    }
  }

  // Step 2: resolve station coordinates via shared endpoints
  const stationCoord = new Map();
  const stationLegends = new Map();

  const recordStation = (name, coord, legends) => {
    if (isInfrastructureName(name)) return;
    if (!stationCoord.has(name)) {
      stationCoord.set(name, coord);
      stationLegends.set(name, new Set(legends));
    } else {
      for (const l of legends) stationLegends.get(name).add(l);
    }
  };

  // Pass 1: shared endpoints between adjacent segments
  for (const [, segIndices] of endpointMap) {
    if (segIndices.length < 2) continue;
    for (let i = 0; i < segIndices.length; i++) {
      for (let j = i + 1; j < segIndices.length; j++) {
        const si = segments[segIndices[i]];
        const sj = segments[segIndices[j]];
        const namesI = [si.nameA, si.nameB];
        const namesJ = new Set([sj.nameA, sj.nameB]);
        let sharedCoord = null;
        for (const ptI of [si.start, si.end]) {
          for (const ptJ of [sj.start, sj.end]) {
            if (coordKey(ptI) === coordKey(ptJ)) { sharedCoord = ptI; break; }
          }
          if (sharedCoord) break;
        }
        if (!sharedCoord) continue;
        for (const name of namesI) {
          if (namesJ.has(name)) {
            recordStation(name, sharedCoord, [...si.legends, ...sj.legends]);
          }
        }
      }
    }
  }

  // Pass 2: terminal stations — endpoint NOT shared with any other segment
  for (const seg of segments) {
    for (const name of [seg.nameA, seg.nameB]) {
      if (stationCoord.has(name) || isInfrastructureName(name)) continue;
      const startShared = endpointMap.get(coordKey(seg.start)).length > 1;
      const endShared = endpointMap.get(coordKey(seg.end)).length > 1;
      if (startShared && !endShared) recordStation(name, seg.end, seg.legends);
      else if (endShared && !startShared) recordStation(name, seg.start, seg.legends);
    }
  }

  const stations = Array.from(stationCoord.entries()).map(([name, coord]) => ({
    name: displayStationName(name),
    lon: coord[0],
    lat: coord[1],
    legends: Array.from(stationLegends.get(name)),
  }));
  stations._index = buildStationIndex(stations);
  return stations;
}

/**
 * Finds the nearest station name using spatial index ring expansion.
 */
function nearestStationName(lon, lat, stations, legend) {
  const idx = stations._index;
  if (!idx) {
    let bestName = null, bestDist = Infinity;
    for (const s of stations) {
      if (legend && !s.legends.includes(legend)) continue;
      const d = geoDist(lon, lat, s.lon, s.lat);
      if (d < bestDist) { bestDist = d; bestName = s.name; }
    }
    return bestName;
  }

  const { cells, CELL } = idx;
  const cx0 = Math.floor(lon / CELL);
  const cy0 = Math.floor(lat / CELL);
  let bestName = null, bestDist = Infinity;

  for (let r = 0; r <= 60; r++) {
    if (r > 0 && bestDist < (r - 1) * CELL) break;
    for (let dcx = -r; dcx <= r; dcx++) {
      for (let dcy = -r; dcy <= r; dcy++) {
        if (Math.abs(dcx) !== r && Math.abs(dcy) !== r) continue;
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

// ---- Server-side train tracking state ----

const POLL_INTERVAL = 30000;       // poll CTA API every 30s
const HISTORY_WINDOW = 20;         // positions to keep per train
const STALE_TRAIN_TTL = 300000;    // 5 min — prune trains not seen
const SNAP_THRESHOLD = 0.045;      // degrees (~3.9km) — teleport detection threshold

let currentTrains = null;          // latest enriched train list
let currentTrainsTime = 0;         // timestamp of last successful poll
let serverStations = null;         // station list with spatial index, built at startup

// Map<rn, { legend, lastSeen, positions: Array<{lon, lat, heading, destNm, nextStaNm, isSch, time, flags}> }>
const trainHistory = new Map();

// Running anomaly counters for /api/stats
const anomalyCounts = { teleport: 0, knownPattern: 0, total: 0 };

// ---- GeoJSON + station init ----

let geojsonCache = null;
fs.readFile(path.join(__dirname, 'data', 'cta-lines.geojson'), (err, buf) => {
  if (err) {
    console.error('Failed to pre-load GeoJSON:', err.message);
    return;
  }
  geojsonCache = buf;
  // Build station list for server-side phantom jump matching
  try {
    serverStations = buildServerStations(buf);
    console.log(`[Stations] Built ${serverStations.length} stations from GeoJSON`);
  } catch (e) {
    console.error('[Stations] Failed to build station list:', e.message);
  }
  // Start polling now that stations are ready
  pollTrains();
});

// ---- Anomaly detection ----

/**
 * Checks whether a position update matches a known phantom jump pattern.
 * Returns the matching rule, or null.
 */
function matchesKnownPhantomJump(legend, prevLon, prevLat, newLon, newLat) {
  if (!serverStations) return null;
  const rules = PHANTOM_JUMP_BY_LEGEND.get(legend);
  if (!rules) return null;

  for (const rule of rules) {
    const prevStation = nearestStationName(prevLon, prevLat, serverStations, legend);
    const newStation  = nearestStationName(newLon, newLat, serverStations, legend);
    if (!prevStation || !newStation) continue;

    const fromMatch = rule.fromStations.some(s => prevStation === s) &&
      serverStations.some(s => s.name === prevStation && geoDist(prevLon, prevLat, s.lon, s.lat) < PHANTOM_STATION_RADIUS);
    const toMatch = rule.toStations.some(s => newStation === s) &&
      serverStations.some(s => s.name === newStation && geoDist(newLon, newLat, s.lon, s.lat) < PHANTOM_STATION_RADIUS);
    if (fromMatch && toMatch) return rule;
  }
  return null;
}

/**
 * Detects anomalies between the current and previous position for a train.
 * Returns a flags object.
 */
function detectAnomalies(rn, legend, positions) {
  const flags = { phantomJump: false, jumpType: null, jumpDist: null, jumpRule: null, speed: null };
  if (positions.length < 2) return flags;

  const curr = positions[positions.length - 1];
  const prev = positions[positions.length - 2];
  const dist = geoDist(prev.lon, prev.lat, curr.lon, curr.lat);
  const dt = (curr.time - prev.time) / 1000;
  flags.speed = dt > 0 ? dist / dt : 0;
  flags.jumpDist = dist;

  // Level A: distance-based teleport detection
  if (dist > SNAP_THRESHOLD) {
    flags.phantomJump = true;
    flags.jumpType = 'teleport';
    anomalyCounts.teleport++;
    anomalyCounts.total++;
    console.log(`[Anomaly] Teleport rn=${rn} ${legend}: ${(dist * 111).toFixed(1)}km in ${dt.toFixed(0)}s`);
  }

  // Level B: known station-pair phantom jump matching
  if (!flags.phantomJump) {
    const rule = matchesKnownPhantomJump(legend, prev.lon, prev.lat, curr.lon, curr.lat);
    if (rule) {
      flags.phantomJump = true;
      flags.jumpType = 'known_pattern';
      flags.jumpRule = rule.description;
      anomalyCounts.knownPattern++;
      anomalyCounts.total++;
      console.log(`[Anomaly] Known phantom jump rn=${rn} ${legend}: ${rule.description}`);
    }
  }

  return flags;
}

// ---- Train processing ----

/**
 * Process a single raw train from the CTA API: accumulate history, detect anomalies,
 * return enriched train object with _flags.
 */
function processTrainUpdate(rawTrain, now) {
  const rn = rawTrain.rn;
  const legend = ROUTE_TO_LEGEND[rawTrain.rt] || rawTrain.rt;
  const lon = parseFloat(rawTrain.lon);
  const lat = parseFloat(rawTrain.lat);

  const posEntry = {
    lon, lat,
    heading: parseInt(rawTrain.heading, 10) || 0,
    destNm: rawTrain.destNm || '',
    nextStaNm: rawTrain.nextStaNm || '',
    isSch: rawTrain.isSch || '0',
    time: now,
  };

  let history = trainHistory.get(rn);
  if (!history) {
    history = { legend, lastSeen: now, positions: [] };
    trainHistory.set(rn, history);
  }
  history.legend = legend;
  history.lastSeen = now;
  history.positions.push(posEntry);
  if (history.positions.length > HISTORY_WINDOW) {
    history.positions.shift();
  }

  const flags = detectAnomalies(rn, legend, history.positions);
  posEntry.flags = flags;

  return {
    ...rawTrain,
    _legend: legend,
    _flags: flags,
    _historyLen: history.positions.length,
  };
}

/** Remove trains from history that haven't been seen in STALE_TRAIN_TTL. */
function pruneStaleTrains(now) {
  for (const [rn, history] of trainHistory) {
    if (now - history.lastSeen > STALE_TRAIN_TTL) {
      trainHistory.delete(rn);
    }
  }
}

// ---- Active polling loop ----

let pollPending = false;

async function pollTrains() {
  if (pollPending) return;
  pollPending = true;
  try {
    const rawTrains = await fetchAllTrains();
    const now = Date.now();

    const enriched = [];
    for (const t of rawTrains) {
      enriched.push(processTrainUpdate(t, now));
    }

    pruneStaleTrains(now);
    currentTrains = enriched;
    currentTrainsTime = now;
  } catch (err) {
    console.error('[Poll] CTA API error:', err.message);
    // Keep serving stale data
  }
  pollPending = false;
}

// Start polling loop — first poll fires after GeoJSON loads (see fs.readFile callback above).
// The interval keeps going regardless.
setInterval(pollTrains, POLL_INTERVAL);

// ---- Follow cache (unchanged) ----

const FOLLOW_CACHE_TTL = 5000;
const followCache = new Map();

async function getCachedFollow(rn) {
  const now = Date.now();
  const cached = followCache.get(rn);
  if (cached && now - cached.time < FOLLOW_CACHE_TTL) return cached.body;
  const followUrl = `${CTA_FOLLOW}?key=${CTA_KEY}&runnumber=${rn}&outputType=JSON`;
  const data = await fetchJSON(followUrl);
  const ctatt = data.ctatt;
  let body;
  if (!ctatt || (ctatt.errCd !== '0' && ctatt.errCd !== 0)) {
    body = JSON.stringify({ eta: null });
  } else {
    let etas = ctatt.eta || [];
    if (!Array.isArray(etas)) etas = [etas];
    body = JSON.stringify({ eta: etas, position: ctatt.position || null });
  }
  followCache.set(rn, { body, time: Date.now() });
  return body;
}

// ---- HTTP helpers ----

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Fetch JSON from an HTTP URL using Node's built-in http module. */
function fetchJSON(fetchUrl) {
  return new Promise((resolve, reject) => {
    http.get(fetchUrl, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(chunks.join('')));
        } catch (e) {
          reject(new Error('Invalid JSON from CTA API'));
        }
      });
    }).on('error', reject);
  });
}

/** Fetch train positions for all routes in parallel, return combined array. */
async function fetchAllTrains() {
  const results = await Promise.allSettled(
    ROUTES.map(async (route) => {
      const fetchUrl = `${CTA_BASE}?key=${CTA_KEY}&rt=${route}&outputType=JSON`;
      const data = await fetchJSON(fetchUrl);
      return { route, data };
    })
  );

  const trains = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { route, data } = result.value;
    const ctatt = data.ctatt;
    if (!ctatt || (ctatt.errCd !== '0' && ctatt.errCd !== 0)) continue;

    let routeData = ctatt.route;
    if (!routeData) continue;
    if (!Array.isArray(routeData)) routeData = [routeData];

    for (const r of routeData) {
      let trainList = r.train;
      if (!trainList) continue;
      if (!Array.isArray(trainList)) trainList = [trainList];
      trains.push(...trainList.map((t) => ({ ...t, rt: route })));
    }
  }

  return trains;
}

// ---- HTTP server ----

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  // Serve bundled CTA line geometry GeoJSON (served from memory cache)
  if (parsed.pathname === '/api/geojson') {
    if (!geojsonCache) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GeoJSON not ready yet' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(geojsonCache);
    return;
  }

  // Train positions — serves latest poll result with _flags enrichment
  if (parsed.pathname === '/api/trains') {
    if (!currentTrains) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Train data not ready yet — first poll pending' }));
      return;
    }
    const body = JSON.stringify({ trains: currentTrains });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
    return;
  }

  // Train position history — rolling window for a specific run number
  if (parsed.pathname.startsWith('/api/train-history/')) {
    const rn = parsed.pathname.split('/').pop();
    if (!rn || !/^\d+$/.test(rn)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid run number' }));
      return;
    }
    const history = trainHistory.get(rn);
    if (!history) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No history for this run number' }));
      return;
    }
    const body = JSON.stringify({
      rn,
      legend: history.legend,
      lastSeen: history.lastSeen,
      positions: history.positions,
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(body);
    return;
  }

  // Server stats — poll info, anomaly counts, active trains
  if (parsed.pathname === '/api/stats') {
    const body = JSON.stringify({
      activeTrains: trainHistory.size,
      lastPollTime: currentTrainsTime,
      pollInterval: POLL_INTERVAL,
      historyWindow: HISTORY_WINDOW,
      stationsLoaded: serverStations ? serverStations.length : 0,
      anomalies: { ...anomalyCounts },
      uptime: process.uptime(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(body);
    return;
  }

  // Follow a specific train run (ETAs for upcoming stops)
  if (parsed.pathname.startsWith('/api/train/')) {
    const rn = parsed.pathname.split('/').pop();
    if (!rn || !/^\d+$/.test(rn)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid run number' }));
      return;
    }
    try {
      const body = await getCachedFollow(rn);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch (e) {
      console.error('CTA Follow API error:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch train details' }));
    }
    return;
  }

  // Static file serving
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(__dirname, filePath);

  // Prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    // Bundle is content-hashed via esbuild; HTML must revalidate to pick up new bundles.
    const cacheHeader = (ext === '.js' && filePath.includes('dist'))
      ? 'public, max-age=31536000, immutable'
      : ext === '.html' ? 'no-cache'
      : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheHeader });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`CTA Map server running at http://localhost:${PORT}`);
  console.log(`Polling CTA API every ${POLL_INTERVAL / 1000}s`);
});
