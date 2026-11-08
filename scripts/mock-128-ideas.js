#!/usr/bin/env node
'use strict';
// New-screen ideas for the 128x32 board (Nov 8, 2026). Not in draw.js; every
// value is made up. node scripts/mock-128-ideas.js -> docs/board/mockups/w128-ideas/

const fs = require('fs');
const path = require('path');
const B = path.join(__dirname, '..', 'server', 'board');
const { Frame } = require(path.join(B, 'raster'));
const { packFonts } = require(path.join(B, 'fonts'));
const draw = require(path.join(B, 'render'));
const icons = require(path.join(B, 'icons'));
const G = require(path.join(B, 'glyphs'));

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'w128-ideas');
const F = packFonts();
const W = 128, H = 32;
const { LINE } = draw;
const C = draw.C;
const s = (cp) => String.fromCodePoint(cp);
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const scale = (c, k) => toHex(hex(c).map((v) => v * k));
const lerp = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const measure = (font, str) => { let w = 0; for (const ch of str) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; } return w > 0 ? w - 1 : 0; };
const rtext = (f, font, str, x1, base, col) => f.text(font, str, x1 - measure(font, str), base, col);
const ctext = (f, font, str, cx, base, col) => f.text(font, str, Math.round(cx - measure(font, str) / 2), base, col);
const px = (f, x, y, c) => f.set(x, y, hex(c));
const icon = (f, name, x, y) => icons.ICONS[name].forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') f.set(x + i, y + j, hex(icons.PALETTE[c])); }));
const ring = (f, x, y, c) => { for (const [i, j] of [[1, 0], [0, 1], [2, 1], [1, 2]]) px(f, x + i, y + j, c); };
function times(f, ts, x1, base, end, gap = 3) {
  let keep = ts.map(String);
  const width = (a) => a.reduce((w, t) => w + measure('small', t), 0) + gap * (a.length - 1);
  while (keep.length > 1 && x1 - width(keep) < end + 3) keep = keep.slice(0, -1);
  let x = x1;
  for (let i = keep.length - 1; i >= 0; i--) { const w = measure('small', keep[i]); f.text('small', keep[i], x - w, base, i === 0 ? C.amber : C.dimAmber); x -= w + gap + 1; }
}

// ---------------- Transit ----------------

const RED = ['HOWARD', 'JARVIS', 'MORSE', 'LOYOLA', 'GRANVILLE', 'THORNDALE', 'BRYN MAWR', 'BERWYN', 'ARGYLE', 'LAWRENCE', 'WILSON',
  'SHERIDAN', 'ADDISON', 'BELMONT', 'FULLERTON', 'NORTH/CLYBOURN', 'CLARK/DIVISION', 'CHICAGO', 'GRAND', 'LAKE', 'MONROE', 'JACKSON',
  'HARRISON', 'ROOSEVELT', 'CERMAK', '35TH', '47TH', 'GARFIELD', '63RD', '69TH', '79TH', '87TH', '95TH'];

