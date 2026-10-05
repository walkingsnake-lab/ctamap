'use strict';
// Per-location cache for weather sources (Open-Meteo, NWS), polled every
// `interval` s while a board has asked in the last `idle` s, so idle
// locations cost no requests. Keeps the last good data on failure. Same
// pattern as tracker.js.

// Seconds before retrying after `failures` failures in a row: the normal
// interval, doubling up to 5 minutes (or the interval, if longer).
const backoff = (interval, failures) => Math.min(interval * 2 ** (failures - 1), Math.max(interval, 300));

function createLocationPoller({
  name,
  fetch,                // (lat, lon) -> raw response
  parse = (x) => x,     // raw -> stored data; throws on bad input
  interval, idle = 300, forget = 3600, tick = 15000,
  now = () => Date.now() / 1000,
  log = console,
}) {
  const cache = new Map(); // "lat,lon" -> { lat, lon, data, fetchedAt, wantedAt, inflight, failures, retryAt }
  let timer = null;

  function refresh(e) {
    if (e.inflight) return e.inflight;
    e.inflight = (async () => {
      try {
        e.data = parse(await fetch(e.lat, e.lon));
        e.fetchedAt = now();
        e.failures = 0;
      } catch (err) {
        e.failures += 1;
        e.retryAt = now() + backoff(interval, e.failures);
        log.error(`[board] ${name} ${e.lat},${e.lon} failed: ${err.message}`);
      } finally {
        e.inflight = null;
      }
    })();
    return e.inflight;
  }

  function pass() {
    const t = now();
    for (const [k, e] of cache) {
      if (t - e.wantedAt > forget) { cache.delete(k); continue; }
      if (t - e.wantedAt <= idle && t - e.fetchedAt >= interval && t >= e.retryAt) refresh(e);
    }
  }

  return {
    // Latest data for a location, or null. Waits briefly on first use.
    async get(lat, lon, { wait = 3000 } = {}) {
      const k = `${lat.toFixed(3)},${lon.toFixed(3)}`;
      if (!cache.has(k)) cache.set(k, { lat, lon, data: null, fetchedAt: 0, wantedAt: 0, inflight: null, failures: 0, retryAt: 0 });
      const e = cache.get(k);
      e.wantedAt = now();
      if (!e.data && (e.inflight || now() >= e.retryAt)) await Promise.race([refresh(e), new Promise((r) => setTimeout(r, wait))]);
      return e.data;
    },
    start() {
      if (!timer) {
        timer = setInterval(() => { try { pass(); } catch (err) { log.error(`[board] ${name} pass failed:`, err); } }, tick);
        timer.unref();
      }
      return this;
    },
    stop() { clearInterval(timer); timer = null; },
    pass,
  };
}

// GET a JSON URL over HTTPS with a timeout.
function fetchJson(u, { timeout = 10000, headers = {} } = {}) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.get(u, { timeout, headers: { 'User-Agent': 'ctamap-board (github.com/walkingsnake-lab/ctamap)', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

module.exports = { createLocationPoller, fetchJson, backoff };
