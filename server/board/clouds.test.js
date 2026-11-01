'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { W, H, BYTES, SHAPES, strip, packStrip, unpackStrip, stripBytes, fbm } = require('./clouds');

test('strips are 128 x 26, packed to 1664 bytes, and unpack to the same indexes', () => {
  for (const id of Object.keys(SHAPES)) {
    const px = strip(id);
    assert.equal(px.length, W * H);
    const b = stripBytes(id);
    assert.equal(b.length, BYTES);
    assert.deepEqual(unpackStrip(b), px);
    assert.ok(px.every((v) => v >= 0 && v <= 15));
  }
  assert.equal(strip('nope'), null);
  assert.equal(stripBytes('nope'), null);
  assert.equal(packStrip(Uint8Array.from([1, 2, 15, 0]).subarray(0, 4).length === 4 ? new Uint8Array(W * H).fill(3) : null)[0], 0x33);
});

test('the noise wraps at the strip width, so the scroll never shows a seam', () => {
  for (const sh of Object.values(SHAPES)) {
    const sx = W / sh.cells;
    for (const y of [0, 5, 12, 20]) near(fbm(W / sx, y / sh.sy, sh.seed, sh.cells), fbm(0, y / sh.sy, sh.seed, sh.cells));
  }
});
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`); }

test('wisps: two tints, nothing below their bottom row; decks cover the whole sky', () => {
  const p = strip('p1');
  assert.ok(p.every((v) => v <= 2));
  for (let y = SHAPES.p1.ymax + 1; y < H; y++) for (let x = 0; x < W; x++) assert.equal(p[y * W + x], 0);
  const share = (px) => px.filter((v) => v > 0).length / px.length;
  assert.ok(share(strip('m1')) > share(p), 'mostly cloudy has more cloud than partly');
  const o = strip('o1');
  assert.ok(o.every((v) => v >= 1), 'a deck leaves no gaps');
  assert.ok(new Set(o).size > 6, 'with texture');
});
