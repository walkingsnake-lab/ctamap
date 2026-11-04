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
  assert.equal(home.screen, 'transit');
  assert.deepEqual([home.cycle, home.hideLines, home.otherLines], [['transit', 'weather'], [], true]);
  assert.equal(home.bright, 'auto');
  assert.equal(home.brightMin, 40);
  assert.equal(home.wxVisit, 'off');
  assert.equal(home.radarEvery, 4);
  assert.equal(home.radarFor, 60);
  // Settings defaults reproduce the behavior before they were settings.
  assert.deepEqual([home.autoScreens, home.autoEvery, home.alertJump, home.bbTeams, home.bbPre, home.bbFinal, home.bbPriority, home.lineNames, home.headerClock, home.timeSteps],
    [['transit'], 60, 'off', ['cubs', 'sox', 'post'], 30, 15, 'live', 'white', true, false]);
  assert.ok(fs.existsSync(path.join(dir, 'board-state.json')));
});

test('an older state file: radar visits migrate and new settings get their defaults', () => {
  for (const [every, visit, interval] of [[0, 'off', 4], [6, 'rain', 6]]) {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'board-state.json'), JSON.stringify({ boards: { home: { v: 3, station: { mapid: '40100', name: 'MORSE' }, rows: [], screen: 'auto', bright: 'auto', radarEvery: every, radarFor: 90 } } }));
    const b = createStore({ dir, log: quiet }).get('home');
    assert.deepEqual([b.wxVisit, b.radarEvery, b.radarFor], [visit, interval, 90]);
    assert.deepEqual([b.autoScreens, b.bbTeams, b.headerClock, b.tickerHold], [['transit'], ['cubs', 'sox', 'post'], true, 8]);
  }
});

test('an older state file: Auto becomes the chosen screen or the Cycle', () => {
  const dir = tmpDir();
  const old = (screen, autoScreens) => ({ v: 3, station: { mapid: '40100', name: 'MORSE' }, rows: [], screen, bright: 'auto', autoScreens });
  fs.writeFileSync(path.join(dir, 'board-state.json'), JSON.stringify({ boards: {
    one: old('auto', ['ticker']), both: old('auto', ['transit', 'ticker']), wx: old('weather', ['transit']),
  } }));
  const store = createStore({ dir, log: quiet });
  assert.deepEqual([store.get('one').screen, store.get('one').cycle], ['ticker', ['transit', 'weather']]);
  assert.deepEqual([store.get('both').screen, store.get('both').cycle], ['auto', ['transit', 'ticker']]);
  assert.deepEqual([store.get('wx').screen, store.get('wx').cycle], ['weather', ['transit', 'weather']]);
});

test('Cycle, lines and the transit screen: validation', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  const b = store.update('home', { cycle: ['clock', 'transit', 'announce'], hideLines: ['PR', 'BR'], otherLines: false, transitScreen: 'ticker' });
  assert.deepEqual([b.cycle, b.hideLines, b.otherLines, b.transitScreen, b.screen], [['clock', 'transit', 'announce'], ['BR', 'PR'], false, 'ticker', 'transit']);
  for (const bad of [{ cycle: ['transit'] }, { cycle: ['a', 'b'] }, { cycle: ['transit', 'transit'] }, { cycle: Array(7).fill(0).map((_, i) => ['transit', 'ticker', 'weather', 'clock', 'announce', 'baseball', 'auto'][i]) },
    { hideLines: ['XX'] }, { hideLines: ['RD', 'RD'] }, { otherLines: 'no' }, { transitScreen: 'weather' }]) {
    assert.throws(() => store.update('home', bad), ValidationError, JSON.stringify(bad));
  }
});

test('settings validation: lists, choices, and ranges', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  const ok = { autoScreens: ['ticker', 'transit'], autoEvery: 120, wxVisit: 'always', alertJump: 'all', bbTeams: [], bbPre: 120, bbFinal: 0, bbPriority: 'favorite', lineNames: 'line', headerClock: false, timeSteps: true, transitLayout: 'key' };
  const b = store.update('home', ok);
  assert.equal(b.transitLayout, 'key');
  assert.deepEqual(b.autoScreens, ['transit', 'ticker']); // stored in a fixed order
  assert.deepEqual(b.bbTeams, []);
  for (const bad of [{ autoScreens: [] }, { autoScreens: ['weather'] }, { autoScreens: ['transit', 'transit'] }, { autoEvery: 45 }, { wxVisit: 'sometimes' },
    { alertJump: 'watch' }, { bbTeams: ['mets'] }, { bbPre: 121 }, { bbFinal: -1 }, { bbPriority: 'first' }, { lineNames: 'red' }, { transitLayout: 'footer' }, { headerClock: 'no' }, { timeSteps: 1 }, { radarEvery: 0 }]) {
    assert.throws(() => store.update('home', bad), /must/, JSON.stringify(bad));
  }
});

