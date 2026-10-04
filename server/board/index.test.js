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

// Spin up a server that routes /board/* the same way server.js does.
async function serve(opts = {}) {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'board-http-')), log: quiet });
  const board = createBoard({ store, token: 'tok', controlPath: 'secret123', log: quiet, ...opts });
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

function fakeTracker(data) {
  const asked = [];
  return { asked, get: async (mapid) => { asked.push(mapid); return data; } };
}

test('update: auth, unknown board, and not-ready', async () => {
  const s = await serve({ tracker: fakeTracker(null) });
  assert.equal((await s.req('/board/update?b=home')).status, 401);
  assert.equal((await s.req('/board/update?b=x', { headers: { 'X-Board-Token': 'tok' } })).status, 404);
  const r = await s.req('/board/update?b=home', { headers: { 'X-Board-Token': 'tok' } });
  assert.equal(r.status, 503);
  assert.equal(r.body.err, 'not_ready');
  await s.close();
});

test('update: payload shape for the default Morse board', async () => {
  const now = Math.floor(Date.now() / 1000);
  // Shift the Morse fixture so its arrivals are in the future relative to now.
  const arrivals = normalize(morseJson, { log: quiet });
  const shift = now - Math.min(...arrivals.map((a) => a.t)) + 120;
  const tracker = fakeTracker({ arrivals: arrivals.map((a) => ({ ...a, t: a.t + shift })), fetchedAt: now - 7 });
  const s = await serve({ tracker });
  const r = await s.req('/board/update?b=home', { headers: { 'X-Board-Token': 'tok' } });
  assert.equal(r.status, 200);
  const b = r.body;
  assert.deepEqual(tracker.asked, ['40100']);
  assert.equal(b.v, 1);
  assert.ok(Math.abs(b.now - now) < 5);
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

test('update: boot=1 resets screen/brightness and bumps v; settings flow through', async () => {
  const tracker = fakeTracker({ arrivals: [], fetchedAt: Math.floor(Date.now() / 1000) });
  const s = await serve({ tracker });
  s.store.update('home', { screen: 'ticker', bright: 'off', showHeader: false });
  const h = { headers: { 'X-Board-Token': 'tok' } };
  let b = (await s.req('/board/update?b=home', h)).body;
  assert.equal(b.screen, 'ticker');
  assert.equal(b.bright, 0);
  assert.equal(b.header, null);
  assert.deepEqual(b.rows, []);
  b = (await s.req('/board/update?b=home&boot=1', h)).body;
  assert.equal(b.screen, 'transit');
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
