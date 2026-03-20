/**
 * ETA-based train position engine.
 *
 * Positions trains purely from ETA data: nextStaNm, isApp, destNm.
 * No GPS coordinates are used for positioning or direction — only ETA fields.
 *
 * Model:
 *   - Each train is always "between two stations" in a known sequence.
 *   - Progress (0→1) advances over estimated travel time.
 *   - isApp="1" triggers a faster final approach to the station.
 *   - When nextStaNm changes, direction updates from index progression.
 *   - If nextStaNm is missing, train is marked for GPS fallback.
 *
 * Depends on: config.js, path-follow.js (loaded before this file)
 */

// ---- Station sequences ----

const CTA_STATION_ORDERS = {
  // Red Line: Howard → 95th/Dan Ryan
  RD: [
    'Howard', 'Jarvis', 'Morse', 'Loyola', 'Granville', 'Thorndale',
    'Bryn Mawr', 'Berwyn', 'Argyle', 'Lawrence', 'Wilson', 'Sheridan',
    'Addison', 'Belmont', 'Fullerton', 'North/Clybourn', 'Clark/Division',
    'Chicago', 'Grand', 'Lake', 'Monroe', 'Jackson', 'Harrison',
    'Roosevelt', 'Cermak-Chinatown', 'Sox-35th', '47th', 'Garfield',
    '63rd', '69th', '79th', '87th', '95th/Dan Ryan',
  ],

  // Blue Line: O'Hare → Forest Park
  BL: [
    "O'Hare", 'Rosemont', 'Cumberland', 'Harlem', 'Jefferson Park',
    'Montrose', 'Irving Park', 'Addison', 'Belmont', 'Logan Square',
    'California', 'Western', 'Damen', 'Division', 'Chicago', 'Grand',
    'Clark/Lake', 'Washington', 'Monroe', 'Jackson', 'LaSalle',
    'Clinton', 'UIC-Halsted', 'Racine', 'Illinois Medical District',
    'Western', 'Kedzie-Homan', 'Pulaski', 'Cicero', 'Austin',
    'Oak Park', 'Harlem', 'Forest Park',
  ],

  // Brown Line: Kimball → Loop
  BR: [
    'Kimball', 'Kedzie', 'Francisco', 'Rockwell', 'Western', 'Damen',
    'Montrose', 'Irving Park', 'Addison', 'Paulina', 'Southport',
    'Belmont', 'Wellington', 'Diversey', 'Fullerton', 'Armitage',
    'Sedgwick', 'Chicago', 'Merchandise Mart',
    'Washington/Wells', 'Quincy', 'LaSalle/Van Buren', 'Library',
    'Adams/Wabash', 'Washington/Wabash', 'State/Lake', 'Clark/Lake',
  ],

  // Green Line: Harlem/Lake → Ashland/63rd (main branch)
  GR: [
    'Harlem', 'Oak Park', 'Ridgeland', 'Austin', 'Central',
    'Laramie', 'Cicero', 'Pulaski', 'Conservatory-Central Park',
    'Kedzie', 'California', 'Damen', 'Ashland', 'Morgan', 'Clinton',
    'Clark/Lake', 'State/Lake', 'Washington/Wabash', 'Adams/Wabash',
    'Roosevelt',
    'Cermak-McCormick Place', '35-Bronzeville-IIT', 'Indiana',
    '43rd', '47th', '51st', 'Garfield',
    'Halsted', 'Ashland/63rd',
  ],

  // Green Line: Harlem/Lake → Cottage Grove
  GR_CG: [
    'Harlem', 'Oak Park', 'Ridgeland', 'Austin', 'Central',
    'Laramie', 'Cicero', 'Pulaski', 'Conservatory-Central Park',
    'Kedzie', 'California', 'Damen', 'Ashland', 'Morgan', 'Clinton',
    'Clark/Lake', 'State/Lake', 'Washington/Wabash', 'Adams/Wabash',
    'Roosevelt',
    'Cermak-McCormick Place', '35-Bronzeville-IIT', 'Indiana',
    '43rd', '47th', '51st', 'Garfield',
    'King Drive', 'Cottage Grove',
  ],

  // Orange Line: Midway → Loop
  OR: [
    'Midway', 'Pulaski', 'Kedzie', 'Western', '35th/Archer',
    'Ashland', 'Halsted', 'Roosevelt',
    'Library', 'LaSalle/Van Buren', 'Quincy', 'Washington/Wells',
    'Clark/Lake', 'State/Lake', 'Washington/Wabash', 'Adams/Wabash',
  ],

  // Pink Line: 54th/Cermak → Loop
  PK: [
    '54th/Cermak', 'Cicero', 'Kostner', 'Pulaski', 'Central Park',
    'Kedzie', 'California', 'Western', 'Damen', '18th', 'Polk',
    'Ashland', 'Morgan', 'Clinton',
    'Clark/Lake', 'State/Lake', 'Washington/Wabash', 'Adams/Wabash',
    'Library', 'LaSalle/Van Buren', 'Quincy', 'Washington/Wells',
  ],

  // Purple Line: Linden → Howard → Loop (Express)
  PR: [
    'Linden', 'Central', 'Noyes', 'Foster', 'Davis', 'Dempster',
    'Main', 'South Blvd', 'Howard',
    'Jarvis', 'Morse', 'Loyola', 'Granville', 'Thorndale',
    'Bryn Mawr', 'Berwyn', 'Argyle', 'Lawrence', 'Wilson',
    'Sheridan', 'Addison', 'Belmont', 'Wellington', 'Diversey',
    'Fullerton', 'Armitage', 'Sedgwick', 'Chicago', 'Merchandise Mart',
    'Washington/Wells', 'Quincy', 'LaSalle/Van Buren', 'Library',
    'Adams/Wabash', 'Washington/Wabash', 'State/Lake', 'Clark/Lake',
  ],

  // Yellow Line: Dempster-Skokie → Howard
  YL: [
    'Dempster-Skokie', 'Oakton-Skokie', 'Howard',
  ],
};

