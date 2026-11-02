#!/usr/bin/env node
'use strict';
// Mockups: more things passing on the skyline face's water and in its sky
// (design spec §14). Each is drawn over the real skyline (draw.js) at a few
// moments of its crossing, in the weather and light it would show in.
// Nothing here is in draw.js yet.
//   node scripts/mock-skyline-visitors.js
// Writes docs/board/mockups/skyline-visitors/<id>.png and sheet.png.

const fs = require('fs');
const path = require('path');
const { render, SKY } = require('../server/board/render');
const { Frame } = require('../server/board/raster');
const { toSkyline } = require('../server/board/skyline');
const { stripBytes } = require('../server/board/clouds');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'skyline-visitors');
const PLACE = { lat: 41.8917, lon: -87.590 };
const at = (iso) => Date.parse(iso) / 1000;
const DAY = at('2026-07-15T18:30:00Z'), DUSK = at('2026-07-16T01:40:00Z'), NIGHT = at('2026-07-16T03:20:00Z'), FALL = at('2026-10-21T17:10:00Z');
const S = SKY.SHORE;  // row 25: the shore and the pier deck; water below

function scene(now, w = { code: 0, clouds: 5 }) {
  const skyline = toSkyline({ temp: 78, ...w }, { ...PLACE, now, temp: 78, boats: false });
  const clouds = skyline.cl ? { [skyline.cl.id]: stripBytes(skyline.cl.id) } : undefined;
  const p = { now, tzo: -18000, screen: 'clock', cface: 'skyline', bright: 100, warn: null, skyline };
  return (ms) => render(p, { screen: 'clock', ms: now * 1000 + ms, clouds });
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
// Paint a sprite (rows of palette letters, '.' clear) with its left edge at x;
// dir -1 heads left (as drawn), 1 is mirrored. `sky`: hidden behind buildings.
function sprite(f, rows, pal, x, y, dir = -1, { sky = false, alpha = 1 } = {}) {
  const w = rows[0].length;
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.' || !pal[ch]) return;
    const X = dir < 0 ? x + i : x + w - 1 - i, Y = y + j;
    if (X < 0 || X > 63 || Y < 0 || Y > 31 || (sky && SKY.isB(X, Y))) return;
    f.set(X, Y, alpha >= 1 ? hex(pal[ch]) : mix(f.get(X, Y), hex(pal[ch]), alpha));
  }));
}
function dot(f, x, y, c, k = 1, sky = true) {
  if (x < 0 || x > 63 || y < 0 || y > 31 || (sky && SKY.isB(x, y))) return;
  f.set(x, y, mix(f.get(x, y), hex(c), k));
}

// ---- water ----
const FREIGHTER = {
  rows: ['.m......................m.', '.WW...................WWW.', '.WWw..................WwWW', 'RRRRRRRRRRRRRRRRRRRRRRRRRR', 'rRRRRRRRRRRRRRRRRRRRRRRRRr', '.KKKKKKKKKKKKKKKKKKKKKKKK.'],
  day: { m: '#9aa0a8', W: '#eef0f2', w: '#5a7aa0', R: '#c03a2c', r: '#c03a2c', K: '#6a1c16' },
  night: { m: '#ffffff', W: '#ffb050', w: '#ffd890', R: '#3a1c18', r: '#ff2020', K: '#200c0a' },
};
const TOUR = {
  rows: ['...BBBBBBBBB.', '..WgWgWgWgWg.', '.WWWWWWWWWWWW', 'WWWWWWWWWWWWW', '.NNNNNNNNNNN.'],
  pal: { B: '#3a6a9a', W: '#eef0f2', g: '#4a7aa8', N: '#22325a' },
};
const DINNER = {
  rows: ['....L.L.L.L.L.L.L...', '..dAdAdAdAdAdAdAdd..', '.dAdAdAdAdAdAdAdAdd.', 'DDDDDDDDDDDDDDDDDDDD', '.DDDDDDDDDDDDDDDDDD.'],
  pal: { L: '#fff0c8', A: '#ffb050', d: '#2a2a36', D: '#16161e' },
};
const TALL = {
  rows: ['...|.....|.....|....', '..ccc...ccc...ccc...', '..ccc...ccc...ccc...', '...|.....|.....|....', '.ccccc.ccccc.ccccc..', '.ccccc.ccccc.ccccc.c', '...|.....|.....|.cc.', 'HHHHHHHHHHHHHHHHHHH.', '.hhhhhhhhhhhhhhhhh..'],
  pal: { c: '#efe6cc', '|': '#5a4030', H: '#6a4426', h: '#3a2414' },
};

