#!/usr/bin/env node
'use strict';
// Mockups (made-up data): 5-day forecast variants and "rain soon" bar-chart
// variants. Writes docs/board/mockups/weather/5day/ and .../rain/ (one PNG per
// panel plus sheet.png in each).

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');
const { drawIcon } = require('../server/board/icons');

const BASE = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather');

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
const ctext = (f, font, s, cx, base, c) => f.text(font, s, Math.round(cx - measure(font, s) / 2), base, c);
const DROP = ['.#.', '###', '###', '.#.'];
const sprite = (f, rows, x, y, c) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') px(f, x + i, y + j, c); }));

function group(dir, build) {
  const out = path.join(BASE, dir);
  fs.mkdirSync(out, { recursive: true });
  const panels = [];
  build((name, title, fn) => {
    const f = new Frame();
    fn(f);
    fs.writeFileSync(path.join(out, `${name}.png`), f.toPNG(10));
    panels.push([title, f]);
  });
  const COLS = 2, PW = 64, PH = 32, GAP = 4, TH = 8;
  const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, Math.ceil(panels.length / COLS) * (PH + TH + GAP) + GAP);
  panels.forEach(([title, f], i) => {
    const ox = GAP + (i % COLS) * (PW + GAP), oy = GAP + Math.floor(i / COLS) * (PH + TH + GAP);
    sheet.text('small', title, ox, oy + 5, '#606060');
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y));
  });
  fs.writeFileSync(path.join(out, 'sheet.png'), sheet.toPNG(6));
  console.log(`wrote ${panels.length} panels + sheet.png to ${path.relative(process.cwd(), out)}`);
}

// ---------------------------------------------------------------- 5-day
// [day, low, high, icon, rain chance %]
const DAYS = [['TD', 49, 63, 'pcloudy_day', 20], ['SA', 52, 71, 'sun', 0], ['SU', 58, 78, 'sun', 10], ['MO', 55, 66, 'rain', 80], ['TU', 41, 52, 'cloudy', 30]];
const NOWT = 57;

