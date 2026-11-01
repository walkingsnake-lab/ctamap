# LED Board API Contract

The contract between the server (`server/board/`) and the board (CircuitPython on the Matrix Portal M4). **Source of truth:** any change to an endpoint, payload field, or frame format updates this file in the same PR. Design rationale lives in [`design-spec.md`](design-spec.md).

Status: **draft v0**. Items marked **(decide)** are open.

---

## Conventions

- **Base URL:** `https://ctamap.fly.dev`
- **Times:** all timestamps are **epoch seconds (UTC)**. The server converts CTA's zone-less Chicago local times before sending. With `outputType=JSON`, `arrT`, `prdt`, and `tmst` look like `2026-10-03T23:16:07` (ISO without an offset), not the `yyyyMMdd HH:mm:ss` the API docs show for XML.
- **Clock sync:** every JSON response includes `now`, the server's epoch time. The board keeps `offset = now - time.monotonic()` and uses it for countdowns and clocks. No NTP on the board.
- **Board ID:** query param `b` (e.g. `b=home`). State is keyed by board ID. Each physical board gets its own ID (`BOARD_ID` in the S3's `secrets.h`, the M4's `settings.toml`); two boards with the same ID share one config and show the same thing. A board with an ID the server doesn't know adds itself on its first `/board/update` (see there).
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

### `GET /board/version?b=<id>[&hu=…]`
Polled ~every 10 s.

