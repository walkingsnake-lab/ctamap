'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalize, format, maxRows, chooseView, timeText, worstTimesWidth, TICKER_DEST_PX, CHRONO_EXTRA, CHRONO_HOLD } = require('./arrivals');
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

test('Clark/Lake: five destinations fit five rows; short names', () => {
  const all = run('clark-lake-2026-10-03-2317.json', { ...base, showHeader: false });
  assert.equal(all.view, 'dest');
  assert.deepEqual(all.rows.map((r) => r.lbl), ["O'HARE", 'FOREST', 'KIMBALL', 'HARLEM', '54/CRMK']);
  // The ticker's 5x7 can't fit 54/Crmk (34px of 32): it's cut to fit.
  const tk = all.ticker.find((x) => x.ln === 'PK');
  if (tk) assert.equal(tk.d, '54/Crm');
});

test('"Howard (or Loop)" before a Purple trip starts: the Howard row, or the Loop row at Howard', () => {
  // Synthetic: not yet recorded from Train Tracker (record one with api/raw/arrivals when it shows up).
  const eta = (staId, staNm, destNm, rn, min) => ({ staId, staNm, stpDe: 'Service toward Howard or Loop', rn, rt: 'P', destNm, trDr: '5',
    prdt: '2026-10-06T07:30:00', arrT: `2026-10-06T07:${String(30 + min).padStart(2, '0')}:00`, isApp: '0', isSch: '1' });
  const json = (staId, staNm) => ({ ctatt: { tmst: '2026-10-06T07:30:00', errCd: '0', eta: [
    eta(staId, staNm, 'Howard', '501', 3), eta(staId, staNm, 'Howard (or Loop)', '502', 12), eta(staId, staNm, 'Loop', '503', 20),
  ] } });
  const unknown = new Set();
  const davis = normalize(json('40050', 'Davis'), { log: { warn: () => assert.fail('logged as unknown') }, unknown });
  assert.deepEqual(davis.map((a) => a.dest), ['Howard', 'Howard', 'Loop']);
  assert.ok(davis.every((a) => a.known));
  const howard = normalize(json('40900', 'Howard'), { log: quiet });
  assert.deepEqual(howard.map((a) => a.dest), ['Loop', 'Loop'], 'ending at Howard: dropped; maybe-Loop: the Loop row');
});

test('Clark/Lake with the header: five destinations -> header and weather hidden, five rows', () => {
  const { view, rows, bars } = run('clark-lake-2026-10-03-2317.json', { ...base, showWeather: true });
  assert.equal(view, 'dest');
  assert.equal(rows.length, 5);
  assert.deepEqual(bars, { showHeader: false, showWeather: false, hidden: ['weather', 'header'] });
});

// Clark/Lake plus Orange and Purple: 7 destinations.
function clarkLakeRush() {
  const json = load('clark-lake-2026-10-03-2317.json');
  const now = nowOf(json);
  const arr = normalize(json, { log: quiet });
  arr.push({ ln: 'OR', dest: 'Midway', known: true, dir: 5, t: now + 200, s: 0, rn: '701' });
  arr.push({ ln: 'PR', dest: 'Linden', known: true, dir: 1, t: now + 260, s: 0, rn: '501' });
  return { arr, now };
}

test('more than 5 destinations -> one train per row, header kept, weather off', () => {
  const { arr, now } = clarkLakeRush();
  const { view, rows, bars } = format(arr, { ...base, showWeather: true }, { now });
  assert.equal(view, 'chrono');
  assert.deepEqual(bars, { showHeader: true, showWeather: false, hidden: ['weather'] });
  assert.equal(rows.length, 4 + CHRONO_EXTRA);
  assert.ok(rows.every((r) => r.t.length === 1 && r.s.length === 1 && r.rn));
  assert.ok(mins({ t: rows.map((r) => r.t[0]) }, now).every((m, i, a) => !i || m >= a[i - 1]));
  assert.equal(format(arr, { ...base, showHeader: false, showWeather: true }, { now }).rows.length, 5 + CHRONO_EXTRA);
});

