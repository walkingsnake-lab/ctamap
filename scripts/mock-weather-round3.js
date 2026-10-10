#!/usr/bin/env node
'use strict';
// Round 3 mockups (made-up data): the 5-day layout combining the "today" top bar
// with icon columns, and the rain-soon bar chart at three data resolutions, each
// in a "rain begins" and a "rain ends" version. Writes
// docs/board/mockups/weather/5day-combo/ and .../rain-wide/.

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

// ------------------------------------------------------------ 5-day combo
const NOWT = 57;
const NEXT = [['SA', 52, 71, 'sun'], ['SU', 58, 78, 'sun'], ['MO', 55, 66, 'rain'], ['TU', 41, 52, 'cloudy']];

// Top bar (today) on rows 0-7, divider row 9, then four 16px columns:
// day (rows 11-15), icon (17-24), high (26-30).
function columns(f, rangeLine) {
  NEXT.forEach(([d, l, h, icon], i) => {
    const cx = i * 16 + 8;
    ctext(f, 'small', d, cx, 15, C.grey);
    drawIcon(f, icon, cx - 4, 17);
    ctext(f, 'small', String(h), cx, 30, tempColor(h));
    if (rangeLine) {
      const w = 12, x0 = cx - 6, lo = 38, hiT = 80;
      const a = Math.round((l - lo) / (hiT - lo) * (w - 1)), b = Math.round((h - lo) / (hiT - lo) * (w - 1));
      f.fill(x0, 31, w, 1, '#14141c');
      for (let k = a; k <= b; k++) px(f, x0 + k, 31, tempColor(lo + k / (w - 1) * (hiT - lo)));
    }
  });
}

group('5day-combo', (panel) => {
  panel('a-plain', 'A PLAIN', (f) => {
    const x = f.text('5x7', String(NOWT), 0, 7, tempColor(NOWT));
    f.text('small', '°', x, 6, tempColor(NOWT));
    drawIcon(f, 'pcloudy_day', 22, 0);
    rtext(f, 'small', 'H63 L49', 63, 6, C.grey);
    f.fill(0, 9, 64, 1, C.divider);
    columns(f, false);
  });
  panel('b-range-line', 'B RANGE LINE', (f) => {
    const x = f.text('5x7', String(NOWT), 0, 7, tempColor(NOWT));
    f.text('small', '°', x, 6, tempColor(NOWT));
    drawIcon(f, 'pcloudy_day', 22, 0);
    rtext(f, 'small', 'H63 L49', 63, 6, C.grey);
    f.fill(0, 9, 64, 1, C.divider);
    columns(f, true);
  });
  panel('c-icon-right', 'C ICON RIGHT', (f) => {
    const x = f.text('5x7', String(NOWT), 0, 7, tempColor(NOWT));
    f.text('small', '°', x, 6, tempColor(NOWT));
    f.text('small', 'H63 L49', 19, 6, C.grey);
    drawIcon(f, 'pcloudy_day', 55, 0);
    f.fill(0, 9, 64, 1, C.divider);
    columns(f, false);
  });
  panel('d-today-high-only', 'D WORD', (f) => {
    const x = f.text('5x7', String(NOWT), 0, 7, tempColor(NOWT));
    f.text('small', '°', x, 6, tempColor(NOWT));
    drawIcon(f, 'pcloudy_day', 55, 0);
    rtext(f, 'small', 'PT CLOUDY', 52, 6, C.grey);
    f.fill(0, 9, 64, 1, C.divider);
    columns(f, true);
  });
});

// ------------------------------------------------------------ rain, wide bars
const RAIN = [[0, '#14407a'], [0.5, '#1e90ff'], [1, '#b8e4ff']];
const rainColor = (v) => ramp(RAIN, v);

