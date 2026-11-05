#!/usr/bin/env node
'use strict';
// The control page's picker tiles and screen thumbnails: one 64x32 render per
// option (Rows, Ticker, the two transit layouts, each weather view, each
// clock face), drawn by the reference renderer from fixed sample payloads
// (the parity scenarios in firmware/tests/scenarios.js), so a tile looks the
// same whatever the board is doing. Saved as PNGs (one pixel per LED; the page
// scales them up square) in server/board/control-tiles.json, served at
// `tiles.json`.
//
//   node scripts/build-control-tiles.js
//
// server/board/control-tiles.test.js fails when the saved tiles no longer
// match what the renderer draws: run this again after draw.js changes.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { build } = require('../firmware/tests/scenarios');
const B = path.join(__dirname, '..', 'server', 'board');
const draw = require(path.join(B, 'render'));
const { normalize, format } = require(path.join(B, 'arrivals'));
const { parseCtaTime, tzOffset } = require(path.join(B, 'time'));

const OUT = path.join(__dirname, '..', 'server', 'board', 'control-tiles.json');

// Transit tiles: Morse's recorded arrivals, no alerts (the scenarios mostly
// carry alerts, for testing).
const WX = { icon: 'pcloudy_day', temp: 63, word: 'PT CLOUDY', hi: 69, lo: 51 };
function transit(cfg) {
  const json = JSON.parse(fs.readFileSync(path.join(B, 'fixtures', 'tt-arrivals', 'morse-2026-10-03-2316.json'), 'utf8'));
  const now = parseCtaTime(json.ctatt.tmst);
  const r = format(normalize(json, { log: { warn() {}, error() {} } }), { rows: [], showHeader: true, showWeather: !cfg.key, showKey: !!cfg.key }, { now, alerts: new Set() });
  return { v: 1, now, tzo: tzOffset(now), screen: 'transit', bright: 100, header: 'MORSE', tickerHeader: 'MORSE', ...(r.bars.showKey ? { key: 1 } : {}),
    view: r.view, rows: r.rows, ticker: r.ticker, wx: r.bars.showWeather ? WX : null, warn: null, hclock: true };
}
const OWN = {
  rows: () => draw.render(transit({}), { screen: 'transit' }),
  ticker: () => draw.render(transit({}), { screen: 'ticker' }),
  'layout-header': () => draw.render(transit({}), { screen: 'transit' }),
  'layout-key': () => draw.render(transit({ key: true }), { screen: 'transit' }),
};

// Tile name -> [scenario name, render index].
const PICKS = {
  'wx-now': ['weather screen normal', 0],
  'wx-5day': ['weather 5-day normal', 0],
  'wx-hourly': ['weather hourly normal', 0],
  'wx-radar': ['radar 40100-202008102100', 0],
  'face-skyline': ['skyline clear night', 0],
  'face-seventies': ['seventies 9:42', 0],
  'face-analog': ['analog 9:42:37 PM', 0],
  'face-daynight': ['daynight evening', 0],
  'face-gradient': ['gradient 12:58 fills the width', 0],
  'face-digits': ['digits 9:42', 0],
  'face-daydate': ['daydate wednesday 10:07 AM', 0],
};

function png(px) {
  const rgb = Buffer.from(px, 'base64');
  const img = new PNG({ width: 64, height: 32 });
  for (let i = 0; i < 64 * 32; i++) {
    const [r, g, b] = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
    // Unlit LEDs as the page's previews draw them.
    const off = !r && !g && !b;
    img.data[i * 4] = off ? 13 : r;
    img.data[i * 4 + 1] = off ? 13 : g;
    img.data[i * 4 + 2] = off ? 13 : b;
    img.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(img, { colorType: 2 }).toString('base64');
}

async function tiles() {
  const scenarios = new Map((await build()).map((s) => [s.name, s]));
  const out = {};
  for (const [name, fn] of Object.entries(OWN)) out[name] = png(Buffer.from(fn().px).toString('base64'));
  for (const [name, [scenario, i]] of Object.entries(PICKS)) {
    const s = scenarios.get(scenario);
    if (!s || !s.renders || !s.renders[i]) throw new Error(`no scenario render "${scenario}" #${i} for tile ${name}`);
    out[name] = png(s.renders[i].px);
  }
  return out;
}

module.exports = { tiles, PICKS, OUT };

if (require.main === module) {
  tiles().then((t) => {
    fs.writeFileSync(OUT, JSON.stringify(t, null, 1) + '\n');
    console.log(`wrote ${Object.keys(t).length} tiles to ${path.relative(process.cwd(), OUT)}`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
