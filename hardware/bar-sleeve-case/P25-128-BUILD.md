# CTA LED Board: 128 x 32 Bar (build sheet, Nov 3, 2026)

The v5 drawer bar sleeve for **two Waveshare P2.5 64x32 panels side by side** (128 x 32, 320 x 80 mm of LEDs), in parts
that fit the X2D's 256 x 256 mm bed. Walnut PLA shell in two halves, one black PETG tray per panel, one two-colour
diffuser per panel, two splice plates joining the panels. Everything else is the single P2.5 build (README, "Other
panels"). Source: `src/bar128.py` (+ the `p25x2` profile in `src/panel.py`), checks: `src/check_bar128.py`; STLs:
`stl/p25-128x32/`. Nothing here has been printed yet.

**Case:** 347 x 96.3 x 69 mm (W x H x D). Bore 340 x 89.3; the bezel shows 10 mm at the ends, 4.65 top and bottom, as the
single P2.5. Panel A is the left one seen from the front, panel B the right one.

Renders (Nov 4, from the model; the screen is a mock 128-wide arrivals layout drawn with the board's fonts):
[front](img/bar128-render-front.png), [back](img/bar128-render-back.png), [seam close-up](img/bar128-render-seam.png).

## Decisions
- **Split left/right at the panel joint.** One piece needs 313 mm even turned 45° on the bed; the P4's top/bottom split
  still needs 279. Halves cut at x = 0 fit flat, both on one plate (177 x 203 with the lap lip).
- **Shell joint = the P4 branch's**, turned 90°: a 1 x 1 mm reveal centred on x = 0 wraps the case (top, bottom, hood,
  front and back rims); the halves meet at its right edge, so the line sits in the groove's shadow. Inside the top and
  bottom walls, half A's inner 1.75 mm runs on 3.5 mm as a lip into a pocket in half B (0.12 glue gap on its face and
  ends, 0.2 at its tip, 45° ends). The lap stays 1 mm behind the screen face and 0.5 in front of the trays' back.
  Glued, then lapped flat across the joint: that one rim is what both diffuser flanges seat on.
- **Knob at x +80, light sensor at +120, screws from below at ±34 / ±126.** That is panel B's own centre, where the P2.5
  tray already puts the encoder rails, the S3 and the sensor; each tray keeps its own ±46.
- **Diffuser per panel, split at the panel joint.** No skirt on the seam edge. A's half owns the rib over the joint,
  `JOINT_RIB` wide (0.45 = every other rib, plus any gap between the butted panels); B's starts 0.225 past its panel's
  edge. Neither half carries a 0.225 half rib (too thin for the 0.2 nozzle).
- **Splice plates** on the panels' inner corner inserts (x ±17.5, z ±32.25, 35 mm apart), top and bottom: a round hole on
  A's insert, a slot (±0.5 in x) on B's. They hold the rows in line across the seam (each diffuser floats ±0.3 in the
  bore, so unspliced the rows could step 0.6 mm) and let the panels butt freely.
- **Trays: one per panel, cut at the joint** (no end wall there: the panels fill it). Tray B is the P2.5 tray as built
  (S3, USB-C slot, encoder rails, sensor sled hooks, status window). Tray A is the same tray with none of those. Each
  bolts to its two outer corner inserts and takes its pair of screws from below. The two inner posts of each stand on the
  splice plates as open tubes round the plates' screw heads: they push, they don't bolt.
- **Panels turned 180°** as in the single build (data in on the left of each panel seen from the front).
- **Data chain: S3 → panel A's input, A's output → B's input** (Nov 4). Seen from the front the four headers sit at
  x -120.1 (A in), -39.9 (A out), +39.9 (B in) and +120.1 (B out). B's output is directly under the S3, as in the single
  build (where it's unused): a plug fits in the 9.5 mm under the board, but its ribbon has no way out (toward A the S3's
  own panel socket fills the gap down to 1 mm off the housing; the other way ends at the end wall). So B's output stays
  empty and the S3 feeds A, which puts the short run between the two inner headers.

