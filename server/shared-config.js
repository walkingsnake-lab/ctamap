/**
 * Server-side constants — keep in sync with js/config.js.
 * These are CommonJS exports of the values that the server-side train
 * processing engine needs.  The browser bundle still loads js/config.js
 * as globals; this file is only ever required by server/ modules.
 */
'use strict';

const LINE_COLORS = {
  RD:  '#C60C30',
  BL:  '#00A1DE',
  BR:  '#895129',
  GR:  '#009B3A',
  OR:  '#F14624',
  PK:  '#E27EA6',
  PR:  '#7C3AED',
  YL:  '#F9E300',
  ML:  '#888888',
};

const ROUTE_TO_LEGEND = {
  red:  'RD',
  blue: 'BL',
  brn:  'BR',
  G:    'GR',
  org:  'OR',
  P:    'PR',
  pink: 'PK',
  Y:    'YL',
};

// Map CTA line names (from GeoJSON "lines" property) → legend codes
const LINE_NAME_TO_LEGEND_STATION = {
  'Red': 'RD', 'Blue': 'BL', 'Brown': 'BR', 'Green': 'GR',
  'Orange': 'OR', 'Pink': 'PK', 'Purple': 'PR', 'Yellow': 'YL',
};

const STATION_NAME_OVERRIDES = {
  'Quincy/Wells': 'Quincy',
  'Roosevelt/Wabash': 'Roosevelt',
  'Harold Washington Library-State/Van Buren': 'Library',
  'Harold Washington Library': 'Library',
};

function cleanStationName(name) {
  if (!name) return name;
  if (STATION_NAME_OVERRIDES[name]) return STATION_NAME_OVERRIDES[name];
  return name.replace(/\/(Dearborn|Franklin|State|Milwaukee)$/i, '');
}

