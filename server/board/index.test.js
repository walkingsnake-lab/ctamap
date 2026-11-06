'use strict';
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const url = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBoard } = require('./index');
const { createStore } = require('./state');

const quiet = { warn() {}, error() {} };
const fakeLogos = (have = {}) => ({
  get: (ab) => (have[ab] ? { id: `${ab}-1`, band: have[ab] } : null),
  bytes: (id) => (Object.keys(have).some((ab) => id === `${ab}-1`) ? Buffer.alloc(864, 7) : null),
  status: () => ({ teams: Object.keys(have).sort(), updated: null }),
  uploadSheet: () => { throw new Error('not a PNG'); },
  uploadOne: (ab) => { throw new Error(`unknown team: ${ab}`); },
});
const fakeMlb = (games = [], forcedGames = games) => ({ get: (mode) => (mode === 'forced' ? forcedGames : games), raw: () => null });

// Spin up a server that routes /board/* the same way server.js does.
// The whole /board/update payload (the simulator's copy). The board's own
// endpoint sends only the shown screen's sections; see the sections test.
const FULL = '/board/secret123/api/update?b=home';

// Servers still open when a test fails never reach their close() call, and
// the open socket keeps `node --test` from exiting. Close them all at the end.
const openServers = new Set();
after(() => { for (const srv of openServers) { srv.closeAllConnections(); srv.close(); } });

async function serve(opts = {}) {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'board-http-')), log: quiet });
  const radar = opts.radar || fakeRadar();
  const board = createBoard({ store, token: 'tok', controlPath: 'secret123', log: quiet, weather: fakeWeather(null), nws: fakeWeather(null), nwsForecast: fakeWeather(null), mlb: fakeMlb(), logos: fakeLogos(), ...opts, radar });
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    if (parsed.pathname.startsWith('/board/')) return board.handle(req, res, parsed);
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  openServers.add(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (p, init = {}) => {
    const r = await fetch(base + p, init);
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  return { req, store, radar, port: server.address().port, close: () => new Promise((r) => { openServers.delete(server); server.close(r); }) };
}

test('ping needs no token', async () => {
  const s = await serve();
  const r = await s.req('/board/ping');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: 1 });
  assert.equal(r.headers.get('cache-control'), 'no-store');
  await s.close();
});

test('version requires the token and a known board', async () => {
  const s = await serve();
  assert.equal((await s.req('/board/version?b=home')).status, 401);
  assert.equal((await s.req('/board/version?b=home', { headers: { 'X-Board-Token': 'nope' } })).status, 401);
  const unknown = await s.req('/board/version?b=nope', { headers: { 'X-Board-Token': 'tok' } });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.err, 'unknown_board');
  const ok = await s.req('/board/version?b=home', { headers: { 'X-Board-Token': 'tok' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.v, 1);
  assert.ok(Math.abs(ok.body.now - Date.now() / 1000) < 5);
  await s.close();
});

test('update: the board gets only the shown screen\'s sections; a button press asks for its screen', async () => {
  const now = Math.floor(Date.now() / 1000);
  const radar = { on: true, frames: ['40100-1'], ft: [now], timeBox: [40, 0, 24, 22], split: false };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), radar: fakeRadar(radar) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const get = async (q = '') => (await s.req('/board/update?b=home' + q, h)).body;
  let b = await get(); // transit (auto, no game)
  assert.equal(b.for, 'transit');
  assert.ok('rows' in b && 'view' in b);
  assert.ok(!('ticker' in b) && !('mlb' in b));
  assert.deepEqual(b.radar, { on: true, visit: null }); // no visits: just `on`
  for (const k of ['v', 'now', 'tzo', 'screen', 'bright', 'warn', 'anim']) assert.ok(k in b, k);
  b = await get('&s=ticker'); // a button press on the board
  assert.equal(b.for, 'ticker');
  assert.ok('ticker' in b && 'tickerHeader' in b && !('rows' in b));
  b = await get('&s=weather');
  assert.deepEqual(b.radar.frames, ['40100-1']);
  assert.ok(!('rows' in b) && !('ticker' in b));
  b = await get('&s=bogus');
  assert.equal(b.for, 'transit');
  // Timed visits: the whole radar rides along on every screen.
  s.store.update('home', { wxVisit: 'rain', radarEvery: 5 });
  b = await get();
  assert.deepEqual(b.radar.frames, ['40100-1']);
  assert.ok(b.radar.visit);
  await s.close();
});

test('health rides on the version check and shows on the control API', async () => {
  const s = await serve();
  const h = { headers: { 'X-Board-Token': 'tok' } };
  assert.deepEqual((await s.req('/board/secret123/api/health')).body, {});
  await s.req('/board/version?b=home', h); // no health fields: nothing stored
  assert.deepEqual((await s.req('/board/secret123/api/health')).body, {});
  await s.req('/board/version?b=home&hu=3600&hb=1100&ho=2&hf=5&hr=1&hm=26000&hl=4032&hw=-61&he=radar:MemoryError', h);
  let r = (await s.req('/board/secret123/api/health')).body.home;
  assert.deepEqual({ ...r, at: 0, since: 0 }, {
    at: 0, since: 0, uptime: 3600, budget: 1100, oom: 2, fails: 5, reconnects: 1, memFree: 26000, largestBlock: 4032, rssi: -61,
    lastError: 'radar:MemoryError', minMem: 26000, restarts: 0, lastRestart: null,
  });
  // A light sensor's reading (lux).
  await s.req('/board/version?b=home&hu=3700&hb=1100&ho=2&hf=5&hr=1&ha=0.42', h);
  assert.equal((await s.req('/board/secret123/api/health')).body.home.lux, 0.42);
  // Uptime going backwards is a restart; the lowest free memory is kept;
  // an error string that isn't plain letters is dropped.
  await s.req('/board/version?b=home&hu=30&hb=1000&ho=0&hf=0&hr=0&hm=28000&he=%3Cscript%3E', h);
  r = (await s.req('/board/secret123/api/health')).body.home;
  assert.equal(r.restarts, 1);
  assert.equal(r.minMem, 26000);
  assert.equal(r.lastError, undefined);
  assert.ok(Math.abs(r.lastRestart - (Date.now() / 1000 - 30)) < 5);
  // A crash reload: what started the run and the crash that ended the last
  // one. The crash stays through a later restart that wasn't one.
  await s.req('/board/version?b=home&hu=5&hs=SUPERVISOR_RELOAD&hc=MemoryError:player:312:quiet_ms', h);
  r = (await s.req('/board/secret123/api/health')).body.home;
  assert.equal(r.restarts, 2);
  assert.equal(r.started, 'SUPERVISOR_RELOAD');
  assert.equal(r.lastCrash, 'MemoryError:player:312:quiet_ms');
  await s.req('/board/version?b=home&hu=2&hs=POWER_ON&hc=%3Cx%3E', h);
  r = (await s.req('/board/secret123/api/health')).body.home;
  assert.equal(r.started, 'POWER_ON');
  assert.equal(r.lastCrash, 'MemoryError:player:312:quiet_ms');
  // Hardware and firmware build; anything but plain letters is dropped.
  await s.req('/board/version?b=home&hu=60&hd=adafruit_matrixportal_s3&hv=a1b2c3d_dirty', h);
  r = (await s.req('/board/secret123/api/health')).body.home;
  assert.equal(r.hardware, 'adafruit_matrixportal_s3');
  assert.equal(r.firmware, 'a1b2c3d_dirty');
  await s.req('/board/version?b=home&hu=61&hv=a%20b', h);
  r = (await s.req('/board/secret123/api/health')).body.home;
  assert.equal(r.firmware, undefined);
  await s.close();
});

test('without BOARD_TOKEN, board endpoints are open', async () => {
  const s = await serve({ token: '' });
  assert.equal((await s.req('/board/version?b=home')).status, 200);
  await s.close();
});

test('control API reads and updates state; a phone change bumps the version', async () => {
  const s = await serve();
  const all = await s.req('/board/secret123/api/state');
  assert.equal(all.status, 200);
  assert.ok(all.body.boards.home);

  const upd = await s.req('/board/secret123/api/state?b=home', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ screen: 'ticker' }),
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.screen, 'ticker');

  const v = await s.req('/board/version?b=home', { headers: { 'X-Board-Token': 'tok' } });
  assert.equal(v.body.v, 2);
  await s.close();
});

test('control API rejects bad input with 400', async () => {
  const s = await serve();
  const bad = await s.req('/board/secret123/api/state?b=home', { method: 'POST', body: '{"screen":"buses"}' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.err, 'invalid');
  const notJson = await s.req('/board/secret123/api/state?b=home', { method: 'POST', body: 'nope' });
  assert.equal(notJson.status, 400);
  await s.close();
});

test('wrong control path, missing control path, and unknown routes are 404', async () => {
  const s = await serve();
  assert.equal((await s.req('/board/secret124/api/state')).status, 404);
  assert.equal((await s.req('/board/nothing')).status, 404);
  await s.close();
  const off = await serve({ controlPath: '' });
  assert.equal((await off.req('/board/secret123/api/state')).status, 404);
  await off.close();
});

test('a control path that collides with an endpoint disables control', async () => {
  const s = await serve({ controlPath: 'ping' });
  assert.deepEqual((await s.req('/board/ping')).body, { ok: 1 });
  assert.equal((await s.req('/board/ping/api/state')).status, 404);
  await s.close();
});

test('wrong methods get 405', async () => {
  const s = await serve();
  assert.equal((await s.req('/board/ping', { method: 'POST' })).status, 405);
  assert.equal((await s.req('/board/secret123/api/state', { method: 'DELETE' })).status, 405);
  await s.close();
});

test('raw arrivals capture passes the upstream body through, behind the control path', async () => {
  const calls = [];
  const capture = {
    rawArrivals: async (mapid) => { calls.push(mapid); return { status: 200, body: '{"ctatt":{"errCd":"0"}}' }; },
  };
  const s = await serve({ capture });
  const r = await s.req('/board/secret123/api/raw/arrivals?mapid=40100');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ctatt: { errCd: '0' } });
  assert.deepEqual(calls, ['40100']);
  assert.equal((await s.req('/board/secret123/api/raw/arrivals?mapid=99999')).status, 400);
  assert.equal((await s.req('/board/wrong/api/raw/arrivals?mapid=40100')).status, 404);
  assert.deepEqual(calls, ['40100']);
  await s.close();
});

test('raw arrivals capture reports upstream failures as 502', async () => {
  const s = await serve({ capture: { rawArrivals: async () => { throw new Error('timeout'); } } });
  const r = await s.req('/board/secret123/api/raw/arrivals?mapid=40100');
  assert.equal(r.status, 502);
  assert.equal(r.body.err, 'upstream');
  await s.close();
});

test('raw weather capture: the station cell\'s WeatherAPI response, behind the control path', async () => {
  const asked = [];
  const weather = { get: async () => null, raw: async (lat, lon) => { asked.push([lat, lon]); return { current: { temp_f: 50 } }; } };
  const s = await serve({ weather });
  const r = await s.req('/board/secret123/api/raw/weather?mapid=40100');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { current: { temp_f: 50 } });
  assert.deepEqual(asked, [[42.008362, -87.665909]]); // the station; createWeather maps it to its cell
  assert.equal((await s.req('/board/secret123/api/raw/weather?mapid=99999')).status, 400);
  assert.equal((await s.req('/board/wrong/api/raw/weather?mapid=40100')).status, 404);
  await s.close();
  const down = await serve({ weather: { get: async () => null, raw: async () => { throw new Error('HTTP 403'); } } });
  const d = await down.req('/board/secret123/api/raw/weather?mapid=40100');
  assert.equal(d.status, 502);
  assert.equal(d.body.err, 'upstream');
  await down.close();
});

// ---- /board/update ----

const { normalize } = require('./arrivals');
const morseJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tt-arrivals', 'morse-2026-10-03-2316.json'), 'utf8'));

function fakeRadar(state = { on: false, frames: [], ft: [], timeBox: [40, 0, 24, 32], split: true }, frames = {}) {
  const wants = [];
  return { wants, want: (mapid, lat, lon, opts = {}) => { wants.push(!!opts.wide); return opts.wide ? { ...state, wide: 1 } : state; }, frame: (mapid, id) => frames[`${mapid}/${id}`] || null };
}

function fakeWeather(data) {
  const asked = [];
  return { asked, get: async (lat, lon) => { asked.push([lat, lon]); return data; } };
}

function fakeTracker(data) {
  const asked = [];
  return { asked, get: async (mapid) => { asked.push(mapid); return data; } };
}

test('update: auth, unknown board, and no Train Tracker data yet', async () => {
  const s = await serve({ tracker: fakeTracker(null), mlb: fakeMlb([{ id: 7, st: 'pre', start: 1, away: {}, home: {} }]) });
  assert.equal((await s.req('/board/update?b=home')).status, 401);
  assert.equal((await s.req('/board/update?b=Bad_ID', { headers: { 'X-Board-Token': 'tok' } })).status, 404);
  assert.equal((await s.req('/board/update?b=home', { headers: { 'X-Board-Token': 'tok' } })).status, 200);
  // Everything but the trains still works; transit says NO DATA.
  const r = await s.req(FULL);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.age, r.body.stale, r.body.rows, r.body.ticker], [null, 1, [], []]);
  s.store.update('home', { screen: 'baseball' });
  assert.equal((await s.req(FULL)).body.mlb.games.length, 1);
  await s.close();
});

test('update: arrivals older than 3 minutes are stale; the times themselves are unchanged', async () => {
  const now = Math.floor(Date.now() / 1000);
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const at = (fetchedAt) => fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  let s = await serve({ tracker: at(now - 170) });
  let b = (await s.req(FULL)).body;
  assert.equal(b.stale, 0);
  const fresh = b.rows;
  await s.close();
  s = await serve({ tracker: at(now - 190) });
  b = (await s.req(FULL)).body;
  assert.equal(b.stale, 1);
  assert.deepEqual(b.rows.map((r) => r.s), fresh.map((r) => r.s));
  await s.close();
});

test('update: payload shape for the default Morse board', async () => {
  const now = Math.floor(Date.now() / 1000);
  // Shift the Morse fixture so its arrivals are in the future relative to now.
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const tracker = fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now - 7 });
  const s = await serve({ tracker });
  const r = await s.req(FULL);
  assert.equal(r.status, 200);
  const b = r.body;
  assert.deepEqual(tracker.asked, ['40100']);
  assert.equal(b.v, 1);
  assert.ok(Math.abs(b.now - now) < 5);
  assert.ok(b.tzo === -5 * 3600 || b.tzo === -6 * 3600);
  assert.ok(b.age >= 7 && b.age < 12);
  assert.equal(b.screen, 'transit');
  assert.equal(b.bright, 100);
  assert.equal(b.header, 'MORSE');
  assert.deepEqual(b.rows.map((x) => x.lbl), ['HOWARD', '95TH']);
  assert.equal(b.ticker.length, 6);
  assert.equal(b.wx, null);
  assert.equal(b.radar.on, false);
  assert.ok(JSON.stringify(b).length < 1200, `payload ${JSON.stringify(b).length} bytes`);
  await s.close();
});

