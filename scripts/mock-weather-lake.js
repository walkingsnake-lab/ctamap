#!/usr/bin/env node
'use strict';
// Skyline screen mockups: the skyline seen from the lake across Navy Pier, with the Centennial
// Wheel front and center, in every weather state. Design notes: docs/board/design-spec.md,
// "Skyline screen". Made-up conditions and times. Not built into draw.js yet.
//
//   node scripts/mock-weather-lake.js [--text=auto|lit|bottom] [--no-clock] [--reflect] [--t=<ticks>]
//
// Writes docs/board/mockups/weather/lake/: one PNG per state, sheet.png (every state),
// options.png (text modes, no clock, reflections) and night-motion.png (the clear night at
// four moments 3 s apart). --t sets the animation clock (100 ms ticks) for a single frame.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'lake');
const arg = (name, def) => { const a = process.argv.find((s) => s === `--${name}` || s.startsWith(`--${name}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : def; };

// ---- color and noise helpers ----
const W = 64, H = 32, SHORE = 26;                       // rows 0-26 sky and city, 27-31 lake
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, k) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * k));
const lum = (c) => { const [r, g, b] = rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ramp = (stops) => (v) => { for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [v0, c0] = stops[i - 1]; return mix(c0, stops[i][1], (v - v0) / (stops[i][0] - v0)); } return stops[stops.length - 1][1]; };
const sstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash2 = (x, y, s) => { let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s) => 0.5 * vnoise(x, y, s) + 0.27 * vnoise(x * 2.03, y * 2.03, s + 1) + 0.15 * vnoise(x * 4.1, y * 4.1, s + 2) + 0.08 * vnoise(x * 8.3, y * 8.3, s + 3);
let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);        // windows
let prng = 1; const r2 = () => ((prng = (prng * 48271) % 2147483647) / 2147483647);         // stars, rain, snow
const hsv = (h, s, v) => { const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return hex([f(5), f(3), f(1)].map((c) => c * 255)); };

// ---- options ----
const OPT = { text: arg('text', 'auto'), clock: !arg('no-clock', false), reflect: !!arg('reflect', false) };

// ---- animation clock: 100 ms ticks ----
let T = 0, PHASE = 0, SHIM = 0, DRIFT = 0;
function setTick(t) {
  T = t;
  PHASE = (T * 3) % 360;             // rainbow: one turn every 12 s
  SHIM = Math.floor(T / 15);         // water ripples: 1 px every 1.5 s
  DRIFT = T / 40;                    // clouds: 1 px every 4 s
}
const beaconK = () => 0.12 + 0.88 * (0.5 + 0.5 * Math.cos(2 * Math.PI * T / 40));   // 4 s pulse

// ---- the skyline ----
// Viewer on the lake on Navy Pier's axis (41.8917, -87.590), facing west. x = real bearing at
// 1.3 px per degree (pier axis = x 32); height = real angular height at 2.4 rows per degree
// (about 1.8x vertical exaggeration). Every building is drawn unlit (black).
const top = (rows) => SHORE + 1 - rows;
let role, ants;
function buildSkyline() {
  role = Array.from({ length: H }, () => new Array(W).fill(null));
  ants = [];   // [x, top row, roof row, beacon]
  const rect = (x, w, t, r) => { for (let y = t; y <= SHORE; y++) for (let i = x; i < x + w; i++) if (i >= 0 && i < W && y >= 0) role[y][i] = r; };
  // Background mass: the Loop to the left, Streeterville to the right. [x, width, rows]
  [[0, 4, 7], [8, 3, 9], [19, 3, 8], [22, 3, 10], [28, 3, 7], [36, 3, 6], [39, 4, 9], [43, 3, 11], [46, 4, 8], [50, 3, 10], [57, 4, 9], [61, 3, 7]]
    .forEach(([x, w, h]) => rect(x, w, top(h), 'fill'));
  // Willis (bearing -20.5°): seen from the southeast, setbacks stepping down to the right.
  { const fl = (f) => Math.round(15 * f / 108); let x = 1;
    for (const [w, f] of [[1, 66], [4, 108], [2, 90], [2, 66]]) { rect(x, w, top(fl(f)), 'tower'); x += w; }
    ants.push([2, top(18), top(15), false], [4, top(17), top(15), false]); }
  rect(11, 4, top(17), 'tower');                                     // Aon (-15.3°)
  rect(15, 5, top(21), 'tower');                                     // St. Regis (-12.1°): the closest supertall, so the tallest-looking
  rect(23, 5, top(10), 'tower'); rect(24, 4, top(13), 'tower'); rect(24, 3, top(16), 'tower');   // Trump (-5.7°), setbacks
  rect(29, 7, top(14) + 1, 'tower'); rect(30, 5, top(14), 'tower');  // Lake Point Tower (0°), right behind the wheel
  // Hancock (16.2°): symmetric 4-6-8 steps around x 53, twin antennas with beacons. With the clock
  // on, the antennas are 2 rows shorter so the clock fits above the beacons.
  { const t = top(17), steps = [4, 6, 8];
    for (let y = t; y <= SHORE; y++) { const w = steps[Math.min(2, Math.floor((y - t) * 3 / (SHORE - t + 1)))]; for (let i = 53 - w / 2; i < 53 + w / 2; i++) role[y][i] = 'tower'; }
    const ah = OPT.clock ? 20 : 22; ants.push([51, top(ah), t, true], [54, top(ah), t, true]); }
}
const isB = (x, y) => x >= 0 && x < W && y >= 0 && y < H && role[y][x] !== null;

// ---- drawing pieces ----
function paint(f, sky) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f.fill(x, y, 1, 1, role[y][x] ? '#000000' : sky(y)); }

// Hard-edged shapes: a pixel is on when at least half of it is covered.
function cover(f, x0, x1, y0, y1, test, color) {
  const N = 6;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let hit = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (test(x + (i + 0.5) / N, y + (j + 0.5) / N)) hit++;
    if (hit / (N * N) >= 0.5) f.fill(x, y, 1, 1, typeof color === 'function' ? color(x + 0.5, y + 0.5) : color);
  }
}
const segment = (ax, ay, bx, by, w) => (px, py) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) < w / 2;
};

// Centennial Wheel: 12 px hard rim (rows 12-23) centered on the x 32 / y 18 pixel boundary,
// a 2x2 hub, A-frame legs from the hub to the pier (feet 5 px either side), and a crossbar on row 25.
const CX = 32, CY = 18, R = 6, SPREAD = 5;
function wheel(f, pal) {
  const box = [CX - R - 2, CX + R + 1, CY - R - 2, SHORE];
  cover(f, ...box, (x, y) => Math.hypot(x - CX, y - CY) > 0.6 && (segment(CX, CY, CX - SPREAD, SHORE + 1, 1)(x, y) || segment(CX, CY, CX + SPREAD, SHORE + 1, 1)(x, y)), pal.leg);
  { const by = 25, k = (by + 0.5 - CY) / (SHORE + 1 - CY); f.fill(Math.round(CX - SPREAD * k), by, Math.round(2 * SPREAD * k), 1, pal.leg); }
  cover(f, ...box, (x, y) => { const r = Math.hypot(x - CX, y - CY); return r >= R - 1 && r <= R; },
    pal.rim === 'rainbow' ? (x, y) => hsv(((Math.atan2(y - CY, x - CX) * 180 / Math.PI) + 360 + PHASE) % 360, 0.85, 0.95) : pal.rim);
  f.fill(CX - 1, CY - 1, 2, 2, pal.hub);
}
// By day the wheel takes the color with the most contrast against what is behind its upper rim.
const WHEEL_DAY = { leg: '#6a7282', hub: '#6a7282', rim: '#8a92a2' };
const WHEEL_LIGHT = { leg: '#b0b6c0', hub: '#b0b6c0', rim: '#dce0e6' };
const WHEEL_DARK = { leg: '#262a32', hub: '#262a32', rim: '#262a32' };
const WHEEL_NIGHT = { leg: '#4a4a66', hub: '#4a4a66', rim: 'rainbow' };
function wheelForDay(f) {
  let n = 0, L = 0;
  for (let a = 200; a <= 340; a += 10) { const t = a * Math.PI / 180, x = Math.floor(CX + (R - 0.5) * Math.cos(t)), y = Math.floor(CY + (R - 0.5) * Math.sin(t)); if (!role[y][x]) { L += lum(hex(f.get(x, y))); n++; } }
  const avg = n ? L / n : 0;
  return avg < 75 ? WHEEL_DAY : avg < 135 ? WHEEL_LIGHT : WHEEL_DARK;
}

// Navy Pier: a flat deck, 8 px either side of the wheel's axis (x 24-39), lit top row and a darker
// face; at night bulbs every 3 px (x 24, 27 ... 39).
const PIER_DAY = { top: '#6a6460', face: '#2e2a2c' }, PIER_NIGHT = { top: '#2a2834', face: '#14121a', bulb: '#c09050' };
function pier(f, p) {
  f.fill(24, SHORE, 16, 1, p.top); f.fill(24, SHORE + 1, 16, 1, p.face);
  if (p.bulb) for (let x = 24; x <= 39; x += 3) f.fill(x, SHORE, 1, 1, p.bulb);
}

// Lit windows at night (45%), kept away from the pier's string lights and from behind the wheel.
function windows(f, density = 0.45) {
  seed = 7;
  for (let y = 0; y <= SHORE; y++) for (let x = 0; x < W; x++) {
    const r = role[y][x];
    if (!r || (r === 'fill' && x < 38)) continue;           // background mass is lit only right of the wheel
    if (x >= 19 && x <= 44 && y >= 20) continue;
    if (Math.hypot(x + 0.5 - 32, y + 0.5 - 18) < 7) continue;
    if (x % 2 === 0 && y % 2 === 1 && isB(x, y - 1) && rand() < density) f.fill(x, y, 1, 1, rand() < 0.3 ? '#ffb050' : '#8a5c20');
  }
}
// Masts are unlit like the towers; the Hancock beacons show only at night, pulsing together.
function antennas(f, night) { for (const [x, t, roof, beacon] of ants) { f.fill(x, t, 1, roof - t, '#000000'); if (beacon && night) f.fill(x, t, 1, 1, mix('#000000', '#ff2020', beaconK())); } }

// 7 px soft-edged disc (sun, moon). `behind`: hidden by the buildings (setting sun).
function disc(f, x0, y0, color, behind = false) {
  const D = 7, c = D / 2, N = 8;
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const X = x0 + x, Y = y0 + y; if (behind && role[Y][X]) continue;
    let hit = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const dx = x + (i + 0.5) / N - c, dy = y + (j + 0.5) / N - c; if (dx * dx + dy * dy <= c * c) hit++; }
    const k = hit / (N * N); if (k > 0.08) f.fill(X, Y, 1, 1, mix(hex(f.get(X, Y)), color, k));
  }
}
const SUN = '#ffd040', MOON = '#a89c70';
const SKY_X = 38, SKY_Y = 2;                              // sun and moon spot: between the wheel and the clock

function stars(f, n) {
  prng = 3;
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r2() * W), y = Math.floor(r2() * 14), bright = r2() < 0.3, tw = r2() < 0.5, ph = r2(), per = [40, 60, 120][i % 3];
    if (isB(x, y) || (x < 14 && y < 7) || (x > 35 && x < 49 && y < 11) || (OPT.clock && x > 44 && y < 8)) continue;
    if (Math.hypot(x + 0.5 - CX, y + 0.5 - CY) < R + 3.5) continue;   // never next to the wheel
    const k = tw ? 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (T / per + ph))) : 1;
    f.fill(x, y, 1, 1, mix(hex(f.get(x, y)), bright ? '#ffffff' : '#5a6070', k));
  }
}

// Water: a two-color gradient with faint ripple dashes drifting sideways (alternate rows in
// opposite directions). Optional: reflections of the scene, fixed in place (only the water moves).
function water(f, w) {
  for (let y = SHORE + 1; y < H; y++) f.fill(0, y, W, 1, mix(w.top, w.bottom, (y - SHORE - 1) / 4));
  if (OPT.reflect) reflect(f, w.top);
  const base = rgb(w.top);
  for (let y = SHORE + 1; y < H; y++) {
    const dir = y % 2 ? 1 : -1, len = y - SHORE <= 2 ? 2 : 3, gap = 9 + (y % 3);
    for (let x = 0; x < W; x++) {
      if (OPT.reflect) { const c = f.get(x, y); if (Math.abs(c[0] - base[0]) + Math.abs(c[1] - base[1]) + Math.abs(c[2] - base[2]) > 24) continue; }
      const p = (((x - dir * SHIM + y * 5) % gap) + gap) % gap;
      if (p < len) f.fill(x, y, 1, 1, w.ripFn ? w.ripFn(x, y) : w.ripple);
    }
  }
}
function reflect(f, top) {
  const src = []; for (let y = SHORE - 4; y <= SHORE; y++) { const row = []; for (let x = 0; x < W; x++) row.push(f.get(x, y)); src.push(row); }
  for (let y = SHORE + 1; y < H; y++) {
    const d = y - SHORE - 1, shift = (y % 2 ? 1 : -1) * (d > 0 ? 1 : 0), k = 0.5 - d * 0.08;
    for (let x = 0; x < W; x++) {
      const sx = Math.max(0, Math.min(W - 1, x + shift)), sy = SHORE - d;
      const onRim = Math.abs(Math.hypot(sx + 0.5 - CX, sy + 0.5 - CY) - (R - 0.5)) < 1;   // the rim reflects as plain structure
      const c = onRim ? rgb('#4a4a66') : src[4 - d][sx];
      const gap = ((x * 7 + y * 3) % 11) === 0;
      f.fill(x, y, 1, 1, mix(top, hex(c), gap ? 0 : Math.max(...c) > 150 ? 0.7 : k));
    }
  }
}

// ---- weather ----
// Wisps (partly / mostly cloudy): noise stretched ~10x wider than tall, cut into two flat tints.
function wisps(f, o) {
  for (let y = 0; y <= o.ymax; y++) for (let x = 0; x < W; x++) {
    if (role[y][x]) continue;
    const d = fbm((x + DRIFT) / o.sx, y / o.sy, o.seed) - sstep(o.ymax - 6, o.ymax, y) * 0.2;
    let a = d > o.t2 ? o.a2 : d > o.t1 ? o.a1 : 0;
    if (OPT.text === 'lit') { const dx = x < 32 ? x - 13 : 45 - x, dy = y - 7, dd = Math.max(dx, dy); if (dd <= 0) a = 0; else if (dd < 4) a *= dd / 4; }
    if (a > 0) f.fill(x, y, 1, 1, mix(hex(f.get(x, y)), o.color, a));
  }
}
// Decks (overcast, rain, storm, sunset bands): noise, lighter where thin, darker where thick.
function deck(f, o) {
  for (let y = 0; y <= SHORE; y++) for (let x = 0; x < W; x++) {
    if (role[y][x] || (o.ymax && y > o.ymax)) continue;
    const d = fbm((x + DRIFT) / o.sx, y / o.sy, o.seed) - (o.ymax ? sstep(o.ymax - 5, o.ymax, y) * 0.25 : 0);
    const a = o.cover >= 1 ? 1 : sstep(1 - o.cover - 0.06, 1 - o.cover + 0.08, d);
    if (a <= 0) continue;
    let col = mix(o.light, o.dark, sstep(0.3, 0.75, d));
    if (o.horizon) col = mix(col, o.horizon, sstep(o.hy || 12, SHORE, y) * 0.8);
    f.fill(x, y, 1, 1, mix(hex(f.get(x, y)), col, a));
  }
}
function rain(f, n, c1, c2) {
  prng = 11 + Math.floor(T / 2) * 7;
  for (let i = 0; i < n; i++) { const x = Math.floor(r2() * W), y = Math.floor(r2() * (SHORE - 1));
    if (y < 7 && (x < 14 || x > 44)) continue;
    f.fill(x, y, 1, 1, c1); if (x + 1 < W) f.fill(x + 1, y + 1, 1, 1, c2); }
}
function snow(f, n) {
  prng = 23 + Math.floor(T / 6) * 5;
  for (let i = 0; i < n; i++) { const x = Math.floor(r2() * W), y = Math.floor(r2() * SHORE);
    if (y < 7 && (x < 14 || x > 44)) continue;
    f.fill(x, y, 1, 1, r2() < 0.4 ? '#e8ecf2' : '#8a909c'); }
}
function roofs(f, color) { for (let x = 0; x < W; x++) for (let y = 0; y <= SHORE; y++) if (role[y][x]) { f.fill(x, y, 1, 1, color); break; } }
function fog(f, fogC, top = 4, bottom = 22) {
  for (let y = 0; y <= SHORE; y++) { const k = Math.max(0, Math.min(1, (bottom - y) / (bottom - top)));
    if (k) for (let x = 0; x < W; x++) f.fill(x, y, 1, 1, mix(hex(f.get(x, y)), fogC, k * 0.85)); }
}
// Pixel-art lightning: 1 px white core stepping down with sideways jogs, a flat violet edge on
// each side, one violet branch; ends just above the Trump roof.
function lightning(f) {
  const core = [[22, 0], [21, 1], [21, 2], [20, 3], [21, 4], [22, 4], [23, 4], [23, 5], [24, 6], [23, 7], [24, 8], [25, 8], [25, 9], [25, 10]];
  const branch = [[20, 2], [19, 3], [18, 4], [18, 5], [17, 6]];
  const isCore = new Set(core.map(([x, y]) => x + ',' + y)), put = (x, y, c) => { if (y >= 0 && x >= 0 && x < W && !role[y][x]) f.fill(x, y, 1, 1, c); };
  for (const [x, y] of core) for (const X of [x - 1, x + 1]) if (!isCore.has(X + ',' + y)) put(X, y, '#7060c0');
  for (const [x, y] of branch) put(x, y, '#9a8ae0');
  for (const [x, y] of core) put(x, y, '#ffffff');
}

// Temperature top left, clock top right (Tom Thumb). Auto: each block picks unlit digits on a
// bright sky and lit digits on a dark one (the board adds hysteresis: dark above 120, lit below 100).
function label(f, temp, clock) {
  const auto = (s, x) => { const w = measure('small', s); let L = 0, n = 0; for (let y = 1; y <= 5; y++) for (let i = x; i < x + w; i++) { L += lum(hex(f.get(i, y))); n++; } return L / n > 110 ? '#000000' : '#d8d8d8'; };
  const put = (s, x) => f.text('small', s, x, OPT.text === 'bottom' ? 32 : 6, OPT.text === 'auto' ? auto(s, x) : '#d8d8d8');
  put(temp, 0);
  if (OPT.clock && clock) put(clock, 63 - measure('small', clock));
}

// ---- states ----
function scene(f, o) {
  paint(f, o.sky);
  if (o.sun) disc(f, o.sun[0], o.sun[1], o.sun[3] || SUN, !!o.sun[2]);
  if (o.clouds) o.clouds(f);
  if (o.stars) stars(f, o.stars);
  if (o.moon) disc(f, SKY_X, SKY_Y, MOON);
  if (o.night) windows(f);
  if (o.roofs) roofs(f, o.roofs);
  if (o.mid) o.mid(f);
  antennas(f, o.night);
  wheel(f, o.wheel || (o.night ? WHEEL_NIGHT : wheelForDay(f)));
  water(f, o.water);
  pier(f, o.pier || (o.night ? PIER_NIGHT : PIER_DAY));
  if (o.after) o.after(f);
  label(f, o.temp, o.clock);
}
const BLUE = ramp([[0, '#08245a'], [18, '#1a4a8e'], [26, '#3a6eb0']]), NIGHT_SKY = ramp([[0, '#000006'], [26, '#0c1430']]);
const DAY_WATER = { top: '#0a2a52', bottom: '#06203f', ripple: '#1a3a68' }, NIGHT_WATER = { top: '#030816', bottom: '#02050f', ripple: '#0e1a36' };
const STATES = [
  ['clear-day', 'CLEAR DAY', { sky: BLUE, sun: [SKY_X, SKY_Y], water: DAY_WATER, temp: '72°', clock: '2:15' }],
  ['partly-cloudy', 'PARTLY CLOUDY', { sky: ramp([[0, '#0c2a60'], [18, '#1e4e90'], [26, '#3a6eb0']]), sun: [SKY_X, SKY_Y],
    clouds: (f) => wisps(f, { seed: 31, sx: 18, sy: 1.6, t1: 0.56, t2: 0.65, a1: 0.35, a2: 0.7, color: '#eef2f8', ymax: 16 }), water: DAY_WATER, temp: '64°', clock: '11:30' }],
  ['mostly-cloudy', 'MOSTLY CLOUDY', { sky: ramp([[0, '#14346a'], [26, '#4272b0']]),
    clouds: (f) => wisps(f, { seed: 33, sx: 15, sy: 1.8, t1: 0.53, t2: 0.61, a1: 0.38, a2: 0.72, color: '#e4e8f0', ymax: 20 }),
    water: { top: '#16304e', bottom: '#0e2238', ripple: '#2c4666' }, temp: '58°', clock: '1:45' }],
  ['overcast', 'OVERCAST', { sky: ramp([[0, '#4a525e'], [26, '#6a727e']]),
    clouds: (f) => deck(f, { seed: 7, sx: 14, sy: 3, cover: 1, light: '#78808c', dark: '#3e4652', horizon: '#7a828c' }),
    water: { top: '#262e38', bottom: '#1c222a', ripple: '#38424e' }, temp: '41°', clock: '3:40' }],
  ['rain', 'RAIN', { sky: ramp([[0, '#262c34'], [26, '#3c444e']]),
    clouds: (f) => deck(f, { seed: 9, sx: 12, sy: 3, cover: 1, light: '#525a66', dark: '#1e232a', horizon: '#4a525c', hy: 14 }),
    water: { top: '#141c26', bottom: '#0e141c', ripple: '#222c3a' }, after: (f) => rain(f, 45, '#5a7aaa', '#3a5070'), temp: '51°', clock: '4:05' }],
  ['snow', 'SNOW', { sky: ramp([[0, '#5a606a'], [26, '#7c828c']]), roofs: '#c8ced8', pier: { top: '#c8ced8', face: '#3a3e46' },
    water: { top: '#2c323a', bottom: '#22272e', ripple: '#3c444e' }, after: (f) => snow(f, 40), temp: '28°', clock: '1:20' }],
  ['fog', 'FOG', { sky: () => '#747a82', mid: (f) => fog(f, '#747a82'), wheel: { ...WHEEL_DAY, rim: '#9aa0a8' },
    water: { top: '#5a6068', bottom: '#4e545c', ripple: '#6a7078' }, temp: '55°', clock: '8:10' }],
  ['sunrise', 'SUNRISE', { sky: ramp([[0, '#2a4a8a'], [14, '#8a86b8'], [22, '#e8a8a0'], [26, '#ffc8a0']]),
    water: { top: '#4a4a6a', bottom: '#3a3a58', ripple: '#8a7a8e' }, temp: '48°', clock: '6:58' }],
  ['sunset', 'SUNSET', { sky: ramp([[0, '#1a1440'], [9, '#5a2a5a'], [17, '#c0503a'], [23, '#f08a30'], [26, '#ffb848']]), sun: [40, 11, true, '#fff0a0'],   // summer: northwest, setting behind low buildings right of the wheel
    clouds: (f) => deck(f, { seed: 21, sx: 11, sy: 2.2, cover: 0.62, light: '#ffb08a', dark: '#2a1236', ymax: 13 }),
    water: { top: '#3a2030', bottom: '#2a1424', ripple: '#7a3a3a', ripFn: (x, y) => Math.abs(x + 0.5 - 43.5) < 1.5 + (y - SHORE) * 0.8 ? '#e08a40' : '#7a3a3a' }, temp: '66°', clock: '6:12' }],
  ['twilight', 'TWILIGHT', { night: true, sky: ramp([[0, '#06103a'], [18, '#22306a'], [26, '#4a4a88']]), stars: 6,
    water: { top: '#141a3a', bottom: '#0c1028', ripple: '#283060' }, temp: '61°', clock: '7:05' }],
  ['clear-night', 'CLEAR NIGHT', { night: true, sky: NIGHT_SKY, stars: 14, moon: true, water: NIGHT_WATER, temp: '58°', clock: '10:42' }],
  ['partly-cloudy-night', 'PARTLY CLOUDY NIGHT', { night: true, sky: NIGHT_SKY, stars: 14, moon: true,
    mid: (f) => wisps(f, { seed: 35, sx: 16, sy: 1.7, t1: 0.56, t2: 0.65, a1: 0.35, a2: 0.65, color: '#4a4048', ymax: 14 }),
    water: NIGHT_WATER, temp: '55°', clock: '10:42' }],
  ['overcast-night', 'OVERCAST NIGHT', { night: true, sky: ramp([[0, '#0c0a0e'], [26, '#2a2226']]),
    clouds: (f) => deck(f, { seed: 12, sx: 14, sy: 3, cover: 1, light: '#3a3034', dark: '#141016', horizon: '#3e3236', hy: 10 }),
    water: { top: '#08070a', bottom: '#050406', ripple: '#141218' }, temp: '47°', clock: '11:20' }],
  ['rain-night', 'RAIN NIGHT', { night: true, sky: ramp([[0, '#08080e'], [26, '#1e1a24']]),
    water: { top: '#06070c', bottom: '#040508', ripple: '#10121c' }, after: (f) => rain(f, 35, '#2c4468', '#1e3050'), temp: '49°', clock: '10:42' }],
  ['snow-night', 'SNOW NIGHT', { night: true, sky: ramp([[0, '#140e14'], [26, '#3a282a']]), roofs: '#5a5260', pier: { top: '#6a6470', face: '#14121a', bulb: '#c09050' },
    water: { top: '#0c0a0e', bottom: '#08070a', ripple: '#1a1620' }, after: (f) => snow(f, 32), temp: '26°', clock: '11:05' }],
  ['fog-night', 'FOG NIGHT', { night: true, sky: () => '#14161c', mid: (f) => fog(f, '#14161c', 2, 20),
    water: { top: '#0c0e14', bottom: '#08090e', ripple: '#181b22' }, temp: '52°', clock: '11:50' }],
  ['thunderstorm', 'THUNDERSTORM', { night: true, sky: ramp([[0, '#0a0a14'], [26, '#1a1626']]),
    clouds: (f) => deck(f, { seed: 15, sx: 9, sy: 3, cover: 1, light: '#2a2638', dark: '#08080e' }), mid: lightning,
    water: { top: '#05050a', bottom: '#030306', ripple: '#10101a' }, after: (f) => rain(f, 40, '#3a5480', '#24385a'), temp: '68°', clock: '9:25' }],
];
function render(key) { const s = STATES.find((st) => st[0] === key); const f = new Frame(); scene(f, s[2]); return f; }

// ---- sheets ----
function sheet(cells, cols, scale) {
  const G = 4, TH = 8, rows = Math.ceil(cells.length / cols);
  const s = new Frame(cols * W + (cols + 1) * G, rows * (H + TH + G) + G);
  cells.forEach(([title, f], i) => {
    const ox = G + (i % cols) * (W + G), oy = G + Math.floor(i / cols) * (H + TH + G);
    s.text('small', title, ox, oy + 5, '#606060');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s.set(ox + x, oy + TH + y, f.get(x, y));
  });
  return s.toPNG(scale);
}
function withOpts(o, fn) { const saved = { ...OPT }; Object.assign(OPT, o); buildSkyline(); const r = fn(); Object.assign(OPT, saved); buildSkyline(); return r; }

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  setTick(+arg('t', 0));
  buildSkyline();
  const cells = STATES.map(([key, title]) => { const f = render(key); fs.writeFileSync(path.join(OUT, `${key}.png`), f.toPNG(10)); return [title, f]; });
  fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet(cells, 2, 6));
  const opts = [
    ['TEXT AUTO', { text: 'auto' }, 'mostly-cloudy'], ['TEXT LIT TOP', { text: 'lit' }, 'mostly-cloudy'],
    ['TEXT AT THE BOTTOM', { text: 'bottom' }, 'mostly-cloudy'], ['NO CLOCK', { clock: false }, 'clear-night'],
    ['REFLECTIONS ON', { reflect: true }, 'clear-night'], ['REFLECTIONS OFF', { reflect: false }, 'clear-night'],
  ].map(([title, o, key]) => [title, withOpts(o, () => render(key))]);
  fs.writeFileSync(path.join(OUT, 'options.png'), sheet(opts, 2, 6));
  const motion = [0, 30, 60, 90].map((t) => { setTick(t); return [`T = ${t / 10} S`, render('clear-night')]; });
  fs.writeFileSync(path.join(OUT, 'night-motion.png'), sheet(motion, 2, 6));
  console.log(`wrote ${STATES.length} states, sheet.png, options.png, night-motion.png to ${path.relative(process.cwd(), OUT)}`);
}
module.exports = { STATES, render, setTick, buildSkyline, OPT };
