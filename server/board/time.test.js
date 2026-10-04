'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCtaTime } = require('./time');

const iso = (s) => new Date(s * 1000).toISOString();

test('JSON-style CTA times are Chicago local (CDT = UTC-5)', () => {
  assert.equal(iso(parseCtaTime('2026-10-03T23:16:07')), '2026-10-04T04:16:07.000Z');
});

test('XML-style times and winter (CST = UTC-6) work too', () => {
  assert.equal(iso(parseCtaTime('20260103 08:00:00')), '2026-01-03T14:00:00.000Z');
});

test('DST changes: spring forward and fall back', () => {
  // 2026-03-08 02:00 CST -> 03:00 CDT
  assert.equal(iso(parseCtaTime('2026-03-08T01:59:00')), '2026-03-08T07:59:00.000Z');
  assert.equal(iso(parseCtaTime('2026-03-08T03:00:00')), '2026-03-08T08:00:00.000Z');
  // 2026-11-01 02:00 CDT -> 01:00 CST
  assert.equal(iso(parseCtaTime('2026-11-01T00:30:00')), '2026-11-01T05:30:00.000Z');
  assert.equal(iso(parseCtaTime('2026-11-01T03:00:00')), '2026-11-01T09:00:00.000Z');
});

test('garbage returns null', () => {
  assert.equal(parseCtaTime(''), null);
  assert.equal(parseCtaTime('soon'), null);
  assert.equal(parseCtaTime(null), null);
});
