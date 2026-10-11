'use strict';
// NWS forecasts for the board's location (its station): the weather screen's
// 5-day and hourly layouts, today's high/low, and the rain chance. Open-Meteo
// (weather.js) still gives current conditions, the rain bars, snow mode, and
// sunrise/sunset; withForecast() lays these fields over its data.
//
// NWS forecasts are edited by forecasters, and each period's icon goes with
// its rain chance, where Open-Meteo's daily code is the worst hour of one
// model run. Icons are used as NWS sends them (no rain-chance threshold).
// Contract "Weather row"; fixtures: fixtures/nws-forecast/.

const { createLocationPoller, fetchJson } = require('./location-poller');
const { POP_HOURS, FORECAST_DAYS, HOUR_STEPS } = require('./weather');

const HOURS = HOUR_STEPS[HOUR_STEPS.length - 1] + 1;
const GEO = { headers: { Accept: 'application/geo+json' } };
const pointsUrl = (lat, lon) => `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
const secs = (iso) => Date.parse(iso) / 1000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Chicago calendar date of an epoch time, as YYYY-MM-DD.
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
const dateOf = (t) => dateFmt.format(new Date(t * 1000));

// NWS icon code -> board icon. A split icon ("rain_showers,20/wind_bkn",
// the period's first and second half) uses its first half.
const NWS_ICONS = {
  skc: 'clear', few: 'clear', wind_skc: 'clear', wind_few: 'clear', hot: 'clear', cold: 'clear',
  sct: 'pcloudy', bkn: 'pcloudy', wind_sct: 'pcloudy', wind_bkn: 'pcloudy',
  ovc: 'cloudy', wind_ovc: 'cloudy',
  rain: 'rain', rain_showers: 'rain', rain_showers_hi: 'rain',
  snow: 'snow', rain_snow: 'snow', snow_sleet: 'snow', blizzard: 'snow',
  sleet: 'ice', fzra: 'ice', rain_fzra: 'ice', snow_fzra: 'ice', rain_sleet: 'ice',
  tsra: 'storm', tsra_sct: 'storm', tsra_hi: 'storm', tornado: 'storm', hurricane: 'storm', tropical_storm: 'storm',
  fog: 'fog', haze: 'fog', smoke: 'fog', dust: 'fog',
};

// ".../icons/land/night/rain_showers,40/rain_showers,70?size=medium" ->
// { icon: 'rain', isDay: false }. Unknown codes are 'cloudy'.
function iconFor(url) {
  const m = /\/icons\/land\/(day|night)\/([a-z_]+)/.exec(String(url || ''));
  if (!m) return { icon: 'cloudy', isDay: true };
  const isDay = m[1] === 'day';
  const kind = NWS_ICONS[m[2]] || 'cloudy';
  if (kind === 'clear') return { icon: isDay ? 'sun' : 'moon', isDay };
  if (kind === 'pcloudy') return { icon: isDay ? 'pcloudy_day' : 'pcloudy_night', isDay };
  return { icon: kind, isDay };
}

// One forecast period -> {s, e, day, t, pop, icon, isDay}.
function period(p) {
  const { icon, isDay } = iconFor(p.icon);
  return {
    s: secs(p.startTime), e: secs(p.endTime), day: p.isDaytime === true,
    t: num(p.temperature), pop: num(p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value),
    icon, isDay,
  };
}

const periodsOf = (json, what) => {
  const ps = json && json.properties && json.properties.periods;
  if (!Array.isArray(ps) || !ps.length) throw new Error(`not an NWS ${what} forecast`);
  return ps.map(period).filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e));
};

// Raw {forecast, hourly} -> {periods, hours}: the 12-hour periods and the
// hourly ones.
function parse(raw) {
  return { periods: periodsOf(raw && raw.forecast, '12-hour'), hours: periodsOf(raw && raw.hourly, 'hourly') };
}

// Parsed Open-Meteo weather + parsed NWS forecast at `now` -> the weather
// with NWS's hourly slots, rain chance, days, and today's high/low. Each
// field keeps Open-Meteo's value when NWS has nothing for it (no data, or
// the data has aged past it): today's high once the day period is over
// (NWS drops "This Afternoon" in the evening), for one.
function withForecast(w, f, now) {
  if (!w || !f) return w;
  const out = { ...w };
  // Hours from the current one on.
  const hrs = (f.hours || []).filter((h) => h.e > now);
  if (hrs.length >= HOURS && hrs.slice(0, HOURS).every((h) => h.t != null)) {
    out.hrs = hrs.map((h) => ({ time: h.s, temp: h.t, icon: h.icon, isDay: h.isDay }));
  }
  const pops = hrs.slice(0, POP_HOURS).map((h) => h.pop).filter((x) => x != null);
  if (pops.length) out.pop = Math.max(...pops);
  const today = dateOf(now);
  const ps = (f.periods || []).filter((p) => p.e > now);
  const dayToday = ps.find((p) => p.day && dateOf(p.s) === today);
  const nightToday = ps.find((p) => !p.day && dateOf(p.s) === today);
  if (dayToday && dayToday.t != null) out.hi = dayToday.t;
  if (nightToday && nightToday.t != null) out.lo = nightToday.t;
  const days = [];
  for (let i = 0; i < ps.length && days.length < FORECAST_DAYS; i++) {
    const p = ps[i];
    if (!p.day || dateOf(p.s) <= today || p.t == null) continue;
    const night = ps[i + 1] && !ps[i + 1].day ? ps[i + 1].t : null;
    days.push({ time: p.s, icon: p.icon, hi: p.t, lo: night });
  }
  if (days.length) out.days = days;
  return out;
}

// Points lookup (once per location), then the 12-hour and hourly forecasts.
function createFetch(get = fetchJson) {
  const grid = new Map(); // "lat,lon" -> { forecast, hourly } URLs
  return async (lat, lon) => {
    const k = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (!grid.has(k)) {
      const p = (await get(pointsUrl(lat, lon), GEO)).properties || {};
      if (!p.forecast || !p.forecastHourly) throw new Error('NWS points: no forecast URLs');
      grid.set(k, { forecast: p.forecast, hourly: p.forecastHourly });
    }
    const g = grid.get(k);
    const [forecast, hourly] = await Promise.all([get(g.forecast, GEO), get(g.hourly, GEO)]);
    return { forecast, hourly };
  };
}

// Every 15 min per location while a board is asking (NWS updates its grids
// about hourly). Saved data is kept up to 12 hours: withForecast() skips
// periods that have passed.
function createNwsForecast({ fetch = createFetch(), interval = 900, ...opts } = {}) {
  return createLocationPoller({ name: 'nws-forecast', fetch, parse, interval, maxAge: 12 * 3600, ...opts });
}

module.exports = { pointsUrl, iconFor, parse, withForecast, createFetch, createNwsForecast, NWS_ICONS };
