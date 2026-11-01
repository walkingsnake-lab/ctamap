'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toSkyline, weatherKind, clearSky, mixSky, sample, KEYS } = require('./skyline');

const PLACE = { lat: 41.8917, lon: -87.590 };
const at = (iso) => Date.parse(iso) / 1000;
// Oct 31, 2026 (CDT, UTC-5): sunset about 5:44 PM.
const AFTERNOON = at('2026-10-31T19:15:00Z');   // 2:15 PM, sun ~29°
const SUNSET = at('2026-10-31T22:40:00Z');      // 5:40 PM, sun ~0.2°
const DUSK = at('2026-10-31T23:00:00Z');        // 6:00 PM, sun ~-3.4°
const NIGHT = at('2026-11-01T01:00:00Z');       // 8:00 PM, sun ~-23°
const MORNING = at('2026-10-31T12:30:00Z');     // 7:30 AM, sun ~2° in the east
const sky = (w, now, extra = {}) => toSkyline({ temp: 52, clouds: 0, code: 0, ...w }, { ...PLACE, now, temp: 52, ...extra });

test('weather codes and cloud cover pick the kind', () => {
  assert.deepEqual(weatherKind(0, 10), { kind: 'clear', lvl: 0 });
  assert.deepEqual(weatherKind(1, 35), { kind: 'partly', lvl: 0 });
  assert.deepEqual(weatherKind(2, 70), { kind: 'mostly', lvl: 0 });
  assert.deepEqual(weatherKind(3, 95), { kind: 'overcast', lvl: 0 });
  assert.equal(weatherKind(0, 86).kind, 'overcast', 'cloud cover wins over codes 0-3');
  assert.equal(weatherKind(3, null).kind, 'overcast', 'no cloud cover: code 3 is overcast');
  assert.equal(weatherKind(2, undefined).kind, 'partly');
  assert.deepEqual(weatherKind(63, 100), { kind: 'rain', lvl: 2 });
  assert.deepEqual(weatherKind(82, 100), { kind: 'rain', lvl: 3 });
  assert.deepEqual(weatherKind(56, 100), { kind: 'rain', lvl: 1 }, 'freezing drizzle draws as rain');
  assert.deepEqual(weatherKind(75, 100), { kind: 'snow', lvl: 3 });
  assert.deepEqual(weatherKind(48, 100), { kind: 'fog', lvl: 0 });
  assert.equal(weatherKind(95, 100).kind, 'storm');
  assert.equal(weatherKind(99, 100).kind, 'storm');
});

test('sky keyframes: exact at each keyframe, held beyond the ends', () => {
  for (const k of KEYS) assert.deepEqual(clearSky(k.el).sky, k.sky);
  assert.deepEqual(clearSky(40).sky, KEYS[0].sky);
  assert.deepEqual(clearSky(-30).sky, KEYS[KEYS.length - 1].sky);
});

test('mixing skies is exact on the union of their stop rows', () => {
  const a = [[0, '#000000'], [25, '#646464']], b = [[0, '#c8c8c8'], [10, '#000000'], [25, '#c8c8c8']];
  const m = mixSky(a, b, 0.5);
  assert.deepEqual(m.map(([y]) => y), [0, 10, 25]);
  assert.equal(sample(m, 0), '#646464');
  assert.equal(sample(m, 10), '#141414');      // a: 40 at row 10, b: 0 -> 20
  assert.equal(sample(m, 25), '#969696');
});

test('the sky blends continuously through dusk (no jumps between minutes)', () => {
  let prev = null;
  for (let t = at('2026-10-31T21:30:00Z'); t <= at('2026-10-31T23:50:00Z'); t += 60) {
    const s = sky({}, t);
    if (prev) {
      for (const y of [0, 12, 25]) {
        const a = sample(prev.sky, y), b = sample(s.sky, y);
        const d = [1, 3, 5].reduce((m, i) => Math.max(m, Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))), 0);
        assert.ok(d <= 12, `row ${y} jumped ${d} at ${new Date(t * 1000).toISOString()}`);
      }
      assert.ok(s.win >= prev.win, 'windows only switch on as it darkens');
    }
    prev = s;
  }
});

test('afternoon: sun at the day spot, glints under it, white wheel, lights off, boats out', () => {
  const s = sky({}, AFTERNOON);
  assert.equal(s.st, 'clear');
  assert.deepEqual([s.sun.x, s.sun.y], [41, 5]);
  assert.deepEqual(s.gl, { x: 41, c: '#c8d8f0', p: 0 });
  assert.equal(s.whl, 0);
  assert.equal(s.lit, 0);
  assert.equal(s.win, 0);
  assert.equal(s.stars, 0);
  assert.equal(s.moon, null);
  assert.equal(s.boats, 1);
  assert.equal(s.temp, 52);
});

