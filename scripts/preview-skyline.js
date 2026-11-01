#!/usr/bin/env node
'use strict';
// Skyline clock face previews: the server's parameters (skyline.js) drawn by
// the reference renderer (draw.js renderSkyline), as the board will show them.
//
//   node scripts/preview-skyline.js
//
// Writes docs/board/previews/skyline-states.png (every weather kind by day and
// by night), skyline-dusk.png (Oct 31, 2026, 5:00-6:50 PM, clear) and
// skyline-motion.png (boats, rain, lightning over time).

const fs = require('fs');
const path = require('path');
const { render } = require('../server/board/render');
const { toSkyline } = require('../server/board/skyline');
const { sheet } = require('./mock-weather-lake');

const OUT = path.join(__dirname, '..', 'docs', 'board', 'previews');
const PLACE = { lat: 41.8917, lon: -87.590 };
const at = (iso) => Date.parse(iso) / 1000;
const DAY = at('2026-10-31T19:15:00Z'), NIGHT = at('2026-11-01T02:42:00Z');

function frame(w, now, { ms, warn = null, temp = 52, blink = false } = {}) {
  const skyline = toSkyline({ temp, ...w }, { ...PLACE, now, temp });
  const p = { now, screen: 'clock', bright: 100, warn, skyline };
  return render(p, { screen: 'clock', now, ms: ms != null ? ms : now * 1000 + 300, blink });
}
const label = (now) => new Date((now - 5 * 3600) * 1000).toISOString().slice(11, 16);

const KINDS = [
  ['CLEAR', { code: 0, clouds: 5 }], ['PARTLY', { code: 2, clouds: 35 }], ['MOSTLY', { code: 3, clouds: 70 }], ['OVERCAST', { code: 3, clouds: 95 }],
  ['RAIN', { code: 63, clouds: 100 }], ['SNOW', { code: 73, clouds: 100 }], ['FOG', { code: 45, clouds: 100 }], ['STORM', { code: 95, clouds: 100 }],
];

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  const states = [];
  for (const [name, w] of KINDS) {
    states.push([`${name}  DAY`, frame(w, DAY, { temp: name === 'SNOW' ? 28 : 52 })]);
    states.push([`${name}  NIGHT`, frame(w, NIGHT, { temp: name === 'SNOW' ? 26 : 48, ms: name === 'STORM' ? stormPeak(NIGHT) : undefined })]);
  }
  states.push(['TORNADO WARNING', frame({ code: 95, clouds: 100 }, NIGHT, { warn: { kind: 'tor', lvl: 'warning' } })]);
  states.push(['SEVERE TSTORM WATCH', frame({ code: 2, clouds: 40 }, DAY, { warn: { kind: 'svr', lvl: 'watch' } })]);
  fs.writeFileSync(path.join(OUT, 'skyline-states.png'), sheet(states, 2, 6));

  const dusk = [];
  for (let m = 0; m <= 110; m += 10) { const t = at('2026-10-31T22:00:00Z') + m * 60; dusk.push([label(t), frame({ code: 0, clouds: 5 }, t)]); }
  fs.writeFileSync(path.join(OUT, 'skyline-dusk.png'), sheet(dusk, 3, 6));

  const q = at('2026-10-31T19:00:00Z');            // 2:00 PM: the sailboat's quarter; 2:15 the speedboat's
  const motion = [
    ['SAIL 2:00:20', frame({ code: 0, clouds: 5 }, q, { ms: (q + 20) * 1000 })],
    ['SAIL 2:00:40', frame({ code: 0, clouds: 5 }, q, { ms: (q + 40) * 1000 })],
    ['SPEED OUT 2:15:05', frame({ code: 0, clouds: 5 }, q + 900, { ms: (q + 905) * 1000 })],
    ['SPEED BACK 2:15:24', frame({ code: 0, clouds: 5 }, q + 900, { ms: (q + 924) * 1000 })],
    ['RAIN +0 S', frame({ code: 63, clouds: 100 }, DAY, { ms: DAY * 1000 })],
    ['RAIN +1 S', frame({ code: 63, clouds: 100 }, DAY, { ms: DAY * 1000 + 1000 })],
  ];
  const sp = stormPeak(NIGHT);
  for (const dt of [-200, 300, 600, 1500]) motion.push([`STRIKE ${(dt / 1000 + 0.6).toFixed(1)} S`, frame({ code: 95, clouds: 100 }, NIGHT, { ms: sp + dt })]);
  fs.writeFileSync(path.join(OUT, 'skyline-motion.png'), sheet(motion, 2, 6));
  console.log('wrote skyline-states.png, skyline-dusk.png, skyline-motion.png to', path.relative(process.cwd(), OUT));
}

// A moment 0.6 s into a lightning strike near `now` (its peak).
function stormPeak(now) {
  const { strikeLevel } = require('../server/board/render');
  for (let ms = now * 1000; ms < now * 1000 + 60000; ms += 100) if (strikeLevel(ms) >= 0.99) return ms;
  return now * 1000;
}
