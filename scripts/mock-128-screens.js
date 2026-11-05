#!/usr/bin/env node
'use strict';
// The board's existing screens redrawn for a 128x32 panel (two 64x32
// chained). Not in draw.js. Transit times are from the recorded fixtures; the rest is made up
// unless noted.
//   node scripts/mock-128-screens.js   -> docs/board/mockups/w128/*.png

const fs = require('fs');
const path = require('path');
const B = path.join(__dirname, '..', 'server', 'board');
const { Frame } = require(path.join(B, 'raster'));
const { packFonts } = require(path.join(B, 'fonts'));
const draw = require(path.join(B, 'render'));
const icons = require(path.join(B, 'icons'));
const G = require(path.join(B, 'glyphs'));

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'w128');
const F = packFonts();
const W = 128, H = 32;
const { LINE } = draw;
const C = { ...draw.C, dim: '#664600', rule: '#262626' };
const s = (cp) => String.fromCodePoint(cp);

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const scale = (c, k) => toHex(hex(c).map((v) => v * k));
const lerp = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const measure = (font, str) => { let w = 0; for (const ch of str) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; } return w > 0 ? w - 1 : 0; };
const rtext = (f, font, str, x1, base, col) => f.text(font, str, x1 - measure(font, str) + 1, base, col);
const ctext = (f, font, str, cx, base, col) => f.text(font, str, Math.round(cx - (measure(font, str) - 1) / 2), base, col);
const icon = (f, name, x, y) => icons.ICONS[name].forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') f.set(x + i, y + j, hex(icons.PALETTE[c])); }));
const STOPS = [[-10, '#6080ff'], [20, '#60b0ff'], [40, '#30d0d0'], [55, '#40d040'], [70, '#ffd000'], [85, '#ff8000'], [100, '#ff2020']];
function tempColor(t) {
  if (t <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) return lerp(STOPS[i - 1][1], STOPS[i][1], (t - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]));
  return STOPS[STOPS.length - 1][1];
}
// Times right-aligned at x1; later ones drop when they'd come within 3px of `end`.
function times(f, ts, x1, base, end, { col = (i) => (i === 0 ? C.amber : C.dim), gap = 3 } = {}) {
  let keep = ts.map(String);
  const width = (a) => a.reduce((w, t) => w + measure('small', t), 0) + gap * (a.length - 1);
  while (keep.length > 1 && x1 - width(keep) + 1 < end + 3) keep = keep.slice(0, -1);
  let x = x1;
  for (let i = keep.length - 1; i >= 0; i--) { const w = measure('small', keep[i]); f.text('small', keep[i], x - w + 1, base, col(i)); x -= w + gap; }
}

// ======================= redrawn =======================

// Transit rows, full width: CTA destination names, up to 5 times.
function transitRows() {
  const f = new Frame(W, H);
  f.text('small', 'BELMONT', 0, 6, C.head);
  rtext(f, 'small', '11:16', 127, 6, C.clock);
  const rows = [['RD', 'HOWARD', [5, 12, 19, 28, 34]], ['RD', '95TH/DAN RYAN', [4, 14]], ['BR', 'KIMBALL', [5, 17, 38, 47]], ['BR', 'LOOP', ['DUE', 16]]];
  rows.forEach(([ln, lbl, ts], i) => {
    const top = 8 + i * 6;
    f.fill(0, top, 3, 5, LINE[ln]);
    const end = f.text('small', lbl, 5, top + 5, C.label) - 1;
    times(f, ts, 127, top + 5, end);
  });
  return f;
}

// Direction split, CTA rows in each half.
function transitSplit() {
  const f = new Frame(W, H);
  const halves = [[0, 61, 'NORTHBOUND', [['RD', 'HOWARD', [5, 12, 19, 28]], ['BR', 'KIMBALL', [5, 17, 38]]]],
    [65, 127, 'SOUTHBOUND', [['RD', '95TH', [4, 14]], ['BR', 'LOOP', ['DUE', 16]]]]];
  for (const [x0, x1, label, rows] of halves) {
    f.text('small', label, x0, 6, C.head);
    rows.forEach(([ln, lbl, ts], i) => {
      const top = 10 + i * 8;
      f.fill(x0, top, 3, 5, LINE[ln]);
      const end = f.text('small', lbl, x0 + 5, top + 5, C.label) - 1;
      times(f, ts, x1, top + 5, end);
    });
  }
  f.text('small', 'BELMONT', 0, 31, C.dimHead);
  rtext(f, 'small', '11:16', 127, 31, C.dimHead);
  return f;
}

