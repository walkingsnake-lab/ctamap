#!/usr/bin/env node
'use strict';
// Skyline and clock faces on a 128x32 panel. The skyline is the real
// renderer: draw.js's skyline code patched at load time to 128 columns, with
// the 64-wide scene shifted right and new buildings either side (or open
// lake for the big-clock layout). The clock faces are drawn here. Not in
// draw.js; nothing in server/board changes.
//   node scripts/mock-128-clocks.js   -> docs/board/mockups/w128/clock-*.png, sky-*.png

const fs = require('fs');
const os = require('os');
const path = require('path');
const B = path.join(__dirname, '..', 'server', 'board');
const { Frame } = require(path.join(B, 'raster'));
const { packFonts } = require(path.join(B, 'fonts'));
const icons = require(path.join(B, 'icons'));
const { WORLD, WORLD_PALETTE } = require(path.join(B, 'world'));
const glyphs = require(path.join(B, 'glyphs'));
const { TZ } = require(path.join(B, 'time'));
const draw = require(path.join(B, 'render'));
const { build } = require(path.join(__dirname, '..', 'firmware', 'tests', 'scenarios'));

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'w128');
const F = packFonts();
const W = 128, H = 32;

// ---------- draw.js patched to a 128-wide skyline ----------
// New buildings, x in 128 columns: [x, width, rows, role] (1 background mass, 2 tower with windows).
const PANORAMA = {
  off: 32,
  extra: [
    // South: Grant Park's streetwall and the South Loop towers (left of Willis).
    [0, 5, 6, 1], [5, 4, 8, 1], [10, 3, 5, 1], [13, 5, 7, 1], [18, 4, 9, 1], [22, 3, 6, 1], [25, 4, 8, 1], [29, 3, 6, 1],
    [2, 3, 11, 2], [7, 3, 16, 2], [14, 3, 13, 2], [20, 4, 10, 2], [26, 3, 12, 2],
    // North: Gold Coast, Palmolive to the Lake Shore Drive high-rises stepping down to the beach.
    [96, 4, 8, 1], [100, 5, 7, 1], [106, 4, 9, 1], [111, 4, 6, 1], [116, 5, 5, 1], [122, 6, 3, 1],
    [99, 4, 12, 2], [100, 2, 14, 2], [104, 4, 15, 2], [109, 3, 13, 2], [113, 3, 10, 2], [117, 3, 8, 2], [121, 2, 6, 2],
  ],
  ants: [[8, 19, 16, 0], [101, 18, 14, 1]], // [x, top rows, roof rows, beacon]: a spire, Palmolive's beacon
};
const OPEN_LAKE = { off: 0, extra: [[64, 3, 4, 1], [67, 3, 2, 1]], ants: [], noText: true };

