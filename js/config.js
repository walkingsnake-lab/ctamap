// CTA line colors keyed by GeoJSON legend code
const LINE_COLORS = {
  RD:  '#C60C30',
  BL:  '#00A1DE',
  BR:  '#62361B',
  GR:  '#009B3A',
  OR:  '#F14624',
  PK:  '#E27EA6',
  PR:  '#522398',
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

// All API route codes
const API_ROUTES = ['red', 'blue', 'brn', 'G', 'org', 'P', 'pink', 'Y'];

// Data source for line geometry (no auth required)
const GEOJSON_URL = '/api/geojson';

// CTA Train Tracker API (proxied through server.js to avoid CORS issues)
const API_BASE = '/api/trains';
const API_KEY = true; // Key is stored server-side in server.js

// How often to refresh train positions (ms)
const REFRESH_INTERVAL = 30000;

// Visual constants
const LINE_WIDTH = 2.5;
const TRAIN_RADIUS = 4;
const TRAIN_GLOW_RADIUS = 10;
// Terminus coordinates keyed by "legend:destNm" — used to animate trains
// to their final stop before fading out.  Coordinates are [lon, lat].
const TERMINUS_COORDS = {
  // Red
  'RD:Howard':           [-87.672892, 42.019063],
  'RD:95th/Dan Ryan':    [-87.624415, 41.722376],
  // Blue
  'BL:O\'Hare':          [-87.901848, 41.978877],
  'BL:Forest Park':      [-87.817318, 41.874257],
  // Brown
  'BR:Kimball':          [-87.713142, 41.967928],
  'BR:Loop':             [-87.633913, 41.885725],
  // Green
  'GR:Harlem/Lake':      [-87.803176, 41.886848],
  'GR:Cottage Grove':    [-87.605857, 41.780309],
  'GR:Ashland/63rd':     [-87.663845, 41.778953],
  // Orange
  'OR:Midway':           [-87.737956, 41.786614],
  'OR:Loop':             [-87.626418, 41.858759],
  // Pink
  'PK:54th/Cermak':      [-87.756692, 41.851773],
  'PK:Loop':             [-87.669429, 41.885243],
  // Purple
  'PR:Linden':           [-87.690730, 42.073153],
  'PR:Howard':           [-87.672892, 42.019063],
  'PR:Loop':             [-87.633913, 41.885725],
  // Yellow
  'YL:Skokie':           [-87.751919, 42.038951],
  'YL:Howard':           [-87.672892, 42.019063],
};

const TERMINUS_TRAVEL_MS = 10000; // Time for train to glide to terminus
const TERMINUS_FADE_MS = 2000;    // Fade-out duration after arriving
const MAP_PADDING = 0.05; // 5% padding around the map
