'use strict';
// The map's CTA poll, run only while someone is watching.
//
// The map shares this process, and the CTA key's daily limit (100,000 calls),
// with the LED boards. Polling eight routes every 30 s around the clock cost
// 23,040 calls a day whether or not anyone had the map open. So the loop
// starts when a viewer arrives (watch()), runs while there are viewers, keeps
// going for idleMs after the last sign of one (a reload finds it warm), then
// stops and calls onIdle so the caller can drop its stale state.
//
//   poll():    one poll. Its result is ignored; a rejection is swallowed.
//   viewers(): how many viewers are connected right now (the SSE clients).
//   onIdle():  called once each time the loop stops.
//
// Polls never overlap: the next one is scheduled `interval` after the last one
// finished. poll() must therefore always settle (server.js times its requests
// out), or the loop would wait on it for good.

function createWatchPoller({ poll, viewers, onIdle, interval, idleMs }) {
  let active = false;   // the loop is running
  let lastSeen = 0;     // the last sign of a viewer (ms)
  let inFlight = null;  // the poll in progress, if any
  let timer = null;

  function run() {
    if (!inFlight) {
      inFlight = Promise.resolve().then(poll).catch(() => {}).then(() => { inFlight = null; });
    }
    return inFlight;
  }

  // Only ever called with no poll in flight: from watch() on a stopped loop,
  // or from the timer that the previous poll set when it finished.
  function tick() {
    timer = null;
    if (viewers() === 0 && Date.now() - lastSeen >= idleMs) {
      active = false;
      onIdle();
      return;
    }
    run().then(() => { if (active) timer = setTimeout(tick, interval); });
  }

  return {
    // A viewer is here (a stream opened, or a request for the trains). Starts
    // the loop if it had stopped. The promise resolves when there is a poll's
    // worth of data to hand out: at once if the loop was already running.
    watch() {
      lastSeen = Date.now();
      if (!active) {
        active = true;
        tick();
      }
      return inFlight || Promise.resolve();
    },
    // A sign of a viewer that should not start the loop (a stream closing:
    // the idle wait counts from then).
    seen() { lastSeen = Date.now(); },
    active() { return active; },
    stop() {
      clearTimeout(timer);
      timer = null;
      active = false;
    },
  };
}

module.exports = { createWatchPoller };
