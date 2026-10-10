'use strict';
const test = require('node:test');
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

async function serve(opts = {}) {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'board-http-')), log: quiet });
  const board = createBoard({ store, token: 'tok', controlPath: 'secret123', log: quiet, weather: fakeWeather(null), nws: fakeWeather(null), radar: fakeRadar(), mlb: fakeMlb(), logos: fakeLogos(), ...opts });
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    if (parsed.pathname.startsWith('/board/')) return board.handle(req, res, parsed);
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (p, init = {}) => {
    const r = await fetch(base + p, init);
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  return { req, store, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
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

// ---- /board/update ----

const { normalize } = require('./arrivals');
const morseJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tt-arrivals', 'morse-2026-10-03-2316.json'), 'utf8'));

function fakeRadar(state = { on: false, frames: [], ft: [], timeBox: [40, 0, 24, 32], split: true }, frames = {}) {
  return { want: () => state, frame: (mapid, id) => frames[`${mapid}/${id}`] || null };
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
  assert.equal((await s.req('/board/update?b=x', { headers: { 'X-Board-Token': 'tok' } })).status, 404);
  assert.equal((await s.req('/board/update?b=home', { headers: { 'X-Board-Token': 'tok' } })).status, 200);
  // Everything but the trains still works; transit says NO DATA.
  const r = await s.req(FULL);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.age, r.body.stale, r.body.rows, r.body.ticker], [null, 1, [], []]);
  assert.equal(r.body.mlb.games.length, 1);
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

test('update: boot=1 resets brightness, keeps the screen, and bumps v; settings flow through', async () => {
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
  assert.equal(b.bright, 100);
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

test('simulator: station list and previewing another station without changing the board', async () => {
  const tracker = fakeTracker({ arrivals: [], fetchedAt: Math.floor(Date.now() / 1000) });
  const s = await serve({ tracker });
  const list = await s.req('/board/secret123/api/stations');
  assert.equal(list.status, 200);
  assert.ok(list.body.length > 100);
  assert.ok(list.body.some((x) => x.mapid === '40100' && x.desc === 'Morse (Red Line)'));
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
  const w = { ...parse(JSON.parse(fs.readFileSync(fx('open-meteo/morse-2026-10-04-1045.json'), 'utf8'))), sunrise: now - 100, sunset: now + 100 };
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

test('radar visits: off by default, then on a timer for auto only', async () => {
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
  // A forced screen ignores visits.
  await post({ screen: 'ticker' });
  const b = await get();
  assert.equal(b.screen, 'ticker');
  assert.equal(b.radar.visit, null);
  assert.equal((await post({ radarEvery: 61 })).status, 400);
  assert.equal((await post({ radarFor: 5 })).status, 400);
  await s.close();
});

test('auto: main screens, alternating, alert jump, and baseball teams/priority', async () => {
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
  assert.deepEqual([b.screen, b.rot, b.hclock, b.lnc], ['transit', null, true, false]);
  // Ticker as the only Auto screen; then both alternate.
  await post({ autoScreens: ['ticker'] });
  assert.equal((await get()).screen, 'ticker');
  await post({ autoScreens: ['transit', 'ticker'], autoEvery: 120 });
  b = await get();
  assert.deepEqual([b.screen, b.rot], ['transit', { screens: ['transit', 'ticker'], every: 120 }]);
  // The board's copy carries both screens' sections while alternating.
  const board = (await s.req('/board/update?b=home', h)).body;
  assert.ok('rows' in board && 'ticker' in board);
  // Alert jump: watches only with 'all'; warnings with either; over baseball.
  games = [live(1, 'CHC', 'STL')];
  warn = 'watch';
  await post({ alertJump: 'warning' });
  assert.equal((await get()).screen, 'baseball');
  await post({ alertJump: 'all' });
  assert.equal((await get()).screen, 'weather');
  warn = 'warning';
  await post({ alertJump: 'warning' });
  b = await get();
  assert.deepEqual([b.screen, b.rot], ['weather', null]);
  warn = null;
  // Baseball teams and windows reach the poller; a forced Baseball screen shows all.
  await post({ bbTeams: ['sox'], bbPre: 60, bbFinal: 5 });
  await get();
  assert.deepEqual(mlb.asked, { teams: ['sox'], pre: 3600, final: 300 });
  // Priority: 'favorite' keeps only live Cubs/Sox games while one is on;
  // 'all' tells the board to rotate every game.
  games = [live(1, 'NYY', 'BOS'), live(2, 'CWS', 'CLE')];
  await post({ bbPriority: 'favorite' });
  assert.deepEqual((await get()).mlb.games.map((g) => g.id), [2]);
  await post({ bbPriority: 'all' });
  b = await get();
  assert.deepEqual([b.mlb.games.length, b.mlb.all], [2, true]);
  // Header clock and line-colored names.
  await post({ headerClock: false, lineNames: 'line' });
  b = await get();
  assert.deepEqual([b.hclock, b.lnc], [false, true]);
  await s.close();
});

test('update: weather screen gets conditions always, radar frames only while rain is in the box', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const w = parse(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'open-meteo', 'morse-2026-10-04-1045.json'), 'utf8')));
  const h = { headers: { 'X-Board-Token': 'tok' } };
  const screenWx = { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51, feels: null, wind: null, pop: null };
  let s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w) });
  s.store.update('home', { showWeather: false });
  let b = (await s.req(FULL)).body;
  assert.equal(b.wx, null); // weather row off...
  assert.deepEqual(b.radar.wx, screenWx); // ...but the weather screen still gets conditions
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

