#!/usr/bin/env node
'use strict';
// Builds the LED board fonts from the source BDFs in scripts/fonts-src/
// (from hzeller/rpi-rgb-led-matrix/fonts) into server/board/fonts/.
//
//   node scripts/build-fonts.js
//
// Outputs (all BDF; the board build converts them to PCF):
//   board-small.bdf  Tom Thumb 3x5, proportional, + bolt, funnel, alert circle, arrows
//   board-5x7.bdf    X11 5x7, proportional, + "tt" ligature, "min" glyph
//   board-clock.bdf  X11 9x15 Bold, digits + square-dot colon (monospace)
//   board-vcr.bdf    8x11 digits + colon after VCR OSD Neue (clock screen, seventies face)
//   board-d17.bdf    17-row digits from UW ttyp0 Bold 30 (clock screen, big digits face)
//   board-d13.bdf    13-row digits from UW ttyp0 Bold 22 (clock screen, day/date face)
//   board-d23.bdf    23-row digits from UW ttyp0 Bold 40 (clock screen, wide big digits face)
//
// Rules (see docs/board/design-spec.md §3):
//   - Proportional: each glyph is trimmed to its ink columns, advance = ink + 1.
//   - Digits stay tabular (shared cell width) so rolling digits don't shift.
//   - Spaces: 2px small, 3px 5x7.
//   - Kept: printable ASCII, Latin-1 (accented letters, ° £ ¿ ...), and the
//     punctuation phones type (smart quotes, dashes, …, •, €), plus the
//     custom glyphs. Tom Thumb lacks the smart quotes and dashes; they're
//     added below.

const fs = require('fs');
const path = require('path');
const { loadBDF, writeBDF } = require('../server/board/bdf');
const G = require('../server/board/glyphs');

const SRC = path.join(__dirname, 'fonts-src');
const OUT = path.join(__dirname, '..', 'server', 'board', 'fonts');

// ---- helpers ----

// Pixel art: array of strings, '#' = lit.
const art = (lines) => lines.map((l) => [...l].map((c) => (c === '#' ? 1 : 0)));

function glyph(name, code, rows, yoff, dw) {
  const w = rows[0].length;
  return { name, code, dw: dw != null ? dw : w + 1, bbx: [w, rows.length, 0, yoff], rows };
}

function inkCols(rows) {
  let lo = Infinity, hi = -1;
  for (const r of rows) r.forEach((b, c) => { if (b) { lo = Math.min(lo, c); hi = Math.max(hi, c); } });
  return hi < 0 ? null : [lo, hi];
}

// Trim a glyph to columns [lo, hi] and set its advance.
function trimCols(g, lo, hi, dw) {
  // Expand rows to full bbx width first (rows may be shorter than bbx w).
  const rows = g.rows.map((r) => {
    const full = [];
    for (let c = 0; c < g.bbx[0]; c++) full.push(r[c] || 0);
    // Shift by xoff so column indices are relative to the origin.
    return full;
  });
  const xo = g.bbx[2];
  const out = rows.map((r) => {
    const row = [];
    for (let c = lo; c <= hi; c++) row.push(r[c - xo] || 0);
    return row;
  });
  return { ...g, dw, bbx: [hi - lo + 1, g.bbx[1], 0, g.bbx[3]], rows: out };
}

// Ink columns in origin coordinates (accounts for xoff).
function inkRange(g) {
  const r = inkCols(g.rows);
  return r ? [r[0] + g.bbx[2], r[1] + g.bbx[2]] : null;
}

function makeProportional(font, spaceWidth) {
  const digits = [...'0123456789'].map((d) => font.glyphs.get(d.charCodeAt(0)));
  let dlo = Infinity, dhi = -1;
  for (const d of digits) { const r = inkRange(d); dlo = Math.min(dlo, r[0]); dhi = Math.max(dhi, r[1]); }

  for (const [code, g] of font.glyphs) {
    if (code === 32) {
      font.glyphs.set(code, { ...g, dw: spaceWidth, bbx: [1, 1, 0, 0], rows: [[0]] });
      continue;
    }
    if (code >= 0x30 && code <= 0x39) {
      font.glyphs.set(code, trimCols(g, dlo, dhi, dhi - dlo + 2));
      continue;
    }
    const r = inkRange(g);
    if (!r) continue;
    font.glyphs.set(code, trimCols(g, r[0], r[1], r[1] - r[0] + 2));
  }
}

