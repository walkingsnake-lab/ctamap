'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFirmware, inStableWindow, inspect, FirmwareError, MAX_BUILDS, loadPublicKey, verifySignature } = require('./firmware');

// A test signing key (the real one never leaves its owner's computer and CI).
const { privateKey: KEY, publicKey: PUB } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const signOf = (buf, key = KEY) => crypto.sign('sha256', buf, key).toString('hex');

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
  const fw = createFirmware({ dir, log: quiet, publicKey: PUB });
  const buf = fakeBuild('a1b2c3d');
  let st = fw.upload(buf, { sig: signOf(buf), channel: 'beta', now: 100 });
  assert.equal(st.channels.beta, 'a1b2c3d');
  assert.equal(st.channels.stable, null);
  assert.deepEqual(st.builds, [{ v: 'a1b2c3d', size: 4096, sha: crypto.createHash('sha256').update(buf).digest('hex'), at: 100, signed: true, boot: false }]);
  assert.deepEqual(fs.readFileSync(fw.file('a1b2c3d').path), buf);
  st = fw.setChannel('stable', 'a1b2c3d');
  assert.equal(st.channels.stable, 'a1b2c3d');
  assert.throws(() => fw.setChannel('stable', 'fffffff'), /unknown build/);
  assert.throws(() => fw.setChannel('nightly', 'a1b2c3d'), /channel/);
  // Survives a restart.
  const again = createFirmware({ dir, log: quiet, publicKey: PUB });
  assert.deepEqual(again.status(), fw.status());
});

test('remove keeps builds a channel or a board uses', () => {
  const fw = createFirmware({ dir: tmp(), log: quiet, publicKey: PUB });
  fw.upload(fakeBuild('aaaaaaa'), { sig: signOf(fakeBuild('aaaaaaa')), channel: 'stable', now: 1 });
  fw.upload(fakeBuild('bbbbbbb'), { sig: signOf(fakeBuild('bbbbbbb')), now: 2 });
  assert.throws(() => fw.remove('aaaaaaa'), /stable build/);
  assert.throws(() => fw.remove('bbbbbbb', ['bbbbbbb']), /pinned/);
  const p = fw.file('bbbbbbb').path;
  assert.equal(fw.remove('bbbbbbb').builds.length, 1);
  assert.ok(!fs.existsSync(p));
});

test('old builds are pruned, except channel and pinned ones', () => {
  const fw = createFirmware({ dir: tmp(), log: quiet, publicKey: PUB });
  fw.upload(fakeBuild('0000000'), { sig: signOf(fakeBuild('0000000')), channel: 'stable', now: 0 });
  fw.upload(fakeBuild('1111111'), { sig: signOf(fakeBuild('1111111')), now: 1 });
  for (let i = 2; i <= MAX_BUILDS + 1; i++) { const b = fakeBuild(`${i}`.repeat(7)); fw.upload(b, { sig: signOf(b), now: i, pinned: ['1111111'] }); }
  const vs = fw.status().builds.map((b) => b.v);
  assert.equal(vs.length, MAX_BUILDS);
  assert.ok(vs.includes('0000000') && vs.includes('1111111'));
  assert.ok(!vs.includes('2222222')); // the oldest unused one went
});

