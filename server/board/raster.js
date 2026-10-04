'use strict';
// Node framebuffer: draw.js's Frame with the board fonts loaded, plus PNG
// output. Used by font previews, render.js, tests, and the simulator's PNGs.

const { PNG } = require('pngjs');
const { Frame: DrawFrame } = require('./draw');
const { packFonts } = require('./fonts');

class Frame extends DrawFrame {
  constructor(w = 64, h = 32) {
    super(w, h, packFonts());
  }

  // PNG with each LED drawn as a round dot on a dark board.
  // `off` is the color of unlit LEDs; keep it darker than any faint lit fill.
  toPNG(scale = 10, off = [12, 12, 12]) {
    const png = new PNG({ width: this.w * scale, height: this.h * scale });
    const r = scale * 0.42, cx = (scale - 1) / 2;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const on = this.get(x, y);
      const lit = on[0] || on[1] || on[2];
      const col = lit ? on : off;
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
