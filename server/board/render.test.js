'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { render, rowTops, clockText, LINE, C } = require('./render');
const { normalize, format } = require('./arrivals');
const { parseCtaTime } = require('./time');
const { measure } = require('./fonts');
const G = require('./glyphs');

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tt-arrivals', name), 'utf8'));

function payload(name, cfg = {}, extra = {}) {
  const j = fixture(name);
  const now = parseCtaTime(j.ctatt.tmst);
  const conf = { rows: [], showHeader: true, showWeather: false, ...cfg };
  const { rows, ticker } = format(normalize(j, { log: { warn() {} } }), conf, { now, alerts: extra.alerts || new Set() });
  return { v: 1, now, age: 0, screen: 'transit', bright: 100, header: conf.showHeader ? 'TEST' : null, rows, ticker, wx: null, warn: null, ...extra.p };
}

test('row positions follow the spec', () => {
  assert.deepEqual(rowTops(2, true, false, true), [12, 21]);    // header + divider + 2 rows: 4 px from the line, 4 between
  assert.deepEqual(rowTops(4, true, false, true), [9, 15, 21, 27]); // with the divider: last row ends on row 31
  assert.deepEqual(rowTops(3, true, false, true), [10, 18, 26]);
  assert.deepEqual(rowTops(5, false, false), [1, 7, 13, 19, 25]);
  assert.deepEqual(rowTops(2, true, true, true), [11, 19]);     // ends by row 25, above the weather strip
  assert.deepEqual(rowTops(3, true, true, true), [8, 14, 20]);  // between the lines on rows 7 and 25
  // Without the header's divider line the rows move up: the gap under the
  // header text (row 5) matches the gaps between rows.
  assert.deepEqual(rowTops(2, true, false, false), [10, 19]);   // 4 px under the text, 4 between
  assert.deepEqual(rowTops(3, true, false, false), [9, 17, 25]); // gaps 3, 3, 3, 2
  assert.deepEqual(rowTops(4, true, false, false), [8, 14, 20, 26]);
  assert.deepEqual(rowTops(1, true, false, false), [16]);       // centered: 10 above, 11 below
  assert.deepEqual(rowTops(1, true, true, false), [14]);
  assert.deepEqual(rowTops(2, true, true, false), [10, 18]);
  assert.deepEqual(rowTops(3, true, true, false), [8, 14, 20]); // 2 px under the text, 1 between, 2 above the strip
  assert.deepEqual(rowTops(2, false, false, false), rowTops(2, false, false)); // no header: unchanged
});

test('without the header, rows are spread evenly (equal gaps, odd pixel to the bottom)', () => {
  assert.deepEqual(rowTops(2, false, false), [7, 19]);
  assert.deepEqual(rowTops(3, false, false), [4, 13, 22]);
  assert.deepEqual(rowTops(4, false, false), [1, 9, 17, 25]);   // pinned: 3px between rows
  assert.deepEqual(rowTops(5, false, false), [1, 7, 13, 19, 25]);
  assert.deepEqual(rowTops(2, false, true), [5, 15]);
  assert.deepEqual(rowTops(3, false, true), [2, 10, 18]);
  assert.deepEqual(rowTops(4, false, true), [1, 7, 13, 19]);
});

test('rows stay inside their area', () => {
  for (const [n, h, w] of [[1, true, true], [3, true, true], [2, false, true], [4, false, true], [5, false, false], [2, true, false]]) {
    const tops = rowTops(n, h, w);
    assert.ok(tops[0] >= (h ? 7 : 0), `${n}/${h}/${w} starts at ${tops[0]}`);
    assert.ok(tops[n - 1] + 4 <= (w ? 25 : 31), `${n}/${h}/${w} ends at ${tops[n - 1] + 4}`);
  }
});

test('clock is 12-hour Chicago time without AM/PM', () => {
  assert.equal(clockText(parseCtaTime('2026-10-03T23:16:07')), '11:16');
  assert.equal(clockText(parseCtaTime('2026-10-04T01:02:00')), '1:02');
  assert.equal(clockText(parseCtaTime('2026-10-04T12:59:00')), '12:59');
});