group('5day', (panel) => {
  // A. Range rows: the original idea, with the rain chance as a blue underline per row.
  panel('a-rows', 'A RANGE ROWS', (f) => {
    const lo = 40, hi = 80, x0 = 24, x1 = 50;
    const xOf = (t) => Math.round(x0 + (t - lo) / (hi - lo) * (x1 - x0));
    DAYS.forEach(([d, l, h, , pop], i) => {
      const t = 1 + i * 6;
      f.text('small', d, 0, t + 5, i ? C.grey : C.label);
      rtext(f, 'small', String(l), 21, t + 5, C.dim);
      f.fill(x0, t + 2, x1 - x0 + 1, 1, '#1c1c1c');
      for (let x = xOf(l); x <= xOf(h); x++) f.fill(x, t + 1, 1, 3, tempColor(lo + (x - x0) / (x1 - x0) * (hi - lo)));
      if (!i) f.fill(xOf(NOWT), t, 1, 5, C.white);
      f.text('small', String(h), 53, t + 5, C.label);
      if (pop) f.fill(62, t + 4 - Math.round(pop / 100 * 3), 2, 1 + Math.round(pop / 100 * 3), dim(C.blue, 0.5 + 0.5 * pop / 80));
    });
  });

  // B. Columns: day, icon, high, low, and a blue rain-chance bar.
  panel('b-columns', 'B ICON COLUMNS', (f) => {
    DAYS.forEach(([d, l, h, icon, pop], i) => {
      const cx = 2 + i * 12 + 6;
      if (i) f.fill(i * 12 + 1, 0, 1, 32, '#141414');
      ctext(f, 'small', d, cx, 5, i ? C.grey : C.label);
      drawIcon(f, icon, cx - 4, 7);
      ctext(f, 'small', String(h), cx, 21, tempColor(h));
      ctext(f, 'small', String(l), cx, 27, dim(tempColor(l), 0.6));
      f.fill(cx - 5, 30, 10, 2, '#0c1018');
      f.fill(cx - 5, 30, Math.round(pop / 100 * 10), 2, C.blue);
    });
  });

  // C. Floating bars: each day's range as a vertical bar on one shared scale.
  panel('c-floating', 'C FLOATING BARS', (f) => {
    const lo = 38, hi = 80, top = 12, bot = 25;
    const yOf = (t) => bot - Math.round((t - lo) / (hi - lo) * (bot - top));
    DAYS.forEach(([d, l, h], i) => {
      const cx = 2 + i * 12 + 6;
      ctext(f, 'small', d, cx, 5, i ? C.grey : C.label);
      ctext(f, 'small', String(h), cx, 11, C.label);
      for (let y = yOf(h); y <= yOf(l); y++) f.fill(cx - 3, y, 6, 1, tempColor(lo + (bot - y) / (bot - top) * (hi - lo)));
      if (!i) f.fill(cx - 5, yOf(NOWT), 10, 1, C.white);
      ctext(f, 'small', String(l), cx, 31, C.dim);
    });
  });

  // D. Today big, then the next four days as a compact strip of colored bars.
  panel('d-today-strip', 'D TODAY + 4', (f) => {
    const x = f.text('5x7', String(NOWT), 0, 7, tempColor(NOWT));
    f.text('small', '°', x, 6, tempColor(NOWT));
    drawIcon(f, 'pcloudy_day', 22, 0);
    rtext(f, 'small', 'H63 L49', 63, 6, C.grey);
    f.fill(0, 10, 64, 1, C.divider);
    const lo = 38, hi = 80;
    DAYS.slice(1).forEach(([d, l, h, icon, pop], i) => {
      const cx = i * 16 + 8;
      ctext(f, 'small', d, cx, 17, C.grey);
      const w = 12, x0 = cx - 6;
      f.fill(x0, 20, w, 3, '#141414');
      const a = Math.round((l - lo) / (hi - lo) * (w - 1)), b = Math.round((h - lo) / (hi - lo) * (w - 1));
      for (let k = a; k <= b; k++) f.fill(x0 + k, 20, 1, 3, tempColor(lo + k / (w - 1) * (hi - lo)));
      ctext(f, 'small', String(h), cx, 29, tempColor(h));
      if (pop >= 30) px(f, cx + 8, 17, C.blue);
    });
  });
});

