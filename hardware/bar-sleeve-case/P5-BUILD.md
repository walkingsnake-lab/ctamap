# CTA LED Board: P5 Bar Sleeve (first pass, Nov 14, 2026; shell built out the same evening)

**Status: a first model. Nothing is printed and the panel is not in hand.** The panel's inserts, headers and outline are scaled from Waveshare's product photos and outline drawing (`src/panel.py`, `'p5'`); every part that touches the panel (trays, bridge, diffuser) waits for the measurements under [Before printing](#before-printing-measure-and-test). **The shell is complete and doesn't wait on the panel:** its depth is set by the 3 mm grid (decided), and nothing else in it depends on the panel. It can be printed now, starting with its coupons: [Shell: print, glue, finish](#shell-print-glue-finish).

The P4's drawer case ([P4-BUILD.md](P4-BUILD.md)) round a **Waveshare RGB-Matrix-P5-64x32** (SKU 25848, 320 x 160 mm, SMD2121, 1/16 scan), in parts that fit the X2D's 256 x 256 mm bed. Source: `src/p5.py`, which builds on `src/p4.py` with the `p5` profile; STLs: `stl/p5/`; fit checks: `src/check_p5.py`; renders from the model: `img/p5-front.png`, `img/p5-end-wall.png`, `img/p5-exploded.png`, `img/p5-tray-end.png`, `img/p5-knob-section.png`.

**Case:** 346.8 x 186.8 x 78.5 mm (W x H x D), **4.5 mm wall**. The hood is the P3's scaled to the panel (20 mm at the top, 5 at the bottom), so the front's slant matches (4.6°). The P4's 8 mm bezel all round. **Diffuser grid 3.0 mm deep** (every other build: 1.5), so the case is 1.5 mm deeper than the P4's recipe gives.

## Decisions (Nov 13-14)
- **Diffuser grid 3.0 mm deep (Nov 14).** On the P3 the 2.1 mm LED nearly fills its 2.4 mm cell; on the P5 the cell is 4.2 mm open, so about 1 mm round each LED is lit only by spread, and a deeper grid gives the light room to fill it. 3.0 is the P3's 1.5 scaled by the pitch (2.5) rounded up: a starting point, checked on the lit joint coupon, not a measured result. It costs some brightness (more light lands on the black ribs) and 1.5 mm of case depth. Grid depth is now a panel setting (`grid_h` in `panel.py`); the case depth (`case.D`) and the stack in front of the panel (`case.STACK`) follow it, so everything behind the panel keeps its room. Every other build stays at 1.5 and is unchanged.
- **Shell split left / right at the centre**, not top / bottom as the P4. A 347 x 93 mm half would need a ~310 mm bed even turned 45°; the P4's 282 x 77 halves needed 247. Each left / right half is 173 x 187 x 78.5 flat on its own plate, back-down, with 35 mm to spare a side and no 45° turn. Two halves don't fit one plate (346 mm side by side).
  - The joint is the two-panel bars' ([P3-128-BUILD.md](P3-128-BUILD.md), "Joint"): a 0.5 mm x 45° V-groove outside (across the top, the hood, the front rim and the bottom), end faces hollowed 0.3 except a 2 mm land, and a **glued PLA plate (100 x 50.5 x 1.2) in a rebate inside the top wall and one inside the bottom wall**, half in each shell half. 3.2 mm of wall is left behind each rebate. **This joint has not been printed at full size on any build**: `coupon-p5-seam-*` is the first print to make.
  - A four-piece frame (top and bottom rails, two end caps, seams at the corners) was considered and dropped: four joints of the same unproven kind, and rails standing 78.5 mm tall on a 4.5 mm edge.
- **Tray split at the centre too**, as the P4's. On the first P2.5 pair two stiff boxes hung on a loose splice between two panels; here one rigid panel bolts to both tray halves and the spine (or the case cleat) and the bridge tie them, so the tray braces the shell's joint although both seams are at x = 0. An off-centre tray seam was considered and dropped: it would have cost the bridge and the spine for no gain.
- **Seam screws: provided for, not cut.** The top wall's two free ends at the seam are held only by the glued plate. Each tray half has a boss under its top wall 15 mm from the seam (blind Ø3.0 pilot, as the screws from below), the top plate has the two holes, and the rebate's floor has a drill mark at each. The shell prints **without** the holes. If the seam coupon's glued joint does not hold, drill 3.4 mm at the marks before the glue-up and fit 2 x M3 x 10 button heads from above (`SEAM_SCREWS=1` cuts the holes instead). They show on top; on a wall, only from above.
- **Knob on the right end wall, upper part**: its axis 40 mm below the case top and 51.7 mm behind the top front edge (the encoder's board stands behind the panel, as under the top wall). The collar's flange stays on the flat of the wall, 3.4 mm below the corner's round. Chosen over the top wall's right end because it can be reached and its light seen wherever the board hangs; from below, a knob on top disappears behind the case.
  - **The P4's knob (35 mm), the same file: print `stl/p4/p4-knob.stl`.** A 42 mm knob with a 49 mm collar was rendered and dropped: the face the knob sits on is the case's depth (78.5 mm) on either wall, and the larger collar left 3 mm to the back edge.
  - **Collar: `p5-encoder-collar.stl`**, the P4's 41 mm flange with a plug for the 4.5 mm wall and no screw holes (the P4's two top screws are gone with its top knob).
  - On the tray's right end wall: a slot open to the front edge past the encoder's body, a 0.6 mm recess over the board along its whole way in (1.9 mm of wall left), and two rails beside the board's upper and lower edges, which stop it turning if its nut loosens. These are the top wall's (`drawer.enc_rails`), turned 90°. Fit in the model: the board 0.45 mm inside the wall's face (1.05 to the recess floor), the rails 0.45 from its edges.
  - A press pushes the case along the wall, so the wall cleat has a stop either side of the case cleat.
- **S3 and USB-C on the same end wall, lower**: the USB-C opening is 57 mm above the case's bottom, 89 mm below the knob's axis. That height keeps the ribbon's drop from the panel input to the S3's connector at 21 mm, the P4's.
- **Light sensor** stays under the top wall at x +55, with its pinhole in the top.
- **Screws from below at x ±62** (the P4's ±46): outside the bottom joint plate, and clear of the tray's crush ribs (±47).
- **Label recesses stay on the underside** (decided Nov 14), on the right half (x 22 to 138). The tray's back was considered: it has room, but it prints on the bed, so a recess there would be a 25 mm bridge and the labels would sit flat on textured PETG. On a wall it faces the wall, so the setup QR (needed when the WiFi changes) means lifting the board off its cleat, and it fits the Part 15 statement's "conspicuous location on the device" (47 CFR 15.19(a)) less well. Where an owner hangs the board can't be known, and the underside works for any height. Their first 28 mm lie over the bottom plate's rebate: 2.7 mm of walnut between them there, backed by the glued plate. `LABELS=0` builds the shell without them.
- **Wall cleat 240 mm**, three wall screws (centre, ±105). The case cleat is the single build's (150 mm) and ties the tray seam on a wall as the spine does on a shelf. The foot recesses are kept, so it can also stand; no plinth is planned at this size.
- **Diffuser: the P4's at a 3 mm grid**, two halves split on the rib between columns 32 and 33, the same part printed twice the same way round, 0.8 mm ribs, 0.4 mm a half at the joint, snap fit with the bars as the fallback. The skirts reach 6.2 mm behind the face (P4: 4.7). Still open: the ribs' width on a 5 mm cell.

## Before printing: measure and test
With the panel in hand, in this order:
1. **Insert check:** `check-p5-corner-inserts.stl` (any PLA, 162.5 x 152, flat). It covers one end's corner pair and the centre pair (a frame over all six, 305 x 142, does not fit the bed). Lay it on the panel's back: an M3 should drop into all four inserts at once; then turn it half a turn and try the other end. Model: corners x ±152.5, z ±71; centres x 0, z ±71 (photos, ±1 mm). If not, correct `inserts` / `standoffs` in `panel.py` and rebuild.
2. **Panel thickness**, LED face to the back of the housing: 14.8 from the drawing; the P4's 14.5 measured 14.0. The posts are 0.3 mm long on purpose. Outside 14.5-15.2, rebuild with `P4_PANEL_T=<measured>`.
3. **Housing outline:** 320.0 x 160.0 assumed (the P4's 128.0 measured 127.8). `P4_HOUSE_H` / `P4_HOUSE_W` set the diffuser's skirts.
4. **Headers:** data in at x 112, data out at x -113, power at about (-32, +13) seen from the front before the turn, all from a photo (±1.5 mm). They set the ribbon hooks' height and the ribbon's route. Lay a ruler across the housing back over the data-out header: it may stand at most ~1 mm proud.
5. **Ribbon:** the route is about 29 cm seated (estimated from the P4's 23 cm and the longer run), more while assembling, so the panel's 30 cm ribbon is too short: a **40 cm 16-pin HUB75 ribbon**. Not modelled (`p4_cables.py` has not been run for the P5).
6. **Coupons** (walnut ones back-down as exported, with a brim):
   - `coupon-p5-seam-left.stl` + `coupon-p5-seam-right.stl` + a 60 mm length of a joint plate: the top wall across the joint, hood to back rim. Sand the faces, glue with the plate (as in [Shell: print, glue, finish](#shell-print-glue-finish)), finish, then try to twist and pull it apart. This decides the seam screws. It also shows the 55° diffuser seat printed (if it droops: `SEAT_DEG` 50 in `p4.py`).
   - `coupon-p5-knob-wall.stl`: the end wall round the knob hole. The collar should push in firmly (its crush ribs are the P4's).
   - `coupon-p5-diffuser-joint-*`: on the lit panel, for the joint and for how a 5 mm cell lights through the 3 mm grid (if the cells still show a bright centre, deeper; if the picture is too dim or the edges too soft, shallower: `grid_h` in `panel.py`, which moves the panel and so the trays, and the case's depth).
   - `coupon-p5-drawer-fit-shell.stl` + `-tray.stl`: the crush ribs' fit, as the P4's.

## Shell: print, glue, finish
The two halves are the left and right of one ring, joined permanently over the two plates, as the two-panel bars ([P3-128-BUILD.md](P3-128-BUILD.md), "Assembly" step 1) but with the P4's epoxy and clamps. Print and glue the seam coupon first, the same way: it is the only full-size test of this joint.

**Print each half** (Bambu PLA Wood profile, the 0.4 nozzle):
- Back rim on the bed, as exported, **one half per plate**, both from the same spool, one after the other.
- **Fixed 0.16 mm layers, no variable layer height:** the two halves have to band alike where they meet. At 0.16 the checker finds no feature under 0.6 mm on any layer.
- **6 walls**, so the 4.5 mm wall prints solid (12 lines of ~0.42). Elephant foot 0.15. Overhang slow-down on: the 55° diffuser seat is the overhang (as on the P4).
- **5 mm brim** with a 0.1 mm gap: each half stands 78.5 mm tall on a 4.5 mm edge, and there's 35 mm to spare a side.
- Seam **Aligned**, scarf off. In Preview, keep it off the joint face's 2 mm land at the open ends of the U. If it lands there, paint it onto the inside of the end wall (behind the tray, never seen). A blob in the hollow behind the land is harmless.
- Filament dried (~8 h at 50-55 °C) and flow-calibrated. Plate washed with dish soap, then glue stick; bed 55-60 °C; door closed; no supports.
- The checker lists three overhangs per half, all as on the P4's shell: the diffuser seat, the USB-C opening's roof (right half) and the light-sensor pinhole's (right half).

**Glue** (30-minute epoxy, Devcon 2 Ton or similar: CA would bloom white in the V-groove, where it can't be sanded):
1. **Flatten the joint faces.** Tape 220 paper to the glass, stand each half on its joint face (the two ends of its U lie in one plane) and sand with short strokes until the 2 mm land is bright all round. The hollow behind it stays matte. Blow the dust out of the rebates.
2. **Seam screws, only if the coupon called for them:** drill 3.4 mm through the top wall at the two drill marks in the rebate's floor, 15 mm either side of the joint, before gluing (under the plate they can't be reached later).
3. **Dry fit**, both halves back-down on the glass so the back rims make one plane and the halves can't step front to back: the top plate (the one with two holes, holes over the drill marks) in the left half's top rebate, the bottom plate in its bottom rebate, the right half brought on over them. The plates locate the walls up and down. The land should close all round, the V read as one even line across the top, the hood and the bottom, and a tray half should pass the joint from the back.
4. **Glue:** wipe the rebates, plates and lands with isopropyl alcohol. A thin, even coat on each plate's glued face (the one that printed on the bed) and a thin line on the lands, kept 1 mm back from the V. Plates into the left half, right half on, then a strap or packing tape round the case end to end (over the end walls) to pull the halves together. **Four spring clamps** (~45 mm reach), one on each plate either side of the joint, from the back opening, a scrap of card under each outside jaw: they press the plates onto the rebates' floors, which lines the walls up. Wipe off any epoxy that stands proud of the bore (the plates sit 0.1 below it; the trays pass with 0.25).
5. It sets in ~35 minutes and reaches full strength overnight (~25 °C helps; not over 40 °C, the walnut PLA softens in the 50s). Then slide a tray half through each end to check.

**Finish** (the P4's, [P4-BUILD.md](P4-BUILD.md), "Gluing and finishing the shell", steps 4-6):
- Deburr the knob hole, the USB-C opening and the two screw holes underneath; twist a 2 mm bit through the sensor pinhole.
- Lap the front flat on 220 then 400 on glass, in figure-eights across the joint so both halves end flush; clean the V with folded paper; scrape and feather the print seam.
- Scuff evenly, then Danish oil or wax, with the bore, knob hole, USB-C opening, foot and label recesses and the screw holes masked. Once cured, clear the pinhole again.
- **Collar** (`p5-encoder-collar.stl`) into the end wall's knob hole: a firm push, its teardrop point toward the front.

## Parts (`stl/p5/`)
| Part | File | Material | Print |
|---|---|---|---|
| Shell, left / right | `p5-shell-left-walnut-backdown.stl`, `p5-shell-right-walnut-backdown.stl` | PLA Wood | back rim down, one per plate (173 x 187, 78.5 tall) |
| Joint plates | `p5-joint-plate-top.stl` (with the two seam-screw holes), `p5-joint-plate-bottom.stl` | PLA | flat, glued face down |
| Tray, left / right | `p5-tray-left.stl`; `p5-tray-right.stl` + `p5-tray-right-window.stl` (one object, two parts) | black PETG (+ translucent) | back face down, walls up |
| Diffuser, left / right | `p5-diffuser-{left,right}-white.stl` + `-black.stl` (one object, two parts per half) | white + black PETG | face down, both the same way round |
| Diffuser joint bars (2) | `p5-diffuser-bar.stl` | black PETG | flat; only if the snap fit does not hold |
| Spine, bridge | `p5-spine.stl`, `p5-bridge.stl` | black PETG | as the P4's |
| Encoder collar | `p5-encoder-collar.stl` | translucent PETG or a solid colour | flange-top down |
| Knob | `../p4/p4-knob.stl` | white PLA, or any | skirt down |
| Sensor sled, Boot key | `p5-sensor-sled.stl`, `p5-boot-key.stl` | PETG | as the P4's |
| Wall cleat | `p5-cleat-case.stl` (150 mm) + `p5-cleat-wall.stl` (240 mm, with the two stops) | PETG | wall face down |
| Checks | `check-p5-corner-inserts.stl`, `coupon-p5-*.stl` | as above | as exported |

Filament, roughly, scaled from the P4's by volume: walnut ~380 g (both halves from one spool), black PETG ~400 g (+~90 g for the wall cleat). Shell settings below; everything else prints with the P4's settings.

Hardware that differs from the P4's: no M2.5 top screws; 2 x M3 x 10 button heads only if the seam screws are fitted; a 40 cm ribbon; STEMMA QT lengths not worked out yet (the encoder is now ~90 mm above the S3 on the same wall, the sensor under the top wall at x +55). The panel weighs 0.665 kg by Waveshare's listing; Waveshare asks for a 5 V / 4 A supply.

## Checks run on the model
- `python3 check_p5.py`: 56 pairs of parts checked for overlap. The only ones found are intended: the trays' crush ribs into the shell and the plates, the collar's ribs into its hole, the diffuser's snap bumps on the housing. Smallest gaps: encoder board to the tray 0.45 mm, collar to the tray 0.35, the sensor sled to the panel 1.0 (the deeper grid moved the panel 1.5 mm closer to it), knob to the shell 2.6.
- `python3 meshcheck.py --layer 0.16` on the shell halves, and on the plates, collar, cleat and coupons: closed meshes, no feature under 0.6 mm on any layer, and only the three overhangs the P4's shell has. `layerscan.py`: at most 2 separate regions in a layer on the left half and 4 on the right (its openings); the P4's top half has up to 5.
- Every other build's STLs (single P3 and P2.5, both pairs, the P4) were rebuilt after the shared-source changes (`panel.py`, `case.GRID_H`, `case2.KNOB_TOP`, `drawer.tray(encoder=)`, `P4_PANEL`) and are byte-identical to the committed files.

## Open
- **Everything from the photos:** inserts, thickness, housing outline, header positions and heights, the power header, the ribbon's length.
- **The glued plate joint**, unprinted on any build, and with it whether the seam screws are needed.
- **The end-wall encoder mount** is new geometry: the slot, recess and rails have no printed counterpart turned this way, and the collar's hole prints in an end wall for the first time. Assembly order with the encoder on the end wall is not written up; it should follow the P4's (diffuser, panel, encoder, trays).
- **Diffuser on a 5 mm pitch:** the 3 mm grid depth is a starting point (above). The ribs could be wider: two lines a half at the joint (1.6 mm in all) would end the joint-wall gaps the P4 has, but reads as a heavier centre line unless every rib is 1.6. Decide on the lit coupon.
- **Wall thickness:** 4.5 mm by the pattern of the other builds (4 mm at 282, 4.5 the minimum at 414); no stiffness test.
- **Cables:** not modelled. `p4_cables.py` assumes the P4's layout.
- **Firmware:** still 64 x 32 and 1/16 scan, so no layout changes. But Waveshare's wiki has the Pi library start this panel with `--led-panel-type=FM6127`: its driver chips may need a start-up sequence that the P3 and P4 don't. `firmware-s3` sets no driver chip today (`device.cpp` leaves the HUB75 library's default), so a P5 that stays dark or shows garbage would need a driver setting added; check which chips ESP32-HUB75-MatrixPanel-DMA can start before buying. The panel sits turned 180° as the P4's (set up with **Upside down**).
- **Build sheet:** this is a summary. Print settings, gluing, finishing and assembly are the P4's until the P5 is printed.
