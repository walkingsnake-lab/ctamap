'use strict';
// Team logos for the baseball screen's logo layout (design spec §8).
//
// The art is the owner's: 32x32 pixel-art tiles, uploaded from the phone
// control page, either the whole 5 x 6 sheet (tiles in SHEET order, at any
// whole-number scale) or one team at a time. It is never committed (the repo
// is public and the logos are trademarks); prepared logos are kept beside the
// board state (BOARD_STATE_DIR / the Fly volume).
//
// Processing is only a resize and a crop: each 32px tile is box-scaled to
// 24px and a 12-row band is cut at the team's crop offset. The band color the
// logo sits on is the tile's top-left pixel. Colors are otherwise untouched;
// dimming happens on the board (payload `mlb.dim`), so it can be changed
// without re-uploading. The only other step keeps each crop within
// MAX_COLORS colors, because the board draws into a 256-color palette.
//
// Each crop is 24 x 12 RGB (864 bytes); its id is the team plus a content
// hash, so the board fetches each logo once (GET /board/logo/<id>).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { TEAMS } = require('./teams');

const FILE_NAME = 'mlb-logos.json';
const TILE = 32, SIZE = 24, ROWS = 12;
const LOGO_BYTES = SIZE * ROWS * 3;
const MAX_COLORS = 64;
const TEAM_ABS = Object.values(TEAMS).map((t) => t[0]);

// Tile order on the sheet (teams.js abbreviations).
const SHEET = [
  'BAL', 'BOS', 'NYY', 'TB', 'TOR',
  'CWS', 'CLE', 'DET', 'KC', 'MIN',
  'HOU', 'LAA', 'ATH', 'SEA', 'TEX',
  'ATL', 'MIA', 'NYM', 'PHI', 'WSH',
  'CHC', 'CIN', 'MIL', 'PIT', 'STL',
  'AZ', 'COL', 'LAD', 'SD', 'SF',
];

// First of the 12 rows shown, out of 24 (default: centered). An upload can
// set its own.
const DEFAULT_OFFSET = (SIZE - ROWS) / 2;
const OFFSET = { TB: 4, TOR: 3, KC: 5, TEX: 2, PHI: 3, PIT: 3, MIA: 3, LAA: 2, AZ: 4, MIN: 3, COL: 3 };

function decode(pngBytes) {
  try { return PNG.sync.read(pngBytes); }
  catch (e) { throw new Error(`not a PNG: ${e.message}`); }
}

// A tile as [r, g, b] rows (32 x 32) from a region of a decoded PNG. Square
// whole multiples of 32 sample each scaled pixel's center (exact for pixel
// art); any other size is area-averaged down to 32.
function tileFrom(png, x0, y0, w, h) {
  const px = (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
  const t = [];
  if (w === h && w % TILE === 0) {
    const s = w / TILE;
    for (let y = 0; y < TILE; y++) {
      const row = [];
      for (let x = 0; x < TILE; x++) row.push(px(x0 + x * s + (s >> 1), y0 + y * s + (s >> 1)));
      t.push(row);
    }
    return t;
  }
  const kx = w / TILE, ky = h / TILE;
  for (let y = 0; y < TILE; y++) {
    const row = [];
    for (let x = 0; x < TILE; x++) {
      const acc = [0, 0, 0];
      let n = 0;
      const ya = Math.floor(y * ky), yb = Math.max(ya + 1, Math.floor((y + 1) * ky));
      const xa = Math.floor(x * kx), xb = Math.max(xa + 1, Math.floor((x + 1) * kx));
      for (let sy = ya; sy < yb; sy++) for (let sx = xa; sx < xb; sx++) {
        const c = px(x0 + sx, y0 + sy);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++;
      }
      row.push(acc.map((v) => Math.round(v / n)));
    }
    t.push(row);
  }
  return t;
}

// The sheet's tiles by team.
function readSheet(png) {
  const cols = 5, rows = 6;
  const scale = Math.floor(png.width / (cols * TILE));
  if (scale < 1 || png.width !== cols * TILE * scale || png.height !== rows * TILE * scale) {
    throw new Error(`expected a ${cols} x ${rows} sheet of ${TILE}px tiles (e.g. ${cols * TILE * 8} x ${rows * TILE * 8}), got ${png.width} x ${png.height}`);
  }
  const tiles = {};
  SHEET.forEach((ab, n) => {
    tiles[ab] = tileFrom(png, (n % cols) * TILE * scale, Math.floor(n / cols) * TILE * scale, TILE * scale, TILE * scale);
  });
  return tiles;
}

// Area-average 32x32 down to SIZE x SIZE.
function boxScale(t) {
  const k = TILE / SIZE, out = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const x0 = x * k, x1 = x0 + k, y0 = y * k, y1 = y0 + k;
    const acc = [0, 0, 0];
    let wsum = 0;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const w = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
      if (w <= 0) continue;
      for (let i = 0; i < 3; i++) acc[i] += t[sy][sx][i] * w;
      wsum += w;
    }
    out.push(acc.map((v) => Math.round(v / wsum)));
  }
  return out;
}

