'use strict';
// Round 4 clock faces: styles borrowed from popular faces on other LED clocks
// (Tidbyt, AWTRIX on the Ulanzi TC001, LaMetric). Loaded after faces.js and
// pushed onto its FACES; uses its Led frame and parts().

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./faces'));
  else factory(root.ClockFaces);
})(typeof self !== 'undefined' ? self : this, function (CF) {
  const { FACES, MOCK, parts } = CF;
  const DAY = { white: '#e6e6e6', grey: '#8f8f8f', dim: '#555555', faint: '#262626' };
    const isDay = (t, wx) => { const h = t.h + t.m / 60; return h >= wx.sunrise && h < wx.sunset; };
  // Hours without a leading zero; the first digit slot is blank before 10.
  const digits4 = (t) => [t.h12 >= 10 ? '1' : ' ', String(t.h12 % 10), String(Math.floor(t.m / 10)), String(t.m % 10)];

  // ---- big digits: 12 x 28, 3 px strokes, built from rectangles and quarter
  // rounds so they stay crisp (no anti-aliasing). Like Tidbyt's Big Clock.
  const BW = 12, BH = 28, T = 3;
  function bigGlyph(d) {
    const g = Array.from({ length: BH }, () => new Array(BW).fill(0));
    const rect = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= 0 && j < BH && i >= 0 && i < BW) g[j][i] = 1; };
    // A rounded box outline from y0 to y1 (inclusive), corner radius 4.
    const loop = (y0, y1, sides = 'tlbr') => {
      const R = 4;
      if (sides.includes('t')) rect(R, y0, BW - 2 * R, T);
      if (sides.includes('b')) rect(R, y1 - T + 1, BW - 2 * R, T);
      if (sides.includes('l')) rect(0, y0 + R, T, y1 - y0 + 1 - 2 * R);
      if (sides.includes('r')) rect(BW - T, y0 + R, T, y1 - y0 + 1 - 2 * R);
      // quarter rounds: pixels between radius R-T and R from the corner centers
      const corners = [[R - 0.5, y0 + R - 0.5, 'tl'], [BW - R - 0.5, y0 + R - 0.5, 'tr'], [R - 0.5, y1 - R + 0.5, 'bl'], [BW - R - 0.5, y1 - R + 0.5, 'br']];
      for (const [cx, cy, k] of corners) {
        if (!(sides.includes(k[0]) || sides.includes(k[1]))) continue;
        for (let j = 0; j < BH; j++) for (let i = 0; i < BW; i++) {
          const dx = i - cx, dy = j - cy, r = Math.hypot(dx, dy);
          const inQ = (k[1] === 'l' ? dx <= 0 : dx >= 0) && (k[0] === 't' ? dy <= 0 : dy >= 0);
          if (inQ && r <= R + 0.1 && r >= R - T + 0.2 && (k[1] === 'l' ? i < R : i >= BW - R) && (k[0] === 't' ? j < y0 + R : j > y1 - R)) g[j][i] = 1;
        }
      }
    };
    const mid = 13; // middle bar rows 13..15
    switch (d) {
      case '0': loop(0, BH - 1); break;
      case '1': rect(5, 0, T, BH); rect(2, 2, 3, 3); rect(3, 1, 2, 1); break;
      case '2': loop(0, mid + 6, 't'); rect(BW - T, 4, T, 6); for (let j = 9; j < BH - T; j++) { const x = Math.round(BW - T - (j - 9) * (BW - T) / (BH - T - 9)); rect(x, j, T, 1); } rect(0, BH - T, BW, T); break;
      case '3': loop(0, mid + 2, 'tr'); loop(mid, BH - 1, 'br'); rect(3, mid, BW - 6, T); break;
      case '4': for (let j = 0; j < 18; j++) rect(Math.round(7 - j * 7 / 17), j, T, 1); rect(0, 18, BW, T); rect(7, 0, T, BH); break;
      case '5': rect(0, 0, BW, T); rect(0, 0, T, mid + 1); loop(mid - 1, BH - 1, 'brb'); rect(0, mid - 1, BW - 4, T); break;
      case '6': loop(mid - 1, BH - 1); for (let j = 0; j < mid + 2; j++) rect(Math.max(0, Math.round(7 - j * 8 / mid)), j, T, 1); rect(1, 10, T, 8); break;
      case '7': rect(0, 0, BW, T); for (let j = T; j < BH; j++) rect(Math.round(BW - T - (j - T) * 6 / (BH - T)), j, T, 1); break;
      case '8': loop(0, mid + 2); loop(mid, BH - 1); break;
      case '9': loop(0, mid + 2); for (let j = mid; j < BH; j++) rect(Math.min(BW - T, Math.round(BW - T - (j - mid) * 8 / (BH - mid))), j, T, 1); rect(BW - T - 1, 10, T, 8); break;
      default: break;
    }
    return g;
  }
  const GLYPHS = {};
  const glyph = (d) => (GLYPHS[d] ||= bigGlyph(d));
  function bigDigit(f, d, x, y, color) {
    if (!d.trim()) return;
    glyph(d).forEach((row, j) => row.forEach((v, i) => { if (v) f.plot(x + i, y + j, color); }));
  }
  function bigTime(f, t, color, blink) {
    const xs = [1, 15, 37, 51], d = digits4(t);
    d.forEach((ch, i) => bigDigit(f, ch, xs[i], 2, color));
    if (!blink || t.ms < 500) { f.fill(31, 9, 2, 3, color); f.fill(31, 19, 2, 3, color); }
  }

  // ---- seven segments: 11 x 26 digits, 2 px segments, unlit ones ghosted.
  const SEGS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  function sevenSeg(f, d, x, y, on, off) {
    const lit = d.trim() ? SEGS[d] : '';
    const S = {
      a: [x + 2, y, 7, 2], g: [x + 2, y + 12, 7, 2], d: [x + 2, y + 24, 7, 2],
      f: [x, y + 2, 2, 10], b: [x + 9, y + 2, 2, 10], e: [x, y + 14, 2, 10], c: [x + 9, y + 14, 2, 10],
    };
    // The segments stop short of each other, so neighbours read as separate.
    for (const [k, [sx, sy, w, h]] of Object.entries(S)) f.fill(sx, sy, w, h, lit.includes(k) ? on : off);
  }

  // ---- shared: weekday bar along the bottom (AWTRIX), Sunday first.
  function weekBar(f, t, y, on, off) {
    const today = t.d.getDay();
    for (let i = 0; i < 7; i++) f.fill(2 + i * 9, y, 7, 1, i === today ? on : off);
  }
  function calendarTile(f, t, x, y) {
    // 20 x 22: red top band with the month, a dark page with the date in
    // white (a lit white page would glare and swallow dark digits).
    f.fill(x + 1, y, 18, 1, '#c01818'); f.fill(x, y + 1, 20, 6, '#c01818');
    f.ctext('small', t.date.slice(0, 3), x + 9.5, y + 6, '#ffffff');
    f.fill(x, y + 7, 20, 14, '#1c1c1c'); f.fill(x + 1, y + 21, 18, 1, '#1c1c1c');
    f.ctext('5x7', String(t.d.getDate()), x + 9.5, y + 18, '#ffffff');
  }
  function iconX2(f, name, x, y) {
    const { ICONS, PALETTE } = f.env.icons;
    ICONS[name].forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') f.fill(x + i * 2, y + j * 2, 2, 2, PALETTE[c]); }));
  }

  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // ---- world clock: local time per zone, from Intl (browser and Node).
  function zoneParts(d, tz) {
    const s = d.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: false, weekday: 'short' });
    const m = s.match(/(\w+),? (\d+):(\d+)/);
    const h = Number(m[2]) % 24, mm = Number(m[3]);
    return { wd: m[1].toUpperCase(), d: WD.indexOf(m[1].slice(0, 3)), h, hm: `${h % 12 || 12}:${String(mm).padStart(2, '0')}`, ampm: h < 12 ? 'A' : 'P' };
  }

  const R4 = [
    {
      id: 'r4-big', group: 'R4', title: 'Big digits',
      note: 'After Tidbyt\'s Big Clock (one of its most installed clock apps): the time and nothing else, in 12 x 28 digits that fill the panel. White by day; the colon blinks once a second (optional).',
      draw(f, t) { bigTime(f, t, DAY.white, true); },
    },
    {
      id: 'r4-big-night', group: 'R4', title: 'Big digits, night',
      note: 'The same face after sunset: Big Clock switches to a dark red from sunset to sunrise, which reads across a dark room without lighting it. Uses the sun times the board already gets for the skyline.',
      draw(f, t) { bigTime(f, t, '#9a0c0c', true); },
    },
    {
      id: 'r4-seven-seg', group: 'R4', title: 'Seven-segment',
      note: 'The bedside alarm clock (and AWTRIX\'s big-time look): red segments with the unlit ones faintly visible, like a real LED display. A dot at the lower left marks PM.',
      draw(f, t) {
        const on = '#ff2410', off = '#2a0704', xs = [4, 17, 35, 48], d = digits4(t);
        d.forEach((ch, i) => sevenSeg(f, ch, xs[i], 3, on, off));
        f.fill(31, 9, 2, 2, on); f.fill(31, 19, 2, 2, on);
        f.fill(0, 27, 2, 2, t.h >= 12 ? on : off);
      },
    },
    {
      id: 'r4-calendar', group: 'R4', title: 'Calendar + weekday bar',
      note: 'AWTRIX\'s default time app (TMODE 1) scaled up: a tear-off calendar page with the date, the time beside it, and seven dashes along the bottom for the days of the week, today\'s bright. Same idea as LaMetric\'s icon + time.',
      draw(f, t) {
        calendarTile(f, t, 1, 2);
        f.ctext('clock', t.hm, 43.5, 18, DAY.white);
        f.ctext('small', t.ampm, 43.5, 25, DAY.dim);
        weekBar(f, t, 30, DAY.white, DAY.faint);
      },
    },
    {
      id: 'r4-icon-time', group: 'R4', title: 'Weather icon + time',
      note: 'LaMetric\'s layout: a big icon on the left, the time on the right, the temperature under it. The icon is the board\'s own 8 x 8 weather icon doubled. Weekday bar as on the calendar face.',
      draw(f, t, wx) {
        iconX2(f, wx.icon, 2, 5);
        f.ctext('clock', t.hm, 43.5, 15, DAY.white);
        const s = `${wx.temp}°  ${wx.hi}/${wx.lo}`;
        f.ctext('small', s, 43.5, 25, DAY.grey);
        weekBar(f, t, 30, DAY.white, DAY.faint);
      },
    },
    {
      id: 'r4-date-time', group: 'R4', title: 'Day, time, date',
      note: 'Tidbyt\'s Date Time Clock: the weekday, the time and the date stacked and centered, nothing else. The plainest face here and the easiest to read across a room.',
      draw(f, t) {
        f.ctext('small', t.day, 31.5, 6, DAY.grey);
        const w = f.measure('clock', t.hm), x0 = Math.round(31.5 - (w + 2 + f.measure('small', t.ampm)) / 2);
        const x = f.text('clock', t.hm, x0, 21, DAY.white);
        f.text('small', t.ampm, x + 2, 18, DAY.dim);
        f.ctext('5x7', t.date, 31.5, 31, DAY.grey);
      },
    },
    {
      id: 'r4-world', group: 'R4', title: 'World clock',
      note: 'Tidbyt\'s World Clock: three cities, one per row, each with its time and a sun or moon. Chicago on top in white; the others in grey, with the weekday when it differs from here.',
      draw(f, t) {
        const here = zoneParts(t.d, 'America/Chicago');
        const zones = [['CHI', 'America/Chicago'], ['LON', 'Europe/London'], ['TYO', 'Asia/Tokyo']];
        zones.forEach(([code, tz], i) => {
          const z = zoneParts(t.d, tz), base = 9 + i * 10, main = i === 0;
          const c = main ? DAY.white : DAY.grey;
          f.text('5x7', code, 1, base, main ? DAY.white : DAY.dim);
          const day = z.h >= 7 && z.h < 18;
          f.icon(day ? 'sun' : 'moon', 25, base - 7);
          const right = 63 - f.measure('small', z.ampm) - 2;
          f.rtext('5x7', z.hm, right, base, c);
          f.text('small', z.ampm, right + 2, base, DAY.dim);
          // A day ahead or behind Chicago: +1 / -1 between the code and the icon.
          const off = (z.d - here.d + 7) % 7;
          if (off) f.text('small', off === 1 ? '+1' : '-1', 18, base, DAY.dim);
        });
      },
    },
  ];
  FACES.push(...R4);
  return R4;
});
