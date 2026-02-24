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
const REFRESH_INTERVAL = 15000;

// Visual constants
const LINE_WIDTH = 1.5;
const TRAIN_RADIUS = 2.5;
const TRAIN_GLOW_RADIUS = 7;
const TERMINUS_HOLD_MS = 60000; // Hold train at terminus before fade-out
const MAP_PADDING = 0.05; // 5% padding around the map

// Real-time animation constants
const FALLBACK_SPEED = 1e-7;                 // degrees/ms — ~25mph (25mi/h ÷ 69mi/° ÷ 3.6e6ms/h)
const CORRECTION_DURATION = 2000;            // ms to smoothly correct drift after API refresh
const CORRECTION_SNAP_THRESHOLD = 0.005;     // degrees — beyond this, snap instead of blend
const SEGMENT_CONNECT_THRESHOLD = 0.001;     // degrees — max gap to consider segments connected
const EXIT_COAST_TIMEOUT = 60000;            // ms — how long exiting trains keep moving toward terminal

// Map CTA line names (from GeoJSON "lines" property) → legend codes for station disambiguation
const LINE_NAME_TO_LEGEND_STATION = {
  'Red': 'RD', 'Blue': 'BL', 'Brown': 'BR', 'Green': 'GR',
  'Orange': 'OR', 'Pink': 'PK', 'Purple': 'PR', 'Yellow': 'YL'
};
