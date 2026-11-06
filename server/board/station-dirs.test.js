'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const build = require('../../scripts/build-station-dirs');
const stations = require('./stations.json');

test('station-dirs.json is current (node scripts/build-station-dirs.js)', () => {
  assert.equal(fs.readFileSync(build.OUT, 'utf8'), build.text());
});

test('station-dirs: every station and line, with the expected headings at known stations', () => {
  const d = require('./station-dirs.json');
  assert.deepEqual(Object.keys(d).sort(), stations.map((s) => s.mapid).sort());
  for (const st of stations) assert.deepEqual(Object.keys(d[st.mapid]).sort(), [...st.lines].sort(), st.name);
  const at = (name, ln) => d[stations.find((s) => s.name === name && s.lines.includes(ln)).mapid][ln];
  assert.equal(at('Morse', 'RD'), 'ns');
  assert.equal(at('Jarvis', 'RD'), 'ns', 'Red counts as north-south on the diagonal');
  assert.equal(at('Belmont', 'BR'), 'ns');
  assert.equal(at('Western', 'BR'), 'ew');
  assert.equal(at('Clark/Lake', 'BR'), 'loop');
  assert.equal(at('Clark/Lake', 'BL'), 'ew');
  assert.equal(at('Garfield', 'GR'), 'ns');
  assert.equal(at('Ashland', 'GR'), 'ew');
});