test('transit: header without a band, line blocks, amber and grey times', () => {
  const p = payload('morse-2026-10-03-2316.json');
  const f = render(p);
  assert.equal(hex(f.get(63, 0)), '#000000');     // no header band
  const head = new Set();
  for (let y = 1; y <= 5; y++) for (let x = 1; x < 30; x++) head.add(hex(f.get(x, y)));
  assert.ok(head.has(C.dimHead));                 // station name in the transit dark grey
  const tops = rowTops(2, true, false);            // two rows, centered below the header
  assert.equal(hex(f.get(0, tops[0])), LINE.RD);  // first row's color block
  // Find the colors used in the 95TH row (schedule-based times are grey, never amber).
  const top = tops[1];
  const colors = new Set();
  for (let y = top; y < top + 5; y++) for (let x = 30; x < 64; x++) colors.add(hex(f.get(x, y)));
  assert.ok(colors.has(C.sch));
  assert.ok(!colors.has(C.amber));
});

test('transit: an alerted line keeps its block; its label (cut to fit) is followed by the red alert circle', () => {
  const p = payload('belmont-2026-10-03-2316.json', {}, { alerts: new Set(['BR']) });
  const a = render(p);
  const b = render(p, { blink: true });
  assert.deepEqual([...a.px], [...b.px]);          // static
  const tops = rowTops(4, true, false);
  for (const [i, r] of p.rows.entries()) {
    const k = tops[i];
    for (let j = 0; j < 5; j++) assert.equal(hex(a.get(0, k + j)), LINE[r.ln], 'full block');
    const reds = [];
    for (let x = 0; x < 64; x++) for (let j = 0; j < 5; j++) if (hex(a.get(x, k + j)) === C.red) reds.push(x);
    if (!r.a) { assert.equal(reds.length, 0); continue; }
    // The circle starts 2px after the alert label: 17 red pixels, the "!" white.
    const ix = 5 + measure('small', r.al) + 2;
    assert.equal(reds.length, 17);
    assert.equal(Math.min(...reds), ix);
    assert.equal(Math.max(...reds), ix + 4);
    assert.equal(hex(a.get(ix + 2, k)), C.white);
    assert.equal(hex(a.get(ix + 2, k + 3)), C.red);  // the gap in the "!"
  }
  // Kimball (three times) is cut; Loop (two) stays whole.
  assert.equal(p.rows[2].al, 'KIMB' + String.fromCodePoint(G.CUT));
  assert.equal(p.rows[3].al, 'LOOP');
});

test('no rows -> overnight clock instead of the header', () => {
  const p = { ...payload('morse-2026-10-03-2316.json'), rows: [] };
  const f = render(p);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) assert.notEqual(hex(f.get(x, y)), C.head);
  let lit = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (hex(f.get(x, y)) === C.clock) lit++;
  assert.ok(lit > 60, `clock pixels: ${lit}`);
});

test('no rows and stale data -> NO DATA instead of NO TRAINS', () => {
  const p = { ...payload('morse-2026-10-03-2316.json'), rows: [] };
  const lit = (f) => { let n = 0; for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (hex(f.get(x, y)) === C.noTrains) n++; return n; };
  const fresh = render(p), stale = render({ ...p, stale: 1 });
  assert.ok(lit(fresh) > 0 && lit(stale) > 0);
  assert.notEqual(lit(stale), lit(fresh));
  assert.deepEqual(render({ ...p, stale: 1 }).px, stale.px);
});