function keepOnly(font, codes) {
  for (const code of [...font.glyphs.keys()]) if (!codes.has(code)) font.glyphs.delete(code);
}

const ascii = new Set(Array.from({ length: 95 }, (_, i) => 32 + i));
// Latin-1 without the soft hyphen (U+00AD, invisible in text), and the
// General Punctuation characters phones substitute for ASCII ones. The S3's
// packed fonts cover U+0020-U+00FF and U+2010-U+20AF (build-firmware-assets.js).
const PUNCT = [0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2022, 0x2026, 0x20ac];
const text = new Set([...ascii, ...Array.from({ length: 96 }, (_, i) => 0xa0 + i).filter((c) => c !== 0xad), ...PUNCT]);

// No-break space: the same blank advance as the space.
function nbsp(font) {
  font.glyphs.set(0xa0, { ...font.glyphs.get(32), name: 'nbsp', code: 0xa0 });
}

// A copy of an existing glyph at another codepoint.
function alias(font, from, to, name) {
  font.glyphs.set(to, { ...font.glyphs.get(from), name, code: to });
}

function setHeader(font, key, value) {
  const i = font.header.findIndex((l) => l.startsWith(key + ' '));
  const line = `${key} ${value}`;
  if (i >= 0) font.header[i] = line; else font.header.push(line);
}

function fixBoundingBox(font) {
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const g of font.glyphs.values()) {
    const [w, h, xo, yo] = g.bbx;
    minX = Math.min(minX, xo); minY = Math.min(minY, yo);
    maxX = Math.max(maxX, xo + w); maxY = Math.max(maxY, yo + h);
  }
  setHeader(font, 'FONTBOUNDINGBOX', `${maxX - minX} ${maxY - minY} ${minX} ${minY}`);
}

function rename(font, family, note) {
  font.header = font.header.filter((l) => !l.startsWith('COMMENT'));
  font.header.splice(1, 0, `COMMENT ${note}`, 'COMMENT Generated by scripts/build-fonts.js. Do not edit; edit the script.');
  const fi = font.header.findIndex((l) => l.startsWith('FONT '));
  font.header[fi] = `FONT ${family}`;
  setHeader(font, 'SPACING', '"P"');
}

// ---- small: Tom Thumb ----