test('update: speed settings and ticker fill are sent as anim (ms) and tickerFill', async () => {
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: Math.floor(Date.now() / 1000) }) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  let b = (await s.req(FULL)).body;
  assert.deepEqual(b.anim, { pageHold: 8000, slide: 1200, radarFrame: 500, radarHold: 4000, game: 60 });
  assert.equal(b.tickerFill, 55);
  s.store.update('home', { tickerHold: 5, tickerSlide: 800, radarFrame: 700, radarHold: 2, gameEvery: 90, tickerFill: 40 });
  b = (await s.req(FULL)).body;
  assert.deepEqual(b.anim, { pageHold: 5000, slide: 800, radarFrame: 700, radarHold: 2000, game: 90 });
  assert.equal(b.tickerFill, 40);
  await s.close();
});

test('update: boot=1 keeps the screen and brightness (Off too) and bumps v; settings flow through', async () => {
  const tracker = fakeTracker({ arrivals: [], fetchedAt: Math.floor(Date.now() / 1000) });
  const s = await serve({ tracker });
  s.store.update('home', { screen: 'ticker', bright: 'off', showHeader: false });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  let b = (await s.req(FULL)).body;
  assert.equal(b.screen, 'ticker');
  assert.equal(b.bright, 0);
  assert.equal(b.header, null);
  assert.equal(b.tickerHeader, 'MORSE');   // the ticker header ignores the toggle
  assert.deepEqual(b.rows, []);
  b = (await s.req('/board/update?b=home&boot=1', h)).body;
  assert.equal(b.screen, 'ticker');
  assert.equal(b.bright, 0); // Off stays off through a restart
  assert.equal(b.v, 3);
  await s.close();
});

// ---- simulator ----

test('simulator page, PNG frames, and update proxy live under the control path', async () => {
  const now = Math.floor(Date.now() / 1000);
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const s = await serve({ tracker: fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now }) });
  const page = await fetch(`http://127.0.0.1:${s.port}/board/secret123/sim`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Board simulator/);
  const png = await fetch(`http://127.0.0.1:${s.port}/board/secret123/sim.png?b=home&screen=ticker&scale=4`);
  assert.equal(png.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await png.arrayBuffer());
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  assert.equal(buf.readUInt32BE(16), 256); // 64 px * scale 4
  const upd = await s.req('/board/secret123/api/update?b=home');
  assert.equal(upd.status, 200);
  assert.equal(upd.body.header, 'MORSE');
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/board/wrong/sim`)).status, 404);
  await s.close();
});

test('width: w=128 on update and select makes a wide board (cols 128); no w is 64', async () => {
  const now = Math.floor(Date.now() / 1000);
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const s = await serve({ tracker: fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now }) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  // A 64 board's payload is as before: no cols.
  let b = (await s.req('/board/update?b=home', h)).body;
  assert.equal('cols' in b, false);
  assert.equal(s.store.get('home').cols, undefined);
  // Two panels: the same request says so, and its own payload carries it.
  const v = s.store.get('home').v;
  b = (await s.req('/board/update?b=home&w=128', h)).body;
  assert.equal(b.cols, 128);
  assert.equal(s.store.get('home').cols, 128);
  assert.equal(s.store.get('home').v, v, 'the width is no settings change');
  // Transit for the width: Morse runs north-south, so the split (the default).
  assert.equal(b.view, 'split');
  assert.deepEqual(b.halves, ['NORTHBOUND', 'SOUTHBOUND']);
  assert.deepEqual(b.rows.map((r) => [r.h, r.lbl]), [[0, 'HOWARD'], [1, '95TH']]);
  const J0 = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await s.req('/board/secret123/api/state?b=home', J0('POST', { wideLayout: 'rows' }));
  b = (await s.req('/board/update?b=home&w=128', h)).body;
  assert.deepEqual([b.view, 'halves' in b, b.rows[1].lbl, b.rows[0].t.length], ['dest', false, '95TH/DAN RYAN', 5]);
  // Off the transit screen, the halves go with the rest of its section.
  await s.req('/board/secret123/api/state?b=home', J0('POST', { wideLayout: 'split' }));
  assert.equal('halves' in (await s.req('/board/update?b=home&w=128&s=ticker', h)).body, false);
  // The simulator, the control page's renders and the board list know it.
  assert.equal((await s.req('/board/secret123/api/update?b=home')).body.cols, 128);
  const png = await fetch(`http://127.0.0.1:${s.port}/board/secret123/sim.png?b=home&screen=transit&scale=2`);
  assert.equal(Buffer.from(await png.arrayBuffer()).readUInt32BE(16), 256); // 128 px * scale 2
  assert.equal((await s.req('/board/secret123/api/boards')).body.find((x) => x.id === 'home').cols, 128);
  // Select answers for the width too.
  b = (await s.req('/board/select?b=home&s=weather&w=128', { method: 'POST', ...h })).body;
  assert.equal(b.cols, 128);
  // Radar: the wide board asks for the 128-wide crops.
  assert.equal(s.radar.wants[s.radar.wants.length - 1], true);
  assert.equal((await s.req('/board/update?b=home&w=128&s=weather', h)).body.radar.wide, 1);
  // Back on one panel (an M4, or a board set up again): no w.
  b = (await s.req('/board/update?b=home', h)).body;
  assert.equal('cols' in b, false);
  assert.equal(s.store.get('home').cols, undefined);
  assert.equal('cols' in (await s.req('/board/secret123/api/boards')).body.find((x) => x.id === 'home'), false);
  // Only 128 is wide; the phone can't set it.
  await s.req('/board/update?b=home&w=96', h);
  assert.equal(s.store.get('home').cols, undefined);
  const J = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await s.req('/board/secret123/api/state?b=home', J('POST', { cols: 128 }))).status, 400);
  await s.close();
});

test('simulator: station list and previewing another station without changing the board', async () => {
  const tracker = fakeTracker({ arrivals: [], fetchedAt: Math.floor(Date.now() / 1000) });
  const s = await serve({ tracker });
  const list = await s.req('/board/secret123/api/stations');
  assert.equal(list.status, 200);
  assert.ok(list.body.length > 100);
  assert.ok(list.body.some((x) => x.mapid === '40100' && x.desc === 'Morse (Red Line)' && x.name === 'Morse' && x.lines.join() === 'RD'));
  const prev = await s.req('/board/secret123/api/update?b=home&mapid=40850');
  assert.equal(prev.body.header, 'HW LIBRARY');
  assert.deepEqual(tracker.asked, ['40850']);
  assert.equal(s.store.get('home').station.mapid, '40100'); // board unchanged
  assert.equal((await s.req('/board/secret123/api/update?b=home&mapid=99999')).status, 400);
  const png = await fetch(`http://127.0.0.1:${s.port}/board/secret123/sim.png?b=home&mapid=40850`);
  assert.equal(png.status, 200);
  await s.close();
});

test('simulator serves draw.js and the assets it runs on', async () => {
  const s = await serve({ tracker: fakeTracker(null) });
  const js = await fetch(`http://127.0.0.1:${s.port}/board/secret123/draw.js`);
  assert.equal(js.headers.get('content-type'), 'application/javascript');
  assert.match(await js.text(), /BoardDraw/);
  const assets = await s.req('/board/secret123/sim-assets.json');
  assert.ok(assets.body.fonts.small['65']); // 'A'
  assert.ok(assets.body.icons.ICONS.sun);
  assert.equal(assets.body.glyphs.CLOCK, 0xe006);
  await s.close();
});

// ---- phone control page ----

test('control page is served at the secret path, with a trailing-slash redirect', async () => {
  const s = await serve({ tracker: fakeTracker(null) });
  const base = `http://127.0.0.1:${s.port}`;
  const page = await fetch(`${base}/board/secret123/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /apple-mobile-web-app-capable/);
  const bare = await fetch(`${base}/board/secret123?b=home`, { redirect: 'manual' });
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get('location'), '/board/secret123/?b=home');
  assert.equal((await fetch(`${base}/board/wrong/`)).status, 404);
  await s.close();
});

test('destinations: every destination the lines can show, plus live and chosen ones', async () => {
  const live = [{ ln: 'RD', dest: 'Howard' }, { ln: 'RD', dest: 'Granville' }];
  const s = await serve({ tracker: fakeTracker({ arrivals: live, fetchedAt: 0 }) });
  // Belmont: Purple's rush-only Linden/Loop are offered even with none running.
  const b = await s.req('/board/secret123/api/destinations?b=home&mapid=41320');
  assert.equal(b.status, 200);
  assert.deepEqual(b.body.map((d) => d.key), ['RD:Howard', 'RD:95th', 'BR:Kimball', 'BR:Loop', 'PR:Linden', 'PR:Loop', 'RD:Granville']);
  assert.deepEqual(b.body[0], { key: 'RD:Howard', ln: 'RD', name: 'Howard', live: 1 });
  assert.equal(b.body[1].live, 0);
  // Howard: trains ending at Howard aren't offered.
  const h = await s.req('/board/secret123/api/destinations?mapid=40900');
  assert.ok(!h.body.some((d) => d.name === 'Howard' && !d.live));
  assert.ok(h.body.some((d) => d.key === 'YL:Skokie'));
  // A chosen row is kept even if it isn't a usual destination.
  s.store.update('home', { rows: ['RD:Howard', 'RD:Loyola'] });
  const m = await s.req('/board/secret123/api/destinations?b=home&mapid=40100');
  assert.ok(m.body.some((d) => d.key === 'RD:Loyola'));
  assert.equal((await s.req('/board/secret123/api/destinations?mapid=1')).status, 400);
  await s.close();
});

test('changing the station resets the destination filter unless rows are sent too', async () => {
  const s = await serve({ tracker: fakeTracker(null) });
  s.store.update('home', { rows: ['RD:Howard'] });
  s.store.update('home', { station: { mapid: '40100' } }); // same station: kept
  assert.deepEqual(s.store.get('home').rows, ['RD:Howard']);
  s.store.update('home', { station: { mapid: '41320' } });
  assert.deepEqual(s.store.get('home').rows, []);
  s.store.update('home', { station: { mapid: '40100' }, rows: ['RD:95th'] });
  assert.deepEqual(s.store.get('home').rows, ['RD:95th']);
  await s.close();
});

// ---- weather and alerts in the update ----

test('update: weather row, auto brightness, and alert flags', async () => {
  const fx = (f) => path.join(__dirname, 'fixtures', f);
  const { parse } = require('./weather');
  const { parseAlerts } = require('./cta-alerts');
  const now = Math.floor(Date.now() / 1000);
  const json = JSON.parse(fs.readFileSync(fx('tt-arrivals/clark-lake-2026-10-03-2317.json'), 'utf8'));
  const arrivals = normalize(json, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const w = { ...parse(JSON.parse(fs.readFileSync(fx('weatherapi/morse-cell-2026-10-04-1045.json'), 'utf8'))), sunrise: now - 100, sunset: now + 100 };
  const weather = fakeWeather(w);
  // The recorded Orange/Green minor delay, rated major so it blinks.
  const xml = fs.readFileSync(fx('cta-alerts/2026-10-04-1057.xml'), 'utf8').replace('<SeverityCSS>minor</SeverityCSS>', '<SeverityCSS>major</SeverityCSS>');
  const alerts = { get: () => ({ alerts: parseAlerts(xml), fetchedAt: now }) };
  const s = await serve({ tracker: fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now }), weather, alerts });
  s.store.update('home', { station: { mapid: '40380' } }); // Clark/Lake
  s.store.update('home', { rows: ["BL:O'Hare", 'GR:Harlem'] }); // 2 destinations: everything fits
  const h = { headers: { 'X-Board-Token': 'tok' } };
  let b = (await s.req(FULL)).body;
  assert.deepEqual(weather.asked.at(-1), [41.885737, -87.630886]); // the station's coordinates
  assert.deepEqual(b.wx, { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51 });
  assert.equal(b.header, 'CLARK/LAKE');
  assert.deepEqual(b.hidden, []);
  assert.equal(b.bright, 100);
  // All 5 destinations: weather and header are hidden to fit them as rows;
  // the ticker keeps its header.
  s.store.update('home', { rows: [] });
  b = (await s.req(FULL)).body;
  assert.equal(b.view, 'dest');
  assert.equal(b.rows.length, 5);
  assert.deepEqual([b.header, b.wx, b.tickerHeader], [null, null, 'CLARK/LAKE']);
  assert.deepEqual(b.hidden, ['weather', 'header']);
  // Green has a major delay; Blue only has a planned schedule change.
  for (const r of b.rows) assert.equal(r.a, r.ln === 'GR' ? 1 : 0, `${r.ln} ${r.lbl}`);
  assert.ok(b.ticker.every((x) => x.a === (x.ln === 'GR' || x.ln === 'OR' ? 1 : 0)));
  // Weather row off: no wx either way.
  s.store.update('home', { showWeather: false });
  b = (await s.req(FULL)).body;
  assert.equal(b.wx, null);
  // Overnight: auto brightness dims.
  w.sunset = now - 1;
  b = (await s.req(FULL)).body;
  assert.equal(b.bright, 40);
  assert.deepEqual(b.ab, { min: 40 });
  // The night level is also the light sensor's dark-room level; day stays full.
  s.store.update('home', { brightMin: 20 });
  b = (await s.req(FULL)).body;
  assert.equal(b.bright, 20);
  assert.deepEqual(b.ab, { min: 20 });
  w.sunset = now + 3600;
  assert.equal((await s.req(FULL)).body.bright, 100);
  w.sunset = now - 1;
  // Fixed or off: the sensor doesn't apply.
  s.store.update('home', { bright: 70 });
  b = (await s.req(FULL)).body;
  assert.equal(b.bright, 70);
  assert.equal(b.ab, null);
  assert.equal(b.warn, null);
  await s.close();
});

test('update: an NWS warning in effect is sent as warn, even with the weather row off', async () => {
  const now = Math.floor(Date.now() / 1000);
  const iso = (t) => new Date(t * 1000).toISOString();
  const nwsJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nws', 'svr-warning-expired-2026-10-03-jax.json'), 'utf8'));
  const f = nwsJson.features[0].properties;
  Object.assign(f, { event: 'Tornado Warning', onset: iso(now - 60), ends: iso(now + 600), expires: iso(now + 600) });
  f.parameters.VTEC = ['/O.NEW.KLOT.TO.W.0001.000000T0000Z-000000T0000Z/'];
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), nws: fakeWeather(require('./nws').parse(nwsJson)) });
  s.store.update('home', { showWeather: false });
  const b = (await s.req(FULL)).body;
  assert.deepEqual(b.warn, { kind: 'tor', lvl: 'warning' });
  assert.equal(b.wx, null);
  await s.close();
});

// ---- radar ----

test('radar: frames by ID behind the token; auto stays on transit even when it rains', async () => {
  const now = Math.floor(Date.now() / 1000);
  const bytes = new Uint8Array(2048); bytes[16 * 64 + 20] = 7; bytes[0] = 3;
  const state = { on: true, frames: ['40100-202610041600'], ft: [now - 60], timeBox: [40, 0, 24, 32], split: true };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), radar: fakeRadar(state, { '40100/40100-202610041600': bytes }) });
  const base = `http://127.0.0.1:${s.port}`;
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const b = (await s.req(FULL)).body;
  assert.equal(b.screen, 'transit'); // no automatic switching unless radar visits are on
  assert.deepEqual({ ...b.radar, temp: undefined, icon: undefined }, { ...state, visit: null, showTime: true, tempShadow: false, temp: undefined, icon: undefined });
  assert.equal((await fetch(`${base}/board/radar/40100-202610041600?b=home`)).status, 401);
  const r = await fetch(`${base}/board/radar/40100-202610041600?b=home`, h);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.match(r.headers.get('cache-control'), /immutable/);
  const got = new Uint8Array(await r.arrayBuffer());
  assert.equal(got.length, 2048);
  assert.equal(got[0], 3);
  // pk=4: packed for the board, two pixels a byte, left in the high nibble.
  const pr = await fetch(`${base}/board/radar/40100-202610041600?b=home&pk=4`, h);
  assert.equal(pr.headers.get('content-length'), '1024');
  const packed = new Uint8Array(await pr.arrayBuffer());
  assert.deepEqual([...packed].flatMap((b) => [b >> 4, b & 15]), [...got]);
  assert.equal((await fetch(`${base}/board/radar/40100-209901010000?b=home`, h)).status, 404);
  // Simulator copy, and a PNG of the radar screen.
  assert.equal((await fetch(`${base}/board/secret123/api/radar/40100-202610041600?b=home`)).status, 200);
  const png = await fetch(`${base}/board/secret123/sim.png?b=home&screen=weather&scale=2`);
  assert.equal(png.status, 200);
  // A forced screen still wins over auto.
  s.store.update('home', { screen: 'transit' });
  assert.equal((await s.req(FULL)).body.screen, 'transit');
  await s.close();
});

test('Rain nearby: off by default, then on a timer on any screen but weather; holds from the phone', async () => {
  const now = Math.floor(Date.now() / 1000);
  const state = { on: true, frames: ['40100-202610041600'], ft: [now - 60], timeBox: [40, 0, 24, 32], split: true };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), radar: fakeRadar(state, {}) });
  const post = (body) => s.req('/board/secret123/api/state?b=home', { method: 'POST', body: JSON.stringify(body) });
  const get = async () => (await s.req(FULL)).body;
  assert.equal((await get()).radar.visit, null);
  assert.equal((await post({ wxVisit: 'rain', radarEvery: 4, radarFor: 60 })).status, 200);
  assert.deepEqual((await get()).radar.visit, { every: 240, for: 60 });
  await post({ wxVisit: 'always' });
  assert.deepEqual((await get()).radar.visit, { every: 240, for: 60, always: true });
  await post({ wxVisit: 'rain' });
  // The visit can't outlast its cycle.
  await post({ radarEvery: 1, radarFor: 120 });
  assert.deepEqual((await get()).radar.visit, { every: 60, for: 60 });
  // Any chosen screen gets visits, but the weather screen (it shows the radar).
  await post({ screen: 'ticker' });
  let b = await get();
  assert.deepEqual([b.screen, b.radar.visit], ['ticker', { every: 60, for: 60 }]);
  await post({ screen: 'clock' });
  assert.deepEqual((await get()).radar.visit, { every: 60, for: 60 });
  await post({ screen: 'weather' });
  assert.equal((await get()).radar.visit, null);
  await post({ screen: 'transit', radarEvery: 4 });
  // Holds: "Back to Transit now" ends this visit; "Stop until the rain passes".
  const rain = (body) => s.req('/board/secret123/api/rain?b=home', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await rain({ hold: 'later' })).status, 400);
  assert.equal((await rain({ hold: 'visit' })).status, 200);
  b = await get();
  assert.deepEqual([b.radar.visit, b.radar.held], [null, 'visit']);
  assert.equal((await rain({ hold: null })).status, 200);
  assert.deepEqual((await get()).radar.visit, { every: 240, for: 120 });
  await rain({ hold: 'rain' });
  assert.equal((await get()).radar.held, 'rain');
  state.on = false; // dry: the hold ends with the rain
  assert.equal((await get()).radar.held, undefined);
  state.on = true;
  assert.deepEqual((await get()).radar.visit, { every: 240, for: 120 });
  // Holds are kept in the state file (they survive a restart).
  await rain({ hold: 'rain' });
  assert.deepEqual(s.store.get('home').rainHold, { rain: true });
  await rain({ hold: null });
  assert.equal(s.store.get('home').rainHold, undefined);
  // The board's knob ended a visit (hq on the version check): held until then.
  const until = Math.floor(now / 240) * 240 + 240;
  await s.req(`/board/version?b=home&hq=${until}`, { headers: { 'X-Board-Token': 'tok' } });
  b = await get();
  assert.deepEqual([b.radar.visit, b.radar.held, s.store.get('home').rainHold], [null, 'visit', { until }]);
  await s.req(`/board/version?b=home&hq=${now + 99999}`, { headers: { 'X-Board-Token': 'tok' } }); // out of range: ignored
  assert.deepEqual(s.store.get('home').rainHold, { until });
  assert.equal((await post({ radarEvery: 61 })).status, 400);
  assert.equal((await post({ radarFor: 5 })).status, 400);
  await s.close();
});

