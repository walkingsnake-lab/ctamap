# CTA LED Board: Design Spec

Adafruit Matrix Portal driving a 64x32 HUB75 RGB matrix. Decisions from the design sessions of Oct 2–4, 2026. All mocks used made-up train times unless noted.

---

## 1. Hardware

| Item | Notes |
|---|---|
| Panel | 64x32, 4mm pitch, HUB75. Black acrylic diffuser recommended. |
| Controller | **Decided: Matrix Portal M4** (starter kit, purchased Oct 3, 2026; includes panel, diffuser, 5V 2.4A supply). 192 KB RAM, WiFi via ESP32 co-processor over SPI: keep JSON payloads small, use PCF fonts, fetch only between animations. |
| Input | **Phone/web control** (primary, see §10) plus, on the S3, a **knob** (Adafruit 5880 rotary encoder on STEMMA QT; see §10, *Knob*) to switch screens. The built-in UP/DOWN buttons still work where the case leaves them reachable. |
| Power | Kit supply is 5V 2.4A; panel can draw ~4A all-white. See §9. |

---

## 2. Architecture

- **The existing fly.dev server (from the CTA map project) does all fetching and formatting.** The board only draws what it receives.
- The server chooses the layout (row count, alerts, destination rows vs. chronological transit view) and sends compact JSON plus small indexed images (radar frames, ~2 KB each).
- Optional shared token on board endpoints (`BOARD_TOKEN` Fly secret) to keep randoms off the CTA quota.

### Minimal animation
Animation was deliberately limited on the M4 so its network pauses (CircuitPython is single-threaded, and each HTTPS request through the M4's WiFi co-processor blocks the display for roughly a second or more) were invisible. On the S3, requests run on the other core (see *Scheduler*), so nothing pauses; the list below is still the whole set of animations, and anything marked S3 doesn't exist on the frozen M4:
- **Per-digit roll** when an arrival time changes, and the same roll for the **header clock** (transit, ticker) and the radar's **current time** at each minute. Only the changed digits move while the clock keeps its shape; a width change (`9:59`→`10:00`) rolls the whole clock. Nothing rolls across a screen change. The radar's frame time doesn't roll. Clock minute rollovers count as animations for the scheduler. Reference: `createNumRoller()` in `server/board/draw.js`.
- **S3:** the big overnight and no-games clocks roll too, and so do current-conditions numbers when a new payload changes them: the weather strip's temperature, and on the weather screen the big temperature, feels-like, high/low, rain chance, and the top bar's temperature. Forecast columns and the radar corner don't. (The M4 skipped these for memory.)
- **Transit transitions:** a departing train fades out in place, the next time eases to amber, and rows fade in/out and slide (all under 1.2 s, at the same moments as digit rolls).
- **Screen change (S3):** a change made with the **knob or the buttons** slides: the new screen pushes the old one's last frame off sideways over 0.45 s (ease in-out), with a 4px unlit gap between them, in the direction of the input (knob: the way it turned; UP comes in from the left, DOWN from the right, wrap included). **Any other change** (the phone, the auto rotation, leaving a status screen) fades: the old frame to black over 125 ms, then the new screen in over 125 ms. A change during a transition starts from the frame on the panel (no snap), and a slide that interrupts one runs in 0.25 s, so presses in a row read as one fast run. Status screens and the chooser itself appear at once, cutting any transition short (a turn should answer immediately). Reference: `slideFrames()` and `fadeFrames()` in `draw.js`, `Board::shown()` in `firmware-s3/ctaboard/src/app.cpp`.
- **Tornado warning blink** on the weather strip and weather screens: 1 s on, 1 s off. (CTA line alerts are static: see §5.)
- **Ticker page slide.**
- **Radar loop.**
- **Knob chooser slide** (S3; §10, *Knob*): 180 ms per click, only while someone is turning the knob.

No blinking colons and no alert text screens anywhere. Alerts are shown only as indicators (see §5, §6, §7). Scrolling text is avoided by preference, not ruled out: the announce screen's credits roll (and the planned crawl) scroll (§15).

### Scheduler (board main loop)
**S3:** the board's requests run on a network task on core 0 (beside the WiFi stack) while the loop keeps drawing on core 1 (`device::NetWorker`, `app::Worker`). One request is out at a time; jobs simply run when due, and nothing on the panel waits for them. A request still out after 45 s (`WORK_STUCK_MS`) stops the loop feeding the watchdog, which restarts the board, so a hung TLS read can't leave stale times up forever. The S3 keeps its HTTPS connection open between requests, so most skip the TLS handshake. If the worker fails to start, requests run inline and pause animations while they're out; the S3 doesn't fit them into gaps.

On the M4, a small cooperative scheduler lines up network requests with animation gaps:
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
| Weather | WeatherAPI.com (`WEATHERAPI_KEY`, free plan; one fetch per 0.1° grid cell) | Current temp, condition, `is_day`, feels-like, wind, sunrise/sunset. No 15-minute data, so no rain bars. Credit and disclaimer on the control page. |
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
- **Coverage** (Tom Thumb and 5x7): printable ASCII, Latin-1 (accented letters, `°`, `£`, `¿`, …), and the punctuation phones substitute (curly quotes, en and em dashes, `…`, `•`, `€`). Tom Thumb lacks curly quotes and dashes, so its quotes are copies of the straight ones and its dashes are 4px and 5px bars. X11 5x7 fits most accented capitals into the 7-row cell by dropping the accent (É draws as E; Ä and Å keep theirs); the lowercase keep theirs. The frozen M4 has ASCII only.
- Codepoints for custom glyphs are in `server/board/glyphs.js`. The fonts are built by `scripts/build-fonts.js` into `server/board/fonts/` (BDF); the board build converts them to PCF.
- X11 **9x15 Bold** for the large overnight clock, with a custom **2x2 square-dot colon** centered on the 10px digit height (the stock X11 colon is drawn for text and drops a pixel below the digits).
- **VCR** (8x11, `vcr`): digits, colon and space only, for the clock screen's seventies face (§16). Redrawn after **VCR OSD Neue** by Elli Sho (dafont, 100% free; the author asks for credit, given in the control page's footer): 2px strokes, one-pixel cut corners, slashed zero. Tabular 8px digits with a 2px gap; the colon is 2x2 dots on digit rows 2-3 and 7-8.

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

