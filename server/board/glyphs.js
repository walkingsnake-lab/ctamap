'use strict';
// Private-use codepoints for the board's custom glyphs. Shared by the font
// build script, the server's text formatting, and (by convention) the board.

module.exports = {
  TT: 0xe000,          // 5x7: "tt" ligature, two narrow t's sharing one crossbar
  MIN: 0xe001,         // 5x7: "min" as one 11px glyph
  BOLT: 0xe002,        // small: 3x5 lightning bolt (severe thunderstorm)
  FUNNEL: 0xe003,      // small: 4x5 funnel (tornado)
  ALERT_DISC: 0xe004,  // small: 5x5 alert circle, red layer ("!" pixels left blank)
  ALERT_MARK: 0xe005,  // small: 5x5 "!" for the alert circle, white layer (same origin)
  CLOCK: 0xe006,       // small: 5x5 clock, replaces the ticker index for schedule-based arrivals
  UP: 0xe007,          // small: 5x5 up arrow (the day's high)
  DOWN: 0xe008,        // small: 5x5 down arrow (the day's low)
};