function patchedDraw(cfg) {
  let src = fs.readFileSync(path.join(B, 'draw.js'), 'utf8');
  const lines = src.split('\n');
  const find = (re, from = 0) => { for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i; throw new Error(`no ${re}`); };
  const s0 = find(/^ {4}const SKY = \(\(\) => \{/), s1 = find(/^ {4}\}\)\(\);/, s0);
  const sky = `    const SKY = (() => {
      const CFG = globalThis.__SKYCFG, O = CFG.off;
      const W = 128, SHORE = 25, CX = 32 + O, CY = 17, R = 6, SPREAD = 5;
      const role = new Uint8Array(W * 32);
      const rect = (x, w, t, r) => { for (let y = Math.max(0, t); y <= SHORE; y++) for (let i = x; i < x + w; i++) if (i >= 0 && i < W) role[y * W + i] = r; };
      const top = (rows) => SHORE + 1 - rows;
      [[0, 4, 7], [8, 3, 9], [19, 3, 8], [22, 3, 10], [28, 3, 7], [36, 3, 6], [39, 4, 9], [43, 3, 11], [46, 4, 8], [50, 3, 10], [57, 4, 9], [61, 3, 7]]
        .forEach(([x, w, h]) => rect(x + O, w, top(h), 1));
      for (const [x, w, h, r] of CFG.extra) if (r === 1) rect(x, w, top(h), 1);
      for (const [x, w, h, r] of CFG.extra) if (r === 2) rect(x, w, top(h), 2);
      rect(1 + O, 1, top(9), 2); rect(2 + O, 4, top(15), 2); rect(6 + O, 2, top(13), 2); rect(8 + O, 2, top(9), 2);
      rect(11 + O, 4, top(17), 2);
      rect(15 + O, 5, top(21), 2);
      rect(23 + O, 5, top(10), 2); rect(24 + O, 4, top(13), 2); rect(24 + O, 3, top(16), 2);
      rect(29 + O, 7, top(15), 2); rect(30 + O, 5, top(17), 2);
      { const t = top(17), steps = [4, 6, 8];
        for (let y = t; y <= SHORE; y++) { const w = steps[Math.min(2, Math.floor((y - t) * 3 / (SHORE - t + 1)))]; for (let i = 53 + O - w / 2; i < 53 + O + w / 2; i++) role[y * W + i] = 2; } }
      const isB = (x, y) => x >= 0 && x < W && y >= 0 && y <= SHORE && role[y * W + x] !== 0;
      const ants = [[2 + O, top(18), top(15), 0], [4 + O, top(17), top(15), 0], [51 + O, top(22), top(17), 1], [54 + O, top(22), top(17), 1],
        ...CFG.ants.map(([x, t, roof, b]) => [x, top(t), top(roof), b])];
      const wins = [];
      for (let y = 1; y <= SHORE; y++) for (let x = 0; x < W; x++) {
        const r = role[y * W + x];
        if (!r || (r === 1 && x < 38 + O) || (x >= 19 + O && x <= 44 + O && y >= SHORE - 6)) continue;
        const dx = x + 0.5 - CX, dy = y + 0.5 - CY;
        if (dx * dx + dy * dy < 49 || x % 2 !== 0 || y % 2 !== 1 || !isB(x, y - 1)) continue;
        wins.push([x, y, ih(x, y, 5) % 1000, ih(x, y, 9) % 10 < 3]);
      }
      const stars = [];
      for (let i = 0; stars.length < 28 && i < 2000; i++) {
        const x = ih(i, 1, 3) % W, y = ih(i, 2, 3) % 14;
        const dx = x + 0.5 - CX, dy = y + 0.5 - CY;
        if (isB(x, y) || (x > 35 + O && x < 49 + O && y < 11) || (x >= 50 + O && x <= 55 + O && y < 10) || dx * dx + dy * dy < 90.25 || stars.some((s) => s[0] === x && s[1] === y)) continue;
        if (CFG.noText && x > 66 && y > 1 && y < 14) continue;
        stars.push([x, y, ih(i, 3, 3) % 10 < 3, ih(i, 4, 3) % 2 === 1, ih(i, 5, 3) % 1000, [4000, 6000, 12000][stars.length % 3]]);
      }
${lines.slice(find(/const seg = \(ax, ay, bx, by, px, py\) =>/, s0), s1).join('\n')}
    })();
    const OFF = globalThis.__SKYCFG.off;`;
  lines.splice(s0, s1 - s0 + 1, ...sky.split('\n'));
  src = lines.join('\n');
  const rep = (a, b, all = false) => {
    if (!src.includes(a)) throw new Error(`patch target missing: ${a}`);
    src = all ? src.split(a).join(b) : src.replace(a, b);
  };
  rep('const BOLT = [[21, 0], [21, 1], [20, 2], [21, 3], [22, 3], [23, 3], [23, 4], [24, 5], [23, 6], [24, 7], [25, 7], [25, 8], [25, 9]];',
    'const BOLT = [[21, 0], [21, 1], [20, 2], [21, 3], [22, 3], [23, 3], [23, 4], [24, 5], [23, 6], [24, 7], [25, 7], [25, 8], [25, 9]].map(([x, y]) => [x + OFF, y]);');
  rep('const BOLT_BRANCH = [[20, 1], [19, 2], [18, 3], [18, 4], [17, 5]];', 'const BOLT_BRANCH = [[20, 1], [19, 2], [18, 3], [18, 4], [17, 5]].map(([x, y]) => [x + OFF, y]);');
  rep('X >= 64 || SKY.isB(X, Y)', 'X >= 128 || SKY.isB(X, Y)');
  // boatAt .. end of renderSkyline: every 64 is the panel width.
  const a = src.indexOf('    function boatAt(ms) {'), b = src.indexOf('    function applyBrightness(f, bright) {');
  let mid = src.slice(a, b).replace(/\b64\b/g, '128');
  const mrep = (x, y) => { if (!mid.includes(x)) throw new Error(`patch target missing: ${x}`); mid = mid.split(x).join(y); };
  mrep('63 - cw', '127 - cw');
  mrep('step > 70', 'step > 134');
  mrep('span = 87', 'span = 151');
  mrep('skyDisc(f, 41, 5,', 'skyDisc(f, 41 + OFF, 5,');
  mrep('skyDisc(f, s.sun.x, s.sun.y', 'skyDisc(f, s.sun.x + OFF, s.sun.y');
  mrep('x + 0.5 - 22) / 11', 'x + 0.5 - 22 - OFF) / 11');
  mrep('f.fill(24, S, 16', 'f.fill(24 + OFF, S, 16');
  mrep('f.fill(24, S + 1, 16', 'f.fill(24 + OFF, S + 1, 16');
  mrep('let x = 24; x <= 39;', 'let x = 24 + OFF; x <= 39 + OFF;');
  mrep('x + 0.5 - s.gl.x', 'x + 0.5 - s.gl.x - OFF');
  mrep('i < s.pcp.n;', 'i < s.pcp.n * 2;');
  mrep('Math.min(s.stars || 0, SKY.stars.length)', 'Math.min((s.stars || 0) * 2, SKY.stars.length)');
  mrep('const f = newFrame();\n      const S = SKY.SHORE', 'const f = new Frame(128, 32, fonts);\n      const S = SKY.SHORE');
  mrep("f.text('small', clock, 128 - cw, 32, C.label);", "if (!globalThis.__SKYCFG.noText) f.text('small', clock, 128 - cw, 32, C.label);");
  src = src.slice(0, a) + mid + src.slice(b);
  const file = path.join(os.tmpdir(), `draw-sky128-${cfg.off}-${process.pid}.js`);
  fs.writeFileSync(file, src);
  globalThis.__SKYCFG = cfg;
  const d = require(file).create({ fonts: F, icons: { ICONS: icons.ICONS, PALETTE: icons.PALETTE, ALERT_BANG: icons.ALERT_BANG, OWL: icons.OWL, WORLD, WORLD_PALETTE }, glyphs, tz: TZ });
  fs.unlinkSync(file);
  return d;
}

