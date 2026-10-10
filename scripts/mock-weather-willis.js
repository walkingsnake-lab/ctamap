#!/usr/bin/env node
'use strict';
// Willis Tower proportion study, next to Hancock variant A (7>4 steps).
//
// Willis is a 3x3 grid of square tubes. Tops (floors): NW 50, N 90, NE 66 /
// W 108, C 108, E 90 / SW 66, S 90, SE 50. Antennas stand on the W and C tubes;
// the west one is ~20 ft taller. Viewed from the south (west on the left) the
// two antennas show side by side, and the outline is the tallest tube in each
// column: W 108, C 108, E 90. The lower setbacks show only as faces in front.
// Louver bands (dark) at floors ~31, 64, 88, 106.
//
// Hancock: roof ~78% of Willis's, antenna tips ~87%; east antenna (right from
// the south) ~378 ft vs west ~350 ft since 2002.
//
// Scale: Hancock roof 18 rows -> Willis roof 23 rows; floor f -> 23 * f / 108.
// Writes docs/board/mockups/weather/willis/.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'willis');
fs.mkdirSync(OUT, { recursive: true });

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (c0, c1, k) => hex(rgb(c0).map((v, i) => v + (rgb(c1)[i] - v) * k));
function ramp(stops, v) {
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [v0, c0] = stops[i - 1]; return mix(c0, stops[i][1], (v - v0) / (stops[i][0] - v0)); }
  return stops[stops.length - 1][1];
}

const W = 64, H = 32, GROUND = 31;
const SKY = (y) => ramp([[0, '#06103a'], [14, '#2a1450'], [24, '#7a2c30'], [31, '#c0561a']], y);
const WILLIS_H = 23;
const rowOf = (floor) => GROUND + 1 - Math.round(WILLIS_H * floor / 108);
const LOUVERS = [31, 64, 88, 106];

const C = { box: ['#22223a', '#2c2c46'], front: '#5c5c8c', mid: '#48486e', back: '#38385a', mark: '#4e4e78', band: '#1a1a2a', ant: '#5a5a70' };

// Each pixel: null (sky) or a color for the lit style; silhouette draws all black.
function scene(v) {
  const px = Array.from({ length: H }, () => new Array(W).fill(null));
  const ants = [];
  const rect = (x, w, top, c) => { for (let y = top; y <= GROUND; y++) for (let i = x; i < x + w; i++) if (i >= 0 && i < W) px[y][i] = c; };

  [[0, 4, 26], [4, 4, 23], [19, 4, 22], [23, 5, 25], [28, 4, 21], [32, 5, 24], [37, 3, 26], [51, 5, 25], [56, 8, 27]]
    .forEach(([x, w, t], i) => rect(x, w, t, C.box[i % 2]));

  // Willis.
  const x0 = 7, tw = v.tube;
  if (v.view === 'east') {
    // From the east (south on the left): columns S-row, middle row, N-row.
    const cols = [[90, 66, 50], [108, 108, 90], [90, 50, 66]];   // [tallest, ...]
    cols.forEach(([top], c) => rect(x0 + c * tw, tw, rowOf(top), C.mark));
    const ax = x0 + tw + Math.floor(tw / 2);
    ants.push([ax, rowOf(108) - 5, rowOf(108)]);   // W and C antennas line up
  } else {
    // From the south: per column [front (S row), middle, back (N row)] floors.
    const cols = [[66, 108, 50], [90, 108, 90], [50, 90, 66]];
    cols.forEach(([front, mid, back], c) => {
      const x = x0 + c * tw, tallest = Math.max(front, mid, back);
      for (let y = rowOf(tallest); y <= GROUND; y++) {
        const floor = (GROUND + 1 - y) / WILLIS_H * 108;
        let col = C.mark;
        if (v.depth) col = floor <= front ? C.front : floor <= mid ? C.mid : C.back;
        for (let i = x; i < x + tw; i++) px[y][i] = col;
      }
    });
    const ax = x0 + Math.floor(tw / 2), bx = x0 + tw + Math.floor(tw / 2);
    ants.push([ax, rowOf(108) - 5, rowOf(108)], [bx, rowOf(108) - 4, rowOf(108)]);   // west taller
  }
  if (v.bands) for (const fl of LOUVERS) {
    const y = rowOf(fl);
    for (let i = x0; i < x0 + 3 * tw; i++) if (px[y][i]) px[y][i] = C.band;
  }

  // Hancock A: 7 -> 4, hard steps, roof row 14; east (right) antenna taller.
  const cx = 46, T = 14, base = 7, top = 4;
  for (let y = T; y <= GROUND; y++) {
    const w = top + (base - top) * (y - T) / (GROUND - T), l = cx - w / 2, r = cx + w / 2;
    for (let i = Math.floor(l); i < Math.ceil(r); i++) if (Math.min(i + 1, r) - Math.max(i, l) >= 0.5) px[y][i] = C.mark;
  }
  const hl = Math.round(cx - top / 2);
  ants.push([hl, T - 5, T], [hl + top - 1, T - 6, T]);
  return { px, ants };
}

function draw(f, s, style) {
  const lit = style === 'lit';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = s.px[y][x];
    if (lit) { if (c) f.fill(x, y, 1, 1, c); } else f.fill(x, y, 1, 1, c ? '#000000' : SKY(y));
  }
  for (const [x, t, roof] of s.ants) {
    for (let y = t; y < roof; y++) { if (lit) f.fill(x, y, 1, 1, C.ant); else f.set(x, y, [0, 0, 0]); }
    f.fill(x, t, 1, 1, '#ff2020');
  }
}

const VARIANTS = [
  ['a', 'A SOUTH 3PX', { tube: 3 }],
  ['b', 'B DEPTH', { tube: 3, depth: true }],
  ['c', 'C BANDS', { tube: 3, bands: true }],
  ['d', 'D DEPTH+BANDS', { tube: 3, depth: true, bands: true }],
  ['e', 'E SLIM 2PX', { tube: 2, depth: true }],
  ['f', 'F FROM EAST', { tube: 3, view: 'east' }],
];

const panels = [];
for (const [key, title, v] of VARIANTS) {
  const s = scene(v);
  for (const style of ['lit', 'silhouette']) {
    const f = new Frame();
    draw(f, s, style);
    fs.writeFileSync(path.join(OUT, `${key}-${style}.png`), f.toPNG(10));
    panels.push([title, f]);
  }
}
const COLS = 2, PW = 64, PH = 32, GAP = 4, TH = 8;
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, Math.ceil(panels.length / COLS) * (PH + TH + GAP) + GAP);
panels.forEach(([title, f], i) => {
  const ox = GAP + (i % COLS) * (PW + GAP), oy = GAP + Math.floor(i / COLS) * (PH + TH + GAP);
  sheet.text('small', title, ox, oy + 5, '#606060');
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y));
});
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(6));
console.log(`wrote ${panels.length} panels + sheet.png to ${path.relative(process.cwd(), OUT)}`);
