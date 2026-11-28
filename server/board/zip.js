'use strict';
// A small ZIP reader for Metra's GTFS schedule (metra-schedule.js), on Node's
// own zlib: no dependency. Reads the central directory (so entries written
// with data descriptors, whose local headers carry no sizes, work), stored
// and deflated entries only. No ZIP64, no encryption: Metra's file needs
// neither, and anything else throws.

const zlib = require('zlib');

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;

// buf: the whole file. opts.only: names to read (default all). opts.maxEntry:
// the most bytes one entry may inflate to (a guard against a file that
// claims little and inflates to a lot). Returns Map name -> Buffer.
function readZip(buf, { only = null, maxEntry = 32 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('zip: too short');
  // End of central directory: the last 22 bytes, or earlier behind a comment.
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { e = i; break; }
  }
  if (e < 0) throw new Error('zip: no end of central directory');
  const count = buf.readUInt16LE(e + 10), cdSize = buf.readUInt32LE(e + 12), cdAt = buf.readUInt32LE(e + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdAt === 0xffffffff) throw new Error('zip: ZIP64 not supported');
  if (cdAt + cdSize > e) throw new Error('zip: central directory out of range');
  const want = only ? new Set(only) : null;
  const out = new Map();
  let p = cdAt;
  for (let n = 0; n < count; n++) {
    if (p + 46 > e || buf.readUInt32LE(p) !== CEN) throw new Error('zip: bad central directory entry');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (want && !want.has(name)) continue;
    if (flags & 1) throw new Error(`zip: ${name} is encrypted`);
    if (usize > maxEntry) throw new Error(`zip: ${name} is ${usize} bytes; max ${maxEntry}`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOC) throw new Error(`zip: bad local header for ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + csize > buf.length) throw new Error(`zip: ${name} runs past the end`);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: maxEntry });
    else throw new Error(`zip: ${name} uses method ${method}`);
    if (data.length !== usize) throw new Error(`zip: ${name} is ${data.length} bytes, expected ${usize}`);
    if (typeof zlib.crc32 === 'function' && (zlib.crc32(data) >>> 0) !== crc) throw new Error(`zip: ${name} fails its checksum`);
    out.set(name, data);
  }
  return out;
}

module.exports = { readZip };
