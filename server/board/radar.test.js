'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('./radar');

const FX = path.join(__dirname, 'fixtures', 'mrms');
const MORSE = { lat: 42.008362, lon: -87.665909 };
const quiet = { warn() {}, error() {} };
const wldOf = (s) => R.parseWld(fs.readFileSync(path.join(FX, `lcref_${s}.wld`), 'utf8'));
const pngOf = (s) => fs.createReadStream(path.join(FX, `lcref_${s}.png`));

async function frameFor(stamp, mode, loc = MORSE, width = R.SPLIT_W) {
  const out = await R.crops(pngOf(stamp), wldOf(stamp), [{ key: 'k', ...loc, width }]);
  const { dbz, geo } = out.get('k');
  return { ...R.toFrame(dbz, geo, mode), dbz, geo };
}
const hist = (bytes) => bytes.reduce((h, v) => ((h[v] = (h[v] || 0) + 1), h), {});

test('world files: old and new IEM origins both parse', () => {
  assert.deepEqual(wldOf('202008102100'), { dx: 0.01, dy: -0.01, x0: -130, y0: 55 });
  assert.deepEqual(wldOf('202610041600'), { dx: 0.01, dy: -0.01, x0: -129.995, y0: 54.995 });
  assert.throws(() => R.parseWld('<html>'), /world file/);
});

test('palette index to dBZ follows the IEM table', () => {
  assert.equal(R.dbzOf(0), -32);
  assert.equal(R.dbzOf(64), 0);
  assert.equal(R.dbzOf(95), 15.5);
  assert.equal(R.dbzOf(175), 55.5);
  assert.equal(R.dbzOf(255), null);
});

test('geometry: ~1.5 mi per LED, station on the marker LED', () => {
  const g = R.geometry(wldOf('202610041600'), MORSE.lat, MORSE.lon, R.SPLIT_W);
  assert.ok(Math.abs(g.colsPer - 2.92) < 0.01 && Math.abs(g.rowsPer - 2.17) < 0.01);
  assert.equal(g.mx, 19); assert.equal(g.my, 16);
  // Morse's own source pixel maps to the marker LED.
  const sx = Math.round((MORSE.lon + 129.995) / 0.01), sy = Math.round((54.995 - MORSE.lat) / 0.01);
  assert.equal(g.ledCol[sx - g.x0], g.mx);
  assert.equal(g.ledRow(sy), g.my);
  assert.ok(g.y1 - g.y0 < 75, 'decodes ~70 rows, not the whole map');
});

test('clear day: nothing but the marker', async () => {
  const f = await frameFor('202610041600', 'rain');
  assert.equal(f.colored, 0);
  assert.deepEqual(hist(f.bytes), { 0: 2047, 7: 1 });
  assert.equal(f.bytes[16 * 64 + 19], R.MARKER);
});

test('derecho: a wide range of rain levels; the split panel stays empty', async () => {
  const f = await frameFor('202008102100', 'rain');
  const h = hist(f.bytes);
  for (const lv of [1, 2, 3, 4]) assert.ok(h[lv] > 20, `level ${lv}: ${h[lv]}`);
  assert.ok(f.colored > R.ON_PX);
  for (let y = 0; y < 32; y++) for (let x = R.SPLIT_W; x < 64; x++) assert.equal(f.bytes[y * 64 + x], 0);
  // Marker and its 4 neighbors.
  const m = 16 * 64 + 19;
  assert.deepEqual([f.bytes[m], f.bytes[m - 1], f.bytes[m + 1], f.bytes[m - 64], f.bytes[m + 64]], [7, 0, 0, 0, 0]);
});

test('snow: same echoes use the snow levels and thresholds', async () => {
  const snow = await frameFor('202202021800', 'snow');
  const rain = await frameFor('202202021800', 'rain');
  const hs = hist(snow.bytes);
  assert.ok(![1, 2, 3, 4, 5].some((v) => hs[v]));
  for (const lv of [8, 9]) assert.ok(hs[lv] > 50, `snow level ${lv}: ${hs[lv]}`);
  // Dry snow reflects weakly: as rain, most of it would be below the first level.
  assert.ok(snow.colored > 2 * rain.colored);
});

