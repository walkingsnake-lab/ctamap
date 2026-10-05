'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const draw = require('./render');
const { liveRows, easeInOut } = require('./draw');

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const NOW = 1_800_000_000;
const min = (m) => NOW + m * 60 - 5; // shows as m (minutes round up)

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
  // Stack is top-aligned (rows 2-19): indicator on rows 2-3, current (last)
  // segment amber at the right edge.
  assert.equal(hex(f.get(62, 2)), draw.C.amber);
  assert.equal(hex(f.get(56, 2)), draw.C.indicator);
  assert.ok(count(f, draw.C.radarTime, 40, 6, 63, 12) > 20, 'clock "4:00" on rows 6-12');
  assert.ok(count(f, draw.C.radarAmpm, 40, 15, 63, 19) > 5, 'PM on rows 15-19');
  assert.ok(count(f, draw.C.warnSevere, 40, 15, 63, 19) > 3, 'bolt left of PM');
  for (let y = 20; y < 32; y++) for (let x = 40; x < 64; x++) assert.deepEqual(f.get(x, y), [0, 0, 0], 'nothing below the stack');
  // Split layout: gray line on the panel's left edge (col 39); nothing of the
  // stack spills into the radar area.
  for (let y = 0; y < 32; y++) assert.equal(hex(f.get(39, y)), draw.C.divider);
  for (let y = 0; y < 32; y++) for (let x = 36; x < 39; x++) assert.deepEqual(f.get(x, y), [0, 0, 0]);
  for (let y = 0; y < 32; y++) assert.deepEqual(f.get(40, y), [0, 0, 0], '1px gap before the widest clock');
  const full = draw.render({ ...p, radar: { ...p.radar, clock: [40, 0, 24, 22], split: false } }, { screen: 'radar', frames: {}, idx: 2 });
  assert.deepEqual(full.get(39, 25), [0, 0, 0], 'no line in the full-width layout');
  // A frame not fetched yet draws as empty radar with the stack.
  const empty = draw.render(p, { screen: 'radar', frames: {}, idx: 0 });
  assert.equal(count(empty, draw.RADAR[1], 0, 0, 39, 31), 0);
  assert.equal(hex(empty.get(56, 2)), draw.C.amber);
});

test('radar with no frames yet draws the clock at the current time (no crash)', () => {
  const now = Date.UTC(2026, 9, 4, 16, 46) / 1000;
  for (const radar of [{ on: false, frames: [], ft: [], clock: null, split: false }, { on: false, frames: [], ft: [], clock: [40, 0, 24, 32], split: true }, undefined]) {
    for (const idx of [undefined, -1, 0, 3]) {
      const f = draw.render({ now, bright: 100, warn: null, radar }, { screen: 'radar', now, idx, frames: {} });
      assert.ok(count(f, draw.C.radarTime, 40, 0, 63, 31) > 15, 'clock drawn');
    }
  }
});

test('radar with no frames shows current conditions on the left', () => {
  const now = Date.UTC(2026, 9, 4, 16, 48) / 1000;
  const wx = { icon: 'sun', temp: 63, word: 'SUNNY', hi: 69, lo: 51 };
  const f = draw.render({ now, bright: 100, warn: null, radar: { on: false, frames: [], ft: [], clock: [40, 0, 24, 22], split: false, wx } }, { screen: 'radar', now, frames: {} });
  assert.ok(count(f, draw.C.label, 12, 3, 30, 9) > 15, 'temperature');
  assert.ok(count(f, draw.C.label, 0, 15, 38, 19) > 15, 'condition word');
  assert.ok(count(f, draw.C.grey, 0, 23, 38, 27) > 15, 'high/low');
  assert.ok(count(f, draw.C.radarTime, 40, 6, 63, 12) > 15, 'clock still drawn');
  // Widest case stays clear of the split divider.
  const wide = { icon: 'pcloudy_day', temp: -10, word: 'PT CLOUDY', hi: 100, lo: -10 };
  const g = draw.render({ now, bright: 100, warn: null, radar: { on: false, frames: [], ft: [], clock: [40, 0, 24, 32], split: true, wx: wide } }, { screen: 'radar', now, frames: {} });
  for (let y = 0; y < 32; y++) assert.deepEqual(g.get(38, y), [0, 0, 0], `col 38 row ${y}`);
  // Once frames exist, the radar replaces the conditions.
  const withFrames = draw.render({ now, bright: 100, warn: null, radar: { on: true, frames: ['a'], ft: [now], clock: [40, 0, 24, 22], split: false, wx } }, { screen: 'radar', now, frames: { a: new Uint8Array(2048) } });
  assert.equal(count(withFrames, draw.C.label, 0, 0, 38, 31), 0);
});

