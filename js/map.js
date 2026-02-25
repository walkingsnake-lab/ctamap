/**
 * Fetches CTA GeoJSON data, projects it, and renders the transit lines as SVG paths.
 * Returns { projection, geojson } for use by other modules.
 */

// Map human-readable line names (from GeoJSON "lines" property) → legend codes
const LINE_NAME_TO_LEGEND = {
  'Brown': 'BR', 'Green': 'GR', 'Orange': 'OR',
  'Pink': 'PK', 'Purple': 'PR'
};

// Consistent ordering of lines that share ML (Loop) segments, used to assign stable offsets
const ML_LINE_ORDER = ['GR', 'PK', 'OR', 'BR', 'PR'];

/**
 * Returns the ordered subset of ML_LINE_ORDER that share the given ML feature.
 */
function getLinesForMLFeature(feature) {
  const linesProp = feature.properties.lines || '';
  const found = [];
  for (const [name, code] of Object.entries(LINE_NAME_TO_LEGEND)) {
    if (linesProp.includes(name)) found.push(code);
  }
  return ML_LINE_ORDER.filter(c => found.includes(c));
}

/**
 * Builds an SVG path string for a GeoJSON feature with a perpendicular pixel offset.
 * Projects each coordinate to screen space and displaces points along the left-normal.
 * @param {object} feature - GeoJSON Feature (LineString or MultiLineString)
 * @param {number} offsetPx - offset in SVG pixels; positive = left of travel direction
 * @param {function} projection - D3 projection function [lon,lat] → [x,y]
 */
function buildOffsetPath(feature, offsetPx, projection) {
  const geom = feature.geometry;
  const lineStrings = geom.type === 'LineString'
    ? [geom.coordinates]
    : geom.coordinates;

  const parts = [];
  for (const coords of lineStrings) {
    const pts = coords.map(c => projection(c)).filter(Boolean);
    if (pts.length < 2) continue;

    const off = pts.map((pt, i) => {
      let nx = 0, ny = 0;
      // Accumulate left-normals from adjacent segments
      if (i > 0) {
        const p = pts[i - 1];
        const d = Math.hypot(pt[0] - p[0], pt[1] - p[1]);
        if (d > 0) { nx += -(pt[1] - p[1]) / d; ny += (pt[0] - p[0]) / d; }
      }
      if (i < pts.length - 1) {
        const n = pts[i + 1];
        const d = Math.hypot(n[0] - pt[0], n[1] - pt[1]);
        if (d > 0) { nx += -(n[1] - pt[1]) / d; ny += (n[0] - pt[0]) / d; }
      }
      const len = Math.hypot(nx, ny);
      if (len > 0) { nx /= len; ny /= len; }
      return [pt[0] + nx * offsetPx, pt[1] + ny * offsetPx];
    });

    parts.push('M' + off.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L'));
  }
  return parts.join(' ');
}

/**
 * Creates the SVG glow filter in the given defs element.
 */
function createGlowFilter(defs) {
  const glowFilter = defs.append('filter')
    .attr('id', 'line-glow')
    .attr('x', '-50%').attr('y', '-50%')
    .attr('width', '200%').attr('height', '200%');

  glowFilter.append('feGaussianBlur')
    .attr('in', 'SourceGraphic')
    .attr('stdDeviation', '1.5')
    .attr('result', 'blur');

  glowFilter.append('feMerge')
    .selectAll('feMergeNode')
    .data(['blur', 'SourceGraphic'])
    .enter().append('feMergeNode')
    .attr('in', d => d);
}

/**
 * Renders transit lines:
 * - Each line's own segments are drawn as a single path at their true coordinates.
 * - Shared Loop (ML) segments are drawn with a perpendicular offset per line so that
 *   multiple lines running on the same track appear side-by-side rather than stacked.
 */
function renderLines(linesGroup, path, projection, geojson) {
  // Pre-compute which legend codes each ML feature serves (in stable ML_LINE_ORDER)
  const mlFeatureMap = new Map();
  for (const f of geojson.features) {
    if (f.properties.legend !== 'ML') continue;
    const legends = getLinesForMLFeature(f);
    if (legends.length > 0) mlFeatureMap.set(f, legends);
  }

  const lineOrder = ['GR', 'PK', 'OR', 'BR', 'PR', 'YL', 'BL', 'RD'];
  for (const legend of lineOrder) {
    // Render this line's own (non-ML) segments as a single combined path
    const ownFeatures = geojson.features.filter(f => f.properties.legend === legend);
    if (ownFeatures.length > 0) {
      linesGroup.append('path')
        .attr('class', 'line-path')
        .attr('d', path({ type: 'FeatureCollection', features: ownFeatures }))
        .attr('stroke', LINE_COLORS[legend])
        .attr('stroke-width', LINE_WIDTH)
        .attr('stroke-opacity', 0.9);
    }

    // Render each ML segment with a perpendicular offset for this line
    for (const [f, legends] of mlFeatureMap) {
      const idx = legends.indexOf(legend);
      if (idx === -1) continue;
      const offsetPx = (idx - (legends.length - 1) / 2) * ML_OFFSET_SPACING;
      linesGroup.append('path')
        .attr('class', 'line-path')
        .attr('d', buildOffsetPath(f, offsetPx, projection))
        .attr('stroke', LINE_COLORS[legend])
        .attr('stroke-width', LINE_WIDTH)
        .attr('stroke-opacity', 0.9);
    }
  }
}

async function loadMap(svg, width, height) {
  const geojson = await d3.json(GEOJSON_URL);

  // Fit a Mercator projection to the GeoJSON bounding box with padding
  const projection = d3.geoMercator().fitExtent(
    [
      [width * MAP_PADDING, height * MAP_PADDING],
      [width * (1 - MAP_PADDING), height * (1 - MAP_PADDING)]
    ],
    geojson
  );

  const path = d3.geoPath().projection(projection);

  // SVG filter definition (used by train glows)
  createGlowFilter(svg.append('defs'));

  // Container for all layers (zoom transform is applied here)
  const mapContainer = svg.append('g').attr('class', 'map-container');

  // Layer group for lines
  const linesGroup = mapContainer.append('g').attr('class', 'lines-layer');
  renderLines(linesGroup, path, projection, geojson);

  return { projection, geojson, path, mapContainer };
}

/**
 * Re-renders the map into an existing SVG at the given dimensions.
 * Clears previous content and redraws everything.
 */
function redrawMap(svg, width, height, geojson) {
  svg.selectAll('*').remove();

  const projection = d3.geoMercator().fitExtent(
    [
      [width * MAP_PADDING, height * MAP_PADDING],
      [width * (1 - MAP_PADDING), height * (1 - MAP_PADDING)]
    ],
    geojson
  );

  const path = d3.geoPath().projection(projection);

  createGlowFilter(svg.append('defs'));

  const mapContainer = svg.append('g').attr('class', 'map-container');

  const linesGroup = mapContainer.append('g').attr('class', 'lines-layer');
  renderLines(linesGroup, path, projection, geojson);

  // Train layer on top
  mapContainer.append('g').attr('class', 'trains-layer');

  return { projection, path };
}
