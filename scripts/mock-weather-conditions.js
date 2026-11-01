#!/usr/bin/env node
'use strict';
// Concept mockups for the weather screen's current-conditions layout (Nov 2026).
// Not implemented; made-up data. Five concepts x six weather states, pixel-exact
// 64x32 frames with the board fonts and icons. Writes
// docs/board/mockups/weather/conditions/<concept>-<state>.png and sheet.png.
// Usage: node scripts/mock-weather-conditions.js [outDir]

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');
const icons = require('../server/board/icons');
const G = require('../server/board/glyphs');

const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'conditions');
fs.mkdirSync(OUT, { recursive: true });

// ---------- color helpers ----------
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
// draw.js TEMP_STOPS (°F).
const TEMP = [[-10, '#3050ff'], [20, '#40a0ff'], [40, '#30d0d0'], [55, '#40d040'], [70, '#ffd000'], [85, '#ff8000'], [100, '#ff2020']];
const tempColor = (t) => ramp(TEMP, t);

// draw.js palette.
const C = {
  label: '#d8d8d8', grey: '#8f8f8f', dimHead: '#555555', divider: '#333333', white: '#ffffff', blue: '#1e90ff',
  watch: '#ffd800', severe: '#ff8000', tornado: '#ff2020', arrow: '#4a4a4a',
};

// ---------- drawing helpers ----------
const px = (f, x, y, c) => { if (x >= 0 && x < 64 && y >= 0 && y < 32) f.fill(x, y, 1, 1, c); };
const s = (cp) => String.fromCodePoint(cp);
const text = (f, font, str, x, base, c) => f.text(font, str, x, base, c);
const rtext = (f, font, str, right, base, c) => f.text(font, str, right - measure(font, str) + 1, base, c);
const ctext = (f, font, str, cx, base, c) => f.text(font, str, Math.round(cx - (measure(font, str) + 1) / 2), base, c);
const sprite = (f, rows, x, y, c) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') px(f, x + i, y + j, typeof c === 'string' ? c : c[ch]); }));
function drawIcon8(f, name, x, y) {
  icons.ICONS[name].forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') px(f, x + i, y + j, icons.PALETTE[ch]); }));
}
const DROP = ['.#.', '###', '###', '.#.'];
const RING = ['###', '#.#', '###'];

// Big temperature in the 9x15 Bold digits: ink rows base-10..base-1, a 5x2
// minus bar, the 3x3 ring degree 1px after the digits. Returns the right edge.
function bigTempWidth(t) { return (t < 0 ? 7 : 0) + measure('clock', String(Math.abs(t))) + 1 + 3; }
function bigTemp(f, t, x, base, c) {
  if (t < 0) { f.fill(x, base - 6, 5, 2, c); x += 7; }
  x = f.text('clock', String(Math.abs(t)), x, base, c);
  sprite(f, RING, x, base - 10, c);
  return x + 2;
}
// 5x7 temperature with the small font's degree sign (as on the top bar).
function midTemp(f, t, x, base, c) {
  const nx = f.text('5x7', String(t), x, base, c);
  f.text('small', '°', nx, base - 1, c);
  return nx + 2;
}
const midTempWidth = (t) => measure('5x7', String(t)) + 1 + 2;

