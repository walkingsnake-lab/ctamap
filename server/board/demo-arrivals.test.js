'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { demoArrivals, SERVICE, HORIZON, GRACE } = require('./demo-arrivals');
const { format } = require('./arrivals');
const { stationDestinations, shortDest } = require('./destinations');
const STATIONS = require('./stations.json');

const st = (mapid) => STATIONS.find((s) => s.mapid === mapid);
const NOW = 1795830000;
const keys = (list) => [...new Set(list.filter((a) => !a.arr).map((a) => `${a.ln}:${a.dest}`))].sort();
const mins = (a, now) => Math.ceil((a.t - now) / 60);

test('demo arrivals: both directions on a fixed headway, inside the window, soonest first', () => {
  const list = demoArrivals(st('40100'), NOW); // Morse: Red only
  assert.deepEqual(keys(list), ['RD:95th', 'RD:Howard']);
  assert.ok(list.every((a) => a.t >= NOW - GRACE && a.t <= NOW + HORIZON));
  assert.deepEqual(list.map((a) => a.t), list.map((a) => a.t).sort((x, y) => x - y));
  for (const dest of ['Howard', '95th']) {
    const ts = list.filter((a) => a.dest === dest).map((a) => a.t);
    assert.ok(ts.length >= 4, `${dest}: ${ts.length} trains in 25 min`);
    for (let i = 1; i < ts.length; i++) assert.equal(ts[i] - ts[i - 1], 360);
  }
  // Shaped like normalize()'s arrivals: live predictions with run numbers.
  for (const a of list) {
    assert.deepEqual(Object.keys(a).sort(), ['dest', 'dir', 'full', 'known', 'ln', 'rn', 's', 't']);
    assert.equal(a.s, 0);
    assert.equal(a.known, true);
    assert.match(a.rn, /^8\d\d$/);
  }
  assert.equal(new Set(list.map((a) => `${a.ln}:${a.rn}`)).size, list.length, 'run numbers are unique');
});

test('demo arrivals: a train keeps its time and run number from update to update, counts down, and leaves', () => {
  const morse = st('40100');
  const first = demoArrivals(morse, NOW);
  const next = first[0];
  // Thirty seconds on, every train still listed has the same time.
  const later = new Map(demoArrivals(morse, NOW + 30).map((a) => [`${a.ln}:${a.rn}`, a.t]));
  for (const a of first) if (later.has(`${a.ln}:${a.rn}`)) assert.equal(later.get(`${a.ln}:${a.rn}`), a.t);
  // The soonest one stays through its grace, then is gone.
  const has = (now) => demoArrivals(morse, now).some((a) => a.rn === next.rn && a.t === next.t);
  assert.ok(has(next.t + GRACE));
  assert.ok(!has(next.t + GRACE + 1));
  // A headway on, trains have joined at the far end.
  assert.ok(demoArrivals(morse, NOW + 360).some((a) => a.t > NOW + HORIZON));
  // It never runs dry: every minute of two hours has trains both ways.
  for (let t = NOW; t < NOW + 7200; t += 60) assert.deepEqual(keys(demoArrivals(morse, t)), ['RD:95th', 'RD:Howard']);
});

test('demo arrivals: a line\'s two directions never show the same minutes', () => {
  for (const mapid of ['40100', '41320', '40380', '41280']) {
    const list = demoArrivals(st(mapid), NOW);
    for (const ln of new Set(list.map((a) => a.ln))) {
      const by = (dir) => list.filter((a) => a.ln === ln && !a.arr && a.dir === dir).slice(0, 2).map((a) => mins(a, NOW)).join(',');
      if (by(1) && by(5)) assert.notEqual(by(1), by(5), `${mapid} ${ln}`);
    }
  }
});

