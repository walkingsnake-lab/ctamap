#!/usr/bin/env node
'use strict';
// Radar on a 128x32 panel: five layout proposals plus the rejected one, all
// from one recorded MRMS frame (Nov 3, 2026, 21:44 UTC: scattered showers
// west of Chicago). Not in radar.js or draw.js: the crop here takes any
// scale and size, and water comes from the lake outline per pixel (what
// build-locations.js precomputes per station at 64).
//   node scripts/mock-128-radar.js   -> docs/board/mockups/w128/radar-*.png

const fs = require('fs');
const path = require('path');
const B = path.join(__dirname, '..', 'server', 'board');
const { decodeRows } = require(path.join(B, 'radar-png'));
const radar = require(path.join(B, 'radar'));
const { Frame } = require(path.join(B, 'raster'));
const { packFonts } = require(path.join(B, 'fonts'));
const draw = require(path.join(B, 'render'));
const icons = require(path.join(B, 'icons'));

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'w128');
const F = packFonts();
const W = 128, H = 32, STAMP = '202611032144';
const C = draw.C;
const STATIONS = require(path.join(B, 'stations.json'));
const MORSE = STATIONS.find((s) => s.mapid === '40100');

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const measure = (font, s) => { let w = 0; for (const ch of s) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; } return w > 0 ? w - 1 : 0; };
const rtext = (f, font, s, x1, base, col) => f.text(font, s, x1 - measure(font, s) + 1, base, col);
const icon = (f, name, x, y) => icons.ICONS[name].forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') f.set(x + i, y + j, hex(icons.PALETTE[c])); }));

// ---- geometry: LED (x, y) <-> lat/lon for a view ----
// view: { lat, lon, cx, cy, mi }: (lat, lon) lands on LED (cx, cy); mi miles per LED.
const KM_MI = 1.609344;
const lonOf = (v, x) => v.lon + ((x + 0.5 - (v.cx + 0.5)) * v.mi * KM_MI) / (111.32 * Math.cos(v.lat * Math.PI / 180));
const latOf = (v, y) => v.lat - ((y + 0.5 - (v.cy + 0.5)) * v.mi * KM_MI) / 111.32;
const ledOf = (v, lat, lon) => [Math.floor(v.cx + ((lon - v.lon) * 111.32 * Math.cos(v.lat * Math.PI / 180)) / (v.mi * KM_MI)), Math.floor(v.cy + ((v.lat - lat) * 111.32) / (v.mi * KM_MI))];

// ---- lake mask ----
const RINGS = JSON.parse(fs.readFileSync(path.join(__dirname, 'geo-src', 'lake-michigan.geojson'), 'utf8')).features[0].geometry.coordinates;
const inRing = (ring, lon, lat) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; } return c; };
const isWater = (lon, lat) => inRing(RINGS[0], lon, lat) && !RINGS.slice(1).some((r) => inRing(r, lon, lat));

