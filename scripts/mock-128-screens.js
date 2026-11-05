#!/usr/bin/env node
'use strict';
// The board's existing screens redrawn for a 128x32 panel (two 64x32
// chained). Not in draw.js. Transit times are from the recorded fixtures; the rest is made up
// unless noted.
//   node scripts/mock-128-screens.js   -> docs/board/mockups/w128/*.png

const fs = require('fs');
const path = require('path');
const B = path.join(__dirname, '..', 'server', 'board');
const { Frame } = require(path.join(B, 'raster'));
const { packFonts } = require(path.join(B, 'fonts'));
const draw = require(path.join(B, 'render'));
const icons = require(path.join(B, 'icons'));
const G = require(path.join(B, 'glyphs'));
const radar = require(path.join(B, 'radar'));

const OUT = path.join(__dirname, '..', 'docs', 'board', 'mockups', 'w128');
const F = packFonts();
const W = 128, H = 32;
const { LINE } = draw;
const C = { ...draw.C, dim: '#664600', rule: '#262626' };
const s = (cp) => String.fromCodePoint(cp);

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const scale = (c, k) => toHex(hex(c).map((v) => v * k));
const lerp = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const measure = (font, str) => { let w = 0; for (const ch of str) { const g = F[font][ch.codePointAt(0)]; if (g) w += g[0]; } return w > 0 ? w - 1 : 0; };
const rtext = (f, font, str, x1, base, col) => f.text(font, str, x1 - measure(font, str) + 1, base, col);
const ctext = (f, font, str, cx, base, col) => f.text(font, str, Math.round(cx - (measure(font, str) - 1) / 2), base, col);
const icon = (f, name, x, y) => icons.ICONS[name].forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') f.set(x + i, y + j, hex(icons.PALETTE[c])); }));
const STOPS = [[-10, '#6080ff'], [20, '#60b0ff'], [40, '#30d0d0'], [55, '#40d040'], [70, '#ffd000'], [85, '#ff8000'], [100, '#ff2020']];
function tempColor(t) {
  if (t <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) return lerp(STOPS[i - 1][1], STOPS[i][1], (t - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]));
  return STOPS[STOPS.length - 1][1];
}
// Times right-aligned at x1; later ones drop when they'd come within 3px of `end`.
function times(f, ts, x1, base, end, { col = (i) => (i === 0 ? C.amber : C.dim), gap = 3 } = {}) {
  let keep = ts.map(String);
  const width = (a) => a.reduce((w, t) => w + measure('small', t), 0) + gap * (a.length - 1);
  while (keep.length > 1 && x1 - width(keep) + 1 < end + 3) keep = keep.slice(0, -1);
  let x = x1;
  for (let i = keep.length - 1; i >= 0; i--) { const w = measure('small', keep[i]); f.text('small', keep[i], x - w + 1, base, col(i)); x -= w + gap; }
}

// ======================= redrawn =======================

// Transit rows, full width: CTA destination names, up to 5 times.
function transitRows() {
  const f = new Frame(W, H);
  f.text('small', 'BELMONT', 0, 6, C.head);
  rtext(f, 'small', '11:16', 127, 6, C.clock);
  const rows = [['RD', 'HOWARD', [5, 12, 19, 28, 34]], ['RD', '95TH/DAN RYAN', [4, 14]], ['BR', 'KIMBALL', [5, 17, 38, 47]], ['BR', 'LOOP', ['DUE', 16]]];
  rows.forEach(([ln, lbl, ts], i) => {
    const top = 8 + i * 6;
    f.fill(0, top, 3, 5, LINE[ln]);
    const end = f.text('small', lbl, 5, top + 5, C.label) - 1;
    times(f, ts, 127, top + 5, end);
  });
  return f;
}

