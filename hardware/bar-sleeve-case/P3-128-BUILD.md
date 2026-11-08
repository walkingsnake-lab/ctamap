# CTA LED Board: 128 x 32 Bar, P3 (build sheet, Nov 6, 2026)

The v5 drawer bar sleeve for **two Waveshare P3 64x32 panels side by side** (128 x 32, 384 x 96 mm of LEDs), in parts
that fit the X2D's 256 x 256 mm bed: a walnut shell in two halves joined by PETG tenons, one black PETG tray per panel,
one two-colour diffuser per panel, two splice plates joining the panels, one long wall cleat. Everything not covered here
is the single P3 v5 build ([README](README.md): hardware, print settings, finishing, assembly, service). Started fresh
from the single P3 v5 shell
([README](README.md)), not from the P2.5 bar: its tongue-and-groove joint lived in 1.0 mm skins and a 1.3 mm tongue in
the walnut, and the first print stepped, blobbed at the seam and sliced with gaps. Source: `src/p3x2.py` (+ the `p3x2`
profile in `src/panel.py`); STLs: `stl/p3-128x32/`; renders: `img/p3x2-*.png`. Nothing here has been printed yet.

**Case:** 414 x 115.3 x 69 mm (W x H x D) at a **5.0 mm wall** (v5: 3.5). Bore 404 x 105.3, the same 10 mm bezel at the
ends and 4.65 top and bottom as the single P3, so the v5 tray, diffuser and collar fits don't move; the case is 1.5 mm
bigger per side. Panel A is the left one seen from the front, B the right one.

