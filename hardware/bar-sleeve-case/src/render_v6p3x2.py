"""Renders of the 128 P3 V6 (v6p3x2.py):  python3 render_v6p3x2.py <stl dir from v6p3x2.py> <out dir>
Writes p3x2v6-1-closed.png, -2-apart.png, -3-joint.png, -4-diffuser-seam.png (img/p3x2-v6-*.png are these)."""
import os, sys, math
STL, OUT = sys.argv[1], sys.argv[2]
sys.argv = [sys.argv[0], STL, '--chassis']          # v6p3x2's chassis stage (the panel frame), its frames from STL/frames
import numpy as np
import trimesh
from manifold3d import Manifold, Mesh
import rend as R
import v6p3x2 as M
from v6p3x2 import S, box, cyl_z, DR, H, D, ZC, KY, CO
import knob as KN

os.makedirs(OUT, exist_ok=True)
CENTRE = np.array([0, D / 2, H / 2])
R.MATS.update(
    petg=('plain', (0.30, 0.30, 0.325), 0.06, 40, 0.008),
    screw=('plain', (0.035, 0.035, 0.04), 0.30, 70, 0.05),
    pcb=('plain', (0.08, 0.36, 0.24), 0.05, 30, 0.0),
    brass=('plain', (0.72, 0.58, 0.28), 0.30, 60, 0.08),
    new=('plain', (0.93, 0.50, 0.10), 0.04, 30, 0.0),
)
P = M.build(f'{STL}/frames')
KX = S.KX + M.PANEL_CX
here = os.path.dirname(os.path.abspath(__file__))
t = trimesh.load(os.path.join(here, '..', 'stl', 'bar-knob.stl'))
KNOB = Manifold(Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))
b = KNOB.bounding_box()
KNOB = KNOB.translate([KX - (b[0] + b[3]) / 2, KY - (b[1] + b[4]) / 2, H + KN.SKIRT_Z - b[2]])


def parts(sleeve=True, chassis=True, inside=True, knob=True, screws=True, clip=None, tongue_new=False):
    out = []

    def add(name, m, mat, grp, **kw):
        if clip is not None:
            m = m ^ clip
        if m.is_empty():
            return
        p = R.Part(name, m, mat, **kw); p.grp = grp
        out.append(p)
    if sleeve:
        add('sleeve_a', P['sleeve_a'], 'walnut', 'sleeve_a', seed=1)
        add('sleeve_b', P['sleeve_b'], 'walnut', 'sleeve_b', seed=2)
        add('keys', P['keys'], 'new', 'sleeve_b')
    if chassis:
        if tongue_new:
            add('chassis_a', P['chassis_a'] - P['joint_add'], 'petg', 'chassis')
            add('tongues', P['chassis_a'] ^ P['joint_add'], 'new', 'chassis')
        else:
            add('chassis_a', P['chassis_a'], 'petg', 'chassis')
        add('chassis_b', P['chassis_b'], 'petg', 'chassis')
        add('s3', P['s3'], 'pcb', 'chassis')
    if inside:
        add('panel', P['panel'], 'panel', 'panel')
        add('standoffs', P['standoffs'], 'brass', 'panel')
        add('splice', P['splice'], 'new', 'panel')
        add('diffuser', P['diffuser'], 'diffuser', 'panel')
    if knob:
        add('encoder', P['encoder'], 'pcb', 'enc')
        add('collar', P['collar'], 'ring', 'collar')
        add('knob', KNOB, 'knob', 'knob')
    if screws:
        add('under', P['under'], 'screw', 'screws')
        add('joint', P['jscrews'], 'screw', 'chassis')
        if chassis:
            add('back', P['back'], 'screw', 'chassis')
    return out


def persp(eye_dir, size=(1700, 900), dist=1150, target=CENTRE, yfov=0.42):
    e = np.array(eye_dir, float); e /= np.linalg.norm(e)
    return R.Cam(R.look_at(np.array(target) + dist * e, target), size, yfov=yfov)


def ortho(direction, size, pxmm, target=CENTRE, up=(0, 0, 1)):
    d = np.array(direction, float)
    return R.Cam(R.look_at(np.array(target) + 900 * d, target, up), size, xmag=size[0] / pxmm / 2)


def annotate(img, cam, notes, fs=24):
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    f = R.font(fs)
    for text, pt, (dx, dy), anchor in notes:
        x, y = cam.project(pt)
        tx, ty = x + dx, y + dy
        for col, w in ((R.BG, 7), (R.INK, 2)):
            d.line([x, y, tx, ty], fill=col, width=w)
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=R.INK, outline=R.BG)
        R.label(d, (tx + (10 if anchor[0] == 'l' else -10 if anchor[0] == 'r' else 0), ty), text, f, anchor=anchor)
    return img


def save(img, name):
    p = os.path.join(OUT, name); img.save(p); print('wrote', p, flush=True)