// ---- crop: mean linear reflectivity per LED -> levels 0-5, despeckled, water cleared ----
const Z = new Float64Array(256); for (let i = 66; i < 255; i++) Z[i] = Math.pow(10, (i * 0.5 - 32) / 10);
const WLD = radar.parseWld(fs.readFileSync(path.join(B, 'fixtures', 'mrms', `lcref_${STAMP}.wld`), 'utf8'));
async function crop(v, w, h = H) {
  const km = v.mi * KM_MI;
  const colsPer = km / (WLD.dx * 111.32 * Math.cos(v.lat * Math.PI / 180)), rowsPer = km / (Math.abs(WLD.dy) * 111.32);
  const sx = (v.lon - WLD.x0) / WLD.dx, sy = (v.lat - WLD.y0) / WLD.dy;
  const left = sx - (v.cx + 0.5) * colsPer, top = sy - (v.cy + 0.5) * rowsPer;
  const sum = new Float64Array(w * h), cnt = new Uint32Array(w * h);
  const x0 = Math.ceil(left), x1 = Math.ceil(left + w * colsPer) - 1;
  await decodeRows(fs.createReadStream(path.join(B, 'fixtures', 'mrms', `lcref_${STAMP}.png`)), {
    y0: Math.ceil(top), y1: Math.ceil(top + h * rowsPer) - 1,
    onRow: (y, row) => {
      const ly = Math.min(h - 1, Math.floor((y - top) / rowsPer));
      for (let c = x0; c <= x1; c++) { const k = ly * w + Math.min(w - 1, Math.floor((c - left) / colsPer)); sum[k] += Z[row[c]]; cnt[k]++; }
    },
  });
  const water = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) water[y * w + x] = isWater(lonOf(v, x), latOf(v, y)) ? 1 : 0;
  const lv = new Uint8Array(w * h);
  for (let k = 0; k < lv.length; k++) {
    const dbz = cnt[k] && sum[k] > 0 ? 10 * Math.log10(sum[k] / cnt[k]) : -Infinity;
    let n = 0; for (const t of [15, 25, 35, 45, 55]) if (dbz >= t) n++;
    lv[k] = water[k] ? 0 : n;
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!lv[y * w + x]) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h && lv[(y + dy) * w + x + dx]) n++;
    if (n >= 2) out[y * w + x] = lv[y * w + x];
  }
  return { w, h, lv: out, water };
}
// Draw a crop at (ox, 0); the shoreline on water pixels next to land; the station dot.
function paint(f, c, ox, v, { dot = MORSE, oy = 0 } = {}) {
  const { w, h, lv, water } = c;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (lv[k]) f.set(ox + x, oy + y, hex(draw.RADAR[lv[k]]));
    else if (water[k] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < w && Y < h && !water[Y * w + X]; })) f.set(ox + x, oy + y, hex(draw.RADAR[6]));
  }
  if (dot) { const [x, y] = ledOf(v, dot.lat, dot.lon); if (x >= 0 && x < w && y >= 0 && y < h) f.set(ox + x, oy + y, [255, 255, 255]); }
}
// Nearest precipitation to the station (miles, 8-point bearing, level).
function nearest(c, v, st = MORSE) {
  const [sx, sy] = ledOf(v, st.lat, st.lon);
  let best = null;
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const l = c.lv[y * c.w + x]; if (!l) continue;
    const d = Math.hypot(x - sx, y - sy);
    if (!best || d < best.d) best = { d, x, y, l };
  }
  if (!best) return null;
  const ang = (Math.atan2(sx - best.x, best.y - sy) * 180) / Math.PI; // 0 = north... computed below
  const deg = ((Math.atan2(best.x - sx, sy - best.y) * 180) / Math.PI + 360) % 360;
  void ang;
  return { mi: Math.round(best.d * v.mi), dir: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8], level: best.l };
}
const pips = (f, x0, y, w = 3, gap = 1, n = 6) => { for (let i = 0; i < n; i++) f.fill(x0 + i * (w + gap), y, w, 2, i === n - 1 ? C.amber : C.indicator); };
// Time 3:44 PM (21:44 UTC, CST).
const TIME = '3:44', AMPM = 'PM', TEMP = '58°';

// ---- 1. Split: map + time panel (every station) ----
async function split() {
  const f = new Frame(W, H), v = { lat: MORSE.lat, lon: MORSE.lon, cx: 52, cy: 16, mi: 1.5 };
  paint(f, await crop(v, 96), 0, v);
  f.fill(96, 0, 1, 32, C.divider);
  pips(f, 99, 1);
  rtext(f, '5x7', TIME, 127, 13, C.radarTime);
  rtext(f, 'small', AMPM, 127, 20, C.radarAmpm);
  icon(f, 'rain', 99, 23);
  rtext(f, 'small', TEMP, 127, 31, C.label);
  return f;
}

