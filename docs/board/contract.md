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
- **Errors:** `400` invalid input · `401` bad/missing token · `404` unknown board ID or route · `405` wrong method · `503` data not ready yet (just after server start). Error bodies are `{"err":"<short code>"}`; `400` adds `"detail"` with a human-readable reason.
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

`boot=1` is sent on the board's first update after startup. It resets `screen` and `bright` overrides to auto and bumps `v`. Station, row, and toggle config persist.

```json
{
  "v": 42,
  "now": 1759546800,
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
    "frames": ["202610032310", "202610032315", "202610032320", "202610032325", "202610032330", "202610032335"],
    "ft": [1759545000, 1759545300, 1759545600, 1759545900, 1759546200, 1759546500],
    "clock": [44, 2, 20, 17],
    "split": false
  }
}
```

#### Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `v` | int | Settings version (same as `/board/version`). |
| `now` | int | Server epoch seconds. |
| `age` | int | Seconds since the arrivals data was last fetched successfully. The server keeps serving last-good data when CTA fails. Board display of staleness is not in v1. |
| `screen` | string | Screen to show, **already resolved** from auto rules: `transit`, `ticker`, `radar`. A local button press overrides it until `v` changes. Until radar lands, `auto` resolves to `transit`. |
| `bright` | int | Global brightness 0–100, already resolved (auto sunrise/sunset, fixed level, or 0 for off). Until weather lands, `auto` resolves to 100. |
| `header` | string \| null | Station name for the transit header, or `null` when the header is off. Also used as the ticker header. |
| `view` | string | Transit view: `dest` (one row per destination, up to 3 times) or `chrono` (one row per train, soonest first). Chosen by the server; see *Transit view* below. |
| `rows` | array | Transit rows, already filtered and ordered. `dest`: **capped** to the max for the header/weather toggles (5/4/3/2). `chrono`: the cap **plus 2** extra trains; the board shows the first *cap* live rows. Empty array means no predictions: the board shows the overnight layout. |
| `ticker` | array | Up to 6 individual arrivals in time order for the ticker. |
| `wx` | object \| null | Weather row, or `null` when the weather row is off. |
| `warn` | object \| null | Active NWS warning/watch (see below). Sent regardless of the weather-row toggle, since the radar screen uses it too. |
| `radar` | object | Radar state (see below). |

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

#### Transit view (server)
- `chrono` whenever the destination count exceeds the cap, `dest` otherwise, decided on every update. `CHRONO_HOLD` in `arrivals.js` (0 now) can add a hold before switching back; that state is kept in memory per board and station.
- `chrono` rows each carry one time (`t` and `s` have one entry) and `rn`. Labels are fitted against the widest chrono time (`99m`).

#### Line codes
Train Tracker `rt` values map to `ln`: `Red`→`RD`, `Blue`→`BL`, `Brn`→`BR`, `G`→`GR`, `Org`→`OR`, `P`→`PR`, `Pink`→`PK`, `Y`→`YL`. Short-name map keys are matched against `destNm` exactly as Train Tracker returns it (e.g. `O'Hare`, `Loop`); confirm each key against recorded fixtures.

#### Row (`rows[]`)

| Field | Meaning |
|---|---|
| `ln` | Line code for the color block: `RD` `BL` `BR` `GR` `OR` `PK` `PR` `YL`. The board owns the color palette. |
| `lbl` | Label, uppercase, fitted. |
| `t` | Up to 3 arrival times (epoch), ascending. |
| `s` | Parallel to `t`: `1` if that time is schedule-based (`isSch`), drawn grey instead of amber. |
| `a` | `1` if the line has an active service-affecting CTA alert (block blinks to "!"). |
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

- `min = floor((t - now) / 60)`
- Show `DUE` (transit) / `Due` (ticker) when `min <= 1`. Chrono rows show `<min>m` otherwise.
- Drop an arrival once `now > t + 30`; its cell fades out and the list shifts (see `createTransitAnimator()` in `draw.js`). **(decide)** whether the 30 s grace is right; CTA's `isApp` is not sent.

#### Weather row (`wx`)