function getTrainSequence(legend, destNm, stationSequences) {
  if (legend === 'GR' && destNm) {
    const dest = destNm.toUpperCase();
    if (dest.includes('COTTAGE') || dest.includes('KING')) {
      return stationSequences['GR_CG'] || stationSequences['GR'];
    }
  }
  return stationSequences[legend] || null;
}

function buildStationSequences(lineSegments, stations, stationPositions) {
  const sequences = {};
  for (const [legend, names] of Object.entries(CTA_STATION_ORDERS)) {
    const segLegend = legend.replace(/_.*$/, '');
    const segs = lineSegments[segLegend];
    if (!segs || segs.length === 0) continue;

    const sequence = [];
    let cumulativeDist = 0;
    for (const name of names) {
      const coord = lookupStation(name, segLegend, stationPositions);
      if (!coord) {
        console.warn(`[ETA-AI] ${legend}: station "${name}" not found in GeoJSON`);
        continue;
      }
      const trackPos = snapToTrackPosition(coord[0], coord[1], segs);
      if (sequence.length > 0) {
        const prev = sequence[sequence.length - 1];
        cumulativeDist += geoDist(prev.lon, prev.lat, trackPos.lon, trackPos.lat);
      }
      sequence.push({ name, lon: trackPos.lon, lat: trackPos.lat, trackPos, distFromStart: cumulativeDist });
    }
    sequences[legend] = sequence;
  }
  for (const [legend, seq] of Object.entries(sequences)) {
    console.log(`[ETA-AI] ${legend}: ${seq.length} stations — ${seq.map(s => s.name).join(' → ')}`);
  }
  return sequences;
}

// ---- Track helpers ----

