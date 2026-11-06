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
const { toSkyline } = require(path.join(B, 'skyline'));
const { stripBytes } = require(path.join(B, 'clouds'));

const quiet = { warn() {}, error() {} };
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(B, 'fixtures', 'tt-arrivals', name), 'utf8'));
const WX = { icon: 'pcloudy_day', temp: 63, word: 'PT CLOUDY', hi: 69, lo: 51 };

function payloadFrom(name, header, cfg = {}) {
  const json = fixture(name);
  const now = parseCtaTime(json.ctatt.tmst);
  const showWeather = !!cfg.wx;
  const r = format(normalize(json, { log: quiet }), { rows: [], showHeader: !!header, showWeather, showKey: !!cfg.key }, { now, alerts: new Set(cfg.alerts || []) });
  const key = r.bars.showKey ? { key: 1 } : {};
  return { v: 1, now, tzo: tzOffset(now), screen: 'transit', bright: cfg.bright != null ? cfg.bright : 100, header: r.bars.showHeader ? header : null, ...key, view: r.view, rows: r.rows, ticker: r.ticker, wx: r.bars.showWeather ? cfg.wx || null : null, warn: cfg.warn || null };
}

const hexOf = (f) => Buffer.from(f.px).toString('base64');

async function radarFrames() {
  const out = {};
  const MORSE = { lat: 42.008362, lon: -87.665909 };
  for (const [stamp, mode, mapid] of [['202008102100', 'rain', '40100'], ['202202021800', 'snow', '40100'], ['202008102100', 'rain', '40450'], ['202610041600', 'rain', '41450']]) {
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
//
// Two renderers are checked against these: firmware-s3's draw.cpp (the S3,
// current) and firmware's draw.py (the M4, frozen). A scenario for a draw.js
// change made after the freeze gets `s3only: true`, and so does an existing
// one whose pixels such a change alters: draw.py skips those.
async function build() {
  const S = [];
  const arrays = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.from(v)])) : undefined);
  // extra: { s3only: true } for scenarios the frozen M4 renderer skips.
  // Transit rows on a line with a CTA alert changed after the freeze (the
  // label, shortened if needed, then the red alert circle; the M4 still dims
  // the block under a "!"), so any scenario with one is S3 only.
  const alerted = (p) => (p.rows || []).some((r) => r.a);
  const add = (name, payload, optsList, frames, logos, extra = {}) => {
    const { clouds, ...rest } = extra;
    S.push({
      ...(alerted(payload) ? { s3only: true } : {}),
      ...rest,
      name, payload,
      frames: arrays(frames),
      logos: arrays(logos),
      ...(clouds ? { clouds: arrays(clouds) } : {}),
      renders: optsList.map((o) => ({ opts: o, px: hexOf(draw.render(payload, { ...o, frames, logos, clouds })) })),
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
  // Options: no header clock, line-colored labels (dest and chrono), ticker header.
  const mo = payloadFrom('morse-2026-10-03-2316.json', 'MORSE');
  add('options: no header clock, line-colored names (dest)', { ...mo, hclock: false, lnc: true }, [{ screen: 'transit' }, { screen: 'ticker' }]);
  add('options: time dim steps (dest)', { ...mo, ts: true }, [{ screen: 'transit' }, { screen: 'transit', now: mo.now + 75 }]);
  add('options: line-colored names (chrono)', { ...cl, lnc: true }, [{ screen: 'transit' }]);
  add('options: no header clock (chrono)', { ...cl, hclock: false }, [{ screen: 'transit' }, { screen: 'ticker' }]);
  add('chrono clark/lake weather + warning', payloadFrom('clark-lake-2026-10-03-2317.json', 'CLARK/LAKE', { wx: WX, warn: { kind: 'svr', lvl: 'warning' } }), [{ screen: 'transit' }]);
  // 50%: every odd channel value lands on .5, where JS and Python rounding differ.
  // Header divider line (dest and chrono views).
  for (const [name, hdr] of [['belmont-2026-10-03-2316.json', 'BELMONT'], ['clark-lake-2026-10-03-2317.json', 'CLARK/LAKE']]) {
    const p = { ...payloadFrom(name, hdr, { wx: WX }), headerDivider: true };
    add(`dividers ${hdr}`, p, [{ screen: 'transit' }, { screen: 'transit', blink: true }]);
  }
  add('brightness 50', payloadFrom('belmont-2026-10-03-2316.json', 'BELMONT', { wx: WX, bright: 50 }), [{ screen: 'transit' }, { screen: 'ticker' }]);
  // Key layout: key + station line (Morse, 2 rows; Howard), station line hidden (Belmont, 4
  // rows), key hidden (Clark/Lake as dest rows needs 5), chrono with the key,
  // no station clock, alerts, dim.
  for (const [name, hdr] of [['morse-2026-10-03-2316.json', 'MORSE'], ['howard-2026-10-03-2316.json', 'HOWARD'], ['belmont-2026-10-03-2316.json', 'BELMONT'], ['jefferson-park-2026-10-03-2316.json', 'JEFFERSON PK']]) {
    const p = payloadFrom(name, hdr, { key: true, alerts: ['RD', 'BL'] });
    add(`key layout ${hdr}`, p, [{ screen: 'transit' }, { screen: 'transit', now: p.now + 75 }]);
  }
  add('key layout chrono', payloadFrom('clark-lake-2026-10-03-2317.json', 'CLARK/LAKE', { key: true, alerts: ['GR'] }), [{ screen: 'transit' }]);
  add('key layout 3 rows no clock dim', { ...payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { key: true }), rows: payloadFrom('belmont-2026-10-03-2316.json', null).rows.slice(0, 3), hclock: false, bright: 40 }, [{ screen: 'transit' }]);
  add('dest belmont alerts blink + dim', payloadFrom('belmont-2026-10-03-2316.json', 'BELMONT', { alerts: ['BR'], bright: 40 }), [{ screen: 'transit', blink: true }, { screen: 'transit', blink: false }]);
  // Alert labels: cut to fit the circle with three times (HOWA, KIMB), whole
  // with fewer (95TH, LOOP); line-colored names; header hidden.
  const ba = payloadFrom('belmont-2026-10-03-2316.json', 'BELMONT', { alerts: ['RD', 'BR'] });
  add('dest alert labels', ba, [{ screen: 'transit' }, { screen: 'transit', now: ba.now + 75 }]);
  add('dest alert labels, line-colored names', { ...ba, lnc: true, header: null }, [{ screen: 'transit' }]);
  for (const warn of [{ kind: 'tor', lvl: 'warning' }, { kind: 'svr', lvl: 'watch' }, { kind: 'tor', lvl: 'watch' }]) {
    add(`weather strip ${warn.kind} ${warn.lvl}`, payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { wx: { ...WX, icon: 'storm', word: 'STORMS', temp: -10 }, warn }), [{ screen: 'transit' }, { screen: 'transit', blink: true }]);
  }
  for (const icon of ['sun', 'moon', 'cloudy', 'rain', 'ice', 'snow', 'fog', 'pcloudy_night', 'tsnow']) {
    add(`weather icon ${icon}`, payloadFrom('morse-2026-10-03-2316.json', null, { wx: { ...WX, icon, word: 'X', temp: 100 } }), [{ screen: 'transit' }]);
  }
  // Full rows: times tighten to 2px gaps (KIMBALL, COTTAGE with DUE + two 2-digit times).
  {
    const t0 = 1_800_000_000;
    const full = (lbl, ln) => ({ ln, lbl, t: [t0 + 90, t0 + 15 * 60, t0 + 32 * 60], s: [0, 1, 1], a: 0 });
    const p = { v: 1, now: t0, tzo: tzOffset(t0), screen: 'transit', bright: 100, header: 'TEST', rows: [full('KIMBALL', 'BR'), full('COTTAGE', 'GR'), full('54TH', 'PK')], ticker: [], wx: null, warn: null };
    add('full rows tighten gaps', p, [{ screen: 'transit' }, { screen: 'transit', now: t0 + 31 }]);
  }
  // Bunched trains: only the soonest of a destination reads DUE; the next shows 2.
  {
    const t0 = 1791140000;
    const base = { v: 1, now: t0, tzo: tzOffset(t0), screen: 'transit', bright: 100, header: 'TEST', wx: null, warn: null };
    const dest = { ...base, rows: [{ ln: 'RD', lbl: 'HOWARD', t: [t0 + 20, t0 + 45, t0 + 400], s: [0, 0, 0], a: 0 }, { ln: 'RD', lbl: '95TH', t: [t0 + 50, t0 + 600], s: [0, 0], a: 0 }], ticker: [] };
    add('bunched trains', dest, [{ screen: 'transit' }, { screen: 'transit', now: t0 + 30 }]);
    const chrono = { ...base, view: 'chrono', rows: [{ ln: 'RD', lbl: 'HOWARD', t: [t0 + 20], s: [0], a: 0 }, { ln: 'RD', lbl: 'HOWARD', t: [t0 + 45], s: [0], a: 0 }, { ln: 'RD', lbl: '95TH', t: [t0 + 55], s: [0], a: 0 }, { ln: 'BR', lbl: 'LOOP', t: [t0 + 400], s: [0], a: 0 }], ticker: [] };
    add('bunched chrono', chrono, [{ screen: 'transit' }]);
    const tkr = { ...base, rows: [], ticker: [{ ln: 'RD', d: 'Howard', t: t0 + 20, s: 0, a: 0 }, { ln: 'RD', d: 'Howard', t: t0 + 45, s: 0, a: 0 }, { ln: 'RD', d: '95th', t: t0 + 50, s: 0, a: 0 }, { ln: 'RD', d: '95th', t: t0 + 400, s: 0, a: 0 }] };
    add('bunched ticker', tkr, [{ screen: 'ticker' }]);
  }
  // Overnight.
  const night = { ...payloadFrom('morse-2026-10-03-2316.json', 'MORSE'), rows: [], ticker: [] };
  // The overnight owl came after the freeze (the M4 keeps the plain clock).
  const owl = { s3only: true };
  add('overnight', night, [{ screen: 'transit' }], undefined, undefined, owl);
  add('overnight weather', { ...night, wx: WX }, [{ screen: 'transit' }], undefined, undefined, owl);
  add('no data', { ...night, stale: 1 }, [{ screen: 'transit' }], undefined, undefined, owl);
  add('no data weather', { ...night, stale: 1, wx: WX }, [{ screen: 'transit' }], undefined, undefined, owl);
  // The owl's frames on the icon clock (open, blink, glance; wraps around).
  add('overnight owl frames', night, [0, 4050, 7300, 9000, 11400, 15000].map((iconT) => ({ screen: 'transit', iconT })), undefined, undefined, owl);
  add('overnight owl frames no data', { ...night, stale: 1, wx: WX }, [4050, 7300].map((iconT) => ({ screen: 'transit', iconT })), undefined, undefined, owl);
  add('stale', { ...payloadFrom('morse-2026-10-03-2316.json', 'MORSE'), stale: 1 }, [{ screen: 'transit' }, { screen: 'ticker' }, { screen: 'ticker', page: 1, slide: 0.5 }]);
  // Rolls via explicit roll state are covered by the animator sequences below.

  // Ticker: pages and slides.
  const tk = payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { alerts: [] });
  tk.ticker[1] = { ...tk.ticker[1], a: 1 };
  add('ticker', tk, [0, 1, 2].flatMap((page) => [0, 0.3, 0.5, 0.8].map((slide) => ({ screen: 'ticker', page, slide }))));
  add('ticker no header', { ...tk, header: null }, [{ screen: 'ticker' }, { screen: 'ticker', now: tk.now + 400 }]);
  // Latin-1 and General Punctuation glyphs (S3 only: the M4's fonts are ASCII).
  const ext = { ...tk, header: 'É—“Ñ”…€', ticker: tk.ticker.map((x, i) => (i === 0 ? { ...x, d: 'Café’s' } : i === 2 ? { ...x, d: '¿Qué–ño?' } : x)) };
  add('extended glyphs', ext, [{ screen: 'ticker' }, { screen: 'ticker', page: 1 }], undefined, undefined, { s3only: true });
  // Transit header hidden to fit; the ticker keeps its own.
  add('ticker header kept', { ...tk, header: null, tickerHeader: 'MORSE' }, [{ screen: 'ticker' }]);
  add('ticker fill 30%', { ...tk, tickerFill: 30 }, [{ screen: 'ticker' }, { screen: 'ticker', page: 1, slide: 0.5 }]);
  add('ticker header off', { ...tk, header: 'MORSE', tickerHeader: null }, [{ screen: 'ticker' }]);

  // Radar: frames, split layout, conditions, warnings.
  const rf = await radarFrames();
  for (const [key, { bytes, loc }] of Object.entries(rf)) {
    const t = radar.timeOf(key.split('-')[1]);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const p = { now: t, tzo: tzOffset(t), bright: 100, warn: { kind: 'svr', lvl: 'warning' }, radar: { on: true, frames: ids, ft: ids.map((_, i) => t - (5 - i) * 300), timeBox: loc.timeBox, split: loc.split } };
    add(`radar ${key}`, p, [{ screen: 'weather', idx: 5 }, { screen: 'weather', idx: 0 }, { screen: 'weather', idx: 3 }], Object.fromEntries(ids.map((id) => [id, bytes])));
    add(`radar ${key} temperature`, { ...p, radar: { ...p.radar, showTime: false, temp: 63, icon: 'sun' } }, [{ screen: 'weather', idx: 5 }], Object.fromEntries(ids.map((id) => [id, bytes])));
  }
  // Clock rolls (opts.nums: {name: {from, p}}): per-digit when the shape
  // holds, the whole clock when its width changes. Names the renderer
  // doesn't roll (overnight and no-games clocks, temperatures) draw still.
  {
    const ps = [0.25, 0.5, 0.75];
    const nums = (o) => ps.map((p) => Object.fromEntries(Object.entries(o).map(([k, from]) => [k, { from, p }])));
    const hdr = payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { wx: WX });
    add('rolls header clock', hdr, nums({ 'hdr.clock': '11:15', 'row.temp': '62°' }).map((n) => ({ screen: 'transit', nums: n })));
    add('rolls header clock width change', hdr, nums({ 'hdr.clock': '12:59' }).map((n) => ({ screen: 'transit', nums: n })));
    add('rolls ticker header clock', hdr, nums({ 'hdr.clock': '11:15' }).map((n) => ({ screen: 'ticker', nums: n })));
    const nt = { ...payloadFrom('morse-2026-10-03-2316.json', 'MORSE'), rows: [], ticker: [], wx: WX };
    add('rolls overnight clock stays still', nt, nums({ 'night.clock': '11:15' }).map((n) => ({ screen: 'transit', nums: n })), undefined, undefined, { s3only: true });
    const [key, { bytes, loc }] = Object.entries(rf)[0];
    const rt = radar.timeOf(key.split('-')[1]);
    const ids = ['a', 'b', 'c'];
    const rp = (extra) => ({ now: rt, tzo: tzOffset(rt), bright: 100, warn: { kind: 'svr', lvl: 'warning' }, radar: { on: true, frames: ids, ft: ids.map((_, i) => rt - (2 - i) * 360), timeBox: loc.timeBox, split: loc.split, clock: 'now', ...extra } });
    const fr = Object.fromEntries(ids.map((id) => [id, bytes]));
    const radarNums = nums({ 'rad.clock': '12:59', 'rad.temp': '9°' });
    add('rolls radar current time', rp(), radarNums.map((n) => ({ screen: 'weather', idx: 2, nums: n })), fr);
    add('rolls radar current time + conditions', rp({ cond: true, temp: 63 }), nums({ 'rad.clock': '3:59' }).map((n) => ({ screen: 'weather', idx: 2, nums: n })), fr);
    add('rolls radar frame time stays put', rp({ clock: 'frame' }), radarNums.map((n) => ({ screen: 'weather', idx: 2, nums: n })), fr);
    // S3 only: the big clocks and current-conditions numbers roll too.
    const s3 = { s3only: true };
    add('rolls big overnight clock', nt, nums({ 'big.clock': '11:15' }).map((n) => ({ screen: 'transit', nums: n })), undefined, undefined, s3);
    add('rolls big overnight clock width change', nt, nums({ 'big.clock': '9:59' }).map((n) => ({ screen: 'transit', nums: n })), undefined, undefined, s3);
    add('rolls no-games clock', { ...nt, mlb: { games: [] } }, nums({ 'big.clock': '11:15' }).map((n) => ({ screen: 'baseball', nums: n })), undefined, undefined, s3);
    // Clock rolls off (croll false): clocks draw still, the temperature still rolls.
    add('rolls off: header clock still, temperature rolls', { ...hdr, croll: false }, nums({ 'hdr.clock': '11:15', 'wx.temp': '62°' }).map((n) => ({ screen: 'transit', nums: n })), undefined, undefined, s3);
    add('rolls off: radar current time still', { ...rp(), croll: false }, radarNums.map((n) => ({ screen: 'weather', idx: 2, nums: n })), fr, undefined, s3);
    add('rolls weather strip temperature', hdr, nums({ 'wx.temp': '62°' }).map((n) => ({ screen: 'transit', nums: n })), undefined, undefined, s3);
    add('rolls weather strip temperature width change', hdr, nums({ 'wx.temp': '9°' }).map((n) => ({ screen: 'transit', nums: n })), undefined, undefined, s3);
    const wxs = { icon: 'pcloudy_day', temp: 63, word: 'PT CLOUDY', hi: 69, lo: 51, feels: 61, wind: 'NW 12', pop: 20, rl: 1 };
    const wp = (w, extra) => ({ now: rt, tzo: tzOffset(rt), bright: 100, warn: null, radar: { on: false, frames: [], ft: [], timeBox: radar.FULL_TIME_BOX, split: false, wx: w, ...extra } });
    add('rolls weather screen numbers', wp(wxs), nums({ 'wx.top': '62', 'wx.feels': '59°', 'wx.pop': '10%' }).map((n) => ({ screen: 'weather', nums: n })), undefined, undefined, s3);
    add('rolls weather screen numbers width change + shadow', wp({ ...wxs, temp: 100 }, { tempShadow: true }), nums({ 'wx.top': '99', 'wx.pop': '100%' }).map((n) => ({ screen: 'weather', nums: n })), undefined, undefined, s3);
    const fd = [['SA', 71, 'sun'], ['SU', 78, 'sun'], ['MO', 66, 'rain'], ['TU', 52, 'cloudy'], ['WE', 60, 'pcloudy_day']].map(([d, hi, icon]) => ({ d, hi, icon }));
    add('rolls top bar temperature', wp({ ...wxs, days: fd }, { tempShadow: true }), nums({ 'wx.top': '62' }).map((n) => ({ screen: 'weather', nums: n })), undefined, undefined, s3);
  }
  // Weather screen conditions (radar screen with no frames; the readout,
  // S3 only since the frozen M4 keeps the old layout): every warning, with
  // and without the RAIN line (rl), cold/hot extremes, every sky color,
  // celsius, the longest word, and a response without the extras.
  {
    const t = 1791140000;
    const wx = { icon: 'pcloudy_day', temp: 57, word: 'PT CLOUDY', hi: 63, lo: 49, feels: 53, wind: 'NW 12', pop: 20, rl: 1 };
    const wxCases = [
      ['normal', wx, null],
      ['no rain line', { ...wx, rl: undefined }, null],
      ['rain line without pop', { ...wx, pop: null }, null],
      ['svr watch', wx, { kind: 'svr', lvl: 'watch' }],
      ['svr warning', wx, { kind: 'svr', lvl: 'warning' }],
      ['tor watch', wx, { kind: 'tor', lvl: 'watch' }],
      ['tor warning', wx, { kind: 'tor', lvl: 'warning' }],
      ['cold', { icon: 'snow', temp: -12, word: 'SNOW', hi: -3, lo: -21, feels: -31, wind: 'NW 22', pop: 100, rl: 1 }, null],
      ['hot', { icon: 'sun', temp: 101, word: 'SUNNY', hi: 103, lo: 82, feels: 112, wind: 'CALM', pop: 0 }, null],
      ['rain', { icon: 'rain', temp: 41, word: 'RAIN', hi: 44, lo: 38, feels: 34, wind: 'E 18', pop: 90, rl: 1 }, null],
      ['ice', { icon: 'ice', temp: 31, word: 'FRZ RAIN', hi: 33, lo: 28, feels: 22, wind: 'NE 15', pop: 80, rl: 1 }, null],
      ['night', { icon: 'moon', temp: 72, word: 'CLEAR', hi: 84, lo: 68, feels: 72, wind: 'S 5', pop: 0 }, null],
      ['thundersnow', { icon: 'tsnow', temp: 30, word: 'THNDRSNOW', hi: 32, lo: 25, feels: 19, wind: 'N 25', pop: 100, rl: 1 }, null],
      ['celsius', { icon: 'cloudy', temp: 11, word: 'CLOUDY', hi: 13, lo: 6, feels: 9, wind: 'W 8', pop: 30, rl: 1, c: 1 }, null],
      ['no extras', { icon: 'moon', temp: 48, word: 'CLEAR', hi: 61, lo: 44, feels: null, wind: null, pop: null }, null],
    ];
    for (const [name, w, warn] of wxCases) {
      add(`weather screen ${name}`, { now: t, tzo: tzOffset(t), bright: 100, warn, radar: { on: false, frames: [], ft: [], timeBox: radar.FULL_TIME_BOX, split: false, wx: w } }, [{ screen: 'weather' }, { screen: 'weather', blink: true }], undefined, undefined, { s3only: true });
    }
    // 5-day layout: wx with `days`; three-character highs draw tight; fewer
    // than five days; a warning falls back to the conditions layout.
    const days = (list) => list.map(([d, hi, icon]) => ({ d, hi, icon }));
    const fiveDay = [
      ['normal', { ...wx, days: days([['SA', 71, 'sun'], ['SU', 78, 'sun'], ['MO', 66, 'rain'], ['TU', 52, 'cloudy'], ['WE', 60, 'pcloudy_day']]) }, null],
      ['heat', { ...wx, icon: 'sun', temp: 97, hi: 101, lo: 82, days: days([['SA', 99, 'sun'], ['SU', 104, 'sun'], ['MO', 100, 'pcloudy_day'], ['TU', 92, 'storm'], ['WE', 86, 'pcloudy_day']]) }, null],
      ['cold', { ...wx, icon: 'moon', temp: -8, hi: 2, lo: -14, days: days([['SA', -3, 'snow'], ['SU', -12, 'sun'], ['MO', -6, 'ice'], ['TU', 9, 'fog'], ['WE', 21, 'cloudy']]) }, null],
      ['high/low condensed', { ...wx, icon: 'snow', temp: -12, hi: -1, lo: -10, days: days([['SA', -12, 'snow']]) }, null],
      ['high/low no space', { ...wx, icon: 'snow', temp: -15, hi: -10, lo: -24, days: days([['SA', -12, 'snow']]) }, null],
      ['high/low without arrows', { ...wx, icon: 'snow', temp: -15, hi: -100, lo: -100, days: days([['SA', -12, 'snow']]) }, null],
      ['three days', { ...wx, days: days([['TH', 45, 'pcloudy_day'], ['FR', 39, 'snow'], ['SA', 50, 'storm']]) }, null],
      ['tor warning', { ...wx, days: days([['SA', 71, 'sun']]) }, { kind: 'tor', lvl: 'warning' }],
    ];
    for (const [name, w, warn] of fiveDay) {
      add(`weather 5-day ${name}`, { now: t, tzo: tzOffset(t), bright: 100, warn, radar: { on: false, frames: [], ft: [], timeBox: radar.FULL_TIME_BOX, split: false, wx: w } }, [{ screen: 'weather' }, { screen: 'weather', blink: true }]);
    }
    // The top bar follows the board's temperature shadow setting, and carries warnings (steady).
    for (const [name, w, warn] of [['shadow', fiveDay[0][1], null], ['shadow + watch', fiveDay[1][1], { kind: 'svr', lvl: 'watch' }], ['shadow + tornado warning', fiveDay[0][1], { kind: 'tor', lvl: 'warning' }]]) {
      add(`weather 5-day ${name}`, { now: t, tzo: tzOffset(t), bright: 100, warn, radar: { on: false, frames: [], ft: [], timeBox: radar.FULL_TIME_BOX, split: false, tempShadow: true, wx: w } }, [{ screen: 'weather' }, { screen: 'weather', blink: true }]);
    }
    // Hourly layout: three-character temperatures, night icons, long labels.
    const hrs = (list) => list.map(([h, icon, tt]) => ({ h, icon, t: tt }));
    for (const [name, w, warn] of [
      ['normal', { ...wx, hours: hrs([['3P', 'sun', 78], ['6P', 'cloudy', 76], ['9P', 'pcloudy_night', 69], ['12A', 'moon', 63]]) }],
      ['extremes', { ...wx, temp: 97, hi: 101, lo: 82, hours: hrs([['10P', 'storm', 104], ['1A', 'fog', 100], ['4A', 'ice', -12], ['7A', 'snow', -3]]) }],
      ['tor warning', { ...wx, hours: hrs([['3P', 'sun', 78], ['6P', 'cloudy', 76], ['9P', 'moon', 69], ['12A', 'moon', 63]]) }, { kind: 'tor', lvl: 'warning' }],
    ]) {
      add(`weather hourly ${name}`, { now: t, tzo: tzOffset(t), bright: 100, warn: warn || null, radar: { on: false, frames: [], ft: [], timeBox: radar.FULL_TIME_BOX, split: false, wx: w } }, [{ screen: 'weather' }, { screen: 'weather', blink: true }]);
    }
    // Celsius (board tempUnit 'C', wx.c): temperatures arrive converted; the
    // colors convert back to °F with integer math (shadow, days, hours).
    const cWx = { ...wx, c: 1, icon: 'snow', temp: -7, hi: -2, lo: -12, feels: -13 };
    for (const [name, w] of [
      ['conditions', cWx],
      ['5-day', { ...cWx, days: days([['SA', -1, 'snow'], ['SU', 4, 'sun'], ['MO', 12, 'rain'], ['TU', 22, 'cloudy'], ['WE', 38, 'sun']]) }],
      ['hourly', { ...cWx, hours: hrs([['3P', 'snow', -1], ['6P', 'cloudy', -5], ['9P', 'moon', -9], ['12A', 'moon', -11]]) }],
    ]) {
      add(`weather celsius ${name}`, { now: t, tzo: tzOffset(t), bright: 100, warn: null, radar: { on: false, frames: [], ft: [], timeBox: radar.FULL_TIME_BOX, split: false, tempShadow: true, wx: w } }, [{ screen: 'weather' }], undefined, undefined, name === 'conditions' ? { s3only: true } : {});
    }
  }

  // Radar time off: icon + temperature, WATCH/WARN tag bottom right (tornado warning blinks).
  for (const [timeBox, split] of [[radar.FULL_TIME_BOX, false], [radar.SPLIT_TIME_BOX, true]]) {
    const t = 1791140000;
    const ids = ['a', 'b', 'c'];
    const frames = Object.fromEntries(ids.map((id) => [id, new Uint8Array(2048).fill(3)]));
    const r = { on: true, frames: ids, ft: ids.map((_, i) => t - (2 - i) * 300), timeBox, split, showTime: false, temp: split ? -12 : 63, icon: split ? 'snow' : 'pcloudy_day' };
    for (const warn of [{ kind: 'tor', lvl: 'warning' }, { kind: 'tor', lvl: 'watch' }, { kind: 'svr', lvl: 'warning' }]) {
      add(`radar time off split=${split} ${warn.kind} ${warn.lvl}`, { now: t, tzo: tzOffset(t), bright: 100, warn, radar: r }, [{ screen: 'weather', idx: 2 }, { screen: 'weather', idx: 0, blink: true }], frames);
    }
    add(`radar time off split=${split} no temp, no icon`, { now: t, tzo: tzOffset(t), bright: 100, warn: null, radar: { ...r, temp: null } }, [{ screen: 'weather', idx: 2 }], frames);
    add(`radar time on split=${split} tornado warning blink`, { now: t, tzo: tzOffset(t), bright: 100, warn: { kind: 'tor', lvl: 'warning' }, radar: { ...r, showTime: true } }, [{ screen: 'weather', idx: 2 }, { screen: 'weather', idx: 2, blink: true }], frames);
    // Current-time clock and the conditions layout (-12: the widest temperature;
    // t + 3600 is 12:13 PM, the widest time).
    add(`radar clock now + conditions split=${split} svr warning`, { now: t, tzo: tzOffset(t), bright: 100, warn: { kind: 'svr', lvl: 'warning' }, radar: { ...r, showTime: true, clock: 'now', cond: true } }, [{ screen: 'weather', idx: 0, now: t + 3600 }, { screen: 'weather', idx: 2 }], frames);
    add(`radar frame clock + conditions split=${split} tornado blink`, { now: t, tzo: tzOffset(t), bright: 100, warn: { kind: 'tor', lvl: 'warning' }, radar: { ...r, showTime: true, cond: true } }, [{ screen: 'weather', idx: 1 }, { screen: 'weather', idx: 1, blink: true }], frames);
    // Frame age ("3m") and no corner at all, with and without a warning tag.
    add(`radar clock age split=${split} svr watch`, { now: t, tzo: tzOffset(t), bright: 100, warn: { kind: 'svr', lvl: 'watch' }, radar: { ...r, showTime: true, clock: 'age' } }, [{ screen: 'weather', idx: 0 }, { screen: 'weather', idx: 2 }, { screen: 'weather', idx: 2, now: t + 3000 }], frames);
    add(`radar clock age split=${split}`, { now: t, tzo: tzOffset(t), bright: 100, warn: null, radar: { ...r, showTime: true, clock: 'age' } }, [{ screen: 'weather', idx: 1 }], frames);
    add(`radar clock none split=${split} tornado blink`, { now: t, tzo: tzOffset(t), bright: 100, warn: { kind: 'tor', lvl: 'warning' }, radar: { ...r, showTime: true, clock: 'none' } }, [{ screen: 'weather', idx: 1 }, { screen: 'weather', idx: 1, blink: true }], frames);
    add(`radar clock none split=${split}`, { now: t, tzo: tzOffset(t), bright: 100, warn: null, radar: { ...r, showTime: true, clock: 'none' } }, [{ screen: 'weather', idx: 1 }], frames);
    add(`radar brightness 60 split=${split}`, { now: t, tzo: tzOffset(t), bright: 100, warn: null, radar: { ...r, showTime: true, rb: 60 } }, [{ screen: 'weather', idx: 1 }], Object.fromEntries(ids.map((id, i) => [id, Uint8Array.from({ length: 2048 }, (_, k) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10][(k + i) % 11])])));
    add(`radar conditions without temp split=${split}`, { now: t, tzo: tzOffset(t), bright: 100, warn: null, radar: { ...r, showTime: true, clock: 'now', cond: true, temp: null } }, [{ screen: 'weather', idx: 1 }], frames);
  }
  // Weather row: tornado warning tag blinks.
  {
    const p = payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { wx: WX, warn: { kind: 'tor', lvl: 'warning' } });
    add('weather row tornado warning blink', p, [{ screen: 'transit' }, { screen: 'transit', blink: true }]);
  }

  // Baseball logo and band layouts: synthetic logo crops (not team art).
  {
    const t = 1791140000;
    const crop = (seed) => Uint8Array.from({ length: 864 }, (_, i) => ((Math.floor(i / 3) * seed) % 24) * 10 + (i % 3) * 5); // 24 colors, like a real crop
    const logos = { 'CHC-1': crop(7), 'STL-1': crop(13) };
    const side = (ab, c, lg, bd, extra) => ({ ab, c, lg, bd, ...extra });
    const game = (st, extra) => ({ id: 9, st, start: t - 3600,
      away: side('CHC', '#2a5bd8', 'CHC-1', '#204882', { r: 3, w: 92, l: 70 }),
      home: side('STL', '#d62a2a', null, '#c12626', { r: 12, w: 88, l: 74 }), ...extra });
    const lightHome = side('ATL', '#ce1141', null, '#d5d7d9', { r: 4, w: 90, l: 72 });
    const bbp = (layout, ...games) => ({ now: t, tzo: tzOffset(t), bright: 100, screen: 'baseball', mlb: { layout, dim: 0.9, games } });
    const live = game('live', { inn: 7, half: 'T', b: 2, s: 1, o: 2, on: [1, 0, 1] });
    for (const layout of ['logos', 'bands']) {
      add(`baseball ${layout} live`, bbp(layout, live), [{ screen: 'baseball' },
        { screen: 'baseball', rolls: { away: { from: '2', p: 0.4 }, home: { from: '11', p: 0.6 }, inn: { from: 'MID 6', p: 0.5 } } }], undefined, logos);
      add(`baseball ${layout} flash`, bbp(layout, { ...live, away: { ...live.away, at: t - 10 } }), [{ screen: 'baseball' }], undefined, logos);
      add(`baseball ${layout} pregame`, bbp(layout, game('pre', { start: t + 1500, away: { ...live.away, r: 0 }, home: { ...live.home, r: 0, ab: 'WSH' } })), [{ screen: 'baseball' }], undefined, logos);
      add(`baseball ${layout} final`, bbp(layout, game('final')), [{ screen: 'baseball' }, { screen: 'baseball', rolls: { home: { from: '9', p: 0.5 } } }], undefined, logos);
    }
    for (const layout of ['logos', 'bands']) {
      add(`baseball ${layout} light band`, bbp(layout, { ...live, home: lightHome }), [{ screen: 'baseball' }, { screen: 'baseball', rolls: { home: { from: '3', p: 0.5 } } }], undefined, logos);
      add(`baseball ${layout} rolls into a break`, bbp(layout, { ...live, half: 'E', b: 0, s: 0, o: 0, on: [0, 0, 0] }), [0.5].map((p) => ({
        screen: 'baseball', rolls: { count: { from: '3-2', p }, outs: { from: '1 OUT', p } },
      })), undefined, logos);
      add(`baseball ${layout} light band flash`, bbp(layout, { ...live, home: { ...lightHome, at: t - 32 } }), [{ screen: 'baseball' }], undefined, logos);
    }
    // One of two logos loaded: the band layout until both are.
    {
      const two = (extra) => ({ ...live, away: { ...live.away, lg: 'CHC-1' }, home: { ...live.home, lg: 'STL-1' }, ...extra });
      add('baseball logos one of two loaded', bbp('logos', two()), [{ screen: 'baseball' }], undefined, { 'CHC-1': logos['CHC-1'] });
      add('baseball logos both loaded', bbp('logos', two()), [{ screen: 'baseball' }], undefined, { 'CHC-1': logos['CHC-1'], 'STL-1': logos['STL-1'] || crop(21) });
      add('baseball logos pregame, both loaded (names 1px left)', bbp('logos', two(game('pre', { start: t + 1500, away: { ...live.away, r: 0, lg: 'CHC-1' }, home: { ...live.home, r: 0, ab: 'WSH', lg: 'STL-1' } }))), [{ screen: 'baseball' }], undefined, { 'CHC-1': logos['CHC-1'], 'STL-1': crop(21) });
    }
    add('baseball logos without crops (not fetched yet)', bbp('logos', live), [{ screen: 'baseball' }]);
    add('baseball logos at 47% and with no dim (default)', { ...bbp('logos', live), mlb: { layout: 'logos', dim: 0.47, games: [live] } }, [{ screen: 'baseball' }], undefined, logos);
    add('baseball logos, payload without dim', { ...bbp('logos', live), mlb: { layout: 'logos', games: [live] } }, [{ screen: 'baseball' }], undefined, logos);
    add('baseball logos without band colors', bbp('logos', { ...live, away: { ...live.away, bd: null }, home: { ...live.home, bd: null, c: null } }), [{ screen: 'baseball' }], undefined, logos);
  }

  // Baseball (design spec §8).
  {
    const t = 1791140000;
    const CHC = { ab: 'CHC', c: '#2a5bd8' }, STL = { ab: 'STL', c: '#d62a2a' }, NYY = { ab: 'NYY', c: '#3a5fa8' }, BOS = { ab: 'BOS', c: '#c8323d' };
    const game = (extra) => ({ id: 1, start: t - 3600, away: { ...CHC, r: 3, w: 92, l: 70 }, home: { ...STL, r: 2, w: 88, l: 74 }, ...extra });
    const bb = (...games) => ({ now: t, tzo: tzOffset(t), bright: 100, screen: 'baseball', mlb: { games } });
    const live = game({ st: 'live', inn: 7, half: 'T', b: 2, s: 1, o: 2, on: [1, 0, 1] });
    add('baseball live', bb(live), [{ screen: 'baseball' }]);
    add('baseball rotation every 30 s', { ...bb({ ...live, st: 'pre' }, { ...live, id: 2, st: 'final' }), anim: { game: 30 } }, [0, 30, 60, 90].map((s) => ({ screen: 'baseball', now: t + s })));
    add('baseball live rolls', bb({ ...live, half: 'B', b: 0, s: 0, o: 0, on: [0, 1, 0], away: { ...live.away, r: 10 } }), [0.25, 0.5, 0.75].map((p) => ({
      screen: 'baseball', rolls: { away: { from: '3', p }, home: { from: '2', p }, inn: { from: 'TOP 7', p }, count: { from: '2-1', p }, outs: { from: '2 OUT', p } },
    })));
    add('baseball live same-length score roll', bb({ ...live, away: { ...live.away, r: 13 } }), [{ screen: 'baseball', rolls: { away: { from: '12', p: 0.5 } } }]);
    for (const half of ['M', 'E']) add(`baseball break ${half}`, bb({ ...live, half, b: 0, s: 0, o: 0, on: [0, 0, 0] }), [{ screen: 'baseball' }]);
    // Into and out of a break: the count and outs roll out where they were
    // (no pile-up), then roll back in.
    add('chrono payload out of time order, repeated run numbers', { now: t, tzo: tzOffset(t), bright: 100, screen: 'transit', header: 'CLARK/LAKE', view: 'chrono',
      rows: [{ ln: 'BR', lbl: 'KIMBALL', t: [t + 20], s: [0], a: 0, rn: '401' }, { ln: 'PK', lbl: '54/CRMK', t: [t + 290], s: [0], a: 0, rn: '1000' },
        { ln: 'GR', lbl: 'HARLEM', t: [t + 40], s: [0], a: 0, rn: '002' }, { ln: 'GR', lbl: '63RD', t: [t + 310], s: [0], a: 0, rn: '1000' }] }, [{ screen: 'transit' }]);
    add('baseball rolls into a break', bb({ ...live, half: 'M', b: 0, s: 0, o: 0, on: [0, 0, 0] }), [0.25, 0.5, 0.75].map((p) => ({
      screen: 'baseball', rolls: { inn: { from: 'BOT 6', p }, count: { from: '2-1', p }, outs: { from: '3 OUT', p } },
    })));
    add('baseball rolls out of a break', bb({ ...live, half: 'T', b: 0, s: 0, o: 0, on: [0, 0, 0] }), [0.25, 0.5, 0.75].map((p) => ({
      screen: 'baseball', rolls: { inn: { from: 'MID 7', p }, count: { from: '', p }, outs: { from: '', p } },
    })));
    // Score flash: amber, mid-fade, white again.
    const flash = { ...live, away: { ...live.away, at: t - 10 }, home: { ...live.home, at: t - 32 } };
    add('baseball score flash', bb(flash), [{ screen: 'baseball', now: t }, { screen: 'baseball', now: t + 21.5 }, { screen: 'baseball', now: t + 40 }]);
    add('baseball pregame', bb(game({ st: 'pre', start: t + 1500, away: { ...CHC, r: 0, w: 109, l: 53 }, home: { ...STL, r: 0, w: null, l: null } })), [{ screen: 'baseball' }]);
    add('baseball final', bb(game({ st: 'final' })), [{ screen: 'baseball' }, { screen: 'baseball', rolls: { away: { from: '2', p: 0.4 } } }]);
    add('baseball final tie (suspended)', bb(game({ st: 'final', away: { ...CHC, r: 4, w: 1, l: 1 }, home: { ...STL, r: 4, w: 1, l: 1 } })), [{ screen: 'baseball' }]);
    const other = game({ id: 2, st: 'pre', start: t + 900, away: { ...NYY, r: 0, w: 2, l: 1 }, home: { ...BOS, r: 0, w: 1, l: 2 } });
    const fin = game({ id: 3, st: 'final', away: { ab: 'XYZ', c: null, r: 1, w: 0, l: 1 }, home: { ...BOS, r: 5, w: 1, l: 0 } });
    add('baseball rotation', bb(other, fin), [0, 60, 120].map((d) => ({ screen: 'baseball', now: t + d })).concat([{ screen: 'baseball', game: 1 }]));
    add('baseball live takes precedence', bb(other, live, fin), [{ screen: 'baseball', now: t }, { screen: 'baseball', now: t + 60 }]);
    add('baseball no games', bb(), [{ screen: 'baseball' }]);
    // Wide board (cols 128): the line score, for every layout.
    const s3 = { s3only: true };
    const bw = (...games) => ({ ...bb(...games), cols: 128 });
    const ln = (a, h, extra) => ({ away: { ...CHC, r: 3, rs: a, h: 7, e: 0 }, home: { ...STL, r: 2, rs: h, h: 5, e: 1 }, ...extra });
    const wlive = game({ st: 'live', inn: 7, half: 'T', b: 2, s: 1, o: 2, on: [1, 0, 1], ...ln([0, 1, 0, 0, 2, 0], [1, 0, 0, 1, 0, 0]) });
    add('wide baseball live', bw(wlive), [{ screen: 'baseball' }], undefined, undefined, s3);
    add('wide baseball live, logos layout', { ...bw(wlive), mlb: { layout: 'logos', dim: 0.9, games: [wlive] } }, [{ screen: 'baseball' }], undefined, undefined, s3);
    add('wide baseball live rolls', bw({ ...wlive, half: 'B', b: 0, s: 0, o: 0, on: [0, 1, 0], away: { ...wlive.away, r: 10, rs: [0, 1, 0, 0, 2, 0, 7] } }), [0.25, 0.5, 0.75].map((p) => ({
      screen: 'baseball', rolls: { away: { from: '3', p }, home: { from: '2', p }, inn: { from: 'TOP 7', p }, count: { from: '2-1', p }, outs: { from: '2 OUT', p } },
    })), undefined, undefined, s3);
    add('wide baseball break', bw({ ...wlive, half: 'M', b: 0, s: 0, o: 0, on: [0, 0, 0], away: { ...wlive.away, rs: [0, 1, 0, 0, 2, 0, 0] } }), [{ screen: 'baseball' }], undefined, undefined, s3);
    add('wide baseball score flash', bw({ ...wlive, away: { ...wlive.away, at: t - 10 } }), [{ screen: 'baseball' }], undefined, undefined, s3);
    add('wide baseball extra innings', bw({ ...wlive, inn: 11, half: 'B', away: { ...wlive.away, r: 4, rs: [0, 1, 0, 0, 2, 0, 0, 0, 0, 0, 1], h: 11 }, home: { ...wlive.home, r: 3, rs: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0], h: 10, e: 2 } }), [{ screen: 'baseball' }], undefined, undefined, s3);
    add('wide baseball final, home not needed in the 9th', bw(game({ st: 'final', ...ln([0, 0, 0, 1, 0, 0, 0, 0, 0], [1, 0, 0, 1, 0, 0, 0, 0, null]), away: { ...CHC, r: 1, rs: [0, 0, 0, 1, 0, 0, 0, 0, 0], h: 4, e: 2 } })), [{ screen: 'baseball' }], undefined, undefined, s3);
    add('wide baseball final, away wins', bw(game({ st: 'final', ...ln([0, 1, 0, 0, 2, 0, 0, 0, 0], [1, 0, 0, 1, 0, 0, 0, 0, 0]) })), [{ screen: 'baseball' }], undefined, undefined, s3);
    add('wide baseball pregame', bw(game({ st: 'pre', start: t + 1500, away: { ...CHC, r: 0, w: 109, l: 53 }, home: { ...STL, r: 0, w: null, l: null } })), [{ screen: 'baseball' }], undefined, undefined, s3);
    add('wide baseball no games', bw(), [{ screen: 'baseball' }], undefined, undefined, s3);
    add('wide baseball live without a line score', bw(live), [{ screen: 'baseball' }], undefined, undefined, s3);
  }

  // Transit animator sequences.
  const NOW = 1_800_000_000;
  const min = (m) => NOW + m * 60 - 5;
  const base = { v: 1, tzo: tzOffset(NOW), screen: 'transit', bright: 100, header: 'TEST', ticker: [], wx: null, warn: null };
  const seq = (name, steps) => {
    const anim = draw.createTransitAnimator();
    S.push({
      ...(steps.some((s) => alerted(s.p)) ? { s3only: true } : {}),
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
  // Bunched trains: the departing DUE fades, the next one rolls to DUE.
  {
    const p = { rows: [{ ln: 'RD', lbl: 'HOWARD', t: [NOW + 20, NOW + 80, NOW + 400], s: [0, 0, 0], a: 0 }] };
    seq('anim bunched departure', [{ p, now: NOW, t: 0 }, ...ts(1000, 1400, 12).map((t) => ({ p, now: NOW + 51, t }))]);
  }
  // DUE leaves, the other times slide left, a new time joins at the end.
  {
    const rowOf = (t) => ({ rows: [{ ln: 'RD', lbl: 'HOWARD', t, s: t.map(() => 0), a: 0 }] });
    const before = rowOf([NOW + 10, min(7), min(16)]);
    const after = rowOf([NOW + 10, min(7), min(16), min(25)]);
    seq('anim DUE leaves, times slide', [{ p: before, now: NOW, t: 0 }, ...[...ts(1000, 1800, 19), 1350, 1600].sort((x, y) => x - y).map((t) => ({ p: after, now: NOW + 45, t }))]);
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
  // Key layout: a row leaves and the others slide between the key and the band.
  {
    const rowsAt = (gone) => [
      { ln: 'RD', lbl: 'HOWARD', t: [min(4)], s: [0], a: 1 },
      { ln: 'RD', lbl: '95TH', t: gone ? [] : [NOW + 10], s: [0], a: 1 },
      { ln: 'BR', lbl: 'KIMBALL', t: [min(9)], s: [0], a: 0 },
    ].filter((r) => r.t.length);
    seq('anim key layout row leaves', [{ p: { key: 1, rows: rowsAt(false) }, now: NOW, t: 0 }, ...ts(1000, 1400, 14).map((t) => ({ p: { key: 1, rows: rowsAt(true) }, now: NOW + 60, t }))]);
  }
  // Knob chooser (S3 only): the wheel resting, mid-slide, wrapped, and committed.
  {
    const ring = ['auto', 'transit', 'weather', 'sports'];
    const p = { now: NOW, tzo: tzOffset(NOW), bright: 100, knob: { ring, at: 1 } };
    const at = (pos, commit) => ({ screen: 'chooser', chooser: commit ? { pos, commit: true } : { pos } });
    add('knob chooser', p, [at(0), at(1), at(2), at(3), at(-1), at(1.55), at(2.4), at(2.5), at(-0.3), at(7), at(2, true)], undefined, undefined, { s3only: true });
    add('knob chooser five entries', { ...p, knob: { ring: [...ring, 'clock'], at: 0 } }, [at(0), at(4.2), at(3, true)], undefined, undefined, { s3only: true });
    add('knob chooser dimmed', { ...p, bright: 40 }, [at(2), at(2, true)], undefined, undefined, { s3only: true });
    add('knob chooser no ring', { ...p, knob: null }, [at(0)], undefined, undefined, { s3only: true });
  }
  // Peek chooser (S3 only): every variant under the icon bar, slides both
  // ways, the bar's drop, the radar view and the radar while frames are
  // still landing, a skyline with its clouds, three entries, dimmed.
  {
    const p0 = payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { wx: WX });
    const t = p0.now;
    const { bytes: rbytes, loc } = rf['40100-202008102100'];
    const wx = { ...WX, feels: 61, wind: 'NW 12', pop: 20 };
    const days = [['SU', 63, 'sun'], ['MO', 58, 'pcloudy_day'], ['TU', 52, 'rain'], ['WE', 49, 'cloudy'], ['TH', 55, 'sun']].map(([d, hi, icon]) => ({ d, hi, icon }));
    const hours = [['1P', 52, 'pcloudy_day'], ['3P', 50, 'rain'], ['5P', 49, 'cloudy'], ['7P', 50, 'moon']].map(([h, tt, icon]) => ({ h, t: tt, icon }));
    const skyline = toSkyline({ temp: 52, code: 2, clouds: 35 }, { lat: 41.8917, lon: -87.590, now: t, temp: 52 });
    const ids = ['a', 'b', 'c'], ft = [t - 720, t - 360, t - 60];
    const ring = ['transit', 'weather', 'clock', 'announce', 'cycle'];
    const vars = [['transit', 'ticker'], ['now', '5day', 'hourly', 'radar'], ['skyline', 'seventies', 'analog', 'daynight', 'gradient', 'digits', 'daydate'], [], []];
    const p = {
      ...p0, tickerHeader: 'MORSE', radar: { on: false, frames: [], ft: [], timeBox: loc.timeBox, split: loc.split, wx },
      msg: { id: 1, style: 'note', ...draw.messageLayout('Dinner at 7\nbring wine', 'note') },
      pv: { days, hours, skyline, cwx: { temp: 52, icon: 'pcloudy_day' }, dn: { dec: -150, lon: 1200, t, here: [16, 7] }, steady: true, radar: { frames: ids, ft } },
      knob: { ring, at: 0, vars, sel: [0, 0, 0, 0, 0], ln: 'RD' },
    };
    const pk = (k, vi, extra = {}) => ({ screen: 'peek', peek: { k, vi, ...extra } });
    const every = []; vars.forEach((v, k) => (v.length ? v : [null]).forEach((_, vi) => every.push(pk(k, vi))));
    const frames = { a: rbytes, b: rbytes, c: rbytes };
    const clouds = skyline.cl ? { [skyline.cl.id]: stripBytes(skyline.cl.id) } : undefined;
    add('peek every variant', p, every, frames, undefined, { s3only: true, clouds });
    add('peek slides', p, [
      pk(1, 0, { slide: { k: 0, vi: 0, t: 0, axis: 'x', dir: 1 } }), pk(1, 0, { slide: { k: 0, vi: 0, t: 40, axis: 'x', dir: 1 } }),
      pk(1, 0, { slide: { k: 0, vi: 0, t: 135, axis: 'x', dir: 1 } }), pk(0, 0, { slide: { k: 1, vi: 0, t: 90, axis: 'x', dir: -1 } }),
      pk(4, 0, { slide: { k: 0, vi: 0, t: 100, axis: 'x', dir: -1 } }), pk(2, 2, { slide: { k: 2, vi: 1, t: 60, axis: 'y', dir: 1 } }),
      pk(2, 1, { slide: { k: 2, vi: 2, t: 200, axis: 'y', dir: -1 } }), pk(1, 0, { slide: { k: 0, vi: 0, t: 999, axis: 'x', dir: 1 } }),
    ], frames, undefined, { s3only: true, clouds });
    add('peek bar drop', p, [1, 3, 6, 10, 11, 14].map((drop) => pk(2, 0, { drop })), frames, undefined, { s3only: true, clouds });
    // Raining: the newest frame on hand, still; none yet: the empty radar.
    const rain = { ...p, radar: { ...p.radar, on: true, frames: ids, ft } };
    add('peek radar none on hand', rain, [pk(1, 0), pk(1, 3)], {}, undefined, { s3only: true });
    add('peek radar two on hand', rain, [pk(1, 0), pk(1, 1)], { a: rbytes, b: rbytes }, undefined, { s3only: true });
    add('peek skyline strip not fetched', p, [pk(2, 0)], undefined, undefined, { s3only: true });
    add('peek three entries, red at a blue line station', { ...p, knob: { ring: ['transit', 'weather', 'cycle'], at: 0, vars: [vars[0], vars[1], []], sel: [0, 0, 0], ln: 'BL' } },
      [pk(0, 1), pk(2, 0)], frames, undefined, { s3only: true });
    add('peek dimmed', { ...p, bright: 40 }, [pk(0, 0), pk(2, 3)], frames, undefined, { s3only: true, clouds });
    add('peek no knob variants', { ...p, knob: { ring, at: 0 } }, [pk(1, 0), pk(2, 0)], frames, undefined, { s3only: true });
  }
  // Clock screen, skyline face (S3 only): every weather kind by day and night,
  // dusk, warnings, boats, lightning, rain and snow in motion, clouds drifting,
  // dimmed, and no weather yet. Parameters from the server's skyline.js.
  {
    const PLACE = { lat: 41.8917, lon: -87.590 };
    const at = (iso) => Date.parse(iso) / 1000;
    const DAY = at('2026-10-31T19:05:00Z'), NIGHT = at('2026-11-01T02:42:00Z');
    const sky = (w, now, extra = {}) => {
      const skyline = toSkyline({ temp: 52, ...w }, { ...PLACE, now, temp: extra.temp != null ? extra.temp : 52, boats: extra.boats !== false });
      const clouds = skyline.cl ? { [skyline.cl.id]: stripBytes(skyline.cl.id) } : undefined;
      return [{ now, tzo: tzOffset(now), screen: 'clock', bright: extra.bright || 100, warn: extra.warn || null, skyline }, clouds];
    };
    const ms = (now, ...dts) => dts.map((dt) => ({ screen: 'clock', ms: now * 1000 + dt }));
    const kinds = [['clear', { code: 0, clouds: 5 }], ['partly', { code: 2, clouds: 35 }], ['mostly', { code: 3, clouds: 70 }], ['overcast', { code: 3, clouds: 95 }],
      ['rain', { code: 63, clouds: 100 }], ['snow', { code: 73, clouds: 100 }], ['fog', { code: 45, clouds: 100 }], ['storm', { code: 95, clouds: 100 }]];
    for (const [name, w] of kinds) {
      for (const [when, now] of [['day', DAY], ['night', NIGHT]]) {
        const [p, clouds] = sky(w, now, { temp: name === 'snow' ? 28 : 52 });
        add(`skyline ${name} ${when}`, p, [{ screen: 'clock' }, ...ms(now, 1300, 4000, 61234)], undefined, undefined, { s3only: true, clouds });
      }
    }
    // Clouds present in the payload but the strip not fetched yet: plain sky.
    { const [p] = sky({ code: 3, clouds: 95 }, DAY); add('skyline overcast strip not fetched', p, [{ screen: 'clock' }], undefined, undefined, { s3only: true }); }
    // Cloud drift settings: still, slow (16 s a pixel) and normal (4 s), and a payload without step (4 s); mid-step frames check the sub-pixel glide.
    for (const [name, step] of [['off', 0], ['slow', 16000], ['normal', 4000], ['unset', undefined]]) {
      const [p, clouds] = sky({ code: 2, clouds: 40 }, DAY);
      const cl = { ...p.skyline.cl };
      if (step === undefined) delete cl.step; else cl.step = step;
      add(`skyline cloud drift ${name}`, { ...p, skyline: { ...p.skyline, cl } }, ms(DAY, 0, 1000, 2000, 3999, 4000, 8000, 16000, 64000), undefined, undefined, { s3only: true, clouds });
    }
    for (let m = 0; m <= 110; m += 20) {
      const t = at('2026-10-31T22:00:00Z') + m * 60;
      const [p, clouds] = sky({ code: 2, clouds: 30 }, t);
      add(`skyline dusk +${m} min`, p, [{ screen: 'clock' }], undefined, undefined, { s3only: true, clouds });
    }
    for (const [name, warn] of [['severe watch', { kind: 'svr', lvl: 'watch' }], ['severe warning', { kind: 'svr', lvl: 'warning' }], ['tornado watch', { kind: 'tor', lvl: 'watch' }], ['tornado warning', { kind: 'tor', lvl: 'warning' }]]) {
      const [p, clouds] = sky({ code: 95, clouds: 100 }, NIGHT, { warn });
      add(`skyline ${name}`, p, [{ screen: 'clock' }, { screen: 'clock', blink: true }], undefined, undefined, { s3only: true, clouds });
    }
    {
      const q = at('2026-10-31T19:00:00Z');
      const [p] = sky({ code: 0, clouds: 0, temp: 60 }, q, { temp: 60 });
      add('skyline sailboat', p, ms(q, 0, 800, 20000, 40000, 55000, 30 * 60000 + 5000, 30 * 60000 + 50000), undefined, undefined, { s3only: true });
      const [p2] = sky({ code: 0, clouds: 0, temp: 60 }, q + 900, { temp: 60 });
      add('skyline speedboat', p2, ms(q + 900, 0, 1500, 9000, 14000, 13050 + 4000 + 300, 13050 + 4000 + 7000, 13050 + 4000 + 12900), undefined, undefined, { s3only: true });
      const [p3] = sky({ code: 0, clouds: 0, temp: 60 }, q, { temp: 60, boats: false });
      add('skyline boats off', p3, ms(q, 20000), undefined, undefined, { s3only: true });
      const [p4] = sky({ code: 0, clouds: 0, temp: 20 }, q, { temp: 20 });
      add('skyline cold, no boats', p4, ms(q, 20000), undefined, undefined, { s3only: true });
    }
    {
      // A strike near NIGHT: rising, peak, fading.
      let s0 = NIGHT * 1000;
      while (draw.strikeLevel(s0) === 0) s0 += 100;
      const [p, clouds] = sky({ code: 95, clouds: 100 }, NIGHT);
      add('skyline lightning', p, [0, 50, 100, 200, 400, 800, 1300].map((dt) => ({ screen: 'clock', ms: s0 + dt })), undefined, undefined, { s3only: true, clouds });
    }
    {
      const [p, clouds] = sky({ code: 65, clouds: 100 }, DAY);
      add('skyline heavy rain falling', p, ms(DAY, 0, 200, 400, 1000, 7777), undefined, undefined, { s3only: true, clouds });
      const [p2, c2] = sky({ code: 75, clouds: 100 }, NIGHT, { temp: 18 });
      add('skyline heavy snow falling', p2, ms(NIGHT, 0, 700, 2100, 9999), undefined, undefined, { s3only: true, clouds: c2 });
    }
    // Rain slanting with the wind (right, left) and straight down, mid-step
    // (sub-pixel) and on steps; rain and snow at the speed settings.
    for (const [name, wind] of [['slant right', { windSpeed: 15, windDir: 180 }], ['slant left', { windSpeed: 15, windDir: 0 }], ['straight', { windSpeed: 15, windDir: 270 }]]) {
      const [p, clouds] = sky({ code: 63, clouds: 100, ...wind }, DAY);
      add(`skyline rain ${name}`, p, ms(DAY, 0, 50, 100, 150, 200, 12850), undefined, undefined, { s3only: true, clouds });
    }
    for (const [name, fall] of [['slow', 400], ['fast', 100]]) {
      const [p, clouds] = sky({ code: 65, clouds: 100, windSpeed: 20, windDir: 10 }, DAY);
      add(`skyline rain ${name}`, { ...p, skyline: { ...p.skyline, fall } }, ms(DAY, 0, 75, 333, 1000), undefined, undefined, { s3only: true, clouds });
      const [p2, c2] = sky({ code: 75, clouds: 100 }, NIGHT, { temp: 18 });
      add(`skyline snow ${name}`, { ...p2, skyline: { ...p2.skyline, fall } }, ms(NIGHT, 0, 350, 1400, 9999), undefined, undefined, { s3only: true, clouds: c2 });
    }
    // Wheel and ripples still, slow and fast; stars not twinkling.
    for (const [name, wheel, rip] of [['still', 0, 0], ['slow', 60000, 1000], ['fast', 15000, 250]]) {
      const [p] = sky({ code: 0, clouds: 0 }, NIGHT);
      add(`skyline wheel and ripples ${name}`, { ...p, skyline: { ...p.skyline, wheel, rip } }, ms(NIGHT, 0, 125, 7000, 61234), undefined, undefined, { s3only: true });
    }
    { const [p] = sky({ code: 0, clouds: 0 }, NIGHT); add('skyline stars still', { ...p, skyline: { ...p.skyline, twk: 0 } }, ms(NIGHT, 0, 900, 2500), undefined, undefined, { s3only: true }); }
    {
      // Weather changes crossfade: clear day to rain (and its strip), partly
      // cloudy's clouds fading in as the strip arrives, and dusk to night.
      const [pa] = sky({ code: 0, clouds: 5 }, DAY);
      const [pb, cb] = sky({ code: 63, clouds: 100 }, DAY);
      add('skyline crossfade clear to rain', pb, [0, 0.1, 0.5, 0.9, 1].map((k) => ({ screen: 'clock', ms: DAY * 1000 + 777, skyFrom: pa.skyline, skyK: k })), undefined, undefined, { s3only: true, clouds: cb });
      const [pp, cp] = sky({ code: 2, clouds: 35 }, DAY);
      add('skyline crossfade clouds arriving', pp, [0.25, 0.75].map((k) => ({ screen: 'clock', ms: DAY * 1000, skyFrom: pp.skyline, skyBare: true, skyK: k })), undefined, undefined, { s3only: true, clouds: cp });
      const [pn] = sky({ code: 0, clouds: 5 }, NIGHT);
      add('skyline crossfade shown skyline in place of the payload', pn, [{ screen: 'clock', ms: NIGHT * 1000, sky: pa.skyline }, { screen: 'clock', ms: NIGHT * 1000, sky: null }], undefined, undefined, { s3only: true });
    }
    { const [p, clouds] = sky({ code: 2, clouds: 35 }, NIGHT, { bright: 40 }); add('skyline dimmed', p, [{ screen: 'clock' }], undefined, undefined, { s3only: true, clouds }); }
    {
      const p = { now: NIGHT, tzo: tzOffset(NIGHT), screen: 'clock', bright: 100, warn: null, skyline: null };
      add('skyline no weather yet', p, [{ screen: 'clock' }, ...ms(NIGHT, 5000)], undefined, undefined, { s3only: true });
      const [pc] = sky({ code: 0, clouds: 0 }, NIGHT, { temp: -12 });
      add('skyline negative temperature', pc, [{ screen: 'clock' }], undefined, undefined, { s3only: true });
      const t = at('2026-11-01T05:59:00Z');
      const [pw] = sky({ code: 0, clouds: 0 }, t, { temp: 100 });
      add('skyline widest text', pw, [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    }
  }
  // Clock screen, seventies face (S3 only): one- and two-digit hours, the
  // minute roll (per digit, and whole when the width changes), dimmed.
  {
    const s70 = (iso, extra = {}) => { const t = Date.parse(iso) / 1000; return { now: t, tzo: tzOffset(t), screen: 'clock', cface: 'seventies', bright: 100, warn: null, skyline: null, ...extra }; };
    const ps = [0.25, 0.5, 0.75];
    const roll = (from) => ps.map((p) => ({ screen: 'clock', nums: { 'svt.clock': { from, p } } }));
    add('seventies 9:42', s70('2026-11-02T03:42:00Z'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('seventies 12:58', s70('2026-11-01T18:58:00Z'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('seventies 10:07 dimmed', s70('2026-11-01T16:07:00Z', { bright: 40 }), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('seventies roll per digit', s70('2026-11-02T03:42:00Z'), roll('9:41'), undefined, undefined, { s3only: true });
    add('seventies roll width change', s70('2026-11-01T19:00:00Z'), roll('12:59'), undefined, undefined, { s3only: true });
  }
  // Clock screen, big digits and day/date faces (S3 only): one- and
  // two-digit hours, the colon's blink, the minute roll (per digit, and
  // whole when the width changes), AM and PM, the longest weekday, dimmed.
  {
    const cf = (iso, cface, extra = {}) => { const t = Date.parse(iso) / 1000; return { now: t, tzo: tzOffset(t), screen: 'clock', cface, bright: 100, warn: null, skyline: null, ...extra }; };
    const ps = [0.25, 0.5, 0.75];
    const roll = (name, from) => ps.map((p) => ({ screen: 'clock', nums: { [name]: { from, p } } }));
    const at = (iso, d) => Date.parse(iso) + d;
    add('digits 9:42', cf('2026-11-02T03:42:00Z', 'digits'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('digits 12:58', cf('2026-11-01T18:58:00Z', 'digits'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('digits colon blink', cf('2026-11-01T16:07:00Z', 'digits'), [0, 499, 500, 999, 1000].map((d) => ({ screen: 'clock', ms: at('2026-11-01T16:07:00Z', d) })), undefined, undefined, { s3only: true });
    add('digits steady colon', cf('2026-11-01T16:07:00Z', 'digits', { steady: true }), [0, 750].map((d) => ({ screen: 'clock', ms: at('2026-11-01T16:07:00Z', d) })), undefined, undefined, { s3only: true });
    add('digits 10:07 dimmed', cf('2026-11-01T16:07:00Z', 'digits', { bright: 40 }), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('digits roll per digit', cf('2026-11-02T03:42:00Z', 'digits'), roll('dig.clock', '9:41').map((r) => ({ ...r, ms: at('2026-11-02T03:42:00Z', 700) })), undefined, undefined, { s3only: true });
    add('digits roll width change', cf('2026-11-01T19:00:00Z', 'digits'), roll('dig.clock', '12:59'), undefined, undefined, { s3only: true });
    add('daydate 9:42 PM', cf('2026-11-02T03:42:00Z', 'daydate'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('daydate 12:58 PM', cf('2026-11-01T18:58:00Z', 'daydate'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('daydate wednesday 10:07 AM', cf('2026-11-04T16:07:00Z', 'daydate'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('daydate dimmed', cf('2026-11-04T16:07:00Z', 'daydate', { bright: 40 }), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('daydate roll per digit', cf('2026-11-02T03:42:00Z', 'daydate'), roll('dd.clock', '9:41'), undefined, undefined, { s3only: true });
    add('daydate roll width change', cf('2026-11-01T19:00:00Z', 'daydate'), roll('dd.clock', '12:59'), undefined, undefined, { s3only: true });
    // Wide (wide-spec §6): big digits in d23 centered on 128; day/date with
    // the weekday and date beside the time (Wednesday, Sept 30: the widest).
    const cw = (iso, cface, extra = {}) => cf(iso, cface, { cols: 128, ...extra });
    add('wide digits 9:42', cw('2026-11-02T03:42:00Z', 'digits'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('wide digits colon blink', cw('2026-11-01T18:58:00Z', 'digits'), [0, 500].map((d) => ({ screen: 'clock', ms: at('2026-11-01T18:58:00Z', d) })), undefined, undefined, { s3only: true });
    add('wide digits steady, dimmed', cw('2026-11-01T16:07:00Z', 'digits', { steady: true, bright: 40 }), [{ screen: 'clock', ms: at('2026-11-01T16:07:00Z', 750) }], undefined, undefined, { s3only: true });
    add('wide digits roll per digit', cw('2026-11-02T03:42:00Z', 'digits'), roll('dig.clock', '9:41').map((r) => ({ ...r, ms: at('2026-11-02T03:42:00Z', 700) })), undefined, undefined, { s3only: true });
    add('wide digits roll width change', cw('2026-11-01T19:00:00Z', 'digits'), roll('dig.clock', '12:59'), undefined, undefined, { s3only: true });
    add('wide daydate 9:42 PM', cw('2026-11-06T03:42:00Z', 'daydate'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('wide daydate Wednesday, September 30', cw('2026-09-30T17:58:00Z', 'daydate'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('wide daydate 10:07 AM dimmed', cw('2026-11-04T16:07:00Z', 'daydate', { bright: 40 }), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('wide daydate roll per digit', cw('2026-11-02T03:42:00Z', 'daydate'), roll('dd.clock', '9:41'), undefined, undefined, { s3only: true });
    add('wide daydate roll width change', cw('2026-11-01T19:00:00Z', 'daydate'), roll('dd.clock', '12:59'), undefined, undefined, { s3only: true });
  }
  // Clock screen, analog and day/night faces (S3 only).
  {
    const { subsolar } = require(path.join(B, 'sun'));
    const face = (iso, cface, extra = {}) => {
      const t = Date.parse(iso) / 1000, sun = subsolar(t);
      return { now: t, tzo: tzOffset(t), screen: 'clock', cface, bright: 100, warn: null, skyline: null,
        cwx: { temp: 54, icon: 'pcloudy_day' }, dn: { dec: Math.round(sun.dec * 10), lon: Math.round(sun.lon * 10), t, here: [16, 7] }, ...extra };
    };
    add('analog 9:42:37 PM', face('2026-11-02T03:42:37Z', 'analog'), [{ screen: 'clock' }, { screen: 'clock', now: Date.parse('2026-11-02T03:43:05Z') / 1000 }], undefined, undefined, { s3only: true });
    add('analog Wednesday, no weather', face('2026-09-30T15:07:59Z', 'analog', { cwx: null }), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('analog 12:00 below freezing', face('2026-01-14T18:00:00Z', 'analog', { cwx: { temp: -12, icon: 'snow' } }), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('daynight evening', face('2026-11-02T03:42:00Z', 'daynight'), [{ screen: 'clock' }, { screen: 'clock', now: Date.parse('2026-11-02T05:42:00Z') / 1000 }], undefined, undefined, { s3only: true });
    add('daynight noon', face('2026-11-01T18:00:00Z', 'daynight'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('daynight June solstice', face('2026-06-21T13:30:00Z', 'daynight'), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('daynight December solstice dimmed', face('2026-12-21T23:59:00Z', 'daynight', { bright: 40 }), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    add('daynight no sun data', face('2026-11-01T18:00:00Z', 'daynight', { dn: null }), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    const gms = Date.parse('2026-11-02T01:15:00Z');
    add('gradient over the hour', face('2026-11-02T01:15:00Z', 'gradient'), [0, 43210, 360000, 1234567, 2160000, 3599999].map((d) => ({ screen: 'clock', ms: gms + d })), undefined, undefined, { s3only: true });
    add('gradient 12:58 fills the width', face('2026-11-01T18:58:00Z', 'gradient'), [{ screen: 'clock', ms: gms }], undefined, undefined, { s3only: true });
    add('gradient dimmed, two-digit hour', face('2026-11-01T17:59:00Z', 'gradient', { bright: 40 }), [{ screen: 'clock', ms: Date.parse('2026-11-01T17:59:07Z') }], undefined, undefined, { s3only: true });
    add('gradient inverted', face('2026-11-02T01:15:00Z', 'gradient', { ginv: true }), [0, 1234567].map((d) => ({ screen: 'clock', ms: gms + d })), undefined, undefined, { s3only: true });
    add('gradient inverted roll', face('2026-11-01T19:00:00Z', 'gradient', { ginv: true }), [0.25, 0.75].map((p) => ({ screen: 'clock', ms: gms, nums: { 'grad.clock': { from: '12:59', p } } })), undefined, undefined, { s3only: true });
    add('gradient roll width change', face('2026-11-01T19:00:00Z', 'gradient'), [0.25, 0.75].map((p) => ({ screen: 'clock', ms: Date.parse('2026-11-01T19:00:00Z'), nums: { 'grad.clock': { from: '12:59', p } } })), undefined, undefined, { s3only: true });
    add('gradient roll per digit', face('2026-11-02T01:15:00Z', 'gradient'), [0.25, 0.5, 0.75].map((p) => ({ screen: 'clock', ms: gms, nums: { 'grad.clock': { from: '7:14', p } } })), undefined, undefined, { s3only: true });
    add('gradient roll off', { ...face('2026-11-02T01:15:00Z', 'gradient'), croll: false }, [0.5].map((p) => ({ screen: 'clock', ms: gms, nums: { 'grad.clock': { from: '7:14', p } } })), undefined, undefined, { s3only: true });
    add('daynight roll', face('2026-11-01T19:00:00Z', 'daynight'), [0.25, 0.75].map((p) => ({ screen: 'clock', nums: { 'dn.clock': { from: '12:59', p } } })), undefined, undefined, { s3only: true });
    // Wide board (wide-spec §6): the 80 x 32 map with the sun panel, and the
    // Seventies stripes with the weekday, date and temperature.
    const wf = (iso, cface, extra = {}) => {
      const p = face(iso, cface, extra), t = p.now;
      return { ...p, cols: 128, dn: p.dn && { ...p.dn, hw: [20, 9], sr: t - 15 * 3600 - 20 * 60, ss: t - 5 * 3600 + 4 * 60 }, ...extra };
    };
    const one = [{ screen: 'clock' }];
    add('wide daynight evening', wf('2026-11-04T03:42:00Z', 'daynight'), [{ screen: 'clock' }, { screen: 'clock', now: Date.parse('2026-11-04T05:42:00Z') / 1000 }], undefined, undefined, { s3only: true });
    add('wide daynight June noon', wf('2026-06-21T17:00:00Z', 'daynight'), one, undefined, undefined, { s3only: true });
    add('wide daynight 12:58 PM dimmed', wf('2026-11-01T18:58:00Z', 'daynight', { bright: 40 }), one, undefined, undefined, { s3only: true });
    add('wide daynight no sunrise or sunset', wf('2026-11-01T18:00:00Z', 'daynight', { dn: { ...face('2026-11-01T18:00:00Z', 'daynight').dn, hw: [20, 9] } }), one, undefined, undefined, { s3only: true });
    add('wide daynight no sun data', wf('2026-11-01T18:00:00Z', 'daynight', { dn: null }), one, undefined, undefined, { s3only: true });
    add('wide daynight roll', wf('2026-11-01T19:00:00Z', 'daynight'), [0.25, 0.75].map((p) => ({ screen: 'clock', nums: { 'dn.clock': { from: '12:59', p } } })), undefined, undefined, { s3only: true });
    add('wide seventies Tuesday 9:42', wf('2026-11-04T03:42:00Z', 'seventies'), one, undefined, undefined, { s3only: true });
    add('wide seventies Wednesday 12:58', wf('2026-11-04T18:58:00Z', 'seventies', { cwx: { temp: 101, icon: 'sunny' } }), one, undefined, undefined, { s3only: true });
    add('wide seventies no weather, dimmed', wf('2026-12-31T05:07:00Z', 'seventies', { cwx: null, bright: 40 }), one, undefined, undefined, { s3only: true });
    add('wide seventies below zero', wf('2026-01-14T18:00:00Z', 'seventies', { cwx: { temp: -12, icon: 'snow' } }), one, undefined, undefined, { s3only: true });
    add('wide seventies roll', wf('2026-11-01T19:00:00Z', 'seventies'), [0.25, 0.75].map((p) => ({ screen: 'clock', nums: { 'svt.clock': { from: '12:59', p } } })), undefined, undefined, { s3only: true });
    // Analog + calendar: 5- and 6-week months (August 2026 wraps 30 and 31
    // into the first row), February, a leap February, the accent colors.
    add('wide analog November 1st', wf('2026-11-02T03:42:37Z', 'analog'), [{ screen: 'clock' }, { screen: 'clock', now: Date.parse('2026-11-02T03:43:05Z') / 1000 }], undefined, undefined, { s3only: true });
    add('wide analog six-week month', wf('2026-08-31T15:00:00Z', 'analog', { cacc: '#22c8e6' }), one, undefined, undefined, { s3only: true });
    add('wide analog February 14', wf('2026-02-14T18:00:00Z', 'analog', { cacc: '#ff4fa8' }), one, undefined, undefined, { s3only: true });
    add('wide analog leap day, dimmed', wf('2028-02-29T13:00:00Z', 'analog', { cacc: '#a8e23a', bright: 40 }), one, undefined, undefined, { s3only: true });
    add('wide analog last of the month', wf('2026-12-31T22:00:00Z', 'analog', { cacc: '#a066ff' }), one, undefined, undefined, { s3only: true });
    add('analog accent', face('2026-11-02T03:42:37Z', 'analog', { cacc: '#ff5a4e' }), [{ screen: 'clock' }], undefined, undefined, { s3only: true });
    // Word clock: each five minutes of an hour, the rounding up to the next
    // hour, noon and midnight.
    const words = (iso, extra = {}) => wf(iso, 'words', extra);
    add('wide words through the hour', words('2026-11-02T03:00:00Z'), Array.from({ length: 13 }, (_, i) => ({ screen: 'clock', now: Date.parse('2026-11-02T03:00:00Z') / 1000 + i * 300 })), undefined, undefined, { s3only: true });
    add('wide words rounding', words('2026-11-02T03:42:00Z'), [0, 59, 60, 179, 1020, 1079].map((d) => ({ screen: 'clock', now: Date.parse('2026-11-02T03:42:00Z') / 1000 + d })), undefined, undefined, { s3only: true });
    add('wide words noon and midnight, dimmed', words('2026-11-01T17:58:00Z', { bright: 40 }), [{ screen: 'clock' }, { screen: 'clock', now: Date.parse('2026-11-02T05:58:00Z') / 1000 }, { screen: 'clock', now: Date.parse('2026-11-01T11:31:00Z') / 1000 }], undefined, undefined, { s3only: true });
    // Gradient at 128: 7 x 6 blocks, the gradient across all 128 columns.
    add('wide gradient over the hour', wf('2026-11-02T01:15:00Z', 'gradient'), [0, 1234567, 3599999].map((d) => ({ screen: 'clock', ms: gms + d })), undefined, undefined, { s3only: true });
    add('wide gradient 12:58', wf('2026-11-01T18:58:00Z', 'gradient', { bright: 40 }), [{ screen: 'clock', ms: gms }], undefined, undefined, { s3only: true });
    add('wide gradient inverted', wf('2026-11-02T01:15:00Z', 'gradient', { ginv: true }), [0, 1234567].map((d) => ({ screen: 'clock', ms: gms + d })), undefined, undefined, { s3only: true });
    add('wide gradient roll width change', wf('2026-11-01T19:00:00Z', 'gradient'), [0.25, 0.75].map((p) => ({ screen: 'clock', ms: gms, nums: { 'grad.clock': { from: '12:59', p } } })), undefined, undefined, { s3only: true });
    add('wide gradient roll per digit', wf('2026-11-02T01:15:00Z', 'gradient', { ginv: true }), [0.25, 0.75].map((p) => ({ screen: 'clock', ms: gms, nums: { 'grad.clock': { from: '7:14', p } } })), undefined, undefined, { s3only: true });
  }
  // Announce screen (S3 only): the styles, the typewriter's intro (typing,
  // then its cursor blinking), the credits roll's steps, edge fades, pause
  // and loop, the call to action with no message, a removed style drawn as
  // a note, and dimmed.
  {
    const ann = (text, style, extra = {}) => ({ now: NOW, tzo: tzOffset(NOW), screen: 'announce', bright: 100, msg: { id: 7, style, ...draw.messageLayout(text, style) }, ...extra });
    const at = (...ts) => [{ screen: 'announce' }, ...ts.map((t) => ({ screen: 'announce', t }))];
    const s3 = { s3only: true };
    add('announce no message', { now: NOW, tzo: tzOffset(NOW), screen: 'announce', bright: 100, msg: null }, [{ screen: 'announce' }], undefined, undefined, s3);
    add('announce note one line', ann('Dinner at 7', 'note'), at(0), undefined, undefined, s3);
    add('announce note three lines', ann('Grab milk on the way home please', 'note'), at(), undefined, undefined, s3);
    add('announce note small text', ann('Leaving at 8:15 for the game. Meet at the north end of the Addison platform.', 'note'), at(), undefined, undefined, s3);
    add('announce note blank line and punctuation', ann('\u2018Caf\u00e9\u2019 \u2014 7\u2026\n\nBring \u20ac', 'note'), at(), undefined, undefined, s3);
    add('announce unknown style draws as a note', { ...ann('Go Cubs', 'note'), msg: { id: 2, style: 'flap', lines: ['Go Cubs'] } }, at(0), undefined, undefined, s3);
    add('announce typewriter', ann('Gone to the gym. Back by 6.', 'type'), at(0, 399, 400, 490, 1300, 2830, 2831, 3359, 3360, 3890), undefined, undefined, s3);
    add('announce typewriter blank line', ann('Hi\n\nback soon', 'type'), at(0, 750, 1000), undefined, undefined, s3);
    add('announce big word', ann('Yay!', 'big'), at(0), undefined, undefined, s3);
    add('announce big word widest', ann('HELLO', 'big'), at(), undefined, undefined, s3);
    add('announce big word descender', ann('yup', 'big'), at(), undefined, undefined, s3);
    {
      const long = 'Happy birthday, Sam! Dinner at Lula at 7. We have the back table.';
      const travel = 40 + 2 + 10 * (draw.messageLayout(long, 'roll').lines.length - 1);
      add('announce credits roll', ann(long, 'roll'), at(0, 150, 299, 300, 1500, 3000, 4650, 6000, 7500, 9000, travel * 150 - 1, travel * 150, travel * 150 + 1499, travel * 150 + 1500 + 1800), undefined, undefined, s3);
      add('announce credits roll one line', ann('Thanks!', 'roll'), at(2400, 4050), undefined, undefined, s3);
      add('announce credits roll accents and blank line', ann('\u00c9t\u00e9 \u2014 caf\u00e9\n\n\u00e0 6h', 'roll'), at(3000, 5100), undefined, undefined, s3);
    }
    add('announce dimmed', ann('Dinner at 7\nbring wine', 'type', { bright: 40 }), at(), undefined, undefined, s3);
    // Wide board (cols 128): laid out across both panels.
    const annW = (text, style, extra = {}) => ({ now: NOW, tzo: tzOffset(NOW), screen: 'announce', bright: 100, cols: 128, msg: { id: 7, style, ...draw.messageLayout(text, style, 128) }, ...extra });
    add('wide announce no message', { now: NOW, tzo: tzOffset(NOW), screen: 'announce', bright: 100, cols: 128, msg: null }, [{ screen: 'announce' }], undefined, undefined, s3);
    add('wide announce note', annW('Grab milk on the way home please, and bread', 'note'), at(), undefined, undefined, s3);
    add('wide announce note small text', annW('Leaving at 8:15 for the game tonight. Meet at the north end of the Addison platform by the stairs. Bring the tickets!', 'note'), at(), undefined, undefined, s3);
    add('wide announce typewriter', annW('Gone to the gym. Back by 6. Dinner in the fridge.', 'type'), at(0, 1300, 4000, 4900, 5430), undefined, undefined, s3);
    add('wide announce big word 3x', annW('Go Cubs', 'big'), at(), undefined, undefined, s3);
    add('wide announce big word descender 3x', annW('yup', 'big'), at(), undefined, undefined, s3);
    add('wide announce big word 2x', annW('Welcome home', 'big'), at(), undefined, undefined, s3);
    {
      const long = 'Happy birthday, Sam! Dinner at Lula at 7. We have the back table, then cake at home.';
      const travel = 40 + 2 + 10 * (draw.messageLayout(long, 'roll', 128).lines.length - 1);
      add('wide announce credits roll', annW(long, 'roll'), at(0, 1500, 3000, 6000, travel * 150 - 1), undefined, undefined, s3);
    }
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
  // Screen change slide (S3 only): the new screen pushes the old one's last
  // frame off sideways, both ways, dimmed too (the slide is after brightness).
  {
    const p = payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { wx: WX });
    const from = Array.from(draw.render(p, { screen: 'ticker' }).px);
    const at = (t, dir) => ({ screen: 'transit', slide: { from, t, dir } });
    add('screen slide ticker to transit from the right', p, [0, 60, 150, 225, 300, 449, 450, 900].map((t) => at(t, 1)), undefined, undefined, { s3only: true });
    add('screen slide ticker to transit from the left', p, [0, 60, 225, 449].map((t) => at(t, -1)), undefined, undefined, { s3only: true });
    const dim = { ...p, bright: 40 };
    const fromDim = Array.from(draw.render(dim, { screen: 'transit' }).px);
    add('screen slide dimmed transit to weather', dim, [100, 250].map((t) => ({ screen: 'weather', slide: { from: fromDim, t, dir: 1 } })), undefined, undefined, { s3only: true });
    // Screen change fade (S3 only; phone and auto changes): out to black, then in.
    add('screen fade ticker to transit', p, [0, 40, 100, 124, 125, 170, 249, 250, 400].map((t) => ({ screen: 'transit', fade: { from, t } })), undefined, undefined, { s3only: true });
    add('screen fade dimmed transit to weather', dim, [60, 190].map((t) => ({ screen: 'weather', fade: { from: fromDim, t } })), undefined, undefined, { s3only: true });
  }
  // Two chained panels (payload `cols` 128; S3 only, the M4 is 64 wide):
  // screens without a 128 layout yet draw at 64 on both panels, and the
  // screen-change slide and fade run across all 128 columns, from a 64-wide
  // frame (a status screen) too.
  {
    const wide = (p) => ({ ...p, cols: 128 });
    const bytes = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Uint8Array.from(v)])) : undefined);
    const WIDE = ['transit morse-2026-10-03-2316.json header=true wx=true', 'chrono clark/lake alerts', 'stale', 'ticker header kept', 'weather screen normal',
      'radar time off split=true svr warning', 'knob chooser five entries', 'peek slides',
      'peek every variant', 'skyline clear day', 'seventies 9:42', 'daynight December solstice dimmed', 'brightness 50'];
    // The skyline panorama (wide-spec §6): every weather and time of day,
    // the boats crossing all 128 columns, lightning, rain and snow, the
    // crossfades, warnings and the widest text.
    const SKY_WIDE = ['skyline clear night', 'skyline partly day', 'skyline mostly night', 'skyline overcast day', 'skyline rain day', 'skyline rain night',
      'skyline snow day', 'skyline snow night', 'skyline fog day', 'skyline fog night', 'skyline storm day', 'skyline storm night', 'skyline cloud drift normal',
      'skyline dusk +0 min', 'skyline dusk +40 min', 'skyline dusk +80 min', 'skyline tornado warning', 'skyline sailboat', 'skyline speedboat',
      'skyline lightning', 'skyline heavy rain falling', 'skyline heavy snow falling', 'skyline rain slant right', 'skyline rain slant left',
      'skyline wheel and ripples slow', 'skyline crossfade clear to rain', 'skyline crossfade clouds arriving', 'skyline no weather yet',
      'skyline negative temperature', 'skyline widest text'];
    for (const name of [...WIDE, ...SKY_WIDE.filter((n) => !WIDE.includes(n))]) {
      const s = S.find((x) => x.name === name);
      if (!s) throw new Error(`no scenario "${name}" to widen`);
      add(`wide ${name}`, wide(s.payload), s.renders.map((r) => r.opts), bytes(s.frames), bytes(s.logos), { s3only: true, clouds: bytes(s.clouds) });
    }
    for (const name of ['anim DUE leaves, times slide', 'anim view switch']) {
      const s = S.find((x) => x.name === name);
      const anim = draw.createTransitAnimator();
      S.push({
        s3only: true,
        name: `wide ${name}`,
        steps: s.steps.map((st) => {
          const p = wide(st.payload), view = anim.step(p, st.now, st.t);
          return { ...st, payload: p, px: hexOf(draw.render(p, { screen: 'transit', now: st.now, view, blink: st.blink })) };
        }),
      });
    }
    // The wide chooser's variant strip: eight clock faces (the strip shifts
    // by whole words to show the chosen one), the bar dropping, and a clock
    // with one face (its name instead of words).
    {
      const s = S.find((x) => x.name === 'wide peek every variant');
      const p = { ...s.payload, knob: { ...s.payload.knob, vars: s.payload.knob.vars.map((v, i) => (i === 2 ? [...v, 'words'] : v)) } };
      const base = s.renders[0].opts;
      add('wide peek strip shifts to the chosen word', p, [[2, 4], [2, 5], [2, 6], [2, 7], [1, 1]].map(([k, vi]) => ({ ...base, peek: { k, vi } })).concat([{ ...base, peek: { k: 2, vi: 7, drop: 4 } }]), bytes(s.frames), undefined, { s3only: true, clouds: bytes(s.clouds) });
      const one = { ...s.payload, knob: { ...s.payload.knob, vars: s.payload.knob.vars.map((v, i) => (i === 2 ? ['skyline'] : v)) } };
      add('wide peek a category with one variant', one, [{ ...base, peek: { k: 2, vi: 0 } }], bytes(s.frames), undefined, { s3only: true, clouds: bytes(s.clouds) });
    }
    // Wide weather (wide-spec §4): the week and 24 hours, with and without
    // the top bar, warnings, °C and negatives, and the wide conditions.
    {
      const W = require(path.join(B, 'weather'));
      const t = 1793763720; // Nov 3, 2026, 9:42 PM CST
      const base = W.testWeather('partly', null, t, false);
      base.week[3].code = 63; base.week[5].code = 73; base.hrs[4].code = 63; base.hrs[7].code = 95;
      base.hrs.forEach((h, i) => { h.pop = [0, 10, 60, 100, 0, 30, 5, 20][i % 8]; h.temp = 48 - i; });
      const sw = { ...W.toScreenWx(base), rl: 1 };
      const week = W.toWeek(base), hours24 = W.toDayHours(base);
      const wp = (wx, extra = {}) => ({ now: t, tzo: tzOffset(t), screen: 'weather', cols: 128, bright: 100, warn: null, radar: { on: false, frames: [], ft: [], timeBox: radar.FULL_TIME_BOX, split: false, tempShadow: false, wx }, ...extra });
      const one = [{ screen: 'weather' }];
      const cold = W.inUnit(W.testWeather('snow heavy', null, t, false), 'C');
      cold.week = cold.week.map((d, i) => ({ ...d, hi: d.hi - 20 + i * 4, lo: d.lo - 20 }));
      add('wide weather week', wp({ ...sw, days: [{}], week }), one, undefined, undefined, { s3only: true });
      add('wide weather week, no top bar', wp({ ...sw, days: [{}], week, notop: 1 }), one, undefined, undefined, { s3only: true });
      add('wide weather week, tornado warning', wp({ ...sw, days: [{}], week }, { warn: { kind: 'tor', lvl: 'warning' } }), [{ screen: 'weather' }, { screen: 'weather', blink: true }], undefined, undefined, { s3only: true });
      add('wide weather week, celsius below zero', wp({ ...W.toScreenWx(cold), c: 1, days: [{}], week: W.toWeek(cold), notop: 1 }), one, undefined, undefined, { s3only: true });
      add('wide weather 24 hours', wp({ ...sw, hours: [{}], hours24, tempShadow: true }), one, undefined, undefined, { s3only: true });
      add('wide weather 24 hours, no top bar', wp({ ...sw, hours: [{}], hours24, notop: 1 }), one, undefined, undefined, { s3only: true });
      add('wide weather 24 hours, severe watch', wp({ ...sw, hours: [{}], hours24 }, { warn: { kind: 'svr', lvl: 'watch' } }), one, undefined, undefined, { s3only: true });
      add('wide weather conditions, sunrise', wp({ ...sw, sun: { k: 'rise', t: t + 9 * 3600 } }), one, undefined, undefined, { s3only: true });
      add('wide weather conditions, no rain line, sunset', { ...wp({ ...sw, rl: 0, sun: { k: 'set', t: t + 3600 } }), radar: { ...wp(sw).radar, tempShadow: true, wx: { ...sw, rl: 0, sun: { k: 'set', t: t + 3600 } } } }, one, undefined, undefined, { s3only: true });
      add('wide weather conditions, tornado warning', wp({ ...sw }, { warn: { kind: 'tor', lvl: 'warning' } }), [{ screen: 'weather' }, { screen: 'weather', blink: true }], undefined, undefined, { s3only: true });
      add('wide weather conditions, celsius', wp({ ...W.toScreenWx(cold), c: 1, rl: 1 }), one, undefined, undefined, { s3only: true });
      add('wide weather hours without 24-hour data', wp({ ...sw, hours: W.toHours(base) }), one, undefined, undefined, { s3only: true });
    }
    // Wide transit, as the server formats it (arrivals.js formatWide):
    // northbound | southbound, two columns, full-width rows, the
    // chronological list; alerts, the key layout, an empty half.
    const wideFrom = (name, mapid, header, cfg = {}) => {
      const json = fixture(name);
      const now = parseCtaTime(json.ctatt.tmst);
      const r = format(normalize(json, { log: quiet }), { rows: [], showHeader: !!header, showWeather: !!cfg.wx, showKey: !!cfg.key, cols: 128, wideLayout: cfg.layout || 'split', station: { mapid }, ...(cfg.hide ? { hideLines: cfg.hide } : {}) }, { now, alerts: new Set(cfg.alerts || []), alertWords: new Map(Object.entries(cfg.words || {})) });
      return { v: 1, now, tzo: tzOffset(now), screen: 'transit', bright: 100, cols: 128, header: r.bars.showHeader ? header : null, ...(r.bars.showKey ? { key: 1 } : {}), view: r.view, ...(r.halves ? { halves: r.halves } : {}), rows: r.rows, ticker: r.ticker, wx: r.bars.showWeather ? cfg.wx : null, warn: cfg.warn || null, ...(cfg.extra || {}) };
    };
    const at = (q) => [{ screen: 'transit' }, { screen: 'transit', now: q.now + 75 }, { screen: 'transit', now: q.now + 610 }];
    const S3 = { s3only: true };
    for (const [file, mapid, name] of [['morse-2026-10-03-2316.json', '40100', 'MORSE'], ['belmont-2026-10-03-2316.json', '41320', 'BELMONT'], ['clark-lake-2026-10-03-2317.json', '40380', 'CLARK/LAKE'], ['howard-2026-10-03-2316.json', '40900', 'HOWARD'], ['jefferson-park-2026-10-03-2316.json', '41280', 'JEFF PARK']]) {
      for (const layout of ['split', 'rows']) {
        for (const [header, wx] of [[name, null], [null, null], [name, WX]]) {
          const q = wideFrom(file, mapid, header, { layout, wx });
          add(`wide transit ${q.view} ${file} ${layout} header=${!!header} wx=${!!wx}`, q, at(q), undefined, undefined, S3);
        }
      }
    }
    {
      const q = wideFrom('belmont-2026-10-03-2316.json', '41320', 'BELMONT', { alerts: ['RD'] });
      add('wide transit split alert', q, at(q), undefined, undefined, S3);
      const k = wideFrom('morse-2026-10-03-2316.json', '40100', 'MORSE', { layout: 'rows', key: true });
      add('wide transit rows key layout', k, at(k), undefined, undefined, S3);
      // Six destinations at a station without the split: two columns.
      const t0 = 1_800_000_000;
      const six = ['Howard', '95th', 'Kimball', 'Loop', 'Linden', 'Midway'].map((d, i) => ({ ln: ['RD', 'RD', 'BR', 'BR', 'PR', 'OR'][i], dest: d, full: d, known: true, dir: 1 + (i % 2) * 4, t: t0 + (i + 2) * 60 + i * 37, s: i === 3 ? 1 : 0, rn: String(900 + i) }));
      for (const [wx, alertLines] of [[WX, []], [null, ['BR', 'OR']]]) {
        const r6 = format(six, { rows: [], showHeader: true, showWeather: !!wx, cols: 128, station: { mapid: '40380' } }, { now: t0, alerts: new Set(alertLines) });
        const c = { v: 1, now: t0, tzo: tzOffset(t0), screen: 'transit', bright: 100, cols: 128, header: r6.bars.showHeader ? 'CLARK/LAKE' : null, view: r6.view, rows: r6.rows, ticker: r6.ticker, wx: r6.bars.showWeather ? wx : null, warn: null };
        add(`wide transit ${r6.view} six destinations wx=${!!wx} alerts=${alertLines.length}`, c, at(c), undefined, undefined, S3);
      }
      const r = wideFrom('clark-lake-2026-10-03-2317.json', '40380', 'CLARK/LAKE', { layout: 'rows', alerts: ['BR'] });
      // The alert's words after the circle (wide-spec §3), where they fit.
      const aw = wideFrom('belmont-2026-10-03-2316.json', '41320', 'BELMONT', { layout: 'rows', alerts: ['BR', 'RD'], words: { BR: 'MAJOR DELAYS', RD: 'SIGNIFICANT DELAYS' } });
      add('wide transit rows alert words', aw, [{ screen: 'transit' }, { screen: 'transit', blink: true }], undefined, undefined, S3);
      const ak = wideFrom('belmont-2026-10-03-2316.json', '41320', 'BELMONT', { layout: 'rows', key: true, alerts: ['BR'], words: { BR: 'MAJOR DELAYS' } });
      add('wide transit key layout alert words', ak, [{ screen: 'transit' }], undefined, undefined, S3);
      // The warning spelled out on the weather strip, with when it ends.
      for (const [warn, name] of [[{ kind: 'tor', lvl: 'warning', until: 1791248700 }, 'tornado warning until'], [{ kind: 'svr', lvl: 'warning', until: 1791252300 }, 'severe warning until'],
        [{ kind: 'svr', lvl: 'watch' }, 'severe watch'], [{ kind: 'tor', lvl: 'watch', until: 1791255900 }, 'tornado watch until']]) {
        const q = wideFrom('morse-2026-10-03-2316.json', '40100', 'MORSE', { layout: 'rows', wx: WX, warn });
        add(`wide transit ${name} on the strip`, q, [{ screen: 'transit' }, { screen: 'transit', blink: true }], undefined, undefined, S3);
      }
      add('wide transit rows alert, line colors, steps', { ...r, lnc: true, ts: true }, at(r), undefined, undefined, S3);
      const st = wideFrom('morse-2026-10-03-2316.json', '40100', 'MORSE', { extra: { stale: 1, hclock: false } });
      add('wide transit split stale, no clock', st, at(st), undefined, undefined, S3);
      // A half with no trains (one direction's run ended).
      const half = { ...st, stale: 0, rows: st.rows.filter((x) => !x.h) };
      add('wide transit split one half empty', half, [{ screen: 'transit' }], undefined, undefined, S3);
      // Overnight on a wide board: the 64 layout on both panels.
      add('wide transit overnight', { ...st, stale: 0, rows: [] }, [{ screen: 'transit' }], undefined, undefined, S3);
      // The owl, clock and NO TRAINS 32 px in, the line across: with the
      // weather strip (and a warning on it), and NO DATA.
      add('wide transit overnight, weather strip and warning', { ...st, view: 'dest', halves: null, stale: 0, rows: [], wx: WX, warn: { kind: 'tor', lvl: 'watch', until: st.now + 3600 } }, [{ screen: 'transit' }, { screen: 'transit', now: st.now + 60, iconT: 5000 }], undefined, undefined, S3);
      add('wide transit no data', { ...st, stale: 1, rows: [] }, [{ screen: 'transit' }], undefined, undefined, S3);
      // Many destinations: the chronological list, full width.
      const many = { ...wideFrom('clark-lake-2026-10-03-2317.json', '40380', 'CLARK/LAKE', { layout: 'rows', wx: WX }) };
      const chrono = { ...many, view: 'chrono', rows: many.rows.map((x, i) => ({ ...x, t: [x.t[0]], s: [x.s[0]], rn: String(800 + i) })), wx: null };
      add('wide transit chrono', chrono, at(chrono), undefined, undefined, S3);
    }
    // Wide radar (wide-spec §5): 128-wide crops of the recorded frames, the
    // station at x69; the time chip, the dots on the map, the temperature
    // chip, warnings, the clock options, the current time rolling, peek.
    {
      const wideFrames = {};
      for (const [stamp, mode, mapid] of [['202008102100', 'rain', '40100'], ['202202021800', 'snow', '41320'], ['202611032144', 'rain', '40380']]) {
        const st = require(path.join(B, 'stations.json')).find((x) => x.mapid === mapid);
        const loc = radar.loadLocation(radar.wideKey(mapid));
        const wld = radar.parseWld(fs.readFileSync(path.join(B, 'fixtures', 'mrms', `lcref_${stamp}.wld`), 'utf8'));
        const crop = await radar.crops(fs.createReadStream(path.join(B, 'fixtures', 'mrms', `lcref_${stamp}.png`)), wld, [{ key: 'k', lat: st.lat, lon: st.lon, width: loc.width, mx: loc.mx }]);
        const { dbz, geo } = crop.get('k');
        wideFrames[`${mapid}-${stamp}`] = radar.toFrame(dbz, geo, mode, loc).bytes;
      }
      for (const [key, bytes] of Object.entries(wideFrames)) {
        const t = radar.timeOf(key.split('-')[1]);
        const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
        const frames = Object.fromEntries(ids.map((id) => [id, bytes]));
        const r = { on: true, frames: ids, ft: ids.map((_, i) => t - (5 - i) * 360), timeBox: null, split: false, wide: 1 };
        const q = (radarExtra = {}, extra = {}) => ({ now: t, tzo: tzOffset(t), bright: 100, cols: 128, warn: null, radar: { ...r, ...radarExtra }, ...extra });
        add(`wide radar ${key}`, q(), [{ screen: 'weather', idx: 5 }, { screen: 'weather', idx: 0 }, { screen: 'weather', idx: 3 }], frames, undefined, S3);
        add(`wide radar ${key} temperature chip`, q({ cond: true, temp: 58 }), [{ screen: 'weather', idx: 2 }], frames, undefined, S3);
      }
      const [key, bytes] = Object.entries(wideFrames)[0];
      const t = radar.timeOf(key.split('-')[1]);
      const ids = ['a', 'b', 'c'];
      const frames = Object.fromEntries(ids.map((id) => [id, bytes]));
      const r = { on: true, frames: ids, ft: ids.map((_, i) => t - (2 - i) * 360), timeBox: null, split: false, wide: 1 };
      const q = (radarExtra = {}, extra = {}) => ({ now: t, tzo: tzOffset(t), bright: 100, cols: 128, warn: null, radar: { ...r, ...radarExtra }, ...extra });
      add('wide radar time off, temperature', q({ showTime: false, temp: -4, icon: 'snow' }), [{ screen: 'weather', idx: 1 }], frames, undefined, S3);
      add('wide radar clock none', q({ clock: 'none' }), [{ screen: 'weather', idx: 1 }], frames, undefined, S3);
      add('wide radar clock age', q({ clock: 'age' }), [{ screen: 'weather', idx: 0 }, { screen: 'weather', idx: 2, now: t + 3000 }], frames, undefined, S3);
      add('wide radar clock now', q({ clock: 'now' }), [{ screen: 'weather', idx: 0, now: t + 3600 * 5 }], frames, undefined, S3);
      add('wide radar tornado warning blink', q({}, { warn: { kind: 'tor', lvl: 'warning' } }), [{ screen: 'weather', idx: 2 }, { screen: 'weather', idx: 2, blink: true }], frames, undefined, S3);
      add('wide radar svr watch, time off', q({ showTime: false, temp: 71 }, { warn: { kind: 'svr', lvl: 'watch' } }), [{ screen: 'weather', idx: 2 }], frames, undefined, S3);
      add('wide radar dimmed, precip brightness', q({ rb: 60 }, { bright: 40 }), [{ screen: 'weather', idx: 2 }], frames, undefined, S3);
      add('wide radar frames not all on hand', q(), [{ screen: 'weather', idx: 2 }], { a: bytes }, undefined, S3);
      const ps = [0.25, 0.5, 0.75];
      add('wide rolls radar current time', q({ clock: 'now' }), ps.map((pp) => ({ screen: 'weather', idx: 2, nums: { 'rad.clock': { from: '12:59', p: pp } } })), frames, undefined, S3);
      const hdr = wide(payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { wx: WX }));
      add('wide rolls header clock', hdr, ps.map((pp) => ({ screen: 'transit', nums: { 'hdr.clock': { from: '12:59', p: pp } } })), undefined, undefined, S3);
    }
    // Wide ticker: the platform sign (full names, the status icon right).
    for (const [file, mapid, name] of [['morse-2026-10-03-2316.json', '40100', 'MORSE'], ['clark-lake-2026-10-03-2317.json', '40380', 'CLARK/LAKE']]) {
      const q = { ...wideFrom(file, mapid, name, { alerts: ['BL'] }), screen: 'ticker', tickerHeader: name, tickerFill: 40 };
      add(`wide ticker ${file}`, q, [{ screen: 'ticker' }, { screen: 'ticker', page: 1 }, { screen: 'ticker', page: 1, slide: 0.4 }, { screen: 'ticker', now: q.now + 130 }], undefined, undefined, S3);
    }
    // Wide animator: a departing train in a half, a row joining, a row moving halves' tops.
    {
      const anim = draw.createTransitAnimator();
      const r = (h, ln, lbl, t) => ({ ln, lbl, t, s: t.map(() => 0), a: 0, h });
      const base2 = { ...base, cols: 128, view: 'split', halves: ['NORTHBOUND', 'SOUTHBOUND'] };
      const one = { ...base2, now: NOW, rows: [r(0, 'RD', 'HOWARD', [NOW + 10, min(6), min(12)]), r(1, 'RD', '95TH', [min(3), min(9)])] };
      const two = { ...base2, now: NOW + 45, rows: [r(0, 'RD', 'HOWARD', [min(6), min(12)]), r(0, 'PR', 'LINDEN', [min(4)]), r(1, 'RD', '95TH', [min(3), min(9)])] };
      const steps = [{ p: one, now: NOW, t: 0 }, ...ts(1000, 1800, 14).map((t) => ({ p: two, now: NOW + 45, t }))];
      S.push({
        s3only: true,
        name: 'wide anim split departure and a joining row',
        steps: steps.map((st) => {
          const view = anim.step(st.p, st.now, st.t);
          return { payload: st.p, now: st.now, t: st.t, blink: false, px: hexOf(draw.render(st.p, { screen: 'transit', now: st.now, view })) };
        }),
      });
    }
    const p = wide(payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { wx: WX }));
    const from = Array.from(draw.render(p, { screen: 'ticker' }).px);
    const narrow = Array.from(draw.render({ ...p, cols: undefined }, { screen: 'ticker' }).px);
    add('wide screen slide ticker to transit', p, [0, 60, 150, 225, 449, 450].map((t) => ({ screen: 'transit', slide: { from, t, dir: 1 } })), undefined, undefined, { s3only: true });
    add('wide screen slide from the left', p, [60, 225].map((t) => ({ screen: 'transit', slide: { from, t, dir: -1 } })), undefined, undefined, { s3only: true });
    add('wide screen slide from a 64-wide frame', p, [0, 150, 300].map((t) => ({ screen: 'transit', slide: { from: narrow, t, dir: 1 } })), undefined, undefined, { s3only: true });
    add('wide screen fade ticker to transit', p, [0, 100, 170, 400].map((t) => ({ screen: 'transit', fade: { from, t } })), undefined, undefined, { s3only: true });
    add('wide screen fade from a 64-wide frame', p, [40, 200].map((t) => ({ screen: 'transit', fade: { from: narrow, t } })), undefined, undefined, { s3only: true });
  }
  return S;
}

module.exports = { build };

if (require.main === module) {
  build().then((s) => { fs.writeFileSync(process.argv[2] || '/dev/stdout', JSON.stringify(s)); });
}
