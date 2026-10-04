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
  return { req, store, close: () => new Promise((r) => server.close(r)) };
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
