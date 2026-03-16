const fs = require('fs');
const path = require('path');

module.exports = function handler(req, res) {
  const geojsonPath = path.join(process.cwd(), 'data', 'cta-lines.geojson');
  try {
    const content = fs.readFileSync(geojsonPath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.end(content);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read GeoJSON file' });
  }
};
