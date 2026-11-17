"""Snap test strips for the P4 diffuser: slices of a half, full height (top and bottom skirts), one bump top and bottom,
to press onto the panel's edge and compare how each snaps before printing whole halves.

    python3 diffuser_snap_strips.py <out dir>          # the snap set, below
    python3 diffuser_snap_strips.py <out dir> size     # the size set: the halves as they are, the opening between the top
                                                       # and bottom skirts 0, 0.1, 0.2 and 0.3 mm smaller (0 to 3 notches)

One material (black PETG), face down as exported. Notches in one end count the strip:
  1  as the halves of Nov 16 ("v3"): 2.4 grid, 5 mm skirt, 6 mm bump                       (the one that does not snap)
  2  the same, the skirt lowered to 3 mm for 14 mm at the bump: a free edge 1.2 above it, as on the halves that snapped
  3  the same as 1, the bump a ridge the strip's whole width (the owner's idea: bumps the length of the wall)
  4  the first halves' section: 1.5 grid, 3 mm skirt, 6 mm bump                             (should snap: it proves the test)
"""
import os, sys
import numpy as np, trimesh
from manifold3d import Manifold
import p4
from p4 import DF, box, ADD

W = 28.0
VARIANTS = ((1, dict()),
            (2, dict(BUMP_WINDOW=(14.0, 3.0))),
            (3, dict(BUMP_L=W + 6)),
            (4, dict(GRID_H=1.5, SK_D=3.0)))
SIZES = tuple((i, dict(HOUSE_H=round(DF.HOUSE_H - 0.1 * i, 2))) for i in range(4))


def strip(n, over):
    saved = {k: getattr(DF, k) for k in over}
    xs = DF.BUMP_XS
    xc = min(xs)                                    # the bump nearest the left end
    try:
        for k, v in over.items():
            setattr(DF, k, v)
        d = DF.diffuser()
    finally:
        for k, v in saved.items():
            setattr(DF, k, v)
    s = d ^ box(xc - W / 2, xc + W / 2, -200, 200, -5, 30)
    y1 = s.bounding_box()[4]
    if n:
        s = s - Manifold.batch_boolean([box(xc - W / 2 + 3 + 3.0 * i, xc - W / 2 + 4.5 + 3.0 * i, y1 - 1.5, y1 + 1, -1, 30) for i in range(n)], ADD)
    k = 1.0 / (1.0 - p4.DIFF_SHRINK)
    return s.scale([k, k, 1.0]).translate([-xc * k, 0, 0])


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    print('P4 config: CLR', DF.CLR, 'BUMP', DF.BUMP, 'BUMP_XS', DF.BUMP_XS, 'TOP_BUMPS', DF.TOP_BUMPS, 'HOUSE_H', DF.HOUSE_H, 'GRID_H', DF.GRID_H, 'SK_D', DF.SK_D)
    size = len(sys.argv) > 2 and sys.argv[2] == 'size'
    for n, over in (SIZES if size else VARIANTS):
        m = strip(n, over)
        me = m.to_mesh()
        t = trimesh.Trimesh(vertices=np.asarray(me.vert_properties)[:, :3], faces=np.asarray(me.tri_verts)); t.merge_vertices()
        name = f'p4-diffuser-size-strip-{n}-minus-{0.1 * n:.1f}mm.stl' if size else f'p4-diffuser-snap-strip-{n}.stl'
        t.export(f'{out}/{name}')
        print(name, np.round(t.extents, 2).tolist(), 'watertight', t.is_watertight, 'bodies', len(m.decompose()), f'{m.volume() / 1000:.2f} cm3')
