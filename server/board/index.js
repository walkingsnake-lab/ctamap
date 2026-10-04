'use strict';
// LED board router. server.js hands every /board/* request here; nothing
// else in the app knows about the board. API: docs/board/contract.md.

const crypto = require('crypto');
const { createStore, ValidationError } = require('./state');

const MAX_BODY = 8 * 1024;
// Board endpoint names; the control path must not collide with them.
const RESERVED = new Set(['ping', 'version', 'update', 'radar']);

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
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
  stationIds = new Set(require('./stations.json').map((s) => s.mapid)),
  log = console,
} = {}) {
  if (!token) log.warn('[board] BOARD_TOKEN not set; board endpoints are unauthenticated');
  if (!controlPath) log.warn('[board] BOARD_CONTROL_PATH not set; control endpoints are disabled');
  if (controlPath && (RESERVED.has(controlPath) || controlPath.includes('/'))) {
    log.error('[board] BOARD_CONTROL_PATH collides with a board endpoint or contains "/"; control endpoints are disabled');
    controlPath = '';
  }

  const authed = (req) => !token || sameSecret(req.headers['x-board-token'], token);

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
      return send(res, 200, { v: board.v, now: nowSecs() });
    }

    // ---- control endpoints, under the secret path ----
    if (controlPath && first && sameSecret(first, controlPath)) {
      const sub = rest.join('/');
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

      // Raw Train Tracker response for recording fixtures.
      if (sub === 'api/raw/arrivals') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const mapid = String(parsed.query.mapid || '');
        if (!stationIds.has(mapid)) return send(res, 400, { err: 'invalid', detail: `unknown mapid: ${mapid}` });
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

module.exports = { createBoard };
