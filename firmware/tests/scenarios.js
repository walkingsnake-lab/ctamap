'use strict';
// Parity scenarios: payloads and animation sequences rendered by the
// reference renderer (server/board/draw.js). firmware/tests/parity.py renders
// the same scenarios with firmware/boardlib/draw.py; every pixel must match.

const fs = require('fs');
const path = require('path');
const B = path.join(__dirname, '..', '..', 'server', 'board');
const draw = require(path.join(B, 'render'));
const { normalize, format } = require(path.join(B, 'arrivals'));
const { parseCtaTime, tzOffset } = require(path.join(B, 'time'));
const radar = require(path.join(B, 'radar'));

const quiet = { warn() {}, error() {} };
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(B, 'fixtures', 'tt-arrivals', name), 'utf8'));
const WX = { icon: 'pcloudy_day', temp: 63, word: 'PT CLOUDY', hi: 69, lo: 51 };

function payloadFrom(name, header, cfg = {}) {
  const json = fixture(name);
  const now = parseCtaTime(json.ctatt.tmst);
  const showWeather = !!cfg.wx;
  const r = format(normalize(json, { log: quiet }), { rows: [], showHeader: !!header, showWeather }, { now, alerts: new Set(cfg.alerts || []) });
  return { v: 1, now, tzo: tzOffset(now), screen: 'transit', bright: cfg.bright != null ? cfg.bright : 100, header, view: r.view, rows: r.rows, ticker: r.ticker, wx: cfg.wx || null, warn: cfg.warn || null };
}

const hexOf = (f) => Buffer.from(f.px).toString('base64');

async function radarFrames() {
  const out = {};
  const MORSE = { lat: 42.008362, lon: -87.665909 };
  for (const [stamp, mode, mapid] of [['202008102100', 'rain', '40100'], ['202202021800', 'snow', '40100'], ['202008102100', 'rain', '40450']]) {
    const st = require(path.join(B, 'stations.json')).find((s) => s.mapid === mapid);
    const loc = radar.loadLocation(mapid);
    const wld = radar.parseWld(fs.readFileSync(path.join(B, 'fixtures', 'mrms', `lcref_${stamp}.wld`), 'utf8'));
    const crop = await radar.crops(fs.createReadStream(path.join(B, 'fixtures', 'mrms', `lcref_${stamp}.png`)), wld, [{ key: 'k', lat: st.lat, lon: st.lon, width: loc.width }]);
    const { dbz, geo } = crop.get('k');
    out[`${mapid}-${stamp}`] = { bytes: radar.toFrame(dbz, geo, mode, loc).bytes, loc };
  }
  void MORSE;
  return out;
}

