'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { iconFor, parse, withForecast, createFetch, pointsUrl } = require('./nws-forecast');
const { toDays, toHours, toScreenWx } = require('./weather');

const fx = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nws-forecast', f), 'utf8'));
const FORECAST = fx('morse-2026-10-11-1406-forecast.json');
const HOURLY = fx('morse-2026-10-11-1404-hourly.json');
const POINTS = fx('morse-points.json');
const F = parse({ forecast: FORECAST, hourly: HOURLY });
const at = (iso) => Date.parse(iso) / 1000;
const NOW = at('2026-10-11T14:10:00-05:00'); // Sunday afternoon

// Open-Meteo stand-in: only the fields withForecast() replaces, with values
// NWS doesn't have, so a test can tell which source a field came from.
const OM = {
  temp: 70, code: 0, isDay: true, hi: 99, lo: 11, pop: 77,
  days: [{ time: 0, code: 61, hi: 50, lo: 40 }],
  hrs: Array.from({ length: 13 }, (_, i) => ({ time: NOW + i * 3600, temp: 1, code: 61, isDay: true })),
};

test('iconFor: NWS icon codes, day and night, split icons use the first half', () => {
  assert.deepStrictEqual(iconFor('https://api.weather.gov/icons/land/day/skc?size=medium'), { icon: 'sun', isDay: true });
  assert.deepStrictEqual(iconFor('https://api.weather.gov/icons/land/night/few?size=small'), { icon: 'moon', isDay: false });
  assert.strictEqual(iconFor('https://api.weather.gov/icons/land/day/sct?size=medium').icon, 'pcloudy_day');
  assert.strictEqual(iconFor('https://api.weather.gov/icons/land/night/wind_bkn?size=medium').icon, 'pcloudy_night');
  assert.strictEqual(iconFor('https://api.weather.gov/icons/land/day/ovc').icon, 'cloudy');
  assert.strictEqual(iconFor('https://api.weather.gov/icons/land/night/rain_showers,40/rain_showers,70?size=medium').icon, 'rain');
  assert.strictEqual(iconFor('https://api.weather.gov/icons/land/day/rain_showers,20/wind_bkn?size=medium').icon, 'rain');
  assert.strictEqual(iconFor('https://api.weather.gov/icons/land/day/tsra_hi,40').icon, 'storm');
  assert.strictEqual(iconFor('https://api.weather.gov/icons/land/day/fzra').icon, 'ice');
  assert.strictEqual(iconFor('https://api.weather.gov/icons/land/day/snow,80').icon, 'snow');
  assert.strictEqual(iconFor('https://api.weather.gov/icons/land/day/fog').icon, 'fog');
  assert.strictEqual(iconFor('https://api.weather.gov/icons/land/day/something_new').icon, 'cloudy');
  assert.strictEqual(iconFor(null).icon, 'cloudy');
});

test('parse: both forecasts from the Morse fixtures', () => {
  assert.strictEqual(F.periods.length, 14);
  assert.strictEqual(F.hours.length, 156);
  assert.deepStrictEqual(F.periods[0], { s: at('2026-10-11T14:00:00-05:00'), e: at('2026-10-11T18:00:00-05:00'), day: true, t: 71, pop: 0, icon: 'sun', isDay: true });
  assert.throws(() => parse({ forecast: FORECAST, hourly: {} }), /NWS hourly/);
  assert.throws(() => parse({ forecast: POINTS, hourly: HOURLY }), /NWS 12-hour/);
});

test('withForecast: 5 days from NWS daytime periods, their icons as sent', () => {
  const w = withForecast(OM, F, NOW);
  assert.deepStrictEqual(toDays(w), [
    { d: 'MO', icon: 'pcloudy_day', hi: 83 }, // Columbus Day, mostly sunny
    { d: 'TU', icon: 'sun', hi: 81 },
    { d: 'WE', icon: 'rain', hi: 67 },        // rain showers likely, 65%
    { d: 'TH', icon: 'rain', hi: 64 },
    { d: 'FR', icon: 'rain', hi: 58 },        // slight chance (20%) before 7am, then mostly cloudy
  ]);
});

test('withForecast: today\'s high/low and rain chance from NWS', () => {
  const w = withForecast(OM, F, NOW);
  assert.strictEqual(w.hi, 71); // This Afternoon
  assert.strictEqual(w.lo, 63); // Tonight
  assert.strictEqual(toScreenWx(w).pop, 0);
  // Current conditions stay Open-Meteo's.
  assert.strictEqual(w.temp, 70);
  assert.strictEqual(w.code, 0);
});

test('withForecast: evening, the day period is over: Open-Meteo high, NWS low', () => {
  const w = withForecast(OM, F, at('2026-10-11T19:30:00-05:00'));
  assert.strictEqual(w.hi, 99);
  assert.strictEqual(w.lo, 63);
  assert.strictEqual(toDays(w)[0].d, 'MO');
  // 7 PM-midnight Sunday: all 0%.
  assert.strictEqual(w.pop, 0);
});

test('withForecast: hourly layout from NWS hours, night icons at night', () => {
  const w = withForecast(OM, F, NOW);
  assert.deepStrictEqual(toHours(w), [
    { h: '4P', icon: 'sun', t: 71 },
    { h: '6P', icon: 'moon', t: 68 },
    { h: '8P', icon: 'moon', t: 65 },
    { h: '10P', icon: 'moon', t: 64 },
  ]);
});

test('withForecast: rain chance is the highest of the next 6 NWS hours', () => {
  // Monday 2 PM: 2-7 PM, the 7 PM hour has 6%.
  assert.strictEqual(withForecast(OM, F, at('2026-10-12T14:30:00-05:00')).pop, 6);
});

test('withForecast: no NWS data, or data that has run out, keeps Open-Meteo', () => {
  assert.strictEqual(withForecast(OM, null, NOW), OM);
  assert.strictEqual(withForecast(null, F, NOW), null);
  const late = withForecast(OM, F, at('2026-10-19T12:00:00-05:00'));
  assert.deepStrictEqual([late.hi, late.lo, late.pop, late.days, late.hrs], [OM.hi, OM.lo, OM.pop, OM.days, OM.hrs]);
});

test('createFetch: points once per location, then both forecasts', async () => {
  const asked = [];
  const urls = { [pointsUrl(42.008362, -87.665909)]: POINTS, [POINTS.properties.forecast]: FORECAST, [POINTS.properties.forecastHourly]: HOURLY };
  const fetch = createFetch(async (u) => { asked.push(u); if (!urls[u]) throw new Error(`unexpected ${u}`); return urls[u]; });
  const raw = await fetch(42.008362, -87.665909);
  assert.strictEqual(raw.forecast, FORECAST);
  assert.strictEqual(raw.hourly, HOURLY);
  await fetch(42.008362, -87.665909);
  assert.strictEqual(asked.filter((u) => u.includes('/points/')).length, 1);
  assert.strictEqual(asked.length, 5);
});
