'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rawArrivals } = require('./capture');

test('rawArrivals requests ttarrivals for the station with the key and JSON output', async () => {
  let seen;
  const r = await rawArrivals('40100', { key: 'k&y', get: async (u) => { seen = new URL(u); return { status: 200, body: '{}' }; } });
  assert.equal(r.body, '{}');
  assert.equal(seen.pathname, '/api/1.0/ttarrivals.aspx');
  assert.equal(seen.searchParams.get('mapid'), '40100');
  assert.equal(seen.searchParams.get('key'), 'k&y');
  assert.equal(seen.searchParams.get('outputType'), 'JSON');
});

test('rawArrivals refuses to run without a key', () => {
  assert.throws(() => rawArrivals('40100', { key: '' }), /CTA_KEY/);
});