test('fitBars: weather goes first, then the header; past 5 the header comes back', () => {
  const { fitBars } = require('./arrivals');
  const f = (n, h, w) => { const b = fitBars(n, h, w); return `${b.showHeader ? 'H' : '-'}${b.showWeather ? 'W' : '-'}`; };
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map((n) => f(n, true, true)), ['HW', 'HW', 'H-', 'H-', '--', 'H-', 'H-']);
  assert.deepEqual([1, 3, 4, 5, 6].map((n) => f(n, false, true)), ['-W', '-W', '--', '--', '--']);
  assert.deepEqual([4, 5, 6].map((n) => f(n, true, false)), ['H-', '--', 'H-']);
  assert.deepEqual([5, 6].map((n) => f(n, false, false)), ['--', '--']);
});

test('Merchandise Mart all day: the weather row comes and goes with rush-only Purple', () => {
  const now = 1_800_000_000;
  const a = (ln, dest, m, rn) => ({ ln, dest, known: true, dir: 1, t: now + m * 60, s: 0, rn });
  const offPeak = [a('BR', 'Kimball', 3, '401'), a('BR', 'Loop', 5, '402')];
  const rush = [...offPeak, a('PR', 'Linden', 4, '501'), a('PR', 'Loop', 7, '502')];
  const cfg = { ...base, showWeather: true };
  const off = format(offPeak, cfg, { now });
  assert.deepEqual([off.view, off.bars.showHeader, off.bars.showWeather], ['dest', true, true]);
  const on = format(rush, cfg, { now, prevView: off.viewState });
  assert.deepEqual([on.view, on.bars.showHeader, on.bars.showWeather, on.rows.length], ['dest', true, false, 4]);
  const back = format(offPeak, cfg, { now, prevView: on.viewState });
  assert.deepEqual([back.view, back.bars.showWeather], ['dest', true]);
});

test('row cap follows the header and weather toggles', () => {
  assert.equal(maxRows(false, false), 5);
  assert.equal(maxRows(true, false), 4);
  assert.equal(maxRows(false, true), 3);
  assert.equal(maxRows(true, true), 2);
  // Belmont's four destinations: the weather row is hidden to fit them as rows.
  const { view, rows, bars } = run('belmont-2026-10-03-2316.json', { ...base, showWeather: true });
  assert.equal(view, 'dest');
  assert.equal(rows.length, 4);
  assert.deepEqual(bars.hidden, ['weather']);
  // autoFit off: the plain cap (2 rows) and the chronological list.
  assert.equal(run('belmont-2026-10-03-2316.json', { ...base, showWeather: true, autoFit: false }).view, 'chrono');
});

test('the destination filter runs before the overflow check', () => {
  const { view, rows } = run('clark-lake-2026-10-03-2317.json', { ...base, rows: ["BL:O'Hare", 'BL:Forest', 'BR:Kimball'] });
  assert.equal(view, 'dest');
  assert.equal(rows.length, 3);
});

test('view follows the destination count: chrono on overflow, back as soon as rows fit', () => {
  assert.equal(CHRONO_HOLD, 0);
  let st = chooseView(5, 4, null, 0);
  assert.equal(st.view, 'chrono');
  assert.equal(chooseView(5, 4, st, 30).view, 'chrono');
  st = chooseView(4, 4, st, 60);
  assert.equal(st.view, 'dest');
  assert.equal(chooseView(4, 4, st, 90).view, 'dest');
});

test('with a hold time, chrono stays until rows have fit that long', () => {
  let st = chooseView(5, 4, null, 0, 600);
  st = chooseView(4, 4, st, 100, 600);
  assert.deepEqual(st, { view: 'chrono', fitSince: 100 });
  st = chooseView(4, 4, st, 699, 600);
  assert.equal(st.view, 'chrono');
  assert.equal(chooseView(5, 4, st, 400, 600).fitSince, null); // overflow again resets the clock
  assert.equal(chooseView(4, 4, st, 700, 600).view, 'dest');
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
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.ticker, []);
  assert.equal(r.view, 'dest');
});

