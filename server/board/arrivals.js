'use strict';
// Train Tracker arrivals -> the `rows` and `ticker` parts of /board/update.
// Rules: docs/board/design-spec.md §5–6 and docs/board/contract.md.

const { parseCtaTime } = require('./time');
const { lineCode, shortDest, LINE_ORDER } = require('./destinations');
const { measure, fit, ligatures } = require('./fonts');

// Transit row geometry (x positions on the 64px panel).
const LABEL_X = 5;       // after the 3px color block + 2px gap
const RIGHT_X = 63;      // times are right-aligned to the last column
const TIME_GAP = 3;      // px between arrival times
const LABEL_GAP = 3;     // min px between label and times
const MAX_TIMES = 3;

// Ticker geometry: destination starts 2px into the fill (x=7); minutes and
// the 11px "min" glyph are right-aligned to column 62.
const TICKER_DEST_PX = 32;
const TICKER_COUNT = 6;

// Drop an arrival once it's this far past its time (contract countdown rules).
const DROP_GRACE = 30;

// Max transit rows by header/weather toggles (design spec §5 table).
function maxRows(showHeader, showWeather) {
  if (showHeader && showWeather) return 2;
  if (showWeather) return 3;
  if (showHeader) return 4;
  return 5;
}

// What the board will draw for a time (contract: DUE at <= 1 min).
function timeText(t, now) {
  const min = Math.floor((t - now) / 60);
  return min <= 1 ? 'DUE' : String(min);
}

// Widest the times group can get before the next update: digits only shrink
// as times count down, but the first time may turn into DUE.
function worstTimesWidth(times, now, horizon = 60) {
  let w = 0;
  times.forEach((t, i) => {
    let txt = timeText(t, now);
    if (i === 0 && timeText(t, now + horizon) === 'DUE') txt = 'DUE';
    w += measure('small', txt) + (i ? TIME_GAP : 0);
  });
  return w;
}

// Raw Train Tracker JSON -> normalized arrivals for this station.
function normalize(json, { log = console, unknown = new Set() } = {}) {
  const c = json && json.ctatt;
  if (!c) throw new Error('not a Train Tracker response');
  let etas = c.eta || [];
  if (!Array.isArray(etas)) etas = [etas];
  const out = [];
  for (const e of etas) {
    // Trains ending at this station (e.g. "Terminal Arrival" at Howard).
    if (String(e.destNm).trim() === String(e.staNm).trim()) continue;
    const ln = lineCode(e.rt);
    const t = parseCtaTime(e.arrT);
    if (!ln || t == null) continue;
    const dest = shortDest(e.destNm);
    if (!dest.known && !unknown.has(e.destNm)) {
      unknown.add(e.destNm);
      log.warn(`[board] unknown destination "${e.destNm}" (${e.rt}); add it to server/board/destinations.js`);
    }
    out.push({ ln, dest: dest.name, known: dest.known, dir: Number(e.trDr) || 0, t, s: e.isSch === '1' ? 1 : 0, rn: e.rn });
  }
  return out;
}

// cfg: the board's state (rows filter, showHeader, showWeather).
// alerts: Set of line codes with an active service alert.
function format(arrivals, cfg, { now, alerts = new Set() } = {}) {
  const live = arrivals.filter((a) => a.t >= now - DROP_GRACE).sort((a, b) => a.t - b.t);

  // Group into rows by line + short destination.
  const groups = new Map();
  for (const a of live) {
    const key = `${a.ln}:${a.dest}`;
    if (!groups.has(key)) groups.set(key, { key, ln: a.ln, dest: a.dest, known: a.known, dir: a.dir, items: [] });
    groups.get(key).items.push(a);
  }

  // Order: the board's configured list (which is also the filter), with
  // destinations CTA doesn't normally use appended; or, with no list, line
  // order, then direction, then name.
  let ordered;
  const want = cfg.rows || [];
  if (want.length) {
    const listed = want.map((k) => groups.get(k)).filter(Boolean);
    const extra = [...groups.values()].filter((g) => !want.includes(g.key) && !g.known);
    ordered = [...listed, ...extra];
  } else {
    ordered = [...groups.values()].sort((a, b) =>
      LINE_ORDER.indexOf(a.ln) - LINE_ORDER.indexOf(b.ln) || a.dir - b.dir || a.dest.localeCompare(b.dest));
  }
  const shownKeys = new Set(ordered.map((g) => g.key));

  const rows = ordered.slice(0, maxRows(cfg.showHeader, cfg.showWeather)).map((g) => {
    const items = g.items.slice(0, MAX_TIMES);
    const t = items.map((a) => a.t);
    const labelPx = RIGHT_X - LABEL_GAP - worstTimesWidth(t, now) - LABEL_X + 1;
    return {
      ln: g.ln,
      lbl: fit('small', g.dest.toUpperCase(), labelPx),
      t,
      s: items.map((a) => a.s),
      a: alerts.has(g.ln) ? 1 : 0,
    };
  });

  // Ticker: the next individual arrivals among the shown destinations.
  const ticker = live.filter((a) => shownKeys.has(`${a.ln}:${a.dest}`)).slice(0, TICKER_COUNT).map((a) => ({
    ln: a.ln,
    d: fit('5x7', ligatures(a.dest), TICKER_DEST_PX),
    t: a.t,
    s: a.s,
    a: alerts.has(a.ln) ? 1 : 0,
  }));

  return { rows, ticker };
}

module.exports = { normalize, format, maxRows, timeText, worstTimesWidth, TICKER_DEST_PX };
