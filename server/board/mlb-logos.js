'use strict';
// Team logos for the baseball screen's logo layout (design spec §8).
//
// The art is the owner's 32x32 sprite sheet (5 x 6 tiles in the order of
// SHEET, drawn at any integer scale). It is never committed: the repo is
// public and the logos are trademarks. The owner uploads the sheet from the
// phone control page; prepSheet() turns it into what the board draws and the
// result is kept next to the board state (BOARD_STATE_DIR / the Fly volume).
//
// Prep only recolors and fills the given art (nothing is drawn): per team,
// outlines are removed or remapped (PREP), the tile is box-scaled to 24px,
// dimmed to DIM (scores carry a black border to stand out), and a 12-row band is cropped at
// the team's offset (OFFSET). Each crop is 24 x 12 RGB (864 bytes) with the
// band color it sits on; its id is the team plus a content hash, so the board
// fetches each logo once (GET /board/logo/<id>, like radar frames).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const FILE_NAME = 'mlb-logos.json';
const TILE = 32, SIZE = 24, ROWS = 12, DIM = 0.9;
const LOGO_BYTES = SIZE * ROWS * 3;

// Tile order on the sheet (teams.js abbreviations).
const SHEET = [
  'BAL', 'BOS', 'NYY', 'TB', 'TOR',
  'CWS', 'CLE', 'DET', 'KC', 'MIN',
  'HOU', 'LAA', 'ATH', 'SEA', 'TEX',
  'ATL', 'MIA', 'NYM', 'PHI', 'WSH',
  'CHC', 'CIN', 'MIL', 'PIT', 'STL',
  'AZ', 'COL', 'LAD', 'SD', 'SF',
];

const RED = '#be0039', W = '#ffffff', BLUE = '#2451a3', DARK = '#282828', BLACK = '#000000';
const GOLD = '#ffa900', ORANGE = '#ff4500', YEL = '#fed634', GREY = '#898d90', LGREY = '#d5d7d9';
const BROWN = '#6d492f', TAN = '#ffb470', DRED = '#6c001b';
const B = 'band';

// Per team (colors as on the sheet):
//   band   : band color when it isn't the tile background
//   map    : color -> color for every pixel ('band' = the band color)
//   hollow : outline-art logos: background enclosed by this outline color
//            becomes the solid mark (in `body`, default the outline color),
//            counters stay band, and the outline itself goes to band
//   minbody: with hollow, enclosed pieces smaller than this stay band
//   strip  : remove only the outline of this color that touches the outside
//   halo   : LAA: the blue ellipse above the A becomes this color
const PREP = {
  BAL: { band: DARK },
  BOS: { hollow: W },
  NYY: { hollow: W, band: '#3a5fa8' },
  TB: { map: { [BLUE]: B } },
  TOR: {},
  CWS: { hollow: W, band: DARK },
  CLE: { map: { [W]: B } },
  DET: { hollow: W },
  KC: { strip: W },
  MIN: { hollow: W, minbody: 15 },
  HOU: {},
  LAA: { band: RED, map: { [GREY]: B, [BLUE]: B, [RED]: W, [DRED]: W }, halo: LGREY },
  ATH: { map: { [GOLD]: B } },
  SEA: { map: { [W]: B } },
  TEX: {},
  ATL: { map: { [BLUE]: B } },
  MIA: { band: DARK },
  NYM: { map: { [W]: B } },
  PHI: { map: { [W]: B } },
  WSH: { map: { [LGREY]: RED, [RED]: W, [BLUE]: B } },
  CHC: {},                                   // keeps its white outline
  CIN: { hollow: W },
  MIL: { hollow: YEL },
  PIT: { hollow: BLACK, band: DARK, body: YEL },
  STL: { map: { [BLUE]: RED, [RED]: W, [W]: B } },
  AZ: { hollow: TAN },
  COL: { map: { [BLACK]: B } },
  LAD: { hollow: W },
  SD: { hollow: GOLD },
  SF: { hollow: BROWN, band: DARK, body: ORANGE },
};

