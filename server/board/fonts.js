'use strict';
// Text measurement against the board's BDF fonts, so the server can fit
// labels to pixel widths exactly as the board will draw them.

const path = require('path');
const { loadBDF } = require('./bdf');
const G = require('./glyphs');

const FONT_DIR = path.join(__dirname, 'fonts');
const FILES = { small: 'board-small.bdf', '5x7': 'board-5x7.bdf', clock: 'board-clock.bdf' };

const cache = new Map();

function getFont(name) {
  if (!FILES[name]) throw new Error(`unknown board font: ${name}`);
  if (!cache.has(name)) cache.set(name, loadBDF(path.join(FONT_DIR, FILES[name])));
  return cache.get(name);
}

function advance(font, cp) {
  const g = font.glyphs.get(cp);
  if (!g) throw new Error(`glyph U+${cp.toString(16).toUpperCase().padStart(4, '0')} missing`);
  return g.dw;
}

// Pixel width from the left edge of the first glyph to the right edge of the
// last glyph's cell, excluding the trailing 1px gap every advance includes.
function measure(fontName, text) {
  const font = getFont(fontName);
  let w = 0;
  for (const ch of text) w += advance(font, ch.codePointAt(0));
  return w > 0 ? w - 1 : 0;
}

// Ticker destinations: replace "tt" with the ligature glyph.
function ligatures(text) {
  return text.replace(/tt/g, String.fromCodePoint(G.TT));
}

// Truncate text so it fits within maxPx. Characters the font lacks are
// dropped first (destination names from CTA can contain anything). Trailing
// spaces left by the cut are dropped. No ellipsis: there's no room for one.
function fit(fontName, text, maxPx) {
  const font = getFont(fontName);
  const chars = [...text].filter((ch) => font.glyphs.has(ch.codePointAt(0)));
  while (chars.length && measure(fontName, chars.join('')) > maxPx) chars.pop();
  return chars.join('').trimEnd();
}

function hasGlyph(fontName, cp) {
  return getFont(fontName).glyphs.has(cp);
}

// All board fonts in the compact form draw.js uses (and the simulator
// downloads): { name: { [codepoint]: [dw, w, h, xoff, yoff, ...rowBits] } }.
let packed = null;
function packFonts() {
  if (packed) return packed;
  packed = {};
  for (const name of Object.keys(FILES)) {
    const out = {};
    for (const [cp, g] of getFont(name).glyphs) {
      const [w, h, xo, yo] = g.bbx;
      const rows = g.rows.map((row) => row.slice(0, w).reduce((acc, b) => (acc << 1) | (b ? 1 : 0), 0));
      out[cp] = [g.dw, w, h, xo, yo, ...rows];
    }
    packed[name] = out;
  }
  return packed;
}

module.exports = { measure, fit, ligatures, hasGlyph, getFont, packFonts };