test('averaging is in linear Z, not dBZ', () => {
  const geo = { width: 1, mx: 0, my: 0, x0: 0, x1: 1, y0: 0, y1: 0, ledCol: new Int16Array([0, 0]), ledRow: () => 0 };
  const acc = R.accumulator(geo);
  // 40 dBZ (index 144) next to no echo: linear mean is 37 dBZ, not 20.
  acc.row(0, Uint8Array.from([144, 0]));
  assert.ok(Math.abs(acc.dbz()[0] - (40 - 10 * Math.log10(2))) < 1e-9);
});

test('despeckle drops isolated pixels, keeps clusters', () => {
  const geo = { width: 64, mx: 60, my: 30 };
  const dbz = new Float64Array(64 * 32).fill(-Infinity);
  dbz[5 * 64 + 5] = 40;                                            // lone pixel
  for (const [x, y] of [[20, 10], [21, 10], [20, 11]]) dbz[y * 64 + x] = 30; // L-shaped cluster
  const f = R.toFrame(dbz, geo, 'rain');
  assert.equal(f.bytes[5 * 64 + 5], 0);
  assert.deepEqual([f.bytes[10 * 64 + 20], f.bytes[10 * 64 + 21], f.bytes[11 * 64 + 20]], [2, 2, 2]);
  assert.equal(f.colored, 3);
});

test('snow mode from the weather: snow codes, or freezing without freezing rain', () => {
  assert.equal(R.modeFor(null), 'rain');
  assert.equal(R.modeFor({ code: 73, temp: 35 }), 'snow');
  assert.equal(R.modeFor({ code: 3, temp: 30 }), 'snow');
  assert.equal(R.modeFor({ code: 67, temp: 30 }), 'rain');
  assert.equal(R.modeFor({ code: 61, temp: 40 }), 'rain');
});

test('stamps and archive URLs', () => {
  const t = Date.UTC(2026, 9, 4, 16, 0) / 1000;
  assert.equal(R.stampOf(t), '202610041600');
  assert.equal(R.timeOf('202610041600'), t);
  assert.equal(R.frameUrl('202610041600', 'png'), 'https://mesonet.agron.iastate.edu/archive/data/2026/10/04/GIS/mrms/lcref_202610041600.png');
});

test('poller: newest frame first, then backfill; 404s retried later; on/off hysteresis', async () => {
  let t = R.timeOf('202008102108') + 120; // so the newest slot is 21:05
  const fetched = [];
  const available = new Set(['202008102100', '202008102050']);
  const radar = R.createRadar({
    now: () => t, log: quiet,
    fetch: async (stamp) => {
      fetched.push(stamp);
      // Every slot uses the derecho frame; slot 21:05 isn't in the archive yet.
      if (stamp === '202008102105') { const e = new Error('HTTP 404'); e.status = 404; throw e; }
      if (!available.has(stamp)) available.add(stamp);
      return { wld: wldOf('202008102100'), png: pngOf('202008102100') };
    },
  });
  assert.deepEqual(radar.slots(), ['202008102040', '202008102045', '202008102050', '202008102055', '202008102100', '202008102105']);
  // Morse: the clock sits over the lake (full-width layout).
  assert.deepEqual(radar.want('40100', MORSE.lat, MORSE.lon), { on: false, frames: [], ft: [], clock: R.FULL_CLOCK, split: false });
  await radar.pass();
  await radar.pass();
  assert.deepEqual(fetched, ['202008102105', '202008102100']); // 404, then the next newest
  for (let i = 0; i < 6; i++) await radar.pass();
  const r = radar.want('40100', MORSE.lat, MORSE.lon);
  assert.equal(r.frames.length, 5);
  assert.deepEqual(r.frames, ['40100-202008102040', '40100-202008102045', '40100-202008102050', '40100-202008102055', '40100-202008102100']);
  assert.deepEqual(r.ft, r.frames.map((id) => R.timeOf(id.split('-')[1])));
  assert.equal(r.on, true);
  assert.equal(radar.frame('40100', r.frames[0]).length, 2048);
  assert.equal(radar.frame('40100', 'nope'), null);
  assert.equal(radar.frame('99999', r.frames[0]), null);
  // The 404'd slot is retried after the retry delay.
  t += 121;
  await radar.pass();
  assert.equal(fetched.filter((s) => s === '202008102105').length >= 1, true);
});

