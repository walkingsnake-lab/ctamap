"""Print plates for the 128 x 32 bar (P25-128-BUILD.md): one 3MF per plate, parts laid out on the X2D's 256 x 256 bed in
print orientation, each two-colour part one object with its two parts in register (diffusers: white face + black grid;
tray B: tray + window). Built from the committed STLs, so run bar128.py first when the parts change:

    python3 plates128.py [stl dir, default ../stl] [out dir, default ../stl/p25-128x32/plates]

Plain 3MF (core spec): Bambu Studio opens it as geometry (it says the file isn't from Bambu Lab); assign each part's
filament and the plate's process settings as the build sheet's "Print plates" table says. Also writes a top view of
every plate (plates.png) to check the layout. Single-part extras (knob, collar, cleats) print from their own STLs."""
import os
import sys
import zipfile
from xml.sax.saxutils import escape

import numpy as np
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__))
STL = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'stl'))
OUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(STL, 'p25-128x32', 'plates'))
BED = 256.0
P = 'p25-128x32/'
C = P + 'coupons/'

# plate: (file stem, title, [objects]); object: (name, [(part name, stl, rotate_z deg)], (x0, y0) of its footprint's
# lower-left corner on the bed). Parts of one object share a frame (as exported) and keep it.
PLATES = [
    ('plate-0a-test-seam-lap', 'Test: seam lap (PLA Wood)', [
        ('seam lap, half A', [('seam A', C + 'coupon-128-seam-A-walnut.stl', 0)], (98.0, 125.6)),
        ('seam lap, half B', [('seam B', C + 'coupon-128-seam-B-walnut.stl', 0)], (146.8, 125.6)),
    ]),
    ('plate-0b-test-diffuser-joint', 'Test: diffuser joint (0.2 nozzle, white + black)', [
        ('diffuser joint coupon', [('white face', C + 'coupon-128-diffuser-joint-white.stl', 0),
                                   ('black grid', C + 'coupon-128-diffuser-joint-black.stl', 0)], (109.5, 95.7)),
    ]),
    ('plate-0c-test-splice', 'Test: splice plate holes (PETG)', [
        ('splice plate coupon', [('splice coupon', C + 'coupon-128-splice-plates.stl', 0)], (104.5, 104.0)),
    ]),
    ('plate-1-shell', 'Shell halves (PLA Wood, back rim down, 5 mm brim)', [
        ('shell half A (left)', [('shell A', P + 'bar128-shell-A-walnut-backdown.stl', 0)], (39.4, 135.5)),
        ('shell half B (right)', [('shell B', P + 'bar128-shell-B-walnut-backdown.stl', 0)], (41.5, 25.0)),
    ]),
    ('plate-2-trays', 'Trays + splice plates + Boot key + sensor sled (black PETG; tray B window translucent PETG)', [
        ('tray A (left)', [('tray A', P + 'bar128-tray-A.stl', 0)], (10.0, 126.0)),
        ('tray B (right, S3)', [('tray B', P + 'bar128-tray-B.stl', 0),
                                ('window (translucent)', P + 'bar128-tray-B-window.stl', 0)], (10.0, 24.0)),
        ('splice plates', [('splice plates', P + 'bar128-splice-plates.stl', 90)], (196.0, 78.0)),
        ('Boot key', [('Boot key', 'bar-boot-key.stl', 0)], (218.0, 140.0)),
        ('sensor sled (optional)', [('sensor sled', 'v5-drawer-p25/bar-sensor-sled.stl', 0)], (218.0, 196.0)),
    ]),
    ('plate-3-diffusers', 'Diffusers (0.2 nozzle, white face + black grid, face down)', [
        ('diffuser A (left)', [('white face', P + 'bar128-diffuser-A-white.stl', 0),
                               ('black grid', P + 'bar128-diffuser-A-black.stl', 0)], (43.0, 140.0)),
        ('diffuser B (right)', [('white face', P + 'bar128-diffuser-B-white.stl', 0),
                                ('black grid', P + 'bar128-diffuser-B-black.stl', 0)], (43.0, 27.0)),
    ]),
]
MARGIN = {'plate-1-shell': 5.0}             # brim: keep this much more from the bed edge and between objects
GAP = 4.0                                   # minimum clear gap between objects (plus brims)


def load(rel, rot):
    t = trimesh.load(os.path.join(STL, rel), process=False)
    if rot:
        t.apply_transform(trimesh.transformations.rotation_matrix(np.radians(rot), [0, 0, 1]))
    return t


def place(parts, at):
    """parts keep their shared frame; the group's footprint lower-left goes to `at`, its lowest point to z 0"""
    lo = np.min([m.bounds[0] for _, m in parts], axis=0)
    off = np.array([at[0] - lo[0], at[1] - lo[1], -lo[2]])
    out = []
    for n, m in parts:
        m = m.copy()
        m.apply_translation(off)
        out.append((n, m))
    return out


def mesh_xml(oid, name, m):
    v = np.asarray(m.vertices)
    f = np.asarray(m.faces)
    vs = ''.join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a, b, c in v)
    ts = ''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in f)
    return (f'<object id="{oid}" name="{escape(name)}" type="model"><mesh><vertices>{vs}</vertices>'
            f'<triangles>{ts}</triangles></mesh></object>')


