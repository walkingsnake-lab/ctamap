#!/usr/bin/env node
'use strict';
// Busy-station mockups (design spec §5, "Busy stations"): alternatives to
// the by-time view (position digit, "3m"), at 64 and beside buses at 128.
// Frames come from the real renderer; bus rows use a stand-in line code
// recolored grey. Made-up times.
//   node scripts/mock-bus-busy.js   -> docs/board/mockups/bus/sheet-busy.png

const fs = require('fs');
const path = require('path');
const { render } = require('../server/board/render');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'bus');
fs.mkdirSync(OUT, { recursive: true });
const BUS = [0x8a, 0x8a, 0x8a], PINK = [0xe2, 0x7e, 0xa6];
const now = 1795563720;
const m = (...mins) => mins.map((x) => now + x * 60 - 20);
const bus = (lbl, mins, extra = {}) => ({ ln: 'PK', lbl, t: m(...mins), s: mins.map(() => 0), a: 0, ...extra });
const WX = { icon: 'cloudy', temp: 41, word: 'CLOUDY', hi: 44, lo: 35 };
const base = { v: 1, now, tzo: -21600, screen: 'transit', bright: 100, view: 'dest', hclock: true, warn: null, radar: { on: false, visit: null } };
function recolor(f) {
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const p = f.get(x, y);
    if (!p[0] || p[0] === p[1]) continue;
    const k = p[0] / PINK[0];
    if (Math.abs(p[1] - PINK[1] * k) < 3 && Math.abs(p[2] - PINK[2] * k) < 3) f.set(x, y, BUS.map((v) => Math.round(v * k)));
  }
  return f;
}
const draw = (p) => recolor(render({ ...base, ...p }, { now }));
const mocks = [];
const add = (name, title, f) => mocks.push({ name, title, f });


const row = (ln, lbl, mins, extra = {}) => ({ ln, lbl, t: m(...mins), s: mins.map(() => 0), a: 0, ...extra });
// Belmont at rush: six destinations, soonest first.
const NEXT = [['BR', 'KIMBALL', 1], ['RD', '95TH', 2], ['PR', 'LOOP', 3], ['RD', 'HOWARD', 4], ['BR', 'LOOP', 5], ['PR', 'LINDEN', 7]];
// Only the first row's time stays amber (x0..x1).
function dimLater(f, x0 = 0, x1 = 63) {
  const amber = (p) => p[0] === 0xff && p[1] === 0xb0 && p[2] === 0;
  let first = -1;
  for (let y = 0; y < 32; y++) for (let x = x0; x <= x1; x++) {
    if (!amber(f.get(x, y))) continue;
    if (first < 0) first = y;
    if (y > first + 4) f.set(x, y, [0x66, 0x46, 0]);
  }
  return f;
}
add('now', 'A  NOW', draw({ header: 'BELMONT', view: 'chrono', wx: null, rows: NEXT.map(([ln, l, t], i) => row(ln, l, [t], { rn: String(400 + i) })) }));
add('clean', 'B  PLAIN LIST', dimLater(draw({ header: 'BELMONT', wx: null, rows: NEXT.slice(0, 4).map(([ln, l, t]) => row(ln, l, [t])) })));
add('clean5', 'C  PLAIN, NO HEADER', dimLater(draw({ header: null, wx: null, rows: NEXT.slice(0, 5).map(([ln, l, t]) => row(ln, l, [t])) })));
add('soonest', 'D  SOONEST 4 ROWS', draw({ header: 'BELMONT', wx: null, rows: [row('BR', 'KIMBALL', [1, 8, 15]), row('RD', '95TH', [2, 9, 16]), row('PR', 'LOOP', [3, 14]), row('RD', 'HOWARD', [4, 11, 19])] }));
add('wide', 'E  128: PLAIN LIST AND BUSES', dimLater(draw({
  cols: 128, view: 'cols2', header: 'BELMONT', wx: null,
  rows: [...NEXT.slice(0, 4).map(([ln, l, t]) => row(ln, l, [t], { h: 0 })), bus('22 SB', [6, 14], { h: 1 }), bus('77 WB', [1, 13], { h: 1 }), bus('77 EB', [4, 19], { h: 1 })],
}), 0, 61));
const GAP = 6, TH = 8, PW = 64, PH = 32, COLS = 3;
const cells = [];
let col = 0, line = 0;
for (const mk of mocks) {
  const span = mk.f.w > 64 ? 2 : 1;
  if (col + span > COLS) { col = 0; line++; }
  cells.push({ ...mk, col, line });
  col += span;
}
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, (line + 1) * (TH + PH + GAP) + GAP);
for (const c of cells) {
  const ox = GAP + c.col * (PW + GAP), oy = GAP + c.line * (TH + PH + GAP);
  sheet.text('small', c.title, ox, oy + 5, '#808080');
  for (let y = 0; y < PH; y++) for (let x = 0; x < c.f.w; x++) {
    const p = c.f.get(x, y);
    sheet.set(ox + x, oy + TH + y, p[0] || p[1] || p[2] ? p : [5, 5, 5]);
  }
}
fs.writeFileSync(path.join(OUT, 'sheet-busy.png'), sheet.toPNG(6, [0, 0, 0]));