test('stale data: a red line along the top edge on transit and ticker, nowhere else changed', () => {
  const p = payload('morse-2026-10-03-2316.json');
  for (const screen of ['transit', 'ticker']) {
    const fresh = render(p, { screen }), stale = render({ ...p, stale: 1 }, { screen });
    for (let x = 0; x < 64; x++) {
      assert.equal(hex(fresh.get(x, 0)) === C.red, false);
      assert.equal(hex(stale.get(x, 0)), C.red, `${screen} x=${x}`);
    }
    for (let y = 1; y < 32; y++) for (let x = 0; x < 64; x++) assert.deepEqual(stale.get(x, y), fresh.get(x, y));
  }
  assert.equal(hex(render({ ...p, rows: [], stale: 1 }).get(10, 0)), C.red);
});

test('ticker: index column shows the number, the clock for scheduled, the alert circle for alerts', () => {
  const p = payload('morse-2026-10-03-2316.json');
  // Morse ticker: [95th (scheduled), Howard, 95th (scheduled), Howard, ...]
  const page0 = render(p, { screen: 'ticker', page: 0 });
  const indexColors = (f, top) => {
    const set = new Set();
    for (let y = top; y < top + 12; y++) for (let x = 0; x < 5; x++) set.add(hex(f.get(x, y)));
    return set;
  };
  assert.ok(indexColors(page0, 7).has(C.label));    // clock glyph drawn
  assert.ok(indexColors(page0, 20).has(C.label));   // "2"
  const alerted = render({ ...p, ticker: p.ticker.map((x) => ({ ...x, a: 1 })) }, { screen: 'ticker', page: 0 });
  assert.ok(indexColors(alerted, 7).has(C.red));    // alert wins over scheduled
});

test('brightness scales every pixel', () => {
  const p = payload('morse-2026-10-03-2316.json');
  const full = render(p);
  const dim = render({ ...p, bright: 40 });
  const y = rowTops(2, true, false)[0];
  assert.deepEqual(dim.get(0, y), full.get(0, y).map((v) => Math.round(v * 0.4)));
  const off = render({ ...p, bright: 0 });
  assert.ok(off.px.every((v) => v === 0));
});

test('weather strip: temperature left, condition right; a warning tag replaces the condition', () => {
  const colors = (f, x0, x1) => { const c = new Set(); for (let y = 27; y < 32; y++) for (let x = x0; x <= x1; x++) c.add(hex(f.get(x, y))); return c; };
  const wx = { icon: 'storm', temp: 54, word: 'STORMS' };
  const plain = render(payload('morse-2026-10-03-2316.json', { showWeather: true }, { p: { wx } }));
  assert.ok(colors(plain, 0, 10).has(C.dimHead));
  assert.ok(colors(plain, 40, 63).has(C.dimHead));
  for (let x = 0; x < 64; x++) assert.equal(hex(plain.get(x, 26)), '#000000'); // no divider
  const warned = render(payload('morse-2026-10-03-2316.json', { showWeather: true }, { p: { wx, warn: { kind: 'tor', lvl: 'warning' } } }));
  assert.ok(colors(warned, 0, 10).has(C.dimHead));  // the temperature stays
  assert.ok(colors(warned, 30, 63).has(C.warnTornado));
  assert.ok(!colors(warned, 30, 63).has(C.dimHead));
});

