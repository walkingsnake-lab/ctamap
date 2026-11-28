'use strict';
// Metra's static schedule (GTFS), the timetable under the Metra screen
// (design spec §5, "Metra"; decided, not built). Metra publishes it without a
// key at schedules.metrarail.com, with a small published.txt that changes
// whenever the schedule does (planned updates at 3 AM, others any time).
// The poller checks published.txt every few minutes and downloads the zip
// only when it has changed, keeping the last good schedule on any failure.
//
// Not wired into /board/update yet: nothing starts the poller until the
// Metra screen exists. Realtime (trip updates: delays, cancellations,
// tracked trains) is laid over this later; with no update for a trip, Metra
// says to treat it as running on schedule.
//
// What the schedule looks like (fixtures/metra, Nov 14, 2026): 11 lines,
// 241 stations, 3,371 trips, 63,291 stop times (5 MB of text, 394 KB zipped).
// Headers and values carry stray spaces (" route_short_name"), so both are
// trimmed. Times run past 24:00 for trains after midnight (26:25:00).
// Inbound is direction_id 1 on every inbound trip; the headsign can't be
// used (`South Chicago (93rd)` is outbound). It covers only a few weeks
// ahead, with holidays as calendar_dates exceptions (Thanksgiving runs the
// Sunday schedule).

const https = require('https');
const crypto = require('crypto');
const { readZip } = require('./zip');
const { parseCtaTime, TZ } = require('./time');
const { backoff } = require('./location-poller');

const BASE = 'https://schedules.metrarail.com/gtfs';
const FILES = ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ---------------------------------------------------------------- CSV

// One CSV file -> { cols: Map name -> index, rows: [[...]] }. RFC 4180
// quoting; names and values trimmed; a BOM and blank lines ignored. With
// `onRow(row, cols)`, rows are handed over one at a time and not kept (the
// 5 MB stop_times.txt would otherwise sit in memory as 63k arrays at once).
function parseCsv(text, onRow = null) {
  const s = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let cols = null;
  const emit = (row) => {
    if (row.length === 1 && row[0] === '') return;
    if (!cols) { cols = new Map(row.map((h, i) => [h, i])); return; }
    if (onRow) onRow(row, cols); else rows.push(row);
  };
  // Lines without quotes (all of Metra's today) split directly; a line
  // with a quote falls back to the character walk below, from its start.
  let i = 0;
  while (i < s.length) {
    let nl = s.indexOf('\n', i);
    if (nl < 0) nl = s.length;
    const line = s.slice(i, nl).replace(/\r$/, '');
    if (line.indexOf('"') < 0) { emit(line.split(',').map((f) => f.trim())); i = nl + 1; continue; }
    let row = [], field = '', q = false, j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (q) {
        if (c === '"') { if (s[j + 1] === '"') { field += '"'; j++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field.trim()); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[j + 1] === '\n') j++; break; }
      else field += c;
    }
    row.push(field.trim());
    emit(row);
    i = j + 1;
  }
  return { cols: cols || new Map(), rows };
}

// Column reader for one parsed file: get(row, 'trip_id') -> '' when absent.
function columns(csv, file, required) {
  for (const name of required) if (!csv.cols.has(name)) throw new Error(`metra: ${file} has no ${name}`);
  return (row, name) => { const i = csv.cols.get(name); return i == null ? '' : (row[i] || ''); };
}