// ---- split variants: the map on the left, different right sides ----
// mapW columns of map (station at about 54 % across), a divider, the panel after it.
async function splitMap(mapW, divider = true) {
  const f = new Frame(W, H), v = { lat: MORSE.lat, lon: MORSE.lon, cx: Math.round(mapW * 0.54), cy: 16, mi: 1.5 };
  const c = await crop(v, mapW);
  paint(f, c, 0, v);
  if (divider) f.fill(mapW, 0, 1, 32, C.divider);
  return { f, c, v, x0: mapW + (divider ? 3 : 0) };
}
// A. Big time: the clock digits, AM/PM under, the loop as a thin bar at the bottom.
async function splitBigTime() {
  const { f } = await splitMap(87);
  const cx = 108;
  const tw = measure('clock', TIME);
  f.text('clock', TIME, Math.round(cx - tw / 2), 15, C.clock);
  const aw = measure('small', AMPM);
  f.text('small', AMPM, Math.round(cx - aw / 2), 23, C.radarAmpm);
  for (let i = 0; i < 6; i++) f.fill(90 + i * 6, 30, 5, 1, i === 5 ? C.amber : C.indicator);
  return f;
}
// B. Loop position: the six frames as a column of pips down the right edge (the newest
// amber), and the time of the frame on screen beside its pip, so it walks down as the loop plays.
async function splitTimeline(shown = 3) {
  const { f } = await splitMap(105);
  for (let i = 0; i < 6; i++) f.fill(125, 1 + i * 5, 3, 3, i === shown ? C.label : i === 5 ? C.amber : C.indicator);
  rtext(f, 'small', ['3:14', '3:20', '3:26', '3:32', '3:38', '3:44'][shown], 122, 1 + shown * 5 + 4, C.label);
  return f;
}
// C. Time and a color key: what the greens, yellows and reds mean.
async function splitLegend() {
  const { f } = await splitMap(96);
  rtext(f, '5x7', TIME, 127, 9, C.radarTime);
  rtext(f, 'small', AMPM, 127, 16, C.radarAmpm);
  [1, 2, 3, 4, 5].forEach((lv, i) => f.fill(99 + i * 6, 21, 5, 3, draw.RADAR[lv]));
  f.text('small', 'LO', 99, 31, C.dimHead);
  rtext(f, 'small', 'HI', 127, 31, C.dimHead);
  return f;
}
// D. No panel: the map across all 128 columns, the time on a small black chip in the corner.
async function splitInset() {
  const { f } = await splitMap(128, false);
  f.fill(101, 25, 27, 7, '#000000');
  rtext(f, 'small', AMPM, 127, 32, C.radarAmpm);
  rtext(f, 'small', TIME, 127 - measure('small', AMPM) - 2, 32, C.label);
  return f;
}
// E. Conditions first: the temperature in the clock digits, the condition, the time small.
async function splitConditions() {
  const { f } = await splitMap(91);
  icon(f, 'rain', 94, 1);
  const tx = f.text('clock', '58', 104, 13, C.white);
  f.text('small', '°', tx, 6, C.white);
  f.text('small', 'RAIN', 94, 22, '#4aa0ff');
  const t = f.text('small', TIME, 94, 31, C.grey);
  f.text('small', AMPM, t + 2, 31, C.radarAmpm);
  return f;
}

// ---- 2. One Chicago map for every board ----
// Downtown at x 76; the station is just the dot. The time sits over the lake at a fixed spot.
const CHI = { lat: 41.95, lon: -87.65, cx: 76, cy: 15, mi: 1.5 };
async function cityMap(st = MORSE) {
  const f = new Frame(W, H);
  const c = await crop(CHI, W);
  paint(f, c, 0, CHI, { dot: st });
  // Time stack as at 64 (pips, 5x7 time, AM/PM) in columns 84-103, rows 1-20: open water in this crop.
  pips(f, 87, 1, 2, 1);
  rtext(f, '5x7', TIME, 103, 13, C.radarTime);
  rtext(f, 'small', AMPM, 103, 20, C.radarAmpm);
  return { f, c };
}

// ---- 3. Full-width map, status bar under it ----
async function statusBar() {
  const f = new Frame(W, H), v = { lat: MORSE.lat, lon: MORSE.lon, cx: 76, cy: 12, mi: 1.5 };
  const c = await crop(v, W, 25);
  paint(f, c, 0, v);
  f.fill(0, 25, 128, 1, '#1a1a1a');
  pips(f, 0, 28, 3, 1);
  const tx = f.text('small', TIME, 27, 32, C.label);
  f.text('small', AMPM, tx + 2, 32, C.radarAmpm);
  const n = nearest(c, v);
  const msg = n ? `RAIN ${n.mi} MI ${n.dir}` : 'NO RAIN NEARBY';
  rtext(f, 'small', TEMP, 127, 32, C.label);
  rtext(f, 'small', msg, 127 - measure('small', TEMP) - 6, 32, '#4aa0ff');
  return f;
}

