#!/usr/bin/env node
'use strict';
// "No trains" screen mockups: alternatives to the overnight clock + NO TRAINS
// (spec 5, Other states). Each row is one idea as key frames, plus its
// weather-strip and NO DATA states where they differ. Not in draw.js.
// Colors cut to the panel's 5 bits per channel. Made-up times.
//   node scripts/mock-no-trains.js   -> docs/board/mockups/no-trains/sheet.png

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { packFonts } = require('../server/board/fonts');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'no-trains');
const F = packFonts();

// ---- helpers ----
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const C = {
  label: '#d8d8d8', clock: '#cccccc', noTrains: '#6c6c6c', dark: '#555555', rule: '#333333',
  grey: '#808080', sched: '#6a6a6a', red: '#ff2020', white: '#ffffff',
};
const LINE = { RD: '#c60c30', BR: '#8a4a24', BL: '#00a1de' }; // Brown boosted, as on the transit screen

function measure(font, s) {
  let w = 0;
  for (const ch of s) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; }
  return w > 0 ? w - 1 : 0;
}
const ctext = (f, font, s, cx, base, col) => f.text(font, s, Math.round(cx - measure(font, s) / 2), base, col);
const rtext = (f, font, s, x1, base, col) => f.text(font, s, x1 - measure(font, s), base, col);
const px = (f, x, y, c) => f.set(x, y, hex(c));
function line(f, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    px(f, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
// Pixel art: rows of characters, '.' unlit, others keys into pal.
function sprite(f, rows, x, y, pal) {
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.' && pal[ch]) px(f, x + i, y + j, pal[ch]); }));
}
// Big 9x15 Bold clock; digits fill rows top..top+9.
const bigClock = (f, t, cx, top) => ctext(f, 'clock', t, cx, top + 10, C.clock);
// Transit weather strip, rows 27-31.
function wxStrip(f) {
  f.text('small', '41°', 0, 32, C.dark);
  rtext(f, 'small', 'CLEAR', 63, 32, C.dark);
}
const T = '1:12';

// ---- 0. Today ----
function current({ wx = false, stale = false } = {}) {
  const f = new Frame();
  const nt = stale ? 'NO DATA' : 'NO TRAINS';
  const top = Math.floor(((wx ? 26 : 32) - 18) / 2);
  bigClock(f, T, 32, top);
  ctext(f, 'small', nt, 32, top + 18, C.noTrains);
  if (wx) wxStrip(f);
  return f;
}

// ---- 1. Sleeping train: a parked 2-car train, Zs drift up from the cab ----
const CAR = [
  '..ggggggggggggggggggggggggggg',
  '.gsssssssssssssssssssssssssss',
  'gsRRsskkkskkkskkkskkkskkkssss',
  'gsRRsskkkskkkskkkskkkskkkssss',
  'gssssskkkskkkskkkskkkskkkssss',
  'gssssssssssssssssssssssssssss',
  'gsssssssssssssssssssssssssssd',
  '.dddddddddddddddddddddddddddd',
  '...wwww..............wwww....',
];
function sleeping({ z = 0, wx = false, stale = false } = {}) {
  const f = new Frame();
  bigClock(f, T, 32, 1);
  const by = wx ? 25 : 30; // rail row
  const ty = by - CAR.length;
  const pal = { g: '#8a8a8a', s: '#4e4e4e', d: '#2c2c2c', k: '#121212', w: '#333333', R: stale ? '#555555' : LINE.RD };
  sprite(f, CAR, 6, ty, pal);
  sprite(f, CAR, 6 + 30, ty, pal);
  f.fill(0, by, 64, 1, C.rule);
  // Zs rise from above the cab, fading as they go
  const zs = [[3, ty - 2, '#8a8a8a'], [0, ty - 7, '#5a5a5a'], [3, ty - 12, '#333333']];
  zs.forEach(([x, y, c], i) => {
    const k = (i + z) % 3;
    const [zx, zy, zc] = zs[k];
    if (zy > 11) f.text('small', 'Z', zx, zy, zc);
  });
  if (stale) ctext(f, 'small', 'NO DATA', 40, ty - 3, C.noTrains);
  if (wx) wxStrip(f);
  return f;
}

// ---- 2. Owl: CTA calls overnight service Owl; it blinks now and then ----
const OWL = [
  '.B.........B.',
  '.BB.......BB.',
  '.BBBBBBBBBBB.',
  'BBWWWBBBWWWBB',
  'BWYYYWBWYYYWB',
  'BWYKYWBWYKYWB',
  'BWYYYWOWYYYWB',
  'BBWWWBOBWWWBB',
  'BBbbbbbbbbbBB',
  'BbbBbbbbBbbbB',
  'BbbbbbBbbbBbB',
  'BbBbbbbbbbbbB',
  '.BbbbBbbbBbB.',
  '..BBBBBBBBB..',
  '...O.O.O.O...',
];
function owl({ eyes = 'open', wx = false, stale = false } = {}) {
  const f = new Frame();
  let rows = OWL.slice();
  if (eyes === 'blink') rows = rows.map((r, j) => (j >= 4 && j <= 6 ? r.replace(/[YK]/g, j === 5 ? 'W' : 'B').replace(/W(?=[WB]*W)/g, 'W') : r));
  if (eyes === 'look') rows = rows.map((r) => r.replace(/YKY/g, 'YYK'));
  const bottom = wx ? 25 : 31;
  const oy = bottom - 1 - OWL.length;
  // perch: a girder across the panel
  f.fill(0, bottom - 1, 64, 2, '#2e2e2e');
  for (let x = 1; x < 64; x += 4) px(f, x, bottom, '#1e1e1e');
  sprite(f, rows, 2, oy, {
    B: '#6e4a2a', b: '#a8875c', W: '#d8c8a8', Y: stale ? '#555555' : '#ffd040', K: '#101010', O: '#d08030',
  });
  const cx = 40;
  const top = wx ? 3 : 5;
  bigClock(f, T, cx, top);
  ctext(f, 'small', stale ? 'NO DATA' : 'NO TRAINS', cx, top + 18, C.noTrains);
  if (wx) wxStrip(f);
  return f;
}

// ---- 3. Signal: the track ahead, a red signal; dark when there's no data ----
function signal({ aspect = 'red', wx = false } = {}) {
  const f = new Frame();
  const bot = wx ? 25 : 31;
  const vy = 16, vx = 30;
  // ties first (between the rails), spaced wider toward the viewer
  for (let k = 0; k < 7; k++) {
    const y = Math.round(vy + (bot - vy) * Math.pow((k + 1) / 7, 1.8));
    const t = (y - vy) / (bot - vy);
    const half = Math.round(2 + 22 * t);
    line(f, vx - half - 2, y, vx + half + 2, y, k < 2 ? '#1c1c1c' : '#2a2a2a');
  }
  line(f, vx - 1, vy, vx - 24, bot, '#5a5a5a');
  line(f, vx + 1, vy, vx + 24, bot, '#5a5a5a');
  // signal mast and head, right of the track
  const sx = 59;
  f.fill(sx + 1, 6, 1, bot - 5, '#3a3a3a');
  f.fill(sx - 1, 4, 5, 9, '#222222');
  const lamp = (y, on, c) => {
    f.fill(sx, y, 3, 2, on ? c : '#0c0c0c');
    if (on) { px(f, sx + 1, y - 1, mixDim(c)); px(f, sx + 1, y + 2, mixDim(c)); }
  };
  lamp(6, aspect === 'red', C.red);
  lamp(9, aspect === 'green', '#20d040');
  if (aspect === 'flash') lamp(6, true, '#ffd000');
  // clock in the sky, left of the signal
  ctext(f, '5x7', T, vx, 8, C.clock);
  ctext(f, 'small', aspect === 'dark' || aspect === 'flash' ? 'NO DATA' : 'NO TRAINS', vx, 14, C.noTrains);
  if (wx) wxStrip(f);
  return f;
}
const mixDim = (c) => '#' + hex(c).map((v) => Math.round(v * 0.25).toString(16).padStart(2, '0')).join('');

// ---- 4. The L at night: empty elevated track, moon and stars ----
const STARS = [[3, 2], [14, 5], [24, 1], [51, 3], [60, 9], [57, 1], [8, 12], [44, 14], [61, 15], [20, 15]];
function nightL({ tw = 0, wx = false } = {}) {
  const f = new Frame();
  const bot = wx ? 25 : 31;
  const deck = wx ? 19 : bot - 8;
  STARS.forEach(([x, y], i) => { if (y < deck - 1) px(f, x, y, (i + tw) % 3 === 0 ? '#3a3a40' : '#8a8a90'); });
  // crescent moon, top left
  sprite(f, ['.MM.', 'MM..', 'M...', 'MM..', '.MM.'], 4, 3, { M: '#a89c70' });
  bigClock(f, T, 36, wx ? 0 : 2);
  ctext(f, 'small', 'NO TRAINS', 36, wx ? 16 : 19, C.noTrains);
  // deck: rails on top, girder with X bracing, columns to the ground
  f.fill(0, deck, 64, 1, '#4a4a4a');
  f.fill(0, deck + 1, 64, 1, '#2a2a2a');
  f.fill(0, deck + 4, 64, 1, '#2a2a2a');
  for (let x = -2; x < 64; x += 4) { line(f, x, deck + 2, x + 2, deck + 3, '#222222'); }
  for (const cx of [10, 31, 52]) f.fill(cx, deck + 5, 2, bot - deck - 4, '#2a2a2a');
  if (wx) wxStrip(f);
  return f;
}

// ---- 5. First train (needs the CTA GTFS schedule; spec 13 parks it) ----
function firstTrain({ mode = 'one', wx = false } = {}) {
  const f = new Frame();
  if (mode === 'one') {
    const top = wx ? 3 : 5;
    bigClock(f, T, 32, top);
    const s = 'FIRST TRAIN 4:52';
    ctext(f, 'small', s, 32, top + 18, C.noTrains);
  } else if (mode === 'rows') {
    // header like the transit screen, then schedule rows in grey (as isSch)
    f.text('small', 'MORSE', 0, 6, C.dark);
    rtext(f, 'small', T, 63, 6, C.dark);
    const rows = [['HOWARD', '4:52'], ['95TH', '4:41']];
    rows.forEach(([d, t], i) => {
      const y = [10, 18][i];
      f.fill(0, y, 3, 5, LINE.RD);
      f.text('small', d, 5, y + 5, C.label);
      rtext(f, 'small', t, 63, y + 5, C.sched);
    });
    if (!wx) ctext(f, 'small', 'FIRST TRAINS', 32, 31, C.noTrains);
  } else {
    const top = wx ? 3 : 5;
    bigClock(f, T, 32, top);
    ctext(f, 'small', 'FIRST IN 3H 40M', 32, top + 18, C.noTrains);
  }
  if (wx) wxStrip(f);
  return f;
}

// ---- 6. Line strip: the station's stretch of line, no trains on it ----
// Brown Line, Kimball .. Belmont; Western is home.
const BR = ['KIMBALL', 'KEDZIE', 'FRANCISCO', 'ROCKWELL', 'WESTERN', 'DAMEN', 'MONTROSE', 'IRVING PK', 'ADDISON', 'PAULINA', 'SOUTHPORT', 'BELMONT'];
function lineStrip({ train = null, wx = false } = {}) {
  const f = new Frame();
  bigClock(f, T, 32, wx ? 0 : 1);
  const y = wx ? 19 : 23;
  const x0 = 4, step = 5, home = 4;
  const xs = BR.map((_, i) => x0 + i * step);
  f.fill(xs[0], y, xs[xs.length - 1] - xs[0] + 1, 1, LINE.BR);
  f.fill(xs[xs.length - 1] + 1, y, 63 - xs[xs.length - 1], 1, '#45250f'); // toward the Loop, dimmer
  xs.forEach((x, i) => { if (i !== home) { px(f, x, y - 1, LINE.BR); px(f, x, y + 1, LINE.BR); } });
  f.fill(xs[home] - 1, y - 1, 3, 3, C.label);
  f.set(xs[home], y, [0, 0, 0]);
  if (train != null) {
    f.fill(xs[train] - 1, y - 1, 3, 3, '#f0f0f0');
    ctext(f, 'small', `${train - home} STOPS AWAY`, 32, y - 4, C.noTrains);
  } else {
    ctext(f, 'small', 'NO TRAINS', 32, y - 4, C.noTrains);
  }
  if (!wx) ctext(f, 'small', 'WESTERN', xs[home] + 1 + 8, y + 7, C.dark);
  if (wx) wxStrip(f);
  return f;
}

// ---- sheet ----
const ROWS = [
  ['0  TODAY (SPEC 5): 9X15 CLOCK, NO TRAINS', [
    ['NO TRAINS', current()],
    ['WEATHER STRIP', current({ wx: true })],
    ['NO DATA', current({ stale: true })],
  ]],
  ['1  SLEEPING TRAIN: PARKED CARS, ZS DRIFT UP FROM THE CAB (HEADSIGN IN LINE COLOR)', [
    ['Z 1', sleeping({ z: 0 })],
    ['Z 2', sleeping({ z: 1 })],
    ['Z 3', sleeping({ z: 2 })],
    ['WEATHER STRIP', sleeping({ wx: true })],
    ['NO DATA', sleeping({ stale: true })],
  ]],
  ['2  OWL SERVICE: AN OWL ON THE GIRDER, BLINKS AND LOOKS AROUND', [
    ['AWAKE', owl()],
    ['BLINK', owl({ eyes: 'blink' })],
    ['LOOKS', owl({ eyes: 'look' })],
    ['WEATHER STRIP', owl({ wx: true })],
    ['NO DATA (DIM EYES)', owl({ stale: true })],
  ]],
  ['3  SIGNAL: TRACK TO THE HORIZON, SIGNAL AT STOP; NO DATA FLASHES YELLOW', [
    ['STOP', signal()],
    ['NO DATA ON', signal({ aspect: 'flash' })],
    ['NO DATA OFF', signal({ aspect: 'dark' })],
    ['WEATHER STRIP', signal({ wx: true })],
  ]],
  ['4  THE L AT NIGHT: EMPTY STRUCTURE, MOON, STARS TWINKLE', [
    ['TWINKLE 1', nightL()],
    ['TWINKLE 2', nightL({ tw: 1 })],
    ['WEATHER STRIP', nightL({ wx: true })],
  ]],
  ['5  FIRST TRAIN: SCHEDULED START (NEEDS CTA GTFS); GREY = SCHEDULE, AS ISSCH', [
    ['ONE LINE', firstTrain()],
    ['COUNTDOWN', firstTrain({ mode: 'count' })],
    ['ROWS', firstTrain({ mode: 'rows' })],
    ['ROWS + WEATHER', firstTrain({ mode: 'rows', wx: true })],
  ]],
  ['6  LINE STRIP: YOUR STRETCH OF LINE, EMPTY; NEAREST TRAIN IF ONE IS OUT THERE', [
    ['EMPTY', lineStrip()],
    ['NEAREST TRAIN', lineStrip({ train: 9 })],
    ['WEATHER STRIP', lineStrip({ wx: true })],
  ]],
];

const q5 = (v) => v & 0xf8;
fs.mkdirSync(OUT, { recursive: true });
const PW = 64, PH = 32, GAP = 4, TH = 8, RT = 9, COLS = Math.max(...ROWS.map(([, ps]) => ps.length));
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, ROWS.length * (RT + TH + PH + GAP) + GAP);
let oy = GAP;
for (const [title, panels] of ROWS) {
  sheet.text('small', title, GAP, oy + 5, '#808080');
  oy += RT;
  panels.forEach(([label, f], j) => {
    const ox = GAP + j * (PW + GAP);
    sheet.text('small', label, ox, oy + 5, '#5a5a5a');
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y).map(q5));
  });
  oy += TH + PH + GAP;
}
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(5));
console.log(`wrote ${path.relative(process.cwd(), path.join(OUT, 'sheet.png'))}`);
