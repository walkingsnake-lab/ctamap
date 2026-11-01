#!/usr/bin/env node
'use strict';
// Big-number font candidates for the weather screen's temperature (Nov 2026),
// shown in the round-2 Poster layout with the 8x8 icons. Not implemented;
// made-up data. Every font has tabular digits (rolls never shift neighbors).
//
// Fonts: X11 9x15 Bold (current), X11 10x20, X11 7x14 Bold (public domain,
// from hzeller/rpi-rgb-led-matrix/fonts), and two drawn here: Block and
// Rounded (8 x 13, 2px strokes).
//
// Writes docs/board/mockups/weather/bignum/<font>-<state>.png and sheet.png.
// Usage: node scripts/mock-weather-bignum.js <hzeller fonts dir> [outDir]

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');
const { loadBDF } = require('../server/board/bdf');
const icons = require('../server/board/icons');
const G = require('../server/board/glyphs');

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node scripts/mock-weather-bignum.js <hzeller fonts dir> [outDir]'); process.exit(1); }
const OUT = process.argv[3] || path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'bignum');
fs.mkdirSync(OUT, { recursive: true });

const C = { value: '#d8d8d8', label: '#8f8f8f', tornado: '#ff2020' };
const s = (cp) => String.fromCodePoint(cp);
const px = (f, x, y, c) => { if (x >= 0 && x < 64 && y >= 0 && y < 32) f.fill(x, y, 1, 1, c); };
const W = (str) => measure('small', str);
const runsWidth = (rs) => rs.reduce((w, [t]) => w + W(t) + 1, -1);
function runs(f, rs, x, base) { for (const [t, c] of rs) x = f.text('small', t, x, base, c); return x; }
const art = (rows, x, y, f, c) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') px(f, x + i, y + j, c); }));

// ---------- fonts: { name, h (ink rows), cw (cell), gap, digits{ch: rows}, deg rows, minus [w, h] } ----------
// X11 BDF digits cropped to their shared ink box (tabular: one cell width).
function fromBDF(name, file, deg, minus) {
  const font = loadBDF(file);
  const gs = [...'0123456789'].map((ch) => font.glyphs.get(ch.codePointAt(0)));
  // Each glyph in baseline coordinates: row r of the bbx is at y = top - r,
  // with top = yoff + h - 1 (y up). Shared ink box over all digits.
  let x0 = 99, x1 = -99, y0 = 99, y1 = -99;
  for (const g of gs) {
    const [w, h, xo, yo] = g.bbx;
    g.rows.forEach((row, r) => row.forEach((b, c) => {
      if (!b) return;
      const x = xo + c, y = yo + h - 1 - r;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }));
  }
  const digits = {};
  gs.forEach((g, i) => {
    const [w, h, xo, yo] = g.bbx;
    const grid = [];
    for (let y = y1; y >= y0; y--) {
      let line = '';
      for (let x = x0; x <= x1; x++) {
        const r = yo + h - 1 - y, c = x - xo;
        line += r >= 0 && r < h && c >= 0 && c < w && g.rows[r][c] ? '#' : '.';
      }
      grid.push(line);
    }
    digits[String(i)] = grid;
  });
  return { name, h: y1 - y0 + 1, cw: x1 - x0 + 1, gap: gs[0].dw - (x1 - x0 + 1), digits, deg, minus };
}
const RING3 = ['###', '#.#', '###'];
const RING4 = ['.##.', '#..#', '#..#', '.##.'];
const SQ4 = ['####', '#..#', '#..#', '####'];

