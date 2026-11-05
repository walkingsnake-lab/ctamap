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

  // ---- big digits: BW x BH, T px strokes, built from rectangles and quarter
  // rounds so they stay crisp (no anti-aliasing). Like Tidbyt's Big Clock.
  // 64 wide: 12 x 28, 3 px; 128 wide: 17 x 28, 4 px.
  function bigGlyph(d, BW, BH, T) {
    const R = T + 1, g = Array.from({ length: BH }, () => new Array(BW).fill(0));
    const rect = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= 0 && j < BH && i >= 0 && i < BW) g[j][i] = 1; };
    // A rounded box outline from y0 to y1 (inclusive), corner radius R.
    const loop = (y0, y1, sides = 'tlbr') => {
      if (sides.includes('t')) rect(R, y0, BW - 2 * R, T);
      if (sides.includes('b')) rect(R, y1 - T + 1, BW - 2 * R, T);
      if (sides.includes('l')) rect(0, y0 + R, T, y1 - y0 + 1 - 2 * R);
      if (sides.includes('r')) rect(BW - T, y0 + R, T, y1 - y0 + 1 - 2 * R);
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
    const mid = 13, sx = Math.round((BW - T) / 2), lean = BW - T - 2;
    switch (d) {
      case '0': loop(0, BH - 1); break;
      case '1': rect(sx, 0, T, BH); rect(sx - T, 2, T, T); rect(sx - T + 1, 1, T - 1, 1); break;
      case '2': loop(0, mid + 6, 't'); rect(BW - T, R, T, 6); for (let j = 9; j < BH - T; j++) rect(Math.round(BW - T - (j - 9) * (BW - T) / (BH - T - 9)), j, T, 1); rect(0, BH - T, BW, T); break;
      case '3': loop(0, mid + 2, 'tr'); loop(mid, BH - 1, 'br'); rect(T, mid, BW - 2 * T, T); break;
      case '4': for (let j = 0; j < 18; j++) rect(Math.round(lean - j * lean / 17), j, T, 1); rect(0, 18, BW, T); rect(lean, 0, T, BH); break;
      case '5': rect(0, 0, BW, T); rect(0, 0, T, mid + 1); loop(mid - 1, BH - 1, 'brb'); rect(0, mid - 1, BW - R, T); break;
      case '6': loop(mid - 1, BH - 1); for (let j = 0; j < mid + 2; j++) rect(Math.max(0, Math.round(lean - j * (BW - 4) / mid)), j, T, 1); rect(1, 10, T, 8); break;
      case '7': rect(0, 0, BW, T); for (let j = T; j < BH; j++) rect(Math.round(BW - T - (j - T) * (BW / 2) / (BH - T)), j, T, 1); break;
      case '8': loop(0, mid + 2); loop(mid, BH - 1); break;
      case '9': loop(0, mid + 2); for (let j = mid; j < BH; j++) rect(Math.min(BW - T, Math.round(BW - T - (j - mid) * (BW - 4) / (BH - mid))), j, T, 1); rect(BW - T - 1, 10, T, 8); break;
      default: break;
    }
    return g;
  }
  const GLYPHS = {};
  function bigDigit(f, d, x, y, color, BW = 12, T = 3) {
    if (!d.trim()) return;
    const k = `${d}${BW}${T}`;
    (GLYPHS[k] ||= bigGlyph(d, BW, 28, T)).forEach((row, j) => row.forEach((v, i) => { if (v) f.plot(x + i, y + j, color); }));
  }
  function bigTime(f, t, color, blink) {
    const xs = [1, 15, 37, 51], d = digits4(t);
    d.forEach((ch, i) => bigDigit(f, ch, xs[i], 2, color));
    if (!blink || t.ms < 500) { f.fill(31, 9, 2, 3, color); f.fill(31, 19, 2, 3, color); }
  }

  // ---- seven segments: 11 x 26 digits, 2 px segments, unlit ones ghosted.
  const SEGS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  // W x H digit, T px segments; H - T must be even (the middle bar centered).
  function sevenSeg(f, d, x, y, on, off, W = 11, H = 26, T = 2) {
    const lit = d.trim() ? SEGS[d] : '', mid = (H - T) / 2, vh = mid - T;
    const S = {
      a: [x + T, y, W - 2 * T, T], g: [x + T, y + mid, W - 2 * T, T], d: [x + T, y + H - T, W - 2 * T, T],
      f: [x, y + T, T, vh], b: [x + W - T, y + T, T, vh], e: [x, y + mid + T, T, vh], c: [x + W - T, y + mid + T, T, vh],
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

  // ---- 128 x 32 (two chained panels; docs/board/wide-spec.md principles:
  // use the width, same fonts and rows as 64, side panels only where they
  // mean something).
  const MONTHS_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const weekOf = (d) => { const s = new Date(d.getFullYear(), 0, 1); return Math.ceil(((d - s) / 86400000 + s.getDay() + 1) / 7); };
  // Weekday strip across the full width: SUN..SAT in Tom Thumb over a dash,
  // today's label and dash bright (AWTRIX's bar, spelled out).
  function weekStrip(f, t) {
    const today = t.d.getDay();
    for (let i = 0; i < 7; i++) {
      const cx = 1 + i * 18 + 8.5, on = i === today;
      f.ctext('small', DAY3[i], cx, 29, on ? DAY.white : '#3a3a3a');
      f.fill(Math.round(cx - 6.5), 31, 14, 1, on ? DAY.white : DAY.faint);
    }
  }
  function bigTime128(f, t, color, blink) {
    // 17 x 28 digits, 4 px strokes: 4 + 4 + 12 (colon) + 4 + 4 = 88 px, centered.
    const d = digits4(t), xs = [20, 41, 70, 91];
    d.forEach((ch, i) => bigDigit(f, ch, xs[i], 2, color, 17, 4));
    if (!blink || t.ms < 500) { f.fill(63, 9, 3, 3, color); f.fill(63, 19, 3, 3, color); }
    f.text('5x7', t.ampm, 112, 30, color === DAY.white ? DAY.dim : '#4a0606');
  }
  // 24 hours as a strip, night blue and day amber, with a bright tick at the
  // zone's current time. Sun times are rough (7:00-18:00) in the mockup.
  function dayStrip(f, x, y, w, h24) {
    for (let i = 0; i < w; i++) {
      const hr = (i + 0.5) * 24 / w, day = hr >= 7 && hr < 18;
      f.fill(x + i, y, 1, 3, day ? '#4a3a10' : '#0e1a3a');
    }
    for (const hr of [6, 12, 18]) f.plot(x + Math.round(hr * w / 24), y + 3, DAY.faint);
    f.fill(x + Math.min(w - 1, Math.floor(h24 * w / 24)), y - 1, 1, 5, DAY.white);
  }

  const R4W = [
    {
      id: 'w-big', group: 'R4W', w: 128, title: 'Big digits',
      note: 'At 128 the digits get wider and bolder (17 x 28, 4 px strokes) instead of adding anything; AM/PM sits small at the lower right. Still nothing but the time.',
      draw(f, t) { bigTime128(f, t, DAY.white, true); },
    },
    {
      id: 'w-big-night', group: 'R4W', w: 128, title: 'Big digits, night',
      note: 'The sunset-to-sunrise dark red, as at 64.',
      draw(f, t) { bigTime128(f, t, '#9a0c0c', true); },
    },
    {
      id: 'w-seven-seg', group: 'R4W', w: 128, title: 'Seven-segment with seconds',
      note: 'The width buys what a real bedside clock has: big HH:MM, small seconds beside them, and AM/PM lamps with labels. Unlit segments stay faintly visible.',
      draw(f, t) {
        const on = '#ff2410', off = '#2a0704', d = digits4(t), o = 14;
        [2, 20, 44, 62].forEach((x, i) => sevenSeg(f, d[i], x + o, 2, on, off, 15, 27, 3));
        f.fill(38 + o, 8, 3, 3, on); f.fill(38 + o, 18, 3, 3, on);
        const ss = String(t.s).padStart(2, '0');
        [84, 94].forEach((x, i) => sevenSeg(f, ss[i], x + o, 2, on, off, 8, 14, 2));
        const pm = t.h >= 12;
        f.fill(84 + o, 21, 2, 2, pm ? off : on); f.text('small', 'AM', 88 + o, 23, pm ? '#3a0a06' : '#b01808');
        f.fill(84 + o, 27, 2, 2, pm ? on : off); f.text('small', 'PM', 88 + o, 29, pm ? '#b01808' : '#3a0a06');
      },
    },
    {
      id: 'w-calendar', group: 'R4W', w: 128, title: 'Calendar + week strip',
      note: 'The calendar page and the time as at 64; the weekday spelled out and the week number on the right; the weekday bar becomes SUN-SAT labels over the dashes, so it reads without counting.',
      draw(f, t) {
        calendarTile(f, t, 1, 1);
        const x = f.text('clock', t.hm, 28, 16, DAY.white);
        f.text('small', t.ampm, x + 2, 16, DAY.dim);
        f.rtext('5x7', t.day, 127, 9, DAY.white);
        f.rtext('small', `WEEK ${weekOf(t.d)}`, 127, 17, DAY.dim);
        weekStrip(f, t);
      },
    },
    {
      id: 'w-icon-time', group: 'R4W', w: 128, title: 'Weather icon + time',
      note: 'LaMetric\'s icon and time on the left; the right side gets the temperature in 5x7, the condition word and the high/low, which at 64 had to share one small line. Same week strip along the bottom.',
      draw(f, t, wx) {
        iconX2(f, wx.icon, 2, 2);
        const x = f.text('clock', t.hm, 22, 16, DAY.white);
        f.text('small', t.ampm, x + 2, 16, DAY.dim);
        const tx = f.rtext('5x7', `${wx.temp}°`, 127, 9, DAY.white);
        f.rtext('small', 'PT CLOUDY', 127, 17, DAY.grey);
        const up = String.fromCodePoint(0xe007), dn = String.fromCodePoint(0xe008);
        f.rtext('small', `${up}${wx.hi} ${dn}${wx.lo}`, 127 - f.measure('5x7', `${wx.temp}°`) - 5, 9, DAY.dim);
        weekStrip(f, t);
      },
    },
    {
      id: 'w-date-time', group: 'R4W', w: 128, title: 'Time + date panel',
      note: 'The big 64-wide digits on the left; a side panel with the weekday, the month spelled out and the year. The one 128 layout here that uses a panel, since the date is a different kind of thing from the time.',
      draw(f, t) {
        bigTime(f, t, DAY.white, false);
        f.fill(67, 4, 1, 24, DAY.faint);
        const md = `${MONTHS_FULL[t.d.getMonth()]} ${t.d.getDate()}`;
        f.text('5x7', t.day, 72, 10, DAY.white);
        f.text(f.measure('5x7', md) <= 55 ? '5x7' : 'small', md, 72, 20, DAY.grey);
        f.text('small', `${t.ampm}  ${t.d.getFullYear()}`, 72, 29, DAY.dim);
      },
    },
    {
      id: 'w-world', group: 'R4W', w: 128, title: 'World clock with day strips',
      note: 'Full city names, the time with AM/PM, and a 24-hour strip per city (night blue, day amber, a tick at the city\'s current time), so you see who is asleep at a glance. +1 / -1 when a city is on another day.',
      draw(f, t) {
        const here = zoneParts(t.d, 'America/Chicago');
        const zones = [['CHICAGO', 'America/Chicago'], ['LONDON', 'Europe/London'], ['TOKYO', 'Asia/Tokyo']];
        zones.forEach(([name, tz], i) => {
          const z = zoneParts(t.d, tz), base = 9 + i * 10, main = i === 0;
          f.text('5x7', name, 0, base, main ? DAY.white : DAY.grey);
          const off = (z.d - here.d + 7) % 7;
          if (off) f.text('small', off === 1 ? '+1' : '-1', 46, base, DAY.dim);
          const right = 82;
          f.rtext('5x7', z.hm, right, base, main ? DAY.white : DAY.grey);
          f.text('small', z.ampm + 'M', right + 2, base, DAY.dim);
          const mm = Number(z.hm.split(':')[1]);
          dayStrip(f, 96, base - 4, 32, z.h + mm / 60);
        });
      },
    },
  ];
  FACES.push(...R4, ...R4W);
  return R4;
});
