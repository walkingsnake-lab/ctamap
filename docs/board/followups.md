# Board follow-ups

Noted in the Oct 5, 2026 review of the board code, left for a later pass. Checked against the code Nov 27, 2026: the items since fixed (CI, the docs-drift entries but one, the stale comments) were removed.

## Organization

- **Split `server/board/index.js`.** It holds the router, simulator test alerts, previews, and `update()`, which assembles the payload. Move `update()` into its own module so it can be tested without HTTP.
- **One home for shared constants.** `DROP_GRACE` and `maxRows` live in both `arrivals.js` and `draw.js` (two `maxRows` implementations). The line-code list is in `state.js`, `index.js`, `destinations.js`, and `draw.js`. `stations.json` is loaded by both `state.js` and `index.js`. `arrivals.js` already requires `draw.js` (mid-file); take the shared ones from there.
- **One player for the simulator and the board.** Ticker paging, the radar loop, and baseball roll tracking are written twice (`sim.html` and `firmware/boardlib/player.py`) with no parity test, and they already differ (radar loop phase, clock smoothing, redraw-on-change). A `player.js` ported to `player.py`, like `draw`, would fix that.
- **Payload duplicates.** `radar.temp`/`radar.icon` repeat `radar.wx.temp`/`radar.wx.icon`; `tickerHeader` usually equals `header`. A rainy payload with a live game is ~1.5 KB against the contract's 1.2 KB target: raise the target or trim.
- **Shared poller.** `tracker.js` and `location-poller.js` implement the same cache/poll/backoff pattern separately.
- `autoFit: false` in `arrivals.js` `format()` is only used by a test.
- `real-40100-*.png` and `real-40450-*.png` in the repo root aren't referenced.
- CTA calls use `http://` (the API key travels unencrypted); `lapi.transitchicago.com` supports HTTPS. The map's calls do the same.

## Docs drift

- `design-spec.md` §4 promises a minimum floor so dim elements never go black at night; brightness is a plain multiply.
