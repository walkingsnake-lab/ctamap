/**
 * Path-following animation: snaps intermediate waypoints to the nearest
 * point on a train line's track geometry so trains follow curves instead
 * of cutting corners during position transitions.
 */

/**
 * Collects coordinate arrays from features whose legend property matches the given legend code.
 * Returns an array of coordinate arrays (one per LineString / MultiLineString sub-line).
 */
function collectLineCoords(geojson, legend) {
  const coords = [];
  for (const feature of geojson.features) {
    if (feature.properties.legend !== legend) continue;
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
 * Builds a lookup of coordinate segments per legend code.
 * Loop (ML) segments are included for lines that traverse the Loop.
 * Returns: { segments: { RD: [...], ... }, ownSegments: { RD: [...], ... } }
 *   segments     — full track including shared and ML (for animation/snapping)
 *   ownSegments  — only the line's own colored segments (for terminal detection)
 */
function buildLineSegments(geojson) {
  // LOOP_LINE_CODES defined in config.js

  // Reverse map: legend code → human-readable name for ML segment filtering
  const legendToLineName = {};
  for (const [name, code] of Object.entries(LINE_NAME_TO_LEGEND_STATION)) {
    legendToLineName[code] = name;
  }

  const segments = {};
  const ownSegments = {};
  for (const legend of Object.keys(LINE_COLORS)) {
    if (legend === 'ML') continue;
    const coords = collectLineCoords(geojson, legend);
    ownSegments[legend] = coords;

    // Include segments from other lines that share track with this line
    // (e.g. Purple Express on Red Line track, Brown on shared Red segments)
    const lineName = legendToLineName[legend];
    const sharedCoords = lineName ? collectSharedCoordsForLine(geojson, lineName, legend) : [];

    if (LOOP_LINE_CODES.includes(legend)) {
      // Only include ML segments whose "lines" property mentions this line
      const mlCoords = collectMLCoordsForLine(geojson, lineName);
      segments[legend] = coords.concat(sharedCoords).concat(mlCoords);
    } else {
      segments[legend] = coords.concat(sharedCoords);
    }
  }
  return { segments, ownSegments };
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
 * Builds a precomputed neighbor map for a set of segments.
 * For each segment index, stores the set of segment indices whose endpoints
 * are within SEGMENT_CONNECT_THRESHOLD of this segment's endpoints.
 * Returns: Map<segIdx, Set<segIdx>>
 */
function buildSegmentNeighborMap(segments) {
  const threshold = SEGMENT_CONNECT_THRESHOLD;
  const map = new Map();
  for (let i = 0; i < segments.length; i++) {
    map.set(i, new Set());
  }
  for (let i = 0; i < segments.length; i++) {
    const si = segments[i];
    if (si.length < 2) continue;
    const iStart = si[0], iEnd = si[si.length - 1];
    for (let j = i + 1; j < segments.length; j++) {
      const sj = segments[j];
      if (sj.length < 2) continue;
      const jStart = sj[0], jEnd = sj[sj.length - 1];
      if (geoDist(iStart[0], iStart[1], jStart[0], jStart[1]) < threshold ||
          geoDist(iStart[0], iStart[1], jEnd[0], jEnd[1]) < threshold ||
          geoDist(iEnd[0], iEnd[1], jStart[0], jStart[1]) < threshold ||
          geoDist(iEnd[0], iEnd[1], jEnd[0], jEnd[1]) < threshold) {
        map.get(i).add(j);
        map.get(j).add(i);
      }
    }
  }
  return map;
}

/**
 * Snaps a point to the track with segment affinity: prefers the current segment
 * and its direct neighbors (connected segments) over distant segments.
 * Falls back to the global best only when no nearby segment is within
 * SNAP_AFFINITY_MARGIN of the global best.
 *
 * prevTrackPos: the train's previous { segIdx, ptIdx, t } (or null for first snap).
 * neighborMap: precomputed Map<segIdx, Set<segIdx>> (or null to skip affinity).
 *
 * This prevents trains from snapping to a topologically distant but geographically
 * close segment at corners, crossings, and junctions.
 */
function snapToTrackWithAffinity(lon, lat, segments, prevTrackPos, neighborMap) {
  // No previous position or no neighbor map — fall back to global snap
  if (!prevTrackPos || !neighborMap) {
    return snapToTrackPosition(lon, lat, segments);
  }

  // Collect the set of "nearby" segment indices: current + neighbors + neighbors-of-neighbors
  const nearby = new Set();
  nearby.add(prevTrackPos.segIdx);
  const directNeighbors = neighborMap.get(prevTrackPos.segIdx);
  if (directNeighbors) {
    for (const n of directNeighbors) {
      nearby.add(n);
      // Include 2nd-degree neighbors so we can look one junction ahead.
      // This covers cases where the train crosses two segment boundaries
      // in a single poll interval (e.g., short segments near junctions).
      const nn = neighborMap.get(n);
      if (nn) for (const n2 of nn) nearby.add(n2);
    }
  }

  // Find best snap among nearby segments
  let nearbyBestDist = Infinity;
  let nearbyBest = null;

  for (const s of nearby) {
    const seg = segments[s];
    if (!seg) continue;
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

      if (dist < nearbyBestDist) {
        nearbyBestDist = dist;
        nearbyBest = { segIdx: s, ptIdx: i, t: t, lon: px, lat: py };
      }
    }
  }

  // Also compute global best for comparison
  const globalBest = snapToTrackPosition(lon, lat, segments);
  const globalDist = (lon - globalBest.lon) * (lon - globalBest.lon) +
                     (lat - globalBest.lat) * (lat - globalBest.lat);

  // Use nearby snap unless the global snap is dramatically closer.
  // SNAP_AFFINITY_MARGIN (e.g. 1.5) means: only abandon affinity if the global
  // snap distance is less than 1/1.5 of the nearby snap distance (in squared
  // distance terms, so effectively sqrt(1.5) ≈ 1.22× closer in linear distance).
  if (nearbyBest && nearbyBestDist < globalDist * SNAP_AFFINITY_MARGIN) {
    // Log when affinity chose a different segment than the global snap would have
    if (globalBest.segIdx !== nearbyBest.segIdx) {
      const nearbyLinear = Math.sqrt(nearbyBestDist) * 111000;
      const globalLinear = Math.sqrt(globalDist) * 111000;
      console.log(`[CTA] Affinity snap: kept seg ${nearbyBest.segIdx} (${nearbyLinear.toFixed(0)}m) over global seg ${globalBest.segIdx} (${globalLinear.toFixed(0)}m)`);
    }
    return nearbyBest;
  }

  // Global snap won — log the override for diagnostics
  if (nearbyBest && globalBest.segIdx !== nearbyBest.segIdx) {
    const nearbyLinear = Math.sqrt(nearbyBestDist) * 111000;
    const globalLinear = Math.sqrt(globalDist) * 111000;
    console.log(`[CTA] Affinity override: global seg ${globalBest.segIdx} (${globalLinear.toFixed(0)}m) beat affinity seg ${nearbyBest.segIdx} (${nearbyLinear.toFixed(0)}m)`);
  }

  return globalBest;
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
 *
 * Optional opts.targetLon / opts.targetLat: forwarded to findConnectedSegment
 * to guide junction selection toward a known destination (see that function's
 * doc for details).
 */
function advanceOnTrack(trackPos, distanceDeg, direction, segments, opts) {
  let { segIdx, ptIdx, t } = trackPos;
  let remaining = distanceDeg;
  let dir = direction; // Mutable — updated when entering a new segment
  const seg = segments[segIdx];
  const tLon = opts?.targetLon, tLat = opts?.targetLat;

  if (!seg) return { ...trackPos, direction: dir, stopped: true };

  // ADVANCE_MAX_ITER defined in config.js
  let iter = 0;

  // Advance within current segment
  while (remaining > 0 && ++iter < ADVANCE_MAX_ITER) {
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
          const next = findConnectedSegment(segIdx, ptIdx, curSeg, dir, segments, tLon, tLat);
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
          const next = findConnectedSegment(segIdx, 0, curSeg, dir, segments, tLon, tLat);
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
          const next = findConnectedSegment(segIdx, curSeg.length - 1, curSeg, dir, segments, tLon, tLat);
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
          const next = findConnectedSegment(segIdx, 0, curSeg, dir, segments, tLon, tLat);
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
  let minDistToTarget = straightDist;
  const targetHint = { targetLon: to.lon, targetLat: to.lat };

  for (let i = 0; i < 2000; i++) {
    const newPos = advanceOnTrack(pos, step, direction, segments, targetHint);
    totalDist += step;

    const distToTarget = geoDist(newPos.lon, newPos.lat, to.lon, to.lat);

    // Close enough — add final bit and return
    if (distToTarget < step * 0.5) {
      return totalDist + distToTarget;
    }

    if (distToTarget < minDistToTarget) minDistToTarget = distToTarget;

    // Getting farther away — wrong direction or different branch.
    // Compare against minimum distance seen (not just previous step) to allow
    // brief distance increases on track corners (e.g. ML loop 90° turns).
    // Use a floor of 0.002 deg (~220m) so that sharp corners on the downtown
    // Loop don't bail prematurely — the step-relative tolerance (step * 2) is
    // only ~17m for typical station-to-station moves, far less than the lateral
    // deviation at a 90° corner.  0.002 is still small enough that a genuinely
    // wrong-direction walk diverges past it within a few dozen steps.
    const cornerSlack = Math.max(step * 2, 0.002);
    if (distToTarget > minDistToTarget + cornerSlack) {
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
 *
 * Optional targetLon/targetLat: when provided, ties between equidistant candidate
 * segments are broken by preferring the one whose exit direction points toward the
 * target.  This guides junction selection at the downtown Loop where multiple ML
 * segments meet and the arrival-direction heuristic picks the wrong branch.
 */
function findConnectedSegment(curSegIdx, boundaryPtIdx, curSeg, direction, segments, targetLon, targetLat) {
  const bx = curSeg[boundaryPtIdx][0];
  const by = curSeg[boundaryPtIdx][1];
  const threshold = SEGMENT_CONNECT_THRESHOLD;
  // When two candidates are within TIE_EPS of each other in distance (e.g. two
  // segments sharing the same junction point), break the tie by preferring the
  // one whose entry direction best aligns with the current direction of travel
  // (or toward the target, when one is provided).
  const TIE_EPS = threshold * 0.01;

  // Arrival direction vector: from the second-to-last traversed point to the boundary.
  // direction > 0 → arriving at end of segment (prevIdx = boundaryPtIdx - 1).
  // direction < 0 → arriving at start of segment (prevIdx = boundaryPtIdx + 1).
  const prevIdx = direction > 0 ? boundaryPtIdx - 1 : boundaryPtIdx + 1;
  const arrDx = prevIdx >= 0 && prevIdx < curSeg.length
    ? bx - curSeg[prevIdx][0] : 0;
  const arrDy = prevIdx >= 0 && prevIdx < curSeg.length
    ? by - curSeg[prevIdx][1] : 0;

  // When a target is provided, prefer the segment whose exit direction points
  // toward it.  This overrides the arrival-alignment heuristic at junctions like
  // the downtown Loop entry where the correct segment requires a sharp turn.
  //
  // Guard: only use the target for scoring when it is not clearly *behind*
  // the junction.  When the target is behind — e.g. a forward arrow that has
  // advanced past the correction target, or a stale _corrToTrackPos after the
  // correction completed — the target vector points backward and would cause
  // findConnectedSegment to select the wrong (rearward) branch.
  //
  // Use a normalized cosine threshold of -0.25 (~105°) rather than a strict
  // dot > 0 check, so that near-perpendicular targets still influence junction
  // selection.  This matters at ML loop corners where the track turns 90° and
  // the target is on the adjacent side — the arrival direction and target
  // direction are nearly perpendicular, but the target hint is still needed
  // to pick the correct ML continuation over a line's own exit segment.
  const hasTarget = targetLon !== undefined && targetLat !== undefined;
  const toTargetDx = hasTarget ? targetLon - bx : 0;
  const toTargetDy = hasTarget ? targetLat - by : 0;
  const arrMag = Math.sqrt(arrDx * arrDx + arrDy * arrDy);
  const tarMag = Math.sqrt(toTargetDx * toTargetDx + toTargetDy * toTargetDy);
  const targetIsAhead = hasTarget && arrMag > 0 && tarMag > 0
    && (arrDx * toTargetDx + arrDy * toTargetDy) > -0.25 * arrMag * tarMag;

  let bestDist = Infinity;
  let bestDot  = -Infinity;
  let bestResult = null;

  for (let s = 0; s < segments.length; s++) {
    if (s === curSegIdx) continue;
    const seg = segments[s];
    if (seg.length < 2) continue;

    // Check start of segment — enter moving forward
    const d0 = geoDist(bx, by, seg[0][0], seg[0][1]);
    if (d0 < threshold) {
      const exitDx = seg[1][0] - seg[0][0];
      const exitDy = seg[1][1] - seg[0][1];
      const dot = targetIsAhead
        ? exitDx * toTargetDx + exitDy * toTargetDy
        : arrDx * exitDx + arrDy * exitDy;
      if (d0 < bestDist - TIE_EPS || (d0 < bestDist + TIE_EPS && dot > bestDot)) {
        bestDist = d0;
        bestDot  = dot;
        bestResult = { segIdx: s, ptIdx: 0, t: 0, direction: 1 };
      }
    }

    // Check end of segment — enter moving backward
    const last = seg.length - 1;
    const dN = geoDist(bx, by, seg[last][0], seg[last][1]);
    if (dN < threshold) {
      const exitDx = seg[last - 1][0] - seg[last][0];
      const exitDy = seg[last - 1][1] - seg[last][1];
      const dot = targetIsAhead
        ? exitDx * toTargetDx + exitDy * toTargetDy
        : arrDx * exitDx + arrDy * exitDy;
      if (dN < bestDist - TIE_EPS || (dN < bestDist + TIE_EPS && dot > bestDot)) {
        bestDist = dN;
        bestDot  = dot;
        bestResult = { segIdx: s, ptIdx: last - 1, t: 1, direction: -1 };
      }
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

  // Partial / substring match — line-specific only to avoid cross-line
  // mismatches (e.g. "Cermak" matching Red's Cermak-Chinatown instead of Pink's 54th/Cermak)
  let bestPartial = null;
  let bestLenDiff = Infinity;
  for (const [key, coord] of stationPositions.byLine) {
    const colonIdx = key.indexOf(':');
    const keyLegend = key.substring(0, colonIdx);
    const keyName = key.substring(colonIdx + 1);
    if (keyLegend !== legend) continue;
    if (keyName.includes(norm) || norm.includes(keyName)) {
      const lenDiff = Math.abs(keyName.length - norm.length);
      if (lenDiff < bestLenDiff) {
        bestLenDiff = lenDiff;
        bestPartial = coord;
      }
    }
  }
  if (bestPartial) return bestPartial;

  return null;
}

/**
 * Normalize station names for fuzzy matching.
 * Lowercases, replaces slashes and hyphens with spaces, collapses whitespace.
 */
function normalizeStationName(name) {
  return name.toLowerCase().replace(/[\/\-''`]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Returns true if a name looks like an infrastructure point rather than
 * a passenger station (junctions, towers, portals, connectors, etc.).
 */
function isInfrastructureName(name) {
  return /\b(junction|connector|tower|portal|yard|interlocking|wye)\b/i.test(name);
}

/**
 * GeoJSON segment names use branch suffixes to disambiguate stations that
 * share a street name on different lines (e.g. "Addison-O'Hare" vs
 * "Addison-Ravenswood"). Strip these for display to match real CTA signage.
 */
// BRANCH_SUFFIXES defined in config.js

function displayStationName(name) {
  for (const suffix of BRANCH_SUFFIXES) {
    if (name.endsWith('-' + suffix)) {
      return cleanStationName(name.slice(0, -(suffix.length + 1)));
    }
  }
  return cleanStationName(name);
}

/**
 * Builds a deduplicated array of station objects from GeoJSON segment descriptions.
 * Filters out infrastructure points (junctions, towers, portals, etc.).
 * Each station has: { name, lon, lat, legends: string[] }
 *
 * Station coordinates are determined by finding shared endpoints between
 * adjacent GeoJSON segments.  Segment descriptions follow the pattern
 * "StationA to StationB", but the geometry direction is arbitrary (line[0]
 * may be A or B).  Where two segments share a station name, the endpoint
 * coordinate they have in common IS that station's location.  Terminal
 * stations (only one segment) use the endpoint that is NOT shared with any
 * other segment.
 */
function buildUniqueStations(geojson) {
  const coordKey = (c) => c[0].toFixed(10) + ',' + c[1].toFixed(10);

  // --- Step 1: parse segments and build endpoint index ---
  const segments = [];
  for (const feature of geojson.features) {
    const desc = feature.properties.description || '';
    const match = desc.match(/^(.+?)\s+to\s+(.+)$/i);
    if (!match) continue;

    const coords = feature.geometry.coordinates;
    const line = feature.geometry.type === 'MultiLineString' ? coords[0] : coords;
    if (!line || line.length < 2) continue;

    const legends = [];
    const featureLegend = feature.properties.legend;
    if (featureLegend && featureLegend !== 'ML') legends.push(featureLegend);
    const linesProp = feature.properties.lines || '';
    for (const [lineName, code] of Object.entries(LINE_NAME_TO_LEGEND_STATION)) {
      if (linesProp.includes(lineName) && !legends.includes(code)) legends.push(code);
    }

    segments.push({
      nameA: match[1].trim(),
      nameB: match[2].trim(),
      start: line[0],
      end: line[line.length - 1],
      legends,
    });
  }

  // Map each unique endpoint coordinate to the segment indices that use it
  const endpointMap = new Map();
  for (let i = 0; i < segments.length; i++) {
    for (const pt of [segments[i].start, segments[i].end]) {
      const key = coordKey(pt);
      if (!endpointMap.has(key)) endpointMap.set(key, []);
      endpointMap.get(key).push(i);
    }
  }

  // --- Step 2: resolve station coordinates via shared endpoints ---
  // stationCoord: stationName → [lon, lat]
  const stationCoord = new Map();
  // stationLegends: stationName → Set of legend codes
  const stationLegends = new Map();

  const recordStation = (name, coord, legends) => {
    if (isInfrastructureName(name)) return;
    if (!stationCoord.has(name)) {
      stationCoord.set(name, coord);
      stationLegends.set(name, new Set(legends));
    } else {
      for (const l of legends) stationLegends.get(name).add(l);
    }
  };

  // Pass 1: where two segments share an endpoint, the station name common
  // to both segments' descriptions is located at that coordinate.
  for (const [, segIndices] of endpointMap) {
    if (segIndices.length < 2) continue;
    for (let i = 0; i < segIndices.length; i++) {
      for (let j = i + 1; j < segIndices.length; j++) {
        const si = segments[segIndices[i]];
        const sj = segments[segIndices[j]];
        const namesI = [si.nameA, si.nameB];
        const namesJ = new Set([sj.nameA, sj.nameB]);
        // Find the shared coordinate between these two segments
        let sharedCoord = null;
        for (const ptI of [si.start, si.end]) {
          for (const ptJ of [sj.start, sj.end]) {
            if (coordKey(ptI) === coordKey(ptJ)) { sharedCoord = ptI; break; }
          }
          if (sharedCoord) break;
        }
        if (!sharedCoord) continue;
        for (const name of namesI) {
          if (namesJ.has(name)) {
            recordStation(name, sharedCoord, [...si.legends, ...sj.legends]);
          }
        }
      }
    }
  }

  // Pass 2: terminal stations — the endpoint NOT shared with any other
  // segment is the terminal station's coordinate.
  const terminusNames = new Set();
  for (const seg of segments) {
    for (const name of [seg.nameA, seg.nameB]) {
      if (stationCoord.has(name) || isInfrastructureName(name)) continue;
      const startShared = endpointMap.get(coordKey(seg.start)).length > 1;
      const endShared = endpointMap.get(coordKey(seg.end)).length > 1;
      if (startShared && !endShared) { recordStation(name, seg.end, seg.legends); terminusNames.add(name); }
      else if (endShared && !startShared) { recordStation(name, seg.start, seg.legends); terminusNames.add(name); }
    }
  }

  return Array.from(stationCoord.entries()).map(([name, coord]) => ({
    name: displayStationName(name),
    lon: coord[0],
    lat: coord[1],
    legends: Array.from(stationLegends.get(name)),
    isTerminus: terminusNames.has(name),
  }));
}

/**
 * For each line, walks to both dead-end terminals using ownSegments and returns
 * their positions as { legend: [{lon, lat}, {lon, lat}] }.
 * Used to detect when a train is at a line terminus for arrow hiding.
 *
 * Loop-entry points (e.g. Clark/Lake for Orange) are dead-ends in ownSegments
 * but not in fullSegments, because ML segments extend from them.  We cross-
 * reference with fullSegments so only genuine dead-ends are returned.
 */
function buildLineTerminals(ownSegments, fullSegments) {
  const result = {};
  for (const [legend, segs] of Object.entries(ownSegments)) {
    if (!segs || segs.length === 0 || segs[0].length === 0) continue;
    const startCoord = segs[0][0];
    const startPos = snapToTrackPosition(startCoord[0], startCoord[1], segs);
    const endA = advanceOnTrack(startPos, 9999, -1, segs);
    const endB = advanceOnTrack(startPos, 9999, +1, segs);

    const fullSegs = fullSegments && fullSegments[legend];
    result[legend] = [endA, endB].filter(t => {
      if (!t.stopped) return false;
      if (!fullSegs) return true;
      // A real terminus is also a dead-end in the full segment array.
      // A loop-entry point continues into ML segments in fullSegs, so
      // a tiny advance in at least one direction will NOT stop there.
      const fullPos = snapToTrackPosition(t.lon, t.lat, fullSegs);
      const fwd = advanceOnTrack(fullPos, 1e-6, +1, fullSegs);
      const bwd = advanceOnTrack(fullPos, 1e-6, -1, fullSegs);
      return fwd.stopped || bwd.stopped;
    });
  }
  return result;
}
