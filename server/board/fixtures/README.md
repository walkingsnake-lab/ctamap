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

Never record a URL with `key=` in it here.
