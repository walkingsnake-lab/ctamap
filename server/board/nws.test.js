'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { url, parse, pickWarn } = require('./nws');

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nws', f), 'utf8'));
const EXPIRED = read('svr-warning-expired-2026-10-03-jax.json');
const NONE = read('morse-2026-10-04-none.json');
const T = Date.parse('2026-10-03T20:00:00-04:00') / 1000;

// The recorded warning, turned into one that's in effect (NEW, ends later).
function live(event = 'Severe Thunderstorm Warning', { onset = '2026-10-03T19:50:00-04:00', ends = '2026-10-03T20:45:00-04:00', action = 'NEW' } = {}) {
  const f = structuredClone(EXPIRED.features[0]);
  Object.assign(f.properties, { event, onset, effective: onset, ends, expires: ends });
  f.properties.parameters.VTEC = [f.properties.parameters.VTEC[0].replace('/O.EXP.', `/O.${action}.`)];
  return f;
}
const collection = (...features) => ({ ...EXPIRED, features });

test('no alerts -> no warning', () => {
  assert.deepEqual(parse(NONE), []);
  assert.equal(pickWarn(parse(NONE), T), null);
});

test('an expiration notice under the warning event name is not a warning', () => {
  const alerts = parse(EXPIRED);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].action, 'EXP');
  for (const t of [T, Date.parse('2026-10-03T20:20:00-04:00') / 1000]) assert.equal(pickWarn(alerts, t), null);
});

test('a warning in effect shows; before onset and after it ends it does not', () => {
  const alerts = parse(collection(live()));
  assert.deepEqual(pickWarn(alerts, T), { kind: 'svr', lvl: 'warning' });
  assert.equal(pickWarn(alerts, Date.parse('2026-10-03T19:49:00-04:00') / 1000), null);
  assert.equal(pickWarn(alerts, Date.parse('2026-10-03T20:45:00-04:00') / 1000), null);
  assert.equal(pickWarn(parse(collection(live(undefined, { action: 'CAN' }))), T), null);
  assert.deepEqual(pickWarn(parse(collection(live(undefined, { action: 'CON' }))), T), { kind: 'svr', lvl: 'warning' });
});

test('most severe wins: tornado warning > severe warning > tornado watch > severe watch', () => {
  const all = ['Severe Thunderstorm Watch', 'Tornado Watch', 'Severe Thunderstorm Warning', 'Tornado Warning'];
  for (let i = 1; i <= all.length; i++) {
    const alerts = parse(collection(...all.slice(0, i).map((e) => live(e))));
    const top = all[i - 1];
    assert.deepEqual(pickWarn(alerts, T), { kind: /Tornado/.test(top) ? 'tor' : 'svr', lvl: /Warning/.test(top) ? 'warning' : 'watch' }, top);
  }
  // Other events (advisories, flood warnings) are ignored.
  const other = live('Flood Warning');
  assert.deepEqual(parse(collection(other)), []);
});

test('request URL is the station point', () => {
  assert.equal(url(42.008362, -87.665909), 'https://api.weather.gov/alerts/active?point=42.0084,-87.6659');
  assert.throws(() => parse({}), /NWS/);
});
