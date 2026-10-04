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

// ---- transit animator ----

test('animator: a departing DUE fades out in place while the next time brightens; nothing rolls', () => {
  // Times chosen so the 7 and 16 don't tick over during the 55 s below.
  const p = payload([{ ln: 'RD', lbl: 'HOWARD', t: [NOW + 20, NOW + 7 * 60 + 58, NOW + 16 * 60 + 58], s: [0, 0, 0], a: 0 }]);
  const anim = draw.createTransitAnimator();
  const first = anim.step(p, NOW, 0);
  const [due, seven, sixteen] = first.rows[0].cells;
  assert.equal(due.text, 'DUE');
  // 55 s later the DUE train is gone from the live list (30 s grace).
  const t = 1000;
  const v = anim.step(p, NOW + 55, t);
  const cells = v.rows[0].cells;
  const leaving = cells.find((c) => c.id === due.id);
  assert.ok(leaving && leaving.alpha === 1 && leaving.text === 'DUE', 'starts fading from full');
  const mid = anim.step(p, NOW + 55, t + draw.FADE_MS / 2).rows[0].cells;
  const half = mid.find((c) => c.id === due.id);
  assert.ok(half.alpha > 0 && half.alpha < 1);
  // The remaining times keep their identity and position: no roll, no jump.
  const next = mid.find((c) => c.id === seven.id);
  assert.equal(next.roll, null);
  assert.equal(next.right, seven.right);
  assert.notEqual(next.color, draw.C.amber);        // still easing toward amber
  assert.notEqual(next.color, draw.C.dimAmber);
  const done = anim.step(p, NOW + 55, t + draw.FADE_MS + 10).rows[0].cells;
  assert.ok(!done.some((c) => c.id === due.id));
  assert.equal(done.find((c) => c.id === seven.id).color, draw.C.amber);
  assert.ok(done.some((c) => c.id === sixteen.id));
});

test('animator: a countdown change rolls the same arrival', () => {
  const p = payload([{ ln: 'RD', lbl: 'HOWARD', t: [min(12)], s: [0], a: 0 }]);
  const anim = draw.createTransitAnimator();
  const a = anim.step(p, NOW, 0).rows[0].cells[0];
  const b = anim.step(p, NOW + 60, 100).rows[0].cells[0];
  assert.equal(a.id, b.id);
  assert.equal(b.text, '11');
  assert.deepEqual(b.roll, { from: '12', p: 0 });
});

test('animator: refreshed predictions keep identity (matched by time)', () => {
  const anim = draw.createTransitAnimator();
  const a = anim.step(payload([{ ln: 'RD', lbl: 'HOWARD', t: [min(5), min(12)], s: [0, 0], a: 0 }]), NOW, 0).rows[0].cells;
  // New update: both trains slipped by 20 s.
  const b = anim.step(payload([{ ln: 'RD', lbl: 'HOWARD', t: [min(5) + 20, min(12) + 20], s: [0, 0], a: 0 }]), NOW, 100).rows[0].cells;
  assert.deepEqual(b.map((c) => c.id), a.map((c) => c.id));
  assert.ok(b.every((c) => c.alpha === 1));
});

test('animator: a row whose last train leaves fades out, then the others slide to their new places', () => {
  const rowsAt = (gone) => [
    { ln: 'RD', lbl: 'HOWARD', t: [min(4)], s: [0], a: 0 },
    { ln: 'RD', lbl: '95TH', t: gone ? [] : [NOW + 10], s: [0], a: 0 },
    { ln: 'BR', lbl: 'KIMBALL', t: [min(9)], s: [0], a: 0 },
  ].filter((r) => r.t.length);
  const anim = draw.createTransitAnimator();
  const v0 = anim.step(payload(rowsAt(false)), NOW, 0);
  const kimball0 = v0.rows.find((r) => r.key === 'BR:KIMBALL').top;
  const v1 = anim.step(payload(rowsAt(true)), NOW + 60, 1000);
  assert.equal(v1.rows.find((r) => r.key === 'RD:95TH').alpha, 1);
  const during = anim.step(payload(rowsAt(true)), NOW + 60, 1000 + draw.FADE_MS / 2);
  assert.ok(during.rows.find((r) => r.key === 'RD:95TH').alpha < 1);
  assert.equal(during.rows.find((r) => r.key === 'BR:KIMBALL').top, kimball0, 'others wait for the fade');
  const after = anim.step(payload(rowsAt(true)), NOW + 60, 1000 + draw.FADE_MS + draw.MOVE_MS + 10);
  assert.ok(!after.rows.some((r) => r.key === 'RD:95TH'));
  assert.deepEqual(after.rows.map((r) => r.top), draw.rowTops(2, true, false));
});