def moved(ps, off):
    return [p.moved(offset=off.get(p.grp, (0, 0, 0))) for p in ps]


sc = R.Scene(parts(), ground=-0.3)
a = sc.render(persp((-0.6, -1.3, 0.45)))
b = sc.render(persp((0.7, 1.25, 0.5)), flip=True)
save(R.titled(R.stack([a, b]), '128 P3 V6: closed',
              f'{2 * P["sleeve_b"].bounding_box()[3]:.0f} x {H:.1f} x {D:.0f}. Two walnut halves, no glue: a {M.SEAM_GAP:g} line with a 0.5 x 45 deg V at the panel seam. Knob 45 mm from the right end.'), 'p3x2v6-1-closed.png')

off = dict(chassis=(0, 170, 0), sleeve_a=(-40, -60, 0), sleeve_b=(40, -60, 0), panel=(0, 40, 0), collar=(0, -60, 60), knob=(0, -60, 110), enc=(0, -60, -10), screws=(0, 0, -50))
sc = R.Scene(moved(parts(tongue_new=True), off))
cam = persp((-0.75, 1.0, 0.85), size=(1900, 1300), dist=1250, target=CENTRE + np.array([0, 60, 15]))
im = sc.render(cam, ground=False)
annotate(im, cam, [('walnut halves A and B: each seats on its own chassis half, two flat heads from below', (-120, -60, H), (-40, -150), 'mb'),
                   ('panel pair: splice plates on the inner inserts (orange), standoffs', (-60, 70, ZC + 40), (-260, -40), 'rm'),
                   ('chassis A + B, joined first: A\'s tongues (orange) inside B\'s walls, four screws', (10, 170 + 40, S.ZO1), (60, -170), 'lb')], fs=24)
save(R.titled(im, 'How it goes together',
              'The P3 V6\'s order with both halves at once: walnut face down, panel pair in, encoder into its collar (B), then the joined chassis; four screws from below.'), 'p3x2v6-2-apart.png')

# the joint: from above with the walnut off, and a section across the seam through a tongue screw
y0 = M.TONGUE_YS[0]
sc = R.Scene(parts(sleeve=False, knob=False, inside=True, tongue_new=True, clip=box(-45, 45, -50, 200, -50, 300)))
cam = persp((0.15, 0.55, 1.0), size=(1200, 1000), dist=230, target=np.array([0, 45, H - 8]), yfov=0.5)
a = sc.render(cam, ground=False)
annotate(a, cam, [('B\'s wall: two M3 x 10 flat heads (staggered), flush (the walnut covers them)', (M.CH_GAP / 2 + M.TONGUE_SCREWS[1][0], M.TONGUE_SCREWS[1][1], S.ZO1), (60, -170), 'lb'),
                  ('A\'s tongue (orange) under B\'s wall', (8, 31, S.ZIN1 - 3), (-150, 170), 'rt')], fs=22)
ps = parts(knob=False, clip=box(-30, 30, y0 - 0.25, y0 + 0.25, -50, 300))
sc2 = R.Scene(ps)
cam2 = ortho((0, -1, 0), (1300, 1000), 30.0, target=np.array([0, y0, H - 9]))
c = sc2.render(cam2, ground=False, crease=0.0)
annotate(c, cam2, [(f'walnut seam {M.SEAM_GAP:g} with a 0.5 x 45 deg V each side', (0, y0, H - 0.3), (-120, -110), 'rb'),
                   ('chassis seam 0.3: A\'s tongue spans it under the walnut seam', (0, y0, S.ZIN1 - 3), (140, 150), 'lt'),
                   ('seam key (loose PETG, orange) in both halves\' rebates', (-30, y0, H - 4.0 - 0.7), (-40, 120), 'lt'),
                   ('insert in the tongue', (M.CH_GAP / 2 + M.TONGUE_SCREWS[0][0], y0, S.ZIN1 - 4), (170, 60), 'lm')], fs=22)
save(R.titled(R.row([a, c]), 'The joint: tongues in the chassis, a plain line in the walnut',
              f'Left: from above, walnut off. Right: section {y0:g} mm back, through a tongue screw. The walnut carries no load across the seam.'), 'p3x2v6-3-joint.png')

# the diffuser seam, from the front
sc = R.Scene(parts(chassis=False, knob=False, screws=False, clip=box(-14, 14, -50, 200, ZC - 12, ZC + 12)))
cam = ortho((0, -1, 0), (1200, 1000), 42.0, target=np.array([0, 10, ZC]))
a = sc.render(cam, ground=False, crease=0.0)
annotate(a, cam, [(f'each half ends in its own {M.panel.P["rib"]:g} mm grid wall: the seam rib is two walls, closed on both sides', (0, 12, ZC + 6), (40, -120), 'lb')], fs=22)
save(R.titled(a, 'The diffuser seam', 'Front view at the panel seam (walnut cut away above and below): no open or half cell either side.'), 'p3x2v6-4-diffuser-seam.png')