test('Cycle: its screens take turns; nothing takes it over (ballgames, alerts); baseball priority', async () => {
  const now = Math.floor(Date.now() / 1000);
  const live = (id, away, home) => ({ id, st: 'live', start: now - 3600, inn: 3, half: 'T', away: { ab: away, c: '#000000', r: 1 }, home: { ab: home, c: '#000000', r: 0 } });
  let games = [];
  const mlb = { get: (mode, opts) => { mlb.asked = opts; return games; }, raw: () => null };
  let warn = null;
  const nws = { get: async () => (warn ? [{ status: 'Actual', messageType: 'Alert', kind: 'svr', lvl: warn, rank: warn === 'warning' ? 3 : 2 }] : []) };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), mlb, nws });
  const post = (body) => s.req('/board/secret123/api/state?b=home', { method: 'POST', body: JSON.stringify(body) });
  const get = async () => (await s.req(FULL)).body;
  const h = { headers: { 'X-Board-Token': 'tok' } };
  // Defaults: transit, no rotation.
  let b = await get();
  assert.deepEqual([b.screen, b.rot, b.hclock, b.lnc, b.croll], ['transit', null, true, false, true]);
  // The Cycle (screen 'auto'): transit and weather by default.
  await post({ screen: 'auto' });
  b = await get();
  assert.deepEqual([b.screen, b.rot], ['transit', { screens: ['transit', 'weather'], every: 60 }]);
  await post({ cycle: ['ticker', 'transit'], autoEvery: 120 });
  b = await get();
  assert.deepEqual([b.screen, b.rot], ['ticker', { screens: ['ticker', 'transit'], every: 120 }]);
  // The board's copy carries every Cycle screen's sections.
  let board = (await s.req('/board/update?b=home', h)).body;
  assert.ok('rows' in board && 'ticker' in board);
  // A board without clock firmware cycles only through what it draws.
  await post({ cycle: ['clock', 'weather', 'transit'] });
  board = (await s.req('/board/update?b=home', h)).body;
  assert.deepEqual([board.screen, board.rot], ['weather', { screens: ['weather', 'transit'], every: 120 }]);
  assert.ok(board.radar.frames, 'radar rides along for the weather turn');
  board = (await s.req('/board/update?b=home&hk=skyline', h)).body;
  assert.deepEqual(board.rot.screens, ['clock', 'weather', 'transit']);
  for (const bad of [['transit'], ['transit', 'transit'], ['transit', 'radar'], 'transit']) assert.equal((await post({ cycle: bad })).status, 400, JSON.stringify(bad));
  // Neither a game nor an NWS warning takes the Cycle over, and games aren't
  // even fetched unless baseball is shown.
  games = [live(1, 'CHC', 'STL')];
  warn = 'warning';
  await post({ alertJump: 'all' });
  b = await get();
  assert.deepEqual([b.screen, b.mlb.games], ['weather', []]); // the simulator's copy: no clock firmware reported
  warn = null;
  // Baseball as a Cycle turn gets the day's games.
  await post({ cycle: ['transit', 'baseball'] });
  assert.deepEqual((await get()).mlb.games.map((g) => g.id), [1]);
  // A shown Baseball screen asks for every game today.
  await post({ bbTeams: ['sox'], bbPre: 60, bbFinal: 5 });
  await get();
  assert.deepEqual(mlb.asked, { teams: ['cubs', 'sox', 'post'], pre: 3600, final: 300, line: false });
  // Priority: 'favorite' keeps only live Cubs/Sox games while one is on;
  // 'all' tells the board to rotate every game.
  games = [live(1, 'NYY', 'BOS'), live(2, 'CWS', 'CLE')];
  await post({ bbPriority: 'favorite' });
  assert.deepEqual((await get()).mlb.games.map((g) => g.id), [2]);
  await post({ bbPriority: 'all' });
  b = await get();
  assert.deepEqual([b.mlb.games.length, b.mlb.all], [2, true]);
  // Header clock and line-colored names.
  assert.equal(b.ts, false);
  await post({ headerClock: false, lineNames: 'line', timeSteps: true, clockRoll: false });
  b = await get();
  assert.deepEqual([b.hclock, b.lnc, b.ts, b.croll], [false, true, true, false]);
  await s.close();
});

test('update: weather screen gets conditions always, radar frames only while rain is in the box', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const w = parse(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8')));
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const screenWx = { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51, feels: 63, wind: 'NW 9', pop: 10 };
  let s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w) });
  s.store.update('home', { showWeather: false });
  let b = (await s.req(FULL)).body;
  assert.equal(b.wx, null); // weather row off...
  assert.deepEqual(b.radar.wx, screenWx); // ...but the weather screen still gets conditions
  await s.close();
  // Key layout: `key` sent, no weather strip even with it on; the weather screen still gets conditions.
  s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w) });
  s.store.update('home', { showWeather: true, transitLayout: 'key' });
  b = (await s.req(FULL)).body;
  assert.equal(b.key, 1);
  assert.equal(b.wx, null);
  assert.deepEqual(b.radar.wx, screenWx);
  s.store.update('home', { transitLayout: 'header' });
  b = (await s.req(FULL)).body;
  assert.equal(b.key, undefined);
  assert.equal(b.wx.temp, 63);
  await s.close();
  // Frames kept but no rain in the box: no frames sent, so the screen shows the weather.
  s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w), radar: fakeRadar({ on: false, frames: ['x'], ft: [now], timeBox: [40, 0, 24, 22], split: false }) });
  b = (await s.req(FULL)).body;
  assert.deepEqual(b.radar.frames, []);
  assert.deepEqual(b.radar.ft, []);
  assert.deepEqual(b.radar.wx, screenWx);
  await s.close();
  // Rain in the box: the loop's frames, and conditions still sent.
  s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w), radar: fakeRadar({ on: true, frames: ['x'], ft: [now], timeBox: [40, 0, 24, 22], split: false }) });
  b = (await s.req(FULL)).body;
  assert.deepEqual(b.radar.frames, ['x']);
  assert.deepEqual(b.radar.wx, screenWx);
  await s.close();
});

test('update: the conditions RAIN line (rl) is buffered per board and station', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const w = parse(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8')));
  let pop = 15;
  const weather = { get: async () => ({ ...w, pop }) };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather });
  const rl = async () => (await s.req(FULL)).body.radar.wx.rl;
  assert.equal(await rl(), undefined); // 15%: not yet
  pop = 25; assert.equal(await rl(), 1); // shows from 20%
  pop = 12; assert.equal(await rl(), 1); // stays through the buffer
  pop = 9; assert.equal(await rl(), undefined); // gone below 10%
  pop = 15; assert.equal(await rl(), undefined); // and needs 20% again
  // A new station starts fresh.
  pop = 12;
  s.store.update('home', { station: { mapid: 40900, name: 'HOWARD' } });
  assert.equal(await rl(), undefined);
  await s.close();
});

test('update: the 5-day setting sends the next days with the weather screen conditions', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
  const w = parse(raw); // Monday light rain 71.4, Tuesday partly cloudy 66
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w) });
  assert.equal((await s.req(FULL)).body.radar.wx.days, undefined); // conditions by default
  s.store.update('home', { wxView: '5day' });
  assert.deepEqual((await s.req(FULL)).body.radar.wx.days, [{ d: 'MO', icon: 'rain', hi: 71 }, { d: 'TU', icon: 'pcloudy_day', hi: 66 }]);
  // The board's own sections: the days ride with the weather screen only.
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const get = async (q) => (await fetch(`http://127.0.0.1:${s.port}/board/update?b=home${q}`, h)).json();
  assert.equal((await get('&s=weather')).radar.wx.days.length, 2);
  assert.equal(((await get('&s=transit')).radar.wx || {}).days, undefined);
  await s.close();
});

test('update: the hourly setting sends the four hourly columns with the weather screen conditions', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
  const h0 = Math.floor(now / 3600) * 3600;
  const time = Array.from({ length: 13 }, (_, i) => h0 + i * 3600);
  const w = { ...parse(raw), hrs: time.map((t, i) => ({ time: t, temp: 50 + i, code: 3, isDay: true })) };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w) });
  assert.equal((await s.req(FULL)).body.radar.wx.hours, undefined);
  s.store.update('home', { wxView: 'hourly' });
  const hours = (await s.req(FULL)).body.radar.wx.hours;
  assert.deepEqual(hours.map((x) => x.t), [52, 54, 56, 58]);
  assert.ok(hours.every((x) => x.icon === 'cloudy' && /^\d{1,2}[AP]$/.test(x.h)));
  assert.equal((await s.req(FULL)).body.radar.wx.days, undefined);
  await s.close();
});

