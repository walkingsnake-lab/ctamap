# CTA LED Board: Design Spec

Adafruit Matrix Portal driving a 64x32 HUB75 RGB matrix. Decisions from the design sessions of Oct 2–4, 2026. All mocks used made-up train times unless noted.

---

## 1. Hardware

| Item | Notes |
|---|---|
| Panel | 64x32, 4mm pitch, HUB75. Black acrylic diffuser recommended. |
| Controller | **Decided: Matrix Portal M4** (starter kit, purchased Oct 3, 2026; includes panel, diffuser, 5V 2.4A supply). 192 KB RAM, WiFi via ESP32 co-processor over SPI: keep JSON payloads small, use PCF fonts, fetch only between animations. |
| Input | **Phone/web control** (primary, see §10) plus built-in UP/DOWN buttons to switch screens. No extra hardware. |
| Power | Kit supply is 5V 2.4A; panel can draw ~4A all-white. See §9. |

---

## 2. Architecture

- **The existing fly.dev server (from the CTA map project) does all fetching and formatting.** The board only draws what it receives.
- The server chooses the layout (row count, alerts, destination rows vs. chronological transit view) and sends compact JSON plus small indexed images (radar frames, ~2 KB each).
- Optional shared token on board endpoints (`BOARD_TOKEN` Fly secret) to keep randoms off the CTA quota.

### Minimal animation
Animation is deliberately limited so the board's network pauses (CircuitPython is single-threaded, and each HTTPS request through the M4's WiFi co-processor blocks the display for roughly a second or more) are invisible. The only animations are:
- **Per-digit roll** when an arrival time changes.
- **Transit transitions:** a departing train fades out in place, the next time eases to amber, and rows fade in/out and slide (all under 1.2 s, at the same moments as digit rolls).
- **Alert blink** on affected rows' color blocks (transit screen): 1 s on, 1 s off.
- **Ticker page slide.**
- **Radar loop.**

No blinking colons, no scrolling text, and no alert text screens anywhere. Alerts are shown only as indicators (see §5, §6, §7).

