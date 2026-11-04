'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { tiles, OUT } = require('../../scripts/build-control-tiles');

test('control page tiles match the renderer (run node scripts/build-control-tiles.js)', async () => {
  const saved = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const now = await tiles();
  assert.deepEqual(Object.keys(saved).sort(), Object.keys(now).sort());
  for (const k of Object.keys(now)) assert.equal(saved[k], now[k], `tile ${k} is out of date`);
});