## Decisions
- **Split left/right at x = 0**, the panel joint, into two U-shaped halves (the shell is a ring, so every piece needs an
  end wall; a third piece would only add a second visible seam off the panel joint). Each half is 207 x 115.3 back-down,
  69 tall: both fit one plate (side by side along the plate's y, 230.6 of 256).
- **Wall 5.0 mm** so the joint lives inside it with nothing thin: `SKIN | SLOT | SKIN` = **1.5 | 2.0 | 1.5** (a skin is
  three 0.42 mm lines; the P2.5's were 1.0, two lines). The thicker wall also stiffens a 414 mm bar: the P2.5 halves
  bowed enough to step at the seam. Cost: ~70 g more walnut per half, and the floor is 1.5 thicker under the two screws
  from below (M3 x 12 instead of x 10, or thread the x 10s in less).
- **Joint: loose PETG tenons in pockets.** The walnut only gets **pockets**: 2.0 wide across the wall, 12 mm deep into
  each half from the joint face, 20 mm long along the depth, two per wall (top and bottom), front (y 14.5-34.5, behind the
  screen face) and back (y 46.5-66.5, 2.5 in front of the back face). Pure subtraction from a thick wall, so printed
  back-down the pocket is a vertical channel with no lip, no stepped reveal and no bridge wider than its 2 mm end.
  Separate **PETG tenons** (`p3x2-tenon.stl`, 23.5 x 19.7 x 1.6 + ribs) bridge the halves: a flat bar that fills the
  pocket's length less 0.15 a side (so the fronts can't step) and is held on both faces by the skins (so the tops can't
  step). **Crush ribs** on one face, three trapezoids (1.4 base, 0.6 crest, `RIB_H` tall, ramped out over 2 mm at each
  end) running along the push direction, in PETG, where ribs work, not in the walnut: the flat face bears on one skin,
  the ribs crush against the other. The tenon is 0.25 short of the two pockets' combined depth at each end, so the halves'
  end faces are the seat in x and the seam closes on walnut. Glue is optional.
- **Seam blobs:** the pocket mouths are chamfered 0.5 x 45° at the joint face (a blob there has room and can't foul the
  tenon). Outside, every visible edge at the joint has a **0.5 x 45° chamfer each side** (a V-groove round the case,
  cut in 0.1 mm bands) instead of a stepped reveal: no thin ledge for a blob to pile on, and the line reads as deliberate
  after lapping and oil.
- **Knob at x +162** (45 mm from the right end, over tray B; its encoder board, 25.4 wide, clears tray B's top-right
  corner post at x 183.25 by ~1 mm), light sensor at +122 (40 mm toward the centre), USB-C at the right end. Screws from
  below at ±50 / ±142 (each tray's own ±46), feet at ±180. `KNOB_X=96` builds the stock-tray version (knob over panel
  B's centre, tray B = the single v5 tray unchanged).
- **Trays: one per panel, cut at the joint** (no end wall there: the panels fill it), 0.3 mm apart. Tray B is the v5 P3
  tray (S3, status window, Boot, USB-C slot) with the controls under the knob: encoder slot and rails at +66 in its own
  frame, the sensor sled 40 mm toward the centre (its hooks and front screw moved with it). Tray A is the same tray with
  no S3 and no controls. **Panel A sits in its normal orientation, B turned 180°** (the P2.5 bar's data chain: S3 → A's
  inner header, A's outer header → B's inner one; B's outer header is under the S3 and unused), so tray A's posts sit at
  the un-turned inserts (z +31 / −29) and tray B's at the turned ones (z +29 / −31). Each tray bolts to its two outer
  corner inserts and takes its pair of screws from below; the **inner posts stand on the splice plates**, solid and
  closed at the back, a pocket round each plate screw's head (they push, they don't bolt).
- **The 5 mm wall and the encoder:** the encoder hangs from the case top (collar deck 1.4 under it), so the thicker wall
  raised the case top 1.5 mm over the tray and the encoder board (hung from the top) landed 0.05 mm *into* tray B's top
  wall. Fix: a 1.2 mm recess into that wall's inner face over the board, out to the rails' outer faces (1.3 mm of wall left
  there, the board 1.15 mm clear); the rails hang from the recess roof and lap the board 0.75 mm as before. (A first
  version cut the recess downward and took the rails with it; an independent audit of the STLs caught it.) Lowering the collar's deck instead would have left the
  M7 nut too little thread.
- **Tray B's top crush ribs:** the rib at +28.3 would have crossed the sensor hole and the sled screw's counterbore, the
  one at +70.7 is under the knob slot; both are dropped and one added at +45, between the counterbore and the slot.
- **Diffuser per panel, split at the panel joint** on the rib that falls there (every rib sits at a 3 mm pitch from the
  left edge, so x = 0 is a rib centre). No skirt on the seam edge. A owns the joint rib, `JOINT_RIB` wide (0.6 = a normal
  rib, the default: panels butted tight; 0.8 / 1.0 cover a gap between them, and B's assembly then sits that much
  further right, which the splice slots and the bore's 0.3 mm allow); B starts a half rib (0.3) past its panel's edge.
  0.4 nozzle, 0.2 face, as the single P3 diffuser.
- **Splice plates** (PETG, 29.5 x 14 x 2) on the panels' inner corner inserts (x ±8.75), screwed on first (M3 x 6 button
  heads): a round hole on A's insert, a slot (±0.5 in x) on B's, so the plates hold the rows in line across the seam
  while the panels butt freely. Because of the orientations above, B's hole sits **2 mm lower** than A's on both the top
  and bottom plate: one plate, used twice the same way up (notch toward the top).
- **Wall mounting (optional):** a case cleat per tray (the shared `bar-cleat-case.stl`) and **one wall cleat, 220 mm**
  (`p3x2-cleat-wall.stl`: it spans x ±110, catching 89 mm of each 150 mm case cleat, and lies flat on the plate; a
  full-span one would be 341 mm and not fit even at 45°). Three wall screws, at ±95 and the centre.
- **The same parts round two P2.5 panels:** `stl/p25x2-128x32/` (`p25x2-*.stl`, built by `WIDE=p25x2 python3 p3x2.py`):
  case 350 x 99.3 x 69 at the same 5 mm wall and joint, panels at ±80, symmetric inserts so the splice plates have no
  offset, 0.45 ribs and a **0.2 face printed on the 0.4 nozzle**, knob at +123 (50 mm from the end; only the
  encoder's left-hand socket is reachable there, as the P2.5 bar found), screws from below ±34 / ±126, feet ±148. It
  supersedes `bar128.py`'s tongue-and-groove bar (`stl/p25-128x32/`): the P2.5's thin skins were the joint's failure,
  not the panel; the same checks pass for this set. Renders: `img/p25x2-*.png`.
- **P2.5 diffuser on the 0.4 nozzle (Nov 7):** the single P2.5 diffuser moved to the 0.2 nozzle (0.14 face) because
  0.45 ribs are one bead on a 0.4 and printed wavy. On the 0.2 the two halves take ~12.5 h. A 0.4 coupon with Flow Dynamics
  calibrated and the grid slowed came out close: continuous ribs, but cells slightly uneven and soft-cornered.
  Judged good enough for the time saved, so the pair's diffusers have a 0.2 face for the 0.4 nozzle (`DIFF_FACE`, default
  0.2). For crisp squares instead: `DIFF_FACE=0.14 WIDE=p25x2 python3 p3x2.py <outdir>` and print on the 0.2 nozzle at
  0.14 mm layers (~9 h).
- **Diffuser seat (Nov 7):** the v5 rim is a 45° V whose back slope holds the diffuser's flange by 0.3 mm (flange 0.3
  clear of the bore, bevel 0.6). That's a wedge: pushing the diffuser forward pushes the walls outward, and the bar's
  175 mm wall spans (end wall to the seam joint) bow 0.3 mm under a thumb, so the diffuser pushed through the rim on the
  first P2.5 shells. Now, for the bars only (`case2.set_seat`; the single shell is unchanged): rim **1.5** in from the
  bore (was 1.2 visible), seat **55°** (outward force 0.70× the push; a 55° overhang back-down, which walnut prints
  clean at 0.16), the diffuser's bevel **0.2**: overlap 1.0 mm. Rough pop-through, wall as a beam: ~3 N before, ~14 N
  now, ~23 N with solid walls, so **print the shell halves with 6 walls** (solid 5 mm, ~40 g more walnut). A groove
  behind the rim (overlap 1.9, ~22/36 N, the diffuser slid in from the seam end before the halves are joined) is in the
  code (`GROOVE`) but not used: it changes the assembly order.
- **Diffuser skirt fit (Nov 7, testing):** the first rescaled P2.5 half measured 80.2 inside the skirts on a 79.9 mm
  panel, with the single build's one 0.2 bump on the bottom skirt: 0.3 of slack, no snap. The pairs' diffusers now have
  **0.3 mm bumps on the top skirt too**, the bottom and the outer end (`DIFF_BUMP`; the single diffuser is unchanged).
  Not yet confirmed on a print.
- **PETG shrink in the diffuser halves (Nov 7):** the first P2.5 pair's black grid (generic black PETG) printed 0.45%
  small (88.3 mm on 88.7 tall). Each half is located in x by its outer skirt only, so against its panel's outer edge
  the seam edge sat ~0.8 mm short (a dark line at the seam, B's first LED column half uncovered, B's rib ends showing as
  a comb), and the top/bottom skirts came out narrower than the 79.9 mm panel, perched on its edges and fell off. The
  diffuser halves and their joint coupon are now built 0.45% larger in x and y (`DIFF_SHRINK`, z untouched), both
  pairs; the fit check shrinks them back before testing. `DIFF_SHRINK=0` for a PLA grid. Measure a printed half (P2.5:
  88.7 tall; P3: 104.7) and adjust if yours differs.

## Checks (`src/meshcheck.py`, `src/check_p3x2.py`)
Every STL was checked the way Bambu Studio trips: welded as float32, watertight, consistent winding, no edge shared by
more than two faces, no duplicate or zero-area faces, one body; then sliced layer by layer (0.16 mm for the shells, 0.12
for the tenons) with each layer's polygons validated and anything thinner than one solid line (0.6 mm) and longer than a
corner facet (3 mm) listed for review (a 45° chamfer's last layer is one, harmlessly); the proven single v5 shell passes the same check (its thinnest real features are the 0.8 mm
wall behind the S3's edge buttons and the last layer of the bottom lip's chamfer). Both halves, the collar, the tenons
(at 0.5: their rib crests are one 0.6 mm line by design), the splice plates, the cleat, the sled and the coupons pass.
The trays pass too, after the same cleanup every export gets (vertices welded at float32 precision, the sliver
triangles that collapse in that rounding dropped: they are what the P2.5 bar's "parts touch themselves along an edge"
were, and the printed v5 tray's STL still has them). The four diffuser files each keep one zero-area (collinear)
triangle on the white/black split face, as the single P3 diffuser does; a slicer drops it. Run it on any regenerated
part: `python3 meshcheck.py ../stl/p3-128x32/*.stl --layer 0.16`. It also lists, per file in its print orientation, every
downward patch steeper than 45° off the bed and every bridge over 6 mm: on these parts all of them are the single
build's own (the USB-C opening and the sensor pinhole in the shell; the ribbon hook lips, the sensor socket channels
and the tie loop in the tray), printed and fine; nothing new (pockets, V-groove, recess, open posts, split diffuser)
needs support.

`src/check_p3x2.py <outdir>` is the fit check (run after `p3x2.py <outdir>`): overlaps between every pair of parts that
should only touch (the only ones are the intended crush ribs, post feet and tenon ribs), the shell/tray positions that
have to line up (knob, sensor, USB-C, the four screws from below), the splice screw heads inside the inner posts with the
tray 0.7 mm off any way, the encoder's QT plugs with tray B seated and sliding in, and the bed fit of every file. All
pass; both of the encoder's sockets are usable.

## Before printing: the coupons (`stl/p3-128x32/coupons/`)
1. **Seam** (gates the shell): `coupon-p3x2-seam-A-walnut.stl` + `-B-walnut.stl` (walnut, as exported: the cut face on the bed, hood up; **5 mm brim**,
they stand 37 mm on a 6 mm edge) + `coupon-p3x2-tenon-0.45 / 0.55 / 0.65.stl` (PETG, flat as exported, ribs up; 1 / 2 / 3
notches on the front edge). Each coupon is 20 mm of its half's top wall across the joint: hood, front rim, V-groove and the
front pocket. Push a tenon into A, then B onto it:
- The one that goes home with a firm hand push and holds the halves flush (no step on the top or the front) is `RIB_H`.
  Rattles: the next size up; needs a mallet or the skin whitens: the next size down.
- If even 0.45 won't start, the pocket printed undersize: measure it; `SLOT` can grow, or `TEN_T` shrink, in `p3x2.py`.
- Check the V-groove reads evenly across the joint, and that the seam blobs landed in the pocket mouths (chamfered) or on
  the inside, not on the outer face.
2. **Diffuser joint:** `coupon-p3x2-diffuser-joint-white.stl` + `-black.stl` (one object, two parts, same frame; 0.4
   nozzle, 0.2 first layer, as the diffuser; the P2.5's too): three A pieces with joint ribs 0.6 / 0.8 / 1.0 (P2.5: 0.45 /
   0.6 / 0.75) (1 / 2 / 3 notches in the
   flange edge) and one B piece, 6 columns either side, bottom edge included. Butt the panels, hold an A and the B at the
   bottom of the joint, panel lit and dark. The width whose seam column looks like the others is `JOINT_RIB`; prefer the
   narrowest that hides the seam (a wider one moves B's assembly right by the difference).
3. **Splice plates:** `coupon-p3x2-splice-plates.stl` (PETG, flat): holes 3.3 / 3.45 / 3.6 (1 / 2 / 3 notches). With the
   panels butted face down, A in its normal orientation and B turned, round hole over A's inner corner insert, slot over
   B's (the slot end is the lower one), 2 x M3 x 6 button heads. Use the snuggest an M3 passes through freely
   (`SPLICE_HOLE`). Also check it sits flat on both bosses and the rows still line up with it tightened.
Then rebuild with the picks: `RIB_H=<h> JOINT_RIB=<w> SPLICE_HOLE=<d> python3 p3x2.py ../stl/p3-128x32` (one left out
goes back to its default) and reprint what changed.

## Parts (`stl/p3-128x32/`)
| Part | File | Material | Print |
|---|---|---|---|
| Shell, left / right | `p3x2-shell-A-walnut-backdown.stl`, `p3x2-shell-B-walnut-backdown.stl` | PLA Wood | back rim down, both on one plate (same spool); ~10 mm to the plate's edges, 5 between them: **3 mm brim** or brim ears |
| Tenons (4) | `p3x2-tenon.stl` | black PETG | flat, ribs up, as exported; 0.12 mm layers |
| Tray, left | `p3x2-tray-A.stl` | black PETG | back face down, walls up; the v5 tray's settings |
| Tray, right | `p3x2-tray-B.stl` + `p3x2-tray-B-window.stl` (one object, two parts, same frame) | black PETG + translucent PETG | as the v5 tray |
| Diffuser, left / right | `p3x2-diffuser-A-white.stl` + `-A-black.stl`; same for B (one object, two parts per half) | white + black | face down, 0.4 nozzle, 0.2 first layer = the face; both halves fit one plate. P2.5 pair: the same, plus (Bambu Studio names) Quality > Wall generator: Classic; Strength > Detect thin wall: on (one bead per 0.45 rib; greyed out under Arachne); Speed > Outer wall and Gap infill 35 mm/s, Speed > Acceleration > Outer wall 2000; Flow Dynamics Calibration run for the black filament (Bambu's pressure advance) |
| Splice plates (2) | `p3x2-splice-plates.stl` | PETG | flat |
| Encoder collar | `p3x2-encoder-collar.stl` (the v5 collar with a 4.9 mm plug for the 5 mm wall) | translucent PETG, 100% infill | flange-top down |
| Light-sensor sled (optional) | `p3x2-sensor-sled.stl` | PETG | plate down |
| Wall cleat (optional) | `p3x2-cleat-wall.stl` (one, 220 mm) + two shared `bar-cleat-case.stl` | PETG | wall face down, flat |
| Knob, Boot key | the shared `stl/bar-knob.stl`, `stl/bar-boot-key.stl` | as the README | as the README |
| Coupons | `coupons/` | as above | as exported |

Shell print settings: as the single v5 shell (Bambu PLA Wood, dried, **6 walls** (solid), elephant foot 0.15, glue stick, bed 55-60 °C,
door closed) but **fixed 0.16 mm layers, no variable layer height** (it banded the P2.5 halves differently), seam
**Aligned** and scarf off: the sharpest inside corners on every layer at the joint are the pocket mouths, which are
chamfered for a blob; set the seam to the back corner away from the joint if Preview shows it elsewhere.

## Hardware (beyond the single build's)
- Screws: the single build's per tray, less the two inner post screws each (the splice plates' 2 x M3 x 6 button heads
  take those inserts); 2 x M3 x 12 from below per tray (the 5 mm floor); 4 x M2.5 x 8 (S3, tray B only).
- Panels: two P3s, butted; both their power cables (one stock lead reaches only its own panel: parallel them at the S3's
  screw terminals, or use one lead with both plugs if the kit has it).
- Ribbons: S3 → A's inner header (x −33 from the S3's IDC at ~+142: ~20 cm plus drops) and A's outer header (−159) →
  B's inner one (+33): ~25 cm. Two 30 cm 16-pin ribbons.
- STEMMA QT: S3 → sensor 20 cm, sensor → encoder 15 cm; or one 30 cm S3 → encoder without the sensor. Either encoder
  socket works at this knob position.
- Hung on a wall: 3 x #8 / 4 mm countersunk wood screws or anchors (the wall cleat); each case cleat takes 2 x M3 x 10
  into its tray's bosses, as the README.

## Assembly
The single build's order per half, with the joint and the splice first:
1. **Shell:** press the four tenons into one half's pockets (ribs toward the outside of the case or the inside, either
   way: both faces are flat skins), then push the other half on until the end faces meet; the fronts line up on the
   pockets' ends and the faces on the skins. Optional: a thin film of CA on the tenons first makes it permanent. Lap the
   front flat across the joint, finish, bumpers, collar.