// ---- sky ----
const GULL = [['#.#', '.#.'], ['...', '###']];  // wings up, wings flat
const HELI = { rows: ['rrrrrrrr...', '....#......', '.ggggg.....', 'gw######ttt', '.#####...t.', '.#...#.....', '#######....'], pal: { r: '#c0c4cc', '#': '#d03030', t: '#d03030', g: '#9ac0e0', w: '#ffffff' } };

const VIS = [
  {
    id: 'freighter', title: 'Lake freighter', note: 'Long and slow (1 px every 1.5 s, about 2 min across), riding the shoreline like the sailboat. Spring to fall; by night, lit portholes and a red bow light.',
    frames: [[DAY, 0, (f) => sprite(f, FREIGHTER.rows, FREIGHTER.day, 30, S - 4)], [FALL, 0, (f) => sprite(f, FREIGHTER.rows, FREIGHTER.day, 8, S - 4)],
      [NIGHT, 0, (f) => sprite(f, FREIGHTER.rows, FREIGHTER.night, 20, S - 4)]],
  },
  {
    id: 'tour', title: 'Tour boat', note: 'A two-deck architecture cruiser, 1 px every 500 ms. Warm-season days.',
    frames: [[DAY, 0, (f) => sprite(f, TOUR.rows, TOUR.pal, 44, S - 2)], [DAY, 0, (f) => sprite(f, TOUR.rows, TOUR.pal, 18, S - 2, 1)], [DUSK, 0, (f) => sprite(f, TOUR.rows, TOUR.pal, 2, S - 2)]],
  },
  {
    id: 'dinner', title: 'Dinner cruise', note: 'A long boat lit with two rows of windows and deck lights. Summer evenings, after dark.',
    frames: [[DUSK, 0, (f) => sprite(f, DINNER.rows, DINNER.pal, 40, S - 2)], [NIGHT, 0, (f) => sprite(f, DINNER.rows, DINNER.pal, 22, S - 2)], [NIGHT, 0, (f) => sprite(f, DINNER.rows, DINNER.pal, 2, S - 2, 1)]],
  },
  {
    id: 'tall-ship', title: 'Tall ship', note: 'A three-masted schooner under square sails, slower than the sailboat (1 px a second). Summer days.',
    frames: [[DAY, 0, (f) => sprite(f, TALL.rows, TALL.pal, 42, S - 7)], [DAY, 0, (f) => sprite(f, TALL.rows, TALL.pal, 22, S - 7)], [DUSK, 0, (f) => sprite(f, TALL.rows, TALL.pal, 4, S - 7)]],
  },
  {
    id: 'plane', title: 'Planes', note: 'A jet crossing high: a fading contrail by day; at night a white strobe with a red light blinking. A few an hour; not under heavy cloud.',
    frames: [[DAY, 0, (f) => { for (let i = 0; i < 22; i++) dot(f, 38 + i, 3 + (i >> 3), '#ffffff', 0.7 * (1 - i / 22)); dot(f, 37, 3, '#d8dce4'); dot(f, 36, 3, '#d8dce4'); }],
      [FALL, 0, (f) => { for (let i = 0; i < 22; i++) dot(f, 14 + i, 6 - (i >> 3), '#ffffff', 0.6 * (1 - i / 22)); dot(f, 13, 6, '#d8dce4'); dot(f, 12, 6, '#d8dce4'); }],
      [NIGHT, 0, (f) => { dot(f, 30, 4, '#ffffff'); dot(f, 31, 4, '#ff2020'); dot(f, 29, 4, '#606878'); }]],
  },
  {
    id: 'gulls', title: 'Gulls', note: 'Three gulls drifting over the water, each flapping on its own beat. Daytime.',
    frames: [[DAY, 0, (f) => { sprite(f, GULL[0], { '#': '#e8ecf0' }, 34, 14, -1, { sky: true }); sprite(f, GULL[1], { '#': '#e8ecf0' }, 40, 12, -1, { sky: true }); sprite(f, GULL[0], { '#': '#e8ecf0' }, 46, 16, -1, { sky: true }); }],
      [DAY, 0, (f) => { sprite(f, GULL[1], { '#': '#e8ecf0' }, 24, 15, -1, { sky: true }); sprite(f, GULL[0], { '#': '#e8ecf0' }, 30, 12, -1, { sky: true }); sprite(f, GULL[1], { '#': '#e8ecf0' }, 36, 17, -1, { sky: true }); }],
      [FALL, 0, (f) => { sprite(f, GULL[0], { '#': '#c8ccd2' }, 8, 13, -1, { sky: true }); sprite(f, GULL[0], { '#': '#c8ccd2' }, 14, 11, -1, { sky: true }); }]],
  },
  {
    id: 'helicopter', title: 'Helicopter', note: 'A news or tour chopper crossing the skyline slowly, its rotor flickering, a red beacon blinking at night.',
    frames: [[DAY, 0, (f) => sprite(f, HELI.rows, HELI.pal, 40, 7, -1, { sky: true })], [FALL, 0, (f) => sprite(f, HELI.rows, HELI.pal, 32, 4, -1, { sky: true })],
      [NIGHT, 0, (f) => { sprite(f, HELI.rows, { r: '#3a3e48', '#': '#3a1414', t: '#3a1414', g: '#2a3a4a', w: '#ffffff' }, 26, 8, -1, { sky: true }); dot(f, 30, 9, '#ff2020'); }]],
  },
  {
    id: 'fireworks', title: 'Navy Pier fireworks', note: 'Bursts over the pier on summer Wednesday and Saturday nights (about 9:30 and 10:15 PM, Memorial Day to Labor Day): a rising trail, a ring of sparks that spreads and fades, several colors over ten minutes.',
    frames: [[NIGHT, 0, (f) => { for (let i = 0; i < 6; i++) dot(f, 33, 22 - i, '#ffe0a0', 1 - i / 6); burst(f, 26, 7, 4, '#ff4060', 1); }],
      [NIGHT, 0, (f) => { burst(f, 26, 7, 6, '#ff4060', 0.55); burst(f, 38, 5, 4, '#60c0ff', 1); }],
      [NIGHT, 0, (f) => { burst(f, 38, 5, 6, '#60c0ff', 0.4); burst(f, 31, 9, 5, '#ffd040', 1); burst(f, 22, 4, 3, '#a060ff', 0.9); }]],
  },
];
function burst(f, cx, cy, r, c, k) {
  for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 2;
    for (const [rr, kk] of [[r, 1], [r - 1, 0.5]]) dot(f, Math.round(cx + rr * Math.cos(t)), Math.round(cy + rr * Math.sin(t)), c, k * kk);
  }
}

fs.mkdirSync(OUT, { recursive: true });
const PW = 64, PH = 32, GAP = 4, TH = 8, COLS = 3;
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, VIS.length * (PH + TH + GAP) + GAP);
VIS.forEach((v, row) => {
  const oy = GAP + row * (PH + TH + GAP);
  sheet.text('small', v.title.toUpperCase(), GAP, oy + 5, '#606060');
  v.frames.forEach(([now, ms, draw], col) => {
    const f = scene(now)(ms);
    draw(f);
    if (col === 0) fs.writeFileSync(path.join(OUT, `${v.id}.png`), f.toPNG(10));
    const ox = GAP + col * (PW + GAP);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y));
  });
});
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(5));
fs.writeFileSync(path.join(OUT, 'notes.json'), JSON.stringify(VIS.map((v) => ({ id: v.id, title: v.title, note: v.note })), null, 2) + '\n');
console.log(`wrote ${VIS.length} visitors to ${path.relative(process.cwd(), OUT)}`);