- **Global brightness:** 100% sunrise to sunset, ~40% overnight (times from WeatherAPI); the night level is set per board on the phone. An S3 with the optional light sensor (VEML7700) follows the room instead, from full down to the night level (§10). Every dim element has a **minimum floor** so it never drops to black at night.
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
- **Overnight / no predictions: the owl** (CTA calls its overnight service Owl). A 13x15 pixel-art owl (`OWL` in `server/board/icons.js`) sits at x 2 on a solid `#4a4a4a` line across row 31 (row 25 with the weather strip on), feet on the line. The large **9x15 Bold** clock (`#cccccc`, 2x2 square colon) and the dim `NO TRAINS` label are centered in x 16–63 (clock top on row 5, or 3 with the weather strip). On the S3 the owl mostly sits still, blinks (150 ms) now and then and glances right once in its ~11 s cycle, on the icon clock; the board redraws only when its frame changes. No hard on/off rhythm, since a 1 s blink means a tornado warning. `NO DATA` looks the same apart from the label. The frozen M4 keeps the plain centered clock. Mockups of the alternatives: `docs/board/mockups/no-trains/`.
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
- **Weather layout** (WeatherAPI, forecasts from NWS; exact pixels in `contract.md`, Radar; redesigned Nov 1, 2026): the 5-day layout's top bar (icon, temperature, `↑63 ↓49`; a watch or warning takes over the high/low), then a readout with dot leaders, labels grey and values in color: `SKY` (the condition word, colored by kind), `FEELS` (on the temperature scale), `WIND` (`NW 12 MPH`), and `RAIN` (blue) only while there's a real chance: shown from 20 %, hidden again below 10 % (a buffer so it doesn't flicker). With three lines they take the 5-day's row rhythm. The frozen M4 keeps the old big-temperature layout. Mockups: `docs/board/mockups/weather/readout/` (`pick.png`), with the rejected rounds in `conditions/`, `conditions-r2/`, `bignum/` and `styles/`. Preview: `docs/board/previews/mock-weather-screen.png`.
- **Hourly layout** (`wxView` `hourly` on the phone): today's top bar, then the weather 2, 4, 6 and 8 hours ahead in four columns (time, icon, temperature). With rain bars on (`wxRain`), it's the dry state. Preview: `docs/board/previews/mock-weather-hourly.png`.
- **Rain bars** (per board, `wxRain` on the phone: Radar loop, Rain bars (never the loop), or Both: the radar loop plays 1, 2, 3, or 5 full loops, then the bars show for 10–60 s, repeating while the radar box and the forecast both have rain): while rain or snow is falling or due in the next 2 hours, the weather screen shows today's top bar (as in the 5-day layout), a title (`RAIN IN 25 MIN`, `RAIN NEXT 2 HRS`, `ENDS IN 60 MIN`, `BREAK IN 30 MIN`, or `SNOW …`) with a drop or flake standing in for the word on titles that don't say RAIN or SNOW (`ENDS IN`, `BREAK IN`), and eight 15-minute bars on a fixed square-root intensity scale in three blue (or grey, for snow) levels, `1H` / `2H` under the axis. Dry, it shows the conditions, 5-day or hourly layout. Preview: `docs/board/previews/mock-weather-rain.png`.
- **Top bar warnings** (5-day, hourly and rain bars): the temperature shadow follows the board's setting, and an NWS watch or warning takes over the high/low line (glyph + `WATCH` / `WARN`; a tornado warning blinks); the layout below it stays.
- **5-day layout** (per board, `wxView` on the phone: Conditions or 5-day): today on top (icon, then the temperature in 5x7 white with a 1px shadow in its temperature color, the high and low right as `↑63 ↓49` with dim arrows), then the next five days in 13px columns split by thin vertical dividers: two-letter weekday, icon, and the high colored blue (cold) to red (hot). A watch or warning switches back to the conditions layout while it's on, since only that has a line for it. Preview: `docs/board/previews/mock-weather-5day.png`.
- **Configurable location**; crop centered on it (~1.5 mi/pixel).
- **Pipeline (server):** crop → palette index to dBZ → average linear reflectivity per LED block → levels (15/25/35/45/55 dBZ: dim green, green, yellow, orange, red) → despeckle (drop pixels with <2 colored neighbors) → small indexed image.
- **Snow (v1):** the whole frame switches to a 3-level snow palette (light blue, pale blue, white) when WeatherAPI reports snow (or thundersnow), or ≤ 32°F without freezing rain. Snow gets its own thresholds (provisional 10/15/20 dBZ, from the Feb 2, 2022 storm) because dry snow reflects much less than rain. A rain/snow line inside the box, and mixed precip, render as one type. Details in `contract.md`.
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
- **Screen:** Auto, Transit, Ticker, Weather (radar while raining), Baseball, Clock (S3 only; face per board, §14). Auto settings (defaults reproduce the original behavior):
  - **Auto shows:** Transit and/or Ticker; with both, they alternate every 30 s–10 min (default: Transit only).
  - **Weather visits:** Off (default), While raining, or Always; every N min for M s.
  - **Jump to weather for NWS alerts:** Off (default), Warnings, or Watches too; stays on the weather screen while the alert is on, over baseball.
  - **Baseball takes over for:** Cubs, White Sox, Postseason (default all); pregame window 0–2 h (default 30 min), final 0–60 min (default 15); during live games show live games (default), Cubs/Sox first, or all games.
- **Brightness:** Auto, fixed level, or Off. Auto is full by day and has a **Night** level (default 40%). On a board with the light sensor, Auto follows the room instead, from full in a bright room to the **Dark room** level (the same setting): linear in log lux between them, moving only once a change has lasted 5 s (a passing shadow doesn't dim it), then fading over 2 s. The phone's Fixed and Off still win. Health shows the sensor's reading, for tuning the lux end points in `light.h`.
- **Temperature unit:** °F (default) or °C, per board, for every weather display (weather strip, weather screen, radar corner). The server converts; temperature colors still follow the °F scale. Wind stays mph.
- **Station and destination filter:** per-board config, editable instead of hardcoded. Default station: Morse. The station's coordinates are also the board's location for weather, NWS alerts, and radar.
- **Destination filter UI:** "All destinations" on by default. Turned off, it lists every destination the station's lines can show (including rush-only ones not running now, so a filter set off-peak doesn't hide Purple at rush), with checkboxes and up/down ordering. Picking a new station resets the filter to all.
- **Live preview** of what the board is showing at the top of the page (refreshes every 10 s and after each change).
- **Transit layout:** station on top (header) or key on top (station line at the bottom). **Header and weather strip:** independent on/off toggles per board (see §5 for how many rows each combination fits; the key layout has no weather strip).
- **Header clock** (transit and ticker) on/off, and **destination names** in white or the line's color (Brown and Purple read dim as text in their true colors).
- **Time dim steps** (Transit): the third arrival time at 20% instead of 40% (default off).
- **Board health:** last report, uptime, free memory (and lowest), skipped frames, failed fetches, reconnects, restarts, last error, WiFi signal. Sent by the board with the version check about once a minute, so problems show without a USB serial console.

### Behavior
- **Latency:** the board checks `/board/version` about every 10 s (on the M4, scheduled in animation gaps, see §2) and fetches the full update right away when the version changes. Phone changes show up within ~10–15 s.
- **The chosen screen is permanent:** Auto, Transit, Ticker, Weather, or Baseball stays until changed on the phone, including across board restarts. A forced screen ignores the auto rules (no baseball takeover, no radar visits); forced Baseball with no game on shows the clock and `NO GAMES`. On boot the board sends a boot flag on its first request; the server resets **brightness** to Auto (so a board left off comes back lit) and bumps the version. Screen, station, and filter config persist across restarts.
- **Persistence:** state lives in a small JSON file on a Fly volume, so deploys and server restarts don't wipe config.
- **Buttons vs. phone: last action wins.** A button press sets a local override and records the current server version. The local override holds until the server version changes (a phone change), then the board follows the server again.
- **Watchdog:** the board's hardware watchdog (16 s, the M4's maximum) resets it if the loop hangs. The loop feeds it every pass and before each request. A watchdog reset is not a cold boot, so it doesn't reset brightness.
- Possible optimization to test on the board: keep the HTTPS connection open between requests to avoid repeating the TLS handshake, which would make version checks nearly free.

