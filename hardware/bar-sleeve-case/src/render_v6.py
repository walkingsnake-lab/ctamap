"""Renders of the V6 draft (v6.py):  python3 render_v6.py <out dir> [which ...]
which: closed skin chassis joint panel encoder steps (default: all). Needs pyrender on EGL (headless) and rend.py.
Writes 1-closed.png ... 7-build-order.png (img/v6-*.png are these)."""
import os, sys, math
import numpy as np
from PIL import Image, ImageDraw
from manifold3d import Manifold
sys.path.insert(0, '/home/claude/ctamap/hardware/bar-sleeve-case/src')
import rend as R
import v6, p4
from p4 import box, cyl_y, cyl_z, DR, H, D, ZC, HW
import collar as CO, knob as KN, sensor as SN

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
WHICH = sys.argv[2:] or ['closed', 'skin', 'chassis', 'joint', 'panel', 'encoder', 'steps']
os.makedirs(OUT, exist_ok=True)
KY = v6.KY
CENTRE = np.array([0, D / 2, H / 2])

R.MATS.update(
    petgL=('plain', (0.30, 0.30, 0.325), 0.06, 40, 0.008),
    petgR=('plain', (0.44, 0.47, 0.53), 0.06, 40, 0.008),
    new=('plain', (0.93, 0.50, 0.10), 0.04, 30, 0.0),
    screw=('plain', (0.035, 0.035, 0.04), 0.30, 70, 0.05),
    pcb=('plain', (0.08, 0.36, 0.24), 0.05, 30, 0.0),
    led=('plain', (0.90, 0.90, 0.88), 0.03, 20, 0.0),
    brass=('plain', (0.72, 0.58, 0.28), 0.30, 60, 0.08),
    cut=('plain', (0.50, 0.33, 0.20), 0.0, 10, 0.0),
    pix=('plain', (1.0, 0.80, 0.15), 0.0, 10, 0.0),
)

P = v6.build()
DIF_W = Manifold.batch_boolean([m for (side, part), m in P['diffuser'].items() if part == 'white'], p4.ADD)
DIF_B = Manifold.batch_boolean([m for (side, part), m in P['diffuser'].items() if part != 'white'], p4.ADD)
eb_top, eb_bot = SN.EB_TOP, SN.EB_BOT
ENC = dict(board=box(-12.7, 12.7, KY - 12.7, KY + 12.7, eb_bot, eb_top),
           body=Manifold.cube([12.0, 12.0, H - 1.4 - eb_top], True).rotate([0, 0, 45]).translate([0, KY, (H - 1.4 + eb_top) / 2]),
           shaft=cyl_z(0, KY, H - 1.4, H + 6.0, 7.0) + cyl_z(0, KY, H + 6.0, H + KN.TIP_Z, 6.0),
           nut=Manifold.cylinder(2.2, 11.0 / math.sqrt(3), 11.0 / math.sqrt(3), 6).translate([0, KY, H + CO.FL_T]) - cyl_z(0, KY, H, H + 9, 7.0))
tsa, tsb = p4.top_screws_env()
TOPSCREWS = tsa + tsb


def parts(skin=True, chassis=True, inside=True, front=True, knob=True, screws=True, clip=None, split=0.0, colour=False):
    """clip: a manifold every part is intersected with (sections). split: the chassis halves moved apart by this (x)."""
    out = []
    def add(name, m, mat, grp, **kw):
        if clip is not None:
            m = m ^ clip
        if m.is_empty():
            return
        p = R.Part(name, m, mat, **kw); p.grp = grp
        out.append(p)
    if skin:
        for i, (k, m) in enumerate(P['skin'].items()):        # two halves (default) or the four pieces (V6_SKIN=four)
            add(k, m, 'walnut', k.split('_')[1], seed=i + 1)
    if chassis:
        add('chassis_left', P['chassis_left'], 'petgL' if colour else 'black', 'cl')
        add('chassis_right', P['chassis_right'], 'petgR' if colour else 'black', 'cr')
    if inside:
        add('panel', P['panel'], 'panel', 'core')
        add('standoffs', P['standoffs'], 'brass', 'core')
        add('s3', P['s3'], 'pcb', 'cr')
        for k, mat in (('board', 'pcb'), ('body', 'steel'), ('shaft', 'steel'), ('nut', 'steel')):
            add('enc_' + k, ENC[k], mat, 'cl')
        add('pixel', v6.pixel(), 'pix', 'cl')
    if front:
        add('diffuser', DIF_W, 'diffuser', 'core')
        add('grid', DIF_B, 'black', 'core')
    if knob:
        add('ring', P['ring'], 'ring', 'knob')
        add('knob', P['knob'], 'knob', 'knob')
    if screws:
        if skin:
            add('skin_screws', P['screws']['skin'], 'screw', 'screws')
            add('under_screws', P['screws']['under'], 'screw', 'screws')
            add('top_screws', TOPSCREWS, 'screw', 'screws')
        if chassis:
            add('back_screws', P['screws']['back'], 'screw', 'screws')
    return out


