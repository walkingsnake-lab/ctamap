'use strict';
// Overnight clock face options, drawn with the real board fonts and the real
// weather row. Writes docs/board/previews/mock-clock-options.png.
//   node scripts/mock-clocks.js

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const R = require('../server/board/render');
const { Frame } = require('../server/board/raster');

const OUT = path.join(__dirname, '../docs/board/previews/mock-clock-options.png');
const CLOCK = R.C.clock, GREY = '#8f8f8f', NT = R.C.noTrains;
const WX = { icon: 'moon', temp: 52, word: 'CLEAR' };
const TIMES = [['1:42', 'AM'], ['12:58', 'AM']];
const AREA = 22; // rows 0-21 above the weather divider

// ---- custom bitmap digits (6x10, 2px strokes) ----
const CHUNKY = {
  0: ['.####.', '######', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '######', '.####.'],
  1: ['..##..', '.###..', '####..', '..##..', '..##..', '..##..', '..##..', '..##..', '######', '######'],
  2: ['.####.', '######', '##..##', '....##', '...###', '..###.', '.###..', '###...', '######', '######'],
  3: ['.####.', '######', '##..##', '....##', '..###.', '..###.', '....##', '##..##', '######', '.####.'],
  4: ['##..##', '##..##', '##..##', '##..##', '######', '######', '....##', '....##', '....##', '....##'],
  5: ['######', '######', '##....', '#####.', '######', '....##', '....##', '##..##', '######', '.####.'],
  6: ['.####.', '######', '##....', '#####.', '######', '##..##', '##..##', '##..##', '######', '.####.'],
  7: ['######', '######', '....##', '...###', '..###.', '..##..', '..##..', '..##..', '..##..', '..##..'],
  8: ['.####.', '######', '##..##', '##..##', '.####.', '######', '##..##', '##..##', '######', '.####.'],
  9: ['.####.', '######', '##..##', '##..##', '######', '.#####', '....##', '....##', '######', '.####.'],
};

// Outline: 1px ring around the chunky digit (dilate, subtract). 8x12.
function outline(g) {
  const h = g.length + 2, w = g[0].length + 2;
  const on = (x, y) => y >= 1 && y <= g.length && x >= 1 && x <= g[0].length && g[y - 1][x - 1] === '#';
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
    if (on(x, y)) return '.';
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (on(x + i, y + j)) return '#';
    return '.';
  }).join(''));
}
const OUTLINE = Object.fromEntries(Object.entries(CHUNKY).map(([k, g]) => [k, outline(g)]));

function sprite(f, g, x, y, color) {
  g.forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') f.fill(x + i, y + j, 1, 1, color); }));
}

// Bitmap-font clock: digits from `set`, 2x2 square colon, 1px tracking (2px for outline).
function bitmapClock(set, colonRows, track) {
  const dw = set[0][0].length, dh = set[0].length;
  const width = (t) => [...t].reduce((w, c) => w + (c === ':' ? 2 : dw) + track, -track);
  const draw = (f, t, x, y, color) => {
    for (const c of t) {
      if (c === ':') { for (const r of colonRows) f.fill(x, y + r, 2, 2, color); x += 2 + track; }
      else { sprite(f, set[c], x, y, color); x += dw + track; }
    }
  };
  return { width, draw, h: dh };
}
const chunky = bitmapClock(CHUNKY, [2, 6], 1);
const outlined = bitmapClock(OUTLINE, [3, 7], 1);

// 5x7 at 2x: draw into a scratch frame, then double each pixel.
function big5x7(f, t, x, y, color) {
  const s = new Frame();
  s.text('5x7', t, 0, 7, color);
  for (let j = 0; j < 7; j++) for (let i = 0; i < 32; i++) {
    const p = s.get(i, j);
    if (p[0] || p[1] || p[2]) f.fill(x + i * 2, y + j * 2, 2, 2, color);
  }
}

const center = (w) => Math.floor((64 - w) / 2);
const ctext = (f, font, t, base, color) => f.text(font, t, center(R.measure(font, t)), base, color);

const OPTIONS = [
  ['A  CURRENT: 9X15 BOLD + NO TRAINS', (f, t) => {
    const top = Math.floor((AREA - 18) / 2);
    ctext(f, 'clock', t, top + 10, CLOCK);
    ctext(f, 'small', 'NO TRAINS', top + 18, NT);
  }],
  ['B  9X15 + AM/PM BESIDE', (f, t, ap) => {
    const top = Math.floor((AREA - 18) / 2);
    const w = R.measure('clock', t) + 2 + R.measure('small', ap);
    const x = f.text('clock', t, center(w), top + 10, CLOCK);
    f.text('small', ap, x + 1, top + 10, GREY);
    ctext(f, 'small', 'NO TRAINS', top + 18, NT);
  }],
  ['C  9X15 + DATE (NO TRAINS DROPPED)', (f, t) => {
    const top = Math.floor((AREA - 18) / 2);
    ctext(f, 'clock', t, top + 10, CLOCK);
    ctext(f, 'small', 'MON OCT 5', top + 18, GREY);
  }],
  ['D  CHUNKY 6X10', (f, t) => {
    const top = Math.floor((AREA - 18) / 2);
    chunky.draw(f, t, center(chunky.width(t)), top, CLOCK);
    ctext(f, 'small', 'NO TRAINS', top + 18, NT);
  }],
  ['E  OUTLINE 8X12', (f, t) => {
    const top = Math.floor((AREA - 20) / 2);
    outlined.draw(f, t, center(outlined.width(t)), top, CLOCK);
    ctext(f, 'small', 'NO TRAINS', top + 20, NT);
  }],
  ['F  5X7 AT 2X (10X14), NO LABEL', (f, t) => {
    const w = R.measure('5x7', t) * 2 + 1;
    big5x7(f, t, center(w), Math.floor((AREA - 14) / 2), CLOCK);
  }],
];

function panel(draw, t, ap) {
  const now = Date.UTC(2026, 9, 5, 6, 42) / 1000;
  const f = R.renderTransit({ rows: [], wx: WX }, { now });
  f.fill(0, 0, 64, AREA, '#000000');
  draw(f, t, ap);
  return PNG.sync.read(f.toPNG(6));
}

// Sheet: one row per option (label strip + two panels).
const PW = 384, PH = 192, GAP = 16, LABEL = 28;
const W = GAP + 2 * (PW + GAP), H = OPTIONS.length * (LABEL + PH + GAP) + GAP;
const sheet = new PNG({ width: W, height: H });
for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set([24, 24, 24, 255], i);

function blit(src, ox, oy) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const s = (y * src.width + x) * 4, d = ((oy + y) * W + ox + x) * 4;
    sheet.data.set(src.data.subarray(s, s + 4), d);
  }
}
function label(t, ox, oy) {
  const f = new Frame(200, 8);
  f.text('small', t, 0, 6, '#d8d8d8');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 200; x++) {
    const p = f.get(x, y);
    if (!p[0]) continue;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) sheet.data.set([220, 220, 220, 255], ((oy + y * 3 + j) * W + ox + x * 3 + i) * 4);
  }
}

OPTIONS.forEach(([name, draw], r) => {
  const y = GAP + r * (LABEL + PH + GAP);
  label(name, GAP, y + 4);
  TIMES.forEach(([t, ap], c) => blit(panel(draw, t, ap), GAP + c * (PW + GAP), y + LABEL));
});

fs.writeFileSync(OUT, PNG.sync.write(sheet));
console.log(OUT);
