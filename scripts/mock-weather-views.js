#!/usr/bin/env node
'use strict';
// Concept mockups for new weather screens (not implemented; made-up data).
// Writes docs/board/mockups/weather/*.png and a contact sheet. Pixel-exact
// 64x32 frames using the board fonts and icons.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');
const { drawIcon } = require('../server/board/icons');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather');
fs.mkdirSync(OUT, { recursive: true });

// ---- color helpers ----
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lerp = (c0, c1, k) => hex(rgb(c0).map((v, i) => v + (rgb(c1)[i] - v) * k));
const dim = (c, k) => hex(rgb(c).map((v) => v * k));
function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) { const [v0, c0] = stops[i - 1]; return lerp(c0, stops[i][1], (v - v0) / (stops[i][0] - v0)); }
  }
  return stops[stops.length - 1][1];
}
// Same stops as draw.js's temperature shadow.
const TEMP = [[-10, '#3050ff'], [20, '#40a0ff'], [40, '#30d0d0'], [55, '#40d040'], [70, '#ffd000'], [85, '#ff8000'], [100, '#ff2020']];
const tempColor = (t) => ramp(TEMP, t);

const C = { label: '#d8d8d8', grey: '#8f8f8f', dim: '#555555', divider: '#333333', white: '#ffffff', blue: '#1e90ff' };

const px = (f, x, y, c) => f.fill(x, y, 1, 1, c);
const rtext = (f, font, s, right, base, c) => f.text(font, s, right - measure(font, s), base, c);
const ctext = (f, font, s, cx, base, c) => f.text(font, s, Math.round(cx - measure(font, s) / 2), base, c);
const sprite = (f, rows, x, y, c) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') px(f, x + i, y + j, typeof c === 'string' ? c : c[ch]); }));
// Big 9x15 digits (ink rows base-10..base-1) with the weather screen's 3x3 ring degree.
function bigTemp(f, t, x, base, c) {
  x = f.text('clock', String(t), x, base, c);
  sprite(f, ['###', '#.#', '###'], x, base - 10, c);
  return x + 3;
}
// Seeded random so the mocks are stable.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const panels = [];
function panel(name, title, fn) {
  const f = new Frame();
  fn(f);
  fs.writeFileSync(path.join(OUT, `${name}.png`), f.toPNG(10));
  panels.push([title, f]);
}

// 1. Hourly temperature bars, colored by temperature, rain chance strip.
panel('1-hourly-bars', '1 HOURLY', (f) => {
  const temps = [74, 78, 82, 85, 87, 88, 87, 85, 82, 79, 77, 75];
  const pop = [0, 0, 0, 10, 20, 40, 60, 70, 50, 30, 10, 0];
  f.text('5x7', '74', 0, 7, tempColor(74));
  f.text('small', '°', 11, 6, tempColor(74));
  rtext(f, 'small', 'HIGH 88° 2P', 63, 6, C.grey);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  temps.forEach((t, i) => {
    const x = 2 + i * 5, h = 3 + Math.round((t - lo) / (hi - lo) * 12);
    for (let j = 0; j < h; j++) f.fill(x, 23 - j, 4, 1, dim(tempColor(t), 0.3 + 0.7 * (j + 1) / h));
    if (pop[i]) f.fill(x, 25, 4, 1, dim(C.blue, 0.2 + 0.8 * pop[i] / 100));
  });
  [[0, '9A'], [3, '12P'], [6, '3P'], [9, '6P']].forEach(([i, s]) => ctext(f, 'small', s, 2 + i * 5 + 2, 31, C.dim));
});

// 2. Daylight arc: dusk sky gradient, sun riding an arc from sunrise to sunset.
panel('2-sun-arc', '2 DAYLIGHT', (f) => {
  for (let y = 0; y <= 21; y++) f.fill(0, y, 64, 1, ramp([[0, '#04082a'], [11, '#1c0c40'], [18, '#5a1c30'], [21, '#a04010']], y));
  const cx = 31.5, cy = 21, rx = 26, ry = 18;
  for (let a = 0; a <= 180; a += 4) {
    const r = a * Math.PI / 180;
    px(f, Math.round(cx - rx * Math.cos(r)), Math.round(cy - ry * Math.sin(r)), '#8a6a30');
  }
  const k = 0.94, r = k * Math.PI;   // 5:40 PM between 6:58 AM and 6:21 PM
  const sx = Math.round(cx - rx * Math.cos(r)), sy = Math.round(cy - ry * Math.sin(r));
  sprite(f, ['.ooo.', 'oyyyo', 'oyyyo', 'oyyyo', '.ooo.'], sx - 2, sy - 2, { o: '#ff7a10', y: '#ffd040' });
  f.fill(0, 22, 64, 1, '#ff8a20');
  f.text('small', '57°', 0, 6, C.label);
  sprite(f, ['.#.', '###'], 0, 27, '#ffc800');
  f.text('small', '6:58', 4, 31, C.grey);
  sprite(f, ['###', '.#.'], 42, 27, '#ff7a10');
  rtext(f, 'small', '6:21', 63, 31, C.label);
  ctext(f, 'small', '41M', 32, 31, '#ff7a10');
});

