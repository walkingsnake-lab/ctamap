'use strict';
// LED board router. server.js hands every /board/* request here; nothing
// else in the app knows about the board. API: docs/board/contract.md.

const crypto = require('crypto');
const { createStore, ValidationError, resolveDir, knobOf, CLOCK_FACES } = require('./state');
const { createTracker } = require('./tracker');
const { format } = require('./arrivals');
const { stationDestinations } = require('./destinations');
const { createWeather, inUnit, toWx, toScreenWx, rainLine, toDays, toHours, toRain, testRain, TEST_RAIN, testWeather, TEST_WX, autoBright, NIGHT_BRIGHT } = require('./weather');
const { boardAlertLines } = require('./cta-alerts');
const { createNws, pickWarn } = require('./nws');
const { createNwsForecast, withForecast } = require('./nws-forecast');
const { createRadar, packFrame } = require('./radar');
const { createTestRadar } = require('./test-radar');
const { createMlb, prioritize } = require('./mlb');
const { createLogos } = require('./mlb-logos');
const { createKeys } = require('./keys');
const { createFirmware, FirmwareError, CHANNELS: FW_CHANNELS, MAX_BYTES: MAX_FIRMWARE } = require('./firmware');
const { team } = require('./teams');
const { tzOffset } = require('./time');
const { toSkyline } = require('./skyline');
const { sunPos, sunTime, subsolar } = require('./sun');
const { stripBytes } = require('./clouds');
const fs = require('fs');
const path = require('path');
const { render, assets, autoScreen, messageLayout } = require('./render');

const SIM_HTML = fs.readFileSync(path.join(__dirname, 'sim.html'));
const CONTROL_HTML = fs.readFileSync(path.join(__dirname, 'control.html'));
const DRAW_JS = fs.readFileSync(path.join(__dirname, 'draw.js'));
// Set up a board (maker's page only): the shared setup code, and the
// flashing and QR tools bundled by build.js (absent until npm run build).
const SETUP_IMAGE_JS = fs.readFileSync(path.join(__dirname, 'setup-image.js'));
const SETUP_TOOLS_FILE = path.join(__dirname, '..', '..', 'dist', 'setup-tools.min.js');
const SIM_ASSETS = JSON.stringify(assets());
// The control page's picker tiles (scripts/build-control-tiles.js).
const CONTROL_TILES = fs.readFileSync(path.join(__dirname, 'control-tiles.json'));

const MAX_BODY = 8 * 1024;
// Arrivals older than this are stale (red top edge, NO DATA when none are left).
const STALE_S = 180;
// Board endpoint names; the control path must not collide with them.
const RESERVED = new Set(['ping', 'version', 'update', 'select', 'radar', 'sky', 'logo', 'firmware', 'firmware-upload', 'c']);
// What a per-board control link (/board/c/<link>/) may reach: the control
// page and simulator for its own board. Owner-only endpoints (the board
// list's add/delete/copy, keys, firmware builds, logo uploads, raw captures)
// answer 404 there.
const SCOPED_OK = new Set(['', 'api/destinations', 'api/rain', 'api/boards', 'api/boards/link', 'api/boards/transfer', 'api/health', 'api/state', 'api/update', 'api/stations', 'api/test', 'sim', 'draw.js', 'sim-assets.json', 'sim.png', 'tiles.json']);
// Settings a per-board link may not change: the update channel (a buyer
// stays on stable, or turns updates off).
const SCOPED_FW = ['stable', 'off'];
const MAX_SHEET = 8 * 1024 * 1024; // uploaded logo sheet (PNG)

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// The board's /board/update carries only what one screen draws (contract:
// "Sections"): less JSON to parse on a heap that fragments. `for` names that
// screen: the payload's `screen`, or `s` when a button press overrides it.
// radar rides along whole on the weather screen and whenever timed visits
// are on (the board switches to it by itself) or the weather screen takes
// a turn in the Cycle; otherwise only `on`. While Cycle takes turns (rot),
// every one of its screens' sections ride along. The simulator's copy
// (api/update) stays whole.
const SCREENS = ['transit', 'ticker', 'weather', 'baseball', 'clock', 'announce'];
const SECTIONS = {
  transit: ['header', 'key', 'hidden', 'view', 'rows', 'wx'],
  ticker: ['ticker', 'tickerHeader', 'tickerFill'],
  baseball: ['mlb'],
  weather: [],
  clock: ['skyline', 'cface', 'cwx', 'dn', 'ginv'],
  announce: ['msg'],
};
function sectionsFor(body, screen) {
  const out = { ...body, for: screen };
  const keep = new Set([screen, ...(body.rot && body.rot.screens.includes(screen) ? body.rot.screens : [])]);
  for (const [sc, keys] of Object.entries(SECTIONS)) if (!keep.has(sc)) for (const k of keys) delete out[k];
  if (!keep.has('weather') && body.radar && !body.radar.visit) out.radar = { on: body.radar.on, visit: null };
  return out;
}

function sendFrame(res, bytes) {
  if (!bytes) return send(res, 404, { err: 'unknown_frame' });
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'max-age=3600, immutable' });
  res.end(Buffer.from(bytes));
}