test('update: the 5-day setting sends the next days with the weather screen conditions', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'open-meteo', 'morse-2026-10-04-1045.json'), 'utf8'));
  const mid = raw.daily.time[0];
  const w = parse({ ...raw, daily: { ...raw.daily, time: [0, 1, 2].map((i) => mid + i * 86400), temperature_2m_max: [68.9, 71.4, 66], temperature_2m_min: [51, 55, 50], weather_code: [0, 61, 2] } });
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

test('update: rain bars replace the radar loop while precipitation is due, when the board asks for them', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'open-meteo', 'morse-2026-10-04-1045.json'), 'utf8'));
  const t0 = Math.ceil(now / 900) * 900;
  const time = [], precipitation = [];
  for (let i = 0; i < 12; i++) { time.push(t0 + i * 900); precipitation.push(i >= 2 && i <= 5 ? 0.5 : 0); }
  const w = parse({ ...raw, minutely_15: { time, precipitation, snowfall: precipitation.map(() => 0) } });
  const radarOn = { on: true, frames: ['x'], ft: [now], timeBox: [40, 0, 24, 22], split: false };
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w), radar: fakeRadar(radarOn) });
  let b = (await s.req(FULL)).body.radar;
  assert.deepEqual(b.frames, ['x']);       // default: the radar loop
  assert.equal(b.wx.rain, undefined);
  s.store.update('home', { wxRain: 'bars' });
  b = (await s.req(FULL)).body.radar;
  assert.deepEqual(b.frames, []);          // bars replace it
  assert.deepEqual(b.ft, []);
  assert.equal(b.wx.rain.snow, 0);
  assert.equal(b.wx.rain.h.length, 8);
  assert.match(b.wx.rain.title, /^RAIN IN \d+ MIN$/);
  await s.close();
  // Dry: no bars, the radar as before.
  const dry = parse({ ...raw, minutely_15: { time, precipitation: precipitation.map(() => 0), snowfall: precipitation.map(() => 0) } });
  const s2 = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(dry), radar: fakeRadar(radarOn) });
  s2.store.update('home', { wxRain: 'bars' });
  b = (await s2.req(FULL)).body.radar;
  assert.equal(b.wx.rain, undefined);
  assert.deepEqual(b.frames, ['x']);
  await s2.close();
});

