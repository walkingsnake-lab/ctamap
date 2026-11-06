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
const { messageLayout, cleanMessage, MSG_STYLES, MSG_MAX } = require('./render');

const FILE_NAME = 'board-state.json';
const DEFAULT_BOARD_ID = 'home';
const DEFAULT_MAPID = '40100'; // Morse

const SCREENS = ['auto', 'transit', 'ticker', 'weather', 'baseball', 'clock', 'announce'];
// Announce screen (design spec §15): saved presets per board.
const MAX_PRESETS = 8;
// Clock screen faces (design spec §14, §16-20): the skyline, the seventies
// stripes with VCR digits, the analog dial, the day/night world map, the
// flowing gradient, big digits, and day/date; the word clock on wide
// boards only (WIDE_FACES: a 64 board shows the skyline instead).
const CLOCK_FACES = ['skyline', 'seventies', 'analog', 'daynight', 'gradient', 'digits', 'daydate', 'words'];
const WIDE_FACES = ['words'];
// Analog face accent (the second hand; the wide board's calendar day
// block at 40%): name -> color. amber is the original.
const ANALOG_ACCENTS = {
  amber: '#ffb000', coral: '#ff5a4e', pink: '#ff4fa8', violet: '#a066ff',
  blue: '#4a7dff', cyan: '#22c8e6', mint: '#2fe08a', lime: '#a8e23a',
};
// Skyline clouds: still, 1 px every 16 s, or 1 px every 4 s.
const CLOUD_DRIFTS = ['off', 'slow', 'normal'];
const WHEEL_SPEEDS = ['off', 'slow', 'normal', 'fast'];
const RIPPLE_SPEEDS = ['off', 'slow', 'normal', 'fast'];
const RAIN_SPEEDS = ['slow', 'normal', 'fast'];
const BASEBALL_LAYOUTS = ['classic', 'logos', 'bands'];
// The knob's ring (design spec §10, "Knob"): categories, each opening one
// screen. TRANSIT opens the transit-family screen last chosen (transitScreen:
// rows or ticker); CYCLE opens the auto screen (the rotation; to be rebuilt
// as Cycle). CLOCK (the clock screen) and ANNOUNCE (the owner's message)
// join on boards that can draw them (knobOf's `clock`, `announce`). Sports
// is chosen on the phone only.
const KNOB_RING = ['transit', 'weather', 'cycle'];
const CATEGORY_OF = { auto: 'cycle', transit: 'transit', ticker: 'transit', weather: 'weather', clock: 'clock', announce: 'announce' };
const EXTRA_RING = ['clock', 'announce'];
const knobScreen = (board, cat) => (cat === 'transit' ? board.transitScreen || 'transit' : cat === 'cycle' ? 'auto' : cat);
// Each category's variants, as the knob steps through them with a press
// (peek chooser): transit's screens, the weather views, the clock faces the
// board draws (`faces`).
const variantsOf = (cat, faces) => (cat === 'transit' ? ['transit', 'ticker'] : cat === 'weather' ? WX_VIEWS
  : cat === 'clock' ? faces : []);
const variantOf = (board, cat) => (cat === 'transit' ? board.transitScreen || 'transit' : cat === 'weather' ? board.wxView || 'now'
  : cat === 'clock' ? board.clockFace || 'skyline' : null);
