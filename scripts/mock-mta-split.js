#!/usr/bin/env node
'use strict';
// NYC subway, uptown | downtown split, round 2: overflow paging, direction
// labels, station name, branch tags, express. Not in draw.js. Made-up times.
//   node scripts/mock-mta-split.js   -> docs/board/mockups/mta/split-*.png

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { packFonts } = require('../server/board/fonts');
const G = require('../server/board/glyphs');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'mta');
const F = packFonts();
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

const ROUTE = {
  1: '#ee352e', 2: '#ee352e', 3: '#ee352e', 4: '#00933c', 5: '#00933c', 6: '#00933c', 7: '#b933ad',
  A: '#1f5fe0', C: '#1f5fe0', E: '#1f5fe0', B: '#ff6319', D: '#ff6319', F: '#ff6319', M: '#ff6319',
  G: '#6cbe45', J: '#b07a40', Z: '#b07a40', L: '#a7a9ac', N: '#fccc0a', Q: '#fccc0a', R: '#fccc0a', W: '#fccc0a', S: '#808183',
};
const DARK_TEXT = new Set(['N', 'Q', 'R', 'W']);
const C = { label: '#d8d8d8', white: '#f0f0f0', amber: '#ffb000', dim: '#664600', grey: '#808080', dark: '#555555', rule: '#333333', pip: '#3a3a3a' };

const measure = (font, s) => { let w = 0; for (const ch of s) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; } return w > 0 ? w - 1 : 0; };
const rtext = (f, font, s, x1, base, col) => f.text(font, s, x1 - measure(font, s) + 1, base, col);
const DISC = ['..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'];
const RING = ['..XXX..', '.X...X.', 'X.....X', 'X.....X', 'X.....X', '.X...X.', '..XXX..'];
const DIAMOND = ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const shape = (f, rows, x, y, col) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === 'X') f.set(x + i, y + j, hex(col)); }));
function knock(f, s, x, base) {
  const t = new Frame(16, 8); t.text('small', s, 0, 6, '#ffffff');
  for (let j = 0; j < 8; j++) for (let i = 0; i < 16; i++) if (t.get(i, j)[0]) f.set(x + i, base - 6 + j, [0, 0, 0]);
}
// yellow: 'knock' (MTA's dark letter, knocked out) or 'ring' (yellow ring, white letter; also used for the L)
let YELLOW = 'ring';
function bullet(f, rt, x, y, express = false) {
  const light = DARK_TEXT.has(rt) || rt === 'L';
  const ring = light && YELLOW === 'ring' && !express;
  shape(f, express ? DIAMOND : ring ? RING : DISC, x, y, ROUTE[rt]);
  const gx = x + Math.floor((7 - measure('small', rt)) / 2);
  if (DARK_TEXT.has(rt) && !ring && !express) knock(f, rt, gx, y + 6);
  else f.text('small', rt, gx, y + 6, C.white);
}

// Half: x0..x1 inclusive. Row: { rt, ex, tag, times }.
function half(f, x0, x1, label, rows, { page = 0, pages = 1, top = 0, tops = [9, 17, 25] } = {}) {
  if (label) {
    f.text('small', label, x0, top + 6, C.grey);
    if (pages > 1) for (let i = 0; i < pages; i++) f.set(x1 - (pages - 1 - i) * 2, top + 7, hex(i === page ? C.label : C.pip));
  }
  rows.slice(page * tops.length, page * tops.length + tops.length).forEach((r, i) => {
    const y = tops[i];
    bullet(f, r.rt, x0, y, r.ex);
    let end = x0 + 8;
    if (r.tag) end = f.text('small', r.tag, x0 + 8, y + 6, C.label);
    let x = x1;
    const times = r.tag ? r.times.slice(0, 1) : r.times;
    [...times].reverse().forEach((t, k) => {
      const first = k === times.length - 1;
      const w = measure('small', t);
      if (x - w + 1 < end + (r.tag ? 0 : 1)) return;
      f.text('small', t, x - w + 1, y + 6, first ? C.amber : C.dim);
      x -= w + 2;
    });
  });
}
function split(L, R, opts = {}) {
  const f = new Frame();
  const { header } = opts;
  let top = 0, tops = [9, 17, 25];
  if (header) {
    f.text('small', header, 0, 6, C.dark);
    rtext(f, 'small', '9:41', 63, 6, C.dark);
    f.fill(0, 8, 64, 1, C.rule);
    top = 9; tops = [17, 25];
  }
  half(f, 0, 30, L.label, L.rows, { ...L, top, tops });
  half(f, 33, 63, R.label, R.rows, { ...R, top, tops });
  return f;
}

