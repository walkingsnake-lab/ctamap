'use strict';
// LED board router. server.js hands every /board/* request here; nothing
// else in the app knows about the board. API: docs/board/contract.md.

const crypto = require('crypto');
const { createStore, ValidationError, resolveDir } = require('./state');
const { createTracker } = require('./tracker');
const { format } = require('./arrivals');
const { stationDestinations } = require('./destinations');
const { createWeather, toWx, toScreenWx, toDays, toRain, autoBright } = require('./weather');
const { boardAlertLines } = require('./cta-alerts');
const { createNws, pickWarn } = require('./nws');
const { createRadar, packFrame } = require('./radar');
const { createTestRadar } = require('./test-radar');
const { createMlb, prioritize } = require('./mlb');
const { createLogos } = require('./mlb-logos');
const { team } = require('./teams');
const { tzOffset } = require('./time');
const fs = require('fs');
const path = require('path');
const { render, assets, autoScreen } = require('./render');

const SIM_HTML = fs.readFileSync(path.join(__dirname, 'sim.html'));
const CONTROL_HTML = fs.readFileSync(path.join(__dirname, 'control.html'));
const DRAW_JS = fs.readFileSync(path.join(__dirname, 'draw.js'));
const SIM_ASSETS = JSON.stringify(assets());

