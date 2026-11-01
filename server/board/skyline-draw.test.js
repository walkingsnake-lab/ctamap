'use strict';
// The skyline clock face as draw.js renders it (design spec §14).
const test = require('node:test');
const assert = require('node:assert/strict');
const { render, SKY, boatAt, strikeLevel, clockText } = require('./render');
const { toSkyline } = require('./skyline');
const { measure } = require('./fonts');

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const PLACE = { lat: 41.8917, lon: -87.590 };
const at = (iso) => Date.parse(iso) / 1000;
const DAY = at('2026-10-31T19:05:00Z');     // 2:05 PM: no boat (the 2:00 sailboat is past)
const NIGHT = at('2026-11-01T02:42:00Z');   // 9:42 PM
function draw(w, now, { ms, warn = null, temp = 52, blink = false, sky } = {}) {
  const skyline = sky !== undefined ? sky : toSkyline({ temp, code: 0, clouds: 5, ...w }, { ...PLACE, now, temp });
  return render({ now, screen: 'clock', bright: 100, warn, skyline }, { screen: 'clock', now, ms: ms != null ? ms : now * 1000, blink });
}
const px = (f, x, y) => hex(f.get(x, y));

test('buildings stay black by day and night, apart from windows, roof snow and fog', () => {
  for (const f of [draw({}, DAY), draw({}, NIGHT)]) {
    for (let y = 0; y <= SKY.SHORE; y++) for (let x = 0; x < 64; x++) {
      if (!SKY.role[y * 64 + x]) continue;
      const c = px(f, x, y);
      const win = SKY.wins.some(([wx, wy]) => wx === x && wy === y);
      const wheel = SKY.legs.some(([a, b]) => a === x && b === y) || SKY.rim.some(([a, b]) => a === x && b === y)
        || (y === SKY.bar[1] && x >= SKY.bar[0] && x < SKY.bar[0] + SKY.bar[2]) || (x >= 31 && x <= 32 && y >= 16 && y <= 17) || (y === SKY.SHORE && x >= 24 && x <= 39);
      const beacon = (x === 51 || x === 54) && y === 4;
      if (!win && !wheel && !beacon) assert.equal(c, '#000000', `building pixel ${x},${y} lit ${c}`);
    }
  }
});

test('the sky row colors follow the payload stops', () => {
  const sky = { ...toSkyline({ temp: 52, code: 0, clouds: 5 }, { ...PLACE, now: DAY, temp: 52 }), sun: null, gl: null, sky: [[0, '#000000'], [25, '#646464']] };
  const f = draw({}, DAY, { sky });
  assert.equal(px(f, 40, 0), '#000000');
  assert.equal(px(f, 40, 5), '#141414');   // 100 * 5/25 = 20
  assert.equal(px(f, 40, 10), '#282828');
});

test('text: temperature bottom left, clock flush right, row 26 left as water', () => {
  const f = draw({}, DAY);
  const cw = measure('small', clockText(DAY));
  let lit = 0;
  for (let y = 27; y <= 31; y++) for (let x = 0; x < measure('small', '52°'); x++) if (px(f, x, y) === '#d8d8d8') lit++;
  assert.ok(lit > 10, 'temperature drawn');
  lit = 0;
  for (let y = 27; y <= 31; y++) for (let x = 64 - cw; x < 64; x++) if (px(f, x, y) === '#d8d8d8') lit++;
  assert.ok(lit > 10, 'clock drawn');
  for (let x = 0; x < 64; x++) assert.notEqual(px(f, x, 26), '#d8d8d8', `no text on row 26 (x ${x})`);
});

