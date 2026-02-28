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

/**
 * Renders station markers (dots + labels) into a stations layer group.
 * Single-line stations use that line's color; transfer stations use white.
 *
 * Labels are rendered at a consistent -45° angle (like real transit maps)
 * with greedy collision avoidance: transfer stations are placed first, then
 * each remaining label tries four candidate positions and picks the one
 * with the least overlap against previously placed labels and station dots.
 */
function renderStations(stationsGroup, stations, projection) {
  stationsGroup.selectAll('*').remove();

  const ANGLE = -45;
  const FONT_SIZE = 2.5;
  const CHAR_W = FONT_SIZE * 0.52;
  const DOT_R = 1;
  const OFFSET = 2.0;            // gap from dot center to label anchor
  const LABEL_PAD = 0.6;         // padding between labels
  const R = Math.SQRT1_2;        // cos(45°) = sin(45°) ≈ 0.707

  // Rotate world coords by +45° to align with the -45° text baseline.
  // In this "text frame" every label's bounding box is axis-aligned.
  const toTF = (x, y) => [(x + y) * R, (-x + y) * R];

  // Candidate anchor offsets from dot center, ordered by preference.
  // Directions are relative to the text baseline (-45° = upper-right).
  const placements = [
    { dx:  OFFSET * R, dy: -OFFSET * R, anchor: 'start' }, // along text (upper-right)
    { dx: -OFFSET * R, dy:  OFFSET * R, anchor: 'end' },   // against text (lower-left)
    { dx:  OFFSET * R, dy:  OFFSET * R, anchor: 'start' }, // perp right (lower-right)
    { dx: -OFFSET * R, dy: -OFFSET * R, anchor: 'end' },   // perp left (upper-left)
  ];

  // Project all stations; sort so transfer stations get first pick.
  const items = stations
    .map(s => { const pt = projection([s.lon, s.lat]); return pt ? { ...s, px: pt[0], py: pt[1] } : null; })
    .filter(Boolean)
    .sort((a, b) => b.legends.length - a.legends.length);

  // Track placed labels (AABB in text frame) and dots for collision scoring.
  const placed = [];   // { rx, ry, rw, rh }
  const dots = items.map(s => toTF(s.px, s.py));

  const overlapScore = (rx, ry, rw, rh) => {
    let score = 0;
    // Label-label overlap
    for (const p of placed) {
      const ox = Math.max(0, Math.min(rx + rw + LABEL_PAD, p.rx + p.rw + LABEL_PAD) - Math.max(rx - LABEL_PAD, p.rx - LABEL_PAD));
      const oy = Math.max(0, Math.min(ry + rh + LABEL_PAD, p.ry + p.rh + LABEL_PAD) - Math.max(ry - LABEL_PAD, p.ry - LABEL_PAD));
      score += ox * oy;
    }
    // Label-dot overlap (check all dots in text frame)
    const expand = DOT_R * 1.2;
    for (const [dx, dy] of dots) {
      if (dx + expand > rx && dx - expand < rx + rw &&
          dy + expand > ry && dy - expand < ry + rh) {
        score += 20;
      }
    }
    return score;
  };

  const results = [];

  for (const station of items) {
    const textW = station.name.length * CHAR_W;
    let bestIdx = 0;
    let bestScore = Infinity;

    for (let p = 0; p < placements.length; p++) {
      const { dx, dy, anchor } = placements[p];
      const [trx, try_] = toTF(station.px + dx, station.py + dy);
      const rx = anchor === 'start' ? trx : trx - textW;
      const ry = try_ - FONT_SIZE / 2;
      const s = overlapScore(rx, ry, textW, FONT_SIZE);
      if (s < bestScore) { bestScore = s; bestIdx = p; }
      if (s === 0) break;
    }

    const { dx, dy, anchor } = placements[bestIdx];
    const [trx, try_] = toTF(station.px + dx, station.py + dy);
    placed.push({
      rx: anchor === 'start' ? trx : trx - textW,
      ry: try_ - FONT_SIZE / 2,
      rw: textW,
      rh: FONT_SIZE,
    });

    results.push({ station, dx, dy, anchor });
  }

  // Render SVG
  for (const { station, dx, dy, anchor } of results) {
    const isTransfer = station.legends.length !== 1;
    const color = isTransfer ? '#fff' : (LINE_COLORS[station.legends[0]] || '#fff');

    const g = stationsGroup.append('g')
      .attr('class', 'station-marker')
      .attr('transform', `translate(${station.px}, ${station.py})`);

    g.append('circle')
      .attr('class', 'station-dot')
      .attr('r', DOT_R)
      .attr('fill', color)
      .attr('stroke', isTransfer ? 'rgba(255,255,255,0.5)' : color)
      .attr('stroke-width', 0.3);

    g.append('text')
      .attr('class', 'station-label')
      .attr('transform', `translate(${dx},${dy}) rotate(${ANGLE})`)
      .attr('text-anchor', anchor)
      .attr('dominant-baseline', 'central')
      .text(station.name);
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

  // Stations layer sits between lines and trains (created hidden)
  mapContainer.append('g').attr('class', 'stations-layer').style('display', 'none');

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

  mapContainer.append('g').attr('class', 'stations-layer');
  mapContainer.append('g').attr('class', 'trains-layer');

  return { projection, path };
}
