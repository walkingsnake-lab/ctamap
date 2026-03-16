#!/usr/bin/env node
/**
 * Generates static SVG path elements from CTA GeoJSON data.
 * Output is an SVG <g> snippet to paste into index.html for instant first-paint display.
 *
 * Usage: node scripts/generate-static-paths.js
 * Requires: npm install d3-geo (dev dependency)
 */

const fs = require('fs');
const path = require('path');
const d3Geo = require('d3-geo');

// Constants matching config.js / map.js
const LINE_COLORS = {
  RD: '#C60C30', BL: '#00A1DE', BR: '#895129', GR: '#009B3A',
  OR: '#F14624', PK: '#E27EA6', PR: '#7C3AED', YL: '#F9E300',
  ML: '#888888'
};
const LINE_WIDTH = 1.5;
const MAP_PADDING = 0.05;
const REF_W = 1920;
const REF_H = 1080;

const LINE_NAME_TO_LEGEND = {
  'Brown': 'BR', 'Green': 'GR', 'Orange': 'OR',
  'Pink': 'PK', 'Purple': 'PR'
};

const geojsonPath = path.join(__dirname, '..', 'data', 'cta-lines.geojson');
const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

const projection = d3Geo.geoMercator().fitExtent(
  [
    [REF_W * MAP_PADDING, REF_H * MAP_PADDING],
    [REF_W * (1 - MAP_PADDING), REF_H * (1 - MAP_PADDING)]
  ],
  geojson
);
const pathGen = d3Geo.geoPath().projection(projection);

// Build ML-by-legend map (same logic as renderLines in map.js)
const mlByLegend = {};
for (const f of geojson.features) {
  const leg = f.properties.legend;
  if (leg !== 'ML') continue;
  const linesProp = f.properties.lines || '';
  for (const [name, code] of Object.entries(LINE_NAME_TO_LEGEND)) {
    if (linesProp.includes(name)) {
      (mlByLegend[code] ??= []).push(f);
    }
  }
}

const lineOrder = ['GR', 'PK', 'OR', 'BR', 'PR', 'YL', 'BL', 'RD'];
const paths = [];

for (const legend of lineOrder) {
  let features = geojson.features.filter(f => f.properties.legend === legend);
  // Add shared ML segments (skip PR express — it's hidden by default)
  if (mlByLegend[legend] && legend !== 'PR') {
    features = features.concat(mlByLegend[legend]);
  }
  if (features.length === 0) continue;

  const d = pathGen({ type: 'FeatureCollection', features });
  if (!d) continue;

  paths.push(
    `      <path class="line-path" data-legend="${legend}" d="${d}" ` +
    `stroke="${LINE_COLORS[legend]}" stroke-width="${LINE_WIDTH}" ` +
    `stroke-opacity="0.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

const snippet = [
  `    <g class="lines-layer static-placeholder" opacity="0.65">`,
  ...paths,
  `    </g>`
].join('\n');

console.log(snippet);
