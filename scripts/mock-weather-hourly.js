#!/usr/bin/env node
'use strict';
// Variants of the hourly weather concept (mockups only, made-up data; same
// forecast in every variant so they compare directly). Writes
// docs/board/mockups/weather/hourly/*.png and sheet.png.
// "Now" is 3 PM; high 78 at 5 PM; rain peaks around 9 PM; sunset 6:21 PM.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');
const { drawIcon } = require('../server/board/icons');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'hourly');
fs.mkdirSync(OUT, { recursive: true });

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lerp = (c0, c1, k) => hex(rgb(c0).map((v, i) => v + (rgb(c1)[i] - v) * k));
const dim = (c, k) => hex(rgb(c).map((v) => v * k));
function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) { const [v0, c0] = stops[i - 1]; return lerp(c0, stops[i][1], (v - v0) / (stops[i][0] - v0)); }
  }
  return stops[stops.length - 1][1];
}
const TEMP = [[-10, '#3050ff'], [20, '#40a0ff'], [40, '#30d0d0'], [55, '#40d040'], [70, '#ffd000'], [85, '#ff8000'], [100, '#ff2020']];
const tempColor = (t) => ramp(TEMP, t);
const C = { label: '#d8d8d8', grey: '#8f8f8f', dim: '#555555', divider: '#333333', white: '#ffffff', blue: '#1e90ff' };

const px = (f, x, y, c) => f.fill(x, y, 1, 1, c);
const rtext = (f, font, s, right, base, c) => f.text(font, s, right - measure(font, s), base, c);
const sprite = (f, rows, x, y, c) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') px(f, x + i, y + j, c); }));
const DROP = ['.#.', '###', '###', '.#.'];

// ---- the forecast ----
const NOW_HOUR = 15;
const tempAt = (h) => 68 + 10 * Math.sin(((NOW_HOUR + h - 11) * 2 * Math.PI) / 24);   // peaks 5 PM
const popAt = (h) => Math.round(80 * Math.exp(-(((h - 6) / 3.5) ** 2)) / 10) * 10;      // peaks 9 PM
const isDay = (h) => { const hr = (NOW_HOUR + h) % 24; return hr >= 7 && hr < 18.35; };
const hourLabel = (h) => { const hr = (NOW_HOUR + h) % 24; return `${hr % 12 || 12}${hr < 12 ? 'A' : 'P'}`; };
const T0 = Math.round(tempAt(0));                           // 77
const HI = 78;

const panels = [];
function panel(name, title, fn) {
  const f = new Frame();
  fn(f);
  fs.writeFileSync(path.join(OUT, `${name}.png`), f.toPNG(10));
  panels.push([title, f]);
}

// A. Bars: 12 hours, brightest bar is now, blue strip is rain chance.
panel('a-bars', 'A BARS', (f) => {
  f.text('5x7', String(T0), 0, 7, tempColor(T0));
  f.text('small', '°', 11, 6, tempColor(T0));
  rtext(f, 'small', `HIGH ${HI}° ${hourLabel(2)}`, 63, 6, C.grey);
  const ts = Array.from({ length: 12 }, (_, i) => tempAt(i));
  const lo = Math.min(...ts) - 2, hi = Math.max(...ts);
  ts.forEach((t, i) => {
    const x = 2 + i * 5, h = 3 + Math.round((t - lo) / (hi - lo) * 11);
    for (let j = 0; j < h; j++) f.fill(x, 23 - j, 4, 1, dim(tempColor(t), (i ? 0.5 : 1) * (0.55 + 0.45 * (j + 1) / h)));
    const p = popAt(i);
    f.fill(x, 25, 4, 1, p ? dim(C.blue, 0.2 + 0.8 * p / 100) : '#0c1018');
  });
  [0, 3, 6, 9].forEach((i) => f.text('small', i ? hourLabel(i) : 'NOW', 2 + i * 5, 31, C.dim));
});

// B. Curve: 24-hour temperature line with a dim fill, night shaded, rain ticks.
panel('b-curve', 'B CURVE', (f) => {
  f.text('5x7', String(T0), 0, 7, tempColor(T0));
  f.text('small', '°', 11, 6, tempColor(T0));
  rtext(f, 'small', 'LOW 58° 5A', 63, 6, C.grey);
  const lo = 56, hi = 80;
  for (let x = 0; x < 64; x++) {
    const h = x * 24 / 63, t = tempAt(h), y = 23 - Math.round((t - lo) / (hi - lo) * 13);
    const night = !isDay(Math.floor(h));
    for (let yy = y + 1; yy <= 23; yy++) px(f, x, yy, dim(tempColor(t), night ? 0.1 : 0.2));
    px(f, x, y, tempColor(t));
    if (x === 0) f.fill(0, y - 1, 2, 3, C.white);
    const p = popAt(h);
    if (p) f.fill(x, 25, 1, p >= 50 ? 2 : 1, dim(C.blue, 0.3 + 0.7 * p / 80));
  }
  [[0, 'NOW'], [6, hourLabel(6)], [12, hourLabel(12)], [18, hourLabel(18)]].forEach(([h, s]) => f.text('small', s, Math.round(h * 63 / 24), 31, C.dim));
});