// Ticker in the style of the CTA's platform signs: the row number in the grey
// index column, the full destination, the time at the far right, and after
// it a live-train signal (three arcs) or, for a scheduled train, a clock.
// 7 x 7, the height of the 5x7 capitals: three arcs opening to the upper right, and a clock face.
const LIVE = ['###....', '...##..', '##...#.', '..#..#.', '#..#..#', '.#.#..#', '.#..#.#'];
const SCHED = ['.#####.', '#..#..#', '#..#..#', '#..##.#', '#.....#', '#.....#', '.#####.'];
function ticker() {
  const f = new Frame(W, H);
  f.text('small', 'MORSE', 0, 6, C.head);
  rtext(f, 'small', '11:16', 127, 6, C.clock);
  // Morse, Oct 3, 11:16 PM; the Howard train is shown as scheduled to show the clock.
  const rows = [['RD', '95th/Dan Ryan', 'Due', true], ['RD', 'Howard', '3', false]];
  rows.forEach(([ln, dest, t, live], i) => {
    const top = 7 + i * 13, base = top + 9;
    f.fill(0, top, 5, 12, C.index);
    f.fill(5, top, 123, 12, scale(LINE[ln], 0.55));
    f.text('small', String(i + 1), 1, base, C.label);
    f.text('5x7', dest, 7, base, C.white);
    // Icon 1px in from the right edge, the time 3px clear of it.
    const ix = 126 - 6;
    (live ? LIVE : SCHED).forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') f.set(ix + x, base - 7 + y, hex(C.white)); }));
    const tr = ix - 4;
    if (t === 'Due') rtext(f, '5x7', 'Due', tr, base, C.white);
    else {
      const mw = measure('5x7', s(G.MIN));
      f.text('5x7', s(G.MIN), tr - mw + 1, base, C.white);
      rtext(f, '5x7', t, tr - mw - 2, base, C.white);
    }
  });
  return f;
}

// Chronological view in two columns: eight trains.
function chrono() {
  const f = new Frame(W, H);
  f.text('small', 'CLARK/LAKE', 0, 6, C.head);
  rtext(f, 'small', '11:17', 127, 6, C.clock);
  const trains = [['GR', 'HARLEM', 'DUE'], ['BL', "O'HARE", '3m'], ['BL', 'FOREST PK', '6m'], ['BL', "O'HARE", '10m'],
    ['PK', '54/CERMAK', '10m'], ['BR', 'KIMBALL', '19m'], ['BL', "O'HARE", '20m'], ['BL', 'FOREST PK', '21m']];
  trains.forEach(([ln, lbl, t], i) => {
    const x0 = i < 4 ? 0 : 66, x1 = i < 4 ? 61 : 127, top = 8 + (i % 4) * 6;
    f.text('small', String(i + 1), x0, top + 5, LINE[ln]);
    f.fill(x0 + 4, top, 3, 5, LINE[ln]);
    f.text('small', lbl, x0 + 9, top + 5, C.label);
    rtext(f, 'small', t, x1, top + 5, C.amber);
  });
  return f;
}

// The weather screens' top bar (current conditions): optional.
function topBar(f) {
  icon(f, 'pcloudy_day', 0, 0);
  const tx = f.text('5x7', '57°', 10, 7, C.white);
  f.text('small', 'PT CLOUDY', tx + 4, 6, C.wxText);
  // Right side, right to left: low, down arrow, high, up arrow.
  let x = 127;
  for (const [str, col] of [['49', C.label], [s(G.DOWN), C.grey], ['63', C.label], [s(G.UP), C.grey]]) {
    rtext(f, 'small', str, x, 6, col);
    x -= measure('small', str) + (str === '63' ? 4 : 2);
  }
}

// A 4-5 line station without the chronological view. Clark/Lake, real
// times (Oct 3, 11:17 PM): five destinations on five lines.
const CL = [['GR', 'HARLEM/LAKE', ['DUE']], ['BL', "O'HARE", [3, 10, 20, 27]], ['BL', 'FOREST PARK', [6, 21, 39]], ['PK', '54TH/CERMAK', [10, 22]], ['BR', 'KIMBALL', [19, 28, 44]]];
function destRow(f, x0, x1, top, [ln, lbl, ts]) {
  f.fill(x0, top, 3, 5, LINE[ln]);
  const end = f.text('small', lbl, x0 + 5, top + 5, C.label) - 1;
  times(f, ts, x1, top + 5, end);
}
// Five destination rows, no header (the 64 board drops the header to fit, too).
function transitFive() {
  const f = new Frame(W, H);
  CL.forEach((r, i) => destRow(f, 0, 127, 1 + i * 6, r));
  return f;
}
// Two columns of destination rows under the header: eight destinations. Clark/Lake at rush (made up).
function transitColumns() {
  const f = new Frame(W, H);
  f.text('small', 'CLARK/LAKE', 0, 6, C.head);
  rtext(f, 'small', '5:42', 127, 6, C.clock);
  // The 64 board's short names (destinations.js), so each row keeps three times.
  const rows = [['BL', "O'HARE", [2, 9, 15]], ['BL', 'FOREST', [4, 11, 18]], ['BR', 'KIMBALL', ['DUE', 7, 16]], ['PR', 'LINDEN', [5, 13, 24]],
    ['GR', 'HARLEM', [3, 12, 20]], ['GR', '63RD', [8, 17, 26]], ['OR', 'MIDWAY', [6, 14, 22]], ['PK', '54/CRMK', [10, 19, 31]]];
  rows.forEach((r, i) => destRow(f, i < 4 ? 0 : 66, i < 4 ? 61 : 127, 8 + (i % 4) * 6, r));
  return f;
}
// One row per line; a line's second destination starts at column 66. Clark/Lake midday (made up).
function transitByLine() {
  const f = new Frame(W, H);
  const lines = [['BL', [["O'HARE", [3, 10, 18]], ['FOREST', [6, 21, 33]]]], ['BR', [['KIMBALL', [5, 13, 21, 29]]]],
    ['GR', [['HARLEM', ['DUE', 12, 21]], ['63RD', [8, 19, 30]]]], ['OR', [['MIDWAY', [4, 11, 19, 26]]]], ['PK', [['54/CRMK', [10, 22, 34]]]]];
  lines.forEach(([ln, dests], i) => {
    const top = 1 + i * 6;
    f.fill(0, top, 3, 5, LINE[ln]);
    dests.forEach(([lbl, ts], k) => {
      const x0 = k ? 66 : 5, x1 = dests.length > 1 && !k ? 61 : 127;
      const end = f.text('small', lbl, x0, top + 5, C.label) - 1;
      times(f, ts, x1, top + 5, end);
    });
  });
  return f;
}