test('sunset: the sun sits low at its bearing on the sun scale, with the glitter path', () => {
  const s = sky({}, SUNSET);
  // Bearing ~250° -> x = 32 + (250 - 270) * 0.8 = 16; elevation ~0.2° -> row ~21.
  assert.ok(s.sun.x >= 14 && s.sun.x <= 18, `x ${s.sun.x}`);
  assert.ok(s.sun.y >= 20 && s.sun.y <= 21, `y ${s.sun.y}`);
  assert.equal(s.gl.x, s.sun.x);
  assert.ok(s.gl.p > 50, `glitter ${s.gl.p}`);
  assert.equal(s.lit, 1, 'the wheel lights at dusk');
});

test('dusk: windows coming on, a few stars not yet, sun gone', () => {
  const s = sky({}, DUSK);
  assert.equal(s.sun, null);
  assert.ok(s.win > 30 && s.win < 100, `win ${s.win}`);
  assert.equal(s.stars, 0);
  assert.equal(s.boats, 0, 'no boats after sunset');
});

test('night: every window, all stars, the moon at its phase', () => {
  const s = sky({}, NIGHT);
  assert.equal(s.win, 100);
  assert.equal(s.stars, 14);
  assert.ok(s.moon && s.moon.fr >= 3);
  assert.equal(s.gl.x, 41);
  assert.equal(s.lit, 1);
});

test('morning: no sun at sunrise (it rises behind the viewer)', () => {
  const s = sky({}, MORNING);
  assert.equal(s.sun, null);
  assert.equal(s.gl, null);
});

test('overcast, rain and snow hide the sun, moon and stars; precipitation by intensity', () => {
  for (const code of [3, 63, 73, 95]) {
    for (const t of [AFTERNOON, NIGHT]) {
      const s = sky({ code, clouds: 100 }, t);
      assert.equal(s.sun, null); assert.equal(s.moon, null); assert.equal(s.stars, 0);
    }
  }
  assert.deepEqual(sky({ code: 61, clouds: 100 }, AFTERNOON).pcp, { k: 'r', n: 8 });
  assert.deepEqual(sky({ code: 65, clouds: 100 }, AFTERNOON).pcp, { k: 'r', n: 26 });
  assert.deepEqual(sky({ code: 73, clouds: 100 }, AFTERNOON).pcp, { k: 's', n: 12 });
  assert.equal(sky({ code: 3, clouds: 100 }, AFTERNOON).pcp, null);
  const storm = sky({ code: 95, clouds: 100 }, NIGHT);
  assert.equal(storm.storm, 1);
  assert.deepEqual(storm.pcp, { k: 'r', n: 16 });
});

test('snow puts snow on the roofs (grey at night); fog sends its color and a dark wheel', () => {
  assert.equal(sky({ code: 73, clouds: 100 }, AFTERNOON).roof, '#c8ced8');
  assert.equal(sky({ code: 73, clouds: 100 }, NIGHT).roof, '#5a5260');
  assert.equal(sky({ code: 0 }, AFTERNOON).roof, null);
  const fog = sky({ code: 45, clouds: 100 }, AFTERNOON);
  assert.equal(fog.fog, '#747a82');
  assert.equal(fog.whl, 2);
  assert.equal(sky({ code: 0 }, AFTERNOON).fog, null);
});

test('boats: daytime, dry, not foggy, 40°F or warmer', () => {
  assert.equal(sky({ code: 3, clouds: 100 }, AFTERNOON).boats, 1, 'overcast is fine');
  assert.equal(sky({ code: 61, clouds: 100 }, AFTERNOON).boats, 0, 'rain');
  assert.equal(sky({ code: 45, clouds: 100 }, AFTERNOON).boats, 0, 'fog');
  assert.equal(sky({ code: 71, clouds: 100 }, AFTERNOON).boats, 0, 'snow');
  assert.equal(sky({ temp: 39 }, AFTERNOON).boats, 0, 'cold');
  assert.equal(sky({ temp: 40 }, AFTERNOON).boats, 1);
  assert.equal(sky({}, NIGHT).boats, 0, 'night');
});

test('temperature is passed through rounded, in the board unit', () => {
  assert.equal(sky({}, AFTERNOON, { temp: 11.6 }).temp, 12);
  assert.equal(sky({}, AFTERNOON, { temp: null }).temp, null);
});
