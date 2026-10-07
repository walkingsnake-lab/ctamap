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
async function build() {
  const S = [];
  const arrays = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.from(v)])) : undefined);
  const add = (name, payload, optsList, frames, logos) => {
    S.push({
      name, payload,
      frames: arrays(frames),
      logos: arrays(logos),
      renders: optsList.map((o) => ({ opts: o, px: hexOf(draw.render(payload, { ...o, frames, logos })) })),
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
  // Divider toggles: header line on, weather line off (dest and chrono views).
  for (const [name, hdr] of [['belmont-2026-10-03-2316.json', 'BELMONT'], ['clark-lake-2026-10-03-2317.json', 'CLARK/LAKE']]) {
    const p = { ...payloadFrom(name, hdr, { wx: WX }), headerDivider: true, wxDivider: false };
    add(`dividers ${hdr}`, p, [{ screen: 'transit' }, { screen: 'transit', blink: true }]);
  }
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
  add('overnight', night, [{ screen: 'transit' }]);
  add('overnight weather', { ...night, wx: WX }, [{ screen: 'transit' }]);
  add('no data', { ...night, stale: 1 }, [{ screen: 'transit' }]);
  add('no data weather', { ...night, stale: 1, wx: WX }, [{ screen: 'transit' }]);
  add('stale', { ...payloadFrom('morse-2026-10-03-2316.json', 'MORSE'), stale: 1 }, [{ screen: 'transit' }, { screen: 'ticker' }, { screen: 'ticker', page: 1, slide: 0.5 }]);
  // Rolls via explicit roll state are covered by the animator sequences below.

  // Ticker: pages and slides.
  const tk = payloadFrom('morse-2026-10-03-2316.json', 'MORSE', { alerts: [] });
  tk.ticker[1] = { ...tk.ticker[1], a: 1 };
  add('ticker', tk, [0, 1, 2].flatMap((page) => [0, 0.3, 0.5, 0.8].map((slide) => ({ screen: 'ticker', page, slide }))));
  add('ticker no header', { ...tk, header: null }, [{ screen: 'ticker' }, { screen: 'ticker', now: tk.now + 400 }]);
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
  // Weather screen (radar screen with no frames): every warning, cold/hot
  // extremes (minus bar, word skipped for 3-digit temps, high/low losing its
  // degree signs), and a response without the extras.
  {
    const t = 1791140000;
    const wx = { icon: 'pcloudy_day', temp: 57, word: 'PT CLOUDY', hi: 63, lo: 49, feels: 53, wind: 'NW 12', pop: 20 };
    const wxCases = [
      ['normal', wx, null],
      ['svr watch', wx, { kind: 'svr', lvl: 'watch' }],
      ['svr warning', wx, { kind: 'svr', lvl: 'warning' }],
      ['tor watch', wx, { kind: 'tor', lvl: 'watch' }],
      ['tor warning', wx, { kind: 'tor', lvl: 'warning' }],
      ['cold', { icon: 'snow', temp: -12, word: 'SNOW', hi: -3, lo: -21, feels: -31, wind: 'NW 22', pop: 100 }, null],
      ['hot', { icon: 'sun', temp: 101, word: 'PT CLOUDY', hi: 103, lo: 82, feels: 112, wind: 'CALM', pop: 0 }, null],
      ['no extras', { icon: 'moon', temp: 48, word: 'CLEAR', hi: 61, lo: 44, feels: null, wind: null, pop: null }, null],
    ];
    for (const [name, w, warn] of wxCases) {
      add(`weather screen ${name}`, { now: t, tzo: tzOffset(t), bright: 100, warn, radar: { on: false, frames: [], ft: [], timeBox: radar.FULL_TIME_BOX, split: false, wx: w } }, [{ screen: 'weather' }, { screen: 'weather', blink: true }]);
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
      add(`baseball ${layout} light band flash`, bbp(layout, { ...live, home: { ...lightHome, at: t - 32 } }), [{ screen: 'baseball' }], undefined, logos);
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