def persp(eye_dir, size=(1600, 1100), dist=820, target=CENTRE, yfov=0.42):
    e = np.array(eye_dir, float); e /= np.linalg.norm(e)
    return R.Cam(R.look_at(np.array(target) + dist * e, target), size, yfov=yfov)


def ortho(direction, size, pxmm, target=CENTRE, up=(0, 0, 1)):
    d = np.array(direction, float)
    return R.Cam(R.look_at(np.array(target) + 900 * d, target, up), size, xmag=size[0] / pxmm / 2)


def annotate(img, cam, notes, fs=24):
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
    return img


def moved(ps, off):
    return [p.moved(offset=off.get(p.grp, (0, 0, 0))) for p in ps]


# ------------------------------------------------------------------ 1: closed
if 'closed' in WHICH:
    sc = R.Scene(parts(), ground=-0.3)
    a = sc.render(persp((-0.75, -1.3, 0.5)))
    b = sc.render(persp((0.85, 1.25, 0.55)), flip=True)
    cam = R.Cam(R.look_at(CENTRE + np.array([0, 0, 900.0]), CENTRE, (0, 1, 0)), (1600, 470), xmag=1600 / 5.2 / 2)
    HEROS = (a, b)
    c = sc.render(cam, ground=False)
    annotate(c, cam, [('one screw at each end, in line with the knob', (-v6.XE, KY, H), (150, 70), 'lm'),
                      ('two more under the knob, as on V5', (19, KY + 8, H), (110, -75), 'lm')])
    cam = ortho((1, 0, 0), (1000, 940), 5.2)
    e = sc.render(cam, ground=False)
    annotate(e, cam, [('two screws on each end', (HW, KY, ZC + 50), (-60, -70), 'rm'),
                      ('the line between the halves', (HW, 30, ZC), (-60, 60), 'rm')], fs=22)
    save(R.titled(R.stack([R.row([a, b]), R.row([c, e])]), 'V6: closed',
                  f'Same outside as today (281.8 x 153.8 x 73). Two walnut halves with a {v6.SKIN_GAP:g} mm line between them; eight black M3 heads in one line.'), '1-closed.png')

# ------------------------------------------------------------------ 2: the skin comes off
if 'skin' in WHICH:
    off = dict(top=(0, 0, 70), bottom=(0, 0, -70), knob=(0, 0, 118))
    ps = moved([p for p in parts(colour=True) if p.grp != 'screws'], off)
    sc = R.Scene(ps)
    cam = persp((-0.72, -1.3, 0.78), size=(1700, 1300), dist=1100, target=CENTRE + np.array([0, 0, 10]))
    im = sc.render(cam, ground=False)
    annotate(im, cam, [('top half: top, hood and the upper half of each end; lifts straight off', (70, 40, H + 70), (150, -70), 'lm'),
                       ('its inner edge reaches 3 mm down behind the bottom half: walnut behind the line', (-HW + 3, 40, ZC + 68), (-60, 190), 'mt'),
                       ('bottom half (feet)', (60, 45, -70), (150, 60), 'lm'),
                       ('chassis: carries everything; the walnut carries nothing', (-100, 30, v6.ZO1), (-170, -210), 'mb'),
                       ('encoder tower: part of the chassis', (0, KY, H + 1.6), (120, -120), 'lm'),
                       ('diffuser: on the panel, 0.3 mm behind the rim', (60, v6.RIM_GAP + p4.Y_FACE, ZC), (150, 300), 'mt')])
    save(R.titled(im, 'The skin: two walnut halves on a black chassis',
                  'Each half goes straight on, top down and bottom up; nothing has to close. No glue, no threads in walnut.'), '2-skin.png')

