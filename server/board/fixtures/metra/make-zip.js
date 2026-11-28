'use strict';
// Builds ZIP files for the tests (zip.test.js, metra-schedule.test.js), so the
// made-up schedule in schedule/ can be read the way Metra's schedule.zip is.
// Metra's file is written with data descriptors (bit 3: the local headers
// carry no sizes or checksum; they follow the data), so that's the default.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// entries: [{ name, data (Buffer), method (0 stored, 8 deflated; default 8),
// flags, badCrc }]. opts.descriptor (default true), opts.comment (string).
function makeZip(entries, { descriptor = true, comment = '' } = {}) {
  const locals = [], cens = [];
  let offset = 0;
  for (const { name, data, method = 8, flags = 0, badCrc = false } of entries) {
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const crc = (zlib.crc32(data) ^ (badCrc ? 1 : 0)) >>> 0;
    const f = flags | (descriptor ? 8 : 0);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(f, 6); loc.writeUInt16LE(method, 8);
    if (!descriptor) { loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(body.length, 18); loc.writeUInt32LE(data.length, 22); }
    loc.writeUInt16LE(n.length, 26);
    const parts = [loc, n, body];
    if (descriptor) {
      const dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(body.length, 8); dd.writeUInt32LE(data.length, 12);
      parts.push(dd);
    }
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(f, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(...parts);
    cens.push(cen, n);
    offset += parts.reduce((a, b) => a + b.length, 0);
  }
  const cd = Buffer.concat(cens);
  const c = Buffer.from(comment);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(c.length, 20);
  return Buffer.concat([...locals, cd, end, c]);
}

// The made-up schedule (schedule/*.txt) as a schedule.zip.
const DIR = path.join(__dirname, 'schedule');
function scheduleZip(opts) {
  const names = fs.readdirSync(DIR).filter((n) => n.endsWith('.txt')).sort();
  return makeZip(names.map((name) => ({ name, data: fs.readFileSync(path.join(DIR, name)) })), opts);
}

module.exports = { makeZip, scheduleZip };
