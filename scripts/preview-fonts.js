#!/usr/bin/env node
'use strict';
// Renders font preview PNGs into docs/board/previews/: glyph sheets for each
// board font plus a few 64x32 mock panels (made-up times) showing the fonts in
// context. Run after scripts/build-fonts.js.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { measure, ligatures } = require('../server/board/fonts');
const G = require('../server/board/glyphs');
const { ICONS, ALERT_BANG, drawIcon } = require('../server/board/icons');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'previews');
fs.mkdirSync(OUT, { recursive: true });
const save = (name, frame, scale) => {
  fs.writeFileSync(path.join(OUT, name), frame.toPNG(scale));
  console.log('wrote', name);
};

const C = {
  label: '#d8d8d8', clock: '#cccccc', amber: '#ffb000', dimAmber: '#664600', grey: '#8f8f8f',
  head: '#808080', index: '#2d2d2d', white: '#ffffff', red: '#ff2020',
  yellow: '#ffd800', orange: '#ff8000', divider: '#333333',
};
const LINE = { RD: '#c60c30', BL: '#00a1de', GR: '#009b3a', BR: '#62361b', PR: '#522398', YL: '#f9e300', PK: '#e27ea6', OR: '#f9461c' };
const dim = (c, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
const s = (cp) => String.fromCodePoint(cp);

// ---- glyph sheets ----

function sheet(fontName, lineHeight, baselineOffset, extra, chars) {
  const lines = [];
  if (chars) lines.push(chars);
  else for (let c = 32; c < 127; c += 24) lines.push(Array.from({ length: Math.min(24, 127 - c) }, (_, i) => String.fromCharCode(c + i)).join(' '));
  if (extra) lines.push(extra);
  const width = Math.max(...lines.map((l) => measure(fontName, l))) + 4;
  const f = new Frame(width, lines.length * lineHeight + 2);
  lines.forEach((l, i) => f.text(fontName, l, 2, 1 + i * lineHeight + baselineOffset, C.label));
  return f;
}

save('sheet-small.png', sheet('small', 8, 6, `${s(G.BOLT)} ${s(G.FUNNEL)} ${s(G.ALERT_DISC)} ${s(G.ALERT_MARK)} ${s(G.UP)} ${s(G.DOWN)}`), 8);
save('sheet-5x7.png', sheet('5x7', 10, 7, `${s(G.TT)} ${s(G.MIN)} ${ligatures('Cottage')}`), 8);
save('sheet-clock.png', sheet('clock', 17, 13, '12:34', '0123456789'), 8);

// ---- mock panels ----

// Right-align text so its last pixel is at column `right`.
const rtext = (f, font, str, right, base, color) => f.text(font, str, right - measure(font, str) + 1, base, color);

// Arrival times: right-aligned as a group (not columns), first amber, the rest
// dim. TIME_GAP is the space between times.
const TIME_GAP = 3;
function drawTimes(f, times, right, base) {
  let x = right;
  for (let k = times.length - 1; k >= 0; k--) {
    const w = measure('small', times[k]);
    f.text('small', times[k], x - w + 1, base, k === 0 ? C.amber : C.dimAmber);
    x -= w + TIME_GAP;
  }
}

// Warning tag: icon, 3px gap, word.
const TAG_GAP = 3;
function drawTag(f, icon, word, x, base, color) {
  const after = f.text('small', s(icon), x, base, color); // advance already includes 1px
  return f.text('small', word, after + TAG_GAP - 1, base, color);
}
const tagWidth = (icon, word) => measure('small', s(icon)) + TAG_GAP + measure('small', word);

// Weather row: divider on row 22, icon rows 24-31, temp after the icon,
// condition word (or warning tag) right-aligned.
// `tag` is either a condition word or [glyph, word, color] for a warning.
function drawWeatherRow(f, icon, temp, tag, top = 24, divider = true) {
  if (divider) f.fill(0, top - 2, 64, 1, C.divider);
  drawIcon(f, icon, 0, top);
  const base = top + 7; // text on rows top+2..top+6
  f.text('small', temp, 10, base, C.label);
  if (typeof tag === 'string') {
    rtext(f, 'small', tag, 63, base, C.label);
  } else {
    const [glyph, word, color] = tag;
    drawTag(f, glyph, word, 63 - tagWidth(glyph, word) + 1, base, color);
  }
}

// `alert` rows draw the "!" blink state instead of the solid block.
function transitRows(f, rows, tops) {
  rows.forEach(([ln, label, times, alert], i) => {
    const top = tops[i];
    const base = top + 5;
    if (alert) {
      ALERT_BANG.forEach((r, j) => [...r].forEach((c, k) => { if (c === '#') f.fill(k, top + j, 1, 1, LINE[ln]); }));
    } else {
      f.fill(0, top, 3, 5, LINE[ln]);
    }
    f.text('small', label, 5, base, C.label);
    drawTimes(f, times, 63, base);
  });
}

// Transit: header on, weather off -> 4 rows, pitch 6, rows at 9-27 under the header (no band).
{
  const f = new Frame();
  f.text('small', 'MORSE', 0, 6, C.head);
  rtext(f, 'small', '9:41', 63, 6, C.head);
  transitRows(f, [
    ['RD', 'HOWARD', ['DUE', '8', '15']],
    ['RD', '95TH', ['3', '11', '19']],
    ['BL', 'JEFF PK', ['6', '14']],
    ['GR', 'COTTAGE', ['12', '27']],
  ], [9, 15, 21, 27]);
  save('mock-transit.png', f, 10);
}

// Transit with a Red Line alert: both Red rows in the "!" half of the blink.
{
  const f = new Frame();
  f.text('small', 'MORSE', 0, 6, C.head);
  rtext(f, 'small', '9:41', 63, 6, C.head);
  transitRows(f, [
    ['RD', 'HOWARD', ['DUE', '8', '15'], true],
    ['RD', '95TH', ['3', '11', '19'], true],
    ['BL', 'JEFF PK', ['6', '14']],
    ['GR', 'COTTAGE', ['12', '27']],
  ], [9, 15, 21, 27]);
  save('mock-transit-alert.png', f, 10);
}

// Transit: header off, weather on -> 3 rows in rows 0-20 (pitch 8 assumed;
// the spec doesn't give this case's pitch).
{
  const f = new Frame();
  transitRows(f, [
    ['RD', 'HOWARD', ['DUE', '8', '15']],
    ['RD', '95TH', ['3', '11', '19']],
    ['GR', 'COTTAGE', ['12', '27']],
  ], [0, 8, 16]);
  drawWeatherRow(f, 'storm', '54\u00b0', [G.BOLT, 'WATCH', C.yellow]);
  save('mock-transit-weather.png', f, 10);
}

// Ticker: two 12px rows with a 1px gap, 5px index column, 55% row fill.
{
  const f = new Frame();
  f.text('small', 'MORSE', 0, 6, C.head);
  rtext(f, 'small', '9:41', 63, 6, C.head);
  const rows = [
    { ln: 'RD', dest: 'Howard', min: '4', idx: '1', alert: false },
    { ln: 'GR', dest: 'Cottage', min: '12', idx: '2', alert: true },
  ];
  rows.forEach((r, i) => {
    const top = 7 + i * 13; // rows 7-18 and 20-31
    f.fill(0, top, 5, 12, C.index);
    f.fill(5, top, 59, 12, dim(LINE[r.ln], 0.55));
    if (r.alert) {
      f.text('small', s(G.ALERT_DISC), 0, top + 9, C.red);
      f.text('small', s(G.ALERT_MARK), 0, top + 9, C.white);
    } else {
      f.text('small', r.idx, 1, top + 9, C.label);
    }
    const base = top + 9;
    f.text('5x7', ligatures(r.dest), 7, base, C.white);
    const minW = measure('5x7', s(G.MIN));
    f.text('5x7', s(G.MIN), 62 - minW + 1, base, C.white);
    rtext(f, '5x7', r.min, 62 - minW - 2, base, C.white);
  });
  save('mock-ticker.png', f, 10);
}

// Overnight clock with the weather row.
{
  const f = new Frame();
  const clock = '12:34';
  const w = measure('clock', clock);
  f.text('clock', clock, Math.floor((64 - w) / 2), 13, C.clock);
  const nt = 'NO TRAINS';
  f.text('small', nt, Math.floor((64 - measure('small', nt)) / 2), 20, dim(C.label, 0.5));
  drawWeatherRow(f, 'storm', '54\u00b0', [G.FUNNEL, 'WARNING', C.red]);
  save('mock-overnight.png', f, 10);
}

// Warning tags and the ticker alert circle, larger.
{
  const f = new Frame(48, 20);
  const tags = [[G.BOLT, 'WATCH', C.yellow], [G.BOLT, 'WARNING', C.orange], [G.FUNNEL, 'WARNING', C.red]];
  tags.forEach(([icon, word, color], i) => drawTag(f, icon, word, 1, 6 + i * 6, color));
  f.fill(42, 1, 5, 12, C.index);
  f.text('small', s(G.ALERT_DISC), 42, 10, C.red);
  f.text('small', s(G.ALERT_MARK), 42, 10, C.white);
  save('mock-icons.png', f, 16);
}

// Weather icons: large sheet, and each one in a weather row (made-up temps;
// condition words are placeholders until the word list is decided).
{
  const names = Object.keys(ICONS);
  const sheetF = new Frame(names.length * 10, 10);
  names.forEach((n, i) => drawIcon(sheetF, n, 1 + i * 10, 1));
  save('sheet-icons.png', sheetF, 20);

  const words = {
    sun: ['72°', 'SUNNY'], moon: ['58°', 'CLEAR'], pcloudy_day: ['66°', 'PT CLOUDY'],
    pcloudy_night: ['55°', 'PT CLOUDY'], cloudy: ['48°', 'CLOUDY'], rain: ['51°', 'RAIN'],
    ice: ['31°', 'FRZ RAIN'], snow: ['24°', 'SNOW'], storm: ['79°', 'STORMS'], fog: ['44°', 'FOG'],
  };
  const rowsF = new Frame(64, names.length * 10);
  names.forEach((n, i) => drawWeatherRow(rowsF, n, words[n][0], words[n][1], 1 + i * 10, false));
  save('mock-weather-rows.png', rowsF, 10);
}

// Weather screen (radar screen without rain), drawn by draw.js: normal and
// with each warning/watch on the bottom line (made-up conditions).
{
  const { render } = require('../server/board/render');
  const wx = { icon: 'pcloudy_day', temp: 57, word: 'PT CLOUDY', hi: 63, lo: 49, feels: 53, wind: 'NW 12', pop: 20 };
  const storm = { ...wx, icon: 'storm', word: 'STORMS', pop: 80 };
  const states = [[wx, null], [storm, { kind: 'svr', lvl: 'watch' }], [storm, { kind: 'svr', lvl: 'warning' }], [storm, { kind: 'tor', lvl: 'warning' }]];
  const f = new Frame(64 * 2 + 4, 32 * 2 + 4);
  states.forEach(([w, warn], i) => {
    const panel = render({ now: 0, bright: 100, warn, radar: { on: false, frames: [], ft: [], timeBox: null, split: false, wx: w } }, { screen: 'weather' });
    const ox = (i % 2) * 68, oy = Math.floor(i / 2) * 36;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) f.set(ox + x, oy + y, panel.get(x, y));
  });
  save('mock-weather-screen.png', f, 8);
}