test('labels never collide with the times, including when the first time turns DUE', () => {
  const now = 1_000_000;
  const t = [now + 90, now + 15 * 60, now + 32 * 60]; // 1 min -> DUE soon, then two 2-digit times
  assert.equal(timeText(t[0], now + 60), 'DUE');
  const { rows } = format(t.map((x) => ({ ln: 'BR', dest: 'Kimball', known: true, dir: 1, t: x, s: 0 })), base, { now });
  // With times tightened to 2px gaps, the full name fits even in this worst case.
  assert.equal(rows[0].lbl, 'KIMBALL');
  const labelEnd = 5 + measure('small', rows[0].lbl) - 1;
  const timesStart = 63 - worstTimesWidth(t, now) + 1;
  assert.ok(timesStart - labelEnd - 1 >= 3, `gap ${timesStart - labelEnd - 1}`);
  assert.equal(format([{ ln: 'GR', dest: 'Cottage', known: true, dir: 5, t: t[0], s: 0 }, { ln: 'GR', dest: 'Cottage', known: true, dir: 5, t: t[1], s: 0 }, { ln: 'GR', dest: 'Cottage', known: true, dir: 5, t: t[2], s: 0 }], base, { now }).rows[0].lbl, 'COTTAGE');
});

test('Green Line "63rd Street" is shown as 63rd', () => {
  const json = load('clark-lake-2026-10-03-2317.json');
  json.ctatt.eta[0].destNm = '63rd Street';
  const warnings = [];
  const { rows } = format(normalize(json, { log: { warn: (m) => warnings.push(m) } }), { ...base, showHeader: false }, { now: nowOf(json) });
  assert.ok(rows.some((r) => r.ln === 'GR' && r.lbl === '63RD'));
  assert.equal(warnings.length, 0);
});

test('trains ending at the station are dropped even when CTA names the destination differently', () => {
  // Ashland/63rd: arriving Green Line trains are listed with destNm "63rd Street".
  const mk = (o) => ({ staId: '40290', staNm: 'Ashland/63rd', stpDe: 'Service toward Harlem', rt: 'G', trDr: '1', arrT: '2026-10-04T01:50:00', isSch: '0', destNm: 'Harlem/Lake', ...o });
  const json = { ctatt: { tmst: '2026-10-04T01:45:00', errCd: '0', eta: [
    mk({}),
    mk({ destNm: '63rd Street', stpDe: 'Service toward 63rd', trDr: '5', arrT: '2026-10-04T01:47:00' }),
    mk({ destNm: 'Ashland/63rd', stpDe: 'Ashland/63rd (Terminal arrival)', trDr: '5', arrT: '2026-10-04T01:55:00' }),
  ] } };
  const { rows } = format(normalize(json, { log: quiet }), base, { now: nowOf(json) });
  assert.deepEqual(rows.map((r) => r.lbl), ['HARLEM']);
  // Elsewhere, "63rd Street" trains are shown normally.
  json.ctatt.eta.forEach((e) => { e.staId = '41160'; e.staNm = 'Clinton'; e.stpDe = 'Service toward 63rd'; });
  const other = format(normalize({ ctatt: { ...json.ctatt, eta: json.ctatt.eta.slice(0, 2) } }, { log: quiet }), base, { now: nowOf(json) });
  assert.deepEqual(other.rows.map((r) => r.lbl).sort(), ['63RD', 'HARLEM']);
});

test('every terminal in the destination map is a real station', () => {
  const { DEST_MAPID } = require('./destinations');
  const stations = new Map(require('./stations.json').map((s) => [s.mapid, s.name]));
  for (const [dest, mapid] of Object.entries(DEST_MAPID)) assert.ok(stations.has(mapid), `${dest} -> ${mapid}`);
});

test('DUE latch: a train that reached DUE stays DUE when the next prediction says 2 min', () => {
  const { latchDue, DUE_LATCH_MAX } = require('./arrivals');
  const { timeText } = require('./draw');
  const now = 1_000_000;
  const a = (rn, t, ln = 'RD') => ({ ln, dest: 'Howard', known: true, dir: 1, t, s: 0, rn });
  // Previous fetch: run 801 at +70 s ("2"); by this fetch, 30 s later, the board
  // has counted it down to 40 s: DUE.
  const prev = [a('801', now + 40), a('802', now + 400)];
  // CTA now says 801 is 2 min out again (whole minutes from a fresh prediction).
  const next = latchDue(prev, [a('801', now + 120), a('802', now + 370)], now);
  assert.equal(timeText(next[0].t, now), 'DUE');
  assert.equal(next[0].t, now + 60);
  assert.equal(next[1].t, now + 370); // not DUE before: untouched
  // Counting down from the held time keeps DUE until the next fetch.
  assert.equal(timeText(next[0].t, now + 25), 'DUE');
  // Still held on the next fetch if CTA keeps saying ~2 min...
  const again = latchDue(next, [a('801', now + 30 + 120)], now + 30);
  assert.equal(timeText(again[0].t, now + 30), 'DUE');
  // ...but a real delay shows minutes again.
  const delayed = latchDue(next, [a('801', now + 30 + DUE_LATCH_MAX + 60)], now + 30);
  assert.equal(timeText(delayed[0].t, now + 30), '4');
  // Same run number on another line is a different train.
  assert.equal(latchDue(prev, [a('801', now + 120, 'BL')], now)[0].t, now + 120);
  // First fetch: nothing to compare.
  assert.equal(latchDue(null, [a('801', now + 120)], now)[0].t, now + 120);
});

