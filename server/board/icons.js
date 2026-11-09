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

// 16 x 16 icons (ICONS16), designed for the size rather than scaled from the
// 8 x 8 set: a 7 px disc sun with eight rays, a crescent moon, one shared
// cloud (a centered dome with equal shoulders on a flat base, the bottom two
// rows shaded), rain as dashes on a 4 px grid, an eight-arm flake with forked
// tips, a 2 px bolt. Same names as ICONS; their own palette (PALETTE16), since
// the larger shapes want lighter clouds and a paler moon. Used where an icon
// gets a 16 px slot (the wide board's conditions screen). Decided Nov 8, 2026.
const PALETTE16 = {
  Y: '#ffc800', // sun
  y: '#ffb000', // sun rays
  M: '#f0e0a0', // moon
  C: '#dcdcdc', // cloud
  D: '#8a8a8a', // cloud underside
  G: '#8a8a8a', // storm cloud
  K: '#4a4a4a', // storm cloud underside
  B: '#2e8cff', // rain
  W: '#ffffff', // ice crystal
  S: '#d8f0ff', // snowflake
  F: '#c0c0c0', // fog lines
  E: '#6a6a6a', // fog cloud
  L: '#ffe000', // lightning
};
const ICONS16 = {
  sun: [
    '................',
    '.......y........',
    '..y....y....y...',
    '...y.......y....',
    '......YYY.......',
    '.....YYYYY......',
    '....YYYYYYY.....',
    '.yy.YYYYYYY.yy..',
    '....YYYYYYY.....',
    '.....YYYYY......',
    '......YYY.......',
    '...y.......y....',
    '..y....y....y...',
    '.......y........',
    '................',
    '................',
  ],
  moon: [
    '................',
    '................',
    '....MMMMMMM.....',
    '...MMMMM........',
    '..MMMMM.........',
    '..MMMM..........',
    '.MMMMM..........',
    '.MMMMM..........',
    '.MMMMM..........',
    '.MMMMM..........',
    '..MMMM..........',
    '..MMMMM.........',
    '...MMMMM........',
    '....MMMMMMM.....',
    '................',
    '................',
  ],
  pcloudy_day: [
    '.....y..........',
    '..y.....y.......',
    '....YYY.........',
    '...YYYYY........',
    '.y.YYYYY.y......',
    '...YYYYY........',
    '....YYY.........',
    '..y.............',
    '................',
    '........CCCC....',
    '.......CCCCCC...',
    '.....CC.CCCC.CC.',
    '....CCCCCCCCCCCC',
    '....CCCCCCCCCCCC',
    '....DDDDDDDDDDDD',
    '.....DDDDDDDDDD.',
  ],
  pcloudy_night: [
    '................',
    '..MMMM..........',
    '.MMM............',
    'MMMM............',
    'MMM.............',
    'MMM.............',
    'MMMM............',
    '.MMM............',
    '..MMMM..........',
    '........CCCC....',
    '.......CCCCCC...',
    '.....CC.CCCC.CC.',
    '....CCCCCCCCCCCC',
    '....CCCCCCCCCCCC',
    '....DDDDDDDDDDDD',
    '.....DDDDDDDDDD.',
  ],
  cloudy: [
    '................',
    '................',
    '................',
    '................',
    '......CCCC......',
    '.....CCCCCC.....',
    '..CC.CCCCCC.CC..',
    '.CCCCCCCCCCCCCC.',
    'CCCCCCCCCCCCCCCC',
    'CCCCCCCCCCCCCCCC',
    'DDDDDDDDDDDDDDDD',
    '.DDDDDDDDDDDDDD.',
    '................',
    '................',
    '................',
    '................',
  ],
  rain: [
    '......CCCC......',
    '.....CCCCCC.....',
    '..CC.CCCCCC.CC..',
    '.CCCCCCCCCCCCCC.',
    'CCCCCCCCCCCCCCCC',
    'CCCCCCCCCCCCCCCC',
    'DDDDDDDDDDDDDDDD',
    '.DDDDDDDDDDDDDD.',
    '................',
    '................',
    '...B...B...B....',
    '...B...B...B....',
    '...B...B...B....',
    '.....B...B...B..',
    '.....B...B...B..',
    '.....B...B...B..',
  ],
  ice: [
    '......CCCC......',
    '.....CCCCCC.....',
    '..CC.CCCCCC.CC..',
    '.CCCCCCCCCCCCCC.',
    'CCCCCCCCCCCCCCCC',
    'CCCCCCCCCCCCCCCC',
    'DDDDDDDDDDDDDDDD',
    '.DDDDDDDDDDDDDD.',
    '................',
    '...........W....',
    '...B.....W.W.W..',
    '...B......WWW...',
    '...B....WWWWWWW.',
    '.....B....WWW...',
    '.....B...W.W.W..',
    '.....B.....W....',
  ],
  snow: [
    '................',
    '.......S........',
    '......SSS.......',
    '...S...S...S....',
    '....S..S..S.....',
    '.....S.S.S......',
    '..S...SSS...S...',
    '.SSSSSSSSSSSSS..',
    '..S...SSS...S...',
    '.....S.S.S......',
    '....S..S..S.....',
    '...S...S...S....',
    '......SSS.......',
    '.......S........',
    '................',
    '................',
  ],
  storm: [
    '......GGGG......',
    '.....GGGGGG.....',
    '..GG.GGGGGG.GG..',
    '.GGGGGGGGGGGGGG.',
    'GGGGGGGGGGGGGGGG',
    'GGGGGGGGGGGGGGGG',
    'KKKKKKKKKKKKKKKK',
    '.KKKKKKKKKKKKKK.',
    '................',
    '........LL......',
    '.......LL.......',
    '......LLLLL.....',
    '........LL......',
    '.......LL.......',
    '......LL........',
    '......L.........',
  ],
  tsnow: [
    '......GGGG......',
    '.....GGGGGG.....',
    '..GG.GGGGGG.GG..',
    '.GGGGGGGGGGGGGG.',
    'GGGGGGGGGGGGGGGG',
    'GGGGGGGGGGGGGGGG',
    'KKKKKKKKKKKKKKKK',
    '.KKKKKKKKKKKKKK.',
    '................',
    '....LL.....S....',
    '...LL....S.S.S..',
    '..LLLLL...SSS...',
    '....LL..SSSSSSS.',
    '...LL.....SSS...',
    '..LL.....S.S.S..',
    '..L........S....',
  ],
  fog: [
    '......EEEE......',
    '.....EEEEEE.....',
    '..EE.EEEEEE.EE..',
    '.EEEEEEEEEEEEEE.',
    'EEEEEEEEEEEEEEEE',
    'EEEEEEEEEEEEEEEE',
    'EEEEEEEEEEEEEEEE',
    '.EEEEEEEEEEEEEE.',
    '................',
    '................',
    'FFFFFFFFFFFF....',
    '................',
    '....FFFFFFFFFFFF',
    '................',
    'FFFFFFFFFFFF....',
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

module.exports = { ICONS, ICONS16, PALETTE, PALETTE16, ALERT_BANG, OWL, iconForCode, drawIcon };
