# CTA LED Board: P4 Bar Sleeve (build sheet, Nov 3, 2026)

The v5 drawer bar sleeve for a **Waveshare RGB-Matrix-P4-64x32** (256 x 128 mm), in parts that fit the X2D's 256 x 256 mm bed: a walnut PLA shell in two halves, a black PETG tray in two halves (the print-tested v5 tray from `drawer.py`, cut at the centre), and a two-colour diffuser in two halves with an 8 mm black bezel. Everything else is the v5 drawer ([README](README.md)), whose fits were settled on test prints (Nov 3). Source: `src/p4.py` (+ the `p4` profile in `src/panel.py`); STLs: `stl/p4/`.

**Case:** 281 x 153 x 73 mm (W x H x D). Screen window ~256 x 128 with ~7.7 mm of black bezel showing. The hood is the P3's scaled to the panel (16 mm at the top, 4 at the bottom, vs 12 / 3), so the front's slant matches the P3 (4.5°). Knob 35 mm and collar 41 mm: the v5 parts 18% bigger, for the proportions.

## Decisions
- **Shell split into top and bottom halves** at 2 mm above centre. Only the two end walls are cut. A 1 x 1 mm reveal wraps each end (outside, front rim, hood side, back rim); the halves meet at its lower edge, so the joint line sits in the groove's shadow. Inside the wall, a half-lap: the inner 1.75 mm of the wall carries on 3.5 mm lower as a lip on the top half, into a pocket in the bottom half, with a 0.12 mm glue gap on its face and ends and 0.2 mm under it (the outer band is the only seat, which keeps the reveal even). The lip's ends are 45° so neither half has a flat overhang. The lap stays 1 mm behind the screen face and 0.5 mm in front of the tray's back, so it never shows.
- **Diffuser in two halves**, split on the grid rib between pixel columns 32 and 33. That rib is 1.2 mm (0.6 a half; the others 0.8). The 8 mm flange is the bezel. First layer: white over the pixels, black over the bezel; the rest black. **Glued into one piece** before it goes on the panel: nothing else holds the centre joint closed (each half is located only by its own outer skirt), and a key across it would either print with an overhang or show in the bezel.
- **Tray split at the centre**, so its seam crosses the shell's. It's `drawer.tray()` with its split options, so it carries every v5 fix: posts with ±0.7 mm of screw float, 0.3 mm long; pilots instead of nuts; encoder rails; the sensor sled; the status window printed in. Each half bolts to its two corner inserts and takes one screw from below. A **bridge** (bottom) screws into the panel's bottom-centre insert through a notch half in each tray half; a **spine** (top) bolts across the seam into the cleat's two bosses. On a wall, the French cleat replaces the spine.
- **S3 on the right tray half, stock ribbon to the panel.** Plugged straight onto the panel's data in, the S3's USB-C edge lands ~1 mm past the bore and its side buttons would leave under 1 mm of wall. It sits low between the right-hand posts (as v5), so its ribbon connector is **27.5 mm below** the panel input: one pair of ribbon hooks on each tray half, the left pair at the panel input's height and the right pair at the connector's, and the ribbon folded twice at 45° between them.
- **Panel turned 180°** (data in on the left seen from the front), as in v5. The top-centre insert isn't used (the spine ties the top of the seam).

