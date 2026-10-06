# LED Board API Contract

The contract between the server (`server/board/`) and the board (CircuitPython on the Matrix Portal M4). **Source of truth:** any change to an endpoint, payload field, or frame format updates this file in the same PR. Design rationale lives in [`design-spec.md`](design-spec.md).

Status: **draft v0**. Items marked **(decide)** are open.

---

## Conventions

- **Base URL:** `https://ctamap.fly.dev`
- **Times:** all timestamps are **epoch seconds (UTC)**. The server converts CTA's zone-less Chicago local times before sending. With `outputType=JSON`, `arrT`, `prdt`, and `tmst` look like `2026-10-03T23:16:07` (ISO without an offset), not the `yyyyMMdd HH:mm:ss` the API docs show for XML.
- **Clock sync:** every JSON response includes `now`, the server's epoch time. The board keeps `offset = now - time.monotonic()` and uses it for countdowns and clocks. No NTP on the board.
- **Board ID:** query param `b` (e.g. `b=home`). State is keyed by board ID.
- **Auth:** header `X-Board-Token: <BOARD_TOKEN>` on every board endpoint except `/board/ping`. If `BOARD_TOKEN` is unset (local dev), auth is skipped.
- **Errors:** `400` invalid input · `401` bad/missing token · `404` unknown board ID or route · `405` wrong method · `503` data not ready yet. Error bodies are `{"err":"<short code>"}`; `400` adds `"detail"` with a human-readable reason.
- **Caching:** every `/board/` response is `Cache-Control: no-store` (radar frames excepted, see below).
- **Text is final:** the server sends labels already shortened, cased, ligature-substituted, and truncated to fit by pixel width. The board never edits text.
- **Fonts:** the board font BDFs are committed under `server/board/fonts/`. The server reads glyph advances from them to measure and truncate text; the board build uses the same files. One source for widths.

---

## Board endpoints

### `GET /board/ping`
Captive-portal check. No auth.

```json
{"ok":1}
```

Anything else (HTML, redirect, non-200) means a portal.

### `GET /board/version?b=<id>`
Polled ~every 10 s.

```json
{"v":42,"now":1759546800}
```

`v` is the board's **settings version**. It increments on every phone change and on boot reset. When `v` differs from the last seen value, the board fetches `/board/update` immediately.

### `GET /board/update?b=<id>[&boot=1]`
The combined update, polled ~every 30 s. Target size ≤ ~1.2 KB.

`boot=1` is sent on the board's first update after startup. It resets `bright` to auto and bumps `v`. The chosen `screen`, station, row, and toggle config persist.

```json
{
  "v": 42,
  "now": 1759546800,
  "tzo": -18000,
  "age": 12,
  "screen": "transit",
  "bright": 100,
  "header": "MORSE",
  "view": "dest",
  "rows": [
    {"ln": "RD", "lbl": "HOWARD", "t": [1759546860, 1759547280, 1759547700], "s": [0, 0, 0], "a": 0},
    {"ln": "RD", "lbl": "95TH",   "t": [1759547040, 1759547520],             "s": [0, 1],    "a": 0}
  ],
  "ticker": [
    {"ln": "RD", "d": "Howard", "t": 1759546860, "s": 0, "a": 0},
    {"ln": "RD", "d": "95th",   "t": 1759547040, "s": 0, "a": 0}
  ],
  "wx": {"icon": "rain", "temp": 54, "word": "RAIN", "hi": 60, "lo": 48},
  "warn": null,
  "radar": {
    "on": false,
    "frames": ["40100-202610032310", "40100-202610032315", "40100-202610032320", "40100-202610032325", "40100-202610032330", "40100-202610032335"],
    "ft": [1759544640, 1759545000, 1759545360, 1759545720, 1759546080, 1759546440],
    "timeBox": [40, 0, 24, 22],
    "split": false
  }
}
```

#### Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `v` | int | Settings version (same as `/board/version`). |
| `now` | int | Server epoch seconds. |
| `tzo` | int | Chicago's UTC offset in seconds at `now` (-18000 CDT, -21600 CST). The board adds it to epoch times for every clock (CircuitPython has no time zone database). Refreshed with every update, so DST changes take effect within one fetch. |
| `age` | int \| null | Seconds since the arrivals data was last fetched successfully, or `null` when the server hasn't reached Train Tracker since it started (the update is still sent, with no rows). The server keeps serving last-good data when CTA fails. |
| `stale` | int | `1` when there's no arrivals data or it's more than 3 minutes old (`STALE_S` in `index.js`): the transit and ticker screens draw a red (`#ff2020`) line along the top edge (row 0, full width), and the overnight layout says `NO DATA` instead of `NO TRAINS`. Otherwise `0`. |
| `screen` | string | Screen to show, **already resolved** from auto rules: `transit`, `ticker`, `weather` (radar loop while raining; see *Radar*), `baseball`. `auto` resolves to `baseball` while `mlb.games` is non-empty, otherwise `transit` (NWS warnings and watches don't change it); timed radar visits ride on top of either, see `radar.visit`. A local button press overrides it until `v` changes. Firmware before the baseball port draws `transit` for `baseball`. |
| `bright` | int | Global brightness 0–100, already resolved: `auto` is 100 from sunrise to sunset and 40 overnight (Open-Meteo times for the station; 100 until weather data arrives), or the fixed level, or 0 for off. |
| `header` | string \| null | Station name for the transit header, or `null` when the header is off or hidden to fit (see *Fitting the header and weather row*). |
| `tickerHeader` | string \| null | Station name for the ticker header. Always sent: the ticker shows its header even when the transit header toggle is off. (Boards without it fall back to `header`.) |
| `hidden` | array | Which of `"weather"`, `"header"` the server hid to fit this update's destinations, for the phone page and simulator. The board just follows `header` and `wx`. |
| `view` | string | Transit view: `dest` (one row per destination, up to 3 times) or `chrono` (one row per train, soonest first). Chosen by the server; see *Transit view* below. |
| `rows` | array | Transit rows, already filtered and ordered. `dest`: **capped** to the max for the header/weather toggles (5/4/3/2). `chrono`: the cap **plus 2** extra trains; the board shows the first *cap* live rows. Empty array means no predictions: the board shows the overnight layout. |
| `ticker` | array | Up to 6 individual arrivals in time order for the ticker. |
| `wx` | object \| null | Weather row, or `null` when the weather row is off or there's no weather data yet (the row cap then gives the space back to rows). |
| `warn` | object \| null | Active NWS warning/watch (see below). Sent regardless of the weather-row toggle, since the radar screen uses it too. |
| `radar` | object | Radar state (see below). |
| `mlb` | object | Baseball: `{layout, dim?, games: [...]}`, the layout and the games to show now (see *Baseball* below). Always present; `games` is empty when there's nothing on. |

All screens' data is always included so a button press switches screens without a fetch.

#### Which predictions are shown
Learned from recorded fixtures (`server/board/fixtures/tt-arrivals/`):
- **Trains ending at this station are dropped**: a prediction whose `destNm` equals the station's `staNm` (Howard), whose `destNm` maps to this station in `DEST_MAPID` (`server/board/destinations.js`; e.g. "63rd Street" at Ashland/63rd), or whose `stpDe` says "Terminal Arrival".
- `destSt` is `"0"` and `lat`/`lon` are null on schedule-based predictions; `lat`/`lon` can also be `"0"`. Don't rely on them.

#### Row order and fitting (server)
- With no `rows` list in the board config, rows are ordered by line (`RD BL BR GR OR PR PK YL`), then Train Tracker direction (`trDr`), then name. With a list, the list is the order and the filter; destinations CTA doesn't normally use are appended after it.
- When the destinations (after the filter) exceed the cap for the header/weather toggles, the server sends the chronological view instead of dropping rows. The ticker uses the same filter but not the cap.
- Times are drawn 3px apart, tightening to 2px when the label would otherwise come within 3px of them. Transit labels are fitted per row against the 2px spacing at the times' widest before the next update (digits only shrink as times count down, but the first time may turn into `DUE`), so 7-letter names like `KIMBALL` and `COTTAGE` always fit.
- Ticker destinations are fitted to 32px of 5x7 (`Jeff Pk` is exactly 32).

#### Fitting the header and weather row (server)
The board's `showHeader` / `showWeather` are the most it shows. On every update the server counts the destinations (after the row filter) and fits them (`fitBars` in `arrivals.js`):

| Destinations | Header | Weather row | View |
|---|---|---|---|
| fit with both | shown | shown | rows |
| fit without the weather row | shown | hidden | rows |
| 5 | hidden | hidden | rows |
| 6 or more | shown | hidden | one train per row |

So a station with rush-only service (Purple at Merchandise Mart) gains and loses the weather row on its own. The weather row never shows with the chronological list.

#### Transit view (server)
- `chrono` whenever the destination count exceeds the cap, `dest` otherwise, decided on every update. `CHRONO_HOLD` in `arrivals.js` (0 now) can add a hold before switching back; that state is kept in memory per board and station.
- `chrono` rows each carry one time (`t` and `s` have one entry) and `rn`. Labels are fitted against the widest chrono time (`99m`).

#### CTA alerts (server)
- One poller (`server/board/cta-alerts.js`, every 3 min) fetches `alerts.aspx?activeonly=true&routeid=red,blue,brn,g,org,p,pink,y` (XML) for both the map's `/api/alerts` and the board. Every `<Service>` in `<ImpactedService>` is read; only `ServiceType` `R` (train routes) count, so a station listed first (43rd before Green Line) doesn't hide the line.
- **Board rule:** a line's `a` is `1` only when an alert covering it has `SeverityCSS` `major` or `MajorAlert` `1`. Minor delays (`minor`), planned work (`planned`), schedule changes, long-term closures and elevator outages (`special-note`) don't blink. Fixture: `fixtures/cta-alerts/2026-10-04-1057.xml` (7 alerts, none major, so nothing blinks).
- **Map:** unchanged filter (major, or an impact containing "delay"), now one entry per impacted line.

#### Line codes
Train Tracker `rt` values map to `ln`: `Red`→`RD`, `Blue`→`BL`, `Brn`→`BR`, `G`→`GR`, `Org`→`OR`, `P`→`PR`, `Pink`→`PK`, `Y`→`YL`. Short-name map keys are matched against `destNm` exactly as Train Tracker returns it (e.g. `O'Hare`, `Loop`); confirm each key against recorded fixtures.

#### Row (`rows[]`)

| Field | Meaning |
|---|---|
| `ln` | Line code for the color block: `RD` `BL` `BR` `GR` `OR` `PK` `PR` `YL`. The board owns the color palette. |
| `lbl` | Label, uppercase, fitted. |
| `t` | Up to 3 arrival times (epoch), ascending. |
| `s` | Parallel to `t`: `1` if that time is schedule-based (`isSch`), drawn grey instead of amber. |
| `a` | `1` if the line has an active **major** CTA alert (block blinks to "!"); see *CTA alerts* below. |
| `rn` | `chrono` only: Train Tracker run number (string). The board keys rows by it, so trains keep their identity when they swap order. |

#### Ticker item (`ticker[]`)

| Field | Meaning |
|---|---|
| `ln` | Line code (row fill color). |
| `d` | Destination, mixed case, `tt` replaced with the ligature codepoint, fitted for the 5x7 font. |
| `t` | Arrival time (epoch). |
| `s` | `1` if schedule-based → index number is replaced by the clock glyph (unless `a` is `1`; the alert circle wins). |
| `a` | `1` → index number is replaced by the alert circle. |

#### Countdown rules (board side)

- `min = ceil((t - now) / 60)`: rounded **up**, like CTA's own predictions (every `arrT` is `prdt` plus a whole number of minutes, so a fresh "2 min" counts down from 120 s).
- Show `DUE` (transit) / `Due` (ticker) when `min <= 1`, i.e. 0–60 s out, which is when CTA sets `isApp` in the recorded fixtures. The board never shows 1. Chrono rows show `<min>m` otherwise.
- DUE can still last a few minutes when a train is held: CTA keeps predicting "1 minute" while it waits, so `arrT` keeps moving later.
- **Times only count down (server):** fresh CTA predictions are whole minutes from a possibly stale prediction time, so they often come back up to a minute later than the board's countdown (often "2 min" for a train already showing DUE). For a run (`ln` + `rn`) seen in the previous fetch, a later new prediction keeps the previous time when it's less than 60 s later. Near DUE the tolerance is wider: a fetch reaches the board up to 60 s later (tracker poll + board poll), so for a run whose previous prediction is DUE within 60 s of the fetch, a new prediction within 3 min keeps the previous time, and one already DUE is held at `t = fetch time + 60` (still DUE). Bigger slips are real delays and show. (`latchDue` in `arrivals.js`, applied in `tracker.js`.)
- Drop an arrival once `now > t + 30`; its cell fades out and the list shifts (see `createTransitAnimator()` in `draw.js`). **(decide)** whether the 30 s grace is right; CTA's `isApp` is not sent.

#### Weather row (`wx`)

| Field | Meaning |
|---|---|
| `icon` | `sun` `moon` `pcloudy_day` `pcloudy_night` `cloudy` `rain` `ice` `snow` `storm` `fog` |
| `temp` | Current °F, integer. The board draws it with the small `°` glyph (U+00B0). |
| `icon` | Current weather icon name (same set as `wx.icon`), or `null` before the first weather fetch. |
| `word` | Condition word, uppercase, fitted. |
| `hi`, `lo` | Daily high/low °F. |

When `warn` is non-null, the board replaces `word` with the warning tag.

From Open-Meteo (`server/board/weather.js`; fixture `fixtures/open-meteo/`), at the station's coordinates: `temp` is `current.temperature_2m` rounded, `hi`/`lo` the day's max/min. The same request (`wind_speed_unit=mph`, `forecast_hours=6`) also asks for `apparent_temperature`, `wind_speed_10m`, `wind_direction_10m`, and hourly `precipitation_probability` for the weather screen (`radar.wx`). The recorded fixture predates those fields; **(todo)** record a new one. WMO `weather_code` → `icon` / `word`: 0–1 `sun` SUNNY or `moon` CLEAR (by `is_day`); 2 `pcloudy_day`/`pcloudy_night` PT CLOUDY; 3 `cloudy` CLOUDY; 45, 48 `fog` FOG; 51–55, 61–65, 80–82 `rain` RAIN; 56–57, 66–67 `ice` FRZ RAIN; 71–77, 85–86 `snow` SNOW; 95–99 `storm` STORMS; anything else `cloudy` CLOUDY. 

#### Warning (`warn`)

```json
{"kind": "tor", "lvl": "warning"}
```

- `kind`: `svr` (severe thunderstorm, bolt) or `tor` (tornado, funnel).
- `lvl`: `watch` or `warning`.
- If several are active, the server sends the most severe: tornado warning > severe warning > tornado watch > severe watch.
- Source: `api.weather.gov/alerts/active?point=<station lat,lon>` (`server/board/nws.js`), every 90 s per location while a board is asking. Only `Tornado Warning`, `Severe Thunderstorm Warning`, `Tornado Watch`, `Severe Thunderstorm Watch` count.
- **Ignored:** `status` other than `Actual`, `messageType` `Cancel`, VTEC action `CAN` or `EXP` (NWS sends "the warning has expired" statements under the warning's own event name and keeps them in `active` until they expire; fixture `fixtures/nws/svr-warning-expired-2026-10-03-jax.json`), and alerts before `onset` or after `ends` (falling back to `effective`/`expires`). Timing is checked on every update, so a warning drops off on time between fetches.

#### Radar (`radar`)

| Field | Meaning |
|---|---|
| `on` | Rain is in the box (server applies on/off hysteresis). On the auto screen, `on` allows timed radar visits (see `visit`). |
| `visit` | `{every, for}` in seconds, or `null`. Set only when the board's `screen` is `auto` and `radarEvery` > 0 (`for` is capped at `every`). The **board** (and simulator) shows the radar while `now mod every < for` and `on` is true, otherwise the payload's `screen` (`transit`); cycles are epoch-aligned. Mirrored by `autoScreen()` in `draw.js` and `auto_screen()` in `player.py`. The board fetches radar frames ahead of a visit whenever `on` and `visit` are set. A button press overrides it until `v` changes. |
| `frames` | IDs of up to 6 latest frames (6 min apart, on even minutes), oldest first; only frames from the current 30-minute loop (after a quiet spell, older frames aren't sent and `on` is `false` until new ones arrive). Frame IDs are immutable, so the board fetches only IDs it doesn't already have. ID: `<mapid>-<YYYYMMDDHHMM UTC>`, plus `s` for a snow frame (so a station or mode change never reuses a cached frame). |
| `showTime` | Boolean (absent = true). `false` replaces the time and AM/PM with current conditions: the weather `icon` (8x8) and `temp` (Tom Thumb with a degree sign, label white), right-aligned under the frame indicator. The warning tag moves to the screen's bottom right (rows 27–31, right edge x63, on a black backing; it may run past the time box): icon + `WATCH` or `WARN`. With no `temp`, only the tag. |
| `temp` | Current temperature (°F, rounded) from Open-Meteo, or `null` before the first weather fetch. Sent whatever the weather row setting. |
| `ft` | Frame timestamps (epoch), parallel to `frames`; used for the radar time. |
| `timeBox` | `[x, y, w, h]`: box the board draws the time stack into (frame indicator, time, AM/PM + warning icon), right-aligned. The server does not clear it (the shoreline can run into it); the board clears a 1px black margin around each piece it draws there (indicator, time, AM/PM, warning icon, or the weather icon and temperature), so nothing touches them. |
| `split` | `true` when the location has no usable water area; the time box is then the right-side panel. Per station, from `server/board/locations/<mapid>.json`: **full width** (`split: false`, marker at 32,16, clock box `[40, 0, 24, 22]` over Lake Michigan) when the area the widest clock stack draws on (cols 41–62, rows 2–19) is all water; otherwise **split** (radar in cols 0–38, marker at 19,16; the board draws a gray `#333333` line on col 39; clock box `[40, 0, 24, 32]`, leaving a 1px gap before the widest clock). 114 of 144 stations are full width. The board draws the clock stack **top-aligned**: indicator rows 2–3, clock rows 6–12, AM/PM rows 15–19, right-aligned to column 62. |

| `wx` | Weather screen conditions, sent whenever there's weather data (even with the weather row off): the top-level `wx` fields plus `feels` (apparent temperature °F, rounded), `wind` (`"NW 12"`: 8-point compass the wind blows from + mph, rounded; `"CALM"` under 1 mph; just the speed without a direction), and `pop` (highest hourly precipitation probability % over the next 6 hours, starting with the current hour). Each of the three is `null` when Open-Meteo didn't send it. Omitted before the first weather fetch. |

**Weather screen.** The `weather` screen (formerly `radar`) draws the radar loop only when `frames` is non-empty, otherwise current conditions from `wx`. The server sends `frames`/`ft` **only while `on`** (empty otherwise), so the screen shows the radar while rain is in the box and the weather the rest of the time, and the board fetches no frames without rain. With no `frames` and no `wx`, the board draws the empty radar with the clock stack at the current time. Layout (Tom Thumb unless noted; `drawWeatherScreen()` in `draw.js`, `draw_weather_screen()` in `draw.py`):
- Temperature in the 9x15 Bold clock digits at x1, baseline 14 (ink rows 4–13), label white; below zero a 5x2 minus bar at rows 8–9 then a 2px gap; a 3x3 ring degree sign (center unlit) right after the digits at rows 4–6.
- Icon (8x8) at x55, y1. Condition word dim (`#555555`) right-aligned to x63, rows 11–15, skipped if it would come within 2px of the degree sign (3-digit temperatures).
- Divider `#333333` on row 18.
- Rows 20–24: `FEELS 53°` grey at x0; `wind` label white right-aligned to x63.
- Rows 26–30: `H 63° L 49°` grey at x0 (degree signs dropped when it would come within 3px of the drop); `pop` + `%` label white right-aligned to x63, with a 3x4 drop (`#1e90ff`, rows 27–30) 2px to its left.
- **Warning or watch:** replaces the whole rows 26–30 line: glyph (bolt or funnel) at x0, 3px gap, `TSTORM WATCH`, `TSTORM WARNING`, `TORNADO WATCH`, or `TORNADO WARN` (`TORNADO WARNING` doesn't fit), in the warning colors; a tornado warning blinks.

When `on` is false, `frames` and `ft` are empty and `timeBox` may be `null`.

**`on` hysteresis** (provisional): turns on when the newest frame has ≥ 30 precip pixels (after water masking and despeckle, marker excluded), off when it drops below 10. Judged once per new frame. `on` doesn't switch screens by itself: `auto` stays on transit unless radar visits are turned on.

**Source and processing** (`server/board/radar.js`): IEM `mrms_lcref` archive, `https://mesonet.agron.iastate.edu/archive/data/YYYY/MM/DD/GIS/mrms/lcref_YYYYMMDDHHMM.png` + `.wld` (7000 × 3500, 8-bit palette, 0.01°; the world file's origin differs by half a pixel between older and newer files, so each frame's `.wld` is read). Palette index → **dBZ = index × 0.5 − 32** (255 = missing; ≤ 65 is no echo), per IEM's lookup table. Each LED is ~1.5 mi (2.92 source columns × 2.17 rows at Chicago's latitude); a source pixel goes to the LED containing its center; LED value = mean **linear** Z → dBZ → level; water LEDs set to 0, then despeckle (drop precip pixels with < 2 precip neighbors), shoreline (6) on water LEDs next to land, the clock box cleared, then the marker. Masks come from `scripts/build-locations.js`: an LED is water when its center is inside Lake Michigan (`scripts/geo-src/lake-michigan.geojson`, Natural Earth 1:10m, public domain); a test checks every committed file matches a fresh build. Frames are stream-decoded (`radar-png.js`): only the ~70 rows around the station are unfiltered, and the download stops after them (~14 MB peak vs ~150 MB for a full pngjs decode). The poller runs every 20 s while a board asked in the last 2 min, fetching one source frame per pass: the newest slot first (expected 2 min after its time), then the rest of the 30-minute loop. Slots are every **6 minutes** (multiples of 6 min since midnight UTC): IEM's archive only has frames at even minutes, and 5-minute slots asked for odd minutes half the time. A missing frame (404) is retried after 2 min; a download that hasn't finished in 60 s is abandoned. The last 12 processed frames per station are kept.

#### Baseball (`mlb`)

```json
"mlb": {"games": [
  {"id": 849829, "st": "live", "start": 1759510800,
   "away": {"ab": "CHC", "c": "#2a5bd8", "r": 3, "w": 92, "l": 70},
   "home": {"ab": "STL", "c": "#d62a2a", "r": 2, "w": 88, "l": 74},
   "inn": 7, "half": "T", "b": 2, "s": 1, "o": 2, "on": [1, 0, 1]}
]}
```

| Field | Meaning |
|---|---|
| `id` | MLB `gamePk`. |
| `st` | `pre`, `live`, or `final`. |
| `start` | First pitch, epoch seconds. Pregame shows it as the time. |
| `away`, `home` | `ab` team abbreviation (Stats API `abbreviation`), `c` block color (`server/board/teams.js`), `r` runs (0 before first pitch), `w`/`l` record (`null` if unknown; postseason W-L in the postseason). |
| `away.at`, `home.at` | Live only, optional. Epoch seconds when the server saw that team's score change between two polls. The board draws the score amber for 30 s after it, fading to white over the next 5 s. Absent when no change has been seen (including a game first seen mid-game). |
| `inn`, `half` | Live only. Inning and half: `T` top, `B` bottom, or between halves `M` (Middle, after the top) and `E` (End, after the bottom), from the linescore's `inningState`. Breaks send no runners, count, or outs; the board shows `MID 4` / `END 5` with an empty bottom line. |
| `b`, `s`, `o` | Live only. Balls, strikes, outs (0 during a break). |
| `on` | Live only. Runners as `[1st, 2nd, 3rd]`, 1 = occupied. |
| `layout` | `classic` (default), `logos`, or `bands`: the board's `baseballLayout` setting. |
| `dim` | `logos` and `bands` only. Brightness (0.1–1) the board applies to the bands and logos when drawing: the board's `logoBright` / 100 (default 0.9). Logos are sent undimmed, so this changes without re-uploading. |
| `away.lg`, `home.lg` | `logos` only. Logo id (`<ab>-<hash>`, immutable) to fetch once from `GET /board/logo/<id>`, or `null` (no logo uploaded: the board draws the abbreviation in the logo slot). |
| `away.bd`, `home.bd` | `logos` and `bands`. Band color (undimmed): the logo tile's top-left pixel, or the team's block color `c` without a logo. |

- **Server:** `server/board/mlb.js` polls `statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=<yesterday>&endDate=<today>&hydrate=linescore` (Chicago dates) every 15 s while a shown game is live or within 30 min of first pitch, every 5 min otherwise. Shown: Cubs games (team 112) and postseason games (`gameType` `F`, `D`, `L`, `W`), from 30 min before first pitch until 15 min after the server first sees the final; postponed and cancelled games are skipped. Sorted by first pitch.
- **Forced windows:** when the board's `screen` is `baseball`, `mlb.games` uses wider windows (`mlb.get('forced')`): pregame for any game whose first pitch is today (Chicago), from midnight; finals through their own day and until 3 AM the next morning. Live games always show. Auto (and every other screen) gets the windows above.
- **Board:** shows a live game whenever one is on: the live games (or, with none live, all games) rotate one minute each by wall time, `set[floor(now / 60) % set.length]` (`draw.js` `pickGame`, no state), drawn per `draw.js` `renderBaseball` (design spec §8). Scores, inning, count, and outs roll when they change (`baseballTexts`).

- **Logo and band layouts:** 12-row team bands (away rows 0–11, home 12–23) to x37 in `bd` at `dim`; `logos` draws the 24 x 12 logo crop at the left (also at `dim`), `bands` the abbreviation in the same ink (white, or black on a light band). Scores are centered in the band's box at x30: white, or black (unlit) on a light band (drawn band luma above 140), amber for the score flash and the final's winner (the loser stays white). Pregame: the abbreviation in the score box (`logos`), records in the panel, `TODAY` bottom left. Infield centered on row 8, inning on baseline 21. Divider row 24 and the bottom line are shared with `classic`.

### `GET /board/logo/<logoId>?b=<id>`
One team logo crop for the logo layout.

- `Content-Type: application/octet-stream`, `Cache-Control: max-age=86400, immutable`. Token required.
- **Format:** 864 bytes: 24 x 12 pixels, RGB, row by row from the top left. Undimmed; at most 64 distinct colors (the board draws into a 256-color palette).
- The board fetches missing logos one per scheduler run while the baseball screen is up (`firmware/boardlib/app.py` `_logo`) and drops logos the payload no longer uses.
- Logos come from the owner's uploads (`POST /board/<secret>/api/logos`); they're kept beside the board state and never committed (trademarks; the repo is public). Processing is only a resize and a crop: each 32px tile (or any image, area-averaged to 32px) is box-scaled to 24px and 12 rows are cut at the team's crop row (`OFFSET` in `server/board/mlb-logos.js`, or `crop=` on upload).

### `GET /board/radar/<frameId>?b=<id>`
One radar frame for that board's location.

- `Content-Type: application/octet-stream`, `Cache-Control: max-age=3600, immutable`.
- Body: **2048 bytes**, 64 × 32, row-major from top-left, **one byte per pixel**.

| Value | Meaning |
|---|---|
| 0 | off (land with no rain, masked water) |
| 1–5 | rain levels: 15/25/35/45/55 dBZ (dim green, green, yellow, orange, red) |
| 6 | shoreline: the lake's edge pixels, water side; always drawn (water is masked, so rain never covers it) |
| 7 | location marker (white dot; precip in the 4 pixels around it is cleared to 0, shoreline is kept) |
| 8–10 | snow levels, light to heavy (light blue, pale blue, white) |

A frame is either all rain levels (1–5) or all snow levels (8–10); the server picks the mode per frame (see **Snow mode** below). The board owns the palette, including the ~65% fill brightness.

#### Snow mode (v1 heuristic)
- Reflectivity can't tell rain from snow, so v1 decides from the board location's Open-Meteo data, for the whole frame:
  - **Snow** if the weather code is a snow code (71, 73, 75, 77, 85, 86), or the temperature is ≤ 32°F and the code is not freezing rain (56, 57, 66, 67).
  - Otherwise **rain**.
- Snow uses its own dBZ thresholds, because dry snow reflects much less than rain at the same rate. Provisional: **10 / 15 / 20 dBZ** (the Feb 2, 2022 Chicago snowstorm averaged 11–18 dBZ per LED, so 10/20/30 left the top two levels unused). Fixtures: `fixtures/mrms/`.
- Known limits: a rain/snow line inside the box, and sleet or mixed precip, render as one type.
- `radar.on` hysteresis counts snow pixels the same as rain pixels. `404` if the frame ID is no longer kept (the server keeps the last 12).

---

## Control endpoints

All under the secret path `/board/<BOARD_CONTROL_PATH>/`. No token header: the path is the credential. Requests to a wrong path return `404`, the same as any missing page.

| Endpoint | Purpose |
|---|---|
| `GET /board/<secret>/` | Phone control page (HTML, `server/board/control.html`): live preview, screen, brightness, station and header name, header/weather toggles, destination filter. `/board/<secret>` redirects here (relative URLs need the slash). |
| `GET /board/<secret>/api/destinations?mapid=<id>[&b=<id>]` | Destinations for the filter: `[{key, ln, name, live}]` in default row order. Every destination the station's lines can show (`LINE_DESTS` in `destinations.js`, minus trains ending there; Purple to Howard only north of Howard), then any running now (`live: 1`) or already in board `b`'s `rows`. |
| `GET /board/<secret>/sim?b=<id>[&mapid=<id>]` | Simulator page: the live transit and ticker screens, refreshed every few seconds (alert blink and ticker paging included), plus the raw payload. A station picker previews any station; "Use on board" sets it as the board's station. |
| `GET /board/<secret>/sim.png?b=<id>[&screen=transit\|ticker\|weather\|baseball][&page=N][&blink=1][&scale=1-16]` | One rendered frame of the live payload as a PNG (`server/board/render.js`). `screen` defaults to the payload's screen. |
| `GET /board/<secret>/api/update?b=<id>[&mapid=<id>][&header=0\|1][&weather=0\|1][&rtime=0\|1]` | The same payload as `/board/update`, without the token header (the path is the credential). `mapid`, `header`, `weather`, and `rtime` (radar corner: frame time or temperature) preview another station or the board toggles without changing the board (the row list is ignored while previewing another station); `sim.png` takes them too. The simulator's "Use on board" posts the previewed settings to `api/state`. |
| `GET /board/<secret>/api/radar/<frameId>?b=<id>[&mapid=<id>]` | Same as `/board/radar/<frameId>` without the token, for the simulator. `sim.png` also takes `screen=weather`. |
| `GET /board/<secret>/api/stations` | Station list for pickers: `[{mapid, desc, short}]`, sorted by `desc`. |
| `GET /board/<secret>/api/state` | Full state JSON (all boards). |
| `POST /board/<secret>/api/state?b=<id>` | Partial update for one board, body is a subset of the board object below. Returns the board's full state. Bumps `v`. |
| `GET /board/<secret>/api/test?b=<id>` | Simulator test alerts for board `b`: `{lines, warn, game, left}` (`left` = seconds until expiry, 0 when none). |
| `POST /board/<secret>/api/test?b=<id>` | Start a test alert: body `{lines: ["RD", ...], warn: {kind: "svr"\|"tor", lvl: "watch"\|"warning"} \| null}`. Lines are `RD BL BR GR OR PR PK YL`; they blink as if CTA had a major alert, and `warn` replaces the NWS warning. Applies to the real board's updates too, and expires after 10 minutes. `game` (`pre` \| `live` \| `final` \| `null`) adds a made-up Cubs-Cardinals game in that state at the front of `mlb.games`. An empty body (no lines, no warn, no game) clears it. `400` for bad values, `404` for an unknown board. |
| `GET /board/<secret>/api/logos` | Logo status: `{teams: [abbreviations with a logo], updated}`. |
| `POST /board/<secret>/api/logos[?team=<ab>[&crop=0-12]]` | Upload logos as a PNG body (max 8 MB): without `team`, the whole 5 x 6 sheet of 32px tiles in `mlb-logos.js` `SHEET` order, at any whole-number scale (replaces every team); with `team`, one team's logo (any PNG; a non-32px image is area-averaged to 32px), cropped at `crop` (first of the 24px logo's rows shown; default per team). `400` with a reason on a bad image. The phone page converts other image types to PNG before uploading. |
| `GET /board/<secret>/api/logo/<logoId>` | A logo crop for the simulator. |
| `GET /board/<secret>/api/raw/mlb` | The MLB schedule response the poller last fetched, unchanged, for recording fixtures. `503` before the first fetch. |
| `GET /board/<secret>/api/raw/arrivals?mapid=<id>` | Raw Train Tracker `ttarrivals` response for a station, exactly as CTA sent it, for recording test fixtures. `400` for an unknown `mapid`, `502` if CTA fails. |

POST rules: allowed fields are `station` (`{mapid, name?}`; `name` defaults to the station's `short` and must fit 42px), `rows`, `showHeader`, `showWeather`, `radarTime`, `radarEvery`, `radarFor`, `screen`, and `bright`; anything else is a `400`. `rows` holds up to 24 entries. Changing `station` to a different `mapid` resets `rows` to `[]` unless the same request sets `rows`. Posting to a board ID that doesn't exist creates it from defaults (IDs: 1–32 chars of `a-z`, `0-9`, `-`). `BOARD_CONTROL_PATH` must not be `ping`, `version`, `update`, or `radar`; if it is, control endpoints are disabled.

---

## Server state file

`/data/board-state.json` on the Fly volume (`board_data`, mounted via `[mounts]` in `fly.toml`). Written atomically (temp file + rename). `BOARD_STATE_DIR` overrides the directory (tests, local dev); without it and without `/data`, the server uses a temp dir and logs a warning. An unreadable file is moved aside to `board-state.json.corrupt-<time>` and the server starts from defaults (board `home` at Morse).

Next to it, `board-weather.json` keeps the last good Open-Meteo data per location (written atomically after each successful fetch), so a restart has weather right away. Entries older than 3 hours, or an unreadable file, are ignored.

```json
{
  "boards": {
    "home": {
      "v": 42,
      "station": {"mapid": "40100", "name": "MORSE"},
      "rows": ["RD:Howard", "RD:95th"],
      "showHeader": true,
      "showWeather": true,
      "screen": "auto",
      "bright": "auto"
    }
  }
}
```

| Field | Meaning |
|---|---|
| `v` | Settings version for this board. |
| `station` | Train Tracker `mapid` and header name. Changeable from the control page. The station's coordinates are also the board's **location** for weather, NWS alerts, and the radar crop. |
| `rows` | **Ordered** list of `LINE:ShortName` to show. Acts as both the destination filter and the row order; if more destinations than the cap remain, the board shows the chronological view. Empty means all destinations, in default order. Unknown destinations are appended after the listed ones. |
| `showHeader`, `showWeather` | Transit toggles; together they set the row cap. |
| `screen` | `auto` or a forced screen (`transit`, `ticker`, `weather`, `baseball`; a saved `radar` loads as `weather`). Persists across boots. `auto` resolves to `transit`, or `baseball` while a game is on; it never changes screens on its own otherwise, except for radar visits. |
| `radarEvery`, `radarFor` | Radar visits on the auto screen: every `radarEvery` minutes (0 = never, the default; max 60) show the radar for `radarFor` seconds (10–600, default 60), only while rain is in the box. Persist across restarts. |
| `baseballLayout` | `classic` (default), `logos`, or `bands`. Sent as `mlb.layout`. |
| `logoBright` | 10–100, default 90: logo and band brightness in the `logos`/`bands` layouts, sent as `mlb.dim`. |
| `radarTime` | Boolean, default `true`. Sent to the board as `radar.showTime`; off shows the temperature instead of the frame time. |
| `bright` | `auto`, an integer 0–100, or `off`. Reset to `auto` on boot. |

**Stations:** `server/board/stations.json` lists every L station: `mapid`, name, descriptive name, lines served, and coordinates. It is generated from the City of Chicago "CTA System Information - List of 'L' Stops" dataset (`8pix-ypme`, the list the Train Tracker docs point to) by a script in `scripts/` and committed. That dataset has one record per platform; the script groups by `map_id` and takes `station_name`, `station_descriptive_name`, the line flags (`red`, `blue`, `g`, `brn`, `p`, `y`, `pnk`, `o`), and `location`. Each entry: `{mapid, name, desc, short, lines, lat, lon}`. `short` is the header name from `shortName()` in `server/board/station-names.js`: the uppercase name if it fits the 42px header budget, else the name with ordinals dropped (`95/DAN RYAN`), else a curated entry. The build fails if any name overflows without a curated entry. Picking a station on the phone copies `short` into the board's `station.name`, which stays editable. Station names repeat across lines (four Damens, three Addisons, Californias, Chicagos, Ciceros), so the picker shows the descriptive name with lines; the header shows the short name only. The control page's station picker and the location lookup both read it. (The map's GeoJSON has track lines only, no station points or `mapid`s.)

**Location assets:** the radar water mask, time box, and split flag depend on the location, and the location is the station. A script in `scripts/` generates them for **every station** and commits them under `server/board/locations/<mapid>.json`, so changing stations from the phone needs no build step. Nearby stations will share near-identical masks; that's fine at ~2 KB each.

---

## Server polling

After a failure, Train Tracker, NWS, and Open-Meteo retry in 30 s, doubling with each failure in a row up to 5 minutes (or the interval, if longer); a board request doesn't wait during that backoff.

| Source | Interval | Notes |
|---|---|---|
| Train Tracker `ttarrivals` | 30 s per unique `mapid` | Only for boards that polled in the last 2 min. One `mapid` call returns every line and direction at the station. |
| CTA alerts | 3 min | Shared with the map's `/api/alerts`. |
| NWS alerts | 90 s per location | `User-Agent` header required. |
| Open-Meteo | 10 min per location | Only while a board polled in the last 5 min; last good data kept. |
| MRMS `lcref` via IEM | 5 min per location | Always runs, since it decides `radar.on`. |

---

## Open items

- **(decide)** Arrival drop grace (30 s) and whether `DUE` should also honor `isApp`.
- Schedule-based predictions (`isSch=1`) are shown and marked via `s` (decided Oct 3: grey times on transit, clock on ticker). `isFlt=1` is shown normally. Ticker clock is the `CLOCK` glyph (U+E006).
- Tune `radar.on` hysteresis (provisional 30 on / 10 off) on more archived storms.
- Tune snow thresholds (provisional 10/15/20 dBZ, from one storm) on more snow events.
- Later: per-pixel precip type from MRMS `PrecipFlag` (GRIB2, CONUS-wide). Needs a decoder and a memory check on the Fly VM before it replaces the heuristic.
- Confirm the payload stays under ~1.2 KB at a 5-row station.
- **(decide)** Condition word list for `wx.word` (previews use SUNNY, CLEAR, PT CLOUDY, CLOUDY, RAIN, FRZ RAIN, SNOW, STORMS, FOG as placeholders).