function resolveTrackWalkDir(fromPos, toPos, segs) {
  const probeDist = Math.max(geoDist(fromPos.lon, fromPos.lat, toPos.lon, toPos.lat) * 0.1, 1e-5);
  const fwd = advanceOnTrack(fromPos, probeDist, +1, segs, { targetLon: toPos.lon, targetLat: toPos.lat });
  const bwd = advanceOnTrack(fromPos, probeDist, -1, segs, { targetLon: toPos.lon, targetLat: toPos.lat });
  const fwdDist = geoDist(fwd.lon, fwd.lat, toPos.lon, toPos.lat);
  const bwdDist = geoDist(bwd.lon, bwd.lat, toPos.lon, toPos.lat);
  return fwdDist <= bwdDist ? +1 : -1;
}

// ---- Speed profiles ----

const LINE_SPEED_PROFILES = {
  BL: { cruiseMps: 25, overheadMs: 28000 },
  RD: { cruiseMps: 22, overheadMs: 30000 },
  GR: { cruiseMps: 20, overheadMs: 30000 },
  OR: { cruiseMps: 20, overheadMs: 30000 },
  YL: { cruiseMps: 20, overheadMs: 25000 },
  BR: { cruiseMps: 18, overheadMs: 32000 },
  PK: { cruiseMps: 18, overheadMs: 32000 },
  PR: { cruiseMps: 16, overheadMs: 30000 },
};
const LOOP_SPEED    = { cruiseMps: 14, overheadMs: 25000 };
const DEFAULT_SPEED = { cruiseMps: 20, overheadMs: 30000 };

const LOOP_STATION_NAMES = new Set([
  'Washington/Wells', 'Quincy', 'LaSalle/Van Buren', 'Library',
  'Adams/Wabash', 'Washington/Wabash', 'State/Lake', 'Clark/Lake',
]);

const LOOP_APPROACH_NAMES = new Set([
  'Sedgwick', 'Chicago', 'Merchandise Mart',  // Brown/Purple
  'Halsted', 'Roosevelt',                      // Orange
  'Ashland', 'Morgan', 'Clinton', 'Division',  // Pink/Green
]);

function getSegmentSpeed(legend, fromStation, toStation) {
  if (LOOP_STATION_NAMES.has(fromStation.name) || LOOP_STATION_NAMES.has(toStation.name)) return LOOP_SPEED;
  if (LOOP_LINE_CODES.includes(legend) &&
      (LOOP_APPROACH_NAMES.has(fromStation.name) || LOOP_APPROACH_NAMES.has(toStation.name))) return LOOP_SPEED;
  return LINE_SPEED_PROFILES[legend] || DEFAULT_SPEED;
}

function estimateTravelTime(fromStation, toStation, legend) {
  const dist = geoDist(fromStation.lon, fromStation.lat, toStation.lon, toStation.lat);
  const meters = dist * 111000;
  const speed = getSegmentSpeed(legend, fromStation, toStation);
  const ms = speed.overheadMs + (meters / speed.cruiseMps) * 1000;
  return Math.max(20000, Math.min(600000, ms));
}

// ---- Station lookup ----

function findStationInSequence(sequence, stationName, prevStationIdx) {
  if (!stationName || !sequence) return -1;
  const clean = cleanStationName(stationName);
  let norm = normalizeStationName(clean).replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');

  let firstExact = -1;
  for (let i = 0; i < sequence.length; i++) {
    const sNorm = normalizeStationName(sequence[i].name).replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');
    if (sNorm === norm) {
      if (firstExact === -1) firstExact = i;
      if (prevStationIdx !== undefined && i > prevStationIdx) return i;
    }
  }
  if (firstExact !== -1) return firstExact;

  let firstPartial = -1;
  for (let i = 0; i < sequence.length; i++) {
    const sNorm = normalizeStationName(sequence[i].name).replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');
    if (sNorm.includes(norm) || norm.includes(sNorm)) {
      if (firstPartial === -1) firstPartial = i;
      if (prevStationIdx !== undefined && i > prevStationIdx) return i;
    }
  }
  return firstPartial;
}

// ---- Direction inference (ETA-only) ----
// Direction is derived from destination name once at init, then from
// observed station index progression on every subsequent transition.
// GPS is never consulted.

