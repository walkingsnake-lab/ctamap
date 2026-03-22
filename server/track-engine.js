/**
 * Server-side port of the pure geometry and direction inference functions.
 * Source: js/path-follow.js and js/trains.js (pure functions only — no DOM).
 * Keep in sync with those files when logic changes.
 */
'use strict';

const C = require('./shared-config');

// ---- Basic geometry ----

function geoDist(lon1, lat1, lon2, lat2) {
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  return Math.sqrt(dx * dx + dy * dy);
}

function geoDistSq(lon1, lat1, lon2, lat2) {
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  return dx * dx + dy * dy;
}

// ---- Line segment building ----

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

function buildLineSegments(geojson) {
  const legendToLineName = {};
  for (const [name, code] of Object.entries(C.LINE_NAME_TO_LEGEND_STATION)) {
    legendToLineName[code] = name;
  }

  const segments    = {};
  const ownSegments = {};

  for (const legend of Object.keys(C.LINE_COLORS)) {
    if (legend === 'ML') continue;
    const coords = collectLineCoords(geojson, legend);
    ownSegments[legend] = coords;

    const lineName = legendToLineName[legend];
    const sharedCoords = lineName ? collectSharedCoordsForLine(geojson, lineName, legend) : [];

    if (C.LOOP_LINE_CODES.includes(legend)) {
      const mlCoords = collectMLCoordsForLine(geojson, lineName);
      segments[legend] = coords.concat(sharedCoords).concat(mlCoords);
    } else {
      segments[legend] = coords.concat(sharedCoords);
    }
  }

  for (const legend of Object.keys(segments)) {
    for (const seg of segments[legend]) {
      seg._lens = new Float32Array(Math.max(0, seg.length - 1));
      for (let i = 0; i < seg.length - 1; i++) {
        const dx = seg[i + 1][0] - seg[i][0];
        const dy = seg[i + 1][1] - seg[i][1];
        seg._lens[i] = Math.sqrt(dx * dx + dy * dy);
      }
    }
  }

  return { segments, ownSegments };
}

// ---- Snapping ----