// The whole Red Line, live train positions (Train Tracker "Locations").
function lineStrip() {
  const f = new Frame(W, H);
  const n = RED.length;
  const xs = (i) => Math.round(2 + i * 123 / (n - 1));
  const TY = 15, ME = 2;
  for (let x = xs(0); x <= xs(n - 1); x++) px(f, x, TY, scale(LINE.RD, 0.35));
  RED.forEach((_, i) => { px(f, xs(i), TY, LINE.RD); });
  for (let y = 13; y <= 17; y++) px(f, xs(ME), y, C.white);
  f.text('small', 'HOWARD', 0, 6, C.dimHead);
  rtext(f, 'small', '95TH', 127, 6, C.dimHead);
  const lx0 = xs(19), lx1 = xs(23);
  ctext(f, 'small', 'LOOP', (lx0 + lx1) / 2, 6, C.dimHead);
  for (let x = lx0; x <= lx1; x++) px(f, x, 8, '#333333');
  // Trains as arrowheads: northbound above the track pointing left, southbound below pointing right.
  const arrow = (x, y, dir, c) => { const cols = dir < 0 ? [[1], [0, 1, 2], [0, 1, 2]] : [[0, 1, 2], [0, 1, 2], [1]];
    cols.forEach((rows, i) => rows.forEach((j) => px(f, x - 1 + i, y + j, c))); };
  const T = '#9a9a9a';
  [[4.6, C.amber], [9.3, T], [14.5, T], [19.8, T], [25.2, T], [29.6, T]].forEach(([p, c]) => arrow(Math.round(2 + p * 123 / (n - 1)), 10, -1, c));
  [[0, C.sch], [1.3, C.amber], [6.5, T], [12.0, T], [17.3, T], [22.8, T], [27.1, T], [31.4, T]].forEach(([p, c]) => arrow(Math.round(2 + p * 123 / (n - 1)), 18, 1, c));
  let x = f.text('small', 'MORSE', 0, 31, C.label) + 4;
  x = f.text('small', s(G.UP), x, 31, C.dimHead) + 2;
  x = f.text('small', '4m', x, 31, C.amber) + 3;
  x = f.text('small', '12m', x, 31, C.dimAmber) + 6;
  x = f.text('small', s(G.DOWN), x, 31, C.dimHead) + 2;
  x = f.text('small', '2m', x, 31, C.amber) + 3;
  f.text('small', '11m', x, 31, C.dimAmber);
  rtext(f, 'small', '11:16', 127, 31, C.dimHead);
  return f;
}

// The next hour as a timeline: one lane per destination, ticks at arrival minutes.
function timeline() {
  const f = new Frame(W, H);
  const X0 = 34, K = 1.5, WALK = 6;
  const xm = (m) => X0 + Math.round(m * K);
  for (let y = 0; y < 25; y++) for (let x = xm(0); x < xm(WALK); x++) px(f, x, y, '#141414');
  for (let m = 10; m <= 60; m += 10) for (let y = 0; y < 25; y += 2) px(f, xm(m), y, '#1e1e1e');
  const lanes = [['RD', 'HOWARD', [3, 9, 15, 22, 30, 38, 46, 55]], ['RD', '95TH', [5, 12, 20, 27, 35, 44, 52]],
    ['BR', 'KIMBALL', [8, 17, 26, 36, 47, 58]], ['BR', 'LOOP', [2, 11, 21, 31, 41, 52]]];
  lanes.forEach(([ln, lbl, ts], i) => {
    const top = 1 + i * 6;
    f.fill(0, top, 3, 5, LINE[ln]);
    f.text('small', lbl, 5, top + 5, C.label);
    let first = true;
    for (const m of ts) {
      const c = m < WALK ? '#2a1d00' : first ? C.amber : C.dimAmber;
      if (m >= WALK) first = false;
      f.fill(xm(m), top, 2, 5, c);
    }
  });
  for (let m = 0; m <= 60; m += 10) px(f, xm(m), 25, C.dimHead);
  [10, 20, 30, 40].forEach((m) => ctext(f, 'small', String(m), xm(m), 31, C.dimHead));
  rtext(f, 'small', '60m', 127, 31, C.dimHead);
  f.text('small', 'WALK 6m', 0, 31, C.grey);
  return f;
}

// Trains | buses at one stop: the split, with halves that mean something.
function trainsBuses() {
  const f = new Frame(W, H);
  const halves = [[0, 61, 'TRAINS', [[LINE.RD, 'HOWARD', [4, 12, 19]], [LINE.RD, '95TH', [2, 11, 24]]]],
    [66, 127, 'BUSES', [['#8a8a8a', '96 LUNT', [6, 21, 36]], ['#8a8a8a', '155 DEVON', [9, 29]]]]];
  for (const [x0, x1, label, rows] of halves) {
    f.text('small', label, x0, 6, C.head);
    rows.forEach(([col, lbl, ts], i) => {
      const top = 10 + i * 8;
      f.fill(x0, top, 3, 5, col);
      const end = f.text('small', lbl, x0 + 5, top + 5, C.label) - 1;
      times(f, ts, x1, top + 5, end);
    });
  }
  f.text('small', 'MORSE', 0, 31, C.dimHead);
  rtext(f, 'small', '11:16', 127, 31, C.dimHead);
  return f;
}