test('minutes round up, like CTA: DUE through 60 s, then 2, 3, ...; never 1', () => {
  const cases = [[-30, 'DUE'], [0, 'DUE'], [1, 'DUE'], [60, 'DUE'], [61, '2'], [120, '2'], [121, '3'], [599, '10'], [600, '10'], [601, '11']];
  for (const [s, want] of cases) assert.equal(draw.timeText(NOW + s, NOW), want, `${s} s`);
  assert.equal(draw.chronoText(NOW + 61, NOW), '2m');
  assert.equal(draw.chronoText(NOW + 60, NOW), 'DUE');
  // A fresh CTA prediction of "2 min" (arrival = prediction time + 120 s) shows 2.
  assert.equal(draw.timeText(NOW + 120, NOW), '2');
  // Ticker: same rule, "Due" / "2 min".
  const p = { now: NOW, bright: 100, header: null, ticker: [{ ln: 'RD', d: 'Howard', t: NOW + 61, s: 0, a: 0 }, { ln: 'RD', d: '95th', t: NOW + 60, s: 0, a: 0 }] };
  const f = draw.render(p, { screen: 'ticker', now: NOW });
  const g = draw.render({ ...p, ticker: [{ ...p.ticker[0], t: NOW + 120 }, p.ticker[1]] }, { screen: 'ticker', now: NOW });
  assert.deepEqual(f.px, g.px, '61 s and 120 s both draw as 2 min');
});

test('chrono: line-colored position digits instead of blocks; Brown and Purple brightened', () => {
  const p = chronoPayload([chronoRow('RD', 'HOWARD', min(2), '1'), chronoRow('BR', 'KIMBALL', min(4), '2'), chronoRow('PR', 'LINDEN', min(6), '3')]);
  const f = draw.renderTransit(p);
  const tops = draw.rowTops(3, true, false);
  assert.equal(draw.DIGIT.RD, draw.LINE.RD);
  assert.notEqual(draw.DIGIT.BR, draw.LINE.BR);
  assert.notEqual(draw.DIGIT.PR, draw.LINE.PR);
  ['RD', 'BR', 'PR'].forEach((ln, i) => {
    const n = count(f, draw.DIGIT[ln], 0, tops[i], 2, tops[i] + 4);
    assert.ok(n >= 5 && n < 15, `${ln} digit ${i + 1}: ${n} px (a solid block would be 15)`);
    assert.equal(count(f, draw.LINE[ln], 0, tops[i], 4, tops[i] + 4) - (draw.DIGIT[ln] === draw.LINE[ln] ? n : 0), 0, 'no color block');
  });
  // Destination rows keep the solid blocks.
  const d = draw.renderTransit(payload([{ ln: 'BR', lbl: 'KIMBALL', t: [min(4)], s: [0], a: 0 }]));
  assert.equal(count(d, draw.LINE.BR, 0, 0, 2, 31), 15);
});

test('chrono: alert blinks the digit to "!"', () => {
  const p = chronoPayload([{ ...chronoRow('GR', 'HARLEM', min(3), '1'), a: 1 }]);
  const top = draw.rowTops(1, true, false)[0];
  const on = draw.renderTransit(p, { blink: true });
  const off = draw.renderTransit(p, { blink: false });
  assert.equal(count(on, draw.DIGIT.GR, 0, top, 2, top + 4), 4); // 3px stem + dot
  assert.ok(count(off, draw.DIGIT.GR, 0, top, 2, top + 4) > 4);
});

