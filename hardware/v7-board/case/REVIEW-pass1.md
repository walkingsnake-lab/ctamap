# V7 first pass: independent design review (Nov 27, 2026)

Reviewed: `v7.py` (+ `v7_render.py`, the four renders) on the V6 P3 model in
`hardware/bar-sleeve-case/src/`. Nothing in `v7mock/` or the repo was changed. My probe scripts are in
`` (`p1.py` .. `p9_area.py`, run from `src/`). "CONFIRMED" = I measured it on the geometry
or sourced it; "PLAUSIBLE" = reasoned, not verified.

## 1. Verdict

The layout is sound in concept (one board in the collar, a hidden bay, a window under the flange) and the model's own
checks do pass, but as drawn it cannot be assembled with real parts: standard through-hole tails on the board's top
side stand 0.48 mm into the chassis top wall, and the board's capture has 0.2 mm gaps, square ends and nothing that
clocks the board before the chassis arrives. Keep the downward-facing socket; what is weak is not its direction but
that nothing guides the plug and the board under it floats. The sensor window is clear and already passes roughly
2-4x the light of V6's pinhole, but the 0.4 mm skin is not where the light is lost: the 6.55 mm of dark well between
skin and chip is, and that is where the requirement ("as much light as possible") should be answered.

## 2. Findings, most severe first

### F1. Through-hole tails on top of the board hit the chassis top wall — CONFIRMED (blocks assembly)
- The board's top is at z 105.60, the chassis top wall's underside at 106.55: 0.95 mm, and the wall slides over the
  whole board. The model's parts are blocks on one side only; a through-hole part's tails come out the other side.
