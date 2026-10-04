# CTAMap

Real-time visualization of Chicago CTA train positions using D3.js. Trains animate smoothly along track geometry, with direction inference and phantom jump detection.

This server also backs a **64x32 LED arrivals board** (Adafruit Matrix Portal M4). The board code lives in `server/board/` and has its own rules; see [LED Board](#led-board-serverboard) below.

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

## LED Board (`server/board/`)

The server fetches and formats everything for a 64x32 LED matrix board; the board only draws what it receives. Full design: [`docs/board/design-spec.md`](docs/board/design-spec.md). The API contract (endpoints, `/board/update` JSON, radar frame format) will live in `docs/board/contract.md`; once it exists, it is the source of truth, and changes to the API must update it in the same PR.

### Boundaries
- All board code goes in `server/board/`. `server.js` gets exactly one hook: requests whose path starts with `/board/` are handed to the board router. Do not add board logic anywhere else.
- Do not modify map code (`js/`, `server/train-state.js`, `server/track-engine.js`, `server/geo-state.js`) for board work. Exception: shared alerts (below).
- The map and the board share one process. Board failures must not take down the map: wrap every board poller and the radar pipeline in try/catch, log, and skip the cycle.

### Shared alerts
- CTA alerts are fetched by one **background poller** (every 2–5 min) that both `/api/alerts` and the board read. Do not add a second alerts fetch.
- Parse **every** `ImpactedService` in an alert (one alert can cover several lines). The map keeps its existing filter (major or delay); the board uses service-affecting alerts per line.

### Stack and dependencies
- Plain Node `http`, no framework, same as the map.
- Radar PNG decoding uses **`pngjs`** (pure JS). Do not add `sharp`, canvas, GIS libraries, or a Python sidecar.
- Water masks are generated once per station by a script in `scripts/` and committed as files; no geo processing at runtime.
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
- Key state by board ID, even with one board.
- Locally, set `BOARD_STATE_DIR` to any folder (or let it fall back to a temp dir). The board router is `server/board/index.js`; state is `server/board/state.js`.
- Arrivals pipeline: `tracker.js` (Train Tracker cache/poller) → `arrivals.js` (`normalize` raw JSON, `format` into rows/ticker) → `/board/update` in `index.js`. Destination short names: `destinations.js`. CTA times: `time.js`.
- Secrets are Fly secrets: `CTA_KEY` (Train Tracker), `BOARD_TOKEN`, `BOARD_CONTROL_PATH`. Never commit keys or put them in fixtures (strip `key=` from recorded URLs).

### Verification
- The board's output can't be seen from here. Use the board simulator (a 64x32 canvas page rendering `/board/update`, to be built under `server/board/`) and check its screenshots for layout changes.
- Board-side CircuitPython is flashed and tested on hardware by the owner; ask for serial logs rather than guessing.
