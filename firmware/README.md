# Board firmware (CircuitPython)

Runs on the Adafruit Matrix Portal M4 driving the 64x32 panel. The server does
all fetching and formatting (`server/board/`, API in `docs/board/contract.md`);
the board draws what it receives.

## Layout

| Path | What |
|---|---|
| `boardlib/draw.py` | Renderer: a line-by-line port of `server/board/draw.js` (static screens and the transit animator). Must stay pixel-identical. |
| `boardlib/assets.py` | Fonts, icons, glyph codepoints. **Generated** by `node scripts/build-firmware-assets.js`; never edit by hand. |
| `tests/` | Parity check: `scenarios.js` renders payloads and animation sequences with draw.js, `parity.py` renders them with draw.py and compares every pixel. Runs in `npm test`. |

Still to come: the device runtime (display, Wi-Fi with status screens, the
fetch/animation scheduler, buttons) and the files to copy to the CIRCUITPY drive.

## Rules

- **draw.js is the reference.** Change it first, then mirror the change in
  draw.py; `npm test` fails until they match.
- Keep draw.py runnable on both CircuitPython and CPython: no `typing`,
  `dataclasses`, `re`, or f-string format specs.
- Use `jsround()` wherever draw.js uses `Math.round`.
- Clock text uses the payload's `tzo` (Chicago's UTC offset); there is no
  time zone database on the board.
