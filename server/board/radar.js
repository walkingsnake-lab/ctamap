'use strict';
// Radar frames for the board (design spec §7, contract "Radar"): NOAA MRMS
// lowest-elevation composite reflectivity from the Iowa Environmental
// Mesonet archive, cropped around each board's station and reduced to a
// 64x32 indexed frame.
//
// Pipeline per frame: stream-decode only the rows around the station
// (radar-png.js) -> palette index to dBZ -> average linear reflectivity per
// LED block -> levels (rain or snow) -> despeckle -> location marker.
// Memory: one source frame is decoded at a time and never held; each
// processed frame is 2048 bytes.

const https = require('https');
const { decodeRows } = require('./radar-png');

const BASE = 'https://mesonet.agron.iastate.edu/archive/data';
const W = 64, H = 32;
const KM_PER_LED = 1.5 * 1.609344;      // ~1.5 mi per LED
const SPLIT_W = 39;                      // radar width in the split layout: cols 0-38, gray divider at 39, time panel 40-63
const SPLIT_TIME_BOX = [40, 0, W - 40, H];
// Full-width layout: the time stack sits top-right over open water. The
// box must be all water: 24 cols (22px time + margin) x 22 rows (stack on
// rows 2-19 + margin). Built per station by scripts/build-locations.js.
const FULL_TIME_BOX = [40, 0, 24, 22];
const SHORE = 6;
// Loop slots (IEM's archive only has frames at even minutes): the latest
// 6-minute time expected to exist and the 6-minute slots before it, 30
// minutes end to end. Each 6-minute step adds exactly one new frame and
// drops the oldest, so the board downloads one frame per step.
const STEP = 360;
const LOOP = 6;                          // frames in the loop
const KEEP = 8;                          // frames kept per location (a late frame doesn't evict a slot)
const ON_PX = 30, OFF_PX = 10;           // radar.on hysteresis (colored px); provisional

const RAIN_DBZ = [15, 25, 35, 45, 55];   // -> values 1..5
const SNOW_DBZ = [10, 15, 20];   // -> values 8..10 (provisional; the Feb 2, 2022 storm averaged 11-18 dBZ)
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const FREEZING_CODES = new Set([56, 57, 66, 67]);
const MARKER = 7;

// Palette index -> linear reflectivity Z. IEM mrms_lcref: dBZ = index * 0.5
// - 32 for 0..254; 255 is missing. Indices up to 65 (<= 0.5 dBZ) are drawn
// black by IEM and count as no echo.
const Z = new Float64Array(256);
for (let i = 66; i < 255; i++) Z[i] = Math.pow(10, (i * 0.5 - 32) / 10);
const dbzOf = (index) => (index === 255 ? null : index * 0.5 - 32);

// "YYYYMMDDHHMM" (UTC) for an epoch second.
const stampOf = (t) => new Date(t * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 12);
const timeOf = (stamp) => Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12)) / 1000;
const frameUrl = (stamp, ext) => `${BASE}/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp.slice(6, 8)}/GIS/mrms/lcref_${stamp}.${ext}`;

// ESRI world file: x scale, 2 rotations, y scale, then the center of the
// top-left pixel. (IEM's older files give -130.0/55.0, newer -129.995/54.995.)
function parseWld(text) {
  const v = String(text).trim().split(/\s+/).map(Number);
  if (v.length < 6 || v.some((x) => !Number.isFinite(x)) || !v[0] || !v[3]) throw new Error('bad world file');
  return { dx: v[0], dy: v[3], x0: v[4], y0: v[5] };
}

// Lat/lon of an LED's center, for a station on the marker LED. Same math as
// geometry() below, used by scripts/build-locations.js for the water masks.
function ledCenter(lat, lon, x, y, width = W) {
  const mx = Math.floor(width / 2), my = Math.floor(H / 2);
  const degLon = KM_PER_LED / (111.32 * Math.cos(lat * Math.PI / 180));
  const degLat = KM_PER_LED / 111.32;
  return [lon + (x - mx) * degLon, lat - (y - my) * degLat];
}