// Each scenario: { name, payload, frames?, renders: [{ opts, px }] } for static
// renders, or { name, steps: [{ payload, now, t, blink, px }] } for the
// transit animator (one animator across the steps).
async function build() {
  const S = [];
  const add = (name, payload, optsList, frames) => {
    const framesObj = frames ? Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, v])) : undefined;
    S.push({
      name, payload,
      frames: framesObj ? Object.fromEntries(Object.entries(framesObj).map(([k, v]) => [k, Array.from(v)])) : undefined,
      renders: optsList.map((o) => ({ opts: o, px: hexOf(draw.render(payload, { ...o, frames: framesObj })) })),
    });
  };

  // Transit, destination rows, every header/weather combination.
  for (const name of ['morse-2026-10-03-2316.json', 'belmont-2026-10-03-2316.json', 'howard-2026-10-03-2316.json', 'jefferson-park-2026-10-03-2316.json']) {
    for (const [header, wx] of [['MORSE', null], [null, null], ['MORSE', WX], [null, WX]]) {
      const p = payloadFrom(name, header, { wx });
      add(`transit ${name} header=${!!header} wx=${!!wx}`, p, [{ screen: 'transit' }, { screen: 'transit', now: p.now + 75 }, { screen: 'transit', now: p.now + 610 }]);
    }
  }
  // Chronological view (Clark/Lake with the header overflows 4 rows), alerts, schedule-based, brightness.
  const cl = payloadFrom('clark-lake-2026-10-03-2317.json', 'CLARK/LAKE', { alerts: ['GR', 'BL'] });
  add('chrono clark/lake alerts', cl, [{ screen: 'transit' }, { screen: 'transit', blink: true }, { screen: 'transit', now: cl.now + 200 }]);
  add('chrono clark/lake weather + warning', payloadFrom('clark-lake-2026-10-03-2317.json', 'CLARK/LAKE', { wx: WX, warn: { kind: 'svr', lvl: 'warning' } }), [{ screen: 'transit' }]);
  // 50%: every odd channel value lands on .5, where JS and Python rounding differ.
  add('brightness 50', payloadFrom('belmont-2026-10-03-2316.json', 'BELMONT', { wx: WX, bright: 50 }), [{ screen: 'transit' }, { screen: 'ticker' }]);
  add('dest belmont alerts blink + dim', payloadFrom('belmont-2026-10-03-2316.json', 'BELMONT', { alerts: ['BR'], bright: 40 }), [{ screen: 'transit', blink: true }, { screen: 'transit', blink: false }]);
  for (const warn of [{ kind: 'tor', lvl: 'warning' }, { kind: 'svr', lvl: 'watch' }, { kind: 'tor', lvl: 'watch' }]) {
    add(`weather row ${warn.kind} ${warn.lvl}`, payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { wx: { ...WX, icon: 'storm', word: 'STORMS', temp: -10 }, warn }), [{ screen: 'transit' }]);
  }
  for (const icon of ['sun', 'moon', 'cloudy', 'rain', 'ice', 'snow', 'fog', 'pcloudy_night']) {
    add(`weather icon ${icon}`, payloadFrom('morse-2026-10-03-2316.json', null, { wx: { ...WX, icon, word: 'X', temp: 100 } }), [{ screen: 'transit' }]);
  }
  // Full rows: times tighten to 2px gaps (KIMBALL, COTTAGE with DUE + two 2-digit times).
  {
    const t0 = 1_800_000_000;
    const full = (lbl, ln) => ({ ln, lbl, t: [t0 + 90, t0 + 15 * 60, t0 + 32 * 60], s: [0, 1, 1], a: 0 });
    const p = { v: 1, now: t0, tzo: tzOffset(t0), screen: 'transit', bright: 100, header: 'TEST', rows: [full('KIMBALL', 'BR'), full('COTTAGE', 'GR'), full('54TH', 'PK')], ticker: [], wx: null, warn: null };
    add('full rows tighten gaps', p, [{ screen: 'transit' }, { screen: 'transit', now: t0 + 31 }]);
  }
  // Overnight.
  const night = { ...payloadFrom('morse-2026-10-03-2316.json', 'MORSE'), rows: [], ticker: [] };
  add('overnight', night, [{ screen: 'transit' }]);
  add('overnight weather', { ...night, wx: WX }, [{ screen: 'transit' }]);
  // Rolls via explicit roll state are covered by the animator sequences below.

  // Ticker: pages and slides.
  const tk = payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { alerts: [] });
  tk.ticker[1] = { ...tk.ticker[1], a: 1 };
  add('ticker', tk, [0, 1, 2].flatMap((page) => [0, 0.3, 0.5, 0.8].map((slide) => ({ screen: 'ticker', page, slide }))));
  add('ticker no header', { ...tk, header: null }, [{ screen: 'ticker' }, { screen: 'ticker', now: tk.now + 400 }]);

  // Radar: frames, split layout, conditions, warnings.
  const rf = await radarFrames();
  for (const [key, { bytes, loc }] of Object.entries(rf)) {
    const t = radar.timeOf(key.split('-')[1]);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const p = { now: t, tzo: tzOffset(t), bright: 100, warn: { kind: 'svr', lvl: 'warning' }, radar: { on: true, frames: ids, ft: ids.map((_, i) => t - (5 - i) * 300), clock: loc.clock, split: loc.split } };
    add(`radar ${key}`, p, [{ screen: 'radar', idx: 5 }, { screen: 'radar', idx: 0 }, { screen: 'radar', idx: 3 }], Object.fromEntries(ids.map((id) => [id, bytes])));
  }
  for (const [clock, split] of [[radar.FULL_CLOCK, false], [radar.SPLIT_CLOCK, true]]) {
    const t = 1791140000;
    add(`radar conditions split=${split}`, { now: t, tzo: tzOffset(t), bright: 100, warn: { kind: 'tor', lvl: 'watch' }, radar: { on: false, frames: [], ft: [], clock, split, wx: { icon: 'pcloudy_day', temp: -10, word: 'PT CLOUDY', hi: 100, lo: -10 } } }, [{ screen: 'radar' }]);
  }

  // Transit animator sequences.
  const NOW = 1_800_000_000;
  const min = (m) => NOW + m * 60 - 5;
  const base = { v: 1, tzo: tzOffset(NOW), screen: 'transit', bright: 100, header: 'TEST', ticker: [], wx: null, warn: null };
  const seq = (name, steps) => {
    const anim = draw.createTransitAnimator();
    S.push({
      name,
      steps: steps.map((s) => {
        const p = { ...base, now: s.now, ...s.p };
        const view = anim.step(p, s.now, s.t);
        return { payload: p, now: s.now, t: s.t, blink: !!s.blink, px: hexOf(draw.render(p, { screen: 'transit', now: s.now, view, blink: !!s.blink })) };
      }),
    });
  };
  const ts = (from, dur, n) => Array.from({ length: n }, (_, i) => from + Math.round((dur * i) / (n - 1)));
  // Departing DUE fades; next time brightens; countdown rolls.
  {
    const p = { rows: [{ ln: 'RD', lbl: 'HOWARD', t: [NOW + 20, NOW + 7 * 60 + 58, NOW + 16 * 60 + 58], s: [0, 0, 0], a: 0 }] };
    // Includes exact halfway points (alpha 0.5, eased 0.5) where JS and Python rounding differ.
    seq('anim departing DUE', [{ p, now: NOW, t: 0 }, ...[...ts(1000, 900, 10), 1175, 1350, 1250].sort((x, y) => x - y).map((t) => ({ p, now: NOW + 55, t }))]);
    const q = { rows: [{ ln: 'RD', lbl: 'HOWARD', t: [min(12), min(20)], s: [0, 0], a: 0 }] };
    seq('anim countdown roll', [{ p: q, now: NOW, t: 0 }, ...ts(100, 450, 10).map((t) => ({ p: q, now: NOW + 60, t }))]);
  }
  // A row leaves; the others slide.
  {
    const rowsAt = (gone) => [
      { ln: 'RD', lbl: 'HOWARD', t: [min(4)], s: [0], a: 0 },
      { ln: 'RD', lbl: '95TH', t: gone ? [] : [NOW + 10], s: [0], a: 0 },
      { ln: 'BR', lbl: 'KIMBALL', t: [min(9)], s: [0], a: 1 },
    ].filter((r) => r.t.length);
    seq('anim row leaves', [{ p: { rows: rowsAt(false) }, now: NOW, t: 0 }, ...ts(1000, 1400, 14).map((t, i) => ({ p: { rows: rowsAt(true) }, now: NOW + 60, t, blink: i % 3 === 0 }))]);
  }
  // Chronological departure: slide, digits roll, next train slides in.
  {
    const row = (ln, lbl, t, rn) => ({ ln, lbl, t: [t], s: [0], a: 0, rn });
    const rows = [row('RD', 'HOWARD', NOW + 10, '801'), row('BR', 'LOOP', NOW + 4 * 60 + 50, '400'), row('PR', 'LINDEN', NOW + 7 * 60 + 50, '401'), row('RD', '95TH', NOW + 9 * 60 + 50, '402'), row('BR', 'KIMBALL', NOW + 12 * 60 + 50, '403')];
    const p = { view: 'chrono', rows };
    seq('anim chrono departure', [{ p, now: NOW, t: 0 }, ...ts(1000, 800, 12).map((t) => ({ p, now: NOW + 45, t }))]);
    // Two trains swapping order.
    const a = row('RD', 'HOWARD', min(5), '801'), b = row('RD', '95TH', min(6), '802');
    seq('anim chrono swap', [{ p: { view: 'chrono', rows: [a, b] }, now: NOW, t: 0 }, ...ts(1000, 600, 8).map((t) => ({ p: { view: 'chrono', rows: [{ ...b, t: [min(4)] }, a] }, now: NOW, t }))]);
    // Destination rows -> chronological: cross-fade.
    seq('anim view switch', [
      { p: { rows: [{ ln: 'RD', lbl: 'HOWARD', t: [min(4), min(9)], s: [0, 0], a: 0 }] }, now: NOW, t: 0 },
      ...ts(1000, 1500, 12).map((t) => ({ p: { view: 'chrono', rows: [row('RD', 'HOWARD', min(4), '801'), row('RD', 'HOWARD', min(9), '802')] }, now: NOW, t })),
    ]);
  }
  return S;
}

module.exports = { build };

if (require.main === module) {
  build().then((s) => { fs.writeFileSync(process.argv[2] || '/dev/stdout', JSON.stringify(s)); });
}