// "26:25:00" -> seconds after the service day's start; null if malformed.
function gtfsSeconds(t) {
  const m = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(t);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

// ---------------------------------------------------------------- model

// The zip's files -> the timetable. Throws on anything it can't read, so a
// bad download never replaces a good schedule.
function parseSchedule(files, { published = null } = {}) {
  const text = (name) => {
    const b = files.get(name);
    if (!b) throw new Error(`metra: schedule has no ${name}`);
    return b.toString('utf8');
  };

  const routesCsv = parseCsv(text('routes.txt'));
  const r = columns(routesCsv, 'routes.txt', ['route_id']);
  const routes = new Map();
  for (const row of routesCsv.rows) {
    const id = r(row, 'route_id');
    const color = /^[0-9A-Fa-f]{6}$/.test(r(row, 'route_color')) ? `#${r(row, 'route_color').toLowerCase()}` : null;
    routes.set(id, { id, short: r(row, 'route_short_name') || id, long: r(row, 'route_long_name'), color });
  }

  const stopsCsv = parseCsv(text('stops.txt'));
  const st = columns(stopsCsv, 'stops.txt', ['stop_id', 'stop_name']);
  const stops = new Map();
  for (const row of stopsCsv.rows) {
    const id = st(row, 'stop_id');
    stops.set(id, { id, name: st(row, 'stop_name'), lat: +st(row, 'stop_lat') || null, lon: +st(row, 'stop_lon') || null });
  }

  const tripsCsv = parseCsv(text('trips.txt'));
  const t = columns(tripsCsv, 'trips.txt', ['trip_id', 'route_id', 'service_id', 'direction_id']);
  const trips = [];
  const tripIndex = new Map();
  for (const row of tripsCsv.rows) {
    tripIndex.set(t(row, 'trip_id'), trips.length);
    trips.push({
      id: t(row, 'trip_id'), route: t(row, 'route_id'), service: t(row, 'service_id'),
      headsign: t(row, 'trip_headsign'), inbound: t(row, 'direction_id') === '1', last: null, lastSeq: -1,
    });
  }

  // stop_id -> [[trip index, departure s, arrival s, sequence], ...] by
  // departure. Pickup-less stops (pickup_type 1) are left out of departures;
  // each trip's last stop is noted so trains ending at a station aren't
  // shown as leaving it.
  const byStop = new Map();
  // Column indexes looked up once: this runs 63k times per download.
  let ix = null;
  parseCsv(text('stop_times.txt'), (row, cols) => {
    if (!ix) {
      columns({ cols }, 'stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence', 'departure_time', 'arrival_time']);
      const at = (name) => (cols.has(name) ? cols.get(name) : -1);
      ix = { trip: at('trip_id'), stop: at('stop_id'), seq: at('stop_sequence'), dep: at('departure_time'), arr: at('arrival_time'), pick: at('pickup_type'), drop: at('drop_off_type') };
    }
    const ti = tripIndex.get(row[ix.trip]);
    if (ti == null) return;
    const seq = +row[ix.seq];
    const stop = row[ix.stop];
    const trip = trips[ti];
    if (seq > trip.lastSeq) { trip.lastSeq = seq; trip.last = stop; }
    const depT = row[ix.dep] || row[ix.arr] || '', arrT = row[ix.arr] || row[ix.dep] || '';
    const dep = gtfsSeconds(depT), arr = gtfsSeconds(arrT);
    if (dep == null || arr == null) return;
    if (!byStop.has(stop)) byStop.set(stop, []);
    byStop.get(stop).push([ti, dep, arr, seq, ix.pick >= 0 && row[ix.pick] === '1', ix.drop >= 0 && row[ix.drop] === '1']);
  });
  if (!ix) throw new Error('metra: stop_times.txt is empty');
  for (const list of byStop.values()) list.sort((a, b) => a[1] - b[1]);

  const calCsv = parseCsv(text('calendar.txt'));
  const c = columns(calCsv, 'calendar.txt', ['service_id', 'start_date', 'end_date', ...DAYS]);
  const calendar = new Map();
  let through = '';
  for (const row of calCsv.rows) {
    const end = c(row, 'end_date');
    calendar.set(c(row, 'service_id'), { days: DAYS.map((d) => c(row, d) === '1'), start: c(row, 'start_date'), end });
    if (end > through) through = end;
  }
  // date -> Map service -> 1 (added) or 2 (removed).
  const exceptions = new Map();
  const cdCsv = parseCsv(text('calendar_dates.txt'));
  const cd = columns(cdCsv, 'calendar_dates.txt', ['service_id', 'date', 'exception_type']);
  for (const row of cdCsv.rows) {
    const date = cd(row, 'date');
    if (!exceptions.has(date)) exceptions.set(date, new Map());
    exceptions.get(date).set(cd(row, 'service_id'), +cd(row, 'exception_type'));
    if (cd(row, 'exception_type') === '1' && date > through) through = date;
  }

  return { routes, stops, trips, byStop, calendar, exceptions, through, published, arrCache: new Map() };
}