// 7-day forecast: day, icon, high, low. With the top bar the lows drop out.
function sevenDay({ top = false } = {}) {
  const f = new Frame(W, H);
  if (top) topBar(f);
  const o = top ? 8 : 0;
  const days = [['TU', 'sun', 71, 54], ['WE', 'pcloudy_day', 66, 52], ['TH', 'rain', 58, 49], ['FR', 'storm', 61, 47], ['SA', 'cloudy', 52, 40], ['SU', 'snow', 38, 29], ['MO', 'sun', 44, 30]];
  days.forEach(([d, ic, hi, lo], i) => {
    const x = i * 18 + 1, cx = x + 8;
    if (i) f.fill(x - 2, o + (top ? 2 : 0), 1, 32 - o, C.rule);
    ctext(f, 'small', d, cx, o + 6, i === 0 ? C.label : C.grey);
    icon(f, ic, cx - 4, o + 8);
    if (top) { ctext(f, 'small', `${hi}°`, cx + 1, 31, tempColor(hi)); return; }
    ctext(f, 'small', `${hi}°`, cx + 1, 23, tempColor(hi));
    ctext(f, 'small', `${lo}°`, cx + 1, 30, scale(tempColor(lo), 0.6));
  });
  return f;
}

// Hourly, 24 hours in 3-hour steps. Without the top bar the freed rows carry the rain chance.
function hourly({ top = true } = {}) {
  const f = new Frame(W, H);
  if (top) topBar(f);
  const hrs = [['3P', 'sun', 61, 0], ['6P', 'cloudy', 58, 10], ['9P', 'pcloudy_night', 55, 20], ['12A', 'rain', 52, 60], ['3A', 'rain', 50, 70], ['6A', 'fog', 49, 30], ['9A', 'pcloudy_day', 54, 10], ['12P', 'sun', 62, 0]];
  hrs.forEach(([h, ic, t, pop], i) => {
    const cx = i * 16 + 7;
    if (top) {
      if (i) f.fill(i * 16 - 1, 10, 1, 22, C.rule);
      ctext(f, 'small', h, cx, 15, C.grey);
      icon(f, ic, cx - 4, 17);
      ctext(f, 'small', `${t}°`, cx + 1, 31, tempColor(t));
      return;
    }
    if (i) f.fill(i * 16 - 1, 0, 1, 32, C.rule);
    ctext(f, 'small', h, cx, 6, C.grey);
    icon(f, ic, cx - 4, 8);
    ctext(f, 'small', `${t}°`, cx + 1, 23, tempColor(t));
    ctext(f, 'small', `${pop}%`, cx, 30, pop >= 20 ? '#1e90ff' : pop ? '#2a5a90' : '#3a3a3a');
  });
  return f;
}

// Baseball line score: innings, R H E, then the live state.
function lineScore() {
  const f = new Frame(W, H);
  const teams = [['CHC', '#2a5bd8', [0, 1, 0, 0, 2, 0, 0], [3, 7, 0]], ['STL', '#d62a2a', [1, 0, 0, 1, 0, 0], [2, 5, 1]]];
  const IX = 30, STEP = 8, RX = IX + 9 * STEP + 3;
  for (let i = 0; i < 9; i++) ctext(f, 'small', String(i + 1), IX + i * STEP + 1, 6, i === 6 ? C.amber : C.dimHead);
  ['R', 'H', 'E'].forEach((l, i) => ctext(f, 'small', l, RX + i * 9 + 2, 6, C.dimHead));
  f.fill(RX - 3, 0, 1, 25, C.rule);
  teams.forEach(([ab, col, inn, rhe], t) => {
    const base = 15 + t * 9;
    f.fill(0, base - 7, 3, 7, col);
    f.text('5x7', ab, 6, base, C.label);
    inn.forEach((r, i) => ctext(f, 'small', String(r), IX + i * STEP + 1, base - 1, t === 0 && i === 6 ? C.amber : C.grey));
    ctext(f, '5x7', String(rhe[0]), RX + 2, base, C.white);
    ctext(f, 'small', String(rhe[1]), RX + 11, base - 1, C.grey);
    ctext(f, 'small', String(rhe[2]), RX + 20, base - 1, C.grey);
  });
  f.fill(0, 25, 128, 1, C.rule);
  f.text('small', 'TOP 7', 0, 31, C.label);
  f.text('small', '2-1', 28, 31, C.label);
  f.text('small', '2 OUT', 44, 31, C.label);
  f.text('small', '94 PITCHES', 70, 31, C.dimHead);
  const D = ['.X.', 'XXX', '.X.'], on = [1, 0, 1];
  [[124, 28, on[0]], [121, 26, on[1]], [118, 28, on[2]]].forEach(([x, y, o]) => D.forEach((r, j) => [...r].forEach((c, i) => { if (c === 'X') f.set(x + i, y + j, hex(o ? C.amber : '#3a3a3a')); })));
  return f;
}

