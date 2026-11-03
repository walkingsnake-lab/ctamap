'use strict';
// Radar fallback (contract "Radar", design spec §7): when IEM's archive
// can't give a frame, the same MRMS mosaic from NWS's map service
// (mapservices.weather.noaa.gov, "radar_base_reflectivity_time": MRMS
// MergedBaseReflectivityQC, a 4-hour window of frames every ~6-8 minutes).
//
// It only serves rendered colors, not dBZ, so a frame is asked for exactly
// on the IEM grid (0.01°, same pixel centers) around the wanted stations
// (a few hundred pixels, not CONUS), nearest-neighbor, and each color is
// turned back into dBZ with the service's color ramp: linear between the
// anchors below, one color per 0.5 dBZ. The ramp was measured against the
// raw MRMS files of the same times (Nov 3, 2026; every channel within 0.5
// of the linear fit from -10 to 56 dBZ). The colors are then handed to the
// IEM pipeline as lcref palette indices (dBZ = index * 0.5 - 32).

const https = require('https');

const SERVICE = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';
// IEM's lcref grid: pixel centers from (-129.995, 54.995), 0.01°.
const GRID = { dx: 0.01, dy: -0.01, x0: -129.995, y0: 54.995 };
const NEAR_S = 180;          // a catalog frame within 3 min of the slot stands in for it
const CATALOG_S = 60;        // catalog cached this long

// The color ramp: [dBZ, 0xRRGGBB], linear in between.
const ANCHORS = [
  [-10, 0xd2d4b4], [-5, 0xb0b6b4], [0, 0x949bb5], [5, 0x6376a8], [10, 0x435e9f],
  [15, 0x5eadcf], [20, 0x52d6a2], [25, 0x0ed614], [30, 0x0b880f], [35, 0x095e09],
  [40, 0xffe200], [45, 0xffb100], [50, 0xff0000], [55, 0xb10000], [60, 0xffffff],
];
const TOP_DBZ = 60;
const ch = (c, k) => (c >> (16 - 8 * k)) & 255;

// Every color of the ramp (0.5 dBZ steps) -> dBZ.
const RAMP = new Map();
for (let i = 0; i < ANCHORS.length - 1; i++) {
  const [d0, c0] = ANCHORS[i], [d1, c1] = ANCHORS[i + 1];
  const steps = (d1 - d0) * 2;
  for (let s = 0; s < steps + (i === ANCHORS.length - 2 ? 1 : 0); s++) {
    let c = 0;
    for (let k = 0; k < 3; k++) c = (c << 8) | Math.round(ch(c0, k) + ((ch(c1, k) - ch(c0, k)) * s) / steps);
    if (!RAMP.has(c)) RAMP.set(c, d0 + s / 2);
  }
}
const RAMP_LIST = [...RAMP.entries()];

// A color -> dBZ, or null for no echo. Off-ramp colors (rounding variants)
// take the nearest ramp color when it's close; anything else is past the
// measured ramp: strong echo (>= 60 dBZ) if it's nearest the top of the
// ramp (reds and white), else no echo. `unknown` collects those for the log.
function dbzOfColor(c, unknown = null) {
  if (c < 0) return null; // transparent: no echo
  const hit = RAMP.get(c);
  if (hit !== undefined) return hit;
  let best = null, bestD = Infinity;
  for (const [rc, d] of RAMP_LIST) {
    const e = (ch(rc, 0) - ch(c, 0)) ** 2 + (ch(rc, 1) - ch(c, 1)) ** 2 + (ch(rc, 2) - ch(c, 2)) ** 2;
    if (e < bestD) { bestD = e; best = d; }
  }
  if (bestD <= 3 * 4 * 4) return best;
  if (unknown) unknown.add(c);
  return best >= 50 ? TOP_DBZ : null;
}

// rgbIndex for radar-png.js: a color -> the lcref palette index of its dBZ
// (0: no echo; IEM's indices up to 65 count as none too).
function rgbIndex(unknown = null) {
  return (c) => {
    const d = dbzOfColor(c, unknown);
    return d == null ? 0 : Math.max(0, Math.min(254, Math.round((d + 32) * 2)));
  };
}