test('simulator preview: header and weather toggles without changing the board', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const w = parse(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8')));
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w) });
  let b = (await s.req('/board/secret123/api/update?b=home')).body;
  assert.equal(b.header, 'MORSE');
  assert.ok(b.wx);
  b = (await s.req('/board/secret123/api/update?b=home&header=0&weather=0')).body;
  assert.equal(b.header, null);
  assert.equal(b.wx, null);
  assert.equal(s.store.get('home').showHeader, true); // board unchanged
  assert.equal(s.store.get('home').showWeather, true);
  s.store.update('home', { showHeader: false });
  assert.equal((await s.req('/board/secret123/api/update?b=home&header=1')).body.header, 'MORSE');
  // Radar corner preview: rtime=0 shows the temperature, board unchanged.
  assert.equal(b.radar.showTime, true);
  const r = (await s.req('/board/secret123/api/update?b=home&rtime=0')).body.radar;
  assert.equal(r.showTime, false);
  assert.equal(r.temp, Math.round(w.temp));
  assert.equal(s.store.get('home').radarTime, true);
  // Radar clock now and conditions: sent only when set.
  assert.equal(r.clock, undefined);
  assert.equal(r.cond, undefined);
  s.store.update('home', { radarClock: 'now', radarCond: true });
  const r2 = (await s.req('/board/secret123/api/update?b=home')).body.radar;
  assert.deepEqual([r2.clock, r2.cond, r2.showTime], ['now', true, true]);
  assert.equal(r2.rb, undefined);
  s.store.update('home', { radarBright: 60 });
  assert.equal((await s.req('/board/secret123/api/update?b=home')).body.radar.rb, 60);
  const png = await fetch(`http://127.0.0.1:${s.port}/board/secret123/sim.png?b=home&header=1&weather=0`);
  assert.equal(png.status, 200);
  await s.close();
});

test('simulator test radar: a recorded storm or snowstorm loops at the board station, frames served by id', async () => {
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: Math.floor(Date.now() / 1000) }) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const post = async (body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}/board/secret123/api/test?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  assert.equal((await post({ radar: 'hail' })).status, 400);
  const r = (await post({ radar: 'storm' })).body;
  assert.equal(r.radar, 'storm');
  let b = (await s.req(FULL)).body;
  assert.equal(b.radar.on, true);
  assert.equal(b.radar.frames.length, 6);
  assert.deepEqual(b.radar.ft.map((t, i) => (i ? t - b.radar.ft[i - 1] : 0)), [0, 360, 360, 360, 360, 360]);
  const frames = [];
  for (const id of b.radar.frames) {
    const f = await fetch(`http://127.0.0.1:${s.port}/board/radar/${id}?b=home`, h);
    assert.equal(f.status, 200);
    frames.push(Buffer.from(await f.arrayBuffer()));
  }
  const rain = (f) => [...f].filter((v) => v >= 1 && v <= 5).length;
  assert.ok(frames.every((f) => f.length === 2048 && rain(f) > 100), 'storm in every frame');
  assert.notDeepEqual(frames[0], frames[5], 'the loop moves');
  await post({ radar: 'snow' });
  b = (await s.req(FULL)).body;
  const snow = Buffer.from(await (await fetch(`http://127.0.0.1:${s.port}/board/secret123/api/radar/${b.radar.frames[2]}?b=home`)).arrayBuffer());
  assert.ok([...snow].some((v) => v >= 8 && v <= 10), 'snow levels');
  await post({});
  b = (await s.req(FULL)).body;
  assert.deepEqual([b.radar.on, b.radar.frames], [false, []]);
  await s.close();
});

test('simulator test alerts: fake line alerts and a weather warning, merged into updates, then expire', async () => {
  const now = Math.floor(Date.now() / 1000);
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const s = await serve({ tracker: fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now }) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const post = (body) => fetch(`http://127.0.0.1:${s.port}/board/secret123/api/test?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.deepEqual((await s.req('/board/secret123/api/test?b=home')).body, { lines: [], warn: null, game: null, radar: null, weather: null, left: 0 });
  let r = await post({ lines: ['RD'], warn: { kind: 'tor', lvl: 'warning' } });
  assert.equal(r.status, 200);
  const t = await r.json();
  assert.deepEqual([t.lines, t.warn], [['RD'], { kind: 'tor', lvl: 'warning' }]);
  assert.ok(t.left > 590 && t.left <= 600);
  // The real board's update carries them.
  const b = (await s.req(FULL)).body;
  assert.ok(b.rows.every((x) => x.a === 1));
  assert.ok(b.ticker.every((x) => x.a === 1));
  assert.deepEqual(b.warn, { kind: 'tor', lvl: 'warning' });
  // Bad input is rejected; an empty set clears.
  assert.equal((await post({ lines: ['XX'] })).status, 400);
  assert.equal((await post({ warn: { kind: 'hail', lvl: 'warning' } })).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/board/secret123/api/test?b=nope`)).status, 404);
  r = await post({ lines: [], warn: null });
  assert.deepEqual((await r.json()).lines, []);
  const c = (await s.req(FULL)).body;
  assert.ok(c.rows.every((x) => x.a === 0));
  assert.equal(c.warn, null);
  await s.close();
});

test('simulator test weather: a forced state and time of day reach every weather display, without real weather', async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }) });
  const post = (body) => fetch(`http://127.0.0.1:${s.port}/board/secret123/api/test?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const upd = async () => (await s.req('/board/secret123/api/update?b=home')).body;
  // No WEATHERAPI_KEY here: no weather at all.
  assert.equal((await upd()).skyline, null);
  let r = await post({ weather: { kind: 'snow heavy', tod: 'night' } });
  assert.deepEqual((await r.json()).weather, { kind: 'snow heavy', tod: 'night' });
  let b = await upd();
  assert.deepEqual([b.skyline.st, b.skyline.pcp, b.skyline.lit], ['snow', { k: 's', n: 20 }, 1]);
  assert.deepEqual([b.radar.wx.icon, b.radar.wx.word, b.radar.wx.temp], ['snow', 'SNOW', 24]);
  assert.equal(b.wx.word, 'SNOW');
  assert.equal(b.radar.wx.days, undefined);
  // Clear at midday: the sun is up; at night the moon icon.
  await post({ weather: { kind: 'clear', tod: 'day' } });
  b = await upd();
  assert.equal(b.skyline.st, 'clear');
  assert.ok(b.skyline.sun);
  assert.equal(b.radar.wx.icon, 'sun');
  await post({ weather: { kind: 'clear', tod: 'night' } });
  b = await upd();
  assert.equal(b.radar.wx.icon, 'moon');
  assert.equal(b.skyline.sun, null);
  assert.ok(b.skyline.win > 99);
  // The 5-day layout gets made-up days around the state.
  s.store.update('home', { wxView: '5day' });
  await post({ weather: { kind: 'storm' } });
  b = await upd();
  assert.equal(b.skyline.storm, 1);
  assert.equal(b.radar.wx.days.length, 5);
  assert.ok(b.radar.wx.days.every((d) => d.icon === 'storm'));
  // Bad input is rejected; an empty set clears.
  assert.equal((await post({ weather: { kind: 'hail' } })).status, 400);
  assert.equal((await post({ weather: { tod: 'noon' } })).status, 400);
  assert.equal((await post({ weather: 'snow' })).status, 400);
  await post({});
  assert.equal((await upd()).skyline, null);
  await s.close();
});

test('width: wide boards get the week, 24 hours, the next sun time, and notop with the top bar off', async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }) });
  const post = (body) => fetch(`http://127.0.0.1:${s.port}/board/secret123/api/test?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const upd = async (w) => (await s.req(`/board/update?b=home&s=weather&hk=skyline:peek${w ? '&w=128' : ''}`, h)).body;
  await post({ weather: { kind: 'rain' } });
  s.store.update('home', { screen: 'weather', wxView: '5day' });
  let b = await upd(false);
  assert.equal(b.radar.wx.days.length, 5);
  assert.equal('week' in b.radar.wx || 'sun' in b.radar.wx || 'notop' in b.radar.wx, false, 'a 64 board gets the 64 fields only');
  assert.equal('week' in b.pv, false);
  b = await upd(true);
  assert.equal(b.radar.wx.days.length, 5, 'the 64 days stay, for firmware without the week');
  assert.equal(b.radar.wx.week.length, 7);
  assert.deepEqual(Object.keys(b.radar.wx.week[0]).sort(), ['d', 'hi', 'icon', 'lo']);
  assert.equal(b.pv.week.length, 7);
  assert.equal(b.pv.hours24.length, 8, 'the peek chooser gets both');
  assert.ok(['rise', 'set'].includes(b.radar.wx.sun.k));
  assert.equal(b.radar.wx.notop, undefined);
  s.store.update('home', { wxView: 'hourly', wxTop: false });
  b = await upd(true);
  assert.equal(b.radar.wx.week, undefined);
  assert.equal(b.radar.wx.hours24.length, 8);
  assert.deepEqual(Object.keys(b.radar.wx.hours24[0]).sort(), ['h', 'icon', 'p', 't']);
  assert.equal(b.radar.wx.notop, 1);
  await post({});
  await s.close();
});

test('width: wide transit gets the warning\'s end (warn.until) and alert words; a 64 board neither', async () => {
  const now = Math.floor(Date.now() / 1000);
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const s = await serve({ tracker: fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now }) });
  const post = (body) => fetch(`http://127.0.0.1:${s.port}/board/secret123/api/test?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const upd = async (w) => (await s.req(`/board/update?b=home&s=transit${w ? '&w=128' : ''}`, h)).body;
  s.store.update('home', { screen: 'transit', wideLayout: 'rows' });
  await post({ lines: ['RD'], warn: { kind: 'tor', lvl: 'warning' }, weather: { kind: 'clear' } });
  let b = await upd(false);
  assert.deepEqual(b.warn, { kind: 'tor', lvl: 'warning' }, 'the 64 warning is unchanged');
  assert.ok(b.rows.every((r) => r.aw === undefined));
  b = await upd(true);
  assert.ok(b.warn.until > now && b.warn.until <= now + 600, 'a test warning ends with the test');
  assert.ok(b.rows.some((r) => r.aw === 'MAJOR DELAYS'), 'test alerts read MAJOR DELAYS');
  await post({});
  await s.close();
});

test('sunTime: the moment the sun reaches an elevation, rising or setting, near a time', () => {
  const { sunPos, sunTime } = require('./sun');
  const lat = 42.0, lon = -87.67, t = Date.UTC(2026, 10, 1, 18) / 1000; // Nov 1, noon CST
  const set = sunTime(t, lat, lon, 1, -1), rise = sunTime(t, lat, lon, 1, 1);
  assert.ok(Math.abs(sunPos(set, lat, lon).el - 1) < 0.2 && set > t);
  assert.ok(Math.abs(sunPos(rise, lat, lon).el - 1) < 0.2 && rise < t);
  assert.ok(sunPos(sunTime(t, lat, lon, 'max'), lat, lon).el > 30);
  assert.ok(sunPos(sunTime(t, lat, lon, 'min'), lat, lon).el < -50);
  assert.equal(sunTime(t, lat, lon, 80, -1), null);
});

test('baseball: shown only when chosen (or a Cycle turn), never as a takeover', async () => {
  const now = Math.floor(Date.now() / 1000);
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const tracker = () => fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now });
  const game = { id: 7, st: 'live', start: now - 3600, away: { ab: 'CHC', c: '#2a5bd8', r: 1, w: 92, l: 70 }, home: { ab: 'STL', c: '#d62a2a', r: 0, w: 88, l: 74 }, inn: 3, half: 'T', b: 0, s: 0, o: 0, on: [0, 0, 0] };
  const h = { headers: { 'X-Board-Token': 'tok' } };

  let s = await serve({ tracker: tracker(), mlb: fakeMlb([]) });
  s.store.update('home', { screen: 'auto' });
  let b = (await s.req(FULL)).body;
  assert.equal(b.screen, 'transit');
  assert.deepEqual(b.mlb, { layout: 'classic', games: [] });
  await s.close();

  s = await serve({ tracker: tracker(), mlb: fakeMlb([game]) });
  s.store.update('home', { screen: 'auto' });
  b = (await s.req(FULL)).body;
  assert.equal(b.screen, 'transit'); // a game on doesn't take the Cycle over
  const post = (body) => fetch(`http://127.0.0.1:${s.port}/board/secret123/api/test?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  s.store.update('home', { screen: 'baseball' });
  b = (await s.req(FULL)).body;
  assert.equal(b.screen, 'baseball');
  assert.deepEqual(b.mlb.games, [game]);
  // A weather warning doesn't take the board off the game.
  await post({ warn: { kind: 'tor', lvl: 'warning' } });
  assert.equal((await s.req(FULL)).body.screen, 'baseball');
  // The phone can pick baseball directly.
  await post({});
  await fetch(`http://127.0.0.1:${s.port}/board/secret123/api/state?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screen: 'baseball' }) });
  assert.equal((await s.req(FULL)).body.screen, 'baseball');
  await s.close();

});

test('baseball: the simulator test game goes first in the list, in the chosen state', async () => {
  const b0 = (r) => r.body.mlb.games[0];
  const now = Math.floor(Date.now() / 1000);
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const s = await serve({ tracker: fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now }) });
  const post = (body) => fetch(`http://127.0.0.1:${s.port}/board/secret123/api/test?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ game: 'extra' })).status, 400);
  s.store.update('home', { screen: 'baseball' });
  for (const st of ['pre', 'live', 'final']) {
    const r = await post({ game: st });
    assert.equal((await r.json()).game, st);
    const b = (await s.req('/board/secret123/api/update?b=home')).body;
    assert.equal(b.mlb.games[0].st, st);
    assert.equal(b.mlb.games[0].away.ab, 'CHC');
    assert.equal(b.screen, 'baseball');
  }
  assert.equal(b0(await s.req('/board/secret123/api/update?b=home')).away.rs, undefined, 'no line score at 64');
  // A wide board's test game carries a line score that adds up to the runs.
  s.store.setCols('home', 128);
  for (const st of ['live', 'final']) {
    await post({ game: st });
    const g = b0(await s.req('/board/secret123/api/update?b=home'));
    for (const k of ['away', 'home']) assert.equal(g[k].rs.reduce((x, y) => x + (y || 0), 0), g[k].r, `${st} ${k}`);
  }
  await post({});
  assert.equal((await s.req('/board/secret123/api/update?b=home')).body.mlb.games.length, 0);
  await s.close();
});

