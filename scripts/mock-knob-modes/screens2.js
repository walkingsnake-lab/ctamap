'use strict';
// Round 2 screens: the ring from the phone redesign (Transit, Weather, Clock,
// Announce, Cycle), each variant rendered by the real renderer.
const fs = require('fs');
const path = require('path');
const { Frame } = require('../../server/board/raster');
const base1 = require('./screens');
const { draw, now } = base1;
const { toSkyline } = require('../../server/board/skyline');
const { subsolar } = require('../../server/board/sun');
const B = path.join(__dirname, '..', '..', 'server', 'board');

const byName = Object.fromEntries(base1.FLAT.map((e) => [`${e.cat}/${e.sub}`, e.frame]));
const wx = { icon: 'pcloudy_night', temp: 54, word: 'PT CLOUDY', hi: 61, lo: 47, feels: 51, wind: 'NW 12', pop: 20 };

// Radar: Morse's water mask and shoreline, a made-up band of rain west of the station.
const loc = JSON.parse(fs.readFileSync(path.join(B, 'locations', '40100.json'), 'utf8'));
const bit = (rows, x, y) => rows && rows[y] ? (BigInt('0x' + rows[y]) >> BigInt(63 - x)) & 1n : 0n;
const bytes = new Uint8Array(64 * 32);
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
  const water = bit(loc.water, x, y) === 1n, shore = bit(loc.shore, x, y) === 1n;
  if (shore) { bytes[y * 64 + x] = 6; continue; }
  if (water) continue;
  const d = Math.abs((x - 4) + (y - 16) * 0.55 - 6) + rnd() * 5;
  const lv = d < 2 ? 4 : d < 4 ? 3 : d < 7 ? 2 : d < 10 ? 1 : 0;
  if (lv && rnd() > 0.08) bytes[y * 64 + x] = lv;
}
bytes[16 * 64 + 31] = 7;
const radarFrame = draw.render({ ...{ v: 1, now, tzo: -18000, bright: 100, warn: null },
  radar: { on: true, frames: ['a'], ft: [now - 240], timeBox: loc.timeBox, split: loc.split, wx } }, { screen: 'weather', now, frames: { a: bytes } });

// Cycle: the phone's two-arrow symbol, anti-aliased at 90% of its 32-unit viewBox, cyan.
function cycleFrame() {
  const f = new Frame(), cy = [0x3f, 0xd0, 0xe8], S = 0.9, X0 = 32 - 16 * S, Y0 = 16 - 16 * S;
  const tri = (p, a, b, c) => { const s = (u, v, w) => (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]); const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  const arc = (p, a0, a1) => { const dx = p[0] - 16, dy = p[1] - 16; let a = Math.atan2(dy, dx) * 180 / Math.PI; if (a < 0) a += 360;
    const on = a0 <= a1 ? a >= a0 && a <= a1 : a >= a0 || a <= a1; const r = Math.hypot(dx, dy);
    if (on) return Math.abs(r - 10) <= 1.25;
    const ends = [a0, a1].map((t) => [16 + 10 * Math.cos(t * Math.PI / 180), 16 + 10 * Math.sin(t * Math.PI / 180)]);
    return ends.some((e) => Math.hypot(p[0] - e[0], p[1] - e[1]) <= 1.25); };
  const inside = (p) => arc(p, 180, 301.3) || arc(p, 0, 121.3) || tri(p, [18.52, 10.08], [25.01, 11.36], [23.89, 4.84]) || tri(p, [13.48, 21.92], [6.99, 20.64], [8.11, 27.16]);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    let n = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const px = x + (i + 0.5) / 4, py = y + (j + 0.5) / 4; if (inside([(px - X0) / S, (py - Y0) / S])) n++; }
    if (n) f.set(x, y, cy.map((v) => Math.round(v * n / 16)));
  }
  return f;
}

const CATS = ['TRANSIT', 'WEATHER', 'CLOCK', 'ANNOUNCE', 'CYCLE'];
const L = [
  ['TRANSIT', 'ROWS', byName['TRANSIT/ROWS']], ['TRANSIT', 'TICKER', byName['TRANSIT/TICKER']],
  ['WEATHER', 'CONDITIONS', byName['WEATHER/NOW']], ['WEATHER', '5-DAY', byName['WEATHER/5-DAY']], ['WEATHER', 'HOURLY', byName['WEATHER/HOURLY']], ['WEATHER', 'RADAR', radarFrame],
  ['CLOCK', 'SKYLINE', byName['CLOCK/SKYLINE']], ['CLOCK', 'SEVENTIES', byName['CLOCK/70S']], ['CLOCK', 'ANALOG', byName['CLOCK/ANALOG']], ['CLOCK', 'DAY/NIGHT', byName['CLOCK/DAY/NIGHT']], ['CLOCK', 'GRADIENT', byName['CLOCK/GRADIENT']],
  ['ANNOUNCE', null, byName['ANNOUNCE/null']],
  ['CYCLE', null, cycleFrame()],
];
const FLAT = L.map(([cat, sub, frame]) => ({ ci: CATS.indexOf(cat), cat, sub, frame }));
module.exports = { draw, CATS, FLAT };
