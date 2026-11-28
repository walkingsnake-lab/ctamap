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

test('metra: the picker lists each line\'s stops in order outbound', () => {
  assert.deepEqual(stopsByLine(model).map((l) => [l.rt, l.stops.map((s) => s.id)]), [['NL', ['DT', 'MAIN', 'OAK', 'FAR']], ['WL', ['DT', 'WKA', 'WKB']]]);
  assert.deepEqual(stopsByLine(null), []);
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