// Note: one line of 5x7 holds about 21 characters instead of 10.
function note() {
  const f = new Frame(W, H);
  ctext(f, '5x7', 'Grab milk on the way', 64, 14, C.label);
  ctext(f, '5x7', 'home please', 64, 25, C.label);
  return f;
}

// ======================= side by side =======================

// ======================= more screens: first pass =======================
const glyph = (f, rows, x, y, col) => rows.forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') f.set(x + i, y + j, hex(col)); }));
// Belmont, real times (Oct 3, 11:16 PM).
const BELMONT = [['RD', 'HOWARD', [5, 12, 19, 28]], ['RD', '95TH/DAN RYAN', [4, 14]], ['BR', 'KIMBALL', [5, 17, 38, 47]], ['BR', 'LOOP', ['DUE', 16]]];

// Key layout: the column key on the top row, with the station and clock between.
function keyLayout() {
  const f = new Frame(W, H);
  f.text('small', 'trains to', 5, 6, C.dimHead);
  rtext(f, 'small', 'min', 127, 6, C.dimHead);
  ctext(f, 'small', 'BELMONT  11:16', 64, 6, C.head);
  BELMONT.forEach(([ln, lbl, ts], i) => {
    const top = 8 + i * 6;
    f.fill(0, top, 3, 5, LINE[ln]);
    times(f, ts, 127, top + 5, f.text('small', lbl, 5, top + 5, C.label) - 1);
  });
  return f;
}

// Alerts: the full name, the red alert circle, then the alert's short label.
function alertRows() {
  const f = new Frame(W, H);
  f.text('small', 'BELMONT', 0, 6, C.head);
  rtext(f, 'small', '11:16', 127, 6, C.clock);
  BELMONT.forEach(([ln, lbl, ts], i) => {
    const top = 8 + i * 6, base = top + 5;
    f.fill(0, top, 3, 5, LINE[ln]);
    let end = f.text('small', lbl, 5, base, C.label) - 1;
    if (ln === 'BR') {
      const ix = end + 3;
      f.text('small', s(G.ALERT_DISC), ix, base, C.red);
      f.text('small', s(G.ALERT_MARK), ix, base, C.white);
      end = f.text('small', 'MAJOR DELAYS', ix + 7, base, '#c83030') - 1;
    }
    times(f, ts, 127, base, end);
  });
  return f;
}

// Overnight: the owl and big clock as on 64, with now and tomorrow beside them.
function overnight() {
  const f = new Frame(W, H);
  const owl = icons.OWL.frames[0][1], pal = icons.OWL.palette;
  owl.forEach((r, j) => [...r].forEach((c, i) => { if (c !== '.' && pal[c]) f.set(2 + i, 9 + j, hex(pal[c])); }));
  ctext(f, 'clock', '11:16', 41, 15, C.label);
  ctext(f, 'small', 'NO TRAINS', 41, 24, C.noTrains);
  f.fill(65, 2, 1, 28, C.rule);
  const x0 = 69;
  f.text('small', '63°', x0, 6, tempColor(63));
  f.text('small', 'PT CLOUDY', x0 + 15, 6, C.wxText);
  f.text('small', 'TOMORROW', x0, 14, C.dimHead);
  icon(f, 'sun', x0, 17);
  const tx = f.text('5x7', '69°', x0 + 11, 24, tempColor(69));
  f.text('small', '51°', tx + 3, 24, scale(tempColor(51), 0.6));
  f.text('small', 'SUNNY', x0, 31, C.wxText);
  return f;
}

// Current conditions: a 2x icon and the temperature in the clock digits, the readout beside.
function nowReadout() {
  const f = new Frame(W, H);
  icons.ICONS.pcloudy_day.forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') f.fill(i * 2, 1 + j * 2, 2, 2, icons.PALETTE[c]); }));
  const tx = f.text('clock', '57', 19, 13, C.white);
  f.text('small', '°', tx, 6, C.white);
  let x = 0;
  for (const [str, col] of [[s(G.UP), C.grey], ['63', C.label], [s(G.DOWN), C.grey], ['49', C.label]]) x = f.text('small', str, x, 25, col) + (str === '63' ? 3 : 1);
  f.text('small', 'TUE NOV 3', 0, 31, C.dimHead);
  const X0 = 58, lines = [['SKY', 'PT CLOUDY', C.label], ['FEELS', '53°', tempColor(53)], ['WIND', 'NW 12 MPH', C.label], ['RAIN', '20%', '#1e90ff'], ['SUNSET', '4:46 PM', '#ff7414']];
  lines.forEach(([l, v, c], i) => {
    const base = 6 + i * 6, le = f.text('small', l, X0, base, C.grey) + 1, vs = 127 - measure('small', v) + 1;
    for (let dx = le + 1; dx < vs - 2; dx += 2) f.set(dx, base - 1, hex('#3a3a3a'));
    f.text('small', v, vs, base, c);
  });
  return f;
}

