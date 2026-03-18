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
function renderLines(linesGroup, path, geojson, lineWidth = LINE_WIDTH) {
  // Build maps: legend code → shared features from ML, RD, and BR segments
  const mlByLegend = {};
  const rdSharedByLegend = {};
  const brSharedByLegend = {};
  for (const f of geojson.features) {
    const leg = f.properties.legend;
    if (leg !== 'ML' && leg !== 'RD' && leg !== 'BR') continue;
    const linesProp = f.properties.lines || '';
    for (const [name, code] of Object.entries(LINE_NAME_TO_LEGEND)) {
      if (code === leg) continue; // don't add a feature to its own legend
      if (linesProp.includes(name)) {
        if (leg === 'ML') (mlByLegend[code] ??= []).push(f);
        else if (leg === 'RD') (rdSharedByLegend[code] ??= []).push(f);
        else (brSharedByLegend[code] ??= []).push(f);
      }
    }
  }

  const lineOrder = ['GR', 'PK', 'OR', 'BR', 'PR', 'YL','BL','RD'];
  for (const legend of lineOrder) {
    let features = geojson.features.filter(f => f.properties.legend === legend);

    // PR express service (shared BR + ML/Loop) is rendered as a separate dashed
    // path hidden by default; exclude those ML segments from the solid main path.
    if (mlByLegend[legend] && legend !== 'PR') {
      features = features.concat(mlByLegend[legend]);
    }

    // Render shadow paths for shared RD segments (behind the Red Line path)
    const rdShared = rdSharedByLegend[legend];
    if (rdShared) {
      const shadowPath = linesGroup.append('path')
        .attr('class', 'line-path')
        .attr('data-legend', legend)
        .attr('d', path({ type: 'FeatureCollection', features: rdShared }))
        .attr('stroke', LINE_COLORS[legend])
        .attr('stroke-width', lineWidth)
        .attr('stroke-opacity', 0.9);
      if (legend === 'PR') {
        shadowPath
          .classed('pr-express-path', true)
          .attr('stroke-dasharray', `${lineWidth * 3} ${lineWidth * 2}`);
      }
    }

    // PR express path: shared BR track (subway portal → Tower 18) + Loop (ML)
    // Rendered dashed and hidden by default; shown only when Purple is focused.
    if (legend === 'PR') {
      const expressFeatures = [
        ...(brSharedByLegend['PR'] || []),
        ...(mlByLegend['PR'] || []),
      ];
      if (expressFeatures.length > 0) {
        linesGroup.append('path')
          .attr('class', 'line-path pr-express-path')
          .attr('data-legend', 'PR')
          .attr('d', path({ type: 'FeatureCollection', features: expressFeatures }))
          .attr('stroke', LINE_COLORS['PR'])
          .attr('stroke-width', lineWidth)
          .attr('stroke-opacity', 0.9)
          .attr('stroke-dasharray', `${lineWidth * 3} ${lineWidth * 2}`);
      }
    }

    if (features.length === 0) continue;

    linesGroup.append('path')
      .attr('class', 'line-path')
      .attr('data-legend', legend)
      .attr('d', path({ type: 'FeatureCollection', features }))
      .attr('stroke', LINE_COLORS[legend])
      .attr('stroke-width', lineWidth)
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
function renderStations(stationsGroup, stations, projection, geojson, lineWidth = LINE_WIDTH) {
  stationsGroup.selectAll('*').remove();

  const vf = lineWidth / LINE_WIDTH;        // visual scale factor relative to reference
  const FONT_SIZE = 1.1 * vf;              // single size for both collision and rendering
  const CHAR_W = FONT_SIZE * 0.6;          // char width estimate for Jersey 25
  const DOT_R = lineWidth / 2 * 1.2;
  const LABEL_PAD = 0.4 * vf;

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
    const p = lineWidth * 0.6;
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

  // --- Project stations; multi-line stations placed first ---
  const items = stations
    .map(s => {
      const pt = projection([s.lon, s.lat]);
      return pt ? { ...s, px: pt[0], py: pt[1] } : null;
    })
    .filter(Boolean);

  // --- Merge stations with identical names at nearby coordinates ---
  // (e.g. Jackson Red + Jackson Blue are separate subway stops one block apart)
  const MERGE_THRESHOLD = 8 * vf;
  const nameGroups = new Map();
  for (const item of items) {
    if (!nameGroups.has(item.name)) nameGroups.set(item.name, []);
    nameGroups.get(item.name).push(item);
  }
  const merged = [];
  for (const [name, group] of nameGroups) {
    if (group.length === 1) {
      merged.push({ ...group[0], dots: [{ px: group[0].px, py: group[0].py }] });
    } else {
      let canMerge = true;
      for (let i = 0; i < group.length && canMerge; i++)
        for (let j = i + 1; j < group.length && canMerge; j++)
          if (Math.hypot(group[i].px - group[j].px, group[i].py - group[j].py) > MERGE_THRESHOLD)
            canMerge = false;
      if (canMerge) {
        const midPx = group.reduce((s, g) => s + g.px, 0) / group.length;
        const midPy = group.reduce((s, g) => s + g.py, 0) / group.length;
        merged.push({
          name,
          px: midPx, py: midPy,
          legends: [...new Set(group.flatMap(g => g.legends))],
          dots: group.map(g => ({ px: g.px, py: g.py })),
        });
      } else {
        for (const item of group)
          merged.push({ ...item, dots: [{ px: item.px, py: item.py }] });
      }
    }
  }
  merged.sort((a, b) => b.legends.length - a.legends.length);

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
  const dists = [3 * vf, 5 * vf, 8 * vf];

  // Compass name → dir index for STATION_LABEL_OVERRIDES
  const COMPASS_TO_DIR = { E: 0, W: 1, NE: 2, NW: 3, SE: 4, SW: 5, N: 6, S: 7 };

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
    // Label ↔ station dots (check all dot positions, including merged)
    for (const s of merged) {
      for (const dot of s.dots) {
        const cx = Math.max(bb.x, Math.min(dot.px, bb.x + bb.w));
        const cy = Math.max(bb.y, Math.min(dot.py, bb.y + bb.h));
        if ((dot.px - cx) ** 2 + (dot.py - cy) ** 2 < (DOT_R * 1.5) ** 2) score += 15;
      }
    }
    // Label ↔ transit lines
    score += countLineHits(bb.x, bb.y, bb.w, bb.h) * 5;
    return score;
  }

  const results = [];

  for (const station of merged) {
    const tw = station.name.length * CHAR_W;
    let best = null, bestScore = Infinity;

    // Check for a per-station direction override
    const override = STATION_LABEL_OVERRIDES[station.name];
    const forcedDirIdx = override != null ? COMPASS_TO_DIR[override] : -1;

    if (forcedDirIdx >= 0) {
      // Use forced direction, pick best distance
      const dir = dirs[forcedDirIdx];
      for (const d of dists) {
        const dx = dir.ux * d, dy = dir.uy * d;
        const bb = labelRect(station.px + dx, station.py + dy, tw, dir.anchor);
        const s = scorePlacement(bb) + d * 0.3;
        if (s < bestScore) { bestScore = s; best = { dx, dy, anchor: dir.anchor, bb }; }
      }
    } else {
      search:
      for (const d of dists) {
        for (const dir of dirs) {
          const dx = dir.ux * d, dy = dir.uy * d;
          const bb = labelRect(station.px + dx, station.py + dy, tw, dir.anchor);
          // Merged stations: penalize cardinal directions so leader lines spread apart
          const cardinalPenalty = station.dots.length > 1 && (dir.ux === 0 || dir.uy === 0) ? 20 : 0;
          const s = scorePlacement(bb) + d * 0.3 + cardinalPenalty;   // prefer closer
          if (s < bestScore) { bestScore = s; best = { dx, dy, anchor: dir.anchor, bb }; }
          if (bestScore <= dists[0] * 0.3) break search;
        }
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

    // Render dots and leader lines (one per dot position)
    for (const dot of station.dots) {
      const dotCx = dot.px - station.px;
      const dotCy = dot.py - station.py;

      // Leader line from dot center to label anchor
      g.append('line')
        .attr('class', 'station-leader')
        .attr('x1', dotCx).attr('y1', dotCy)
        .attr('x2', dx).attr('y2', dy);

      g.append('circle')
        .attr('class', 'station-dot')
        .attr('cx', dotCx)
        .attr('cy', dotCy)
        .attr('r', DOT_R)
        .attr('data-base-r', DOT_R)
        .attr('fill', '#fff');
    }

    g.append('text')
      .attr('class', 'station-label')
      .attr('x', dx).attr('y', dy)
      .attr('text-anchor', anchor)
      .attr('dominant-baseline', 'central')
      .attr('font-size', `${FONT_SIZE}px`)
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

  // Compute reference scale using a canonical 1440×900 desktop viewport.
  // All visual constants are calibrated for this reference; visualScale adjusts
  // them proportionally so dots/labels/lines stay in the same ratio on any device.
  const refProjection = d3.geoMercator().fitExtent(
    [
      [1440 * MAP_PADDING, 900 * MAP_PADDING],
      [1440 * (1 - MAP_PADDING), 900 * (1 - MAP_PADDING)]
    ],
    geojson
  );
  const geoScaleReference = refProjection.scale();
  const visualScale = projection.scale() / geoScaleReference;
  const scaledLineWidth = LINE_WIDTH * visualScale;

  const path = d3.geoPath().projection(projection);

  createTrainGlowGradients(svg.append('defs'));

  const mapContainer = svg.append('g').attr('class', 'map-container');

  const linesGroup = mapContainer.append('g').attr('class', 'lines-layer');
  renderLines(linesGroup, path, geojson, scaledLineWidth);

  // Stations layer sits between lines and trains (created hidden)
  mapContainer.append('g').attr('class', 'stations-layer').style('display', 'none');

  return { projection, geojson, path, mapContainer, geoScaleReference, visualScale };
}

/**
 * Re-renders the map into an existing SVG at the given dimensions.
 * Clears previous content and redraws everything.
 */
function redrawMap(svg, width, height, geojson, geoScaleReference) {
  svg.selectAll('*').remove();

  const projection = d3.geoMercator().fitExtent(
    [
      [width * MAP_PADDING, height * MAP_PADDING],
      [width * (1 - MAP_PADDING), height * (1 - MAP_PADDING)]
    ],
    geojson
  );

  const visualScale = projection.scale() / geoScaleReference;
  const scaledLineWidth = LINE_WIDTH * visualScale;

  const path = d3.geoPath().projection(projection);

  createTrainGlowGradients(svg.append('defs'));

  const mapContainer = svg.append('g').attr('class', 'map-container');

  const linesGroup = mapContainer.append('g').attr('class', 'lines-layer');
  renderLines(linesGroup, path, geojson, scaledLineWidth);

  mapContainer.append('g').attr('class', 'stations-layer');

  return { projection, path, visualScale };
}
