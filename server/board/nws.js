'use strict';
// NWS severe thunderstorm and tornado warnings/watches for the board's
// location (its station) -> the payload's `warn`. Contract "Warning (warn)".
//
// NWS sends cancellations and expirations under the same event name ("Severe
// Thunderstorm Warning" whose VTEC action is EXP), and they stay in
// /alerts/active until they expire. Those, and anything already over or not
// yet started, are ignored. Fixture: fixtures/nws/.

const { createLocationPoller, fetchJson } = require('./location-poller');

const EVENTS = {
  'Tornado Warning': { kind: 'tor', lvl: 'warning', rank: 4 },
  'Severe Thunderstorm Warning': { kind: 'svr', lvl: 'warning', rank: 3 },
  'Tornado Watch': { kind: 'tor', lvl: 'watch', rank: 2 },
  'Severe Thunderstorm Watch': { kind: 'svr', lvl: 'watch', rank: 1 },
};

const url = (lat, lon) => `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
const secs = (iso) => (iso ? Date.parse(iso) / 1000 : null);

// Raw GeoJSON -> the alerts the board cares about, with their timing.
function parse(json) {
  if (!json || !Array.isArray(json.features)) throw new Error('not an NWS alerts response');
  const out = [];
  for (const f of json.features) {
    const p = f && f.properties;
    const ev = p && EVENTS[p.event];
    if (!ev) continue;
    const vtec = ((p.parameters && p.parameters.VTEC) || [])[0] || '';
    out.push({
      ...ev,
      status: p.status,
      messageType: p.messageType,
      action: (/^\/[A-Z]\.([A-Z]{3})\./.exec(vtec) || [])[1] || null,
      onset: secs(p.onset || p.effective),
      ends: secs(p.ends || p.expires),
    });
  }
  return out;
}

// VTEC actions that end an event (cancel, expire); anything else (NEW, CON,
// EXT, EXA, EXB, UPG, COR) means it's in effect.
const ENDED = new Set(['CAN', 'EXP']);

// The most severe alert in effect at `now`, as {kind, lvl}, or null.
// Order: tornado warning > severe warning > tornado watch > severe watch.
function pickWarn(alerts, now) {
  let best = null;
  for (const a of alerts || []) {
    if (a.status !== 'Actual' || a.messageType === 'Cancel' || ENDED.has(a.action)) continue;
    if (a.onset != null && now < a.onset) continue;
    if (a.ends != null && now >= a.ends) continue;
    if (!best || a.rank > best.rank) best = a;
  }
  return best ? { kind: best.kind, lvl: best.lvl } : null;
}

// Every 90 s per location while a board is asking.
function createNws({ fetch = (lat, lon) => fetchJson(url(lat, lon), { headers: { Accept: 'application/geo+json' } }), interval = 90, ...opts } = {}) {
  return createLocationPoller({ name: 'nws', fetch, parse, interval, ...opts });
}

module.exports = { url, parse, pickWarn, createNws, EVENTS };
