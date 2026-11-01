#!/usr/bin/env node
'use strict';
// Skyline clock face: the time and temperature on one line in the top left (`2:15  52°`), in every
// weather state, to compare with the text over the water.
//
//   node scripts/mock-skyline-topleft.js
//
// Writes docs/board/mockups/weather/lake/topleft.png (each state, WHITE and AUTO) and topleft-dim.png
// (the grey and busy skies, WHITE and DIM).
//   WHITE  lit white text; clouds, stars and rain are cleared from a box around the text, fading
//          out over 3 px (the old "Lit, top" idea), so the text always sits on plain sky.
//   AUTO   the same cleared box, and the text turns unlit (black) where the sky behind it is
//          bright (average luma above 120), as the old Auto mode did.
//   DIM    the same cleared box, and where the sky there is brighter than luma 60 it is dimmed
//          toward that (fading with the box), so white text keeps its contrast on grey skies.
// The widest line (`12:59  100°`, 35 px) ends at x 34: clear of the sun and moon (x 38-44) and of
// every rooftop (St. Regis, the tallest, tops out on row 6; the text is rows 1-5).

const fs = require('fs');
const path = require('path');
const { Frame } = require('../server/board/raster');
const { measure } = require('../server/board/fonts');
const L = require('./mock-weather-lake');
const { W, H, mix, rgb } = L;

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'weather', 'lake');
const GAP = 4;                                        // px between the time and the temperature
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// Box to clear: the text's ink (rows 1-5, x 0..w-1) plus 1 px, fading over 3 px beyond that.
function clearWeight(x, y, w) {
  const dx = Math.max(0, x - w), dy = Math.max(0, y - 6);
  const d = Math.max(dx, dy);
  return d === 0 ? 1 : d >= 4 ? 0 : 1 - d / 4;
}

function frameFor(key, mode, clock, temp) {
  const st = L.STATES.find((s) => s[0] === key)[2];
  const base = { ...st, temp: '', clock: '' };
  const full = new Frame(); L.scene(full, base);
  // Plain sky behind the text: same scene without clouds, wisps, stars or rain.
  const plain = new Frame(); L.scene(plain, { ...base, clouds: undefined, stars: 0, after: undefined, mid: key === 'partly-cloudy-night' ? undefined : base.mid });
  const w = measure('small', clock) + GAP + measure('small', temp);
  const f = new Frame();
  let sum = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = clearWeight(x, y, w);
    let c = k ? rgb(mix(L.hex(full.get(x, y)), L.hex(plain.get(x, y)), k)) : full.get(x, y);
    if (mode === 'dim' && k && L.getRole()[y][x] === null) { const l = lum(c); if (l > 60) { const m = 1 - k * (1 - 60 / l); c = c.map((v) => v * m); } }
    f.set(x, y, c);
    if (y >= 1 && y <= 5 && x < w) { sum += lum(c); n++; }
  }
  const ink = mode === 'auto' && sum / n > 120 ? '#000000' : '#d8d8d8';
  f.text('small', clock, 0, 6, ink);
  f.text('small', temp, measure('small', clock) + GAP, 6, ink);
  return f;
}

function main() {
  Object.assign(L.OPT, { text: 'bottom', clock: true, reflect: false });   // full-height antennas, stars anywhere
  L.setTick(0);
  L.buildSkyline();
  const cells = [];
  for (const [key, title, st] of L.STATES) {
    cells.push([`${title}  WHITE`, frameFor(key, 'white', st.clock, st.temp)]);
    cells.push([`${title}  AUTO`, frameFor(key, 'auto', st.clock, st.temp)]);
  }
  fs.writeFileSync(path.join(OUT, 'topleft.png'), L.sheet(cells.concat([['WIDEST  WHITE', frameFor('clear-night', 'white', '12:59', '100°')], ['WIDEST  AUTO', frameFor('clear-day', 'auto', '12:59', '-12°')]]), 2, 6));
  const dim = [];
  for (const key of ['overcast', 'snow', 'fog', 'rain', 'mostly-cloudy', 'sunset']) {
    const [, title, st] = L.STATES.find((s) => s[0] === key);
    dim.push([`${title}  WHITE`, frameFor(key, 'white', st.clock, st.temp)], [`${title}  DIM`, frameFor(key, 'dim', st.clock, st.temp)]);
  }
  fs.writeFileSync(path.join(OUT, 'topleft-dim.png'), L.sheet(dim, 2, 6));
  console.log('wrote topleft.png, topleft-dim.png to', path.relative(process.cwd(), OUT));
}
if (require.main === module) main();
module.exports = { frameFor };