// `↑63 ↓49` in the small font: dim arrows, grey numbers. Returns its width.
function hiLo(f, hi, lo, x, base, draw = true) {
  const parts = [[s(G.UP), C.arrow], [String(hi), C.grey], [' ' + s(G.DOWN), C.arrow], [String(lo), C.grey]];
  let cx = x;
  for (const [t, c] of parts) cx = draw ? f.text('small', t, cx, base, c) : cx + measure('small', t) + 1;
  return cx - x - 1;
}
// Drop + "20%" right-aligned to `right`; returns its left edge.
function pop(f, p, right, base, c = C.label) {
  const t = `${p}%`;
  const x = right - measure('small', t) + 1;
  f.text('small', t, x, base, c);
  sprite(f, DROP, x - 5, base - 4, C.blue);
  return x - 5;
}
// NWS watch/warning: glyph + word in the warning color (tornado warning blinks;
// shown on its lit phase).
function warnParts(w) {
  const glyph = s(w.kind === 'tor' ? G.FUNNEL : G.BOLT);
  const color = w.lvl === 'watch' ? C.watch : w.kind === 'tor' ? C.tornado : C.severe;
  return { glyph, color };
}
function warnTag(f, w, x, base, long) {
  const { glyph, color } = warnParts(w);
  const word = long
    ? { svr: { watch: 'TSTORM WATCH', warning: 'TSTORM WARNING' }, tor: { watch: 'TORNADO WATCH', warning: 'TORNADO WARN' } }[w.kind][w.lvl]
    : (w.lvl === 'warning' ? 'WARN' : 'WATCH');
  const gx = f.text('small', glyph, x, base, color);
  return f.text('small', word, gx + 2, base, color);
}
function warnWidth(w, long) {
  const { glyph } = warnParts(w);
  const word = long
    ? { svr: { watch: 'TSTORM WATCH', warning: 'TSTORM WARNING' }, tor: { watch: 'TORNADO WATCH', warning: 'TORNADO WARN' } }[w.kind][w.lvl]
    : (w.lvl === 'warning' ? 'WARN' : 'WATCH');
  return measure('small', glyph) + 3 + measure('small', word);
}
// Feels-like only when it differs enough to matter (proposed rule: 3°F).
const showFeels = (w) => w.feels != null && Math.abs(w.feels - w.temp) >= 3;

// ---------- large icons (procedural, ~18 x 16) ----------
// Each is drawn into a box at (ox, oy); shapes are sampled at pixel centers.
const BIG = {
  sun: '#ffc800', sunCore: '#ffe060', moon: '#ffe47a',
  cloud: '#d0d0d0', under: '#7c7c7c', storm: '#8a8a8a', stormUnder: '#545454',
  rain: '#1e88ff', rainDim: '#0e4ca0', snow: '#d0f0ff', bolt: '#ffe000',
};
const inCircle = (x, y, cx, cy, r) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
function bigSun(f, ox, oy, cx = 9, cy = 8, r = 4.2) {
  for (let y = -2; y < 18; y++) for (let x = -2; x < 20; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d <= r) px(f, ox + x, oy + y, d <= r - 1.6 ? BIG.sunCore : BIG.sun);
  }
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    for (const rr of [r + 2, r + 3]) px(f, ox + Math.floor(cx + rr * Math.cos(a)), oy + Math.floor(cy + rr * Math.sin(a)), BIG.sun);
  }
}
function bigMoon(f, ox, oy, cx = 9, cy = 8, r = 6) {
  for (let y = 0; y < 17; y++) for (let x = 0; x < 18; x++) {
    if (inCircle(x, y, cx, cy, r) && !inCircle(x, y, cx + 3.2, cy - 2.2, r - 0.6)) px(f, ox + x, oy + y, BIG.moon);
  }
}
// Cloud: union of circles over a flat base; light top, darker underside rows.
function bigCloud(f, ox, oy, dark, opts = {}) {
  const { dx = 0, dy = 0, scale = 1 } = opts;
  const circles = [[5, 10, 3.6], [9.5, 7.5, 4.8], [14, 10, 3.4]].map(([x, y, r]) => [x * scale + dx, y * scale + dy, r * scale]);
  const base = 13.5 * scale + dy;
  const top = dark ? BIG.storm : BIG.cloud, under = dark ? BIG.stormUnder : BIG.under;
  for (let y = 0; y < 18; y++) for (let x = 0; x < 20; x++) {
    if (y + 0.5 > base) continue;
    if (!circles.some(([cx, cy, r]) => inCircle(x, y, cx, cy, r)) && !(y + 0.5 > 9.5 * scale + dy && x + 0.5 > 5 * scale + dx && x + 0.5 < 14 * scale + dx)) continue;
    px(f, ox + x, oy + y, y + 0.5 > base - 2 ? under : top);
  }
}
function bigIcon(f, kind, ox, oy) {
  switch (kind) {
    case 'sun': bigSun(f, ox, oy); break;
    case 'moon': bigMoon(f, ox, oy); break;
    case 'pcloudy_day': bigSun(f, ox, oy, 6, 6, 3.6); bigCloud(f, ox, oy, false, { dx: 1, dy: 2 }); break;
    case 'pcloudy_night': bigMoon(f, ox - 2, oy - 2, 8, 7, 5); bigCloud(f, ox, oy, false, { dx: 1, dy: 2 }); break;
    case 'cloudy': bigCloud(f, ox, oy, false, { dy: 1 }); break;
    case 'rain':
      bigCloud(f, ox, oy, true, { dy: -2 });
      [[4, 13], [8, 12], [12, 13], [16, 12], [6, 15], [14, 15]].forEach(([x, y]) => { px(f, ox + x, oy + y, BIG.rain); px(f, ox + x - 1, oy + y + 1, BIG.rainDim); });
      break;
    case 'snow':
      bigCloud(f, ox, oy, false, { dy: -2 });
      [[4, 13], [9, 12], [14, 13], [6, 15], [12, 15], [17, 15]].forEach(([x, y]) => px(f, ox + x, oy + y, BIG.snow));
      break;
    case 'storm':
      bigCloud(f, ox, oy, true, { dy: -2 });
      sprite(f, ['..##', '.##.', '####', '.##.', '##..', '#...'], ox + 8, oy + 10, BIG.bolt);
      [[4, 13], [15, 12]].forEach(([x, y]) => { px(f, ox + x, oy + y, BIG.rain); px(f, ox + x - 1, oy + y + 1, BIG.rainDim); });
      break;
    default: bigCloud(f, ox, oy, false);
  }
}

