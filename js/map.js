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
 * Creates per-line radial gradient defs used by train glow circles.
 * Each gradient fades from the line color (center) to transparent (edge).
 */
function createTrainGlowGradients(defs) {
  for (const [legend, color] of Object.entries(LINE_COLORS)) {
    if (legend === 'ML') continue;
    const grad = defs.append('radialGradient')
      .attr('id', `train-glow-${legend}`);
    grad.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', color)
      .attr('stop-opacity', 1);
    grad.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', color)
      .attr('stop-opacity', 0);
  }
}

/**
 * Renders transit lines — one SVG <path> per line color.
 * Lines that use the Loop include ML segments in their own color.
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

    linesGroup.append('path')
      .attr('class', 'line-path')
      .attr('d', path({ type: 'FeatureCollection', features }))
      .attr('stroke', LINE_COLORS[legend])
      .attr('stroke-width', LINE_WIDTH)
      .attr('stroke-opacity', 0.9);
  }
}

async function loadMap(svg, width, height) {
  const geojson = await d3.json(GEOJSON_URL);

  const projection = d3.geoMercator().fitExtent(
    [
      [width * MAP_PADDING, height * MAP_PADDING],
      [width * (1 - MAP_PADDING), height * (1 - MAP_PADDING)]
    ],
    geojson
  );

  const path = d3.geoPath().projection(projection);

  createTrainGlowGradients(svg.append('defs'));

  const mapContainer = svg.append('g').attr('class', 'map-container');

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

  createTrainGlowGradients(svg.append('defs'));

  const mapContainer = svg.append('g').attr('class', 'map-container');

  const linesGroup = mapContainer.append('g').attr('class', 'lines-layer');
  renderLines(linesGroup, path, geojson);

  mapContainer.append('g').attr('class', 'trains-layer');

  return { projection, path };
}
