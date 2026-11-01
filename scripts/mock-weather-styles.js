#!/usr/bin/env node
'use strict';
// Aesthetic directions for the weather screen's current conditions (Nov 2026).
// Not implemented; made-up data. Four looks, five states each:
//   TV      90s TV weather: blue gradient title band, navy panel, yellow labels
//   FLAP    split-flap board: big flap tiles for the temperature, small flaps
//           for high/low and the condition (the clock face's flap style)
//   TERM    monochrome amber terminal readout with dot leaders
//   SKY     the Poster layout (Rounded digits) over a dim sky-colored wash
// Facts everywhere: temperature, condition, high/low, feels-like, wind.
// Writes docs/board/mockups/weather/styles/<style>-<state>.png and sheet.png.
// Usage: node scripts/mock-weather-styles.js [outDir]

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');
const icons = require('../server/board/icons');
const G = require('../server/board/glyphs');

const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'styles');
fs.mkdirSync(OUT, { recursive: true });

// ---------- helpers ----------
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lerp = (c0, c1, k) => hex(rgb(c0).map((v, i) => v + (rgb(c1)[i] - v) * k));
const s = (cp) => String.fromCodePoint(cp);
const UP = s(G.UP), DN = s(G.DOWN);
const px = (f, x, y, c) => { if (x >= 0 && x < 64 && y >= 0 && y < 32) f.fill(x, y, 1, 1, c); };
const W = (str) => measure('small', str);
const runsWidth = (rs) => rs.reduce((w, [t]) => w + W(t) + 1, -1);
function runs(f, rs, x, base) { for (const [t, c] of rs) x = f.text('small', t, x, base, c); return x; }
const rruns = (f, rs, right, base) => runs(f, rs, right - runsWidth(rs) + 1, base);
const cruns = (f, rs, cx, base) => runs(f, rs, Math.round(cx - (runsWidth(rs) - 1) / 2), base);
const art = (rows, x, y, f, c) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') px(f, x + i, y + j, c); }));
function icon8(f, name, x, y, mono) {
  icons.ICONS[name].forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') px(f, x + i, y + j, mono || icons.PALETTE[ch]); }));
}
function vgrad(f, x, y, w, h, c0, c1) { for (let j = 0; j < h; j++) f.fill(x, y + j, w, 1, lerp(c0, c1, h > 1 ? j / (h - 1) : 0)); }

// Glyph bitmaps from the board fonts (for flap tiles): `rows` lines of the
// glyph's ink area, `w` columns.
function glyph(font, ch, rows, w) {
  const f = new Frame();
  f.text(font, ch, 2, 20, '#ffffff');
  const out = [];
  for (let y = 20 - rows; y < 20; y++) {
    let line = '';
    for (let x = 2; x < 2 + w; x++) line += f.get(x, y)[0] ? '#' : '.';
    out.push(line);
  }
  return out;
}

// 9x15 Bold temperature (ink rows base-10..base-1), 5x2 minus, 3x3 ring degree.
const bigW = (t) => (t < 0 ? 7 : 0) + measure('clock', String(Math.abs(t))) + 1 + 3;
function bigTemp(f, t, x, base, c) {
  if (t < 0) { f.fill(x, base - 6, 5, 2, c); x += 7; }
  x = f.text('clock', String(Math.abs(t)), x, base, c);
  art(['###', '#.#', '###'], x, base - 10, f, c);
  return x + 2;
}
// Rounded (8 x 13, 2px strokes; from mock-weather-bignum.js).
const ROUND = {
  0: ['..####..', '.######.', '###..###', ...Array(7).fill('##....##'), '###..###', '.######.', '..####..'],
  1: ['...##...', '..###...', '.####...', ...Array(10).fill('...##...')],
  2: ['..####..', '.######.', '###..###', '##....##', '......##', '.....###', '....###.', '...###..', '..###...', '.###....', '###.....', '########', '########'],
  3: ['..####..', '.######.', '###..###', '......##', '......##', '...####.', '...####.', '......##', '......##', '......##', '###..###', '.######.', '..####..'],
  4: ['.....##.', '....###.', '...####.', '..##.##.', '.##..##.', '##...##.', '##...##.', '##...##.', '########', '########', '.....##.', '.....##.', '.....##.'],
  5: ['########', '########', '##......', '##......', '##.###..', '#######.', '###..###', '......##', '......##', '......##', '###..###', '.######.', '..####..'],
  6: ['..####..', '.######.', '###..###', '##......', '##......', '##.###..', '#######.', '###..###', '##....##', '##....##', '###..###', '.######.', '..####..'],
  7: ['########', '########', '......##', '.....###', '.....##.', '....###.', '....##..', '...###..', '..###...', '..##....', '..##....', '..##....', '..##....'],
  8: ['..####..', '.######.', '###..###', '##....##', '###..###', '.######.', '.######.', '###..###', '##....##', '##....##', '###..###', '.######.', '..####..'],
  9: ['..####..', '.######.', '###..###', '##....##', '##....##', '###..###', '.#######', '..###.##', '......##', '......##', '###..###', '.######.', '..####..'],
};
const roundW = (t) => (t < 0 ? 7 : 0) + String(Math.abs(t)).length * 10 - 2 + 1 + 4;
function roundTemp(f, t, x, top, c) {
  if (t < 0) { f.fill(x, top + 5, 5, 2, c); x += 7; }
  for (const d of String(Math.abs(t))) { art(ROUND[d], x, top, f, c); x += 10; }
  art(['.##.', '#..#', '#..#', '.##.'], x - 1, top, f, c);
}