const BLOCK = {
  name: 'BLOCK', h: 13, cw: 8, gap: 2, deg: SQ4, minus: [5, 2],
  digits: {
    0: ['########', '########', ...Array(9).fill('##....##'), '########', '########'],
    1: ['...##...', '..###...', '.####...', ...Array(8).fill('...##...'), '.######.', '.######.'],
    2: ['########', '########', '......##', '......##', '......##', '########', '########', '##......', '##......', '##......', '##......', '########', '########'],
    3: ['########', '########', '......##', '......##', '......##', '..######', '..######', '......##', '......##', '......##', '......##', '########', '########'],
    4: [...Array(5).fill('##....##'), '########', '########', ...Array(6).fill('......##')],
    5: ['########', '########', '##......', '##......', '##......', '########', '########', '......##', '......##', '......##', '......##', '########', '########'],
    6: ['########', '########', '##......', '##......', '##......', '########', '########', '##....##', '##....##', '##....##', '##....##', '########', '########'],
    7: ['########', '########', ...Array(11).fill('......##')],
    8: ['########', '########', '##....##', '##....##', '##....##', '########', '########', '##....##', '##....##', '##....##', '##....##', '########', '########'],
    9: ['########', '########', '##....##', '##....##', '##....##', '########', '########', '......##', '......##', '......##', '......##', '########', '########'],
  },
};

const ROUND = {
  name: 'ROUNDED', h: 13, cw: 8, gap: 2, deg: RING4, minus: [5, 2],
  digits: {
    0: ['..####..', '.######.', '###..###', ...Array(7).fill('##....##'), '###..###', '.######.', '..####..'],
    1: ['...##...', '..###...', '.####...', ...Array(10).fill('...##...')],
    2: ['..####..', '.######.', '###..###', '##....##', '......##', '.....###', '....###.', '...###..', '..###...', '.###....', '###.....', '########', '########'],
    3: ['..####..', '.######.', '###..###', '......##', '......##', '...####.', '...####.', '......##', '......##', '......##', '###..###', '.######.', '..####..'],
    4: ['.....##.', '....###.', '...####.', '..##.##.', '.##..##.', '##...##.', '##...##.', '##...##.', '########', '########', '.....##.', '.....##.', '.....##.'],
    5: ['########', '########', '##......', '##......', '##.###..', '#######.', '###..###', '......##', '......##', '......##', '###..###', '.######.', '..####..'],
    6: ['..####..', '.######.', '###..###', '##......', '##......', '##.###..', '#######.', '###..###', '##....##', '##....##', '###..###', '.######.', '..####..'],
    7: ['########', '########', '......##', '.....###', '.....##.', '....###.', '....##..', '...###..', '...##...', '...##...', '...##...', '...##...', '...##...'],
    8: ['..####..', '.######.', '###..###', '##....##', '###..###', '.######.', '.######.', '###..###', '##....##', '##....##', '###..###', '.######.', '..####..'],
    9: ['..####..', '.######.', '###..###', '##....##', '##....##', '###..###', '.#######', '..###.##', '......##', '......##', '###..###', '.######.', '..####..'],
  },
};

const FONTS = [
  fromBDF('9x15 BOLD (CURRENT)', path.join(SRC, '9x15B.bdf'), RING3, [5, 2]),
  fromBDF('7x14 BOLD', path.join(SRC, '7x14B.bdf'), RING3, [4, 2]),
  fromBDF('10x20', path.join(SRC, '10x20.bdf'), RING4, [5, 1]),
  BLOCK,
  ROUND,
];
for (const F of FONTS) for (const [d, rows] of Object.entries(F.digits)) {
  if (rows.length !== F.h || rows.some((r) => r.length !== F.cw)) throw new Error(`${F.name} ${d}: ${rows.length} x ${rows[0].length}`);
}

// Temperature: tabular digits, minus bar centered on the ink height, degree
// 1px after the last digit, top-aligned. Returns the width when f is null.
function bigTemp(f, F, t, x, top, c = C.value) {
  const x0 = x;
  if (t < 0) { if (f) f.fill(x, top + Math.floor((F.h - F.minus[1]) / 2), F.minus[0], F.minus[1], c); x += F.minus[0] + F.gap; }
  [...String(Math.abs(t))].forEach((d) => { if (f) art(F.digits[d], x, top, f, c); x += F.cw + F.gap; });
  x = x - F.gap + 1;
  if (f) art(F.deg, x, top, f, c);
  return x + F.deg[0].length - x0;
}

