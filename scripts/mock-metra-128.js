#!/usr/bin/env node
'use strict';
// Metra on a 128x32 board (two 64x32 chained): first-pass layouts. Not in
// draw.js. Made-up times and train numbers; the line colors are placeholders
// (boosted for the panel), to be replaced from Metra's GTFS routes.txt.
//   node scripts/mock-metra-128.js   -> docs/board/mockups/metra/*.png

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { packFonts } = require('../server/board/fonts');
const G = require('../server/board/glyphs');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'metra');
const F = packFonts();
const W = 128, H = 32;
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const scale = (c, k) => '#' + hex(c).map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('');

const LINE = { UPN: '#1f9a4a', UPNW: '#ffd400', UPW: '#f08ab0', RD: '#c60c30' };
const NAME = { UPN: 'UP-N', UPNW: 'UP-NW', UPW: 'UP-W' };
const C = {
  label: '#d8d8d8', white: '#ffffff', amber: '#ffb000', dim: '#664600', grey: '#808080', dark: '#555555',
  sched: '#6a6a6a', schedDim: '#2e2e2e', late: '#ff2020', index: '#2d2d2d',
};
const CLOCK = '5:42';

const measure = (font, s) => { let w = 0; for (const ch of s) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; } return w > 0 ? w - 1 : 0; };
const rtext = (f, font, s, x1, base, col) => { f.text(font, s, x1 - measure(font, s) + 1, base, col); return x1 - measure(font, s); };

// Countdown color: amber for the next live train, dim after it; grey for a
// train Metra isn't tracking yet (the board's schedule-based convention).
const cdCol = (r, first) => (r.sched ? (first ? C.sched : C.schedDim) : first ? C.amber : C.dim);
// Expected departure: red when late, grey when schedule-only.
const timeCol = (r) => (r.late ? C.late : r.sched ? C.sched : C.label);
const status = (r) => (r.late ? [`${r.late} LATE`, C.late] : r.sched ? ['SCHED', C.schedDim] : ['ON TIME', C.dark]);

function header(f, station, { line } = {}) {
  let x = f.text('small', station, 0, 6, C.grey);
  if (line) f.text('small', NAME[line], x + 3, 6, LINE[line]);
  rtext(f, 'small', CLOCK, W - 1, 6, C.grey);
}

// ---- A / E. Departures: one train per row across both panels ----
// time | destination | train number or line | status | countdown
function departures(station, rows, { line, mid = 'num' } = {}) {
  const f = new Frame(W, H);
  header(f, station, { line });
  rows.slice(0, 4).forEach((r, i) => {
    const top = 8 + i * 6, base = top + 5;
    if (mid === 'num') {
      f.fill(0, top, 3, 5, LINE[r.ln]);
      rtext(f, 'small', r.at, 23, base, timeCol(r));
      f.text('small', r.to, 27, base, C.label);
      f.text('small', `#${r.no}`, 64, base, C.dark);
    } else { // several lines: the line's name in its color stands in for the block
      f.text('small', NAME[r.ln], 0, base, LINE[r.ln]);
      rtext(f, 'small', r.at, 40, base, timeCol(r));
      f.text('small', r.to, 44, base, C.label);
    }
    const [s, sc] = status(r);
    rtext(f, 'small', s, 109, base, sc);
    rtext(f, 'small', r.in, W - 1, base, cdCol(r, i === 0));
  });
  return f;
}

const HALVES = [[0, 61], [65, 127]];

// ---- B. Inbound | outbound: time, destination, countdown; station line ----
function split(station, line, sides) {
  const f = new Frame(W, H);
  sides.forEach(({ label, rows }, s) => {
    const [x0, x1] = HALVES[s];
    f.text('small', label, x0, 5, C.grey);
    rows.slice(0, 3).forEach((r, i) => {
      const base = 8 + i * 6 + 5;
      const x = f.text('small', r.at, x0, base, timeCol(r));
      f.text('small', r.to, Math.max(x + 2, x0 + 18), base, C.label);
      if (r.min < 60) rtext(f, 'small', r.in, x1, base, cdCol(r, i === 0));
    });
  });
  const x = f.text('small', station, 0, 32, C.dark);
  f.text('small', NAME[line], x + 3, 32, scale(LINE[line], 0.7));
  rtext(f, 'small', CLOCK, W - 1, 32, C.dark);
  return f;
}