function inferDirection(legend, destNm, sequence, nextIdx) {
  if (!destNm || !sequence || sequence.length < 2) return +1;

  // Direct lookup: if destination is in the sequence, direction points toward it
  const destIdx = findStationInSequence(sequence, destNm);
  if (destIdx !== -1 && nextIdx !== undefined) {
    if (destIdx > nextIdx) return +1;
    if (destIdx < nextIdx) return -1;
  }

  // Fallback: use LINE_NORTH_DESTS to determine which end is "north"
  const northDest = LINE_NORTH_DESTS[legend];
  if (northDest) {
    const destIsNorth = destNm.toUpperCase().includes(northDest.toUpperCase());
    const firstIsNorth = sequence[0].name.toUpperCase().includes(northDest.toUpperCase());
    const lastIsNorth  = sequence[sequence.length - 1].name.toUpperCase().includes(northDest.toUpperCase());
    if (destIsNorth) {
      if (firstIsNorth) return -1;
      if (lastIsNorth)  return +1;
      return LOOP_LINE_CODES.includes(legend) ? +1 : -1;
    } else {
      if (firstIsNorth) return +1;
      if (lastIsNorth)  return -1;
      return LOOP_LINE_CODES.includes(legend) ? -1 : +1;
    }
  }

  return +1;
}

// ---- ETA state machine ----

const etaTrainState = new Map();

function _seqKey(train) {
  if (train.legend === 'GR' && train.destNm) {
    const d = train.destNm.toUpperCase();
    if (d.includes('COTTAGE') || d.includes('KING')) return 'GR_CG';
  }
  return train.legend;
}

function _cacheSegment(sequence, prevIdx, nextIdx, segs) {
  const fromPos = sequence[prevIdx]?.trackPos;
  const toPos   = sequence[nextIdx]?.trackPos;
  if (!segs || !fromPos || !toPos) return { walkDir: null, trackDist: null };
  const walkDir  = resolveTrackWalkDir(fromPos, toPos, segs);
  const trackDist = trackDistanceBetween(fromPos, toPos, walkDir, segs);
  return { walkDir, trackDist };
}

function updateEtaTrainState(train, stationSequences, lineSegments) {
  const sequence = getTrainSequence(train.legend, train.destNm, stationSequences);
  if (!sequence || sequence.length < 2) {
    train._etaFallbackGps = true;
    return;
  }

  const rn  = train.rn;
  const now = Date.now();
  let state = etaTrainState.get(rn);

  const nextStaNm = train.nextStaNm;
  const isApp     = train.isApp;

  // No ETA data → GPS fallback, clean up any stale state
  if (!nextStaNm) {
    train._etaFallbackGps = true;
    if (state) etaTrainState.delete(rn);
    return;
  }

  train._etaFallbackGps = false;

  const nextIdx = findStationInSequence(sequence, nextStaNm, state?.prevStationIdx);
  if (nextIdx === -1) {
    train._etaFallbackGps = true;
    console.warn(`[ETA-AI] rn=${rn} (${train.legend}): "${nextStaNm}" not in sequence`);
    return;
  }

  const segLegend = train.legend.replace(/_.*$/, '');
  const segs      = lineSegments ? lineSegments[segLegend] : null;

  // ---- New train ----
  if (!state) {
    const direction = inferDirection(train.legend, train.destNm, sequence, nextIdx);
    const prevIdx   = Math.max(0, Math.min(sequence.length - 1, nextIdx - direction));
    const { walkDir, trackDist } = _cacheSegment(sequence, prevIdx, nextIdx, segs);

    etaTrainState.set(rn, {
      rn,
      legend:           train.legend,
      sequenceKey:      _seqKey(train),
      prevStationIdx:   prevIdx,
      nextStationIdx:   nextIdx,
      progress:         isApp === '1' ? 0.85 : 0.1,
      direction,
      lastNextStaNm:    nextStaNm,
      lastIsApp:        isApp,
      stateChangeTime:  now,
      estimatedTravelMs: estimateTravelTime(sequence[prevIdx], sequence[nextIdx], train.legend),
      arrivalTimeMs:    null,
      isApproaching:    isApp === '1',
      atStation:        false,
      dwellStartTime:   null,
      cachedTrackDist:  trackDist,
      cachedWalkDir:    walkDir,
    });
    return;
  }

  // ---- Existing train: branch switch ----
  if (_seqKey(train) !== state.sequenceKey) {
    etaTrainState.delete(rn);
    updateEtaTrainState(train, stationSequences, lineSegments);
    return;
  }

  // ---- Existing train: station changed ----
  if (nextStaNm !== state.lastNextStaNm) {
    const oldNextIdx  = state.nextStationIdx;
    const newDirection = nextIdx !== oldNextIdx
      ? (nextIdx > oldNextIdx ? +1 : -1)
      : state.direction;
    const { walkDir, trackDist } = _cacheSegment(sequence, oldNextIdx, nextIdx, segs);

    state.direction       = newDirection;
    state.prevStationIdx  = oldNextIdx;
    state.nextStationIdx  = nextIdx;
    state.progress        = 0;
    state.stateChangeTime = now;
    state.estimatedTravelMs = estimateTravelTime(sequence[oldNextIdx], sequence[nextIdx], train.legend);
    state.isApproaching   = isApp === '1';
    state.atStation       = false;
    state.dwellStartTime  = null;
    state.lastNextStaNm   = nextStaNm;
    state.lastIsApp       = isApp;
    state.arrivalTimeMs   = null;
    state.cachedTrackDist = trackDist;
    state.cachedWalkDir   = walkDir;
    return;
  }

  // ---- Existing train: same station, isApp changed ----
  if (isApp === '1' && !state.isApproaching) {
    state.isApproaching  = true;
    state.stateChangeTime = now;
  }
  state.lastIsApp = isApp;
}

