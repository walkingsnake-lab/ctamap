#!/usr/bin/env node
'use strict';
// NYC subway on a 128x32 panel (two 64x32 chained): the uptown | downtown
// split with room for terminal names, plus variants and one CTA screen for
// comparison. Not in draw.js. Made-up times.
//   node scripts/mock-mta-128.js   -> docs/board/mockups/mta/w128-*.png

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { packFonts } = require('../server/board/fonts');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'mta');
const F = packFonts();
const W = 128, H = 32;
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

const ROUTE = {
  1: '#ee352e', 2: '#ee352e', 3: '#ee352e', 4: '#00933c', 5: '#00933c', 6: '#00933c', 7: '#b933ad',
  A: '#1f5fe0', C: '#1f5fe0', E: '#1f5fe0', B: '#ff6319', D: '#ff6319', F: '#ff6319', M: '#ff6319',
  G: '#6cbe45', J: '#b07a40', Z: '#b07a40', L: '#a7a9ac', N: '#fccc0a', Q: '#fccc0a', R: '#fccc0a', W: '#fccc0a', S: '#808183',
};
const RINGED = new Set(['N', 'Q', 'R', 'W', 'L']); // light fills: ring + white letter (round 2)
const CTA = { RD: '#c60c30', BR: '#62361b', PR: '#522398' };
const C = { label: '#d8d8d8', white: '#f0f0f0', amber: '#ffb000', dim: '#664600', grey: '#808080', dark: '#555555', pip: '#3a3a3a' };

const measure = (font, s) => { let w = 0; for (const ch of s) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; } return w > 0 ? w - 1 : 0; };
const rtext = (f, font, s, x1, base, col) => f.text(font, s, x1 - measure(font, s) + 1, base, col);

// ---- bullets: discs of any odd size, ringed for light fills ----
const inDisc = (n, i, j) => { const r = n / 2, dx = i + 0.5 - r, dy = j + 0.5 - r; return dx * dx + dy * dy <= r * r + (n <= 7 ? 1.2 : 0.6); };
const DISC7 = ['..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'];
const RING7 = ['..XXX..', '.X...X.', 'X.....X', 'X.....X', 'X.....X', '.X...X.', '..XXX..'];
function disc(f, n, x, y, col, ring) {
  const rgb = hex(col);
  if (n === 7) return (ring ? RING7 : DISC7).forEach((r, j) => [...r].forEach((ch, i) => { if (ch === 'X') f.set(x + i, y + j, rgb); }));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!inDisc(n, i, j)) continue;
    const edge = !inDisc(n, i - 1, j) || !inDisc(n, i + 1, j) || !inDisc(n, i, j - 1) || !inDisc(n, i, j + 1) || i === 0 || j === 0 || i === n - 1 || j === n - 1;
    if (!ring || edge) f.set(x + i, y + j, rgb);
  }
}
const DIAMOND = ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
function bullet(f, rt, x, y, { size = 7, express = false } = {}) {
  const col = ROUTE[rt];
  if (express) DIAMOND.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === 'X') f.set(x + i, y + j, hex(col)); }));
  else disc(f, size, x, y, col, RINGED.has(rt));
  const font = size >= 9 ? '5x7' : 'small';
  const gw = measure(font, rt);
  const base = size === 7 ? y + 6 : size === 9 ? y + 8 : y + 10;
  f.text(font, rt, x + Math.floor((size - gw) / 2), base, C.white);
}

// Times right-aligned at x1; later ones drop when they'd come within 3px of `end`.
function times(f, ts, x1, base, end, { font = 'small', gap = 3 } = {}) {
  let keep = ts.slice();
  const width = (a) => a.reduce((w, t) => w + measure(font, t), 0) + gap * (a.length - 1);
  while (keep.length > 1 && x1 - width(keep) + 1 < end + 3) keep = keep.slice(0, -1);
  let x = x1;
  for (let i = keep.length - 1; i >= 0; i--) {
    const w = measure(font, keep[i]);
    f.text(font, keep[i], x - w + 1, base, i === 0 ? C.amber : C.dim);
    x -= w + gap;
  }
}
function pips(f, x1, y, page, pages) {
  if (pages > 1) for (let i = 0; i < pages; i++) f.set(x1 - (pages - 1 - i) * 2, y, hex(i === page ? C.label : C.pip));
}

const HALVES = [[0, 61], [65, 127]]; // 3px gutter; the right half gets 63px for DOWNTOWN & BKLYN