// 3. Five-day range bars: low..high as a temperature gradient on a shared scale.
panel('3-week-ranges', '3 5-DAY', (f) => {
  const days = [['TDY', 49, 63, 57], ['SAT', 52, 71], ['SUN', 58, 78], ['MON', 55, 66], ['TUE', 41, 52]];
  const lo = 41, hi = 78, x0 = 25, x1 = 51;
  const xOf = (t) => Math.round(x0 + (t - lo) / (hi - lo) * (x1 - x0));
  days.forEach(([d, l, h, now], i) => {
    const t = 1 + i * 6;
    f.text('small', d, 0, t + 5, i ? C.grey : C.label);
    rtext(f, 'small', String(l), 22, t + 5, C.dim);
    f.fill(x0, t + 2, x1 - x0 + 1, 1, '#1c1c1c');
    for (let x = xOf(l); x <= xOf(h); x++) f.fill(x, t + 1, 1, 3, tempColor(lo + (x - x0) / (x1 - x0) * (hi - lo)));
    if (now != null) f.fill(xOf(now), t, 1, 5, C.white);
    f.text('small', String(h), 54, t + 5, C.label);
  });
});

// 4. Rain incoming: next two hours of precipitation as a radar-colored area.
panel('4-rain-incoming', '4 RAIN SOON', (f) => {
  ctext(f, 'small', 'RAIN IN 25 MIN', 32, 6, '#60b0ff');
  const amt = (x) => (x < 12 ? 0 : x < 30 ? (x - 12) / 18 * 13 : x < 40 ? 13 - (x - 30) * 0.7 : x < 56 ? Math.max(0, 6 - (x - 40) * 0.38) : 0);
  for (let x = 0; x < 64; x++) {
    const h = Math.round(amt(x) + (x > 12 && x < 55 ? Math.sin(x * 1.7) * 0.8 : 0));
    for (let j = 0; j < h; j++) px(f, x, 23 - j, ramp([[0, '#007a20'], [4, '#20c040'], [7, '#e0c000'], [10, '#ff8000'], [12, '#ff2020']], j));
  }
  f.fill(0, 24, 64, 1, C.divider);
  [0, 30, 60].forEach((x) => px(f, x, 25, C.grey));
  f.text('small', 'NOW', 0, 31, C.grey);
  ctext(f, 'small', '1H', 31, 31, C.dim);
  rtext(f, 'small', '2H', 63, 31, C.dim);
});