const WARN_LONG = { svr: { watch: 'TSTORM WATCH', warning: 'TSTORM WARNING' }, tor: { watch: 'TORNADO WATCH', warning: 'TORNADO WARN' } };
const warnColor = (w) => (w.lvl === 'watch' ? '#ffd800' : w.kind === 'tor' ? '#ff2020' : '#ff8000');
const warnGlyph = (w) => s(w.kind === 'tor' ? G.FUNNEL : G.BOLT);

// ---------- states ----------
const STATES = [
  { id: 'a-ptcloudy', temp: 57, icon: 'pcloudy_day', word: 'PT CLOUDY', feels: 55, wind: 'NW 12', hi: 63, lo: 49, sky: 'pcloudy' },
  { id: 'b-rain', temp: 36, icon: 'rain', word: 'RAIN', feels: 29, wind: 'E 18', hi: 39, lo: 33, sky: 'rain' },
  { id: 'c-night', temp: 72, icon: 'moon', word: 'CLEAR', feels: 72, wind: 'S 5', hi: 84, lo: 68, sky: 'night' },
  { id: 'd-cold', temp: -12, icon: 'snow', word: 'SNOW', feels: -27, wind: 'NW 22', hi: -5, lo: -14, sky: 'snow' },
  { id: 'e-warning', temp: 84, icon: 'storm', word: 'STORMS', feels: 91, wind: 'SW 31', hi: 89, lo: 70, sky: 'storm', warn: { kind: 'tor', lvl: 'warning' } },
];

const STYLES = [];
const style = (id, title, fn) => STYLES.push({ id, title, fn });

// ---------- 1. TV: 90s TV weather ----------
// Title band rows 0-7 (gradient; the condition in yellow, the icon on the
// band's right), navy panel below: temperature with the high/low stack, then
// feels-like and wind. A warning turns the band red.
style('tv', 'TV WEATHER', (f, w) => {
  const T = { band0: '#2a4cb8', band1: '#0e2470', panel0: '#06123a', panel1: '#020818', title: '#ffd23c', label: '#c8a838', value: '#e8e8e8' };
  if (w.warn) {
    vgrad(f, 0, 0, 64, 8, '#b01010', '#500404');
  } else vgrad(f, 0, 0, 64, 8, T.band0, T.band1);
  vgrad(f, 0, 8, 64, 24, T.panel0, T.panel1);
  f.fill(0, 8, 64, 1, w.warn ? '#ff4040' : '#3a6ad8');          // bright rule under the band
  if (w.warn) {
    cruns(f, [[warnGlyph(w.warn) + '  ', '#ffffff'], [WARN_LONG[w.warn.kind][w.warn.lvl], '#ffffff']], 32, 7);
  } else {
    f.text('small', w.word, 2, 7, T.title);
    icon8(f, w.icon, 54, 0);
  }
  // Panel: hero rows 10-20, word rows 22-26... then the bottom line.
  const hl = [[UP, T.label], [`${w.hi}°`, T.value]], ll = [[DN, T.label], [`${w.lo}°`, T.value]];
  const sw = Math.max(runsWidth(hl), runsWidth(ll));
  const tw = bigW(w.temp), x = Math.round((64 - (tw + 4 + sw)) / 2);
  bigTemp(f, w.temp, x, 21, '#ffffff');                       // ink rows 11-20
  runs(f, hl, x + tw + 4, 15); runs(f, ll, x + tw + 4, 21);
  // Feels-like and wind, label/value pairs inside 2px panel margins.
  runs(f, [['FEELS ', T.label], [`${w.feels}°`, T.value]], 2, 30);
  const fw2 = runsWidth([['FEELS ', T.label], [`${w.feels}°`, T.value]]);
  const wind = [['WIND ', T.label], [w.wind, T.value]];
  rruns(f, fw2 + 3 + runsWidth(wind) <= 60 ? wind : [[w.wind, T.value]], 61, 30);
});

