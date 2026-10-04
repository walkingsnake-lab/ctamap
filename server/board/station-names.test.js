'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { measure } = require('./fonts');
const { HEADER_NAME_PX, SHORT_NAMES, dropOrdinals, shortName } = require('./station-names');

test('header budget matches the widest clock plus a 3px gap', () => {
  assert.equal(HEADER_NAME_PX, 62 - measure('small', '12:59') - 3);
});

test('every curated short name fits the header', () => {
  for (const [name, short] of Object.entries(SHORT_NAMES)) {
    assert.ok(measure('small', short) <= HEADER_NAME_PX, `${name} -> ${short} is ${measure('small', short)}px`);
    assert.equal(short, short.toUpperCase(), `${short} must be uppercase (Tom Thumb text)`);
  }
});

test('shortening drops ordinals before using a curated name', () => {
  assert.equal(dropOrdinals('95th/Dan Ryan'), '95/Dan Ryan');
  assert.equal(dropOrdinals('Ashland/63rd'), 'Ashland/63');
  assert.equal(dropOrdinals('51st'), '51');
  assert.equal(shortName('95th/Dan Ryan', measure), '95/DAN RYAN');
  assert.equal(shortName('35th/Archer', measure), '35/ARCHER');
  assert.equal(shortName('54th/Cermak', measure), '54/CERMAK');
  assert.equal(shortName('Ashland/63rd', measure), 'ASHLAND/63');
  assert.equal(shortName('35th-Bronzeville-IIT', measure), '35-IIT');
  // Names that fit keep their ordinals.
  assert.equal(shortName('95th', measure), '95TH');
  assert.equal(shortName('Morse', measure), 'MORSE');
  assert.equal(shortName('Clark/Division', measure), 'CLARK/DIV');
});

test('curated entries are only for names the ordinal rule cannot fix', () => {
  for (const name of Object.keys(SHORT_NAMES)) {
    assert.ok(measure('small', dropOrdinals(name.toUpperCase())) > HEADER_NAME_PX, `${name} doesn't need a curated entry`);
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
