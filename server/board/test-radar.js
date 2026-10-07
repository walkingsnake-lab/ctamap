'use strict';
// Test radar loops for the simulator's test controls: a recorded storm (the
// Aug 10, 2020 derecho) or snowstorm (Feb 2, 2022) cropped around a station,
// the crop sliding a little each frame so the loop moves east. Built once per
// station and kind (one stream decode for all 6 frames), then kept.

const fs = require('fs');
const path = require('path');
const R = require('./radar');

const KINDS = {
  storm: { stamp: '202008102100', mode: 'rain' },
  snow: { stamp: '202202021800', mode: 'snow' },
};
const LOOP = 3;
const STEP = 720;      // s between frames, as in the real loop
const DRIFT = 3;       // LEDs the weather moves per frame

function createTestRadar({ dir = path.join(__dirname, 'fixtures', 'mrms') } = {}) {
  const built = new Map(); // `${kind}:${mapid}` -> Promise<Uint8Array[]>
  const bytes = new Map(); // frame id -> Uint8Array

  const idOf = (kind, mapid, i) => `test-${kind}-${mapid}-${i}`;

  async function build(kind, st) {
    const { stamp, mode } = KINDS[kind];
    const loc = R.loadLocation(st.mapid);
    const wld = R.parseWld(fs.readFileSync(path.join(dir, `lcref_${stamp}.wld`), 'utf8'));
    // Earlier frames are cropped further east, so the weather moves east.
    const locs = Array.from({ length: LOOP }, (_, i) => {
      const [lon] = R.ledCenter(st.lat, st.lon, 32 + (LOOP - 1 - i) * DRIFT, 16);
      return { key: i, lat: st.lat, lon, width: loc.width };
    });
    const crops = await R.crops(fs.createReadStream(path.join(dir, `lcref_${stamp}.png`)), wld, locs);
    return locs.map(({ key }) => {
      const { dbz, geo } = crops.get(key);
      const out = R.toFrame(dbz, geo, mode, loc).bytes;
      bytes.set(idOf(kind, st.mapid, key), out);
      return out;
    });
  }

  return {
    KINDS: Object.keys(KINDS),
    // The payload's radar fields for a test loop at a station (a stations.json entry).
    async want(kind, st, now) {
      const k = `${kind}:${st.mapid}`;
      if (!built.has(k)) built.set(k, build(kind, st).catch((e) => { built.delete(k); throw e; }));
      await built.get(k);
      const loc = R.loadLocation(st.mapid);
      const last = Math.floor(now / STEP) * STEP;
      return {
        on: true,
        frames: Array.from({ length: LOOP }, (_, i) => idOf(kind, st.mapid, i)),
        ft: Array.from({ length: LOOP }, (_, i) => last - (LOOP - 1 - i) * STEP),
        timeBox: loc.timeBox,
        split: loc.split,
      };
    },
    frame: (id) => bytes.get(id) || null,
  };
}

module.exports = { createTestRadar };
