'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { readZip } = require('./zip');

const METRA = path.join(__dirname, 'fixtures', 'metra', 'schedule-2026-11-14.zip');

// A zip built here: each entry stored (method 0) or deflated (8), with
// optional flags and a corrupted checksum.
function makeZip(entries) {
  const locals = [], cens = [];
  let offset = 0;
  for (const { name, data, method = 0, flags = 0, badCrc = false } of entries) {
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const crc = (zlib.crc32(data) ^ (badCrc ? 1 : 0)) >>> 0;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(flags, 6); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(body.length, 18); loc.writeUInt32LE(data.length, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(flags, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(loc, n, body);
    cens.push(cen, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(cens);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test("Metra's schedule.zip: every file, at its size (written with data descriptors)", () => {
  const files = readZip(fs.readFileSync(METRA));
  assert.deepStrictEqual([...files.keys()], ['agency.txt', 'calendar.txt', 'calendar_dates.txt', 'routes.txt', 'shapes.txt',
    'stop_times.txt', 'trips.txt', 'fare_attributes.txt', 'fare_rules.txt', 'stops.txt']);
  assert.strictEqual(files.get('stop_times.txt').length, 4975345);
  assert.match(files.get('routes.txt').toString('utf8'), /^route_id, route_short_name/);
});

test('only: reads just the named entries', () => {
  const files = readZip(fs.readFileSync(METRA), { only: ['routes.txt', 'calendar.txt'] });
  assert.deepStrictEqual([...files.keys()].sort(), ['calendar.txt', 'routes.txt']);
});

test('stored and deflated entries', () => {
  const a = Buffer.from('stored text'), b = Buffer.from('deflated '.repeat(50));
  const files = readZip(makeZip([{ name: 'a.txt', data: a }, { name: 'b.txt', data: b, method: 8 }]));
  assert.deepStrictEqual(files.get('a.txt'), a);
  assert.deepStrictEqual(files.get('b.txt'), b);
});

test('a comment after the end record is skipped', () => {
  const z = makeZip([{ name: 'a.txt', data: Buffer.from('x') }]);
  const comment = Buffer.from('hello');
  z.writeUInt16LE(comment.length, z.length - 2);
  assert.strictEqual(readZip(Buffer.concat([z, comment])).get('a.txt').toString(), 'x');
});

test('refuses what it can\'t read safely', () => {
  const data = Buffer.from('x'.repeat(1000));
  assert.throws(() => readZip(Buffer.from('not a zip at all, not even close')), /no end of central directory/);
  assert.throws(() => readZip(makeZip([{ name: 'e.txt', data, flags: 1 }])), /encrypted/);
  assert.throws(() => readZip(makeZip([{ name: 'big.txt', data, method: 8 }]), { maxEntry: 100 }), /max 100/);
  assert.throws(() => readZip(makeZip([{ name: 'c.txt', data, badCrc: true }])), /checksum/);
  const z = makeZip([{ name: 'a.txt', data }]);
  z.writeUInt16LE(12, 8); // compression method 12 (bzip2), in the local header only: the central one says 0
  assert.ok(readZip(z));
  const y = makeZip([{ name: 'a.txt', data }]);
  y.writeUInt16LE(12, y.length - 22 - 46 - 5 + 10); // the central directory's method
  assert.throws(() => readZip(y), /method 12/);
  const cut = fs.readFileSync(METRA).subarray(0, 200000);
  assert.throws(() => readZip(cut));
});
