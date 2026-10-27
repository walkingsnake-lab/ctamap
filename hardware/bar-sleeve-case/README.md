# CTA LED Board: Bar Sleeve Case (v4, Oct 26, 2026)

Walnut wood PLA sleeve with a slanted shade hood, white (or translucent grey) diffuser with a fused grid, black PETG back plate that carries the Matrix Portal S3. Printed front-down, tilted so the front rim lies flat on the bed, with the screen rim built in and every opening printed open. Future builds may use other colors of PLA. Full design history: [DESIGN-HISTORY.md](DESIGN-HISTORY.md).

## Fixed decisions
- Slanted hood (12 mm lip at the top, 3 mm at the bottom): non-negotiable.
- Shell in Bambu PLA Wood (walnut), printed front-down: the front rim is the first layer, flat with the bed's texture, and the screen rim is part of the shell (no glued frame, no lapping). Layer lines lean 4.7° with the front.
- Openings print open: knob hole, USB-C, four screw holes and the Ø2 light-sensor hole. They cause small bands in wood PLA; the cut-out skins and glued rim tried on the back-down build banded too, so the simpler build won. The back-down set is kept in `stl/alternate-backdown/`.
- No grilles in the shell. The back plate (v3) is a tray that fills the bore, with one louver band along its bottom (inlet) and one along its top (outlet), slots in a regular symmetric pattern rising 45° inward, so nothing inside shows from eye level or above. Typical draw ~2-5 W; check with the S3's chip-temperature log.
- The S3 mounts on the back plate, so its USB-C, status-light tube and Boot tube line up by construction. USB-C opening sized for the largest spec plug housing (13.65 x 8.0 with a 0.5 mm chamfer), so any compliant cable seats.

## Build set (`stl/`)
| Part | File | Material | Print |
|---|---|---|---|
| Shell | `bar-shell-v4-walnut-frontdown.stl` (69 mm deep) | PLA Wood, 0.4 nozzle | as exported (front rim flat on the bed), no supports |
| Diffuser | `bar-diffuser-white-grid15.stl` (0.2 face), or `bar-diffuser-face03.stl` (0.3 face, for translucent grey); split files for two colors | white or translucent grey + black PETG | face down; first layer = face |
| Back plate | `bar-backplate-v3.stl` (one piece) | PETG, one opaque color (black hides the insides best) | outer face down |
| Status-light rod | `bar-status-rod-translucent.stl` (flush head, shaft down the light tube to 0.8 mm above the LED) | translucent PETG, 100% infill | head down |
| Insert check (print first) | `check-panel-insert-template.stl` | any PLA | as exported; that face goes on the panel |
| Encoder collar | `bar-encoder-collar.stl` | walnut, or translucent PETG for the glow | as exported |
| Boot key | `bar-boot-key.stl` | PETG or PLA | flat |
| Sensor bracket (optional) | `bar-sensor-bracket.stl` (VEML7700 under the Ø2 hole, hung from the encoder board) | PETG or PLA | as exported, flat side down |
| Tilt plinth (optional) | `bar-plinth-walnut-8deg.stl` | PLA Wood | flat |
| Coupons | `coupon-v4-plate-boss.stl`, `coupon-v4-s3-pilots.stl` | as the parts | as exported |
- Still to design: the knob (current coin style; shaft hole ~14 mm deep plus a recess for the M7 nut), from the 5880's published dimensions.
- Optional light sensor: Adafruit VEML7700 (4162, flat), 10 cm STEMMA QT cable, 2 x M2.5 x 8 + 2 M2.5 nuts, 2-4 x M2.5 x 6. Firmware support (brightness from the sensor) is a separate change.
- Hardware: 4 x M3 x 10 + 4 M3 nuts (plate to shell, from below), 4 x M3 x 8 (plate to the panel's inserts, no washers), 4 x M2.5 x 8 (S3 to plate posts, self-tapping into a Ø2.4 pilot), the encoder's M7 nut, 4 x SJ5312 bumpers (+4 for the plinth), 1-2 hook-and-loop cable ties ~12 mm wide (power-cable bundle). Metric hex keys: 1.5 mm (M2.5) and 2 mm (M3; its long arm must reach ~34 mm down the standoff tubes).
- Alternate (`stl/alternate-backdown/`): the back-down shell (layer lines square to the case; 0.5 mm skins over the openings to cut out, front lapped flat, glued screen frame with its glue guide, USB-C bezel, back-down collar and drill guide).

## Print settings
- Shell:
  - Bambu PLA Wood profile; filament dried (~8 h at 50-55 °C) and flow-calibrated.
  - 0.2 mm layers throughout (no variable layer height), 3 walls, elephant foot 0.15.
  - Seam: paint it along the bottom face, near a back corner (hidden by the bumpers or the plinth); check in Preview.
  - Outer brim 5 mm with a 0.1 mm gap (the front rim on the bed is narrow); Z hop 0.6 mm.
  - Textured PEI (matte front rim), bed 55-60 °C; door closed; no supports.
- Back plate (PETG): 0.24 mm layers, 4 walls, 4 top + 4 bottom layers, 15% infill (gyroid), monotonic bottom surface, textured PEI, elephant foot 0.15, Z hop, dried PETG; Bambu PETG profile. Not solid: bolted to the panel, it doesn't need it, and solid adds most of the print time.
- Collar in translucent PETG: 100% infill. Small parts (key, rod): print beside a larger part.

## Finishing the shell
1. Clean up the openings: deburr the knob hole, USB-C opening, screw holes and sensor hole (a deburring tool, or a 2 mm bit by hand for the sensor hole).
2. Scrape the seam, sand along it with a flexible pad, and feather.
3. Scuff the outside evenly (grey Scotch-Brite or 400 wet), then finish with Danish oil or wax. Mask the bore, knob hole, USB-C opening, tongue grooves and foot recesses first. Lay oily rags flat to dry.

## Assembly
The panel can't slide past a mounted encoder (its top edge is ~4 mm above the encoder board's underside), so the panel goes in first and everything behind it is fitted from the open back.
1. Bench: collar into the knob hole; bumpers into the recesses. Push an M3 nut into each of the plate's four bottom-boss slots (it snaps past the narrowed mouth). S3 onto the plate's posts with 4 x M2.5 x 8.
2. Bench, optional light sensor: VEML7700 onto the bracket's carrier with 2-4 x M2.5 x 6 (chip up, chip edge toward the back). Bracket up against the underside of the encoder board's two right-hand corner holes (seen from the front), 2 x M2.5 x 8 up through both, nuts on top. 10 cm STEMMA QT cable from the encoder's right-hand socket to the sensor.
3. Snap the diffuser onto the panel. Case face down on a towel; panel and diffuser in from the back until the diffuser seats on the frame.
4. Encoder (with the sensor bracket) in from the back: shaft first, up into the collar, NeoPixel toward the front, the sensor under its hole. Clamp it with its M7 nut from the top.
5. Cables, with the plate held just behind the case: ribbon from the S3's IDC to the panel's PI IN, clipped into the plate's hooks; panel power to the S3's terminals; encoder STEMMA QT cable (its left-hand socket) to the S3.
   - Power cable: fold the extra back and forth in ~3.5 cm lengths with the spare plug and wrap one hook-and-loop tie round it. Set the bundle wherever it fits behind the panel; if it shifts, strap it under the plate's tie-down bridge (middle, above the ribbon).
