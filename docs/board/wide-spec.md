# CTA LED Board: Wide Board (128 × 32) Screen Plan

**Status: planned, not built.** How each screen should look on a board of two 64 × 32 panels chained (128 × 32). Nothing in `server/board/` or the firmware supports the width yet; §11 lists what would have to change. Anything this plan doesn't mention works as in [`design-spec.md`](design-spec.md) (fonts, colors, row anatomy, animations, fitting rules).

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

### Destination rows (decided)
- Same anatomy and row geometry as 64 (§5): header on rows 0–6 (station `#808080` left, clock right), rows at 8, 14, 20, 26 with four rows, 1, 7, 13, 19, 25 with five and no header.
- **Full CTA names** (`95TH/DAN RYAN`, `FOREST PARK`), **up to 5 times** per row, right-aligned as a group as now. A time is dropped when it would come within 3 px of the name.
- **No weather in the header** (station and clock only). The weather strip stays an option as at 64.

### Northbound | southbound split (liked)
- Two halves, a direction label on row 0 of each (`NORTHBOUND`, `SOUTHBOUND`), rows at 10 and 18 (2 rows) in each half, station and clock on the bottom row in `#555555`.
- A per-board layout choice next to header and key. Halves come from each train's direction code (`trDr` in Train Tracker). Labels per line pair need a small table (Loop lines aren't north/south).

### Busy stations, replacing the chronological view (open)
The chronological view is the weakest transit screen. For stations with 4–5 lines (Clark/Lake), three layouts were mocked:
1. **One row per line:** up to 5 lines; a line's second destination starts at column 66 (`O'HARE 3 10 18 | FOREST 6 21 33`). Short names (`destinations.js`), three times per destination.
2. **Two columns of four under the header:** up to 8 destinations, short names, three times each.
3. **Five rows, no header:** full names; only for five destinations or fewer.

**Proposed fitting order:** destination rows (as many as fit) → one row per line (≤ 5 lines, ≤ 2 destinations each) → two columns (≤ 8) → chronological view as the last resort. Re-checked on every update, as now.

### Key layout (first pass)
`trains to` (x5) and `min` (right) on row 0 as now, with the station and clock centered between them, so the station line at the bottom isn't needed.

### Alerts (first pass)
The full destination, the red alert circle, then the alert's **short label in red** (`MAJOR DELAYS`), then the times. Needs a new payload field with a short label per alert; the board knows only that a line has a major alert today.

### Overnight, no data, stale (first pass)
Owl and big clock with `NO TRAINS` as now in columns 0–62; a dim divider on column 65; the right side shows the current temperature and condition, then `TOMORROW` with icon, high (5x7) and low, and the condition. `NO DATA` and stale use the same layout with the red line across the top.

### Ticker (decided)
After the CTA's platform signs:
- Bands at rows 7–18 and 20–31; the grey index column (0–4) with the **row number**; the band in the line color at 55 % from column 5 to 127.
- **Full destination** in 5x7 at x7 (`95th/Dan Ryan`).
- **Time at the far right** (`Due`, `3 min`, the min glyph as now), 3 px clear of the status icon.
- **Status icon**, 7 × 7 at columns 120–126: three arcs for a live train, a clock face for a schedule-based one (`isSch`).
- Pages of two, as now.

### Warnings on the weather strip (first pass)
Spelled out: glyph, `TORNADO WARNING` and `UNTIL 7:45 PM` in a dimmer red, the temperature at left. Needs the alert's expiry in the payload. Blinking as now.

---

## 4. Weather

### Top bar (decided: optional)
The current-conditions bar (icon, temperature, condition, ↑high ↓low) becomes a **per-board setting**. Off, its eight rows go to the layout below; on, layouts give something up (below).

### 7-day forecast (liked)
Seven 18-px columns split by dim dividers: weekday, icon, high (temperature color), low (60 %). With the top bar on, the lows drop out. NWS already gives seven days.

### Hourly, 24 hours (liked)
Eight 16-px columns, 3 hours apart: time, icon, temperature. With the top bar off, a fourth line shows each slot's rain chance (blue from 20 %, dim below). The server builds 4 slots today (`HOUR_STEPS`); the NWS hourly feed covers 24 hours.

### Current conditions (first pass)
A 2× icon (16 × 16) and the temperature in the clock digits, high/low and date under them on the left; the readout on the right (columns 58–127) with dot leaders: `SKY`, `FEELS`, `WIND`, `RAIN`, `SUNSET`.

### Rain bars (first pass)
The top bar with the title centered (`RAIN IN 25 MIN`); the eight quarter-hours across the full width (16 px each, 14 px bars), the same intensity scale and blues; `NOW 30m 1h 1h30 2h` under the axis. **No data source today:** WeatherAPI has no 15-minute precipitation, so the 64 rain bars don't show either; the layout waits for a source.

---

## 5. Radar (decided)

- **Map across all 128 columns, no panel.** 1.5 mi per LED as at 64, the station at x69 (about 100 mi west, where weather comes from; the lake and part of Michigan east), rows centered on it as now. Water masked black with the shoreline, per station at 128 wide (`build-locations.js`). Frames are 128 × 32 (4 KB).
- **Time chip** in the bottom-right corner: a 27 × 7 black backing (columns 101–127, rows 25–31) with the time (label white) and AM/PM (`#8f8f8f`) in Tom Thumb, right-aligned. The chip has its own backing, so unlike the 64 layout it needs no open water: one layout for every station.
- **Frame indicator:** six 1-px dots on the bottom row (row 31), 1 px apart, the frame on screen amber and the rest `#4a4a4a`, on a black backing (12 × 3). Flush left without the temperature; 3 px right of it with.
- **Temperature chip** (optional, per board): the bottom-left chip grows to hold the temperature in Tom Thumb (label white) and the dots after it (`58°`: 27 × 7).

