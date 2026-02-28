/**
 * Path-following animation: snaps intermediate waypoints to the nearest
 * point on a train line's track geometry so trains follow curves instead
 * of cutting corners during position transitions.
 */

/**
 * Builds a lookup of coordinate segments per legend code.
 * Loop (ML) segments are included for lines that traverse the Loop.
 * Returns: { RD: [[seg1coords], ...], BL: [...], ... }
 */
function buildLineSegments(geojson) {
  const loopLines = ['BR', 'OR', 'PK', 'PR', 'GR'];

  // Reverse map: legend code → human-readable name for ML segment filtering
  const legendToLineName = {};
  for (const [name, code] of Object.entries(LINE_NAME_TO_LEGEND_STATION)) {
    legendToLineName[code] = name;
  }

  const segments = {};
  for (const legend of Object.keys(LINE_COLORS)) {
    if (legend === 'ML') continue;
    const coords = collectLineCoords(geojson, legend);

    // Include segments from other lines that share track with this line
    // (e.g. Purple Express on Red Line track, Brown on shared Red segments)
    const lineName = legendToLineName[legend];
    const sharedCoords = lineName ? collectSharedCoordsForLine(geojson, lineName, legend) : [];

    if (loopLines.includes(legend)) {
      // Only include ML segments whose "lines" property mentions this line
      const mlCoords = collectMLCoordsForLine(geojson, lineName);
      segments[legend] = coords.concat(sharedCoords).concat(mlCoords);
    } else {
      segments[legend] = coords.concat(sharedCoords);
    }
  }
  return segments;
}

/**
 * Collects coordinate arrays from features of OTHER legend codes (not ML, not ownLegend)
 * whose "lines" property includes the given line name.
 * This captures shared track segments, e.g. Purple Express running on Red Line track.
 */
function collectSharedCoordsForLine(geojson, lineName, ownLegend) {
  const coords = [];
  for (const feature of geojson.features) {
    const featureLegend = feature.properties.legend;
    if (featureLegend === ownLegend || featureLegend === 'ML') continue;
    const linesProp = feature.properties.lines || '';
    if (!linesProp.includes(lineName)) continue;
    const geom = feature.geometry;
    if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) coords.push(line);
    } else if (geom.type === 'LineString') {
      coords.push(geom.coordinates);
    }
  }
  return coords;
}

/**
 * Collects coordinate arrays from ML features whose "lines" property includes the given line name.
 */
function collectMLCoordsForLine(geojson, lineName) {
  const coords = [];
  for (const feature of geojson.features) {
    if (feature.properties.legend !== 'ML') continue;
    const linesProp = feature.properties.lines || '';
    if (!linesProp.includes(lineName)) continue;
    const geom = feature.geometry;
    if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) coords.push(line);
    } else if (geom.type === 'LineString') {
      coords.push(geom.coordinates);
    }
  }
  return coords;
}

/**
 * Finds the nearest point on any segment of a line to the given coordinate.
 * Uses point-to-line-segment projection.
 * Returns [lon, lat] of the closest point.
 */
