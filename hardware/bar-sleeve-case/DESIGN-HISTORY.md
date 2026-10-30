# CTA LED Board: Bar Sleeve Case (Oct 24, 2026)

Current direction after rounds 1–6 on the "LED board case sketches" canvas (inspired by a bar-style LED gadget, adjusted to the 64x32 P3 panel). Renders only so far; no CAD yet. Supersedes the wedge where they differ; panel, diffuser and hardware notes in "Enclosure Notes.md" still apply.

## Shape
- Sleeve: rounded-rectangle front outline, **14 mm corners** (11.5 mm inside the opening), extruded front to back; 2.5 mm walls.
- **Size:** 217 x 110 mm front; **59 mm deep at the top** (front lip angle makes the bottom ~9 mm shallower).
- **Front lip angled:** sleeve runs 12 mm past the face at the top, 3 mm at the bottom, for shade (under a 65° ceiling light the top ~26 mm of the face is shaded).
- **Face ledge:** 1.5 mm inner lip just in front of the face; the diffuser's flange seats against it.
- **Back lip:** 4 mm; back plate recessed into the sleeve.

## Materials
- Shell: **Bambu PLA Wood, Black Walnut**; prints face-down (layer lines run across top and sides).
- Face: the owner's white one-piece diffuser (one 0.2 mm layer fused to the 1.5 mm grid). Its flange fills the opening: ~3 mm top/bottom, ~8 mm at the sides (opening is wider to clear the Portal).
- Back plate: **PETG** (rendered black) for heat margin.
- Knob: white coin knob, Ø27 x 9 mm, on a low collar.

## Controls and ports (left end)
- Portal S3 on the **Waveshare 30 cm ribbon** (direct plug sticks out too far), coiled behind the panel.
- Held by the shell: top/bottom rails at the left end, end stop, **1 x M2.5 x 8** into a boss; board slides in from the back with its USB-C edge in a thinned (~0.8 mm) pocket so the socket is nearly flush.
- **USB-C** in a short pill-shaped groove (same width, radius and groove as the rocker); hole ~10 x 4 mm.
- **Up/Down rocker:** one vertical pill (~7 x 28 mm) split by a hairline. Both halves are flexure tongues: sides and middle cut through (0.5 mm), rounded ends only a 0.5 mm groove (hinges stay solid). Tongues run vertically so they bend within print layers; thin to ~1.2 mm inside; nub ~0.2 mm off each switch. Finger dimples on each half. Test-print a tongue first (wood PLA is brittle).
- No reset access needed.
- Knob is 3/4 back on the top (encoder board must clear the panel's back; centered would need ~85 mm depth).

## Vents, light, structure
- Top: two dot grilles, **5 rows**; underside: two dot grilles, 4 rows (intake).
- **Feet:** four 1 mm recesses in the underside for 10 mm stick-on silicone bumpers (2–3 mm tall), placed clear of the underside grilles; the bumpers' height is the intake gap.
- **Slight baffle under the left top grille** (over the Portal) so its LEDs don't show through; part of the shell print.
- Back plate: centered row of 13 vertical pill slots; keyholes at the top corners.
- **Status window (maybe):** small pill in the back plate over the Portal's NeoPixel, translucent PETG printed into the plate with the AMS (ABS won't fuse with PETG), short printed light pipe (~13 mm gap). Alternative spot: a third pill on the left end under USB-C. Firmware already drives it (`STATUS_LED`).
- Panel hold-down: posts on the inside of the back plate press the panel forward onto the ledge (clear of the Portal rails).
- Back plate fixed by 2 x M3 x 10 from underneath into captured M3 nuts.
- Wall mount: the back lip sits against the wall, so back vents close off there; add lip notches if it'll hang.

## Parts
- On hand: Hantof button-head kit (M2.5 x 8, M3 x 10, M3 nuts), STEMMA QT kit (30 cm knob → Portal), Waveshare ribbon.
- To buy: 4 x 10 mm silicone bumper feet (2–3 mm tall); wall screws only if hanging.

## Measure before CAD
- Portal S3: switch spacing and order of USB-C / Reset / Up / Down along the edge; NeoPixel position and facing.
- Panel: data-input header position; height of the plugged ribbon above the Portal's IDC header.

## Fit check (Oct 24, against the render model's dimensions)
Not assemblable as drawn; fixes below. Panel-back components and the S3's switch positions are still unmeasured.

1. **Module path.** The diffuser flange fills the bore, so the panel + diffuser slides in from the back through the whole sleeve. Nothing may stick out of the sleeve's inner walls: the Portal rails (z 47.6 and 94.4) and the baffle (z 105.5–106.5, flange reaches 109.35) block it. **Fix:** Portal on a separate printed cradle, installed after the module and screwed to the panel's back M3 inserts (positions unmeasured); the baffle becomes the cradle's top. Everything in the shell is cut into the walls (pocket, grooves, keeper recess), never added.
2. **Encoder vs back plate.** Encoder board spans y 29.5–54.9; plate inner face at 53 (1.9 mm overlap). **Fix:** D 59 → 63.
3. **Ribbon exit.** Only 0.4 mm between the Portal's plugged IDC (y 52.6) and the plate; the ribbon needs ~3+ mm to fold. D = 63 gives 4.4 mm.
4. **Portal insertion.** Lower it into the cavity ~3 mm inboard, slide it toward the end wall so the USB-C edge enters the inner pocket and the nubs meet the switches, then screw the cradle to the panel. Needs ~3 mm free past the board's inner edge (there is).
5. **Knob.** Bushing stands 4.9 mm above the 2.5 mm top; with ~10 mm of shaft above it, the tip is ~15 mm up vs a 10.6 mm collar + coin knob. A recessed well can't be used (it would hang into the module path). **Fix:** knob ~15–16 mm tall, or trim the shaft. Measure the shaft.
6. **Feet.** Front recesses start at y 6.7 but the bottom front edge is at y 9.2 (breaks out); feet at x ±94 sit past the flat bottom (|x| ≤ 94.5 with 14 mm corners); rear feet overlap the bottom grilles. **Fix:** feet at x ±84, y 18 and 52; bottom grilles shortened to end at x ~78.
7. **Printing.** The slanted front edge can't go face-down on the bed. **Fix:** print the shell back-down; chamfer the face ledge 45° on its back side so it prints as an overhang; the tongues still bend within layers.
8. **Tolerance.** Flange-to-bore clearance is 0.15 mm in z: too tight for a printed sleeve. **Fix:** 0.3 mm all round.
9. **Back plate.** Two tongues on its top edge slide into grooves cut in the top wall (open to the back); 2 x M3 x 10 up through the floor into captured nuts in plate bosses. Button heads (~1.7 mm) need a 1 mm counterbore to clear the 2 mm bumpers.
10. **Panel back (unmeasured).** The Portal's bottom socket is 1 mm off the panel back. If an HUB75 header (~9 mm) or the power socket sits behind the Portal, they collide. Orient the panel so its input is on the right (far from the Portal) and check the output header's position; the Portal's height can move on the cradle.