// The ring and where the board's chosen screen sits on it (payload `knob`).
// `vars` and `sel`: each entry's variants and the one it opens on (index;
// 0 for a variant the board can't draw).
// Only peek-capable boards (`peek`) get vars and sel.
const knobOf = (board, { clock = false, announce = false, peek = false, faces = ['skyline'] } = {}) => {
  const ring = ['transit', 'weather', ...(clock ? ['clock'] : []), ...(announce ? ['announce'] : []), 'cycle'];
  const at = Math.max(0, ring.indexOf(CATEGORY_OF[board.screen]));
  if (!peek) return { ring, at };
  const vars = ring.map((c) => variantsOf(c, faces));
  const sel = ring.map((c, i) => Math.max(0, vars[i].indexOf(variantOf(board, c))));
  return { ring, at, vars, sel };
};
// Auto mode and screen options (design spec §10). Defaults reproduce the
// behavior before these were settings.
const AUTO_SCREENS = ['transit', 'ticker'];
const AUTO_EVERY = [30, 60, 120, 300, 600];   // s per screen when Auto alternates
const WX_VISITS = ['off', 'rain', 'always'];  // Rain nearby: never, while raining, always (always: no page control)
// Cycle (screen 'auto'; design spec §10): the screens it takes turns
// between, each for autoEvery s, in this order.
const CYCLE_SCREENS = ['transit', 'ticker', 'weather', 'clock', 'announce', 'baseball'];
const CYCLE_MAX = 6;
const ALERT_JUMPS = ['off', 'warning', 'all']; // jump to weather: never, NWS warnings, watches too
const BB_TEAMS = ['cubs', 'sox', 'post'];
const BB_PRIORITIES = ['live', 'favorite', 'all'];
const LINE_NAMES = ['white', 'line'];
const TRANSIT_LAYOUTS = ['header', 'key'];
// Transit on a wide board (128 x 32, `cols`): northbound | southbound halves
// where that's true at the station, or full-width destination rows.
const WIDE_LAYOUTS = ['split', 'rows'];
const RADAR_CLOCKS = ['frame', 'now', 'age', 'none']; // the radar corner: frame time, current time, how long ago the frame is, or nothing
// The weather screen's view: conditions, 5-day, or hourly (the radar loop
// takes over while rain is in the box), or the radar, always (an empty map
// when dry).
const WX_VIEWS = ['now', '5day', 'hourly', 'radar'];
const TEMP_UNITS = ['F', 'C'];  // temperatures on every weather display
// Retired settings, dropped from saved state on load: per-layout animated
// weather icons (removed Nov 2026; icons are always static), and the rain
// bars' settings (the bars were cut, Nov 2026).
const RETIRED_KEYS = ['iconsNow', 'icons5day', 'iconsHourly', 'iconsRadar', 'wxRain', 'wxRainEvery', 'wxRainLoops'];
// Speed settings: the allowed values (defaults in defaultBoard).
const SPEEDS = {
  tickerHold: [5, 6, 8, 10, 12, 15],         // s each ticker page holds
  tickerSlide: [800, 1200, 1600, 2000],      // ms the ticker slide takes
  radarFrame: [300, 400, 500, 700, 1000],    // ms per radar loop frame
  radarHold: [2, 3, 4, 6, 8],                // s the loop holds on the newest frame
  gameEvery: [30, 45, 60, 90, 120],
};
const LINE_CODES = ['RD', 'BL', 'BR', 'GR', 'OR', 'PR', 'PK', 'YL'];
const ROW_RE = new RegExp(`^(${LINE_CODES.join('|')}):[^:]{1,24}$`);
const BOARD_ID_RE = /^[a-z0-9-]{1,32}$/;
const MAX_BOARDS = 8;
const LABEL_MAX = 24;
const MAX_ROWS = 24; // Clark/Lake can have 18 destinations
// OTA updates (firmware.js): a channel, a pinned build (its short commit), or off.
const FW_CHANNELS = ['stable', 'beta', 'off'];
const FW_PIN_RE = /^[0-9a-f]{7,40}$/;

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
    // A name for people (the control page's board picker); the board itself
    // goes by its ID. Empty: the picker shows the ID.
    label: '',
    station: { mapid: DEFAULT_MAPID, name: st ? st.short : 'MORSE' },
    rows: [],
    showHeader: true,
    showWeather: true,
    // Transit divider line under the header (row 7). (wxDivider, the line
    // above the old weather row, is still accepted but no longer drawn.)
    headerDivider: false,
    wxDivider: true,
    // Transit layout: 'header' (station and clock on top) or 'key' (a
    // "trains to / min" key on top, station and clock under a line at the bottom).
    transitLayout: 'header',
    wideLayout: 'split',
    screen: 'transit',
    // The transit-family screen the knob's TRANSIT opens: the last of
    // transit and ticker chosen. Kept by the store, not set directly.
    transitScreen: 'transit',
    bright: 'auto',
    // Auto brightness's night level, percent (full from sunrise to sunset). On
    // a board with a light sensor, its dark-room level (a bright room is full).
    brightMin: 40,
    // Retired (Nov 2026): Auto's main screens, replaced by `cycle`. Still
    // accepted; nothing reads it.
    autoScreens: ['transit'],
    // Cycle (screen 'auto'): its screens in order, each shown autoEvery s.
    cycle: ['transit', 'weather'],
    autoEvery: 60,
    // Rain nearby (an interruption): the radar for `radarFor` s every
    // `radarEvery` min on any chosen screen but weather: 'off', 'rain'
    // (while rain is in the box), or 'always'.
    wxVisit: 'off',
    radarEvery: 4,
    radarFor: 60,
    // Retired (Nov 2026): jump to the weather screen for NWS alerts. Still
    // accepted; nothing reads it.
    alertJump: 'off',
    // Baseball: which games take over Auto, their windows, and which
    // games rotate while one is live ('live': live only; 'favorite': live
    // Cubs/Sox only when one is on; 'all': every shown game).
    bbTeams: ['cubs', 'sox', 'post'],
    bbPre: 30,
    bbFinal: 15,
    bbPriority: 'live',
    // Lines & destinations: lines turned off at this station (codes), and
    // whether trains of lines that don't serve it (reroutes) show.
    hideLines: [],
    otherLines: true,
    // Transit and chrono labels: 'white' or 'line' (the line's color).
    lineNames: 'white',
    // Transit and ticker header: the clock at the right.
    headerClock: true,
    // Transit times: third time dimmer than the second (100/40/20%) instead
    // of both later times at 40%.
    timeSteps: false,
    // Radar screen: show a clock and AM/PM (off: current conditions instead).
    radarTime: true,
    // The radar clock: 'frame' (the frame's time, dim) or 'now' (the current
    // time, white).
    radarClock: 'frame',
    // The temperature under the radar clock (A/P on the clock line).
    radarCond: false,
    // Radar precipitation brightness, percent of the base palette.
    radarBright: 100,
    // Weather screen: a temperature-colored shadow behind the big temperature.
    tempShadow: false,
    // Wide boards' 7-day and 24-hour layouts: today's conditions bar on top
    // (false: the layout takes the whole panel, with lows / rain chances).
    wxTop: true,
    // Temperature unit on every weather display: 'F' or 'C'.
    tempUnit: 'F',
    // Clock digits roll when the time changes (every clock: header, radar, faces).
    clockRoll: true,
    // Weather screen without rain: 'now' (current conditions), '5day'
    // (today on top, the next five days in columns), or 'hourly' (today on
    // top, 3/6/9/12 hours ahead in columns).
    wxView: 'now',
    // Announce screen (design spec §15): the message on it ({text, style,
    // id}; null: none yet, the screen asks for one) and saved presets
    // ({text, style}). id is the board's v when the message was set: a new
    // one replays its intro on the board.
    msg: null,
    msgPresets: [],
    // Clock screen face (CLOCK_FACES), and the skyline face's quarter-hour boats.
    clockFace: 'skyline',
    boats: true,
    cloudDrift: 'slow',
    // Skyline motion: wheel rainbow and ripple speed (off is still), star
    // twinkle, rain/snow speed; and whether the temperature shows (a watch
    // or warning shows either way).
    wheelSpeed: 'normal',
    rippleSpeed: 'normal',
    twinkle: true,
    rainSpeed: 'normal',
    showTemp: true,
    // Gradient clock face: lit gradient digits on black instead of digits cut out of the gradient.
    gradInvert: false,
    // Big digits clock face: the colon blinks once a second (false: steady).
    colonBlink: true,
    // Analog clock face: the accent color (ANALOG_ACCENTS).
    analogAccent: 'amber',
    // Baseball screen layout: 'classic' (color blocks + abbreviations),
    // 'logos' (team logo bands, from the uploaded sprite sheet), or 'bands'
    // (the same bands with abbreviations, no logos).
    baseballLayout: 'classic',
    // Logo/band layouts: logo and band brightness, percent (the board dims).
    logoBright: 90,
    tickerHold: 8,
    tickerSlide: 1200,
    radarFrame: 500,
    radarHold: 4,
    gameEvery: 60,
    // Ticker row fill: the line color at this percent.
    tickerFill: 55,
    // OTA updates (S3): follow the 'stable' or 'beta' channel, a pinned
    // build (its commit), or 'off'. fwRetry is the control page's "Try
    // again" count: a board that rolled a build back installs it again only
    // after it changes.
    fw: 'stable',
    fwRetry: 0,
  };
}