function buildSmall() {
  const f = loadBDF(path.join(SRC, 'tom-thumb.bdf'));
  keepOnly(f, text);
  makeProportional(f, 2);
  nbsp(f);

  // Smart quotes and dashes (missing from Tom Thumb). At 3x5 curly quotes
  // can't be told from straight ones, so they're copies; the dashes step up
  // from the 3px hyphen.
  alias(f, 39, 0x2018, 'quoteleft');
  alias(f, 39, 0x2019, 'quoteright');
  alias(f, 44, 0x201a, 'quotesinglbase');
  alias(f, 34, 0x201c, 'quotedblleft');
  alias(f, 34, 0x201d, 'quotedblright');
  f.glyphs.set(0x201e, glyph('quotedblbase', 0x201e, art([
    '#.#',
    '#.#',
  ]), 0));
  f.glyphs.set(0x2013, glyph('endash', 0x2013, art([
    '####',
  ]), 2));
  f.glyphs.set(0x2014, glyph('emdash', 0x2014, art([
    '#####',
  ]), 2));

  // W and w widened to 5px (stock 3px versions read as H and u).
  f.glyphs.set(87, glyph('W', 87, art([
    '#...#',
    '#...#',
    '#.#.#',
    '#.#.#',
    '.#.#.',
  ]), 0));
  f.glyphs.set(119, glyph('w', 119, art([
    '#...#',
    '#.#.#',
    '#.#.#',
    '.#.#.',
  ]), 0));

  // m widened to 5px with a 3-row x-height (the stock 3px m is a blob). Only
  // used as the chronological view's minutes suffix ("4m").
  f.glyphs.set(109, glyph('m', 109, art([
    '####.',
    '#.#.#',
    '#.#.#',
  ]), 0));

  // Degree sign, kept small: a 2x2 dot level with the top of the digits.
  f.glyphs.set(0xb0, glyph('degree', 0xb0, art([
    '##',
    '##',
  ]), 3));

  f.glyphs.set(G.BOLT, glyph('bolt', G.BOLT, art([
    '..#',
    '.#.',
    '###',
    '.#.',
    '#..',
  ]), 0));
  f.glyphs.set(G.FUNNEL, glyph('funnel', G.FUNNEL, art([
    '####',
    '.###',
    '.##.',
    '..#.',
    '.#..',
  ]), 0));
  // Alert circle: two layers drawn at the same origin, disc in red, mark in white.
  f.glyphs.set(G.ALERT_DISC, glyph('alert_disc', G.ALERT_DISC, art([
    '.#.#.',
    '##.##',
    '##.##',
    '#####',
    '.#.#.',
  ]), 0));
  f.glyphs.set(G.ALERT_MARK, glyph('alert_mark', G.ALERT_MARK, art([
    '..#..',
    '..#..',
    '..#..',
    '.....',
    '..#..',
  ]), 0));

  // Two-dot cut mark (an ellipsis with one dot less) on the baseline, after a
  // transit label shortened to make room for the alert circle.
  f.glyphs.set(G.CUT, glyph('cut', G.CUT, art([
    '#.#',
  ]), 0));

  // Clock for schedule-based arrivals in the ticker index column (5px wide).
  f.glyphs.set(G.CLOCK, glyph('clock', G.CLOCK, art([
    '.###.',
    '#.#.#',
    '#.###',
    '#...#',
    '.###.',
  ]), 0));

  // Up and down arrows (5x5): a filled head on a shaft, for the high and low.
  f.glyphs.set(G.UP, glyph('up', G.UP, art([
    '..#..',
    '.###.',
    '#.#.#',
    '..#..',
    '..#..',
  ]), 0));
  f.glyphs.set(G.DOWN, glyph('down', G.DOWN, art([
    '..#..',
    '..#..',
    '#.#.#',
    '.###.',
    '..#..',
  ]), 0));

  rename(f, '-ctamap-BoardSmall-Medium-R-Normal--6-60-75-75-P-40-ISO10646-1',
    'Board small font. Based on Tom Thumb by Robey Pointer (MIT license).');
  fixBoundingBox(f);
  return f;
}

// ---- 5x7 ----

function build5x7() {
  const f = loadBDF(path.join(SRC, '5x7.bdf'));
  keepOnly(f, text);
  makeProportional(f, 3);
  nbsp(f);

  // 5x7 glyphs are 7 rows (yoff -1, bottom row is descent).
  f.glyphs.set(87, glyph('W', 87, art([
    '#...#',
    '#...#',
    '#...#',
    '#.#.#',
    '#.#.#',
    '.#.#.',
    '.....',
  ]), -1));
  f.glyphs.set(119, glyph('w', 119, art([
    '.....',
    '.....',
    '#...#',
    '#.#.#',
    '#.#.#',
    '.#.#.',
    '.....',
  ]), -1));
  // 0 widened from 3px to the 4px digit cell (the stock one is a skinny
  // diamond next to the 4px 8 and 6).
  f.glyphs.set(48, glyph('zero', 48, art([
    '.##.',
    '#..#',
    '#..#',
    '#..#',
    '#..#',
    '.##.',
    '....',
  ]), -1, 5));
  // t narrowed to 3px, bottom hook tucked under the crossbar.
  f.glyphs.set(116, glyph('t', 116, art([
    '.#.',
    '.#.',
    '###',
    '.#.',
    '.#.',
    '.##',
    '...',
  ]), -1));
  // "tt" ligature: two narrow t's sharing one crossbar.
  f.glyphs.set(G.TT, glyph('tt', G.TT, art([
    '.#..#.',
    '.#..#.',
    '######',
    '.#..#.',
    '.#..#.',
    '.##.##',
    '......',
  ]), -1));
  // "min": one 11px glyph with a 5-wide m.
  f.glyphs.set(G.MIN, glyph('min', G.MIN, art([
    '......#....',
    '...........',
    '##.#..#.##.',
    '#.#.#.#.#.#',
    '#.#.#.#.#.#',
    '#.#.#.#.#.#',
    '...........',
  ]), -1));

  rename(f, '-ctamap-Board5x7-Medium-R-Normal--7-70-75-75-P-50-ISO10646-1',
    'Board 5x7 font. Based on X11 misc-fixed 5x7 (public domain).');
  fixBoundingBox(f);
  return f;
}