// Fingerprints of the tiles PREP and OFFSET were tuned on. A tile that
// doesn't match (the owner swapped in their own art) is used as drawn: no
// cleanup, band = its corner color, centered crop.
const TUNED = {
  BAL: 'ba2b1661940b', BOS: '088dd7acdd7c', NYY: '07f7264d8266', TB: 'e07a2eda3c52', TOR: 'f46ccea2c270',
  CWS: 'cebbfc21b31a', CLE: 'e2913106be42', DET: 'f29a40607ffb', KC: '97e46df32c51', MIN: 'b1814468393e',
  HOU: '9794246ab736', LAA: 'a69b2e0d5520', ATH: '16766d7f5954', SEA: 'cb620840f895', TEX: '0634a41087d8',
  ATL: '24442ef59536', MIA: 'c773bc471c6a', NYM: '50be8affb9ba', PHI: 'dbce3ce22cda', WSH: 'cbe3c436cdaf',
  CHC: '9d1caf7cdc28', CIN: '5192e4d14daa', MIL: '4f8510e84935', PIT: 'e4977cc1f063', STL: '51b633b0bf02',
  AZ: 'fd9b668e17d0', COL: '14b09b5e62f0', LAD: 'b9da8945d52a', SD: '21c4a842aaec', SF: '18966f7a0848',
};
// Owner-supplied replacement tiles (by fingerprint): used as drawn, with a
// crop offset picked for each.
const CUSTOM = {
  '5c7653cd53c5': { offset: 3 },  // COL: the CR
  '2c5d7416e1e8': { offset: 2 },  // LAA: the A with its halo
};
const fingerprint = (tile) => crypto.createHash('sha1').update(tile.map((r) => r.join('')).join('')).digest('hex').slice(0, 12);

// First of the 12 rows shown, out of 24 (default: centered).
const OFFSET = { TB: 4, TOR: 3, KC: 5, TEX: 2, PHI: 3, PIT: 3, MIA: 3, LAA: 1, AZ: 4, MIN: 3 };

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// One 32x32 tile as hex colors, sampling each scaled pixel's center.
function readTiles(png) {
  const cols = 5, rows = 6;
  const scale = Math.floor(png.width / (cols * TILE));
  if (scale < 1 || png.width !== cols * TILE * scale || png.height !== rows * TILE * scale) {
    throw new Error(`expected a ${cols} x ${rows} sheet of ${TILE}px tiles (e.g. ${cols * TILE * 8} x ${rows * TILE * 8}), got ${png.width} x ${png.height}`);
  }
  const tiles = {};
  SHEET.forEach((ab, n) => {
    const ox = (n % cols) * TILE * scale, oy = Math.floor(n / cols) * TILE * scale;
    const t = [];
    for (let y = 0; y < TILE; y++) {
      const row = [];
      for (let x = 0; x < TILE; x++) {
        const i = ((oy + y * scale + (scale >> 1)) * png.width + ox + x * scale + (scale >> 1)) * 4;
        row.push(hex(png.data[i], png.data[i + 1], png.data[i + 2]));
      }
      t.push(row);
    }
    tiles[ab] = t;
  });
  return tiles;
}

const N4 = (x, y) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
const inside = (x, y) => x >= 0 && y >= 0 && x < TILE && y < TILE;

// 4-connected components of the pixels where pred(x, y) holds.
function components(pred) {
  const seen = new Set(), out = [];
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    if (seen.has(y * TILE + x) || !pred(x, y)) continue;
    const comp = [], stack = [[x, y]];
    while (stack.length) {
      const [px, py] = stack.pop();
      const k = py * TILE + px;
      if (!inside(px, py) || seen.has(k) || !pred(px, py)) continue;
      seen.add(k); comp.push(k);
      for (const q of N4(px, py)) stack.push(q);
    }
    out.push(comp);
  }
  return out;
}

// Recolor one tile per its PREP entry. Returns { px: hex[32][32], band }.
function prepTile(t, c = {}) {
  const at = (k) => t[Math.floor(k / TILE)][k % TILE];
  const bg = t[0][0];
  const onEdge = (comp) => comp.some((k) => { const x = k % TILE, y = Math.floor(k / TILE); return x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1; });
  const bgComps = components((x, y) => t[y][x] === bg);
  const outer = new Set(bgComps.filter(onEdge).flat());
  const map = c.map || {};
  const band = c.band || (map[bg] && map[bg] !== B ? map[bg] : bg);
  const res = new Map();
  const nb = (k) => N4(k % TILE, Math.floor(k / TILE)).filter(([x, y]) => inside(x, y)).map(([x, y]) => y * TILE + x);

  if (c.hollow) {
    const oc = c.hollow;
    const touch = new Set(components((x, y) => t[y][x] === oc).filter((comp) => comp.some((k) => nb(k).some((q) => outer.has(q)))).flat());
    for (const comp of bgComps) {
      if (onEdge(comp)) continue;
      const ring = comp.flatMap(nb).filter((q) => at(q) === oc);
      let body = ring.length > 0 && ring.filter((q) => touch.has(q)).length / ring.length > 0.2;
      if (c.minbody && comp.length < c.minbody) body = false;
      for (const k of comp) res.set(k, body ? (c.body || oc) : band);
    }
  }
  if (c.strip) {
    for (const comp of components((x, y) => t[y][x] === c.strip)) {
      if (comp.some((k) => nb(k).some((q) => outer.has(q)))) for (const k of comp) res.set(k, band);
    }
  }
  if (c.halo) {
    const isA = (x, y) => inside(x, y) && (t[y][x] === RED || t[y][x] === DRED);
    for (let y = 0; y < 11; y++) for (let x = 0; x < TILE; x++) {
      if (t[y][x] !== BLUE) continue;
      const d = ((x - 15.5) / 7) ** 2 + ((y - 5) / 4) ** 2;
      const nearA = N4(x, y).some(([qx, qy]) => isA(qx, qy));
      if (d >= (y < 5 ? 0.45 : 0.55) && d <= 1.4 && !(y >= 6 && nearA)) res.set(y * TILE + x, c.halo);
    }
  }
  const px = [];
  for (let y = 0; y < TILE; y++) {
    const row = [];
    for (let x = 0; x < TILE; x++) {
      const k = y * TILE + x, v = t[y][x];
      let out;
      if (outer.has(k)) out = band;
      else if (res.has(k)) out = res.get(k);
      else if (c.hollow && v === c.hollow) out = band;
      else out = map[v] === B ? band : map[v] || v;
      row.push(out);
    }
    px.push(row);
  }
  return { px, band };
}