// Direction split, CTA rows in each half.
function transitSplit() {
  const f = new Frame(W, H);
  const halves = [[0, 61, 'NORTHBOUND', [['RD', 'HOWARD', [5, 12, 19, 28]], ['BR', 'KIMBALL', [5, 17, 38]]]],
    [65, 127, 'SOUTHBOUND', [['RD', '95TH', [4, 14]], ['BR', 'LOOP', ['DUE', 16]]]]];
  for (const [x0, x1, label, rows] of halves) {
    f.text('small', label, x0, 6, C.head);
    rows.forEach(([ln, lbl, ts], i) => {
      const top = 10 + i * 8;
      f.fill(x0, top, 3, 5, LINE[ln]);
      const end = f.text('small', lbl, x0 + 5, top + 5, C.label) - 1;
      times(f, ts, x1, top + 5, end);
    });
  }
  f.text('small', 'BELMONT', 0, 31, C.dimHead);
  rtext(f, 'small', '11:16', 127, 31, C.dimHead);
  return f;
}

// Ticker in the style of the CTA's platform signs: the row number in the grey
// index column, the full destination, the time at the far right, and after
// it a live-train signal (three arcs) or, for a scheduled train, a clock.
// 7 x 7, the height of the 5x7 capitals: three arcs opening to the upper right, and a clock face.
const LIVE = ['###....', '...##..', '##...#.', '..#..#.', '#..#..#', '.#.#..#', '.#..#.#'];
const SCHED = ['.#####.', '#..#..#', '#..#..#', '#..##.#', '#.....#', '#.....#', '.#####.'];
function ticker() {
  const f = new Frame(W, H);
  f.text('small', 'MORSE', 0, 6, C.head);
  rtext(f, 'small', '11:16', 127, 6, C.clock);
  // Morse, Oct 3, 11:16 PM; the Howard train is shown as scheduled to show the clock.
  const rows = [['RD', '95th/Dan Ryan', 'Due', true], ['RD', 'Howard', '3', false]];
  rows.forEach(([ln, dest, t, live], i) => {
    const top = 7 + i * 13, base = top + 9;
    f.fill(0, top, 5, 12, C.index);
    f.fill(5, top, 123, 12, scale(LINE[ln], 0.55));
    f.text('small', String(i + 1), 1, base, C.label);
    f.text('5x7', dest, 7, base, C.white);
    // Icon 1px in from the right edge, the time 3px clear of it.
    const ix = 126 - 6;
    (live ? LIVE : SCHED).forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') f.set(ix + x, base - 7 + y, hex(C.white)); }));
    const tr = ix - 4;
    if (t === 'Due') rtext(f, '5x7', 'Due', tr, base, C.white);
    else {
      const mw = measure('5x7', s(G.MIN));
      f.text('5x7', s(G.MIN), tr - mw + 1, base, C.white);
      rtext(f, '5x7', t, tr - mw - 2, base, C.white);
    }
  });
  return f;
}

// Chronological view in two columns: eight trains.
function chrono() {
  const f = new Frame(W, H);
  f.text('small', 'CLARK/LAKE', 0, 6, C.head);
  rtext(f, 'small', '11:17', 127, 6, C.clock);
  const trains = [['GR', 'HARLEM', 'DUE'], ['BL', "O'HARE", '3m'], ['BL', 'FOREST PK', '6m'], ['BL', "O'HARE", '10m'],
    ['PK', '54/CERMAK', '10m'], ['BR', 'KIMBALL', '19m'], ['BL', "O'HARE", '20m'], ['BL', 'FOREST PK', '21m']];
  trains.forEach(([ln, lbl, t], i) => {
    const x0 = i < 4 ? 0 : 66, x1 = i < 4 ? 61 : 127, top = 8 + (i % 4) * 6;
    f.text('small', String(i + 1), x0, top + 5, LINE[ln]);
    f.fill(x0 + 4, top, 3, 5, LINE[ln]);
    f.text('small', lbl, x0 + 9, top + 5, C.label);
    rtext(f, 'small', t, x1, top + 5, C.amber);
  });
  return f;
}

// The weather screens' top bar (current conditions): optional.
function topBar(f) {
  icon(f, 'pcloudy_day', 0, 0);
  const tx = f.text('5x7', '57°', 10, 7, C.white);
  f.text('small', 'PT CLOUDY', tx + 4, 6, C.wxText);
  // Right side, right to left: low, down arrow, high, up arrow.
  let x = 127;
  for (const [str, col] of [['49', C.label], [s(G.DOWN), C.grey], ['63', C.label], [s(G.UP), C.grey]]) {
    rtext(f, 'small', str, x, 6, col);
    x -= measure('small', str) + (str === '63' ? 4 : 2);
  }
}

