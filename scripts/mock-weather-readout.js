#!/usr/bin/env node
'use strict';
// Current conditions as the forecast screens' top bar + a terminal-style
// readout in full color (Nov 2026). Not implemented; made-up data.
//
// The top bar (icon, 5x7 temperature, ↑high ↓low; a watch or warning takes
// over the high/low) is drawn by the real renderer, so it's pixel-identical
// to the 5-day and hourly screens. Below it, label ..... value lines with dot
// leaders. Variants:
//   3 LINES    SKY / FEELS / WIND, on the 5-day's row rhythm (first line on
//              the weekday row, rows 11-15)
//   4 LINES    + RAIN (highest chance in the next 6 hours)
//   4 + SUN    + SUNSET by day, SUNRISE by night
//   COLOR      4 lines with values in meaning colors: the condition by kind,
//              feels-like on the temperature scale, rain blue
// The first row of the sheet is the existing 5-day screen for comparison.
// Writes docs/board/mockups/weather/readout/<variant>-<state>.png and sheet.png.
// Usage: node scripts/mock-weather-readout.js [outDir]

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');
const render = require('../server/board/render');

const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'readout');
fs.mkdirSync(OUT, { recursive: true });

// ---------- colors (draw.js palette) ----------
const C = { label: '#808080', value: '#d8d8d8', leader: '#333333', blue: '#1e90ff', dusk: '#ff9a40' };
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lerp = (c0, c1, k) => hex(rgb(c0).map((v, i) => v + (rgb(c1)[i] - v) * k));
// draw.js TEMP_STOPS, with the cold end lifted for text (the deep blue is the
// board's dimmest color).
const TEMP = [[-10, '#6080ff'], [20, '#60b0ff'], [40, '#30d0d0'], [55, '#40d040'], [70, '#ffd000'], [85, '#ff8000'], [100, '#ff2020']];
function tempColor(t) {
  if (t <= TEMP[0][0]) return TEMP[0][1];
  for (let i = 1; i < TEMP.length; i++) if (t <= TEMP[i][0]) { const [t0, c0] = TEMP[i - 1]; return lerp(c0, TEMP[i][1], (t - t0) / (TEMP[i][0] - t0)); }
  return TEMP[TEMP.length - 1][1];
}
const KIND = { rain: '#4aa0ff', snow: '#c8e8ff', storm: '#ffffff', sun: '#ffc800', moon: '#ffe47a' };

// ---------- states ----------
const DAYS = [{ d: 'MO', icon: 'sun', hi: 61 }, { d: 'TU', icon: 'pcloudy_day', hi: 58 }, { d: 'WE', icon: 'rain', hi: 52 }, { d: 'TH', icon: 'cloudy', hi: 49 }, { d: 'FR', icon: 'sun', hi: 55 }];
const STATES = [
  { id: 'a-ptcloudy', temp: 57, icon: 'pcloudy_day', word: 'PT CLOUDY', feels: 55, wind: 'NW 12', hi: 63, lo: 49, pop: 20, sun: ['SUNSET', '4:42'] },
  { id: 'b-rain', temp: 36, icon: 'rain', word: 'RAIN', feels: 29, wind: 'E 18', hi: 39, lo: 33, pop: 90, sun: ['SUNSET', '4:42'] },
  { id: 'c-night', temp: 72, icon: 'moon', word: 'CLEAR', feels: 72, wind: 'S 5', hi: 84, lo: 68, pop: 0, sun: ['SUNRISE', '5:31'] },
  { id: 'd-cold', temp: -12, icon: 'snow', word: 'SNOW', feels: -27, wind: 'NW 22', hi: -5, lo: -14, pop: 60, sun: ['SUNSET', '4:31'] },
  { id: 'e-warning', temp: 84, icon: 'storm', word: 'STORMS', feels: 91, wind: 'SW 31', hi: 89, lo: 70, pop: 80, sun: ['SUNSET', '8:12'], warn: { kind: 'tor', lvl: 'warning' } },
];

