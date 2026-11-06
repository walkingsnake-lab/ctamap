"""Slicer-readiness check for an STL, the things Bambu Studio trips on:
    python3 meshcheck.py <stl> [<stl> ...]  [--layer 0.2] [--min-width 0.85] [--fast]
1. Mesh health as the slicer sees it (float32 STL): watertight, consistent winding, no edge shared by more than two
   faces, no duplicate faces, no zero-area (sliver) triangles, one connected body.
2. Every layer (print orientation = the file's z, as exported): the layer's polygons are valid, and nothing in them is
   thinner than --min-width (default 0.6 mm: under one solid 0.42-0.6 mm line, which is where Arachne starts dropping or
   thinning walls; the proven v5 shell's 0.8 mm relief behind the S3's edge buttons and the 0.63 mm last layer of its
   bottom lip's chamfer both pass). Pieces shorter than 3 mm are ignored: they're the last layer of a chamfer at a
   corner facet, which every chamfered part has (the v5 shell included): a morphological opening of each layer finds the
   parts thinner than that; corner artefacts (shorter than the width) are ignored, anything longer is reported with
   its z, position and length. Slicers drop or merge such features, and that is where the "gaps" and "missing walls"
   come from. --fast checks every 5th layer.
Exit code 1 if any file fails the mesh health or layer validity; thin features are listed for review (a long one
at a 45 deg chamfer's last layer is normal; a thin wall or skin that runs through many layers is the problem)."""
import sys
import numpy as np
import trimesh
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union


def health(t):
    issues = []
    if not t.is_watertight:
        issues.append('not watertight')
    if not t.is_winding_consistent:
        issues.append('winding inconsistent')
    edges = t.edges_sorted
    _, counts = np.unique(edges, axis=0, return_counts=True)
    if (counts > 2).any():
        issues.append(f'{int((counts > 2).sum())} edges shared by >2 faces')
    fs = np.sort(t.faces, axis=1)
    if len(np.unique(fs, axis=0)) != len(fs):
        issues.append(f'{len(fs) - len(np.unique(fs, axis=0))} duplicate faces')
    area = t.area_faces
    if (area < 1e-6).any():
        issues.append(f'{int((area < 1e-6).sum())} zero-area faces')
    bodies = t.split(only_watertight=False)
    if len(bodies) != 1:
        issues.append(f'{len(bodies)} separate bodies')
    return issues


def layer_polys(t, z):
    s = t.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if s is None:
        return None
    p2, T = s.to_2D()
    polys = []
    for poly in p2.polygons_full:
        if poly.is_valid and poly.area > 1e-6:
            polys.append(poly)
    return (unary_union(polys), T) if polys else None


def thin_parts(layer, w):
    """pieces of the layer thinner than w: the layer minus its opening by w/2; corner artefacts dropped"""
    r = w / 2
    opened = layer.buffer(-r, join_style=2).buffer(r, join_style=2)
    left = layer.difference(opened)
    out = []
    geoms = left.geoms if hasattr(left, 'geoms') else [left]
    for g in geoms:
        if g.is_empty or g.area < 0.02:
            continue
        mrr = g.minimum_rotated_rectangle
        xs, ys = mrr.exterior.coords.xy
        pts = np.c_[xs, ys][:4]
        d = [np.linalg.norm(pts[i] - pts[(i + 1) % 4]) for i in range(2)]
        if min(d) < 0.05:                            # a hairline: float noise on a long edge, not geometry
            continue
        if max(d) > max(1.5 * w, 3.0):
            out.append((g.centroid.x, g.centroid.y, max(d), min(d), g.area))
    return out


def check(path, layer_h=0.2, min_w=0.6, fast=False):
    t = trimesh.load(path, process=False)
    t.vertices = t.vertices.astype(np.float32).astype(np.float64)   # as the STL stores them
    t.merge_vertices()                                               # the slicer welds identical corners; nothing else
    print(f'== {path}: {len(t.faces)} faces, {np.round(t.extents, 1).tolist()}')
    bad = health(t)
    for b in bad:
        print('  HEALTH:', b)
    z0, z1 = t.bounds[0][2], t.bounds[1][2]
    zs = np.arange(z0 + layer_h / 2, z1, layer_h * (5 if fast else 1))
    thin, invalid = [], 0
    for z in zs:
        try:
            layer = layer_polys(t, z)
        except Exception as e:                      # a section the polygon builder can't close
            invalid += 1
            print(f'  LAYER z={z:.2f}: section failed: {e}')
            continue
        if layer is None:
            continue
        layer, T = layer
        if not layer.is_valid:
            invalid += 1
            print(f'  LAYER z={z:.2f}: invalid polygon')
        for cx, cy, L, W, A in thin_parts(layer, min_w):
            wx, wy, _ = (T @ np.array([cx, cy, 0, 1]))[:3]
            thin.append((z, wx, wy, L, W))
    if thin:
        print(f'  THIN: {len(thin)} feature(s) under {min_w} mm on {len(set(round(z, 2) for z, *_ in thin))} layer(s):')
        for z, cx, cy, L, W in thin[:12]:
            print(f'    z {z:6.2f}  at ({cx:7.1f}, {cy:7.1f})  {L:5.1f} long, ~{W:.2f} wide')
        if len(thin) > 12:
            print(f'    ... {len(thin) - 12} more')
    ok = not bad and not invalid                       # thin features are listed for review (a chamfer's last layer
    print('  OK' if ok else '  FAIL', '(thin features to review)' if ok and thin else '')   # is one, harmlessly)
    return ok


if __name__ == '__main__':
    opts = sys.argv[1:]
    skip = {opts[i + 1] for i, a in enumerate(opts) if a in ('--layer', '--min-width') and i + 1 < len(opts)}
    args = [a for a in opts if not a.startswith('--') and a not in skip]
    lh = float(opts[opts.index('--layer') + 1]) if '--layer' in opts else 0.2
    mw = float(opts[opts.index('--min-width') + 1]) if '--min-width' in opts else 0.6
    fast = '--fast' in opts
    ok = all([check(p, lh, mw, fast) for p in args])
    sys.exit(0 if ok else 1)