// Bars rising from row `base`, up to `max` rows at v = 1. pitch = w + 1 gap.
function bars(f, data, x0, w, base, max) {
  data.forEach((v, i) => {
    const x = x0 + i * (w + 1);
    if (!v) { f.fill(x, base, w, 1, '#0e1a2c'); return; }
    const h = Math.max(1, Math.round(v * max));
    for (let j = 0; j < h; j++) f.fill(x, base - j, w, 1, rainColor(Math.min(1, v * (0.55 + 0.45 * (j + 1) / h))));
  });
}
const axis = (f, labels) => {
  f.fill(0, 26, 64, 1, C.divider);
  labels.forEach(([x, s, align]) => {
    if (align === 'r') rtext(f, 'small', s, x, 31, C.dim);
    else f.text('small', s, x, 31, s === 'NOW' ? C.grey : C.dim);
  });
};
const title = (f, s) => ctext(f, 'small', s, 32, 5, '#60b0ff');

const D15_2H = { begin: [0, .2, .5, .8, 1, .7, .4, .2], end: [1, .8, .5, .3, 0, 0, 0, 0] };
const D15_3H = { begin: [0, .2, .5, .8, 1, .7, .4, .2, .1, 0, 0, 0], end: [.8, .9, .7, .5, .3, .1, 0, 0, 0, 0, 0, 0] };
const D1H = { begin: [.3, .9, 1, .5, .2, 0], end: [.8, .5, .2, 0, 0, 0] };

group('rain-wide', (panel) => {
  // 15-minute data, 8 bars over 2 hours, 7px wide.
  panel('a-15min-2h-begin', 'A 15 MIN / 2H', (f) => {
    title(f, 'RAIN IN 25 MIN');
    bars(f, D15_2H.begin, 0, 7, 24, 15);
    axis(f, [[0, 'NOW'], [28, '1H'], [63, '2H', 'r']]);
  });
  panel('b-15min-2h-end', 'B 15 MIN / 2H END', (f) => {
    title(f, 'ENDS IN 60 MIN');
    bars(f, D15_2H.end, 0, 7, 24, 15);
    axis(f, [[0, 'NOW'], [28, '1H'], [63, '2H', 'r']]);
  });
  // 15-minute data, 12 bars over 3 hours, 4px wide.
  panel('c-15min-3h-begin', 'C 15 MIN / 3H', (f) => {
    title(f, 'RAIN IN 25 MIN');
    bars(f, D15_3H.begin, 2, 4, 24, 15);
    axis(f, [[2, 'NOW'], [22, '1H'], [42, '2H'], [63, '3H', 'r']]);
  });
  panel('d-15min-3h-end', 'D 15 MIN / 3H END', (f) => {
    title(f, 'ENDS IN 90 MIN');
    bars(f, D15_3H.end, 2, 4, 24, 15);
    axis(f, [[2, 'NOW'], [22, '1H'], [42, '2H'], [63, '3H', 'r']]);
  });
  // Hourly data (what the server fetches today), 6 bars over 6 hours, 9px wide.
  panel('e-hourly-begin', 'E HOURLY', (f) => {
    title(f, 'RAIN BY 4P');
    bars(f, D1H.begin, 2, 9, 24, 15);
    axis(f, [[2, 'NOW'], [32, '6P'], [62, '9P', 'r']]);
  });
  panel('f-hourly-end', 'F HOURLY END', (f) => {
    title(f, 'ENDS BY 6P');
    bars(f, D1H.end, 2, 9, 24, 15);
    axis(f, [[2, 'NOW'], [32, '6P'], [62, '9P', 'r']]);
  });
});

// ------------------------------------------------------------ 5-day, refined
// Variant A with five columns, dim H/L letters, and 2px between icon and high.
const FIVE = [...NEXT, ['WE', 48, 60, 'pcloudy_day']];
group('5day-final', (panel) => {
  panel('5day-final', 'A REFINED', (f) => {
    const x = f.text('5x7', String(NOWT), 0, 7, tempColor(NOWT));
    f.text('small', '°', x, 6, tempColor(NOWT));
    drawIcon(f, 'pcloudy_day', 22, 0);
    const LET = '#4a4a4a', NUM = '#b0b0b0';
    let hx = 63 - measure('small', 'H63 L49');
    hx = f.text('small', 'H', hx, 6, LET);
    hx = f.text('small', '63', hx, 6, NUM);
    hx = f.text('small', ' L', hx, 6, LET);
    f.text('small', '49', hx, 6, NUM);
    for (let i = 0; i < 4; i++) f.fill(i * 13 + 12, 10, 1, 22, C.divider);   // between days
    FIVE.forEach(([d, , h, icon], i) => {
      const cx = i * 13 + 6;
      ctext(f, 'small', d, cx, 15, C.grey);
      drawIcon(f, icon, cx - 4, 17);
      ctext(f, 'small', String(h), cx, 31, tempColor(h));
    });
  });
});

