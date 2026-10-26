#!/usr/bin/env node
'use strict';
// The knob chooser (design spec §10, "Knob"), drawn by draw.js's
// renderChooser through one twist and rest, plus a few other moments.
// Made-up moment at Morse. Colors cut to the panel's 5 bits per channel.
//   node scripts/mock-knob.js   -> docs/board/mockups/knob/sheet.png

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const draw = require('../server/board/render');
const { normalize, format } = require('../server/board/arrivals');
const { parseCtaTime, tzOffset } = require('../server/board/time');

const B = path.join(__dirname, '..', 'server', 'board');
const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'knob');
const json = JSON.parse(fs.readFileSync(path.join(B, 'fixtures', 'tt-arrivals', 'morse-2026-10-03-2316.json'), 'utf8'));
const now = parseCtaTime(json.ctatt.tmst);
const r = format(normalize(json, { log: { warn() {}, error() {} } }), { rows: [], showHeader: true, showWeather: true, showKey: false }, { now, alerts: new Set() });
const knob = { ring: ['auto', 'transit', 'weather', 'sports'], at: 1 };
const p = {
  v: 1, now, tzo: tzOffset(now), screen: 'transit', bright: 100, header: 'MORSE', view: r.view, rows: r.rows, ticker: r.ticker,
  wx: { icon: 'pcloudy_day', temp: 54, word: 'PT CLOUDY' }, warn: null, knob,
  radar: { on: false, frames: [], ft: [], timeBox: [0, 0, 0, 0], split: false, wx: { icon: 'pcloudy_day', temp: 54, word: 'PT CLOUDY', hi: 61, lo: 47, feels: 51, wind: 'NW 12', pop: 20 } },
};
const ch = (pos, commit) => ['chooser', { chooser: commit ? { pos, commit } : { pos } }];
const ROWS = [
  ['ONE CLICK RIGHT, THEN REST', [
    ['TRANSIT', ['transit', {}]], ['SLIDING', ch(1.55)], ['WEATHER', ch(2)], ['COMMIT (1 S)', ch(2, true)], ['WEATHER SCREEN', ['weather', {}]],
  ]],
  ['OTHER MOMENTS', [
    ['LEFT TO AUTO', ch(0)], ['AROUND TO SPORTS', ch(-1)], ['BACK TO TRANSIT', ch(1)], ['= CANCEL', ['transit', {}]],
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
  panels.forEach(([label, [screen, o]], j) => {
    const f = draw.render(p, { screen, ...o });
    const ox = GAP + j * (PW + GAP);
    sheet.text('small', label, ox, oy + 5, '#5a5a5a');
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) sheet.set(ox + x, oy + TH + y, f.get(x, y).map(q5));
  });
  oy += TH + PH + GAP;
}
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(6));
console.log(`wrote ${path.relative(process.cwd(), path.join(OUT, 'sheet.png'))}`);
