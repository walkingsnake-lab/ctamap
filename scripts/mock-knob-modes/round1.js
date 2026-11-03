'use strict';
// Knob mode-switching concepts: renders every frame each concept needs and
// writes frames.json (1x PNG data URIs) for the comparison page.
const fs = require('fs');
const { PNG } = require('pngjs');
const { Frame } = require('../../server/board/raster');
const { draw, CATS, FLAT } = require('./screens');

const C = { label: '#d8d8d8', grey: '#8f8f8f', dim: '#555555', ind: '#3a3a3a', amber: '#ffb000', pipGroup: '#5a5a5a' };
const M = (font, s) => draw.measure(font, s);
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (a) => '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const lerp = (a, b, k) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * k));
const N = FLAT.length;
const entryName = (e) => e.sub || e.cat;
const catEntries = (ci) => FLAT.map((e, i) => [e, i]).filter(([e]) => e.ci === ci);
const firstOf = (ci) => FLAT.findIndex((e) => e.ci === ci);

// Text centered on x; returns [x0, x1].
function ctext(f, font, s, cx, base, col) { const w = M(font, s), x = Math.round(cx - w / 2); f.text(font, s, x, base, col); return [x, x + w - 1]; }
// Sideways wheel: selection big at center, neighbors small at +-38 px, clipped clear of the selection.
function wheel(f, names, pos, { base = 32, nbase = 31, commit = false, color = C.label }) {
  const n = names.length;
  const sel = names[pos];
  const [x0, x1] = ctext(f, '5x7', sel, 32, base, commit ? C.amber : color);
  if (commit) return;
  for (const d of [-2, -1, 1, 2]) {
    const s = names[((pos + d) % n + n) % n];
    const cx = 32 + d * 38, col = lerp(C.label, C.dim, Math.min(1, Math.abs(d) * 0.75));
    if (d < 0) f.withClip(0, 0, x0 - 4, 31, () => ctext(f, 'small', s, cx, nbase, col));
    else f.withClip(x1 + 4, 0, 63, 31, () => ctext(f, 'small', s, cx, nbase, col));
  }
}
// Pips: groups = sizes per category; pip w x 1; gap inside group gi, between groups gb.
function pips(f, groups, sel, row, { w = 2, gi = 1, gb = 3, hiGroup = true }) {
  const total = groups.reduce((s, g) => s + g * w + (g - 1) * gi, 0) + (groups.length - 1) * gb;
  let x = Math.round(32 - total / 2), k = 0;
  groups.forEach((g, gi_) => {
    const inSel = sel >= k && sel < k + g;
    for (let j = 0; j < g; j++, k++) { f.fill(x, row, w, 1, k === sel ? C.amber : inSel && hiGroup ? C.pipGroup : C.ind); x += w + (j < g - 1 ? gi : 0); }
    x += gb;
  });
}
const GROUPS = CATS.map((_, ci) => catEntries(ci).length);
const CATNAMES = ['AUTO', 'TRANSIT', 'WEATHER', 'SPORTS', 'CLOCK', 'ANNOUNCE'];
const FLATNAMES = FLAT.map(entryName);

// ---- A: current spec (top wheel, categories) ----
const A = (ci, commit) => draw.renderChooser({ knob: { ring: CATS } }, { chooser: commit ? { pos: ci, commit: true } : { pos: ci } });

// ---- B: bottom wheel, categories ----
function B(ci, commit) {
  const f = new Frame();
  wheel(f, CATNAMES, ci, { commit });
  pips(f, CATS.map(() => 1), ci, 23, { w: 3, gi: 0, gb: 2, hiGroup: false });
  return f;
}

// ---- C: bottom wheel, every sub-mode on the ring ----
function Cc(i, commit) {
  const f = new Frame(), e = FLAT[i];
  if (e.sub) ctext(f, 'small', e.cat, 32, 22, commit ? C.dim : C.grey);
  wheel(f, FLATNAMES, i, { commit });
  pips(f, GROUPS, i, 23, {});
  return f;
}

// ---- D: twist categories, press picks the variant ----
function variantBits(f, e, i, row, dotRow, nameBase, nameCol) {
  if (!e.sub) return;
  ctext(f, 'small', e.sub, 32, nameBase, nameCol);
  const list = catEntries(e.ci);
  const w = list.length * 2 + (list.length - 1) * 2;
  let x = Math.round(32 - w / 2);
  for (const [, k] of list) { f.fill(x, dotRow, 2, 1, k === i ? C.label : C.ind); x += 4; }
}
function D(i, commit) {
  const f = new Frame(), e = FLAT[i];
  variantBits(f, e, i, 0, 23, 21, commit ? C.dim : C.grey);
  wheel(f, CATNAMES, e.ci, { commit });
  return f;
}
function Dtoast(i) {
  const f = copy(FLAT[i].frame), e = FLAT[i];
  f.fill(0, 21, 64, 11, '#000000');
  const list = catEntries(e.ci);
  let x = Math.round(32 - (list.length * 4 - 2) / 2);
  for (const [, k] of list) { f.fill(x, 23, 2, 1, k === i ? C.amber : C.ind); x += 4; }
  ctext(f, '5x7', e.sub, 32, 32, C.amber);
  return f;
}

