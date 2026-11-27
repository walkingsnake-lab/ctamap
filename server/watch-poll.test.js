'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatchPoller } = require('./watch-poll');

const INTERVAL = 30000, IDLE = 120000;

// A poller on mocked timers. `viewers.n` is the number of connected viewers;
// `hold` makes poll() wait until release() is called.
function setup(t, { hold = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  const s = { polls: 0, idles: 0, viewers: { n: 0 }, release: null };
  s.poller = createWatchPoller({
    poll: () => {
      s.polls++;
      if (!hold) return undefined;
      return new Promise((resolve) => { s.release = resolve; });
    },
    viewers: () => s.viewers.n,
    onIdle: () => { s.idles++; },
    interval: INTERVAL,
    idleMs: IDLE,
  });
  // Let a finished poll schedule the next one, then move the clock.
  s.advance = async (ms) => {
    await flush();
    t.mock.timers.tick(ms);
    await flush();
  };
  return s;
}

async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

test('nothing is polled until a viewer arrives', async (t) => {
  const s = setup(t);
  await s.advance(10 * INTERVAL);
  assert.equal(s.polls, 0);
  assert.equal(s.poller.active(), false);
});

test('a viewer starts the loop with a poll at once, then one per interval', async (t) => {
  const s = setup(t);
  s.viewers.n = 1;
  await s.poller.watch();
  assert.equal(s.polls, 1);
  assert.equal(s.poller.active(), true);
  await s.advance(INTERVAL - 1);
  assert.equal(s.polls, 1);
  await s.advance(1);
  assert.equal(s.polls, 2);
  await s.advance(INTERVAL);
  assert.equal(s.polls, 3);
});

test('the loop keeps going while a viewer stays connected', async (t) => {
  const s = setup(t);
  s.viewers.n = 1;
  await s.poller.watch();
  for (let i = 0; i < 20; i++) await s.advance(INTERVAL);
  assert.equal(s.polls, 21);
  assert.equal(s.idles, 0);
});

test('it stops idleMs after the last viewer leaves, and says so once', async (t) => {
  const s = setup(t);
  s.viewers.n = 1;
  await s.poller.watch();
  await s.advance(INTERVAL);            // poll 2, viewer still there
  s.viewers.n = 0;
  s.poller.seen();                      // the stream closed now
  await s.advance(INTERVAL);            // 30 s after leaving
  await s.advance(INTERVAL);
  await s.advance(INTERVAL);            // 90 s: still polling
  assert.equal(s.polls, 5);
  assert.equal(s.idles, 0);
  await s.advance(INTERVAL);            // 120 s: stops without polling
  assert.equal(s.polls, 5);
  assert.equal(s.idles, 1);
  assert.equal(s.poller.active(), false);
  await s.advance(10 * INTERVAL);
  assert.equal(s.polls, 5);
  assert.equal(s.idles, 1);
});

test('a request for the trains keeps it going without a stream', async (t) => {
  const s = setup(t);
  await s.poller.watch();               // viewers stays 0: REST only
  await s.advance(INTERVAL);
  await s.advance(INTERVAL);
  await s.poller.watch();               // asked again at 60 s
  await s.advance(INTERVAL);
  await s.advance(INTERVAL);
  await s.advance(INTERVAL);            // 90 s after the last ask
  assert.equal(s.poller.active(), true);
  await s.advance(INTERVAL);            // 120 s after it
  assert.equal(s.poller.active(), false);
  assert.equal(s.idles, 1);
});

test('a viewer coming back restarts it with a poll at once', async (t) => {
  const s = setup(t);
  await s.poller.watch();
  await s.advance(5 * INTERVAL);
  assert.equal(s.poller.active(), false);
  const before = s.polls;
  s.viewers.n = 1;
  await s.poller.watch();
  assert.equal(s.polls, before + 1);
  assert.equal(s.poller.active(), true);
  await s.advance(INTERVAL);
  assert.equal(s.polls, before + 2);
});

test('watch() waits for the first poll, and later calls do not start another', async (t) => {
  const s = setup(t, { hold: true });
  s.viewers.n = 1;
  let ready = false;
  const first = s.poller.watch().then(() => { ready = true; });
  await flush();
  assert.equal(s.polls, 1);
  assert.equal(ready, false);
  const second = s.poller.watch();      // a second viewer during the first poll
  await flush();
  assert.equal(s.polls, 1);
  s.release();
  await first;
  await second;
  assert.equal(ready, true);
  // Between polls there is data on hand: resolves at once, no extra poll.
  await s.poller.watch();
  assert.equal(s.polls, 1);
});

test('polls never overlap: the next waits for the one in flight', async (t) => {
  const s = setup(t, { hold: true });
  s.viewers.n = 1;
  s.poller.watch();
  await flush();
  await s.advance(5 * INTERVAL);        // the first poll is still out
  assert.equal(s.polls, 1);
  s.release();
  await s.advance(INTERVAL);
  assert.equal(s.polls, 2);
});

test('a poll that throws does not stop the loop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  let polls = 0;
  const poller = createWatchPoller({
    poll: () => { polls++; throw new Error('CTA down'); },
    viewers: () => 1,
    onIdle: () => {},
    interval: INTERVAL,
    idleMs: IDLE,
  });
  await poller.watch();
  await flush();
  t.mock.timers.tick(INTERVAL);
  await flush();
  assert.equal(polls, 2);
  assert.equal(poller.active(), true);
});