// The pixel window of the IEM grid covering every geometry (radar.js
// geometry() on GRID), one pixel of margin. Returns the request's box (its
// outer edges, degrees), size, and the window's own world file.
function windowOf(geos) {
  const x0 = Math.min(...geos.map((g) => g.x0)) - 1, x1 = Math.max(...geos.map((g) => g.x1)) + 1;
  const y0 = Math.min(...geos.map((g) => g.y0)) - 1, y1 = Math.max(...geos.map((g) => g.y1)) + 1;
  const left = GRID.x0 - 0.005 + x0 * 0.01, right = GRID.x0 - 0.005 + (x1 + 1) * 0.01;
  const top = GRID.y0 + 0.005 - y0 * 0.01, bottom = GRID.y0 + 0.005 - (y1 + 1) * 0.01;
  const r = (v) => Math.round(v * 1000) / 1000;
  return {
    bbox: [r(left), r(bottom), r(right), r(top)],
    size: [x1 - x0 + 1, y1 - y0 + 1],
    wld: { dx: 0.01, dy: -0.01, x0: r(GRID.x0 + x0 * 0.01), y0: r(GRID.y0 - y0 * 0.01) },
  };
}

function catalogUrl() {
  const q = new URLSearchParams({
    where: "idp_subset='CONUS'", outFields: 'objectid,idp_validtime', returnGeometry: 'false', orderByFields: 'idp_validtime', f: 'json',
  });
  return `${SERVICE}/query?${q}`;
}

function exportUrl(objectid, win) {
  const q = new URLSearchParams({
    bbox: win.bbox.join(','), bboxSR: '4326', imageSR: '4326', size: win.size.join(','),
    format: 'png', interpolation: 'RSP_NearestNeighbor',
    mosaicRule: JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [objectid] }), f: 'image',
  });
  return `${SERVICE}/exportImage?${q}`;
}

// The catalog's frame nearest `t` (epoch s), within NEAR_S, or null.
// items: [{ id, t }].
function nearest(items, t) {
  let best = null;
  for (const it of items) if (Math.abs(it.t - t) <= NEAR_S && (!best || Math.abs(it.t - t) < Math.abs(best.t - t))) best = it;
  return best;
}

function parseCatalog(json) {
  const fs = json && Array.isArray(json.features) ? json.features : null;
  if (!fs) throw new Error(json && json.error ? `NWS catalog: ${json.error.message || 'error'}` : 'NWS catalog: no features');
  return fs.map((f) => ({ id: f.attributes.objectid, t: Math.round(f.attributes.idp_validtime / 1000) }))
    .filter((it) => Number.isInteger(it.id) && Number.isFinite(it.t));
}

// fetch(stamp, geos) for createRadar's `fallback`: { wld, png, rgbIndex }
// for the window around the wanted geometries, or a 404-like error when the
// service has no frame near the slot. get(url) resolves to a response
// stream (radar.js get()).
function createNwsSource({ get, now = () => Date.now() / 1000, log = console } = {}) {
  let catalog = null, catalogAt = -Infinity;
  const unknown = new Set(), logged = new Set();

  async function items() {
    if (catalog && now() - catalogAt < CATALOG_S) return catalog;
    const res = await get(catalogUrl());
    const chunks = [];
    for await (const c of res) chunks.push(c);
    catalog = parseCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    catalogAt = now();
    return catalog;
  }

  return {
    async fetch(t, geos) {
      const it = nearest(await items(), t);
      if (!it) {
        const e = new Error('no NWS frame near the slot');
        e.status = 404;
        throw e;
      }
      const win = windowOf(geos);
      const png = await get(exportUrl(it.id, win));
      return { wld: win.wld, png, rgbIndex: rgbIndex(unknown), src: 'nws', at: it.t };
    },
    // Colors past the measured ramp seen since the last call, logged once each.
    flushUnknown() {
      const fresh = [...unknown].filter((c) => !logged.has(c));
      unknown.clear();
      if (fresh.length) {
        for (const c of fresh) logged.add(c);
        log.warn(`[board] radar: NWS colors past the measured ramp: ${fresh.map((c) => '#' + c.toString(16).padStart(6, '0')).join(' ')}`);
      }
    },
  };
}

module.exports = { createNwsSource, dbzOfColor, rgbIndex, windowOf, nearest, parseCatalog, catalogUrl, exportUrl, RAMP, ANCHORS, GRID, NEAR_S, SERVICE };
