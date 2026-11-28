# CTA LED Board: Bar Sleeve Case (v5 drawer)

Walnut wood PLA sleeve with a slanted shade hood; a black PETG tray slides in from the back and carries the Matrix Portal S3,
bolted to the panel's four corner inserts. Built for the Waveshare P3 64x32 (this sheet); the P2.5 is under
[Other panels](#other-panels). Why things are the way they are: [DESIGN-HISTORY.md](DESIGN-HISTORY.md). The v4 build (flat
back plate) is archived in [ARCHIVE-v4.md](ARCHIVE-v4.md).

## Fixed decisions
- Slanted hood (12 mm lip at the top, 3 mm at the bottom; the P4 scales it to 16 / 4): non-negotiable.
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
| Shell | `bar-shell-v5-walnut-backdown.stl` | PLA Wood | as exported (back rim down) |
| Tray | `bar-drawer-tray.stl` + `bar-drawer-tray-window.stl`: one object, two parts (they share one frame; don't move either on its own); the window is the status light | black PETG + translucent PETG | as exported (back face down, walls up) |
| Diffuser | `stl/bar-diffuser-white-face.stl` + `stl/bar-diffuser-white-grid-black.stl` (0.2 face, 0.4 nozzle), or `stl/bar-diffuser-translucent-face.stl` + `stl/bar-diffuser-translucent-grid-black.stl` (0.4 face, 0.6 nozzle): one object, two parts | face white or translucent, the rest black | face down; the face part is the first layer |
| Encoder collar | `bar-encoder-collar-v5.stl` | walnut, or translucent PETG for the knob's glow | flange-top down |
| Knob | `stl/bar-knob.stl` | white PLA, or any | as exported |
| Boot key | `stl/bar-boot-key.stl` | PETG or PLA | flat |
| Light-sensor sled (optional) | `bar-sensor-sled.stl` | PETG | plate down |
| Wall cleat (optional) | `bar-cleat-case.stl` + `bar-cleat-wall.stl` | PETG | wall face down |
| Tilt plinth (optional) | `stl/bar-plinth-walnut-8deg.stl` (V5; the V6s': `stl/plinth/`, see V6 desk plinth below) | PLA Wood | flat |

## Test plates (done, Nov 3)
Every new fit was checked on small test prints before the tray: three rounds, now in `stl/archive/fit-tests/` (`test-plate-v5`
+ `-window`, `test-plate-v5c`; round 2's pieces are folded into those). Settled: the status window (printed in, clean), the
encoder rails (0.45 mm a side), the sensor sled and hooks, the post floor (sequential bridging, clean), the bottom pilots
Ø3.0 and the cleat pilots Ø3.1 (3.0 too tight to drive, 3.2 too loose). The test plate is regenerated with the tray
(`drawer.py`), so after a filament or setting change it can be printed again to recheck.

## Underside markings (in progress, not on the shells yet)
Two label recesses on the shell's underside, one layout for P3 and P2.5 (`src/marks.py`; previews
`img/underside-marks-p3-labels.png`, `-p25-labels.png`):
- Regulatory label, 1 x 2 5/8 in: product and model, "Contains FCC ID: ...", the Part 15 statement. The same on every board,
  so it's ordered printed (polyester, permanent adhesive: a permanently affixed nameplate per 47 CFR 2.925(d)).
- Setup sticker, 1/2 x 1 3/4 in: the board's setup-network QR code, name and password, printed per board.

The recesses (0.5 deep, 0.4 mm a side past the label, front edge chamfered 45° so it doesn't bridge) give the labels a smooth
floor on the wood and keep their edges out of reach. Debossed lettering (model and FCC ID) is optional and off: `MARK_TEXT=1`.

Test print, in the shell's filament, as exported (standing on the L-foot; seam at the back): `stl/coupon-marks-wall.stl`, the
underside wall with the real layout. Stick real labels in; check the fit and the recesses' front edges. For the lettering,
if it's ever wanted: `stl/coupon-marks-ladder.stl` (`img/marks-ladder.png`): lines 1-3 DejaVu at caps 3.35 / 3.75 / 4.6 mm;
4-7 all caps at 3.75 in DejaVu, Atkinson Hyperlegible, B612, OCR-B (`fonts/`); pick with `MARK_FONT` / `MARK_CAPS`.

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
  power leads; STEMMA QT: S3 → sensor 15 cm (its route up from the S3's bottom edge is 10-11 cm, so a 10 cm only just
  reaches) and sensor → encoder 15-20 cm, or one 20-30 cm S3 → encoder without the sensor; a data-capable USB-C cable and a
  5 V / 3 A USB-C supply.
- **Other:** 4 round black bumpers 12.7 x 3.8 mm (3M SJ5312 size; +4 for the plinth); 1-2 hook-and-loop ties ~12 mm wide.
- **Tools:** hex keys 1.5 mm (M2.5) and 2 mm (M3; its long arm reaches the ~34 mm down the post tubes); pliers or a small
  wrench for the M7 nut; a 2 mm (or 5/64") drill bit, turned by hand.

## Print settings
- **Shell:** Bambu PLA Wood profile, filament dried (~8 h at 50-55 °C) and flow-calibrated. 0.2 mm base layers with variable
  layer height (smooths the hood ramp and rim slopes), 4 walls on a 0.4 nozzle, elephant foot 0.15. Seam: rotate Z 225° (or
  135°) so the bottom-right corner faces the back, Seam position "Back", scarf seam; check in Preview. Outer brim 5 mm with
  a 0.1 mm gap; Z hop 0.6 mm. Plate washed with dish soap, then glue stick; bed 55-60 °C; door closed.
- **Tray** (the test plates were printed with these; keep them if the tray prints well): PETG, 0.4 nozzle, 0.24 mm layers, 4 walls, 4 top + 4 bottom layers, 15% gyroid, monotonic
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
6. Shells and trays from before Nov 4 go together, not with the new ones: the S3 sat 3.1 mm lower (its STEMMA QT plug
   pressed on the lower-right post), and the shell's USB-C and button openings moved up with it.

## Assembly
The panel goes in first; the encoder after it (its board hangs where the panel slides); the tray last.

1. **Shell:** bumpers into the four recesses underneath; collar into the knob hole (its crush ribs make it a firm push).
2. **Tray, on the bench, front up.** Plug the ribbon into the S3's IDC header, a STEMMA QT cable into its QT socket (to the
   sensor, or straight to the encoder) and the panel's power leads into its screw terminals **while the S3 is loose**: on its
   posts all three face the tray's back wall, and the QT socket (on the board's bottom edge, near the USB-C end) sits 2 mm
   over the lower-right post. Bend the QT cable straight back off the plug. Then the S3 onto its posts, 4 x M2.5 x 8.
   Fold the spare power cable in ~3.5 cm lengths and tie it; thread the tie through the tray's tie loop (above the ribbon) if the bundle wanders.
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
8. **Firmware:** the panel sits turned 180° in this case: set it up with **Upside down** (the control page's Set up a board,
   or `scripts/setup-board.js --rotate 180`), or `MATRIX_ROTATION 180` in `secrets.h` for a setup build. Plug in USB-C.

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
| `marks.py` | Underside markings: label recesses, and optional debossed lettering sized to the nozzle (`MARK_TEXT=1`, `MARK_FONT`, `MARK_CAPS`, `MARK_MODEL`); `preview`, `check` (every panel), `coupon` |
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
- **128 x 32 from two P2.5 panels** (347 x 96.3 x 69): [P25-128-BUILD.md](P25-128-BUILD.md), `src/bar128.py`,
  `stl/p25-128x32/`. Shell split left/right at the panel joint (both halves on one plate), a diffuser and a tray per panel,
  splice plates across the joint. Test pieces first; not printed yet.
- **128 x 32 from two P3 panels** (414 x 115.3 x 69, 5 mm wall): [P3-128-BUILD.md](P3-128-BUILD.md), `src/p3x2.py`,
  `stl/p3-128x32/`. Shell split left/right at the panel joint and glued together over two flat PLA joint plates in
  rebates inside the top and bottom walls (the Nov 6 loose tenons didn't hold the finished bar against a twist); a tray
  and a diffuser per panel (each diffuser half with its own wall at the seam), splice plates across the joint with hex
  standoffs the inner tray posts bolt to, one long wall cleat. `stl/p25x2-128x32/` is the same set round two P2.5
  panels (`WIDE=p25x2`), superseding the tongue-and-groove bar below; that pair was printed once (Nov 7) with the earlier
  joint.
- **P4** (256 x 128): the case (281 mm) and diffuser exceed the X2D's 256 mm bed, so it's built in split parts (shell top/bottom, tray and diffuser left/right): [P4-BUILD.md](P4-BUILD.md), `src/p4.py`, `stl/p4/`.
- **P5** (320 x 160; first pass, nothing printed, panel not in hand): the P4's parts with the shell split left/right (347 x 187 x 78.5, 4.5 mm wall, 3 mm diffuser grid, glued plates in the top and bottom walls) and the knob on the right end wall: [P5-BUILD.md](P5-BUILD.md), `src/p5.py`, `stl/p5/`.
- **V6 (first built Nov 21-24; the Nov 25 rework not printed yet: flush countersunk skin screws into inserts, screw lands and pads, a frame and a stop at the USB-C port, slimmer S3 post tips):** the P4 case rebuilt as a rigid PETG chassis with the walnut screwed on from outside in two halves, a drawn line between them: `src/v6.py`, renders `img/v6-*.png`, reasons in [DESIGN-HISTORY.md](DESIGN-HISTORY.md) (Nov 15). Print set: `stl/p4-v6/` (`python3 v6.py ../stl/p4-v6`), every part named `p4-v6-<part>[-side]-<colour>`.
- **P3 V6 (draft 1, Nov 26; not printed):** the P4 V6's chassis on the P3, keeping the one-piece walnut sleeve: it slides on over the chassis, a hidden rebate and a lip round the back plate make its back edge rest on PETG and set its depth, two black flat heads from below. The knob is V5's (30 mm, on V5's collar in translucent PETG, 100% infill, so the encoder's NeoPixel lights it; at V5 double-wide's right-hand spot) and goes together in V5's order: panel into the sleeve, then the encoder up into its collar, then the chassis; ledges on the chassis's encoder rails, 0.2 under the board, take knob presses. `src/v6p3.py`, renders `img/p3-v6-*.png`, print set `stl/p3-v6/` (`python3 v6p3.py ../stl/p3-v6`). Nov 27: two label recesses underneath (marks.py); cleats to the P4 V6's design (60 deg bevel, a stop outside each end of the case cleat, pockets; the wall cleat 171 long with three screws; self-drilling or molly anchors in drywall) with a channel for the USB-C cable in the wall cleat's wall face (right-angle plug; lay the cable in before the cleat goes on the wall). V5's cleats do not fit these.
- **128 P3 V6 (draft 8, Nov 27; not printed):** two P3 V6s joined at the panel seam. Two walnut halves (4 mm wall, 412 x 113.3 x 69) butted with a 0.5 x 45 deg V each side and made one sleeve by two PLA seam keys epoxied across the seam inside the top and bottom walls (slow two-part epoxy, glued up on the joined chassis; the seam faces stay dry). One round countersink from below locates the sleeve (half B's inner one); the other three are slots. The two label recesses (marks.py) are one per half, flanking the seam 12 mm either side on one row centred front to back: the regulatory label under half B, the setup sticker under half A; they lie over the bottom seam key, with 2.2 mm of walnut left between. The bumpers are at x +/-127 (the V5 pair's: +/-180), so the one-piece desk plinth reaches all four. Two chassis halves (B: the single P3 V6's, with the S3 and controls; A: plain), joined as the P4 V6's are: A's solid tongues inside B's walls (four screws) and two knuckles on the back plates (blocks on A under bridges in B, one screw each from the back, flush); every screw a black M3 x 10 flat head into an insert. Cleats to the P4 V6's design: a 60 deg bevel (17 mm of lift to unhook), pockets in the wall cleat, and a stop between the two case cleats' inner ends so the bar cannot slide along it. The wall cleat is 300 mm long (its STL lies at 45 deg: it prints on the bed's diagonal), with wall screws at +/-135 and the centre; use self-drilling or molly anchors in drywall. The USB-C cable (right-angle plug) runs behind the bar and along a channel in the wall cleat's wall face, down through one of four slots in its floor: lay it in before the cleat goes on the wall. The V5 pair's cleats do not fit these. Split diffuser halves with a full grid wall on each side of the seam: print them from this set (the V5 pair's meet the 45 deg rim). Seam coupon in `stl/p3x2-v6/coupons/`. `src/v6p3x2.py` (its docstring has the glue-up), renders `img/p3x2-v6-*.png`, print set `stl/p3x2-v6/` (`python3 v6p3x2.py ../stl/p3x2-v6`).
- **V6 desk plinth (draft 5, Nov 27; not printed):** optional, black. On a desk the 12 mm hood hides the top LED row from a sightline about 21 deg below level; the plinth tilts the case back 12 deg (clear to about 33). The case keeps its bumpers: they drop into four sockets on short bosses, so it rides on its own rubber 1.0 above the bosses with a 3.0 reveal over the deck. A lip behind the sleeve's back edge (6 mm up, below the louvers) catches the case if it is pushed over backwards, and slopes to the desk 15 mm behind it, over the plinth's rear bumpers; raked front, toe-kick, chamfers; four SJ5312 recesses underneath. One for the P3 V6 (189 x 73 x 16.5) and one for the 128 P3 V6 (274 x 73 x 16.5, one piece under the middle, on the bed's diagonal). **Measure a fitted bumper first** (`FOOT_OD`, `FOOT_H`: 12.7 x 3.6 assumed; the socket depth follows) and print one socket corner before the whole part. The lip, the 128's plinth and the stability figures have only the model's checks behind them (an independent review of the lip-less draft found it tipped at under 1 N at the top). `src/plinth_v6.py` (`python3 plinth_v6.py ../stl/plinth`, then `PLINTH=p3x2 python3 plinth_v6.py ../stl/plinth 12 ../stl/p3x2-v6/frames`), `stl/plinth/`, renders `img/p3-v6-6-plinth.png`, `img/p3x2-v6-9-plinth.png` (not made by a script in the repo).

## Archive
`stl/archive/v4/`: the v4 build ([ARCHIVE-v4.md](ARCHIVE-v4.md)). `stl/archive/fit-tests/`: fit sets and coupons whose
questions are answered (knob bore, collar ribs r 12.15, drawer fit, corner inserts, the grille drill guide for v5 shells
printed before the pinhole). `hardware/` is in `.dockerignore`, so none of this ships to Fly.
