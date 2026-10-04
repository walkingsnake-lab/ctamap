'use strict';
// Raw upstream responses for recording test fixtures. Reached only through
// the control path (see index.js); returns exactly what the upstream API sent
// so it can be saved under server/board/fixtures/ unchanged.

const http = require('http');

const TT_ARRIVALS = 'http://lapi.transitchicago.com/api/1.0/ttarrivals.aspx';

// Minimal GET returning { status, body } as text.
function getText(target) {
  return new Promise((resolve, reject) => {
    const req = http.get(target, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Raw Train Tracker arrivals for one station (all lines and directions).
// The API key goes in the request URL only; CTA's response doesn't echo it.
function rawArrivals(mapid, { key = process.env.CTA_KEY, get = getText } = {}) {
  if (!key) throw new Error('CTA_KEY not set');
  return get(`${TT_ARRIVALS}?key=${encodeURIComponent(key)}&mapid=${encodeURIComponent(mapid)}&outputType=JSON`);
}

module.exports = { rawArrivals };
