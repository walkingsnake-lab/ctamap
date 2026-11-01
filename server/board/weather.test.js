'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { url, parse, cellPoint, stationCells, WMO_OF, WA_FOG, MAX_AGE, inUnit, condition, toWx, toScreenWx, toDays, toHours, toRain, dayName, windText, compass, autoBright, createWeather, NIGHT_BRIGHT, POP_HOURS } = require('./weather');
const { measure } = require('./fonts');
const { ICONS } = require('./icons');
const { createNws } = require('./nws');
const { modeFor } = require('./radar');

// WeatherAPI forecast.json for Morse's grid cell, Sunday Oct 4 2026 10:45 CDT
// (see fixtures/README.md: assembled, not recorded).
const MORSE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weatherapi', 'morse-cell-2026-10-04-1045.json'), 'utf8'));
const quiet = { warn() {}, error() {} };
const clone = (x) => JSON.parse(JSON.stringify(x));
// Morse's coordinates, and the cell key the poller stores them under.
const MORSE_AT = [42.008362, -87.665909];
const cellKeyOf = (lat, lon) => { const p = cellPoint(lat, lon); return `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`; };

test('Morse, Sunday morning: clear and 63°', () => {
  const w = parse(MORSE);
  assert.equal(w.code, 0); // WeatherAPI 1000, as WMO
  assert.equal(w.isDay, true);
  assert.equal(w.time, MORSE.current.last_updated_epoch);
  assert.deepEqual(toWx(w), { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51 });
  assert.deepEqual(w.q15, []); // no 15-minute data from WeatherAPI
  assert.throws(() => parse({}), /WeatherAPI/);
  assert.throws(() => parse({ current: MORSE.current, forecast: { forecastday: [] } }), /WeatherAPI/);
});

test('WMO codes map to the board icons, with night variants', () => {
  const cases = [
    [0, 1, 'sun', 'SUNNY'], [0, 0, 'moon', 'CLEAR'], [1, 1, 'sun', 'SUNNY'], [1, 0, 'moon', 'CLEAR'],
    [2, 1, 'pcloudy_day', 'PT CLOUDY'], [2, 0, 'pcloudy_night', 'PT CLOUDY'], [3, 1, 'cloudy', 'CLOUDY'],
    [45, 1, 'fog', 'FOG'], [48, 0, 'fog', 'FOG'],
    [51, 1, 'rain', 'RAIN'], [55, 1, 'rain', 'RAIN'], [61, 1, 'rain', 'RAIN'], [65, 1, 'rain', 'RAIN'], [80, 1, 'rain', 'RAIN'], [82, 0, 'rain', 'RAIN'],
    [56, 1, 'ice', 'FRZ RAIN'], [57, 1, 'ice', 'FRZ RAIN'], [66, 1, 'ice', 'FRZ RAIN'], [67, 1, 'ice', 'FRZ RAIN'],
    [71, 1, 'snow', 'SNOW'], [75, 1, 'snow', 'SNOW'], [77, 1, 'snow', 'SNOW'], [85, 1, 'snow', 'SNOW'], [86, 1, 'snow', 'SNOW'],
    [95, 1, 'storm', 'STORMS'], [96, 1, 'storm', 'STORMS'], [99, 0, 'storm', 'STORMS'],
  ];
  for (const [code, day, icon, word] of cases) assert.deepEqual(condition(code, !!day), [icon, word], `code ${code} day ${day}`);
  for (const [, , icon] of cases) assert.ok(ICONS[icon], `icon ${icon} exists`);
});

