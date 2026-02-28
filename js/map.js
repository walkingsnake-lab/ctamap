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
  // Build maps: legend code → shared features from ML and RD segments
  const mlByLegend = {};
  const rdSharedByLegend = {};
  for (const f of geojson.features) {
    const leg = f.properties.legend;
    if (leg !== 'ML' && leg !== 'RD') continue;
    const linesProp = f.properties.lines || '';
    for (const [name, code] of Object.entries(LINE_NAME_TO_LEGEND)) {
      if (code === leg) continue; // don't add a feature to its own legend
      if (linesProp.includes(name)) {
        if (leg === 'ML') (mlByLegend[code] ??= []).push(f);
        else (rdSharedByLegend[code] ??= []).push(f);
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

    // Render shadow paths for shared RD segments (behind the Red Line path)
    // Purple gets dashed (express/limited-stop service); Brown stays solid
    const rdShared = rdSharedByLegend[legend];
    if (rdShared) {
      const shadowPath = linesGroup.append('path')
        .attr('class', 'line-path')
        .attr('data-legend', legend)
        .attr('d', path({ type: 'FeatureCollection', features: rdShared }))
        .attr('stroke', LINE_COLORS[legend])
        .attr('stroke-width', LINE_WIDTH)
        .attr('stroke-opacity', 0.9);
      if (legend === 'PR') {
        shadowPath.attr('stroke-dasharray', `${LINE_WIDTH * 1.5} ${LINE_WIDTH * 1.5}`);
      }
    }

    if (features.length === 0) continue;

    linesGroup.append('path')
      .attr('class', 'line-path')
      .attr('data-legend', legend)
      .attr('d', path({ type: 'FeatureCollection', features }))
      .attr('stroke', LINE_COLORS[legend])
      .attr('stroke-width', LINE_WIDTH)
      .attr('stroke-opacity', 0.9);
  }
}

/**
 * Renders station markers (dots + labels) with horizontal text, leader lines,
 * and collision avoidance against other labels, station dots, and transit lines.
 *
 * Labels try 8 compass directions at multiple distances from the station dot
 * and pick the position with the least overlap.  A thin leader line connects
 * each dot to its label.  Transfer stations are placed first (higher priority).
 */
function renderStations(stationsGroup, stations, projection, geojson) {
  stationsGroup.selectAll('*').remove();

  const FONT_SIZE = 1.8;
  const CHAR_W = FONT_SIZE * 0.55;
  const DOT_R = 0.8;
  const LABEL_PAD = 0.4;

  // --- Project every GeoJSON line segment and index them in a spatial grid ---
  const segs = [];                          // flat: x1,y1,x2,y2, ...
  for (const feat of geojson.features) {
    const gc = feat.geometry.coordinates;
    const polylines = feat.geometry.type === 'MultiLineString' ? gc : [gc];
    for (const pl of polylines) {
      for (let i = 0; i < pl.length - 1; i++) {
        const a = projection(pl[i]), b = projection(pl[i + 1]);
        if (a && b) segs.push(a[0], a[1], b[0], b[1]);
      }
    }
  }

  const CELL = 15;
  const segGrid = new Map();
  for (let i = 0; i < segs.length; i += 4) {
    const xLo = Math.min(segs[i], segs[i + 2]), xHi = Math.max(segs[i], segs[i + 2]);
    const yLo = Math.min(segs[i + 1], segs[i + 3]), yHi = Math.max(segs[i + 1], segs[i + 3]);
    for (let cx = Math.floor(xLo / CELL); cx <= Math.floor(xHi / CELL); cx++) {
      for (let cy = Math.floor(yLo / CELL); cy <= Math.floor(yHi / CELL); cy++) {
        const k = cx * 10007 + cy;
        if (!segGrid.has(k)) segGrid.set(k, []);
        segGrid.get(k).push(i);
      }
    }
  }

  // Cohen-Sutherland segment ↔ rect intersection test
  function segClipsRect(si, xn, yn, xx, yx) {
    let x0 = segs[si], y0 = segs[si + 1], x1 = segs[si + 2], y1 = segs[si + 3];
    for (let t = 0; t < 8; t++) {
      let c0 = 0, c1 = 0;
      if (x0 < xn) c0 |= 1; else if (x0 > xx) c0 |= 2;
      if (y0 < yn) c0 |= 4; else if (y0 > yx) c0 |= 8;
      if (x1 < xn) c1 |= 1; else if (x1 > xx) c1 |= 2;
      if (y1 < yn) c1 |= 4; else if (y1 > yx) c1 |= 8;
      if (!(c0 | c1)) return true;
      if (c0 & c1) return false;
      const c = c0 || c1;
      let x, y;
      if (c & 8)      { x = x0 + (x1 - x0) * (yx - y0) / (y1 - y0); y = yx; }
      else if (c & 4) { x = x0 + (x1 - x0) * (yn - y0) / (y1 - y0); y = yn; }
      else if (c & 2) { y = y0 + (y1 - y0) * (xx - x0) / (x1 - x0); x = xx; }
      else             { y = y0 + (y1 - y0) * (xn - x0) / (x1 - x0); x = xn; }
      if (c === c0) { x0 = x; y0 = y; } else { x1 = x; y1 = y; }
    }
    return false;
  }

  function countLineHits(rx, ry, rw, rh) {
    const p = LINE_WIDTH * 0.6;
    const xn = rx - p, yn = ry - p, xx = rx + rw + p, yx = ry + rh + p;
    let hits = 0;
    const seen = new Set();
    for (let cx = Math.floor(xn / CELL); cx <= Math.floor(xx / CELL); cx++) {
      for (let cy = Math.floor(yn / CELL); cy <= Math.floor(yx / CELL); cy++) {
        const bucket = segGrid.get(cx * 10007 + cy);
        if (!bucket) continue;
        for (const si of bucket) {
          if (seen.has(si)) continue;
          seen.add(si);
          if (segClipsRect(si, xn, yn, xx, yx)) hits++;
        }
      }
    }
    return hits;
  }

  // --- Project stations; transfer stations placed first ---
  const items = stations
    .map(s => {
      const pt = projection([s.lon, s.lat]);
      return pt ? { ...s, px: pt[0], py: pt[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.legends.length - a.legends.length);

  // --- Candidate directions (8 compass points) × distances ---
  const R = Math.SQRT1_2;
  const dirs = [
    { ux:  1, uy:  0, anchor: 'start'  },   // E
    { ux: -1, uy:  0, anchor: 'end'    },   // W
    { ux:  R, uy: -R, anchor: 'start'  },   // NE
    { ux: -R, uy: -R, anchor: 'end'    },   // NW
    { ux:  R, uy:  R, anchor: 'start'  },   // SE
    { ux: -R, uy:  R, anchor: 'end'    },   // SW
    { ux:  0, uy: -1, anchor: 'middle' },   // N
    { ux:  0, uy:  1, anchor: 'middle' },   // S
  ];
  const dists = [8, 12, 16];

  // Label AABB from anchor point + text-anchor mode
  function labelRect(cx, cy, w, anchor) {
    const x = anchor === 'start' ? cx : anchor === 'end' ? cx - w : cx - w / 2;
    return { x, y: cy - FONT_SIZE / 2, w, h: FONT_SIZE };
  }

  const placed = [];   // { x, y, w, h }

  function scorePlacement(bb) {
    let score = 0;
    // Label ↔ label
    for (const p of placed) {
      const ox = Math.max(0, Math.min(bb.x + bb.w + LABEL_PAD, p.x + p.w + LABEL_PAD) - Math.max(bb.x - LABEL_PAD, p.x - LABEL_PAD));
      const oy = Math.max(0, Math.min(bb.y + bb.h + LABEL_PAD, p.y + p.h + LABEL_PAD) - Math.max(bb.y - LABEL_PAD, p.y - LABEL_PAD));
      if (ox > 0 && oy > 0) score += ox * oy * 10;
    }
    // Label ↔ station dots
    for (const s of items) {
      const cx = Math.max(bb.x, Math.min(s.px, bb.x + bb.w));
      const cy = Math.max(bb.y, Math.min(s.py, bb.y + bb.h));
      if ((s.px - cx) ** 2 + (s.py - cy) ** 2 < (DOT_R * 1.5) ** 2) score += 15;
    }
    // Label ↔ transit lines
    score += countLineHits(bb.x, bb.y, bb.w, bb.h) * 5;
    return score;
  }

  const results = [];

  for (const station of items) {
    const tw = station.name.length * CHAR_W;
    let best = null, bestScore = Infinity;

    search:
    for (const d of dists) {
      for (const dir of dirs) {
        const dx = dir.ux * d, dy = dir.uy * d;
        const bb = labelRect(station.px + dx, station.py + dy, tw, dir.anchor);
        const s = scorePlacement(bb) + d * 0.3;   // prefer closer
        if (s < bestScore) { bestScore = s; best = { dx, dy, anchor: dir.anchor, bb }; }
        if (bestScore <= dists[0] * 0.3) break search;
      }
    }

    placed.push(best.bb);
    results.push({ station, dx: best.dx, dy: best.dy, anchor: best.anchor });
  }

  // --- Render SVG ---
  for (const { station, dx, dy, anchor } of results) {
    const g = stationsGroup.append('g')
      .attr('class', 'station-marker')
      .attr('data-legends', station.legends.join(','))
      .attr('transform', `translate(${station.px},${station.py})`);

    // Leader line (dot edge → near label anchor)
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > DOT_R + 0.5) {
      const nx = dx / len, ny = dy / len;
      g.append('line')
        .attr('class', 'station-leader')
        .attr('x1', nx * DOT_R).attr('y1', ny * DOT_R)
        .attr('x2', dx - nx * 0.3).attr('y2', dy - ny * 0.3);
    }

    g.append('circle')
      .attr('class', 'station-dot')
      .attr('r', DOT_R)
      .attr('fill', '#fff');

    g.append('text')
      .attr('class', 'station-label')
      .attr('x', dx).attr('y', dy)
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