test('a saved filter with the old 54th short name loads as 54/Crmk', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'board-state.json'), JSON.stringify({ boards: { home: { v: 3, station: { mapid: '40380', name: 'CLARK/LAKE' }, rows: ['PK:54th', 'BL:Forest'], showHeader: true, showWeather: true, screen: 'auto', bright: 'auto' } } }));
  assert.deepEqual(createStore({ dir, log: quiet }).get('home').rows, ['PK:54/Crmk', 'BL:Forest']);
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
    { brightMin: 0 },
    { brightMin: 101 },
    { brightMin: 'dim' },
    { brightMax: 80 },
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

test('boot keeps brightness (Off too), the chosen screen and config', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  store.update('home', { screen: 'ticker', bright: 'off', showHeader: false });
  const b = store.boot('home');
  assert.equal(b.screen, 'ticker');
  assert.equal(b.bright, 'off');
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

test('retired animated-icon settings are dropped from a saved state', () => {
  const dir = tmpDir();
  createStore({ dir, log: quiet }).update('home', { screen: 'weather' });
  const file = path.join(dir, 'board-state.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(saved.boards.home, { iconsNow: 'animated', icons5day: 'static', iconsHourly: 'animated', iconsRadar: 'animated' });
  fs.writeFileSync(file, JSON.stringify(saved));
  const home = createStore({ dir, log: quiet }).get('home');
  for (const key of ['iconsNow', 'icons5day', 'iconsHourly', 'iconsRadar']) assert.equal(Object.hasOwn(home, key), false);
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

test('radarClock and radarCond: defaults frame time, no conditions; validated', () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')), log: quiet });
  assert.equal(store.get('home').radarClock, 'frame');
  assert.equal(store.get('home').radarCond, false);
  store.update('home', { radarClock: 'now', radarCond: true });
  assert.equal(store.get('home').radarClock, 'now');
  assert.equal(store.get('home').radarCond, true);
  assert.throws(() => store.update('home', { radarClock: 'live' }), /radarClock must be one of frame, now, age, none/);
  assert.throws(() => store.update('home', { radarCond: 1 }), /radarCond must be true or false/);
});

test('wxView: default conditions, 5day allowed; validated', () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')), log: quiet });
  assert.equal(store.get('home').wxView, 'now');
  store.update('home', { wxView: '5day' });
  assert.equal(store.get('home').wxView, '5day');
  store.update('home', { wxView: 'hourly' });
  assert.equal(store.get('home').wxView, 'hourly');
  assert.throws(() => store.update('home', { wxView: 'week' }), /wxView must be one of now, 5day, hourly/);
  assert.equal(store.get('home').wxRain, 'radar');
  store.update('home', { wxRain: 'bars' });
  assert.equal(store.get('home').wxRain, 'bars');
  store.update('home', { wxRain: 'both', wxRainEvery: 30 });
  assert.deepEqual([store.get('home').wxRain, store.get('home').wxRainEvery], ['both', 30]);
  assert.equal(createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')), log: quiet }).get('home').wxRainEvery, 15);
  assert.throws(() => store.update('home', { wxRain: 'all' }), /wxRain must be one of radar, bars, both/);
  assert.throws(() => store.update('home', { wxRainEvery: 12 }), /wxRainEvery must be one of/);
  assert.equal(store.get('home').wxRainLoops, 2);
  store.update('home', { wxRainLoops: 5 });
  assert.equal(store.get('home').wxRainLoops, 5);
  assert.throws(() => store.update('home', { wxRainLoops: 4 }), /wxRainLoops must be one of 1, 2, 3, 5/);
});

test('radarBright: default 100, 20-150', () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')), log: quiet });
  assert.equal(store.get('home').radarBright, 100);
  store.update('home', { radarBright: 60 });
  assert.equal(store.get('home').radarBright, 60);
  for (const bad of [10, 151, 60.5, '60']) assert.throws(() => store.update('home', { radarBright: bad }), /radarBright must be 20-150/);
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

test('tempUnit: default F, C allowed; validated', () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')), log: quiet });
  assert.equal(store.get('home').tempUnit, 'F');
  store.update('home', { tempUnit: 'C' });
  assert.equal(store.get('home').tempUnit, 'C');
  assert.throws(() => store.update('home', { tempUnit: 'K' }), /tempUnit must be one of F, C/);
});

test('knob: the ring opens categories; TRANSIT opens the transit screen last chosen, CYCLE the auto screen', () => {
  const { knobOf, KNOB_RING } = require('./state');
  const store = createStore({ dir: tmpDir(), log: quiet });
  assert.deepEqual(KNOB_RING, ['transit', 'weather', 'cycle']);
  assert.deepEqual(knobOf(store.get('home')), { ring: KNOB_RING, at: 0 });
  const v = store.get('home').v;
  assert.equal(store.select('home', 'weather').screen, 'weather');
  assert.equal(store.get('home').v, v + 1);
  assert.equal(knobOf(store.get('home')).at, 1);
  assert.equal(store.select('home', 'transit').screen, 'transit');
  // The ticker is a transit view: chosen on the phone, TRANSIT reopens it.
  store.update('home', { screen: 'ticker' });
  assert.equal(knobOf(store.get('home')).at, 0);
  store.select('home', 'weather');
  assert.equal(store.select('home', 'transit').screen, 'ticker');
  store.update('home', { screen: 'transit' });
  assert.equal(store.select('home', 'cycle').screen, 'auto');
  assert.equal(store.select('home', 'transit').screen, 'transit');
  // Sports is chosen on the phone only; the knob then opens on TRANSIT.
  assert.throws(() => store.select('home', 'sports'), ValidationError);
  store.update('home', { screen: 'baseball' });
  assert.equal(knobOf(store.get('home')).at, 0);
  assert.throws(() => store.select('home', 'baseball'), ValidationError);
  // The phone's Transit page sets which one TRANSIT means without switching.
  store.update('home', { screen: 'weather', transitScreen: 'ticker' });
  assert.equal(store.select('home', 'transit').screen, 'ticker');
  assert.equal(store.select('nope', 'cycle'), null);
});

test('knob: peek boards get each category\'s variants and the one it opens on; select can set the variant', () => {
  const { knobOf } = require('./state');
  const store = createStore({ dir: tmpDir(), log: quiet });
  const faces = ['skyline', 'seventies', 'analog'];
  store.update('home', { screen: 'ticker', wxView: 'hourly', clockFace: 'analog' });
  assert.deepEqual(knobOf(store.get('home'), { clock: true, announce: true, peek: true, faces }), {
    ring: ['transit', 'weather', 'clock', 'announce', 'cycle'], at: 0,
    vars: [['transit', 'ticker'], ['now', '5day', 'hourly', 'radar'], faces, [], []], sel: [1, 2, 2, 0, 0],
  });
  // A face the board can't draw opens on the first.
  store.update('home', { clockFace: 'gradient' });
  assert.equal(knobOf(store.get('home'), { clock: true, peek: true, faces }).sel[2], 0);
  // The variant comes with the category.
  assert.equal(store.select('home', 'transit', 'transit').screen, 'transit');
  assert.equal(store.get('home').transitScreen, 'transit');
  let b = store.select('home', 'weather', '5day');
  assert.deepEqual([b.screen, b.wxView], ['weather', '5day']);
  b = store.select('home', 'clock', 'daynight');
  assert.deepEqual([b.screen, b.clockFace], ['clock', 'daynight']);
  assert.throws(() => store.select('home', 'clock', 'nixie'), /v must be one of/);
  assert.throws(() => store.select('home', 'weather', 'ticker'), ValidationError);
  assert.throws(() => store.select('home', 'cycle', 'auto'), /cycle has no variants/);
});

test('boards: create copies or defaults, register copies home, remove keeps one', () => {
  const dir = tmpDir();
  const store = createStore({ dir, log: quiet });
  store.update('home', { station: { mapid: '40380' }, bright: 30, label: '  Kitchen ' });
  assert.equal(store.get('home').label, 'Kitchen');
  const copy = store.create('desk', { from: 'home', label: 'Desk' });
  assert.deepEqual([copy.station.mapid, copy.bright, copy.v, copy.label], ['40380', 'auto', 1, 'Desk']);
  // A copy, not a shared object.
  store.update('desk', { rows: ['BL:Forest'] });
  assert.deepEqual(store.get('home').rows, []);
  assert.equal(store.create('bare').station.mapid, '40100');
  assert.throws(() => store.create('desk'), ValidationError);
  assert.throws(() => store.create('Nope!'), ValidationError);
  assert.throws(() => store.create('z', { from: 'missing' }), ValidationError);
  // register: existing boards come back as is; new ones copy home.
  assert.equal(store.register('desk'), store.get('desk'));
  assert.equal(store.register('office').station.mapid, '40380');
  assert.equal(store.register('Bad_ID'), null);
  // Limit.
  for (let i = store.ids().length; i < 8; i++) store.create(`b${i}`);
  assert.equal(store.register('one-more'), null);
  assert.throws(() => store.create('one-more'), /at most 8/);
  // Remove; survives a restart.
  assert.equal(store.remove('bare'), true);
  assert.equal(store.remove('bare'), false);
  const again = createStore({ dir, log: quiet });
  assert.equal(again.get('bare'), null);
  assert.equal(again.get('desk').label, 'Desk');
  for (const id of again.ids().filter((i) => i !== 'home')) again.remove(id);
  assert.throws(() => again.remove('home'), /only board/);
});

test('an older board without a label loads with an empty one', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'board-state.json'), JSON.stringify({ boards: { home: { v: 3, station: { mapid: '40100', name: 'MORSE' }, rows: [], screen: 'auto', bright: 'auto' } } }));
  assert.equal(createStore({ dir, log: quiet }).get('home').label, '');
});