// ---------- weather states (made up) ----------
const STATES = [
  { id: 'a-ptcloudy', title: '57 PT CLOUDY', temp: 57, icon: 'pcloudy_day', word: 'PT CLOUDY', mixed: 'Partly cloudy', feels: 55, wind: 'NW 12', hi: 63, lo: 49, pop: 20, tod: 'day',
    hours: [57, 59, 61, 62, 63, 62, 60, 57, 55, 53, 52, 51, 50], pops: [0, 0, 10, 10, 20, 20, 10, 0, 0, 0, 0, 0, 0], hr0: 13 },
  { id: 'b-rain', title: '41 RAIN, WIND CHILL', temp: 41, icon: 'rain', word: 'RAIN', mixed: 'Rain', feels: 34, wind: 'E 18', hi: 44, lo: 38, pop: 90, tod: 'rain',
    hours: [41, 41, 42, 43, 44, 43, 42, 41, 40, 39, 39, 38, 38], pops: [90, 90, 80, 80, 70, 60, 60, 40, 30, 20, 20, 10, 10], hr0: 10 },
  { id: 'c-night', title: '72 CLEAR NIGHT', temp: 72, icon: 'moon', word: 'CLEAR', mixed: 'Clear', feels: 72, wind: 'S 5', hi: 84, lo: 68, pop: 0, tod: 'night',
    hours: [72, 71, 70, 69, 69, 68, 68, 69, 72, 75, 78, 81, 83], pops: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 10, 20], hr0: 22 },
  { id: 'd-cold', title: '-12 SNOW', temp: -12, icon: 'snow', word: 'SNOW', mixed: 'Snow', feels: -27, wind: 'NW 22', hi: -5, lo: -14, pop: 60, tod: 'snow',
    hours: [-12, -10, -8, -6, -5, -6, -8, -10, -11, -12, -13, -14, -14], pops: [60, 60, 50, 40, 40, 30, 30, 20, 20, 10, 10, 10, 10], hr0: 9 },
  { id: 'e-hot', title: '101 SUNNY', temp: 101, icon: 'sun', word: 'SUNNY', mixed: 'Sunny', feels: 108, wind: 'SW 9', hi: 103, lo: 82, pop: 0, tod: 'day',
    hours: [101, 102, 103, 103, 101, 98, 94, 91, 88, 86, 85, 84, 83], pops: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], hr0: 14 },
  { id: 'f-warning', title: '84 TORNADO WARNING', temp: 84, icon: 'storm', word: 'STORMS', mixed: 'Storms', feels: 91, wind: 'SW 31', hi: 89, lo: 70, pop: 80, tod: 'storm',
    warn: { kind: 'tor', lvl: 'warning' },
    hours: [84, 79, 76, 75, 74, 73, 72, 72, 71, 71, 70, 70, 70], pops: [80, 80, 70, 50, 40, 20, 10, 10, 0, 0, 0, 0, 0], hr0: 17 },
];
const hourLabel = (h) => { h = ((h % 24) + 24) % 24; return h === 0 ? '12A' : h === 12 ? '12P' : h < 12 ? `${h}A` : `${h - 12}P`; };

