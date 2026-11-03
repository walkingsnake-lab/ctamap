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

## Setting up a board (one command)

`scripts/setup-board.js` sets up a board without the Arduino IDE: the CI
build, the board's own key, its settings, one flash, and a printable label.

Once, on your computer:
- `npm install` in the repo (the label's QR codes need `qrcode`).
- `pip install esptool esp-idf-nvs-partition-gen`.
- The GitHub CLI (`gh auth login`), so the script can fetch the CI build.
- `export BOARD_CONTROL_PATH=…` (the Fly secret); for your own boards also
  `BOARD_TOKEN`.

Then, with the board on USB:

```sh
node scripts/setup-board.js --id kitchen --label "Kitchen"            # a board for someone else
node scripts/setup-board.js --id den --shared --wifi "home=password"  # one of yours
```

It asks you to put the board in upload mode (hold BOOT, tap RESET, release
BOOT), flashes, and says to press RESET. Then:
- **For someone else** (the default): the board gets its own token and owner
  link (the Board keys below) and no WiFi, so it opens its setup network.
  Print `~/board-labels/<id>-label.html` and stick it on the back: one QR joins
  the setup network, the other opens the owner link. The label is the only
  copy of the setup password and owner link, so keep the file until the
  board ships (it's kept outside the repo so it can't reach git or the
  server image). Don't pass `--wifi` here: the owner could
  read that password out of flash.
- **Yours** (`--shared`): the shared `BOARD_TOKEN`, and the networks you give
  with `--wifi` (repeatable; the first is tried first).

What it flashes: the CI build of the commit on the Stable channel if CI
still has it (90 days), else the newest build on `main`; `--firmware
<ctaboard.ino.merged.bin>` for another one. Only up to the end of the app is
written, so the board's TinyUF2 recovery loader (double-tap RESET for the
`MATRXS3BOOT` drive) stays. The settings partition is replaced: WiFi entered
on the board, OTA trial state and any old settings go.

Running it again on a board that already has a key needs `--rekey`: the
board gets a new token and owner link, and the old ones stop working (an old
label becomes useless). `--dry-run` does everything except change the server
or flash.

## Setting up (Arduino IDE)

For working on the firmware. To set up a board for use, the script above is
quicker.

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
   value as the Fly secret). `secrets.h` is never committed. A build with
   `secrets.h` is a **setup build**: on startup it saves these settings to the
   board's flash, where they stay through OTA updates (see
   [OTA updates](#ota-updates)). Edit `secrets.h` and flash again over USB to
   change them.
   - **`BOARD_ID`:** give each physical board its own (`home`, `office`, …).
     Boards sharing an ID share one config and show the same thing. A new ID
     adds itself on the server the first time it connects, as a copy of
     `home`; then pick it in the control page's board menu to change it.
3. **Open** `firmware-s3/ctaboard/ctaboard.ino`. The folder and the sketch
   must keep the same name.
4. **Board settings** (Tools menu):
   - Board: **Adafruit MatrixPortal ESP32-S3**
   - USB CDC On Boot: **Enabled** (for the serial log)
   - Partition Scheme: **TinyUF2 8MB (2MB APP/3.7MB FATFS)**, the default
     (two app slots, which OTA updates need)
   - Erase All Flash Before Sketch Upload: **Disabled**, the default (enabled
     wipes the saved settings)
5. **Stamp the build:** run `node scripts/stamp-firmware-version.js` from the
   repo root before each upload. It writes `ctaboard/version.h` (gitignored)
   with the commit, so the control page's Health tab shows which build the
   board runs (`_dirty` with uncommitted changes). Without it the board
   reports `dev`; after a pull, re-run it or the Health tab shows the old commit.
6. **Upload:** hold BOOT, tap RESET, release BOOT (upload mode; no drive
   appears), pick the port under Tools → Port, click Upload, then press
   RESET when it says "Done uploading".
7. **Serial log:** Tools → Serial Monitor at 115200 baud. Once a minute the
   board prints its average request time, new HTTPS connections that minute
   (the board keeps one open between requests, so this should stay near
   zero; a count close to the number of requests means the server side is
   closing it), draw time, counters, free memory, and the
   chip's temperature (`chip … C`, the S3's built-in sensor; useful for comparing
   enclosure venting: it reads the die, so compare runs, not absolute numbers). Send
   those lines back when something looks off.

