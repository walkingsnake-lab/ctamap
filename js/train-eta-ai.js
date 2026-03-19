/**
 * ETA-based train position engine ("Train AI").
 *
 * Instead of using raw GPS coordinates from the CTA API, this module derives
 * train positions from station-level data: nextStaNm, isApp (approaching),
 * and optionally full ETA arrival times from the follow API.
 *
 * Core idea: each train is always "between two stations" on the track.  Its
 * position is interpolated along the track geometry based on:
 *   - Which station it's heading toward (nextStaNm)
 *   - Whether it's approaching (isApp == "1")
 *   - Time elapsed since last state change
 *   - Full ETA timing when available (selected train only)
 *
 * Advantages over GPS-based positioning:
 *   - No phantom jumps (station sequence is monotonic)
 *   - No direction ambiguity (station order defines direction)
 *   - Smooth, predictable animation
 *   - No confirmation holds needed
 *
 * Depends on: config.js, path-follow.js (loaded before this file)
 */

// ---- Station sequence builder ----

/**
 * Known CTA station orders per line.  Station names match the CTA Train
 * Tracker API's `nextStaNm` field (after cleanStationName normalization).
 * The order goes from "Terminal A" to "Terminal B" — direction derivation
 * checks which end matches LINE_NORTH_DESTS.
 *
 * For lines with branches (Blue, Green), a single linear sequence covers
 * the primary route.  The branch is listed as a separate sub-sequence keyed
 * with a suffix (e.g. "BL-ohare", "GR-63rd").
 *
 * Loop lines (BR, OR, PK, GR) include downtown Loop stations in traversal
 * order — the sequence continues around the Loop elevated.
 */