// ---- clock: 9x15 Bold ----

function buildClock() {
  const f = loadBDF(path.join(SRC, '9x15B.bdf'));
  keepOnly(f, new Set([32, ...Array.from({ length: 10 }, (_, i) => 0x30 + i)]));

  // Digits occupy rows 2–11 of the 15-row cell (10px tall). The stock colon is
  // drawn for text and sits low; replace it with 2x2 square dots centered on
  // the digit height: rows 4–5 and 8–9 (2px from the top and bottom of the digits).
  const rows = Array.from({ length: 15 }, () => [0, 0]);
  for (const r of [4, 5, 8, 9]) rows[r] = [1, 1];
  f.glyphs.set(58, { name: 'colon', code: 58, dw: 4, bbx: [2, 15, 1, -3], rows });

  rename(f, '-ctamap-BoardClock-Bold-R-Normal--15-140-75-75-C-90-ISO10646-1',
    'Board clock font. Based on X11 misc-fixed 9x15 Bold (public domain).');
  setHeader(f, 'SPACING', '"C"');
  fixBoundingBox(f);
  return f;
}

// ---- vcr: 8x11 digits after VCR OSD Neue ----
// The seventies clock face's digits, redrawn from VCR OSD Neue by Elli Sho
// (dafont, "100% free"; the author asks for credit). Only digits, colon and
// space: 2px strokes, one-pixel cut corners, slashed zero. Tabular 8px
// digits with a 2px gap (advance 10); the colon is 2x2 dots, 2px from the
// top and bottom of the digits, with the same 2px gap (advance 4).

const VCR = {
  0: ['.######.', '########', '##....##', '##...###', '##..####', '##.##.##', '####..##', '###...##', '##....##', '########', '.######.'],
  1: ['...##...', '..###...', '.####...', '.####...', '...##...', '...##...', '...##...', '...##...', '...##...', '.######.', '.######.'],
  2: ['.######.', '########', '##....##', '......##', '..######', '.######.', '###.....', '##......', '##......', '########', '########'],
  3: ['.######.', '########', '##....##', '.....###', '...####.', '...####.', '.....###', '......##', '##....##', '########', '.######.'],
  4: ['....###.', '...####.', '..#####.', '.###.##.', '###..##.', '##...##.', '########', '########', '.....##.', '.....##.', '.....##.'],
  5: ['########', '########', '##......', '#######.', '########', '......##', '......##', '##....##', '###..###', '.######.', '..####..'],
  6: ['..#####.', '.#######', '###...##', '##......', '######..', '#######.', '##...###', '##....##', '###..###', '.#######', '..#####.'],
  7: ['########', '########', '......##', '.....###', '....###.', '...###..', '...##...', '...##...', '...##...', '...##...', '...##...'],
  8: ['.######.', '########', '##....##', '##....##', '########', '.######.', '########', '##....##', '##....##', '.######.', '..####..'],
  9: ['.######.', '########', '##....##', '##....##', '########', '.#######', '......##', '##....##', '###..###', '.######.', '..####..'],
};

