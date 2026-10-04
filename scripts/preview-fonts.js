#!/usr/bin/env node
'use strict';
// Renders font preview PNGs into docs/board/previews/: glyph sheets for each
// board font plus a few 64x32 mock panels (made-up times) showing the fonts in
// context. Run after scripts/build-fonts.js.

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { measure, ligatures } = require('../server/board/fonts');
const G = require('../server/board/glyphs');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'previews');
fs.mkdirSync(OUT, { recursive: true });
const save = (name, frame, scale) => {
  fs.writeFileSync(path.join(OUT, name), frame.toPNG(scale));
  console.log('wrote', name);
};

const C = {
  label: '#d8d8d8', clock: '#cccccc', amber: '#ffb000', dimAmber: '#9c6a00', grey: '#8f8f8f',
  tickerHead: '#a6a6a6', index: '#1f2f35', white: '#ffffff', red: '#ff2020',
  yellow: '#ffd800', orange: '#ff8000', divider: '#333333',
};
const LINE = { RD: '#c60c30', BL: '#00a1de', GR: '#009b3a', BR: '#62361b', PR: '#522398', YL: '#f9e300', PK: '#e27ea6', OR: '#f9461c' };
const dim = (c, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
const s = (cp) => String.fromCodePoint(cp);

// ---- glyph sheets ----

function sheet(fontName, lineHeight, baselineOffset, extra, chars) {
  const lines = [];
  if (chars) lines.push(chars);
  else for (let c = 32; c < 127; c += 24) lines.push(Array.from({ length: Math.min(24, 127 - c) }, (_, i) => String.fromCharCode(c + i)).join(' '));
  if (extra) lines.push(extra);
  const width = Math.max(...lines.map((l) => measure(fontName, l))) + 4;
  const f = new Frame(width, lines.length * lineHeight + 2);
  lines.forEach((l, i) => f.text(fontName, l, 2, 1 + i * lineHeight + baselineOffset, C.label));
  return f;
}

save('sheet-small.png', sheet('small', 8, 6, `${s(G.BOLT)} ${s(G.FUNNEL)} ${s(G.ALERT_DISC)} ${s(G.ALERT_MARK)}`), 8);
save('sheet-5x7.png', sheet('5x7', 10, 7, `${s(G.TT)} ${s(G.MIN)} Cottage ${ligatures('Cottage')}`), 8);
save('sheet-clock.png', sheet('clock', 17, 13, '12:34', '0123456789'), 8);

// ---- mock panels ----

// Right-align text so its last pixel is at column `right`.
const rtext = (f, font, str, right, base, color) => f.text(font, str, right - measure(font, str) + 1, base, color);

// Transit: header on, weather off -> 4 rows, pitch 6, rows start at 7.
{
  const f = new Frame();
  f.text('small', 'MORSE', 1, 6, C.grey);
  rtext(f, 'small', '9:41', 62, 6, C.clock);
  const rows = [
    ['RD', 'HOWARD', ['DUE', '8', '15']],
    ['RD', '95TH', ['3', '11', '19']],
    ['BL', 'JEFF PK', ['6', '14', '']],
    ['GR', 'COTTAGE', ['12', '27', '']],
  ];
  rows.forEach(([ln, label, times], i) => {
    const top = 8 + i * 6;
    const base = top + 5;
    f.fill(0, top, 3, 5, LINE[ln]);
    f.text('small', label, 5, base, C.label);
    const right = [43, 53, 63];
    times.forEach((t, k) => { if (t) rtext(f, 'small', t, right[k], base, k === 0 ? C.amber : C.dimAmber); });
  });
  save('mock-transit.png', f, 10);
}

// Ticker: two 12px rows with a 1px gap, 5px index column, 55% row fill.
{
  const f = new Frame();
  f.text('small', 'MORSE', 1, 6, C.tickerHead);
  rtext(f, 'small', '9:41', 62, 6, C.clock);
  const rows = [
    { ln: 'RD', dest: 'Howard', min: '4', idx: '1', alert: false },
    { ln: 'GR', dest: 'Cottage', min: '12', idx: '2', alert: true },
  ];
  rows.forEach((r, i) => {
    const top = 7 + i * 13; // rows 7-18 and 20-31
    f.fill(0, top, 5, 12, C.index);
    f.fill(5, top, 59, 12, dim(LINE[r.ln], 0.55));
    if (r.alert) {
      f.text('small', s(G.ALERT_DISC), 0, top + 9, C.red);
      f.text('small', s(G.ALERT_MARK), 0, top + 9, C.white);
    } else {
      f.text('small', r.idx, 1, top + 9, C.label);
    }
    const base = top + 9;
    f.text('5x7', ligatures(r.dest), 7, base, C.white);
    const minW = measure('5x7', s(G.MIN));
    f.text('5x7', s(G.MIN), 62 - minW + 1, base, C.white);
    rtext(f, '5x7', r.min, 62 - minW - 2, base, C.white);
  });
  save('mock-ticker.png', f, 10);
}

// Overnight clock with the weather-row warning tags underneath.
{
  const f = new Frame();
  const clock = '12:34';
  const w = measure('clock', clock);
  f.text('clock', clock, Math.floor((64 - w) / 2), 13, C.clock);
  const nt = 'NO TRAINS';
  f.text('small', nt, Math.floor((64 - measure('small', nt)) / 2), 20, dim(C.label, 0.5));
  f.fill(0, 22, 64, 1, C.divider);
  const x = f.text('small', s(G.BOLT), 1, 30, C.yellow) + 1; // advance includes 1px; +1 = 2px gap
  f.text('small', 'WATCH', x, 30, C.yellow);
  save('mock-overnight.png', f, 10);
}

// Warning tags and the ticker alert circle, larger.
{
  const f = new Frame(48, 20);
  const tags = [[G.BOLT, 'WATCH', C.yellow], [G.BOLT, 'WARNING', C.orange], [G.FUNNEL, 'WARNING', C.red]];
  tags.forEach(([icon, word, color], i) => {
    const x = f.text('small', s(icon), 1, 6 + i * 6, color) + 1;
    f.text('small', word, x, 6 + i * 6, color);
  });
  f.fill(42, 1, 5, 12, C.index);
  f.text('small', s(G.ALERT_DISC), 42, 10, C.red);
  f.text('small', s(G.ALERT_MARK), 42, 10, C.white);
  save('mock-icons.png', f, 16);
}
