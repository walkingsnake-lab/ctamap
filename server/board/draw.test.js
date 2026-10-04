'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const draw = require('./render');
const { liveRows, easeInOut } = require('./draw');

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const NOW = 1_800_000_000;
const min = (m) => NOW + m * 60 + 5;

function payload(rows, ticker = []) {
  return { v: 1, now: NOW, age: 0, screen: 'transit', bright: 100, header: 'TEST', rows, ticker, wx: null, warn: null };
}

// Lit pixels of a given color inside a box.
function count(f, color, x0, y0, x1, y1) {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (hex(f.get(x, y)) === color) n++;
  return n;
}

test('liveRows drops arrivals 30 s past and removes empty rows', () => {
  const p = payload([
    { ln: 'RD', lbl: 'HOWARD', t: [NOW - 40, NOW + 300], s: [0, 1], a: 0 },
    { ln: 'RD', lbl: '95TH', t: [NOW - 31], s: [0], a: 0 },
  ]);
  const rows = liveRows(p, NOW);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].t, [NOW + 300]);
  assert.deepEqual(rows[0].s, [1]); // schedule flags stay aligned
});

test('transitTexts keys each slot for change detection', () => {
  const p = payload([{ ln: 'RD', lbl: 'HOWARD', t: [min(12), min(20)], s: [0, 0], a: 0 }]);
  assert.deepEqual(draw.transitTexts(p, NOW), { 'RD:HOWARD:0': '12', 'RD:HOWARD:1': '20' });
});

test('per-digit roll: only the changed digit moves; finished roll equals a static frame', () => {
  const p = payload([{ ln: 'RD', lbl: 'HOWARD', t: [min(11)], s: [0], a: 0 }]);
  const still = draw.renderTransit(p);
  const done = draw.renderTransit(p, { rolls: { 'RD:HOWARD:0': { from: '12', p: 1 } } });
  assert.deepEqual(done.px, still.px);
  const mid = draw.renderTransit(p, { rolls: { 'RD:HOWARD:0': { from: '12', p: 0.5 } } });
  const top = draw.rowTops(1, true, false)[0];
  // "11" is 7px wide ending at column 63: tens digit in 57-59, ones in 61-63.
  const tens = (f) => count(f, draw.C.amber, 57, top, 59, top + 4);
  const ones = (f) => count(f, draw.C.amber, 61, top, 63, top + 4);
  assert.equal(tens(mid), tens(still), 'unchanged tens digit stays put');
  assert.notEqual(ones(mid), ones(still), 'ones digit is mid-roll');
  // Nothing escapes the row's 5px band.
  assert.equal(count(mid, draw.C.amber, 0, 0, 63, top - 1), 0);
  assert.equal(count(mid, draw.C.amber, 0, top + 5, 63, 31), 0);
});

test('whole-cell roll when the length changes or DUE is involved', () => {
  const p = payload([{ ln: 'RD', lbl: 'HOWARD', t: [min(9)], s: [0], a: 0 }]);
  const top = draw.rowTops(1, true, false)[0];
  const mid = draw.renderTransit(p, { rolls: { 'RD:HOWARD:0': { from: '10', p: 0.5 } } });
  // The old "10" has a tens digit left of the new single digit; mid-roll, some of it is still visible.
  assert.ok(count(mid, draw.C.amber, 50, top, 59, top + 4) > 0);
  const due = payload([{ ln: 'RD', lbl: 'HOWARD', t: [NOW + 30], s: [0], a: 0 }]);
  const toDue = draw.renderTransit(due, { rolls: { 'RD:HOWARD:0': { from: '2', p: 0.5 } } });
  assert.ok(count(toDue, draw.C.amber, 40, top, 63, top + 4) > 0);
});

test('ticker slide moves the page up and brings the next page in from below', () => {
  const items = [1, 2, 3, 4].map((m, i) => ({ ln: i < 2 ? 'RD' : 'BL', d: `T${m}`, t: min(m * 5), s: 0, a: 0 }));
  const p = payload([], items);
  const red = '#' + [0xc6, 0x0c, 0x30].map((v) => Math.round(v * 0.55).toString(16).padStart(2, '0')).join('');
  const blue = '#' + [0x00, 0xa1, 0xde].map((v) => Math.round(v * 0.55).toString(16).padStart(2, '0')).join('');
  const start = draw.renderTicker(p, { page: 0, slide: 0 });
  const half = draw.renderTicker(p, { page: 0, slide: 0.5 });
  const end = draw.renderTicker(p, { page: 0, slide: 1 });
  const page1 = draw.renderTicker(p, { page: 1, slide: 0 });
  assert.ok(count(start, red, 10, 7, 60, 31) > 0 && count(start, blue, 10, 7, 60, 31) === 0);
  assert.ok(count(half, red, 10, 7, 60, 31) > 0 && count(half, blue, 10, 7, 60, 31) > 0);
  assert.deepEqual(end.px, page1.px);
  // The header is never covered by sliding rows.
  assert.equal(count(half, red, 0, 0, 63, 6), 0);
  assert.equal(draw.tickerPages(p, NOW), 2);
});

test('ticker wraps from the last page back to the first', () => {
  const items = [1, 2, 3].map((m) => ({ ln: 'RD', d: `T${m}`, t: min(m * 5), s: 0, a: 0 }));
  const p = payload([], items);
  assert.deepEqual(draw.renderTicker(p, { page: 1, slide: 1 }).px, draw.renderTicker(p, { page: 0 }).px);
});

test('easing is monotonic from 0 to 1', () => {
  let prev = -1;
  for (let i = 0; i <= 20; i++) { const v = easeInOut(i / 20); assert.ok(v >= prev); prev = v; }
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
});

test('a full row tightens the gaps between times to 2px instead of overlapping the label', () => {
  const t = [NOW + 30, min(15), min(32)]; // DUE 15 32
  const p = payload([{ ln: 'BR', lbl: 'KIMBALL', t, s: [0, 0, 0], a: 0 }]);
  const f = draw.renderTransit(p);
  const top = draw.rowTops(1, true, false)[0];
  // KIMBALL ends at x=31; nothing amber may appear before x=35 (3px gap).
  assert.equal(count(f, draw.C.amber, 0, top, 34, top + 4), 0);
  assert.ok(count(f, draw.C.amber, 35, top, 45, top + 4) > 0); // DUE starts at 35
  // A short label keeps the normal 3px spacing.
  const roomy = draw.renderTransit(payload([{ ln: 'RD', lbl: 'LOOP', t, s: [0, 0, 0], a: 0 }]));
  assert.equal(count(roomy, draw.C.amber, 0, top, 32, top + 4), 0);
  assert.ok(count(roomy, draw.C.amber, 33, top, 43, top + 4) > 0); // DUE starts at 33
});
