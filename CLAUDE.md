# CTAMap

Real-time visualization of Chicago CTA train positions using D3.js. Trains animate smoothly along track geometry, with direction inference, phantom jump detection, and live follow/ETA tracking.

## Running the Project

```bash
npm start        # Node.js server on port 3000 (default)
# OR
python flask_app.py  # Flask alternative (pip install flask requests)
```

Open `http://localhost:3000` in a browser. No build step — JS files load directly.

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

Scripts are loaded synchronously in `index.html` in the order above — this matters.

### Data
`data/cta-lines.geojson` — CTA line geometry and station coordinates. Referenced by `map.js` and `path-follow.js` for snapping train positions to actual track segments.

## Key Concepts

**Route codes** — The CTA API uses lowercase names (`red`, `blue`, `brn`); internally the app uses legend codes (`RD`, `BL`, `BR`, etc.). Mapping lives in `config.js` `ROUTE_TO_LEGEND`.

**Direction inference** — Trains don't report direction. `path-follow.js` walks the track toward the next station or terminal and compares latitudes to determine northbound/southbound. Junction hints (`targetStation`) are passed in when probing at branch points.

**Phantom jumps** — Known CTA API glitches where a train teleports between specific stations. `config.js` `PHANTOM_JUMPS` lists ~20 per-line patterns. `trains.js` checks each update and holds/snaps position instead of animating the jump.

**Animation loop** — Every 20 seconds: fetch positions → update train objects → D3 transition over 2500ms. If a position change exceeds 3.9km it snaps instead of animates.

**Terminal retirement** — Trains fade out when within 5.5km of their terminus and have been sitting there for >120 seconds.

**Train tracking** — Clicking a train zooms in and starts a faster polling loop (`/api/train/<rn>`) for ETA data. D3 zoom re-centers on the train each refresh.

## Conventions

- Variable names: `rn` = run number, `rt` = route code, `lon`/`lat`, `legend` = line code
- Train state lives in plain JS objects; D3 selections reference them via `.datum()`
- CSS classes for state: `.selected`, `.dimmed`, `.exiting`, `.retiring`, `.pr-express-active`
- No TypeScript, no bundler, no test suite — manual testing only

## Branching

PRs use `claude/<feature>-<id>` branch names. Recent work has focused on direction logic (loop/junction handling) and station label display.
