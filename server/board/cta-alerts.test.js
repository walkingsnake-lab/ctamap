'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseAlerts, mapAlerts, boardAlertLines, createAlertsPoller } = require('./cta-alerts');

const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'cta-alerts', '2026-10-04-1057.xml'), 'utf8');
const quiet = { warn() {}, error() {} };

test('every impacted line is read, stations are skipped', () => {
  const alerts = parseAlerts(XML);
  assert.equal(alerts.length, 7);
  const byId = Object.fromEntries(alerts.map((a) => [a.id, a]));
  assert.deepEqual(byId['112148'].routes, ['p', 'pink', 'g', 'brn', 'org']); // State/Lake closure, 5 lines
  assert.deepEqual(byId['117370'].routes, ['g']); // 43rd station listed before the Green Line
  assert.deepEqual(byId['117906'].routes, ['g', 'org']);
  assert.equal(byId['117906'].severity, 'minor');
  assert.equal(byId['117906'].impact, 'Minor Delays');
  assert.equal(byId['112148'].major, false);
});

test('map alerts: same filter as before (major or delay), one entry per line', () => {
  const out = mapAlerts(parseAlerts(XML));
  assert.deepEqual(out.map((a) => `${a.id}:${a.service}`), ['117906:g', '117906:org']);
  assert.deepEqual(Object.keys(out[0]), ['id', 'headline', 'short', 'severity', 'impact', 'service', 'start']);
});

test('board: only unplanned disruptions blink (not planned work, closures, or elevators)', () => {
  assert.deepEqual([...boardAlertLines(parseAlerts(XML))].sort(), ['GR', 'OR']);
  // A major alert counts whatever its severity class.
  const major = parseAlerts(XML.replace('<MajorAlert>0</MajorAlert>', '<MajorAlert>1</MajorAlert>'));
  assert.ok(boardAlertLines(major).has('PR')); // first alert in the file is the 5-line closure
  assert.deepEqual([...boardAlertLines([])], []);
  assert.deepEqual([...boardAlertLines(null)], []);
});

test('a CTA error response throws instead of reading as "no alerts"', () => {
  assert.throws(() => parseAlerts('<CTAAlerts><ErrorCode>500</ErrorCode><ErrorMessage>Down</ErrorMessage></CTAAlerts>'), /500/);
  assert.deepEqual(parseAlerts('<CTAAlerts><ErrorCode>0</ErrorCode></CTAAlerts>'), []);
});

test('poller keeps the last good list when CTA fails', async () => {
  let fail = false;
  const p = createAlertsPoller({ fetch: async () => { if (fail) throw new Error('down'); return XML; }, log: quiet });
  assert.equal(p.get(), null);
  assert.equal((await p.ready()).alerts.length, 7);
  fail = true;
  await p.refresh();
  assert.equal(p.get().alerts.length, 7);
});
