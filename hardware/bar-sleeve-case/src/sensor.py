"""Light-sensor bracket: Adafruit VEML7700 (4162, flat) under the Ø2 hole drilled in the case top (case2.SENSOR_X/Y),
hung from the 5880 encoder board's two right-hand corner holes. Nothing attaches to the shell.

- Sensor board (Adafruit's board file): 25.4 x 17.78, M2.5 holes at (2.54|22.86, 2.54|15.24), chip at (12.7, 13.716),
  STEMMA QT sockets (~4.25 tall) on the chip side at the short edges. Long axis along x, chip edge toward the back.
- Encoder board (5880, Adafruit's CAD model): 25.4 square centred under the knob, M2.5 holes on a 20.32 square; the
  encoder body (6.3 tall) sits on one face, its two STEMMA QT sockets (2.96 tall) and pins (2.1) on the other. The body
  clamps up against the collar's deck (collar.DECK_BOT, 1.4 under the case top), so the board's encoder face is
  7.7 under the case top and its underside 9.27. The sensor sits 5.0 under the top wall: its sockets clear it by 0.75.
- Through the Ø2 hole (2.5 mm wall) the chip, ~4 mm under it, sees a ~±10° cone straight up: a patch of the ceiling.
  Enough for room brightness; the firmware reads relative light at high gain.
- Prints flat side down as exported, no supports. Hardware: 2 x M2.5 x 8 + 2 M2.5 nuts (bracket up through the encoder
  board, nuts on top), 2-4 x M2.5 x 6 (sensor down into the carrier's Ø2.4 pilots), 10 cm STEMMA QT cable.
Run: python3 sensor.py <outdir>
"""
import sys
import numpy as np
from manifold3d import Manifold
import case as C
import case2 as V
from case import box, cyl_z, H, KY, WALL

ENC_DROP = 1.4 + 6.3                            # encoder face of the board below the case top (collar deck + body)
SB_GAP = 5.0                                     # sensor board top below the top wall's inner face
T = 3.0                                          # bracket thickness under the encoder board
PAD_D, PILOT = 6.0, 2.4

TOP_IN = H - WALL
EB_TOP = H - ENC_DROP
EB_BOT = EB_TOP - 1.57
SB_TOP = TOP_IN - SB_GAP
SB_BOT = SB_TOP - 1.6
Z0 = EB_BOT - T                                  # bracket's flat bottom (on the bed)
EH = [(10.16, KY - 10.16), (10.16, KY + 10.16)]  # encoder board's right-hand holes
SX, SY = V.SENSOR_X, V.SENSOR_Y


def sb(bx, by):
    """sensor board point (Adafruit coords) -> case (x, y); the chip lands under (SX, SY)"""
    return SX - 12.7 + bx, SY + 13.716 - by


SB_X0, SB_X1 = sb(0, 0)[0], sb(25.4, 0)[0]
SB_Y0, SB_Y1 = sb(0, 17.78)[1], sb(0, 0)[1]
SH = [sb(bx, by) for bx in (2.54, 22.86) for by in (2.54, 15.24)]


def bracket():
    pads = [cyl_z(x, y, Z0, EB_BOT, PAD_D, 40) for x, y in EH]
    # carrier: a frame under the sensor, top at the sensor's underside
    carrier = box(SB_X0 + 0.5, SB_X1 - 0.5, SB_Y0 + 0.5, SB_Y1 - 0.5, Z0, SB_BOT)
    carrier = carrier - box(SB_X0 + 6.5, SB_X1 - 6.5, SB_Y0 + 5.5, SB_Y1 - 5.5, Z0 - 1, SB_BOT + 1)
    arms = [Manifold.batch_hull([cyl_z(x, y, Z0, EB_BOT, 4.5, 32), cyl_z(SB_X0 + 3.0, cy, Z0, EB_BOT, 4.5, 32)])
            for (x, y), cy in zip(EH, (SB_Y0 + 3.0, SB_Y1 - 3.0))]
    b = Manifold.batch_boolean(pads + arms + [carrier], C.ADD)
    holes = [cyl_z(x, y, Z0 - 1, EB_BOT + 1, 2.8, 24) for x, y in EH]
    holes += [cyl_z(x, y, Z0 - 1, SB_BOT + 1, PILOT, 24) for x, y in SH]
    holes += [Manifold.cylinder(0.51, PILOT / 2, PILOT / 2 + 0.5, 24).translate([x, y, SB_BOT - 0.5]) for x, y in SH]   # lead-in
    return b - Manifold.batch_boolean(holes, C.ADD)


def envelopes():
    """stand-ins for fit checks and renders"""
    enc_pcb = box(-12.7, 12.7, KY - 12.7, KY + 12.7, EB_BOT, EB_TOP)
    enc_body = Manifold.cube([11.8, 11.8, 6.3], center=True).rotate([0, 0, 45]).translate([0, KY, EB_TOP + 3.15])
    enc_qt = Manifold.batch_boolean([box(7.69, 12.64, KY - 3, KY + 3, EB_BOT - 2.96, EB_BOT), box(-12.64, -7.69, KY - 3, KY + 3, EB_BOT - 2.96, EB_BOT)], C.ADD)
    enc_pins = cyl_z(0, KY, EB_BOT - 2.2, EB_BOT, 16.6, 32)              # through-hole pins and tabs (r <= 7.8)
    nuts = [cyl_z(x, y, EB_TOP, EB_TOP + 2.0, 5.5, 6) for x, y in EH]
    sen = box(SB_X0, SB_X1, SB_Y0, SB_Y1, SB_BOT, SB_TOP)
    sen_qt = [box(sb(bx0, 6)[0], sb(bx1, 6)[0], sb(0, 11.8)[1], sb(0, 6)[1], SB_TOP, SB_TOP + 4.25) for bx0, bx1 in ((0.5, 4.8), (20.6, 24.9))]
    chip = box(SX - 1.0, SX + 1.0, SY - 1.0, SY + 1.0, SB_TOP, SB_TOP + 0.85)
    heads = [cyl_z(x, y, SB_TOP, SB_TOP + 1.6, 4.6, 24) for x, y in SH]
    return dict(enc_pcb=enc_pcb, enc_body=enc_body, enc_qt=enc_qt, enc_pins=enc_pins, nuts=Manifold.batch_boolean(nuts, C.ADD),
                sensor=sen, sen_qt=Manifold.batch_boolean(sen_qt, C.ADD), chip=chip, heads=Manifold.batch_boolean(heads, C.ADD))


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    me = bracket().to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.apply_translation([0, 0, -t.bounds[0][2]])
    t.export(f'{out}/bar-sensor-bracket.stl')
    print('bracket', t.is_watertight, np.round(t.extents, 1).tolist())
