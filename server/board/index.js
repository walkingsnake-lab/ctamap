'use strict';
// LED board router. server.js hands every /board/* request here; nothing
// else in the app knows about the board. API: docs/board/contract.md.

const crypto = require('crypto');
const { createStore, ValidationError } = require('./state');
const { createTracker } = require('./tracker');
const { format } = require('./arrivals');
const fs = require('fs');
const path = require('path');
const { render, assets } = require('./render');

const SIM_HTML = fs.readFileSync(path.join(__dirname, 'sim.html'));
const DRAW_JS = fs.readFileSync(path.join(__dirname, 'draw.js'));
const SIM_ASSETS = JSON.stringify(assets());

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
  tracker = null,
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
  const authed = (req) => !token || sameSecret(req.headers['x-board-token'], token);
  if (!tracker) tracker = createTracker({ log }).start();

  // 'auto' brightness is 100 until sunrise/sunset data lands (weather PR).
  const resolveBright = (b) => (b === 'off' ? 0 : b === 'auto' ? 100 : b);
  // 'auto' screen is transit until radar and its rain trigger land.
  const resolveScreen = (s) => (s === 'auto' ? 'transit' : s);

  // `previewMapid` (simulator only) shows another station without changing
  // the board's config; the board's row list is station-specific, so it's
  // ignored while previewing.
  // Last transit view per board and station, for the chrono hysteresis.
  // In memory only: after a restart the view is chosen fresh.
  const views = new Map();

  async function update(board, id, boot, previewMapid) {
    if (boot) board = store.boot(id);
    if (previewMapid && previewMapid !== board.station.mapid) {
      const st = stationById.get(previewMapid);
      board = { ...board, station: { mapid: st.mapid, name: st.short }, rows: [] };
    }
    const data = await tracker.get(board.station.mapid);
    if (!data) return null;
    const now = nowSecs();
    // Weather isn't wired up yet; the row cap only reserves space for the
    // weather row when there's weather to show.
    const wx = null;
    const cfg = { ...board, showWeather: board.showWeather && !!wx };
    const viewKey = `${id}:${board.station.mapid}`;
    const { view, viewState, rows, ticker } = format(data.arrivals, cfg, { now, alerts: new Set(), prevView: views.get(viewKey) });
    views.set(viewKey, viewState);
    return {
      v: board.v,
      now,
      age: Math.max(0, Math.round(now - data.fetchedAt)),
      screen: resolveScreen(board.screen),
      bright: resolveBright(board.bright),
      header: board.showHeader ? board.station.name : null,
      view,
      rows,
      ticker,
      wx,
      warn: null,
      radar: { on: false, frames: [], ft: [], clock: null, split: false },
    };
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
      return send(res, 200, { v: board.v, now: nowSecs() });
    }

    if (first === 'update' && rest.length === 0) {
      if (method !== 'GET') return send(res, 405, { err: 'method' });
      if (!authed(req)) return send(res, 401, { err: 'bad_token' });
      const id = String(parsed.query.b || '');
      const board = store.get(id);
      if (!board) return send(res, 404, { err: 'unknown_board' });
      const body = await update(board, id, parsed.query.boot === '1');
      if (!body) return send(res, 503, { err: 'not_ready' });
      return send(res, 200, body);
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

      // Same payload as /board/update, for the simulator (the path is the credential).
      if (sub === 'api/update') {
        if (method !== 'GET') return send(res, 405, { err: 'method' });
        const id = String(parsed.query.b || '');
        const board = store.get(id);
        if (!board) return send(res, 404, { err: 'unknown_board' });
        const preview = String(parsed.query.mapid || '');
        if (preview && !stationById.has(preview)) return send(res, 400, { err: 'invalid', detail: `unknown mapid: ${preview}` });
        const body = await update(board, id, false, preview);
        if (!body) return send(res, 503, { err: 'not_ready' });
        return send(res, 200, body);
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
        const preview = String(parsed.query.mapid || '');
        if (preview && !stationById.has(preview)) return send(res, 400, { err: 'invalid', detail: `unknown mapid: ${preview}` });
        const body = await update(board, id, false, preview);
        if (!body) return send(res, 503, { err: 'not_ready' });
        const screen = ['transit', 'ticker'].includes(parsed.query.screen) ? parsed.query.screen : body.screen;
        const scale = Math.min(16, Math.max(1, parseInt(parsed.query.scale, 10) || 8));
        const frame = render(body, {
          screen,
          page: Math.max(0, parseInt(parsed.query.page, 10) || 0),
          blink: parsed.query.blink === '1',
        });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(frame.toPNG(scale));
        return;
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

module.exports = { createBoard };