// Split-flap departures (Solari): 5x7 on flaps, the hinge between glyph rows 4 and 5.
function solari() {
  const f = new Frame(W, H);
  const TOP = '#262626', BOT = '#1c1c1c', INK = '#e6e6e6';
  const tile = (x, y, ch, top = TOP, bot = BOT) => {
    f.fill(x, y, 5, 5, top); f.fill(x, y + 6, 5, 4, bot);
    if (!ch || ch === ' ') return;
    const g = F['5x7'][ch.codePointAt(0)];
    if (!g) return;
    const [, w, h, xo, yo] = g;
    const ox = x + Math.floor((5 - w) / 2);
    const top7 = 7 - (yo + h) - 1; // glyph row index of its first bitmap row within the 7-row cell (baseline at row 7)
    for (let r = 0; r < h; r++) {
      const gr = top7 + r + 1; // 0..6 (descenders ignored)
      const bits = g[5 + r];
      const yy = y + 1 + gr + (gr >= 4 ? 1 : 0);
      for (let c = 0; c < w; c++) if ((bits >> (w - 1 - c)) & 1) px(f, ox + c, yy, INK);
    }
  };
  const rows = [['RD', 'HOWARD', '4m'], ['BR', 'KIMBALL', '7m'], ['RD', '95TH/DAN RYAN', '9m']];
  rows.forEach(([ln, dest, t], r) => {
    const y = r * 11;
    for (let i = 0; i < 21; i++) {
      const x = 1 + i * 6;
      if (i === 0) { tile(x, y, null, scale(LINE[ln], 0.6), scale(LINE[ln], 0.45)); continue; }
      let ch = ' ';
      if (i >= 2 && i <= 14) ch = dest[i - 2] || ' ';
      if (i >= 18) ch = t.padStart(3, ' ')[i - 18];
      tile(x, y, ch);
    }
  });
  return f;
}

// ---------------- Weather ----------------

// Lake Michigan: water temperature, waves, wind, marine advisory.
function lake() {
  const f = new Frame(W, H);
  f.text('small', 'LAKE', 0, 6, C.grey);
  const end = f.text('clock', '51', 0, 22, C.clock);
  ring(f, end + 1, 12, C.clock);
  // a wave under the temperature
  for (let x = 0; x < 40; x++) { const y = 25 + Math.round(Math.sin(x / 2.2)); px(f, x, y, '#1d5fa8'); }
  let x = f.text('small', 'AIR ', 0, 32, C.dimHead);
  x = f.text('small', '46', x, 32, C.grey); f.text('small', '°', x, 32, C.grey);
  for (let y = 0; y < 32; y++) px(f, 44, y, '#262626');
  const X = 48;
  f.text('small', 'SMALL CRAFT ADVISORY', X, 6, C.warnSevere);
  const lead = (label, val, base) => {
    const a = f.text('small', label, X, base, C.grey);
    const b = 127 - measure('small', val);
    for (let xx = a + 1; xx < b - 2; xx += 2) px(f, xx, base - 1, '#3a3a3a');
    f.text('small', val, b, base, C.label);
  };
  lead('WAVES', '4-6 FT', 14);
  lead('WIND', 'N 18 G28', 22);
  lead('SWIM', 'BEACHES CLOSED', 30);
  return f;
}

// ---------------- Clock ----------------

// Four cities, each column dimly tinted for day or night there.
function worldClock() {
  const f = new Frame(W, H);
  const cities = [['CHICAGO', '3:49', 'AM', 'SUN', 'moon', false], ['NEW YORK', '4:49', 'AM', 'SUN', 'moon', false],
    ['LONDON', '9:49', 'AM', 'SUN', 'sun', true], ['TOKYO', '6:49', 'PM', 'SUN', 'moon', false]];
  cities.forEach(([name, t, ap, day, ic, isDay], i) => {
    const x0 = i * 32, cx = x0 + 15.5;
    if (i) for (let y = 0; y < 32; y++) px(f, x0 - 1, y, '#262626');
    ctext(f, 'small', name, cx, 6, i === 0 ? C.label : C.grey);
    ctext(f, '5x7', t, cx, 17, isDay ? '#ffffff' : C.clock);
    icon(f, ic, x0 + 3, 21);
    f.text('small', ap, x0 + 14, 26, C.grey);
    f.text('small', day, x0 + 14, 32, C.dimHead);
  });
  return f;
}

