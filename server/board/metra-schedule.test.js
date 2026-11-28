'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readZip } = require('./zip');
const m = require('./metra-schedule');
const { parseCtaTime } = require('./time');
const { scheduleZip } = require('./fixtures/metra/make-zip');

// A made-up schedule in Metra's format (see the fixtures README): Metra's own
// isn't kept in the repo.
const ZIP = scheduleZip();
const PUBLISHED = fs.readFileSync(path.join(__dirname, 'fixtures', 'metra', 'published.txt'), 'utf8').trim();
const model = m.parseSchedule(readZip(ZIP, { only: m.FILES }), { published: PUBLISHED });
// Chicago wall time -> epoch s.
const at = (s) => parseCtaTime(s);
const trips = (r) => ({ in: r.in.map((d) => d.trip), out: r.out.map((d) => d.trip) });

test('parseCsv: trims names and values, handles quotes, a BOM and CRLF', () => {
  const { cols, rows } = m.parseCsv('﻿a, b ,c\r\n1, "x, y" ,"say ""hi"""\r\n\r\n2,,3');
  assert.deepStrictEqual([...cols.keys()], ['a', 'b', 'c']);
  assert.deepStrictEqual(rows, [['1', 'x, y', 'say "hi"'], ['2', '', '3']]);
  assert.deepStrictEqual(m.parseCsv('a,b\n"line\nbreak",2\n').rows, [['line\nbreak', '2']]);
  const seen = [];
  const out = m.parseCsv('a,b\n1,2\n3,4\n', (row) => seen.push(row));
  assert.deepStrictEqual(seen, [['1', '2'], ['3', '4']]);
  assert.deepStrictEqual(out.rows, []);
});

test('gtfsSeconds: times past midnight count on', () => {
  assert.strictEqual(m.gtfsSeconds('04:00:01'), 14401);
  assert.strictEqual(m.gtfsSeconds('26:25:00'), 95100);
  assert.strictEqual(m.gtfsSeconds('9:5:00'), null);
  assert.strictEqual(m.gtfsSeconds(''), null);
});

test('routes, stops and trips, with Metra\'s stray spaces trimmed', () => {
  assert.deepStrictEqual(model.routes.get('NL'), { id: 'NL', short: 'NL', long: 'North Line', color: '#008000' });
  assert.strictEqual(model.routes.get('WL').color, '#550e0c');
  assert.strictEqual(model.stops.size, 10);
  assert.deepStrictEqual(model.stops.get('MAIN'), { id: 'MAIN', name: 'Main St', lat: 41.95, lon: -87.66 });
  assert.strictEqual(model.trips.length, 16);
  assert.strictEqual(model.published, '11/14/26 02:20:03 AM America/Chicago');
  assert.strictEqual(model.through, '20261231');
});

test('inbound is direction_id 1, not the headsign', () => {
  const south = model.trips.find((t) => t.headsign === 'Chicago South');
  assert.strictEqual(south.inbound, false);
  assert.ok(model.trips.filter((t) => t.headsign === 'Downtown').every((t) => t.inbound));
});

test('servicesOn: weekdays, weekends, and the calendar exceptions', () => {
  const on = (d) => [...m.servicesOn(model, d)].sort();
  assert.deepStrictEqual(on('20261127'), ['WD', 'WK']);   // a Friday
  assert.deepStrictEqual(on('20261126'), ['SU']);         // Thanksgiving: the Sunday schedule
  assert.deepStrictEqual(on('20261128'), ['SA']);
  assert.deepStrictEqual(on('20261101'), ['SU']);
  assert.deepStrictEqual(on('20270102'), []);             // past what's published
});

test('departures: the next trains each way, through midnight into tomorrow', () => {
  const r = m.departures(model, 'MAIN', at('2026-11-27T17:42:00'));
  // Out: N105 ends at Main St and N107 doesn't pick up there, so Saturday's
  // N202 is third. In: N106 leaves at 24:25 on Friday's service.
  assert.deepStrictEqual(trips(r), { in: ['N104', 'N106', 'N201'], out: ['N101', 'N103', 'N202'] });
  assert.deepStrictEqual(r.in.map((d) => [d.date, d.at]), [
    ['20261127', at('2026-11-27T18:20:00')],
    ['20261127', at('2026-11-28T00:25:00')],
    ['20261128', at('2026-11-28T07:20:00')],
  ]);
  assert.strictEqual(r.out[0].headsign, 'Far End');
  assert.strictEqual(r.out[0].route, 'NL');
  assert.strictEqual(r.out[0].sched, r.out[0].at);
  // A train leaving now still shows; one that has left doesn't.
  assert.strictEqual(m.departures(model, 'MAIN', at('2026-11-27T17:50:00')).out[0].trip, 'N101');
  assert.strictEqual(m.departures(model, 'MAIN', at('2026-11-27T17:50:01')).out[0].trip, 'N103');
});

