# CTA LED Board: Design Spec

Adafruit Matrix Portal driving a 64x32 HUB75 RGB matrix. Decisions from the design sessions of Oct 2–3, 2026. All mocks used made-up train times unless noted.

---

## 1. Hardware

| Item | Notes |
|---|---|
| Panel | 64x32, 4mm pitch, HUB75. Black acrylic diffuser recommended. |
| Controller | **Decided: Matrix Portal M4** (starter kit, purchased Oct 3, 2026; includes panel, diffuser, 5V 2.4A supply). 192 KB RAM, WiFi via ESP32 co-processor over SPI: keep JSON payloads small, use PCF fonts, fetch only between animations. |
| Input | **Phone/web control** (primary, see §9) plus built-in UP/DOWN buttons to switch screens. No extra hardware. |
| Power | Kit supply is 5V 2.4A; panel can draw ~4A all-white. See §8. |

---

## 2. Architecture

- **The existing fly.dev server (from the CTA map project) does all fetching and formatting.** The board only draws what it receives.
- The server chooses the layout (row count, alerts) and sends compact JSON plus small indexed images (radar frames, ~2 KB each).
- Optional shared token on board endpoints (`BOARD_TOKEN` Fly secret) to keep randoms off the CTA quota.

### Minimal animation
Animation is deliberately limited so the board's network pauses (CircuitPython is single-threaded, and each HTTPS request through the M4's WiFi co-processor blocks the display for roughly a second or more) are invisible. The only animations are:
- **Per-digit roll** when an arrival time changes.
- **Alert blink** on affected rows' color blocks (transit screen).
- **Ticker page slide.**
- **Radar loop.**

No blinking colons, no scrolling text, and no alert text screens anywhere. Alerts are shown only as indicators (see §5, §6, §7).

### Scheduler (board main loop)
A small cooperative scheduler lines up network requests with animation gaps:
- **Animation timeline:** the board tracks when its next animation will start: next digit roll (computed from arrival timestamps), next ticker slide, radar frame steps, and screen switches.
- **Network jobs:** each job (version check, combined update, radar frame) has a **due time** and a **deadline**.
- **Each loop pass:** if a job is due and the next animation is at least the **fetch budget** away, run it now; otherwise wait for the next gap.
- **Deadline override:** if a job passes its deadline (e.g. data older than ~60 s), run it anyway. A brief freeze beats stale times.
- **Non-blocking animations:** the transit alert blink doesn't count as busy; a request landing mid-blink just holds the block in one state.
- **Natural gaps:** radar last-frame hold, ticker page holds, screen switches, and the stretch between minute rollovers on the transit screen.
- **Fetch budget:** start at ~2 s; replace with the measured request time on the real board.

### Fetch cadence

**Board → server**

| Request | How often | Size |
|---|---|---|
| Settings version check (`/board/version`) | ~every 10 s | a few bytes |
| Combined update (arrivals as absolute times, alert flags, weather row, settings version) | ~every 30 s, or right away when the version changes | ~1 KB |
| Radar frame (only while radar is showing) | one new frame every 5 min | ~2 KB |

- The board **counts down locally** from the arrival timestamps, so minutes tick over on time between fetches; fetches only refresh predictions.

**Server → sources** (cached; the board never waits on CTA)

| Source | How often |
|---|---|
| Train Tracker | every 30 s, only while a board is polling |
| CTA alerts | every 2–5 min |
| NWS warnings/watches | every 1–2 min |
| Weather | every 10–15 min |
| MRMS radar | every 5 min |

~2,900 Train Tracker calls/day per station at 30 s, well under CTA's daily limit; multiple boards share the cache.

### Data sources

