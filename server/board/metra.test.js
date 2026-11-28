'use strict';
// The Metra screen (design spec §5, "Metra"; contract "Metra"): metraView's
// payload from the made-up schedule (fixtures/metra/), and how draw.js shows it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readZip } = require('./zip');
const S = require('./metra-schedule');
const { scheduleZip } = require('./fixtures/metra/make-zip');
const { metraView, stopsByLine, fit, dirOf, infoOf } = require('./metra');
const { render, C } = require('./render');
const { parseCtaTime: at, tzOffset } = require('./time');
const { measure } = require('./fonts');
const G = require('./glyphs');

const model = S.parseSchedule(readZip(scheduleZip(), { only: S.FILES }), { published: 'test' });
const CUT = String.fromCodePoint(G.CUT);
const MON_5PM = at('2026-11-30T17:00:00');
// Each row as "half line minutes destination day arrival-minutes".
const brief = (v, now) => v.rows.map((r) => [r.h, r.ln, (r.t - now) / 60, r.d.replace(CUT, '..'), r.dy, r.arr && (r.arr - now) / 60].filter((x) => x !== undefined && x !== '').join(' '));

test('metra: fit cuts at a letter and ends with the two-dot glyph', () => {
  assert.equal(fit('Main St', 40), 'MAIN ST');
  const cut = fit('Manhattan', 27);
  assert.ok(cut.endsWith(CUT) && measure('small', cut) <= 27 && 'MANHATTAN'.startsWith(cut.slice(0, -1)), cut);
  assert.equal(fit('Far End', measure('small', 'FAR' + CUT)), 'FAR' + CUT);  // no space before the dots
  assert.equal(fit('Anything', 1), '');
});

test('metra: the lines at a stop, and whether it is a terminus', () => {
  assert.deepEqual(infoOf(model, 'MAIN'), { lines: ['NL'], terminus: false, leaves: { in: true, out: true } });
  assert.deepEqual(infoOf(model, 'DT'), { lines: ['NL', 'WL'], terminus: true, leaves: { in: false, out: true } });
});

test('metra: a 64 board shows inbound before noon and outbound after, or the way it is set', () => {
  assert.equal(dirOf('auto', at('2026-11-30T11:59:00')), 'in');
  assert.equal(dirOf('auto', at('2026-11-30T12:00:00')), 'out');
  assert.equal(dirOf('in', MON_5PM), 'in');
  assert.equal(dirOf('out', at('2026-11-30T08:00:00')), 'out');
});

test('metra: two panels at a through station, inbound | outbound, schedule only', () => {
  const v = metraView(model, { stop: 'MAIN', dir: 'auto' }, MON_5PM, { cols: 128 });
  assert.deepEqual([v.rt, v.mode, v.halves, v.blk, v.stn], ['nokey', 'station', ['INBOUND', 'OUTBOUND'], 0, { name: 'MAIN ST', lines: [{ n: 'NL', c: '#008000' }] }]);
  // Three a half and a spare. N107 doesn't pick up here and N105 ends here;
  // more than 12 hours off, a row carries its day.
  assert.deepEqual(brief(v, MON_5PM), [
    '0 NL 20 DOWNT..', '0 NL 80 DOWNT..', '0 NL 445 DOWNT..', '0 NL 1460 DOWNT.. TUE',
    '1 NL 50 FAR END', '1 NL 80 FAR END', '1 NL 1490 FAR END TUE', '1 NL 1520 FAR END TUE',
  ]);
  assert.ok(v.rows.every((r) => r.s === 1 && r.c === '#008000'));
});

test('metra: one panel shows one direction', () => {
  let v = metraView(model, { stop: 'MAIN', dir: 'auto' }, MON_5PM);
  assert.deepEqual([v.mode, v.label, 'halves' in v], ['one', 'OUTBOUND', false]);
  assert.deepEqual(brief(v, MON_5PM), ['NL 50 FAR END', 'NL 80 FAR END', 'NL 1490 FAR END TUE', 'NL 1520 FAR END TUE']);
  v = metraView(model, { stop: 'MAIN', dir: 'in' }, MON_5PM);
  assert.equal(v.label, 'INBOUND');
  // A terminus only leaves one way, whatever the setting.
  assert.equal(metraView(model, { stop: 'DT', dir: 'in' }, MON_5PM).label, 'OUTBOUND');
});