test('offer: an S3 running a committed build gets its channel\'s or pinned build', () => {
  const fw = createFirmware({ dir: tmp(), log: quiet, publicKey: PUB, stableWindow: () => true });
  fw.upload(fakeBuild('aaaaaaa'), { sig: signOf(fakeBuild('aaaaaaa')), channel: 'stable', now: 1 });
  fw.upload(fakeBuild('bbbbbbb'), { sig: signOf(fakeBuild('bbbbbbb')), channel: 'beta', now: 2 });
  const t = fw.target('stable');
  assert.deepEqual(fw.offer({ fw: 'stable', fwRetry: 3 }, { ...S3, hv: '1234567' }), { v: 'aaaaaaa', size: 4096, sha: t.sha, n: 3, sig: t.sig });
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

test('offer: stable installs only overnight in Chicago; beta and pinned builds any time', () => {
  const fw = createFirmware({ dir: tmp(), log: quiet, publicKey: PUB });
  fw.upload(fakeBuild('aaaaaaa'), { sig: signOf(fakeBuild('aaaaaaa')), channel: 'stable', now: 1 });
  fw.upload(fakeBuild('bbbbbbb'), { sig: signOf(fakeBuild('bbbbbbb')), channel: 'beta', now: 2 });
  const at = (y, m, d, h, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000; // UTC
  const q = { ...S3, hv: '1234567' };
  // Nov 3, 2026 (CST, UTC-6): 1:59 no, 2:00 yes, 4:59 yes, 5:00 no.
  assert.equal(fw.offer({ fw: 'stable' }, q, at(2026, 11, 3, 7, 59)), null);
  assert.equal(fw.offer({ fw: 'stable' }, q, at(2026, 11, 3, 8, 0)).v, 'aaaaaaa');
  assert.equal(fw.offer({}, q, at(2026, 11, 3, 10, 59)).v, 'aaaaaaa'); // default: stable
  assert.equal(fw.offer({ fw: 'stable' }, q, at(2026, 11, 3, 11, 0)), null);
  // July (CDT, UTC-5): 2:30 AM is 7:30 UTC.
  assert.equal(fw.offer({ fw: 'stable' }, q, at(2026, 7, 1, 7, 30)).v, 'aaaaaaa');
  assert.equal(fw.offer({ fw: 'stable' }, q, at(2026, 7, 1, 6, 30)), null);
  // Midday: beta and a pinned build still come right away.
  const noon = at(2026, 11, 3, 18);
  assert.equal(fw.offer({ fw: 'beta' }, q, noon).v, 'bbbbbbb');
  assert.equal(fw.offer({ fw: 'aaaaaaa' }, q, noon).v, 'aaaaaaa');
  // Midday, just started (uptime under 2 min): stable too, before anyone is watching.
  assert.equal(fw.offer({ fw: 'stable' }, { ...q, hu: '45' }, noon).v, 'aaaaaaa');
  assert.equal(fw.offer({ fw: 'stable' }, { ...q, hu: '600' }, noon), null);
  assert.equal(inStableWindow(at(2026, 11, 3, 9)), true);
  assert.equal(inStableWindow(noon), false);
});

test('signatures: uploads need a valid one by the repo key; offers carry it', () => {
  const fw = createFirmware({ dir: tmp(), log: quiet, publicKey: PUB, stableWindow: () => true });
  const buf = fakeBuild('aaaaaaa');
  assert.throws(() => fw.upload(buf, {}), /unsigned/);
  assert.throws(() => fw.upload(buf, { sig: 'zz' }), /doesn't match/);
  assert.throws(() => fw.upload(buf, { sig: signOf(fakeBuild('bbbbbbb')) }), /doesn't match/); // another build's
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  assert.throws(() => fw.upload(buf, { sig: signOf(buf, other) }), /doesn't match/); // another key
  const sig = signOf(buf);
  fw.upload(buf, { sig: sig.toUpperCase(), channel: 'stable', now: 1 });
  assert.equal(fw.offer({ fw: 'stable' }, { hd: 'adafruit_matrixportal_s3', hv: '1234567' }).sig, sig);
  assert.equal(fw.status().builds[0].signed, true);
  assert.equal(fw.status().signing, true);
  // Without a public key in the repo, nothing is accepted.
  const none = createFirmware({ dir: tmp(), log: quiet, publicKey: null });
  assert.throws(() => none.upload(buf, { sig }), /no signing key/);
  assert.equal(none.status().signing, false);
});

test('signatures: the repo key file, and what the board checks', () => {
  const dir = tmp();
  assert.equal(loadPublicKey(path.join(dir, 'missing.pem')), null);
  fs.writeFileSync(path.join(dir, 'k.pem'), PUB.export({ type: 'spki', format: 'pem' }));
  const k = loadPublicKey(path.join(dir, 'k.pem'));
  const buf = fakeBuild('aaaaaaa');
  assert.ok(verifySignature(buf, signOf(buf), k));
  assert.ok(!verifySignature(Buffer.concat([buf, Buffer.from([0])]), signOf(buf), k));
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
  fs.writeFileSync(path.join(dir, 'rsa.pem'), rsa.export({ type: 'spki', format: 'pem' }));
  assert.throws(() => loadPublicKey(path.join(dir, 'rsa.pem')), /P-256/);
});

// ---- boot images (Set up a board) ----

// The merged image's first part, as scripts/split-merged.js cuts it: the
// bootloader header, the partition table at 0x8000 (TinyUF2 8MB), up to
// the first app slot at 0x10000.
function fakeBoot({ chip = 9, appAt = 0x10000, appSize = 0x200000 } = {}) {
  const b = Buffer.alloc(appAt, 0xff);
  b[0] = 0xe9; b.writeUInt16LE(chip, 12);
  const entry = (i, type, sub, off, size, label) => {
    const at = 0x8000 + i * 32;
    b[at] = 0xaa; b[at + 1] = 0x50; b[at + 2] = type; b[at + 3] = sub;
    b.writeUInt32LE(off, at + 4); b.writeUInt32LE(size, at + 8); b.fill(0, at + 12, at + 28); b.write(label, at + 12, 'latin1');
  };
  entry(0, 1, 2, 0x9000, 0x5000, 'nvs'); entry(1, 1, 0, 0xe000, 0x2000, 'otadata');
  entry(2, 0, 0x10, appAt, appSize, 'ota_0'); entry(3, 0, 0x11, appAt + appSize, appSize, 'ota_1');
  return b;
}
// A real-shaped app image (header, segments, checksum padding, SHA-256), so
// the setup tools can find its end.
function fakeApp(v) {
  const seg = (len) => { const s = Buffer.alloc(8 + len, 0x22); s.writeUInt32LE(0x3c000000, 0); s.writeUInt32LE(len, 4); return s; };
  const h = Buffer.alloc(24, 0); h[0] = 0xe9; h[1] = 1; h.writeUInt16LE(9, 12); h[23] = 1;
  const s1 = seg(2000); s1.write(`CTABOARD-BUILD:${v}:generic;`, 100, 'latin1');
  let body = Buffer.concat([h, s1]);
  body = Buffer.concat([body, Buffer.alloc(Math.ceil((body.length + 1) / 16) * 16 - body.length, 0), Buffer.alloc(32, 0x5a)]);
  return body;
}

test('boot image: checked, signed, and with the app makes the image a new board is flashed with', () => {
  const { inspectBoot } = require('./firmware');
  const S = require('./setup-image');
  const fw = createFirmware({ dir: tmp(), log: quiet, publicKey: PUB });
  const app = fakeApp('aaaaaaa');
  fw.upload(app, { sig: signOf(app), channel: 'stable', now: 1 });
  const boot = fakeBoot();
  assert.equal(fw.image('aaaaaaa'), null, 'no boot image yet');
  assert.throws(() => fw.attachBoot('bbbbbbb', boot, { sig: signOf(boot) }), /unknown build/);
  assert.throws(() => fw.attachBoot('aaaaaaa', boot, {}), /unsigned/);
  assert.throws(() => fw.attachBoot('aaaaaaa', boot, { sig: signOf(app) }), /signature/);
  const st = fw.attachBoot('aaaaaaa', boot, { sig: signOf(boot) });
  assert.equal(st.builds[0].boot, true);
  const img = fw.image('aaaaaaa');
  assert.ok(img.equals(Buffer.concat([boot, app])));
  // It's the merged image up to the app's end: the setup tools take it as is.
  const info = S.inspectMerged(img);
  assert.deepEqual([info.version, info.nvs.offset, info.app.offset, info.end], ['aaaaaaa', 0x9000, 0x10000, img.length]);
  // Bad boot images.
  const bad = (buf, re) => assert.throws(() => inspectBoot(buf), (e) => e instanceof FirmwareError && re.test(e.message));
  bad(Buffer.from('nope'), /not a boot image/);
  bad(fakeBoot({ chip: 0 }), /another chip/);
  bad(fakeBoot().subarray(0, 0xc000), /must end where the first app slot starts/);
  bad(Buffer.concat([fakeBoot(), Buffer.alloc(16)]), /must end where/);
  bad(fakeBoot({ appSize: 0x100000 }), /smaller than an app build/);
  const noTable = fakeBoot(); noTable.fill(0xff, 0x8000, 0x9000);
  bad(noTable, /no partition table/);
  // Removing the build removes its boot image too.
  fw.setChannel('stable', null);
  fw.remove('aaaaaaa');
  assert.equal(fw.image('aaaaaaa'), null);
});