### Knob (S3)
Decided Oct 25, 2026. An Adafruit 5880 I2C rotary encoder (seesaw, on the STEMMA QT port) is the board's physical control: the bar sleeve case covers the S3's UP/DOWN buttons. The buttons still work where they're reachable (wedge), and a board without the knob runs as before. Mockup: [`mockups/knob/sheet.png`](mockups/knob/sheet.png) (`node scripts/mock-knob.js`, drawn by `renderChooser` in `draw.js`).

- **Ring:** categories, not screens, so it stays short as screens are added: **AUTO · TRANSIT · WEATHER · SPORTS**, wrapping both ways. The server sends the ring (payload `knob`), so new categories need no firmware change; CLOCK joins with the Clock screen (§14) and opens the board's chosen face, then ANNOUNCE with the Announce screen (§15) (v2 plan: one Sports category over every league, the leagues and teams set on the phone). Each category opens its variant as set on the phone: TRANSIT opens rows or the ticker, whichever was chosen last (the ticker becomes a transit view mode on the phone page); SPORTS opens the baseball screen.
- **Twist and rest:** the first click opens the chooser on the screen the board is on, and each click moves one entry (clockwise to the right), with a 180 ms ease-out slide. 1 s after the last click it commits: the selection turns amber and its neighbors drop out, held through one request, then the new screen appears. Resting back on the starting entry closes the chooser with no request (cancel).
- **Look:** a blank panel with a sideways wheel across the top. The selection is 5x7 label white `#d8d8d8`, centered on baseline 7; its neighbors are Tom Thumb 38 px either side, fading to `#555555` with distance and clipped at the panel edges. Row 9 has one 3x1 pip per entry, 2 px apart, centered: the selection amber, the rest `#3a3a3a`. Rows 10–31 stay dark. (Also mocked: a two-level chooser with a press into each category's variants, rejected as too complex; an underline that drains during the rest; pips at the bottom; the wheel over the dimmed screen.)
- **Writes through:** the commit is `POST /board/select`, which sets the screen on the server as the phone would (it persists, the phone page shows it, and it ends any button override) and answers with the new screen's update, so a commit is one request.
- **Press:** does nothing yet; to be decided.
- **Scheduling:** while the chooser is open only overdue requests run. The encoder counts clicks itself, so turns made during a request arrive after it, not lost.
- **Settings:** `KNOB_REVERSE` in `secrets.h` flips the direction (saved to flash by a setup build; see *OTA updates*).
- **Open:** on the panel, whether the 1 px `#3a3a3a` pips and the `#555555` neighbors survive the diffuser and the night floor; confirm one count per detent and the direction on hardware.

### OTA updates (S3)
Decided Oct 30, 2026, with more boards and other owners in mind: nobody should need the Arduino IDE after the first USB flash.

- **Settings in flash, not in the build.** WiFi networks, server, board ID, token, and panel tuning live in the board's NVS. A **setup build** (compiled with `secrets.h`, flashed over USB once) saves them; the **generic build** (no `secrets.h`) reads them, so one build runs on every board and carries no secrets. A board with no settings shows `NO SETUP`.
- **Pull from the server**, not a LAN push (ArduinoOTA): works wherever the board has WiFi, hotspot and work networks included, over the HTTPS and token it already uses. The server stores uploaded builds; `/board/version` offers a board the build it should run; the board downloads it into its unused app slot (the default TinyUF2 partitions have two 2 MB slots), checks its SHA-256, and restarts into it.
- **Channels:** `beta` and `stable`. Each board follows one, is pinned to a build, or is off (control page, Board tab). The owner's boards go on Beta; a build moves to Stable once it has run well there. Updates are automatic: owners who never open the control page still get fixes.
- **Install moment:** in an animation gap (or after waiting 2 min); the panel shows `UPDATING` and the percentage. It takes 10–30 s.
- **Trial and rollback:** the new build is kept once it has had a good update and run a minute; it rolls back to the previous slot if it can't reach the server within 5 min or restarts more than 3 times first, and isn't reinstalled until the control page's Try again. Rolling back is done by the firmware itself (the Arduino core marks every new build valid at boot, so the bootloader's own rollback never triggers).
- **Left alone:** boards running `dev` or `_dirty` builds (someone's test build); the M4.
- **Signed (Oct 31, 2026):** builds are signed with a key only the owner's computer and a main-only GitHub environment hold; the server and the board each check the signature, so a compromised server can't push firmware. CI signs and publishes each build of `main` to Beta with a deploy token that can do nothing else.
- **Later (some done since):** CI publishing straight to Beta (today CI builds the generic `.bin` as an artifact and the owner uploads it); a browser-based first install with WiFi entry (ESP Web Tools + Improv), so a new owner needs no IDE at all; per-board tokens before boards of different owners share one server (today every board shares `BOARD_TOKEN`).

### Boards for other people (keys and WiFi setup)
Decided Oct 31, 2026.

- **Own token, own link:** a board for someone else gets its own token (a buyer could read a shared token out of flash) and a control link, `/board/c/<link>/`, that controls only that board: no other boards, firmware builds, logos, or keys; updates Automatic or Off. The maker's boards keep the shared token. Issued from the control page (Board tab → Owner link), which writes the board's `secrets.h` block.
- **WiFi without USB:** the board opens its own network (`SETUP WIFI` and the name on the panel; WPA2, password on the label as a WiFi QR) with a setup page every address leads to. Chosen over Improv/Web Bluetooth because iPhones can't do Web Bluetooth. Opens with no networks saved, after 10 min joining none, after a just-entered network fails, or when the knob is held at power-on; closes after 15 min with no phone on it when it has networks to retry.

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
- Measure the real fetch time on the M4 to set its scheduler's fetch budget (the S3 reports its average request time as `hb`).
- On-panel check: lowercase `m` legibility (diffuser glow between the humps), and whether `4m` needs a 2px gap.
- Chronological view: whether it flips too often at short-turn stations (if so, raise `CHRONO_HOLD`).

### Sports screens beyond baseball (mockups, not built)
Same frame as the baseball Bands layout: 12-row team-color bands (abbreviation left, score centered at x30), divider row 24, bottom line on baseline 31, status panel right. Pregame: records in the panel, `TODAY` (or the day) bottom left, start time bottom right. Final: winner's score amber, records in the panel, `FINAL` bottom right.

- **NFL** ([mockup](mockups/nfl.png)): panel = quarter (`Q3`, Tom Thumb) over the game clock (5x7). Possession = small amber football inside the band between abbreviation and score. Bottom line = down and distance left (`2ND & 7`; amber in the red zone, e.g. `1ST & GOAL`), ball spot right (`GB 35`); the longest case still fits (35 + 17 px).
- **NBA** ([mockup](mockups/nba.png)): panel = quarter over the clock; under a minute the clock shows tenths (`38.4`, amber). `HALF` replaces both at halftime. Bottom line = a scoring run in amber (`CHI 8-0 RUN`) or timeouts left (`TO 2` ... `TO 1`). Three-digit scores fit the score box. Final shows `FINAL/OT` for overtime.
- **Data:** no free official API like MLB's; ESPN's unofficial scoreboard JSON is the usual source (free, undocumented, can change).

## 13. Parked ideas

**Bus screen** (cut from v1: needs a separate Bus Tracker API key; was 96/155 at Morse with grey `#8a8a8a` row blocks, westbound only since both start at Morse) · separate board location independent of the station · Cubs/Sox scores (16x16 logos from a sprite sheet, personal use) · trains + buses on one screen · leave-by line · Divvy · Metra row · approach track · custom clock digit styles (Chunky, Outline) · timeline strips · merging short-turns into their direction's row with a marker · tap-to-switch via onboard accelerometer · I2C rotary encoder · big-number bus layout (route number left, name + times right; tried and declined in favor of the standard rows) · first-train time under the overnight clock (needs CTA GTFS schedule) · CTA alert headline scroll (cut to minimize animation) · full-screen CTA alert text screen (cut; indicators only) · CTA-style alert circle after the destination name on the ticker (declined: collides with long names and two-digit times) · blinking/alternating clock colon (cut to minimize animation) · transit row scrolling/paging for 6–7 destination stations (post-v1) · Bluetooth WiFi provisioning from the phone · run numbers in line color on chronological rows (declined: the color block scans faster, and Brown/Purple read dim as thin strokes) · `MIN` suffix on chronological rows (declined in favor of lowercase `m`) · per-pixel rain/snow from MRMS `PrecipFlag` (GRIB2; replaces the v1 temperature heuristic if the decoder fits in memory) · animated weather icons (built for the S3 and removed Nov 1, 2026: rain falling, clouds drifting, rays and stars twinkling, a flickering bolt; none of them looked right on the panel, so weather icons are always static).

---

## 14. Clock screen: skyline face (designed, not built)

Designed Oct 17, 2026; revised for the S3 Oct 31, 2026. An ambient clock face: the skyline seen from the lake across Navy Pier, with the Centennial Wheel front and center, drawn for the current weather and time of day. Mockups: [`mockups/weather/lake/`](mockups/weather/lake/sheet.png) (`sheet.png` has every state, `night-motion.png` the animation), made by `node scripts/mock-weather-lake.js`. The mock is the pixel reference for the scene; where it differs from this section (text at the top, Auto text mode, reflections, the fixed sunset spot), this section wins. Drawn by `draw.js` `renderSkyline` (clouds still to come).

**Clock screen.** A new screen, `clock`, added beside Transit, Ticker, Weather and Baseball (no v2 screen framework needed). Its look is a per-board **clock face** option (`clockFace` on the phone): `skyline` first; analog, split-flap and nixie join as they're built. The knob ring gets CLOCK, which opens the chosen face. Auto never shows Clock (for now); it's chosen directly, from the phone or the knob. The skyline face still shows the weather (state and temperature); it just lives under Clock rather than Weather.

**S3 only.** Rendering features go only into `firmware-s3/` (the M4 is frozen), so the scenarios are tagged `s3only`. The phone page doesn't offer Clock for a board whose health reports M4 hardware, and the server never sends `clock` to one (it falls back to Transit), since the frozen M4 doesn't know the screen.

### View
- The viewer is on the lake on Navy Pier's axis (41.8917, -87.590), facing west. Each landmark's x is its real bearing at 1.3 px per degree (pier axis = x 32). Heights are real angular heights at 2.4 rows per degree, about 1.8× vertical exaggeration.
- Rows 0–25 are sky and city (the shore is row 25); rows 26–31 are the lake. Row 26 is a row of open water between the skyline and the text (rows 27–31), so the two never touch.
- Left to right: Willis (far left and small, since it's 4 km away), Aon, St. Regis (the closest supertall, so it looks tallest, as in photos from the lake), Trump, Lake Point Tower (directly behind the wheel; its top shows 2 rows above the rim, rows 9–10, a short black block that frames the wheel), Hancock. Background mass fills the gaps: the Loop on the left, Streeterville on the right. Only Willis and Hancock are drawn to be recognized; the rest are plain slabs, to keep the focal points few.
- **Willis** is seen from the southeast, so its setbacks step down to the right (floors 66 / 108 / 90 / 66, 1 / 4 / 2 / 2 px wide). From due south only one setback shows, and it reads as a generic tower.
- **Hancock** has symmetric 4-6-8 px steps around x 53 and twin antennas of equal height, at full height (the text no longer sits above them).

### Buildings and lights
- Every building, background included, and every antenna mast is unlit (black) day and night. By day they're a silhouette against the sky; at night only the windows draw the city.
- **Night windows:** 45% of window slots (even columns, odd rows) are lit, 30% of those bright amber `#ffb050`, the rest `#8a5c20`, from a fixed seed so the pattern never changes. Background mass gets windows only right of the wheel. No windows around the pier (x 19–44, rows 19 and below) or behind the wheel, so the pier's string lights are the only amber there.
- **Hancock beacons:** red, night only, pulsing together: a smooth 4 s cosine between dark red `#401010` and bright red `#ff2020`, never off. Not a hard blink, since a red 1 s blink means a tornado warning (§2).

### Centennial Wheel and Navy Pier
- **Wheel:** a 12 px hard-edged rim (rows 11–22) centered on the x 32 pixel boundary, a 2×2 hub, A-frame legs from the hub to the pier (feet 5 px either side of center), and a crossbar on row 24. No spokes and no gondolas: the rim on its A-frame is what reads as the wheel. Hard edges throughout.
- **By day** the rim is white and the frame (legs, hub, crossbar) a darker grey, so the two read apart: rim `#dce0e6` with frame `#565c68` on blue, dark or mid-grey skies; rim `#eef0f4` with frame `#4a505c` on mid greys; all `#262a32` on bright skies (fog, snow). Clouds drift, so the server picks the color once per cloud strip from the strip's average over the rim rows; it doesn't change as clouds pass.
- **At night** the rim is rainbow LEDs, soft and slow: soft hues (saturation 70%, value 90%) turning around it once every 30 s, smoothly (the panel redraws the skyline 20 times a second); legs and hub dim `#4a4a66`. The rim, beacons and pier bulbs switch on when the sun drops below 0.5° (the real wheel lights at dusk).
- **Pier:** a flat deck 8 px either side of the wheel's axis (x 24–39): a lit top row on row 25 (`#6a6460` by day, `#2a2834` at night) and a darker face on row 26. At night, string-light bulbs every 3 px (x 24, 27 … 39) in `#c09050`.
- Also tried and declined: flags on the pier, the Grand Ballroom dome, a pier running toward the viewer in perspective, gondolas, 6 or 8 spokes, a soft-edged rim.

### Sky
- **Sun (day):** a 7 px soft-edged disc `#ffd040` at x 38–44, rows 2–8.
- **Sun (sunset):** drawn behind the city, low on the skyline, at the day's sunset bearing. Real bearings run from about 238° (December) to 302° (June), which at the skyline's 1.3 px per degree would put the sun off the panel at both ends, so the sun has its own scale: x = 32 + (bearing − 270) × 0.8, which spans x 6–58 over the year. Left of the wheel in winter, right in summer.
- **Moon:** the day sun's spot and size, `#a89c70` (kept dimmer than the text), at its real phase, with soft edges. Shown all night whenever at least 3% is lit; it ignores moonrise and moonset (a deliberate simplification).
- **Stars:** 14, about half twinkling (4, 6 or 12 s cycles). They stay off the buildings and the moon, out from between the Hancock antennas (a star there blurred what they were), and at least 3.5 px clear of the wheel's rim (a star beside the rim read as part of the wheel). Bright ones are a soft `#a8aebc`, not white; dim ones `#5a6070`.

### Water
- A two-color gradient with faint ripple dashes drifting sideways, alternate rows in opposite directions, 1 px every 1.5 s.
- **Glints:** single water pixels under the sun (day, sunset) or the moon (night) brighten for 200 ms, 1–3 at a time, in a band 5 px either side of the sun's or moon's x (sunset: the glitter path, `#ffd080`; day: `#c8d8f0`; moon: `#a89c70`, scaled by the lit fraction). Positions and timing come from a hash of the tick, so `draw.js` and `draw.cpp` agree.
- Ripples and the glitter path stay out of the text boxes plus 1 px, so nothing moves beside the digits. A winter sunset (sun at x 6) puts the glitter path under the temperature, where it's hidden; accepted.
- Reflections: dropped for now (they'd sit under the text). Mocked in `options.png` if revisited.

### Temperature and clock
- Always at the bottom, over the water (baseline 32, rows 27–31), in lit white `#d8d8d8`, Tom Thumb. Temperature from x 0; clock flush to x 63. No drop shadows, no AM/PM (as on the other clock faces).
- Widest cases, measured with `fonts.js`: `-12°` / `100°` 14 px (x 0–13), `12:59` 17 px (x 46–63). The pier sits on rows 25–26, above the text. (One line in the top left was also mocked, `topleft.png` and `topleft-dim.png`, and declined.)
- The clock is always on: this is a clock face. Temperature is always on too.
- **Watches and warnings** replace the temperature (the clock stays): the glyph (bolt for severe thunderstorm, funnel for tornado), 3 px, then `WATCH` or `WARNING`, in the warning colors (watch yellow `#ffd800`, severe warning orange `#ff8000`, tornado warning red `#ff2020`, blinking 1 s on, 1 s off as everywhere, §2). The widest, the funnel + `WARNING`, is 36 px (x 0–35), still 10 px clear of the widest clock. Mockup: [`warnings.png`](mockups/weather/lake/warnings.png).

### Choosing the state
The server picks the state; the board never interprets weather codes.

**Time of day** comes from the sun's elevation, computed on the server (NOAA low-precision solar position, no dependencies; prototype `sunPos` in `scripts/mock-skyline-dusk.js`). The sky doesn't snap between looks: the server blends keyframe skies by the exact elevation on every update (~30 s), so dusk deepens gradually. Mockup: [`dusk.png`](mockups/weather/lake/dusk.png) (Oct 31, 2026, 5:00–6:50 PM), the reference for these colors.

| Sun elevation | Keyframe (clear) | Sky, top → horizon |
|---|---|---|
| 12° and up | day | `#08245a` → `#1a4a8e` (row 18) → `#3a6eb0` |
| 6° | golden hour | `#14347a` → `#3a62a0` (14) → `#b89880` (22) → `#f0b868` |
| 1° | sunset | `#1a1440` → `#5a2a5a` (9) → `#c0503a` (17) → `#f08a30` (23) → `#ffb848` |
| −3° | dusk | `#0e1040` → `#30285e` (12) → `#80406a` (20) → `#c86a50` |
| −6° | end of civil twilight | `#06103a` → `#22306a` (18) → `#4a4a88` |
| −10° and below | night | `#000006` → `#0c1430` |

- Between keyframes each row's color is mixed linearly by elevation; water colors blend the same way (values in the mock's `KEYS`).
- **Mornings** use the same keyframes in reverse, except the sunrise sun isn't drawn (it rises behind the viewer, over the lake).
- **City lights follow the sky:** windows switch on one at a time between 1° and −6° (each window has its own threshold from a hash, so the lit set only grows, reaching the full 45% at −6°); stars appear between −4° and −9° (0 → 14).
- **Sun height:** at the skyline's real 2.4 rows per degree (center row 21 at the horizon, hidden by the buildings). Above ~8° it would leave the panel, so between 8° and 14° it slides to the day spot (x 38–44, rows 2–8). In late fall and winter it sets behind the Loop towers (on Oct 31 it's hidden behind Aon and St. Regis from about 5:15 PM), so the glow carries the sunset; in summer it sets right of the wheel over lower buildings.

**Weather** comes from the current condition code and cloud cover (WeatherAPI's `current.cloud`, which the forecast request already returns; additive, so the M4 is unaffected), first match wins:

| Condition | State |
|---|---|
| code 95–99 | Thunderstorm |
| code 51–67, 80–82 (drizzle, rain, freezing rain, showers) | Rain |
| code 71–77, 85–86 | Snow |
| code 45, 48 | Fog |
| cloud cover over 85% | Overcast |
| 50–85% | Mostly cloudy |
| 20–50% | Partly cloudy |
| under 20% | Clear |

- Codes 0–3 (clear through overcast) are ignored; cloud cover sets the cloud state instead, since WMO codes have no "mostly cloudy".
- The dusk keyframes apply to Clear, Partly and Mostly cloudy. Overcast, Rain, Snow, Fog and Thunderstorm blend their own day and night variants across 1° to −6°.
- Precipitation intensity (light / moderate / heavy) comes from the code: 51/53/55, 61/63/65, 71/73/75, 80/81/82, with 56/57/66/67 and 77/85/86 as light / heavy pairs.

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
| Thunderstorm | dark deck, rain, and quiet lightning: a soft glow in the cloud deck with a faint pixel-art bolt inside it (below) |

Also tried for clouds: puffy cumulus (soft-edged, then pixel art with three flat tones; both declined), broken cirrus streaks (declined: they read as dashed lines), and soft-edged wisps (the alternative to the two flat tints).

### Rendering: who draws what
The scene is drawn in layers, back to front. The server renders what's expensive and changes rarely; the board draws only what moves.

| Layer | Drawn by | Notes |
|---|---|---|
| Sky gradient | board | from 2–4 color stops in the payload |
| Sun, moon | board | position, phase from the payload |
| Cloud strip | server | scrolls on the board (below) |
| City silhouette, windows, wheel frame, pier | board | fixed geometry: generated into `assets.h` by `build-firmware-assets.js` from one JS definition that `draw.js` also uses |
| Fog, snow on roofs | board | from the state |
| Rain, snow, lightning | board | |
| Wheel rim, beacons, stars, string lights | board | |
| Water, ripples, glitter path | board | |
| Temperature, clock | board | |

**Cloud strip:**
- The server renders the clouds as a strip 128 px wide and 27 rows tall (rows 0–26) that tiles seamlessly (the noise wraps at 128), indexed at 4 bits per pixel (transparent plus up to 15 shades, enough for the overcast deck's texture): about 1.7 KB.
- The strip has nothing to do with radar: its shape comes from the weather kind (cloud cover and code from WeatherAPI), generated on the server (`clouds.js`). The board downloads it once by id (`GET /board/sky/<id>`, 1664 bytes) and keeps it; the payload carries the id and each index's color and opacity, so dusk recolors the same strip without a new download. A new id comes only with a new kind of sky.
- The board draws it at x offset `floor(now / 4) % 128` (1 px every 4 s, from wall-clock time so every renderer agrees), behind the city, so clouds pass behind the buildings.
- Night wisps and decks use the same strip with a night palette.

**Payload** (`skyline` object; exact fields in `contract.md`): drawing parameters, not a state name. The server turns the state into: sky stops, water colors, wheel day color, lights on/off, window and star levels, sun x/y and visibility, moon phase, cloud strip id and palette, fog level, roof snow color, precipitation kind and intensity, lightning on/off, boats allowed, temperature text. The board has no per-state branches: it draws the layers from these values, so `draw.cpp` stays small and a new look needs only a server change.

**Determinism:** every random element (twinkle phases, rain and snow positions, lightning timing) comes from a hash of the tick and a fixed seed, never a running random generator, so `draw.js`, `draw.cpp` and the parity test agree pixel for pixel.

### Animation
Ambient and slow, on a 100 ms tick:

| Element | Motion |
|---|---|
| Wheel rim (night) | soft rainbow (saturation 70%, value 90%) turns once every 30 s; per board `wheelSpeed`: still, 60 s, 30 s, 15 s |
| Beacons (night) | `#401010` ↔ `#ff2020`, smooth 4 s cosine |
| Stars (night) | twinkle, 4–12 s cycles; per board `twinkle` off holds them steady |
| Water | ripples glide 1 px every 500 ms, drawn with sub-pixel coverage (the dash ends fade in and out); per board `rippleSpeed`: still, 1000, 500, 250 ms |
| Glitter path | at sunset, the ripples under the sun take its color; only while the sun shows over the buildings (no sparkles: they were distracting) |
| Clouds | strip glides 1 px every 16 s by default, sub-pixel like the ripples (each pixel mixes its two strip columns by the fraction of the step); per board `cloudDrift`: off (still), slow (16 s), normal (4 s) |
| Rain | 2 px streaks gliding 1 px every 200 ms along their own line (sub-pixel: the head fades in, the tail out), straight down, or 45° with a cross wind of 8 mph or more; each streak falls past the shore to its own row of water (26–31), skipping the text boxes, so nothing ends along the waterline; 8 / 16 / 26 streaks for light / moderate / heavy (slowed and thinned so the storm stays in the background). Per board `rainSpeed`: 400, 200, 100 ms |
| Snow | 1 px down every 700 ms (3.5× the rain step), into the water like the rain, a 1 px sideways step about every 2 s per flake; 6 / 12 / 20 flakes |
| Lightning | a strike every 20–40 s (from the hash): the whole sky flashes toward `#8a80b0` (peak 35%), brightest in a patch of the cloud deck (about 22 × 8 px, peak 80%), with the bolt (1 px core, flat violet edges, one branch, ending above the Trump roof; a touch of lavender `#b8b0e8`, peak 80%) inside it. Rises over 0.15 s, fades over 1.2 s: a quick flash that still eases in and out (the first version, 45% / 35% over 3 s, was too subtle). Mockup: [`storm.png`](mockups/weather/lake/storm.png), row BOTH |
| Weather changes | a new skyline crossfades in over 4 s (eased), once its cloud strip is on hand (no bare-sky gap) and any running fade has ended; a strip arriving for the sky on screen fades its clouds in. Off the clock screen a new skyline is taken at once. Reference: `createSkylineFader()` in `draw.js`, `draw::SkylineFader` |
| Boats (day) | sailboat on :00 and :30, speedboat round trip on :15 and :45 (below) |

- This screen is the exception to Minimal animation (§2): it has no times to protect, apart from the clock, which only changes at the minute.
- Fetches still go in the scheduler's gaps, and the scene holds still while one runs. How long a fetch stalls the S3's loop needs measuring on hardware.

### Boats
A boat crosses the lake **at every quarter hour**, by day only, alternating: the sailboat on :00 and :30, the speedboat on :15 and :45. Mockups: [`boat.png`](mockups/weather/lake/boat.png), [`speedboat.png`](mockups/weather/lake/speedboat.png).

- **Sailboat:** a white sail `#e8ecf0` on rows 21–24 (mast on the leading side), in front of the city; a red hull on rows 25–26 (6 px deck row `#c02828`, 4 px keel row `#7a1818`). Starts off-panel at the quarter hour and moves 1 px every 800 ms (about 56 s edge to edge). Left on :00, right on :30.
- **Speedboat** (loosely the Seadog tour boat): three rows: blue and white passengers (row 24), a 14 px yellow deck `#ffc020` with the bow raked forward (row 25) and a white bottom (row 26), with a white spray plume trailing behind (9 / 6 / 3 px on rows 26 / 25 / 24, fading out). No helm or windshield. Fast: 1 px every 150 ms, about 13 s across including the plume. It runs out left, **turns around off-panel**, waits about 4 s, and comes back heading right; one round trip of about 30 s.
- Both sit entirely above the text rows, so they never hide behind it; they pass in front of the pier and wheel and are drawn from the board's clock, so no fetch is needed.
- **When:** sun above 0°, no rain, snow, fog or thunderstorm, and 40°F or warmer. The server sends `boats` true or false.

### Board requirements (S3)
- Memory is not a constraint on the S3 (2 MB PSRAM): the cloud strip (1.7 KB), the city layer and the scene buffers can all stay resident.
- **No dim-color floor on this screen** (found on the panel, Nov 1): the floor (§4) lifts any pixel too dark for the panel to its brightest channel at the bottom step. On the skyline that turned the whole night sky and water into one flat blue and night clouds into a patchwork of pure red, blue and tan. Skyline frames opt out (`Frame::floor = false`, `color.cpp` `levels(..., floor)`): pixels too dark for the panel go black (the night sky is black on the panel), and channels just under the bottom step round to it instead of truncating, so a dim near-grey cloud stays grey while a dim red (the beacon) stays red. Everything brighter is unchanged; other screens keep the floor.
- **Full-depth color at every brightness** (also seen on the panel): the S3 uses its "CircuitPython look" curve (gamma 2.2 with 565 / 6-bit truncation, to match the old board) only at 100% and its night curve (gamma 2.6, full depth) below. At 100% the truncation collapsed the skyline's dark gradients into a few flat colors while dimmed it looked right. Skyline frames always use the night curve (`device.cpp` `scene_pipe_`), so they look the same at every brightness.
- On the panel's CircuitPython-look curve the bottom step is a channel value of about 53 (gamma 2.2 level 8): night colors below it vanish (sky, water, thin clouds), colors at it show at the step.
- Built: server parameters (`skyline.js`, `sun.js`), cloud strips (`clouds.js`, `GET /board/sky/<id>`), the reference renderer (`draw.js` `renderSkyline`), and the S3 port (`draw.cpp` `render_skyline`, pixel-identical over the `skyline *` scenarios, all `s3only`). The S3 fetches the strip only on the clock screen, redraws twenty times a second there, lets fetches run any time (no times to protect), and reports `hk=skyline`. The buttons' screen cycle includes Clock on the S3.

### Open
- On the panel: the near-floor colors above, and whether the moon is dim enough. (Glints read as noise on the panel and were removed.) The night snow sky was raised to levels 5–15 after the old one (0–5) banded into black, magenta and red.
- Moon crescents: a plain sliver, earthshine (the unlit part as a faint disc, likely lost to overnight dimming), or a brightened sliver.
- Sunset sun height: how much of the disc shows above the skyline at the low and high ends of its x range (it crosses different buildings through the year).
- Reference: `draw.js` `renderSkyline` (previews: `node scripts/preview-skyline.js` → `previews/skyline-*.png`; live in the simulator's Clock panel). The mock scripts are design history; where they differ, `draw.js` wins.

---

## 15. Announce screen (four styles built)

Designed Nov 1, 2026 as the Message screen; built Nov 1, 2026 as **Announce** (the name the knob and phone use). The owner puts a short note on their own board: "Dinner at 7", "Welcome home!". Mockups of all nine styles: [`mockups/messages/sheet.png`](mockups/messages/sheet.png), made by `node scripts/mock-messages.js`. Payload and pixels: contract, *Announce*.

### Mode
- **A screen, `announce`**, chosen from the phone or the knob (ANNOUNCE, 39 px in 5x7, after CLOCK on the ring). Auto never shows it; like any screen chosen directly it ignores Auto's rules. (The chosen-screen redesign, "Control Page Redesign Decisions", lets interruptions cover it and lets it join a Cycle; neither exists yet.)
- **Owner only:** set on the board's own control page (an owner link or the board's control link). No send links for other people.
- **One message per board.** A new one replaces it. **No expiry:** it stays until replaced, and persists across restarts like the rest of the board's state. Choosing another screen keeps it for next time.
- **Presets:** up to 8 per board, kept on the page; tap one to load it into the message.
- **No message set:** the screen says `SET A MESSAGE` / `ON YOUR PHONE`.
- **S3 only**, like Clock (§14): firmware reports `announce` in `hk`; the server never sends the screen to other boards (they get Transit) and leaves ANNOUNCE off their ring.

### Text
- **One screen:** the text must fit the chosen style without paging (the credits roll scrolls, so it takes up to 16 lines). The server rejects text that doesn't fit (400); the phone page disables styles it doesn't fit ("too long").
- Characters: printable ASCII, Latin-1 and the punctuation phones substitute (curly quotes, dashes, ellipsis, bullet, euro). Anything else (emoji) is dropped. Line breaks force a new line. Up to 160 characters.
- The server lays the text out (`messageLayout()` in `draw.js`, shared with the phone page) and sends the lines; the board only draws them.

### Styles
Picked per message; each style fixes its own colors. Built:

1. **Note:** 5x7 text, wrapped and centered, up to 3 lines; when it doesn't fit, uppercase Tom Thumb up to 5 lines.
2. **Typewriter:** 5x7 amber from the left edge, typed out once when the message appears (90 ms a character), then a blinking block cursor.
3. **Big word:** 5x7 at 2x (about 5 characters), shaded pink to amber.
4. **Credits roll** (built Nov 1, 2026): 5x7 lines, centered, 10 px apart, rise from below the panel 1 px every 150 ms (about 7 px/s, a new line every 1.5 s) until the last one leaves the top, then 1.5 s blank, looping. The top and bottom 3 rows fade the text in and out. Whole-pixel steps at a steady pace: sub-pixel blending smears 5x7 text on the panel. The mockup's sender line isn't built (there's no sender field).

**Split-flap** (10 × 3 small flaps) was built and removed the same day (Nov 1, 2026): it didn't look good on the panel, with or without a gap at the split. Saved split-flap messages load as notes.

Not built yet, in order: **icon + text** (13 px icon with a 2-frame idle loop: heart, cake, house, coffee; each its own style), **speech bubble** (a pigeon), **marquee** (chasing bulbs), **crawl**. Also from the mockups, not built: the big word's sparkle and countdown variants, the typewriter's green phosphor.

This screen is an exception to Minimal animation (§2), like the skyline face: it has no times to protect. The typewriter's intro, and the credits roll's pass, start over when the screen is shown and when a new message arrives, not on every update.

### Phone page
- An **Announce** tab: a preview of the draft drawn by the board's renderer (tap to replay its intro), the text field, a fit line ("Fits Note · 2 of 3 lines"), the four styles as tiles drawn with the draft (or a sample when it doesn't fit), **Show on board** (sets the message and the screen; "On the board ✓" when it's already up), **Save as preset**, and the presets list.
- While Announce is on the board, edits go up about a second after typing stops.
- Announce is also in the Screen picker (now two rows of four).

### Open
- Which icons ship first, beyond heart, cake, house and coffee.
- What the countdown variant counts down to, if it isn't just text.
- On the panel: the marquee's 1 px bulbs through the diffuser, white on Pink and Yellow crawl bands.

## 16. Clock screen: seventies face

Built Nov 1, 2026: the clock screen's second face (phone page, Clock: Face **Seventies**), S3 only. Picked from the round 3 clock mockups (`scripts/mock-clock/`).

- **Time:** `h:mm` (12-hour, no AM/PM) in the VCR digits (§3), centered in columns 0-52, digits on rows 5-15. Each lit pixel takes its row's color: sunflower `#ffc23a` (rows 5-8), orange `#ff7414` (9-11), rust `#d2361a` (12-15), so the bands stay put while digits roll through them.
- **Stripes:** three 2 px stripes in the same colors, sunflower inside, run along the bottom (rows 23-24, 26-27, 29-30) and turn up the right edge (columns 56-57, 59-60, 62-63) on quarter circles around (54, 21). Exact pixels: contract, *Seventies*.
- **Motion:** the minute roll only (`svt.clock`, the same per-digit roll as every clock).
- **Fallback:** a board whose firmware doesn't report `seventies` gets the skyline face.
- **Power:** the stripes are about 330 lit pixels at full color; more than the transit screen, well under the ticker.