// ---------- helpers ----------
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const measure = (font, s) => { let w = 0; for (const ch of s) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; } return w > 0 ? w - 1 : 0; };
const rtext = (f, font, s, x1, base, col) => f.text(font, s, x1 - measure(font, s) + 1, base, col);
const ctext = (f, font, s, cx, base, col) => f.text(font, s, Math.round(cx - (measure(font, s) - 1) / 2), base, col);
const icon = (f, name, x, y) => icons.ICONS[name].forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') f.set(x + i, y + j, hex(icons.PALETTE[c])); }));
const toFrame128 = (fr) => { const f = new Frame(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < fr.w; x++) f.set(x, y, fr.get(x, y)); return f; };
function blit(f, src, x0, w = 64) { for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) f.set(x0 + x, y, src.get(x, y)); }

// ---------- clock faces ----------
// Seventies: the three stripes run along the bottom, turn up, and turn again
// along the top to the right edge; time on the left, date and temp under the top run.
function seventies() {
  const f = new Frame(W, H);
  const COLS = ['#ffc23a', '#ff7414', '#d2361a'], R = [3, 6, 9];
  const cx1 = 60, cy1 = 21, cx2 = 72, cy2 = 10;
  R.forEach((r, i) => {
    const c = hex(COLS[i]), r2 = 12 - r;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let on = false;
      if (x < cx1 && (y === cy1 + r - 1 || y === cy1 + r)) on = true;                       // bottom run
      if (y <= cy1 && y >= cy2 && (x === cx1 + r - 1 || x === cx1 + r)) on = true;           // the climb
      if (x >= cx2 && (y === cy2 - r2 - 1 || y === cy2 - r2)) on = true;                      // top run
      if (x >= cx1 && y > cy1) { const u = 2 * (x - cx1) + 1, v = 2 * (y - cy1) + 1, d = u * u + v * v; if (d > (2 * r - 2) ** 2 && d <= (2 * r + 2) ** 2) on = true; }
      if (x < cx2 && y < cy2) { const u = 2 * (x - cx2) + 1, v = 2 * (y - cy2) + 1, d = u * u + v * v; if (d > (2 * r2) ** 2 && d <= (2 * r2 + 4) ** 2 && x >= cx1 - 1) on = true; }
      if (on) f.set(x, y, c);
    }
  });
  const band = (y) => COLS[y < 9 ? 0 : y < 12 ? 1 : 2];
  const t = new Frame(W, H);
  const tw = measure('vcr', '9:42');
  t.text('vcr', '9:42', Math.floor((cx1 - 2 - tw) / 2), 16, '#ffffff');
  for (let y = 0; y < H; y++) for (let x = 0; x < cx1 - 1; x++) if (t.get(x, y)[0]) f.set(x, y, hex(band(y)));
  f.text('5x7', 'TUE', 78, 20, COLS[0]);
  f.text('5x7', 'NOV 3', 78, 29, COLS[1]);
  rtext(f, '5x7', '54°', 127, 29, COLS[2]);
  return f;
}

