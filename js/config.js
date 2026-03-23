// CTA line colors keyed by GeoJSON legend code
const LINE_COLORS = {
  RD:  '#C60C30',
  BL:  '#00A1DE',
  BR:  '#895129',
  GR:  '#009B3A',
  OR:  '#F14624',
  PK:  '#E27EA6',
  PR:  '#7C3AED',
  YL:  '#F9E300',
  ML:  '#888888'   // Shared / Loop segments
};

// Map API route codes → GeoJSON legend codes
const ROUTE_TO_LEGEND = {
  red:  'RD',
  blue: 'BL',
  brn:  'BR',
  G:    'GR',
  org:  'OR',
  P:    'PR',
  pink: 'PK',
  Y:    'YL'
};

// Reverse lookup: legend → API route code
const LEGEND_TO_ROUTE = Object.fromEntries(
  Object.entries(ROUTE_TO_LEGEND).map(([k, v]) => [v, k])
);

// Human-readable line names
const LEGEND_TO_LINE_NAME = {
  RD: 'Red', BL: 'Blue', BR: 'Brown', GR: 'Green',
  OR: 'Orange', PK: 'Pink', PR: 'Purple', YL: 'Yellow'
};

// All API route codes
const API_ROUTES = ['red', 'blue', 'brn', 'G', 'org', 'P', 'pink', 'Y'];

// Data source for line geometry (no auth required)
const GEOJSON_URL = '/api/geojson';

// CTA Train Tracker API (proxied through server.js to avoid CORS issues)
const API_BASE = '/api/trains';
const API_KEY = true; // Key is stored server-side in server.js

// How often to refresh train positions (ms)
// CTA updates positions every ~60-120s, so faster polling just gets stale data.
// 30s is a good balance: frequent enough to feel live, conservative enough to
// respect the 100K daily API transaction limit.
const REFRESH_INTERVAL = 30000;

// Visual constants
const LINE_WIDTH = 1.5;
const TRAIN_RADIUS = 3;
const TRAIN_GLOW_RADIUS = 4;
const TERMINUS_HOLD_MS = 30000; // Hold train at terminus before fade-out (30s)
const TERMINAL_PROXIMITY_THRESHOLD = 0.05; // degrees (~5.5km) — max distance to terminal to trigger retirement
const TERMINAL_APPROACH_DURATION = 5000;  // ms to slide retiring train to terminal / spawn new trains
const MAP_PADDING = 0.05; // 5% padding around the map

// Real-time animation constants
const CORRECTION_SPEED_KM_PER_MS = 0.00007; // visual speed for position corrections (~70 m/s); longer moves animate longer
const CORRECTION_MIN_DURATION    = 1500;    // ms — floor so even tiny jitter gets a smooth correction
const CORRECTION_MAX_DURATION    = 10000;   // ms — cap so animation finishes well before the next 30s refresh
const CORRECTION_SNAP_THRESHOLD = 0.045;     // degrees (~3.9km) — beyond this, snap instead of slide
const SEGMENT_CONNECT_THRESHOLD = 0.001;     // degrees — max gap to consider segments connected
const SNAP_AFFINITY_MARGIN = 1.5;            // factor — affinity snap must be this much worse than global snap to lose
const BACKWARD_CONFIRM_POLLS     = 6;        // consecutive polls required before accepting a backward move — when confirmed, snap rather than animate
const FORWARD_CONFIRM_POLLS      = 4;        // consecutive polls required before accepting a suspiciously fast forward jump within slide range
const FORWARD_SNAP_CONFIRM_POLLS = 5;        // consecutive polls required before accepting a forward jump in snap range (> CORRECTION_SNAP_THRESHOLD)
const FORWARD_PLAUSIBLE_DIST = 0.03;        // degrees (~3 km) — forward drift beyond this in a single update is treated as a phantom position
const PHANTOM_STATION_RADIUS = 0.005;       // degrees (~550m) — proximity threshold for matching station-based phantom jump rules
const STATION_JUMP_RADIUS = 0.003;          // degrees (~440m) — proximity to station for nearStation tracking (used in log context)

