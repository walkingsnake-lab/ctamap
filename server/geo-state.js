/**
 * Singleton that loads GeoJSON once at server startup and exposes pre-built
 * geometry structures (lineSegments, neighborMaps, stations, terminals).
 * All server modules require() this; the heavy computations run once.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const {
  buildLineSegments,
  buildSegmentNeighborMap,
  buildUniqueStations,
  buildLineTerminals,
} = require('./track-engine');

let geojson         = null;
let lineSegments    = null;
let lineOwnSegments = null;
let lineNeighborMaps = null;
let stations        = null;
let lineTerminals   = null;
let ready           = false;

function init() {
  const filePath = path.join(__dirname, '..', 'data', 'cta-lines.geojson');
  const raw = fs.readFileSync(filePath, 'utf8');
  geojson = JSON.parse(raw);

  const result = buildLineSegments(geojson);
  lineSegments    = result.segments;
  lineOwnSegments = result.ownSegments;

  lineNeighborMaps = {};
  for (const [legend, segs] of Object.entries(lineSegments)) {
    lineNeighborMaps[legend] = buildSegmentNeighborMap(segs);
  }

  stations     = buildUniqueStations(geojson);
  lineTerminals = buildLineTerminals(lineOwnSegments, lineSegments);

  ready = true;
  console.log(`[geo-state] Loaded: ${geojson.features.length} features, ${stations.length} stations`);
}

module.exports = {
  init,
  isReady: () => ready,
  get geojson()          { return geojson; },
  get lineSegments()     { return lineSegments; },
  get lineOwnSegments()  { return lineOwnSegments; },
  get lineNeighborMaps() { return lineNeighborMaps; },
  get stations()         { return stations; },
  get lineTerminals()    { return lineTerminals; },
};