## Cables (Oct 24)
- Cavity behind the panel: 24.5 mm deep now, 28.5 at D = 63.
- **Ribbon:** ~150–175 mm route from a right-side panel input to the Portal; 30 cm cable leaves ~125–150 mm slack, Z-folded flat on the panel back (3 layers, ~4 x 21 mm). A ~10 cm 2x8 IDC cable would be tidier.
- **QT (encoder → Portal):** ~145 mm route on the 30 cm cable; plug on the Portal's top side has ~13 mm to the plate.
- **Panel power:** panel socket plug (~15 mm) to the Portal's screw terminals (top side, reachable from the back before the plate goes on); coil the extra.
- Hold-down posts must avoid the folded ribbon, the plugs and the encoder.

## Revision after the panel-back photo and S3 references (Oct 24, estimates until measured)
Coordinates are seen from the front, mm from the panel center (x right, z up). Photo estimates are ±3 mm.

- **Panel back (Waveshare P3-6432-2121-16S):** input header "PI IN" at x ≈ +63 (front right), output "PO OUT" at x ≈ −63 (front left), both vertical 2x8 shrouded, z ≈ −10…+15; 4-pin power socket at x ≈ −13, z ≈ +2. Brass M3 inserts (6): x ≈ ±88 at z ≈ +31 and −26, plus top (x ≈ −14, z ≈ +38) and bottom (x ≈ +7, z ≈ −36). Panel stays in its normal orientation (input on the right, away from the Portal).
- **Portal vs PO OUT:** the header sits ~28–37 mm in from the panel's left edge; the Portal's bottom socket starts ~40 mm in, so ~3 mm apart in x. The header only touches the Portal's PCB if it stands >9.5 mm above the panel back. Measure both.
- **S3 edge (Adafruit fab drawing):** from the top: Reset, Up, Down at 0.39 in (9.9 mm) pitch, then USB-C. Down is only ~9 mm above the USB-C center, so the long flexure tongues don't fit.
- **Buttons, revised:** one printed **rocker** (pill, ~7 x 16 mm) captured in a pill hole by an inner flange, nubs over Up and Down 9.9 mm apart. Pressing one end pivots it on the other end's flange and presses that switch; the switches' springs return it. The rocker and the USB-C hole share **one tall pill groove** (USB at the bottom, a hairline, then the rocker). Rocker prints separately (white to match the knob, or walnut) and drops in from inside before the Portal.
- **Portal cradle:** printed bracket screwed to the two left inserts (x ≈ −88) with 2 x M3 x 8, slots 4 mm long in x; Portal on 3 cradle posts (M2.5 x 8). Lower it in ~3 mm inboard, slide it left until USB-C sits in the wall pocket and the rocker nubs meet the switches, tighten. Its top arm is the grille baffle.
- **Encoder (not in hand):** the shell gets only a Ø24 hole in the top. A printed **collar insert** (the visible collar ring) drops into it with a key against rotation and carries the encoder-specific bore and keeper; the encoder's nut clamps collar + top wall against the encoder body. Collar, keeper and knob print once the encoder arrives.
- **Depth:** 63 mm (encoder board clears the plate by 2.1 mm; 4.4 mm for the ribbon to fold off the Portal).
- **Feet:** 3M Bumpon SJ5312 (clear, flat-top cylinder, 1/2 in / 12.7 mm across, ~3.6 mm tall) in Ø13.2 x 1.5 mm recesses, ~2.1 mm proud; at x ±84, y 18 and 52; bottom grilles end at x ~74. Back-plate screw heads in 1 mm counterbores clear the floor by ~1.4 mm.
- **Hold-down posts:** press on the panel's plastic frame band (top and bottom edges), clear of the Portal/cradle, the encoder, the power plug and the folded ribbon.

## Measure when possible
Panel: PO OUT header height above the panel back and its x position; insert positions; power plug height. S3: USB-C center height on the edge; NeoPixel spot (top-left corner on the component side, per the photo). Encoder: everything (collar insert is designed after).

## Decisions (Oct 24, evening)
- **No end buttons.** The Up/Down rocker is dropped (Down sits only ~9 mm above USB-C, so any button crowds the port). The S3's buttons stay inside, reachable with the back off.
- **Brightness from a light sensor instead:** optional Adafruit 5378 right-angle VEML7700, daisy-chained off the encoder's second STEMMA QT port (10 cm cable from the kit), standing under the **right** top grille (away from the Portal and its LEDs). Held by an arm on the encoder keeper, which prints after the encoder arrives; nothing added to the shell. Firmware: brightness follows the sensor, phone setting still overrides.
- **USB-C treatment: the dish.** Shallow pill-shaped pocket (~8 x 15 mm, ~1 mm deep, radius matching the other pills) with the port at its bottom; the plug's boot sinks in slightly.
- **Status window:** round, Ø6, over the NeoPixel (component side, ~11 mm from the edge, ~4 mm from the top). Back plate carries a hollow black tube (ID ~4.5) down to ~1.5 mm above the PCB to block the nearby green power LEDs; window printed translucent in the plate's first layers (AMS), then black.

## STLs and to-dos (Oct 24)
- Printed parts generated by `case.py` / `diffuser.py` (bar-case-sources.zip): shell (walnut, back-down, 1 mm rounded front and back rims), back plate (PETG, outer face down) + status-window part, diffuser (one piece, or split at 0.2 mm into a white first layer and a black upper part; the owner is printing it in white + black PETG).
- Fit-test coupons cut from the real parts: shell top-left and bottom-left corners, matching back-plate corners, and a diffuser corner. Test: diffuser seat on the ledge, back-plate tongue in its groove, nut slot + M3 x 10 from below, an SJ5312 in a foot recess.
- **When designing the Portal cradle:** add a ribbon clip on a hold-down post so the fold stays low (below ~20 mm above center) and clear of the keyhole cups.

## Tilt: shadow-gap wedge plinth (Oct 24)
- Chosen over tilt feet. Walnut wedge (`plinth.py`, `bar-plinth-walnut-8deg.stl`), 202 x 46.5 mm footprint, about 7 mm in from the case's sides, front and back, so the case seems to float over a shadow line.
- Leans the case back 8° (front raised). About 3.7 mm thick at the back and 9.9 mm at the front; ~72 g. Prints flat-side down, no supports.
- Four Ø12.8 x 1.3 mm pegs on the sloped top drop into the case's existing SJ5312 recesses (0.2 mm clearance each way), so the case's bumpers come off when it's on the plinth. The pegs are clipped 1.5 mm inside the plinth's edge (the front pair are D-shaped), so nothing overhangs and the edges sand cleanly; they still locate the case in every direction. The top is hidden under the case and needs no finishing. Four SJ5312 recesses underneath. Nothing changes on the case; without the plinth it sits on its own bumpers as before.
- Checked against the shell: no overlap. The case's center of mass falls ~17 mm inside the plinth's back edge, so it doesn't tip. Other angles: `python3 plinth.py <outdir> <degrees>`. Bumper pockets instead of pegs were considered and dropped: the case's recesses sit 2-4 mm from its edges, so pockets would break out of an inset plinth.

