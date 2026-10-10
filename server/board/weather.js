'use strict';
// Open-Meteo current conditions for the board's location (its station):
// the weather row (`wx`), the weather screen (`radar.wx`: adds feels-like,
// wind, and the next 6 hours' rain chance), and auto brightness from
// sunrise/sunset. The weather screen's 5-day layout adds the next five
// days' highs and conditions.
// Rules: docs/board/design-spec.md §4–5, contract "Weather row".

const { createLocationPoller, fetchJson } = require('./location-poller');

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const NIGHT_BRIGHT = 40; // % overnight (spec §4)
const POP_HOURS = 6;     // rain chance: max over the next 6 hourly slots
const FORECAST_DAYS = 5; // 5-day layout: the days after today

// Two-letter weekday at a daily slot's time (local midnight; noon keeps it
// clear of DST changes).
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' });
const dayName = (t) => dayFmt.format(new Date((t + 12 * 3600) * 1000)).slice(0, 2).toUpperCase();

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function url(lat, lon) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    current: 'temperature_2m,weather_code,is_day,apparent_temperature,wind_speed_10m,wind_direction_10m',
    hourly: 'precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset,weather_code',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'America/Chicago', timeformat: 'unixtime',
    forecast_days: String(FORECAST_DAYS + 1), forecast_hours: String(POP_HOURS),
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
    // Weather screen extras; null when the response lacks them.
    feels: num(c.apparent_temperature),
    windSpeed: num(c.wind_speed_10m),
    windDir: num(c.wind_direction_10m),
    pop: maxPop(json.hourly),
    days: forecastDays(d),
  };
}

// The days after today with a high and a weather code: [{time, code, hi, lo}].
function forecastDays(d) {
  const out = [];
  for (let i = 1; i <= FORECAST_DAYS; i++) {
    const time = num((d.time || [])[i]), hi = num((d.temperature_2m_max || [])[i]), code = num((d.weather_code || [])[i]);
    if (time == null || hi == null || code == null) break;
    out.push({ time, code, hi, lo: num((d.temperature_2m_min || [])[i]) });
  }
  return out;
}

// Highest hourly precipitation probability in the response (the request asks
// for POP_HOURS hours starting with the current one), or null.
function maxPop(hourly) {
  const v = ((hourly && hourly.precipitation_probability) || []).slice(0, POP_HOURS).map(num).filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
}

// Degrees (direction the wind comes from) -> 8-point compass.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// Wind as the screen shows it: "NW 12" (mph), "CALM" under 1 mph, or null.
function windText(speed, dir) {
  if (speed == null) return null;
  const mph = Math.round(speed);
  if (mph < 1) return 'CALM';
  return dir == null ? String(mph) : `${compass(dir)} ${mph}`;
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

// Parsed weather -> the weather screen's `radar.wx`: the weather row plus
// feels-like (°F), wind text, and rain chance (%); each null when missing.
function toScreenWx(w) {
  return {
    ...toWx(w),
    feels: w.feels == null ? null : Math.round(w.feels),
    wind: windText(w.windSpeed, w.windDir),
    pop: w.pop == null ? null : Math.round(w.pop),
  };
}

// Parsed weather -> the 5-day layout's days: [{d: 'SA', icon, hi}], day
// icons (a daily code has no night), or null without forecast data.
function toDays(w) {
  if (!w.days || !w.days.length) return null;
  return w.days.map((x) => ({ d: dayName(x.time), icon: condition(x.code, true)[0], hi: Math.round(x.hi) }));
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

module.exports = { url, parse, condition, toWx, toScreenWx, toDays, dayName, windText, compass, autoBright, createWeather, NIGHT_BRIGHT, POP_HOURS, FORECAST_DAYS };
