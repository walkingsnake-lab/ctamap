'use strict';
// Background screens for the knob mode mockups: every category and sub-mode,
// rendered by the real renderer. Made-up moment at Morse.
const fs = require('fs');
const path = require('path');
const draw = require('../../server/board/render');
const { normalize, format } = require('../../server/board/arrivals');
const { parseCtaTime, tzOffset } = require('../../server/board/time');
const { toSkyline } = require('../../server/board/skyline');
const { subsolar } = require('../../server/board/sun');

const B = path.join(__dirname, '..', '..', 'server', 'board');
const json = JSON.parse(fs.readFileSync(path.join(B, 'fixtures', 'tt-arrivals', 'morse-2026-10-03-2316.json'), 'utf8'));
const now = parseCtaTime(json.ctatt.tmst);
const r = format(normalize(json, { log: { warn() {}, error() {} } }), { rows: [], showHeader: true, showWeather: true, showKey: false }, { now, alerts: new Set() });
const wx = { icon: 'pcloudy_night', temp: 54, word: 'PT CLOUDY', hi: 61, lo: 47, feels: 51, wind: 'NW 12', pop: 20 };
const days = [['SU', 63, 'sun'], ['MO', 58, 'pcloudy_day'], ['TU', 52, 'rain'], ['WE', 49, 'cloudy'], ['TH', 55, 'sun']].map(([d, hi, icon]) => ({ d, hi, icon }));
const hours = [['1A', 52, 'pcloudy_night'], ['3A', 50, 'moon'], ['5A', 49, 'moon'], ['7A', 50, 'pcloudy_day']].map(([h, t, icon]) => ({ h, t, icon }));
const rad = (w) => ({ on: false, frames: [], ft: [], timeBox: [40, 0, 24, 22], split: false, wx: w });
const base = {
  v: 1, now, tzo: tzOffset(now), bright: 100, header: 'MORSE', view: r.view, rows: r.rows, ticker: r.ticker,
  wx: { icon: 'pcloudy_night', temp: 54, word: 'PT CLOUDY' }, warn: null,
};
const sky = toSkyline({ temp: 54, code: 2, clouds: 30 }, { lat: 41.8917, lon: -87.59, now, temp: 54 });
const CHC = { ab: 'CHC', c: '#2a5bd8' }, STL = { ab: 'STL', c: '#d62a2a' };
const game = { id: 1, start: now - 3600, st: 'live', inn: 7, half: 'T', b: 2, s: 1, o: 2, on: [1, 0, 1], away: { ...CHC, r: 3, w: 92, l: 70 }, home: { ...STL, r: 2, w: 88, l: 74 } };

// [category, sub-mode label, render]
const R = (extra, screen, o = {}) => () => draw.render({ ...base, ...extra }, { screen, now, frames: {}, ms: 0, ...o });
const SCREENS = {
  auto: [['AUTO', null, R({}, 'transit')]],
  transit: [['TRANSIT', 'ROWS', R({}, 'transit')], ['TRANSIT', 'TICKER', R({}, 'ticker')]],
  weather: [
    ['WEATHER', 'NOW', R({ radar: rad(wx) }, 'weather')],
    ['WEATHER', '5-DAY', R({ radar: rad({ ...wx, days }) }, 'weather')],
    ['WEATHER', 'HOURLY', R({ radar: rad({ ...wx, hours }) }, 'weather')],
  ],
  sports: [['SPORTS', null, R({ mlb: { layout: 'classic', games: [game] } }, 'baseball')]],
  clock: [
    ['CLOCK', 'SKYLINE', R({ cface: 'skyline', skyline: sky }, 'clock')],
    ['CLOCK', "70S", R({ cface: 'seventies' }, 'clock')],
    ['CLOCK', 'ANALOG', R({ cface: 'analog' }, 'clock')],
    ['CLOCK', 'DAY/NIGHT', R({ cface: 'daynight', dn: (() => { const q = subsolar(now); return { dec: Math.round(q.dec * 10), lon: Math.round(q.lon * 10), t: now, here: [16, 7] }; })() }, 'clock')],
    ['CLOCK', 'GRADIENT', R({ cface: 'gradient' }, 'clock')],
  ],
  announce: [['ANNOUNCE', null, R({ msg: { id: 1, style: 'note', ...draw.messageLayout('Dinner at 7\nbring wine', 'note') } }, 'announce')]],
};
const CATS = ['auto', 'transit', 'weather', 'sports', 'clock', 'announce'];
const FLAT = CATS.flatMap((c, ci) => SCREENS[c].map(([cat, sub, fn], si) => ({ ci, si, cat, sub, n: SCREENS[c].length, frame: fn() })));
module.exports = { draw, CATS, SCREENS, FLAT, now };