test('trains ending at a station are not departures from it', () => {
  // Downtown: every inbound train ends there.
  const r = m.departures(model, 'DT', at('2026-11-27T17:00:00'), { perDir: 2 });
  assert.deepStrictEqual(trips(r), { in: [], out: ['N101', 'N103'] });
});

test('to: only trains that go on to let riders off there, with their arrival', () => {
  // N103 runs express past Oak Ave, N105 turns back before it, and N107
  // doesn't let riders off there.
  const r = m.departures(model, 'DT', at('2026-11-27T17:00:00'), { perDir: 2, to: 'OAK' });
  assert.deepStrictEqual(r.out.map((d) => [d.trip, d.at, d.arr]), [
    ['N101', at('2026-11-27T17:30:00'), at('2026-11-27T17:55:00')],
    ['N202', at('2026-11-28T08:00:00'), at('2026-11-28T08:25:00')],
  ]);
  // A stop the train has already passed doesn't count.
  assert.deepStrictEqual(m.departures(model, 'OAK', at('2026-11-27T17:00:00'), { to: 'MAIN' }).out, []);
});

test('routes: one line at a station on several', () => {
  const r = m.departures(model, 'DT', at('2026-11-27T15:00:00'), { routes: ['WL'], perDir: 1 });
  assert.deepStrictEqual(trips(r), { in: [], out: ['W2'] });
  assert.ok(m.departures(model, 'DT', at('2026-11-27T15:00:00'), { routes: ['NL'] }).out.every((d) => d.route === 'NL'));
});

test('a weekday-only line finds Monday\'s trains from Friday evening, with their day', () => {
  const r = m.departures(model, 'WKA', at('2026-12-04T20:00:00'), { perDir: 1 });
  assert.deepStrictEqual(r.in.map((d) => [d.trip, d.date, d.at]), [['W1', '20261207', at('2026-12-07T06:05:00')]]);
  assert.deepStrictEqual(r.out.map((d) => [d.trip, d.date]), [['W2', '20261207']]);
  // Only so far ahead.
  assert.deepStrictEqual(m.departures(model, 'WKA', at('2026-12-04T20:00:00'), { days: 2 }), { in: [], out: [] });
});

test('the day the clocks fall back: wall times still right', () => {
  const r = m.departures(model, 'MAIN', at('2026-11-01T04:00:00'), { perDir: 1 });
  assert.strictEqual(r.in[0].at, at('2026-11-01T08:20:00'));
  assert.strictEqual(r.out[0].at, at('2026-11-01T09:20:00'));
});

test('unknown stop, or past the published schedule: nothing', () => {
  assert.deepStrictEqual(m.departures(model, 'NOWHERE', at('2026-11-27T17:42:00')), { in: [], out: [] });
  assert.deepStrictEqual(m.departures(model, 'MAIN', at('2027-01-05T08:00:00')), { in: [], out: [] });
});

test('daysLeft: until the published schedule runs out', () => {
  assert.strictEqual(m.daysLeft(model, at('2026-11-27T17:42:00')), 34);
  assert.strictEqual(m.daysLeft(model, at('2026-12-31T23:00:00')), 0);
  assert.strictEqual(m.daysLeft(model, at('2027-01-02T08:00:00')), -2);
});

test('parseSchedule refuses a schedule missing a file or a column', () => {
  const files = readZip(ZIP, { only: m.FILES });
  const without = new Map(files); without.delete('stop_times.txt');
  assert.throws(() => m.parseSchedule(without), /no stop_times.txt/);
  const bad = new Map(files); bad.set('trips.txt', Buffer.from('trip_id,route_id\nX,NL\n'));
  assert.throws(() => m.parseSchedule(bad), /trips.txt has no service_id/);
});

// ---- the poller ----

function fakeSource({ published = PUBLISHED, zip = ZIP } = {}) {
  const calls = [];
  const src = { published, zip, fail: null, calls };
  src.fetch = async (name) => {
    calls.push(name);
    if (src.fail === name) throw new Error('HTTP 503');
    return name === 'published.txt' ? Buffer.from(`${src.published}\n`) : src.zip;
  };
  return src;
}
const quiet = { log() {}, error() {}, warn() {} };
// A different file holding the same schedule.
const another = (text) => scheduleZip({ comment: text });

