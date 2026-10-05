'use strict';
// Full-screen clock options, drawn with the board fonts.
// Writes docs/board/previews/mock-clock-screens.png.
//   node scripts/mock-clock-screens.js

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const R = require('../server/board/render');
const { Frame } = require('../server/board/raster');
const { ICONS, PALETTE } = require('../server/board/icons');

const OUT = path.join(__dirname, '../docs/board/previews/mock-clock-screens.png');
const C = { clock: '#cccccc', label: '#d8d8d8', grey: '#8f8f8f', dim: '#555555', amber: '#ffb000', dimAmber: '#9c6a00', div: '#333333', ghost: '#181818' };

// Mock times (Mon Oct 5, Chicago): afternoon and overnight.
const TIMES = [{ h: 13, m: 42, date: 'MON OCT 5', temp: 61, icon: 'pcloudy_day' }, { h: 0, m: 58, date: 'TUE OCT 6', temp: 52, icon: 'moon' }];
const SUNRISE = 6 * 60 + 51, SUNSET = 18 * 60 + 26; // minutes after midnight (from the Open-Meteo fixture)

const h12 = (h) => ((h + 11) % 12) + 1;
const ampm = (h) => (h < 12 ? 'AM' : 'PM');
const hhmm = (t) => `${h12(t.h)}:${String(t.m).padStart(2, '0')}`;
const center = (w) => Math.floor((64 - w) / 2);
const ctext = (f, font, s, base, color, cx = 32) => f.text(font, s, cx - Math.floor((R.measure(font, s) + 1) / 2), base, color);
const rtext = (f, font, s, right, base, color) => f.text(font, s, right - R.measure(font, s), base, color);
const px = (f, x, y, color) => f.fill(x, y, 1, 1, color);

function line(f, x0, y0, x1, y1, color) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    px(f, x0, y0, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}

function icon(f, name, x, y) {
  ICONS[name].forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') px(f, x + i, y + j, PALETTE[c]); }));
}

// ---- A: seven-segment, full height, unlit segments faintly ghosted ----
// Digit cell 13x27, 3px strokes, 1px gaps between segments.
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function segDigit(f, d, x, y, on, off) {
  const w = 13, t = 2, gy = 12, h = 26;
  const rects = {
    a: [1, 0, w - 2, t], g: [1, gy, w - 2, t], d: [1, h - t, w - 2, t],
    f: [0, t + 1, t, gy - t - 2], b: [w - t, t + 1, t, gy - t - 2],
    e: [0, gy + t + 1, t, h - gy - 2 * t - 2], c: [w - t, gy + t + 1, t, h - gy - 2 * t - 2],
  };
  const lit = d == null ? '' : SEG[d];
  for (const [k, [rx, ry, rw, rh]] of Object.entries(rects)) f.fill(x + rx, y + ry, rw, rh, lit.includes(k) ? on : off);
}
function faceSeg(f, t) {
  const s = hhmm(t).replace(':', '').padStart(4, ' ');
  const y = 3, xs = [0, 15, 36, 51];
  [...s].forEach((c, i) => segDigit(f, c === ' ' ? null : +c, xs[i], y, C.clock, C.ghost));
  f.fill(31, y + 7, 2, 2, C.clock); f.fill(31, y + 17, 2, 2, C.clock);
  // PM indicator dot, like a bedside clock
  if (t.h >= 12) f.fill(31, 0, 1, 1, C.amber);
}

