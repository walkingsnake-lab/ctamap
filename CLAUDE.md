# CTAMap

Real-time visualization of Chicago CTA train positions using D3.js. Trains animate smoothly along track geometry, with direction inference and phantom jump detection.

## Running the Project

```bash
npm start        # Node.js server on port 3000 (default)
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
- No TypeScript, no bundler, no test suite — manual testing only

## Branching

PRs use `claude/<feature>-<id>` branch names. Recent work has focused on direction logic (loop/junction handling) and station label display.
