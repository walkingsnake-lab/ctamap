# CTA LED Board: Wide Board (128 × 32) Screen Plan

**Status: built (Nov 5, 2026); not yet checked on hardware.** How each screen looks on a board of two 64 × 32 panels chained (128 × 32). Every screen below has its 128 layout, and so do the board's own status screens (§11); a screen without one would draw at 64 on both panels (contract: "Width"). §10 lists what's still open. Anything this plan doesn't mention works as in [`design-spec.md`](design-spec.md) (fonts, colors, row anatomy, animations, fitting rules).

Mockups: `docs/board/mockups/w128/`, rendered by `scripts/mock-128-screens.js`, `mock-128-clocks.js` and `mock-128-worldmap.js` with the board's fonts and LED preview. Decisions from the review of Nov 4, 2026; each section says whether it's **decided**, **liked**, a **first pass**, or **open**.

---

## 1. Hardware

| Item | Notes |
|---|---|
| Panels | Two 64 × 32 P4 panels chained: 512 × 128 mm, twice the length of the current bar case. |
| Driver | The S3's ESP32-HUB75-MatrixPanel-DMA driver chains panels (chain length 2). The frame buffer and the power at full white double. |
| Board | Matrix Portal S3 only. The frozen M4 stays 64 wide. |

## 2. Principles

- **One screen, not two.** Use the width; don't put two existing 64-wide screens side by side. The exceptions are splits whose halves mean something (northbound | southbound) and designed side panels (the day/night sun panel, the analog calendar).
- **Same type, colors and rows as 64.** Tom Thumb, 5x7, the clock digits; 5 px text rows at the 64 layouts' pitches (6 px with a header, 8 px for three rows); the same header, amber/dim times, line blocks and glyphs. Text runs to the edges (x0 and x127).
- **Where the width goes:** full names, more times per row, more destinations, more forecast slots, and words spelled out where 64 uses a glyph or a cut name.
- **Units after a number are lowercase:** `h` and `m` (`4m`, `10h 24m`, `1h30`), as in the 64 chronological view. In Tom Thumb the capitals H and M are both 3 × 5 boxes that differ only in the middle, and `3M` reads as millions; lowercase `h` has an ascender and `m` is short and 5 px wide. Words stay uppercase (`RAIN IN 25 MIN`, `NEXT 2 HRS`); the ticker keeps its `min` glyph.
- **Halves** (splits, two-column lists): columns 0–61 and 65/66–127, a 3–4 px gutter between them.

---

## 3. Transit

### Destination rows (decided; built)
- Same anatomy and row geometry as 64 (§5): header on rows 0–6 (station `#808080` left, clock right), rows at 8, 14, 20, 26 with four rows, 1, 7, 13, 19, 25 with five and no header.
- **Full CTA names** (`95TH/DAN RYAN`, `FOREST PARK`), **up to 5 times** per row, right-aligned as a group as now. A time is dropped when it would come within 3 px of the name.
- **No weather in the header** (station and clock only). The weather strip stays an option as at 64.

### Northbound | southbound split (decided Nov 5; built, the wide default)
- Two halves, a direction label on row 0 of each (`NORTHBOUND`, `SOUTHBOUND`, or `WESTBOUND`, `EASTBOUND`), rows at 10 and 18 (2 rows) in each half, up to **3 rows a half** (8, 14, 20), station and clock on the bottom row in `#555555`. North or west on the left.
- A per-board layout choice (`wideLayout`: split, the default, or rows). Halves come from each train's direction code (`trDr` in Train Tracker) and which way that direction heads at the station.
- **Only where it's true:** every line at the station runs along the same axis there (`station-dirs.json`, from the track geometry: within 35° of north-south or of east-west; Red and Purple count as north-south everywhere off the Loop) and none ends there. 59 stations split north-south, 51 east-west.
- **Inbound | outbound** where the compass doesn't give one but every line reaches the Loop (decided Nov 8, as a fallback only): diagonal stretches (Blue's Milwaukee Avenue, Orange southwest) and mixed axes (Sedgwick). 14 stations. Inbound (toward the Loop) on the left.
- **Departing | arriving from** at an end of the line (decided Nov 8): departures left, trains ending their runs there right, by where they came from. 12 stations, Howard included.
- **Elsewhere** (the 8 Loop stations, more than 3 destinations in a half): full-width destination rows while they fit, then two columns, then the chronological list.