// A message for the announce screen: {text, style}, with the text cleaned
// (characters outside the board's fonts dropped) and fitting the style on
// one screen of the board's width (`cols`).
function validMessage(m, where, cols) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new ValidationError(`${where} must be {text, style}`);
  if (!MSG_STYLES.includes(m.style)) throw new ValidationError(`${where}.style must be one of ${MSG_STYLES.join(', ')}`);
  if (typeof m.text !== 'string' || m.text.length > 4 * MSG_MAX) throw new ValidationError(`${where}.text must be a string`);
  const text = cleanMessage(m.text);
  if (!text) throw new ValidationError(`${where}.text is empty (the board can't draw emoji)`);
  if ([...text].length > MSG_MAX) throw new ValidationError(`${where}.text is longer than ${MSG_MAX} characters`);
  if (!messageLayout(text, m.style, cols)) throw new ValidationError(`${where}.text doesn't fit the ${m.style} style on one screen`);
  return { text, style: m.style };
}

// Validate a partial update and return the fields to apply. Throws
// ValidationError with a short message on anything unexpected. `cols`: the
// board's width (128 or absent), for the messages.
function validatePatch(patch, stations, cols) {
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
      case 'label':
        if (typeof val !== 'string' || val.trim().length > LABEL_MAX) throw new ValidationError(`label must be a string of up to ${LABEL_MAX} characters`);
        out.label = val.trim();
        break;
      case 'rows':
        if (!Array.isArray(val) || val.length > MAX_ROWS || !val.every((r) => typeof r === 'string' && ROW_RE.test(r))) {
          throw new ValidationError(`rows must be up to ${MAX_ROWS} strings like "RD:Howard"`);
        }
        out.rows = [...val];
        break;
      case 'showHeader':
      case 'showWeather':
      case 'headerDivider':
      case 'wxDivider':
      case 'radarTime':
      case 'radarCond':
      case 'tempShadow':
      case 'wxTop':
      case 'headerClock':
      case 'timeSteps':
      case 'boats':
      case 'twinkle':
      case 'showTemp':
      case 'gradInvert':
      case 'colonBlink':
      case 'clockRoll':
      case 'otherLines':
        if (typeof val !== 'boolean') throw new ValidationError(`${key} must be true or false`);
        out[key] = val;
        break;
      case 'brightMin':
        if (!Number.isInteger(val) || val < 5 || val > 100) throw new ValidationError('brightMin must be an integer 5-100');
        out.brightMin = val;
        break;
      case 'logoBright':
        if (!Number.isInteger(val) || val < 10 || val > 100) throw new ValidationError('logoBright must be 10-100');
        out.logoBright = val;
        break;
      case 'tickerHold':
      case 'tickerSlide':
      case 'radarFrame':
      case 'radarHold':
      case 'gameEvery':
        if (!SPEEDS[key].includes(val)) throw new ValidationError(`${key} must be one of ${SPEEDS[key].join(', ')}`);
        out[key] = val;
        break;
      case 'radarBright':
        if (!Number.isInteger(val) || val < 20 || val > 150) throw new ValidationError('radarBright must be 20-150');
        out.radarBright = val;
        break;
      case 'tickerFill':
        if (!Number.isInteger(val) || val < 25 || val > 80) throw new ValidationError('tickerFill must be 25-80');
        out.tickerFill = val;
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
        if (!Number.isInteger(val) || val < 1 || val > 60) throw new ValidationError('radarEvery must be 1-60 minutes');
        out.radarEvery = val;
        break;
      case 'autoScreens':
        if (!Array.isArray(val) || !val.length || !val.every((v) => AUTO_SCREENS.includes(v)) || new Set(val).size !== val.length) {
          throw new ValidationError(`autoScreens must be a non-empty list of ${AUTO_SCREENS.join(', ')}`);
        }
        out.autoScreens = AUTO_SCREENS.filter((v) => val.includes(v));
        break;
      case 'cycle':
        if (!Array.isArray(val) || val.length < 2 || val.length > CYCLE_MAX || !val.every((v) => CYCLE_SCREENS.includes(v)) || new Set(val).size !== val.length) {
          throw new ValidationError(`cycle must be 2-${CYCLE_MAX} different screens from ${CYCLE_SCREENS.join(', ')}`);
        }
        out.cycle = [...val];
        break;
      case 'hideLines':
        if (!Array.isArray(val) || !val.every((v) => LINE_CODES.includes(v)) || new Set(val).size !== val.length) {
          throw new ValidationError(`hideLines must be a list of ${LINE_CODES.join(', ')}`);
        }
        out.hideLines = LINE_CODES.filter((v) => val.includes(v));
        break;
      case 'transitScreen':
        if (!AUTO_SCREENS.includes(val)) throw new ValidationError(`transitScreen must be one of ${AUTO_SCREENS.join(', ')}`);
        out.transitScreen = val;
        break;
      case 'bbTeams':
        if (!Array.isArray(val) || !val.every((v) => BB_TEAMS.includes(v)) || new Set(val).size !== val.length) {
          throw new ValidationError(`bbTeams must be a list of ${BB_TEAMS.join(', ')} (empty: never)`);
        }
        out.bbTeams = BB_TEAMS.filter((v) => val.includes(v));
        break;
      case 'autoEvery':
        if (!AUTO_EVERY.includes(val)) throw new ValidationError(`autoEvery must be one of ${AUTO_EVERY.join(', ')}`);
        out.autoEvery = val;
        break;
      case 'bbPre':
        if (!Number.isInteger(val) || val < 0 || val > 120) throw new ValidationError('bbPre must be 0-120 minutes');
        out.bbPre = val;
        break;
      case 'bbFinal':
        if (!Number.isInteger(val) || val < 0 || val > 60) throw new ValidationError('bbFinal must be 0-60 minutes');
        out.bbFinal = val;
        break;
      case 'wxVisit':
      case 'alertJump':
      case 'bbPriority':
      case 'lineNames':
      case 'transitLayout':
      case 'wideLayout':
      case 'radarClock':
      case 'wxView':
      case 'tempUnit':
      case 'clockFace':
      case 'analogAccent':
      case 'cloudDrift':
      case 'wheelSpeed':
      case 'rippleSpeed':
      case 'rainSpeed': {
        const allowed = { wxVisit: WX_VISITS, alertJump: ALERT_JUMPS, bbPriority: BB_PRIORITIES, lineNames: LINE_NAMES, transitLayout: TRANSIT_LAYOUTS, wideLayout: WIDE_LAYOUTS, radarClock: RADAR_CLOCKS, wxView: WX_VIEWS, tempUnit: TEMP_UNITS, clockFace: CLOCK_FACES, analogAccent: Object.keys(ANALOG_ACCENTS), cloudDrift: CLOUD_DRIFTS, wheelSpeed: WHEEL_SPEEDS, rippleSpeed: RIPPLE_SPEEDS, rainSpeed: RAIN_SPEEDS }[key];
        if (!allowed.includes(val)) throw new ValidationError(`${key} must be one of ${allowed.join(', ')}`);
        out[key] = val;
        break;
      }
      case 'msg':
        out.msg = val === null ? null : validMessage(val, 'msg', cols);
        break;
      case 'msgPresets':
        if (!Array.isArray(val) || val.length > MAX_PRESETS) throw new ValidationError(`msgPresets must be a list of up to ${MAX_PRESETS} messages`);
        out.msgPresets = val.map((m, i) => validMessage(m, `msgPresets[${i}]`, cols));
        break;
      case 'fw':
        if (!(FW_CHANNELS.includes(val) || (typeof val === 'string' && FW_PIN_RE.test(val)))) {
          throw new ValidationError(`fw must be one of ${FW_CHANNELS.join(', ')}, or a build's commit`);
        }
        out.fw = val;
        break;
      case 'fwRetry':
        if (!Number.isInteger(val) || val < 0 || val > 1e6) throw new ValidationError('fwRetry must be an integer 0-1000000');
        out.fwRetry = val;
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
      // Radar visits were radarEvery > 0 (0 = off); now wxVisit with the interval kept.
      for (const b of Object.values(state.boards)) {
        if (b && b.wxVisit === undefined && b.radarEvery !== undefined) {
          b.wxVisit = b.radarEvery > 0 ? 'rain' : 'off';
          if (!(b.radarEvery > 0)) b.radarEvery = 4;
        }
      }
      for (const b of Object.values(state.boards)) if (b) for (const k of RETIRED_KEYS) delete b[k];
      // Auto became Cycle (Nov 2026). Auto alternating transit and the ticker
      // is a cycle of the two; Auto on one screen is that screen chosen (its
      // weather visits carry on as Rain nearby, now on any screen).
      for (const b of Object.values(state.boards)) {
        if (!b || Object.hasOwn(b, 'cycle')) continue;
        const mains = Array.isArray(b.autoScreens) && b.autoScreens.length ? b.autoScreens : ['transit'];
        b.cycle = mains.length > 1 ? ['transit', 'ticker'] : ['transit', 'weather'];
        if (b.screen === 'auto' && mains.length < 2) b.screen = mains[0];
      }
      // Settings added later: fill in their defaults (today's behavior).
      const defaults = defaultBoard(stations);
      for (const b of Object.values(state.boards)) {
        if (!b) continue;
        for (const [k, v] of Object.entries(defaults)) if (!Object.hasOwn(b, k)) b[k] = Array.isArray(v) ? [...v] : v;
      }
      // The split-flap message style was removed (Nov 2026): saved ones load as notes.
      const unflap = (m) => (m && m.style === 'flap' ? { ...m, style: 'note' } : m);
      for (const b of Object.values(state.boards)) {
        if (!b) continue;
        b.msg = unflap(b.msg);
        if (Array.isArray(b.msgPresets)) b.msgPresets = b.msgPresets.map(unflap);
      }
      // 54th/Cermak's short name was 54th.
      for (const b of Object.values(state.boards)) if (b && Array.isArray(b.rows)) b.rows = b.rows.map((r) => (r === 'PK:54th' ? 'PK:54/Crmk' : r));
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

  const has = (id) => Object.hasOwn(state.boards, id);
  const validId = (id) => {
    if (!BOARD_ID_RE.test(id)) throw new ValidationError('board id must be 1-32 chars of a-z, 0-9, -');
  };

  // A new board: a copy of board `from` (its settings, station and filter
  // included), or the defaults. Starts at v 1 with brightness on auto.
  function create(id, { from = null, label = '' } = {}) {
    validId(id);
    if (has(id)) throw new ValidationError(`board "${id}" already exists`);
    if (Object.keys(state.boards).length >= MAX_BOARDS) throw new ValidationError(`at most ${MAX_BOARDS} boards`);
    if (from != null && !has(from)) throw new ValidationError(`unknown board to copy: ${from}`);
    const fields = validatePatch({ label }, stations);
    const board = from != null ? JSON.parse(JSON.stringify(state.boards[from])) : defaultBoard(stations);
    Object.assign(board, fields, { v: 1, bright: 'auto' });
    delete board.rainHold;
    delete board.cols; // the hardware's, not a setting: the new board reports its own
    state.boards[id] = board;
    save();
    return board;
  }

  return {
    file,
    get: (id) => (has(id) ? state.boards[id] : null),
    all: () => state,
    ids: () => Object.keys(state.boards),
    create,

    // A board asked for an ID the server doesn't know yet (a newly flashed
    // board): add it as a copy of the default board (else the first one), so
    // it shows what the existing board shows until it's changed on the phone.
    // Null for an invalid ID or when the board limit is reached.
    register(id) {
      if (has(id)) return state.boards[id];
      if (!BOARD_ID_RE.test(id) || Object.keys(state.boards).length >= MAX_BOARDS) return null;
      const from = has(DEFAULT_BOARD_ID) ? DEFAULT_BOARD_ID : Object.keys(state.boards)[0] ?? null;
      const board = create(id, { from });
      log.warn(`[board] new board "${id}" registered${from ? ` (settings copied from "${from}")` : ''}`);
      return board;
    },

    // Replace board `id`'s settings with a copy of board `from`'s (its name
    // stays). Bumps v so the board refetches.
    copy(id, from) {
      if (!has(id)) return null;
      if (!has(from) || from === id) throw new ValidationError(`unknown board to copy: ${from}`);
      const prev = state.boards[id];
      const board = JSON.parse(JSON.stringify(state.boards[from]));
      Object.assign(board, { label: prev.label || '', v: (prev.v || 0) + 1, bright: 'auto' });
      delete board.rainHold;
      delete board.cols;
      if (prev.cols) board.cols = prev.cols; // its own panels, not the copied board's
      state.boards[id] = board;
      save();
      return board;
    },

    // A new owner: back to the default settings. The board keeps its name
    // (the maker's) and its firmware setting (fw, fwRetry: a rolled-back
    // build stays marked bad); v grows so the board refetches.
    reset(id) {
      if (!has(id)) return null;
      const prev = state.boards[id];
      const board = defaultBoard(stations);
      Object.assign(board, { label: prev.label || '', fw: prev.fw || board.fw, fwRetry: prev.fwRetry || 0, v: (prev.v || 0) + 1 });
      if (prev.cols) board.cols = prev.cols; // same panels
      state.boards[id] = board;
      save();
      return board;
    },

    // Remove a board. False if it doesn't exist; the last board can't go.
    remove(id) {
      if (!has(id)) return false;
      if (Object.keys(state.boards).length === 1) throw new ValidationError("can't delete the only board");
      delete state.boards[id];
      save();
      return true;
    },

    // Apply a validated partial update; creates the board from defaults if
    // it doesn't exist yet. Always bumps v so the board refetches.
    update(id, patch) {
      validId(id);
      const board = Object.hasOwn(state.boards, id) ? state.boards[id] : defaultBoard(stations);
      const fields = validatePatch(patch, stations, board.cols);
      // A destination filter belongs to its station: a new station starts
      // with all destinations unless the patch sets rows too.
      if (fields.station && fields.station.mapid !== board.station.mapid && !fields.rows) fields.rows = [];
      // A new message replays its intro on the board: its id changes.
      if (fields.msg) fields.msg.id = (board.v || 0) + 1;
      Object.assign(board, fields);
      if (fields.screen === 'transit' || fields.screen === 'ticker') board.transitScreen = fields.screen;
      board.v = (board.v || 0) + 1;
      state.boards[id] = board;
      save();
      return board;
    },

    // The knob chose a category on its ring: set the screen it opens, and
    // with `v` (one of the category's variants) the variant too: transit's
    // screen, the weather view, the clock face. Same as a phone change
    // (bumps v).
    select(id, cat, v) {
      if (!KNOB_RING.includes(cat) && !EXTRA_RING.includes(cat)) throw new ValidationError(`s must be one of ${[...KNOB_RING, ...EXTRA_RING].join(', ')}`);
      const vars = variantsOf(cat, CLOCK_FACES);
      if (v != null && !vars.includes(v)) throw new ValidationError(vars.length ? `v must be one of ${vars.join(', ')}` : `${cat} has no variants`);
      if (!Object.hasOwn(state.boards, id)) return null;
      const fields = { screen: knobScreen(state.boards[id], cat) };
      // A knob turn turns a board that's off back on (Auto).
      if (state.boards[id].bright === 'off') fields.bright = 'auto';
      if (v != null) {
        if (cat === 'transit') fields.screen = v;
        else if (cat === 'weather') fields.wxView = v;
        else if (cat === 'clock') fields.clockFace = v;
      }
      return this.update(id, fields);
    },

    // Rain nearby held off (index.js holdOf): {until} (epoch s), {rain:
    // true}, or null. Not a setting: v stays (the board sees it with its
    // next update), and copies and new owners start without one.
    setRainHold(id, hold) {
      if (!Object.hasOwn(state.boards, id)) return null;
      const b = state.boards[id];
      if (hold) b.rainHold = hold.rain ? { rain: true } : { until: Math.floor(hold.until) };
      else if (!b.rainHold) return b;
      else delete b.rainHold;
      save();
      return b;
    },

    // The board's width in LEDs, as it reports it (index.js: `w` on every
    // update and select; contract "Width"): 64, or 128 for two chained
    // panels. Kept as `cols` only when 128, so a 64 board's state is as
    // before. Not a setting: v stays (the board drew its own width already),
    // and it's saved only when it changes. Null for an unknown board.
    setCols(id, cols) {
      if (!Object.hasOwn(state.boards, id)) return null;
      const b = state.boards[id];
      const want = cols === 128 ? 128 : undefined;
      if (b.cols === want) return b;
      if (want) b.cols = want;
      else delete b.cols;
      save();
      return b;
    },

    // Board restart: everything persists, Off included (Off stays off until
    // it's changed on the phone or the knob turns). Bumps v.
    boot(id) {
      if (!Object.hasOwn(state.boards, id)) return null;
      const board = state.boards[id];
      board.v += 1;
      save();
      return board;
    },
  };
}

module.exports = { createStore, validatePatch, defaultBoard, ValidationError, resolveDir, DEFAULT_BOARD_ID, MAX_BOARDS, SCREENS, CLOCK_FACES, WIDE_FACES, ANALOG_ACCENTS, KNOB_RING, knobOf, MAX_PRESETS, BASEBALL_LAYOUTS, SPEEDS, AUTO_SCREENS, AUTO_EVERY, WX_VISITS, ALERT_JUMPS, BB_TEAMS, BB_PRIORITIES, LINE_NAMES, RADAR_CLOCKS, CYCLE_SCREENS, LINE_CODES };
