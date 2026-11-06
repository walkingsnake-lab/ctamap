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
  still needs 279. Halves cut at x = 0 fit flat, both on one plate (177 x 207 with the lap lip and the brim gap).
- **Shell joint = the P4 branch's**, turned 90°: a 1 x 1 mm reveal centred on x = 0 wraps the case (top, bottom, hood,
  front and back rims); the halves meet at its right edge, so the line sits in the groove's shadow. Inside the top and
  bottom walls, half A's inner 1.75 mm runs on 3.5 mm as a lip into a pocket in half B (0.12 glue gap on its face and
  ends, 0.2 at its tip, 45° ends). The lap stays 1 mm behind the screen face and 0.5 in front of the trays' back.
  Glued, then lapped flat across the joint: that one rim is what both diffuser flanges seat on.
- **Knob near the right end, at x +123 (50 mm from the end), over the S3's tray; light sensor 40 mm toward the centre
  (x +83); USB-C at the same end** (Nov 5). ±123 is as far out as the encoder's board (25.4 wide, under the top wall)
  clears the tray's top corner post sideways; further out it would ride ~1 mm over the post, and past ~138 the collar
  would reach the top's corner round. The knob was at -123 (left end, on tray A) for a while: that needed a 400-500 mm
  STEMMA QT cable from the S3 across the bar, so it moved to the S3's end, where every QT cable is 15-30 cm. (Moving
  the S3 to the left end instead would have meant turning the board upside down and redesigning the tray's S3 corner.)
  `KNOB_X=-123` still builds the left-hand version.
- **Screws from below at ±34 / ±126**: each tray keeps its own ±46.
- **Diffuser per panel, split at the panel joint.** No skirt on the seam edge. A's half owns the rib over the joint,
  `JOINT_RIB` wide (0.45 = every other rib, plus any gap between the butted panels); B's starts 0.225 past its panel's
  edge. Neither half carries a 0.225 half rib (too thin for the 0.2 nozzle).
- **Splice plates** on the panels' inner corner inserts (x ±17.5, z ±32.25, 35 mm apart), top and bottom: a round hole on
  A's insert, a slot (±0.5 in x) on B's. They hold the rows in line across the seam (each diffuser floats ±0.3 in the
  bore, so unspliced the rows could step 0.6 mm) and let the panels butt freely.
- **Trays: one per panel, cut at the joint** (no end wall there: the panels fill it). Tray B is the P2.5 tray (S3,
  USB-C slot, Boot, status window) with its controls moved toward the end: the encoder slot and rails under the knob
  and the sensor sled's hooks (`drawer.ENC_X` and the sensor's x). Tray A is the same tray with none of those
  (`drawer.tray(s3=False, controls=False)`). Each
  bolts to its two outer corner inserts and takes its pair of screws from below. The two inner posts of each stand on the
  splice plates, a pocket round each plate screw's head: they push, they don't bolt. They're solid and closed at the
  back (Nov 5): no tube means no bridged floor to print and no hole in the back face, so only the four outer posts'
  screw holes show.
- **Wall mounting (optional): a case cleat per tray, one long wall cleat** (Nov 5). The wall side is one piece
  (`bar128-cleat-wall.stl`, 293 mm, 3 wall screws), so the two case cleats hang in line by construction: two wall
  pieces would have to be set at exactly the same height. The case cleats stay one per tray (the shared
  `bar-cleat-case.stl`, 2 x M3 each), held in line by the trays and shell, so the bar hangs on four screws at x ±30 /
  ±130 (one centred case cleat would have had them 60 mm apart, with the knob 123 mm off centre).
- **Kept on purpose (Nov 5 review):** two screws from below per tray (one would leave each tray, and its panel, on a
  single screw in a slotted hole), and no vents in the middle (the band's free end at the seam would print thin, and
  the bands stiffen the trays).
