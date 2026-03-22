const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT    = process.env.PORT || 3000;
const CTA_KEY = process.env.CTA_KEY;
if (!CTA_KEY) {
  console.error('[startup] CTA_KEY environment variable is required');
  process.exit(1);
}
const CTA_BASE   = 'http://lapi.transitchicago.com/api/1.0/ttpositions.aspx';
const CTA_FOLLOW = 'http://lapi.transitchicago.com/api/1.0/ttfollow.aspx';
const ROUTES = ['red', 'blue', 'brn', 'G', 'org', 'P', 'pink', 'Y'];

// How often the server re-fetches CTA data and broadcasts to SSE clients (ms).
// CTA updates every ~60-120s; 20s is a balanced poll that stays responsive
// without burning the 100K daily transaction limit.
const POLL_INTERVAL = 30000;

// ---- Server-side train processing ----
const geoState   = require('./server/geo-state');
const { processTrains, resetState } = require('./server/train-state');
const metrics    = require('./server/metrics');

// Initialize geometry synchronously at startup — GeoJSON is 116 KB, fast read.
geoState.init();

// Cache GeoJSON bytes for the /api/geojson endpoint (same file, already parsed above).
let geojsonCache = null;
fs.readFile(path.join(__dirname, 'data', 'cta-lines.geojson'), (err, buf) => {
  if (err) console.error('Failed to pre-load GeoJSON bytes:', err.message);
  else geojsonCache = buf;
});

// ---- SSE client registry ----
// Each entry: { res, id }
const sseClients = new Set();

// ---- Processed train payload (latest) ----
let processedPayload = null; // { trains, serverTime }
let lastPollTime = null;     // timestamp of last successful poll

// If the gap since the last poll exceeds this threshold, the machine was likely
// suspended. Stale trainStateMap positions would trigger spurious hold loops on
// the first post-resume poll, so we clear state when this gap is detected.
const STALE_GAP_THRESHOLD = POLL_INTERVAL * 3; // 90s

// ---- CTA API fetch helpers ----

function fetchJSON(fetchUrl) {
  return new Promise((resolve, reject) => {
    http.get(fetchUrl, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(chunks.join(''))); }
        catch (e) { reject(new Error('Invalid JSON from CTA API')); }
      });
    }).on('error', reject);
  });
}

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

// ---- Background polling loop ----

async function pollAndBroadcast() {
  const t0 = Date.now();

  // If we're resuming from a long sleep (machine suspension), stale per-train
  // positions in trainStateMap would cause every train to enter hold loops for
  // several polls before snapping to its real position. Clear state so the first
  // post-resume poll treats all trains as freshly seen.
  if (lastPollTime && (t0 - lastPollTime) > STALE_GAP_THRESHOLD) {
    console.log(`[poll] Resume detected (${Math.round((t0 - lastPollTime) / 1000)}s gap) — clearing stale train state`);
    resetState();
  }

  let errorCount = 0;
  try {
    const rawTrains = await fetchAllTrains();
    const trains    = processTrains(rawTrains, geoState);
    lastPollTime     = Date.now();
    processedPayload = { trains, serverTime: lastPollTime };
    broadcast(processedPayload);
    metrics.recordPoll(trains, Date.now() - t0, errorCount);
    console.log(`[poll] ${trains.length} trains processed, ${sseClients.size} SSE client(s)`);
  } catch (e) {
    errorCount++;
    metrics.recordPoll([], Date.now() - t0, errorCount);
    console.error('[poll] Error:', e.message);
  }
}

// Kick off immediately then repeat
pollAndBroadcast();
setInterval(pollAndBroadcast, POLL_INTERVAL);

// ---- SSE helpers ----

function broadcast(payload) {
  if (sseClients.size === 0) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(data); }
    catch (_) { sseClients.delete(client); }
  }
}

// ---- Follow (ETA) cache — unchanged ----

const FOLLOW_CACHE_TTL = 5000;
const followCache = new Map();

async function getCachedFollow(rn) {
  const now    = Date.now();
  const cached = followCache.get(rn);
  if (cached && now - cached.time < FOLLOW_CACHE_TTL) return cached.body;
  const followUrl = `${CTA_FOLLOW}?key=${CTA_KEY}&runnumber=${rn}&outputType=JSON`;
  const data = await fetchJSON(followUrl);
  const ctatt = data.ctatt;
  let body;
  if (!ctatt || (ctatt.errCd !== '0' && ctatt.errCd !== 0)) {
    body = JSON.stringify({ eta: null });
  } else {
    let etas = ctatt.eta || [];
    if (!Array.isArray(etas)) etas = [etas];
    body = JSON.stringify({ eta: etas, position: ctatt.position || null });
  }
  followCache.set(rn, { body, time: Date.now() });
  return body;
}

// ---- Static file serving ----

const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ---- HTTP server ----

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  // ---- SSE endpoint — train state stream ----
  if (parsed.pathname === '/api/trains/stream') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no', // nginx: disable buffering for SSE
    });

    // Send current payload immediately so new clients don't wait up to POLL_INTERVAL.
    // Skip if the payload is stale (machine was suspended) — the client will receive
    // fresh data on the next broadcast rather than animating from outdated positions.
    if (processedPayload && (Date.now() - processedPayload.serverTime) < STALE_GAP_THRESHOLD) {
      res.write(`data: ${JSON.stringify(processedPayload)}\n\n`);
    }

    const client = { res };
    sseClients.add(client);
    metrics.updateSseClients(1);

    // Heartbeat every 15s to keep connection alive through proxies / load balancers
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); }
      catch (_) { clearInterval(heartbeat); sseClients.delete(client); metrics.updateSseClients(-1); }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(client);
      metrics.updateSseClients(-1);
    });

    return;
  }

  // ---- Health check ----
  if (parsed.pathname === '/health') {
    const ready = processedPayload !== null;
    const body = JSON.stringify({
      ok: ready,
      trains: ready ? processedPayload.trains.length : 0,
      clients: sseClients.size,
      uptime: Math.floor(process.uptime()),
    });
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(body);
    return;
  }

  // ---- Prometheus metrics ----
  if (parsed.pathname === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-cache' });
    res.end(metrics.renderMetrics());
    return;
  }

  // ---- GeoJSON ----
  if (parsed.pathname === '/api/geojson') {
    if (!geojsonCache) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GeoJSON not ready yet' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(geojsonCache);
    return;
  }

  // ---- Raw train positions (REST fallback / debug) ----
  if (parsed.pathname === '/api/trains') {
    if (!processedPayload) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Train data not ready yet' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(processedPayload));
    return;
  }

  // ---- Follow a specific train ----
  if (parsed.pathname.startsWith('/api/train/')) {
    const rn = parsed.pathname.split('/').pop();
    if (!rn || !/^\d+$/.test(rn)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid run number' }));
      return;
    }
    try {
      const body = await getCachedFollow(rn);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch (e) {
      console.error('CTA Follow API error:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch train details' }));
    }
    return;
  }

  // ---- Static files ----
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(__dirname, filePath);

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
