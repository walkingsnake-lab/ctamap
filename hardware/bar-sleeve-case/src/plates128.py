"""Print plates for the 128 x 32 bar (P25-128-BUILD.md): one 3MF per plate, parts laid out on the X2D's 256 x 256 bed in
print orientation, each two-colour part one object with its two parts in register (diffusers: white face + black grid;
tray B: tray + window). Built from the committed STLs, so run bar128.py first when the parts change:

    python3 plates128.py [stl dir, default ../stl] [out dir, default ../stl/p25-128x32/plates]

Bambu Studio's own project layout (objects in 3D/Objects/, Metadata/model_settings.config) WITHOUT project settings, so
opening one keeps the printer, filament and process presets already selected and takes from the file only: the
geometry, the plate's name, each part's filament slot (1: the plate's main filament; 2: the diffuser grid, tray B's
window) and per-object overrides (SHELL, TRAY, DIFFUSER below: walls, brim, seam, infill, elephant foot, layer
height). Bambu Studio notes that it loaded "geometry data only": that refers to the presets it didn't find. A generic
core-spec 3MF (the first version of this) makes it fall back to its foreign-3MF path, which can add filaments and
reset presets. Format: BambuStudio src/libslic3r/Format/bbs_3mf.cpp. Also writes a top view of every plate
(plates.png) to check the layout. Single-part extras (knob, collar, case cleats) print from their own STLs."""
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

# per-object overrides, Bambu Studio keys and value strings (README "Print settings"); only per-object options, none of
# them per-nozzle (print_options_with_variant). Plate-wide ones (first layer height, nozzle, Z hop, bed) are the build
# sheet's to set.
SHELL = {'layer_height': '0.16', 'wall_loops': '4', 'elefant_foot_compensation': '0.15', 'brim_type': 'outer_only',
         'brim_width': '5', 'brim_object_gap': '0.1', 'seam_position': 'aligned', 'seam_slope_type': 'none'}
# (seam Aligned, no scarf: the shell's sharpest inside corners are in the joint by design, bar128.py split_shell)
TRAY = {'layer_height': '0.24', 'wall_loops': '4', 'top_shell_layers': '4', 'bottom_shell_layers': '4',
        'sparse_infill_density': '15%', 'sparse_infill_pattern': 'gyroid', 'bottom_surface_pattern': 'monotonic',
        'elefant_foot_compensation': '0.15'}
DIFFUSER = {'bottom_surface_pattern': 'monotonic', 'elefant_foot_compensation': '0'}
SLOT2 = {'black grid', 'window (translucent)'}             # parts on filament slot 2; everything else slot 1

