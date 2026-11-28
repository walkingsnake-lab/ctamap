'use strict';
// The Metra screen's payload (design spec §5, "Metra"; contract "Metra"):
// a board's Metra station, laid out from the schedule (metra-schedule.js)
// as the board draws it. The server does the fitting (short names cut with
// the two-dot glyph, line colors, which days need naming); the board counts
// down from the times it's sent.
//
// Realtime (tracked trains, delays, cancellations) isn't built: without a
// Metra key every countdown is grey (`rt: 'nokey'`), as decided. Rows carry
// `late` and `x` so the board's drawing of them is in place for it.

const { measure } = require('./fonts');
const G = require('./glyphs');
const { departures, daysLeft } = require('./metra-schedule');
const { TZ } = require('./time');

const CUT = String.fromCodePoint(G.CUT);
const W64 = 64, WIDE = 128;
// Halves of a two-panel board, as the 'L' split (draw.js HALVES).
const HALVES = [[0, 61], [66, 127]];
const ROWS = 3;            // trains per half (or per 64 panel)
const SEND = ROWS + 1;     // one spare, so a departure doesn't leave a gap until the next update
const TERM_ROWS = 4;       // full-width terminus rows
const NAME_GAP = 4;        // px between the time column and the names
const RIGHT_GAP = 2;       // px between a name and the countdown or day
const BLOCK = 5;           // a line block (3 px) and its gap
const TERM_RIGHT = 19;     // a terminus row's countdown at its widest (11h59)
const HOME_MIN = 40;       // the terminus header's home stop name, at least
const DAY_AFTER = 12 * 3600; // a departure further than this shows its day (design spec §5)

// Lines too dark on the panel as Metra publishes them (decided Nov 28; to
// confirm on the panel).
const COLOR_FIX = { HC: '#b4643c', SWS: '#3f7af0' };
// Destinations as the station screen and the 64 show them (27 px and less is
// the aim; anything longer is cut with the two-dot glyph). Downtown
// terminals are all CHICAGO: inbound is inbound.
// Only shortenings a rider reads at a glance (PK, LK, ST); other long names
// are cut with the two-dot glyph (MANHAT‥), as decided Nov 28.
const SHORT = {
  'Chicago OTC': 'CHICAGO', 'Chicago Union Station': 'CHICAGO', 'Millennium Station': 'CHICAGO', 'LaSalle Street': 'CHICAGO',
  'South Chicago (93rd)': 'S CHGO', 'Orland Park 179th': 'ORLAND', 'Blue Island-Vermont': 'BLUE ISL', 'Blue Island': 'BLUE ISL',
  'Tinley-80th': 'TINLEY', 'Fairview Ave.': 'FAIRVIEW', 'University Park': 'UNIV PK', 'Highland Park': 'HIGHLAND PK',
  'Franklin Park': 'FRANKLIN PK', 'National St': 'NATL ST', 'Des Plaines': 'DES PLNS', 'Lake Forest': 'LK FOREST',
  'Crystal Lake': 'CRYSTAL LK',
};
// Destinations on the wide terminus rows, which have room for more.
const LONG = {
  'Chicago Union Station': 'CHICAGO UNION STA', 'Millennium Station': 'MILLENNIUM STA', 'South Chicago (93rd)': 'SOUTH CHICAGO',
  'Blue Island-Vermont': 'BLUE ISLAND', 'Orland Park 179th': 'ORLAND PARK', 'LaSalle Street': 'LASALLE ST',
};

const up = (s) => String(s || '').toUpperCase().replace(/[^\x20-\x7e]/g, '');
const fits = (s, px) => measure('small', s) <= px;
// `text` in at most `px`: whole if it fits, else cut at a letter and ended
// with the two-dot glyph (MANHAT‥). Never empty when there's room for the glyph.
function fit(text, px) {
  const s = up(text);
  if (fits(s, px)) return s;
  for (let n = s.length - 1; n > 0; n--) {
    const cut = s.slice(0, n).trimEnd() + CUT;
    if (fits(cut, px)) return cut;
  }
  return fits(CUT, px) ? CUT : '';
}
const shortDest = (h) => SHORT[h] || h;
const longDest = (h) => LONG[h] || h;

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
// "5:51" (12-hour, no AM/PM), as the board draws it from `t`.
const timeText = (t) => timeFmt.format(new Date(t * 1000)).replace(/\s?[AP]M$/i, '');
const dayText = (t) => up(dayFmt.format(new Date(t * 1000)));

