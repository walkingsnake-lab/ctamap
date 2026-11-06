#!/usr/bin/env node
'use strict';
// Builds server/board/station-dirs.json: which way each line's track runs at
// each station, for the wide board's northbound | southbound split
// (docs/board/wide-spec.md §3). The split shows only where it's true: every
// line at the station runs north-south there and none is on the Loop.
//
//   node scripts/build-station-dirs.js
//
// From the map's track geometry (data/cta-lines.geojson) and
// server/board/stations.json: for each line serving a station, the track's
// heading over CHORD_M either side of the point nearest the station.
//   "ns": within NS_DEG of north-south;  "ew": anything else;
//   "loop": the nearest track is the Loop's elevated circuit.
// Red and Purple count as north-south everywhere off the Loop: riders call
// them northbound and southbound even where the track runs diagonally
// (Jarvis to Howard, Clark/Division, North/Clybourn).
// Rebuild after changing stations.json; station-dirs.test.js fails when
// the file is out of date.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GEO = path.join(ROOT, 'data', 'cta-lines.geojson');
const STATIONS = path.join(ROOT, 'server', 'board', 'stations.json');
const OUT = path.join(ROOT, 'server', 'board', 'station-dirs.json');

const NS_DEG = 35;
const CHORD_M = 600;  // about a station either way, so a curve at the platform doesn't decide
const ALWAYS_NS = new Set(['RD', 'PR']);
const NAMES = { RD: 'Red', BL: 'Blue', BR: 'Brown', GR: 'Green', OR: 'Orange', PR: 'Purple', PK: 'Pink', YL: 'Yellow' };

// Local flat projection around Chicago: meters east and north.
const LAT0 = 41.88;
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MY = 110540;
const xy = ([lon, lat]) => [lon * MX, lat * MY];

function polylines(geo, ln) {
  const name = NAMES[ln];
  const out = [];
  for (const f of geo.features) {
    if (!new RegExp(`\\b${name}\\b`).test(f.properties.lines)) continue;
    const g = f.geometry;
    const parts = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
    for (const p of parts) out.push({ legend: f.properties.legend, lines: f.properties.lines, pts: p.map(xy) });
  }
  return out;
}

// Nearest point on any polyline: { line, i (segment), u (0-1 along it), d (m) }.
function nearest(lines, p) {
  let best = null;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.pts.length; i++) {
      const [a, b] = [line.pts[i], line.pts[i + 1]];
      const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
      const u = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
      const d = Math.hypot(a[0] + u * dx - p[0], a[1] + u * dy - p[1]);
      if (!best || d < best.d) best = { line, i, u, d };
    }
  }
  return best;
}

// Walking the track: the map splits it into short pieces ("Jarvis to
// Morse"), so a walk carries on into the piece whose end meets this one's
// (within JOIN_M), taking the straightest at a junction, and stops at a
// terminal (no piece to carry on into).
const JOIN_M = 25;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// m meters along the track from the nearest point n ({line, i, u}); m < 0
// walks the other way. Returns the point reached.
function along(n, m, lines) {
  let pts = n.line.pts;
  // Walk forward along pts from segment i at fraction u; when going
  // backward, the polyline is reversed first so it's always forward.
  let i = n.i, u = n.u;
  if (m < 0) { pts = [...pts].reverse(); i = pts.length - 2 - n.i; u = 1 - n.u; }
  let left = Math.abs(m), cur = n.line, guard = 0;
  for (;;) {
    for (let k = i; k < pts.length - 1; k++) {
      const L = dist(pts[k], pts[k + 1]);
      const from = k === i ? u * L : 0;
      if (L - from >= left) {
        const v = L ? (from + left) / L : 0;
        return [pts[k][0] + v * (pts[k + 1][0] - pts[k][0]), pts[k][1] + v * (pts[k + 1][1] - pts[k][1])];
      }
      left -= L - from;
    }
    // At the piece's end: carry on into the straightest piece that meets it.
    const end = pts[pts.length - 1], dir = [end[0] - pts[pts.length - 2][0], end[1] - pts[pts.length - 2][1]];
    let next = null, best = -Infinity;
    for (const l of lines) {
      if (l === cur) continue;
      for (const flip of [false, true]) {
        const q = flip ? [...l.pts].reverse() : l.pts;
        if (q.length < 2 || dist(q[0], end) > JOIN_M) continue;
        const d2 = [q[1][0] - q[0][0], q[1][1] - q[0][1]];
        const cos = (dir[0] * d2[0] + dir[1] * d2[1]) / (Math.hypot(...dir) * Math.hypot(...d2) || 1);
        if (cos > best) { best = cos; next = { l, q }; }
      }
    }
    if (!next || best < 0 || ++guard > 50) return end;
    cur = next.l; pts = next.q; i = 0; u = 0;
  }
}

function build() {
  const geo = JSON.parse(fs.readFileSync(GEO, 'utf8'));
  const stations = JSON.parse(fs.readFileSync(STATIONS, 'utf8'));
  const byLine = Object.fromEntries(Object.keys(NAMES).map((ln) => [ln, polylines(geo, ln)]));
  const out = {};
  for (const st of [...stations].sort((a, b) => a.mapid.localeCompare(b.mapid))) {
    const p = xy([st.lon, st.lat]);
    const dirs = {};
    for (const ln of st.lines) {
      const n = nearest(byLine[ln], p);
      if (!n || n.d > 400) throw new Error(`${st.name}: no ${NAMES[ln]} track within 400 m`);
      // The Loop's elevated circuit (every Loop segment carries Brown).
      if (n.line.legend === 'ML' && /\bBrown\b/.test(n.line.lines)) { dirs[ln] = 'loop'; continue; }
      const L = byLine[ln];
      let a = along(n, -CHORD_M, L), b = along(n, CHORD_M, L);
      // A terminal (the track ends here): twice as far the only way it goes.
      if (dist(a, p) < CHORD_M / 4) { a = p; b = along(n, 2 * CHORD_M, L); }
      else if (dist(b, p) < CHORD_M / 4) { b = p; a = along(n, -2 * CHORD_M, L); }
      const deg = (Math.atan2(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 180) / Math.PI;
      dirs[ln] = deg <= NS_DEG || ALWAYS_NS.has(ln) ? 'ns' : 'ew';
    }
    out[st.mapid] = dirs;
  }
  return out;
}

// One station a line.
const text = () => '{\n' + Object.entries(build()).map(([m, d]) => `  ${JSON.stringify(m)}: ${JSON.stringify(d)}`).join(',\n') + '\n}\n';

module.exports = { build, text, OUT };

if (require.main === module) {
  fs.writeFileSync(OUT, text());
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
