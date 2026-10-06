'use strict';
// Logo prep (mlb-logos.js): resize + crop only. The real sprite sheet is
// never in the repo, so these build synthetic tiles: plain shapes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');
const L = require('./mlb-logos');

const BG = [0x24, 0x51, 0xa3], WHITE = [255, 255, 255], RED = [0xbe, 0x00, 0x39];
const hexOf = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

function png(w, h, draw) {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = draw(x, y), i = (y * w + x) * 4;
    p.data[i] = c[0]; p.data[i + 1] = c[1]; p.data[i + 2] = c[2]; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}
// A 5 x 6 sheet of 32px tiles at `scale`; draw(tileIndex, x, y) -> rgb.
const sheet = (scale, draw) => png(5 * 32 * scale, 6 * 32 * scale, (x, y) => {
  const tx = Math.floor(x / (32 * scale)), ty = Math.floor(y / (32 * scale));
  return draw(ty * 5 + tx, Math.floor(x / scale) % 32, Math.floor(y / scale) % 32);
});
// White square with a red center on blue.
const box = (n, x, y) => (x >= 8 && x < 24 && y >= 8 && y < 24 ? (x >= 10 && x < 22 && y >= 10 && y < 22 ? RED : WHITE) : BG);
const px = (l, x, y) => [...l.bytes.subarray((y * 24 + x) * 3, (y * 24 + x) * 3 + 3)];

test('a sheet reads at any whole-number scale; other sizes are rejected', () => {
  const a = L.prepSheet(sheet(1, box)), b = L.prepSheet(sheet(3, box));
  assert.deepEqual(Object.keys(a), L.SHEET);
  assert.equal(a.CHC.id, b.CHC.id);
  assert.throws(() => L.prepSheet(png(100, 100, () => BG)), /5 x 6 sheet/);
  assert.throws(() => L.prepSheet(Buffer.from('nope')), /not a PNG/);
});

test('resize and crop only: colors untouched (no dimming), band = top-left pixel', () => {
  const out = L.prepSheet(sheet(2, box));
  const chc = out.CHC; // centered crop: rows 6-17 of 24
  assert.equal(chc.bytes.length, L.LOGO_BYTES);
  assert.equal(chc.band, hexOf(BG));
  assert.equal(chc.crop, 6);
  assert.deepEqual(px(chc, 0, 0), BG);
  assert.deepEqual(px(chc, 12, 6), RED);          // tile center, full brightness
  assert.equal(out.TB.crop, L.OFFSET.TB);         // per-team default crop
  assert.match(chc.id, /^CHC-[0-9a-f]{8}$/);
});

test('one logo: a 32px tile at any scale, or any other image area-averaged to 32; crop override', () => {
  const tile = (s) => png(32 * s, 32 * s, (x, y) => box(0, Math.floor(x / s), Math.floor(y / s)));
  const a = L.prepOne('CHC', tile(1)), b = L.prepOne('CHC', tile(5));
  assert.equal(a.id, b.id);
  const odd = L.prepOne('CHC', png(50, 50, (x, y) => (x < 25 ? RED : BG)));
  assert.deepEqual(px(odd, 0, 0), RED);
  assert.equal(L.prepOne('CHC', tile(1), 0).crop, 0);
  assert.throws(() => L.prepOne('CHC', tile(1), 13), /crop must be 0-12/);
  assert.throws(() => L.prepOne('XYZ', tile(1)), /unknown team/);
});

test('crops keep at most MAX_COLORS colors (the board palette holds two logos and the screen)', () => {
  const noisy = Buffer.from(Array.from({ length: L.LOGO_BYTES }, (_, i) => (i * 37) % 256));
  const out = L.limitColors(noisy, L.MAX_COLORS);
  const set = new Set();
  for (let i = 0; i < out.length; i += 3) set.add(`${out[i]},${out[i + 1]},${out[i + 2]}`);
  assert.ok(set.size <= L.MAX_COLORS);
  const few = Buffer.alloc(L.LOGO_BYTES, 9);
  assert.equal(L.limitColors(few, L.MAX_COLORS), few);
});

test('uploads persist beside the board state and reload; one team replaces only that team', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-'));
  const a = L.createLogos({ dir, log: { error() {} } });
  assert.deepEqual(a.status(), { teams: [], updated: null });
  assert.equal(a.get('CHC'), null);
  assert.equal(a.uploadSheet(sheet(1, box), 1791140000).teams.length, 30);
  const before = a.get('STL');
  a.uploadOne('CHC', png(32, 32, () => RED), 0, 1791140100);
  assert.notEqual(a.get('CHC').id, before.id);
  assert.deepEqual(a.get('STL'), before);
  assert.equal(a.get('CHC').band, hexOf(RED));
  const b = L.createLogos({ dir, log: { error() {} } });
  assert.deepEqual(b.get('CHC'), a.get('CHC'));
  assert.equal(b.status().updated, 1791140100);
  assert.equal(b.bytes(a.get('CHC').id).length, L.LOGO_BYTES);
  assert.throws(() => a.uploadSheet(Buffer.from('x')), /not a PNG/);
  assert.equal(a.status().teams.length, 30); // a bad upload keeps the old set
});
