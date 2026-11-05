#!/usr/bin/env node
'use strict';
// Renders the clock faces in faces.js at a fixed time (made-up data) to
// docs/board/mockups/clock/<id>.png plus a contact sheet per round. Colors
// are cut to the panel's 5 bits per channel, as on the board.
//   node scripts/mock-clock/render.js [HH:MM:SS]

const fs = require('fs');
const path = require('path');
const { Frame } = require('../../server/board/raster');
const { packFonts } = require('../../server/board/fonts');
const icons = require('../../server/board/icons');
const { FACES, render } = require('./faces');
require('./faces-r4'); // pushes round 4 onto FACES
const { redLine } = require('./env');

const OUT = path.join(__dirname, '..', '..', 'docs', 'board', 'mockups', 'clock');
const env = { fonts: packFonts(), icons: { ICONS: icons.ICONS, PALETTE: icons.PALETTE }, redLine: redLine(), digitFonts: require('./digit-fonts.json') };
const r5 = require('./faces-r5').build(env); // pushes round 5 (one group per font) onto FACES
// Round 2 is shown at night so the north sky has stars; an argument overrides both.
const at = (hms) => { const [hh, mm, ss] = hms.split(':').map(Number); return new Date(2026, 9, 17, hh, mm, ss, 400); };
const when = (face) => at(process.argv[2] || (face.group === 'R2' ? '21:42:37' : '10:09:37'));

const q5 = (v) => Math.round(Math.max(0, Math.min(255, v))) & 0xf8;
function toFrame(led) {
  const f = new Frame(led.w, led.h);
  for (let y = 0; y < led.h; y++) for (let x = 0; x < led.w; x++) f.set(x, y, led.get(x, y).map(q5));
  return f;
}

fs.mkdirSync(OUT, { recursive: true });
const SHEETS = { 'sheet.png': ['KEEP', 'R1'], 'sheet-round2.png': ['KEEP', 'R2'], 'sheet-round4.png': ['R4'], 'sheet-round4-128.png': ['R4W'] };
SHEETS['sheet-round5-64.png'] = r5.map(([g]) => g); // the 64-wide panels of every font
SHEETS['sheet-round5-128.png'] = r5.map(([g]) => g);
const frames = new Map(FACES.map((face) => {
  const f = toFrame(render(face, when(face), env));
  fs.writeFileSync(path.join(OUT, `${face.id}.png`), f.toPNG(10));
  return [face.id, f];
}));

const PH = 32, GAP = 4, TH = 8;
for (const [file, groups] of Object.entries(SHEETS)) {
  const wide = file.endsWith('-128.png');
  let faces = FACES.filter((face) => groups.includes(face.group));
  if (file.startsWith('sheet-round5')) faces = faces.filter((face) => (face.w || 64) === (wide ? 128 : 64));
  const PW = faces[0].w || 64, COLS = PW > 64 || file.startsWith('sheet-round5') ? 2 : 3;
  const label = (face) => (face.group.startsWith('R5-') ? `${env.digitFonts[face.group.slice(3)].label} ${face.title.startsWith('Big') ? 'big' : face.title.startsWith('Day') ? 'dtd' : 'panel'}` : face.title).toUpperCase();
  const panels = faces.map((face) => [label(face), frames.get(face.id)]);
  const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, Math.ceil(panels.length / COLS) * (PH + TH + GAP) + GAP);
  panels.forEach(([title, f], i) => {
    const ox = GAP + (i % COLS) * (PW + GAP), oy = GAP + Math.floor(i / COLS) * (PH + TH + GAP);
    sheet.text('small', title, ox, oy + 5, '#606060');
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y));
  });
  fs.writeFileSync(path.join(OUT, file), sheet.toPNG(6));
}
console.log(`wrote ${FACES.length} faces + ${Object.keys(SHEETS).length} sheets to ${path.relative(process.cwd(), OUT)}`);
