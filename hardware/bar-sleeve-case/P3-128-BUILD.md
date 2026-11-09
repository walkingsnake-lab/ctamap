# CTA LED Board: 128 x 32 Bar, P3 (build sheet, Nov 6, 2026; revised Nov 8 after the first P2.5 pair)

The v5 drawer bar sleeve for **two Waveshare P3 64x32 panels side by side** (128 x 32, 384 x 96 mm of LEDs), in parts
that fit the X2D's 256 x 256 mm bed: a walnut shell in two halves glued together over two PLA joint plates, one black
PETG tray per panel, one two-colour diffuser per panel, two splice plates joining the panels, one long wall cleat. Everything not covered here
is the single P3 v5 build ([README](README.md): hardware, print settings, finishing, assembly, service). Started fresh
from the single P3 v5 shell
([README](README.md)), not from the P2.5 bar: its tongue-and-groove joint lived in 1.0 mm skins and a 1.3 mm tongue in
the walnut, and the first print stepped, blobbed at the seam and sliced with gaps. Source: `src/p3x2.py` (+ the `p3x2`
profile in `src/panel.py`); STLs: `stl/p3-128x32/`; renders: `img/p3x2-*.png`. The P2.5 pair (below) was printed and
assembled once (Nov 7, with the Nov 6 tenon joint and the 45° seat); this revision is what that print taught.

**Case:** 414 x 115.3 x 69 mm (W x H x D) at a **5.0 mm wall** (v5: 3.5). Bore 404 x 105.3, the same 10 mm bezel at the
ends and 4.65 top and bottom as the single P3, so the v5 tray, diffuser and collar fits don't move; the case is 1.5 mm
bigger per side. Panel A is the left one seen from the front, B the right one.

