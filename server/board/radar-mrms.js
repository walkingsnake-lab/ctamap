'use strict';
// The radar's main source (contract "Radar", design spec §7): NOAA's own
// MRMS files on AWS (NOAA Open Data Dissemination, bucket noaa-mrms-pds),
// SeamlessHSR: the seamless hybrid-scan reflectivity mosaic (each spot from
// the lowest radar beam not blocked by terrain), every 2 minutes on the even
// minute, about a minute after its time, on a 0.01° grid (7000 x 3500 for
// CONUS). It's the product IEM's lcref frames are made from (index =
// floor((dBZ + 32) * 2)), the board's first source, so frames are the same.
//
// Each file is gzipped GRIB2 whose data section is a 16-bit grayscale PNG
// (data representation template 5.41): value = (R + X * 2^E) / 10^D, with
// -999 for no radar coverage and -99 for no echo. The file is streamed
// through gunzip, the GRIB headers are read, and the PNG goes to
// radar-png.js, which reads only the rows around the stations and then
// stops the download. Values become the pipeline's lcref-style indices
// (dBZ = index * 0.5 - 32; 255 missing).

const zlib = require('zlib');
const { PassThrough } = require('stream');

const BUCKET = 'https://noaa-mrms-pds.s3.amazonaws.com';
const PRODUCT = 'SeamlessHSR_00.00';
const MAX_HEADER = 1 << 20; // GRIB sections before the data, at most (they're ~200 bytes)

// The file for a slot stamp (YYYYMMDDHHMM, UTC; files are named to the second, :00).
const fileKey = (stamp) => `CONUS/${PRODUCT}/${stamp.slice(0, 8)}/MRMS_${PRODUCT}_${stamp.slice(0, 8)}-${stamp.slice(8, 12)}00.grib2.gz`;
const fileUrl = (stamp) => `${BUCKET}/${fileKey(stamp)}`;

// GRIB2 sign-magnitude integers (negative: top bit set).
const smInt16 = (b, o) => { const v = b.readUInt16BE(o); return v & 0x8000 ? -(v & 0x7fff) : v; };
const smInt32 = (b, o) => { const v = b.readUInt32BE(o); return v & 0x80000000 ? -(v & 0x7fffffff) : v; };

// GRIB2 sections 0-6 from the start of a (gunzipped) message: the grid and
// the scaling, and where section 7's PNG starts. Null while `buf` doesn't
// reach section 7 yet.
function parseHeader(buf) {
  if (buf.length < 16) return null;
  if (buf.toString('latin1', 0, 4) !== 'GRIB' || buf[7] !== 2) throw new Error('not a GRIB2 message');
  let off = 16, grid = null, drs = null;
  while (off + 5 <= buf.length) {
    const len = buf.readUInt32BE(off), num = buf[off + 4];
    if (num === 7) {
      if (!grid || !drs) throw new Error('GRIB2: data before its grid or packing');
      return { grid, drs, dataStart: off + 5, dataLength: len - 5 };
    }
    if (off + len > buf.length) return null;
    const s = buf.subarray(off, off + len);
    if (num === 3) {
      if (s.readUInt16BE(12) !== 0) throw new Error(`GRIB2: grid template ${s.readUInt16BE(12)}, expected 0 (lat/lon)`);
      grid = {
        nx: s.readUInt32BE(30), ny: s.readUInt32BE(34),
        lat1: smInt32(s, 46) / 1e6, lon1: smInt32(s, 50) / 1e6,
        dx: s.readUInt32BE(63) / 1e6, dy: s.readUInt32BE(67) / 1e6, scan: s[71],
      };
    } else if (num === 5) {
      if (s.readUInt16BE(9) !== 41) throw new Error(`GRIB2: packing template ${s.readUInt16BE(9)}, expected 41 (PNG)`);
      drs = { R: s.readFloatBE(11), E: smInt16(s, 15), D: smInt16(s, 17), bits: s[19] };
    }
    off += len;
  }
  return null;
}

// The grid as the world file radar.js geometry() takes (pixel centers;
// rows north to south).
function wldOf(grid) {
  if (grid.scan !== 0) throw new Error(`GRIB2: scanning mode ${grid.scan}, expected 0`);
  const lon = grid.lon1 > 180 ? grid.lon1 - 360 : grid.lon1;
  return { dx: grid.dx, dy: -grid.dy, x0: Math.round(lon * 1e6) / 1e6, y0: grid.lat1 };
}

// 16-bit packed value -> lcref-style index: 255 for no coverage / no echo
// (below -90 dBZ), else floor((dBZ + 32) * 2) within 0..254, as IEM made
// its lcref frames. (The small epsilon keeps 0.1-dB steps that are exact
// in decimal from flooring a step low in binary.)
function gray16Lut({ R, E, D }) {
  const lut = new Uint8Array(65536);
  const e = Math.pow(2, E), d = Math.pow(10, D);
  for (let x = 0; x < 65536; x++) {
    const v = (R + x * e) / d;
    lut[x] = v < -90 ? 255 : Math.max(0, Math.min(254, Math.floor((v + 32) * 2 + 1e-9)));
  }
  return lut;
}

// A gzipped GRIB2 stream -> { wld, png (Readable of the PNG bytes), gray16 }.
// Destroying `png` destroys everything upstream (radar-png.js stops early).
function openGrib(gz) {
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    let buf = Buffer.alloc(0), png = null, left = 0, settled = false;
    const fail = (e) => {
      if (png) png.destroy(e);
      else if (!settled) { settled = true; reject(e); }
      gunzip.destroy(); if (typeof gz.destroy === 'function') gz.destroy();
    };
    gunzip.on('data', (chunk) => {
      try {
        if (!png) {
          buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
          const h = parseHeader(buf);
          if (!h) { if (buf.length > MAX_HEADER) throw new Error('GRIB2: no data section'); return; }
          png = new PassThrough({
            destroy(err, cb) { gunzip.destroy(); if (typeof gz.destroy === 'function') gz.destroy(); cb(err); },
          });
          png.on('drain', () => gunzip.resume());
          left = h.dataLength;
          settled = true;
          resolve({ wld: wldOf(h.grid), png, gray16: gray16Lut(h.drs), grid: h.grid, drs: h.drs });
          chunk = buf.subarray(h.dataStart);
          buf = null;
        }
        if (left <= 0) return;
        const part = chunk.length > left ? chunk.subarray(0, left) : chunk;
        left -= part.length;
        if (!png.write(part)) gunzip.pause();
        if (left <= 0) png.end();
      } catch (e) { fail(e); }
    });
    gunzip.on('end', () => { if (!png) fail(new Error('GRIB2 ended before its data')); else if (left > 0) png.destroy(new Error('GRIB2 data truncated')); });
    gunzip.on('error', (e) => fail(e));
    gz.on('error', (e) => fail(e));
    gz.pipe(gunzip);
  });
}

// fetch(stamp) for createRadar: the slot's file from the bucket (a 404
// until it's there). get(url) resolves to a response stream (radar.js get()).
function createMrmsSource({ get }) {
  return async function fetch(stamp) {
    const src = await openGrib(await get(fileUrl(stamp)));
    return { ...src, src: 'mrms' };
  };
}

module.exports = { createMrmsSource, openGrib, parseHeader, gray16Lut, wldOf, fileKey, fileUrl, PRODUCT, BUCKET };
