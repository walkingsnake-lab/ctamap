#!/usr/bin/env node
'use strict';
// Builds server/board/locations/<mapid>.json for every station: the radar
// water mask, shoreline, and layout (design spec §7, contract "Radar").
//
// Water: an LED is water when its center falls inside Lake Michigan
// (scripts/geo-src/lake-michigan.geojson, Natural Earth 1:10m, public
// domain). Shoreline: land LEDs next to water (4-neighbors), drawn faintly
// where there's no rain. Layout: full width with the clock stack top-right
// when the area it draws on is all water; otherwise the split layout (radar left 40
// columns, clock panel right), with masks on the 40-column grid.
//
// Run: node scripts/build-locations.js   (no network; commit the output)

const fs = require('fs');
const path = require('path');
const { ledCenter, W, H, SPLIT_W, SPLIT_CLOCK, FULL_CLOCK } = require('../server/board/radar');

const OUT = path.join(__dirname, '..', 'server', 'board', 'locations');
const lake = JSON.parse(fs.readFileSync(path.join(__dirname, 'geo-src', 'lake-michigan.geojson'), 'utf8')).features[0].geometry;
const rings = lake.type === 'Polygon' ? [lake.coordinates] : lake.coordinates; // [[outer, ...holes]]

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const isWater = (lon, lat) => rings.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h)));

function masks(st, width) {
  const water = new Uint8Array(width * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < width; x++) water[y * width + x] = isWater(...ledCenter(st.lat, st.lon, x, y, width)) ? 1 : 0;
  const shore = new Uint8Array(width * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < width; x++) {
    if (water[y * width + x]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < H && water[yy * width + xx]) { shore[y * width + x] = 1; break; }
    }
  }
  return { water, shore };
}

// Rows as hex strings (MSB = leftmost LED), padded to whole nibbles.
function hex(bits, width) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    let s = '';
    for (let x = 0; x < width; x += 4) {
      let n = 0;
      for (let b = 0; b < 4; b++) n = (n << 1) | (x + b < width ? bits[y * width + x + b] : 0);
      s += n.toString(16);
    }
    rows.push(s);
  }
  return rows;
}

function build(st) {
  const full = masks(st, W);
  // The widest clock stack draws on cols 41-62, rows 2-19; that area must be
  // all water. The rest of the box is cleared either way.
  let boxWater = true;
  for (let y = 2; y <= 19 && boxWater; y++) for (let x = 41; x <= 62; x++) if (!full.water[y * W + x]) { boxWater = false; break; }
  if (boxWater) return { mapid: st.mapid, split: false, width: W, clock: FULL_CLOCK, water: hex(full.water, W), shore: hex(full.shore, W) };
  const split = masks(st, SPLIT_W);
  return { mapid: st.mapid, split: true, width: SPLIT_W, clock: SPLIT_CLOCK, water: hex(split.water, SPLIT_W), shore: hex(split.shore, SPLIT_W) };
}

if (require.main === module) {
  const stations = require('../server/board/stations.json');
  fs.mkdirSync(OUT, { recursive: true });
  let full = 0;
  for (const st of stations) {
    const loc = build(st);
    if (!loc.split) full++;
    fs.writeFileSync(path.join(OUT, `${st.mapid}.json`), JSON.stringify(loc) + '\n');
  }
  console.log(`wrote ${stations.length} locations: ${full} full-width over the lake, ${stations.length - full} split`);
}

module.exports = { build, isWater };
