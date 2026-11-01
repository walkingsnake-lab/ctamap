#!/usr/bin/env node
'use strict';
// Message screen mockups: ten ways the board could show a short note sent
// from the phone, each as a strip of key frames. Not in draw.js yet.
// Colors cut to the panel's 5 bits per channel. Made-up messages.
//   node scripts/mock-messages.js   -> docs/board/mockups/messages/sheet.png

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { packFonts } = require('../server/board/fonts');
const draw = require('../server/board/render');
const { normalize, format } = require('../server/board/arrivals');
const { parseCtaTime, tzOffset } = require('../server/board/time');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'messages');
const F = packFonts();

// ---- helpers ----
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const scale = (c, k) => toHex(hex(c).map((v) => v * k));
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const LINE = { RD: '#c60c30', BL: '#00a1de', BR: '#62361b', GR: '#009b3a', OR: '#f9461c', PR: '#522398', PK: '#e27ea6', YL: '#f9e300' };
const C = { label: '#d8d8d8', white: '#f0f0f0', amber: '#ffb000', grey: '#808080', dark: '#555555', rule: '#333333' };

function measure(font, s) {
  let w = 0;
  for (const ch of s) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; }
  return w > 0 ? w - 1 : 0;
}
function wrap(font, text, maxW) {
  const lines = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const t = cur ? `${cur} ${word}` : word;
    if (measure(font, t) <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}
const ctext = (f, font, s, cx, base, col) => f.text(font, s, Math.round(cx - measure(font, s) / 2), base, col);
const rtext = (f, font, s, x1, base, col) => f.text(font, s, x1 - measure(font, s), base, col);

// Text drawn at 2x (each pixel 2x2), for one-word shouts. colorAt(y) gives a
// per-row gradient.
function bigText(f, s, x, top, colorAt) {
  const t = new Frame(80, 10);
  t.text('5x7', s, 0, 8, '#ffffff');
  for (let y = 0; y < 10; y++) for (let i = 0; i < 80; i++) {
    if (!t.get(i, y)[0]) continue;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) f.set(x + i * 2 + dx, top + y * 2 + dy, hex(colorAt(y * 2 + dy)));
  }
}
const bigWidth = (s) => measure('5x7', s) * 2;

// Pixel art: rows of characters, '.' unlit, others keys into pal.
function sprite(f, rows, x, y, pal) {
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.' && pal[ch]) f.set(x + i, y + j, hex(pal[ch])); }));
}

