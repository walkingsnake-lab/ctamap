#!/usr/bin/env node
'use strict';
// Builds the clock screen's day/night world map (design spec §18): a 64 x 26
// land mask on an equirectangular grid of 5.625° pixels, longitude -180 to
// 180 across, latitude 84.375° N to 61.875° S down (the equator between rows
// 14 and 15; Antarctica left off; the bottom six rows carry the time). Source: Natural
// Earth 110m land (public domain) from the world-atlas package, saved as
// scripts/geo-src/land-110m.json (TopoJSON). Land colors: NASA Blue Marble
// (public domain; the copy in three-globe's examples), cut to 384 x 192 as
// scripts/geo-src/blue-marble-384.png.
//
//   node scripts/build-world.js
//
// Writes server/board/world.js. A pixel is land when at least 30% of a 6 x 6
// grid of sample points inside it falls on land, so small islands (the UK,
// Japan, New Zealand) keep a pixel. Its color is the Blue Marble's average
// over those land points, brightened for the panel (snow capped at a soft
// grey-white), then every land color is cut to a 24-color palette: rows of
// palette letters, '.' sea.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'geo-src', 'land-110m.json');
const IMG = path.join(__dirname, 'geo-src', 'blue-marble-384.png');
const OUT = path.join(__dirname, '..', 'server', 'board', 'world.js');
const { PNG } = require('pngjs');
const PAL_N = 24;           // palette size (letters A-X)
const GAIN = 1.2, SAT = 1.3;   // the Blue Marble is dark and muted for LEDs
const SNOW = 200;           // no channel above this: ice and snow read grey-white, not glaring
const W = 64, H = 26, DEG = 5.625, TOP = 15 * DEG, N = 6, MIN = 0.3;

// Minimal TopoJSON decoding: quantized, delta-encoded arcs into rings.
function rings(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
  });
  const arcPts = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const ring = (ids) => ids.flatMap((i, k) => arcPts(i).slice(k ? 1 : 0));
  const out = [];
  const geom = (g) => {
    if (g.type === 'GeometryCollection') g.geometries.forEach(geom);
    else if (g.type === 'Polygon') g.arcs.forEach((r) => out.push(ring(r)));
    else if (g.type === 'MultiPolygon') g.arcs.forEach((p) => p.forEach((r) => out.push(ring(r))));
  };
  Object.values(topo.objects).forEach(geom);
  return out;
}

// Even-odd point in polygon over every ring (holes included).
function inside(rs, lon, lat) {
  let c = false;
  for (const r of rs) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const rs = rings(JSON.parse(fs.readFileSync(SRC, 'utf8')));
const img = PNG.sync.read(fs.readFileSync(IMG));
const texel = (lon, lat) => {
  const x = Math.min(img.width - 1, Math.floor((lon + 180) / 360 * img.width));
  const y = Math.min(img.height - 1, Math.floor((90 - lat) / 180 * img.height));
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
// Shadows lifted (gamma 0.8: forests are near-black in the source), then
// saturation and gain, snow capped. Red held to green (RED_MAX): the
// outback and the dark browns inside the forests otherwise come out red on the
// panel, whose per-channel gamma pushes red ahead of green at low levels (Nov 8, 2026).
const RED_MAX = 1.0;
const tune = (c) => {
  const [r, g, b] = c.map((v) => 255 * Math.pow(v / 255, 0.8));
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const out = [r, g, b].map((v) => Math.max(0, Math.min(SNOW, Math.round((l + (v - l) * SAT) * GAIN))));
  out[0] = Math.min(out[0], Math.round(out[1] * RED_MAX));
  return out;
};
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWX';
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// One map: W x H pixels of DEG degrees, TOP the top edge's latitude.
function buildMap(W, H, DEG, TOP) {
  const land = [];  // [x, y, rgb]
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let hit = 0;
    const sum = [0, 0, 0];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const lon = -180 + (x + (i + 0.5) / N) * DEG, lat = TOP - (y + (j + 0.5) / N) * DEG;
      if (!inside(rs, lon, lat)) continue;
      hit++;
      // Blue Marble sea leaking past the coastline (blue over red and green) doesn't count.
      const t = texel(lon, lat);
      if (t[2] > t[0] + 8 && t[2] > t[1]) continue;
      t.forEach((v, k) => { sum[k] += v; });
      sum[3] = (sum[3] || 0) + 1;
    }
    if (hit / (N * N) >= MIN) land.push([x, y, tune(sum[3] ? sum.slice(0, 3).map((v) => v / sum[3]) : [90, 90, 70])]);
  }

  // k-means into PAL_N colors, seeded deterministically from the colors sorted by brightness.
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const sorted = land.map((l) => l[2]).sort((a, b) => lum(a) - lum(b));
  let pal = Array.from({ length: PAL_N }, (_, i) => sorted[Math.floor((i + 0.5) * sorted.length / PAL_N)].slice());
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const nearest = (c) => pal.reduce((best, p, i) => (d2(c, p) < d2(c, pal[best]) ? i : best), 0);
  for (let it = 0; it < 30; it++) {
    const acc = pal.map(() => [0, 0, 0, 0]);
    for (const [, , c] of land) { const k = nearest(c); acc[k][0] += c[0]; acc[k][1] += c[1]; acc[k][2] += c[2]; acc[k][3]++; }
    pal = pal.map((p, i) => (acc[i][3] ? acc[i].slice(0, 3).map((v) => Math.round(v / acc[i][3])) : p));
  }
  const rows = Array.from({ length: H }, () => Array(W).fill('.'));
  for (const [x, y, c] of land) rows[y][x] = LETTERS[nearest(c)];
  return { rows, pal };
}

// The 64 board's map (5.625°, 84.4° N to 61.9° S under the time bar) and the
// wide board's (wide-spec §6: 80 x 32 at 4.5°, 84° N to 60° S, true shape).
const narrow = buildMap(W, H, DEG, TOP);
const wide = buildMap(80, 32, 4.5, 84);

const mapText = (name, m) => `const ${name} = [
${m.rows.map((r) => `  '${r.join('')}',`).join('\n')}
];

const ${name}_PALETTE = {
${m.pal.map((c, i) => `  ${LETTERS[i]}: '${hex(c)}',`).join('\n')}
};
`;

fs.writeFileSync(OUT, `'use strict';
// Generated by scripts/build-world.js from Natural Earth 110m land and NASA's
// Blue Marble (both public domain). Do not edit; rebuild. The clock screen's
// day/night map: 64 x 26 pixels of ${DEG}°, longitude -180 to 180, latitude
// ${TOP}° N to ${H * DEG - TOP}° S; '.' sea, a letter a land color in WORLD_PALETTE.
// WORLD_WIDE: the wide board's (128 x 32): 80 x 32 pixels of 4.5°, 84° N to
// 60° S, its colors in WORLD_WIDE_PALETTE.

${mapText('WORLD', narrow)}
${mapText('WORLD_WIDE', wide)}
module.exports = { WORLD, WORLD_PALETTE, WORLD_WIDE, WORLD_WIDE_PALETTE };
`);
console.log(wide.rows.map((r) => r.join('')).join('\n'));