test('knob chooser: wheel across the top, one pip per entry, the selection amber; commit drops the neighbors', () => {
  const p = { bright: 100, knob: { ring: ['auto', 'transit', 'weather', 'sports'], at: 1 } };
  const at = (pos, commit) => render(p, { screen: 'chooser', chooser: { pos, commit } });
  const lit = (f, y0, y1) => { const xs = []; for (let x = 0; x < 64; x++) for (let y = y0; y <= y1; y++) if (f.get(x, y).some((v) => v)) { xs.push(x); break; } return xs; };
  const pipColors = (f) => [23, 28, 33, 38].map((x) => hex(f.get(x, 9)));
  let f = at(2);
  assert.deepEqual(pipColors(f), [C.indicator, C.indicator, C.amber, C.indicator]);
  assert.deepEqual(lit(f, 9, 9), [23, 24, 25, 28, 29, 30, 33, 34, 35, 38, 39, 40]);
  // WEATHER in 5x7, centered, on rows 1-6, label white.
  const w = measure('5x7', 'WEATHER');
  const x0 = Math.round(32 - w / 2);
  const mid = lit(f, 1, 7).filter((x) => x >= x0 && x < x0 + w);
  assert.equal(mid[0], x0);
  assert.ok(lit(f, 0, 0).length === 0 && lit(f, 10, 31).length === 0, 'rows 0 and 10-31 dark');
  // Neighbors clipped at the edges, darker than the selection.
  assert.ok(lit(f, 1, 6).some((x) => x < 6) && lit(f, 1, 6).some((x) => x > 58));
  // Wraps both ways: -1 and 3 are both SPORTS.
  assert.deepEqual(at(-1).px, at(3).px);
  assert.deepEqual(pipColors(at(-1)), [C.indicator, C.indicator, C.indicator, C.amber]);
  // Commit: only the selection, in amber; the pips stay.
  f = at(2, true);
  assert.ok(lit(f, 1, 6).every((x) => x >= x0 && x < x0 + w));
  assert.ok(lit(f, 1, 6).length && lit(f, 1, 6).every((x) => [1, 2, 3, 4, 5, 6].every((y) => !f.get(x, y).some((v) => v) || hex(f.get(x, y)) === C.amber)));
  assert.deepEqual(pipColors(f), [C.indicator, C.indicator, C.amber, C.indicator]);
  // No ring: blank.
  assert.equal(lit(render({ bright: 100 }, { screen: 'chooser', chooser: { pos: 0 } }), 0, 31).length, 0);
});

