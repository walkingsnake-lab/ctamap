'use strict';
// 8x8 weather icons for the weather row, as multi-color sprites.
//
// Each icon is 8 strings of 8 characters; '.' is unlit and every other
// character is a key into PALETTE. The board gets these as a sprite sheet
// (generated later from this file), so this file is the source of truth.

// Grays stay neutral (equal channels): at night brightness the panel's 5-bit
// steps turn a slightly tinted gray green or teal. Clouds are two-tone, light
// over a darker underside, and lighter than the row's gray text; the storm
// cloud is darker so it doesn't read as plain cloudy.
const PALETTE = {
  Y: '#ffc800', // sun
  M: '#ffe47a', // moon
  C: '#d0d0d0', // cloud
  D: '#7c7c7c', // cloud underside
  G: '#8a8a8a', // storm cloud
  K: '#545454', // storm cloud underside
  B: '#1e88ff', // rain
  W: '#ffffff', // ice crystal (freezing rain)
  S: '#d0f0ff', // snowflake
  F: '#b0b0b0', // fog
  E: '#686868', // fog, far line
  L: '#ffe000', // lightning
};

const ICONS = {
  sun: [
    '...YY...',
    '.Y....Y.',
    '...YY...',
    'Y.YYYY.Y',
    'Y.YYYY.Y',
    '...YY...',
    '.Y....Y.',
    '...YY...',
  ],
  moon: [
    '..MMMM..',
    '.MMM....',
    'MMM.....',
    'MMM.....',
    'MMM.....',
    'MMM.....',
    '.MMM....',
    '..MMMM..',
  ],
  pcloudy_day: [
    '..YY....',
    '.YYYY...',
    '.YYYY...',
    '..YY.CC.',
    '....CCCC',
    '..CCCCCC',
    '.CCCCCCC',
    '..DDDDD.',
  ],
  pcloudy_night: [
    '.MM.....',
    'MM......',
    'MM......',
    '.MM..CC.',
    '....CCCC',
    '..CCCCCC',
    '.CCCCCCC',
    '..DDDDD.',
  ],
  cloudy: [
    '........',
    '....CC..',
    '.CC.CCC.',
    'CCCCCCCC',
    'CCCCCCCC',
    '.DDDDDD.',
    '........',
    '........',
  ],
  rain: [
    '...CC...',
    '.CCCCCC.',
    'CCCCCCCC',
    '.DDDDDD.',
    '........',
    '.B..B..B',
    'B..B..B.',
    '........',
  ],
  ice: [
    '...CC...',
    '.CCCCCC.',
    'CCCCCCCC',
    '.DDDDDD.',
    '........',
    '.B...W..',
    'B...WWW.',
    '.....W..',
  ],
  snow: [
    '...S....',
    '.S.S.S..',
    '..SSS...',
    'SSSSSSS.',
    '..SSS...',
    '.S.S.S..',
    '...S....',
    '........',
  ],
  storm: [
    '..GGGG..',
    '.GGGGGG.',
    'GGGGGGGG',
    '.KKKKKK.',
    '...LL...',
    '..LL....',
    '...LL...',
    '..L.....',
  ],
  // Thundersnow: the storm cloud and bolt, a snowflake beside it.
  tsnow: [
    '..GGGG..',
    '.GGGGGG.',
    'GGGGGGGG',
    '.KKKKKK.',
    '..LL..S.',
    '.LL..SSS',
    '..LL..S.',
    '.L......',
  ],
  fog: [
    '........',
    'FFFFFF..',
    '........',
    '..EEEEEE',
    '........',
    'FFFFFF..',
    '........',
    '........',
  ],
};

// ---- animated icons (S3) ----
// Per icon, frames of [ms, rows], cycled while a weather layout's icons are
// animated (control page, per layout). Frame 0 is always the static icon,
// so "static" is the animation at rest. Gentle on purpose: the only hard
// blink on the board means a tornado warning, so nothing here flashes
// faster than the storm bolt's flicker.

