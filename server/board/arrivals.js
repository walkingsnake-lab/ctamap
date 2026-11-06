'use strict';
// Train Tracker arrivals -> the `rows` and `ticker` parts of /board/update.
// Rules: docs/board/design-spec.md §5–6 and docs/board/contract.md.

const { parseCtaTime, wallSeconds } = require('./time');
const { lineCode, shortDest, fullDest, resolveDest, endsHere, LINE_ORDER, LINE_DESTS, DEST_MAPID } = require('./destinations');
const { measure, fit, ligatures } = require('./fonts');
const G = require('./glyphs');

// Transit row geometry (x positions on the 64px panel).
const LABEL_X = 5;       // after the 3px color block + 2px gap
const CHRONO_LABEL_X = 9; // chronological rows: digit, 1px gap, 3px block, 2px gap
const RIGHT_X = 63;      // times are right-aligned to the last column
const LABEL_GAP = 3;     // min px between label and times
// Times are 3px apart, tightening to 2px when a row is full (draw.js does the
// same), so labels are fitted against the 2px spacing.
const MIN_TIME_GAP = 2;
const MAX_TIMES = 3;

// Ticker geometry: destination starts 2px into the fill (x=7); minutes and
// the 11px "min" glyph are right-aligned to column 62.
const TICKER_DEST_PX = 32;
const TICKER_COUNT = 6;
// Wide board (draw.js drawTickerItemWide): the full name from x7, 3 px
// clear of the widest time ("99" and the min glyph, right-aligned at 116).
const WIDE_TICKER_DEST_PX = 116 - (measure('5x7', '99') + 2 + measure('5x7', String.fromCodePoint(G.MIN))) - 3 - 7 + 1;

// Drop an arrival once it's this far past its time (contract countdown rules).
const DROP_GRACE = 30;

// Chronological view (design spec §5): one train per row. Sent with a couple
// of extra trains so the board can bring the next one in between updates.
const CHRONO_EXTRA = 2;
// Back to destination rows only after they've fit this long. 0 = switch
// back as soon as they fit; raise it if the view flips too often.
const CHRONO_HOLD = 0;
// Chrono labels are fitted against the widest single time ("99m" or "DUE").
const CHRONO_TIME_PX = Math.max(measure('small', '99m'), measure('small', 'DUE'));

// Alerted rows (design spec §5, CTA alerts): the label, then the 5x5 alert
// circle 2px after it, at least 2px clear of the times. The label (`al`) is
// fitted against the widest times this row's count can reach, so it doesn't
// change length as the times count down; when it's cut it ends with the
// two-dot CUT glyph.
const ALERT_ICON_PX = 5;
const ALERT_ICON_GAP = 2;  // blank px between the label and the circle
const ALERT_TIME_GAP = 2;  // blank px between the circle and the times
const CUT = String.fromCodePoint(G.CUT);

// Widest `n` times can be: the first may read DUE (later ones can't: one DUE
// per destination), the rest two digits, at the tight 2px spacing.
function widestTimesWidth(n) {
  if (!n) return 0;
  return Math.max(measure('small', 'DUE'), measure('small', '99'))
    + (n - 1) * (measure('small', '99') + MIN_TIME_GAP);
}

// name: the full uppercase label. px: room from the label's x to the end of
// the alert circle.
function alertLabel(name, px) {
  const room = px - ALERT_ICON_GAP - ALERT_ICON_PX;
  const full = fit('small', name, Infinity);
  if (measure('small', full) <= room) return full;
  const chars = [...full];
  while (chars.length && measure('small', chars.join('').trimEnd() + CUT) > room) chars.pop();
  const cut = chars.join('').trimEnd();
  return cut ? cut + CUT : '';
}

// The header, weather strip, and key are the most the board shows. When the
// live destinations don't fit as rows, the weather strip goes first, then
// the header (in the key layout, the station line), then the key, so up to 5
// destinations stay as rows. Past 5 the board lists one train per row
// (chooseView): the header (or the key) comes back if it's on, the weather
// strip and the station line stay off. Re-evaluated on every update, so a station
// like Merchandise Mart gains and loses the weather strip as rush-only
// Purple service comes and goes. Returns the bars to show and which were
// hidden.
function fitBars(n, showHeader, showWeather, showKey = false) {
  const hidden = [];
  let h = showHeader, w = showWeather, k = showKey;
  if (n > maxRows(h, w, k)) {
    if (w) { w = false; hidden.push('weather'); }
    if (k) {
      // Key layout: the station line goes before the key; past 5 the key stays.
      if (n > maxRows(h, w, k) && h) { h = false; hidden.push('header'); }
      if (n > maxRows(h, w, k) && n <= maxRows(false, false, false)) { k = false; hidden.push('key'); }
    } else if (n > maxRows(h, w) && n <= maxRows(false, false) && h) { h = false; hidden.push('header'); }
  }
  return { showHeader: h, showWeather: w, showKey: k, hidden };
}