// Per-station layout and masks (server/board/locations/<mapid>.json), or
// the split layout without masks when a station has no file.
const locCache = new Map();
function hexRows(rows, width) {
  const out = new Uint8Array(width * H);
  rows.forEach((hex, y) => { for (let x = 0; x < width; x++) if ((parseInt(hex[x >> 2], 16) >> (3 - (x & 3))) & 1) out[y * width + x] = 1; });
  return out;
}
function loadLocation(mapid) {
  if (locCache.has(mapid)) return locCache.get(mapid);
  let loc = { split: true, width: SPLIT_W, timeBox: SPLIT_TIME_BOX, water: null, shore: null };
  try {
    const j = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'locations', `${mapid}.json`), 'utf8'));
    loc = { split: j.split, width: j.width, timeBox: j.timeBox, water: hexRows(j.water, j.width), shore: hexRows(j.shore, j.width) };
  } catch (e) { /* no file: split layout, no masks */ }
  locCache.set(mapid, loc);
  return loc;
}

// Which source pixels feed which LED, for a station at lat/lon. The station
// lands on the marker LED (center of the radar area). Each source pixel goes
// to the LED block containing its center.
function geometry(wld, lat, lon, width = W) {
  const colsPer = KM_PER_LED / (wld.dx * 111.32 * Math.cos(lat * Math.PI / 180));
  const rowsPer = KM_PER_LED / (Math.abs(wld.dy) * 111.32);
  const sx = (lon - wld.x0) / wld.dx, sy = (lat - wld.y0) / wld.dy;
  const mx = Math.floor(width / 2), my = Math.floor(H / 2);
  const left = sx - (mx + 0.5) * colsPer, top = sy - (my + 0.5) * rowsPer;
  const x0 = Math.ceil(left), x1 = Math.ceil(left + width * colsPer) - 1;
  const y0 = Math.ceil(top), y1 = Math.ceil(top + H * rowsPer) - 1;
  const ledCol = new Int16Array(x1 - x0 + 1);
  for (let c = x0; c <= x1; c++) ledCol[c - x0] = Math.min(width - 1, Math.floor((c - left) / colsPer));
  const ledRow = (y) => Math.min(H - 1, Math.floor((y - top) / rowsPer));
  return { width, mx, my, x0, x1, y0, y1, ledCol, ledRow, colsPer, rowsPer };
}

// Accumulates one location's crop as rows stream by.
function accumulator(geo) {
  const sum = new Float64Array(geo.width * H), cnt = new Uint16Array(geo.width * H);
  return {
    geo,
    row(y, row) {
      const base = geo.ledRow(y) * geo.width;
      for (let c = geo.x0; c <= geo.x1; c++) {
        const k = base + geo.ledCol[c - geo.x0];
        sum[k] += Z[row[c]];
        cnt[k] += 1;
      }
    },
    // Mean dBZ per LED (-Infinity where there's no echo).
    dbz() {
      const out = new Float64Array(geo.width * H);
      for (let k = 0; k < out.length; k++) out[k] = cnt[k] && sum[k] > 0 ? 10 * Math.log10(sum[k] / cnt[k]) : -Infinity;
      return out;
    },
  };
}

// Whole-frame rain/snow decision from the location's current weather
// (contract "Snow mode"). w: parsed Open-Meteo (weather.js) or null.
function modeFor(w) {
  if (!w) return 'rain';
  if (SNOW_CODES.has(w.code)) return 'snow';
  if (w.temp <= 32 && !FREEZING_CODES.has(w.code)) return 'snow';
  return 'rain';
}

const isPrecip = (v) => (v >= 1 && v <= 5) || (v >= 8 && v <= 10);

