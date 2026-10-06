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

test('a saved radar screen loads as weather (renamed)', () => {
  const dir = tmpDir();
  createStore({ dir, log: quiet }).update('home', { screen: 'weather' });
  const file = path.join(dir, 'board-state.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.boards.home.screen = 'radar';
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal(createStore({ dir, log: quiet }).get('home').screen, 'weather');
  assert.throws(() => createStore({ dir, log: quiet }).update('home', { screen: 'radar' }), /screen must be/);
});

test('writes are atomic: no temp file left behind', () => {
  const dir = tmpDir();
  const store = createStore({ dir, log: quiet });
  store.update('home', { screen: 'weather' });
  assert.deepEqual(fs.readdirSync(dir), ['board-state.json']);
});

test('new boards are created on first update; bad ids are rejected', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  const b = store.update('office', { station: { mapid: '40460' } });
  assert.equal(b.station.name, 'MERCH MART');
  assert.equal(b.v, 2);
  assert.throws(() => store.update('Bad Id', {}), ValidationError);
});

test('radarTime defaults to true and must be a boolean', () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')), log: quiet });
  assert.equal(store.get('home').radarTime, true);
  store.update('home', { radarTime: false });
  assert.equal(store.get('home').radarTime, false);
  assert.throws(() => store.update('home', { radarTime: 'no' }), /radarTime must be true or false/);
});

test('speed settings and ticker fill: defaults, allowed values only', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  const b = store.get('home');
  assert.deepEqual([b.tickerHold, b.tickerSlide, b.radarFrame, b.radarHold, b.gameEvery, b.tickerFill], [8, 1200, 500, 4, 60, 55]);
  const c = store.update('home', { tickerHold: 12, tickerSlide: 1600, radarFrame: 300, radarHold: 8, gameEvery: 30, tickerFill: 40 });
  assert.deepEqual([c.tickerHold, c.tickerSlide, c.radarFrame, c.radarHold, c.gameEvery, c.tickerFill], [12, 1600, 300, 8, 30, 40]);
  for (const patch of [{ tickerHold: 7 }, { tickerSlide: 100 }, { radarFrame: 50 }, { radarHold: 60 }, { gameEvery: 1 }, { tickerFill: 90 }, { tickerFill: 20 }, { tickerHold: '8' }]) {
    assert.throws(() => store.update('home', patch), ValidationError, JSON.stringify(patch));
  }
});

test('board ids never reach Object.prototype', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(store.get(id), null, id);
    assert.equal(store.boot(id), null, id);
  }
  assert.equal(store.update('constructor', { showWeather: false }).showWeather, false);
  assert.equal(store.get('constructor').v, 2);
  assert.equal(({}).bright, undefined);
  assert.equal(Object.showWeather, undefined);
});
