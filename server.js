const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const CTA_KEY = '9e15fcfa75064b6db8ad034db11ea214';
const CTA_BASE = 'http://lapi.transitchicago.com/api/1.0/ttpositions.aspx';
const CTA_FOLLOW = 'http://lapi.transitchicago.com/api/1.0/ttfollow.aspx';
const ROUTES = ['red', 'blue', 'brn', 'G', 'org', 'P', 'pink', 'Y'];

// Cache GeoJSON in memory at startup — it's static and 116 KB, no need to
// hit disk on every request.
let geojsonCache = null;
fs.readFile(path.join(__dirname, 'data', 'cta-lines.geojson'), (err, buf) => {
  if (err) console.error('Failed to pre-load GeoJSON:', err.message);
  else geojsonCache = buf;
});

// Cache train positions for 15s to avoid 8 simultaneous CTA API calls on
// every client request.  Protects against the 100K daily transaction limit
// when multiple tabs or rapid reloads hit the server at the same time.
const TRAIN_CACHE_TTL = 15000; // ms
let trainCache = null;
let trainCacheTime = 0;
let trainCachePending = null; // in-flight promise, de-duplicates concurrent requests

async function getCachedTrains() {
  const now = Date.now();
  if (trainCache && now - trainCacheTime < TRAIN_CACHE_TTL) {
    return trainCache;
  }
  // If a fetch is already in flight, wait for it instead of firing another 8 calls.
  if (trainCachePending) return trainCachePending;
  trainCachePending = fetchAllTrains().then((trains) => {
    trainCache = trains;
    trainCacheTime = Date.now();
    trainCachePending = null;
    return trains;
  }).catch((err) => {
    trainCachePending = null;
    throw err;
  });
  return trainCachePending;
}

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

  // Serve bundled CTA line geometry GeoJSON (served from memory cache)
  if (parsed.pathname === '/api/geojson') {
    if (!geojsonCache) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GeoJSON not ready yet' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(geojsonCache);
    return;
  }

  // API proxy endpoint
  if (parsed.pathname === '/api/trains') {
    try {
      const trains = await getCachedTrains();
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

  // Follow a specific train run (ETAs for upcoming stops)
  if (parsed.pathname.startsWith('/api/train/')) {
    const rn = parsed.pathname.split('/').pop();
    if (!rn || !/^\d+$/.test(rn)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid run number' }));
      return;
    }
    try {
      const followUrl = `${CTA_FOLLOW}?key=${CTA_KEY}&runnumber=${rn}&outputType=JSON`;
      const data = await fetchJSON(followUrl);
      const ctatt = data.ctatt;
      if (!ctatt || (ctatt.errCd !== '0' && ctatt.errCd !== 0)) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ eta: null }));
        return;
      }
      let etas = ctatt.eta || [];
      if (!Array.isArray(etas)) etas = [etas];
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ eta: etas, position: ctatt.position || null }));
    } catch (e) {
      console.error('CTA Follow API error:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch train details' }));
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
    // Bundle is content-hashed via esbuild; HTML must revalidate to pick up new bundles.
    const cacheHeader = (ext === '.js' && filePath.includes('dist'))
      ? 'public, max-age=31536000, immutable'
      : ext === '.html' ? 'no-cache'
      : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheHeader });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`CTA Map server running at http://localhost:${PORT}`);
});
