'use strict';
// Logo prep (mlb-logos.js). The real sprite sheet is never in the repo, so
// these build synthetic sheets: plain shapes, not team art.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');
const L = require('./mlb-logos');

const BG = [0x24, 0x51, 0xa3], WHITE = [255, 255, 255], RED = [0xbe, 0x00, 0x39];
const hexOf = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// A 5 x 6 sheet of 32px tiles at `scale`; draw(tileIndex, x, y) -> rgb.
function sheet(scale, draw) {
  const png = new PNG({ width: 5 * 32 * scale, height: 6 * 32 * scale });
  for (let ty = 0; ty < 6; ty++) for (let tx = 0; tx < 5; tx++) for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const c = draw(ty * 5 + tx, x, y);
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      const i = (((ty * 32 + y) * scale + sy) * png.width + (tx * 32 + x) * scale + sx) * 4;
      png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
// A white square with a red center on blue: an "outline + fill" mark.
const box = (n, x, y) => (x >= 8 && x < 24 && y >= 8 && y < 24 ? (x >= 10 && x < 22 && y >= 10 && y < 22 ? RED : WHITE) : BG);

test('reads a 5 x 6 sheet at any integer scale; rejects other sizes', () => {
  const a = L.readTiles(PNG.sync.read(sheet(1, box)));
  const b = L.readTiles(PNG.sync.read(sheet(3, box)));
  assert.deepEqual(a.CHC, b.CHC);
  assert.equal(a.CHC[0][0], hexOf(BG));
  assert.equal(a.CHC[16][16], hexOf(RED));
  assert.throws(() => L.prepSheet(PNG.sync.write(new PNG({ width: 100, height: 100 }))), /5 x 6 sheet/);
  assert.throws(() => L.prepSheet(Buffer.from('nope')), /not a PNG/);
});

test('every team gets a 24 x 12 crop dimmed to 55% and a band color; ids follow the content', () => {
  const out = L.prepSheet(sheet(2, box));
  assert.deepEqual(Object.keys(out), L.SHEET);
  for (const ab of L.SHEET) {
    assert.equal(out[ab].bytes.length, L.LOGO_BYTES);
    assert.equal(out[ab].band, hexOf(BG.map((v) => Math.round(v * L.DIM))));
    assert.match(out[ab].id, new RegExp(`^${ab}-[0-9a-f]{8}$`));
    assert.equal(out[ab].custom, true); // not the tuned art: used as drawn
  }
  // Used as drawn: centered crop (rows 6-17 of 24), the corner pixel is band.
  const px = (ab, x, y) => [...out[ab].bytes.subarray((y * 24 + x) * 3, (y * 24 + x) * 3 + 3)];
  assert.deepEqual(px('CHC', 0, 0), BG.map((v) => Math.round(v * L.DIM)));
  assert.deepEqual(px('CHC', 12, 6), RED.map((v) => Math.round(v * L.DIM))); // tile center
  // Same art, same id; different art, different id.
  assert.equal(L.prepSheet(sheet(1, box)).CHC.id, out.CHC.id);
  assert.notEqual(L.prepSheet(sheet(1, (n, x, y) => (x > 20 ? WHITE : BG))).CHC.id, out.CHC.id);
});

test('prep rules: map outline to band, fill hollow outline art, keep counters', () => {
  const t = Array.from({ length: 32 }, (_, y) => Array.from({ length: 32 }, (_, x) => hexOf(box(0, x, y))));
  // Outline (white) -> band: the red fill remains on blue.
  const mapped = L.prepTile(t, { map: { '#ffffff': 'band' } });
  assert.equal(mapped.px[9][9], hexOf(BG));
  assert.equal(mapped.px[16][16], hexOf(RED));
  // Hollow: a white ring around background becomes a solid white mark; a
  // smaller ring inside it (a counter) stays band.
  const ring = (x, y, a, b) => (x === a || x === b || y === a || y === b) && x >= a && x <= b && y >= a && y <= b;
  const h = Array.from({ length: 32 }, (_, y) => Array.from({ length: 32 }, (_, x) => hexOf(ring(x, y, 6, 25) || ring(x, y, 13, 18) ? WHITE : BG)));
  const hollow = L.prepTile(h, { hollow: '#ffffff' });
  assert.equal(hollow.px[6][6], hexOf(BG));     // outline gone
  assert.equal(hollow.px[9][9], '#ffffff');     // body filled
  assert.equal(hollow.px[15][15], hexOf(BG));   // counter stays open
});

test('upload persists beside the board state and reloads; status lists teams', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-'));
  const a = L.createLogos({ dir, log: { error() {} } });
  assert.deepEqual(a.status(), { teams: 0, updated: null, custom: [] });
  assert.equal(a.get('CHC'), null);
  const st = a.upload(sheet(1, box), 1791140000);
  assert.equal(st.teams, 30);
  assert.equal(st.updated, 1791140000);
  const b = L.createLogos({ dir, log: { error() {} } });
  assert.deepEqual(b.get('CHC'), a.get('CHC'));
  assert.equal(b.bytes(a.get('CHC').id).length, L.LOGO_BYTES);
  assert.equal(b.bytes('CHC-00000000'), null);
  assert.throws(() => a.upload(Buffer.from('x')), /not a PNG/);
  assert.equal(a.status().teams, 30); // a bad upload keeps the old set
});