const CTA_STATION_ORDERS = {
  // Red Line: Howard → 95th/Dan Ryan (subway trunk downtown)
  RD: [
    'Howard', 'Jarvis', 'Morse', 'Loyola', 'Granville', 'Thorndale',
    'Bryn Mawr', 'Berwyn', 'Argyle', 'Lawrence', 'Wilson', 'Sheridan',
    'Addison', 'Belmont', 'Fullerton', 'North/Clybourn', 'Clark/Division',
    'Chicago', 'Grand', 'Lake', 'Monroe', 'Jackson', 'Harrison',
    'Roosevelt', 'Cermak-Chinatown', 'Sox-35th', '47th', 'Garfield',
    '63rd', '69th', '79th', '87th', '95th/Dan Ryan',
  ],

  // Blue Line: O'Hare → Forest Park (includes Dearborn subway trunk)
  BL: [
    "O'Hare", 'Rosemont', 'Cumberland', 'Harlem', 'Jefferson Park',
    'Montrose', 'Irving Park', 'Addison', 'Belmont', 'Logan Square',
    'California', 'Western', 'Damen', 'Division', 'Chicago', 'Grand',
    'Clark/Lake', 'Washington', 'Monroe', 'Jackson', 'LaSalle',
    'Clinton', 'UIC-Halsted', 'Racine', 'Illinois Medical District',
    'Western', 'Kedzie-Homan', 'Pulaski', 'Cicero', 'Austin',
    'Oak Park', 'Harlem', 'Forest Park',
  ],

  // Brown Line: Kimball → Loop (elevated) → back north
  BR: [
    'Kimball', 'Kedzie', 'Francisco', 'Rockwell', 'Western', 'Damen',
    'Montrose', 'Irving Park', 'Addison', 'Paulina', 'Southport',
    'Belmont', 'Wellington', 'Diversey', 'Fullerton', 'Armitage',
    'Sedgwick', 'Chicago', 'Merchandise Mart',
    // Loop stations (clockwise from Merchandise Mart)
    'Washington/Wells', 'Quincy', 'LaSalle/Van Buren', 'Library',
    'Adams/Wabash', 'Washington/Wabash', 'State/Lake', 'Clark/Lake',
  ],

  // Green Line: Harlem/Lake → split at Roosevelt
  // Main branch to Ashland/63rd, cottage grove branch separate
  GR: [
    'Harlem', 'Oak Park', 'Ridgeland', 'Austin', 'Central',
    'Laramie', 'Cicero', 'Pulaski', 'Conservatory-Central Park',
    'Kedzie', 'California', 'Ashland', 'Morgan', 'Clinton',
    // Loop
    'Clark/Lake', 'State/Lake', 'Washington/Wabash', 'Adams/Wabash',
    'Roosevelt',
    // South Side main
    'Cermak-McCormick Place', '35-Bronzeville-IIT', 'Indiana',
    '43rd', '47th', '51st', 'Garfield',
    // Ashland/63rd branch
    'Halsted', 'Ashland/63rd',
    // Cottage Grove branch (trains going here pass Garfield → King Drive → Cottage Grove)
    'King Drive', 'Cottage Grove',
  ],

  // Orange Line: Midway → Loop → back to Midway
  OR: [
    'Midway', 'Pulaski', 'Kedzie', 'Western', '35th/Archer',
    'Ashland', 'Halsted', 'Roosevelt',
    // Loop (counter-clockwise)
    'Library', 'LaSalle/Van Buren', 'Quincy', 'Washington/Wells',
    'Clark/Lake', 'State/Lake', 'Washington/Wabash', 'Adams/Wabash',
  ],

  // Pink Line: 54th/Cermak → Loop → back
  PK: [
    '54th/Cermak', 'Cicero', 'Kostner', 'Pulaski', 'Central Park',
    'Kedzie', 'California', 'Western', 'Damen', '18th', 'Polk',
    'Ashland', 'Morgan', 'Clinton',
    // Loop
    'Clark/Lake', 'State/Lake', 'Washington/Wabash', 'Adams/Wabash',
    'Library', 'LaSalle/Van Buren', 'Quincy', 'Washington/Wells',
  ],

  // Purple Line: Linden → Howard (+ Express continues south sharing Red/Brown track)
  PR: [
    'Linden', 'Central', 'Noyes', 'Foster', 'Davis', 'Dempster',
    'Main', 'South Blvd', 'Howard',
    // Express service continues south (shares Red Line north side + Loop)
    'Jarvis', 'Morse', 'Loyola', 'Granville', 'Thorndale',
    'Bryn Mawr', 'Berwyn', 'Argyle', 'Lawrence', 'Wilson',
    'Sheridan', 'Addison', 'Belmont', 'Wellington', 'Diversey',
    'Fullerton', 'Armitage', 'Sedgwick', 'Chicago', 'Merchandise Mart',
    // Loop
    'Washington/Wells', 'Quincy', 'LaSalle/Van Buren', 'Library',
    'Adams/Wabash', 'Washington/Wabash', 'State/Lake', 'Clark/Lake',
  ],

  // Yellow Line: Dempster-Skokie → Howard
  YL: [
    'Dempster-Skokie', 'Oakton-Skokie', 'Howard',
  ],
};

/**
 * Builds station sequences by resolving the known CTA station orders
 * against actual track positions from the GeoJSON geometry.
 *
 * Returns: { legend: [ { name, lon, lat, trackPos, distFromStart } ] }
 */
function buildStationSequences(lineSegments, stations, stationPositions) {
  const sequences = {};

  for (const [legend, names] of Object.entries(CTA_STATION_ORDERS)) {
    const segs = lineSegments[legend];
    if (!segs || segs.length === 0) continue;

    const sequence = [];
    let cumulativeDist = 0;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      // Try to find the station's coordinates
      const coord = lookupStation(name, legend, stationPositions);
      if (!coord) {
        console.warn(`[ETA-AI] ${legend}: station "${name}" not found in GeoJSON`);
        continue;
      }

      // Snap to track
      const trackPos = snapToTrackPosition(coord[0], coord[1], segs);

      // Estimate cumulative distance from previous station
      if (sequence.length > 0) {
        const prev = sequence[sequence.length - 1];
        cumulativeDist += geoDist(prev.lon, prev.lat, trackPos.lon, trackPos.lat);
      }

      sequence.push({
        name,
        lon: trackPos.lon,
        lat: trackPos.lat,
        trackPos,
        distFromStart: cumulativeDist,
      });
    }

    sequences[legend] = sequence;
  }

  // Log station sequences for debugging
  for (const [legend, seq] of Object.entries(sequences)) {
    console.log(`[ETA-AI] ${legend}: ${seq.length} stations — ${seq.map(s => s.name).join(' → ')}`);
  }

  return sequences;
}

