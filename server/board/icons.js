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
  Y: '#ffd000', // sun
  O: '#ff8c00', // sun rays
  M: '#ffe47a', // moon
  C: '#d0d0d0', // cloud
  D: '#7c7c7c', // cloud underside
  G: '#8a8a8a', // storm cloud
  K: '#545454', // storm cloud underside
  B: '#1e88ff', // umbrella canopy
  H: '#8f8f8f', // umbrella handle
  I: '#40d0ff', // icy canopy
  W: '#ffffff', // icicles, snowflake center
  S: '#80c8ff', // snowflake arms
  F: '#b0b0b0', // fog
  E: '#686868', // fog, far line
  L: '#ffe000', // lightning
};

const ICONS = {
  sun: [
    '...OO...',
    '.O....O.',
    '...YY...',
    'O.YYYY.O',
    'O.YYYY.O',
    '...YY...',
    '.O....O.',
    '...OO...',
  ],
  moon: [
    '...MMM..',
    '.MMM....',
    '.MM.....',
    'MM......',
    'MM......',
    '.MM.....',
    '.MMM....',
    '...MMM..',
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
    '.MMM....',
    'MM......',
    'M.......',
    'M....CC.',
    'MM..CCCC',
    '.MMCCCCC',
    '..CCCCCC',
    '...DDDD.',
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
    '...BB...',
    '.BBBBBB.',
    'BBBBBBBB',
    '...H....',
    '...H....',
    '...H....',
    'H..H....',
    '.HH.....',
  ],
  ice: [
    '...II...',
    '.IIIIII.',
    'IIIIIIII',
    'W..H.W.W',
    'W..H...W',
    '...H....',
    'H..H....',
    '.HH.....',
  ],
  snow: [
    '...S....',
    '.S.S.S..',
    '..WWW...',
    'SSWWWSS.',
    '..WWW...',
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

// Transit CTA alert: the row's 3x5 color block blinks between solid and this
// 1px "!" (middle column), drawn in the line color.
const ALERT_BANG = [
  '.#.',
  '.#.',
  '.#.',
  '...',
  '.#.',
];

// Open-Meteo WMO weather code -> icon name. isDay picks sun/moon variants.
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

module.exports = { ICONS, PALETTE, ALERT_BANG, iconForCode, drawIcon };