// ---- stations (made-up times) ----
const TSQ_UP = [
  { rt: '1', times: ['3', '9'] }, { rt: '2', times: ['5', '12'] }, { rt: '3', times: ['DUE', '8'] },
  { rt: 'N', times: ['4', '13'] }, { rt: 'Q', times: ['7', '15'] }, { rt: 'R', times: ['2', '11'] },
  { rt: 'W', times: ['9', '18'] },
];
const TSQ_DN = [
  { rt: '1', times: ['2', '10'] }, { rt: '2', times: ['6', '13'] }, { rt: '3', times: ['4', '15'] },
  { rt: 'N', times: ['8', '17'] }, { rt: 'Q', times: ['3', '12'] }, { rt: 'R', times: ['5', '14'] },
  { rt: 'W', times: ['11', '20'] },
];
const JAY_UP = [{ rt: 'A', times: ['2', '10'] }, { rt: 'C', times: ['7', '16'] }, { rt: 'F', times: ['5', '13'] }, { rt: 'R', times: ['9', '18'] }];
const JAY_DN = [
  { rt: 'A', tag: 'FAR', times: ['4'] }, { rt: 'A', tag: 'LEF', times: ['DUE'] }, { rt: 'C', times: ['6', '14'] },
  { rt: 'F', times: ['3', '11'] }, { rt: 'R', times: ['8', '16'] },
];
const GC_UP = [{ rt: '4', times: ['2', '9'] }, { rt: '5', times: ['5', '14'] }, { rt: '6', times: ['DUE', '8'] }, { rt: '6', ex: true, times: ['4', '16'] }];
const GC_DN = [{ rt: '4', times: ['3', '11'] }, { rt: '5', times: ['7', '15'] }, { rt: '6', times: ['1', '6'].map((t) => (t === '1' ? 'DUE' : t)) }];
const pagesOf = (rows) => Math.ceil(rows.length / 3);

const knockout = (fn) => { YELLOW = 'knock'; const f = fn(); YELLOW = 'ring'; return f; };
const MOCKS = [
  ['split-tsq-p1', 'TIMES SQ, PAGE 1 OF 3', split({ label: 'UPTOWN', rows: TSQ_UP, pages: 3 }, { label: 'DOWNTWN', rows: TSQ_DN, pages: 3 })],
  ['split-tsq-p2', 'PAGE 2: YELLOW RINGS', split({ label: 'UPTOWN', rows: TSQ_UP, page: 1, pages: 3 }, { label: 'DOWNTWN', rows: TSQ_DN, page: 1, pages: 3 })],
  ['split-tsq-p2-knock', 'PAGE 2: MTA KNOCKOUT', knockout(() => split({ label: 'UPTOWN', rows: TSQ_UP, page: 1, pages: 3 }, { label: 'DOWNTWN', rows: TSQ_DN, page: 1, pages: 3 }))],
  ['split-tsq-filter', 'FILTERED: 1 2 3 ONLY', split({ label: 'UPTOWN', rows: TSQ_UP.slice(0, 3) }, { label: 'DOWNTWN', rows: TSQ_DN.slice(0, 3) })],
  ['split-jay-p1', 'JAY ST, BRANCH TAGS', split({ label: 'MANHTN', rows: JAY_UP, pages: 2 }, { label: 'BKLYN', rows: JAY_DN, pages: 2 })],
  ['split-jay-p2', 'PAGE 2', split({ label: 'MANHTN', rows: JAY_UP, page: 1, pages: 2 }, { label: 'BKLYN', rows: JAY_DN, page: 1, pages: 2 })],
  ['split-gc', 'GRAND CTRL, PAGE 2', split({ label: 'UPTOWN', rows: GC_UP, page: 1, pages: 2 }, { label: 'DOWNTWN', rows: GC_DN })],
  ['split-header', 'WITH STATION HEADER', split({ label: 'UPTOWN', rows: TSQ_UP.slice(0, 2) }, { label: 'DOWNTWN', rows: TSQ_DN.slice(0, 2) }, { header: 'TIMES SQ' })],
];

const q5 = (v) => v & 0xf8;
fs.mkdirSync(OUT, { recursive: true });
for (const [id, , fr] of MOCKS) {
  const q = new Frame();
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) q.set(x, y, fr.get(x, y).map(q5));
  fs.writeFileSync(path.join(OUT, `${id}.png`), q.toPNG(10));
}
const PW = 64, PH = 32, GAP = 4, TH = 8, COLS = 4;
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, Math.ceil(MOCKS.length / COLS) * (TH + PH + GAP) + GAP);
MOCKS.forEach(([, label, fr], i) => {
  const ox = GAP + (i % COLS) * (PW + GAP), oy = GAP + Math.floor(i / COLS) * (TH + PH + GAP);
  sheet.text('small', label, ox, oy + 5, '#5a5a5a');
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, fr.get(x, y).map(q5));
});
fs.writeFileSync(path.join(OUT, 'split-sheet.png'), sheet.toPNG(6));
console.log('wrote docs/board/mockups/mta/split-*.png');