// Mean dBZ grid -> the 2048-byte frame: levels, water masked, despeckle,
// shoreline, marker. The time box is not cleared: the shoreline (and rain)
// draw under the time stack. loc: loadLocation() result (masks
// are on the crop's grid). Returns { bytes, colored }.
function toFrame(dbz, geo, mode, loc = null) {
  const levels = mode === 'snow' ? SNOW_DBZ : RAIN_DBZ;
  const first = mode === 'snow' ? 8 : 1;
  const w = geo.width;
  const lv = new Uint8Array(w * H);
  for (let k = 0; k < lv.length; k++) {
    let n = 0;
    while (n < levels.length && dbz[k] >= levels[n]) n++;
    lv[k] = n ? first + n - 1 : 0;
    if (loc && loc.water && loc.water[k]) lv[k] = 0; // water is masked black
  }
  // Despeckle: drop precip pixels with fewer than 2 precip neighbors.
  const out = new Uint8Array(W * H);
  let colored = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
    const v = lv[y * w + x];
    if (!v) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < H && lv[yy * w + xx]) n++;
    }
    if (n >= 2) { out[y * W + x] = v; colored++; }
  }
  // Shoreline: the lake's edge pixels (water side), always drawn. Water is
  // masked, so rain never covers it.
  if (loc && loc.shore) {
    for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) if (loc.shore[y * w + x]) out[y * W + x] = SHORE;
  }
  // Location marker: a white dot. The pixels around it keep their precip.
  const m = geo.my * W + geo.mx;
  if (isPrecip(out[m])) colored--;
  out[m] = MARKER;
  return { bytes: out, colored };
}

// Decode one source frame for several locations at once.
// locs: [{ key, lat, lon, width }]. Returns Map key -> dBZ grid + geometry.
async function crops(png, wld, locs) {
  const accs = locs.map((l) => ({ key: l.key, acc: accumulator(geometry(wld, l.lat, l.lon, l.width)) }));
  const y0 = Math.min(...accs.map((a) => a.acc.geo.y0));
  const y1 = Math.max(...accs.map((a) => a.acc.geo.y1));
  await decodeRows(png, {
    y0, y1,
    onRow: (y, row) => { for (const a of accs) if (y >= a.acc.geo.y0 && y <= a.acc.geo.y1) a.acc.row(y, row); },
  });
  return new Map(accs.map((a) => [a.key, { dbz: a.acc.dbz(), geo: a.acc.geo }]));
}

// ---- network ----

