#!/usr/bin/env node
'use strict';
// Day/night world map filling a 128x32 panel, no time bar. Land mask and
// colors built the way scripts/build-world.js builds the 64x26 map (Natural
// Earth 110m land, Blue Marble colors), on three grids; night shading as in
// draw.js renderDayNight (full night at the sun 12° below the horizon), in
// floats. Not in draw.js.
//   node scripts/mock-128-worldmap.js   -> docs/board/mockups/w128/map-*.png

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { Frame } = require('../server/board/raster');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'w128');
const W = 128, H = 32, N = 6, MIN = 0.3, SNOW = 200, GAIN = 1.2, SAT = 1.3;
const SEA = [0x2c, 0x70, 0xb0], NIGHT_SEA = [0x14, 0x3a, 0x5c], NIGHT_K = [104, 116, 140];
const HERE = [41.88, -87.63]; // Chicago

// --- land mask (same decoding and sampling as build-world.js) ---
const topo = JSON.parse(fs.readFileSync(path.join(__dirname, 'geo-src', 'land-110m.json'), 'utf8'));
function rings(t) {
  const [sx, sy] = t.transform.scale, [tx, ty] = t.transform.translate;
  const arcs = t.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
  const arcPts = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const ring = (ids) => ids.flatMap((i, k) => arcPts(i).slice(k ? 1 : 0));
  const out = [];
  const geom = (g) => {
    if (g.type === 'GeometryCollection') g.geometries.forEach(geom);
    else if (g.type === 'Polygon') g.arcs.forEach((r) => out.push(ring(r)));
    else if (g.type === 'MultiPolygon') g.arcs.forEach((p) => p.forEach((r) => out.push(ring(r))));
  };
  Object.values(t.objects).forEach(geom);
  return out.map((r) => ({ r, x0: Math.min(...r.map((p) => p[0])), x1: Math.max(...r.map((p) => p[0])), y0: Math.min(...r.map((p) => p[1])), y1: Math.max(...r.map((p) => p[1])) }));
}
const RS = rings(topo);
function inside(lon, lat) {
  let c = false;
  for (const { r, x0, x1, y0, y1 } of RS) {
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}
const img = PNG.sync.read(fs.readFileSync(path.join(__dirname, 'geo-src', 'blue-marble-384.png')));
const texel = (lon, lat) => {
  const x = Math.min(img.width - 1, Math.floor((lon + 180) / 360 * img.width));
  const y = Math.min(img.height - 1, Math.floor((90 - lat) / 180 * img.height));
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const tune = (c) => {
  const [r, g, b] = c.map((v) => 255 * Math.pow(v / 255, 0.8));
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r, g, b].map((v) => Math.max(0, Math.min(SNOW, Math.round((l + (v - l) * SAT) * GAIN))));
};
// grid: { top: latitude of the top edge, dy: degrees per row }; columns are 360/128 = 2.8125°.
function landGrid({ top, dy }) {
  const dx = 360 / W, out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let hit = 0, n = 0;
    const sum = [0, 0, 0];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const lon = -180 + (x + (i + 0.5) / N) * dx, lat = top - (y + (j + 0.5) / N) * dy;
      if (!inside(lon, lat)) continue;
      hit++;
      const t = texel(lon, lat);
      if (t[2] > t[0] + 8 && t[2] > t[1]) continue;
      t.forEach((v, k) => { sum[k] += v; }); n++;
    }
    out.push(hit / (N * N) >= MIN ? tune(n ? sum.map((v) => v / n) : [90, 90, 70]) : null);
  }
  return out;
}

// --- day/night ---
// The 'daynight evening' scenario: Sun Nov 1 2026, 9:42 PM CST; sun's declination -14.7°, subsolar longitude 120.4° E.
const DEC = -14.7, SUBLON = 120.4;
const rad = (d) => (d * Math.PI) / 180;
const NIGHT12 = Math.sin(rad(-12));
function render(grid, land) {
  const f = new Frame(W, H);
  const dx = 360 / W;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lat = grid.top - (y + 0.5) * grid.dy, lon = -180 + (x + 0.5) * dx;
    const s = Math.sin(rad(lat)) * Math.sin(rad(DEC)) + Math.cos(rad(lat)) * Math.cos(rad(DEC)) * Math.cos(rad(lon - SUBLON));
    const k = s >= 0 ? 1 : s <= NIGHT12 ? 0 : 1 - s / NIGHT12;
    const day = land[y * W + x] || SEA;
    const night = land[y * W + x] ? day.map((c, i) => Math.floor((c * NIGHT_K[i]) / 256)) : NIGHT_SEA;
    f.set(x, y, night.map((v, i) => Math.round(v + (day[i] - v) * k)));
  }
  const hx = Math.floor((HERE[1] + 180) / dx), hy = Math.floor((grid.top - HERE[0]) / grid.dy);
  if (hy >= 0 && hy < H) f.set(hx, hy, [255, 255, 255]);
  return f;
}

const GRIDS = [
  { id: 'map-world', title: 'Whole world, stretched', top: 84.375, dy: 146.25 / 32,
    desc: 'The same latitudes as the 64 map (84° N to 62° S) over all 32 rows, 2.8 degrees a column: every continent but Antarctica, about 1.6 times wider than true.', note: '' },
  { id: 'map-band', title: 'Mild stretch, 72° N to 48° S', top: 72, dy: 3.75,
    desc: 'Rows of 3.75°: about a third wider than true. Drops Greenland\'s north and the tips of South America and New Zealand.', note: '' },
  { id: 'map-true', title: 'True shape, 66° N to 24° S', top: 66, dy: 360 / W,
    desc: 'Square pixels, so nothing is stretched, but only a 90° band fits: most of Australia, southern Africa and southern South America fall off the bottom.', note: '' },
];

fs.mkdirSync(OUT, { recursive: true });
const q5 = (v) => v & 0xf8;
const out = [];
for (const g of GRIDS) {
  const f = render(g, landGrid(g));
  const q = new Frame(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) q.set(x, y, f.get(x, y).map(q5));
  fs.writeFileSync(path.join(OUT, `${g.id}.png`), q.toPNG(10));
  out.push({ kind: 'map', id: g.id, title: g.title, desc: g.desc, note: g.note });
}
fs.writeFileSync(path.join(OUT, 'maps.json'), JSON.stringify(out, null, 1));
console.log('wrote', out.map((m) => m.id).join(', '));
