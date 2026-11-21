"""P4 tint-over-white diffuser coupons (Nov 20): thick translucent gray in front, the thinnest white behind it, black grid.

Five strips that hang side by side on the panel's bottom edge (bottom skirt and bezel included), so all five can be
compared on one lit panel, in daylight:
  A  reference: 0.2 white face, no gray (the current diffuser)
  B  0.4 gray + 0.1 white
  C  0.6 gray + 0.1 white
  D  0.8 gray + 0.1 white
  E  1.0 gray + 0.1 white
Each strip is 11 columns x 13 rows, cut on ribs (each owns its edge ribs whole), one empty column between strips.
Grid behind the white: 2.3 on the tint strips (as p4.diffuser_halves with a 0.1 white), 2.4 on the reference.
Exported as ONE object in three parts (gray, white, black) sharing one frame, so a single height-range modifier
covers every strip and all of them slice on the same layers (the prime tower needs that).

Slicing: first layer 0.2; height-range modifier 0.2-1.2 mm at 0.1 mm layers; 0.2 mm above. Every gray/white boundary
then falls on a layer line. Built DIFF_SHRINK larger about each strip's centre, as the halves are.

Result (Nov 20): C. The owner then chose a 0.12 white in the slicer: p4.py's TINT_GRAY / TINT_WHITE defaults.

Run: python3 p4_tint_coupons.py <outdir>   (stl/p4: python3 p4_tint_coupons.py ../stl/p4)
"""
import sys
import numpy as np
import p4
from p4 import DF, box, DIFF_SHRINK
import panel

VARIANTS = [('A', 0.0, 0.2), ('B', 0.4, 0.1), ('C', 0.6, 0.1), ('D', 0.8, 0.1), ('E', 1.0, 0.1)]   # name, gray, white
COLS, ROWS = 11, 13
PITCH, RIB = DF.PITCH, DF.RIB
GRID_PLAIN = DF.GRID_H                     # 2.4


def strip(i, gray, white):
    """strip i (0..4) as {part: manifold}, panel frame (z = 0 the face, +z toward the LEDs)"""
    skin = gray + white
    grid0 = DF.GRID_H
    DF.GRID_H = GRID_PLAIN if gray == 0 else GRID_PLAIN - white
    try:
        d = DF.diffuser(skin=skin)
    finally:
        DF.GRID_H = grid0
    gx, gy = DF.PW / 2, DF.PH / 2
    n = len(VARIANTS)
    c0 = -(n * COLS + (n - 1)) // 2 + i * (COLS + 1)      # first column of the strip (columns from -32)
    x0 = c0 * PITCH - RIB / 2                             # own the edge ribs whole
    x1 = (c0 + COLS) * PITCH + RIB / 2
    y1 = -gy + ROWS * PITCH + RIB / 2
    cut = box(x0, x1, -gy - 30, y1, -5, 30)
    d = d ^ cut
    parts = {}
    if gray > 0:
        parts['gray'] = d ^ box(-400, 400, -400, 400, -1, gray)
    parts['white'] = d ^ box(-400, 400, -400, 400, gray, skin)
    parts['black'] = d - box(-400, 400, -400, 400, -1, skin)
    k = 1.0 / (1.0 - DIFF_SHRINK)
    xc = (x0 + x1) / 2
    return {p: m.translate([-xc, 0, 0]).scale([k, k, 1.0]).translate([xc, 0, 0]) for p, m in parts.items()}, (x0, x1)


def main(out):
    import trimesh
    from manifold3d import Manifold, OpType
    acc = {'gray': [], 'white': [], 'black': []}
    for i, (name, gray, white) in enumerate(VARIANTS):
        parts, (x0, x1) = strip(i, gray, white)
        for p, m in parts.items():
            acc[p].append(m)
        print(f'{name}: gray {gray:.1f}  white {white:.1f}  grid {GRID_PLAIN if gray == 0 else GRID_PLAIN - white:.1f}'
              f'  x {x0:.1f}..{x1:.1f}')
    for p, ms in acc.items():
        m = Manifold.batch_boolean(ms, OpType.Add)
        me = m.to_mesh()
        t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=True)
        path = f'{out}/coupon-p4-tint-{p}.stl'
        t.export(path)
        print(path.split('/')[-1], 'watertight', t.is_watertight, np.round(t.bounds, 2).tolist())


if __name__ == '__main__':
    main(sys.argv[1].rstrip('/'))
