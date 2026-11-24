'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MAX_BUSES, LABEL_PX, BusError, dirShort, cleanLabel, autoLabel, labelOf, cleanBuses, stamp, normalize, busRows, busHalfRows } = require('./bus');
const { measure } = require('./fonts');
const { parseCtaTime } = require('./time');

const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bus', name), 'utf8'));
const NOW = parseCtaTime('2026-11-24T07:30:12');
const clark = { rt: '22', dir: 'Southbound', stpid: '1836', stpnm: 'Clark & Morse' };
const outer = { rt: '147', dir: 'Southbound', stpid: '1036', stpnm: 'Sheridan & Morse' };
const lunt = { rt: '96', dir: 'Westbound', stpid: '14880', stpnm: 'Morse Red Line Station' };

test('labels: route and direction by default, cleaned to what the small font draws', () => {
  assert.deepEqual(['Northbound', 'Southbound', 'Eastbound', 'WESTBOUND', 'West', 'Inbound'].map(dirShort), ['NB', 'SB', 'EB', 'WB', 'WB', 'IN']);
  assert.equal(autoLabel(clark), '22 SB');
  assert.equal(autoLabel({ rt: 'x49', dir: 'Northbound' }), 'X49 NB');
  assert.equal(labelOf({ ...clark, label: 'TO WORK' }), 'TO WORK');
  assert.equal(cleanLabel('  to   work \u{1F68C} '), 'TO WORK');
  // The longest route numbers still fit beside two times.
  assert.ok(measure('small', autoLabel({ rt: '111A', dir: 'Westbound' })) <= LABEL_PX);
});

test('cleanBuses: up to three, checked, labels kept only when they are the owner\'s and fit', () => {
  assert.equal(MAX_BUSES, 3);
  const out = cleanBuses([{ ...clark, label: ' downtown ', extra: 1 }, { ...outer, label: '147 sb' }, lunt]);
  assert.deepEqual(out, [{ ...clark, label: 'DOWNTOWN' }, outer, lunt]);
  assert.throws(() => cleanBuses([clark, outer, lunt, clark]), BusError);
  assert.throws(() => cleanBuses('22'), BusError);
  assert.throws(() => cleanBuses([{ rt: '22', dir: 'Southbound' }]), /stpid/);
  assert.throws(() => cleanBuses([{ ...clark, rt: '22;drop' }]), /rt/);
  assert.throws(() => cleanBuses([{ ...clark, label: 'THE BUS TO WORK' }]), /too long/);
  // The same route and direction at two stops: one needs a name of its own.
  assert.throws(() => cleanBuses([clark, { ...clark, stpid: '1841' }]), /share a label/);
  assert.equal(cleanBuses([clark, { ...clark, stpid: '1841', label: 'PRATT' }]).length, 2);
  assert.deepEqual(cleanBuses([]), []);
});

test('stamp: minute and second timestamps on the wall clock, or epoch milliseconds', () => {
  assert.equal(stamp('20261124 07:31:05') - stamp('20261124 07:30:12'), 53);
  assert.equal(stamp('20261124 07:31') - stamp('20261124 07:30'), 60);
  assert.equal(stamp(1795527072000), 1795527072);
  assert.equal(stamp('1795527072000'), 1795527072);
  assert.equal(stamp(''), null);
  assert.equal(stamp('soon'), null);
});

test('normalize: times from the fetch, canceled buses dropped, a quiet stop is not an error', () => {
  const { preds, quiet, gone } = normalize(load('predictions.json'), { now: NOW + 5 });
  assert.equal(preds.length, 7);                    // the canceled 22 (dyn 1) is gone
  assert.ok(preds.every((p) => p.ln === 'BUS'));
  assert.deepEqual(preds.map((p) => p.t - (NOW + 5)), [53, 208, 298, 840, 1003, 1518, 1680]);
  assert.deepEqual(preds[0], { ln: 'BUS', stpid: '1836', rt: '22', dir: 'Southbound', des: 'Harrison', rn: '4012@1836', t: NOW + 5 + 53 });
  assert.deepEqual([...quiet], ['14880']);
  assert.equal(gone.size, 0);
  const none = normalize(load('predictions-none.json'), { now: NOW });
  assert.deepEqual([none.preds.length, [...none.quiet], [...none.gone]], [0, ['14880'], ['99999']]);
  assert.throws(() => normalize(load('error-key.json')), /Invalid API access key/);
  assert.throws(() => normalize({ ctatt: {} }), /not a Bus Tracker response/);
  // One stop asked, nothing coming: the error may come without a stop.
  assert.equal(normalize({ 'bustime-response': { error: [{ msg: 'No arrival times' }] } }).preds.length, 0);
  // A single prediction can arrive as an object, not a list.
  const one = load('predictions.json')['bustime-response'].prd[1];
  assert.equal(normalize({ 'bustime-response': { prd: one } }, { now: NOW }).preds.length, 1);
});

test('busRows: one row per bus in the list\'s order, two times, kept when nothing is coming', () => {
  const { preds } = normalize(load('predictions.json'), { now: NOW });
  const rows = busRows([clark, outer, lunt], preds, NOW);
  assert.deepEqual(rows.map((r) => r.lbl), ['22 SB', '147 SB', '96 WB']);
  assert.deepEqual(rows.map((r) => r.t.map((t) => t - NOW)), [[53, 840], [208, 1003], []]);
  assert.ok(rows.every((r) => r.ln === 'BUS' && r.k === 1 && r.a === 0 && r.s.length === r.t.length));
  // Only its own route at a stop two routes share.
  assert.deepEqual(busRows([{ ...outer, rt: '151' }], preds, NOW)[0].t.map((t) => t - NOW), [298]);
  // A bus is dropped 30 s after its time, as trains are.
  assert.deepEqual(busRows([clark], preds, NOW + 53 + 30)[0].t.length, 2);
  assert.deepEqual(busRows([clark], preds, NOW + 53 + 31)[0].t.map((t) => t - NOW), [840, 1518]);
  assert.deepEqual(busRows([], preds, NOW), []);
  assert.deepEqual(busRows([clark], null, NOW)[0].t, []);
});

test('busHalfRows: in a half of a wide board a long label gives up the second time', () => {
  const { preds } = normalize(load('predictions.json'), { now: NOW });
  const rows = busHalfRows([clark, { ...outer, label: 'DOWNTOWN' }], preds, NOW, 1);
  assert.deepEqual(rows.map((r) => [r.lbl, r.t.length, r.h]), [['22 SB', 2, 1], ['DOWNTOWN', 1, 1]]);
});