test('peek chooser: the chosen variant itself, drawn from pv, under the category-color icon bar', () => {
  const { PEEK, PEEK_ICONS, PEEK_COLORS } = require('./render');
  const base = payload('morse-2026-10-03-2316.json');
  const now = base.now;
  const wx = { icon: 'sun', temp: 54, word: 'SUNNY', hi: 61, lo: 47, feels: 51, wind: 'NW 12', pop: 20 };
  const days = ['SU', 'MO', 'TU', 'WE', 'TH'].map((d, i) => ({ d, hi: 60 + i, icon: 'sun' }));
  const hours = ['1A', '3A', '5A', '7A'].map((h, i) => ({ h, t: 50 + i, icon: 'moon' }));
  const radar = { on: false, frames: [], ft: [], timeBox: [40, 0, 24, 22], split: false, wx };
  const p = { ...base, tzo: -18000, tickerHeader: 'TEST', radar, msg: null,
    pv: { days, hours, skyline: null, cwx: { temp: 54, icon: 'sun' }, dn: null },
    knob: { ring: ['transit', 'weather', 'clock', 'announce', 'cycle'], at: 0, vars: [['transit', 'ticker'], ['now', '5day', 'hourly'], ['skyline', 'seventies', 'analog'], [], []], sel: [0, 0, 0, 0, 0], ln: 'BL' } };
  const peek = (pk, o = {}) => render(p, { screen: 'peek', now, frames: {}, peek: pk, ...o });
  const rowsEqual = (a, b, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = 0; x < 64; x++) if (hex(a.get(x, y)) !== hex(b.get(x, y))) return false; return true; };
  const scale = (c, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');

  // The view above the bar is the variant drawn as its own screen.
  assert.ok(rowsEqual(peek({ k: 0, vi: 1 }), render(p, { screen: 'ticker', now }), 0, 20), 'transit · ticker');
  assert.ok(rowsEqual(peek({ k: 1, vi: 1 }), render({ ...p, radar: { ...radar, wx: { ...wx, days } } }, { screen: 'weather', now }), 0, 20), 'weather · 5-day from pv.days');
  assert.ok(rowsEqual(peek({ k: 1, vi: 2 }), render({ ...p, radar: { ...radar, wx: { ...wx, hours } } }, { screen: 'weather', now }), 0, 20), 'weather · hourly from pv.hours');
  assert.ok(rowsEqual(peek({ k: 2, vi: 2 }), render({ ...p, cface: 'analog', cwx: p.pv.cwx }, { screen: 'clock', now }), 0, 20), 'clock · analog from pv.cwx');
  assert.ok(!rowsEqual(peek({ k: 1, vi: 0 }), peek({ k: 1, vi: 1 }), 0, 20));

  // The bar: five icons 12 px apart from x4, the chosen one in its color, the rest at 30%.
  let f = peek({ k: 0, vi: 0 });
  for (let x = 0; x < 64; x++) assert.equal(hex(f.get(x, 21)), '#000000', 'row 21 black');
  const cats = p.knob.ring, colorOf = (c) => (c === 'transit' ? LINE.RD : PEEK_COLORS[c]); // red at a Blue Line station too
  cats.forEach((cat, i) => {
    const [dx, dy] = [...PEEK_ICONS[cat].join('')].reduce((a, ch, n) => (a || ch !== '#' ? a : [n % 7, Math.floor(n / 7)]), null);
    assert.equal(hex(f.get(4 + i * PEEK.pitch + dx, 23 + dy)), i === 0 ? colorOf(cat) : scale(colorOf(cat), 0.3), cat);
  });
  // Underline under the chosen icon; its variants as dots beside it (two for transit).
  for (let x = 4; x < 11; x++) assert.equal(hex(f.get(x, 31)), LINE.RD);
  assert.equal(hex(f.get(12, 25)), LINE.RD);
  assert.equal(hex(f.get(12, 27)), C.indicator);
  // Clock with three faces, the third chosen: dots on rows 24, 26, 28.
  f = peek({ k: 2, vi: 2 });
  assert.deepEqual([24, 26, 28].map((y) => hex(f.get(4 + 2 * PEEK.pitch + 8, y))), [C.indicator, C.indicator, PEEK_COLORS.clock]);
  // No dots for a category without variants; cycle draws the phone's symbol in cyan.
  f = peek({ k: 4, vi: 0 });
  assert.equal(hex(f.get(4 + 4 * PEEK.pitch + 8, 26)), '#000000');
  assert.equal(hex(f.get(26, 9)), PEEK_COLORS.cycle);
  // Three entries: the bar is centered.
  const three = render({ ...p, knob: { ...p.knob, ring: ['transit', 'weather', 'cycle'], vars: [[], [], []] } }, { screen: 'peek', now, peek: { k: 2, vi: 0 } });
  for (let x = 40; x < 47; x++) assert.equal(hex(three.get(x, 31)), PEEK_COLORS.cycle);

  // Slides: from the old view to the new, sideways for a category and down for a variant.
  const a = peek({ k: 0, vi: 0 }), b = peek({ k: 1, vi: 0 });
  assert.ok(rowsEqual(peek({ k: 1, vi: 0, slide: { k: 0, vi: 0, t: 0, axis: 'x', dir: 1 } }), a, 0, 20), 'starts on the old view');
  assert.ok(rowsEqual(peek({ k: 1, vi: 0, slide: { k: 0, vi: 0, t: PEEK.xMs, axis: 'x', dir: 1 } }), b, 0, 31), 'ends on the new one');
  const mid = peek({ k: 1, vi: 0, slide: { k: 0, vi: 0, t: 60, axis: 'x', dir: 1 } });
  assert.ok(!rowsEqual(mid, a, 0, 20) && !rowsEqual(mid, b, 0, 20));
  const down = peek({ k: 1, vi: 1, slide: { k: 1, vi: 0, t: PEEK.yMs, axis: 'y', dir: 1 } });
  assert.ok(rowsEqual(down, peek({ k: 1, vi: 1 }), 0, 31));

  // The bar drops away: fully dropped is the bare view.
  assert.ok(rowsEqual(peek({ k: 0, vi: 0, drop: PEEK.band }), render(p, { screen: 'transit', now }), 0, 31));
  f = peek({ k: 0, vi: 0, drop: 4 });
  assert.equal(hex(f.get(5, 27)), LINE.RD, 'the icons have moved down 4 rows');
  assert.equal(hex(f.get(7, 31)), '#000000', 'the underline is off the panel');

  // Raining: the radar, still, on the newest frame on hand; missing frames
  // leave it empty with their indicator segments dark, the loaded ones lit.
  const pr = { ...p, radar: { ...radar, on: true, frames: ['a', 'b', 'c'], ft: [now - 600, now - 300, now - 60] } };
  const seg = (fr) => [57, 60, 63].map((x) => hex(fr.get(x, 2)));
  f = render(pr, { screen: 'peek', now, frames: {}, peek: { k: 1, vi: 0 } });
  assert.deepEqual(seg(f), [C.indicator, C.indicator, C.indicator], 'nothing on hand: empty radar, not the conditions layout');
  const bytes = new Uint8Array(2048).fill(2);
  f = render(pr, { screen: 'peek', now, frames: { a: bytes, b: bytes }, peek: { k: 1, vi: 0 } });
  assert.deepEqual(seg(f), ['#6a6a6a', C.amber, C.indicator]);
  assert.notEqual(hex(f.get(0, 10)), '#000000', 'the newest frame on hand is drawn');

  // The radar view: every kept frame from pv.radar, dry or not; the other
  // views ignore frames while it's dry (radar.on false).
  const pd = { ...p, radar: { ...radar, on: false, frames: ['a', 'b'], ft: [now - 400, now - 40] },
    pv: { ...p.pv, radar: { frames: ['a', 'b'], ft: [now - 400, now - 40] } },
    knob: { ...p.knob, vars: [['transit', 'ticker'], ['now', '5day', 'hourly', 'radar'], ['skyline'], [], []] } };
  const empty = new Uint8Array(2048);
  empty[3 * 64 + 5] = 6;
  f = render(pd, { screen: 'peek', now, frames: { a: empty, b: empty }, peek: { k: 1, vi: 3 } });
  assert.deepEqual([60, 63].map((x) => hex(f.get(x, 2))), ['#6a6a6a', C.amber], 'the radar loop, still on the newest');
  assert.notEqual(hex(f.get(5, 3)), '#000000', 'the shoreline');
  f = render(pd, { screen: 'peek', now, frames: { a: empty, b: empty }, peek: { k: 1, vi: 0 } });
  assert.ok(rowsEqual(f, render({ ...p, radar: { ...radar, wx } }, { screen: 'weather', now }), 0, 20), 'conditions while dry');
});

