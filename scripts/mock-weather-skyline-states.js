#!/usr/bin/env node
'use strict';
// Skyline weather screen, four states, on the chosen skyline: Willis (B,
// depth-shaded, from the south), Hancock (A, 7>4 steps, east antenna taller),
// generic boxes and a continuous base layer (rows 27-31). Temperature top
// right, the one corner clear of both towers' antennas. Made-up conditions.
// Writes docs/board/mockups/weather/skyline-states/.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'skyline-states');
fs.mkdirSync(OUT, { recursive: true });

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (c0, c1, k) => hex(rgb(c0).map((v, i) => v + (rgb(c1)[i] - v) * k));
function ramp(stops, v) {
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [v0, c0] = stops[i - 1]; return mix(c0, stops[i][1], (v - v0) / (stops[i][0] - v0)); }
  return stops[stops.length - 1][1];
}
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const W = 64, H = 32, GROUND = 31, WILLIS_H = 23;
const rowOf = (floor) => GROUND + 1 - Math.round(WILLIS_H * floor / 108);

// ---- the skyline: role per pixel ('box0', 'box1', 'base', 'front', 'mid', 'back', 'hancock') ----
const BOXES = [[0, 4, 26], [4, 3, 23], [19, 4, 22], [23, 5, 25], [28, 4, 21], [32, 5, 24], [37, 3, 26], [50, 4, 24]];
const SHORE = 54;   // lake from here east (right)
function skyline() {
  const role = Array.from({ length: H }, () => new Array(W).fill(null));
  const rect = (x, w, top, r) => { for (let y = top; y <= GROUND; y++) for (let i = x; i < x + w; i++) if (i >= 0 && i < W) role[y][i] = r; };
  rect(0, SHORE, 27, 'base');
  BOXES.forEach(([x, w, t], i) => rect(x, w, t, `box${i % 2}`));
  const x0 = 7, tw = 3;
  [[66, 108, 50], [90, 108, 90], [50, 90, 66]].forEach(([front, mid, back], c) => {
    for (let y = rowOf(Math.max(front, mid, back)); y <= GROUND; y++) {
      const floor = (GROUND + 1 - y) / WILLIS_H * 108;
      const r = floor <= front ? 'front' : floor <= mid ? 'mid' : 'back';
      for (let i = x0 + c * tw; i < x0 + (c + 1) * tw; i++) role[y][i] = r;
    }
  });
  const ants = [[x0 + 1, rowOf(108) - 5, rowOf(108)], [x0 + 4, rowOf(108) - 4, rowOf(108)]];
  const cx = 46, T = 14, base = 7, top = 4;
  for (let y = T; y <= GROUND; y++) {
    const w = top + (base - top) * (y - T) / (GROUND - T), l = cx - w / 2, r = cx + w / 2;
    for (let i = Math.floor(l); i < Math.ceil(r); i++) if (Math.min(i + 1, r) - Math.max(i, l) >= 0.5) role[y][i] = 'hancock';
  }
  const hl = Math.round(cx - top / 2);
  ants.push([hl, T - 5, T], [hl + top - 1, T - 6, T]);
  return { role, ants };
}
const SKY = skyline();
const isBldg = (x, y) => y >= 0 && y < H && x >= 0 && x < W && SKY.role[y][x] !== null;

// ---- states ----
// Each: sky(y), building colors per role, extras before/after the skyline.
const NIGHT_BLDG = { box0: '#22223a', box1: '#2c2c46', base: '#1c1c32', front: '#5c5c8c', mid: '#48486e', back: '#38385a', hancock: '#4e4e78' };
const DAY_BLDG = { box0: '#0c101a', box1: '#10141f', base: '#0a0d15', front: '#26304a', mid: '#1c2438', back: '#151b2b', hancock: '#1a2234' };
// Storm buildings stay darker than the grey sky so the skyline reads.
const GREY_BLDG = { box0: '#101216', box1: '#15171d', base: '#0c0d11', front: '#1e2129', mid: '#17191f', back: '#111318', hancock: '#16181e' };

