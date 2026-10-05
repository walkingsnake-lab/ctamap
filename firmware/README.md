# Board firmware (CircuitPython)

Runs on the Adafruit Matrix Portal M4 driving the 64x32 panel. The server does
all fetching and formatting (`server/board/`, API in `docs/board/contract.md`);
the board draws what it receives.

## Setting up the board

1. **CircuitPython 9.x.** Plug the Matrix Portal into your computer over USB-C,
   double-tap its RESET button (a `MATRIXBOOT` drive appears), and drag the
   Matrix Portal M4 `.uf2` from circuitpython.org/board/matrixportal_m4 onto it.
   It restarts as a `CIRCUITPY` drive.
2. **Libraries.** Copy these from the CircuitPython library bundle (matching
   your CircuitPython version) into `CIRCUITPY/lib/`, or run
   `circup install adafruit_esp32spi adafruit_requests adafruit_connection_manager`:
   - `adafruit_esp32spi/`
   - `adafruit_requests.mpy`
   - `adafruit_connection_manager.mpy`
3. **This code.** The board can't compile the larger `.py` files itself (it
   runs out of memory), so build them to `.mpy` first. Download CircuitPython's
   `mpy-cross` for your computer and CircuitPython version from
   https://adafruit-circuit-python.s3.amazonaws.com/index.html?prefix=bin/mpy-cross/
   (MicroPython's won't do), then run
   `node scripts/build-firmware.js path/to/mpy-cross`. Copy everything in
   `firmware/build/` to the root of `CIRCUITPY`. If `CIRCUITPY/boardlib/` has
   `.py` files from an earlier copy, delete them (keep `__init__.py`): a `.py`
   is imported instead of its `.mpy`.
4. **Settings.** Copy `settings.toml.example` to `CIRCUITPY/settings.toml` and
   fill in your WiFi networks (tried in order) and `BOARD_TOKEN` (the same
   value as the Fly secret).
5. **Watch the serial console** (https://code.circuitpython.org, Mu, or PuTTY
   on the board's COM port at 115200). Once a minute the board prints its
   fetch budget, last and slowest draw time, counters, and free memory. Send
   those lines (and any traceback) back when something looks off. Animations
   redraw every 33 ms, so a slowest draw well over that means they stutter.

What you should see: `WIFI <network name>` while connecting, `WIFI OK`, then the
transit screen. `PORTAL` with the MAC address means the network wants a login
page; `NO WIFI` means none of the networks could be joined (it retries every
minute).

## Layout

| Path | What |
|---|---|
| `code.py` | Entry point; restarts cleanly after a crash. |
| `build/` | Output of `node scripts/build-firmware.js` (not committed): what goes on `CIRCUITPY`. |
| `boardlib/draw.py` | Renderer: a line-by-line port of `server/board/draw.js`. Must stay pixel-identical. |
| `boardlib/assets.py` | Fonts, icons, glyph codepoints. **Generated** by `node scripts/build-firmware-assets.js`; never edit by hand. |
| `boardlib/app.py` | Main loop: connecting (status screens), the scheduled jobs (version check every 10 s, update every 30 s or on a settings change, radar frames while the radar shows), buttons, redraws. |
| `boardlib/player.py` | What to draw at each moment (transit animator, ticker paging, radar loop, blink) and when the next animation starts. |
| `boardlib/sched.py` | Runs network requests in animation gaps; forces them past a deadline; learns the request time. |
| `boardlib/control.py` | UP/DOWN buttons (cycle transit, ticker, weather, baseball): last action wins against the phone. |
| `boardlib/status.py` | WIFI / WIFI OK / PORTAL / NO WIFI / NO SERVER screens. |
| `boardlib/device.py` | Hardware only: the matrix (palette-indexed bitmap, `bitmaptools` fills and glyph and radar copies), ESP32 WiFi + HTTPS, buttons, watchdog. |
| `tests/` | Run by `npm test` (needs `python3`): pixel parity with draw.js through both the plain frame and the board's bitmap frame (with stand-ins for the CircuitPython modules), and the main loop against a simulated server, clock, and buttons. |

## Rules

- **draw.js is the reference.** Change it first, then mirror the change in
  draw.py; `npm test` fails until they match.
- Keep boardlib runnable on both CircuitPython and CPython: no `typing`,
  `dataclasses`, `re`, or f-strings; hardware imports only in `device.py`.
- Use `jsround()` wherever draw.js uses `Math.round`.
- Keep epoch times in integers and use `//` on them: CircuitPython floats have
  22 bits of precision (about 8 minutes at today's epoch seconds), and
  `math.floor`/`math.ceil` convert to float first.
- Clock text uses the payload's `tzo` (Chicago's UTC offset); there is no
  time zone database on the board.
- Not verifiable here: speed and memory on the real M4, the exact ESP32 and
  matrix pin behavior. Those get checked on hardware from the serial log.
