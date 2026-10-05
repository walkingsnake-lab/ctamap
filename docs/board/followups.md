# Board follow-ups

Noted in the Oct 5, 2026 review of the board code, left for a later pass.

## Organization

- **Split `server/board/index.js`.** It holds the router, simulator test alerts, previews, and `update()`, which assembles the payload. Move `update()` into its own module so it can be tested without HTTP.
- **One home for shared constants.** `DROP_GRACE` and `maxRows` live in both `arrivals.js` and `draw.js` (two `maxRows` implementations). The line-code list is in `state.js`, `index.js`, `destinations.js`, and `draw.js`. `stations.json` is loaded by both `state.js` and `index.js`. `arrivals.js` already requires `draw.js` (mid-file); take the shared ones from there.
- **One player for the simulator and the board.** Ticker paging, the radar loop, and baseball roll tracking are written twice (`sim.html` and `firmware/boardlib/player.py`) with no parity test, and they already differ (radar loop phase, clock smoothing, redraw-on-change). A `player.js` ported to `player.py`, like `draw`, would fix that.
- **Payload duplicates.** `radar.temp`/`radar.icon` repeat `radar.wx.temp`/`radar.wx.icon`; `tickerHeader` usually equals `header`. A rainy payload with a live game is ~1.5 KB against the contract's 1.2 KB target: raise the target or trim.
- **Shared poller.** `tracker.js` and `location-poller.js` implement the same cache/poll/backoff pattern separately.
- **CI.** No GitHub Action runs `npm ci && npm test` (with Python 3), so the pixel-parity rule holds only when someone runs the tests.
- `autoFit: false` in `arrivals.js` `format()` is only used by a test.
- `real-40100-*.png` and `real-40450-*.png` in the repo root aren't referenced.
- CTA calls use `http://` (the API key travels unencrypted); `lapi.transitchicago.com` supports HTTPS. The map's calls do the same.
- `fly.toml` sets both `memory = '1gb'` and `memory_mb = 256`. The radar design assumes 256 MB; check `fly scale show` and keep one.

## Docs drift

- Radar AM/PM color: `design-spec.md` §7 says `#555555`; §4 and the code use `#8f8f8f`. The contract's weather-screen word color says `#555555`; the code uses `#8f8f8f`.
- `design-spec.md` §7 says the radar warning icon is "Steady, no blinking"; the line before and the code blink a tornado warning.
- `contract.md` "Server polling" says MRMS runs every 5 min, always; the radar section and the code poll every 20 s while a board asked in the last 2 min, on 6-minute slots. `design-spec.md` §2 also says 5 min.
- `contract.md` lists `icon` twice in the weather-row table (the second is `radar.icon`, missing from the radar table), and a blank line splits the radar table.
- `design-spec.md` §1 and §3 say the board uses PCF fonts; the firmware uses the generated `assets.py`.
- `design-spec.md` §4 promises a minimum floor so dim elements never go black at night; brightness is a plain multiply.
- Stale comments: `radar.js` `slots()` says 5-minute slots (they're 6); `mlb.js`'s header comment breaks a sentence mid-line.
- `CLAUDE.md` says the contract "will live" in `docs/board/contract.md`; it exists.
