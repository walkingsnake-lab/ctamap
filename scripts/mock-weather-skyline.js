#!/usr/bin/env node
'use strict';
// Skyline shape mockups for the skyline weather screen: generic boxes plus the
// Willis (stepped tiers, two antennas) and Hancock (tapered, two antennas).
// Three layouts, each as lit shapes on black and as a silhouette against a
// dusk sky. Writes docs/board/mockups/weather/skyline/.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'skyline');
fs.mkdirSync(OUT, { recursive: true });

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lerp = (c0, c1, k) => hex(rgb(c0).map((v, i) => v + (rgb(c1)[i] - v) * k));
function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) { const [v0, c0] = stops[i - 1]; return lerp(c0, stops[i][1], (v - v0) / (stops[i][0] - v0)); }
  }
  return stops[stops.length - 1][1];
}

// A skyline is a list of shapes; each fills pixels into a mask (id per pixel)
// so neighboring buildings can alternate shades.
function build(spec) {
  const id = Array.from({ length: 32 }, () => new Array(64).fill(0));
  const antennas = [], landmarks = new Set();
  let n = 0;
  const put = (x, y, k) => { if (x >= 0 && x < 64 && y >= 0 && y < 32) id[y][x] = k; };
  const ordered = [...spec.filter((s) => s.box), ...spec.filter((s) => !s.box)];
  for (const s of ordered) {
    n++;
    if (s.box) { const [x, w, top] = s.box; for (let y = top; y < 32; y++) for (let i = x; i < x + w; i++) put(i, y, n); }
    if (s.willis || s.hancock) landmarks.add(n);
    if (s.willis) {
      // Tiers left to right (columns, roof row offset from T); antennas on the tallest tier.
      const [x, T, big] = s.willis;
      const tiers = big ? [[2, 6], [3, 0], [2, 3], [2, 10]] : [[2, 5], [3, 0], [2, 8]];
      let cx = x;
      for (const [w, dy] of tiers) { for (let y = T + dy; y < 32; y++) for (let i = cx; i < cx + w; i++) put(i, y, n); cx += w; }
      const ax = x + tiers[0][0];
      antennas.push([ax, T - (big ? 6 : 5), T], [ax + 2, T - (big ? 5 : 4), T]);
    }
    if (s.hancock) {
      // Tapered: `base` wide at the ground, `top` wide at the roof, centered on cx.
      const [cx, T, base, topW, brace] = s.hancock;
      for (let y = T; y < 32; y++) {
        const w = Math.round(topW + (base - topW) * (y - T) / (31 - T));
        const x0 = Math.round(cx - w / 2);
        for (let i = x0; i < x0 + w; i++) put(i, y, n);
      }
      if (brace) s.braceAt = [cx, T, base, topW];
      const x0 = Math.round(cx - topW / 2);
      antennas.push([x0, T - 5, T], [x0 + topW - 1, T - 4, T]);
    }
  }
  return { id, antennas, spec, landmarks };
}

const SHADES = ['#22223a', '#32324e'];
const LANDMARK = '#4e4e78';
function drawLit(f, sky) {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const k = sky.id[y][x];
    if (k) f.fill(x, y, 1, 1, sky.landmarks.has(k) ? LANDMARK : SHADES[k % 2]);
  }
  drawExtras(f, sky, '#5a5a70');
}
function drawSilhouette(f, sky) {
  for (let y = 0; y < 32; y++) f.fill(0, y, 64, 1, ramp([[0, '#06103a'], [14, '#2a1450'], [24, '#7a2c30'], [31, '#c0561a']], y));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (sky.id[y][x]) f.fill(x, y, 1, 1, '#000000');
  drawExtras(f, sky, '#000000', true);
}
function drawExtras(f, sky, antenna, noBrace) {
  for (const [x, top, roof] of sky.antennas) {
    f.fill(x, top, 1, roof - top, antenna);
    f.fill(x, top, 1, 1, '#ff2020');   // aircraft warning light (blinks on the board)
  }
  for (const s of sky.spec) if (s.braceAt && !noBrace) {
    // Hancock's stacked X-bracing: both diagonals between the walls, 6-row bays.
    const [cx, T, base, topW] = s.braceAt;
    for (let y = T + 1; y < 31; y++) {
      const w = Math.round(topW + (base - topW) * (y - T) / (31 - T)), x0 = Math.round(cx - w / 2);
      const k = (y - T - 1) % 6, span = w - 1;
      const a = x0 + Math.round(span * k / 5), b = x0 + span - Math.round(span * k / 5);
      f.fill(a, y, 1, 1, '#24243a'); f.fill(b, y, 1, 1, '#24243a');
    }
  }
}

// ---- layouts ----
const LAYOUTS = {
  // Willis left of center, Hancock right, mid-height boxes around them.
  a: [
    { box: [0, 5, 24] }, { box: [5, 4, 20] }, { box: [9, 6, 22] }, { box: [15, 3, 17] },
    { willis: [18, 10] },
    { box: [25, 4, 19] }, { box: [29, 5, 23] }, { box: [34, 3, 16] }, { box: [37, 8, 21] },
    { hancock: [45, 14, 7, 4] },
    { box: [46, 8, 22] }, { box: [54, 4, 25] }, { box: [58, 6, 27] },
  ],
  // Low: everything in the bottom half so the sky has room for text/weather.
  b: [
    { box: [0, 6, 27] }, { box: [6, 4, 24] }, { box: [10, 5, 26] },
    { willis: [15, 16] },
    { box: [22, 5, 25] }, { box: [27, 3, 22] }, { box: [30, 6, 26] }, { box: [36, 6, 23] },
    { hancock: [43, 19, 6, 3] },
    { box: [45, 6, 25] }, { box: [51, 6, 27] }, { box: [57, 7, 28] },
  ],
  // Landmarks dominant: bigger Willis (four tiers) and braced Hancock, few boxes.
  c: [
    { box: [0, 7, 25] }, { box: [7, 5, 22] },
    { willis: [12, 9, true] },
    { box: [21, 5, 21] }, { box: [26, 6, 24] }, { box: [32, 4, 19] }, { box: [36, 8, 23] },
    { hancock: [46, 13, 9, 5, true] },
    { box: [48, 8, 24] }, { box: [56, 8, 27] },
  ],
};

const panels = [];
for (const [key, spec] of Object.entries(LAYOUTS)) {
  for (const [style, draw] of [['lit', drawLit], ['silhouette', drawSilhouette]]) {
    const f = new Frame();
    draw(f, build(spec.map((s) => ({ ...s }))));
    fs.writeFileSync(path.join(OUT, `${key}-${style}.png`), f.toPNG(10));
    panels.push([`${key.toUpperCase()} ${style.toUpperCase()}`, f]);
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