## Encoder collar (Oct 24)
- `collar.py` -> `bar-encoder-collar.stl`. Ø35 x 1.6 mm flange on the case top; a plug fills the shell's 24 mm teardrop hole and key notch (0.2 mm clearance), so it can't turn.
- The encoder (5880, EC11-style: ~12 mm body at 45° on its board, M7 bushing, 6 mm shaft; sizes from photos, ±1 mm) pushes up into a Ø18 pocket underneath. Its own M7 nut clamps it to the 3 mm deck from above. Knob presses go into the case, so the keeper no longer carries the encoder; it only steadies the board and carries the light-sensor shelf. A ring relief under the deck (r 3.7-6.5) clears the body's anti-rotation tab wherever it sits.
- Stack (estimates): encoder board top 9.3 mm below the case top; shaft tip ~14 mm above it; ~3.7 mm of thread above the deck for the nut. Knob: blind shaft hole ~1 mm deeper than needed, recess underneath for the nut.
- Encoder board turned so its NeoPixel faces the front: the pixel sits under the teardrop tip, so a translucent PETG collar glows strongest at the front of the ring. Walnut collar = no light. Planned use: brief glow on turn/press, follows the panel's dimming, off at night; no status duplication with the back window.
- Print flange-top down. For translucent, use 100% infill so the infill pattern doesn't show.
- Standard (flat) VEML7700 (Adafruit 4162) replaces the out-of-stock right-angle 5378: lies flat, sensor up, under the right grille centered ~x 55 (clears the x 75 hold-down post), screwed to a keeper shelf with M2.5.

## Measurements (revised Oct 24)
- Positions come from photos scaled to the panel's 192 x 96 outline (±1 mm) and from Adafruit's PCB files for the S3. The cradle absorbs error with slotted holes; hold-down posts print long and get sanded or felt-padded.
- Boot access: guide tube moves onto the cradle (referenced to the S3, ~13 mm in from its button edge, ~20 mm above USB-C); back plate gets a Ø2.5 hole with a Ø4 lead-in; printed T-key (Ø2 x ~25 mm). Hold BOOT and plug in USB-C to flash. OTA updates are a later firmware PR.
- Still to measure: encoder board top to shaft tip, once it arrives. Optional: panel thickness at the frame.

