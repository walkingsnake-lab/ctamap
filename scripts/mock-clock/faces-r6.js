'use strict';
// Rounds 6 and 7: the liked faces (Big digits; Day, time, date and its 128
// panel) in real bitmap fonts (bitmap-digits.json, from build-bitmap-digits.py;
// passed in as env.bitmapDigits). Round 6: native sizes; round 7 adds u8g2's
// fonts and whole-pixel scaling. One group per family, newest round first.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./faces'));
  else root.ClockFacesR6 = factory(root.ClockFaces);
})(typeof self !== 'undefined' ? self : this, function (CF) {
  const { FACES } = CF;
  const SOFT = 0.35;
  const WHITE = '#e6e6e6', GREY = '#8f8f8f', DIM = '#555555', FAINT = '#262626';
  const MONTHS_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  // Tabular layout (build-bitmap-digits.py time_width): each digit centered
  // in a slot as wide as the widest digit, the colon at its ink width.
  function layout(size, H, hm) {
    const g = size.glyphs, slot = Math.max(...'0123456789'.split('').map((d) => g[d][0].length));
    const gap = size.gap != null ? size.gap : H >= 24 ? 3 : 2;
    const parts = [...hm].map((ch) => ({ ch, w: ch === ':' ? g[':'][0].length : slot }));
    return { g, gap, parts, width: parts.reduce((s, p) => s + p.w, 0) + gap * (parts.length - 1) };
  }
  function drawTime(f, size, H, hm, x, y, color, colon = true) {
    const L = layout(size, H, hm);
    for (const p of L.parts) {
      const rows = L.g[p.ch], ox = x + Math.floor((p.w - rows[0].length) / 2);
      // '#' lit, '+' lit dimly (the soft colon's corners).
      if (p.ch !== ':' || colon) rows.forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') f.plot(ox + i, y + j, color); else if (c === '+') f.plot(ox + i, y + j, color, SOFT); }));
      x += p.w + L.gap;
    }
    return x - L.gap;
  }

  function familyFaces(key, fam) {
    const G = `R${fam.round || 6}-${key}`, R = fam.roles, sz = (role) => fam.sizes[R[role]], H = (role) => Number(R[role]);
    const src = (role) => `${H(role)}-row digits from ${sz(role).src.split('-').slice(0, 15).join('-')}`;
    const out = [];
    if (R.big64) out.push({
      id: `b-${key}-big`, group: G, title: 'Big digits',
      note: `The time alone, centered on the panel; the colon blinks. ${H('big64')} rows, the tallest size of this font that fits four digits on 64.`,
      draw(f, t) {
        const s = sz('big64'), h = H('big64'), w = layout(s, h, t.hm).width;
        drawTime(f, s, h, t.hm, Math.round((64 - w) / 2), Math.floor((32 - h) / 2), WHITE, t.ms < 500);
      },
    });
    if (R.dtd64) out.push({
      id: `b-${key}-dtd`, group: G, title: 'Day, time, date',
      note: `Weekday and date in the board fonts; the time in ${H('dtd64')}-row digits.`,
      draw(f, t) {
        const s = sz('dtd64'), h = H('dtd64');
        f.ctext('small', t.day, 31.5, 6, GREY);
        const w = layout(s, h, t.hm).width, aw = f.measure('small', t.ampm), x0 = Math.round((64 - (w + 2 + aw)) / 2);
        const top = 8 + Math.floor((15 - h) / 2);
        const x = drawTime(f, s, h, t.hm, x0, top, WHITE);
        f.text('small', t.ampm, x + 2, top + h, DIM);
        f.ctext('5x7', t.date, 31.5, 31, GREY);
      },
    });
    if (R.big128) out.push({
      id: `b-${key}-big128`, group: G, w: 128, title: 'Big digits (128)',
      note: `${H('big128')}-row digits, the largest size of this font that fits; AM/PM at the baseline.`,
      draw(f, t) {
        const s = sz('big128'), h = H('big128'), w = layout(s, h, t.hm).width, aw = f.measure('5x7', t.ampm);
        const x0 = Math.round((128 - (w + 3 + aw)) / 2), top = Math.floor((32 - h) / 2);
        const x = drawTime(f, s, h, t.hm, x0, top, WHITE, t.ms < 500);
        f.text('5x7', t.ampm, x + 3, top + h, DIM);
      },
    });
    if (R.panel128) out.push({
      id: `b-${key}-panel`, group: G, w: 128, title: 'Time + date panel (128)',
      note: `${H('panel128')}-row digits right-aligned against a divider; weekday, month and year beside them.`,
      draw(f, t) {
        const s = sz('panel128'), h = H('panel128'), W = s.w, top = Math.floor((32 - h) / 2);
        drawTime(f, s, h, t.hm, 1 + W - layout(s, h, t.hm).width, top, WHITE);
        const dx = W + 5, tx = dx + 5;
        f.fill(dx, 4, 1, 24, FAINT);
        const md = `${MONTHS_FULL[t.d.getMonth()]} ${t.d.getDate()}`;
        f.text('5x7', t.day, tx, 10, WHITE);
        f.text(f.measure('5x7', md) <= 127 - tx ? '5x7' : 'small', md, tx, 20, GREY);
        f.text('small', `${t.ampm}  ${t.d.getFullYear()}`, tx, 29, DIM);
      },
    });
    return out;
  }

  let built = null;
  function build(env) {
    if (built) return built;
    built = [];
    const all = Object.entries(env.bitmapDigits || {}).sort(([, a], [, b]) => (b.round || 6) - (a.round || 6));
    for (const [key, fam] of all) {
      FACES.push(...familyFaces(key, fam));
      built.push([`R${fam.round || 6}-${key}`, fam.label, fam.note]);
    }
    // Round 8: t0 Bold with round colon dots instead of its square blocks.
    const t0 = env.bitmapDigits && env.bitmapDigits.t0;
    if (t0) for (const [key, label, note, soft] of ROUND_COLONS) {
      const fam = { ...t0, round: 8, label, note, sizes: {} };
      for (const [h, size] of Object.entries(t0.sizes)) fam.sizes[h] = { ...size, glyphs: { ...size.glyphs, ':': roundColon(size.glyphs[':'][0].length, Number(h), soft) } };
      FACES.push(...familyFaces(key, fam));
      built.unshift([`R8-${key}`, label, note]);
    }
    return built;
  }
  // A colon of two round dots, each as big as t0's square ones (3, 4 or 5 px),
  // centered on the digits with the same space between them as t0's.
  const ROUND_COLONS = [
    ['t0-soft', 't0 Bold, soft round colon', 'Round dots with their corner pixels lit at about a third: on the panel they read as circles rather than plus signs.', true],
    ['t0-round', 't0 Bold, crisp round colon', 'Round dots with the corner pixels left off: every LED fully on or off, like the digits.', false],
  ];
  function roundColon(d, H, soft) {
    const inner = d >= 5 ? 5 : d >= 4 ? 3 : 2, top = Math.floor((H - (2 * d + inner)) / 2);
    const dot = [];
    for (let j = 0; j < d; j++) {
      let r = '';
      for (let i = 0; i < d; i++) {
        // A 3 px dot stays square (crisp): with its corners off it's a plus sign.
        const corner = (soft || d > 3) && (i === 0 || i === d - 1) && (j === 0 || j === d - 1);
        r += corner ? (soft ? '+' : '.') : '#';
      }
      dot.push(r);
    }
    const blank = '.'.repeat(d);
    return Array.from({ length: H }, (_, y) => (y >= top && y < top + d ? dot[y - top] : y >= top + d + inner && y < top + 2 * d + inner ? dot[y - top - d - inner] : blank));
  }
  return { build };
});