## Before printing: test pieces (`stl/p25-128x32/coupons/`)
1. **Seam lap** — `coupon-128-seam-A-walnut.stl` + `-B-walnut.stl` (walnut, as exported, the 34 mm cut face on the bed): a
   50 mm piece of the top wall across the seam, front 34 mm (hood, rim, reveal, the lap's front end). Push together: the
   lip should drop in with a slight gap and the outsides meet flush with an even reveal. Binds: raise `LAP_CL` in
   `bar128.py`; rattles badly: lower it. Glue one and finish it (lap, oil) to see the line.
2. **Diffuser joint** — `coupon-128-diffuser-joint-white.stl` + `-black.stl` (one object, two parts, same frame; 0.2
   nozzle, 0.14 first layer as the P2.5 diffuser): three A pieces with joint ribs 0.45 / 0.55 / 0.65 (1 / 2 / 3 notches in
   the bezel edge) and one B piece, 6 columns either side, bottom edge included. Butt the panels, hold an A and the B at
   the bottom of the joint, panel lit and dark. The width whose seam column looks like the others: build with
   `JOINT_RIB=<it> python3 bar128.py ../stl/p25-128x32`.
3. **Splice plates** — `coupon-128-splice-plates.stl` (PETG, flat): holes 3.3 / 3.45 / 3.6 (1 / 2 / 3 notches). With the
   panels butted face down, round hole over A's inner corner insert, slot over B's, 2 x M3 x 6 button heads. Use the
   snuggest one an M3 passes through freely (`SPLICE_HOLE=<it>`). Also check: it sits flat on both bosses (nothing on the
   housings between them stands proud), and the rows still line up with it tightened.
4. **Chain (bench):** both panels turned 180°, butted, the S3 ribbon into A's input, a short ribbon from A's output to
   B's input. Light both and note which columns land on which panel (the firmware's mapping; nothing printed depends on
   it). Check the power leads reach panel A from where the S3 sits on panel B (~25 cm).
5. **Power socket:** from Waveshare's photo of the back it's at the panel's centre (1.7 mm right, 0.2 up in the normal
   orientation, pins in a vertical row), which is clear on both panels (below). A glance at yours confirms it; if it
   differs, `python3 check_bar128_power.py <frames> x,z` checks the spot.
6. As the single P2.5: the panel thickness (14.5) is assumed, not measured.

## Parts (`stl/p25-128x32/`)
| Part | File | Material | Print |
|---|---|---|---|
| Shell, left / right | `bar128-shell-A-walnut-backdown.stl`, `bar128-shell-B-walnut-backdown.stl` | PLA Wood | back rim down, both on one plate (same spool) |
| Diffuser, left / right | `bar128-diffuser-A-white.stl` + `-A-black.stl`; same for B | white + black | face down; each pair one object with two parts (same frame); both pairs fit one plate |
| Tray, left | `bar128-tray-A.stl` | black PETG | back face down, walls up |
| Tray, right | `bar128-tray-B.stl` + `bar128-tray-B-window.stl` (one object, two parts) | black PETG + translucent PETG | as the P2.5 tray |
| Splice plates | `bar128-splice-plates.stl` (2) | PETG | flat |
| Collar, knob, Boot key, sensor sled, wall cleats | the P2.5 / shared files: `stl/v5-drawer-p25/bar-encoder-collar-v5.stl`, `bar-sensor-sled.stl`, `bar-cleat-case.stl` + `bar-cleat-wall.stl` (one set per tray), `stl/bar-knob.stl`, `stl/bar-boot-key.stl` | as the README | as the README |

## Print settings
As the README ("Print settings") for the shell, tray and diffuser. Differences:
- **Shell halves:** both on one plate (177 x 203), so the walnut matches. 5 mm brim is fine (no diagonal layout). Seam: on
  a back corner of each half, away from the joint.
- **Diffuser:** the P2.5's: 0.2 nozzle, 0.14 first layer (the face, one layer).

## Hardware
- **Screws:** 4 x M3 x 8 flanged button head (the four outer posts, as the P2.5), 4 x M3 x 6 button head (splice plates),
  4 x M3 x 10 (from below, two per tray), 4 x M2.5 x 8 (S3). Light sensor and cleats as the README (cleats: per tray).
- **Other:** 4 bumpers 12.7 x 3.8 (at the ends); medium CA glue; the encoder's M7 nut.
- **Cables:** S3 → panel A's input: a 16-pin IDC ribbon, **35 cm minimum, 40 comfortable** (seated it runs ~27 cm from the
  S3 on tray B to A's input; the rest lets tray B come out still cabled, as the single build's 15 cm does). The P2.5's
  stock ribbon is too short for this run. A's output → B's input (headers 80 mm apart): the stock ribbon, folded.
- **Power: the panel's stock cable, both plugs** (it has two). Forks into the S3's terminals, the nearer plug into panel
  B (the same run as the single P2.5 build), the far plug into panel A. Between the plugs it runs flat on the panel backs
  just above or just below the A → B data ribbon (straight across at socket height the two data plugs are in the way):
  ~160 mm socket to socket plus the drops, so it needs **~18-20 cm or more between the plugs**. Tie up any spare as the
  single build does.
- **Power:** two panels can draw about twice one at full white. A 5 V / 3 A USB-C supply runs the transit screens; cap the
  brightness, or feed the panels from a separate 5 V supply.

## Gluing and finishing the shell
1. Dry-fit the halves back-down on a flat sheet (glass or a tile): the back rims are one plane, so the halves can't step
   front to back; the lap keys them up and down. Check the reveal is even on the top and the bottom.