# ------------------------------------------------------------------ 3: the chassis
if 'chassis' in WHICH:
    ps = moved(parts(skin=False, inside=False, front=False, knob=False, screws=False, colour=True), dict(cr=(34, 0, 0)))
    sc = R.Scene(ps, ground=-0.3)
    cam = persp((-0.35, -1.25, 0.95), size=(1900, 1250), dist=800, target=CENTRE + np.array([14, 10, -4]))
    im = sc.render(cam)
    annotate(im, cam, [('split 24 mm right of centre', (v6.JOINT_X, 20, v6.ZO1), (80, -150), 'lb'),
                       ('encoder tower', (0, KY, H + 1.6), (-120, -110), 'rb'),
                       ('short post (six): a standoff from the panel lands here', (-120, v6.BOSS_Y, ZC - 56), (-20, 170), 'mt'),
                       ('contact pads: the walnut rests on these', (-44, 40, v6.ZO1), (-330, -120), 'rb'),
                       ('boss with a brass insert for each skin screw', (v6.XE + 34, KY, v6.ZIN1 - 3.5), (120, -110), 'lb'),
                       ('tongue: goes under the right half\'s wall', (v6.JOINT_X + 5, 42, v6.ZIN0 + 3), (120, 190), 'mt'),
                       ('knuckles: the back plates lock', (v6.JOINT_X + 4, 64, ZC + 31), (330, 40), 'lm')])
    save(R.titled(im, 'The chassis: the V5 tray made into the structure', 'Black PETG, two halves, printed back-down like the tray. Drawn in two greys and pulled apart.'), '3-chassis.png')

# ------------------------------------------------------------------ 4: the joint, close
if 'joint' in WHICH:
    ps = moved(parts(skin=False, inside=False, front=False, knob=False, screws=False, colour=True), dict(cr=(26, 0, 0)))
    sc = R.Scene(ps)
    cam = persp((-0.55, -1.2, 0.5), size=(1100, 1000), dist=330, target=np.array([v6.JOINT_X + 10, 52, ZC + 28]), yfov=0.5)
    a = sc.render(cam, ground=False)
    annotate(a, cam, [('block on the left half', (v6.JOINT_X + 5, 64, ZC + 21), (-150, 120), 'mt'),
                      ('bridge on the right half', (v6.JOINT_X + 26 + 5, 56, ZC + 41), (120, -40), 'lm'),
                      ('tongue', (v6.JOINT_X + 5, 45, v6.ZIN1 - 2.7), (-170, -10), 'rm')], fs=22)
    cam = persp((0.5, 1.25, 0.45), size=(1100, 1000), dist=420, target=np.array([v6.JOINT_X + 10, 60, ZC + 20]), yfov=0.5)
    b = sc.render(cam, ground=False, flip=True)
    annotate(b, cam, [('from the back: the blocks lie on the print bed', (v6.JOINT_X + 5, 69, ZC + 41), (-120, -120), 'mb')], fs=22)
    save(R.titled(R.row([a, b]), 'The chassis joint', 'Slides together sideways; seven screws, all from outside (three on the back, two countersunk under the walnut top and bottom). Nothing prints as an overhang.'), '4-joint.png')

# ------------------------------------------------------------------ 5: the panel on standoffs (section at a corner insert)
if 'panel' in WHICH:
    x0 = -120.0
    ps = parts(clip=box(x0 - 0.5, x0, -50, 200, -50, 300), colour=True)          # a thin slice: only cut faces show
    sc = R.Scene(ps)
    yf = p4.Y_FACE + v6.RIM_GAP
    cam = ortho((1, 0, 0), (1500, 900), 17.0, target=np.array([x0, 36.5, ZC + 57]))
    a = sc.render(cam, ground=False, crease=0.0)
    annotate(a, cam, [('top half, walnut 4 mm', (x0, 40, H - 2), (40, -60), 'mb'),
                      ('chassis wall 2.5 mm', (x0, 48, v6.ZO1 - 1.2), (0, 80), 'mt'),
                      ('M3 x 30 standoff, turned into the panel by hand', (x0, 45, ZC + 56), (-60, 110), 'mt'),
                      ('boss on the chassis back', (x0, 63.2, ZC + 52), (-70, 150), 'mt'),
                      ('M3 x 8 and a washer from the back', (x0, 68.5, ZC + 56), (-20, 290), 'rt'),
                      ('panel', (x0, 20, ZC + 36), (120, 30), 'lm'),
                      ('diffuser', (x0, yf + 0.4, ZC + 40), (-80, 60), 'rt'),
                      ('hood', (x0, 7, H - 2), (0, -60), 'mb')], fs=22)
    cam = ortho((1, 0, 0), (1500, 900), 62.0, target=np.array([x0, 21.5, ZC + 70.2]))
    b = sc.render(cam, ground=False, crease=0.0)
    annotate(b, cam, [('rim of the walnut: covers the white border', (x0, 15.4, 149.0), (-90, 130), 'mt'),
                      ('0.3 mm: the rim no longer presses on the diffuser', (x0, 16.2, 149.05), (190, 250), 'lt'),
                      ('diffuser: white face, black flange and grid', (x0, 16.9, 146.0), (-150, 150), 'mt'),
                      ('chassis wall: its front edge 0.3 behind the flange', (x0, 18.4, 148.2), (120, 110), 'lt'),
                      ('skirt: snaps over the panel\'s edge', (x0, 19.5, 141.7), (190, -110), 'lb'),
                      ('panel', (x0, 26, 140.5), (60, -60), 'lb')], fs=22)
    save(R.titled(R.stack([a, R.titled(b, 'The rim, enlarged', scale=0.8)]), 'Panel and diffuser: a slice through the top left insert, seen from the left end',
                  'The panel hangs from the chassis back on standoffs. The diffuser rides on the panel; the walnut only covers it.'), '5-panel.png')

