"""Fit checks for the two-panel bar (p3x2.py): run after it, on its <outdir>/frames folder (case-frame copies).
Reports overlaps between parts that should only touch (volume, mm3), the positions that have to line up between the
shell (PANEL=p3x2 run) and the trays (PANEL=p3 run), the encoder's QT sockets, and the bed fit of every print file.
Run: python3 check_p3x2.py <outdir>        (WIDE=p25x2 for the P2.5 pair, as p3x2.py)"""
import json, math, os, sys
out = sys.argv[1]
F = f'{out}/frames'
case = json.load(open(f'{F}/case.json'))
os.environ['WIDE'] = case['wide']
import numpy as np
import trimesh
from manifold3d import Manifold, CrossSection, Mesh
import p3x2 as B
import drawer as DR
from case import box, cyl_y, ZC, H, D, Y_FACE, PANEL_BACK


def load(n):
    t = trimesh.load(f'{F}/{n}.stl', process=True)
    t.merge_vertices()
    return Manifold(Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))


def dif_case(m):
    """diffuser frame -> case frame (face at Y_FACE, turned so A (x < 0) lands on the left)"""
    return m.transform([[1, 0, 0, 0], [0, 0, 1, Y_FACE], [0, -1, 0, ZC]])


tr = json.load(open(f'{F}/trays.json'))
cx = case['panel_cx']
P = {n: load(n) for n in ('shell-A', 'shell-B', 'tray-A', 'tray-B', 'env-s3', 'env-sensor', 'env-sled', 'env-encoder',
                          'splice-top', 'splice-bot', 'plate-top', 'plate-bot')}
for s in 'AB':
    d = load(f'diffuser-{s}-white') + load(f'diffuser-{s}-black')
    P[f'diff-{s}'] = dif_case(d.scale([1 - B.DIFF_SHRINK, 1 - B.DIFF_SHRINK, 1.0]))   # as printed and shrunk
# A's joint rib is JOINT_RIB wide; the extra over a normal rib is the gap the butted panels leave, so B and its diffuser
# sit that much further right
P['diff-B'] = P['diff-B'].translate([case['joint_rib'] - 2 * B.HALF, 0, 0])   # (and panel B below, by the same)
# the S3 envelope's component boxes overrun its own mounting holes a little (the real parts clear them); take the
# tray's S3 posts out of that pair, as the single v5 checks do
P['env-s3'] = P['env-s3'] - Manifold.batch_boolean([cyl_y(x, z, 0, D, 6.4, 32) for x, z in B.DR.S3_HOLES], B.ADD)   # (case x already: the wide profile)
yled = Y_FACE + case['skin'] + case['grid_h']
import panel
hz = panel.P['h'] / 2
gap = case['joint_rib'] - 2 * B.HALF                                  # the butted panels' gap A's wider joint rib allows for
P['panel-A'] = box(-2 * cx, 0, yled, PANEL_BACK, ZC - hz, ZC + hz)
P['panel-B'] = box(gap, 2 * cx + gap, yled, PANEL_BACK, ZC - hz, ZC + hz)

pairs = [('shell-A', 'tray-A'), ('shell-B', 'tray-B'), ('shell-A', 'tray-B'), ('shell-B', 'tray-A'), ('tray-A', 'tray-B'),
         ('tray-A', 'panel-A'), ('tray-B', 'panel-B'), ('tray-A', 'panel-B'), ('tray-B', 'panel-A'),
         ('tray-A', 'splice-top'), ('tray-A', 'splice-bot'), ('tray-B', 'splice-top'), ('tray-B', 'splice-bot'),
         ('splice-top', 'panel-A'), ('splice-top', 'panel-B'), ('splice-bot', 'panel-A'), ('splice-bot', 'panel-B'),
         ('diff-A', 'diff-B'), ('diff-A', 'shell-A'), ('diff-A', 'shell-B'), ('diff-B', 'shell-B'), ('diff-A', 'panel-B'),
         ('diff-A', 'tray-A'), ('diff-B', 'tray-B'), ('diff-A', 'tray-B'),
         ('env-s3', 'tray-B'), ('env-s3', 'shell-B'),
         ('env-sensor', 'tray-B'), ('env-sled', 'tray-B'), ('env-sensor', 'shell-B'), ('env-encoder', 'tray-B'),
         ('env-encoder', 'panel-B'), ('env-encoder', 'shell-B'), ('env-encoder', 'env-sensor'),
         ('env-encoder', 'env-s3'), ('env-sensor', 'env-s3'), ('env-sled', 'env-s3'),
         ('plate-top', 'tray-A'), ('plate-top', 'tray-B'), ('plate-bot', 'tray-A'), ('plate-bot', 'tray-B'),
         ('plate-top', 'shell-A'), ('plate-top', 'shell-B'), ('plate-bot', 'shell-A'), ('plate-bot', 'shell-B'), ('plate-top', 'diff-A'), ('plate-top', 'diff-B')]
print('overlaps (mm3; crush ribs into the shell and into the joint plates, and post feet 0.3 into the panel are intended; plates x shells must be 0):')
res = {}
for a, b in pairs:
    v = (P[a] ^ P[b]).volume()
    res[f'{a} x {b}'] = round(v, 2)
    print(f'  {a:12s} x {b:12s} {v:9.2f}')
