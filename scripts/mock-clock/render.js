#!/usr/bin/env node
'use strict';
// Renders every clock face in faces.js at a fixed time (made-up data) to
// docs/board/mockups/clock/<id>.png plus sheet.png. Colors are cut to the
// panel's 5 bits per channel, as on the board.
//   node scripts/mock-clock/render.js [HH:MM:SS]

const fs = require('fs');
const path = require('path');
const { Frame } = require('../../server/board/raster');
const { packFonts } = require('../../server/board/fonts');
const icons = require('../../server/board/icons');
const { FACES, render } = require('./faces');

const OUT = path.join(__dirname, '..', '..', 'docs', 'board', 'mockups', 'clock');
const env = { fonts: packFonts(), icons: { ICONS: icons.ICONS, PALETTE: icons.PALETTE } };
const [hh, mm, ss] = (process.argv[2] || '10:09:37').split(':').map(Number);
const when = new Date(2026, 9, 17, hh, mm, ss, 400);

const q5 = (v) => Math.round(Math.max(0, Math.min(255, v))) & 0xf8;
function toFrame(led) {
  const f = new Frame(led.w, led.h);
  for (let y = 0; y < led.h; y++) for (let x = 0; x < led.w; x++) f.set(x, y, led.get(x, y).map(q5));
  return f;
}

fs.mkdirSync(OUT, { recursive: true });
const panels = FACES.map((face) => {
  const f = toFrame(render(face, when, env));
  fs.writeFileSync(path.join(OUT, `${face.id}.png`), f.toPNG(10));
  return [face.title.toUpperCase(), f];
});

const COLS = 3, PW = 64, PH = 32, GAP = 4, TH = 8;
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, Math.ceil(panels.length / COLS) * (PH + TH + GAP) + GAP);
panels.forEach(([title, f], i) => {
  const ox = GAP + (i % COLS) * (PW + GAP), oy = GAP + Math.floor(i / COLS) * (PH + TH + GAP);
  sheet.text('small', title, ox, oy + 5, '#606060');
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y));
});
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(6));
console.log(`wrote ${panels.length} faces + sheet.png to ${path.relative(process.cwd(), OUT)}`);
