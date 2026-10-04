'use strict';
// CTA timestamps are Chicago local time with no offset. With outputType=JSON
// they look like "2026-10-03T23:16:07"; the API docs show "20261003 23:16:07"
// for XML, so both are accepted. Converts to epoch seconds, DST-safe.

const TZ = 'America/Chicago';

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Chicago's UTC offset (ms, negative) at a given instant.
function offsetAt(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const RE = /^(\d{4})-?(\d{2})-?(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/;

function parseCtaTime(s) {
  const m = RE.exec(String(s || '').trim());
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  // Wall time minus the offset; recheck the offset at the result for DST edges.
  let ms = wall - offsetAt(wall);
  ms = wall - offsetAt(ms);
  return Math.round(ms / 1000);
}

module.exports = { parseCtaTime, TZ };