test('clock screen and its face are settings; the knob ring adds CLOCK when the board can draw it', () => {
  const { knobOf, KNOB_RING, CLOCK_FACES } = require('./state');
  const store = createStore({ dir: tmpDir(), log: quiet });
  assert.equal(store.get('home').clockFace, 'skyline');
  assert.deepEqual(CLOCK_FACES, ['skyline', 'seventies', 'analog', 'daynight', 'gradient']);
  store.update('home', { clockFace: 'seventies' });
  assert.equal(store.get('home').clockFace, 'seventies');
  store.update('home', { clockFace: 'skyline' });
  assert.equal(store.get('home').gradInvert, false);
  store.update('home', { gradInvert: true });
  assert.equal(store.get('home').gradInvert, true);
  assert.throws(() => store.update('home', { gradInvert: 'yes' }), ValidationError);
  store.update('home', { screen: 'clock' });
  assert.equal(store.get('home').screen, 'clock');
  assert.throws(() => store.update('home', { clockFace: 'nixie' }), ValidationError);
  assert.deepEqual(knobOf(store.get('home')), { ring: KNOB_RING, at: 0 }, 'without CLOCK the ring falls back to TRANSIT');
  assert.deepEqual(knobOf(store.get('home'), { clock: true }), { ring: ['transit', 'weather', 'clock', 'cycle'], at: 2 });
  store.select('home', 'weather');
  store.select('home', 'clock');
  assert.equal(store.get('home').screen, 'clock');
});

