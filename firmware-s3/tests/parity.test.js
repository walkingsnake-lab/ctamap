'use strict';
// The S3 firmware's renderer (firmware-s3/ctaboard/src/draw.cpp) must draw
// exactly what the reference renderer (server/board/draw.js) draws. Compiles
// the renderer natively and renders every scenario in
// firmware/tests/scenarios.js both ways. Needs a C++17 compiler (g++ or
// clang++); skipped without one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { build } = require('../../firmware/tests/scenarios');
const assets = require('../../scripts/build-firmware-assets');

const SRC = path.join(__dirname, '..', 'ctaboard', 'src');
const CXX = ['g++', 'clang++'].find((c) => spawnSync(c, ['--version']).status === 0);

// Compiles the given test sources with the platform-independent firmware
// sources into a temp binary. Returns its path.
function compile(main, extra = []) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 's3-')), 'bin');
  const srcs = [path.join(__dirname, main), ...['draw.cpp', 'json.cpp', ...extra].map((f) => path.join(SRC, f))];
  const r = spawnSync(CXX, ['-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-o', out, ...srcs], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return out;
}
module.exports = { compile, CXX };

test('S3 firmware draw.cpp matches draw.js pixel for pixel', { skip: !CXX && 'no C++ compiler' }, async () => {
  const bin = compile('parity.cpp');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 's3-parity-')), 'scenarios.json');
  fs.writeFileSync(file, JSON.stringify(await build()));
  const r = spawnSync(bin, [file], { encoding: 'utf8', maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /, 0 differ/);
});

test('S3 firmware main loop (tests/app_test.cpp)', { skip: !CXX && 'no C++ compiler' }, () => {
  const bin = compile('app_test.cpp', ['app.cpp', 'player.cpp']);
  const r = spawnSync(bin, [], { encoding: 'utf8', maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('S3 firmware assets are current (run node scripts/build-firmware-assets.js)', () => {
  assert.equal(fs.readFileSync(assets.OUT_CPP, 'utf8'), assets.buildCpp());
});
