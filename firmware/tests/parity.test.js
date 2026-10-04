'use strict';
// The board's renderer (firmware/boardlib/draw.py) must draw exactly what the
// reference renderer (server/board/draw.js) draws. Renders every scenario in
// scenarios.js both ways and compares pixels. Needs python3.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { build } = require('./scenarios');
const assets = require('../../scripts/build-firmware-assets');

const hasPython = spawnSync('python3', ['--version']).status === 0;

test('firmware draw.py matches draw.js pixel for pixel', { skip: !hasPython && 'python3 not found' }, async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-')), 'scenarios.json');
  fs.writeFileSync(file, JSON.stringify(await build()));
  const r = spawnSync('python3', [path.join(__dirname, 'parity.py'), file], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /, 0 differ/);
});

test('the board BoardFrame (palette bitmap) draws the same pixels', { skip: !hasPython && 'python3 not found' }, async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-')), 'scenarios.json');
  fs.writeFileSync(file, JSON.stringify(await build()));
  const r = spawnSync('python3', [path.join(__dirname, 'parity.py'), file, '--device'], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('board main loop (firmware/tests/test_*.py)', { skip: !hasPython && 'python3 not found' }, () => {
  const r = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', __dirname, '-p', 'test_*.py'], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('firmware assets are current (run node scripts/build-firmware-assets.js)', () => {
  assert.equal(fs.readFileSync(assets.OUT, 'utf8'), assets.build());
});
