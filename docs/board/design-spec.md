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
- **Per-digit roll** when an arrival time changes, and the same roll for the **header clock** (transit, ticker) and the radar's **current time** at each minute. Only the changed digits move while the clock keeps its shape; a width change (`9:59`→`10:00`) rolls the whole clock. Nothing rolls across a screen change. The big overnight and no-games clocks, the radar's frame time, and temperatures and other weather numbers don't roll (board memory). Clock minute rollovers count as animations for the scheduler. Reference: `createNumRoller()` in `server/board/draw.js`.
- **Transit transitions:** a departing train fades out in place, the next time eases to amber, and rows fade in/out and slide (all under 1.2 s, at the same moments as digit rolls).
- **Tornado warning blink** on the weather strip and weather screens: 1 s on, 1 s off. (CTA line alerts are static: see §5.)
- **Ticker page slide.**
- **Radar loop.**

No blinking colons, no scrolling text, and no alert text screens anywhere. Alerts are shown only as indicators (see §5, §6, §7).

### Scheduler (board main loop)
A small cooperative scheduler lines up network requests with animation gaps:
- **Animation timeline:** the board tracks when its next animation will start: next digit roll (computed from arrival timestamps), next list slide (chronological view), next ticker slide, radar frame steps, and screen switches.
- **Network jobs:** each job (version check, combined update, radar frame) has a **due time** and a **deadline**.
- **Each loop pass:** if a job is due and the next animation is at least the **fetch budget** away, run it now; otherwise wait for the next gap.
- **Deadline override:** if a job passes its deadline (e.g. data older than ~60 s), run it anyway. A brief freeze beats stale times.
- **Alert blink:** the blink doesn't count as busy, but a fetch freezes it. While a tornado warning blinks, non-overdue fetches wait for the blink to turn on, show the lit frame, and the blink restarts (off) when the fetch ends, so the freeze reads as one slightly long "on" phase instead of a glitch.
- **Natural gaps:** radar last-frame hold, ticker page holds, screen switches, and the stretch between minute rollovers on the transit screen.
- **Fetch budget:** start at ~2 s; replace with the measured request time on the real board.

### Fetch cadence

**Board → server**