test('forced Baseball asks for the wider forced windows; auto uses the auto ones', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { team } = require('./teams');
  const g = { id: 9, st: 'pre', start: now + 6 * 3600, away: { ...team(112), r: 0, w: 1, l: 0 }, home: { ...team(138), r: 0, w: 0, l: 1 } };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), mlb: fakeMlb([], [g]) });
  let b = (await s.req('/board/secret123/api/update?b=home')).body;
  assert.equal(b.screen, 'transit');
  assert.deepEqual(b.mlb.games, []);
  s.store.update('home', { screen: 'baseball' });
  b = (await s.req('/board/secret123/api/update?b=home')).body;
  assert.equal(b.screen, 'baseball');
  assert.equal(b.mlb.games[0].id, 9);
  await s.close();
});

test('baseball logo layout: payload carries logo ids and band colors; the board fetches logo crops', async () => {
  const now = Math.floor(Date.now() / 1000);
  const game = { id: 7, st: 'live', start: now - 3600, away: { ab: 'CHC', c: '#2a5bd8', r: 1 }, home: { ab: 'STL', c: '#d62a2a', r: 0 }, inn: 3, half: 'T', b: 0, s: 0, o: 0, on: [0, 0, 0] };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), mlb: fakeMlb([game]), logos: fakeLogos({ CHC: '#142d5a' }) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  s.store.update('home', { baseballLayout: 'logos', screen: 'baseball' });
  const b = (await s.req(FULL)).body;
  assert.equal(b.mlb.layout, 'logos');
  assert.equal(b.mlb.dim, 0.9);
  assert.deepEqual([b.mlb.games[0].away.lg, b.mlb.games[0].away.bd], ['CHC-1', '#142d5a']);
  assert.deepEqual([b.mlb.games[0].home.lg, b.mlb.games[0].home.bd], [null, '#d62a2a']); // no logo: the team color (the board dims)
  const logo = await fetch(`http://127.0.0.1:${s.port}/board/logo/CHC-1`, h);
  assert.equal(logo.status, 200);
  assert.equal((await logo.arrayBuffer()).byteLength, 864);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/board/logo/CHC-1`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/board/logo/NOPE-1`, h)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/board/secret123/api/logo/CHC-1`)).status, 200);
  assert.deepEqual((await s.req('/board/secret123/api/logos')).body, { teams: ['CHC'], updated: null });
  const one = await fetch(`http://127.0.0.1:${s.port}/board/secret123/api/logos?team=XYZ`, { method: 'POST', body: 'nope' });
  assert.equal(one.status, 400);
  const bad = await fetch(`http://127.0.0.1:${s.port}/board/secret123/api/logos`, { method: 'POST', body: 'nope' });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/board/secret123/sim.png?b=home&screen=baseball`)).status, 200);
  await s.close();
});

test('update: NWS forecasts drive the 5-day layout over WeatherAPI\'s days', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const nf = require('./nws-forecast');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
  const w = parse(raw);
  // The Morse NWS fixtures, moved by whole days so the recorded Sunday is today.
  const nws = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nws-forecast', f), 'utf8'));
  const f = nf.parse({ forecast: nws('morse-2026-10-11-1406-forecast.json'), hourly: nws('morse-2026-10-11-1404-hourly.json') });
  const day = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(t * 1000));
  let shift = Math.round((now - f.periods[0].s) / 86400) * 86400;
  while (day(f.periods[0].s + shift) > day(now)) shift -= 86400;
  while (day(f.periods[0].s + shift) < day(now)) shift += 86400;
  const move = (p) => ({ ...p, s: p.s + shift, e: p.e + shift });
  const fc = { periods: f.periods.map(move), hours: f.hours.map(move) };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w), nwsForecast: fakeWeather(fc) });
  s.store.update('home', { wxView: '5day' });
  const days = (await s.req(FULL)).body.radar.wx.days;
  assert.deepEqual(days.map((x) => [x.icon, x.hi]), [['pcloudy_day', 83], ['sun', 81], ['rain', 67], ['rain', 64], ['rain', 58]]);
  await s.close();
});

test('select: the knob sets a category and gets the new screen\'s update back', async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }) });
  const h = (method = 'POST') => ({ method, headers: { 'X-Board-Token': 'tok' } });
  assert.equal((await s.req('/board/select?b=home&s=weather', { method: 'POST' })).status, 401);
  assert.equal((await s.req('/board/select?b=home&s=weather', h('GET'))).status, 405);
  assert.equal((await s.req('/board/select?b=nope&s=weather', h())).status, 404);
  const bad = await s.req('/board/select?b=home&s=baseball', h());
  assert.equal(bad.status, 400);
  assert.match(bad.body.detail, /transit, weather, cycle/);
  assert.equal((await s.req('/board/select?b=home&s=sports', h())).status, 400, 'sports is phone-only');
  // Every update carries the ring and the chosen screen's place on it.
  let b = (await s.req('/board/update?b=home', h('GET'))).body;
  assert.deepEqual(b.knob, { ring: ['transit', 'weather', 'cycle'], at: 0 });
  const v = b.v;
  b = (await s.req('/board/select?b=home&s=weather', h())).body;
  assert.deepEqual([b.screen, b.for, b.knob.at, b.v], ['weather', 'weather', 1, v + 1]);
  assert.ok(b.radar && !('rows' in b), 'only the weather sections');
  assert.equal(s.store.get('home').screen, 'weather');
  b = (await s.req('/board/select?b=home&s=transit', h())).body;
  assert.deepEqual([b.screen, b.knob.at], ['transit', 0]);
  assert.ok('rows' in b && !('mlb' in b));
  // CYCLE opens the Cycle (screen 'auto').
  assert.equal((await s.req('/board/select?b=home&s=cycle', h())).status, 200);
  assert.equal(s.store.get('home').screen, 'auto');
  // A board that's off: any knob choice turns it back on (Auto).
  s.store.update('home', { bright: 'off' });
  await s.req('/board/select?b=home&s=transit', h());
  assert.equal(s.store.get('home').bright, 'auto');
  // Baseball chosen on the phone: the knob opens on TRANSIT.
  s.store.update('home', { screen: 'baseball' });
  assert.equal((await s.req('/board/update?b=home', h('GET'))).body.knob.at, 0);
  await s.close();
});

test('a new board ID registers itself on its first update, as a copy of home', async () => {
  const s = await serve();
  const T = { headers: { 'X-Board-Token': 'tok' } };
  await s.req('/board/secret123/api/state?b=home', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station: { mapid: '40380' }, tickerHold: 12 }) });
  // Without the token nothing is created.
  assert.equal((await s.req('/board/update?b=office')).status, 401);
  assert.equal(s.store.get('office'), null);
  // The version check alone doesn't create a board.
  assert.equal((await s.req('/board/version?b=office', T)).status, 404);
  const r = await s.req('/board/update?b=office', T);
  assert.equal(r.status, 200);
  const office = s.store.get('office');
  assert.deepEqual([office.station.mapid, office.tickerHold, office.v, office.bright], ['40380', 12, 1, 'auto']);
  // From then on the two boards are independent.
  await s.req('/board/secret123/api/state?b=office', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station: { mapid: '40100' } }) });
  assert.equal(s.store.get('home').station.mapid, '40380');
  assert.equal(s.store.get('office').station.mapid, '40100');
  await s.close();
});

test('control API: list, add (copy or defaults), label, and delete boards', async () => {
  const s = await serve();
  const J = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await s.req('/board/secret123/api/state?b=home', J('POST', { station: { mapid: '40380' }, label: 'Kitchen' }));
  let r = await s.req('/board/secret123/api/boards');
  assert.deepEqual(r.body, [{ id: 'home', label: 'Kitchen', station: 'CLARK/LAKE', mapid: '40380', screen: 'transit', fw: 'stable', seen: null, sports: true }]);
  r = await s.req('/board/secret123/api/boards', J('POST', { id: 'desk', from: 'home', label: 'Desk' }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((b) => [b.id, b.label, b.mapid]), [['home', 'Kitchen', '40380'], ['desk', 'Desk', '40380']]);
  r = await s.req('/board/secret123/api/boards', J('POST', { id: 'bare' }));
  assert.equal(r.body[2].mapid, '40100'); // defaults: Morse
  for (const bad of [{ id: 'desk' }, { id: 'Bad ID' }, { id: 'x', from: 'nope' }, { id: 'y', label: 'x'.repeat(25) }]) {
    assert.equal((await s.req('/board/secret123/api/boards', J('POST', bad))).status, 400, JSON.stringify(bad));
  }
  // Copy settings onto an existing board; its name stays.
  r = await s.req('/board/secret123/api/boards/copy?b=bare&from=home', { method: 'POST' });
  assert.deepEqual([r.status, r.body.station.mapid, r.body.label, r.body.v], [200, '40380', '', 2]);
  assert.equal((await s.req('/board/secret123/api/boards/copy?b=bare&from=bare', { method: 'POST' })).status, 400);
  assert.equal((await s.req('/board/secret123/api/boards/copy?b=nope&from=home', { method: 'POST' })).status, 404);
  // Seen after a version check.
  await s.req('/board/version?b=desk', { headers: { 'X-Board-Token': 'tok' } });
  r = await s.req('/board/secret123/api/boards');
  assert.ok(r.body.find((b) => b.id === 'desk').seen > 0);
  // Delete; the last board stays.
  assert.equal((await s.req('/board/secret123/api/boards?b=desk', { method: 'DELETE' })).status, 200);
  assert.equal((await s.req('/board/secret123/api/boards?b=desk', { method: 'DELETE' })).status, 404);
  assert.equal((await s.req('/board/secret123/api/boards?b=bare', { method: 'DELETE' })).status, 200);
  r = await s.req('/board/secret123/api/boards?b=home', { method: 'DELETE' });
  assert.equal(r.status, 400);
  assert.match(r.body.detail, /only board/);
  assert.equal((await s.req('/board/secret123/api/boards', { method: 'PUT' })).status, 405);
  await s.close();
});

// ---- OTA firmware (contract: "Firmware") ----

const { createFirmware } = require('./firmware');
const crypto = require('crypto');
const FW_KEY = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const fwSig = (buf) => crypto.sign('sha256', buf, FW_KEY.privateKey).toString('hex');
// A board server with a firmware store that trusts the test key.
const serveFw = (opts = {}) => serve({ firmware: createFirmware({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'board-fw-')), log: quiet, publicKey: FW_KEY.publicKey, stableWindow: () => true }), ...opts });
const signed = (buf) => ({ method: 'POST', body: buf, headers: { 'X-Firmware-Signature': fwSig(buf) } });

function fakeBuild(v, kind = 'generic') {
  const b = Buffer.alloc(4096, 0x11);
  b[0] = 0xe9;
  b.writeUInt16LE(9, 12); // ESP32-S3
  b.write(`CTABOARD-BUILD:${v}:${kind};`, 1000, 'latin1');
  return b;
}

test('firmware: outside the overnight window a stable board gets no offer; beta still does', async () => {
  const s = await serve({ firmware: createFirmware({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'board-fw-')), log: quiet, publicKey: FW_KEY.publicKey, stableWindow: () => false }) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  assert.equal((await s.req('/board/secret123/api/firmware?channel=stable', signed(fakeBuild('aaaaaaa')))).status, 200);
  assert.equal((await s.req('/board/secret123/api/firmware?channel=beta', signed(fakeBuild('bbbbbbb')))).status, 200);
  const q = '/board/version?b=home&hu=600&hd=adafruit_matrixportal_s3&hv=1234567';
  assert.ok(!('fw' in (await s.req(q, h)).body));
  // Just started (unplugged overnight, say): offered anyway, before anyone watches.
  assert.equal((await s.req(q.replace('hu=600', 'hu=30'), h)).body.fw.v, 'aaaaaaa');
  // A rollback note outlives the reports without an offer, while that build is still the target.
  await s.req(q.replace('hu=600', 'hu=700') + '&hx=rolledback:aaaaaaa', h);
  await s.req(q.replace('hu=600', 'hu=760'), h);
  assert.equal((await s.req('/board/secret123/api/health')).body.home.ota, 'rolledback:aaaaaaa');
  await s.req('/board/version?b=home&hu=800&hd=adafruit_matrixportal_s3&hv=aaaaaaa', h);
  assert.equal((await s.req('/board/secret123/api/health')).body.home.ota, undefined, 'running it now: gone');
  s.store.update('home', { fw: 'beta' });
  assert.equal((await s.req(q, h)).body.fw.v, 'bbbbbbb');
  s.store.update('home', { fw: 'aaaaaaa' });
  assert.equal((await s.req(q, h)).body.fw.v, 'aaaaaaa', 'pinned: right away');
  await s.close();
});

test('firmware: upload on the control page, offered to an S3 in its version check, downloaded by the board', async () => {
  const s = await serveFw();
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const build = fakeBuild('aaaaaaa');
  let r = await s.req('/board/secret123/api/firmware?channel=stable', signed(build));
  assert.equal(r.status, 200);
  assert.equal(r.body.channels.stable, 'aaaaaaa');
  const sha = r.body.builds[0].sha;
  // A setup build (secrets.h compiled in) is refused.
  r = await s.req('/board/secret123/api/firmware', signed(fakeBuild('bbbbbbb', 'setup')));
  assert.equal(r.status, 400);
  assert.match(r.body.detail, /secrets\.h/);
  // The S3 running another committed build gets the offer; health records its OTA note.
  r = await s.req('/board/version?b=home&hu=60&hd=adafruit_matrixportal_s3&hv=1234567&hx=error:Short', h);
  const { sig, ...rest } = r.body.fw;
  assert.deepEqual(rest, { v: 'aaaaaaa', size: 4096, sha, n: 0 });
  assert.ok(crypto.verify('sha256', build, FW_KEY.publicKey, Buffer.from(sig, 'hex')), 'the offer carries a signature the board can check');
  assert.equal((await s.req('/board/secret123/api/health')).body.home.ota, 'error:Short');
  // Running it, a test build, or the M4: no offer.
  for (const q of ['hv=aaaaaaa&hd=adafruit_matrixportal_s3', 'hv=dev&hd=adafruit_matrixportal_s3', 'hv=1234567']) {
    r = await s.req(`/board/version?b=home&hu=61&${q}`, h);
    assert.ok(!('fw' in r.body), q);
  }
  // Off, and "Try again" bumps n.
  s.store.update('home', { fw: 'off' });
  r = await s.req('/board/version?b=home&hu=62&hd=adafruit_matrixportal_s3&hv=1234567', h);
  assert.ok(!('fw' in r.body));
  s.store.update('home', { fw: 'stable', fwRetry: 1 });
  r = await s.req('/board/version?b=home&hu=63&hd=adafruit_matrixportal_s3&hv=1234567', h);
  assert.equal(r.body.fw.n, 1);
  // The download: token, board, and build checked; exact bytes.
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/board/firmware?b=home&v=aaaaaaa`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/board/firmware?b=home&v=fffffff`, h)).status, 404);
  const dl = await fetch(`http://127.0.0.1:${s.port}/board/firmware?b=home&v=aaaaaaa`, h);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-length'), '4096');
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), build);
  await s.close();
});

