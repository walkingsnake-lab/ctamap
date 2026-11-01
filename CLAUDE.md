# CTAMap

Real-time visualization of Chicago CTA train positions using D3.js. Trains animate smoothly along track geometry, with direction inference and phantom jump detection.

This server also backs a **64x32 LED arrivals board** (Adafruit Matrix Portal S3, running the C++ firmware in `firmware-s3/`; an older Matrix Portal M4 runs the frozen CircuitPython firmware in `firmware/`). The board code lives in `server/board/` and has its own rules; see [LED Board](#led-board-serverboard) below.

## Running the Project

```bash
npm start        # Node.js server on port 3000 (default)
npm test         # board tests (node:test)
```

Open `http://localhost:3000` in a browser.

## Architecture

### Server (`server.js`)
Plain Node.js HTTP server (no framework). Proxies CTA Transit Tracker API calls and serves static files.

API endpoints:
- `GET /api/trains` — all train positions across all lines (parallel fetches via `Promise.allSettled`)
- `GET /api/train/<rn>` — ETA data for a specific run number (for live tracking)
- `GET /api/geojson` — serves `data/cta-lines.geojson`

### Frontend Modules (load order matters)

| File | Responsibility |
|------|---------------|
| `js/config.js` | Constants, line colors, route code mappings, phantom jump rules, terminal definitions |
| `js/map.js` | SVG init, GeoJSON rendering, D3 line paths |
| `js/path-follow.js` | Path snapping, segment navigation, direction derivation |
| `js/trains.js` | Train state machine: spawn → animate → retire |
| `js/app.js` | Main loop, API polling, zoom, user interactions |

Scripts are bundled via `build.js` (esbuild) into `dist/bundle.min.js`. Run `npm run build` after editing JS files.

### Data
`data/cta-lines.geojson` — CTA line geometry and station coordinates. Referenced by `map.js` and `path-follow.js` for snapping train positions to actual track segments.

## Key Concepts

**Route codes** — The CTA API uses lowercase names (`red`, `blue`, `brn`); internally the app uses legend codes (`RD`, `BL`, `BR`, etc.). Mapping lives in `config.js` `ROUTE_TO_LEGEND`.

**Direction inference** — Trains don't report direction. It is derived in `path-follow.js` / `trains.js` via a priority cascade:

1. **Next-station probe** (`directionByNextStation`) — preferred method. Advances the train a short distance (~300m) in both directions from its snapped track position and picks whichever direction gets closer to the reported next station. Reliable on straight segments and at junctions because it follows actual track geometry.

2. **Terminal walk** (`directionByTerminalWalk`) — fallback when next-station is ambiguous (train is at the station, or next station unknown). Walks 9999 degrees in both directions to find the dead-end terminals, then compares terminal latitudes against `LINE_NORTH_DESTS` (e.g. Red→"Howard", Blue→"O'Hare"). Loop lines (OR, PK, BR, GR, PR) only reach one dead-end because the other direction circles through ML segments; the code handles this single-terminal case by comparing the reachable dead-end's latitude to the current position.

3. **Heading fallback** (`directionFromHeading`) — last resort. Converts the CTA API's clockwise-from-north heading to a vector and dot-products it against the current track segment vector. Unreliable for stopped trains.

**`LINE_NORTH_DESTS`** (in `trains.js`) maps each legend code to the destination substring that identifies the northern terminus — this is the single source of truth for all direction derivation and suspect-backward classification.

**Junction handling** — `findConnectedSegment` selects the next segment when a train crosses a segment boundary. At junctions (e.g. downtown Loop entry) where multiple segments share an endpoint, ties are broken by:
- Preferring the segment whose entry direction best aligns with the arrival direction (continuation heuristic).
- When a `targetLon/targetLat` hint is provided *and* the target is ahead of the junction (dot-product guard), preferring the segment whose exit direction points toward the target. This fixes loop-entry mis-routing where the correct branch requires a sharp turn the arrival heuristic would reject.

**Loop-line complications** — The Chicago downtown Loop is modeled as shared `ML` (multi-line) segments. `buildLineSegments` selects only the ML segments whose `lines` property includes the train's line. On the Loop:
- `directionByTerminalWalk` hits `MAX_ITER` in the loop-bound direction; the single-terminal path handles it.
- When both terminal walks reach the same dead-end (the loop circled back), the code falls back to local segment geometry (`dy/dx` slope), then a short probe walk, to determine which way is north.
- `findConnectedSegment` uses the target hint (set to the next station) to pick the right ML exit segment at loop junctions.

**Phantom jumps** — Known CTA API glitches where a train teleports between specific stations. `config.js` `PHANTOM_JUMPS` lists ~20 per-line patterns. `trains.js` checks each update and holds/snaps position instead of animating the jump.

**Animation loop** — Every 20 seconds: fetch positions → update train objects → D3 transition over 2500ms. If a position change exceeds 3.9km it snaps instead of animates.

**Terminal retirement** — Trains fade out when within 5.5km of their terminus and have been sitting there for >120 seconds.

**Train tracking** — Clicking a train zooms in and polls `/api/train/<rn>` for ETA data to display upcoming stops in the label. D3 zoom re-centers on the train each refresh.

## Conventions

- Variable names: `rn` = run number, `rt` = route code, `lon`/`lat`, `legend` = line code
- Train state lives in plain JS objects; D3 selections reference them via `.datum()`
- CSS classes for state: `.selected`, `.dimmed`, `.exiting`, `.retiring`, `.pr-express-active`
- No TypeScript, no bundler. The map has no test suite (manual testing only); board code under `server/board/` is tested, see below.

## Branching

PRs use `claude/<feature>-<id>` branch names. Recent work has focused on direction logic (loop/junction handling) and station label display.

## Hardware (`hardware/`)

3D-printed enclosures for the LED board: parametric Python CAD (manifold3d + trimesh) and the STLs generated from it. Not part of the app; excluded from the Docker image. The current case is [`hardware/bar-sleeve-case/`](hardware/bar-sleeve-case/README.md) (build sheet, print settings, assembly). Regenerate STLs from `src/` rather than editing them; check banding changes with `src/layerscan.py`.

## LED Board (`server/board/`)

The server fetches and formats everything for a 64x32 LED matrix board; the board only draws what it receives. Full design: [`docs/board/design-spec.md`](docs/board/design-spec.md). The API contract (endpoints, `/board/update` JSON, radar frame format) will live in `docs/board/contract.md`; once it exists, it is the source of truth, and changes to the API must update it in the same PR.

### Boundaries
- All board code goes in `server/board/`. `server.js` gets exactly one hook: requests whose path starts with `/board/` are handed to the board router. Do not add board logic anywhere else.
- Do not modify map code (`js/`, `server/train-state.js`, `server/track-engine.js`, `server/geo-state.js`) for board work. Exception: shared alerts (below).
- The map and the board share one process. Board failures must not take down the map: wrap every board poller and the radar pipeline in try/catch, log, and skip the cycle.

### Shared alerts
- CTA alerts are fetched by one **background poller** (`server/board/cta-alerts.js`, every 3 min, created in `server.js` and passed to `createBoard`) that both `/api/alerts` and the board read. Do not add a second alerts fetch.
- Parse **every** `ImpactedService` in an alert (one alert can cover several lines). The map keeps its existing filter (major or delay); the board blinks a line only for major alerts (`SeverityCSS` `major`, or `MajorAlert`).

### Stack and dependencies
- Plain Node `http`, no framework, same as the map.
- MRMS radar frames are decoded by `server/board/radar-png.js`, a streaming row decoder on Node's built-in `zlib` (pngjs would expand a 7000 × 3500 frame to RGBA: ~150 MB, measured). `pngjs` is for writing preview PNGs and for checking the decoder in tests. Do not add `sharp`, canvas, GIS libraries, or a Python sidecar.
- Water masks are generated once per station by `scripts/build-locations.js` (from `scripts/geo-src/lake-michigan.geojson`) into `server/board/locations/<mapid>.json` and committed; no geo processing at runtime. Rebuild after changing `stations.json` or the radar geometry (a test fails if they drift).
- The Fly VM has **256 MB**, shared with the map. Radar processing must stay small: decode only what's needed, crop early, and don't hold full source images between cycles.

### Tests
- Every board formatting rule gets a test using Node's built-in `node:test` (no test framework dependency). `npm test` runs every `server/board/**/*.test.js`.
- Tests run against **recorded fixtures** in `server/board/fixtures/` (real responses from Train Tracker, CTA alerts, NWS, Open-Meteo, MRMS frames). Tests never hit live APIs and never need API keys.
- When you hit a new real-world case (unknown destination, short-turn, multi-line alert, storm), save the raw response as a fixture and add a test.

### Fonts
- Board fonts are generated: edit `scripts/build-fonts.js`, then run `npm run build-fonts` and `node scripts/preview-fonts.js`. Never hand-edit `server/board/fonts/*.bdf`.
- Custom glyph codepoints live in `server/board/glyphs.js`. Measure and fit text with `server/board/fonts.js`; never estimate widths by character count.
- Previews in `docs/board/previews/` are the visual check for glyph changes; look at them before committing.

### Stations
- `server/board/stations.json` is generated by `node scripts/build-stations.js` from the City of Chicago L stops dataset. Cloud sessions can't reach data.cityofchicago.org; run it on the owner's machine, or pass a saved JSON export as the first argument.
- Header short names come from `shortName()` in `server/board/station-names.js` (full name, then ordinals dropped, then curated); the build fails on any station that still overflows.

### State and secrets
- Board state (per-board config, screen/brightness overrides, version counter) is a JSON file on a Fly volume mounted at **`/data`**, never inside the app directory: the static file fallback in `server.js` serves any file under it. Write atomically (temp file + rename).
- Key state by board ID, even with one board. Each physical board has its own ID (firmware `BOARD_ID`); an unknown ID registers itself on its first `/board/update` as a copy of `home` (`store.register`), and the control page adds, copies, names (`label`) and deletes boards (`api/boards`). Anything kept per board in memory (health, test alerts, chrono views) is keyed by ID and cleared by `forget()` when a board is deleted.
- Locally, set `BOARD_STATE_DIR` to any folder (or let it fall back to a temp dir). The board router is `server/board/index.js`; state is `server/board/state.js`.
- Arrivals pipeline: `tracker.js` (Train Tracker cache/poller) → `arrivals.js` (`normalize` raw JSON, `format` into rows/ticker, `chooseView` for the chronological overflow view) → `/board/update` in `index.js`. Destination short names: `destinations.js`. CTA times: `time.js`. Weather row and auto brightness: `weather.js` (Open-Meteo); forecast fields (hi/lo, rain chance, 5-day, hourly): `nws-forecast.js` (NWS, laid over Open-Meteo by `withForecast`); warnings: `nws.js`; all use `location-poller.js`. Radar: `radar.js` (poller, crop, levels) on `radar-png.js`. Baseball: `mlb.js` (MLB schedule poller with the linescore, which games show) with team abbreviations and block colors in `teams.js`; drawn by `renderBaseball` in `draw.js` (layouts `classic`, `logos`, `bands`), mirrored in `firmware/boardlib/draw.py` (`render_baseball`; rolls and logo fetches driven by `player.py` / `app.py`). Team logos: `mlb-logos.js` (owner-uploaded pixel art, resized and cropped only, stored beside the board state; never commit logo art, the repo is public).
- Secrets are Fly secrets: `CTA_KEY` (Train Tracker), `BOARD_TOKEN`, `BOARD_CONTROL_PATH`. Never commit keys or put them in fixtures (strip `key=` from recorded URLs).

### Verification
- The board's output can't be seen on hardware from here. `server/board/draw.js` is the reference renderer, including both transit views and their animations (digit roll, fades and slides via `createTransitAnimator()`, ticker slide, alert blink): it draws a payload exactly as the board should, runs in both Node and the browser simulator, and the CircuitPython code mirrors it. It has no dependencies; `render.js` binds it to the fonts and icons for Node. Layout and animation changes go there first, with tests in `render.test.js` / `draw.test.js`.
- Check layout changes visually: render fixtures with `render()` and `Frame.toPNG()` and look at the image, or open the live simulator at `/board/<BOARD_CONTROL_PATH>/sim`.
- Board-side CircuitPython is flashed and tested on hardware by the owner; ask for serial logs rather than guessing.

### Firmware (`firmware-s3/`, the S3: current)
- C++ (Arduino) for the Matrix Portal S3; see [`firmware-s3/README.md`](firmware-s3/README.md). It uses the ESP32-HUB75-MatrixPanel-DMA driver because CircuitPython's matrix driver shimmers on the S3 (checked on hardware). Board-side code lives here and in `firmware/`, not in `server/board/`.
- `firmware-s3/ctaboard/src/draw.cpp` is a line-by-line port of `firmware/boardlib/draw.py` and must stay **pixel-identical** to `draw.js`: `firmware-s3/tests/parity.test.js` (part of `npm test`, needs g++ or clang++) renders every scenario in `firmware/tests/scenarios.js` and compares pixels. Change `draw.js` first, then mirror it in `draw.cpp`; add a scenario for new cases.
- `player.*`, `sched.h`, `control.h` and `app.*` port the matching Python files (same names). `firmware-s3/tests/app_test.cpp` runs the main loop against a simulated server, clock and buttons (the scenarios of `firmware/tests/test_app.py`); scheduling or connection changes get a test there.
- Only `device.cpp` and `ctaboard.ino` include Arduino headers; everything else is plain C++17 so the tests build natively. Keep Python's semantics where the port depends on them: `draw::fdiv`/`draw::fmod_floor` for `//` and `%`, `json::Value::truthy()` for truthiness, `std::optional` for `None`.
- `src/assets.h` (fonts, icons, glyphs) is generated along with `assets.py` by `node scripts/build-firmware-assets.js`; `src/certs.h` (HTTPS roots) by `node scripts/build-firmware-certs.js`. Never hand-edit them.
- Cloud sessions can't build or flash it (no ESP32 toolchain). The owner builds and uploads with the Arduino IDE and sends serial logs; deliver changes as a PR.
- Settings (WiFi passwords, token, board ID, panel tuning) live in the board's flash (NVS, `src/config.*`). A **setup build** compiles in `firmware-s3/ctaboard/secrets.h` (gitignored; template `secrets.example.h`) and saves it to flash on startup; the **generic build** (no `secrets.h`) reads flash. Only generic builds may be uploaded for OTA: they carry no secrets.
- **OTA updates:** `server/board/firmware.js` stores uploaded builds (`firmware/` beside the board state) with `beta`/`stable` channels; `/board/version` offers `fw` to an S3 per its `fw` setting; the board installs in an animation gap and keeps or rolls back the new build by the trial rules in `src/ota.h` (contract: "Firmware"). The build mark (`BUILD_MARK` in `ctaboard.ino`) is how the server reads an upload's version and kind; keep its format. OTA changes get a test in `app_test.cpp` (board) and `firmware.test.js` / `index.test.js` (server).
- CI (`.github/workflows/firmware-s3.yml`) compiles the generic build with arduino-cli on every firmware change: the only compile check for `device.cpp` and the `.ino`, since cloud sessions can't build them. Check its run on the PR.

### Firmware (`firmware/`, the M4: frozen)
- CircuitPython for the Matrix Portal M4 (it also runs on the S3, but shimmers there); see [`firmware/README.md`](firmware/README.md). **Frozen:** it stays working, but new rendering features go only into `firmware-s3/`.
- `firmware/boardlib/draw.py` matches `draw.js` as of the freeze: `firmware/tests/parity.test.js` checks it against every scenario not tagged `s3only`. When a `draw.js` change would break it, tag the affected scenarios `s3only` (see `scenarios.js`) instead of porting the change to `draw.py`.
- **Server changes stay additive** so the frozen M4 keeps working: new payload fields are fine; don't rename, remove, or change the meaning of existing fields or endpoints.
- `firmware/boardlib/assets.py` is generated by `node scripts/build-firmware-assets.js` from the board fonts, icons, and glyphs; never hand-edit it (a test checks it's current). Rebuild after any font or icon change.
- Keep firmware Python compatible with CircuitPython: no `typing`, `dataclasses`, `re`, or f-strings; use `jsround()` where draw.js uses `Math.round`. Time zone comes from the payload's `tzo`.
- CircuitPython floats have 22 bits of precision, so epoch times stay integers on the board (`Board.now()` is int seconds) and use `//`, never `/`, `math.floor`, or `math.ceil`, which go through a float. `firmware/tests/test_app.py` checks floor/ceil arguments.
- The board runs `.mpy` files built by `node scripts/build-firmware.js <CircuitPython mpy-cross>` into `firmware/build/` (the M4 can't compile the larger `.py` files itself).
- Build `.mpy` files only from a tree that has everything already merged to main: merge or rebase onto current `origin/main` first (`git fetch origin main`, then check `git merge-base --is-ancestor origin/main HEAD`). A branch cut before another firmware PR merged builds files without that PR's changes, and the board silently runs the old behavior while the server and simulator show the new one.
- Cloud sessions can't download Adafruit's `mpy-cross` (the S3 bucket is blocked), so build it from source: `git clone --depth 1 --branch 9.2.9 https://github.com/adafruit/circuitpython`, `pip install --break-system-packages huffman`, then `make -j8` in `circuitpython/mpy-cross/` (output `build/mpy-cross`; the board runs CircuitPython 9.x, mpy v6.3). Keep the clone outside the repo. Deliver changed `.mpy` files to the owner with the PR; `code.py` goes to the CIRCUITPY root, the rest to `CIRCUITPY/boardlib/`.
- Run tests under a hard timeout (`timeout -k 5 300 npm test`; firmware alone: `python3 -m unittest discover -s firmware/tests -p 'test_*.py'`). Hanging test runs have stalled sessions.
- The board's heap is tight (~130 KB at boot, ~34 KB free once running). Don't allocate per frame: no tuple dict keys (use ints), no caches that grow or get cleared and regrown, no `Response.content` for binary data (read into buffers preallocated at boot, in small chunks). Check `[board] memory` and `largest block` in the owner's serial log after memory-related changes.
- Hardware imports (`displayio`, `rgbmatrix`, `adafruit_esp32spi`, ...) live only in `firmware/boardlib/device.py` and `firmware/boardlib/matrix.py` (the matrix and the fixed buffers, allocated first in `code.py` before the big modules load, so they get contiguous space); everything else takes its hardware as plain objects so `firmware/tests/test_app.py` can run the main loop against a simulated server, clock, and buttons. Scheduling or connection changes get a test there.