// ---------- concepts ----------
const CONCEPTS = [];
const concept = (id, title, note, fn) => CONCEPTS.push({ id, title, note, fn });

// A. Hero icon: a large icon on the left with the big temperature beside it,
// the condition word under the temperature, and one line below: high/low left,
// rain chance (or feels-like) right. No divider, three grey lines fewer.
concept('A', 'A  HERO ICON', 'Large 18px icon + big temp; word (or feels-like) under it; one H/L + rain line', (f, w) => {
  bigIcon(f, w.icon, 0, 0);
  // Temperature centered in x 20-63, ink rows 2-11.
  const tw = bigTempWidth(w.temp);
  bigTemp(f, w.temp, Math.min(63 - tw + 1, Math.round(42 - tw / 2)), 12, C.label);
  // The icon already names the condition, so feels-like takes the word's
  // place when it differs enough to matter.
  if (showFeels(w)) ctext(f, 'small', `FEELS ${w.feels}°`, 42, 19, C.grey);
  else ctext(f, 'small', w.word, 42, 19, C.grey);
  if (w.warn) {
    const ww = warnWidth(w.warn, true);
    warnTag(f, w.warn, Math.round(32 - ww / 2), 31, true);
    return;
  }
  hiLo(f, w.hi, w.lo, 0, 31);
  if (w.pop) pop(f, w.pop, 63, 31);
  else rtext(f, 'small', w.wind, 63, 31, C.grey);
});

// B. Day range: temperature colored by how warm it is, the icon top right, and
// the day as a low-to-high bar with a marker for now (white) and feels-like
// (dim). Low and high under the bar's ends, rain chance between them.
concept('B', 'B  DAY RANGE', 'Temp in its temperature color; low→high bar with now + feels markers', (f, w) => {
  bigTemp(f, w.temp, 0, 12, tempColor(w.temp));
  drawIcon8(f, w.icon, 55, 1);
  rtext(f, 'small', w.word, 63, 15, C.grey);
  const lo = Math.min(w.lo, w.temp, showFeels(w) ? w.feels : w.temp), hi = Math.max(w.hi, w.temp, showFeels(w) ? w.feels : w.temp);
  const x0 = 1, x1 = 62;
  const xOf = (t) => Math.round(x0 + (t - lo) / Math.max(1, hi - lo) * (x1 - x0));
  // Track (dim) over the full scale, the forecast low..high in its colors.
  f.fill(x0, 22, x1 - x0 + 1, 1, '#1c1c1c');
  for (let x = xOf(w.lo); x <= xOf(w.hi); x++) f.fill(x, 21, 1, 3, dim(tempColor(lo + (x - x0) / (x1 - x0) * (hi - lo)), 0.7));
  if (showFeels(w)) { const fx = xOf(w.feels); f.fill(fx, 20, 1, 5, C.dimHead); }
  const nx = xOf(w.temp);
  f.fill(nx, 19, 1, 7, C.white);
  if (w.warn) {
    const ww = warnWidth(w.warn, true);
    warnTag(f, w.warn, Math.round(32 - ww / 2), 31, true);
    return;
  }
  text(f, 'small', String(w.lo), 0, 31, C.grey);
  rtext(f, 'small', String(w.hi), 63, 31, C.grey);
  if (w.pop) {
    const t = `${w.pop}%`;
    const wd = 5 + measure('small', t);
    pop(f, w.pop, Math.round(32 + wd / 2), 31);
  } else ctext(f, 'small', w.wind, 32, 31, C.dimHead);
});

