'use strict';
// Signed OTA builds: src/signing_key.h stays in step with the repo's public
// key, the C string the board parses is the PEM byte for byte, and
// scripts/sign-firmware.js makes signatures the server (and so the board,
// which checks the same DER ECDSA signature with mbedtls) accepts.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { headerFor, PUB_FILE, HEADER_FILE } = require('../../scripts/firmware-key');
const { sign } = require('../../scripts/sign-firmware');
const { verifySignature } = require('../../server/board/firmware');
const { CXX } = require('./cxx');

const ROOT = path.join(__dirname, '..', '..');

test('signing_key.h matches the repo\'s public key (run node scripts/firmware-key.js)', () => {
  const pem = fs.existsSync(PUB_FILE) ? fs.readFileSync(PUB_FILE, 'utf8') : null;
  assert.equal(fs.readFileSync(HEADER_FILE, 'utf8'), headerFor(pem));
});

test('the header holds the PEM exactly, as the board parses it', { skip: !CXX && 'no C++ compiler' }, () => {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigkey-'));
  fs.writeFileSync(path.join(dir, 'signing_key.h'), headerFor(pem));
  fs.writeFileSync(path.join(dir, 'main.cpp'), '#include <stdio.h>\n#include "signing_key.h"\nint main() { fputs(FIRMWARE_SIGNING_KEY, stdout); return sizeof FIRMWARE_SIGNING_KEY == __builtin_strlen(FIRMWARE_SIGNING_KEY) + 1 ? 0 : 3; }\n');
  const bin = path.join(dir, 'main');
  let r = spawnSync(CXX, ['-std=c++17', '-Wall', '-Werror', '-o', bin, path.join(dir, 'main.cpp')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  r = spawnSync(bin, [], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, pem);
  // The empty placeholder: no key, so the board installs nothing.
  assert.match(headerFor(null), /FIRMWARE_SIGNING_KEY\[\] =\n {4}"";/);
});

test('sign-firmware: signatures verify, and only with the matching key', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const buf = crypto.randomBytes(5000);
  const sig = sign(buf, pem);
  assert.match(sig, /^[0-9a-f]+$/);
  assert.ok(verifySignature(buf, sig, publicKey));
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey;
  assert.ok(!verifySignature(buf, sig, other));
});

test('sign-firmware: refuses to sign without the repo\'s public key to check against', { skip: fs.existsSync(PUB_FILE) && 'the repo has a key' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-'));
  const file = path.join(dir, 'b.bin');
  fs.writeFileSync(file, 'x');
  const key = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sign-firmware.js'), file], { encoding: 'utf8', env: { ...process.env, FIRMWARE_SIGNING_KEY: key } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no public key/);
  assert.ok(!fs.existsSync(`${file}.sig`));
});