| Data | Source | Notes |
|---|---|---|
| Train arrivals | CTA Train Tracker API ([docs](https://www.transitchicago.com/developers/ttdocs/)) | Uses `mapid` (one call covers all lines and directions); `destNm`, `rn` (run number), `isApp` (Due), `arrT`. `isDly` intentionally **not** shown. `isSch` (schedule-based) and `isFlt` (possible fault) handling is open. |
| CTA service alerts | CTA Customer Alerts API | Service-affecting only (no elevator outages); lines on screen only. Used **only to flag affected lines** (no alert text shown). |
| Weather warnings/watches | NWS alerts for the configured point | Only severe thunderstorm and tornado warnings/watches. Shown as icons/tags only (no alert text). |
| Radar | NOAA **MRMS** lowest composite reflectivity (`lcref`) via Iowa Environmental Mesonet | Palette-indexed PNG + `.wld`, 2-min updates, archive available. dBZ ≈ index × 0.5 − 32.5 (**verify**). Do **not** use the raw NEXRAD composite: it shows bird/insect returns on clear nights. |
| Weather | Open-Meteo (no key) | Current temp, weather code, `is_day`, daily high/low, sunrise/sunset. |

---

## 3. Fonts and glyphs

One custom **board font** (BDF), built from bitmap fonts in `hzeller/rpi-rgb-led-matrix/fonts`:

- **Tom Thumb** (3x5): the default small text everywhere. **All Tom Thumb text is uppercase** (row labels, headers, weather words, status text). Only the ticker's 5x7 destinations use mixed case.
- **X11 5x7**: CTA-style ticker destinations and the radar clock.
- Both made **proportional** (advance = ink width + 1px). CircuitPython honors per-glyph widths.
- Patched glyphs: **W** and **w** widened to 5px (the stock 4px versions read as H/u). 5x7 **t** narrowed to 3px (bottom hook tucked under the crossbar).
- **`tt` ligature** (5x7, 6px): two narrow t's sharing one crossbar, at a private-use codepoint. The server substitutes it for "tt" in ticker destinations. `Cottage` is 31px with it, leaving a 4px gap before a two-digit time.
- Custom glyphs at private-use codepoints:
  - `min`: one 11px glyph with a 5-wide m.
  - Inline **bolt** (3x5) and **funnel** (4x5): used in the weather row tag **and** next to AM/PM on the radar.
  - **Alert circle** (5x5): red circle with a white "!" for the ticker index column.
- **Digits are tabular** in every font (one shared cell width), so a rolling digit never shifts its neighbors. Spaces are 2px (small) and 3px (5x7).
- The **alert circle** is two glyphs drawn at the same origin: a red disc with the "!" pixels left blank, and a white "!". Fonts are one color per glyph.
- Codepoints for custom glyphs are in `server/board/glyphs.js`. The fonts are built by `scripts/build-fonts.js` into `server/board/fonts/` (BDF); the board build converts them to PCF.
- X11 **9x15 Bold** for the large overnight clock, with a custom **2x2 square-dot colon** centered on the 10px digit height (the stock X11 colon is drawn for text and drops a pixel below the digits).

---

## 4. Colors and brightness

| Use | Color |
|---|---|
| Labels | white `#d8d8d8` |
| **Clocks (all screens)** | 80% white `#cccccc` |
| First arrival time | amber `#ffb000` |
| Later times | dim amber `#9c6a00` |
| Schedule-based times (`isSch`), first / later | grey `#b0b0b0` / `#6e6e6e` (instead of amber; same width, so digit rolls are unaffected) |
| Secondary text (station name, high/low) | grey `#8f8f8f` |
| Dividers | `#333333` |
| Shoreline | `#34485e` |
| Ticker alert circle | red `#ff2020` with white `#ffffff` "!" |

- **Global brightness:** 100% sunrise to sunset, ~40% overnight (times from Open-Meteo). Every dim element has a **minimum floor** so it never drops to black at night.
- **Radar rain fills** render at ~65%; **ticker row fills** at 55%. Text stays full brightness.
- Rule of thumb from the session: **lit strokes on dark survive; dark strokes on lit don't** (diffuser glow fills them in).
- **Clock colons are steady** on every clock. Every clock (transit header, overnight, ticker header, radar) uses the same `#cccccc`.

---

## 5. Screen 1: Transit station

### Rows
- 3px line-color block, Tom Thumb label (uppercase), **3 times**, right-aligned as a group, not in columns (amber first, dim the rest).
- **Schedule-based predictions** (`isSch`, e.g. southbound trains at Morse that haven't left the Howard terminal) are shown, with the time in grey instead of amber. `isFlt` (possible fault) predictions are shown normally.
- **Trains ending at this station** (`destNm` = the station, e.g. Terminal Arrival at Howard) are not shown.
- **Per-digit roll** when a number changes (12→11 rolls only the 2). Whole cells roll when the list shifts (the first train leaves) or to and from `DUE`.

### Layout
- **Header station names** must fit 42px (the space left by the widest clock). Shortening order: full name; then drop ordinal suffixes (`95/DAN RYAN`, `35/ARCHER`); then a curated short name (`HW LIBRARY`, `MERCH MART`, `CLARK/DIV`); list in `server/board/station-names.js`, editable per board from the phone.
- **Header** (station grey + clock `#cccccc`, with a `#333333` divider below it, except when 4 rows leave no room) and **weather row** (below a `#333333` divider) are **each optional**, set per board in config, independent of row count.
- Rows fill the remaining space, centered and evenly spaced (5px rows, gaps of 1px or more).
- **Rows that don't fit are dropped** (the last rows in config order). Accepted trade-off.
- **v1 rule:** stations that need more rows than a bar combination allows simply don't enable those bars. Row order isn't a concern.
- Scrolling or paging for more than 5 rows (some Loop stations need up to 7) is **out of scope for v1**.

**Geometry (from the mocks):**
- Header text on rows 1–5. With 1–3 train rows: divider on row 7, train rows start at row 10 or lower. With 4 rows: no divider, rows start at row 7.
- Weather divider on row 22; weather icon on rows 24–31; train rows end by row 20.
- Row pitch (row top to row top): 2 rows 7px; 3 rows 10px (8px with header: rows at 10, 18, 26); 4 rows 8px (6px with header: rows at 7, 13, 19, 25); 5 rows 6px. Otherwise rows are centered in whatever space is left.

| Header | Weather row | Max rows |
|---|---|---|
| off | off | 5 |
| on | off | 4 |
| off | on | 3 |
| on | on | 2 |

### Weather row (optional)
- 8x8 condition icon, temperature with a small 2x2 degree sign (e.g. `54°`), condition word (uppercase) on the right.
- Icons are multi-color sprites defined in `server/board/icons.js` (with the Open-Meteo weather-code mapping); previews in `docs/board/previews/sheet-icons.png`.
- Icons: sun, moon, partly cloudy (day/night), cloudy, **umbrella** (rain/drizzle/showers), **icy umbrella** (freezing rain), **snowflake**, storm cloud with bolt, fog.
- **Watch/warning tag** replaces the condition word: `[bolt]` or `[funnel]` + `WATCH` (yellow) / `WARNING` (orange for severe, red for tornado), with a **3px gap** between icon and word (1px read as `SWATCH`; 2px still looked tight). Static, no scrolling.

### CTA alerts
- Affected rows' color blocks **blink to a 1px "!"** in the line color (middle column of the 3x5 block: 3px stem, 1px gap, 1px dot; `ALERT_BANG` in `server/board/icons.js`). That's the whole indicator; no alert text is shown (details are on the phone).
- CTA alerts are per line, so **every row of the affected line blinks, both directions**. Blinking only one direction would need parsing the alert text; not planned for v1.

### Destination labels
Server-side short-name map so labels fit (~6–7 characters next to a two-digit time). Shared by the transit screen (rendered uppercase) and the ticker (mixed case).

| CTA destination | Shown |
|---|---|
| Forest Park | `Forest` |
| 54th/Cermak | `54th` |
| 95th/Dan Ryan | `95th` |
| Ashland/63rd | `63rd` |
| Harlem/Lake | `Harlem` |
| Dempster-Skokie | `Skokie` |
| UIC-Halsted (Blue Line short turn) | `UIC` |
| Jefferson Park (Blue Line short turn) | `Jeff Pk` |
| Cottage Grove | `Cottage` (borderline; check on panel) |

- Green Line eastbound at Ashland: separate `63RD` and `COTTAGE` rows.
- Same destination on two lines (e.g. Brown and Purple `LOOP` at Merchandise Mart): two rows told apart by the color block only. Accepted.
- **Short-turn trains** (e.g. Blue Line to UIC-Halsted or Jefferson Park) get **their own row**. The layout follows the row count as these come and go.
- **Unknown destinations** (disruptions, reroutes): own row, name truncated to fit; the server logs them so they can be added to the map.
- Large Loop stations, and Belmont/Howard at rush (6 destinations): **per-board destination filter** in config.

### Other states
- **Overnight / no predictions:** large **9x15 Bold** clock (`#cccccc`) with the 2x2 square colon, dim `NO TRAINS` label below it, weather row below the divider. Follows the board's weather-row setting; with the weather row off, the clock and `NO TRAINS` are centered vertically.

---

## 6. Screen 2: CTA-style ticker (easter egg)

- **Header:** station in light grey `#a6a6a6`, clock `#cccccc`, no background.
- **Two 12px rows** with a 1px gap; dark slate index column `#1f2f35`, **5px wide**, numbered 1–6 in Tom Thumb. The row fill starts right after it (no gap); the destination starts 2px into the fill. Minutes are right-aligned to column 62, with a 2px gap between the digits and `min`.
- Row fill = line color at 55%; **white** destination (X11 5x7 proportional, mixed case) + minutes (5x7 digits + `min` glyph); `Due` at ≤1 min. Yellow rows also use white text.
- Destinations use the short-name map, so short-turns appear as `UIC` and `Jeff Pk`.
- **Schedule-based arrivals:** the **index number is replaced by a 5x5 clock** (glyph to be chosen). If an arrival is both scheduled and on an alerted line, the alert circle wins.
- **CTA alerts:** on arrivals whose line has an active alert, the **index number is replaced by the 5x5 red alert circle** (white "!"), which fills the 5px column exactly. It sits on the dark index column, so it never collides with the destination or time. Static, no blinking.
- Pages of 2 hold ~3.5s, then **slide up** (~0.5s ease) through the next **6 individual arrivals**, looping. Network requests happen during the holds.

---

## 7. Screen 3: Radar

- **Appears only when rain is in the box** (count of colored pixels, with separate on/off thresholds so it doesn't flicker in and out).
- **Configurable location**; crop centered on it (~1.5 mi/pixel).
- **Pipeline (server):** crop → palette index to dBZ → average linear reflectivity per LED block → levels (15/25/35/45/55 dBZ: dim green, green, yellow, orange, red) → despeckle (drop pixels with <2 colored neighbors) → small indexed image.
- **Snow (v1):** the whole frame switches to a 3-level snow palette (light blue, pale blue, white) when Open-Meteo reports a snow weather code, or ≤ 32°F without freezing rain. Snow gets its own thresholds (provisional 10/20/30 dBZ) because dry snow reflects much less than rain. A rain/snow line inside the box, and mixed precip, render as one type. Details in `contract.md`.
- **Loop:** 6 frames (30 min), **holds on the last frame**. Network requests (including the next radar frame) happen during the hold.
- **Water masked black** (mask generated per location from coastline data); faint shoreline only where there's no rain.
- **Location marker:** white dot with 4 unlit pixels around it.
- **Clock:** X11 5x7 (`#cccccc`), right-aligned in empty water, steady colon (frame timestamp). **Frame indicator above it** (2px-tall segments, current frame amber), AM/PM in Tom Thumb below. If the location has no usable water area, fall back to **split layout** (radar left, clock right).
- **Warnings:** the small inline **bolt** (3x5, orange, severe) or **funnel** (4x5, red, tornado) sits **to the left of AM/PM** with a 2px gap, on the same 5px line. It never overlaps the clock or the frame indicator; the clock stack (indicator + clock + AM/PM line) occupies ~rows 2–18, which is the height the water-area check must reserve. Steady, no blinking. No polygons, no scrolling text.

---

## 8. Power

| Screen | Rough draw |
|---|---|
| Transit board | ~0.3–0.6 A |
| Radar, widespread rain | ~0.5–1 A (lower with 65% fills) |
| Ticker | ~1 A with 55% fills (was ~2+ A at full brightness) |

- Underpowering symptoms: flicker, colors shifting red, resets, WiFi drops.
- **Laptop USB is the trap:** develop with dim test colors or use the 2.4A supply.
- For a brighter build later: power the panel from a separate 5V 4A supply per Adafruit's wiring guidance.

---

## 9. Phone/web control

A small page on the fly.dev server, saved to the phone home screen. The server holds the board's state; the board reads it and draws what it's told.

### Controls
- **Screen:** Auto (normal rules), Transit, Ticker, Radar.
- **Brightness:** Auto (sunrise/sunset), fixed level, or Off.
- **Station and destination filter:** per-board config, editable instead of hardcoded. Default station: Morse. The station's coordinates are also the board's location for weather, NWS alerts, and radar.
- **Transit header and weather row:** independent on/off toggles per board (see §5 for how many rows each combination fits).

### Behavior
- **Latency:** the board checks `/board/version` about every 10 s (scheduled in animation gaps, see §2) and fetches the full update right away when the version changes. Phone changes show up within ~10–15 s.
- **Overrides stick** until changed or until the board restarts. On boot the board sends a boot flag on its first request; the server resets screen and brightness to Auto and bumps the version. Station and filter config persist across restarts.
- **Persistence:** state lives in a small JSON file on a Fly volume, so deploys and server restarts don't wipe config.
- **Buttons vs. phone: last action wins.** A button press sets a local override and records the current server version. The local override holds until the server version changes (a phone change), then the board follows the server again.
- Possible optimization to test on the board: keep the HTTPS connection open between requests to avoid repeating the TLS handshake, which would make version checks nearly free.

### Access
- **Secret URL, no login.** The control page lives at an unguessable path (e.g. `/board/<random>`), with the path stored as a Fly secret (`BOARD_CONTROL_PATH`). Anyone with the link has control; acceptable for a hobby board. Rotate the secret if the link leaks.

---

## 10. Connectivity

- WiFi is set in `settings.toml` on the CIRCUITPY drive over USB (cannot be changed from the phone page, since the board needs WiFi to reach the server).
- **Network list:** home, work (visitor), and **phone hotspot** in `settings.toml`; the board tries each in order and moves on if a network is missing or portal-blocked. The hotspot is the last-resort fallback anywhere (data use is small: ~1 KB per 30 s plus radar frames).
- **Portal detection:** after connecting, the board requests `/board/ping`, which returns `{"ok":1}`. Anything else (HTML, redirect) means a captive portal.
- **Status screens** instead of silent failure: `WIFI OK`, `PORTAL` (with the board's MAC address shown, for IT), `NO WIFI`.
- **Work visitor WiFi:** assume a captive portal until verified. Fixes in order: phone hotspot (works immediately), ask IT to whitelist the MAC, use a portal-free network if one exists, or use a travel router that clears the portal and rebroadcasts WPA2.
- **Bluetooth:** considered and declined. The ESP32 can't run WiFi and BLE at once, and using the phone as the data source would need a native app and stall whenever iOS suspends it.

---

## 11. Open questions

- Verify the MRMS dBZ offset before setting thresholds.
- On-panel checks: yellow rows, `Cottage` width, dimming factors, dim-color floors, Tom Thumb `M`/`N` legibility (3px wide; may need widening like `W`), 3x5 bolt legibility.
- Whether the work visitor WiFi has a captive portal (check with a phone).
- Measure the real fetch time on the board to set the scheduler's fetch budget.

## 12. Parked ideas

**Bus screen** (cut from v1: needs a separate Bus Tracker API key; was 96/155 at Morse with grey `#8a8a8a` row blocks, westbound only since both start at Morse) · separate board location independent of the station · Combined radar + conditions screen · full-screen conditions layouts · Cubs/Sox scores (16x16 logos from a sprite sheet, personal use) · trains + buses on one screen · leave-by line · Divvy · Metra row · approach track · custom clock digit styles (Chunky, Outline) · chronological lists · timeline strips · merging short-turns into their direction's row with a marker · tap-to-switch via onboard accelerometer · I2C rotary encoder · ambient light sensor · big-number bus layout (route number left, name + times right; tried and declined in favor of the standard rows) · first-train time under the overnight clock (needs CTA GTFS schedule) · CTA alert headline scroll (cut to minimize animation) · full-screen CTA alert text screen (cut; indicators only) · CTA-style alert circle after the destination name on the ticker (declined: collides with long names and two-digit times) · blinking/alternating clock colon (cut to minimize animation) · transit row scrolling/paging for 6–7 destination stations (post-v1) · Bluetooth WiFi provisioning from the phone · per-pixel rain/snow from MRMS `PrecipFlag` (GRIB2; replaces the v1 temperature heuristic if the decoder fits in memory).