test('WeatherAPI codes: all 60 translate to WMO codes the icons know', () => {
  assert.equal(Object.keys(WMO_OF).length, 60);
  const known = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
  for (const [wa, w] of Object.entries(WMO_OF)) assert.ok(known.has(w), `${wa} -> ${w}`);
  // Spot checks through parse(): icon and word for the current condition.
  const at = (code, isDay = 1) => { const j = clone(MORSE); j.current.condition.code = code; j.current.is_day = isDay; return toWx(parse(j)); };
  const cases = [
    [1000, 1, 'sun', 'SUNNY'], [1000, 0, 'moon', 'CLEAR'], [1003, 0, 'pcloudy_night', 'PT CLOUDY'], [1009, 1, 'cloudy', 'CLOUDY'],
    [1030, 1, 'fog', 'FOG'], [1135, 1, 'fog', 'FOG'], [1147, 1, 'fog', 'FOG'],
    [1063, 1, 'rain', 'RAIN'], [1153, 1, 'rain', 'RAIN'], [1195, 1, 'rain', 'RAIN'], [1246, 1, 'rain', 'RAIN'],
    [1072, 1, 'ice', 'FRZ RAIN'], [1201, 1, 'ice', 'FRZ RAIN'], [1204, 1, 'ice', 'FRZ RAIN'], [1237, 1, 'ice', 'FRZ RAIN'],
    [1066, 1, 'snow', 'SNOW'], [1117, 1, 'snow', 'SNOW'], [1225, 1, 'snow', 'SNOW'], [1258, 1, 'snow', 'SNOW'],
    [1087, 1, 'storm', 'STORMS'], [1276, 1, 'storm', 'STORMS'],
    [9999, 1, 'cloudy', 'CLOUDY'], // unknown: neutral
  ];
  for (const [code, day, icon, word] of cases) {
    const wx = at(code, day);
    assert.deepEqual([wx.icon, wx.word], [icon, word], `code ${code}`);
  }
});

test('haze, smoke, dust and smog: the fog icon with their own word; thundersnow: its own icon', () => {
  const at = (code, isDay = 1) => { const j = clone(MORSE); j.current.condition.code = code; j.current.is_day = isDay; return toWx(parse(j)); };
  const words = { 1012: 'HAZE', 1015: 'DUST', 1018: 'DUST', 1021: 'DUST', 1024: 'DUST', 1027: 'DUST', 1033: 'SMOKE', 1036: 'SMOKE', 1039: 'SMOG', 1042: 'SMOG', 1045: 'DUST', 1048: 'DUST' };
  assert.deepEqual(WA_FOG, words);
  for (const [code, word] of Object.entries(words)) for (const day of [1, 0]) {
    const wx = at(Number(code), day);
    assert.deepEqual([wx.icon, wx.word], ['fog', word], `code ${code}`);
  }
  for (const code of [1279, 1282]) assert.deepEqual([at(code).icon, at(code).word], ['tsnow', 'THNDRSNOW']);
  assert.ok(ICONS.tsnow);
  // Hours and days carry the same refinement.
  const j = clone(MORSE);
  j.forecast.forecastday[0].hour[12].condition.code = 1282; // 12 PM: the first hourly column
  j.forecast.forecastday[1].day.condition.code = 1033;
  const w = parse(j);
  assert.equal(toHours(w)[0].icon, 'tsnow');
  assert.equal(toDays(w)[0].icon, 'fog');
  // Without WeatherAPI's code (NWS data, or the tests' bare objects), WMO alone.
  assert.deepEqual(condition(95, true), ['storm', 'STORMS']);
  assert.deepEqual(condition(45, true), ['fog', 'FOG']);
});

test('radar snow mode reads the translated codes', () => {
  const w = (code, temp_f) => { const j = clone(MORSE); j.current.condition.code = code; j.current.temp_f = temp_f; return parse(j); };
  assert.equal(modeFor(w(1225, 34)), 'snow');  // heavy snow, above freezing
  assert.equal(modeFor(w(1255, 34)), 'snow');  // snow showers
  assert.equal(modeFor(w(1006, 30)), 'snow');  // cloudy and freezing
  assert.equal(modeFor(w(1201, 30)), 'rain');  // freezing rain stays rain
  assert.equal(modeFor(w(1207, 30)), 'rain');  // sleet too
  assert.equal(modeFor(w(1183, 40)), 'rain');
  assert.equal(modeFor(w(1279, 34)), 'snow');  // thundersnow, above freezing
  assert.equal(modeFor(w(1276, 34)), 'rain');  // a plain thunderstorm
});