test('animator frames render without errors and match the static frame when settled', () => {
  const p = payload([{ ln: 'RD', lbl: 'HOWARD', t: [min(3), min(8)], s: [0, 1], a: 0 }]);
  const anim = draw.createTransitAnimator();
  anim.step(p, NOW, 0);
  const view = anim.step(p, NOW, 5000);
  assert.deepEqual(draw.renderTransit(p, { view }).px, draw.renderTransit(p).px);
});

test('ticker pacing is slow: long hold, gentle slide', () => {
  assert.ok(draw.PAGE_HOLD_MS >= 8000);
  assert.ok(draw.SLIDE_MS >= 1000);
});

// ---- chronological view ----

const chronoRow = (ln, lbl, t, rn, s = 0) => ({ ln, lbl, t: [t], s: [s], a: 0, rn });
const chronoPayload = (rows) => ({ ...payload(rows), view: 'chrono' });

test('chrono: "4m" with a 1px gap, DUE bare, right-aligned; first row amber', () => {
  assert.equal(draw.chronoText(min(4), NOW), '4m');
  assert.equal(draw.chronoText(min(12), NOW), '12m');
  assert.equal(draw.chronoText(NOW + 30, NOW), 'DUE');
  const p = chronoPayload([chronoRow('RD', 'HOWARD', min(4), '801'), chronoRow('BR', 'KIMBALL', min(12), '402')]);
  const f = draw.renderTransit(p);
  const [top0, top1] = draw.rowTops(2, true, false);
  // m (5px) ends on the last column; one blank column before it.
  assert.equal(count(f, draw.C.amber, 59, top0, 63, top0 + 4), 10);
  assert.equal(count(f, draw.C.amber, 58, top0, 58, top0 + 4), 0);
  assert.ok(count(f, draw.C.amber, 55, top0, 57, top0 + 4) > 0);
  assert.equal(count(f, draw.C.amber, 0, top1, 63, top1 + 4), 0);
  assert.ok(count(f, draw.C.dimAmber, 50, top1, 63, top1 + 4) > 0);
});

test('chrono: the board shows at most the row cap; extra trains wait', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((m) => chronoRow('BL', "O'HARE", min(m * 3), String(100 + m)));
  const v = draw.buildTransitView(chronoPayload(rows), NOW);
  assert.equal(v.rows.length, 4);
  assert.deepEqual(v.rows.map((r) => r.top), draw.rowTops(4, true, false));
});

test('chrono animator: the first train slides up and out, the list follows, the next train slides in', () => {
  const rows = [chronoRow('RD', 'HOWARD', NOW + 10, '801'), ...[4, 7, 9, 12].map((m, i) => chronoRow('BR', 'LOOP', min(m), String(400 + i)))];
  const p = chronoPayload(rows);
  const tops = draw.rowTops(4, true, false);
  const pitch = tops[1] - tops[0];
  const anim = draw.createTransitAnimator();
  const v0 = anim.step(p, NOW, 0);
  assert.deepEqual(v0.rows.map((r) => r.key), ['rn:801', 'rn:400', 'rn:401', 'rn:402']);
  // 45 s later the first train is past the 30 s grace.
  const t = 1000;
  anim.step(p, NOW + 45, t);
  const mid = anim.step(p, NOW + 45, t + draw.MOVE_MS / 2);
  const by = (v, k) => v.rows.find((r) => r.key === k);
  const gone = by(mid, 'rn:801');
  assert.ok(gone.top < tops[0] && gone.top > tops[0] - pitch, 'departing row moves up');
  assert.ok(gone.alpha < 1 && gone.alpha > 0);
  assert.ok(by(mid, 'rn:400').top < tops[1] && by(mid, 'rn:400').top > tops[0], 'list slides at the same time');
  const incoming = by(mid, 'rn:403');
  assert.ok(incoming.top > tops[3] && incoming.alpha < 1, 'next train comes in from below');
  const end = anim.step(p, NOW + 45, t + draw.FADE_MS + 10);
  assert.deepEqual(end.rows.map((r) => r.key), ['rn:400', 'rn:401', 'rn:402', 'rn:403']);
  assert.deepEqual(end.rows.map((r) => r.top), tops);
  assert.equal(by(end, 'rn:400').cells[0].color, draw.C.amber);
  assert.deepEqual(draw.renderTransit(p, { now: NOW + 45, view: end }).px, draw.renderTransit(p, { now: NOW + 45 }).px);
});