test('chrono animator: position digits roll down as the list slides up', () => {
  const rows = [chronoRow('RD', 'HOWARD', NOW + 10, '801'), chronoRow('BR', 'LOOP', min(4), '400'), chronoRow('PR', 'LINDEN', min(7), '401')];
  const p = chronoPayload(rows);
  const anim = draw.createTransitAnimator();
  const v0 = anim.step(p, NOW, 0);
  assert.deepEqual(v0.rows.map((r) => r.num), [1, 2, 3]);
  anim.step(p, NOW + 45, 1000); // first train gone
  const mid = anim.step(p, NOW + 45, 1000 + draw.ROLL_MS / 2);
  const loop = mid.rows.find((r) => r.key === 'rn:400');
  assert.equal(loop.num, 1);
  assert.equal(loop.numRoll.from, '2');
  assert.ok(loop.numRoll.p > 0 && loop.numRoll.p < 1);
  const end = anim.step(p, NOW + 45, 1000 + draw.FADE_MS + 10);
  assert.deepEqual(end.rows.map((r) => [r.key, r.num, r.numRoll]), [['rn:400', 1, null], ['rn:401', 2, null]]);
  assert.deepEqual(draw.renderTransit(p, { now: NOW + 45, view: end }).px, draw.renderTransit(p, { now: NOW + 45 }).px);
});

test('only the soonest train of a destination reads DUE; a bunched second shows 2', () => {
  const { timeText, chronoText } = require('./draw');
  assert.equal(timeText(NOW + 20, NOW), 'DUE');
  assert.equal(timeText(NOW + 45, NOW, false), '2');
  assert.equal(timeText(NOW + 200, NOW, false), '4'); // normal times unaffected
  assert.equal(chronoText(NOW + 45, NOW, false), '2m');
  const p = payload([{ ln: 'RD', lbl: 'HOWARD', t: [NOW + 20, NOW + 45, NOW + 400], s: [0, 0, 0], a: 0 }]);
  const texts = Object.values(draw.transitTexts(p, NOW));
  assert.deepEqual(texts, ['DUE', '2', '7']);
  const chrono = { ...payload([{ ln: 'RD', lbl: 'HOWARD', t: [NOW + 20], s: [0], a: 0 }, { ln: 'RD', lbl: 'HOWARD', t: [NOW + 45], s: [0], a: 0 }, { ln: 'RD', lbl: '95TH', t: [NOW + 50], s: [0], a: 0 }]), view: 'chrono' };
  assert.deepEqual(Object.values(draw.transitTexts(chrono, NOW)), ['DUE', '2m', 'DUE']); // a different destination can be DUE too
});

test('autoScreen: radar visits on a timer, only while it rains on the auto screen', () => {
  const { autoScreen } = require('./draw');
  const p = (over = {}, radar = {}) => ({ screen: 'transit', radar: { on: true, visit: { every: 240, for: 60 }, ...radar }, ...over });
  const at = (cycle, off) => 1_800_000_000 - (1_800_000_000 % 240) + cycle * 240 + off; // epoch-aligned
  assert.equal(autoScreen(p(), at(3, 0)), 'radar');
  assert.equal(autoScreen(p(), at(3, 59.9)), 'radar');
  assert.equal(autoScreen(p(), at(3, 60)), 'transit');
  assert.equal(autoScreen(p(), at(3, 239)), 'transit');
  assert.equal(autoScreen(p(), at(4, 0)), 'radar');
  assert.equal(autoScreen(p({}, { on: false }), at(3, 0)), 'transit'); // no rain: no visit
  assert.equal(autoScreen(p({}, { visit: null }), at(3, 0)), 'transit'); // visits off
  assert.equal(autoScreen(p({ screen: 'ticker' }), at(3, 0)), 'ticker'); // forced screens win
  assert.equal(autoScreen({ screen: 'transit' }, at(3, 0)), 'transit'); // old payloads
});

// ---- baseball (design spec §8) ----

const CHC = { ab: 'CHC', c: '#2a5bd8' }, STL = { ab: 'STL', c: '#d62a2a' };
const bbGame = (extra) => ({ id: 1, start: NOW - 3600, away: { ...CHC, r: 3, w: 92, l: 70 }, home: { ...STL, r: 2, w: 88, l: 74 }, ...extra });
const LIVE = bbGame({ st: 'live', inn: 7, half: 'T', b: 2, s: 1, o: 2, on: [1, 0, 1] });
const bb = (...games) => ({ ...payload([]), screen: 'baseball', mlb: { games } });
const AMBER = draw.C.amber;