2. **Panels, on the bench, face down:** A in its normal orientation, B turned 180° (both boards' data arrows beside the
   headers point away from the joint), butted. Splice plates on the inner corner inserts, round hole on A, slot on B,
   notch toward the top, 2 x M3 x 6 each, snug. Check the rows line up across the seam, lit.
3. **Diffusers** snap onto their panels (A's carries the joint rib). Ribbons into A's inner header (from the S3) and from
   A's outer header to B's inner one; power leads.
4. **Panels in** from the back, together, until both flanges seat on the rim. Encoder up into the collar from inside, as
   the single build.
5. **Tray A** (plain) in on the left, pushed fully forward; its two outer post screws loosely. **Tray B** on the right the
   same way, S3 and sensor cabled on the bench as the single build, encoder cable plugged before it goes in. The inner
   posts land on the splice plates by themselves. Snug the four outer post screws, then the four from below.
6. Firmware: `cols: 128`, panel B upside down (the P2.5 bar's per-panel rotation).

## Still to do
- Print plates (3MF) if wanted (`plates128.py` shows how; Bambu Studio 2.08.03+ keeps their per-object settings).
- The underside label recesses (`marks.py`) are not on these shells.
- First prints: the three coupons, then the shell. The trays and diffusers don't depend on the coupon picks except
  `JOINT_RIB` (diffuser A) and `SPLICE_HOLE` (the plates).
