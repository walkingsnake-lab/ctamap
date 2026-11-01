'use strict';
// The skyline clock face's drawing parameters (design spec, "Clock screen:
// skyline face"; contract "Skyline"). The server turns the weather and the
// sun into plain values; the board draws its layers from them and never
// interprets weather codes or the time of day itself.
//
// Mock references: scripts/mock-skyline-dusk.js (sky keyframes, lights,
// sun) and scripts/mock-weather-lake.js (weather palettes).

const { sunPos, moonPhase } = require('./sun');

// ---- color helpers (hex strings, as the payload sends them) ----
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, k) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * k)); };
const luma = (c) => { const [r, g, b] = rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// A sky is a list of [row, color] stops, top (row 0) to the horizon (row 25);
// the board fills each row by linear interpolation between stops.
const HORIZON = 25;
function sample(stops, y) {
  if (y <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (y <= stops[i][0]) { const [y0, c0] = stops[i - 1], [y1, c1] = stops[i]; return mix(c0, c1, (y - y0) / (y1 - y0)); }
  }
  return stops[stops.length - 1][1];
}
// Two skies mixed by k: sampled at the union of their stop rows, which is
// exact for linear ramps.
function mixSky(a, b, k) {
  if (k <= 0) return a; if (k >= 1) return b;
  const rows = [...new Set([...a, ...b].map(([y]) => y))].sort((p, q) => p - q);
  return rows.map((y) => [y, mix(sample(a, y), sample(b, y), k)]);
}
const mixWater = (a, b, k) => a.map((c, i) => mix(c, b[i], k));

// ---- clear skies: keyframes by sun elevation (spec table) ----
const KEYS = [
  { el: 12, sky: [[0, '#08245a'], [18, '#1a4a8e'], [25, '#3a6eb0']], water: ['#0a2a52', '#06203f', '#1a3a68'] },                          // day
  { el: 6, sky: [[0, '#14347a'], [14, '#3a62a0'], [22, '#b89880'], [25, '#f0b868']], water: ['#1a3050', '#10223e', '#3a4a68'] },             // golden hour
  { el: 1, sky: [[0, '#1a1440'], [9, '#5a2a5a'], [17, '#c0503a'], [23, '#f08a30'], [25, '#ffb848']], water: ['#3a2030', '#2a1424', '#7a3a3a'] }, // sunset
  { el: -3, sky: [[0, '#0e1040'], [12, '#30285e'], [20, '#80406a'], [25, '#c86a50']], water: ['#201830', '#140e22', '#4a3048'] },             // dusk
  { el: -6, sky: [[0, '#06103a'], [18, '#22306a'], [25, '#4a4a88']], water: ['#141a3a', '#0c1028', '#283060'] },                             // end of civil twilight
  { el: -10, sky: [[0, '#000006'], [25, '#0c1430']], water: ['#030816', '#02050f', '#0e1a36'] },                                              // night
];
function clearSky(el) {
  if (el >= KEYS[0].el) return KEYS[0];
  const last = KEYS[KEYS.length - 1];
  if (el <= last.el) return last;
  let i = 1; while (el < KEYS[i].el) i++;
  const a = KEYS[i - 1], b = KEYS[i], k = (a.el - el) / (a.el - b.el);
  return { sky: mixSky(a.sky, b.sky, k), water: mixWater(a.water, b.water, k) };
}

// ---- other weather: a day and a night look, blended across 1° to -6° ----
const LOOKS = {
  overcast: { day: { sky: [[0, '#4a525e'], [25, '#6a727e']], water: ['#262e38', '#1c222a', '#38424e'] },
    night: { sky: [[0, '#0c0a0e'], [25, '#2a2226']], water: ['#08070a', '#050406', '#141218'] } },
  rain: { day: { sky: [[0, '#262c34'], [25, '#3c444e']], water: ['#141c26', '#0e141c', '#222c3a'] },
    night: { sky: [[0, '#08080e'], [25, '#1e1a24']], water: ['#06070c', '#040508', '#10121c'] } },
  snow: { day: { sky: [[0, '#5a606a'], [25, '#7c828c']], water: ['#2c323a', '#22272e', '#3c444e'], roof: '#c8ced8' },
    night: { sky: [[0, '#140e14'], [25, '#3a282a']], water: ['#0c0a0e', '#08070a', '#1a1620'], roof: '#5a5260' } },
  fog: { day: { sky: [[0, '#747a82'], [25, '#747a82']], water: ['#5a6068', '#4e545c', '#6a7078'] },
    night: { sky: [[0, '#14161c'], [25, '#14161c']], water: ['#0c0e14', '#08090e', '#181b22'] } },
  storm: { day: { sky: [[0, '#1c2028'], [25, '#30363e']], water: ['#10161e', '#0a0e14', '#1c2430'] },
    night: { sky: [[0, '#0a0a14'], [25, '#1a1626']], water: ['#05050a', '#030306', '#10101a'] } },
};
const CLEAR_FAMILY = new Set(['clear', 'partly', 'mostly']);

// Open-Meteo current weather -> {kind, lvl}: kind one of clear, partly,
// mostly, overcast, rain, snow, fog, storm; lvl 1-3 (light, moderate, heavy)
// for rain and snow. Codes 0-3 defer to cloud cover (Open-Meteo has no
// "mostly cloudy" code); without cloud cover they map 0-1 clear, 2 partly,
// 3 overcast.
const RAIN_LVL = { 51: 1, 53: 2, 55: 3, 56: 1, 57: 3, 61: 1, 63: 2, 65: 3, 66: 1, 67: 3, 80: 1, 81: 2, 82: 3 };
const SNOW_LVL = { 71: 1, 73: 2, 75: 3, 77: 1, 85: 1, 86: 3 };
function weatherKind(code, clouds) {
  if (code >= 95 && code <= 99) return { kind: 'storm', lvl: 2 };
  if (RAIN_LVL[code]) return { kind: 'rain', lvl: RAIN_LVL[code] };
  if (SNOW_LVL[code]) return { kind: 'snow', lvl: SNOW_LVL[code] };
  if (code === 45 || code === 48) return { kind: 'fog', lvl: 0 };
  if (typeof clouds === 'number') {
    return { kind: clouds < 20 ? 'clear' : clouds < 50 ? 'partly' : clouds <= 85 ? 'mostly' : 'overcast', lvl: 0 };
  }
  return { kind: code === 2 ? 'partly' : code === 3 ? 'overcast' : 'clear', lvl: 0 };
}

// Rain streaks and snowflakes on screen, light / moderate / heavy.
const RAIN_N = [8, 16, 26], SNOW_N = [6, 12, 20];

// Geometry the parameters depend on (the board draws the rest).
const SUN_DAY = [41, 5];          // the day spot's center (x 38-44, rows 2-8)
const SUN_HORIZON_ROW = 21;       // sun's center row at 0° elevation
const ROWS_PER_DEG = 2.4;
const RIM_TOP = [11, 12, 13];     // rows behind the wheel's upper rim

// Weather (parsed Open-Meteo, °F), the place, the time and the temperature
// to show (board unit, rounded) -> the payload's `skyline`.
function toSkyline(w, { lat, lon, now, temp }) {
  const { el, az } = sunPos(now, lat, lon);
  const { kind, lvl } = weatherKind(w.code, w.clouds);
  const night = sstep(1, -6, el);                 // 0 day .. 1 night
  const clearish = CLEAR_FAMILY.has(kind);
  let look;
  if (clearish) look = clearSky(el);
  else {
    const L = LOOKS[kind];
    look = { sky: mixSky(L.day.sky, L.night.sky, night), water: mixWater(L.day.water, L.night.water, night),
      roof: L.day.roof ? mix(L.day.roof, L.night.roof, night) : null };
  }
  const evening = az > 180;

  // Sun: evening and day only (it rises behind the viewer, over the lake),
  // and only when the sky is clear enough to show it. Low, it sits at its
  // real height over its bearing on the sun's own scale (0.8 px/°: x 6-58
  // over the year); between 8° and 14° it slides to the day spot.
  let sun = null;
  if (clearish && el > -1 && (evening || el >= 8)) {
    const setX = 32 + (az - 270) * 0.8, cy = SUN_HORIZON_ROW - el * ROWS_PER_DEG;
    const k = sstep(8, 14, el);
    sun = { x: Math.round(setX + (SUN_DAY[0] - setX) * k), y: Math.round(cy + (SUN_DAY[1] - cy) * k), c: mix('#ffd040', '#fff0a0', sstep(6, 0, el)) };
  }

  // Moon: at night under a clear-family sky, whenever at least 3% is lit.
  const mp = moonPhase(now);
  const moon = clearish && night >= 1 && mp.lit >= 0.03 ? { ph: Math.round(mp.phase * 100) % 100, fr: Math.round(mp.lit * 100) } : null;

  // Glints on the water: under the sun by day, the glitter path at sunset
  // (p: its strength, 0-100), under the moon at night.
  let gl = null;
  if (sun && el > 8) gl = { x: sun.x, c: '#c8d8f0', p: 0 };
  else if (sun) gl = { x: sun.x, c: '#ffd080', p: Math.round(100 * sstep(-2, 1, el) * sstep(8, 4, el)) };
  else if (moon) gl = { x: SUN_DAY[0], c: mix('#000000', '#a89c70', mp.lit), p: 0 };

  // The wheel by day: white rim with a darker frame, lighter on mid greys,
  // all dark on bright skies (fog, snow) so it keeps its contrast.
  const behind = RIM_TOP.reduce((a, y) => a + luma(sample(look.sky, y)), 0) / RIM_TOP.length;
  const whl = kind === 'fog' || kind === 'snow' ? 2 : behind < 75 ? 0 : behind < 135 ? 1 : 2;

  const wet = kind === 'rain' || kind === 'storm' ? { k: 'r', n: RAIN_N[lvl - 1] } : kind === 'snow' ? { k: 's', n: SNOW_N[lvl - 1] } : null;
  const tempF = typeof w.temp === 'number' ? w.temp : null;

  return {
    st: kind,                                      // for the simulator and logs; the board doesn't branch on it
    sky: look.sky,
    wat: look.water,
    lit: el < 0.5 ? 1 : 0,                          // wheel rainbow, beacons, pier bulbs
    win: Math.round(100 * night),                   // share of the full 45% window pattern lit
    stars: clearish ? Math.round(14 * sstep(-4, -9, el)) : 0,
    sun,
    moon,
    gl,
    whl,
    fog: kind === 'fog' ? sample(look.sky, HORIZON) : null,
    roof: look.roof || null,
    pcp: wet,
    storm: kind === 'storm' ? 1 : 0,
    boats: el > 0 && (clearish || kind === 'overcast') && tempF != null && tempF >= 40 ? 1 : 0,
    temp: temp == null ? null : Math.round(temp),
  };
}

module.exports = { toSkyline, weatherKind, clearSky, mixSky, sample, KEYS, LOOKS, RAIN_N, SNOW_N };
