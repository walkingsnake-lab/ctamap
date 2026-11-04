"""Corner-insert check for the drawer tray (v5): a flat frame on the panel outline with a Ø3.4 hole at each of the
four corner inserts (the ones the tray bolts to). Lay it on the panel's back; if an M3 screw drops into all four inserts
at once, the positions hold and the tray can be printed.

Built in the panel frame seen from the front: print it, then flip it over so the bed face goes onto the panel's back.
Profile mode adds a Ø7 window over every other insert, so only the right way up fits (the P3's corners aren't
symmetric top to bottom), and an arrow tab on the PI IN side.

Run: PANEL=p3 python3 check_corners.py <out.stl>        corners and guides from panel.py
     CORNERS='[(x, z), ...]' GUIDES='[...]' PANEL=p3 ...  try other positions before changing panel.py
     python3 check_corners.py <out.stl> W H CX CZ        symmetric corners at (+/-CX, +/-CZ), no guides
     EXTRA='[(x, z), ...]' python3 check_corners.py ...  the same plus more holes (P4: EXTRA='[(0, 56), (0, -56)]')
History: the P2.5 frame (125 x 64.5 mm, Oct 31) confirmed its corners after a ruler reading of 135 x 75 proved too
wide; stl/v5-drawer-p25/check-p25-corner-inserts.stl is that frame.
"""
import sys
import numpy as np
import trimesh
from manifold3d import Manifold

T = 1.6            # thickness
RIM = 5.0          # rim width
HOLE = 3.4         # M3 clearance
BOSS = 9.0         # ring round each hole
GUIDE = 7.0        # window over a non-corner insert
SPOKE = 3.0


def box(x0, x1, y0, y1, z0=0.0, z1=T):
    return Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])


def cyl(x, y, d, z0=0.0, z1=T, n=48):
    return Manifold.cylinder(z1 - z0, d / 2, d / 2, n).translate([x, y, z0])


def spoke(x, z, hx, hz):
    """Bar from (x, z) to the nearest rim edge."""
    gaps = {'r': hx - x, 'l': x + hx, 't': hz - z, 'b': z + hz}
    side = min(gaps, key=gaps.get)
    if side in 'rl':
        ex = hx - RIM / 2 if side == 'r' else -hx + RIM / 2
        return box(min(x, ex), max(x, ex), z - SPOKE / 2, z + SPOKE / 2)
    ez = hz - RIM / 2 if side == 't' else -hz + RIM / 2
    return box(x - SPOKE / 2, x + SPOKE / 2, min(z, ez), max(z, ez))


def frame(w, h, corners, guides=(), arrow_x=None):
    hx, hz = w / 2, h / 2
    m = box(-hx, hx, -hz, hz) - box(-hx + RIM, hx - RIM, -hz + RIM, hz - RIM, -1, T + 1)
    for x, z in list(corners) + list(guides):
        m = m + cyl(x, z, BOSS if (x, z) in corners else GUIDE + 3.0) + spoke(x, z, hx, hz)
    m = m ^ box(-hx, hx, -hz, hz, -1, T + 1)                             # keep inside the outline
    if arrow_x is not None:                                              # tab pointing outward on the PI IN side
        s = 1 if arrow_x > 0 else -1
        m = m + box(min(s * hx, s * (hx + 6)), max(s * hx, s * (hx + 6)), -4, 4)
        m = m + Manifold.batch_hull([box(min(s * (hx + 6), s * (hx + 6.01)), max(s * (hx + 6), s * (hx + 6.01)), -7, 7),
                                     box(min(s * (hx + 13), s * (hx + 13.01)), max(s * (hx + 13), s * (hx + 13.01)), -0.01, 0.01)])
    for x, z in corners:
        m = m - cyl(x, z, HOLE, -1, T + 1, 32)
    for x, z in guides:
        m = m - cyl(x, z, GUIDE, -1, T + 1, 48)
    return m


def corners_of(inserts):
    return [max([q for q in inserts if q[0] * sx > 0 and q[1] * sz > 0], key=lambda q: (abs(q[0]), abs(q[1])))
            for sx in (-1, 1) for sz in (-1, 1)]


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'check-corner-inserts.stl'
    if len(sys.argv) >= 6:
        w, h, cx, cz = (float(v) for v in sys.argv[2:6])
        corners = [(sx * cx, sz * cz) for sx in (-1, 1) for sz in (-1, 1)]
        guides, arrow = [], None
        import ast, os
        if os.environ.get('EXTRA'):                                      # more holes, e.g. the P4's centre inserts
            corners += [tuple(q) for q in ast.literal_eval(os.environ['EXTRA'])]
    else:
        import panel
        P = panel.P
        w, h = P['w'], P['h']
        corners = corners_of(P['inserts'])
        guides = [q for q in P['inserts'] if q not in corners]
        import ast, os
        if os.environ.get('CORNERS'):
            corners = [tuple(q) for q in ast.literal_eval(os.environ['CORNERS'])]
        if os.environ.get('GUIDES'):
            guides = [tuple(q) for q in ast.literal_eval(os.environ['GUIDES'])]
        arrow = P['headers'][0][0]                                       # PI IN
    m = frame(w, h, corners, guides, arrow)
    me = m.to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.export(out)
    print(out, 'watertight', t.is_watertight, 'extents', np.round(t.extents, 1).tolist(), 'corners', corners, 'guides', guides)
