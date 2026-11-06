'use strict';
// WeatherAPI.com current conditions for the board's location (its station's
// grid cell, below): the weather row (`wx`), the weather screen (`radar.wx`:
// adds feels-like, wind, and the next 6 hours' rain chance), and auto
// brightness from sunrise/sunset. The weather screen's 5-day and hourly
// layouts get a fallback forecast here; NWS (nws-forecast.js) lays its own
// over it. (The rain bars, which needed 15-minute precipitation WeatherAPI
// doesn't have, were cut in Nov 2026.)
// Rules: docs/board/design-spec.md §4–5, contract "Weather row".
//
// Terms (weatherapi.com/terms.aspx): the free plan credits WeatherAPI.com by
// name; data shown to end users comes with their disclaimer (both on the
// control page); current conditions are cached at most 60 minutes, so saved
// and in-memory data expire after MAX_AGE.

const { createLocationPoller, fetchJson } = require('./location-poller');
const { parseCtaTime } = require('./time');

const WEATHERAPI = 'https://api.weatherapi.com/v1/forecast.json';
const NIGHT_BRIGHT = 40; // % overnight (spec §4)
const POP_HOURS = 6;     // rain chance: max over the next 6 hourly slots
const FORECAST_DAYS = 5; // 5-day layout: the days after today
const API_DAYS = 3;      // forecast days the free plan returns (today + 2)
const MAX_AGE = 3600;    // s: WeatherAPI's limit for caching current conditions
// Hourly layout: the slots HOUR_STEPS hours after the current hour.
const HOUR_STEPS = [2, 4, 6, 8];
const HOURS = HOUR_STEPS[HOUR_STEPS.length - 1] + 1;
// Wide boards (contract "Width"): the 7-day layout (today and the six days
// after), and the 24-hour layout (eight slots 3 hours apart, on the hours
// divisible by 3).
const WEEK_DAYS = 7;
const DAY_SLOTS = 8, SLOT_HOURS = 3;
// Two-letter weekday at a daily slot's time (noon keeps it clear of DST
// changes; WeatherAPI's date_epoch is the date's UTC midnight, which noon
// keeps on the same Chicago date).
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' });
const dayName = (t) => dayFmt.format(new Date((t + 12 * 3600) * 1000)).slice(0, 2).toUpperCase();

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---- grid cells ----
// Weather doesn't change between neighboring stations, so stations share a
// fetch per 0.1° cell (~11 x 8 km): the 144 L stations fall in 10 cells.
// Each cell is fetched at the mean position of its stations (a lakefront
// cell's center can be in the lake); a point with no station in its cell
// uses the cell center.
const CELL = 0.1;
const cellKey = (lat, lon) => `${Math.round(lat / CELL)},${Math.round(lon / CELL)}`;
function stationCells(stations) {
  const acc = new Map();
  for (const s of stations || []) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const k = cellKey(s.lat, s.lon);
    const a = acc.get(k) || { lat: 0, lon: 0, n: 0 };
    a.lat += s.lat; a.lon += s.lon; a.n += 1;
    acc.set(k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, { lat: a.lat / a.n, lon: a.lon / a.n }]));
}
const CELLS = stationCells(require('./stations.json'));
function cellPoint(lat, lon, cells = CELLS) {
  return cells.get(cellKey(lat, lon)) || { lat: Math.round(lat / CELL) * CELL, lon: Math.round(lon / CELL) * CELL };
}

// ---- WeatherAPI ----

function url(lat, lon, key) {
  const q = new URLSearchParams({ key, q: `${lat.toFixed(4)},${lon.toFixed(4)}`, days: String(API_DAYS), aqi: 'no', alerts: 'no' });
  return `${WEATHERAPI}?${q}`;
}