// ---- ETA follow data (selected train only) ----

function updateEtaWithFollowData(rn, etas, stationSequences) {
  const state = etaTrainState.get(rn);
  if (!state || !etas || etas.length === 0) return;
  const nextEta = etas[0];
  if (!nextEta?.arrT) return;
  const arrivalTime = parseCTATime(nextEta.arrT);
  if (arrivalTime) state.arrivalTimeMs = arrivalTime;
}

function parseCTATime(timeStr) {
  if (!timeStr) return null;
  let d = new Date(timeStr);
  if (!isNaN(d.getTime())) return d.getTime();
  const m = timeStr.match(/^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return null;
}

// ---- Animation ----

const ETA_SMOOTHING    = 0.15;
const HOLD_DISTANCE    = 0.002;  // ~200m before station: hold and wait for isApp
const APPROACH_DISTANCE = 0.003; // ~300m before station: isApp expected here
const APPROACH_DURATION = 15000; // ms from isApp to arrival

function advanceEtaTrains(trains, lineSegments, stationSequences, dt) {
  const now = Date.now();

  for (const train of trains) {
    if (train._etaFallbackGps) continue;
    const state = etaTrainState.get(train.rn);
    if (!state) continue;

    const sequence = getTrainSequence(train.legend, train.destNm, stationSequences);
    const segLegend = train.legend.replace(/_.*$/, '');
    const segs = lineSegments[segLegend];
    if (!sequence || !segs) continue;

    const prevStation = sequence[state.prevStationIdx];
    const nextStation = sequence[state.nextStationIdx];
    if (!prevStation || !nextStation) continue;

    const fromPos = prevStation.trackPos;
    const toPos   = nextStation.trackPos;
    const totalTrackDist = state.cachedTrackDist
      || Math.abs(nextStation.distFromStart - prevStation.distFromStart);

    const segDist = totalTrackDist > 1e-6 ? totalTrackDist
      : geoDist(prevStation.lon, prevStation.lat, nextStation.lon, nextStation.lat);
    const holdProgress     = segDist > 1e-6 ? Math.max(0.5, 1 - HOLD_DISTANCE / segDist)     : 0.95;
    const approachProgress = segDist > 1e-6 ? Math.max(0.5, 1 - APPROACH_DISTANCE / segDist) : 0.80;

    // ---- Progress ----
    if (state.atStation) {
      state.progress = 1;
      // Escape dwell after 60s if the API hasn't confirmed a station change
      if (state.dwellStartTime && now - state.dwellStartTime > 60000) {
        state.atStation = false;
        state.progress  = 0.99;
      }
    } else {
      let targetProgress;

      if (state.arrivalTimeMs) {
        // Precise ETA from follow API
        const timeToArrival  = state.arrivalTimeMs - now;
        const totalTravelTime = state.arrivalTimeMs - state.stateChangeTime;
        targetProgress = totalTravelTime > 0 ? 1 - (timeToArrival / totalTravelTime) : 1;
      } else if (state.isApproaching) {
        // isApp fired — interpolate to 1.0 over ~15s
        const base = Math.max(state.progress, approachProgress);
        const t    = Math.min(1, (now - state.stateChangeTime) / APPROACH_DURATION);
        targetProgress = base + (1 - base) * t;
      } else {
        // Time-based: advance to holdProgress over estimatedTravelMs, then creep
        const elapsed      = now - state.stateChangeTime;
        const baseProgress = elapsed / state.estimatedTravelMs;
        if (baseProgress >= holdProgress) {
          const creep = (elapsed - state.estimatedTravelMs) * (0.05 / 60000);
          targetProgress = Math.min(0.995, holdProgress + Math.max(0, creep));
        } else {
          targetProgress = baseProgress;
        }
      }

      targetProgress = Math.max(0, Math.min(1, targetProgress));
      const smoothing = 1 - Math.pow(1 - ETA_SMOOTHING, dt / 16);
      state.progress += (targetProgress - state.progress) * smoothing;
      state.progress  = Math.max(0, Math.min(1, state.progress));

      if (state.progress >= 0.995) {
        state.atStation    = true;
        state.dwellStartTime = now;
        state.progress     = 1;
      }
    }

    // ---- Position ----
    const walkDir = state.cachedWalkDir || resolveTrackWalkDir(fromPos, toPos, segs);

    if (totalTrackDist < 1e-6 || state.progress >= 1) {
      train.lon        = nextStation.lon;
      train.lat        = nextStation.lat;
      train._trackPos  = { ...toPos };
      const look = advanceOnTrack(toPos, 0.001, walkDir, segs);
      train._direction = look.direction !== undefined ? look.direction : walkDir;
    } else {
      const pos = advanceOnTrack(fromPos, state.progress * totalTrackDist, walkDir, segs, {
        targetLon: toPos.lon, targetLat: toPos.lat,
      });
      train.lon        = pos.lon;
      train.lat        = pos.lat;
      train._trackPos  = pos;
      train._direction = pos.direction !== undefined ? pos.direction : walkDir;
    }
    train._animLon = train.lon;
    train._animLat = train.lat;
  }
}

// ---- Init / toggle ----

function initEtaTrainAnimation(trains, lineSegments, stationSequences, prevTrainMap) {
  const activeRns = new Set(trains.map(t => t.rn));
  for (const rn of etaTrainState.keys()) {
    if (!activeRns.has(rn)) etaTrainState.delete(rn);
  }

  for (const train of trains) {
    updateEtaTrainState(train, stationSequences, lineSegments);
    if (prevTrainMap) {
      const prev = prevTrainMap.get(train.rn);
      if (prev?._spreading) {
        train._spreadX    = prev._spreadX;
        train._spreadY    = prev._spreadY;
        train._spreadDirX = prev._spreadDirX;
        train._spreadDirY = prev._spreadDirY;
        train._spreadRing = prev._spreadRing;
        train._spreading  = true;
      }
    }
  }

  advanceEtaTrains(trains, lineSegments, stationSequences, 16);
  const eta = trains.filter(t => !t._etaFallbackGps).length;
  const gps = trains.filter(t =>  t._etaFallbackGps).length;
  console.log(`[ETA-AI] Init: ${eta} ETA-tracked, ${gps} GPS-fallback`);
}

let _etaAiEnabled = false;
function isEtaAiEnabled()       { return _etaAiEnabled; }
function setEtaAiEnabled(v)     { _etaAiEnabled = v; if (!v) etaTrainState.clear(); }
