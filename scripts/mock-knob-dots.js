#!/usr/bin/env node
'use strict';
// The 64 peek bar's variant dots with more variants than the band holds
// (7 clock faces): today's column, which runs off the band, against the
// windowed column (5 slots that scroll with the lit dot, dimmer end slots
// where more lie beyond). Both drawn by draw.js; "now" from a copy of the
// renderer before the change, passed as ORIG (a server/board directory).
// Colors cut to the panel's 5 bits per channel.
//   ORIG=/tmp/orig/server/board node scripts/mock-knob-dots.js
//     -> docs/board/mockups/knob/dots-window.png

const fs = require('fs');
const path = require('path');
const B = path.join(__dirname, '..', 'server', 'board');
const { Frame } = require(path.join(B, 'raster'));
const draw = require(path.join(B, 'render'));
const orig = process.env.ORIG ? require(path.join(process.env.ORIG, 'render')) : null;
const { build } = require(path.join(__dirname, '..', 'firmware', 'tests', 'scenarios'));

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'knob');
(async () => {
const s = (await build()).find((x) => x.name === 'peek bars');
const bytes = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Uint8Array.from(v)])) : undefined);
const frames = bytes(s.frames), clouds = bytes(s.clouds);
const p = s.payload, dim = { ...p, bright: 40 };
const CLOCK = 2, WX = 1;
const pk = (k, vi, extra = {}) => ({ screen: 'peek', peek: { k, vi, ...extra } });
const gl = (from, to, t, k = CLOCK) => pk(k, to, { glide: { k, vi: from, t, axis: 'y' } });
const FACE = ['SKY', '70S', 'DIAL', 'MAP', 'GRAD', 'BIG', 'DATE'];

const ROWS = [
  ['NOW: 7 FACES, THE COLUMN RUNS OFF THE BAND', [
    ['SKY (1 OF 7)', orig, p, pk(CLOCK, 0)], ['MAP (4)', orig, p, pk(CLOCK, 3)], ['DATE (7)', orig, p, pk(CLOCK, 6)],
  ]],
  ['WINDOWED: 5 SLOTS, LIT DOT HELD IN THE MIDDLE, DIM END = MORE', FACE.map((n, i) => [`${n} (${i + 1})`, draw, p, pk(CLOCK, i)])],
  ['PRESS GLIDES (MID-SLIDE) AND OTHER CATEGORIES', [
    ['70S > DIAL', draw, p, gl(1, 2, 110)], ['DIAL > MAP', draw, p, gl(2, 3, 110)], ['MAP > GRAD', draw, p, gl(3, 4, 110)],
    ['BIG > DATE', draw, p, gl(5, 6, 110)], ['DATE > SKY', draw, p, gl(6, 0, 90)], ['WX (4)', draw, p, pk(WX, 2)], ['RAIL (2)', draw, p, pk(0, 1)],
  ]],
  ['NIGHT (40%): DOES THE DIM END SURVIVE?', [
    ['SKY', draw, dim, pk(CLOCK, 0)], ['MAP', draw, dim, pk(CLOCK, 3)], ['DATE', draw, dim, pk(CLOCK, 6)],
  ]],
];

const q5 = (v) => v & 0xf8;
fs.mkdirSync(OUT, { recursive: true });
const PW = 64, PH = 32, GAP = 4, TH = 8, RT = 9, COLS = Math.max(...ROWS.map(([, ps]) => ps.length));
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, ROWS.length * (RT + TH + PH + GAP) + GAP);
let oy = GAP;
for (const [title, panels] of ROWS) {
  sheet.text('small', title, GAP, oy + 5, '#808080');
  oy += RT;
  panels.forEach(([label, r, pay, o], j) => {
    if (!r) return;
    const f = r.render(pay, { ...o, frames, clouds });
    const ox = GAP + j * (PW + GAP);
    sheet.text('small', label, ox, oy + 5, '#5a5a5a');
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y).map(q5));
  });
  oy += TH + PH + GAP;
}
fs.writeFileSync(path.join(OUT, 'dots-window.png'), sheet.toPNG(5));
console.log(`wrote ${path.relative(process.cwd(), path.join(OUT, 'dots-window.png'))}`);
// Zoom: the bar around the chosen icon (x cx..cx+CW-1, rows 18-31), the
// rows above the band included so a dot running off it shows.
const CW = 14, CY = 18, CH = 14, ZG = 6, ZT = 7;
const icx = (k) => 4 + k * 12 - 2;
const zoom = new Frame(COLS * CW + (COLS + 1) * ZG, ROWS.length * (RT + ZT + CH + ZG) + ZG);
oy = ZG;
for (const [title, panels] of ROWS) {
  zoom.text('small', title.split(/[:(]/)[0], ZG, oy + 5, '#808080');
  oy += RT;
  panels.forEach(([label, r, pay, o], j) => {
    if (!r) return;
    const f = r.render(pay, { ...o, frames, clouds });
    const ox = ZG + j * (CW + ZG), x0 = icx(o.peek.k);
    zoom.text('small', label.split(' (')[0].split(' >')[0], ox, oy + 5, '#5a5a5a');
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) zoom.set(ox + x, oy + ZT + y, f.get(x0 + x, CY + y).map(q5));
    // A grey tick under the panel's last row: below it is off the panel.
    zoom.fill(ox, oy + ZT + CH, CW, 1, '#202020');
  });
  oy += ZT + CH + ZG;
}
fs.writeFileSync(path.join(OUT, 'dots-window-zoom.png'), zoom.toPNG(14));
console.log('wrote dots-window-zoom.png');
})();