test('every condition word fits next to the widest temperature', () => {
  // Temperature starts at x=10; leave 3px before the right-aligned word.
  const room = 63 - (10 + measure('small', '-10°') + 3) + 1;
  for (const code of [0, 2, 3, 45, 61, 66, 71, 95]) for (const day of [true, false]) {
    const [, word] = condition(code, day);
    assert.ok(measure('small', word) <= room, `${word} is ${measure('small', word)}px, room ${room}`);
  }
  for (const wa of [...Object.keys(WA_FOG).map(Number), 1279]) {
    const [, word] = condition(45, true, wa);
    assert.ok(measure('small', word) <= room, `${word} is ${measure('small', word)}px, room ${room}`);
  }
});

test('auto brightness: full from sunrise to sunset, dimmer overnight', () => {
  const w = parse(MORSE);
  assert.equal(w.sunrise, Date.UTC(2026, 9, 4, 11, 51) / 1000); // "06:51 AM" CDT
  assert.equal(w.sunset, Date.UTC(2026, 9, 4, 23, 26) / 1000);  // "06:26 PM" CDT
  assert.equal(autoBright(w, w.time), 100);
  assert.equal(autoBright(w, w.sunrise - 1), NIGHT_BRIGHT);
  assert.equal(autoBright(w, w.sunrise), 100);
  assert.equal(autoBright(w, w.sunset), NIGHT_BRIGHT);
  assert.equal(autoBright(null, w.time), 100); // no data yet
});

test('sunrise and sunset clock times: 12 AM/PM, CST, and missing values', () => {
  const at = (date, sunrise, sunset) => { const j = clone(MORSE); j.forecast.forecastday[0].date = date; j.forecast.forecastday[0].astro = { sunrise, sunset }; return parse(j); };
  const w = at('2026-12-21', '07:15 AM', '04:22 PM');
  assert.equal(w.sunrise, Date.UTC(2026, 11, 21, 13, 15) / 1000); // CST, -6 h
  assert.equal(w.sunset, Date.UTC(2026, 11, 21, 22, 22) / 1000);
  assert.equal(at('2026-10-04', '12:05 AM', '12:30 PM').sunrise, Date.UTC(2026, 9, 4, 5, 5) / 1000);
  assert.equal(at('2026-10-04', '12:05 AM', '12:30 PM').sunset, Date.UTC(2026, 9, 4, 17, 30) / 1000);
  const none = at('2026-10-04', 'No sunrise', undefined);
  assert.equal(none.sunrise, null);
  assert.equal(none.sunset, null);
});

test('request URL: forecast.json for the point, 3 days, no air quality or alerts', () => {
  const u = new URL(url(41.987272, -87.681926, 'k3y'));
  assert.equal(u.origin + u.pathname, 'https://api.weatherapi.com/v1/forecast.json');
  assert.equal(u.searchParams.get('key'), 'k3y');
  assert.equal(u.searchParams.get('q'), '41.9873,-87.6819');
  assert.equal(u.searchParams.get('days'), '3');
  assert.equal(u.searchParams.get('aqi'), 'no');
  assert.equal(u.searchParams.get('alerts'), 'no');
});

test('grid cells: stations share a fetch per 0.1° cell, at their mean position', () => {
  const stations = require('./stations.json');
  const cells = stationCells(stations);
  assert.equal(cells.size, 10);
  // Morse and Loyola are in the same cell; the Loop is in another.
  const morse = cellPoint(...MORSE_AT);
  assert.deepEqual(cellPoint(42.001073, -87.661061), morse); // Loyola
  assert.notDeepEqual(cellPoint(41.885737, -87.630886), morse); // Clark/Lake
  // Every cell point is the mean of its stations, so it's on land near them.
  const inCell = stations.filter((s) => Math.round(s.lat / 0.1) === 420 && Math.round(s.lon / 0.1) === -877);
  assert.ok(Math.abs(morse.lat - inCell.reduce((a, s) => a + s.lat, 0) / inCell.length) < 1e-9);
  // A point with no station in its cell: the cell center.
  assert.deepEqual(cellPoint(40.11, -88.24), { lat: 40.1, lon: -88.2 });
});