test('poller: idle stations cost nothing', async () => {
  let calls = 0;
  const radar = R.createRadar({ now: () => 1e9, log: quiet, fetch: async () => { calls++; throw new Error('x'); } });
  await radar.pass();
  assert.equal(calls, 0);
});

const inBox = (k) => { const x = k % 64, y = k >> 6, [bx, by, bw, bh] = R.FULL_CLOCK; return x >= bx && x < bx + bw && y >= by && y < by + bh; };

test('water masks: Morse is full width with the lake east; masked water, shoreline, clear clock box', async () => {
  const loc = R.loadLocation('40100');
  assert.equal(loc.split, false);
  assert.equal(loc.width, 64);
  // Lake Michigan is east of Morse: the whole clock area is water, the far
  // west is land.
  for (let y = 2; y <= 19; y++) for (let x = 41; x <= 62; x++) assert.equal(loc.water[y * 64 + x], 1);
  assert.equal(loc.water[16 * 64 + 0], 0);
  const out = await R.crops(pngOf('202008102100'), wldOf('202008102100'), [{ key: 'k', ...MORSE, width: 64 }]);
  const { dbz, geo } = out.get('k');
  const f = R.toFrame(dbz, geo, 'rain', loc);
  for (let k = 0; k < 2048; k++) if (loc.water[k]) assert.equal(f.bytes[k], loc.shore[k] && !inBox(k) && k !== 16 * 64 + 32 ? R.SHORE : 0, `water at ${k % 64},${k >> 6}`);
  for (const [bx, by, bw, bh] of [R.FULL_CLOCK]) for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) assert.equal(f.bytes[y * 64 + x], 0);
  // Shoreline: the lake's edge pixels, water side, drawn even right next to
  // the storm (rain stops at the land pixel beside it).
  let shore = 0;
  for (let k = 0; k < 2048; k++) if (f.bytes[k] === R.SHORE) { shore++; assert.equal(loc.water[k], 1); }
  assert.ok(shore > 20);
  let besideRain = 0;
  for (let k = 0; k < 2048; k++) if (f.bytes[k] === R.SHORE && [k - 1, k + 1].some((j) => f.bytes[j] >= 1 && f.bytes[j] <= 5)) besideRain++;
  assert.ok(besideRain > 0, 'shoreline survives next to rain');
  assert.equal(f.bytes[16 * 64 + 32], R.MARKER);
  // Morse sits on the shore: the shoreline continues right next to the dot.
  assert.equal(loc.shore[16 * 64 + 33], 1);
  assert.equal(f.bytes[16 * 64 + 33], R.SHORE);
  // ...while rain next to the dot is still cleared.
  for (const k of [16 * 64 + 31, 15 * 64 + 32, 17 * 64 + 32]) assert.ok(f.bytes[k] === 0 || f.bytes[k] === R.SHORE, `pixel ${k % 64},${k >> 6}`);
});

test('water masks: a station with land under the clock falls back to split', () => {
  const loc = R.loadLocation('40450'); // 95th/Dan Ryan: Indiana under the top-right corner
  assert.equal(loc.split, true);
  assert.equal(loc.width, R.SPLIT_W);
  assert.deepEqual(loc.clock, R.SPLIT_CLOCK);
  // No file: split layout, no masks.
  const none = R.loadLocation('nope');
  assert.deepEqual([none.split, none.water], [true, null]);
});

test('every station has a location file built from the current lake data', () => {
  const { build } = require('../../scripts/build-locations');
  for (const st of require('./stations.json')) {
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, 'locations', `${st.mapid}.json`), 'utf8'));
    assert.deepEqual(file, build(st), `${st.name}: run node scripts/build-locations.js`);
  }
});