| Field | Meaning |
|---|---|
| `icon` | `sun` `moon` `pcloudy_day` `pcloudy_night` `cloudy` `rain` `ice` `snow` `storm` `fog` |
| `temp` | Current °F, integer. The board draws it with the small `°` glyph (U+00B0). |
| `word` | Condition word, uppercase, fitted. |
| `hi`, `lo` | Daily high/low °F. |

When `warn` is non-null, the board replaces `word` with the warning tag.

#### Warning (`warn`)

```json
{"kind": "tor", "lvl": "warning"}
```

- `kind`: `svr` (severe thunderstorm, bolt) or `tor` (tornado, funnel).
- `lvl`: `watch` or `warning`.
- If several are active, the server sends the most severe: tornado warning > severe warning > tornado watch > severe watch.

#### Radar (`radar`)

| Field | Meaning |
|---|---|
| `on` | Rain is in the box (server applies on/off hysteresis). Auto mode switches to `screen: "radar"` when true. |
| `frames` | IDs of the 6 latest frames, oldest first. Frame IDs are immutable, so the board fetches only IDs it doesn't already have. |
| `ft` | Frame timestamps (epoch), parallel to `frames`; used for the radar clock. |
| `clock` | `[x, y, w, h]`: box the board draws the clock stack into (frame indicator, clock, AM/PM + warning icon), right-aligned. The server keeps this box empty in every frame. |
| `split` | `true` when the location has no usable water area; the clock box is then the right-side panel. |

When `on` is false, `frames` and `ft` may be empty and `clock` may be `null`.

### `GET /board/radar/<frameId>?b=<id>`
One radar frame for that board's location.

- `Content-Type: application/octet-stream`, `Cache-Control: max-age=3600, immutable`.
- Body: **2048 bytes**, 64 × 32, row-major from top-left, **one byte per pixel**.