// Pong clock: hours on the left, minutes on the right; the hour side wins at :00, the minute side every other minute.
function pong() {
  const f = new Frame(W, H);
  for (let y = 0; y < 32; y += 4) { px(f, 63, y, '#333333'); px(f, 63, y + 1, '#333333'); }
  rtext(f, 'd13', '3', 56, 14, '#6a6a6a');
  f.text('d13', '49', 71, 14, '#6a6a6a');
  f.fill(2, 17, 1, 7, C.label);
  f.fill(125, 9, 1, 7, C.label);
  f.fill(88, 20, 2, 2, C.white);
  // faint trail
  px(f, 86, 21, '#3a3a3a'); px(f, 84, 22, '#222222');
  return f;
}

// The day as a bar: night, twilight and day across 24 hours, the sun at now.
function dayBar() {
  const f = new Frame(W, H);
  const RISE = 6 + 31 / 60, SET = 16 + 36 / 60, NOW = 14 + 5 / 60;
  const xh = (h) => h * 128 / 24;
  const colAt = (h) => {
    const NIGHT = '#060a22', TW = '#4a2a5a', GLOW = '#c0603a', DAY = '#2a5aa8', NOON = '#4a86d8';
    const d = Math.min(Math.abs(h - RISE), Math.abs(h - SET));
    const inDay = h > RISE && h < SET;
    if (!inDay) return d < 0.6 ? lerp(TW, NIGHT, d / 0.6) : NIGHT;
    if (d < 0.5) return lerp(GLOW, DAY, d / 0.5);
    const mid = (RISE + SET) / 2;
    return lerp(DAY, NOON, 1 - Math.abs(h - mid) / ((SET - RISE) / 2));
  };
  for (let x = 0; x < 128; x++) { const c = colAt((x + 0.5) * 24 / 128); for (let y = 18; y < 24; y++) px(f, x, y, c); }
  for (const h of [6, 12, 18]) px(f, Math.round(xh(h)), 24, C.dimHead);
  const nx = Math.round(xh(NOW));
  for (let y = 16; y < 26; y++) px(f, nx, y, C.white);
  // sun disc on the bar
  for (const [i, j] of [[-1, 0], [1, 0], [0, -1], [0, 1], [0, 0]]) px(f, nx + i, 20 + j, '#ffd040');
  const lab = (h, glyph, t) => { const str = glyph + ' ' + t; ctext(f, 'small', str, xh(h), 31, C.grey); };
  lab(RISE, s(G.UP), '6:31'); lab(SET, s(G.DOWN), '4:36');
  const e = f.text('d13', '2:05', 0, 13, C.clock);
  f.text('small', 'PM', e + 2, 13, C.grey);
  rtext(f, '5x7', 'Sunday', 127, 7, C.label);
  rtext(f, 'small', 'NOV 8', 127, 14, C.grey);
  return f;
}

// ---------------- Other ----------------

// Divvy docks near the station (GBFS).
function divvy() {
  const f = new Frame(W, H);
  f.text('small', 'DIVVY', 0, 6, '#41b6e6');
  const cols = [80, 102, 127];
  rtext(f, 'small', 'BIKES', cols[0], 6, C.dimHead);
  rtext(f, 'small', s(G.BOLT), cols[1], 6, '#7fe07f');
  rtext(f, 'small', 'DOCKS', cols[2], 6, C.dimHead);
  const rows = [['GLENWOOD & MORSE', 4, 2, 9], ['SHERIDAN & LUNT', 0, 1, 14], ['CLARK & LUNT', 7, 0, 3], ['SHERIDAN & PRATT', 2, 5, 0]];
  rows.forEach(([name, b, e, d], i) => {
    const base = 14 + i * 6;
    f.text('small', name, 0, base, C.label);
    [b, e, d].forEach((v, j) => {
      const c = v === 0 ? '#444444' : j === 1 ? '#7fe07f' : C.label;
      const str = String(v);
      rtext(f, 'small', str, cols[j], base, j === 1 && v ? c : c);
    });
  });
  return f;
}