// A 4-5 line station without the chronological view. Clark/Lake, real
// times (Oct 3, 11:17 PM): five destinations on five lines.
const CL = [['GR', 'HARLEM/LAKE', ['DUE']], ['BL', "O'HARE", [3, 10, 20, 27]], ['BL', 'FOREST PARK', [6, 21, 39]], ['PK', '54TH/CERMAK', [10, 22]], ['BR', 'KIMBALL', [19, 28, 44]]];
function destRow(f, x0, x1, top, [ln, lbl, ts]) {
  f.fill(x0, top, 3, 5, LINE[ln]);
  const end = f.text('small', lbl, x0 + 5, top + 5, C.label) - 1;
  times(f, ts, x1, top + 5, end);
}
// Five destination rows, no header (the 64 board drops the header to fit, too).
function transitFive() {
  const f = new Frame(W, H);
  CL.forEach((r, i) => destRow(f, 0, 127, 1 + i * 6, r));
  return f;
}
// Two columns of destination rows under the header: eight destinations. Clark/Lake at rush (made up).
function transitColumns() {
  const f = new Frame(W, H);
  f.text('small', 'CLARK/LAKE', 0, 6, C.head);
  rtext(f, 'small', '5:42', 127, 6, C.clock);
  // The 64 board's short names (destinations.js), so each row keeps three times.
  const rows = [['BL', "O'HARE", [2, 9, 15]], ['BL', 'FOREST', [4, 11, 18]], ['BR', 'KIMBALL', ['DUE', 7, 16]], ['PR', 'LINDEN', [5, 13, 24]],
    ['GR', 'HARLEM', [3, 12, 20]], ['GR', '63RD', [8, 17, 26]], ['OR', 'MIDWAY', [6, 14, 22]], ['PK', '54/CRMK', [10, 19, 31]]];
  rows.forEach((r, i) => destRow(f, i < 4 ? 0 : 66, i < 4 ? 61 : 127, 8 + (i % 4) * 6, r));
  return f;
}
// One row per line; a line's second destination starts at column 66. Clark/Lake midday (made up).
function transitByLine() {
  const f = new Frame(W, H);
  const lines = [['BL', [["O'HARE", [3, 10, 18]], ['FOREST', [6, 21, 33]]]], ['BR', [['KIMBALL', [5, 13, 21, 29]]]],
    ['GR', [['HARLEM', ['DUE', 12, 21]], ['63RD', [8, 19, 30]]]], ['OR', [['MIDWAY', [4, 11, 19, 26]]]], ['PK', [['54/CRMK', [10, 22, 34]]]]];
  lines.forEach(([ln, dests], i) => {
    const top = 1 + i * 6;
    f.fill(0, top, 3, 5, LINE[ln]);
    dests.forEach(([lbl, ts], k) => {
      const x0 = k ? 66 : 5, x1 = dests.length > 1 && !k ? 61 : 127;
      const end = f.text('small', lbl, x0, top + 5, C.label) - 1;
      times(f, ts, x1, top + 5, end);
    });
  });
  return f;
}

// 7-day forecast: day, icon, high, low. With the top bar the lows drop out.
function sevenDay({ top = false } = {}) {
  const f = new Frame(W, H);
  if (top) topBar(f);
  const o = top ? 8 : 0;
  const days = [['TU', 'sun', 71, 54], ['WE', 'pcloudy_day', 66, 52], ['TH', 'rain', 58, 49], ['FR', 'storm', 61, 47], ['SA', 'cloudy', 52, 40], ['SU', 'snow', 38, 29], ['MO', 'sun', 44, 30]];
  days.forEach(([d, ic, hi, lo], i) => {
    const x = i * 18 + 1, cx = x + 8;
    if (i) f.fill(x - 2, o + (top ? 2 : 0), 1, 32 - o, C.rule);
    ctext(f, 'small', d, cx, o + 6, i === 0 ? C.label : C.grey);
    icon(f, ic, cx - 4, o + 8);
    if (top) { ctext(f, 'small', `${hi}°`, cx + 1, 31, tempColor(hi)); return; }
    ctext(f, 'small', `${hi}°`, cx + 1, 23, tempColor(hi));
    ctext(f, 'small', `${lo}°`, cx + 1, 30, scale(tempColor(lo), 0.6));
  });
  return f;
}

