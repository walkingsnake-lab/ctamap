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
const ML_LINE_WIDTH = 3;
const TRAIN_RADIUS = 4;
const TRAIN_GLOW_RADIUS = 10;
const MAP_PADDING = 0.05; // 5% padding around the map