// ---------- states (all ten digits appear) ----------
const STATES = [
  { id: 'a-57', temp: 57, icon: 'pcloudy_day', word: 'PT CLOUDY', feels: 55, wind: 'NW 12', hi: 63, lo: 49 },
  { id: 'b-36', temp: 36, icon: 'rain', word: 'RAIN', feels: 29, wind: 'E 18', hi: 39, lo: 33 },
  { id: 'c-89', temp: 89, icon: 'moon', word: 'CLEAR', feels: 96, wind: 'S 5', hi: 94, lo: 76 },
  { id: 'd-m12', temp: -12, icon: 'snow', word: 'SNOW', feels: -27, wind: 'NW 22', hi: -5, lo: -14 },
  { id: 'e-104', temp: 104, icon: 'sun', word: 'SUNNY', feels: 112, wind: 'SW 9', hi: 106, lo: 83 },
];

// ---------- Poster layout, fitted to the font's height ----------
// Rows: hero (temperature + high-over-low stack), icon line (8), bottom line
// (5). The leftover rows split evenly into the two margins and two gaps.
function poster(f, F, w) {
  const heroH = Math.max(F.h, 11);
  const spare = 32 - (heroH + 8 + 5);
  const g = [0, 0, 0, 0].map((_, i) => Math.floor(spare / 4) + (i < spare % 4 ? 1 : 0));
  const [m0, g1, g2] = [g[0], g[1], g[2]];
  const heroTop = m0, iconTop = heroTop + heroH + g1, lineTop = iconTop + 8 + g2;
  const hl = [[s(G.UP), C.label], [`${w.hi}°`, C.value]], ll = [[s(G.DOWN), C.label], [`${w.lo}°`, C.value]];
  const sw = Math.max(runsWidth(hl), runsWidth(ll));
  const tw = bigTemp(null, F, w.temp, 0, 0);
  const x = Math.round((64 - (tw + 4 + sw)) / 2);
  bigTemp(f, F, w.temp, x, heroTop + Math.floor((heroH - F.h) / 2));
  const st = heroTop + Math.floor((heroH - 11) / 2);
  runs(f, hl, x + tw + 4, st + 5);
  runs(f, ll, x + tw + 4, st + 11);
  const iw = 8 + 3 + W(w.word), ix = Math.round((64 - iw) / 2);
  icons.ICONS[w.icon].forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') px(f, ix + i, iconTop + j, icons.PALETTE[ch]); }));
  f.text('small', w.word, ix + 11, iconTop + 6, C.value);
  const fr = [['FEELS ', C.label], [`${w.feels}°`, C.value]], wr = [[w.wind, C.value]];
  const bw = runsWidth(fr) + 6 + runsWidth(wr), bx = Math.round((64 - bw) / 2);
  runs(f, fr, bx, lineTop + 5);
  runs(f, wr, bx + runsWidth(fr) + 6, lineTop + 5);
}

// ---------- output ----------
const frames = FONTS.map((F) => STATES.map((w) => {
  const f = new Frame();
  poster(f, F, w);
  const slug = F.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  fs.writeFileSync(path.join(OUT, `${slug}-${w.id}.png`), f.toPNG(10));
  return f;
}));
const SC = 5, GAP = 12, fw = 64 * SC, fh = 32 * SC;
const sheet = new PNG({ width: STATES.length * (fw + GAP) + GAP, height: FONTS.length * (fh + GAP) + GAP });
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
FONTS.forEach((F) => console.log(`${F.name}: ${F.cw}x${F.h}, gap ${F.gap}, 104° = ${bigTemp(null, F, 104, 0, 0)}px, -12° = ${bigTemp(null, F, -12, 0, 0)}px`));
console.log(`wrote ${OUT}`);
