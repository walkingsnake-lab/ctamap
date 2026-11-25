#!/usr/bin/env node
'use strict';
// Bus mockups (design spec §5, "Buses"): the decided design, drawn by the
// reference renderer. Made-up times, routes and stops.
//   node scripts/mock-bus.js   -> docs/board/mockups/bus/sheet.png

const fs = require('fs');
const path = require('path');
const { render } = require('../server/board/render');
const { Frame } = require('../server/board/raster');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'bus');
fs.mkdirSync(OUT, { recursive: true });
const now = 1795563720; // 5:42
const m = (...mins) => mins.map((x) => now + x * 60 - 20);
const bus = (lbl, mins, extra = {}) => ({ ln: 'BUS', lbl, t: m(...mins), s: mins.map(() => 0), a: 0, k: 1, ...extra });
const train = (ln, lbl, mins, extra = {}) => ({ ln, lbl, t: m(...mins), s: mins.map(() => 0), a: 0, ...extra });
const WX = { icon: 'cloudy', temp: 41, word: 'CLOUDY', hi: 44, lo: 35 };
const base = { v: 1, now, tzo: -21600, screen: 'transit', bright: 100, view: 'dest', hclock: true, warn: null, radar: { on: false, visit: null } };
const draw = (p) => render({ ...base, ...p }, { now });
const TRAINS = [train('RD', 'HOWARD', [1, 7, 15], { h: 0 }), train('RD', '95TH', [3, 12, 22], { h: 0 })];
const BUSY = [train('RD', 'HOWARD', [4, 11], { h: 0 }), train('RD', '95TH', [2, 9], { h: 0 }), train('BR', 'KIMBALL', [1, 8], { h: 0 }), train('PR', 'LOOP', [3], { h: 0 })];
const BUSES = [bus('22 SB', [6, 14], { h: 1 }), bus('147 SB', [1, 13], { h: 1 }), bus('96 WB', [], { h: 1 })];

const mocks = [
  ['A  TWO BUSES', draw({ header: 'BUSES', rows: BUSES.slice(0, 2), wx: WX })],
  ['B  THREE, ONE QUIET', draw({ header: 'BUSES', rows: BUSES, wx: WX })],
  ['C  RENAMED', draw({ header: 'BUSES', rows: [bus('TO WORK', [6, 14]), bus('DOWNTOWN', [1, 13]), bus('96 WEST', [4, 19])], wx: WX })],
  ['D  128: TRAINS | BUSES', draw({ cols: 128, view: 'split', halves: ['TRAINS', 'BUSES'], header: 'MORSE', wx: null, rows: [...TRAINS, ...BUSES] })],
  ['E  128: A BUSY STATION', draw({ cols: 128, view: 'cols2', header: 'BELMONT', wx: null, rows: [...BUSY, ...BUSES] })],
];

// Sheet: three 64 panels (or one 128 and one 64) per line.
const GAP = 6, TH = 8, PW = 64, PH = 32, COLS = 3;
const cells = [];
let col = 0, line = 0;
for (const [title, f] of mocks) {
  const span = f.w > 64 ? 2 : 1;
  if (col + span > COLS) { col = 0; line++; }
  cells.push({ title, f, col, line });
  col += span;
}
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, (line + 1) * (TH + PH + GAP) + GAP);
for (const c of cells) {
  const ox = GAP + c.col * (PW + GAP), oy = GAP + c.line * (TH + PH + GAP);
  sheet.text('small', c.title, ox, oy + 5, '#808080');
  // Unlit LEDs a step above the page, so each panel's edge shows.
  for (let y = 0; y < PH; y++) for (let x = 0; x < c.f.w; x++) {
    const p = c.f.get(x, y);
    sheet.set(ox + x, oy + TH + y, p[0] || p[1] || p[2] ? p : [5, 5, 5]);
  }
}
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(6, [0, 0, 0]));
console.log(`wrote ${path.relative(process.cwd(), path.join(OUT, 'sheet.png'))}`);
