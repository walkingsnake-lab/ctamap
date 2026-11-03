'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const R = require('./radar');
const M = require('./radar-mrms');

const FX = path.join(__dirname, 'fixtures', 'mrms-aws');
const GRIB = path.join(FX, 'MRMS_MergedBaseReflectivityQC_00.50_20261103-214420.grib2.gz');
const LIST = fs.readFileSync(path.join(FX, 'list-20261103-2144.xml'), 'utf8');
const MORSE = { lat: 42.008362, lon: -87.665909 };
const SPOT = { lat: 32.0, lon: -93.0 }; // northwest Louisiana, rain to 53 dBZ

test('bucket keys: the listing near a slot and the nearest file within 90 s', () => {
  const t = Date.UTC(2026, 10, 3, 21, 44) / 1000;
  assert.equal(M.listUrl(t), 'https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=CONUS%2FMergedBaseReflectivityQC_00.50%2F20261103%2F&max-keys=4'
    + '&start-after=CONUS%2FMergedBaseReflectivityQC_00.50%2F20261103%2FMRMS_MergedBaseReflectivityQC_00.50_20261103-214229');
  // Just after midnight UTC: from the day's start.
  assert.doesNotMatch(M.listUrl(Date.UTC(2026, 10, 4, 0, 0) / 1000), /start-after/);
  assert.match(M.listUrl(Date.UTC(2026, 10, 4, 0, 0) / 1000), /20261104/);
  assert.equal(M.timeOfKey('CONUS/x/20261103/MRMS_MergedBaseReflectivityQC_00.50_20261103-214420.grib2.gz'), Date.UTC(2026, 10, 3, 21, 44, 20) / 1000);
  const hit = M.nearestKey(LIST, t);
  assert.equal(hit.key, 'CONUS/MergedBaseReflectivityQC_00.50/20261103/MRMS_MergedBaseReflectivityQC_00.50_20261103-214420.grib2.gz');
  assert.equal(M.nearestKey(LIST, t + 600), null);
  assert.equal(M.fileUrl(hit.key), `https://noaa-mrms-pds.s3.amazonaws.com/${hit.key}`);
});

test('GRIB2: grid, PNG packing and scaling read from the file', async () => {
  const src = await M.openGrib(fs.createReadStream(GRIB));
  src.png.destroy();
  assert.deepEqual(src.grid, { nx: 7000, ny: 3500, lat1: 54.995, lon1: 230.005, dx: 0.01, dy: 0.01, scan: 0 });
  assert.deepEqual(src.drs, { R: -9990, E: 0, D: 1, bits: 16 });
  assert.deepEqual(src.wld, { dx: 0.01, dy: -0.01, x0: -129.995, y0: 54.995 });
  // Values -> lcref-style indices: -999 / -99 missing, then dBZ * 2 + 64.
  const lut = src.gray16;
  assert.equal(lut[0], 255); // -999
  assert.equal(lut[9000], 255); // -99
  assert.equal(lut[9990], 64); // 0 dBZ
  assert.equal(lut[9990 + 150], 94); // 15 dBZ
  assert.equal(lut[9990 + 555], 175); // 55.5 dBZ
  assert.equal(R.dbzOf(lut[9990 + 425]), 42.5);
  assert.equal(lut[9990 - 400], 0); // -40 dBZ: below the scale
});

test('a frame from the file: Morse reads only the top of the file; Louisiana shows its storms', async () => {
  let read = 0;
  const gz = fs.createReadStream(GRIB, { highWaterMark: 16384 });
  gz.on('data', (d) => { read += d.length; });
  const src = await M.openGrib(gz);
  const out = await R.crops(src.png, src.wld, [{ key: 'm', ...MORSE, width: 64 }], { gray16: src.gray16 });
  await new Promise((r) => setImmediate(r));
  assert.ok(gz.destroyed, 'the download stops after the rows it needs');
  assert.ok(read < fs.statSync(GRIB).size, `${read} bytes read`);
  const m = R.toFrame(out.get('m').dbz, out.get('m').geo, 'rain');
  assert.equal(m.bytes[16 * 64 + 32], R.MARKER);
  // Further south: the whole file, and every rain level up to 4.
  const s = await M.openGrib(fs.createReadStream(GRIB));
  const f = (await R.crops(s.png, s.wld, [{ key: 'x', ...SPOT, width: 64 }], { gray16: s.gray16 })).get('x');
  const frame = R.toFrame(f.dbz, f.geo, 'rain');
  assert.ok([1, 2, 3, 4].every((v) => frame.bytes.includes(v)));
  assert.ok(frame.colored > 1000);
});

test('GRIB2: bad input is refused', async () => {
  await assert.rejects(M.openGrib(Readable.from([zlib.gzipSync(Buffer.from('not a grib message at all'))])), /not a GRIB2/);
  await assert.rejects(M.openGrib(Readable.from([Buffer.from('not gzip')])), /header|gzip|incorrect/i);
  // Cut off inside the data: the PNG stream errors instead of hanging.
  const whole = zlib.gunzipSync(fs.readFileSync(GRIB));
  const src = await M.openGrib(Readable.from([zlib.gzipSync(whole.subarray(0, 200000))]));
  await assert.rejects(R.crops(src.png, src.wld, [{ key: 'x', ...SPOT, width: 64 }], { gray16: src.gray16 }), /truncated|ended|closed/);
});

test('source: lists, picks the nearest file, and decodes it; nothing near the slot is a 404', async () => {
  const urls = [];
  const get = async (url) => {
    urls.push(url);
    if (url.includes('list-type=2')) return Readable.from([Buffer.from(LIST)]);
    return fs.createReadStream(GRIB);
  };
  const fetch = M.createMrmsSource({ get, timeOf: R.timeOf });
  const src = await fetch('202611032144');
  assert.equal(src.src, 'mrms');
  assert.equal(src.at, Date.UTC(2026, 10, 3, 21, 44, 20) / 1000);
  assert.match(urls[1], /MRMS_MergedBaseReflectivityQC_00\.50_20261103-214420\.grib2\.gz$/);
  src.png.destroy();
  await assert.rejects(fetch('202611032200'), (e) => e.status === 404);
});
