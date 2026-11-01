'use strict';
// WeatherAPI.com current conditions for the board's location (its station's
// grid cell, below): the weather row (`wx`), the weather screen (`radar.wx`:
// adds feels-like, wind, and the next 6 hours' rain chance), and auto
// brightness from sunrise/sunset. The weather screen's 5-day and hourly
// layouts get a fallback forecast here; NWS (nws-forecast.js) lays its own
// over it. WeatherAPI has no 15-minute precipitation on our plan, so `q15`
// is always empty and the rain bars don't show (their rules stay, for a
// source that has it).
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
// Rain bars: 8 quarter hours (2 hours). 15-minute amounts are sums over the
// preceding 15 minutes.
const BARS = 8;
const SLOT_S = 900;
// Intensity scales (rate in mm/h, as water; snow is measured melted, so its
// scale tops out lower): height on a square-root scale, full at `full`, so
// drizzle stays visible but short; levels at the NWS light/moderate/heavy
// cutoffs.
const RAIN_SCALE = { full: 10, levels: [2.5, 7.6] };
const SNOW_SCALE = { full: 4, levels: [1, 2.5] };
const BAR_MAX = 10; // rows
const SNOW_CM_PER_MM = 0.7; // snowfall (cm) from water (mm)

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
    pop: maxPop(hours),
    days: forecastDays(fd),
    q15: [],
    hrs: hours.map((h) => ({ time: h.time_epoch, temp: num(h.temp_f), code: wmo(h.condition), wa: waCode(h.condition), isDay: h.is_day === 1 })),
  };
}

// 3 PM -> "3P", midnight "12A".
const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: true });
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
// untouched (radar snow mode and rain bars read the original).
const toC = (f) => (f == null ? f : (f - 32) * 5 / 9);
function inUnit(w, unit) {
  if (!w || unit !== 'C') return w;
  return {
    ...w,
    temp: toC(w.temp), hi: toC(w.hi), lo: toC(w.lo), feels: toC(w.feels),
    days: (w.days || []).map((x) => ({ ...x, hi: toC(x.hi), lo: toC(x.lo) })),
    hrs: (w.hrs || []).map((x) => ({ ...x, temp: toC(x.temp) })),
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

// Parsed weather -> the rain bars at `now`, or null when no precipitation
// is falling or due in the next 2 hours (or there's no 15-minute data):
//   {snow, now, title, h, l}
// snow: 1 when snow makes up at least half the water (the whole view is one
// kind); now: 1 when it's falling in the current quarter hour; title: what
// it's doing, uppercase; h: 8 bar heights (0 = dry, else 1-BAR_MAX); l: 8
// intensity levels (0 dry, 1-3).
function toRain(w, now) {
  const steps = (w.q15 || []).filter((x) => x.t > now).slice(0, BARS);
  if (steps.length < BARS) return null;
  const wet = steps.map((x) => x.p > 0);
  if (!wet.includes(true)) return null;
  const water = steps.reduce((a, x) => a + x.p, 0);
  const snowWater = steps.reduce((a, x) => a + x.s, 0) / SNOW_CM_PER_MM;
  const snow = snowWater * 2 >= water;
  const sc = snow ? SNOW_SCALE : RAIN_SCALE;
  const h = [], l = [];
  for (const x of steps) {
    const rate = x.p * 4;
    if (!(x.p > 0)) { h.push(0); l.push(0); continue; }
    h.push(Math.max(1, Math.round(Math.sqrt(Math.min(rate, sc.full) / sc.full) * BAR_MAX)));
    l.push(1 + (rate >= sc.levels[0] ? 1 : 0) + (rate >= sc.levels[1] ? 1 : 0));
  }
  // Minutes until step i starts, to the nearest 5 (at least 5).
  const mins = (i) => Math.max(5, Math.round((steps[i].t - SLOT_S - now) / 300) * 5);
  const kind = snow ? 'SNOW' : 'RAIN';
  let title;
  if (wet[0]) {
    const dry = wet.indexOf(false);
    if (dry < 0) title = `${kind} NEXT 2 HRS`;
    else title = `${wet.indexOf(true, dry) > 0 ? 'BREAK' : 'ENDS'} IN ${mins(dry)} MIN`;
  } else {
    title = `${kind} IN ${mins(wet.indexOf(true))} MIN`;
  }
  return { snow: snow ? 1 : 0, now: wet[0] ? 1 : 0, title, h, l };
}

// Made-up rain bars for the simulator's test controls: a kind from
// TEST_RAIN, built as 15-minute data and run through toRain() so titles and
// heights come from the real rules. Amounts are mm per 15 min for the next 8
// quarter hours (the first is the current one).
const TEST_RAIN = {
  rain: [0, 0, 0.1, 0.4, 0.9, 1.2, 0.6, 0.3],
  downpour: [0, 0.8, 2.5, 4, 3, 1.5, 0.7, 0.2],
  break: [0.6, 0.4, 0, 0, 0.5, 1, 0.8, 0.5],
  ends: [1.2, 0.9, 0.5, 0.2, 0, 0, 0, 0],
  continues: [0.5, 0.7, 1, 1.4, 1.2, 0.9, 0.7, 0.5],
  snow: [0, 0, 0.05, 0.2, 0.35, 0.5, 0.4, 0.2],
  'snow now': [0.2, 0.3, 0.5, 0.7, 0.6, 0.45, 0.3, 0.2],
};
function testRain(kind, now) {
  const mm = TEST_RAIN[kind];
  if (!mm) return null;
  const snow = kind.startsWith('snow');
  const b0 = Math.floor(now / SLOT_S) * SLOT_S;
  const q15 = [{ t: b0, p: 0, s: 0 }, ...mm.map((p, i) => ({ t: b0 + (i + 1) * SLOT_S, p, s: snow ? p * SNOW_CM_PER_MM : 0 }))];
  return toRain({ q15 }, now);
}

// 'auto' brightness: `day` from sunrise to sunset, `night` overnight (the
// board's brightMax and brightMin). Uses the day's times even slightly stale
// (a few minutes off at midnight is fine).
function autoBright(w, now, night = NIGHT_BRIGHT, day = 100) {
  if (!w) return day;
  return now >= w.sunrise && now < w.sunset ? day : Math.min(night, day);
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
    usable: (d) => Array.isArray(d.days) && Array.isArray(d.q15) && Array.isArray(d.hrs),
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

module.exports = { url, parse, cellPoint, stationCells, WMO_OF, WA_FOG, THUNDERSNOW, MAX_AGE, inUnit, condition, toWx, toScreenWx, toDays, toHours, toRain, testRain, TEST_RAIN, dayName, windText, compass, autoBright, createWeather, NIGHT_BRIGHT, POP_HOURS, FORECAST_DAYS, HOUR_STEPS, BARS, BAR_MAX };