// ------------------------------------------------------------ rain with the top bar
// Same current-conditions bar as the 5-day screen; bars are flat colors (one
// per intensity level, no gradient inside a bar).
const LEVELS = [[0.4, '#1860b8'], [0.75, '#1e90ff'], [1.01, '#8fd8ff']];
const flatColor = (v) => LEVELS.find(([max]) => v < max)[1];
function topBar(f, temp, icon) {
  const x = f.text('5x7', String(temp), 0, 7, tempColor(temp));
  f.text('small', '°', x, 6, tempColor(temp));
  drawIcon(f, icon, 22, 0);
  let hx = 63 - measure('small', 'H63 L49');
  hx = f.text('small', 'H', hx, 6, '#4a4a4a');
  hx = f.text('small', '63', hx, 6, '#b0b0b0');
  hx = f.text('small', ' L', hx, 6, '#4a4a4a');
  f.text('small', '49', hx, 6, '#b0b0b0');
}
function flatBars(f, data, x0, w, base, max, single) {
  data.forEach((v, i) => {
    const x = x0 + i * (w + 1);
    if (!v) { f.fill(x, base, w, 1, '#0e1a2c'); return; }
    const h = Math.max(1, Math.round(v * max));
    f.fill(x, base - h + 1, w, h, single ? '#1e90ff' : flatColor(v));
  });
}
const BLUE_TXT = '#60b0ff';
const dropIcon = (f, x, y) => ['.#.', '###', '###', '.#.'].forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') px(f, x + i, y + j, C.blue); }));

group('rain-top', (panel) => {
  // Title at the bottom, tallest bars (rows 12-26).
  panel('a-bottom-levels', 'A LEVELS', (f) => {
    topBar(f, 57, 'pcloudy_day');
    flatBars(f, D15_2H.begin, 0, 7, 25, 14);
    dropIcon(f, 0, 27); f.text('small', 'RAIN IN 25 MIN', 6, 31, BLUE_TXT);
  });
  panel('b-bottom-single', 'B ONE BLUE', (f) => {
    topBar(f, 57, 'pcloudy_day');
    flatBars(f, D15_2H.begin, 0, 7, 25, 14, true);
    dropIcon(f, 0, 27); f.text('small', 'RAIN IN 25 MIN', 6, 31, BLUE_TXT);
  });
  // Title row under the top bar, shorter bars, time axis at the bottom.
  panel('c-title-row', 'C TITLE ROW', (f) => {
    topBar(f, 57, 'pcloudy_day');
    ctext(f, 'small', 'RAIN IN 25 MIN', 32, 15, BLUE_TXT);
    flatBars(f, D15_2H.begin, 0, 7, 25, 9);
    f.text('small', 'NOW', 0, 31, C.grey); ctext(f, 'small', '1H', 28, 31, C.dim); rtext(f, 'small', '2H', 63, 31, C.dim);
  });
  // Rain already falling: it ends.
  panel('d-ends-bottom', 'D ENDS', (f) => {
    topBar(f, 54, 'rain');
    flatBars(f, D15_2H.end, 0, 7, 25, 14);
    dropIcon(f, 0, 27); f.text('small', 'ENDS IN 60 MIN', 6, 31, BLUE_TXT);
  });
  panel('e-hourly', 'E HOURLY', (f) => {
    topBar(f, 57, 'pcloudy_day');
    flatBars(f, D1H.begin, 2, 9, 25, 14);
    dropIcon(f, 0, 27); f.text('small', 'RAIN BY 4P', 6, 31, BLUE_TXT);
  });
  panel('f-ends-title-row', 'F ENDS TITLE ROW', (f) => {
    topBar(f, 54, 'rain');
    ctext(f, 'small', 'ENDS IN 60 MIN', 32, 15, BLUE_TXT);
    flatBars(f, D15_2H.end, 0, 7, 25, 9);
    f.text('small', 'NOW', 0, 31, C.grey); ctext(f, 'small', '1H', 28, 31, C.dim); rtext(f, 'small', '2H', 63, 31, C.dim);
  });
});