function windows(f, density, colors) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = SKY.role[y][x];
    if (!r || r === 'base') continue;
    if (x % 2 === 1 && y % 2 === 0 && isBldg(x, y - 1) && rand() < density) f.fill(x, y, 1, 1, colors[rand() < 0.3 ? 0 : 1]);
  }
}
function antennas(f, mast, light) {
  for (const [x, t, roof] of SKY.ants) { f.fill(x, t, 1, roof - t, mast); if (light) f.fill(x, t, 1, 1, '#ff2020'); }
}
function temp(f, s) {
  const x = 63 - measure('small', s);
  f.text('small', s, x, 6, '#d8d8d8');
}
function paint(f, sky, bldg) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = SKY.role[y][x];
    const c = r ? bldg[r] : sky(y);
    if (c) f.fill(x, y, 1, 1, c);
  }
}


// ---- lake, Navy Pier wheel, elevated L train ----
// pal: { lake, ripple, glint (reflection color or null), pier, wheel: [colors], track, car, window, head }
function lakefront(f, pal) {
  for (let y = 28; y < H; y++) for (let x = SHORE; x < W; x++) {
    const ripple = (x * 3 + y * 5) % 7 === 0;
    f.fill(x, y, 1, 1, ripple ? pal.ripple : pal.lake);
  }
  if (pal.glint) [[56, 29], [59, 30], [61, 28], [57, 31]].forEach(([x, y]) => f.fill(x, y, 1, 1, pal.glint));
  // Pier deck and the Ferris wheel on it: rim, spokes, hub, legs.
  f.fill(SHORE, 27, W - SHORE, 1, pal.pier);
  const cx = 59, cy = 21, r = 4;
  for (let a = 0; a < 360; a += 15) {
    const t = a * Math.PI / 180, x = Math.round(cx + r * Math.cos(t)), y = Math.round(cy + r * Math.sin(t));
    f.fill(x, y, 1, 1, pal.wheel[(a / 15) % pal.wheel.length]);
  }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) f.fill(cx + dx, cy + dy, 1, 1, pal.spoke);
  f.fill(cx, cy, 1, 1, pal.wheel[0]);
  for (let y = cy + 1; y < 27; y++) { const k = y - cy; f.fill(cx - Math.ceil(k / 2), y, 1, 1, pal.spoke); f.fill(cx + Math.ceil(k / 2), y, 1, 1, pal.spoke); }
}
function elevated(f, pal, x0) {
  f.fill(0, 27, SHORE, 1, pal.track);
  for (let x = 2; x < SHORE; x += 6) f.fill(x, 28, 1, 4, pal.track);
  // Two cars, 6px each, 1px apart, heading east (right): headlight on the front.
  for (const cx of [x0, x0 + 7]) {
    f.fill(cx, 24, 6, 3, pal.car);
    for (let i = 1; i < 6; i += 2) f.fill(cx + i, 25, 1, 1, pal.window);
  }
  f.fill(x0 + 12, 25, 1, 1, pal.head);
}

