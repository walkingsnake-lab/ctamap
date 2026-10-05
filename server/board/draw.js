// Board drawing: the reference implementation of how the 64x32 board draws a
// /board/update payload in either transit view (destination rows or the
// chronological list), including its animations (per-digit roll, fades and
// slides, ticker slide, alert blink). Runs unchanged in Node (render.js, tests, previews)
// and in the browser (the simulator), and has no dependencies; fonts and
// icons are passed in. The CircuitPython board code mirrors this file.
//
// Layout rules: docs/board/design-spec.md §3–8.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BoardDraw = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

  // ---- frame ----
  // fonts: { name: { [codepoint]: [dw, w, h, xoff, yoff, row0bits, row1bits, ...] } }
  // Row bits are MSB-left within the glyph width.

  class Frame {
    constructor(w, h, fonts) {
      this.w = w || 64; this.h = h || 32;
      this.fonts = fonts;
      this.px = new Uint8Array(this.w * this.h * 3);
      this.clip = null; // [x0, y0, x1, y1] inclusive
    }

    set(x, y, rgb) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      const c = this.clip;
      if (c && (x < c[0] || y < c[1] || x > c[2] || y > c[3])) return;
      const i = (y * this.w + x) * 3;
      this.px[i] = rgb[0]; this.px[i + 1] = rgb[1]; this.px[i + 2] = rgb[2];
    }

    get(x, y) {
      const i = (y * this.w + x) * 3;
      return [this.px[i], this.px[i + 1], this.px[i + 2]];
    }

    fill(x, y, w, h, color) {
      const rgb = hex(color);
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, rgb);
    }

    withClip(x0, y0, x1, y1, fn) {
      const prev = this.clip;
      this.clip = [x0, y0, x1, y1];
      try { fn(); } finally { this.clip = prev; }
    }

    // Draw text with its baseline at row `baseline` (glyph rows with BDF
    // y >= 0 land on rows baseline-1 and up). Returns x after the last advance.
    text(fontName, str, x, baseline, color) {
      const font = this.fonts[fontName];
      const rgb = hex(color);
      for (const ch of str) {
        const g = font[ch.codePointAt(0)];
        if (!g) continue;
        const [dw, w, h, xo, yo] = g;
        const top = baseline - (yo + h);
        for (let r = 0; r < h; r++) {
          const bits = g[5 + r];
          for (let c = 0; c < w; c++) if ((bits >> (w - 1 - c)) & 1) this.set(x + xo + c, top + r, rgb);
        }
        x += dw;
      }
      return x;
    }
  }

  function measureWith(fonts, fontName, str) {
    const font = fonts[fontName];
    let w = 0;
    for (const ch of str) { const g = font[ch.codePointAt(0)]; if (g) w += g[0]; }
    return w > 0 ? w - 1 : 0;
  }

  // ---- pure helpers (also used by the server) ----

  // Minutes shown for an arrival: rounded up, like CTA's own predictions
  // (each is a whole number of minutes from when it was made, so a fresh
  // "2 min" counts down from 120 s). <= 1 shows DUE: 0-60 s out, which is
  // when CTA flags the train as approaching (isApp). The board never shows 1.
  const minutesUntil = (t, now) => Math.ceil((t - now) / 60);

  // What the board draws for an arrival time. Only the soonest train of a
  // destination may show DUE (`due` false for the others): bunched trains
  // within a minute of each other would otherwise both read DUE, so the
  // later one shows 2.
  function timeText(t, now, due = true) {
    const min = minutesUntil(t, now);
    return min <= 1 ? (due ? 'DUE' : '2') : String(min);
  }

  // Chronological view: digits + "m" (the glyph's own 1px spacing), DUE bare.
  function chronoText(t, now, due = true) {
    const min = minutesUntil(t, now);
    return min <= 1 ? (due ? 'DUE' : '2m') : `${min}m`;
  }

  // Arrivals stay listed until 30 s past their time (contract countdown rules).
  const DROP_GRACE = 30;

  // Max transit rows for the header/weather toggles (design spec §5).
  function maxRows(hasHeader, hasWeather) {
    return (hasHeader ? 4 : 5) - (hasWeather ? 2 : 0);
  }

  // Row tops for n transit rows. Without the header, rows are spread evenly
  // from the panel top to the weather divider (or the bottom edge): equal gaps
  // above, between, and below, the odd pixel going to the bottom. With the
  // header: spec-pinned cases, else the preferred pitch centered in the area.
  function rowTops(n, hasHeader, hasWeather) {
    if (n === 0) return [];
    if (!hasHeader) {
      if (!hasWeather && n === 4) return [1, 9, 17, 25];   // pinned: 3px between rows
      const areaH = hasWeather ? 22 : 32;   // rows 0-21 (divider on 22) or 0-31
      const gap = Math.max(1, Math.round((areaH - 5 * n) / (n + 1)));
      const top = Math.floor((areaH - 5 * n - (n - 1) * gap) / 2);
      return Array.from({ length: n }, (_, i) => top + i * (5 + gap));
    }
    if (hasHeader && !hasWeather && n === 4) return [9, 15, 21, 27];
    if (hasHeader && !hasWeather && n === 3) return [10, 18, 26];
    const areaTop = 9;
    const areaBottom = hasWeather ? 20 : 31;
    const areaH = areaBottom - areaTop + 1;
    const preferred = { 2: 8, 3: 8, 4: 6, 5: 6 };
    const pitch = n === 1 ? 0 : Math.min(preferred[n], Math.floor((areaH - 5) / (n - 1)));
    const block = (n - 1) * pitch + 5;
    const top = areaTop + Math.max(0, Math.floor((areaH - block) / 2));
    return Array.from({ length: n }, (_, i) => top + i * pitch);
  }

  // Rows as the board shows them at `now`: past arrivals dropped (the list
  // shifts), rows with nothing left removed.
  function liveRows(p, now) {
    const out = [];
    for (const r of p.rows || []) {
      const t = [], s = [];
      r.t.forEach((x, i) => { if (x >= now - DROP_GRACE) { t.push(x); s.push(r.s ? r.s[i] : 0); } });
      if (t.length) out.push({ ...r, t, s });
    }
    return out;
  }

  const liveTicker = (p, now) => (p.ticker || []).filter((x) => x.t >= now - DROP_GRACE);

  // Stable key for a transit time slot, used to detect changes to animate.
  const slotKey = (r, k) => `${r.ln}:${r.lbl}:${k}`;

  // ---- easing ----
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  // ---- renderer ----

  function create({ fonts, icons, glyphs: G, tz = 'America/Chicago', makeFrame }) {
    const measure = (font, str) => measureWith(fonts, font, str);
    const newFrame = makeFrame || (() => new Frame(64, 32, fonts));
    const s = (cp) => String.fromCodePoint(cp);

    // Line colors for thin strokes (the chronological view's index digits):
    // Brown and Purple are too dark as 1px strokes, so they're brightened.
    const DIGIT_OVERRIDE = { BR: '#a8673f', PR: '#9168e0' };
    const LINE = { RD: '#c60c30', BL: '#00a1de', BR: '#62361b', GR: '#009b3a', OR: '#f9461c', PR: '#522398', PK: '#e27ea6', YL: '#f9e300' };
    const DIGIT = Object.fromEntries(Object.entries(LINE).map(([k, v]) => [k, DIGIT_OVERRIDE[k] || v]));
    const C = {
      label: '#d8d8d8', clock: '#cccccc', radarTime: '#7a7a7a', radarAmpm: '#555555', wxText: '#555555', amber: '#ffb000', dimAmber: '#9c6a00',
      sch: '#b0b0b0', schDim: '#6e6e6e', grey: '#8f8f8f', band: '#202020', divider: '#333333',
      tickerHead: '#a6a6a6', index: '#1f2f35', white: '#ffffff', red: '#ff2020',
      watch: '#ffd800', warnSevere: '#ff8000', warnTornado: '#ff2020', noTrains: '#6c6c6c', indicator: '#3a3a3a',
    };

    const TIME_GAP = 3;   // px between arrival times...
    const TIGHT_GAP = 2;  // ...tightened when the row is full
    const LABEL_GAP = 3;  // min px between the label and the times
    const TAG_GAP = 3;    // px between warning icon and word
    const ROLL_DIST = 6;  // px a digit travels during a roll (5px glyph + 1px gap)
    const scaleColor = (hexc, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hexc.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
    const rtext = (f, font, str, right, base, color) => f.text(font, str, right - measure(font, str) + 1, base, color);

    const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    // "1:02": 12-hour Chicago time, no AM/PM, no leading zero.
    const clockText = (now) => clockFmt.format(new Date(now * 1000)).replace(/\s?[AP]M$/i, '');

    function drawIcon(f, name, x, y) {
      icons.ICONS[name].forEach((row, j) => [...row].forEach((c, i) => {
        if (c !== '.') f.fill(x + i, y + j, 1, 1, icons.PALETTE[c]);
      }));
    }

    function drawHeader(f, name, now, band, nameColor) {
      if (band) f.fill(0, 0, 64, 7, band);
      f.text('small', name, 1, 6, nameColor);
      rtext(f, 'small', clockText(now), 62, 6, C.clock);
    }

    function drawWeather(f, wx, warn) {
      f.fill(0, 22, 64, 1, C.divider);
      drawIcon(f, wx.icon, 0, 24);
      const base = 31;
      f.text('small', `${wx.temp}°`, 10, base, C.wxText);
      if (warn) {
        const glyph = warn.kind === 'tor' ? G.FUNNEL : G.BOLT;
        const word = warn.lvl === 'warning' ? 'WARNING' : 'WATCH';
        const color = warn.lvl === 'watch' ? C.watch : warn.kind === 'tor' ? C.warnTornado : C.warnSevere;
        const w = measure('small', s(glyph)) + TAG_GAP + measure('small', word);
        const x = f.text('small', s(glyph), 63 - w + 1, base, color);
        f.text('small', word, x + TAG_GAP - 1, base, color);
      } else {
        rtext(f, 'small', wx.word, 63, base, C.wxText);
      }
    }

    // One time cell, right-aligned at `right`, optionally mid-roll from
    // `roll.from`. Same-length numbers roll only the digits that changed;
    // anything else (length change, to/from DUE) rolls the whole cell.
    function drawTimeCell(f, text, right, top, color, roll) {
      const base = top + 5;
      if (!roll || roll.from === text || roll.p >= 1) { rtext(f, 'small', text, right, base, color); return; }
      const up = Math.round(easeInOut(roll.p) * ROLL_DIST);
      f.withClip(0, top, 63, top + 4, () => {
        const from = roll.from;
        const num = /^\d+m?$/;
        const perDigit = from.length === text.length && num.test(from) && num.test(text);
        if (perDigit) {
          let x = right - measure('small', text) + 1;
          for (let i = 0; i < text.length; i++) {
            if (from[i] === text[i]) f.text('small', text[i], x, base, color);
            else {
              f.text('small', from[i], x, base - up, color);
              f.text('small', text[i], x, base - up + ROLL_DIST, color);
            }
            x += measure('small', text[i]) + 1;
          }
        } else {
          rtext(f, 'small', from, right, base - up, color);
          rtext(f, 'small', text, right, base - up + ROLL_DIST, color);
        }
      });
    }

    // Lay out one row's times: right-aligned group, 3px gaps tightening to 2px
    // when the row is full. Returns cells (right-to-left order not assumed).
    function layoutCells(r, now) {
      const texts = r.t.map((t, k) => timeText(t, now, k === 0));
      const widthAt = (gap) => texts.reduce((w, txt, i) => w + measure('small', txt) + (i ? gap : 0), 0);
      const labelEnd = 5 + measure('small', r.lbl) - 1;
      const gap = 63 - widthAt(TIME_GAP) + 1 - labelEnd - 1 >= LABEL_GAP ? TIME_GAP : TIGHT_GAP;
      const cells = new Array(texts.length);
      let x = 63;
      for (let k = texts.length - 1; k >= 0; k--) {
        const sch = r.s && r.s[k];
        cells[k] = {
          id: slotKey(r, k), t: r.t[k], text: texts[k], right: x, alpha: 1, roll: null,
          color: sch ? (k ? C.schDim : C.sch) : (k ? C.dimAmber : C.amber),
        };
        x -= measure('small', texts[k]) + gap;
      }
      return cells;
    }

    // The transit screen as data: what to draw where, before any animation.
    // The animator (createTransitAnimator) adjusts positions, colors, and alphas.
    function buildTransitView(p, now) {
      if (p.view === 'chrono') return buildChronoView(p, now);
      const rows = liveRows(p, now);
      const tops = rowTops(rows.length, !!p.header, !!p.wx);
      return {
        now,
        mode: 'dest',
        header: p.header,
        wx: p.wx,
        warn: p.warn,
        rows: rows.map((r, i) => ({
          key: `${r.ln}:${r.lbl}`, ln: r.ln, lbl: r.lbl, a: r.a, top: tops[i], alpha: 1,
          cells: layoutCells(r, now),
        })),
      };
    }

    // Chronological view: one train per row, soonest first; the payload's
    // extra trains wait below until a row frees up.
    function buildChronoView(p, now) {
      const rows = liveRows(p, now).slice(0, maxRows(!!p.header, !!p.wx));
      const tops = rowTops(rows.length, !!p.header, !!p.wx);
      const seenDest = new Set();
      return {
        now,
        mode: 'chrono',
        pitch: tops.length > 1 ? tops[1] - tops[0] : 6,
        header: p.header,
        wx: p.wx,
        warn: p.warn,
        rows: rows.map((r, i) => {
          const dest = `${r.ln}:${r.lbl}`;
          const due = !seenDest.has(dest); // chronological: the first one per destination is the soonest
          seenDest.add(dest);
          const key = r.rn != null ? `rn:${r.rn}` : `${r.ln}:${r.lbl}:${r.t[0]}`;
          const sch = r.s && r.s[0];
          return {
            key, ln: r.ln, lbl: r.lbl, a: r.a, num: i + 1, top: tops[i], alpha: 1,
            cells: [{
              id: key, t: r.t[0], text: chronoText(r.t[0], now, due), right: 63, alpha: 1, roll: null,
              color: sch ? (i ? C.schDim : C.sch) : (i ? C.dimAmber : C.amber),
            }],
          };
        }),
      };
    }

    const fade = (color, alpha) => (alpha >= 1 ? color : scaleColor(color, Math.max(0, alpha)));

    function drawViewRow(f, row, blink) {
      const top = Math.round(row.top);
      const line = fade(row.num != null ? DIGIT[row.ln] : LINE[row.ln], row.alpha);
      if (row.a && blink) {
        icons.ALERT_BANG.forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') f.fill(i, top + j, 1, 1, line); }));
      } else if (row.num != null) {
        // Chronological view: the row's position as a line-colored digit.
        drawTimeCell(f, String(row.num), 2, top, line, row.numRoll);
      } else {
        f.fill(0, top, 3, 5, line);
      }
      f.text('small', row.lbl, 5, top + 5, fade(C.label, row.alpha));
      for (const cell of row.cells) {
        const a = cell.alpha * row.alpha;
        if (a <= 0) continue;
        drawTimeCell(f, cell.text, Math.round(cell.right), top, fade(cell.color, a), cell.roll);
      }
    }

    function drawOvernight(f, p, now) {
      const clock = clockText(now);
      const nt = 'NO TRAINS';
      const blockH = 10 + 3 + 5; // 10px digits, gap, label
      const areaH = p.wx ? 22 : 32;
      const top = Math.floor((areaH - blockH) / 2);
      f.text('clock', clock, Math.floor((64 - measure('clock', clock)) / 2), top + 10, C.clock);
      f.text('small', nt, Math.floor((64 - measure('small', nt)) / 2), top + 18, C.noTrains);
    }

    function drawTransitView(f, view, blink) {
      if (!view.rows.length) {
        drawOvernight(f, view, view.now);
      } else {
        if (view.header) drawHeader(f, view.header, view.now, C.band, C.grey);
        f.withClip(0, view.header ? 7 : 0, 63, view.wx ? 21 : 31, () => {
          for (const row of view.rows) drawViewRow(f, row, blink);
        });
      }
      if (view.wx) drawWeather(f, view.wx, view.warn);
    }

    // opts: now, blink (alert "!" phase), rolls ({slotKey: {from, p}}),
    // view (a frame from createTransitAnimator; overrides the static layout)
    function renderTransit(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      const f = newFrame();
      let view = o.view;
      if (!view) {
        view = buildTransitView(p, now);
        if (o.rolls) for (const row of view.rows) for (const c of row.cells) if (o.rolls[c.id]) c.roll = o.rolls[c.id];
      }
      drawTransitView(f, view, !!o.blink);
      return f;
    }

    // ---- transit animation ----
    // Keeps arrivals' identity across frames and updates (matched by time,
    // within MATCH_S), so the board can animate what actually changed:
    //   - a time's text changes  -> roll (per digit, or whole cell)
    //   - an arrival leaves      -> fade out, then the rest settle
    //   - an arrival appears     -> fade in
    //   - a time becomes first   -> color eases from dim to bright
    //   - a row leaves or joins  -> fade, then rows slide to their new places
    // In the chronological view, the departing first row slides up and out
    // while fading, the list slides up with it, and the next train slides in
    // at the bottom (no wait between the two).
    const ROLL_MS = 400, FADE_MS = 700, MOVE_MS = 500, COLOR_MS = 700, MATCH_S = 90;
    const lerp = (a, b, k) => a + (b - a) * k;
    const lerpColor = (c1, c2, k) => {
      if (k >= 1 || c1 === c2) return c2;
      const a = hex(c1), b = hex(c2);
      return '#' + a.map((v, i) => Math.round(lerp(v, b[i], k)).toString(16).padStart(2, '0')).join('');
    };
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const tween = (from, to, start, dur, t) => (t <= start ? from : t >= start + dur ? to : lerp(from, to, easeInOut((t - start) / dur)));

    function createTransitAnimator() {
      let nextId = 1;
      const rows = new Map(); // key -> row state

      function matchCells(state, cells, t, isNewRow) {
        const unmatched = state.cells.filter((c) => !c.leaving);
        const used = new Set();
        const out = [];
        for (const c of cells) {
          const m = unmatched.find((u) => !used.has(u) && Math.abs(u.t - c.t) <= MATCH_S);
          if (m) {
            used.add(m);
            if (m.text !== c.text) m.roll = { from: m.text, start: t };
            if (m.color !== c.color) { m.fromColor = m.shownColor || m.color; m.colorStart = t; }
            if (m.right !== c.right) { m.fromRight = m.shownRight == null ? m.right : m.shownRight; m.moveStart = t; }
            Object.assign(m, { t: c.t, text: c.text, color: c.color, right: c.right });
            out.push(m);
          } else {
            // New arrivals fade in; a new row's arrivals come in with the row.
            out.push({ ...c, id: nextId++, born: isNewRow ? null : t });
          }
        }
        for (const u of unmatched) if (!used.has(u)) { u.leaving = t; out.push(u); }
        for (const c of state.cells) if (c.leaving && c.leaving !== t && t - c.leaving < FADE_MS) out.push(c);
        state.cells = out.filter((c, i) => out.indexOf(c) === i);
      }

      return {
        // Returns the view to draw at animation time `t` (ms).
        step(p, now, t) {
          const target = buildTransitView(p, now);
          const chrono = target.mode === 'chrono';
          const keys = new Set(target.rows.map((r) => r.key));
          const current = [...rows.values()].filter((st) => !st.leaving);
          const firstTop = Math.min(...current.map((st) => st.top));
          const continuing = current.some((st) => keys.has(st.key));
          // Rows leaving: fade out where they are (chrono: the first row
          // slides up and out as it fades).
          let leavingUntil = 0;
          for (const [key, st] of rows) {
            if (!keys.has(key) && !st.leaving) {
              st.leaving = t;
              if (chrono && st.mode === 'chrono' && st.top === firstTop) {
                st.fromTop = st.shownTop; st.top = st.top - target.pitch; st.moveStart = t;
              }
            }
            if (st.leaving) {
              if (t - st.leaving >= FADE_MS) rows.delete(key);
              else if (!(chrono && st.mode === 'chrono')) leavingUntil = Math.max(leavingUntil, st.leaving + FADE_MS);
            }
          }
          // Rows staying or joining: slide to their new places once any
          // leaving row has faded.
          for (const r of target.rows) {
            let st = rows.get(r.key);
            const isNewRow = !st || !!st.leaving;
            if (isNewRow) {
              st = { key: r.key, top: r.top, shownTop: r.top, born: rows.size ? t : null, cells: [] };
              // Chrono: a train joining a running list slides in from below.
              if (chrono && continuing) { st.fromTop = r.top + target.pitch; st.moveStart = t; }
              rows.set(r.key, st);
            } else if (st.top !== r.top) {
              st.fromTop = st.shownTop;
              st.moveStart = Math.max(t, leavingUntil);
              st.top = r.top;
            }
            // Position numbers roll when a row moves up (2 -> 1).
            if (r.num != null && st.num != null && st.num !== r.num && !isNewRow) st.numRoll = { from: String(st.num), start: t };
            Object.assign(st, { ln: r.ln, lbl: r.lbl, a: r.a, num: r.num, mode: target.mode });
            matchCells(st, r.cells, t, isNewRow);
          }

          const view = { now, mode: target.mode, header: target.header, wx: target.wx, warn: target.warn, rows: [] };
          if (!target.rows.length && ![...rows.values()].some((st) => st.leaving)) { rows.clear(); return view; }
          for (const st of rows.values()) {
            st.shownTop = st.moveStart != null ? tween(st.fromTop, st.top, st.moveStart, MOVE_MS, t) : st.top;
            const alpha = st.leaving ? 1 - clamp01((t - st.leaving) / FADE_MS)
              : st.born != null ? clamp01((t - Math.max(st.born, leavingUntil)) / FADE_MS) : 1;
            const cells = st.cells.filter((c) => !c.leaving || t - c.leaving < FADE_MS).map((c) => {
              c.shownRight = c.moveStart != null ? tween(c.fromRight, c.right, c.moveStart, MOVE_MS, t) : c.right;
              c.shownColor = c.colorStart != null ? lerpColor(c.fromColor, c.color, easeInOut(clamp01((t - c.colorStart) / COLOR_MS))) : c.color;
              const rollP = c.roll ? (t - c.roll.start) / ROLL_MS : 1;
              if (rollP >= 1) c.roll = null;
              return {
                id: c.id, text: c.text, right: c.shownRight, color: c.shownColor,
                alpha: c.leaving ? 1 - clamp01((t - c.leaving) / FADE_MS) : c.born != null ? clamp01((t - c.born) / FADE_MS) : 1,
                roll: c.roll ? { from: c.roll.from, p: rollP } : null,
              };
            });
            st.cells = st.cells.filter((c) => !c.leaving || t - c.leaving < FADE_MS);
            const numP = st.numRoll ? (t - st.numRoll.start) / ROLL_MS : 1;
            if (numP >= 1) st.numRoll = null;
            view.rows.push({
              key: st.key, ln: st.ln, lbl: st.lbl, a: st.a, top: st.shownTop, alpha, cells,
              num: st.num, numRoll: st.numRoll ? { from: st.numRoll.from, p: numP } : null,
            });
          }
          return view;
        },
      };
    }

    function drawTickerItem(f, it, idx, top, now, due = true) {
      const base = top + 9;
      f.fill(0, top, 5, 12, C.index);
      f.fill(5, top, 59, 12, scaleColor(LINE[it.ln], 0.55));
      if (it.a) {
        f.text('small', s(G.ALERT_DISC), 0, base, C.red);
        f.text('small', s(G.ALERT_MARK), 0, base, C.white);
      } else if (it.s) {
        f.text('small', s(G.CLOCK), 0, base, C.label);
      } else {
        f.text('small', String(idx), 1, base, C.label);
      }
      f.text('5x7', it.d, 7, base, C.white);
      const min = minutesUntil(it.t, now);
      if (min <= 1 && due) {
        rtext(f, '5x7', 'Due', 62, base, C.white);
      } else if (min <= 1) {
        // A second train within a minute of the first: not also Due.
        const mw = measure('5x7', s(G.MIN));
        f.text('5x7', s(G.MIN), 62 - mw + 1, base, C.white);
        rtext(f, '5x7', '2', 62 - mw - 2, base, C.white);
      } else {
        const mw = measure('5x7', s(G.MIN));
        f.text('5x7', s(G.MIN), 62 - mw + 1, base, C.white);
        rtext(f, '5x7', String(min), 62 - mw - 2, base, C.white);
      }
    }

    const tickerPages = (p, now) => Math.max(1, Math.ceil(liveTicker(p, now).length / 2));

    // opts: now, page, slide (0..1 progress of the slide to the next page)
    function renderTicker(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      const f = newFrame();
      // The ticker's header stays when the transit header is hidden to fit.
      const th = p.tickerHeader !== undefined ? p.tickerHeader : p.header;
      if (th) drawHeader(f, th, now, null, C.tickerHead);
      const items = liveTicker(p, now);
      const pages = Math.max(1, Math.ceil(items.length / 2));
      const page = (o.page || 0) % pages;
      const offset = Math.round(easeInOut(Math.min(1, Math.max(0, o.slide || 0))) * 26);
      // Only the soonest train per destination may read Due.
      const firstOf = new Map();
      items.forEach((it, i) => {
        const k = `${it.ln}:${it.d}`;
        if (!firstOf.has(k) || it.t < items[firstOf.get(k)].t) firstOf.set(k, i);
      });
      const drawPage = (pg, shift) => {
        items.slice(pg * 2, pg * 2 + 2).forEach((it, i) => {
          const n = pg * 2 + i;
          drawTickerItem(f, it, n + 1, 7 + i * 13 + shift, now, firstOf.get(`${it.ln}:${it.d}`) === n);
        });
      };
      f.withClip(0, 7, 63, 31, () => {
        drawPage(page, -offset);
        if (offset > 0 && pages > 1) drawPage((page + 1) % pages, 26 - offset);
      });
      return f;
    }

    // ---- radar ----
    // Frame values (contract "Radar frame"): 1-5 rain, 6 shoreline,
    // 7 location marker, 8-10 snow. Precip fills at ~65%.
    const RADAR_FILL = 0.65;
    const RADAR = {
      1: scaleColor('#1f8f1f', RADAR_FILL), 2: scaleColor('#2ee02e', RADAR_FILL), 3: scaleColor('#ffe000', RADAR_FILL),
      4: scaleColor('#ff8c00', RADAR_FILL), 5: scaleColor('#ff1a1a', RADAR_FILL),
      6: '#34485e', 7: '#ffffff',
      8: scaleColor('#4f86ff', RADAR_FILL), 9: scaleColor('#a9c9ff', RADAR_FILL), 10: scaleColor('#ffffff', RADAR_FILL),
    };
    // Clock stack: indicator 2 + gap 2 + clock 7 + gap 2 + AM/PM 5 = 18 rows.
    const ampmFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: true });
    const ampmText = (t) => (/PM/i.test(ampmFmt.format(new Date(t * 1000))) ? 'PM' : 'AM');

    // Conditions panel (radar screen before any frames): icon + temperature,
    // condition word level with AM/PM, high/low below. Left 39 columns.
    function drawConditions(f, wx) {
      drawIcon(f, wx.icon, 1, 2);
      const x = f.text('5x7', String(wx.temp), 12, 10, C.label);
      f.text('small', '°', x, 8, C.label);
      f.text('small', wx.word, 1, 20, C.label);
      if (wx.hi != null && wx.lo != null) {
        // Double space between high and low, single when that would reach the
        // split layout's divider (col 39; keep col 38 clear).
        let hl = `H ${wx.hi}  L ${wx.lo}`;
        if (1 + measure('small', hl) - 1 > 37) hl = `H ${wx.hi} L ${wx.lo}`;
        f.text('small', hl, 1, 28, C.grey);
      }
    }

    // opts: now, idx (frame index into p.radar.frames; default the newest),
    // frames ({id: Uint8Array(2048)}; missing frames draw as empty radar)
    function renderRadar(p, opts) {
      const o = opts || {};
      const r = p.radar || {};
      const ids = r.frames || [];
      // -1 when there are no frames yet (the clock then shows the current time).
      const idx = !ids.length ? -1 : o.idx != null ? Math.max(0, Math.min(ids.length - 1, o.idx)) : ids.length - 1;
      const f = newFrame();
      const bytes = idx >= 0 && o.frames ? o.frames[ids[idx]] : null;
      if (bytes) {
        for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
          const c = RADAR[bytes[y * 64 + x]];
          if (c) f.fill(x, y, 1, 1, c);
        }
      }
      // No frames yet: current conditions on the left instead of the radar.
      if (!ids.length && r.wx) drawConditions(f, r.wx);
      // Split layout: gray line on the clock panel's left edge.
      if (r.split && r.clock) f.fill(r.clock[0] - 1, 0, 1, 32, C.divider);
      // Clock stack, right-aligned in the clock box: frame indicator, clock
      // (frame time), AM/PM with the warning icon to its left.
      const [bx, by, bw, bh] = r.clock || [40, 0, 24, 32];
      const right = Math.min(62, bx + bw - 1);
      const top = by + 2; // top-aligned (spec: rows 2-19)
      const t = idx >= 0 && r.ft && r.ft[idx] != null ? r.ft[idx] : (o.now != null ? o.now : p.now);
      if (ids.length) {
        const segW = 2, segGap = 1;
        let x = right - (ids.length * (segW + segGap) - segGap) + 1;
        ids.forEach((_, i) => { f.fill(x, top, segW, 2, i === idx ? C.amber : C.indicator); x += segW + segGap; });
      }
      // Dimmed so a frame's time doesn't read as the current time.
      rtext(f, '5x7', clockText(t), right, top + 11, C.radarTime);
      const ap = ampmText(t);
      const apX = right - measure('small', ap) + 1;
      f.text('small', ap, apX, top + 18, C.radarAmpm);
      if (p.warn) {
        const glyph = s(p.warn.kind === 'tor' ? G.FUNNEL : G.BOLT);
        f.text('small', glyph, apX - 2 - measure('small', glyph), top + 18, p.warn.kind === 'tor' ? C.warnTornado : C.warnSevere);
      }
      return f;
    }

    // ---- baseball (design spec §8) ----
    // Team rows on the left (color block + 5x7 abbreviation + score), status
    // panel centered on x51, divider on row 22, bottom line right-aligned.
    const BB = { live: '#f0f0f0', lose: '#6a6a6a', base: '#454545', infield: '#3a3a3a' };
    const ROW_TOPS = [2, 12];   // away, home
    const SCORE_RIGHT = 30, PANEL_X = 51, BOTTOM = 31, DIVIDER = 22; // divider and bottom line match the transit weather row
    const SCORE_ROLL = 8;       // 5x7 digit (7 rows incl. descender) + 1px
    const ctext = (f, font, str, cx, base, color) => f.text(font, str, cx - Math.floor(measure(font, str) / 2), base, color);
    const record = (t) => (t.w == null || t.l == null ? '' : `${t.w}-${t.l}`);

    // Which game is up: live games take precedence over pregame and finals;
    // within that set, one minute each by wall time, so the board and the
    // simulator agree without keeping rotation state. Returns the index into
    // games, the game's place in the rotation, and the rotation size.
    function pickGame(games, now) {
      if (!games.length) return { i: -1, pos: 0, of: 0 };
      const live = games.map((g, i) => (g.st === 'live' ? i : -1)).filter((i) => i >= 0);
      const pool = live.length ? live : games.map((_, i) => i);
      const pos = Math.floor(now / 60) % pool.length;
      return { i: pool[pos], pos, of: pool.length };
    }

    // A score that just changed shows amber for SCORE_HOLD_S, then fades back
    // to the live white over SCORE_FADE_S. `side.at` is when the server saw
    // the change (epoch s); without it the score is plain white.
    const SCORE_HOLD_S = 60, SCORE_FADE_S = 10;
    function scoreColor(side, now) {
      if (side.at == null) return BB.live;
      const age = now - side.at;
      if (age < 0 || age < SCORE_HOLD_S) return C.amber;
      if (age >= SCORE_HOLD_S + SCORE_FADE_S) return BB.live;
      return lerpColor(C.amber, BB.live, (age - SCORE_HOLD_S) / SCORE_FADE_S);
    }

    // Score, right-aligned at SCORE_RIGHT; a changed score rolls digit by
    // digit like arrival times.
    function drawScore(f, text, top, color, roll) {
      const base = top + 6;
      if (!roll || roll.from === text || roll.p >= 1) { rtext(f, '5x7', text, SCORE_RIGHT, base, color); return; }
      const up = Math.round(easeInOut(roll.p) * SCORE_ROLL);
      f.withClip(SCORE_RIGHT - 12, top, SCORE_RIGHT, top + 6, () => {
        const from = roll.from;
        if (from.length === text.length) {
          let x = SCORE_RIGHT - measure('5x7', text) + 1;
          for (let i = 0; i < text.length; i++) {
            if (from[i] === text[i]) f.text('5x7', text[i], x, base, color);
            else {
              f.text('5x7', from[i], x, base - up, color);
              f.text('5x7', text[i], x, base - up + SCORE_ROLL, color);
            }
            x += measure('5x7', text[i]) + 1;
          }
        } else {
          rtext(f, '5x7', from, SCORE_RIGHT, base - up, color);
          rtext(f, '5x7', text, SCORE_RIGHT, base - up + SCORE_ROLL, color);
        }
      });
    }

    // Diamond of radius r centered at (cx, cy): just the outline, or filled.
    function drawDiamond(f, cx, cy, r, color, filled) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d === r || (filled && d < r)) f.fill(cx + dx, cy + dy, 1, 1, color);
      }
    }

    // Infield outline with 5x5 bases on its corners: amber when occupied,
    // solid dark grey when empty. on = [1st, 2nd, 3rd].
    function drawInfield(f, on) {
      drawDiamond(f, PANEL_X, 7, 5, BB.infield, false);
      drawDiamond(f, PANEL_X, 2, 2, on[1] ? C.amber : BB.base, true);
      drawDiamond(f, PANEL_X - 5, 7, 2, on[2] ? C.amber : BB.base, true);
      drawDiamond(f, PANEL_X + 5, 7, 2, on[0] ? C.amber : BB.base, true);
    }

    // Tom Thumb status text that can roll like an arrival time: `left` is
    // its left edge. Same-length texts whose changed characters keep their
    // widths roll only those characters ("TOP 7" -> "BOT 7" rolls T/B and
    // P/T); anything else rolls the whole text.
    function drawRollText(f, text, left, base, color, roll) {
      if (!roll || roll.from === text || roll.p >= 1) { f.text('small', text, left, base, color); return; }
      const from = roll.from;
      const up = Math.round(easeInOut(roll.p) * ROLL_DIST);
      const sameShape = from.length === text.length && [...text].every((ch, i) => measure('small', ch) === measure('small', from[i]));
      f.withClip(0, base - 5, 63, base - 1, () => {
        if (sameShape) {
          let x = left;
          for (let i = 0; i < text.length; i++) {
            if (from[i] === text[i]) f.text('small', text[i], x, base, color);
            else {
              f.text('small', from[i], x, base - up, color);
              f.text('small', text[i], x, base - up + ROLL_DIST, color);
            }
            x += measure('small', text[i]) + 1;
          }
        } else {
          const fromLeft = left + measure('small', text) - measure('small', from); // keep the right edge
          f.text('small', from, fromLeft, base - up, color);
          f.text('small', text, left, base - up + ROLL_DIST, color);
        }
      });
    }

    // Live status texts, shared by the renderer and change detection.
    // Between halves (MID 4, END 5) there's no count or outs to show.
    const HALF = { T: 'TOP', B: 'BOT', M: 'MID', E: 'END' };
    const liveTexts = (g) => {
      const brk = g.half === 'M' || g.half === 'E';
      return {
        inn: `${HALF[g.half] || 'TOP'} ${g.inn}`,
        count: brk ? '' : `${g.b || 0}-${g.s || 0}`,
        outs: brk ? '' : `${g.o || 0} OUT`,
      };
    };

    function drawNoGames(f, now) {
      const clock = clockText(now);
      const label = 'NO GAMES';
      const top = Math.floor((32 - 18) / 2);
      f.text('clock', clock, Math.floor((64 - measure('clock', clock)) / 2), top + 10, C.clock);
      f.text('small', label, Math.floor((64 - measure('small', label)) / 2), top + 18, C.noTrains);
    }

    // opts: now, game (index into p.mlb.games; default the rotation),
    // rolls ({away|home|inn|count|outs: {from, p}}: scores and live status
    // texts mid-roll)
    function renderBaseball(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      const f = newFrame();
      const games = (p.mlb && p.mlb.games) || [];
      if (!games.length) { drawNoGames(f, now); return f; }
      const g = games[o.game != null ? o.game % games.length : pickGame(games, now).i];
      const rolls = o.rolls || {};
      const final = g.st === 'final';
      const winner = final ? (g.away.r > g.home.r ? 'away' : g.home.r > g.away.r ? 'home' : null) : null;

      // Team rows.
      let nameEnd = 0;
      for (const [k, top] of [['away', ROW_TOPS[0]], ['home', ROW_TOPS[1]]]) {
        f.fill(1, top, 3, 6, g[k].c || C.grey);
        nameEnd = Math.max(nameEnd, f.text('5x7', g[k].ab, 6, top + 6, winner === k ? C.amber : C.label));
      }
      f.fill(0, DIVIDER, 64, 1, C.divider);

      if (g.st === 'pre') {
        // Records 3px after the longer name; first pitch in the bottom line.
        f.text('small', record(g.away), nameEnd + 2, ROW_TOPS[0] + 6, C.grey);
        f.text('small', record(g.home), nameEnd + 2, ROW_TOPS[1] + 6, C.grey);
        const ap = ampmText(g.start);
        rtext(f, 'small', ap, 62, BOTTOM, C.grey);
        rtext(f, 'small', clockText(g.start), 62 - measure('small', ap) - 3, BOTTOM, C.label);
        return f;
      }

      if (final) {
        for (const [k, top] of [['away', ROW_TOPS[0]], ['home', ROW_TOPS[1]]]) {
          drawScore(f, String(g[k].r), top, winner === k ? C.amber : winner ? BB.lose : C.label, rolls[k]);
          ctext(f, 'small', record(g[k]), PANEL_X, top + 6, C.grey);
        }
        rtext(f, 'small', 'FINAL', 62, BOTTOM, C.label);
        return f;
      }

      // Live.
      drawScore(f, String(g.away.r), ROW_TOPS[0], scoreColor(g.away, now), rolls.away);
      drawScore(f, String(g.home.r), ROW_TOPS[1], scoreColor(g.home, now), rolls.home);
      drawInfield(f, g.on || [0, 0, 0]);
      const t = liveTexts(g);
      drawRollText(f, t.inn, PANEL_X - Math.floor(measure('small', t.inn) / 2), 20, C.label, rolls.inn);
      const outsLeft = 62 - measure('small', t.outs) + 1; // empty texts draw nothing
      drawRollText(f, t.outs, outsLeft, BOTTOM, C.grey, rolls.outs);
      drawRollText(f, t.count, outsLeft - 5 - measure('small', t.count), BOTTOM, C.label, rolls.count);
      return f;
    }

    // Texts of the game on screen that roll when they change: scores, and
    // while live the inning, count, and outs. `key` (game and state) changes
    // when a different game or state is up; don't roll across those.
    function baseballTexts(p, now) {
      const games = (p.mlb && p.mlb.games) || [];
      if (!games.length) return null;
      const g = games[pickGame(games, now).i];
      const texts = { away: String(g.away.r), home: String(g.home.r) };
      if (g.st === 'live') Object.assign(texts, liveTexts(g));
      return { key: `${g.id}:${g.st}`, texts };
    }

    function applyBrightness(f, bright) {
      const k = Math.max(0, Math.min(100, bright == null ? 100 : bright)) / 100;
      if (k === 1) return f;
      for (let i = 0; i < f.px.length; i++) f.px[i] = Math.round(f.px[i] * k);
      return f;
    }

    function render(p, opts) {
      const o = opts || {};
      const screen = o.screen || p.screen;
      const f = screen === 'ticker' ? renderTicker(p, o) : screen === 'radar' ? renderRadar(p, o)
        : screen === 'baseball' ? renderBaseball(p, o) : renderTransit(p, o);
      return applyBrightness(f, p.bright);
    }

    // Time texts per transit slot at `now`, keyed for change detection.
    function transitTexts(p, now) {
      const out = {};
      for (const r of buildTransitView(p, now).rows) for (const c of r.cells) out[c.id] = c.text;
      return out;
    }

    return {
      Frame, LINE, DIGIT, C, BB, RADAR, measure, clockText, rowTops, timeText, chronoText, maxRows, render, renderTransit, renderTicker, renderRadar,
      renderBaseball, baseballTexts, pickGame, scoreColor, SCORE_HOLD_S, SCORE_FADE_S,
      autoScreen, transitTexts, tickerPages, applyBrightness, buildTransitView, createTransitAnimator,
      ROLL_MS, FADE_MS, MOVE_MS, SLIDE_MS: 1200, PAGE_HOLD_MS: 8000, BLINK_MS: 1000,
      // Radar loop: each frame shows RADAR_FRAME_MS, the newest holds RADAR_HOLD_MS.
      RADAR_FRAME_MS: 500, RADAR_HOLD_MS: 4000,
    };
  }

  // Which screen the board shows now. The payload's `screen` is the base; on
  // the auto screen (radar.visit set) the radar is visited for `for` seconds
  // at the start of every `every`-second cycle (epoch-aligned) while rain is
  // in the box. Mirrored by player.py's auto_screen().
  function autoScreen(p, now) {
    const r = p.radar;
    if ((p.screen !== 'transit' && p.screen !== 'baseball') || !r || !r.on || !r.visit || !(r.visit.every > 0)) return p.screen;
    return Math.floor(now) % r.visit.every < r.visit.for ? 'radar' : p.screen;
  }

  return { Frame, create, autoScreen, minutesUntil, timeText, chronoText, maxRows, rowTops, liveRows, slotKey, easeInOut, DROP_GRACE };
});
