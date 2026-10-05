'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { render, rowTops, clockText, LINE, C } = require('./render');
const { normalize, format } = require('./arrivals');
const { parseCtaTime } = require('./time');

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
  assert.deepEqual(rowTops(2, true, false), [13, 23]);          // header + 2 rows: 10px pitch, 4px above and below
  assert.deepEqual(rowTops(4, true, false), [9, 15, 21, 27]);   // last row ends on row 31
  assert.deepEqual(rowTops(3, true, false), [10, 18, 26]);
  assert.deepEqual(rowTops(5, false, false), [1, 7, 13, 19, 25]);
  assert.deepEqual(rowTops(2, true, true), [9, 16]);            // ends by row 20, above the weather divider
  for (const [n, h, w] of [[1, true, true], [2, false, true], [3, false, true], [5, false, false], [2, true, false]]) {
    const tops = rowTops(n, h, w);
    assert.ok(tops[0] >= (h ? 9 : 0), `${n}/${h}/${w} starts at ${tops[0]}`);
    assert.ok(tops[n - 1] + 4 <= (w ? 20 : 31), `${n}/${h}/${w} ends at ${tops[n - 1] + 4}`);
  }
});

test('clock is 12-hour Chicago time without AM/PM', () => {
  assert.equal(clockText(parseCtaTime('2026-10-03T23:16:07')), '11:16');
  assert.equal(clockText(parseCtaTime('2026-10-04T01:02:00')), '1:02');
  assert.equal(clockText(parseCtaTime('2026-10-04T12:59:00')), '12:59');
});

test('transit: header band, line blocks, amber and grey times', () => {
  const p = payload('morse-2026-10-03-2316.json');
  const f = render(p);
  assert.equal(hex(f.get(63, 0)), C.band);        // header band reaches the right edge
  const tops = rowTops(2, true, false);            // two rows, centered below the header
  assert.equal(hex(f.get(0, tops[0])), LINE.RD);  // first row's color block
  // Find the colors used in the 95TH row (schedule-based times are grey, never amber).
  const top = tops[1];
  const colors = new Set();
  for (let y = top; y < top + 5; y++) for (let x = 30; x < 64; x++) colors.add(hex(f.get(x, y)));
  assert.ok(colors.has(C.sch));
  assert.ok(!colors.has(C.amber));
});

test('transit: alert blink swaps the block for a 1px "!"', () => {
  const p = payload('belmont-2026-10-03-2316.json', {}, { alerts: new Set(['BR']) });
  const solid = render(p);
  const bang = render(p, { blink: true });
  // Kimball is row 3 (top 21). Solid block lights column 0; the "!" only column 1.
  assert.equal(hex(solid.get(0, 21)), LINE.BR);
  assert.equal(hex(bang.get(0, 21)), '#000000');
  assert.equal(hex(bang.get(1, 21)), LINE.BR);
  assert.equal(hex(bang.get(1, 24)), '#000000'); // the gap in the "!"
  // Red rows are unaffected.
  assert.equal(hex(bang.get(0, 9)), LINE.RD);
});

test('no rows -> overnight clock instead of the header', () => {
  const p = { ...payload('morse-2026-10-03-2316.json'), rows: [] };
  const f = render(p);
  assert.notEqual(hex(f.get(63, 0)), C.band);
  let lit = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (hex(f.get(x, y)) === C.clock) lit++;
  assert.ok(lit > 60, `clock pixels: ${lit}`);
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

test('weather row: icon, temperature, warning tag', () => {
  const p = payload('morse-2026-10-03-2316.json', { showWeather: true }, {
    p: { wx: { icon: 'storm', temp: 54, word: 'STORMS' }, warn: { kind: 'tor', lvl: 'warning' } },
  });
  const f = render(p);
  assert.equal(hex(f.get(10, 22)), C.divider);
  const right = new Set();
  for (let y = 26; y < 31; y++) for (let x = 30; x < 64; x++) right.add(hex(f.get(x, y)));
  assert.ok(right.has(C.warnTornado));
});
