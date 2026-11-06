// Board drawing: the reference implementation of how the board (64x32, or
// 128x32 with two panels: `cols`) draws a
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

  // Max transit rows for the header/weather/key toggles (design spec §5).
  // Each takes one row: the header (or, with the key, the station line at
  // the bottom), the weather strip, the key.
  function maxRows(hasHeader, hasWeather, hasKey = false) {
    return 5 - (hasHeader ? 1 : 0) - (hasWeather ? 1 : 0) - (hasKey ? 1 : 0);
  }

  // Row tops for n transit rows. Without the header, rows are spread evenly
  // from the panel top to the weather divider (or the bottom edge): equal gaps
  // above, between, and below, the odd pixel going to the bottom. With the
  // header: spec-pinned cases, else the preferred pitch centered in the area.
  // divider: the header's line on row 7 (headerDivider). The header layouts
  // below are tuned around that line; without it the header text ends on
  // row 5, so the rows move up to keep the gap under the header even with
  // the gaps between rows (2 px for one or two rows without weather, else 1).
  // key: the key layout (KEY_ROWS): the key on rows 1-5 and, with
  // hasHeader, the station line: a divider on row 25, text on rows 27-31.
  function rowTops(n, hasHeader, hasWeather, divider = false, key = false) {
    if (key) return keyRowTops(n, hasHeader);
    // Two rows under the header: 4 px above, between, and below the rows
    // (from the text, or from the line), the rest of the space at the bottom.
    if (hasHeader && !hasWeather && n === 2) return divider ? [12, 21] : [10, 19];
    const tops = rowTopsBase(n, hasHeader, hasWeather);
    if (!hasHeader || divider || !tops.length) return tops;
    const shift = !hasWeather && n <= 2 ? 2 : 1;
    return tops.map((t) => t - shift);
  }

  // Key layout: rows between the key (ink rows 1-5) and the station line's
  // divider (row 25) or the bottom edge, at the preferred pitch (1px between
  // rows from three rows up), centered, the odd pixel going below.
  function keyRowTops(n, band) {
    if (n === 0) return [];
    const areaTop = 6, areaBottom = band ? 24 : 31;
    const areaH = areaBottom - areaTop + 1;
    const preferred = { 2: 8, 3: 6, 4: 6 };
    const pitch = n === 1 ? 0 : Math.min(preferred[n] || 6, Math.floor((areaH - 5) / (n - 1)));
    const top = areaTop + Math.max(0, Math.floor((areaH - ((n - 1) * pitch + 5)) / 2));
    return Array.from({ length: n }, (_, i) => top + i * pitch);
  }

  function rowTopsBase(n, hasHeader, hasWeather) {
    if (n === 0) return [];
    if (!hasHeader) {
      if (!hasWeather && n === 4) return [1, 9, 17, 25];   // pinned: 3px between rows
      const areaH = hasWeather ? 26 : 32;   // rows 0-25 (strip on 27-31) or 0-31
      const gap = Math.max(1, Math.round((areaH - 5 * n) / (n + 1)));
      const top = Math.floor((areaH - 5 * n - (n - 1) * gap) / 2);
      return Array.from({ length: n }, (_, i) => top + i * (5 + gap));
    }
    if (hasHeader && !hasWeather && n === 4) return [9, 15, 21, 27];
    if (hasHeader && !hasWeather && n === 3) return [10, 18, 26];
    if (hasHeader && !hasWeather && n === 2) return [13, 23];
    const areaTop = 9;
    const areaBottom = hasWeather ? 25 : 31;
    const areaH = areaBottom - areaTop + 1;
    const preferred = { 2: 8, 3: 8, 4: 6, 5: 6 };
    const pitch = n === 1 ? 0 : Math.min(preferred[n], Math.floor((areaH - 5) / (n - 1)));
    const block = (n - 1) * pitch + 5;
    const top = areaTop + Math.max(0, Math.floor((areaH - block) / 2));
    return Array.from({ length: n }, (_, i) => top + i * pitch);
  }

  // Rows as the board shows them at `now`: past arrivals dropped (the list
  // shifts), rows with nothing left removed.
  // A train drops DROP_GRACE s after its time, as the server drops it, but
  // only once a payload made after that moment agrees: until then it stays
  // (DUE), since the server may have pushed its time later (a held train)
  // and a board fetches less often than the simulator polls. HOLD_MAX caps
  // the wait when no fresh payload comes.
  const HOLD_MAX = 60;
  const isShown = (x, now, pnow) => x >= now - DROP_GRACE || (pnow != null && pnow < x + DROP_GRACE && x >= now - DROP_GRACE - HOLD_MAX);

  function liveRows(p, now) {
    const out = [];
    for (const r of p.rows || []) {
      const t = [], s = [];
      r.t.forEach((x, i) => { if (isShown(x, now, p.now)) { t.push(x); s.push(r.s ? r.s[i] : 0); } });
      if (t.length) out.push({ ...r, t, s });
    }
    return out;
  }

  const liveTicker = (p, now) => (p.ticker || []).filter((x) => isShown(x.t, now, p.now));

  // Stable key for a transit time slot, used to detect changes to animate.
  const slotKey = (r, k) => `${r.ln}:${r.lbl}:${k}`;

  // ---- easing ----
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  // ---- width ----
  // A board of two chained panels is 128 x 32: the payload says so with
  // `cols` (contract "Width"; absent on a 64-wide board). A screen without a
  // 128 layout yet draws at 64 and shows on both panels: widenPx() repeats
  // each row of a frame `w` wide across `to` columns.
  const WIDE = 128;
  const colsOf = (p) => (p && p.cols === WIDE ? WIDE : 64);
  function widenPx(px, w, to) {
    const h = px.length / (w * 3), out = new Uint8Array(to * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < to; x++) {
      const i = (y * to + x) * 3, j = (y * w + (x % w)) * 3;
      out[i] = px[j]; out[i + 1] = px[j + 1]; out[i + 2] = px[j + 2];
    }
    return out;
  }

  // ---- renderer ----

  function create({ fonts, icons, glyphs: G, tz = 'America/Chicago', makeFrame }) {
    const measure = (font, str) => measureWith(fonts, font, str);
    // makeFrame(w, h): the caller's Frame class (render.js adds PNG output).
    const newFrame = (w = 64) => (makeFrame ? makeFrame(w, 32) : new Frame(w, 32, fonts));
    // The frame as the board shows it: 64-wide screens on a 128 board fill both panels.
    function widen(f, cols) {
      if (f.w >= cols) return f;
      const g = newFrame(cols);
      g.px.set(widenPx(f.px, f.w, cols));
      return g;
    }
    const s = (cp) => String.fromCodePoint(cp);

    const LINE = { RD: '#c60c30', BL: '#00a1de', BR: '#62361b', GR: '#009b3a', OR: '#f9461c', PR: '#522398', PK: '#e27ea6', YL: '#f9e300' };
    const C = {
      label: '#d8d8d8', clock: '#cccccc', radarTime: '#7a7a7a', radarAmpm: '#8f8f8f', radarSub: '#666666', wxText: '#8f8f8f', amber: '#ffb000', dimAmber: '#664600', dimAmber2: '#332300',
      sch: '#6a6a6a', schDim: '#2e2e2e', schDim2: '#151515', grey: '#8f8f8f', divider: '#333333',
      head: '#808080', dimHead: '#555555', index: '#2d2d2d', white: '#ffffff', red: '#ff2020',
      watch: '#ffd800', warnSevere: '#ff8000', warnTornado: '#ff2020', noTrains: '#6c6c6c', indicator: '#3a3a3a', perch: '#4a4a4a',
    };

    const TIME_GAP = 3;   // px between arrival times...
    const TIGHT_GAP = 2;  // ...tightened when the row is full
    const LABEL_GAP = 3;  // min px between the label and the times
    // A line with a major alert: its label (the payload's `al`, shortened to
    // make room when needed) and the red alert circle ALERT_ICON_GAP px after it.
    const ALERT_ICON_GAP = 2;
    const alertText = (r) => (r.al != null ? r.al : r.lbl);
    const alertIconX = (r, x) => { const t = alertText(r); return t ? x + measure('small', t) + ALERT_ICON_GAP : x; };
    // Rightmost column the row's label (and alert circle) reaches.
    const labelEnd = (r, x) => (r.a ? alertIconX(r, x) + 4 : x + measure('small', r.lbl) - 1);
    const TAG_GAP = 3;    // px between warning icon and word
    const ROLL_DIST = 6;  // px a digit travels during a roll (5px glyph + 1px gap)
    const scaleColor = (hexc, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hexc.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
    const rtext = (f, font, str, right, base, color) => f.text(font, str, right - measure(font, str) + 1, base, color);
    // Ink box [x0, y0, x1, y1] of text drawn at x on baseline `base`.
    function textBox(font, str, x, base) {
      let y0 = Infinity, y1 = -Infinity;
      for (const ch of str) {
        const g = fonts[font][ch.codePointAt(0)];
        if (g && g[1] && g[2]) { y0 = Math.min(y0, base - (g[4] + g[2])); y1 = Math.max(y1, base - g[4] - 1); }
      }
      return [x, y0, x + measure(font, str) - 1, y1];
    }

    const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    // "1:02": 12-hour Chicago time, no AM/PM, no leading zero.
    const clockText = (now) => clockFmt.format(new Date(now * 1000)).replace(/\s?[AP]M$/i, '');

    // `color`: draw every lit pixel in that one color (a mono icon) instead
    // of the icon's own palette.
    function drawIcon(f, name, x, y, color) {
      icons.ICONS[name].forEach((row, j) => [...row].forEach((c, i) => {
        if (c !== '.') f.fill(x + i, y + j, 1, 1, color || icons.PALETTE[c]);
      }));
    }
    // The board's icon clock (opts.iconT): drives the overnight owl.
    let ICON_T = null;

    // ---- clock rolls ----
    // The header clock (transit, ticker), the radar's current time, and the
    // big overnight and no-games clocks roll at each minute like arrival
    // times; each is drawn under a name ('hdr.clock', 'rad.clock',
    // 'big.clock'). Current-conditions numbers roll when a new payload
    // changes them (S3): the weather strip's temperature ('wx.temp'), and on
    // the weather screen the top bar's temperature ('wx.top'), feels-like
    // ('wx.feels') and rain chance ('wx.pop'). Forecast columns and the radar
    // corner don't.
    // During render(), NR holds either a roller (createNumRoller: the board
    // and the simulator, which notice changes as they draw) or fixed rolls
    // ({name: {from, p}}: tests and parity scenarios).
    let NR = null;
    // With the payload's croll false, clocks (names ending in 'clock') don't
    // roll; the roller still sees them, so it still knows a clock is on screen.
    function takeRoll(name, text) {
      if (!NR) return null;
      const still = NR.still && name.endsWith('clock');
      if (NR.roller) { const r = NR.roller.take(name, text); return still ? null : r; }
      const r = NR.rolls && NR.rolls[name];
      return !still && r && r.p < 1 && r.from !== text ? r : null;
    }
    // [travel, top, bottom] for a font's digits: the ink rows the digits
    // span, relative to the baseline (the roll's clip), and travel = their
    // height + 1px (bitmaps can carry blank rows).
    const ROLL_FONT = {};
    function fontRoll(font) {
      if (!ROLL_FONT[font]) {
        let t0 = 99, t1 = -99;
        for (let cp = 48; cp <= 57; cp++) {
          const g = fonts[font][cp];
          for (let r = 0; r < g[2]; r++) if (g[5 + r]) { t0 = Math.min(t0, r - (g[4] + g[2])); t1 = Math.max(t1, r - (g[4] + g[2])); }
        }
        ROLL_FONT[font] = [t1 - t0 + 2, t0, t1];
      }
      return ROLL_FONT[font];
    }
    // Text that rolls when it changes; xOf(str) gives a text's left edge
    // (alignment). Mid-roll (roll = {from, p}), the old text moves up out of
    // the digits' rows while the new one moves up into place; with the same
    // left edge, length, and character widths, only the changed characters
    // move (12:59 -> 1:00 rolls the whole text). Returns x after the last
    // advance, like f.text. Mirrors roll_text() in draw.py.
    function rollTextWith(f, font, roll, text, xOf, base, color) {
      let x = xOf(text);
      if (!roll) return f.text(font, text, x, base, color);
      const from = roll.from, fx = xOf(from);
      const [dist, t0, t1] = fontRoll(font);
      const up = Math.round(easeInOut(roll.p) * dist);
      const a = [...text], b = [...from];
      const same = fx === x && a.length === b.length && a.every((ch, i) => measure(font, ch) === measure(font, b[i]));
      f.withClip(0, base + t0, f.w - 1, base + t1, () => {
        if (same) {
          a.forEach((ch, i) => {
            if (ch === b[i]) f.text(font, ch, x, base, color);
            else { f.text(font, b[i], x, base - up, color); f.text(font, ch, x, base - up + dist, color); }
            x += measure(font, ch) + 1;
          });
        } else {
          f.text(font, from, fx, base - up, color);
          x = f.text(font, text, x, base - up + dist, color);
        }
      });
      return x;
    }
    const rollText = (f, font, name, text, xOf, base, color) => rollTextWith(f, font, takeRoll(name, text), text, xOf, base, color);
    const rightAt = (font, right) => (str) => right - measure(font, str) + 1;
    const centerX = (font) => (str) => Math.floor((64 - measure(font, str)) / 2);
    // Centered in columns x0-63.
    const centerIn = (font, x0) => (str) => x0 + Math.floor((64 - x0 - measure(font, str)) / 2);

    // Station name + clock on rows 1-5, flush to the screen edges, both in
    // `color` (the transit screen's dark grey, or the ticker's header grey).
    // `divider`: a line on row 7 (transit).
    function drawHeader(f, name, now, divider, clock = true, color = C.head) {
      f.text('small', name, 0, 6, color);
      if (clock) rollText(f, 'small', 'hdr.clock', clockText(now), rightAt('small', f.w - 1), 6, color);
      if (divider) f.fill(0, 7, f.w, 1, C.divider);
    }

    // NWS warning tag style: watches yellow, severe warnings orange, tornado
    // warnings red and blinking (hidden on the blink's "on" phase).
    const warnStyle = (warn) => ({
      glyph: s(warn.kind === 'tor' ? G.FUNNEL : G.BOLT),
      color: warn.lvl === 'watch' ? C.watch : warn.kind === 'tor' ? C.warnTornado : C.warnSevere,
      blinks: warn.kind === 'tor' && warn.lvl === 'warning',
    });

    // Weather strip: one Tom Thumb line on rows 27-31 (no divider), in the
    // transit header's dark grey so the train rows lead: the temperature on
    // the left, the condition word on the right. A watch or warning replaces
    // the word with its tag (glyph + WATCH/WARNING, in its colors); the
    // temperature stays.
    function drawWeather(f, wx, warn, blink) {
      const base = 32;
      rollText(f, 'small', 'wx.temp', `${wx.temp}°`, () => 0, base, C.dimHead);
      if (warn) {
        const { glyph, color, blinks } = warnStyle(warn);
        if (blinks && blink) return;
        const word = warn.lvl === 'warning' ? 'WARNING' : 'WATCH';
        const x = f.w - 1 - (measure('small', glyph) + TAG_GAP + measure('small', word)) + 1;
        f.text('small', word, f.text('small', glyph, x, base, color) + TAG_GAP - 1, base, color);
      } else if (wx.word) {
        rtext(f, 'small', wx.word, f.w - 1, base, C.dimHead);
      }
    }

    // Key layout (transitLayout 'key'): a lowercase key over the columns on
    // rows 1-5 ("trains to" from x0, over the color blocks; "min" flush
    // right), and the station name and clock on rows 27-31, unlit, under a
    // divider on row 25 (drawn when the header isn't hidden to fit the rows).
    function drawKey(f) {
      f.text('small', 'trains to', 0, 6, C.dimHead);
      rtext(f, 'small', 'min', f.w - 1, 6, C.dimHead);
    }
    function drawBand(f, name, now, clock, color = C.head, divider = true) {
      if (divider) f.fill(0, 25, f.w, 1, C.divider);
      f.text('small', name, 0, 32, color);
      if (clock) rollText(f, 'small', 'hdr.clock', clockText(now), rightAt('small', f.w - 1), 32, color);
    }

    // One time cell, right-aligned at `right`, optionally mid-roll from
    // `roll.from`. Same-length numbers roll only the digits that changed;
    // anything else (length change, to/from DUE) rolls the whole cell.
    // x0-x1: the row's columns (the whole panel, or a half), for the roll's clip.
    function drawTimeCell(f, text, right, top, color, roll, x0 = 0, x1 = f.w - 1) {
      const base = top + 5;
      if (!roll || roll.from === text || roll.p >= 1) { rtext(f, 'small', text, right, base, color); return; }
      const up = Math.round(easeInOut(roll.p) * ROLL_DIST);
      f.withClip(x0, top, x1, top + 4, () => {
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
    // steps: the third time a step dimmer than the second (state timeSteps).
    // x0, right: the row's columns (a wide board's halves; contract "Width").
    function layoutCells(r, now, steps, x0 = 0, right = 63) {
      const texts = r.t.map((t, k) => timeText(t, now, k === 0));
      const widthAt = (gap) => texts.reduce((w, txt, i) => w + measure('small', txt) + (i ? gap : 0), 0);
      const gap = right - widthAt(TIME_GAP) + 1 - labelEnd(r, x0 + 5) - 1 >= LABEL_GAP ? TIME_GAP : TIGHT_GAP;
      const cells = new Array(texts.length);
      let x = right;
      for (let k = texts.length - 1; k >= 0; k--) {
        const sch = r.s && r.s[k];
        cells[k] = {
          id: slotKey(r, k), t: r.t[k], text: texts[k], right: x, alpha: 1, roll: null,
          color: sch ? [C.sch, C.schDim, steps ? C.schDim2 : C.schDim][Math.min(k, 2)]
            : [C.amber, C.dimAmber, steps ? C.dimAmber2 : C.dimAmber][Math.min(k, 2)],
        };
        x -= measure('small', texts[k]) + gap;
      }
      return cells;
    }

    // The transit screen as data: what to draw where, before any animation.
    // The animator (createTransitAnimator) adjusts positions, colors, and alphas.
    function buildTransitView(p, now) {
      if (p.view === 'chrono') return buildChronoView(p, now);
      if (colsOf(p) === WIDE && (p.view === 'split' || p.view === 'cols2')) return buildHalvesView(p, now);
      const rows = liveRows(p, now);
      const tops = rowTops(rows.length, !!p.header, !!p.wx, !!p.headerDivider, !!p.key);
      const right = colsOf(p) - 1;
      return {
        now,
        mode: 'dest',
        w: colsOf(p),
        header: p.header,
        hdiv: !!p.headerDivider,
        key: !!p.key,
        clock: p.hclock !== false,
        lnc: !!p.lnc,
        wx: p.wx,
        warn: p.warn,
        stale: p.stale,
        rows: rows.map((r, i) => ({
          key: `${r.ln}:${r.lbl}`, ln: r.ln, lbl: r.lbl, a: r.a, al: r.al, top: tops[i], alpha: 1,
          cells: layoutCells(r, now, p.ts === true, 0, right),
        })),
      };
    }

    // A wide board's halves (contract "Width"): `split`, northbound |
    // southbound with the payload's `halves` labels on top and the station
    // line at the bottom; `cols2`, two columns under the header. Rows carry
    // `h`: columns 0-61 (h 0) or 66-127 (h 1), each a 64-style row. Both
    // halves share row tops, set by the fuller one.
    const HALVES = [[0, 61], [66, 127]];
    const SPLIT_TOPS = { 1: [14], 2: [10, 18], 3: [8, 14, 20] };
    function buildHalvesView(p, now) {
      const split = p.view === 'split';
      const rows = liveRows(p, now);
      const per = [0, 1].map((h) => rows.filter((r) => (r.h ? 1 : 0) === h));
      const n = Math.max(per[0].length, per[1].length);
      const tops = split ? SPLIT_TOPS[Math.min(n, 3)] || [] : rowTops(n, !!p.header, !!p.wx, !!p.headerDivider, false);
      return {
        now,
        mode: split ? 'split' : 'cols2',
        w: WIDE,
        halves: split ? p.halves || [] : null,
        header: p.header,
        hdiv: !split && !!p.headerDivider,
        key: false,
        clock: p.hclock !== false,
        lnc: !!p.lnc,
        wx: split ? null : p.wx,
        warn: p.warn,
        stale: p.stale,
        rows: per.flatMap((list, h) => list.map((r, i) => {
          const [x0, right] = HALVES[h];
          return {
            key: `${h}:${r.ln}:${r.lbl}`, ln: r.ln, lbl: r.lbl, a: r.a, al: r.al, h, x0, right, top: tops[i], alpha: 1,
            cells: layoutCells(r, now, p.ts === true, x0, right),
          };
        })),
      };
    }

    // Chronological view: one train per row, soonest first; the payload's
    // extra trains wait below until a row frees up.
    function buildChronoView(p, now) {
      // Sorted here too, by time (stable): the order must hold however the
      // payload arrives.
      const rows = liveRows(p, now).sort((a, b) => a.t[0] - b.t[0]).slice(0, maxRows(!!p.header, !!p.wx, !!p.key));
      const tops = rowTops(rows.length, !!p.header, !!p.wx, !!p.headerDivider, !!p.key);
      const seenDest = new Set();
      const seenKey = new Set();
      const right = colsOf(p) - 1;
      return {
        now,
        mode: 'chrono',
        w: colsOf(p),
        pitch: tops.length > 1 ? tops[1] - tops[0] : 6,
        header: p.header,
        hdiv: !!p.headerDivider,
        key: !!p.key,
        clock: p.hclock !== false,
        lnc: !!p.lnc,
        wx: p.wx,
        warn: p.warn,
        stale: p.stale,
        rows: rows.map((r, i) => {
          const dest = `${r.ln}:${r.lbl}`;
          const due = !seenDest.has(dest); // chronological: the first one per destination is the soonest
          seenDest.add(dest);
          // Identity for the animator: the run number. Two rows must never
          // share a key or the animator merges them, so a run listed twice
          // (or an odd shared number like 1000) gets a suffix.
          let key = r.rn != null ? `rn:${r.rn}` : `${r.ln}:${r.lbl}:${r.t[0]}`;
          if (seenKey.has(key)) key += `#${i}`;
          seenKey.add(key);
          const sch = r.s && r.s[0];
          return {
            key, ln: r.ln, lbl: r.lbl, a: r.a, al: r.al, num: i + 1, top: tops[i], alpha: 1,
            cells: [{
              id: key, t: r.t[0], text: chronoText(r.t[0], now, due), right, alpha: 1, roll: null,
              color: sch ? (i ? C.schDim : C.sch) : (i ? C.dimAmber : C.amber),
            }],
          };
        }),
      };
    }

    const fade = (color, alpha) => (alpha >= 1 ? color : scaleColor(color, Math.max(0, alpha)));

    // Chronological rows: digit in columns 0-2, the 3px line-color block at
    // CHRONO_BLOCK_X (1px gap), the label 2px after it.
    const CHRONO_BLOCK_X = 4, CHRONO_LABEL_X = 9;
    // lnc: labels in the line's color instead of white. A line with a major
    // alert: the alert label, then the ticker's red alert circle. Static.
    function drawViewRow(f, row, lnc) {
      const top = Math.round(row.top);
      const chrono = row.num != null;
      const line = fade(LINE[row.ln], row.alpha);
      // A half of a wide board (row.x0, row.right), else the whole panel.
      const x0 = row.x0 || 0, x1 = row.right != null ? row.right : f.w - 1;
      // Chronological view: the row's position as a digit in the block's
      // exact color, before the block.
      if (chrono) drawTimeCell(f, String(row.num), 2, top, line, row.numRoll);
      f.fill(chrono ? CHRONO_BLOCK_X : x0, top, 3, 5, line);
      const lx = chrono ? CHRONO_LABEL_X : x0 + 5;
      f.text('small', row.a ? alertText(row) : row.lbl, lx, top + 5, fade(lnc ? LINE[row.ln] : C.label, row.alpha));
      if (row.a) {
        const ix = alertIconX(row, lx);
        f.text('small', s(G.ALERT_DISC), ix, top + 5, fade(C.red, row.alpha));
        f.text('small', s(G.ALERT_MARK), ix, top + 5, fade(C.white, row.alpha));
      }
      for (const cell of row.cells) {
        const a = cell.alpha * row.alpha;
        if (a <= 0) continue;
        drawTimeCell(f, cell.text, Math.round(cell.right), top, fade(cell.color, a), cell.roll, x0, x1);
      }
    }

    // Overnight owl (icons.js OWL): its frame at icon-clock ms t, or the
    // static owl (frame 0) without a clock.
    function owlRows(t) {
      const fr = icons.OWL.frames;
      if (t == null) return fr[0][1];
      const total = fr.reduce((a, [ms]) => a + ms, 0);
      let k = ((Math.floor(t) % total) + total) % total;
      for (const [ms, rows] of fr) { if (k < ms) return rows; k -= ms; }
      return fr[0][1];
    }

    // No trains: the owl on a line along row 31 (or row 25 above the weather
    // strip), at the left; the big clock and NO TRAINS centered in x 16-63.
    // The owl blinks and glances on the S3's icon clock.
    const OWL_X = 2, OWL_PANEL = 16;
    function drawOvernight(f, p, now) {
      const clock = clockText(now);
      const nt = p.stale ? 'NO DATA' : 'NO TRAINS';
      const bottom = p.wx ? 25 : 31;
      f.fill(0, bottom, 64, 1, C.perch);
      const rows = owlRows(ICON_T);
      const oy = bottom - rows.length;
      rows.forEach((row, j) => [...row].forEach((c, i) => {
        if (c !== '.') f.fill(OWL_X + i, oy + j, 1, 1, icons.OWL.palette[c]);
      }));
      const top = p.wx ? 3 : 5;
      rollText(f, 'clock', 'big.clock', clock, centerIn('clock', OWL_PANEL), top + 10, C.clock);
      f.text('small', nt, centerIn('small', OWL_PANEL)(nt), top + 18, C.noTrains);
    }

    // Stale train data (the server hasn't reached Train Tracker for a while):
    // a red line along the top edge, which no screen draws on.
    function drawStale(f, p) {
      if (p.stale) f.fill(0, 0, f.w, 1, C.red);
    }

    function drawTransitView(f, view, blink) {
      if (!view.rows.length) {
        drawOvernight(f, view, view.now);
      } else if (view.mode === 'split') {
        drawSplit(f, view);
      } else {
        if (view.key) {
          drawKey(f);
          if (view.header) drawBand(f, view.header, view.now, view.clock !== false);
        } else if (view.header) {
          drawHeader(f, view.header, view.now, view.hdiv, view.clock !== false, C.dimHead);
        }
        const clipTop = view.key ? 6 : view.header ? 7 : 0;
        const clipBottom = view.key && view.header ? 24 : view.wx ? 25 : 31;
        f.withClip(0, clipTop, f.w - 1, clipBottom, () => {
          for (const row of view.rows) drawViewRow(f, row, view.lnc);
        });
      }
      if (view.wx) drawWeather(f, view.wx, view.warn, blink);
    }

    // Wide board, northbound | southbound: each half's label on rows 1-5,
    // its rows, and (header on) the station and clock on rows 27-31 in the
    // dim header grey. A half with no trains says so.
    function drawSplit(f, view) {
      HALVES.forEach(([x0, x1], h) => {
        f.text('small', (view.halves || [])[h] || '', x0, 6, C.head);
        if (!view.rows.some((r) => (r.h ? 1 : 0) === h)) f.text('small', 'NO TRAINS', x0 + Math.floor((x1 - x0 + 1 - measure('small', 'NO TRAINS')) / 2), 19, C.noTrains);
      });
      if (view.header) drawBand(f, view.header, view.now, view.clock !== false, C.dimHead, false);
      f.withClip(0, 7, f.w - 1, view.header ? 25 : 31, () => {
        for (const row of view.rows) drawViewRow(f, row, view.lnc);
      });
    }

    // opts: now, blink (alert "!" phase), rolls ({slotKey: {from, p}}),
    // view (a frame from createTransitAnimator; overrides the static layout)
    // A wide payload's rows draw 128 across; with none (overnight) the 64
    // layout shows on both panels.
    function renderTransit(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      let view = o.view;
      if (!view) {
        view = buildTransitView(p, now);
        if (o.rolls) for (const row of view.rows) for (const c of row.cells) if (o.rolls[c.id]) c.roll = o.rolls[c.id];
      }
      const f = newFrame(view.rows.length && (view.w || 64) === WIDE ? WIDE : 64);
      drawTransitView(f, view, !!o.blink);
      drawStale(f, p);
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

    // Pairs the shown cells with the new ones, both in time order, at the
    // lowest total cost: a pair costs its time difference (at most MATCH_S),
    // a cell left unpaired costs MATCH_S. Returns the shown cell for each new
    // one, or null. (Taking the first close enough time instead pairs a
    // departed train with the next one when they're bunched.)
    function pairCells(old, cells) {
      const n = old.length, m = cells.length;
      const cost = [], how = [];
      for (let i = n; i >= 0; i--) {
        cost[i] = []; how[i] = [];
        for (let j = m; j >= 0; j--) {
          if (i === n || j === m) { cost[i][j] = (n - i + m - j) * MATCH_S; continue; }
          let best = cost[i + 1][j] + MATCH_S, pick = 'old';
          if (cost[i][j + 1] + MATCH_S < best) { best = cost[i][j + 1] + MATCH_S; pick = 'new'; }
          const d = Math.abs(old[i].t - cells[j].t);
          if (d <= MATCH_S && cost[i + 1][j + 1] + d < best) { best = cost[i + 1][j + 1] + d; pick = 'pair'; }
          cost[i][j] = best; how[i][j] = pick;
        }
      }
      const out = cells.map(() => null);
      for (let i = 0, j = 0; i < n && j < m;) {
        if (how[i][j] === 'pair') { out[j] = old[i]; i++; j++; } else if (how[i][j] === 'old') i++; else j++;
      }
      return out;
    }

    function createTransitAnimator() {
      let nextId = 1;
      const rows = new Map(); // key -> row state

      function matchCells(state, cells, t, isNewRow) {
        const unmatched = state.cells.filter((c) => !c.leaving);
        const pairs = pairCells(unmatched, cells);
        const used = new Set();
        const out = [];
        const moved = [], joined = []; // cells that slide / fade in as part of this step
        for (const [j, c] of cells.entries()) {
          const m = pairs[j];
          if (m) {
            used.add(m);
            if (m.text !== c.text) m.roll = { from: m.text, start: t };
            if (m.color !== c.color) { m.fromColor = m.shownColor || m.color; m.colorStart = t; }
            if (m.right !== c.right) { m.fromRight = m.shownRight == null ? m.right : m.shownRight; m.moveStart = t; moved.push(m); }
            Object.assign(m, { t: c.t, text: c.text, color: c.color, right: c.right });
            out.push(m);
          } else {
            // New arrivals fade in; a new row's arrivals come in with the row.
            const n = { ...c, id: nextId++, born: isNewRow ? null : t };
            if (!isNewRow) joined.push(n);
            out.push(n);
          }
        }
        for (const u of unmatched) if (!used.has(u)) { u.leaving = t; out.push(u); }
        for (const c of state.cells) if (c.leaving && c.leaving !== t && t - c.leaving < FADE_MS) out.push(c);
        state.cells = out.filter((c, i) => out.indexOf(c) === i);
        // Cells slide and join only once the leaving ones (a DUE going out)
        // have faded, so nothing slides across text that's still fading.
        const until = Math.max(t, ...state.cells.filter((c) => c.leaving).map((c) => c.leaving + FADE_MS));
        for (const m of moved) m.moveStart = until;
        // A new arrival waits for the slide too (it takes the space the slide frees).
        for (const n of joined) n.born = until + (moved.length ? MOVE_MS : 0);
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
          // leaving row has faded. A fresh animator shows its rows at once.
          const fresh = rows.size === 0;
          for (const r of target.rows) {
            let st = rows.get(r.key);
            const isNewRow = !st || !!st.leaving;
            if (isNewRow) {
              // A joining row fades in once any leaving row has faded. Its start
              // is fixed here: rows already shown never wait on a later leaver.
              st = { key: r.key, top: r.top, shownTop: r.top, born: fresh ? null : Math.max(t, leavingUntil), cells: [] };
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
            Object.assign(st, { ln: r.ln, lbl: r.lbl, a: r.a, al: r.al, num: r.num, mode: target.mode, h: r.h, x0: r.x0, right: r.right });
            matchCells(st, r.cells, t, isNewRow);
          }

          const view = { now, mode: target.mode, w: target.w, halves: target.halves, header: target.header, hdiv: target.hdiv, key: target.key, clock: target.clock, lnc: target.lnc, wx: target.wx, warn: target.warn, stale: target.stale, rows: [] };
          if (!target.rows.length && ![...rows.values()].some((st) => st.leaving)) { rows.clear(); return view; }
          for (const st of rows.values()) {
            st.shownTop = st.moveStart != null ? tween(st.fromTop, st.top, st.moveStart, MOVE_MS, t) : st.top;
            const alpha = st.leaving ? 1 - clamp01((t - st.leaving) / FADE_MS)
              : st.born != null ? clamp01((t - st.born) / FADE_MS) : 1;
            if (!st.leaving && alpha >= 1) st.born = null;
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
              key: st.key, ln: st.ln, lbl: st.lbl, a: st.a, al: st.al, h: st.h, x0: st.x0, right: st.right, top: st.shownTop, alpha, cells,
              num: st.num, numRoll: st.numRoll ? { from: st.numRoll.from, p: numP } : null,
            });
          }
          return view;
        },
      };
    }

    function drawTickerItem(f, it, idx, top, now, due, fill) {
      const base = top + 9;
      f.fill(0, top, 5, 12, C.index);
      f.fill(5, top, 59, 12, scaleColor(LINE[it.ln], fill));
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

    // Wide board (contract "Width"): the CTA platform sign's row. The row
    // number in the grey index column (the alert circle on a line with a
    // major alert), the band in the line color to the right edge, the full
    // destination, the time right-aligned 3 px clear of the status icon:
    // TICKER_ICONS live (tracked) or sch (schedule-based, `s`), 7 x 7 at
    // columns 120-126, rows 2-8 of the band.
    const TICKER_ICON_X = 120, TICKER_TIME_RIGHT = 116;
    const TICKER_ICONS = {
      live: ['####...', '....#..', '###..#.', '...#..#', '##..#.#', '..#.#.#', '#.#.#.#'],
      sch: ['..###..', '.#...#.', '#..#..#', '#..##.#', '#.....#', '.#...#.', '..###..'],
    };
    function drawTickerItemWide(f, it, idx, top, now, due, fill) {
      const base = top + 9;
      f.fill(0, top, 5, 12, C.index);
      f.fill(5, top, f.w - 5, 12, scaleColor(LINE[it.ln], fill));
      if (it.a) {
        f.text('small', s(G.ALERT_DISC), 0, base, C.red);
        f.text('small', s(G.ALERT_MARK), 0, base, C.white);
      } else {
        f.text('small', String(idx), 1, base, C.label);
      }
      f.text('5x7', it.d, 7, base, C.white);
      const min = minutesUntil(it.t, now);
      if (min <= 1 && due) {
        rtext(f, '5x7', 'Due', TICKER_TIME_RIGHT, base, C.white);
      } else {
        const mw = measure('5x7', s(G.MIN));
        f.text('5x7', s(G.MIN), TICKER_TIME_RIGHT - mw + 1, base, C.white);
        rtext(f, '5x7', String(min <= 1 ? 2 : min), TICKER_TIME_RIGHT - mw - 2, base, C.white);
      }
      TICKER_ICONS[it.s ? 'sch' : 'live'].forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') f.fill(TICKER_ICON_X + i, top + 2 + j, 1, 1, C.white); }));
    }

    const tickerPages = (p, now) => Math.max(1, Math.ceil(liveTicker(p, now).length / 2));

    // opts: now, page, slide (0..1 progress of the slide to the next page)
    function renderTicker(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      const wide = colsOf(p) === WIDE;
      const f = newFrame(wide ? WIDE : 64);
      const item = wide ? drawTickerItemWide : drawTickerItem;
      // The ticker's header stays when the transit header is hidden to fit.
      const th = p.tickerHeader !== undefined ? p.tickerHeader : p.header;
      if (th) drawHeader(f, th, now, false, p.hclock !== false);
      const items = liveTicker(p, now);
      // Row fill: the line color dimmed to the board's tickerFill (percent).
      const fill = (p.tickerFill || 55) / 100;
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
          item(f, it, n + 1, 7 + i * 13 + shift, now, firstOf.get(`${it.ln}:${it.d}`) === n, fill);
        });
      };
      f.withClip(0, 7, f.w - 1, 31, () => {
        drawPage(page, -offset);
        if (offset > 0 && pages > 1) drawPage((page + 1) % pages, 26 - offset);
      });
      drawStale(f, p);
      return f;
    }

    // ---- radar ----
    // Frame values (contract "Radar frame"): 1-5 rain, 6 shoreline,
    // 7 location marker, 8-10 snow. Precip fills at ~65%; the greens (light
    // rain, most of any loop, and the brightest color on the panel) at 70%
    // of that. `rb` (radar.rb, percent, default 100) scales all precip.
    const RADAR_FILL = 0.65;
    const RADAR_BASE = [
      [1, '#1f8f1f', 0.7], [2, '#2ee02e', 0.7], [3, '#ffe000', 1], [4, '#ff8c00', 1], [5, '#ff1a1a', 1],
      [8, '#4f86ff', 1], [9, '#a9c9ff', 1], [10, '#ffffff', 1],
    ];
    function radarColors(rb) {
      const out = { 6: '#34485e', 7: '#ffffff' };
      for (const [v, c, trim] of RADAR_BASE) out[v] = scaleColor(c, RADAR_FILL * trim * rb / 100);
      return out;
    }
    const RADAR = radarColors(100);
    let radarRb = 100, radarRc = RADAR;
    const radarFor = (rb) => {
      if (rb == null) rb = 100;
      if (rb !== radarRb) { radarRb = rb; radarRc = radarColors(rb); }
      return radarRc;
    };
    // Clock stack: indicator 2 + gap 2 + clock 7 + gap 2 + AM/PM 5 = 18 rows.
    const ampmFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: true });
    const ampmText = (t) => (/PM/i.test(ampmFmt.format(new Date(t * 1000))) ? 'PM' : 'AM');

    // ---- weather screen (design spec §7) ----
    // Current conditions (the weather screen without radar frames or a
    // forecast layout): the forecast layouts' top bar (icon, temperature,
    // high/low; a watch or warning takes over the high/low) on rows 0-7, then
    // a readout: label left in grey, value right-aligned to x63 in its color,
    // dot leaders between (every other column, 2px clear of both). Lines:
    // SKY (the condition word, colored by kind), FEELS (on the temperature
    // scale), WIND (with MPH), and RAIN (blue) while the payload's `rl` says
    // so (the server shows it from 20% and hides it below 10%). Four lines
    // sit on rows 9-13, 15-19, 21-25, 27-31; three on rows 11-15, 18-22,
    // 25-29 (the first on the 5-day's weekday row).
    // Mockup: docs/board/mockups/weather/readout/pick.png.
    const WX_BLUE = '#1e90ff';
    const WX_DROP = ['.#.', '###', '###', '.#.'];
    // Condition word colors by icon; anything else is label white.
    const SKY_COLOR = { rain: '#4aa0ff', ice: '#4aa0ff', snow: '#c8e8ff', tsnow: '#c8e8ff', sun: '#ffc800', moon: '#ffe47a' };
    // Temperature shadow (optional): 1px down-right at 20%, its color blended
    // from cold blue to hot red along these stops (°F).
    const TEMP_STOPS = [[-10, '#3050ff'], [20, '#40a0ff'], [40, '#30d0d0'], [55, '#40d040'], [70, '#ffd000'], [85, '#ff8000'], [100, '#ff2020']];
    // The same scale for text (feels-like): the cold end lifted, since the
    // deep blue is the board's dimmest color.
    const TEXT_TEMP_STOPS = [[-10, '#6080ff'], [20, '#60b0ff'], ...TEMP_STOPS.slice(2)];
    // TEMP_STOPS are °F; c: the temperature is °C (wx.c), converted back
    // with integer math so the board matches.
    function tempColor(t, c, stops = TEMP_STOPS) {
      if (c) t = Math.floor(t * 9 / 5) + 32;
      if (t <= stops[0][0]) return stops[0][1];
      for (let i = 1; i < stops.length; i++) {
        const [t1, c1] = stops[i];
        if (t <= t1) { const [t0, c0] = stops[i - 1]; return lerpColor(c0, c1, (t - t0) / (t1 - t0)); }
      }
      return stops[stops.length - 1][1];
    }
    const CON_LINES4 = [14, 20, 26, 32];   // baselines
    const CON_LINES3 = [16, 23, 30];
    // One readout line; the value rolls under `name` (null: no roll).
    function drawReadout(f, label, name, value, base, color) {
      const lx = f.text('small', label, 0, base, C.head);
      const vx = 63 - measure('small', value) + 1;
      for (let x = lx + 1 + ((lx + 1) % 2 ? 0 : 1); x < vx - 2; x += 2) f.fill(x, base - 1, 1, 1, C.divider);
      if (name) rollText(f, 'small', name, value, rightAt('small', 63), base, color);
      else f.text('small', value, vx, base, color);
    }
    function drawConditions(f, wx, top) {
      drawTopBar(f, wx, top);
      const lines = [['SKY', null, wx.word || '', SKY_COLOR[wx.icon] || C.label]];
      if (wx.feels != null) lines.push(['FEELS', 'wx.feels', `${wx.feels}°`, tempColor(wx.feels, wx.c, TEXT_TEMP_STOPS)]);
      if (wx.wind) lines.push(['WIND', null, wx.wind === 'CALM' ? 'CALM' : `${wx.wind} MPH`, C.label]);
      if (wx.rl && wx.pop != null) lines.push(['RAIN', 'wx.pop', `${wx.pop}%`, WX_BLUE]);
      const bases = lines.length === 4 ? CON_LINES4 : CON_LINES3;
      lines.forEach(([label, name, value, color], i) => drawReadout(f, label, name, value, bases[i], color));
    }

    // ---- 5-day layout (wxView '5day'; mockup docs/board/mockups/weather/5day-final) ----
    // The weather screen without rain when wx carries `days`. Today on rows
    // 0-7: the icon at x1, the temperature at x11 (5x7, label white, small
    // degree sign, 1px temperature-colored shadow), the high and low (`↑63 ↓49`,
    // arrow glyphs) right-aligned to x62 (a 1px margin, like the icon's)
    // (arrows dim, numbers grey). Below, five 13px day columns split by
    // dividers on rows 10-31:
    // weekday (rows 11-15), icon (17-24), and the high in its temperature
    // color (rows 27-31).
    const FD_LETTER = '#4a4a4a', FD_NUM = C.grey;
    const FD_PITCH = 13;
    const FD_ICON_X = 1;
    const FD_HL_RIGHT = 62;
    const FD_TEMP_X = FD_ICON_X + 10;   // after the 8px icon and a 2px gap, as on the weather row
    // Tom Thumb temperatures, condensed. Three characters (100+, -10 and
    // below) are 11px, against 12px between the day dividers, so they draw
    // tight: '1' advances 3 (its right column is blank) and the minus is a
    // 2px bar. Every negative uses the short minus so they match. Used for
    // the day highs and for today's high/low.
    const tightTemp = (str) => str.length >= 3 || str[0] === '-';
    const tightAdv = (ch) => (ch === '1' || ch === '-' ? 3 : 4);
    function tempWidth(str) {
      if (!tightTemp(str)) return measure('small', str);
      let w = -1;
      for (const ch of str) w += tightAdv(ch);
      return w;
    }
    // Draws at x; returns x after the last advance, like f.text.
    function drawTempText(f, str, x, base, color) {
      if (!tightTemp(str)) return f.text('small', str, x, base, color);
      for (const ch of str) {
        if (ch === '-') f.fill(x, base - 3, 2, 1, color);
        else f.text('small', ch, x, base, color);
        x += tightAdv(ch);
      }
      return x;
    }
    // A day's high, centered at cx (a pixel clear of the dividers).
    function drawDayTemp(f, str, cx, base, color) {
      drawTempText(f, str, cx - Math.floor(tempWidth(str) / 2), base, color);
    }
    // Today on rows 0-7, shared by the 5-day layout and the rain bars.
    // top: {shadow: the board's temperature shadow setting, warn: the NWS
    // watch/warning, blink: the blink phase}. The warning takes over the
    // high/low line: glyph + WATCH / WARN in its color, right-aligned to x62;
    // a tornado warning blinks (hidden on the blink's "on" phase).
    function drawTopBar(f, wx, top) {
      const { shadow, warn, blink } = top || {};
      if (icons.ICONS[wx.icon]) drawIcon(f, wx.icon, FD_ICON_X, 0);
      // The optional 1px shadow down and right in the temperature's color
      // (20%, as on the conditions screen), under the white temperature.
      if (shadow) {
        const sh = scaleColor(tempColor(wx.temp, wx.c), 0.2);
        f.text('small', '°', rollText(f, '5x7', 'wx.top', String(wx.temp), () => FD_TEMP_X + 1, 8, sh), 7, sh);
      }
      const x = rollText(f, '5x7', 'wx.top', String(wx.temp), () => FD_TEMP_X, 7, C.label);
      f.text('small', '°', x, 6, C.label);
      // Right edge of the temperature's ink (the 2px degree sign), shadow
      // included.
      const tempRight = x + 1 + (shadow ? 1 : 0);
      if (warn) {
        const ws = warnStyle(warn);
        if (ws.blinks && blink) return;
        const word = warn.lvl === 'warning' ? 'WARN' : 'WATCH';
        const gx = FD_HL_RIGHT - (measure('small', ws.glyph) + TAG_GAP + measure('small', word)) + 1;
        const wordX = f.text('small', ws.glyph, gx, 7, ws.color);
        f.text('small', word, wordX + TAG_GAP - 1, 7, ws.color);
      } else if (wx.hi != null && wx.lo != null) {
        // `↑63 ↓49` (numbers condensed like the day highs). When that would
        // come within 1px of the temperature (a three-character temperature
        // with long highs/lows): without the space before the down arrow,
        // then just `-10 -24`. Parts: [text, color, is a number].
        const hi = String(wx.hi), lo = String(wx.lo);
        const ways = [
          [[s(G.UP), FD_LETTER, false], [hi, FD_NUM, true], [' ' + s(G.DOWN), FD_LETTER, false], [lo, FD_NUM, true]],
          [[s(G.UP), FD_LETTER, false], [hi, FD_NUM, true], [s(G.DOWN), FD_LETTER, false], [lo, FD_NUM, true]],
          [[hi, FD_NUM, true], [' ', FD_NUM, false], [lo, FD_NUM, true]],
        ];
        const left = (parts) => FD_HL_RIGHT - parts.reduce((w, [t, , n]) => w + (n ? tempWidth(t) : measure('small', t)) + 1, -1) + 1;
        const parts = ways.find((w) => left(w) >= tempRight + 2) || ways[ways.length - 1];
        let hx = left(parts);
        // Baseline 7: level with the bottom of the big temperature (not its shadow).
        for (const [t, c, n] of parts) hx = n ? drawTempText(f, t, hx, 7, c) : f.text('small', t, hx, 7, c);
      }
    }
    function drawFiveDay(f, wx, top) {
      drawTopBar(f, wx, top);
      for (let i = 1; i < 5; i++) f.fill(i * FD_PITCH - 1, 10, 1, 22, C.divider);
      wx.days.slice(0, 5).forEach((d, i) => {
        const cx = i * FD_PITCH + 6;
        ctext(f, 'small', d.d, cx, 15, C.grey);
        if (icons.ICONS[d.icon]) drawIcon(f, d.icon, cx - 4, 17);
        drawDayTemp(f, String(d.hi), cx, 31, tempColor(d.hi, wx.c));
      });
    }

    // ---- hourly layout (wxView 'hourly') ----
    // The 5-day layout's top bar, then four 16px columns (dividers on cols
    // 15, 31, 47, rows 10-31) for the hours 2, 4, 6 and 8 ahead: time label
    // (rows 11-15, grey), icon (17-24), temperature (27-31, its color).
    function drawHourly(f, wx, top) {
      drawTopBar(f, wx, top);
      for (let i = 1; i < 4; i++) f.fill(i * 16 - 1, 10, 1, 22, C.divider);
      wx.hours.slice(0, 4).forEach((h, i) => {
        const cx = i * 16 + 7;
        ctext(f, 'small', h.h, cx, 15, C.grey);
        if (icons.ICONS[h.icon]) drawIcon(f, h.icon, cx - 4, 17);
        drawDayTemp(f, String(h.t), cx, 31, tempColor(h.t, wx.c));
      });
    }

    // ---- rain bars (wxRain 'bars'; mockup docs/board/mockups/weather/rain-states) ----
    // The weather screen while precipitation is falling or due in the next 2
    // hours (wx.rain). The top bar, then the title centered on rows 10-14
    // (a drop, or a flake for snow, in front of titles that don't say RAIN or SNOW), eight
    // 15-minute bars (7px wide on an 8px pitch) rising from row 25 up to 10
    // rows, and `1H` / `2H` under the 4th/5th bar gap and the last bar. An NWS
    // warning or watch takes the title's place.
    const RAIN_LEVELS = ['#0a2a78', '#0f48c0', '#1a6cff'];
    const SNOW_LEVELS = ['#3357a6', '#6e83a6', '#a6a6a6'];
    const RAIN_TEXT = '#60b0ff', SNOW_TEXT = '#a9c9ff', RAIN_DRY = '#081428', AXIS = '#555555';
    const FLAKE = ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'];
    const drawArt = (f, art, x, y, color) => art.forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') f.fill(x + i, y + j, 1, 1, color); }));
    function drawRainBars(f, wx, top) {
      const rain = wx.rain;
      drawTopBar(f, wx, top);
      const color = rain.snow ? SNOW_TEXT : RAIN_TEXT;
      // The drop or flake stands in for the word: only on titles that don't
      // say RAIN or SNOW (ENDS IN..., BREAK IN...), and only if it fits.
      const art = /RAIN|SNOW/.test(rain.title) ? null : (rain.snow ? FLAKE : WX_DROP);
      const markW = art && measure('small', rain.title) + art[0].length + 2 <= 64 ? art[0].length + 2 : 0;
      const x = 32 - Math.floor((measure('small', rain.title) + markW) / 2);
      // The text's rows are 9-13; the 5px flake matches them, the 4px drop sits on the bottom.
      if (markW) drawArt(f, art, x, rain.snow ? 9 : 10, rain.snow ? color : WX_BLUE);
      f.text('small', rain.title, x + markW, 14, color);
      const levels = rain.snow ? SNOW_LEVELS : RAIN_LEVELS;
      rain.h.slice(0, 8).forEach((h, i) => {
        if (!h) f.fill(i * 8, 25, 7, 1, RAIN_DRY);
        else f.fill(i * 8, 26 - h, 7, h, levels[Math.max(1, Math.min(3, rain.l[i])) - 1]);
      });
      ctext(f, 'small', '1H', 31, 31, AXIS);
      rtext(f, 'small', '2H', 62, 31, AXIS);
    }

    // The radar loop: with every frame on hand, step through them in time
    // order, then hold on the newest. While any is still downloading, hold
    // on the newest on hand (playing a partial loop showed missing frames
    // as empty radar, or stepped backward in time as older frames landed).
    // t: ms since the loop started (restart it when the set completes);
    // tm: timing(). Returns an index into ids, or -1 with none on hand.
    function radarLoopIdx(ids, frames, t, tm) {
      const n = radarOnHand(ids, frames);
      if (!n) return -1;
      if (n < ids.length) {
        for (let i = ids.length - 1; i >= 0; i--) if (frames[ids[i]]) return i;
      }
      const cycle = Math.max(1, n - 1) * tm.radarFrame + tm.radarHold;
      return Math.min(n - 1, Math.floor((t % cycle) / tm.radarFrame));
    }
    function radarOnHand(ids, frames) {
      let n = 0;
      for (const id of ids) if (frames && frames[id]) n++;
      return n;
    }

    // opts: now, idx (frame index into p.radar.frames; default the newest),
    // frames ({id: Uint8Array(2048)}; missing frames draw as empty radar)
    // The weather screen: the radar loop while there are frames (rain in the
    // box), current conditions (or the 5-day layout) otherwise.
    // The rain turns (rain.loops, rain.alt): the radar loop plays `loops` full
    // cycles from its start (cycle as radarLoopIdx() counts it, the hold
    // included), then the bars show for alt s, then the loop starts again.
    // n: frames in the loop; t: ms since the loop started. Mirrors
    // rain_bars_turn() in draw.py.
    function rainBarsTurn(rn, n, tm, t) {
      if (!rn || !rn.h || !rn.alt || !rn.loops || !n) return false;
      const cycle = Math.max(1, n - 1) * tm.radarFrame + tm.radarHold;
      const loopMs = rn.loops * cycle;
      return t % (loopMs + rn.alt * 1000) >= loopMs;
    }
    function renderWeather(p, opts) {
      const o = opts || {};
      const r = p.radar || {};
      const ids = r.frames || [];
      // -1 when there are no frames yet (the clock then shows the current time).
      // Peek (opts.peek): the newest frame on hand, still; -1 with none yet.
      const newestOnHand = () => { for (let i = ids.length - 1; i >= 0; i--) if (o.frames && o.frames[ids[i]]) return i; return -1; };
      const idx = !ids.length ? -1 : o.peek ? newestOnHand() : o.idx != null ? Math.max(0, Math.min(ids.length - 1, o.idx)) : ids.length - 1;
      const f = newFrame();
      // No frames (no rain in the box, or none processed yet), or none
      // downloaded yet: the weather screen.
      // Rain bars when sent (alternating with the radar loop while the
      // payload says so: rain.alt s each, epoch-aligned, bars on the odd
      // turns).
      const rn = r.wx && r.wx.rain;
      // t defaults to the epoch clock (the simulator's stills); the board
      // passes ms since its loop started.
      const loopT = o.t != null ? o.t : (o.now != null ? o.now : p.now) * 1000;
      const barsTurn = rainBarsTurn(rn, ids.length, timing(p), loopT);
      // A peek never falls back for frames still downloading: it shows the
      // empty radar, its frame indicator filling in as they land.
      if (((!ids.length || (!o.peek && o.frames && !radarOnHand(ids, o.frames))) || barsTurn) && r.wx) {
        // The forecast layouts' top bar carries a warning on its high/low line.
        const top = { shadow: !!r.tempShadow, warn: p.warn, blink: o.blink };
        if (r.wx.rain && r.wx.rain.h) drawRainBars(f, r.wx, top);
        else if (r.wx.hours && r.wx.hours.length) drawHourly(f, r.wx, top);
        else if (r.wx.days && r.wx.days.length) drawFiveDay(f, r.wx, top);
        else drawConditions(f, r.wx, top);
        return f;
      }
      const bytes = idx >= 0 && o.frames ? o.frames[ids[idx]] : null;
      if (r.wide && colsOf(p) === WIDE) return renderRadarWide(p, r, ids, idx, bytes, o);
      if (bytes) {
        const rc = radarFor(r.rb);
        for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
          const c = rc[bytes[y * 64 + x]];
          if (c) f.fill(x, y, 1, 1, c);
        }
      }
      // Split layout: gray line on the clock panel's left edge.
      if (r.split && r.timeBox) f.fill(r.timeBox[0] - 1, 0, 1, 32, C.divider);
      // Clock stack, right-aligned in the clock box: frame indicator, clock
      // (frame time), AM/PM with the warning icon to its left.
      const [bx, by, bw, bh] = r.timeBox || [40, 0, 24, 32];
      const right = Math.min(63, bx + bw - 1);
      const top = by + 2; // top-aligned (spec: rows 2-19)
      // The clock: the frame's time (dim), or the current time (white) with
      // clock 'now' or before any frame.
      const nowClock = r.clock === 'now';
      const t = !nowClock && idx >= 0 && r.ft && r.ft[idx] != null ? r.ft[idx] : (o.now != null ? o.now : p.now);
      // The radar (shoreline included) can reach into the clock box; each
      // piece of the corner gets a 1px black margin so nothing touches it.
      const clear = (b) => { if (b[1] <= b[3]) f.fill(b[0] - 1, b[1] - 1, b[2] - b[0] + 3, b[3] - b[1] + 3, '#000000'); };
      const segW = 2, segGap = 1;
      const indX = right - (ids.length * (segW + segGap) - segGap) + 1;
      if (ids.length) clear([indX, top, right, top + 1]);
      const drawIndicator = () => {
        let x = indX;
        ids.forEach((id, i) => { f.fill(x, top, segW, 2, i === idx ? C.amber : o.peek && o.frames && o.frames[id] ? PEEK_LOADED : C.indicator); x += segW + segGap; });
      };
      const ws = p.warn ? warnStyle(p.warn) : null;
      const hideWarn = ws && ws.blinks && o.blink;
      // Warning tag (icon + WATCH/WARN) at the screen's bottom right on a
      // black backing (it may run past the time box).
      const drawWarnTag = () => {
        const word = p.warn.lvl === 'warning' ? 'WARN' : 'WATCH';
        const x0 = 64 - (measure('small', ws.glyph) + TAG_GAP + measure('small', word));
        f.fill(x0 - 1, 25, 64 - x0 + 1, 7, '#000000');
        if (!hideWarn) {
          const x = f.text('small', ws.glyph, x0, 31, ws.color);
          f.text('small', word, x + TAG_GAP - 1, 31, ws.color);
        }
      };
      if (r.showTime === false && r.temp != null) {
        // Time off: current conditions (icon + temperature, as on the weather
        // row) right-aligned under the indicator, and the warning tag (icon +
        // WATCH/WARN) at the screen's bottom right on a black backing. With no
        // weather data yet, the time shows instead.
        const t = `${r.temp}°`;
        const icon = r.icon && icons.ICONS[r.icon] ? r.icon : null;
        const x0 = right + 1 - ((icon ? 10 : 0) + measure('small', t));
        if (icon) clear([x0, top + 4, x0 + 7, top + 11]);
        clear(textBox('small', t, x0 + (icon ? 10 : 0), top + 10));
        drawIndicator();
        if (icon) drawIcon(f, icon, x0, top + 4);
        f.text('small', t, x0 + (icon ? 10 : 0), top + 10, C.label);
        if (ws) drawWarnTag();
        return f;
      }
      if (r.clock === 'none') {
        // Nothing in the corner but the frame indicator (and a warning tag,
        // if any); the rest is radar.
        drawIndicator();
        if (ws) drawWarnTag();
        return f;
      }
      if (r.clock === 'age') {
        // How long ago the shown frame is ("3m"), dark grey Tom Thumb under
        // the frame indicator; the warning tag at the bottom right as with
        // time off.
        const nowS = o.now != null ? o.now : p.now;
        const ft = idx >= 0 && r.ft && r.ft[idx] != null ? r.ft[idx] : nowS;
        const age = `${Math.max(0, Math.floor((nowS - ft + 30) / 60))}m`;
        clear(textBox('small', age, right - measure('small', age) + 1, top + 9));
        drawIndicator();
        rtext(f, 'small', age, right, top + 9, C.radarSub);
        if (ws) drawWarnTag();
        return f;
      }
      if (r.cond) {
        // Time with conditions: time and A/P on one line (A/P 1px after the
        // time, bottom-aligned), the temperature right-aligned under it on
        // rows 15-19 (both dark gray), the warning tag at the bottom right as with time off.
        // From 10:00 to 12:59 the line is 26px and runs 2px past a 24px box.
        const clock = clockText(t);
        const ap = ampmText(t).slice(0, 1);
        const apX = right - measure('small', ap) + 1;
        const clockRight = apX - 2;
        const ct = r.temp != null ? `${r.temp}°` : null;
        // The current time rolls when it changes (a frame's time steps with
        // the loop, so it doesn't).
        const cx = rightAt('5x7', clockRight);
        const cr = nowClock ? takeRoll('rad.clock', clock) : null;
        clear(textBox('5x7', clock, cx(clock), top + 11));
        if (cr) clear(textBox('5x7', cr.from, cx(cr.from), top + 11));
        clear(textBox('small', ap, apX, top + 11));
        if (ct) clear(textBox('small', ct, right - measure('small', ct) + 1, top + 18));
        drawIndicator();
        rollTextWith(f, '5x7', cr, clock, cx, top + 11, nowClock ? C.clock : C.radarTime);
        f.text('small', ap, apX, top + 11, C.radarSub);
        if (ct) rtext(f, 'small', ct, right, top + 18, C.radarSub);
        if (ws) drawWarnTag();
        return f;
      }
      const clock = clockText(t);
      const ap = ampmText(t);
      const apX = right - measure('small', ap) + 1;
      const wX = ws ? apX - 2 - measure('small', ws.glyph) : 0;
      const cx = rightAt('5x7', right);
      const cr = nowClock ? takeRoll('rad.clock', clock) : null;
      clear(textBox('5x7', clock, cx(clock), top + 11));
      if (cr) clear(textBox('5x7', cr.from, cx(cr.from), top + 11));
      clear(textBox('small', ap, apX, top + 18));
      if (ws) clear(textBox('small', ws.glyph, wX, top + 18));
      drawIndicator();
      // A frame's time is dimmed so it doesn't read as the current time.
      // The current time rolls when it changes.
      rollTextWith(f, '5x7', cr, clock, cx, top + 11, nowClock ? C.clock : C.radarTime);
      f.text('small', ap, apX, top + 18, C.radarAmpm);
      if (ws && !hideWarn) f.text('small', ws.glyph, wX, top + 18, ws.color);
      return f;
    }

    // Wide board (contract "Width"; wide-spec §5): radar.wide frames are 128
    // x 32, the station at x69. The time on a black chip in the bottom-right
    // corner, rows 26-31, at least 27 wide (columns 101-127, so it keeps its
    // size as the loop's times change): the time (or radar.clock 'age': how
    // long ago) in Tom Thumb, label white, then AM/PM in #8f8f8f at the right
    // edge. A watch or warning on a black chip at the bottom left, in place
    // of the temperature (radar.cond, or the time off) when that's on. The
    // frame dots: one 1 px dot per frame, 1 px apart from x0, the shown frame
    // amber, the others #4a4a4a, the gaps between them black; on row 31, or
    // with a left chip on row 25, just above it. Clock 'none': no time.
    // Chips: rows 26-31, 1 px of black above the text.
    const WIDE_CHIP_X = 101, WIDE_CHIP_Y = 26, WIDE_DOT = '#4a4a4a';
    function renderRadarWide(p, r, ids, idx, bytes, o) {
      const f = newFrame(WIDE);
      if (bytes) {
        const rc = radarFor(r.rb);
        for (let y = 0; y < 32; y++) for (let x = 0; x < WIDE; x++) {
          const c = rc[bytes[y * WIDE + x]];
          if (c) f.fill(x, y, 1, 1, c);
        }
      }
      const nowS = o.now != null ? o.now : p.now;
      const nowClock = r.clock === 'now';
      const t = !nowClock && idx >= 0 && r.ft && r.ft[idx] != null ? r.ft[idx] : nowS;
      const ws = p.warn ? warnStyle(p.warn) : null;
      const hideWarn = ws && ws.blinks && o.blink;
      const showTime = r.showTime !== false && r.clock !== 'none';
      // The time chip: AM/PM at the right edge, the time before it.
      if (showTime && r.clock === 'age') {
        const ft = idx >= 0 && r.ft && r.ft[idx] != null ? r.ft[idx] : nowS;
        const age = `${Math.max(0, Math.floor((nowS - ft + 30) / 60))}m`;
        f.fill(WIDE_CHIP_X, WIDE_CHIP_Y, WIDE - WIDE_CHIP_X, 32 - WIDE_CHIP_Y, '#000000');
        f.text('small', age, WIDE - measure('small', age), 32, C.label);
      } else if (showTime) {
        const ap = ampmText(t), clock = clockText(t);
        const apX = WIDE - measure('small', ap);
        const right = apX - 3;  // 2 px between the time and AM/PM
        const cr = nowClock ? takeRoll('rad.clock', clock) : null;
        let x = right - measure('small', clock) + 1;
        if (cr) x = Math.min(x, right - measure('small', cr.from) + 1);
        const x0 = Math.min(WIDE_CHIP_X, x - 1);
        f.fill(x0, WIDE_CHIP_Y, WIDE - x0, 32 - WIDE_CHIP_Y, '#000000');
        rollTextWith(f, 'small', cr, clock, rightAt('small', right), 32, C.label);
        f.text('small', ap, apX, 32, C.radarAmpm);
      }
      // The bottom-left chip: a watch or warning (in place of the
      // temperature), else the temperature; the frame dots above it.
      let chip = false;
      if (ws) {
        const word = p.warn.lvl === 'warning' ? 'WARNING' : 'WATCH';
        const tw = measure('small', ws.glyph) + TAG_GAP + measure('small', word);
        f.fill(0, WIDE_CHIP_Y, tw + 1, 32 - WIDE_CHIP_Y, '#000000');
        if (!hideWarn) {
          const gx = f.text('small', ws.glyph, 0, 32, ws.color);
          f.text('small', word, gx + TAG_GAP - 1, 32, ws.color);
        }
        chip = true;
      } else if (r.temp != null && (r.cond || r.showTime === false)) {
        const tt = `${r.temp}°`, tw = measure('small', tt);
        f.fill(0, WIDE_CHIP_Y, tw + 1, 32 - WIDE_CHIP_Y, '#000000');
        f.text('small', tt, 0, 32, C.label);
        chip = true;
      }
      const dy = chip ? WIDE_CHIP_Y - 1 : 31;
      if (ids.length) f.fill(0, dy, ids.length * 2 - 1, 1, '#000000');
      ids.forEach((id, i) => f.fill(i * 2, dy, 1, 1, i === idx ? C.amber : o.peek && o.frames && o.frames[id] ? PEEK_LOADED : WIDE_DOT));
      return f;
    }

    // ---- baseball (design spec §8) ----
    // Three layouts (p.mlb.layout): 'classic' (default), 'logos', and 'bands'
    // (the logo layout's bands with abbreviations instead of logos). Classic:
    // team rows on the left (color block + 5x7 abbreviation + score), status
    // panel centered on x51, divider on row 24, bottom line right-aligned.
    const BB = { live: '#f0f0f0', lose: '#6a6a6a', base: '#454545', infield: '#3a3a3a' };
    const ROW_TOPS = [2, 12];   // away, home
    const SCORE_RIGHT = 30, PANEL_X = 51, BOTTOM = 31, DIVIDER = 24; // same divider and bottom line in both layouts
    const SCORE_ROLL = 8;       // 5x7 digit (7 rows incl. descender) + 1px
    const ctext = (f, font, str, cx, base, color) => f.text(font, str, cx - Math.floor(measure(font, str) / 2), base, color);
    const record = (t) => (t.w == null || t.l == null ? '' : `${t.w}-${t.l}`);

    // Which game is up: live games take precedence over pregame and finals;
    // within that set, one minute each by wall time, so the board and the
    // simulator agree without keeping rotation state. Returns the index into
    // games, the game's place in the rotation, and the rotation size.
    // all: rotate every game (bbPriority 'all'); otherwise live games first.
    function pickGame(games, now, every = 60, all = false) {
      if (!games.length) return { i: -1, pos: 0, of: 0 };
      const live = all ? [] : games.map((g, i) => (g.st === 'live' ? i : -1)).filter((i) => i >= 0);
      const pool = live.length ? live : games.map((_, i) => i);
      const pos = Math.floor(now / every) % pool.length;
      return { i: pool[pos], pos, of: pool.length };
    }

    // A score that just changed shows amber for SCORE_HOLD_S, then fades back
    // to the live white over SCORE_FADE_S. `side.at` is when the server saw
    // the change (epoch s); without it the score is plain white.
    const SCORE_HOLD_S = 30, SCORE_FADE_S = 5;
    function scoreColor(side, now, rest = BB.live) {
      if (side.at == null) return rest;
      const age = now - side.at;
      if (age < 0 || age < SCORE_HOLD_S) return C.amber;
      if (age >= SCORE_HOLD_S + SCORE_FADE_S) return rest;
      return lerpColor(C.amber, rest, (age - SCORE_HOLD_S) / SCORE_FADE_S);
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
    function drawInfield(f, on, cy = 7) {
      drawDiamond(f, PANEL_X, cy, 5, BB.infield, false);
      drawDiamond(f, PANEL_X, cy - 5, 2, on[1] ? C.amber : BB.base, true);
      drawDiamond(f, PANEL_X - 5, cy, 2, on[2] ? C.amber : BB.base, true);
      drawDiamond(f, PANEL_X + 5, cy, 2, on[0] ? C.amber : BB.base, true);
    }

    // Tom Thumb status text that can roll like an arrival time: `left` is
    // its left edge, `fromLeft` the outgoing text's (default: keep the right
    // edge). Same-length texts in place whose changed characters keep their
    // widths roll only those characters ("TOP 7" -> "BOT 7" rolls T/B and
    // P/T); anything else rolls the whole text: old up and out, new up in.
    function drawRollText(f, text, left, base, color, roll, fromLeft) {
      if (!roll || roll.from === text || roll.p >= 1) { f.text('small', text, left, base, color); return; }
      const from = roll.from;
      const up = Math.round(easeInOut(roll.p) * ROLL_DIST);
      const oldLeft = fromLeft != null ? fromLeft : left + measure('small', text) - measure('small', from);
      const sameShape = oldLeft === left && from.length === text.length && [...text].every((ch, i) => measure('small', ch) === measure('small', from[i]));
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
          f.text('small', from, oldLeft, base - up, color);
          f.text('small', text, left, base - up + ROLL_DIST, color);
        }
      });
    }

    // The live bottom line: count, a 5px gap, then outs, right-aligned to
    // x63. Outgoing texts keep the old line's layout, so when the line
    // empties between halves (or a width changes) the old count and outs
    // roll out where they were instead of piling onto each other.
    function drawBottomLine(f, t, rolls) {
      const layout = (count, outs) => {
        const outsLeft = 63 - measure('small', outs) + 1;
        return [outsLeft - 5 - measure('small', count), outsLeft];
      };
      const was = (k) => (rolls[k] && rolls[k].p < 1 ? rolls[k].from : t[k]);
      const [countLeft, outsLeft] = layout(t.count, t.outs);
      const [oldCountLeft, oldOutsLeft] = layout(was('count'), was('outs'));
      drawRollText(f, t.outs, outsLeft, BOTTOM, C.grey, rolls.outs, oldOutsLeft);
      drawRollText(f, t.count, countLeft, BOTTOM, C.label, rolls.count, oldCountLeft);
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
      rollText(f, 'clock', 'big.clock', clock, centerX('clock'), top + 10, C.clock);
      f.text('small', label, Math.floor((64 - measure('small', label)) / 2), top + 18, C.noTrains);
    }

    // Embossed text: black right of, below, and below-right of every lit
    // pixel, then the text, so it reads as raised over logos and bands.
    function embossText(f, font, str, x, base, color, shadow = '#000000') {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) f.text(font, str, x + dx, base + dy, shadow);
      return f.text(font, str, x, base, color);
    }

    // ---- baseball, logo layout ----
    // Each team gets a 12-row band (rows 0-11 away, 12-23 home) out to x37 in
    // its band color, with its 24x12 logo crop at the left (both dimmed here by
    // p.mlb.dim; crops come from mlb-logos.js) and the score centered between logo and band
    // end in white, or black (unlit) on a light band. The status panel and bottom line are the
    // classic layout's, with the infield and inning nudged down to center on
    // the taller rows.
    const LG = { w: 24, rows: 12, tops: [0, 12], bandR: 37, cx: 30, infieldY: 8, innBase: 21, dim: 0.9 }; // dim: default when the payload has none
    const LG_ROLL = 8;
    // Text on a band is white, or black (unlit) on a light band: drawn band
    // luma above LG_LIGHT, e.g. Atlanta's light grey or Milwaukee's gold.
    const LG_LIGHT = 140;
    const lgInk = (side, dim) => {
      const [r, g, b] = hex(scaleColor(side.bd || side.c || C.grey, dim));
      return (299 * r + 587 * g + 114 * b) / 1000 > LG_LIGHT ? '#000000' : BB.live;
    };

    // bands: true for the 'bands' layout (no logos: the abbreviation in white
    // with a drop shadow takes the logo's place).
    function drawLogoBand(f, side, top, logos, bands, dim) {
      f.fill(0, top, LG.bandR + 1, LG.rows, scaleColor(side.bd || side.c || C.grey, dim));
      if (bands) {
        const ab = side.ab || '';
        f.text('5x7', ab, (LG.w >> 1) - Math.floor(measure('5x7', ab) / 2), top + 9, lgInk(side, dim));
        return;
      }
      const bytes = side.lg && logos ? logos[side.lg] : null;
      if (bytes && bytes.length >= LG.w * LG.rows * 3) {
        for (let y = 0; y < LG.rows; y++) for (let x = 0; x < LG.w; x++) {
          const i = (y * LG.w + x) * 3;
          f.set(x, top + y, [Math.round(bytes[i] * dim), Math.round(bytes[i + 1] * dim), Math.round(bytes[i + 2] * dim)]);
        }
      } else {
        // No logo (none uploaded, or not fetched yet): the abbreviation, in the
        // band's ink (black on a light band), like the score.
        ctext(f, '5x7', side.ab || '', LG.w >> 1, top + 9, lgInk(side, dim));
      }
    }

    // Score (or pregame abbreviation) centered in the band's box, embossed;
    // a changed score rolls digit by digit inside the box.
    function drawLogoScore(f, text, top, color, roll, dx = 0) {
      const base = top + 9;
      const left = (t) => LG.cx + dx - Math.floor(measure('5x7', t) / 2);
      if (!roll || roll.from === text || roll.p >= 1) { f.text('5x7', text, left(text), base, color); return; }
      const up = Math.round(easeInOut(roll.p) * LG_ROLL);
      f.withClip(LG.w, base - 6, LG.bandR + 1, base, () => { // the digit rows
        const from = roll.from;
        if (from.length === text.length) {
          let x = left(text);
          for (let i = 0; i < text.length; i++) {
            if (from[i] === text[i]) f.text('5x7', text[i], x, base, color);
            else {
              f.text('5x7', from[i], x, base - up, color);
              f.text('5x7', text[i], x, base - up + LG_ROLL, color);
            }
            x += measure('5x7', text[i]) + 1;
          }
        } else {
          f.text('5x7', from, left(from), base - up, color);
          f.text('5x7', text, left(text), base - up + LG_ROLL, color);
        }
      });
    }

    function renderBaseballLogos(f, p, g, now, o) {
      const rolls = o.rolls || {};
      const logos = o.logos || {};
      // Logos: the band layout (abbreviations) until every logo the game uses
      // has loaded, rather than popping in one at a time. A side with no
      // logo uploaded (lg null) never loads, so it doesn't hold the others.
      const bands = p.mlb.layout === 'bands'
        || [g.away, g.home].some((s) => s.lg && !(logos[s.lg] && logos[s.lg].length >= LG.w * LG.rows * 3));
      const dim = p.mlb.dim != null ? p.mlb.dim : LG.dim;
      const final = g.st === 'final';
      const winner = final ? (g.away.r > g.home.r ? 'away' : g.home.r > g.away.r ? 'home' : null) : null;
      const sides = [['away', LG.tops[0]], ['home', LG.tops[1]]];
      for (const [k, top] of sides) drawLogoBand(f, g[k], top, logos, bands, dim);
      f.fill(0, DIVIDER, 64, 1, C.divider);

      if (g.st === 'pre') {
        // Abbreviations in the score boxes, records in the panel, TODAY and
        // the first-pitch time on the bottom line.
        for (const [k, top] of sides) {
          if (!bands) drawLogoScore(f, g[k].ab || '', top, lgInk(g[k], dim), null, -1); // 1px left of the score's center
          ctext(f, 'small', record(g[k]), PANEL_X, top + 8, C.grey);
        }
        f.text('small', 'TODAY', 0, BOTTOM, C.grey);
        const ap = ampmText(g.start);
        rtext(f, 'small', ap, 63, BOTTOM, C.grey);
        rtext(f, 'small', clockText(g.start), 63 - measure('small', ap) - 3, BOTTOM, C.label);
        return f;
      }

      if (final) {
        for (const [k, top] of sides) {
          drawLogoScore(f, String(g[k].r), top, winner === k ? C.amber : lgInk(g[k], dim), rolls[k]);
          ctext(f, 'small', record(g[k]), PANEL_X, top + 8, C.grey);
        }
        rtext(f, 'small', 'FINAL', 63, BOTTOM, C.label);
        return f;
      }

      drawLogoScore(f, String(g.away.r), LG.tops[0], scoreColor(g.away, now, lgInk(g.away, dim)), rolls.away);
      drawLogoScore(f, String(g.home.r), LG.tops[1], scoreColor(g.home, now, lgInk(g.home, dim)), rolls.home);
      drawInfield(f, g.on || [0, 0, 0], LG.infieldY);
      const t = liveTexts(g);
      drawRollText(f, t.inn, PANEL_X - Math.floor(measure('small', t.inn) / 2), LG.innBase, C.label, rolls.inn);
      drawBottomLine(f, t, rolls);
      return f;
    }

    // opts: now, game (index into p.mlb.games; default the rotation),
    // rolls ({away|home|inn|count|outs: {from, p}}: scores and live status
    // texts mid-roll), logos ({id: 864-byte 24x12 RGB crop}; logo layout)
    function renderBaseball(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      const f = newFrame();
      const games = (p.mlb && p.mlb.games) || [];
      if (!games.length) { drawNoGames(f, now); return f; }
      const g = games[o.game != null ? o.game % games.length : pickGame(games, now, timing(p).game, !!(p.mlb && p.mlb.all)).i];
      if (p.mlb.layout === 'logos' || p.mlb.layout === 'bands') return renderBaseballLogos(f, p, g, now, o);
      const rolls = o.rolls || {};
      const final = g.st === 'final';
      const winner = final ? (g.away.r > g.home.r ? 'away' : g.home.r > g.away.r ? 'home' : null) : null;

      // Team rows.
      let nameEnd = 0;
      for (const [k, top] of [['away', ROW_TOPS[0]], ['home', ROW_TOPS[1]]]) {
        f.fill(0, top, 3, 6, g[k].c || C.grey);
        nameEnd = Math.max(nameEnd, f.text('5x7', g[k].ab, 5, top + 6, winner === k ? C.amber : C.label));
      }
      f.fill(0, DIVIDER, 64, 1, C.divider);

      if (g.st === 'pre') {
        // Records 3px after the longer name; first pitch in the bottom line.
        f.text('small', record(g.away), nameEnd + 2, ROW_TOPS[0] + 6, C.grey);
        f.text('small', record(g.home), nameEnd + 2, ROW_TOPS[1] + 6, C.grey);
        f.text('small', 'TODAY', 0, BOTTOM, C.grey);
        const ap = ampmText(g.start);
        rtext(f, 'small', ap, 63, BOTTOM, C.grey);
        rtext(f, 'small', clockText(g.start), 63 - measure('small', ap) - 3, BOTTOM, C.label);
        return f;
      }

      if (final) {
        for (const [k, top] of [['away', ROW_TOPS[0]], ['home', ROW_TOPS[1]]]) {
          drawScore(f, String(g[k].r), top, winner === k ? C.amber : winner ? BB.lose : C.label, rolls[k]);
          ctext(f, 'small', record(g[k]), PANEL_X, top + 6, C.grey);
        }
        rtext(f, 'small', 'FINAL', 63, BOTTOM, C.label);
        return f;
      }

      // Live.
      drawScore(f, String(g.away.r), ROW_TOPS[0], scoreColor(g.away, now), rolls.away);
      drawScore(f, String(g.home.r), ROW_TOPS[1], scoreColor(g.home, now), rolls.home);
      drawInfield(f, g.on || [0, 0, 0]);
      const t = liveTexts(g);
      drawRollText(f, t.inn, PANEL_X - Math.floor(measure('small', t.inn) / 2), 20, C.label, rolls.inn);
      drawBottomLine(f, t, rolls);
      return f;
    }

    // Texts of the game on screen that roll when they change: scores, and
    // while live the inning, count, and outs. `key` (game and state) changes
    // when a different game or state is up; don't roll across those.
    function baseballTexts(p, now) {
      const games = (p.mlb && p.mlb.games) || [];
      if (!games.length) return null;
      const g = games[pickGame(games, now, timing(p).game, !!(p.mlb && p.mlb.all)).i];
      const texts = { away: String(g.away.r), home: String(g.home.r) };
      if (g.st === 'live') Object.assign(texts, liveTexts(g));
      return { key: `${g.id}:${g.st}`, texts };
    }

    // Knob chooser (spec §10, "Knob"): the payload's knob.ring as a sideways
    // wheel across the top of a blank panel. The selection is in 5x7 on
    // baseline 7, centered; its neighbors are Tom Thumb on baseline 6,
    // CHOOSER_PITCH px either side, fading to dark grey with distance and
    // clipped at the panel edges. Row 9 has one 3x1 pip per entry, the
    // selection amber. opts.chooser: {pos, commit}. pos is the wheel position
    // as an entry index: fractional mid-slide, and any integer offset (it
    // wraps). commit: only the selection, in amber (held while the board
    // asks the server for the new screen).
    const CHOOSER_PITCH = 38;
    function renderChooser(p, opts) {
      const f = newFrame();
      const ring = (p.knob && p.knob.ring) || [];
      const n = ring.length;
      if (!n) return f;
      const c = opts.chooser || {};
      const pos = c.pos || 0;
      const sel = ((Math.round(pos) % n) + n) % n;
      for (let k = 0; k < n; k++) {
        const d = k - pos - n * Math.floor((k - pos + n / 2) / n); // wrapped into [-n/2, n/2)
        const ad = Math.abs(d);
        if (ad > 1.6) continue;
        const big = ad < 0.5;
        if (c.commit && !big) continue;
        const name = String(ring[k]).toUpperCase();
        const font = big ? '5x7' : 'small';
        const color = big && c.commit ? C.amber : lerpColor(C.label, C.dimHead, Math.min(1, ad));
        f.text(font, name, Math.round(32 + d * CHOOSER_PITCH - measure(font, name) / 2), big ? 7 : 6, color);
      }
      const x0 = 32 - Math.floor((n * 5 - 2) / 2);
      for (let i = 0; i < n; i++) f.fill(x0 + i * 5, 9, 3, 1, i === sel ? C.amber : C.indicator);
      return f;
    }

    // ---- peek chooser (spec §10, "Knob"; contract "Peek") ----
    // While the knob turns, the panel shows the chosen category's variant
    // itself, drawn from the payload's sections and `pv`, with the icon bar
    // over rows 21-31: one 7x7 icon per ring entry in its category color
    // (30% when not chosen), an underline under the chosen one, and its
    // variants as a column of dots beside it. opts.peek: {k, vi} the view
    // (ring index, variant index); slide: {k, vi, t, axis, dir} the view it
    // is sliding away from (t ms in; axis 'x' for a category, 'y' for a
    // variant; dir +1 the new view enters from the right or below); drop:
    // rows the bar has dropped (0 up, PEEK.band gone).
    const PEEK = { xMs: 270, yMs: 300, upMs: 240, downMs: 390, band: 11, top: 21, pitch: 12 };
    const PEEK_LOADED = '#6a6a6a';
    const PEEK_ICONS = {
      transit: ['.#####.', '#.....#', '#.....#', '#######', '##...##', '.#####.', '#.....#'],
      weather: ['...#...', '.#...#.', '..###..', '#.###.#', '..###..', '.#...#.', '...#...'],
      clock: ['..###..', '.#...#.', '#..#..#', '#..##.#', '#.....#', '.#...#.', '..###..'],
      announce: ['#######', '#.....#', '#.###.#', '#.....#', '#######', '.##....', '.#.....'],
      cycle: ['..###.#', '.#...##', '#...###', '#.....#', '###...#', '##...#.', '#.###..'],
    };
    const PEEK_COLORS = { weather: '#ffd040', clock: '#f0e2c8', announce: '#40e090', cycle: '#3fd0e8' };
    // Transit is always Red Line red, whatever the station.
    const peekColor = (p, cat) => (cat === 'transit' ? LINE.RD : PEEK_COLORS[cat] || C.label);
    // Ease-out cubic, 0..1.
    const peekEase = (k) => { const c = Math.max(0, Math.min(1, k)); return 1 - (1 - c) * (1 - c) * (1 - c); };
    // The cycle symbol (the phone's two arrows, anti-aliased): 16 levels of
    // cyan in a 20x20 box at x22, y6.
    const CYCLE_ART = ['0000028cffffc8206400', '00008effffffffe9f600', '001bffe844448efff800', '00bff810000009fffb00', '08ff600000006efffd00',
      '2ef80000000000258b00', '8fe10000000000000000', 'cf800000000000000000', 'ff400000000000000000', 'ff4000000000000000ee',
      'ee0000000000000004ff', '000000000000000004ff', '000000000000000008fc', '00000000000000001ef8', '00b85200000000008fe2',
      '00dfffe600000006ff80', '00bfff900000018ffb00', '008fffe844448effb100', '006f9effffffffe80000', '0046028cffffc8200000'];
    function drawCycleArt(f) {
      const c = hex(PEEK_COLORS.cycle);
      CYCLE_ART.forEach((row, j) => [...row].forEach((ch, i) => {
        const lv = parseInt(ch, 16);
        if (lv) f.set(22 + i, 6 + j, c.map((v) => Math.round(v * lv / 15)));
      }));
    }
    // A variant's payload and screen: the chosen ring entry `k` with variant
    // `vi`, its data taken from `pv` (forecast lists, clock faces).
    function peekView(p, k, vi) {
      const kn = p.knob || {}, cat = (kn.ring || [])[k], v = ((kn.vars || [])[k] || [])[vi], pv = p.pv || {};
      if (cat === 'transit') return { p, screen: v === 'ticker' ? 'ticker' : 'transit' };
      if (cat === 'weather') {
        // The radar view: every kept frame (pv.radar), rain or not. The
        // others: the radar loop only while rain is in the box (radar.on).
        const r = p.radar || {}, all = pv.radar || {};
        const frames = v === 'radar' ? all.frames || r.frames || [] : r.on ? r.frames || [] : [];
        const ft = v === 'radar' ? all.ft || r.ft || [] : r.on ? r.ft || [] : [];
        let wx = r.wx || null;
        if (wx) {
          wx = { ...wx };
          delete wx.days; delete wx.hours;
          if (v === 'radar') delete wx.rain;
          if (v === '5day' && pv.days) wx.days = pv.days;
          if (v === 'hourly' && pv.hours) wx.hours = pv.hours;
        }
        return { p: { ...p, radar: { ...r, frames, ft, wx } }, screen: 'weather' };
      }
      if (cat === 'clock') return { p: { ...p, cface: v || 'skyline', skyline: pv.skyline || null, cwx: pv.cwx || null, dn: pv.dn || null, cacc: pv.cacc || null, ginv: !!pv.ginv, steady: !!pv.steady }, screen: 'clock' };
      if (cat === 'announce') return { p, screen: 'announce' };
      return { p, screen: 'cycle' };
    }
    // On a wide board every view is 128 across (64-wide ones on both panels),
    // and the bar is centered on the whole width.
    function drawPeekView(p, k, vi, o) {
      const { p: q, screen } = peekView(p, k, vi);
      if (screen === 'cycle') { const f = newFrame(); drawCycleArt(f); return widen(f, colsOf(p)); }
      const oo = { ...o, peek: true, screen };
      return widen(screen === 'ticker' ? renderTicker(q, oo) : screen === 'weather' ? renderWeather(q, oo) : screen === 'clock' ? renderClock(q, oo)
        : screen === 'announce' ? renderAnnounce(q, oo) : renderTransit(q, oo), colsOf(p));
    }
    function drawPeekBar(f, p, k, vi, drop) {
      const kn = p.knob || {}, ring = kn.ring || [], n = ring.length;
      const sh = (y) => y + drop;
      f.fill(0, sh(PEEK.top), f.w, PEEK.band, '#000000');
      const x0 = Math.floor(f.w / 2 - (n * PEEK.pitch - 5) / 2);
      ring.forEach((cat, i) => {
        const col = peekColor(p, cat), rows = PEEK_ICONS[cat];
        if (!rows) return;
        const c = i === k ? col : scaleColor(col, 0.3);
        rows.forEach((r, j) => [...r].forEach((ch, x) => { if (ch === '#') f.fill(x0 + i * PEEK.pitch + x, sh(23 + j), 1, 1, c); }));
      });
      const ix = x0 + k * PEEK.pitch, col = peekColor(p, ring[k]);
      f.fill(ix, sh(31), 7, 1, col);
      const nv = ((kn.vars || [])[k] || []).length;
      if (nv > 1) for (let j = 0; j < nv; j++) f.fill(ix + 8, sh(26 - (nv - 1) + j * 2), 1, 1, j === vi ? col : C.indicator);
    }
    // Slide offset in px (0..w across, 0..32 down) at t ms.
    const peekShift = (axis, t, w = 64) => Math.round(peekEase(t / (axis === 'x' ? PEEK.xMs : PEEK.yMs)) * (axis === 'x' ? w : 32));
    // Rows the bar has dropped at t ms: rising (up) from gone to 0, or falling.
    const peekDrop = (up, t) => Math.round((up ? 1 - peekEase(t / PEEK.upMs) : peekEase(t / PEEK.downMs)) * PEEK.band);
    function renderPeek(p, opts) {
      const o = opts || {}, pk = o.peek || {};
      const k = pk.k || 0, vi = pk.vi || 0, drop = Math.max(0, Math.min(PEEK.band, pk.drop || 0));
      const f = drawPeekView(p, k, vi, o);
      const sl = pk.slide;
      if (sl && sl.t != null) {
        const W = f.w, axis = sl.axis === 'y' ? 'y' : 'x', dir = sl.dir < 0 ? -1 : 1, sh = peekShift(axis, sl.t, W);
        if (sh < (axis === 'x' ? W : 32)) {
          const from = drawPeekView(p, sl.k || 0, sl.vi || 0, o), cur = f.px.slice();
          for (let y = 0; y < 32; y++) for (let x = 0; x < W; x++) {
            let src = from.px, sx = x, sy = y;
            if (axis === 'x') { sx = x + dir * sh; if (sx < 0 || sx >= W) { src = cur; sx = ((sx % W) + W) % W; } }
            else { sy = y + dir * sh; if (sy < 0 || sy >= 32) { src = cur; sy = ((sy % 32) + 32) % 32; } }
            const i = (y * W + x) * 3, j = (sy * W + sx) * 3;
            f.px[i] = src[j]; f.px[i + 1] = src[j + 1]; f.px[i + 2] = src[j + 2];
          }
        }
      }
      if (drop < PEEK.band) drawPeekBar(f, p, k, vi, drop);
      return f;
    }

    // ---- clock screen: skyline face (design spec §14; contract "Skyline") ----
    // The skyline seen from the lake across Navy Pier, drawn in layers from
    // the payload's `skyline` values; the board never interprets weather.
    // Everything here is plain arithmetic and an integer hash (no Math.cos,
    // atan2 or random) so firmware ports can match it pixel for pixel.
    // `o.ms` is the animation clock, epoch milliseconds (boats and lightning
    // are scheduled on the wall clock); it defaults to now.
    // The scene, built once per width: the 64 scene, and the wide board's
    // (wide-spec §6, panorama) with the same scene 32 px in (O) and generic
    // towers either side (cfg.extra: [x, width, rows, role]; cfg.ants; twice
    // the stars).
    function buildSky(cfg) {
      const W = cfg.W, O = cfg.O, SHORE = 25, CX = 32 + O, CY = 17, R = 6, SPREAD = 5;
      // 0 sky, 1 background mass, 2 tower (only towers and mass right of the
      // wheel get windows).
      const role = new Uint8Array(W * 32);
      const rect = (x, w, t, r) => { for (let y = Math.max(0, t); y <= SHORE; y++) for (let i = x; i < x + w; i++) if (i >= 0 && i < W) role[y * W + i] = r; };
      const top = (rows) => SHORE + 1 - rows;
      // Background mass: the Loop to the left, Streeterville to the right. [x, width, rows]
      [[0, 4, 7], [8, 3, 9], [19, 3, 8], [22, 3, 10], [28, 3, 7], [36, 3, 6], [39, 4, 9], [43, 3, 11], [46, 4, 8], [50, 3, 10], [57, 4, 9], [61, 3, 7]]
        .forEach(([x, w, h]) => rect(x + O, w, top(h), 1));
      for (const [x, w, h, r] of cfg.extra) if (r === 1) rect(x, w, top(h), 1);
      for (const [x, w, h, r] of cfg.extra) if (r === 2) rect(x, w, top(h), 2);
      rect(1 + O, 1, top(9), 2); rect(2 + O, 4, top(15), 2); rect(6 + O, 2, top(13), 2); rect(8 + O, 2, top(9), 2);   // Willis, setbacks down to the right
      rect(11 + O, 4, top(17), 2);                                                                                     // Aon
      rect(15 + O, 5, top(21), 2);                                                                                     // St. Regis
      rect(23 + O, 5, top(10), 2); rect(24 + O, 4, top(13), 2); rect(24 + O, 3, top(16), 2);                           // Trump
      rect(29 + O, 7, top(15), 2); rect(30 + O, 5, top(17), 2);                                                        // Lake Point Tower, 2 rows above the rim
      { const t = top(17), steps = [4, 6, 8];                                                                           // Hancock: 4-6-8 steps around x 53
        for (let y = t; y <= SHORE; y++) { const w = steps[Math.min(2, Math.floor((y - t) * 3 / (SHORE - t + 1)))]; for (let i = 53 + O - w / 2; i < 53 + O + w / 2; i++) role[y * W + i] = 2; } }
      const isB = (x, y) => x >= 0 && x < W && y >= 0 && y <= SHORE && role[y * W + x] !== 0;
      // Antennas [x, top row, roof row, beacon]: Willis's two, Hancock's twin with beacons.
      const ants = [[2 + O, top(18), top(15), 0], [4 + O, top(17), top(15), 0], [51 + O, top(22), top(17), 1], [54 + O, top(22), top(17), 1],
        ...cfg.ants.map(([x, t, roof, bc]) => [x, top(t), top(roof), bc])];
      // Window slots: even columns, odd rows, under another building pixel,
      // clear of the pier (x 19-44, rows 19 and below) and the wheel.
      // [x, y, threshold 0-999, bright]
      const wins = [];
      for (let y = 1; y <= SHORE; y++) for (let x = 0; x < W; x++) {
        const r = role[y * W + x];
        if (!r || (r === 1 && x < 38 + O) || (x >= 19 + O && x <= 44 + O && y >= SHORE - 6)) continue;
        const dx = x + 0.5 - CX, dy = y + 0.5 - CY;
        if (dx * dx + dy * dy < 49 || x % 2 !== 0 || y % 2 !== 1 || !isB(x, y - 1)) continue;
        wins.push([x, y, ih(x, y, 5) % 1000, ih(x, y, 9) % 10 < 3]);
      }
      // Stars: the first 14 (wide: 28) hash positions in the top 14 rows that miss the
      // buildings, the moon's spot, the Hancock antennas and the wheel. [x, y, bright, twinkles, phase 0-999, period ms]
      const stars = [];
      for (let i = 0; stars.length < cfg.stars && i < cfg.stars * 1000 / 14; i++) {
        const x = ih(i, 1, 3) % W, y = ih(i, 2, 3) % 14;
        const dx = x + 0.5 - CX, dy = y + 0.5 - CY;
        if (isB(x, y) || (x > 35 + O && x < 49 + O && y < 11) || (x >= 50 + O && x <= 55 + O && y < 10) || dx * dx + dy * dy < 90.25 || stars.some((s) => s[0] === x && s[1] === y)) continue;
        stars.push([x, y, ih(i, 3, 3) % 10 < 3, ih(i, 4, 3) % 2 === 1, ih(i, 5, 3) % 1000, [4000, 6000, 12000][stars.length % 3]]);
      }
      // Wheel: hard-edged shapes, a pixel on when at least half covered (6x6
      // samples). Legs (A-frame from the hub to the pier), crossbar on row
      // 24, rim (rows 11-22) with each pixel's position around it (0-360,
      // a pseudo-angle: monotonic, no trig), 2x2 hub.
      const seg = (ax, ay, bx, by, px, py) => {
        const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
        const ex = px - (ax + t * vx), ey = py - (ay + t * vy);
        return ex * ex + ey * ey < 0.25;
      };
      const cover = (test) => {
        const out = [];
        for (let y = CY - R - 2; y <= SHORE; y++) for (let x = CX - R - 2; x <= CX + R + 1; x++) {
          let hit = 0;
          for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) if (test(x + (i + 0.5) / 6, y + (j + 0.5) / 6)) hit++;
          if (hit * 2 >= 36) out.push([x, y]);
        }
        return out;
      };
      const legs = cover((x, y) => { const dx = x - CX, dy = y - CY; return dx * dx + dy * dy > 0.36 && (seg(CX, CY, CX - SPREAD, SHORE + 1, x, y) || seg(CX, CY, CX + SPREAD, SHORE + 1, x, y)); });
      const kb = (SHORE - 1 + 0.5 - CY) / (SHORE + 1 - CY);
      const bar = [Math.round(CX - SPREAD * kb), SHORE - 1, Math.round(2 * SPREAD * kb)];
      const rim = cover((x, y) => { const dx = x - CX, dy = y - CY, d2 = dx * dx + dy * dy; return d2 >= (R - 1) * (R - 1) && d2 <= R * R; })
        .map(([x, y]) => {
          const dx = x + 0.5 - CX, dy = y + 0.5 - CY, ax = Math.abs(dx), ay = Math.abs(dy);
          const pa = dy >= 0 ? (dx >= 0 ? dy / (ax + ay) : 1 + ax / (ax + ay)) : (dx < 0 ? 2 + ay / (ax + ay) : 3 + ax / (ax + ay));
          return [x, y, pa * 90];
        });
      return { W, O, SHORE, CX, CY, role, isB, ants, wins, stars, legs, bar, rim };
    }
    const SKY = buildSky({ W: 64, O: 0, extra: [], ants: [], stars: 14 });
    // The wide board's panorama: the 64 scene on columns 32-95 and generic
    // towers both sides, no step down to the lake (decided Nov 5).
    const SKYW = buildSky({
      W: 128, O: 32, stars: 28,
      extra: [
        // Left: the South Loop.
        [0, 5, 6, 1], [5, 4, 8, 1], [10, 3, 5, 1], [13, 5, 7, 1], [18, 4, 9, 1], [22, 3, 6, 1], [25, 4, 8, 1], [29, 3, 6, 1],
        [2, 3, 11, 2], [7, 3, 16, 2], [14, 3, 13, 2], [20, 4, 10, 2], [26, 3, 12, 2],
        // Right: more towers to the edge.
        [96, 4, 8, 1], [100, 5, 10, 1], [105, 4, 7, 1], [109, 5, 9, 1], [114, 4, 8, 1], [118, 5, 10, 1], [123, 5, 8, 1],
        [97, 3, 13, 2], [102, 4, 15, 2], [107, 3, 11, 2], [111, 4, 16, 2], [116, 3, 12, 2], [120, 4, 14, 2], [125, 3, 12, 2],
      ],
      ants: [[8, 19, 16, 0], [112, 19, 16, 0]],  // [x, top rows, roof rows, beacon]
    });
    // Integer hash (32-bit, wraps the same in JS and C++).
    function ih(a, b, c) {
      let h = (Math.imul(a >>> 0, 0x9E3779B1) ^ Math.imul(b >>> 0, 0x85EBCA77) ^ Math.imul(c >>> 0, 0xC2B2AE3D)) >>> 0;
      h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D) >>> 0;
      h = Math.imul(h ^ (h >>> 12), 0x297A2D39) >>> 0;
      return (h ^ (h >>> 15)) >>> 0;
    }
    const mixHex = (a, b, k) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (B[i] - v) * k))).toString(16).padStart(2, '0')).join(''); };
    const mixRgb = (A, B, k) => A.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (B[i] - v) * k))));
    const sstep01 = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    // Smooth 0 -> 1 -> 0 over one period (a smoothstepped triangle wave):
    // the twinkles and beacon pulses, without trig.
    const wave = (ph) => { const u = ph - Math.floor(ph), tri = u < 0.5 ? u * 2 : 2 - u * 2; return tri * tri * (3 - 2 * tri); };
    const hsvHex = (h, s, v) => {
      const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
      return '#' + [f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    };
    const SK = {
      wheel: [{ leg: '#565c68', rim: '#dce0e6' }, { leg: '#4a505c', rim: '#eef0f4' }, { leg: '#262a32', rim: '#262a32' }],
      wheelNight: '#4a4a66', pier: { day: ['#6a6460', '#2e2a2c'], night: ['#2a2834', '#14121a'], bulb: '#c09050' },
      win: ['#8a5c20', '#ffb050'], beacon: ['#401010', '#ff2020'], moon: '#a89c70',
      rain: { day: ['#5a7aaa', '#3a5070'], night: ['#2c4468', '#1e3050'] }, snow: ['#8a909c', '#e8ecf2'],
      sail: '#e8ecf0', hull: ['#c02828', '#7a1818'],
      seadog: { Y: '#ffb020', p: '#3a5aa8', q: '#d8dce4', O: '#d86a10' }, spray: '#f4f8fc',
      glow: '#8a80b0', boltSoft: '#b8b0e8',
    };
    // Shown when there's no weather yet: a plain clear night.
    const SKY_NONE = { sky: [[0, '#000006'], [25, '#0c1430']], wat: ['#030816', '#02050f', '#0e1a36'], lit: 1, win: 100, stars: 14, sun: null, moon: null, gl: null, whl: 0, fog: null, roof: null, pcp: null, storm: 0, boats: 0, temp: null };
    const SEADOG = ['..pqpqpqpqpqp.', 'YYYYYYYYYYYYYY', '.OOOOOOOOOOOO.'];
    const SAIL = ['..#...', '..##..', '..###.', '..####'];
    const BOLT = [[21, 0], [21, 1], [20, 2], [21, 3], [22, 3], [23, 3], [23, 4], [24, 5], [23, 6], [24, 7], [25, 7], [25, 8], [25, 9]];
    const BOLT_BRANCH = [[20, 1], [19, 2], [18, 3], [18, 4], [17, 5]];
    const CLOUD_W = 128, CLOUD_STEP = 4000, RIPPLE_MS = 500, WHEEL_TURN_MS = 30000, RAIN_MS = 200;
    const SAIL_STEP = 800, SPEED_STEP = 150, SPEED_WAIT = 4000, QUARTER = 900000, STRIKE_EVERY = 30000;

    function skyAt(stops, y) {
      if (y <= stops[0][0]) return stops[0][1];
      for (let i = 1; i < stops.length; i++) if (y <= stops[i][0]) { const [y0, c0] = stops[i - 1], [y1, c1] = stops[i]; return mixHex(c0, c1, (y - y0) / (y1 - y0)); }
      return stops[stops.length - 1][1];
    }
    // 7 px soft-edged disc centered on (cx, cy), hidden by buildings;
    // `lit(dx, dy)` keeps part of it (the moon's phase).
    function skyDisc(f, cx, cy, color, lit, K = SKY) {
      const c = 3.5, rgb = hex(color);
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const X = cx - 3 + x, Y = cy - 3 + y;
        if (Y < 0 || Y > K.SHORE || X < 0 || X >= K.W || K.isB(X, Y)) continue;
        let hit = 0;
        for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
          const dx = x + (i + 0.5) / 8 - c, dy = y + (j + 0.5) / 8 - c;
          if (dx * dx + dy * dy <= c * c && (!lit || lit(dx, dy, c))) hit++;
        }
        const k = hit / 64;
        if (k > 0.08) f.set(X, Y, mixRgb(f.get(X, Y), rgb, k));
      }
    }
    // Lightning at ms, or null: a strike every 20-40 s (one per 30 s slot,
    // 0-10 s in), rising over 0.15 s and fading over 1.2 s.
    function strikeLevel(ms) {
      const slot = Math.floor(ms / STRIKE_EVERY), start = slot * STRIKE_EVERY + (ih(slot, 7, 7) % 10000);
      const t = (ms - start) / 1000;
      if (t < 0 || t >= 1.35) return 0;
      if (t < 0.15) return sstep01(0, 0.15, t);
      const u = 1 - (t - 0.15) / 1.2;
      return u * u;
    }
    // ---- clock screen: seventies face (design spec §16; contract "Seventies") ----
    // The time in the VCR digits, each lit pixel colored by its row (the
    // bands stay put while digits roll through them), and three stripes
    // along the bottom that turn up the right edge. Integer geometry only.
    const S70 = { colors: ['#ffc23a', '#ff7414', '#d2361a'], top: 5, base: 16, right: 52, cx: 54, cy: 21, radii: [3, 6, 9] };
    const s70Band = (y) => S70.colors[y < S70.top + 4 ? 0 : y < S70.top + 7 ? 1 : 2];
    // Wide board (wide-spec §6): the stripes run along the bottom, climb at
    // columns 62-69 (around a turn at cx1, cy1) and run along the top to the
    // right edge (around a second turn at cx2, cy2, on the same 2 px bands);
    // the time on the left, banded as at 64; under the top run the weekday
    // in full, the date and the temperature (cwx), one stripe color each.
    const S70W = { cx1: 60, cy1: 21, cx2: 72, cy2: 10, textX: 78 };
    const ring = (u, v, r) => { const d = u * u + v * v; return d > (2 * r - 2) * (2 * r - 2) && d <= (2 * r + 2) * (2 * r + 2); };
    function renderSeventiesWide(p, o, now) {
      const f = newFrame(WIDE);
      const { cx1, cy1, cx2, cy2, textX } = S70W;
      S70.radii.forEach((r, i) => {
        const c = S70.colors[i], r2 = 12 - r;
        f.fill(0, cy1 + r - 1, cx1, 2, c);
        f.fill(cx1 + r - 1, cy2, 2, cy1 - cy2 + 1, c);
        f.fill(cx2, cy2 - r2 - 1, WIDE - cx2, 2, c);
        for (let y = cy1 + 1; y < 32; y++) for (let x = cx1; x < WIDE; x++) if (ring(2 * (x - cx1) + 1, 2 * (y - cy1) + 1, r)) f.fill(x, y, 1, 1, c);
        for (let y = 0; y < cy2; y++) for (let x = 0; x < cx2; x++) if (ring(2 * (x - cx2) + 1, 2 * (y - cy2) + 1, r2)) f.fill(x, y, 1, 1, c);
      });
      rollText(f, 'vcr', 'svt.clock', clockText(now), (str) => Math.floor((cx1 - 2 - measure('vcr', str)) / 2), S70.base, '#ffffff');
      for (let y = S70.top; y < S70.base; y++) {
        const band = hex(s70Band(y));
        for (let x = 0; x < cx1 - 1; x++) { const c = f.get(x, y); if (c[0] || c[1] || c[2]) f.set(x, y, band); }
      }
      const t = localDate(now, p.tzo);
      const day = DAY_NAMES[t.wd];
      f.text('5x7', day, Math.min(textX, WIDE - measure('5x7', day)), 20, S70.colors[0]);
      f.text('5x7', `${MONTHS[t.m - 1]} ${t.d}`, textX, 29, S70.colors[1]);
      if (p.cwx && p.cwx.temp != null) rtext(f, '5x7', `${p.cwx.temp}°`, WIDE - 1, 29, S70.colors[2]);
      return f;
    }
    function renderSeventies(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      if (colsOf(p) === WIDE) return renderSeventiesWide(p, o, now);
      const f = newFrame();
      const { cx, cy } = S70;
      S70.radii.forEach((r, i) => {
        const c = S70.colors[i];
        f.fill(0, cy + r - 1, cx, 2, c);
        f.fill(cx + r - 1, 0, 2, cy, c);
        const lo = (2 * r - 2) * (2 * r - 2), hi = (2 * r + 2) * (2 * r + 2);
        for (let y = cy; y < 32; y++) for (let x = cx; x < 64; x++) {
          const u = 2 * (x - cx) + 1, v = 2 * (y - cy) + 1, d = u * u + v * v;
          if (d > lo && d <= hi) f.fill(x, y, 1, 1, c);
        }
      });
      // Centered in columns 0-52, drawn white, then banded by row.
      rollText(f, 'vcr', 'svt.clock', clockText(now), (str) => Math.floor((S70.right + 1 - measure('vcr', str)) / 2), S70.base, '#ffffff');
      for (let y = S70.top; y < S70.base; y++) {
        const band = hex(s70Band(y));
        for (let x = 0; x <= S70.right; x++) { const c = f.get(x, y); if (c[0] || c[1] || c[2]) f.set(x, y, band); }
      }
      return f;
    }

    // ---- clock screen: big digits and day/date faces (design spec §20) ----
    // The time in the d17 / d13 fonts (UW ttyp0 Bold digits, tabular, with
    // round colon dots). Their advance carries a 2 px gap, so a time's ink is
    // measure() - 1 wide.
    const BD = { top: 7, base: 24, color: '#e6e6e6' };
    const DD = { dayBase: 6, timeBase: 22, dateBase: 31, color: '#e6e6e6', label: '#8f8f8f', ampm: '#555555' };
    // Big digits: the time alone, its ink centered, rows 7-23. The colon
    // blinks (off for the second half of each second on the board's clock),
    // except while the time rolls, or always lit with p.steady.
    // Wide board (wide-spec §6): the 23-row digits (d23, ttyp0 Bold 40),
    // rows 4-26, centered on all 128 columns.
    const BDW = { top: 4, base: 27 };
    function renderDigits(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      const ms = Math.floor(o.ms != null ? o.ms : now * 1000);
      const wide = colsOf(p) === WIDE, font = wide ? 'd23' : 'd17', W = wide ? WIDE : 64, g = wide ? BDW : BD;
      const f = newFrame(W);
      const text = clockText(now), xOf = (str) => fdivI(W + 1 - measure(font, str), 2);
      const roll = takeRoll('dig.clock', text);
      rollTextWith(f, font, roll, text, xOf, g.base, BD.color);
      if (!p.steady && !roll && ((ms % 1000) + 1000) % 1000 >= 500) {
        const i = text.indexOf(':');
        f.fill(xOf(text) + measure(font, text.slice(0, i)) + 1, g.top, fonts[font][58][1], g.base - g.top, '#000000');
      }
      return f;
    }
    // Day/date: the weekday (Tom Thumb, rows 1-5), the time in d13 (rows
    // 9-21) with AM/PM in Tom Thumb two columns after it, bottom-aligned, the
    // pair centered; the date (5x7, rows 24-30). Each line centered.
    // Wide board (wide-spec §6): the weekday (5x7, #8f8f8f, baseline 14)
    // over the date (5x7, #e6e6e6, baseline 25), centered on column 22; a
    // #262626 divider on column 46, rows 4-27; the time in d23 (rows 4-26)
    // with AM/PM 3 px after it, the pair centered in columns 48-127.
    const DDW = { cx: 22, dayBase: 14, dateBase: 25, divX: 46, x0: 48, timeBase: 27, divider: '#262626' };
    function renderDayDateWide(p, now) {
      const f = newFrame(WIDE);
      const t = localDate(now, p.tzo);
      const day = DAY_NAMES[t.wd], date = `${MONTHS[t.m - 1]} ${t.d}`;
      f.text('5x7', day, DDW.cx - fdivI(measure('5x7', day), 2), DDW.dayBase, DD.label);
      f.text('5x7', date, DDW.cx - fdivI(measure('5x7', date), 2), DDW.dateBase, DD.color);
      f.fill(DDW.divX, 4, 1, 24, DDW.divider);
      const text = clockText(now), ampm = t.h < 12 ? 'AM' : 'PM', aw = measure('small', ampm);
      const xOf = (str) => DDW.x0 + fdivI(WIDE - DDW.x0 - (measure('d23', str) + 3 + aw), 2);
      rollText(f, 'd23', 'dd.clock', text, xOf, DDW.timeBase, DD.color);
      f.text('small', ampm, xOf(text) + measure('d23', text) + 3, DDW.timeBase, DD.ampm);
      return f;
    }
    function renderDayDate(p, opts) {
      const o = opts || {};
      const now = Math.floor(o.now != null ? o.now : p.now);
      if (colsOf(p) === WIDE) return renderDayDateWide(p, now);
      const f = newFrame();
      const t = localDate(now, p.tzo);
      const day = DAY_NAMES[t.wd];
      f.text('small', day, fdivI(64 - measure('small', day), 2), DD.dayBase, DD.label);
      const text = clockText(now), ampm = t.h < 12 ? 'AM' : 'PM', aw = measure('small', ampm);
      const xOf = (str) => fdivI(63 - aw - measure('d13', str), 2);
      rollText(f, 'd13', 'dd.clock', text, xOf, DD.timeBase, DD.color);
      f.text('small', ampm, xOf(text) + measure('d13', text) + 1, DD.timeBase, DD.ampm);
      const date = `${MONTHS[t.m - 1]} ${t.d}`;
      f.text('5x7', date, fdivI(64 - measure('5x7', date), 2), DD.dateBase, DD.label);
      return f;
    }

    // ---- clock faces: shared date and integer trig ----
    // Local date from epoch seconds and the payload's UTC offset (no Date:
    // the firmware ports this line for line). Weekday 0 = Sunday.
    const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const fdivI = (a, b) => Math.floor(a / b);
    function localDate(now, tzo) {
      const lt = Math.floor(now + (tzo || 0)), days = fdivI(lt, 86400);
      const wd = ((days + 4) % 7 + 7) % 7;
      const z = days + 719468, era = fdivI(z, 146097), doe = z - era * 146097;
      const yoe = fdivI(doe - fdivI(doe, 1460) + fdivI(doe, 36524) - fdivI(doe, 146096), 365);
      const doy = doe - (365 * yoe + fdivI(yoe, 4) - fdivI(yoe, 100)), mp = fdivI(5 * doy + 2, 153);
      const d = doy - fdivI(153 * mp + 2, 5) + 1, m = mp < 10 ? mp + 3 : mp - 9;
      const sec = lt - days * 86400;
      return { wd, m, d, h: fdivI(sec, 3600), min: fdivI(sec, 60) % 60, s: sec % 60 };
    }
    // sin(degrees) x 10000 for whole degrees 0-90; sinD/cosD for any degree.
    const SIN1E4 = [0, 175, 349, 523, 698, 872, 1045, 1219, 1392, 1564, 1736, 1908, 2079, 2250, 2419, 2588, 2756, 2924, 3090, 3256, 3420, 3584, 3746, 3907, 4067, 4226, 4384, 4540, 4695, 4848, 5000, 5150, 5299, 5446, 5592, 5736, 5878, 6018, 6157, 6293, 6428, 6561, 6691, 6820, 6947, 7071, 7193, 7314, 7431, 7547, 7660, 7771, 7880, 7986, 8090, 8192, 8290, 8387, 8480, 8572, 8660, 8746, 8829, 8910, 8988, 9063, 9135, 9205, 9272, 9336, 9397, 9455, 9511, 9563, 9613, 9659, 9703, 9744, 9781, 9816, 9848, 9877, 9903, 9925, 9945, 9962, 9976, 9986, 9994, 9998, 10000];
    function sinD(deg) {
      const d = ((deg % 360) + 360) % 360;
      return d <= 90 ? SIN1E4[d] : d <= 180 ? SIN1E4[180 - d] : d <= 270 ? -SIN1E4[d - 180] : -SIN1E4[360 - d];
    }
    const cosD = (deg) => sinD(deg + 90);

    // ---- clock screen: analog face (design spec §17; contract "Analog") ----
    // A 31 px dial on the left (the 60-entry endpoint tables below, lines
    // drawn Bresenham, so hands step in whole pixels and the seconds hand
    // ticks), the day, date and weather on the right.
    const AN = {
      cx: 15, cy: 15, rx: 48,
      // Hand endpoints at each of 60 positions, clockwise from 12: hour (7 px), minute (11), second (13).
      hour: '15,8,16,8,16,8,17,8,18,9,19,9,19,9,20,10,20,10,21,11,21,12,21,12,22,13,22,14,22,14,22,15,22,16,22,16,22,17,21,18,21,19,21,19,20,20,20,20,19,21,19,21,18,21,17,22,16,22,16,22,15,22,14,22,14,22,13,22,12,21,12,21,11,21,10,20,10,20,9,19,9,19,9,18,8,17,8,16,8,16,8,15,8,14,8,14,8,13,9,12,9,12,9,11,10,10,10,10,11,9,11,9,12,9,13,8,14,8,14,8',
      min: '15,4,16,4,17,4,18,5,19,5,21,5,21,6,22,7,23,8,24,9,25,10,25,11,25,12,26,13,26,14,26,15,26,16,26,17,25,18,25,19,25,20,24,21,23,22,22,23,21,24,21,25,19,25,18,25,17,26,16,26,15,26,14,26,13,26,12,25,11,25,10,25,9,24,8,23,7,22,6,21,5,21,5,19,5,18,4,17,4,16,4,15,4,14,4,13,5,12,5,11,5,10,6,9,7,8,8,7,9,6,9,5,11,5,12,5,13,4,14,4',
      sec: '15,2,16,2,18,2,19,3,20,3,22,4,23,4,24,5,25,6,26,7,26,8,27,10,27,11,28,12,28,14,28,15,28,16,28,18,27,19,27,20,26,21,26,23,25,24,24,25,23,26,22,26,20,27,19,27,18,28,16,28,15,28,14,28,12,28,11,27,10,27,8,26,7,26,6,25,5,24,4,23,4,22,3,20,3,19,2,18,2,16,2,15,2,14,2,12,3,11,3,10,4,8,4,7,5,6,6,5,7,4,8,4,10,3,11,3,12,2,14,2',
      // Hour ticks: x, y, major (12, 3, 6 and 9 are two pixels long).
      ticks: '15,2,1,15,3,1,22,4,0,26,8,0,28,15,1,27,15,1,26,21,0,22,26,0,15,28,1,15,27,1,8,26,0,4,22,0,2,15,1,3,15,1,4,8,0,8,4,0',
    };
    const nums = (str) => str.split(',').map(Number);
    const AN_T = { hour: nums(AN.hour), min: nums(AN.min), sec: nums(AN.sec), ticks: nums(AN.ticks) };
    function bresenham(f, x0, y0, x1, y1, color) {
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        f.fill(x0, y0, 1, 1, color);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    // Midpoint circle, radius r around (cx, cy).
    function circle(f, cx, cy, r, color) {
      let x = r, y = 0, err = 1 - r;
      while (x >= y) {
        for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) f.fill(cx + a, cy + b, 1, 1, color);
        y++;
        if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
      }
    }
    // Wide board (wide-spec §6): the dial as at 64 (columns 0-33) and this
    // month's calendar in seven 13 px columns from x37, Sunday first: five
    // week rows at a 6 px pitch (baselines 6-30), no weekday header; a sixth
    // week's days go in the first row's empty cells. Weekdays #b8b8b8,
    // weekends #6a6a6a, today white on an 11 x 7 block: the accent (p.cacc,
    // else amber) at 40% (amber's is #664600).
    const CAL = { x0: 37, colW: 13, day: '#b8b8b8', weekend: '#6a6a6a' };
    const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    function drawCalendar(f, now, tzo, accent) {
      const t = localDate(now, tzo);
      const first = now - (t.d - 1) * 86400;
      const n = t.m === 2 ? (localDate(first + 28 * 86400, tzo).m === 2 ? 29 : 28) : MONTH_DAYS[t.m - 1];
      const off = ((t.wd - (t.d - 1)) % 7 + 7) % 7;
      for (let d = 1; d <= n; d++) {
        const i = off + d - 1, col = i % 7, row = fdivI(i, 7) % 5;
        const cx = CAL.x0 + col * CAL.colW + 6, base = 6 + row * 6, str = String(d);
        if (d === t.d) f.fill(cx - 5, base - 6, 11, 7, scaleColor(accent, 0.4));
        f.text('small', str, cx - fdivI(measure('small', str) - 1, 2), base, d === t.d ? C.white : col === 0 || col === 6 ? CAL.weekend : CAL.day);
      }
    }
    function renderAnalog(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      const wide = colsOf(p) === WIDE;
      const f = newFrame(wide ? WIDE : 64);
      const t = localDate(now, p.tzo);
      circle(f, AN.cx, AN.cy, 15, '#333333');
      const tk = AN_T.ticks;
      for (let i = 0; i < tk.length; i += 3) f.fill(tk[i], tk[i + 1], 1, 1, tk[i + 2] ? C.wxText : C.dimHead);
      const hand = (tab, i, color) => bresenham(f, AN.cx, AN.cy, tab[i * 2], tab[i * 2 + 1], color);
      hand(AN_T.hour, (t.h % 12) * 5 + fdivI(t.min, 12), C.clock);
      hand(AN_T.min, t.min, C.clock);
      // The second hand in the accent (p.cacc: the board's analogAccent), else amber.
      const accent = p.cacc || C.amber;
      hand(AN_T.sec, t.s, accent);
      f.fill(AN.cx, AN.cy, 1, 1, C.clock);
      if (wide) { drawCalendar(f, now, p.tzo, accent); return f; }
      // Right: day (full name when it fits the 31 px column), date, weather.
      const full = DAY_NAMES[t.wd], day = measure('small', full) <= 31 ? full : full.slice(0, 3);
      f.text('small', day, AN.rx - fdivI(measure('small', day), 2), 7, C.wxText);
      const date = `${MONTHS[t.m - 1]} ${t.d}`;
      f.text('5x7', date, AN.rx - fdivI(measure('5x7', date), 2), 17, C.label);
      const w = p.cwx;
      if (w && w.temp != null) {
        const temp = String(w.temp), tw = measure('5x7', temp) + 3, x0 = AN.rx - fdivI(8 + 2 + tw, 2);
        if (w.icon && icons.ICONS[w.icon]) drawIcon(f, w.icon, x0, 22);
        const x = f.text('5x7', temp, x0 + 10, 30, C.label);
        f.text('small', '°', x, 28, C.label);
      }
      return f;
    }

    // ---- clock screen: word clock (wide boards only; wide-spec §6) ----
    // Five rows of words in Tom Thumb, centered, baselines 6-30; every word
    // faintly lit (#2a2a2a), the ones that tell the time amber, rounded to
    // five minutes: IT IS TWENTY MINUTES TO TEN IN THE EVENING. Morning
    // before noon, afternoon to 6 PM, evening after (by the hour shown).
    const WORDS = {
      rows: ['IT IS HALF TEN QUARTER TWENTY', 'FIVE MINUTES TO PAST ONE TWO', 'THREE FOUR FIVE SIX SEVEN EIGHT',
        "NINE TEN ELEVEN TWELVE O'CLOCK", 'IN THE MORNING AFTERNOON EVENING'],
      off: '#2a2a2a',
      // Word ids: row * 8 + the word's place in its row.
      hours: [27, 12, 13, 16, 17, 18, 19, 20, 21, 24, 25, 26],  // 12, 1, 2, ... 11
      // By five minutes: the minute words, then PAST (11) or TO (10).
      mins: [[28], [8, 9, 11], [3, 9, 11], [4, 11], [5, 9, 11], [5, 8, 9, 11], [2, 11], [5, 8, 9, 10], [5, 9, 10], [4, 10], [3, 9, 10], [8, 9, 10]],
    };
    function wordsLit(now, tzo) {
      const t = localDate(now, tzo);
      let q = fdivI(t.min + 2, 5), h = t.h;
      if (q === 12) { q = 0; h = (h + 1) % 24; }
      if (q >= 7) h = (h + 1) % 24;
      return [0, 1, ...WORDS.mins[q], WORDS.hours[h % 12], 32, 33, h < 12 ? 34 : h < 18 ? 35 : 36];
    }
    function renderWords(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      const f = newFrame(WIDE);
      const lit = wordsLit(now, p.tzo);
      WORDS.rows.forEach((row, j) => {
        const x0 = fdivI(WIDE - measure('small', row), 2), words = row.split(' ');
        let prefix = '';
        words.forEach((word, k) => {
          f.text('small', word, x0 + (prefix ? measure('small', prefix) + 1 : 0), 6 + j * 6, lit.includes(j * 8 + k) ? C.amber : WORDS.off);
          prefix += `${word} `;
        });
      });
      return f;
    }

    // ---- clock screen: day/night map face (design spec §18; contract "Day/night") ----
    // The world (world.js, 5.625° pixels, 84.4° N to 61.9° S, land in Blue
    // Marble colors) lit by the sun: day colors where the sun is up, fading
    // through twilight to the night side (each color dimmed toward blue) 12°
    // below the horizon. Integer math throughout (whole degrees,
    // SIN1E4), so the firmware matches pixel for pixel. The time and date on
    // the bottom rows.
    const DN = {
      rows: 26, deg: 5.625, top: 84.375,
      sea: '#2c70b0', nightSea: '#143a5c',
      // Night land: each channel x k / 256 (dimmer, a little bluer).
      nightK: [104, 116, 140],
      here: '#ffffff',
      // sin(-12°) x 1e8: full night at or below it.
      night12: -2079 * 10000,
    };
    const DN_LAT = Array.from({ length: DN.rows }, (_, r) => Math.round(DN.top - (r + 0.5) * DN.deg));
    const DN_LON = Array.from({ length: 64 }, (_, x) => Math.round(-180 + (x + 0.5) * DN.deg));
    const mixInt = (n, d, k) => n.map((v, i) => v + fdivI((d[i] - v) * k, 256));
    // Wide board (wide-spec §6): the map at true shape on all 32 rows
    // (WORLD_WIDE: 80 x 32 of 4.5°, 84° N to 60° S), lit the same way, the
    // board's spot dn.hw; the sun panel on columns 83-127: the time in 5x7
    // with AM/PM, a divider on row 11, then sunrise and sunset (dn.sr, dn.ss:
    // the sun icon on its horizon and the arrow in the row's color, the time
    // at the right edge) and the day length.
    const DNW = { w: 80, deg: 4.5, top: 84, x0: 83, rise: '#ffc23a', set: '#ff7414', divider: '#262626' };
    const DNW_LAT = Array.from({ length: 32 }, (_, r) => Math.round(DNW.top - (r + 0.5) * DNW.deg));
    const DNW_LON = Array.from({ length: DNW.w }, (_, x) => Math.round(-180 + (x + 0.5) * DNW.deg));
    // The sun on the horizon (7 x 5, the horizon on the text's bottom row):
    // '#' the row's color, '-' the horizon in #555555.
    const SUN_ICON = ['...#...', '.#...#.', '..###..', '#.###.#', '-------'];
    function drawWorld(f, dn, now, world, palette, lats, lons) {
      // The subsolar longitude moves 15° an hour: tenths of a degree back from dn.t.
      let lon10 = dn.lon - fdivI(now - dn.t, 24);
      lon10 = ((lon10 + 1800) % 3600 + 3600) % 3600 - 1800;
      const decD = fdivI(dn.dec + 5, 10), lonD = fdivI(lon10 + 5, 10);
      const sDec = sinD(decD), cDec = cosD(decD);
      const sea = [hex(DN.sea), hex(DN.nightSea)], land = {};
      for (const [c, v] of Object.entries(palette)) { const d = hex(v); land[c] = [d, d.map((ch, i) => fdivI(ch * DN.nightK[i], 256))]; }
      for (let y = 0; y < lats.length; y++) {
        const lat = lats[y], sl = sinD(lat) * sDec, cl = cosD(lat) * cDec;
        for (let x = 0; x < lons.length; x++) {
          // sin(sun's altitude) x 1e8.
          const s = sl + fdivI(cl * cosD(lons[x] - lonD), 10000);
          const k = s >= 0 ? 256 : s <= DN.night12 ? 0 : 256 - fdivI(s * 256, DN.night12);
          const [dc, nc] = world[y][x] === '.' ? sea : land[world[y][x]];
          f.set(x, y, mixInt(nc, dc, k));
        }
      }
    }
    function renderDayNightWide(p, now) {
      const f = newFrame(WIDE);
      const dn = p.dn, { x0 } = DNW;
      if (dn && icons.WORLD_WIDE) {
        drawWorld(f, dn, now, icons.WORLD_WIDE, icons.WORLD_WIDE_PALETTE, DNW_LAT, DNW_LON);
        if (dn.hw && dn.hw[1] < 32) f.fill(dn.hw[0], dn.hw[1], 1, 1, DN.here);
      }
      const t = localDate(now, p.tzo);
      const x = rollText(f, '5x7', 'dn.clock', clockText(now), () => x0, 8, '#ffffff');
      f.text('small', t.h < 12 ? 'AM' : 'PM', x + 1, 8, C.wxText);
      f.fill(x0, 11, WIDE - x0, 1, DNW.divider);
      // At the payload's offset (tzo), as on the board, even across a DST change.
      const at = (ts) => { const d = localDate(ts, p.tzo); return `${d.h % 12 || 12}:${String(d.min).padStart(2, '0')} ${d.h < 12 ? 'AM' : 'PM'}`; };
      if (dn && dn.sr != null && dn.ss != null) {
        [[dn.sr, G.UP, DNW.rise], [dn.ss, G.DOWN, DNW.set]].forEach(([ts, arrow, c], i) => {
          const base = 18 + i * 7;
          SUN_ICON.forEach((row, j) => [...row].forEach((ch, k) => { if (ch !== '.') f.fill(x0 + k, base - 5 + j, 1, 1, ch === '#' ? c : C.dimHead); }));
          f.text('small', s(arrow), x0 + 9, base, c);
          rtext(f, 'small', at(ts), WIDE - 1, 18 + i * 7, c);
        });
        const mins = Math.max(0, fdivI(dn.ss - dn.sr, 60));
        f.text('small', 'DAY', x0, 32, C.dimHead);
        rtext(f, 'small', `${fdivI(mins, 60)}h ${mins % 60}m`, WIDE - 1, 32, C.wxText);
      }
      return f;
    }
    function renderDayNight(p, opts) {
      const o = opts || {};
      const now = Math.floor(o.now != null ? o.now : p.now);
      if (colsOf(p) === WIDE) return renderDayNightWide(p, now);
      const f = newFrame();
      const dn = p.dn;
      if (dn && icons.WORLD) {
        drawWorld(f, dn, now, icons.WORLD, icons.WORLD_PALETTE, DN_LAT, DN_LON);
        // The board's own spot.
        if (dn.here && dn.here[1] < DN.rows) f.fill(dn.here[0], dn.here[1], 1, 1, DN.here);
      }
      // Bottom rows: the time (rolling) left, the date right.
      const t = localDate(now, p.tzo);
      const x = rollText(f, 'small', 'dn.clock', clockText(now), () => 0, 32, C.label);
      f.text('small', t.h < 12 ? 'AM' : 'PM', x + 2, 32, C.wxText);
      const date = `${DAY_NAMES[t.wd].slice(0, 3)} ${MONTHS[t.m - 1]} ${t.d}`;
      f.text('small', date, 64 - measure('small', date), 32, C.wxText);
      return f;
    }

    // ---- clock screen: gradient face (design spec §19; contract "Gradient") ----
    // A diagonal gradient across about three neighbors of a ten-color ring,
    // sliding along the ring with the animation clock (o.ms) so slowly that
    // the change is felt rather than seen (an hour around the ring; each pair
    // of neighbors close in hue, so no blend goes muddy). The time is knocked
    // out of it (unlit) in giant block digits. Integer math, ported line for
    // line.
    const GR = {
      ring: ['#ffc24a', '#ff8a52', '#ff5f7e', '#e94fb8', '#a55cff', '#5a5cf2', '#3e9cff', '#3fd6c6', '#9be65a', '#ffe14a'],
      span: 3,         // ring colors across the diagonal
      step: 360000,    // ms to move one color along (an hour around the ring)
      sx: 4, sy: 6,    // 3 x 5 block digits blown up to 12 x 30
      gap: 4,          // px between digits; 2 either side of the colon (12:59 fills the width exactly)
      dark: '#000000',
    };
    // Digit geometry by width: blocks sx x sy, the gap between characters,
    // and the colon's width, lead (it starts 2 px back at 64) and gap after.
    // Wide (wide-spec §6): 7 x 6 blocks (21 x 30 digits), 5 px gaps either
    // side of a 4 px colon: 12:58 is 108 px.
    const BIG = {
      64: { w: 64, sx: GR.sx, sy: GR.sy, gap: GR.gap, colonW: GR.sx, lead: -2, colonGap: GR.gap - 2 },
      128: { w: 128, sx: 7, sy: 6, gap: 5, colonW: 4, lead: 0, colonGap: 5 },
    };
    function gradientColor(x, y, ms, w = 64) {
      const n = GR.ring.length;
      // Position on the diagonal, 0-1023, top left to bottom right.
      const u = fdivI((x * 2 + y * 3) * 1024, (w - 1) * 2 + 31 * 3 + 1);
      const r = fdivI(ms * 256, GR.step) + fdivI(u * GR.span * 256, 1024);
      const i = fdivI(r, 256) % n, t = r % 256;
      return mixInt(hex(GR.ring[i]), hex(GR.ring[(i + 1) % n]), t);
    }
    // Giant block digits: each glyph pixel becomes an sx x sy block. Square
    // 3 x 5 digits (a blockier cut than Tom Thumb's) and a 1 x 5 colon.
    const GR_GLYPHS = {
      0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['##.', '.#.', '.#.', '.#.', '###'],
      2: ['###', '..#', '###', '#..', '###'], 3: ['###', '..#', '###', '..#', '###'],
      4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'],
      6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '..#', '..#', '..#'],
      8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '###'],
      ':': ['.', '#', '.', '#', '.'],
    };
    const bigLead = (g, ch) => (ch === ':' ? g.lead : 0), bigGap = (g, ch) => (ch === ':' ? g.colonGap : g.gap);
    const bigBlockW = (g, ch) => (ch === ':' ? g.colonW : g.sx);
    const bigW = (g, str) => [...str].reduce((w, ch) => w + bigLead(g, ch) + GR_GLYPHS[ch][0].length * bigBlockW(g, ch) + bigGap(g, ch), -g.gap);
    function bigChar(f, g, ch, x, top, color) {
      const gl = GR_GLYPHS[ch], bw = bigBlockW(g, ch);
      x += bigLead(g, ch);
      gl.forEach((row, r) => [...row].forEach((c, i) => { if (c === '#') f.fill(x + i * bw, top + r * g.sy, bw, g.sy, color); }));
      return x + gl[0].length * bw + bigGap(g, ch);
    }
    function bigText(f, g, str, x, top, color) { for (const ch of str) x = bigChar(f, g, ch, x, top, color); }
    function renderGradient(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      const ms = Math.floor(o.ms != null ? o.ms : now * 1000);
      const g = BIG[colsOf(p) === WIDE ? 128 : 64], W = g.w;
      const f = newFrame(W);
      // Inverted (p.ginv): the digits carry the gradient on black. They're
      // drawn as a mask, then every lit pixel takes its gradient color.
      if (p.ginv) {
        drawBigTime(f, g, p, now, '#ffffff');
        for (let y = 0; y < 32; y++) for (let x = 0; x < W; x++) if (f.get(x, y)[0]) f.set(x, y, gradientColor(x, y, ms, W));
        return f;
      }
      for (let y = 0; y < 32; y++) for (let x = 0; x < W; x++) f.set(x, y, gradientColor(x, y, ms, W));
      drawBigTime(f, g, p, now, GR.dark);
      return f;
    }
    function drawBigTime(f, g, p, now, color) {
      // The time, at the minute it rolls like the other clocks
      // (only changed characters when the shape holds, else the whole time).
      const text = clockText(now), H = 5 * g.sy, top = fdivI(32 - H, 2);
      const xOf = (str) => fdivI(g.w - bigW(g, str), 2);
      const roll = takeRoll('grad.clock', text);
      if (!roll) bigText(f, g, text, xOf(text), top, color);
      else bigRoll(f, g, text, roll, xOf, top, H, color);
    }
    // The time mid-roll (rollTextWith's rules, on the giant digits).
    function bigRoll(f, g, text, roll, xOf, top, H, color) {
      const dist = H + g.sy, up = Math.round(easeInOut(roll.p) * dist), from = roll.from;
      f.withClip(0, top, g.w - 1, top + H - 1, () => {
        const a = [...text], b = [...from];
        if (xOf(from) === xOf(text) && a.length === b.length && a.every((ch, i) => bigW(g, ch) === bigW(g, b[i]))) {
          let x = xOf(text);
          a.forEach((ch, i) => {
            if (ch === b[i]) bigChar(f, g, ch, x, top, color);
            else { bigChar(f, g, b[i], x, top - up, color); bigChar(f, g, ch, x, top - up + dist, color); }
            x += bigW(g, ch) + g.gap;  // one character's advance (bigW drops a trailing gap)
          });
        } else {
          bigText(f, g, from, xOf(from), top - up, color);
          bigText(f, g, text, xOf(text), top - up + dist, color);
        }
      });
    }

    // ---- announce screen (design spec §15; contract "Announce") ----
    // A short note from the phone in one of four styles: note, typewriter,
    // big word, credits roll. The server lays the text out (messageLayout)
    // and sends the lines; the board only draws them. opts.t: ms since the
    // message appeared, for its motion (the typewriter types, the credits
    // roll); absent: the settled frame. Integer geometry only.
    const MSG_STYLES = ['note', 'type', 'big', 'roll'];
    const MSG_MAX = 160;  // characters, after cleaning
    const MSG = {
      bases: { 1: [19], 2: [14, 24], 3: [9, 19, 29] },  // 5x7 lines (note, typewriter)
      smallLines: 5,
      typeWrap: 59, typeWait: 400, typeChar: 90, typeBlink: 530,
      bigTop: 7, bigGrad: 14,
      // Credits roll: 1 px up every rollStep ms from below the panel (first
      // baseline rollStart) until the last line has left the top, then
      // rollPause ms blank, looping; lines rollPitch apart; the top and
      // bottom rollFade rows fade the text in and out. Up to rollLines lines.
      rollStep: 150, rollPause: 1500, rollStart: 40, rollPitch: 10, rollFade: 3, rollLines: 16,
    };
    const MSG_C = {
      text: C.label,
      type: C.amber, cursor: '#cc8d00', bigFrom: '#ff3060', bigTo: '#ffb000', cta: C.head,
    };
    // Punctuation phones substitute (curly quotes, dashes, ellipsis, ...):
    // in both fonts, unlike the rest of their private-use and symbol glyphs.
    const MSG_PUNCT = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2022, 0x2026, 0x20ac]);
    const msgChar = (cp) => (cp >= 0x20 && cp < 0x7f) || (cp >= 0xa0 && cp <= 0xff) || MSG_PUNCT.has(cp);
    // The text as the board can draw it: characters outside the fonts (emoji)
    // dropped, tabs as spaces, runs of spaces collapsed, lines trimmed, line
    // breaks kept (they force a new line).
    function cleanMessage(text) {
      let out = '';
      for (const ch of String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\t/g, ' ')) {
        const cp = ch.codePointAt(0);
        if (ch === '\n' || (msgChar(cp) && fonts['5x7'][cp] && fonts.small[cp])) out += ch;
      }
      return out.split('\n').map((l) => l.replace(/ +/g, ' ').trim()).join('\n').replace(/^\n+|\n+$/g, '');
    }
    // Uppercase for Tom Thumb; letters whose capital the font
    // lacks are dropped.
    const msgUpper = (s) => [...s.toUpperCase()].filter((ch) => ch === '\n' || fonts.small[ch.codePointAt(0)]).join('');
    // Word-wrap to lines at most maxW px wide in `font`; \n forces a break.
    // Null when one word is too wide.
    function wrapMessage(text, font, maxW) {
      const width = (str) => measure(font, str);
      const lines = [];
      for (const para of text.split('\n')) {
        let cur = '';
        for (const word of para.split(' ')) {
          if (!word) continue;
          if (width(word) > maxW) return null;
          const t = cur ? `${cur} ${word}` : word;
          if (width(t) <= maxW) cur = t;
          else { lines.push(cur); cur = word; }
        }
        lines.push(cur);
      }
      return lines;
    }
    // The lines a style draws for `text` (payload `msg`), or null when it
    // doesn't fit on one screen. Note: 5x7, up to 3 lines, else Tom Thumb
    // (uppercase) up to 5 (`sm`). Typewriter: 5x7, 3 lines, room for the cursor. Big word:
    // one line of 5x7 at 2x.
    function messageLayout(text, style) {
      const t = cleanMessage(text);
      if (!t || [...t].length > MSG_MAX) return null;
      const upto = (lines, n) => (lines && lines.length <= n ? lines : null);
      if (style === 'note') {
        const big = upto(wrapMessage(t, '5x7', 64), 3);
        if (big) return { lines: big };
        const sm = upto(wrapMessage(msgUpper(t), 'small', 64), MSG.smallLines);
        return sm ? { lines: sm, sm: 1 } : null;
      }
      if (style === 'type') {
        const lines = upto(wrapMessage(t, '5x7', MSG.typeWrap), 3);
        return lines ? { lines } : null;
      }
      if (style === 'big') return !t.includes('\n') && measure('5x7', t) * 2 <= 64 ? { lines: [t] } : null;
      if (style === 'roll') {
        // It scrolls, so it isn't held to one screen: any number of lines up to rollLines.
        const lines = upto(wrapMessage(t, '5x7', 64), MSG.rollLines);
        return lines ? { lines } : null;
      }
      return null;
    }

    const msgX = (font, str) => Math.floor((64 - measure(font, str)) / 2);
    const msgLen = (str) => [...str].length;
    function drawNote(f, lines, sm) {
      if (sm) {
        const n = Math.min(lines.length, MSG.smallLines);
        const top = Math.floor((32 - (n * 6 - 1)) / 2);
        for (let i = 0; i < n; i++) f.text('small', lines[i], msgX('small', lines[i]), top + 5 + i * 6, MSG_C.text);
        return;
      }
      const n = Math.min(lines.length, 3);
      for (let i = 0; i < n; i++) f.text('5x7', lines[i], msgX('5x7', lines[i]), MSG.bases[n][i], MSG_C.text);
    }
    // Typewriter: amber 5x7 from the left edge, typed one character every
    // typeChar ms (a line break counts as one), a block cursor after the last
    // one: steady while typing, then blinking.
    function typedTotal(lines) {
      const n = Math.min(lines.length, 3);
      let total = n - 1;
      for (let i = 0; i < n; i++) total += msgLen(lines[i]);
      return total;
    }
    function drawTyped(f, lines, t) {
      const n = Math.min(lines.length, 3);
      const total = typedTotal(lines);
      const typed = t < MSG.typeWait ? 0 : Math.min(total, Math.floor((t - MSG.typeWait) / MSG.typeChar));
      let left = typed, lastX = 0, lastB = MSG.bases[n][0];
      for (let i = 0; i < n && left >= 0; i++) {
        const chars = [...lines[i]];
        lastX = f.text('5x7', chars.slice(0, left).join(''), 0, MSG.bases[n][i], MSG_C.type);
        lastB = MSG.bases[n][i];
        left -= chars.length + 1;
      }
      const doneAt = MSG.typeWait + total * MSG.typeChar;
      const on = typed < total || !Number.isFinite(t) || Math.floor((t - doneAt) / MSG.typeBlink) % 2 === 0;
      if (on) f.fill(lastX, lastB - 7, 4, 7, MSG_C.cursor);
    }
    // Big word: 5x7 at 2x, centered, rows shaded from pink to amber.
    function drawBig(f, str) {
      const A = hex(MSG_C.bigFrom), B = hex(MSG_C.bigTo);
      const grad = (y) => { const k = Math.max(0, Math.min(MSG.bigGrad, y)); return [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * k / MSG.bigGrad)); };
      const x0 = 32 - measure('5x7', str);
      let x = 0;
      for (const ch of str) {
        const g = fonts['5x7'][ch.codePointAt(0)];
        if (!g) continue;
        const [dw, w, h, xo, yo] = g;
        const top = 8 - (yo + h);
        for (let r = 0; r < h; r++) {
          const bits = g[5 + r];
          for (let c = 0; c < w; c++) {
            if (!((bits >> (w - 1 - c)) & 1)) continue;
            const px = x + xo + c, py = top + r;
            for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) f.set(x0 + px * 2 + dx, MSG.bigTop + py * 2 + dy, grad(py * 2 + dy));
          }
        }
        x += dw;
      }
    }
    // Credits roll. Settled (no t): the block centered, as a still. Moving:
    // the first baseline at rollStart minus the steps taken this pass.
    function rollBase(n, t) {
      if (!Number.isFinite(t)) return Math.floor((32 - (MSG.rollPitch * (n - 1) + 9)) / 2) + 7;
      const travel = MSG.rollStart + 2 + MSG.rollPitch * (n - 1);  // steps until the last line's descender is off the top
      const cycle = travel * MSG.rollStep + MSG.rollPause;
      const u = t - Math.floor(t / cycle) * cycle;
      return MSG.rollStart - Math.min(travel, Math.floor(u / MSG.rollStep));
    }
    function drawRoll(f, lines, t) {
      const base = rollBase(lines.length, t);
      lines.forEach((l, i) => f.text('5x7', l, msgX('5x7', l), base + i * MSG.rollPitch, MSG_C.text));
      for (let i = 0; i < MSG.rollFade; i++) {
        const k = (i + 1) / (MSG.rollFade + 1);
        for (const y of [i, 31 - i]) for (let x = 0; x < 64; x++) f.set(x, y, f.get(x, y).map((v) => Math.round(v * k)));
      }
    }
    function renderAnnounce(p, opts) {
      const o = opts || {};
      const f = newFrame();
      const m = p.msg;
      if (!m || !m.lines || !m.lines.length) {
        // No message yet: a call to action.
        for (const [str, base] of [['SET A MESSAGE', 15], ['ON YOUR PHONE', 22]]) f.text('small', str, msgX('small', str), base, MSG_C.cta);
        return f;
      }
      const t = o.t != null ? o.t : Infinity;
      if (m.style === 'type') drawTyped(f, m.lines, t);
      else if (m.style === 'big') drawBig(f, m.lines[0]);
      else if (m.style === 'roll') drawRoll(f, m.lines, t);
      else drawNote(f, m.lines, !!m.sm);
      return f;
    }
    // How long a message's intro runs (ms; 0 for the still styles): the
    // board redraws every frame until then.
    function messageIntroMs(m) {
      if (!m || !m.lines || !m.lines.length) return 0;
      if (m.style === 'type') return MSG.typeWait + typedTotal(m.lines) * MSG.typeChar;
      return 0;
    }
    // After the intro, a number that changes whenever the frame does (the
    // typewriter cursor's blink, each step of the credits roll), for the
    // board's redraw key.
    function messageTick(m, t) {
      if (m && m.style === 'roll' && m.lines && m.lines.length) return Math.floor(t / MSG.rollStep);
      if (!m || m.style !== 'type' || !m.lines || !m.lines.length) return 0;
      const intro = messageIntroMs(m);
      return t < intro ? -1 : Math.floor((t - intro) / MSG.typeBlink) % 2;
    }

    // Which skyline is on screen, and the crossfade from the last one. The
    // board and the simulator keep one: set() with each payload's skyline
    // (live: the clock screen is showing; off it, a new skyline is taken at
    // once), tick() every frame, view() for the render options. On screen, a
    // new skyline waits until its cloud strip is on hand (no bare-sky gap),
    // and until a running fade ends (no jump), then fades in over 4 s. A
    // strip that arrives for the skyline on screen fades its clouds in.
    // has(id): whether that cloud strip is on hand. Mirrored by
    // draw::SkylineFader in draw.cpp.
    const SKY_FADE_MS = 4000;
    function createSkylineFader() {
      let started = false, cur = null, curBare = false, from = null, fromBare = false, start = 0, pending = null, fading = false;
      const ready = (sk, has) => !sk || !sk.cl || has(sk.cl.id);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      return {
        set(sk, ms, has, live) {
          const v = sk || null;
          if (!started || !live) { started = true; cur = v; curBare = !ready(v, has); fading = false; from = null; pending = null; return; }
          if (same(v, cur)) pending = null; else pending = v;
        },
        tick(ms, has) {
          if (fading && ms - start >= SKY_FADE_MS) { fading = false; from = null; }
          if (fading) return;
          if (pending !== null && ready(pending, has)) { from = cur; fromBare = curBare; cur = pending; curBare = false; pending = null; start = ms; fading = true; }
          else if (started && curBare && ready(cur, has)) { from = cur; fromBare = true; curBare = false; start = ms; fading = true; }
        },
        view(ms) {
          const k = fading ? sstep01(0, 1, (ms - start) / SKY_FADE_MS) : 1;
          return { sky: cur, skyFrom: fading ? from : null, skyBare: fading && fromBare, skyK: k };
        },
        // Strip ids still needed (on screen, fading from, waiting).
        wanted() { return [cur, fading ? from : null, pending].filter((x) => x && x.cl && x.cl.id).map((x) => x.cl.id); },
        started() { return started; },
      };
    }
    // Where the quarter-hour boat is at ms: {kind, x0, dir} or null.
    // Sailboat on :00 (heading left) and :30 (right), 1 px per 800 ms;
    // speedboat on :15 and :45, out to the left at 1 px per 150 ms, turning
    // around off the panel for 4 s and coming back to the right.
    // W: the scene's width (the wide panorama's boats cross all 128 columns).
    function boatAt(ms, W = 64) {
      const q = Math.floor(ms / QUARTER), qi = q % 4, e = ms - q * QUARTER;
      if (qi === 0 || qi === 2) {
        const step = Math.floor(e / SAIL_STEP);
        if (step > W + 6) return null;
        return qi === 0 ? { kind: 'sail', x0: W - step, dir: -1 } : { kind: 'sail', x0: -6 + step, dir: 1 };
      }
      const span = W + 23, leg = span * SPEED_STEP;
      if (e < leg) return { kind: 'speed', x0: W - Math.floor(e / SPEED_STEP), dir: -1 };
      const e2 = e - leg - SPEED_WAIT;
      if (e2 >= 0 && e2 < leg) return { kind: 'speed', x0: -14 + Math.floor(e2 / SPEED_STEP), dir: 1 };
      return null;
    }
    function drawBoat(f, b, wat, W = 64) {
      const S = SKY.SHORE;
      if (b.kind === 'sail') {
        const put = (dx, y, c) => { const x = b.dir < 0 ? b.x0 + dx : b.x0 + 5 - dx; if (x >= 0 && x < W) f.fill(x, y, 1, 1, c); };
        SAIL.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch === '#') put(dx, S - 4 + dy, SK.sail); }));
        for (let dx = 0; dx < 6; dx++) put(dx, S, SK.hull[0]);
        for (let dx = 1; dx < 5; dx++) put(dx, S + 1, SK.hull[1]);
        return;
      }
      const n = SEADOG[0].length;
      const put = (dx, y, c) => { const x = b.dir < 0 ? b.x0 + dx : b.x0 + n - 1 - dx; if (x >= 0 && x < W) f.fill(x, y, 1, 1, c); };
      SEADOG.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch !== '.') put(dx, S - 1 + dy, SK.seadog[ch]); }));
      // Spray plume behind the stern, fading out: 9 / 6 / 3 px on rows 26 / 25 / 24.
      for (const [y, len] of [[S + 1, 9], [S, 6], [S - 1, 3]]) {
        for (let i = 0; i < len; i++) {
          const x = b.dir < 0 ? b.x0 + n + i : b.x0 - 1 - i;
          if (x >= 0 && x < W) f.set(x, y, mixRgb(f.get(x, y), hex(SK.spray), 0.95 * (1 - i / len)));
        }
      }
    }

    // A change of skyline crossfades over SKY_FADE_MS (eased) rather than
    // switching in one frame: opts.skyFrom (the skyline faded from), skyK
    // (0..1, how far) and skyBare (draw skyFrom without clouds: the strip
    // just arrived). opts.sky draws that skyline in place of the payload's
    // (the one createSkylineFader has on screen). Both scenes are drawn whole
    // and mixed pixel by pixel.
    function renderSkyline(p, opts) {
      const o = opts || {};
      if (o.skyFrom !== undefined && o.skyFrom !== null && o.skyK != null && o.skyK < 1) {
        const a = renderSkyline(p, { ...o, skyFrom: null, sky: o.skyFrom, clouds: o.skyBare ? null : o.clouds });
        const b = renderSkyline(p, { ...o, skyFrom: null });
        for (let y = 0; y < 32; y++) for (let x = 0; x < b.w; x++) b.set(x, y, mixRgb(a.get(x, y), b.get(x, y), o.skyK));
        return b;
      }
      const s = (o.sky !== undefined ? o.sky : p.skyline) || SKY_NONE;
      const now = o.now != null ? o.now : p.now;
      const ms = o.ms != null ? o.ms : Math.floor(now * 1000);
      // The wide board's panorama (SKYW): the 64 scene O px in, so every
      // position the payload gives (sun, glint) and the fixed ones (moon,
      // pier, lightning) move by O; twice the stars, rain and snow.
      const K = colsOf(p) === WIDE ? SKYW : SKY, W = K.W, O = K.O, more = W / 64;
      const f = newFrame(W);
      const S = K.SHORE, night = (s.win || 0) / 100;

      // Sky; buildings stay black (LEDs off).
      for (let y = 0; y <= S; y++) {
        const c = hex(skyAt(s.sky, y));
        for (let x = 0; x < W; x++) if (!K.role[y * W + x]) f.set(x, y, c);
      }
      if (s.sun) skyDisc(f, s.sun.x + O, s.sun.y, s.sun.c, null, K);
      // Stars twinkle (some), then the moon at its phase: the lit part is
      // past the terminator, an ellipse whose half-width follows the lit
      // fraction (cos of the phase angle = 1 - 2 * lit).
      for (let i = 0; i < Math.min((s.stars || 0) * more, K.stars.length); i++) {
        const [x, y, bright, tw, ph, per] = K.stars[i];
        const k = tw && s.twk !== 0 ? 0.25 + 0.75 * wave(ms / per + ph / 1000) : 1;
        f.set(x, y, mixRgb(f.get(x, y), hex(bright ? '#a8aebc' : '#5a6070'), k));
      }
      if (s.moon) {
        const cosv = 1 - 2 * s.moon.fr / 100, waxing = s.moon.ph < 50;
        skyDisc(f, 41 + O, 5, SK.moon, (dx, dy, c) => { const w = Math.sqrt(Math.max(0, c * c - dy * dy)); return waxing ? dx > w * cosv : dx < -w * cosv; }, K);
      }
      // Clouds: the server's strip (128 x 26, 4-bit indexes, packed high
      // nibble first), scrolled 1 px every 4 s and wrapping, behind the city;
      // each index has its color and opacity in the payload. None until the
      // strip has been fetched (o.clouds: {id: bytes}).
      const cb = s.cl && o.clouds && o.clouds[s.cl.id];
      if (cb) {
        // cl.step: ms per pixel of drift (0: still; absent: the original 4 s).
        // Sub-pixel, like the ripples: each pixel mixes its two strip columns
        // (each laid over the sky) by the fraction of the step gone, so the
        // clouds glide instead of jumping a pixel at a time.
        const step = s.cl.step != null ? s.cl.step : CLOUD_STEP;
        const rem = step > 0 ? ms % step : 0, fr = step > 0 ? rem / step : 0;
        const off = step > 0 ? ((ms - rem) / step) % CLOUD_W : 0;
        const pal = s.cl.pal.map((c) => (c ? hex(c) : null));
        const at = (y, col) => { const i = y * CLOUD_W + (col % CLOUD_W); const n = (cb[i >> 1] >> ((i & 1) ? 0 : 4)) & 15; return n && pal[n] ? n : 0; };
        for (let y = 0; y <= S; y++) for (let x = 0; x < W; x++) {
          if (K.role[y * W + x]) continue;
          const n0 = at(y, x + off), n1 = fr > 0 ? at(y, x + off + 1) : 0;
          if (!n0 && !n1) continue;
          const bg = f.get(x, y);
          const c0 = n0 ? mixRgb(bg, pal[n0], s.cl.a[n0] / 100) : bg;
          if (fr === 0) { f.set(x, y, c0); continue; }
          const c1 = n1 ? mixRgb(bg, pal[n1], s.cl.a[n1] / 100) : bg;
          f.set(x, y, mixRgb(c0, c1, fr));
        }
      }
      // Windows come on one at a time as `win` rises.
      const lim = Math.round(450 * night);
      for (const [x, y, th, bright] of K.wins) if (th < lim) f.fill(x, y, 1, 1, SK.win[bright ? 1 : 0]);
      // Snow on the roofs: the top pixel of every building column.
      if (s.roof) for (let x = 0; x < W; x++) for (let y = 0; y <= S; y++) if (K.role[y * W + x]) { f.fill(x, y, 1, 1, s.roof); break; }
      // Fog: everything fades toward it with height (strongest at the top).
      if (s.fog) {
        const fc = hex(s.fog);
        for (let y = 0; y <= S; y++) { const k = Math.max(0, Math.min(1, (21 - y) / 18)) * 0.85; if (k) for (let x = 0; x < W; x++) f.set(x, y, mixRgb(f.get(x, y), fc, k)); }
      }
      // Lightning: the whole sky flashes (35% toward the glow), brightest in
      // a patch of the cloud deck around the bolt (80%).
      const lv = s.storm ? strikeLevel(ms) : 0;
      if (lv > 0) {
        const gc = hex(SK.glow);
        for (let y = 0; y <= S; y++) for (let x = 0; x < W; x++) {
          if (K.role[y * W + x]) continue;
          const ex = (x + 0.5 - 22 - O) / 11, ey = (y + 0.5 - 4) / 4, d = Math.sqrt(ex * ex + ey * ey);
          const a = lv * (0.35 + 0.45 * (1 - sstep01(0.3, 1, d)));
          if (a > 0.01) f.set(x, y, mixRgb(f.get(x, y), gc, a));
        }
        const put = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && !K.role[y * W + x]) f.set(x, y, mixRgb(f.get(x, y), hex(mixHex(c, SK.boltSoft, 0.15)), 0.8 * lv)); };
        const core = new Set(BOLT.map(([x, y]) => y * 64 + x));
        for (const [x, y] of BOLT) for (const X of [x - 1, x + 1]) if (!core.has(y * 64 + X)) put(X + O, y, '#7060c0');
        for (const [x, y] of BOLT_BRANCH) put(x + O, y, '#9a8ae0');
        for (const [x, y] of BOLT) put(x + O, y, '#ffffff');
      }
      // Antennas (unlit) and the Hancock beacons: dark red to bright red over 4 s.
      const beacon = mixHex(SK.beacon[0], SK.beacon[1], wave(ms / 4000));
      for (const [x, t, roof, b] of K.ants) { f.fill(x, t, 1, roof - t, '#000000'); if (b && s.lit) f.fill(x, t, 1, 1, beacon); }
      // The wheel: white rim and darker frame by day, a slow pastel rainbow
      // (one turn a minute) at night.
      const wp = s.lit ? { leg: SK.wheelNight } : SK.wheel[s.whl || 0];
      for (const [x, y] of K.legs) f.fill(x, y, 1, 1, wp.leg);
      f.fill(K.bar[0], K.bar[1], K.bar[2], 1, wp.leg);
      // Wheel speed: s.wheel ms a turn (0: still).
      const turnMs = s.wheel != null ? s.wheel : WHEEL_TURN_MS;
      const turn = turnMs > 0 ? (ms % turnMs) * (360 / turnMs) : 0;
      for (const [x, y, deg] of K.rim) f.fill(x, y, 1, 1, s.lit ? hsvHex((deg + turn) % 360, 0.7, 0.9) : wp.rim);
      f.fill(K.CX - 1, K.CY - 1, 2, 2, wp.leg);

      // Text: the temperature (or a watch or warning in its place) bottom
      // left, the clock bottom right, over the water.
      const clock = clockText(now);
      const cw = measure('small', clock);
      const warn = p.warn;
      const ws = warn ? warnStyle(warn) : null;
      const wword = warn ? (warn.lvl === 'warning' ? 'WARNING' : 'WATCH') : '';
      const tempStr = s.temp != null ? `${s.temp}°` : '';
      const lw = ws ? measure('small', ws.glyph) + TAG_GAP - 1 + measure('small', wword) : tempStr ? measure('small', tempStr) : 0;
      const quiet = (x, y) => y >= S + 2 && ((lw && x <= lw) || x >= W - 1 - cw);   // text rows plus a 1 px margin

      // Water: a two-color gradient, ripples gliding sideways (alternate rows
      // opposite ways, 1 px every 500 ms, drawn with sub-pixel coverage so the
      // ends fade in and out rather than step), the glitter path at sunset and
      // glints under the sun or moon; all kept off the text. The pattern
      // repeats every 990 px (9, 10 and 11 px gaps), so the clock is taken
      // modulo that to keep the numbers small.
      // Ripple speed: s.rip ms a pixel (0: still).
      const ripMs = s.rip != null ? s.rip : RIPPLE_MS;
      const glide = ripMs > 0 ? (ms % (ripMs * 990)) / ripMs : 0;
      const ripple = hex(s.wat[2]);
      const pathRgb = s.gl && s.gl.p > 0 ? mixRgb(ripple, hex(s.gl.c), s.gl.p / 100) : null;
      for (let y = S + 1; y < 32; y++) {
        f.fill(0, y, W, 1, mixHex(s.wat[0], s.wat[1], (y - S - 1) / (32 - S - 2)));
        const dir = y % 2 ? 1 : -1, len = y - S <= 2 ? 2 : 3, gap = 9 + (y % 3);
        for (let x = 0; x < W; x++) {
          if (quiet(x, y)) continue;
          const u = x - dir * glide + y * 5, a = u - gap * Math.floor(u / gap);
          const cov = Math.max(0, Math.min(a + 1, len) - a) + Math.max(0, a + 1 - gap);   // this pixel's share of a dash
          if (cov <= 0) continue;
          const onPath = pathRgb && Math.abs(x + 0.5 - O - s.gl.x) < 1.5 + (y - S) * 0.8;
          f.set(x, y, mixRgb(f.get(x, y), onPath ? pathRgb : ripple, Math.min(1, cov)));
        }
      }
      // Navy Pier: deck on row 25 (snow-covered when the roofs are), darker
      // face on 26, string lights at night.
      f.fill(24 + O, S, 16, 1, s.roof || mixHex(SK.pier.day[0], SK.pier.night[0], night));
      f.fill(24 + O, S + 1, 16, 1, mixHex(SK.pier.day[1], SK.pier.night[1], night));
      if (s.lit) for (let x = 24 + O; x <= 39 + O; x += 3) f.fill(x, S, 1, 1, SK.pier.bulb);
      // The quarter-hour boat.
      const b = s.boats ? boatAt(ms, W) : null;
      if (b) drawBoat(f, b, s.wat, W);
      // Rain: 2 px streaks moving 1 px every s.fall ms (200 by default)
      // along their own line, straight down (pcp.sl 0) or 45° left or right
      // (-1, 1), with sub-pixel coverage so they glide rather than step: a
      // pixel d px behind a streak's head position fades in ahead (d -1..0),
      // goes from the head color to the tail's (0..1), then fades out
      // (1..2). Snow falls 3.5x slower, wobbling a pixel. Each drop or flake
      // falls past the shore to its own row of water (26-31, the nearer ones
      // lower), so nothing ends along the waterline; kept off the text.
      if (s.pcp && s.pcp.n > 0) {
        const fall = s.fall > 0 ? s.fall : RAIN_MS;
        if (s.pcp.k === 'r') {
          const c1 = hex(mixHex(SK.rain.day[0], SK.rain.night[0], night)), c2 = hex(mixHex(SK.rain.day[1], SK.rain.night[1], night));
          const sl = s.pcp.sl || 0, rem = ms % fall, step = (ms - rem) / fall, fr = rem / fall;
          for (let i = 0; i < s.pcp.n * more; i++) {
            const land = S + 1 + ih(i, 33, 4) % (31 - S), cyc = land + 1;
            const hy = (ih(i, 32, 4) % cyc + step) % cyc;
            const hx = (((ih(i, 31, 4) % W + sl * (step % W)) % W) + W) % W;
            for (let j = -1; j <= 1; j++) {             // j px ahead of the head pixel
              const y = hy + j, d = fr - j;
              if (y < 0 || y > land) continue;
              const x = (((hx + sl * j) % W) + W) % W;
              if (quiet(x, y)) continue;
              const c = d <= 0 ? c1 : d <= 1 ? mixRgb(c1, c2, d) : c2;
              const a = d <= 0 ? 1 + d : d <= 1 ? 1 : 2 - d;
              if (a > 0) f.set(x, y, mixRgb(f.get(x, y), c, a));
            }
          }
        } else {
          const step = Math.floor(ms / (fall * 3.5));
          for (let i = 0; i < s.pcp.n * more; i++) {
            const cyc = S + 2 + ih(i, 25, 4) % (31 - S);
            const y = (ih(i, 22, 4) % cyc + step) % cyc;
            const side = Math.floor((ms + (ih(i, 23, 4) % 2000)) / 2000) % 2;
            const x = (ih(i, 21, 4) % W + side) % W;
            if (quiet(x, y)) continue;
            f.fill(x, y, 1, 1, SK.snow[ih(i, 24, 4) % 10 < 4 ? 1 : 0]);
          }
        }
      }
      if (ws) {
        if (!(ws.blinks && o.blink)) f.text('small', wword, f.text('small', ws.glyph, 0, 32, ws.color) + TAG_GAP - 1, 32, ws.color);
      } else if (tempStr) f.text('small', tempStr, 0, 32, C.label);
      f.text('small', clock, W - cw, 32, C.label);
      return f;
    }

    function applyBrightness(f, bright) {
      const k = Math.max(0, Math.min(100, bright == null ? 100 : bright)) / 100;
      if (k === 1) return f;
      for (let i = 0; i < f.px.length; i++) f.px[i] = Math.round(f.px[i] * k);
      return f;
    }

    // Screen change (S3): the new screen pushes the old one's last frame
    // off the panel sideways over SCREEN_SLIDE_MS, SLIDE_GAP unlit columns
    // between them. dir 1: the new screen comes in from the right (a later
    // screen); -1: from the left. slideOffset(t, w) is how far it has come,
    // 0..w + SLIDE_GAP px, t ms into the slide across a panel w wide.
    // `from` (pixels) narrower than f, the last frame of a 64-wide status
    // screen on a 128 board, is widened as the board showed it.
    const SCREEN_SLIDE_MS = 450, SLIDE_GAP = 4;
    const slideOffset = (t, w = 64) => Math.round(easeInOut(Math.max(0, Math.min(1, t / SCREEN_SLIDE_MS))) * (w + SLIDE_GAP));
    const fromPx = (from, f) => (from.length < f.px.length ? widenPx(from, from.length / (f.h * 3), f.w) : from);
    function slideFrames(from, f, d, dir) {
      from = fromPx(from, f);
      const w = f.w, h = f.h, cur = f.px.slice();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // Which frame, and which of its columns, lands on column x (none: the gap).
          let src = null, sx = 0;
          if (dir >= 0) {
            if (x < w - d) { src = from; sx = x + d; } else if (x >= w - d + SLIDE_GAP) { src = cur; sx = x - (w - d + SLIDE_GAP); }
          } else if (x >= d) { src = from; sx = x - d; } else if (x < d - SLIDE_GAP) { src = cur; sx = x + w - (d - SLIDE_GAP); }
          const i = (y * w + x) * 3, j = (y * w + sx) * 3;
          f.px[i] = src ? src[j] : 0; f.px[i + 1] = src ? src[j + 1] : 0; f.px[i + 2] = src ? src[j + 2] : 0;
        }
      }
      return f;
    }

    // Screen change from the phone or the auto rotation (S3): the old
    // screen's last frame fades to black over SCREEN_FADE_OUT_MS, then the
    // new screen fades in over SCREEN_FADE_IN_MS (linear). The slide above
    // is kept for the knob and the buttons. fadeFrames(from, f, t): t ms
    // into the fade.
    const SCREEN_FADE_OUT_MS = 125, SCREEN_FADE_IN_MS = 125, SCREEN_FADE_MS = SCREEN_FADE_OUT_MS + SCREEN_FADE_IN_MS;
    function fadeFrames(from, f, t) {
      from = fromPx(from, f);
      const out = t < SCREEN_FADE_OUT_MS;
      const k = out ? 1 - Math.max(0, t) / SCREEN_FADE_OUT_MS : Math.min(1, (t - SCREEN_FADE_OUT_MS) / SCREEN_FADE_IN_MS);
      const src = out ? from : f.px;
      for (let i = 0; i < f.px.length; i++) f.px[i] = Math.round(src[i] * k);
      return f;
    }

    // The clock screen's face (payload cface; the skyline by default).
    function renderClock(p, o) {
      return p.cface === 'seventies' ? renderSeventies(p, o) : p.cface === 'analog' ? renderAnalog(p, o)
        : p.cface === 'daynight' ? renderDayNight(p, o) : p.cface === 'gradient' ? renderGradient(p, o)
        : p.cface === 'digits' ? renderDigits(p, o) : p.cface === 'daydate' ? renderDayDate(p, o)
        : p.cface === 'words' && colsOf(p) === WIDE ? renderWords(p, o) : renderSkyline(p, o);
    }

    // opts.roller (createNumRoller) or opts.nums ({name: {from, p}}): clock
    // rolls (see takeRoll). opts.slide ({from: the old screen's pixels, t:
    // ms into the slide, dir}): the screen-change slide, after brightness
    // (from is a shown frame). opts.fade ({from, t}): the screen-change
    // fade, likewise. opts.iconT: ms on the board's clock for
    // the overnight owl (S3).
    function render(p, opts) {
      const o = opts || {};
      const screen = o.screen || p.screen;
      NR = o.roller || o.nums ? { roller: o.roller, rolls: o.nums, still: p.croll === false } : null;
      ICON_T = o.iconT != null ? o.iconT : null;
      let f;
      try {
        f = screen === 'peek' ? renderPeek(p, o) : screen === 'chooser' ? renderChooser(p, o) : screen === 'ticker' ? renderTicker(p, o) : screen === 'weather' ? renderWeather(p, o)
          : screen === 'baseball' ? renderBaseball(p, o) : screen === 'clock' ? renderClock(p, o)
          : screen === 'announce' ? renderAnnounce(p, o) : renderTransit(p, o);
      } finally { NR = null; ICON_T = null; }
      f = widen(f, colsOf(p));
      applyBrightness(f, p.bright);
      if (o.slide && o.slide.from) slideFrames(o.slide.from, f, slideOffset(o.slide.t || 0, f.w), o.slide.dir == null ? 1 : o.slide.dir);
      else if (o.fade && o.fade.from) fadeFrames(o.fade.from, f, o.fade.t || 0);
      return f;
    }

    // Time texts per transit slot at `now`, keyed for change detection.
    function transitTexts(p, now) {
      const out = {};
      for (const r of buildTransitView(p, now).rows) for (const c of r.cells) out[c.id] = c.text;
      return out;
    }

    // Clock rolls on one screen. Pass it to render()
    // as opts.roller between begin(t) and end(): while drawing, take(name,
    // text) compares each named text with what the last frame showed and
    // starts a roll when it changed, so the change rolls from its first frame.
    // A text that wasn't on the last frame (a new screen or layout) just
    // appears. reset() on a screen change. Mirrors NumRoller in draw.py.
    function createNumRoller() {
      let prev = {}, cur = {}, live = {}, t = 0;
      return {
        begin(ms) { t = ms; cur = {}; },
        take(name, text) {
          cur[name] = text;
          const old = prev[name];
          if (old != null && old !== text) live[name] = { from: old, start: t };
          const r = live[name];
          if (!r) return null;
          const p = (t - r.start) / ROLL_MS;
          if (p >= 1 || r.from === text) { delete live[name]; return null; }
          return { from: r.from, p };
        },
        end() {
          for (const k of Object.keys(live)) if (!(k in cur)) delete live[k];
          prev = cur;
        },
        reset() { prev = {}; live = {}; },
        busy(ms) { return Object.values(live).some((r) => ms - r.start < ROLL_MS); },
        // A clock on screen: it rolls at every minute.
        clock() { return Object.keys(prev).some((k) => k.endsWith('clock')); },
      };
    }

    return {
      Frame, LINE, C, BB, RADAR, radarColors, radarLoopIdx, radarOnHand, rainBarsTurn, measure, clockText, rowTops, timeText, chronoText, maxRows, render, renderTransit, renderTicker, renderWeather,
      renderBaseball, renderChooser, renderPeek, peekView, PEEK, PEEK_ICONS, PEEK_COLORS, peekShift, peekDrop, renderSkyline, SKYW, renderSeventies, renderAnalog, renderDayNight, renderGradient, gradientColor, GR, localDate, sinD, S70, AN, DN, renderAnnounce, messageLayout, cleanMessage, messageIntroMs, messageTick, MSG_STYLES, MSG_MAX, SKY, SKY_FADE_MS, createSkylineFader, boatAt, strikeLevel, baseballTexts, pickGame, scoreColor, embossText, SCORE_HOLD_S, SCORE_FADE_S, LG,
      autoScreen, transitTexts, tickerPages, applyBrightness, buildTransitView, createTransitAnimator,
      ROLL_MS, FADE_MS, MOVE_MS, BLINK_MS: 1000, timing, createNumRoller, SCREEN_SLIDE_MS, SLIDE_GAP, slideOffset, slideFrames, SCREEN_FADE_OUT_MS, SCREEN_FADE_IN_MS, SCREEN_FADE_MS, fadeFrames,
    };
  }

  // The board's speed settings from the payload's `anim` (ms; `game` in s),
  // with the defaults for anything missing: ticker page hold and slide,
  // radar frame step and the hold on the newest frame, baseball rotation.
  function timing(p) {
    const a = (p && p.anim) || {};
    return {
      pageHold: a.pageHold || 8000, slide: a.slide || 1200,
      radarFrame: a.radarFrame || 500, radarHold: a.radarHold || 4000,
      game: a.game || 60,
    };
  }

  // Which screen the board shows now. The payload's `screen` is the base.
  // In the Cycle, `rot` takes turns through its screens every `every` s,
  // and (radar.visit set: Rain nearby) the weather screen is visited for
  // `for` seconds at the start of every `every`-second cycle while rain is
  // in the box (or always, visit.always), on any base screen but weather.
  // Both are epoch-aligned. `skipUntil` (epoch s): no visit before then (the
  // knob ended one). Mirrored by the S3's Player::auto_screen(); the frozen
  // player.py visits only transit, ticker and baseball.
  const VISITED = ['transit', 'ticker', 'baseball', 'clock', 'announce'];
  function autoScreen(p, now, skipUntil = 0) {
    let screen = p.screen;
    const rot = p.rot;
    if (rot && rot.screens && rot.screens.length > 1 && rot.every > 0 && rot.screens.includes(screen)) {
      screen = rot.screens[Math.floor(Math.floor(now) / rot.every) % rot.screens.length];
    }
    const r = p.radar;
    if (!VISITED.includes(p.screen) || !r || !r.visit || !(r.visit.every > 0) || !(r.on || r.visit.always) || now < skipUntil) return screen;
    return Math.floor(now) % r.visit.every < r.visit.for ? 'weather' : screen;
  }

  return { Frame, create, autoScreen, timing, minutesUntil, timeText, chronoText, maxRows, rowTops, liveRows, slotKey, easeInOut, DROP_GRACE, HOLD_MAX, WIDE, colsOf, widenPx };
});
