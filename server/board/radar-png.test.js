'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { decodeRows } = require('./radar-png');

const FX = path.join(__dirname, 'fixtures', 'mrms');

test('streamed rows match a full pngjs decode, palette included', async () => {
  const file = path.join(FX, 'lcref_202008102100.png');
  const ref = PNG.sync.read(fs.readFileSync(file)); // test-only full decode (RGBA)
  const rows = new Map();
  const info = await decodeRows(fs.createReadStream(file, { highWaterMark: 4096 }), {
    y0: 1250, y1: 1340, onRow: (y, row) => rows.set(y, Uint8Array.from(row)),
  });
  assert.equal(info.width, 7000);
  assert.equal(info.height, 3500);
  assert.equal(rows.size, 91);
  let checked = 0;
  for (const [y, row] of rows) {
    for (let x = 4100; x < 4400; x++) {
      const k = (y * ref.width + x) * 4, p = row[x] * 3;
      assert.deepEqual([info.palette[p], info.palette[p + 1], info.palette[p + 2]], [ref.data[k], ref.data[k + 1], ref.data[k + 2]], `x${x} y${y}`);
      checked++;
    }
  }
  assert.equal(checked, 91 * 300);
});

test('stops reading once past the last wanted row', async () => {
  const file = path.join(FX, 'lcref_202610041600.png');
  const stream = fs.createReadStream(file, { highWaterMark: 16384 });
  let bytes = 0;
  stream.on('data', (d) => { bytes += d.length; });
  let last = -1;
  await decodeRows(stream, { y0: 0, y1: 200, onRow: (y) => { last = y; } });
  assert.equal(last, 200);
  assert.ok(bytes < fs.statSync(file).size / 2, `read ${bytes} bytes`);
  assert.ok(stream.destroyed);
});

test('rejects what it can\'t decode', async () => {
  const { Readable } = require('stream');
  await assert.rejects(decodeRows(Readable.from([Buffer.from('not a png at all')]), { onRow() {} }), /not a PNG/);
  const truncated = fs.readFileSync(path.join(FX, 'lcref_202008102100.png')).subarray(0, 50000);
  await assert.rejects(decodeRows(Readable.from([truncated]), { y0: 3000, y1: 3100, onRow() {} }), /truncated|ended|end of file/);
});

test('a download that closes without ending or erroring rejects instead of hanging', async () => {
  const { PassThrough } = require('stream');
  const src = new PassThrough();
  const p = decodeRows(src, { y0: 0, y1: 10, onRow() {} });
  src.write(fs.readFileSync(path.join(FX, 'lcref_202610041600.png')).subarray(0, 5000));
  src.destroy(); // like a socket torn down mid-transfer
  await assert.rejects(p, /closed early|aborted|truncated/);
});
