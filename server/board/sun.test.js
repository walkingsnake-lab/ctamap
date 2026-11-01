'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sunPos, moonPhase } = require('./sun');

// The skyline's viewer: on the lake on Navy Pier's axis.
const LAT = 41.8917, LON = -87.590;
const at = (iso) => Date.parse(iso) / 1000;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(2)} vs ${b} ± ${tol}`);

// First minute (UTC, after local noon) the sun is below the sunset elevation.
function sunset(dayIso) {
  for (let t = at(dayIso) + 18 * 3600; ; t += 60) if (sunPos(t, LAT, LON).el < -0.833) return t;
}

test('noon elevation follows the season (90 - latitude ± tilt)', () => {
  let june = -90, dec = -90;
  for (let t = at('2026-06-21T15:00:00Z'); t < at('2026-06-21T20:00:00Z'); t += 60) june = Math.max(june, sunPos(t, LAT, LON).el);
  for (let t = at('2026-12-21T15:00:00Z'); t < at('2026-12-21T20:00:00Z'); t += 60) dec = Math.max(dec, sunPos(t, LAT, LON).el);
  near(june, 90 - LAT + 23.44, 0.3, 'June solstice noon');
  near(dec, 90 - LAT - 23.44, 0.3, 'December solstice noon');
});

test('sunset bearings span about 238-303° over the year (spec: sunset sun scale)', () => {
  near(sunPos(sunset('2026-12-21T00:00:00Z'), LAT, LON).az, 238.5, 1, 'December sunset bearing');
  near(sunPos(sunset('2026-06-21T00:00:00Z'), LAT, LON).az, 302.5, 1, 'June sunset bearing');
});

test('Oct 31, 2026 sunset is about 5:44 PM CDT', () => {
  const t = sunset('2026-10-31T00:00:00Z');
  near((t - at('2026-10-31T22:44:00Z')) / 60, 0, 4, 'minutes from 5:44 PM CDT');
});

test('azimuth is clockwise from north: east in the morning, west in the evening', () => {
  near(sunPos(at('2026-03-20T12:30:00Z'), LAT, LON).az, 90, 15, 'equinox morning');
  near(sunPos(at('2026-03-20T23:30:00Z'), LAT, LON).az, 270, 15, 'equinox evening');
});

test('moon phase: new at the epoch, full at known total lunar eclipses', () => {
  near(moonPhase(at('2000-01-06T18:14:00Z')).phase, 0, 0.001, 'epoch');
  assert.ok(moonPhase(at('2000-01-06T18:14:00Z')).lit < 0.001);
  near(moonPhase(at('2000-01-21T04:44:00Z')).phase, 0.5, 0.03, 'eclipse of Jan 21, 2000');
  near(moonPhase(at('2025-03-14T06:59:00Z')).phase, 0.5, 0.03, 'eclipse of Mar 14, 2025');
  assert.ok(moonPhase(at('2025-03-14T06:59:00Z')).lit > 0.99);
});
