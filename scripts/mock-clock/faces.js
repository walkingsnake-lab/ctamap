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
      id: 'a1-baseline', group: 'KEEP', title: 'A1 Baseline',
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
      id: 'a2-smooth', group: 'R1', title: 'A2 Smooth hands',
      note: 'Anti-aliased hands with real widths (hour 2px, minute 1.2px), sweeping seconds with a short tail. Ticks stay snapped to pixels so they stay crisp.',
      draw(f, t, wx) { classicAA(f, t); infoDateWx(f, t, wx); },
    },
    {
      id: 'a3-dots', group: 'R1', title: 'A3 Dots only',
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
      id: 'a4-numerals', group: 'R1', title: 'A4 Numerals',
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
      id: 'a5-seconds-ring', group: 'R1', title: 'A5 Seconds ring',
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
      id: 'a6-wedge', group: 'R1', title: 'A6 Minute wedge',
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
      id: 'a7-sun-dial', group: 'R1', title: 'A7 24-hour sun dial',
      note: 'One hand, 24 hours, noon at the top. The rim is lit dim yellow between sunrise and sunset (WeatherAPI), blue at night; the tip is a sun or moon. Digital time on the right since one hand is imprecise.',
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
      id: 'b1-wide', group: 'R1', title: 'B1 Wide dial',
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
      id: 'b2-two-dials', group: 'R1', title: 'B2 Two dials',
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
      id: 'c1-words', group: 'R1', title: 'C1 Word clock',
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
      id: 'c2-bcd', group: 'R1', title: 'C2 Binary (BCD)',
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
      id: 'c3-rings', group: 'R1', title: 'C3 Progress rings',
      note: 'Outer ring minutes, middle hours (12h), inner seconds, each filling clockwise from 12 on a dim track. Time and date on the right.',
      draw(f, t) {
        const rings = [[13.5, t.minF, C.hand], [9.5, t.hourF, C.amber], [5.5, t.secSweep, C.dim]];
        for (const [r, fr, c] of rings) { ring(f, CX, CY, r, 2, '#1a1a1a'); if (fr > 0) ring(f, CX, CY, r, 2, c, 0, fr); }
        infoTimeDate(f, t);
      },
    },

    // ---- D: what goes on the right of a 31px dial (dial = A2)
    {
      id: 'd1-time-date', group: 'R1', title: 'D1 Right: time + date',
      note: 'Digital time backs up the dial; day and date below in grey.',
      draw(f, t) { classicAA(f, t); infoTimeDate(f, t); },
    },
    {
      id: 'd2-trains', group: 'R1', title: 'D2 Right: next trains',
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
      id: 'd3-big-temp', group: 'R1', title: 'D3 Right: big temperature',
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

  // ================================================================ round 2
  const easeIn = (k) => k * k * k;
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const msInMinute = (t) => t.s * 1000 + t.ms;
  const prevMinute = (t) => parts(new Date(t.d.getTime() - 60000));
  const big = (t) => (t.h12 < 10 ? ' ' : '') + t.hm; // '9:42' -> ' 9:42'
  const LINE = { red: '#c60c30', orange: '#f9461c', pink: '#e27ea6', blue: '#41b6e6' };

  // Clockwise pixel path around a rectangle, starting at the top center.
  function rectPath(x0, y0, x1, y1) {
    const pts = [];
    for (let x = x0; x <= x1; x++) pts.push([x, y0]);
    for (let y = y0 + 1; y <= y1; y++) pts.push([x1, y]);
    for (let x = x1 - 1; x >= x0; x--) pts.push([x, y1]);
    for (let y = y1 - 1; y > y0; y--) pts.push([x0, y]);
    const start = Math.ceil((x1 - x0) / 2);
    return pts.slice(start).concat(pts.slice(0, start));
  }

  // ---- split-flap tiles: char drawn on two flaps with an unlit hinge row
  function flapTile(env, ch, { font, w, inkH, padTop, topRows, bg = ['#262626', '#1c1c1c'], color }) {
    const h = padTop * 2 + inkH + 1; // +1 hinge
    const tmp = new Led(env, w, h - 1);
    if (ch.trim()) tmp.ctext(font, ch, (w - 1) / 2, padTop + inkH, color);
    const tile = new Led(env, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (y === topRows) continue; // hinge stays unlit
      const src = y < topRows ? y : y - 1;
      tile.plot(x, y, y < topRows ? bg[0] : bg[1]);
      const c = tmp.get(x, src);
      if (c[0] || c[1] || c[2]) tile.plot(x, y, c);
    }
    tile.hinge = topRows;
    return tile;
  }

  // Draw tile `b` (new) at x, y; while p is in 0..1, `a` (old) is mid-flip:
  // the old top flap folds down onto the hinge, then the new bottom flap
  // falls open below it.
  function drawFlap(f, x, y, a, b, p) {
    const H = b.h, hg = b.hinge, nb = H - 1 - hg;
    const copy = (tile, sy, dy, k = 1) => { for (let i = 0; i < tile.w; i++) { const c = tile.get(i, sy); f.plot(x + i, y + dy, [c[0] * k, c[1] * k, c[2] * k]); } };
    if (p == null || p >= 1 || !a) { for (let r = 0; r < H; r++) copy(b, r, r); return; }
    for (let r = 0; r < hg; r++) copy(b, r, r);
    for (let r = hg + 1; r < H; r++) copy(a, r, r);
    if (p < 0.5) {
      const q = p * 2, n = Math.round(hg * (1 - q));
      for (let i = 0; i < n; i++) copy(a, Math.floor(i * hg / n), hg - n + i, 1 - 0.5 * q);
    } else {
      const q = (p - 0.5) * 2, n = Math.round(nb * q);
      for (let i = 0; i < n; i++) copy(b, hg + 1 + Math.floor(i * nb / n), hg + 1 + i, 0.5 + 0.5 * q);
    }
  }

  // ---- nixie numerals as wire strokes in a 9 x 19 box (x 0..8, y 0..18)
  function arc(cx, cy, rx, ry, d0, d1, step = 12) {
    const pts = [], n = Math.max(2, Math.ceil(Math.abs(d1 - d0) / step));
    for (let i = 0; i <= n; i++) { const d = (d0 + (d1 - d0) * i / n) * Math.PI / 180; pts.push([cx + rx * Math.sin(d), cy - ry * Math.cos(d)]); }
    return pts;
  }
  const NIXIE = {
    0: [arc(4, 9, 4, 9, 0, 360)],
    1: [[[2.5, 2.5], [4.5, 0], [4.5, 18]]],
    2: [arc(4, 4.2, 4, 4.2, 270, 480).concat([[0, 18], [8, 18]])],
    3: [arc(4, 4.5, 4, 4.5, 270, 540), arc(4, 13.75, 4.2, 4.75, 0, 270)],
    4: [[[6, 18], [6, 0], [0, 12.5], [8.5, 12.5]]],
    5: [[[8, 0], [1, 0], [0.4, 8.2]].concat(arc(4, 12.8, 4.2, 5.6, 318, 610))],
    6: [arc(4, 13, 4, 5.5, 0, 360), arc(8, 13, 8, 13, 270, 352)],
    7: [[[0, 0], [8, 0], [2.5, 18]]],
    8: [arc(4, 4.5, 3.5, 4.5, 0, 360), arc(4, 13.5, 4, 4.5, 0, 360)],
    9: [arc(4, 5.5, 4, 5.5, 0, 360), arc(0, 5.5, 8, 13, 90, 172)],
  };
  function nixieDigit(f, d, ox, oy, a) {
    if (a <= 0) return;
    for (const pass of [[1.5, '#ff5a00', 0.22 * a], [0.5, '#ff9a3c', a]]) {
      const [hw, c, al] = pass;
      for (const poly of NIXIE[d]) for (let i = 1; i < poly.length; i++) {
        const [x0, y0] = poly[i - 1], [x1, y1] = poly[i];
        segA(f, ox + x0, oy + y0, ox + x1, oy + y1, hw, c, al);
      }
    }
  }
  // Like seg(), but scaled by alpha and blended with max() so strokes and
  // glows don't darken each other where they cross.
  function segA(f, x0, y0, x1, y1, hw, color, alpha) {
    const c = rgb(color);
    const xa = Math.floor(Math.min(x0, x1) - hw - 1), xb = Math.ceil(Math.max(x0, x1) + hw + 1);
    const ya = Math.floor(Math.min(y0, y1) - hw - 1), yb = Math.ceil(Math.max(y0, y1) + hw + 1);
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      const a = clamp(hw + 0.5 - segDist(x, y, x0, y0, x1, y1), 0, 1) * alpha;
      if (a <= 0) continue;
      const i = (y * f.w + x) * 3;
      for (let k = 0; k < 3; k++) f.px[i + k] = Math.max(f.px[i + k], c[k] * a);
    }
  }

  // ---- sky: J2000 positions (RA hours, Dec degrees), magnitude, tint
  const STARS = {
    polaris: [2.530, 89.26, 2.0, '#fff4dc'],
    dubhe: [11.062, 61.75, 1.8, '#ffe0b0'], merak: [11.031, 56.38, 2.4], phecda: [11.897, 53.69, 2.4],
    megrez: [12.257, 57.03, 3.3], alioth: [12.900, 55.96, 1.8], mizar: [13.399, 54.93, 2.2], alkaid: [13.792, 49.31, 1.9],
    kochab: [14.845, 74.16, 2.1, '#ffc890'], pherkad: [15.345, 71.83, 3.0],
    yildun: [17.537, 86.59, 4.4], epsUMi: [16.766, 82.04, 4.2], zetaUMi: [15.734, 77.79, 4.3],
    caph: [0.153, 59.15, 2.3], schedar: [0.675, 56.54, 2.2, '#ffd8a8'], gammaCas: [0.945, 60.72, 2.2], ruchbah: [1.430, 60.24, 2.7], segin: [1.907, 63.67, 3.4],
    capella: [5.278, 46.00, 0.1, '#fff0b0'], vega: [18.616, 38.78, 0.0, '#d8e4ff'], deneb: [20.690, 45.28, 1.3],
  };
  const FIGURES = [
    ['dubhe', 'merak', 'phecda', 'megrez', 'dubhe'], ['megrez', 'alioth', 'mizar', 'alkaid'],
    ['polaris', 'yildun', 'epsUMi', 'zetaUMi', 'kochab', 'pherkad'],
    ['caph', 'schedar', 'gammaCas', 'ruchbah', 'segin'],
  ];
  const FAINT = (() => { let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; return Array.from({ length: 26 }, () => [r() * 24, 30 + r() * 60]); })();
  const LAT = 41.99, LON = -87.67; // Rogers Park
  function altAz(d, raH, dec) {
    const R = Math.PI / 180, jd = d.getTime() / 86400000 + 2440587.5;
    const lst = (280.46061837 + 360.98564736629 * (jd - 2451545) + LON) % 360;
    const H = (lst - raH * 15) * R, dc = dec * R, la = LAT * R;
    const alt = Math.asin(Math.sin(la) * Math.sin(dc) + Math.cos(la) * Math.cos(dc) * Math.cos(H));
    const az = Math.atan2(-Math.sin(H) * Math.cos(dc), Math.cos(la) * Math.sin(dc) - Math.sin(la) * Math.cos(dc) * Math.cos(H));
    return [alt / R, az / R];
  }

  const R2 = [
    {
      id: 'r2-loop', group: 'R2', title: 'The Loop',
      note: 'Two trains on the Loop\'s two tracks: Orange laps the outer track once an hour (the minute hand), Pink laps the inner one every 12 hours. The eight Loop stations are platform marks on the edge, roughly where they really are. Moves about one LED every 20 s.',
      draw(f, t) {
        const outer = rectPath(1, 1, 62, 30), inner = rectPath(3, 3, 60, 28);
        for (const [x, y] of outer) f.plot(x, y, '#1f1f1f');
        for (const [x, y] of inner) f.plot(x, y, '#1a1a1a');
        // Clark/Lake, State/Lake (north); Washington/Wabash, Adams/Wabash (east);
        // LaSalle/Van Buren, Library (south); Quincy, Washington/Wells (west)
        for (const x of [25, 49]) f.fill(x, 0, 2, 1, '#4a4a4a');
        for (const y of [9, 21]) f.fill(63, y, 1, 2, '#4a4a4a');
        for (const x of [13, 49]) f.fill(x, 31, 2, 1, '#4a4a4a');
        for (const y of [9, 23]) f.fill(0, y, 1, 2, '#4a4a4a');
        const train = (path, frac, len, color, head) => {
          const i0 = Math.round(frac * path.length);
          for (let k = len - 1; k >= 0; k--) { const [x, y] = path[((i0 - k) % path.length + path.length) % path.length]; f.plot(x, y, k === 0 ? head : color); }
        };
        train(inner, t.hourF, 5, LINE.pink, '#ffc8dc');
        train(outer, t.minF, 7, LINE.orange, '#ffc8a0');
        f.ctext('clock', t.hm, 31.5, 21, C.hand);
      },
    },
    {
      id: 'r2-flap', group: 'R2', title: 'Split-flap board',
      note: 'Departure-board flaps: each digit is printed across two flaps with a dark hinge gap through the middle. On a change the top flap folds down and the new bottom falls open (0.4 s, once a minute). The date runs on small flaps; a blank flap stands in for the leading zero.',
      draw(f, t) {
        const BIG = { font: 'clock', w: 11, inkH: 10, padTop: 2, topRows: 7, color: '#e6e6e6' };
        const SMALL = { font: 'small', w: 5, inkH: 5, padTop: 2, topRows: 4, bg: ['#1f1f1f', '#171717'], color: '#a8a8a8' };
        const e = msInMinute(t), p = e < 400 ? e / 400 : null, pv = prevMinute(t);
        const nowB = big(t).replace(':', ''), oldB = big(pv).replace(':', '');
        [4, 17, 36, 49].forEach((x, i) => {
          const a = oldB[i] !== nowB[i] ? flapTile(f.env, oldB[i], BIG) : null;
          drawFlap(f, x, 2, a, flapTile(f.env, nowB[i], BIG), a ? p : null);
        });
        f.fill(31, 6, 2, 2, C.hand); f.fill(31, 11, 2, 2, C.hand);
        const ds = `${t.day.slice(0, 3)} ${t.date}`.padEnd(10), dp = `${pv.day.slice(0, 3)} ${pv.date}`.padEnd(10);
        for (let i = 0; i < 10; i++) {
          const a = dp[i] !== ds[i] ? flapTile(f.env, dp[i], SMALL) : null;
          drawFlap(f, 2 + i * 6, 21, a, flapTile(f.env, ds[i], SMALL), a ? p : null);
        }
      },
    },
    {
      id: 'r2-minute-train', group: 'R2', title: 'Minute train',
      note: 'The time rides a four-car Red Line train, one digit per car, colon on the coupler. At each new minute the train pulls out to the left and the next one pulls in from the right (about 2.5 s). Headlight on the front, tail light on the back.',
      draw(f, t) {
        const e = msInMinute(t);
        const car = (x0, y0, ch, front, rear) => {
          f.fill(x0 + 1, y0, 13, 1, '#555555');
          f.fill(x0, y0 + 1, 1, 11, '#555555'); f.fill(x0 + 14, y0 + 1, 1, 11, '#555555');
          if (ch.trim()) f.ctext('clock', ch, x0 + 7, y0 + 12, C.amber);
          f.fill(x0, y0 + 12, 15, 1, LINE.red);
          f.fill(x0, y0 + 13, 15, 1, '#444444');
          f.fill(x0 + 2, y0 + 14, 3, 1, '#333333'); f.fill(x0 + 10, y0 + 14, 3, 1, '#333333');
          if (front) f.plot(x0, y0 + 11, '#ffffff');
          if (rear) f.plot(x0 + 14, y0 + 11, '#ff2020');
        };
        const trainAt = (dx, tt) => {
          const s = big(tt).replace(':', '');
          [0, 16, 33, 49].forEach((x, i) => car(x + dx, 4, s[i], i === 0, i === 3));
          f.fill(31 + dx, 8, 2, 2, C.amber); f.fill(31 + dx, 12, 2, 2, C.amber);
          f.plot(15 + dx, 17, '#3a3a3a'); f.fill(31 + dx, 17, 2, 1, '#3a3a3a'); f.plot(48 + dx, 17, '#3a3a3a');
        };
        f.fill(0, 19, 64, 1, '#2a2a2a');
        if (e < 2600) {
          const out = -Math.round(66 * easeIn(clamp(e / 1300, 0, 1)));
          const inn = Math.round(66 * (1 - easeOut(clamp((e - 900) / 1700, 0, 1))));
          trainAt(out, prevMinute(t));
          trainAt(inn, t);
        } else trainAt(0, t);
        f.ctext('small', `${t.day.slice(0, 3)} ${t.date}`, 31.5, 29, C.dim);
      },
    },
    {
      id: 'r2-nixie', group: 'R2', title: 'Nixie tubes',
      note: 'Wire numerals with a soft glow, and the other nine cathodes faintly visible behind the lit one, like real tubes. Digits cross-fade on a change. At the top of each hour all four tubes spin through 0–9, the cycle real nixie clocks run to keep unused cathodes from going dark.',
      draw(f, t) {
        const xs = [2, 16, 36, 50], now = big(t).replace(':', ''), pv = big(prevMinute(t)).replace(':', '');
        const e = msInMinute(t), fade = e < 300 ? e / 300 : 1;
        for (let i = 0; i < 4; i++) {
          const x = xs[i];
          for (let y = 2; y <= 29; y++) { f.plot(x, y, '#1a120c'); f.plot(x + 11, y, '#1a120c'); }
          f.fill(x + 1, 1, 10, 1, '#1a120c'); f.fill(x + 1, 30, 10, 1, '#1a120c');
          const ox = x + 1.5, oy = 6;
          for (let d = 0; d <= 9; d++) for (const poly of NIXIE[d]) for (let k = 1; k < poly.length; k++) {
            segA(f, ox + poly[k - 1][0], oy + poly[k - 1][1], ox + poly[k][0], oy + poly[k][1], 0.45, '#ff7a1a', 0.06);
          }
          let cur = now[i], old = pv[i];
          if (t.m === 0 && e < 1300 + i * 150) { cur = String((Number(now[i].trim() || 0) + Math.floor(e / 70) + i * 3) % 10); old = cur; }
          if (old !== cur && fade < 1 && old.trim()) nixieDigit(f, Number(old), ox, oy, 1 - fade);
          if (cur.trim()) nixieDigit(f, Number(cur), ox, oy, old !== cur ? fade : 1);
        }
        for (const y of [11.5, 19.5]) { disc(f, 31.5, y, 0.9, '#ff6a10'); }
      },
    },
    {
      id: 'r2-stars', group: 'R2', title: 'North sky',
      note: 'The real sky looking north from Rogers Park: Polaris holds still while the Big Dipper and Cassiopeia wheel around it once a day (the old star clock). Positions are computed for the time and date, so the picture also drifts about 2 hours a month. Faint blue sky in daytime. Time and date on the ground.',
      draw(f, t, wx) {
        const HZ = 26, K = 0.38, hour = t.h + t.m / 60;
        const day = hour >= wx.sunrise && hour < wx.sunset;
        if (day) f.fill(0, 0, 64, HZ + 1, '#040a1c');
        const dimK = day ? 0.45 : 1;
        const pos = (raH, dec) => { const [alt, az] = altAz(t.d, raH, dec); return alt < 0 ? null : [31.5 + az * K, HZ - alt * K]; };
        for (const [ra, dec] of FAINT) { const p = pos(ra, dec); if (p) f.plot(Math.round(p[0]), Math.round(p[1]), day ? '#0e1426' : '#20232e'); }
        for (const fig of FIGURES) for (let i = 1; i < fig.length; i++) {
          const a = pos(STARS[fig[i - 1]][0], STARS[fig[i - 1]][1]), b = pos(STARS[fig[i]][0], STARS[fig[i]][1]);
          if (a && b) seg(f, a[0], a[1], b[0], b[1], 0.4, day ? '#101c3c' : '#24325c');
        }
        for (const [ra, dec, mag, tint] of Object.values(STARS)) {
          const p = pos(ra, dec); if (!p) continue;
          const c = rgb(tint || '#e4ecff').map((v) => v * dimK * clamp(1.15 - mag * 0.17, 0.3, 1));
          f.plot(Math.round(p[0]), Math.round(p[1]), c);
        }
        f.text('small', `${t.hm} ${t.ampm}`, 0, 32, '#6a6a6a');
        f.ctext('small', 'N', 31.5, 32, '#333333');
        f.rtext('small', t.date, 63, 32, '#4a4a4a');
      },
    },
    {
      id: 'r2-red-line', group: 'R2', title: 'Red Line day',
      note: 'The day as a 24-hour Red Line trip (it is one of the two lines that run all night): Howard at midnight, 95th at the next midnight, about 45 minutes per stop. The marker creeps one LED every 23 minutes; the top line names the next stop.',
      draw(f, t, wx, tr) {
        const names = f.env.redLine || ['HOWARD', '95/DAN RYAN'];
        const n = names.length - 1, mins = t.h * 60 + t.m + t.s / 60, pos = mins / 1440 * n;
        const next = Math.min(n, Math.floor(pos) + 1);
        const x = f.text('small', 'NEXT ', 0, 6, C.dim);
        f.text('small', names[next], x, 6, C.label);
        f.ctext('clock', t.hm, 26, 19, C.hand);
        f.text('small', t.ampm, 26 + Math.ceil(f.measure('clock', t.hm) / 2) + 3, 18, C.grey);
        const X = (i) => 1 + i * 61 / n, cx = X(pos);
        for (let xx = 1; xx <= 62; xx++) f.plot(xx, 23, xx <= cx ? '#5a0a1a' : LINE.red);
        for (let i = 0; i <= n; i++) f.plot(Math.round(X(i)), 22, i === next ? C.amber : i < next ? '#2a2a2a' : '#555555');
        f.fill(0, 22, 1, 3, LINE.red); f.fill(63, 22, 1, 3, LINE.red);
        f.fill(Math.round(cx) - 1, 23, 3, 2, '#ffffff');
        f.text('small', 'HOWARD', 0, 31, C.dim);
        f.rtext('small', '95TH', 63, 31, C.dim);
      },
    },
    {
      id: 'r2-flag', group: 'R2', title: 'Chicago flag',
      note: 'The flag inverted for LEDs: black field, the two light-blue stripes at about 60%, red digits where the stars go, and one six-pointed star as the colon. Static apart from the minute change.',
      draw(f, t) {
        f.fill(0, 4, 64, 4, '#276d8a'); f.fill(0, 24, 64, 4, '#276d8a');
        const STAR = ['....#....', '...###...', '#########', '.#######.', '..#####..', '.#######.', '#########', '...###...', '....#....'];
        const [hh, mm] = t.hm.split(':');
        const wH = f.measure('clock', hh), wM = f.measure('clock', mm), total = wH + 3 + 9 + 3 + wM;
        let x = Math.round(31.5 - total / 2);
        x = f.text('clock', hh, x, 21, '#ff2a2a') + 2;
        STAR.forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') f.plot(x + i, 11 + j, '#ff2a2a'); }));
        f.text('clock', mm, x + 12, 21, '#ff2a2a');
      },
    },
  ];
  FACES.push(...R2);

  // ================================================================ round 3
  // Time only, one look each. Helpers work on ink masks cropped to the
  // drawn pixels, so faces place glyphs by their ink, not font metrics.
  function mask(env, font, s) {
    const tmp = new Led(env, 120, 40);
    tmp.text(font, s, 2, 30, '#ffffff');
    let x0 = 999, y0 = 999, x1 = -1, y1 = -1;
    for (let y = 0; y < tmp.h; y++) for (let x = 0; x < tmp.w; x++) if (tmp.get(x, y)[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < 0) return { w: 0, h: 0, on: () => false };
    return { w: x1 - x0 + 1, h: y1 - y0 + 1, on: (x, y) => x >= 0 && y >= 0 && x <= x1 - x0 && y <= y1 - y0 && tmp.get(x + x0, y + y0)[0] > 0 };
  }
  // Clock-font digits all share one ink box ('1' would otherwise crop narrow).
  function digitMask(env, font, ch) {
    const m = mask(env, font, ch), ref = mask(env, font, '0');
    if (!ch.trim()) return { w: ref.w, h: ref.h, on: () => false };
    const tmp = new Led(env, 30, 40); tmp.text(font, ch, 2, 30, '#ffffff');
    const r = new Led(env, 30, 40); r.text(font, '0', 2, 30, '#ffffff');
    let x0 = 99, y0 = 99;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 30; x++) if (r.get(x, y)[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
    return { w: ref.w, h: ref.h, on: (x, y) => x >= 0 && y >= 0 && x < ref.w && y < ref.h && tmp.get(x + x0, y + y0)[0] > 0 };
  }
  function drawMask(f, m, ox, oy, color, a = 1) { for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.on(x, y)) f.plot(ox + x, oy + y, color, a); }
  const scale = (c, k) => rgb(c).map((v) => v * k);
  const hash = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  // Big time as one row of masks: 'H', 'HH', ':' , 'MM'. Returns placed items.
  function timeRow(f, t, font, { gap = 2, colonGap = 2, cx = 31.5, lead = false } = {}) {
    const hh = lead ? String(t.h12).padStart(2, '0') : String(t.h12), mm = String(t.m).padStart(2, '0');
    const ds = [...hh].map((c) => digitMask(f.env, font, c)), dm = [...mm].map((c) => digitMask(f.env, font, c)), col = mask(f.env, font, ':');
    const dw = ds[0].w, wH = ds.length * dw + (ds.length - 1) * gap, wM = 2 * dw + gap;
    const total = wH + colonGap + col.w + colonGap + wM;
    let x = Math.round(cx - (total - 1) / 2); const items = [];
    ds.forEach((m, i) => { items.push({ m, x, kind: 'h', i }); x += dw + gap; });
    x += colonGap - gap; items.push({ m: col, x, kind: ':' }); x += col.w + colonGap;
    dm.forEach((m, i) => { items.push({ m, x, kind: 'm', i }); x += dw + gap; });
    return items;
  }

  // ---- seven-segment digits (VFD)
  const SEG7 = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  function seg7(f, ch, x, y, w, h, th, on, off, skew) {
    const lit = ch === ' ' ? '' : SEG7[ch], mid = Math.floor((h - th) / 2);
    const P = (px, py, c) => f.plot(Math.round(px + (h - 1 - py) * skew), y + py, c);
    const hseg = (s, py) => { for (let j = 0; j < th; j++) for (let i = 1 + (j === 0 || j === th - 1 ? 1 : 0) * 0; i < w - 1; i++) P(x + i + (j !== Math.floor(th / 2) ? 0 : 0), py + j, lit.includes(s) ? on : off); };
    const vseg = (s, px, py0, py1) => { for (let j = py0; j <= py1; j++) for (let i = 0; i < th; i++) P(x + px + i, j, lit.includes(s) ? on : off); };
    hseg('a', 0); hseg('g', mid); hseg('d', h - th);
    vseg('f', 0, 1, mid - 1); vseg('b', w - th, 1, mid - 1);
    vseg('e', 0, mid + th, h - th - 1); vseg('c', w - th, mid + th, h - th - 1);
  }

  // ---- drum strip for the odometer: digits 0..9 down a 12 x 180 strip
  const DRUM_PITCH = 18;
  let drumCache = null;
  function drumStrip(env) {
    if (drumCache && drumCache.env === env) return drumCache.m;
    const m = Array.from({ length: 10 }, (_, d) => digitMask(env, 'clock', String(d)));
    drumCache = { env, m };
    return m;
  }
  function drum(f, x0, w, value, ink) {
    const ms = drumStrip(f.env), R = 17, cy = 15.5, dm = ms[0];
    for (let y = 0; y < 32; y++) {
      const off = y - cy, th = Math.asin(clamp(off / R, -1, 1)), shade = Math.cos(th);
      const sy = value * DRUM_PITCH + R * th; // strip coordinate, digit d centered at d*pitch
      const k = Math.floor(sy / DRUM_PITCH + 0.5), local = sy - k * DRUM_PITCH, d = ((k % 10) + 10) % 10;
      const gy = Math.round(local + (dm.h - 1) / 2);
      for (let x = 0; x < w; x++) {
        f.plot(x0 + x, y, scale('#1c1a17', shade * shade));
        const gx = x - Math.floor((w - dm.w) / 2);
        if (ms[d].on(gx, gy)) f.plot(x0 + x, y, scale(ink, Math.pow(shade, 3)));
      }
    }
  }
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

  const R3 = [
    {
      id: 'r3-vfd', group: 'R3', title: 'VFD',
      note: 'A 1980s vacuum-fluorescent alarm clock: slanted seven-segment digits in blue-green, every unlit segment still faintly visible (so the leading digit reads as a ghost 8). AM/PM indicators top right. Fully static.',
      draw(f, t) {
        const on = '#52f5d2', off = '#0e2e28';
        const hh = String(t.h12).padStart(2, ' '), mm = String(t.m).padStart(2, '0');
        const W = 11, H = 22, Y = 8, xs = [3, 16, 36, 49];
        [hh[0], hh[1], mm[0], mm[1]].forEach((c, i) => seg7(f, c, xs[i], Y, W, H, 2, on, off, 0.1));
        f.fill(32, 13, 2, 2, on); f.fill(31, 22, 2, 2, on);
        f.text('small', 'AM', 46, 5, t.ampm === 'AM' ? on : off);
        f.text('small', 'PM', 56, 5, t.ampm === 'PM' ? on : off);
      },
    },
    {
      id: 'r3-marquee', group: 'R3', title: 'Marquee',
      note: 'Theater-marquee bulbs: the 3x5 digits blown up to round 3x3 bulbs (the 1 trimmed to its two lit columns so 12:59 fits) on a 4 px grid over faintly glowing empty sockets, with a chase of single bulbs running around the border (one step every 0.25 s). The chase is the only motion.',
      draw(f, t) {
        const bulb = '#ffd27a', socket = '#160e04', P = 4;
        const cols = [];
        const hh = String(t.h12), mm = String(t.m).padStart(2, '0');
        const gap = () => cols.push(() => false);
        const put = (ch) => {
          const m = digitMask(f.env, 'small', ch);
          for (let c = 0; c < (ch === '1' ? 2 : 3); c++) cols.push((r) => m.on(c, r));
        };
        [...hh].forEach((ch, i) => { if (i) gap(); put(ch); });
        gap(); cols.push((r) => r === 1 || r === 3); gap();
        [...mm].forEach((ch, i) => { if (i) gap(); put(ch); });
        const ox = Math.round(31.5 - (cols.length * P - 2) / 2), oy = 6;
        cols.forEach((on, gx) => { for (let r = 0; r < 5; r++) {
          const x = ox + gx * P, y = oy + r * P, lit = on(r), c = lit ? bulb : socket;
          for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) f.plot(x + i, y + j, c, (i === 1 || j === 1) ? 1 : (lit ? 0.3 : 0));
        } });
        const step = Math.floor((t.s * 1000 + t.ms) / 250);
        for (let i = 0; i < 32; i++) for (const [y, dir] of [[1, 1], [30, -1]]) {
          f.plot(i * 2 + (y === 1 ? 0 : 1), y, (i * dir + step + 64) % 4 === 0 ? '#fff0c8' : '#4a3210');
        }
      },
    },
    {
      id: 'r3-odometer', group: 'R3', title: 'Odometer',
      note: 'Four number drums seen through a window: the neighbors above and below curl away and darken like a real cylinder. At each minute the changed drums roll forward (0.5 s); at 12:59 the hour drums spin all the way round.',
      draw(f, t) {
        const ink = '#f2e6cc', nxt = parts(new Date(t.d.getTime() + 60000));
        const ds = (p) => [Math.floor(p.h12 / 10), p.h12 % 10, Math.floor(p.m / 10), p.m % 10];
        const a = ds(t), b = ds(nxt), msLeft = 60000 - msInMinute(t), k = msLeft < 500 ? easeInOut(1 - msLeft / 500) : 0;
        const xs = [2, 15, 37, 50];
        a.forEach((d, i) => {
          let to = b[i]; if (to < d) to += 10;
          drum(f, xs[i], 12, d + (to - d) * k, i === 0 && d === 0 && k === 0 ? '#5a5448' : ink);
        });
        f.fill(31, 11, 2, 2, '#ffb000'); f.fill(31, 19, 2, 2, '#ffb000');
      },
    },
    {
      id: 'r3-seventies', group: 'R3', title: 'Seventies',
      note: 'Supergraphics: three stripes in sunflower, orange and rust run along the bottom and sweep up the right edge; the digits are banded in the same three colors, top to bottom. Fully static.',
      draw(f, t) {
        const COL = ['#ffc23a', '#ff7414', '#d2361a'];
        const cx = 51, cy = 17;
        [6, 9, 12].forEach((r, i) => {
          f.fill(0, cy + r - 1, cx, 2, COL[i]);
          f.fill(cx + r - 1, 0, 2, cy, COL[i]);
          ring(f, cx - 0.5, cy - 0.5, r - 0.5 + 0.5, 2, COL[i], 0.25, 0.5);
        });
        const items = timeRow(f, t, 'clock', { gap: 3, colonGap: 3, cx: 23 });
        for (const it of items) for (let y = 0; y < it.m.h; y++) for (let x = 0; x < it.m.w; x++) if (it.m.on(x, y)) f.plot(it.x + x, 3 + y, COL[Math.min(2, Math.floor(y / 5))]);
      },
    },
    {
      id: 'r3-neon', group: 'R3', title: 'Neon sign',
      note: 'A pink neon time in a cyan tube frame, each stroke with a soft halo. Every few minutes one digit stutters for half a second, like a tired transformer; otherwise static.',
      draw(f, t) {
        const pink = '#ff3fa4', core = '#ffc2e4', cyan = '#2fd6ff';
        const halo = (x, y, c, a) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) f.plot(x + dx, y + dy, c, a * (dx && dy ? 0.12 : 0.22)); };
        // frame: rounded rect tube
        const fr = rectPath(2, 2, 61, 29).filter(([x, y]) => !((x < 4 || x > 59) && (y < 4 || y > 27)) || (x === 3 && y === 3) || (x === 60 && y === 3) || (x === 3 && y === 28) || (x === 60 && y === 28));
        const fr2 = fr.filter(([x, y]) => !((x === 2 || x === 61) && (y === 3 || y === 28)) && !((y === 2 || y === 29) && (x === 3 || x === 60)));
        for (const [x, y] of fr2) halo(x, y, cyan, 1);
        for (const [x, y] of fr2) f.plot(x, y, cyan);
        const items = timeRow(f, t, 'clock', { gap: 3, colonGap: 3 });
        const slot = Math.floor(t.d.getTime() / 500), r = hash(Math.floor(slot / 6)), digits = items.filter((it) => it.kind !== ':');
        const victim = r < 0.12 ? digits[Math.floor(hash(slot) * digits.length)] : null;
        for (const it of items) {
          const k = it === victim && slot % 2 ? 0.25 : 1;
          for (let y = 0; y < it.m.h; y++) for (let x = 0; x < it.m.w; x++) if (it.m.on(x, y)) halo(it.x + x, 9 + y, pink, k);
        }
        for (const it of items) {
          const k = it === victim && slot % 2 ? 0.25 : 1;
          drawMask(f, it.m, it.x, 9, scale(it.kind === ':' ? cyan : pink, k));
          // a brighter core where the stroke is two pixels thick
          for (let y = 0; y < it.m.h; y++) for (let x = 0; x < it.m.w; x++) if (it.m.on(x, y) && it.m.on(x + 1, y) && it.kind !== ':') f.plot(it.x + x, 9 + y, scale(core, k), 0.55);
        }
      },
    },
    {
      id: 'r3-bauhaus', group: 'R3', title: 'Bauhaus',
      note: 'Primary-color composition: the hour inside a red disc, minutes in white beside it, a yellow bar underneath and a small blue square in the corner. Fully static; the layout is the same at every hour.',
      draw(f, t) {
        disc(f, 13.5, 15.5, 13.2, '#e3301c');
        const hm = mask(f.env, 'clock', String(t.h12));
        drawMask(f, hm, Math.round(13.5 - (hm.w - 1) / 2), Math.round(15.5 - (hm.h - 1) / 2), '#fff6e6');
        const mm = mask(f.env, 'clock', String(t.m).padStart(2, '0'));
        drawMask(f, mm, 34, 6, '#fff6e6');
        f.fill(34, 24, 30, 3, '#ffc412');
        f.fill(58, 0, 6, 6, '#2b5ce0');
      },
    },
    {
      id: 'r3-fireflies', group: 'R3', title: 'Fireflies',
      note: 'The 5x7 digits at double size, every LED in them pulsing on its own slow beat (3–7 s), with a few loose fireflies drifting around them. Ambient motion, nothing sharp.',
      draw(f, t) {
        const now = t.d.getTime() / 1000, col = '#d4ff52';
        const items = timeRow(f, t, '5x7', { gap: 1, colonGap: 1 });
        const x0 = items[0].x, last = items[items.length - 1], span = (last.x + last.m.w - x0) * 2;
        const ox = Math.round(32 - span / 2);
        for (const it of items) for (let y = 0; y < it.m.h; y++) for (let x = 0; x < it.m.w; x++) if (it.m.on(x, y)) {
          for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
            const px = ox + (it.x - x0 + x) * 2 + i, py = 9 + y * 2 + j, id = px * 64 + py;
            const per = 3 + hash(id) * 4, ph = hash(id + 7);
            f.plot(px, py, scale(col, 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(TAU * (now / per + ph)), 2)));
          }
        }
        for (let i = 0; i < 6; i++) {
          const ax = hash(i * 3 + 1), ay = hash(i * 3 + 2), sp = 0.02 + hash(i * 3 + 3) * 0.03;
          const x = 31.5 + 30 * Math.sin(TAU * (now * sp + ax)) , y = 15.5 + 14 * Math.sin(TAU * (now * sp * 1.7 + ay));
          const k = Math.max(0, Math.sin(TAU * (now / (4 + i) + ax))) * 0.7;
          f.plot(Math.round(x), Math.round(y), scale('#8cff3a', k));
        }
      },
    },
    {
      id: 'r3-terminal', group: 'R3', title: 'Terminal',
      note: 'Green-phosphor CRT: a prompt line, the time in the big digits with alternate rows dimmed like scanlines and a faint bloom, and a block cursor blinking once a second.',
      draw(f, t) {
        const g = '#3dff72';
        f.text('small', '> TIME', 1, 6, scale(g, 0.55));
        const items = timeRow(f, t, 'clock', { gap: 2, colonGap: 3, cx: 26 });
        const Y = 11;
        for (const it of items) for (let y = 0; y < it.m.h; y++) for (let x = 0; x < it.m.w; x++) if (it.m.on(x, y)) {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f.plot(it.x + x + dx, Y + y + dy, g, 0.08);
        }
        for (const it of items) for (let y = 0; y < it.m.h; y++) for (let x = 0; x < it.m.w; x++) if (it.m.on(x, y)) f.plot(it.x + x, Y + y, scale(g, (Y + y) % 2 ? 0.6 : 1));
        const last = items[items.length - 1], cx0 = last.x + last.m.w + 3;
        if (t.ms < 500) for (let y = 0; y < 15; y++) f.fill(cx0, Y + y, 6, 1, scale(g, (Y + y) % 2 ? 0.6 : 1));
      },
    },
  ];
  FACES.push(...R3);

  // ---- Seventies type: digits as centerline paths (unit box, y down) with
  // squared-off superellipse curves, stroked at any weight. No font file.
  function sq(cx, cy, rx, ry, d0, d1, n = 2.6, step = 6) {
    const p = 2 / n, pw = (v) => Math.sign(v) * Math.pow(Math.abs(v), p), pts = [];
    const k = Math.max(2, Math.ceil(Math.abs(d1 - d0) / step));
    for (let i = 0; i <= k; i++) { const a = (d0 + (d1 - d0) * i / k) * Math.PI / 180; pts.push([cx + rx * pw(Math.sin(a)), cy - ry * pw(Math.cos(a))]); }
    return pts;
  }
  const flip = (polys) => polys.map((pl) => pl.map(([x, y]) => [1 - x, 1 - y]));
  const SIX = [[[0.5, 0.36], [0, 0.68]].concat(sq(0.5, 0.68, 0.5, 0.32, 270, 630)).slice(0, 0), [[0.82, 0]].concat([[0.3, 0.4]]), sq(0.5, 0.68, 0.5, 0.32, 0, 360)];
  const D70 = {
    0: [sq(0.5, 0.5, 0.5, 0.5, 0, 360)],
    1: [[[0.22, 0.2], [0.62, 0], [0.62, 1]]],
    2: [sq(0.5, 0.28, 0.5, 0.28, 270, 450).concat([[0, 1], [1, 1]])],
    3: [[[0, 0], [1, 0], [0.4, 0.4]].concat(sq(0.5, 0.69, 0.5, 0.31, 0, 250))],
    4: [[[0.72, 1], [0.72, 0], [0, 0.68], [1, 0.68]]],
    5: [[[1, 0], [0.04, 0], [0, 0.44]].concat(sq(0.5, 0.69, 0.5, 0.31, 300, 610))],
    6: SIX.slice(1),
    7: [[[0, 0], [1, 0], [0.32, 1]]],
    8: [sq(0.5, 0.24, 0.4, 0.24, 0, 360), sq(0.5, 0.74, 0.5, 0.26, 0, 360)],
    9: flip(SIX.slice(1)),
  };
  // Distance field of a digit in a w x h cell; the path sits `inset` px in.
  function digitField(ch, w, h, inset) {
    const polys = D70[ch] || [], sx = w - 1 - 2 * inset, sy = h - 1 - 2 * inset;
    const segs = [];
    for (const pl of polys) for (let i = 1; i < pl.length; i++) segs.push([inset + pl[i - 1][0] * sx, inset + pl[i - 1][1] * sy, inset + pl[i][0] * sx, inset + pl[i][1] * sy]);
    return (x, y) => { let d = 99; for (const g of segs) d = Math.min(d, segDist(x, y, ...g)); return d; };
  }
  // Lay out H:MM in cells; paint(x, y, d, row) decides each pixel's color.
  function time70(f, t, { w, h, inset, gap, colonW, x0, y0, paint }) {
    const hh = String(t.h12), mm = String(t.m).padStart(2, '0');
    let x = x0;
    const cell = (ch) => {
      const fd = digitField(ch, w, h, inset);
      for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) { const c = paint(fd(i, y), y / (h - 1)); if (c) f.plot(x + i, y0 + y, c); }
      x += w + gap;
    };
    [...hh].forEach(cell);
    return { cell, colon: (draw) => { draw(x, y0); x += colonW + gap; }, rest: () => [...mm].forEach(cell), end: () => x - gap };
  }
  const C70 = ['#ffc23a', '#ff7414', '#d2361a'];
  function stripes70(f, cx, cy, radii) {
    radii.forEach((r, i) => {
      f.fill(0, cy + r - 1, cx, 2, C70[i]);
      f.fill(cx + r - 1, 0, 2, cy, C70[i]);
      ring(f, cx - 0.5, cy - 0.5, r, 2, C70[i], 0.25, 0.5);
    });
  }
  const mix = (a, b, k) => rgb(a).map((v, i) => v + (rgb(b)[i] - v) * k);
  const band = (v) => C70[Math.min(2, Math.floor(v * 3))];
  const grad = (v) => (v < 0.5 ? mix(C70[0], C70[1], v * 2) : mix(C70[1], C70[2], (v - 0.5) * 2));

  // Hand-drawn rounded digit bitmaps (rows top to bottom, '#' lit).
  const ROUND = {
    w: 8, h: 12, colon: [3, 8],
    0: ['..####..', '.######.', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '.######.', '..####..'],
    1: ['...##...', '..###...', '.####...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...'],
    2: ['..####..', '.######.', '##....##', '......##', '.....##.', '....###.', '...###..', '..###...', '.###....', '###.....', '########', '########'],
    3: ['..####..', '.######.', '##....##', '......##', '......##', '...####.', '...####.', '......##', '......##', '##....##', '.######.', '..####..'],
    4: ['....###.', '...####.', '..##.##.', '.##..##.', '##...##.', '##...##.', '########', '########', '.....##.', '.....##.', '.....##.', '.....##.'],
    5: ['########', '########', '##......', '##......', '######..', '#######.', '......##', '......##', '......##', '##....##', '.######.', '..####..'],
    6: ['..#####.', '.######.', '##......', '##......', '##.###..', '#######.', '###...##', '##....##', '##....##', '##....##', '.######.', '..####..'],
    7: ['########', '########', '......##', '.....##.', '.....##.', '....##..', '....##..', '...##...', '...##...', '..##....', '..##....', '..##....'],
    8: ['..####..', '.######.', '##....##', '##....##', '##....##', '.######.', '.######.', '##....##', '##....##', '##....##', '.######.', '..####..'],
  };
  ROUND[9] = ROUND[6].map((r) => [...r].reverse().join('')).reverse();
  const LIGHT = {
    w: 6, h: 11, colon: [3, 7],
    0: ['.####.', '#....#', '#....#', '#....#', '#....#', '#....#', '#....#', '#....#', '#....#', '#....#', '.####.'],
    1: ['..#...', '.##...', '#.#...', '..#...', '..#...', '..#...', '..#...', '..#...', '..#...', '..#...', '..#...'],
    2: ['.####.', '#....#', '.....#', '.....#', '....#.', '...#..', '..#...', '.#....', '#.....', '#.....', '######'],
    3: ['.####.', '#....#', '.....#', '.....#', '.....#', '..###.', '.....#', '.....#', '.....#', '#....#', '.####.'],
    4: ['....#.', '...##.', '..#.#.', '.#..#.', '#...#.', '#...#.', '######', '....#.', '....#.', '....#.', '....#.'],
    5: ['######', '#.....', '#.....', '#.....', '#####.', '.....#', '.....#', '.....#', '.....#', '#....#', '.####.'],
    6: ['.####.', '#.....', '#.....', '#.....', '#.###.', '##...#', '#....#', '#....#', '#....#', '#....#', '.####.'],
    7: ['######', '.....#', '.....#', '....#.', '....#.', '...#..', '...#..', '..#...', '..#...', '..#...', '..#...'],
    8: ['.####.', '#....#', '#....#', '#....#', '#....#', '.####.', '#....#', '#....#', '#....#', '#....#', '.####.'],
  };
  LIGHT[9] = LIGHT[6].map((r) => [...r].reverse().join('')).reverse();

  // H:MM in a bitmap font, centered on cx, top row y0; color(v) per row (0..1).
  function bitmapTime(f, t, F, { gap, cx, y0, dot, color }) {
    const hh = String(t.h12), mm = String(t.m).padStart(2, '0');
    const total = (hh.length + 2) * F.w + (hh.length + 1) * gap + dot + gap;
    let x = Math.round(cx - (total - 1) / 2);
    const digit = (ch) => { F[ch].forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') f.plot(x + i, y0 + j, color(j / (F.h - 1))); })); x += F.w + gap; };
    [...hh].forEach(digit);
    for (const r of F.colon) f.fill(x, y0 + r, dot, dot, color(r / (F.h - 1)));
    x += dot + gap;
    [...mm].forEach(digit);
  }

  const S70 = [
    {
      id: 's70-round', group: 'S70', title: 'Rounded',
      note: '8 x 12 hand-drawn digits with 2 px strokes and rounded corners (VAG Rounded territory), banded sunflower, orange and rust like the original. Same weight as the 9x15 bold, a size smaller.',
      draw(f, t) {
        stripes70(f, 54, 21, [3, 6, 9]);
        bitmapTime(f, t, ROUND, { gap: 2, cx: 26, y0: 5, dot: 2, color: band });
      },
    },
    {
      id: 's70-round-light', group: 'S70', title: 'Rounded light',
      note: '6 x 11 digits with 1 px strokes and rounded corners. Lighter and smaller, leaving more black around the stripes; banded the same way.',
      draw(f, t) {
        stripes70(f, 54, 21, [3, 6, 9]);
        bitmapTime(f, t, LIGHT, { gap: 2, cx: 26, y0: 5, dot: 1, color: band });
      },
    },
  ];
  FACES.push(...S70);

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