// ---------------------------------------------------------------- dates

const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
// Epoch seconds -> Chicago date "YYYYMMDD".
const ymdAt = (t) => localDate.format(new Date(t * 1000)).replace(/-/g, '');
// "YYYYMMDD" shifted by n days.
function addDays(ymd, n) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
// GTFS times count from noon minus 12 h on the service date: midnight,
// except on the two days the clocks change, where this keeps wall times right.
const serviceStart = (ymd) => parseCtaTime(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00`) - 43200;

// The service ids running on a date ("YYYYMMDD").
function servicesOn(model, ymd) {
  const out = new Set();
  const dow = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay();
  for (const [id, c] of model.calendar) if (c.days[dow] && ymd >= c.start && ymd <= c.end) out.add(id);
  for (const [id, type] of model.exceptions.get(ymd) || []) {
    if (type === 1) out.add(id);
    else if (type === 2) out.delete(id);
  }
  return out;
}

// ---------------------------------------------------------------- departures

// A trip's arrival (s after its service start) at a stop, or undefined if it
// doesn't stop there or doesn't let riders off there (drop_off_type 1); cached per stop, since the terminus screen asks this
// for every departure.
function arrivalAt(model, stop, ti) {
  if (!model.arrCache.has(stop)) {
    const m = new Map();
    for (const [i, , arr, seq, , noDropoff] of model.byStop.get(stop) || []) if (!noDropoff) m.set(i, [arr, seq]);
    model.arrCache.set(stop, m);
  }
  return model.arrCache.get(stop).get(ti);
}

// The next departures from a stop, by direction: { in: [...], out: [...] },
// each up to `perDir`, soonest first, from `now` (epoch s). Looks from
// yesterday's service (trains after midnight) up to `days` days ahead, so
// tomorrow's first trains appear late at night and a weekday-only line
// (Heritage Corridor, North Central, SouthWest) finds Monday's trains from a
// Friday evening. Trains ending at the stop and stops where a train doesn't
// pick up are left out. `routes`: only these lines (a station on several).
// `to`: only trains that go on to stop there, each with `arr`, its arrival
// there (the terminus screen's home stop).
//
// Each departure: { trip, route, headsign, inbound, date (its service day,
// "YYYYMMDD": a departure not today needs its day shown), at (epoch s),
// sched (the same: realtime will move `at`), arr? }.
function departures(model, stop, now, { perDir = 3, days = 7, to = null, routes = null } = {}) {
  const out = { in: [], out: [] };
  const list = model.byStop.get(stop);
  if (!list) return out;
  const lines = routes ? new Set(routes) : null;
  const today = ymdAt(now);
  const found = [];
  for (let d = -1; d <= days; d++) {
    const ymd = addDays(today, d);
    const services = servicesOn(model, ymd);
    const base = serviceStart(ymd);
    for (const [ti, dep, , seq, noPickup] of list) {
      const trip = model.trips[ti];
      if (noPickup || !services.has(trip.service) || trip.last === stop) continue;
      if (lines && !lines.has(trip.route)) continue;
      const at = base + dep;
      if (at < now) continue;
      let arr;
      if (to) {
        const there = arrivalAt(model, to, ti);
        if (!there || there[1] <= seq) continue;
        arr = base + there[0];
      }
      found.push({ trip: trip.id, route: trip.route, headsign: trip.headsign, inbound: trip.inbound, date: ymd, at, sched: at, ...(to ? { arr } : {}) });
    }
    // Every later service day starts after this one: once both directions
    // have enough trains before it starts, nothing later can come sooner.
    if (d >= 0) {
      const next = serviceStart(addDays(today, d + 1));
      const before = (inb) => found.filter((f) => f.inbound === inb && f.at < next).length;
      if (before(true) >= perDir && before(false) >= perDir) break;
    }
  }
  found.sort((a, b) => a.at - b.at || (a.trip < b.trip ? -1 : 1));
  for (const f of found) {
    const side = f.inbound ? out.in : out.out;
    if (side.length < perDir) side.push(f);
  }
  return out;
}

// Whole days from `now` until the published schedule runs out (0 on its
// last day, negative past it).
function daysLeft(model, now) {
  const day = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / 86400000;
  return model.through ? day(model.through) - day(ymdAt(now)) : -Infinity;
}

// ---------------------------------------------------------------- poller

// HTTPS GET -> Buffer, refusing anything over `max` bytes.
function getBuffer(url, { max = 20 * 1024 * 1024, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > max) { req.destroy(new Error(`over ${max} bytes`)); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// The schedule, kept current. fetch(name) -> Buffer for 'published.txt' or
// 'schedule.zip' (default: Metra's site). get() -> the model, or null before
// the first good download. Checks published.txt every `check` s; after a
// failure, retries on the repo's backoff (30 s, doubling). Warns, once per
// published schedule, when it runs out within `warnDays`.
//
// A changed published.txt with an unchanged zip (Metra updating the stamp
// before the file) keeps the old schedule and tries again at the next
// check, up to `sameZipTries` times, then takes it as the new schedule.
function createMetraSchedule({
  fetch = (name) => getBuffer(`${BASE}/${name}`),
  check = 300,       // s between published.txt checks
  tick = 30,         // s between scheduler passes
  warnDays = 7,
  sameZipTries = 3,
  now = () => Date.now() / 1000,
  log = console,
} = {}) {
  let model = null, zipHash = null, failures = 0, retryAt = 0, checkedAt = -Infinity, inflight = null, timer = null;
  let sameZip = 0, warned = null;

  async function run() {
    checkedAt = now();
    try {
      const published = (await fetch('published.txt')).toString('utf8').trim();
      if (!published) throw new Error('empty published.txt');
      if (!model || model.published !== published) {
        const zip = await fetch('schedule.zip');
        const hash = crypto.createHash('sha256').update(zip).digest('hex');
        if (model && hash === zipHash && ++sameZip < sameZipTries) {
          log.warn(`[board] Metra published ${published} but the zip is unchanged; trying again`);
          failures = 0;
          return;
        }
        const next = parseSchedule(readZip(zip, { only: FILES }), { published });
        model = next;
        zipHash = hash;
        sameZip = 0;
        log.log(`[board] Metra schedule ${published}: ${next.trips.length} trips, through ${next.through}`);
      }
      failures = 0;
      const left = daysLeft(model, now());
      if (left < warnDays && warned !== model.published) {
        warned = model.published;
        log.warn(`[board] Metra schedule ${left < 0 ? 'ran out' : 'runs out'} ${model.through} (${left} days)`);
      }
    } catch (err) {
      failures++;
      retryAt = now() + backoff(check, failures);
      log.error(`[board] Metra schedule: ${err.message}${model ? ' (keeping the last good one)' : ''}`);
    }
  }

  // One check, unless one is running or a failure's backoff hasn't passed.
  function refresh({ force = false } = {}) {
    if (inflight) return inflight;
    if (!force && failures && now() < retryAt) return Promise.resolve();
    inflight = run().finally(() => { inflight = null; });
    return inflight;
  }

  // A scheduler pass: retry a failure when its backoff is up, else check
  // when `check` s have passed.
  function pass() {
    const t = now();
    if (failures ? t >= retryAt : t - checkedAt >= check) return refresh({ force: true });
    return Promise.resolve();
  }

  return {
    get: () => model,
    refresh,
    pass,
    start() {
      if (timer) return this;
      refresh({ force: true }).catch(() => {});
      timer = setInterval(() => { pass().catch(() => {}); }, tick * 1000);
      if (timer.unref) timer.unref();
      return this;
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}

module.exports = { parseCsv, gtfsSeconds, parseSchedule, servicesOn, departures, daysLeft, ymdAt, addDays, serviceStart, createMetraSchedule, getBuffer, FILES };
