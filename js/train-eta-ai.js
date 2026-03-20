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
 *   - Direction derived from station progression, not destination name or heading
 *   - Smooth, predictable animation
 *   - Reversal holds prevent jittery direction flips
 *   - Track distance cached for accurate interpolation on curved segments
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
    'Kedzie', 'California', 'Damen', 'Ashland', 'Morgan', 'Clinton',
    // Loop
    'Clark/Lake', 'State/Lake', 'Washington/Wabash', 'Adams/Wabash',
    'Roosevelt',
    // South Side main
    'Cermak-McCormick Place', '35-Bronzeville-IIT', 'Indiana',
    '43rd', '47th', '51st', 'Garfield',
    // Ashland/63rd branch (default; Cottage Grove branch in GR_CG)
    'Halsted', 'Ashland/63rd',
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

  // Green Line — Cottage Grove branch (shares trunk through Garfield, then diverges)
  GR_CG: [
    'Harlem', 'Oak Park', 'Ridgeland', 'Austin', 'Central',
    'Laramie', 'Cicero', 'Pulaski', 'Conservatory-Central Park',
    'Kedzie', 'California', 'Damen', 'Ashland', 'Morgan', 'Clinton',
    // Loop
    'Clark/Lake', 'State/Lake', 'Washington/Wabash', 'Adams/Wabash',
    'Roosevelt',
    // South Side
    'Cermak-McCormick Place', '35-Bronzeville-IIT', 'Indiana',
    '43rd', '47th', '51st', 'Garfield',
    // Cottage Grove branch
    'King Drive', 'Cottage Grove',
  ],

  // Yellow Line: Dempster-Skokie → Howard
  YL: [
    'Dempster-Skokie', 'Oakton-Skokie', 'Howard',
  ],
};

/**
 * Selects the correct station sequence for a train.
 * Handles branch lines (Green Line has Ashland/63rd and Cottage Grove branches).
 * Returns the sequence array, or null if none found.
 */
function getTrainSequence(legend, destNm, stationSequences) {
  // Green Line branch selection
  if (legend === 'GR' && destNm) {
    const dest = destNm.toUpperCase();
    if (dest.includes('COTTAGE') || dest.includes('KING')) {
      return stationSequences['GR_CG'] || stationSequences['GR'];
    }
  }
  return stationSequences[legend] || null;
}

/**
 * Builds station sequences by resolving the known CTA station orders
 * against actual track positions from the GeoJSON geometry.
 *
 * Returns: { legend: [ { name, lon, lat, trackPos, distFromStart } ] }
 */