test('firmware: channels move, pinned and channel builds can\'t be deleted', async () => {
  const s = await serveFw();
  await s.req('/board/secret123/api/firmware?channel=beta', signed(fakeBuild('aaaaaaa')));
  await s.req('/board/secret123/api/firmware', signed(fakeBuild('bbbbbbb')));
  let r = await s.req('/board/secret123/api/firmware/channel', { method: 'POST', body: JSON.stringify({ channel: 'stable', v: 'bbbbbbb' }) });
  assert.deepEqual(r.body.channels, { beta: 'aaaaaaa', stable: 'bbbbbbb' });
  r = await s.req('/board/secret123/api/firmware?v=aaaaaaa', { method: 'DELETE' });
  assert.equal(r.status, 400);
  await s.req('/board/secret123/api/firmware/channel', { method: 'POST', body: JSON.stringify({ channel: 'beta', v: null }) });
  s.store.update('home', { fw: 'aaaaaaa' });
  r = await s.req('/board/secret123/api/firmware?v=aaaaaaa', { method: 'DELETE' });
  assert.equal(r.status, 400);
  assert.match(r.body.detail, /pinned/);
  s.store.update('home', { fw: 'stable' });
  r = await s.req('/board/secret123/api/firmware?v=aaaaaaa', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.builds.map((b) => b.v), ['bbbbbbb']);
  await s.close();
});

// ---- board keys and per-board control links (contract: "Board keys") ----

test('board keys: a keyed board must use its own token; others keep the shared one', async () => {
  const s = await serve();
  s.store.create('kitchen', { from: 'home' });
  const shared = { headers: { 'X-Board-Token': 'tok' } };
  assert.equal((await s.req('/board/version?b=kitchen', shared)).status, 200);
  const k = await s.req('/board/secret123/api/boards/key?b=kitchen', { method: 'POST' });
  assert.equal(k.status, 200);
  assert.match(k.body.token, /^[A-Za-z0-9_-]{32}$/);
  assert.match(k.body.link, /^[A-Za-z0-9_-]{22}$/);
  const own = { headers: { 'X-Board-Token': k.body.token } };
  for (const p of ['version', 'update']) {
    assert.equal((await s.req(`/board/${p}?b=kitchen`, shared)).status, 401, p);
    assert.equal((await s.req(`/board/${p}?b=kitchen`, own)).status, 200, p);
  }
  // Its token opens nothing else, and the owner's boards still take the shared token.
  assert.equal((await s.req('/board/version?b=home', own)).status, 401);
  assert.equal((await s.req('/board/version?b=home', shared)).status, 200);
  // A new key replaces the old token.
  const k2 = await s.req('/board/secret123/api/boards/key?b=kitchen', { method: 'POST' });
  assert.equal((await s.req('/board/version?b=kitchen', own)).status, 401);
  assert.equal((await s.req('/board/version?b=kitchen', { headers: { 'X-Board-Token': k2.body.token } })).status, 200);
  // Removing the key goes back to the shared token; the link stops working.
  await s.req('/board/secret123/api/boards/key?b=kitchen', { method: 'DELETE' });
  assert.equal((await s.req('/board/version?b=kitchen', shared)).status, 200);
  assert.equal((await s.req(`/board/c/${k2.body.link}/api/state`)).status, 404);
  await s.close();
});

test('transfer: a keyed board gets a new link, default settings, and a WiFi wipe stamp', async () => {
  const s = await serve();
  s.store.create('kitchen', { from: 'home', label: 'Kitchen' });
  s.store.update('kitchen', { screen: 'ticker', station: { mapid: '40380' }, fw: 'off' });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  // Only for a keyed board.
  let r = await s.req('/board/secret123/api/boards/transfer?b=kitchen', { method: 'POST' });
  assert.equal(r.status, 400);
  const { body: key } = await s.req('/board/secret123/api/boards/key?b=kitchen', { method: 'POST' });
  const own = { headers: { 'X-Board-Token': key.token } };
  assert.ok(!('wipe' in (await s.req('/board/version?b=kitchen', own)).body), 'no wipe before a transfer');
  const v0 = s.store.get('kitchen').v;
  r = await s.req('/board/secret123/api/boards/transfer?b=kitchen', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.match(r.body.link, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(r.body.link, key.link);
  assert.ok(Math.abs(r.body.wipe - Date.now() / 1000) < 5);
  // The old link is dead, the new one works; the token is unchanged.
  assert.equal((await s.req(`/board/c/${key.link}/api/state`)).status, 404);
  assert.equal((await s.req(`/board/c/${r.body.link}/api/state`)).status, 200);
  // Settings back to the defaults; its name and firmware setting stay.
  const b = s.store.get('kitchen');
  assert.equal(b.screen, 'transit');
  assert.notEqual(b.station.mapid, '40380');
  assert.equal(b.label, 'Kitchen');
  assert.equal(b.fw, 'off');
  assert.ok(b.v > v0);
  // The board hears the stamp on every version check until it reports applying it.
  assert.equal((await s.req('/board/version?b=kitchen&hu=5', own)).body.wipe, r.body.wipe);
  await s.req('/board/version?b=kitchen&hu=6&hz=' + r.body.wipe, own);
  assert.equal((await s.req('/board/secret123/api/health')).body.kitchen.wiped, r.body.wipe);
  assert.ok(!('wipe' in (await s.req('/board/version?b=kitchen&hu=7', own)).body), 'applied: dropped, so a reflash is never wiped again');
  // A second transfer gets a newer stamp, even within the same second; a new token (a reflash) drops it.
  const r2 = await s.req('/board/secret123/api/boards/transfer?b=kitchen', { method: 'POST' });
  assert.ok(r2.body.wipe > r.body.wipe);
  const { body: key2 } = await s.req('/board/secret123/api/boards/key?b=kitchen', { method: 'POST' });
  assert.ok(!('wipe' in (await s.req('/board/version?b=kitchen', { headers: { 'X-Board-Token': key2.token } })).body));
  // The board's own link can make itself a new link (revoking a leaked one) ...
  const nl = await s.req(`/board/c/${key2.link}/api/boards/link?b=home`, { method: 'POST' });
  assert.equal(nl.status, 200);
  assert.equal(nl.body.id, 'kitchen');
  assert.equal((await s.req(`/board/c/${key2.link}/`)).status, 404);
  // ... and hand the board on: a new link and default settings, but no WiFi wipe from a link.
  const r3 = await s.req(`/board/c/${nl.body.link}/api/boards/transfer?b=home`, { method: 'POST' });
  assert.equal(r3.status, 200);
  assert.equal(r3.body.id, 'kitchen', 'a link reaches its own board only');
  assert.equal(r3.body.wipe, undefined);
  assert.ok(!('wipe' in (await s.req('/board/version?b=kitchen', { headers: { 'X-Board-Token': key2.token } })).body));
  assert.equal((await s.req(`/board/c/${nl.body.link}/`)).status, 404);
  // Key endpoints stay the maker's.
  assert.equal((await s.req(`/board/c/${r3.body.link}/api/boards/key`, { method: 'POST' })).status, 404);
  // The maker's boards never get a wipe.
  assert.ok(!('wipe' in (await s.req('/board/version?b=home', h)).body));
  // The board list carries each board's firmware setting (the fleet table).
  assert.deepEqual((await s.req('/board/secret123/api/boards')).body.map((x) => [x.id, x.fw]), [['home', 'stable'], ['kitchen', 'off']]);
  await s.close();
});

test('baseball is the maker\'s only: a keyed board gets no games, screen, logos, or baseball settings', async () => {
  const now = Math.floor(Date.now() / 1000);
  const game = { id: 7, st: 'live', start: now - 3600, away: { ab: 'CHC', c: '#2a5bd8', r: 1 }, home: { ab: 'STL', c: '#d62a2a', r: 0 }, inn: 3, half: 'T', b: 0, s: 0, o: 0, on: [0, 0, 0] };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), mlb: fakeMlb([game]), logos: fakeLogos({ CHC: '#0e3386' }) });
  s.store.update('home', { screen: 'baseball', baseballLayout: 'logos' });
  s.store.create('kitchen', { from: 'home' }); // a copy keeps the baseball screen
  const shared = { headers: { 'X-Board-Token': 'tok' } };
  // Before it has a key, it's one of the maker's boards.
  assert.equal((await s.req('/board/update?b=kitchen', shared)).body.screen, 'baseball');
  const { body: key } = await s.req('/board/secret123/api/boards/key?b=kitchen', { method: 'POST' });
  const own = { headers: { 'X-Board-Token': key.token } };
  // Keyed: the baseball screen falls back to transit, and no takeover on auto.
  let b = (await s.req('/board/update?b=kitchen', own)).body;
  assert.equal(b.screen, 'transit');
  assert.equal(b.mlb, undefined);
  s.store.update('kitchen', { screen: 'auto' });
  b = (await s.req(`/board/secret123/api/update?b=kitchen`)).body;
  assert.equal(b.screen, 'transit');
  assert.equal(b.mlb, undefined, 'the simulator copy has no games either');
  // A test game doesn't bring it back.
  await s.req('/board/secret123/api/test?b=kitchen', { method: 'POST', body: JSON.stringify({ game: 'live' }) });
  assert.equal((await s.req('/board/update?b=kitchen', own)).body.mlb, undefined);
  // The maker's board is unchanged.
  b = (await s.req('/board/update?b=home', shared)).body;
  assert.equal(b.screen, 'baseball');
  assert.equal(b.mlb.games.length, 1);
  // Baseball settings are refused, from its link and from the maker's page.
  const c = `/board/c/${key.link}`;
  for (const patch of [{ screen: 'baseball' }, { bbTeams: ['cubs'] }, { baseballLayout: 'bands' }, { logoBright: 50 }, { gameEvery: 30 }]) {
    for (const p of [`${c}/api/state`, '/board/secret123/api/state?b=kitchen']) {
      const r = await s.req(p, { method: 'POST', body: JSON.stringify(patch) });
      assert.equal(r.status, 400, `${p} ${JSON.stringify(patch)}`);
      assert.match(r.body.detail, /baseball/);
    }
  }
  assert.equal((await s.req(`${c}/api/state`, { method: 'POST', body: JSON.stringify({ screen: 'ticker' }) })).status, 200);
  assert.equal((await s.req('/board/secret123/api/state?b=home', { method: 'POST', body: JSON.stringify({ bbTeams: ['cubs'] }) })).status, 200);
  // Logos are the maker's boards' only.
  const logo = async (id, h) => (await fetch(`http://127.0.0.1:${s.port}/board/logo/CHC-1?b=${id}`, h)).status;
  assert.equal(await logo('kitchen', own), 404);
  assert.equal(await logo('home', shared), 200);
  // The board list says which boards have baseball (the page hides it on the others).
  const list = (await s.req('/board/secret123/api/boards')).body;
  assert.deepEqual(list.map((x) => [x.id, x.sports]), [['home', true], ['kitchen', false]]);
  assert.equal((await s.req(`${c}/api/boards`)).body[0].sports, false);
  // sim.png asked for the baseball screen draws the board's own screen instead.
  assert.equal((await fetch(`http://127.0.0.1:${s.port}${c}/sim.png?screen=baseball&scale=1`)).status, 200);
  // Without the key it's the maker's again.
  await s.req('/board/secret123/api/boards/key?b=kitchen', { method: 'DELETE' });
  assert.equal((await s.req('/board/secret123/api/state?b=kitchen', { method: 'POST', body: JSON.stringify({ screen: 'baseball' }) })).status, 200);
  await s.close();
});