// Destination rows, or the chronological list when they don't fit.
// prev: the last result for this board ({view, fitSince}), or null.
function chooseView(destCount, max, prev, now, hold = CHRONO_HOLD) {
  if (destCount > max) return { view: 'chrono', fitSince: null };
  if (!prev || prev.view !== 'chrono') return { view: 'dest', fitSince: null };
  const fitSince = prev.fitSince != null ? prev.fitSince : now;
  return now - fitSince >= hold ? { view: 'dest', fitSince: null } : { view: 'chrono', fitSince };
}

// Max transit rows by header/weather/key toggles (design spec §5 table):
// each takes one row.
function maxRows(showHeader, showWeather, showKey = false) {
  return 5 - (showHeader ? 1 : 0) - (showWeather ? 1 : 0) - (showKey ? 1 : 0);
}

// What the board will draw for a time (contract countdown rules: minutes
// rounded up, DUE within 60 s).
const { timeText } = require('./draw');

// Widest the times group can get before the next update: digits only shrink
// as times count down, but the first time may turn into DUE.
function worstTimesWidth(times, now, horizon = 60, gap = MIN_TIME_GAP) {
  let w = 0;
  times.forEach((t, i) => {
    let txt = timeText(t, now);
    if (i === 0 && timeText(t, now + horizon) === 'DUE') txt = 'DUE';
    w += measure('small', txt) + (i ? gap : 0);
  });
  return w;
}

// Raw Train Tracker JSON -> normalized arrivals for this station.
// Arrival times are taken relative to the response's timestamp (tmst) on
// CTA's wall clock and added to `now` (the fetch time; tmst when not given),
// so DST changes can't shift them (see wallSeconds).
function normalize(json, { log = console, unknown = new Set(), now } = {}) {
  const c = json && json.ctatt;
  if (!c) throw new Error('not a Train Tracker response');
  const tmstWall = wallSeconds(c.tmst);
  const anchor = now != null ? now : parseCtaTime(c.tmst);
  const arrival = (arrT) => {
    const w = wallSeconds(arrT);
    if (w == null) return null;
    if (tmstWall == null || anchor == null) return parseCtaTime(arrT);
    return Math.round(anchor + w - tmstWall);
  };
  let etas = c.eta || [];
  if (!Array.isArray(etas)) etas = [etas];
  const out = [];
  for (const e of etas) {
    // Trains ending at this station (Terminal Arrival at Howard, "63rd Street"
    // trains at Ashland/63rd).
    if (endsHere(e)) continue;
    const ln = lineCode(e.rt);
    const t = arrival(e.arrT);
    if (!ln || t == null) continue;
    const resolved = resolveDest(e.destNm, e.staId);
    const dest = shortDest(resolved);
    if (!dest.known && !unknown.has(e.destNm)) {
      unknown.add(e.destNm);
      log.warn(`[board] unknown destination "${e.destNm}" (${e.rt}); add it to server/board/destinations.js`);
    }
    out.push({ ln, dest: dest.name, full: fullDest(resolved), known: dest.known, dir: Number(e.trDr) || 0, t, s: e.isSch === '1' ? 1 : 0, rn: e.rn });
  }
  return out;
}

// Times only count down. CTA predictions are whole minutes from when they're
// made, so a fresh prediction often comes back up to a minute later than
// what the board has counted down to (often "2 min" for a train already
// showing DUE), and the board would jump back up. For a run (line + run
// number) seen in the previous fetch, a new prediction later than the
// previous one keeps the previous time when:
// - the previous one is DUE within DUE_LEAD of this fetch (a fetch reaches
//   the board up to DUE_LEAD later: tracker poll + board poll) and the new
//   one is within DUE_LATCH_MAX; one already DUE is held at the DUE edge
//   (now + 60 s);
// - otherwise, it's less than SLIP_S later.
// Bigger slips are real delays and show.
const DUE_S = 60;
const DUE_LEAD = 60;
const DUE_LATCH_MAX = 180;
const SLIP_S = 60;