test('demo arrivals: only destinations the station really has', () => {
  // On the Loop, trains are named for where they go next, never "Loop".
  assert.deepEqual(keys(demoArrivals(st('40380'), NOW)), ['BL:Forest', "BL:O'Hare", 'BR:Kimball', 'GR:63rd', 'GR:Cottage', 'GR:Harlem', 'OR:Midway', 'PK:54/Crmk', 'PR:Linden']);
  // Belmont: Brown both ways, Purple Express to the Loop (never to Howard).
  assert.deepEqual(keys(demoArrivals(st('41320'), NOW)), ['BR:Kimball', 'BR:Loop', 'PR:Linden', 'PR:Loop', 'RD:95th', 'RD:Howard']);
  // Evanston: Purple to Howard and Linden, no Express.
  assert.deepEqual(keys(demoArrivals(st('40050'), NOW)), ['PR:Howard', 'PR:Linden']); // Davis
  // Green's south branches don't see each other's trains, and theirs to
  // Harlem are every other one.
  assert.deepEqual(keys(demoArrivals(st('40940'), NOW)), ['GR:63rd', 'GR:Harlem']); // Halsted
  assert.deepEqual(keys(demoArrivals(st('41140'), NOW)), ['GR:Cottage', 'GR:Harlem']); // King Drive
  const harlemAt = (now) => demoArrivals(st('40940'), now).filter((a) => a.dest === 'Harlem').map((a) => a.t);
  const harlem = [...new Set([...harlemAt(NOW), ...harlemAt(NOW + 1200)])].sort((x, y) => x - y);
  assert.ok(harlem.length >= 2);
  for (let i = 1; i < harlem.length; i++) assert.equal(harlem[i] - harlem[i - 1], 1200);
  // North of the split both branches alternate southbound.
  const south = demoArrivals(st('40510'), NOW).filter((a) => a.dir === 5).map((a) => a.dest); // Garfield
  assert.ok(south.length >= 2);
  for (let i = 1; i < south.length; i++) assert.notEqual(south[i], south[i - 1]);
});

test('demo arrivals: at an end of the line, trains ending there are arrivals from the other end', () => {
  const howard = demoArrivals(st('40900'), NOW);
  assert.deepEqual(keys(howard), ['PR:Linden', 'PR:Loop', 'RD:95th', 'YL:Skokie']);
  const ending = howard.filter((a) => a.arr);
  // Purple's locals from Linden end here too (its Express runs on to the Loop).
  assert.deepEqual([...new Set(ending.map((a) => `${a.ln}:${a.dest}`))].sort(), ['PR:Linden', 'RD:95th', 'YL:Skokie']);
  assert.ok(ending.every((a) => a.known === undefined && a.full));
  // Ashland/63rd: Green's south ends share a direction, so there's no single origin.
  const ash = demoArrivals(st('40290'), NOW);
  assert.deepEqual(keys(ash), ['GR:Harlem']);
  assert.ok(ash.some((a) => a.arr && a.dest === 'Harlem'));
});

test('demo arrivals: every station gets trains, all to destinations its picker lists', () => {
  for (const s of STATIONS) {
    const list = demoArrivals(s, NOW);
    assert.ok(list.length > 0, s.name);
    const allowed = new Set(stationDestinations(s));
    for (const k of keys(list)) assert.ok(allowed.has(k), `${s.name}: ${k}`);
    for (const a of list) assert.ok(s.lines.includes(a.ln), `${s.name}: ${a.ln}`);
  }
  // Every destination in the table has a short name the board knows.
  for (const svc of Object.values(SERVICE)) for (const t of svc.to) assert.ok(shortDest(t.dest).known, t.dest);
});

test('demo arrivals: nothing for an unknown station', () => {
  assert.deepEqual(demoArrivals(null, NOW), []);
  assert.deepEqual(demoArrivals({ mapid: '1', lines: [] }, NOW), []);
});

test('demo arrivals: format() lays them out as full rows', () => {
  const s = st('40100');
  const { rows } = format(demoArrivals(s, NOW), { showHeader: true, showWeather: false, lines: s.lines }, { now: NOW });
  assert.deepEqual(rows.map((r) => [r.ln, r.lbl]), [['RD', 'HOWARD'], ['RD', '95TH']]);
  assert.ok(rows.every((r) => r.t.length === 3 && r.s.every((x) => x === 0)));
});
