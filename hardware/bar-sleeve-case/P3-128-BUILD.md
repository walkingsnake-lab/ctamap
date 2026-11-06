# CTA LED Board: 128 x 32 Bar, P3 (shell, Nov 6, 2026)

The v5 drawer bar sleeve for **two Waveshare P3 64x32 panels side by side** (128 x 32, 384 x 96 mm of LEDs), in parts
that fit the X2D's 256 x 256 mm bed. This sheet covers the **shell and its joint**; the trays, diffuser and splice plates
are the next step (see [Still to build](#still-to-build)). Started fresh from the single P3 v5 shell
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

## Checks (`src/meshcheck.py`)
Every STL was checked the way Bambu Studio trips: welded as float32, watertight, consistent winding, no edge shared by
more than two faces, no duplicate or zero-area faces, one body; then sliced layer by layer (0.16 mm for the shells, 0.12
for the tenons) with each layer's polygons validated and anything thinner than one solid line (0.6 mm) and longer than a
corner facet (3 mm) listed for review (a 45° chamfer's last layer is one, harmlessly); the proven single v5 shell passes the same check (its thinnest real features are the 0.8 mm
wall behind the S3's edge buttons and the last layer of the bottom lip's chamfer). Both halves, the collar, the tenons
(at 0.5: their rib crests are one 0.6 mm line by design) and the coupons pass. Run it on any regenerated part:
`python3 meshcheck.py ../stl/p3-128x32/*.stl --layer 0.16`.

## Before printing the shell: the seam coupon (`stl/p3-128x32/coupons/`)
`coupon-p3x2-seam-A-walnut.stl` + `-B-walnut.stl` (walnut, as exported: the cut face on the bed, hood up; **5 mm brim**,
they stand 37 mm on a 6 mm edge) + `coupon-p3x2-tenon-0.45 / 0.55 / 0.65.stl` (PETG, flat as exported, ribs up; 1 / 2 / 3
notches on the front edge). Each coupon is 20 mm of its half's top wall across the joint: hood, front rim, V-groove and the
front pocket. Push a tenon into A, then B onto it:
- The one that goes home with a firm hand push and holds the halves flush (no step on the top or the front) is `RIB_H`.
  Rattles: the next size up; needs a mallet or the skin whitens: the next size down.
- If even 0.45 won't start, the pocket printed undersize: measure it; `SLOT` can grow, or `TEN_T` shrink, in `p3x2.py`.
- Check the V-groove reads evenly across the joint, and that the seam blobs landed in the pocket mouths (chamfered) or on
  the inside, not on the outer face.
Then rebuild with the pick: `RIB_H=<h> python3 p3x2.py ../stl/p3-128x32` and reprint the tenons only.

## Parts (`stl/p3-128x32/`)
| Part | File | Material | Print |
|---|---|---|---|
| Shell, left / right | `p3x2-shell-A-walnut-backdown.stl`, `p3x2-shell-B-walnut-backdown.stl` | PLA Wood | back rim down, both on one plate (same spool); ~10 mm to the plate's edges, 5 between them: **3 mm brim** or brim ears |
| Tenons (4) | `p3x2-tenon.stl` | black PETG | flat, ribs up, as exported; 0.12 mm layers |
| Encoder collar | `p3x2-encoder-collar.stl` (the v5 collar with a 4.9 mm plug for the 5 mm wall) | translucent PETG, 100% infill | flange-top down |
| Coupons | `coupons/` | as above | as exported |

Shell print settings: as the single v5 shell (Bambu PLA Wood, dried, 4 walls, elephant foot 0.15, glue stick, bed 55-60 °C,
door closed) but **fixed 0.16 mm layers, no variable layer height** (it banded the P2.5 halves differently), seam
**Aligned** and scarf off: the sharpest inside corners on every layer at the joint are the pocket mouths, which are
chamfered for a blob; set the seam to the back corner away from the joint if Preview shows it elsewhere.

## Assembly (joint only)
Press the four tenons into one half's pockets (ribs toward the outside of the case or the inside, either way: both faces
are flat skins), then push the other half on until the end faces meet. The fronts line up on the pockets' ends and the
faces on the skins; lap the front flat across the joint as the single shell. Optional: a thin film of CA on the tenons
before the second half goes on makes it permanent.

## Still to build
- **Trays:** one per panel, cut at the joint (no end wall there), as the P2.5 bar: tray B = the v5 P3 tray with the
  encoder slot and rails at `ENC_X` +66 (knob +162 less panel B's centre) and the sensor sled hooks at +26; tray A =
  `drawer.tray(s3=False, controls=False)`. Inner posts on splice plates.
- **Diffuser:** one per panel, split on the joint rib (P3 rib 0.6 at a 3 mm pitch; A owns the joint rib, `JOINT_RIB`
  wide); a joint coupon picks its width.
- **Splice plates** on the panels' inner corner inserts (x ±8.75, z +31 / -29 after the 180° turn: the P3's inserts are
  not symmetric top and bottom, so A's and B's plates differ in z).
- Wall cleat, print plates (3MF) if wanted, firmware `cols: 128` as the P2.5 bar.