// Rain bars: eight quarter-hours across the width, 16 px each, under the top bar.
function rainBars() {
  const f = new Frame(W, H);
  icon(f, 'rain', 0, 0);
  f.text('5x7', '78°', 10, 7, C.white);
  ctext(f, 'small', 'RAIN IN 25 MIN', 64, 6, '#4aa0ff');
  let x = 127;
  for (const [str, col] of [['66', C.label], [s(G.DOWN), C.grey], ['84', C.label], [s(G.UP), C.grey]]) { rtext(f, 'small', str, x, 6, col); x -= measure('small', str) + (str === '84' ? 4 : 2); }
  const mmh = [0, 0.6, 2.5, 6, 9, 5, 2, 0.8], FLOOR = 26, TALL = 16;
  mmh.forEach((v, i) => {
    const h = v ? Math.max(1, Math.round(TALL * Math.sqrt(Math.min(1, v / 10)))) : 0;
    const col = v >= 7.6 ? '#5aa8ff' : v >= 2.5 ? '#2a78e0' : '#1e4fa0';
    if (h) f.fill(i * 16 + 1, FLOOR - h + 1, 14, h, col);
  });
  f.fill(0, FLOOR + 1, 128, 1, '#1a1a1a');
  [['NOW', 0, 'l'], ['30m', 32, 'c'], ['1h', 64, 'c'], ['1h30', 96, 'c'], ['2h', 127, 'r']].forEach(([t, x, a]) =>
    (a === 'l' ? f.text('small', t, x, 32, C.dimHead) : a === 'r' ? rtext(f, 'small', t, x, 32, C.dimHead) : ctext(f, 'small', t, x, 32, C.dimHead)));
  return f;
}

// Warning: transit rows with the warning spelled out on the bottom strip.
function warningStrip() {
  const f = new Frame(W, H);
  f.text('small', 'MORSE', 0, 6, C.head);
  rtext(f, 'small', '11:16', 127, 6, C.clock);
  [['RD', 'HOWARD', [3, 8, 17, 25]], ['RD', '95TH/DAN RYAN', ['DUE', 7]]].forEach(([ln, lbl, ts], i) => {
    const top = 8 + i * 6;
    f.fill(0, top, 3, 5, LINE[ln]);
    times(f, ts, 127, top + 5, f.text('small', lbl, 5, top + 5, C.label) - 1);
  });
  f.text('small', '63°', 0, 31, C.grey);
  const msg = 'TORNADO WARNING', until = 'UNTIL 7:45 PM';
  const wu = measure('small', until), wm = measure('small', msg), wg = measure('small', s(G.FUNNEL));
  const x0 = 127 - wu - 4 - wm - 3 - wg + 1;
  f.text('small', s(G.FUNNEL), x0, 31, C.warnTornado);
  f.text('small', msg, x0 + wg + 3, 31, C.warnTornado);
  rtext(f, 'small', until, 127, 31, '#a01818');
  return f;
}

// Gradient: the same block digits, wider (7 x 6 blocks: 21 x 30), across a 128-wide gradient.
const GRG = { 0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['##.', '.#.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'], 3: ['###', '..#', '###', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'], 6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '..#', '..#', '..#'],
  8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '###'], ':': ['.', '#', '.', '#', '.'] };
function gradient(time = '7:15') {
  const f = new Frame(W, H), ring = draw.GR.ring, n = ring.length, span = draw.GR.span;
  const SX = 7, SY = 6, GAP = 5, CW = 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = Math.floor(((x * 2 + y * 3) * 1024) / (127 * 2 + 31 * 3 + 1));
    const r = Math.floor((u * span * 256) / 1024) + 2 * 256, i = Math.floor(r / 256) % n, t = (r % 256) / 256;
    f.set(x, y, hex(lerp(ring[i], ring[(i + 1) % n], t)));
  }
  const w = [...time].reduce((a, ch) => a + (ch === ':' ? CW : 3 * SX) + GAP, -GAP);
  let x = Math.floor((W - w) / 2);
  for (const ch of time) {
    const g = GRG[ch], sx = ch === ':' ? CW : SX;
    g.forEach((row, rr) => [...row].forEach((c, i) => { if (c === '#') f.fill(x + i * sx, 1 + rr * SY, sx, SY, '#000000'); }));
    x += g[0].length * sx + GAP;
  }
  return f;
}

