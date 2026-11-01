'use strict';
// The skyline clock face's drawing parameters (design spec, "Clock screen:
// skyline face"; contract "Skyline"). The server turns the weather and the
// sun into plain values; the board draws its layers from them and never
// interprets weather codes or the time of day itself.
//
// Mock references: scripts/mock-skyline-dusk.js (sky keyframes, lights,
// sun) and scripts/mock-weather-lake.js (weather palettes).

const { sunPos, moonPhase } = require('./sun');
const clouds = require('./clouds');

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
  // Night: pure blue at panel levels 4-10 (was 0-3, which banded black to
  // blue); one channel only, so the steps never shift hue.
  { el: -10, sky: [[0, '#000034'], [25, '#000049']], water: ['#030816', '#02050f', '#0e1a36'] },                                              // night
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
// Night colors follow one rule for the panel (S3 night curve, gamma 2.6):
// every channel is either off or at level 3 or more, and dark colors stay
// near neutral so the channels step together. Below that, a grey breaks into
// black, magenta and red bands (each channel rounds to a whole level on a
// different row) and the lowest levels are the first to go unsteady when the
// board dims. Night skies: overcast 3-8 (the city's glow on the clouds), rain
// 3-6, storm 3-5 (darkest, so lightning stands out), fog a flat 7, snow 5-15
// with the lake tinted toward it (4-3, ripples 6). Cloud decks run 3 (thick)
// to the sky's brightest; rain and storm by day keep the same floor. The
// other night water stays dark (its ripples are meant to be faint).
const LOOKS = {
  overcast: { day: { sky: [[0, '#4a525e'], [25, '#6a727e']], water: ['#262e38', '#1c222a', '#38424e'] },
    night: { sky: [[0, '#2e2e2e'], [25, '#434040']], water: ['#08070a', '#050406', '#141218'] } },
  rain: { day: { sky: [[0, '#2e3238'], [25, '#3c444e']], water: ['#141c26', '#0e141c', '#222c3a'] },
    night: { sky: [[0, '#2e2e2e'], [25, '#3c3c40']], water: ['#06070c', '#040508', '#10121c'] } },
  snow: { day: { sky: [[0, '#5a606a'], [25, '#7c828c']], water: ['#2c323a', '#22272e', '#3c444e'], roof: '#c8ced8' },
    night: { sky: [[0, '#3a3436'], [25, '#564a4c']], water: ['#342e2e', '#2e2e2e', '#3c3838'], roof: '#7a7280' } },
  fog: { day: { sky: [[0, '#747a82'], [25, '#747a82']], water: ['#5a6068', '#4e545c', '#6a7078'] },
    night: { sky: [[0, '#404043'], [25, '#404043']], water: ['#0c0e14', '#08090e', '#181b22'] } },
  storm: { day: { sky: [[0, '#2e2e34'], [25, '#30363e']], water: ['#10161e', '#0a0e14', '#1c2430'] },
    night: { sky: [[0, '#2e2e2e'], [25, '#343438']], water: ['#05050a', '#030306', '#10101a'] } },
};
const CLEAR_FAMILY = new Set(['clear', 'partly', 'mostly']);

// Current weather (WMO code, as weather.js maps WeatherAPI's; cloud cover %)
// -> {kind, lvl}: kind one of clear, partly, mostly, overcast, rain, snow,
// fog, storm; lvl 1-3 (light, moderate, heavy) for rain and snow. Codes 0-3
// defer to cloud cover (WMO has no "mostly cloudy"); without cloud cover
// they map 0-1 clear, 2 partly, 3 overcast.
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

