'use strict';
// Builds firmware-s3 test programs natively: a test source from this folder
// with the platform-independent firmware sources. Needs a C++17 compiler
// (g++ or clang++); CXX is undefined without one, and the tests skip.

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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
