const fs = require('fs');
const path = require('path');

// Cache in module scope — Vercel reuses warm function instances across requests,
// so this avoids repeated synchronous disk reads for a static file.
let _cache = null;

module.exports = function handler(req, res) {
  if (!_cache) {
    _cache = fs.readFileSync(path.join(process.cwd(), 'data', 'cta-lines.geojson'));
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(_cache);
};
