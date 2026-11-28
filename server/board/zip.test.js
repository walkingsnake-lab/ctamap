'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { readZip } = require('./zip');
const { makeZip, scheduleZip } = require('./fixtures/metra/make-zip');

test('the schedule fixture, written with data descriptors as Metra\'s is', () => {
  const files = readZip(scheduleZip());
  assert.deepStrictEqual([...files.keys()], ['agency.txt', 'calendar.txt', 'calendar_dates.txt', 'routes.txt', 'stop_times.txt', 'stops.txt', 'trips.txt']);
  assert.match(files.get('routes.txt').toString('utf8'), /^route_id, route_short_name/);
  assert.deepStrictEqual(readZip(scheduleZip({ descriptor: false })), files);
});

test('only: reads just the named entries', () => {
  const files = readZip(scheduleZip(), { only: ['routes.txt', 'calendar.txt'] });
  assert.deepStrictEqual([...files.keys()].sort(), ['calendar.txt', 'routes.txt']);
});

test('stored and deflated entries', () => {
  const a = Buffer.from('stored text'), b = Buffer.from('deflated '.repeat(50));
  const files = readZip(makeZip([{ name: 'a.txt', data: a, method: 0 }, { name: 'b.txt', data: b }]));
  assert.deepStrictEqual(files.get('a.txt'), a);
  assert.deepStrictEqual(files.get('b.txt'), b);
});

test('a comment after the end record is skipped', () => {
  assert.strictEqual(readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x') }], { comment: 'hello' })).get('a.txt').toString(), 'x');
});

test('an end-record signature inside the comment is not taken for the real one', () => {
  const fake = Buffer.alloc(22); fake.writeUInt32LE(0x06054b50, 0);
  const z = makeZip([{ name: 'a.txt', data: Buffer.from('x') }], { comment: `${fake.toString('latin1')}tail` });
  assert.strictEqual(readZip(z).get('a.txt').toString(), 'x');
});

test('refuses what it can\'t read safely', () => {
  const data = Buffer.from('x'.repeat(1000));
  const one = (entry, opts) => makeZip([{ name: 'a.txt', data, ...entry }], opts);
  assert.throws(() => readZip(Buffer.from('not a zip at all, not even close')), /no end of central directory/);
  assert.throws(() => readZip(one({ flags: 1 })), /encrypted/);
  assert.throws(() => readZip(one({}), { maxEntry: 100 }), /max 100/);
  assert.throws(() => readZip(scheduleZip(), { maxTotal: 1000 }), /total over/);
  assert.throws(() => readZip(one({ badCrc: true })), /checksum/);
  const local = one({ method: 0 }, { descriptor: false });
  local.writeUInt16LE(12, 8); // method 12 (bzip2) in the local header only: the central directory's 0 rules
  assert.ok(readZip(local));
  const central = one({ method: 0 }, { descriptor: false });
  central.writeUInt16LE(12, central.length - 22 - 46 - 5 + 10);
  assert.throws(() => readZip(central), /method 12/);
  const disk = one({});
  disk.writeUInt16LE(1, disk.length - 22 + 4);
  assert.throws(() => readZip(disk), /multi-disk/);
  const z = scheduleZip();
  assert.throws(() => readZip(z.subarray(0, z.length - 30)));
  assert.throws(() => readZip(Buffer.concat([z.subarray(0, 200), z.subarray(z.length - 300)])));
});