test('weather screen: feels-like, wind, and the next 6 hours\' highest rain or snow chance', () => {
  assert.deepEqual(toScreenWx(parse(MORSE)), { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51, feels: 63, wind: 'NW 9', pop: 10 });
  // Snow chance counts too; only the first POP_HOURS slots from the current hour.
  const j = clone(MORSE);
  const today = j.forecast.forecastday[0].hour;
  today[11].chance_of_snow = 35; // 11 AM, inside the window
  today[16].chance_of_rain = 90; // 4 PM, the 7th slot: outside
  assert.equal(POP_HOURS, 6);
  assert.equal(parse(j).pop, 35);
  // Missing fields: null, and the weather row keeps its shape.
  const bare = clone(MORSE);
  delete bare.current.feelslike_f; delete bare.current.wind_mph;
  for (const d of bare.forecast.forecastday) for (const h of d.hour) { delete h.chance_of_rain; delete h.chance_of_snow; }
  assert.deepEqual(toScreenWx(parse(bare)), { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51, feels: null, wind: null, pop: null });
});

test('5-day fallback: the days after today (the free plan sends 3 in all), weekday names, day icons', () => {
  const w = parse(MORSE);
  assert.equal(w.hi, 68.9); // today stays index 0
  assert.deepEqual(toDays(w), [{ d: 'MO', icon: 'rain', hi: 71 }, { d: 'TU', icon: 'pcloudy_day', hi: 66 }]);
  // A gap ends the list.
  const gap = clone(MORSE);
  delete gap.forecast.forecastday[1].day.maxtemp_f;
  assert.deepEqual(parse(gap).days, []);
  // Today only: no days, no 5-day layout from here (NWS may still send one).
  const one = clone(MORSE);
  one.forecast.forecastday = one.forecast.forecastday.slice(0, 1);
  assert.equal(toDays(parse(one)), null);
  // WeatherAPI's date_epoch (UTC midnight) names the right day.
  assert.equal(dayName(Date.UTC(2026, 9, 5) / 1000), 'MO');
  // Weekday at a local midnight, across both DST changes.
  assert.equal(dayName(Date.UTC(2026, 10, 1, 5) / 1000), 'SU'); // CDT midnight, the day DST ends
  assert.equal(dayName(Date.UTC(2026, 10, 2, 6) / 1000), 'MO'); // CST midnight
  assert.equal(dayName(Date.UTC(2027, 2, 14, 6) / 1000), 'SU'); // CST midnight, the day DST starts
});

test('hourly fallback: hours 2, 4, 6 and 8 after the current hour, labels, day and night icons', () => {
  // 10:46 AM response: slots start with the 10 AM hour.
  const w = parse(MORSE);
  assert.equal(w.hrs.length, 9);
  assert.equal(w.hrs[0].time, Date.UTC(2026, 9, 4, 15) / 1000);
  assert.deepEqual(toHours(w), [
    { h: '12P', icon: 'sun', t: 67 },
    { h: '2P', icon: 'sun', t: 69 },
    { h: '4P', icon: 'sun', t: 68 },
    { h: '6P', icon: 'sun', t: 65 },
  ]);
  // Evening: the slots run past midnight into tomorrow, with night icons.
  const eve = clone(MORSE);
  eve.location.localtime_epoch = Date.UTC(2026, 9, 5, 1, 10) / 1000; // 8:10 PM
  assert.deepEqual(toHours(parse(eve)).map((x) => [x.h, x.icon]), [['10P', 'moon'], ['12A', 'moon'], ['2A', 'moon'], ['4A', 'moon']]);
  // Late on the last day: too few hours left.
  const late = clone(MORSE);
  late.location.localtime_epoch = Date.UTC(2026, 9, 7, 2) / 1000; // 9 PM Tuesday
  assert.equal(toHours(parse(late)), null);
});

test('rain bars: none from WeatherAPI (no 15-minute data)', () => {
  assert.equal(toRain(parse(MORSE), MORSE.current.last_updated_epoch), null);
});