test('baseball live: team blocks, white scores, infield bases by runner, divider', () => {
  const f = draw.renderBaseball(bb(LIVE));
  assert.equal(count(f, CHC.c, 1, 2, 3, 7), 18);           // 3x6 away block
  assert.equal(count(f, STL.c, 1, 12, 3, 17), 18);         // 3x6 home block
  assert.ok(count(f, draw.BB.live, 22, 2, 30, 8) > 0);     // away score right-aligned to x30
  assert.equal(count(f, draw.BB.live, 31, 2, 40, 18), 0);
  assert.equal(count(f, draw.C.divider, 0, 22, 63, 22), 64);
  // 1st (56,7) and 3rd (46,7) occupied: amber 5x5 diamonds (13 px); 2nd empty: dark grey.
  assert.equal(count(f, AMBER, 54, 5, 58, 9), 13);
  assert.equal(count(f, AMBER, 44, 5, 48, 9), 13);
  assert.equal(count(f, draw.BB.base, 49, 0, 53, 4), 13);
  assert.ok(count(f, draw.BB.infield, 40, 0, 62, 13) > 0);
  // Inning on rows 15-19; count and outs on the bottom line.
  assert.ok(count(f, draw.C.label, 38, 15, 63, 19) > 0);
  assert.ok(count(f, draw.C.grey, 40, 25, 62, 31) > 0);
});

test('baseball final: winner name and score amber, loser score darkened, FINAL bottom right', () => {
  const f = draw.renderBaseball(bb(bbGame({ st: 'final' })));
  assert.ok(count(f, AMBER, 6, 2, 20, 8) > 0);             // CHC name
  assert.ok(count(f, AMBER, 22, 2, 30, 8) > 0);            // CHC score
  assert.equal(count(f, AMBER, 0, 12, 63, 31), 0);         // nothing else amber
  assert.ok(count(f, draw.BB.lose, 22, 12, 30, 18) > 0);   // STL score
  assert.ok(count(f, draw.C.label, 6, 12, 20, 18) > 0);    // STL name stays white
  assert.ok(count(f, draw.C.label, 40, 25, 62, 31) > 0);   // FINAL
});

test('baseball pregame: records by the names, first pitch bottom right, no scores or infield', () => {
  const f = draw.renderBaseball(bb(bbGame({ st: 'pre', start: NOW + 1500, away: { ...CHC, r: 0, w: 109, l: 53 } })));
  assert.ok(count(f, draw.C.grey, 22, 3, 50, 7) > 0);      // 109-53 after CHC
  assert.equal(count(f, draw.BB.base, 38, 0, 63, 20), 0);
  assert.equal(count(f, draw.BB.live, 0, 0, 63, 31), 0);
  assert.ok(count(f, draw.C.label, 40, 25, 62, 31) > 0);   // time
  assert.ok(count(f, draw.C.grey, 50, 25, 62, 31) > 0);    // AM/PM
});

test('baseball rotates games one minute each; no games shows the clock', () => {
  const other = bbGame({ id: 2, st: 'live', inn: 1, half: 'B', b: 0, s: 0, o: 0, on: [0, 0, 0], away: { ab: 'NYY', c: '#3a5fa8', r: 0 }, home: { ab: 'BOS', c: '#c8323d', r: 0 } });
  const p = bb(LIVE, other);
  const t0 = Math.floor(NOW / 120) * 120; // a minute where game 0 is up
  assert.equal(draw.pickGame(p.mlb.games, t0).i, 0);
  assert.equal(draw.pickGame(p.mlb.games, t0 + 60).i, 1);
  assert.equal(count(draw.renderBaseball(p, { now: t0 }), CHC.c, 1, 2, 3, 7), 18);
  assert.equal(count(draw.renderBaseball(p, { now: t0 + 60 }), '#3a5fa8', 1, 2, 3, 7), 18);
  assert.ok(count(draw.renderBaseball(bb()), draw.C.clock, 0, 0, 63, 31) > 0);
});

test('baseball score roll: a finished roll equals a static frame', () => {
  const still = draw.renderBaseball(bb(LIVE));
  const done = draw.renderBaseball(bb(LIVE), { rolls: { away: { from: '2', p: 1 } } });
  assert.deepEqual(done.px, still.px);
  const mid = draw.renderBaseball(bb(LIVE), { rolls: { away: { from: '2', p: 0.5 } } });
  assert.notDeepEqual(mid.px, still.px);
  assert.equal(count(mid, draw.BB.live, 0, 9, 63, 11), 0); // clipped to the score's rows
});