test('a watch or warning replaces the temperature; a tornado warning blinks', () => {
  const tor = { kind: 'tor', lvl: 'warning' };
  const on = draw({ code: 95, clouds: 100 }, NIGHT, { warn: tor });
  const off = draw({ code: 95, clouds: 100 }, NIGHT, { warn: tor, blink: true });
  const reds = (f) => { let n = 0; for (let y = 27; y <= 31; y++) for (let x = 0; x < 40; x++) if (px(f, x, y) === '#ff2020') n++; return n; };
  assert.ok(reds(on) > 20);
  assert.equal(reds(off), 0);
  const watch = draw({}, DAY, { warn: { kind: 'svr', lvl: 'watch' } });
  let yellow = 0, white = 0;
  for (let y = 27; y <= 31; y++) for (let x = 0; x < 36; x++) { const c = px(watch, x, y); if (c === '#ffd800') yellow++; if (c === '#d8d8d8') white++; }
  assert.ok(yellow > 20);
  assert.equal(white, 0, 'no temperature under the watch label');
});

test('ripples and glints stay off the text and its 1 px margin', () => {
  for (let ms = DAY * 1000; ms < DAY * 1000 + 6000; ms += 200) {
    const f = draw({}, DAY, { ms });
    for (let y = 27; y <= 31; y++) {
      const lw = measure('small', '52°');
      // x == lw is the margin column: only the plain water gradient there.
      const a = px(f, lw, y), b = px(f, 63 - measure('small', clockText(DAY)), y);
      for (const c of [a, b]) assert.ok(!['#1a3a68', '#c8d8f0'].includes(c), `ripple or glint in the margin at row ${y}: ${c}`);
    }
  }
});

test('night: windows lit to the payload level, beacons pulse but never go dark, the wheel turns smoothly', () => {
  const f = draw({}, NIGHT);
  const lit = SKY.wins.filter(([x, y]) => px(f, x, y) !== '#000000').length;
  assert.ok(lit > SKY.wins.length * 0.3 && lit < SKY.wins.length * 0.6, `${lit} of ${SKY.wins.length} windows`);
  const beacon = (ms) => draw({}, NIGHT, { ms }).get(51, 4);
  for (let ms = 0; ms < 4000; ms += 250) assert.ok(beacon(NIGHT * 1000 + ms)[0] >= 0x40, 'beacon stays at least dark red');
  const rim = SKY.rim.map(([x, y]) => px(f, x, y));
  assert.ok(new Set(rim).size > 8, 'rainbow around the rim');
  // Smooth: one turn every 30 s is 12 degrees of hue a second, which moves a
  // channel at most 255 * 0.9 * 0.7 / 60 * 12 (about 32) levels; a jump past
  // that would mean the rim stepped rather than turned.
  const g = draw({}, NIGHT, { ms: NIGHT * 1000 + 1000 });
  let moved = 0;
  for (const [x, y] of SKY.rim) {
    const d = Math.max(...f.get(x, y).map((v, i) => Math.abs(v - g.get(x, y)[i])));
    assert.ok(d <= 33, `rim ${x},${y} jumped ${d} in a second`);
    if (d > 0) moved++;
  }
  assert.ok(moved > SKY.rim.length / 2, 'noticeably turning: most of the rim changes within a second');
});

test('windows switch on in a fixed order (the lit set only grows)', () => {
  const sky = toSkyline({ temp: 52, code: 0, clouds: 5 }, { ...PLACE, now: NIGHT, temp: 52 });
  let prev = new Set();
  for (const win of [0, 20, 40, 60, 80, 100]) {
    const f = draw({}, NIGHT, { sky: { ...sky, win } });
    const on = new Set(SKY.wins.filter(([x, y]) => px(f, x, y) !== '#000000').map(([x, y]) => `${x},${y}`));
    for (const k of prev) assert.ok(on.has(k), `window ${k} went dark at win ${win}`);
    prev = on;
  }
  const dark = draw({}, NIGHT, { sky: { ...sky, win: 0 } });
  assert.equal(SKY.wins.filter(([x, y]) => px(dark, x, y) !== '#000000').length, 0, 'win 0: every window dark');
});

