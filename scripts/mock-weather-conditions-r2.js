#!/usr/bin/env node
'use strict';
// Round 2 of the current-conditions weather screen (Nov 2026), redesigned
// from scratch around layout and balance. Not implemented; made-up data.
//
// Brief: read up close; must show temperature, condition, high/low,
// feels-like and wind (rain chance optional, left out). Every layout:
// - groups related facts (temperature + its range, condition + wind),
// - sits on an explicit grid with equal margins and gaps,
// - fits the worst cases (3-character temperatures, THNDRSNOW) through a
//   fit ladder instead of collisions,
// - is checked for balance: the luminance-weighted center of the lit pixels.
//
// Writes docs/board/mockups/weather/conditions-r2/<layout>-<state>.png,
// sheet.png, and prints the balance table.
// Usage: node scripts/mock-weather-conditions-r2.js [outDir]

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');
const icons = require('../server/board/icons');
const G = require('../server/board/glyphs');
const render = require('../server/board/render');

const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'conditions-r2');
fs.mkdirSync(OUT, { recursive: true });

// ---------- palette (draw.js) ----------
const C = {
  value: '#d8d8d8',     // label white: primary values
  label: '#8f8f8f',     // grey: labels and secondary text
  rule: '#333333',      // dividers
  head: '#808080',      // header grey (transit/ticker header)
  watch: '#ffd800', severe: '#ff8000', tornado: '#ff2020',
};
const s = (cp) => String.fromCodePoint(cp);
const px = (f, x, y, c) => { if (x >= 0 && x < 64 && y >= 0 && y < 32) f.fill(x, y, 1, 1, c); };
const W = (str) => measure('small', str);
const rtext = (f, str, right, base, c) => f.text('small', str, right - W(str) + 1, base, c);
const ctext = (f, str, cx, base, c) => f.text('small', str, Math.round(cx - (W(str) - 1) / 2), base, c);
const sprite = (f, rows, x, y, c) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') px(f, x + i, y + j, c); }));

// Runs of [text, color] drawn left to right with no extra gap.
const runsWidth = (runs) => runs.reduce((w, [t]) => w + W(t) + 1, -1);
function runs(f, rs, x, base) { for (const [t, c] of rs) x = f.text('small', t, x, base, c); return x; }
const rruns = (f, rs, right, base) => runs(f, rs, right - runsWidth(rs) + 1, base);
const cruns = (f, rs, cx, base) => runs(f, rs, Math.round(cx - (runsWidth(rs) - 1) / 2), base);

// Big temperature (9x15 Bold digits, ink rows base-10..base-1), 5x2 minus,
// 3x3 ring degree 1px after the digits.
const bigW = (t) => (t < 0 ? 7 : 0) + measure('clock', String(Math.abs(t))) + 1 + 3;
function bigTemp(f, t, x, base, c = C.value) {
  if (t < 0) { f.fill(x, base - 6, 5, 2, c); x += 7; }
  x = f.text('clock', String(Math.abs(t)), x, base, c);
  sprite(f, ['###', '#.#', '###'], x, base - 10, c);
  return x + 2;
}

// Facts as label/value runs, with a fit ladder: each returns the widest form
// that fits `room` px.
const feelsRuns = (w) => [['FEELS ', C.label], [`${w.feels}°`, C.value]];
function hiLoRuns(w, room = 64) {
  const up = s(G.UP), dn = s(G.DOWN);
  const ways = [
    [[up, C.label], [`${w.hi}°`, C.value], [' ' + dn, C.label], [`${w.lo}°`, C.value]],
    [[up, C.label], [String(w.hi), C.value], [' ' + dn, C.label], [String(w.lo), C.value]],
    [[up, C.label], [String(w.hi), C.value], [dn, C.label], [String(w.lo), C.value]],
  ];
  return ways.find((r) => runsWidth(r) <= room) || ways[ways.length - 1];
}
function windRuns(w, room = 64) {
  const ways = [[[w.wind, C.value], [' MPH', C.label]], [[w.wind, C.value]]];
  return ways.find((r) => runsWidth(r) <= room) || ways[ways.length - 1];
}
// NWS watch/warning text (tornado warning blinks; lit phase shown). In every
// layout it takes the condition word's place: the icon still shows the
// weather, and the other facts stay.
function warn(w, long = true) {
  const color = w.warn.lvl === 'watch' ? C.watch : w.warn.kind === 'tor' ? C.tornado : C.severe;
  const glyph = s(w.warn.kind === 'tor' ? G.FUNNEL : G.BOLT);
  const word = long
    ? { svr: { watch: 'TSTORM WATCH', warning: 'TSTORM WARNING' }, tor: { watch: 'TORNADO WATCH', warning: 'TORNADO WARN' } }[w.warn.kind][w.warn.lvl]
    : (w.warn.lvl === 'warning' ? 'WARNING' : 'WATCH');
  return [[glyph + '  ', color], [word, color]];
}