// WeatherAPI condition code -> WMO weather code, so everything downstream
// (condition(), radar snow mode, the contract's icon list) keeps reading
// WMO codes. Haze, dust, smoke and smog show as fog (like NWS's codes);
// sleet and ice pellets as freezing rain (the ice icon). Codes from
// weatherapi.com/docs/weather_conditions.json (60 codes).
const WMO_OF = {
  1000: 0, 1003: 2, 1006: 3, 1009: 3,
  1012: 45, 1015: 45, 1018: 45, 1021: 45, 1024: 45, 1027: 45, 1030: 45, 1033: 45, 1036: 45, 1039: 45, 1042: 45, 1045: 45, 1048: 45,
  1063: 80, 1066: 85, 1069: 66, 1072: 56, 1087: 95, 1114: 73, 1117: 75, 1135: 45, 1147: 48,
  1150: 51, 1153: 51, 1168: 56, 1171: 57,
  1180: 61, 1183: 61, 1186: 63, 1189: 63, 1192: 65, 1195: 65,
  1198: 66, 1201: 67, 1204: 66, 1207: 67,
  1210: 71, 1213: 71, 1216: 73, 1219: 73, 1222: 75, 1225: 75, 1237: 66,
  1240: 80, 1243: 81, 1246: 82, 1249: 66, 1252: 67, 1255: 85, 1258: 86, 1261: 66, 1264: 67,
  1273: 95, 1276: 95, 1279: 95, 1282: 95,
};
// Unknown codes read as overcast (neutral), missing ones as null.
const waCode = (cond) => num(cond && cond.code);
const wmo = (cond) => {
  const c = waCode(cond);
  return c == null ? null : WMO_OF[c] ?? 3;
};

// WeatherAPI conditions WMO can't tell apart, by WeatherAPI code: mist and
// the obscurations keep the fog icon with their own word, and thundersnow gets
// its own icon (WMO only has thunderstorms).
const WA_FOG = { 1012: 'HAZE', 1015: 'DUST', 1018: 'DUST', 1021: 'DUST', 1024: 'DUST', 1027: 'DUST', 1030: 'MIST', 1033: 'SMOKE', 1036: 'SMOKE', 1039: 'SMOG', 1042: 'SMOG', 1045: 'DUST', 1048: 'DUST' };
const THUNDERSNOW = new Set([1279, 1282]);

// "06:51 AM" on "2026-10-04" (Chicago) -> epoch seconds, or null
// ("No sunrise", missing).
function clockOn(date, clock) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(String(clock || '').trim());
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === 'P' ? 12 : 0);
  return parseCtaTime(`${date} ${String(h).padStart(2, '0')}:${m[2]}:00`);
}

// Raw WeatherAPI forecast.json -> the fields the board uses.
function parse(json) {
  const c = json && json.current;
  const fd = (json && json.forecast && json.forecast.forecastday) || [];
  if (!c || typeof c.temp_f !== 'number' || !fd.length || !fd[0].day) throw new Error('not a WeatherAPI forecast');
  const today = fd[0];
  // The response's own time picks the current hour (hours are fetched with
  // the forecast, not at request time).
  const ref = num(json.location && json.location.localtime_epoch) ?? c.last_updated_epoch;
  const hours = fd.flatMap((d) => d.hour || []).filter((h) => num(h.time_epoch) != null && h.time_epoch + 3600 > ref).slice(0, HOURS);
  return {
    time: c.last_updated_epoch,
    temp: c.temp_f,
    code: wmo(c.condition),
    wa: waCode(c.condition), // WeatherAPI's own code, for condition()'s finer words
    isDay: c.is_day === 1,
    hi: num(today.day.maxtemp_f),
    lo: num(today.day.mintemp_f),
    sunrise: clockOn(today.date, today.astro && today.astro.sunrise),
    sunset: clockOn(today.date, today.astro && today.astro.sunset),
    feels: num(c.feelslike_f),
    windSpeed: num(c.wind_mph),
    windDir: num(c.wind_degree),
    // Cloud cover, %: the skyline face's cloud states (skyline.js).
    clouds: num(c.cloud),
    pop: maxPop(hours),
    days: forecastDays(fd),
    hrs: hours.map((h) => ({ time: h.time_epoch, temp: num(h.temp_f), code: wmo(h.condition), wa: waCode(h.condition), isDay: h.is_day === 1 })),
  };
}

