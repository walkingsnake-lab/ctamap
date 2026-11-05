'use strict';
// Round 5: the two liked round 4 faces (Big digits; Day, time, date and its
// 128 panel) in other typefaces. Digits are bitmaps from digit-fonts.json
// (build-digit-fonts.py), passed in as env.digitFonts. One group per font.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./faces'));
  else root.ClockFacesR5 = factory(root.ClockFaces);
})(typeof self !== 'undefined' ? self : this, function (CF) {
  const { FACES } = CF;
  const WHITE = '#e6e6e6', GREY = '#8f8f8f', DIM = '#555555', FAINT = '#262626';
  const ORDER = ['bigshoulders', 'bigshoulders-light', 'bebas', 'antonio', 'oswald', 'dmserif'];

  // Time in a bitmap digit font, proportional (each glyph its own width, as
  // Big Clock lays them out), the font's own colon; 2 px between glyphs.
  function timeLayout(df, H, hm) {
    const g = df.sizes[H], gap = 2;
    const parts = [...hm].map((ch) => ({ ch, w: g[ch][0].length }));
    const width = parts.reduce((s, p) => s + p.w, 0) + gap * (parts.length - 1);
    return { g, gap, parts, width };
  }
  function drawTime(f, df, H, hm, x, y, color, showColon = true) {
    const L = timeLayout(df, H, hm);
    for (const p of L.parts) {
      if (p.ch !== ':' || showColon) L.g[p.ch].forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') f.plot(x + i, y + j, color); }));
      x += p.w + L.gap;
    }
    return x - L.gap;
  }
  const widthOf = (df, H, hm) => timeLayout(df, H, hm).width;
  // The widest time of the day, so a layout never runs out of room.
  const widest = (df, H) => Math.max(...['12:59', '10:58', '11:48', '12:48', '10:00', '9:58'].map((s) => widthOf(df, H, s)));
  const MONTHS_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  function fontFaces(key, df) {
    const G = `R5-${key}`, W28 = widest(df, 28), out = [];
    const fits64 = W28 <= 64, fitsPanel = 127 - (W28 + 6) >= 50; // room for SATURDAY in 5x7 beside it
    if (fits64) out.push({
      id: `f-${key}-big`, group: G, title: 'Big digits',
      note: 'The time alone, 28 rows tall, centered; the colon blinks.',
      draw(f, t) { drawTime(f, df, 28, t.hm, Math.round((64 - widthOf(df, 28, t.hm)) / 2), 2, WHITE, t.ms < 500); },
    });
    out.push({
      id: `f-${key}-dtd`, group: G, title: 'Day, time, date',
      note: 'Weekday and date stay in the board fonts; the time is the new face, 14 rows tall.',
      draw(f, t) {
        f.ctext('small', t.day, 31.5, 6, GREY);
        const w = widthOf(df, 14, t.hm), aw = f.measure('small', t.ampm), x0 = Math.round((64 - (w + 2 + aw)) / 2);
        const x = drawTime(f, df, 14, t.hm, x0, 8, WHITE);
        f.text('small', t.ampm, x + 2, 21, DIM);
        f.ctext('5x7', t.date, 31.5, 31, GREY);
      },
    });
    out.push({
      id: `f-${key}-big128`, group: G, w: 128, title: 'Big digits (128)',
      note: 'The time alone, centered, with AM/PM small at the baseline.',
      draw(f, t) {
        const aw = f.measure('5x7', t.ampm), w = widthOf(df, 28, t.hm), x0 = Math.round((128 - (w + 3 + aw)) / 2);
        const x = drawTime(f, df, 28, t.hm, x0, 2, WHITE, t.ms < 500);
        f.text('5x7', t.ampm, x + 3, 30, DIM);
      },
    });
    if (fitsPanel) out.push({
      id: `f-${key}-panel`, group: G, w: 128, title: 'Time + date panel (128)',
      note: 'The time right-aligned against a divider, so the panel never moves; weekday, month and year beside it.',
      draw(f, t) {
        drawTime(f, df, 28, t.hm, 1 + W28 - widthOf(df, 28, t.hm), 2, WHITE, true);
        const dx = W28 + 5, tx = dx + 5;
        f.fill(dx, 4, 1, 24, FAINT);
        const md = `${MONTHS_FULL[t.d.getMonth()]} ${t.d.getDate()}`;
        f.text('5x7', t.day, tx, 10, WHITE);
        f.text(f.measure('5x7', md) <= 127 - tx ? '5x7' : 'small', md, tx, 20, GREY);
        f.text('small', `${t.ampm}  ${t.d.getFullYear()}`, tx, 29, DIM);
      },
    });
    return out;
  }

  // The faces need the font bitmaps, which come in env: build() pushes them
  // onto FACES and returns one group per font, [key, title, note].
  let built = null;
  function build(env) {
    if (built) return built;
    built = [];
    for (const key of ORDER) {
      const df = env.digitFonts && env.digitFonts[key];
      if (!df) continue;
      FACES.push(...fontFaces(key, df));
      built.push([`R5-${key}`, df.label, df.note]);
    }
    return built;
  }
  return { build, ORDER };
});
