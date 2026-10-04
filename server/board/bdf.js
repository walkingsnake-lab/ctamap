'use strict';
// Minimal BDF reader/writer for the board fonts.
//
// A glyph is { name, code, dw, bbx: [w, h, xoff, yoff], rows: [[0|1,...], ...] }
// where rows[0] is the top row of the bounding box. Bitmaps are kept as
// pixel arrays so build scripts can edit them directly.

const fs = require('fs');

function parseBDF(text) {
  const lines = text.split(/\r?\n/);
  const font = { header: [], props: [], glyphs: new Map() };
  let i = 0;

  // Header up to CHARS (properties kept verbatim, minus counts we recompute).
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('CHARS ')) { i++; break; }
    font.header.push(line);
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('STARTCHAR')) { i++; continue; }
    const g = { name: line.slice(10).trim(), code: -1, dw: 0, bbx: [0, 0, 0, 0], rows: [] };
    i++;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('ENCODING ')) g.code = parseInt(l.slice(9), 10);
      else if (l.startsWith('DWIDTH ')) g.dw = parseInt(l.split(/\s+/)[1], 10);
      else if (l.startsWith('BBX ')) g.bbx = l.split(/\s+/).slice(1, 5).map(Number);
      else if (l === 'BITMAP') {
        const [w, h] = g.bbx;
        for (let r = 0; r < h; r++) {
          const hex = lines[++i].trim();
          const bits = parseInt(hex || '0', 16);
          const nbits = hex.length * 4;
          const row = [];
          for (let c = 0; c < w; c++) row.push((bits >> (nbits - 1 - c)) & 1);
          g.rows.push(row);
        }
      } else if (l === 'ENDCHAR') { i++; break; }
    }
    if (g.code >= 0) font.glyphs.set(g.code, g);
  }
  return font;
}

function loadBDF(file) {
  return parseBDF(fs.readFileSync(file, 'utf8'));
}

function headerValue(font, key) {
  const line = font.header.find((l) => l.startsWith(key + ' '));
  return line ? line.slice(key.length + 1).trim() : null;
}

function rowHex(row) {
  const nbytes = Math.max(1, Math.ceil(row.length / 8));
  let v = 0n;
  for (let c = 0; c < nbytes * 8; c++) v = (v << 1n) | BigInt(row[c] || 0);
  return v.toString(16).toUpperCase().padStart(nbytes * 2, '0');
}

function writeBDF(font) {
  const out = [];
  for (const line of font.header) {
    if (line.startsWith('ENDFONT')) continue;
    out.push(line);
  }
  const glyphs = [...font.glyphs.values()].sort((a, b) => a.code - b.code);
  out.push(`CHARS ${glyphs.length}`);
  for (const g of glyphs) {
    const [w, h, xo, yo] = g.bbx;
    out.push(`STARTCHAR ${g.name}`);
    out.push(`ENCODING ${g.code}`);
    out.push(`SWIDTH ${Math.round((g.dw * 1000) / 8)} 0`);
    out.push(`DWIDTH ${g.dw} 0`);
    out.push(`BBX ${w} ${h} ${xo} ${yo}`);
    out.push('BITMAP');
    for (const row of g.rows) out.push(rowHex(row.length ? row : [0]));
    out.push('ENDCHAR');
  }
  out.push('ENDFONT', '');
  return out.join('\n');
}

module.exports = { parseBDF, loadBDF, writeBDF, headerValue };
