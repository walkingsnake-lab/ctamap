'use strict';
// Node entry point for the board renderer. All layout and animation logic
// lives in draw.js (shared with the browser simulator); this binds it to the
// board fonts and icons and returns PNG-capable frames.

const { create } = require('./draw');
const { Frame } = require('./raster');
const { packFonts } = require('./fonts');
const icons = require('./icons');
const { WORLD, WORLD_PALETTE, WORLD_WIDE, WORLD_WIDE_PALETTE } = require('./world');
const glyphs = require('./glyphs');
const { TZ } = require('./time');

const draw = create({
  fonts: packFonts(),
  icons: { ICONS: icons.ICONS, ICONS16: icons.ICONS16, PALETTE16: icons.PALETTE16, PALETTE: icons.PALETTE, ALERT_BANG: icons.ALERT_BANG, OWL: icons.OWL, WORLD, WORLD_PALETTE, WORLD_WIDE, WORLD_WIDE_PALETTE },
  glyphs,
  tz: TZ,
  makeFrame: (w, h) => new Frame(w, h),
});

// Everything the simulator needs to run draw.js in the browser.
function assets() {
  return {
    fonts: packFonts(),
    icons: { ICONS: icons.ICONS, ICONS16: icons.ICONS16, PALETTE16: icons.PALETTE16, PALETTE: icons.PALETTE, ALERT_BANG: icons.ALERT_BANG, OWL: icons.OWL, WORLD, WORLD_PALETTE, WORLD_WIDE, WORLD_WIDE_PALETTE },
    glyphs,
    tz: TZ,
  };
}

module.exports = { ...draw, assets };
