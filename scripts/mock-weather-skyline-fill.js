#!/usr/bin/env node
'use strict';
// Skyline gap study: Willis (variant B, depth-shaded, from the south) and
// Hancock (variant A, 7>4 steps, east antenna taller), with four ways to
// handle the gaps between buildings so no sky shows down to the ground:
//   A abut        foreground boxes touch, and tuck under the Hancock's taper
//   B base        the current boxes plus a continuous low layer (rows 27-31)
//   C back        a dimmer far skyline behind the current boxes; gaps show it
//   D back+abut   both
// Writes docs/board/mockups/weather/skyline-fill/.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'skyline-fill');
fs.mkdirSync(OUT, { recursive: true });

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (c0, c1, k) => hex(rgb(c0).map((v, i) => v + (rgb(c1)[i] - v) * k));
function ramp(stops, v) {
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [v0, c0] = stops[i - 1]; return mix(c0, stops[i][1], (v - v0) / (stops[i][0] - v0)); }
  return stops[stops.length - 1][1];
}

const W = 64, H = 32, GROUND = 31, WILLIS_H = 23;
const SKY = (y) => ramp([[0, '#06103a'], [14, '#2a1450'], [24, '#7a2c30'], [31, '#c0561a']], y);
const rowOf = (floor) => GROUND + 1 - Math.round(WILLIS_H * floor / 108);
const C = { box: ['#22223a', '#2c2c46'], far: '#16162a', base: '#1c1c32', front: '#5c5c8c', mid: '#48486e', back: '#38385a', mark: '#4e4e78', ant: '#5a5a70' };

// Layers, back to front. Each pixel stores [layer, lit color]; layer 'far' is
// drawn as haze in the silhouette style, everything else as black.
const GAPPY = [[0, 4, 26], [4, 3, 23], [19, 4, 22], [23, 5, 25], [28, 4, 21], [32, 5, 24], [37, 3, 26], [51, 5, 25], [56, 8, 27]];
const ABUT = [[0, 4, 26], [4, 3, 23], [16, 4, 22], [20, 5, 25], [25, 4, 21], [29, 5, 24], [34, 11, 26], [47, 5, 25], [52, 4, 23], [56, 8, 27]];
const FAR = [[0, 3, 21], [3, 5, 24], [8, 3, 20], [11, 6, 23], [17, 3, 19], [20, 5, 22], [25, 4, 20], [29, 6, 23], [35, 3, 18], [38, 5, 21], [43, 4, 22], [47, 6, 20], [53, 4, 23], [57, 7, 22]];

function scene(v) {
  const px = Array.from({ length: H }, () => new Array(W).fill(null));
  const rect = (x, w, top, layer, c) => { for (let y = top; y <= GROUND; y++) for (let i = x; i < x + w; i++) if (i >= 0 && i < W) px[y][i] = [layer, c]; };
  if (v.far) FAR.forEach(([x, w, t]) => rect(x, w, t, 'far', C.far));
  if (v.base) rect(0, W, 27, 'near', C.base);
  (v.abut ? ABUT : GAPPY).forEach(([x, w, t], i) => rect(x, w, t, 'near', C.box[i % 2]));

  // Willis from the south, depth-shaded: per column [front, middle, back] floors.
  const x0 = 7, tw = 3;
  [[66, 108, 50], [90, 108, 90], [50, 90, 66]].forEach(([front, mid, back], c) => {
    for (let y = rowOf(Math.max(front, mid, back)); y <= GROUND; y++) {
      const floor = (GROUND + 1 - y) / WILLIS_H * 108;
      const col = floor <= front ? C.front : floor <= mid ? C.mid : C.back;
      for (let i = x0 + c * tw; i < x0 + (c + 1) * tw; i++) px[y][i] = ['near', col];
    }
  });
  const ants = [[x0 + 1, rowOf(108) - 5, rowOf(108)], [x0 + 4, rowOf(108) - 4, rowOf(108)]];

  // Hancock: 7 -> 4, hard steps, roof row 14.
  const cx = 46, T = 14, base = 7, top = 4;
  for (let y = T; y <= GROUND; y++) {
    const w = top + (base - top) * (y - T) / (GROUND - T), l = cx - w / 2, r = cx + w / 2;
    for (let i = Math.floor(l); i < Math.ceil(r); i++) if (Math.min(i + 1, r) - Math.max(i, l) >= 0.5) px[y][i] = ['near', C.mark];
  }
  const hl = Math.round(cx - top / 2);
  ants.push([hl, T - 5, T], [hl + top - 1, T - 6, T]);
  return { px, ants };
}

function draw(f, s, style) {
  const lit = style === 'lit';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = s.px[y][x];
    if (lit) { if (p) f.fill(x, y, 1, 1, p[1]); continue; }
    f.fill(x, y, 1, 1, !p ? SKY(y) : p[0] === 'far' ? mix(SKY(y), '#000000', 0.65) : '#000000');
  }
  for (const [x, t, roof] of s.ants) {
    for (let y = t; y < roof; y++) { if (lit) f.fill(x, y, 1, 1, C.ant); else f.set(x, y, [0, 0, 0]); }
    f.fill(x, t, 1, 1, '#ff2020');
  }
}

const VARIANTS = [
  ['a', 'A ABUT', { abut: true }],
  ['b', 'B BASE LAYER', { base: true }],
  ['c', 'C BACK LAYER', { far: true }],
  ['d', 'D BACK + ABUT', { far: true, abut: true }],
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