// Merge the closest colors (weighted by use) until at most `max` remain.
function limitColors(bytes, max) {
  const counts = new Map();
  for (let i = 0; i < bytes.length; i += 3) {
    const k = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  if (counts.size <= max) return bytes;
  let cols = [...counts].map(([k, n]) => ({ c: [k >> 16, (k >> 8) & 255, k & 255], n, from: [k] }));
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  while (cols.length > max) {
    let bi = 0, bj = 1, best = Infinity;
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
      const d = d2(cols[i].c, cols[j].c) * Math.min(cols[i].n, cols[j].n);
      if (d < best) { best = d; bi = i; bj = j; }
    }
    const a = cols[bi], b = cols[bj], n = a.n + b.n;
    const merged = { c: a.c.map((v, i) => Math.round((v * a.n + b.c[i] * b.n) / n)), n, from: a.from.concat(b.from) };
    cols = cols.filter((_, i) => i !== bi && i !== bj).concat([merged]);
  }
  const to = new Map();
  for (const m of cols) for (const k of m.from) to.set(k, m.c);
  const out = Buffer.from(bytes);
  for (let i = 0; i < out.length; i += 3) {
    const c = to.get((out[i] << 16) | (out[i + 1] << 8) | out[i + 2]);
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
  }
  return out;
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// One tile -> { id, band, bytes, crop } for team `ab`.
function prepare(ab, tile, crop) {
  const off = crop != null ? crop : OFFSET[ab] != null ? OFFSET[ab] : DEFAULT_OFFSET;
  if (!Number.isInteger(off) || off < 0 || off > SIZE - ROWS) throw new Error(`crop must be 0-${SIZE - ROWS}`);
  const scaled = boxScale(tile);
  const raw = Buffer.alloc(LOGO_BYTES);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < SIZE; x++) raw.set(scaled[(off + y) * SIZE + x], (y * SIZE + x) * 3);
  const bytes = limitColors(raw, MAX_COLORS);
  const band = hex(tile[0][0]);
  const id = `${ab}-${crypto.createHash('sha1').update(bytes).update(band).digest('hex').slice(0, 8)}`;
  return { id, band, bytes, crop: off };
}

// Whole sheet (PNG bytes) -> { ab: prepared }.
function prepSheet(pngBytes) {
  const tiles = readSheet(decode(pngBytes));
  const out = {};
  for (const ab of SHEET) out[ab] = prepare(ab, tiles[ab]);
  return out;
}

// One team's logo: a PNG of a single 32px tile (any whole-number scale), or
// any other image, area-averaged to 32px.
function prepOne(ab, pngBytes, crop) {
  if (!TEAM_ABS.includes(ab)) throw new Error(`unknown team: ${ab}`);
  const png = decode(pngBytes);
  return prepare(ab, tileFrom(png, 0, 0, png.width, png.height), crop);
}

// Prepared logos, kept as one JSON file beside the board state.
function createLogos({ dir, log = console } = {}) {
  const file = dir ? path.join(dir, FILE_NAME) : null;
  let teams = {}, byId = new Map(), updated = null;

  function index(data) {
    teams = {}; byId = new Map();
    for (const [ab, l] of Object.entries(data.teams || {})) {
      const bytes = Buffer.from(l.bytes, 'base64');
      if (bytes.length !== LOGO_BYTES) continue;
      teams[ab] = l;
      byId.set(l.id, bytes);
    }
    updated = data.updated || null;
  }

  function save(next, now) {
    const data = { updated: now, teams: next };
    if (file) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    }
    index(data);
  }

  const entry = (l) => ({ id: l.id, band: l.band, crop: l.crop, bytes: l.bytes.toString('base64') });

  if (file) {
    try { if (fs.existsSync(file)) index(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (e) { log.error('[board] logos: could not read', file, e.message); }
  }

  const status = () => ({ teams: Object.keys(teams).sort(), updated });
  return {
    // { id, band } for a team abbreviation, or null without a logo.
    get: (ab) => (teams[ab] ? { id: teams[ab].id, band: teams[ab].band } : null),
    // 864 bytes (24 x 12 RGB) for a logo id, or null.
    bytes: (id) => byId.get(id) || null,
    status,
    // Replace every team from a sheet.
    uploadSheet(pngBytes, now = Math.floor(Date.now() / 1000)) {
      const prepared = prepSheet(pngBytes);
      const next = {};
      for (const [ab, l] of Object.entries(prepared)) next[ab] = entry(l);
      save(next, now);
      return status();
    },
    // Replace one team's logo (crop: first row of 24 shown; default per team).
    uploadOne(ab, pngBytes, crop, now = Math.floor(Date.now() / 1000)) {
      const l = prepOne(ab, pngBytes, crop);
      save({ ...teams, [ab]: entry(l) }, now);
      return status();
    },
  };
}

module.exports = { createLogos, prepSheet, prepOne, readSheet, limitColors, SHEET, OFFSET, SIZE, ROWS, LOGO_BYTES, MAX_COLORS };