function snapToTrackPosition(lon, lat, segments) {
  let bestDist = Infinity;
  let best = { segIdx: 0, ptIdx: 0, t: 0, lon, lat };
  const EARLY_EXIT_SQ = 3.6e-9;

  outer: for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    for (let i = 0; i < seg.length - 1; i++) {
      const ax = seg[i][0], ay = seg[i][1];
      const bx = seg[i + 1][0], by = seg[i + 1][1];
      const dx = bx - ax, dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = 0;
      if (lenSq > 0) {
        t = ((lon - ax) * dx + (lat - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
      }
      const px = ax + t * dx, py = ay + t * dy;
      const dist = (lon - px) * (lon - px) + (lat - py) * (lat - py);
      if (dist < bestDist) {
        bestDist = dist;
        best = { segIdx: s, ptIdx: i, t, lon: px, lat: py };
        if (bestDist < EARLY_EXIT_SQ) break outer;
      }
    }
  }
  return best;
}

function buildSegmentNeighborMap(segments) {
  const threshold = C.SEGMENT_CONNECT_THRESHOLD;
  const threshSq  = threshold * threshold;
  const map = new Map();
  for (let i = 0; i < segments.length; i++) map.set(i, new Set());
  for (let i = 0; i < segments.length; i++) {
    const si = segments[i];
    if (si.length < 2) continue;
    const iStart = si[0], iEnd = si[si.length - 1];
    for (let j = i + 1; j < segments.length; j++) {
      const sj = segments[j];
      if (sj.length < 2) continue;
      const jStart = sj[0], jEnd = sj[sj.length - 1];
      if (geoDistSq(iStart[0], iStart[1], jStart[0], jStart[1]) < threshSq ||
          geoDistSq(iStart[0], iStart[1], jEnd[0],   jEnd[1])   < threshSq ||
          geoDistSq(iEnd[0],   iEnd[1],   jStart[0], jStart[1]) < threshSq ||
          geoDistSq(iEnd[0],   iEnd[1],   jEnd[0],   jEnd[1])   < threshSq) {
        map.get(i).add(j);
        map.get(j).add(i);
      }
    }
  }
  return map;
}

function snapToTrackWithAffinity(lon, lat, segments, prevTrackPos, neighborMap) {
  if (!prevTrackPos || !neighborMap) {
    return snapToTrackPosition(lon, lat, segments);
  }

  const nearby = new Set();
  nearby.add(prevTrackPos.segIdx);
  const directNeighbors = neighborMap.get(prevTrackPos.segIdx);
  if (directNeighbors) {
    for (const n of directNeighbors) {
      nearby.add(n);
      const nn = neighborMap.get(n);
      if (nn) for (const n2 of nn) nearby.add(n2);
    }
  }

  let nearbyBestDist = Infinity;
  let nearbyBest = null;
  for (const s of nearby) {
    const seg = segments[s];
    if (!seg) continue;
    for (let i = 0; i < seg.length - 1; i++) {
      const ax = seg[i][0], ay = seg[i][1];
      const bx = seg[i + 1][0], by = seg[i + 1][1];
      const dx = bx - ax, dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = 0;
      if (lenSq > 0) {
        t = ((lon - ax) * dx + (lat - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
      }
      const px = ax + t * dx, py = ay + t * dy;
      const dist = (lon - px) * (lon - px) + (lat - py) * (lat - py);
      if (dist < nearbyBestDist) {
        nearbyBestDist = dist;
        nearbyBest = { segIdx: s, ptIdx: i, t, lon: px, lat: py };
      }
    }
  }

  const SNAP_SKIP_GLOBAL_SQ = 4e-8;
  if (nearbyBest && nearbyBestDist < SNAP_SKIP_GLOBAL_SQ) return nearbyBest;

  const globalBest = snapToTrackPosition(lon, lat, segments);
  const globalDist = (lon - globalBest.lon) * (lon - globalBest.lon) +
                     (lat - globalBest.lat) * (lat - globalBest.lat);
  if (nearbyBest && nearbyBestDist < globalDist * C.SNAP_AFFINITY_MARGIN) return nearbyBest;
  return globalBest;
}

// ---- Track advancement ----

function findConnectedSegment(curSegIdx, boundaryPtIdx, curSeg, direction, segments, targetLon, targetLat, neighborMap) {
  const bx = curSeg[boundaryPtIdx][0];
  const by = curSeg[boundaryPtIdx][1];
  const threshold = C.SEGMENT_CONNECT_THRESHOLD;
  const TIE_EPS   = threshold * 0.01;

  const prevIdx = direction > 0 ? boundaryPtIdx - 1 : boundaryPtIdx + 1;
  const arrDx = (prevIdx >= 0 && prevIdx < curSeg.length) ? bx - curSeg[prevIdx][0] : 0;
  const arrDy = (prevIdx >= 0 && prevIdx < curSeg.length) ? by - curSeg[prevIdx][1] : 0;

  const hasTarget = targetLon !== undefined && targetLat !== undefined;
  const toTargetDx = hasTarget ? targetLon - bx : 0;
  const toTargetDy = hasTarget ? targetLat - by : 0;
  const arrMagSq = arrDx * arrDx + arrDy * arrDy;
  const tarMagSq = toTargetDx * toTargetDx + toTargetDy * toTargetDy;
  const rawDot   = arrDx * toTargetDx + arrDy * toTargetDy;
  const targetIsAhead = hasTarget && arrMagSq > 0 && tarMagSq > 0
    && (rawDot >= 0 || rawDot * rawDot < 0.0625 * arrMagSq * tarMagSq);

  let bestDist = Infinity, bestDot = -Infinity, bestResult = null;

  const candidates = neighborMap ? neighborMap.get(curSegIdx) : null;
  const iterate = candidates
    ? (fn) => { for (const s of candidates) fn(s); }
    : (fn) => { for (let s = 0; s < segments.length; s++) fn(s); };

  iterate((s) => {
    if (s === curSegIdx) return;
    const seg = segments[s];
    if (!seg || seg.length < 2) return;

    const d0 = geoDist(bx, by, seg[0][0], seg[0][1]);
    if (d0 < threshold) {
      const exitDx = seg[1][0] - seg[0][0];
      const exitDy = seg[1][1] - seg[0][1];
      const dot = targetIsAhead
        ? exitDx * toTargetDx + exitDy * toTargetDy
        : arrDx * exitDx + arrDy * exitDy;
      if (d0 < bestDist - TIE_EPS || (d0 < bestDist + TIE_EPS && dot > bestDot)) {
        bestDist = d0; bestDot = dot;
        bestResult = { segIdx: s, ptIdx: 0, t: 0, direction: 1 };
      }
    }

    const last = seg.length - 1;
    const dN = geoDist(bx, by, seg[last][0], seg[last][1]);
    if (dN < threshold) {
      const exitDx = seg[last - 1][0] - seg[last][0];
      const exitDy = seg[last - 1][1] - seg[last][1];
      const dot = targetIsAhead
        ? exitDx * toTargetDx + exitDy * toTargetDy
        : arrDx * exitDx + arrDy * exitDy;
      if (dN < bestDist - TIE_EPS || (dN < bestDist + TIE_EPS && dot > bestDot)) {
        bestDist = dN; bestDot = dot;
        bestResult = { segIdx: s, ptIdx: last - 1, t: 1, direction: -1 };
      }
    }
  });

  return bestResult;
}

function advanceOnTrack(trackPos, distanceDeg, direction, segments, opts) {
  let { segIdx, ptIdx, t } = trackPos;
  let remaining = distanceDeg;
  let dir = direction;
  const seg = segments[segIdx];
  const tLon = opts?.targetLon, tLat = opts?.targetLat;
  const neighborMap = opts?.neighborMap ?? null;

  if (!seg) return { ...trackPos, direction: dir, stopped: true };

  let iter = 0;
  let curSeg = seg;
  let lensArray = curSeg._lens ?? null;

  while (remaining > 0 && ++iter < C.ADVANCE_MAX_ITER) {
    if (!curSeg) break;

    const i = ptIdx;
    if (i < 0 || i >= curSeg.length - 1) break;

    const ax = curSeg[i][0], ay = curSeg[i][1];
    const bx = curSeg[i + 1][0], by = curSeg[i + 1][1];
    const edgeLen = lensArray ? lensArray[i] : geoDist(ax, ay, bx, by);

    if (edgeLen < 1e-10) {
      if (dir > 0) {
        ptIdx++; t = 0;
        if (ptIdx >= curSeg.length - 1) {
          const next = findConnectedSegment(segIdx, ptIdx, curSeg, dir, segments, tLon, tLat, neighborMap);
          if (!next) return { segIdx, ptIdx: curSeg.length - 2, t: 1, lon: bx, lat: by, direction: dir, stopped: true };
          segIdx = next.segIdx; ptIdx = next.ptIdx; t = next.t; dir = next.direction;
          curSeg = segments[segIdx]; lensArray = curSeg?._lens ?? null;
        }
      } else {
        ptIdx--; t = 1;
        if (ptIdx < 0) {
          const next = findConnectedSegment(segIdx, 0, curSeg, dir, segments, tLon, tLat, neighborMap);
          if (!next) return { segIdx, ptIdx: 0, t: 0, lon: ax, lat: ay, direction: dir, stopped: true };
          segIdx = next.segIdx; ptIdx = next.ptIdx; t = next.t; dir = next.direction;
          curSeg = segments[segIdx]; lensArray = curSeg?._lens ?? null;
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
        ptIdx++; t = 0;
        if (ptIdx >= curSeg.length - 1) {
          const next = findConnectedSegment(segIdx, curSeg.length - 1, curSeg, dir, segments, tLon, tLat, neighborMap);
          if (!next) {
            const last = curSeg[curSeg.length - 1];
            return { segIdx, ptIdx: curSeg.length - 2, t: 1, lon: last[0], lat: last[1], direction: dir, stopped: true };
          }
          segIdx = next.segIdx; ptIdx = next.ptIdx; t = next.t; dir = next.direction;
          curSeg = segments[segIdx]; lensArray = curSeg?._lens ?? null;
        }
      }
    } else {
      const distToEdgeStart = t * edgeLen;
      if (remaining <= distToEdgeStart) {
        t -= remaining / edgeLen;
        remaining = 0;
      } else {
        remaining -= distToEdgeStart;
        ptIdx--; t = 1;
        if (ptIdx < 0) {
          const next = findConnectedSegment(segIdx, 0, curSeg, dir, segments, tLon, tLat, neighborMap);
          if (!next) {
            const first = curSeg[0];
            return { segIdx, ptIdx: 0, t: 0, lon: first[0], lat: first[1], direction: dir, stopped: true };
          }
          segIdx = next.segIdx; ptIdx = next.ptIdx; t = next.t; dir = next.direction;
          curSeg = segments[segIdx]; lensArray = curSeg?._lens ?? null;
        }
      }
    }
  }

  const finalSeg = segments[segIdx];
  if (!finalSeg || ptIdx < 0 || ptIdx >= finalSeg.length - 1) {
    return { ...trackPos, direction: dir, stopped: true };
  }
  const ax = finalSeg[ptIdx][0], ay = finalSeg[ptIdx][1];
  const bx = finalSeg[ptIdx + 1][0], by = finalSeg[ptIdx + 1][1];
  return { segIdx, ptIdx, t, lon: ax + t * (bx - ax), lat: ay + t * (by - ay), direction: dir, stopped: false };
}

function trackDistanceBetween(from, to, direction, segments) {
  const straightDist = geoDist(from.lon, from.lat, to.lon, to.lat);
  if (straightDist < 1e-7) return 0;
  const step = Math.max(straightDist / 40, 1e-5);
  let pos = from, totalDist = 0, minDistToTarget = straightDist;
  const targetHint = { targetLon: to.lon, targetLat: to.lat };
  for (let i = 0; i < 2000; i++) {
    const newPos = advanceOnTrack(pos, step, direction, segments, targetHint);
    totalDist += step;
    const distToTarget = geoDist(newPos.lon, newPos.lat, to.lon, to.lat);
    if (distToTarget < step * 0.5) return totalDist + distToTarget;
    if (distToTarget < minDistToTarget) minDistToTarget = distToTarget;
    const cornerSlack = Math.max(step * 2, 0.002);
    if (distToTarget > minDistToTarget + cornerSlack) return straightDist;
    if (newPos.stopped) return totalDist + distToTarget;
    pos = newPos;
  }
  return straightDist;
}

function directionFromHeading(heading, segIdx, ptIdx, segments) {
  const seg = segments[segIdx];
  if (!seg || ptIdx >= seg.length - 1) return 1;
  const dx = seg[ptIdx + 1][0] - seg[ptIdx][0];
  const dy = seg[ptIdx + 1][1] - seg[ptIdx][1];
  const hRad = (heading * Math.PI) / 180;
  const hx = Math.sin(hRad), hy = Math.cos(hRad);
  return (dx * hx + dy * hy) >= 0 ? 1 : -1;
}

// ---- Terminals ----

function buildLineTerminals(ownSegments, fullSegments) {
  const result = {};
  for (const [legend, segs] of Object.entries(ownSegments)) {
    const terminals = [];
    for (const seg of segs) {
      if (!seg || seg.length < 2) continue;
      const start = seg[0];
      const end   = seg[seg.length - 1];
      // A point is a terminal if it is not shared with any other segment
      const startShared = segs.some(s => s !== seg && (
        geoDistSq(s[0][0], s[0][1], start[0], start[1]) < 1e-10 ||
        geoDistSq(s[s.length-1][0], s[s.length-1][1], start[0], start[1]) < 1e-10
      ));
      const endShared = segs.some(s => s !== seg && (
        geoDistSq(s[0][0], s[0][1], end[0], end[1]) < 1e-10 ||
        geoDistSq(s[s.length-1][0], s[s.length-1][1], end[0], end[1]) < 1e-10
      ));
      if (!startShared) terminals.push({ lon: start[0], lat: start[1] });
      if (!endShared)   terminals.push({ lon: end[0],   lat: end[1]   });
    }
    result[legend] = terminals;
  }
  return result;
}

// ---- Stations ----

function isInfrastructureName(name) {
  return /\b(junction|connector|tower|portal|yard|interlocking|wye)\b/i.test(name);
}

function displayStationName(name) {
  for (const suffix of C.BRANCH_SUFFIXES) {
    if (name.endsWith('-' + suffix)) {
      return C.cleanStationName(name.slice(0, -(suffix.length + 1)));
    }
  }
  return C.cleanStationName(name);
}

function buildUniqueStations(geojson) {
  const coordKey = (c) => c[0].toFixed(10) + ',' + c[1].toFixed(10);

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
    for (const [lineName, code] of Object.entries(C.LINE_NAME_TO_LEGEND_STATION)) {
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

  const endpointMap = new Map();
  for (let i = 0; i < segments.length; i++) {
    for (const pt of [segments[i].start, segments[i].end]) {
      const key = coordKey(pt);
      if (!endpointMap.has(key)) endpointMap.set(key, []);
      endpointMap.get(key).push(i);
    }
  }

  const stationCoord   = new Map();
  const stationLegends = new Map();

  const recordStation = (name, coord, legs) => {
    if (isInfrastructureName(name)) return;
    if (!stationCoord.has(name)) {
      stationCoord.set(name, coord);
      stationLegends.set(name, new Set(legs));
    } else {
      for (const l of legs) stationLegends.get(name).add(l);
    }
  };

  for (const [, segIndices] of endpointMap) {
    if (segIndices.length < 2) continue;
    for (let i = 0; i < segIndices.length; i++) {
      for (let j = i + 1; j < segIndices.length; j++) {
        const si = segments[segIndices[i]];
        const sj = segments[segIndices[j]];
        const namesI = [si.nameA, si.nameB];
        const namesJ = new Set([sj.nameA, sj.nameB]);
        let sharedCoord = null;
        for (const ptI of [si.start, si.end]) {
          for (const ptJ of [sj.start, sj.end]) {
            if (coordKey(ptI) === coordKey(ptJ)) { sharedCoord = ptI; break; }
          }
          if (sharedCoord) break;
        }
        if (!sharedCoord) continue;
        for (const name of namesI) {
          if (namesJ.has(name)) recordStation(name, sharedCoord, [...si.legends, ...sj.legends]);
        }
      }
    }
  }

  const terminusNames = new Set();
  for (const seg of segments) {
    for (const name of [seg.nameA, seg.nameB]) {
      if (stationCoord.has(name) || isInfrastructureName(name)) continue;
      const startShared = endpointMap.get(coordKey(seg.start)).length > 1;
      const endShared   = endpointMap.get(coordKey(seg.end)).length > 1;
      if (startShared && !endShared)  { recordStation(name, seg.end,   seg.legends); terminusNames.add(name); }
      else if (endShared && !startShared) { recordStation(name, seg.start, seg.legends); terminusNames.add(name); }
    }
  }

  const stations = Array.from(stationCoord.entries()).map(([name, coord]) => ({
    name: displayStationName(name),
    lon: coord[0],
    lat: coord[1],
    legends: Array.from(stationLegends.get(name)),
    isTerminus: terminusNames.has(name),
  }));

  stations._index = buildStationIndex(stations);
  return stations;
}

function buildStationIndex(stations) {
  const CELL = 0.01;
  const cells = new Map();
  for (const s of stations) {
    const cx = Math.floor(s.lon / CELL);
    const cy = Math.floor(s.lat / CELL);
    const k = cx + ',' + cy;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(s);
  }
  return { cells, CELL };
}

// ---- Station lookups ----

function nearestStationName(lon, lat, stations, legend) {
  const idx = stations._index;
  if (!idx) {
    let bestName = null, bestDist = Infinity;
    for (const s of stations) {
      if (legend && !s.legends.includes(legend)) continue;
      const d = geoDist(lon, lat, s.lon, s.lat);
      if (d < bestDist) { bestDist = d; bestName = s.name; }
    }
    return bestName;
  }
  const { cells, CELL } = idx;
  const cx0 = Math.floor(lon / CELL);
  const cy0 = Math.floor(lat / CELL);
  let bestName = null, bestDist = Infinity;
  for (let r = 0; r <= 60; r++) {
    if (r > 0 && bestDist < (r - 1) * CELL) break;
    for (let dcx = -r; dcx <= r; dcx++) {
      for (let dcy = -r; dcy <= r; dcy++) {
        if (Math.abs(dcx) !== r && Math.abs(dcy) !== r) continue;
        const bucket = cells.get((cx0 + dcx) + ',' + (cy0 + dcy));
        if (!bucket) continue;
        for (const s of bucket) {
          if (legend && !s.legends.includes(legend)) continue;
          const d = geoDist(lon, lat, s.lon, s.lat);
          if (d < bestDist) { bestDist = d; bestName = s.name; }
        }
      }
    }
  }
  return bestName;
}

function nearestStationWithinRadius(lon, lat, stations, legend, radius) {
  const idx = stations._index;
  if (!idx) {
    let bestName = null, bestDist = Infinity;
    for (const s of stations) {
      if (legend && !s.legends.includes(legend)) continue;
      const d = geoDist(lon, lat, s.lon, s.lat);
      if (d < bestDist) { bestDist = d; bestName = s.name; }
    }
    return bestDist < radius ? bestName : null;
  }
  const { cells, CELL } = idx;
  const cx0 = Math.floor(lon / CELL);
  const cy0 = Math.floor(lat / CELL);
  const cellR = Math.ceil(radius / CELL);
  let bestName = null, bestDist = radius;
  for (let dcx = -cellR; dcx <= cellR; dcx++) {
    for (let dcy = -cellR; dcy <= cellR; dcy++) {
      const bucket = cells.get((cx0 + dcx) + ',' + (cy0 + dcy));
      if (!bucket) continue;
      for (const s of bucket) {
        if (legend && !s.legends.includes(legend)) continue;
        const d = geoDist(lon, lat, s.lon, s.lat);
        if (d < bestDist) { bestDist = d; bestName = s.name; }
      }
    }
  }
  return bestName;
}

// ---- Phantom jump detection ----

function matchesKnownPhantomJump(legend, prevLon, prevLat, newLon, newLat, stations) {
  const rules = C.PHANTOM_JUMP_BY_LEGEND.get(legend);
  if (!rules) return null;
  for (const rule of rules) {
    const prevStation = nearestStationName(prevLon, prevLat, stations, legend);
    const newStation  = nearestStationName(newLon, newLat, stations, legend);
    if (!prevStation || !newStation) continue;
    const fromMatch = rule.fromStations.some(s => prevStation === s) &&
      stations.some(s => s.name === prevStation && geoDist(prevLon, prevLat, s.lon, s.lat) < C.PHANTOM_STATION_RADIUS);
    const toMatch = rule.toStations.some(s => newStation === s) &&
      stations.some(s => s.name === newStation && geoDist(newLon, newLat, s.lon, s.lat) < C.PHANTOM_STATION_RADIUS);
    if (fromMatch && toMatch) return rule;
  }
  return null;
}

// ---- Direction inference ----

function directionByNextStation(trackPos, nextStn, segs, neighborMap) {
  const curDist  = geoDist(trackPos.lon, trackPos.lat, nextStn.lon, nextStn.lat);
  const probeDist = Math.min(C.PROBE_DIST, Math.max(curDist * 0.9, 1e-5));
  const target = { targetLon: nextStn.lon, targetLat: nextStn.lat, neighborMap };
  const probeFwd = advanceOnTrack(trackPos, probeDist, +1, segs, target);
  const probeBwd = advanceOnTrack(trackPos, probeDist, -1, segs, target);
  const fwdDist  = geoDist(probeFwd.lon, probeFwd.lat, nextStn.lon, nextStn.lat);
  const bwdDist  = geoDist(probeBwd.lon, probeBwd.lat, nextStn.lon, nextStn.lat);
  if (fwdDist < bwdDist && fwdDist < curDist) return 1;
  if (bwdDist < fwdDist && bwdDist < curDist) return -1;
  return null;
}

function directionByTerminalWalk(trackPos, destNm, northDest, segs, neighborMap) {
  const nmOpts = neighborMap ? { neighborMap } : undefined;
  const termFwd = advanceOnTrack(trackPos, 9999, +1, segs, nmOpts);
  const termBwd = advanceOnTrack(trackPos, 9999, -1, segs, nmOpts);
  if (!termFwd.stopped && !termBwd.stopped) return null;
  const destIsNorth = destNm.includes(northDest);
  if (termFwd.stopped && termBwd.stopped) {
    const northIsForward  = termFwd.lat > trackPos.lat;
    const northIsBackward = termBwd.lat > trackPos.lat;
    if (northIsForward === northIsBackward) {
      const seg = segs[trackPos.segIdx];
      const pi = Math.min(trackPos.ptIdx, seg ? seg.length - 2 : 0);
      if (seg && pi >= 0) {
        const dy = seg[pi + 1][1] - seg[pi][1];
        const dx = seg[pi + 1][0] - seg[pi][0];
        if (Math.abs(dy) > Math.abs(dx) * 0.2) {
          return (destIsNorth === (dy > 0)) ? 1 : -1;
        }
      }
      const probeFwd = advanceOnTrack(trackPos, 0.01, +1, segs, nmOpts);
      const probeBwd = advanceOnTrack(trackPos, 0.01, -1, segs, nmOpts);
      const dLatFwd  = probeFwd.lat - trackPos.lat;
      const dLatBwd  = probeBwd.lat - trackPos.lat;
      if (dLatFwd * dLatBwd < 0) {
        return (destIsNorth === (dLatFwd > dLatBwd)) ? 1 : -1;
      }
      return null;
    }
    return (destIsNorth === northIsForward) ? 1 : -1;
  }
  if (termFwd.stopped) {
    const northIsForward = termFwd.lat > trackPos.lat;
    return (destIsNorth === northIsForward) ? 1 : -1;
  }
  const northIsBackward = termBwd.lat > trackPos.lat;
  return (destIsNorth === !northIsBackward) ? 1 : -1;
}

function findNextStation(train, stations) {
  if (!train.nextStaNm || !stations) return null;
  const nextClean = C.cleanStationName(train.nextStaNm);
  for (const s of stations) {
    if (s.legends.includes(train.legend) && C.cleanStationName(s.name) === nextClean) return s;
  }
  const nextNorm = C.normalizeStationName(nextClean);
  for (const s of stations) {
    if (s.legends.includes(train.legend) && C.normalizeStationName(s.name) === nextNorm) return s;
  }
  return null;
}

function effectiveDestForDirection(train, northDest, stations) {
  if (!northDest) return train.destNm;
  const LOOP_DEST_LINE_SET = new Set(['BR', 'OR', 'PK', 'PR']);
  if (!LOOP_DEST_LINE_SET.has(train.legend)) return train.destNm;
  if (!train.destNm) return train.destNm;

  if (train.destNm.includes('Loop')) {
    const nextStnLF = findNextStation(train, stations);
    if (nextStnLF) {
      const tDistLF = geoDist(train.lon, train.lat, C.LOOP_CENTER.lon, C.LOOP_CENTER.lat);
      const nDistLF = geoDist(nextStnLF.lon, nextStnLF.lat, C.LOOP_CENTER.lon, C.LOOP_CENTER.lat);
      if (nDistLF > tDistLF + 0.002) {
        console.log(`[CTA] Dest override: rn=${train.rn} (${train.legend}) destNm="${train.destNm}" but nextStaNm="${train.nextStaNm}" is farther from Loop — late flip, treating as outbound`);
        return 'OUTBOUND';
      }
    }
    return train.destNm;
  }

  const nextStn = findNextStation(train, stations);
  if (!nextStn) return train.destNm;

  const trainToNextStn    = geoDist(train.lon, train.lat, nextStn.lon, nextStn.lat);
  const trainDistToLoop   = geoDist(train.lon, train.lat, C.LOOP_CENTER.lon, C.LOOP_CENTER.lat);
  const nextStnDistToLoop = geoDist(nextStn.lon, nextStn.lat, C.LOOP_CENTER.lon, C.LOOP_CENTER.lat);

  if (trainToNextStn < 0.001) {
    if (nextStnDistToLoop <= 0.014) return train.destNm;
    if (trainDistToLoop >= C.LOOP_INNER_RADIUS && trainDistToLoop < 0.025) {
      console.log(`[CTA] Dest override: rn=${train.rn} (${train.legend}) destNm="${train.destNm}" but nextStaNm="${train.nextStaNm}" appears stale at approach station (dist-to-loop=${trainDistToLoop.toFixed(4)}) — using "Loop"`);
      return 'Loop';
    }
    return train.destNm;
  }
  if (trainDistToLoop < C.LOOP_INNER_RADIUS) {
    console.log(`[CTA] Inside Loop: rn=${train.rn} (${train.legend}) trusting destNm="${train.destNm}" (dist-to-loop=${trainDistToLoop.toFixed(4)})`);
    return train.destNm;
  }
  if (nextStnDistToLoop < trainDistToLoop) {
    if (trainDistToLoop > 0.05) return train.destNm;
    console.log(`[CTA] Dest override: rn=${train.rn} (${train.legend}) destNm="${train.destNm}" but nextStaNm="${train.nextStaNm}" is closer to Loop — using "Loop" for direction`);
    return 'Loop';
  }
  return train.destNm;
}

module.exports = {
  geoDist,
  geoDistSq,
  buildLineSegments,
  buildSegmentNeighborMap,
  snapToTrackPosition,
  snapToTrackWithAffinity,
  advanceOnTrack,
  findConnectedSegment,
  trackDistanceBetween,
  directionFromHeading,
  buildLineTerminals,
  buildUniqueStations,
  nearestStationName,
  nearestStationWithinRadius,
  matchesKnownPhantomJump,
  directionByNextStation,
  directionByTerminalWalk,
  findNextStation,
  effectiveDestForDirection,
};
