'use strict';
// Streaming decoder for MRMS radar frames (8-bit palette PNGs, 7000 x 3500
// for CONUS). A full decode with pngjs takes ~150 MB (it expands to RGBA);
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

// Undo the PNG filter on `row` in place (1 byte per pixel), given the
// previous unfiltered row.
function unfilter(type, row, prev) {
  const n = row.length;
  switch (type) {
    case 0: return;
    case 1: for (let i = 1; i < n; i++) row[i] = (row[i] + row[i - 1]) & 255; return;
    case 2: for (let i = 0; i < n; i++) row[i] = (row[i] + prev[i]) & 255; return;
    case 3: for (let i = 0; i < n; i++) row[i] = (row[i] + (((i ? row[i - 1] : 0) + prev[i]) >> 1)) & 255; return;
    case 4: for (let i = 0; i < n; i++) row[i] = (row[i] + paeth(i ? row[i - 1] : 0, prev[i], i ? prev[i - 1] : 0)) & 255; return;
    default: throw new Error(`bad PNG filter type ${type}`);
  }
}

// source: a Readable of PNG bytes (HTTP response, file stream).
// onRow(y, row): called for y0 <= y <= y1 with a Uint8Array of palette
// indices; the array is reused, so copy what you keep.
// Resolves with { width, height, palette } (palette: Buffer of RGB triples).
function decodeRows(source, { y0 = 0, y1 = Infinity, onRow }) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let sigOk = false, header = null, palette = null;
    let inflate = null, cur = null, prev = null, have = 0, y = 0;
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
      const stride = header.width + 1;
      while (off < data.length) {
        const n = Math.min(stride - have, data.length - off);
        data.copy(cur, have, off, off + n);
        have += n; off += n;
        if (have < stride) break;
        const row = cur.subarray(1);
        unfilter(cur[0], row, prev.subarray(1));
        if (y >= y0 && y <= y1) onRow(y, row);
        y += 1; have = 0;
        [cur, prev] = [prev, cur];
        if (y > y1 || y >= header.height) { finish(); return; }
      }
    }

    function chunk(type, data) {
      if (type === 'IHDR') {
        header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
        if (header.depth !== 8 || header.color !== 3 || header.interlace !== 0) {
          throw new Error(`expected an 8-bit palette PNG, got depth ${header.depth} color ${header.color} interlace ${header.interlace}`);
        }
        cur = Buffer.alloc(header.width + 1);
        prev = Buffer.alloc(header.width + 1);
        inflate = zlib.createInflate();
        inflate.on('data', (d) => { try { onInflated(d); } catch (e) { finish(e); } });
        inflate.on('error', (e) => finish(e));
        // Backpressure: don't read faster than we inflate (bounds memory, and
        // lets an early stop skip the rest of the download).
        inflate.on('drain', () => { if (!done && typeof source.resume === 'function') source.resume(); });
        inflate.on('end', () => finish(y >= Math.min(y1 + 1, header.height) ? null : new Error(`PNG ended at row ${y}`)));
      } else if (type === 'PLTE') {
        palette = Buffer.from(data);
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