// ---- 4. Local and regional ----
// Left: the 64 radar as it is (1.5 mi/LED, station centered, time over the lake).
// Right: 6 mi/LED, about 380 x 190 mi, with the local view outlined.
async function twoZooms() {
  const f = new Frame(W, H);
  const lv = { lat: MORSE.lat, lon: MORSE.lon, cx: 32, cy: 16, mi: 1.5 };
  paint(f, await crop(lv, 64), 0, lv);
  pips(f, 46, 1, 2, 1);
  rtext(f, '5x7', TIME, 63, 13, C.radarTime);
  rtext(f, 'small', AMPM, 63, 20, C.radarAmpm);
  const rv = { lat: MORSE.lat, lon: MORSE.lon, cx: 32, cy: 16, mi: 6 };
  paint(f, await crop(rv, 64), 64, rv);
  f.fill(64, 0, 1, 32, C.divider);
  // The local view's outline (64 x 32 at 1.5 mi = 16 x 8 at 6 mi), around the dot.
  const [x, y] = ledOf(rv, MORSE.lat, MORSE.lon);
  const bx = 64 + x - 8, by = y - 4;
  for (let i = 0; i < 16; i++) { f.set(bx + i, by, [150, 150, 150]); f.set(bx + i, by + 7, [150, 150, 150]); }
  for (let j = 0; j < 8; j++) { f.set(bx, by + j, [150, 150, 150]); f.set(bx + 15, by + j, [150, 150, 150]); }
  return f;
}

// ---- 5. Map + nearest-rain panel ----
async function nearestPanel() {
  const f = new Frame(W, H), v = { lat: MORSE.lat, lon: MORSE.lon, cx: 50, cy: 16, mi: 1.5 };
  const c = await crop(v, 88);
  paint(f, c, 0, v);
  f.fill(88, 0, 1, 32, C.divider);
  const x0 = 91, n = nearest(c, v);
  f.text('small', 'NEAREST', x0, 6, C.dimHead);
  if (n) {
    const tx = f.text('5x7', String(n.mi), x0, 15, C.white);
    f.text('small', 'MI', tx + 2, 15, C.grey);
    rtext(f, '5x7', n.dir, 127, 15, C.white);
    f.text('small', ['', 'LIGHT', 'LIGHT', 'MODERATE', 'HEAVY', 'SEVERE'][n.level], x0, 22, hex(draw.RADAR[n.level]).map((q) => Math.min(255, Math.round(q * 1.6))).reduce((s, q) => s + q.toString(16).padStart(2, '0'), '#'));
  } else f.text('small', 'NONE', x0, 15, C.grey);
  const tx = f.text('small', TIME, x0, 31, C.label);
  f.text('small', AMPM, tx + 2, 31, C.radarAmpm);
  rtext(f, 'small', TEMP, 127, 31, C.label);
  return { f, n };
}

// ---- rejected: full width, time over the lake ----
async function overLake() {
  const f = new Frame(W, H), v = { lat: MORSE.lat, lon: MORSE.lon, cx: 92, cy: 16, mi: 1.5 };
  paint(f, await crop(v, W), 0, v);
  pips(f, 104, 1, 1, 1);
  rtext(f, 'clock', TIME, 127, 15, C.clock);
  rtext(f, 'small', AMPM, 127, 22, C.radarAmpm);
  return f;
}

// The fixed Chicago map's time box: check it's water, and every station is inside the view.
function checkCity() {
  const bad = [];
  for (let y = 1; y <= 20; y++) for (let x = 84; x <= 103; x++) if (!isWater(lonOf(CHI, x), latOf(CHI, y))) bad.push([x, y]);
  const out = STATIONS.filter((s) => { const [x, y] = ledOf(CHI, s.lat, s.lon); return x < 0 || x >= W || y < 0 || y >= H; });
  const xs = STATIONS.map((s) => ledOf(CHI, s.lat, s.lon));
  return { landInBox: bad.length, outside: out.length, xRange: [Math.min(...xs.map((p) => p[0])), Math.max(...xs.map((p) => p[0]))], yRange: [Math.min(...xs.map((p) => p[1])), Math.max(...xs.map((p) => p[1]))] };
}