function sendLogo(res, bytes) {
  if (!bytes) return send(res, 404, { err: 'unknown_logo' });
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'max-age=86400, immutable' });
  res.end(Buffer.from(bytes));
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new ValidationError('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sameSecret(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new ValidationError('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new ValidationError('body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

const nowSecs = () => Math.floor(Date.now() / 1000);

function createBoard({
  store = createStore(),
  token = process.env.BOARD_TOKEN || '',
  controlPath = process.env.BOARD_CONTROL_PATH || '',
  capture = require('./capture'),
  tracker = null,
  weather = null,
  nws = null,
  nwsForecast = null,
  radar = null,
  mlb = null,
  keys = null,    // per-board tokens and control links (keys.js); default beside the board state
  logos = null,   // prepared team logos (mlb-logos.js); default beside the board state
  firmware = null, // OTA builds (firmware.js); default beside the board state
  deployToken = process.env.FIRMWARE_DEPLOY_TOKEN || '', // CI's token for /board/firmware-upload (beta only)
  alerts = null, // the shared CTA alerts poller (server.js); none in tests unless given
  stations = require('./stations.json'),
  log = console,
} = {}) {
  if (!token) log.warn('[board] BOARD_TOKEN not set; board endpoints are unauthenticated');
  if (!controlPath) log.warn('[board] BOARD_CONTROL_PATH not set; control endpoints are disabled');
  if (controlPath && (RESERVED.has(controlPath) || controlPath.includes('/'))) {
    log.error('[board] BOARD_CONTROL_PATH collides with a board endpoint or contains "/"; control endpoints are disabled');
    controlPath = '';
  }

  const stationById = new Map(stations.map((st) => [st.mapid, st]));
  const stationList = JSON.stringify(stations
    .map(({ mapid, name, desc, short, lines }) => ({ mapid, name, desc, short, lines }))
    .sort((a, b) => a.desc.localeCompare(b.desc)));
  // Simulator preview settings from the query: mapid, header=0|1, weather=0|1,
  // rtime=0|1 (radar corner: frame time or temperature), bblayout=classic|logos|bands (baseball layout).
  function previewOf(q) {
    const mapid = String(q.mapid || '');
    if (mapid && !stationById.has(mapid)) return { err: `unknown mapid: ${mapid}` };
    const flag = (v) => (v === '1' ? true : v === '0' ? false : null);
    const lg = ['classic', 'logos', 'bands'].includes(q.bblayout) ? q.bblayout : null;
    return { mapid, showHeader: flag(q.header), showWeather: flag(q.weather), radarTime: flag(q.rtime), baseballLayout: lg };
  }
  if (!keys) keys = createKeys({ dir: path.dirname(store.file), log });
  // A board with its own key (keys.js) must send that token; the others,
  // the shared BOARD_TOKEN (or nothing, when it isn't set).
  const authed = (req, id) => {
    const own = keys.check(String(id || ''), req.headers['x-board-token']);
    if (own !== null) return own;
    return !token || sameSecret(req.headers['x-board-token'], token);
  };
  // Baseball (MLB Stats API: personal, non-commercial use only) is for the
  // maker's own boards. A board with its own key (one set up for someone
  // else) gets no baseball screen, takeover, games, logos, or settings.
  const sportsOn = (id) => !keys.has(String(id || '')) || keys.mine(String(id || ''));
  const SPORTS_FIELDS = ['baseballLayout', 'bbTeams', 'bbPre', 'bbFinal', 'bbPriority', 'gameEvery', 'logoBright'];
  function checkSportsPatch(id, patch) {
    if (sportsOn(id) || !patch || typeof patch !== 'object') return;
    if (patch.screen === 'baseball' || SPORTS_FIELDS.some((k) => patch[k] !== undefined)) {
      throw new ValidationError('baseball is not available on this board');
    }
  }
  if (!tracker) tracker = createTracker({ log }).start();
  if (!weather) weather = createWeather({ log, cacheFile: path.join(path.dirname(store.file), 'board-weather.json') }).start();
  if (!nws) nws = createNws({ log }).start();
  if (!nwsForecast) nwsForecast = createNwsForecast({ log, cacheFile: path.join(path.dirname(store.file), 'board-nws-forecast.json') }).start();
  if (!radar) radar = createRadar({ weather, log }).start();
  const testRadar = createTestRadar();
  if (!mlb) mlb = createMlb({ log }).start();
  if (!logos) logos = createLogos({ dir: resolveDir(log), log });
  if (!firmware) firmware = createFirmware({ dir: path.dirname(store.file), log });
  // Builds boards are pinned to (state `fw`): never pruned or deleted.
  const pinnedBuilds = () => store.ids().map((id) => store.get(id).fw).filter((f) => f && !FW_CHANNELS.includes(f) && f !== 'off');

  // Logo and band layouts: each side gets its band color (the logo's, or the
  // team color) and, in the logo layout, its logo id (fetched once by the
  // board). The board dims both by mlb.dim.
  function withLogos(g, useLogos) {
    const side = (s) => {
      let l = null;
      try { l = logos.get(s.ab); } catch (e) { log.error('[board] logos:', e.message); }
      return { ...s, lg: l && useLogos ? l.id : null, bd: l ? l.band : s.c || '#8f8f8f' };
    };
    return { ...g, away: side(g.away), home: side(g.home) };
  }

  // 'auto' brightness: full from sunrise to sunset (and until weather data
  // arrives), the board's brightMin overnight. A board with a light sensor
  // follows the sensor instead, from brightMin in the dark to full (`ab`).
  const nightOf = (b) => b.brightMin || NIGHT_BRIGHT;
  const resolveBright = (b, w, now) => (b.bright === 'off' ? 0 : b.bright === 'auto' ? autoBright(w, now, nightOf(b)) : b.bright);
  const autoBrightOf = (b) => (b.bright === 'auto' ? { min: nightOf(b) } : null);
  // 'auto' is the Cycle: the first of its screens this board can draw; the
  // board takes turns through them (rot) itself. Nothing takes it over
  // (ballgames and the NWS alert jump are retired).
  const cycleOf = (b, caps, sports) => (Array.isArray(b.cycle) ? b.cycle : ['transit', 'weather'])
    .filter((sc) => canDraw(sc, caps) && (sc !== 'baseball' || sports));
  const resolveScreen = (b, cyc) => (b.screen === 'auto' ? cyc[0] || 'transit' : b.screen);
  const rotOf = (b, screen, cyc) => (b.screen === 'auto' && cyc.length > 1 && cyc.includes(screen)
    ? { screens: cyc, every: b.autoEvery || 60 } : null);
  // Speed settings (contract "anim"): ms, baseball rotation in s.
  const animOf = (b) => ({
    pageHold: (b.tickerHold || 8) * 1000, slide: b.tickerSlide || 1200,
    radarFrame: b.radarFrame || 500, radarHold: (b.radarHold || 4) * 1000, game: b.gameEvery || 60,
  });
  // Rain nearby (radar.visit): on any chosen screen but weather, if turned
  // on and not held off from the phone (holds); `always` visits even
  // without rain (current conditions).
  // Holds (state `rainHold`, kept across restarts): {until} ("Back to
  // <screen> now", or the board's knob: no visit until the next one is due)
  // or {rain: true} ("Stop until the rain passes": none until the radar box
  // is dry). The board picks the change up with its next update.
  const holdOf = (id, b, now, raining) => {
    const h = b.rainHold;
    if (!h) return null;
    if (h.rain ? raining : now < h.until) return h.rain ? 'rain' : 'visit';
    try { store.setRainHold(id, null); } catch (e) { log.error('[board] rain hold:', e.message); }
    return null;
  };
  const visitOf = (b) => (b.screen !== 'weather' && (b.wxVisit === 'rain' || b.wxVisit === 'always') && b.radarEvery > 0
    ? { every: b.radarEvery * 60, for: Math.min(b.radarFor || 60, b.radarEvery * 60), ...(b.wxVisit === 'always' ? { always: true } : {}) } : null);
  const NO_RADAR = { on: false, frames: [], ft: [], timeBox: null, split: false };

  // Test alerts, set from the simulator: fake major CTA alerts on some lines
  // and/or a fake NWS warning, merged into this board's updates (so the real
  // board shows them too) until they expire. Memory only.
  const TEST_S = 600;
  const LINES = ['RD', 'BL', 'BR', 'GR', 'OR', 'PR', 'PK', 'YL'];
  const tests = new Map(); // board id -> { lines, warn, until }
  function activeTest(id, now) {
    const t = tests.get(id);
    if (t && t.until > now) return t;
    tests.delete(id);
    return null;
  }
  // Test game (simulator): a made-up Cubs game in one state, shown first.
  const GAME_STATES = ['pre', 'live', 'final'];
  function testGame(st, now) {
    const g = { id: 0, st, start: now - 3600, away: { ...team(112), r: 3, w: 92, l: 70 }, home: { ...team(138), r: 2, w: 88, l: 74 } };
    if (st === 'pre') return { ...g, start: now + 25 * 60, away: { ...g.away, r: 0 }, home: { ...g.home, r: 0 } };
    if (st === 'final') return { ...g, away: { ...g.away, w: 93 }, home: { ...g.home, l: 75 } };
    return { ...g, inn: 7, half: 'T', b: 2, s: 1, o: 2, on: [1, 0, 1] };
  }
  // Test times of day (simulator): the sun's elevation (degrees) and whether
  // it's rising (1) or setting (-1), or solar noon / midnight. The skyline
  // face draws its sky, sun, moon and lights for that moment of today; the
  // clock still shows the real time.
  const TEST_TOD = { day: ['max'], sunrise: [1, 1], golden: [6, -1], sunset: [1, -1], dusk: [-3, -1], twilight: [-6, -1], night: ['min'] };
  // The moment `tod` stands for, near `now`, at a station (now if the sun
  // never gets there, e.g. a 'golden' hour in polar winter; not in Chicago).
  function testSkyNow(tod, st, now) {
    const [target, dir] = TEST_TOD[tod] || [];
    return (target != null && sunTime(now, st.lat, st.lon, target, dir)) || now;
  }
  function validateTest(body) {
    if (!body || typeof body !== 'object') throw new ValidationError('body must be an object');
    const lines = body.lines == null ? [] : body.lines;
    if (!Array.isArray(lines) || !lines.every((l) => LINES.includes(l))) throw new ValidationError(`lines must be codes from ${LINES.join(' ')}`);
    const warn = body.warn == null ? null : body.warn;
    if (warn && !(['svr', 'tor'].includes(warn.kind) && ['watch', 'warning'].includes(warn.lvl))) {
      throw new ValidationError('warn must be {kind: svr|tor, lvl: watch|warning}');
    }
    const game = body.game == null ? null : body.game;
    if (game && !GAME_STATES.includes(game)) throw new ValidationError(`game must be one of ${GAME_STATES.join(', ')}`);
    const rad = body.radar == null ? null : body.radar;
    if (rad && !testRadar.KINDS.includes(rad)) throw new ValidationError(`radar must be one of ${testRadar.KINDS.join(', ')}`);
    const bars = body.bars == null ? null : body.bars;
    if (bars && !Object.keys(TEST_RAIN).includes(bars)) throw new ValidationError(`bars must be one of ${Object.keys(TEST_RAIN).join(', ')}`);
    const wb = body.weather == null ? null : body.weather;
    if (wb != null && typeof wb !== 'object') throw new ValidationError('weather must be {kind, tod}');
    const kind = wb && wb.kind != null ? wb.kind : null, tod = wb && wb.tod != null ? wb.tod : null;
    if (kind != null && !Object.keys(TEST_WX).includes(kind)) throw new ValidationError(`weather.kind must be one of ${Object.keys(TEST_WX).join(', ')}`);
    if (tod != null && !Object.keys(TEST_TOD).includes(tod)) throw new ValidationError(`weather.tod must be one of ${Object.keys(TEST_TOD).join(', ')}`);
    return { lines: [...new Set(lines)], warn: warn && { kind: warn.kind, lvl: warn.lvl }, game, radar: rad, bars, weather: kind || tod ? { kind, tod } : null };
  }

  // `preview` (simulator only): {mapid, showHeader, showWeather} shown
  // without changing the board's config. The board's row list is
  // station-specific, so it's ignored while previewing another station.
  // Board health, sent with the version check about once a minute
  // (contract: /board/version). In memory only: it's a live view.
  const healthOf = new Map(); // board id -> latest report + history bits
  const HEALTH_FIELDS = { hu: 'uptime', hm: 'memFree', hl: 'largestBlock', ho: 'oom', hb: 'budget', hf: 'fails', hr: 'reconnects', hw: 'rssi', ha: 'lux' };
  function noteHealth(id, q, now) {
    if (q.hu == null) return;
    const h = { at: now };
    for (const [k, name] of Object.entries(HEALTH_FIELDS)) {
      const n = Number(q[k]);
      if (q[k] != null && Number.isFinite(n)) h[name] = n;
    }
    const safe = (v) => typeof v === 'string' && /^[A-Za-z0-9_:]{1,64}$/.test(v);
    if (safe(q.he)) h.lastError = q.he;
    if (safe(q.hs)) h.started = q.hs;
    if (safe(q.hd)) h.hardware = q.hd;
    if (safe(q.hv)) h.firmware = q.hv;
    if (safe(q.hx)) h.ota = q.hx;
    // The newest WiFi wipe the board has applied (keys.transfer's stamp).
    if (q.hz != null && Number.isFinite(Number(q.hz))) {
      h.wiped = Number(q.hz);
      keys.applied(id, h.wiped);
    }
    const prev = healthOf.get(id);
    // A stable board hears no offer outside the overnight window, so it stops
    // reporting a rolled-back (or unsigned) build all day: keep the last such
    // note while that build is still the one this board should get.
    if (!h.ota && prev && /^(rolledback|unsigned|nokey):/.test(prev.ota || '')) {
      const b = store.get(id);
      const t = b ? firmware.target(b.fw || 'stable') : null;
      if (t && prev.ota.split(':')[1] === t.v && h.firmware !== t.v) h.ota = prev.ota;
    }
    // What the firmware can draw beyond the original screens, colon-separated
    // (`skyline`: the clock screen's skyline face). Sent with every report.
    if (safe(q.hk)) h.caps = q.hk.split(':');
    // The crash that ended a run, sent by the run after it. Kept after
    // later restarts that weren't crashes, until another crash replaces it.
    if (safe(q.hc)) h.lastCrash = q.hc;
    else if (prev && prev.lastCrash) h.lastCrash = prev.lastCrash;
    h.minMem = Math.min(h.memFree ?? Infinity, prev ? prev.minMem : Infinity);
    if (!Number.isFinite(h.minMem)) delete h.minMem;
    // Uptime going backwards means the board restarted (crash reload, watchdog, power).
    h.restarts = (prev ? prev.restarts : 0) + (prev && h.uptime < prev.uptime ? 1 : 0);
    h.lastRestart = prev && h.uptime < prev.uptime ? now - h.uptime : prev ? prev.lastRestart : null;
    h.since = prev ? prev.since : now;
    healthOf.set(id, h);
  }

  // The clock screen needs firmware that draws it. The S3 says so on every
  // update and select (`hk=skyline`), so each request decides for itself:
  // no flapping after a server restart (health lives in memory) or when
  // another board under the same ID reports without it. Health's `hk` is
  // the fallback for the simulator and control page. Others get transit
  // instead, and no CLOCK on the knob's ring.
  // Each other face works the same way (`hk=skyline:seventies:analog:daynight:gradient`);
  // a board without the chosen face gets the skyline face.
  const capOk = (id, q, cap) => {
    if (typeof q.hk === 'string' && q.hk.split(':').includes(cap)) return true;
    const h = healthOf.get(id);
    return !!(h && h.caps && h.caps.includes(cap));
  };
  const clockOk = (id, q = {}) => capOk(id, q, 'skyline');
  // The announce screen likewise (`hk=...:announce`); others get transit.
  const announceOk = (id, q = {}) => capOk(id, q, 'announce');
  const canDraw = (screen, caps) => (screen === 'clock' ? caps.clock : screen === 'announce' ? caps.announce : true);
  const forBoard = (body, caps) => (canDraw(body.screen, caps) ? body : { ...body, screen: 'transit' });
  // caps.face(name): whether the firmware draws that clock face.
  // `peek` (`hk=...:peek`): the firmware draws the peek chooser, so it gets
  // every screen's sections and every variant's data (`pv`).
  const capsOf = (id, q = {}) => ({ clock: clockOk(id, q), announce: announceOk(id, q), face: (f) => capOk(id, q, f), peek: capOk(id, q, 'peek') });

  // The announce screen's message as the board draws it (draw.js
  // messageLayout: the lines for its style), or null when none is set.
  function msgOf(board) {
    if (!board.msg) return null;
    try {
      const lay = messageLayout(board.msg.text, board.msg.style);
      return lay ? { id: board.msg.id || 0, style: board.msg.style, ...lay } : null;
    } catch (e) { log.error('[board] message:', e.message); return null; }
  }

  // Last transit view per board and station, for the chrono hysteresis.
  // In memory only: after a restart the view is chosen fresh.
  const views = new Map();
  // Whether the conditions screen showed its RAIN line last time, per
  // `${board id}:${mapid}` (weather.js rainLine(): the buffer between 10%
  // and 20%). In memory only, like the views.
  const rainLines = new Map();

  // The control page's board list: who each board is, where it points, and
  // when it last checked in (null: not since the server started).
  const seenAt = new Map(); // board id -> last version check or update, epoch s
  function boardList() {
    return store.ids().map((id) => {
      const b = store.get(id);
      return { id, label: b.label || '', station: b.station.name, mapid: b.station.mapid, screen: b.screen, fw: b.fw || 'stable', ...(keys.wipeOf(id) ? { wiping: true } : {}), seen: seenAt.get(id) ?? null, sports: sportsOn(id), ...(keys.mine(id) ? { mine: true } : {}), ...(keys.linkOf(id) ? { link: keys.linkOf(id) } : {}) };
    });
  }
  // A removed board's live state (health, test alerts, chrono views).
  function forget(id) {
    keys.remove(id);
    healthOf.delete(id);
    seenAt.delete(id);
    tests.delete(id);
    for (const m of [views, rainLines]) for (const k of [...m.keys()]) if (k.startsWith(`${id}:`)) m.delete(k);
  }

  // The day/night face's sun and spot: the subsolar point in tenths of a
  // degree at `now` (t), and the station's pixel on the 5.625° map.
  function dayNightOf(st, now) {
    const sun = subsolar(now);
    const here = st && st.lat <= 84.375 && st.lat > -61.875
      ? [Math.min(63, Math.floor((st.lon + 180) / 5.625)), Math.floor((84.375 - st.lat) / 5.625)] : null;
    return { dec: Math.round(sun.dec * 10), lon: Math.round(sun.lon * 10), t: Math.floor(now), here };
  }

  // The skyline face's parameters, or null without weather or a station.
  function skylineOf(board, w, wd, st, now) {
    if (!w || !st) return null;
    try { return { face: 'skyline', ...toSkyline(w, {
      lat: st.lat, lon: st.lon, now, temp: wd && board.showTemp !== false ? wd.temp : null,
      boats: board.boats !== false, drift: board.cloudDrift || 'slow', wheel: board.wheelSpeed || 'normal',
      ripple: board.rippleSpeed || 'normal', twinkle: board.twinkle !== false, fall: board.rainSpeed || 'normal',
    }) }; }
    catch (e) { log.error('[board] skyline:', e.message); return null; }
  }

  // Every variant's data for the peek chooser: both forecast layouts, and
  // each clock face the board draws (the skyline's parameters, the analog
  // face's weather, the day/night face's sun, the gradient's inversion).
  function peekOf(board, w, wd, st, skyNow, now, caps) {
    const faces = {};
    if (caps.clock) faces.skyline = skylineOf(board, w, wd, st, skyNow);
    if (caps.face('analog')) faces.cwx = wd ? { temp: toWx(wd).temp, icon: toWx(wd).icon } : null;
    if (caps.face('daynight')) faces.dn = dayNightOf(st, now);
    if (caps.face('gradient') && board.gradInvert === true) faces.ginv = true;
    return { days: wd ? toDays(wd) : null, hours: wd ? toHours(wd) : null, ...faces };
  }

  async function update(board, id, boot, preview = {}, caps = capsOf(id)) {
    // The clock screen's face: one other than the skyline only for firmware that draws it.
    const face = board.clockFace && board.clockFace !== 'skyline' && caps.face(board.clockFace) ? board.clockFace : 'skyline';
    if (boot) board = store.boot(id);
    if (preview.mapid && preview.mapid !== board.station.mapid) {
      const st = stationById.get(preview.mapid);
      board = { ...board, station: { mapid: st.mapid, name: st.short }, rows: [] };
    }
    for (const k of ['showHeader', 'showWeather', 'radarTime', 'baseballLayout']) if (preview[k] != null) board = { ...board, [k]: preview[k] };
    // A board without baseball that was left on (or copied with) the
    // baseball screen shows transit instead.
    const sports = sportsOn(id);
    if (!sports && board.screen === 'baseball') board = { ...board, screen: 'transit' };
    const st = stationById.get(board.station.mapid);
    // Weather and warnings are nice-to-haves: a failure just leaves them off.
    const soft = (what, p) => p.catch((e) => { log.error(`[board] ${what}:`, e.message); return null; });
    const [data, base, nwsAlerts, fc] = await Promise.all([
      tracker.get(board.station.mapid),
      st ? soft('weather', weather.get(st.lat, st.lon)) : null,
      st ? soft('nws', nws.get(st.lat, st.lon)) : null,
      st ? soft('nws-forecast', nwsForecast.get(st.lat, st.lon)) : null,
    ]);
    const now = nowSecs();
    // WeatherAPI conditions with NWS's forecast fields (days, hours, hi/lo,
    // rain chance) laid over them.
    let w = base;
    try { w = withForecast(base, fc, now); } catch (e) { log.error('[board] nws-forecast:', e.message); }
    // Test weather from the simulator (expires with the test alerts): the
    // current conditions forced to one state and/or the sky at a test time
    // of day, on every weather display.
    const test = activeTest(id, now);
    const tw = test && test.weather && st ? test.weather : null;
    const skyNow = tw && tw.tod ? testSkyNow(tw.tod, st, now) : now;
    if (tw) w = testWeather(tw.kind, w, now, tw.tod || !w ? sunPos(skyNow, st.lat, st.lon).el > -0.83 : w.isDay);
    const stale = !data || now - data.fetchedAt > STALE_S;
    // The row cap only reserves space for the weather row when there's
    // weather to show.
    // Temperatures in the board's unit (wd); rain bars keep the raw data.
    const wd = inUnit(w, board.tempUnit);
    // The key layout has no weather strip: the station line takes rows 25-31.
    const keyLayout = board.transitLayout === 'key';
    const wx = board.showWeather && !keyLayout && wd ? toWx(wd) : null;
    const cfg = { ...board, showWeather: !!wx, showKey: keyLayout, lines: st ? st.lines : null };
    let radarState = NO_RADAR;
    try { if (st) radarState = radar.want(st.mapid, st.lat, st.lon); }
    catch (e) { log.error('[board] radar:', e.message); }
    // Test radar loop from the simulator (expires with the test alerts).
    if (test && test.radar && st) {
      try { radarState = { ...radarState, ...(await testRadar.want(test.radar, st, nowSecs())) }; }
      catch (e) { log.error('[board] test radar:', e.message); }
    }
    // The radar screen is the weather screen: the radar loop only while rain
    // is in the box (frames are sent only then), current conditions otherwise.
    // Rain bars (wxRain 'bars' or 'both'): while precipitation is falling or
    // due in the next 2 hours. 'bars' never sends the radar loop; 'both'
    // sends both and the board alternates them (rain.loops radar loops, then
    // rain.alt s of bars) while both apply.
    // Test rain bars (simulator): shown whatever the board's setting, and
    // replacing the radar loop unless it's alternating ('both').
    const testBars = test && test.bars ? testRain(test.bars, now) : null;
    // Bars need 15-minute precipitation, which WeatherAPI doesn't send: without
    // it (and no test bars), 'bars' and 'both' act as 'radar', so a board left
    // on 'bars' still gets its radar loop.
    const wxRain = (w && w.q15 && w.q15.length) || testBars ? board.wxRain : 'radar';
    const barsOn = wxRain === 'bars' || wxRain === 'both';
    let rain = barsOn && w ? toRain(w, now) : null;
    if (testBars) rain = testBars;
    // The radar view (wxView 'radar') keeps its frames whatever the weather
    // (an empty map when dry) and never shows rain bars.
    const radarView = board.wxView === 'radar';
    if (radarView) rain = null;
    // Every kept frame, rain or not, for the peek chooser's radar view.
    const allFrames = { frames: radarState.frames, ft: radarState.ft };
    if (!radarView && (!radarState.on || wxRain === 'bars' || (testBars && wxRain !== 'both'))) radarState = { ...radarState, frames: [], ft: [] };
    // Both: the radar loop plays wxRainLoops full cycles, then the bars show
    // for alt s, repeating (draw.js rainBarsTurn()).
    if (rain && radarState.frames.length) rain = { ...rain, alt: board.wxRainEvery || 15, loops: board.wxRainLoops || 2 };
    // The 5-day layout (wxView) draws when wx carries the days.
    const days = board.wxView === '5day' && wd ? toDays(wd) : null;
    const hours = board.wxView === 'hourly' && wd ? toHours(wd) : null;
    // The conditions screen's RAIN line (`rl`), buffered per board and station.
    const rlKey = `${id}:${board.station.mapid}`;
    const rl = wd ? rainLine(rainLines.get(rlKey), wd.pop) : false;
    if (wd) rainLines.set(rlKey, rl);
    if (wd) radarState = { ...radarState, wx: { ...toScreenWx(wd), ...(rl ? { rl: 1 } : {}), ...(board.tempUnit === 'C' ? { c: 1 } : {}), ...(days ? { days } : {}), ...(hours ? { hours } : {}), ...(rain ? { rain } : {}) } };
    let alertLines = new Set();
    try { alertLines = boardAlertLines(alerts && alerts.get() ? alerts.get().alerts : []); }
    catch (e) { log.error('[board] alerts:', e.message); }
    // Test alerts from the simulator (expire on their own).
    if (test) for (const ln of test.lines) alertLines.add(ln);
    // Games only for a board that shows baseball (chosen, or a Cycle turn);
    // they never take over another screen.
    let games = [];
    const bbTeams = board.bbTeams || ['cubs', 'sox', 'post'];
    const showsBaseball = board.screen === 'baseball' || (board.screen === 'auto' && Array.isArray(board.cycle) && board.cycle.includes('baseball'));
    if (sports && showsBaseball) try {
      games = mlb.get('forced', {
        teams: ['cubs', 'sox', 'post'],
        pre: (board.bbPre != null ? board.bbPre : 30) * 60, final: (board.bbFinal != null ? board.bbFinal : 15) * 60,
      });
      games = prioritize(games, board.bbPriority, bbTeams);
    } catch (e) { log.error('[board] mlb:', e.message); }
    if (sports && test && test.game) games = [testGame(test.game, now), ...games];
    const warn = (test && test.warn) || pickWarn(nwsAlerts, now);
    const cyc = cycleOf(board, caps, sports);
    const screen = resolveScreen(board, cyc);
    const held = holdOf(id, board, now, !!radarState.on);
    const viewKey = `${id}:${board.station.mapid}`;
    const { view, viewState, rows, ticker, bars } = format(data ? data.arrivals : [], cfg, { now, alerts: alertLines, prevView: views.get(viewKey) });
    views.set(viewKey, viewState);
    return {
      v: board.v,
      now,
      tzo: tzOffset(now),
      stn: board.station.mapid, // the board starts transit and ticker fresh when it changes
      age: data ? Math.max(0, Math.round(now - data.fetchedAt)) : null,
      stale: stale ? 1 : 0,
      screen,
      rot: rotOf(board, screen, cyc),
      // The knob's ring and where the chosen screen sits on it (S3 chooser).
      knob: knobOf(board, { clock: caps.clock, announce: caps.announce, peek: caps.peek, faces: CLOCK_FACES.filter((f) => f === 'skyline' || caps.face(f)) }),
      bright: resolveBright(board, w, now),
      // Auto brightness on a board with a light sensor (contract: `ab`).
      ab: autoBrightOf(board),
      // Transit header and weather row as fitted to the destinations; the
      // ticker always shows its header (hiding it frees no room it can use).
      header: bars.showHeader ? board.station.name : null,
      headerDivider: board.headerDivider === true,
      // Key layout: the key on top; `header` then goes on the bottom line.
      ...(bars.showKey ? { key: 1 } : {}),
      tickerHeader: board.station.name,
      // Header clock (transit and ticker) and line-colored labels.
      hclock: board.headerClock !== false,
      lnc: board.lineNames === 'line',
      // Third transit time one step dimmer than the second.
      ts: board.timeSteps === true,
      hidden: bars.hidden,
      view,
      rows,
      ticker,
      wx: bars.showWeather ? wx : null,
      warn,
      anim: animOf(board),
      tickerFill: board.tickerFill || 55,
      radar: {
        ...radarState, visit: held ? null : visitOf(board), ...(held ? { held } : {}), showTime: board.radarTime !== false, tempShadow: board.tempShadow === true, temp: wd ? toWx(wd).temp : null, icon: wd ? toWx(wd).icon : null,
        // Radar clock: the current time instead of the frame's; conditions under it.
        ...(board.radarClock && board.radarClock !== 'frame' ? { clock: board.radarClock } : {}),
        ...(board.radarCond === true ? { cond: true } : {}),
        // Precip brightness, percent (absent = 100).
        ...(board.radarBright != null && board.radarBright !== 100 ? { rb: board.radarBright } : {}),
      },
      // Clock screen: which face, and the skyline face's drawing parameters
      // (skyline.js; contract "Skyline"; null on the seventies face).
      cface: face,
      skyline: face === 'skyline' ? skylineOf(board, w, wd, st, skyNow) : null,
      // Analog face: the temperature and icon (contract "Analog"); null without weather.
      ...(face === 'analog' ? { cwx: wd ? { temp: toWx(wd).temp, icon: toWx(wd).icon } : null } : {}),
      // Day/night face: the subsolar point and the board's spot (contract "Day/night").
      ...(face === 'daynight' ? { dn: dayNightOf(st, now) } : {}),
      // Gradient face: lit gradient digits on black (contract "Gradient").
      ...(face === 'gradient' && board.gradInvert === true ? { ginv: true } : {}),
      // Announce screen: the message's lines for its style (contract "Announce").
      msg: msgOf(board),
      // Peek chooser (caps.peek): what the other variants draw from, so the
      // board can draw any of them while the knob turns (contract "Peek").
      ...(caps.peek ? { pv: { ...peekOf(board, w, wd, st, skyNow, now, caps), radar: allFrames } } : {}),
      // Baseball: on the maker's boards only (sportsOn); absent on the others.
      ...(sports ? {
        mlb: board.baseballLayout === 'logos' || board.baseballLayout === 'bands'
          ? { layout: board.baseballLayout, dim: (board.logoBright || 90) / 100, games: games.map((g) => withLogos(g, board.baseballLayout === 'logos')), ...(board.bbPriority === 'all' ? { all: true } : {}) }
          : { layout: 'classic', games, ...(board.bbPriority === 'all' ? { all: true } : {}) },
      } : {}),
    };
  }

  // Logo crops a payload refers to, for server-side renders (sim.png).
  function logoBytes(body) {
    const out = {};
    for (const g of (body.mlb && body.mlb.games) || []) for (const sd of [g.away, g.home]) {
      if (sd.lg && !out[sd.lg]) { const b = logos.bytes(sd.lg); if (b) out[sd.lg] = b; }
    }
    return out;
  }

  async function route(req, res, parsed) {
    const parts = parsed.pathname.split('/').filter(Boolean); // ['board', ...]
    const [, first, ...rest] = parts;
    const method = req.method;

    // ---- board endpoints ----
    if (first === 'ping' && rest.length === 0) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      return send(res, 200, { ok: 1 });
    }

    if (first === 'version' && rest.length === 0) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      if (!authed(req, parsed.query.b)) return send(res, 401, { err: 'bad_token' });
      const board = store.get(String(parsed.query.b || ''));
      if (!board) return send(res, 404, { err: 'unknown_board' });
      noteHealth(String(parsed.query.b), parsed.query, nowSecs());
      // The board's knob ended a rain visit (`hq`: no visit before then).
      const hq = Number(parsed.query.hq);
      if (Number.isInteger(hq) && hq > nowSecs() && hq <= nowSecs() + 3600 && !(board.rainHold && board.rainHold.until === hq)) {
        try { store.setRainHold(String(parsed.query.b), { until: hq }); } catch (e) { log.error('[board] rain hold:', e.message); }
      }
      seenAt.set(String(parsed.query.b), nowSecs());
      // An OTA offer when this S3 should run another build (firmware.js).
      let fw = null;
      try { fw = firmware.offer(board, parsed.query, nowSecs()); } catch (e) { log.error('[board] firmware offer:', e.message); }
      // A new owner's transfer: the board forgets its saved WiFi once per stamp (contract "Board keys").
      const wipe = keys.wipeOf(String(parsed.query.b));
      return send(res, 200, { v: board.v, now: nowSecs(), ...(fw ? { fw } : {}), ...(wipe ? { wipe } : {}) });
    }

    // An OTA build (contract: "Firmware"): streamed, exactly `size` bytes.
    if (first === 'firmware' && rest.length === 0) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      if (!authed(req, parsed.query.b)) return send(res, 401, { err: 'bad_token' });
      if (!store.get(String(parsed.query.b || ''))) return send(res, 404, { err: 'unknown_board' });
      const f = firmware.file(String(parsed.query.v || ''));
      if (!f) return send(res, 404, { err: 'unknown_build' });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.size, 'Cache-Control': 'no-store' });
      const stream = fs.createReadStream(f.path);
      stream.on('error', (e) => { log.error('[board] firmware read failed:', e.message); res.destroy(); });
      stream.pipe(res);
      return;
    }

    if (first === 'update' && rest.length === 0) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      if (!authed(req, parsed.query.b)) return send(res, 401, { err: 'bad_token' });
      const id = String(parsed.query.b || '');
      // A board ID the server hasn't seen (a newly flashed board) is added
      // as a copy of the default board, so a second board needs no setup here.
      const board = store.get(id) || store.register(id);
      if (!board) return send(res, 404, { err: 'unknown_board' });
      seenAt.set(id, nowSecs());
      const caps = capsOf(id, parsed.query);
      const body = forBoard(await update(board, id, parsed.query.boot === '1', {}, caps), caps);
      const asked = SCREENS.includes(parsed.query.s) && !canDraw(parsed.query.s, caps) ? 'transit' : parsed.query.s;
      const shown = SCREENS.includes(asked) ? asked : body.screen;
      return send(res, 200, caps.peek ? { ...body, for: shown } : sectionsFor(body, shown));
    }

    // The knob chose a category (s, one of knob.ring): the same as choosing
    // its screen on the phone (bumps v). Answers with the combined update for
    // the new screen, so the board needs no second request.
    if (first === 'select' && rest.length === 0) {
      if (method !== 'POST') return send(res, 405, { err: 'method' });
      if (!authed(req, parsed.query.b)) return send(res, 401, { err: 'bad_token' });
      const id = String(parsed.query.b || '');
      let board;
      try { board = store.select(id, String(parsed.query.s || ''), parsed.query.v != null ? String(parsed.query.v) : undefined); }
      catch (e) {
        if (e instanceof ValidationError) return send(res, 400, { err: 'invalid', detail: e.message });
        throw e;
      }
      if (!board) return send(res, 404, { err: 'unknown_board' });
      const caps = capsOf(id, parsed.query);
      const body = forBoard(await update(board, id, false, {}, caps), caps);
      return send(res, 200, caps.peek ? { ...body, for: body.screen } : sectionsFor(body, body.screen));
    }

    // A cloud strip for the skyline face (contract "Cloud strips"): 1664
    // bytes, immutable (the id names the shape).
    if (first === 'sky' && rest.length === 1) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      if (!authed(req, parsed.query.b)) return send(res, 401, { err: 'bad_token' });
      if (!store.get(String(parsed.query.b || ''))) return send(res, 404, { err: 'unknown_board' });
      const bytes = stripBytes(rest[0]);
      if (!bytes) return send(res, 404, { err: 'unknown_strip' });
      return sendFrame(res, bytes);
    }

    // One radar frame for the board's station: 2048 bytes, immutable;
    // pk=4: packed to 1024 (radar.packFrame), as the board stores them.
    if (first === 'radar' && rest.length === 1) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      if (!authed(req, parsed.query.b)) return send(res, 401, { err: 'bad_token' });
      const board = store.get(String(parsed.query.b || ''));
      if (!board) return send(res, 404, { err: 'unknown_board' });
      const bytes = radar.frame(board.station.mapid, rest[0]) || testRadar.frame(rest[0]);
      return sendFrame(res, bytes && parsed.query.pk === '4' ? packFrame(bytes) : bytes);
    }

    // One team logo crop: 24 x 12 RGB (864 bytes), immutable (the id carries a hash).
    if (first === 'logo' && rest.length === 1) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      if (!authed(req, parsed.query.b)) return send(res, 401, { err: 'bad_token' });
      if (!sportsOn(parsed.query.b)) return send(res, 404, { err: 'not_found' });
      return sendLogo(res, logos.bytes(rest[0]));
    }

    // CI publishes each signed build of main to beta (contract: "Firmware").
    // Its own token, good for this only; off unless FIRMWARE_DEPLOY_TOKEN is set.
    if (first === 'firmware-upload' && rest.length === 0) {
      if (!deployToken) return send(res, 404, { err: 'not_found' });
      if (method !== 'POST') return send(res, 405, { err: 'method' });
      if (!sameSecret(req.headers['x-deploy-token'], deployToken)) return send(res, 401, { err: 'bad_token' });
      try {
        const body = await readBody(req, MAX_FIRMWARE + 64 * 1024);
        const sig = req.headers['x-firmware-signature'] || null;
        // ?boot=<build>: that build's boot image (after the build itself).
        if (parsed.query.boot != null) {
          firmware.attachBoot(String(parsed.query.boot), body, { sig });
          return send(res, 200, { boot: String(parsed.query.boot) });
        }
        const st = firmware.upload(body, { sig, channel: 'beta', pinned: pinnedBuilds() });
        return send(res, 200, { beta: st.channels.beta });
      } catch (e) {
        if (e instanceof FirmwareError || e instanceof ValidationError) return send(res, 400, { err: 'invalid', detail: e.message });
        throw e;
      }
    }

    // ---- control endpoints, under the secret path ----
    // The owner's control path (every board), or a per-board link
    // (/board/c/<link>/: that board only, `b` forced to it).
    let scope = null;
    let ctl = null;
    if (controlPath && first && sameSecret(first, controlPath)) ctl = rest;
    else if (first === 'c' && rest.length >= 1 && (scope = keys.idForLink(rest[0])) && store.get(scope)) ctl = rest.slice(1);
    if (ctl) {
      const sub = ctl.join('/');
      const isSimFile = ctl[0] === 'api' && (ctl[1] === 'radar' || ctl[1] === 'logo' || ctl[1] === 'sky') && ctl.length === 3;
      if (scope) {
        if (!SCOPED_OK.has(sub) && !isSimFile) return send(res, 404, { err: 'not_found' });
        if (sub === 'api/boards' && method !== 'GET') return send(res, 404, { err: 'not_found' });
        parsed.query.b = scope;
      }

      // Phone control page. Relative URLs need the trailing slash.
      if (sub === '') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        if (!parsed.pathname.endsWith('/')) {
          res.writeHead(301, { Location: parsed.pathname + '/' + (parsed.search || '') });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        // A per-board link's page knows its board and hides the owner's controls.
        res.end(scope ? CONTROL_HTML.toString('utf8').replace('<script>', `<script>window.BOARD_SCOPE = ${JSON.stringify(scope)};</script>\n<script>`) : CONTROL_HTML);
        return;
      }

      // Destinations for the phone page's filter: every destination the
      // station's lines can show, plus any running now or already chosen.
      if (sub === 'api/destinations') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const st = stationById.get(String(parsed.query.mapid || ''));
        if (!st) return send(res, 400, { err: 'invalid', detail: `unknown mapid: ${parsed.query.mapid}` });
        const keys = stationDestinations(st);
        const live = new Set();
        try {
          const data = await tracker.get(st.mapid);
          for (const a of (data && data.arrivals) || []) live.add(`${a.ln}:${a.dest}`);
        } catch (e) { log.warn('[board] destinations: no live data:', e.message); }
        const board = store.get(String(parsed.query.b || ''));
        const chosen = board && board.station.mapid === st.mapid ? board.rows : [];
        for (const k of [...live, ...chosen]) if (!keys.includes(k)) keys.push(k);
        return send(res, 200, keys.map((key) => {
          const i = key.indexOf(':');
          return { key, ln: key.slice(0, i), name: key.slice(i + 1), live: live.has(key) ? 1 : 0 };
        }));
      }
      // Boards: GET the list; POST {id, from?, label?} to add one (a copy of
      // board `from`, or the defaults); DELETE ?b=<id> to remove one.
      if (sub === 'api/boards') {
        if (method === 'GET') return send(res, 200, scope ? boardList().filter((b) => b.id === scope).map((b) => ({ ...b, link: undefined })) : boardList());
        try {
          if (method === 'POST') {
            const body = await readJson(req);
            if (!body || typeof body !== 'object') throw new ValidationError('body must be an object');
            const from = body.from == null ? null : String(body.from);
            store.create(String(body.id || ''), { from, label: body.label ?? '' });
            return send(res, 200, boardList());
          }
          if (method === 'DELETE') {
            const id = String(parsed.query.b || '');
            if (!store.remove(id)) return send(res, 404, { err: 'unknown_board' });
            forget(id);
            return send(res, 200, boardList());
          }
        } catch (e) {
          if (e instanceof ValidationError) return send(res, 400, { err: 'invalid', detail: e.message });
          throw e;
        }
        return send(res, 405, { err: 'method' });
      }
      // Copy another board's settings onto this one (?b=<id>&from=<other>).
      if (sub === 'api/boards/copy') {
        if (method !== 'POST') return send(res, 405, { err: 'method' });
        let board;
        try { board = store.copy(String(parsed.query.b || ''), String(parsed.query.from || '')); }
        catch (e) {
          if (e instanceof ValidationError) return send(res, 400, { err: 'invalid', detail: e.message });
          throw e;
        }
        if (!board) return send(res, 404, { err: 'unknown_board' });
        return send(res, 200, board);
      }
      // Board keys (keys.js), owner only. POST api/boards/key?b=<id>: a new
      // token and control link for that board (the token is shown once and
      // goes into its flash; a board running with the old one gets 401s);
      // DELETE: back to the shared token, link revoked. POST
      // api/boards/link?b=<id>: a new control link, the old one stops working.
      // A new owner (contract "Board keys"): POST api/boards/transfer?b=<id>
      // gives a keyed board a new control link (the old one stops working),
      // resets its settings to the defaults (name and firmware setting kept),
      // and (from the maker's page) tells the board to forget its saved WiFi.
      // From the board's own link it only relinks and resets: an old link
      // must not be able to wipe the current owner's WiFi.
      if (sub === 'api/boards/transfer') {
        if (method !== 'POST') return send(res, 405, { err: 'method' });
        const id = String(parsed.query.b || '');
        if (!store.get(id)) return send(res, 404, { err: 'unknown_board' });
        if (!keys.has(id)) return send(res, 400, { err: 'invalid', detail: 'this board has no key; give it one first' });
        store.reset(id);
        const t = keys.transfer(id, { now: nowSecs(), wipe: !scope });
        tests.delete(id);
        log.warn(`[board] board "${id}" transferred to a new owner`);
        return send(res, 200, { id, link: t.link, ...(t.wipe ? { wipe: t.wipe } : {}) });
      }
      if (sub === 'api/boards/key' || sub === 'api/boards/link') {
        const id = String(parsed.query.b || '');
        if (!store.get(id)) return send(res, 404, { err: 'unknown_board' });
        if (sub === 'api/boards/key' && method === 'POST') return send(res, 200, { id, ...keys.issue(id, { mine: parsed.query.mine === '1' }) });
        if (sub === 'api/boards/key' && method === 'DELETE') { keys.remove(id); return send(res, 200, { id, link: null }); }
        if (sub === 'api/boards/link' && method === 'POST') {
          const link = keys.relink(id);
          return link ? send(res, 200, { id, link }) : send(res, 400, { err: 'invalid', detail: 'this board has no key; give it one first' });
        }
        return send(res, 405, { err: 'method' });
      }
      if (sub === 'api/health') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        return send(res, 200, scope ? (healthOf.has(scope) ? { [scope]: healthOf.get(scope) } : {}) : Object.fromEntries(healthOf));
      }
      // Rain nearby from the phone: POST {hold: 'visit'} ends the visit now
      // (the radar comes back at the next one), {hold: 'rain'} stops it until
      // the rain passes, {hold: null} lets it run again.
      if (sub === 'api/rain') {
        if (method !== 'POST') return send(res, 405, { err: 'method' });
        const id = String(parsed.query.b || '');
        const board = store.get(id);
        if (!board) return send(res, 404, { err: 'unknown_board' });
        let body;
        try { body = await readJson(req); } catch (e) { if (e instanceof ValidationError) return send(res, 400, { err: 'invalid', detail: e.message }); throw e; }
        const h = body && body.hold;
        if (![null, 'visit', 'rain'].includes(h ?? null)) return send(res, 400, { err: 'invalid', detail: 'hold must be visit, rain, or null' });
        const now = nowSecs();
        const every = (board.radarEvery || 4) * 60;
        store.setRainHold(id, h === 'visit' ? { until: Math.floor(now / every) * every + every } : h === 'rain' ? { rain: true } : null);
        return send(res, 200, { hold: h ?? null });
      }
      if (sub === 'api/state') {
        if (method === 'GET') return send(res, 200, scope ? { boards: { [scope]: store.get(scope) } } : store.all());
        if (method === 'POST') {
          const id = String(parsed.query.b || '');
          try {
            const patch = await readJson(req);
            if (scope && patch && patch.fw !== undefined && !SCOPED_FW.includes(patch.fw)) {
              throw new ValidationError(`fw must be one of ${SCOPED_FW.join(', ')}`);
            }
            checkSportsPatch(id, patch);
            return send(res, 200, store.update(id, patch));
          } catch (e) {
            if (e instanceof ValidationError) return send(res, 400, { err: 'invalid', detail: e.message });
            throw e;
          }
        }
        return send(res, 405, { err: 'method' });
      }

      // Same payload as /board/update, for the simulator (the path is the credential).
      if (sub === 'api/update') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const id = String(parsed.query.b || '');
        const board = store.get(id);
        if (!board) return send(res, 404, { err: 'unknown_board' });
        const preview = previewOf(parsed.query);
        if (preview.err) return send(res, 400, { err: 'invalid', detail: preview.err });
        return send(res, 200, await update(board, id, false, preview));
      }

      // Cloud strip for the simulator.
      if (rest[0] === 'api' && rest[1] === 'sky' && rest.length === 3) {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        return sendFrame(res, stripBytes(rest[2]));
      }

      // Radar frame for the simulator (the path is the credential); `mapid`
      // for a previewed station.
      if (rest[0] === 'api' && rest[1] === 'radar' && rest.length === 3) {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const board = store.get(String(parsed.query.b || ''));
        const mapid = String(parsed.query.mapid || '') || (board && board.station.mapid);
        if (!mapid) return send(res, 404, { err: 'unknown_board' });
        return sendFrame(res, radar.frame(mapid, rest[2]) || testRadar.frame(rest[2]));
      }

      // Team logos: GET status; POST a PNG to replace them: the whole sheet,
      // or with ?team=AB (and optional &crop=0-12) one team's logo. Kept
      // beside the board state, never in the repo.
      if (sub === 'api/logos') {
        if (method === 'GET') return send(res, 200, logos.status());
        if (method !== 'POST') return send(res, 405, { err: 'method' });
        let status;
        try {
          const body = await readBody(req, MAX_SHEET);
          const ab = parsed.query.team ? String(parsed.query.team) : null;
          const crop = parsed.query.crop != null && parsed.query.crop !== '' ? Number(parsed.query.crop) : null;
          status = ab ? logos.uploadOne(ab, body, crop) : logos.uploadSheet(body);
        } catch (e) { return send(res, 400, { err: 'invalid', detail: e.message }); }
        return send(res, 200, status);
      }
      // OTA builds: GET the builds and channels; POST a .bin (raw body) to
      // add one, with ?channel=beta|stable to point that channel at it;
      // DELETE ?v=<build> to remove one.
      if (sub === 'api/firmware') {
        try {
          if (method === 'GET') return send(res, 200, firmware.status());
          if (method === 'POST') {
            const body = await readBody(req, MAX_FIRMWARE + 64 * 1024);
            const channel = parsed.query.channel ? String(parsed.query.channel) : null;
            const sig = req.headers['x-firmware-signature'] || null;
            return send(res, 200, firmware.upload(body, { sig, channel, pinned: pinnedBuilds() }));
          }
          if (method === 'DELETE') return send(res, 200, firmware.remove(String(parsed.query.v || ''), pinnedBuilds()));
        } catch (e) {
          if (e instanceof FirmwareError || e instanceof ValidationError) return send(res, 400, { err: 'invalid', detail: e.message });
          throw e;
        }
        return send(res, 405, { err: 'method' });
      }
      // A build's boot image (POST, raw body + X-Firmware-Signature), and
      // what Set up a board flashes: the boot image and the app, i.e. the
      // merged image up to the app's end (GET api/firmware/image?v=).
      if (sub === 'api/firmware/boot' || sub === 'api/firmware/image') {
        const v = String(parsed.query.v || '');
        try {
          if (sub === 'api/firmware/boot' && method === 'POST') {
            return send(res, 200, firmware.attachBoot(v, await readBody(req, 0x20000), { sig: req.headers['x-firmware-signature'] || null }));
          }
          if (sub === 'api/firmware/image' && method === 'GET') {
            const img = firmware.image(v);
            if (!img) return send(res, 404, { err: 'not_found', detail: firmware.has(v) ? `build ${v} has no boot image` : `unknown build: ${v}` });
            res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': img.length, 'Cache-Control': 'no-store' });
            res.end(img);
            return;
          }
        } catch (e) {
          if (e instanceof FirmwareError || e instanceof ValidationError) return send(res, 400, { err: 'invalid', detail: e.message });
          throw e;
        }
        return send(res, 405, { err: 'method' });
      }
      // Point a channel at a build: {channel: beta|stable, v: <build> | null}.
      if (sub === 'api/firmware/channel') {
        if (method !== 'POST') return send(res, 405, { err: 'method' });
        try {
          const body = await readJson(req);
          if (!body || typeof body !== 'object') throw new ValidationError('body must be an object');
          return send(res, 200, firmware.setChannel(String(body.channel || ''), body.v == null ? null : String(body.v)));
        } catch (e) {
          if (e instanceof FirmwareError || e instanceof ValidationError) return send(res, 400, { err: 'invalid', detail: e.message });
          throw e;
        }
      }
      // A logo crop for the simulator (the path is the credential).
      if (rest[0] === 'api' && rest[1] === 'logo' && rest.length === 3) {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        return sendLogo(res, logos.bytes(rest[2]));
      }

      // Test alerts for this board: GET the active set, POST to replace it
      // (an empty set clears it).
      if (sub === 'api/test') {
        const id = String(parsed.query.b || '');
        if (!store.get(id)) return send(res, 404, { err: 'unknown_board' });
        const now = nowSecs();
        if (method === 'POST') {
          let t;
          try { t = validateTest(await readJson(req)); }
          catch (e) {
            if (e instanceof ValidationError) return send(res, 400, { err: 'invalid', detail: e.message });
            throw e;
          }
          if (t.lines.length || t.warn || t.game || t.radar || t.bars || t.weather) tests.set(id, { ...t, until: now + TEST_S });
          else tests.delete(id);
        } else if (method !== 'GET') {
          return send(res, 405, { err: 'method' });
        }
        const t = activeTest(id, now);
        return send(res, 200, t ? { lines: t.lines, warn: t.warn, game: t.game || null, radar: t.radar || null, bars: t.bars || null, weather: t.weather || null, left: t.until - now } : { lines: [], warn: null, game: null, radar: null, bars: null, weather: null, left: 0 });
      }

      // Station list for the simulator's picker.
      if (sub === 'api/stations') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
        res.end(stationList);
        return;
      }

      // Simulator page and the PNG frames it shows.
      if (sub === 'sim') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(SIM_HTML);
        return;
      }
      // Set up a board's scripts (scoped links never reach these: not in SCOPED_OK).
      if (sub === 'setup-image.js' || sub === 'setup-tools.js') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        let js = SETUP_IMAGE_JS;
        if (sub === 'setup-tools.js') {
          try { js = fs.readFileSync(SETUP_TOOLS_FILE); } catch (e) { return send(res, 404, { err: 'not_found', detail: 'not built: run npm run build' }); }
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' });
        res.end(js);
        return;
      }
      // The control page's picker tiles: fixed sample renders (base64 PNGs).
      if (sub === 'tiles.json') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
        res.end(CONTROL_TILES);
        return;
      }
      // draw.js and the fonts/icons it needs, for the simulator page.
      if (sub === 'draw.js' || sub === 'sim-assets.json') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const js = sub === 'draw.js';
        res.writeHead(200, { 'Content-Type': js ? 'application/javascript' : 'application/json', 'Cache-Control': 'no-cache' });
        res.end(js ? DRAW_JS : SIM_ASSETS);
        return;
      }
      if (sub === 'sim.png') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const id = String(parsed.query.b || '');
        const board = store.get(id);
        if (!board) return send(res, 404, { err: 'unknown_board' });
        const preview = previewOf(parsed.query);
        if (preview.err) return send(res, 400, { err: 'invalid', detail: preview.err });
        const body = await update(board, id, false, preview);
        const asked = SCREENS.includes(parsed.query.screen) && (parsed.query.screen !== 'baseball' || body.mlb) ? parsed.query.screen : null;
        const screen = asked || autoScreen(body, body.now);
        const radarMapid = preview.mapid || board.station.mapid;
        const frames = {};
        for (const fid of body.radar.frames) { const b = radar.frame(radarMapid, fid) || testRadar.frame(fid); if (b) frames[fid] = b; }
        const scale = Math.min(16, Math.max(1, parseInt(parsed.query.scale, 10) || 8));
        const frame = render(body, {
          screen,
          page: Math.max(0, parseInt(parsed.query.page, 10) || 0),
          blink: parsed.query.blink === '1',
          frames,
          logos: logoBytes(body),
          clouds: body.skyline && body.skyline.cl ? { [body.skyline.cl.id]: stripBytes(body.skyline.cl.id) } : {},
        });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(parsed.query.led === 'square' ? frame.toSquarePNG(scale) : frame.toPNG(scale));
        return;
      }

      // Raw MLB schedule (as the poller last fetched it) for recording fixtures.
      if (sub === 'api/raw/mlb') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const raw = mlb.raw ? mlb.raw() : null;
        if (!raw) return send(res, 503, { err: 'not_ready' });
        return send(res, 200, raw);
      }

      // Raw WeatherAPI response for a station's grid cell, for recording
      // fixtures (the response carries no key).
      if (sub === 'api/raw/weather') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const st = stationById.get(String(parsed.query.mapid || ''));
        if (!st) return send(res, 400, { err: 'invalid', detail: `unknown mapid: ${parsed.query.mapid || ''}` });
        if (!weather.raw) return send(res, 503, { err: 'not_ready' });
        try {
          return send(res, 200, await weather.raw(st.lat, st.lon));
        } catch (e) {
          log.error('[board] weather capture failed:', e.message);
          return send(res, 502, { err: 'upstream', detail: e.message });
        }
      }

      // Raw Train Tracker response for recording fixtures.
      if (sub === 'api/raw/arrivals') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const mapid = String(parsed.query.mapid || '');
        if (!stationById.has(mapid)) return send(res, 400, { err: 'invalid', detail: `unknown mapid: ${mapid}` });
        let up;
        try {
          up = await capture.rawArrivals(mapid);
        } catch (e) {
          log.error('[board] capture failed:', e.message);
          return send(res, 502, { err: 'upstream', detail: e.message });
        }
        res.writeHead(up.status === 200 ? 200 : 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(up.body);
        return;
      }
    }

    return send(res, 404, { err: 'not_found' });
  }

  return {
    store,
    // Always handles the request; never throws, so a board bug can't take
    // down the map's server.
    async handle(req, res, parsed) {
      try {
        await route(req, res, parsed);
      } catch (e) {
        log.error('[board] request failed:', e && e.stack ? e.stack : e);
        if (!res.headersSent) send(res, 500, { err: 'server' });
        else res.end();
      }
    },
  };
}

module.exports = { sectionsFor, SECTIONS, createBoard };