// 5/6. Skyline scene: the sky shows the conditions (animated on the board:
// twinkling stars and windows, falling rain, blinking antenna lights).
function skyline(f, windowsLit) {
  const top = new Array(64).fill(32);
  const bldg = (x, w, t) => { for (let i = x; i < x + w; i++) top[i] = Math.min(top[i], t); };
  bldg(0, 4, 24); bldg(4, 3, 21); bldg(7, 5, 23); bldg(12, 4, 19); bldg(16, 2, 22);
  bldg(18, 2, 14); bldg(20, 2, 10); bldg(22, 2, 12);           // Willis
  bldg(24, 3, 20); bldg(27, 3, 17); bldg(30, 1, 15); bldg(31, 1, 12); bldg(32, 1, 15); // Trump
  bldg(33, 4, 19); bldg(37, 3, 22); bldg(40, 4, 13);            // Aon
  bldg(44, 1, 23); bldg(45, 5, 11);                             // Hancock
  bldg(50, 4, 21); bldg(54, 3, 25);
  for (let x = 0; x < 64; x++) for (let y = top[x]; y < 32; y++) {
    const win = x % 2 === 1 && y % 2 === 0 && y > top[x] && rand() < windowsLit;
    px(f, x, y, win ? (rand() < 0.35 ? '#ffb050' : '#8a5c20') : '#26263a');
  }
  // Hancock taper: shave its corners toward the top.
  for (let y = 11; y < 20; y++) { px(f, 45, y, '#000000'); if (y < 15) px(f, 49, y, '#000000'); }
  for (let y = 5; y < 10; y++) px(f, 20, y, '#606060');
  for (let y = 6; y < 10; y++) px(f, 23, y, '#606060');
  for (let y = 8; y < 12; y++) px(f, 31, y, '#606060');
  for (let y = 6; y < 11; y++) { px(f, 46, y, '#606060'); px(f, 48, y, '#606060'); }
  [[20, 4], [23, 5], [46, 5], [48, 5]].forEach(([x, y]) => px(f, x, y, '#ff2020'));
  // The lake, east of downtown.
  for (let x = 57; x < 64; x++) for (let y = 27; y < 32; y++) px(f, x, y, (x + y) % 3 ? '#081830' : '#103060');
  return top;
}
panel('5-skyline-night', '5 SKYLINE CLEAR', (f) => {
  for (let y = 0; y < 22; y++) f.fill(0, y, 64, 1, ramp([[0, '#000008'], [21, '#0c1430']], y));
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rand() * 64), y = Math.floor(rand() * 16);
    if (x > 18 || y > 8) px(f, x, y, rand() < 0.3 ? '#ffffff' : '#606878');
  }
  sprite(f, ['.MM.', 'M...', 'M...', 'M...', '.MM.'], 56, 2, '#e8dca0');
    skyline(f, 0.45);
  f.fill(0, 0, 17, 7, '#000008');
  f.text('small', '48°', 1, 6, C.label);
});
panel('6-skyline-rain', '6 SKYLINE RAIN', (f) => {
  for (let y = 0; y < 22; y++) f.fill(0, y, 64, 1, ramp([[0, '#202428'], [7, '#101418'], [21, '#0a0e14']], y));
  for (let x = 0; x < 64; x++) { const h = 2 + Math.round(1.5 + Math.sin(x * 0.45) * 1.5 + Math.sin(x * 1.3)); f.fill(x, 0, 1, h, '#3a3e44'); }
  const top = skyline(f, 0.6);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rand() * 64), y = 5 + Math.floor(rand() * 26);
    [0, 1].forEach((d) => { if (y + d < top[x]) px(f, x, y + d, d ? '#50a0ff' : '#2860b0'); });
  }
  f.fill(0, 0, 17, 7, '#000000');
  f.text('small', '51°', 1, 6, C.label);
});

// 7. Wind: compass rose with the arrow pointing downwind, speed colored by strength.
panel('7-wind', '7 WIND', (f) => {
  const cx = 15, cy = 15, R = 13;
  for (let a = 0; a < 360; a += 15) {
    const r = a * Math.PI / 180;
    px(f, Math.round(cx + R * Math.sin(r)), Math.round(cy - R * Math.cos(r)), a % 90 ? '#3a3a3a' : '#909090');
  }
  px(f, cx, cy - R, '#ff2020'); px(f, cx, cy - R + 1, '#ff2020');
  // From NW, so the air moves toward the SE: tail at NW, head at SE.
  for (let i = -9; i <= 8; i++) px(f, cx + Math.round(i * 0.707), cy + Math.round(i * 0.707), dim('#40e0ff', 0.25 + 0.75 * (i + 9) / 17));
  sprite(f, ['..#', '..#', '###'], cx + 4, cy + 4, '#40e0ff');
  f.text('small', 'FROM NW', 33, 6, C.grey);
  const sp = ramp([[0, '#40d040'], [15, '#ffd000'], [25, '#ff8000'], [40, '#ff2020']], 18);
  const x = f.text('clock', '18', 33, 20, sp);
  f.text('small', 'MPH', x + 2, 20, C.grey);
  f.text('small', 'GUST 31', 33, 31, '#ff8000');
});