// Hourly, 24 hours in 3-hour steps. Without the top bar the freed rows carry the rain chance.
function hourly({ top = true } = {}) {
  const f = new Frame(W, H);
  if (top) topBar(f);
  const hrs = [['3P', 'sun', 61, 0], ['6P', 'cloudy', 58, 10], ['9P', 'pcloudy_night', 55, 20], ['12A', 'rain', 52, 60], ['3A', 'rain', 50, 70], ['6A', 'fog', 49, 30], ['9A', 'pcloudy_day', 54, 10], ['12P', 'sun', 62, 0]];
  hrs.forEach(([h, ic, t, pop], i) => {
    const cx = i * 16 + 7;
    if (top) {
      if (i) f.fill(i * 16 - 1, 10, 1, 22, C.rule);
      ctext(f, 'small', h, cx, 15, C.grey);
      icon(f, ic, cx - 4, 17);
      ctext(f, 'small', `${t}°`, cx + 1, 31, tempColor(t));
      return;
    }
    if (i) f.fill(i * 16 - 1, 0, 1, 32, C.rule);
    ctext(f, 'small', h, cx, 6, C.grey);
    icon(f, ic, cx - 4, 8);
    ctext(f, 'small', `${t}°`, cx + 1, 23, tempColor(t));
    ctext(f, 'small', `${pop}%`, cx, 30, pop >= 20 ? '#1e90ff' : pop ? '#2a5a90' : '#3a3a3a');
  });
  return f;
}

// Wide radar: a real MRMS frame (the Aug 10, 2020 derecho at 4 PM) cropped 128 LEDs wide.
async function wideRadar() {
  const stamp = '202008102100';
  const st = require(path.join(B, 'stations.json')).find((x) => x.mapid === '40100'); // Morse
  const wld = radar.parseWld(fs.readFileSync(path.join(B, 'fixtures', 'mrms', `lcref_${stamp}.wld`), 'utf8'));
  // Centre the crop 28 LEDs west of the station, so it sits at x 92 and the lake fills the right side.
  const KM = 1.5 * 1.609344, shift = 28;
  const lonC = st.lon - (shift * KM) / (111.32 * Math.cos(st.lat * Math.PI / 180));
  const crop = await radar.crops(fs.createReadStream(path.join(B, 'fixtures', 'mrms', `lcref_${stamp}.png`)), wld, [{ key: 'k', lat: st.lat, lon: lonC, width: W }]);
  const { dbz } = crop.get('k');
  // Water mask from the lake outline (what build-locations.js does per station at 64).
  const lake = JSON.parse(fs.readFileSync(path.join(__dirname, 'geo-src', 'lake-michigan.geojson'), 'utf8')).features[0].geometry.coordinates;
  const inPoly = (lon, lat) => lake.some((ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; } return c; }) ;
  const colsPer = KM / (wld.dx * 111.32 * Math.cos(st.lat * Math.PI / 180)), rowsPer = KM / (Math.abs(wld.dy) * 111.32);
  const sx = (lonC - wld.x0) / wld.dx, sy = (st.lat - wld.y0) / wld.dy;
  const left = sx - (64 + 0.5) * colsPer, top = sy - (16 + 0.5) * rowsPer;
  const water = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lon = wld.x0 + (left + (x + 0.5) * colsPer) * wld.dx, lat = wld.y0 + (top + (y + 0.5) * rowsPer) * wld.dy;
    water[y * W + x] = inPoly(lon, lat) ? 1 : 0;
  }
  const RAIN = [15, 25, 35, 45, 55];
  const lv = new Uint8Array(W * H);
  for (let k = 0; k < lv.length; k++) { let n = 0; while (n < RAIN.length && dbz[k] >= RAIN[n]) n++; lv[k] = water[k] ? 0 : n; }
  const f = new Frame(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = lv[y * W + x];
    if (!v) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && lv[(y + dy) * W + x + dx]) n++;
    if (n >= 2) f.set(x, y, hex(draw.RADAR[v]));
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!water[y * W + x]) continue;
    const land = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < W && yy < H && !water[yy * W + xx]; });
    if (land) f.set(x, y, hex(draw.RADAR[6]));
  }
  f.set(64 + shift, 16, [255, 255, 255]);
  // Time stack over the lake, as in the 64 layout.
  rtext(f, 'clock', '4:00', 127, 15, C.clock);
  rtext(f, 'small', 'PM', 127, 22, C.radarAmpm);
  rtext(f, 'small', '84°', 127, 30, tempColor(84));
  for (let i = 0; i < 6; i++) f.set(104 + i * 2, 1, hex(i === 5 ? C.amber : C.indicator));
  return f;
}

