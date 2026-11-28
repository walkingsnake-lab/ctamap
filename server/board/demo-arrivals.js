'use strict';
// Made-up train arrivals for photographing and filming a board (contract
// "Control endpoints", api/test `arrivals`). Every line at the station runs
// on a fixed headway, each direction at its own offset, so the board always
// has trains to show and they count down through DUE and leave like real
// ones, whatever CTA is running at the hour of the shoot.
//
// The schedule is a pure function of the station and the time: a train's
// arrival time and run number are the same in every update that lists it,
// so the board's countdown never jumps and chrono rows keep their identity.
// Nothing here is fetched and nothing is kept.

const { LINE_ORDER, DEST_MAPID, HOWARD_LAT, shortDest, fullDest, originOf } = require('./destinations');
const STATION_DIRS = require('./station-dirs.json');

// How far ahead trains are listed (s): about what Train Tracker predicts.
const HORIZON = 1500;
// An arrival is listed until this long after its time (DROP_GRACE in arrivals.js).
const GRACE = 30;

// Each line's trains: destination (Train Tracker `destNm`), direction (trDr)
// and headway in seconds. `shift` puts one branch's trains halfway between
// the other's where two share a direction (Green's south ends alternate).
// Run numbers start at `rn`.
const SERVICE = {
  RD: { rn: 801, to: [{ dest: 'Howard', dir: 1, every: 360 }, { dest: '95th/Dan Ryan', dir: 5, every: 360 }] },
  BL: { rn: 101, to: [{ dest: "O'Hare", dir: 1, every: 420 }, { dest: 'Forest Park', dir: 5, every: 420 }] },
  BR: { rn: 401, to: [{ dest: 'Kimball', dir: 1, every: 480 }, { dest: 'Loop', dir: 5, every: 480 }] },
  GR: { rn: 601, to: [{ dest: 'Harlem/Lake', dir: 1, every: 600 }, { dest: '63rd Street', dir: 5, every: 1200 }, { dest: 'Cottage Grove', dir: 5, every: 1200, shift: 600 }] },
  OR: { rn: 701, to: [{ dest: 'Loop', dir: 1, every: 540 }, { dest: 'Midway', dir: 5, every: 540 }] },
  PR: { rn: 501, to: [{ dest: 'Linden', dir: 1, every: 720 }, { dest: 'Howard', dir: 5, every: 720 }, { dest: 'Loop', dir: 5, every: 720 }] },
  PK: { rn: 301, to: [{ dest: 'Loop', dir: 1, every: 600 }, { dest: '54th/Cermak', dir: 5, every: 600 }] },
  YL: { rn: 591, to: [{ dest: 'Dempster-Skokie', dir: 1, every: 720 }, { dest: 'Howard', dir: 5, every: 720 }] },
};
// Run numbers per line stay inside this many, so they read like CTA's.
const RN_SPAN = { YL: 9 };
const RN_SPAN_DEFAULT = 80;

// Green's two south branches: a station on one never sees the other's
// trains, and its trains to Harlem are only its own branch's (every other one).
const GREEN_BRANCH = { 40940: '63rd Street', 40290: '63rd Street', 41140: 'Cottage Grove', 40720: 'Cottage Grove' };
const GREEN_SOUTH = ['63rd Street', 'Cottage Grove'];

// A line's directions run this far apart (a share of the headway), so the
// two never show the same minutes side by side.
const STAGGER = 0.382;

// FNV-1a, for each line's offset: fixed per station and line.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// Which of a line's streams a station sees: 'board' (people get on),
// 'end' (the run ends here) or null (it doesn't come this way).
function streamAt(st, ln, s) {
  const branch = ln === 'GR' ? GREEN_BRANCH[st.mapid] : null;
  if (branch && GREEN_SOUTH.includes(s.dest) && s.dest !== branch) return null;
  if (DEST_MAPID[s.dest] === st.mapid) return 'end';
  // Purple runs to Howard from Evanston, and Express to the Loop from Howard on.
  if (ln === 'PR' && s.dest === 'Howard') return st.lat > HOWARD_LAT ? 'board' : null;
  if (ln === 'PR' && s.dest === 'Loop' && st.lat > HOWARD_LAT) return null;
  // On the Loop itself a train is already heading back out: Train Tracker
  // names where it's going next, never "Loop".
  if (s.dest === 'Loop' && (STATION_DIRS[st.mapid] || {})[ln] === 'loop') return null;
  return 'board';
}

// st: a stations.json entry. now: epoch seconds. Returns arrivals shaped
// like arrivals.js normalize()'s, soonest first.
function demoArrivals(st, now) {
  const out = [];
  if (!st || !Array.isArray(st.lines)) return out;
  for (const ln of LINE_ORDER) {
    const svc = SERVICE[ln];
    if (!svc || !st.lines.includes(ln)) continue;
    const span = RN_SPAN[ln] || RN_SPAN_DEFAULT;
    svc.to.forEach((s, i) => {
      const kind = streamAt(st, ln, s);
      if (!kind) return;
      // On a Green branch, Harlem trains come as often as the branch's own.
      const every = ln === 'GR' && GREEN_BRANCH[st.mapid] && s.dir === 1 ? s.every * 2 : s.every;
      const offset = (hash(`${st.mapid}:${ln}`) + Math.round(s.dir === 1 ? 0 : every * STAGGER) + (s.shift || 0)) % every;
      // Trains k with now - GRACE <= t <= now + HORIZON, t = offset + k * every.
      const first = Math.ceil((now - GRACE - offset) / every);
      const last = Math.floor((now + HORIZON - offset) / every);
      for (let k = first; k <= last; k++) {
        const t = offset + k * every;
        const rn = String(svc.rn + ((k * svc.to.length + i) % span + span) % span);
        if (kind === 'end') {
          const from = originOf(ln, s.dir);
          out.push({ ln, arr: 1, dest: from ? shortDest(from).name : null, full: from, dir: s.dir, t, s: 0, rn });
        } else {
          out.push({ ln, dest: shortDest(s.dest).name, full: fullDest(s.dest), known: true, dir: s.dir, t, s: 0, rn });
        }
      }
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

module.exports = { demoArrivals, SERVICE, HORIZON, GRACE };
