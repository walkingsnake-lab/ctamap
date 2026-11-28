'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readZip } = require('./zip');
const m = require('./metra-schedule');
const { parseCtaTime } = require('./time');

const DIR = path.join(__dirname, 'fixtures', 'metra');
const ZIP = fs.readFileSync(path.join(DIR, 'schedule-2026-11-14.zip'));
const PUBLISHED = fs.readFileSync(path.join(DIR, 'published-2026-11-27.txt'), 'utf8').trim();
const model = m.parseSchedule(readZip(ZIP, { only: m.FILES }), { published: PUBLISHED });
// Chicago wall time -> epoch s.
const at = (s) => parseCtaTime(s);
const trips = (r) => ({ in: r.in.map((d) => d.trip), out: r.out.map((d) => d.trip) });

// Expected values below were worked out separately, in Python straight from
// the GTFS files (zoneinfo for the time zone), not from this module.

test('parseCsv: trims names and values, handles quotes, a BOM and CRLF', () => {
  const { cols, rows } = m.parseCsv('﻿a, b ,c\r\n1, "x, y" ,"say ""hi"""\r\n\r\n2,,3');
  assert.deepStrictEqual([...cols.keys()], ['a', 'b', 'c']);
  assert.deepStrictEqual(rows, [['1', 'x, y', 'say "hi"'], ['2', '', '3']]);
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

test('routes, with the colors Metra publishes', () => {
  assert.strictEqual(model.routes.size, 11);
  assert.deepStrictEqual(model.routes.get('UP-N'), { id: 'UP-N', short: 'UP-N', long: 'Union Pacific North', color: '#008000' });
  assert.strictEqual(model.routes.get('UP-NW').color, '#ffe600');
  assert.strictEqual(model.stops.size, 241);
  assert.strictEqual(model.stops.get('ROGERPK').name, 'Rogers Park');
  assert.strictEqual(model.trips.length, 3371);
  assert.strictEqual(model.published, '11/14/26 02:20:03 AM America/Chicago');
  assert.strictEqual(model.through, '20261231');
});

test('inbound is direction_id 1, not the headsign', () => {
  const sc = model.trips.filter((t) => t.headsign === 'South Chicago (93rd)');
  assert.ok(sc.length > 100);
  assert.ok(sc.every((t) => !t.inbound));
  assert.ok(model.trips.filter((t) => t.headsign === 'Chicago OTC').every((t) => t.inbound));
});

test('servicesOn: weekdays, weekends, and the calendar exceptions', () => {
  const on = (d) => [...m.servicesOn(model, d)].sort();
  assert.deepStrictEqual(on('20261127'), ['A1A']);          // Friday after Thanksgiving: a normal weekday
  assert.deepStrictEqual(on('20261126'), ['A2A', 'A4A']);   // Thanksgiving runs the weekend schedule
  assert.deepStrictEqual(on('20261114'), ['C2', 'C3']);     // a one-off Saturday
  assert.deepStrictEqual(on('20261122'), ['D2', 'D4']);     // a one-off Sunday
  assert.deepStrictEqual(on('20261101'), ['A2', 'A4']);     // the old calendar, before Nov 9
  assert.deepStrictEqual(on('20270102'), []);               // past what's published
});

test('departures at Rogers Park, Friday 5:42 PM', () => {
  const r = m.departures(model, 'ROGERPK', at('2026-11-27T17:42:00'));
  assert.deepStrictEqual(trips(r), {
    in: ['UP-N_UN358_V2_AA', 'UP-N_UN360_V9_AA', 'UP-N_UN362_V2_AA'],
    out: ['UP-N_UN359_V2_AA', 'UP-N_UN361_V2_AA', 'UP-N_UN363_V2_AA'],
  });
  assert.strictEqual(r.in[0].at, at('2026-11-27T17:55:00'));
  assert.strictEqual(r.in[0].headsign, 'Chicago OTC');
  assert.strictEqual(r.out[1].headsign, 'Highland Park');
  assert.strictEqual(r.out[1].at, at('2026-11-27T18:00:00'));
  assert.strictEqual(r.out[0].sched, r.out[0].at);
});

test('late at night: the train after midnight, then tomorrow\'s first trains', () => {
  const r = m.departures(model, 'ROGERPK', at('2026-11-27T23:48:00'));
  assert.deepStrictEqual(trips(r), {
    in: ['UP-N_UN376_V9_AA', 'UP-N_UN800_V10_AA', 'UP-N_UN802_V1_AA'],
    out: ['UP-N_UN375_V1_AA', 'UP-N_UN377_V1_AA', 'UP-N_UN803_V2_AA'],
  });
  assert.strictEqual(r.in[0].at, at('2026-11-28T00:25:00'));   // Friday's service, 24:25:00
  assert.strictEqual(r.in[1].at, at('2026-11-28T05:25:00'));   // Saturday's first
  assert.strictEqual(r.out[2].at, at('2026-11-28T06:52:00'));
});

test('trains ending at a station are not departures from it', () => {
  // The schedule's latest time, 26:25:00, is a UP-NW train reaching Harvard.
  const r = m.departures(model, 'HARVARD', at('2026-11-28T01:00:00'), { perDir: 2 });
  assert.deepStrictEqual(trips(r), { in: ['UP-NW_UNW702_V2_AA', 'UP-NW_UNW706_V6_AA'], out: [] });
  // Ogilvie: every inbound train ends there, so only outbound ones leave.
  const o = m.departures(model, 'OTC', at('2026-11-27T17:42:00'));
  assert.deepStrictEqual(trips(o), { in: [], out: ['UP-W_UW57_V2_AA', 'UP-NW_UNW661_V2_AA', 'UP-N_UN363_V2_AA'] });
});

test('to: only trains that go on to stop there, with their arrival', () => {
  const r = m.departures(model, 'OTC', at('2026-11-27T17:42:00'), { perDir: 4, to: 'ROGERPK' });
  assert.deepStrictEqual(r.out.map((d) => [d.trip, d.at, d.arr]), [
    ['UP-N_UN363_V2_AA', at('2026-11-27T18:02:00'), at('2026-11-27T18:22:00')],
    ['UP-N_UN365_V2_AA', at('2026-11-27T18:32:00'), at('2026-11-27T18:52:00')],
    ['UP-N_UN367_V2_AA', at('2026-11-27T19:32:00'), at('2026-11-27T19:52:00')],
    ['UP-N_UN369_V3_AA', at('2026-11-27T20:32:00'), at('2026-11-27T20:52:00')],
  ]);
  // A stop the train has already passed doesn't count.
  assert.deepStrictEqual(m.departures(model, 'ROGERPK', at('2026-11-27T17:42:00'), { to: 'OTC' }).out, []);
});

test('the day the clocks fall back: wall times still right', () => {
  const r = m.departures(model, 'ROGERPK', at('2026-11-01T04:00:00'), { perDir: 2 });
  assert.deepStrictEqual(r.in.map((d) => d.at), [at('2026-11-01T05:25:00'), at('2026-11-01T06:25:00')]);
  assert.deepStrictEqual(r.out.map((d) => d.at), [at('2026-11-01T06:52:00'), at('2026-11-01T07:52:00')]);
});

test('unknown stop, or past the published schedule: nothing', () => {
  assert.deepStrictEqual(m.departures(model, 'NOWHERE', at('2026-11-27T17:42:00')), { in: [], out: [] });
  assert.deepStrictEqual(m.departures(model, 'ROGERPK', at('2027-01-05T08:00:00')), { in: [], out: [] });
});

test('parseSchedule refuses a schedule missing a file or a column', () => {
  const files = readZip(ZIP, { only: m.FILES });
  const without = new Map(files); without.delete('stop_times.txt');
  assert.throws(() => m.parseSchedule(without), /no stop_times.txt/);
  const bad = new Map(files); bad.set('trips.txt', Buffer.from('trip_id,route_id\nX,UP-N\n'));
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

test('poller: downloads once, then only when published.txt changes', async () => {
  const src = fakeSource();
  const s = m.createMetraSchedule({ fetch: src.fetch, log: quiet });
  assert.strictEqual(s.get(), null);
  await s.refresh();
  assert.strictEqual(s.get().published, PUBLISHED);
  await s.refresh();
  assert.deepStrictEqual(src.calls, ['published.txt', 'schedule.zip', 'published.txt']);
  src.published = '11/28/26 03:00:00 AM America/Chicago';
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
  src.zip = ZIP;
  await s.refresh();
  assert.strictEqual(s.get().published, 'new');
});