// C. Ribbon: 32 hours as three color strips: temperature, rain chance, day/night.
panel('c-ribbon', 'C RIBBON', (f) => {
  f.text('5x7', String(T0), 0, 7, tempColor(T0));
  f.text('small', '°', 11, 6, tempColor(T0));
  rtext(f, 'small', 'NEXT 32 HR', 63, 6, C.grey);
  for (let h = 0; h < 32; h++) {
    const x = h * 2, t = tempAt(h), p = popAt(h);
    f.fill(x, 9, 2, 8, tempColor(t));
    f.fill(x, 18, 2, 4, p ? dim(C.blue, 0.25 + 0.75 * p / 80) : '#0a0e16');
    f.fill(x, 23, 2, 2, isDay(h) ? '#a08000' : '#101830');
  }
  f.fill(0, 8, 1, 1, C.white); f.fill(0, 25, 1, 1, C.white);
  [6, 12, 18, 24].forEach((h) => { px(f, h * 2, 26, C.dim); f.text('small', hourLabel(h), h * 2, 31, C.dim); });
});

// D. Table: every 3 hours, icon + temperature + rain chance in four columns.
panel('d-table', 'D TABLE', (f) => {
  const cols = [[0, 'pcloudy_day'], [3, 'cloudy'], [6, 'rain'], [9, 'rain']];
  cols.forEach(([h, icon], i) => {
    const cx = i * 16 + 8, t = Math.round(tempAt(h)), p = popAt(h);
    const lbl = h ? hourLabel(h) : 'NOW';
    f.text('small', lbl, cx - Math.floor(measure('small', lbl) / 2), 5, h ? C.dim : C.label);
    drawIcon(f, icon, cx - 4, 8);
    const s = `${t}`, w = measure('small', s) + 2;
    f.text('small', s, cx - Math.floor(w / 2), 22, tempColor(t));
    px(f, cx - Math.floor(w / 2) + w - 2, 17, tempColor(t));
    const ps = `${p}`, pw = measure('small', ps) + 5;
    const x0 = cx - Math.floor(pw / 2);
    DROP.forEach((r, j) => [...r].forEach((ch, k) => { if (ch === '#') px(f, x0 + k, 25 + j, p ? C.blue : C.dim); }));
    f.text('small', ps, x0 + 5, 29, p ? C.label : C.dim);
    if (i) f.fill(i * 16, 1, 1, 30, '#1a1a1a');
  });
});

// F. Mirror: temperature bars rise from a center line, rain bars hang below it.
panel('f-mirror', 'F MIRROR', (f) => {
  f.text('5x7', String(T0), 0, 7, tempColor(T0));
  f.text('small', '°', 11, 6, tempColor(T0));
  rtext(f, 'small', 'RAIN 80% 9P', 63, 6, C.blue);
  const ts = Array.from({ length: 16 }, (_, i) => tempAt(i)), lo = 56, hi = 80;
  ts.forEach((t, i) => {
    const x = i * 4, h = 2 + Math.round((t - lo) / (hi - lo) * 8);
    for (let j = 0; j < h; j++) f.fill(x, 19 - j, 3, 1, dim(tempColor(t), (i ? 0.45 : 1) * (0.5 + 0.5 * (j + 1) / h)));
    const p = popAt(i), r = Math.round(p / 80 * 8);
    for (let j = 0; j < r; j++) f.fill(x, 21 + j, 3, 1, dim(ramp([[0, '#1e90ff'], [8, '#8040ff']], j), i ? 0.7 : 1));
  });
  f.fill(0, 20, 64, 1, C.divider);
  [0, 4, 8, 12].forEach((i) => f.text('small', i ? hourLabel(i) : 'NOW', i * 4, 31, C.dim));
});

// G. Sparkline: today's big-number layout with the next 12 hours as a curve.
panel('g-spark', 'G BIG + SPARK', (f) => {
  let x = f.text('clock', String(T0), 0, 14, C.label);
  sprite(f, ['###', '#.#', '###'], x, 4, C.label);
  const lo = 62, hi = 79, x0 = 25;
  let prev = null;
  for (let i = 0; i <= 12; i++) {
    const t = tempAt(i), xx = x0 + Math.round(i * 38 / 12), y = 14 - Math.round((t - lo) / (hi - lo) * 12);
    if (prev) for (let k = prev[0]; k <= xx; k++) px(f, k, Math.round(prev[1] + (y - prev[1]) * (k - prev[0]) / (xx - prev[0] || 1)), tempColor(t));
    prev = [xx, y];
  }
  f.fill(x0, 1, 1, 1, C.white);
  for (let i = 0; i <= 12; i++) { const p = popAt(i); if (p) f.fill(x0 + Math.round(i * 38 / 12), 16, 3, 1, dim(C.blue, 0.3 + 0.7 * p / 80)); }
  f.fill(0, 18, 64, 1, C.divider);
  f.text('small', `HIGH ${HI}° ${hourLabel(2)}`, 0, 25, C.grey);
  const pt = '80%', pxl = 63 - measure('small', pt);
  f.text('small', pt, pxl, 31, C.label);
  DROP.forEach((r, j) => [...r].forEach((ch, k) => { if (ch === '#') px(f, pxl - 5 + k, 27 + j, C.blue); }));
  f.text('small', 'RAIN 6P', 0, 31, C.grey);
});

// Contact sheet.
const COLS = 2, PW = 64, PH = 32, GAP = 4, TH = 8;
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, Math.ceil(panels.length / COLS) * (PH + TH + GAP) + GAP);
panels.forEach(([title, f], i) => {
  const ox = GAP + (i % COLS) * (PW + GAP), oy = GAP + Math.floor(i / COLS) * (PH + TH + GAP);
  sheet.text('small', title, ox, oy + 5, '#606060');
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y));
});
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(6));
console.log(`wrote ${panels.length} panels + sheet.png to ${path.relative(process.cwd(), OUT)}`);
