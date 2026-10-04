'use strict';
// Train Tracker cache and poller. Polls ttarrivals every 30 s for each
// station a board has asked about in the last 2 minutes, so the board never
// waits on CTA and idle stations cost no API calls. Shared by all boards.

const { rawArrivals } = require('./capture');
const { normalize } = require('./arrivals');

function createTracker({
  fetchRaw = rawArrivals,
  interval = 30,      // s between polls per station
  idle = 120,         // s without a board request before polling stops
  forget = 600,       // s without a request before the cache entry is dropped
  tick = 5000,        // ms between scheduler passes
  now = () => Date.now() / 1000,
  log = console,
} = {}) {
  const cache = new Map(); // mapid -> { arrivals, fetchedAt, wantedAt, inflight, failures }
  const unknown = new Set(); // destinations already logged
  let timer = null;

  function entry(mapid) {
    if (!cache.has(mapid)) cache.set(mapid, { arrivals: null, fetchedAt: 0, wantedAt: 0, inflight: null, failures: 0 });
    return cache.get(mapid);
  }

  function refresh(mapid) {
    const e = entry(mapid);
    if (e.inflight) return e.inflight;
    e.inflight = (async () => {
      try {
        const { status, body } = await fetchRaw(mapid);
        if (status !== 200) throw new Error(`HTTP ${status}`);
        const json = JSON.parse(body);
        const err = json && json.ctatt && json.ctatt.errCd;
        if (err !== undefined && String(err) !== '0') throw new Error(`errCd ${err}: ${json.ctatt.errNm}`);
        e.arrivals = normalize(json, { log, unknown });
        e.fetchedAt = now();
        e.failures = 0;
      } catch (err) {
        // Keep the last good data; the board keeps counting down from it.
        e.failures += 1;
        log.error(`[board] Train Tracker ${mapid} failed (${e.failures}): ${err.message}`);
      } finally {
        e.inflight = null;
      }
    })();
    return e.inflight;
  }

  function pass() {
    const t = now();
    for (const [mapid, e] of cache) {
      if (t - e.wantedAt > forget) { cache.delete(mapid); continue; }
      if (t - e.wantedAt <= idle && t - e.fetchedAt >= interval) refresh(mapid);
    }
  }

  return {
    // Latest arrivals for a station, marking it as wanted. On the first
    // request waits briefly for a fetch; returns null if there's no data yet.
    async get(mapid, { wait = 5000 } = {}) {
      const e = entry(mapid);
      e.wantedAt = now();
      if (!e.arrivals) {
        await Promise.race([refresh(mapid), new Promise((r) => setTimeout(r, wait))]);
      }
      return e.arrivals ? { arrivals: e.arrivals, fetchedAt: e.fetchedAt } : null;
    },
    start() {
      if (!timer) {
        timer = setInterval(() => { try { pass(); } catch (err) { log.error('[board] tracker pass failed:', err); } }, tick);
        timer.unref();
      }
      return this;
    },
    stop() { clearInterval(timer); timer = null; },
    pass,
    cache,
  };
}

module.exports = { createTracker };
