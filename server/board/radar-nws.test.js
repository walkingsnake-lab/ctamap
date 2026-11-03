'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const R = require('./radar');
const N = require('./radar-nws');
const { decodeRows } = require('./radar-png');

const FX = path.join(__dirname, 'fixtures', 'radar-nws');
const SPOT = { lat: 32.0, lon: -93.0 }; // northwest Louisiana, rain to 53 dBZ at 21:44 UTC Nov 3, 2026
const NWS_PNG = path.join(FX, 'bref-20261103-214420-32.0n-93.0w.png');
const TRUTH = path.join(FX, 'mrms-bref-20261103-214420-32.0n-93.0w');
const CATALOG = JSON.parse(fs.readFileSync(path.join(FX, 'catalog-20261103-2150.json'), 'utf8'));
const quiet = { warn() {}, error() {} };

test('color ramp: one color per 0.5 dBZ, linear between the anchors', () => {
  assert.equal(N.RAMP.size, 141); // -10 .. 60
  for (const [d, c] of N.ANCHORS) assert.equal(N.dbzOfColor(c), d);
  // Colors read off the service next to the raw MRMS values (Nov 3, 2026).
  for (const [c, d] of [[0xd2d4b4, -10], [0xcbceb4, -9], [0x949bb5, 0], [0x4666a4, 10.5], [0x5eadcf, 15], [0x0ece14, 25.5],
    [0x0b840e, 30.5], [0x226b08, 35.5], [0xffd800, 41], [0xff9f00, 45.5], [0xff1200, 49.5], [0xf70000, 50.5], [0xb91a1a, 55.5], [0xc13333, 56]]) {
    assert.equal(N.dbzOfColor(c), d, c.toString(16));
  }
});

test('colors: transparent is no echo, near misses snap, colors past the ramp are flagged', () => {
  assert.equal(N.dbzOfColor(-1), null);
  assert.equal(N.dbzOfColor(0x5fadcf), 15); // off by one in a channel
  const unknown = new Set();
  assert.equal(N.dbzOfColor(0xff00ff, unknown), 60); // magenta: past the top (strong)
  assert.equal(N.dbzOfColor(0x00ff00, unknown), null); // nothing like the ramp's low end
  assert.deepEqual([...unknown], [0xff00ff, 0x00ff00]);
  // As lcref indices (dBZ = index * 0.5 - 32): no echo is 0.
  const ix = N.rgbIndex();
  assert.equal(ix(-1), 0);
  assert.equal(ix(0x5eadcf), 94);
  assert.equal(ix(0xff0000), 164);
  assert.equal(R.dbzOf(ix(0xff9f00)), 45.5);
});

test('window: the IEM grid around the stations, one pixel of margin', () => {
  const geo = R.geometry(N.GRID, SPOT.lat, SPOT.lon, 64);
  const w = N.windowOf([geo]);
  assert.deepEqual(w, { bbox: [-93.84, 31.65, -92.18, 32.37], size: [166, 72], wld: { dx: 0.01, dy: -0.01, x0: -93.835, y0: 32.365 } });
  // Its pixel centers are IEM's: the window's first pixel is a grid pixel.
  assert.ok(Math.abs(((w.wld.x0 - N.GRID.x0) / 0.01) - Math.round((w.wld.x0 - N.GRID.x0) / 0.01)) < 1e-6);
  // The station still lands on the marker LED in the window's own coordinates.
  const g2 = R.geometry(w.wld, SPOT.lat, SPOT.lon, 64);
  assert.equal(g2.x1 - g2.x0, geo.x1 - geo.x0);
  assert.equal(g2.x0, 1);
  assert.equal(g2.y0, 1);
  // Two stations: one window covering both.
  const both = N.windowOf([geo, R.geometry(N.GRID, SPOT.lat + 0.1, SPOT.lon + 0.2, 64)]);
  assert.ok(both.size[0] > w.size[0] && both.size[1] > w.size[1]);
});

test('catalog: the frame nearest the slot, within 3 minutes', () => {
  const items = N.parseCatalog(CATALOG);
  assert.equal(items.length, 17);
  assert.deepEqual(items[items.length - 1], { id: 262767637, t: 1793742609 });
  const at = (iso) => Date.parse(iso) / 1000;
  assert.equal(N.nearest(items, at('2026-11-03T21:42:00Z')).id, 262765637); // 21:44:20 over 21:36:04
  assert.equal(N.nearest(items, at('2026-11-03T21:48:00Z')).t, at('2026-11-03T21:50:09Z'));
  assert.equal(N.nearest(items, at('2026-11-03T22:00:00Z')), null); // newer than the newest
  assert.throws(() => N.parseCatalog({ error: { code: 500, message: 'Unable to complete operation.' } }), /Unable to complete/);
  assert.match(N.catalogUrl(), /query\?where=idp_subset%3D%27CONUS%27/);
  assert.match(N.exportUrl(5, N.windowOf([R.geometry(N.GRID, SPOT.lat, SPOT.lon, 64)])), /lockRasterIds%22%3A%5B5%5D.*f=image|f=image.*lockRasterIds/);
});