function buildVcr() {
  const f = loadBDF(path.join(SRC, '9x15B.bdf'));  // for its header; every glyph is replaced
  f.glyphs = new Map();
  for (let d = 0; d <= 9; d++) f.glyphs.set(0x30 + d, glyph(`digit${d}`, 0x30 + d, art(VCR[d]), 0, 10));
  f.glyphs.set(58, glyph('colon', 58, art(['..', '..', '##', '##', '..', '..', '..', '##', '##', '..', '..']), 0, 4));
  f.glyphs.set(32, glyph('space', 32, art(['........']), 0, 10));
  rename(f, '-ctamap-BoardVcr-Bold-R-Normal--11-110-75-75-C-100-ISO10646-1',
    'Board VCR font: digits redrawn after VCR OSD Neue by Elli Sho (dafont, 100% free; credit requested).');
  setHeader(f, 'SPACING', '"C"');
  for (const [k, v] of [['FOUNDRY', '"ctamap"'], ['FAMILY_NAME', '"BoardVcr"'], ['PIXEL_SIZE', '11'], ['POINT_SIZE', '110'],
    ['AVERAGE_WIDTH', '100'], ['FONT_DESCENT', '0'], ['FONT_ASCENT', '11'], ['X_HEIGHT', '11'], ['CAP_HEIGHT', '11'],
    ['COPYRIGHT', '"Digits after VCR OSD Neue by Elli Sho"']]) setHeader(f, k, v);
  f.header = f.header.filter((l) => !l.startsWith('_XMBDFED_INFO'));
  const props = f.header.indexOf('ENDPROPERTIES') - f.header.findIndex((l) => l.startsWith('STARTPROPERTIES ')) - 1;
  setHeader(f, 'STARTPROPERTIES', String(props));
  fixBoundingBox(f);
  return f;
}

// ---- d17, d13: clock digits from UW ttyp0 Bold ----
// The big digits and day/date clock faces (design spec §20). Digits, space
// and colon only, from Uwe Waldmann's ttyp0 (scripts/fonts-src/t0-*-digits.bdf,
// subsets of u8g2's t0-30b / t0-22b; MIT-style license, kept in the output).
// Each digit is cropped to its ink and centered in a slot as wide as the
// widest digit (tabular, so nothing shifts as the minutes change); advance
// slot + 2. The colon is redrawn as two dots as big as ttyp0's square ones,
// centered on the digits (ttyp0's sits low): 4 px dots lose their corner
// pixels (round), a 3 px dot stays square (cornerless, it's a plus sign).
// The license asks that modified fonts be renamed, without "UW" in the name.

const DIGIT_GAP = 2;