test('boats: the sailboat on :00 and :30, the speedboat out and back on :15 and :45', () => {
  const q = at('2026-10-31T19:00:00Z') * 1000;
  assert.deepEqual(boatAt(q), { kind: 'sail', x0: 64, dir: -1 });
  assert.deepEqual(boatAt(q + 8000), { kind: 'sail', x0: 54, dir: -1 });
  assert.equal(boatAt(q + 57000), null, 'across and gone in under a minute');
  assert.deepEqual(boatAt(q + 30 * 60000 + 800), { kind: 'sail', x0: -5, dir: 1 });
  const s = q + 15 * 60000;
  assert.deepEqual(boatAt(s + 1500), { kind: 'speed', x0: 54, dir: -1 });
  assert.equal(boatAt(s + 15000), null, 'turning around off the panel');
  assert.deepEqual(boatAt(s + 13050 + 4000 + 1500), { kind: 'speed', x0: -4, dir: 1 });
  assert.equal(boatAt(s + 40000), null);
  assert.equal(boatAt(q + 5 * 60000), null);
  // Drawn only when the payload allows boats.
  const sky = toSkyline({ temp: 52, code: 0, clouds: 5 }, { ...PLACE, now: q / 1000, temp: 52 });
  const hull = (f) => { let n = 0; for (let x = 0; x < 64; x++) if (px(f, x, 25) === '#8a4a24') n++; return n; };
  assert.equal(hull(draw({}, q / 1000, { ms: q + 20000, sky })), 6);
  assert.equal(hull(draw({}, q / 1000, { ms: q + 20000, sky: { ...sky, boats: 0 } })), 0);
});

test('lightning: soft, about every 20-40 s, rising over 0.6 s and fading by 3 s', () => {
  const t0 = NIGHT * 1000;
  const starts = [];
  let prev = 0;
  for (let ms = t0; ms < t0 + 5 * 60000; ms += 100) {
    const lv = strikeLevel(ms);
    assert.ok(lv >= 0 && lv <= 1);
    if (lv > 0 && prev === 0) starts.push(ms);
    prev = lv;
  }
  for (let i = 1; i < starts.length; i++) {
    const gap = (starts[i] - starts[i - 1]) / 1000;
    assert.ok(gap >= 20 && gap <= 40, `gap ${gap} s`);
  }
  // Drawn only in a storm.
  const peak = starts[0] + 600;
  const sum = (f) => { let n = 0; for (let y = 0; y < 10; y++) for (let x = 12; x < 32; x++) if (!SKY.role[y * 64 + x]) n += f.get(x, y).reduce((a, b) => a + b, 0); return n; };
  const storm = toSkyline({ temp: 52, code: 95, clouds: 100 }, { ...PLACE, now: NIGHT, temp: 52 });
  assert.ok(sum(draw({}, NIGHT, { ms: peak, sky: storm })) > sum(draw({}, NIGHT, { ms: starts[0] - 1000, sky: storm })) * 1.2);
  const calm = { ...storm, storm: 0, pcp: null };
  assert.equal(sum(draw({}, NIGHT, { ms: peak, sky: calm })), sum(draw({}, NIGHT, { ms: starts[0] - 1000, sky: calm })));
});

test('rain falls 1 px every 200 ms, staying above the water', () => {
  const sky = toSkyline({ temp: 52, code: 63, clouds: 100 }, { ...PLACE, now: DAY, temp: 52 });
  const a = draw({}, DAY, { ms: DAY * 1000, sky }), b = draw({}, DAY, { ms: DAY * 1000 + 200, sky });
  let diff = 0;
  for (let y = 0; y <= 25; y++) for (let x = 0; x < 64; x++) if (px(a, x, y) !== px(b, x, y)) diff++;
  assert.ok(diff > 0, 'streaks moved');
  for (let y = 26; y < 32; y++) for (let x = 0; x < 64; x++) assert.notEqual(px(a, x, y), '#5a7aaa');
});

