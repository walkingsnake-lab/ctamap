'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTracker } = require('./tracker');

const quiet = { warn() {}, error() {} };
const morse = fs.readFileSync(path.join(__dirname, 'fixtures', 'tt-arrivals', 'morse-2026-10-03-2316.json'), 'utf8');

function setup(fetchImpl) {
  let clock = 1000;
  const calls = [];
  const tracker = createTracker({
    fetchRaw: async (mapid) => { calls.push(mapid); return fetchImpl ? fetchImpl(mapid) : { status: 200, body: morse }; },
    now: () => clock,
    log: quiet,
  });
  return { tracker, calls, advance: (s) => { clock += s; }, at: () => clock };
}

test('first request fetches and returns normalized arrivals', async () => {
  const { tracker, calls } = setup();
  const r = await tracker.get('40100');
  assert.deepEqual(calls, ['40100']);
  assert.equal(r.arrivals.length, 10);
  assert.equal(r.fetchedAt, 1000);
});

test('polls every 30 s while wanted, stops after 2 min idle, forgets after 10 min', async () => {
  const { tracker, calls, advance } = setup();
  await tracker.get('40100');
  advance(20); tracker.pass();
  assert.equal(calls.length, 1); // not stale yet
  advance(10); tracker.pass(); await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2);
  advance(91); tracker.pass(); await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2); // 121 s since the board asked: idle
  advance(500); tracker.pass();
  assert.equal(tracker.cache.has('40100'), false);
});

test('failures keep the last good data', async () => {
  let fail = false;
  const { tracker, advance } = setup(() => (fail ? { status: 500, body: '' } : { status: 200, body: morse }));
  await tracker.get('40100');
  fail = true;
  advance(30); tracker.pass(); await new Promise((r) => setImmediate(r));
  const r = await tracker.get('40100');
  assert.equal(r.arrivals.length, 10);
  assert.equal(r.fetchedAt, 1000);
  assert.equal(tracker.cache.get('40100').failures, 1);
});

test('CTA error codes count as failures', async () => {
  const { tracker } = setup(() => ({ status: 200, body: '{"ctatt":{"errCd":"500","errNm":"Invalid key"}}' }));
  assert.equal(await tracker.get('40100', { wait: 50 }), null);
});

test('no data yet and a slow upstream -> null after the wait', async () => {
  const { tracker } = setup(() => new Promise(() => {}));
  assert.equal(await tracker.get('40100', { wait: 20 }), null);
});

test('failures back off: 30 s, 60 s, 120 s, ... up to 5 min; a success resets', async () => {
  let fail = true;
  const { tracker, calls, advance, at } = setup(() => (fail ? { status: 500, body: '' } : { status: 200, body: morse }));
  const times = [];
  const run = async (secs) => {
    // The board asks every 30 s; the scheduler passes every 5 s.
    for (let s = 0; s < secs; s += 5) {
      const n = calls.length;
      if (s % 30 === 0) tracker.get('40100', { wait: 0 });
      tracker.pass();
      await new Promise((r) => setImmediate(r));
      if (calls.length > n) times.push(at());
      advance(5);
    }
  };
  assert.equal(await tracker.get('40100'), null);
  times.push(at());
  // In backoff, a board request neither fetches nor waits.
  assert.equal(await tracker.get('40100', { wait: 1e6 }), null);
  await run(1300);
  assert.deepEqual(times.slice(1).map((t, i) => t - times[i]), [30, 60, 120, 240, 300, 300]);
  fail = false;
  await run(400);
  assert.equal((await tracker.get('40100')).arrivals.length, 10);
  const n = times.length;
  await run(60);
  assert.deepEqual(times.slice(n).map((t, i) => t - times[n + i - 1]), [30, 30]);
});