function buildTtypDigits(file, name) {
  const src = loadBDF(path.join(SRC, file));
  // The rows the digits' ink spans, relative to the baseline (up is negative).
  let top = 99, bot = -99;
  for (let d = 0; d <= 9; d++) {
    const g = src.glyphs.get(0x30 + d), [, h, , yo] = g.bbx;
    g.rows.forEach((row, j) => { if (row.some(Boolean)) { const y = j - (yo + h); top = Math.min(top, y); bot = Math.max(bot, y); } });
  }
  const H = bot - top + 1;
  // A glyph's ink, cropped to its columns, on the digit band's rows.
  const ink = (g) => {
    const [w, h, , yo] = g.bbx;
    const cols = [...Array(w).keys()].filter((i) => g.rows.some((r) => r[i]));
    const x0 = cols[0], x1 = cols[cols.length - 1];
    return Array.from({ length: H }, (_, k) => { const j = top + k + yo + h; return (g.rows[j] || []).slice(x0, x1 + 1).map((v) => v || 0); });
  };
  const digits = [...Array(10).keys()].map((d) => ink(src.glyphs.get(0x30 + d)));
  const slot = Math.max(...digits.map((r) => r[0].length));
  const f = { header: src.header.slice(), glyphs: new Map() };
  const yoff = -(bot + 1);
  digits.forEach((rows, d) => {
    const w = rows[0].length;
    f.glyphs.set(0x30 + d, { name: `digit${d}`, code: 0x30 + d, dw: slot + DIGIT_GAP, bbx: [w, H, Math.floor((slot - w) / 2), yoff], rows });
  });
  // Colon: two dots, each as wide as ttyp0's square dot.
  const dot = ink(src.glyphs.get(58))[0].length;
  const inner = dot >= 5 ? 5 : dot >= 4 ? 3 : 2, ctop = Math.floor((H - (2 * dot + inner)) / 2);
  const dotRow = (j) => Array.from({ length: dot }, (_, i) => (dot > 3 && (i === 0 || i === dot - 1) && (j === 0 || j === dot - 1) ? 0 : 1));
  const colon = Array.from({ length: H }, (_, y) => (y >= ctop && y < ctop + dot ? dotRow(y - ctop)
    : y >= ctop + dot + inner && y < ctop + 2 * dot + inner ? dotRow(y - ctop - dot - inner) : Array(dot).fill(0)));
  f.glyphs.set(58, { name: 'colon', code: 58, dw: dot + DIGIT_GAP, bbx: [dot, H, 0, yoff], rows: colon });
  f.glyphs.set(32, { name: 'space', code: 32, dw: slot + DIGIT_GAP, bbx: [1, 1, 0, 0], rows: [[0]] });

  // Header: ttyp0's license comments stay; the font is renamed (license).
  const lic = f.header.filter((l) => l.startsWith('COMMENT') && !/Subset of|only space/.test(l));
  f.header = f.header.filter((l) => !l.startsWith('COMMENT'));
  f.header.splice(1, 0, `COMMENT Board ${name} font: clock digits from UW ttyp0 Bold by Uwe Waldmann, renamed and changed`,
    'COMMENT (digits cropped and re-spaced, colon redrawn) as its license requires. Generated by', 'COMMENT scripts/build-fonts.js. Do not edit; edit the script.', ...lic);
  const fam = `Board${name.toUpperCase()}`;
  const fi = f.header.findIndex((l) => l.startsWith('FONT '));
  f.header[fi] = `FONT -ctamap-${fam}-Bold-R-Normal--${H}-${H * 10}-75-75-C-${(slot + DIGIT_GAP) * 10}-ISO10646-1`;
  for (const [k, v] of [['FOUNDRY', '"ctamap"'], ['FAMILY_NAME', `"${fam}"`], ['PIXEL_SIZE', String(H)], ['POINT_SIZE', String(H * 10)],
    ['AVERAGE_WIDTH', String((slot + DIGIT_GAP) * 10)], ['FONT_DESCENT', '0'], ['FONT_ASCENT', String(H)], ['SPACING', '"C"']]) setHeader(f, k, v);
  setHeader(f, 'SIZE', `${H} 75 75`);
  const props = f.header.indexOf('ENDPROPERTIES') - f.header.findIndex((l) => l.startsWith('STARTPROPERTIES ')) - 1;
  setHeader(f, 'STARTPROPERTIES', String(props));
  fixBoundingBox(f);
  return f;
}

// ---- main ----

fs.mkdirSync(OUT, { recursive: true });
const fonts = {
  'board-small.bdf': buildSmall(), 'board-5x7.bdf': build5x7(), 'board-clock.bdf': buildClock(), 'board-vcr.bdf': buildVcr(),
  'board-d17.bdf': buildTtypDigits('t0-30b-digits.bdf', 'd17'), 'board-d13.bdf': buildTtypDigits('t0-22b-digits.bdf', 'd13'),
  'board-d23.bdf': buildTtypDigits('t0-40b-digits.bdf', 'd23'),
};
for (const [name, font] of Object.entries(fonts)) {
  fs.writeFileSync(path.join(OUT, name), writeBDF(font));
  console.log(`${name}: ${font.glyphs.size} glyphs`);
}