// ---------- 2. FLAP: split-flap board ----------
// Big flap tiles (10 x 15: 9x15 Bold digit split by an unlit hinge row) for
// the temperature, small two-tone flaps (glyph width + 2, 7 tall) for the high/low
// stack and the condition word, a plain line for feels-like and wind.
const FL = { top: '#262626', bot: '#1c1c1c', big: '#e6e6e6', small: '#c8c8c8', label: '#8f8f8f' };
function bigFlap(f, x, y, rows, w) {
  // rows: 10 ink rows; tile 15 tall: 2 pad, ink 0-4, hinge, ink 5-9, 2 pad.
  const tw = w + 2;
  f.fill(x, y, tw, 7, FL.top); f.fill(x, y + 8, tw, 7, FL.bot);
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') px(f, x + 1 + i, y + 2 + j + (j >= 5 ? 1 : 0), FL.big); }));
  return x + tw;
}
function smallFlap(f, ch, x, y, color = FL.small) {
  const w = Math.max(3, W(ch));
  const rows = glyph('small', ch, 5, w);
  // 7 tall: pad, 5 ink rows, pad; the two halves differ in shade only (a
  // hinge gap through a 3x5 glyph doesn't read).
  f.fill(x, y, w + 2, 4, FL.top); f.fill(x, y + 4, w + 2, 3, FL.bot);
  rows.forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') px(f, x + 1 + i, y + 1 + j, color); }));
  return x + w + 2;
}
const flapsWidth = (str) => [...str].reduce((a, ch) => a + Math.max(3, W(ch)) + 2 + 1, -1);
function flaps(f, str, x, y, color) { for (const ch of str) x = smallFlap(f, ch, x, y, color) + 1; return x - 1; }
style('flap', 'SPLIT-FLAP', (f, w) => {
  const digits = String(Math.abs(w.temp));
  const minus = w.temp < 0;
  const deg = ['###', '#.#', '###', ...Array(7).fill('...')];
  const tilesW = (minus ? 9 : 0) + digits.length * 11 + 6 - 1;
  const hlW = Math.max(flapsWidth(UP + w.hi), flapsWidth(DN + w.lo));
  let x = Math.round((64 - (tilesW + 3 + hlW)) / 2);
  if (minus) { f.fill(x, 0, 8, 7, FL.top); f.fill(x, 8, 8, 7, FL.bot); f.fill(x + 1, 5, 6, 2, FL.big); x += 9; }
  for (const d of digits) x = bigFlap(f, x, 0, glyph('clock', d, 10, 8), 8) + 1;
  x = bigFlap(f, x, 0, deg, 3) + 1;                     // degree tile
  const hx = x + 2;
  flaps(f, UP + w.hi, hx, 0);
  flaps(f, DN + w.lo, hx, 8);
  // Condition row (rows 18-24): icon, then the word on flaps.
  if (w.warn) {
    const t = 'WARNING';
    const gx = Math.round((64 - (8 + 3 + flapsWidth(t))) / 2);
    f.text('small', warnGlyph(w.warn), gx + 2, 24, warnColor(w.warn));
    flaps(f, t, gx + 11, 18, warnColor(w.warn));
  } else {
    const ww = 8 + 3 + flapsWidth(w.word), gx = Math.round((64 - ww) / 2);
    icon8(f, w.icon, gx, 17);
    flaps(f, w.word, gx + 11, 18);
  }
  // Feels-like and wind, plain.
  const fr = [['FEELS ', FL.label], [`${w.feels}°`, FL.small]], wr = [[w.wind, FL.small]];
  const bw = runsWidth(fr) + 6 + runsWidth(wr), bx = Math.round((64 - bw) / 2);
  runs(f, fr, bx, 32); runs(f, wr, bx + runsWidth(fr) + 6, 32);
});

