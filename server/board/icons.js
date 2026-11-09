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

// 16 x 16 versions of the same icons (ICONS16), drawn for the size rather
// than scaled: a round 7 px sun with eight rays, a crescent moon, clouds with
// a small bump left of the dome and a 2 px underside, slanted rain streaks,
// a six-armed flake, a 2 px bolt. Same palette and names. Used where an icon
// gets a 16 px slot (the wide board's conditions screen).
const ICONS16 = {
  sun: [
    '................',
    '.......Y........',
    '..Y....Y....Y...',
    '...Y.......Y....',
    '......YYY.......',
    '.....YYYYY......',
    '....YYYYYYY.....',
    '.YY.YYYYYYY.YY..',
    '....YYYYYYY.....',
    '.....YYYYY......',
    '......YYY.......',
    '...Y.......Y....',
    '..Y....Y....Y...',
    '.......Y........',
    '................',
    '................',
  ],
  moon: [
    '................',
    '.........MM.....',
    '.......MMM......',
    '.....MMMM.......',
    '....MMMM........',
    '...MMMM.........',
    '...MMMM.........',
    '...MMMM.........',
    '...MMMM.........',
    '...MMMM.........',
    '....MMMM........',
    '.....MMMM.......',
    '.......MMM......',
    '.........MM.....',
    '................',
    '................',
  ],
  pcloudy_day: [
    '....Y...........',
    '.Y.....Y........',
    '...YYY..........',
    '..YYYYY.........',
    'Y.YYYYY.Y.......',
    '..YYYYY.........',
    '...YYY..........',
    '.Y........CCC...',
    '.........CCCCC..',
    '.....CCC.CCCCCC.',
    '....CCCCCCCCCCC.',
    '....CCCCCCCCCCCC',
    '...CCCCCCCCCCCCC',
    '....DDDDDDDDDDD.',
    '.....DDDDDDDDD..',
    '................',
  ],
  pcloudy_night: [
    '.....MM.........',
    '...MMM..........',
    '..MMM...........',
    '.MMM............',
    '.MMM............',
    '.MMM............',
    '..MMM...........',
    '...MMM....CCC...',
    '.........CCCCC..',
    '.....CCC.CCCCCC.',
    '....CCCCCCCCCCC.',
    '....CCCCCCCCCCCC',
    '...CCCCCCCCCCCCC',
    '....DDDDDDDDDDD.',
    '.....DDDDDDDDD..',
    '................',
  ],
  cloudy: [
    '................',
    '................',
    '................',
    '........CCC.....',
    '.......CCCCC....',
    '..CCC.CCCCCCC...',
    '.CCCCCCCCCCCCC..',
    '.CCCCCCCCCCCCCC.',
    'CCCCCCCCCCCCCCCC',
    'CCCCCCCCCCCCCCCC',
    '.DDDDDDDDDDDDDD.',
    '..DDDDDDDDDDDD..',
    '................',
    '................',
    '................',
    '................',
  ],
  rain: [
    '........CCC.....',
    '.......CCCCC....',
    '..CCC.CCCCCCC...',
    '.CCCCCCCCCCCCC..',
    '.CCCCCCCCCCCCCC.',
    'CCCCCCCCCCCCCCCC',
    'CCCCCCCCCCCCCCCC',
    '.DDDDDDDDDDDDDD.',
    '..DDDDDDDDDDDD..',
    '................',
    '....B...B...B...',
    '...B...B...B....',
    '...B...B...B....',
    '......B...B.....',
    '.....B...B......',
    '.....B...B......',
  ],
  ice: [
    '........CCC.....',
    '.......CCCCC....',
    '..CCC.CCCCCCC...',
    '.CCCCCCCCCCCCC..',
    '.CCCCCCCCCCCCCC.',
    'CCCCCCCCCCCCCCCC',
    'CCCCCCCCCCCCCCCC',
    '.DDDDDDDDDDDDDD.',
    '..DDDDDDDDDDDD..',
    '...........W....',
    '...B.....W.W.W..',
    '..B.......WWW...',
    '..B.....WWWWWWW.',
    '.....B....WWW...',
    '....B....W.W.W..',
    '....B......W....',
  ],
  snow: [
    '................',
    '.......S........',
    '.......S........',
    '...S...S...S....',
    '....S..S..S.....',
    '.....S.S.S......',
    '......SSS.......',
    '.SSSSSSSSSSSSS..',
    '......SSS.......',
    '.....S.S.S......',
    '....S..S..S.....',
    '...S...S...S....',
    '.......S........',
    '.......S........',
    '................',
    '................',
  ],
  storm: [
    '........GGG.....',
    '.......GGGGG....',
    '..GGG.GGGGGGG...',
    '.GGGGGGGGGGGGG..',
    '.GGGGGGGGGGGGGG.',
    'GGGGGGGGGGGGGGGG',
    'GGGGGGGGGGGGGGGG',
    '.KKKKKKKKKKKKKK.',
    '..KKKKKKKKKKKK..',
    '........LL......',
    '.......LL.......',
    '......LLLLL.....',
    '.......LLL......',
    '.......LL.......',
    '......LL........',
    '.....L..........',
  ],
  tsnow: [
    '........GGG.....',
    '.......GGGGG....',
    '..GGG.GGGGGGG...',
    '.GGGGGGGGGGGGG..',
    '.GGGGGGGGGGGGGG.',
    'GGGGGGGGGGGGGGGG',
    'GGGGGGGGGGGGGGGG',
    '.KKKKKKKKKKKKKK.',
    '..KKKKKKKKKKKK..',
    '....LL.....S....',
    '...LL....S.S.S..',
    '..LLLLL...SSS...',
    '...LLL..SSSSSSS.',
    '...LL.....SSS...',
    '..LL.....S.S.S..',
    '.L.........S....',
  ],
  fog: [
    '................',
    '................',
    '................',
    '.FFFFFFFFFFF....',
    '.FFFFFFFFFFF....',
    '................',
    '................',
    '....EEEEEEEEEEE.',
    '....EEEEEEEEEEE.',
    '................',
    '................',
    '.FFFFFFFFFFF....',
    '.FFFFFFFFFFF....',
    '................',
    '................',
    '................',
  ],
};