## Decisions
- **Split left/right at x = 0**, the panel joint, into two U-shaped halves (the shell is a ring, so every piece needs an
  end wall; a third piece would only add a second visible seam off the panel joint). Each half is 207 x 115.3 back-down,
  69 tall: both fit one plate (side by side along the plate's y, 230.6 of 256).
- **Wall 5.0 mm, printed solid** (6 walls). A 414 mm bar's top and bottom walls flex far more than the single's 192: the
  first pair's diffuser pushed through the rim under a thumb and the shell gave under a twist. Cost: ~70 g more walnut per
  half than a 3.5 wall, ~40 more again for solid, and the floor is 1.5 thicker under the two screws from below (M3 x 12
  instead of x 10, or thread the x 10s in less).
- **Joint: two glued joint plates (Nov 8).** Inside the top and bottom walls a **rebate** 100 mm long straddles the seam,
  1.3 deep (plate 1.2 + 0.1), from y 14 (behind the rim's seat) to 63 (in front of the back rim) on top and to 55 on the
  bottom (short of the screws from below). A flat **PLA plate** (`p3x2-joint-plate-top.stl` 100 x 49 x 1.2,
  `-bottom.stl` 100 x 41) lies in each, half in each shell half, its face 0.1 below the bore so the trays never touch it,
  **glued to both halves** (PLA to PLA: ~49 + 41 cm²). The plate locates the halves up/down (the rebate floor) and
  front/back (the rebate's square back end; its front end slopes 45° so it prints as a pocket in a vertical face without a
  roof), and carries the seam's shear and tension over that area. The end faces are glued as well. **Permanent:** the
  shell is a ring serviced from the back (trays, panels, diffusers), never opened.
  Why not the Nov 6 tenons: the finished P2.5 pair still split at the seam under a twist, with everything screwed down.
  The seam runs only through the top and bottom walls (~12 cm² of end face), the four 20 mm PETG tenons sat in their
  pockets with clearance, CA on PETG in wood PLA did not hold, and the inside chain (tray → panel → splice plates → panel
  → tray) has the splice slot's ±0.5 of play in it: two stiff boxes on a floppy link. Bowtie keys were considered and
  dropped (they stop pull-apart, not twist).
- **Seam faces hollowed:** each half's end face at x = 0 is relieved **0.3 mm** except a **2 mm land** along the visible
  edges (outside, front rim, back rim), the woodworker's hollow joint: two not-quite-flat printed faces still close at
  the edge you see, and the glue has somewhere to sit. Outside, every visible edge at the joint has a **0.5 x 45° chamfer
  each side** (a V-groove round the case, cut in 0.1 mm bands): no thin ledge for a seam blob to pile on, and the line
  reads as deliberate after lapping and oil.
- **Label recesses:** the single shell's two underside recesses (`marks.py`: regulatory label 1 x 2 5/8 in, setup sticker
  1/2 x 1 3/4 in) are on half B, centred on panel B (x 38-154, in front of the screws from below, inside the feet).
- **Knob at x +162** (45 mm from the right end, over tray B; its encoder board, 25.4 wide, clears tray B's top-right
  corner post at x 183.25 by ~1 mm), light sensor at +122 (40 mm toward the centre), USB-C at the right end. Screws from
  below at ±50 / ±142 (each tray's own ±46), feet at ±180. `KNOB_X=96` builds the stock-tray version (knob over panel
  B's centre, tray B = the single v5 tray unchanged).
- **Trays: one per panel, cut at the joint** (no end wall there: the panels fill it), 0.3 mm apart. Tray B is the v5 P3
  tray (S3, status window, Boot, USB-C slot) with the controls under the knob: encoder slot and rails at +66 in its own
  frame, the sensor sled 40 mm toward the centre (its hooks and front screw moved with it). Tray A is the same tray with
  no S3 and no controls. **Panel A sits in its normal orientation, B turned 180°** (the P2.5 bar's data chain: S3 → A's
  inner header, A's outer header → B's inner one; B's outer header is under the S3 and unused), so tray A's posts sit at
  the un-turned inserts (z +31 / −29) and tray B's at the turned ones (z +29 / −31). Each tray bolts to all four of its
  panel's corner inserts and takes its pair of screws from below. **Inner posts (Nov 8):** at each inner insert the
  splice plate's M3 x 6 is replaced by an **M3 male-female hex standoff** (brass, **10 mm body**, 5.5 mm across flats,
  6 mm stud: 4 mm into the insert through the 2 mm plate, as the screw it replaces; a 5 mm body's female thread can
  bottom an M3 x 8 before it clamps). It clamps the plate, its top is the
  inner post's seat, and the post screw threads into its female end, so all four posts are bolted and float ±0.7 on
  their screws like the outer ones (the hex top, 6.35 across corners, stays under the floor's bearing ring at that
  offset). Tighten the standoff into the insert first (pliers or a 5.5 mm wrench); the post screw only clamps. The
  first pair's inner posts only pushed on the plates and could be felt moving.
- **The 5 mm wall and the encoder:** the encoder hangs from the case top (collar deck 1.4 under it), so the thicker wall
  raised the case top 1.5 mm over the tray and the encoder board (hung from the top) landed 0.05 mm *into* tray B's top
  wall. Fix: a 1.2 mm recess into that wall's inner face over the board, out to the rails' outer faces (1.3 mm of wall left
  there, the board 1.15 mm clear); the rails hang from the recess roof and lap the board 0.75 mm as before. (A first
  version cut the recess downward and took the rails with it; an independent audit of the STLs caught it.) Lowering the collar's deck instead would have left the
  M7 nut too little thread.
- **Tray B's top crush ribs:** the rib at +28.3 would have crossed the sensor hole and the sled screw's counterbore, the
  one at +70.7 is under the knob slot; both are dropped and one added at +45, between the counterbore and the slot.
- **Diffuser per panel, split at the panel joint** on the rib that falls there (every rib sits at a 3 mm pitch from the
  left edge, so x = 0 is a rib centre). No skirt on the seam edge. **Each half ends in its own wall at the seam**
  (`JOINT_SPLIT`, default; Nov 8), a normal rib wide (the thinnest bead the grid prints), so the joint is two walls, 1.2 mm
  in all, split at x = 0: a gap between the halves falls between two white walls over the dead strip between the panels'
  edge columns and reads as a dark hairline at worst. The first pair had the rib on A only and B's face starting a half
  rib past its edge, so the same gap opened straight over B's first column of LEDs. Cost: the two columns at the seam
  sit in cells a half rib narrower than the rest. `JOINT_SPLIT=0` is the first scheme (A owns the joint rib, `JOINT_RIB`
  wide: 0.6 = a normal rib; 0.8 / 1.0 cover a gap and move B's assembly right by the difference). 0.4 nozzle, 0.2 face,
  as the single P3 diffuser. Once both halves sit right on the lit panels, a dab of CA between the two seam walls makes
  them one piece; they come out together at service anyway.
- **Splice plates** (PETG, 29.5 x 14 x 2) on the panels' inner corner inserts (x ±8.75), fastened first (the hex
  standoffs above, which the inner posts then bolt to): a round hole on A's insert, a slot (±0.5 in x) on B's, so the
  plates hold the rows in line across the seam while the panels butt freely. Because of the orientations above, B's hole sits **2 mm lower** than A's on both the top
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
  **0.3 mm bumps on the top skirt too**, the bottom and the outer end, two per half on each long edge (±40 about the
  half's centre; the single's quarter rule gave one) (`DIFF_BUMP`; the single diffuser is unchanged). Printed: no
  wiggle, but a three-sided half **peels** off from its seam edge, which bumps can't stop; pinching the skirts onto the
  panel held it. So the skirts now bear along their length: **clearance 0.05** (`DIFF_CLR`; opening 80.1, printed
  ~80.0 on the 79.9 panel), bumps 0.2 as lead-in. The single diffuser keeps its 0.15 / 0.2: four sides can't peel.
- **PETG shrink in the diffuser halves (Nov 7):** the first P2.5 pair's black grid (generic black PETG) printed 0.45%
  small (88.3 mm on 88.7 tall). Each half is located in x by its outer skirt only, so against its panel's outer edge
  the seam edge sat ~0.8 mm short (a dark line at the seam, B's first LED column half uncovered, B's rib ends showing as
  a comb), and the top/bottom skirts came out narrower than the 79.9 mm panel, perched on its edges and fell off. The
  diffuser halves and their joint coupon are now built 0.45% larger in x and y (`DIFF_SHRINK`, z untouched), both
  pairs; the fit check shrinks them back before testing. `DIFF_SHRINK=0` for a PLA grid. Measure a printed half (P2.5:
  88.7 tall; P3: 104.7) and adjust if yours differs.

## Checks (`src/meshcheck.py`, `src/check_p3x2.py`)
Every STL was checked the way Bambu Studio trips: welded as float32, watertight, consistent winding, no edge shared by
more than two faces, no duplicate or zero-area faces, one body; then sliced layer by layer (0.16 mm for the shells) with
each layer's polygons validated and anything thinner than one solid line (0.6 mm) and longer than a
corner facet (3 mm) listed for review (a 45° chamfer's last layer is one, harmlessly); the proven single v5 shell passes the same check (its thinnest real features are the 0.8 mm
wall behind the S3's edge buttons and the last layer of the bottom lip's chamfer). Both halves, the joint plates, the
collar, the splice plates, the cleat, the sled and the coupons pass.
The trays pass too, after the same cleanup every export gets (vertices welded at float32 precision, the sliver
triangles that collapse in that rounding dropped: they are what the P2.5 bar's "parts touch themselves along an edge"
were, and the printed v5 tray's STL still has them). The four diffuser files each keep one zero-area (collinear)
triangle on the white/black split face, as the single P3 diffuser does; a slicer drops it. Run it on any regenerated
part: `python3 meshcheck.py ../stl/p3-128x32/*.stl --layer 0.16`. It also lists, per file in its print orientation, every
downward patch steeper than 45° off the bed and every bridge over 6 mm: on these parts all of them are the single
build's own (the USB-C opening and the sensor pinhole in the shell; the ribbon hook lips, the sensor socket channels
and the tie loop in the tray), printed and fine; nothing new (rebates, hollowed faces, V-groove, label recesses, split
diffuser) needs support.

`src/check_p3x2.py <outdir>` is the fit check (run after `p3x2.py <outdir>`): overlaps between every pair of parts that
should only touch (the only ones are the intended crush ribs, into the shell and into the joint plates, and the post
feet; the plates never touch the shells), the shell/tray positions that have to line up (knob, sensor, USB-C, the four
screws from below), the hex standoffs under the inner posts' floors, seated and with the tray 0.7 mm off any way, the
encoder's QT plugs with tray B seated and sliding in, and the bed fit of every file. All pass; both of the encoder's
sockets are usable.

## Before printing: the coupons (`stl/p3-128x32/coupons/`)
1. **Seam** (gates the shell): `coupon-p3x2-seam-A-walnut.stl` + `-B-walnut.stl` (walnut, as exported: the cut face on
   the bed, hood up; **5 mm brim**, they stand 69 mm on a 6 mm edge) + `coupon-p3x2-joint-plate.stl` (PLA, flat: a 60 mm
   plate). Each coupon is 30 mm of its half's top wall across the joint, the full depth: hood, front rim, V-groove,
   hollowed face and the rebate. Lay the plate in A's rebate, bring B on:
- The plate should drop into both rebates and sit flat with the halves butted, a little side play, none up/down. Binds:
  `JP_CL` up (0.15); rattles up/down: down (0.05). Rebuild with it.
- Butted dry, the outside land should close with no visible gap along the top and the front; the hollow inside shows as
  a 0.3 mm slot. If the land doesn't close, find the high spot (pencil on one face, press, look for transfer) and check
  that the seam blobs landed inside, not on the land.
- Then glue the coupon pair as a dress rehearsal (below) and try to break it by hand once cured.
- **The comparison (Nov 8):** the Nov 6 tenon joint is still in the code (`JOINT=tenon`; the plate build also writes
  its set under `*-tenon-*` names): `coupon-p3x2-seam-tenon-A/-B-walnut.stl` (the same 30 mm of top wall, with the two
  pockets instead of the rebate; hollowed faces and V-groove on both) + `coupon-p3x2-tenon-0.45 / 0.55 / 0.65.stl`
  (PETG, flat, ribs up; 1 / 2 / 3 notches; the fit that goes home with a firm push and holds the halves flush is
  `RIB_H`). Glue both pairs the same way (CA or epoxy on the faces; the tenons glued in too), cure, and try to twist
  and pull each apart by hand. Whichever holds is the joint: plates are the default; `JOINT=tenon python3 p3x2.py
  <outdir>` builds the tenon shells (`p3x2-shell-A/-B-tenon-walnut-backdown.stl`, `p3x2-tenon.stl`, print four).
2. **Diffuser joint:** `coupon-p3x2-diffuser-joint-white.stl` + `-black.stl` (one object, two parts, same frame; 0.4
   nozzle, 0.2 first layer, as the diffuser; the P2.5's too): the split pair (A with 4 notches in the flange edge, B with
   1), and the single-rib set: three A pieces with joint ribs 0.6 / 0.8 / 1.0 (P2.5: 0.45 / 0.6 / 0.75) (1 / 2 / 3
   notches) and one B piece (no notch); 6 columns either side, bottom edge included. Butt the panels, hold a pair at the
   bottom of the joint, panel lit and dark. The pair whose seam looks like the rest of the grid is the build's
   (`JOINT_SPLIT`, or `JOINT_RIB` for the single rib; prefer the narrowest single rib that hides the seam, since a wider
   one moves B's assembly right by the difference).
3. **Splice plates:** `coupon-p3x2-splice-plates.stl` (PETG, flat): holes 3.3 / 3.45 / 3.6 (1 / 2 / 3 notches). With the
   panels butted face down, A in its normal orientation and B turned, round hole over A's inner corner insert, slot over
   B's (the slot end is the lower one), 2 x M3 x 6 button heads (the build uses the standoffs; the screws are just for
   the test). Use the snuggest an M3 passes through freely (`SPLICE_HOLE`). Also check it sits flat on both bosses and
   the rows still line up with it tightened.
Then rebuild with the picks: `JP_CL=<c> JOINT_SPLIT=<0|1> SPLICE_HOLE=<d> python3 p3x2.py ../stl/p3-128x32` (one left
out goes back to its default) and reprint what changed.

## Parts (`stl/p3-128x32/`)
| Part | File | Material | Print |
|---|---|---|---|
| Shell, left / right | `p3x2-shell-A-walnut-backdown.stl`, `p3x2-shell-B-walnut-backdown.stl` | PLA Wood | back rim down, both on one plate (same spool); ~10 mm to the plate's edges, 5 between them: **3 mm brim** or brim ears |
| Joint plates (2) | `p3x2-joint-plate-top.stl`, `p3x2-joint-plate-bottom.stl` | PLA (the walnut, or any PLA: hidden; CA bonds PLA to PLA) | flat, as exported; 0.2 layers |
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
**Aligned** and scarf off; paint the seam onto the back corner away from the joint if Preview puts it on the joint face
(a blob on the land would hold the halves apart; one in the hollow is harmless).

## Hardware (beyond the single build's)
- Screws: the single build's per tray (four M3 x 8 flanged button heads for the posts, or M3 x 10 on the inner ones:
  they thread 5-7 mm into the standoffs), 2 x M3 x 12 from below per tray (the 5 mm floor); 4 x M2.5 x 8 (S3, tray B
  only). **4 x M3 male-female hex standoffs**, brass, 10 mm body, 5.5 across flats, 6 mm stud ("M3 x 10+6"; one at each
  inner insert, replacing the splice plates' M3 x 6s).
- Glue: medium (gap-filling) CA or 5-minute epoxy for the shell seam and the joint plates; thin CA for the diffuser seam
  walls. Two straps or tape to hold the halves while it cures.
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
1. **Shell, permanent:** sand both end faces flat on a sheet of 220 on glass until the 2 mm land is bright all round
   (the hollow inside stays matte). Dry fit with both plates in the rebates: the land closes, the fronts are flush. Then
   CA or epoxy on A's half of each plate and on A's land, plates into A's rebates, B's rebates over the plates' other
   halves, B onto A, strap tight, wipe the squeeze-out from the V-groove and the bore. Leave it strapped to cure. Lap the
   front flat across the joint, finish, bumpers, collar.
2. **Panels, on the bench, face down:** A in its normal orientation, B turned 180° (both boards' data arrows beside the
   headers point away from the joint), butted. Splice plates on the inner corner inserts, round hole on A, slot on B,
   notch toward the top; a hex standoff through each hole into the insert, tightened with pliers or a 5.5 mm wrench.
   Check the rows line up across the seam, lit.
3. **Diffusers into the shell first**, from the back, each half pushed forward until its flange seats on the rim (they
   drop straight in: the flange is 0.3 smaller than the bore). Not onto the panels: sliding a panel in with its diffuser
   on dragged the diffuser off at the bore.
4. **Panels in** from the back, together, each snapping onto its diffuser's skirts from behind until the flanges are
   pressed to the rim. Ribbons into A's inner header (from the S3) and from A's outer header to B's inner one; power
   leads. Encoder up into the collar from inside, as the single build.
5. **Tray A** (plain) in on the left, pushed fully forward; its two outer post screws loosely, then its two inner ones
   into the standoffs, loosely. **Tray B** on the right the same way, S3 and sensor cabled on the bench as the single
   build, encoder cable plugged before it goes in. Snug all eight post screws, then the four from below.
6. Once the diffuser seam sits right on the lit panels: a dab of thin CA between the two seam walls, from the back.
7. Firmware: `cols: 128`, panel B upside down (the P2.5 bar's per-panel rotation).

## Still to do
- Print plates (3MF) if wanted (`plates128.py` shows how; Bambu Studio 2.08.03+ keeps their per-object settings).
- First prints: the three coupons, then the shell. The trays and diffusers don't depend on the coupon picks except
  `JOINT_SPLIT` / `JOINT_RIB` (the diffusers) and `SPLICE_HOLE` (the plates).
- Parked: the knob at the left end (mirror; a 50 cm STEMMA QT cable with the sensor beside the knob, or the sensor left
  on tray B as a mid-run relay on 20 + 30 cm); the groove seat (`GROOVE`, a captive diffuser).
