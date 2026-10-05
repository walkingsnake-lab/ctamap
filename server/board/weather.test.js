'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { url, parse, condition, toWx, toScreenWx, windText, compass, autoBright, createWeather, NIGHT_BRIGHT, POP_HOURS } = require('./weather');
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