// Word clock: every word on the grid, the ones that tell the time lit.
function wordClock() {
  const f = new Frame(W, H);
  const rows = ['IT IS HALF TEN QUARTER TWENTY', 'FIVE MINUTES TO PAST ONE TWO', 'THREE FOUR FIVE SIX SEVEN', 'EIGHT NINE TEN ELEVEN TWELVE', "O'CLOCK  IN THE EVENING"];
  // 9:42 PM, rounded to 9:40: IT IS TWENTY MINUTES TO TEN IN THE EVENING.
  const lit = [[0, 'IT'], [0, 'IS'], [0, 'TWENTY'], [1, 'MINUTES'], [1, 'TO'], [3, 'TEN'], [4, 'IN'], [4, 'THE'], [4, 'EVENING']];
  rows.forEach((row, j) => {
    const base = 6 + j * 6, x0 = Math.round((W - measure('small', row)) / 2);
    let x = x0;
    for (const word of row.split(/( +)/)) {
      if (!word.trim()) { x += measure('small', word) + 1; continue; }
      const on = lit.some(([r, w]) => r === j && w === word);
      x = f.text('small', word, x, base, on ? '#ffb000' : '#2a2a2a');
    }
  });
  return f;
}

// Analog face (real 64-wide render) with this month's calendar beside it.
function calendarPanel(f) {
  const x0 = 37, colW = 13;
  // November 2026 starts on a Sunday, the day the analog face shows. Five
  // week rows at a 6px pitch fill the height, so there's no weekday header.
  for (let d = 1; d <= 30; d++) {
    const i = d - 1, col = i % 7, row = Math.floor(i / 7);
    const cx = x0 + col * colW + 6, base = 6 + row * 6;
    const today = d === 1;
    if (today) f.fill(cx - 5, base - 6, 11, 7, '#664600');
    const str = String(d);
    ctext(f, 'small', str, cx, base, today ? '#ffffff' : col === 0 || col === 6 ? '#6a6a6a' : '#b8b8b8');
  }
}

// Day/night map (real 64-wide render) with the sun's times and other cities' clocks.
function sunPanel(f) {
  const x0 = 67;
  const lines = [['SUNRISE', '6:25 AM', '#ffc23a'], ['SUNSET', '4:40 PM', '#ff7414'], ['NEW YORK', '10:42 PM', '#cccccc'], ['LONDON', '3:42 AM', '#cccccc'], ['TOKYO', '12:42 PM', '#cccccc']];
  lines.forEach(([l, v, c], i) => { const base = 6 + i * 6; f.text('small', l, x0, base, '#666666'); rtext(f, 'small', v, 127, base, c); });
}

