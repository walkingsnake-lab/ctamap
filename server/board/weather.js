'use strict';
// Open-Meteo current conditions for the board's location (its station):
// the weather row (`wx`) and auto brightness from sunrise/sunset.
// Rules: docs/board/design-spec.md §4–5, contract "Weather row".

const { createLocationPoller, fetchJson } = require('./location-poller');

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

// Open-Meteo per location, every 10 min while a board is asking.
function createWeather({ fetch = (lat, lon) => fetchJson(url(lat, lon)), interval = 600, ...opts } = {}) {
  return createLocationPoller({ name: 'weather', fetch, parse, interval, ...opts });
}

module.exports = { url, parse, condition, toWx, autoBright, createWeather, NIGHT_BRIGHT };