// Weather screen, 5-day layout (wxView '5day'), drawn by draw.js: a mild
// week, a heat wave and a cold snap (three-character highs drawn tight).
{
  const { render } = require('../server/board/render');
  const days = (list) => list.map(([d, hi, icon]) => ({ d, hi, icon }));
  const states = [
    { icon: 'pcloudy_day', temp: 57, hi: 63, lo: 49, days: days([['SA', 71, 'sun'], ['SU', 78, 'sun'], ['MO', 66, 'rain'], ['TU', 52, 'cloudy'], ['WE', 60, 'pcloudy_day']]) },
    { icon: 'sun', temp: 97, hi: 101, lo: 82, days: days([['SA', 99, 'sun'], ['SU', 104, 'sun'], ['MO', 100, 'pcloudy_day'], ['TU', 92, 'storm'], ['WE', 86, 'pcloudy_day']]) },
    { icon: 'moon', temp: -8, hi: 2, lo: -14, days: days([['SA', -3, 'snow'], ['SU', -12, 'sun'], ['MO', -6, 'pcloudy_day'], ['TU', 9, 'snow'], ['WE', 21, 'cloudy']]) },
  ];
  const f = new Frame(64 * 3 + 8, 32);
  states.forEach((w, i) => {
    const panel = render({ now: 0, bright: 100, warn: null, radar: { on: false, frames: [], ft: [], timeBox: null, split: false, wx: w } }, { screen: 'weather' });
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) f.set(i * 68 + x, y, panel.get(x, y));
  });
  save('mock-weather-5day.png', f, 8);
}

