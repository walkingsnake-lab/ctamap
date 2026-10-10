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

test('liveRows holds a train past its drop time until a payload made after that moment', () => {
  const rows = [{ ln: 'RD', lbl: 'HOWARD', t: [NOW - 45, NOW - 55, NOW + 300], s: [0, 0, 0], a: 0 }];
  // A 20 s old payload predates NOW-45's drop time (NOW-15): the server may
  // have pushed its time later since, so it stays. NOW-55's drop time
  // (NOW-25) came before the payload, which settles it: dropped.
  assert.deepEqual(liveRows({ ...payload(rows), now: NOW - 20 }, NOW)[0].t, [NOW - 45, NOW + 300]);
  // A payload made after their drop times (it would no longer list them): dropped.
  assert.deepEqual(liveRows({ ...payload(rows), now: NOW }, NOW)[0].t, [NOW + 300]);
  // With no fresh payload at all, held at most HOLD_MAX past the grace.
  const old = [{ ln: 'RD', lbl: 'HOWARD', t: [NOW - 89, NOW - 91, NOW + 300], s: [0, 0, 0], a: 0 }];
  assert.deepEqual(liveRows({ ...payload(old), now: NOW - 100 }, NOW)[0].t, [NOW - 89, NOW + 300]);
  assert.equal(require('./draw').HOLD_MAX, 60);
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
  // Later steps carry a payload made at that time: the board drops a
  // departed train only on a payload made after its drop moment.
  // Times chosen so the 7 and 16 don't tick over during the 55 s below.
  const p = payload([{ ln: 'RD', lbl: 'HOWARD', t: [NOW + 20, NOW + 7 * 60 + 58, NOW + 16 * 60 + 58], s: [0, 0, 0], a: 0 }]);
  const anim = draw.createTransitAnimator();
  const first = anim.step(p, NOW, 0);
  const [due, seven, sixteen] = first.rows[0].cells;
  assert.equal(due.text, 'DUE');
  // 55 s later the DUE train is gone from the live list (30 s grace).
  const t = 1000;
  const v = anim.step({ ...p, now: NOW + 55 }, NOW + 55, t);
  const cells = v.rows[0].cells;
  const leaving = cells.find((c) => c.id === due.id);
  assert.ok(leaving && leaving.alpha === 1 && leaving.text === 'DUE', 'starts fading from full');
  const mid = anim.step({ ...p, now: NOW + 55 }, NOW + 55, t + draw.FADE_MS / 2).rows[0].cells;
  const half = mid.find((c) => c.id === due.id);
  assert.ok(half.alpha > 0 && half.alpha < 1);
  // The remaining times keep their identity and position: no roll, no jump.
  const next = mid.find((c) => c.id === seven.id);
  assert.equal(next.roll, null);
  assert.equal(next.right, seven.right);
  assert.notEqual(next.color, draw.C.amber);        // still easing toward amber
  assert.notEqual(next.color, draw.C.dimAmber);
  const done = anim.step({ ...p, now: NOW + 55 }, NOW + 55, t + draw.FADE_MS + 10).rows[0].cells;
  assert.ok(!done.some((c) => c.id === due.id));
  assert.equal(done.find((c) => c.id === seven.id).color, draw.C.amber);
  assert.ok(done.some((c) => c.id === sixteen.id));
});

test('animator: bunched trains: the departing DUE fades and the next one rolls to DUE in its own place', () => {
  // Later steps carry a payload made at that time: the board drops a
  // departed train only on a payload made after its drop moment.
  const p = payload([{ ln: 'RD', lbl: 'HOWARD', t: [NOW + 20, NOW + 80, NOW + 400], s: [0, 0, 0], a: 0 }]);
  const anim = draw.createTransitAnimator();
  const [due, second, third] = anim.step(p, NOW, 0).rows[0].cells;
  assert.deepEqual([due.text, second.text], ['DUE', '2']);
  anim.step({ ...p, now: NOW + 51 }, NOW + 51, 1000);
  const cells = anim.step({ ...p, now: NOW + 51 }, NOW + 51, 1000 + draw.FADE_MS / 2).rows[0].cells;
  const byId = (c) => cells.find((x) => x.id === c.id);
  assert.ok(byId(due).alpha < 1, 'the departed train fades');
  assert.equal(byId(due).text, 'DUE');
  assert.deepEqual([byId(second).text, byId(second).alpha, byId(second).roll.from], ['DUE', 1, '2']);
  assert.equal(byId(third).alpha, 1);
});

test('animator: a delay on bunched trains keeps every identity', () => {
  const anim = draw.createTransitAnimator();
  const at = (d) => payload([{ ln: 'RD', lbl: 'HOWARD', t: [NOW + 200 + d, NOW + 260 + d, NOW + 600 + d], s: [0, 0, 0], a: 0 }]);
  const a = anim.step(at(0), NOW, 0).rows[0].cells;
  const b = anim.step(at(40), NOW, 100).rows[0].cells;
  assert.deepEqual(b.map((c) => c.id), a.map((c) => c.id));
  assert.ok(b.every((c) => c.alpha === 1));
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
  assert.ok(draw.timing({}).pageHold >= 8000);
  assert.ok(draw.timing({}).slide >= 1000);
});

test('speed settings come from the payload, with defaults for anything missing', () => {
  assert.deepEqual(draw.timing({}), { pageHold: 8000, slide: 1200, radarFrame: 500, radarHold: 4000, game: 60 });
  assert.deepEqual(draw.timing({ anim: { pageHold: 5000, game: 30 } }), { pageHold: 5000, slide: 1200, radarFrame: 500, radarHold: 4000, game: 30 });
  // Baseball rotation follows `game`.
  const g = (id) => ({ id, st: 'pre', start: 0, away: {}, home: {} });
  const games = [g(1), g(2)];
  assert.deepEqual([0, 30, 60, 90].map((s) => draw.pickGame(games, 1_800_000_000 + s, 30).i), [0, 1, 0, 1]);
  assert.deepEqual([0, 30, 60, 90].map((s) => draw.pickGame(games, 1_800_000_000 + s).i), [0, 0, 1, 1]);
});