function buildStationSequences(lineSegments, stations, stationPositions) {
  const sequences = {};

  for (const [legend, names] of Object.entries(CTA_STATION_ORDERS)) {
    // Branch sequences (e.g. GR_CG) share the parent line's track geometry
    const segLegend = legend.replace(/_.*$/, '');
    const segs = lineSegments[segLegend];
    if (!segs || segs.length === 0) continue;

    const sequence = [];
    let cumulativeDist = 0;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      // Try to find the station's coordinates
      const coord = lookupStation(name, segLegend, stationPositions);
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

// ---- Track walk direction helper ----

/**
 * Determines the correct track geometry direction to walk from one station's
 * track position to another.  Station sequence order does NOT necessarily
 * match GeoJSON segment direction — e.g. a sequence going [A, B] might
 * require direction -1 along the track geometry to get from A to B.
 *
 * Tests a short probe in both directions from `fromPos` and picks whichever
 * gets closer to `toPos`.  Falls back to +1 if ambiguous.
 */
function resolveTrackWalkDir(fromPos, toPos, segs) {
  const target = { targetLon: toPos.lon, targetLat: toPos.lat };
  const probeDist = Math.max(geoDist(fromPos.lon, fromPos.lat, toPos.lon, toPos.lat) * 0.1, 1e-5);
  const fwd = advanceOnTrack(fromPos, probeDist, +1, segs, target);
  const bwd = advanceOnTrack(fromPos, probeDist, -1, segs, target);
  const fwdDist = geoDist(fwd.lon, fwd.lat, toPos.lon, toPos.lat);
  const bwdDist = geoDist(bwd.lon, bwd.lat, toPos.lon, toPos.lat);
  if (fwdDist < bwdDist) return +1;
  if (bwdDist < fwdDist) return -1;
  return +1;
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

// ---- Per-line speed profiles ----
// CTA trains have a trapezoidal velocity profile: accelerate, cruise, brake.
// Short segments never reach cruise speed — dominated by accel/decel overhead.
// Long segments spend most of the time at cruise speed.
//
// Model: travel_time = overhead + (distance / cruise_speed)
//   - overhead: fixed cost per station-to-station trip (accel + decel + dwell)
//   - cruise_speed: top speed on straight portions — varies by line infrastructure
//
// Speed profiles reflect real CTA infrastructure:
//   BL: Blue Line runs in expressway median (O'Hare branch) and freight ROW —
//       longest inter-station distances, highest speeds (~55 mph cruise).
//   RD: Red Line subway trunk downtown, elevated N/S sides — moderate-fast.
//   GR: Green Line has fast south side elevated stretches, slow through Loop.
//   OR: Orange Line Midway branch — dedicated ROW, moderate speed.
//   YL: Yellow Line — short dedicated Skokie Swift ROW, moderate speed.
//   BR: Brown Line — tight elevated curves (Ravenswood), short segments, slow.
//   PK: Pink Line — similar to Brown, tight Cermak branch curves.
//   PR: Purple Line local (Evanston) — short segments, residential area, slow.
//       Purple Express uses Red Line tracks downtown at Red Line speeds.
const LINE_SPEED_PROFILES = {
  BL: { cruiseMps: 25, overheadMs: 28000 }, // 56 mph — expressway median, long runs
  RD: { cruiseMps: 22, overheadMs: 30000 }, // 49 mph — subway + elevated mix
  GR: { cruiseMps: 20, overheadMs: 30000 }, // 45 mph — elevated, mixed segments
  OR: { cruiseMps: 20, overheadMs: 30000 }, // 45 mph — Midway branch ROW
  YL: { cruiseMps: 20, overheadMs: 25000 }, // 45 mph — Skokie Swift, few stops
  BR: { cruiseMps: 18, overheadMs: 32000 }, // 40 mph — tight Ravenswood curves
  PK: { cruiseMps: 18, overheadMs: 32000 }, // 40 mph — Cermak branch curves
  PR: { cruiseMps: 16, overheadMs: 30000 }, // 36 mph — Evanston local, short hops
};
// Downtown Loop elevated: tight 90° turns, speed-restricted, short blocks
const LOOP_SPEED = { cruiseMps: 14, overheadMs: 25000 }; // 31 mph
// Fallback for unknown lines
const DEFAULT_SPEED = { cruiseMps: 20, overheadMs: 30000 }; // 45 mph

const ETA_DEFAULTS = {
  // Minimum travel time between adjacent stations
  MIN_TRAVEL_MS: 20000,
  // Maximum travel time between adjacent stations (cap for very long segments)
  MAX_TRAVEL_MS: 600000,
  // Distance before station at which "approaching" begins (degrees, ~300m)
  // Used to compute approaching progress as a function of segment length
  // so a 7km segment doesn't jump to 80% when isApp fires.
  APPROACHING_DISTANCE: 0.003,
  // Distance before station to hold at when waiting for isApp (degrees, ~200m)
  // Replaces the old fixed 0.95 cap that stalled trains 350m+ short on long segments.
  HOLD_DISTANCE: 0.002,
  // Smoothing factor for progress updates (0..1, lower = smoother)
  PROGRESS_SMOOTHING: 0.15,
};

/**
 * Finds the index of a station in a line's sequence by name.
 * When duplicate names exist (e.g., "Western" on Blue Line), preferentially
 * returns the match that comes after prevStationIdx (following travel direction).
 * Returns -1 if not found.
 *
 * Parameters:
 *   sequence: array of station objects
 *   stationName: name to search for
 *   prevStationIdx: optional hint — current/previous station index. When provided,
 *                   prefers matches ahead of this index.
 */
function findStationInSequence(sequence, stationName, prevStationIdx) {
  if (!stationName || !sequence) return -1;
  const clean = cleanStationName(stationName);
  let norm = normalizeStationName(clean);
  // Strip ordinal suffixes (th, st, nd, rd) that may differ between API and GeoJSON
  // E.g., API: "35th-Bronzeville-IIT" → norm: "35 bronzeville iit"
  //      GeoJSON: "35-Bronzeville-IIT" → norm: "35 bronzeville iit"
  norm = norm.replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');

  // Exact matches — prefer ones ahead of prevStationIdx
  let firstExactMatch = -1;
  for (let i = 0; i < sequence.length; i++) {
    let sNorm = normalizeStationName(sequence[i].name);
    // Apply same ordinal stripping to sequence names for comparison
    sNorm = sNorm.replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');
    if (sNorm === norm) {
      if (firstExactMatch === -1) firstExactMatch = i;
      // Prefer matches ahead of current position (for duplicate station names)
      if (prevStationIdx !== undefined && i > prevStationIdx) return i;
    }
  }
  if (firstExactMatch !== -1) return firstExactMatch;

  // Partial matches — same logic
  let firstPartialMatch = -1;
  for (let i = 0; i < sequence.length; i++) {
    let sNorm = normalizeStationName(sequence[i].name);
    // Apply same ordinal stripping for consistent comparison
    sNorm = sNorm.replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');
    if (sNorm.includes(norm) || norm.includes(sNorm)) {
      if (firstPartialMatch === -1) firstPartialMatch = i;
      // Prefer matches ahead of current position
      if (prevStationIdx !== undefined && i > prevStationIdx) return i;
    }
  }
  if (firstPartialMatch !== -1) return firstPartialMatch;

  return -1;
}

// Downtown Loop elevated station names — used to detect when a segment
// is on the Loop (where trains crawl at restricted speed through tight turns).
const LOOP_STATION_NAMES = new Set([
  'Washington/Wells', 'Quincy', 'LaSalle/Van Buren', 'Library',
  'Adams/Wabash', 'Washington/Wabash', 'State/Lake', 'Clark/Lake',
]);

/**
 * Returns the speed profile for a segment between two stations on a given line.
 * Uses Loop speed when either endpoint is on or directly adjacent to the downtown Loop.
 *
 * The Loop consists of 8 stations in downtown Chicago. Loop lines (BR, OR, PK, PR)
 * also have approach/exit segments that are slow:
 *   - Brown/Purple approach: Sedgwick → Chicago → Merchandise Mart (entry)
 *   - Orange approach: Halsted → Roosevelt (entry)
 *   - Pink approach: Ashland → Morgan → Clinton (entry) / Quincy → Washington/Wells (exit)
 *   - Green approach: Morgan → Clinton (entry)
 */
function getSegmentSpeed(legend, fromStation, toStation) {
  // If either endpoint is on the Loop, use Loop speed (not just both endpoints).
  // This catches both fully-Loop segments and approach/exit segments.
  if (LOOP_STATION_NAMES.has(fromStation.name) || LOOP_STATION_NAMES.has(toStation.name)) {
    return LOOP_SPEED;
  }

  // Also check for approach/exit stations on loop lines that often approach the Loop
  const approachStations = new Set([
    'Sedgwick',           // Brown/Purple approach to Loop
    'Chicago',            // Brown/Purple approach to Loop
    'Merchandise Mart',   // Brown/Purple Loop entry
    'Halsted',            // Orange approach to Loop
    'Roosevelt',          // Orange Loop entry; also start of southbound approach
    'Ashland',            // Pink approach to Loop
    'Morgan',             // Pink/Green approach to Loop
    'Clinton',            // Pink/Green Loop entry; also Loop exit
    'Division',           // Brown/Purple Loop exit
  ]);

  if (LOOP_LINE_CODES.includes(legend) &&
      (approachStations.has(fromStation.name) || approachStations.has(toStation.name))) {
    return LOOP_SPEED;
  }

  return LINE_SPEED_PROFILES[legend] || DEFAULT_SPEED;
}

/**
 * Estimates travel time between two stations based on track distance and
 * line-specific speed profiles.
 *
 * Model: travel_time = overhead + (meters / cruise_speed)
 *   - overhead covers accel from stop + decel to stop
 *   - cruise_speed varies by line (Blue Line expressway vs Brown Line curves)
 *   - Loop segments use a slower profile (tight elevated turns)
 */
function estimateTravelTime(fromStation, toStation, legend) {
  const dist = geoDist(fromStation.lon, fromStation.lat, toStation.lon, toStation.lat);
  const meters = dist * 111000;
  const speed = getSegmentSpeed(legend, fromStation, toStation);
  const ms = speed.overheadMs + (meters / speed.cruiseMps) * 1000;
  return Math.max(ETA_DEFAULTS.MIN_TRAVEL_MS, Math.min(ETA_DEFAULTS.MAX_TRAVEL_MS, ms));
}

/**
 * Determines direction (+1 or -1 along sequence index) based on the
 * relationship between prevStationIdx and nextStationIdx.
 *
 * This is simple: if nextStationIdx > prevStationIdx, we're moving +1
 * (increasing index).  If lower, -1.
 *
 * For initial state (no previous station), we use the destination to
 * figure out which way to go.
 */
function inferSequenceDirection(legend, destNm, sequence, nextStationIdx) {
  if (!sequence || sequence.length < 2) return +1;
  if (!destNm) return +1;

  // Try to find the destination station directly in the sequence.
  // Note: do NOT use nextStationIdx as a hint here. The destination could be
  // behind the next station if the train is heading backward (e.g., a train
  // heading north with destination "Western" might have nextStaNm pointing
  // to a station south of it). Just find the destination without position hints.
  const destIdx = findStationInSequence(sequence, destNm);
  if (destIdx !== -1 && nextStationIdx !== undefined) {
    if (destIdx > nextStationIdx) return +1;
    if (destIdx < nextStationIdx) return -1;
    // At the destination station — fallback below
  }

  // For loop lines with "Loop" destination, the Loop stations are at the
  // HIGH end of the sequence, so direction is +1.
  const northDest = LINE_NORTH_DESTS[legend];
  if (northDest) {
    const destIsNorth = destNm.toUpperCase().includes(northDest.toUpperCase());
    // CTA_STATION_ORDERS puts the "north" terminal first (index 0)
    // and the Loop / south terminal last.
    const firstIsNorth = sequence[0].name.toUpperCase().includes(northDest.toUpperCase());
    const lastIsNorth = sequence[sequence.length - 1].name.toUpperCase().includes(northDest.toUpperCase());
    if (destIsNorth) {
      if (firstIsNorth) return -1;
      if (lastIsNorth) return +1;
      if (LOOP_LINE_CODES.includes(legend)) return +1;
      return -1;
    } else {
      if (firstIsNorth) return +1;
      if (lastIsNorth) return -1;
      if (LOOP_LINE_CODES.includes(legend)) return -1;
      return +1;
    }
  }

  return +1;
}

/**
 * Initialize or update ETA state for a train based on fresh API data.
 *
 * Called on each poll with the train object from fetchTrains().
 * Updates the internal state machine so advanceEtaTrains() can interpolate.
 *
 * Key design decisions:
 *   - Direction is ONLY set on initialization (from destination name) and on
 *     station transitions (from index progression).  It is NEVER recalculated
 *     from the destination name on every poll — that caused direction flipping
 *     when Loop signage changed mid-transit.
 *   - Reversals require 2 consecutive confirming polls (anti-jitter hold).
 *   - Track distances are cached per transition using trackDistanceBetween()
 *     so progress interpolation uses actual track geometry, not straight-line.
 *   - Initial placement uses GPS as a hint to estimate progress between stations
 *     instead of an arbitrary 0.3 default.
 *
 * Some trains (especially Yellow and Purple lines) don't report nextStaNm
 * or any ETA data.  These trains are marked with _etaFallbackGps = true
 * so the animation loop knows to use GPS-based positioning instead.
 */
function updateEtaTrainState(train, stationSequences, lineSegments) {
  const sequence = getTrainSequence(train.legend, train.destNm, stationSequences);
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
    if (state) {
      if (!state._noDataSince) {
        state._noDataSince = now;
      } else if (now - state._noDataSince > 60000) {
        etaTrainState.delete(rn);
      }
    }
    return;
  }

  train._etaFallbackGps = false;

  // When looking up nextStaNm, use the current/previous station as a hint so
  // duplicate station names (e.g., "Western" on Blue Line) resolve to the correct
  // one ahead of the current position. For new trains, state is null so hint is undefined.
  const prevStationIdx = state ? state.prevStationIdx : undefined;
  const nextIdx = findStationInSequence(sequence, nextStaNm, prevStationIdx);

  if (nextIdx === -1) {
    train._etaFallbackGps = true;
    console.warn(`[ETA-AI] rn=${rn} (${train.legend}): nextStaNm="${nextStaNm}" not found in sequence → GPS fallback`);
    return;
  }

  // Get line segments for track distance calculations
  const segLegend = train.legend.replace(/_.*$/, '');
  const segs = lineSegments ? lineSegments[segLegend] : null;

  if (!state) {
    // --- New train: initialize from destination + GPS hint ---
    let direction = inferSequenceDirection(train.legend, train.destNm, sequence, nextIdx);

    // CRITICAL: Verify inferred direction against GPS position.
    // inferSequenceDirection() uses destination name parsing which is fragile
    // (especially on lines with similar destination names or Loop re-signage).
    // If the train's actual position is closer to what we calculated as nextIdx
    // than prevIdx, the inferred direction was backwards — flip it.
    // This prevents direction flipping when switching to ETA-AI tracking mode.
    {
      const prevIdx_candidate = Math.max(0, Math.min(sequence.length - 1, nextIdx - direction));
      const prevStn_candidate = sequence[prevIdx_candidate];
      const nextStn_candidate = sequence[nextIdx];

      const distToPrev = geoDist(train.lon, train.lat, prevStn_candidate.lon, prevStn_candidate.lat);
      const distToNext = geoDist(train.lon, train.lat, nextStn_candidate.lon, nextStn_candidate.lat);

      // If train is actually much closer to the "next" station (10%+ closer),
      // the direction was inverted. Flip it.
      if (distToNext < distToPrev * 0.9) {
        direction = -direction;
      }
    }

    const prevIdx = Math.max(0, Math.min(sequence.length - 1, nextIdx - direction));

    // Use GPS position to estimate initial progress between prevStation and nextStation
    // instead of an arbitrary 0.3, so trains appear where they actually are.
    const prevStn = sequence[prevIdx];
    const nextStn = sequence[nextIdx];
    const stationGap = geoDist(prevStn.lon, prevStn.lat, nextStn.lon, nextStn.lat);
    let initialProgress;
    if (isApp === '1') {
      // Approaching — place at distance-based approach point (~300m out)
      initialProgress = stationGap > 1e-6
        ? Math.max(0.5, 1 - ETA_DEFAULTS.APPROACHING_DISTANCE / stationGap)
        : 0.80;
    } else if (stationGap > 1e-6) {
      const fromPrev = geoDist(train.lon, train.lat, prevStn.lon, prevStn.lat);
      initialProgress = Math.max(0.05, Math.min(0.95, fromPrev / stationGap));
    } else {
      initialProgress = 0.3;
    }

    // Cache actual track distance and walk direction for accurate interpolation.
    // Walk direction is resolved empirically — sequence index order does NOT
    // necessarily match GeoJSON segment direction.
    let trackDist = null;
    let walkDir = null;
    if (segs && sequence[prevIdx].trackPos && sequence[nextIdx].trackPos) {
      walkDir = resolveTrackWalkDir(sequence[prevIdx].trackPos, sequence[nextIdx].trackPos, segs);
      trackDist = trackDistanceBetween(
        sequence[prevIdx].trackPos, sequence[nextIdx].trackPos, walkDir, segs
      );
    }

    state = {
      rn,
      legend: train.legend,
      sequenceKey: train.legend, // tracks which sequence variant we're using
      prevStationIdx: prevIdx,
      nextStationIdx: nextIdx,
      progress: initialProgress,
      direction,
      lastNextStaNm: nextStaNm,
      lastIsApp: isApp,
      stateChangeTime: now,
      estimatedTravelMs: estimateTravelTime(sequence[prevIdx], sequence[nextIdx], train.legend),
      arrivalTimeMs: null,
      isApproaching: isApp === '1',
      atStation: false,
      dwellStartTime: null,
      _noDataSince: null,
      cachedTrackDist: trackDist,
      cachedWalkDir: walkDir,
      _reversalHoldCount: 0,
      _pendingReversalIdx: null,
    };
    etaTrainState.set(rn, state);
    return;
  }

  // --- Existing train ---
  state._noDataSince = null;

  // Check if the train switched branches (e.g. GR destination changed)
  const newSeqKey = train.legend === 'GR'
    ? (getTrainSequence('GR', train.destNm, stationSequences) === stationSequences['GR_CG'] ? 'GR_CG' : 'GR')
    : train.legend;
  if (newSeqKey !== state.sequenceKey) {
    // Branch changed — re-initialize
    etaTrainState.delete(rn);
    updateEtaTrainState(train, stationSequences, lineSegments);
    return;
  }

  // IMPORTANT: Do NOT recalculate direction from destination name here.
  // Direction is only updated on station transitions (derived from index
  // progression) or on initialization.  Recalculating from destNm every
  // poll caused direction flipping when Loop signage changed mid-transit.

  if (nextStaNm !== state.lastNextStaNm) {
    // Station changed — train has moved past a station.
    const oldNextIdx = state.nextStationIdx;

    // Derive direction from station index progression.
    // This is far more reliable than destination-name inference because
    // it reflects actual observed movement through the station sequence.
    let newDirection = state.direction;
    if (nextIdx !== oldNextIdx) {
      newDirection = nextIdx > oldNextIdx ? +1 : -1;
    }

    // Reversal hold: if this would flip direction, require 2 consecutive
    // confirming polls with the same nextIdx (not just nextStaNm, which can be
    // ambiguous on lines with duplicate station names like Western/Ashland).
    // This filters out API jitter where nextStaNm briefly reports a station
    // behind the train (stale data from the previous poll).
    if (newDirection !== state.direction) {
      if (state._pendingReversalIdx === nextIdx) {
        state._reversalHoldCount++;
      } else {
        state._pendingReversalIdx = nextIdx;
        state._reversalHoldCount = 1;
      }
      if (state._reversalHoldCount < 2) {
        console.log(`[ETA-AI] Reversal hold: rn=${rn} (${train.legend}) ` +
          `${sequence[oldNextIdx]?.name}→${sequence[nextIdx]?.name} ` +
          `dir ${state.direction}→${newDirection} [${state._reversalHoldCount}/2]`);
        // Important: update lastIsApp before returning so isApp state isn't lost
        state.lastIsApp = isApp;
        return; // Don't update state yet — wait for confirmation
      }
      console.log(`[ETA-AI] Reversal confirmed: rn=${rn} (${train.legend}) ` +
        `dir ${state.direction}→${newDirection}`);
    }

    // Clear reversal tracking
    state._pendingReversalIdx = null;
    state._reversalHoldCount = 0;

    // Cache actual track distance and walk direction for the new segment
    let trackDist = null;
    let walkDir = null;
    if (segs && sequence[oldNextIdx]?.trackPos && sequence[nextIdx]?.trackPos) {
      walkDir = resolveTrackWalkDir(sequence[oldNextIdx].trackPos, sequence[nextIdx].trackPos, segs);
      trackDist = trackDistanceBetween(
        sequence[oldNextIdx].trackPos, sequence[nextIdx].trackPos, walkDir, segs
      );
    }

    state.direction = newDirection;
    state.prevStationIdx = oldNextIdx;
    state.nextStationIdx = nextIdx;
    state.progress = 0;
    state.stateChangeTime = now;
    state.estimatedTravelMs = estimateTravelTime(
      sequence[oldNextIdx], sequence[nextIdx], train.legend
    );
    state.isApproaching = isApp === '1';
    state.atStation = false;
    state.dwellStartTime = null;
    state.lastNextStaNm = nextStaNm;
    state.lastIsApp = isApp;
    state.arrivalTimeMs = null;
    state.cachedTrackDist = trackDist;
    state.cachedWalkDir = walkDir;
    return;
  }

  // Same station as before — clear reversal tracking
  state._pendingReversalIdx = null;
  state._reversalHoldCount = 0;

  if (isApp !== state.lastIsApp) {
    if (isApp === '1' && !state.isApproaching) {
      // Mark as approaching — advanceEtaTrains will compute the distance-
      // based approach progress and interpolate toward 1.0 from there.
      // Don't jump progress forward here; the interpolation loop handles it
      // using the segment length so short and long segments behave correctly.
      state.isApproaching = true;
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

    const sequence = getTrainSequence(train.legend, train.destNm, stationSequences);
    const segLegend = train.legend.replace(/_.*$/, '');
    const segs = lineSegments[segLegend];
    if (!sequence || !segs) continue;

    const prevStation = sequence[state.prevStationIdx];
    const nextStation = sequence[state.nextStationIdx];
    if (!prevStation || !nextStation) continue;

    // ---- Track distance (needed by both progress and position) ----
    // Use cached track distance (actual walk along track geometry) when
    // available; fall back to geodesic distFromStart difference.
    const fromPos = prevStation.trackPos;
    const toPos = nextStation.trackPos;
    const totalTrackDist = state.cachedTrackDist
      || Math.abs(nextStation.distFromStart - prevStation.distFromStart);

    // ---- Progress: train can NEVER overshoot the next station ----
    // Progress is clamped to [0, 1] where 1.0 = exactly at nextStation.
    // Once the train arrives (progress == 1), it dwells there until the
    // API confirms a station change.  This prevents the backward-snap
    // artifact where a train overshoots, then jumps back when progress
    // resets to 0 on the next segment.

    // Compute distance-based progress limits for this segment.
    // On short segments (e.g. Loop stations ~400m apart), these resolve to
    // ~0.50 and ~0.25 — similar to the old fixed fractions.
    // On long segments (e.g. O'Hare→Rosemont ~4km), they resolve to ~0.999
    // and ~0.997 — the train travels almost the full distance before holding.
    const segDist = totalTrackDist > 1e-6 ? totalTrackDist
      : geoDist(prevStation.lon, prevStation.lat, nextStation.lon, nextStation.lat);
    // holdProgress: how far to go before waiting for isApp (keeps ~200m gap)
    const holdProgress = segDist > 1e-6
      ? Math.max(0.5, 1 - ETA_DEFAULTS.HOLD_DISTANCE / segDist)
      : 0.95;
    // approachProgress: where to place the train when isApp fires (~300m out)
    const approachProgress = segDist > 1e-6
      ? Math.max(0.5, 1 - ETA_DEFAULTS.APPROACHING_DISTANCE / segDist)
      : 0.80;

    if (state.atStation) {
      // Dwelling at station — pin to exactly 1.0.
      // Time out after 60s to prevent permanent stalls when the API is slow
      // to update nextStaNm.
      state.progress = 1;
      if (state.dwellStartTime && now - state.dwellStartTime > 60000) {
        state.atStation = false;
        state.progress = 0.99;
      }
    } else {
      let targetProgress;

      if (state.arrivalTimeMs) {
        // Use precise ETA timing — cap at 1.0 (station arrival)
        const timeToArrival = state.arrivalTimeMs - now;
        const totalTravelTime = state.arrivalTimeMs - state.stateChangeTime;
        if (totalTravelTime > 0) {
          targetProgress = 1 - (timeToArrival / totalTravelTime);
        } else {
          targetProgress = 1;
        }
      } else if (state.isApproaching) {
        // Approaching: interpolate from current progress toward 1.0.
        // Start from at least approachProgress (~300m out) — but if the
        // train was already past that point (long segment, isApp came late),
        // continue from current progress so it never jumps backward.
        const approachBase = Math.max(state.progress, approachProgress);
        const approachElapsed = now - state.stateChangeTime;
        const approachDuration = 15000; // ~15 seconds from "approaching" to arrival
        const approachT = Math.min(1, approachElapsed / approachDuration);
        targetProgress = approachBase + (1 - approachBase) * approachT;
      } else {
        // Normal transit: time-based interpolation.
        // Cap at holdProgress (~200m before station) while waiting for isApp.
        // If the estimated travel time has fully elapsed without isApp, creep toward
        // the station at ~5% per minute (reaches 0.995 from 0.95 in ~54 seconds)
        // so trains don't stall indefinitely when isApp is never reported.
        const elapsed = now - state.stateChangeTime;
        const baseProgress = elapsed / state.estimatedTravelMs;
        if (baseProgress >= holdProgress) {
          const overtime = elapsed - state.estimatedTravelMs;
          // Creep at ~5% of progress per minute, taking ~1 minute to go 0.95→1.0
          const creepRatePerMs = 0.05 / 60000;
          const creep = overtime > 0 ? overtime * creepRatePerMs : 0;
          targetProgress = Math.min(0.995, holdProgress + creep);
        } else {
          targetProgress = baseProgress;
        }
      }

      // Hard clamp — progress must NEVER exceed 1.0
      targetProgress = Math.max(0, Math.min(1, targetProgress));

      // Smooth progress (lerp toward target)
      const smoothing = 1 - Math.pow(1 - ETA_DEFAULTS.PROGRESS_SMOOTHING, dt / 16);
      state.progress += (targetProgress - state.progress) * smoothing;
      state.progress = Math.max(0, Math.min(1, state.progress));

      // Enter dwell state when we've arrived at the station
      if (state.progress >= 0.995) {
        state.atStation = true;
        state.dwellStartTime = now;
        state.progress = 1; // snap to exactly 1.0
      }
    }

    // ---- Position on track from progress ----
    // Use the empirically resolved walk direction (cached when the segment
    // was first set up).  This is the actual track geometry direction from
    // prevStation to nextStation — NOT derived from sequence index order,
    // which can disagree with track geometry on Loop lines.
    const walkDir = state.cachedWalkDir
      || resolveTrackWalkDir(fromPos, toPos, segs);

    if (totalTrackDist < 1e-6 || state.progress >= 1) {
      // At the station (or stations are the same point) — snap exactly.
      // Derive direction from a small look-ahead past the station so the
      // heading arrow points the way the train will continue, not an
      // arbitrary segment direction.
      train.lon = nextStation.lon;
      train.lat = nextStation.lat;
      train._trackPos = { ...toPos };
      const lookAhead = advanceOnTrack(toPos, 0.001, walkDir, segs);
      train._direction = lookAhead.direction !== undefined ? lookAhead.direction : walkDir;
    } else {
      // Advance along track from prevStation toward nextStation
      const advanceDist = state.progress * totalTrackDist;
      const pos = advanceOnTrack(fromPos, advanceDist, walkDir, segs, {
        targetLon: toPos.lon,
        targetLat: toPos.lat,
      });
      train.lon = pos.lon;
      train.lat = pos.lat;
      train._trackPos = pos;
      // Use the segment-relative direction from the track walker for arrow rendering.
      // pos.direction is updated by advanceOnTrack when crossing segment boundaries.
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
    updateEtaTrainState(train, stationSequences, lineSegments);

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
