'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { url, parse, condition, toWx, autoBright, createWeather, NIGHT_BRIGHT } = require('./weather');
const { measure } = require('./fonts');
const { ICONS } = require('./icons');

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

test('request URL asks for exactly what the recorded fixture has', () => {
  const u = new URL(url(42.008362, -87.665909));
  assert.equal(u.searchParams.get('latitude'), '42.0084');
  assert.equal(u.searchParams.get('current'), 'temperature_2m,weather_code,is_day');
  assert.equal(u.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(u.searchParams.get('timeformat'), 'unixtime');
  assert.deepEqual(Object.keys(MORSE.current).filter((k) => k !== 'time' && k !== 'interval'), u.searchParams.get('current').split(','));
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
