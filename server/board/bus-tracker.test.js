'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createBusTracker, MAX_STOPS } = require('./bus-tracker');
const { rawBus } = require('./capture');

const quiet = { warn() {}, error() {} };
const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'bus', name), 'utf8');
const FILES = { getpredictions: 'predictions.json', getroutes: 'routes.json', getdirections: 'directions-22.json', getstops: 'stops-22-southbound.json' };

function setup(fetchImpl) {
  let clock = 1000;
  const calls = [];
  const bus = createBusTracker({
    fetchRaw: async (fn, params) => { calls.push([fn, params]); return fetchImpl ? fetchImpl(fn, params) : { status: 200, body: fx(FILES[fn]) }; },
    now: () => clock,
    log: quiet,
  });
  return { bus, calls, advance: (s) => { clock += s; }, settle: () => new Promise((r) => setImmediate(r)) };
}

test('off without a key; on with one', () => {
  assert.equal(createBusTracker({ key: '', log: quiet }).enabled, false);
  assert.equal(createBusTracker({ key: 'k', log: quiet }).enabled, true);
});

test('first request: one call for all of a board\'s stops', async () => {
  const { bus, calls } = setup();
  const r = await bus.get(['1836', '1036', '14880']);
  assert.deepEqual(calls, [['getpredictions', { stpid: '1836,1036,14880', tmres: 's' }]]);
  assert.equal(r.preds.length, 7);
  assert.equal(r.fetchedAt, 1000);
  assert.deepEqual(r.gone, []);
  // A second board sharing a stop: served from the cache.
  assert.equal((await bus.get(['1836'])).preds.length, 3);
  assert.equal(calls.length, 1);
});

test('polls every 30 s while wanted, batched; stops when idle; forgets', async () => {
  const { bus, calls, advance, settle } = setup();
  await bus.get(['1836']);
  await bus.get(['1036']);
  assert.equal(calls.length, 2);
  advance(20); bus.pass();
  assert.equal(calls.length, 2);
  advance(10); bus.pass(); await settle();
  assert.equal(calls.length, 3);                       // both stops, one call
  assert.equal(calls[2][1].stpid, '1836,1036');
  advance(121); bus.pass(); await settle();
  assert.equal(calls.length, 3);
  advance(500); bus.pass();
  assert.equal(bus.cache.size, 0);
});

test('more than ten stops: more than one call', async () => {
  const { bus, calls } = setup();
  await bus.get(Array.from({ length: MAX_STOPS + 2 }, (_, i) => String(2000 + i)));
  assert.deepEqual(calls.map((c) => c[1].stpid.split(',').length), [10, 2]);
});

test('a failure keeps the last good data and backs off', async () => {
  let fail = false;
  const { bus, calls, advance, settle } = setup(async (fn) => (fail ? { status: 500, body: '' } : { status: 200, body: fx(FILES[fn]) }));
  await bus.get(['1836']);
  fail = true;
  advance(30); bus.pass(); await settle();
  assert.equal(calls.length, 2);
  const r = await bus.get(['1836']);
  assert.equal(r.preds.length, 3);
  assert.equal(r.fetchedAt, 1000);
  advance(10); bus.pass(); await settle();
  assert.equal(calls.length, 2);                       // backing off
  advance(30); bus.pass(); await settle();
  assert.equal(calls.length, 3);
});

test('no data yet: null; a bad key is a failure, not an empty stop', async () => {
  const { bus } = setup(async () => ({ status: 200, body: fx('error-key.json') }));
  assert.equal(await bus.get(['1836']), null);
});

test('a stop Bus Tracker does not know is reported; a quiet one is just empty', async () => {
  const { bus } = setup(async () => ({ status: 200, body: fx('predictions-none.json') }));
  const r = await bus.get(['14880', '99999']);
  assert.deepEqual([r.preds.length, r.gone], [0, ['99999']]);
});

test('times only count down between polls, as for trains', async () => {
  const later = JSON.parse(fx('predictions.json'));
  // Thirty seconds on, the same bus is predicted 30 s later than it was.
  Object.assign(later['bustime-response'].prd[1], { tmstmp: '20261124 07:30:42', prdtm: '20261124 07:34:10' });
  let body = fx('predictions.json');
  const { bus, advance, settle } = setup(async () => ({ status: 200, body }));
  const t0 = (await bus.get(['1036'])).preds[0].t;
  body = JSON.stringify(later);
  advance(30); bus.pass(); await settle();
  assert.equal((await bus.get(['1036'])).preds[0].t, t0);
});

test('picker lookups: routes, directions, stops; cached for a day', async () => {
  const { bus, calls, advance } = setup();
  assert.deepEqual((await bus.routes()).map((r) => r.rt), ['22', '96', '147', 'X49']);
  assert.equal((await bus.routes())[2].name, 'Outer DuSable Lake Shore Express');
  assert.deepEqual(await bus.directions('22'), ['Northbound', 'Southbound']);
  assert.deepEqual(await bus.stops('22', 'Southbound'), [{ stpid: '1827', name: 'Clark & Howard' }, { stpid: '1836', name: 'Clark & Morse' }, { stpid: '1841', name: 'Clark & Pratt' }]);
  assert.deepEqual(calls.map((c) => c[0]), ['getroutes', 'getdirections', 'getstops']);
  assert.deepEqual(calls[2][1], { rt: '22', dir: 'Southbound' });
  advance(86401);
  await bus.routes();
  assert.equal(calls.length, 4);
});

test('a lookup that fails throws, or answers from the last good one', async () => {
  let fail = true;
  const { bus, advance } = setup(async (fn) => (fail ? { status: 200, body: fx('error-key.json') } : { status: 200, body: fx(FILES[fn]) }));
  await assert.rejects(() => bus.routes(), /Invalid API access key/);
  fail = false;
  assert.equal((await bus.routes()).length, 4);
  fail = true; advance(86401);
  assert.equal((await bus.routes()).length, 4);
});

test('rawBus: the key and JSON on every call, only known calls', async () => {
  const seen = [];
  const get = async (url) => { seen.push(url); return { status: 200, body: '{}' }; };
  await rawBus('getpredictions', { stpid: '1836,1036', tmres: 's' }, { key: 'k y', get });
  assert.equal(seen[0], 'https://www.ctabustracker.com/bustime/api/v3/getpredictions?key=k%20y&format=json&stpid=1836%2C1036&tmres=s');
  assert.throws(() => rawBus('getvehicles', {}, { key: 'k', get }), /unknown Bus Tracker call/);
  assert.throws(() => rawBus('getroutes', {}, { key: '', get }), /CTA_BUS_KEY not set/);
});