| Value | Meaning |
|---|---|
| 0 | off (land with no rain, masked water, clock box) |
| 1–5 | rain levels: 15/25/35/45/55 dBZ (dim green, green, yellow, orange, red) |
| 6 | shoreline (drawn only where there's no rain) |
| 7 | location marker (white dot; the 4 pixels around it are 0) |
| 8–10 | snow levels, light to heavy (light blue, pale blue, white) |

A frame is either all rain levels (1–5) or all snow levels (8–10); the server picks the mode per frame (see **Snow mode** below). The board owns the palette, including the ~65% fill brightness.

#### Snow mode (v1 heuristic)
- Reflectivity can't tell rain from snow, so v1 decides from the board location's Open-Meteo data, for the whole frame:
  - **Snow** if the weather code is a snow code (71, 73, 75, 77, 85, 86), or the temperature is ≤ 32°F and the code is not freezing rain (56, 57, 66, 67).
  - Otherwise **rain**.
- Snow uses its own dBZ thresholds, because dry snow reflects much less than rain at the same rate. Provisional: **10 / 20 / 30 dBZ**. Tune them on archived snow events.
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
| `GET /board/<secret>/sim.png?b=<id>[&screen=transit\|ticker][&page=N][&blink=1][&scale=1-16]` | One rendered frame of the live payload as a PNG (`server/board/render.js`). `screen` defaults to the payload's screen. |
| `GET /board/<secret>/api/update?b=<id>[&mapid=<id>]` | The same payload as `/board/update`, without the token header (the path is the credential). `mapid` previews another station without changing the board (its row list is ignored while previewing); `sim.png` takes it too. |
| `GET /board/<secret>/api/stations` | Station list for pickers: `[{mapid, desc, short}]`, sorted by `desc`. |
| `GET /board/<secret>/api/state` | Full state JSON (all boards). |
| `POST /board/<secret>/api/state?b=<id>` | Partial update for one board, body is a subset of the board object below. Returns the board's full state. Bumps `v`. |
| `GET /board/<secret>/api/raw/arrivals?mapid=<id>` | Raw Train Tracker `ttarrivals` response for a station, exactly as CTA sent it, for recording test fixtures. `400` for an unknown `mapid`, `502` if CTA fails. |

POST rules: allowed fields are `station` (`{mapid, name?}`; `name` defaults to the station's `short` and must fit 42px), `rows`, `showHeader`, `showWeather`, `screen`, and `bright`; anything else is a `400`. `rows` holds up to 24 entries. Changing `station` to a different `mapid` resets `rows` to `[]` unless the same request sets `rows`. Posting to a board ID that doesn't exist creates it from defaults (IDs: 1–32 chars of `a-z`, `0-9`, `-`). `BOARD_CONTROL_PATH` must not be `ping`, `version`, `update`, or `radar`; if it is, control endpoints are disabled.

---

## Server state file

`/data/board-state.json` on the Fly volume (`board_data`, mounted via `[mounts]` in `fly.toml`). Written atomically (temp file + rename). `BOARD_STATE_DIR` overrides the directory (tests, local dev); without it and without `/data`, the server uses a temp dir and logs a warning. An unreadable file is moved aside to `board-state.json.corrupt-<time>` and the server starts from defaults (board `home` at Morse).

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
| `screen` | `auto` or a forced screen. Reset to `auto` on boot. |
| `bright` | `auto`, an integer 0–100, or `off`. Reset to `auto` on boot. |

**Stations:** `server/board/stations.json` lists every L station: `mapid`, name, descriptive name, lines served, and coordinates. It is generated from the City of Chicago "CTA System Information - List of 'L' Stops" dataset (`8pix-ypme`, the list the Train Tracker docs point to) by a script in `scripts/` and committed. That dataset has one record per platform; the script groups by `map_id` and takes `station_name`, `station_descriptive_name`, the line flags (`red`, `blue`, `g`, `brn`, `p`, `y`, `pnk`, `o`), and `location`. Each entry: `{mapid, name, desc, short, lines, lat, lon}`. `short` is the header name from `shortName()` in `server/board/station-names.js`: the uppercase name if it fits the 42px header budget, else the name with ordinals dropped (`95/DAN RYAN`), else a curated entry. The build fails if any name overflows without a curated entry. Picking a station on the phone copies `short` into the board's `station.name`, which stays editable. Station names repeat across lines (four Damens, three Addisons, Californias, Chicagos, Ciceros), so the picker shows the descriptive name with lines; the header shows the short name only. The control page's station picker and the location lookup both read it. (The map's GeoJSON has track lines only, no station points or `mapid`s.)

**Location assets:** the radar water mask, clock box, and split flag depend on the location, and the location is the station. A script in `scripts/` generates them for **every station** and commits them under `server/board/locations/<mapid>.json`, so changing stations from the phone needs no build step. Nearby stations will share near-identical masks; that's fine at ~2 KB each.

---

## Server polling

| Source | Interval | Notes |
|---|---|---|
| Train Tracker `ttarrivals` | 30 s per unique `mapid` | Only for boards that polled in the last 2 min. One `mapid` call returns every line and direction at the station. |
| CTA alerts | 3 min | Shared with the map's `/api/alerts`. |
| NWS alerts | 90 s per location | `User-Agent` header required. |
| Open-Meteo | 15 min per location | |
| MRMS `lcref` via IEM | 5 min per location | Always runs, since it decides `radar.on`. |

---

## Open items

- **(decide)** Arrival drop grace (30 s) and whether `DUE` should also honor `isApp`.
- Schedule-based predictions (`isSch=1`) are shown and marked via `s` (decided Oct 3: grey times on transit, clock on ticker). `isFlt=1` is shown normally. Ticker clock is the `CLOCK` glyph (U+E006).
- **(decide)** Hysteresis thresholds for `radar.on` (colored-pixel counts); set after viewing real storms from the IEM archive.
- Verify the MRMS dBZ formula before fixing level thresholds.
- Tune snow thresholds (provisional 10/20/30 dBZ) on archived snow events.
- Later: per-pixel precip type from MRMS `PrecipFlag` (GRIB2, CONUS-wide). Needs a decoder and a memory check on the Fly VM before it replaces the heuristic.
- Confirm the payload stays under ~1.2 KB at a 5-row station.
- **(decide)** Condition word list for `wx.word` (previews use SUNNY, CLEAR, PT CLOUDY, CLOUDY, RAIN, FRZ RAIN, SNOW, STORMS, FOG as placeholders).