function latchDue(prev, next, now) {
  if (!prev || !prev.length) return next;
  const before = new Map();
  for (const a of prev) if (a.rn != null) before.set(`${a.ln}:${a.rn}`, a.t);
  return next.map((a) => {
    const old = a.rn != null ? before.get(`${a.ln}:${a.rn}`) : undefined;
    if (old == null || a.t <= old) return a;
    if (old - DUE_S <= now + DUE_LEAD) {
      if (a.t <= now + DUE_S || a.t > now + DUE_LATCH_MAX) return a; // DUE anyway, or a real delay
      return { ...a, t: Math.max(old, now + DUE_S) };
    }
    return a.t - old < SLIP_S ? { ...a, t: old } : a;
  });
}

// cfg: the board's state (rows filter, showHeader, showWeather, showKey).
// alerts: Set of line codes with an active service alert.
// prevView: this board's last view state (see chooseView); the new one is
// returned as viewState for the caller to keep.
function format(arrivals, cfg, { now, alerts = new Set(), prevView = null } = {}) {
  // Lines & destinations: lines turned off here, and (otherLines false)
  // lines that don't serve the station (cfg.lines: the station's lines).
  const off = new Set(cfg.hideLines || []);
  const serves = cfg.otherLines === false && Array.isArray(cfg.lines) ? new Set(cfg.lines) : null;
  const live = arrivals.filter((a) => a.t >= now - DROP_GRACE && !off.has(a.ln) && (!serves || serves.has(a.ln))).sort((a, b) => a.t - b.t);

  // Group into rows by line + short destination.
  const groups = new Map();
  for (const a of live) {
    const key = `${a.ln}:${a.dest}`;
    if (!groups.has(key)) groups.set(key, { key, ln: a.ln, dest: a.dest, full: a.full || a.dest, known: a.known, dir: a.dir, items: [] });
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
  if (cfg.cols === 128) {
    const shownWide = live.filter((a) => shownKeys.has(`${a.ln}:${a.dest}`));
    return { ...formatWide(ordered, shownWide, cfg, now, alerts), ticker: tickerOf(shownWide, alerts, true) };
  }
  const bars = cfg.autoFit === false
    ? { showHeader: cfg.showHeader, showWeather: cfg.showWeather, showKey: !!cfg.showKey, hidden: [] }
    : fitBars(ordered.length, cfg.showHeader, cfg.showWeather, !!cfg.showKey);
  const max = maxRows(bars.showHeader, bars.showWeather, bars.showKey);
  const viewState = chooseView(ordered.length, max, prevView, now);
  const shown = live.filter((a) => shownKeys.has(`${a.ln}:${a.dest}`));

  const chronoLabelPx = RIGHT_X - LABEL_GAP - CHRONO_TIME_PX - CHRONO_LABEL_X + 1;
  const chronoAlertPx = RIGHT_X - ALERT_TIME_GAP - CHRONO_TIME_PX - CHRONO_LABEL_X + 1;
  const rows = viewState.view === 'chrono' ? shown.slice(0, max + CHRONO_EXTRA).map((a) => {
    const alerted = alerts.has(a.ln);
    return {
      ln: a.ln,
      lbl: fit('small', a.dest.toUpperCase(), chronoLabelPx),
      t: [a.t],
      s: [a.s],
      a: alerted ? 1 : 0,
      ...(alerted ? { al: alertLabel(a.dest.toUpperCase(), chronoAlertPx) } : {}),
      rn: a.rn != null ? String(a.rn) : undefined,
    };
  }) : ordered.slice(0, max).map((g) => {
    const items = g.items.slice(0, MAX_TIMES);
    const t = items.map((a) => a.t);
    const labelPx = RIGHT_X - LABEL_GAP - worstTimesWidth(t, now) - LABEL_X + 1;
    const alerted = alerts.has(g.ln);
    const row = {
      ln: g.ln,
      lbl: fit('small', g.dest.toUpperCase(), labelPx),
      t,
      s: items.map((a) => a.s),
      a: alerted ? 1 : 0,
    };
    if (alerted) {
      const timesPx = Math.max(widestTimesWidth(t.length), worstTimesWidth(t, now));
      row.al = alertLabel(g.dest.toUpperCase(), RIGHT_X - ALERT_TIME_GAP - timesPx - LABEL_X + 1);
    }
    return row;
  });

  return { view: viewState.view, viewState, rows, ticker: tickerOf(shown, alerts), bars };
}

// Ticker: the next individual arrivals among the shown destinations. A
// wide board shows the full names.
function tickerOf(shown, alerts, wide = false) {
  return shown.slice(0, TICKER_COUNT).map((a) => ({
    ln: a.ln,
    d: wide ? fit('5x7', ligatures(a.full || a.dest), WIDE_TICKER_DEST_PX) : fit('5x7', ligatures(a.dest), TICKER_DEST_PX),
    t: a.t,
    s: a.s,
    a: alerts.has(a.ln) ? 1 : 0,
  }));
}

// ---- wide board (cfg.cols 128: two panels, 128 x 32; wide-spec §3) ----
// The same row anatomy as 64, the right edge at column 127:
//   - destination rows (wideLayout 'rows'): full CTA names (FOREST PARK),
//     up to WIDE_TIMES times, dropping a time rather than cutting the name
//     (a time goes when it would come within LABEL_GAP of it);
//   - northbound | southbound halves (wideLayout 'split', the default):
//     where every line at the station runs north-south (station-dirs.json)
//     and the station isn't a terminal of one; up to SPLIT_ROWS rows a half,
//     64-style rows (short names, 3 times) in columns 0-61 and 66-127, the
//     direction labels on top and the station line at the bottom;
//   - two columns (`cols2`) of 64-style rows under the header, where the
//     split isn't true (or for the rows layout once the rows don't fit);
//   - past that, the chronological list, labels full width.
// Rows of the halves and columns carry `h` (0 left, 1 right).
const WIDE_RIGHT = 127;
const WIDE_TIMES = 5;
const HALVES = [[0, 61], [66, 127]];
const SPLIT_ROWS = 3;
const SPLIT_LABELS = ['NORTHBOUND', 'SOUTHBOUND'];
const STATION_DIRS = require('./station-dirs.json');

// trDr 1 heads to the line's northern end (Howard, Linden, Kimball, O'Hare,
// Harlem, the Loop for Orange and Pink), 5 to the southern: the left and
// right halves where the track runs north-south.
const HALF_OF_DIR = { 1: 0, 5: 1 };

// Whether the split is true at the station: every line there runs
// north-south (not on the Loop) and both directions stop here (no terminal).
function splitTrue(mapid, lines) {
  const dirs = STATION_DIRS[mapid];
  if (!dirs || !lines || !lines.length) return false;
  for (const ln of lines) {
    if (dirs[ln] !== 'ns') return false;
    if ((LINE_DESTS[ln] || []).some((d) => DEST_MAPID[d] === mapid)) return false;
  }
  return true;
}

// One 64-style row in column range [x0, right]: short name, up to 3 times.
function halfRow(g, h, now, alerted) {
  const [x0, right] = HALVES[h];
  const items = g.items.slice(0, MAX_TIMES);
  const t = items.map((a) => a.t);
  const labelPx = right - LABEL_GAP - worstTimesWidth(t, now) - (x0 + LABEL_X) + 1;
  const row = { ln: g.ln, lbl: fit('small', g.dest.toUpperCase(), labelPx), t, s: items.map((a) => a.s), a: alerted ? 1 : 0, h };
  if (alerted) {
    const timesPx = Math.max(widestTimesWidth(t.length), worstTimesWidth(t, now));
    row.al = alertLabel(g.dest.toUpperCase(), right - ALERT_TIME_GAP - timesPx - (x0 + LABEL_X) + 1);
  }
  return row;
}

// A full-width row: the full name, as many of WIDE_TIMES times as leave it whole.
function wideRow(g, now, alerted) {
  const name = g.full.toUpperCase();
  const nameW = alerted ? measure('small', fit('small', name, Infinity)) + ALERT_ICON_GAP + ALERT_ICON_PX : measure('small', fit('small', name, Infinity));
  const gap = alerted ? ALERT_TIME_GAP : LABEL_GAP;
  const room = (k) => {
    const t = g.items.slice(0, k).map((a) => a.t);
    const timesPx = alerted ? Math.max(widestTimesWidth(k), worstTimesWidth(t, now)) : worstTimesWidth(t, now);
    return WIDE_RIGHT - gap - timesPx - LABEL_X + 1;
  };
  let k = Math.min(WIDE_TIMES, g.items.length);
  while (k > 1 && nameW > room(k)) k--;
  const items = g.items.slice(0, k);
  const row = { ln: g.ln, lbl: fit('small', name, room(k)), t: items.map((a) => a.t), s: items.map((a) => a.s), a: alerted ? 1 : 0 };
  if (alerted) row.al = alertLabel(name, room(k));
  return row;
}

function formatWide(ordered, shown, cfg, now, alerts) {
  const view = (v) => ({ view: v, fitSince: null });
  const lines = [...new Set(ordered.map((g) => g.ln))];
  // Northbound | southbound.
  if (cfg.wideLayout !== 'rows' && splitTrue(cfg.station && cfg.station.mapid, lines)
      && ordered.every((g) => g.dir in HALF_OF_DIR)) {
    const halves = [[], []];
    for (const g of ordered) halves[HALF_OF_DIR[g.dir]].push(g);
    if (halves.every((x) => x.length <= SPLIT_ROWS)) {
      const hidden = [...(cfg.showWeather ? ['weather'] : []), ...(cfg.showKey ? ['key'] : [])];
      return {
        view: 'split', viewState: view('split'), halves: SPLIT_LABELS,
        rows: halves.flatMap((x, h) => x.map((g) => halfRow(g, h, now, alerts.has(g.ln)))),
        bars: { showHeader: cfg.showHeader, showWeather: false, showKey: false, hidden },
      };
    }
  }
  // Full-width destination rows (the rows layout).
  if (cfg.wideLayout === 'rows') {
    const bars = fitBars(ordered.length, cfg.showHeader, cfg.showWeather, !!cfg.showKey);
    const max = maxRows(bars.showHeader, bars.showWeather, bars.showKey);
    if (ordered.length <= max) {
      return { view: 'dest', viewState: view('dest'), rows: ordered.map((g) => wideRow(g, now, alerts.has(g.ln))), bars };
    }
  }
  // Two columns under the header (the key layout's station line goes on top).
  const perCol = Math.ceil(ordered.length / 2);
  const top = cfg.showHeader || !!cfg.showKey;
  const bars2 = fitBars(perCol, top, cfg.showWeather, false);
  if (perCol <= maxRows(bars2.showHeader, bars2.showWeather, false)) {
    return {
      view: 'cols2', viewState: view('cols2'),
      rows: ordered.map((g, i) => halfRow(g, i < perCol ? 0 : 1, now, alerts.has(g.ln))),
      bars: { ...bars2, hidden: [...bars2.hidden, ...(cfg.showKey ? ['key'] : [])] },
    };
  }
  // The chronological list.
  const bars = fitBars(ordered.length, cfg.showHeader, cfg.showWeather, !!cfg.showKey);
  const max = maxRows(bars.showHeader, bars.showWeather, bars.showKey);
  const labelPx = WIDE_RIGHT - LABEL_GAP - CHRONO_TIME_PX - CHRONO_LABEL_X + 1;
  const alertPx = WIDE_RIGHT - ALERT_TIME_GAP - CHRONO_TIME_PX - CHRONO_LABEL_X + 1;
  const rows = shown.slice(0, max + CHRONO_EXTRA).map((a) => {
    const alerted = alerts.has(a.ln), name = (a.full || a.dest).toUpperCase();
    return {
      ln: a.ln, lbl: fit('small', name, labelPx), t: [a.t], s: [a.s], a: alerted ? 1 : 0,
      ...(alerted ? { al: alertLabel(name, alertPx) } : {}),
      rn: a.rn != null ? String(a.rn) : undefined,
    };
  });
  return { view: 'chrono', viewState: view('chrono'), rows, bars };
}

module.exports = { normalize, latchDue, splitTrue, HALVES, SPLIT_LABELS, WIDE_TIMES, WIDE_TICKER_DEST_PX, DUE_LATCH_MAX, SLIP_S, format, maxRows, fitBars, chooseView, timeText, worstTimesWidth, widestTimesWidth, alertLabel, TICKER_DEST_PX, CHRONO_EXTRA, CHRONO_HOLD };