// Messages: typewriter, big word, credits roll.
function wrap(font, text, maxW) {
  const lines = []; let cur = '';
  for (const word of text.split(/\s+/)) { const t = cur ? `${cur} ${word}` : word; if (measure(font, t) <= maxW) cur = t; else { lines.push(cur); cur = word; } }
  if (cur) lines.push(cur);
  return lines;
}
function typewriter() {
  const f = new Frame(W, H);
  // Mid-typing: the 64 board's line bases (one line 19; two 14, 24), the cursor after the last character.
  const lines = wrap('5x7', 'Gone to the gym. Back by 6, grab dinner?', 124).map((l, i, a) => (i === a.length - 1 ? l.slice(0, -7) : l));
  const bases = lines.length === 1 ? [19] : [14, 24];
  let x = 0;
  lines.forEach((l, i) => { x = f.text('5x7', l, 0, bases[i], C.amber); });
  f.fill(x + 1, bases[lines.length - 1] - 6, 4, 6, '#cc8d00');
  return f;
}
function bigWord(str = 'Go Cubs!', k = 3) {
  const f = new Frame(W, H), t = new Frame(W, 16);
  t.text('5x7', str, 0, 9, '#ffffff');
  const tw = measure('5x7', str), x0 = Math.floor((W - tw * k) / 2), top = 1;
  const A = hex('#ff3060'), Bc = hex('#ffb000'), G2 = 26;
  for (let y = 0; y < 16; y++) for (let x = 0; x < W; x++) {
    if (!t.get(x, y)[0]) continue;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const py = top + (y - 2) * k + dy, kk = Math.max(0, Math.min(1, py / G2));
      f.set(x0 + x * k + dx, py, A.map((v, i) => Math.round(v + (Bc[i] - v) * kk)));
    }
  }
  return f;
}
function credits() {
  const f = new Frame(W, H);
  const lines = wrap('5x7', 'Happy birthday, Sam! Dinner at Lula at 7. We have the back table, come hungry.', 124);
  const first = 6 - 4; // mid-roll: baselines every 10 px, the first just off the top edge
  lines.forEach((l, i) => ctext(f, '5x7', l, 64, first + i * 10, C.label));
  for (let y = 0; y < H; y++) { const k = y < 3 ? (y + 1) / 4 : y > 28 ? (32 - y) / 4 : 1; if (k < 1) for (let x = 0; x < W; x++) f.set(x, y, f.get(x, y).map((v) => Math.round(v * k))); }
  return f;
}

// Knob chooser (peek): the chosen view on top, the bar below with the chosen category and variant named.
const PEEK_ICONS = {
  transit: ['.#####.', '#.....#', '#.....#', '#######', '##...##', '.#####.', '#.....#'],
  weather: ['...#...', '.#...#.', '..###..', '#.###.#', '..###..', '.#...#.', '...#...'],
  clock: ['..###..', '.#...#.', '#..#..#', '#..##.#', '#.....#', '.#...#.', '..###..'],
  announce: ['#######', '#.....#', '#.###.#', '#.....#', '#######', '.##....', '.#.....'],
  cycle: ['..###.#', '.#...##', '#...###', '#.....#', '###...#', '##...#.', '#.###..'],
};
const PEEK_COL = { transit: LINE.RD, weather: '#ffd040', clock: '#f0e2c8', announce: '#40e090', cycle: '#3fd0e8' };
function chooser() {
  const f = new Frame(W, H), view = sevenDay();
  for (let y = 0; y < 21; y++) for (let x = 0; x < W; x++) f.set(x, y, view.get(x, y));
  const ring = ['transit', 'weather', 'clock', 'announce', 'cycle'], k = 1, vars = ['NOW', '7-DAY', 'HOURLY', 'RADAR'], vi = 1;
  const label = 'WEATHER', vname = vars[vi];
  const chosenW = 7 + 3 + measure('small', label) + 4 + measure('small', vname);
  const total = (ring.length - 1) * (7 + 6) + chosenW;
  let x = Math.floor((W - total) / 2);
  ring.forEach((cat, i) => {
    const col = PEEK_COL[cat];
    glyph(f, PEEK_ICONS[cat], x, 23, i === k ? col : scale(col, 0.3));
    if (i !== k) { x += 7 + 6; return; }
    f.fill(x, 31, 7, 1, col);
    const lx = f.text('small', label, x + 10, 29, col);
    const vx = lx + 3;
    f.text('small', vname, vx, 29, C.label);
    vars.forEach((_, j) => f.fill(vx + j * 4, 31, 3, 1, j === vi ? C.label : C.indicator));
    x += chosenW + 6;
  });
  return f;
}

