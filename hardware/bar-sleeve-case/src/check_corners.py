"""Corner-insert check for the drawer tray (v5): a flat frame on the panel outline with a Ø3.4 hole at each of the
four corner inserts. Lay it on the panel's back; if an M3 screw drops into all four inserts at once, the positions hold
and the tray can be regenerated with them. The corners are symmetric, so the frame works either way round.

Run: python3 check_corners.py <out.stl> [W H CX CZ]
  W, H    panel outline (default 160 x 80, the P2.5)
  CX, CZ  insert centre offsets from the panel centre (default 67.5, 37.5: Jake's ruler measurement of the P2.5,
          135 x 75 mm centre to centre, Oct 31)
"""
import sys
import numpy as np
import trimesh
from manifold3d import Manifold

T = 1.6            # thickness
RIM = 5.0          # rim width
HOLE = 3.4         # M3 clearance
BOSS = 9.0         # ring round each hole
SPOKE = 3.0


def box(x0, x1, y0, y1, z0=0.0, z1=T):
    return Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])


def cyl(x, y, d, z0=0.0, z1=T, n=48):
    return Manifold.cylinder(z1 - z0, d / 2, d / 2, n).translate([x, y, z0])


def frame(w, h, cx, cz):
    hx, hz = w / 2, h / 2
    m = box(-hx, hx, -hz, hz) - box(-hx + RIM, hx - RIM, -hz + RIM, hz - RIM, -1, T + 1)
    corners = [(sx * cx, sz * cz) for sx in (-1, 1) for sz in (-1, 1)]
    for x, z in corners:
        m = m + cyl(x, z, BOSS)
        ex = hx - RIM / 2 if x > 0 else -hx + RIM / 2                    # spoke to the side rim
        m = m + box(min(x, ex), max(x, ex), z - SPOKE / 2, z + SPOKE / 2)
    m = m ^ box(-hx, hx, -hz, hz, -1, T + 1)                             # keep inside the outline
    for x, z in corners:
        m = m - cyl(x, z, HOLE, -1, T + 1, 32)
    return m, corners


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'check-p25-corner-inserts.stl'
    w, h, cx, cz = (float(v) for v in sys.argv[2:6]) if len(sys.argv) >= 6 else (160.0, 80.0, 67.5, 37.5)
    m, corners = frame(w, h, cx, cz)
    me = m.to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.export(out)
    print(out, 'watertight', t.is_watertight, 'extents', np.round(t.extents, 1).tolist(),
          'spans', 2 * cx, 'x', 2 * cz, 'edge gap x/z', round(w / 2 - cx, 1), round(h / 2 - cz, 1))