# plate: (file stem, title, settings, [objects]); object: (name, [(part name, stl, rotate_z deg)], (x0, y0) of its
# footprint's lower-left corner on the bed). Parts of one object share a frame (as exported) and keep it.
PLATES = [
    ('plate-0a-test-seam-joint', 'Test: shell joint, 3 clearances (PLA Wood, 5 mm brim)', SHELL, [
        ('joint, half A x3 (tongues)', [('seam A', C + 'coupon-128-seam-A-walnut.stl', 0)], (100.0, 107.0)),
        ('joint, half B x3 (grooves)', [('seam B', C + 'coupon-128-seam-B-walnut.stl', 0)], (143.7, 107.0)),
    ]),
    ('plate-0b-test-diffuser-joint', 'Test: diffuser joint (0.2 nozzle, white + black)', DIFFUSER, [
        ('diffuser joint coupon', [('white face', C + 'coupon-128-diffuser-joint-white.stl', 0),
                                   ('black grid', C + 'coupon-128-diffuser-joint-black.stl', 0)], (109.5, 95.7)),
    ]),
    ('plate-0c-test-splice', 'Test: splice plate holes (PETG)', TRAY, [
        ('splice plate coupon', [('splice coupon', C + 'coupon-128-splice-plates.stl', 0)], (104.5, 104.0)),
    ]),
    ('plate-1-shell', 'Shell halves (PLA Wood, back rim down, 5 mm brim)', SHELL, [
        ('shell half A (left)', [('shell A', P + 'bar128-shell-A-walnut-backdown.stl', 0)], (39.4, 135.5)),
        ('shell half B (right)', [('shell B', P + 'bar128-shell-B-walnut-backdown.stl', 0)], (41.5, 25.0)),
    ]),
    ('plate-2-trays', 'Trays + splice plates + Boot key + sensor sled (black PETG; tray B window translucent PETG)', TRAY, [
        ('tray A (left)', [('tray A', P + 'bar128-tray-A.stl', 0)], (10.0, 126.0)),
        ('tray B (right, S3)', [('tray B', P + 'bar128-tray-B.stl', 0),
                                ('window (translucent)', P + 'bar128-tray-B-window.stl', 0)], (10.0, 24.0)),
        ('splice plates', [('splice plates', P + 'bar128-splice-plates.stl', 90)], (196.0, 78.0)),
        ('Boot key', [('Boot key', 'bar-boot-key.stl', 0)], (218.0, 140.0)),
        ('sensor sled (optional)', [('sensor sled', 'v5-drawer-p25/bar-sensor-sled.stl', 0)], (218.0, 196.0)),
    ]),
    ('plate-3-diffusers', 'Diffusers (0.2 nozzle, white face + black grid, face down)', DIFFUSER, [
        ('diffuser A (left)', [('white face', P + 'bar128-diffuser-A-white.stl', 0),
                               ('black grid', P + 'bar128-diffuser-A-black.stl', 0)], (43.0, 140.0)),
        ('diffuser B (right)', [('white face', P + 'bar128-diffuser-B-white.stl', 0),
                                ('black grid', P + 'bar128-diffuser-B-black.stl', 0)], (43.0, 27.0)),
    ]),
    ('plate-4-wall-cleat', 'Wall cleat, optional (PETG, wall face down, at 45 deg: 293 mm long)', TRAY, [
        ('wall cleat', [('wall cleat', P + 'bar128-cleat-wall.stl', 45)], (12.2, 12.2)),
    ]),
]
MARGIN = {'plate-1-shell': 5.0, 'plate-0a-test-seam-joint': 5.0}             # brim: keep this much more from the bed edge and between objects
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


NS = ('xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
      'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"')
APP = 'BambuStudio-02.00.02.01'   # a released version older than any that knows the X2D: a newer one would raise a dialog


def uuid(kind, n):
    return f'{kind:08x}-{n:04x}-4000-8000-{n:012x}'


def mesh_xml(oid, m):
    v = np.asarray(m.vertices)
    f = np.asarray(m.faces)
    vs = ''.join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a, b, c in v)
    ts = ''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in f)
    return (f'<object id="{oid}" p:UUID="{uuid(2, oid)}" type="model"><mesh><vertices>{vs}</vertices>'
            f'<triangles>{ts}</triangles></mesh></object>')