// ---------- 5. TERM: amber terminal readout ----------
// One color in four steps. Big 9x15 Bold temperature (the X11 terminal font)
// with the high/low stack, the icon in amber at the right, then three readout
// lines with dot leaders: SKY, FEELS, WIND. Only a warning breaks the mono
// palette (red), since its color means something.
const AM = { hi: '#ffb000', mid: '#c08400', dim: '#6a4800', faint: '#3a2800' };
function readout(f, label, value, base, vc = AM.hi) {
  const lx = f.text('small', label, 0, base, AM.dim);
  const vx = 63 - W(value) + 1;
  for (let x = lx + 1; x < vx - 2; x += 2) px(f, x, base - 1, AM.faint);
  f.text('small', value, vx, base, vc);
}
style('term', 'TERMINAL', (f, w) => {
  const tw = bigW(w.temp);
  bigTemp(f, w.temp, 0, 11, AM.hi);                      // ink rows 1-10
  runs(f, [[UP, AM.dim], [`${w.hi}°`, AM.mid]], tw + 3, 6);
  runs(f, [[DN, AM.dim], [`${w.lo}°`, AM.mid]], tw + 3, 12);
  icon8(f, w.icon, 56, 2, AM.mid);
  if (w.warn) {
    const c = warnColor(w.warn);
    const lx = f.text('small', '!', 0, 19, c);
    rruns(f, [[warnGlyph(w.warn) + '  ', c], [WARN_LONG[w.warn.kind][w.warn.lvl], c]], 63, 19);
    void lx;
  } else readout(f, 'SKY', w.word, 19);
  readout(f, 'FEELS', `${w.feels}°`, 25);
  readout(f, 'WIND', w.wind, 31);
});

// ---------- 7. SKY: Poster over a sky-colored wash ----------
// The wash is a vertical gradient chosen by conditions and time of day, kept
// dim so white text stays on top. Rounded digits.
const SKY = {
  clear: ['#0a2a6a', '#14408a'], pcloudy: ['#142448', '#22386a'], cloudy: ['#1a1e26', '#262a34'],
  rain: ['#121822', '#0a0e16'], snow: ['#20222c', '#2c2e38'], night: ['#000106', '#060c22'], storm: ['#140e1e', '#08060e'],
};
style('sky', 'SKY WASH', (f, w) => {
  const [c0, c1] = SKY[w.sky] || SKY.clear;
  vgrad(f, 0, 0, 64, 32, c0, c1);
  if (w.sky === 'night') [[4, 3], [17, 1], [44, 2], [59, 6], [9, 20], [53, 19], [30, 1]].forEach(([x, y], i) => px(f, x, y, i % 2 ? '#3a4050' : '#6a7080'));
  const hl = [[UP, '#b0b0b0'], [`${w.hi}°`, '#e8e8e8']], ll = [[DN, '#b0b0b0'], [`${w.lo}°`, '#e8e8e8']];
  const sw = Math.max(runsWidth(hl), runsWidth(ll));
  const tw = roundW(w.temp), x = Math.round((64 - (tw + 4 + sw)) / 2);
  roundTemp(f, w.temp, x, 1, '#ffffff');                 // rows 1-13
  runs(f, hl, x + tw + 4, 7); runs(f, ll, x + tw + 4, 13);
  let word = w.warn ? [[warnGlyph(w.warn) + '  ', warnColor(w.warn)], [WARN_LONG[w.warn.kind][w.warn.lvl], warnColor(w.warn)]] : [[w.word, '#ffffff']];
  if (w.warn && 11 + runsWidth(word) > 62) word = [[warnGlyph(w.warn) + '  ', warnColor(w.warn)], [w.warn.lvl === 'warning' ? 'WARNING' : 'WATCH', warnColor(w.warn)]];
  const iw = 8 + 3 + runsWidth(word), ix = Math.round((64 - iw) / 2);
  icon8(f, w.icon, ix, 16);
  runs(f, word, ix + 11, 22);
  const fr = [['FEELS ', '#b0b0b0'], [`${w.feels}°`, '#e8e8e8']], wr = [[w.wind, '#e8e8e8']];
  const bw = runsWidth(fr) + 6 + runsWidth(wr), bx = Math.round((64 - bw) / 2);
  runs(f, fr, bx, 31); runs(f, wr, bx + runsWidth(fr) + 6, 31);
});

// ---------- output ----------
const frames = STYLES.map((S) => STATES.map((w) => {
  const f = new Frame();
  S.fn(f, w);
  fs.writeFileSync(path.join(OUT, `${S.id}-${w.id}.png`), f.toPNG(10));
  return f;
}));
const SC = 5, GAP = 12, fw = 64 * SC, fh = 32 * SC;
const sheet = new PNG({ width: STATES.length * (fw + GAP) + GAP, height: STYLES.length * (fh + GAP) + GAP });
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
