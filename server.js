const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const CTA_KEY = process.env.CTA_KEY;
if (!CTA_KEY) {
  console.error('ERROR: CTA_KEY environment variable is required.');
  process.exit(1);
}
const CTA_BASE = 'http://lapi.transitchicago.com/api/1.0/ttpositions.aspx';
const CTA_FOLLOW = 'http://lapi.transitchicago.com/api/1.0/ttfollow.aspx';
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

// Security headers added to every response
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// Simple in-memory rate limiter (60 requests/min per IP for /api/ endpoints)
const rateLimits = new Map();
function isRateLimited(ip, max = 60, windowMs = 60000) {
  const now = Date.now();
  const times = (rateLimits.get(ip) || []).filter(t => now - t < windowMs);
  times.push(now);
  rateLimits.set(ip, times);
  return times.length > max;
}
setInterval(() => rateLimits.clear(), 300000);

/** Send a response, gzip-compressing if the client supports it. */
function sendResponse(req, res, statusCode, headers, content) {
  const acceptsGzip = (req.headers['accept-encoding'] || '').includes('gzip');
  const allHeaders = { ...SECURITY_HEADERS, ...headers };

  if (acceptsGzip) {
    zlib.gzip(content, (err, compressed) => {
      if (err) {
        res.writeHead(statusCode, allHeaders);
        res.end(content);
        return;
      }
      res.writeHead(statusCode, { ...allHeaders, 'Content-Encoding': 'gzip' });
      res.end(compressed);
    });
  } else {
    res.writeHead(statusCode, allHeaders);
    res.end(content);
  }
}

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
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

  // Serve bundled CTA line geometry GeoJSON
  if (parsed.pathname === '/api/geojson') {
    const geojsonPath = path.join(__dirname, 'data', 'cta-lines.geojson');
    fs.readFile(geojsonPath, (err, content) => {
      if (err) {
        res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read GeoJSON file' }));
        return;
      }
      sendResponse(req, res, 200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      }, content);
    });
    return;
  }

  // API proxy endpoint
  if (parsed.pathname === '/api/trains') {
    if (isRateLimited(clientIp)) {
      res.writeHead(429, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    try {
      const trains = await fetchAllTrains();
      const body = JSON.stringify({ trains });
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch (e) {
      console.error('CTA API error:', e.message);
      res.writeHead(502, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch train data' }));
    }
    return;
  }

  // Follow a specific train run (ETAs for upcoming stops)
  if (parsed.pathname.startsWith('/api/train/')) {
    if (isRateLimited(clientIp)) {
      res.writeHead(429, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    const rn = parsed.pathname.split('/').pop();
    if (!rn || !/^\d+$/.test(rn)) {
      res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid run number' }));
      return;
    }
    try {
      const followUrl = `${CTA_FOLLOW}?key=${CTA_KEY}&runnumber=${rn}&outputType=JSON`;
      const data = await fetchJSON(followUrl);
      const ctatt = data.ctatt;
      if (!ctatt || (ctatt.errCd !== '0' && ctatt.errCd !== 0)) {
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ eta: null }));
        return;
      }
      let etas = ctatt.eta || [];
      if (!Array.isArray(etas)) etas = [etas];
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ eta: etas, position: ctatt.position || null }));
    } catch (e) {
      console.error('CTA Follow API error:', e.message);
      res.writeHead(502, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch train details' }));
    }
    return;
  }

  // Static file serving
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(__dirname, filePath);

  // Prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, SECURITY_HEADERS);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Long-lived cache for immutable dist/ assets; no-cache for HTML
  const isHtml = ext === '.html';
  const isDist = filePath.includes(path.sep + 'dist' + path.sep);
  const cacheControl = isHtml
    ? 'no-cache'
    : isDist
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=86400';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, SECURITY_HEADERS);
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    sendResponse(req, res, 200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    }, content);
  });
});

server.listen(PORT, () => {
  console.log(`CTA Map server running at http://localhost:${PORT}`);
});
