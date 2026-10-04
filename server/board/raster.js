'use strict';
// Tiny framebuffer for rendering board output in Node: font previews now,
// simulator screenshots and tests later. Draws text exactly as the board
// will (BDF bitmaps on a pixel grid).

const { PNG } = require('pngjs');
const { getFont } = require('./fonts');

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

class Frame {
  constructor(w = 64, h = 32) {
    this.w = w; this.h = h;
    this.px = new Uint8Array(w * h * 3);
  }

  set(x, y, rgb) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = rgb[0]; this.px[i + 1] = rgb[1]; this.px[i + 2] = rgb[2];
  }

  get(x, y) {
    const i = (y * this.w + x) * 3;
    return [this.px[i], this.px[i + 1], this.px[i + 2]];
  }

  fill(x, y, w, h, color) {
    const rgb = hex(color);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, rgb);
  }

  // Draw text with its baseline at row `baseline` (glyph rows with BDF y >= 0
  // land on rows baseline-1 and up). Returns the x after the last advance.
  text(fontName, str, x, baseline, color) {
    const font = getFont(fontName);
    const rgb = hex(color);
    for (const ch of str) {
      const g = font.glyphs.get(ch.codePointAt(0));
      if (!g) continue;
      const [, h, xo, yo] = g.bbx;
      const top = baseline - (yo + h);
      g.rows.forEach((row, r) => row.forEach((b, c) => { if (b) this.set(x + xo + c, top + r, rgb); }));
      x += g.dw;
    }
    return x;
  }

  // PNG with each LED drawn as a round dot on a dark board.
  toPNG(scale = 10) {
    const png = new PNG({ width: this.w * scale, height: this.h * scale });
    const r = scale * 0.42, cx = (scale - 1) / 2;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const on = this.get(x, y);
      const lit = on[0] || on[1] || on[2];
      const col = lit ? on : [26, 26, 26];
      for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) {
        const d = Math.hypot(i - cx, j - cx);
        const k = ((y * scale + j) * this.w * scale + (x * scale + i)) * 4;
        const inside = d <= r;
        png.data[k] = inside ? col[0] : 8;
        png.data[k + 1] = inside ? col[1] : 8;
        png.data[k + 2] = inside ? col[2] : 8;
        png.data[k + 3] = 255;
      }
    }
    return PNG.sync.write(png);
  }
}

module.exports = { Frame };