test('clock screen, seventies face: VCR digits banded by row, stripes along the bottom and up the right edge', () => {
  const t = Date.parse('2026-11-02T03:42:00Z') / 1000;  // 9:42 PM in Chicago
  const p = { now: t, tzo: -21600, screen: 'clock', cface: 'seventies', bright: 100, skyline: null };
  const f = render(p);
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  // Stripes: the inner one on rows 23-24 and columns 56-57, sunflower; the outer on row 30 and column 63, rust.
  assert.equal(hex(f.get(0, 23)), '#ffc23a');
  assert.equal(hex(f.get(56, 0)), '#ffc23a');
  assert.equal(hex(f.get(0, 30)), '#d2361a');
  assert.equal(hex(f.get(63, 0)), '#d2361a');
  // Digits: every lit pixel in rows 5-15, columns 0-52, takes its row's band.
  const bands = { 5: '#ffc23a', 9: '#ff7414', 12: '#d2361a' };
  let lit = 0;
  for (let y = 0; y < 23; y++) for (let x = 0; x <= 52; x++) {
    const c = f.get(x, y);
    if (!(c[0] || c[1] || c[2])) continue;
    lit++;
    assert.ok(y >= 5 && y <= 15, `lit outside the digit rows at ${x},${y}`);
    assert.equal(hex(c), bands[y >= 12 ? 12 : y >= 9 ? 9 : 5], `${x},${y}`);
  }
  assert.ok(lit > 100, 'the time is drawn');
  // Without cface the clock screen is still the skyline.
  assert.notEqual(hex(render({ ...p, cface: undefined }).get(0, 23)), '#ffc23a');
});