// ---- A. names: label row + 3 rows of bullet, name, times ----
function names(sides, { page = 0, rowsPer = 3, labels = true } = {}) {
  const f = new Frame(W, H);
  const tops = labels ? [9, 17, 25] : [0, 8, 16, 24];
  sides.forEach(({ label, rows }, s) => {
    const [x0, x1] = HALVES[s];
    const pages = Math.ceil(rows.length / tops.length);
    if (labels) { f.text('small', label, x0, 6, C.grey); pips(f, x1, 7, page, pages); }
    rows.slice(page * tops.length, (page + 1) * tops.length).forEach((r, i) => {
      const y = tops[i];
      bullet(f, r.rt, x0, y, { express: r.ex });
      const end = f.text('small', r.to, x0 + 9, y + 6, C.label) - 1;
      times(f, r.t, x1, y + 6, end);
    });
  });
  return f;
}

// ---- C. route grid: no names, 2 columns per half, 6 routes per half ----
function grid(sides) {
  const f = new Frame(W, H);
  sides.forEach(({ label, rows }, s) => {
    const [x0] = HALVES[s];
    f.text('small', label, x0, 6, C.grey);
    rows.forEach((r, i) => {
      const cx = x0 + (i >= 3 ? 33 : 0), y = [9, 17, 25][i % 3];
      bullet(f, r.rt, cx, y);
      times(f, r.t.slice(0, 2), cx + 28, y + 6, cx + 6, { gap: 2 });
    });
  });
  return f;
}

// ---- E. big rows: label + 2 rows of 9px bullet, 5x7 name, 5x7 minutes ----
function big(sides) {
  const f = new Frame(W, H);
  sides.forEach(({ label, rows }, s) => {
    const [x0, x1] = HALVES[s];
    f.text('small', label, x0, 6, C.grey);
    rows.slice(0, 2).forEach((r, i) => {
      const top = 9 + i * 12;
      bullet(f, r.rt, x0, top, { size: 9 });
      f.text('5x7', r.to, x0 + 12, top + 8, C.white);
      rtext(f, '5x7', r.t, x1, top + 8, C.amber);
    });
  });
  return f;
}

// ---- F. next train big, one route, both directions ----
function hero(rt, sides) {
  const f = new Frame(W, H);
  sides.forEach(({ label, t }, s) => {
    const [x0, x1] = HALVES[s];
    f.text('small', label, x0, 6, C.grey);
    bullet(f, rt, x0, 10, { size: 13 });
    const end = f.text('clock', t[0], x0 + 17, 23, C.amber);
    f.text('small', 'MIN', end + 1, 23, C.amber);
    f.text('small', 'THEN', x0 + 17, 31, C.dark);
    f.text('small', t.slice(1).join('  '), x0 + 17 + measure('small', 'THEN') + 4, 31, C.dim);
  });
  return f;
}

// ---- G. CTA rows on 128: the same split with the CTA's 3px blocks ----
function cta(sides) {
  const f = new Frame(W, H);
  sides.forEach(({ label, rows }, s) => {
    const [x0, x1] = HALVES[s];
    f.text('small', label, x0, 6, C.grey);
    rows.forEach((r, i) => {
      const top = [9, 17, 25][i] + 1;
      f.fill(x0, top, 3, 5, r.ln);
      const end = f.text('small', r.to, x0 + 5, top + 5, C.label) - 1;
      times(f, r.t, x1, top + 5, end);
    });
  });
  return f;
}