test('per-board link: the control page for that board only, without the owner\'s controls', async () => {
  const s = await serve();
  s.store.create('kitchen', { from: 'home', label: 'Kitchen' });
  const { body: key } = await s.req('/board/secret123/api/boards/key?b=kitchen', { method: 'POST' });
  const c = `/board/c/${key.link}`;
  // The page knows its board.
  const page = await fetch(`http://127.0.0.1:${s.port}${c}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /window\.BOARD_SCOPE = "kitchen"/);
  // Reads and writes go to its board whatever `b` says.
  assert.deepEqual(Object.keys((await s.req(`${c}/api/state`)).body.boards), ['kitchen']);
  let r = await s.req(`${c}/api/state?b=home`, { method: 'POST', body: JSON.stringify({ screen: 'ticker' }) });
  assert.equal(r.status, 200);
  assert.equal(s.store.get('kitchen').screen, 'ticker');
  assert.equal(s.store.get('home').screen, 'transit');
  assert.deepEqual((await s.req(`${c}/api/boards`)).body.map((b) => b.id), ['kitchen']);
  assert.equal((await s.req(`${c}/api/boards`)).body[0].link, undefined);
  // Updates: stable or off only.
  assert.equal((await s.req(`${c}/api/state`, { method: 'POST', body: JSON.stringify({ fw: 'off' }) })).status, 200);
  assert.equal((await s.req(`${c}/api/state`, { method: 'POST', body: JSON.stringify({ fw: 'beta' }) })).status, 400);
  // Owner-only endpoints aren't there.
  for (const [p, m] of [['api/boards', 'POST'], ['api/boards?b=home', 'DELETE'], ['api/boards/copy?from=home', 'POST'], ['api/boards/key', 'POST'],
    ['api/firmware', 'GET'], ['api/logos', 'GET'], ['api/raw/mlb', 'GET'], ['api/raw/weather?mapid=40100', 'GET']]) {
    assert.equal((await s.req(`${c}/${p}`, { method: m })).status, 404, `${m} ${p}`);
  }
  // The owner sees the link; a new link retires the old one.
  assert.equal((await s.req('/board/secret123/api/boards')).body.find((b) => b.id === 'kitchen').link, key.link);
  const { body: nl } = await s.req('/board/secret123/api/boards/link?b=kitchen', { method: 'POST' });
  assert.equal((await s.req(`${c}/api/state`)).status, 404);
  assert.equal((await s.req(`/board/c/${nl.link}/api/state`)).status, 200);
  // Deleting the board revokes its link and key.
  await s.req('/board/secret123/api/boards?b=kitchen', { method: 'DELETE' });
  assert.equal((await s.req(`/board/c/${nl.link}/api/state`)).status, 404);
  assert.equal((await s.req('/board/c/not-a-real-link-at-all00/api/state')).status, 404);
  await s.close();
});

test('clock screen: only for boards whose firmware draws it (hk=skyline); the skyline section rides with it', async () => {
  const { parse } = require('./weather');
  const om = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
  const w = parse({ ...om, current: { ...om.current, cloud: 30 } });
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const get = async (q = '') => (await s.req('/board/update?b=home' + q, h)).body;
  s.store.update('home', { screen: 'clock' });

  // No capability reported yet: transit instead, no CLOCK on the knob.
  let b = await get();
  assert.equal(b.screen, 'transit');
  assert.equal(b.for, 'transit');
  assert.equal(b.skyline, undefined);
  assert.deepEqual(b.knob.ring, ['transit', 'weather', 'cycle']);
  assert.equal((await get('&s=clock')).for, 'transit', 'a press asking for clock gets transit too');

  // The S3 firmware reports it can draw the skyline.
  await s.req('/board/version?b=home&hu=60&hk=skyline', h);
  b = await get();
  assert.equal(b.screen, 'clock');
  assert.equal(b.for, 'clock');
  assert.equal(b.rows, undefined, 'transit sections stay home');
  assert.deepEqual(b.knob, { ring: ['transit', 'weather', 'clock', 'cycle'], at: 2 });
  assert.equal(b.skyline.face, 'skyline');
  assert.equal(b.skyline.st, 'partly');
  assert.equal(b.skyline.temp, 63);
  assert.ok(Array.isArray(b.skyline.sky) && b.skyline.sky.length >= 2);
  assert.equal(b.skyline.wat.length, 3);
  assert.deepEqual([b.skyline.wheel, b.skyline.rip, b.skyline.twk, b.skyline.fall], [30000, 500, 1, 200], 'motion defaults');
  // The board's skyline settings reach the payload; hiding the temperature sends none.
  s.store.update('home', { wheelSpeed: 'off', rippleSpeed: 'fast', twinkle: false, rainSpeed: 'slow', showTemp: false });
  b = await get();
  assert.deepEqual([b.skyline.wheel, b.skyline.rip, b.skyline.twk, b.skyline.fall, b.skyline.temp], [0, 250, 0, 400, null]);
  s.store.update('home', { showTemp: true });
  // A later report without hk (e.g. older firmware after a rollback) turns it off again.
  await s.req('/board/version?b=home&hu=90', h);
  assert.equal((await get()).screen, 'transit');

  // The simulator's copy keeps the screen and the whole payload.
  const full = (await s.req(FULL)).body;
  assert.equal(full.screen, 'clock');
  assert.equal(full.skyline.face, 'skyline');
  await s.close();
});

test('clock screen: other screens leave the skyline out; the knob can choose CLOCK', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const om = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(parse(om)) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  await s.req('/board/version?b=home&hu=60&hk=skyline', h);
  assert.equal((await s.req('/board/update?b=home', h)).body.skyline, undefined);
  const r = await s.req('/board/select?b=home&s=clock', { method: 'POST', headers: { 'X-Board-Token': 'tok' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.screen, 'clock');
  assert.equal(r.body.skyline.st, 'clear', 'the fixture: sunny, 0% cloud');
  assert.equal(s.store.get('home').screen, 'clock');
  await s.close();
});

test('clock screen, seventies face: only for firmware that reports it; others keep the skyline', async () => {
  const { parse } = require('./weather');
  const om = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(parse(om)) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  s.store.update('home', { screen: 'clock', clockFace: 'seventies' });
  // Firmware with the skyline only: the skyline face, with its section.
  let b = (await s.req('/board/update?b=home&hk=skyline', h)).body;
  assert.equal(b.screen, 'clock');
  assert.equal(b.cface, 'skyline');
  assert.equal(b.skyline.face, 'skyline');
  // Firmware with the seventies face: no skyline section to parse.
  b = (await s.req('/board/update?b=home&hk=skyline:seventies', h)).body;
  assert.equal(b.cface, 'seventies');
  assert.equal(b.skyline, null);
  const sel = await s.req('/board/select?b=home&s=clock&hk=skyline:seventies', { method: 'POST', headers: { 'X-Board-Token': 'tok' } });
  assert.equal(sel.body.cface, 'seventies');
  // Other screens leave cface out.
  s.store.update('home', { screen: 'transit' });
  assert.equal((await s.req('/board/update?b=home&hk=skyline:seventies', h)).body.cface, undefined);
  // Back to the skyline face.
  s.store.update('home', { screen: 'clock', clockFace: 'skyline' });
  b = (await s.req('/board/update?b=home&hk=skyline:seventies', h)).body;
  assert.equal(b.cface, 'skyline');
  assert.equal(b.skyline.face, 'skyline');
  await s.close();
});

test('clock screen, big digits and day/date faces: sent only to firmware that draws them, with no face sections', async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const get = async (hk) => (await s.req(`/board/update?b=home&hk=${hk}`, h)).body;
  for (const face of ['digits', 'daydate']) {
    s.store.update('home', { screen: 'clock', clockFace: face });
    assert.equal((await get('skyline:seventies:analog:daynight:gradient')).cface, 'skyline', `${face}: older firmware keeps the skyline`);
    const b = await get('skyline:seventies:analog:daynight:gradient:digits:daydate');
    assert.equal(b.cface, face);
    assert.equal(b.skyline, null, 'no skyline drawing');
    assert.equal(b.cwx, undefined);
    assert.equal(b.dn, undefined);
    assert.equal(b.steady, undefined, 'the colon blinks by default');
  }
  s.store.update('home', { colonBlink: false });
  assert.equal((await get('skyline:digits:daydate')).steady, undefined, 'only the big digits face');
  s.store.update('home', { clockFace: 'digits' });
  assert.equal((await get('skyline:digits:daydate')).steady, true, 'Blinking colon off: steady');
  await s.close();
});

test('clock screen, analog and day/night faces: their sections, only for firmware that draws them', async () => {
  const { parse } = require('./weather');
  const om = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(parse(om)) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const get = async (hk) => (await s.req(`/board/update?b=home&hk=${hk}`, h)).body;
  const ALL = 'skyline:seventies:analog:daynight';
  s.store.update('home', { screen: 'clock', clockFace: 'analog' });
  let b = await get('skyline');
  assert.equal(b.cface, 'skyline', 'older firmware keeps the skyline');
  assert.equal(b.cwx, undefined);
  b = await get(ALL);
  assert.equal(b.cface, 'analog');
  assert.equal(b.skyline, null);
  assert.deepEqual(Object.keys(b.cwx).sort(), ['icon', 'temp']);
  assert.equal(typeof b.cwx.temp, 'number');
  assert.equal(b.dn, undefined);
  s.store.update('home', { clockFace: 'daynight' });
  b = await get(ALL);
  assert.equal(b.cface, 'daynight');
  assert.equal(b.cwx, undefined);
  assert.ok(Number.isInteger(b.dn.dec) && Math.abs(b.dn.dec) <= 235, 'declination in tenths of a degree');
  assert.ok(Number.isInteger(b.dn.lon) && b.dn.lon >= -1800 && b.dn.lon <= 1800);
  assert.ok(Math.abs(b.dn.t - now) < 5);
  assert.deepEqual(b.dn.here, [16, 7], 'Morse (42.008 N, 87.666 W) on the 5.625° map');
  s.store.update('home', { clockFace: 'gradient' });
  assert.equal((await get(ALL)).cface, 'skyline', 'the gradient needs its own capability');
  b = await get(ALL + ':gradient');
  assert.equal(b.cface, 'gradient');
  assert.equal(b.ginv, undefined, 'cut-out digits by default');
  s.store.update('home', { gradInvert: true });
  assert.equal((await get(ALL + ':gradient')).ginv, true);
  assert.equal(b.dn, undefined);
  assert.equal(b.cwx, undefined);
  s.store.update('home', { screen: 'transit' });
  b = await get(ALL);
  assert.equal(b.dn, undefined, 'other screens leave it out');
  await s.close();
});

test('width: wide day/night gets its spot on the 4.5° map and sunrise/sunset; wide Seventies gets the temperature', async () => {
  const { parse } = require('./weather');
  const om = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
  const wx = parse(om);
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(wx) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const ALL = 'skyline:seventies:analog:daynight';
  const get = async (w) => (await s.req(`/board/update?b=home&hk=${ALL}${w ? '&w=128' : ''}`, h)).body;
  s.store.update('home', { screen: 'clock', clockFace: 'daynight' });
  let b = await get(false);
  assert.equal('hw' in b.dn || 'sr' in b.dn || 'ss' in b.dn, false, 'a 64 board gets the 64 fields only');
  b = await get(true);
  assert.deepEqual(b.dn.here, [16, 7]);
  assert.deepEqual(b.dn.hw, [20, 9], 'Morse (42.008 N, 87.666 W) on the 4.5° map');
  assert.ok(wx.sunrise && wx.sunset);
  assert.equal(b.dn.sr, wx.sunrise);
  assert.equal(b.dn.ss, wx.sunset);
  assert.equal(b.cwx, undefined);
  s.store.update('home', { clockFace: 'seventies' });
  b = await get(true);
  assert.deepEqual(Object.keys(b.cwx).sort(), ['icon', 'temp']);
  assert.equal(b.dn, undefined);
  s.store.setCols('home', 64);
  assert.equal((await get(false)).cwx, undefined, 'Seventies at 64 has no temperature');
  await s.close();
});

test('width: the word clock goes only to wide boards that draw it; the analog accent is sent as cacc', async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const HK = 'skyline:seventies:analog:daynight:gradient:digits:daydate:words:peek';
  const get = async (q) => (await s.req(`/board/update?b=home&${q}`, h)).body;
  s.store.update('home', { screen: 'clock', clockFace: 'words' });
  assert.equal((await get(`hk=${HK}&w=128`)).cface, 'words');
  assert.equal((await get(`hk=${HK.replace(':words', '')}&w=128`)).cface, 'skyline', 'firmware without it gets the skyline');
  let b = await get(`hk=${HK}`);
  assert.equal(b.cface, 'skyline', 'a 64 board gets the skyline');
  assert.equal(b.knob.vars[2].includes('words'), false, 'and no WORDS on the knob');
  b = await get(`hk=${HK}&w=128`);
  assert.equal(b.knob.vars[2].includes('words'), true);
  s.store.update('home', { clockFace: 'analog' });
  b = await get(`hk=${HK}&w=128`);
  assert.equal(b.cacc, undefined, 'amber is the default: no cacc');
  assert.equal(b.pv.cacc, undefined);
  s.store.update('home', { analogAccent: 'mint' });
  b = await get(`hk=${HK}&w=128`);
  assert.equal(b.cacc, '#2fe08a');
  assert.equal(b.pv.cacc, '#2fe08a', 'the peek chooser draws the analog face with it too');
  s.store.update('home', { clockFace: 'gradient' });
  assert.equal((await get(`hk=${HK}&w=128`)).cacc, undefined, 'other faces leave it out');
  await s.close();
});

test('clock screen: decided per request from the update\'s own hk, so it never flaps', async () => {
  const { parse } = require('./weather');
  const om = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(parse(om)) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  s.store.update('home', { screen: 'clock' });
  // No health report at all (e.g. right after a server restart): the update's hk is enough.
  let b = (await s.req('/board/update?b=home&hk=skyline', h)).body;
  assert.equal(b.screen, 'clock');
  assert.deepEqual(b.knob.ring, ['transit', 'weather', 'clock', 'cycle']);
  // Another board under the same ID reports health without hk: the S3's own requests still get clock.
  await s.req('/board/version?b=home&hu=60', h);
  for (let i = 0; i < 5; i++) assert.equal((await s.req('/board/update?b=home&hk=skyline', h)).body.screen, 'clock');
  assert.equal((await s.req('/board/update?b=home', h)).body.screen, 'transit', 'a board without hk gets transit');
  // A button press asking for clock, and the knob choosing it.
  assert.equal((await s.req('/board/update?b=home&hk=skyline&s=clock', h)).body.for, 'clock');
  const sel = await s.req('/board/select?b=home&s=clock&hk=skyline', { method: 'POST', headers: { 'X-Board-Token': 'tok' } });
  assert.equal(sel.body.screen, 'clock');
  await s.close();
});

test('cloud strips: the board fetches one by id with its token; the simulator by its path', async () => {
  const s = await serve();
  const h = { headers: { 'X-Board-Token': 'tok' } };
  assert.equal((await fetchRaw(s, '/board/sky/o1?b=home')).status, 401);
  const ok = await fetchRaw(s, '/board/sky/o1?b=home', h);
  assert.equal(ok.status, 200);
  assert.equal(ok.bytes.length, 1664);
  assert.match(ok.headers.get('cache-control'), /immutable/);
  assert.equal((await fetchRaw(s, '/board/sky/zz?b=home', h)).status, 404);
  const sim = await fetchRaw(s, '/board/secret123/api/sky/p1');
  assert.equal(sim.status, 200);
  assert.equal(sim.bytes.length, 1664);
  await s.close();
});
async function fetchRaw(s, p, init = {}) {
  const r = await fetch(`http://127.0.0.1:${s.port}${p}`, init);
  return { status: r.status, headers: r.headers, bytes: new Uint8Array(await r.arrayBuffer()) };
}

test('firmware: CI publishes signed builds to beta with its own token, nothing else', async () => {
  const s = await serveFw({ deployToken: 'deploy123' });
  const build = fakeBuild('ccccccc');
  const post = (headers, body = build) => fetch(`http://127.0.0.1:${s.port}/board/firmware-upload`, { method: 'POST', body, headers });
  assert.equal((await post({ 'X-Deploy-Token': 'nope', 'X-Firmware-Signature': fwSig(build) })).status, 401);
  assert.equal((await post({ 'X-Deploy-Token': 'tok', 'X-Firmware-Signature': fwSig(build) })).status, 401); // the board token isn't it
  assert.equal((await post({ 'X-Deploy-Token': 'deploy123' })).status, 400); // unsigned
  const ok = await post({ 'X-Deploy-Token': 'deploy123', 'X-Firmware-Signature': fwSig(build) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { beta: 'ccccccc' });
  const st = (await s.req('/board/secret123/api/firmware')).body;
  assert.equal(st.channels.beta, 'ccccccc');
  assert.equal(st.channels.stable, null); // never stable
  // The offer carries the signature for the board to check.
  s.store.update('home', { fw: 'beta' });
  const v = await s.req('/board/version?b=home&hu=1&hd=adafruit_matrixportal_s3&hv=1234567', { headers: { 'X-Board-Token': 'tok' } });
  assert.ok(crypto.verify('sha256', build, FW_KEY.publicKey, Buffer.from(v.body.fw.sig, 'hex')));
  await s.close();
  // Off without a deploy token.
  const off = await serveFw();
  assert.equal((await fetch(`http://127.0.0.1:${off.port}/board/firmware-upload`, { method: 'POST', body: build, headers: { 'X-Deploy-Token': '' } })).status, 404);
  await off.close();
});

test('weather icons are static: no radar.iconAnim, and the old per-layout settings are rejected', async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }) });
  const post = (body) => s.req('/board/secret123/api/state?b=home', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await s.req(FULL)).body.radar.iconAnim, undefined);
  for (const key of ['iconsNow', 'icons5day', 'iconsHourly', 'iconsRadar']) assert.equal((await post({ [key]: 'animated' })).status, 400);
  await s.close();
});