// C. Sky window: the left 24 columns are a small scene of the sky (time of day
// and conditions: blue day, dark night, grey rain, snow) with a large sun,
// moon or clouds; the numbers stack on the right.
const SKY = {
  day: [[0, '#0a2050'], [31, '#1a4a8a']],
  night: [[0, '#000006'], [31, '#0a1430']],
  rain: [[0, '#1a1d22'], [31, '#0c0f14']],
  snow: [[0, '#2a2e36'], [31, '#181c24']],
  storm: [[0, '#14121c'], [31, '#0a0a10']],
};
concept('C', 'C  SKY WINDOW', 'Left panel is a little sky scene; numbers stacked right', (f, w) => {
  const W = 24;
  const sky = SKY[w.tod] || SKY.day;
  for (let y = 0; y < 32; y++) f.fill(0, y, W, 1, ramp(sky, y));
  // Scene: stars at night, then the big icon, then falling rain or snow below it.
  if (w.tod === 'night') [[2, 3], [19, 2], [5, 22], [16, 26], [21, 18], [3, 13], [11, 29]].forEach(([x, y], i) => px(f, x, y, i % 3 ? '#606878' : '#c0c8d8'));
  bigIcon(f, w.icon, 3, 4);
  let sd = 11;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  if (w.tod === 'rain' || w.tod === 'storm') for (let i = 0; i < 14; i++) { const x = 1 + Math.floor(rnd() * (W - 1)), y = 21 + Math.floor(rnd() * 10); px(f, x, y, '#2a6ad0'); px(f, x - 1, y + 1, '#163a70'); }
  if (w.tod === 'snow') for (let i = 0; i < 12; i++) px(f, Math.floor(rnd() * W), 21 + Math.floor(rnd() * 11), '#c0e0f0');
  // Right stack: big temperature, word, H/L, feels or rain.
  const tx = 26;
  const tw = bigTempWidth(w.temp);
  bigTemp(f, w.temp, Math.max(tx, 63 - tw + 1 - Math.max(0, Math.floor((63 - tx + 1 - tw) / 2))), 12, C.label);
  rtext(f, 'small', w.word, 63, 19, C.grey);
  if (w.warn) {
    const { glyph, color } = warnParts(w.warn);
    rtext(f, 'small', w.warn.kind === 'tor' ? 'TORNADO' : 'TSTORM', 63, 25, color);
    const word = w.warn.lvl === 'warning' ? 'WARNING' : 'WATCH';
    const x = rtext(f, 'small', word, 63, 31, color);
    f.text('small', glyph, 63 - measure('small', word) - 2 - measure('small', glyph), 31, color);
    return;
  }
  const hw = hiLo(f, w.hi, w.lo, 0, 25, false);
  hiLo(f, w.hi, w.lo, 63 - hw, 25);
  if (showFeels(w)) rtext(f, 'small', `FEELS ${w.feels}°`, 63, 31, C.grey);
  else if (w.pop) pop(f, w.pop, 63, 31);
  else rtext(f, 'small', w.wind, 63, 31, C.grey);
});