// Known phantom jump patterns: specific station→station jumps that the CTA API
// reports erroneously.  Each rule is checked on every position update; if the
// train's previous nearest station matches fromStations and the new position's
// nearest station matches toStations, the jump is immediately rejected without
// waiting for generic confirmation polls.
//
// Fields:
//   legend      — line code (e.g. 'PR')
//   fromStations — array of station names defining the "from" zone
//   toStations   — array of station names defining the "to" zone
//   description  — human-readable label for console logging
const KNOWN_PHANTOM_JUMPS = [
  // Purple Express — Wilson area phantoms (user identified)
  { legend: 'PR', fromStations: ['Wilson', 'Jarvis'], toStations: ['South Blvd'],
    description: 'Purple Express Wilson/Jarvis → South Blvd phantom' },
  { legend: 'PR', fromStations: ['Wilson', 'Jarvis'], toStations: ['Howard'],
    description: 'Purple Express Wilson/Jarvis → Howard phantom' },

  // Blue Line - Harlem/Cumberland/Jefferson Park corridor (user identified + logs)
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

  // Green Line - 35th/Bronzeville corridor (from logs, 6.5km snap-range jump)
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

  // Red Line — Fullerton / North/Clybourn subway portal gap (user identified)
  { legend: 'RD', fromStations: ['Fullerton'], toStations: ['North/Clybourn'],
    description: 'Red Line Fullerton → North/Clybourn phantom' },
  { legend: 'RD', fromStations: ['North/Clybourn'], toStations: ['Fullerton'],
    description: 'Red Line North/Clybourn → Fullerton phantom' },

  // Red Line — Loyola / Wilson fast-forward (from logs, 4170m)
  { legend: 'RD', fromStations: ['Loyola'], toStations: ['Wilson'],
    description: 'Red Line Loyola → Wilson phantom' },
  { legend: 'RD', fromStations: ['Wilson'], toStations: ['Loyola'],
    description: 'Red Line Wilson → Loyola phantom' },

  // Red Line — Roosevelt / Cermak-Chinatown backward jump
  { legend: 'RD', fromStations: ['Roosevelt'], toStations: ['Cermak-Chinatown'],
    description: 'Red Line Roosevelt → Cermak-Chinatown phantom' },
  { legend: 'RD', fromStations: ['Cermak-Chinatown'], toStations: ['Roosevelt'],
    description: 'Red Line Cermak-Chinatown → Roosevelt phantom' },

  // Pink Line — Polk / Ashland backward jump (from logs, 1144m)
  { legend: 'PK', fromStations: ['Polk'], toStations: ['Ashland'],
    description: 'Pink Line Polk → Ashland phantom' },
  { legend: 'PK', fromStations: ['Ashland'], toStations: ['Polk'],
    description: 'Pink Line Ashland → Polk phantom' },

  // Brown Line — Sedgwick / Chicago backward jump (from logs, 1075m)
  // Purple Line shares this segment
  { legend: 'BR', fromStations: ['Sedgwick'], toStations: ['Chicago'],
    description: 'Brown Line Sedgwick → Chicago phantom' },
  { legend: 'BR', fromStations: ['Chicago'], toStations: ['Sedgwick'],
    description: 'Brown Line Chicago → Sedgwick phantom' },
  { legend: 'PR', fromStations: ['Sedgwick'], toStations: ['Chicago'],
    description: 'Purple Line Sedgwick → Chicago phantom' },
  { legend: 'PR', fromStations: ['Chicago'], toStations: ['Sedgwick'],
    description: 'Purple Line Chicago → Sedgwick phantom' },
];

