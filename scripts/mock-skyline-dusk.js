#!/usr/bin/env node
'use strict';
// Skyline clock face: two mockups for design-spec.md "Clock screen: skyline face".
//
//   node scripts/mock-skyline-dusk.js
//
// dusk.png  The sky following the sun continuously instead of snapping between four looks:
//           Oct 31, 2026, 5:00-6:50 PM CDT, every 10 min, clear. Sun elevation and bearing come
//           from a NOAA-style solar position (the server would compute the same). Keyframe skies
//           are blended by elevation; windows, stars, wheel lights and beacons come on with dusk.
// boat.png  The quarter-hour sailboat (day only), brown and red hulls, including passing behind
//           the text and in front of the pier.
//
// Pieces (skyline, wheel, water, text) come from mock-weather-lake.js. Text is at the bottom.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const L = require('./mock-weather-lake');
const { W, SHORE, mix, ramp, sstep, hash2 } = L;

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'lake');
const LAT = 41.8917, LON = -87.590, TZO = -5;            // viewer on the lake; CDT on Oct 31, 2026

// ---- sun position (NOAA low-precision formulas; good to ~0.1°) ----
const RAD = Math.PI / 180;
function sunPos(ms) {
  const n = ms / 86400000 + 2440587.5 - 2451545.0;
  const Lm = (((280.460 + 0.9856474 * n) % 360) + 360) % 360, g = (357.528 + 0.9856003 * n) * RAD;
  const lam = (Lm + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD, eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const h = (gmst * 15 + LON) * RAD - ra, la = LAT * RAD;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(h)) / RAD;
  const az = (Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / RAD + 540) % 360;
  return { el, az };
}

// ---- keyframe skies by sun elevation (clear weather); blended row by row ----
const KEYS = [
  { el: 12, sky: [[0, '#08245a'], [18, '#1a4a8e'], [26, '#3a6eb0']], water: ['#0a2a52', '#06203f', '#1a3a68'] },              // day
  { el: 6, sky: [[0, '#14347a'], [14, '#3a62a0'], [22, '#b89880'], [26, '#f0b868']], water: ['#1a3050', '#10223e', '#3a4a68'] },  // golden hour
  { el: 1, sky: [[0, '#1a1440'], [9, '#5a2a5a'], [17, '#c0503a'], [23, '#f08a30'], [26, '#ffb848']], water: ['#3a2030', '#2a1424', '#7a3a3a'] },   // sunset (the mock's)
  { el: -3, sky: [[0, '#0e1040'], [12, '#30285e'], [20, '#80406a'], [26, '#c86a50']], water: ['#201830', '#140e22', '#4a3048'] },   // dusk
  { el: -6, sky: [[0, '#06103a'], [18, '#22306a'], [26, '#4a4a88']], water: ['#141a3a', '#0c1028', '#283060'] },                    // civil twilight ends (the mock's twilight)
  { el: -10, sky: [[0, '#000006'], [26, '#0c1430']], water: ['#030816', '#02050f', '#0e1a36'] },                                     // night
];
function blend(el) {
  let i = 1; while (i < KEYS.length - 1 && el < KEYS[i].el) i++;
  const a = KEYS[i - 1], b = KEYS[i], k = Math.max(0, Math.min(1, (a.el - el) / (a.el - b.el)));
  const ra = ramp(a.sky), rb = ramp(b.sky);
  return { sky: (y) => mix(ra(y), rb(y), k), water: a.water.map((c, j) => mix(c, b.water[j], k)) };
}