function normalizeStationName(name) {
  return name.toLowerCase().replace(/[/\-''`]/g, ' ').replace(/\s+/g, ' ').trim();
}

const BRANCH_SUFFIXES = [
  'Ravenswood', "O'Hare", 'North Main', 'Lake', 'Congress',
  'Douglas', 'Midway', 'Dan Ryan', 'South Elevated', 'Evanston',
  'Skokie', 'Homan',
];

const LINE_NORTH_DESTS = {
  RD: 'Howard',
  BL: "O'Hare",
  BR: 'Kimball',
  GR: 'Harlem',
  OR: 'Loop',
  PK: 'Loop',
  PR: 'Linden',
  YL: 'Skokie',
};

const LOOP_LINE_CODES = ['BR', 'OR', 'PK', 'PR', 'GR'];
const LOOP_LINE_SET   = new Set(LOOP_LINE_CODES);

const LOOP_CENTER = { lon: -87.629, lat: 41.882 };
const LOOP_INNER_RADIUS = 0.016;

// ---- Loop circuit segment ordering ----
// The 10 Loop rectangle ML segments, listed in the natural CCW coordinate order.
// GeoJSON coordinates for these segments already chain endpoint-to-endpoint in this order.
const LOOP_RECT_CCW = [
  'Washington/Wells to Tower 18',
  'Quincy/Wells to Washington/Wells',
  'LaSalle/Van Buren to Quincy/Wells',
  'Library to LaSalle/Van Buren',
  'Tower 12 to Library',
  'Adams/Wabash to Tower 12',
  'Washington/Wabash to Adams/Wabash',
  'State/Lake to Washington/Wabash',
  'Clark/Lake to State/Lake',
  'Tower 18 to Clark/Lake',
];

// Derived arrays for CW and partial circuits
const _LOOP_RECT_CW = [...LOOP_RECT_CCW].reverse();
// North+east side of the Loop (indices 5-9 of CCW = Wabash + Lake segments)
const _LOOP_NORTH_EAST_CW = LOOP_RECT_CCW.slice(5).reverse();

// Per-line Loop circuit definitions.
// descs: ordered segment descriptions for concatenation.
// reverseCoords: if true, reverse each segment's coordinate array (CW direction).
// Segments not listed here remain as individual segments (approach/connector tracks).
//
// KEEP IN SYNC between server/shared-config.js and js/config.js.
const LOOP_CIRCUIT = {
  // Brown: full CCW circuit (Wells↓ → Van Buren→ → Wabash↑ → Lake←)
  BR: { descs: LOOP_RECT_CCW, reverseCoords: false },
  // Purple Express: full CW circuit (Lake→ → Wabash↓ → Van Buren← → Wells↑)
  PR: { descs: _LOOP_RECT_CW, reverseCoords: true },
  // Pink: full CW circuit (same path as Purple)
  PK: { descs: _LOOP_RECT_CW, reverseCoords: true },
  // Orange: CW arc from Library to Tower 12 (enters via Orange connector,
  // exits at Tower 12 via south connector — "Tower 12 to Library" not used).
  // This is LOOP_RECT_CW rotated to start at Library, with Tower 12→Library removed.
  OR: {
    descs: [
      ..._LOOP_RECT_CW.slice(_LOOP_RECT_CW.indexOf('Library to LaSalle/Van Buren')),
      ..._LOOP_RECT_CW.slice(0, _LOOP_RECT_CW.indexOf('Library to LaSalle/Van Buren')),
    ].filter(d => d !== 'Tower 12 to Library'),
    reverseCoords: true,
  },
  // Green: through-route from Tower 18 to Tower 12 (Lake→ → Wabash↓)
  GR: { descs: _LOOP_NORTH_EAST_CW, reverseCoords: true },
};

const PROBE_DIST = 0.015;
const ADVANCE_MAX_ITER = 10000;

const SEGMENT_CONNECT_THRESHOLD  = 0.001;
const SNAP_AFFINITY_MARGIN       = 1.5;
const CORRECTION_SNAP_THRESHOLD  = 0.045;
const FORWARD_PLAUSIBLE_DIST     = 0.03;
const PHANTOM_STATION_RADIUS     = 0.005;
const STATION_JUMP_RADIUS        = 0.003;

// Terminal retirement — keep in sync with js/config.js
const TERMINUS_HOLD_MS             = 30000;  // 30s hold at terminal before retiring
const TERMINAL_PROXIMITY_THRESHOLD = 0.05;   // degrees (~5.5km) — max distance to terminal

const BACKWARD_CONFIRM_POLLS      = 6;
const FORWARD_CONFIRM_POLLS       = 4;
const FORWARD_SNAP_CONFIRM_POLLS  = 5;

const KNOWN_PHANTOM_JUMPS = [
  { legend: 'PR', fromStations: ['Wilson', 'Jarvis'], toStations: ['South Blvd'],
    description: 'Purple Express Wilson/Jarvis → South Blvd phantom' },
  { legend: 'PR', fromStations: ['Wilson', 'Jarvis'], toStations: ['Howard'],
    description: 'Purple Express Wilson/Jarvis → Howard phantom' },
  { legend: 'BL', fromStations: ['Harlem', 'Cumberland'], toStations: ['Jefferson Park'],
    description: 'Blue Line Harlem/Cumberland → Jefferson Park phantom' },
  { legend: 'BL', fromStations: ['Jefferson Park', 'Cumberland'], toStations: ['Harlem'],
    description: 'Blue Line Jefferson Park/Cumberland → Harlem phantom' },
  { legend: 'BL', fromStations: ['Harlem'], toStations: ['Cumberland'],
    description: 'Blue Line Harlem → Cumberland phantom' },
  { legend: 'BL', fromStations: ['Cumberland'], toStations: ['Harlem'],
    description: 'Blue Line Cumberland → Harlem phantom' },
  { legend: 'BL', fromStations: ["O'Hare Airport"], toStations: ['Rosemont'],
    description: "Blue Line O'Hare → Rosemont phantom" },
  { legend: 'BL', fromStations: ['Rosemont'], toStations: ["O'Hare Airport"],
    description: "Blue Line Rosemont → O'Hare phantom" },
  { legend: 'GR', fromStations: ['35-Bronzeville-IIT'], toStations: ['Cottage Grove'],
    description: 'Green Line 35-Bronzeville-IIT → Cottage Grove phantom' },
  { legend: 'GR', fromStations: ['Cottage Grove'], toStations: ['35-Bronzeville-IIT'],
    description: 'Green Line Cottage Grove → 35-Bronzeville-IIT phantom' },
  { legend: 'GR', fromStations: ['Cermak-McCormick Place'], toStations: ['35-Bronzeville-IIT'],
    description: 'Green Line Cermak-McCormick Place → 35-Bronzeville-IIT phantom' },
  { legend: 'GR', fromStations: ['35-Bronzeville-IIT'], toStations: ['Cermak-McCormick Place'],
    description: 'Green Line 35-Bronzeville-IIT → Cermak-McCormick Place phantom' },
  { legend: 'GR', fromStations: ['35-Bronzeville-IIT', 'Cermak-McCormick Place'],
    toStations: ['Cottage Grove', 'King Drive'],
    description: 'Green Line 35th area → Cottage Grove branch phantom' },
  { legend: 'GR', fromStations: ['Roosevelt'], toStations: ['Cermak-McCormick Place'],
    description: 'Green Line Roosevelt → Cermak-McCormick Place phantom' },
  { legend: 'GR', fromStations: ['Cermak-McCormick Place'], toStations: ['Roosevelt'],
    description: 'Green Line Cermak-McCormick Place → Roosevelt phantom' },
  { legend: 'RD', fromStations: ['Fullerton'], toStations: ['North/Clybourn'],
    description: 'Red Line Fullerton → North/Clybourn phantom' },
  { legend: 'RD', fromStations: ['North/Clybourn'], toStations: ['Fullerton'],
    description: 'Red Line North/Clybourn → Fullerton phantom' },
  { legend: 'RD', fromStations: ['Loyola'], toStations: ['Wilson'],
    description: 'Red Line Loyola → Wilson phantom' },
  { legend: 'RD', fromStations: ['Wilson'], toStations: ['Loyola'],
    description: 'Red Line Wilson → Loyola phantom' },
  { legend: 'RD', fromStations: ['Roosevelt'], toStations: ['Cermak-Chinatown'],
    description: 'Red Line Roosevelt → Cermak-Chinatown phantom' },
  { legend: 'RD', fromStations: ['Cermak-Chinatown'], toStations: ['Roosevelt'],
    description: 'Red Line Cermak-Chinatown → Roosevelt phantom' },
  { legend: 'PK', fromStations: ['Polk'], toStations: ['Ashland'],
    description: 'Pink Line Polk → Ashland phantom' },
  { legend: 'PK', fromStations: ['Ashland'], toStations: ['Polk'],
    description: 'Pink Line Ashland → Polk phantom' },
  { legend: 'BR', fromStations: ['Sedgwick'], toStations: ['Chicago'],
    description: 'Brown Line Sedgwick → Chicago phantom' },
  { legend: 'BR', fromStations: ['Chicago'], toStations: ['Sedgwick'],
    description: 'Brown Line Chicago → Sedgwick phantom' },
  { legend: 'PR', fromStations: ['Sedgwick'], toStations: ['Chicago'],
    description: 'Purple Line Sedgwick → Chicago phantom' },
  { legend: 'PR', fromStations: ['Chicago'], toStations: ['Sedgwick'],
    description: 'Purple Line Chicago → Sedgwick phantom' },
];

const PHANTOM_JUMP_BY_LEGEND = (() => {
  const m = new Map();
  for (const rule of KNOWN_PHANTOM_JUMPS) {
    if (!m.has(rule.legend)) m.set(rule.legend, []);
    m.get(rule.legend).push(rule);
  }
  return m;
})();

module.exports = {
  LINE_COLORS,
  ROUTE_TO_LEGEND,
  LINE_NAME_TO_LEGEND_STATION,
  STATION_NAME_OVERRIDES,
  cleanStationName,
  normalizeStationName,
  BRANCH_SUFFIXES,
  LINE_NORTH_DESTS,
  LOOP_LINE_CODES,
  LOOP_LINE_SET,
  LOOP_CENTER,
  LOOP_INNER_RADIUS,
  PROBE_DIST,
  ADVANCE_MAX_ITER,
  SEGMENT_CONNECT_THRESHOLD,
  SNAP_AFFINITY_MARGIN,
  CORRECTION_SNAP_THRESHOLD,
  FORWARD_PLAUSIBLE_DIST,
  PHANTOM_STATION_RADIUS,
  STATION_JUMP_RADIUS,
  BACKWARD_CONFIRM_POLLS,
  FORWARD_CONFIRM_POLLS,
  FORWARD_SNAP_CONFIRM_POLLS,
  KNOWN_PHANTOM_JUMPS,
  PHANTOM_JUMP_BY_LEGEND,
  TERMINUS_HOLD_MS,
  TERMINAL_PROXIMITY_THRESHOLD,
  LOOP_CIRCUIT,
};