(async () => {
  const city = await cityMap();
  const near = await nearestPanel();
  const chk = checkCity();
  console.log('city map check', JSON.stringify(chk), 'nearest', JSON.stringify(near.n));
  const MOCKS = [
    ['radar-p1-split', '1 · Split: map and time panel', await split(),
      'The map on 96 columns with the station at x52 (about 78 mi west, where weather comes from; the lake to the Michigan shore east); a 31-column panel with frame pips, time, condition and temperature.', 'Works the same at every station. Masks rebuilt per station at 96 wide.'],
    ['radar-p2-city', '2 · One Chicago map for every board', city.f,
      'The same crop for every board: downtown at x76, the lake on the right, and the board\'s station as the white dot. The time sits over the lake at a fixed spot, so there\'s no per-station layout.', `All 144 stations fall inside the view (columns ${chk.xRange[0]}–${chk.xRange[1]}, rows ${chk.yRange[0]}–${chk.yRange[1]}); the time box is open water. The server would crop one frame for all boards. The station is off center, so the view shows about 114 mi west of downtown and less west of a far-west station.`],
    ['radar-p3-bar', '3 · Full-width map, status bar', await statusBar(),
      'The map on rows 0–24 across all 128 columns, then a status bar: frame pips, time, the nearest rain and the temperature. Nothing sits on the map, so no water spot is needed.', 'The map is 25 rows (37 mi) tall instead of 32.'],
    ['radar-p4-zooms', '4 · Local and regional', await twoZooms(),
      'Left, the 64 radar unchanged (1.5 mi per LED, time over the lake). Right, the region at 6 mi per LED (about 380 × 190 mi) with the local view outlined, so storms show up hours out.', 'A side-by-side that means something: two zoom levels. Reuses the 64 layout and its per-station data as is.'],
    ['radar-p5-nearest', '5 · Map and nearest rain', near.f,
      'The map on 88 columns, then a panel that answers the question directly: the nearest rain\'s distance, direction and strength, with the time and temperature under it.', 'Computed from the frame the server already crops; whether the rain is moving closer would need two frames compared (later).'],
    ['radar-rejected-lake', 'Rejected · Full width, time over the lake', await overLake(),
      'The station at x92 and the time over the lake. Works at Morse, but no fixed spot is open water for every station: it fails at 56 of 144 (the Loop and South Side reach the Indiana shore).', ''],
  ];
  MOCKS.push(
    ['radar-s1-bigtime', 'Split A · Big time', await splitBigTime(), 'Only the time, in the clock digits, with AM/PM under it and the loop as a thin bar along the bottom. The map keeps 87 columns.', 'Wide enough for 12:44 (39 px).', 'split'],
    ['radar-s2-timeline', 'Split B · Loop position', await splitTimeline(), 'The six frames as a column of pips down the right edge, the newest amber; the time of the frame on screen sits beside its pip and walks down as the loop plays. The map keeps 105 columns.', 'Shown mid-loop, on the 3:32 frame.', 'split'],
    ['radar-s3-legend', 'Split C · Time and color key', await splitLegend(), 'The time at the top, then the five rain colors as swatches from LO to HI, so the greens and reds explain themselves.', '', 'split'],
    ['radar-s4-inset', 'Split D · No panel, corner chip', await splitInset(), 'The map across all 128 columns with the station at the same spot; the time on a small black chip in the bottom-right corner, over Michigan rather than the city.', 'Hides a 27 × 7 corner of the map.', 'split'],
    ['radar-s5-conditions', 'Split E · Conditions first', await splitConditions(), 'The temperature in the clock digits with the condition icon, the condition word, and the time small at the bottom.', '', 'split'],
  );
  const q5 = (v) => v & 0xf8;
  for (const [id, , fr] of MOCKS) {
    const q = new Frame(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) q.set(x, y, fr.get(x, y).map(q5));
    fs.writeFileSync(path.join(OUT, `${id}.png`), q.toPNG(10));
  }
  fs.writeFileSync(path.join(OUT, 'radar.json'), JSON.stringify(MOCKS.map(([id, title, , desc, note, kind]) => ({ kind: kind === 'split' ? 'radar-split' : 'radar', id, title, desc, note })), null, 1));
  console.log('wrote', MOCKS.map((m) => m[0]).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