// Baseball line score: innings, R H E, then the live state.
function lineScore() {
  const f = new Frame(W, H);
  const teams = [['CHC', '#2a5bd8', [0, 1, 0, 0, 2, 0, 0], [3, 7, 0]], ['STL', '#d62a2a', [1, 0, 0, 1, 0, 0], [2, 5, 1]]];
  const IX = 30, STEP = 8, RX = IX + 9 * STEP + 3;
  for (let i = 0; i < 9; i++) ctext(f, 'small', String(i + 1), IX + i * STEP + 1, 6, i === 6 ? C.amber : C.dimHead);
  ['R', 'H', 'E'].forEach((l, i) => ctext(f, 'small', l, RX + i * 9 + 2, 6, C.dimHead));
  f.fill(RX - 3, 0, 1, 25, C.rule);
  teams.forEach(([ab, col, inn, rhe], t) => {
    const base = 15 + t * 9;
    f.fill(0, base - 7, 3, 7, col);
    f.text('5x7', ab, 6, base, C.label);
    inn.forEach((r, i) => ctext(f, 'small', String(r), IX + i * STEP + 1, base - 1, t === 0 && i === 6 ? C.amber : C.grey));
    ctext(f, '5x7', String(rhe[0]), RX + 2, base, C.white);
    ctext(f, 'small', String(rhe[1]), RX + 11, base - 1, C.grey);
    ctext(f, 'small', String(rhe[2]), RX + 20, base - 1, C.grey);
  });
  f.fill(0, 25, 128, 1, C.rule);
  f.text('small', 'TOP 7', 0, 31, C.label);
  f.text('small', '2-1', 28, 31, C.label);
  f.text('small', '2 OUT', 44, 31, C.label);
  f.text('small', '94 PITCHES', 70, 31, C.dimHead);
  const D = ['.X.', 'XXX', '.X.'], on = [1, 0, 1];
  [[124, 28, on[0]], [121, 26, on[1]], [118, 28, on[2]]].forEach(([x, y, o]) => D.forEach((r, j) => [...r].forEach((c, i) => { if (c === 'X') f.set(x + i, y + j, hex(o ? C.amber : '#3a3a3a')); })));
  return f;
}

// Note: one line of 5x7 holds about 21 characters instead of 10.
function note() {
  const f = new Frame(W, H);
  ctext(f, '5x7', 'Grab milk on the way', 64, 14, C.label);
  ctext(f, '5x7', 'home please', 64, 25, C.label);
  return f;
}

// ======================= side by side =======================

