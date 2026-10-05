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
  - `morse-2026-10-04-none.json`: no active alerts.
  - `svr-warning-expired-2026-10-03-jax.json`: from `alerts?event=Severe Thunderstorm Warning&limit=1` (past week). A Severe Thunderstorm Warning **expiration** statement (VTEC `/O.EXP./`, `ends` before `sent`), NWS Jacksonville. Tests derive in-effect warnings and watches from it.

- `mrms/` — IEM `mrms_lcref` frames (full CONUS PNG + `.wld`), from `mesonet.agron.iastate.edu/archive/data/.../GIS/mrms/`.
  - `lcref_202008102100.*`: Aug 10, 2020 derecho crossing Chicago (4:00 PM CDT). Old-style `.wld` origin (-130.0, 55.0).
  - `lcref_202202021800.*`: Feb 2, 2022 snowstorm, noon CST. Chicago crop averages 11–18 dBZ.
  - `lcref_202610041600.*`: Oct 4, 2026, clear at Chicago. New-style `.wld` origin (-129.995, 54.995).

- `mlb/` — MLB Stats API schedule responses (`mlb.js` `url()`, `hydrate=linescore`). Record new ones from `/board/<control path>/api/raw/mlb`.
  - `schedule-2026-10-03-alds-final.json`: ALDS Game 1, White Sox 3 at Guardians 0, final (postseason `leagueRecord` 1-0 / 0-1). **Not a byte-for-byte recording**: the cloud session couldn't reach the API directly, so it was assembled from a fetched copy of the game object (field names and values as returned; the date wrapper and a trimmed `defense` block filled in). Replace with a capture from `api/raw/mlb` when convenient.

Never record a URL with `key=` in it here.
