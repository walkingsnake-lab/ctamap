#!/usr/bin/env node
'use strict';
// NYC subway arrivals mockups for the 64x32 panel: layouts close to the CTA
// screens and a few that aren't. Not in draw.js. Made-up times.
//   node scripts/mock-mta.js   -> docs/board/mockups/mta/sheet.png (+ one PNG per mock)

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { packFonts } = require('../server/board/fonts');
const G = require('../server/board/glyphs');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'mta');
const F = packFonts();

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const scale = (c, k) => toHex(hex(c).map((v) => v * k));

// MTA route colors. Yellow takes dark text (MTA standard).
const ROUTE = {
  1: '#ee352e', 2: '#ee352e', 3: '#ee352e',
  4: '#00933c', 5: '#00933c', 6: '#00933c',
  7: '#b933ad',
  A: '#0039a6', C: '#0039a6', E: '#0039a6',
  B: '#ff6319', D: '#ff6319', F: '#ff6319', M: '#ff6319',
  G: '#6cbe45', J: '#996633', Z: '#996633', L: '#a7a9ac',
  N: '#fccc0a', Q: '#fccc0a', R: '#fccc0a', W: '#fccc0a',
  S: '#808183',
};
// 0039a6 (ACE blue) is too dark on the panel; boost like Brown/Purple on CTA.
const PANEL = { ...ROUTE, A: '#1f5fe0', C: '#1f5fe0', E: '#1f5fe0', J: '#b07a40', Z: '#b07a40' };
const DARK_TEXT = new Set(['N', 'Q', 'R', 'W']);
const C = { label: '#d8d8d8', white: '#f0f0f0', amber: '#ffb000', dim: '#664600', grey: '#808080', dark: '#555555', rule: '#333333', red: '#ff2a1a' };

function measure(font, s) {
  let w = 0;
  for (const ch of s) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; }
  return w > 0 ? w - 1 : 0;
}
const rtext = (f, font, s, x1, base, col) => f.text(font, s, x1 - measure(font, s) + 1, base, col);
const ctext = (f, font, s, cx, base, col) => f.text(font, s, Math.round(cx - (measure(font, s) - 1) / 2), base, col);

// ---- bullets ----
const DISC = {
  5: ['.XXX.', 'XXXXX', 'XXXXX', 'XXXXX', '.XXX.'],
  7: ['..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'],
  9: ['...XXX...', '.XXXXXXX.', '.XXXXXXX.', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '.XXXXXXX.', '...XXX...'],
  13: ['....XXXXX....', '..XXXXXXXXX..', '.XXXXXXXXXXX.', '.XXXXXXXXXXX.', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX',
    'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', '.XXXXXXXXXXX.', '.XXXXXXXXXXX.', '..XXXXXXXXX..', '....XXXXX....'],
};
const DIAMOND7 = ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const RING7 = ['..XXX..', '.X...X.', 'X.....X', 'X.....X', 'X.....X', '.X...X.', '..XXX..'];

function shape(f, rows, x, y, col) {
  const rgb = hex(col);
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === 'X') f.set(x + i, y + j, rgb); }));
}
function erase(f, font, s, x, base) { // knock a glyph out of a fill (unlit pixels)
  const t = new Frame(40, 16);
  t.text(font, s, 0, 12, '#ffffff');
  for (let j = 0; j < 16; j++) for (let i = 0; i < 40; i++) if (t.get(i, j)[0]) f.set(x + i, base - 12 + j, [0, 0, 0]);
}