function get(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, headers: { 'User-Agent': 'ctamap-board (github.com/walkingsnake-lab/ctamap)' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        const e = new Error(`HTTP ${res.statusCode}`);
        e.status = res.statusCode;
        return reject(e);
      }
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchFrame(stamp) {
  const wldRes = await get(frameUrl(stamp, 'wld'));
  const chunks = [];
  for await (const c of wldRes) chunks.push(c);
  const wld = parseWld(Buffer.concat(chunks).toString('utf8'));
  return { wld, png: await get(frameUrl(stamp, 'png')) };
}

// ---- frame store and poller ----

// A stalled download must not block the poller forever (it runs one fetch
// at a time).
const FRAME_TIMEOUT_MS = 60000;
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Keeps processed frames per station for the stations boards are showing.
// One source frame is fetched per pass (newest missing first, then the rest
// of the loop), and only while a board has asked recently.
function createRadar({
  fetch = fetchFrame,
  weather = null,          // weather.js poller, for snow mode
  now = () => Date.now() / 1000,
  lag = 120,               // s before a frame is expected in the archive
  retry = 120,             // s before retrying a missing frame
  idle = 120,              // s without a board request before polling stops
  tick = 20000,            // ms between passes
  frameTimeoutMs = FRAME_TIMEOUT_MS,
  log = console,
} = {}) {
  const locs = new Map();     // mapid -> { lat, lon, wantedAt, frames: Map(stamp -> frame), on }
  const missing = new Map();  // stamp -> retry-after time
  let timer = null, busy = null;

  // Loop slots, oldest first, ending at the latest 6-minute time expected
  // to exist.
  function slots() {
    const newest = Math.floor((now() - lag) / STEP) * STEP;
    return Array.from({ length: LOOP }, (_, i) => newest - (LOOP - 1 - i) * STEP).map(stampOf);
  }

  async function processStamp(stamp, wanted) {
    const { wld, png } = await fetch(stamp);
    const list = wanted.map(([key, l]) => ({ key, lat: l.lat, lon: l.lon, width: loadLocation(key).width }));
    const out = await crops(png, wld, list);
    for (const [key, l] of wanted) {
      const w = weather ? await weather.get(l.lat, l.lon, { wait: 0 }).catch(() => null) : null;
      const mode = modeFor(w);
      const { dbz, geo } = out.get(key);
      const f = toFrame(dbz, geo, mode, loadLocation(key));
      l.frames.set(stamp, { id: `${key}-${stamp}${mode === 'snow' ? 's' : ''}`, t: timeOf(stamp), mode, ...f });
      // Keep the newest KEEP frames.
      const old = [...l.frames.keys()].sort().slice(0, -KEEP);
      for (const s of old) l.frames.delete(s);
    }
  }

  async function pass() {
    if (busy) return busy;
    const run = (async () => {
      try {
        const t = now();
        const active = [...locs.entries()].filter(([, l]) => t - l.wantedAt <= idle);
        if (!active.length) return;
        const want = slots();
        // Newest slot first, then backfill.
        for (const stamp of [...want].reverse()) {
          if ((missing.get(stamp) || 0) > t) continue;
          const lacking = active.filter(([, l]) => !l.frames.has(stamp));
          if (!lacking.length) continue;
          try {
            await withTimeout(processStamp(stamp, lacking), frameTimeoutMs, `radar ${stamp}`);
            missing.delete(stamp);
          } catch (e) {
            missing.set(stamp, t + retry);
            if (e.status !== 404) log.error(`[board] radar ${stamp} failed: ${e.message}`);
          }
          break; // one source frame per pass
        }
        for (const [s, until] of missing) if (until < t - 3600) missing.delete(s);
      } catch (e) {
        log.error('[board] radar pass failed:', e && e.stack ? e.stack : e);
      }
    })();
    // Clear after assigning: a pass with nothing to do finishes synchronously,
    // and clearing inside it ran before `busy` was set, which left the poller
    // stuck "busy" forever (radar froze after the first slot missing from the
    // archive).
    busy = run;
    run.then(() => { if (busy === run) busy = null; });
    return run;
  }

  return {
    // Marks the station wanted and returns the payload's `radar` object.
    want(mapid, lat, lon) {
      if (!locs.has(mapid)) locs.set(mapid, { lat, lon, wantedAt: 0, frames: new Map(), on: false });
      const l = locs.get(mapid);
      l.wantedAt = now();
      const oldest = timeOf(slots()[0]);
      const frames = [...l.frames.values()].filter((f) => f.t >= oldest).sort((a, b) => a.t - b.t);
      const latest = frames[frames.length - 1];
      if (!latest) l.on = false;
      else if (latest !== l.judged) {
        // Hysteresis on the newest frame's precip pixel count.
        if (!l.on && latest.colored >= ON_PX) l.on = true;
        else if (l.on && latest.colored < OFF_PX) l.on = false;
        l.judged = latest;
      }
      const loc = loadLocation(mapid);
      return { on: l.on, frames: frames.map((f) => f.id), ft: frames.map((f) => f.t), timeBox: loc.timeBox, split: loc.split };
    },
    // A kept frame's bytes for this station, or null.
    frame(mapid, id) {
      const l = locs.get(mapid);
      if (!l) return null;
      for (const f of l.frames.values()) if (f.id === id) return f.bytes;
      return null;
    },
    pass,
    slots,
    start() {
      if (!timer) {
        timer = setInterval(() => { pass(); }, tick);
        timer.unref();
      }
      return this;
    },
    stop() { clearInterval(timer); timer = null; },
  };
}

// A frame packed for the board: two pixels a byte, the left one in the high
// nibble (values are 0-10). 1024 bytes instead of 2048, so the board's
// frame buffers take half the memory (and the download is half the size).
function packFrame(bytes) {
  const out = new Uint8Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (bytes[2 * i] << 4) | bytes[2 * i + 1];
  return out;
}

module.exports = { packFrame,
  parseWld, geometry, accumulator, modeFor, toFrame, crops, createRadar, fetchFrame,
  ledCenter, loadLocation, stampOf, timeOf, frameUrl, dbzOf, W, H, SPLIT_W, SPLIT_TIME_BOX, FULL_TIME_BOX, SHORE, ON_PX, OFF_PX, RAIN_DBZ, SNOW_DBZ, MARKER,
};
