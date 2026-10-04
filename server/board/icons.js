'use strict';
// 8x8 weather icons for the weather row, as multi-color sprites.
//
// Each icon is 8 strings of 8 characters; '.' is unlit and every other
// character is a key into PALETTE. The board gets these as a sprite sheet
// (generated later from this file), so this file is the source of truth.

const PALETTE = {
  Y: '#ffc800', // sun
  M: '#e8dca0', // moon
  C: '#a0a0a0', // cloud
  G: '#6a6a6a', // storm cloud (darker)
  B: '#1e90ff', // umbrella canopy
  H: '#8f8f8f', // umbrella handle
  I: '#9fe6ff', // icy canopy
  W: '#ffffff', // icicles
  S: '#d0f0ff', // snowflake
  F: '#8f8f8f', // fog
  L: '#ffd800', // lightning
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
    '..Y.....',
    'Y..YY...',
    '..YYYY..',
    '.YYYYCC.',
    '..YYCCCC',
    '..CCCCCC',
    '.CCCCCCC',
    '..CCCCC.',
  ],
  pcloudy_night: [
    '.MMM....',
    'MM......',
    'M.......',
    'M....CC.',
    'MM..CCCC',
    '.MMCCCCC',
    '..CCCCCC',
    '...CCCC.',
  ],
  cloudy: [
    '........',
    '....CC..',
    '.CC.CCC.',
    'CCCCCCCC',
    'CCCCCCCC',
    '.CCCCCC.',
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
    '..SSS...',
    'SSSSSSS.',
    '..SSS...',
    '.S.S.S..',
    '...S....',
    '........',
  ],
  storm: [
    '...GG...',
    '.GGGGGG.',
    'GGGGGGGG',
    '.GGGGGG.',
    '...LL...',
    '..LL....',
    '.LLLL...',
    '...L....',
  ],
  fog: [
    '........',
    'FFFFFF..',
    '........',
    '..FFFFFF',
    '........',
    'FFFFFF..',
    '........',
    '........',
  ],
};

// Open-Meteo WMO weather code -> icon name. isDay picks sun/moon variants.
function iconForCode(code, isDay) {
  if (code === 0) return isDay ? 'sun' : 'moon';
  if (code === 1 || code === 2) return isDay ? 'pcloudy_day' : 'pcloudy_night';
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

module.exports = { ICONS, PALETTE, iconForCode, drawIcon };
