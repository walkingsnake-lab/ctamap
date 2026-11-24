# Bus Tracker fixtures

**Not recorded.** These follow the response shapes in CTA's Bus Tracker API
guide (v3, `format=json`, `tmres=s`), with made-up stops, vehicles and times:
there was no Bus Tracker key when bus support was built. Replace them with
real responses (`api/raw/bus?fn=getpredictions&stpid=...` on the control
path) once `CTA_BUS_KEY` is set, and add a test for anything that differs.
The guide gives no JSON example of an error, so `error` here is a best guess.
