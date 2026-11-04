'use strict';
// scripts/setup-board.js: the settings it writes read back in the firmware
// exactly (config::from_json), the merged image is cut so TinyUF2 and the
// rest of flash stay, and the settings image holds what Preferences reads.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const s = require('../../scripts/setup-board');
const { compile, CXX } = require('./cxx');

// ---- a merged image like arduino-esp32's (TinyUF2 8MB partitions) ----

function partitionEntry(type, subtype, offset, size, label) {
  const e = Buffer.alloc(32, 0);
  e[0] = 0xaa; e[1] = 0x50; e[2] = type; e[3] = subtype;
  e.writeUInt32LE(offset, 4); e.writeUInt32LE(size, 8);
  e.write(label, 12, 'latin1');
  return e;
}

// An app image: header, two segments (the build mark in one), checksum
// padding and the appended SHA-256.
function appImage(mark) {
  const seg = (len, fill) => { const b = Buffer.alloc(8 + len, fill); b.writeUInt32LE(0x3c000000, 0); b.writeUInt32LE(len, 4); return b; };
  const h = Buffer.alloc(24, 0);
  h[0] = 0xe9; h[1] = 2; h.writeUInt16LE(9, 12); h[23] = 1;
  const s1 = seg(100, 0x11); s1.write(mark, 8 + 10, 'latin1');
  const s2 = seg(50, 0x22);
  let body = Buffer.concat([h, s1, s2]);
  const padded = Math.ceil((body.length + 1) / 16) * 16;
  body = Buffer.concat([body, Buffer.alloc(padded - body.length, 0), Buffer.alloc(32, 0x5a)]);
  return body;
}

function mergedImage({ mark = 'CTABOARD-BUILD:a1b2c3d:generic;', chip = 9, pad = 0x60000, tables = true } = {}) {
  const img = Buffer.alloc(pad, 0xff);
  img[0] = 0xe9; img.writeUInt16LE(chip, 12); // bootloader header
  if (tables) {
    [partitionEntry(1, 2, 0x9000, 0x5000, 'nvs'), partitionEntry(1, 0, 0xe000, 0x2000, 'otadata'),
      partitionEntry(0, 0x10, 0x10000, 0x200000, 'ota_0'), partitionEntry(0, 0x11, 0x210000, 0x200000, 'ota_1'),
      partitionEntry(0, 0, 0x410000, 0x40000, 'uf2'), partitionEntry(1, 0x81, 0x450000, 0x3b0000, 'ffat')]
      .forEach((e, i) => e.copy(img, 0x8000 + i * 32));
    img.writeUInt32LE(1, 0xe000); // boot_app0: ota_seq 1
  }
  const app = appImage(mark);
  app.copy(img, 0x10000);
  return { img, appLen: app.length };
}

test('settings: the firmware reads back exactly what the script writes', { skip: !CXX && 'no C++ compiler' }, () => {
  const json = s.boardConfig({ id: 'kitchen', token: 'tok"en\\x', networks: [['Joe\'s "wifi"', 'pässword1']], setupName: 'Board-QX4P', setupPass: 'abcdefghjk' });
  assert.deepEqual(Object.keys(JSON.parse(json)), s.FIELDS);
  const bin = compile('config_roundtrip.cpp', ['config.cpp']);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), 'cfg.json');
  fs.writeFileSync(file, json);
  const r = spawnSync(bin, [file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), JSON.parse(json));
});

test('settings: WiFi rules and the setup network', () => {
  assert.deepEqual(s.parseWifi('home=password1'), ['home', 'password1']);
  assert.deepEqual(s.parseWifi('cafe'), ['cafe', '']);
  assert.deepEqual(s.parseWifi('a=b=c=d=1234'), ['a', 'b=c=d=1234']);
  assert.throws(() => s.parseWifi('home=short'), /8-63/);
  assert.throws(() => s.parseWifi('=password1'), /name/);
  const net = s.setupNetwork();
  assert.match(net.name, /^Board-[A-Z2-9]{4}$/);
  assert.match(net.pass, /^[a-z2-9]{10}$/);
  assert.doesNotMatch(net.pass + net.name.slice(6).toLowerCase(), /[ilo01]/); // no look-alikes
  // Uniform: bytes past the last multiple of the alphabet are skipped.
  let i = 0;
  const seq = [255, 248, 0, 31];
  assert.equal(s.randomText(2, (n) => Buffer.from(Array.from({ length: n }, () => seq[i++ % seq.length]))), 'aa');
});