test('ticker row fill follows tickerFill (percent of the line color)', () => {
  const p = payload([], [{ ln: 'RD', d: 'Howard', t: NOW + 300, s: 0, a: 0 }]);
  const at = (fill) => hex(draw.render({ ...p, tickerFill: fill }, { screen: 'ticker' }).get(60, 8));
  const red = [0xc6, 0x0c, 0x30];
  const scaled = (k) => '#' + red.map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('');
  assert.equal(at(undefined), scaled(0.55));
  assert.equal(at(30), scaled(0.3));
  assert.equal(at(80), scaled(0.8));
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
  // Later steps carry a payload made at that time: the board drops a
  // departed train only on a payload made after its drop moment.
  const rows = [chronoRow('RD', 'HOWARD', NOW + 10, '801'), ...[4, 7, 9, 12].map((m, i) => chronoRow('BR', 'LOOP', min(m), String(400 + i)))];
  const p = chronoPayload(rows);
  const tops = draw.rowTops(4, true, false);
  const pitch = tops[1] - tops[0];
  const anim = draw.createTransitAnimator();
  const v0 = anim.step(p, NOW, 0);
  assert.deepEqual(v0.rows.map((r) => r.key), ['rn:801', 'rn:400', 'rn:401', 'rn:402']);
  // 45 s later the first train is past the 30 s grace.
  const t = 1000;
  anim.step({ ...p, now: NOW + 45 }, NOW + 45, t);
  const mid = anim.step({ ...p, now: NOW + 45 }, NOW + 45, t + draw.MOVE_MS / 2);
  const by = (v, k) => v.rows.find((r) => r.key === k);
  const gone = by(mid, 'rn:801');
  assert.ok(gone.top < tops[0] && gone.top > tops[0] - pitch, 'departing row moves up');
  assert.ok(gone.alpha < 1 && gone.alpha > 0);
  assert.ok(by(mid, 'rn:400').top < tops[1] && by(mid, 'rn:400').top > tops[0], 'list slides at the same time');
  const incoming = by(mid, 'rn:403');
  assert.ok(incoming.top > tops[3] && incoming.alpha < 1, 'next train comes in from below');
  const end = anim.step({ ...p, now: NOW + 45 }, NOW + 45, t + draw.FADE_MS + 10);
  assert.deepEqual(end.rows.map((r) => r.key), ['rn:400', 'rn:401', 'rn:402', 'rn:403']);
  assert.deepEqual(end.rows.map((r) => r.top), tops);
  assert.equal(by(end, 'rn:400').cells[0].color, draw.C.amber);
  assert.deepEqual(draw.renderTransit({ ...p, now: NOW + 45 }, { now: NOW + 45, view: end }).px, draw.renderTransit({ ...p, now: NOW + 45 }, { now: NOW + 45 }).px);
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

test('chrono: rows are drawn in time order however the payload lists them', () => {
  // Seen on the board: a DUE train listed below a 5m one.
  const rows = [chronoRow('BR', 'KIMBALL', NOW + 20, '401'), chronoRow('PK', '54/CRMK', min(5), '305'),
    chronoRow('GR', 'HARLEM', NOW + 40, '002'), chronoRow('GR', '63RD', min(5) + 2, '013')];
  const v = draw.buildTransitView(chronoPayload(rows), NOW);
  assert.deepEqual(v.rows.map((r) => r.lbl), ['KIMBALL', 'HARLEM', '54/CRMK', '63RD']);
  assert.deepEqual(v.rows.map((r) => r.cells[0].text), ['DUE', 'DUE', '5m', '5m']);
  assert.deepEqual(v.rows.map((r) => r.num), [1, 2, 3, 4]);
});

test('chrono: every row has its own animator key, even when a run number repeats', () => {
  // A run listed twice (e.g. this trip and the next), and odd numbers like
  // 1000 shared by two trains.
  const rows = [chronoRow('BR', 'KIMBALL', min(2), '1000'), chronoRow('PK', '54/CRMK', min(3), '1000'), chronoRow('BR', 'KIMBALL', min(9), '1225')];
  rows.push(chronoRow('BR', 'KIMBALL', min(14), '1225'));
  const v = draw.buildTransitView(chronoPayload(rows), NOW);
  assert.equal(new Set(v.rows.map((r) => r.key)).size, 4);
  // ...so the animator keeps four rows, each at its own place.
  const anim = draw.createTransitAnimator();
  const shown = anim.step(chronoPayload(rows), NOW, 0);
  assert.equal(shown.rows.length, 4);
  assert.deepEqual(shown.rows.map((r) => r.top).sort((a, b) => a - b), draw.rowTops(4, true, false));
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

test('radar loop: holds on the newest on hand until the set is complete; conditions until the first lands', () => {
  const tm = { radarFrame: 1000, radarHold: 2000 };
  const ids = ['a', 'b', 'c', 'd'];
  const have = (...k) => Object.fromEntries(k.map((id) => [id, new Uint8Array(2048)]));
  assert.equal(draw.radarLoopIdx(ids, {}, 0, tm), -1);
  // Filling in (newest first): a still frame, never stepping back in time.
  for (const on of [have('d'), have('c', 'd'), have('b', 'c', 'd')]) {
    assert.deepEqual(new Set([0, 1000, 2000, 3000, 4500].map((t) => draw.radarLoopIdx(ids, on, t, tm))), new Set([3]));
  }
  // A new newest still downloading: hold on the newest on hand.
  assert.deepEqual(new Set([0, 1000, 2500].map((t) => draw.radarLoopIdx(ids, have('a', 'b', 'c'), t, tm))), new Set([2]));
  // Complete: the loop plays.
  assert.deepEqual([0, 1000, 2000, 3000, 4999, 5000].map((t) => draw.radarLoopIdx(ids, have('a', 'b', 'c', 'd'), t, tm)), [0, 1, 2, 3, 3, 0]);
  const t = Date.UTC(2020, 7, 10, 21, 0) / 1000;
  const wx = { temp: 60, icon: 'rain', word: 'RAIN' };
  const p = { now: t, bright: 100, warn: null, radar: { on: true, frames: ids, ft: [t, t, t, t], timeBox: [40, 0, 24, 22], split: false, wx } };
  const screen = draw.render({ ...p, radar: { on: false, frames: [], ft: [], timeBox: null, split: false, wx } }, { screen: 'weather', now: t });
  assert.deepEqual(draw.render(p, { screen: 'weather', now: t, idx: -1, frames: {} }).px, screen.px, 'none on hand: the conditions screen');
  assert.notDeepEqual(draw.render(p, { screen: 'weather', now: t, idx: 3, frames: have('d') }).px, screen.px);
});

test('radar brightness: greens trimmed; rb scales precip, not the shoreline or marker', () => {
  assert.equal(draw.RADAR[2], '#156615');   // #2ee02e at 65% x 70% (was #1e921e)
  assert.equal(draw.RADAR[5], '#a61111');   // reds and yellows at 65%
  assert.equal(draw.RADAR[3], '#a69200');
  const half = draw.radarColors(50);
  assert.equal(half[5], '#530808');
  assert.deepEqual([half[6], half[7]], [draw.RADAR[6], draw.RADAR[7]]);
  const bytes = new Uint8Array(2048);
  bytes[0] = 2; bytes[1] = 5; bytes[2] = 6;
  const t = Date.UTC(2020, 7, 10, 21, 0) / 1000;
  const at = (rb) => draw.render({ now: t, bright: 100, warn: null, radar: { on: true, frames: ['a'], ft: [t], timeBox: [40, 0, 24, 32], split: true, ...(rb ? { rb } : {}) } }, { screen: 'weather', frames: { a: bytes }, idx: 0 });
  assert.deepEqual([0, 1, 2].map((x) => hex(at(50).get(x, 0))), [half[2], half[5], draw.RADAR[6]]);
  assert.deepEqual([0, 1, 2].map((x) => hex(at().get(x, 0))), [draw.RADAR[2], draw.RADAR[5], draw.RADAR[6]]);
});

test('radar: palette, marker, frame indicator, clock and AM/PM, warning icon', () => {
  const bytes = new Uint8Array(2048);
  bytes[0] = 1; bytes[1] = 5; bytes[2] = 8; bytes[16 * 64 + 20] = 7;
  const t = Date.UTC(2020, 7, 10, 21, 0) / 1000; // 4:00 PM CDT
  const ids = ['a', 'b', 'c'];
  const p = { now: t, bright: 100, warn: { kind: 'svr', lvl: 'warning' }, radar: { on: true, frames: ids, ft: [t - 600, t - 300, t], timeBox: [40, 0, 24, 32], split: true } };
  const f = draw.render(p, { screen: 'weather', frames: { a: bytes, b: bytes, c: bytes }, idx: 2 });
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
  const full = draw.render({ ...p, radar: { ...p.radar, timeBox: [40, 0, 24, 22], split: false } }, { screen: 'weather', frames: {}, idx: 2 });
  assert.deepEqual(full.get(39, 25), [0, 0, 0], 'no line in the full-width layout');
  // A frame not fetched yet draws as empty radar with the stack.
  const empty = draw.render(p, { screen: 'weather', frames: {}, idx: 0 });
  assert.equal(count(empty, draw.RADAR[1], 0, 0, 39, 31), 0);
  assert.equal(hex(empty.get(56, 2)), draw.C.amber);
});

test('radar with no frames yet draws the clock at the current time (no crash)', () => {
  const now = Date.UTC(2026, 9, 4, 16, 46) / 1000;
  for (const radar of [{ on: false, frames: [], ft: [], timeBox: null, split: false }, { on: false, frames: [], ft: [], timeBox: [40, 0, 24, 32], split: true }, undefined]) {
    for (const idx of [undefined, -1, 0, 3]) {
      const f = draw.render({ now, bright: 100, warn: null, radar }, { screen: 'weather', now, idx, frames: {} });
      assert.ok(count(f, draw.C.radarTime, 40, 0, 63, 31) > 15, 'clock drawn');
    }
  }
});

test('weather screen: radar screen with no frames shows big temp, details, and rain chance', () => {
  const now = Date.UTC(2026, 9, 4, 16, 48) / 1000;
  const wx = { icon: 'pcloudy_day', temp: 57, word: 'PT CLOUDY', hi: 63, lo: 49, feels: 53, wind: 'NW 12', pop: 20 };
  const rad = (w, extra = {}) => ({ on: false, frames: [], ft: [], timeBox: [40, 0, 24, 22], split: false, wx: w, ...extra });
  const f = draw.render({ now, bright: 100, warn: null, radar: rad(wx) }, { screen: 'weather', now, frames: {} });
  assert.ok(count(f, draw.C.label, 1, 4, 22, 13) > 40, 'big temperature + degree ring');
  assert.equal(hex(f.get(56, 2)), '#ffc800', 'icon top right');
  assert.ok(count(f, draw.C.wxText, 29, 11, 63, 15) > 15, 'dim condition word');
  for (let x = 0; x < 64; x++) assert.equal(hex(f.get(x, 18)), draw.C.divider, `divider col ${x}`);
  assert.ok(count(f, draw.C.grey, 0, 20, 40, 24) > 15, 'FEELS');
  assert.ok(count(f, draw.C.label, 40, 20, 63, 24) > 10, 'wind');
  assert.ok(count(f, draw.C.grey, 0, 26, 45, 30) > 15, 'high/low');
  assert.equal(count(f, '#1e90ff', 45, 27, 52, 30), 8, 'drop');
  assert.equal(count(f, draw.C.radarTime, 0, 0, 63, 31), 0, 'no radar clock');
  // Missing extras leave their spots empty.
  const bare = draw.render({ now, bright: 100, warn: null, radar: rad({ ...wx, feels: null, wind: null, pop: null }) }, { screen: 'weather', now, frames: {} });
  assert.equal(count(bare, draw.C.grey, 0, 20, 63, 24) + count(bare, draw.C.label, 0, 20, 63, 24), 0);
  assert.equal(count(bare, '#1e90ff', 0, 19, 63, 31), 0);
  // Frames (rain in the box) bring the radar back.
  const withFrames = draw.render({ now, bright: 100, warn: null, radar: rad(wx, { on: true, frames: ['a'], ft: [now] }) }, { screen: 'weather', now, frames: { a: new Uint8Array(2048) } });
  assert.equal(count(withFrames, draw.C.divider, 0, 18, 63, 18), 0);
  assert.ok(count(withFrames, draw.C.radarTime, 40, 6, 63, 12) > 15, 'radar clock');
});

test('weather screen: a watch or warning replaces the high/low line; tornado warning blinks', () => {
  const now = Date.UTC(2026, 9, 4, 16, 48) / 1000;
  const wx = { icon: 'storm', temp: 57, word: 'STORMS', hi: 63, lo: 49, feels: 53, wind: 'NW 12', pop: 90 };
  const rad = { on: false, frames: [], ft: [], timeBox: [40, 0, 24, 22], split: false, wx };
  const cases = [['svr', 'watch', draw.C.watch], ['svr', 'warning', draw.C.warnSevere], ['tor', 'watch', draw.C.watch], ['tor', 'warning', draw.C.warnTornado]];
  for (const [kind, lvl, color] of cases) {
    const f = draw.render({ now, bright: 100, warn: { kind, lvl }, radar: rad }, { screen: 'weather', now, frames: {} });
    assert.ok(count(f, color, 0, 26, 63, 30) > 30, `${kind} ${lvl} tag`);
    assert.equal(count(f, draw.C.grey, 0, 26, 63, 30), 0, `${kind} ${lvl}: no high/low`);
    assert.equal(count(f, '#1e90ff', 0, 26, 63, 31), 0, `${kind} ${lvl}: no rain chance`);
    for (let y = 26; y <= 30; y++) assert.deepEqual(f.get(63, y), [0, 0, 0], 'fits the panel');
    const off = draw.render({ now, bright: 100, warn: { kind, lvl }, radar: rad }, { screen: 'weather', now, frames: {}, blink: true });
    assert.equal(count(off, color, 0, 26, 63, 30) > 0, !(kind === 'tor' && lvl === 'warning'), `${kind} ${lvl} blink`);
  }
});

test('weather screen extremes: minus bar, 3-digit temp drops the word, high/low drops degrees to fit', () => {
  const now = Date.UTC(2026, 9, 4, 16, 48) / 1000;
  const rad = (wx) => ({ on: false, frames: [], ft: [], timeBox: [40, 0, 24, 22], split: false, wx });
  const cold = draw.render({ now, bright: 100, warn: null, radar: rad({ icon: 'snow', temp: -12, word: 'SNOW', hi: -3, lo: -21, feels: -31, wind: 'NW 22', pop: 100 }) }, { screen: 'weather', now, frames: {} });
  assert.equal(count(cold, draw.C.label, 0, 8, 4, 9), 10, 'minus bar at the left edge');
  assert.equal(count(cold, draw.C.label, 0, 4, 4, 7) + count(cold, draw.C.label, 0, 10, 4, 13), 0);
  const hot = draw.render({ now, bright: 100, warn: null, radar: rad({ icon: 'sun', temp: 101, word: 'PT CLOUDY', hi: 103, lo: 82, feels: 112, wind: 'CALM', pop: 0 }) }, { screen: 'weather', now, frames: {} });
  assert.equal(count(hot, draw.C.wxText, 0, 11, 63, 15), 0, 'word skipped');
  // -21° low with 100%: degree signs dropped, 3px clear of the drop.
  let lastGrey = -1;
  for (let x = 0; x < 64; x++) for (let y = 26; y <= 30; y++) if (hex(cold.get(x, y)) === draw.C.grey) lastGrey = x;
  let firstBlue = 64;
  for (let x = 63; x >= 0; x--) for (let y = 26; y <= 31; y++) if (hex(cold.get(x, y)) === '#1e90ff') firstBlue = x;
  assert.ok(firstBlue - lastGrey >= 3, `gap ${firstBlue - lastGrey}`);
});

test('weather 5-day: today on top, five day columns between dividers; a warning falls back to conditions', () => {
  const now = Date.UTC(2026, 9, 9, 16, 48) / 1000;
  const days = (list) => list.map(([d, hi, icon]) => ({ d, hi, icon }));
  const wx = { icon: 'pcloudy_day', temp: 57, word: 'PT CLOUDY', hi: 63, lo: 49, feels: 53, wind: 'NW 12', pop: 20,
    days: days([['SA', 71, 'sun'], ['SU', 78, 'sun'], ['MO', 66, 'rain'], ['TU', 52, 'cloudy'], ['WE', 60, 'pcloudy_day']]) };
  const rad = (w) => ({ on: false, frames: [], ft: [], timeBox: [40, 0, 24, 22], split: false, wx: w });
  const f = draw.render({ now, bright: 100, warn: null, radar: rad(wx) }, { screen: 'weather', now, frames: {} });
  assert.equal(hex(f.get(2, 1)), '#ffc800', 'icon at x1');
  for (let y = 0; y < 8; y++) assert.deepEqual(f.get(0, y), [0, 0, 0], `col 0 clear, row ${y}`);
  assert.ok(count(f, draw.C.label, 11, 0, 31, 7) > 20, 'current temperature in label white at x11');
  assert.equal(count(f, draw.C.label, 0, 0, 10, 7), 0, 'nothing white over the icon');
  // Its shadow: 1px down-right, 20% of the temperature color, only where the
  // white doesn't cover it (57 is green-ish).
  const shadow = [];
  for (let y = 0; y <= 8; y++) for (let x = 11; x <= 31; x++) { const c = f.get(x, y); if (c.some((v) => v) && hex(c) !== draw.C.label) shadow.push(c); }
  assert.ok(shadow.length > 5, 'shadow pixels');
  for (const c of shadow) assert.ok(c[1] > c[0] && Math.max(...c) < 60, `dim green shadow ${c}`);
  assert.ok(count(f, '#000000', 11, 7, 31, 7) < 21, 'shadow on row 7, under the digits');
  assert.equal(count(f, '#000000', 0, 8, 63, 8), 64, 'row 8 clear');
  assert.ok(count(f, draw.C.grey, 34, 1, 63, 5) > 15, 'high/low numbers grey');
  assert.equal(count(f, '#4a4a4a', 30, 1, 63, 5), 18, 'two dim arrows');
  // A long high/low next to a three-character temperature keeps 1px clear:
  // numbers condensed, then no space before the down arrow, then no arrows.
  const topGap = (w) => {
    const fr = draw.render({ now, bright: 100, warn: null, radar: rad({ ...wx, ...w }) }, { screen: 'weather', now, frames: {} });
    const t = draw.render({ now, bright: 100, warn: null, radar: rad({ ...wx, ...w, hi: null, lo: null }) }, { screen: 'weather', now, frames: {} });
    let tr = -1; for (let x = 10; x < 64; x++) for (let y = 0; y < 9; y++) if (t.get(x, y).some((v) => v)) tr = x;
    let hl = 64; for (let x = tr + 1; x < 64; x++) for (let y = 0; y < 8; y++) if (fr.get(x, y).some((v) => v)) hl = Math.min(hl, x);
    return [hl - tr - 1, count(fr, '#4a4a4a', 20, 0, 63, 7)];
  };
  for (const w of [{ temp: 100, hi: 104, lo: 82 }, { temp: -10, hi: -2, lo: -14 }, { temp: -15, hi: -10, lo: -24 }, { temp: 100, hi: 101, lo: 100 }, { temp: -15, hi: -100, lo: -100 }]) {
    const [gap] = topGap(w);
    assert.ok(gap >= 1, `${JSON.stringify(w)}: gap ${gap}`);
  }
  for (const w of [{ temp: 100, hi: 104, lo: 82 }, { temp: 100, hi: 101, lo: 100 }, { temp: -15, hi: -10, lo: -24 }, { temp: -20, hi: -11, lo: -28 }]) {
    assert.equal(topGap(w)[1], 18, `${JSON.stringify(w)}: arrows kept`);
  }
  assert.equal(topGap({ temp: -15, hi: -100, lo: -100 })[1], 0, 'arrows dropped last');
  // Condensed like the day highs: a 2px minus on row 4, '1' 3px wide.
  const cold = draw.render({ now, bright: 100, warn: null, radar: rad({ ...wx, temp: -12, hi: -1, lo: -10 }) }, { screen: 'weather', now, frames: {} });
  let bars = 0;
  for (let x = 30; x < 63; x++) if (hex(cold.get(x, 3)) === draw.C.grey && hex(cold.get(x + 1, 3)) === draw.C.grey && hex(cold.get(x + 2, 3)) !== draw.C.grey && hex(cold.get(x - 1, 3)) !== draw.C.grey) bars++;
  assert.ok(bars >= 2, `2px minus bars: ${bars}`);
  // Chevron heads: the up arrow's on its second row, the down arrow's on its fourth.
  const arrowRows = (x0, x1) => { const r = []; for (let y = 1; y <= 5; y++) r.push(count(f, '#4a4a4a', x0, y, x1, y)); return r; };
  const dimCols = []; for (let x = 30; x < 64; x++) if (count(f, '#4a4a4a', x, 1, x, 5)) dimCols.push(x);
  assert.deepEqual(arrowRows(dimCols[0], dimCols[0] + 4), [1, 3, 3, 1, 1], 'up arrow first');
  const down0 = dimCols.find((x) => x > dimCols[0] + 4);
  assert.deepEqual(arrowRows(down0, down0 + 4), [1, 1, 3, 3, 1], 'down arrow second');
  assert.ok(count(f, draw.C.grey, 60, 1, 62, 5) > 0, 'right-aligned to x62');
  for (let y = 0; y < 8; y++) assert.deepEqual(f.get(63, y), [0, 0, 0], `col 63 clear, row ${y}`);
  for (const x of [12, 25, 38, 51]) for (let y = 10; y <= 31; y++) assert.equal(hex(f.get(x, y)), draw.C.divider, `divider ${x},${y}`);
  assert.equal(count(f, draw.C.divider, 0, 0, 63, 9), 0, 'no horizontal rule');
  for (let i = 0; i < 5; i++) {
    const x0 = i * 13, x1 = x0 + 11;
    assert.ok(count(f, draw.C.grey, x0, 11, x1, 15) > 8, `day ${i} label`);
    assert.ok(count(f, '#000000', x0, 17, x1, 24) < 12 * 8, `day ${i} icon`);
  }
  // Highs in their temperature color: 52 green-ish, 78 orange-ish.
  const hiColor = (x0, x1) => { for (let x = x0; x <= x1; x++) for (let y = 26; y <= 30; y++) { const c = f.get(x, y); if (c.some((v) => v)) return c; } return null; };
  assert.ok(hiColor(39, 50)[1] > hiColor(39, 50)[0], 'TU 52 greener than red');
  assert.ok(hiColor(13, 24)[0] > hiColor(13, 24)[2], 'SU 78 warm');
  // No conditions-layout pieces.
  assert.equal(count(f, '#1e90ff', 0, 26, 63, 31), 0, 'no rain-chance drop');
  // Three-character highs keep a pixel clear of the dividers.
  const ext = draw.render({ now, bright: 100, warn: null, radar: rad({ ...wx, temp: -8, hi: 2, lo: -14,
    days: days([['SA', 104, 'sun'], ['SU', -12, 'sun'], ['MO', 100, 'snow'], ['TU', -14, 'snow'], ['WE', 111, 'sun']]) }) }, { screen: 'weather', now, frames: {} });
  for (const x of [11, 13, 24, 26, 37, 39, 50, 52]) for (let y = 26; y <= 30; y++) assert.deepEqual(ext.get(x, y), [0, 0, 0], `clear at ${x},${y}`);
  for (let y = 26; y <= 30; y++) assert.deepEqual(ext.get(63, y), [0, 0, 0], 'last column inside the panel');
  // Fewer days: only those columns.
  const three = draw.render({ now, bright: 100, warn: null, radar: rad({ ...wx, days: wx.days.slice(0, 3) }) }, { screen: 'weather', now, frames: {} });
  assert.equal(count(three, draw.C.grey, 39, 11, 63, 15), 0);
  // A warning: the conditions layout, which has room for it.
  const warned = draw.render({ now, bright: 100, warn: { kind: 'svr', lvl: 'warning' }, radar: rad(wx) }, { screen: 'weather', now, frames: {} });
  for (let x = 0; x < 64; x++) assert.equal(hex(warned.get(x, 18)), draw.C.divider);
  assert.ok(count(warned, draw.C.warnSevere, 0, 26, 63, 30) > 30);
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

test('chrono: position digit in the block\'s exact color, then the block', () => {
  const p = chronoPayload([chronoRow('RD', 'HOWARD', min(2), '1'), chronoRow('BR', 'KIMBALL', min(4), '2'), chronoRow('PR', 'LINDEN', min(6), '3')]);
  const f = draw.renderTransit(p);
  const tops = draw.rowTops(3, true, false);
  ['RD', 'BR', 'PR'].forEach((ln, i) => {
    const n = count(f, draw.LINE[ln], 0, tops[i], 2, tops[i] + 4);
    assert.ok(n >= 5 && n < 15, `${ln} digit ${i + 1}: ${n} px (a solid block would be 15)`);
    assert.equal(count(f, draw.LINE[ln], 4, tops[i], 6, tops[i] + 4), 15, '3x5 block after a 1px gap');
    assert.equal(count(f, draw.LINE[ln], 3, tops[i], 3, tops[i] + 4), 0, 'gap');
    assert.ok(count(f, draw.C.label, 9, tops[i], 9, tops[i] + 4) > 0, 'label at x9');
    assert.equal(count(f, draw.C.label, 7, tops[i], 8, tops[i] + 4), 0);
  });
  // Destination rows keep the solid blocks.
  const d = draw.renderTransit(payload([{ ln: 'BR', lbl: 'KIMBALL', t: [min(4)], s: [0], a: 0 }]));
  assert.equal(count(d, draw.LINE.BR, 0, 0, 2, 31), 15);
});

test('chrono: alert blinks the block to "!"; the digit stays', () => {
  const p = chronoPayload([{ ...chronoRow('GR', 'HARLEM', min(3), '1'), a: 1 }]);
  const top = draw.rowTops(1, true, false)[0];
  const on = draw.renderTransit(p, { blink: true });
  const off = draw.renderTransit(p, { blink: false });
  assert.equal(count(on, draw.LINE.GR, 4, top, 6, top + 4), 4);   // 3px stem + dot
  assert.equal(count(off, draw.LINE.GR, 4, top, 6, top + 4), 15);  // solid block
  assert.equal(count(on, draw.LINE.GR, 0, top, 2, top + 4), count(off, draw.LINE.GR, 0, top, 2, top + 4));
});

test('chrono animator: position digits roll down as the list slides up', () => {
  // Later steps carry a payload made at that time: the board drops a
  // departed train only on a payload made after its drop moment.
  const rows = [chronoRow('RD', 'HOWARD', NOW + 10, '801'), chronoRow('BR', 'LOOP', min(4), '400'), chronoRow('PR', 'LINDEN', min(7), '401')];
  const p = chronoPayload(rows);
  const anim = draw.createTransitAnimator();
  const v0 = anim.step(p, NOW, 0);
  assert.deepEqual(v0.rows.map((r) => r.num), [1, 2, 3]);
  anim.step({ ...p, now: NOW + 45 }, NOW + 45, 1000); // first train gone
  const mid = anim.step({ ...p, now: NOW + 45 }, NOW + 45, 1000 + draw.ROLL_MS / 2);
  const loop = mid.rows.find((r) => r.key === 'rn:400');
  assert.equal(loop.num, 1);
  assert.equal(loop.numRoll.from, '2');
  assert.ok(loop.numRoll.p > 0 && loop.numRoll.p < 1);
  const end = anim.step({ ...p, now: NOW + 45 }, NOW + 45, 1000 + draw.FADE_MS + 10);
  assert.deepEqual(end.rows.map((r) => [r.key, r.num, r.numRoll]), [['rn:400', 1, null], ['rn:401', 2, null]]);
  assert.deepEqual(draw.renderTransit({ ...p, now: NOW + 45 }, { now: NOW + 45, view: end }).px, draw.renderTransit({ ...p, now: NOW + 45 }, { now: NOW + 45 }).px);
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
  assert.equal(autoScreen(p(), at(3, 0)), 'weather');
  assert.equal(autoScreen(p(), at(3, 59.9)), 'weather');
  assert.equal(autoScreen(p(), at(3, 60)), 'transit');
  assert.equal(autoScreen(p(), at(3, 239)), 'transit');
  assert.equal(autoScreen(p(), at(4, 0)), 'weather');
  assert.equal(autoScreen(p({}, { on: false }), at(3, 0)), 'transit'); // no rain: no visit
  assert.equal(autoScreen(p({}, { visit: null }), at(3, 0)), 'transit'); // visits off
  assert.equal(autoScreen(p({ screen: 'ticker' }, { visit: null }), at(3, 0)), 'ticker'); // forced screens: the server sends no visit
  assert.equal(autoScreen(p({ screen: 'weather' }), at(3, 60)), 'weather'); // the weather screen stays
  assert.equal(autoScreen({ screen: 'transit' }, at(3, 0)), 'transit'); // old payloads
});

// Same table as firmware/tests/test_player.py (AutoScreenTable), so the
// board and the simulator agree.
const AUTO_CASES = [
  // [payload, seconds into the 240 s cycle, expected]
  [{ screen: 'transit', rot: { screens: ['transit', 'ticker'], every: 60 } }, 0, 'transit'],
  [{ screen: 'transit', rot: { screens: ['transit', 'ticker'], every: 60 } }, 60, 'ticker'],
  [{ screen: 'transit', rot: { screens: ['transit', 'ticker'], every: 60 } }, 119, 'ticker'],
  [{ screen: 'transit', rot: { screens: ['transit', 'ticker'], every: 60 } }, 120, 'transit'],
  [{ screen: 'baseball', rot: { screens: ['transit', 'ticker'], every: 60 } }, 60, 'baseball'], // rotation is for main screens only
  [{ screen: 'transit', radar: { on: false, visit: { every: 240, for: 60, always: true } } }, 10, 'weather'], // always: no rain needed
  [{ screen: 'transit', radar: { on: false, visit: { every: 240, for: 60 } } }, 10, 'transit'],
  [{ screen: 'ticker', rot: { screens: ['transit', 'ticker'], every: 120 }, radar: { on: true, visit: { every: 240, for: 60 } } }, 30, 'weather'], // visits over a rotation
  [{ screen: 'ticker', rot: { screens: ['transit', 'ticker'], every: 120 }, radar: { on: true, visit: { every: 240, for: 60 } } }, 130, 'ticker'],
  [{ screen: 'weather', rot: null }, 0, 'weather'],
];
test('autoScreen: Auto rotation and always-on weather visits (table shared with the board)', () => {
  const { autoScreen } = require('./draw');
  const base = 1_800_000_000 - (1_800_000_000 % 240);
  for (const [p, off, want] of AUTO_CASES) assert.equal(autoScreen(p, base + off), want, `${JSON.stringify(p)} +${off}`);
});

// ---- baseball (design spec §8) ----

const CHC = { ab: 'CHC', c: '#2a5bd8' }, STL = { ab: 'STL', c: '#d62a2a' };
const bbGame = (extra) => ({ id: 1, start: NOW - 3600, away: { ...CHC, r: 3, w: 92, l: 70 }, home: { ...STL, r: 2, w: 88, l: 74 }, ...extra });
const LIVE = bbGame({ st: 'live', inn: 7, half: 'T', b: 2, s: 1, o: 2, on: [1, 0, 1] });
const bb = (...games) => ({ ...payload([]), screen: 'baseball', mlb: { games } });
const AMBER = draw.C.amber;

test('baseball live: team blocks, white scores, infield bases by runner, divider', () => {
  const f = draw.renderBaseball(bb(LIVE));
  assert.equal(count(f, CHC.c, 0, 2, 2, 7), 18);           // 3x6 away block at the left edge
  assert.equal(count(f, STL.c, 0, 12, 2, 17), 18);         // 3x6 home block
  assert.ok(count(f, draw.BB.live, 22, 2, 30, 8) > 0);     // away score right-aligned to x30
  assert.equal(count(f, draw.BB.live, 31, 2, 40, 18), 0);
  assert.equal(count(f, draw.C.divider, 0, 24, 63, 24), 64);
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
  assert.equal(count(draw.renderBaseball(p, { now: t0 }), CHC.c, 0, 2, 2, 7), 18);
  assert.equal(count(draw.renderBaseball(p, { now: t0 + 60 }), '#3a5fa8', 0, 2, 2, 7), 18);
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
  assert.equal(autoScreen({ screen: 'baseball', radar }, t + 10), 'weather');
  assert.equal(autoScreen({ screen: 'baseball', radar }, t + 100), 'baseball');
  assert.equal(autoScreen({ screen: 'baseball', radar: { ...radar, on: false } }, t + 10), 'baseball');
  assert.equal(autoScreen({ screen: 'ticker', radar: { ...radar, visit: null } }, t + 10), 'ticker'); // forced: no visit sent
  assert.equal(autoScreen({ screen: 'ticker', radar }, t + 10), 'weather'); // ticker as the Auto screen gets visits too
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

test('baseball: both layouts share the divider (row 24) and the bottom line (baseline 31, like the weather row)', () => {
  const rows = (f, x0, x1) => { const ys = []; for (let y = 25; y < 32; y++) for (let x = x0; x <= x1; x++) if (f.get(x, y) && hex(f.get(x, y)) !== '#000000') { ys.push(y); break; } return ys; };
  const w = draw.renderTransit({ ...payload([]), screen: 'transit', wx: { temp: 61, icon: 'sun', word: 'CLEAR' } });
  for (const layout of ['classic', 'logos']) {
    const g = draw.renderBaseball({ ...bb(bbGame({ st: 'final' })), mlb: { layout, games: [bbGame({ st: 'final' })] } });
    assert.equal(count(g, draw.C.divider, 0, 24, 63, 24), 64, layout);
    assert.equal(Math.max(...rows(g, 40, 62)), Math.max(...rows(w, 40, 62)), layout);
  }
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

test('radar clock now: the current time in white; conditions under the clock', () => {
  const now = Date.UTC(2026, 9, 4, 16, 46) / 1000; // 11:46 AM in Chicago
  const radar = { on: true, frames: ['a', 'b', 'c'], ft: [now - 3600, now - 1800, now - 600], timeBox: [40, 0, 24, 22], split: false, showTime: true, temp: 63, icon: 'sun' };
  const at = (extra, opts = {}) => draw.render({ now, bright: 100, warn: null, radar: { ...radar, ...extra } }, { screen: 'weather', now, frames: {}, idx: 0, ...opts });
  // Frame time (default): dim, and it's the frame's time, not now.
  const frame = at({});
  assert.ok(count(frame, draw.C.radarTime, 40, 6, 63, 12) > 15);
  assert.equal(count(frame, draw.C.clock, 40, 6, 63, 12), 0);
  // Now: white, and the same pixels on every frame of the loop.
  const live = at({ clock: 'now' });
  assert.equal(count(live, draw.C.radarTime, 40, 6, 63, 12), 0);
  assert.ok(count(live, draw.C.clock, 40, 6, 63, 12) > 15);
  const ref = draw.render({ now, bright: 100, warn: null, radar: { ...radar, ft: [now, now, now] } }, { screen: 'weather', now, frames: {}, idx: 0 });
  const clockPx = (f, c) => { const out = []; for (let y = 6; y <= 12; y++) for (let x = 40; x < 64; x++) out.push(hex(f.get(x, y)) === c); return out; };
  assert.deepEqual(clockPx(live, draw.C.clock), clockPx(ref, draw.C.radarTime), 'shows the current time');
  assert.deepEqual(clockPx(live, draw.C.clock), clockPx(at({ clock: 'now' }, { idx: 2 }), draw.C.clock), 'on every frame');
  // Conditions (cond): time + A/P on one line, the temperature under it,
  // no icon, the warning tag at the bottom right.
  assert.equal(count(frame, draw.C.label, 40, 14, 63, 31), 0);
  const cond = at({ cond: true });
  assert.equal(count(cond, draw.C.radarAmpm, 40, 14, 63, 20), 0, 'no AM/PM row');
  assert.ok(count(cond, draw.C.radarSub, 59, 8, 63, 12) > 4, 'A/P on the clock line, rows 8-12');
  assert.equal(count(cond, draw.C.radarSub, 40, 6, 63, 7), 0);
  assert.ok(count(cond, draw.C.radarSub, 40, 15, 63, 19) > 8, '63° on rows 15-19, dark gray');
  let maxX = 0; for (let y = 14; y < 21; y++) for (let x = 40; x < 64; x++) if (hex(cond.get(x, y)) === draw.C.radarSub) maxX = Math.max(maxX, x);
  assert.equal(maxX, 63);
  const colored = (fr, y0, y1) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = 0; x < 64; x++) if (hex(fr.get(x, y)) !== '#000000') n++; return n; };
  assert.equal(colored(cond, 21, 31), 0, 'no icon');
  // 12:46 PM: the 26px line ends at the edge, 2px past the 24px box.
  const noon = draw.render({ now, bright: 100, warn: null, radar: { ...radar, cond: true, clock: 'now' } }, { screen: 'weather', now: now + 3600, frames: {}, idx: 0 });
  let minX = 64; for (let y = 6; y < 13; y++) for (let x = 0; x < 64; x++) if (hex(noon.get(x, y)) === draw.C.clock) minX = Math.min(minX, x);
  assert.equal(minX, 39);
  // No temperature yet: just the clock line.
  assert.equal(count(at({ cond: true, temp: null }), draw.C.radarSub, 40, 14, 63, 31), 0);
  // Warning tag at the bottom right, as with time off; nothing next to A/P.
  const tor = (blink) => draw.render({ now, bright: 100, warn: { kind: 'tor', lvl: 'warning' }, radar: { ...radar, cond: true } }, { screen: 'weather', now, frames: {}, idx: 0, blink });
  assert.ok(count(tor(false), draw.C.warnTornado, 30, 27, 63, 31) > 15);
  assert.equal(count(tor(false), draw.C.warnTornado, 0, 0, 63, 24), 0);
  assert.equal(count(tor(true), draw.C.warnTornado, 0, 0, 63, 31), 0, 'blinks');
});

test('radar time off: icon + temperature under the indicator; WATCH/WARN tag at the bottom right', () => {
  const now = Date.UTC(2026, 9, 4, 16, 46) / 1000;
  const radar = { on: true, frames: ['a', 'b', 'c'], ft: [now - 600, now - 300, now], timeBox: [40, 0, 24, 22], split: false, temp: 63, icon: 'sun' };
  const base = { now, bright: 100, warn: null };
  const off = (warn, extra = {}, opts = {}) => draw.render({ ...base, warn, radar: { ...radar, showTime: false, ...extra } }, { screen: 'weather', now, frames: {}, ...opts });
  const f = off(null);
  assert.equal(count(f, draw.C.radarAmpm, 0, 0, 63, 31), 0);       // no AM/PM
  assert.equal(count(f, draw.C.radarTime, 0, 0, 63, 31), 0);       // no frame time
  assert.equal(hex(f.get(62, 2)), draw.C.amber);                   // indicator unchanged
  assert.ok(count(f, draw.C.label, 40, 8, 63, 12) > 8);            // 63° in label white, rows 8-12
  let maxX = 0; for (let y = 0; y < 32; y++) for (let x = 40; x < 64; x++) if (hex(f.get(x, y)) === draw.C.label) maxX = Math.max(maxX, x);
  assert.equal(maxX, 63);                                          // right-aligned to the edge
  const iconPx = (fr) => { let n = 0; for (let y = 6; y < 14; y++) for (let x = 40; x < 56; x++) { const c = hex(fr.get(x, y)); if (c !== '#000000' && c !== draw.C.label) n++; } return n; };
  assert.ok(iconPx(f) > 10, 'weather icon left of the temperature');
  assert.equal(iconPx(off(null, { icon: null })), 0);              // no icon: temperature only
  // Tags: bottom right (rows 27-31), colored by level; a tornado warning blinks.
  const tag = (fr, c) => count(fr, c, 30, 27, 63, 31);
  assert.ok(tag(off({ kind: 'tor', lvl: 'watch' }), draw.C.watch) > 20);         // WATCH always yellow
  assert.ok(tag(off({ kind: 'svr', lvl: 'watch' }), draw.C.watch) > 20);
  assert.ok(tag(off({ kind: 'svr', lvl: 'warning' }), draw.C.warnSevere) > 15);  // WARN orange
  assert.ok(tag(off({ kind: 'svr', lvl: 'warning' }, {}, { blink: true }), draw.C.warnSevere) > 15); // doesn't blink
  const tor = { kind: 'tor', lvl: 'warning' };
  assert.ok(tag(off(tor), draw.C.warnTornado) > 15);                              // WARN red
  assert.equal(tag(off(tor, {}, { blink: true }), draw.C.warnTornado), 0);       // blinks
  assert.equal(tag(off({ kind: 'tor', lvl: 'watch' }, {}, { blink: true }), draw.C.watch) > 20, true);
  // Time on (default and explicit) is unchanged by temp/icon.
  const on = draw.render({ ...base, radar }, { screen: 'weather', now, frames: {} });
  // No weather yet: the time shows instead of an empty corner.
  assert.deepEqual(off(null, { temp: null }).px, draw.render({ ...base, radar: { ...radar, temp: null } }, { screen: 'weather', now, frames: {} }).px);
  const none = draw.render({ ...base, radar: { on: false, frames: [], ft: [], timeBox: [40, 0, 24, 22], split: false, showTime: false, temp: null, icon: null } }, { screen: 'weather', now });
  assert.ok(count(none, draw.C.radarTime, 40, 0, 63, 21) > 10, 'never a blank screen');
  const on2 = draw.render({ ...base, radar: { ...radar, showTime: true } }, { screen: 'weather', now, frames: {} });
  assert.deepEqual(on.px, on2.px);
  // Time on: a tornado watch next to AM/PM is yellow; a tornado warning blinks.
  const watchOn = draw.render({ ...base, warn: { kind: 'tor', lvl: 'watch' }, radar }, { screen: 'weather', now, frames: {} });
  assert.ok(count(watchOn, draw.C.watch, 40, 15, 63, 19) > 3);
  const torOn = (blink) => draw.render({ ...base, warn: tor, radar }, { screen: 'weather', now, frames: {}, blink });
  assert.ok(count(torOn(false), draw.C.warnTornado, 40, 15, 63, 19) > 3);
  assert.equal(count(torOn(true), draw.C.warnTornado, 40, 15, 63, 19), 0);
});

test('weather row: a tornado warning tag blinks; watches and severe warnings stay', () => {
  const p = (warn) => ({ ...payload([{ ln: 'RD', lbl: 'HOWARD', t: [min(5)], s: [0], a: 0 }]), wx: { icon: 'storm', temp: 54, word: 'STORMS' }, warn });
  const tag = (warn, blink, c) => count(draw.renderTransit(p(warn), { blink }), c, 20, 27, 63, 31);
  assert.ok(tag({ kind: 'tor', lvl: 'warning' }, false, draw.C.warnTornado) > 15);
  assert.equal(tag({ kind: 'tor', lvl: 'warning' }, true, draw.C.warnTornado), 0);
  assert.ok(tag({ kind: 'tor', lvl: 'watch' }, true, draw.C.watch) > 15);
  assert.ok(tag({ kind: 'svr', lvl: 'warning' }, true, draw.C.warnSevere) > 15);
});

test('animator: times slide only after a leaving DUE has faded; a new arrival waits for the slide', () => {
  // Later steps carry a payload made at that time: the board drops a
  // departed train only on a payload made after its drop moment.
  const row = (t) => payload([{ ln: 'RD', lbl: 'HOWARD', t, s: t.map(() => 0), a: 0 }]);
  const anim = draw.createTransitAnimator();
  const first = anim.step(row([NOW + 10, min(7), min(16)]), NOW, 0).rows[0].cells;
  const p2 = row([NOW + 10, min(7), min(16), min(25)]);
  const t0 = 1000;
  const at = (d) => anim.step({ ...p2, now: NOW + 45 }, NOW + 45, t0 + d).rows[0].cells;
  const id = (k) => first[k].id;
  const start = at(0);
  const sevenRight = start.find((c) => c.id === id(1)).right;
  // While DUE fades, nothing else moves or appears.
  const midFade = at(draw.FADE_MS / 2);
  assert.ok(midFade.find((c) => c.id === id(0)).alpha < 1);
  assert.equal(midFade.find((c) => c.id === id(1)).right, sevenRight);
  assert.equal(midFade.find((c) => c.id === id(2)).right, start.find((c) => c.id === id(2)).right);
  const newcomer = (cells) => cells.find((c) => ![0, 1, 2].some((k) => c.id === id(k)));
  assert.equal(newcomer(midFade).alpha, 0);
  // Then they slide (DUE gone), and the new time fades in only after the slide.
  const slide = at(draw.FADE_MS + draw.MOVE_MS / 2);
  assert.ok(!slide.some((c) => c.id === id(0)));
  const moving = slide.find((c) => c.id === id(1)).right;
  assert.ok(moving < sevenRight && moving > 0);
  assert.equal(newcomer(slide).alpha, 0);
  const after = at(draw.FADE_MS + draw.MOVE_MS + draw.FADE_MS / 2);
  assert.ok(newcomer(after).alpha > 0 && newcomer(after).alpha < 1);
  const done = at(draw.FADE_MS + draw.MOVE_MS + draw.FADE_MS + 10);
  assert.ok(done.every((c) => c.alpha === 1));
});

// ---- baseball, logo layout ----

const LOGO = (rgb) => Uint8Array.from({ length: 864 }, (_, i) => rgb[i % 3]);
const lgGame = (extra) => ({
  id: 1, start: NOW - 3600,
  away: { ab: 'CHC', c: '#2a5bd8', r: 3, w: 92, l: 70, lg: 'CHC-1', bd: '#142d5a' },
  home: { ab: 'STL', c: '#d62a2a', r: 2, w: 88, l: 74, lg: null, bd: '#761717' }, ...extra,
});
const lg = (...games) => ({ ...payload([]), screen: 'baseball', mlb: { layout: 'logos', dim: 1, games } });
const LOGOS = { 'CHC-1': LOGO([0x40, 0x10, 0x10]) };

test('logo layout live: bands to x37, logo crop at the left, white scores, infield on the right', () => {
  const f = draw.renderBaseball(lg(lgGame({ st: 'live', inn: 7, half: 'T', b: 2, s: 1, o: 2, on: [1, 0, 1] })), { logos: LOGOS });
  assert.equal(count(f, '#401010', 0, 0, 23, 11), 24 * 12);         // the whole crop, rows 0-11
  assert.ok(count(f, '#142d5a', 24, 0, 37, 11) > 60);               // away band
  assert.equal(count(f, '#142d5a', 38, 0, 63, 11), 0);              // band stops at x37
  assert.ok(count(f, '#761717', 0, 12, 37, 23) > 150);              // home band, no logo
  assert.ok(count(f, draw.BB.live, 24, 3, 37, 9) > 5);              // away score in its box
  assert.equal(count(f, '#000000', 24, 0, 37, 11), 0);              // no shadow
  assert.equal(count(f, draw.C.divider, 0, 24, 63, 24), 64);
  assert.equal(count(f, AMBER, 54, 6, 58, 10), 13);                 // 1st base, infield centered on row 8
});

test('logo layout without a logo shows the abbreviation in the band ink, in the logo slot', () => {
  const f = draw.renderBaseball(lg(lgGame({ st: 'live', inn: 1, half: 'T', on: [0, 0, 0] })), { logos: {} });
  assert.ok(count(f, draw.BB.live, 0, 12, 23, 23) > 10);            // "STL" white on a dark band
  // Light band (logo not loaded yet): black like the score, not white.
  const gold = lgGame({ st: 'live', inn: 1, half: 'T', on: [0, 0, 0] });
  gold.away = { ...gold.away, bd: '#ffc52f', c: '#ffc52f' };
  const lt = draw.renderBaseball(lg(gold), { logos: {} });
  assert.equal(count(lt, draw.BB.live, 0, 0, 23, 11), 0);
  assert.ok(count(lt, '#000000', 0, 0, 23, 11) > 10);
  assert.equal(count(f, '#401010', 0, 0, 63, 31), 0);
});

test('logo layout pregame: abbreviations in the score boxes, records in the panel, TODAY bottom left', () => {
  const f = draw.renderBaseball(lg(lgGame({ st: 'pre', start: NOW + 1500 })), { logos: LOGOS });
  assert.ok(count(f, draw.BB.live, 24, 3, 38, 9) > 10);             // CHC
  assert.ok(count(f, draw.C.grey, 40, 3, 63, 8) > 10);              // 92-70
  assert.ok(count(f, draw.C.grey, 0, 27, 20, 31) > 10);             // TODAY
  assert.ok(count(f, draw.C.label, 40, 27, 62, 31) > 5);            // first pitch
});

test('logo layout final: winner amber, loser white (not dimmed), records, FINAL', () => {
  const f = draw.renderBaseball(lg(lgGame({ st: 'final' })), { logos: LOGOS });
  assert.ok(count(f, AMBER, 24, 3, 37, 9) > 5);
  assert.ok(count(f, draw.BB.live, 24, 15, 37, 21) > 5);
  assert.equal(count(f, draw.BB.lose, 0, 0, 63, 31), 0);
  assert.ok(count(f, draw.C.label, 40, 27, 62, 31) > 5);
});

test('logo layout score roll stays inside its digit rows; a finished roll equals a static frame', () => {
  const g = lgGame({ st: 'live', inn: 3, half: 'B', b: 0, s: 2, o: 1, on: [0, 1, 0] });
  const still = draw.renderBaseball(lg(g), { logos: LOGOS });
  assert.deepEqual(draw.renderBaseball(lg(g), { logos: LOGOS, rolls: { home: { from: '1', p: 1 } } }).px, still.px);
  const mid = draw.renderBaseball(lg(g), { logos: LOGOS, rolls: { home: { from: '1', p: 0.5 } } });
  assert.notDeepEqual(mid.px, still.px);
  assert.equal(count(mid, draw.BB.live, 24, 12, 37, 13), 0);        // above the digit rows + border: band only
  assert.equal(count(mid, draw.BB.live, 24, 23, 37, 23), 0);
});

test('embossText: black right, below, and below-right; nothing else', () => {
  const f = draw.renderBaseball(bb());
  f.fill(0, 0, 64, 32, '#202020');
  draw.embossText(f, '5x7', '1', 10, 10, '#ffffff');
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const c = hex(f.get(x, y));
    if (c !== '#000000') continue;
    const lit = (dx, dy) => hex(f.get(x - dx, y - dy)) === '#ffffff' || false;
    assert.ok(lit(1, 0) || lit(0, 1) || lit(1, 1) || (x > 0 && y > 0 && [[1, 0], [0, 1], [1, 1]].some(([dx, dy]) => hex(f.get(x - dx, y - dy)) === '#ffffff')), `${x},${y}`);
  }
});

test('logo layout dims logos and bands on the board by mlb.dim (default 0.9)', () => {
  const g = lgGame({ st: 'live', inn: 1, half: 'T', on: [0, 0, 0] });
  const at = (dim) => draw.renderBaseball({ ...payload([]), screen: 'baseball', mlb: { layout: 'logos', dim, games: [g] } }, { logos: LOGOS });
  assert.equal(count(at(0.5), '#200808', 0, 0, 23, 11), 24 * 12);   // 0x40,0x10,0x10 at 50%
  assert.ok(count(at(0.5), '#0a172d', 24, 0, 37, 11) > 60);          // band #142d5a at 50%
  assert.equal(count(at(undefined), '#3a0e0e', 0, 0, 23, 11), 24 * 12); // default 90%
});

test('bands layout: team-color bands, white abbreviations, no logos', () => {
  const g = lgGame({ st: 'live', inn: 1, half: 'T', on: [0, 0, 0] });
  const f = draw.renderBaseball({ ...payload([]), screen: 'baseball', mlb: { layout: 'bands', dim: 1, games: [g] } }, { logos: LOGOS });
  assert.equal(count(f, '#401010', 0, 0, 63, 31), 0);               // no logo drawn
  assert.ok(count(f, draw.BB.live, 0, 3, 23, 9) > 8);                // CHC in the logo slot
  assert.equal(count(f, '#000000', 0, 0, 37, 11), 0);                // no shadow
  assert.ok(count(f, draw.BB.live, 24, 3, 37, 9) > 3);               // score
});

test('logo and band layouts: black (unlit) text on a light band; amber stays amber', () => {
  const light = { ab: 'ATL', c: '#ce1141', r: 4, lg: null, bd: '#d5d7d9' };
  for (const layout of ['logos', 'bands']) {
    const g = lgGame({ st: 'live', inn: 1, half: 'T', on: [0, 0, 0], home: light });
    const f = draw.renderBaseball({ ...payload([]), screen: 'baseball', mlb: { layout, dim: 0.9, games: [g] } }, { logos: LOGOS });
    assert.ok(count(f, '#000000', 24, 15, 37, 21) > 5, layout);     // home score cut out of the light band
    assert.equal(count(f, draw.BB.live, 0, 12, 37, 23), 0, layout);
    assert.ok(count(f, draw.BB.live, 24, 3, 37, 9) > 3, layout);    // dark band: white
    const fin = draw.renderBaseball({ ...payload([]), screen: 'baseball', mlb: { layout, dim: 0.9, games: [lgGame({ st: 'final', home: { ...light, r: 9 } })] } }, { logos: LOGOS });
    assert.ok(count(fin, AMBER, 24, 15, 37, 21) > 3, layout);       // the winner is amber even on a light band
  }
});

test('classic pregame: TODAY bottom left', () => {
  const f = draw.renderBaseball(bb(bbGame({ st: 'pre', start: NOW + 1500 })));
  assert.ok(count(f, draw.C.grey, 0, 27, 20, 31) > 10);
});

test('radar corner: shoreline in the clock box keeps a 1px margin from the time, AM/PM, temperature, and icon', () => {
  const now = Date.UTC(2026, 9, 4, 16, 0) / 1000;
  // A shoreline running right through the clock box.
  const bytes = new Uint8Array(2048);
  for (let y = 0; y < 32; y++) for (let x = 38; x < 64; x++) bytes[y * 64 + x] = 6;
  const base = { now, bright: 100, warn: { kind: 'svr', lvl: 'warning' }, radar: { on: true, frames: ['a', 'b'], ft: [now - 360, now], timeBox: [40, 0, 24, 22], split: false } };
  for (const extra of [{}, { showTime: false, temp: 63, icon: 'sun' }]) {
    const f = draw.render({ ...base, radar: { ...base.radar, ...extra } }, { screen: 'weather', frames: { a: bytes, b: bytes } });
    const shore = draw.RADAR[6];
    let corner = 0;
    for (let y = 0; y < 22; y++) for (let x = 40; x < 64; x++) {
      const c = hex(f.get(x, y));
      if (c === '#000000' || c === shore) continue;
      corner++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < 64 && yy >= 0 && yy < 32) assert.notEqual(hex(f.get(xx, yy)), shore, `shoreline touches (${x},${y}) ${JSON.stringify(extra)}`);
      }
    }
    assert.ok(corner > 20);
    assert.equal(hex(f.get(41, 21)), shore, 'the shoreline still draws elsewhere in the box');
  }
});


test('header: name and clock flush to the edges in the header grey; divider toggles', () => {
  const rows = [{ ln: 'RD', lbl: 'HOWARD', t: [min(3)], s: [0], a: 0 }];
  const wx = { icon: 'rain', temp: 54, word: 'RAIN' };
  const base = { ...payload(rows), header: 'MORSE', wx };
  const f = draw.renderTransit(base);
  assert.ok(count(f, draw.C.head, 0, 1, 0, 5) > 0, 'name starts at x0');
  assert.ok(count(f, draw.C.head, 63, 1, 63, 5) > 0, 'clock ends at x63');
  assert.equal(count(f, draw.C.clock, 0, 0, 63, 6), 0, 'clock in the header grey');
  assert.equal(count(f, draw.C.divider, 0, 7, 63, 7), 0, 'no header line by default');
  assert.equal(count(f, draw.C.divider, 0, 22, 63, 22), 64, 'weather line by default');
  const g = draw.renderTransit({ ...base, headerDivider: true, wxDivider: false });
  assert.equal(count(g, draw.C.divider, 0, 7, 63, 7), 64);
  assert.equal(count(g, draw.C.divider, 0, 22, 63, 22), 0);
  // The ticker header matches; it has no divider (its rows start at row 7).
  const t = draw.render({ ...base, headerDivider: true, ticker: [] }, { screen: 'ticker' });
  assert.ok(count(t, draw.C.head, 63, 1, 63, 5) > 0);
});