// D. Next 12 hours: a compact top bar (icon, temperature, word) over the
// temperature line for the next 12 hours, colored by temperature, with the
// peak and low labeled on the curve and rain chance as blue ticks under it.
concept('D', 'D  NEXT 12 HOURS', 'Top bar + temperature curve, extremes labeled, rain as blue ticks', (f, w) => {
  drawIcon8(f, w.icon, 0, 0);
  midTemp(f, w.temp, 10, 7, C.label);
  if (w.warn) {
    const ww = warnWidth(w.warn, false);
    warnTag(f, w.warn, 63 - ww + 1, 7, false);
  } else rtext(f, 'small', w.word, 63, 7, C.grey);
  const hs = w.hours;
  const lo = Math.min(...hs), hi = Math.max(...hs);
  const top = 14, bot = 23;                     // curve rows
  const xOf = (i) => Math.round(i * 63 / (hs.length - 1));
  const yOf = (t) => Math.round(bot - (t - lo) / Math.max(1, hi - lo) * (bot - top));
  // Area under the curve, faint; the curve on top.
  let prev = null;
  for (let x = 0; x < 64; x++) {
    const k = x / 63 * (hs.length - 1), i = Math.min(hs.length - 2, Math.floor(k));
    const t = hs[i] + (hs[i + 1] - hs[i]) * (k - i);
    const y = Math.round(bot - (t - lo) / Math.max(1, hi - lo) * (bot - top));
    const c = tempColor(t);
    for (let yy = y + 1; yy <= bot; yy++) px(f, x, yy, dim(c, 0.18));
    const y0 = prev == null ? y : prev;
    for (let yy = Math.min(y, y0); yy <= Math.max(y, y0); yy++) px(f, x, yy, c);
    prev = y;
  }
  // Rain chance: one tick per hour on row 25, brightness by chance.
  hs.forEach((_, i) => { const p = w.pops[i]; if (p >= 10) f.fill(Math.max(0, xOf(i) - 1), 25, 3, 1, dim(C.blue, 0.25 + 0.75 * p / 100)); });
  // Extremes: label the first peak and first low after now (skip if at now).
  const label = (i, above) => {
    const t = String(hs[i]), x = Math.max(0, Math.min(63 - measure('small', t) + 1, xOf(i) - Math.floor(measure('small', t) / 2)));
    const y = yOf(hs[i]);
    f.text('small', t, x, above ? y - 1 : Math.min(31, y + 7), C.label);
  };
  const iHi = hs.indexOf(hi), iLo = hs.indexOf(lo);
  if (iHi > 1) label(iHi, true);
  if (iLo > 1 && Math.abs(iLo - iHi) > 2) label(iLo, true);
  // Now marker and time labels.
  text(f, 'small', 'NOW', 0, 31, C.grey);
  ctext(f, 'small', hourLabel(w.hr0 + 6), 32, 31, C.dimHead);
  rtext(f, 'small', hourLabel(w.hr0 + 12), 63, 31, C.dimHead);
});