// 15-minute data, for a source that has it: amounts are sums over the 15
// minutes before each time. `now` sits 5 min into a quarter hour.
const T0 = 1791129600; // a quarter-hour boundary
const NOW = T0 + 300;
function q15(precip, snow = []) {
  const steps = [];
  // One step already past (ends before now), then the next 11.
  for (let i = 0; i < 12; i++) steps.push({ t: T0 + i * 900, p: i === 0 ? 9 : precip[i - 1] || 0, s: i === 0 ? 0 : snow[i - 1] || 0 });
  return { ...parse(MORSE), q15: steps };
}

test('rain bars: heights on a square-root scale, three levels, the past step skipped', () => {
  // mm per 15 min -> mm/h x4: 0, 0.4, 2.4, 4, 10, 40, 1, 0.
  const r = toRain(q15([0, 0.1, 0.6, 1, 2.5, 10, 0.25, 0]), NOW);
  assert.deepEqual(r.h, [0, 2, 5, 6, 10, 10, 3, 0]);
  assert.deepEqual(r.l, [0, 1, 1, 2, 3, 3, 1, 0]);
  assert.equal(r.snow, 0);
  assert.equal(r.now, 0);
  assert.equal(r.title, 'RAIN IN 10 MIN'); // the 2nd bar starts 10 min from now
});

test('rain bars: titles for rain due, falling through, ending, and a break', () => {
  const title = (p, now = NOW) => toRain(q15(p), now).title;
  assert.equal(title([0, 0, 0, 0, 0, 0, 0, 1]), 'RAIN IN 100 MIN');
  assert.equal(title([0, 0, 1, 1, 0, 0, 0, 0]), 'RAIN IN 25 MIN');
  assert.equal(title([0, 1]), 'RAIN IN 10 MIN');
  assert.equal(title([1, 1, 1, 1, 1, 1, 1, 1]), 'RAIN NEXT 2 HRS');
  assert.equal(title([1, 1, 1, 1, 0, 0, 0, 0]), 'ENDS IN 55 MIN');
  assert.equal(title([1, 1, 0, 0, 1, 1, 1, 1]), 'BREAK IN 25 MIN');
  assert.equal(title([1, 0, 0, 0, 0, 0, 0, 0]), 'ENDS IN 10 MIN');
  // Rounded to 5 minutes, at least 5.
  assert.equal(title([0, 1], T0 + 899), 'RAIN IN 5 MIN');
  assert.equal(title([0, 1], T0 + 420), 'RAIN IN 10 MIN'); // 8 min -> 10
  assert.equal(toRain(q15([1]), NOW).now, 1);
  assert.equal(toRain(q15([0, 0, 0, 0, 0, 0, 0, 0]), NOW), null); // dry
  assert.equal(toRain(q15([0, 0, 0, 0, 0, 0, 0, 0]), T0 + 3 * 900 + 1), null); // too few steps ahead
});

test('rain bars: snow when it makes up half the water or more, on its own scale', () => {
  // 0.5 mm water as 0.35 cm of snow per step (0.7 cm/mm).
  const r = toRain(q15([0.5, 0.5, 0.25, 0, 0, 0, 0, 0], [0.35, 0.35, 0.175]), NOW);
  assert.equal(r.snow, 1);
  assert.equal(r.title, 'ENDS IN 40 MIN');
  assert.deepEqual(r.h, [7, 7, 5, 0, 0, 0, 0, 0]); // 2 mm/h of a 4 mm/h scale
  assert.deepEqual(r.l, [2, 2, 2, 0, 0, 0, 0, 0]); // 1 mm/h is the snow scale's first cutoff
  assert.equal(toRain(q15([0, 1, 1], [0, 0.7]), NOW).title, 'SNOW IN 10 MIN'); // exactly half
  assert.equal(toRain(q15([0, 1, 1], [0, 0.6]), NOW).title, 'RAIN IN 10 MIN');
});

test('rain bars: every title fits the panel without its mark', () => {
  const { measure: m } = require('./fonts');
  for (const t of ['BREAK IN 105 MIN', 'ENDS IN 105 MIN', 'RAIN IN 105 MIN', 'SNOW NEXT 2 HRS', 'RAIN NEXT 2 HRS']) assert.ok(m('small', t) <= 64, t);
});

