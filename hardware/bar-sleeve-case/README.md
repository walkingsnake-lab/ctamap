# CTA LED Board: Bar Sleeve Case (v5 drawer)

Walnut wood PLA sleeve with a slanted shade hood; a black PETG tray slides in from the back and carries the Matrix Portal S3,
bolted to the panel's four corner inserts. Built for the Waveshare P3 64x32 (this sheet); the P2.5 is under
[Other panels](#other-panels). Why things are the way they are: [DESIGN-HISTORY.md](DESIGN-HISTORY.md). The v4 build (flat
back plate) is archived in [ARCHIVE-v4.md](ARCHIVE-v4.md).

## Fixed decisions
- Slanted hood (12 mm lip at the top, 3 mm at the bottom): non-negotiable.
- Shell in Bambu PLA Wood (walnut), printed back-down without supports, front lapped flat afterwards. The screen rim is part of
  the shell. Openings print open (knob hole, USB-C, the two screw holes underneath, the Ø2 light-sensor pinhole).
- No grilles in the shell: the tray's back has two louver bands (intake along the bottom, exhaust along the top), slots
  rising 45° inward so nothing inside shows from eye level.
- The tray is boxed in by the sleeve (crush ribs on its outside take up the clearance), so nothing latches at the top; two
  screws from below stop it sliding out. Everything screws into printed PETG: no nuts, no soldering, no heat-set inserts
  (the bosses can take inserts later: [Heat-set inserts](#heat-set-inserts-later)).

## What to print
Files are in `stl/v5-drawer/` unless they start with `stl/`.

| Part | File | Material | Print |
|---|---|---|---|
| **Test plate** (first, once) | `test-plate-v5.stl` + `test-plate-v5-window.stl`: load both as one object with two parts; the window part is translucent | black PETG + translucent PETG | as exported; see [Test plate](#test-plate) |
| Shell | `bar-shell-v5-walnut-backdown.stl` | PLA Wood | as exported (back rim down) |
| Tray | `bar-drawer-tray.stl` + `bar-drawer-tray-window.stl`: one object, two parts (they share one frame; don't move either on its own); the window is the status light | black PETG + translucent PETG | as exported (back face down, walls up) |
| Diffuser | `stl/bar-diffuser-white-face.stl` + `stl/bar-diffuser-white-grid-black.stl` (0.2 face, 0.4 nozzle), or `stl/bar-diffuser-translucent-face.stl` + `stl/bar-diffuser-translucent-grid-black.stl` (0.4 face, 0.6 nozzle): one object, two parts | face white or translucent, the rest black | face down; the face part is the first layer |
| Encoder collar | `bar-encoder-collar-v5.stl` | walnut, or translucent PETG for the knob's glow | flange-top down |
| Knob | `stl/bar-knob.stl` | white PLA, or any | as exported |
| Boot key | `stl/bar-boot-key.stl` | PETG or PLA | flat |
| Light-sensor sled (optional) | `bar-sensor-sled.stl` | PETG | plate down |
| Wall cleat (optional) | `bar-cleat-case.stl` + `bar-cleat-wall.stl` | PETG | wall face down |
| Tilt plinth (optional) | `stl/bar-plinth-walnut-8deg.stl` | PLA Wood | flat |

## Test plate
**Round 2 (`test-plate-v5b.stl`, black PETG, ~60 x 16 mm):** the cleat pilots at Ø3.2 / 3.3 / 3.4 (1-3 notches; round 1's
2.8 / 2.9 / 3.0 were all too tight) and the post with its re-done floor. Same checks as items 2 and 4 below. Round 1 passed
the window, the rails (now 0.25 mm closer a side) and the sled.

**Round 1:** one print with every fit that's new and not yet confirmed on a real print (Nov 3). Print it with the tray's settings
(below). It has five pieces: the long top strip, a small piece of the tray's back (status window and Boot funnel), a block
of three bosses, one short post, and the light-sensor sled (a real one: keep it for the build). Then:
1. **Status window** (on the small back piece, beside the Boot funnel): the translucent disc should be clean and flush,
   with no black bleeding into it. That's the AMS swap the tray will do.
2. **Cleat pilots** (three bosses, 1-3 notches = Ø2.8 / 2.9 / 3.0): drive an M3 x 10 into each, from the flat side, through
   a 4 mm spacer (a scrap of plastic or a stack of washers: the cleat is 4 mm thick there), or let the tip come out 3.5 mm
   the far side. Keep the one that threads in firmly without the boss splitting. The tray has 3.3 (`TAP_D_V` in
   `src/drawer.py`): if another wins, change it and regenerate. (The bottom screws' pilots are settled: Ø3.0, the fit set's best.)
3. **Top strip** (the long piece: the tray's top wall over the encoder and the sensor):
   - **Encoder rails:** set the encoder's board between the two rails at the left end. It should go in with a little play
     (~0.45 mm a side) and, turned, stop at about 2.3°.
   - **Sensor sled:** tilt the sled about 10° (front down), put its two back tabs into the two hooks, swing the front up to
     the wall and drive an M2.5 x 6 in from the outside face (the counterbore beside the big hole). The tabs should slide
     in without force and not rattle.
4. **Post** (the short round one): its floor prints as a bridge, the way the tray's four post floors will. Its first layer
   is a slot running across the tube and its second a square (sequential bridging: every strand is anchored at both
   ends, so nothing sags round a hole), then the round hole. Check the inside is clean, then drop an M3 x 8 flanged button
   head down the tube: the flange should sit flat on the two strips either side of the slot and the screw should slide
   ~0.7 mm every way.

## Hardware
- **Screws** (button heads; the hex keys below fit them): 4 x M3 x 8 **flanged** button head (ISO 7380-2, flange ~Ø6.9;
  tray posts into the panel's inserts: not in the Hantof kit, buy a small pack; or a plain M3 x 8 button head over an M3
  washer), 2 x M3 x 10 (from below, threaded into the tray), 4 x M2.5 x 8 (S3 onto its posts, self-tapping), the
  encoder's M7 nut and washer.
- **Light sensor (optional):** Adafruit VEML7700 (4162, flat), 2-4 x M2.5 x 5 (sensor onto the sled), 1 x M2.5 x 6 (sled,
  from outside the tray). Button heads: the M2.5 x 6 sits in a 1.8 mm counterbore under the sleeve, and a socket cap
  (~2.5 tall) would stand proud and jam the tray.
- **Wall cleat (optional):** 2 x M3 x 10 (case cleat into the tray), 2 x #8 / 4 mm countersunk wood screws or anchors.
- **Cables:** the panel's 16-pin ribbon (at least 15 cm, 20 cm comfortable, so the tray comes out still cabled) and its
  power leads; STEMMA QT: S3 → sensor 10 cm and sensor → encoder 15-20 cm, or one 20-30 cm S3 → encoder without the sensor;
  a data-capable USB-C cable and a 5 V / 3 A USB-C supply.
- **Other:** 4 round black bumpers 12.7 x 3.8 mm (3M SJ5312 size; +4 for the plinth); 1-2 hook-and-loop ties ~12 mm wide.
- **Tools:** hex keys 1.5 mm (M2.5) and 2 mm (M3; its long arm reaches the ~34 mm down the post tubes); pliers or a small
  wrench for the M7 nut; a 2 mm (or 5/64") drill bit, turned by hand.

## Print settings
- **Shell:** Bambu PLA Wood profile, filament dried (~8 h at 50-55 °C) and flow-calibrated. 0.2 mm base layers with variable
  layer height (smooths the hood ramp and rim slopes), 4 walls on a 0.4 nozzle, elephant foot 0.15. Seam: rotate Z 225° (or
  135°) so the bottom-right corner faces the back, Seam position "Back", scarf seam; check in Preview. Outer brim 5 mm with
  a 0.1 mm gap; Z hop 0.6 mm. Plate washed with dish soap, then glue stick; bed 55-60 °C; door closed.
- **Tray** (and the test plate, which should match whatever your tray printed well with): PETG, 0.4 nozzle, 0.24 mm layers, 4 walls, 4 top + 4 bottom layers, 15% gyroid, monotonic
  bottom surface, textured PEI, elephant foot 0.15, Z hop, dried PETG. The window part takes the translucent PETG: the
  swaps happen only in the first ~4 layers (it's 1 mm deep, in the back face on the bed).
- **Diffuser:** first layer as thick as the face (0.2 or 0.4), first layer 30 mm/s, monotonic bottom surface, elephant foot 0.
- **Collar** in translucent PETG: 100% infill. Small parts (key, sled): print beside a larger part.

## Finishing the shell
1. Deburr the knob hole, the USB-C opening and the two screw holes underneath. Light-sensor pinhole: it prints ~Ø1.9 with a
   slight sag at the top; twist the 2 mm bit through by hand from the outside, then break the edge with a larger bit turned
   between the fingers.
2. Lap the front flat on 220, then 400, paper taped to glass, in figure-eights. Deburr the edges.
3. Scrape the seam, sand along it with a flexible pad, and feather.
4. Scuff the outside evenly (grey Scotch-Brite or 400 wet), then Danish oil or wax. Mask the bore, the knob hole, the USB-C
   opening, the foot recesses and the two screw holes first. Lay oily rags flat to dry. Once the finish has cured, twist the
   2 mm bit through the sensor pinhole by hand to clear any oil or wax in it.
5. A shell printed before Nov 3 has round screw holes underneath: file each to about 3.4 x 4.2 mm, long along the case's
   depth (the tray needs ±0.4 mm of play front to back there).

## Assembly
The panel goes in first; the encoder after it (its board hangs where the panel slides); the tray last.

1. **Shell:** bumpers into the four recesses underneath; collar into the knob hole (its crush ribs make it a firm push).
2. **Tray, on the bench, front up.** Plug the ribbon into the S3's IDC header and the panel's power leads into its screw
   terminals **while the S3 is loose**: on its posts both face the tray's back wall. Then the S3 onto its posts, 4 x M2.5 x 8.
   Plug a STEMMA QT cable into the S3 (to the sensor, or straight to the encoder). Fold the spare power cable in ~3.5 cm
   lengths and tie it; thread the tie through the tray's tie loop (above the ribbon) if the bundle wanders.
3. **Light sensor (optional), on the bench:** the VEML7700 chip up onto the sled, 2-4 x M2.5 x 5 down from the chip side.
   Plug in the cable from the S3 and the one that will go to the encoder. With the tray still front up, tilt the sled about
   10° (front down), put its two back tabs into the two hooks on the top louver band, swing the front up to the top wall,
   hold it there and drive one M2.5 x 6 from **outside** the tray's top wall (the counterbore beside the light hole).
4. **Panel:** snap the diffuser onto the panel. Shell face down on a towel; panel in from the back until the diffuser's flange
   seats on the rim.
5. **Encoder (flip the shell):** lay the shell top-down across two supports (books, blocks) with the knob hole between them
   and the case's depth level. Check the panel is still fully forward. From inside, drop the encoder into the collar's
   pocket, shaft first, NeoPixel toward the front, its board's edges square to the case's sides (by eye: the tray's rails
   pass either side of the board and allow ~3.5°). Gravity
   holds it while you thread the M7 nut and washer on from outside and snug it. Turn the shell back over **face down or onto
   its side, never onto its back** (the panel could slide out). Push the knob on until it stops on the shaft tip.
6. **Encoder cable:** plug the QT cable from the S3 (or the sensor) into either socket under the encoder's board **now**: the
   socket faces into the tray's space and can't be reached once the tray is in. Let the cable drop straight down from the
   plug, not along the board's edge: the tray's rails slide in just above it.
7. **Tray in:** ribbon to the panel's PI IN (left, seen from the front), clipped into the tray's ribbon hooks; power leads to
   the panel. Slide the tray in and push it fully forward. Its rails pass either side of the encoder's board; if the tray
   stops there, the board is turned: pull the tray back, take the knob off, loosen the M7 nut a turn, square the board,
   snug the nut and put the knob back. Drop the 4 x M3 x 8 flanged button heads down the post tubes (with plain button
   heads, drop an M3 washer down each tube first: it lies flat on the floor) and start all four **loosely**, a few turns
   each, so the tray can settle where the panel's inserts want it; then snug them (2 mm key, short arm: the heads bear on
   two narrow printed strips). Then the
   2 x M3 x 10 from below into the tray: the first time, drive each in slowly, back it out once, then drive it home and stop
   when the head seats (snug, not tight: the head bears on the walnut).
8. **Firmware:** the panel sits turned 180° in this case: `MATRIX_ROTATION 180` in `secrets.h`. Plug in USB-C.

- **Flashing:** hold the Boot key in through the funnel on the back, plug in USB-C, upload, replug.
- **Placement:** on a shelf, keep ~1 cm behind the case: pushed flat against a wall the rim's 4 mm recess seals both louver
  bands. Or bolt the case cleat on: it stands 8 mm off the rim. Keep it out of direct sun (dark walnut PLA softens at
  ~55-60 °C).
- **After a week:** re-snug the encoder's nut once.
- **Service:** unplug USB-C; take out the 2 screws from below and the 4 in the post tubes; ease the tray out (S3 and sensor
  come with it, still cabled; unplug the encoder's cable once you can reach it). To get the panel out, flip the shell, take the
  encoder's nut off and lift the encoder out first.

## Wall mount (optional)
`bar-cleat-case.stl` + `bar-cleat-wall.stl`: a French cleat, both pieces 12 mm deep. The case cleat bolts to the tray's back
between the louver bands with 2 x M3 x 10 from the wall side, threaded into the tray's two bosses (the same bosses take two
M3s threaded in a few turns to pull the tray out). The wall cleat takes 2 x #8 / 4 mm countersunk screws (or anchors); its
face holds the tray's back, so the case hangs plumb, rim 8 mm off the wall, both louver bands open. To hang: lift ~12 mm
above the resting spot, push to the wall, drop onto the bevel.

## Heat-set inserts (later)
Every screw into the tray (the 2 from below and the 2 for the cleat) threads into a plain pilot. With a heat-set iron, print
`bar-drawer-tray-inserts.stl` (+ the same `bar-drawer-tray-window.stl`) instead of the tray: the same tray with Ø4.0 x 6
holes at those four screws. Press M3 x 5.7 inserts with a 4.6 mm OD into them from the side the screw comes in (underneath;
the back face). Nothing else changes.

## Watch for
- **Heat:** typical draw (1-3 W) is fine. Sustained full-white at daytime brightness can push the inside toward ~55 °C in a warm
  room; run the S3's chip-temperature log once, on the brightest screen, where the board will live.
- **Crush ribs:** each tray removal shaves them a little. If the tray ever feels loose, raise `CR_H` in `src/drawer.py`.
- **Light sensor:** it sees about 1.3% of the room's light through the Ø2 pinhole, and the firmware's lux end points are
  guesses: tune `DARK_LUX` / `BRIGHT_LUX` from the serial log ([firmware-s3 README](../../firmware-s3/README.md), "The light
  sensor"). Without the sensor, Auto brightness follows sunrise and sunset.

## Key geometry (P3; case frame: x right seen from the front, y back from the front edge, z up from the bottom)
- Outer 219 x 112.3 x 69 mm; walls 3.5; bore 212 x 105.3, corners R11.5; ZC (panel centre) z 56.15.
- Diffuser face y 12, its flange's back y 13.2 (the tray's front edge); panel back y 28.2, the tray's post feet y 27.9 (0.3 mm
  long on purpose: a short post would pull the panel off the diffuser; a long one leaves the tray edge just off the flange,
  so seated the tray sits 0.3 back and its bottom bosses are 0.3 forward in the model to land on the shell's holes).
  Tray back y 63-65, 4 mm inside the rim.
- Panel turned 180° (input on the left seen from the front); posts at its corner inserts x ±87.25, z ZC +29 / -31: Ø11
  posts, Ø8.6 tubes, a 3 mm flat floor with a Ø4.5 hole (±0.7 mm of float for the screw; the flange is the washer; the
  floor's first two layers are a slot and a square so it bridges cleanly). The
  panel can sit ~0.45 mm off centre in the bore and the PETG tray shrinks ~0.2-0.4 mm at each corner; the old countersunk
  cones had no float at all.
- Screws from below at x ±46, y 59.5 (shell holes ±0.4 long in y); cleat screws at x ±50, z ZC +25.4.
- Knob at x 0, y 41.9; light-sensor pinhole at x +55, y 42. Encoder board 25.4 square at z 103.0-104.6; tray rails at
  x ±13.15..14.75 (0.45 mm off its edges), reaching 0.75 mm down past the board's top face.
- S3 on the right, turned 180°: board edge x 102.85, bottom edge z ZC -24.7; USB-C at z ZC -16.45, y 40.9; status LED at
  (90.7, z 72.5), Boot at (88.3, z 60.0).

Renders: [screws and encoder rails](img/fix-bottom-screws.png), [sensor sled](img/fix-sensor-sled.png),
[back face](img/fix-back-unchanged.png), [test plate](img/test-plate.png), [post floor layers](img/post-floor.png).

## CAD sources (`src/`)
Parametric Python (manifold3d + trimesh); every STL is generated from these.

| Script | Makes |
|---|---|
| `drawer.py` | The v5 shell and tray (+ its window part), the collar, the sensor sled and the test plate; `FASTEN=insert` for heat-set inserts |
| `cleat.py` | The French cleat (case and wall) |
| `check_v5.py` | Fit checks against the model: screws at full float and their engagement, posts, encoder rails (slide-in, turning stop), sensor sled (seat, swing-in), louver area, status window. `BASE=<old tray.stl>` also compares the back face |
| `panel.py` | Panel profiles (`PANEL=p3` default, `PANEL=p25`): outline, inserts, headers. Everything panel-sized derives from it |
| `case.py`, `case2.py`, `plate3.py`, `sensor.py` | Shared geometry and helpers (the v4 shell and plate live on here); `case2.py` also writes the Boot key |
| `collar.py`, `knob.py`, `diffuser.py`, `plinth.py` | Collar shape (v5's is written by `drawer.py`), knob, diffuser two-colour sets, plinth |
| `layerscan.py` | Slices a print-oriented STL in 0.2 mm layers and reports pieces and path length per layer (the banding check) |
| `grille_guide.py`, `check_corners.py` | Archived tools: sensor grille drill guide (older shells with a blind pocket), insert check frame |

```bash
cd hardware/bar-sleeve-case/src
pip install -r ../requirements.txt
python3 drawer.py ../stl/v5-drawer && python3 cleat.py ../stl/v5-drawer
PANEL=p25 python3 drawer.py ../stl/v5-drawer-p25 && PANEL=p25 python3 cleat.py ../stl/v5-drawer-p25
python3 case2.py ../stl          # Boot key (the v4 shells go to ../stl/archive/v4)
python3 knob.py ../stl
python3 diffuser.py ../stl/      # two-colour sets; <file>.stl [face] = one piece
python3 plinth.py ../stl 8
python3 check_v5.py              # PANEL=p25 for the P2.5
```

## Other panels
- **P2.5** (Waveshare RGB-Matrix-P2.5-64x32, 160 x 80): `stl/v5-drawer-p25/`, built with `PANEL=p25`; the same parts, test
  plate and steps. Shell 187 x 96.3 x 69. The tray bolts to three corner inserts (x ±62.5, z ±32.25, confirmed Oct 31; no
  centre one) and takes the same pair of screws from below (x ±46). The light sensor sits at x 40. Print its diffuser on the
  0.2 nozzle with a 0.14 first layer (the 0.14 face stays one layer; on a 0.4 nozzle its single-bead ribs printed wavy). Its
  panel thickness (14.5) is assumed, not measured.
- **P4** (256 x 128): too big for the X2D's bed in one piece; a split design is on the `claude/p4-bar-sleeve-2026-11-02`
  branch (not printed).

## Archive
`stl/archive/v4/`: the v4 build ([ARCHIVE-v4.md](ARCHIVE-v4.md)). `stl/archive/fit-tests/`: fit sets and coupons whose
questions are answered (knob bore, collar ribs r 12.15, drawer fit, corner inserts, the grille drill guide for v5 shells
printed before the pinhole). `hardware/` is in `.dockerignore`, so none of this ships to Fly.
