'use strict';
// The skyline face's clouds (design spec §14, "Rendering"; contract
// "Cloud strips"): the server renders a strip 128 px wide and 26 rows tall
// (the sky, rows 0-25) that tiles seamlessly; the board scrolls it 1 px
// every 4 s behind the city. A strip holds only shapes, as 4-bit indexes
// (0 = clear); the colors and opacity of each index ride in the payload
// (`skyline.cl`), so dusk can recolor the same strip without a new fetch.
//
// Shapes follow the mock (scripts/mock-weather-lake.js): wisps (noise
// stretched ~10x wider than tall, cut into two flat tints) for partly and
// mostly cloudy, and a textured deck (lighter where thin, darker where
// thick) for overcast, rain and storms.

const W = 128, H = 26;
const BYTES = (W * H) / 2;          // 1664: two pixels per byte, high nibble first

// ---- tileable value noise ----
function hash(x, y, s) {
  let h = (Math.imul(x >>> 0, 0x9E3779B1) ^ Math.imul(y >>> 0, 0x85EBCA77) ^ Math.imul(s >>> 0, 0xC2B2AE3D)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297A2D39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
// Value noise at (x, y) in lattice units, wrapping every `period` cells in x.
function vnoise(x, y, s, period) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period, x1 = (x0 + 1) % period;
  const a = hash(x0, iy, s), b = hash(x1, iy, s), c = hash(x0, iy + 1, s), d = hash(x1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// Four octaves, each doubling the frequency (and the period, so all wrap at W).
function fbm(x, y, s, period) {
  return 0.5 * vnoise(x, y, s, period) + 0.27 * vnoise(x * 2, y * 2, s + 1, period * 2)
    + 0.15 * vnoise(x * 4, y * 4, s + 2, period * 4) + 0.08 * vnoise(x * 8, y * 8, s + 3, period * 8);
}
const sstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Strip shapes, by id. `cells`: noise lattice cells across the strip (its
// x scale is W / cells px per cell); `sy`: rows per cell.
const SHAPES = {
  // Wisps: index 1 the thin tint, 2 the thick one; nothing below `ymax`.
  p1: { kind: 'wisps', seed: 31, cells: 7, sy: 1.6, t1: 0.56, t2: 0.65, ymax: 16 },
  m1: { kind: 'wisps', seed: 33, cells: 9, sy: 1.8, t1: 0.53, t2: 0.61, ymax: 20 },
  // Decks: index 1-15 from thin (light) to thick (dark), covering the sky.
  o1: { kind: 'deck', seed: 7, cells: 9, sy: 3 },
  r1: { kind: 'deck', seed: 9, cells: 11, sy: 3 },
  s1: { kind: 'deck', seed: 15, cells: 14, sy: 3 },
};
const DECK_LEVELS = 15;

// The strip for `id`: Uint8Array(W * H) of indexes, row by row, or null.
const cache = new Map();
function strip(id) {
  if (cache.has(id)) return cache.get(id);
  const sh = SHAPES[id];
  if (!sh) return null;
  const sx = W / sh.cells;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = fbm(x / sx, y / sh.sy, sh.seed, sh.cells);
    let i = 0;
    if (sh.kind === 'wisps') {
      if (y <= sh.ymax) { const d = n - sstep(sh.ymax - 6, sh.ymax, y) * 0.2; i = d > sh.t2 ? 2 : d > sh.t1 ? 1 : 0; }
    } else {
      i = 1 + Math.round((DECK_LEVELS - 1) * sstep(0.3, 0.75, n));
    }
    out[y * W + x] = i;
  }
  cache.set(id, out);
  return out;
}

// Packed for the board: 4 bits per pixel, high nibble first (1664 bytes).
function packStrip(px) {
  const out = new Uint8Array(BYTES);
  for (let i = 0; i < BYTES; i++) out[i] = (px[i * 2] << 4) | px[i * 2 + 1];
  return out;
}
function unpackStrip(bytes) {
  const out = new Uint8Array(W * H);
  for (let i = 0; i < BYTES; i++) { out[i * 2] = bytes[i] >> 4; out[i * 2 + 1] = bytes[i] & 15; }
  return out;
}
const stripBytes = (id) => { const s = strip(id); return s ? packStrip(s) : null; };

module.exports = { W, H, BYTES, SHAPES, DECK_LEVELS, strip, packStrip, unpackStrip, stripBytes, fbm };