const STATES = [
  ['day', 'CLEAR DAY', (f) => {
    paint(f, (y) => ramp([[0, '#08245a'], [20, '#1a4a8e'], [31, '#2c62a8']], y), DAY_BLDG);
    // Sun, and one small cloud.
    [' yyy ', 'yyyyy', 'yyyyy', 'yyyyy', ' yyy '].forEach((row, j) => [...row].forEach((c, i) => { if (c === 'y') f.fill(26 + i, 2 + j, 1, 1, '#ffd040'); }));
    [[0, 2, '..ccc...'], [1, 0, '.ccccccc'], [2, 0, 'cccccccc']].forEach(([j, , row]) => [...row].forEach((c, i) => { if (c === 'c') f.fill(33 + i, 9 + j, 1, 1, '#7088a8'); }));
    antennas(f, '#0c101a', true);
    lakefront(f, { lake: '#0c2e5a', ripple: '#24548c', glint: '#5a7ab0', pier: '#0c101a', wheel: ['#c0c8d8', '#8a90a0'], spoke: '#5a6070' });
    elevated(f, { track: '#0c101a', car: '#9aa0ae', window: '#2a3040', head: '#ffffff' }, 23);
    temp(f, '72°');
  }],
  ['night', 'CLEAR NIGHT', (f) => {
    paint(f, (y) => ramp([[0, '#000006'], [31, '#0c1430']], y), NIGHT_BLDG);
    for (let i = 0; i < 28; i++) {
      const x = Math.floor(rand() * W), y = Math.floor(rand() * 20);
      if (!isBldg(x, y) && !(x > 48 && y < 8)) f.fill(x, y, 1, 1, rand() < 0.3 ? '#ffffff' : '#5a6070');
    }
    ['.mm.', 'm...', 'm...', 'm...', '.mm.'].forEach((row, j) => [...row].forEach((c, i) => { if (c === 'm') f.fill(28 + i, 2 + j, 1, 1, '#e8dca0'); }));
    windows(f, 0.4, ['#ffb050', '#8a5c20']);
    antennas(f, '#5a5a70', true);
    lakefront(f, { lake: '#050e26', ripple: '#163070', glint: '#c09a40', pier: '#14141e', wheel: ['#ff2020', '#ffd000', '#20c040', '#2080ff', '#c040ff'], spoke: '#3a3a4a' });
    elevated(f, { track: '#2a2a3a', car: '#606478', window: '#ffd070', head: '#ffffff' }, 23);
    temp(f, '58°');
  }],
  ['rain', 'RAIN', (f) => {
    paint(f, (y) => ramp([[0, '#30343c'], [6, '#2a2e36'], [31, '#22262e']], y), GREY_BLDG);
    // Low cloud deck along the top, ragged bottom edge.
    for (let x = 0; x < W; x++) { const h = 2 + Math.round(1.5 + Math.sin(x * 0.45) * 1.5 + Math.sin(x * 1.3)); f.fill(x, 0, 1, h, '#40444c'); }
    windows(f, 0.3, ['#c08a40', '#6a4818']);
    antennas(f, '#14161c', true);
    // Rain falls over everything: 2px streaks, slight slant.
    for (let i = 0; i < 50; i++) {
      const x = Math.floor(rand() * W), y = 4 + Math.floor(rand() * 28);
      f.fill(x, y, 1, 1, '#1a4a90'); if (y + 1 < H) f.fill(x, y + 1, 1, 1, '#2a6ad0');
    }
    f.fill(48, 0, 16, 7, '#40444c');
    lakefront(f, { lake: '#141c2a', ripple: '#2e3a50', glint: null, pier: '#0c0d11', wheel: ['#ff2020', '#8a6020'], spoke: '#22252e' });
    elevated(f, { track: '#0c0d11', car: '#4a4e5c', window: '#c08a40', head: '#ffffff' }, 23);
    temp(f, '51°');
  }],
  ['snow', 'SNOW', (f) => {
    paint(f, (y) => ramp([[0, '#3a3e48'], [31, '#2c3038']], y), GREY_BLDG);
    windows(f, 0.3, ['#c08a40', '#6a4818']);
    // Snow on every roof: the top pixel of each building column.
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (isBldg(x, y)) {
      if (!isBldg(x, y - 1)) f.fill(x, y, 1, 1, '#9aa4b8');
    }
    antennas(f, '#14161c', true);
    for (let i = 0; i < 35; i++) {
      const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
      f.fill(x, y, 1, 1, rand() < 0.4 ? '#ffffff' : '#8a90a0');
    }
    f.fill(48, 0, 16, 7, '#3a3e48');
    lakefront(f, { lake: '#1a1e26', ripple: '#2c323e', glint: null, pier: '#9aa4b8', wheel: ['#9aa4b8', '#5a6070'], spoke: '#22252e' });
    elevated(f, { track: '#0c0d11', car: '#4a4e5c', window: '#c08a40', head: '#ffffff' }, 23);
    f.fill(23, 23, 6, 1, '#9aa4b8'); f.fill(30, 23, 6, 1, '#9aa4b8');
    temp(f, '28°');
  }],
];

const panels = [];
for (const [key, title, fn] of STATES) {
  const f = new Frame();
  fn(f);
  fs.writeFileSync(path.join(OUT, `${key}.png`), f.toPNG(10));
  panels.push([title, f]);
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