- A standard 2x8 shrouded header has a 3.00 mm post (9.10 mm insulation height; Sullins SBH11-PBPC-D08-ST-BK,
  [DigiKey](https://azcus.digikey.com/en/products/detail/sullins-connector-solutions/SBH11-PBPC-D08-ST-BK/1990064)).
  On a 1.57 mm board that is 1.43 mm proud. Added to the model (`p5_sweep.py`): 31.1 mm3 of overlap with the chassis,
  seated and all through the slide. A 2-pin power connector with 3.5 mm pins: 13.0 mm3. Trimmed to 0.5 mm: 0.
- Fix (pick one): (a) SMT shrouded 2x8 header and SMT power connector (also what instant-quote assembly wants);
  (b) a relief groove 1.0 deep in the top wall's underside, x 25.5-57.5, from the front edge back to y 41 (wall 2.5
  -> 1.5 there; it is open to the front, so it still slides); (c) flush-trim by hand, which defeats bought assembly.

### F2. The board's capture cannot be assembled reliably and does not hold the board — CONFIRMED geometry, PLAUSIBLE tolerances
- Measured: chassis-to-board gap 0.19 mm above (pads) and below (bay wall top, ledge). Every capture feature has a
  square front end (`p7_bay.py`: pads start y 44.05, ledge and fence 43.05, wall 40.6, fin 56.05). No lead-in anywhere.
- Rotation: the collar's pocket is round (r 9.8) and its relief clears the encoder's anti-rotation tab, so nothing
  sets the board's angle until the chassis comes. The fence (0.25 mm beside the right edge) meets the board's corner
  16.5 mm before home and tolerates 0.8 deg; the fin engages only over the last 3.5 mm and tolerates +/-1.0 deg
  (0.3 mm at a 17.6 mm arm). With the nut tight the board stays wherever it was set by eye.
- Height: the board's height comes from the collar deck + encoder body + solder seating + PCB thickness (1.57 +/-10%).
  0.2 mm at the pads (31 mm from the axis) is 0.37 deg of tilt. I estimate the stack at +/-0.3-0.4 mm, so either the
  pads or the ledge will be in the board's way on a real build.
- And when it does go in, 0.2 mm of float each way remains: every plug insertion (5-20 N at 27.2 mm from the knob
  axis) bends the board on the encoder's solder joints until the gap closes (about 8 N closes 0.2 mm).
- Fix: (1) clock the board in the collar, which is keyed to the sleeve by its teardrop: a slot for the encoder's
  anti-rotation tab, or two flats on the pocket for the 13.4 x 12.4 body, instead of the round relief. (2) 1.5 mm
  45 deg lead-ins on the pads, ledge, wall top, fence and fin (their front ends are the top of the print: free).
  (3) Above the board: crush ribs (0.4 wide, 0.2 interference nominal) instead of flat pads at +0.2, so the common
  load, pushing a plug in, lands with no gap. Below: fixed stops at -0.4 (a 20 N pull flexes the board 0.5 mm onto
  them; unplugging is rare). (4) Lengthen the fin so it engages >= 10 mm before home.
- Related: `ENC_DROP` 7.7 is the 5880's encoder (6.3 mm body, Adafruit CAD). The V7 encoder is a different,
  unchosen part; an EC11 with a 6.5 or 7.0 body moves the board 0.2-0.7 mm. Choose and measure the encoder first.

### F3. The bay gives the plug no guidance and the hand no grip — CONFIRMED geometry
- Bay: 27.25 wide, 22 deep to the plate (26 to the rim), socket mouth at z 97.53. Around a spec-maximum 12.35 x 6.5
  plug: 7.25 mm to the floor in front, 7.42 / 7.48 mm to the side walls (16 x 9 plug: 6.0, 5.6 / 5.65). A fingertip
  is ~10-12 mm thick: the plug cannot be pinched on any pair of faces inside the bay. It gets pushed up with one
  finger from behind, or the case gets picked up and turned over.
- In front of the socket the bay is open into the case: 8.9 mm (y) x 27 mm (x) x 11.1 mm (z) between the floor's top
  (92.93) and the board (104.03), because the floor was dropped for a 10.4 mm socket that is not the one drawn. A
  plug fed in by feel goes there first, onto the board's bare underside. Reset is 1.6 mm from the socket's shell.
- 232 mm2 of the board's free underside is the bay's ceiling: any part put there is exposed to fingers and plug tips.
- Fix: (1) a guide plate across the bay just under the socket's mouth (z ~96.1-97.3, 1.2 thick) with a 9.0 x 3.2
  hole, chamfered 0.8 underneath. It lies wholly below the mouth, so the socket still passes over it as the chassis
  slides in; it prints as a wall standing on the bed. It guides the tongue (which is standard, unlike overmoulds),
  closes the ceiling and takes side loads at the tongue's root instead of at the solder. GCT's mating view appears
  to leave ~1.58 mm between receptacle face and overmould; verify that figure before relying on it (PLAUSIBLE).
  (2) If not the plate: raise the floor to z 96.8 with a 10.5 mm notch for the socket's path, and add side cheeks.
  (3) Move Reset and Boot >= 6 mm from the socket, or behind the plate with 2.5 mm pin holes.
  (4) Make the cable catch real (the two strap slots are placeholders): it is what protects the socket from a yank.

### F4. Sensor path: clear, but most of the light is lost below the skin — CONFIRMED geometry, PLAUSIBLE optics
See section 4. Short form: only 0.4 mm of collar is over the sensor's centre (0 sleeve, 0 chassis), the chip's top is
6.55 mm under the skin, the window fills 0.22 sr of the chip's view (a view factor of 0.068), and the well is walnut
PLA and black PETG. Vishay's own guidance for this part is to put it as close to the cover as possible
([application note](https://www.vishay.com/docs/84323/designingveml7700.pdf)).

### F5. The module's antenna sits 1.0 mm from the HUB75 header — CONFIRMED geometry, PLAUSIBLE effect
- Antenna end at x 22-28, y 40.5-58.5; header at x 26-46.3, y 30.6-39.5: 1.0 mm apart, overlapping in x, with 16
  switching lines and a ribbon. 139 of the header's 181 mm2 lie inside the 15 mm clearance Espressif asks for when
  the antenna cannot overhang the base board
  ([Espressif module-placement guidance](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s2/pcb-layout-design.html);
  that page is the S2's, the S3 guide carries the matching keep-out figure).
- The panel is not the problem: antenna 12.15 mm behind the housing, 24 mm behind the LED board, no worse than V6.
- Fix: nothing limits the board on the left (BX0 = 22 is only "left of the module"). Extend it ~18 mm left and let
  the antenna end overhang or sit in a copper-free zone, or turn the module so the antenna is at the back-left
  corner (y 53.5-59.5), and move the header right. Move the panel power connector next to the USB socket: as drawn,
  3-4 A crosses 40 mm of board past the encoder to get from x 89.6 to x 48.5.

### F6. Module variant and firmware assumptions — CONFIRMED (source)
- `device.cpp` uses GPIO 35, 36 and 37 (D, B, B2). On WROOM-1 modules with octal PSRAM those three belong to the
  PSRAM ([Espressif dev-kit note](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp-dev-kits-en-master-esp32s3.pdf)).
  The module must be a quad-PSRAM one, ESP32-S3-WROOM-1-N8R2 (the firmware uses PSRAM and the 8 MB TinyUF2
  partition table), not the widely stocked N16R8 / N8R8.
- The knob is read through the 5880's seesaw chip over I2C, and the knob light through it too. V7 has no seesaw:
  encoder on GPIO and a directly driven pixel are firmware work, not a pin-map detail.
- The Matrix Portal's status NeoPixel (GPIO 4, used by the double-reset bootloader cue and the Status LED section)
  and Up/Down buttons are not on the V7 part list. Buttons are INPUT_PULLUP, so absent is harmless; decide the LED.

### F7. The board cannot be pushed straight up into the collar — CONFIRMED
- The shaft tip (z 127.0 seated) has to start under the top wall (109.3): a 17.7 mm drop. The board's right end then
  sits in the top-right short standoff and its washer (top at 89.15): overlap from a 14.9 mm drop on (`p6_pushup.py`).
  V6's 25.4 mm encoder board never reached x 84. An 8 deg tilt (right end up) clears it.
- Fix: step the board's front-right corner (remove x > 83.5, y < 41.5; nothing is placed there), or fit that
  standoff after the board.
- Also plug the ribbon and power into the board before lifting it: pushing an IDC plug onto the hanging board is
  ~20-30 N at 29.7 mm from the nut, straight through the encoder's solder joints (force PLAUSIBLE, arm CONFIRMED).

### F8. A crush rib presses on the 2.9 mm web beside the light well — CONFIRMED
- Ribs sit at 0, 30 .. 210, 330 deg; the one at 180 deg bears on the walnut web between the knob hole (r 12.0) and
  the well (r 14.9): 2.9 x 4 x 8 mm, loaded across its layers, 0.54 mm3 of interference. `collar.py` already turns
  the ribs on the P4 to keep them off thin walnut.
- Fix: drop the 180 deg rib or set `RIB_PHASE` 15.

### F9. The knob's light reaches the sensor two ways — CONFIRMED paths, PLAUSIBLE size
- The collar is translucent so the pixel lights it; the window is part of the collar. And at board level 92 of 960
  sampled straight lines from the pixel to the sensor package's side are unobstructed (13.1 mm apart, through the
  0.95 mm gap under the top wall; `p8_misc.py`). The package is clear.
- It matters less than it looks: `Board::knob_light()` lights the pixel only while a chooser is open, and the level
  only moves after 5 s. Fix in firmware: ignore readings while the pixel is lit and for one 800 ms integration after.
  Optionally a 1 mm fence on the board between the two slots.

### F10. Smaller items
- Bay floor: 1456 mm2 of bridge, 17.25 x 86.5 mm, CONFIRMED. PETG will do it; the sagged side is the face seen in
  the bay. Haunches of 8 (span 11) cost nothing. Not structural.
- Top wall between the two slots: a finger 6.25 wide x 2.5 thick x 32.5 long, free at the front. Harmless in place
  (0.25 under the sleeve), easy to snap in handling. Stop the sensor slot's width at 3.6, or tie the finger's tip.
- Bay wall top passes 0.5 mm from the encoder's pin block (x 73.5 vs 74.0). Tight for solder fillets; move the wall
  to x 75-77 or put the pin rows on the y sides.
- Right-hand hold-down pad (x 94.5-97.5) sits over the USB4235's stake hole if the 10.00 on its pad sheet is the
  stake pitch (x 84.6, 94.6; PLAUSIBLE); a 0.3 mm solder crown there already touches it (0.08 mm3). Move the pads to x 80 and 99, or use crush ribs (F2).
- Vents: by the repo's own `vent_area()`, V7 2401 mm2 vs V6 2376. No loss. The module does hang 1.5 mm in front of
  ~12 mm of the top louver row, in the warmest air. Fine for an 85 C part.
- Back plate, cleat: the case cleat ends at x 75, the bay opens at 76; wall cleat +/-74.5. No conflict. The bay's
  2 mm wall is a better edge stiffener than the plate it replaces. The right end wall is now a 22 mm flap behind the
  floor, backed by the sleeve 0.25 away. Fine.
- Two-sided assembly: only the sensor and pixel are SMT on top. A reverse-mount pixel (shines through a hole) plus a
  hand-soldered sensor makes it single-sided SMT. Area is not the limit: 949 mm2 of the underside is free (717
  hidden), against perhaps 300-400 needed for shifters, regulator, ESD and passives.
- GCT USB4235: 6.5 mm, vertical, 16-pin, SMT contacts, in-line through-hole stakes, 20,000 cycles: real, stocked at
  DigiKey / Mouser ([DigiKey](https://www.digikey.at/en/product-highlight/g/gct/usb4235-03-c-connector)). In-line
  stakes resist rocking front-to-back least, which is the way the cable pulls here; USB4120 (6.4 mm, four stakes)
  is the stronger choice. LCSC stock not checked. The 10.4 mm figure is GCT's 24-pin USB4225 (8.8 / 10.0 / 10.4).

## 3. The downward-facing USB-C socket: keep it

- Retention under gravity is not a problem. USB-C unmating force is 8-20 N new and 6-20 N after rated life; GCT
  quotes 5-20 N to mate and 6-20 N to unmate for this part
  ([Molex summary](https://dev3.molex.com/content/dam/molex/molex-dot-com/en_us/pdf/datasheets/987651-4081.pdf),
  [GCT drawing](https://farnell.com/datasheets/4415016.pdf)). A 2 m cable weighs well under 1 N (my estimate:
  40-70 g). Margin >= 6x
  with a worn socket. The real risk is a plug not pushed to its click, which the guide plate helps.
- A hanging cable loads the socket along its axis, its strongest direction. A rear-facing socket is levered by the
  cable's weight all the time.
- It is the only direction that hides a 45 mm plug and strain relief: 97 mm of bay height against 26 mm of depth.
  Facing back, the socket's mouth can be no further forward than y ~50; a 30 mm overmould then ends 11 mm past the
  rim and the strain relief 26 mm past it. That shows from the side and cannot hang 8 mm off a wall.
- Wall-mounted: the cable has to move 19.5 mm back (y 53.5 to the middle of the 8 mm gap) over >= 45 mm of drop
  below the strain relief, a ~23 deg lean; the sill is at z 6.75 (tray) and 2.5 (rim). Clear for cables up to
  ~6 mm. You cannot plug or unplug on the wall: lift it off the cleat. On a shelf it needs ~10 mm behind it.
- What to change is in F2 and F3: guide plate, zero-gap support above the board, real cable catch, four-stake
  socket, Reset away from the mouth, ESD parts at the socket.
- Best alternative if he still rejects it: not another direction (up-facing at the bay's bottom needs a second
  board and a 180 deg cable loop ~25 mm wide in a 27 mm bay), but taking the socket off the board: a short
  panel-mount USB-C extension, its jack screwed into a printed block in the bay's ceiling, still facing down, its
  plug into a low horizontal socket on the board. Plug forces then never reach the PCB. Cost: one bought part and
  ~45 mm of plug and bend along x under the board, where there is room.

## 4. The sensor window

Is the path clear? Yes. Straight above the sensor's centre: 0.40 mm collar, 0 sleeve, 0 chassis. 12.2 of the
package's 20.4 mm2 footprint is under the thin skin, 14.0 under the well.

Is 0.4 mm the practical minimum? No. One 0.2 mm first layer is, and this project already prints one:
`panel.py` gives the diffuser face as one 0.2 mm first layer on the 0.4 nozzle, over 192 x 96 mm. The pocket spans
1.6 mm. But the gain is small: for translucent PETG I estimate ~85% through 0.4 and ~92% through 0.2 (PLAUSIBLE).

Is it in the knob's shadow? Partly. The knob (r 15.0, 12.7 tall, 1 mm above the flange, measured from the STL)
blocks 30-43% of the cosine-weighted sky from points on the window (r 16.9 to 15.3; 36% at the centre). All direct
light from the knob's side (within +/-60 deg of +x, i.e. from the right of the case) below about 60 deg elevation is
cut (75 deg straight across the knob).

Where the light goes (`p4_view.py`):

| Change | View factor at the chip | vs now |
|---|---|---|
| As drawn: chip 6.55 under the skin, window 1.6 x 6.7 (10.8 mm2) | 0.068 | 1.0 |
| Window +/-30 deg instead of +/-12 (27 mm2) | 0.108 | 1.6 |
| Chip 4.0 under the skin | 0.148 | 2.2 |
| Chip 2.0 under the skin | 0.344 | 5.1 |
| Flange r 18.5, window r 15.3-17.9, +/-30 deg | 0.174 | 2.6 |

For scale: V6's 2 mm hole gives the chip ~0.047 sr (view factor ~0.015; my hand calculation from `sensor.py`'s
heights). V7 as drawn, with skin and knob losses, is about 2-4x that. So it is plausibly adequate with the firmware's x2 gain / 800 ms setting
(0.0042 lx per count, [Vishay datasheet](https://www.vishay.com/docs/84286/veml7700.pdf)); `DARK_LUX` and
`BRIGHT_LUX` will need retuning.

Changes, in order of what they buy:
1. A hidden light pipe. A 2 mm clear acrylic rod, ~6.3 mm long, standing in the well from 0.15 above the chip to
   0.1 under the skin. Nothing of it shows: the skin covers it (his objection to the 3 mm pipe was that it showed,
   and a stock rod is not a printed one). Glued or stepped into the sleeve; the chassis's sensor slot passes round it.
   Estimated 4-10x (PLAUSIBLE; test on a coupon). Well becomes a 2.2 mm round hole, pocket a 2.4 mm disc at r 16.1.
2. If no rod: make the well reflective. White paint or a 0.45 mm white printed liner in the walnut well and on the
   slot's walls. Estimated ~2x (PLAUSIBLE).
3. Window +/-30 deg: pocket 16.9 mm long, well +/-31.5 deg. 1.6x. Keep the web: 2.9 mm, and see F8.
4. Skin 0.2 mm, one first layer. ~1.1x. Do it because it is free and it is what he asked for.
5. Put the photodiode, not the package centre, at r 16.1. Vishay's note says the sensitive area is not at the
   package's centre; I could not read the offset from the drawing. The window is 1.6 mm wide radially.

Alignment: adequate. Radially the chip can be ~0.45-0.75 mm off (bushing 0.2 in the bore, placement, collar in its
hole) and stays under the 1.6 mm slit. Without crush ribs the collar can sit 0.4 off and the flange still covers the
well by 0.15 (drawn 0.55). Tangential margin 0.42 mm per end, about 1.5 deg of collar turn; the teardrop allows
about that. Rim wall outside the pocket: 0.6 mm, one bead; set the slicer to Arachne walls.

Will it show? Probably (PLAUSIBLE): a 1.6 x 6.7 mm dash, darker than the rest of the ring, at 9 o'clock beside the
knob, because the skin lies over a dark hole and the rest of the flange over walnut. A white liner or the rod makes
it lighter, not invisible. If it bothers him, repeat the pocket as blind dummies at 3 and 12 o'clock so it reads as
a mark. Print the collar coupon before deciding.

## 5. Checks in v7.py that I could not reproduce, or that test the wrong thing

- All 22 rows reproduce (PASS). My 0.25 mm-step sweep (0.25-75 mm) also finds no hit; the coarse steps hid nothing.
- "board turned 1 deg ... (fin and fence stop it)" is called with `ok=True` hard-coded. It cannot fail.
- "chassis / parts on top of the board" and the slide check are vacuous for through-hole parts: tails are not in
  `board_parts()` (F1).
- "a 16 x 9 plug, seated" and "wall cleat / ... plug": `plug()` ends the cable at z 12, inside the bay. The cable's
  way out is never modelled, and the wall cleat (|x| < 74.5) can never meet a plug at x 81.6-97.6.
- "board 0.3 lower / higher" shows the stops exist. It says nothing about whether the board can get between them.
- No check covers the board's own way in (F7).
- `window_report` gives `flange_land_outside_well` 0.55 without the collar's 0.4 clearance (0.15 worst case), and
  probes plastic only over the sensor's centre.
- `FLOOR_TOP` is set from `USB_H_MAX` (10.4), not the socket drawn (6.5): that is the 11.1 mm gap in F3.

## 6. What I did not check

- Anything electrical: schematic, routing, layer count, power integrity at 3-4 A, the regulator's dissipation.
- Optical transmission of the actual filament; every optics number above except the geometry is an estimate.
- The VEML7700-TT's sensitive-area offset and its mounted height (2.35 taken from RS's listing; Vishay's own sheet
  gives 6.8 x 2.35 x 3.0 for the side-view reference).
- The USB4235 drawing's dimension labels (stake length, recommended board thickness, the 1.58 mm mated gap).
- An actual encoder part and its body height; a real ribbon's fold from the header to the panel at x -63.
- LCSC / JLCPCB stock of any part. Thermal behaviour. Wi-Fi range.
- Printing anything. I did not re-run the renders. The 128-wide and P4 builds are out of scope.
