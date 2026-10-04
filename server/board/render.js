'use strict';
// Node entry point for the board renderer. All layout and animation logic
// lives in draw.js (shared with the browser simulator); this binds it to the
// board fonts and icons and returns PNG-capable frames.

const { create } = require('./draw');
const { Frame } = require('./raster');
const { packFonts } = require('./fonts');
const icons = require('./icons');
const glyphs = require('./glyphs');
const { TZ } = require('./time');

const draw = create({
  fonts: packFonts(),
  icons: { ICONS: icons.ICONS, PALETTE: icons.PALETTE, ALERT_BANG: icons.ALERT_BANG },
  glyphs,
  tz: TZ,
  makeFrame: () => new Frame(),
});

// Everything the simulator needs to run draw.js in the browser.
function assets() {
  return {
    fonts: packFonts(),
    icons: { ICONS: icons.ICONS, PALETTE: icons.PALETTE, ALERT_BANG: icons.ALERT_BANG },
    glyphs,
    tz: TZ,
  };
}

module.exports = { ...draw, assets };