## Shell v2: print fixes (Oct 25)
First shell print (v1, back-down): scaly front rim, a band at every dot-hole row, curled foot recesses, a ragged painted seam on the bottom, strings. Also: with the USB-C plugged through the end wall, the S3's Up/Down buttons pressed against the wall.
- Causes, confirmed by a layer-by-layer slice scan (`layerscan.py`): the slanted front rim was the last, sloped surface, so it printed as a staircase (one 2.4 mm step per 0.2 mm layer). Each dot-hole row switched the layer between one loop and ~43 separate pieces, with about 15% more path, 16 times between 14 and 28 mm of height; each switch shows as a line all round. The seam was painted on a flat face. Strings and rough patches point to damp filament.
- `case2.py` -> `bar-shell-v2-walnut-frontdown.stl`, already oriented: the front rim lies flat on the bed (tilted 4.7°, so layers run parallel to the front edge).
  - Front rim: 0.45 mm chamfers on both edges (about 1.6 mm of rim on the bed) instead of 1 mm rounds.
  - Face ledge: 45° bevel on its front. Same opening and the same diffuser seat.
  - Grilles: front-to-back slots, 1.5 mm wide on a 4 mm pitch. Top: 16 per side at x ±57, y 30.5-46.5. Bottom: 7 per side at x ±50-74, y 39.5-55.5. The bottom zone is offset 9 mm so both zones occupy the same layers (30.5-46.5 mm of print height), so the layer path changes twice instead of 16 times.
  - Teardrops point to the back (the print's up): encoder hole (the key notch is dropped, the teardrop keys the collar), foot recesses (truncated, hidden by the bumper), screw holes.
  - Left end: relief behind the S3's Down/Up/Reset (from 8 to 35 mm above the USB-C centre), leaving 0.8 mm of wall, 1.0 mm deeper than the USB pocket, so the board can sit tight to the wall without pressing them.
  - Checked: watertight; collar v2, plinth, back plate and diffuser module path all clear (the module test only touches the seat chamfer, as in v1).
- Collar updated to match (teardrop tip to the back, no key). Back plate, diffuser and plinth unchanged.
- Known trade-offs: the back rim is now the last, sloped surface (staircase; use variable layer height there or sand it; it's the least seen side). The diffuser seat sits 4.7° off the layers (0.2 mm steps, hidden; the flange rests on the high points). The slot zone may still show as one subtle band.
- Settings: import as-is; Bambu PLA Wood, 0.4 nozzle, filament dried and flow-calibrated; 3 wall loops; 0.2 layers throughout (no variable layer height: any change in layer height leaves a faint line); sand the sloped back rim flat instead (220 then 400 grit); seam painted on a bottom rounded corner with scarf seam on; no supports, no brim on textured PEI; elephant foot compensation 0.15; avoid crossing walls on.
- Coupons, print-oriented: `coupon-v2-front-corner.stl` (rim, bevel, ledge, seat) and `coupon-v2-slots-usb-buttons.stl` (top slots, USB dish and opening, button relief; plug the S3 in to check the buttons stay free).

## Venting moved to the back plate; no grilles in the shell (Oct 25)
- Why: any hole cut into the shell's walls splits the print layers it crosses into separate pieces. By the layer scan's estimate, slot layers take about twice as long as plain ones, so even v2's slots could leave one band. Without grilles, the worst layer is 3 pieces and within ~3% of the normal path, from the knob hole, USB-C and screw holes. Foot recesses don't go through the wall, so they cause no bands.
- Thermal estimate: typical content draws ~2-5 W, and the case surface sheds ~0.7 W/°C even sealed, so about 5-10 °C above room. Venting matters for bright full-screen content (up to ~15-20 W) and sun. The earlier call for top and bottom grilles was cautious, not calculated.
- `case2.py`: `GRILLES = False` (the slot version is kept behind the flag). `back_plate2()` -> `bar-backplate-v2-petg.stl` + `bar-status-window-v2-translucent.stl`:
  - 13 pills now 55 mm tall (ZC-35 to ZC+20, below the keyhole cups); 3,090 mm² open vs 1,800 before.
  - Chimney gaps: the plate is 2.5 mm short of the bore at its top and bottom edges, hidden inside the 4 mm back lip. About 430 mm² along the top (the same as the old top grilles) and 540 mm² along the bottom. The tongues and screw bosses span the gaps. Checked: one piece, clears the shell, slides in.
- Light sensor: no printed hole. `bar-sensor-drill-guide.stl` keys into the knob hole (teardrop) and guides a Ø4 drill at x +55, y 42. Drill from outside, before assembly, slowly. The sensor shelf will sit under that spot.
- Coupons: `coupon-v2-front-corner.stl`, `coupon-v2-usb-buttons.stl` (L-shaped: the end wall with the dish, opening and button relief).
- Firmware: `0001-S3-firmware-log-the-chip-temperature-once-a-minute.patch` adds `chip … C` to the once-a-minute serial line, for the tape test (current shell with and without its grilles taped, an hour each on the brightest normal screen). Push access was declined in this session, so it's a patch, not a PR.
- USB-C notes: the S3's port must sit tight to the wall (the cradle sets this and must hold it there against cable pressure). The cable's plug housing must fit the dish (~15 x 8 mm, 1 mm deep) or the plug won't fully seat. The wall around the port is 0.8 mm, so don't lever the cable. The opening has 0.6-0.7 mm clearance around the plug.

## USB-C for any cable, slim screen rim, Boot hole (Oct 25)
- USB-C: the dish and the thin wall are replaced by a straight-through rounded-rectangle opening, 13.65 x 8.0 mm (r 1.5, 0.5 mm outer chamfer). It is sized for the largest spec plug housing (12.85 x 7.0, per the plug dimensions update; the older figure is 12.35 x 6.5) plus 0.4 mm a side, and 0.2 mm extra across for print sag. A plug only seats fully if its housing gets within about 0.3 mm of the port, so the 0.8 mm wall in front of the port would have stopped some cables short. Now any compliant housing goes in until it meets the port.
- The S3's port face sits 1 mm inside the wall (`S3_EDGE_X`); anywhere from flush to ~3 mm inside works, so the cradle tolerance relaxes and the edge buttons never touch the wall (the relief behind them stays as a margin). The opening also takes the cable's side loads off the S3.
- Screen rim: a slim triangular rim (45° both faces, 1.2 mm in from the bore) replaces the flat ledge, front bevel and seat. The diffuser's front edge (bore - 0.9) seats on its back slope, so the diffuser face stays at y 12, and the existing diffuser fits unchanged (checked). The flat ledge's top and bottom runs started and ended within a single layer (10-15 % area steps at 3 and 12 mm of print height); now every step is under 3 %, with about half the material.
- Back plate v2: the S3 light tube moved with the board position (x = S3_EDGE_X + 11.1 = -93.9), and a Ø3 Boot hole with a countersink was added at x -91.7, z ZC+20. The Boot guide tube down to the button goes on the cradle, aligned to these positions. The cradle puts the board where the plate expects it.
- Encoder NeoPixel: the teardrop direction only shapes the collar. The keeper (later) still turns the encoder board so its NeoPixel faces the front, so the collar still glows at the front.
- Temperature logging: PR #431 (`claude/s3-chip-temp`).

## Cut-out skins: no band at the knob hole and USB-C (Oct 25)
- Even one opening cuts the outer wall's loop in every layer it spans. The knob hole spans ~29 mm of print height and showed as a wide band. With `SKINS = True`, the knob hole, USB-C opening and screw holes print closed by a 0.4 mm skin on the outside face, one extrusion line (blind pockets from inside). Layer scan: every layer is one continuous piece (was up to 3).
- After printing, before assembly:
  - Knob hole: cut the skin out from inside with a sharp hobby knife, following the pocket wall. The collar flange hides the edge. Do this before using the drill guide.
  - USB-C: cut from inside the same way, then bevel the outside edge lightly with a deburring tool (the printed chamfer is gone).
  - Screw holes: drill through the skin at the bottom of each counterbore with a 3.4 mm bit (9/64" works).
- Coupons regenerated with the skins (practise the USB cut on `coupon-v2-usb-buttons.stl`). `SKINS = False` restores printed-through openings.

- Decision (Oct 25): the USB-C opening prints open (`SKIN_USB = False`); only the knob hole and screw holes keep skins. The USB port leaves 2 pieces in about 8 mm of print height; sanding and oil/wax should blend it. Fallback if it still shows: a panel-mount USB-C extension on the back plate (female on the plate, 90° male to the S3, about 20-30 cm, two screw ears), moving the S3 ~12 mm in from the end wall and leaving the end wall plain. The catch is wall mounting, which then needs a right-angle cable.
- Update (Oct 25): every cut opening is now covered. The USB-C skin (0.4 mm) covers a larger cut-out (15.6 x 10.2 mm), cut from inside along the pocket wall. `bar-usb-bezel.stl` (19.5 x 13.5 mm flange, 1.2 thick, a plug that fills the cut-out and keys it, prints flange face down, walnut or black) hides the edge. Its own opening is the spec-max housing envelope (13.65 x 8.0), so any compliant cable reaches the port; the tunnel from the bezel face to the port is 4.7 mm. Fit-checked: bezel vs shell 0; a spec-max housing reaches 0.3 mm from the port. Button relief moved to start 8.8 mm above the USB centre (1.0 mm wall to the cut-out). Hold it in with friction or a drop of CA. Covers: the knob hole (collar), USB-C (bezel), screw holes (screw heads in their counterbores).
- Update (Oct 25): the first v2 print snapped off the bed at ~75% (about 47 mm, where the nozzle crosses the tops of the foot recesses and screw counterbores). Both are now full teardrops with no flat roof, so there's nothing to curl and catch the nozzle; the points show ~3 mm past the bumpers and screw heads, underneath. Print settings added: outer brim 5 mm with 0.1 mm brim-object gap, z-hop on travel, plate washed + glue stick, bed 55-60 °C, door closed.

## S3 mount on the back plate (replaces the panel-side cradle) (Oct 25)
- Positions come from Adafruit's board file (`Adafruit MatrixPortal S3.brd`), board frame x from the button edge, y up the edge:
  - USB-C (5.08, 8.26); Down (1.78, 18.54); Up (1.91, 28.32); Reset (2.41, 38.10)
  - status LED WS2812B 3535 (12.19, 41.02); Boot KMR2 (14.58, 28.52)
  - M2.5 plated holes at (7.62, 15.875), (7.62, 35.56), (48.26, 35.56), (48.26, 15.875); 2x8 IDC (57.15, 22.23); 100 µF can (11.56, 20.45)
- Correction: with the component side facing the back plate (needed for the status window and Boot access), the board is rotated 180° from Adafruit's top view. Along the edge the USB-C is at the top, with Down (-10.3), Up (-20.1) and Reset (-29.9) below it. The shell's button relief moved below the port (ZC-35 to ZC-8.8, 1.0 mm wall to the cut-out).
- The S3 now mounts on the back plate: four Ø5 posts to its M2.5 holes (Ø2.2 pilots; M2.5 x 8 screws from the panel side, self-tapping into PETG), tied by ribs at the plate. The light tube (LED at x -91.8, ZC-32.8) and the Boot guide tube (x -89.4, ZC-20.3; Ø2.6 bore to 1 mm above the switch) are on the same part, so they line up exactly. The shell fixes the plate's position to about ±0.2 mm, so the USB-C lands in the same place every time. Nothing depends on the panel's insert positions or its tall capacitors.
- Board edge 2 mm inside the end wall (`S3_EDGE_X` -104), so the edge buttons clear the wall as the plate slides in. Plug tunnel from the bezel face to the port: 5.7 mm.
- Pills: 11 instead of 13 (the outer pair would sit under the posts). Two pairs of ribbon hooks on the bars between pills (x ±22.5) hold the 20.3 mm ribbon flat along the plate at about ZC-5.
- `bar-boot-key.stl`: a 1.6 mm square rod turned 45° (prints flat) with a T grip; reaches 0.6 mm past the switch top.
- Checked: plate one piece, clears the shell in place and along its slide-in path; the S3 envelope (PCB, module, IDC + plug + bend, 100 µF can, USB-C) clears the plate and the shell, including during slide-in; the light tube ends 1.5 mm above the LED.
- Assembly:
  1. Screw the S3 to the plate's posts.
  2. Plug the ribbon into the S3 and the panel's PI IN; clip it into the hooks.
  3. Connect the panel power to the S3's terminals, and the encoder's STEMMA QT cable.
  4. Slide the panel and diffuser into the shell from the back.
  5. Slide the plate in, tongues into the top grooves; fit 2 x M3 x 10 from below.
  6. Fit the USB bezel and plug in.
  To service, unplug USB-C first; the plate comes out with the S3 still on the ribbon.

## Shell v3: back-down print with a glued-in screen frame (Oct 25)
- Why: printed front-down, v2's layer lines run parallel to the slanted front, 4.7° off square, which reads as the case leaning forward. Printed back-down, the lines run square to the case.
- `case2.py` with `BACKDOWN = True` (`export_backdown()`):
  - `bar-shell-v3-walnut-backdown.stl` is a plain sleeve with no screen rim, so nothing runs along the layers at the front. It keeps the v2 fixes: no grilles, skins over the knob, USB-C and screw holes, chamfered rims (back rim on the bed).
  - Teardrops point to the front (the print's up) for the knob hole, foot recesses and screws. The button relief has its 45° edge at the front.
- `bar-screen-frame.stl`: a ring 1.2 mm in from the bore and 2.5 mm deep (y 9.5-12.0), with 0.15 mm clearance and a 0.5 mm chamfer on the inner front edge. Its back face is the diffuser seat (face at y 12). Prints front face down; black reads as a screen bezel, walnut blends in.
- `bar-frame-glue-guide.stl`: a 0.85 mm-wall tube, 51 mm tall. Stand the shell back-down on a flat table, drop the guide inside, and lay the frame on it: the frame sits at exactly y 12, square to the case, centred by the bore. Glue with small dots of gel/medium CA on the frame's outer edge, no bead. Ventilate against blooming. Lift the shell off the guide once cured.
- `bar-encoder-collar-backdown.stl` and `bar-sensor-drill-guide-backdown.stl` have the teardrop tip to the front, to match.
- Front rim prints as a staircase: lap it flat on 220 then 400 paper taped to glass or a countertop.
- Checked: frame, guide, diffuser (face seats on the frame), collar, drill guide, plinth, back plate (in place and sliding in) and the panel module path all clear. Every layer is one piece.
- Known: the bottom wall's front edge runs along the layers, so the layer area steps ~15 % twice at about 54 mm of print height. A faint line may show about 9 mm behind the front edge on the top and ends. Front-down spreads this out instead.
- Seam: Bambu's "Back" puts it toward the case top in this orientation. Rotate Z 180°+45° (225°, or 135°) so the bottom-right corner faces the back of the plate, and check in Preview. Brim on the back rim (outer, 5 mm, 0.1 gap).
- Coupons: `coupon-v3-front-corner-backdown.stl` (the top 16 mm of the print at the top-left front corner: lapping test) and `coupon-v3-frame-corner.stl` (the matching frame piece for a glue test).

## Back plate v3: bolted to the panel (Oct 25)
First assembly of v2: the plate rocked and sat unevenly, the bottom screws spun, the S3 screws were hard to start, and the cables showed through the pills.
- Causes: the hold-down posts' foam pushed the plate outward, and only the two bottom screws resisted it; the top tongues sit in grooves open to the back, so they stop up/down but not in/out, and the top swung out. Nothing set the plate's depth. The bottom nut slots were 9 mm long and open toward the panel, so a nut slid off the screw axis. The S3 pilot was Ø2.2 (prints ~Ø2.05) for M2.5 machine screws, with no lead-in.
- Constraint: the module slides through the whole bore, so nothing can stick inward from the shell's walls; fixes go on the plate.
- Options considered: hook-in top pockets (needs a new shell, ~1 mm skin left in a 2.5 mm wall); snap latches (new shell, PETG creeps under the foam load, release through hidden gaps); bolting the plate to the panel (chosen: plate-only, the finished shell is unchanged).
- `plate3.py`:
  - Three standoffs (Ø11, Ø8 tube, 3 mm floor with a Ø4.2 hole) from the plate to the panel's brass M3 inserts at (-88, +31), (+88, +31), (+88, -26); M3 x 8 + washer from the outer face. Three points set the plane; the foam posts are gone. The plate is rigidly parallel to the panel.
  - Bottom bosses: screw hole is a 3.5 x 4.7 y-slot and the nut floats ±0.6 mm along a closed slot whose mouth narrows to 5.3 mm (the nut snaps past it and can't walk out). The module is pushed onto the frame and then screwed, so the slot absorbs the frame/panel/standoff stack error.
  - S3 posts: Ø2.4 pilot, 0.5 mm 45° lead-in.
  - Tray: fills the bore (0.2 mm clearance, no edge gaps) with a 6 mm inward skirt (cut back over the encoder). The v2 edge gaps left the top and bottom edges unsupported; they flexed and nothing located them.
  - Venting: louver bands, inlet along the bottom (~1,300 mm² face area) and outlet along the top (~1,000 mm²), slots 2.5 mm tall on a 4.5 mm pitch through a 5 mm band, rising 45° inward (no line of sight from level or above; prints unsupported outer face down). The segments dodge the bosses, standoffs, keyhole cups, S3 light tube and post ribs, and the encoder.
  - Thermal estimate (series model: inside air film, 2.5 mm PLA, outside convection + radiation; walls ~0.15 W/°C, panel face through the diffuser ~0.1 W/°C; chimney 85 mm): rise above room sealed +12 °C at 3 W (transit) / +20 °C at 5 W (ticker); with ~1,500 mm² in and out about +7 / +11 °C. Mid-height vents (v2's pills) barely make a chimney. Check with the S3's chip-temperature log; `LOUVERS = False` seals it, `PILLS = True` restores the pills. (An earlier note's 6-10 °C sealed figure assumed walls at the inside air temperature; too optimistic.)
  - Checks: one piece; no overlap with the shell seated or along a 12 mm slide-in; clear of the panel slab, the S3 board, its IDC/plug envelope and the encoder zone.
- `check-panel-insert-template.stl`: 1.2 mm frame on the panel outline with Ø3.4 holes at all six insert estimates, Ø11 foot rings, an arrow tab on the PI IN side. Lay it on the panel's back (bed face down on the panel); if an M3 drops into each used insert, print the plate.
- Coupons: `coupon-v4-plate-boss.stl` (one boss, screw it through the real shell's floor hole with a nut in), `coupon-v4-s3-pilots.stl` (Ø2.3 / 2.4 / 2.5, marked by 1-3 notches).
- Cables: a 15 cm 2x8 female-female IDC ribbon replaces the 30 cm one (the run is ~14 cm: fold at the S3, ~11 cm across, down to PI IN); the panel power lead can be cut short and re-terminated with crimped M3 forks.

### Plate v3, round 3: stock cables (Oct 25)
- Assembly showed the real space problem: the stock panel power cable (~50 cm, often with a second plug for chaining) wadded behind the panel, and the stiff ribbon. The panel's power socket sits a couple of cm from the S3's terminals, so ~45 cm plus a plug has to be stored. Jake prefers keeping the stock cables (no cutting, crimping or splicing).
- Cable storage, sized honestly: a stock cable is often 4 wires of ~2.2 mm; ~45 cm folded in 3.5 cm passes is ~13 passes x 4 wires, about half air, so ~50 x 28 x 20 mm with the spare plug (~23 cm³). A first tray above the S3 (13.5 x 10 mm inside) was far too small and was dropped.
- A shelf sized for that bundle (56 x 23 mm, above the ribbon) was tried next and dropped: dictating where a stiff cable sits is hard on the bench. Final: the cable is tied into its own bundle and placed wherever it fits (~500 cm³ free behind the panel vs ~23 cm³), with two optional tie-down loops (14 x 2.2 mm tunnels) above the ribbon, beside the power socket (five were tried; three dropped as unneeded). Bolted to the panel, any push from it is internal.
- Plate 3 mm (grown outward into the back lip, 4 -> 3 mm recess): ~3.4x stiffer, no cable space lost. Boot key 1 mm longer (`bar-boot-key-v3.stl`).
- 4th standoff at the panel's bottom-centre insert (+7, -36) so the plate's middle is tied to the panel; bottom louver segments split around it.
- Ribbon bay: 2.2 mm pocket behind the S3's IDC plug (plug top to plate 4.7 -> 6.9 mm).
- With the plate bolted to the panel, cable pressure is an internal load between plate and panel (taken by the standoff screws), not a push on the shell.
- One-piece, single-colour plate (`bar-backplate-v3.stl`): the status light tube opens in a Ø3 hole with a 0.5 mm chamfer.
- Shell unchanged. A deeper shell (+5-8 mm) is the fallback if a PLA dry-fit with the stock cables still feels crammed; everything is parametric on `D`.

### Plate v3, round 4: print time (Oct 25)
- The 3 mm plate printed solid took over 4 hours (85 cm³; v2 was 50). Breakdown: flat plate 57 cm³, louver bands 11, the four standoffs only 6.
- Back to a 2 mm plate (69 cm³); the 4-point bolting keeps it rigid. Boot key back to `bar-boot-key.stl`; the ribbon-bay pocket is 1.2 mm (plug to plate 5.9 mm).
- Standoffs slimmed to Ø9 with a Ø6.4 tube and no washer (the M3 button head, Ø5.7, seats on the 3 mm floor); floor hole Ø3.6 (±0.3 mm), since the template confirms the insert positions first.
- Print settings: 0.24 mm layers, 4 walls, 4 top/bottom layers, 15% gyroid instead of solid. Target ~2.5-3 h.

### Plate v3, round 5: clean-up (Oct 25)
- The inside face read as a lot of unrelated rectangles (separate louver blocks, square keyhole cups, rib frame, loop boxes). Now: one continuous band along the bottom and one along the top (3 mm off the plate, 45° chamfers on the inner edges, cut back over the encoder), slots in three regular rows per band, mirrored left-right (3 x 3 mm on a 5 mm pitch; ~970 mm² in, ~790 out); rounded bottom bosses; stadium keyhole bumps (keyholes kept for wall hanging); one rounded pad under the S3's posts instead of the rib frame; one tie-down bridge (x -17..17, z 63-78) instead of two loops.
- The script adds every solid first and cuts every hole and slot at the end, so no later feature fills a nut slot, tube or louver.
- 76 cm³ (69 before; the continuous bands cost ~10% more print time).
- Status light: a translucent PETG rod (`bar-status-rod-translucent.stl`, Ø4.3 shaft, Ø5.8 x 0.6 flush head) runs down the plate's light tube to 0.8 mm above the S3's LED, replacing the open Ø3 hole: a flush glowing dot, no dust. Printed rods scatter light at the layer lines, so it glows softer than the open hole. `window='open'` restores the hole.
- Keyholes are kept (wall hanging); they disappear in renders with the dark panel behind them, not in the part.

## Shell v4 (Oct 25)
The first walnut shell was a prototype and was scrapped, so the shell was open to change.
- **Depth 63 → 69 mm (`D`)**: room for the stock cables. The panel, frame, knob, USB-C and S3 stay where they were; the plate sits 6 mm further back (its standoffs, S3 posts, light tube and rod, and the Boot key grow with it). The ribbon now has ~10.7 mm to fold behind the S3's plug, so the plate's ribbon pocket is gone. The frame glue guide and the plinth are regenerated for the depth.
- **Top snap**: the plate's tongues get a 0.7 mm bump (gentle lead-in toward the front, steep back face); the shell's tongue grooves get a 0.5 mm dimple in their roof at the seated position (0.7 mm of wall left over it). Sliding in, the bump rides 0.4 mm into the groove roof (the top wall flexes) for the last ~6 mm, then drops into the dimple. Checked: seated with no overlap.
- **Four screws from below** (x ±40 and ±52, `SCREW_XS`): twice the clamp holding the module back. Bottom louvers re-spaced around the new bosses (slots 3.5 mm tall now, still hidden by the 5 mm rise): ~870 mm² in, ~1,280 mm² out (the top centre group now runs the full width between the keyholes, since the band no longer reaches the encoder).
- S3 posts Ø6 (they're ~22 mm long now).
- Layer scan: every layer of the v4 shell is one continuous piece.
- Not done: flush screw heads underneath. The counterbores leave the M3 button heads ~0.6 mm proud, below the 3.5 mm bumper feet; deepening them would leave ~0.6 mm of floor under each head.
- Feet (Oct 25): the front foot recesses' teardrop points reached past the bottom front edge (tip at y 8.7, edge at 9) and showed as a notch from the front. Front feet moved from y 18 to 22 (tip ~3.5 mm inside the edge), back feet from 52 to D - 11 = 58 to keep the stance; the plinth's pegs follow.

## Light sensor (Oct 26)
- Hole: a single Ø2 hole drilled through the guide (was Ø4), no lens or rod: barely visible, no extra part. The chip, ~5 mm under the 2.5 mm wall, sees a ~±10° cone straight up (a patch of ceiling), which is enough for room brightness at the VEML7700's high gain and ignores the screen's own glow.
- `sensor.py` -> `bar-sensor-bracket.stl`: Adafruit VEML7700 (4162, flat; board 25.4 x 17.78, holes and chip from Adafruit's board file) on a carrier, two arms to pads under the 5880 encoder board's right-hand corner holes (M2.5 x 8 up through, nuts on top). Nothing attaches to the shell; the plate needs nothing.
- Encoder board height is the one estimate: 7.9-9.3 mm below the case top (collar deck vs stack notes). Designed at 9.3 with the sensor 5.9 mm under the wall, so at 7.9 its sockets still clear the wall by 0.25 mm. Checked against the shell, plate (seated and sliding in), panel, encoder body, its socket, pins and nuts.
- Assembly order fixed: the panel's top edge (z 103.15) is above the encoder board's underside (~99.4), so the panel can't slide past a mounted encoder. Panel first, then the encoder (with the sensor) from the open back, then the plate. The v3 build sheet's "bolt the plate to the panel on the bench, slide the module in" was not possible and is replaced.
- Firmware and control page support (brightness from the sensor) is a separate PR.
- Skins (Oct 26): the 0.4 mm skins over the knob hole, USB-C and screw holes are vertical walls in the back-down print, thinner than one 0.4-nozzle line (~0.42), and Bambu Studio dropped them. Now 0.5 mm, just over one line, so they slice with either wall generator (0.8 was tried and was too much to cut). Arachne, or Classic with "Detect thin wall", would also have printed 0.4. Layer scan: still one piece per layer. Bezel fit unchanged once the USB skin is cut out.

## Front-down, openings printed open (Oct 26)
- A new back-down print still showed bands and marks at the cut-out openings; with wood PLA the skins didn't buy enough to justify cutting them out, the glued frame and lapping. The main build is now the front-down shell (built-in screen rim, front rim flat on the bed) with every opening printed open: knob hole, USB-C (spec-max plug opening with a 0.5 mm chamfer, no bezel), the four screw holes and the Ø2 sensor hole (no drilling or drill guide). Layer scan: up to 5 pieces in the layers the openings cross, accepted.
- Same v4 geometry otherwise: 69 mm deep, top snap, four screws, moved feet. Checked: diffuser seats on the rim and slides in; plate seated and sliding; collar, light rod, and a spec-max USB-C plug housing clear.
- The back-down set (shell with 0.5 mm skins, glued screen frame and guide, USB-C bezel, back-down collar, drill guide) moved to `stl/alternate-backdown/`. The v2/v3 coupons were removed.
- Correction (same day): the main shell stays back-down. It now has the built-in screen rim (the front-down build's two 45° slopes, which print without supports either way up) and every opening printed open; the front is still lapped flat. Front-down moved to `stl/alternate-frontdown/`. The skinned shell, glued frame, glue guide, drill guide and USB-C bezel are no longer exported (`GLUED_FRAME` / `SKINS` in `case2.py` bring them back). Checked: diffuser seats and slides in, plate seated and sliding, back-down collar, open holes, spec-max USB-C plug. Layer scan: up to 4 pieces where the openings cross.

## Knob, and the encoder from Adafruit's CAD (Oct 26)
- Adafruit's 5880 model (Adafruit_CAD_Parts): encoder body 6.3 mm on the board's front face (~11.8 square, at 45°); M7 bushing 7.4 mm long; 6 mm shaft 7.6 mm past the bushing, round for its first 1.2 mm, then a D-flat 1.55 mm from the axis to the tip; the two STEMMA QT sockets (2.96 tall) and the through-hole pins (2.1) are on the other face.
- With the body clamped against the collar's deck (1.4 under the case top), the board's encoder face is 7.7 under the case top, not the 9.3 estimated earlier. The sensor bracket is corrected for it (sensor 5.0 under the top wall, sockets clear by 0.75, chip 4.15 under the wall).
- `knob.py` -> `bar-knob.stl` and `bar-knob-fit-set.stl`: a reeded coin knob, Ø27 x 12.7, whose skirt hides the nut and stops 1 mm above the collar (the push switch travels ~0.5 mm). It seats on the shaft tip, so its height is fixed. Bore Ø6.05/6.15/6.25 with the flat at 1.50/1.55/1.60 (1-3 dots underneath); the tightest grips by ~0.05 mm. Prints top face down, no supports. Checked against the collar, nut + washer, bushing and shaft, also pressed.
- Knob restyled (same day): a floating disc, Ø36 x 12.7, on a Ø18 hub that hides the nut and stops 1 mm above the collar; the top is softly domed (0.9 mm) with a 1.5 mm rim round, and 96 fine grip ridges run round the disc's edge. Chosen over a finger-dimple spinner because pressing the dimple, 11 mm off the axis, would load the push switch off-centre. The domed top can't sit on the bed, so it prints upright with supports under the disc only (that face looks down at the case). The reeded coin is kept as `coin()`. Same bore fit set; checked against the collar, nut, bushing, shaft (also pressed) and the shell.
- Knob, final style (same day): back to the pebble. Ø30 x 12.7, smooth side, a 5 mm shoulder round handing over tangentially to a shallow dome (1.5 mm), skirt over the nut to 1 mm above the collar. Prints upright with no supports: the nut-recess and bushing ceilings are 45° cones (the D starts at +8.5: 5.2 mm of flat engagement), so only the Ø6 bore top bridges. `disc()` and `coin()` are kept. Same bore fit set; checked against the collar, nut, bushing, shaft (also pressed) and the shell.
- Pebble grip (same day): a smooth dome reads as a button, so 40 flutes (Ø2 grooves, 0.6 deep) run round the straight side band below the shoulder; the top and shoulder stay smooth. Chosen over 90 finer ridges.
- Sensor hole (same day): back to drilled, so the sensor stays truly optional (no hole unless you want one). `bar-sensor-drill-guide-backdown.stl` (Ø2 bore) is back in the build set; the front-down alternate has its own.
- Sensor hole marker (same day): a blind Ø2 pocket from inside the top wall, 0.8 mm short of the outside. Invisible outside; it guides a 2 mm bit from inside when the sensor is fitted, so the drill guide is dropped from the build set (`drill_guide()` stays in `case2.py`). It only notches the inner wall; layer scan unchanged.
- `stl/skinned-shell-parts/` (same day): screen frame, frame glue guide (57 mm, for the 69 mm shell) and USB-C bezel, for a v4 shell already printed with skins. Checked against the skinned back-down v4 shell (USB skin cut out): frame, guide and bezel clear; the guide holds the frame's back face at y 12; the diffuser seats on the frame.
- Screen frame fit (same day): at 0.15 mm per side the frame bowed on one side in a printed shell (printed bores come out undersize, and wood PLA shrinks ~0.3%, about 0.3 mm per side on 212 mm). Frames at 0.30 and 0.45 mm per side replace it in `stl/skinned-shell-parts/`.

## Oct 27: panel profiles, P2.5, plate v3 refinements

- `src/panel.py` holds everything panel-specific; `PANEL=p25` builds for the Waveshare P2.5 64x32 (README, "Other panels"). P3 output stays as built unless noted below.
- Keyholes (both panels): the smallest usable size (Ø8 entry, 4.2 slot, 6 mm travel; bump 12.5 x 18.5, was 14 x 22), so the top louver rows grow 2.5 mm at each keyhole.
- Wall stand-off (both): with the rim flat on a wall the louvers vented into a sealed 4 mm pocket. The keyhole screws now hold the top 2 mm out (heads 8 mm off the wall) and two printed 2.6 mm spacer discs, glued flat inside thin circle outlines at the bottom of the plate's outer face and topped with the same 0.5 x 0.15 in bumpers as the feet, hold the bottom (no 8 x 6 mm bumper is sold; a peg hole would have cut into the P2.5's nut slot); the rim gap is the inlet and outlet.
- Diffuser (both): two parts per colour set, face = first layer: white (0.2, 0.4 nozzle) or translucent (0.4, 0.6 nozzle), plus one black part for the rest.
- S3 corner (both): the corner over the S3 has no standoff (its insert is under the board) and flexed on the first v3 plate. The skirt deepens there into an L-flange, 10 mm instead of 6 (~4.6x stiffer as an edge beam; 16 fitted but read as a wall), up the left edge to the top-left standoff and along the bottom to 1 mm short of the nearest boss, with 45-degree tapers, and a rib ties the top-left standoff to it. At 10 mm it clears the S3's edge parts and a plugged USB-C housing by more than 2.5 mm.
- Top retention (both): the tongue snaps' spring was the shell's top wall, and the same flex let the tabs pop out. Ribs under the top wall can't go in (the diffuser flange fills the bore front to back, so the module couldn't slide past them), so the new catch is at the top corners, where the R11.5 arcs make the shell stiff: a 0.7 mm dimple in each corner's wall, and a PETG finger cut into the plate's corner (an arc slot frees the outer 3 mm, skirt included) with a 0.8 mm bump. 30-degree lead-in, ~50-degree back face; release with a firm pull or by pressing the fingers in from the back. The tongue snaps stay. Coupons: `coupon-v4-latch-shell.stl` + `coupon-v4-latch-plate.stl`.
- Collar fit (Oct 28): at 0.2 mm clearance the collar was too tight in a printed P2.5 shell (the back-down shell prints the knob hole on its side, in wood PLA, undersize like the screen frame bore). Now 0.4, with a 0.3 / 0.4 / 0.5 fit set.
- Corner foot (Oct 29): pushing on the screen, the panel corner under the S3 gave (its insert is covered by the S3, so it has no standoff, and the panel frame twists). A rigid foot from the plate now bears on the panel's frame at its bottom edge, push only: on P3 a 6 x 9.8 mm post beside the S3 (x -95..-89, clear of the first louver slot); on P2.5 a 22 x 2.4 mm blade under it (0.9 mm below the S3's edge, clear of the screw boss). Tip in the standoff feet's plane; shim if the frame sits lower than the insert faces.
- Status light (Oct 29): the translucent rod didn't carry the light; the plate has a plain Ø2 hole (0.5 chamfer) at the end of the light tube.

## Oct 29: v5 drawer
- After the first full P2.5 build the case still felt loose: the plate's top tabs held only by the sleeve's top wall flexing, and the screen gave at the corner whose insert sits under the S3. Root cause: a flat plate held at the bottom pivots about its screws, and nothing inside the sleeve could reach the top because the module has to slide past.
- Considered: top screws (heads on top), through-wall hooks (slots on top), cam locks (still a 1.2 mm groove), magnets (weak in shear), a tub with a front bezel (stiff, but the hood becomes a separate piece), a clamshell (seams across the rim). Chosen: a drawer, which keeps the one-piece sleeve and hood.
- The tray's walls run the full depth inside the sleeve, so it can't tilt; its front edge holds the diffuser flange against the rim. The panel and S3 turn 180 deg so the S3 sits between the panel's right-hand posts (USB-C low on the right; Boot and the status LED still face the back) and all four corners are bolted. Keyholes dropped for full-width vents; a French cleat will do the wall mounting.
- P2.5: a ruler across the panel frame clears its output header, so the S3 needs no extra setback (s3_back 0): the P2.5 case is 69 mm deep, like the P3.
- Stiffness (Oct 29): the two parts still had to feel solid on their own. Sleeve walls 2.5 -> 3.5 mm and tray walls 2.0 -> 2.5 (bending stiffness ~ t^3: ~2.7x and ~2x), and 0.45 mm crush ribs along the tray's outside take up the 0.25 clearance so the walls press on each other instead of sliding past. More bottom screws were considered and not added: with the tray boxed in, screws only stop it sliding out. The encoder slot in the tray's top wall widened for the encoder nut (±13.5 mm, to 14 mm behind the knob axis) and the sensor bracket arms were trimmed for the thicker top wall.
- French cleat (Oct 29): replaces the keyholes. Case cleat bolted to the tray's back between the louver bands (2 x M3 into nut bosses), wall cleat 12 mm deep whose face also holds the tray back, so no bottom spacer is needed; the rim sits 8 mm off the wall and the cleat pair splits the gap into an intake below and an exhaust above. The hang path (lift 12.5, push in, drop) was checked against the shell and tray on both panels.
- P3 drawer: one screw pair from below (x +/-46), as the P2.5.
- Top wall (Oct 29): the tray's top wall has to be open to its front edge wherever something hanging from the sleeve passes through the wall's layer, since the tray slides in under it. Only the encoder's body (6.3 mm tall, between the collar deck and its board) has to; the old 27 mm slot was set by the sensor bracket's M2.5 nuts on the encoder board, and a second slot let the sensor's sockets and light through. The sensor now rides on the tray (pillars under the top wall, a closed Ø4 hole over the chip), the bracket goes, and the one slot is 18.7 mm. The chip sits ~2.8 mm deeper under the Ø2 hole, so it sees a narrower patch of ceiling (about ±5.5 deg instead of ±7.5); a few more holes over it (a dot grill) would add light if needed.
- Crush ribs (Oct 29): 0.45 -> 0.35 mm (0.1 mm into the sleeve instead of 0.2) with a 3 mm ramp at the leading end, gentler on the wood PLA. Bending the 3.5 mm walls by that much is far below what cracks PLA; the ribs mostly squash. The fit coupon now takes in a top rib, so test the feel (and the wood PLA) on it first.
- S3 connection (Oct 29): P2.5 and P3 keep the ribbon from the S3 to the panel's input. Plugged straight onto the input socket, the S3 would cover the P2.5's power input or hang past its edge. The ribbon must be at least ~15 cm (20 cm comfortable) so the tray can come fully out of the sleeve still cabled; the panel end is then ~4 cm inside the back opening to unplug. Larger panels (P4 and up) are planned with the S3 plugged directly onto the input socket, since it fits inside their outline; the USB-C then lands where the input socket puts the S3, likely needing a short extension to a port in the case wall.
- Tie loop (Oct 29): the drawer's tie loop was carried over from plate v3 and didn't work: its tunnel ran up into the top louver band (dead end) and the louver slots cut its bar. Now a 2 mm bar over a 14 x 3 mm tunnel, 6 mm long, up and down the back wall in the clear patch above the ribbon, between its hook and the S3's connector, with 3 mm free at each end for the 12 mm strap to turn out over the bundle (checked against the tray and S3 on both panels).
- Non-manifold edges (Oct 29): the slicer repaired 7 on the v5 files. Causes: the top louver band's face lay exactly on the top wall's inner face, the top slots grazed that face, and the shell's rim cut overlapped its bore by 0.001 mm; all three left sliver or zero-thickness triangles once the STL rounds to float32. The bands now overlap the walls, the top slots stop 0.6 mm under the wall, and the v5 rim cut is two convex hulls sharing one face (SEAMLESS_RIM; off for v4, whose STLs are unchanged). Every v5 STL reloads with 0 non-manifold edges.
- Shell banding (Oct 30): embraced for wood PLA. Variable layer height gives a much finer ramp on the hood and smoother rim slopes, and the faint bands it (and the openings) leave read as wood grain after sanding and oiling. The straight bore walls keep the base layer height, so the tray fit is unaffected. The shell also prints fine on a 0.6 nozzle at 0.2 base layers (3 walls).
- Nut pockets (Oct 30, printed in translucent PETG): the bottom-boss slots' narrowed mouth (5.3) needed a mallet, impossible inside the deep tray, and the 5.45 cleat-nut pockets wouldn't take an M3 nut. Bottom slots now 5.9 wide x 2.9 tall with a 5.55 mouth (finger push, still retains the nut); cleat pockets 5.7 (0.6-nozzle tray 5.75). If holes in general print small in a given filament, use the slicer's X-Y hole compensation rather than resizing the model.
- Status light vs Boot (Oct 30): the two back holes looked alike. Status light: a Ø6 x 1 mm pocket in the back face, lit through the full Ø4.5 light tube, for a glued-in translucent window disc (`bar-status-window.stl`, Ø5.7 x 1). Boot: a 45-degree funnel, Ø7 at the face down to the Ø2.6 hole, that reads as "press here" and guides the key. Both are recesses in the bed face, so they print crisp.
- Boot marker (Oct 30): two Ø1.4 x 0.4 dots (Ø1.8 on the 0.6-nozzle tray) beside the Boot funnel, outboard, stacked like a colon.