# ------------------------------------------------------------------ 6: the encoder tower (section on the knob axis)
if 'encoder' in WHICH:
    ps = parts(clip=box(-400, 400, KY, KY + 0.5, -50, 300), colour=True)
    sc = R.Scene(ps)
    cam = ortho((0, -1, 0), (1500, 900), 22.0, target=np.array([0, KY, H - 4]))
    a = sc.render(cam, ground=False, crease=0.0)
    annotate(a, cam, [('tower: one piece with the chassis top wall', (-10.6, KY, H - 3), (-150, 250), 'mt'),
                      ('encoder nut clamps to the tower', (4.5, KY, H + 2.6), (150, -150), 'lb'),
                      ('trim ring', (18.5, KY, H + 0.8), (120, -90), 'lb'),
                      ('walnut: 0.4 mm clear of the tower, carries nothing', (-28, KY, H - 2), (-20, 190), 'lt'),
                      ('V5 screw: ring, walnut, chassis boss', (15, KY, H - 6), (-40, 330), 'mt'),
                      ('encoder: up into the pocket from inside', (0, KY, H - 5), (-200, 330), 'mt'),
                      ('chassis joint: tongue, countersunk screw', (v6.JOINT_X + 5, KY, v6.ZIN1 - 4), (60, 130), 'rt')], fs=22)
    ps2 = moved([p for p in parts(inside=True, front=True, colour=True) if p.name != 'top_screws'], dict(knob=(0, 0, 0)))
    ps2 = [p.moved(offset=(0, 0, 30)) if p.name == 'knob' else p.moved(offset=(0, 0, 12)) if p.name == 'ring' else p for p in ps2]
    sc2 = R.Scene(ps2)
    cam = persp((-0.45, -1.2, 1.0), size=(1500, 820), dist=250, target=np.array([0, KY - 2, H + 12]), yfov=0.5)
    b = sc2.render(cam, ground=False)
    annotate(b, cam, [('tower and encoder nut, standing through the walnut', (0, KY - 9, H + 1.6), (-230, 40), 'rm'),
                      ('trim ring', (-19, KY, H + 12.8), (-170, -40), 'rm'),
                      ('knob', (17, KY, H + 40), (170, -30), 'lm')], fs=22)
    save(R.titled(R.stack([a, b]), 'Knob and encoder', 'Today the encoder hangs from a collar that is only pressed into the walnut. Here its seat is part of the chassis.'), '6-encoder.png')

# ------------------------------------------------------------------ 7: build order
if 'steps' in WHICH:
    cam = persp((-0.6, -1.3, 0.75), size=(1000, 760), dist=930, target=CENTRE + np.array([0, 0, 6]))
    steps = [('1  Chassis halves together, inserts in; S3 and encoder in', parts(skin=False, front=False, knob=False, colour=True, inside=False) + [p for p in parts(skin=False, chassis=False, front=False, knob=False, screws=False) if p.name.startswith(('s3', 'enc'))], {}),
             ('2  Panel in from the front, six screws from the back, snug', parts(skin=False, front=False, knob=False, colour=True), {}),
             ('3  Diffuser pressed onto the panel, in plain view', parts(skin=False, knob=False, colour=True), {}),
             ('4  Bottom half on from below, four screws', [p for p in parts(knob=False, colour=True) if p.grp not in ('top', 'screws')], dict(bottom=(0, 0, -45))),
             ('5  Top half on from above, four screws', [p for p in parts(knob=False, colour=True) if p.grp != 'screws'], dict(top=(0, 0, 45))),
             ('6  Panel centred and tightened from the back; ring, nut, knob', parts(), {})]
    ims = []
    for title, ps, off in steps:
        sc = R.Scene(moved(ps, off))
        ims.append(R.titled(sc.render(cam, ground=False), title, scale=0.8))
    save(R.titled(R.stack([R.row(ims[:3]), R.row(ims[3:])]), 'Build order', 'Everything is fitted and can be tested (lit, bleed checked) before any walnut goes on.'), '7-build-order.png')
