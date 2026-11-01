#!/usr/bin/env node
'use strict';
// Message screen mockups: nine ways the board could show a short note sent
// from the phone, each as a strip of key frames. Not in draw.js yet.
// Colors cut to the panel's 5 bits per channel. Made-up messages.
//   node scripts/mock-messages.js   -> docs/board/mockups/messages/sheet.png

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { packFonts } = require('../server/board/fonts');

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

// ---- 2. Split-flap: 10 x 3 small flaps ----
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

// ---- 3. Typewriter ----
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

// ---- 4. Marquee bulbs ----
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

// ---- 5. Big word ----
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

// ---- 6. Icon + text ----
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

// ---- 7. Speech bubble (pigeon) ----
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

// ---- 8. Credits roll: the whole note drifts up, edges fade ----
function credits(text, off, { col = C.label, from = '- SAM' } = {}) {
  const f = new Frame();
  const lines = wrap('5x7', text, 62);
  // Lines 10 px apart starting below the panel, then the sender; off = px scrolled.
  const items = lines.map((l) => ['5x7', l, col]).concat([['small', from, C.dark]]);
  items.forEach(([font, l, c], i) => {
    const base = 40 + i * 10 - off;
    const y0 = base - 7;
    if (base < 0 || y0 > 31) return;
    ctext(f, font, l, 32, base, c);
  });
  // Fade the top and bottom 3 rows so lines arrive and leave softly.
  for (let y = 0; y < 32; y++) {
    const k = y < 3 ? (y + 1) / 4 : y > 28 ? (32 - y) / 4 : 1;
    if (k < 1) for (let x = 0; x < 64; x++) f.set(x, y, f.get(x, y).map((v) => Math.round(v * k)));
  }
  return f;
}

// ---- 9. Crawl: a still headline over a lower-third band that crawls ----
function crawl(head, body, off, { ln = 'BL', icon = null } = {}) {
  const f = new Frame();
  if (icon) {
    const ic = ICONS[icon];
    sprite(f, ic.rows, 2, 3, ic.pal);
    f.text('5x7', head, 18, 13, C.white);
  } else ctext(f, '5x7', head, 32, 13, C.white);
  f.fill(0, 20, 64, 12, scale(LINE[ln], 0.55));
  f.fill(0, 20, 64, 1, scale(LINE[ln], 0.9));
  const w = measure('5x7', body) + 12;
  f.withClip(0, 21, 63, 31, () => {
    for (let x = 64 - off; x < 64; x += w) f.text('5x7', body, x, 29, C.white);
  });
  return f;
}

// ---- sheet ----
const LONG = 'Leaving at 8:15 for the game. Meet at the north end of the Addison platform.';
const ROWS = [
  ['1  NOTE: WRAPPED TEXT, PAGES SLIDE UP', [
    ['ONE LINE', note('Dinner at 7')],
    ['TWO + SENDER', note('Grab milk on the way home', { from: '- SAM' })],
    ['LONG: PAGE 1', note(LONG)],
    ['SLIDING', note(LONG, { slide: 0.5 })],
    ['PAGE 2', note(LONG, { page: 1 })],
    ['SMALL TEXT', noteSmall(LONG)],
  ]],
  ['2  SPLIT-FLAP (MATCHES THE CLOCK FACE IN SPEC 16)', [
    ['BLANK', splitFlap(['DINNER', 'AT 7 PM', 'BRING WINE'], ['blank', 'blank', 'blank'])],
    ['ROW 1 FLIPS', splitFlap(['DINNER', 'AT 7 PM', 'BRING WINE'], ['flip', 'blank', 'blank'])],
    ['ROW 2 FLIPS', splitFlap(['DINNER', 'AT 7 PM', 'BRING WINE'], ['done', 'flip', 'blank'])],
    ['SETTLED', splitFlap(['DINNER', 'AT 7 PM', 'BRING WINE'], ['done', 'done', 'done'])],
    ['ANOTHER', splitFlap(['GO CUBS', 'BEER IN', 'THE FRIDGE'], ['done', 'done', 'done'])],
  ]],
  ['3  TYPEWRITER: TYPES OUT, CURSOR BLINKS', [
    ['TYPING', typewriter('Gone to the gym. Back by 6.', 6)],
    ['TYPING', typewriter('Gone to the gym. Back by 6.', 17)],
    ['DONE', typewriter('Gone to the gym. Back by 6.', 99)],
    ['CURSOR OFF', typewriter('Gone to the gym. Back by 6.', 99, { cursor: false })],
    ['PHOSPHOR', typewriter('Gone to the gym. Back by 6.', 99, { col: '#40ff70' })],
  ]],
  ['4  MARQUEE: CHASING BULBS', [
    ['PHASE 1', marquee('Welcome', 'home!', 0)],
    ['PHASE 2', marquee('Welcome', 'home!', 1)],
    ['PHASE 3', marquee('Welcome', 'home!', 2)],
    ['ANOTHER', marquee('Happy', 'anniversary', 0)],
  ]],
  ['5  BIG WORD / COUNTDOWN', [
    ['SUNSET + SPARKLE', bigWord('Yay!', SUNSET, 1)],
    ['SPARKLE 2', bigWord('Yay!', SUNSET, 2)],
    ['AMBER', bigWord('BRB', () => C.amber)],
    ['LINE COLOR', bigWord('GO!', () => '#20c060')],
    ['COUNTDOWN', countdown('12', 'DAYS TO VACATION')],
  ]],
  ['6  ICON + TEXT (ICON ANIMATES GENTLY)', [
    ['HEART', iconText('heart', 'Love you!')],
    ['HEART BEAT', iconText('heartSmall', 'Love you!')],
    ['CAKE', iconText('cake', 'Happy bday, Sam!')],
    ['FLICKER', iconText('cakeFlicker', 'Happy bday, Sam!')],
    ['HOUSE', iconText('house', 'Home by 6')],
    ['COFFEE', iconText('coffee', 'Coffee is on')],
  ]],
  ['7  SPEECH BUBBLE: A PIGEON SAYS IT, PECKS NOW AND THEN', [
    ['SAYS', bubble('Dinner', 'at 7? Coo.')],
    ['PECK', bubble('Dinner', 'at 7? Coo.', { peck: true })],
    ['ANOTHER', bubble('Take out', 'the trash')],
  ]],
  ['8  CREDITS ROLL: THE NOTE DRIFTS UP 1 PX AT A TIME, EDGES FADE', [
    ['ARRIVING', credits(LONG, 14)],
    ['', credits(LONG, 30)],
    ['', credits(LONG, 46)],
    ['', credits(LONG, 62)],
    ['SENDER LAST', credits(LONG, 84)],
  ]],
  ['9  CRAWL: STILL HEADLINE, THE DETAILS CRAWL ALONG A BAND', [
    ['HEADLINE', crawl('Game day', 'Leaving at 8:15, meet at the north end of Addison', 0)],
    ['CRAWLING', crawl('Game day', 'Leaving at 8:15, meet at the north end of Addison', 50)],
    ['', crawl('Game day', 'Leaving at 8:15, meet at the north end of Addison', 140)],
    ['WITH ICON', crawl('Sam', 'Happy birthday! Dinner at Lula at 7, we have the back table', 90, { ln: 'PK', icon: 'cake' })],
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