// ---- B: split-flap tiles ----
// 2x chunky digits on dim tiles with a dark hinge line; the first tile goes blank for 1-9.
const CHUNKY = {
  0: ['.####.', '######', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '######', '.####.'],
  1: ['..##..', '.###..', '####..', '..##..', '..##..', '..##..', '..##..', '..##..', '######', '######'],
  2: ['.####.', '######', '##..##', '....##', '...###', '..###.', '.###..', '###...', '######', '######'],
  3: ['.####.', '######', '##..##', '....##', '..###.', '..###.', '....##', '##..##', '######', '.####.'],
  4: ['##..##', '##..##', '##..##', '##..##', '######', '######', '....##', '....##', '....##', '....##'],
  5: ['######', '######', '##....', '#####.', '######', '....##', '....##', '##..##', '######', '.####.'],
  6: ['.####.', '######', '##....', '#####.', '######', '##..##', '##..##', '##..##', '######', '.####.'],
  7: ['######', '######', '....##', '...###', '..###.', '..##..', '..##..', '..##..', '..##..', '..##..'],
  8: ['.####.', '######', '##..##', '##..##', '.####.', '######', '##..##', '##..##', '######', '.####.'],
  9: ['.####.', '######', '##..##', '##..##', '######', '.#####', '....##', '....##', '######', '.####.'],
};
function faceFlap(f, t) {
  const s = hhmm(t).replace(':', '').padStart(4, ' ');
  const tw = 14, th = 24, y = 2, xs = [0, 15, 35, 50];
  [...s].forEach((c, i) => {
    const x = xs[i];
    f.fill(x, y, tw, th, '#1c1c1c');
    if (c !== ' ') CHUNKY[c].forEach((row, j) => [...row].forEach((b, k) => { if (b === '#') f.fill(x + 1 + k * 2, y + 2 + j * 2, 2, 2, C.clock); }));
    // Hinge: a dark seam on the tile only; digit pixels on that row just dim.
    for (let i = 0; i < tw; i++) { const p = f.get(x + i, y + 12); px(f, x + i, y + 12, p[0] > 100 ? '#7a7a7a' : '#000000'); }
  });
  f.fill(31, y + 7, 2, 2, C.clock); f.fill(31, y + 15, 2, 2, C.clock);
  ctext(f, 'small', `${ampm(t.h)}  ${t.date}`, 31, C.grey);
}

// ---- C: analog face + side panel ----
function faceAnalog(f, t) {
  const cx = 15, cy = 15, r = 15;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * 2 * Math.PI;
    const x = Math.round(cx + Math.sin(a) * r), y = Math.round(cy - Math.cos(a) * r);
    if (i % 15 === 0) px(f, x, y, C.amber);
    else if (i % 5 === 0) px(f, x, y, C.grey);
  }
  const ma = (t.m / 60) * 2 * Math.PI, ha = (((t.h % 12) + t.m / 60) / 12) * 2 * Math.PI;
  line(f, cx, cy, Math.round(cx + Math.sin(ha) * 7), Math.round(cy - Math.cos(ha) * 7), C.label);
  line(f, cx, cy, Math.round(cx + Math.sin(ma) * 12), Math.round(cy - Math.cos(ma) * 12), C.clock);
  px(f, cx, cy, C.amber);
  f.fill(33, 0, 1, 32, C.div);
  const mid = 49;
  ctext(f, '5x7', hhmm(t), 9, C.clock, mid);
  ctext(f, 'small', ampm(t.h), 16, C.dim, mid);
  ctext(f, 'small', t.date.slice(4), 23, C.grey, mid);
  icon(f, t.icon, 37, 24);
  f.text('small', `${t.temp}°`, 47, 31, C.grey);
}

// ---- D: word clock (to five minutes; dots for the extra minutes) ----
const NUM = ['TWELVE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN'];
const MINW = { 5: 'FIVE', 10: 'TEN', 15: 'QUARTER', 20: 'TWENTY', 25: 'TWENTY-FIVE', 30: 'HALF' };
function words(t) {
  const m5 = t.m - (t.m % 5);
  const hour = (h) => NUM[h % 12];
  if (m5 === 0) return [hour(t.h), "O'CLOCK"];
  if (m5 <= 30) return [MINW[m5], 'PAST', hour(t.h)];
  return [MINW[60 - m5], 'TO', hour(t.h + 1)];
}
function faceWords(f, t) {
  const w = words(t);
  const colors = w.length === 3 ? [C.label, C.dim, C.amber] : [C.amber, C.dim];
  const bases = w.length === 3 ? [8, 18, 28] : [13, 24];
  w.forEach((s, i) => ctext(f, '5x7', s, bases[i] + (w.length === 3 && i === 1 ? -1 : 0), colors[i]));
  // Extra minutes: up to four dots in the corners.
  const extra = t.m % 5;
  [[0, 0], [63, 0], [63, 31], [0, 31]].slice(0, extra).forEach(([x, y]) => px(f, x, y, C.grey));
}