// ---------- icons ----------
function icon8(f, name, x, y) {
  icons.ICONS[name].forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') px(f, x + i, y + j, icons.PALETTE[ch]); }));
}
// Large icons, 18 x 16, drawn procedurally (sampled at pixel centers).
const BIG = { sun: '#ffc800', core: '#ffe060', moon: '#ffe47a', cloud: '#d0d0d0', under: '#7c7c7c', storm: '#8a8a8a', stormUnder: '#545454', rain: '#1e88ff', snow: '#d0f0ff', bolt: '#ffe000' };
const inC = (x, y, cx, cy, r) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
function sun(f, ox, oy, cx = 9, cy = 8, r = 4.2) {
  for (let y = -2; y < 18; y++) for (let x = -2; x < 20; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d <= r) px(f, ox + x, oy + y, d <= r - 1.6 ? BIG.core : BIG.sun);
  }
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    for (const rr of [r + 2, r + 3]) px(f, ox + Math.floor(cx + rr * Math.cos(a)), oy + Math.floor(cy + rr * Math.sin(a)), BIG.sun);
  }
}
function moon(f, ox, oy, cx = 9, cy = 8, r = 6) {
  for (let y = 0; y < 17; y++) for (let x = 0; x < 18; x++) if (inC(x, y, cx, cy, r) && !inC(x, y, cx + 3.2, cy - 2.2, r - 0.6)) px(f, ox + x, oy + y, BIG.moon);
}
function cloud(f, ox, oy, dark, dy = 0) {
  const cs = [[5, 10 + dy, 3.6], [9.5, 7.5 + dy, 4.8], [14, 10 + dy, 3.4]];
  const base = 13.5 + dy;
  for (let y = 0; y < 18; y++) for (let x = 0; x < 20; x++) {
    if (y + 0.5 > base) continue;
    if (!cs.some(([cx, cy, r]) => inC(x, y, cx, cy, r)) && !(y + 0.5 > 9.5 + dy && x + 0.5 > 5 && x + 0.5 < 14)) continue;
    px(f, ox + x, oy + y, y + 0.5 > base - 2 ? (dark ? BIG.stormUnder : BIG.under) : (dark ? BIG.storm : BIG.cloud));
  }
}
function icon16(f, kind, ox, oy) {
  const streaks = (pts) => pts.forEach(([x, y]) => { px(f, ox + x, oy + y, BIG.rain); px(f, ox + x, oy + y + 1, BIG.rain); });
  switch (kind) {
    case 'sun': sun(f, ox, oy); break;
    case 'moon': moon(f, ox, oy); break;
    case 'pcloudy_day': sun(f, ox, oy, 6, 6, 3.6); cloud(f, ox + 1, oy, false, 2); break;
    case 'cloudy': cloud(f, ox, oy, false, 1); break;
    case 'rain': cloud(f, ox, oy, true, -2); streaks([[4, 13], [8, 12], [12, 13], [16, 12]]); break;
    case 'snow': cloud(f, ox, oy, false, -2); [[4, 13], [9, 12], [14, 13], [6, 15], [12, 15], [17, 15]].forEach(([x, y]) => px(f, ox + x, oy + y, BIG.snow)); break;
    case 'storm': {
      cloud(f, ox, oy, true, -2);
      const bolt = ['..##', '.##.', '####', '.##.', '##..', '#...'];
      bolt.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) px(f, ox + 8 + i + a, oy + 10 + j + b, '#000000'); }));
      sprite(f, bolt, ox + 8, oy + 10, BIG.bolt);
      streaks([[3, 13], [16, 12]]);
      break;
    }
    default: cloud(f, ox, oy, false);
  }
}

