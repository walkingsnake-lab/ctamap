'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { measure, fit, ligatures, getFont } = require('./fonts');
const G = require('./glyphs');

const glyph = (font, ch) => getFont(font).glyphs.get(typeof ch === 'number' ? ch : ch.codePointAt(0));

test('Cottage with the tt ligature is 31px in 5x7 (design spec §3)', () => {
  assert.equal(measure('5x7', ligatures('Cottage')), 31);
});

test('ligatures only replaces tt', () => {
  assert.equal(ligatures('Cottage'), 'Co' + String.fromCodePoint(G.TT) + 'age');
  assert.equal(ligatures('Forest'), 'Forest');
});

test('proportional advance is ink width + 1', () => {
  for (const font of ['small', '5x7']) {
    for (const ch of 'ACMTaegilr') {
      const g = glyph(font, ch);
      assert.equal(g.dw, g.bbx[0] + 1, `${font} '${ch}'`);
      assert.equal(g.bbx[2], 0, `${font} '${ch}' starts at the origin`);
    }
  }
});

test('digits are tabular so rolling digits stay in place', () => {
  for (const font of ['small', '5x7', 'clock']) {
    const widths = new Set([...'0123456789'].map((d) => glyph(font, d).dw));
    assert.equal(widths.size, 1, `${font} digit advances: ${[...widths]}`);
  }
});

test('patched glyph widths', () => {
  assert.equal(glyph('small', 'W').bbx[0], 5);
  assert.equal(glyph('small', 'w').bbx[0], 5);
  assert.equal(glyph('5x7', 'W').bbx[0], 5);
  assert.equal(glyph('5x7', 'w').bbx[0], 5);
  assert.equal(glyph('5x7', 't').bbx[0], 3);
  assert.equal(glyph('5x7', G.TT).bbx[0], 6);
});

test('degree sign is a small 2x2 dot at digit-top height', () => {
  const g = glyph('small', 0xb0);
  assert.deepEqual(g.bbx, [2, 2, 0, 3]);
  assert.equal(g.dw, 3);
});

test('custom glyph sizes', () => {
  const size = (font, cp) => glyph(font, cp).bbx.slice(0, 2);
  assert.deepEqual(size('5x7', G.MIN), [11, 7]);
  assert.deepEqual(size('small', G.BOLT), [3, 5]);
  assert.deepEqual(size('small', G.FUNNEL), [4, 5]);
  assert.deepEqual(size('small', G.ALERT_DISC), [5, 5]);
  assert.deepEqual(size('small', G.ALERT_MARK), [5, 5]);
  assert.deepEqual(size('small', G.CLOCK), [5, 5]);
  assert.deepEqual(size('small', G.UP), [5, 5]);
  assert.deepEqual(size('small', G.DOWN), [5, 5]);
});

test('alert mark pixels sit only on holes in the disc', () => {
  const disc = glyph('small', G.ALERT_DISC).rows;
  const mark = glyph('small', G.ALERT_MARK).rows;
  mark.forEach((row, r) => row.forEach((b, c) => {
    if (b) assert.equal(disc[r][c], 0, `overlap at ${r},${c}`);
  }));
});

test('clock colon is 2x2 dots centered on the 10px digit height', () => {
  const colon = glyph('clock', ':');
  const lit = colon.rows.map((r, i) => (r.some(Boolean) ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(lit, [4, 5, 8, 9]);
  const digitRows = glyph('clock', '8').rows.map((r, i) => (r.some(Boolean) ? i : -1)).filter((i) => i >= 0);
  const mid = (a) => (a[0] + a[a.length - 1]) / 2;
  assert.equal(mid(lit), mid(digitRows));
  assert.equal(digitRows.length, 10);
});

test('measure ignores the trailing gap', () => {
  assert.equal(measure('small', ''), 0);
  assert.equal(measure('small', 'I'), glyph('small', 'I').bbx[0]);
});

test('fit truncates to the pixel width and drops missing glyphs', () => {
  const s = fit('small', 'JEFFERSON PARK', 20);
  assert.ok(measure('small', s) <= 20);
  assert.ok('JEFFERSON PARK'.startsWith(s));
  assert.equal(fit('small', 'A–B', 64), 'AB');
  assert.equal(fit('small', 'AB CD', measure('small', 'AB C') - 1), 'AB');
});