test('clock screen, big digits face: 17-row ttyp0 digits with their ink centered; the colon blinks, never mid-roll', () => {
  // 8:08 PM in Chicago: full-width digits at both ends (a 1 sits centered in
  // its tabular slot, so its ink starts further in).
  const t = Date.parse('2026-11-02T02:08:00Z') / 1000;
  const p = { now: t, tzo: -21600, screen: 'clock', cface: 'digits', bright: 100 };
  const inkCols = (f, y0 = 0, y1 = 31) => {
    const xs = [];
    for (let x = 0; x < 64; x++) for (let y = y0; y <= y1; y++) { const c = f.get(x, y); if (c[0] || c[1] || c[2]) { xs.push(x); break; } }
    return xs;
  };
  const rows = (f) => { const ys = new Set(); for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) { const c = f.get(x, y); if (c[0] || c[1] || c[2]) ys.add(y); } return [...ys]; };
  const on = render(p, { ms: t * 1000 + 250 });
  assert.deepEqual([Math.min(...rows(on)), Math.max(...rows(on))], [7, 23], 'digits on rows 7-23');
  const xs = inkCols(on);
  assert.ok(Math.abs(xs[0] - (63 - xs[xs.length - 1])) <= 1, 'centered: as much room left as right');
  // The colon (two round dots) goes dark for the second half of each second.
  const off = render(p, { ms: t * 1000 + 750 });
  const colon = inkCols(on).filter((x) => !inkCols(off).includes(x));
  assert.equal(colon.length, 4, 'the 4 px colon');
  const c0 = colon[0];
  assert.deepEqual([0, 1, 2, 3].map((i) => !!on.get(c0 + i, 10)[0]), [false, true, true, false], 'round dot: corner pixels off');
  assert.deepEqual([0, 1, 2, 3].map((i) => !!on.get(c0 + i, 11)[0]), [true, true, true, true]);
  // Mid-roll the colon stays lit whatever the second.
  const mid = render(p, { ms: t * 1000 + 750, nums: { 'dig.clock': { from: '8:07', p: 0.5 } } });
  assert.ok(mid.get(c0 + 1, 11)[0], 'lit mid-roll');
  // Steady (Blinking colon off): lit all second.
  assert.deepEqual(render({ ...p, steady: true }, { ms: t * 1000 + 750 }).px, on.px, 'steady colon');
});

test('clock screen, day/date face: weekday, time with AM/PM, date, each centered', () => {
  const t = Date.parse('2026-11-04T16:07:00Z') / 1000;  // Wednesday 10:07 AM in Chicago
  const p = { now: t, tzo: -21600, screen: 'clock', cface: 'daydate', bright: 100 };
  const f = render(p);
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const lit = (y0, y1) => { const xs = []; for (let x = 0; x < 64; x++) for (let y = y0; y <= y1; y++) if (f.get(x, y)[0]) { xs.push(x); break; } return xs; };
  const span = (xs) => [xs[0], xs[xs.length - 1]];
  // Lines on rows 1-5 (weekday), 9-21 (time), 24-30 (date); nothing between.
  for (const y of [0, 6, 7, 8, 22, 23, 31]) assert.equal(lit(y, y).length, 0, `row ${y} empty`);
  const [d0, d1] = span(lit(1, 5));
  assert.ok(Math.abs(d0 - (63 - d1)) <= 1, 'WEDNESDAY centered');
  const [n0, n1] = span(lit(24, 30));
  assert.ok(Math.abs(n0 - (63 - n1)) <= 1, 'NOV 4 centered');
  // The time and AM/PM centered as a pair; AM is dim and two columns after the digits.
  const [t0, t1] = span(lit(9, 21));
  assert.ok(Math.abs(t0 - (63 - t1)) <= 1, 'time + AM centered');
  assert.equal(hex(f.get(t1, 21)), '#555555', 'AM/PM at the right, on the digits\' bottom row');
  const digitsEnd = Math.max(...lit(9, 16));
  assert.equal(lit(17, 21).filter((x) => x > digitsEnd && x < digitsEnd + 3).length, 0, 'a two-column gap before AM');
});