// ---- ETA state machine ----

/**
 * Per-train ETA state. Keyed by run number.
 * Tracks the train's progress between stations for smooth interpolation.
 */
const etaTrainState = new Map();

/**
 * ETA state for a single train:
 * {
 *   rn: string,                  // run number
 *   legend: string,              // line code
 *   prevStationIdx: number,      // index in station sequence of last passed station
 *   nextStationIdx: number,      // index of station train is heading toward
 *   progress: number,            // 0..1 interpolation between prev and next station
 *   direction: number,           // +1 or -1 along sequence (increasing or decreasing index)
 *   lastNextStaNm: string,       // last reported nextStaNm (detect changes)
 *   lastIsApp: string,           // last reported isApp value
 *   stateChangeTime: number,     // timestamp when nextStaNm or isApp changed
 *   estimatedTravelMs: number,   // estimated ms to travel between prev→next station
 *   arrivalTimeMs: number|null,  // absolute time of expected arrival (from ETA API)
 *   isApproaching: boolean,      // currently in approaching state
 *   atStation: boolean,          // dwelling at station
 *   dwellStartTime: number|null, // when dwell started
 * }
 */

const ETA_DEFAULTS = {
  // Assumed average speed between stations when no ETA timing available
  AVERAGE_SPEED_MPS: 12, // ~27 mph — reasonable CTA average including accel/decel
  // Minimum travel time between adjacent stations
  MIN_TRAVEL_MS: 8000,
  // Maximum travel time between adjacent stations (cap for very long segments)
  MAX_TRAVEL_MS: 180000,
  // Dwell time at each station (trains pause briefly)
  DWELL_MS: 15000,
  // When isApp flips to "1", assume train is this fraction of the way there
  APPROACHING_PROGRESS: 0.80,
  // Smoothing factor for progress updates (0..1, lower = smoother)
  PROGRESS_SMOOTHING: 0.15,
};

/**
 * Finds the index of a station in a line's sequence by name.
 * Returns -1 if not found.
 */
function findStationInSequence(sequence, stationName) {
  if (!stationName || !sequence) return -1;
  const clean = cleanStationName(stationName);
  const norm = normalizeStationName(clean);

  // Exact match first
  for (let i = 0; i < sequence.length; i++) {
    if (normalizeStationName(sequence[i].name) === norm) return i;
  }

  // Partial match
  for (let i = 0; i < sequence.length; i++) {
    const sNorm = normalizeStationName(sequence[i].name);
    if (sNorm.includes(norm) || norm.includes(sNorm)) return i;
  }

  return -1;
}

/**
 * Estimates travel time between two stations based on track distance.
 */
function estimateTravelTime(fromStation, toStation) {
  const dist = geoDist(fromStation.lon, fromStation.lat, toStation.lon, toStation.lat);
  // Convert degrees to meters (rough), use average speed
  const meters = dist * 111000;
  const ms = (meters / ETA_DEFAULTS.AVERAGE_SPEED_MPS) * 1000;
  return Math.max(ETA_DEFAULTS.MIN_TRAVEL_MS, Math.min(ETA_DEFAULTS.MAX_TRAVEL_MS, ms));
}

/**
 * Determines direction (+1 or -1 along sequence index) based on the
 * train's destination and the station it's heading toward.
 *
 * The approach: find the destination station in the sequence.  If the
 * destination index is higher than the current nextStation index, the
 * train is moving in the +1 direction (increasing index).  If lower, -1.
 *
 * For loop lines where the destination might be "Loop" (not a real station
 * name), we check if the destination matches any station in the upper half
 * of the sequence (the Loop portion, which is always at the end for lines
 * like OR, PK, BR, GR).
 */