// 3 PM -> "3P", midnight "12A".
const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: true });
const hourOfDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' });
const hourLabel = (t) => hourFmt.format(new Date(t * 1000)).replace(/\s?([AP])M$/i, '$1').toUpperCase();

// The days after today with a high and a weather code: [{time, code, hi, lo}].
function forecastDays(fd) {
  const out = [];
  for (let i = 1; i <= FORECAST_DAYS && i < fd.length; i++) {
    const d = fd[i] || {}, day = d.day || {};
    const time = num(d.date_epoch), hi = num(day.maxtemp_f), code = wmo(day.condition);
    if (time == null || hi == null || code == null) break;
    out.push({ time, code, wa: waCode(day.condition), hi, lo: num(day.mintemp_f) });
  }
  return out;
}

// Highest rain or snow chance over the first POP_HOURS hourly slots (from
// the current hour), or null.
function maxPop(hours) {
  const v = hours.slice(0, POP_HOURS).flatMap((h) => [num(h.chance_of_rain), num(h.chance_of_snow)]).filter((x) => x != null);
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
// placeholder list (an open decision). `wa`, WeatherAPI's code when known,
// refines what WMO lumps together: mist, haze, smoke, dust and smog (fog icon,
// their own word) and thundersnow (its own icon).
function condition(code, isDay, wa) {
  if (THUNDERSNOW.has(wa)) return ['tsnow', 'THNDRSNOW'];
  if (WA_FOG[wa]) return ['fog', WA_FOG[wa]];
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

// Parsed weather with its temperatures in the board's unit ('F' as fetched,
// or 'C'), converted before rounding. Wind stays mph; everything else is
// untouched (radar snow mode reads the original).
const toC = (f) => (f == null ? f : (f - 32) * 5 / 9);
function inUnit(w, unit) {
  if (!w || unit !== 'C') return w;
  return {
    ...w,
    temp: toC(w.temp), hi: toC(w.hi), lo: toC(w.lo), feels: toC(w.feels),
    days: (w.days || []).map((x) => ({ ...x, hi: toC(x.hi), lo: toC(x.lo) })),
    hrs: (w.hrs || []).map((x) => ({ ...x, temp: toC(x.temp) })),
    ...(w.week ? { week: w.week.map((x) => ({ ...x, hi: toC(x.hi), lo: toC(x.lo) })) } : {}),
  };
}

// Parsed weather -> the payload's `wx`.
function toWx(w) {
  const [icon, word] = condition(w.code, w.isDay, w.wa);
  return { icon, temp: Math.round(w.temp), word, hi: Math.round(w.hi), lo: Math.round(w.lo) };
}

// Parsed weather -> the weather screen's `radar.wx`: the weather row plus
// feels-like (board unit), wind text, and rain chance (%); each null when missing.
function toScreenWx(w) {
  return {
    ...toWx(w),
    feels: w.feels == null ? null : Math.round(w.feels),
    wind: windText(w.windSpeed, w.windDir),
    pop: w.pop == null ? null : Math.round(w.pop),
  };
}

// The conditions screen's RAIN line, with a buffer so a chance hovering
// around one value doesn't make the readout jump between three and four
// lines: shown from RAIN_ON %, hidden again below RAIN_OFF %. `on`: whether
// it showed last time for this board and station.
const RAIN_ON = 20, RAIN_OFF = 10;
function rainLine(on, pop) {
  if (pop == null) return false;
  return pop >= (on ? RAIN_OFF : RAIN_ON);
}

// Parsed weather -> the 5-day layout's days: [{d: 'SA', icon, hi}], day
// icons (a daily code has no night), or null without forecast data. Days
// and hours from NWS (nws-forecast.js) carry their icon instead of a code.
function toDays(w) {
  if (!w.days || !w.days.length) return null;
  return w.days.map((x) => ({ d: dayName(x.time), icon: x.icon || condition(x.code, true, x.wa)[0], hi: Math.round(x.hi) }));
}

// Parsed weather -> the hourly layout's columns: [{h: '6P', icon, t}] for
// the hours 2, 4, 6 and 8 after the current one, or null without all four.
function toHours(w) {
  const out = [];
  for (const n of HOUR_STEPS) {
    const x = (w.hrs || [])[n];
    if (!x || x.temp == null || (x.icon == null && x.code == null)) return null;
    out.push({ h: hourLabel(x.time), icon: x.icon || condition(x.code, x.isDay, x.wa)[0], t: Math.round(x.temp) });
  }
  return out;
}

// Parsed weather -> the wide 7-day layout's days: [{d, icon, hi, lo}],
// today first (lo null when NWS has no night for the last day), or null
// without the whole week (NWS only; WeatherAPI's free plan has 3 days).
function toWeek(w) {
  if (!w.week || w.week.length < WEEK_DAYS) return null;
  return w.week.slice(0, WEEK_DAYS).map((x) => ({ d: dayName(x.time), icon: x.icon || condition(x.code, true, x.wa)[0],
    hi: Math.round(x.hi), lo: x.lo == null ? null : Math.round(x.lo) }));
}

// Parsed weather -> the wide 24-hour layout's slots: [{h: '3P', icon, t, p}]
// for the first eight hours after the current one that fall on a multiple of
// 3 (3P, 6P, 9P, 12A, ...); p the rain chance (%, null when missing). Null
// without all eight (NWS only: WeatherAPI's hours are cut at 9).
function toDayHours(w) {
  const out = [];
  for (const x of (w.hrs || []).slice(1)) {
    if (out.length === DAY_SLOTS) break;
    if (Number(hourOfDay.format(new Date(x.time * 1000))) % SLOT_HOURS) continue;
    if (x.temp == null || (x.icon == null && x.code == null)) return null;
    out.push({ h: hourLabel(x.time), icon: x.icon || condition(x.code, x.isDay, x.wa)[0], t: Math.round(x.temp), p: x.pop == null ? null : Math.round(x.pop) });
  }
  return out.length === DAY_SLOTS ? out : null;
}

// Test weather states for the simulator: the current conditions forced to
// one state (WMO code and cloud cover, as parse() would give them, and a
// temperature in °F that suits it). Each maps to one skyline kind and level
// (skyline.js weatherKind()) and one weather icon and word (condition()).
const TEST_WX = {
  clear: { code: 0, clouds: 5, temp: 72 },
  partly: { code: 2, clouds: 35, temp: 68 },
  mostly: { code: 2, clouds: 70, temp: 64 },
  overcast: { code: 3, clouds: 100, temp: 58 },
  fog: { code: 45, clouds: 100, temp: 50 },
  'rain light': { code: 61, clouds: 100, temp: 55, pop: 70 },
  rain: { code: 63, clouds: 100, temp: 54, pop: 90 },
  'rain heavy': { code: 65, clouds: 100, temp: 52, pop: 100 },
  ice: { code: 66, clouds: 100, temp: 31, pop: 80 },
  'snow light': { code: 71, clouds: 100, temp: 29, pop: 60 },
  snow: { code: 73, clouds: 100, temp: 27, pop: 90 },
  'snow heavy': { code: 75, clouds: 100, temp: 24, pop: 100 },
  storm: { code: 95, clouds: 100, temp: 78, pop: 90 },
};
// Parsed weather (or null) with its current conditions replaced by test
// state `kind` (null: kept) and `isDay` set. Real forecast data (days,
// hours, sun times) is kept; without real weather it's made up around the
// state, so the simulator shows every layout without a WEATHERAPI_KEY.
function testWeather(kind, base, now, isDay) {
  const s = TEST_WX[kind];
  if (!s) return base ? { ...base, isDay } : null;
  const day = (i) => ({ time: now + i * 86400, code: s.code, wa: null, hi: s.temp + [4, -2, 5, 1, -3][i - 1], lo: s.temp - [9, 12, 8, 10, 13][i - 1] });
  const b = base || {
    sunrise: now - 6 * 3600, sunset: now + 6 * 3600, windSpeed: 9, windDir: 300,
    days: [1, 2, 3, 4, 5].map(day),
    hrs: Array.from({ length: 26 }, (_, i) => ({ time: now + i * 3600, temp: s.temp + (i % 3) - 1, code: s.code, wa: null, isDay, pop: s.pop ? s.pop - (i % 4) * 10 : 0 })),
    week: [0, 1, 2, 3, 4, 5, 6].map((i) => (i ? { ...day(((i - 1) % 5) + 1), time: now + i * 86400 - 12 * 3600 } : { time: now - 12 * 3600, code: s.code, wa: null, hi: s.temp + 6, lo: s.temp - 9 })),
  };
  return {
    ...b, time: now, code: s.code, wa: null, isDay, clouds: s.clouds,
    temp: s.temp, feels: s.temp < 50 ? s.temp - 6 : s.temp, hi: s.temp + 6, lo: s.temp - 9, pop: s.pop || 10,
  };
}

// 'auto' brightness: full from sunrise to sunset, `night` overnight (the
// board's brightMin). Uses the day's times even slightly stale (a few minutes
// off at midnight is fine).
function autoBright(w, now, night = NIGHT_BRIGHT) {
  if (!w) return 100;
  return now >= w.sunrise && now < w.sunset ? 100 : night;
}

// WeatherAPI per grid cell, every 10 min while a board is asking. Without
// WEATHERAPI_KEY (and no test fetch) weather is off: get() returns null.
// raw() fetches a cell's response unparsed, for recording fixtures.
function createWeather({ key = process.env.WEATHERAPI_KEY || '', fetch = null, cells = CELLS, interval = 600, now = () => Date.now() / 1000, log = console, ...opts } = {}) {
  if (!fetch && !key) {
    log.warn('[board] WEATHERAPI_KEY not set; weather is off');
    const off = { get: async () => null, raw: async () => { throw new Error('WEATHERAPI_KEY not set'); }, start() { return off; }, stop() {}, pass() {} };
    return off;
  }
  const fetchRaw = fetch || ((lat, lon) => fetchJson(url(lat, lon, key)));
  const poller = createLocationPoller({
    name: 'weather', fetch: fetchRaw, parse, interval, maxAge: MAX_AGE, now, log,
    usable: (d) => Array.isArray(d.days) && Array.isArray(d.hrs),
    ...opts,
  });
  // Data whose conditions are over MAX_AGE old (WeatherAPI down for an
  // hour) isn't shown.
  const fresh = (d) => (d && !(now() - d.time > MAX_AGE) ? d : null);
  const w = {
    async get(lat, lon, o) {
      const p = cellPoint(lat, lon, cells);
      return fresh(await poller.get(p.lat, p.lon, o));
    },
    raw(lat, lon) {
      const p = cellPoint(lat, lon, cells);
      return fetchRaw(p.lat, p.lon);
    },
    start() { poller.start(); return w; },
    stop() { poller.stop(); },
    pass() { poller.pass(); },
  };
  return w;
}

module.exports = { url, parse, rainLine, RAIN_ON, RAIN_OFF, cellPoint, stationCells, WMO_OF, WA_FOG, THUNDERSNOW, MAX_AGE, inUnit, condition, toWx, toScreenWx, toDays, toHours, toWeek, toDayHours, testWeather, TEST_WX, dayName, windText, compass, autoBright, createWeather, NIGHT_BRIGHT, POP_HOURS, FORECAST_DAYS, HOUR_STEPS, WEEK_DAYS, DAY_SLOTS };