test('build: version, NVS partition and app end from a merged image', () => {
  const { img, appLen } = mergedImage();
  const info = s.inspectMerged(img);
  assert.deepEqual(info, { version: 'a1b2c3d', nvs: { offset: 0x9000, size: 0x5000 }, app: { offset: 0x10000, size: 0x200000 }, end: 0x10000 + appLen });
  // Just the part up to the app's end is enough (what the server sends the browser).
  assert.deepEqual(s.inspectMerged(img.subarray(0, info.end)), info);
  assert.deepEqual(s.partitions(img).map((p) => p.label), ['nvs', 'otadata', 'ota_0', 'ota_1', 'uf2', 'ffat']);
});

test('build: refuses images that would break a board or leak secrets', () => {
  const bad = (opts, re) => assert.throws(() => s.inspectMerged(mergedImage(opts).img), re);
  bad({ mark: 'CTABOARD-BUILD:a1b2c3d:setup;' }, /secrets\.h/);
  bad({ mark: 'CTABOARD-BUILD:dev:generic;' }, /clean commit/);
  bad({ mark: 'CTABOARD-BUILD:a1b2c3d_dirty:generic;' }, /clean commit/);
  bad({ mark: 'nothing' }, /build mark/);
  bad({ chip: 0 }, /ESP32-S3/);
  bad({ tables: false }, /NVS partition/);
  assert.throws(() => s.inspectMerged(appImage('CTABOARD-BUILD:a1b2c3d:generic;')), /merged image/); // the app alone
});

test('flash plan: the settings in their partition, nothing past the app (TinyUF2 stays)', () => {
  const { img } = mergedImage();
  const info = s.inspectMerged(img);
  const nvs = Buffer.alloc(0x5000, 0x77);
  const plan = s.flashPlan(img, nvs, info.nvs, info.end);
  assert.deepEqual(plan.map((p) => [p.offset, p.data.length]), [[0, 0x9000], [0x9000, 0x5000], [0xe000, info.end - 0xe000]]);
  // Pieces touch end to end and stop at the app's end, far below 0x410000.
  for (let k = 1; k < plan.length; k++) assert.equal(plan[k].offset, plan[k - 1].offset + plan[k - 1].data.length);
  assert.ok(info.end < 0x410000);
  assert.ok(plan[2].data.equals(img.subarray(0xe000, info.end)));
  assert.throws(() => s.flashPlan(img, Buffer.alloc(100), info.nvs, info.end), /settings image/);
});

// ---- the settings image: read it the way the firmware's NVS would ----

// Minimal NVS reader (ESP-IDF page format): 4 KB pages, 32-byte header, a
// 32-byte entry-state bitmap, then 126 32-byte entries. A string (type 0x21)
// holds its size in the entry's data and its bytes in the next span-1 entries.
function readNvsStrings(img) {
  const out = {};
  const ns = {};
  for (let page = 0; page < img.length; page += 4096) {
    if (img.readUInt32LE(page) === 0xffffffff) continue; // empty page
    for (let e = 0; e < 126;) {
      const at = page + 64 + e * 32;
      const nsIdx = img[at], type = img[at + 1], span = img[at + 2] || 1;
      const key = img.toString('latin1', at + 8, at + 24).replace(/\0.*$/s, '');
      if (type === 0xff) { e++; continue; }
      if (nsIdx === 0 && type === 0x01) ns[img[at + 24]] = key;
      if (type === 0x21) {
        const size = img.readUInt16LE(at + 24);
        out[`${ns[nsIdx]}/${key}`] = img.toString('utf8', at + 32, at + 32 + size - 1); // stored with its NUL
      }
      e += span;
    }
  }
  return out;
}