function inferSequenceDirection(legend, destNm, sequence, nextStationIdx) {
  if (!sequence || sequence.length < 2) return +1;
  if (!destNm) return +1;

  // Try to find the destination station directly in the sequence
  const destIdx = findStationInSequence(sequence, destNm);
  if (destIdx !== -1 && nextStationIdx !== undefined) {
    // If destination is ahead in the sequence, go +1; if behind, go -1
    if (destIdx > nextStationIdx) return +1;
    if (destIdx < nextStationIdx) return -1;
    // At the destination — use LINE_NORTH_DESTS as fallback
  }

  // Fallback: use LINE_NORTH_DESTS to determine which end of the sequence
  // the train is heading toward.
  const northDest = LINE_NORTH_DESTS[legend];
  if (!northDest) return +1;

  const destIsNorth = destNm.toUpperCase().includes(northDest.toUpperCase());

  // For CTA_STATION_ORDERS, the first station is always the "north/outbound"
  // terminal (Howard for RD, O'Hare for BL, Kimball for BR, etc.) and the
  // last is the "south/inbound" terminal.  For loop lines, the Loop stations
  // are at the END of the sequence.  So:
  //   destIsNorth + first station is north terminal → going toward index 0 → -1
  //   destIsNorth + first station is NOT north      → going toward end → +1
  //
  // Check if first station name matches northDest
  const firstIsNorth = sequence[0].name.toUpperCase().includes(northDest.toUpperCase());
  // Also check last station for Loop lines (Loop stations are at the end)
  const lastIsNorth = sequence[sequence.length - 1].name.toUpperCase().includes(northDest.toUpperCase());

  if (destIsNorth) {
    if (firstIsNorth) return -1;
    if (lastIsNorth) return +1;
    // Neither end matches "Loop" literally — for loop lines, the Loop stations
    // are at the HIGH end of the sequence.  "Loop" destination → +1.
    if (LOOP_LINE_CODES.includes(legend)) return +1;
    return +1;
  } else {
    if (firstIsNorth) return +1;
    if (lastIsNorth) return -1;
    if (LOOP_LINE_CODES.includes(legend)) return -1;
    return -1;
  }
}

/**
 * Initialize or update ETA state for a train based on fresh API data.
 *
 * Called on each poll with the train object from fetchTrains().
 * Updates the internal state machine so advanceEtaTrains() can interpolate.
 *
 * Some trains (especially Yellow and Purple lines) don't report nextStaNm
 * or any ETA data.  These trains are marked with _etaFallbackGps = true
 * so the animation loop knows to use GPS-based positioning instead.
 */
function updateEtaTrainState(train, stationSequences) {
  const sequence = stationSequences[train.legend];
  if (!sequence || sequence.length < 2) {
    train._etaFallbackGps = true;
    return;
  }

  const rn = train.rn;
  const now = Date.now();
  let state = etaTrainState.get(rn);

  const nextStaNm = train.nextStaNm;
  const isApp = train.isApp;

  // No station data at all — fall back to GPS
  if (!nextStaNm) {
    train._etaFallbackGps = true;
    // If we had ETA state before, keep it alive briefly in case data returns
    if (state) {
      if (!state._noDataSince) {
        state._noDataSince = now;
      } else if (now - state._noDataSince > 60000) {
        // No data for 60 seconds — drop the state
        etaTrainState.delete(rn);
      }
    }
    return;
  }

  // We have station data — clear fallback flag
  train._etaFallbackGps = false;

  const nextIdx = findStationInSequence(sequence, nextStaNm);

  if (nextIdx === -1) {
    // Can't find station in sequence — fall back to GPS
    train._etaFallbackGps = true;
    console.warn(`[ETA-AI] rn=${rn} (${train.legend}): nextStaNm="${nextStaNm}" not found in sequence → GPS fallback`);
    return;
  }

  // Determine direction from destination + next station position in sequence
  const direction = inferSequenceDirection(train.legend, train.destNm, sequence, nextIdx);

  if (!state) {
    // New train — initialize state
    // Previous station is one step back from next in the travel direction
    const prevIdx = nextIdx - direction;
    const safePrevIdx = Math.max(0, Math.min(sequence.length - 1, prevIdx));

    state = {
      rn,
      legend: train.legend,
      prevStationIdx: safePrevIdx,
      nextStationIdx: nextIdx,
      progress: isApp === '1' ? ETA_DEFAULTS.APPROACHING_PROGRESS : 0.3,
      direction,
      lastNextStaNm: nextStaNm,
      lastIsApp: isApp,
      stateChangeTime: now,
      estimatedTravelMs: estimateTravelTime(sequence[safePrevIdx], sequence[nextIdx]),
      arrivalTimeMs: null,
      isApproaching: isApp === '1',
      atStation: false,
      dwellStartTime: null,
      _noDataSince: null,
    };
    etaTrainState.set(rn, state);
    return;
  }

  // Existing train — data is back, clear no-data timer
  state._noDataSince = null;
  state.direction = direction;

  if (nextStaNm !== state.lastNextStaNm) {
    // Station changed — train has moved past a station
    // The old nextStation is now the prevStation
    const oldNextIdx = state.nextStationIdx;
    state.prevStationIdx = oldNextIdx;
    state.nextStationIdx = nextIdx;
    state.progress = 0;
    state.stateChangeTime = now;
    state.estimatedTravelMs = estimateTravelTime(
      sequence[oldNextIdx], sequence[nextIdx]
    );
    state.isApproaching = isApp === '1';
    state.atStation = false;
    state.dwellStartTime = null;
    state.lastNextStaNm = nextStaNm;
    state.lastIsApp = isApp;
    state.arrivalTimeMs = null;
    return;
  }

  if (isApp !== state.lastIsApp) {
    if (isApp === '1' && !state.isApproaching) {
      // Just started approaching — jump progress forward
      state.isApproaching = true;
      if (state.progress < ETA_DEFAULTS.APPROACHING_PROGRESS) {
        state.progress = ETA_DEFAULTS.APPROACHING_PROGRESS;
      }
      state.stateChangeTime = now;
    }
    state.lastIsApp = isApp;
  }
}

