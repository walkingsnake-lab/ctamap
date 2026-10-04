#!/usr/bin/env node
'use strict';
// Builds server/board/stations.json from the City of Chicago
// "CTA System Information - List of 'L' Stops" dataset (8pix-ypme), the list
// the Train Tracker API docs point to.
//
//   node scripts/build-stations.js              # downloads the dataset
//   node scripts/build-stations.js stops.json   # or uses a saved JSON export
//
// The dataset has one record per platform; this groups them by map_id.
// Each station gets a header short name: the curated one from
// server/board/station-names.js, or the uppercase name if it fits. The build
// fails, listing the stations, if any name overflows without a curated entry.

const fs = require('fs');
const path = require('path');
const { measure } = require('../server/board/fonts');
const { HEADER_NAME_PX, SHORT_NAMES } = require('../server/board/station-names');

const URL = 'https://data.cityofchicago.org/resource/8pix-ypme.json?$limit=5000';
const OUT = path.join(__dirname, '..', 'server', 'board', 'stations.json');

// Dataset line flag -> board line code.
const LINE_FLAGS = { red: 'RD', blue: 'BL', brn: 'BR', g: 'GR', o: 'OR', p: 'PR', pnk: 'PK', y: 'YL' };

const truthy = (v) => v === true || v === 'true' || v === '1' || v === 1;

function coords(rec) {
  const loc = rec.location || {};
  if (Array.isArray(loc.coordinates)) return { lat: loc.coordinates[1], lon: loc.coordinates[0] };
  if (loc.latitude && loc.longitude) return { lat: Number(loc.latitude), lon: Number(loc.longitude) };
  throw new Error(`no coordinates for stop ${rec.stop_id}`);
}

async function load() {
  const file = process.argv[2];
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`dataset download failed: HTTP ${res.status}`);
  return res.json();
}

function build(records) {
  const byMap = new Map();
  for (const rec of records) {
    const mapid = String(rec.map_id);
    if (!byMap.has(mapid)) {
      byMap.set(mapid, { mapid, name: rec.station_name, desc: rec.station_descriptive_name, lines: new Set(), pts: [] });
    }
    const st = byMap.get(mapid);
    for (const [flag, code] of Object.entries(LINE_FLAGS)) if (truthy(rec[flag])) st.lines.add(code);
    st.pts.push(coords(rec));
  }

  const overflow = [];
  const stations = [...byMap.values()].map((st) => {
    const lat = st.pts.reduce((a, p) => a + p.lat, 0) / st.pts.length;
    const lon = st.pts.reduce((a, p) => a + p.lon, 0) / st.pts.length;
    const short = SHORT_NAMES[st.name] || st.name.toUpperCase();
    if (measure('small', short) > HEADER_NAME_PX) overflow.push(`${st.name} (${measure('small', short)}px)`);
    return {
      mapid: st.mapid,
      name: st.name,
      desc: st.desc,
      short,
      lines: [...st.lines].sort(),
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.mapid.localeCompare(b.mapid));

  if (overflow.length) {
    throw new Error(`header names over ${HEADER_NAME_PX}px; add them to server/board/station-names.js:\n  ${overflow.join('\n  ')}`);
  }
  const unused = Object.keys(SHORT_NAMES).filter((n) => !byMap.size || ![...byMap.values()].some((s) => s.name === n));
  if (unused.length) console.warn(`curated names not in the dataset (check spelling): ${unused.join(', ')}`);
  return stations;
}

load()
  .then((records) => {
    const stations = build(records);
    // One station per line keeps diffs readable.
    fs.writeFileSync(OUT, '[\n' + stations.map((st) => JSON.stringify(st)).join(',\n') + '\n]\n');
    console.log(`wrote ${stations.length} stations to ${path.relative(process.cwd(), OUT)}`);
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