test('rain glides along its own line: straight down or 45° with the wind, sub-pixel between steps', () => {
  const base = toSkyline({ temp: 52, code: 63, clouds: 100 }, { ...PLACE, now: DAY, temp: 52 });
  const t0 = DAY * 1000;                                   // a multiple of 200 ms
  for (const sl of [0, 1, -1]) {
    for (let i = 0; i < 6; i++) {
      // One drop at a time (n: 1 draws drop 0; seed the clock so drops differ).
      const sky = { ...base, sun: null, gl: null, boats: 0, pcp: { k: 'r', n: 1, sl } };
      const drop = (ms) => {
        const a = draw({}, DAY, { ms, sky }), b = draw({}, DAY, { ms, sky: { ...sky, pcp: null } });
        const out = [];
        for (let y = 0; y <= 25; y++) for (let x = 0; x < 64; x++) if (px(a, x, y) !== px(b, x, y)) out.push([x, y]);
        return out;
      };
      const t = t0 + i * 5000;
      const f0 = drop(t), half = drop(t + 100), f1 = drop(t + 200);
      for (const pxs of [f0, half, f1]) {
        const key = ([x, y]) => (sl === 0 ? x : ((x - sl * y) % 64 + 64) % 64);
        assert.equal(new Set(pxs.map(key)).size <= 1, true, `sl ${sl}: pixels off the line ${JSON.stringify(pxs)}`);
      }
      assert.notDeepEqual(JSON.stringify(half), JSON.stringify(f0) + 'x');
      // A full step later the head has moved one pixel along the line.
      if (f0.length >= 2 && f1.length >= 2) {
        const head = (pxs) => pxs.reduce((m, p) => (p[1] > m[1] ? p : m));
        const [h0, h1] = [head(f0), head(f1)];
        if (h1[1] > h0[1]) assert.deepEqual([((h1[0] - h0[0]) % 64 + 64) % 64, h1[1] - h0[1]], [(sl + 64) % 64, 1]);
      }
    }
  }
  // Sub-pixel: halfway between steps the streak differs from both ends.
  const sky = { ...base, sun: null, gl: null, boats: 0 };
  const a = draw({}, DAY, { ms: t0, sky }), h = draw({}, DAY, { ms: t0 + 100, sky }), b = draw({}, DAY, { ms: t0 + 200, sky });
  assert.notDeepEqual([...h.px], [...a.px]); assert.notDeepEqual([...h.px], [...b.px]);
});

test('motion settings: a still wheel, still ripples, steady stars; rain speed', () => {
  const night = toSkyline({ temp: 52, code: 0, clouds: 0 }, { ...PLACE, now: NIGHT, temp: 52 });
  const rim = (sky, ms) => SKY.rim.map(([x, y]) => px(draw({}, NIGHT, { ms, sky }), x, y)).join();
  const t = NIGHT * 1000;
  assert.equal(rim({ ...night, wheel: 0 }, t), rim({ ...night, wheel: 0 }, t + 7000), 'wheel off: still');
  assert.notEqual(rim({ ...night, wheel: 15000 }, t), rim({ ...night, wheel: 15000 }, t + 1000));
  const water = (sky, ms) => { const f = draw({}, NIGHT, { ms, sky }); const o = []; for (let y = 27; y < 32; y++) for (let x = 20; x < 40; x++) o.push(px(f, x, y)); return o.join(); };
  assert.equal(water({ ...night, rip: 0, gl: null }, t), water({ ...night, rip: 0, gl: null }, t + 3000), 'ripples off: still');
  assert.notEqual(water({ ...night, rip: 250, gl: null }, t), water({ ...night, rip: 250, gl: null }, t + 125));
  const stars = (sky, ms) => { const f = draw({}, NIGHT, { ms, sky }); return SKY.stars.map(([x, y]) => px(f, x, y)).join(); };
  assert.equal(stars({ ...night, twk: 0 }, t), stars({ ...night, twk: 0 }, t + 1700), 'twinkle off: steady');
  assert.notEqual(stars(night, t), stars(night, t + 1700));
  // Rain at 400 ms a pixel is halfway at 200 ms where the default is a full step on.
  const rain = toSkyline({ temp: 52, code: 63, clouds: 100 }, { ...PLACE, now: DAY, temp: 52 });
  const r = (fall, ms) => {
    const sky = { ...rain, sun: null, gl: null, boats: 0, fall }, a = draw({}, DAY, { ms, sky }), b = draw({}, DAY, { ms, sky: { ...sky, pcp: null } });
    const out = [];
    for (let y = 0; y <= 25; y++) for (let x = 0; x < 64; x++) if (px(a, x, y) !== px(b, x, y)) out.push(`${x},${y}`);
    return out.join(' ');
  };
  assert.equal(r(400, DAY * 1000 + 200), r(200, DAY * 1000 + 100));
  assert.notEqual(r(100, DAY * 1000 + 100), r(200, DAY * 1000 + 100));
});