// style: 'disc' (filled, white glyph), 'ring' (outline in route color, white glyph), 'mono' (one color ring)
function bullet(f, rt, x, y, { size = 7, express = false, style = 'disc', mono = null } = {}) {
  const col = mono || PANEL[rt];
  const font = size >= 9 ? '5x7' : 'small';
  const gw = measure(font, String(rt));
  const gx = x + Math.floor((size - gw) / 2);
  const base = size === 13 ? y + 10 : size === 9 ? y + 8 : y + 6;
  if (express) {
    shape(f, DIAMOND7, x, y, col);
    f.text(font, String(rt), gx, base, C.white);
    return;
  }
  if (style === 'ring' || mono) {
    shape(f, RING7, x, y, col);
    f.text(font, String(rt), gx, base, mono || C.white);
    return;
  }
  shape(f, DISC[size], x, y, col);
  if (DARK_TEXT.has(String(rt))) erase(f, font, String(rt), gx, base);
  else f.text(font, String(rt), gx, base, C.white);
}

const timesRow = (f, times, x1, base, { gap = 3, font = 'small' } = {}) => {
  let x = x1;
  [...times].reverse().forEach((t, iRev) => {
    const i = times.length - 1 - iRev;
    const col = i === 0 ? C.amber : C.dim;
    const w = measure(font, t);
    f.text(font, t, x - w + 1, base, col);
    x -= w + gap;
  });
};

function header(f, name, clock = '9:41', col = C.dark) {
  f.text('small', name, 0, 6, col);
  rtext(f, 'small', clock, 63, 6, col);
}

// ---- A. Rows: the CTA transit screen with bullets ----
function rows({ hdr = true, style = 'disc' } = {}) {
  const f = new Frame();
  const data = [
    ['4', false, 'WOODLAWN', ['2', '9', '16']],
    ['5', false, 'DYRE AV', ['5', '14']],
    ['6', false, 'PELHAM', ['DUE', '8', '15']],
    ['6', true, 'PELHAM', ['11', '23']],
  ];
  let tops = [0, 8, 16, 24];
  if (hdr) { header(f, 'GRAND CTRL'); tops = [9, 17, 25]; }
  tops.forEach((y, i) => {
    const [rt, ex, name, times] = data[i];
    bullet(f, rt, 0, y, { express: ex, style });
    const nameEnd = f.text('small', name, 9, y + 6, C.label);
    let t = times;
    const width = (ts) => ts.reduce((w, s) => w + measure('small', s), 0) + 3 * (ts.length - 1);
    while (t.length > 1 && 63 - width(t) < nameEnd + 2) t = t.slice(0, -1);
    timesRow(f, t, 63, y + 6);
  });
  return f;
}

// ---- B. Chronological: one train per row ----
function chrono() {
  const f = new Frame();
  header(f, 'TIMES SQ');
  const data = [['1', 'S FERRY', 'DUE'], ['2', 'FLATBUSH', '3m'], ['3', 'NEW LOTS', '6m'], ['1', 'S FERRY', '9m']];
  // 6px pitch, 5px dots: four rows under the header
  [9, 15, 21, 27].forEach((y, i) => {
    const [rt, name, t] = data[i];
    shape(f, DISC[5], 0, y, PANEL[rt]);
    f.text('small', rt, 7, y + 5, PANEL[rt]);
    f.text('small', name, 12, y + 5, C.label);
    rtext(f, 'small', t, 63, y + 5, i === 0 ? C.amber : C.dim);
  });
  return f;
}

// ---- C. Countdown-clock LCD: two big rows, black background ----
function lcd(page = 0) {
  const f = new Frame();
  f.text('small', 'UPTOWN', 0, 6, C.dark);
  rtext(f, 'small', '9:41', 63, 6, C.dark);
  const all = [['N', 'Astoria', '2'], ['Q', '96 St', '4'], ['R', '71 Av', '7'], ['W', 'Astoria', '9']];
  const pair = all.slice(page * 2, page * 2 + 2);
  pair.forEach(([rt, dest, m], i) => {
    const y = 8 + i * 12;
    bullet(f, rt, 0, y + 1, { size: 9 });
    f.text('5x7', dest, 11, y + 9, C.white);
    const mw = measure('5x7', String.fromCodePoint(G.MIN));
    f.text('5x7', String.fromCodePoint(G.MIN), 63 - mw + 1, y + 9, C.white);
    rtext(f, '5x7', m, 63 - mw - 2, y + 9, C.white);
    if (i === 0) f.fill(0, y + 11, 64, 1, '#1a1a1a');
  });
  return f;
}

