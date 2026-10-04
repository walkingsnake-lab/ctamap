'use strict';
// Open-Meteo current conditions for the board's location (its station):
// the weather row (`wx`) and auto brightness from sunrise/sunset.
// Rules: docs/board/design-spec.md §4–5, contract "Weather row".

const https = require('https');

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const NIGHT_BRIGHT = 40; // % overnight (spec §4)

function url(lat, lon) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    current: 'temperature_2m,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset',
    temperature_unit: 'fahrenheit', timezone: 'America/Chicago', timeformat: 'unixtime', forecast_days: '1',
  });
  return `${OPEN_METEO}?${q}`;
}

// Raw Open-Meteo JSON -> the fields the board uses.
function parse(json) {
  const c = json && json.current, d = json && json.daily;
  if (!c || !d || typeof c.temperature_2m !== 'number') throw new Error('not an Open-Meteo forecast');
  return {
    time: c.time,
    temp: c.temperature_2m,
    code: c.weather_code,
    isDay: c.is_day === 1,
    hi: d.temperature_2m_max[0],
    lo: d.temperature_2m_min[0],
    sunrise: d.sunrise[0],
    sunset: d.sunset[0],
  };
}

// WMO weather code -> icon and condition word. Words are the contract's
// placeholder list (an open decision).
function condition(code, isDay) {
  if (code === 0 || code === 1) return isDay ? ['sun', 'SUNNY'] : ['moon', 'CLEAR'];
  if (code === 2) return [isDay ? 'pcloudy_day' : 'pcloudy_night', 'PT CLOUDY'];
  if (code === 3) return ['cloudy', 'CLOUDY'];
  if (code === 45 || code === 48) return ['fog', 'FOG'];
  if (code === 56 || code === 57 || code === 66 || code === 67) return ['ice', 'FRZ RAIN'];
  if ((code >= 51 && code <= 55) || (code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return ['rain', 'RAIN'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', 'SNOW'];
  if (code >= 95 && code <= 99) return ['storm', 'STORMS'];
  return ['cloudy', 'CLOUDY']; // unknown code: neutral
}

// Parsed weather -> the payload's `wx`.
function toWx(w) {
  const [icon, word] = condition(w.code, w.isDay);
  return { icon, temp: Math.round(w.temp), word, hi: Math.round(w.hi), lo: Math.round(w.lo) };
}

// 'auto' brightness: full from sunrise to sunset, dimmer overnight. Uses the
// day's times even slightly stale (a few minutes off at midnight is fine).
function autoBright(w, now) {
  if (!w) return 100;
  return now >= w.sunrise && now < w.sunset ? 100 : NIGHT_BRIGHT;
}

function fetchJson(u, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(u, { timeout, headers: { 'User-Agent': 'ctamap-board' } }, (res) => {
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

// Per-location cache, polled every `interval` s while a board wants it
// (same pattern as tracker.js). Keeps the last good data.
function createWeather({
  fetch = (lat, lon) => fetchJson(url(lat, lon)),
  interval = 600, idle = 300, forget = 3600, tick = 15000,
  now = () => Date.now() / 1000,
  log = console,
} = {}) {
  const cache = new Map(); // "lat,lon" -> { lat, lon, data, fetchedAt, wantedAt, inflight }
  let timer = null;

  function refresh(e) {
    if (e.inflight) return e.inflight;
    e.inflight = (async () => {
      try {
        e.data = parse(await fetch(e.lat, e.lon));
        e.fetchedAt = now();
      } catch (err) {
        log.error(`[board] weather ${e.lat},${e.lon} failed: ${err.message}`);
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
      if (t - e.wantedAt <= idle && t - e.fetchedAt >= interval) refresh(e);
    }
  }

  return {
    // Latest parsed weather for a location, or null. Waits briefly on first use.
    async get(lat, lon, { wait = 3000 } = {}) {
      const k = `${lat.toFixed(3)},${lon.toFixed(3)}`;
      if (!cache.has(k)) cache.set(k, { lat, lon, data: null, fetchedAt: 0, wantedAt: 0, inflight: null });
      const e = cache.get(k);
      e.wantedAt = now();
      if (!e.data) await Promise.race([refresh(e), new Promise((r) => setTimeout(r, wait))]);
      return e.data;
    },
    start() {
      if (!timer) {
        timer = setInterval(() => { try { pass(); } catch (err) { log.error('[board] weather pass failed:', err); } }, tick);
        timer.unref();
      }
      return this;
    },
    stop() { clearInterval(timer); timer = null; },
    pass,
  };
}

module.exports = { url, parse, condition, toWx, autoBright, createWeather, NIGHT_BRIGHT };
