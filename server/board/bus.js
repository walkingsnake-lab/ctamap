'use strict';
// CTA buses for the board (design spec §5, "Buses"): a board's list of up
// to three buses (a route, a direction, a stop), Bus Tracker predictions for
// their stops, and the rows the board draws from them.

const { measure, fit, hasGlyph } = require('./fonts');
const { wallSeconds } = require('./time');

const MAX_BUSES = 3;
const BUS_TIMES = 2;   // per row: Bus Tracker predicts about half an hour ahead
// Room for a label on a 64 px row beside the widest two times ("DUE 99").
const LABEL_PX = 63 - 3 - (measure('small', 'DUE') + 2 + measure('small', '99')) - 5 + 1;
const DROP_GRACE = 30; // as trains (arrivals.js)
const HEADER = 'BUSES';

const DIR_SHORT = { northbound: 'NB', southbound: 'SB', eastbound: 'EB', westbound: 'WB', north: 'NB', south: 'SB', east: 'EB', west: 'WB' };
const dirShort = (dir) => DIR_SHORT[String(dir || '').trim().toLowerCase()] || String(dir || '').trim().toUpperCase().slice(0, 2);

// A label as the board can draw it: uppercase, only the small font's
// characters, single spaces.
function cleanLabel(s) {
  return [...String(s == null ? '' : s).toUpperCase()].filter((ch) => ch === ' ' || hasGlyph('small', ch.codePointAt(0))).join('').replace(/\s+/g, ' ').trim();
}
// The row's label: the owner's, else the route and direction ("22 SB").
const autoLabel = (bus) => cleanLabel(`${bus.rt} ${dirShort(bus.dir)}`);
const labelOf = (bus) => (bus.label ? bus.label : autoLabel(bus));

class BusError extends Error {}

// A board's `buses` setting, checked and tidied: [{rt, dir, stpid, stpnm, label?}].
function cleanBuses(val) {
  if (!Array.isArray(val) || val.length > MAX_BUSES) throw new BusError(`buses must be a list of up to ${MAX_BUSES}`);
  const out = val.map((b) => {
    if (!b || typeof b !== 'object') throw new BusError('each bus needs rt, dir and stpid');
    const rt = String(b.rt == null ? '' : b.rt).trim(), dir = String(b.dir == null ? '' : b.dir).trim(), stpid = String(b.stpid == null ? '' : b.stpid).trim();
    if (!/^[A-Za-z0-9]{1,5}$/.test(rt)) throw new BusError('rt must be a route like "22" or "X49"');
    if (!/^[A-Za-z ]{1,24}$/.test(dir)) throw new BusError('dir must be a direction like "Southbound"');
    if (!/^\d{1,8}$/.test(stpid)) throw new BusError('stpid must be a stop number');
    const bus = { rt, dir, stpid, stpnm: String(b.stpnm == null ? '' : b.stpnm).trim().slice(0, 60) };
    const label = cleanLabel(b.label);
    if (label && label !== autoLabel(bus)) {
      if (measure('small', label) > LABEL_PX) throw new BusError(`label "${label}" is too long`);
      bus.label = label;
    }
    return bus;
  });
  // The board tells rows apart by their labels.
  const labels = out.map(labelOf);
  if (new Set(labels).size !== labels.length) throw new BusError('two buses share a label; rename one');
  return out;
}

// "20261124 07:31" or "20261124 07:31:05" (tmres=s) -> seconds on CTA's
// wall clock (differences between two of these are what matter); epoch
// milliseconds (unixTime=true) -> seconds.
function stamp(x) {
  if (x == null || x === '') return null;
  if (typeof x === 'number' || /^\d{11,}$/.test(String(x))) return Number(x) / 1000;
  const s = String(x).trim();
  return wallSeconds(/^\d{8} \d{2}:\d{2}$/.test(s) ? `${s}:00` : s);
}

const list = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
// A stop with nothing coming answers with an error of its own.
const NOTHING = /no arrival times|no service scheduled/i;
const NO_STOP = /no data found/i;

// Raw getpredictions JSON -> { preds, quiet, gone }.
// preds: [{ln: 'BUS', stpid, rt, dir, des, rn, t}] (rn: vehicle@stop, for
// latchDue); times are taken relative to the prediction's own timestamp and
// added to `now` (the fetch time), as arrivals.js does for trains.
// quiet: stops with nothing predicted; gone: stops Bus Tracker doesn't know.
// Throws on an error that isn't about one stop (a bad key, the daily limit).
function normalize(json, { now } = {}) {
  const root = json && json['bustime-response'];
  if (!root || typeof root !== 'object') throw new Error('not a Bus Tracker response');
  const quiet = new Set(), gone = new Set();
  for (const e of list(root.error)) {
    const msg = String((e && e.msg) || 'error');
    if (e && e.stpid != null && NOTHING.test(msg)) quiet.add(String(e.stpid));
    else if (e && e.stpid != null && NO_STOP.test(msg)) gone.add(String(e.stpid));
    else if (!(NOTHING.test(msg) && list(root.error).length === 1 && !list(root.prd).length)) throw new Error(msg);
  }
  const preds = [];
  for (const p of list(root.prd)) {
    // Canceled, or not picking up (expressed; discharge only).
    if (Number(p.dyn) === 1 || Number(p.dyn) === 4 || Number(p.flagstop) === 2) continue;
    const at = stamp(p.prdtm), made = stamp(p.tmstmp);
    if (at == null || p.stpid == null || p.rt == null) continue;
    const t = now != null && made != null ? Math.round(now + at - made) : Math.round(at);
    preds.push({ ln: 'BUS', stpid: String(p.stpid), rt: String(p.rt), dir: String(p.rtdir || ''), des: String(p.des || ''), rn: p.vid != null ? `${p.vid}@${p.stpid}` : null, t });
  }
  preds.sort((a, b) => a.t - b.t);
  return { preds, quiet, gone };
}

// The board's rows: one per bus, in the list's order, each with its next
// `times` predictions. `k: 1`: the row stays when it has none (the board
// draws "--"), so the list never moves.
function busRows(buses, preds, now, { px = LABEL_PX, times = BUS_TIMES, extra = {} } = {}) {
  return (buses || []).map((bus) => {
    const mine = (preds || []).filter((p) => p.stpid === bus.stpid && p.rt.toUpperCase() === bus.rt.toUpperCase() && p.t >= now - DROP_GRACE).slice(0, times);
    return { ln: 'BUS', lbl: fit('small', labelOf(bus), px), t: mine.map((p) => p.t), s: mine.map(() => 0), a: 0, k: 1, ...extra };
  });
}

// A row in a half of a wide board (62 px): one time less when the label
// needs the room.
function busHalfRows(buses, preds, now, h) {
  const HALF_PX = 62;
  return busRows(buses, preds, now, { extra: { h } }).map((r, i) => {
    const full = labelOf(buses[i]);
    const room = (n) => HALF_PX - 5 - 3 - (n > 1 ? measure('small', 'DUE') + 2 + measure('small', '99') : Math.max(measure('small', 'DUE'), measure('small', '99')));
    if (measure('small', full) <= room(2)) return { ...r, lbl: full };
    return { ...r, lbl: fit('small', full, room(1)), t: r.t.slice(0, 1), s: r.s.slice(0, 1) };
  });
}

module.exports = { MAX_BUSES, BUS_TIMES, LABEL_PX, HEADER, BusError, dirShort, cleanLabel, autoLabel, labelOf, cleanBuses, stamp, normalize, busRows, busHalfRows };