test('decoder: an RGB crop with a transparent color comes back as indices', async () => {
  const seen = new Set();
  let rows = 0, clear = 0;
  const info = await decodeRows(fs.createReadStream(NWS_PNG), {
    rgbIndex: (c) => { seen.add(c); return c < 0 ? 0 : 1; },
    onRow: (y, row) => { rows++; assert.equal(row.length, 166); clear += row.filter((v) => v === 0).length; },
  });
  assert.deepEqual([info.width, info.height], [166, 72]);
  assert.equal(rows, 72);
  assert.ok(seen.has(-1), 'the tRNS color is reported as transparent');
  assert.ok(clear > 0);
  // Without rgbIndex an RGB PNG is still refused.
  await assert.rejects(decodeRows(fs.createReadStream(NWS_PNG), { onRow() {} }), /palette PNG/);
});

test('a frame from NWS matches one from the raw MRMS data of the same time', async () => {
  // Truth: MRMS MergedBaseReflectivityQC 2026-11-03 21:44:20 (the product the
  // service draws), the same window, as an lcref-style palette PNG.
  const loc = [{ key: 'x', ...SPOT, width: 64 }];
  const truth = (await R.crops(fs.createReadStream(`${TRUTH}.png`), R.parseWld(fs.readFileSync(`${TRUTH}.wld`, 'utf8')), loc)).get('x');
  const win = N.windowOf([R.geometry(N.GRID, SPOT.lat, SPOT.lon, 64)]);
  const unknown = new Set();
  const got = (await R.crops(fs.createReadStream(NWS_PNG), win.wld, loc, N.rgbIndex(unknown))).get('x');
  assert.equal(unknown.size, 0, 'every color is on the ramp');
  const a = R.toFrame(truth.dbz, truth.geo, 'rain'), b = R.toFrame(got.dbz, got.geo, 'rain');
  let same = 0;
  for (let i = 0; i < a.bytes.length; i++) {
    if (a.bytes[i] === b.bytes[i]) same++;
    else assert.equal(Math.abs(a.bytes[i] - b.bytes[i]), 1, `LED ${i}: ${a.bytes[i]} vs ${b.bytes[i]}`);
  }
  assert.ok(same / a.bytes.length > 0.9, `${same} of ${a.bytes.length} LEDs the same`);
  assert.ok(Math.abs(a.colored - b.colored) <= a.colored * 0.02);
  // Every rain level up to 4 shows (45+ dBZ cores).
  assert.ok([1, 2, 3, 4].every((v) => b.bytes.includes(v)));
});

