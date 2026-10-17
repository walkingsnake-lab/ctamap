'use strict';
// Clock face mockups (brainstorm, no M4 memory limits). Each face draws one
// 64x32 frame for a given time. Shared by render.js (PNG sheet) and the live
// browser page, so it has no Node dependencies: fonts and icons come in from
// the caller (packed board fonts from server/board/fonts.js, icons.js data).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClockFaces = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TAU = Math.PI * 2;
  const rgb = (c) => (typeof c === 'string' ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const C = {
    hand: '#cccccc',   // big-clock white
    label: '#d8d8d8',
    grey: '#8f8f8f',
    dim: '#555555',
    tick: '#555555',
    major: '#8f8f8f',
    rim: '#333333',
    track: '#1f1f1f',
    amber: '#ffb000',
    amberDim: '#664600',
    red: '#c60c30',    // Red Line block
  };

  // ---------------------------------------------------------------- frame
  class Led {
    constructor(env, w = 64, h = 32) {
      this.w = w; this.h = h; this.env = env;
      this.px = new Float32Array(w * h * 3);
    }
    get(x, y) { const i = (y * this.w + x) * 3; return [this.px[i], this.px[i + 1], this.px[i + 2]]; }
    // Composite `color` over the pixel with coverage a (0..1).
    plot(x, y, color, a = 1) {
      if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      const c = rgb(color), i = (y * this.w + x) * 3;
      a = Math.min(1, a);
      for (let k = 0; k < 3; k++) this.px[i + k] = this.px[i + k] * (1 - a) + c[k] * a;
    }
    fill(x, y, w, h, color) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.plot(i, j, color); }
    measure(font, s) {
      const f = this.env.fonts[font]; let w = 0;
      for (const ch of s) { const g = f[ch.codePointAt(0)]; if (g) w += g[0]; }
      return w > 0 ? w - 1 : 0;
    }
    text(font, s, x, base, color) {
      const f = this.env.fonts[font];
      for (const ch of s) {
        const g = f[ch.codePointAt(0)]; if (!g) continue;
        const [dw, w, h, xo, yo] = g, top = base - (yo + h);
        for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if ((g[5 + r] >> (w - 1 - c)) & 1) this.plot(x + xo + c, top + r, color);
        x += dw;
      }
      return x;
    }
    ctext(font, s, cx, base, color) { return this.text(font, s, Math.round(cx - this.measure(font, s) / 2), base, color); }
    rtext(font, s, right, base, color) { return this.text(font, s, right - this.measure(font, s), base, color); }
    icon(name, x, y) {
      const { ICONS, PALETTE } = this.env.icons;
      ICONS[name].forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') this.plot(x + i, y + j, PALETTE[c]); }));
    }
  }

  // ------------------------------------------------------------- geometry
  // Pixel (x, y) has its center at (x, y). Angles are fractions of a turn,
  // clockwise from 12 o'clock.
  const polar = (cx, cy, frac, len) => [cx + len * Math.sin(frac * TAU), cy - len * Math.cos(frac * TAU)];
  const fracOf = (dx, dy) => { const a = Math.atan2(dx, -dy) / TAU; return a < 0 ? a + 1 : a; };

  function segDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - x0) * dx + (py - y0) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  }

  // Line with half-width hw. aa: coverage from distance; otherwise hard edge.
  function seg(f, x0, y0, x1, y1, hw, color, aa = true) {
    const xa = Math.floor(Math.min(x0, x1) - hw - 1), xb = Math.ceil(Math.max(x0, x1) + hw + 1);
    const ya = Math.floor(Math.min(y0, y1) - hw - 1), yb = Math.ceil(Math.max(y0, y1) + hw + 1);
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const d = segDist(x, y, x0, y0, x1, y1);
      f.plot(x, y, color, aa ? clamp(hw + 0.5 - d, 0, 1) : (d <= hw ? 1 : 0));
    }
  }

  // Aliased 1px line (what a 60-entry endpoint table + Bresenham gives).
  function line(f, x0, y0, x1, y1, color) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      f.plot(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // Midpoint circle pixels, sorted clockwise from 12.
  function circlePixels(cx, cy, r) {
    const pts = new Map();
    let x = r, y = 0, err = 1 - r;
    const add = (px, py) => pts.set(`${px},${py}`, [px, py]);
    while (x >= y) {
      for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) add(cx + a, cy + b);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
    return [...pts.values()].sort((p, q) => fracOf(p[0] - cx, p[1] - cy) - fracOf(q[0] - cx, q[1] - cy));
  }

  // Anti-aliased ring (or arc clockwise from..to, fractions of a turn, may
  // wrap past 12) of width w.
  function ring(f, cx, cy, r, w, color, from = 0, to = 1) {
    const R = Math.ceil(r + w), full = to - from >= 1;
    const span = ((to - from) % 1 + 1) % 1;
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      let a = clamp(w / 2 + 0.5 - Math.abs(d - r), 0, 1);
      if (a <= 0) continue;
      if (!full) {
        const rel = ((fracOf(dx, dy) - from) % 1 + 1) % 1, circ = TAU * Math.max(d, 1);
        a *= clamp(rel * circ + 0.5, 0, 1) * clamp((span - rel) * circ + 0.5, 0, 1);
      }
      f.plot(x, y, color, a);
    }
  }

  function disc(f, cx, cy, r, color) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      f.plot(x, y, color, clamp(r + 0.5 - Math.hypot(x - cx, y - cy), 0, 1));
    }
  }

  // Filled pie wedge from 12 o'clock to `to`, radius r, AA on the rim and
  // the leading edge.
  function wedge(f, cx, cy, r, to, color) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      let a = clamp(r + 0.5 - d, 0, 1);
      if (a <= 0 || d < 0.5) { if (d < 0.5 && to > 0) f.plot(x, y, color); continue; }
      a *= clamp((to - fracOf(dx, dy)) * TAU * d + 0.5, 0, 1);
      f.plot(x, y, color, a);
    }
  }

  // Hour ticks snapped to whole pixels (crisp even on AA faces).
  function ticks(f, cx, cy, r, { major = C.major, minor = C.tick, majorLen = 1, skipMinor = false } = {}) {
    for (let i = 0; i < 12; i++) {
      const isMajor = i % 3 === 0;
      if (isMajor) for (let k = 0; k <= majorLen; k++) { const [x, y] = polar(cx, cy, i / 12, r - k); f.plot(Math.round(x), Math.round(y), major); }
      else if (!skipMinor) { const [x, y] = polar(cx, cy, i / 12, r); f.plot(Math.round(x), Math.round(y), minor); }
    }
  }

  // ----------------------------------------------------------------- time
  const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const HOURS = ['TWELVE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN'];

  function parts(d) {
    const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(), ms = d.getMilliseconds();
    return {
      d, h, m, s, ms,
      h12: h % 12 || 12,
      ampm: h < 12 ? 'AM' : 'PM',
      hourF: ((h % 12) + m / 60 + s / 3600) / 12,
      minF: (m + s / 60) / 60,
      secTick: s / 60,
      secSweep: (s + ms / 1000) / 60,
      day: DAYS[d.getDay()],
      date: `${MONTHS[d.getMonth()]} ${d.getDate()}`,
      hm: `${h % 12 || 12}:${String(m).padStart(2, '0')}`,
    };
  }

  // ------------------------------------------------------- right-half info
  const RX = 48; // center of columns 33..63

  function infoDateWx(f, t, wx) {
    f.ctext('small', t.day, RX, 7, C.grey);
    f.ctext('5x7', t.date, RX, 17, C.label);
    const tw = f.measure('5x7', String(wx.temp)) + 3;
    const x0 = Math.round(RX - (8 + 2 + tw) / 2);
    f.icon(wx.icon, x0, 22);
    const x = f.text('5x7', String(wx.temp), x0 + 10, 30, C.label);
    f.text('small', '°', x, 28, C.label);
  }

  function infoTimeDate(f, t) {
    f.ctext('5x7', t.hm, RX, 10, C.label);
    f.ctext('small', t.day, RX, 19, C.grey);
    f.ctext('small', t.date, RX, 27, C.grey);
  }

  // ---------------------------------------------------------------- faces
  const CX = 15, CY = 15; // 31px dial on columns/rows 0..30

  function classicAA(f, t, { sweep = true } = {}) {
    ring(f, CX, CY, 15, 1, C.rim);
    ticks(f, CX, CY, 13);
    seg(f, CX, CY, ...polar(CX, CY, t.hourF, 7), 1.0, C.hand);
    seg(f, CX, CY, ...polar(CX, CY, t.minF, 11.5), 0.6, C.hand);
    const sf = sweep ? t.secSweep : t.secTick;
    seg(f, ...polar(CX, CY, sf + 0.5, 3), ...polar(CX, CY, sf, 13), 0.45, C.amber);
    disc(f, CX, CY, 1.1, C.amber);
  }

  const FACES = [
    // ---- A: 31px dial on the left, info on the right (the v2 spec layout)
    {
      id: 'a1-baseline', group: 'A', title: 'A1 Baseline',
      note: 'The v2 spec as written: 60-entry endpoint table + Bresenham. Ticking seconds. Hands step in whole pixels, so the minute hand jumps and wobbles.',
      draw(f, t, wx) {
        for (const [x, y] of circlePixels(CX, CY, 15)) f.plot(x, y, C.rim);
        ticks(f, CX, CY, 13);
        const snap = (fr) => Math.round(fr * 60) / 60;
        line(f, CX, CY, ...polar(CX, CY, snap(t.hourF), 7), C.hand);
        line(f, CX, CY, ...polar(CX, CY, snap(t.minF), 11), C.hand);
        line(f, CX, CY, ...polar(CX, CY, t.secTick, 13), C.amber);
        f.plot(CX, CY, C.hand);
        infoDateWx(f, t, wx);
      },
    },
    {
      id: 'a2-smooth', group: 'A', title: 'A2 Smooth hands',
      note: 'Anti-aliased hands with real widths (hour 2px, minute 1.2px), sweeping seconds with a short tail. Ticks stay snapped to pixels so they stay crisp.',
      draw(f, t, wx) { classicAA(f, t); infoDateWx(f, t, wx); },
    },
    {
      id: 'a3-dots', group: 'A', title: 'A3 Dots only',
      note: 'No rim. Twelve dots, the quarters bright. Seconds are a single amber dot walking the ring instead of a hand, so nothing crosses the hands.',
      draw(f, t, wx) {
        for (let i = 0; i < 12; i++) {
          const [x, y] = polar(CX, CY, i / 12, 14);
          f.plot(Math.round(x), Math.round(y), i % 3 ? '#4a4a4a' : C.hand);
        }
        seg(f, CX, CY, ...polar(CX, CY, t.hourF, 7.5), 1.1, C.hand);
        seg(f, CX, CY, ...polar(CX, CY, t.minF, 12), 0.7, C.hand);
        const [sx, sy] = polar(CX, CY, t.secTick, 14);
        f.plot(Math.round(sx), Math.round(sy), C.amber);
        infoDateWx(f, t, wx);
      },
    },
    {
      id: 'a4-numerals', group: 'A', title: 'A4 Numerals',
      note: '12 / 3 / 6 / 9 in Tom Thumb, dots for the rest. Hands are shorter to clear the numbers. No seconds: the calmest face.',
      draw(f, t, wx) {
        ring(f, CX, CY, 15, 1, '#262626');
        f.ctext('small', '12', CX, 6, C.label);
        f.ctext('small', '3', 27, 18, C.label);
        f.ctext('small', '6', CX, 30, C.label);
        f.ctext('small', '9', 3, 18, C.label);
        for (let i = 0; i < 12; i++) if (i % 3) { const [x, y] = polar(CX, CY, i / 12, 12); f.plot(Math.round(x), Math.round(y), C.tick); }
        seg(f, CX, CY, ...polar(CX, CY, t.hourF, 6), 1.0, C.hand);
        seg(f, CX, CY, ...polar(CX, CY, t.minF, 9), 0.6, C.hand);
        disc(f, CX, CY, 0.9, C.hand);
        infoDateWx(f, t, wx);
      },
    },
    {
      id: 'a5-seconds-ring', group: 'A', title: 'A5 Seconds ring',
      note: 'The rim fills amber over the minute (about 1.4 LEDs per second) and empties at :00. No second hand.',
      draw(f, t, wx) {
        const pts = circlePixels(CX, CY, 15), lit = Math.round(pts.length * (t.s + 1) / 60);
        pts.forEach(([x, y], i) => f.plot(x, y, i < lit - 1 ? C.amberDim : i === lit - 1 ? C.amber : C.track));
        ticks(f, CX, CY, 13, { minor: '#3a3a3a' });
        seg(f, CX, CY, ...polar(CX, CY, t.hourF, 7), 1.0, C.hand);
        seg(f, CX, CY, ...polar(CX, CY, t.minF, 11.5), 0.6, C.hand);
        disc(f, CX, CY, 0.9, C.hand);
        infoDateWx(f, t, wx);
      },
    },
    {
      id: 'a6-wedge', group: 'A', title: 'A6 Minute wedge',
      note: 'Minutes past the hour as a dim amber pie, edged by an amber minute hand. The minute reads as an area, not a thin line.',
      draw(f, t, wx) {
        wedge(f, CX, CY, 13, t.minF, '#3a2800');
        for (let i = 0; i < 12; i++) { const [x, y] = polar(CX, CY, i / 12, 14.5); f.plot(Math.round(x), Math.round(y), i % 3 ? C.tick : C.major); }
        seg(f, CX, CY, ...polar(CX, CY, t.minF, 13), 0.55, C.amber);
        seg(f, CX, CY, ...polar(CX, CY, t.hourF, 7.5), 1.1, C.hand);
        disc(f, CX, CY, 1.0, C.hand);
        infoDateWx(f, t, wx);
      },
    },
    {
      id: 'a7-sun-dial', group: 'A', title: 'A7 24-hour sun dial',
      note: 'One hand, 24 hours, noon at the top. The rim is lit dim yellow between sunrise and sunset (Open-Meteo), blue at night; the tip is a sun or moon. Digital time on the right since one hand is imprecise.',
      draw(f, t, wx) {
        const h24 = t.h + t.m / 60 + t.s / 3600;
        const toF = (h) => ((h / 24) + 0.5) % 1;
        const a = toF(wx.sunrise), b = toF(wx.sunset);
        ring(f, CX, CY, 14, 2, '#13204a');
        ring(f, CX, CY, 14, 2, '#5a4600', a, b);
        for (const h of [0, 6, 12, 18]) { const [x, y] = polar(CX, CY, toF(h), 11); f.plot(Math.round(x), Math.round(y), C.dim); }
        const nf = toF(h24), day = h24 >= wx.sunrise && h24 < wx.sunset;
        seg(f, CX, CY, ...polar(CX, CY, nf, 10), 0.6, C.hand);
        disc(f, ...polar(CX, CY, nf, 14), 1.6, day ? '#ffc800' : '#ffe47a');
        disc(f, CX, CY, 0.9, C.hand);
        f.ctext('5x7', t.hm, RX, 9, C.label);
        f.ctext('small', t.ampm, RX, 16, C.grey);
        const sh = Math.floor(wx.sunset), sm = Math.round((wx.sunset - sh) * 60);
        f.ctext('small', day ? 'SUNSET' : 'SUNRISE', RX, 24, C.dim);
        const rise = Math.floor(wx.sunrise), rm = Math.round((wx.sunrise - rise) * 60);
        const show = day ? `${sh % 12 || 12}:${String(sm).padStart(2, '0')}` : `${rise}:${String(rm).padStart(2, '0')}`;
        f.ctext('small', show, RX, 31, C.grey);
      },
    },

    // ---- B: the whole panel is the clock
    {
      id: 'b1-wide', group: 'B', title: 'B1 Wide dial',
      note: 'Uses all 64x32. Markers sit where the true hour angles meet the panel edge; hands stretch toward the edge, so the minute hand is 26px at 3:00 and 12px at 12:00. Center is between pixels (2x2 hub, 2x2 markers).',
      draw(f, t) {
        const cx = 31.5, cy = 15.5, ax = 30, ay = 14;
        const reach = (fr) => { const s = Math.abs(Math.sin(fr * TAU)), c = Math.abs(Math.cos(fr * TAU)); return Math.min(s ? ax / s : 1e9, c ? ay / c : 1e9); };
        for (let i = 0; i < 12; i++) {
          let [x, y] = polar(cx, cy, i / 12, reach(i / 12));
          x = Math.round(x - 0.5); y = Math.round(y - 0.5);
          f.fill(x, y, 2, 2, i % 3 ? '#4a4a4a' : C.major);
        }
        seg(f, cx, cy, ...polar(cx, cy, t.hourF, reach(t.hourF) * 0.55), 1.2, C.hand);
        seg(f, cx, cy, ...polar(cx, cy, t.minF, reach(t.minF) * 0.86), 0.7, C.hand);
        seg(f, ...polar(cx, cy, t.secSweep + 0.5, 3), ...polar(cx, cy, t.secSweep, reach(t.secSweep) * 0.95), 0.45, C.amber);
        disc(f, cx, cy, 1.2, C.amber);
      },
    },
    {
      id: 'b2-two-dials', group: 'B', title: 'B2 Two dials',
      note: 'Hours on the left dial, minutes on the right, one hand each. Seconds as an amber dot on the minute dial. Reads like a regulator watch; slower to read than one dial.',
      draw(f, t) {
        for (const [cx, label] of [[15, 'HR'], [48, 'MIN']]) {
          ring(f, cx, CY, 15, 1, '#262626');
          ticks(f, cx, CY, 13);
          f.ctext('small', label, cx, 25, '#3a3a3a');
        }
        seg(f, 15, CY, ...polar(15, CY, t.hourF, 10), 1.1, C.hand);
        disc(f, 15, CY, 1.3, C.hand);
        seg(f, 48, CY, ...polar(48, CY, t.minF, 12), 0.65, C.hand);
        disc(f, 48, CY, 1.0, C.hand);
        const [sx, sy] = polar(48, CY, t.secTick, 15);
        f.plot(Math.round(sx), Math.round(sy), C.amber);
      },
    },

    // ---- C: not hands
    {
      id: 'c1-words', group: 'C', title: 'C1 Word clock',
      note: 'Rounded down to five minutes, in 5x7 caps; the four dots count the extra minutes (amber). "PAST" / "TO" in grey so the numbers lead.',
      draw(f, t) {
        const m5 = Math.floor(t.m / 5) * 5, extra = t.m - m5;
        const MW = { 5: 'FIVE', 10: 'TEN', 15: 'QUARTER', 20: 'TWENTY', 25: 'TWENTY-FIVE', 30: 'HALF' };
        let l1, rel, hr;
        if (m5 === 0) { l1 = HOURS[t.h % 12]; rel = ''; hr = "O'CLOCK"; }
        else if (m5 <= 30) { l1 = MW[m5]; rel = 'PAST '; hr = HOURS[t.h % 12]; }
        else { l1 = MW[60 - m5]; rel = 'TO '; hr = HOURS[(t.h + 1) % 12]; }
        f.ctext('5x7', l1, 32, 11, C.hand);
        const w = f.measure('5x7', rel + hr), x0 = Math.round(32 - w / 2);
        const x = f.text('5x7', rel, x0, 21, C.grey);
        f.text('5x7', hr, x, 21, m5 === 0 ? C.grey : C.hand);
        for (let i = 0; i < 4; i++) f.fill(26 + i * 3, 26, 2, 2, i < extra ? C.amber : '#262626');
      },
    },
    {
      id: 'c2-bcd', group: 'C', title: 'C2 Binary (BCD)',
      note: 'One column per digit, bits 1/2/4/8 from the bottom; decimal digits underneath as a crib. Hours and minutes white, seconds amber.',
      draw(f, t) {
        const digits = [Math.floor(t.h12 / 10), t.h12 % 10, Math.floor(t.m / 10), t.m % 10, Math.floor(t.s / 10), t.s % 10];
        const bits = [1, 4, 3, 4, 3, 4];
        const S = 4, G = 1, PG = 5;
        const totalW = 6 * S + 3 * G + 2 * PG;
        let x = Math.round(32 - totalW / 2);
        digits.forEach((d, i) => {
          const color = i >= 4 ? C.amber : C.hand;
          for (let b = 0; b < bits[i]; b++) f.fill(x, 19 - b * (S + 1) - S + 1, S, S, (d >> b) & 1 ? color : '#1f1f1f');
          f.ctext('small', String(d), x + 1.5, 31, '#3a3a3a');
          x += S + (i % 2 ? PG : G);
        });
      },
    },
    {
      id: 'c3-rings', group: 'C', title: 'C3 Progress rings',
      note: 'Outer ring minutes, middle hours (12h), inner seconds, each filling clockwise from 12 on a dim track. Time and date on the right.',
      draw(f, t) {
        const rings = [[13.5, t.minF, C.hand], [9.5, t.hourF, C.amber], [5.5, t.secSweep, C.dim]];
        for (const [r, fr, c] of rings) { ring(f, CX, CY, r, 2, '#1a1a1a'); if (fr > 0) ring(f, CX, CY, r, 2, c, 0, fr); }
        infoTimeDate(f, t);
      },
    },

    // ---- D: what goes on the right of a 31px dial (dial = A2)
    {
      id: 'd1-time-date', group: 'D', title: 'D1 Right: time + date',
      note: 'Digital time backs up the dial; day and date below in grey.',
      draw(f, t) { classicAA(f, t); infoTimeDate(f, t); },
    },
    {
      id: 'd2-trains', group: 'D', title: 'D2 Right: next trains',
      note: 'A clock that still answers "do I need to leave?": station name, then each direction as a Red Line arrow and three times (first amber).',
      draw(f, t, wx, tr) {
        classicAA(f, t);
        f.ctext('small', 'MORSE', RX, 7, C.dim);
        const G = 0xe007, D = 0xe008;
        [[G, tr.north, 17], [D, tr.south, 27]].forEach(([cp, times, base]) => {
          f.text('small', String.fromCodePoint(cp), 33, base, C.red);
          let x = 63;
          for (let i = times.length - 1; i >= 0; i--) {
            const s = String(times[i]);
            x = x - f.measure('small', s);
            f.text('small', s, x, base, i === 0 ? C.amber : C.amberDim);
            x -= 3;
          }
        });
      },
    },
    {
      id: 'd3-big-temp', group: 'D', title: 'D3 Right: big temperature',
      note: 'The spec\'s "or temperature" option: 9x15 bold digits with the 3x3 ring degree, today\'s high and low under it.',
      draw(f, t, wx) {
        classicAA(f, t);
        const s = String(wx.temp), w = f.measure('clock', s) + 4, x0 = Math.round(RX - w / 2);
        const x = f.text('clock', s, x0, 16, C.label);
        for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (i !== 1 || j !== 1) f.plot(x + 1 + i, 6 + j, C.label);
        const up = String.fromCodePoint(0xe007), dn = String.fromCodePoint(0xe008);
        const hl = [[up, C.dim], [String(wx.hi), C.grey], [' ', C.grey], [dn, C.dim], [String(wx.lo), C.grey]];
        let hx = Math.round(RX - f.measure('small', hl.map((p) => p[0]).join('')) / 2);
        for (const [str, c] of hl) hx = f.text('small', str, hx, 25, c);
      },
    },
  ];

  // Mock data for the weather/train bits (made up).
  const MOCK = {
    wx: { temp: 54, hi: 63, lo: 49, icon: 'pcloudy_day', sunrise: 7 + 6 / 60, sunset: 18 + 12 / 60 },
    trains: { north: [4, 11, 19], south: [7, 15, 22] },
  };

  function render(face, date, env, w = 64, h = 32) {
    const f = new Led(env, w, h);
    face.draw(f, parts(date), MOCK.wx, MOCK.trains);
    return f;
  }

  return { FACES, MOCK, render, parts, Led };
});