/**
 * Update ETA state with full ETA data from the follow API.
 * Only available for the selected/tracked train.
 */
function updateEtaWithFollowData(rn, etas, stationSequences) {
  const state = etaTrainState.get(rn);
  if (!state || !etas || etas.length === 0) return;

  const sequence = stationSequences[state.legend];
  if (!sequence) return;

  // First ETA entry is the next stop
  const nextEta = etas[0];
  if (!nextEta || !nextEta.arrT) return;

  // Parse CTA arrival time (format: "YYYYMMDD HH:MM:SS")
  const arrivalTime = parseCTATime(nextEta.arrT);
  if (arrivalTime) {
    state.arrivalTimeMs = arrivalTime;
  }
}

/**
 * Parse CTA time string to epoch ms.
 * CTA format: "YYYYMMDD HH:MM:SS" or ISO-like "YYYY-MM-DDTHH:MM:SS"
 */
function parseCTATime(timeStr) {
  if (!timeStr) return null;
  // Try ISO format first
  let d = new Date(timeStr);
  if (!isNaN(d.getTime())) return d.getTime();
  // Try CTA format "YYYYMMDD HH:MM:SS"
  const m = timeStr.match(/^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return d.getTime();
  }
  return null;
}

/**
 * Advances all ETA-tracked trains by interpolating position along the track.
 * Called every animation frame.
 *
 * For each train:
 *   1. Calculate target progress (0..1) between prev and next station
 *   2. Smoothly interpolate current progress toward target
 *   3. Compute track position from the two bounding stations
 *
 * Updates train.lon, train.lat, train._trackPos, train._direction.
 */
