'use strict';
// Round 2 knob concepts: the icon bar (round 1's E) with three ways to pick
// the variant, plus the peek. Monochrome chrome, as on the phone; the cycle
// icon is the phone's cyan. Writes frames2.json for the page.
const fs = require('fs');
const { PNG } = require('pngjs');
const { Frame } = require('../../server/board/raster');
const { draw, CATS, FLAT } = require('./screens2');

const C = { on: '#d8d8d8', off: '#4a4a4a', dot: '#3a3a3a', grey: '#8f8f8f', cyan: '#3fd0e8', cyanOff: '#1a5660' };
const M = (font, s) => draw.measure(font, s);
const NC = CATS.length;
const variants = (ci) => FLAT.map((e, i) => i).filter((i) => FLAT[i].ci === ci);
const nameOf = (i) => FLAT[i].sub || FLAT[i].cat;
function ctext(f, font, s, cx, base, col) { const w = M(font, s), x = Math.round(cx - w / 2); f.text(font, s, x, base, col); return [x, x + w - 1]; }
function sprite(f, rows, x, y, col) { rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') f.fill(x + i, y + j, 1, 1, col); })); }

const ICONS = [
  ['.#####.', '#.....#', '#.....#', '#######', '##...##', '.#####.', '#.....#'],     // train front
  ['...#...', '.#...#.', '..###..', '#.###.#', '..###..', '.#...#.', '...#...'],     // sun
  ['..###..', '.#...#.', '#..#..#', '#..##.#', '#.....#', '.#...#.', '..###..'],     // clock
  ['#######', '#.....#', '#.###.#', '#.....#', '#######', '.##....', '.#.....'],     // speech bubble
  ['..###.#', '.#...##', '#...###', '#.....#', '###...#', '##...#.', '#.###..'],     // two arrows
];
const IX = (ci) => 4 + ci * 12;            // icon x; 5 icons, 7 wide, 5 apart: x 4..58
const ICON_Y = 23;
// The bar: icons rows 23-29, underline row 31. sel: lit icon; dimAll: every icon dim (scrubbing variants).
function bar(f, ci, { dimAll = false, others = true } = {}) {
  ICONS.forEach((ic, k) => {
    if (!others && k !== ci) return;
    const cyc = k === 4;
    const col = k === ci && !dimAll ? (cyc ? C.cyan : C.on) : cyc ? C.cyanOff : C.off;
    sprite(f, ic, IX(k), ICON_Y, col);
  });
  f.fill(IX(ci), 31, 7, 1, C.on);
}
// Horizontal variant dots (2x1, 2 apart), centered on cx.
function hdots(f, i, cx, row) {
  const v = variants(FLAT[i].ci); if (v.length < 2) return;
  let x = Math.round(cx - (v.length * 4 - 2) / 2);
  for (const k of v) { f.fill(x, row, 2, 1, k === i ? C.on : C.dot); x += 4; }
}
// Small scrub arrows either side of a name.
function arrows(f, x0, x1, base) {
  const mid = base - 4;
  [[1, 0], [3, 1], [5, 2]].forEach(([h, d]) => { f.fill(x0 - 7 + d, mid - (h - 1) / 2, 1, h, C.grey); f.fill(x1 + 7 - d, mid - (h - 1) / 2, 1, h, C.grey); });
}

// ---- H: icons + name; press steps the variant, hold-and-turn scrubs it ----
function H(i, mode) {           // mode: open | hold | commit
  const f = new Frame(), e = FLAT[i];
  bar(f, e.ci, { dimAll: mode === 'hold', others: mode !== 'commit' });
  const [x0, x1] = ctext(f, '5x7', nameOf(i), 32, 19, C.on);
  if (mode === 'hold') arrows(f, x0, x1, 19);
  if (mode !== 'commit') hdots(f, i, 32, 21);
  return f;
}

// ---- I: icons + category; rest on it to open its variants ----
function I1(ci, mode) {          // level 1: category
  const f = new Frame();
  bar(f, ci, { others: mode !== 'commit' });
  ctext(f, '5x7', CATS[ci], 32, 19, C.on);
  return f;
}
function I2(i, mode) {           // level 2: variants as a wheel above the lit icon
  const f = new Frame(), e = FLAT[i], v = variants(e.ci), k = v.indexOf(i);
  bar(f, e.ci, { others: false });
  const [x0, x1] = ctext(f, '5x7', nameOf(i), 32, 19, C.on);
  if (mode !== 'commit') {
    for (const d of [-1, 1]) {
      const j = k + d; if (j < 0 || j >= v.length) continue;
      const cx = 32 + d * 38, s = nameOf(v[j]);
      if (d < 0) f.withClip(0, 0, x0 - 4, 31, () => ctext(f, 'small', s, cx, 18, C.grey));
      else f.withClip(x1 + 4, 0, 63, 31, () => ctext(f, 'small', s, cx, 18, C.grey));
    }
    hdots(f, i, 32, 21);
  }
  return f;
}

// ---- J: peek. The band (rows 21-31) over the view: icons, underline, and
// vertical variant dots beside the lit icon. The page lays it over the screen.
function Jband(i) {
  const f = new Frame(), e = FLAT[i];
  bar(f, e.ci);
  const v = variants(e.ci);
  if (v.length > 1) {
    const x = IX(e.ci) + 8, top = 26 - (v.length - 1);
    v.forEach((k, n) => f.fill(x, top + n * 2, 1, 1, k === i ? C.on : C.dot));
  }
  return f;
}

const q5 = (v) => v & 0xf8;
function uri(f) {
  const png = new PNG({ width: 64, height: 32 });
  for (let k = 0, j = 0; k < 64 * 32; k++) { png.data[j++] = q5(f.px[k * 3]); png.data[j++] = q5(f.px[k * 3 + 1]); png.data[j++] = q5(f.px[k * 3 + 2]); png.data[j++] = 255; }
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}
const all = (fn, ...a) => FLAT.map((_, i) => uri(fn(i, ...a)));
const out = {
  entries: FLAT.map((e) => ({ ci: e.ci, cat: e.cat, sub: e.sub })), cats: CATS,
  screens: FLAT.map((e) => uri(e.frame)),
  H: { open: all(H, 'open'), hold: all(H, 'hold'), commit: all(H, 'commit') },
  I: { l1: CATS.map((_, c) => uri(I1(c, 'open'))), l1commit: CATS.map((_, c) => uri(I1(c, 'commit'))), l2: all(I2, 'open'), commit: all(I2, 'commit') },
  J: { band: all(Jband) },
};
fs.writeFileSync(process.argv[2], JSON.stringify(out));
if (process.argv[3]) {
  const picks = [[H(8, 'open'), H(8, 'hold'), H(8, 'commit')], [I1(2), I2(8, 'open'), I2(8, 'commit')], [Jband(8), Jband(3), Jband(12)]];
  const s = new Frame(3 * 68 + 4, 3 * 36 + 4);
  picks.forEach((row, r) => row.forEach((fr, c) => { for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) s.set(4 + c * 68 + x, 4 + r * 36 + y, fr.get(x, y)); }));
  fs.writeFileSync(process.argv[3], s.toPNG(6));
}
