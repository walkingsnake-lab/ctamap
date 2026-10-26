# CTA LED Board: Bar Sleeve Case (current build, Oct 25, 2026)

Walnut wood PLA sleeve with a slanted shade hood, white (or translucent grey) diffuser with a fused grid, black PETG back plate that carries the Matrix Portal S3. Printed back-down (layer lines square to the case); the screen frame is glued in. Future builds may use other colors of PLA. Full design history: [DESIGN-HISTORY.md](DESIGN-HISTORY.md).

## Fixed decisions
- Slanted hood (12 mm lip at the top, 3 mm at the bottom): non-negotiable.
- Shell in Bambu PLA Wood (walnut), printed back-down, front lapped flat afterwards.
- No grilles in the shell. Venting is the back plate's 11 tall pills plus 2.5 mm chimney gaps along its top and bottom edges. Typical draw ~2-5 W; a cooling test isn't needed.
- Every opening the shell needs prints closed by a 0.4 mm skin and is cut or drilled out, and each cut edge is covered: knob hole (collar), USB-C (bezel), screw holes (screw heads). Every print layer is one continuous loop, so nothing in the geometry causes banding.
- The S3 mounts on the back plate, so its USB-C, status-light tube and Boot tube line up by construction. USB-C opening sized for the largest spec plug housing, so any compliant cable seats. USB-C height accepted as is.

