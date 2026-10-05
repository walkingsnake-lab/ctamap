'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, ValidationError } = require('./state');

const quiet = { warn() {}, error() {} };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'board-state-'));

test('a fresh store starts with the home board at Morse and writes the file', () => {
  const dir = tmpDir();
  const store = createStore({ dir, log: quiet });
  const home = store.get('home');
  assert.equal(home.v, 1);
  assert.deepEqual(home.station, { mapid: '40100', name: 'MORSE' });
  assert.equal(home.screen, 'auto');
  assert.equal(home.bright, 'auto');
  assert.equal(home.radarEvery, 0);
  assert.equal(home.radarFor, 60);
  assert.ok(fs.existsSync(path.join(dir, 'board-state.json')));
});

test('state survives a restart (new store on the same dir)', () => {
  const dir = tmpDir();
  createStore({ dir, log: quiet }).update('home', { showWeather: false });
  const again = createStore({ dir, log: quiet });
  assert.equal(again.get('home').showWeather, false);
  assert.equal(again.get('home').v, 2);
});

test('updates bump v and picking a station fills in its short name', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  const b = store.update('home', { station: { mapid: '40850' } });
  assert.equal(b.v, 2);
  assert.deepEqual(b.station, { mapid: '40850', name: 'HW LIBRARY' });
  const c = store.update('home', { station: { mapid: '40100', name: 'home' } });
  assert.equal(c.station.name, 'HOME');
  assert.equal(c.v, 3);
});

test('invalid updates are rejected and change nothing', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  const bad = [
    { station: { mapid: '99999' } },
    { station: { mapid: '40100', name: 'HAROLD WASHINGTON LIBRARY' } },
    { rows: ['XX:Howard'] },
    { rows: 'RD:Howard' },
    { screen: 'buses' },
    { bright: 101 },
    { showHeader: 'yes' },
    { v: 99 },
  ];
  for (const patch of bad) {
    assert.throws(() => store.update('home', patch), ValidationError, JSON.stringify(patch));
  }
  assert.equal(store.get('home').v, 1);
});

test('rows accept an ordered destination list', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  const b = store.update('home', { rows: ['RD:Howard', 'RD:95th'] });
  assert.deepEqual(b.rows, ['RD:Howard', 'RD:95th']);
});

test('boot resets brightness but keeps the chosen screen and config', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  store.update('home', { screen: 'ticker', bright: 30, showHeader: false });
  const b = store.boot('home');
  assert.equal(b.screen, 'ticker');
  assert.equal(b.bright, 'auto');
  assert.equal(b.showHeader, false);
  assert.equal(b.v, 3);
  assert.equal(store.boot('nope'), null);
});

test('a corrupt state file is moved aside and defaults are used', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'board-state.json'), '{not json');
  const store = createStore({ dir, log: quiet });
  assert.equal(store.get('home').v, 1);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('board-state.json.corrupt-')));
});

test('writes are atomic: no temp file left behind', () => {
  const dir = tmpDir();
  const store = createStore({ dir, log: quiet });
  store.update('home', { screen: 'radar' });
  assert.deepEqual(fs.readdirSync(dir), ['board-state.json']);
});

test('new boards are created on first update; bad ids are rejected', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  const b = store.update('office', { station: { mapid: '40460' } });
  assert.equal(b.station.name, 'MERCH MART');
  assert.equal(b.v, 2);
  assert.throws(() => store.update('Bad Id', {}), ValidationError);
});
