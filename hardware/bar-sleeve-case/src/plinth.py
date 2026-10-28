"""Shadow-gap wedge plinth for the bar sleeve case: walnut, inset ~7 mm from the case edges,
tilts the case back TILT degrees. Pegs on top drop into the case's four bumper recesses;
recesses underneath take four SJ5312 bumpers. Prints bottom-down (as exported). Units mm."""
import math, sys
import numpy as np
import trimesh
from manifold3d import Manifold, CrossSection
import manifold3d
import case as C

TILT = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0
TB = 3.0                          # world thickness reference under the case's back edge
HX, Y0, Y1, R = 101.0 + C.DX, 14.0, 58.0, 10.0
PEG_D, PEG_H = 12.8, 1.3           # into the 13.2 x 1.5 recesses
PEG_EDGE = 1.5
BOT_X = 88.0 + C.DX


def build(tilt=TILT):
    a = math.radians(tilt); c, s = math.cos(a), math.sin(a)
    PY = C.D
    # case-local footprint prism below the case bottom (z <= 0)
    cs = CrossSection.square([2 * (HX - R), (Y1 - Y0) - 2 * R], center=True).offset(R, manifold3d.JoinType.Round, circular_segments=64)
    prism = Manifold.extrude(cs, 60).translate([0, (Y0 + Y1) / 2, -60])
    pegs = [Manifold.cylinder(PEG_H, PEG_D / 2, PEG_D / 2, 64).translate([fx, fy, 0]) for fx, fy in C.FEET]
    # clip the pegs 1.5 mm inside the plinth's edge: the front pair become D shapes, nothing overhangs
    inner = Manifold.extrude(cs.offset(-PEG_EDGE, manifold3d.JoinType.Round, circular_segments=64), 10).translate([0, (Y0 + Y1) / 2, -5])
    p = prism + (Manifold.batch_boolean(pegs, manifold3d.OpType.Add) ^ inner)
    # case-local -> world (case leaning back; world z = 0 is the table)
    M = [[1, 0, 0, 0], [0, c, s, PY * (1 - c)], [0, -s, c, TB + s * PY]]
    w = p.transform(M)
    w = w ^ Manifold.cube([600, 600, 300]).translate([-300, -300, 0])          # flat bottom on the table
    # bumper recesses underneath
    bb = w.bounding_box()
    y_front, y_back = bb[1] + 14.0, bb[4] - 14.0
    for fx in (-BOT_X, BOT_X):
        for fy in (y_front, y_back):
            w = w - Manifold.cylinder(1.5, 13.2 / 2, 13.2 / 2, 64).translate([fx, fy, -0.01])
    return w, (c, s, PY)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    w, (c, s, PY) = build()
    m = w.to_mesh()
    t = trimesh.Trimesh(vertices=m.vert_properties[:, :3], faces=m.tri_verts, process=False)
    t.export(f'{out}/bar-plinth-walnut-{TILT:g}deg.stl')
    z = lambda y: (TB + s * PY - s * y)          # world height of the case bottom plane at case-local y (z_local = 0)
    print('watertight', t.is_watertight, 'size', np.round(t.extents, 1).tolist(), 'g ~', round(t.volume / 1000 * 1.2, 1))
    print('thickness at back of footprint', round((TB - s * (Y1 - PY)) / c, 2), 'front', round((TB - s * (Y0 - PY)) / c, 2))