// The real 5-day screen (whole) or just its top bar (rows 0-7).
function fiveDay(w) {
  const p = { now: 1762000000, warn: w.warn, radar: { frames: [], wx: { temp: w.temp, icon: w.icon, word: w.word, hi: w.hi, lo: w.lo, days: DAYS } } };
  return render.renderWeather(p, { blink: false });
}
function topBar(w) {
  const f = fiveDay(w);
  f.fill(0, 8, 64, 24, '#000000');
  return f;
}

// label ...... value, value right-aligned to x63; leaders every 2px on the
// row above the baseline, 2px clear of both ends.
function line(f, label, value, base, vc = C.value) {
  const lx = f.text('small', label, 0, base, C.label);
  const vx = 63 - measure('small', value) + 1;
  for (let x = lx + 1; x < vx - 2; x += 2) f.fill(x, base - 1, 1, 1, C.leader);
  f.text('small', value, vx, base, vc);
}

const VARIANTS = [
  { id: '0-fiveday', title: '5-DAY (EXISTING)', fn: (w) => fiveDay(w) },
  { id: '1-three', title: '3 LINES', fn: (w) => {
    const f = topBar(w);
    // Rows 11-15, 18-22, 25-29: the first line on the 5-day's weekday row.
    line(f, 'SKY', w.word, 16);
    line(f, 'FEELS', `${w.feels}°`, 23);
    line(f, 'WIND', `${w.wind} MPH`, 30);
    return f;
  } },
  { id: '2-four', title: '4 LINES', fn: (w) => {
    const f = topBar(w);
    // Rows 9-13, 15-19, 21-25, 27-31: pitch 6, flush to the bottom edge like
    // the weather strip.
    line(f, 'SKY', w.word, 14);
    line(f, 'FEELS', `${w.feels}°`, 20);
    line(f, 'WIND', `${w.wind} MPH`, 26);
    line(f, 'RAIN', `${w.pop}%`, 32);
    return f;
  } },
  { id: '3-sun', title: '4 LINES + SUN', fn: (w) => {
    const f = topBar(w);
    line(f, 'SKY', w.word, 14);
    line(f, 'FEELS', `${w.feels}°`, 20);
    line(f, 'WIND', `${w.wind} MPH`, 26);
    line(f, w.sun[0], w.sun[1], 32);
    return f;
  } },
  { id: '4-color', title: '4 LINES, COLOR', fn: (w) => {
    const f = topBar(w);
    line(f, 'SKY', w.word, 14, KIND[w.icon] || C.value);
    line(f, 'FEELS', `${w.feels}°`, 20, tempColor(w.feels));
    line(f, 'WIND', `${w.wind} MPH`, 26);
    line(f, 'RAIN', `${w.pop}%`, 32, w.pop ? C.blue : C.label);
    return f;
  } },
];

const frames = VARIANTS.map((V) => STATES.map((w) => {
  const f = V.fn(w);
  if (!V.id.startsWith('0')) fs.writeFileSync(path.join(OUT, `${V.id}-${w.id}.png`), f.toPNG(10));
  return f;
}));
const SC = 5, GAP = 12, fw = 64 * SC, fh = 32 * SC;
const sheet = new PNG({ width: STATES.length * (fw + GAP) + GAP, height: VARIANTS.length * (fh + GAP) + GAP });
sheet.data.fill(24);
for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;
frames.forEach((row, r) => row.forEach((f, c) => {
  const img = PNG.sync.read(f.toPNG(SC));
  const ox = GAP + c * (fw + GAP), oy = GAP + r * (fh + GAP);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const si = (y * fw + x) * 4, di = ((oy + y) * sheet.width + ox + x) * 4;
    for (let k = 0; k < 4; k++) sheet.data[di + k] = img.data[si + k];
  }
}));
fs.writeFileSync(path.join(OUT, 'sheet.png'), PNG.sync.write(sheet));
console.log(`wrote ${OUT}`);
