'use strict';
// CTA Customer Alerts: one background poller shared by the map's /api/alerts
// and the board (CLAUDE.md "Shared alerts"). Lives with the board code so it
// is tested with it; server.js creates the poller and hands it to both.
//
// Every <Service> in an alert's <ImpactedService> is read: one alert can
// cover several lines, and a station can be listed before its line.

const http = require('http');
const { lineCode } = require('./destinations');

const ALERTS_URL = 'http://www.transitchicago.com/api/1.0/alerts.aspx?activeonly=true&routeid=red,blue,brn,g,org,p,pink,y';

const tag = (block, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`).exec(block);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
};

// Raw XML -> [{id, headline, short, severity, score, impact, major, start, routes}]
// routes: Train Tracker route ids, lowercase (`red`, `g`, `brn`, ...).
function parseAlerts(xml) {
  const out = [];
  const err = tag(xml, 'ErrorCode');
  if (err && err !== '0') throw new Error(`CTA alerts error ${err}: ${tag(xml, 'ErrorMessage')}`);
  for (const m of xml.matchAll(/<Alert>([\s\S]*?)<\/Alert>/g)) {
    const block = m[1];
    const routes = [];
    for (const s of block.matchAll(/<Service>([\s\S]*?)<\/Service>/g)) {
      if (tag(s[1], 'ServiceType') !== 'R') continue; // stations, buses
      const id = tag(s[1], 'ServiceId').toLowerCase();
      if (id && !routes.includes(id)) routes.push(id);
    }
    out.push({
      id: tag(block, 'AlertId'),
      headline: tag(block, 'Headline'),
      short: tag(block, 'ShortDescription').replace(/<[^>]+>/g, ''),
      severity: tag(block, 'SeverityCSS'),
      score: Number(tag(block, 'SeverityScore')) || 0,
      impact: tag(block, 'Impact'),
      major: tag(block, 'MajorAlert') === '1',
      start: tag(block, 'EventStart'),
      routes,
    });
  }
  return out;
}

// The map's /api/alerts shape and filter (major, or a delay), one entry per
// impacted line so a multi-line alert shows on each line.
function mapAlerts(alerts) {
  const out = [];
  for (const a of alerts) {
    if (!a.major && !/delay/i.test(a.impact)) continue;
    for (const service of a.routes) {
      out.push({ id: a.id, headline: a.headline, short: a.short, severity: a.severity, impact: a.impact, service, start: a.start });
    }
  }
  return out;
}

// Board rule: a line's rows blink only for major alerts (CTA severity
// `major`, or MajorAlert). Minor delays, planned work, schedule changes,
// long-term closures, and elevator outages don't blink. Returns a Set of
// line codes.
function boardAlertLines(alerts) {
  const lines = new Set();
  for (const a of alerts || []) {
    if (!(a.major || a.severity === 'major')) continue;
    for (const r of a.routes) { const ln = lineCode(r); if (ln) lines.add(ln); }
  }
  return lines;
}

function fetchText(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`HTTP ${res.statusCode}`))));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Polls every `interval` s; keeps the last good list when CTA fails.
function createAlertsPoller({ fetch = () => fetchText(ALERTS_URL), interval = 180, now = () => Date.now() / 1000, log = console } = {}) {
  let data = null; // { alerts, fetchedAt }
  let inflight = null;
  let timer = null;

  function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        data = { alerts: parseAlerts(await fetch()), fetchedAt: now() };
      } catch (e) {
        log.error('[alerts] CTA alerts fetch failed:', e.message);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    get: () => data,
    // Waits for the first fetch if there's no data yet.
    async ready() { if (!data) await refresh(); return data; },
    refresh,
    start() {
      if (!timer) {
        refresh();
        timer = setInterval(() => { try { refresh(); } catch (e) { log.error('[alerts] poll failed:', e); } }, interval * 1000);
        timer.unref();
      }
      return this;
    },
    stop() { clearInterval(timer); timer = null; },
  };
}

module.exports = { ALERTS_URL, parseAlerts, mapAlerts, boardAlertLines, createAlertsPoller };