// ---- D. Red LED countdown clock (the 2011-era IRT signs) ----
function redLed() {
  const f = new Frame();
  const R = C.red;
  const data = [['1', '242 St', '3'], ['2', '241 St', '7'], ['3', '148 St', '12']];
  [1, 12, 23].forEach((y, i) => {
    const [rt, dest, m] = data[i];
    bullet(f, rt, 0, y, { mono: R });
    f.text('5x7', dest, 10, y + 7, R);
    const mw = measure('5x7', String.fromCodePoint(G.MIN));
    f.text('5x7', String.fromCodePoint(G.MIN), 64 - mw, y + 7, scale(R, 0.6));
    rtext(f, '5x7', m, 63 - mw - 2, y + 7, R);
  });
  return f;
}

// ---- E. Uptown | Downtown split ----
function split() {
  const f = new Frame();
  f.fill(32, 0, 1, 32, C.rule);
  const up = String.fromCodePoint(G.UP), dn = String.fromCodePoint(G.DOWN);
  f.text('small', up, 0, 6, C.grey); f.text('small', 'BRONX', 7, 6, C.grey);
  f.text('small', dn, 34, 6, C.grey); f.text('small', 'BKLYN', 41, 6, C.grey);
  const U = [['1', ['3', '9']], ['2', ['5', '12']], ['3', ['DUE', '8']]];
  const D = [['1', ['2', '10']], ['2', ['6', '13']], ['3', ['4', '15']]];
  [9, 17, 25].forEach((y, i) => {
    bullet(f, U[i][0], 0, y);
    timesRow(f, U[i][1], 30, y + 6, { gap: 2 });
    bullet(f, D[i][0], 34, y);
    timesRow(f, D[i][1], 63, y + 6, { gap: 2 });
  });
  return f;
}

// ---- F. Hero: the next train big, the rest small ----
function hero() {
  const f = new Frame();
  bullet(f, 'N', 0, 2, { size: 13 });
  f.text('5x7', 'Astoria', 15, 9, C.white);
  f.text('small', 'DITMARS BL', 15, 15, C.grey);
  rtext(f, 'clock', '3', 63, 11, C.amber);
  rtext(f, 'small', 'MIN', 63, 17, C.amber);
  f.fill(0, 19, 64, 1, C.rule);
  const next = [['W', '6'], ['N', '11'], ['W', '15']];
  next.forEach(([rt, m], i) => {
    const x = i * 22;
    bullet(f, rt, x, 23);
    f.text('small', m, x + 9, 29, C.dim);
  });
  return f;
}

// ---- G. Approach track: trains as dots on the line, you at the right ----
function track() {
  const f = new Frame();
  header(f, 'HUNTERS PT', '9:41');
  // 7 line, Manhattan-bound, flowing left -> right toward the station at x 60
  const T = 20;
  f.fill(0, T, 60, 1, '#3a3a3a');
  [4, 16, 28, 40, 52].forEach((x) => f.fill(x, T + 1, 1, 2, '#3a3a3a'));
  f.fill(60, T - 3, 1, 7, C.label); f.fill(61, T - 3, 2, 1, C.label); f.fill(61, T + 3, 2, 1, C.label);
  const trains = [[50, '2', false], [33, '6', true], [10, '13', false]];
  trains.forEach(([x, m, ex]) => {
    if (ex) shape(f, ['..X..', '.XXX.', 'XXXXX', '.XXX.', '..X..'], x - 2, T - 2, PANEL['7']);
    else shape(f, DISC[5], x - 2, T - 2, PANEL['7']);
    ctext(f, 'small', m, x, T - 5, m === '2' ? C.amber : C.dim);
  });
  f.text('small', 'TO MANHATTAN', 0, 31, C.dark);
  return f;
}