test('no weather yet: a plain night with the clock', () => {
  const f = draw({}, NIGHT, { sky: null });
  assert.equal(px(f, 40, 0), '#000006');
  let lit = 0;
  for (let y = 27; y <= 31; y++) for (let x = 40; x < 64; x++) if (px(f, x, y) === '#d8d8d8') lit++;
  assert.ok(lit > 10);
});

test('clouds: drawn from the strip once it is on hand, scrolling 1 px every 4 s, behind the buildings', () => {
  const { stripBytes } = require('./clouds');
  const sky = toSkyline({ temp: 52, code: 3, clouds: 95 }, { ...PLACE, now: DAY, temp: 52 });
  const clouds = { [sky.cl.id]: stripBytes(sky.cl.id) };
  const without = draw({}, DAY, { sky });
  const a = draw({}, DAY, { sky, ms: DAY * 1000 }), b = render({ now: DAY, screen: 'clock', bright: 100, skyline: sky }, { screen: 'clock', now: DAY, ms: DAY * 1000, clouds });
  assert.deepEqual([...a.px], [...without.px], 'no strip yet: plain sky');
  let changed = 0;
  for (let y = 0; y <= 25; y++) for (let x = 0; x < 64; x++) if (px(a, x, y) !== px(b, x, y)) { changed++; assert.equal(SKY.role[y * 64 + x], 0, 'clouds stay behind the buildings'); }
  assert.ok(changed > 300, `deck drawn (${changed} px)`);
  const later = (ms) => render({ now: DAY, screen: 'clock', bright: 100, skyline: sky }, { screen: 'clock', now: DAY, ms, clouds });
  const t0 = Math.floor(DAY / 4) * 4000;
  assert.deepEqual([...later(t0).px], [...later(t0 + 3999).px].length ? [...later(t0).px] : [], 'still for 4 s');
  // After 4 s, column x shows what column x+1 showed (on an open sky row).
  const c0 = later(t0), c1 = later(t0 + 4000);
  for (let x = 0; x < 20; x++) if (!SKY.role[2 * 64 + x] && !SKY.role[2 * 64 + x + 1]) assert.equal(px(c1, x, 2), px(c0, x + 1, 2));
});

test('cloud drift: still when off, 1 px per step otherwise', () => {
  const { stripBytes } = require('./clouds');
  const base = toSkyline({ temp: 52, code: 2, clouds: 40 }, { ...PLACE, now: DAY, temp: 52 });
  const clouds = { [base.cl.id]: stripBytes(base.cl.id) };
  const at = (step, ms) => render({ now: DAY, screen: 'clock', bright: 100, skyline: { ...base, sun: null, gl: null, boats: 0, cl: { ...base.cl, step } } }, { screen: 'clock', now: DAY, ms, clouds });
  const t0 = Math.floor(DAY / 64) * 64000;
  const sky = (f) => { const out = []; for (let y = 0; y <= 16; y++) for (let x = 0; x < 64; x++) if (!SKY.role[y * 64 + x]) out.push(px(f, x, y)); return out.join(); };
  assert.equal(sky(at(0, t0)), sky(at(0, t0 + 10 * 60000)), 'off: the clouds never move');
  assert.equal(sky(at(16000, t0)), sky(at(16000, t0 + 15999)), 'slow: still for 16 s');
  assert.notEqual(sky(at(16000, t0)), sky(at(16000, t0 + 16000)), 'slow: then a pixel');
  assert.notEqual(sky(at(4000, t0)), sky(at(4000, t0 + 4000)), 'normal: a pixel every 4 s');
});