test('source: catalog cached, nearest frame exported, nothing near the slot is a 404', async () => {
  const urls = [];
  let t = 1793742700;
  const get = async (url) => {
    urls.push(url);
    if (url.includes('/query?')) return Readable.from([Buffer.from(JSON.stringify(CATALOG))]);
    return fs.createReadStream(NWS_PNG);
  };
  const warns = [];
  const src = N.createNwsSource({ get, now: () => t, log: { warn: (m) => warns.push(m), error() {} } });
  const geo = R.geometry(N.GRID, SPOT.lat, SPOT.lon, 64);
  const f = await src.fetch(Date.parse('2026-11-03T21:44:00Z') / 1000, [geo]);
  assert.equal(f.src, 'nws');
  assert.equal(f.at, 1793742260);
  assert.deepEqual(f.wld, N.windowOf([geo]).wld);
  f.png.destroy();
  assert.match(urls[1], /lockRasterIds%22%3A%5B262765637%5D/);
  assert.match(urls[1], /size=166%2C72/);
  await assert.rejects(src.fetch(Date.parse('2026-11-03T23:00:00Z') / 1000, [geo]), (e) => e.status === 404);
  assert.equal(urls.filter((u) => u.includes('/query?')).length, 1, 'catalog cached');
  t += 61;
  await src.fetch(Date.parse('2026-11-03T21:44:00Z') / 1000, [geo]).then((x) => x.png.destroy());
  assert.equal(urls.filter((u) => u.includes('/query?')).length, 2, 'refreshed after a minute');
  // Colors past the ramp are logged once each.
  f.rgbIndex(0xff00ff);
  src.flushUnknown();
  f.rgbIndex(0xff00ff);
  src.flushUnknown();
  assert.equal(warns.length, 1);
  assert.match(warns[0], /#ff00ff/);
});

test('poller: IEM failing falls back to NWS; both missing stays quiet', async () => {
  let t = R.timeOf('202611032142') + 120;
  const errors = [], warns = [];
  const log = { warn: (m) => warns.push(m), error: (...a) => errors.push(a.join(' ')) };
  let iem = 'down';
  const calls = [];
  const radar = R.createRadar({
    now: () => t, log,
    fetch: async (stamp) => {
      calls.push(`iem:${stamp}`);
      if (iem === 'down') throw new Error('connect ECONNREFUSED');
      if (iem === '404') { const e = new Error('HTTP 404'); e.status = 404; throw e; }
      return { wld: R.parseWld(fs.readFileSync(`${TRUTH}.wld`, 'utf8')), png: fs.createReadStream(`${TRUTH}.png`) };
    },
    fallback: async (at, geos) => {
      calls.push(`nws:${at}`);
      assert.equal(geos.length, 1);
      assert.equal(geos[0].width, R.SPLIT_W); // a station without a location file: the split layout
      if (iem === '404') { const e = new Error('no NWS frame near the slot'); e.status = 404; throw e; }
      return { wld: N.windowOf(geos).wld, png: fs.createReadStream(NWS_PNG), rgbIndex: N.rgbIndex(), src: 'nws' };
    },
  });
  radar.want('99999', SPOT.lat, SPOT.lon);
  await radar.pass();
  assert.deepEqual(calls, ['iem:202611032142', `nws:${R.timeOf('202611032142')}`]);
  let r = radar.want('99999', SPOT.lat, SPOT.lon);
  assert.deepEqual(r.frames, ['99999-202611032142']);
  assert.equal(radar.frame('99999', r.frames[0]).length, 2048);
  assert.equal(errors.length, 0);
  assert.equal(warns.filter((m) => /using NWS/.test(m)).length, 1);
  await radar.pass();
  assert.equal(warns.filter((m) => /using NWS/.test(m)).length, 1, 'said once');
  // IEM back: its frames again, and it says so.
  iem = 'up';
  await radar.pass();
  assert.equal(calls[calls.length - 1], 'iem:202611032130');
  assert.equal(warns.filter((m) => /IEM is back/.test(m)).length, 1);
  // IEM hasn't archived the newest slot yet (its normal lag): wait for IEM,
  // no fallback, a quiet retry later.
  iem = '404';
  t += 360;
  radar.want('99999', SPOT.lat, SPOT.lon); // the board is still asking
  let n = calls.length;
  await radar.pass();
  assert.deepEqual(calls.slice(n), ['iem:202611032148']);
  assert.equal(errors.length, 0);
  // Still missing a step later (IEM stalled): NWS is asked; neither has it: quiet.
  t += 360;
  radar.want('99999', SPOT.lat, SPOT.lon);
  n = calls.length;
  await radar.pass(); // the new newest slot (21:54): IEM only
  await radar.pass(); // 21:48, now overdue: IEM, then NWS
  assert.deepEqual(calls.slice(n), ['iem:202611032154', 'iem:202611032148', `nws:${R.timeOf('202611032148')}`]);
  assert.equal(errors.length, 0);
  r = radar.want('99999', SPOT.lat, SPOT.lon);
  assert.ok(!r.frames.includes('99999-202611032148'));
});

test('poller: IEM down and NWS missing the slot is logged', async () => {
  const errors = [];
  const radar = R.createRadar({
    now: () => R.timeOf('202611032142') + 120, log: { warn() {}, error: (...a) => errors.push(a.join(' ')) },
    fetch: async () => { throw new Error('HTTP 503'); },
    fallback: async () => { const e = new Error('no NWS frame near the slot'); e.status = 404; throw e; },
  });
  radar.want('99999', SPOT.lat, SPOT.lon);
  await radar.pass();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /IEM: HTTP 503; NWS: no NWS frame/);
});

test('poller: a custom fetch has no fallback unless given one', async () => {
  let calls = 0;
  const radar = R.createRadar({ now: () => 1e9, log: quiet, fetch: async () => { calls++; throw new Error('x'); } });
  radar.want('99999', SPOT.lat, SPOT.lon);
  await radar.pass();
  assert.equal(calls, 1);
});
