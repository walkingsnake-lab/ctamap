'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const R = require('./radar');
const M = require('./radar-mrms');

const FX = path.join(__dirname, 'fixtures');
const HSR = path.join(FX, 'mrms-aws', 'MRMS_SeamlessHSR_00.00_20261103-214400.grib2.gz');
const IEM = path.join(FX, 'mrms', 'lcref_202611032144');
const MORSE = { lat: 42.008362, lon: -87.665909 };
const SPOT = { lat: 32.0, lon: -93.0 }; // northwest Louisiana, rain to 53 dBZ
const levels = (bytes) => bytes.reduce((h, v) => ((h[v] = (h[v] || 0) + 1), h), {});

test('file key: the slot\'s file, named to the second', () => {
  assert.equal(M.fileKey('202611032144'), 'CONUS/SeamlessHSR_00.00/20261103/MRMS_SeamlessHSR_00.00_20261103-214400.grib2.gz');
  assert.equal(M.fileUrl('202611040000'), 'https://noaa-mrms-pds.s3.amazonaws.com/CONUS/SeamlessHSR_00.00/20261104/MRMS_SeamlessHSR_00.00_20261104-000000.grib2.gz');
});

test('GRIB2: grid, PNG packing and scaling read from the file', async () => {
  const src = await M.openGrib(fs.createReadStream(HSR));
  src.png.destroy();
  assert.deepEqual(src.grid, { nx: 7000, ny: 3500, lat1: 54.995, lon1: 230.005, dx: 0.01, dy: 0.01, scan: 0 });
  assert.deepEqual(src.drs, { R: -9990, E: 0, D: 1, bits: 16 });
  assert.deepEqual(src.wld, { dx: 0.01, dy: -0.01, x0: -129.995, y0: 54.995 });
  // Values -> lcref-style indices, floored as IEM did: -999 / -99 missing.
  const lut = src.gray16;
  assert.equal(lut[0], 255); // -999: no coverage
  assert.equal(lut[9000], 255); // -99: no echo
  assert.equal(lut[9990], 64); // 0 dBZ
  assert.equal(lut[9990 + 150], 94); // 15.0 dBZ
  assert.equal(lut[9990 + 154], 94); // 15.4 dBZ: floored
  assert.equal(lut[9990 + 155], 95); // 15.5 dBZ
  assert.equal(R.dbzOf(lut[9990 + 425]), 42.5);
  assert.equal(lut[9990 - 400], 0); // -40 dBZ: below the scale
});

test('the same frames as IEM\'s lcref of the same time (made from these files)', async () => {
  const locs = [{ key: 'm', ...MORSE, width: 64 }, { key: 'x', ...SPOT, width: 64 }, { key: 's', ...MORSE, width: R.SPLIT_W }];
  const iem = await R.crops(fs.createReadStream(`${IEM}.png`), R.parseWld(fs.readFileSync(`${IEM}.wld`, 'utf8')), locs);
  const src = await M.openGrib(fs.createReadStream(HSR));
  const aws = await R.crops(src.png, src.wld, locs, { gray16: src.gray16 });
  for (const { key } of locs) {
    assert.deepEqual([...aws.get(key).dbz], [...iem.get(key).dbz], key);
  }
  // Louisiana's storms: every rain level up to 4.
  const f = R.toFrame(aws.get('x').dbz, aws.get('x').geo, 'rain');
  assert.ok([1, 2, 3, 4].every((v) => f.bytes.includes(v)), JSON.stringify(levels(f.bytes)));
});

test('only the top of the file is read for Chicago', async () => {
  let read = 0;
  const gz = fs.createReadStream(HSR, { highWaterMark: 16384 });
  gz.on('data', (d) => { read += d.length; });
  const src = await M.openGrib(gz);
  const out = await R.crops(src.png, src.wld, [{ key: 'm', ...MORSE, width: 64 }], { gray16: src.gray16 });
  await new Promise((r) => setImmediate(r));
  assert.ok(gz.destroyed, 'the download stops after the rows it needs');
  assert.ok(read < 0.85 * fs.statSync(HSR).size, `${read} of ${fs.statSync(HSR).size} bytes read`);
  assert.equal(R.toFrame(out.get('m').dbz, out.get('m').geo, 'rain').bytes[16 * 64 + 32], R.MARKER);
});

test('GRIB2: bad input is refused', async () => {
  await assert.rejects(M.openGrib(Readable.from([zlib.gzipSync(Buffer.from('not a grib message at all'))])), /not a GRIB2/);
  await assert.rejects(M.openGrib(Readable.from([Buffer.from('not gzip')])), /header|gzip|incorrect/i);
  // Cut off inside the data: the PNG stream errors instead of hanging.
  const whole = zlib.gunzipSync(fs.readFileSync(HSR));
  const src = await M.openGrib(Readable.from([zlib.gzipSync(whole.subarray(0, 200000))]));
  await assert.rejects(R.crops(src.png, src.wld, [{ key: 'x', ...SPOT, width: 64 }], { gray16: src.gray16 }), /truncated|ended|closed/);
});

test('source: fetches the slot\'s file; a missing one stays a 404', async () => {
  const urls = [];
  const fetch = M.createMrmsSource({
    get: async (url) => {
      urls.push(url);
      if (url.includes('-214600')) { const e = new Error('HTTP 404'); e.status = 404; throw e; }
      return fs.createReadStream(HSR);
    },
  });
  const src = await fetch('202611032144');
  assert.equal(src.src, 'mrms');
  src.png.destroy();
  assert.deepEqual(urls, [M.fileUrl('202611032144')]);
  await assert.rejects(fetch('202611032146'), (e) => e.status === 404);
});