function nearestPointOnLine(lon, lat, segments) {
  let bestDist = Infinity;
  let bestPoint = [lon, lat];

  for (const seg of segments) {
    for (let i = 0; i < seg.length - 1; i++) {
      const ax = seg[i][0], ay = seg[i][1];
      const bx = seg[i + 1][0], by = seg[i + 1][1];

      // Project point onto the line segment [a, b]
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;

      let t = 0;
      if (lenSq > 0) {
        t = ((lon - ax) * dx + (lat - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
      }

      const px = ax + t * dx;
      const py = ay + t * dy;
      const dist = (lon - px) * (lon - px) + (lat - py) * (lat - py);

      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = [px, py];
      }
    }
  }

  return bestPoint;
}

/**
 * Generates intermediate waypoints between old and new positions,
 * each snapped to the nearest point on the line's track.
 * Returns array of [lon, lat] coordinates.
 */
function computeWaypoints(oldLon, oldLat, newLon, newLat, segments, count) {
  if (!segments || segments.length === 0) return [[oldLon, oldLat], [newLon, newLat]];

  count = count || 8;
  const waypoints = [];

  for (let i = 0; i <= count; i++) {
    const frac = i / count;
    const lon = oldLon + frac * (newLon - oldLon);
    const lat = oldLat + frac * (newLat - oldLat);
    waypoints.push(nearestPointOnLine(lon, lat, segments));
  }

  return waypoints;
}

// ---- Real-time animation helpers ----

/**
 * Euclidean distance in degrees (good enough for small Chicago-area distances).
 */
function geoDist(lon1, lat1, lon2, lat2) {
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Snaps a point to the nearest position on a line's track geometry.
 * Returns full track-position state for continuous animation.
 * { segIdx, ptIdx, t, lon, lat }
 */
function snapToTrackPosition(lon, lat, segments) {
  let bestDist = Infinity;
  let best = { segIdx: 0, ptIdx: 0, t: 0, lon: lon, lat: lat };

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    for (let i = 0; i < seg.length - 1; i++) {
      const ax = seg[i][0], ay = seg[i][1];
      const bx = seg[i + 1][0], by = seg[i + 1][1];

      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;

      let t = 0;
      if (lenSq > 0) {
        t = ((lon - ax) * dx + (lat - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
      }

      const px = ax + t * dx;
      const py = ay + t * dy;
      const dist = (lon - px) * (lon - px) + (lat - py) * (lat - py);

      if (dist < bestDist) {
        bestDist = dist;
        best = { segIdx: s, ptIdx: i, t: t, lon: px, lat: py };
      }
    }
  }

  return best;
}

/**
 * Determines direction (+1 or -1) along a segment that best matches a heading.
 * heading: degrees clockwise from north (0-360), as CTA API provides.
 */
function directionFromHeading(heading, segIdx, ptIdx, segments) {
  const seg = segments[segIdx];
  if (!seg || ptIdx >= seg.length - 1) return 1;

  // Segment direction vector
  const dx = seg[ptIdx + 1][0] - seg[ptIdx][0];
  const dy = seg[ptIdx + 1][1] - seg[ptIdx][1];

  // Convert heading (CTA: degrees CW from north) to a unit vector
  const hRad = (heading * Math.PI) / 180;
  const hx = Math.sin(hRad); // east component
  const hy = Math.cos(hRad); // north component

  // Dot product: positive = same direction, negative = opposite
  // Note: in lon/lat space, x=lon (east), y=lat (north)
  const dot = dx * hx + dy * hy;
  return dot >= 0 ? 1 : -1;
}

/**
 * Advances a track position by distanceDeg along the track geometry.
 * direction: +1 = forward along segment points, -1 = backward.
 * Handles crossing segment boundaries by finding nearby connected segments.
 * Returns new { segIdx, ptIdx, t, lon, lat, stopped }.
 */
function advanceOnTrack(trackPos, distanceDeg, direction, segments) {
  let { segIdx, ptIdx, t } = trackPos;
  let remaining = distanceDeg;
  let dir = direction; // Mutable — updated when entering a new segment
  const seg = segments[segIdx];

  if (!seg) return { ...trackPos, direction: dir, stopped: true };

  // Safety limit to prevent infinite loops from malformed geometry
  const MAX_ITER = 10000;
  let iter = 0;

  // Advance within current segment
  while (remaining > 0 && ++iter < MAX_ITER) {
    const curSeg = segments[segIdx];
    if (!curSeg) break;

    const i = ptIdx;
    if (i < 0 || i >= curSeg.length - 1) break;

    const ax = curSeg[i][0], ay = curSeg[i][1];
    const bx = curSeg[i + 1][0], by = curSeg[i + 1][1];
    const edgeLen = geoDist(ax, ay, bx, by);

    if (edgeLen < 1e-10) {
      // Degenerate edge — skip it
      if (dir > 0) {
        ptIdx++;
        t = 0;
        if (ptIdx >= curSeg.length - 1) {
          // Try next segment
          const next = findConnectedSegment(segIdx, ptIdx, curSeg, dir, segments);
          if (!next) return { segIdx, ptIdx: curSeg.length - 2, t: 1, lon: bx, lat: by, direction: dir, stopped: true };
          segIdx = next.segIdx;
          ptIdx = next.ptIdx;
          t = next.t;
          dir = next.direction;
        }
      } else {
        ptIdx--;
        t = 1;
        if (ptIdx < 0) {
          const next = findConnectedSegment(segIdx, 0, curSeg, dir, segments);
          if (!next) return { segIdx, ptIdx: 0, t: 0, lon: ax, lat: ay, direction: dir, stopped: true };
          segIdx = next.segIdx;
          ptIdx = next.ptIdx;
          t = next.t;
          dir = next.direction;
        }
      }
      continue;
    }

    if (dir > 0) {
      const distToEdgeEnd = (1 - t) * edgeLen;
      if (remaining <= distToEdgeEnd) {
        t += remaining / edgeLen;
        remaining = 0;
      } else {
        remaining -= distToEdgeEnd;
        ptIdx++;
        t = 0;
        if (ptIdx >= curSeg.length - 1) {
          // Crossed segment boundary — find the next connected one
          const next = findConnectedSegment(segIdx, curSeg.length - 1, curSeg, dir, segments);
          if (!next) {
            // Terminal — stop at end
            const last = curSeg[curSeg.length - 1];
            return { segIdx, ptIdx: curSeg.length - 2, t: 1, lon: last[0], lat: last[1], direction: dir, stopped: true };
          }
          segIdx = next.segIdx;
          ptIdx = next.ptIdx;
          t = next.t;
          dir = next.direction;
        }
      }
    } else {
      const distToEdgeStart = t * edgeLen;
      if (remaining <= distToEdgeStart) {
        t -= remaining / edgeLen;
        remaining = 0;
      } else {
        remaining -= distToEdgeStart;
        ptIdx--;
        t = 1;
        if (ptIdx < 0) {
          const next = findConnectedSegment(segIdx, 0, curSeg, dir, segments);
          if (!next) {
            const first = curSeg[0];
            return { segIdx, ptIdx: 0, t: 0, lon: first[0], lat: first[1], direction: dir, stopped: true };
          }
          segIdx = next.segIdx;
          ptIdx = next.ptIdx;
          t = next.t;
          dir = next.direction;
        }
      }
    }
  }

  // Interpolate final position
  const finalSeg = segments[segIdx];
  if (!finalSeg || ptIdx < 0 || ptIdx >= finalSeg.length - 1) {
    return { ...trackPos, direction: dir, stopped: true };
  }
  const ax = finalSeg[ptIdx][0], ay = finalSeg[ptIdx][1];
  const bx = finalSeg[ptIdx + 1][0], by = finalSeg[ptIdx + 1][1];
  const lon = ax + t * (bx - ax);
  const lat = ay + t * (by - ay);

  return { segIdx, ptIdx, t, lon, lat, direction: dir, stopped: false };
}

/**
 * Computes the distance along the track from one track position to another.
 * Walks edge-by-edge using advanceOnTrack until reaching the target.
 * Falls back to straight-line distance if the target can't be reached
 * (e.g. wrong direction, different branch).
 */
function trackDistanceBetween(from, to, direction, segments) {
  const straightDist = geoDist(from.lon, from.lat, to.lon, to.lat);
  if (straightDist < 1e-7) return 0;

  // Walk in steps proportional to the straight-line distance
  const step = Math.max(straightDist / 40, 1e-5);
  let pos = from;
  let totalDist = 0;
  let prevDistToTarget = straightDist;

  for (let i = 0; i < 2000; i++) {
    const newPos = advanceOnTrack(pos, step, direction, segments);
    totalDist += step;

    const distToTarget = geoDist(newPos.lon, newPos.lat, to.lon, to.lat);

    // Close enough — add final bit and return
    if (distToTarget < step * 0.5) {
      return totalDist + distToTarget;
    }

    // Getting farther away — wrong direction or different branch
    if (distToTarget > prevDistToTarget + step * 0.5) {
      return straightDist;
    }

    if (newPos.stopped) {
      return totalDist + distToTarget;
    }

    prevDistToTarget = distToTarget;
    pos = newPos;
  }

  return straightDist; // safety fallback
}

/**
 * Finds a connected segment when the train reaches the end (or start) of its current segment.
 * Searches for segments with an endpoint close to the boundary point.
 * Returns { segIdx, ptIdx, t } for the new segment, or null if terminal.
 */
function findConnectedSegment(curSegIdx, boundaryPtIdx, curSeg, direction, segments) {
  const bx = curSeg[boundaryPtIdx][0];
  const by = curSeg[boundaryPtIdx][1];
  const threshold = SEGMENT_CONNECT_THRESHOLD;

  let bestDist = Infinity;
  let bestResult = null;

  for (let s = 0; s < segments.length; s++) {
    if (s === curSegIdx) continue;
    const seg = segments[s];
    if (seg.length < 2) continue;

    // Check start of segment — enter moving forward
    const d0 = geoDist(bx, by, seg[0][0], seg[0][1]);
    if (d0 < threshold && d0 < bestDist) {
      bestDist = d0;
      bestResult = { segIdx: s, ptIdx: 0, t: 0, direction: 1 };
    }

    // Check end of segment — enter moving backward
    const last = seg.length - 1;
    const dN = geoDist(bx, by, seg[last][0], seg[last][1]);
    if (dN < threshold && dN < bestDist) {
      bestDist = dN;
      bestResult = { segIdx: s, ptIdx: last - 1, t: 1, direction: -1 };
    }
  }

  return bestResult;
}

/**
 * Builds station position lookups from GeoJSON segment endpoint descriptions.
 * Returns { byLine: Map<"LEGEND:name", [lon,lat]>, byName: Map<"name", [lon,lat]> }
 */
function buildStationPositions(geojson) {
  const byLine = new Map();
  const byName = new Map();

  for (const feature of geojson.features) {
    const desc = feature.properties.description || '';
    const coords = feature.geometry.coordinates;
    const line = feature.geometry.type === 'MultiLineString' ? coords[0] : coords;
    if (!line || line.length < 2) continue;

    const match = desc.match(/^(.+?)\s+to\s+(.+)$/i);
    if (!match) continue;

    const nameA = match[1].trim();
    const nameB = match[2].trim();
    const startCoord = line[0];
    const endCoord = line[line.length - 1];

    // Determine which legend codes this feature serves
    const legends = [];
    const featureLegend = feature.properties.legend;
    if (featureLegend && featureLegend !== 'ML') {
      legends.push(featureLegend);
    }
    // Also parse the "lines" property for multi-line segments and ML
    const linesProp = feature.properties.lines || '';
    for (const [lineName, code] of Object.entries(LINE_NAME_TO_LEGEND_STATION)) {
      if (linesProp.includes(lineName)) {
        if (!legends.includes(code)) legends.push(code);
      }
    }

    const pairs = [
      [nameA, startCoord],
      [nameB, endCoord],
    ];

    for (const [name, coord] of pairs) {
      const norm = normalizeStationName(name);

      // Line-specific keys
      for (const legend of legends) {
        const key = legend + ':' + norm;
        if (!byLine.has(key)) byLine.set(key, coord);
      }

      // Name-only fallback
      if (!byName.has(norm)) byName.set(norm, coord);
    }
  }

  return { byLine, byName };
}

/**
 * Looks up a station position by name and line.
 * Returns [lon, lat] or null.
 */
function lookupStation(stationName, legend, stationPositions) {
  if (!stationName) return null;
  const norm = normalizeStationName(stationName);

  // Try line-specific first
  const lineKey = legend + ':' + norm;
  if (stationPositions.byLine.has(lineKey)) {
    return stationPositions.byLine.get(lineKey);
  }

  // For loop lines, the station might be in ML segments keyed under a different legend
  // Try all legends for this station
  for (const [key, coord] of stationPositions.byLine) {
    if (key.endsWith(':' + norm)) return coord;
  }

  // Name-only fallback
  if (stationPositions.byName.has(norm)) {
    return stationPositions.byName.get(norm);
  }

  // Partial / substring match — handles cases where API destination name
  // doesn't exactly match GeoJSON endpoint name (e.g. "O'Hare" vs "O-Hare",
  // "Midway" vs "Midway Airport", etc.)
  // Prefer line-specific partial matches first
  let bestPartial = null;
  let bestPartialLen = Infinity;
  for (const [key, coord] of stationPositions.byLine) {
    const colonIdx = key.indexOf(':');
    const keyLegend = key.substring(0, colonIdx);
    const keyName = key.substring(colonIdx + 1);
    if (keyLegend !== legend) continue;
    if (keyName.includes(norm) || norm.includes(keyName)) {
      if (keyName.length < bestPartialLen) {
        bestPartialLen = keyName.length;
        bestPartial = coord;
      }
    }
  }
  if (bestPartial) return bestPartial;

  // Partial match across all names (any legend)
  for (const [name, coord] of stationPositions.byName) {
    if (name.includes(norm) || norm.includes(name)) {
      return coord;
    }
  }

  return null;
}

/**
 * Normalize station names for fuzzy matching.
 * Lowercases, replaces slashes and hyphens with spaces, collapses whitespace.
 */
function normalizeStationName(name) {
  return name.toLowerCase().replace(/[\/\-]/g, ' ').replace(/\s+/g, ' ').trim();
}