def write_3mf(path, title, settings, objects):
    """objects: [(name, [(part name, mesh in bed coords)])] -> a Bambu Studio project 3MF without project settings.
    Each object: its parts (mesh objects, object frame: footprint centred on the origin, bottom at z 0) in
    3D/Objects/object_<n>.model, a parent with one component per part in 3D/3dmodel.model, a build item placing it on
    the bed; names, filament slots and `settings` in Metadata/model_settings.config, with the plate."""
    files, comps, items, cfg, inst = {}, [], [], [], []
    oid = 1
    for k, (name, parts) in enumerate(objects, 1):
        lo = np.min([m.bounds[0] for _, m in parts], axis=0)
        hi = np.max([m.bounds[1] for _, m in parts], axis=0)
        c = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
        sub, pids, pcfg = f'3D/Objects/object_{k}.model', [], []
        body = []
        for pn, m in parts:
            m = m.copy()
            m.apply_translation(-c)
            body.append(mesh_xml(oid, m))
            pids.append(oid)
            slot = 2 if pn in SLOT2 else 1
            pcfg.append(f'    <part id="{oid}" subtype="normal_part">\n      <metadata key="name" value="{escape(pn)}"/>\n'
                        f'      <metadata key="extruder" value="{slot}"/>\n'
                        f'      <mesh_stat face_count="{len(m.faces)}" edges_fixed="0" degenerate_facets="0" facets_removed="0" '
                        f'facets_reversed="0" backwards_edges="0"/>\n    </part>\n')
            oid += 1
        files[sub] = (f'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" {NS}>'
                      f'<metadata name="BambuStudio:3mfVersion">1</metadata><resources>{"".join(body)}</resources><build/></model>')
        cs = ''.join(f'<component p:path="/{sub}" objectid="{i}" p:UUID="{uuid(3, i)}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>'
                     for i in pids)
        comps.append(f'<object id="{oid}" p:UUID="{uuid(1, oid)}" type="model"><components>{cs}</components></object>')
        items.append(f'<item objectid="{oid}" p:UUID="{uuid(4, oid)}" transform="1 0 0 0 1 0 0 0 1 {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}"/>')
        first = 2 if parts[0][0] in SLOT2 else 1
        meta = ''.join(f'    <metadata key="{key}" value="{escape(val)}"/>\n' for key, val in settings.items())
        cfg.append(f'  <object id="{oid}">\n    <metadata key="name" value="{escape(name)}"/>\n'
                   f'    <metadata key="extruder" value="{first}"/>\n{meta}{"".join(pcfg)}  </object>\n')
        inst.append(f'    <model_instance>\n      <metadata key="object_id" value="{oid}"/>\n'
                    f'      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="{100 + k}"/>\n'
                    f'    </model_instance>\n')
        oid += 1
    model = (f'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" {NS}>\n'
             f' <metadata name="Application">{APP}</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n'
             f' <metadata name="Title">{escape(title)}</metadata>\n'
             f' <resources>{"".join(comps)}</resources>\n <build p:UUID="{uuid(5, 0)}">{"".join(items)}</build>\n</model>\n')
    settings_xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + ''.join(cfg) +
                    '  <plate>\n    <metadata key="plater_id" value="1"/>\n'
                    f'    <metadata key="plater_name" value="{escape(title)}"/>\n    <metadata key="locked" value="false"/>\n'
                    + ''.join(inst) + '  </plate>\n</config>\n')
    rels_model = ('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                  + ''.join(f'<Relationship Target="/{f}" Id="rel-{n}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
                            for n, f in enumerate(files, 1)) + '</Relationships>')
    ctypes = ('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
              '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
              '<Default Extension="config" ContentType="text/xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Target="/3D/3dmodel.model" Id="rel-1" '
            'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    entries = [('[Content_Types].xml', ctypes), ('_rels/.rels', rels), ('3D/3dmodel.model', model),
               ('3D/_rels/3dmodel.model.rels', rels_model)] + list(files.items()) + [('Metadata/model_settings.config', settings_xml)]
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:      # fixed timestamps: a plate only changes with its parts
        for name, data in entries:
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
    for stem, title, settings, objs in PLATES:
        placed = [(name, place([(pn, load(f, r)) for pn, f, r in parts], at)) for name, parts, at in objs]
        boxes = check(stem, placed)
        write_3mf(os.path.join(OUT, stem + '.3mf'), title, settings, placed)
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
    fig, axs = plt.subplots(3, 3, figsize=(15, 15.4), dpi=110)
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
    for ax in list(axs.flat)[len(views):]:
        ax.axis('off')
    fig.suptitle('128 x 32 bar: print plates on the X2D (256 x 256), top view', fontsize=11)
    fig.tight_layout()
    fig.savefig(path)


if __name__ == '__main__':
    main()