**Why:** at 64 the time sits over open water or the map splits; at 128 a fixed spot over the lake fails at 56 of 144 stations (checked against `stations.json` and the lake outline: the Loop and South Side reach the Indiana shore). Also mocked, not chosen (`radar-p*.png`, `radar-s*.png`): a split map with a time panel and five panel variants (big time, loop position, color key, conditions first), one fixed Chicago map for every board, a full-width map with a status bar, local and regional zooms side by side, and a nearest-rain panel (`17 MI SW`, computed from the frame).

---

## 6. Clock faces

### Day/night map (decided)
- The map at true shape on all 32 rows: **80 × 32 at 4.5° per pixel**, 84° N to 60° S, built like the 64 map (`build-world.js`: Natural Earth land, Blue Marble colors). No bottom time bar.
- **Sun panel** on columns 83–127: the time in 5x7 with AM/PM; a divider; sunrise and sunset, each as a **sun icon** in the time's color, then the up or down arrow, then the time; then day length (`DAY 10h 24m`). Sunrise and sunset from WeatherAPI's astronomy data, which the server already fetches for auto brightness.
- **Sun icon** (decided): 7 × 5, the same height as the text: two rows of a 3-wide sun on a `#555555` horizon line, with five one-pixel rays (top, the two upper diagonals just outside the sun's corners, and one each side level with the sun's lower row). Rejected: the plain half sun, an arrow through an open dome, and a rising/sinking pair without arrows (`map-sun-*.png`).

### Seventies (decided)
The three stripes run along the bottom, climb at columns 62–69, and run along the top to the right edge; the top turn on the same 2 px band as the climb and the runs. The time in the VCR digits on the left, banded as at 64; under the top run, the **weekday in full** (`TUESDAY`), then `NOV 3` and the temperature.

### Analog + calendar (liked)
The analog face (columns 0–33) and the month in seven 13-px columns: five week rows at a 6 px pitch, no weekday header, weekends dimmer, today on an amber block. The calendar replaces the face's date and temperature.

