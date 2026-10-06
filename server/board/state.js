'use strict';
// Board state: per-board config and overrides, persisted as one small JSON
// file on the Fly volume (see docs/board/contract.md, "Server state file").
//
// The file lives outside the app directory on purpose: server.js serves any
// file under the app directory as a static file.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { measure } = require('./fonts');
const { HEADER_NAME_PX } = require('./station-names');

const FILE_NAME = 'board-state.json';
const DEFAULT_BOARD_ID = 'home';
const DEFAULT_MAPID = '40100'; // Morse

const SCREENS = ['auto', 'transit', 'ticker', 'weather', 'baseball'];
const BASEBALL_LAYOUTS = ['classic', 'logos'];
const LINE_CODES = ['RD', 'BL', 'BR', 'GR', 'OR', 'PR', 'PK', 'YL'];
const ROW_RE = new RegExp(`^(${LINE_CODES.join('|')}):[^:]{1,24}$`);
const BOARD_ID_RE = /^[a-z0-9-]{1,32}$/;
const MAX_ROWS = 24; // Clark/Lake can have 18 destinations

class ValidationError extends Error {}

function loadStations() {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'stations.json'), 'utf8'));
  return new Map(list.map((s) => [s.mapid, s]));
}

// Where the state file lives: BOARD_STATE_DIR if set, else the Fly volume at
// /data, else a temp dir for local development (with a warning).
function resolveDir(log = console) {
  if (process.env.BOARD_STATE_DIR) return process.env.BOARD_STATE_DIR;
  if (fs.existsSync('/data')) return '/data';
  const dir = path.join(os.tmpdir(), 'ctamap-board');
  log.warn(`[board] /data not found; using ${dir} for board state (local dev only)`);
  return dir;
}

function defaultBoard(stations) {
  const st = stations.get(DEFAULT_MAPID);
  return {
    v: 1,
    station: { mapid: DEFAULT_MAPID, name: st ? st.short : 'MORSE' },
    rows: [],
    showHeader: true,
    showWeather: true,
    screen: 'auto',
    bright: 'auto',
    // Auto screen: show the radar for `radarFor` seconds every `radarEvery`
    // minutes while rain is in the box. 0 = never (stay on transit).
    radarEvery: 0,
    radarFor: 60,
    // Radar screen: show the frame's time and AM/PM.
    radarTime: true,
    // Baseball screen layout: 'classic' (color blocks + abbreviations) or
    // 'logos' (team logo bands, from the uploaded sprite sheet).
    baseballLayout: 'classic',
  };
}

// Validate a partial update and return the fields to apply. Throws
// ValidationError with a short message on anything unexpected.
function validatePatch(patch, stations) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ValidationError('body must be an object');
  const out = {};
  for (const [key, val] of Object.entries(patch)) {
    switch (key) {
      case 'station': {
        if (!val || typeof val !== 'object') throw new ValidationError('station must be an object');
        const st = stations.get(String(val.mapid));
        if (!st) throw new ValidationError(`unknown mapid: ${val.mapid}`);
        let name = st.short;
        if (val.name !== undefined) {
          if (typeof val.name !== 'string' || !val.name.trim()) throw new ValidationError('station.name must be a non-empty string');
          name = val.name.trim().toUpperCase();
          let w;
          try { w = measure('small', name); } catch (e) { throw new ValidationError('station.name has characters the board font lacks'); }
          if (w > HEADER_NAME_PX) throw new ValidationError(`station.name is ${w}px; max ${HEADER_NAME_PX}px`);
        }
        out.station = { mapid: st.mapid, name };
        break;
      }
      case 'rows':
        if (!Array.isArray(val) || val.length > MAX_ROWS || !val.every((r) => typeof r === 'string' && ROW_RE.test(r))) {
          throw new ValidationError(`rows must be up to ${MAX_ROWS} strings like "RD:Howard"`);
        }
        out.rows = [...val];
        break;
      case 'showHeader':
      case 'showWeather':
      case 'radarTime':
        if (typeof val !== 'boolean') throw new ValidationError(`${key} must be true or false`);
        out[key] = val;
        break;
      case 'baseballLayout':
        if (!BASEBALL_LAYOUTS.includes(val)) throw new ValidationError(`baseballLayout must be one of ${BASEBALL_LAYOUTS.join(', ')}`);
        out.baseballLayout = val;
        break;
      case 'screen':
        if (!SCREENS.includes(val)) throw new ValidationError(`screen must be one of ${SCREENS.join(', ')}`);
        out.screen = val;
        break;
      case 'radarEvery':
        if (!Number.isInteger(val) || val < 0 || val > 60) throw new ValidationError('radarEvery must be 0 (off) or 1-60 minutes');
        out.radarEvery = val;
        break;
      case 'radarFor':
        if (!Number.isInteger(val) || val < 10 || val > 600) throw new ValidationError('radarFor must be 10-600 seconds');
        out.radarFor = val;
        break;
      case 'bright':
        if (!(val === 'auto' || val === 'off' || (Number.isInteger(val) && val >= 0 && val <= 100))) {
          throw new ValidationError('bright must be "auto", "off", or an integer 0-100');
        }
        out.bright = val;
        break;
      default:
        throw new ValidationError(`unknown field: ${key}`);
    }
  }
  return out;
}

function createStore({ dir = resolveDir(), stations = loadStations(), log = console } = {}) {
  const file = path.join(dir, FILE_NAME);
  let state;

  function save() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(tmp, file);
  }

  function load() {
    try {
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!state || typeof state.boards !== 'object') throw new Error('missing "boards"');
      // The radar screen was renamed weather.
      for (const b of Object.values(state.boards)) if (b && b.screen === 'radar') b.screen = 'weather';
    } catch (e) {
      if (e.code !== 'ENOENT') {
        const aside = `${file}.corrupt-${Date.now()}`;
        log.error(`[board] state file unreadable (${e.message}); moved to ${aside}, starting from defaults`);
        try { fs.renameSync(file, aside); } catch (_) { /* nothing to move */ }
      }
      state = { boards: { [DEFAULT_BOARD_ID]: defaultBoard(stations) } };
      save();
    }
  }

  load();

  return {
    file,
    get: (id) => (Object.hasOwn(state.boards, id) ? state.boards[id] : null),
    all: () => state,

    // Apply a validated partial update; creates the board from defaults if
    // it doesn't exist yet. Always bumps v so the board refetches.
    update(id, patch) {
      if (!BOARD_ID_RE.test(id)) throw new ValidationError('board id must be 1-32 chars of a-z, 0-9, -');
      const fields = validatePatch(patch, stations);
      const board = Object.hasOwn(state.boards, id) ? state.boards[id] : defaultBoard(stations);
      // A destination filter belongs to its station: a new station starts
      // with all destinations unless the patch sets rows too.
      if (fields.station && fields.station.mapid !== board.station.mapid && !fields.rows) fields.rows = [];
      Object.assign(board, fields);
      board.v = (board.v || 0) + 1;
      state.boards[id] = board;
      save();
      return board;
    },

    // Board restart: brightness goes back to auto (so a board left off comes
    // back lit); the chosen screen, station, rows, and toggles persist. Bumps v.
    boot(id) {
      if (!Object.hasOwn(state.boards, id)) return null;
      const board = state.boards[id];
      board.bright = 'auto';
      board.v += 1;
      save();
      return board;
    },
  };
}

module.exports = { createStore, validatePatch, ValidationError, resolveDir, DEFAULT_BOARD_ID, SCREENS, BASEBALL_LAYOUTS };