test('announce screen: only for firmware that reports it (hk=...:announce); the msg section rides with it', async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const get = async (q = '') => (await s.req('/board/update?b=home' + q, h)).body;
  s.store.update('home', { screen: 'announce', msg: { text: 'Dinner at 7\nbring wine', style: 'type' } });

  // Firmware without it: transit, no ANNOUNCE on the knob, no msg.
  let b = await get('&hk=skyline');
  assert.equal(b.screen, 'transit');
  assert.equal(b.msg, undefined);
  assert.deepEqual(b.knob.ring, ['transit', 'weather', 'clock', 'cycle']);
  assert.equal((await get('&hk=skyline&s=announce')).for, 'transit', 'a press asking for announce gets transit too');

  b = await get('&hk=skyline:seventies:announce');
  assert.equal(b.screen, 'announce');
  assert.equal(b.for, 'announce');
  assert.equal(b.rows, undefined, 'transit sections stay home');
  assert.deepEqual(b.knob, { ring: ['transit', 'weather', 'clock', 'announce', 'cycle'], at: 3 });
  assert.deepEqual(b.msg, { id: s.store.get('home').msg.id, style: 'type', lines: ['Dinner at 7', 'bring wine'] });
  // Other screens leave it out; the simulator's copy keeps it.
  s.store.update('home', { screen: 'transit' });
  assert.equal((await get('&hk=skyline:seventies:announce')).msg, undefined);
  assert.equal((await s.req(FULL)).body.msg.style, 'type');

  // The knob can choose ANNOUNCE.
  const sel = await s.req('/board/select?b=home&s=announce&hk=skyline:seventies:announce', { method: 'POST', headers: { 'X-Board-Token': 'tok' } });
  assert.equal(sel.status, 200);
  assert.equal(sel.body.screen, 'announce');
  assert.equal(sel.body.msg.lines.length, 2);

  // No message yet: the board gets msg null (its call to action).
  s.store.update('home', { msg: null });
  assert.equal((await get('&hk=announce')).msg, null);
  await s.close();
});

test('announce: the control page sets the message; a message that does not fit is a 400', async () => {
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: Math.floor(Date.now() / 1000) }) });
  const post = (body) => s.req('/board/secret123/api/state?b=home', { method: 'POST', body: JSON.stringify(body) });
  let r = await post({ msg: { text: 'Yay!', style: 'big' }, screen: 'announce' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.msg.text, r.body.screen], ['Yay!', 'announce']);
  r = await post({ msg: { text: 'Hooray for everyone', style: 'big' } });
  assert.equal(r.status, 400);
  assert.match(r.body.detail, /doesn't fit the big style/);
  // A wide board (cols 128) takes messages that fit its width, laid out across both panels.
  s.store.setCols('home', 128);
  r = await post({ msg: { text: 'Welcome home', style: 'big' } });
  assert.equal(r.status, 200);
  const wide = await s.req('/board/update?b=home&w=128&hk=announce', { headers: { 'X-Board-Token': 'tok' } });
  assert.deepEqual([wide.body.cols, wide.body.msg.lines, wide.body.msg.x3], [128, ['Welcome home'], undefined]);
  r = await post({ msg: { text: 'Go Cubs', style: 'big' } });
  assert.equal((await s.req('/board/update?b=home&w=128&hk=announce', { headers: { 'X-Board-Token': 'tok' } })).body.msg.x3, 1);
  // sim.png draws it on request.
  const png = await fetch(`http://127.0.0.1:${s.port}/board/secret123/sim.png?b=home&screen=announce&scale=1`);
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  await s.close();
});

test('peek: firmware that draws the peek chooser gets every section, each variant\'s data and the knob\'s variants', async () => {
  const { parse } = require('./weather');
  const om = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(parse(om)) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const HK = 'skyline:seventies:analog:daynight:gradient:announce:peek';
  s.store.update('home', { screen: 'transit', clockFace: 'analog', msg: { text: 'Hi', style: 'note' } });
  const res = await s.req(`/board/update?b=home&hk=${HK}`, h);
  const b = res.body;
  assert.equal(b.for, 'transit');
  // Every screen's sections, not just the shown one's.
  for (const k of ['rows', 'ticker', 'msg', 'cface']) assert.ok(k in b, k);
  assert.ok(b.radar.timeBox, 'the whole radar section');
  // Every variant's data: both forecast layouts and each face.
  assert.ok('days' in b.pv && 'hours' in b.pv);
  assert.equal(b.pv.skyline.face, 'skyline');
  assert.equal(b.pv.cwx.temp, b.cwx.temp);
  assert.deepEqual(Object.keys(b.pv.dn).sort(), ['dec', 'here', 'lon', 't']);
  assert.equal(b.pv.ginv, undefined, 'gradient not inverted');
  assert.deepEqual(b.knob, {
    ring: ['transit', 'weather', 'clock', 'announce', 'cycle'], at: 0,
    vars: [['transit', 'ticker'], ['now', '5day', 'hourly', 'radar'], ['skyline', 'seventies', 'analog', 'daynight', 'gradient'], [], []],
    sel: [0, 0, 2, 0, 0],
  });
  // Only the faces the firmware draws.
  const less = (await s.req('/board/update?b=home&hk=skyline:peek', h)).body;
  assert.deepEqual(less.knob.vars[2], ['skyline']);
  assert.equal(less.pv.dn, undefined);
  // The knob picks a variant with its category.
  const sel = await s.req(`/board/select?b=home&s=clock&v=daynight&hk=${HK}`, { method: 'POST', headers: { 'X-Board-Token': 'tok' } });
  assert.equal(sel.status, 200);
  assert.deepEqual([sel.body.screen, sel.body.cface, sel.body.knob.sel[2]], ['clock', 'daynight', 3]);
  assert.ok('rows' in sel.body, 'still every section');
  assert.equal((await s.req(`/board/select?b=home&s=clock&v=nixie&hk=${HK}`, { method: 'POST', headers: { 'X-Board-Token': 'tok' } })).status, 400);
  // Boards without peek are unchanged: sections, no pv, no variants.
  const old = (await s.req('/board/update?b=home&hk=skyline', h)).body;
  assert.equal(old.pv, undefined);
  assert.deepEqual(Object.keys(old.knob), ['ring', 'at']);
  await s.close();
});

test('radar view (wxView radar): the frames ride along when dry too; peek boards get every kept frame in pv.radar', async () => {
  const now = Math.floor(Date.now() / 1000);
  const dry = { on: false, frames: ['40100-a', '40100-b'], ft: [now - 400, now - 40], timeBox: [40, 0, 24, 22], split: false };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), radar: fakeRadar(dry) });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  s.store.update('home', { screen: 'weather' });
  // Conditions: dry, so no frames (the weather layout).
  let b = (await s.req('/board/update?b=home', h)).body;
  assert.deepEqual(b.radar.frames, []);
  // Radar view: the loop whatever the weather.
  s.store.update('home', { wxView: 'radar' });
  b = (await s.req('/board/update?b=home', h)).body;
  assert.deepEqual([b.radar.on, b.radar.frames], [false, ['40100-a', '40100-b']]);
  assert.deepEqual(b.radar.ft, dry.ft);
  // Peek: every kept frame in pv.radar, whatever the view; the weather variants include radar.
  s.store.update('home', { wxView: 'now' });
  b = (await s.req('/board/update?b=home&hk=skyline:peek', h)).body;
  assert.deepEqual(b.radar.frames, []);
  assert.deepEqual(b.pv.radar, { frames: dry.frames, ft: dry.ft });
  assert.deepEqual(b.knob.vars[1], ['now', '5day', 'hourly', 'radar']);
  const sel = await s.req('/board/select?b=home&s=weather&v=radar&hk=skyline:peek', { method: 'POST', headers: { 'X-Board-Token': 'tok' } });
  assert.deepEqual([sel.body.radar.frames, sel.body.knob.sel[1]], [dry.frames, 3]);
  await s.close();
});

test('firmware: boot images (CI or the page) and the setup image, maker only', async () => {
  const S = require('./setup-image');
  // A real-shaped app and the boot image before it (scripts/split-merged.js).
  const seg = (len) => { const x = Buffer.alloc(8 + len, 0x22); x.writeUInt32LE(0x3c000000, 0); x.writeUInt32LE(len, 4); return x; };
  const h = Buffer.alloc(24, 0); h[0] = 0xe9; h[1] = 1; h.writeUInt16LE(9, 12); h[23] = 1;
  const s1 = seg(2000); s1.write('CTABOARD-BUILD:aaaaaaa:generic;', 100, 'latin1');
  let app = Buffer.concat([h, s1]);
  app = Buffer.concat([app, Buffer.alloc(Math.ceil((app.length + 1) / 16) * 16 - app.length, 0), Buffer.alloc(32, 0x5a)]);
  const boot = Buffer.alloc(0x10000, 0xff);
  boot[0] = 0xe9; boot.writeUInt16LE(9, 12);
  boot.writeUInt32LE(1, 0xe000); // boot_app0
  [[1, 2, 0x9000, 0x5000, 'nvs'], [1, 0, 0xe000, 0x2000, 'otadata'], [0, 0x10, 0x10000, 0x200000, 'ota_0'], [0, 0x11, 0x210000, 0x200000, 'ota_1']].forEach(([t, st, off, size, label], i) => {
    const at = 0x8000 + i * 32;
    boot[at] = 0xaa; boot[at + 1] = 0x50; boot[at + 2] = t; boot[at + 3] = st;
    boot.writeUInt32LE(off, at + 4); boot.writeUInt32LE(size, at + 8); boot.fill(0, at + 12, at + 28); boot.write(label, at + 12, 'latin1');
  });
  const s = await serveFw({ deployToken: 'deploy123' });
  const ci = (q, body, sig) => fetch(`http://127.0.0.1:${s.port}/board/firmware-upload${q}`, { method: 'POST', body, headers: { 'X-Deploy-Token': 'deploy123', 'X-Firmware-Signature': sig } });
  assert.equal((await ci('', app, fwSig(app))).status, 200);
  const image = () => fetch(`http://127.0.0.1:${s.port}/board/secret123/api/firmware/image?v=aaaaaaa`);
  assert.equal((await image()).status, 404, 'no boot image yet');
  assert.equal((await ci('?boot=aaaaaaa', boot, fwSig(app))).status, 400, 'wrong signature');
  assert.equal((await ci('?boot=bbbbbbb', boot, fwSig(boot))).status, 400, 'unknown build');
  const r = await ci('?boot=aaaaaaa', boot, fwSig(boot));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { boot: 'aaaaaaa' });
  assert.equal((await s.req('/board/secret123/api/firmware')).body.builds[0].boot, true);
  // The image: boot + app, which the setup tools read as a merged image.
  const got = Buffer.from(await (await image()).arrayBuffer());
  assert.ok(got.equals(Buffer.concat([boot, app])));
  const info = S.inspectMerged(got);
  assert.equal(info.version, 'aaaaaaa');
  assert.equal(S.flashPlan(got, new Uint8Array(0x5000), info.nvs, info.end).length, 3);
  // The page can attach one too (same checks).
  const page = await s.req('/board/secret123/api/firmware/boot?v=aaaaaaa', signed(boot));
  assert.equal(page.status, 200);
  assert.equal((await s.req('/board/secret123/api/firmware/boot?v=aaaaaaa', { method: 'POST', body: boot, headers: { 'X-Firmware-Signature': fwSig(app) } })).status, 400);
  // Never from an owner link.
  s.store.create('kitchen', { from: 'home' });
  const { body: key } = await s.req('/board/secret123/api/boards/key?b=kitchen', { method: 'POST' });
  for (const p of ['api/firmware/image?v=aaaaaaa', 'api/firmware/boot?v=aaaaaaa']) {
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/board/c/${key.link}/${p}`)).status, 404, p);
  }
  await s.close();
});

test('your own boards with their own token (Set up a board): baseball stays; a transfer makes them someone else\'s', async () => {
  const s = await serve();
  s.store.create('den', { from: 'home' });
  const k = await s.req('/board/secret123/api/boards/key?b=den&mine=1', { method: 'POST' });
  assert.equal(k.status, 200);
  const own = { headers: { 'X-Board-Token': k.body.token } };
  assert.equal((await s.req('/board/version?b=den', own)).status, 200);
  assert.equal((await s.req('/board/version?b=den', { headers: { 'X-Board-Token': 'tok' } })).status, 401, 'its own token only');
  let me = (await s.req('/board/secret123/api/boards')).body.find((b) => b.id === 'den');
  assert.deepEqual([me.mine, me.sports], [true, true]);
  assert.equal((await s.req('/board/secret123/api/state?b=den', { method: 'POST', body: JSON.stringify({ screen: 'baseball' }) })).status, 200);
  // Given away: someone else's now.
  await s.req('/board/secret123/api/boards/transfer?b=den', { method: 'POST' });
  me = (await s.req('/board/secret123/api/boards')).body.find((b) => b.id === 'den');
  assert.deepEqual([me.mine, me.sports], [undefined, false]);
  await s.close();
});

test('Set up a board\'s scripts: the maker\'s page only', async () => {
  const s = await serve();
  const js = await fetch(`http://127.0.0.1:${s.port}/board/secret123/setup-image.js`);
  assert.equal(js.status, 200);
  assert.match(await js.text(), /root\.BoardSetup = factory\(\)/);
  const tools = await fetch(`http://127.0.0.1:${s.port}/board/secret123/setup-tools.js`);
  assert.ok([200, 404].includes(tools.status), 'built by npm run build');
  s.store.create('kitchen', { from: 'home' });
  const { body: key } = await s.req('/board/secret123/api/boards/key?b=kitchen', { method: 'POST' });
  for (const f of ['setup-image.js', 'setup-tools.js']) assert.equal((await fetch(`http://127.0.0.1:${s.port}/board/c/${key.link}/${f}`)).status, 404, f);
  await s.close();
});

test('baseball: a wide board asks the poller for the line score', async () => {
  const asked = [];
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: Math.floor(Date.now() / 1000) }), mlb: { get: (mode, opts) => { asked.push(opts); return []; }, raw: () => null } });
  s.store.update('home', { screen: 'baseball' });
  await s.req('/board/secret123/api/update?b=home');
  assert.equal(asked.at(-1).line, false);
  s.store.setCols('home', 128);
  await s.req('/board/secret123/api/update?b=home');
  assert.equal(asked.at(-1).line, true);
  await s.close();
});