test('chrono animator: two trains swapping order slide past each other, no fade', () => {
  const anim = draw.createTransitAnimator();
  const a = chronoRow('RD', 'HOWARD', min(5), '801');
  const b = chronoRow('RD', '95TH', min(6), '802');
  anim.step(chronoPayload([a, b]), NOW, 0);
  const swapped = chronoPayload([{ ...b, t: [min(4)] }, a]);
  anim.step(swapped, NOW, 1000);
  const mid = anim.step(swapped, NOW, 1000 + draw.MOVE_MS / 2);
  assert.ok(mid.rows.every((r) => r.alpha === 1));
  const end = anim.step(swapped, NOW, 1000 + draw.MOVE_MS + 10);
  assert.equal(end.rows.find((r) => r.key === 'rn:802').top, draw.rowTops(2, true, false)[0]);
});

test('switching views cross-fades: old rows fade out, then the new ones fade in', () => {
  const anim = draw.createTransitAnimator();
  anim.step(payload([{ ln: 'RD', lbl: 'HOWARD', t: [min(4), min(9)], s: [0, 0], a: 0 }]), NOW, 0);
  const chrono = chronoPayload([chronoRow('RD', 'HOWARD', min(4), '801'), chronoRow('RD', 'HOWARD', min(9), '802')]);
  anim.step(chrono, NOW, 1000);
  const mid = anim.step(chrono, NOW, 1000 + draw.FADE_MS / 2);
  assert.ok(mid.rows.find((r) => r.key === 'RD:HOWARD').alpha < 1);
  assert.ok(mid.rows.filter((r) => r.key.startsWith('rn:')).every((r) => r.alpha === 0));
  const end = anim.step(chrono, NOW, 1000 + 2 * draw.FADE_MS + 10);
  assert.deepEqual(end.rows.map((r) => r.key), ['rn:801', 'rn:802']);
  assert.ok(end.rows.every((r) => r.alpha === 1));
});

// ---- radar screen ----

test('radar: palette, marker, frame indicator, clock and AM/PM, warning icon', () => {
  const bytes = new Uint8Array(2048);
  bytes[0] = 1; bytes[1] = 5; bytes[2] = 8; bytes[16 * 64 + 20] = 7;
  const t = Date.UTC(2020, 7, 10, 21, 0) / 1000; // 4:00 PM CDT
  const ids = ['a', 'b', 'c'];
  const p = { now: t, bright: 100, warn: { kind: 'svr', lvl: 'warning' }, radar: { on: true, frames: ids, ft: [t - 600, t - 300, t], clock: [40, 0, 24, 32], split: true } };
  const f = draw.render(p, { screen: 'radar', frames: { a: bytes, b: bytes, c: bytes }, idx: 2 });
  assert.equal(hex(f.get(0, 0)), draw.RADAR[1]);
  assert.equal(hex(f.get(1, 0)), draw.RADAR[5]);
  assert.equal(hex(f.get(2, 0)), draw.RADAR[8]);
  assert.equal(hex(f.get(20, 16)), '#ffffff');
  // Stack is 18 rows, centered in the 32-row box: indicator on rows 7-8,
  // current (last) segment amber at the right edge.
  assert.equal(hex(f.get(62, 7)), draw.C.amber);
  assert.equal(hex(f.get(56, 7)), draw.C.indicator);
  assert.ok(count(f, draw.C.clock, 40, 11, 63, 17) > 20, 'clock "4:00" on rows 11-17');
  assert.ok(count(f, draw.C.grey, 40, 20, 63, 24) > 5, 'PM on rows 20-24');
  assert.ok(count(f, draw.C.warnSevere, 40, 20, 63, 24) > 3, 'bolt left of PM');
  // Nothing of the stack spills into the radar area.
  for (let y = 0; y < 32; y++) for (let x = 37; x < 40; x++) assert.deepEqual(f.get(x, y), [0, 0, 0]);
  // A frame not fetched yet draws as empty radar with the stack.
  const empty = draw.render(p, { screen: 'radar', frames: {}, idx: 0 });
  assert.equal(count(empty, draw.RADAR[1], 0, 0, 39, 31), 0);
  assert.equal(hex(empty.get(56, 7)), draw.C.amber);
});
