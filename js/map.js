/**
 * Fetches CTA GeoJSON data, projects it, and renders the transit lines as SVG paths.
 * Returns { projection, geojson } for use by other modules.
 */
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
  const defs = svg.append('defs');

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

  // Draw order: ML (shared) segments first, then individual lines on top
  const mlFeatures = geojson.features.filter(f => f.properties.legend === 'ML');
  const lineFeatures = geojson.features.filter(f => f.properties.legend !== 'ML');

  // Layer group for lines
  const linesGroup = svg.append('g').attr('class', 'lines-layer');

  // Render ML (Loop / shared) segments
  linesGroup.selectAll('.line-path-ml')
    .data(mlFeatures)
    .enter().append('path')
    .attr('class', 'line-path')
    .attr('d', path)
    .attr('stroke', LINE_COLORS.ML)
    .attr('stroke-width', ML_LINE_WIDTH)
    .attr('stroke-opacity', 0.6)
    .attr('filter', 'url(#line-glow)');

  // Render individual line segments, grouped by legend for consistent layering
  const lineOrder = ['GR', 'PK', 'OR', 'BR', 'PR', 'YL', 'BL', 'RD'];
  for (const legend of lineOrder) {
    const features = lineFeatures.filter(f => f.properties.legend === legend);
    linesGroup.selectAll(`.line-path-${legend}`)
      .data(features)
      .enter().append('path')
      .attr('class', 'line-path')
      .attr('d', path)
      .attr('stroke', LINE_COLORS[legend])
      .attr('stroke-width', LINE_WIDTH)
      .attr('stroke-opacity', 0.9)
      .attr('filter', 'url(#line-glow)');
  }

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

  const defs = svg.append('defs');
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

  const mlFeatures = geojson.features.filter(f => f.properties.legend === 'ML');
  const lineFeatures = geojson.features.filter(f => f.properties.legend !== 'ML');

  const linesGroup = svg.append('g').attr('class', 'lines-layer');

  linesGroup.selectAll('.line-path-ml')
    .data(mlFeatures)
    .enter().append('path')
    .attr('class', 'line-path')
    .attr('d', path)
    .attr('stroke', LINE_COLORS.ML)
    .attr('stroke-width', ML_LINE_WIDTH)
    .attr('stroke-opacity', 0.6)
    .attr('filter', 'url(#line-glow)');

  const lineOrder = ['GR', 'PK', 'OR', 'BR', 'PR', 'YL', 'BL', 'RD'];
  for (const legend of lineOrder) {
    const features = lineFeatures.filter(f => f.properties.legend === legend);
    linesGroup.selectAll(`.line-path-${legend}`)
      .data(features)
      .enter().append('path')
      .attr('class', 'line-path')
      .attr('d', path)
      .attr('stroke', LINE_COLORS[legend])
      .attr('stroke-width', LINE_WIDTH)
      .attr('stroke-opacity', 0.9)
      .attr('filter', 'url(#line-glow)');
  }

  // Train layer on top
  svg.append('g').attr('class', 'trains-layer');

  return { projection, path };
}