test('radar visits interrupt baseball like transit; forced screens are left alone', () => {
  const { autoScreen } = require('./draw');
  const radar = { on: true, frames: [], ft: [], visit: { every: 240, for: 60 } };
  const t = Math.floor(NOW / 240) * 240;
  assert.equal(autoScreen({ screen: 'baseball', radar }, t + 10), 'radar');
  assert.equal(autoScreen({ screen: 'baseball', radar }, t + 100), 'baseball');
  assert.equal(autoScreen({ screen: 'baseball', radar: { ...radar, on: false } }, t + 10), 'baseball');
  assert.equal(autoScreen({ screen: 'ticker', radar }, t + 10), 'ticker');
});

test('baseball: a live game takes precedence; pregame and finals rotate only when nothing is live', () => {
  const pre = bbGame({ id: 3, st: 'pre', start: NOW + 900 });
  const fin = bbGame({ id: 4, st: 'final' });
  const t0 = Math.floor(NOW / 180) * 180;
  for (let k = 0; k < 6; k++) {
    const pick = draw.pickGame([pre, LIVE, fin], t0 + k * 60);
    assert.deepEqual([pick.i, pick.of], [1, 1]); // always the live game
  }
  const seen = new Set([0, 1, 2].map((k) => draw.pickGame([pre, fin], t0 + k * 60).i));
  assert.deepEqual([...seen].sort(), [0, 1]);
  const live2 = { ...LIVE, id: 5 };
  assert.deepEqual([0, 1].map((k) => draw.pickGame([pre, LIVE, fin, live2], t0 + k * 60).i).sort(), [1, 3]);
});

test('baseball live: inning, count, and outs roll; TOP -> BOT rolls only the changed letters', () => {
  const next = { ...LIVE, half: 'B', b: 0, s: 0, o: 0 };
  const still = draw.renderBaseball(bb(next));
  const rolls = { inn: { from: 'TOP 7', p: 1 }, count: { from: '2-1', p: 1 }, outs: { from: '2 OUT', p: 1 } };
  assert.deepEqual(draw.renderBaseball(bb(next), { rolls }).px, still.px);
  const half = { inn: { from: 'TOP 7', p: 0.5 }, count: { from: '2-1', p: 0.5 }, outs: { from: '2 OUT', p: 0.5 } };
  const mid = draw.renderBaseball(bb(next), { rolls: half });
  assert.notDeepEqual(mid.px, still.px);
  // The 'O' and ' 7' of the inning don't move: compare those columns.
  const innLeft = 51 - Math.floor(draw.measure('small', 'BOT 7') / 2);
  const col = (f, x) => [15, 16, 17, 18, 19].map((y) => hex(f.get(x, y))).join();
  const m = (str) => draw.measure('small', str);
  const oLeft = innLeft + m('B') + 1, sevenLeft = innLeft + m('BOT ') + 1;
  const steady = [...Array(m('O')).keys()].map((i) => oLeft + i).concat([...Array(m('7')).keys()].map((i) => sevenLeft + i));
  for (const x of steady) assert.equal(col(mid, x), col(still, x));
  assert.ok([...Array(m('B')).keys()].some((i) => col(mid, innLeft + i) !== col(still, innLeft + i)));
  // Rolls stay inside their own rows.
  assert.equal(count(mid, draw.C.label, 38, 13, 63, 14), 0);
  assert.equal(count(mid, draw.C.label, 0, 23, 63, 24), 0);
});

test('baseballTexts: scores always, live status only while live; key changes with game or state', () => {
  const t = draw.baseballTexts(bb(LIVE), NOW);
  assert.deepEqual(t, { key: '1:live', texts: { away: '3', home: '2', inn: 'TOP 7', count: '2-1', outs: '2 OUT' } });
  assert.deepEqual(draw.baseballTexts(bb(bbGame({ st: 'final' })), NOW), { key: '1:final', texts: { away: '3', home: '2' } });
  assert.equal(draw.baseballTexts(bb(), NOW), null);
});

