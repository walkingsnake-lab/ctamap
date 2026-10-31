"""Light-sensor grille drill guide for the v4 back-down shell: drills a small grille of straight holes through the
case top over the VEML7700 (case2.SENSOR_X/Y) instead of one Ø2 hole.

- One flat slab (top and bottom parallel), so it prints top face down with the plug up and no supports. On the case it
  sits flat on the top; a 2.3 mm plug keys into the knob hole (same teardrop, tip to the front, 0.2 mm clearance), so
  the bores land square to the top and in the same place every time. Use it before the collar goes in.
- Bores are SLAB long (8 mm), so the bit can't lean. Bore = bit + BORE_CL (small printed holes shrink).
- Patterns, centred on the sensor spot (the existing blind Ø2 pocket inside the top):
    '5': dice five, centre + 4 corners at (±P5, ±P5)
    '4': square, corners at (±P4/2, ±P4/2)
  The chip sits ~4.2 mm under the wall's inner face; the outermost hole edge is ≤ 3.4 mm off its axis, so every hole
  is inside the chip's view. Webs between holes stay ≥ 1 mm.
Run: python3 grille_guide.py <outdir> [bit_mm]     (default bit 1.5; 1/16" = 1.59)
"""
import math, sys
import numpy as np
from manifold3d import Manifold, CrossSection
import case2 as V

SLAB = 8.0                 # guide thickness = bore length
PLUG_D = 2.3               # plug depth into the knob hole (wall 2.5)
BORE_CL = 0.25
P5 = 1.8                   # dice five: corner offset (centre-to-corner 2.55)
P4 = 2.6                   # square: pitch
SX, SY = V.SENSOR_X, V.SENSOR_Y - V.KY     # sensor spot relative to the knob-hole centre


def pattern(name):
    if name == '5':
        return [(0, 0)] + [(sx * P5, sy * P5) for sx in (-1, 1) for sy in (-1, 1)]
    if name == '4':
        return [(sx * P4 / 2, sy * P4 / 2) for sx in (-1, 1) for sy in (-1, 1)]
    raise ValueError(name)


def teardrop(r):
    V.BACKDOWN = True      # v4 back-down shell: knob-hole teardrop tip to the front
    try:
        return V.teardrop_cs(r, 0, 0, seg=V.SEG)
    finally:
        V.BACKDOWN = False


def guide(name, bit=1.5):
    """Frame: knob-hole centre at the origin on the case top (z = 0), z up."""
    body = Manifold.extrude(CrossSection.batch_hull([teardrop(14.5), CrossSection.circle(7.5, 64).translate([SX, SY])]), SLAB)
    plug = Manifold.extrude(teardrop(V.ENC_HOLE / 2 - 0.2), PLUG_D).translate([0, 0, -PLUG_D])
    g = body + plug
    r = (bit + BORE_CL) / 2
    holes = []
    for dx, dy in pattern(name):
        x, y = SX + dx, SY + dy
        holes.append(Manifold.cylinder(SLAB + 2, r, r, 32).translate([x, y, -1]))
        holes.append(Manifold.cylinder(0.6, r, r + 0.6, 32).translate([x, y, SLAB - 0.6 + 0.001]))  # lead-in at the top
    g = g - Manifold.batch_boolean(holes, V.ADD)
    # orientation mark on top: a 0.4 mm groove pointing from the knob toward the sensor
    g = g - V.box(6, 30, -0.6, 0.6, SLAB - 0.4, SLAB + 1)
    return g


def drilled_shell_check(name, bit=1.5):
    """Cut the holes into the v4 shell and report clearances (sanity check, not exported)."""
    pts = [(SX + dx, SY + dy) for dx, dy in pattern(name)]
    r = bit / 2
    webs = [math.dist(a, b) - bit for i, a in enumerate(pts) for b in pts[i + 1:]]
    off = max(math.hypot(dx, dy) + r for dx, dy in pattern(name))
    chip_depth = 4.15                                          # sensor.py: chip under the wall's inner face
    ang = math.degrees(math.atan2(off, chip_depth))
    return dict(holes=len(pts), min_web=round(min(webs), 2), max_edge_off_axis=round(off, 2), view_angle_deg=round(ang, 1))


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    bit = float(sys.argv[2]) if len(sys.argv) > 2 else 1.5
    flip = trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0])     # top face on the bed, plug up (a rotation, not a mirror)
    for name in ('5', '4'):
        me = guide(name, bit).to_mesh()
        t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
        t.apply_transform(flip)
        t.apply_translation([0, 0, -t.bounds[0][2]])
        fn = f'bar-sensor-grille-guide-{name}hole.stl'
        t.export(f'{out}/{fn}')
        print(fn, t.is_watertight, np.round(t.extents, 1).tolist(), drilled_shell_check(name, bit))
