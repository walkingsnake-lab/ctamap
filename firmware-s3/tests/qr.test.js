'use strict';
// The board's QR encoder (firmware-s3/ctaboard/src/qr.h, for the WiFi setup
// screen) must make the code the qrcode package makes for the same text:
// same version, same mask, every module. Needs a C++17 compiler.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const QRCode = require('qrcode');
const { wifiQrText } = require('../../server/board/setup-image');
const { compile, CXX } = require('./cxx');

const TEXTS = [
  wifiQrText('Board-3F9A', 'k7r2p9qdxw'),            // a board with a setup password: version 3
  'WIFI:T:nopass;S:Board-3F9A;;',                     // an open setup network: version 2
  'A', 'hello, world', 'x'.repeat(17), 'x'.repeat(18), 'y'.repeat(32), 'y'.repeat(33), 'z'.repeat(53),
  'WIFI:T:WPA;S:Café \;board;P:p\\:ss\\"word;;',  // escapes and a two-byte character
  ...Array.from({ length: 12 }, (_, i) => wifiQrText(`Board-${(0x1a2b + i * 4099).toString(16).toUpperCase().slice(0, 4)}`, `pw${i}abcdefgh`.slice(0, 10))),
];

test('S3 firmware QR codes match the qrcode package (tests/qr_test.cpp)', { skip: !CXX && 'no C++ compiler' }, () => {
  const bin = compile('qr_test.cpp');
  const r = spawnSync(bin, [...TEXTS, 'q'.repeat(54)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  TEXTS.forEach((text, i) => {
    const q = QRCode.create([{ data: Buffer.from(text, 'utf8'), mode: 'byte' }], { errorCorrectionLevel: 'L' });
    const want = `${q.modules.size} ${Array.from(q.modules.data, (b) => (b ? '1' : '0')).join('')}`;
    assert.ok(q.version <= 3, text);
    assert.equal(lines[i], want, `${JSON.stringify(text)} (version ${q.version}, mask ${q.maskPattern})`);
  });
  assert.equal(lines[TEXTS.length], 'none', '54 bytes is past version 3');
});