test('baseball breaks: MID 4 / END 5, empty bases, no count or outs', () => {
  for (const [half, inn, text] of [['M', 4, 'MID 4'], ['E', 5, 'END 5']]) {
    const g = { ...LIVE, half, inn, b: 0, s: 0, o: 0, on: [0, 0, 0] };
    assert.equal(draw.baseballTexts(bb(g), NOW).texts.inn, text);
    const f = draw.renderBaseball(bb(g));
    assert.ok(count(f, draw.C.label, 38, 15, 63, 19) > 0);
    assert.equal(count(f, draw.C.label, 0, 25, 63, 31) + count(f, draw.C.grey, 0, 25, 63, 31), 0); // bottom line empty
    assert.equal(count(f, AMBER, 38, 0, 63, 12), 0);
  }
});

test('baseball: bottom line and divider sit where the transit weather row does', () => {
  const rows = (f, x0, x1) => { const ys = []; for (let y = 23; y < 32; y++) for (let x = x0; x <= x1; x++) if (f.get(x, y) && hex(f.get(x, y)) !== '#000000') { ys.push(y); break; } return ys; };
  const g = draw.renderBaseball(bb(bbGame({ st: 'final' })));
  const w = draw.renderTransit({ ...payload([]), screen: 'transit', wx: { temp: 61, icon: 'sun', word: 'CLEAR' } });
  assert.equal(count(g, draw.C.divider, 0, 22, 63, 22), 64);
  assert.equal(count(w, draw.C.divider, 0, 22, 63, 22), 64);
  assert.equal(Math.max(...rows(g, 40, 62)), Math.max(...rows(w, 40, 62)));
});

test('baseball score flash: amber for a minute after a change, fades to white, then plain', () => {
  const at = NOW - 10;
  const side = { ...CHC, r: 4, at };
  const hold = draw.SCORE_HOLD_S, fade = draw.SCORE_FADE_S;
  assert.equal(draw.scoreColor(side, at + 5), AMBER);
  assert.equal(draw.scoreColor(side, at + hold - 1), AMBER);
  const mid = draw.scoreColor(side, at + hold + fade / 2);
  assert.notEqual(mid, AMBER); assert.notEqual(mid, draw.BB.live);
  assert.equal(draw.scoreColor(side, at + hold + fade), draw.BB.live);
  assert.equal(draw.scoreColor({ ...CHC, r: 4 }, NOW), draw.BB.live);
  const flash = bb({ ...LIVE, away: { ...LIVE.away, at }, home: { ...LIVE.home } });
  const f = draw.renderBaseball(flash, { now: NOW });
  assert.ok(count(f, AMBER, 22, 2, 30, 8) > 0);              // changed score amber
  assert.equal(count(f, AMBER, 22, 12, 30, 18), 0);          // other score white
  assert.ok(count(f, draw.BB.live, 22, 12, 30, 18) > 0);
});

test('radar time off: no time or AM/PM; indicator stays; warning icon at the top right of the time area', () => {
  const now = Date.UTC(2026, 9, 4, 16, 46) / 1000;
  const radar = { on: true, frames: ['a', 'b', 'c'], ft: [now - 600, now - 300, now], clock: [40, 0, 24, 32], split: false };
  const base = { now, bright: 100, warn: null };
  const off = (warn) => draw.render({ ...base, warn, radar: { ...radar, showTime: false } }, { screen: 'radar', now, frames: {} });
  const f = off(null);
  assert.equal(count(f, draw.C.radarTime, 0, 0, 63, 31), 0);
  assert.equal(count(f, draw.C.radarAmpm, 0, 0, 63, 31), 0);
  assert.equal(hex(f.get(62, 2)), draw.C.amber);                 // indicator unchanged
  const w = off({ kind: 'tor', lvl: 'warning' });
  assert.ok(count(w, draw.C.warnTornado, 56, 6, 62, 10) > 3);    // icon right-aligned, under the indicator
  assert.equal(count(w, draw.C.warnTornado, 0, 11, 63, 31), 0);  // nothing lower
  assert.equal(hex(w.get(62, 2)), draw.C.amber);
  // On (default and explicit) is unchanged.
  const on = draw.render({ ...base, radar }, { screen: 'radar', now, frames: {} });
  const on2 = draw.render({ ...base, radar: { ...radar, showTime: true } }, { screen: 'radar', now, frames: {} });
  assert.deepEqual(on.px, on2.px);
  assert.ok(count(on, draw.C.radarTime, 40, 6, 63, 14) > 15);
});