test('metra: a terminus on two panels lists every train out, or those to the home stop with their arrival', () => {
  let v = metraView(model, { stop: 'DT' }, MON_5PM, { cols: 128 });
  assert.deepEqual([v.mode, v.home, v.stn.lines.map((l) => l.n)], ['terminus', null, ['NL', 'WL']]);
  assert.deepEqual(brief(v, MON_5PM), ['NL 30 FAR END', 'NL 60 FAR END', 'NL 90 MAIN ST', 'NL 120 CHICAGO SOUTH', 'WL 1410 WEEKDAY B TUE']);
  v = metraView(model, { stop: 'DT', to: 'OAK' }, MON_5PM, { cols: 128 });
  // N103 skips Oak Ave, N105 ends before it: a train a day.
  assert.equal(v.home, 'OAK AVE');
  assert.deepEqual(brief(v, MON_5PM).slice(0, 2), ['NL 30 FAR END 55', 'NL 1470 FAR END TUE 1495']);
});

test('metra: the colors Metra publishes too dark for the panel are replaced', () => {
  assert.deepEqual(require('./metra').COLOR_FIX, { HC: '#b4643c', SWS: '#3f7af0' });
});

test('metra: no schedule, a stop it lacks, or one that has run out: exp, no rows', () => {
  assert.equal(metraView(model, null, MON_5PM), null);
  assert.deepEqual(metraView(null, { stop: 'MAIN' }, MON_5PM, { cols: 128 }), { rt: 'nokey', rows: [], mode: 'station', exp: 1, stn: { name: '', lines: [] } });
  assert.equal(metraView(model, { stop: 'GONE' }, MON_5PM).exp, 1);
  assert.equal(metraView(model, { stop: 'MAIN' }, at('2027-01-05T10:00:00')).exp, 1);
});

test('metra: the picker lists every stop of each line, in order outbound, branches after', () => {
  assert.deepEqual(stopsByLine(model).map((l) => [l.rt, l.stops.map((s) => s.id)]), [['BL', ['LS', 'BA', 'BB', 'BC']], ['NL', ['DT', 'MAIN', 'OAK', 'FAR']], ['WL', ['DT', 'WKA', 'WKB']]]);
  // A branch's stops follow the main line's, marked with the branch's end;
  // an express (B3 skips BA) adds nothing.
  assert.deepEqual(stopsByLine(model)[0].stops.slice(2), [{ id: 'BB', name: 'Branch B End' }, { id: 'BC', name: 'Branch C End', br: 'Branch C End' }]);
  assert.deepEqual(stopsByLine(null), []);
});

test('metra: a home stop limits only a terminus; a through station ignores it', () => {
  const v = metraView(model, { stop: 'MAIN', to: 'OAK' }, MON_5PM, { cols: 128 });
  assert.deepEqual([v.mode, 'home' in v, v.rows.filter((r) => r.h === 0).length], ['station', false, 4]);
  assert.ok(v.rows.every((r) => r.arr === undefined));
});

test('metra: the terminus header fits the station, TO and the home stop before the clock', () => {
  const stops = new Map(model.stops);
  stops.set('DT', { ...stops.get('DT'), name: 'Chicago Downtown Terminal Station' });
  stops.set('OAK', { ...stops.get('OAK'), name: 'Oak Avenue Northbrook Junction' });
  const big = { ...model, stops };
  const w = (v) => measure('small', v.stn.name) + (v.home ? 3 + measure('small', 'TO ' + v.home) : 0);
  let v = metraView(big, { stop: 'DT' }, MON_5PM, { cols: 128 });
  assert.ok(w(v) <= 108 && v.stn.name.endsWith(CUT), v.stn.name);
  v = metraView(big, { stop: 'DT', to: 'OAK' }, MON_5PM, { cols: 128 });
  assert.ok(w(v) <= 108, `${v.stn.name} TO ${v.home}: ${w(v)} px`);
  assert.ok(measure('small', v.home) >= 40 - measure('small', 'TO ') - 3);
});

// Where draw.js puts each row's name and right column, for every three-row
// window the board shows as trains leave (the spare moves up).
function overlaps(v, now, x0, x1, rows) {
  const ct = (t) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(t * 1000)).replace(/\s?[AP]M$/i, '');
  const bad = [];
  for (let w = 0; w + 3 <= Math.max(3, rows.length); w++) {
    const win = rows.slice(w, w + 3);
    if (!win.length) continue;
    const nx = x0 + (v.blk ? 5 : 0) + Math.max(...win.map((r) => measure('small', ct(r.t)))) + 4;
    for (const r of win) {
      const end = nx + measure('small', r.d) - 1;
      for (const right of r.dy ? [r.dy, 'DUE', '59'] : ['DUE', '59']) {
        if (x1 - measure('small', right) + 1 - end - 1 < 2) bad.push(`${r.d} ${right} (window ${w})`);
      }
    }
  }
  return bad;
}

