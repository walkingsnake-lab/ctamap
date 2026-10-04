# Board test fixtures

Raw upstream responses, saved unchanged. Tests run against these; they never hit live APIs.

- `tt-arrivals/` — Train Tracker `ttarrivals` responses, recorded via
  `/board/<control path>/api/raw/arrivals?mapid=<id>`. File names are
  `<station>-<date>-<HHMM local>.json`.

| File | Notes |
|---|---|
| `morse-2026-10-03-2316.json` | Late evening. Southbound 95th trains are schedule-based (`isSch=1`, still at the Howard terminal); one also has `isDly=1`, `isFlt=1`. |
| `howard-2026-10-03-2316.json` | Terminal. Red/Yellow "Terminal Arrival" predictions and late-night Purple trains with `destNm` "Howard" (trains ending here); Yellow has `lat`/`lon` "0". |
| `belmont-2026-10-03-2316.json` | Red + Brown; Brown `destNm` "Loop". |
| `jefferson-park-2026-10-03-2316.json` | Blue only; no short-turns at this hour. |
| `clark-lake-2026-10-03-2317.json` | Loop: Blue, Brown, Green (Harlem/Lake), Pink (54th/Cermak). |

- `cta-alerts/` — CTA Customer Alerts (`alerts.aspx`, XML, the shared poller's URL).
  - `2026-10-04-1057.xml`: 7 alerts. Multi-line State/Lake closure (5 lines, `special-note`), Blue schedule change and Green 43rd bypass (`planned`; the bypass lists the station before the line), three elevator outages, and one Orange/Green `minor` delay.
- `open-meteo/` — Open-Meteo forecasts for a station's coordinates (`weather.js` `url()`).
  - `morse-2026-10-04-1045.json`: clear (code 0), day, 63.3°F, hi 68.9 / lo 51.0.
- `nws/` — NWS `alerts/active?point=` responses.
  - `morse-2026-10-04-none.json`: no active alerts. Still needed: a real warning/watch (`api.weather.gov/alerts?event=...` returns the past week).

Never record a URL with `key=` in it here.