// ---- C. Beside the 'L': CTA rows left, one Metra row per direction right ----
function beside(station, cta, metra) {
  const f = new Frame(W, H);
  f.text('small', 'CTA', 0, 5, C.grey);
  f.text('small', 'METRA', 65, 5, C.grey);
  cta.forEach((r, i) => {
    const top = [10, 18][i];
    f.fill(0, top, 3, 5, LINE[r.ln]);
    f.text('small', r.to, 5, top + 5, C.label);
    let x = 61;
    for (let k = r.t.length - 1; k >= 0; k--) x = rtext(f, 'small', r.t[k], x, top + 5, k === 0 ? C.amber : C.dim) - 3;
  });
  metra.forEach((r, i) => {
    const top = [10, 18][i];
    f.fill(65, top, 3, 5, LINE[r.ln]);
    f.text('small', r.to, 70, top + 5, C.label);
    const x = rtext(f, 'small', r.in, W - 1, top + 5, cdCol(r, true));
    rtext(f, 'small', r.at, x - 3, top + 5, r.late ? C.late : C.dark);
  });
  f.text('small', station, 0, 32, C.dark);
  rtext(f, 'small', CLOCK, W - 1, 32, C.dark);
  return f;
}

// ---- D. Next train big: one station, both directions ----
function hero(sides) {
  const f = new Frame(W, H);
  sides.forEach(({ label, r, then }, s) => {
    const [x0, x1] = HALVES[s];
    f.text('small', label, x0, 5, C.grey);
    const col = r.sched ? C.sched : C.amber;
    const end = f.text('clock', r.min, x0, 23, col);
    f.text('small', 'MIN', end + 1, 23, col);
    rtext(f, '5x7', r.at, x1, 15, r.late ? C.late : C.label);
    const [st, sc] = status(r);
    rtext(f, 'small', st, x1, 23, sc === C.schedDim ? C.dark : sc);
    const x = f.text('small', 'THEN', x0, 31, C.dark);
    f.text('small', then.join('  '), x + 3, 31, C.dim);
  });
  return f;
}

// ---- F. Ticker bands, after the 'L' ticker: 5x7 on the line color ----
function ticker(station, line, rows) {
  const f = new Frame(W, H);
  header(f, station);
  rows.slice(0, 2).forEach((r, i) => {
    const top = 7 + i * 13, base = top + 10;
    f.fill(0, top, 5, 12, C.index);
    f.text('small', String(i + 1), 1, top + 9, C.grey);
    f.fill(5, top, W - 5, 12, scale(LINE[line], 0.55));
    let x = f.text('5x7', r.at, 7, base, C.white);
    x = f.text('5x7', r.to5, x + 4, base, C.white);
    if (r.late) f.text('small', `${r.late} LATE`, x + 3, base, C.white);
    x = rtext(f, '5x7', String.fromCodePoint(G.MIN), W - 2, base, C.white);
    rtext(f, '5x7', r.min, x - 2, base, C.white);
  });
  return f;
}

// ---- data: Rogers Park (UP-N), 5:42 PM; `at` is the expected departure ----
const T = (ln, no, at, to, min, extra = {}) => ({ ln, no, at, to, to5: to[0] + to.slice(1).toLowerCase(), min: String(min), in: min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min}m`, ...extra });
const RP = [
  T('UPN', 339, '5:51', 'KENOSHA', 9),
  T('UPN', 360, '5:55', 'CHICAGO', 13, { late: 8 }),
  T('UPN', 341, '6:10', 'WAUKEGAN', 28),
  T('UPN', 362, '6:21', 'CHICAGO', 39, { sched: true }),
  T('UPN', 343, '6:40', 'KENOSHA', 58, { sched: true }),
  T('UPN', 364, '6:51', 'CHICAGO', 69, { sched: true }),
];
const bare = (r) => ({ ...r, in: r.min >= 60 ? r.in : r.min });
const IN = RP.filter((r) => r.no % 2 === 0), OUTB = RP.filter((r) => r.no % 2 === 1);
const OTC = [
  T('UPNW', 643, '5:45', 'HARVARD', 3),
  T('UPW', 57, '5:48', 'ELBURN', 6),
  T('UPN', 339, '5:50', 'KENOSHA', 8),
  T('UPNW', 645, '5:54', 'CRYSTAL LK', 12, { late: 14 }),
];

const MOCKS = [
  ['a-departures', 'A  Departures: one train per row', departures('ROGERS PARK', RP, { line: 'UPN' })],
  ['b-split', 'B  Inbound | outbound', split('ROGERS PARK', 'UPN', [{ label: 'INBOUND', rows: IN.map(bare) }, { label: 'OUTBOUND', rows: OUTB.map(bare) }])],
  ['c-beside', "C  Beside the 'L': Morse + Rogers Park", beside('MORSE', [{ ln: 'RD', to: 'HOWARD', t: ['DUE', '7', '15'] }, { ln: 'RD', to: '95TH', t: ['3', '12', '22'] }], [{ ...bare(IN[0]), to: 'INBOUND' }, { ...bare(OUTB[0]), to: 'OUTBOUND' }])],
  ['d-hero', 'D  Next train big', hero([{ label: 'INBOUND', r: IN[0], then: ['6:21', '6:51'] }, { label: 'OUTBOUND', r: OUTB[0], then: ['6:10', '6:40'] }])],
  ['e-terminal', 'E  Downtown terminal: three lines', departures('OGILVIE', OTC, { mid: 'line' })],
  ['f-ticker', 'F  Ticker bands (5x7)', ticker('ROGERS PARK', 'UPN', RP)],
];

// ================= Round 2 (Nov 27): a station screen and a terminus screen =================
// Changes from round 1's B and E:
//  - The time column never greys out. On Metra most trains on screen haven't
//    started their runs, so "not tracked yet" is the normal case: only the
//    countdown carries it (amber/dim when the train is live, grey before).
//  - Blank means on time. A late train's expected time is red; where there's
//    room (full-width rows) a red +N follows the name.
//  - Canceled trains keep their row: red time, CANCELED, no countdown.
//  - No countdown past 59 minutes in a half (1h23 on full-width rows), so
//    tomorrow's first trains need no special overnight screen.
const cd2 = (r, first) => (r.live ? (first ? C.amber : C.dim) : first ? C.sched : C.schedDim);
const t2col = (r) => (r.late || r.cancel ? C.late : C.label);
const R = (ln, at, to, min, extra = {}) => ({ ln, at, to, min, ...extra });
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min}m`);