test('hour labels: midnight is 12A', () => {
  const hrs = Array(9).fill(0);
  for (const i of [2, 4, 6, 8]) hrs[i] = { time: Date.UTC(2026, 9, 5, 5) / 1000, temp: 50, code: 0, isDay: 1 };
  assert.equal(toHours({ hrs })[0].h, '12A');
});

test('wind: 8-point compass, CALM under 1 mph', () => {
  assert.equal(compass(0), 'N'); assert.equal(compass(22), 'N'); assert.equal(compass(23), 'NE');
  assert.equal(compass(180), 'S'); assert.equal(compass(337), 'NW'); assert.equal(compass(338), 'N'); assert.equal(compass(360), 'N');
  assert.equal(windText(0.4, 90), 'CALM');
  assert.equal(windText(5.5, 90), 'E 6');
  assert.equal(windText(5, null), '5');
  assert.equal(windText(null, 90), null);
});

test('no WEATHERAPI_KEY: weather is off, with one warning', async () => {
  const warned = [];
  const wx = createWeather({ key: '', log: { warn: (m) => warned.push(m), error() {} } });
  assert.equal(wx.start(), wx);
  assert.equal(await wx.get(...MORSE_AT), null);
  await assert.rejects(wx.raw(...MORSE_AT), /WEATHERAPI_KEY/);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /WEATHERAPI_KEY not set/);
});

test('cache: one fetch per cell per interval, shared by its stations; last good data kept on failure', async () => {
  let t = 1000, fail = false;
  const asked = [];
  const wx = createWeather({ fetch: async (lat, lon) => { asked.push([lat, lon]); if (fail) throw new Error('down'); return MORSE; }, now: () => t, log: quiet });
  assert.equal((await wx.get(...MORSE_AT)).temp, 63.3);
  assert.deepEqual(asked[0], [cellPoint(...MORSE_AT).lat, cellPoint(...MORSE_AT).lon]); // fetched at the cell point
  await wx.get(42.001073, -87.661061); // Loyola: same cell, no new fetch
  assert.equal(asked.length, 1);
  await wx.get(41.885737, -87.630886); // Clark/Lake: another cell
  assert.equal(asked.length, 2);
  t += 601; fail = true;
  await wx.get(...MORSE_AT); // a board is still asking
  wx.pass();
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 3);
  assert.equal((await wx.get(...MORSE_AT)).temp, 63.3);
  // Nobody asking for 5+ minutes: polling stops.
  t += 900;
  wx.pass();
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 3);
  // raw(): the cell's response, unparsed.
  fail = false;
  assert.equal((await wx.raw(...MORSE_AT)).current.temp_f, 63.3);
});

test('cache: conditions over an hour old aren\'t shown (WeatherAPI\'s caching limit)', async () => {
  const at = MORSE.current.last_updated_epoch;
  let t = at + 60, fail = false;
  const wx = createWeather({ fetch: async () => { if (fail) throw new Error('down'); return MORSE; }, now: () => t, log: quiet });
  assert.equal(MAX_AGE, 3600);
  assert.ok(await wx.get(...MORSE_AT));
  fail = true;
  t = at + MAX_AGE;
  assert.ok(await wx.get(...MORSE_AT, { wait: 0 })); // exactly an hour: still shown
  t = at + MAX_AGE + 1;
  assert.equal(await wx.get(...MORSE_AT, { wait: 0 }), null);
});

test('cache: failures back off instead of retrying every pass', async () => {
  let t = 1000, calls = 0;
  const nws = createNws({ fetch: async () => { calls++; throw new Error('down'); }, now: () => t, log: quiet });
  assert.equal(await nws.get(42.0084, -87.6659), null);
  assert.equal(calls, 1);
  const tick = async (s) => { t += s; await nws.get(42.0084, -87.6659, { wait: 0 }); nws.pass(); await new Promise((r) => setImmediate(r)); };
  await tick(15); // inside the 30 s backoff
  assert.equal(calls, 1);
  await tick(15);
  assert.equal(calls, 2);
  for (let i = 0; i < 3; i++) await tick(15); // 45 s: inside the 60 s backoff
  assert.equal(calls, 2);
  await tick(15);
  assert.equal(calls, 3);
  for (let i = 0; i < 7; i++) await tick(15); // 105 s: inside the 120 s backoff
  assert.equal(calls, 3);
  await tick(15);
  assert.equal(calls, 4);
});

