#!/usr/bin/env node
'use strict';
// Hancock shape study for the skyline screen. Each panel: Willis on the left
// for scale, a variant of the Hancock on the right, low generic boxes that stay
// clear of the Hancock's taper. Real proportions: Hancock roof ~78% of the
// Willis roof, antenna tips ~87% of the Willis tips; antennas ~1/3 of the
// Hancock's roof height; base about 1.65x the roof width.
// Writes docs/board/mockups/weather/hancock/.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'hancock');
fs.mkdirSync(OUT, { recursive: true });

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (c0, c1, k) => hex(rgb(c0).map((v, i) => v + (rgb(c1)[i] - v) * k));
function ramp(stops, v) {
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [v0, c0] = stops[i - 1]; return mix(c0, stops[i][1], (v - v0) / (stops[i][0] - v0)); }
  return stops[stops.length - 1][1];
}

const W = 64, H = 32;
const SKY = (y) => ramp([[0, '#06103a'], [14, '#2a1450'], [24, '#7a2c30'], [31, '#c0561a']], y);

// Coverage map: cov[y][x] in 0..1 per layer (boxes, landmark), plus antennas.
function scene(v) {
  const box = Array.from({ length: H }, () => new Float32Array(W));
  const mark = Array.from({ length: H }, () => new Float32Array(W));
  const brace = Array.from({ length: H }, () => new Uint8Array(W));
  const ant = [];
  const fillRect = (m, x, w, top) => { for (let y = top; y < H; y++) for (let i = x; i < x + w; i++) if (i >= 0 && i < W) m[y][i] = 1; };

  // Low generic boxes (kept below the Hancock's taper).
  [[0, 4, 26], [4, 4, 23], [17, 4, 22], [21, 5, 25], [26, 4, 21], [30, 5, 24], [35, 4, 26], [52, 5, 25], [57, 7, 27]]
    .forEach(([x, w, t]) => fillRect(box, x, w, t));

  // Willis: tiers [width, roof row], antennas on the tallest tier.
  let x = 8;
  for (const [w, t] of [[2, 14], [3, 9], [2, 12], [2, 18]]) { fillRect(mark, x, w, t); x += w; }
  ant.push([10, 3, 9], [12, 4, 9]);

  // Hancock: roof row 14 (17px; F: row 11, exaggerated), straight taper from `base` to `top` wide.
  const cx = 46, T = v.T || 14, { base, top, aa, x: braceOn } = v;
  for (let y = T; y < H; y++) {
    const w = top + (base - top) * (y - T) / (H - 1 - T);
    const l = cx - w / 2, r = cx + w / 2;
    for (let i = Math.floor(l); i < Math.ceil(r); i++) {
      const c = Math.max(0, Math.min(i + 1, r) - Math.max(i, l));
      mark[y][i] = Math.max(mark[y][i], aa ? (c > 0.85 ? 1 : c < 0.2 ? 0 : 0.5) : (c >= 0.5 ? 1 : 0));
    }
    if (braceOn && y > T) {
      // Stacked X bays, 4 rows each, between the walls.
      const k = (y - T - 1) % 4, a = l + 0.5 + (w - 1) * k / 3, b = r - 0.5 - (w - 1) * k / 3;
      brace[y][Math.floor(a)] = 1; brace[y][Math.floor(b)] = 1;
    }
  }
  const l0 = Math.round(cx - top / 2);
  ant.push([l0, T - 7, T], [l0 + top - 1, T - 6, T]);
  return { box, mark, brace, ant };
}

function draw(f, s, style) {
  const lit = style === 'lit';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bg = lit ? '#000000' : SKY(y);
    let c = bg;
    if (s.box[y][x]) c = lit ? (x % 9 < 4 ? '#22223a' : '#2c2c46') : '#000000';
    const m = s.mark[y][x];
    if (m) c = mix(c, lit ? (s.brace[y][x] ? '#24243a' : '#4e4e78') : '#000000', m);
    if (c !== '#000000') f.fill(x, y, 1, 1, c);
  }
  for (const [x, t, roof] of s.ant) {
    for (let y = t; y < roof; y++) f.fill(x, y, 1, 1, lit ? '#5a5a70' : '#000000');
    if (!lit) for (let y = t; y < roof; y++) f.set(x, y, [0, 0, 0]);
    f.fill(x, t, 1, 1, '#ff2020');
  }
}

const VARIANTS = [
  ['a', 'A 7>4 STEPS', { base: 7, top: 4 }],
  ['b', 'B 7>4 SMOOTH', { base: 7, top: 4, aa: true }],
  ['c', 'C 8>4 SMOOTH', { base: 8, top: 4, aa: true }],
  ['d', 'D 6>3 SLIM', { base: 6, top: 3, aa: true }],
  ['e', 'E 8>4 BRACED', { base: 8, top: 4, aa: true, x: true }],
  ['f', 'F 6>3 TALLER', { base: 6, top: 3, aa: true, T: 11 }],
];

const panels = [];
for (const [key, title, v] of VARIANTS) {
  const s = scene(v);
  for (const style of ['silhouette', 'lit']) {
    const f = new Frame();
    draw(f, s, style);
    fs.writeFileSync(path.join(OUT, `${key}-${style}.png`), f.toPNG(10));
    panels.push([`${title}`, f]);
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