test('DUE latch: a train that goes DUE before the board sees this fetch never jumps back to 2', () => {
  const { latchDue } = require('./arrivals');
  const { timeText } = require('./draw');
  const now = 1_000_000;
  const a = (rn, t) => ({ ln: 'RD', dest: 'Howard', known: true, dir: 1, t, s: 0, rn });
  // At this fetch 801 is 70 s out ("2"); the board shows DUE 10 s later,
  // but this fetch's "2 min" only reaches it up to 60 s later.
  const prev = [a('801', now + 70), a('802', now + 200)];
  const next = latchDue(prev, [a('801', now + 120), a('802', now + 250)], now);
  assert.equal(next[0].t, now + 70, 'no later than before');
  for (let r = now; r <= now + 60; r += 5) {
    const shown = timeText(prev[0].t, r);
    if (shown === 'DUE') assert.equal(timeText(next[0].t, r), 'DUE', `payload landing at +${r - now} s`);
  }
  // An earlier new prediction is kept as is.
  assert.equal(latchDue(prev, [a('801', now + 50)], now)[0].t, now + 50);
});

test('times only count down: a slip of under a minute keeps the previous time; a bigger one shows', () => {
  const { latchDue, SLIP_S } = require('./arrivals');
  const { timeText } = require('./draw');
  const now = 1_000_000;
  const a = (rn, t) => ({ ln: 'RD', dest: 'Howard', known: true, dir: 1, t, s: 0, rn });
  const prev = [a('801', now + 400), a('802', now + 900)];
  // 801 at 6:40 shows 7; CTA's fresh "8 min" is 40 s later: still 7, counting down.
  const next = latchDue(prev, [a('801', now + 440), a('802', now + 900 + SLIP_S)], now);
  assert.equal(next[0].t, now + 400);
  assert.equal(timeText(next[0].t, now + 25), '7');
  // 802 slipped a full minute: a real delay.
  assert.equal(next[1].t, now + 900 + SLIP_S);
  // Each fetch compares with the time it kept, so a slow drift shows once it adds up.
  assert.equal(latchDue(next, [a('801', now + 30 + 440)], now + 30)[0].t, now + 400 + 30 + 40);
});

test('tracker applies the DUE latch between fetches', async () => {
  const { createTracker } = require('./tracker');
  let t = 1_791_000_000; // Oct 2026 (CDT, matching the -5 h below)
  const tmst = (s) => { const d = new Date((s - 5 * 3600) * 1000); return d.toISOString().slice(0, 19); };
  const resp = (arr) => ({ status: 200, body: JSON.stringify({ ctatt: { tmst: tmst(t), errCd: '0', eta: [{ staId: '40100', staNm: 'Morse', stpDe: 'Service toward Howard', rn: '801', rt: 'Red', destNm: 'Howard', trDr: '1', arrT: tmst(arr), isSch: '0' }] } }) });
  let next = t + 70;
  const tr = createTracker({ fetchRaw: async () => resp(next), now: () => t, log: quiet });
  const first = (await tr.get('40100')).arrivals[0].t;
  t += 30; next = t + 120; // board has counted 801 to 40 s (DUE); CTA says 2 min
  tr.pass();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));
  const second = (await tr.get('40100')).arrivals[0].t;
  assert.ok(Math.abs(first - (t - 30 + 70)) <= 1);
  assert.equal(second, t + 60);
});
