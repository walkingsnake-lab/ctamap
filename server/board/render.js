'use strict';
// Reference renderer: draws a /board/update payload exactly as the board
// should (docs/board/design-spec.md §3–6). Used by the simulator page and by
// tests; the CircuitPython board code mirrors this layout.

const { Frame } = require('./raster');
const { measure } = require('./fonts');
const { drawIcon, ALERT_BANG } = require('./icons');
const { timeText } = require('./arrivals');
const G = require('./glyphs');
const { TZ } = require('./time');

const LINE = { RD: '#c60c30', BL: '#00a1de', BR: '#62361b', GR: '#009b3a', OR: '#f9461c', PR: '#522398', PK: '#e27ea6', YL: '#f9e300' };

const C = {
  label: '#d8d8d8', clock: '#cccccc', amber: '#ffb000', dimAmber: '#9c6a00',
  sch: '#b0b0b0', schDim: '#6e6e6e', grey: '#8f8f8f', band: '#202020', divider: '#333333',
  tickerHead: '#a6a6a6', index: '#1f2f35', white: '#ffffff', red: '#ff2020',
  watch: '#ffd800', warnSevere: '#ff8000', warnTornado: '#ff2020', noTrains: '#6c6c6c',
};

const TIME_GAP = 3;
const TAG_GAP = 3;
const s = (cp) => String.fromCodePoint(cp);
const scale = (hex, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');

const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
// "1:02" (12-hour, no AM/PM, no leading zero), Chicago time.
function clockText(now) {
  return clockFmt.format(new Date(now * 1000)).replace(/\s?[AP]M$/i, '');
}

const rtext = (f, font, str, right, base, color) => f.text(font, str, right - measure(font, str) + 1, base, color);

// ---- transit ----

// Row tops for n rows. Spec-pinned cases first; otherwise the preferred pitch
// (shrunk to fit) and the block centered in the free area.
function rowTops(n, hasHeader, hasWeather) {
  if (n === 0) return [];
  if (hasHeader && !hasWeather && n === 4) return [9, 15, 21, 27];
  if (hasHeader && !hasWeather && n === 3) return [10, 18, 26];
  const areaTop = hasHeader ? 9 : 0;
  const areaBottom = hasWeather ? 20 : 31;
  const areaH = areaBottom - areaTop + 1;
  const preferred = hasHeader ? { 1: 0, 2: 8, 3: 8, 4: 6, 5: 6 } : { 1: 0, 2: 7, 3: 10, 4: 8, 5: 6 };
  const pitch = n === 1 ? 0 : Math.min(preferred[n], Math.floor((areaH - 5) / (n - 1)));
  const block = (n - 1) * pitch + 5;
  const top = areaTop + Math.max(0, Math.floor((areaH - block) / 2));
  return Array.from({ length: n }, (_, i) => top + i * pitch);
}

function drawHeader(f, name, now, { band, nameColor }) {
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

function drawRow(f, r, top, now, blink) {
  const base = top + 5;
  if (r.a && blink) {
    ALERT_BANG.forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') f.fill(i, top + j, 1, 1, LINE[r.ln]); }));
  } else {
    f.fill(0, top, 3, 5, LINE[r.ln]);
  }
  f.text('small', r.lbl, 5, base, C.label);
  let x = 63;
  for (let k = r.t.length - 1; k >= 0; k--) {
    const txt = timeText(r.t[k], now);
    const w = measure('small', txt);
    const color = r.s && r.s[k] ? (k ? C.schDim : C.sch) : (k ? C.dimAmber : C.amber);
    f.text('small', txt, x - w + 1, base, color);
    x -= w + TIME_GAP;
  }
}

function drawOvernight(f, p, now) {
  const clock = clockText(now);
  const w = measure('clock', clock);
  const nt = 'NO TRAINS';
  // Clock digits are 10px tall (rows 2-11 of the 15-row cell, baseline at cell row 12).
  const blockH = 10 + 3 + 5; // digits, gap, label
  const areaTop = 0;
  const areaH = p.wx ? 22 : 32;
  const top = areaTop + Math.floor((areaH - blockH) / 2);
  f.text('clock', clock, Math.floor((64 - w) / 2), top + 10, C.clock);
  f.text('small', nt, Math.floor((64 - measure('small', nt)) / 2), top + 18, C.noTrains);
}

function renderTransit(p, { now = p.now, blink = false } = {}) {
  const f = new Frame();
  const rows = p.rows || [];
  if (!rows.length) {
    drawOvernight(f, p, now);
  } else {
    if (p.header) drawHeader(f, p.header, now, { band: C.band, nameColor: C.grey });
    const tops = rowTops(rows.length, !!p.header, !!p.wx);
    rows.forEach((r, i) => drawRow(f, r, tops[i], now, blink));
  }
  if (p.wx) drawWeather(f, p.wx, p.warn);
  return f;
}

// ---- ticker ----

function renderTicker(p, { now = p.now, page = 0 } = {}) {
  const f = new Frame();
  if (p.header) drawHeader(f, p.header, now, { band: null, nameColor: C.tickerHead });
  const items = (p.ticker || []).slice(page * 2, page * 2 + 2);
  items.forEach((it, i) => {
    const top = 7 + i * 13; // 12px rows with a 1px gap
    const base = top + 9;
    const idx = page * 2 + i + 1;
    f.fill(0, top, 5, 12, C.index);
    f.fill(5, top, 59, 12, scale(LINE[it.ln], 0.55));
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
  });
  return f;
}

// Apply the payload's global brightness (0-100) to a rendered frame.
function applyBrightness(f, bright) {
  const k = Math.max(0, Math.min(100, bright)) / 100;
  if (k === 1) return f;
  for (let i = 0; i < f.px.length; i++) f.px[i] = Math.round(f.px[i] * k);
  return f;
}

function render(p, { screen = p.screen, now = p.now, page = 0, blink = false } = {}) {
  const f = screen === 'ticker' ? renderTicker(p, { now, page }) : renderTransit(p, { now, blink });
  return applyBrightness(f, p.bright == null ? 100 : p.bright);
}

module.exports = { render, renderTransit, renderTicker, rowTops, clockText, LINE, C };
