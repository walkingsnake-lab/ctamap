# Board firmware for the Matrix Portal S3 (C++)

Runs on the Adafruit Matrix Portal S3 driving the 64x32 panel. Like the M4's
CircuitPython firmware (`firmware/`, now frozen), the server does all fetching
and formatting (`server/board/`, API in `docs/board/contract.md`) and the
board draws what it receives.

Why C++: CircuitPython's matrix driver refreshes the panel in software and
visibly shimmers on the S3. This firmware uses the
[ESP32-HUB75-MatrixPanel-DMA](https://github.com/mrcodetastic/ESP32-HUB75-MatrixPanel-DMA)
driver, where the S3's display hardware streams the panel data on its own:
steady at 8-bit color.

## Setting up (Arduino IDE)

1. **Arduino IDE 2.x**, with:
   - **Boards:** add
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
     under File → Preferences → Additional boards manager URLs, then install
     **esp32** by Espressif Systems (Tools → Board → Boards Manager).
   - **Libraries** (Tools → Manage Libraries): **ESP32 HUB75 LED MATRIX PANEL
     DMA Display** (by mrcodetastic) and **Adafruit GFX Library** (choose
     Install All for its dependencies).
2. **Settings:** in `firmware-s3/ctaboard/`, copy `secrets.example.h` to
   `secrets.h` and fill in your WiFi networks and `BOARD_TOKEN` (the same
   value as the Fly secret). `secrets.h` is never committed.
3. **Open** `firmware-s3/ctaboard/ctaboard.ino`. The folder and the sketch
   must keep the same name.
4. **Board settings** (Tools menu):
   - Board: **Adafruit MatrixPortal ESP32-S3**
   - USB CDC On Boot: **Enabled** (for the serial log)
5. **Upload:** hold BOOT, tap RESET, release BOOT (upload mode; no drive
   appears), pick the port under Tools → Port, click Upload, then press
   RESET when it says "Done uploading".
6. **Serial log:** Tools → Serial Monitor at 115200 baud. Once a minute the
   board prints its fetch budget, draw time, counters, free memory, and the
   chip's temperature (`chip … C`, the S3's built-in sensor; useful for comparing
   enclosure venting: it reads the die, so compare runs, not absolute numbers). Send
   those lines back when something looks off.

What you should see: `WIFI <network>`, `WIFI OK`, then the transit screen.
`PORTAL` with the MAC address means the network wants a login page; `NO
WIFI` means none of the networks could be joined (it retries).

### If the picture glitches

- **Shifted a pixel, or stray flickering pixels:** the panel latches data on
  the other clock edge. Flip `MATRIX_CLK_PHASE` (0 or 1) in `secrets.h`.
- **Glitches that remain with the clock edge right:** try
  `MATRIX_DOUBLE_BUFFER 0` (draws straight onto the panel, as the driver test
  sketch did).
- The serial log's first lines show the refresh rate and both settings.

### Going back to CircuitPython

Press RESET, wait for the NeoPixel to turn purple, press RESET again: the
`MATRXS3BOOT` drive appears. Drag the CircuitPython `.uf2` onto it. If no
drive appears, use Open Installer on circuitpython.org for the Matrix Portal
S3.

## Status LED

| Color | Means |
|---|---|
| off | Running normally |
| blue | A request is in progress (animations pause until it returns) |
| yellow | Joining WiFi |
| amber | Captive portal |
| red | No WiFi, or the server isn't answering |
| dim red | Online, but the last request failed (clears on the next success) |
| white for 2 s at startup | The last reset was the watchdog (the loop hung) |
| red for 2 s at startup | The last reset was a crash |

## Layout

| Path | What |
|---|---|
| `ctaboard/ctaboard.ino` | Entry point: reads `secrets.h`, wires up the hardware, runs the loop. |
| `ctaboard/src/draw.*` | Renderer and transit animator: a line-by-line port of `firmware/boardlib/draw.py`. Must stay pixel-identical to `server/board/draw.js`. |
| `ctaboard/src/json.*` | Small JSON tree with Python dict semantics, so the port reads payloads exactly as `draw.py` does. |
| `ctaboard/src/player.*` | What to draw at each moment and when the next animation starts (`player.py`). |
| `ctaboard/src/sched.h`, `control.h` | Requests in animation gaps; buttons vs. the phone (`sched.py`, `control.py`). |
| `ctaboard/src/app.*` | Main loop (`app.py`): connecting, scheduled jobs, buttons, redraws. |
| `ctaboard/src/color.*`, `calibrate.*` | Color curves (compensated for the driver's CIE curve) and the calibration pattern. |
| `ctaboard/src/device.*` | Hardware only: DMA panel, WiFi + HTTPS, buttons, NeoPixel, watchdog. The only code that includes Arduino headers. |
| `ctaboard/src/assets.h` | Fonts, icons, glyphs. **Generated** by `node scripts/build-firmware-assets.js`. |
| `ctaboard/src/certs.h` | Root certificates for HTTPS. **Generated** by `node scripts/build-firmware-certs.js`. |
| `tests/` | Run by `npm test` (needs g++ or clang++): `parity` renders every scenario in `firmware/tests/scenarios.js` and compares pixels with draw.js; `app_test` runs the main loop against a simulated server, clock, and buttons. |

## Rules

- **draw.js is the reference.** Change it first, then mirror the change in
  `draw.cpp`; `npm test` fails until they match. `draw.py` (the M4) is
  frozen: tag new scenarios `s3only` (see `firmware/tests/scenarios.js`).
- Everything except `device.cpp` and the `.ino` is plain C++17 with no
  Arduino headers, so it builds natively for the tests.
- Mirror Python's semantics where the port depends on them: floor division
  and modulo are `draw::fdiv` / `draw::fmod_floor`; Python truthiness is
  `json::Value::truthy()`; `x is None` is an empty `std::optional`.
- Color: the renderer scales pixels by the payload's `bright`, then
  `src/color.cpp` maps each color through the chosen curve (`MATRIX_CURVE`)
  and inverts the DMA driver's own CIE curve, so the panel shows exactly
  that curve: `MATRIX_CURVE` at full brightness, `MATRIX_NIGHT_CURVE` while
  dimmed. With `MATRIX_HW_DIM 1` the board dims in hardware (the driver's
  output-enable window, `k^2.2` of full so night is as dark as before) and
  draws frames at full brightness, so colors keep every step.
  `MATRIX_CALIBRATE 1` shows a pattern for choosing on the panel.
- Not verifiable here: speed, memory, WiFi, and TLS on the real S3. Those get
  checked on hardware from the serial log.