test('metra: names leave room for the right column in every window, the spare included', () => {
  for (const when of ['2026-11-30T05:00:00', '2026-11-30T09:30:00', '2026-11-30T17:00:00', '2026-11-30T23:30:00', '2026-12-05T10:00:00']) {
    const now = at(when);
    for (const stop of ['MAIN', 'OAK', 'WKA', 'BA']) {
      for (const dir of ['in', 'out']) {
        const v = metraView(model, { stop, dir }, now);
        assert.deepEqual(overlaps(v, now, 0, 63, v.rows), [], `64 ${stop} ${dir} ${when}`);
      }
      const v = metraView(model, { stop }, now, { cols: 128 });
      if (v.mode !== 'station') continue;
      for (const h of [0, 1]) assert.deepEqual(overlaps(v, now, ...[[0, 61], [66, 127]][h], v.rows.filter((r) => r.h === h)), [], `128 ${stop} ${when}`);
    }
  }
});

// ---- drawn (draw.js renderMetra) ----

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
function draw(setting, now, cols, tweak) {
  let metra = metraView(model, setting, now, { cols });
  if (tweak) metra = tweak(metra);
  return render({ now, tzo: tzOffset(now), screen: 'transit', tv: 'metra', metra, ...(cols === 128 ? { cols } : {}) }, { now, screen: 'transit' });
}
// The colors in a box of the frame.
function colors(f, x0, y0, x1, y1) {
  const out = new Set();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const p = f.get(x, y); if (p[0] || p[1] || p[2]) out.add(hex(p)); }
  return out;
}
const live = (m) => ({ ...m, rt: 'live', rows: m.rows.map((r, i) => (i === 0 ? { ...r, s: 0, late: 8 } : i === 1 ? { ...r, s: 0 } : r)) });

test('metra drawn: without realtime every countdown is grey; tracked ones are amber only when live', () => {
  let f = draw({ stop: 'MAIN' }, MON_5PM, 128);
  // Countdown column of the left half (its right edge; the rows are y 8-24
  // under the INBOUND | OUTBOUND labels).
  assert.ok(!colors(f, 50, 8, 61, 24).has(C.amber));
  assert.ok(colors(f, 50, 8, 61, 24).has(C.sch));
  f = draw({ stop: 'MAIN' }, MON_5PM, 128, live);
  assert.ok(colors(f, 50, 8, 61, 24).has(C.amber));
  // The first train is 8 minutes late: its time is red.
  assert.ok(colors(f, 0, 8, 20, 12).has(C.red));
  // Stale realtime: grey again, and a red line on row 0.
  f = draw({ stop: 'MAIN' }, MON_5PM, 128, (m) => ({ ...live(m), rt: 'stale' }));
  assert.ok(!colors(f, 0, 8, 127, 24).has(C.amber));
  assert.deepEqual([...colors(f, 0, 0, 127, 0)], [C.red]);
  assert.equal(colors(draw({ stop: 'MAIN' }, MON_5PM, 128, live), 0, 0, 127, 0).has(C.red), false);
});

test('metra drawn: a canceled train says CANCELED in grey until its time', () => {
  const f = draw({ stop: 'MAIN' }, MON_5PM, 64, (m) => ({ ...m, rt: 'live', rows: m.rows.map((r, i) => (i === 0 ? { ...r, x: 1 } : r)) }));
  const row0 = colors(f, 0, 8, 63, 12);  // under the OUTBOUND label
  assert.ok(!row0.has(C.label) && !row0.has(C.amber) && row0.has(C.sch), [...row0].join(' '));
});

test('metra drawn: no schedule draws the owl, and a train past 12 hours its day', () => {
  const owl = draw({ stop: 'MAIN' }, at('2027-01-05T10:00:00'), 128);
  const empty = draw({ stop: 'MAIN' }, MON_5PM, 128, (m) => ({ ...m, rows: [] }));
  const rows = draw({ stop: 'MAIN' }, MON_5PM, 128);
  const same = (a, b) => { for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) if (hex(a.get(x, y)) !== hex(b.get(x, y))) return false; return true; };
  assert.ok(colors(owl, 0, 0, 127, 31).size > 0 && !same(owl, rows));
  // NO DATA (schedule ran out) and NO TRAINS (none to come) are both the owl, worded apart.
  assert.ok(!same(owl, empty) && !same(empty, rows));
  const sat = draw({ stop: 'WKA' }, at('2026-12-05T10:00:00'), 128);
  assert.ok(colors(sat, 50, 8, 61, 24).has(C.sch));  // MON in grey where the countdown goes
});