// 8. Meters: UV, air quality, dew point comfort, each on a colored scale.
panel('8-meters', '8 UV / AIR / DEW', (f) => {
  const rows = [
    ['UV', 6, 'HIGH', [[0, '#40d040'], [2.5, '#40d040'], [3, '#ffd000'], [5.5, '#ffd000'], [6, '#ff8000'], [7.5, '#ff8000'], [8, '#ff2020'], [10.5, '#ff2020'], [11, '#a040ff']], 0, 12],
    ['AQI', 42, 'GOOD', [[0, '#40d040'], [50, '#40d040'], [51, '#ffd000'], [100, '#ffd000'], [101, '#ff8000'], [150, '#ff2020'], [200, '#a040ff']], 0, 200],
    ['DEW', 68, 'STICKY', [[40, '#40a0ff'], [55, '#40d040'], [62, '#ffd000'], [68, '#ff8000'], [74, '#ff2020']], 40, 76],
  ];
  rows.forEach(([lbl, v, word, stops, lo, hi], i) => {
    const t = 1 + i * 11;
    const x = f.text('small', lbl, 0, t + 5, C.grey);
    f.text('small', String(v), x + 3, t + 5, C.label);
    const vx = Math.round((v - lo) / (hi - lo) * 63);
    for (let xx = 0; xx < 64; xx++) f.fill(xx, t + 7, 1, 2, dim(ramp(stops, lo + xx / 63 * (hi - lo)), xx <= vx ? 1 : 0.22));
    f.fill(vx, t + 6, 1, 4, C.white);
    rtext(f, 'small', word, 63, t + 5, ramp(stops, v));
  });
});

// 9. Temperature halo: the border is the next 24 hours, clockwise from the top
// center (now), colored by temperature and dimmed overnight.
panel('9-temp-halo', '9 24H HALO', (f) => {
  const temps = [64, 63, 61, 58, 55, 53, 52, 51, 50, 49, 48, 48, 48, 49, 52, 56, 60, 64, 68, 71, 74, 76, 76, 75, 73];
  const night = (h) => h >= 4 && h < 16;   // 7 PM to 7 AM, starting 3 PM
  const ring = [];
  for (let x = 32; x < 64; x++) ring.push([x, 0]);
  for (let y = 1; y < 32; y++) ring.push([63, y]);
  for (let x = 62; x >= 0; x--) ring.push([x, 31]);
  for (let y = 30; y >= 0; y--) ring.push([0, y]);
  for (let x = 1; x < 32; x++) ring.push([x, 0]);
  ring.forEach(([x, y], i) => {
    const h = i / ring.length * 24, k = h - Math.floor(h);
    const t = temps[Math.floor(h)] * (1 - k) + temps[Math.floor(h) + 1] * k;
    px(f, x, y, dim(tempColor(t), night(Math.floor(h)) ? 0.35 : 1));
  });
  f.fill(31, 1, 2, 2, C.white);
  const w = measure('clock', '64') + 3;
  bigTemp(f, 64, Math.round(32 - w / 2), 17, C.label);
  ctext(f, 'small', 'PT CLOUDY', 32, 25, C.grey);
});

// 10. Tomorrow vs today: one big number and how much warmer or colder.
panel('10-tomorrow', '10 TOMORROW', (f) => {
  f.text('small', 'TOMORROW', 0, 6, C.grey);
  drawIcon(f, 'sun', 55, 0);
  bigTemp(f, 73, 0, 19, tempColor(73));
  sprite(f, ['..#..', '.###.', '#####', '..#..', '..#..', '..#..'], 30, 10, '#ff8000');
  const x = f.text('5x7', '12', 37, 16, '#ff8000');
  f.text('small', '°', x, 15, '#ff8000');
  f.text('small', 'WARMER', 30, 23, dim('#ff8000', 0.7));
  f.text('small', 'LOW 58  SUNNY', 0, 31, C.grey);
});

// Contact sheet: panels in a 2-column grid with titles above each.
const COLS = 2, PW = 64, PH = 32, GAP = 4, TH = 8;
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, Math.ceil(panels.length / COLS) * (PH + TH + GAP) + GAP);
panels.forEach(([title, f], i) => {
  const ox = GAP + (i % COLS) * (PW + GAP), oy = GAP + Math.floor(i / COLS) * (PH + TH + GAP);
  sheet.text('small', title, ox, oy + 5, '#606060');
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y));
  for (let x = -1; x <= PW; x++) { sheet.set(ox + x, oy + TH - 1, [30, 30, 30]); sheet.set(ox + x, oy + TH + PH, [30, 30, 30]); }
});
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(6));
console.log(`wrote ${panels.length} panels + sheet.png to ${path.relative(process.cwd(), OUT)}`);