// ---- clouds: a strip (shapes, clouds.js) and its colors for this moment ----
// Wisps take the light's color: white by day, warm at sunset, the city's
// glow at night. Decks blend a day and a night pair, light (thin) to dark (thick).
const WISP_KEYS = [[6, '#eef2f8'], [1, '#ffc8a8'], [-3, '#8a6a80'], [-6, '#4a4048']];
const STRIPS = {
  partly: { id: 'p1', a: [35, 70] },
  mostly: { id: 'm1', a: [38, 72] },
  overcast: { id: 'o1', day: ['#78808c', '#3e4652'], night: ['#464343', '#2e2e2e'] },
  rain: { id: 'r1', day: ['#525a66', '#2e3034'], night: ['#3c3c40', '#2e2e2e'] },
  storm: { id: 's1', day: ['#3a3e4a', '#2e2e32'], night: ['#3c3843', '#2e2e2e'] },
};
function keyed(keys, el) {
  if (el >= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (el >= keys[i][0]) { const [e0, c0] = keys[i - 1], [e1, c1] = keys[i]; return mix(c0, c1, (e0 - el) / (e0 - e1)); }
  return keys[keys.length - 1][1];
}
// {id, pal, a}: the strip and, per index, its color and opacity (%); index 0
// is clear (empty color). Null for clear, fog and snow skies.
function cloudsFor(kind, el, night) {
  const S = STRIPS[kind];
  if (!S) return null;
  if (S.a) {
    const c = keyed(WISP_KEYS, el);
    return { id: S.id, pal: ['', c, c], a: [0, ...S.a] };
  }
  const light = mix(S.day[0], S.night[0], night), dark = mix(S.day[1], S.night[1], night);
  const pal = [''], a = [0];
  for (let i = 1; i <= clouds.DECK_LEVELS; i++) { pal.push(mix(light, dark, (i - 1) / (clouds.DECK_LEVELS - 1))); a.push(100); }
  return { id: S.id, pal, a };
}
// Average luma of a sky row band with the clouds over it, across the whole
// strip (the clouds drift, so this is what the wheel sees on average).
function bandLuma(sky, cl, rows) {
  let sum = 0, n = 0;
  const px = cl ? clouds.strip(cl.id) : null;
  for (const y of rows) {
    const base = sample(sky, y);
    if (!px) { sum += luma(base); n++; continue; }
    for (let x = 0; x < clouds.W; x++) { const i = px[y * clouds.W + x]; sum += luma(i ? mix(base, cl.pal[i], cl.a[i] / 100) : base); n++; }
  }
  return sum / n;
}

// Weather (parsed by weather.js, °F), the place, the time and the temperature
// to show (board unit, rounded) -> the payload's `skyline`. `boats: false`
// (the board's setting) keeps the boats off.
// Motion settings (state.js) -> ms per pixel, or per turn for the wheel
// (0: still). Snow falls 3.5x slower than rain (the renderer's factor).
const DRIFT_MS = { off: 0, slow: 16000, normal: 4000 };
const WHEEL_MS = { off: 0, slow: 60000, normal: 30000, fast: 15000 };
const RIPPLE_MS = { off: 0, slow: 1000, normal: 500, fast: 250 };
const FALL_MS = { slow: 400, normal: 200, fast: 100 };
const pick = (table, key, def) => (table[key] != null ? table[key] : table[def]);

// Whether at least 4 pixels of the sun's disc (radius 3.5) clear the skyline.
function sunShows(cx, cy) {
  const { SKY } = require('./render');
  let n = 0;
  for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > 3.5 * 3.5 || y < 0 || y > SKY.SHORE || x < 0 || x > 63 || SKY.isB(x, y)) continue;
    if (!SKY.ants.some(([ax, t, roof]) => ax === x && y >= t && y < roof)) n++;
  }
  return n >= 4;
}

// Rain slant: the wind's component across the view (the board looks west,
// so north is to the right) at 8 mph or more slants the streaks 45° with it;
// calmer, they fall straight down. Without wind, storms slant left.
function rainSlant(w, kind) {
  if (typeof w.windSpeed !== 'number' || typeof w.windDir !== 'number') return kind === 'storm' ? -1 : 0;
  const across = -w.windSpeed * Math.cos(w.windDir * Math.PI / 180);   // + toward the north (right)
  return across >= 8 ? 1 : across <= -8 ? -1 : 0;
}

function toSkyline(w, { lat, lon, now, temp, boats = true, drift = 'slow', wheel = 'normal', ripple = 'normal', twinkle = true, fall = 'normal' }) {
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
  // The glitter path: the ripples under a low sun take its color, only while
  // the sun shows over the buildings (no reflection of a hidden sun). The
  // glint sparkles are gone; `gl` stays for the path (and older firmware,
  // which sparkles wherever it's sent, so it's sent only with a path).
  const p = sun ? Math.round(100 * sstep(-2, 1, el) * sstep(8, 4, el)) : 0;
  const gl = p > 0 && sunShows(sun.x, sun.y) ? { x: sun.x, c: '#ffd080', p } : null;

  // The wheel by day: white rim with a darker frame, lighter on mid greys,
  // all dark on bright skies (fog, snow) so it keeps its contrast.
  const cl0 = cloudsFor(kind, el, night);
  const cl = cl0 && { ...cl0, step: pick(DRIFT_MS, drift, 'slow') };
  const behind = bandLuma(look.sky, cl, RIM_TOP);
  const whl = kind === 'fog' || kind === 'snow' ? 2 : behind < 75 ? 0 : behind < 135 ? 1 : 2;

  const wet = kind === 'rain' || kind === 'storm' ? { k: 'r', n: RAIN_N[lvl - 1], sl: rainSlant(w, kind) } : kind === 'snow' ? { k: 's', n: SNOW_N[lvl - 1] } : null;
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
    boats: boats && el > 0 && (clearish || kind === 'overcast') && tempF != null && tempF >= 40 ? 1 : 0,
    cl,                                            // clouds: strip id (GET /board/sky/<id>) and its colors
    temp: temp == null ? null : Math.round(temp),
    wheel: pick(WHEEL_MS, wheel, 'normal'),        // ms a turn of the night rainbow (0: still)
    rip: pick(RIPPLE_MS, ripple, 'normal'),        // ms a pixel for the ripples (0: still)
    twk: twinkle ? 1 : 0,                          // stars twinkle
    fall: pick(FALL_MS, fall, 'normal'),           // ms a pixel for rain (snow: 3.5x)
  };
}

module.exports = { toSkyline, weatherKind, clearSky, mixSky, sample, cloudsFor, KEYS, LOOKS, STRIPS, RAIN_N, SNOW_N };