- **Panel B turned 180°, as the single build; panel A in its normal orientation** (Nov 5). Each panel's data then runs
  from its header nearest the joint out toward its end of the bar: on the boards, **the printed data arrows beside the
  headers point away from the joint** on both panels. Nothing printed depends on it (inserts, posts, splice plates and
  diffusers are the same either way round, `bar128.PANEL_TURNED`); the firmware turns only panel B's picture.
- **Data chain: S3 → panel A's input, A's output → B's input, two 30 cm 16-pin ribbons** (Nov 4-5). Seen from the front
  the headers sit at x -120.1 (A out), -39.9 (A in), +39.9 (B in) and +120.1 (B out, unused). B's outer header is
  directly under the S3: a plug fits in the 9.5 mm under the board, but its ribbon has no way out (toward the middle the
  S3's own panel socket fills the gap down to 1 mm off the housing; the other way is the end wall), so it can only be the
  chain's unused end. That makes A the first panel. With both panels turned (until Nov 5) A's input was its far-left
  header and the S3's ribbon crossed the bar (40-50 cm); with A the other way round its input is the inner header, so
  both runs fit standard 30 cm ribbons. (The S3 can't plug straight onto a panel either: its socket sits 57 mm from its
  USB-C edge, and on B's outer header the board would reach ~7 mm through the end wall.)

## Before printing: test pieces (`stl/p25-128x32/coupons/`)
1. **Seam lap** — `coupon-128-seam-A-walnut.stl` + `-B-walnut.stl` (walnut, as exported, the 34 mm cut face on the bed): a
   50 mm piece of the top wall across the seam, front 34 mm (hood, rim, reveal, the lap's front end). Push together: the
   lip should drop in with a slight gap and the outsides meet flush with an even reveal. Binds: raise `LAP_CL` in
   `bar128.py`; rattles badly: lower it. Glue one and finish it (lap, oil) to see the line.
2. **Diffuser joint** — `coupon-128-diffuser-joint-white.stl` + `-black.stl` (one object, two parts, same frame; 0.2
   nozzle, 0.14 first layer as the P2.5 diffuser): three A pieces with joint ribs 0.45 / 0.55 / 0.65 (1 / 2 / 3 notches in
   the bezel edge) and one B piece, 6 columns either side, bottom edge included. Butt the panels, hold an A and the B at
   the bottom of the joint, panel lit and dark. The width whose seam column looks like the others is `JOINT_RIB`.
3. **Splice plates** — `coupon-128-splice-plates.stl` (PETG, flat): holes 3.3 / 3.45 / 3.6 (1 / 2 / 3 notches). With the
   panels butted face down, round hole over A's inner corner insert, slot over B's, 2 x M3 x 6 button heads. Use the
   snuggest one an M3 passes through freely (`SPLICE_HOLE=<it>`). Also check: it sits flat on both bosses (nothing on the
   housings between them stands proud), and the rows still line up with it tightened. Then rebuild with **both** sizes
   set (`JOINT_RIB=<w> SPLICE_HOLE=<d> python3 bar128.py ../stl/p25-128x32`): one left out goes back to its default.
4. **Chain (bench):** panels butted as they'll sit (both boards' data arrows pointing away from the joint), the S3's
   ribbon into A's inner header (its input), the jumper from A's outer header to B's inner header. Light both and note
   which columns land on which panel and that A shows its picture the other way up from B (the firmware's mapping;
   nothing printed depends on it). Check the power leads reach panel A from where the S3 sits on panel B (~25 cm).
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
| Wall cleat (optional) | `bar128-cleat-wall.stl` (one, 293 mm) | PETG | wall face down, at 45° on the plate |
| Collar, knob, Boot key, sensor sled, case cleats | the P2.5 / shared files: `stl/v5-drawer-p25/bar-encoder-collar-v5.stl`, `bar-sensor-sled.stl`, `bar-cleat-case.stl` (two, one per tray; optional), `stl/bar-knob.stl`, `stl/bar-boot-key.stl` | as the README | as the README |

## Print plates (`stl/p25-128x32/plates/`)
One 3MF per plate, laid out on the X2D's 256 x 256 bed in print orientation ([top views](stl/p25-128x32/plates/plates.png)).
Each two-colour part is one object with its parts in register: in Bambu Studio set each part's filament in the object
list, then the plate's process settings. They're plain 3MF: Bambu Studio may say the file isn't from Bambu Lab and load the
geometry only, which is all they carry. If it moves the parts, Arrange fits each plate again. Made by `src/plates128.py` from the committed STLs, so after rebuilding the parts run it again.

| Plate | Nozzle | Filament | Settings |
|---|---|---|---|
| `plate-0a-test-seam-lap` | 0.4 | PLA Wood | as the shell (below); 5 mm brim (each piece stands 34 mm on a 5 mm edge) |
| `plate-0b-test-diffuser-joint` | 0.2 | white face: white; black grid: black | as the diffuser (below) |
| `plate-0c-test-splice` | 0.4 | black PETG | as the tray |
| `plate-1-shell` | 0.4 | PLA Wood | shell settings, 5 mm brim, seam on a back corner away from the joint |
| `plate-2-trays` | 0.4 | black PETG; tray B's window part translucent PETG | tray settings (splice plates, Boot key and sensor sled ride along) |
| `plate-3-diffusers` | 0.2 | white face: white; black grid: black | diffuser settings, 0.14 first layer (the face) |
| `plate-4-wall-cleat` (optional) | 0.4 | PETG | as the README's cleats; laid at 45° (293 mm) |

Not on a plate (print from their own STLs, as the README): knob, encoder collar, case cleats (optional, two).

**Order:**
1. Plates 0a, 0b, 0c and the bench checks under "Before printing".
2. If a test changes a number, rebuild: `JOINT_RIB=<w> SPLICE_HOLE=<d> python3 bar128.py ../stl/p25-128x32`, then
   `python3 plates128.py` (both in `src/`). A changed `LAP_CL` goes in `bar128.py` itself.
3. Plates 1, 2 and 3, in any order. Plate 2's trays don't depend on any test, but its splice plates take
   `SPLICE_HOLE`: print it after 0c, or drop the splice plates from it and print them later.

## Print settings
As the README ("Print settings") for the shell, tray and diffuser. Differences:
- **Shell halves:** both on one plate (177 x 207), so the walnut matches. 5 mm brim is fine (no diagonal layout). Seam: on
  a back corner of each half, away from the joint.
- **Diffuser:** the P2.5's: 0.2 nozzle, 0.14 first layer (the face, one layer).

## Hardware
- **Screws:** 4 x M3 x 8 flanged button head (the four outer posts, as the P2.5), 4 x M3 x 6 button head (splice plates),
  4 x M3 x 10 (from below, two per tray), 4 x M2.5 x 8 (S3). Light sensor as the README. Cleats
  (optional): 4 x M3 x 10 (two per case cleat, as the README) and 3 wall screws (#8 / 4 mm countersunk) for the one wall
  cleat.
- **STEMMA QT:** S3 → light sensor: **20 cm** (both ride on tray B, ~14 cm apart along the walls, so nothing moves between
  them). Sensor → encoder: **15 cm**, as the single build, into the encoder's **left-hand** socket (step 7). Without the
  sensor: S3 → encoder, **30 cm** (~13 cm seated, plus the slack to plug it with tray B out of the case).
- **Other:** 4 bumpers 12.7 x 3.8 (at the ends); medium CA glue; the encoder's M7 nut.
- **Data ribbons: two 30 cm 16-pin (2x8) IDC ribbons**, the standard HUB75 length (the panels' own stock ribbons, if
  they're 30 cm). S3 → A's input: ~20 cm seated along the trays' back walls through tray B's ribbon hooks, ~26 cm with
  tray B held behind the back opening to plug it (4 cm spare). A's output → B's input: ~19 cm across the panel backs,
  behind A's input and power plugs, plugged on the bench (25 cm would do; 20 is tight). Both routes are checked in
  `check_bar128_power.py`.
- **Power: the panel's stock cable, both plugs** (it has two). Forks into the S3's terminals, the nearer plug into panel
  B (the same run as the single P2.5 build), the far plug into panel A. Between the plugs it runs flat on the panel backs
  just above or just below the data plugs (straight across at socket height the plugs at x ±39.9 are in the way):
  ~160 mm socket to socket plus the drops, so it needs **~18-20 cm or more between the plugs**. Tie up any spare as the
  single build does.
- **Power:** two panels can draw about twice one at full white. A 5 V / 3 A USB-C supply runs the transit screens; cap the
  brightness, or feed the panels from a separate 5 V supply.

## Gluing and finishing the shell
1. Dry-fit the halves back-down on a flat sheet (glass or a tile): the back rims are one plane, so the halves can't step
   front to back; the lap keys them up and down. Check the reveal is even on the top and the bottom.
2. Medium CA on the lap's faces only (the lip's outer face and the pocket wall it faces), 2 mm back from the outer edge so
   nothing squeezes into the reveal, and 2 mm back from the lip's tip and its inner edge too: the pocket is open to the
   bore there, through 0.2 mm gaps along the whole lap, and a bead inside would catch the trays and the diffuser flanges
   (0.25-0.3 mm clearance). Press together on the sheet, tape across the top and the bottom, weight it; scrape the inside
   joint line clean before the glue cures. Once cured, slide tray B through the right half once to check.
3. Lap the front flat across the joint (220, then 400, on glass, figure-eights). Clean the reveal with a folded strip of paper.
4. Scuff and finish as the README. Oil goes on after gluing (CA won't bond to oiled wood PLA).

## Assembly
1. **Shell:** bumpers into the four recesses; collar into the knob hole (near the right end).
2. **Panels, face down on a towel**, the right way round: both boards' printed data arrows (beside the headers) point
   away from the joint, so panel A lies the other way up from panel B. Snap each diffuser onto its panel (A's wide-rib edge toward the joint; its skirtless
   edge meets B's). Butt the panels, screw both splice plates on (round hole on A, 2 x M3 x 6 each) and snug them; turn
   the unit face up and check a row runs straight across the seam (a straightedge along the diffusers' grid), then face
   down again and tighten. Plug the power cable's two plugs into both panels (the far one into A, its run
   above or below the data plugs), the jumper ribbon from A's outer header to B's inner header (flat across the panel
   backs, behind A's input and power plugs), and the other ribbon into A's inner header, its input (red stripe = pin 1).
3. **Panels in:** shell face down, the joined panels in from the back until both bezels seat on the rim (panel B on the
   knob side).
4. **Encoder:** as the P2.5 build, step 5 (flip the shell, encoder into the collar, nut, knob).
5. **Tray A in:** lay the S3's ribbon and the power cable's forked end along the panel backs toward the joint and out
   through the right half's back opening (tray B isn't in yet), so tray A slides in over them without pinching them.
   Cross the joint **between the splice plates**, within ~25 mm of the panels' centre line: the inner posts land on the
   plates above and below that. 2 x M3 x 8 flanged into its outer posts.
6. **Tray B on the bench:** the light sensor onto its sled; the 20 cm QT cable (to the S3) and the 15 cm one (to the
   encoder) into the sensor's sockets **before** the sled goes into its hooks (as the P2.5 build: the sockets end up in
   the top wall's channels), then the sled into its hooks and its screw. The 20 cm cable's other end into the S3's QT
   socket while the S3 is loose (as the P2.5 build). Then, with tray B held square right behind the back opening (the
   30 cm ribbon reaches that far with ~4 cm to spare), the ribbon into the S3's IDC header and the power cable's forks
   into its terminals; then the S3 onto its posts.
7. **Encoder cable:** reach in through the back opening and plug the 15 cm cable's free end into the encoder's
   **left-hand socket** (toward the centre) under its board **now** (as the P2.5 build, step 6: it can't be reached once
   tray B is in). Not the right one: a plug there sits on tray B's top-right post and stops the tray going in.
8. **Tray B in:** its rails pass either side of the encoder's board (if it stops there, square the board as the P2.5
   build says). As it goes in, clip the ribbon into tray B's ribbon hooks on its back wall and let the few cm of spare
   lie flat along the back wall toward the joint. 2 x M3 x 8 flanged
   into its outer posts. In both trays the inner posts stand on the plates, no screw. Then the four M3 x 10 from below.
9. **Firmware:** see Open.
## Checked (model, Nov 3)
`check_bar128.py`: nothing collides when seated except the trays' crush ribs and the 0.3 mm post feet (as the P2.5);
the splice screw heads clear the open posts with the tray 0.7 off any way; the knob, sensor, USB-C and the four screws from
below line up between the shell and the trays (0.00 mm); every part is watertight and fits the bed (largest 177.3 x 96.3).
The P2.5 and P3 builds are unchanged (same volumes; `check_v5.py` all OK for the P2.5).

**Assembly review (Nov 5, an independent virtual assembly against the model):** the encoder's left-hand QT plug would sit
on tray A's top-left post (26.7 mm³ seated, 28.6 while sliding in; the right-hand one is clear, now checked in
`check_bar128.py`); with the knob at the right end it's the mirror (the right-hand plug sits on tray B's top-right post),
so step 7 names the left-hand socket. Also from it: a longer ribbon (35 cm left ~2-3 cm with tray B out; since replaced
by two 30 cm ribbons with panel A turned the other way; and the long
QT cable, gone since the knob moved to the S3's end), cables cross the joint between the splice plates, glue kept off the lap's inside edges,
the spare ribbon pushed into tray A's space early, the rows checked face up, the sensor's cables plugged before its sled
goes in, both test sizes set on a rebuild. Found fine: slide-in paths of the panels and both trays, tool reach (2 mm key
to the post screws), screw stacks, the sled's swing into its hooks, plates matching the STLs.

**Inner posts closed (Nov 5):** each still stands on its splice plate on a Ø11 / Ø8.6 ring (the same 11 mm³ at 0.3 mm
in), and the splice screw heads clear the pockets with the tray 0.7 off any way.

**Panel A the other way round (Nov 5):** `check_bar128_power.py` routes both 30 cm ribbons against the trays, the
splice plates, the S3, the encoder, the data plugs and both power plugs as seated: clear. Panel A's power socket lands at
x -78.3 (was -81.7): clear. No part changes (every STL rebuilds byte for byte).

**Knob at the right end (Nov 5):** `check_bar128.py`: the knob hole and the sensor pinhole line up with tray B's encoder
slot and sensor (x +123 / +83, 0.00 off); the encoder, sensor and sled clear tray B, shell B, panel B and the S3 and its
parts (0.00); the encoder's left-hand plug is clear, seated and sliding in. The sled sits above the top louver band,
10 mm over the power bundle's tie loop (unchanged from the single tray). The S3 envelope note is unchanged (65 mm³). `drawer.py`'s new options leave the single P3, P2.5 and P4
parts byte for byte as main's code builds them (main's committed P4 STLs already differ from its own code in four files;
that predates this). Power sockets still clear.

**Nov 5, on main after the P3/P4 drawer changes:** a rebuild still reproduces every part byte for byte, `check_v5.py`
(P2.5) passes including the new STEMMA QT plug check (10 mm clear: the P3's raised S3 isn't needed here), and the
plates pass lib3mf's strict validation with no warnings.

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
  there and its own layouts: separate work from the case. With panel A in its normal orientation and B turned,
  `Panel::show` (which already copies each pixel to the driver and does the 180° turn itself) maps each half of the
  picture to its panel with that panel's rotation: a per-panel setting (`0,180`) beside today's single `rotation`. The
  two-panel test mode (PR #500) uses one global flip, so on the bench panel A shows upside down there.
- The joint rib, the splice hole and the lap clearance come from the test pieces.
- Which columns land on which panel with S3 → A → B and A's picture the other way up from B's (firmware mapping, bench),
  and the power lead to panel A.
- The length of cable between the stock power cable's two plugs: ~18-20 cm or more (measure before the build).