// Station: inbound | outbound, one train per row. opts.blocks for a station on
// more than one line; opts.arr shows the arrival downtown on the inbound half.
function station(name, lines, sides, { blocks = false, arr = false, clock = '5:42' } = {}) {
  const f = new Frame(W, H);
  sides.forEach(({ label, rows }, s) => {
    const [x0, x1] = HALVES[s];
    f.text('small', label, x0, 5, C.grey);
    const tx = x0 + (blocks ? 5 : 0);
    const nx = tx + Math.max(...rows.map((r) => measure('small', r.at))) + (blocks ? 3 : 4);
    const first = rows.findIndex((r) => !r.cancel);
    rows.slice(0, 3).forEach((r, i) => {
      const top = 8 + i * 6, base = top + 5;
      if (blocks) f.fill(x0, top, 3, 5, LINE[r.ln]);
      f.text('small', r.at, tx, base, t2col(r));
      if (r.cancel) return void f.text('small', 'CANCELED', nx, base, C.late);
      if (arr && r.arr) { const x = f.text('small', 'ARR', nx, base, C.dark); f.text('small', r.arr, x + 2, base, C.grey); }
      else f.text('small', r.to, nx, base, C.label);
      if (r.min < 60) rtext(f, 'small', String(r.min), x1, base, cd2(r, i === first));
    });
  });
  let x = f.text('small', name, 0, 32, C.dark);
  for (const ln of lines) x = f.text('small', NAME[ln], x + 3, 32, scale(LINE[ln], 0.7));
  rtext(f, 'small', clock, W - 1, 32, C.dark);
  return f;
}

// Terminus (every train leaves the same way: downtown, or the end of a line):
// full-width rows. opts.home lists only the trains that stop at one station,
// with the time each gets there.
function terminus(name, rows, { home, clock = '5:42' } = {}) {
  const f = new Frame(W, H);
  let hx = f.text('small', name, 0, 6, C.grey);
  if (home) f.text('small', `TO ${home}`, hx + 3, 6, C.dark);
  rtext(f, 'small', clock, W - 1, 6, C.grey);
  const first = rows.findIndex((r) => !r.cancel);
  rows.slice(0, 4).forEach((r, i) => {
    const top = 8 + i * 6, base = top + 5;
    let nx;
    if (home) { f.fill(0, top, 3, 5, LINE[r.ln]); rtext(f, 'small', r.at, 23, base, t2col(r)); nx = 27; }
    else { f.text('small', NAME[r.ln], 0, base, LINE[r.ln]); rtext(f, 'small', r.at, 40, base, t2col(r)); nx = 44; }
    if (r.cancel) return void f.text('small', 'CANCELED', nx, base, C.late);
    const end = f.text('small', r.to, nx, base, C.label);
    if (home) { const x = f.text('small', 'ARR', 70, base, C.dark); f.text('small', r.arr, x + 2, base, r.late ? C.late : C.grey); }
    else if (r.late) f.text('small', `+${r.late}`, end + 2, base, C.late);
    rtext(f, 'small', hm(r.min), W - 1, base, cd2(r, i === first));
  });
  return f;
}