### Scheduler (board main loop)
A small cooperative scheduler lines up network requests with animation gaps:
- **Animation timeline:** the board tracks when its next animation will start: next digit roll (computed from arrival timestamps), next list slide (chronological view), next ticker slide, radar frame steps, and screen switches.
- **Network jobs:** each job (version check, combined update, radar frame) has a **due time** and a **deadline**.
- **Each loop pass:** if a job is due and the next animation is at least the **fetch budget** away, run it now; otherwise wait for the next gap.
- **Deadline override:** if a job passes its deadline (e.g. data older than ~60 s), run it anyway. A brief freeze beats stale times.
- **Alert blink:** the blink doesn't count as busy, but a fetch freezes it. While a row blinks, non-overdue fetches wait for the blink to turn on, show the lit frame, and the blink restarts (off) when the fetch ends, so the freeze reads as one slightly long "on" phase instead of a glitch.
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
| CTA service alerts | CTA Customer Alerts API | **Major alerts only** (CTA severity `major`): no minor delays, planned work, schedule changes, long-term closures, or elevator outages; lines on screen only. Used **only to flag affected lines** (no alert text shown). |
| Weather warnings/watches | NWS alerts for the configured point | Only severe thunderstorm and tornado warnings/watches. Shown as icons/tags only (no alert text). |
| Radar | NOAA **MRMS** lowest composite reflectivity (`lcref`) via Iowa Environmental Mesonet | Palette-indexed PNG + `.wld`, 2-min updates, archive available. dBZ = index × 0.5 − 32 (verified against IEM's lookup table). Full CONUS frames (7000 × 3500); decoded as a stream, only the rows around the station. Do **not** use the raw NEXRAD composite: it shows bird/insect returns on clear nights. |
| Weather | Open-Meteo (no key) | Current temp, weather code, `is_day`, daily high/low, sunrise/sunset. |

---

## 3. Fonts and glyphs

One custom **board font** (BDF), built from bitmap fonts in `hzeller/rpi-rgb-led-matrix/fonts`:

- **Tom Thumb** (3x5): the default small text everywhere. **All Tom Thumb text is uppercase** (row labels, headers, weather words, status text), except the lowercase `m` minutes suffix in the chronological transit view (patched to 5px wide with a 3-row x-height, bottom-aligned with the digits; the stock 3px `m` reads as a blob). Only the ticker's 5x7 destinations use mixed case.
- **X11 5x7**: CTA-style ticker destinations and the radar time.
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
| Dividers (weather row) | `#333333` |
| Transit header background band | `#202020` (confirm on the panel; raise toward `#303030` if it vanishes at night) |
| Shoreline | `#34485e` |
| Ticker alert circle | red `#ff2020` with white `#ffffff` "!" |

- **Global brightness:** 100% sunrise to sunset, ~40% overnight (times from Open-Meteo). Every dim element has a **minimum floor** so it never drops to black at night.
- **Radar rain fills** render at ~65%; **ticker row fills** at 55%. Text stays full brightness.
- Rule of thumb from the session: **lit strokes on dark survive; dark strokes on lit don't** (diffuser glow fills them in).
- **Clock colons are steady** on every clock. Every clock (transit header, overnight, ticker header) uses the same `#cccccc`; the radar's frame time is dimmed (`#7a7a7a`, AM/PM `#555555`) so it doesn't read as the current time.

---

## 5. Screen 1: Transit station

### Rows
- 3px line-color block, Tom Thumb label (uppercase), **3 times**, right-aligned as a group, not in columns (amber first, dim the rest). Times are 3px apart, tightening to 2px when the row is full, so long names like `KIMBALL` and `COTTAGE` always fit.
- **Schedule-based predictions** (`isSch`, e.g. southbound trains at Morse that haven't left the Howard terminal) are shown, with the time in grey instead of amber. `isFlt` (possible fault) predictions are shown normally.
- **Trains ending at this station** are not shown (Terminal Arrival at Howard; "63rd Street" trains at Ashland/63rd, which only shows Harlem trains).
- **Minutes round up**, like CTA's own predictions: `DUE` within 60 s (when CTA flags the train as approaching), then 2, 3, …; never 1.
- **One DUE per destination:** only the soonest train of a destination (same line and direction) can read `DUE` (rows, chronological view, and ticker alike). When trains are bunched and a later one is also within 60 s, it shows `2` (`2m`) instead, so two DUEs never sit side by side.
- **Per-digit roll** when a number changes (12→11 rolls only the 2), and whole-cell rolls to and from `DUE`.
- **Departures fade, not roll:** when the first train leaves, its cell fades out in place (0.7 s), then (not during the fade) the remaining times slide left (0.5 s), a newly joined time at the end fades in after that slide, and the new first time eases from dim to amber (0.7 s). A row losing its last train fades out, then the rows below slide up; new rows and times fade in. Arrivals are matched across updates by time (within 90 s), so refreshed predictions don't flicker. Reference: `createTransitAnimator()` in `server/board/draw.js`.

### Layout
- **Header station names** must fit 42px (the space left by the widest clock). Shortening order: full name; then drop ordinal suffixes (`95/DAN RYAN`, `35/ARCHER`); then a curated short name (`HW LIBRARY`, `MERCH MART`, `CLARK/DIV`); list in `server/board/station-names.js`, editable per board from the phone.
- **Header** (station grey + clock `#cccccc` on a faint full-width background band, no divider line) and **weather row** (below a `#333333` divider) are **each optional**, set per board in config, independent of row count.
- Rows fill the remaining space (5px rows, gaps of 1px or more).
- **Without the header, rows are spread evenly** from the top of the panel to the weather divider (or the bottom edge): equal gaps above, between, and below. The between-row gap is the ideal gap rounded to the nearest pixel; the leftover is split top and bottom, any odd pixel going to the bottom.
- **Fitting:** the header and weather toggles are the most the board shows. When more destinations are running than fit, the **weather row is hidden first, then the header**, so up to 5 destinations stay as rows. **Past 5, the board switches to the chronological view** (below) with the header (if on) and **no weather row**. Re-checked on every update, so it adapts as service changes through the day (e.g. Merchandise Mart with rush-only Purple). The ticker always shows its header, even with the header toggle off (hiding it frees no space the ticker uses). Row order isn't a concern.
- Scrolling or paging for more than 5 rows (some Loop stations need up to 7) is **out of scope for v1**; the chronological view covers those stations.

**Geometry (from the mocks):**
- Header band on rows 0–6, text on rows 1–5. Train rows start at row 9 or lower (at least 2px clear of the band).
- Weather divider on row 22; weather icon on rows 24–31; train rows end by row 20.
- **With header** (row pitch, row top to row top): 2 rows 8px (10px with no weather row: rows at 13 and 23); 3 rows 8px (rows at 10, 18, 26); 4 rows 6px (rows at 9, 15, 21, 27, using the full height). Otherwise rows are centered in whatever space is left.
- **Without header** (even spacing over rows 0–31, or rows 0–21 with the weather row on):

| Weather row | Rows | Row tops | Gaps (top / between / bottom) |
|---|---|---|---|
| off | 2 | 7, 19 | 7 / 7 / 8 |
| off | 3 | 4, 13, 22 | 4 / 4 / 5 |
| off | 4 | 1, 9, 17, 25 | 1 / 3 / 2 (pinned: 3px between rows reads better than the rounded 2px) |
| off | 5 | 1, 7, 13, 19, 25 | 1 / 1 / 2 |
| on | 2 | 4, 13 | 4 / 4 / 4 |
| on | 3 | 1, 8, 15 | 1 / 2 / 2 |


| Header | Weather row | Max rows |
|---|---|---|
| off | off | 5 |
| on | off | 4 |
| off | on | 3 |
| on | on | 2 |

### Chronological view (overflow)
- **When:** the destination count (after the per-board destination filter) exceeds the board's max rows. The server decides on each update and sends `view` in the combined update.
- **Switching is immediate both ways:** chronological as soon as destinations exceed max rows, back as soon as they fit. If short-turns make it flip too often, raise `CHRONO_HOLD` in `arrivals.js` (a hold time before switching back; the mechanism is built, set to 0).
- **Rows:** same anatomy as destination rows: 3px line-color block, Tom Thumb label (uppercase), **one time** right-aligned. Each row is one train, soonest first. First row's time amber (grey if schedule-based), the rest dim.
- **Time format:** digits + lowercase `m` with the font's own **1px gap** (`4m`, `12m`); `DUE` stays bare. Labels are fitted against the widest time (`99m`), so they have up to 43px.
- **Line ID: a line-colored position digit** (1–5, Tom Thumb, in the 3px block's place) instead of the color block, like the ticker's index column. Brown (`#a8673f`) and Purple (`#9168e0`) digits are brightened because the official colors read too dark as 1px strokes; everything else uses the line color. When a train departs, each digit rolls down (2→1) as the list slides up. Alerts blink the digit to the same `!`. No run numbers. (Also tried: inverted digits on 3px and 5px blocks, white digits on 5px blocks at full and 55% color.)
- Same row counts and geometry as destination rows; the header follows its setting; the weather row is always off (4 rows with the header, 5 without). The server sends 2 extra trains below the cap so the board can bring the next one in between updates.
- **Departure:** the first row slides up under the header while fading, the list slides up one row pitch with it (0.5 s ease), the next train turns amber, and a new train slides in at the bottom. Per-digit roll still applies within a row (`12m`→`11m` rolls only the 2).
- **Trains swapping order** between updates: rows are keyed by run number, so the two rows just slide past each other.
- **Switching views** cross-fades: the old rows fade out, then the new ones fade in.
- **CTA alerts:** same block blink as destination rows.
- **Accepted trade-off:** infrequent lines can drop off the screen when frequent ones fill all rows.

### Weather row (optional)
- 8x8 condition icon, temperature with a small 2x2 degree sign (e.g. `54°`), condition word (uppercase) on the right. Both texts are dimmed (`#555555`, same as the radar's AM/PM) so the row reads as secondary; the watch/warning tag keeps its colors.
- Icons are multi-color sprites defined in `server/board/icons.js` (with the Open-Meteo weather-code mapping); previews in `docs/board/previews/sheet-icons.png`.
- Icons: sun, moon, partly cloudy (day/night), cloudy, **umbrella** (rain/drizzle/showers), **icy umbrella** (freezing rain), **snowflake**, storm cloud with bolt, fog.
- **Watch/warning tag** replaces the condition word: `[bolt]` or `[funnel]` + `WATCH` (yellow) / `WARNING` (orange for severe, red for tornado), with a **3px gap** between icon and word (1px read as `SWATCH`; 2px still looked tight). Static, no scrolling.

### CTA alerts
- **Which alerts:** major alerts only (CTA severity `major`, or flagged MajorAlert). A sample on Oct 4 had 7 active alerts (a 2029 station closure across 5 lines, a schedule change, a station bypass, elevators, and an Orange/Green minor delay) and none of them blink.
- Affected rows' color blocks **blink to a 1px "!"** in the line color (middle column of the 3x5 block: 3px stem, 1px gap, 1px dot; `ALERT_BANG` in `server/board/icons.js`). That's the whole indicator; no alert text is shown (details are on the phone).
- CTA alerts are per line, so **every row of the affected line blinks, both directions**. Blinking only one direction would need parsing the alert text; not planned for v1.

### Destination labels
Server-side short-name map so labels fit (~6–7 characters next to a two-digit time). Shared by the transit screen (rendered uppercase) and the ticker (mixed case).

| CTA destination | Shown |
|---|---|
| Forest Park | `Forest` |
| 54th/Cermak | `54th` |
| 95th/Dan Ryan | `95th` |
| Ashland/63rd, 63rd Street (what Train Tracker sends) | `63rd` |
| Harlem/Lake | `Harlem` |
| Dempster-Skokie | `Skokie` |
| UIC-Halsted (Blue Line short turn) | `UIC` |
| Jefferson Park (Blue Line short turn) | `Jeff Pk` |
| Cottage Grove | `Cottage` (borderline; check on panel) |

- Green Line eastbound at Ashland: separate `63RD` and `COTTAGE` rows.
- Same destination on two lines (e.g. Brown and Purple `LOOP` at Merchandise Mart): two rows told apart by the color block only. Accepted.
- **Short-turn trains** (e.g. Blue Line to UIC-Halsted or Jefferson Park) get **their own row**. The layout follows the row count as these come and go.
- **Unknown destinations** (disruptions, reroutes): own row, name truncated to fit; the server logs them so they can be added to the map.
- **No per-station default layout.** The layout follows the live destination count. Examples: Merchandise Mart shows 2 destinations off-peak (Brown) with the header and weather row; rush-only Purple adds `LINDEN` and `LOOP`, the weather row hides to fit 4 rows, and it returns when Purple stops. Belmont off-peak has 4 (Red and Brown, weather row hidden); at rush, Purple makes 6 and it switches to the chronological view. The **per-board destination filter** avoids those changes if unwanted; it's applied first, and the fit runs on the filtered list.

### Other states
- **Overnight / no predictions:** large **9x15 Bold** clock (`#cccccc`) with the 2x2 square colon, dim `NO TRAINS` label below it, weather row below the divider. Follows the board's weather-row setting; with the weather row off, the clock and `NO TRAINS` are centered vertically.

---

## 6. Screen 2: CTA-style ticker (easter egg)

- **Header:** station in light grey `#a6a6a6`, clock `#cccccc`, no background.
- **Two 12px rows** with a 1px gap; dark slate index column `#1f2f35`, **5px wide**, numbered 1–6 in Tom Thumb. The row fill starts right after it (no gap); the destination starts 2px into the fill. Minutes are right-aligned to column 62, with a 2px gap between the digits and `min`.
- Row fill = line color at 55%; **white** destination (X11 5x7 proportional, mixed case) + minutes (5x7 digits + `min` glyph); `Due` within 60 s (minutes round up, like CTA; see contract countdown rules). Yellow rows also use white text.
- Destinations use the short-name map, so short-turns appear as `UIC` and `Jeff Pk`.
- **Schedule-based arrivals:** the **index number is replaced by a 5x5 clock** (`CLOCK` glyph: ring with hands up and right), drawn in the index number's color. If an arrival is both scheduled and on an alerted line, the alert circle wins.
- **CTA alerts:** on arrivals whose line has an active alert, the **index number is replaced by the 5x5 red alert circle** (white "!"), which fills the 5px column exactly. It sits on the dark index column, so it never collides with the destination or time. Static, no blinking.
- Pages of 2 hold **8 s**, then **slide up** (**1.2 s** ease) through the next **6 individual arrivals**, looping. Network requests happen during the holds.

---

## 7. Screen 3: Weather (radar while raining)

- **Weather by default, radar when rain is in the box** (count of colored pixels, with separate on/off thresholds so it doesn't flicker in and out). The screen is `weather` (formerly `radar`); the payload's `radar` object, the radar frame endpoint, and the radar visit/time settings keep their names since they're about the radar loop. Timed visits on the auto screen still only happen while it rains, so they always show the radar.
- **Weather layout** (Open-Meteo; exact pixels in `contract.md`, Radar): big temperature in the 9x15 Bold digits with a 3x3 ring degree sign, icon top right with the dim condition word under it, divider on row 18, then `FEELS 53°` + wind (`NW 12`) and `H 63° L 49°` + rain chance (a small blue drop + `20%`, the highest hourly chance over the next 6 hours). A **watch or warning replaces the high/low line** with the glyph and `TSTORM WATCH` / `TSTORM WARNING` / `TORNADO WATCH` / `TORNADO WARN` in the warning colors (tornado warning blinks). Preview: `docs/board/previews/mock-weather-screen.png`.
- **Configurable location**; crop centered on it (~1.5 mi/pixel).
- **Pipeline (server):** crop → palette index to dBZ → average linear reflectivity per LED block → levels (15/25/35/45/55 dBZ: dim green, green, yellow, orange, red) → despeckle (drop pixels with <2 colored neighbors) → small indexed image.
- **Snow (v1):** the whole frame switches to a 3-level snow palette (light blue, pale blue, white) when Open-Meteo reports a snow weather code, or ≤ 32°F without freezing rain. Snow gets its own thresholds (provisional 10/15/20 dBZ, from the Feb 2, 2022 storm) because dry snow reflects much less than rain. A rain/snow line inside the box, and mixed precip, render as one type. Details in `contract.md`.
- **Loop:** 6 frames, 6 min apart (30 min; IEM only archives even minutes), 0.5 s each, **holds on the last frame** for 4 s. Network requests (including the next radar frame) happen during the hold.
- **Water masked black** (mask generated per location from coastline data), with a faint shoreline along its edge.
- **Layout per station** (`server/board/locations/`, built by `scripts/build-locations.js` from Natural Earth's Lake Michigan outline): full width with the time over the lake when the time's area is all water (114 of 144 stations), otherwise the split layout (radar left 39 columns, a gray `#333333` line on the panel's left edge, time right 24). The time stack is **top-aligned** (rows 2–19) in both.
- **No frames yet** (rain in the box but nothing processed, e.g. right after a deploy): the weather layout.
- **Shoreline** is painted on the lake's edge pixels (inside the water), so rain never covers it.
- **Colors** (fills at 65%): rain `#1f8f1f`, `#2ee02e`, `#ffe000`, `#ff8c00`, `#ff1a1a`; snow `#4f86ff`, `#a9c9ff`, `#ffffff`; marker white; frame indicator `#3a3a3a`, current frame amber.
- **Location marker:** white dot; rain or snow in the 4 pixels around it is cleared so it stands out, but the shoreline stays continuous next to it.
- **Time:** X11 5x7 (dimmed `#7a7a7a`, AM/PM `#555555`), right-aligned in empty water, steady colon (frame timestamp). **Frame indicator above it** (2px-tall segments, current frame amber), AM/PM in Tom Thumb below. **The time is optional** (per-board `radarTime`, on by default): off replaces it with **current conditions**, the weather icon and temperature (Tom Thumb, label white `#d8d8d8`) right-aligned under the frame indicator, as on the weather row. The warning tag then moves to the **bottom right of the screen**: icon + `WATCH` or `WARN` on a black backing (WATCH runs past the time box onto the radar; to revisit). 
- **Warning colors (every screen):** watches yellow, severe thunderstorm warnings orange, tornado warnings red and **blinking** (same 1 s blink as CTA alerts) on the weather row and the radar. If the location has no usable water area, fall back to **split layout** (radar left, clock right).
- **Warnings:** the small inline **bolt** (3x5, orange, severe) or **funnel** (4x5, red, tornado) sits **to the left of AM/PM** with a 2px gap, on the same 5px line. It never overlaps the clock or the frame indicator; the clock stack (indicator + clock + AM/PM line) occupies ~rows 2–18, which is the height the water-area check must reserve. Steady, no blinking. No polygons, no scrolling text.

---

## 8. Screen 4: Baseball

### Data
- **Source:** MLB Stats API (`statsapi.mlb.com`, free, no key, unofficial).
- **One request:** `/api/v1/schedule?sportId=1&startDate=<yesterday>&endDate=<today>&hydrate=linescore` (Chicago dates, so a late game survives midnight). The hydrated linescore carries everything the screen draws: runs, inning and half, inning state, balls/strikes/outs, runners (`offense.first/second/third`), and each team's `leagueRecord`. No per-game live feed.
- **Records:** `leagueRecord` is the regular-season W-L during the season and the **postseason** W-L in the postseason (e.g. 1-0 after an ALDS Game 1 win).
- **Teams:** the server keeps a map of MLB team ID → abbreviation (matching `/api/v1/teams` `abbreviation`: `CHC`, `CWS`, `ATH`, `AZ`, …) and block color.
- **Poller:** every 15 s while a qualifying game is live or within its pregame window, every 5 min otherwise. Keeps the last good response on failure.
- **Payload:** the combined update gets `mlb.games` (already filtered, in start order), ~100 bytes per game.

### When it shows (Auto mode)
- **Every Cubs game** (team ID 112, any game type) and **every postseason game** (game types `F`, `D`, `L`, `W`). Postponed and cancelled games are skipped.
- **Window:** pregame from 30 min before first pitch (a delayed start stays in pregame), live, then final held 15 min after the server first sees it final (starting values; tune). A final first seen more than 6 h after first pitch (e.g. after a server restart) isn't shown.
- **Priority:** weather wins. Auto shows baseball while any game is in its window, except during an NWS warning or watch (transit, with its warning tag). Timed radar visits (§10), when turned on, interrupt baseball the same way they interrupt transit.
- **Live games take precedence:** while any shown game is live, only live games are shown (rotating one minute each if there are several). With nothing live, pregame and final games rotate one minute each. Picked by wall time (`floor(now / 60) % count` over that set), so the board keeps no rotation state. Screen switches are natural gaps for network jobs (§2).
- Phone page and buttons can still switch screens (§10); the phone page gets a Baseball option.

### Layout
- **Team rows:** 3x6 team-color block at x1 and the abbreviation in X11 5x7 (label white) at x6; away on top (block rows 2–7), home below (rows 12–17). No logos.
- **Divider** on row 22 (`#333333`), full width, the same row as the transit weather divider. **No series label** (e.g. `NLDS G2`) anywhere.
- **Bottom line** (Tom Thumb, baseline 31) sits on the same rows as the transit weather row and is right-aligned to x62.
- **Score flash:** when a live score changes, that team's score turns amber for 30 s, then fades back to white over 5 s. The server stamps the change time (the board only draws it); a game first seen mid-game doesn't flash.

**Live**
- Scores: X11 5x7, right-aligned to **x30** (a two-digit score still clears the name), both lit white `#f0f0f0`.
- **Infield:** dim diamond outline (`#3a3a3a`, radius 5) centered at (51,7). Bases are 5x5 diamonds on its corners: 2nd (51,2), 3rd (46,7), 1st (56,7). **Occupied = amber `#ffb000`; empty = solid dark grey `#454545`.**
- **Inning:** `TOP 7` / `BOT 10`, and `MID 4` / `END 5` between halves (the API's `inningState` Middle/End), in Tom Thumb, label white, centered on x51, rows 15–19.
- **Bottom line:** count (`2-1`, label white), 5px gap, outs as text (`2 OUT`, grey).
- **Breaks** (`MID`/`END`): bases empty, and the bottom line is blank (no count or outs).

**Pregame**
- No scores. Each team's W-L (Tom Thumb, grey) sits 3px after the longer team name, on its team's row.
- First pitch time (label white) + `AM`/`PM` (grey) in the bottom line, where `FINAL` goes. No `TODAY` (it's assumed). The right panel is empty.

**Final**
- **Winner's name and score in amber `#ffb000`**; loser's name label white, loser's score darkened white `#6a6a6a`.
- Updated W-L for each team (Tom Thumb, grey) centered on x51, level with its team (rows 3 and 13).
- `FINAL` (label white) in the bottom line.

**Animation:** the arrival-time roll, reused: scores, and while live the inning, count, and outs, roll when they change. Same-shape texts roll only the changed characters (`TOP 7` → `BOT 7` rolls T/B and P/T); anything else rolls whole. No roll across a change of game or state. Nothing else animates.

### Team colors
- One block color per team, from its primary color. Dark navies and maroons (Yankees, Tigers, Padres, Brewers, Twins, Astros, Mariners, Rays, Nationals…) are **boosted** so they read as color, not black, on the panel, like Brown/Purple on the transit screen. Mock values: Cubs `#2a5bd8`, Cardinals `#d62a2a`.

---

## 9. Power

| Screen | Rough draw |
|---|---|
| Transit board | ~0.3–0.6 A |
| Radar, widespread rain | ~0.5–1 A (lower with 65% fills) |
| Ticker | ~1 A with 55% fills (was ~2+ A at full brightness) |
| Baseball | ~0.3–0.5 A |

- Underpowering symptoms: flicker, colors shifting red, resets, WiFi drops.
- **Laptop USB is the trap:** develop with dim test colors or use the 2.4A supply.
- For a brighter build later: power the panel from a separate 5V 4A supply per Adafruit's wiring guidance.

---

## 10. Phone/web control

A small page on the fly.dev server, saved to the phone home screen. The server holds the board's state; the board reads it and draws what it's told.

### Controls
- **Screen:** Auto, Transit, Ticker, Weather (radar while raining), Baseball. Auto stays on transit, or baseball while a game is on (§8): screens don't change on their own otherwise. Optional radar visits (off by default): every N minutes (e.g. 4) show the radar for M seconds (e.g. 60) while rain is in the box, set on the control page.
- **Brightness:** Auto (sunrise/sunset), fixed level, or Off.
- **Station and destination filter:** per-board config, editable instead of hardcoded. Default station: Morse. The station's coordinates are also the board's location for weather, NWS alerts, and radar.
- **Destination filter UI:** "All destinations" on by default. Turned off, it lists every destination the station's lines can show (including rush-only ones not running now, so a filter set off-peak doesn't hide Purple at rush), with checkboxes and up/down ordering. Picking a new station resets the filter to all.
- **Live preview** of what the board is showing at the top of the page (refreshes every 10 s and after each change).
- **Transit header and weather row:** independent on/off toggles per board (see §5 for how many rows each combination fits).

### Behavior
- **Latency:** the board checks `/board/version` about every 10 s (scheduled in animation gaps, see §2) and fetches the full update right away when the version changes. Phone changes show up within ~10–15 s.
- **The chosen screen is permanent:** Auto, Transit, Ticker, Weather, or Baseball stays until changed on the phone, including across board restarts. A forced screen ignores the auto rules (no baseball takeover, no radar visits); forced Baseball with no game on shows the clock and `NO GAMES`. On boot the board sends a boot flag on its first request; the server resets **brightness** to Auto (so a board left off comes back lit) and bumps the version. Screen, station, and filter config persist across restarts.
- **Persistence:** state lives in a small JSON file on a Fly volume, so deploys and server restarts don't wipe config.
- **Buttons vs. phone: last action wins.** A button press sets a local override and records the current server version. The local override holds until the server version changes (a phone change), then the board follows the server again.
- Possible optimization to test on the board: keep the HTTPS connection open between requests to avoid repeating the TLS handshake, which would make version checks nearly free.

### Access
- **Secret URL, no login.** The control page lives at an unguessable path (e.g. `/board/<random>`), with the path stored as a Fly secret (`BOARD_CONTROL_PATH`). Anyone with the link has control; acceptable for a hobby board. Rotate the secret if the link leaks.

---

## 11. Connectivity

- WiFi is set in `settings.toml` on the CIRCUITPY drive over USB (cannot be changed from the phone page, since the board needs WiFi to reach the server).
- **Network list:** home, work (visitor), and **phone hotspot** in `settings.toml`; the board tries each in order and moves on if a network is missing or portal-blocked. The hotspot is the last-resort fallback anywhere (data use is small: ~1 KB per 30 s plus radar frames).
- **Portal detection:** after connecting, the board requests `/board/ping`, which returns `{"ok":1}`. Anything else (HTML, redirect) means a captive portal.
- **Status screens** instead of silent failure: `WIFI OK`, `PORTAL` (with the board's MAC address shown, for IT), `NO WIFI`.
- **Work visitor WiFi:** assume a captive portal until verified. Fixes in order: phone hotspot (works immediately), ask IT to whitelist the MAC, use a portal-free network if one exists, or use a travel router that clears the portal and rebroadcasts WPA2.
- **Bluetooth:** considered and declined. The ESP32 can't run WiFi and BLE at once, and using the phone as the data source would need a native app and stall whenever iOS suspends it.

---

## 12. Open questions

- On-panel checks: yellow rows, `Cottage` width, dimming factors, dim-color floors, Tom Thumb `M`/`N` legibility (3px wide; may need widening like `W`), 3x5 bolt legibility.
- Whether the work visitor WiFi has a captive portal (check with a phone).
- Measure the real fetch time on the board to set the scheduler's fetch budget.
- On-panel check: lowercase `m` legibility (diffuser glow between the humps), and whether `4m` needs a 2px gap.
- Chronological view: whether it flips too often at short-turn stations (if so, raise `CHRONO_HOLD`).

## 13. Parked ideas

**Bus screen** (cut from v1: needs a separate Bus Tracker API key; was 96/155 at Morse with grey `#8a8a8a` row blocks, westbound only since both start at Morse) · separate board location independent of the station · Cubs/Sox scores (16x16 logos from a sprite sheet, personal use) · trains + buses on one screen · leave-by line · Divvy · Metra row · approach track · custom clock digit styles (Chunky, Outline) · timeline strips · merging short-turns into their direction's row with a marker · tap-to-switch via onboard accelerometer · I2C rotary encoder · ambient light sensor · big-number bus layout (route number left, name + times right; tried and declined in favor of the standard rows) · first-train time under the overnight clock (needs CTA GTFS schedule) · CTA alert headline scroll (cut to minimize animation) · full-screen CTA alert text screen (cut; indicators only) · CTA-style alert circle after the destination name on the ticker (declined: collides with long names and two-digit times) · blinking/alternating clock colon (cut to minimize animation) · transit row scrolling/paging for 6–7 destination stations (post-v1) · Bluetooth WiFi provisioning from the phone · run numbers in line color on chronological rows (declined: the color block scans faster, and Brown/Purple read dim as thin strokes) · `MIN` suffix on chronological rows (declined in favor of lowercase `m`) · per-pixel rain/snow from MRMS `PrecipFlag` (GRIB2; replaces the v1 temperature heuristic if the decoder fits in memory).