## Build set (`stl/`)
| Part | File | Material | Print |
|---|---|---|---|
| Shell | `bar-shell-v3-walnut-backdown.stl` | PLA Wood, 0.4 nozzle | as exported (back rim down) |
| Screen frame | `bar-screen-frame.stl` | black PETG (bezel look) or walnut | front face down |
| Frame glue guide | `bar-frame-glue-guide.stl` | any PLA | as exported |
| Diffuser | `bar-diffuser-white-grid15.stl` (0.2 face), or `bar-diffuser-face03.stl` (0.3 face, for translucent grey); split files for two colors | white or translucent grey + black PETG | face down; first layer = face |
| Back plate | `bar-backplate-v2-petg.stl` + `bar-status-window-v2-translucent.stl`, or one-piece `bar-backplate-v2-translucent.stl` | black PETG + translucent, or translucent grey | outer face down |
| Encoder collar | `bar-encoder-collar-backdown.stl` | walnut, or translucent PETG for the glow | flange-top down |
| USB-C bezel | `bar-usb-bezel.stl` | black or walnut | flange face down |
| Boot key | `bar-boot-key.stl` | PETG or PLA | flat |
| Sensor drill guide (optional) | `bar-sensor-drill-guide-backdown.stl` | any PLA | as exported |
| Tilt plinth (optional) | `bar-plinth-walnut-8deg.stl` | PLA Wood | flat |
| Coupons | `coupon-v3-front-corner-backdown.stl`, `coupon-v3-frame-corner.stl`, `coupon-v3-usb-buttons-backdown.stl` | as the parts | as exported |
- Still to design, after the encoder arrives: the knob (current coin style; shaft hole ~14 mm deep plus a recess for the M7 nut), and the optional sensor shelf/keeper (hangs from the encoder board's holes; the back plate needs nothing for it).
- Hardware: 2 x M3 x 10 + nuts (plate), 4 x M2.5 x 8 (S3 to plate posts, self-tapping into PETG), the encoder's M7 nut, 4 x SJ5312 bumpers (+4 for the plinth), gel or medium CA glue.
- Alternate (`stl/alternate-frontdown/`): the front-down shell v2 with a built-in rim and its collar and drill guide. No lapping or glue, but its layer lines lean 4.7°.

## Print settings
- Shell:
  - Bambu PLA Wood profile; filament dried (~8 h at 50-55 °C) and flow-calibrated.
  - 0.2 mm layers throughout (no variable layer height), 3 walls, outer wall ~150 mm/s, elephant foot 0.15.
  - Seam: rotate Z 225° (or 135°) so the bottom-right corner faces the back of the plate, then Seam position "Back" and scarf seam; check in Preview.
  - Outer brim 5 mm with a 0.1 mm gap; Z hop 0.6 mm.
  - Plate washed with dish soap, then glue stick; bed 55-60 °C; door closed; no supports.
- Back plate (PETG): solid (5 top + 5 bottom shells), monotonic bottom surface, textured PEI, elephant foot 0.15, Z hop, dried PETG; Bambu PETG (Translucent) profile.
- Collar in translucent PETG: 100% infill, concentric bottom. Small parts (bezel, key): print beside a larger part.

## Finishing the shell
1. Cut the skins from inside along the printed pocket walls with a fresh #11 blade (drill a starter hole first): the knob hole and the USB-C cut-out. Drill the two screw skins with 3.4 mm (9/64").
2. Optional light sensor: drill Ø4 through the drill guide, keyed in the knob hole, before fitting the collar.
3. Lap the front flat on 220, then 400, paper taped to glass, in figure-eights. Deburr the edges.
4. Scrape the seam, sand along it with a flexible pad, and feather.
5. Scuff the outside evenly (grey Scotch-Brite or 400 wet), then finish with Danish oil or wax. Lay oily rags flat to dry.
6. Glue the frame: shell back-down on a flat table, guide inside, frame on the guide, small CA dots on the frame's outer edge. Ventilate and leave it open while it cures.

## Assembly
1. Collar into the knob hole. Encoder up into it from inside, NeoPixel toward the front, clamped with its M7 nut. Bumpers into the recesses.
2. S3 onto the plate's posts with 4 x M2.5 x 8.
3. Ribbon from the S3's IDC to the panel's PI IN, clipped into the plate's hooks.
4. Panel power to the S3's terminals; encoder STEMMA QT cable to the S3.
5. Panel and diffuser slide in from the back until the diffuser seats on the frame.
6. Plate slides in, tongues into the top grooves; 2 x M3 x 10 from below into the captured nuts.
7. USB-C bezel in (snug, or a drop of CA); plug in.
- To flash: hold the Boot key in through the plate, plug in USB-C, upload, then replug. OTA updates are a later firmware job.
- To service: unplug USB-C first; the plate comes out with the S3 on its ribbon.

## Key geometry (case frame: x right seen from the front, y back from the top front edge, z up from the bottom)
- Outer 217 x 110.3 x 63 mm; wall 2.5; corners R14; panel bore 212 x 105.3.
- Diffuser face at y 12; panel back at y 28.2; back plate y 57-59 (4 mm inside the rim).
- S3 from Adafruit's board file, component side facing the plate, board edge 2 mm inside the left wall (x -104):
  - USB-C at z = ZC (55.15), y 40.9; Down/Up/Reset at ZC -10.3 / -20.1 / -29.9.
  - Status LED at (-91.8, ZC-32.8); Boot at (-89.4, ZC-20.3); M2.5 holes at x -96.38 / -55.74, z ZC-7.62 / ZC-27.31.
- Knob hole Ø24 teardrop (tip to the front) at x 0, y 41.9; light-sensor spot x +55, y 42.
- Firmware: PR #431 logs the chip temperature once a minute (optional now).

## CAD sources (`src/`)
Parametric Python (manifold3d + trimesh); every STL in `stl/` is generated from these.

| Script | Makes |
|---|---|
| `case.py` | Shared parameters and helpers (v1 shell and plate, kept as the base) |
| `case2.py` | Shell v3 (back-down) and v2 (front-down), back plates, screen frame and glue guide, USB-C bezel, Boot key, sensor drill guide |
| `collar.py` | Encoder collars for both shells |
| `diffuser.py` | Diffuser: `python3 diffuser.py <out.stl> [face thickness, default 0.2]` |
| `plinth.py` | Tilt plinth: `python3 plinth.py <outdir> [degrees]` |
| `layerscan.py` | Slices a print-oriented STL in 0.2 mm layers and reports separate pieces and path length per layer (the banding check) |

```bash
cd hardware/bar-sleeve-case/src
pip install -r ../requirements.txt
python3 case2.py ../stl          # shells, plates, frame, guide, bezel, key, drill guides (also writes the v2 front-down shell)
python3 collar.py ../stl
python3 diffuser.py ../stl/bar-diffuser-white-grid15.stl
python3 plinth.py ../stl 8
python3 layerscan.py ../stl/bar-shell-v3-walnut-backdown.stl /tmp/scan.npy
```

`hardware/` is in `.dockerignore`, so none of this ships to Fly.

![Back plate in the shell, true-scale sections](img/plate-sections.png)