// ======================= dial (knob) chooser: five bars =======================
// Same interaction as 64 (twist = category, press = next variant, rest 1 s
// commits); the chosen view fills the panel and a bar names what's chosen.
// Shown with Weather chosen, on its 7-DAY variant.
const RING = ['transit', 'weather', 'clock', 'announce', 'cycle'];
const RING_NAME = { transit: 'TRANSIT', weather: 'WEATHER', clock: 'CLOCK', announce: 'ANNOUNCE', cycle: 'CYCLE' };
const VARS = { transit: ['ROWS', 'TICKER'], weather: ['NOW', '7-DAY', 'HOURLY', 'RADAR'], clock: ['SKYLINE', '70S', 'ANALOG', 'MAP', 'GRADIENT', 'WORDS'], announce: [], cycle: [] };
const DK = 1, DV = 1;
function peekBase(top) {
  const f = new Frame(W, H), view = sevenDay();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f.set(x, y, view.get(x, y));
  f.fill(0, top, W, H - top, '#000000');
  return f;
}
// 1. Icons in place, the chosen one named with its variant (the first pass).
function dialNamed() { return chooser(); }
// 2. Wheel: the chosen category stays centered, named; neighbors' icons either side, fading, wrapping.
function dialWheel() {
  const f = peekBase(21), cat = RING[DK], col = PEEK_COL[cat], name = RING_NAME[cat], vname = VARS[cat][DV];
  const gw = 7 + 3 + measure('small', name) + 4 + measure('small', vname), gx = Math.floor((W - gw) / 2);
  glyph(f, PEEK_ICONS[cat], gx, 23, col);
  f.fill(gx, 31, 7, 1, col);
  const vx = f.text('small', name, gx + 10, 29, col) + 3;
  f.text('small', vname, vx, 29, C.label);
  VARS[cat].forEach((_, j) => f.fill(vx + j * 4, 31, 3, 1, j === DV ? C.label : C.indicator));
  const n = RING.length;
  for (const d of [-2, -1, 1, 2]) {
    const c2 = RING[((DK + d) % n + n) % n], k = Math.abs(d) === 1 ? 0.45 : 0.2;
    const x = d < 0 ? gx - 6 - 7 + (d + 1) * 13 : gx + gw + 6 + (d - 1) * 13;
    glyph(f, PEEK_ICONS[c2], x, 23, scale(PEEK_COL[c2], k));
  }
  return f;
}
// 3. Variant strip: the chosen category's icon, then its variants as words (chosen white, rest dim);
// where the category sits on the ring as a column of dots at the right edge.
function dialStrip() {
  const f = peekBase(21), cat = RING[DK], col = PEEK_COL[cat];
  glyph(f, PEEK_ICONS[cat], 2, 23, col);
  f.fill(2, 31, 7, 1, col);
  let x = 14;
  VARS[cat].forEach((v, j) => { x = f.text('small', v, x, 29, j === DV ? C.white : '#4a4a4a') + 5; });
  RING.forEach((c2, i) => f.fill(126, 22 + i * 2, 1, 1, i === DK ? PEEK_COL[c2] : scale(PEEK_COL[c2], 0.3)));
  return f;
}
// 4. Chip: no bar. A black chip at the bottom center with the name and variant, and
// one dot per category under it in its color (the chosen one full, the rest dim).
function dialChip() {
  const f = new Frame(W, H), view = sevenDay();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f.set(x, y, view.get(x, y));
  const cat = RING[DK], col = PEEK_COL[cat], name = RING_NAME[cat], vname = VARS[cat][DV];
  const tw = measure('small', name) + 4 + measure('small', vname), cx = Math.floor((W - tw) / 2);
  f.fill(cx - 3, 22, tw + 6, 10, '#000000');
  const vx = f.text('small', name, cx, 28, col) + 3;
  f.text('small', vname, vx, 28, C.label);
  const dx = Math.floor(W / 2 - (RING.length * 3 - 1) / 2);
  RING.forEach((c2, i) => f.fill(dx + i * 3, 30, 2, 1, i === DK ? PEEK_COL[c2] : scale(PEEK_COL[c2], 0.3)));
  return f;
}
// 5. Two rows: every category's icon spread across the width (the chosen one underlined),
// and under them the chosen category's variants as words. The bar takes rows 17-31.
function dialTwoRows() {
  const f = peekBase(17);
  RING.forEach((c2, i) => {
    const x = 6 + i * 26;
    glyph(f, PEEK_ICONS[c2], x, 18, i === DK ? PEEK_COL[c2] : scale(PEEK_COL[c2], 0.3));
    if (i === DK) f.fill(x, 26, 7, 1, PEEK_COL[c2]);
  });
  let x = 6;
  VARS[RING[DK]].forEach((v, j) => { x = f.text('small', v, x, 32, j === DV ? C.white : '#4a4a4a') + 6; });
  return f;
}