What you should see: `WIFI <network>`, `WIFI OK`, then the transit screen.
The serial log's first lines name the build (`setup` or `generic`) and where
the settings came from (`[setup] board home, 3 networks, settings from
secrets.h` the first time, `flash` after that). `NO SETUP` on the panel means
a generic build on a board whose flash has no settings: flash a setup build
once.
`PORTAL` with the MAC address means the network wants a login page; `NO
WIFI` means none of the networks could be joined (it retries).

### The knob (optional)

An Adafruit 5880 I2C rotary encoder plugged into the STEMMA QT port (any
STEMMA QT / Qwiic cable, no soldering). It's the peek chooser (design spec
§10, "Knob"): turn it to move along the icon bar (Transit, Weather, Clock,
Announce, Cycle) and the panel shows that screen itself; press to step to its
next variant (rows or ticker, the weather views, the clock faces), or hold it
down and turn to step either way. Rest about a second and the bar drops away
on the chosen screen. The serial log says `[knob] encoder found` or `[knob] no
encoder on the STEMMA QT port` at startup, and `[board] knob: <category>
<variant>` after each choice. If clockwise goes the wrong way, set `KNOB_REVERSE 1` in
`secrets.h`. Without a knob the board runs as before.

### The light sensor (optional)

An Adafruit VEML7700 (4162 flat, or 5378 right-angle) chained off the knob's
second STEMMA QT socket. With the phone's brightness on Auto it follows the
room: full at `BRIGHT_LUX` and above, the phone's Dark room level at
`DARK_LUX` and below, linear in log lux between (`src/light.h`). A change
must last 5 s before the level moves, then it fades over 2 s. The serial log
says `[light] VEML7700 found` or `[light] no light sensor` at startup, and
`[light] <lux> lx: <level>%` each time the level moves; the control page's
Health tab shows the reading. The lux end points are guesses for the bar
sleeve case's 2 mm hole: tune them from those readings. Without a sensor (or
if it stops answering for 10 s) Auto is sunrise and sunset, as before.

### If the picture glitches

- **Shifted a pixel, or stray flickering pixels:** the panel latches data on
  the other clock edge. Flip `MATRIX_CLK_PHASE` (0 or 1) in `secrets.h`.
- **Glitches that remain with the clock edge right:** try
  `MATRIX_DOUBLE_BUFFER 0` (draws straight onto the panel, as the driver test
  sketch did).
- **Wrong colors (green shows as blue, blue as green):** the panel's color
  lines are wired in another order. Set `MATRIX_COLOR_ORDER "RBG"` in
  `secrets.h` (red/green swapped: `"GRB"`; red/blue: `"BGR"`). It reassigns the
  data pins, so the picture and timing are otherwise unchanged.
- The serial log's first lines show the refresh rate and these settings.

### Going back to CircuitPython

Press RESET, wait for the NeoPixel to turn purple, press RESET again: the
`MATRXS3BOOT` drive appears. Drag the CircuitPython `.uf2` onto it. If no
drive appears, use Open Installer on circuitpython.org for the Matrix Portal
S3.

## A board for someone else (by hand)

`scripts/setup-board.js` (above) does all of this in one command. By hand:

1. **Key:** on the control page, pick the board (or add it), Board tab →
   Owner link → **Give it its own key**. Copy the block it shows: the board's
   own token (shown only once), a setup network name and password, the
   owner link, and the text for the setup WiFi QR code.
