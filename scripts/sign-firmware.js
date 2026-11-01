#!/usr/bin/env node
'use strict';
// Signs an OTA build: writes <file>.sig (ECDSA P-256 over SHA-256 of the
// file, hex DER), what the server needs with each upload and the board
// checks before installing (server/board/firmware.js, device.cpp).
//
//   node scripts/sign-firmware.js build/ctaboard.ino.bin [--key <pem file>]
//
// The key: $FIRMWARE_SIGNING_KEY (the PEM itself, as CI has it), --key, or
// ~/.ctaboard/firmware-signing-key.pem (scripts/firmware-key.js). The
// signature is checked against the repo's public key before it's written,
// so a build signed with the wrong key never leaves here.

const crypto = require('crypto');
const fs = require('fs');
const { KEY_FILE } = require('./firmware-key');
const { loadPublicKey, verifySignature, PUBLIC_KEY_FILE } = require('../server/board/firmware');

function sign(buf, privatePem) {
  return crypto.sign('sha256', buf, crypto.createPrivateKey(privatePem)).toString('hex');
}

function main(argv) {
  const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--key');
  const ki = argv.indexOf('--key');
  if (!file) throw new Error('usage: node scripts/sign-firmware.js <ctaboard.ino.bin> [--key <pem>]');
  const pem = process.env.FIRMWARE_SIGNING_KEY || fs.readFileSync(ki >= 0 ? argv[ki + 1] : KEY_FILE, 'utf8');
  const buf = fs.readFileSync(file);
  const sig = sign(buf, pem);
  const pub = loadPublicKey();
  if (!pub) throw new Error(`no public key in the repo (${PUBLIC_KEY_FILE}): run node scripts/firmware-key.js`);
  if (!verifySignature(buf, sig, pub)) throw new Error('this key doesn\'t match the repo\'s public key');
  fs.writeFileSync(`${file}.sig`, sig + '\n');
  console.log(`${file}.sig`);
  return 0;
}

module.exports = { sign };

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`sign-firmware: ${e.message}`); process.exitCode = 1; }
}
