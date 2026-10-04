'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { measure } = require('./fonts');
const { HEADER_NAME_PX, SHORT_NAMES } = require('./station-names');

test('header budget matches the widest clock plus a 3px gap', () => {
  assert.equal(HEADER_NAME_PX, 62 - measure('small', '12:59') - 3);
});

test('every curated short name fits the header', () => {
  for (const [name, short] of Object.entries(SHORT_NAMES)) {
    assert.ok(measure('small', short) <= HEADER_NAME_PX, `${name} -> ${short} is ${measure('small', short)}px`);
    assert.equal(short, short.toUpperCase(), `${short} must be uppercase (Tom Thumb text)`);
  }
});

const stationsFile = path.join(__dirname, 'stations.json');
test('every station in stations.json has a fitting short name', { skip: !fs.existsSync(stationsFile) && 'stations.json not built yet' }, () => {
  const stations = JSON.parse(fs.readFileSync(stationsFile, 'utf8'));
  assert.ok(stations.length > 100);
  for (const s of stations) {
    assert.ok(measure('small', s.short) <= HEADER_NAME_PX, `${s.name}: ${s.short}`);
    assert.ok(s.lines.length > 0, `${s.name} has no lines`);
  }
  assert.equal(stations.find((s) => s.mapid === '40100').short, 'MORSE');
});