// ---- dusk pieces ----
// Sun: real height at the skyline's 2.4 rows per degree (center row 22 at the horizon, hidden by the
// buildings); x on its own scale, 0.8 px per degree of bearing (spec: x 6-58 over the year). Above
// ~8° it would leave the top of the panel, so it slides to the day spot (x 38, rows 2-8) as it climbs.
function drawSun(f, el, az) {
  const setX = 32 + (az - 270) * 0.8, cy = 22 - el * 2.4;
  const k = sstep(8, 14, el), x = Math.round(setX + (41 - setX) * k), y = Math.round(cy + (5 - cy) * k);
  if (y - 3 < 0 || y - 3 > SHORE - 6) return;
  L.disc(f, x - 3, y - 3, mix('#ffd040', '#fff0a0', sstep(6, 0, el)), true);
}
// Windows switch on one by one as the sky darkens: each slot has its own threshold (a hash), so the
// lit set only grows. Same placement rules as the mock's windows().
function windowsDusk(f, k) {
  const role = L.getRole();
  for (let y = 0; y <= SHORE; y++) for (let x = 0; x < W; x++) {
    const r = role[y][x];
    if (!r || (r === 'fill' && x < 38) || (x >= 19 && x <= 44 && y >= 20) || Math.hypot(x + 0.5 - 32, y + 0.5 - 18) < 7) continue;
    if (x % 2 || y % 2 === 0 || !L.isB(x, y - 1)) continue;
    if (hash2(x, y, 5) < 0.45 * k) f.fill(x, y, 1, 1, hash2(x, y, 9) < 0.3 ? '#ffb050' : '#8a5c20');
  }
}
// Beacons: dark red to bright red over 4 s, never off.
function beacons(f, T) {
  const k = 0.5 + 0.5 * Math.cos(2 * Math.PI * T / 40);
  for (const [x, t, , b] of L.getAnts()) if (b) f.fill(x, t, 1, 1, mix('#401010', '#ff2020', k));
}

function duskFrame(ms, T) {
  const { el, az } = sunPos(ms);
  L.setTick(T);
  const f = new Frame(), b = blend(el), night = sstep(1, -6, el);
  L.paint(f, b.sky);
  if (el > -1) drawSun(f, el, az);
  const nStars = Math.round(14 * sstep(-4, -9, el));
  if (nStars) L.stars(f, nStars);
  windowsDusk(f, night);
  L.antennas(f, false);
  if (el < 0) beacons(f, T);
  L.wheel(f, el < 0.5 ? L.WHEEL_NIGHT : L.wheelForDay(f));
  const sx = 32 + (az - 270) * 0.8, glit = sstep(-2, 1, el) * sstep(8, 4, el);
  L.water(f, { top: b.water[0], bottom: b.water[1], ripple: b.water[2],
    ripFn: (x, y) => glit > 0 && x > 14 && x < 45 && Math.abs(x + 0.5 - sx) < 1.5 + (y - SHORE) * 0.8 ? mix(b.water[2], '#e08a40', glit) : b.water[2] });
  L.pier(f, el < 0.5 ? L.PIER_NIGHT : { top: mix(L.PIER_DAY.top, L.PIER_NIGHT.top, night), face: mix(L.PIER_DAY.face, L.PIER_NIGHT.face, night) });
  const local = new Date(ms + TZO * 3600000), hh = local.getUTCHours() % 12 || 12, mm = String(local.getUTCMinutes()).padStart(2, '0');
  L.label(f, '52°', `${hh}:${mm}`);
  return { f, el, title: `${hh}:${mm} ${el >= 0 ? '+' : ''}${el.toFixed(1)}` };
}

// ---- boat ----
// A sailboat, by day only, crossing at each quarter hour: a white sail on rows 22-25 in front of the
// city and a colored hull on rows 26-27 (deck row 6 px, keel row 4 px), so the hull still shows above
// the text when it passes behind the temperature or the clock. Drawn before the text.
const SAIL = ['..#...', '..##..', '..###.', '..####'];
const HULLS = { brown: ['#8a4a24', '#5a2e16'], red: ['#c02a20', '#7a1a14'] };
function boat(f, x0, dir, hull = HULLS.brown) {
  const put = (dx, y, c) => { const x = dir < 0 ? x0 + dx : x0 + 5 - dx; if (x >= 0 && x < W) f.fill(x, y, 1, 1, c); };
  SAIL.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch === '#') put(dx, 22 + dy, '#e8ecf0'); }));
  for (let dx = 0; dx < 6; dx++) put(dx, 26, hull[0]);
  for (let dx = 1; dx < 5; dx++) put(dx, 27, hull[1]);
}