| Request | How often | Size |
|---|---|---|
| Settings version check (`/board/version`) | ~every 10 s | a few bytes |
| Combined update (only the shown screen's sections; contract "Sections") | ~every 30 s, or right away when the version changes or a button changes the screen | ~0.5–0.75 KB |
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
| Weather | Open-Meteo (no key) | Current temp, weather code, `is_day`, sunrise/sunset, rain bars. |
| Forecast | NWS `api.weather.gov` (no key) | Today's high/low, rain chance, 5-day and hourly icons and temperatures (forecaster-edited; icons used as NWS sends them). |

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
  - Inline **bolt** (3x5) and **funnel** (4x5): used in the weather strip tag **and** next to AM/PM on the radar.
  - **Alert circle** (5x5): red circle with a white "!": the ticker index column and after the label on transit rows.
  - **Cut mark** (3x1, `CUT`): two dots on the baseline (an ellipsis with one dot less), after a transit label shortened to make room for the alert circle.
- **Digits are tabular** in every font (one shared cell width), so a rolling digit never shifts its neighbors. Spaces are 2px (small) and 3px (5x7).
- The **alert circle** is two glyphs drawn at the same origin: a red disc with the "!" pixels left blank, and a white "!". Fonts are one color per glyph.
- Codepoints for custom glyphs are in `server/board/glyphs.js`. The fonts are built by `scripts/build-fonts.js` into `server/board/fonts/` (BDF); the board build converts them to PCF.
- X11 **9x15 Bold** for the large overnight clock, with a custom **2x2 square-dot colon** centered on the 10px digit height (the stock X11 colon is drawn for text and drops a pixel below the digits).

---

## 4. Colors and brightness

| Use | Color |
|---|---|
| Labels | white `#d8d8d8` |
| **Clocks** | 80% white `#cccccc` (overnight, no-games); the transit header clock uses the transit dark grey `#555555`, the ticker's the header grey `#808080` |
| First arrival time | amber `#ffb000` |
| Later times | dim amber `#664600` (~40% of the first time; at ~61% it was hard to tell apart on the panel). With **time dim steps** on (per board, `timeSteps`), the third time drops to `#332300` (20%), so the three read 100/40/20% |
| Schedule-based times (`isSch`), first / later | grey `#6a6a6a` / `#2e2e2e` (instead of amber; same width, so digit rolls are unaffected). The first is about half the light of the white labels so it reads as grey on the panel (`#b0b0b0` looked white); later ones are about 40% of the first, the same step as amber to dim amber; with time dim steps the third is `#151515` |
| Secondary text (station name, high/low) | grey `#8f8f8f` |
| Dividers (header line, weather screens) | `#333333` |
| Shoreline | `#34485e` |
| Alert circle (transit and ticker) | red `#ff2020` with white `#ffffff` "!" |

- **Global brightness:** 100% sunrise to sunset, ~40% overnight (times from Open-Meteo). Every dim element has a **minimum floor** so it never drops to black at night.
- **Radar rain fills** render at ~65%; **ticker row fills** at 55%. Text stays full brightness.
- Rule of thumb from the session: **lit strokes on dark survive; dark strokes on lit don't** (diffuser glow fills them in).
- **Clock colons are steady** on every clock. The big clocks (overnight, no-games) use `#cccccc`; the transit and ticker header clocks match their station names (`#555555` transit, `#808080` ticker); the radar's frame time is dimmed (`#7a7a7a`, AM/PM `#8f8f8f`) so it doesn't read as the current time.

---

## 5. Screen 1: Transit station

### Rows
- 3px line-color block, Tom Thumb label (uppercase), **3 times**, right-aligned as a group, not in columns (amber first, dim the rest; optionally the third dimmer still, see §4). Times are 3px apart, tightening to 2px when the row is full, so long names like `KIMBALL` and `COTTAGE` always fit.
- **Schedule-based predictions** (`isSch`, e.g. southbound trains at Morse that haven't left the Howard terminal) are shown, with the time in grey instead of amber. `isFlt` (possible fault) predictions are shown normally.
- **Trains ending at this station** are not shown (Terminal Arrival at Howard; "63rd Street" trains at Ashland/63rd, which only shows Harlem trains).
- **Minutes round up**, like CTA's own predictions: `DUE` within 60 s (when CTA flags the train as approaching), then 2, 3, …; never 1.
- **One DUE per destination:** only the soonest train of a destination (same line and direction) can read `DUE` (rows, chronological view, and ticker alike). When trains are bunched and a later one is also within 60 s, it shows `2` (`2m`) instead, so two DUEs never sit side by side.
- **Per-digit roll** when a number changes (12→11 rolls only the 2), and whole-cell rolls to and from `DUE`.
- **Departures fade, not roll:** when the first train leaves, its cell fades out in place (0.7 s), then (not during the fade) the remaining times slide left (0.5 s), a newly joined time at the end fades in after that slide, and the new first time eases from dim to amber (0.7 s). A row losing its last train fades out, then the rows below slide up; new rows and times fade in. Arrivals are matched across updates by time (within 90 s), so refreshed predictions don't flicker. Reference: `createTransitAnimator()` in `server/board/draw.js`.

### Layout
- **Header station names** must fit 42px (the space left by the widest clock). Shortening order: full name; then drop ordinal suffixes (`95/DAN RYAN`, `35/ARCHER`); then a curated short name (`HW LIBRARY`, `MERCH MART`, `CLARK/DIV`); list in `server/board/station-names.js`, editable per board from the phone.
- **Header** (station name and clock both dark grey `#555555`, so the train rows are the focus; flush to the screen edges at x0 and x63, no background; same layout as the ticker header, which stays `#808080`) and **weather strip** (rows 27–31, no divider) are **each optional**, set per board in config, independent of row count.
- **Header divider:** a per-board toggle for a `#333333` line on row 7 under the header (default off). The old line above the weather row is gone with the row (`wxDivider` is still accepted but not drawn).
- **Layouts** (per board, `transitLayout`): **header** (above) or **key** (below).
- **No edge padding:** text runs to the screen edges (x0 and x63) everywhere outside filled bands.
- Rows fill the remaining space (5px rows, gaps of 1px or more).
- **Without the header, rows are spread evenly** from the top of the panel to the weather strip (rows 0–25) (or the bottom edge): equal gaps above, between, and below. The between-row gap is the ideal gap rounded to the nearest pixel; the leftover is split top and bottom, any odd pixel going to the bottom.
- **Fitting:** the header and weather toggles are the most the board shows; each takes one row. When more destinations are running than fit, the **weather strip is hidden first, then the header** (key layout: **the station line first, then the key**), so up to 5 destinations stay as rows. **Past 5, the board switches to the chronological view** (below) with the header or key (if on) and **no weather strip or station line**. Re-checked on every update, so it adapts as service changes through the day (e.g. Merchandise Mart with rush-only Purple). The ticker always shows its header, even with the header toggle off (hiding it frees no space the ticker uses). Row order isn't a concern.
- Scrolling or paging for more than 5 rows (some Loop stations need up to 7) is **out of scope for v1**; the chronological view covers those stations.

**Geometry (from the mocks):**
- Header band on rows 0–6, text on rows 1–5. Train rows start at row 9 or lower (at least 2px clear of the band).
- Weather strip on rows 27–31; train rows end by row 25.
- **With header** (row pitch, row top to row top): 2 rows 8px (9px with no weather strip: 4 px under the header and between the rows, rows at 12 and 21 with the header's divider line, 10 and 19 without; the rest of the space stays at the bottom); 3 rows 8px (rows at 10, 18, 26); 4 rows 6px (rows at 9, 15, 21, 27, using the full height). With the weather strip: 2 rows at 10, 18; 3 rows at 8, 14, 20 (2 px under the header text, 1 between, 2 above the strip). Without the divider line the 3- and 4-row layouts and the weather-strip layouts move up 1 px (the header text ends on row 5) so the gap under the header matches the gaps between rows. Otherwise rows are centered in whatever space is left.
- **Without header** (even spacing over rows 0–31, or rows 0–25 with the weather strip on):

| Weather strip | Rows | Row tops | Gaps (top / between / bottom) |
|---|---|---|---|
| off | 2 | 7, 19 | 7 / 7 / 8 |
| off | 3 | 4, 13, 22 | 4 / 4 / 5 |
| off | 4 | 1, 9, 17, 25 | 1 / 3 / 2 (pinned: 3px between rows reads better than the rounded 2px) |
| off | 5 | 1, 7, 13, 19, 25 | 1 / 1 / 2 |
| on | 2 | 5, 15 | 5 / 5 / 6 |
| on | 3 | 2, 10, 18 | 2 / 3 / 3 |
| on | 4 | 1, 7, 13, 19 | 1 / 1 / 2 |


| Header (or station line) | Weather strip | Key | Max rows |
|---|---|---|---|
| off | off | off | 5 |
| on | off | off | 4 |
| off | on | off | 4 |
| on | on | off | 3 |
| on (station line) | — | on | 3 |
| off | — | on | 4 |

### Key layout (optional)
- **Key** on rows 1–5: lowercase Tom Thumb in the transit dark grey `#555555`, `trains to` from x0 (over the color blocks) and `min` flush right. Never amber (amber means a live train). The wording follows WMATA's `LN | CAR | DEST | MIN` header row; most agencies have no key.
- **Station line** at the bottom: a `#333333` divider on row 25, then the station name (x0) and clock (flush right, rolling) in `#808080` on rows 27–31 (baseline 32), on an unlit background. It reads as a footer, not as the key's equal. (First built on a `#141414` band on rows 27–31; replaced by the unlit line.)
- **Rows** between the key and the divider (rows 6–24), 1 px apart from three rows up: 3 rows at 7, 13, 19 (1 px everywhere: key, rows, divider, station); 2 rows at 9, 17; 1 row at 13. With the station line hidden (4 rows): 7, 13, 19, 25.
- **Fitting:** the station line hides before the key (4 rows: key and rows; 5: neither). The chronological view keeps the key (4 rows). No weather strip in this layout (the station line takes its rows).
- The header divider doesn't apply.

### Chronological view (overflow)
- **When:** the destination count (after the per-board destination filter) exceeds the board's max rows. The server decides on each update and sends `view` in the combined update.
- **Switching is immediate both ways:** chronological as soon as destinations exceed max rows, back as soon as they fit. If short-turns make it flip too often, raise `CHRONO_HOLD` in `arrivals.js` (a hold time before switching back; the mechanism is built, set to 0).
- **Rows:** same anatomy as destination rows: 3px line-color block, Tom Thumb label (uppercase), **one time** right-aligned. Each row is one train, soonest first. First row's time amber (grey if schedule-based), the rest dim.
- **Time format:** digits + lowercase `m` with the font's own **1px gap** (`4m`, `12m`); `DUE` stays bare. Labels are fitted against the widest time (`99m`), so they have up to 43px.
- **Line ID: a line-colored position digit** (1–5, Tom Thumb, columns 0–2), then a 1px gap, the 3px line-color block (columns 4–6), and the label at x9. The digit is the block's exact color for every line (Brown and Purple were briefly brightened for thin strokes; matching the block won out). When a train departs, each digit rolls down (2→1) as the list slides up. Alerts show the label and red alert circle as on destination rows (the digit and block stay; at 43px there's room for the whole name). No run numbers. (Also tried: inverted digits on 3px and 5px blocks, white digits on 5px blocks at full and 55% color.)
- Same row counts and geometry as destination rows; the header (or key) follows its setting; the weather strip and station line are always off (4 rows with the header or key, 5 without). The server sends 2 extra trains below the cap so the board can bring the next one in between updates.
- **Departure:** the first row slides up under the header while fading, the list slides up one row pitch with it (0.5 s ease), the next train turns amber, and a new train slides in at the bottom. Per-digit roll still applies within a row (`12m`→`11m` rolls only the 2).
- **Trains swapping order** between updates: rows are keyed by run number, so the two rows just slide past each other.
- **Switching views** cross-fades: the old rows fade out, then the new ones fade in.
- **CTA alerts:** label and red alert circle, as on destination rows.
- **Accepted trade-off:** infrequent lines can drop off the screen when frequent ones fill all rows.

### Weather strip (optional)
- One Tom Thumb line on rows 27–31 (baseline 32), no divider, in the header's dark grey `#555555` so the train rows lead: the **temperature** (`54°`) from x0 and the **condition word** (`PT CLOUDY`, `STORMS`, …) flush right. No icon. Replaced the 8x8-icon weather row (rows 22–31, which capped header + weather at 2 rows) in Oct 2026.
- **Watch/warning tag** replaces the condition word (the temperature stays): `[bolt]` or `[funnel]` + `WATCH` (yellow) / `WARNING` (orange for severe, red for tornado), flush right, with a **3px gap** between icon and word (1px read as `SWATCH`; 2px still looked tight). A tornado warning blinks; the rest are static. (Also tried: the whole strip swapping to `TSTORM WARNING` / `TORNADO WARN`; declined because it hides the temperature for the hours a watch lasts.)
- Icons (`server/board/icons.js`, previews in `docs/board/previews/sheet-icons.png`) are still used by the weather screens.

### CTA alerts
- **Which alerts:** major alerts only (CTA severity `major`, or flagged MajorAlert). A sample on Oct 4 had 7 active alerts (a 2029 station closure across 5 lines, a schedule change, a station bypass, elevators, and an Orange/Green minor delay) and none of them blink.
- Affected rows keep their color block and show the label followed, 2px later, by the **ticker's red alert circle** (white "!"), so both screens use one glyph. **Static, no blink.** That's the whole indicator; no alert text is shown (details are on the phone).
- **Fitting:** the label and circle are fitted against the **widest** times the row's count can reach (the first time `DUE`, the rest two digits, 2px apart), with 2px clear before the times, so the label never changes length as the times count down. The whole name shows when it fits (in practice with two times or fewer, and always in the chronological view); otherwise it's cut and ends with the two-dot cut mark: with three times `KIMB‥`, `HOWA‥`, `COTT‥`, `LIND‥`; `LOOP`, `95TH` and `O'HARE` stay whole. The server sends the fitted label as `al` (contract, Row); a row's count only changes with an update, so a departure between updates keeps the shorter label until the next one.
- (Replaced, Oct 25 2026: the block at 20% of the line color under a 1px full-color "!" (`ALERT_BANG`, still used by the frozen M4), barely noticeable on the panel; before that a 1 s blink between the block and the bare "!". Also mocked and declined: a line-color band behind the row, a red label, red times, the alert circle in place of the block, and the block running on under the label as an underline.)
- CTA alerts are per line, so **every row of the affected line is marked, both directions**. Marking only one direction would need parsing the alert text; not planned for v1.

### Destination labels
Server-side short-name map so labels fit (~6–7 characters next to a two-digit time). Shared by the transit screen (rendered uppercase) and the ticker (mixed case).

| CTA destination | Shown |
|---|---|
| Forest Park | `Forest` |
| 54th/Cermak | `54/Crmk` (the ticker's 5x7 cuts it to `54/Crm`) |
| 95th/Dan Ryan | `95th` |
| Ashland/63rd, 63rd Street (what Train Tracker sends) | `63rd` |
| Harlem/Lake | `Harlem` |
| Dempster-Skokie | `Skokie` |
| UIC-Halsted (Blue Line short turn) | `UIC` |
| Jefferson Park (Blue Line short turn) | `Jeff Pk` |
| Cottage Grove | `Cottage` (borderline; check on panel) |

- **Two possible destinations** (Train Tracker's `Howard (or Loop)` before a Purple trip starts, local or Express): shown in the first one's row (`Howard`; every such train gets there), or the second one's at the first one's own station (`Loop` at Howard). Any `A (or B)` is handled the same way (`resolveDest` in `destinations.js`).
- Green Line eastbound at Ashland: separate `63RD` and `COTTAGE` rows.
- Same destination on two lines (e.g. Brown and Purple `LOOP` at Merchandise Mart): two rows told apart by the color block only. Accepted.
- **Short-turn trains** (e.g. Blue Line to UIC-Halsted or Jefferson Park) get **their own row**. The layout follows the row count as these come and go.
- **Unknown destinations** (disruptions, reroutes): own row, name truncated to fit; the server logs them so they can be added to the map.
- **No per-station default layout.** The layout follows the live destination count. Examples: Merchandise Mart shows 2 destinations off-peak (Brown) with the header and weather strip; rush-only Purple adds `LINDEN` and `LOOP`, the weather strip hides to fit 4 rows, and it returns when Purple stops. Belmont off-peak has 4 (Red and Brown, weather strip hidden); at rush, Purple makes 6 and it switches to the chronological view. The **per-board destination filter** avoids those changes if unwanted; it's applied first, and the fit runs on the filtered list.

### Other states
- **Overnight / no predictions:** large **9x15 Bold** clock (`#cccccc`) with the 2x2 square colon, dim `NO TRAINS` label below it, weather strip below. Follows the board's weather setting; with the weather strip off, the clock and `NO TRAINS` are centered vertically.
- **Stale data:** when the server has no Train Tracker data, or it's more than 3 minutes old (CTA failing), the transit and ticker screens show a red (`#ff2020`) line along the top edge (row 0, which no screen draws on, with or without the header), and once none are left the overnight layout says `NO DATA` instead of `NO TRAINS`.

---

## 6. Screen 2: CTA-style ticker (easter egg)

- **Header:** the transit header's: station and clock `#808080`, flush to the edges, no background. (No divider option: the rows start at row 7.)
- **Two 12px rows** with a 1px gap; dark grey index column `#2d2d2d` (neutral: a tinted dark color collapses to one saturated channel on the panel), **5px wide**, numbered 1–6 in Tom Thumb. The row fill starts right after it (no gap); the destination starts 2px into the fill. Minutes are right-aligned to column 62, with a 2px gap between the digits and `min`.
- Row fill = line color at 55% (adjustable per board on the phone, 25–80%); **white** destination (X11 5x7 proportional, mixed case) + minutes (5x7 digits + `min` glyph); `Due` within 60 s (minutes round up, like CTA; see contract countdown rules). Yellow rows also use white text.
- Destinations use the short-name map, so short-turns appear as `UIC` and `Jeff Pk`.
- **Schedule-based arrivals:** the **index number is replaced by a 5x5 clock** (`CLOCK` glyph: ring with hands up and right), drawn in the index number's color. If an arrival is both scheduled and on an alerted line, the alert circle wins.
- **CTA alerts:** on arrivals whose line has an active alert, the **index number is replaced by the 5x5 red alert circle** (white "!"), which fills the 5px column exactly. It sits on the dark index column, so it never collides with the destination or time. Static, no blinking.
- Pages of 2 hold **8 s**, then **slide up** (**1.2 s** ease) through the next **6 individual arrivals**, looping. Network requests happen during the holds. Hold (5–15 s) and slide (0.8–2 s) are adjustable per board on the phone.

---

## 7. Screen 3: Weather (radar while raining)

- **Weather by default, radar when rain is in the box** (count of colored pixels, with separate on/off thresholds so it doesn't flicker in and out). The screen is `weather` (formerly `radar`); the payload's `radar` object, the radar frame endpoint, and the radar visit/time settings keep their names since they're about the radar loop. Timed visits on the auto screen still only happen while it rains, so they always show the radar.
- **Weather layout** (Open-Meteo; exact pixels in `contract.md`, Radar): big temperature in the 9x15 Bold digits with a 3x3 ring degree sign, icon top right with the dim condition word under it, divider on row 18, then `FEELS 53°` + wind (`NW 12`) and `H 63° L 49°` + rain chance (a small blue drop + `20%`, the highest hourly chance over the next 6 hours). A **watch or warning replaces the high/low line** with the glyph and `TSTORM WATCH` / `TSTORM WARNING` / `TORNADO WATCH` / `TORNADO WARN` in the warning colors (tornado warning blinks). Preview: `docs/board/previews/mock-weather-screen.png`.
- **Hourly layout** (`wxView` `hourly` on the phone): today's top bar, then the weather 2, 4, 6 and 8 hours ahead in four columns (time, icon, temperature). With rain bars on (`wxRain`), it's the dry state. Preview: `docs/board/previews/mock-weather-hourly.png`.
- **Rain bars** (per board, `wxRain` on the phone: Radar loop, Rain bars (never the loop), or Both: the radar loop plays 1, 2, 3, or 5 full loops, then the bars show for 10–60 s, repeating while the radar box and the forecast both have rain): while rain or snow is falling or due in the next 2 hours, the weather screen shows today's top bar (as in the 5-day layout), a title (`RAIN IN 25 MIN`, `RAIN NEXT 2 HRS`, `ENDS IN 60 MIN`, `BREAK IN 30 MIN`, or `SNOW …`) with a drop or flake standing in for the word on titles that don't say RAIN or SNOW (`ENDS IN`, `BREAK IN`), and eight 15-minute bars on a fixed square-root intensity scale in three blue (or grey, for snow) levels, `1H` / `2H` under the axis. Dry, it shows the conditions, 5-day or hourly layout. Preview: `docs/board/previews/mock-weather-rain.png`.
- **Top bar warnings** (5-day, hourly and rain bars): the temperature shadow follows the board's setting, and an NWS watch or warning takes over the high/low line (glyph + `WATCH` / `WARN`; a tornado warning blinks); the layout below it stays.
- **5-day layout** (per board, `wxView` on the phone: Conditions or 5-day): today on top (icon, then the temperature in 5x7 white with a 1px shadow in its temperature color, the high and low right as `↑63 ↓49` with dim arrows), then the next five days in 13px columns split by thin vertical dividers: two-letter weekday, icon, and the high colored blue (cold) to red (hot). A watch or warning switches back to the conditions layout while it's on, since only that has a line for it. Preview: `docs/board/previews/mock-weather-5day.png`.
- **Configurable location**; crop centered on it (~1.5 mi/pixel).
- **Pipeline (server):** crop → palette index to dBZ → average linear reflectivity per LED block → levels (15/25/35/45/55 dBZ: dim green, green, yellow, orange, red) → despeckle (drop pixels with <2 colored neighbors) → small indexed image.
- **Snow (v1):** the whole frame switches to a 3-level snow palette (light blue, pale blue, white) when Open-Meteo reports a snow weather code, or ≤ 32°F without freezing rain. Snow gets its own thresholds (provisional 10/15/20 dBZ, from the Feb 2, 2022 storm) because dry snow reflects much less than rain. A rain/snow line inside the box, and mixed precip, render as one type. Details in `contract.md`.
- **Loop:** 6 frames, 6 min apart (30 min end to end; the newest at most ~8 min old; IEM only archives even minutes), 0.5 s each, **holds on the last frame** for 4 s. Network requests happen during the hold, except while the loop is still filling in on screen: then the missing frames are fetched back to back, newest first. Until every frame is on hand the screen holds on the newest one downloaded (so it never goes black or plays backward); the last frame to land restarts the loop from the oldest. The conditions screen shows until the first frame arrives. Frame step (0.3–1 s) and hold (2–8 s) are adjustable per board on the phone.
- **Water masked black** (mask generated per location from coastline data), with a faint shoreline along its edge.
- **Layout per station** (`server/board/locations/`, built by `scripts/build-locations.js` from Natural Earth's Lake Michigan outline): full width with the time over the lake when the time's area is all water (114 of 144 stations), otherwise the split layout (radar left 39 columns, a gray `#333333` line on the panel's left edge, time right 24). The time stack is **top-aligned** (rows 2–19) in both.
- **No frames yet** (rain in the box but nothing processed, e.g. right after a deploy): the weather layout.
- **Shoreline** is painted on the lake's edge pixels (inside the water), so rain never covers it.
- **Colors** (fills at 65%; the two greens at 70% of that, since light rain covers most of a loop and green reads brightest on the panel; the phone's radar brightness scales all precip): rain `#1f8f1f`, `#2ee02e`, `#ffe000`, `#ff8c00`, `#ff1a1a`; snow `#4f86ff`, `#a9c9ff`, `#ffffff`; marker white; frame indicator `#3a3a3a`, current frame amber.
- **Location marker:** white dot. The pixels around it keep their rain or snow (the earlier ring of 4 cleared pixels was dropped).
- **Time:** X11 5x7 (dimmed `#7a7a7a`, AM/PM `#555555`), right-aligned in empty water, steady colon (frame timestamp). **Frame indicator above it** (2px-tall segments, current frame amber), AM/PM in Tom Thumb below. **The time is optional** (per-board `radarTime`, on by default): off replaces it with **current conditions**, the weather icon and temperature (Tom Thumb, label white `#d8d8d8`) right-aligned under the frame indicator, as on the old transit weather row. The warning tag then moves to the **bottom right of the screen**: icon + `WATCH` or `WARN` on a black backing (WATCH runs past the time box onto the radar; to revisit). 
- **Warning colors (every screen):** watches yellow, severe thunderstorm warnings orange, tornado warnings red and **blinking** (1 s on, 1 s off) on the weather strip and the radar. If the location has no usable water area, fall back to **split layout** (radar left, clock right).
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
- **Every Cubs and White Sox game** (team IDs 112 and 145, any game type) and **every postseason game** (game types `F`, `D`, `L`, `W`). Postponed and cancelled games are skipped.
- **Window** (per board, see §10): pregame from 30 min before first pitch (a delayed start stays in pregame), live, then final held 15 min after the server first sees it final (starting values; tune). A final first seen more than 6 h after first pitch (e.g. after a server restart) isn't shown.
- **Forced Baseball** (screen set to Baseball on the phone) uses wider windows: every game scheduled today shows all day from midnight, and finals hold until 3 AM the next morning (no stale-final rule). Auto keeps the windows above, since there baseball takes over transit.
- **Priority:** Auto shows baseball while any game is in its window, NWS warnings and watches included (plenty else announces the weather). Timed radar visits (§10), when turned on, interrupt baseball the same way they interrupt transit.
- **Live games take precedence:** while any shown game is live, only live games are shown (rotating one minute each if there are several). With nothing live, pregame and final games rotate one minute each. Picked by wall time (`floor(now / 60) % count` over that set), so the board keeps no rotation state. The minute is adjustable per board on the phone (30 s–2 min). Screen switches are natural gaps for network jobs (§2).
- Phone page and buttons can still switch screens (§10); the phone page gets a Baseball option.

### Layout
- **Three layouts** (phone page, Baseball screen): **Classic** (below), **Logos**, and **Bands** (see *Logo and band layouts*). The status panel, divider, and bottom line are shared.
- **Team rows (Classic):** 3x6 team-color block at x0 and the abbreviation in X11 5x7 (label white) at x5; away on top (block rows 2–7), home below (rows 12–17).
- **Divider** on row 24 (`#333333`), full width, in every layout (moved down from the weather row's 22 so the logo bands get 12 rows each). **No series label** (e.g. `NLDS G2`) anywhere.
- **Bottom line** (Tom Thumb, baseline 31; one row above the transit weather strip, which moved to baseline 32) is right-aligned to x63 (`TODAY` at x0).
- **Score flash:** when a live score changes, that team's score turns amber for 30 s, then fades back to white over 5 s. The server stamps the change time (the board only draws it); a game first seen mid-game doesn't flash.

**Live**
- Scores: X11 5x7, right-aligned to **x30** (a two-digit score still clears the name), both lit white `#f0f0f0`.
- **Infield:** dim diamond outline (`#3a3a3a`, radius 5) centered at (51,7). Bases are 5x5 diamonds on its corners: 2nd (51,2), 3rd (46,7), 1st (56,7). **Occupied = amber `#ffb000`; empty = solid dark grey `#454545`.**
- **Inning:** `TOP 7` / `BOT 10`, and `MID 4` / `END 5` between halves (the API's `inningState` Middle/End), in Tom Thumb, label white, centered on x51, rows 15–19.
- **Bottom line:** count (`2-1`, label white), 5px gap, outs as text (`2 OUT`, grey).
- **Breaks** (`MID`/`END`): bases empty, and the bottom line is blank (no count or outs).

**Pregame**
- No scores. Each team's W-L (Tom Thumb, grey) sits 3px after the longer team name, on its team's row.
- `TODAY` (grey) bottom left, as in the logo and band layouts; first pitch time (label white) + `AM`/`PM` (grey) bottom right, where `FINAL` goes. The right panel is empty.

**Final**
- **Winner's name and score in amber `#ffb000`**; loser's name label white, loser's score darkened white `#6a6a6a`.
- Updated W-L for each team (Tom Thumb, grey) centered on x51, level with its team (rows 3 and 13).
- `FINAL` (label white) in the bottom line.

**Animation:** the arrival-time roll, reused: scores, and while live the inning, count, and outs, roll when they change. Same-shape texts roll only the changed characters (`TOP 7` → `BOT 7` rolls T/B and P/T); anything else rolls whole. No roll across a change of game or state. Nothing else animates.

### Logo and band layouts
- **Bands:** each team gets a 12-row band (away rows 0–11, home 12–23) from x0 to x37. **Logos:** the band is the logo tile's background color and the team's 24 x 12 logo crop sits at its left. **Bands:** the team's block color, with the abbreviation (X11 5x7, white or black on a light band) in the logo's place. Bands and logos are drawn at the **logo brightness** setting (default 90%), applied by the board.
- **Scores** (X11 5x7) are centered at x30 in the box between logo and band end: white, or black (unlit pixels) on a light band (drawn band luma above 140, e.g. Atlanta's light grey), so the text always contrasts. No drop shadow for now (`embossText` stays in `draw.js` for later). Amber for the score flash and the final's winner; the loser stays white.
- **Panel:** infield centered on row 8, inning on baseline 21; records (pregame and final) centered on x51 at each band's text row.
- **Pregame:** the abbreviation in each score box (Logos), records in the panel, **`TODAY`** (grey) bottom left, first pitch bottom right.
- **Logos** are the owner's 32px pixel art (a 5 x 6 sheet or one team at a time, uploaded from the phone page), never in the repo. The server only resizes (32 → 24px, area average) and crops 12 rows at each team's crop row; colors are untouched apart from a 64-color cap per logo for the board's palette. Without a logo, a team gets its block-color band and its abbreviation in the logo slot.

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
- **Screen:** Auto, Transit, Ticker, Weather (radar while raining), Baseball. Auto settings (defaults reproduce the original behavior):
  - **Auto shows:** Transit and/or Ticker; with both, they alternate every 30 s–10 min (default: Transit only).
  - **Weather visits:** Off (default), While raining, or Always; every N min for M s.
  - **Jump to weather for NWS alerts:** Off (default), Warnings, or Watches too; stays on the weather screen while the alert is on, over baseball.
  - **Baseball takes over for:** Cubs, White Sox, Postseason (default all); pregame window 0–2 h (default 30 min), final 0–60 min (default 15); during live games show live games (default), Cubs/Sox first, or all games.
- **Brightness:** Auto (sunrise/sunset), fixed level, or Off.
- **Temperature unit:** °F (default) or °C, per board, for every weather display (weather strip, weather screen, radar corner). The server converts; temperature colors still follow the °F scale. Wind stays mph.
- **Station and destination filter:** per-board config, editable instead of hardcoded. Default station: Morse. The station's coordinates are also the board's location for weather, NWS alerts, and radar.
- **Destination filter UI:** "All destinations" on by default. Turned off, it lists every destination the station's lines can show (including rush-only ones not running now, so a filter set off-peak doesn't hide Purple at rush), with checkboxes and up/down ordering. Picking a new station resets the filter to all.
- **Live preview** of what the board is showing at the top of the page (refreshes every 10 s and after each change).
- **Transit layout:** station on top (header) or key on top (station line at the bottom). **Header and weather strip:** independent on/off toggles per board (see §5 for how many rows each combination fits; the key layout has no weather strip).
- **Header clock** (transit and ticker) on/off, and **destination names** in white or the line's color (Brown and Purple read dim as text in their true colors).
- **Time dim steps** (Transit): the third arrival time at 20% instead of 40% (default off).
- **Board health:** last report, uptime, free memory (and lowest), skipped frames, failed fetches, reconnects, restarts, last error, WiFi signal. Sent by the board with the version check about once a minute, so problems show without a USB serial console.

### Behavior
- **Latency:** the board checks `/board/version` about every 10 s (scheduled in animation gaps, see §2) and fetches the full update right away when the version changes. Phone changes show up within ~10–15 s.
- **The chosen screen is permanent:** Auto, Transit, Ticker, Weather, or Baseball stays until changed on the phone, including across board restarts. A forced screen ignores the auto rules (no baseball takeover, no radar visits); forced Baseball with no game on shows the clock and `NO GAMES`. On boot the board sends a boot flag on its first request; the server resets **brightness** to Auto (so a board left off comes back lit) and bumps the version. Screen, station, and filter config persist across restarts.
- **Persistence:** state lives in a small JSON file on a Fly volume, so deploys and server restarts don't wipe config.
- **Buttons vs. phone: last action wins.** A button press sets a local override and records the current server version. The local override holds until the server version changes (a phone change), then the board follows the server again.
- **Watchdog:** the board's hardware watchdog (16 s, the M4's maximum) resets it if the loop hangs. The loop feeds it every pass and before each request. A watchdog reset is not a cold boot, so it doesn't reset brightness.
- Possible optimization to test on the board: keep the HTTPS connection open between requests to avoid repeating the TLS handshake, which would make version checks nearly free.

### Access
- **Secret URL, no login.** The control page lives at an unguessable path (e.g. `/board/<random>`), with the path stored as a Fly secret (`BOARD_CONTROL_PATH`). Anyone with the link has control; acceptable for a hobby board. Rotate the secret if the link leaks.

---

## 11. Connectivity

- WiFi is set in `settings.toml` on the CIRCUITPY drive over USB (cannot be changed from the phone page, since the board needs WiFi to reach the server).
- **Network list:** home, work (visitor), and **phone hotspot** in `settings.toml`; the board tries each in order and moves on if a network is missing or portal-blocked. The hotspot is the last-resort fallback anywhere (data use is small: ~1 KB per 30 s plus radar frames).
- **Portal detection:** after connecting, the board requests `/board/ping`, which returns `{"ok":1}`. Anything else (HTML, redirect) means a captive portal.
- **Status screens** instead of silent failure: `WIFI OK`, `PORTAL` (with the board's MAC address shown, for IT), `NO WIFI`.
- **Status NeoPixel** (on the board, behind the panel, very dim): blue during each request, yellow/amber/red while connecting (joining, portal, no WiFi or server), dim red after a failed request, magenta blink after a caught MemoryError, white at startup after a watchdog reset, red blink before a crash restart. `STATUS_LED` in `settings.toml`: 2 all, 1 no fetch light, 0 off. Colors in `firmware/README.md`.
- **Work visitor WiFi:** assume a captive portal until verified. Fixes in order: phone hotspot (works immediately), ask IT to whitelist the MAC, use a portal-free network if one exists, or use a travel router that clears the portal and rebroadcasts WPA2.
- **Bluetooth:** considered and declined. The ESP32 can't run WiFi and BLE at once, and using the phone as the data source would need a native app and stall whenever iOS suspends it.

---

## 12. Open questions

- On-panel checks: yellow rows, `Cottage` width, dimming factors, dim-color floors (incl. the 20% third time at night), Tom Thumb `M`/`N` legibility (3px wide; may need widening like `W`), 3x5 bolt legibility.
- Whether the work visitor WiFi has a captive portal (check with a phone).
- Measure the real fetch time on the board to set the scheduler's fetch budget.
- On-panel check: lowercase `m` legibility (diffuser glow between the humps), and whether `4m` needs a 2px gap.
- Chronological view: whether it flips too often at short-turn stations (if so, raise `CHRONO_HOLD`).

### Sports screens beyond baseball (mockups, not built)
Same frame as the baseball Bands layout: 12-row team-color bands (abbreviation left, score centered at x30), divider row 24, bottom line on baseline 31, status panel right. Pregame: records in the panel, `TODAY` (or the day) bottom left, start time bottom right. Final: winner's score amber, records in the panel, `FINAL` bottom right.

- **NFL** ([mockup](mockups/nfl.png)): panel = quarter (`Q3`, Tom Thumb) over the game clock (5x7). Possession = small amber football inside the band between abbreviation and score. Bottom line = down and distance left (`2ND & 7`; amber in the red zone, e.g. `1ST & GOAL`), ball spot right (`GB 35`); the longest case still fits (35 + 17 px).
- **NBA** ([mockup](mockups/nba.png)): panel = quarter over the clock; under a minute the clock shows tenths (`38.4`, amber). `HALF` replaces both at halftime. Bottom line = a scoring run in amber (`CHI 8-0 RUN`) or timeouts left (`TO 2` ... `TO 1`). Three-digit scores fit the score box. Final shows `FINAL/OT` for overtime.
- **Data:** no free official API like MLB's; ESPN's unofficial scoreboard JSON is the usual source (free, undocumented, can change).

## 13. Parked ideas

**Bus screen** (cut from v1: needs a separate Bus Tracker API key; was 96/155 at Morse with grey `#8a8a8a` row blocks, westbound only since both start at Morse) · separate board location independent of the station · Cubs/Sox scores (16x16 logos from a sprite sheet, personal use) · trains + buses on one screen · leave-by line · Divvy · Metra row · approach track · custom clock digit styles (Chunky, Outline) · timeline strips · merging short-turns into their direction's row with a marker · tap-to-switch via onboard accelerometer · I2C rotary encoder · ambient light sensor · big-number bus layout (route number left, name + times right; tried and declined in favor of the standard rows) · first-train time under the overnight clock (needs CTA GTFS schedule) · CTA alert headline scroll (cut to minimize animation) · full-screen CTA alert text screen (cut; indicators only) · CTA-style alert circle after the destination name on the ticker (declined: collides with long names and two-digit times) · blinking/alternating clock colon (cut to minimize animation) · transit row scrolling/paging for 6–7 destination stations (post-v1) · Bluetooth WiFi provisioning from the phone · run numbers in line color on chronological rows (declined: the color block scans faster, and Brown/Purple read dim as thin strokes) · `MIN` suffix on chronological rows (declined in favor of lowercase `m`) · per-pixel rain/snow from MRMS `PrecipFlag` (GRIB2; replaces the v1 temperature heuristic if the decoder fits in memory).

---

## 14. Skyline screen (designed, not built)

Designed Oct 17, 2026. An ambient weather screen: the skyline seen from the lake across Navy Pier, with the Centennial Wheel front and center, drawn for the current weather and time of day. Mockups: [`mockups/weather/lake/`](mockups/weather/lake/sheet.png) (`sheet.png` has every state, `options.png` the settings, `night-motion.png` the animation), made by `node scripts/mock-weather-lake.js`, which is also the pixel reference for everything below. Not in `draw.js` yet.

### View
- The viewer is on the lake on Navy Pier's axis (41.8917, -87.590), facing west. Each landmark's x is its real bearing at 1.3 px per degree (pier axis = x 32). Heights are real angular heights at 2.4 rows per degree, about 1.8× vertical exaggeration.
- Rows 0–26 are sky and city (the shore is row 26); rows 27–31 are the lake.
- Left to right: Willis (far left and small, since it's 4 km away), Aon, St. Regis (the closest supertall, so it looks tallest, as in photos from the lake), Trump, Lake Point Tower (directly behind the wheel), Hancock. Background mass fills the gaps: the Loop on the left, Streeterville on the right. Only Willis and Hancock are drawn to be recognized; the rest are plain slabs, to keep the focal points few.
- **Willis** is seen from the southeast, so its setbacks step down to the right (floors 66 / 108 / 90 / 66, 1 / 4 / 2 / 2 px wide). From due south only one setback shows, and it reads as a generic tower.
- **Hancock** has symmetric 4-6-8 px steps around x 53 and twin antennas of equal height. With the clock on, the antennas are 2 rows shorter so the clock fits above the beacons.

### Buildings and lights
- Every building, background included, and every antenna mast is unlit (black) day and night. By day they're a silhouette against the sky; at night only the windows draw the city.
- **Night windows:** 45% of window slots (even columns, odd rows) are lit, 30% of those bright amber `#ffb050`, the rest `#8a5c20`. Background mass gets windows only right of the wheel. No windows around the pier (x 19–44, rows 20 and below) or behind the wheel, so the pier's string lights are the only amber there.
- **Hancock beacons:** red, night only, pulsing together (a smooth 4 s fade to near off). Not a hard blink, since a red 1 s blink means a tornado warning (§2).

### Centennial Wheel and Navy Pier
- **Wheel:** a 12 px hard-edged rim (rows 12–23) centered on the x 32 pixel boundary, a 2×2 hub, A-frame legs from the hub to the pier (feet 5 px either side of center), and a crossbar on row 25. No spokes and no gondolas: the rim on its A-frame is what reads as the wheel. Hard edges throughout.
- **By day** the wheel takes the color with the most contrast against what's behind its upper rim, clouds included: grey `#8a92a2` on blue or dark skies, light `#dce0e6` on mid greys, dark `#262a32` on bright skies.
- **At night** the rim is rainbow LEDs, the hues turning around it once every 12 s; legs and hub dim `#4a4a66`.
- **Pier:** a flat deck 8 px either side of the wheel's axis (x 24–39): a lit top row (`#6a6460` by day, `#2a2834` at night) and a darker face on row 27. At night, string-light bulbs every 3 px (x 24, 27 … 39) in `#c09050`.
- Also tried and declined: flags on the pier, the Grand Ballroom dome, a pier running toward the viewer in perspective, gondolas, 6 or 8 spokes, a soft-edged rim.

### Sky
- **Sun:** a 7 px soft-edged disc `#ffd040` at x 38–44, rows 2–8 (between the wheel and the clock).
- **Sunset:** the sun sets behind the skyline, hidden by the buildings, placed by the day's sunset bearing (left of the wheel in winter, right of it in summer; the mock shows summer), with a glitter path on the water below it.
- **Moon:** the same spot and size, `#a89c70` (kept dimmer than the clock), at its real phase, with soft edges.
- **Stars:** 14, about half twinkling (4, 6 or 12 s cycles). They stay off the buildings, the label corners and the moon, and at least 3.5 px clear of the wheel's rim (a star beside the rim read as part of the wheel).

### Water
- A two-color gradient with faint ripple dashes drifting sideways, alternate rows in opposite directions, 1 px every 1.5 s.
- **Reflections are optional, off by default** (per board). When on, rows 22–26 are mirrored into the lake, with fixed 1 px offsets alternating by row and a few fixed gaps. Reflections never move (moving ones read as blinking lights); only the ripples do. The wheel's rim reflects as plain structure, not as its changing rainbow.

### Temperature and clock
- Temperature top left (from x 0), clock top right (flush to x 63), Tom Thumb, label white `#d8d8d8` when lit. The clock is optional (default on). No drop shadows.
- **Text mode** (per board):
  - **Auto** (default): each block (temperature, clock) checks the average brightness of the sky behind it and uses unlit (black) digits on a bright sky, lit digits on a dark one. Hysteresis keeps drifting clouds from flipping it: dark above luma 120, back to lit below 100. The two blocks decide independently.
  - **Lit, top:** the wisps fade out near the two top corners so the text stays on clear sky.
  - **Lit, bottom:** over the water (baseline 32). Always readable, and the sky is entirely free.

### Weather states

| State | Look |
|---|---|
| Clear day | blue gradient, sun |
| Partly cloudy | wisps over the blue: noise stretched ~10× wider than tall, cut into two flat white tints (35% and 70%), down to row 16 |
| Mostly cloudy | denser wisps down to row 20, blue still showing (not overcast) |
| Overcast | a full textured deck: noise, lighter where thin, darker where thick, lighter toward the horizon |
| Rain | a darker deck, 2 px slanted blue streaks |
| Snow | grey sky, flakes, snow on every roof edge and on the pier |
| Fog | the city fades into the fog with height; tower tops disappear |
| Sunrise | pastel blue to peach; no sun (it rises behind the viewer, over the lake) |
| Sunset | purple to orange, sun setting behind the buildings, lit cloud bands, glitter path |
| Twilight | deep blue, city lit, a few stars |
| Clear night | stars, moon, city lit |
| Partly cloudy night | city-lit wisps (`#4a4048`) across the moon |
| Overcast night | warm grey deck (the city's glow on the clouds) |
| Rain night | dim streaks over the lit city |
| Snow night | pink-orange sky (streetlight glow on snow clouds), flakes, grey roof edges |
| Fog night | windows and wheel through the fog, beacons on top |
| Thunderstorm | dark deck, rain, and pixel-art lightning striking the Trump roof: a 1 px white core stepping down with sideways jogs, flat violet edges, one branch; no glow or sky flash |

Also tried for clouds: puffy cumulus (soft-edged, then pixel art with three flat tones; both declined), broken cirrus streaks (declined: they read as dashed lines), and soft-edged wisps (the alternative to the two flat tints).

### Animation
Ambient and slow, on a 100 ms tick:

| Element | Motion |
|---|---|
| Wheel rim (night) | rainbow turns once every 12 s |
| Beacons (night) | pulse, 4 s |
| Stars (night) | twinkle, 4–12 s |
| Water | ripples drift 1 px every 1.5 s |
| Clouds | drift 1 px every 4 s |
| Rain, snow | fall (speeds not designed yet) |

- This screen is the exception to Minimal animation (§2): it has no times to protect. Each fetch freezes it for about a second; fetches still go in the scheduler's gaps.
- Cost on the board: about 50 pixels per tick (rim, stars, beacons) and about 320 every 1.5 s (water).

### Board requirements
- Buildings stay true black (LEDs off) and are exempt from the brightness floor (§4). Everything else keeps its floor through the ~40% overnight dimming, so the scene around the buildings never goes dark.
- Closest to the floor: the top of the night sky (`#000006`, effectively off already), night water ripples (`#0e1a36`), and the dim window amber (`#8a5c20`).

### Open
- On the panel: whether 3×5 unlit digits survive the diffuser glow (§4: dark strokes on lit fill in). Sunset will likely need dark digits once seen on the board.
- On the panel: the near-floor colors above, and whether the moon is dim enough.
- Moon crescents: a plain sliver, earthshine (the unlit part as a faint disc, likely lost to overnight dimming), or a brightened sliver.
- Mapping Open-Meteo weather codes, `is_day` and the sunrise/sunset times to the states, and how long twilight lasts.
- The payload (state, sun bearing, moon phase, temperature) and the renderer's memory cost on the board.
