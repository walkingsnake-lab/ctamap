"""Renders of the P3 V6 (v6p3.py):  python3 render_v6p3.py <out dir> [which ...]
which: closed apart back knob encoder (default: all). Needs pyrender on EGL (headless) and rend.py.
Writes p3v6-1-closed.png ... (img/p3-v6-*.png are these)."""
import os, sys, math
import numpy as np
import trimesh
from manifold3d import Manifold, Mesh
import rend as R
import v6p3 as M
from v6p3 import box, cyl_z, DR, H, D, ZC, HW, KY, KX, CO, SN
import knob as KN

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
WHICH = sys.argv[2:] or ['closed', 'apart', 'back', 'knob', 'encoder']
os.makedirs(OUT, exist_ok=True)
CENTRE = np.array([0, D / 2, H / 2])
R.MATS.update(
    petg=('plain', (0.30, 0.30, 0.325), 0.06, 40, 0.008),
    seat=('plain', (0.44, 0.47, 0.53), 0.06, 40, 0.008),
    screw=('plain', (0.035, 0.035, 0.04), 0.30, 70, 0.05),
    pcb=('plain', (0.08, 0.36, 0.24), 0.05, 30, 0.0),
    brass=('plain', (0.72, 0.58, 0.28), 0.30, 60, 0.08),
    new=('plain', (0.93, 0.50, 0.10), 0.04, 30, 0.0),
)

P = M.build()
here = os.path.dirname(os.path.abspath(__file__))
t = trimesh.load(os.path.join(here, '..', 'stl', 'bar-knob.stl'))           # V5's 30 mm P3 knob
KNOB = Manifold(Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))
b = KNOB.bounding_box()
KNOB = KNOB.translate([KX - (b[0] + b[3]) / 2, KY - (b[1] + b[4]) / 2, H + KN.SKIRT_Z - b[2]])
ENC = dict(shaft=cyl_z(0, KY, H + 6.0, H + KN.TIP_Z, 6.0),
           nut=Manifold.cylinder(2.2, 11.0 / math.sqrt(3), 11.0 / math.sqrt(3), 6).translate([0, KY, H + CO.FL_T]) - cyl_z(0, KY, H, H + 9, 7.0))
ENC = {k: M.at_knob(m) for k, m in ENC.items()}             # drawn at x 0: put in place


def parts(sleeve=True, chassis=True, inside=True, knob=True, screws=True, clip=None, enc_dz=0.0):
    out = []
    def add(name, m, mat, grp, **kw):
        if clip is not None:
            m = m ^ clip
        if m.is_empty():
            return
        p = R.Part(name, m, mat, **kw); p.grp = grp
        out.append(p)
    if sleeve:
        add('sleeve', P['sleeve'], 'walnut', 'sleeve', seed=1)
    if chassis:
        add('chassis', P['chassis'], 'petg', 'chassis')
    if inside:
        add('panel', P['panel'], 'panel', 'panel')
        add('standoffs', P['standoffs'], 'brass', 'panel')
        add('s3', P['s3'], 'pcb', 'chassis')
        add('diffuser', P['diffuser'], 'diffuser', 'panel')
    if knob:
        add('encoder', P['encoder'].translate([0, 0, enc_dz]), 'pcb', 'enc')
        add('enc_shaft', ENC['shaft'].translate([0, 0, enc_dz]), 'steel', 'enc')
        add('nut', ENC['nut'], 'steel', 'nut')
        add('collar', P['collar'], 'ring', 'collar')
        add('knob', KNOB, 'knob', 'knob')
    if screws:
        add('under', P['screws']['under'], 'screw', 'sleeve')
        if chassis:
            add('back', P['screws']['back'], 'screw', 'chassis')
    return out


def persp(eye_dir, size=(1600, 1100), dist=760, target=CENTRE, yfov=0.42):
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
    p = os.path.join(OUT, name)
    img.save(p)
    print('wrote', p, flush=True)


def moved(ps, off):
    return [p.moved(offset=off.get(p.grp, (0, 0, 0))) for p in ps]


if 'closed' in WHICH:
    sc = R.Scene(parts(), ground=-0.3)
    a = sc.render(persp((-0.75, -1.3, 0.5)))
    b = sc.render(persp((0.85, 1.25, 0.55)), flip=True)
    save(R.titled(R.row([a, b]), 'P3 V6: closed',
                  f'{2 * HW:.0f} x {H:.1f} x {D:.0f}: the V5 sleeve at the P4 skin\'s 4 mm wall. No screws you can see; V5\'s 30 mm knob on its translucent collar (the NeoPixel lights it).'), 'p3v6-1-closed.png')

if 'apart' in WHICH:
    off = dict(chassis=(0, 150, 0), collar=(0, 0, 60), nut=(0, 0, 85), knob=(0, 0, 115), enc=(0, 0, -30))
    sc = R.Scene(moved(parts(), off))
    cam = persp((-0.9, 1.0, 0.8), size=(1800, 1300), dist=1000, target=CENTRE + np.array([0, 70, 25]))
    im = sc.render(cam, ground=False)
    annotate(im, cam, [('sleeve, with the panel (on its standoffs) and diffuser in it first', (-80, 30, H), (-60, -120), 'mb'),
                       ('chassis (S3, sensor): slides in from the back last', (-90, 150 + 40, M.ZO1), (-120, 150), 'rt'),
                       ('encoder: up into the collar from inside, before the chassis', (KX + 12, KY, SN.EB_TOP - 30), (180, 40), 'lm'),
                       ('V5\'s collar (translucent PETG), nut and 30 mm knob', (KX + 17, KY, H + 60), (160, -20), 'lm')])
    save(R.titled(im, 'How it goes together',
                  'V5\'s order: panel into the sleeve, then the encoder into its collar (its board hangs where the panel slides), then the chassis; two screws from below.'), 'p3v6-2-apart.png')