test('poller: downloads once, then only when published.txt changes', async () => {
  const src = fakeSource();
  const s = m.createMetraSchedule({ fetch: src.fetch, log: quiet });
  assert.strictEqual(s.get(), null);
  await s.refresh();
  assert.strictEqual(s.get().published, PUBLISHED);
  await s.refresh();
  assert.deepStrictEqual(src.calls, ['published.txt', 'schedule.zip', 'published.txt']);
  src.published = '11/28/26 03:00:00 AM America/Chicago';
  src.zip = another('new');
  await s.refresh();
  assert.strictEqual(s.get().published, '11/28/26 03:00:00 AM America/Chicago');
  assert.strictEqual(src.calls.filter((c) => c === 'schedule.zip').length, 2);
});

test('poller: keeps the last good schedule through failures, and backs off', async () => {
  let t = 1000;
  const src = fakeSource();
  const s = m.createMetraSchedule({ fetch: src.fetch, log: quiet, now: () => t });
  await s.refresh();
  const good = s.get();
  // A new schedule that won't download, then one that won't parse.
  src.published = 'new';
  src.fail = 'schedule.zip';
  await s.refresh();
  assert.strictEqual(s.get(), good);
  const n = src.calls.length;
  await s.refresh();                      // within the backoff: no request
  assert.strictEqual(src.calls.length, n);
  t += 600;
  src.fail = null;
  src.zip = Buffer.from('not a zip');
  await s.refresh();
  assert.strictEqual(s.get(), good);
  t += 600;
  src.zip = another('new');
  await s.refresh();
  assert.strictEqual(s.get().published, 'new');
});

test('poller: a new stamp on the same zip is retried, then accepted', async () => {
  const logs = [];
  const src = fakeSource();
  const s = m.createMetraSchedule({ fetch: src.fetch, log: { ...quiet, warn: (x) => logs.push(x) }, sameZipTries: 3 });
  await s.refresh();
  const first = s.get();
  src.published = 'stamp first';
  await s.refresh();
  await s.refresh();
  assert.strictEqual(s.get(), first);
  assert.strictEqual(logs.filter((x) => /zip is unchanged/.test(x)).length, 2);
  await s.refresh();
  assert.strictEqual(s.get().published, 'stamp first');
});

test('poller: pass() checks on schedule, and retries failures on the backoff', async () => {
  let t = 1000;
  const src = fakeSource();
  const s = m.createMetraSchedule({ fetch: src.fetch, log: quiet, now: () => t, check: 300 });
  await s.pass();                                      // never checked: checks now
  assert.strictEqual(src.calls.length, 2);
  t += 100; await s.pass();                            // before `check`: nothing
  assert.strictEqual(src.calls.length, 2);
  t += 200; await s.pass();                            // at `check`: published.txt only
  assert.deepStrictEqual(src.calls.slice(2), ['published.txt']);
  src.fail = 'published.txt';
  t += 300; await s.pass();                            // fails
  const n = src.calls.length;
  t += 29; await s.pass();                             // backoff 30 s: not yet
  assert.strictEqual(src.calls.length, n);
  t += 1; src.fail = null; await s.pass();             // retried at 30 s, not after `check`
  assert.strictEqual(src.calls.length, n + 1);
});

test('poller: warns once when the schedule is about to run out', async () => {
  const logs = [];
  const src = fakeSource();
  let t = at('2026-12-28T12:00:00');
  const s = m.createMetraSchedule({ fetch: src.fetch, log: { ...quiet, warn: (x) => logs.push(x) }, now: () => t });
  await s.refresh();
  t += 600; await s.refresh();
  assert.deepStrictEqual(logs, ['[board] Metra schedule runs out 20261231 (3 days)']);
});

test('poller: start() checks at once and stop() ends it', async () => {
  const src = fakeSource();
  const s = m.createMetraSchedule({ fetch: src.fetch, log: quiet, tick: 3600 });
  assert.strictEqual(s.start(), s);
  assert.strictEqual(s.start(), s);                    // a second start does nothing
  await s.refresh();                                   // joins the start's check
  assert.strictEqual(s.get().published, PUBLISHED);
  assert.deepStrictEqual(src.calls, ['published.txt', 'schedule.zip']);
  s.stop();
});