// Now playing: 32x32 album art (invented), title, artist, progress.
function nowPlaying() {
  const f = new Frame(W, H);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    let c = y < 18 ? lerp('#2a1050', '#ff7a3a', y / 18) : lerp('#0a2a4a', '#04101e', (y - 18) / 14);
    const dx = x - 16, dy = y - 15;
    if (y < 18 && dx * dx + dy * dy < 36) c = '#ffd060';
    if (y >= 18 && (y % 3 === 0) && Math.abs(dx) < 9 - (y - 18) / 2) c = '#c08040';
    px(f, x, y, c);
  }
  f.text('5x7', 'Lakefront Static', 36, 8, C.white);
  f.text('small', 'THE MORSE CODES', 36, 16, C.grey);
  const X0 = 36, X1 = 127, p = 0.44;
  for (let x = X0; x <= X1; x++) px(f, x, 23, x <= X0 + (X1 - X0) * p ? C.label : '#333333');
  f.text('small', '1:42', X0, 31, C.dimHead);
  rtext(f, 'small', '-2:11', 127, 31, C.dimHead);
  return f;
}

// NFL with the field to scale: 1 px per yard, end zones 10 px.
function nflField() {
  const f = new Frame(W, H);
  const CHI = '#2a4aa8', GB = '#2f7a3f';
  f.fill(0, 1, 3, 5, CHI);
  let x = f.text('small', 'CHI', 5, 6, C.label) + 3;
  f.text('small', '17', x, 6, C.white);
  f.fill(125, 1, 3, 5, GB);
  x = rtext(f, 'small', 'GB', 122, 6, C.label);
  rtext(f, 'small', '14', 122 - measure('small', 'GB') - 4, 6, C.white);
  ctext(f, 'small', 'Q3  8:42', 64, 6, C.label);
  const FX = 14, Y0 = 10, Y1 = 21;
  f.fill(4, Y0, 10, Y1 - Y0 + 1, scale(CHI, 0.4));
  f.fill(114, Y0, 10, Y1 - Y0 + 1, scale(GB, 0.45));
  f.fill(FX, Y0, 100, Y1 - Y0 + 1, '#0b2410');
  for (let yd = 10; yd < 100; yd += 10) for (let y = Y0; y <= Y1; y++) px(f, FX + yd, y, yd === 50 ? '#3f6a3f' : '#24442a');
  const LOS = FX + 65, FD = LOS + 7, START = FX + 25;
  for (let y = Y0; y <= Y1; y++) { px(f, LOS, y, '#3a7aff'); px(f, FD, y, '#ffd800'); }
  for (let xx = START; xx < LOS; xx++) px(f, xx, 23, scale('#c83803', 0.7));
  f.fill(LOS - 3, 15, 3, 2, '#b8702a');
  f.text('small', '2ND & 7', 0, 31, C.label);
  ctext(f, 'small', '8 PLAYS  40 YDS', 64, 31, C.dimHead);
  rtext(f, 'small', 'GB 35', 127, 31, C.grey);
  return f;
}

const MOCKS = [
  ['transit', 'line-strip', 'Line strip', lineStrip()],
  ['transit', 'timeline', 'Next hour', timeline()],
  ['transit', 'trains-buses', 'Trains | buses', trainsBuses()],
  ['transit', 'solari', 'Split-flap departures', solari()],
  ['weather', 'lake', 'Lake', lake()],
  ['clock', 'day-bar', 'Day bar', dayBar()],
  ['clock', 'world', 'World clock', worldClock()],
  ['clock', 'pong', 'Pong', pong()],
  ['other', 'divvy', 'Divvy', divvy()],
  ['other', 'now-playing', 'Now playing', nowPlaying()],
  ['other', 'nfl-field', 'NFL field', nflField()],
];

const q5 = (v) => v & 0xf8;
fs.mkdirSync(OUT, { recursive: true });
for (const [, id, , fr] of MOCKS) {
  const q = new Frame(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) q.set(x, y, fr.get(x, y).map(q5));
  fs.writeFileSync(path.join(OUT, `${id}.png`), q.toPNG(8));
}
console.log('wrote', OUT);
