const http = require('http');

const CTA_KEY = process.env.CTA_API_KEY;
const CTA_FOLLOW = 'http://lapi.transitchicago.com/api/1.0/ttfollow.aspx';

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

module.exports = async function handler(req, res) {
  const { rn } = req.query;
  if (!rn || !/^\d+$/.test(rn)) {
    return res.status(400).json({ error: 'Invalid run number' });
  }
  try {
    const followUrl = `${CTA_FOLLOW}?key=${CTA_KEY}&runnumber=${rn}&outputType=JSON`;
    const data = await fetchJSON(followUrl);
    const ctatt = data.ctatt;
    if (!ctatt || (ctatt.errCd !== '0' && ctatt.errCd !== 0)) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.json({ eta: null });
    }
    let etas = ctatt.eta || [];
    if (!Array.isArray(etas)) etas = [etas];
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ eta: etas, position: ctatt.position || null });
  } catch (e) {
    console.error('CTA Follow API error:', e.message);
    res.status(502).json({ error: 'Failed to fetch train details' });
  }
};