# the hex standoffs on the splice plates (M3 male-female, STANDOFF_AF across flats, STANDOFF_L tall, trays.json
# 'standoff'), which the inner posts stand on: seated, each post's floor sits 0.3 into the standoff's top (as the outer
# posts' feet sit 0.3 into the panel), so the expected overlap is 4 x 0.3 x (hex area less the Ø POST_HOLE hole); with
# the tray 0.7 off any way (the posts' float) the hex top must stay under the floor, so the overlap barely changes
sp = case['splice']
so_l, so_af = tr['standoff']
hexcs = CrossSection.circle(so_af / math.sqrt(3), 6)
standoffs = Manifold.batch_boolean([Manifold.extrude(hexcs, so_l).rotate([-90, 0, 0]).translate([sx * sp['x'], PANEL_BACK + sp['t'], ZC + z + (0 if sx < 0 else -sp['dz'])])
                                    for sx in (-1, 1) for z in sp['za']], B.ADD)
hex_area = 6 * (so_af / math.sqrt(3)) ** 2 * math.sqrt(3) / 4 - math.pi * (DR.POST_HOLE / 2) ** 2
seated = sum((P[t] ^ standoffs).volume() for t in ('tray-A', 'tray-B'))
offs = [sum((P[t].translate([0.7 * math.cos(a), 0, 0.7 * math.sin(a)]) ^ standoffs).volume() for t in ('tray-A', 'tray-B'))
        for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
print(f'  standoffs vs tray posts, seated {seated:9.2f}  (expected {4 * 0.3 * hex_area:.2f}: 0.3 into the floors)')
print(f'  standoffs vs tray posts, tray 0.7 off any way {min(offs):9.2f} .. {max(offs):.2f}  (the hex top stays on the floor)')
res['standoffs x trays seated'] = round(seated, 2)
res['standoffs x trays (0.7 off)'] = round(max(offs), 2)
# the encoder's STEMMA QT plugs (out 7 mm past each side edge of its board, under it) vs tray B seated and sliding in
import sensor as SN
kx, ky = case['knob_x'], tr['ky']
CT = P['tray-B']
print('encoder QT plugs (mm3, vs tray B seated / worst while it slides in 0-56 mm):')
for side, sx in (('left', -1), ('right', 1)):
    xa, xb = sorted((kx + sx * 7.7, kx + sx * (12.7 + 7.0)))
    plug = box(xa, xb, ky - 3.0, ky + 3.0, SN.EB_BOT - 2.96, SN.EB_BOT)
    seat = (plug ^ CT).volume() + (plug ^ P['env-s3']).volume()
    slide = max((plug ^ CT.translate([0, dy, 0])).volume() for dy in np.arange(0, 56, 2.0))
    print(f'  {side:5s} socket  {seat:8.2f} / {slide:8.2f}  ' + ('clear' if max(seat, slide) < 1e-3 else 'BLOCKED (use the other socket)'))
    res[f'encoder {side} QT plug (sliding)'] = round(max(seat, slide), 2)
left_ok = res['encoder left QT plug (sliding)'] < 1e-3
print('alignment:')
ok = True


def chk(name, a, b, tol=0.05):
    global ok
    good = abs(a - b) <= tol
    ok &= good
    print(f'  {name:44s} shell {a:8.2f}  tray {b:8.2f}  {"ok" if good else "OFF"}')


chk('knob x (shell hole vs tray B encoder slot)', case['knob_x'], tr['knob_x'])
chk('light sensor x', case['sensor_x'], tr['sensor_x'])
chk('USB-C z', case['port_z'], tr['port_z'])
xs = sorted([s * x for s in (-1, 1) for x in case['screw_xs']])
for x_s, x_t in zip(xs, sorted(tr['bottom_xs'])):
    chk(f'screw from below at x {x_s:+.0f}', x_s, x_t)
chk('screw y (shell hole vs tray boss, tray seated 0.3 back)', case['screw_y'], tr['bot_y'] + 0.3)
for side in 'AB':
    for x, z in tr['corners'][side]:
        inner = abs(x) < cx
        print(f'  tray {side} post at ({x:+7.2f}, {z:+6.2f}): {"on a splice plate" if inner else "on the panel"}')
print('bed (256 x 256):')
for f in sorted(os.listdir(out)):
    if f.endswith('.stl'):
        t = trimesh.load(os.path.join(out, f))
        e = t.extents
        fits = max(e[0], e[1]) <= 250
        print(f'  {f:44s} {e[0]:6.1f} x {e[1]:6.1f} x {e[2]:5.1f}  {"fits" if fits else "TOO BIG"}')
json.dump(dict(overlaps=res, aligned=ok, encoder_left_socket_clear=left_ok), open(f'{F}/check.json', 'w'), indent=1)
print('all aligned' if ok else 'MISALIGNED')
print('encoder left-hand socket (toward the centre) clear' if left_ok else 'ENCODER LEFT-HAND SOCKET BLOCKED')