// Speedboat, loosely the Seadog: a long low yellow hull (14 px) with a white bottom stripe, blue
// passenger rows along the deck, a raised helm with a windshield toward the stern, and a white spray
// plume trailing behind. Rows 23-27; leading edge (the bow) at x0. It crosses fast, turns around
// off-panel and comes back the other way a few seconds later.
const SEADOG = [
  '..........yy..',    // 23: top of the helm
  '.........ywwy.',    // 24: windshield
  '..pqpqpqpYYYYy',    // 25: passengers, helm
  'YYYYYYYYYYYYYY',    // 26: deck (bow at dx 0)
  '.WWWWWWWWWWWW.',    // 27: white bottom
];
const SEADOG_C = { y: '#e8a810', Y: '#ffc020', w: '#c8d8e8', p: '#3a5aa8', q: '#d8dce4', W: '#e8ecf0' };
function speedboat(f, x0, dir) {
  const n = SEADOG[0].length;
  const put = (dx, y, c) => { const x = dir < 0 ? x0 + dx : x0 + n - 1 - dx; if (x >= 0 && x < W) f.fill(x, y, 1, 1, c); };
  SEADOG.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch !== '.') put(dx, 23 + dy, SEADOG_C[ch]); }));
  // Spray plume behind the stern: longest on the water row, shorter above, fading out.
  const plume = [[27, 9], [26, 6], [25, 3]];
  for (const [y, len] of plume) for (let i = 0; i < len; i++) put(n + i, y, mix(y === 27 ? '#1a3a68' : '#3a6eb0', '#f4f8fc', 0.95 * (1 - i / len)));
}

if (require.main === module) {
  Object.assign(L.OPT, { text: 'bottom', clock: true, reflect: false });
  L.buildSkyline();
  const start = Date.UTC(2026, 9, 31, 22, 0);                 // 5:00 PM CDT
  const frames = [];
  for (let m = 0; m <= 110; m += 10) frames.push(duskFrame(start + m * 60000, m * 3));
  fs.writeFileSync(path.join(OUT, 'dusk.png'), L.sheet(frames.map((d) => [d.title, d.f]), 3, 6));

  const cells = [];
  const day = Date.UTC(2026, 9, 31, 19, 15);                 // 2:15 PM CDT
  for (const [x0, dir, hull, t] of [[52, -1, 'brown', 'BROWN  SAILING LEFT'], [8, -1, 'brown', 'BROWN  BEHIND THE TEMP'],
    [48, 1, 'red', 'RED  BEHIND THE CLOCK'], [30, -1, 'red', 'RED  PAST THE PIER']]) {
    const d = duskFrame(day, 0);
    boat(d.f, x0, dir, HULLS[hull]);
    L.label(d.f, '52°', '2:15');                              // text back on top of the boat
    cells.push([t, d.f]);
  }
  fs.writeFileSync(path.join(OUT, 'boat.png'), L.sheet(cells, 2, 6));
  const sp = [];
  for (const [x0, dir, t] of [[44, -1, 'SEADOG  OUTBOUND, LEFT'], [4, -1, 'SEADOG  BEHIND THE TEMP'], [22, 1, 'SEADOG  BACK, PAST THE PIER'], [40, 1, 'SEADOG  BEHIND THE CLOCK']]) {
    const d = duskFrame(day, 0);
    speedboat(d.f, x0, dir);
    L.label(d.f, '52°', '2:15');
    sp.push([t, d.f]);
  }
  fs.writeFileSync(path.join(OUT, 'speedboat.png'), L.sheet(sp, 2, 6));
  console.log('wrote dusk.png, boat.png, speedboat.png to', path.relative(process.cwd(), OUT));
}
module.exports = { sunPos, blend, duskFrame, boat, HULLS, speedboat };