const nvsGen = ['python3', 'python'].find((py) => spawnSync(py, ['-m', 'esp_idf_nvs_partition_gen', '--help']).status === 0);
const S = require('../../server/board/setup-image');
const CFG = s.boardConfig({ id: 'kitchen', token: 'x'.repeat(32), url: 'https://ctamap.fly.dev', networks: [['a,b "c"', 'pässword1']], setupName: 'Board-AB12', setupPass: 'abcdefghjk' });

test('settings image: Preferences finds ctaboard/cfg with the exact JSON', () => {
  const img = Buffer.from(S.nvsImage({ value: CFG, size: 0x5000 }));
  assert.equal(img.length, 0x5000);
  assert.equal(readNvsStrings(img)['ctaboard/cfg'], CFG);
  // Header and entry CRCs as NVS checks them.
  assert.equal(img.readUInt32LE(28), S.crc32(img.subarray(4, 28), 0xffffffff));
  const e = img.subarray(64, 96);
  assert.equal(e.readUInt32LE(4), S.crc32(Buffer.concat([e.subarray(0, 4), e.subarray(8, 32)]), 0xffffffff));
  assert.equal(S.crc32(Buffer.from('123456789')), 0xcbf43926); // the standard CRC-32 check value
  assert.throws(() => S.nvsImage({ value: 'y'.repeat(3990), size: 0x3000 }), /one NVS page/);
  assert.throws(() => S.nvsImage({ value: CFG, size: 0x1000 }), /multiple of 4096/);
});

test('settings image: byte for byte what ESP-IDF\'s nvs_partition_gen makes', { skip: !nvsGen && 'no esp-idf-nvs-partition-gen' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvs-'));
  for (const [name, value] of [['cfg', CFG], ['empty', ''], ['edge', 'y'.repeat(32)], ['long', 'y'.repeat(3935)]]) {
    fs.writeFileSync(path.join(dir, `${name}.json`), value);
    const csv = path.join(dir, `${name}.csv`);
    fs.writeFileSync(csv, `key,type,encoding,value\nctaboard,namespace,,\ncfg,file,string,${path.join(dir, `${name}.json`)}\n`);
    const r = spawnSync(nvsGen, ['-m', 'esp_idf_nvs_partition_gen', 'generate', csv, path.join(dir, `${name}.bin`), '0x5000'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.readFileSync(path.join(dir, `${name}.bin`)).equals(Buffer.from(S.nvsImage({ value, size: 0x5000 }))), name);
  }
});

test('label: both QR codes, names escaped, WiFi QR text escaped', async () => {
  const html = await s.labelHtml({ id: 'kitchen', label: '<Kitchen>', setupName: 'Board-AB;C', setupPass: 'abc:defgh', ownerUrl: 'https://x/board/c/abc/' });
  assert.equal((html.match(/<svg/g) || []).length, 2);
  assert.ok(!html.includes('<Kitchen>') && html.includes('&#60;Kitchen&#62;'));
  const noOwner = await s.labelHtml({ id: 'mine', setupName: 'Board-AB12', setupPass: 'abcdefghjk', ownerUrl: null });
  assert.equal((noOwner.match(/<svg/g) || []).length, 1);
});

test('split-merged: the boot image is everything before the app, and the app must be the app build', () => {
  const { split } = require('../../scripts/split-merged');
  const { img, appLen } = mergedImage();
  const app = img.subarray(0x10000, 0x10000 + appLen);
  const { boot, version } = split(img, Buffer.from(app));
  assert.equal(version, 'a1b2c3d');
  assert.ok(boot.equals(img.subarray(0, 0x10000)));
  // Boot + app is the merged image up to the app's end: what the page flashes.
  const both = Buffer.concat([boot, app]);
  assert.deepEqual(s.inspectMerged(both), s.inspectMerged(img));
  const other = Buffer.from(app); other[40] ^= 1;
  assert.throws(() => split(img, other), /isn't the app build/);
  assert.throws(() => split(img, app.subarray(0, 100)), /isn't the app build/);
});
