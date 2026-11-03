# CTA LED Board: P4 Bar Sleeve (build sheet, Nov 2, 2026)

The v5 drawer bar sleeve for a **Waveshare RGB-Matrix-P4-64x32** (256 x 128 mm), split into parts that fit the X2D's 256 x 256 mm bed. Walnut PLA shell in two halves, black PETG tray in two halves, two-colour diffuser in two halves with an 8 mm black bezel. Everything else is the v5 drawer (README, "v5 drawer"). Source: `src/p4.py` (+ the `p4` profile in `src/panel.py`); STLs: `stl/p4/`.

**Case:** 281 x 153 x 69 mm (W x H x D). Screen window ~256 x 128 with ~7.7 mm of black bezel showing.

## Decisions
- **Shell split into top and bottom halves** at 2 mm above centre (both halves about the same height). Only the two end walls are cut. A 1 x 1 mm reveal wraps each end (outside, front rim, hood side, back rim); the halves meet at its lower edge, so the joint line sits in the groove's shadow. Inside the wall, a half-lap: the inner 1.75 mm of the wall carries on 3.5 mm lower as a lip on the top half, into a pocket in the bottom half, with a 0.12 mm glue gap on its face and ends and 0.2 mm under it (the outer band is the only seat, which keeps the reveal even). The lip's ends are 45° so neither half has a flat overhang. The lap stays 1 mm behind the screen face and 0.5 mm in front of the tray's back, so it never shows.
- **Diffuser in two halves**, split on the grid rib between pixel columns 32 and 33. That rib is 1.2 mm (0.6 a half; the others 0.8). The 8 mm flange is the bezel. First layer: white over the pixels, black over the bezel; the rest black.
- **Tray split at the centre**, so its seam crosses the shell's. Each half bolts to its two corner inserts and takes one screw from below. A **bridge** (bottom) screws into the panel's bottom-centre insert through a notch half in each tray half; a **spine** (top) bolts across the seam on the cleat's nuts. On a wall, the French cleat replaces the spine.
- **S3 on the right tray half, stock ribbon to the panel** (v5). Plugged straight onto the panel's data-in, the S3's USB-C edge lands ~1 mm past the bore and its side buttons would leave under 1 mm of wall.
- **Panel turned 180°** (data-in on the left seen from the front), as in v5: `MATRIX_ROTATION 180` in `secrets.h`. The top-centre insert isn't used (the encoder hangs right under it).

