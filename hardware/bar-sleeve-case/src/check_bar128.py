"""Fit checks for the 128 x 32 bar (bar128.py): run after it, with the same frames folder.
Everything in the case frame. Reports overlaps between parts that should only touch (volume, mm3), and the positions
that have to line up between the shell (PANEL=p25x2 run) and the trays (PANEL=p25 run).
Run: python3 check_bar128.py [frames dir]   (default: bar128.py's, $BAR128_FRAMES or the temp dir)"""
import json, math, os, sys
os.environ['PANEL'] = 'p25x2'
os.environ.setdefault('CASE_WALL', '3.5')
import numpy as np
import trimesh
from manifold3d import Manifold, Mesh
import bar128 as B
from case import box, ZC, H, D, Y_FACE, PANEL_BACK

import tempfile
F = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('BAR128_FRAMES', os.path.join(tempfile.gettempdir(), 'bar128-frames'))
STL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'stl', 'p25-128x32')


def load(n):
    t = trimesh.load(f'{F}/{n}.stl', process=True)
    t.merge_vertices()
    return Manifold(Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))


def dif_case(m):
    """diffuser frame -> case frame, turned 180 deg with its panel (as p4.diffuser_in_case): A (x < 0) lands on the left"""
    return m.transform([[1, 0, 0, 0], [0, 0, 1, Y_FACE], [0, -1, 0, ZC]])


case, tr = json.load(open(f'{F}/case.json')), json.load(open(f'{F}/trays.json'))
P = {n: load(n) for n in ('shell-A', 'shell-B', 'tray-A', 'tray-B', 'env-s3', 'env-sensor', 'env-sled', 'env-encoder')}
for s in 'AB':
    P[f'diff-{s}'] = dif_case(load(f'diffuser-{s}-white') + load(f'diffuser-{s}-black'))
yled = Y_FACE + B.DF.SKIN + B.DF.GRID_H
P['panel-A'] = box(-160, 0, yled, PANEL_BACK, ZC - 40, ZC + 40)
P['panel-B'] = box(0, 160, yled, PANEL_BACK, ZC - 40, ZC + 40)
sp = B.splice_plate(B.SPLICE_HOLES[1]).rotate([90, 0, 0])            # plate: x along, thickness along y
sp_y0 = PANEL_BACK
P['splice-top'] = sp.translate([0, sp_y0 + B.SPLICE_T, ZC + 32.25])
P['splice-bot'] = sp.translate([0, sp_y0 + B.SPLICE_T, ZC - 32.25])
shell = P['shell-A'] + P['shell-B']

pairs = [('shell-A', 'tray-A'), ('shell-B', 'tray-B'), ('shell-A', 'tray-B'), ('shell-B', 'tray-A'), ('tray-A', 'tray-B'),
         ('tray-A', 'panel-A'), ('tray-B', 'panel-B'), ('tray-A', 'panel-B'), ('tray-B', 'panel-A'),
         ('tray-A', 'splice-top'), ('tray-A', 'splice-bot'), ('tray-B', 'splice-top'), ('tray-B', 'splice-bot'),
         ('splice-top', 'panel-A'), ('splice-top', 'panel-B'),
         ('diff-A', 'diff-B'), ('diff-A', 'shell-A'), ('diff-A', 'shell-B'), ('diff-B', 'shell-B'), ('diff-A', 'panel-B'),
         ('diff-A', 'tray-A'), ('diff-B', 'tray-B'), ('diff-A', 'tray-B'),
         ('env-s3', 'tray-B'), ('env-s3', 'shell-B'), ('env-sensor', 'tray-A'), ('env-sled', 'tray-A'), ('env-sensor', 'shell-A'),
         ('env-encoder', 'tray-A'), ('env-encoder', 'panel-A'), ('env-encoder', 'shell-A'), ('env-encoder', 'env-sensor')]
print('overlaps (mm3; crush ribs into the shell and post feet 0.3 into the splice plates are intended):')
res = {}
for a, b in pairs:
    v = (P[a] ^ P[b]).volume()
    res[f'{a} x {b}'] = round(v, 2)
    print(f'  {a:12s} x {b:12s} {v:9.2f}')

# splice screw heads (M3 button head, Ø5.7 x 1.65) on the plates, inside the open inner posts, with the tray off by up
# to 0.7 mm in any direction (the outer posts' float)
from case import cyl_y
heads = Manifold.batch_boolean([cyl_y(x, ZC + z, PANEL_BACK + B.SPLICE_T, PANEL_BACK + B.SPLICE_T + 1.7, 5.8, 32)
                                for x in (-B.SPLICE_X, B.SPLICE_X) for z in (-32.25, 32.25)], B.ADD)
worst = max((P[t].translate([0.7 * math.cos(a), 0, 0.7 * math.sin(a)]) ^ heads).volume()
            for t in ('tray-A', 'tray-B') for a in np.linspace(0, 2 * math.pi, 12, endpoint=False))
print(f'  splice screw heads vs trays, tray 0.7 off any way {worst:9.2f}')
res['splice heads x trays (0.7 off)'] = round(worst, 2)
# lined-up features
print('alignment:')
ok = True
def chk(name, a, b, tol=0.05):
    global ok
    good = abs(a - b) <= tol
    ok &= good
    print(f'  {name:44s} shell {a:8.2f}  tray {b:8.2f}  {"ok" if good else "OFF"}')
chk('knob x (shell hole vs tray A encoder slot)', case['knob_x'], tr['knob_x'])
chk('light sensor x', case['sensor_x'], tr['sensor_x'])
chk('USB-C z', case['port_z'], tr['port_z'])
xs = sorted([s * x for s in (-1, 1) for x in case['screw_xs']])
for x_s, x_t in zip(xs, sorted(tr['bottom_xs'])):
    chk(f'screw from below at x {x_s:+.0f}', x_s, x_t)
chk('screw y (shell hole vs tray boss, tray seated 0.3 back)', case['screw_y'], tr['bot_y'] + 0.3)
# posts: the inner ones must stand on the plates, the outer ones on the panels
for x, z in tr['corners']:
    inner = abs(x) < 50
    print(f'  post at ({x:+7.2f}, {z:+6.2f}): {"on a splice plate" if inner else "on the panel"}')
# bed fit
print('bed (256 x 256):')
for f in sorted(os.listdir(STL)):
    if f.endswith('.stl') and not f.startswith('coupon'):
        t = trimesh.load(os.path.join(STL, f))
        e = t.extents
        print(f'  {f:44s} {e[0]:6.1f} x {e[1]:6.1f} x {e[2]:5.1f}  {"fits" if max(e[0], e[1]) <= 250 else "TOO BIG"}')
json.dump(dict(overlaps=res, aligned=ok), open(f'{F}/check.json', 'w'), indent=1)
print('all aligned' if ok else 'MISALIGNED')
