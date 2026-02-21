const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const CTA_KEY = '9e15fcfa75064b6db8ad034db11ea214';
const CTA_BASE = 'http://lapi.transitchicago.com/api/1.0/ttpositions.aspx';
const ROUTES = ['red', 'blue', 'brn', 'G', 'org', 'P', 'pink', 'Y'];

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Fetch JSON from an HTTP URL using Node's built-in http module. */
function fetchJSON(fetchUrl) {
  return new Promise((resolve, reject) => {
    http.get(fetchUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON from CTA API'));
        }
      });
    }).on('error', reject);
  });
}

/** Fetch train positions for all routes in parallel, return combined array. */
async function fetchAllTrains() {
  const results = await Promise.allSettled(
    ROUTES.map(async (route) => {
      const fetchUrl = `${CTA_BASE}?key=${CTA_KEY}&rt=${route}&outputType=JSON`;
      const data = await fetchJSON(fetchUrl);
      return { route, data };
    })
  );

  const trains = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { route, data } = result.value;
    const ctatt = data.ctatt;
    if (!ctatt || (ctatt.errCd !== '0' && ctatt.errCd !== 0)) continue;

    let routeData = ctatt.route;
    if (!routeData) continue;
    if (!Array.isArray(routeData)) routeData = [routeData];

    for (const r of routeData) {
      let trainList = r.train;
      if (!trainList) continue;
      if (!Array.isArray(trainList)) trainList = [trainList];
      trains.push(...trainList.map((t) => ({ ...t, rt: route })));
    }
  }

  return trains;
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  // Serve bundled CTA line geometry GeoJSON
  if (parsed.pathname === '/api/geojson') {
    const geojsonPath = path.join(__dirname, 'data', 'cta-lines.geojson');
    fs.readFile(geojsonPath, (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read GeoJSON file' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(content);
    });
    return;
  }

  // API proxy endpoint
  if (parsed.pathname === '/api/trains') {
    try {
      const trains = await fetchAllTrains();
      const body = JSON.stringify({ trains });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch (e) {
      console.error('CTA API error:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch train data' }));
    }
    return;
  }

  // Static file serving
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(__dirname, filePath);

  // Prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`CTA Map server running at http://localhost:${PORT}`);
});