def write_3mf(path, title, objects):
    """objects: [(name, [(part name, mesh in bed coords)])]. A multi-part object is a parent with components."""
    res, build, oid = [], [], 1
    for name, parts in objects:
        if len(parts) == 1:
            res.append(mesh_xml(oid, name, parts[0][1]))
            build.append(f'<item objectid="{oid}"/>')
            oid += 1
            continue
        ids = []
        for pn, m in parts:
            res.append(mesh_xml(oid, pn, m))
            ids.append(oid)
            oid += 1
        comps = ''.join(f'<component objectid="{i}"/>' for i in ids)
        res.append(f'<object id="{oid}" name="{escape(name)}" type="model"><components>{comps}</components></object>')
        build.append(f'<item objectid="{oid}"/>')
        oid += 1
    model = ('<?xml version="1.0" encoding="UTF-8"?>\n'
             '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
             f'<metadata name="Title">{escape(title)}</metadata><metadata name="Application">ctamap plates128.py</metadata>'
             f'<resources>{"".join(res)}</resources><build>{"".join(build)}</build></model>')
    ctypes = ('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
              '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
            'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:      # fixed timestamps: a plate only changes with its parts
        for name, data in (('[Content_Types].xml', ctypes), ('_rels/.rels', rels), ('3D/3dmodel.model', model)):
            z.writestr(zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)), data, compress_type=zipfile.ZIP_DEFLATED)


def check(stem, objects):
    """every object on the bed with its margin, no two footprints closer than GAP (+ brims)"""
    m = MARGIN.get(stem, 0.0)
    boxes = []
    for name, parts in objects:
        lo = np.min([p.bounds[0] for _, p in parts], axis=0)
        hi = np.max([p.bounds[1] for _, p in parts], axis=0)
        assert lo[0] >= m - 1e-6 and lo[1] >= m - 1e-6 and hi[0] <= BED - m + 1e-6 and hi[1] <= BED - m + 1e-6, \
            f'{stem}: {name} off the bed ({lo[:2].round(1)} .. {hi[:2].round(1)}, margin {m})'
        assert abs(lo[2]) < 1e-6, f'{stem}: {name} not on the bed'
        boxes.append((name, lo, hi))
    for i, (na, la, ha) in enumerate(boxes):
        for nb, lb, hb in boxes[i + 1:]:
            gx = max(lb[0] - ha[0], la[0] - hb[0])
            gy = max(lb[1] - ha[1], la[1] - hb[1])
            assert max(gx, gy) >= GAP + 2 * m - 1e-6, f'{stem}: {na} and {nb} only {max(gx, gy):.1f} apart'
    return boxes


def main():
    os.makedirs(OUT, exist_ok=True)
    views = []
    for stem, title, objs in PLATES:
        placed = [(name, place([(pn, load(f, r)) for pn, f, r in parts], at)) for name, parts, at in objs]
        boxes = check(stem, placed)
        write_3mf(os.path.join(OUT, stem + '.3mf'), title, placed)
        views.append((stem, title, placed))
        h = max(hi[2] for _, _, hi in boxes)
        print(f'{stem + ".3mf":34s} {len(placed)} objects, tallest {h:5.1f} mm   ' +
              ', '.join(f'{n} {hi[0] - lo[0]:.0f}x{hi[1] - lo[1]:.0f}' for n, lo, hi in boxes))
    top_views(views, os.path.join(OUT, 'plates.png'))


def top_views(views, path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    fig, axs = plt.subplots(2, 3, figsize=(15, 10.4), dpi=110)
    cols = {'white face': '#d9d9d4', 'window (translucent)': '#8fc4ff', 'black grid': '#333333'}
    for ax, (stem, title, placed) in zip(axs.flat, views):
        ax.add_patch(plt.Rectangle((0, 0), BED, BED, fc='#f3f1ee', ec='#888', lw=1))
        for name, parts in placed:
            for pn, m in sorted(parts, key=lambda p: p[0] != 'black grid'):
                tri = m.vertices[m.faces][:, :, :2]
                up = m.face_normals[:, 2] > 0.2
                c = cols.get(pn, '#6b4a33' if 'shell' in pn or 'seam' in pn else '#1d1f22')
                ax.add_collection(PolyCollection(tri[up], facecolors=c, edgecolors='none', alpha=0.95))
            lo = np.min([p.bounds[0] for _, p in parts], axis=0)
            hi = np.max([p.bounds[1] for _, p in parts], axis=0)
            ax.text((lo[0] + hi[0]) / 2, hi[1] + 2, name, ha='center', va='bottom', fontsize=7.5, color='#333')
        ax.set_xlim(-6, BED + 6)
        ax.set_ylim(-6, BED + 10)
        ax.set_aspect('equal')
        ax.set_xticks([0, 128, 256])
        ax.set_yticks([0, 128, 256])
        ax.tick_params(labelsize=7)
        ax.set_title(f'{stem}\n{title}', fontsize=8.5)
    fig.suptitle('128 x 32 bar: print plates on the X2D (256 x 256), top view', fontsize=11)
    fig.tight_layout()
    fig.savefig(path)


if __name__ == '__main__':
    main()