test('cloud drift setting: slow by default, off/slow/normal', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  assert.equal(store.get('home').cloudDrift, 'slow');
  store.update('home', { cloudDrift: 'off' });
  assert.equal(store.get('home').cloudDrift, 'off');
  assert.throws(() => store.update('home', { cloudDrift: 'fast' }), ValidationError);
});

test('skyline motion and temperature settings: defaults and allowed values', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  const b = store.get('home');
  assert.deepEqual([b.wheelSpeed, b.rippleSpeed, b.twinkle, b.rainSpeed, b.showTemp], ['normal', 'normal', true, 'normal', true]);
  store.update('home', { wheelSpeed: 'off', rippleSpeed: 'fast', twinkle: false, rainSpeed: 'slow', showTemp: false });
  const c = store.get('home');
  assert.deepEqual([c.wheelSpeed, c.rippleSpeed, c.twinkle, c.rainSpeed, c.showTemp], ['off', 'fast', false, 'slow', false]);
  assert.throws(() => store.update('home', { rainSpeed: 'off' }), ValidationError, 'rain always falls');
  assert.throws(() => store.update('home', { wheelSpeed: 'spin' }), ValidationError);
  assert.throws(() => store.update('home', { twinkle: 1 }), ValidationError);
  assert.throws(() => store.update('home', { showTemp: 'yes' }), ValidationError);
});

