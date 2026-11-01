#!/usr/bin/env node
'use strict';
// Skyline clock face: quieter thunderstorm lightning. The storm is background, so nothing snaps
// on or off; each option is shown as a timeline of one strike (seconds after it starts).
//
//   node scripts/mock-skyline-storm.js
//
// Writes docs/board/mockups/weather/lake/storm.png, one row per option:
//   GLOW  no bolt: a soft patch of the cloud deck lights up from inside and fades, like lightning
//         seen through the clouds. Rises over 0.6 s, fades over 2.4 s, peak 45%.
//   BOLT  the pixel-art bolt fades in and out the same way, in a soft lavender, peak 55%.
//   BOTH  the glow, with the bolt at a lower peak (35%) inside it.
// Strikes would come every 20-40 s (from the time hash), at a place picked by the same hash.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const L = require('./mock-weather-lake');
const { W, H, mix, hex, sstep } = L;

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'lake');
const RISE = 0.6, FALL = 2.4;
const env = (t) => (t < 0 ? 0 : t < RISE ? sstep(0, RISE, t) : Math.max(0, 1 - (t - RISE) / FALL) ** 1.5);

function copy(f) { const g = new Frame(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g.set(x, y, f.get(x, y)); return g; }

// Soft elliptical glow in the cloud deck, sky pixels only (buildings stay black).
function glow(f, k, cx = 22, cy = 4, rx = 11, ry = 4) {
  const role = L.getRole();
  for (let y = 0; y <= L.SHORE; y++) for (let x = 0; x < W; x++) {
    if (role[y][x]) continue;
    const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
    const a = k * 0.45 * (1 - sstep(0.3, 1, d));
    if (a > 0.01) f.set(x, y, L.rgb(mix(hex(f.get(x, y)), '#8a80b0', a)));
  }
}
// The bolt, blended over the scene at strength a; colors softened toward lavender.
function bolt(f, a) {
  const b = copy(f); L.lightning(b);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = hex(f.get(x, y)), n = hex(b.get(x, y));
    if (o !== n) f.set(x, y, L.rgb(mix(o, mix(n, '#b8b0e8', 0.3), a)));
  }
}

function main() {
  Object.assign(L.OPT, { text: 'bottom', clock: true });
  L.setTick(0); L.buildSkyline();
  const st = L.STATES.find((s) => s[0] === 'thunderstorm')[2];
  const base = new Frame(); L.scene(base, { ...st, mid: undefined });
  const times = [0, 0.3, 0.6, 1.2, 2.0, 3.0];
  const cells = [];
  for (const [name, draw] of [
    ['GLOW', (f, k) => glow(f, k)],
    ['BOLT', (f, k) => bolt(f, 0.55 * k)],
    ['BOTH', (f, k) => { glow(f, k); bolt(f, 0.35 * k); }],
  ]) for (const t of times) {
    const f = copy(base); draw(f, env(t));
    L.label(f, st.temp, st.clock);
    cells.push([`${name}  ${t.toFixed(1)} S`, f]);
  }
  fs.writeFileSync(path.join(OUT, 'storm.png'), L.sheet(cells, 6, 6));
  console.log('wrote storm.png to', path.relative(process.cwd(), OUT));
}
if (require.main === module) main();
module.exports = { env, glow, bolt };
