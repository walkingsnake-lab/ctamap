/**
 * Fetches CTA GeoJSON data, projects it, and renders the transit lines as SVG paths.
 * Returns { projection, geojson } for use by other modules.
 */

// Lines that traverse the Loop and should include ML (shared) segments
const LOOP_LINES = new Set(['BR', 'OR', 'PK', 'PR', 'GR']);

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
 * Renders consolidated transit lines — one SVG <path> per line color.
 * Lines that use the Loop include ML segments in their own color.
 */
function renderLines(linesGroup, path, geojson) {
  const mlFeatures = geojson.features.filter(f => f.properties.legend === 'ML');

  const lineOrder = ['GR', 'PK', 'OR', 'BR', 'PR', 'YL', 'BL', 'RD'];
  for (const legend of lineOrder) {
    let features = geojson.features.filter(f => f.properties.legend === legend);

    // For lines that traverse the Loop, include the shared ML segments
    if (LOOP_LINES.has(legend)) {
      features = features.concat(mlFeatures);
    }

    if (features.length === 0) continue;

    // Combine all segments into a single path element
    const collection = { type: 'FeatureCollection', features };

    linesGroup.append('path')
      .attr('class', 'line-path')
      .attr('d', path(collection))
      .attr('stroke', LINE_COLORS[legend])
      .attr('stroke-width', LINE_WIDTH)
      .attr('stroke-opacity', 0.9)
      .attr('filter', 'url(#line-glow)');
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

  // SVG filter for subtle glow effect
  createGlowFilter(svg.append('defs'));

  // Layer group for lines
  const linesGroup = svg.append('g').attr('class', 'lines-layer');
  renderLines(linesGroup, path, geojson);

  return { projection, geojson, path };
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

  const linesGroup = svg.append('g').attr('class', 'lines-layer');
  renderLines(linesGroup, path, geojson);

  // Train layer on top
  svg.append('g').attr('class', 'trains-layer');

  return { projection, path };
}