if 'back' in WHICH:
    x0 = -60.0
    ps = parts(knob=False, clip=box(x0 - 0.5, x0, -50, 200, -50, 300))
    sc = R.Scene(ps)
    cam = ortho((1, 0, 0), (1500, 1000), 42.0, target=np.array([x0, 63.0, H - 3.5]))
    a = sc.render(cam, ground=False, crease=0.0)
    annotate(a, cam, [('walnut, 4 mm', (x0, 52, H - 2), (-60, -70), 'mb'),
                      (f'rebate {M.REB_T:g} deep: {M.WALL - M.REB_T:g} of walnut left', (x0, 67, H - 2.0), (90, -70), 'lb'),
                      ('45 deg seat: the walnut stops here', (x0, M.SEAT_Y - M.REB_T / 2, M.ZO1 + 0.25 + M.REB_T / 2 + 0.25), (220, -150), 'lb'),
                      ('lip on the back plate\'s edge', (x0, 64.8, M.ZO1 + 0.7), (230, 40), 'lm'),
                      ('chassis wall 2.5', (x0, 50, M.ZO1 - 1.2), (-60, 110), 'mt'),
                      ('back plate (on the print bed)', (x0, 64.0, M.ZO1 - 8), (200, 120), 'lt')], fs=22)
    ps = parts(knob=False, clip=box(-46.25, -45.75, -50, 200, -50, 300))
    sc2 = R.Scene(ps)
    cam2 = ortho((1, 0, 0), (1100, 1000), 26.0, target=np.array([-46.0, 60.0, 8.0]))
    b = sc2.render(cam2, ground=False, crease=0.0)
    annotate(b, cam2, [('M3 x 10 flat head, flush in its countersink', (-46, M.DR.BOT_Y, 0.5), (-120, 120), 'mt'),
                       (f'drawn {M.UNDER_BIAS:g} in front of the screw: it pulls the sleeve back onto the seat', (-46, M.DR.BOT_Y - 2.5, 1.0), (-90, 260), 'mt'),
                       ('insert in V5\'s bottom boss', (-46, M.DR.BOT_Y, 7.0), (150, -80), 'lb'),
                       ('the seat, the other end of the wall', (-46, M.SEAT_Y - 0.6, M.ZO0 - 0.6), (180, 140), 'lt')], fs=22)
    save(R.titled(R.row([a, b]), 'The back edge: a hidden rebate and a lip',
                  'Left: section 60 mm left of centre, top wall. Right: through a screw from below. The walnut\'s free back edge now rests on the chassis.'), 'p3v6-3-back.png')

if 'knob' in WHICH:
    ps = parts(clip=box(-200, 200, KY + 7.75, KY + 8.25, -50, 300))
    sc = R.Scene(ps)
    cam = ortho((0, -1, 0), (2000, 1000), 22.0, target=np.array([KX, KY, H - 2.0]))
    a = sc.render(cam, ground=False, crease=0.0)
    annotate(a, cam, [('V5 collar (translucent PETG), crush ribs in the walnut hole', (KX - 16, KY + 8, H + 1.0), (-80, -150), 'rb'),
                      ('encoder clamped up to the collar by its nut', (KX + 6, KY + 8, SN.EB_TOP + 2.5), (160, 170), 'lt'),
                      (f'ledge {M.LEDGE_GAP:g} under the board: a knob press lands on the chassis', (KX - 12.4, KY + 8, SN.EB_BOT - M.LEDGE_GAP - 0.6), (-140, 200), 'rt'),
                      ('30 mm knob', (KX + 15, KY + 8, H + 8), (160, -100), 'lb')], fs=22)
    save(R.titled(a, 'The knob: section 8 mm behind its centre',
                  'V5\'s collar and knob in the 4 mm walnut; ledges on V5\'s encoder rails catch the board under a knob press.'), 'p3v6-4-knob.png')

if 'encoder' in WHICH:
    sc = R.Scene(parts(chassis=False, inside=False, knob=True, screws=False) + [R.Part('pan', P['panel'] + P['diffuser'], 'panel')])
    cam = persp((-0.35, 0.9, -1.2), size=(1300, 1000), dist=300, target=np.array([KX, KY + 8, H - 6]), yfov=0.5)
    a = sc.render(cam, ground=False, flip=True)
    annotate(a, cam, [('encoder in its collar, QT cable down', (KX + 10, KY + 4, SN.EB_BOT), (120, -160), 'lb'),
                      ('panel already seated', (KX - 40, 10, M.ZO1 + 30), (-80, 150), 'rt')], fs=22)
    sc = R.Scene(parts(sleeve=False, inside=False, knob=False, screws=False))
    save(R.titled(a, 'The encoder: hung from its collar',
                  'Sleeve top down: the encoder up into its collar after the panel, as V5. The chassis\'s ledges catch it (the knob section).'), 'p3v6-5-encoder.png')