6. Plate in, tongues into the top grooves; it gets stiffer for the last few mm and clicks as the tongue bumps drop into their dimples. 4 x M3 x 8 down the standoff tubes into the panel's inserts (2 mm hex key), then 4 x M3 x 10 from below; the boss slots take up any depth error.
7. Status-light rod into its hole from the back, head flush (snug; a drop of CA if it's loose). Plug in USB-C.
- To flash: hold the Boot key in through the plate, plug in USB-C, upload, then replug. OTA updates are a later firmware job.
- To service: unplug USB-C; take out the four screws from below and the four in the standoff tubes; ease the plate out (the S3 comes with it, still cabled). To get the panel out, take off the encoder's top nut and lift the encoder out first.

## Key geometry (case frame: x right seen from the front, y back from the top front edge, z up from the bottom)
- Outer 217 x 110.3 x 69 mm (v4; 63 before); wall 2.5; corners R14; panel bore 212 x 105.3.
- Diffuser face at y 12; panel back at y 28.2; back plate y 63-65 (4 mm inside the rim). Screws from below at x ±40 and ±52, y 59.5. Top snap: a 0.7 mm bump on each tongue, a 0.5 mm dimple in each groove roof (0.7 mm of wall left over it).
- Panel inserts used by the v3 standoffs (case x, z from ZC): (-88, +31), (+88, +31), (+88, -26), (+7, -36), photo estimates ±1 mm, panel in normal orientation (PI IN on the right seen from the front). The fourth corner insert sits under the S3. Check with the template before printing the plate; correct `STANDOFFS` in `plate3.py` if needed.
- S3 from Adafruit's board file, component side facing the plate, board edge 2 mm inside the left wall (x -104):
  - USB-C at z = ZC (55.15), y 40.9; Down/Up/Reset at ZC -10.3 / -20.1 / -29.9.
  - Status LED at (-91.8, ZC-32.8); Boot at (-89.4, ZC-20.3); M2.5 holes at x -96.38 / -55.74, z ZC-7.62 / ZC-27.31.
- Knob hole Ø24 teardrop (tip to the back) at x 0, y 41.9; light-sensor hole Ø2 at x +55, y 42.
- Firmware: PR #431 logs the chip temperature once a minute (optional now).

## CAD sources (`src/`)
Parametric Python (manifold3d + trimesh); every STL in `stl/` is generated from these.

| Script | Makes |
|---|---|
| `case.py` | Shared parameters and helpers (v1 shell and plate, kept as the base) |
| `case2.py` | Shell v4 front-down (main), back-down alternate with its screen frame, glue guide, USB-C bezel and drill guide; Boot key |
| `plate3.py` | Back plate v3 (bolted to the panel), status-light rod, insert template, boss and S3-pilot coupons |
| `sensor.py` | Light-sensor bracket: `python3 sensor.py <outdir>` |
| `collar.py` | Encoder collars for both shells |
| `diffuser.py` | Diffuser: `python3 diffuser.py <out.stl> [face thickness, default 0.2]` |
| `plinth.py` | Tilt plinth: `python3 plinth.py <outdir> [degrees]` |
| `layerscan.py` | Slices a print-oriented STL in 0.2 mm layers and reports separate pieces and path length per layer (the banding check) |

```bash
cd hardware/bar-sleeve-case/src
pip install -r ../requirements.txt
python3 case2.py ../stl          # front-down shell and Boot key; back-down set into ../stl/alternate-backdown/
python3 plate3.py ../stl         # v3 plate, light rod, insert template, coupons
python3 sensor.py ../stl         # light-sensor bracket
python3 collar.py ../stl
python3 diffuser.py ../stl/bar-diffuser-white-grid15.stl
python3 plinth.py ../stl 8
python3 layerscan.py ../stl/bar-shell-v4-walnut-frontdown.stl /tmp/scan.npy
```

`hardware/` is in `.dockerignore`, so none of this ships to Fly.

![Back plate in the shell, true-scale sections](img/plate-sections.png)
