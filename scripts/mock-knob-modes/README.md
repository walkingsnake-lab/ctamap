# Knob chooser mockups (Nov 2, 2026)

Frame generators for the "Knob Mode Chooser" mockup page. Each writes a JSON of
1x PNG data URIs (and optionally a contact sheet) that the page draws as LEDs.
Decision: peek on the icon bar with category colors (project doc "Knob Chooser
Decisions"). Not in `draw.js` yet.

- `screens.js`, `screens2.js`: every view and variant, rendered by `render.js`
  (made-up moment at Morse; the radar frame is synthetic rain on Morse's mask).
- `round1.js <frames.json> [sheet.png]`: seven chooser layouts (top/bottom
  wheel, flat ring, press-for-variant, icon tab bar, live preview, right list).
- `round2.js <frames.json> [sheet.png]`: the icon bar with press, pause-to-open,
  and peek. Round 3's bar styles are drawn by the page itself.