// Tom Thumb glyph as a 5-row bitmap (for split-flap tiles).
function glyphRows(ch) {
  const g = F.small[ch.codePointAt(0)];
  if (!g) return { w: 0, rows: [] };
  const [, w, h, , yo] = g;
  const rows = Array.from({ length: 5 }, () => new Array(w).fill(0));
  const top = 5 - (yo + h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if ((g[5 + r] >> (w - 1 - c)) & 1) if (rows[top + r]) rows[top + r][c] = 1;
  return { w, rows };
}

// ---- 1. Note: plain wrapped text, pages slide up ----
const NOTE_BASES = { 1: [19], 2: [14, 24], 3: [9, 19, 29] };
function note(text, { col = C.label, page = 0, slide = 0, from = null } = {}) {
  const f = new Frame();
  const lines = wrap('5x7', text, 64);
  const pages = [];
  for (let i = 0; i < lines.length; i += 3) pages.push(lines.slice(i, i + 3));
  const drawPage = (pl, dy) => (NOTE_BASES[pl.length] || []).forEach((b, i) => ctext(f, '5x7', pl[i], 32, b + dy, col));
  if (from && pages.length === 1 && pages[0].length <= 2) {
    pages[0].forEach((l, i) => ctext(f, '5x7', l, 32, [11, 21][i] - (pages[0].length === 1 ? -5 : 0), col));
    rtext(f, 'small', from, 63, 31, C.dark);
    return f;
  }
  const e = slide < 0.5 ? 2 * slide * slide : 1 - Math.pow(-2 * slide + 2, 2) / 2;
  drawPage(pages[page], -Math.round(e * 32));
  if (slide > 0 && pages[page + 1]) drawPage(pages[page + 1], 32 - Math.round(e * 32));
  return f;
}
function noteSmall(text) {
  const f = new Frame();
  const lines = wrap('small', text.toUpperCase(), 64).slice(0, 5);
  const top = Math.floor((32 - (lines.length * 6 - 1)) / 2);
  lines.forEach((l, i) => ctext(f, 'small', l, 32, top + 5 + i * 6, C.label));
  return f;
}

// ---- 2. Line card: the ticker's rows carrying the message ----
const ENVELOPE = ['WWWWW', 'WW.WW', 'W.W.W', 'WWWWW'];
function lineCard(l1, l2, ln, { slide = 0, next = null, from = 'NOTE', clock = '7:42' } = {}) {
  const f = new Frame();
  f.text('small', from, 0, 6, C.grey);
  rtext(f, 'small', clock, 63, 6, C.grey);
  const rows = (a, b, line, dy) => [a, b].forEach((t, i) => {
    const top = 7 + i * 13 + dy;
    f.withClip(0, 7, 63, 31, () => {
      f.fill(0, top, 5, 12, '#2d2d2d');
      f.fill(5, top, 59, 12, scale(LINE[line], 0.55));
      if (i === 0) sprite(f, ENVELOPE, 0, top + 4, { W: C.label });
      else f.text('small', '2', 1, top + 9, C.label);
      f.text('5x7', t, 7, top + 9, C.white);
    });
  });
  const e = slide < 0.5 ? 2 * slide * slide : 1 - Math.pow(-2 * slide + 2, 2) / 2;
  rows(l1, l2, ln, -Math.round(e * 26));
  if (next) rows(next[0], next[1], next[2], 26 - Math.round(e * 26));
  return f;
}

// ---- 3. Split-flap: 10 x 3 small flaps ----
function flap(f, x, y, ch, { flipping = null, col = '#d8d8d8' } = {}) {
  // Tile 5 x 10: top flap rows 0-3, hinge row 4 unlit, bottom rows 5-9.
  // Glyph rows 0-1 on rows 2-3, rows 2-4 on rows 5-7.
  f.fill(x, y, 5, 4, '#1f1f1f');
  f.fill(x, y + 5, 5, 5, '#171717');
  const put = (c, part, color) => {
    if (!c || c === ' ') return;
    const { w, rows } = glyphRows(c);
    const ox = x + Math.floor((5 - w) / 2);
    rows.forEach((r, j) => {
      if ((part === 'top') !== (j < 2)) return;
      r.forEach((b, i) => { if (b) f.set(ox + i, y + (j < 2 ? 2 + j : 3 + j), hex(color)); });
    });
  };
  if (!flipping) { put(ch, 'top', col); put(ch, 'bot', col); return; }
  // Mid-flip: the new top is uncovered, the old top flap is folding onto the
  // hinge (squashed to its bottom row, darkened), the old bottom still shows.
  put(ch, 'top', col);
  put(flipping, 'bot', col);
  f.fill(x, y + 3, 5, 1, '#2a2a2a');
  const { w, rows } = glyphRows(flipping);
  if (flipping !== ' ') rows[1].forEach((b, i) => { if (b) f.set(x + Math.floor((5 - w) / 2) + i, y + 3, hex(scale(col, 0.5))); });
}
function splitFlap(lines, state) {
  // state per row: 'blank' | 'flip' | 'done'
  const f = new Frame();
  lines.forEach((l, r) => {
    const pad = Math.floor((10 - l.length) / 2);
    const s = (' '.repeat(pad) + l).padEnd(10);
    [...s].forEach((ch, i) => {
      const x = 2 + i * 6, y = r * 11;
      const st = state[r];
      if (st === 'blank') flap(f, x, y, ' ');
      else if (st === 'flip') flap(f, x, y, ch, { flipping: ' ', col: r === 0 ? C.amber : C.label });
      else flap(f, x, y, ch, { col: r === 0 ? C.amber : C.label });
    });
  });
  return f;
}

// ---- 4. Typewriter ----
function typewriter(text, n, { col = C.amber, cursor = true } = {}) {
  const f = new Frame();
  const lines = wrap('5x7', text, 60);
  let left = n, lastX = 0, lastB = 9;
  lines.forEach((l, i) => {
    if (left < 0) return;
    const part = l.slice(0, left);
    left -= l.length + 1;
    const b = 9 + i * 10;
    lastX = f.text('5x7', part, 0, b, col);
    lastB = b;
  });
  if (cursor) f.fill(lastX, lastB - 7, 4, 7, scale(col, 0.8));
  return f;
}

// ---- 5. Marquee bulbs ----
function marquee(l1, l2, phase) {
  const f = new Frame();
  const bulbs = [];
  for (let x = 1; x <= 62; x += 3) bulbs.push([x, 0]);
  for (let y = 3; y <= 30; y += 3) bulbs.push([62, y]);
  for (let x = 61; x >= 1; x -= 3) bulbs.push([x, 31]);
  for (let y = 28; y >= 3; y -= 3) bulbs.push([1, y]);
  bulbs.forEach(([x, y], i) => f.set(x, y, hex((i + phase) % 3 === 0 ? '#ffd060' : '#4a3010')));
  ctext(f, '5x7', l1, 32, 14, C.white);
  ctext(f, '5x7', l2, 32, 25, C.amber);
  return f;
}

// ---- 6. Big word ----
const SUNSET = (y) => mix('#ff3060', '#ffb000', Math.min(1, y / 14));
const SPARKS = [[[3, 4], [58, 7], [8, 26], [55, 27], [30, 2]], [[6, 8], [60, 3], [4, 22], [50, 29], [34, 30]]];
function bigWord(s, colorAt, sparks = null) {
  const f = new Frame();
  bigText(f, s, Math.round(32 - bigWidth(s) / 2), 7, colorAt);
  if (sparks) for (const [x, y] of SPARKS[sparks - 1]) { f.set(x, y, [255, 255, 255]); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f.set(x + dx, y + dy, [90, 90, 90]); }
  return f;
}
function countdown(n, label) {
  const f = new Frame();
  const w = measure('clock', n);
  f.text('clock', n, Math.round(32 - w / 2), 17, '#cccccc');
  ctext(f, 'small', label, 32, 27, C.amber);
  return f;
}

// ---- 7. Icon + text ----
const ICONS = {
  heart: { pal: { R: '#ff2040', W: '#ffb0c0' }, rows: [
    '..RRR...RRR..', '.RRRRR.RRRRR.', 'RWRRRRRRRRRRR', 'RWRRRRRRRRRRR', 'RRRRRRRRRRRRR', 'RRRRRRRRRRRRR',
    '.RRRRRRRRRRR.', '..RRRRRRRRR..', '...RRRRRRR...', '....RRRRR....', '.....RRR.....', '......R......'] },
  heartSmall: { pal: { R: '#ff2040', W: '#ffb0c0' }, rows: [
    '.............', '.............', '...RR...RR...', '..RRRR.RRRR..', '..RWRRRRRRR..', '..RRRRRRRRR..',
    '...RRRRRRR...', '....RRRRR....', '.....RRR.....', '......R......', '.............', '.............'] },
  cake: { pal: { F: '#ff8c00', Y: '#ffe060', W: '#e0e0e0', P: '#ff70b0', C: '#a06030', D: '#606060' }, rows: [
    '......F......', '.....FYF.....', '......Y......', '......W......', '......W......', '.PPPPPPPPPPP.',
    '.PP.PPP.PP.P.', '.CCCCCCCCCCC.', '.CCCCCCCCCCC.', '.PPPPPPPPPPP.', '.CCCCCCCCCCC.', '.CCCCCCCCCCC.', 'DDDDDDDDDDDDD'] },
  cakeFlicker: { pal: { F: '#ff8c00', Y: '#ffe060', W: '#e0e0e0', P: '#ff70b0', C: '#a06030', D: '#606060' }, rows: [
    '.............', '......F......', '.....FYF.....', '......W......', '......W......', '.PPPPPPPPPPP.',
    '.PP.PPP.PP.P.', '.CCCCCCCCCCC.', '.CCCCCCCCCCC.', '.PPPPPPPPPPP.', '.CCCCCCCCCCC.', '.CCCCCCCCCCC.', 'DDDDDDDDDDDDD'] },
  house: { pal: { R: '#c03020', W: '#909090', Y: '#ffc040', B: '#5a3a20' }, rows: [
    '......R......', '.....RRR.....', '....RRRRR....', '...RRRRRRR...', '..RRRRRRRRR..', '.RRRRRRRRRRR.',
    '..WWWWWWWWW..', '..WYYWWWWWW..', '..WYYWWBBBW..', '..WWWWWBBBW..', '..WWWWWBBBW..', '..WWWWWBBBW..'] },
  coffee: { pal: { S: '#606060', W: '#d8d8d8', B: '#6a4020' }, rows: [
    '...S..S......', '..S..S.......', '...S..S......', '.............', 'WWWWWWWWW....', 'WBBBBBBBWWW..',
    'WWWWWWWWW.W..', 'WWWWWWWWW.W..', 'WWWWWWWWWWW..', '.WWWWWWW.....', '..WWWWW......', 'WWWWWWWWWW...'] },
};
function iconText(icon, text, col = C.label) {
  const f = new Frame();
  const ic = ICONS[icon];
  sprite(f, ic.rows, 1, Math.floor((32 - ic.rows.length) / 2), ic.pal);
  const lines = wrap('5x7', text, 47);
  const bases = { 1: [19], 2: [14, 24], 3: [9, 19, 29] }[lines.length];
  lines.forEach((l, i) => ctext(f, '5x7', l, 40, bases[i], col));
  return f;
}

// ---- 8. Train delivers it ----
function train(f, x, ln) {
  // Two cars of 24 px, 2 px coupler, facing right (front at x + 49).
  for (let c = 0; c < 2; c++) {
    const cx = x + c * 26;
    f.fill(cx, 23, 24, 6, '#5a5a5a');
    f.fill(cx, 23, 24, 1, '#7a7a7a');
    for (let w = 2; w < 22; w += 4) f.fill(cx + w, 25, 2, 2, '#ffd890');
    f.fill(cx, 28, 24, 1, LINE[ln]);
    f.set(cx + 4, 29, hex('#3a3a3a')); f.set(cx + 5, 29, hex('#3a3a3a'));
    f.set(cx + 18, 29, hex('#3a3a3a')); f.set(cx + 19, 29, hex('#3a3a3a'));
    if (c === 0) f.fill(cx + 24, 26, 2, 1, '#3a3a3a');
  }
  f.set(x + 49, 24, [255, 240, 200]); f.set(x + 49, 25, [255, 240, 200]);
}
function trainDelivers(l1, l2, tx, ln) {
  const f = new Frame();
  for (let x = 0; x < 64; x++) f.set(x, 30, hex(x % 3 === 0 ? '#3a3a3a' : '#222222'));
  const reveal = tx; // text shows only behind the train's tail
  f.withClip(0, 0, Math.min(63, reveal - 1), 21, () => {
    ctext(f, '5x7', l1, 32, 9, C.white);
    ctext(f, '5x7', l2, 32, 19, C.amber);
  });
  train(f, tx, ln);
  return f;
}

// ---- 9. Speech bubble (pigeon) ----
const PIGEON = [
  '..GG......', '.GGWG.....', '.GGGGO....', '..PNG.....', '..GGGGGG..', '.GDDDDGGGG', '..GDDDGGG.', '...GGGG...', '....O.O...'];
const PIGEON_PECK = [
  '..........', '..GG......', '.GGWG.....', '.GGGGO....', '..PNGGGG..', '.GDDDDGGGG', '..GDDDGGG.', '...GGGG...', '....O.O...'];
function bubble(l1, l2, { peck = false } = {}) {
  const f = new Frame();
  const o = '#808080';
  // bubble outline x 13-63, y 0-22, rounded corners; tail down-left to the bird
  for (let x = 14; x <= 62; x++) { f.set(x, 0, hex(o)); f.set(x, 22, hex(o)); }
  for (let y = 1; y <= 21; y++) { f.set(13, y, hex(o)); f.set(63, y, hex(o)); }
  f.set(13, 0, [0, 0, 0]);
  for (let i = 0; i < 4; i++) f.set(15 - i, 23 + i, hex(o));
  for (let x = 15; x <= 17; x++) f.set(x, 22, [0, 0, 0]);
  f.set(16, 23, hex(o)); f.set(17, 22, hex(o));
  ctext(f, '5x7', l1, 38, 10, C.label);
  ctext(f, '5x7', l2, 38, 19, C.label);
  sprite(f, peck ? PIGEON_PECK : PIGEON, 0, 23, { G: '#8a8a8a', W: '#ffffff', O: '#ff8c40', P: '#6a3a9a', N: '#3a9a7a', D: '#5a5a5a' });
  return f;
}

// ---- 10. Arrival: new-message intro, and the indicator on other screens ----
function envelope(f, cx, top, open) {
  const w = 19, h = 13, x0 = cx - 9, e = '#d8d8d8';
  const line = (xa, ya, xb, yb, col) => {
    const n = Math.max(Math.abs(xb - xa), Math.abs(yb - ya));
    for (let i = 0; i <= n; i++) f.set(Math.round(xa + (xb - xa) * i / n), Math.round(ya + (yb - ya) * i / n), hex(col));
  };
  if (open) {
    line(x0, top, x0 + 9, top - 6, C.amber); line(x0 + 9, top - 6, x0 + 18, top, C.amber);   // flap up
    f.fill(x0 + 3, top - 4, 13, 9, '#000000');
    f.fill(x0 + 3, top - 4, 13, 1, '#f0f0f0'); f.fill(x0 + 3, top - 4, 1, 9, '#f0f0f0'); f.fill(x0 + 15, top - 4, 1, 9, '#f0f0f0');
    for (let i = 0; i < 3; i++) f.fill(x0 + 5, top - 2 + i * 2, i === 2 ? 5 : 9, 1, '#808080');
    f.fill(x0 + 1, top + 3, w - 2, h - 4, '#000000');
    line(x0, top + h - 1, x0 + 7, top + 5, e); line(x0 + 18, top + h - 1, x0 + 11, top + 5, e);
    line(x0, top + 3, x0 + 18, top + 3, e);
    line(x0, top + 3, x0, top + h - 1, e); line(x0 + 18, top + 3, x0 + 18, top + h - 1, e); line(x0, top + h - 1, x0 + 18, top + h - 1, e);
  } else {
    line(x0, top, x0 + 18, top, e); line(x0, top + h - 1, x0 + 18, top + h - 1, e);
    line(x0, top, x0, top + h - 1, e); line(x0 + 18, top, x0 + 18, top + h - 1, e);
    line(x0, top, x0 + 9, top + 7, C.amber); line(x0 + 9, top + 7, x0 + 18, top, C.amber);
  }
}
function arrival(stage) {
  const f = new Frame();
  if (stage === 0) { envelope(f, 32, 6, false); ctext(f, 'small', 'NEW NOTE', 32, 28, C.amber); }
  if (stage === 1) { envelope(f, 32, 11, true); ctext(f, 'small', 'FROM SAM', 32, 31, C.dark); }
  return f;
}

// Transit screen with an unread-message mark in the header.
const B = path.join(__dirname, '..', 'server', 'board');
const json = JSON.parse(fs.readFileSync(path.join(B, 'fixtures', 'tt-arrivals', 'morse-2026-10-03-2316.json'), 'utf8'));
const now = parseCtaTime(json.ctatt.tmst);
const r = format(normalize(json, { log: { warn() {}, error() {} } }), { rows: [], showHeader: true, showWeather: true, showKey: false }, { now, alerts: new Set() });
const P = {
  v: 1, now, tzo: tzOffset(now), screen: 'transit', bright: 100, header: 'MORSE', view: r.view, rows: r.rows, ticker: r.ticker,
  wx: { icon: 'pcloudy_day', temp: 54, word: 'PT CLOUDY' }, warn: null,
  radar: { on: false, frames: [], ft: [], timeBox: [0, 0, 0, 0], split: false, wx: { icon: 'pcloudy_day', temp: 54, word: 'PT CLOUDY', hi: 61, lo: 47, feels: 51, wind: 'NW 12', pop: 20 } },
};
function transitWithMark() {
  const t = draw.render(P, { screen: 'transit' });
  const f = new Frame();
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) f.set(x, y, t.get(x, y));
  const x = measure('small', 'MORSE') + 3;
  sprite(f, ENVELOPE, x, 2, { W: C.amber });
  return f;
}