// ---- E: sun/moon arc ----
function faceArc(f, t) {
  const now = t.h * 60 + t.m;
  const day = now >= SUNRISE && now < SUNSET;
  const horizon = 22;
  const arcY = (x) => horizon - 1 - Math.round(17 * Math.sin((x / 63) * Math.PI));
  for (let x = 0; x < 64; x += 2) px(f, x, arcY(x), day ? '#3a3a3a' : '#1f2a44');
  f.fill(0, horizon, 64, 1, C.div);
  let frac;
  if (day) frac = (now - SUNSET + (SUNSET - SUNRISE)) / (SUNSET - SUNRISE) - 1 + 1, frac = (now - SUNRISE) / (SUNSET - SUNRISE);
  else frac = (((now - SUNSET) + 1440) % 1440) / (1440 - (SUNSET - SUNRISE));
  const bx = Math.round(frac * 63), by = arcY(bx);
  if (day) { f.fill(bx - 1, by - 1, 3, 3, '#ffc800'); [[0, -3], [0, 3], [-3, 0], [3, 0]].forEach(([dx, dy]) => px(f, bx + dx, by + dy, '#a07800')); }
  else { f.fill(bx - 1, by - 1, 3, 3, '#e8dca0'); px(f, bx + 1, by - 1, '#000000'); px(f, bx + 1, by, '#000000'); }
  ctext(f, '5x7', hhmm(t), 31, C.clock);
  // Next event, small, bottom corners
  const fmt = (mm) => `${h12(Math.floor(mm / 60))}:${String(mm % 60).padStart(2, '0')}`;
  f.text('small', fmt(SUNRISE), 0, 31, C.dim);
  rtext(f, 'small', fmt(SUNSET), 63, 31, C.dim);
}

// ---- F: hour ring around a big 9x15 clock ----
function faceRing(f, t) {
  // Perimeter (180 px) lit clockwise from top center in proportion to the hour.
  const per = [];
  for (let x = 32; x < 64; x++) per.push([x, 0]);
  for (let y = 1; y < 32; y++) per.push([63, y]);
  for (let x = 62; x >= 0; x--) per.push([x, 31]);
  for (let y = 30; y >= 1; y--) per.push([0, y]);
  for (let x = 1; x < 32; x++) per.push([x, 0]);
  const lit = Math.round((t.m / 60) * per.length);
  per.forEach(([x, y], i) => px(f, x, y, i < lit ? C.dimAmber : '#1c1c1c'));
  per.forEach(([x, y], i) => { if (i % (per.length / 4) === 0) px(f, x, y, C.amber); });
  ctext(f, 'clock', hhmm(t), 17, C.clock);
  ctext(f, 'small', `${ampm(t.h)} ${t.date.slice(0, 3)}`, 26, C.grey);
}

const OPTIONS = [
  ['A  SEVEN-SEGMENT, GHOSTED SEGMENTS', faceSeg],
  ['B  SPLIT-FLAP TILES', faceFlap],
  ['C  ANALOG + SIDE PANEL', faceAnalog],
  ['D  WORD CLOCK (DOTS = EXTRA MINUTES)', faceWords],
  ['E  SUN/MOON ARC', faceArc],
  ['F  HOUR RING', faceRing],
];

// Sheet
const PW = 384, PH = 192, GAP = 16, LABEL = 28;
const W = GAP + 2 * (PW + GAP), H = OPTIONS.length * (LABEL + PH + GAP) + GAP;
const sheet = new PNG({ width: W, height: H });
for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set([24, 24, 24, 255], i);
function blit(src, ox, oy) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const s = (y * src.width + x) * 4;
    sheet.data.set(src.data.subarray(s, s + 4), ((oy + y) * W + ox + x) * 4);
  }
}
function label(s, ox, oy) {
  const f = new Frame(220, 8);
  f.text('small', s, 0, 6, '#d8d8d8');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 220; x++) {
    if (!f.get(x, y)[0]) continue;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) sheet.data.set([220, 220, 220, 255], ((oy + y * 3 + j) * W + ox + x * 3 + i) * 4);
  }
}
OPTIONS.forEach(([name, draw], r) => {
  const y = GAP + r * (LABEL + PH + GAP);
  label(name, GAP, y + 4);
  TIMES.forEach((t, c) => {
    const f = new Frame();
    draw(f, t);
    blit(PNG.sync.read(f.toPNG(6)), GAP + c * (PW + GAP), y + LABEL);
  });
});
fs.writeFileSync(OUT, PNG.sync.write(sheet));
console.log(OUT);
