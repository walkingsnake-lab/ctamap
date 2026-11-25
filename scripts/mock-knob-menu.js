#!/usr/bin/env node
'use strict';
// The knob menu (design spec §10, "Knob menu"), drawn by draw.js's
// renderMenu: each item chosen, the two that ask first, and two panels.
// Colors cut to the panel's 5 bits per channel.
//   node scripts/mock-knob-menu.js   -> docs/board/mockups/knob/menu.png

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const draw = require('../server/board/render');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'knob');
const p = { v: 1, now: 1790000000, tzo: -300, screen: 'transit', bright: 100, tu: 'F' };
const m = (sel, confirm) => ({ screen: 'menu', menu: { sel, confirm } });
const ROWS = [
  ['TWIST: EACH ITEM', [['SCREEN OFF', p, m(0)], ['UNITS', p, m(1)], ['WIFI SETUP', p, m(2)], ['RESTART', p, m(3)], ['EXIT', p, m(4)]]],
  ['PRESS', [['UNITS: NOW C', { ...p, tu: 'C' }, m(1)], ['WIFI SETUP: ASKS', p, m(2, true)], ['RESTART: ASKS', p, m(3, true)]]],
  ['TWO PANELS', [['', { ...p, cols: 128 }, m(0)], ['', { ...p, cols: 128 }, m(3, true)]]],
];

const q5 = (v) => v & 0xf8;
const GAP = 4, TH = 8, RT = 9, PH = 32;
const width = (panels) => panels.reduce((w, [, q]) => w + (q.cols || 64) + GAP, GAP);
const sheet = new Frame(Math.max(...ROWS.map(([, ps]) => width(ps))), ROWS.length * (RT + TH + PH + GAP) + GAP);
let oy = GAP;
for (const [title, panels] of ROWS) {
  sheet.text('small', title, GAP, oy + 5, '#808080');
  oy += RT;
  let ox = GAP;
  for (const [label, q, o] of panels) {
    const f = draw.render(q, o);
    sheet.text('small', label, ox, oy + 5, '#5a5a5a');
    for (let y = 0; y < PH; y++) for (let x = 0; x < f.w; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y).map(q5));
    ox += f.w + GAP;
  }
  oy += TH + PH + GAP;
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'menu.png'), sheet.toPNG(6));
console.log(`wrote ${path.relative(process.cwd(), path.join(OUT, 'menu.png'))}`);