**Health** (optional query fields, refreshed by the board about once a minute): `hu` uptime (s), `hm` free memory (bytes), `hl` largest single allocatable block (bytes; the fragmentation measure), `ho` draws skipped on `MemoryError`, `hb` fetch budget (ms; the S3 sends its average request time, which the control page shows as Fetch time), `hf` failed fetches, `hr` WiFi reconnects, `hw` WiFi RSSI (dBm), `ha` the light sensor's reading (lux at the chip, smoothed; S3 with a sensor only; current on every check, while the other fields are refreshed once a minute), `he` last error as `<job>:<ExceptionName>` (letters, digits, `_`, `:` only; anything else is dropped), `hs` what started the current run (`SUPERVISOR_RELOAD` after a crash, `AUTO_RELOAD`, or the chip's reset reason: `POWER_ON`, `WATCHDOG`, `BROWNOUT`, `RESET_PIN`, ...), `hc` the crash that ended the previous run as `<ExceptionName>:<file>:<line>:<function>` (same characters; sent through the run after it), `hd` the hardware (`adafruit_matrixportal_s3`), `hv` the firmware build (the short commit it was built from, plus `_dirty` with uncommitted changes, or `dev` when unstamped; same characters), `hx` the S3's OTA state (see **Firmware**): `trial:<build>` while a newly installed build is on trial, `error:<reason>` after a failed install this run, `rolledback:<build>` while the offered build is one this board rolled back, `unsigned:<build>` while the offered build has no signature, `nokey:<build>` when the board's own build has no signing key (it installs nothing) (same characters). Uptime counts from the start of the current run, so a crash reload counts as a restart. The server keeps the latest report per board in memory, plus the lowest free memory and a restart count (uptime going backwards) since the server started; the control page shows them (`api/health`). `hk` capabilities beyond the original screens, colon-separated (`skyline`: the firmware draws the clock screen's skyline face; `seventies`: also its seventies face; `announce`: the announce screen); sent with every report, so a rollback to a build without it turns the clock screen (or announce) off again.

```json
{"v":42,"now":1759546800}
```

`v` is the board's **settings version**. It increments on every phone change and on boot reset. When `v` differs from the last seen value, the board fetches `/board/update` immediately.

`fw` (S3 only, present only when there's something to install) offers an OTA build: `{"v": "a1b2c3d", "size": 1245184, "sha": "<SHA-256, hex>", "n": 0, "sig": "<signature, hex DER>"}` (`sig` absent for a build stored before signing). See **Firmware**.

### `GET /board/update?b=<id>[&boot=1][&s=<screen>][&hk=<caps>]`
The combined update, polled ~every 30 s. `hk` (S3): the same capabilities as the health field, sent on every update and select so the server decides the clock and announce screens per request (it doesn't depend on the last health report, which is lost on a server restart and overwritten by any other board reporting under the same ID). Target size ≤ ~1.2 KB (typically 0.5–0.75 KB with sections).

**Sections.** To keep JSON parsing light on the board's fragmenting heap, this endpoint sends only what one screen draws, named by `for`: the payload's `screen`, or `s` (`transit`, `ticker`, `weather`, `baseball`, `clock`, `announce`) when a button press on the board overrides it. The board fetches right away after a press, asking for the new screen. Fields kept only for their screen: transit `header`, `key`, `hidden`, `view`, `rows`, `wx`; ticker `ticker`, `tickerHeader`, `tickerFill`; baseball `mlb`; clock `skyline`, `cface`; announce `msg`. `radar` is whole on the weather screen and whenever `radar.visit` is set (the board switches to it by itself); otherwise it's just `{on, visit: null}`. Everything else is always sent. The simulator's `api/update` returns the whole payload.

**New boards.** An authed update for an unknown but valid ID (1–32 chars of `a-z`, `0-9`, `-`) creates that board as a copy of board `home` (or the first board, if `home` is gone): station, filter, screen and every setting, with `v` 1 and `bright` `auto`. From then on it's configured separately. At most 8 boards; past that, or for an invalid ID, it's `404`. Only `/board/update` creates boards; `/board/version`, `/board/select` and the frame endpoints answer `404` for an unknown ID.

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
| `stn` | string | The board's station (mapid). When it changes, the board starts the transit and ticker screens fresh instead of animating from the old station's rows. |
| `now` | int | Server epoch seconds. |
| `tzo` | int | Chicago's UTC offset in seconds at `now` (-18000 CDT, -21600 CST). The board adds it to epoch times for every clock (CircuitPython has no time zone database). Refreshed with every update, so DST changes take effect within one fetch. |
| `age` | int \| null | Seconds since the arrivals data was last fetched successfully, or `null` when the server hasn't reached Train Tracker since it started (the update is still sent, with no rows). The server keeps serving last-good data when CTA fails. |
| `stale` | int | `1` when there's no arrivals data or it's more than 3 minutes old (`STALE_S` in `index.js`): the transit and ticker screens draw a red (`#ff2020`) line along the top edge (row 0, full width), and the overnight layout says `NO DATA` instead of `NO TRAINS`. Otherwise `0`. |
| `screen` | string | Screen to show, **already resolved** from auto rules: `transit`, `ticker`, `weather` (radar loop while raining; see *Radar*), `baseball`, `clock` (see *Skyline*; only for a board whose health reports the `skyline` capability, otherwise `transit`; Auto never resolves to it), `announce` (see *Announce*; only for a board that reports the `announce` capability, otherwise `transit`; Auto never resolves to it). `auto` resolves to `weather` while an NWS alert matching the board's `alertJump` is on (over baseball), else `baseball` while `mlb.games` is non-empty, else the board's first Auto screen (`autoScreens[0]`, `transit` by default); `rot` alternates the Auto screens and timed weather visits ride on top, see `rot` and `radar.visit`. A local button press overrides it until `v` changes. Firmware before the baseball port draws `transit` for `baseball`. |
| `bright` | int | Global brightness 0–100, already resolved: `auto` is 100 from sunrise to sunset and the board's `brightMin` (default 40) overnight (WeatherAPI times for the station's grid cell; 100 until weather data arrives), or the fixed level, or 0 for off. |
| `ab` | object \| null | Auto brightness on a board with a light sensor: `{min}` (percent), sent while `bright` is `auto`, else `null`. An S3 with a working sensor uses it in place of `bright`: 100 in a bright room down to `min` in the dark, linear in log lux (`firmware-s3/ctaboard/src/light.h`), and falls back to `bright` when the sensor stops answering. Boards without one, and the M4, ignore it. |
| `rot` | object \| null | Auto alternating its screens: `{screens, every}` (`screens`: 2+ of `transit`, `ticker`; `every` s). Set only on the auto screen when `screen` is one of `screens`. The board (and simulator) shows `screens[floor(now / every) % screens.length]`, epoch-aligned (`autoScreen()` / `auto_screen()`); the board's `/board/update` then carries every rotation screen's sections. |
| `knob` | object | The knob's ring (design spec §10, *Knob*): `{ring, at}`. `ring` lists categories in dial order, today `auto`, `transit`, `weather`, `sports`, plus `clock` and then `announce` at the end on boards with the `skyline` and `announce` capabilities; the board shows each in uppercase. `at` is where the board's chosen screen sits on it (`ticker` counts as `transit`, `baseball` as `sports`), so a turn starts from there. Always sent. The S3 draws it as the chooser (`draw.js` `renderChooser`) and commits with `/board/select`; the M4 ignores it. |
| `hclock` | bool | Clock at the right of the transit and ticker headers (state `headerClock`). |
| `lnc` | bool | Transit and chronological labels in the line's color instead of white (state `lineNames`). |
| `ts` | bool | Transit (destination rows): the third time in `#332300` (20% amber; schedule-based `#151515`) instead of the second time's `#664600` / `#2e2e2e` (state `timeSteps`). Default `false`. |
| `header` | string \| null | Station name for the transit header (with `key`, for the station line at the bottom), or `null` when it's off or hidden to fit (see *Fitting the header, weather strip, and key*). |
| `key` | `1` \| absent | Transit only, key layout (state `transitLayout` `key`): the `trains to` / `min` key on rows 1–5, and `header` (if not null) on rows 27–31 under a `#333333` divider on row 25, unlit, instead of the top. Absent in the header layout, or when the key is hidden to fit 5 rows. |
| `headerDivider` | bool | Transit only: a `#333333` line on row 7 under the header (rows still start at row 9). Default `false`. |
| `tickerHeader` | string \| null | Station name for the ticker header. Always sent: the ticker shows its header even when the transit header toggle is off. (Boards without it fall back to `header`.) |
| `hidden` | array | Which of `"weather"`, `"header"`, `"key"` the server hid to fit this update's destinations, for the phone page and simulator. The board just follows `header`, `key`, and `wx`. |
| `view` | string | Transit view: `dest` (one row per destination, up to 3 times) or `chrono` (one row per train, soonest first). Chosen by the server; see *Transit view* below. |
| `rows` | array | Transit rows, already filtered and ordered. `dest`: **capped** to the max for the header/weather/key toggles (5 minus one for each shown). `chrono`: the cap **plus 2** extra trains; the board shows the first *cap* live rows. Empty array means no predictions: the board shows the overnight layout. |
| `ticker` | array | Up to 6 individual arrivals in time order for the ticker. |
| `wx` | object \| null | Weather strip, or `null` when the strip is off, hidden to fit, in the key layout, or there's no weather data yet (the row cap then gives the space back to rows). |
| `warn` | object \| null | Active NWS warning/watch (see below). Sent regardless of the weather-strip toggle, since the radar screen uses it too. |
| `radar` | object | Radar state (see below). |
| `anim` | object | Speed settings, from the board's state: `{pageHold, slide, radarFrame, radarHold, game}`. Ticker page hold and slide (ms), radar loop frame step and the hold on the newest frame (ms), and baseball rotation per game (s). Defaults 8000, 1200, 500, 4000, 60 (`timing()` in `draw.js` fills in any missing one). |
| `tickerFill` | int | Ticker row fill: the line color at this percent behind the white text (25–80, default 55). |
| `skyline` | object \| null | Clock screen, skyline face: drawing parameters (see *Skyline*), or `null` without weather data or on the seventies face. Sent only with `for` `clock`. |
| `cface` | string | Clock screen face: `skyline` or `seventies` (see *Seventies*). Sent only with `for` `clock`. Firmware without the seventies face ignores it; the server never sends it `seventies`. |
| `msg` | object \| null | Announce screen: the owner's message laid out for its style (see *Announce*), or `null` when none is set (the board asks for one). Sent only with `for` `announce`. |
| `mlb` | object | Baseball: `{layout, dim?, all?, games: [...]}` (`all: true`: rotate every game, live or not, state `bbPriority: 'all'`), the layout and the games to show now (see *Baseball* below). Always present; `games` is empty when there's nothing on. |

All screens' data is always included so a button press switches screens without a fetch.

#### Which predictions are shown
Learned from recorded fixtures (`server/board/fixtures/tt-arrivals/`):
- **Trains ending at this station are dropped**: a prediction whose `destNm` equals the station's `staNm` (Howard), whose `destNm` maps to this station in `DEST_MAPID` (`server/board/destinations.js`; e.g. "63rd Street" at Ashland/63rd), or whose `stpDe` says "Terminal Arrival".
- `destSt` is `"0"` and `lat`/`lon` are null on schedule-based predictions; `lat`/`lon` can also be `"0"`. Don't rely on them.

#### Row order and fitting (server)
- With no `rows` list in the board config, rows are ordered by line (`RD BL BR GR OR PR PK YL`), then Train Tracker direction (`trDr`), then name. With a list, the list is the order and the filter; destinations CTA doesn't normally use are appended after it.
- When the destinations (after the filter) exceed the cap for the header/weather/key toggles, the server sends the chronological view instead of dropping rows. The ticker uses the same filter but not the cap.
- Times are drawn 3px apart, tightening to 2px when the label would otherwise come within 3px of them. Transit labels are fitted per row against the 2px spacing at the times' widest before the next update (digits only shrink as times count down, but the first time may turn into `DUE`), so 7-letter names like `KIMBALL` and `COTTAGE` always fit.
- Ticker destinations are fitted to 32px of 5x7 (`Jeff Pk` is exactly 32).

#### Fitting the header, weather strip, and key (server)
The board's `showHeader` / `showWeather` (and, in the key layout, the key) are the most it shows; each takes one row. On every update the server counts the destinations (after the row filter) and fits them (`fitBars` in `arrivals.js`):

| Destinations | Header | Weather strip | View |
|---|---|---|---|
| fit with both (up to 3) | shown | shown | rows |
| fit without the weather strip (4) | shown | hidden | rows |
| 5 | hidden | hidden | rows |
| 6 or more | shown | hidden | one train per row |

Key layout (no weather strip):

| Destinations | Key | Station line (`header`) | View |
|---|---|---|---|
| up to 3 | shown | shown | rows |
| 4 | shown | hidden | rows |
| 5 | hidden | hidden | rows |
| 6 or more | shown | hidden | one train per row |

So a station with rush-only service (Purple at Merchandise Mart) gains and loses the weather strip on its own. The weather strip and station line never show with the chronological list.

#### Transit view (server)
- `chrono` whenever the destination count exceeds the cap, `dest` otherwise, decided on every update. `CHRONO_HOLD` in `arrivals.js` (0 now) can add a hold before switching back; that state is kept in memory per board and station.
- `chrono` rows each carry one time (`t` and `s` have one entry) and `rn`. Labels are fitted against the widest chrono time (`99m`).

#### CTA alerts (server)
- One poller (`server/board/cta-alerts.js`, every 3 min) fetches `alerts.aspx?activeonly=true&routeid=red,blue,brn,g,org,p,pink,y` (XML) for both the map's `/api/alerts` and the board. Every `<Service>` in `<ImpactedService>` is read; only `ServiceType` `R` (train routes) count, so a station listed first (43rd before Green Line) doesn't hide the line.
- **Board rule:** a line's `a` is `1` only when an alert covering it has `SeverityCSS` `major` or `MajorAlert` `1`. Minor delays (`minor`), planned work (`planned`), schedule changes, long-term closures and elevator outages (`special-note`) aren't marked. Fixture: `fixtures/cta-alerts/2026-10-04-1057.xml` (7 alerts, none major, so nothing is marked).
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
| `a` | `1` if the line has an active **major** CTA alert: the row shows `al` instead of `lbl`, then the red alert circle (static); see *CTA alerts* below. The frozen M4 ignores `al` and dims the block to 20% under a full-color "!" instead. |
| `al` | With `a` `1` only: the label to draw before the alert circle, uppercase. Fitted so the label, a 2px gap, the 5px circle and a 2px gap fit before the **widest** times the row's count can reach (the first `DUE`, the rest two digits, 2px apart; chronological rows: `99m`), so it never changes length as the times count down. The whole name when it fits (typically with two times or fewer); otherwise cut and ended with the two-dot `CUT` glyph (U+E009), e.g. `KIMB‥`. |
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
- **Only on a fresh payload:** the server drops an arrival with the same rule, and a held DUE train's `t` keeps moving later on the server (above). So while the payload's `now` is before `t + 30`, the board keeps the arrival (still DUE) and fetches an update right away; the fresh payload either no longer lists it (it fades out) or carries its later time. Without a fresh payload it drops at `t + 90` at the latest (`HOLD_MAX` 60 s; `isShown()` in `draw.js`, `is_shown()` in `draw.py`). The board's payload can be up to a minute older than the simulator's, which used to make a held train vanish on the board, then come back.

#### Weather strip (`wx`)

Drawn on rows 27–31 (Tom Thumb, baseline 32, `#555555`, no divider): `temp` + `°` from x0, `word` flush right to x63. A `warn` replaces `word` with the glyph, a 3px gap, and `WATCH` / `WARNING` in the warning colors, flush right (a tornado warning blinks). `icon` isn't drawn on the strip.

| Field | Meaning |
|---|---|
| `icon` | `sun` `moon` `pcloudy_day` `pcloudy_night` `cloudy` `rain` `ice` `snow` `storm` `tsnow` `fog` (`tsnow`, thundersnow, is newer: boards whose assets lack it draw the word without an icon, as for any unknown name) |
| `temp` | Current temperature, integer: °F, or °C with the board's `tempUnit` `C`. The board draws it with the small `°` glyph (U+00B0). |
| `icon` | Current weather icon name (same set as `wx.icon`), or `null` before the first weather fetch. |
| `word` | Condition word, uppercase, fitted. |
| `hi`, `lo` | Daily high/low in the board's unit. |

When `warn` is non-null, the board replaces `word` with the warning tag.

From WeatherAPI.com (`server/board/weather.js`; fixture `fixtures/weatherapi/`): one `forecast.json?q={lat},{lon}&days=3&aqi=no&alerts=no` per **grid cell**, with the key in `WEATHERAPI_KEY`. Stations share a cell per 0.1° of latitude and longitude (the 144 L stations fall in 10 cells), fetched at the mean position of the cell's stations. `temp` is `current.temp_f` rounded; `hi`/`lo` today's `day.maxtemp_f` / `day.mintemp_f`; `feels` `current.feelslike_f`; wind `current.wind_mph` and `wind_degree`; sunrise/sunset today's `astro` clock times (`06:51 AM`, Chicago). `pop` is the highest `chance_of_rain` or `chance_of_snow` over the 6 hourly slots from the current hour (the hour holding the response's `location.localtime_epoch`). The fallback `days` are the forecast days after today (2 on the free plan) and `hours` the hourly slots; NWS replaces both (below). WeatherAPI has no 15-minute precipitation on this plan, so there are never rain bars from it. WeatherAPI's condition codes are translated to WMO codes, so the icon and word rules below (and snow mode) read WMO: 1000 → 0; 1003 → 2; 1006, 1009 → 3; 1030, 1135 → 45; 1147 → 48; 1063, 1240 → 80; 1243 → 81; 1246 → 82; 1150, 1153 → 51; 1180, 1183 → 61; 1186, 1189 → 63; 1192, 1195 → 65; 1072, 1168 → 56; 1171 → 57; 1069, 1198, 1204, 1237, 1249, 1261 → 66; 1201, 1207, 1252, 1264 → 67; 1066, 1255 → 85; 1258 → 86; 1210, 1213 → 71; 1114, 1216, 1219 → 73; 1117, 1222, 1225 → 75; 1087, 1273, 1276, 1279, 1282 → 95; the haze, dust, smoke and smog codes (1012–1048) → 45; anything unknown → 3. WMO code → `icon` / `word`: 0–1 `sun` SUNNY or `moon` CLEAR (by `is_day`); 2 `pcloudy_day`/`pcloudy_night` PT CLOUDY; 3 `cloudy` CLOUDY; 45, 48 `fog` FOG; 51–55, 61–65, 80–82 `rain` RAIN; 56–57, 66–67 `ice` FRZ RAIN; 71–77, 85–86 `snow` SNOW; 95–99 `storm` STORMS; anything else `cloudy` CLOUDY. WeatherAPI's own code refines what WMO lumps together (current conditions, and the fallback day and hour icons): 1030 `fog` MIST; 1012 `fog` HAZE; 1033, 1036 `fog` SMOKE; 1039, 1042 `fog` SMOG; 1015, 1018, 1021, 1024, 1027, 1045, 1048 `fog` DUST; 1279, 1282 (thundersnow) `tsnow` THNDRSNOW. Terms: the free plan credits WeatherAPI.com by name and data shown to people carries WeatherAPI's disclaimer (both on the control page); current conditions are kept at most 60 minutes (conditions whose `last_updated_epoch` is over an hour old aren't sent).