2. Medium CA on the lap's faces only (the lip's outer face and the pocket wall it faces), 2 mm back from the outer edge so
   nothing squeezes into the reveal. Press together on the sheet, tape across the top and the bottom, weight it, let it cure.
3. Lap the front flat across the joint (220, then 400, on glass, figure-eights). Clean the reveal with a folded strip of paper.
4. Scuff and finish as the README. Oil goes on after gluing (CA won't bond to oiled wood PLA).

## Assembly
1. **Shell:** bumpers into the four recesses; collar into the knob hole (over panel B).
2. **Panels, face down on a towel:** snap each diffuser onto its panel (A's wide-rib edge toward the joint; its skirtless
   edge meets B's). Butt the panels, screw both splice plates on (round hole on A, 2 x M3 x 6 each), check the rows across
   the seam, tighten. Plug the power cable's two plugs into both panels (the far one into A, its run above or below the
   short ribbon), the short ribbon from A's output to B's input, and the long ribbon into A's input (red stripe = pin 1).
3. **Panels in:** shell face down, the joined panels in from the back until both bezels seat on the rim (panel B on the
   knob side).
4. **Encoder:** as the P2.5 build, steps 5-6 (QT cable into the encoder before tray B).
5. **Tray A first:** lay the long ribbon and the power cable's forked end along the panel backs toward the joint and out through
   the right half's back opening (tray B isn't in yet), so tray A slides in over them without pinching them. Tray A in,
   2 x M3 x 8 flanged into its outer posts.
6. **Tray B on the bench, then in:** the long ribbon into the S3's IDC header and the power cable's forks into its terminals
   while the S3 is loose (as the P2.5 build), then the S3 onto its posts. Fold the spare ribbon into tray A's empty space
   behind panel A as tray B goes in. 2 x M3 x 8 flanged into its outer posts. In both trays the inner posts stand on the
   plates, no screw. Then the four M3 x 10 from below.
7. **Firmware:** see Open.
## Checked (model, Nov 3)
`check_bar128.py`: nothing collides when seated except the trays' crush ribs and the 0.3 mm post feet (as the P2.5);
the splice screw heads clear the open posts with the tray 0.7 off any way; the knob, sensor, USB-C and the four screws from
below line up between the shell and the trays (0.00 mm); every part is watertight and fits the bed (largest 177.3 x 96.3).
The P2.5 and P3 builds are unchanged (same volumes; `check_v5.py` all OK for the P2.5).

**Rechecked Nov 4:** a clean rebuild reproduces every committed STL byte for byte and `check_bar128.py` passes again.
The 65 mm³ of S3 envelope it reports inside tray B is the same as the single P2.5 tray's (the envelope's boxy outline at
the posts), not new. Cabling, against the model's S3 and header positions: B's output is unusable (above), so the data
chain is S3 → A → B. The A → B ribbon and the S3 → A run both clear the trays, the splice plates and the S3. Printing:
the halves and trays have no overhangs the single P2.5 shell and tray don't already have. The lap adds 5 mm² at 43-45°
on half A, and the open seam ends of both halves print plain vertical walls.

**Power sockets (Nov 4), `check_bar128_power.py`:** each panel's 4-pin socket with a seated VH-class plug (20 x 10,
5 mm past the housing) and its wires turning flat behind it (12 mm), pin row along x or z, swept over the panel back
against the S3, the encoder, both trays, the splice plates and the data plugs in use. Panel A: clear anywhere a
socket can be (only the spots touching a data plug fail). Panel B: clear from ~13 mm left of centre rightward
(normal orientation, seen from the front), including where the P3's socket is (13 left, 2 up); from ~15-20 mm left
of centre the plug is under the S3. The same holds for the single P2.5 build, whose S3 sits in the same place.
The socket itself, measured off Waveshare's photo of the P2.5's back (scaled to the confirmed corner inserts; the
data headers and middle inserts come out within ~1 mm of the profile on the same photo): centre (+1.7, +0.2), pins in
a vertical row, now `power` in the P2.5 profile. Clear on both panels with 4 mm or more of margin in any direction; on
panel B the plug's edge is ~20 mm from the S3's. Seated, the sockets sit at case x -81.7 and +78.3, 160 mm apart.

## Open
- **Firmware and server are 64 x 32.** `firmware-s3` sets up the matrix as one 64 x 32 panel (`device.cpp`,
  `HUB75_I2S_CFG(64, 32, 1, …)`), and `server/board/` lays everything out for 64 wide. A 128-wide board needs a chain of 2
  there and its own layouts: separate work from the case.
- The joint rib, the splice hole and the lap clearance come from the test pieces.
- Which columns land on which panel with S3 → A → B (firmware mapping, bench), and the power lead to panel A.
- The length of cable between the stock power cable's two plugs: ~18-20 cm or more (measure before the build).