// ---- E: tab bar of category icons, sub-mode name above ----
const ICONS = [
  ['###.###', '###.###', '###.###', '.......', '###.###', '###.###', '###.###'],
  ['.#####.', '#.....#', '#.....#', '#######', '##.#.##', '#######', '.#...#.'],
  ['...#...', '.#...#.', '..###..', '#.###.#', '..###..', '.#...#.', '...#...'],
  ['..###..', '.#...#.', '#.#.#.#', '#.#.#.#', '#.#.#.#', '.#...#.', '..###..'],
  ['..###..', '.#.#.#.', '#..#..#', '#..###.', '#.....#', '.#...#.', '..###..'].map((r, j) => j === 3 ? '#..##.#' : r),
  ['#######', '#.....#', '#.###.#', '#.....#', '#######', '.##....', '.#.....'],
];
function sprite(f, rows, x, y, col) { rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') f.fill(x + i, y + j, 1, 1, col); })); }
function E(i, commit) {
  const f = new Frame(), e = FLAT[i];
  ICONS.forEach((ic, ci) => sprite(f, ic, 3 + ci * 10, 23, ci === e.ci ? C.label : C.dim));
  f.fill(3 + e.ci * 10, 31, 7, 1, C.amber);
  ctext(f, '5x7', entryName(e), 32, 19, commit ? C.amber : C.label);
  if (e.sub) {
    const list = catEntries(e.ci);
    let x = Math.round(32 - (list.length * 4 - 2) / 2);
    for (const [, k] of list) { f.fill(x, 21, 2, 1, k === i ? C.amber : C.ind); x += 4; }
  }
  return f;
}

// ---- F: live preview, label strip at the bottom ----
function copy(src) { const f = new Frame(); f.px.set(src.px); return f; }
function F(i, commit) {
  const f = copy(FLAT[i].frame), e = FLAT[i];
  if (!commit) for (let k = 0; k < f.px.length; k++) f.px[k] = Math.round(f.px[k] * 0.55);
  f.fill(0, 24, 64, 8, '#000000');
  pips(f, GROUPS, i, 25, {});
  const a = e.sub ? e.cat : '', b = entryName(e);
  const w = (a ? M('small', a) + 3 : 0) + M('small', b);
  let x = Math.round(32 - w / 2);
  if (a) x = f.text('small', a, x, 32, C.grey) + 2;
  f.text('small', b, x, 32, commit ? C.amber : C.label);
  return f;
}

// ---- G: right-aligned vertical list, category at left ----
function rtext(f, font, s, right, base, col) { const w = M(font, s); f.text(font, s, right - w + 1, base, col); return right - w + 1; }
function G(i, commit) {
  const f = new Frame(), e = FLAT[i];
  const x0 = rtext(f, '5x7', entryName(e), 63, 24, commit ? C.amber : C.label);
  if (e.sub) f.withClip(0, 0, x0 - 3, 31, () => f.text('small', e.cat, 3, 23, commit ? C.dim : C.grey));
  if (!commit) {
    for (const [d, base] of [[-2, 9], [-1, 15], [1, 31]]) {
      const k = ((i + d) % N + N) % N;
      rtext(f, 'small', FLATNAMES[k], 63, base, lerp(C.label, C.dim, Math.min(1, Math.abs(d) * 0.7)));
    }
  }
  // vertical pips on the left edge? no: position bar along the right edge would collide; use a left rail
  let y = 1;
  GROUPS.forEach((g, gi) => { for (let j = 0; j < g; j++) { const k = FLAT.findIndex((x) => x.ci === gi) + j; f.fill(0, y, 1, 1, k === i ? C.amber : FLAT[k].ci === e.ci ? C.pipGroup : C.ind); y += j < g - 1 ? 2 : 0; } y += 3; });
  return f;
}

const q5 = (v) => v & 0xf8;
function uri(f) {
  const png = new PNG({ width: 64, height: 32 });
  for (let k = 0, j = 0; k < 64 * 32; k++) { png.data[j++] = q5(f.px[k * 3]); png.data[j++] = q5(f.px[k * 3 + 1]); png.data[j++] = q5(f.px[k * 3 + 2]); png.data[j++] = 255; }
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}
const out = {
  entries: FLAT.map((e) => ({ ci: e.ci, cat: e.cat, sub: e.sub })),
  cats: CATNAMES,
  screens: FLAT.map((e) => uri(e.frame)),
  A: { open: CATS.map((_, c) => uri(A(c))), commit: CATS.map((_, c) => uri(A(c, true))) },
  B: { open: CATS.map((_, c) => uri(B(c))), commit: CATS.map((_, c) => uri(B(c, true))) },
};
for (const [k, fn] of [['C', Cc], ['D', D], ['E', E], ['F', F], ['G', G]]) out[k] = { open: FLAT.map((_, i) => uri(fn(i))), commit: FLAT.map((_, i) => uri(fn(i, true))) };
out.D.toast = FLAT.map((e, i) => (e.sub ? uri(Dtoast(i)) : null));
fs.writeFileSync(process.argv[2], JSON.stringify(out));
// contact sheet for checking
const sheet = new Frame(7 * 68 + 4, 6 * 36 + 4);
const put = (f, c, r) => { for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) sheet.set(4 + c * 68 + x, 4 + r * 36 + y, f.get(x, y)); };
const picks = [1, 4, 9, 10, 12, 6];
picks.forEach((i, r) => { put(A(FLAT[i].ci), 0, r); put(B(FLAT[i].ci), 1, r); put(Cc(i), 2, r); put(D(i), 3, r); put(E(i), 4, r); put(F(i), 5, r); put(G(i), 6, r); });
fs.writeFileSync(process.argv[3], sheet.toPNG(3));