const RP_IN = [R('UPN', '5:55', 'CHICAGO', 13, { late: 8, live: true, arr: '6:19' }), R('UPN', '6:21', 'CHICAGO', 39, { arr: '6:43' }), R('UPN', '6:51', 'CHICAGO', 69, { arr: '7:13' })];
const RP_OUT = [R('UPN', '5:51', 'KENOSHA', 9, { live: true }), R('UPN', '6:10', 'WAUKEGAN', 28, { live: true }), R('UPN', '6:40', 'KENOSHA', 58)];
const CLY_IN = [R('UPNW', '5:46', 'CHICAGO', 4, { live: true }), R('UPN', '6:07', 'CHICAGO', 25, { late: 8, live: true }), R('UPNW', '6:16', 'CHICAGO', 34, { live: true })];
const CLY_OUT = [R('UPN', '5:44', 'KENOSHA', 2, { live: true }), R('UPNW', '5:53', 'HARVARD', 11, { live: true }), R('UPN', '6:01', 'WAUKEGAN', 19)];
const NIGHT_IN = [R('UPN', '12:20', 'CHICAGO', 32), R('UPN', '5:32', 'CHICAGO', 344), R('UPN', '6:02', 'CHICAGO', 374)];
const NIGHT_OUT = [R('UPN', '11:55', '', 7, { cancel: true }), R('UPN', '12:35', 'KENOSHA', 47), R('UPN', '1:35', 'WAUKEGAN', 107)];
const OTC2 = [
  R('UPNW', '5:45', 'HARVARD', 3, { live: true }), R('UPW', '5:48', 'ELBURN', 6, { live: true }),
  R('UPN', '5:50', '', 8, { cancel: true }), R('UPNW', '5:54', 'CRYSTAL LAKE', 12, { late: 14, live: true }),
];
const OTC_HOME = [
  R('UPN', '5:50', 'KENOSHA', 8, { live: true, arr: '6:07' }), R('UPN', '6:11', 'WINNETKA', 29, { late: 6, live: true, arr: '6:28' }),
  R('UPN', '6:35', 'WAUKEGAN', 53, { arr: '6:52' }), R('UPN', '7:05', 'KENOSHA', 83, { arr: '7:22' }),
];
const BOTH = (i, o) => [{ label: 'INBOUND', rows: i }, { label: 'OUTBOUND', rows: o }];

const ROUND2 = [
  ['r2-station', 'S1  Station: Rogers Park', station('ROGERS PARK', ['UPN'], BOTH(RP_IN, RP_OUT))],
  ['r2-station-arr', 'S2  Inbound: arrival downtown', station('ROGERS PARK', ['UPN'], BOTH(RP_IN, RP_OUT), { arr: true })],
  ['r2-station-lines', 'S3  Station on two lines: Clybourn', station('CLYBOURN', ['UPN', 'UPNW'], BOTH(CLY_IN, CLY_OUT), { blocks: true })],
  ['r2-station-night', 'S4  11:48 PM: canceled, tomorrow', station('ROGERS PARK', ['UPN'], BOTH(NIGHT_IN, NIGHT_OUT), { clock: '11:48' })],
  ['r2-terminus', 'T1  Terminus: Ogilvie, every line', terminus('OGILVIE', OTC2)],
  ['r2-terminus-home', 'T2  Terminus with a home stop', terminus('OGILVIE', OTC_HOME, { home: 'ROGERS PARK' })],
];

const q5 = (v) => v & 0xf8;
fs.mkdirSync(OUT, { recursive: true });
function write(mocks, name) {
  for (const [id, , fr] of mocks) {
    const q = new Frame(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) q.set(x, y, fr.get(x, y).map(q5));
    fs.writeFileSync(path.join(OUT, `${id}.png`), q.toPNG(10));
  }
  const GAP = 4, TH = 8;
  const sheet = new Frame(W + 2 * GAP, mocks.length * (TH + H + GAP) + GAP);
  mocks.forEach(([, label, fr], i) => {
    const ox = GAP, oy = GAP + i * (TH + H + GAP);
    sheet.text('small', label.toUpperCase(), ox, oy + 5, '#808080');
    // Unlit LEDs a step above the page, so each panel's edge shows.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = fr.get(x, y).map(q5);
      sheet.set(ox + x, oy + TH + y, p[0] || p[1] || p[2] ? p : [5, 5, 5]);
    }
  });
  fs.writeFileSync(path.join(OUT, name), sheet.toPNG(8, [0, 0, 0]));
}
write(MOCKS, 'sheet.png');
write(ROUND2, 'sheet-r2.png');
console.log('wrote docs/board/mockups/metra/*.png');
module.exports = { MOCKS, ROUND2 };
