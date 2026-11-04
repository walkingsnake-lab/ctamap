#!/usr/bin/env node
'use strict';
// Splits the CI's merged image into the boot image the server keeps for
// Set up a board (contract "Firmware"): everything before the first app
// slot (bootloader, partition table, initial OTA data). With the app build
// (ctaboard.ino.bin) after it, it's the merged image up to the app's end.
//
//   node scripts/split-merged.js build/ctaboard.ino.merged.bin build/ctaboard.ino.bin
//
// Writes build/ctaboard.ino.boot.bin, after checking the merged image's app
// is byte for byte the app build (so the two signed files really make it).

const fs = require('fs');
const path = require('path');
const { inspectMerged } = require('../server/board/setup-image');
const { inspectBoot } = require('../server/board/firmware');

function split(merged, app) {
  const info = inspectMerged(merged);
  if (info.end - info.app.offset !== app.length || !merged.subarray(info.app.offset, info.end).equals(app)) {
    throw new Error('the merged image\'s app isn\'t the app build: use the two files from the same build');
  }
  const boot = merged.subarray(0, info.app.offset);
  inspectBoot(boot);
  return { boot, version: info.version };
}

function main(argv) {
  const [mergedFile, appFile] = argv;
  if (!mergedFile || !appFile) throw new Error('usage: node scripts/split-merged.js <ctaboard.ino.merged.bin> <ctaboard.ino.bin>');
  const { boot, version } = split(fs.readFileSync(mergedFile), fs.readFileSync(appFile));
  const out = path.join(path.dirname(appFile), 'ctaboard.ino.boot.bin');
  fs.writeFileSync(out, boot);
  console.log(`${out}: ${boot.length} bytes (build ${version})`);
  return 0;
}

module.exports = { split };

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`split-merged: ${e.message}`); process.exitCode = 1; }
}