// ---- H. Service status: every line, alerts lit ----
function status() {
  const f = new Frame();
  const lines = ['1', '2', '3', '4', '5', '6', '7', 'A', 'C', 'E', 'B', 'D', 'F', 'M', 'G', 'J', 'Z', 'L', 'N', 'Q', 'R', 'W', 'S'];
  const bad = { F: 'delay', R: 'delay', '7': 'part', G: 'part' };
  lines.forEach((rt, i) => {
    const x = (i % 8) * 8, y = Math.floor(i / 8) * 9 + 1;
    if (bad[rt]) {
      bullet(f, rt, x, y);
      f.fill(x + 3, y + 8, 2, 1, bad[rt] === 'delay' ? C.red : C.amber);
    } else {
      shape(f, DISC[7], x, y, scale(PANEL[rt], 0.18));
      f.text('small', rt, x + Math.floor((7 - measure('small', rt)) / 2), y + 6, scale(PANEL[rt], 0.55));
    }
  });
  return f;
}

// ---- bullet test strip ----
function bullets() {
  const f = new Frame();
  ['1', '4', '7', 'A', 'B', 'G', 'J', 'L'].forEach((rt, i) => bullet(f, rt, i * 8, 1));
  ['1', '4', '7', 'A', 'B', 'G', 'J', 'L'].forEach((rt, i) => bullet(f, rt, i * 8, 9, { style: 'ring' }));
  ['N', 'Q', 'R', 'W'].forEach((rt, i) => bullet(f, rt, i * 8, 17));
  ['N', 'Q', 'R', 'W'].forEach((rt, i) => bullet(f, rt, 32 + i * 8, 17, { style: 'ring' }));
  ['6', '7', 'F'].forEach((rt, i) => bullet(f, rt, i * 8, 25, { express: true }));
  bullet(f, 'S', 32, 25);
  bullet(f, 'Z', 40, 25);
  return f;
}

const MOCKS = [
  ['similar', 'rows', 'ROWS, HEADER', rows()],
  ['similar', 'rows-noheader', 'NO HEADER', rows({ hdr: false })],
  ['similar', 'rows-ring', 'RING BULLETS', rows({ hdr: false, style: 'ring' })],
  ['similar', 'chrono', 'ONE PER ROW', chrono()],
  ['similar', 'lcd-1', 'LCD PAGE 1', lcd(0)],
  ['similar', 'lcd-2', 'PAGE 2', lcd(1)],
  ['different', 'red-led', 'RED LED', redLed()],
  ['different', 'split', 'SPLIT', split()],
  ['different', 'hero', 'HERO', hero()],
  ['different', 'track', 'TRACK', track()],
  ['different', 'status', 'STATUS', status()],
  ['different', 'bullets', 'BULLET TEST', bullets()],
];

const q5 = (v) => v & 0xf8;
fs.mkdirSync(OUT, { recursive: true });
for (const [, id, , fr] of MOCKS) {
  const q = new Frame();
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) q.set(x, y, fr.get(x, y).map(q5));
  fs.writeFileSync(path.join(OUT, `${id}.png`), q.toPNG(10));
}
const PW = 64, PH = 32, GAP = 4, TH = 8, COLS = 6;
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, 2 * (TH + PH + GAP) + GAP);
MOCKS.forEach(([, , label, fr], i) => {
  const ox = GAP + (i % COLS) * (PW + GAP), oy = GAP + Math.floor(i / COLS) * (TH + PH + GAP);
  sheet.text('small', label, ox, oy + 5, '#5a5a5a');
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, fr.get(x, y).map(q5));
});
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(5));
console.log(`wrote ${path.relative(process.cwd(), OUT)}/`);