// The lines at a stop and which ways trains leave it, from the schedule.
// Cached per model.
const stopInfo = new WeakMap();
function infoOf(model, stop) {
  if (!stopInfo.has(model)) stopInfo.set(model, new Map());
  const cache = stopInfo.get(model);
  if (cache.has(stop)) return cache.get(stop);
  const lines = new Set(), leaves = { in: false, out: false };
  for (const [ti, , , , noPickup] of model.byStop.get(stop) || []) {
    const trip = model.trips[ti];
    lines.add(trip.route);
    if (!noPickup && trip.last !== stop) leaves[trip.inbound ? 'in' : 'out'] = true;
  }
  const info = { lines: [...lines].sort(), terminus: leaves.in !== leaves.out, leaves };
  cache.set(stop, info);
  return info;
}

const colorOf = (model, rt) => COLOR_FIX[rt] || (model.routes.get(rt) || {}).color || '#8a8a8a';
const lineOf = (model, rt) => ({ n: up((model.routes.get(rt) || {}).short || rt), c: colorOf(model, rt) });

// Which way a 64 board shows: 'in' or 'out', or by the clock ('auto':
// inbound before noon, outbound after).
function dirOf(setting, now) {
  if (setting === 'in' || setting === 'out') return setting;
  const h = +new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now * 1000));
  return h < 12 ? 'in' : 'out';
}

// One row: {ln, c, t, s, d, dy?, late?, x?, arr?}. `s` 1: schedule only (not
// tracked; grey countdown). `dy`: the departure's day, for a board to show
// in place of the countdown when the train is more than 12 hours off.
function rowOf(model, dep, now, d, extra = {}) {
  const r = { ln: dep.route, c: colorOf(model, dep.route), t: dep.at, s: 1, d };
  if (dep.at - now > DAY_AFTER) r.dy = dayText(dep.at);
  return { ...r, ...extra };
}

// Names in a column: from the widest time + NAME_GAP to the right column
// (the countdown, DUE or a day, whichever the rows can show) less RIGHT_GAP.
function nameRoom(deps, now, x0, x1, block) {
  const tw = Math.max(0, ...deps.map((d) => measure('small', timeText(d.at))));
  const rw = Math.max(measure('small', 'DUE'), ...deps.map((d) => (d.at - now > DAY_AFTER ? measure('small', dayText(d.at)) : 0)));
  return (x1 - x0 + 1) - (block ? BLOCK : 0) - tw - NAME_GAP - RIGHT_GAP - rw;
}

