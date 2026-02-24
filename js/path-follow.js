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
  const mlCoords = collectLineCoords(geojson, 'ML');

  const segments = {};
  for (const legend of Object.keys(LINE_COLORS)) {
    if (legend === 'ML') continue;
    const coords = collectLineCoords(geojson, legend);
    segments[legend] = loopLines.includes(legend)
      ? coords.concat(mlCoords)
      : coords;
  }
  return segments;
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
