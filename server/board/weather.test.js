'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { url, parse, condition, toWx, toScreenWx, toDays, toRain, dayName, windText, compass, autoBright, createWeather, NIGHT_BRIGHT, POP_HOURS, FORECAST_DAYS } = require('./weather');
const { measure } = require('./fonts');
const { ICONS } = require('./icons');
const { createNws } = require('./nws');

const MORSE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'open-meteo', 'morse-2026-10-04-1045.json'), 'utf8'));
const quiet = { warn() {}, error() {} };

test('Morse, Sunday morning: clear and 63°', () => {
  const w = parse(MORSE);
  assert.equal(w.code, 0);
  assert.equal(w.isDay, true);
  assert.deepEqual(toWx(w), { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51 });
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

test('every condition word fits next to the widest temperature', () => {
  // Temperature starts at x=10; leave 3px before the right-aligned word.
  const room = 63 - (10 + measure('small', '-10°') + 3) + 1;
  for (const code of [0, 2, 3, 45, 61, 66, 71, 95]) for (const day of [true, false]) {
    const [, word] = condition(code, day);
    assert.ok(measure('small', word) <= room, `${word} is ${measure('small', word)}px, room ${room}`);
  }
});

test('auto brightness: full from sunrise to sunset, dimmer overnight', () => {
  const w = parse(MORSE);
  assert.equal(autoBright(w, w.time), 100);
  assert.equal(autoBright(w, w.sunrise - 1), NIGHT_BRIGHT);
  assert.equal(autoBright(w, w.sunrise), 100);
  assert.equal(autoBright(w, w.sunset), NIGHT_BRIGHT);
  assert.equal(autoBright(null, w.time), 100); // no data yet
});

test('request URL asks for the weather row fields plus the weather screen extras', () => {
  const u = new URL(url(42.008362, -87.665909));
  assert.equal(u.searchParams.get('latitude'), '42.0084');
  assert.equal(u.searchParams.get('current'), 'temperature_2m,weather_code,is_day,apparent_temperature,wind_speed_10m,wind_direction_10m');
  assert.equal(u.searchParams.get('hourly'), 'precipitation_probability');
  assert.equal(u.searchParams.get('forecast_hours'), String(POP_HOURS));
  assert.equal(u.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(u.searchParams.get('wind_speed_unit'), 'mph');
  assert.equal(u.searchParams.get('timeformat'), 'unixtime');
  // The recorded fixture predates the extras: its fields are a prefix.
  const asked = u.searchParams.get('current').split(',');
  const recorded = Object.keys(MORSE.current).filter((k) => k !== 'time' && k !== 'interval');
  assert.deepEqual(asked.slice(0, recorded.length), recorded);
});

test('weather screen: extras are null when the response lacks them (older fixture)', () => {
  assert.deepEqual(toScreenWx(parse(MORSE)), { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51, feels: null, wind: null, pop: null });
});

test('weather screen: feels-like, wind, and the next 6 hours\' highest rain chance', () => {
  // The Morse fixture with the extra fields in Open-Meteo's response shape.
  const json = {
    ...MORSE,
    current: { ...MORSE.current, apparent_temperature: 60.6, wind_speed_10m: 11.6, wind_direction_10m: 312 },
    hourly: { time: [0, 1, 2, 3, 4, 5].map((i) => MORSE.current.time + i * 3600), precipitation_probability: [0, 5, 20, 45, null, 30] },
  };
  assert.deepEqual(toScreenWx(parse(json)), { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51, feels: 61, wind: 'NW 12', pop: 45 });
  // Only the first POP_HOURS slots count.
  const longer = { ...json, hourly: { precipitation_probability: [0, 0, 0, 0, 0, 0, 90] } };
  assert.equal(parse(longer).pop, 0);
  // The weather row's wx keeps its shape.
  assert.deepEqual(toWx(parse(json)), { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51 });
});

test('5-day: the five days after today, weekday names, day icons, rounded highs', () => {
  const u = new URL(url(42.008362, -87.665909));
  assert.equal(u.searchParams.get('forecast_days'), String(FORECAST_DAYS + 1));
  assert.ok(u.searchParams.get('daily').split(',').includes('weather_code'));
  // The fixture predates the forecast: one day, no daily codes.
  assert.deepEqual(parse(MORSE).days, []);
  assert.equal(toDays(parse(MORSE)), null);
  // The Morse fixture (Sunday Oct 4) with six days in Open-Meteo's response
  // shape (unixtime local midnights; Nov 1 brings the DST change).
  const mid = MORSE.daily.time[0];
  const json = { ...MORSE, daily: {
    time: [0, 1, 2, 3, 4, 5].map((i) => mid + i * 86400),
    temperature_2m_max: [68.9, 71.4, 103.6, 52.2, -9.5, 60],
    temperature_2m_min: [51, 55, 80, 41, -20, 48],
    sunrise: MORSE.daily.sunrise, sunset: MORSE.daily.sunset,
    weather_code: [0, 0, 95, 3, 73, 2],
  } };
  const w = parse(json);
  assert.equal(w.hi, 68.9); // today stays index 0
  assert.deepEqual(toDays(w), [
    { d: 'MO', icon: 'sun', hi: 71 },
    { d: 'TU', icon: 'storm', hi: 104 },
    { d: 'WE', icon: 'cloudy', hi: 52 },
    { d: 'TH', icon: 'snow', hi: -9 },
    { d: 'FR', icon: 'pcloudy_day', hi: 60 },
  ]);
  // A gap ends the list.
  const gap = { ...json, daily: { ...json.daily, temperature_2m_max: [68.9, 71.4, null, 52, 50, 60] } };
  assert.equal(parse(gap).days.length, 1);
  // Weekday at a local midnight, across both DST changes.
  assert.equal(dayName(Date.UTC(2026, 10, 1, 5) / 1000), 'SU'); // CDT midnight, the day DST ends
  assert.equal(dayName(Date.UTC(2026, 10, 2, 6) / 1000), 'MO'); // CST midnight
  assert.equal(dayName(Date.UTC(2027, 2, 14, 6) / 1000), 'SU'); // CST midnight, the day DST starts
});

test('cache file: saved data from before the 5-day forecast or rain bars is fetched fresh', async () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wx-'));
  const cacheFile = path.join(dir, 'board-weather.json');
  const t = 2000;
  const old = { ...parse(MORSE) }; delete old.q15;
  fs.writeFileSync(cacheFile, JSON.stringify({ '42.008,-87.666': { lat: 42.0084, lon: -87.6659, data: old, fetchedAt: t - 60 } }));
  let calls = 0;
  const wx = createWeather({ fetch: async () => { calls++; return MORSE; }, now: () => t, log: quiet, cacheFile });
  assert.deepEqual((await wx.get(42.0084, -87.6659)).days, []);
  assert.equal(calls, 1);
  // Current data is used as saved.
  const wx2 = createWeather({ fetch: async () => { calls++; return MORSE; }, now: () => t, log: quiet, cacheFile });
  await wx2.get(42.0084, -87.6659);
  assert.equal(calls, 1);
});

test('rain bars: 15-minute request, parse, and no bars without data or rain', () => {
  const u = new URL(url(42.008362, -87.665909));
  assert.equal(u.searchParams.get('minutely_15'), 'precipitation,snowfall');
  assert.equal(u.searchParams.get('forecast_minutely_15'), '12');
  assert.deepEqual(parse(MORSE).q15, []); // fixture predates it
  assert.equal(toRain(parse(MORSE), MORSE.current.time), null);
});

// Open-Meteo-shaped 15-minute data: amounts are sums over the 15 minutes
// before each time. `now` sits 5 min into a quarter hour.
const T0 = 1791129600; // a quarter-hour boundary
const NOW = T0 + 300;
function q15(precip, snow = []) {
  const time = [], p = [], s = [];
  // One step already past (ends before now), then the next 11.
  for (let i = 0; i < 12; i++) { time.push(T0 + i * 900); p.push(i === 0 ? 9 : precip[i - 1] || 0); s.push(i === 0 ? 0 : snow[i - 1] || 0); }
  return parse({ ...MORSE, minutely_15: { time, precipitation: p, snowfall: s } });
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
  // 0.5 mm water as 0.35 cm of snow per step (Open-Meteo's 0.7 cm/mm).
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

test('wind: 8-point compass, CALM under 1 mph', () => {
  assert.equal(compass(0), 'N'); assert.equal(compass(22), 'N'); assert.equal(compass(23), 'NE');
  assert.equal(compass(180), 'S'); assert.equal(compass(337), 'NW'); assert.equal(compass(338), 'N'); assert.equal(compass(360), 'N');
  assert.equal(windText(0.4, 90), 'CALM');
  assert.equal(windText(5.5, 90), 'E 6');
  assert.equal(windText(5, null), '5');
  assert.equal(windText(null, 90), null);
});

test('cache: one fetch per location per interval, last good data kept on failure', async () => {
  let t = 1000, calls = 0, fail = false;
  const wx = createWeather({ fetch: async () => { calls++; if (fail) throw new Error('down'); return MORSE; }, now: () => t, log: quiet });
  assert.equal((await wx.get(42.0084, -87.6659)).temp, 63.3);
  await wx.get(42.0084, -87.6659);
  assert.equal(calls, 1);
  t += 601; fail = true;
  await wx.get(42.0084, -87.6659); // a board is still asking
  wx.pass();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  assert.equal((await wx.get(42.0084, -87.6659)).temp, 63.3);
  // Nobody asking for 5+ minutes: polling stops.
  t += 900;
  wx.pass();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  assert.throws(() => parse({}), /Open-Meteo/);
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
  assert.equal(await wx.get(42.0084, -87.6659), null);
  fail = false;
  t += 30;
  assert.equal((await wx.get(42.0084, -87.6659)).temp, 63.3);
  assert.equal(calls, 2);
});

test('cache file: a restart starts from the last good weather, until it is 3 hours old', async () => {
  const file = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'board-wx-')), 'board-weather.json');
  let t = 1000, calls = 0;
  const make = (fetch) => createWeather({ fetch: async () => { calls++; return fetch(); }, now: () => t, log: quiet, cacheFile: file });
  await make(() => MORSE).get(42.0084, -87.6659);
  assert.ok(fs.existsSync(file));
  // Restart with Open-Meteo down: the saved data is there right away.
  t += 1800;
  const down = make(() => { throw new Error('down'); });
  calls = 0;
  assert.equal((await down.get(42.0084, -87.6659, { wait: 1e6 })).temp, 63.3);
  assert.equal(calls, 0, 'no wait for a fetch');
  down.pass();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1, 'refreshed on the next pass');
  // Saved locations nobody asks for aren't polled.
  const idle = make(() => MORSE);
  calls = 0;
  idle.pass();
  assert.equal(calls, 0);
  // Too old to show.
  t += 3 * 3600;
  assert.equal(await make(() => { throw new Error('down'); }).get(42.0084, -87.6659, { wait: 0 }), null);
  // A bad file is ignored.
  fs.writeFileSync(file, '{not json');
  assert.equal(await make(() => { throw new Error('down'); }).get(42.0084, -87.6659, { wait: 0 }), null);
});