const MAX_BODY = 8 * 1024;
// Arrivals older than this are stale (red top edge, NO DATA when none are left).
const STALE_S = 180;
// Board endpoint names; the control path must not collide with them.
const RESERVED = new Set(['ping', 'version', 'update', 'radar', 'logo']);
const MAX_SHEET = 8 * 1024 * 1024; // uploaded logo sheet (PNG)

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// The board's /board/update carries only what one screen draws (contract:
// "Sections"): less JSON to parse on a heap that fragments. `for` names that
// screen: the payload's `screen`, or `s` when a button press overrides it.
// radar rides along whole on the weather screen and whenever timed visits
// are on (the board switches to it by itself); otherwise only `on`. While
// Auto alternates screens (rot), every rotation screen's sections ride
// along. The simulator's copy (api/update) stays whole.
const SCREENS = ['transit', 'ticker', 'weather', 'baseball'];
const SECTIONS = {
  transit: ['header', 'hidden', 'view', 'rows', 'wx'],
  ticker: ['ticker', 'tickerHeader', 'tickerFill'],
  baseball: ['mlb'],
  weather: [],
};
function sectionsFor(body, screen) {
  const out = { ...body, for: screen };
  const keep = new Set([screen, ...(body.rot && body.rot.screens.includes(screen) ? body.rot.screens : [])]);
  for (const [sc, keys] of Object.entries(SECTIONS)) if (!keep.has(sc)) for (const k of keys) delete out[k];
  if (screen !== 'weather' && body.radar && !body.radar.visit) out.radar = { on: body.radar.on, visit: null };
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
  radar = null,
  mlb = null,
  logos = null,   // prepared team logos (mlb-logos.js); default beside the board state
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
    .map(({ mapid, desc, short }) => ({ mapid, desc, short }))
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
  const authed = (req) => !token || sameSecret(req.headers['x-board-token'], token);
  if (!tracker) tracker = createTracker({ log }).start();
  if (!weather) weather = createWeather({ log, cacheFile: path.join(path.dirname(store.file), 'board-weather.json') }).start();
  if (!nws) nws = createNws({ log }).start();
  if (!radar) radar = createRadar({ weather, log }).start();
  const testRadar = createTestRadar();
  if (!mlb) mlb = createMlb({ log }).start();
  if (!logos) logos = createLogos({ dir: resolveDir(log), log });

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

  // 'auto' brightness follows sunrise/sunset (100 until weather data arrives).
  const resolveBright = (b, w, now) => (b === 'off' ? 0 : b === 'auto' ? autoBright(w, now) : b);
  // 'auto': the weather screen while a matching NWS alert is on (alertJump),
  // else baseball while a game is on, else the first Auto screen. The board
  // alternates Auto screens (rot) and makes timed weather visits
  // (radar.visit) on top.
  const alertJumps = (b, warn) => !!warn && (b.alertJump === 'all' || (b.alertJump === 'warning' && warn.lvl === 'warning'));
  const resolveScreen = (b, games, warn) => {
    if (b.screen !== 'auto') return b.screen;
    if (alertJumps(b, warn)) return 'weather';
    if (games) return 'baseball';
    return (b.autoScreens && b.autoScreens[0]) || 'transit';
  };
  const rotOf = (b, screen) => (b.screen === 'auto' && b.autoScreens && b.autoScreens.length > 1 && b.autoScreens.includes(screen)
    ? { screens: b.autoScreens, every: b.autoEvery || 60 } : null);
  // Speed settings (contract "anim"): ms, baseball rotation in s.
  const animOf = (b) => ({
    pageHold: (b.tickerHold || 8) * 1000, slide: b.tickerSlide || 1200,
    radarFrame: b.radarFrame || 500, radarHold: (b.radarHold || 4) * 1000, game: b.gameEvery || 60,
  });
  // Weather visits apply only on the auto screen, and only if turned on;
  // `always` visits even without rain (current conditions).
  const visitOf = (b) => (b.screen === 'auto' && (b.wxVisit === 'rain' || b.wxVisit === 'always') && b.radarEvery > 0
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
    return { lines: [...new Set(lines)], warn: warn && { kind: warn.kind, lvl: warn.lvl }, game, radar: rad };
  }

  // `preview` (simulator only): {mapid, showHeader, showWeather} shown
  // without changing the board's config. The board's row list is
  // station-specific, so it's ignored while previewing another station.
  // Board health, sent with the version check about once a minute
  // (contract: /board/version). In memory only: it's a live view.
  const healthOf = new Map(); // board id -> latest report + history bits
  const HEALTH_FIELDS = { hu: 'uptime', hm: 'memFree', hl: 'largestBlock', ho: 'oom', hb: 'budget', hf: 'fails', hr: 'reconnects', hw: 'rssi' };
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
    const prev = healthOf.get(id);
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

  // Last transit view per board and station, for the chrono hysteresis.
  // In memory only: after a restart the view is chosen fresh.
  const views = new Map();

  async function update(board, id, boot, preview = {}) {
    if (boot) board = store.boot(id);
    if (preview.mapid && preview.mapid !== board.station.mapid) {
      const st = stationById.get(preview.mapid);
      board = { ...board, station: { mapid: st.mapid, name: st.short }, rows: [] };
    }
    for (const k of ['showHeader', 'showWeather', 'radarTime', 'baseballLayout']) if (preview[k] != null) board = { ...board, [k]: preview[k] };
    const st = stationById.get(board.station.mapid);
    // Weather and warnings are nice-to-haves: a failure just leaves them off.
    const soft = (what, p) => p.catch((e) => { log.error(`[board] ${what}:`, e.message); return null; });
    const [data, w, nwsAlerts] = await Promise.all([
      tracker.get(board.station.mapid),
      st ? soft('weather', weather.get(st.lat, st.lon)) : null,
      st ? soft('nws', nws.get(st.lat, st.lon)) : null,
    ]);
    const now = nowSecs();
    const stale = !data || now - data.fetchedAt > STALE_S;
    // The row cap only reserves space for the weather row when there's
    // weather to show.
    const wx = board.showWeather && w ? toWx(w) : null;
    const cfg = { ...board, showWeather: !!wx };
    let radarState = NO_RADAR;
    try { if (st) radarState = radar.want(st.mapid, st.lat, st.lon); }
    catch (e) { log.error('[board] radar:', e.message); }
    // Test radar loop from the simulator (expires with the test alerts).
    const test = activeTest(id, nowSecs());
    if (test && test.radar && st) {
      try { radarState = { ...radarState, ...(await testRadar.want(test.radar, st, nowSecs())) }; }
      catch (e) { log.error('[board] test radar:', e.message); }
    }
    // The radar screen is the weather screen: the radar loop only while rain
    // is in the box (frames are sent only then), current conditions otherwise.
    // Rain bars (wxRain 'bars'): while precipitation is falling or due in
    // the next 2 hours they replace the radar loop (no frames sent).
    const rain = board.wxRain === 'bars' && w ? toRain(w, now) : null;
    if (!radarState.on || rain) radarState = { ...radarState, frames: [], ft: [] };
    // The 5-day layout (wxView) draws when wx carries the days.
    const days = board.wxView === '5day' && w ? toDays(w) : null;
    if (w) radarState = { ...radarState, wx: { ...toScreenWx(w), ...(days ? { days } : {}), ...(rain ? { rain } : {}) } };
    let alertLines = new Set();
    try { alertLines = boardAlertLines(alerts && alerts.get() ? alerts.get().alerts : []); }
    catch (e) { log.error('[board] alerts:', e.message); }
    // Test alerts from the simulator (expire on their own).
    if (test) for (const ln of test.lines) alertLines.add(ln);
    let games = [];
    const bbTeams = board.bbTeams || ['cubs', 'sox', 'post'];
    try {
      games = mlb.get(board.screen === 'baseball' ? 'forced' : 'auto', {
        teams: board.screen === 'baseball' ? ['cubs', 'sox', 'post'] : bbTeams,
        pre: (board.bbPre != null ? board.bbPre : 30) * 60, final: (board.bbFinal != null ? board.bbFinal : 15) * 60,
      });
      games = prioritize(games, board.bbPriority, bbTeams);
    } catch (e) { log.error('[board] mlb:', e.message); }
    if (test && test.game) games = [testGame(test.game, now), ...games];
    const warn = (test && test.warn) || pickWarn(nwsAlerts, now);
    const screen = resolveScreen(board, games.length > 0, warn);
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
      rot: rotOf(board, screen),
      bright: resolveBright(board.bright, w, now),
      // Transit header and weather row as fitted to the destinations; the
      // ticker always shows its header (hiding it frees no room it can use).
      header: bars.showHeader ? board.station.name : null,
      headerDivider: board.headerDivider === true,
      wxDivider: board.wxDivider !== false,
      tickerHeader: board.station.name,
      // Header clock (transit and ticker) and line-colored labels.
      hclock: board.headerClock !== false,
      lnc: board.lineNames === 'line',
      hidden: bars.hidden,
      view,
      rows,
      ticker,
      wx: bars.showWeather ? wx : null,
      warn,
      anim: animOf(board),
      tickerFill: board.tickerFill || 55,
      radar: {
        ...radarState, visit: visitOf(board), showTime: board.radarTime !== false, tempShadow: board.tempShadow === true, temp: w ? toWx(w).temp : null, icon: w ? toWx(w).icon : null,
        // Radar clock: the current time instead of the frame's; conditions under it.
        ...(board.radarClock === 'now' ? { clock: 'now' } : {}),
        ...(board.radarCond === true ? { cond: true } : {}),
        // Precip brightness, percent (absent = 100).
        ...(board.radarBright != null && board.radarBright !== 100 ? { rb: board.radarBright } : {}),
      },
      mlb: board.baseballLayout === 'logos' || board.baseballLayout === 'bands'
        ? { layout: board.baseballLayout, dim: (board.logoBright || 90) / 100, games: games.map((g) => withLogos(g, board.baseballLayout === 'logos')), ...(board.bbPriority === 'all' ? { all: true } : {}) }
        : { layout: 'classic', games, ...(board.bbPriority === 'all' ? { all: true } : {}) },
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
      if (!authed(req)) return send(res, 401, { err: 'bad_token' });
      const board = store.get(String(parsed.query.b || ''));
      if (!board) return send(res, 404, { err: 'unknown_board' });
      noteHealth(String(parsed.query.b), parsed.query, nowSecs());
      return send(res, 200, { v: board.v, now: nowSecs() });
    }

    if (first === 'update' && rest.length === 0) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      if (!authed(req)) return send(res, 401, { err: 'bad_token' });
      const id = String(parsed.query.b || '');
      const board = store.get(id);
      if (!board) return send(res, 404, { err: 'unknown_board' });
      const body = await update(board, id, parsed.query.boot === '1');
      const shown = SCREENS.includes(parsed.query.s) ? parsed.query.s : body.screen;
      return send(res, 200, sectionsFor(body, shown));
    }

    // One radar frame for the board's station: 2048 bytes, immutable;
    // pk=4: packed to 1024 (radar.packFrame), as the board stores them.
    if (first === 'radar' && rest.length === 1) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      if (!authed(req)) return send(res, 401, { err: 'bad_token' });
      const board = store.get(String(parsed.query.b || ''));
      if (!board) return send(res, 404, { err: 'unknown_board' });
      const bytes = radar.frame(board.station.mapid, rest[0]) || testRadar.frame(rest[0]);
      return sendFrame(res, bytes && parsed.query.pk === '4' ? packFrame(bytes) : bytes);
    }

    // One team logo crop: 24 x 12 RGB (864 bytes), immutable (the id carries a hash).
    if (first === 'logo' && rest.length === 1) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      if (!authed(req)) return send(res, 401, { err: 'bad_token' });
      return sendLogo(res, logos.bytes(rest[0]));
    }

    // ---- control endpoints, under the secret path ----
    if (controlPath && first && sameSecret(first, controlPath)) {
      const sub = rest.join('/');

      // Phone control page. Relative URLs need the trailing slash.
      if (sub === '') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        if (!parsed.pathname.endsWith('/')) {
          res.writeHead(301, { Location: parsed.pathname + '/' + (parsed.search || '') });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(CONTROL_HTML);
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
      if (sub === 'api/health') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        return send(res, 200, Object.fromEntries(healthOf));
      }
      if (sub === 'api/state') {
        if (method === 'GET') return send(res, 200, store.all());
        if (method === 'POST') {
          const id = String(parsed.query.b || '');
          try {
            const patch = await readJson(req);
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
          if (t.lines.length || t.warn || t.game || t.radar) tests.set(id, { ...t, until: now + TEST_S });
          else tests.delete(id);
        } else if (method !== 'GET') {
          return send(res, 405, { err: 'method' });
        }
        const t = activeTest(id, now);
        return send(res, 200, t ? { lines: t.lines, warn: t.warn, game: t.game || null, radar: t.radar || null, left: t.until - now } : { lines: [], warn: null, game: null, radar: null, left: 0 });
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
        const screen = ['transit', 'ticker', 'weather', 'baseball'].includes(parsed.query.screen) ? parsed.query.screen : autoScreen(body, body.now);
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
        });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(frame.toPNG(scale));
        return;
      }

      // Raw MLB schedule (as the poller last fetched it) for recording fixtures.
      if (sub === 'api/raw/mlb') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const raw = mlb.raw ? mlb.raw() : null;
        if (!raw) return send(res, 503, { err: 'not_ready' });
        return send(res, 200, raw);
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