// ------------------------------------------------------------ rain soon
// 21 five-minute slots (about 105 min); intensity 0..1.
const START = [0, 0, 0, 0, 0, .1, .2, .3, .5, .7, .9, 1, .9, .8, .6, .5, .4, .3, .2, .1, .1];
const ENDING = [.8, .9, .7, .6, .5, .4, .3, .2, .1, .1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const RAIN = [[0, '#14407a'], [0.5, '#1e90ff'], [1, '#b8e4ff']];
const rainColor = (v) => ramp(RAIN, v);

// Draw bars rising from `base` (2px wide, 1px gap), `max` rows tall at v=1.
function bars(f, data, base, max, opts = {}) {
  data.forEach((v, i) => {
    const x = i * 3 + 1;
    if (!v) { f.fill(x, base, 2, 1, '#0e1a2c'); return; }
    const h = Math.max(1, Math.round(v * max));
    for (let j = 0; j < h; j++) {
      const c = opts.byHeight ? rainColor((j + 1) / max) : rainColor(v);
      f.fill(x, base - j, 2, 1, c);
    }
  });
}

group('rain', (panel) => {
  // A. Bars rising, colored by intensity.
  panel('a-bars', 'A BARS', (f) => {
    ctext(f, 'small', 'RAIN IN 25 MIN', 32, 5, '#60b0ff');
    bars(f, START, 24, 14);
    f.fill(0, 26, 64, 1, C.divider);
    f.text('small', 'NOW', 0, 31, C.grey); ctext(f, 'small', '1H', 31, 31, C.dim); rtext(f, 'small', '2H', 63, 31, C.dim);
  });

  // B. Same, with LIGHT / HEAVY guide lines and a peak marker.
  panel('b-guides', 'B GUIDES + PEAK', (f) => {
    f.text('small', '25 MIN', 0, 5, '#60b0ff');
    rtext(f, 'small', 'PEAK 9:40P', 63, 5, C.grey);
    [[24, 0.0], [17, 0.5], [10, 1.0]].forEach(([y]) => { for (let x = 0; x < 64; x += 2) px(f, x, y, '#16202e'); });
    bars(f, START, 24, 14, { byHeight: true });
    const pk = START.indexOf(Math.max(...START));
    px(f, pk * 3 + 1, 8, C.white); px(f, pk * 3 + 2, 8, C.white);
    f.fill(0, 26, 64, 1, C.divider);
    f.text('small', 'NOW', 0, 31, C.grey); rtext(f, 'small', '2H', 63, 31, C.dim);
  });

  // C. Rain ending: bars falling off, drops in the header.
  panel('c-ending', 'C RAIN ENDING', (f) => {
    sprite(f, DROP, 0, 1, C.blue);
    f.text('small', 'ENDS IN 45 MIN', 6, 5, '#60b0ff');
    bars(f, ENDING, 24, 14);
    f.fill(0, 26, 64, 1, C.divider);
    f.text('small', 'NOW', 0, 31, C.grey); ctext(f, 'small', '1H', 31, 31, C.dim); rtext(f, 'small', '2H', 63, 31, C.dim);
  });

  // D. Big countdown on the left, bars on the right.
  panel('d-countdown', 'D COUNTDOWN', (f) => {
    f.text('clock', '25', 0, 14, C.label);
    f.text('small', 'MIN', 0, 20, '#60b0ff');
    sprite(f, DROP, 0, 24, C.blue);
    f.text('small', 'RAIN', 6, 30, C.grey);
    const x0 = 22;
    START.slice(0, 14).forEach((v, i) => {
      const x = x0 + i * 3;
      if (!v) { f.fill(x, 28, 2, 1, '#0e1a2c'); return; }
      const h = Math.max(1, Math.round(v * 22));
      for (let j = 0; j < h; j++) f.fill(x, 28 - j, 2, 1, rainColor((j + 1) / 22));
    });
    f.fill(x0, 30, 41, 1, C.divider);
  });

  // E. Hanging bars: rain falls from the top edge.
  panel('e-falling', 'E FALLING', (f) => {
    START.forEach((v, i) => {
      const x = i * 3 + 1;
      if (!v) { f.fill(x, 0, 2, 1, '#0e1a2c'); return; }
      const h = Math.max(1, Math.round(v * 15));
      for (let j = 0; j < h; j++) f.fill(x, j, 2, 1, rainColor((h - j) / 15 * v));
    });
    f.fill(0, 17, 64, 1, C.divider);
    ctext(f, 'small', 'RAIN IN 25 MIN', 32, 25, '#60b0ff');
    f.text('small', 'NOW', 0, 31, C.grey); rtext(f, 'small', '2H', 63, 31, C.dim);
  });

  // F. Two-hour bars plus the next-hour total.
  panel('f-total', 'F WITH TOTAL', (f) => {
    f.text('5x7', '25', 0, 7, C.label);
    f.text('small', 'MIN', 12, 6, '#60b0ff');
    rtext(f, 'small', '0.3 IN', 63, 6, C.grey);
    bars(f, START, 24, 12, { byHeight: true });
    f.fill(0, 26, 64, 1, C.divider);
    f.text('small', 'NOW', 0, 31, C.grey); ctext(f, 'small', '1H', 31, 31, C.dim); rtext(f, 'small', '2H', 63, 31, C.dim);
  });
});
