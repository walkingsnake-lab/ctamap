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
  assert.deepEqual(rowTops(3, true, true, true), [9, 15, 21]);
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

test('key layout: rows between the key and the band, 1 px apart from three rows up', () => {
  assert.deepEqual(rowTops(3, true, false, false, true), [7, 13, 19]);   // 1 px everywhere: key, rows, line (25), station
  assert.deepEqual(rowTops(2, true, false, false, true), [9, 17]);
  assert.deepEqual(rowTops(1, true, false, false, true), [13]);
  assert.deepEqual(rowTops(4, false, false, false, true), [7, 13, 19, 25]); // band hidden: to the bottom edge
  assert.deepEqual(rowTops(3, true, false, true, true), [7, 13, 19]);    // the header divider doesn't apply
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

test('key layout: key on rows 1-5, station and clock unlit under a line on row 25, no header on top', () => {
  const p = { ...payload('morse-2026-10-03-2316.json'), key: 1 };
  const f = render(p);
  const top = new Set(), band = new Set();
  for (let y = 0; y < 6; y++) for (let x = 0; x < 64; x++) top.add(hex(f.get(x, y)));
  for (let y = 27; y < 32; y++) for (let x = 0; x < 64; x++) band.add(hex(f.get(x, y)));
  assert.deepEqual([...top].sort(), ['#000000', C.dimHead].sort());
  assert.deepEqual([...band].sort(), ['#000000', C.head].sort()); // unlit background
  for (let x = 0; x < 64; x++) assert.equal(hex(f.get(x, 25)), C.divider);
  for (let x = 0; x < 64; x++) assert.equal(hex(f.get(x, 26)), '#000000');
  assert.equal(hex(f.get(0, 9)), LINE.RD);         // two rows: 9 and 17
  assert.equal(hex(f.get(0, 17)), LINE.RD);
  // Station line hidden (header null): no line, the key stays.
  const g = render({ ...p, header: null });
  assert.equal(hex(g.get(10, 25)), '#000000');
});
