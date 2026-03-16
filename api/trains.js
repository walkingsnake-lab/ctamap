const http = require('http');

const CTA_KEY = process.env.CTA_API_KEY;
const CTA_BASE = 'http://lapi.transitchicago.com/api/1.0/ttpositions.aspx';
const ROUTES = ['red', 'blue', 'brn', 'G', 'org', 'P', 'pink', 'Y'];

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

module.exports = async function handler(req, res) {
  try {
    const trains = await fetchAllTrains();
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ trains });
  } catch (e) {
    console.error('CTA API error:', e.message);
    res.status(502).json({ error: 'Failed to fetch train data' });
  }
};
