'use strict';
// Bus Tracker cache and poller, and the lookups the control page's bus
// picker uses (routes, a route's directions, its stops). Predictions are
// kept per stop: every 30 s for each stop a board has asked about in the
// last 2 minutes, up to 10 stops per call, so a board's buses cost one call
// per poll and the board never waits on CTA. Shared by all boards. Off
// without a key (CTA_BUS_KEY: Bus Tracker's own, not the Train Tracker one).

const { rawBus } = require('./capture');
const { normalize } = require('./bus');
const { latchDue } = require('./arrivals');
const { backoff } = require('./location-poller');

const MAX_STOPS = 10;  // per getpredictions call

function createBusTracker({
  key = process.env.CTA_BUS_KEY || '',
  fetchRaw = null,    // (fn, params) -> { status, body }; default: Bus Tracker with `key`
  interval = 30,      // s between polls per stop
  idle = 120,         // s without a board request before polling stops
  forget = 600,       // s without a request before a stop is dropped
  lookupTtl = 86400,  // s a routes / directions / stops answer is kept
  tick = 5000,        // ms between scheduler passes
  now = () => Date.now() / 1000,
  log = console,
} = {}) {
  const enabled = !!(fetchRaw || key);
  if (!fetchRaw) fetchRaw = (fn, params) => rawBus(fn, params, { key });
  const cache = new Map();   // stpid -> { preds, fetchedAt, wantedAt, inflight, failures, retryAt, gone }
  const lookups = new Map(); // call + params -> { at, data }
  let timer = null;

  async function call(fn, params) {
    const { status, body } = await fetchRaw(fn, params);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    return JSON.parse(body);
  }

  function entry(stpid) {
    if (!cache.has(stpid)) cache.set(stpid, { preds: null, fetchedAt: 0, wantedAt: 0, inflight: null, failures: 0, retryAt: 0, gone: false });
    return cache.get(stpid);
  }

  // One getpredictions call for up to MAX_STOPS stops.
  function refresh(stpids) {
    const run = (async () => {
      try {
        const json = await call('getpredictions', { stpid: stpids.join(','), tmres: 's' });
        const t = now();
        const { preds, gone } = normalize(json, { now: t });
        for (const id of stpids) {
          const e = entry(id);
          e.preds = latchDue(e.preds, preds.filter((p) => p.stpid === id), t);
          e.fetchedAt = t;
          e.failures = 0;
          if (gone.has(id) && !e.gone) log.warn(`[board] Bus Tracker doesn't know stop ${id}`);
          e.gone = gone.has(id);
        }
      } catch (err) {
        // Keep the last good data; the board keeps counting down from it.
        for (const id of stpids) {
          const e = entry(id);
          e.failures += 1;
          e.retryAt = now() + backoff(interval, e.failures);
        }
        log.error(`[board] Bus Tracker ${stpids.join(',')} failed: ${err.message}`);
      } finally {
        for (const id of stpids) entry(id).inflight = null;
      }
    })();
    for (const id of stpids) entry(id).inflight = run;
    return run;
  }
  const batches = (ids) => { const out = []; for (let i = 0; i < ids.length; i += MAX_STOPS) out.push(ids.slice(i, i + MAX_STOPS)); return out; };

  function pass() {
    const t = now();
    const due = [];
    for (const [id, e] of cache) {
      if (t - e.wantedAt > forget) { cache.delete(id); continue; }
      if (!e.inflight && t - e.wantedAt <= idle && t - e.fetchedAt >= interval && t >= e.retryAt) due.push(id);
    }
    for (const b of batches(due)) refresh(b);
  }

  // A cached lookup; on failure the last answer, if there is one.
  async function lookup(id, fn, params, pick) {
    const hit = lookups.get(id);
    if (hit && now() - hit.at < lookupTtl) return hit.data;
    try {
      const root = (await call(fn, params))['bustime-response'] || {};
      const errs = Array.isArray(root.error) ? root.error : root.error ? [root.error] : [];
      if (errs.length) throw new Error(String(errs[0].msg || 'error'));
      const data = pick(root);
      lookups.set(id, { at: now(), data });
      return data;
    } catch (err) {
      if (hit) return hit.data;
      throw err;
    }
  }
  const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);

  return {
    enabled,
    // Latest predictions for these stops, marking them as wanted. On a
    // stop's first request waits briefly for a fetch. Returns { preds,
    // fetchedAt (the oldest of the stops'), gone (stops Bus Tracker doesn't
    // know) }, or null with no data for any of them yet.
    async get(stpids, { wait = 5000 } = {}) {
      const ids = [...new Set(stpids.map(String))];
      const t = now();
      const need = [], flights = new Set();
      for (const id of ids) {
        const e = entry(id);
        e.wantedAt = t;
        if (e.preds) continue;
        if (e.inflight) flights.add(e.inflight);
        else if (t >= e.retryAt) need.push(id);
      }
      for (const b of batches(need)) flights.add(refresh(b));
      if (flights.size) await Promise.race([Promise.all(flights), new Promise((r) => setTimeout(r, wait))]);
      const have = ids.map(entry).filter((e) => e.preds);
      if (!have.length) return null;
      return {
        preds: have.flatMap((e) => e.preds).sort((a, b) => a.t - b.t),
        fetchedAt: Math.min(...have.map((e) => e.fetchedAt)),
        gone: ids.filter((id) => entry(id).gone),
      };
    },
    // The picker: every route, a route's directions, its stops that way.
    routes: () => lookup('routes', 'getroutes', {}, (r) => arr(r.routes).map((x) => ({ rt: String(x.rt), name: String(x.rtnm || '') }))),
    directions: (rt) => lookup(`dir:${rt}`, 'getdirections', { rt }, (r) => arr(r.directions).map((x) => String(x.id != null ? x.id : x.dir != null ? x.dir : x.name))),
    stops: (rt, dir) => lookup(`stops:${rt}:${dir}`, 'getstops', { rt, dir }, (r) => arr(r.stops).map((x) => ({ stpid: String(x.stpid), name: String(x.stpnm || '') }))),
    start() {
      if (!timer && enabled) {
        timer = setInterval(() => { try { pass(); } catch (err) { log.error('[board] bus tracker pass failed:', err); } }, tick);
        timer.unref();
      }
      return this;
    },
    stop() { clearInterval(timer); timer = null; },
    pass,
    cache,
  };
}

module.exports = { createBusTracker, MAX_STOPS };