### Word clock (liked, wide only)
Every word on the grid stays faintly lit (`#2a2a2a`); the words that tell the time light amber, rounded to five minutes (`IT IS TWENTY MINUTES TO TEN IN THE EVENING`). A 64-wide version is possible: 16 × 5 run-together letters with shared letters (`SEVENINEIGHTWO`), no `IT IS`/`MINUTES`, AM/PM in the spare cells, and W drawn 3 px wide (Tom Thumb's is 5).

### Gradient (first pass)
The same block digits widened to 7 × 6 blocks (21 × 30), so the time fills the width as at 64 (`12:58` is 108 px); the gradient spans all 128 columns.

### Skyline (open)
Two directions, both using the real renderer patched to 128 columns:
- **Panorama:** the 64 scene in the middle, the South Loop added on the left and the Gold Coast stepping down to the beach on the right. Needs new building art.
- **Big clock:** the 64 scene on the left, open lake and sky on the right with the time in the clock digits and the date over the water.
Most of the skyline code already takes its width from a variable, and the server's cloud strip is already 128 wide.

---

## 7. Announce

- **Note, typewriter:** about 21 characters a line in 5x7 (10 at 64), the same line bases.
- **Big word:** 3× instead of 2× (21-px letters) for up to about 7 characters; longer words drop to 2× (about 10).
- **Credits roll:** unchanged apart from the longer lines.

## 8. Baseball

- **Line score (first pass):** innings 1–9, R H E, then the inning, count, outs, pitch count and bases on the bottom row. The innings are in the linescore the server already fetches; the pitch count isn't.
- The classic, logo and band layouts and the other game states aren't planned yet.

## 9. Knob chooser (open: five bars)

The interaction stays as at 64 (twist = category, press = next variant, hold and turn = step variants, rest 1 s commits; the chosen view fills the panel while choosing). What changes is the bar, which has room to name things. Five mocked (`dial-*.png`, Weather chosen on 7-DAY):

1. **Icons in place, chosen one named:** the 64 bar on rows 21–31, every icon where it is, the chosen one adding its name in its color, the variant name, and one pip per variant under the variant name.
2. **Wheel:** the chosen category fixed at the center, named; neighbors' icons either side, fading with distance and wrapping. Twisting slides the strip under the center.
3. **Variant strip:** the chosen category's icon, then all its variants as words (chosen white, the rest dim): it shows what a press will do. The ring position as five dots at the right edge. Clock's six faces need short names to fit (`SKY 70S ANALOG MAP GRAD WORDS`).
4. **Chip, no bar:** a black chip at the bottom center with the name and variant, one dot per category under it. Most of the view stays visible (the same idea as the radar's chips).
5. **Two rows:** every category's icon spread across the width, the chosen one underlined, and the chosen category's variants as words under them. The bar takes rows 17–31.

In 1–3 and 5 the bar hides the bottom of the view (here the forecast's temperatures), as at 64.

---

## 10. Open questions

- Busy-station layout: confirm the fitting order in §3, or pick one layout.
- Skyline: panorama or big clock; building art.
- Direction labels for the split at Loop and branch stations.
- Knob chooser: pick a bar in §9.
- Baseball beyond the line score.

## 11. What the software would need (not started)

- **The board's width.** A per-board `cols` setting (64 or 128) in the S3's flash, sent with each `/board/update`; the server stores it per board. Payloads stay additive: a 64 board gets exactly what it gets today.
- **Server layouts by width.** `arrivals.js` (rows, fitting, the busy-station chain), weather slots (7 days, 8 hours), radar crop width and masks, sun times, alert labels and expiries: chosen per board width.
- **`draw.js` and `draw.cpp`.** Replace the hard-coded 64s with the frame width, one screen at a time; new layouts behind the width. Parity scenarios at both widths (`firmware/tests/scenarios.js`).
- **Assets.** Fonts unchanged; new glyphs (live and scheduled icons, half sun, a 3 px W) and the 80 × 32 world map, generated as now.
- **Simulator and control page** previews at 128.
- **Firmware.** Chain length from the `cols` setting; radar frame buffers sized for the chosen radar layout (up to 128 × 32, 4 KB a frame).