## Before printing: measure and test
1. **Insert check:** `check-p4-corner-inserts.stl` (any PLA, 250 x 124, flat). Flip it onto the panel's back: an M3 should drop into all six inserts at once (corners x ±120, z ±56; centres x 0, z ±56, from the drawing). The corners take the tray halves, the bottom centre the bridge. If not, correct `inserts`/`standoffs` in `panel.py` and rebuild.
2. **Insert depth:** seated, the M3 x 8 flanged button heads reach ~5.0 mm into the inserts (5.3 before the posts' 0.3 mm settles). Check one goes in 5.3 mm without bottoming.
3. **Panel thickness**, LED face to the back of the housing: the model assumes 14.5 (12 mm housing per the drawing + 2.5 board). The posts are 0.3 mm long on purpose, so a panel up to 0.3 mm thinner still sits on the diffuser. A thicker one pushes the tray back, and past +0.4 mm the screws from below miss the shell's slotted holes (±0.4). Outside −0.3 / +0.4 mm, set `t` in the `p4` profile and rebuild.
4. **Data-out header** (behind the S3 once the panel is turned): lay a ruler across the housing back over it. It must not stand proud of the housing; the S3's bottom socket passes 1 mm above that plane and 0.65 mm beside it.
5. **Remove the magnetic screws** from all six inserts if fitted (they stand ~2 mm proud; the posts and the bridge bolt there).
6. **Coupons** (the v5 fits are settled; these are the P4's new ones):
   - `coupon-p4-seam-top.stl` + `coupon-p4-seam-bottom.stl` (walnut, back-down as exported): push together; the lip should drop in with a slight gap (filled by the CA) and the outsides meet with an even reveal. If it binds, raise `LAP_CL` in `p4.py`; if it rattles badly, lower it. Glue one and finish it (lap, oil) to see the line.
   - `coupon-p4-drawer-fit-shell.stl` (walnut) + `coupon-p4-drawer-fit-tray.stl` (black PETG): the crush ribs should press in with firm hand force, no wobble (tune `CR_H` / `TRAY_CL` in `drawer.py`).
   - `coupon-p4-diffuser-joint-{left,right}-{white,black}.stl` (two-colour, face down): glue the two at the joint as below and hold them on the panel at the bottom centre. The ribs must sit between the LEDs and the joint fall on the column gap.

## Parts (`stl/p4/`)
| Part | File | Material | Print |
|---|---|---|---|
| Shell top | `p4-shell-top-walnut-backdown.stl` | PLA Wood | back rim down, already turned 45° on the bed (246.3 mm square, 4.8 mm a side, 73 mm tall) |
| Shell bottom | `p4-shell-bottom-walnut-backdown.stl` | PLA Wood | same (247.4 mm square, 4.3 mm a side, 67 mm tall) |
| Tray, left | `p4-tray-left.stl` | black PETG | back face down, walls up |
| Tray, right | `p4-tray-right.stl` + `p4-tray-right-window.stl`: one object, two parts (they share one frame; don't move either on its own); the window is the status light | black PETG + translucent PETG | back face down, walls up |
| Diffuser, left / right | `p4-diffuser-left-white.stl` + `p4-diffuser-left-black.stl`; same for right: one object, two parts per half (shared frame) | white + black PETG | face down; the white part is the first layer |
| Spine | `p4-spine.stl` | black PETG | flat, as exported (countersinks on the bed) |
| Bridge | `p4-bridge.stl` | black PETG | plate down, post up |
| Encoder collar | `p4-encoder-collar.stl` (41 mm flange; the v5 collar's crush-ribbed plug and Ø19.6 pocket) | walnut, or translucent PETG for the knob's glow | flange-top down |
| Knob | `p4-knob.stl` (35 mm; the v5 pebble's bore fit) | white PLA, or any | skirt down, as exported |
| Boot key | `p4-boot-key.stl` | PETG or PLA | flat |
| Light-sensor sled (optional) | `p4-sensor-sled.stl` | PETG | plate down |
| Wall cleat (optional) | `p4-cleat-case.stl` + `p4-cleat-wall.stl` | PETG | wall face down |
| Checks | `check-p4-corner-inserts.stl`, `coupon-p4-*.stl` | as above | as exported |

Filament, roughly (the slicer has the real numbers): walnut ~230 g (the shell's walls print solid), black PETG ~290 g (+~60 g for the wall cleat), white PETG ~10 g plus the swap purge, white PLA ~15 g (knob), translucent PETG ~5 g (collar, window).

## Print settings
- **Shell halves:** Bambu PLA Wood profile, filament dried (~8 h at 50-55 °C) and flow-calibrated. 0.2 mm base layers with variable layer height (smooths the hood ramp and rim slopes; the two halves slice a little differently, so their faint bands won't line up exactly across the joint, which the reveal breaks anyway), 4 walls on a 0.4 nozzle, elephant foot 0.15. **Brim 3 mm with a 0.1 mm gap, or brim ears, not 5 mm:** the halves sit diagonally with ~4.5 mm a side, and the bottom half's first layer leaves room for a brim of at most ~4.6 mm. Keep the 45° turn they come with (don't let auto-arrange rotate them back). Seam on a back corner (Preview), scarf seam. Z hop 0.6 mm. Plate washed with dish soap, then glue stick; bed 55-60 °C; door closed. The bed's corners have to print well: if unsure, print the seam coupon at a bed corner first.
- **Tray halves:** PETG, 0.4 nozzle, 0.24 mm layers, 4 walls, 4 top + 4 bottom layers, 15% gyroid, monotonic bottom surface, textured PEI, elephant foot 0.15, Z hop, dried PETG (the v5 tray's settings). The right half's window part takes the translucent PETG: the swaps happen only in its first ~4 layers.
- **Diffuser halves:** 0.4 nozzle, first layer 0.2 (the face, one layer, two colours: white face, black bezel), 0.2 layers after it all black, first layer 30 mm/s, monotonic bottom surface, elephant foot 0.
- **Spine, bridge:** PETG on the tray plate at its 0.24 mm layers (the bridge's floor is cut for them); 100% infill on the spine. **Collar** in translucent PETG: 100% infill. Small parts (key, sled): print beside a larger part.

## Hardware
- **Screws:**
  - 5 x M3 x 8 **flanged** button head (ISO 7380-2, flange ~Ø6.9): the 4 corner posts and the bridge. Not in the Hantof kit: buy a small pack, or use plain M3 x 8 button heads over M3 washers.
  - 2 x M3 x 10 **countersunk** (spine, into the cleat bosses' pilots). Not in the Hantof kit either.
  - 2 x M3 x 10 button head (from below, threaded into the tray's pilots).
  - 4 x M2.5 x 8 (S3 onto its posts, self-tapping).
  - Light sensor (optional): 2-4 x M2.5 x 5 (sensor onto the sled), 1 x M2.5 x 6 button head (sled, from outside the tray; a socket cap would stand proud and jam the tray).
  - The encoder's M7 nut and washer.
- **Wall hanging instead of the spine:** 2 x M3 x 10 (case cleat into the same pilots) + 2 x #8 / 4 mm countersunk wood screws or anchors.
- **Electronics:** Waveshare P4 panel (its power cable and 30 cm 16-pin ribbon are used); Matrix Portal S3 (5778); I2C QT rotary encoder (5880); optional VEML7700 (4162, flat).
- **Cables:**
  - Ribbon: the panel's 30 cm one. The P4 needs ~22 cm seated (the 27.5 mm drop adds to the P3's route) plus 1-2 cm while the right half rests on the case's back in step 7 (on the bench beside the case it would need ~30-33 cm and a twist); the P3's 15 cm minimum doesn't apply. Measure yours: at least 25 cm between the plug faces, or use a 40 cm 16-pin HUB75 ribbon.
  - STEMMA QT: S3 → sensor **20 cm** (the S3 sits low, ~100-130 mm from the sensor) and sensor → encoder 15 cm (it spans ~9 cm in step 7's pose, ~3 cm seated); or one **30 cm** S3 → encoder without the sensor.
  - A data-capable USB-C cable and a 5 V / 3 A USB-C supply.
- **Other:** 4 round black bumpers 12.7 x 3.8 mm (3M SJ5312 size); 1-2 hook-and-loop ties ~12 mm wide (power cable bundle, through the tie loop); medium CA glue (shell lap, diffuser joint).
- **Tools:** hex keys 1.5 mm (M2.5) and 2 mm (M3; its long arm has to reach ~34 mm down the post tubes and ~37 mm down the bridge's); pliers or a small wrench for the M7 nut; a 2 mm (or 5/64") drill bit, turned by hand; a flat sheet (glass or stone tile) for the glue-ups.
- **Power:** the firmware doesn't cap the current. Full white across the P4 (e.g. a calibration screen) can exceed a 3 A supply; the transit screens draw well under 1 A.

## Gluing and finishing the shell
1. **Dry-fit** the halves back-down on the flat sheet. The back rims are one plane, so the halves can't step front to back; the lap keys them in and out. Check the reveal is even on both ends.
2. **Glue:** medium CA on the lap's faces only (the lip's outer face and the pocket wall it faces), kept 2 mm back from the outer edge so nothing squeezes into the reveal. Press together on the sheet, tape across both ends, weight the top, let it cure.
3. **Deburr** the knob hole, the USB-C opening and the two screw holes underneath. Light-sensor pinhole: it prints ~Ø1.9 with a slight sag at the top; twist the 2 mm bit through by hand from the outside, then break the edge with a larger bit turned between the fingers.
4. **Lap the front flat** on 220, then 400, paper taped to glass, in figure-eights, across the joint so both halves end flush. Clean the reveal with a folded strip of paper. Scrape the print seam, sand along it with a flexible pad, and feather.
5. **Finish:** scuff the outside evenly (grey Scotch-Brite or 400 wet), then Danish oil or wax. Mask the bore, the knob hole, the USB-C opening, the foot recesses and the two screw holes first. Oil goes on after gluing: CA won't take the oil, so keep it off the outside. Lay oily rags flat to dry. Once the finish has cured, twist the 2 mm bit through the sensor pinhole by hand to clear it.

## Assembly
The panel goes in first; the encoder after it (its board hangs where the panel's bezel passes); the left tray half, then the right one; the bridge and spine last.

1. **Shell:** bumpers into the four recesses underneath; press the collar into the knob hole (its crush ribs make it a firm push).
2. **Diffuser:** lay both halves face down on the flat sheet, push their straight edges together at the centre, and hold a straightedge along the top and bottom skirts so the halves line up. Run a thin bead of medium CA along the back half of the centre rib (keep it off the face). Let it cure, then snap the diffuser onto the panel (skirts over the panel's edges).
3. **Panel cables, on the bench:** the ribbon into the panel's data in (red stripe = pin 1) and the power lead into its power header.
4. **Panel in:** shell face down on a towel. Panel turned 180° (data in on the left seen from the front), in from the back until the bezel seats on the rim. Lead the ribbon and the power lead out of the back toward the USB-C end, clear of the bore's walls, so the left tray half can't trap them.
5. **Encoder (flip the shell):** lay the shell top-down across two supports with the knob hole between them and the case's depth level; check the panel is still fully forward. From inside, drop the encoder into the collar's pocket, shaft first, NeoPixel toward the front, its board's edges square to the case's sides. Gravity holds it while you thread the M7 nut and washer on from outside and snug it. Turn the shell back over **face down or onto its side, never onto its back** (the panel could slide out). Push the knob on until it stops on the shaft tip.
6. **Left tray half:** slide it in from the back and push it fully forward. Drop 2 x M3 x 8 flanged button heads down its post tubes (with plain button heads, an M3 washer down each tube first) and start them **loosely**, a few turns. Its rail passes the encoder board's left edge; if the half stops there, the board is turned: square it as in step 9. Reach in on the USB-C side and press the ribbon into the left half's hooks: it runs along the back wall at the panel input's height, its free end toward the USB-C end.
7. **Right tray half, front up, resting on the case's back over the left half** (shell still face down; the half turned end for end, its open seam edge along the case's centre, so the cables run straight up out of the open right side into it):
   - Light sensor (optional): the VEML7700 chip up onto the sled, 2-4 x M2.5 x 5 down from the chip side. Plug in a 20 cm QT cable (from the S3) and the one that will go to the encoder. Tilt the sled about 10° (front down), put its two back tabs into the two hooks on the top louver band, swing the front up to the top wall and drive one M2.5 x 6 from **outside** the tray's top wall (the counterbore beside the light hole).
   - Plug the ribbon into the S3's IDC header and the power leads into its screw terminals **while the S3 is loose**: on its posts both face the tray's back wall. Then the S3 onto its posts, 4 x M2.5 x 8 from its panel side. Take the power lead off the S3's left edge, not across its front. QT: S3 → sensor (20 cm), or a 30 cm S3 → encoder without the sensor.
   - Fold the spare power cable in ~3.5 cm lengths and tie it through the tie loop.
   - Ribbon: between the two hook pairs it drops 27.5 mm. Fold it twice at 45° (crease lightly) where it leaves the left half's hooks, and clip it into the right half's hooks; fold any slack flat (a Z, creased lightly) on the right half's back wall between the seam and its hooks, keeping just enough to reach: a standing loop of 6-8 cm would reach the panel's back. Keep the ribbon flat where it crosses the seam line.
8. **Encoder cable:** plug the QT cable's free end (from the sensor, or the S3) into the encoder's socket on the USB-C side (right-hand seen from the front, on your left looking in from the back), under its board, reaching in through the USB-C side **now**: it can't be reached once the right half is in. Let the cable drop straight down from the plug, not along the board's edge: the rails slide in just above it.
9. **Right tray half in:** every cable inside the tray's walls (none over its top, bottom or end walls: the crush ribs would trap them). Slide it in and push it fully forward. Its rail passes the board's right edge (the left half's is already beside its left edge); if it stops there, the board is turned: pull the half back, take the knob off, loosen the M7 nut a turn, square the board, snug the nut and put the knob back. 2 x M3 x 8 flanged button heads down its post tubes, started loosely.
10. **Bridge:** its post in through the notch at the bottom centre; 1 x M3 x 8 flanged button head, started loosely.
11. **Spine** across the top: push the two halves together at the seam, then 2 x M3 x 10 countersunk into the cleat bosses' pilots (countersunk heads have no float: the spine sets the halves' spacing while the post screws are loose). On a wall, the case cleat instead ([Wall mount](README.md#wall-mount-optional)). Now snug all five post screws (2 mm key, short arm: the heads bear on narrow printed floors).
12. **From below:** 2 x M3 x 10 button heads into the tray's pilots. The first time, drive each in slowly, back it out once, then drive it home and stop when the head seats (snug, not tight: the head bears on the walnut).
13. **Firmware:** the panel sits turned 180°: `MATRIX_ROTATION 180` in `secrets.h` (setup build). The browser setup and `scripts/setup-board.js` write `rotation: 0` with no option to change it, so a board set up with them shows upside down in this case (as in the v5 P3). Plug in USB-C.

- **Flashing:** hold the Boot key in through the funnel on the back, plug in USB-C, upload, replug.
- **Placement:** on a shelf, keep ~1 cm behind the case: pushed flat against a wall the rim's 4 mm recess seals both louver bands. Or hang it on the cleat (8 mm off the wall). Keep it out of direct sun (dark walnut PLA softens at ~55-60 °C).
- **After a week:** re-snug the encoder's nut once.
- **Service:** unplug USB-C; the 2 screws from below; the spine (or lift it off the wall cleat); the bridge; the right half's 2 post screws, then ease it out and rest it front up on the case's back as in step 7 (S3 and sensor come with it, still cabled; unplug the encoder's cable once you can reach it; to unplug the S3, take it off its posts first); the left half's 2 screws; unclip the ribbon from its hooks (reach in on the USB-C side), then ease it out. To get the panel out, flip the shell top-down, take the knob and the encoder's nut off and lift the encoder out first.

## Watch for
- **Heat:** typical draw (1-3 W) is fine. Sustained full white at daytime brightness can push the inside toward ~55 °C in a warm room; run the S3's chip-temperature log once, on the brightest screen, where the board will live.
- **Crush ribs:** each tray removal shaves them a little. If a half ever feels loose, raise `CR_H` in `src/drawer.py`.
- **Light sensor:** it sees the room through the Ø2 pinhole, and the firmware's lux end points are guesses: tune them from the serial log ([firmware-s3 README](../../firmware-s3/README.md)).

## Open
Facts not measured yet (each changes the model or the sheet):
- **Panel thickness:** 14.5 mm assumed (see "Before printing").
- **Insert positions and depth:** the check frame and the depth test cover them. Also whether all six insert boss faces sit level with the housing back (the bridge assumes it), and which inserts carry magnets.
- **Header positions and heights:** from a photo, ±1 mm. They set the hook heights, the ribbon's route and the data-out clearance.
- **Panel outline:** 256 x 128 assumed; the diffuser's skirts have 0.15 mm of clearance.
- **Ribbon length:** 30 cm assumed.
- **The S3's STEMMA QT socket:** its position and direction on the USB edge. They set the QT lengths, and whether it has to be plugged before the S3 goes on its posts.
- **The P4's power cable:** whether its ends fit the S3's terminals, its length, and how far the power plug stands off the housing.
- **The P4's peak current**, against a 3 A supply.
- **The diffuser's centre joint:** how it looks with the panel off depends on the white face, and how well CA holds this PETG; glue and flex the joint coupon before the full print.
- **PETG shrink:** how much the tray halves shrink sets the seam and the spine's fit. The fit coupon shows it.