// E. Words: no icon. The temperature large, then the condition as a 5x7 word
// in mixed case (like the ticker), and one plain line of what matters next.
concept('E', 'E  WORDS', 'No icon: big temp, condition in 5x7 mixed case, one plain line', (f, w) => {
  const tc = tempColor(w.temp);
  bigTemp(f, w.temp, 0, 12, C.label);
  // Right block: the condition, colored by kind, and feels-like under it.
  const kindColor = { rain: '#4aa0ff', snow: '#c8e8ff', storm: '#ffd040', moon: '#ffe47a', sun: '#ffc800' }[w.icon] || C.label;
  let word = w.mixed;
  const tw = bigTempWidth(w.temp);
  const room = 63 - (tw + 3) + 1;
  if (measure('5x7', word) > room) word = { 'Partly cloudy': 'Pt cloudy' }[word] || word;
  rtext(f, '5x7', word, 63, 7, kindColor);
  if (showFeels(w)) rtext(f, 'small', `FEELS ${w.feels}°`, 63, 14, C.grey);
  else rtext(f, 'small', w.wind, 63, 14, C.grey);
  f.fill(0, 17, 64, 1, C.divider);
  if (w.warn) {
    const { glyph, color } = warnParts(w.warn);
    const t = w.warn.kind === 'tor' ? 'Tornado warn' : 'Storm warn';
    const gw = measure('small', glyph);
    const tw2 = measure('5x7', t);
    const x = Math.round(32 - (gw + 3 + tw2) / 2);
    f.text('small', glyph, x, 27, color);
    f.text('5x7', t, x + gw + 3, 28, color);
    return;
  }
  // Line: "High 63 · Low 49" in 5x7, or rain when likely.
  const line = w.pop >= 50 ? `Rain ${w.pop}%` : null;
  if (line && w.icon !== 'rain' && w.icon !== 'snow') {
    sprite(f, DROP, 0, 21, C.blue);
    f.text('5x7', line.replace('Rain ', ''), 5, 28, C.label);
  }
  const hl = `${w.hi}° / ${w.lo}°`;
  const hlx = 63 - measure('5x7', hl.replace(/°/g, '')) - 3;
  // High in its color, low in its color, small degree signs.
  let x = (line && w.icon !== 'rain' && w.icon !== 'snow') ? 32 : 0;
  x = midTemp(f, w.hi, x, 28, tempColor(w.hi));
  x = f.text('5x7', '/', x + 2, 28, C.dimHead);
  midTemp(f, w.lo, x + 2, 28, tempColor(w.lo));
  if (!(line && w.icon !== 'rain' && w.icon !== 'snow')) {
    if (w.pop) pop(f, w.pop, 63, 28);
    else rtext(f, 'small', w.wind, 63, 28, C.grey);
  }
  void tc; void hlx;
});

// ---------- the current layout, for comparison ----------
const render = require('../server/board/render');
function current(w) {
  const p = { now: 1762000000, warn: w.warn, radar: { frames: [], wx: { temp: w.temp, icon: w.icon, word: w.word, feels: w.feels, wind: w.wind, hi: w.hi, lo: w.lo, pop: w.pop } } };
  return render.renderWeather(p, { blink: false });
}

// ---------- output ----------
const frames = [];
const ROWS = [{ id: 'now', title: 'CURRENT', fn: null }, ...CONCEPTS];
for (const c of ROWS) {
  const row = [];
  for (const w of STATES) {
    let f;
    if (c.fn) { f = new Frame(); c.fn(f, w); } else f = current(w);
    if (c.fn) fs.writeFileSync(path.join(OUT, `${c.id}-${w.id}.png`), f.toPNG(10));
    row.push(f);
  }
  frames.push(row);
}

// Contact sheet: rows = concepts, columns = states, each frame at scale 5.
const SC = 5, GAP = 12, LBL = 0;
const fw = 64 * SC, fh = 32 * SC;
const sheet = new PNG({ width: STATES.length * (fw + GAP) + GAP, height: ROWS.length * (fh + GAP) + GAP });
sheet.data.fill(24);
for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;
frames.forEach((row, r) => row.forEach((f, c) => {
  const img = PNG.sync.read(f.toPNG(SC));
  const ox = GAP + c * (fw + GAP), oy = GAP + r * (fh + GAP) + LBL;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const si = (y * fw + x) * 4, di = ((oy + y) * sheet.width + ox + x) * 4;
    for (let k = 0; k < 4; k++) sheet.data[di + k] = img.data[si + k];
  }
}));
fs.writeFileSync(path.join(OUT, 'sheet.png'), PNG.sync.write(sheet));
module.exports = { STATES, CONCEPTS };
console.log(`wrote ${OUT}`);