### Busy stations, replacing the chronological view (built)
The chronological view is the weakest transit screen. For stations with 4–5 lines (Clark/Lake), three layouts were mocked:
1. **One row per line:** up to 5 lines; a line's second destination starts at column 66 (`O'HARE 3 10 18 | FOREST 6 21 33`). Short names (`destinations.js`), three times per destination.
2. **Two columns of four under the header:** up to 8 destinations, short names, three times each.
3. **Five rows, no header:** full names; only for five destinations or fewer.

**Fitting order:** destination rows (as many as fit) → one row per line (≤ 5 lines, ≤ 2 destinations each) → two columns (≤ 8) → chronological view as the last resort. Re-checked on every update, as now. **Built (Nov 5):** rows → one row per line → two columns → chronological. One row per line keeps 3 times in a half and up to 5 across a whole row (full names there).

### Key layout (built; changed Nov 5)
`trains to` flush left and `minutes` at the right on the top row, nothing between them: no station or clock anywhere. Rows sit as under a header.

### Alerts (first pass; built)
The full destination, the red alert circle, then the alert's **short label in red** (`MAJOR DELAYS`), then the times. The label is the alert's CTA `Impact` (`MAJOR DELAYS`), sent per row as `aw`; it costs a row its fourth and fifth times if need be, and is left out when it doesn't fit.

### Overnight, no data, stale (built; changed Nov 5)
Just the owl, big clock and NO TRAINS (NO DATA), the 64 composition 32 px in with the line across the width. The current-and-tomorrow panel was tried and dropped. Stale keeps its red line across the top.

### Ticker (decided; built)
After the CTA's platform signs:
- Bands at rows 7–18 and 20–31; the grey index column (0–4) with the **row number**; the band in the line color at 55 % from column 5 to 127.
- **Full destination** in 5x7 at x7 (`95th/Dan Ryan`); a line with a major alert has the **red alert circle after the name**, 3 px on, as the CTA's signs do (Nov 8; the 64 ticker keeps it in the index column for room).
- **Time at the far right** (`Due`, `3 min`, the min glyph as now), 3 px clear of the status icon.
- **Status icon** at the right edge, on the text's baseline: three waves (6 × 6) for a live train, the 5 × 5 clock for a schedule-based one (`isSch`) (Nov 8; they were 7 × 7).
- Pages of two, as now.

### Warnings on the weather strip (first pass; built)
Spelled out: glyph, `TORNADO WARNING` and `UNTIL 7:45 PM` in a dimmer red, the temperature at left. The end comes from the NWS alert (`warn.until`, wide boards only); when it doesn't all fit, `SEVERE` goes first, then `UNTIL`, then the time. Blinking as now.

---

## 4. Weather

### Top bar (decided: optional; built)
The current-conditions bar (icon, temperature, condition, ↑high ↓low) becomes a **per-board setting**. Off, its eight rows go to the layout below; on, layouts give something up (below).

### 7-day forecast (built)
Seven 18-px columns split by dim dividers: weekday, icon, high (temperature color), low (60 %). With the top bar on, the lows drop out. Today first (NWS gives today and six more days, not seven after today); without NWS (WeatherAPI's 3 days) the 64 layout shows on both panels.

### Hourly, 24 hours (built)
Eight 16-px columns, 3 hours apart, on the hours divisible by 3 (3P, 6P, …): time, icon, temperature. With the top bar off, a fourth line shows each slot's rain chance (blue from 20 %, dim below, grey at 0). From the NWS hourly feed; without it, the 64 layout.

### Current conditions (first pass; built as mocked)
A 2× icon (16 × 16) and the temperature in the clock digits, high/low and date under them on the left; the readout on the right (columns 58–127) with dot leaders: `SKY`, `FEELS`, `WIND`, `RAIN`, then the next `SUNRISE` or `SUNSET`.

### Rain bars (cut)
Cut from the board altogether (Nov 5): no dependable 15-minute precipitation source.

---

## 5. Radar (decided; built)

- **Map across all 128 columns, no panel.** 1.5 mi per LED as at 64, the station at x69 (about 100 mi west, where weather comes from; the lake and part of Michigan east), rows centered on it as now. Water masked black with the shoreline, per station at 128 wide (`build-locations.js`). Frames are 128 × 32 (4 KB).
- **Time chip** in the bottom-right corner: a 27 × 6 black backing (columns 101–127, rows 26–31: 1 px of black above the text, decided Nov 5) with the time (label white) and AM/PM (`#8f8f8f`) in Tom Thumb, right-aligned. The chip has its own backing, so unlike the 64 layout it needs no open water: one layout for every station.
- **Frame indicator:** six 1-px dots, 1 px apart from the left edge, the frame on screen amber and the rest `#4a4a4a`, with **the gaps between them black**, nothing beyond the dots (decided Nov 5, after trying them straight on the map and in a box). On the bottom row (row 31), or with a left chip, on row 25 just above it.
- **Left chip** at the bottom left, same height: a watch or warning (glyph + `WATCH`/`WARNING`, the full word at this width, in place of the temperature, decided Nov 5), else (optional, per board, the radar's conditions setting) the temperature in Tom Thumb (label white).

**Why:** at 64 the time sits over open water or the map splits; at 128 a fixed spot over the lake fails at 56 of 144 stations (checked against `stations.json` and the lake outline: the Loop and South Side reach the Indiana shore). Also mocked, not chosen (`radar-p*.png`, `radar-s*.png`): a split map with a time panel and five panel variants (big time, loop position, color key, conditions first), one fixed Chicago map for every board, a full-width map with a status bar, local and regional zooms side by side, and a nearest-rain panel (`17 MI SW`, computed from the frame).

---

## 6. Clock faces

### Day/night map (decided, built)
- The map at true shape on all 32 rows: **80 × 32 at 4.5° per pixel**, 84° N to 60° S, built like the 64 map (`build-world.js`: Natural Earth land, Blue Marble colors). No bottom time bar.
- **Sun panel** on columns 83–127: the time in 5x7 with AM/PM; a divider; sunrise and sunset, each as a **sun icon** in the time's color, then the up or down arrow, then the time; then day length (`DAY 10h 24m`). Sunrise and sunset from WeatherAPI's astronomy data, which the server already fetches for auto brightness.
- **Sun icon** (decided): 7 × 5, the same height as the text: two rows of a 3-wide sun on a `#555555` horizon line, with five one-pixel rays (top, the two upper diagonals just outside the sun's corners, and one each side level with the sun's lower row). Rejected: the plain half sun, an arrow through an open dome, and a rising/sinking pair without arrows (`map-sun-*.png`).

### Seventies (decided, built)
The three stripes run along the bottom, climb at columns 62–69, and run along the top to the right edge; the top turn on the same 2 px band as the climb and the runs. The time in the VCR digits on the left, banded as at 64; under the top run, the **weekday in full** (`TUESDAY`), then `NOV 3` and the temperature.

### Analog + calendar (built)
The analog face (columns 0–33) and the month in seven 13-px columns: five week rows at a 6 px pitch, no weekday header, weekends dimmer, today on a block in the accent at 40%. The calendar replaces the face's date and temperature. A sixth week's days go in the first row's empty cells. **Accent** (decided Nov 5): one of eight colors (amber, coral, pink, violet, blue, cyan, mint, lime) for the second hand and today's block.

### Word clock (built, wide only)
Every word on the grid stays faintly lit (`#2a2a2a`); the words that tell the time light amber, rounded to five minutes (`IT IS TWENTY MINUTES TO TEN IN THE EVENING`). Built with `MORNING`, `AFTERNOON` and `EVENING` on the last row (the mockup had only `EVENING`), and the hours in reading order across rows 2–4. A 64-wide version is possible: 16 × 5 run-together letters with shared letters (`SEVENINEIGHTWO`), no `IT IS`/`MINUTES`, AM/PM in the spare cells, and W drawn 3 px wide (Tom Thumb's is 5).

### Gradient (built)
The same block digits widened to 7 × 6 blocks (21 × 30), so the time fills the width as at 64 (`12:58` is 108 px); the gradient spans all 128 columns.

### Big digits (decided Nov 5, built)
The time alone in 23-row digits (UW ttyp0 Bold 40, the same family as the 64 face's), centered; the colon blinks as at 64. Mocked, not chosen: seconds in the 13-row digits after the time, a small AM/PM, a row of 60 dots filling through the minute.

### Day/date (decided Nov 5, built)
The weekday over the date (5x7) on the left, a divider, the time in the 23-row digits with AM/PM on the right. The widest case (`WEDNESDAY`, `12:58 PM`) uses every column. Mocked, not chosen: the date spelled out over the time, the time with a weekday/date/temperature panel, a tear-off calendar page.

### Skyline (decided Nov 5, built)
**Panorama:** the 64 scene in the middle and a continuous skyline of generic towers on both sides, the left for the South Loop and the right running on to the edge (no Gold Coast stepping down to the lake). Sun, moon, pier, wheel and lightning stay with the 64 scene; stars, rain and snow double; clouds and boats run the whole width. Rejected: the big-clock layout (the 64 scene and open lake with the time over the water).
---

## 7. Announce (built)

- **Note, typewriter:** about 21 characters a line in 5x7 (10 at 64), the same line bases; the note's Tom Thumb fallback up to 5 lines as wide as both panels.
- **Big word:** 3× instead of 2× (18-px capitals, rows 7–24) for up to about 7 characters; longer words drop to 2× (about 10).
- **Credits roll:** unchanged apart from the longer lines.
- The server lays the message out for the board's width and checks it fits that width; the phone's preview and style tiles draw it 128 wide (built Nov 5).

## 8. Baseball

- **Line score (first pass, built Nov 5):** innings 1–9 (the last nine in extras), R H E, then the inning, count, outs and bases on the bottom row. The innings come from the linescore the server already fetches (`rs`, `h`, `e`, wide boards only); the pitch count isn't in it, so it's left out. Every layout draws the line score for now (no logos). Pregame: names and records, first pitch on the bottom row; finals: `X` for an unneeded home half, `FINAL` bottom left.
- Logos at 128 and a richer pregame aren't planned yet.

## 9. Knob chooser (variant strip; built)

The interaction stays as at 64 (twist = category, press = next variant, hold and turn = step variants, rest 1 s commits; the chosen view fills the panel while choosing). The bar changes:

- **Variant strip** on rows 21–31 (black band): the chosen category's 7 × 7 icon at x2 (rows 23–29) in its color with the underline on row 31, then **all its variants as words** in Tom Thumb on baseline 29 from x14: the chosen one white, the rest `#4a4a4a`. The strip shows what a press will do.
- **Spacing:** 5 px between words, closer when a category needs it to stay within columns 14–123.
- **Names:** Transit `ROWS TICKER`; Weather `NOW 7-DAY HOURLY RADAR`; Clock `SKY 70S DIAL MAP GRAD BIG DATE WORDS` (short names). Eight clock faces don't fit columns 14–123 even 3 px apart, so the strip keeps 5 px gaps and shifts left by whole words until the chosen one shows whole (built Nov 5).
- **Categories without variants** (Announce, Cycle): the category's name in its color takes the strip.
- **Ring position:** five 1-px dots in a column at x126 (rows 22–30, 2 px apart), each in its category's color, the chosen one full and the rest at 30 %.
- Twisting swaps the whole strip (and slides the view sideways, as at 64); pressing moves the white word along it (and slides the view vertically).

Also mocked (`dial-*.png`): icons in place with the chosen one named, a centered wheel, a chip with no bar, and two rows of icons and words.

---

## 10. Open questions

- **Hardware check:** none of the 128 layouts has run on the two-panel board yet. Draw time per frame (the serial report's `last_ms` / `max_ms`) during digit rolls, the credits roll and screen slides, and free memory with 128-wide radar frames.
- **Direction labels at Loop stations:** settled by not splitting there; the Loop falls back to rows. Mixed axes and diagonal track get inbound | outbound, ends of the line departing | arriving from (§3, Nov 8).
- **Baseball beyond the line score:** logos at 128, a fuller pregame.

## 11. What the software needs (done)

- **The board's width.** `cols` (64 or 128) in the S3's flash sets the chain length; the board sends `w=128` with each `/board/update` and `/board/select`, the server keeps it as the board's `cols` and sends `cols: 128` in its payloads. A 64 board gets exactly what it got before. Frames are 128 wide; slides and fades run across all 128 columns (contract: "Width").
- **Server layouts by width.** `arrivals.js` (rows, the split, the busy-station chain, alert words), weather (7 days, 24 hours, wide conditions), radar crop width and masks, sun times, warning expiries, the announce layout and its validation, and the baseball line score: chosen per board width.
- **`draw.js` and `draw.cpp`.** Every screen has a 128 layout behind the width, with parity scenarios at both widths (`firmware/tests/scenarios.js`, the `wide …` ones).
- **Assets.** New glyphs and the 80 × 32 world map, generated as before.
- **Firmware.** Radar frame buffers for 128-wide frames (`pk=4`, 2 KB a frame packed). The status screens (WiFi, setup, portal, no server, updating, no setup) are drawn across both panels, centered on 128, with room for twice the detail (a whole network name, the MAC on one line): `render_status(f, kind, detail, cols)`, the width from the panel (`Display::cols()`). Memory (review, Nov 6): the frame-sized buffers kept for the board's life (the panel's frame, the transition copies, the peek and skyline scratch frames: eight of 12 KB) come from PSRAM (`draw::big_alloc`, set by `device::use_psram`), leaving internal RAM to TLS and the HUB75 DMA buffers, which double with two panels; if the driver can't double buffer it starts with one buffer, and if it can't start at all frames go nowhere instead of to a half-made driver. The serial log and `hl` show the largest internal-RAM block. First hardware run (Nov 8): with the core's 16 KB PSRAM threshold, everything smaller (the payload's JSON tree, strings, TLS) stayed internal and a two-panel board went online with 4 KB free; `use_psram` now sends allocations of 64 bytes and up to PSRAM first.
- **Control page.** Renders, previews and the picker tiles are 4:1 on a wide board: `tiles.json` carries a 128 × 32 tile (`w:<tile>`) for each picker option, which the page uses on a wide board.