async function main() {
  const S = await build();
  const sc = (name) => { const s = S.find((x) => x.name === name); if (!s) throw new Error(`no scenario ${name}`); return s; };
  const clouds = (s) => (s.clouds ? Object.fromEntries(Object.entries(s.clouds).map(([k, v]) => [k, Uint8Array.from(v)])) : undefined);
  const real64 = (name) => { const s = sc(name); return draw.render(s.payload, { ...s.renders[0].opts, clouds: clouds(s) }); };

  const pano = patchedDraw(PANORAMA);
  const sky = (d, name, extra = {}) => { const s = sc(name); return d.render(s.payload, { ...s.renders[0].opts, clouds: clouds(s), ...extra }); };
  const panoramas = [
    ['sky-day', 'Panorama, partly cloudy day', 'skyline partly day'],
    ['sky-dusk', 'Panorama, dusk', 'skyline dusk +40 min'],
    ['sky-night', 'Panorama, clear night', 'skyline clear night'],
    ['sky-snow', 'Panorama, snowy night', 'skyline snow night'],
  ].map(([id, title, name]) => [id, title, sky(pano, name)]);

  const lake = patchedDraw(OPEN_LAKE);
  const big = sky(lake, 'skyline dusk +20 min');
  rtext(big, 'clock', '5:20', 125, 14, '#f4f0ec');
  rtext(big, 'small', 'SAT OCT 31', 127, 32, '#d8d8d8');

  // The face only (columns 0-33); the calendar replaces the date text.
  const analog = new Frame(W, H); blit(analog, real64('analog 9:42:37 PM'), 0, 34); calendarPanel(analog);
  const dn = new Frame(W, H); blit(dn, real64('daynight evening'), 0); sunPanel(dn);

  const P = Object.fromEntries(panoramas.map(([id, title, f]) => [id, { id, title, f }]));
  const MOCKS = [
    { kind: 'skyline', ...P['sky-day'], desc: 'The real skyline renderer at 128: the 64 scene in the middle, the South Loop added on the left and the Gold Coast stepping down to the lake on the right. Clouds, sun, windows and ripples come from the same payload.', note: '' },
    { kind: 'skyline', ...P['sky-dusk'], desc: 'Dusk: the sun sets behind the Loop as the windows come on.', note: '' },
    { kind: 'skyline', ...P['sky-night'], desc: 'Clear night: twice the stars, the pier lit, the wheel cycling color.', note: '' },
    { kind: 'skyline', ...P['sky-snow'], desc: 'Snow on every roof, flakes across the whole width.', note: '' },
    { kind: 'skyline', id: 'sky-bigclock', title: 'Skyline with a big clock', f: big, desc: 'The 64 scene kept at the left; the right half is open lake and sky, with the clock in the big digits.', note: 'Keeps the existing art; only the sky and water get wider.' },
    { kind: 'clock', id: 'clock-seventies', title: 'Seventies swoosh', f: seventies(), desc: 'The stripes run along the bottom, climb, and run along the top to the right edge. Time on the left, date and temperature under the top run.', note: '' },
    { kind: 'clock', id: 'clock-analog', title: 'Analog + calendar', f: analog, desc: 'The analog face as it is, with the month beside it and today highlighted.', note: 'The calendar replaces the face\'s date and temperature; five week rows fill the height, so there\'s no weekday header.' },
    { kind: 'clock', id: 'clock-daynight', title: 'Day/night + sun times', f: dn, desc: 'The world map as it is, with sunrise and sunset and the time in three other cities.', note: 'A wider map needs a new world mask, and at 128 × 26 it can\'t keep its proportions and still show the southern hemisphere.' },
    { kind: 'clock', id: 'clock-words', title: 'Word clock', f: wordClock(), desc: 'Every word stays faintly on the grid; the ones that tell the time light up. 9:42 PM reads TWENTY MINUTES TO TEN.', note: 'A new face rather than a widened one. Rounds to five minutes.' },
  ];
  for (const m of MOCKS) if (m.f.w !== W) m.f = toFrame128(m.f);

  const q5 = (v) => v & 0xf8;
  fs.mkdirSync(OUT, { recursive: true });
  for (const m of MOCKS) {
    const q = new Frame(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) q.set(x, y, m.f.get(x, y).map(q5));
    fs.writeFileSync(path.join(OUT, `${m.id}.png`), q.toPNG(10));
  }
  const GAP = 4, TH = 8, COLS = 2;
  const sheet = new Frame(COLS * W + (COLS + 1) * GAP, Math.ceil(MOCKS.length / COLS) * (TH + H + GAP) + GAP);
  MOCKS.forEach((m, i) => {
    const ox = GAP + (i % COLS) * (W + GAP), oy = GAP + Math.floor(i / COLS) * (TH + H + GAP);
    sheet.text('small', m.title.toUpperCase(), ox, oy + 5, '#5a5a5a');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sheet.set(ox + x, oy + TH + y, m.f.get(x, y).map(q5));
  });
  fs.writeFileSync(path.join(OUT, 'clocks-sheet.png'), sheet.toPNG(5));
  fs.writeFileSync(path.join(OUT, 'clocks.json'), JSON.stringify(MOCKS.map(({ kind, id, title, desc, note }) => ({ kind, id, title, desc, note })), null, 1));
  console.log('wrote docs/board/mockups/w128/ clocks');
}
main().catch((e) => { console.error(e); process.exit(1); });