**NWS forecasts** (`server/board/nws-forecast.js`; fixtures `fixtures/nws-forecast/`) replace WeatherAPI's forecast fields: `hi`, `lo`, `pop`, `wx.days`, and `wx.hours`. The server looks up the station's grid once (`/points/{lat},{lon}`), then polls its 12-hour `forecast` and `forecast/hourly`. `hi` is today's daytime period's temperature and `lo` tonight's ("This Afternoon" / "Tonight"); once today's day period is over (NWS drops it in the evening), `hi` stays WeatherAPI's. `pop` is the highest `probabilityOfPrecipitation` over the next 6 hourly periods from the current one. Day and hour icons come from the period's NWS icon code (`/icons/land/{day|night}/{code}[,pct][/{code2}...]`), used as sent, with no rain-chance threshold; a split icon (two halves of the period) uses its first half. Codes: `skc`, `few` (and `wind_`, `hot`, `cold`) `sun`/`moon`; `sct`, `bkn` (and `wind_`) `pcloudy_day`/`pcloudy_night`; `ovc` `cloudy`; `rain`, `rain_showers`, `rain_showers_hi` `rain`; `snow`, `rain_snow`, `snow_sleet`, `blizzard` `snow`; `sleet`, `fzra`, `rain_fzra`, `snow_fzra`, `rain_sleet` `ice`; `tsra`, `tsra_sct`, `tsra_hi`, `tornado`, `hurricane`, `tropical_storm` `storm`; `fog`, `haze`, `smoke`, `dust` `fog`; anything else `cloudy`. Each field keeps WeatherAPI's value when NWS has nothing for it (no data yet, or the saved data has run out). Current conditions (`temp`, `icon`, `word`, `feels`, `wind`), snow mode, and sunrise/sunset stay WeatherAPI's. 

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
| `visit` | `{every, for, always?}` in seconds, or `null`. Set only when the board's `screen` is `auto` and `wxVisit` is `rain` or `always` (`for` is capped at `every`; `always: true` for `always`). The **board** (and simulator) shows the weather screen while `now mod every < for` and `on` (or `always`) is true, otherwise the payload's `screen` (`transit`); cycles are epoch-aligned. Mirrored by `autoScreen()` in `draw.js` and `auto_screen()` in `player.py`. The board fetches radar frames ahead of a visit whenever `on` and `visit` are set. A button press overrides it until `v` changes. |
| `frames` | IDs of up to 6 latest frames (6 minutes apart, 30 minutes end to end, on a 6-minute grid; all even minutes), oldest first; only frames from the current loop (after a quiet spell, older frames aren't sent and `on` is `false` until new ones arrive). Frame IDs are immutable, so the board fetches only IDs it doesn't already have, newest first. ID: `<mapid>-<YYYYMMDDHHMM UTC>`, plus `s` for a snow frame (so a station or mode change never reuses a cached frame). |
| `showTime` | Boolean (absent = true). `false` replaces the time and AM/PM with current conditions: the weather `icon` (8x8) and `temp` (Tom Thumb with a degree sign, label white), right-aligned under the frame indicator. The warning tag moves to the screen's bottom right (rows 27–31, right edge x63, on a black backing; it may run past the time box): icon + `WATCH` or `WARN`. With no `temp`, only the tag. |
| `clock` | `"now"`, `"age"`, `"none"` (absent = frame time). `now`: the clock shows the current time in clock white (`#cccccc`) on every frame instead of the shown frame's time in dim gray; AM/PM, the indicator and the warning icon are unchanged. `age`: how long ago the shown frame is, `3m`, `10m` (`floor((now − frame time + 30) / 60)` minutes, at least 0), in dark gray (`#666666`) Tom Thumb right-aligned under the frame indicator (baseline `timeBox` top + 11, rows 6–10), with no clock or AM/PM, and the warning tag at the screen's bottom right as with `showTime: false`. `none`: nothing in the corner but the frame indicator: no clock, AM/PM or temperature, and the warning tag at the bottom right if there is one. `showTime: false` (the weather icon and temperature) takes precedence over all three. From the board's `radarClock`. |
| `cond` | `true` (absent = off), with the time on: a compact corner. The clock line holds the time and a one-letter `A`/`P` (Tom Thumb, dark gray `#666666`, 1px after the time, bottom-aligned: rows 8–12); the temperature (`temp`, the same dark gray, no icon) is right-aligned under it on rows 15–19; the warning tag moves to the bottom right as with `showTime: false`. From 10:00 to 12:59 the clock line is 26px and starts at x38, 2px left of the 24px time box (its black margin then covers 2 more columns of radar, or the split divider on rows 5–13). With no `temp`, only the clock line. From the board's `radarCond`. |
| `rb` | Precipitation brightness, percent (absent = 100): scales the precip colors (values 1–5, 8–10; not the shoreline or marker) of the radar palette. From the board's `radarBright`. |
| `temp` | Current temperature (board unit, rounded) from WeatherAPI, or `null` before the first weather fetch. Sent whatever the weather strip setting. |
| `ft` | Frame timestamps (epoch), parallel to `frames`; used for the radar time. |
| `timeBox` | `[x, y, w, h]`: box the board draws the time stack into (frame indicator, time, AM/PM + warning icon), right-aligned. The server does not clear it (the shoreline can run into it); the board clears a 1px black margin around each piece it draws there (indicator, time, AM/PM, warning icon, or the weather icon and temperature), so nothing touches them. |
| `split` | `true` when the location has no usable water area; the time box is then the right-side panel. Per station, from `server/board/locations/<mapid>.json`: **full width** (`split: false`, marker at 32,16, clock box `[40, 0, 24, 22]` over Lake Michigan) when the area the widest clock stack draws on (cols 41–62, rows 2–19) is all water; otherwise **split** (radar in cols 0–38, marker at 19,16; the board draws a gray `#333333` line on col 39; clock box `[40, 0, 24, 32]`, leaving a 1px gap before the widest clock). 114 of 144 stations are full width. The board draws the clock stack **top-aligned**: indicator rows 2–3, clock rows 6–12, AM/PM rows 15–19, right-aligned to column 63. |

| `wx` | Weather screen conditions, sent whenever there's weather data (even with the weather strip off): the top-level `wx` fields plus `feels` (apparent temperature in the board unit, rounded), `wind` (`"NW 12"`: 8-point compass the wind blows from + mph, rounded; `"CALM"` under 1 mph; just the speed without a direction), and `pop` (highest hourly precipitation probability % over the next 6 hours, starting with the current hour). Each of the three is `null` when WeatherAPI didn't send it. `rl` is `1` while the conditions screen shows its RAIN line (absent otherwise): from `pop` 20 % up, then until it drops below 10 % (a buffer, so a chance hovering near one value doesn't move the readout between three and four lines; `rainLine()` in `weather.js`, kept per board and station in memory, so a restart or a new station starts with the line off until 20 %). Omitted before the first weather fetch. With the board's `tempUnit` `C`, every temperature in it (and `days`, `hours`) is °C and `wx.c` is `1`: the board converts back to °F (`t * 9 // 5 + 32`, integers) only to pick `TEMP_STOPS` colors. Wind stays mph. |
| `wx.hours` | Only with the board's `wxView` `hourly` (absent otherwise, or without hourly data): four columns `{h, icon, t}` for the hours 2, 4, 6 and 8 after the current hour: `h` the Chicago hour as `3P`, `12A`; `icon` from that NWS hour's icon (night variants; WeatherAPI's hourly condition and `is_day` without NWS data); `t` in the board unit, rounded. The weather screen draws the hourly layout instead of conditions. |
| `wx.rain` | Only with the board's `wxRain` `bars` or `both` and precipitation falling or due in the next 2 hours (absent otherwise, or without 15-minute data): `{snow, now, title, h, l}`. `snow` 1 when snow is at least half the water (`snowfall` ÷ 0.7 cm per mm against `precipitation`, over the 8 steps; the whole view is one kind), else 0. `now` 1 when it's falling in the current quarter hour (informational; the board doesn't draw it). `title` is final text: `RAIN IN 25 MIN`, `RAIN NEXT 2 HRS`, `ENDS IN 60 MIN`, `BREAK IN 30 MIN` (rain now, dry, then more), with `SNOW` for snow; minutes are to the next 5, at least 5. `h` and `l` are 8 bars (the next 8 quarter hours after `now`): height 0 (dry) or 1–10 rows, `round(sqrt(rate / full) × 10)` with rate = mm per 15 min × 4 in mm/h and `full` 10 (rain) or 4 (snow); level 0 (dry) or 1–3 at 2.5 / 7.6 mm/h (rain) or 1 / 2.5 mm/h (snow). `alt` and `loops` (only with `both` while radar `frames` are sent): `alt` is the seconds of bars per turn and `loops` the full radar loops before them. The loop plays `loops` full cycles from its start (the cycle as `radarLoopIdx()` counts it, the newest-frame hold included), then the bars show for `alt` s, then the loop starts again (`rainBarsTurn()`, `rain_bars_turn()`; `t` is ms since the loop started, the epoch clock in the simulator). Without `alt`, the board draws the bars whenever it has no frames to show. |
| `wx.days` | Only with the board's `wxView` `5day` (absent otherwise, or without forecast data): the days after today, up to 5, as `{d, icon, hi}`: `d` the two-letter weekday (`SA`), `icon` from that day's NWS daytime period (day icons; WeatherAPI's daily condition without NWS data), `hi` the day's high in the board unit (the daytime period's temperature), rounded. When present, the weather screen draws the 5-day layout instead of conditions. |

**Weather screen.** The `weather` screen (formerly `radar`) draws the radar loop only when `frames` is non-empty, otherwise current conditions from `wx`. The server sends `frames`/`ft` **only while `on`** (empty otherwise), so the screen shows the radar while rain is in the box and the weather the rest of the time, and the board fetches no frames without rain. With no `frames` and no `wx`, the board draws the empty radar with the clock stack at the current time. While any frame is still downloading, the board holds on the newest frame it has (never an empty frame, never stepping back in time); the frame that completes the set restarts the loop at its oldest frame. Until the first frame lands, it shows the `wx` conditions screen (`radarLoopIdx()` / `radar_loop_idx()`). Layout (Tom Thumb unless noted; `drawConditions()` in `draw.js`, `draw_conditions()` in `draw.cpp`; preview `previews/mock-weather-screen.png`). The frozen M4 (`draw_weather_screen()` in `draw.py`) keeps the earlier layout: big 9x15 Bold temperature, icon and word, divider on row 18, `FEELS` + wind, `H … L …` + rain chance, a warning on the bottom line.
- Rows 0–7: the 5-day layout's top row (*Top row* below): icon, temperature, `↑hi ↓lo`; a watch or warning takes over the high/low and a tornado warning blinks.
- Below it, a readout: the label grey (`#808080`) at x0, the value right-aligned to x63, and dot leaders `#333333` on the row above the baseline, on odd columns only, at least 2px clear of the label and the value. Lines, in order:
  - `SKY`: `word`, colored by `icon`: `rain`/`ice` `#4aa0ff`, `snow`/`tsnow` `#c8e8ff`, `sun` `#ffc800`, `moon` `#ffe47a`, anything else label white.
  - `FEELS`: `feels` + `°` on the temperature scale with its cold end lifted for text (−10 °F `#6080ff`, 20 °F `#60b0ff`, then `TEMP_STOPS`); rolls (`wx.feels`). Skipped when `feels` is `null`.
  - `WIND`: `wind` + ` MPH` (`CALM` alone), label white. Skipped when `wind` is `null`.
  - `RAIN`: `pop` + `%` in `#1e90ff`, only while `rl` is set (and `pop` isn't `null`); rolls (`wx.pop`).
- Four lines sit on rows 9–13, 15–19, 21–25, 27–31; three or fewer on rows 11–15, 18–22, 25–29 (the first level with the 5-day's weekday row).

**Hourly layout** (`wx.hours` present and no `wx.rain`; `drawHourly()` in `draw.js`, `draw_hourly()` in `draw.py`; preview `previews/mock-weather-hourly.png`): the 5-day layout's top row, then four 16px columns, centers x7, 23, 39, 55, split by `#333333` dividers on cols 15, 31, 47 (rows 10–31). Per column: `h` grey centered (baseline 15), the icon at center − 4, y17, and `t` centered (baseline 31) in its temperature color, condensed like the day highs. The top row follows *Top row* below, a warning included.

**Rain bars** (`wx.rain` present; `drawRainBars()` in `draw.js`, `draw_rain_bars()` in `draw.py`; preview `previews/mock-weather-rain.png`; the top row is the 5-day layout's, below): rows 10–14 hold `title` (Tom Thumb baseline 14) centered on x32 in `#60b0ff` (snow `#a9c9ff`), with a 3x4 drop (`#1e90ff`, rows 10–13) or the 5x5 flake (snow color, rows 9–13, level with the text) and a 2px gap in front only when the title doesn't say RAIN or SNOW (`ENDS IN…`, `BREAK IN…`: the icon stands in for the word, never both) and it fits. Eight bars 7px wide on an 8px pitch (x0, 8, …, 56) rise from row 25, up to 10 rows (rows 16–25); a dry step is a 1px `#081428` baseline on row 25. Level colors rain `#0a2a78` `#0f48c0` `#1a6cff`, snow `#3357a6` `#6e83a6` `#a6a6a6`. Axis (Tom Thumb, baseline 31, `#555555`): `1H` centered on x31 (the gap between bars 4 and 5), `2H` right-aligned to x62.

**5-day layout** (`wx.days` present and no `wx.rain`; `drawFiveDay()` in `draw.js`, `draw_five_day()` in `draw.py`; preview `previews/mock-weather-5day.png`):
- **Top row** (shared by the 5-day, hourly and rain-bar layouts), today on rows 0–7: the `icon` at x1, y0; `temp` in X11 5x7 at x11 (a 2px gap after the icon), baseline 7, label white, then a Tom Thumb `°` (baseline 6); with the board's temperature shadow on (`radar.tempShadow`, the same setting as the conditions screen's) both are over a shadow drawn 1px right and 1px down in the temperature color (`TEMP_STOPS` blend below) at 20%; the high and low as `↑63 ↓49` (Tom Thumb, baseline 7: level with the bottom of the big temperature, not its shadow; the arrows are the small font's 5x5 `UP` U+E007 and `DOWN` U+E008 glyphs) right-aligned to x62 (a 1px margin, like the icon's), the arrows `#4a4a4a` and the numbers grey `#8f8f8f`. With an NWS watch or warning (`warn`) this line shows the warning instead: the bolt or funnel glyph, a 3px gap and `WATCH` or `WARN` in the warning's color, right-aligned to x62 (baseline 7); a tornado warning blinks like the others (hidden on the blink phase). The layouts below stay as they are. The numbers are condensed like the day highs (a three-character or negative number draws `1` with a 3px advance and the minus as a 2px bar). When it would still come within 1px of the temperature's ink (shadow included; a three-character temperature with long highs and lows), the space before the down arrow goes, then the arrows (just `-100 -100` in grey).
- Five 13px day columns, centers x6, 19, 32, 45, 58, split by `#333333` dividers on cols 12, 25, 38, 51 (rows 10–31). Per column: `d` grey centered (baseline 15), the day's icon at center − 4, y17, and `hi` centered (baseline 31) in its temperature color (the `TEMP_STOPS` blend, blue −10°F to red 100°F). Three-character highs (100+, −10 and below) draw tight to keep a pixel off the dividers: `1` advances 3 and the minus is a 2px bar (row 28); every negative high uses that minus. Fewer than five days leave the right columns empty.

When `on` is false, `frames` and `ft` are empty and `timeBox` may be `null`.

**`on` hysteresis** (provisional): turns on when the newest frame has ≥ 30 precip pixels (after water masking and despeckle, marker excluded), off when it drops below 10. Judged once per new frame. `on` doesn't switch screens by itself: `auto` stays on transit unless radar visits are turned on.

**Source and processing** (`server/board/radar.js`): IEM `mrms_lcref` archive, `https://mesonet.agron.iastate.edu/archive/data/YYYY/MM/DD/GIS/mrms/lcref_YYYYMMDDHHMM.png` + `.wld` (7000 × 3500, 8-bit palette, 0.01°; the world file's origin differs by half a pixel between older and newer files, so each frame's `.wld` is read). Palette index → **dBZ = index × 0.5 − 32** (255 = missing; ≤ 65 is no echo), per IEM's lookup table. Each LED is ~1.5 mi (2.92 source columns × 2.17 rows at Chicago's latitude); a source pixel goes to the LED containing its center; LED value = mean **linear** Z → dBZ → level; water LEDs set to 0, then despeckle (drop precip pixels with < 2 precip neighbors), shoreline (6) on water LEDs next to land, the clock box cleared, then the marker. Masks come from `scripts/build-locations.js`: an LED is water when its center is inside Lake Michigan (`scripts/geo-src/lake-michigan.geojson`, Natural Earth 1:10m, public domain); a test checks every committed file matches a fresh build. Frames are stream-decoded (`radar-png.js`): only the ~70 rows around the station are unfiltered, and the download stops after them (~14 MB peak vs ~150 MB for a full pngjs decode). The poller runs every 20 s while a board asked in the last 2 min, fetching one source frame per pass: the newest slot first (expected 2 min after its time), then the rest of the loop. Slots, 6 per loop on the **6-minute grid** (multiples of 6 min since midnight UTC; IEM's archive only has frames at even minutes), so the loop spans 30 minutes. The newest frame is 2–8 min old, and each 6-minute step adds exactly one new frame and drops the oldest. A missing frame (404) is retried after 2 min; a download that hasn't finished in 60 s is abandoned. The last 8 processed frames per station are kept.

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
| `away.lg`, `home.lg` | `logos` only. Logo id (`<ab>-<hash>`, immutable) to fetch once from `GET /board/logo/<id>`, or `null` (no logo uploaded: the board draws the abbreviation in the logo slot, in the band's ink: black on a light band, white otherwise, like the score; also while the logo is still loading). |
| `away.bd`, `home.bd` | `logos` and `bands`. Band color (undimmed): the logo tile's top-left pixel, or the team's block color `c` without a logo. |

- **Server:** `server/board/mlb.js` polls `statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=<yesterday>&endDate=<today>&hydrate=linescore` (Chicago dates) every 15 s while a shown game is live or within 30 min of first pitch, every 5 min otherwise. Shown: Cubs (team 112) and White Sox (team 145) games of any type, and postseason games (`gameType` `F`, `D`, `L`, `W`), from 30 min before first pitch until 15 min after the server first sees the final; postponed and cancelled games are skipped. Sorted by first pitch.
- **Forced windows:** when the board's `screen` is `baseball`, `mlb.games` uses wider windows (`mlb.get('forced')`): pregame for any game whose first pitch is today (Chicago), from midnight; finals through their own day and until 3 AM the next morning. Live games always show. Auto (and every other screen) gets the windows above.
- **Per board** (state): `bbTeams` picks which games take over Auto (Cubs, White Sox, postseason; a forced Baseball screen shows all), `bbPre` / `bbFinal` set the pregame and final windows, and `bbPriority` which games rotate: `live` (default) as below, `favorite` sends only live Cubs/Sox games while one is on, `all` sets `mlb.all` so every game rotates.
- **Board:** shows a live game whenever one is on: the live games (or, with none live or `mlb.all`, all games) rotate one minute each by wall time, `set[floor(now / 60) % set.length]` (`draw.js` `pickGame`, no state), drawn per `draw.js` `renderBaseball` (design spec §8). Scores, inning, count, and outs roll when they change (`baseballTexts`).

- **Logo loading:** in `logos` the board draws the `bands` layout (abbreviations in the logo slots, none in the score boxes) until every logo the game uses (`lg` not null) has loaded, so they appear together, not one at a time; a side with `lg` null never loads and doesn't hold the others back. In `logos` pregame the abbreviation in the score box is drawn 1px left of the box's center (x29).
- **Logo and band layouts:** 12-row team bands (away rows 0–11, home 12–23) to x37 in `bd` at `dim`; `logos` draws the 24 x 12 logo crop at the left (also at `dim`), `bands` the abbreviation in the same ink (white, or black on a light band). Scores are centered in the band's box at x30: white, or black (unlit) on a light band (drawn band luma above 140), amber for the score flash and the final's winner (the loser stays white). Pregame: the abbreviation in the score box (`logos`), records in the panel, `TODAY` bottom left. Infield centered on row 8, inning on baseline 21. Divider row 24 and the bottom line are shared with `classic`.

#### Skyline (`skyline`)
The clock screen's skyline face (design spec §14). The server turns the weather and the sun into drawing values; the board draws its layers from them and never interprets weather codes or the time of day. When `skyline` changes while the clock screen shows, the board keeps drawing the old one until the new one's cloud strip is on hand, then crossfades over 4 s (keeping both strips until the fade ends). Computed by `server/board/skyline.js` (sun and moon: `sun.js`).

```json
{"face": "skyline", "st": "clear", "sky": [[0, "#08245a"], [18, "#1a4a8e"], [25, "#3a6eb0"]], "wat": ["#0a2a52", "#06203f", "#1a3a68"],
 "lit": 0, "win": 0, "stars": 0, "sun": {"x": 41, "y": 5, "c": "#ffd040"}, "moon": null, "gl": null,
 "whl": 0, "fog": null, "roof": null, "pcp": null, "storm": 0, "boats": 1, "temp": 52,
 "wheel": 30000, "rip": 500, "twk": 1, "fall": 200}
```

| Field | Meaning |
|---|---|
| `face` | Always `skyline` (the face is the payload's `cface`). |
| `st` | Weather kind (`clear`, `partly`, `mostly`, `overcast`, `rain`, `snow`, `fog`, `storm`), for the simulator and logs. The board doesn't branch on it. |
| `sky` | Sky gradient: `[row, color]` stops from row 0 down to the horizon (row 25). Each row is the linear mix of the stops around it, channels rounded (`Math.round`). Blended by the server from the sun's exact elevation, so it changes a little with every update. |
| `wat` | Water: top row color, bottom row color, ripple color. |
| `lit` | `1` once the sun is below 0.5°: the wheel's rim turns to its slow pastel rainbow, the Hancock beacons pulse, the pier's bulbs light. |
| `win` | Percent of the night window pattern lit (0–100); each window has a fixed threshold, so the lit set only grows. |
| `stars` | Stars to draw (0–14), the first `stars` of the fixed list. |
| `sun` | `{x, y, c}`: the sun's center and color, or `null` (night, mornings, cloudy skies). Low suns sit behind the buildings. |
| `moon` | `{ph, fr}`: phase (0–99, 0 new, 50 full) and lit percent, or `null`. Drawn at the day sun's spot. |
| `gl` | The glitter path at sunset: `{x, c, p}`, its column, color and strength (1–100): the ripples within `1.5 + (y - 25) * 0.8` px of `x` take `c` mixed in at `p`%. Sent only while the low sun shows over the buildings (at least 4 px of its disc); `null` otherwise. (Builds before the options update also scatter 1–3 sparkles around `x` while it's sent; current builds draw none.) |
| `whl` | The wheel by day: `0` white rim with a `#565c68` frame, `1` `#eef0f4` rim with a `#4a505c` frame, `2` all `#262a32`. |
| `fog` | Fog color (the city fades into it with height), or `null`. |
| `roof` | Snow on roof edges and the pier: its color, or `null`. |
| `pcp` | Precipitation: `{k, n, sl}`, `r` rain or `s` snow, how many streaks or flakes are on screen, and (rain) the slant: `0` straight down, `-1` / `1` 45° left / right (the wind across the view, 8 mph or more; storms without wind data `-1`); or `null`. Rain streaks move 1 px every `fall` ms along their own line with sub-pixel coverage; snow falls 1 px every `fall × 3.5` ms; both fall past the shore into the water (each to its own row, 26–31), never over the text boxes. |
| `storm` | `1`: lightning every 20–40 s: the sky flashes, brightest around the bolt, rising over 0.15 s and fading over 1.2 s. |
| `boats` | `1`: the quarter-hour boats run (daytime, dry, 40°F or warmer). |
| `temp` | Temperature in the board's unit, or `null` (also when the board's `showTemp` is off). A top-level `warn` replaces it on screen. |
| `wheel` | Ms per turn of the night rainbow (`wheelSpeed`: 0 still, 60000, 30000, 15000). Absent: 30000. |
| `rip` | Ms per pixel for the ripples (`rippleSpeed`: 0 still, 1000, 500, 250). Absent: 500. |
| `twk` | `0`: the stars hold steady (`twinkle` off). Absent or `1`: they twinkle. |
| `fall` | Ms per pixel for rain (`rainSpeed`: 400, 200, 100); snow takes 3.5×. Absent: 200. |
| `cl` | Clouds: `{id, pal, a}`, or `null` (clear, fog, snow). `id` names a strip (see *Cloud strips*: shapes only, fetched once and kept); `pal[i]` and `a[i]` are index `i`'s color and opacity in percent (index 0 is clear, `pal[0]` empty). The board draws each sky pixel (not buildings) as the mix of what's there and `pal[i]` at `a[i]`, reading the strip at columns `c = (x + floor(ms / step)) % 128` and `(c + 1) % 128`, each laid over the sky, and mixing the two by `(ms % step) / step` (sub-pixel, like the ripples), so the clouds glide left 1 px every `step` ms (`cl.step`: 16000 slow, 4000 normal, 0 still, from the board's `cloudDrift`; absent: 4000). Until the strip is on hand it draws no clouds. Today: `p1` partly cloudy and `m1` mostly cloudy (wisps, indexes 1-2), `o1` overcast, `r1` rain, `s1` storm (decks, indexes 1-15 thin to thick). |


#### Seventies (`cface` `seventies`)
The clock screen's seventies face (design spec §16). Drawn from the payload's `now` and `tzo` alone; no other fields. The time (`h:mm`, 12-hour, no AM/PM) in the `vcr` font (8 x 11 digits after VCR OSD Neue), centered in columns 0-52 with the digits on rows 5-15, each lit pixel colored by its row: rows 5-8 `#ffc23a`, 9-11 `#ff7414`, 12-15 `#d2361a`. It rolls at each minute under the name `svt.clock`. Three 2-px stripes in the same colors (inside to outside) run along the bottom and up the right edge, each a quarter circle around the corner point (54, 21) of radius 3, 6 and 9: horizontal on rows 21+r-1 and 21+r for columns 0-53, vertical on columns 54+r-1 and 54+r for rows 0-20, and between them every pixel (x ≥ 54, y ≥ 21) with (2r-2)² < (2(x-54)+1)² + (2(y-21)+1)² ≤ (2r+2)². Reference: `renderSeventies()` in `draw.js`.

#### Announce (`msg`)
The announce screen (design spec §15): a short message from the phone in one of three styles. The server lays the text out (`messageLayout()` in `draw.js`) and sends the lines; the board draws them without wrapping or measuring.

| Field | Meaning |
|---|---|
| `id` | Changes with each new message (the board's `v` when it was set). The board plays the style's intro from when the screen is shown or the `id` changes, not on every update. |
| `style` | `note`, `type` (typewriter) or `big` (big word). An unknown style draws as `note`. |
| `lines` | The lines, already fitted: `note` up to 3 lines of `5x7` (or with `sm`, up to 5 of uppercase Tom Thumb); `type` up to 3 lines of `5x7` at most 59 px wide (room for the cursor); `big` one line of `5x7` at most 32 px wide. |
| `sm` | `1`: `note` in Tom Thumb. Absent otherwise. |

Drawing (`renderAnnounce()` in `draw.js`; `t` is ms since the intro started, absent for the settled frame): **note** centered (`x = floor((64 - width) / 2)`) in `#d8d8d8`, `5x7` baselines by line count 1: 19; 2: 14, 24; 3: 9, 19, 29; Tom Thumb lines 6 px apart, the block centered (`top = floor((32 - (6n - 1)) / 2)`, baselines `top + 5 + 6i`). **type**: `#ffb000` from x 0 at the note's baselines; one character every 90 ms after 400 ms (a line break counts as one); a 4 x 7 `#cc8d00` cursor after the last typed character (x after its advance, rows baseline − 7 to baseline − 1), steady while typing, then on/off every 530 ms. **big**: `5x7` at 2x (each pixel 2 x 2), the 1x text on baseline 8 placed at `x0 = 32 − width` and top row 7, each 2x row y (0–19) colored from `#ff3060` to `#ffb000`: `round(a + (b − a) · min(y, 14) / 14)` per channel. **No message**: `SET A MESSAGE` / `ON YOUR PHONE` in Tom Thumb `#808080`, centered on baselines 15 and 22. The typewriter's intro runs 400 + 90 · characters ms; the board redraws every frame until then, then only for the cursor blink (`messageIntroMs()`, `messageTick()`).

### `GET /board/firmware?b=<id>&v=<build>`
An OTA build, streamed: `Content-Type: application/octet-stream`, `Content-Length` = the build's size, `Cache-Control: no-store`. Token required. `404` for an unknown board (`unknown_board`) or build (`unknown_build`).

#### Firmware (OTA updates, S3)
- **Builds** are the Arduino `ctaboard.ino.bin` (an ESP32-S3 app image) of a **generic build**: compiled without `secrets.h`, so it carries no WiFi passwords or token. The board's settings live in its flash (NVS), saved there once by a **setup build** (with `secrets.h`) flashed over USB (`firmware-s3/ctaboard/src/config.h`).
- **Build mark:** every build embeds `CTABOARD-BUILD:<version>:<generic|setup>;` (`BUILD_MARK` in `ctaboard.ino`). An upload is accepted only if it is an app image for the ESP32-S3 (magic `0xE9`, chip ID 9), at most 2 MB (one app slot), not the merged image, and its mark says `generic` with a committed version (7–40 hex digits; not `dev` or `_dirty`). The server takes the version from the mark.
- **Signatures:** every upload carries `X-Firmware-Signature`, an ECDSA P-256 signature (SHA-256, DER, hex) of the exact `.bin`, made with the private key only the `firmware-release` GitHub environment and its owner hold. The server checks it against `firmware-s3/firmware-signing.pub.pem` and refuses the upload otherwise, or when the repo has no public key yet. The board checks it again against the key built in from `src/signing_key.h` before the new slot can become the boot slot; it ignores offers without `sig`, and a build whose key is empty installs nothing. Keys: `scripts/firmware-key.js`; signing: `scripts/sign-firmware.js`.
- **CI:** each firmware build of `main` is signed and published to `beta` through `POST /board/firmware-upload` (below).
- **Channels:** `beta` and `stable` each name a stored build (or none). Each board's `fw` setting follows a channel, pins a build, or is `off` (state table). Stored beside the board state in `firmware/` (`firmware.json` + `<build>.bin`); at most 8 builds, the oldest not in a channel or pinned pruned first.
- **Offer:** `/board/version` adds `fw` when the board reports `hd=adafruit_matrixportal_s3` and a committed `hv` (a board running `dev` or `_dirty` is someone's test build: never offered), its `fw` names a stored build, and that build isn't the one it runs. `n` is the board's `fwRetry`.
- **Install (board):** in an animation gap (or after waiting 2 min), the board downloads the build into its unused app slot, showing `UPDATING` and the percentage, checks the SHA-256, makes that slot the boot slot, and restarts. A failed download or check leaves the running build untouched; it tries again after 10 min (`hx=error:<reason>`, `he=firmware:<reason>`).
- **Trial:** the new build is kept once it has had a good `/board/update` and run 60 s. It's rolled back (the previous slot becomes the boot slot again, and the board restarts) if it hasn't reached the server within 5 min, or if it starts more than 3 times before being kept (a crash loop). The board then won't install that build again while `n` is unchanged (`hx=rolledback:<build>`); the control page's **Try again** bumps `fwRetry`. Rules: `firmware-s3/ctaboard/src/ota.h`.

### `POST /board/firmware-upload`
CI's upload: a signed build (raw body, with `X-Firmware-Signature`) that becomes the `beta` build. `X-Deploy-Token` must match the `FIRMWARE_DEPLOY_TOKEN` Fly secret; this token can do nothing else. `{beta: <build>}`; `400` with a reason for anything `api/firmware` would refuse, `401` for a wrong token, `404` when `FIRMWARE_DEPLOY_TOKEN` isn't set.

### `POST /board/select?b=<id>&s=<category>[&hk=<caps>]`
The knob chose a category on its ring (`knob.ring`). The server sets the board's `screen` the same way the phone would (bumps `v`), so the choice persists, the phone page shows it, and it ends any button override: `auto` → `auto`, `transit` → the transit-family screen last chosen (`transit` or `ticker`, state `transitScreen`), `weather` → `weather`, `sports` → `baseball`, `clock` → `clock`, `announce` → `announce`. The response is `/board/update`'s payload for the new screen (sections for `screen`), so the board needs no second request. Empty body. 400 `invalid` for a category not on the ring, 401 without the token, 404 for an unknown board, 405 for anything but POST.

### `GET /board/logo/<logoId>?b=<id>`
One team logo crop for the logo layout.

- `Content-Type: application/octet-stream`, `Cache-Control: max-age=86400, immutable`. Token required.
- **Format:** 864 bytes: 24 x 12 pixels, RGB, row by row from the top left. Undimmed; at most 64 distinct colors (the board draws into a 256-color palette).
- The board fetches missing logos one per scheduler run while the baseball screen is up (`firmware/boardlib/app.py` `_logo`) and drops logos the payload no longer uses.
- Logos come from the owner's uploads (`POST /board/<secret>/api/logos`); they're kept beside the board state and never committed (trademarks; the repo is public). Processing is only a resize and a crop: each 32px tile (or any image, area-averaged to 32px) is box-scaled to 24px and 12 rows are cut at the team's crop row (`OFFSET` in `server/board/mlb-logos.js`, or `crop=` on upload).

### `GET /board/sky/<stripId>?b=<id>`
A cloud strip for the skyline face: exactly 1664 bytes, `Cache-Control: immutable` (the id names a shape that never changes). 128 × 26 pixels (the sky, rows 0–25), row by row, two pixels per byte, high nibble first; each nibble is a palette index (0 clear) whose color comes from the payload's `skyline.cl`. Generated on the server from the weather kind (`clouds.js`); unrelated to radar. The board keeps the current strip and fetches a new one only when `skyline.cl.id` changes. `401` bad token, `404` unknown board or strip. The simulator reads the same bytes at `/board/<secret>/api/sky/<stripId>`.

### `GET /board/radar/<frameId>?b=<id>[&pk=4]`
One radar frame for that board's location.

- `Content-Type: application/octet-stream`, `Cache-Control: max-age=3600, immutable`.
- Body: **2048 bytes**, 64 × 32, row-major from top-left, **one byte per pixel**.
- `pk=4` (what the board asks for): **1024 bytes**, the same pixels packed two a byte, the left pixel in the high nibble (values fit in 4 bits). The board keeps its frames packed, halving their memory (6 frames: 6 KB instead of 12 KB), and unpacks while drawing (`packFrame()` in `radar.js`, `BoardFrame.draw_radar()` in `device.py`).

| Value | Meaning |
|---|---|
| 0 | off (land with no rain, masked water) |
| 1–5 | rain levels: 15/25/35/45/55 dBZ (dim green, green, yellow, orange, red) |
| 6 | shoreline: the lake's edge pixels, water side; always drawn (water is masked, so rain never covers it) |
| 7 | location marker (white dot; the pixels around it keep their precip and shoreline) |
| 8–10 | snow levels, light to heavy (light blue, pale blue, white) |

A frame is either all rain levels (1–5) or all snow levels (8–10); the server picks the mode per frame (see **Snow mode** below). The board owns the palette, including the ~65% fill brightness (the two greens at 70% of that) and the `rb` scale.

#### Snow mode (v1 heuristic)
- Reflectivity can't tell rain from snow, so v1 decides from the board location's WeatherAPI data, for the whole frame:
  - **Snow** if the weather code is a snow code (71, 73, 75, 77, 85, 86) or WeatherAPI reports thundersnow (1279, 1282), or the temperature is ≤ 32°F and the code is not freezing rain (56, 57, 66, 67).
  - Otherwise **rain**.
- Snow uses its own dBZ thresholds, because dry snow reflects much less than rain at the same rate. Provisional: **10 / 15 / 20 dBZ** (the Feb 2, 2022 Chicago snowstorm averaged 11–18 dBZ per LED, so 10/20/30 left the top two levels unused). Fixtures: `fixtures/mrms/`.
- Known limits: a rain/snow line inside the box, and sleet or mixed precip, render as one type.
- `radar.on` hysteresis counts snow pixels the same as rain pixels. `404` if the frame ID is no longer kept (the server keeps the last 12).

---

## Board keys

A board set up for someone else gets **its own token** and **its own control link** (`server/board/keys.js`). The others (the maker's own boards) keep the shared `BOARD_TOKEN` and are reached only from the maker's control path.

- **Token:** the board sends it as `X-Board-Token`, like the shared one. A board with a key accepts only its own token on every board endpoint (`version`, `update`, `select`, `radar`, `logo`, `firmware`, keyed by `b`); the shared token no longer works for it, and its token works for no other board. Only the token's SHA-256 is stored. An unknown board ID still needs the shared token to register.
- **Control link:** `/board/c/<link>/` (22 characters of `A-Z a-z 0-9 _ -`) opens the control page for that one board. Every request under it is about that board whatever `b` says. It reaches the page, the simulator, and `api/state`, `api/update`, `api/destinations`, `api/stations`, `api/health`, `api/boards` (GET, its own entry without `link`), `api/test`, and the simulator's frame and logo files; everything else (adding, copying, deleting boards; keys; firmware builds; logos; raw captures) is `404`. Its `fw` may only be set to `stable` or `off`. The page is served with `window.BOARD_SCOPE` set to the board's ID and hides the maker's controls.
- **Storage:** `board-keys.json` beside the board state (`{boards: {<id>: {sha, link, at}}}`, mode 600), never in `board-state.json`, which the maker's page reads whole. Deleting a board deletes its key.

## Control endpoints

All under the secret path `/board/<BOARD_CONTROL_PATH>/`. No token header: the path is the credential. Requests to a wrong path return `404`, the same as any missing page. A board's control link (`/board/c/<link>/`, see **Board keys**) serves a subset of them for that board only.

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
| `GET /board/<secret>/api/health` | Latest health report per board (see `/board/version`): `{<id>: {at, uptime, memFree, largestBlock, minMem, oom, budget, fails, reconnects, rssi, lastError, started, lastCrash, hardware, firmware, ota, restarts, lastRestart, since}}`; `lastCrash` stays until a newer crash replaces it. In memory only. |
| `GET /board/<secret>/api/boards` | Board list for the control page's picker: `[{id, label, station, mapid, screen, seen, link?}]` in creation order; `link` (the control link's secret) only for boards with a key. `station` is the header name; `seen` is the last `/board/version` or `/board/update` (epoch s), `null` if none since the server started. |
| `POST /board/<secret>/api/boards` | Add a board: body `{id, from?, label?}`. With `from`, a copy of that board's settings (brightness reset to auto); without, the defaults. Returns the new list. `400` for a bad or taken ID, an unknown `from`, a bad label, or more than 8 boards. |
| `DELETE /board/<secret>/api/boards?b=<id>` | Remove a board (and its in-memory health and test alerts). Returns the new list. `404` if unknown; `400` for the only board. A board still running with that ID re-adds itself on its next update. |
| `POST /board/<secret>/api/boards/copy?b=<id>&from=<other>` | Replace board `b`'s settings with a copy of board `from`'s; `b` keeps its `label`, `bright` goes to auto, `v` is bumped. Returns `b`'s full state. `404` if `b` is unknown; `400` if `from` is unknown or the same board. |
| `POST /board/<secret>/api/state?b=<id>` | Partial update for one board, body is a subset of the board object below. Returns the board's full state. Bumps `v`. |
| `GET /board/<secret>/api/test?b=<id>` | Simulator test alerts for board `b`: `{lines, warn, game, radar, bars, weather, left}` (`left` = seconds until expiry, 0 when none). |
| `POST /board/<secret>/api/test?b=<id>` | Start a test alert: body `{lines: ["RD", ...], warn: {kind: "svr"\|"tor", lvl: "watch"\|"warning"} \| null}`. Lines are `RD BL BR GR OR PR PK YL`; they're marked as if CTA had a major alert, and `warn` replaces the NWS warning. Applies to the real board's updates too, and expires after 10 minutes. `game` (`pre` \| `live` \| `final` \| `null`) adds a made-up Cubs-Cardinals game in that state at the front of `mlb.games`. `radar` (`storm` \| `snow` \| `null`) replays a recorded storm (Aug 10, 2020 derecho) or snowstorm (Feb 2, 2022) from `fixtures/mrms/` as the radar loop at the board's station (`test-radar.js`): `radar.on` is true and `frames` are 3 test frames, the crop shifted 3 LEDs per frame so the weather moves east; the frame endpoints serve them by id. `bars` (`rain` \| `downpour` \| `break` \| `ends` \| `continues` \| `snow` \| `snow now` \| `null`) forces made-up rain bars (`radar.wx.rain`, built from 15-minute data through the real title and height rules) whatever the board's `wxRain`: they replace the radar loop, or alternate with a test `radar` loop when `wxRain` is `both`. `weather` (`{kind, tod}` \| `null`, either part `null`) forces the current conditions and/or the time of day on every weather display (weather strip, weather screen, skyline): `kind` is `clear` \| `partly` \| `mostly` \| `overcast` \| `fog` \| `rain light` \| `rain` \| `rain heavy` \| `ice` \| `snow light` \| `snow` \| `snow heavy` \| `storm` (a WMO code, cloud cover and a fitting temperature, `TEST_WX` in `weather.js`; real forecast days and hours are kept, or made up around the state when there's no real weather); `tod` is `day` (solar noon) \| `sunrise` \| `golden` \| `sunset` \| `dusk` \| `twilight` \| `night` (solar midnight), the moment today the sun is at that elevation (`TEST_TOD` in `index.js`): the skyline draws its sky for that moment and `isDay` follows it, while every clock keeps the real time. An empty body (no lines, no warn, no game, no radar, no bars, no weather) clears it. `400` for bad values, `404` for an unknown board. |
| `GET /board/<secret>/api/logos` | Logo status: `{teams: [abbreviations with a logo], updated}`. |
| `POST /board/<secret>/api/logos[?team=<ab>[&crop=0-12]]` | Upload logos as a PNG body (max 8 MB): without `team`, the whole 5 x 6 sheet of 32px tiles in `mlb-logos.js` `SHEET` order, at any whole-number scale (replaces every team); with `team`, one team's logo (any PNG; a non-32px image is area-averaged to 32px), cropped at `crop` (first of the 24px logo's rows shown; default per team). `400` with a reason on a bad image. The phone page converts other image types to PNG before uploading. |
| `GET /board/<secret>/api/logo/<logoId>` | A logo crop for the simulator. |
| `POST /board/<secret>/api/boards/key?b=<id>` | Give board `b` its own key: `{id, token, link}`. The token is shown only here (it goes into that board's `secrets.h`); a board already keyed gets a new token and link, and the old ones stop working. |
| `DELETE /board/<secret>/api/boards/key?b=<id>` | Back to the shared token; the control link stops working. |
| `POST /board/<secret>/api/boards/link?b=<id>` | A new control link for a keyed board (`{id, link}`); the old one stops working. `400` without a key. |
| `GET /board/<secret>/api/firmware` | OTA builds (see **Firmware**): `{builds: [{v, size, sha, at, signed}] newest first, channels: {beta, stable}, signing}` (`signing`: the repo has a public key, so uploads can be accepted). |
| `POST /board/<secret>/api/firmware[?channel=beta\|stable]` | Upload a build as the raw body (`ctaboard.ino.bin`, max 2 MB) with its signature in `X-Firmware-Signature`. With `channel`, that channel then points at it (the control page uses `beta`). Returns the builds. `400` with a reason if it isn't a generic S3 build of this firmware. |
| `POST /board/<secret>/api/firmware/channel` | Point a channel at a build: body `{channel: "beta"\|"stable", v: "<build>"\|null}`. Returns the builds. |
| `DELETE /board/<secret>/api/firmware?v=<build>` | Remove a build. `400` if a channel points at it or a board is pinned to it. |
| `GET /board/<secret>/api/raw/mlb` | The MLB schedule response the poller last fetched, unchanged, for recording fixtures. `503` before the first fetch. |
| `GET /board/<secret>/api/raw/arrivals?mapid=<id>` | Raw Train Tracker `ttarrivals` response for a station, exactly as CTA sent it, for recording test fixtures. `400` for an unknown `mapid`, `502` if CTA fails. |
| `GET /board/<secret>/api/raw/weather?mapid=<id>` | Raw WeatherAPI `forecast.json` response for a station's grid cell (fetched now, not from the cache; the response has no key in it), for recording test fixtures. Owner only. `400` for an unknown `mapid`, `502` if WeatherAPI fails or `WEATHERAPI_KEY` isn't set. |

POST rules: allowed fields are `label` (up to 24 characters, trimmed; empty for none), `station` (`{mapid, name?}`; `name` defaults to the station's `short` and must fit 42px), `rows`, `showHeader`, `showWeather`, `headerDivider`, `wxDivider`, `transitLayout`, `radarTime`, `radarClock`, `radarCond`, `tempUnit`, `radarBright`, `wxView`, `wxRain`, `wxRainEvery`, `wxRainLoops`, `radarEvery`, `radarFor`, `screen`, `brightMin`, the Auto and screen options (`autoScreens`, `autoEvery`, `wxVisit`, `alertJump`, `bbTeams`, `bbPre`, `bbFinal`, `bbPriority`, `lineNames`, `headerClock`, `timeSteps`; see the state table), `bright`, `baseballLayout`, `logoBright`, the speed settings (`tickerHold` s: 5, 6, 8, 10, 12, 15; `tickerSlide` ms: 800, 1200, 1600, 2000; `radarFrame` ms: 300, 400, 500, 700, 1000; `radarHold` s: 2, 3, 4, 6, 8; `gameEvery` s: 30, 45, 60, 90, 120), `wxRainLoops` (1, 2, 3, 5), `tickerFill` (25–80), `clockFace` (`skyline`, `seventies`), `msg` and `msgPresets` (state table), `boats` (bool), `cloudDrift` (`off`, `slow`, `normal`), `wheelSpeed` and `rippleSpeed` (`off`, `slow`, `normal`, `fast`), `rainSpeed` (`slow`, `normal`, `fast`), `twinkle` and `showTemp` (bool), `fw` and `fwRetry` (state table); anything else is a `400`. `rows` holds up to 24 entries. Changing `station` to a different `mapid` resets `rows` to `[]` unless the same request sets `rows`. Posting to a board ID that doesn't exist creates it from defaults (IDs: 1–32 chars of `a-z`, `0-9`, `-`). `BOARD_CONTROL_PATH` must not be a board endpoint's name (`ping`, `version`, `update`, `select`, `radar`, `sky`, `logo`, `firmware`, `firmware-upload`, `c`) or contain `/`; if it is or does, control endpoints are disabled.

---

## Server state file

`/data/board-state.json` on the Fly volume (`board_data`, mounted via `[mounts]` in `fly.toml`). Written atomically (temp file + rename). `BOARD_STATE_DIR` overrides the directory (tests, local dev); without it and without `/data`, the server uses a temp dir and logs a warning. An unreadable file is moved aside to `board-state.json.corrupt-<time>` and the server starts from defaults (board `home` at Morse).

`board-nws-forecast.json` keeps the last good NWS forecasts the same way (entries older than 12 hours ignored; passed periods are skipped when used). Next to it, `board-weather.json` keeps the last good WeatherAPI data per grid cell (written atomically after each successful fetch), so a restart has weather right away. Entries older than 1 hour (WeatherAPI's caching limit for current conditions), entries without `days`, `q15` or `hrs`, or an unreadable file, are ignored.

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
| `label` | A name for people (`""` by default): the control page's picker shows it instead of the ID. Never sent to the board. |
| `station` | Train Tracker `mapid` and header name. Changeable from the control page. The station's coordinates are also the board's **location** for weather, NWS alerts, and the radar crop. |
| `rows` | **Ordered** list of `LINE:ShortName` to show. Acts as both the destination filter and the row order; if more destinations than the cap remain, the board shows the chronological view. Empty means all destinations, in default order. Unknown destinations are appended after the listed ones. |
| `showHeader`, `showWeather` | Transit toggles; together they set the row cap. |
| `headerDivider` | Transit divider line under the header (default off). It doesn't change the row layout. `wxDivider` (the line above the old weather row) is still accepted but no longer drawn or sent. |
| `transitLayout` | `header` (default): station and clock on top, weather strip at the bottom. `key`: the `trains to` / `min` key on top and the station line at the bottom, no weather strip (sent as `key`). |
| `screen` | `auto` or a forced screen (`transit`, `ticker`, `weather`, `baseball`, `clock`, `announce`; a saved `radar` loads as `weather`). Persists across boots. `auto` resolves to `transit`, or `baseball` while a game is on; it never changes screens on its own otherwise, except for radar visits. |
| `transitScreen` | The transit-family screen the knob's `transit` opens: `transit` (default) or `ticker`, whichever `screen` was set to last. Kept by the server; not accepted in a patch. |
| `autoScreens`, `autoEvery` | Auto's main screens: a non-empty list of `transit`, `ticker` (default `["transit"]`); with both, alternate every `autoEvery` s (30, 60, 120, 300, 600; default 60). |
| `wxVisit`, `radarEvery`, `radarFor` | Weather visits on the auto screen: `off` (default), `rain` (only while rain is in the box), or `always`; every `radarEvery` minutes (1–60, default 4) for `radarFor` seconds (10–600, default 60). An older file's `radarEvery: 0` loads as `off`, `> 0` as `rain`. |
| `alertJump` | `off` (default), `warning`, or `all` (watches too): the auto screen shows weather while a matching NWS alert is on, over baseball. |
| `bbTeams`, `bbPre`, `bbFinal`, `bbPriority` | Baseball on the auto screen: which games take over (`cubs`, `sox`, `post`; default all three; empty = never), pregame window (0–120 min, default 30), final window (0–60 min, default 15), and which games rotate (`live`, `favorite`, `all`; default `live`). |
| `lineNames`, `headerClock` | Transit labels `white` (default) or `line` color; the header clock on transit and ticker (default on). |
| `timeSteps` | Transit times at 100/40/20% instead of 100/40/40% (default off). |
Settings added after a board's state was saved load with these defaults (today's behavior). |
| `baseballLayout` | `classic` (default), `logos`, or `bands`. Sent as `mlb.layout`. |
| `clockFace` | The clock screen's face: `skyline` (default) or `seventies`. Sent as `cface`; `seventies` only to boards that report the `seventies` capability (`hk`), others get `skyline`. |
| `msg` | The announce screen's message: `{text, style, id}` or `null` (default). A patch sends `{text, style}` (style `note`, `type`, `big`) or `null`; the server cleans the text (characters outside the board fonts, such as emoji, dropped; tabs to spaces; runs of spaces collapsed; lines trimmed; line breaks kept), and rejects it (400) when it's empty, over 160 characters, or doesn't fit the style on one screen. `id` is set by the server to the new `v`. Sent as `msg` (see *Announce*). A saved `flap` (split-flap, removed Nov 2026) loads as `note`. |
| `msgPresets` | Saved messages for the phone page: up to 8 `{text, style}`, each checked like `msg` (default `[]`). Never sent to the board. |
| `boats` | Skyline face: the quarter-hour boats (default `true`). `false` sends `skyline.boats` 0. |
| `cloudDrift` | Skyline face: how fast the clouds drift, `off` (still), `slow` (default, 1 px every 16 s) or `normal` (1 px every 4 s). Sent as `skyline.cl.step`. |
| `wheelSpeed` | Skyline face: the night rainbow, `off` (still), `slow`, `normal` (default), `fast`. Sent as `skyline.wheel`. |
| `rippleSpeed` | Skyline face: the ripples, `off` (still), `slow`, `normal` (default), `fast`. Sent as `skyline.rip`. |
| `rainSpeed` | Skyline face: rain and snow, `slow`, `normal` (default), `fast`. Sent as `skyline.fall`. |
| `twinkle` | Skyline face: stars twinkle (default `true`). Sent as `skyline.twk`. |
| `showTemp` | Skyline face: the temperature bottom left (default `true`; `false` sends `skyline.temp` null, a watch or warning still shows). |
| `logoBright` | 10–100, default 90: logo and band brightness in the `logos`/`bands` layouts, sent as `mlb.dim`. |
| `tickerHold`, `tickerSlide`, `radarFrame`, `radarHold`, `gameEvery` | Speed settings (allowed values under the POST rules above), sent to the board as `anim`. Defaults 8 s, 1200 ms, 500 ms, 4 s, 60 s. |
| `tickerFill` | Ticker row fill percent (25–80, default 55), sent as `tickerFill`. |
| `radarTime` | Boolean, default `true`. Sent to the board as `radar.showTime`; off shows the temperature instead of the frame time. |
| `radarClock` | `frame` (default), `now`, `age` or `none`. Sent as `radar.clock` when not `frame`: the current time in white (`now`), how long ago the frame is (`age`), or no corner at all (`none`). |
| `radarCond` | Boolean, default `false`. Sent as `radar.cond: true` when on: the temperature under the radar clock, A/P on the clock line. |
| `radarBright` | Integer 20–150, default `100`. Sent as `radar.rb` when not 100: radar precipitation brightness, percent. |
| `wxRain`, `wxRainEvery`, `wxRainLoops` | The weather screen while rain is around. Bars need 15-minute precipitation, which WeatherAPI doesn't send: without it, `bars` and `both` act as `radar` (the control page hides the setting). `radar` (default): the radar loop while rain is in the radar box, else the layout. `bars`: the rain bars while the forecast has rain or snow falling or due in 2 hours, else the layout; never the radar loop (no `frames` sent). `both`: the loop while rain is in the box, the bars while the forecast has rain. Each turn is `wxRainLoops` full radar loops (1, 2, 3, 5; default 2, sent as `wx.rain.loops`), then the bars for `wxRainEvery` s (10–60, default 15, sent as `wx.rain.alt`), when both apply. |
| `tempUnit` | `F` (default) or `C`: every temperature the board shows (weather strip, weather screen, radar corner). Converted on the server from WeatherAPI/NWS °F before rounding; radar snow mode still uses °F. |
| `wxView` | `now` (default), `5day`, or `hourly`: the weather screen's layout without rain. `5day` adds `radar.wx.days`; `hourly` adds `radar.wx.hours`. |
| `bright` | `auto`, an integer 0–100, or `off`. Reset to `auto` on boot. |
| `brightMin` | Integer 5–100, default 40: auto brightness overnight (day is always 100), or a light sensor's dark-room level (sent as `ab.min`; a bright room is 100). |
| `fw` | OTA updates (S3): `stable` (default), `beta`, a build's commit (pinned: install that build, even an older one), or `off`. See **Firmware**. |
| `fwRetry` | Integer, default 0. Sent as `fw.n`; the control page's **Try again** increments it so a board installs a build it rolled back. |

**Stations:** `server/board/stations.json` lists every L station: `mapid`, name, descriptive name, lines served, and coordinates. It is generated from the City of Chicago "CTA System Information - List of 'L' Stops" dataset (`8pix-ypme`, the list the Train Tracker docs point to) by a script in `scripts/` and committed. That dataset has one record per platform; the script groups by `map_id` and takes `station_name`, `station_descriptive_name`, the line flags (`red`, `blue`, `g`, `brn`, `p`, `y`, `pnk`, `o`), and `location`. Each entry: `{mapid, name, desc, short, lines, lat, lon}`. `short` is the header name from `shortName()` in `server/board/station-names.js`: the uppercase name if it fits the 42px header budget, else the name with ordinals dropped (`95/DAN RYAN`), else a curated entry. The build fails if any name overflows without a curated entry. Picking a station on the phone copies `short` into the board's `station.name`, which stays editable. Station names repeat across lines (four Damens, three Addisons, Californias, Chicagos, Ciceros), so the picker shows the descriptive name with lines; the header shows the short name only. The control page's station picker and the location lookup both read it. (The map's GeoJSON has track lines only, no station points or `mapid`s.)

**Location assets:** the radar water mask, time box, and split flag depend on the location, and the location is the station. A script in `scripts/` generates them for **every station** and commits them under `server/board/locations/<mapid>.json`, so changing stations from the phone needs no build step. Nearby stations will share near-identical masks; that's fine at ~2 KB each.

---

## Server polling

After a failure, Train Tracker, NWS, and WeatherAPI retry in 30 s, doubling with each failure in a row up to 5 minutes (or the interval, if longer); a board request doesn't wait during that backoff.

| Source | Interval | Notes |
|---|---|---|
| Train Tracker `ttarrivals` | 30 s per unique `mapid` | Only for boards that polled in the last 2 min. One `mapid` call returns every line and direction at the station. |
| CTA alerts | 3 min | Shared with the map's `/api/alerts`. |
| NWS alerts | 90 s per location | `User-Agent` header required. |
| NWS forecasts | 15 min per location (grid lookup once) | Only while a board polled in the last 5 min; last good data kept. |
| WeatherAPI | 10 min per grid cell | Only while a board polled in the last 5 min; last good data kept. |
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