// Area-average a 32x32 hex tile down to SIZE x SIZE RGB (Float arrays).
function boxScale(px) {
  const k = TILE / SIZE, out = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const x0 = x * k, x1 = x0 + k, y0 = y * k, y1 = y0 + k;
    const acc = [0, 0, 0];
    let wsum = 0;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const w = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
      if (w <= 0) continue;
      const c = rgb(px[sy][sx]);
      for (let i = 0; i < 3; i++) acc[i] += c[i] * w;
      wsum += w;
    }
    out.push(acc.map((v) => v / wsum));
  }
  return out;
}

// Uploaded sheet (PNG bytes) -> { ab: { id, band, bytes, custom } }.
function prepSheet(pngBytes) {
  let png;
  try { png = PNG.sync.read(pngBytes); }
  catch (e) { throw new Error(`not a PNG: ${e.message}`); }
  const tiles = readTiles(png);
  const out = {};
  for (const ab of SHEET) {
    const fp = fingerprint(tiles[ab]);
    const custom = fp !== TUNED[ab];
    const { px, band } = prepTile(tiles[ab], custom ? {} : PREP[ab]);
    const scaled = boxScale(px);
    const off = custom ? (CUSTOM[fp] ? CUSTOM[fp].offset : (SIZE - ROWS) / 2) : OFFSET[ab] != null ? OFFSET[ab] : (SIZE - ROWS) / 2;
    const bytes = Buffer.alloc(LOGO_BYTES);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < SIZE; x++) {
      const c = scaled[(off + y) * SIZE + x];
      for (let i = 0; i < 3; i++) bytes[(y * SIZE + x) * 3 + i] = Math.round(c[i] * DIM);
    }
    const bandDim = hex(...rgb(band).map((v) => Math.round(v * DIM)));
    const id = `${ab}-${crypto.createHash('sha1').update(bytes).update(bandDim).digest('hex').slice(0, 8)}`;
    out[ab] = { id, band: bandDim, bytes, custom };
  }
  return out;
}

// Prepared logos, kept as one JSON file beside the board state.
function createLogos({ dir, log = console } = {}) {
  const file = dir ? path.join(dir, FILE_NAME) : null;
  let byAb = {}, byId = new Map(), updated = null;

  function index(data) {
    byAb = {}; byId = new Map();
    for (const [ab, l] of Object.entries(data.teams || {})) {
      const bytes = Buffer.from(l.bytes, 'base64');
      if (bytes.length !== LOGO_BYTES) continue;
      byAb[ab] = { id: l.id, band: l.band, custom: !!l.custom };
      byId.set(l.id, bytes);
    }
    updated = data.updated || null;
  }

  if (file) {
    try { if (fs.existsSync(file)) index(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (e) { log.error('[board] logos: could not read', file, e.message); }
  }

  return {
    // { id, band } for a team abbreviation, or null without logos.
    get: (ab) => (byAb[ab] ? { id: byAb[ab].id, band: byAb[ab].band } : null),
    // 864 bytes (24 x 12 RGB) for a logo id, or null.
    bytes: (id) => byId.get(id) || null,
    status: () => ({ teams: Object.keys(byAb).length, updated, custom: Object.keys(byAb).filter((ab) => byAb[ab].custom) }),
    // Replace the set from an uploaded sheet; persists atomically.
    upload(pngBytes, now = Math.floor(Date.now() / 1000)) {
      const prepared = prepSheet(pngBytes);
      const data = { updated: now, teams: {} };
      for (const [ab, l] of Object.entries(prepared)) data.teams[ab] = { id: l.id, band: l.band, custom: l.custom, bytes: l.bytes.toString('base64') };
      if (file) {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, file);
      }
      index(data);
      return this.status();
    },
  };
}

module.exports = { createLogos, prepSheet, prepTile, readTiles, fingerprint, TUNED, SHEET, PREP, OFFSET, SIZE, ROWS, DIM, LOGO_BYTES };
