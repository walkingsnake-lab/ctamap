// Board drawing: the reference implementation of how the 64x32 board draws a
// /board/update payload, including its animations (per-digit roll, ticker
// slide, alert blink). Runs unchanged in Node (render.js, tests, previews)
// and in the browser (the simulator), and has no dependencies; fonts and
// icons are passed in. The CircuitPython board code mirrors this file.
//
// Layout rules: docs/board/design-spec.md §3–6.

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

  // What the board draws for an arrival time: DUE at <= 1 min.
  function timeText(t, now) {
    const min = Math.floor((t - now) / 60);
    return min <= 1 ? 'DUE' : String(min);
  }

  // Arrivals stay listed until 30 s past their time (contract countdown rules).
  const DROP_GRACE = 30;

  // Row tops for n transit rows. Spec-pinned cases first; otherwise the
  // preferred pitch (shrunk to fit) with the block centered in the free area.
  function rowTops(n, hasHeader, hasWeather) {
    if (n === 0) return [];
    if (hasHeader && !hasWeather && n === 4) return [9, 15, 21, 27];
    if (hasHeader && !hasWeather && n === 3) return [10, 18, 26];
    const areaTop = hasHeader ? 9 : 0;
    const areaBottom = hasWeather ? 20 : 31;
    const areaH = areaBottom - areaTop + 1;
    const preferred = hasHeader ? { 2: 8, 3: 8, 4: 6, 5: 6 } : { 2: 7, 3: 10, 4: 8, 5: 6 };
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

    const LINE = { RD: '#c60c30', BL: '#00a1de', BR: '#62361b', GR: '#009b3a', OR: '#f9461c', PR: '#522398', PK: '#e27ea6', YL: '#f9e300' };
    const C = {
      label: '#d8d8d8', clock: '#cccccc', amber: '#ffb000', dimAmber: '#9c6a00',
      sch: '#b0b0b0', schDim: '#6e6e6e', grey: '#8f8f8f', band: '#202020', divider: '#333333',
      tickerHead: '#a6a6a6', index: '#1f2f35', white: '#ffffff', red: '#ff2020',
      watch: '#ffd800', warnSevere: '#ff8000', warnTornado: '#ff2020', noTrains: '#6c6c6c',
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
      f.text('small', `${wx.temp}°`, 10, base, C.label);
      if (warn) {
        const glyph = warn.kind === 'tor' ? G.FUNNEL : G.BOLT;
        const word = warn.lvl === 'warning' ? 'WARNING' : 'WATCH';
        const color = warn.lvl === 'watch' ? C.watch : warn.kind === 'tor' ? C.warnTornado : C.warnSevere;
        const w = measure('small', s(glyph)) + TAG_GAP + measure('small', word);
        const x = f.text('small', s(glyph), 63 - w + 1, base, color);
        f.text('small', word, x + TAG_GAP - 1, base, color);
      } else {
        rtext(f, 'small', wx.word, 63, base, C.label);
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
        const perDigit = from.length === text.length && /^\d+$/.test(from) && /^\d+$/.test(text);
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

    function drawRow(f, r, top, now, blink, rolls) {
      if (r.a && blink) {
        icons.ALERT_BANG.forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') f.fill(i, top + j, 1, 1, LINE[r.ln]); }));
      } else {
        f.fill(0, top, 3, 5, LINE[r.ln]);
      }
      f.text('small', r.lbl, 5, top + 5, C.label);
      const texts = r.t.map((t) => timeText(t, now));
      const widthAt = (gap) => texts.reduce((w, txt, i) => w + measure('small', txt) + (i ? gap : 0), 0);
      const labelEnd = 5 + measure('small', r.lbl) - 1;
      const gap = 63 - widthAt(TIME_GAP) + 1 - labelEnd - 1 >= LABEL_GAP ? TIME_GAP : TIGHT_GAP;
      let x = 63;
      for (let k = texts.length - 1; k >= 0; k--) {
        const color = r.s && r.s[k] ? (k ? C.schDim : C.sch) : (k ? C.dimAmber : C.amber);
        drawTimeCell(f, texts[k], x, top, color, rolls && rolls[slotKey(r, k)]);
        x -= measure('small', texts[k]) + gap;
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

    // opts: now, blink (alert "!" phase), rolls ({slotKey: {from, p}})
    function renderTransit(p, opts) {
      const o = opts || {};
      const now = o.now != null ? o.now : p.now;
      const f = newFrame();
      const rows = liveRows(p, now);
      if (!rows.length) {
        drawOvernight(f, p, now);
      } else {
        if (p.header) drawHeader(f, p.header, now, C.band, C.grey);
        const tops = rowTops(rows.length, !!p.header, !!p.wx);
        rows.forEach((r, i) => drawRow(f, r, tops[i], now, !!o.blink, o.rolls));
      }
      if (p.wx) drawWeather(f, p.wx, p.warn);
      return f;
    }

    function drawTickerItem(f, it, idx, top, now) {
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
      const min = Math.floor((it.t - now) / 60);
      if (min <= 1) {
        rtext(f, '5x7', 'Due', 62, base, C.white);
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
      if (p.header) drawHeader(f, p.header, now, null, C.tickerHead);
      const items = liveTicker(p, now);
      const pages = Math.max(1, Math.ceil(items.length / 2));
      const page = (o.page || 0) % pages;
      const offset = Math.round(easeInOut(Math.min(1, Math.max(0, o.slide || 0))) * 26);
      const drawPage = (pg, shift) => {
        items.slice(pg * 2, pg * 2 + 2).forEach((it, i) => {
          drawTickerItem(f, it, pg * 2 + i + 1, 7 + i * 13 + shift, now);
        });
      };
      f.withClip(0, 7, 63, 31, () => {
        drawPage(page, -offset);
        if (offset > 0 && pages > 1) drawPage((page + 1) % pages, 26 - offset);
      });
      return f;
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
      const f = screen === 'ticker' ? renderTicker(p, o) : renderTransit(p, o);
      return applyBrightness(f, p.bright);
    }

    // Time texts per transit slot at `now`, keyed for change detection.
    function transitTexts(p, now) {
      const out = {};
      for (const r of liveRows(p, now)) r.t.forEach((t, k) => { out[slotKey(r, k)] = timeText(t, now); });
      return out;
    }

    return {
      Frame, LINE, C, measure, clockText, rowTops, timeText, render, renderTransit, renderTicker,
      transitTexts, tickerPages, applyBrightness,
      ROLL_MS: 400, SLIDE_MS: 500, PAGE_HOLD_MS: 3500, BLINK_MS: 500,
    };
  }

  return { Frame, create, timeText, rowTops, liveRows, slotKey, easeInOut, DROP_GRACE };
});
