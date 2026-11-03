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
- `weatherapi/` — WeatherAPI `forecast.json` responses for a station's grid cell (`weather.js` `url()`). Record new ones from `/board/<control path>/api/raw/weather?mapid=<id>`.
  - `morse-cell-2026-10-31-2334.json`: recorded from `api/raw/weather?mapid=40100`, Saturday 11:34 PM, the night DST ends (Nov 1 has two 1 AM hours). WeatherAPI resolved the cell to "Howard District" (42.021, -87.669). Overcast (1009), 58.3°F, feels 54.1, SE 4.9 mph, 14–17% rain chance overnight; Sunday and Monday overcast (66.0, 60.5).
  - `morse-cell-2026-10-04-1045.json`: Morse's cell, Sunday 10:46 AM. Sunny, 63.3°F (hi 68.9 / lo 51.0), feels 63.3, NW 8.7 mph, 10% rain chance at 2 PM; Monday light rain (71.4), Tuesday partly cloudy (66.0). **Not a recording**: assembled (no key or network access in the cloud session) to cover a sunny daytime case, with values mirroring the Open-Meteo Morse recording it replaced. Every field in it also appears in the recorded response above (a test checks). Replace with a daytime capture when convenient.
- `nws/` — NWS `alerts/active?point=` responses.
  - `morse-2026-10-04-none.json`: no active alerts.
  - `svr-warning-expired-2026-10-03-jax.json`: from `alerts?event=Severe Thunderstorm Warning&limit=1` (past week). A Severe Thunderstorm Warning **expiration** statement (VTEC `/O.EXP./`, `ends` before `sent`), NWS Jacksonville. Tests derive in-effect warnings and watches from it.

- `nws-forecast/` — NWS forecasts for Morse (grid LOT 74,79; `nws-forecast.js`), saved from a browser.
  - `morse-points.json`: `/points/42.0084,-87.6659`.
  - `morse-2026-10-11-1406-forecast.json`: 12-hour periods, Sunday afternoon. Sunny today and Monday; rain showers likely Tue night–Thu (60–70%); Friday a split icon (`rain_showers,20/wind_bkn`, slight chance before 7 AM).
  - `morse-2026-10-11-1404-hourly.json`: 156 hourly periods from 2 PM Sunday.

- `mrms/` — IEM `mrms_lcref` frames (full CONUS PNG + `.wld`), from `mesonet.agron.iastate.edu/archive/data/.../GIS/mrms/`.
  - `lcref_202008102100.*`: Aug 10, 2020 derecho crossing Chicago (4:00 PM CDT). Old-style `.wld` origin (-130.0, 55.0).
  - `lcref_202202021800.*`: Feb 2, 2022 snowstorm, noon CST. Chicago crop averages 11–18 dBZ.
  - `lcref_202610041600.*`: Oct 4, 2026, clear at Chicago. New-style `.wld` origin (-129.995, 54.995).

- `radar-nws/` — NWS map service (`radar-nws.js`), Nov 3, 2026, recorded from the cloud session.
  - `catalog-20261103-2150.json`: `query` for CONUS items (`catalogUrl()`), 17 frames 19:40–21:50 UTC.
  - `bref-20261103-214420-32.0n-93.0w.png`: `exportImage` locked to the 21:44:20 UTC item (objectid 262765637), the window for a station at 32.0 N, 93.0 W (northwest Louisiana; rain to 53 dBZ). 166 × 72, 8-bit RGB with a tRNS background.
  - `mrms-bref-20261103-214420-32.0n-93.0w.png` + `.wld`: the truth for it. **Derived, not a recording**: the raw MRMS file of the same time (`noaa-mrms-pds` on AWS, `CONUS/MergedBaseReflectivityQC_00.50/20261103/MRMS_MergedBaseReflectivityQC_00.50_20261103-214420.grib2.gz`, GRIB2 PNG-packed), cropped to the same window and written as an lcref-style palette PNG (index = (dBZ + 32) × 2, 255 missing) so the IEM pipeline reads it.

- `mlb/` — MLB Stats API schedule responses (`mlb.js` `url()`, `hydrate=linescore`). Record new ones from `/board/<control path>/api/raw/mlb`.
  - `schedule-2026-10-03-alds-final.json`: ALDS Game 1, White Sox 3 at Guardians 0, final (postseason `leagueRecord` 1-0 / 0-1). **Not a byte-for-byte recording**: the cloud session couldn't reach the API directly, so it was assembled from a fetched copy of the game object (field names and values as returned; the date wrapper and a trimmed `defense` block filled in). Replace with a capture from `api/raw/mlb` when convenient.

Never record a URL with `key=` in it here.