// Pre-indexed version of KNOWN_PHANTOM_JUMPS keyed by legend for O(1) legend lookup.
// Avoids iterating all rules when most don't match the current train's line.
const PHANTOM_JUMP_BY_LEGEND = (() => {
  const m = new Map();
  for (const rule of KNOWN_PHANTOM_JUMPS) {
    if (!m.has(rule.legend)) m.set(rule.legend, []);
    m.get(rule.legend).push(rule);
  }
  return m;
})();

// Destination + line combos that use inverted badge (white bg, colored text)
// Matches real CTA signage for certain short-turn / branch terminuses
const INVERTED_BADGE_DESTS = {
  BL: ['UIC-Halsted'],
  GR: ['Cottage Grove'],
};

function isInvertedBadge(legend, destNm) {
  const dests = INVERTED_BADGE_DESTS[legend];
  if (!dests || !destNm) return false;
  const upper = destNm.toUpperCase();
  return dests.some(d => upper.includes(d.toUpperCase()));
}

function badgeFill(legend, destNm) {
  return isInvertedBadge(legend, destNm) ? '#fff' : (LINE_COLORS[legend] || '#fff');
}

function badgeTextFill(legend, destNm) {
  if (isInvertedBadge(legend, destNm)) return LINE_COLORS[legend] || '#000';
  return legend === 'YL' ? '#000' : '#fff';
}

/**
 * Strips intersection qualifiers from CTA station names.
 * Stations on the Blue/Red subway trunks include the cross-street
 * (e.g. "Washington/Dearborn", "Washington/State", "Chicago/Franklin") but CTA signage
 * and other parts of the API just call them by the street name alone.
 */
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

// Per-station label direction overrides: station name → compass direction
// Valid directions: 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'
const STATION_LABEL_OVERRIDES = {
  // Monroe and Jackson are adjacent downtown N-S subway stations.  N/S overrides
  // leave both leader lines converging in the same vertical corridor between
  // the dots.  NE+SE puts both labels to the east at different heights — Monroe
  // label upper-right, Jackson lower-right — matching their geography, with
  // leader lines angling westward to their own dots without crossing.
  'Monroe': 'E',
  'Jackson': 'E',
};

// Map CTA line names (from GeoJSON "lines" property) → legend codes for station disambiguation
const LINE_NAME_TO_LEGEND_STATION = {
  'Red': 'RD', 'Blue': 'BL', 'Brown': 'BR', 'Green': 'GR',
  'Orange': 'OR', 'Pink': 'PK', 'Purple': 'PR', 'Yellow': 'YL'
};

// ---- Direction & track constants ----

// Lines that traverse the downtown Loop (shared ML segments)
const LOOP_LINE_CODES = ['BR', 'OR', 'PK', 'PR', 'GR'];
const LOOP_LINE_SET = new Set(LOOP_LINE_CODES);

// Approximate center of the downtown Loop elevated
const LOOP_CENTER = { lon: -87.629, lat: 41.882 };

// Safety iteration limit for advanceOnTrack loop
const ADVANCE_MAX_ITER = 10000;

// ---- UI & zoom constants ----

// Default zoom level when tracking a train
const TRACK_ZOOM_SCALE = 8;

// Zoom level for the Loop view shortcut
const LOOP_ZOOM_SCALE = 4;

// SVG units — trains closer than this are considered overlapping (at reference scale)
const SPREAD_SVG_THRESHOLD = 3;

// Number of direction indicator arrows along track
const ARROW_COUNT = 6;

// SVG-unit multiplier for spread distance between overlapping trains
const BASE_SPREAD = 18;

// Long-press detection: pixel movement threshold and hold duration (ms)
const LP_THRESHOLD = 10;
const LONG_PRESS_MS = 600;

// GeoJSON segment branch suffixes to strip from station display names
const BRANCH_SUFFIXES = [
  'Ravenswood', "O'Hare", 'North Main', 'Lake', 'Congress',
  'Douglas', 'Midway', 'Dan Ryan', 'South Elevated', 'Evanston',
  'Skokie', 'Homan',
];