test('update: the hourly setting sends the four hourly columns with the weather screen conditions', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'open-meteo', 'morse-2026-10-04-1045.json'), 'utf8'));
  const h0 = Math.floor(now / 3600) * 3600;
  const time = Array.from({ length: 13 }, (_, i) => h0 + i * 3600);
  const w = parse({ ...raw, hourly: { time, temperature_2m: time.map((_, i) => 50 + i), weather_code: time.map(() => 3), is_day: time.map(() => 1), precipitation_probability: [] } });
  const s = await serve({ tracker: fakeTracker({ arrivals: [], fetchedAt: now }), weather: fakeWeather(w) });
  assert.equal((await s.req(FULL)).body.radar.wx.hours, undefined);
  s.store.update('home', { wxView: 'hourly' });
  const hours = (await s.req(FULL)).body.radar.wx.hours;
  assert.deepEqual(hours.map((x) => x.t), [53, 56, 59, 62]);
  assert.ok(hours.every((x) => x.icon === 'cloudy' && /^\d{1,2}[AP]$/.test(x.h)));
  assert.equal((await s.req(FULL)).body.radar.wx.days, undefined);
  await s.close();
});

test('simulator preview: header and weather toggles without changing the board', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { parse } = require('./weather');
  const w = parse(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'open-meteo', 'morse-2026-10-04-1045.json'), 'utf8')));
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
  assert.deepEqual((await s.req('/board/secret123/api/test?b=home')).body, { lines: [], warn: null, game: null, radar: null, left: 0 });
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

test('baseball: auto shows it during a game, weather warnings or not', async () => {
  const now = Math.floor(Date.now() / 1000);
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const tracker = () => fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now });
  const game = { id: 7, st: 'live', start: now - 3600, away: { ab: 'CHC', c: '#2a5bd8', r: 1, w: 92, l: 70 }, home: { ab: 'STL', c: '#d62a2a', r: 0, w: 88, l: 74 }, inn: 3, half: 'T', b: 0, s: 0, o: 0, on: [0, 0, 0] };
  const h = { headers: { 'X-Board-Token': 'tok' } };

  let s = await serve({ tracker: tracker(), mlb: fakeMlb([]) });
  let b = (await s.req(FULL)).body;
  assert.equal(b.screen, 'transit');
  assert.deepEqual(b.mlb, { layout: 'classic', games: [] });
  await s.close();

  s = await serve({ tracker: tracker(), mlb: fakeMlb([game]) });
  b = (await s.req(FULL)).body;
  assert.equal(b.screen, 'baseball');
  assert.deepEqual(b.mlb.games, [game]);
  // A weather warning doesn't take the board off the game.
  const post = (body) => fetch(`http://127.0.0.1:${s.port}/board/secret123/api/test?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post({ warn: { kind: 'tor', lvl: 'warning' } });
  assert.equal((await s.req(FULL)).body.screen, 'baseball');
  // The phone can pick baseball directly.
  await post({});
  await fetch(`http://127.0.0.1:${s.port}/board/secret123/api/state?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screen: 'baseball' }) });
  assert.equal((await s.req(FULL)).body.screen, 'baseball');
  await s.close();

});

test('baseball: the simulator test game goes first in the list, in the chosen state', async () => {
  const now = Math.floor(Date.now() / 1000);
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const s = await serve({ tracker: fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now }) });
  const post = (body) => fetch(`http://127.0.0.1:${s.port}/board/secret123/api/test?b=home`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ game: 'extra' })).status, 400);
  for (const st of ['pre', 'live', 'final']) {
    const r = await post({ game: st });
    assert.equal((await r.json()).game, st);
    const b = (await s.req('/board/secret123/api/update?b=home')).body;
    assert.equal(b.mlb.games[0].st, st);
    assert.equal(b.mlb.games[0].away.ab, 'CHC');
    assert.equal(b.screen, 'baseball');
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
  s.store.update('home', { baseballLayout: 'logos' });
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