function advanceEtaTrains(trains, lineSegments, stationSequences, dt) {
  const now = Date.now();

  for (const train of trains) {
    if (train._etaFallbackGps) continue; // no ETA data — handled by GPS fallback
    const state = etaTrainState.get(train.rn);
    if (!state) continue;

    const sequence = stationSequences[train.legend];
    const segs = lineSegments[train.legend];
    if (!sequence || !segs) continue;

    const prevStation = sequence[state.prevStationIdx];
    const nextStation = sequence[state.nextStationIdx];
    if (!prevStation || !nextStation) continue;

    // Calculate target progress based on time
    let targetProgress;

    if (state.arrivalTimeMs) {
      // Use precise ETA timing
      const timeToArrival = state.arrivalTimeMs - now;
      const totalTravelTime = state.arrivalTimeMs - state.stateChangeTime;
      if (totalTravelTime > 0) {
        targetProgress = 1 - (timeToArrival / totalTravelTime);
      } else {
        targetProgress = 1;
      }
    } else {
      // Estimate based on elapsed time and estimated travel duration
      const elapsed = now - state.stateChangeTime;

      if (state.atStation) {
        // Dwelling at station — don't advance
        targetProgress = state.progress;
      } else if (state.isApproaching) {
        // Approaching: interpolate from current progress to 1.0
        const approachElapsed = now - state.stateChangeTime;
        // Assume ~15 seconds from "approaching" to arrival
        const approachDuration = 15000;
        const approachT = Math.min(1, approachElapsed / approachDuration);
        targetProgress = state.progress + (1 - state.progress) * approachT;
      } else {
        // Normal transit: time-based interpolation
        targetProgress = Math.min(0.95, elapsed / state.estimatedTravelMs);
      }
    }

    // Clamp
    targetProgress = Math.max(0, Math.min(1, targetProgress));

    // If we've reached the station (progress ≈ 1), enter dwell state
    if (targetProgress >= 0.98 && !state.atStation) {
      state.atStation = true;
      state.dwellStartTime = now;
      targetProgress = 1;
    }

    // Smooth progress (lerp toward target)
    const smoothing = 1 - Math.pow(1 - ETA_DEFAULTS.PROGRESS_SMOOTHING, dt / 16);
    state.progress += (targetProgress - state.progress) * smoothing;
    state.progress = Math.max(0, Math.min(1, state.progress));

    // Compute position on track between the two stations
    const fromPos = prevStation.trackPos;
    const toPos = nextStation.trackPos;
    const totalTrackDist = Math.abs(nextStation.distFromStart - prevStation.distFromStart);

    if (totalTrackDist < 1e-6) {
      // Stations are basically the same point
      train.lon = nextStation.lon;
      train.lat = nextStation.lat;
      train._trackPos = toPos;
      train._direction = toPos.direction || state.direction;
    } else {
      // Advance along track from prevStation toward nextStation
      const advanceDist = state.progress * totalTrackDist;
      const walkDir = state.nextStationIdx > state.prevStationIdx ? +1 : -1;
      const pos = advanceOnTrack(fromPos, advanceDist, walkDir, segs, {
        targetLon: toPos.lon,
        targetLat: toPos.lat,
      });
      train.lon = pos.lon;
      train.lat = pos.lat;
      train._trackPos = pos;
      // Use the segment-relative direction from the track walker for arrow rendering
      train._direction = pos.direction !== undefined ? pos.direction : walkDir;
    }
    train._animLon = train.lon;
    train._animLat = train.lat;
  }
}

/**
 * Initializes ETA animation state for all trains after an API refresh.
 * This is the ETA-AI equivalent of initRealTrainAnimation().
 */
function initEtaTrainAnimation(trains, lineSegments, stationSequences, prevTrainMap) {
  // Clean up state for trains that no longer exist
  const activeRns = new Set(trains.map(t => t.rn));
  for (const rn of etaTrainState.keys()) {
    if (!activeRns.has(rn)) etaTrainState.delete(rn);
  }

  // Update state for each train
  for (const train of trains) {
    updateEtaTrainState(train, stationSequences);

    // Carry over spread state from previous objects
    if (prevTrainMap) {
      const prev = prevTrainMap.get(train.rn);
      if (prev && prev._spreading) {
        train._spreadX = prev._spreadX;
        train._spreadY = prev._spreadY;
        train._spreadDirX = prev._spreadDirX;
        train._spreadDirY = prev._spreadDirY;
        train._spreadRing = prev._spreadRing;
        train._spreading = true;
      }
    }
  }

  // Position all trains immediately (first frame)
  advanceEtaTrains(trains, lineSegments, stationSequences, 16);

  // Log summary
  const etaCount = trains.filter(t => !t._etaFallbackGps).length;
  const gpsCount = trains.filter(t => t._etaFallbackGps).length;
  console.log(`[ETA-AI] Init: ${etaCount} ETA-tracked, ${gpsCount} GPS-fallback (of ${trains.length} total)`);
}

/**
 * Returns true if ETA AI mode is currently active.
 */
let _etaAiEnabled = false;

function isEtaAiEnabled() {
  return _etaAiEnabled;
}

function setEtaAiEnabled(enabled) {
  _etaAiEnabled = enabled;
  // Clear state when toggling off so GPS mode starts fresh
  if (!enabled) {
    etaTrainState.clear();
  }
}