// ---- stations ----
const TSQ_UP = [
  { rt: '1', to: '242 ST', t: ['3', '9', '15'] }, { rt: '2', to: '241 ST', t: ['5', '12'] }, { rt: '3', to: '148 ST', t: ['DUE', '8', '19'] },
  { rt: 'N', to: 'ASTORIA', t: ['4', '13'] }, { rt: 'Q', to: '96 ST', t: ['7', '15'] }, { rt: 'R', to: '71 AV', t: ['2', '11'] },
];
const TSQ_DN = [
  { rt: '1', to: 'S FERRY', t: ['2', '10', '18'] }, { rt: '2', to: 'FLATBUSH', t: ['6', '13'] }, { rt: '3', to: 'NEW LOTS', t: ['4', '15'] },
  { rt: 'N', to: 'CONEY IS', t: ['8', '17'] }, { rt: 'Q', to: 'CONEY IS', t: ['3', '12'] }, { rt: 'R', to: 'BAY RDGE', t: ['5', '14'] },
];
const SIDES_TSQ = [{ label: 'UPTOWN & BRONX', rows: TSQ_UP }, { label: 'DOWNTOWN & BKLYN', rows: TSQ_DN }];
const GC = [
  { label: '', rows: [
    { rt: '4', to: 'WOODLAWN', t: ['2', '9'] }, { rt: '5', to: 'DYRE AV', t: ['5', '14'] },
    { rt: '6', to: 'PELHAM', t: ['DUE', '8', '15'] }, { rt: '6', ex: true, to: 'PELHAM', t: ['4', '16'] }] },
  { label: '', rows: [
    { rt: '4', to: 'UTICA', t: ['3', '18'] }, { rt: '4', to: 'NEW LOTS', t: ['11'] },
    { rt: '5', to: 'FLATBUSH', t: ['7', '15'] }, { rt: '6', to: 'BKLYN BR', t: ['DUE', '6', '12'] }] },
];
const JAY = [
  { label: 'TO MANHATTAN', rows: [
    { rt: 'A', to: '207 ST', t: ['2', '10'] }, { rt: 'C', to: '168 ST', t: ['7', '16'] }, { rt: 'F', to: '179 ST', t: ['5', '13'] },
    { rt: 'R', to: '71 AV', t: ['9', '18'] }] },
  { label: 'TO BROOKLYN', rows: [
    { rt: 'A', to: 'FAR ROCK', t: ['4', '24'] }, { rt: 'A', to: 'LEFFERTS', t: ['DUE', '19'] }, { rt: 'C', to: 'EUCLID', t: ['6', '14'] },
    { rt: 'F', to: 'CONEY IS', t: ['3', '11'] }, { rt: 'R', to: 'BAY RDGE', t: ['8', '16'] }] },
];
const BIG = [
  { label: 'UPTOWN & QUEENS', rows: [{ rt: 'N', to: 'Astoria', t: '2' }, { rt: 'Q', to: '96 St', t: '4' }] },
  { label: 'DOWNTOWN & BKLYN', rows: [{ rt: 'Q', to: 'Coney Is', t: '3' }, { rt: 'R', to: 'Bay Ridge', t: '7' }] },
];
const BELMONT = [
  { label: 'NORTHBOUND', rows: [
    { ln: CTA.RD, to: 'HOWARD', t: ['3', '11', '19'] }, { ln: CTA.BR, to: 'KIMBALL', t: ['5', '13'] }, { ln: CTA.PR, to: 'LINDEN', t: ['8', '22'] }] },
  { label: 'SOUTHBOUND', rows: [
    { ln: CTA.RD, to: '95TH', t: ['2', '9', '16'] }, { ln: CTA.BR, to: 'LOOP', t: ['4', '12', '20'] }, { ln: CTA.PR, to: 'LOOP', t: ['7', '21'] }] },
];

const MOCKS = [
  ['w128-names', 'Names, 3 rows: Times Sq, page 1 of 2', names(SIDES_TSQ)],
  ['w128-names-p2', 'Page 2', names(SIDES_TSQ, { page: 1 })],
  ['w128-nolabel', 'Names, 4 rows, no labels: Grand Central', names(GC, { labels: false })],
  ['w128-grid', 'Route grid, no names: Times Sq on one page', grid(SIDES_TSQ)],
  ['w128-jay', 'Branches as names: Jay St, page 1 of 2', names(JAY)],
  ['w128-big', 'Big rows (5x7): Times Sq N Q R', big(BIG)],
  ['w128-hero', 'Next train big: Bedford Av (L)', hero('L', [{ label: 'TO 8 AV', t: ['3', '11', '19'] }, { label: 'TO CANARSIE', t: ['12', '20', '28'] }])],
  ['w128-cta', 'CTA for comparison: Belmont', cta(BELMONT)],
];

const q5 = (v) => v & 0xf8;
fs.mkdirSync(OUT, { recursive: true });
for (const [id, , fr] of MOCKS) {
  const q = new Frame(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) q.set(x, y, fr.get(x, y).map(q5));
  fs.writeFileSync(path.join(OUT, `${id}.png`), q.toPNG(10));
}
const GAP = 4, TH = 8, COLS = 2;
const sheet = new Frame(COLS * W + (COLS + 1) * GAP, Math.ceil(MOCKS.length / COLS) * (TH + H + GAP) + GAP);
MOCKS.forEach(([, label, fr], i) => {
  const ox = GAP + (i % COLS) * (W + GAP), oy = GAP + Math.floor(i / COLS) * (TH + H + GAP);
  sheet.text('small', label.toUpperCase(), ox, oy + 5, '#5a5a5a');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sheet.set(ox + x, oy + TH + y, fr.get(x, y).map(q5));
});
fs.writeFileSync(path.join(OUT, 'w128-sheet.png'), sheet.toPNG(5));
console.log('wrote docs/board/mockups/mta/w128-*.png');
module.exports = { MOCKS };
