/**
 * Fetches CTA GeoJSON data, projects it, and renders the transit lines as SVG paths.
 * Returns { projection, geojson } for use by other modules.
 */

// Map human-readable line names (from GeoJSON "lines" property) → legend codes
const LINE_NAME_TO_LEGEND = {
  'Brown': 'BR', 'Green': 'GR', 'Orange': 'OR',
  'Pink': 'PK', 'Purple': 'PR'
};

/**
 * Creates the SVG glow filter in the given defs element (used by train dots).
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
 * Renders transit lines as stacked colored paths with a white casing (outline) on each.
 *
 * Per line, two paths are appended back-to-back:
 *   1. Casing — slightly wider white stroke that peeks out beyond the color layer,
 *      creating a hairline border that separates lines when they overlap (e.g. the Loop).
 *   2. Color — the normal colored stroke on top.
 *
 * Lines that use the Loop have their ML (shared) segments included in their combined
 * path so each line's color is drawn through the Loop in render order.
 */
function renderLines(linesGroup, path, geojson) {
  // Build a map: legend code → ML features that belong to that line
  const mlByLegend = {};
  for (const f of geojson.features) {
    if (f.properties.legend !== 'ML') continue;
    const linesProp = f.properties.lines || '';
    for (const [name, code] of Object.entries(LINE_NAME_TO_LEGEND)) {
      if (linesProp.includes(name)) {
        (mlByLegend[code] ??= []).push(f);
      }
    }
  }

  const lineOrder = ['GR', 'PK', 'OR', 'BR', 'PR', 'YL', 'BL', 'RD'];
  for (const legend of lineOrder) {
    let features = geojson.features.filter(f => f.properties.legend === legend);

    // Include only the ML segments that actually serve this line
    if (mlByLegend[legend]) {
      features = features.concat(mlByLegend[legend]);
    }

    if (features.length === 0) continue;

    const d = path({ type: 'FeatureCollection', features });

    // Casing: wider white stroke that frames the colored line on top
    linesGroup.append('path')
      .attr('class', 'line-casing')
      .attr('d', d)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', LINE_WIDTH + 1.5)
      .attr('stroke-opacity', 0.35);

    // Color stroke on top
    linesGroup.append('path')
      .attr('class', 'line-path')
      .attr('d', d)
      .attr('stroke', LINE_COLORS[legend])
      .attr('stroke-width', LINE_WIDTH)
      .attr('stroke-opacity', 0.95);
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

  // SVG filter definition (used by train dot glows)
  createGlowFilter(svg.append('defs'));

  // Container for all layers (zoom transform is applied here)
  const mapContainer = svg.append('g').attr('class', 'map-container');

  // Layer group for lines
  const linesGroup = mapContainer.append('g').attr('class', 'lines-layer');
  renderLines(linesGroup, path, geojson);

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
  renderLines(linesGroup, path, geojson);

  // Train layer on top
  mapContainer.append('g').attr('class', 'trains-layer');

  return { projection, path };
}