const W8 = 8;
const blank = () => Array.from({ length: W8 }, () => '.'.repeat(W8));
// Pixels of `rows` whose code is in `codes`, moved by (dx, dy), clipped.
function layer(rows, codes, dx = 0, dy = 0) {
  const out = blank().map((r) => [...r]);
  rows.forEach((row, j) => [...row].forEach((c, i) => {
    const x = i + dx, y = j + dy;
    if (codes.includes(c) && x >= 0 && x < W8 && y >= 0 && y < W8) out[y][x] = c;
  }));
  return out.map((r) => r.join(''));
}
// Layers over each other, later on top.
function over(...layers) {
  const out = blank().map((r) => [...r]);
  for (const l of layers) l.forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') out[j][i] = c; }));
  return out.map((r) => r.join(''));
}
// rows with pixels at the given [x, y] set to code.
function plus(rows, code, ...pts) {
  const out = rows.map((r) => [...r]);
  for (const [x, y] of pts) out[y][x] = code;
  return out.map((r) => r.join(''));
}
// Rows j0..j1 of rows moved by dx (the rest unchanged).
function shiftRows(rows, j0, j1, dx) {
  return rows.map((row, j) => {
    if (j < j0 || j > j1) return row;
    return [...row].map((_, i) => (i - dx >= 0 && i - dx < W8 ? row[i - dx] : '.')).join('');
  });
}
// A slanted 2px rain streak pair per drop column pair, its top on row r
// (the static icons have it on row 5).
function rainRows(rows, r, code = 'B', cols = [[1, 0], [4, 3], [7, 6]]) {
  const out = rows.map((row, j) => (j >= 4 ? [...row].map((c) => (c === code ? '.' : c)).join('') : row));
  return plus(out, code, ...cols.flatMap(([a, b]) => [[a, r], [b, r + 1]]).filter(([, y]) => y < W8));
}

const I = ICONS;
const SUN_CARD = ['...YY...', '........', '...YY...', 'Y.YYYY.Y', 'Y.YYYY.Y', '...YY...', '........', '...YY...'];
const SUN_DIAG = ['........', '.Y....Y.', '...YY...', '..YYYY..', '..YYYY..', '...YY...', '.Y....Y.', '........'];
const cloudOver = (rows, light, dx) => over(layer(rows, light), layer(rows, 'CD', dx));
const ICON_ANIM = {
  // Rays twinkle: the diagonals, then the straight rays, drop out briefly.
  sun: [[1400, I.sun], [220, SUN_CARD], [220, SUN_DIAG], [220, SUN_CARD]],
  // Two stars twinkle beside the moon.
  moon: [[1800, I.moon], [260, plus(I.moon, 'M', [6, 2])], [1000, I.moon], [260, plus(I.moon, 'M', [5, 5])]],
  // The cloud drifts a pixel over the sun or moon and back.
  pcloudy_day: [[1500, I.pcloudy_day], [1500, cloudOver(I.pcloudy_day, 'Y', -1)]],
  pcloudy_night: [[1500, I.pcloudy_night], [1500, cloudOver(I.pcloudy_night, 'M', -1)]],
  // The top puffs billow a pixel left and back.
  cloudy: [[1500, I.cloudy], [1500, shiftRows(I.cloudy, 0, 2, -1)]],
  // Drops fall: the streaks step down a row, then start again under the cloud.
  rain: [[180, I.rain], [180, rainRows(I.rain, 6)], [180, rainRows(I.rain, 4)]],
  ice: [[180, I.ice], [180, rainRows(I.ice, 6, 'B', [[1, 0]])], [180, rainRows(I.ice, 4, 'B', [[1, 0]])]],
  // The flake floats down a pixel and back.
  snow: [[900, I.snow], [900, layer(I.snow, 'S', 0, 1)]],
  // The bolt flickers.
  storm: [[1600, I.storm], [150, layer(I.storm, 'GK')], [120, I.storm], [150, layer(I.storm, 'GK')]],
  tsnow: [[1600, I.tsnow], [150, layer(I.tsnow, 'GKS')], [120, I.tsnow], [150, layer(I.tsnow, 'GKS')]],
  // The fog lines drift apart and back.
  fog: [[1200, I.fog], [1200, shiftRows(shiftRows(I.fog, 1, 1, 1), 5, 5, 1)]],
};

// Frozen M4 only (firmware/boardlib/draw.py): a CTA alert's 1px "!" over the
// row's 3x5 block at 20%, in the line color. draw.js and the S3 show the
// label and the red alert circle instead.
const ALERT_BANG = [
  '.#.',
  '.#.',
  '.#.',
  '...',
  '.#.',
];

// WMO weather code -> icon name. isDay picks sun/moon variants.
function iconForCode(code, isDay) {
  if (code === 0 || code === 1) return isDay ? 'sun' : 'moon'; // clear, mainly clear
  if (code === 2) return isDay ? 'pcloudy_day' : 'pcloudy_night';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ([56, 57, 66, 67].includes(code)) return 'ice';
  if ((code >= 51 && code <= 55) || (code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return 'cloudy';
}

// Draw onto a raster Frame at (x, y).
function drawIcon(frame, name, x, y) {
  const rows = ICONS[name];
  if (!rows) throw new Error(`unknown icon: ${name}`);
  rows.forEach((row, j) => [...row].forEach((c, i) => {
    if (c !== '.') frame.fill(x + i, y + j, 1, 1, PALETTE[c]);
  }));
}

module.exports = { ICONS, PALETTE, ALERT_BANG, ICON_ANIM, iconForCode, drawIcon };
