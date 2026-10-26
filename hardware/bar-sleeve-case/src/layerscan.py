"""Per-layer path analysis of a print-oriented mesh: islands (separate regions) and contour length per layer."""
import sys, numpy as np, trimesh, manifold3d
from manifold3d import Manifold

def load(path):
    t = trimesh.load(path)
    return Manifold(manifold3d.Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32))), t.bounds

def scan(m, zmax, lh=0.2):
    rows = []
    z = lh / 2
    while z < zmax:
        polys = m.slice(z).to_polygons()
        isl, per = 0, 0.0
        for p in polys:
            p = np.asarray(p)
            a = 0.5 * np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1])
            if a > 0: isl += 1
            per += np.sum(np.linalg.norm(p - np.roll(p, -1, 0), axis=1))
        rows.append((z, isl, per))
        z += lh
    return np.array(rows)

if __name__ == '__main__':
    m, b = load(sys.argv[1])
    r = scan(m, b[1][2])
    np.save(sys.argv[2], r)
    print('layers', len(r), 'islands min/max', int(r[:, 1].min()), int(r[:, 1].max()), 'contour mm min/max', round(r[:, 2].min()), round(r[:, 2].max()))
    # layers whose island count differs from the previous layer = visible transitions
    ch = np.nonzero(np.diff(r[:, 1]) != 0)[0]
    print('island-count changes between layers:', len(ch))