## Before printing: measure and test
1. **Insert check** — `check-p4-corner-inserts.stl` (any PLA, 250 x 124, flat). Flip it onto the panel's back: an M3 should drop into all six inserts at once (corners x ±120, z ±56; centres x 0, z ±56, from the drawing). The four corners take the tray halves, the bottom centre the bridge. If not, correct `inserts`/`standoffs` in `panel.py` and rebuild.
2. **Panel thickness**, LED face to the back of the housing: the model assumes 14.5 (12 mm housing per the drawing + 2.5 board). The tray's front edge and the tube feet both seat on it with no slack, so if it differs by more than ~0.2 mm, set `t` in the `p4` profile and rebuild.
3. **Data-out header** (behind the S3 once the panel is turned): lay a ruler across the housing back over it. It must not stand proud of the housing; the S3's bottom socket passes 1 mm above that plane.
4. **Remove the magnetic screws** from the corner inserts if fitted (they stand ~2 mm proud; the tray's tubes bolt there).
5. **Coupons:**
   - `coupon-p4-seam-top.stl` + `coupon-p4-seam-bottom.stl` (walnut, back-down as exported): push together; the lip should drop in with a slight gap (0.12 mm a side, filled by the CA) and the outsides meet flush with an even reveal. If it binds, raise `LAP_CL` in `p4.py`; if it rattles badly, lower it. Glue one and finish it (lap, oil) to see the line.
   - `coupon-p4-drawer-fit-shell.stl` (walnut) + `coupon-p4-drawer-fit-tray.stl` (black PETG): the crush ribs should press in with firm hand force, no wobble (tune `CR_H` / `TRAY_CL` in `drawer.py`).
   - `coupon-p4-nut-seat-tray.stl` (black PETG) + `coupon-p4-nut-seat-shell.stl` (walnut): drop an M3 nut down the chimney and press it into the seat; it should take firm pressure and not fall out upside down. Stack the two and run an M3 x 10 up through both. Too tight or loose: `CB_NUT` in `drawer.py` (or the slicer's X-Y hole compensation).
   - `coupon-p4-sensor-hooks-tray.stl` (black PETG) + `bar-sensor-sled.stl`: tabs into the hooks at a slight tilt, swing up, one M2.5 x 6 from outside.
   - `bar-encoder-collar-v5-retainer-fit-set.stl` (translucent PETG): push the encoder's bushing up into each; keep the one that holds it by itself and still lets the nut run down.
   - `coupon-p4-diffuser-joint-{left,right}-{white,black}.stl` (two-colour, face down): hold both on the panel at the bottom centre. The ribs must sit between the LEDs and the joint fall on the column gap.
   - Knob bore: `bar-knob-fit-set.stl` if not already done for the P3.

## Parts (`stl/p4/`)
| Part | File | Material | Print |
|---|---|---|---|
| Shell top | `p4-shell-top-walnut-backdown.stl` | PLA Wood | back rim down, already turned 45° on the bed (246.3 mm square, 4.8 mm a side) |
| Shell bottom | `p4-shell-bottom-walnut-backdown.stl` | PLA Wood | same (247.4 mm square, 4.3 mm a side) |
| Diffuser, left / right | `p4-diffuser-left-white.stl` + `p4-diffuser-left-black.stl`; same for right | white + black PETG | face down; load the pair as one object with two parts (they share one frame, so don't move either part on its own); the white part is the first layer |
| Tray, left / right | `p4-tray-left.stl`, `p4-tray-right.stl` | black PETG | back face down, walls up |
| Spine | `p4-spine.stl` | black PETG | flat, as exported (countersinks on the bed) |
| Bridge | `p4-bridge.stl` | black PETG | plate down, tube up |
| Encoder collar | `bar-encoder-collar-v5.stl` (bore retainer ribs, crest r 3.40; or the fit-set winner) | translucent PETG (wood PLA ribs chip) | flange-top down (as v5) |
| Sensor sled (with the sensor) | `bar-sensor-sled.stl` | PETG | plate down, boss up |
| Knob | `bar-knob.stl` (or the winner of `bar-knob-fit-set.stl`) | white PLA | as exported |
| Status window | `bar-status-window.stl` | translucent PETG | flat |
| Boot key | `bar-boot-key.stl` | PETG or PLA | flat |
| Wall cleat (optional) | `bar-cleat-case.stl` + `bar-cleat-wall.stl` | PETG | wall face down |
| Light-sensor grille guide (optional) | `bar-sensor-grille-guide-plug-fit-set.stl`, then `-5hole.stl` | any PLA | as exported |
| Checks | `check-p4-corner-inserts.stl`, `coupon-p4-*.stl` | as above | as exported |

Filament, roughly: walnut ~150 g (shell), black PETG ~200 g (trays, diffuser, spine, bridge), white PETG ~10 g.

## Print settings
- **Shell halves:** as the v4/v5 shell (README, "Print settings"): Bambu PLA Wood, dried and flow-calibrated; 0.2 mm layers, no variable layer height; 3 walls; outer wall ~150 mm/s; elephant foot 0.15; Z hop 0.6; plate washed, glue stick, bed 55–60 °C, door closed; no supports. **Brim: 3 mm (or brim ears), not 5 mm** — the halves sit diagonally with ~4.5 mm a side. Keep the 45° turn they come with (don't let auto-arrange rotate them back). Seam: put it on a back corner (Preview), scarf seam on.
- **Diffuser halves:** 0.4 nozzle, 0.2 first layer (the face, one layer), 0.2 layers, elephant foot 0, first layer 30 mm/s, Monotonic bottom surface. One filament change (after the first layer).
- **Tray halves:** as the v5 tray: PETG, back face down, no supports, 3 walls, 3 top / 3 bottom, 15% gyroid. (The 0.6-nozzle tray variant isn't built for the P4.)
- **Spine, bridge:** PETG, 100% infill on the spine.

## Hardware
- **Screws:** 7 x M3 x 8 countersunk (4 corner tubes + bridge, no washers; 2 for the spine, into 2 M3 nuts); 2 x M3 x 10 button head + 2 M3 nuts (from below); 4 x M2.5 x 8 (S3, self-tapping into the posts); light sensor: 2-4 x M2.5 x 5 (sensor onto its sled) + 1 x M2.5 x 6 (sled, from outside the tray).
- **Wall hanging instead of the spine:** 2 x M3 x 10 (cleat to the same nuts) + 2 x #8 / 4 mm countersunk wood screws or anchors.
- **Other:** 4 x round bumpers 12.7 x 3.8 mm (3M SJ5312 size); medium CA glue (or 5-minute epoxy if the lap is loose); a small dot of CA for the status window.
- **Electronics:** Waveshare P4 panel (its power cable and 30 cm 16-pin ribbon are used; the P4 needs about 21 cm of ribbon seated and about 25 cm to slide the right tray half in while cabled, so the P3's 15 cm ribbon is too short); Matrix Portal S3 (5778); I2C QT rotary encoder (5880, its M7 nut); optional VEML7700 (4162). STEMMA QT: S3 → sensor 10 cm and sensor → encoder 20 cm, or one 20–30 cm S3 → encoder without the sensor. Data-capable USB-C cable; 5 V / 3 A USB-C supply.
- **Power:** the P4 can draw up to 20 W at full white. Through the S3's USB-C (3 A) keep the brightness capped in firmware; the transit screens use well under 1 A.

## Gluing and finishing the shell
1. Dry-fit the halves back-down on a flat sheet (glass or a stone tile). The back rims are one plane, so the halves can't step front to back; the lap keys them in and out. Check the reveal is even on both ends.
2. Medium CA on the lap's faces only (the lip's outer face and the pocket wall it faces), kept 2 mm back from the outer edge so nothing squeezes into the reveal. Press together on the sheet, tape across both ends, weight the top, let it cure.
3. Lap the front flat (220, then 400, on glass, figure-eights) — across the joint, so both halves end flush. Clean the reveal with a folded strip of paper.
4. Scuff and finish (Danish oil or wax) as the v4 shell. Oil goes on after gluing; CA won't bond to oiled wood PLA.

## Assembly
1. **Shell:** bumpers into the four recesses underneath; collar into the knob hole.
2. **Panel on the bench:** remove the magnetic screws; snap both diffuser halves on (skirts over the outer edges; their straight edges meet at the centre). Plug the power lead into the panel's power header and the ribbon into its data-in (red stripe = pin 1).
3. **Panel in:** turned 180° (data-in on the left seen from the front), slide it in from the back until the bezel seats on the screen rim. Leave the ribbon and power lead hanging out of the back.
4. **Encoder:** after the panel (the bezel's top edge passes right under it): push it straight up from inside, NeoPixel toward the front, thumb on the collar's flange, until the bushing catches on the bore's ribs and it hangs by itself; then the M7 nut on top of the collar and the knob. (An older collar without ribs: lay the shell top-down across two supports, knob hole between them, drop the encoder into the collar's pocket and thread the nut from below.)
5. **Nuts:** press the M3 nuts into the cleat bosses. Bottom bosses: drop a nut down each tray half's hex chimney (inside, at the bottom, behind the louvers) and press it into its seat with a screwdriver tip, or hold it down and draw it in with an M3 x 10 from below through the tray's floor, then back the screw out. Either way it stays.
6. **Left tray half:** slide it in from the back, drape the ribbon over its two hooks, then 2 x M3 x 8 countersunk down its corner tubes into the panel.
7. **Right tray half on the bench**, front up, behind the case: plug the ribbon into the S3's IDC header and the power leads into its screw terminals **while the S3 is loose** (once it's on its posts, both face the tray's back wall and a straight driver can't reach the terminals). Then the S3 onto its posts (4 x M2.5 x 8 from the S3's panel side); light sensor if fitted: on the bench, sensor chip up onto its sled (2-4 x M2.5 x 5 down from the chip side), QT cables plugged in, then tabs into the two hooks on the top louver band with the front tilted ~12° down, swing it up to the top wall and drive one M2.5 x 6 from outside the tray's top (the counterbore beside the light hole); glue the status window in; QT S3 → sensor, sensor → (loose end for the encoder). Tie the spare power cable into a bundle with the tie loop.
8. **Right tray half in:** QT into the encoder's right-hand socket, slide it in, 2 x M3 x 8 countersunk.
9. **Bridge:** tube in through the notch at the bottom centre; 1 x M3 x 8 countersunk into the bottom-centre insert.
10. **Spine** across the top (2 x M3 x 8 countersunk into the cleat nuts), or the case cleat for a wall.
11. **From below:** 2 x M3 x 10 through the shell into the bottom nuts (push the tray forward first so the bezel is seated).
12. USB-C in. Firmware: `MATRIX_ROTATION 180`. To flash: Boot key in at the funnel, plug in, upload, replug.

**Service:** unplug USB-C; 2 bottom screws, spine, bridge; right half (2 screws) slides out on its cables (to unplug the S3, take it off its posts first); left half (2 screws); then the encoder (nut off, push down) **before** the panel slides out.

## Checked (model, Nov 2)
An independent pass over the model and the STLs (then re-run after the fixes): nothing collides when seated except the intended crush ribs and diffuser snap bumps; the panel, both tray halves (the right one with the S3, its USB-C and buttons, and the sensor), the bridge and the spine all slide in clear; every screw lines up with its insert, nut or slot (within 0.02 mm) and every driver line is clear; all STLs are watertight and fit the bed (worst: the bottom shell half, 4.3 mm a side; no more than a 4.6 mm brim). Fixed from that pass: the diffuser's white and black parts are exported in one frame (they were 4.3 mm apart), the lap has a glue gap and 45° ends, the halves meet at the reveal's lower edge (no thin nib), the ribbon hooks have 45° lips, the spine is countersunk (its button heads stood 0.65 mm proud of the back rim), the check frame tests the bridge's insert, and the S3 is cabled before it goes on its posts. Left as is: the USB-C opening's 13.65 mm roof bridge (as v4/v5) and the tie loop's 14 mm bridge.

## Assembly fixes (Nov 3)
After the first assembly: bottom nuts now drop into a press-fit hex seat (no side slot; the ±0.4 float moved to the shell's screw holes), the light sensor rides on a sled screwed from outside the tray, and the collar's bore holds the encoder while its nut goes on. Details, numbers and the checks: README, "Assembly fixes (Nov 3)"; `python3 check_fixes.py` with `PANEL=p4`. A P4 shell printed before this has round screw holes: file them to about 3.4 x 4.2 mm along the case's depth.

## Open
- Panel thickness, data-out header height, and the insert positions (check frame) are the only panel facts not yet measured.
- The diffuser's centre joint: how visible with the panel off depends on the white face; the joint coupon shows it before the full print.
- The shell halves' diagonal print has only ~4.5 mm a side: no 5 mm brim, and the bed's corners have to print well.