// ---- sheet ----
const LONG = 'Leaving at 8:15 for the game. Meet at the north end of the Addison platform.';
const ROWS = [
  ['1  NOTE: WRAPPED TEXT, PAGES SLIDE UP (NO SCROLLING)', [
    ['ONE LINE', note('Dinner at 7')],
    ['TWO + SENDER', note('Grab milk on the way home', { from: '- SAM' })],
    ['LONG: PAGE 1', note(LONG)],
    ['SLIDING', note(LONG, { slide: 0.5 })],
    ['PAGE 2', note(LONG, { page: 1 })],
    ['SMALL TEXT', noteSmall(LONG)],
  ]],
  ['2  LINE CARD: THE TICKER\'S ROWS CARRY THE NOTE', [
    ['RED', lineCard('Dinner at 7', 'Bring bread', 'RD', { from: 'SAM' })],
    ['SLIDE TO NEXT', lineCard('Dinner at 7', 'Bring bread', 'RD', { from: 'SAM', slide: 0.5, next: ['and wine', '- S', 'RD'] })],
    ['BLUE', lineCard('Happy', 'birthday!', 'BL', { from: 'MOM' })],
    ['PURPLE', lineCard('Gone to', 'the gym', 'PR', { from: 'JAKE' })],
  ]],
  ['3  SPLIT-FLAP (MATCHES THE CLOCK FACE IN SPEC 16)', [
    ['BLANK', splitFlap(['DINNER', 'AT 7 PM', 'BRING WINE'], ['blank', 'blank', 'blank'])],
    ['ROW 1 FLIPS', splitFlap(['DINNER', 'AT 7 PM', 'BRING WINE'], ['flip', 'blank', 'blank'])],
    ['ROW 2 FLIPS', splitFlap(['DINNER', 'AT 7 PM', 'BRING WINE'], ['done', 'flip', 'blank'])],
    ['SETTLED', splitFlap(['DINNER', 'AT 7 PM', 'BRING WINE'], ['done', 'done', 'done'])],
    ['ANOTHER', splitFlap(['GO CUBS', 'BEER IN', 'THE FRIDGE'], ['done', 'done', 'done'])],
  ]],
  ['4  TYPEWRITER: TYPES OUT, CURSOR BLINKS', [
    ['TYPING', typewriter('Gone to the gym. Back by 6.', 6)],
    ['TYPING', typewriter('Gone to the gym. Back by 6.', 17)],
    ['DONE', typewriter('Gone to the gym. Back by 6.', 99)],
    ['CURSOR OFF', typewriter('Gone to the gym. Back by 6.', 99, { cursor: false })],
    ['PHOSPHOR', typewriter('Gone to the gym. Back by 6.', 99, { col: '#40ff70' })],
  ]],
  ['5  MARQUEE: CHASING BULBS', [
    ['PHASE 1', marquee('Welcome', 'home!', 0)],
    ['PHASE 2', marquee('Welcome', 'home!', 1)],
    ['PHASE 3', marquee('Welcome', 'home!', 2)],
    ['ANOTHER', marquee('Happy', 'anniversary', 0)],
  ]],
  ['6  BIG WORD / COUNTDOWN', [
    ['SUNSET + SPARKLE', bigWord('Yay!', SUNSET, 1)],
    ['SPARKLE 2', bigWord('Yay!', SUNSET, 2)],
    ['AMBER', bigWord('BRB', () => C.amber)],
    ['LINE COLOR', bigWord('GO!', () => '#20c060')],
    ['COUNTDOWN', countdown('12', 'DAYS TO VACATION')],
  ]],
  ['7  ICON + TEXT (ICON ANIMATES GENTLY)', [
    ['HEART', iconText('heart', 'Love you!')],
    ['HEART BEAT', iconText('heartSmall', 'Love you!')],
    ['CAKE', iconText('cake', 'Happy bday, Sam!')],
    ['FLICKER', iconText('cakeFlicker', 'Happy bday, Sam!')],
    ['HOUSE', iconText('house', 'Home by 6')],
    ['COFFEE', iconText('coffee', 'Coffee is on')],
  ]],
  ['8  THE TRAIN DELIVERS IT: TEXT APPEARS BEHIND THE CARS', [
    ['ENTERING', trainDelivers('Running late', 'home at 7', -30, 'RD')],
    ['PASSING', trainDelivers('Running late', 'home at 7', 2, 'RD')],
    ['PASSING', trainDelivers('Running late', 'home at 7', 30, 'RD')],
    ['LEAVING', trainDelivers('Running late', 'home at 7', 56, 'RD')],
    ['DELIVERED', trainDelivers('Running late', 'home at 7', 80, 'RD')],
  ]],
  ['9  SPEECH BUBBLE: A PIGEON SAYS IT, PECKS NOW AND THEN', [
    ['SAYS', bubble('Dinner', 'at 7? Coo.')],
    ['PECK', bubble('Dinner', 'at 7? Coo.', { peck: true })],
    ['ANOTHER', bubble('Take out', 'the trash')],
  ]],
  ['10  ARRIVAL: INTRO, THEN ANY STYLE ABOVE; MARK ON OTHER SCREENS', [
    ['NEW NOTE', arrival(0)],
    ['OPENS', arrival(1)],
    ['THE NOTE', note('Grab milk on the way home', { from: '- SAM' })],
    ['UNREAD MARK', transitWithMark()],
  ]],
];

const q5 = (v) => v & 0xf8;
fs.mkdirSync(OUT, { recursive: true });
const PW = 64, PH = 32, GAP = 4, TH = 8, RT = 9, COLS = Math.max(...ROWS.map(([, ps]) => ps.length));
const sheet = new Frame(COLS * PW + (COLS + 1) * GAP, ROWS.length * (RT + TH + PH + GAP) + GAP);
let oy = GAP;
for (const [title, panels] of ROWS) {
  sheet.text('small', title, GAP, oy + 5, '#808080');
  oy += RT;
  panels.forEach(([label, f], j) => {
    const ox = GAP + j * (PW + GAP);
    sheet.text('small', label, ox, oy + 5, '#5a5a5a');
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y).map(q5));
  });
  oy += TH + PH + GAP;
}
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(5));
console.log(`wrote ${path.relative(process.cwd(), path.join(OUT, 'sheet.png'))}`);