// Weather screen, rain bars (wxRain 'bars'), drawn by draw.js: rain breaking,
// a downpour due, snow due and snow falling (made-up data).
{
  const { render } = require('../server/board/render');
  const R = (snow, now, title, h, l) => ({ snow, now, title, h, l });
  const states = [
    { icon: 'rain', temp: 54, hi: 61, lo: 49, rain: R(0, 1, 'BREAK IN 30 MIN', [5, 4, 0, 0, 6, 8, 7, 5], [2, 1, 0, 0, 2, 2, 2, 2]) },
    { icon: 'pcloudy_day', temp: 78, hi: 84, lo: 66, rain: R(0, 0, 'RAIN IN 25 MIN', [0, 5, 9, 10, 10, 8, 5, 3], [0, 2, 3, 3, 3, 2, 2, 1]) },
    { icon: 'cloudy', temp: 30, hi: 33, lo: 24, rain: R(1, 0, 'SNOW IN 40 MIN', [0, 0, 4, 6, 7, 9, 8, 6], [0, 0, 1, 2, 2, 3, 2, 2]) },
    { icon: 'snow', temp: 28, hi: 31, lo: 22, rain: R(1, 1, 'ENDS IN 40 MIN', [5, 7, 9, 10, 9, 8, 7, 5], [2, 2, 3, 3, 3, 3, 2, 2]) },
  ];
  const f = new Frame(64 * 2 + 4, 32 * 2 + 4);
  states.forEach((w, i) => {
    const panel = render({ now: 0, bright: 100, warn: null, radar: { on: false, frames: [], ft: [], timeBox: null, split: false, wx: w } }, { screen: 'weather' });
    const ox = (i % 2) * 68, oy = Math.floor(i / 2) * 36;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) f.set(ox + x, oy + y, panel.get(x, y));
  });
  save('mock-weather-rain.png', f, 8);
}

// Weather screen, hourly layout (wxView 'hourly'), drawn by draw.js (made-up data).
{
  const { render } = require('../server/board/render');
  const hrs = (list) => list.map(([h, icon, t]) => ({ h, icon, t }));
  const states = [
    { icon: 'pcloudy_day', temp: 77, hi: 78, lo: 58, hours: hrs([['3P', 'sun', 78], ['6P', 'cloudy', 76], ['9P', 'pcloudy_night', 69], ['12A', 'moon', 63]]) },
    { icon: 'sun', temp: 97, hi: 101, lo: 82, hours: hrs([['10P', 'storm', 104], ['1A', 'fog', 100], ['4A', 'ice', 92], ['7A', 'snow', 88]]) },
  ];
  const f = new Frame(64 * 2 + 4, 32);
  states.forEach((w, i) => {
    const panel = render({ now: 0, bright: 100, warn: null, radar: { on: false, frames: [], ft: [], timeBox: null, split: false, wx: w } }, { screen: 'weather' });
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) f.set(i * 68 + x, y, panel.get(x, y));
  });
  save('mock-weather-hourly.png', f, 8);
}