async function main() {
  const MOCKS = [
    ['redrawn', 'transit-rows', 'Transit rows', 'Full CTA names and up to five times a row; the header keeps the station and clock.', '', transitRows()],
    ['redrawn', 'transit-split', 'Transit, by direction', 'Belmont split north | south, two times or more per line. The station and clock move to the bottom.', 'Real Belmont times (Oct 3, 11:16 PM, no Purple).', transitSplit()],
    ['redrawn', 'ticker', 'Ticker', 'After the CTA platform signs: the row number in the grey column, the full destination, the time at the far right, then the live-train signal, or a clock for a scheduled train (row 2).', 'Real Morse times; the Howard train is marked scheduled here to show the clock.', ticker()],
    ['redrawn', 'chrono', 'Chronological, two columns', 'Eight trains instead of four, with full names (FOREST PK, 54/CERMAK).', 'Real Clark/Lake times.', chrono()],
    ['redrawn', 'transit-five', 'Busy station: five rows', 'Clark/Lake\'s five destinations as destination rows with full names and up to four times; the header drops to make room, as it does on the 64 board.', 'Real Clark/Lake times.', transitFive()],
    ['redrawn', 'transit-columns', 'Busy station: two columns', 'Eight destinations in two columns of four under the header: Clark/Lake at rush. With the 64 board\'s short names (HARLEM, 63RD, 54/CRMK) every row keeps three times.', 'Made-up times.', transitColumns()],
    ['redrawn', 'transit-byline', 'Busy station: one row per line', 'Five lines on five rows; a line with two destinations puts the second at the halfway mark (Blue: O\'HARE and FOREST). Short names, as on the 64 board.', 'Made-up times. Seven destinations, no paging.', transitByLine()],
    ['redrawn', 'seven-day', '7-day forecast', 'Seven columns with highs and lows; the 64 screen shows five days and highs only.', 'NWS gives seven days already.', sevenDay()],
    ['redrawn', 'seven-day-top', '7-day, top bar on', 'The current-conditions bar as an option: with it on, the lows drop out.', '', sevenDay({ top: true })],
    ['redrawn', 'hourly', 'Hourly, 24 hours', 'Eight 3-hour steps under the top bar.', 'The server builds 4 slots today (HOUR_STEPS); the NWS hourly feed covers more.', hourly()],
    ['redrawn', 'hourly-notop', 'Hourly, top bar off', 'Without the bar the freed rows carry each slot\'s rain chance (bright from 20%).', '', hourly({ top: false })],
    ['redrawn', 'radar', 'Radar, 128 wide', 'A real MRMS frame (the Aug 10, 2020 derecho) cropped 128 LEDs wide: about 190 mi of the region instead of 95. The station sits right of center; the time stack moves over the lake.', 'Each station needs a new water mask at 128 (built here from the lake outline).', null],
    ['redrawn', 'line-score', 'Baseball line score', 'Runs by inning, R H E, then the count, outs, pitch count and bases.', 'The innings come in the linescore the server already fetches; the pitch count would need a field added.', lineScore()],
    ['redrawn', 'note', 'Message note', 'About 21 characters a line in 5x7 instead of 10.', '', note()],
  ];
  MOCKS.find((m) => m[1] === 'radar')[5] = await wideRadar();

  const q5 = (v) => v & 0xf8;
  fs.mkdirSync(OUT, { recursive: true });
  for (const m of MOCKS) {
    const fr = m[5];
    const q = new Frame(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) q.set(x, y, fr.get(x, y).map(q5));
    fs.writeFileSync(path.join(OUT, `${m[1]}.png`), q.toPNG(10));
  }
  const GAP = 4, TH = 8, COLS = 2;
  const sheet = new Frame(COLS * W + (COLS + 1) * GAP, Math.ceil(MOCKS.length / COLS) * (TH + H + GAP) + GAP);
  MOCKS.forEach((m, i) => {
    const ox = GAP + (i % COLS) * (W + GAP), oy = GAP + Math.floor(i / COLS) * (TH + H + GAP);
    sheet.text('small', m[2].toUpperCase(), ox, oy + 5, '#5a5a5a');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sheet.set(ox + x, oy + TH + y, m[5].get(x, y).map(q5));
  });
  fs.writeFileSync(path.join(OUT, 'sheet.png'), sheet.toPNG(5));
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(MOCKS.map(([kind, id, title, desc, note]) => ({ kind, id, title, desc, note })), null, 1));
  console.log('wrote docs/board/mockups/w128/');
}
main().catch((e) => { console.error(e); process.exit(1); });
