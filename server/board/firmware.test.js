'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFirmware, inspect, FirmwareError, MAX_BUILDS } = require('./firmware');

const quiet = { warn() {}, error() {} };

// A stand-in for ctaboard.ino.bin: an ESP32-S3 app image header and the
// build mark somewhere inside (contract: "Firmware").
function fakeBuild(v, { kind = 'generic', chip = 9, size = 4096, magic = 0xe9 } = {}) {
  const b = Buffer.alloc(size, 0x11);
  b[0] = magic;
  b.writeUInt16LE(chip, 12);
  b.write(`CTABOARD-BUILD:${v}:${kind};`, 1000, 'latin1');
  return b;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'board-fw-'));
const S3 = { hd: 'adafruit_matrixportal_s3' };

test('inspect: takes a generic S3 build and reads its version from the build mark', () => {
  assert.deepEqual(inspect(fakeBuild('a1b2c3d')), { v: 'a1b2c3d' });
});

test('inspect: refuses anything that could hurt a board or leak secrets', () => {
  const bad = (buf, re) => assert.throws(() => inspect(buf), (e) => e instanceof FirmwareError && re.test(e.message));
  bad(Buffer.from('hello'), /not an ESP32 app image/);
  bad(fakeBuild('a1b2c3d', { magic: 0x89 }), /not an ESP32 app image/);
  bad(fakeBuild('a1b2c3d', { chip: 0 }), /another chip/);
  bad(fakeBuild('a1b2c3d', { kind: 'setup' }), /secrets\.h/);
  bad(fakeBuild('dev'), /unstamped/);
  bad(fakeBuild('a1b2c3d_dirty'), /uncommitted/);
  const merged = fakeBuild('a1b2c3d', { size: 0x9000 });
  merged[0x8000] = 0xaa;
  merged[0x8001] = 0x50;
  bad(merged, /merged image/);
  const plain = Buffer.alloc(4096, 0);
  plain[0] = 0xe9;
  plain.writeUInt16LE(9, 12);
  bad(plain, /no build mark/);
});

test('upload stores the build with its SHA-256; channels point at builds', () => {
  const dir = tmp();
  const fw = createFirmware({ dir, log: quiet });
  const buf = fakeBuild('a1b2c3d');
  let st = fw.upload(buf, { channel: 'beta', now: 100 });
  assert.equal(st.channels.beta, 'a1b2c3d');
  assert.equal(st.channels.stable, null);
  assert.deepEqual(st.builds, [{ v: 'a1b2c3d', size: 4096, sha: crypto.createHash('sha256').update(buf).digest('hex'), at: 100 }]);
  assert.deepEqual(fs.readFileSync(fw.file('a1b2c3d').path), buf);
  st = fw.setChannel('stable', 'a1b2c3d');
  assert.equal(st.channels.stable, 'a1b2c3d');
  assert.throws(() => fw.setChannel('stable', 'fffffff'), /unknown build/);
  assert.throws(() => fw.setChannel('nightly', 'a1b2c3d'), /channel/);
  // Survives a restart.
  const again = createFirmware({ dir, log: quiet });
  assert.deepEqual(again.status(), fw.status());
});

test('remove keeps builds a channel or a board uses', () => {
  const fw = createFirmware({ dir: tmp(), log: quiet });
  fw.upload(fakeBuild('aaaaaaa'), { channel: 'stable', now: 1 });
  fw.upload(fakeBuild('bbbbbbb'), { now: 2 });
  assert.throws(() => fw.remove('aaaaaaa'), /stable build/);
  assert.throws(() => fw.remove('bbbbbbb', ['bbbbbbb']), /pinned/);
  const p = fw.file('bbbbbbb').path;
  assert.equal(fw.remove('bbbbbbb').builds.length, 1);
  assert.ok(!fs.existsSync(p));
});

test('old builds are pruned, except channel and pinned ones', () => {
  const fw = createFirmware({ dir: tmp(), log: quiet });
  fw.upload(fakeBuild('0000000'), { channel: 'stable', now: 0 });
  fw.upload(fakeBuild('1111111'), { now: 1 });
  for (let i = 2; i <= MAX_BUILDS + 1; i++) fw.upload(fakeBuild(`${i}`.repeat(7)), { now: i, pinned: ['1111111'] });
  const vs = fw.status().builds.map((b) => b.v);
  assert.equal(vs.length, MAX_BUILDS);
  assert.ok(vs.includes('0000000') && vs.includes('1111111'));
  assert.ok(!vs.includes('2222222')); // the oldest unused one went
});

test('offer: an S3 running a committed build gets its channel\'s or pinned build', () => {
  const fw = createFirmware({ dir: tmp(), log: quiet });
  fw.upload(fakeBuild('aaaaaaa'), { channel: 'stable', now: 1 });
  fw.upload(fakeBuild('bbbbbbb'), { channel: 'beta', now: 2 });
  const t = fw.target('stable');
  assert.deepEqual(fw.offer({ fw: 'stable', fwRetry: 3 }, { ...S3, hv: '1234567' }), { v: 'aaaaaaa', size: 4096, sha: t.sha, n: 3 });
  assert.equal(fw.offer({ fw: 'beta' }, { ...S3, hv: '1234567' }).v, 'bbbbbbb');
  assert.equal(fw.offer({}, { ...S3, hv: '1234567' }).v, 'aaaaaaa'); // default: stable
  assert.equal(fw.offer({ fw: 'aaaaaaa' }, { ...S3, hv: 'bbbbbbb' }).v, 'aaaaaaa'); // pinned: back down
  assert.equal(fw.offer({ fw: 'stable' }, { ...S3, hv: 'aaaaaaa' }), null); // already running it
  assert.equal(fw.offer({ fw: 'off' }, { ...S3, hv: '1234567' }), null);
  assert.equal(fw.offer({ fw: 'ccccccc' }, { ...S3, hv: '1234567' }), null); // pinned to a build that's gone
  assert.equal(fw.offer({ fw: 'stable' }, { hv: '1234567' }), null); // the M4 (or no hardware report)
  assert.equal(fw.offer({ fw: 'stable' }, { ...S3, hv: 'dev' }), null); // someone's test build
  assert.equal(fw.offer({ fw: 'stable' }, { ...S3, hv: '1234567_dirty' }), null);
  assert.equal(fw.offer({ fw: 'stable' }, S3), null);
});