// The payload's `metra` object for a board's Metra setting, or null when it
// has none. model: the schedule (null before one downloads). cols: 64 or 128.
// rt: 'nokey' (no realtime: all grey), 'live' or 'stale'.
function metraView(model, setting, now, { cols = 64, rt = 'nokey' } = {}) {
  if (!setting || !setting.stop) return null;
  const wide = cols === WIDE;
  const base = { rt, rows: [] };
  if (!model || daysLeft(model, now) < 0) return { ...base, mode: wide ? 'station' : 'one', exp: 1, stn: { name: '', lines: [] } };
  const stop = model.stops.get(setting.stop);
  if (!stop) return { ...base, mode: wide ? 'station' : 'one', exp: 1, stn: { name: up(setting.stop), lines: [] } };
  const info = infoOf(model, setting.stop);
  const lines = info.lines.map((rt) => lineOf(model, rt));
  const block = info.lines.length > 1;
  // The home stop limits a terminus's rows only (design spec §5, T2); at a
  // through station it would empty one direction for good.
  const home = info.terminus && setting.to && setting.to !== setting.stop && model.stops.get(setting.to) ? setting.to : null;
  // Station line: the name, then each line's name (3 px apart), and on two
  // panels the clock (17 px with its gap at the right).
  const lineW = lines.reduce((a, l) => a + 3 + measure('small', l.n), 0);
  const stnName = fit(stop.name, (wide ? WIDE - 20 : W64) - lineW);
  const stn = { name: stnName, lines };

  if (wide && info.terminus) {
    // Every train leaves one way: full-width rows (T1), or only the trains
    // that stop at the home stop, with their arrival there (T2).
    const deps = departures(model, setting.stop, now, { perDir: TERM_ROWS + 1, to: home });
    const list = info.leaves.in ? deps.in : deps.out;
    const rows = list.map((dep) => {
      if (home) return rowOf(model, dep, now, fit(longDest(dep.headsign), 70 - 4 - 27), { arr: dep.arr });
      // Name from x 44 to the countdown (11h59 or a day, 19 px) less 3 px.
      return rowOf(model, dep, now, fit(longDest(dep.headsign), 127 - 44 - TERM_RIGHT - 3 + 1));
    });
    // The header: the station, then `TO <home>`, then the clock (17 px and
    // its gap). The terminus draws no line names there; the home stop gets
    // at least HOME_MIN px.
    const room = WIDE - 20;
    let name = fit(stop.name, room), homeName = null;
    if (home) {
      const to = 3 + measure('small', 'TO ') + 1;   // the gap after the name, `TO `, and its letter gap
      const full = up(model.stops.get(home).name);
      name = fit(stop.name, Math.max(room - to - measure('small', full), room - to - HOME_MIN));
      homeName = fit(full, room - measure('small', name) - to);
    }
    return { ...base, mode: 'terminus', stn: { name, lines }, home: homeName, rows };
  }

  const deps = departures(model, setting.stop, now, { perDir: SEND, to: home });
  if (!wide) {
    // One panel: one direction (the only one at a terminus).
    const dir = info.terminus ? (info.leaves.in ? 'in' : 'out') : dirOf(setting.dir, now);
    const list = deps[dir];
    // Fitted for every row sent, so the spare doesn't overlap when it moves up.
    const room = nameRoom(list, now, 0, W64 - 1, block);
    const rows = list.map((dep) => (home
      ? rowOf(model, dep, now, '', { arr: dep.arr })
      : rowOf(model, dep, now, fit(shortDest(dep.headsign), room))));
    return { ...base, mode: 'one', label: dir === 'in' ? 'INBOUND' : 'OUTBOUND', blk: block ? 1 : 0, stn, rows };
  }
  // Two panels, a through station: inbound | outbound.
  const rows = [];
  [['in', 0], ['out', 1]].forEach(([dir, h]) => {
    const list = deps[dir];
    const [x0, x1] = HALVES[h];
    const room = nameRoom(list, now, x0, x1, block);
    for (const dep of list) rows.push(rowOf(model, dep, now, fit(shortDest(dep.headsign), room), { h }));
  });
  return { ...base, mode: 'station', halves: ['INBOUND', 'OUTBOUND'], blk: block ? 1 : 0, stn, rows };
}

// The picker (control page): every line with each stop it serves, in order
// outbound: the line's longest trip, then each branch's stops (`br`: the
// branch's far end) in the order its trips run, so no station is left out.
function stopsByLine(model) {
  if (!model) return [];
  // Each trip's stops in order, outbound (an inbound trip read backwards).
  const seqOf = new Map();
  for (const [stop, list] of model.byStop) {
    for (const [ti, , , s] of list) {
      if (!seqOf.has(ti)) seqOf.set(ti, []);
      seqOf.get(ti).push([s, stop]);
    }
  }
  const tripsOf = new Map();
  for (const [ti, seq] of seqOf) {
    const trip = model.trips[ti];
    seq.sort((a, b) => a[0] - b[0]);
    const stops = seq.map(([, stop]) => stop);
    if (trip.inbound) stops.reverse();
    if (!tripsOf.has(trip.route)) tripsOf.set(trip.route, []);
    tripsOf.get(trip.route).push(stops);
  }
  const nameOf = (id) => (model.stops.get(id) || {}).name || id;
  const out = [];
  for (const [rt, route] of [...model.routes].sort((a, b) => a[0].localeCompare(b[0]))) {
    const trips = tripsOf.get(rt) || [];
    const seen = new Set(), stops = [];
    for (;;) {
      // The trip with the most stops not listed yet (the longest, first).
      let best = null, bestNew = 0;
      for (const t of trips) {
        const n = t.reduce((a, id) => a + (seen.has(id) ? 0 : 1), 0);
        if (n > bestNew) { best = t; bestNew = n; }
      }
      if (!best) break;
      const br = stops.length ? nameOf(best[best.length - 1]) : null;
      for (const id of best) {
        if (seen.has(id)) continue;
        seen.add(id);
        stops.push(br ? { id, name: nameOf(id), br } : { id, name: nameOf(id) });
      }
    }
    out.push({ rt, name: route.long || rt, color: colorOf(model, rt), stops });
  }
  return out;
}

module.exports = { metraView, stopsByLine, fit, dirOf, infoOf, COLOR_FIX, SHORT, LONG, DAY_AFTER, HALVES };