async function main() {
  const MOCKS = [
    ['redrawn', 'transit-rows', 'Transit rows', 'Full CTA names and up to five times a row; the header keeps the station and clock.', '', transitRows()],
    ['redrawn', 'transit-split', 'Transit, by direction', 'Belmont split north | south, two times or more per line. The station and clock move to the bottom.', 'Real Belmont times (Oct 3, 11:16 PM, no Purple).', transitSplit()],
    ['redrawn', 'ticker', 'Ticker', 'After the CTA platform signs: the row number in the grey column, the full destination, the time at the far right, then the live-train signal, or a clock for a scheduled train (row 2).', 'Real Morse times; the Howard train is marked scheduled here to show the clock.', ticker()],
    ['redrawn', 'chrono', 'Chronological, two columns', 'Eight trains instead of four, with full names (FOREST PK, 54/CERMAK).', 'Real Clark/Lake times.', chrono()],
    ['redrawn', 'transit-five', 'Busy station: five rows', 'Clark/Lake\'s five destinations as destination rows with full names and up to four times; the header drops to make room, as it does on the 64 board.', 'Real Clark/Lake times.', transitFive()],
    ['redrawn', 'transit-columns', 'Busy station: two columns', 'Eight destinations in two columns of four under the header: Clark/Lake at rush. With the 64 board\'s short names (HARLEM, 63RD, 54/CRMK) every row keeps three times.', 'Made-up times.', transitColumns()],
    ['redrawn', 'transit-byline', 'Busy station: one row per line', 'Five lines on five rows; a line with two destinations puts the second at the halfway mark (Blue: O\'HARE and FOREST). Short names, as on the 64 board.', 'Made-up times. Seven destinations, no paging.', transitByLine()],
    ['redrawn', 'seven-day', '7-day forecast', 'Seven columns with highs and lows; the 64 screen shows five days and highs only.', 'NWS gives seven days already.', sevenDay()],
    ['redrawn', 'seven-day-top', '7-day, top bar on', 'The current-conditions bar as an option: with it on, the lows drop out.', '', sevenDay({ top: true })],
    ['redrawn', 'hourly', 'Hourly, 24 hours', 'Eight 3-hour steps under the top bar.', 'The server builds 4 slots today (HOUR_STEPS); the NWS hourly feed covers more.', hourly()],
    ['redrawn', 'hourly-notop', 'Hourly, top bar off', 'Without the bar the freed rows carry each slot\'s rain chance (bright from 20%).', '', hourly({ top: false })],
    ['redrawn', 'line-score', 'Baseball line score', 'Runs by inning, R H E, then the count, outs, pitch count and bases.', 'The innings come in the linescore the server already fetches; the pitch count would need a field added.', lineScore()],
    ['redrawn', 'note', 'Message note', 'About 21 characters a line in 5x7 instead of 10.', '', note()],
    ['more', 'key-layout', 'Key layout', 'The column key on the top row (trains to, min), with the station and clock between them instead of moving to the bottom.', 'Real Belmont times.', keyLayout()],
    ['more', 'alert-rows', 'Alerts on rows', 'The full destination, the red alert circle, then the alert\'s short label in red. At 64 the name is cut to fit the circle and there\'s no label.', 'The label needs a new payload field: today the board only knows that a line has a major alert.', alertRows()],
    ['more', 'overnight', 'Overnight', 'The owl, big clock and NO TRAINS as on 64; the right side shows now and tomorrow. No data and stale keep this layout with NO DATA and the red line across the top.', 'Tomorrow comes from the NWS forecast the board already gets.', overnight()],
    ['more', 'now', 'Current conditions', 'A 2x icon and the temperature in the clock digits, high/low and date under them; the readout (sky, feels, wind, rain, sunset) beside, with dot leaders.', '', nowReadout()],
    ['more', 'rain-bars', 'Rain bars', 'The eight quarter-hours across the full width, 16 px each, with time marks under them (lowercase h and m); light, moderate and heavy in three blues.', 'No data source today: WeatherAPI has no 15-minute precipitation, so the 64 rain bars don\'t show either.', rainBars()],
    ['more', 'warning', 'Warning strip', 'The warning spelled out on the bottom strip: funnel, TORNADO WARNING and the expiry, with the temperature at left.', 'The 64 strip has room for WARNING only. Blinks as it does now.', warningStrip()],
    ['more', 'gradient', 'Gradient clock', 'The same block digits widened to 21 x 30 (7 x 6 blocks) so the time fills the width as it does at 64; the gradient spans all 128 columns.', '12:58 is 108 px wide.', gradient()],
    ['more', 'typewriter', 'Typewriter', 'About 21 characters a line instead of 10, so most notes fit in two lines. Shown mid-typing.', '', typewriter()],
    ['more', 'big-word', 'Big word', 'At 3x instead of 2x: 21 px letters, up to about 7 characters; longer words drop to 2x (about 10).', '', bigWord()],
    ['more', 'credits', 'Credits roll', 'Wider lines mean fewer of them; the roll and its fade at the edges stay the same.', 'Mid-roll.', credits()],
    ['dial', 'dial-1-named', '1 · Icons in place, chosen one named', 'The 64 bar with room to spare: every category\'s icon stays put, the chosen one adds its name and variant, with one pip per variant under the variant name.', 'The first pass from the more-screens round.', dialNamed()],
    ['dial', 'dial-2-wheel', '2 · Wheel', 'The chosen category stays centered, named, with its neighbors\' icons either side, fading with distance and wrapping; twisting slides the strip under a fixed center.', '', dialWheel()],
    ['dial', 'dial-3-strip', '3 · Variant strip', 'The bar shows what a press does: the chosen category\'s icon, then all its variants as words, the chosen one white. Where the category sits on the ring is a column of five dots at the right edge.', 'Twisting swaps the whole strip; Announce and Cycle show the icon alone. Clock\'s six faces only fit with short names (SKY 70S ANALOG MAP GRAD WORDS).', dialStrip()],
    ['dial', 'dial-4-chip', '4 · Chip, no bar', 'Most of the view stays visible: a black chip at the bottom center names the category and variant, with one dot per category under it in its color.', 'Same idea as the radar\'s time chip.', dialChip()],
    ['dial', 'dial-5-tworows', '5 · Two rows', 'Every category\'s icon spread across the width, the chosen one underlined, and under them the chosen category\'s variants as words.', 'The bar takes rows 17–31, half the panel. Clock\'s six faces need short names to fit, as in 3.', dialTwoRows()],
  ];

  const q5 = (v) => v & 0xf8;
  fs.mkdirSync(OUT, { recursive: true });
  for (const m of MOCKS) {
    const fr = m[5];
    const q = new Frame(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) q.set(x, y, fr.get(x, y).map(q5));
    fs.writeFileSync(path.join(OUT, `${m[1]}.png`), q.toPNG(10));
  }
  const GAP = 4, TH = 8, COLS = 2;
  const sheet = new Frame(COLS * W + (COLS + 1) * GAP, Math.ceil(MOCKS.length / COLS) * (TH + H + GAP) + GAP);
  MOCKS.forEach((m, i) => {
    const ox = GAP + (i % COLS) * (W + GAP), oy = GAP + Math.floor(i / COLS) * (TH + H + GAP);
    sheet.text('small', m[2].toUpperCase(), ox, oy + 5, '#5a5a5a');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sheet.set(ox + x, oy + TH + y, m[5].get(x, y).map(q5));
  });
  fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(5));
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(MOCKS.map(([kind, id, title, desc, note]) => ({ kind, id, title, desc, note })), null, 1));
  console.log('wrote docs/board/mockups/w128/');
}
main().catch((e) => { console.error(e); process.exit(1); });
