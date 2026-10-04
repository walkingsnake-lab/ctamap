'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalize, format, maxRows, timeText, worstTimesWidth, TICKER_DEST_PX } = require('./arrivals');
const { parseCtaTime } = require('./time');
const { measure } = require('./fonts');

const quiet = { warn() {}, error() {} };
const DIR = path.join(__dirname, 'fixtures', 'tt-arrivals');
const load = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
const nowOf = (json) => parseCtaTime(json.ctatt.tmst);
const base = { rows: [], showHeader: true, showWeather: false };
const mins = (row, now) => row.t.map((t) => Math.floor((t - now) / 60));

function run(name, cfg = base, opts = {}) {
  const json = load(name);
  const now = nowOf(json);
  return { now, ...format(normalize(json, { log: quiet }), cfg, { now, ...opts }) };
}

test('Morse: Howard then 95th, three times max, schedule-based times flagged', () => {
  const { rows, now } = run('morse-2026-10-03-2316.json');
  assert.deepEqual(rows.map((r) => r.lbl), ['HOWARD', '95TH']);
  assert.deepEqual(mins(rows[0], now), [2, 7, 16]);
  assert.deepEqual(rows[0].s, [0, 0, 0]);
  // Southbound trains still at the Howard terminal are schedule-based.
  assert.deepEqual(rows[1].s, [1, 1]);
  assert.ok(rows.every((r) => r.ln === 'RD' && r.a === 0));
});

test('Howard: trains ending at Howard are dropped', () => {
  const { rows, ticker } = run('howard-2026-10-03-2316.json');
  assert.deepEqual(rows.map((r) => `${r.ln}:${r.lbl}`), ['RD:95TH', 'PR:LINDEN']);
  assert.ok(ticker.every((x) => x.d !== 'Howard'));
});

test('Belmont: line order, then direction; Brown "Loop" kept as-is', () => {
  const { rows } = run('belmont-2026-10-03-2316.json');
  assert.deepEqual(rows.map((r) => `${r.ln}:${r.lbl}`), ['RD:HOWARD', 'RD:95TH', 'BR:KIMBALL', 'BR:LOOP']);
});

test('Clark/Lake: short names, and the row cap drops the last rows', () => {
  const header = run('clark-lake-2026-10-03-2317.json');
  assert.equal(header.rows.length, 4);
  assert.deepEqual(header.rows.map((r) => r.lbl), ["O'HARE", 'FOREST', 'KIMBALL', 'HARLEM']);
  const all = run('clark-lake-2026-10-03-2317.json', { ...base, showHeader: false });
  assert.equal(all.rows[4].lbl, '54TH');
  // The ticker isn't limited by the row cap.
  assert.ok(header.ticker.some((x) => x.ln === 'PK'));
});

test('row cap follows the header and weather toggles', () => {
  assert.equal(maxRows(false, false), 5);
  assert.equal(maxRows(true, false), 4);
  assert.equal(maxRows(false, true), 3);
  assert.equal(maxRows(true, true), 2);
  const { rows } = run('belmont-2026-10-03-2316.json', { ...base, showWeather: true });
  assert.equal(rows.length, 2);
});

test('the configured row list filters and orders destinations', () => {
  const { rows, ticker } = run('belmont-2026-10-03-2316.json', { ...base, rows: ['BR:Loop', 'RD:95th'] });
  assert.deepEqual(rows.map((r) => r.lbl), ['LOOP', '95TH']);
  assert.ok(ticker.every((x) => (x.ln === 'BR' && x.d === 'Loop') || (x.ln === 'RD' && x.d === '95th')));
});

test('unknown destinations get their own row after the configured ones, and are logged once', () => {
  const json = load('morse-2026-10-03-2316.json');
  json.ctatt.eta[1].destNm = 'Granville';
  json.ctatt.eta[3].destNm = 'Granville';
  const warnings = [];
  const arr = normalize(json, { log: { warn: (m) => warnings.push(m) } });
  assert.equal(warnings.length, 1);
  const { rows } = format(arr, { ...base, rows: ['RD:Howard'] }, { now: nowOf(json) });
  assert.deepEqual(rows.map((r) => r.lbl), ['HOWARD', 'GRANVILLE']);
});

test('ticker: next six arrivals in time order, ligature applied, schedule flag kept', () => {
  const { ticker, now } = run('morse-2026-10-03-2316.json');
  assert.equal(ticker.length, 6);
  assert.deepEqual(ticker.map((x) => Math.floor((x.t - now) / 60)), [0, 2, 6, 7, 16, 24]);
  assert.deepEqual(ticker.map((x) => x.s), [1, 0, 1, 0, 0, 0]);
  assert.ok(ticker.every((x) => measure('5x7', x.d) <= TICKER_DEST_PX));
  const cottage = format([{ ln: 'GR', dest: 'Cottage', known: true, dir: 5, t: now + 300, s: 0 }], base, { now });
  assert.equal(cottage.ticker[0].d, 'Coage');
});

test('active alerts flag every row and ticker item of that line', () => {
  const { rows, ticker } = run('belmont-2026-10-03-2316.json', base, { alerts: new Set(['BR']) });
  assert.deepEqual(rows.map((r) => r.a), [0, 0, 1, 1]);
  assert.ok(ticker.every((x) => x.a === (x.ln === 'BR' ? 1 : 0)));
});

test('arrivals more than 30 s past are dropped', () => {
  const json = load('morse-2026-10-03-2316.json');
  const now = nowOf(json) + 120; // two minutes later
  const { rows } = format(normalize(json, { log: quiet }), base, { now });
  assert.deepEqual(mins(rows[0], now), [0, 5, 14]); // Howard train at +3:01 is still there
  assert.equal(rows[1].t.length, 1); // the 95th train at +1:00 has gone
});

test('no predictions -> empty rows (board shows the overnight layout)', () => {
  const r = format(normalize({ ctatt: { tmst: '2026-10-04T03:00:00', errCd: '0' } }, { log: quiet }), base, { now: 0 });
  assert.deepEqual(r, { rows: [], ticker: [] });
});

test('labels never collide with the times, including when the first time turns DUE', () => {
  const now = 1_000_000;
  const t = [now + 90, now + 15 * 60, now + 32 * 60]; // 1 min -> DUE soon, then two 2-digit times
  assert.equal(timeText(t[0], now + 60), 'DUE');
  const { rows } = format(t.map((x) => ({ ln: 'GR', dest: 'Cottage', known: true, dir: 5, t: x, s: 0 })), base, { now });
  const labelEnd = 5 + measure('small', rows[0].lbl) - 1;
  const timesStart = 63 - worstTimesWidth(t, now) + 1;
  assert.ok(timesStart - labelEnd - 1 >= 3, `gap ${timesStart - labelEnd - 1}`);
  // With room, the full name is kept.
  const roomy = format([{ ln: 'GR', dest: 'Cottage', known: true, dir: 5, t: now + 600, s: 0 }], base, { now });
  assert.equal(roomy.rows[0].lbl, 'COTTAGE');
});