test('boats setting: on by default, a boolean', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  assert.equal(store.get('home').boats, true);
  store.update('home', { boats: false });
  assert.equal(store.get('home').boats, false);
  assert.throws(() => store.update('home', { boats: 'no' }), ValidationError);
});

test('announce: msg is {text, style}, cleaned, fitting its style; a new one gets a new id; null clears it', () => {
  const store = createStore({ dir: tmpDir(), log: quiet });
  assert.equal(store.get('home').msg, null);
  assert.deepEqual(store.get('home').msgPresets, []);
  const b = store.update('home', { msg: { text: ' Dinner  at 7 \u{1F37D}', style: 'note' }, screen: 'announce' });
  assert.deepEqual(b.msg, { text: 'Dinner at 7', style: 'note', id: b.v });
  assert.equal(b.screen, 'announce');
  const id = b.msg.id;
  assert.ok(store.update('home', { msg: { text: 'Back by 6', style: 'type' } }).msg.id > id);
  assert.equal(store.update('home', { msg: null }).msg, null);
  for (const bad of [
    { msg: 'hi' }, { msg: { text: 'hi', style: 'marquee' } }, { msg: { text: '\u{1F382}', style: 'note' } },
    { msg: { text: 'Dinner at 7', style: 'flap' } }, { msg: { text: 'Hooray for everyone', style: 'big' } }, { msg: { text: 'x'.repeat(161), style: 'note' } }, { msg: { text: 5, style: 'note' } },
  ]) assert.throws(() => store.update('home', bad), ValidationError, JSON.stringify(bad));
});

test('announce: presets are up to 8 messages that each fit', () => {
  const { MAX_PRESETS } = require('./state');
  const store = createStore({ dir: tmpDir(), log: quiet });
  const b = store.update('home', { msgPresets: [{ text: 'Yay!', style: 'big' }, { text: 'Dinner\nat 7', style: 'type' }, { text: 'One\ntwo\nthree\nfour\nfive', style: 'roll' }] });
  assert.deepEqual(b.msgPresets.map((m) => m.style), ['big', 'type', 'roll']);
  assert.throws(() => store.update('home', { msgPresets: Array(MAX_PRESETS + 1).fill({ text: 'Hi', style: 'note' }) }), ValidationError);
  assert.throws(() => store.update('home', { msgPresets: [{ text: 'Hooray!!', style: 'big' }] }), ValidationError);
  assert.throws(() => store.update('home', { msgPresets: {} }), ValidationError);
});

test('announce: the knob ring gets ANNOUNCE for boards that draw it, and selecting it shows the screen', () => {
  const { knobOf } = require('./state');
  const store = createStore({ dir: tmpDir(), log: quiet });
  assert.deepEqual(knobOf(store.get('home'), { clock: true, announce: true }).ring, ['transit', 'weather', 'clock', 'announce', 'cycle']);
  assert.equal(store.select('home', 'announce').screen, 'announce');
  assert.deepEqual(knobOf(store.get('home'), { clock: true, announce: true }).at, 3);
  assert.deepEqual(knobOf(store.get('home')), { ring: ['transit', 'weather', 'cycle'], at: 0 }, 'not on the ring: TRANSIT');
  assert.throws(() => store.select('home', 'sports'), ValidationError);
});

test('announce: split-flap messages and presets saved before it was removed load as notes', () => {
  const dir = tmpDir();
  const store = createStore({ dir, log: quiet });
  const raw = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  raw.boards.home.msg = { text: 'Go Cubs', style: 'flap', id: 3 };
  raw.boards.home.msgPresets = [{ text: 'Dinner\nat 7', style: 'flap' }, { text: 'Yay!', style: 'big' }];
  fs.writeFileSync(store.file, JSON.stringify(raw));
  const again = createStore({ dir, log: quiet });
  assert.deepEqual(again.get('home').msg, { text: 'Go Cubs', style: 'note', id: 3 });
  assert.deepEqual(again.get('home').msgPresets, [{ text: 'Dinner\nat 7', style: 'note' }, { text: 'Yay!', style: 'big' }]);
});

test('announce: boards saved before it get no message and no presets', () => {
  const dir = tmpDir();
  const store = createStore({ dir, log: quiet });
  const raw = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  delete raw.boards.home.msg;
  delete raw.boards.home.msgPresets;
  fs.writeFileSync(store.file, JSON.stringify(raw));
  const again = createStore({ dir, log: quiet });
  assert.equal(again.get('home').msg, null);
  assert.deepEqual(again.get('home').msgPresets, []);
});
