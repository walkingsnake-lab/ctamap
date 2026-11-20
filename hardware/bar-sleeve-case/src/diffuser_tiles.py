"""Face test tiles for the P4 diffuser: small squares of grid with faces of different thicknesses, to lay on the lit
panel side by side before printing whole halves.

    python3 diffuser_tiles.py <out dir> [cells=8] [face thicknesses, mm ...]     (default: 0.2 0.4 0.6 0.8)
    P4_GRID_H=2.0 python3 diffuser_tiles.py out            # the grid height to judge them at

Each tile is two parts, as the halves are: `-face` (everything up to the face's thickness: the translucent filament) and
`-black` (the grid). Load both together. Teeth on one edge count the face's layers (0.2 mm each). No skirts: a tile lies
on the LEDs, grid down, face up. Built DIFF_SHRINK large like the halves, so the ribs land between the LEDs.
"""
import os, sys
import numpy as np, trimesh
from manifold3d import Manifold
import p4
from p4 import DF, box, ADD


def tile(face, cells=8):
    """(face part, black part), print frame: z = 0 is the face (on the bed), the grid above it"""
    n, pitch, rib, gh = cells, DF.PITCH, DF.RIB, DF.GRID_H
    half = n * pitch / 2 + rib / 2
    layers = int(round(face / 0.2))
    def parts(z0, z1):
        ribs = [box(-half + i * pitch, -half + i * pitch + rib, -half, half, z0, z1) for i in range(n + 1)]
        ribs += [box(-half, half, -half + j * pitch, -half + j * pitch + rib, z0, z1) for j in range(n + 1)]
        teeth = [box(-half + 3 + 3.0 * k, -half + 4.5 + 3.0 * k, half - 0.3, half + 1.5, z0, z1) for k in range(layers)]
        return ribs, teeth
    _, teeth = parts(0, face)
    face_part = Manifold.batch_boolean([box(-half, half, -half, half, 0, face)] + teeth, ADD)
    ribs, teeth = parts(face, face + gh)
    black = Manifold.batch_boolean(ribs + teeth, ADD)
    k = 1.0 / (1.0 - p4.DIFF_SHRINK)
    return face_part.scale([k, k, 1.0]), black.scale([k, k, 1.0])


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    args = [float(a) for a in sys.argv[2:]]
    cells = int(args[0]) if args and args[0] >= 2 else 8
    faces = [a for a in args if a < 2] or [0.2, 0.4, 0.6, 0.8]
    os.makedirs(out, exist_ok=True)
    for f in faces:
        for part, m in zip(('face', 'black'), tile(f, cells)):
            me = m.to_mesh()
            t = trimesh.Trimesh(vertices=np.asarray(me.vert_properties)[:, :3], faces=np.asarray(me.tri_verts)); t.merge_vertices()
            name = f'p4-diffuser-tile-face{f:.1f}-{part}.stl'
            t.export(f'{out}/{name}')
            print(name, np.round(t.extents, 2).tolist(), 'watertight', t.is_watertight, f'{m.volume() / 1000:.2f} cm3')