// ---------- states (made up; worst cases included) ----------
const STATES = [
  { id: 'a-ptcloudy', temp: 57, icon: 'pcloudy_day', word: 'PT CLOUDY', feels: 55, wind: 'NW 12', hi: 63, lo: 49 },
  { id: 'b-rain', temp: 41, icon: 'rain', word: 'RAIN', feels: 34, wind: 'E 18', hi: 44, lo: 38 },
  { id: 'c-night', temp: 72, icon: 'moon', word: 'CLEAR', feels: 72, wind: 'S 5', hi: 84, lo: 68 },
  { id: 'd-cold', temp: -12, icon: 'snow', word: 'THNDRSNOW', feels: -27, wind: 'NW 22', hi: -5, lo: -14 },
  { id: 'e-hot', temp: 101, icon: 'sun', word: 'SUNNY', feels: 108, wind: 'SW 9', hi: 103, lo: 82 },
  { id: 'f-warning', temp: 84, icon: 'storm', word: 'STORMS', feels: 91, wind: 'SW 31', hi: 89, lo: 70, warn: { kind: 'tor', lvl: 'warning' } },
];

// ---------- layouts ----------
const LAYOUTS = [];
const layout = (id, title, fn) => LAYOUTS.push({ id, title, fn });

// 1. POSTER: one centered axis, three rows on equal 2px gaps and margins:
//    [temp][high over low]   rows 2-12
//    [8px icon][WORD]        rows 15-22
//    FEELS 55°   NW 12       rows 25-29
layout('1-poster', 'POSTER', (f, w) => {
  const hl = [[s(G.UP), C.label], [`${w.hi}°`, C.value]], ll = [[s(G.DOWN), C.label], [`${w.lo}°`, C.value]];
  const sw = Math.max(runsWidth(hl), runsWidth(ll));
  const tw = bigW(w.temp), gw = tw + 4 + sw;
  const x = Math.round((64 - gw) / 2);
  bigTemp(f, w.temp, x, 13);
  runs(f, hl, x + tw + 4, 7);
  runs(f, ll, x + tw + 4, 13);
  const word = !w.warn ? [[w.word, C.value]] : runsWidth(warn(w)) + 11 <= 62 ? warn(w) : warn(w, false);
  const iw = 8 + 3 + runsWidth(word);
  const ix = Math.round((64 - iw) / 2);
  icon8(f, w.icon, ix, 15);
  runs(f, word, ix + 11, 21);
  const fr = feelsRuns(w), wr = windRuns(w, 64 - runsWidth(fr) - 6);
  const bw = runsWidth(fr) + 6 + runsWidth(wr);
  const bx = Math.round((64 - bw) / 2);
  runs(f, fr, bx, 30);
  runs(f, wr, bx + runsWidth(fr) + 6, 30);
});

// 2. SIDEBAR: the heavy pair stacked left (big icon over big temperature),
//    the four facts as a list on the right, right-aligned to x63 on an
//    8-row pitch (rows 2, 10, 18, 26). Lines beside the temperature use the
//    fit ladder to stay 3px clear of it.
layout('2-sidebar', 'SIDEBAR', (f, w) => {
  icon16(f, w.icon, 0, 2);
  const tr = bigTemp(f, w.temp, 0, 31);   // ink rows 21-30
  const room = 63 - (tr + 3);
  if (w.warn) rruns(f, warn(w, false), 63, 7);
  else rtext(f, w.word, 63, 7, C.value);
  rruns(f, feelsRuns(w), 63, 15);
  rruns(f, windRuns(w, room), 63, 23);
  rruns(f, hiLoRuns(w, room), 63, 31);
});