test('cache: a first weather fetch that fails is retried in 30 s, not the 10-minute interval', async () => {
  let t = 1000, calls = 0, fail = true;
  const wx = createWeather({ fetch: async () => { calls++; if (fail) throw new Error('down'); return MORSE; }, now: () => t, log: quiet });
  assert.equal(await wx.get(...MORSE_AT), null);
  fail = false;
  t += 30;
  assert.equal((await wx.get(...MORSE_AT)).temp, 63.3);
  assert.equal(calls, 2);
});

test('cache file: saved data without the forecast fields is fetched fresh', async () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wx-'));
  const cacheFile = path.join(dir, 'board-weather.json');
  const t = 2000;
  const p = cellPoint(...MORSE_AT);
  const old = { ...parse(MORSE) }; delete old.hrs;
  fs.writeFileSync(cacheFile, JSON.stringify({ [cellKeyOf(...MORSE_AT)]: { lat: p.lat, lon: p.lon, data: old, fetchedAt: t - 60 } }));
  let calls = 0;
  const wx = createWeather({ fetch: async () => { calls++; return MORSE; }, now: () => t, log: quiet, cacheFile });
  assert.equal((await wx.get(...MORSE_AT)).hrs.length, 9);
  assert.equal(calls, 1);
  // Current data is used as saved.
  const wx2 = createWeather({ fetch: async () => { calls++; return MORSE; }, now: () => t, log: quiet, cacheFile });
  await wx2.get(...MORSE_AT);
  assert.equal(calls, 1);
});

test('cache file: a restart starts from the last good weather, until it is an hour old', async () => {
  const file = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'board-wx-')), 'board-weather.json');
  let t = 1000, calls = 0;
  const make = (fetch) => createWeather({ fetch: async () => { calls++; return fetch(); }, now: () => t, log: quiet, cacheFile: file });
  await make(() => MORSE).get(...MORSE_AT);
  assert.ok(fs.existsSync(file));
  // Restart with WeatherAPI down: the saved data is there right away.
  t += 1800;
  const down = make(() => { throw new Error('down'); });
  calls = 0;
  assert.equal((await down.get(...MORSE_AT, { wait: 1e6 })).temp, 63.3);
  assert.equal(calls, 0, 'no wait for a fetch');
  down.pass();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1, 'refreshed on the next pass');
  // Saved locations nobody asks for aren't polled.
  const idle = make(() => MORSE);
  calls = 0;
  idle.pass();
  assert.equal(calls, 0);
  // Too old to keep (saved over an hour ago).
  t += 1801;
  assert.equal(await make(() => { throw new Error('down'); }).get(...MORSE_AT, { wait: 0 }), null);
  // A bad file is ignored.
  fs.writeFileSync(file, '{not json');
  assert.equal(await make(() => { throw new Error('down'); }).get(...MORSE_AT, { wait: 0 }), null);
});

test('tempUnit C: every displayed temperature converted; F untouched', () => {
  const w = { temp: 63.4, hi: 69, lo: 51, feels: null, code: 0, isDay: true, days: [{ time: 1, code: 0, hi: 32, lo: -4 }], hrs: [{ time: 1, temp: 50, code: 0 }] };
  assert.equal(inUnit(w, 'F'), w);
  assert.equal(inUnit(null, 'C'), null);
  const c = inUnit(w, 'C');
  assert.deepEqual(toWx(c), { icon: 'sun', temp: 17, word: 'SUNNY', hi: 21, lo: 11 });
  assert.equal(c.feels, null);
  assert.deepEqual([c.days[0].hi, Math.round(c.days[0].lo), c.hrs[0].temp], [0, -20, 10]);
  assert.equal(w.temp, 63.4); // original left alone (radar snow mode reads °F)
});