// ------------------------------------------------------------ rain, title-row round 2
// Saturated hues only (no pale/near-white level) so the LEDs don't wash out.
const SCHEMES = {
  s1: ['#1a4dff', '#00d4ff', '#b040ff'],   // blue, cyan, violet
  s2: ['#1a4dff', '#8c3cff', '#ff2fd0'],   // blue, violet, magenta
  s3: ['#1a4dff', '#00d84a', '#ffd000'],   // blue, green, yellow
};
// 8 bars x 8px = the 2 hour timeline; 1H is the edge between bars 4 and 5 (x 32).
// Bars rise from row 25 (max 10 rows, to row 16) under the title on rows 10-14.
function rainBars(f, data, colors) {
  data.forEach((v, i) => {
    const x = i * 8;
    if (!v) { f.fill(x, 25, 7, 1, '#0e1a2c'); return; }
    const h = Math.max(1, Math.round(v * 10));
    f.fill(x, 25 - h + 1, 7, h, colors[v < 0.4 ? 0 : v < 0.75 ? 1 : 2]);
  });
}
function rainAxis(f) {
  px(f, 32, 26, C.dim); px(f, 63, 26, C.dim);
  ctext(f, 'small', '1H', 32, 31, C.dim);
  rtext(f, 'small', '2H', 63, 31, C.dim);
}
group('rain-top2', (panel) => {
  for (const [k, colors] of Object.entries(SCHEMES)) {
    panel(`c-${k}`, `C ${k.toUpperCase()}`, (f) => {
      topBar(f, 57, 'pcloudy_day');
      ctext(f, 'small', 'RAIN IN 25 MIN', 32, 14, BLUE_TXT);
      rainBars(f, D15_2H.begin, colors);
      rainAxis(f);
    });
    panel(`f-${k}`, `F ${k.toUpperCase()}`, (f) => {
      topBar(f, 54, 'rain');
      const text = 'ENDS IN 60 MIN', w = 3 + 2 + measure('small', text), x0 = Math.round(32 - w / 2);
      dropIcon(f, x0, 10);
      f.text('small', text, x0 + 5, 14, BLUE_TXT);
      rainBars(f, D15_2H.end, colors);
      rainAxis(f);
    });
  }
});

// ------------------------------------------------------------ rain, title row (final round)
// C and F refined: deeper blues (no pale shades, which wash out on the LEDs),
// title moved up a row, bars as tall as fit (rows 16-25), no NOW label, 1H
// centered on the gap between the 4th and 5th 15-minute bars (x 31).
const DEEP = [[0.4, '#0a2a78'], [0.75, '#0f48c0'], [1.01, '#1a6cff']];
const deepColor = (v) => DEEP.find(([max]) => v < max)[1];
function deepBars(f, data) {
  data.forEach((v, i) => {
    const x = i * 8;
    if (!v) { f.fill(x, 25, 7, 1, '#081428'); return; }
    const h = Math.max(1, Math.round(v * 10));
    f.fill(x, 26 - h, 7, h, deepColor(v));
  });
}
function axis2(f) {
  ctext(f, 'small', '1H', 31, 31, C.dim);
  rtext(f, 'small', '2H', 63, 31, C.dim);
}
group('rain-final', (panel) => {
  panel('c-begins', 'C BEGINS', (f) => {
    topBar(f, 57, 'pcloudy_day');
    ctext(f, 'small', 'RAIN IN 25 MIN', 32, 14, BLUE_TXT);
    deepBars(f, D15_2H.begin);
    axis2(f);
  });
  panel('f-ends', 'F ENDS', (f) => {
    topBar(f, 54, 'rain');
    const t = 'ENDS IN 60 MIN', w = measure('small', t) + 5, x = Math.round(32 - w / 2);
    dropIcon(f, x, 10);
    f.text('small', t, x + 5, 14, BLUE_TXT);
    deepBars(f, D15_2H.end);
    axis2(f);
  });
});
