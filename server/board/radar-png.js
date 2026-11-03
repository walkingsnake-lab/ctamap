'use strict';
// Streaming decoder for radar frames: MRMS's own 16-bit grayscale PNGs
// (inside its GRIB2 files, 7000 x 3500 for CONUS; the caller maps values to
// indices with `gray16`), IEM-style 8-bit palette PNGs (test fixtures), and
// the NWS map service's small 8-bit RGB crops (colors mapped with `rgbIndex`). A full decode with pngjs takes ~150 MB (it expands to RGBA);
// the Fly VM has 256 MB shared with the map. This reads the PNG as it
// arrives, inflates IDAT with Node's zlib, unfilters one row at a time, and
// hands only the wanted rows to the caller as palette indices. It stops (and
// destroys the source) once it's past the last wanted row, so a crop near
// the top of the map doesn't even download the rest. Peak memory is two rows.

const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Undo the PNG filter on `row` in place (`bpp` bytes per pixel), given the
// previous unfiltered row.
function unfilter(type, row, prev, bpp = 1) {
  const n = row.length;
  switch (type) {
    case 0: return;
    case 1: for (let i = bpp; i < n; i++) row[i] = (row[i] + row[i - bpp]) & 255; return;
    case 2: for (let i = 0; i < n; i++) row[i] = (row[i] + prev[i]) & 255; return;
    case 3: for (let i = 0; i < n; i++) row[i] = (row[i] + (((i >= bpp ? row[i - bpp] : 0) + prev[i]) >> 1)) & 255; return;
    case 4: for (let i = 0; i < n; i++) row[i] = (row[i] + paeth(i >= bpp ? row[i - bpp] : 0, prev[i], i >= bpp ? prev[i - bpp] : 0)) & 255; return;
    default: throw new Error(`bad PNG filter type ${type}`);
  }
}

// source: a Readable of PNG bytes (HTTP response, file stream).
// onRow(y, row): called for y0 <= y <= y1 with a Uint8Array of palette
// indices; the array is reused, so copy what you keep.
// An 8-bit RGB PNG (color type 2) needs rgbIndex(rgb) -> index, called with
// each pixel's color as 0xRRGGBB, or -1 for the tRNS (transparent) color;
// a 16-bit grayscale PNG (color type 0) needs gray16, a Uint8Array(65536)
// of value -> index. Their rows are handed over as those indices.
// Resolves with { width, height, palette } (palette: Buffer of RGB triples).
function decodeRows(source, { y0 = 0, y1 = Infinity, onRow, rgbIndex = null, gray16 = null }) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let sigOk = false, header = null, palette = null;
    let inflate = null, cur = null, prev = null, have = 0, y = 0;
    let bpp = 1, out = null, clear = -1;     // RGB: bytes per pixel, the index row, the tRNS color
    const cache = new Map();                 // RGB: color -> index
    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      if (inflate) inflate.destroy();
      if (typeof source.destroy === 'function') source.destroy();
      err ? reject(err) : resolve({ width: header && header.width, height: header && header.height, palette });
    };

    function onInflated(data) {
      if (done) return;
      let off = 0;
      const stride = header.width * bpp + 1;
      while (off < data.length) {
        const n = Math.min(stride - have, data.length - off);
        data.copy(cur, have, off, off + n);
        have += n; off += n;
        if (have < stride) break;
        const row = cur.subarray(1);
        unfilter(cur[0], row, prev.subarray(1), bpp);
        if (y >= y0 && y <= y1) {
          if (bpp === 1) onRow(y, row);
          else if (gray16) {
            for (let x = 0; x < header.width; x++) out[x] = gray16[(row[2 * x] << 8) | row[2 * x + 1]];
            onRow(y, out);
          } else {
            for (let x = 0; x < header.width; x++) {
              const c = (row[3 * x] << 16) | (row[3 * x + 1] << 8) | row[3 * x + 2];
              let k = cache.get(c);
              if (k === undefined) { k = rgbIndex(c === clear ? -1 : c); cache.set(c, k); }
              out[x] = k;
            }
            onRow(y, out);
          }
        }
        y += 1; have = 0;
        [cur, prev] = [prev, cur];
        if (y > y1 || y >= header.height) { finish(); return; }
      }
    }

    function chunk(type, data) {
      if (type === 'IHDR') {
        header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
        const rgb = header.depth === 8 && header.color === 2 && typeof rgbIndex === 'function';
        const g16 = header.depth === 16 && header.color === 0 && gray16 instanceof Uint8Array && gray16.length === 65536;
        if (!((header.depth === 8 && header.color === 3) || rgb || g16) || header.interlace !== 0) {
          throw new Error(`expected an 8-bit palette PNG${rgbIndex ? ' or RGB PNG' : ''}${gray16 ? ' or 16-bit gray PNG' : ''}, got depth ${header.depth} color ${header.color} interlace ${header.interlace}`);
        }
        if (rgb) { bpp = 3; out = new Uint8Array(header.width); }
        if (g16) { bpp = 2; out = new Uint8Array(header.width); }
        cur = Buffer.alloc(header.width * bpp + 1);
        prev = Buffer.alloc(header.width * bpp + 1);
        inflate = zlib.createInflate();
        inflate.on('data', (d) => { try { onInflated(d); } catch (e) { finish(e); } });
        inflate.on('error', (e) => finish(e));
        // Backpressure: don't read faster than we inflate (bounds memory, and
        // lets an early stop skip the rest of the download).
        inflate.on('drain', () => { if (!done && typeof source.resume === 'function') source.resume(); });
        inflate.on('end', () => finish(y >= Math.min(y1 + 1, header.height) ? null : new Error(`PNG ended at row ${y}`)));
      } else if (type === 'PLTE') {
        palette = Buffer.from(data);
      } else if (type === 'tRNS' && header && header.color === 2 && data.length >= 6) {
        clear = ((data.readUInt16BE(0) & 255) << 16) | ((data.readUInt16BE(2) & 255) << 8) | (data.readUInt16BE(4) & 255);
      } else if (type === 'IDAT') {
        if (!inflate) throw new Error('IDAT before IHDR');
        if (!inflate.write(data) && typeof source.pause === 'function') source.pause();
      } else if (type === 'IEND') {
        if (inflate) inflate.end();
        else finish(new Error('no image data'));
      }
    }

    source.on('data', (d) => {
      if (done) return;
      try {
        buf = buf.length ? Buffer.concat([buf, d]) : d;
        if (!sigOk) {
          if (buf.length < 8) return;
          if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
          sigOk = true; buf = buf.subarray(8);
        }
        while (buf.length >= 12) {
          const len = buf.readUInt32BE(0);
          if (buf.length < len + 12) break;
          chunk(buf.toString('latin1', 4, 8), buf.subarray(8, 8 + len));
          buf = buf.subarray(len + 12);
          if (done) return;
        }
      } catch (e) { finish(e); }
    });
    let ended = false;
    source.on('end', () => { ended = true; if (!done && inflate) inflate.end(); else if (!done) finish(new Error('PNG truncated')); });
    source.on('error', (e) => finish(e));
    // A connection that just closes (aborted, destroyed after a socket
    // timeout) emits neither 'end' nor 'error' on some paths.
    source.on('close', () => { if (!done && !ended) finish(new Error('PNG source closed early')); });
    source.on('aborted', () => finish(new Error('PNG download aborted')));
  });
}

module.exports = { decodeRows, unfilter };
