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
  for (const st of stations) assert.deepEqual(Object.keys(d[st.mapid]).filter((k) => k !== 'ends').sort(), [...st.lines].sort(), st.name);
  const at = (name, ln) => d[stations.find((s) => s.name === name && s.lines.includes(ln)).mapid][ln];
  const ends = (name) => d[stations.find((s) => s.name === name).mapid].ends || [];
  // Where trDr 1 trains head.
  assert.equal(at('Morse', 'RD'), 'N');
  assert.equal(at('Jarvis', 'RD'), 'N', 'Red counts as north-south on the diagonal');
  assert.equal(at('Belmont', 'BR'), 'N');
  assert.equal(at('Western', 'BR'), 'W', 'Kimball-bound');
  assert.equal(at('Clark/Lake', 'BR'), 'loop');
  assert.equal(at('Cicero', 'BL'), 'E', "O'Hare-bound on the Forest Park branch heads east, toward downtown");
  assert.equal(at('Jefferson Park', 'BL'), 'W');
  assert.equal(at('Logan Square', 'BL'), 'diag');
  assert.equal(at('Garfield', 'GR'), 'N');
  assert.equal(at('Ashland', 'GR'), 'W');
  assert.equal(at('Ashland', 'PK'), 'E', 'Loop-bound');
  assert.equal(at('Pulaski', 'OR'), 'E', 'Loop-bound');
  // Where the track ends.
  assert.deepEqual(ends('Kimball'), ['BR']);
  assert.deepEqual(ends('95th/Dan Ryan'), ['RD']);
  assert.deepEqual(ends('Jefferson Park'), [], 'a short-turn end, not a terminal');
});