// 3. BANDS: the transit screen's frame. A grey top line (condition left,
//    wind right, flush to the edges like the station header), the big icon
//    and temperature centered as one group in the middle (rows 8-23), and a
//    grey-labelled bottom line (rows 26-30): feels-like left, high/low right.
//    Margins and gaps are 1/2/2/1, so the weight sits in the middle.
layout('3-bands', 'BANDS', (f, w) => {
  const top = w.warn ? warn(w, false) : [[w.word, C.head]];
  runs(f, top, 0, 6);
  rruns(f, windRuns(w, 64 - runsWidth(top) - 4).map(([t]) => [t, C.head]), 63, 6);
  const tw = bigW(w.temp), gw = 18 + 5 + tw;
  const x = Math.round((64 - gw) / 2);
  icon16(f, w.icon, x, 8);
  bigTemp(f, w.temp, x + 23, 21);           // ink rows 11-20, centered on the icon
  // Bottom line, rows 26-30, at least 3px apart. Fit ladder: the high/low's
  // degree signs go first (usual case), then feels-like's, then the space
  // before the down arrow, then the arrows.
  const hiLoBare = [[s(G.UP), C.label], [String(w.hi), C.value], [' ' + s(G.DOWN), C.label], [String(w.lo), C.value]];
  const ladder = [
    [feelsRuns(w), hiLoRuns(w, 99)],
    [feelsRuns(w), hiLoBare],
    [[['FEELS ', C.label], [String(w.feels), C.value]], hiLoBare],
    [[['FEELS ', C.label], [String(w.feels), C.value]], [[s(G.UP), C.label], [String(w.hi), C.value], [s(G.DOWN), C.label], [String(w.lo), C.value]]],
    [[['FEELS ', C.label], [String(w.feels), C.value]], [[String(w.hi), C.value], ['/', C.label], [String(w.lo), C.value]]],
  ];
  const [fr, hr] = ladder.find(([a, b]) => runsWidth(a) + 3 + runsWidth(b) <= 64) || ladder[ladder.length - 1];
  runs(f, fr, 0, 31);
  rruns(f, hr, 63, 31);
});

// 4. TILES: big icon and temperature on top with the word under the
//    temperature; below a 1px rule, three equal tiles (21 px, dividers at x21
//    and x42), each a label over a value: high/low, feels, wind.
layout('4-tiles', 'TILES', (f, w) => {
  icon16(f, w.icon, 1, 0);
  const tw = bigW(w.temp);
  const cx = 42;                                   // center of x21-63
  bigTemp(f, w.temp, Math.min(63 - tw + 1, Math.round(cx - tw / 2)), 11);   // ink rows 1-10
  if (w.warn) cruns(f, warn(w, false), cx, 17);
  else ctext(f, w.word, cx, 17, C.value);
  f.fill(0, 19, 64, 1, C.rule);
  f.fill(21, 21, 1, 11, C.rule);
  f.fill(42, 21, 1, 11, C.rule);
  const tile = (i, top, bottom) => {
    const c = i * 21 + 10;
    cruns(f, top, c, 26);
    cruns(f, bottom, c, 32);
  };
  tile(0, [[s(G.UP), C.label], [String(w.hi), C.value]], [[s(G.DOWN), C.label], [String(w.lo), C.value]]);
  tile(1, [['FEELS', C.label]], [[`${w.feels}°`, C.value]]);
  tile(2, [['WIND', C.label]], [[w.wind, C.value]]);
});

// ---------- current layout, for comparison ----------
function current(w) {
  const p = { now: 1762000000, warn: w.warn, radar: { frames: [], wx: { temp: w.temp, icon: w.icon, word: w.word, feels: w.feels, wind: w.wind, hi: w.hi, lo: w.lo } } };
  return render.renderWeather(p, { blink: false });
}

// ---------- balance: luminance-weighted center of the lit pixels ----------
function balance(f) {
  let sum = 0, sx = 0, sy = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const [r, g, b] = f.get(x, y);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l; sx += l * x; sy += l * y;
  }
  return [sx / sum - 31.5, sy / sum - 15.5];
}

// ---------- output ----------
const rows = [{ id: '0-current', title: 'CURRENT', fn: null }, ...LAYOUTS];
const frames = rows.map((L) => STATES.map((w) => {
  let f;
  if (L.fn) { f = new Frame(); L.fn(f, w); fs.writeFileSync(path.join(OUT, `${L.id}-${w.id}.png`), f.toPNG(10)); } else f = current(w);
  return f;
}));

console.log('balance: mean |offset| of the lit-pixel center from the panel center (px), x / y');
rows.forEach((L, i) => {
  const b = frames[i].map(balance);
  const mx = b.reduce((a, [x]) => a + Math.abs(x), 0) / b.length, my = b.reduce((a, [, y]) => a + Math.abs(y), 0) / b.length;
  console.log(`  ${L.title.padEnd(8)} ${mx.toFixed(1)} / ${my.toFixed(1)}   per state x: ${b.map(([x]) => x.toFixed(1)).join(' ')}`);
});

const SC = 5, GAP = 12, fw = 64 * SC, fh = 32 * SC;
const sheet = new PNG({ width: STATES.length * (fw + GAP) + GAP, height: rows.length * (fh + GAP) + GAP });
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