// Overnight owl (transit screen, no trains; CTA calls its overnight service
// Owl): 13 x 15, perched on a line left of the big clock. Frames of
// [ms, rows], cycled on the board's icon clock; frame 0 is the static owl; it mostly sits still, blinks now and
// then, and glances right once a cycle. No hard on/off rhythm, since a 1 s
// blink means a tornado warning. Pupils are unlit.
const OWL_PALETTE = {
  B: '#6e4a2a', // body
  b: '#a8875c', // chest
  W: '#d8c8a8', // face disc
  Y: '#ffd040', // eyes
  O: '#d08030', // beak, feet
};
const OWL_OPEN = [
  '.B.........B.',
  '.BB.......BB.',
  '.BBBBBBBBBBB.',
  'BBWWWBBBWWWBB',
  'BWYYYWBWYYYWB',
  'BWY.YWBWY.YWB',
  'BWYYYWOWYYYWB',
  'BBWWWBOBWWWBB',
  'BBbbbbbbbbbBB',
  'BbbBbbbbBbbbB',
  'BbbbbbBbbbBbB',
  'BbBbbbbbbbbbB',
  '.BbbbBbbbBbB.',
  '..BBBBBBBBB..',
  '..OOO...OOO..',
];
const owlEyes = (r4, r5, r6) => OWL_OPEN.map((r, j) => (j === 4 ? r4 : j === 5 ? r5 : j === 6 ? r6 : r));
const OWL_BLINK = owlEyes('BWBBBWBWBBBWB', 'BWWWWWBWWWWWB', 'BWBBBWOWBBBWB');
const OWL_LOOK = owlEyes('BWYYYWBWYYYWB', 'BWYY.WBWYY.WB', 'BWYYYWOWYYYWB');
const OWL = {
  palette: OWL_PALETTE,
  frames: [[4000, OWL_OPEN], [150, OWL_BLINK], [3000, OWL_OPEN], [1600, OWL_LOOK], [300, OWL_OPEN], [150, OWL_BLINK], [2200, OWL_OPEN]],
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

module.exports = { ICONS, ICONS16, PALETTE, ALERT_BANG, OWL, iconForCode, drawIcon };