test('clock faces: localDate matches the calendar (weekday, month, day, time) across years and offsets', () => {
  const { localDate } = require('./render');
  for (const iso of ['1970-01-01T00:00:00Z', '2000-02-29T12:34:56Z', '2026-11-02T03:42:37Z', '2026-12-31T23:59:59Z', '2028-02-29T05:00:00Z', '2100-03-01T00:00:00Z']) {
    for (const tzo of [0, -21600, -18000, 19800]) {
      const t = Date.parse(iso) / 1000, d = new Date((t + tzo) * 1000);
      assert.deepEqual(localDate(t, tzo), { wd: d.getUTCDay(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), s: d.getUTCSeconds() }, `${iso} ${tzo}`);
    }
  }
});

test('clock screen, day/night face: lit where the sun is up, dark on the far side, Chicago marked', () => {
  const { subsolar } = require('./sun');
  const t = Date.parse('2026-11-01T18:00:00Z') / 1000, sun = subsolar(t);
  const p = { now: t, tzo: -21600, screen: 'clock', cface: 'daynight', bright: 100, dn: { dec: Math.round(sun.dec * 10), lon: Math.round(sun.lon * 10), t, here: [16, 7] } };
  const f = render(p);
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  assert.equal(hex(f.get(16, 7)), '#ffffff', 'Chicago');
  assert.equal(hex(f.get(10, 14)), '#2c70b0', 'the Pacific off Mexico at noon: day sea');
  const { WORLD, WORLD_PALETTE } = require('./world');
  const day = WORLD_PALETTE[WORLD[10][50]];
  const night = [1, 3, 5].map((i, k) => Math.floor(parseInt(day.slice(i, i + 2), 16) * [104, 116, 140][k] / 256));
  assert.deepEqual(f.get(50, 10), night, 'Asia at midnight: its land color, dimmed toward blue');
});

test('clock screen, gradient face: the colors move slowly with the clock, the giant time is knocked out', () => {
  const t = Date.parse('2026-11-02T01:15:00Z') / 1000;
  const p = { now: t, tzo: -21600, screen: 'clock', cface: 'gradient', bright: 100 };
  const a = render(p, { ms: t * 1000 }), b = render(p, { ms: t * 1000 + 60000 });
  assert.notDeepEqual(a.get(0, 0), b.get(0, 0), 'the gradient drifts');
  assert.deepEqual(render(p, { ms: t * 1000 + 3600000 }).get(0, 0), a.get(0, 0), 'and comes round in an hour');
  // 7:15 in 12 x 30 block digits: lots of unlit pixels, rows 1-30.
  let dark = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) { const c = a.get(x, y); if (!(c[0] || c[1] || c[2])) dark++; }
  assert.ok(dark > 400, `the time is cut out (${dark} unlit)`);
  for (let x = 0; x < 64; x++) assert.ok(a.get(x, 0).some((v) => v > 0) && a.get(x, 31).some((v) => v > 0), 'rows 0 and 31 stay lit');
  // Inverted: exactly those unlit pixels are lit, in the gradient's own colors; the rest is black.
  const inv = render({ ...p, ginv: true }, { ms: t * 1000 });
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const c = a.get(x, y), d = inv.get(x, y);
    if (c[0] || c[1] || c[2]) assert.deepEqual(d, [0, 0, 0], `${x},${y} black`);
    else assert.ok(d.some((v) => v > 0), `${x},${y} lit`);
  }
  for (const [x, y] of [[0, 0], [63, 0], [0, 31], [63, 31]]) assert.ok(a.get(x, y).some((v) => v > 0), `corner ${x},${y} lit`);
});