2. **Flash** a setup build with that block as its `secrets.h`
   (`WIFI_NETWORKS {}`: their WiFi goes in on the board).
3. **Label** the board with two QR codes: the setup WiFi text
   (`WIFI:T:WPA;S:…;P:…;;`, which phones join from the camera) and the owner
   link.
4. **They plug it in:** with no WiFi saved, the panel shows `SETUP WIFI` and
   the network name. They scan the first QR, the setup page opens (or go to
   any web address), pick their network and enter its password. The board
   restarts and joins it. A wrong password brings the setup network back
   within about a minute, with a message.
5. **They scan the owner link** to control their board: that board only, no
   access to yours, updates Automatic or Off.

The setup network also opens on its own after 10 minutes without joining any
saved network (a new router or password), and gives up after 15 minutes
with no phone on it to retry the saved networks (a router back after a power
cut). Holding the knob (or UP) for 2 seconds while the board starts opens it
on demand. Up to 8 networks are kept, the newest tried first.

## OTA updates

Once a board has run a setup build, new firmware can reach it over WiFi:

1. **CI builds, signs and publishes it to Beta** on every merge to `main`
   that touches `firmware-s3/` (once the signing key is set up: "Signed
   builds" below). Nothing to do.
2. **Or by hand:** a generic build (no `secrets.h`; Sketch → Export Compiled
   Binary on a clean, stamped commit, the `.bin` that isn't `merged`), signed
   with `node scripts/sign-firmware.js <ctaboard.ino.bin>` (needs the
   signing key on your computer). On the control page: Board tab → Firmware
   updates → Upload, picking the `.bin` and its `.sig` together. It goes to
   **Beta**. The server refuses unsigned builds, setup builds (they contain
   your passwords), unstamped or `_dirty` builds, merged images, and anything
   that isn't this firmware for the S3.
3. **Boards follow their channel** (Updates, per board): Stable (default),
   Beta, a pinned build, or Off. Put your own boards on Beta; once a build
   has run well, press **Stable** on it so everyone else's boards get it.
4. **The board installs it** within a minute, between animations: the panel
   shows `UPDATING` and the percentage, then it restarts into the new build.
   The Health rows show the new Firmware commit.

Safety:
- The download goes into the unused app slot and is checked (SHA-256) before
  the board switches to it; a failed download changes nothing and is retried
  in 10 minutes.
- The new build is on **trial**: kept once it has reached the server and run
  a minute; rolled back to the previous build if it can't reach the server
  within 5 minutes or restarts more than 3 times first. A rolled-back build
  isn't installed again until you press **Try again** on the control page.
- A board running an unstamped (`dev`) or `_dirty` build is never updated, so
  test builds flashed over USB stay put. A test build from a clean commit
  *is* replaced by its channel's build: set that board's Updates to Off
  while testing.
- USB always works: flashing over USB puts that build back in charge.

Serial log lines start with `[ota]`: the running slot at startup, each
install, and the trial's outcome.

## Signed builds

Every OTA build is signed, and boards install only builds signed with the
key built into them, so even someone who took over the server couldn't push
firmware to anyone's board. Set up once, on your computer:

```sh
node scripts/firmware-key.js --github
```

- Makes the signing key, `~/.ctaboard/firmware-signing-key.pem`. **Back it
  up** (a password manager). If it's lost, boards can only get builds
  signed with a new key over USB.
- Writes the public key into the repo: `firmware-s3/firmware-signing.pub.pem`
  and `firmware-s3/ctaboard/src/signing_key.h`. Commit both and merge.
- With `--github` (needs `gh`): creates the `firmware-release` environment,
  usable only from `main`, holding the key and a new deploy token. A workflow
  edited on another branch can't read them. It prints a `fly secrets set
  FIRMWARE_DEPLOY_TOKEN=…` command; run it so the server accepts CI's uploads.

Until then, the server takes no builds and boards install none: the
repo's key is empty. Boards flashed before signing existed (#440–#445)
install the first signed build like any other and check signatures from
then on.

## Status LED

| Color | Means |
|---|---|
| off | Running normally |
| blue | A request is in progress (on the network task: animations keep running) |
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
| `ctaboard/src/draw.*` | Renderer and transit animator. Must stay pixel-identical to `server/board/draw.js`, the reference. Ported from the frozen `firmware/boardlib/draw.py`, so most names follow it; the skyline face (`render_skyline`) and new work port draw.js directly. |
| `ctaboard/src/json.*` | Small JSON tree with Python dict semantics, so the renderer reads payloads exactly as `draw.py` did. |
| `ctaboard/src/screen.h` | The screens as an enum (names only at the JSON boundary) and the redraw key. |
| `ctaboard/src/player.*` | What to draw at each moment and when the next animation starts (`player.py`). |
| `ctaboard/src/sched.h`, `control.h` | Network jobs, run when due one at a time on the worker; buttons vs. the phone (`control.py`); the knob's choosers (the old wheel, and the peek chooser: twist, press, hold and turn, rest; S3 only). |
| `ctaboard/src/app.*` | Main loop (`app.py`): connecting, scheduled jobs, buttons, redraws, OTA installs. The `sky` job fetches the skyline's cloud strip (`/board/sky/<id>`) while the clock screen shows; health reports `hk=skyline` so the server sends the clock screen to this build. |
| `ctaboard/src/config.*` | Settings in flash: saving a setup build's `secrets.h`, reading them back in a generic build; the WiFi setup page and its rules. |
| `ctaboard/src/ota.h` | OTA trial rules: keep, roll back, don't reinstall a rolled-back build. |
| `ctaboard/src/color.*`, `calibrate.*` | Color curves (compensated for the driver's CIE curve) and the calibration pattern. |
| `ctaboard/src/device.*` | Hardware only: DMA panel, WiFi + HTTPS (requests on a core-0 task, `NetWorker`), buttons, the knob (seesaw over I2C, turns and its push button), NeoPixel, watchdog, settings and OTA state in NVS, OTA slot writes, the WiFi setup network (`SetupPortal`). The only code that includes Arduino headers. |
| `ctaboard/src/assets.h` | Fonts, icons, glyphs. **Generated** by `node scripts/build-firmware-assets.js`. |
| `ctaboard/src/signing_key.h` | The public key OTA builds must be signed with. **Generated** by `node scripts/firmware-key.js`; empty until the key exists (then no OTA build installs). |
| `ctaboard/src/certs.h` | Root certificates for HTTPS. **Generated** by `node scripts/build-firmware-certs.js`. |
| `ctaboard/version.h` | The build's commit, for health. **Generated** by `node scripts/stamp-firmware-version.js`; gitignored. |
| `tests/` | Run by `npm test` (needs g++ or clang++): `parity` renders every scenario in `firmware/tests/scenarios.js` and compares pixels with draw.js; `app_test` runs the main loop against a simulated server, clock, and buttons (OTA installs and trials included); `config_test` checks settings in flash and the OTA status screens. |

## Rules

- **draw.js is the reference.** Change it first, then mirror the change in
  `draw.cpp`; `npm test` fails until they match. `draw.py` (the M4) is
  frozen: tag new scenarios `s3only` (see `firmware/tests/scenarios.js`),
  and don't keep `draw.cpp` shaped like it.
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
  draws frames at full brightness, so colors keep every step. The window
  stops at `color::HW_MIN_OE` (16, about 28%), where its steps get coarse;
  below that the renderer scales the colors for the rest (`color::hw_dim`).
  The default night level, 40%, stays entirely in hardware.
  `MATRIX_CALIBRATE 1` shows a pattern for choosing on the panel.
- Not verifiable here: speed, memory, WiFi, and TLS on the real S3. Those get
  checked on hardware from the serial log.
