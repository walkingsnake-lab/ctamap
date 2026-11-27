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
t = trimesh.load(os.path.join(here, '..', 'stl', 'p4-v6', 'p4-v6-knob-white.stl'))
KNOB = Manifold(Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))
b = KNOB.bounding_box()
KNOB = KNOB.translate([KX - (b[0] + b[3]) / 2, KY - (b[1] + b[4]) / 2, H + KN.SKIRT_Z - b[2]])
ENC = dict(board=box(-12.7, 12.7, KY - 12.7, KY + 12.7, SN.EB_BOT, SN.EB_TOP),
           body=Manifold.cube([12.0, 12.0, H - 1.4 - SN.EB_TOP], True).rotate([0, 0, 45]).translate([0, KY, (H - 1.4 + SN.EB_TOP) / 2]),
           shaft=cyl_z(0, KY, H - 1.4, H + 6.0, 7.0) + cyl_z(0, KY, H + 6.0, H + KN.TIP_Z, 6.0),
           nut=Manifold.cylinder(2.2, 11.0 / math.sqrt(3), 11.0 / math.sqrt(3), 6).translate([0, KY, H + CO.FL_T]) - cyl_z(0, KY, H, H + 9, 7.0),
           plug=M.plug())
ENC = {k: M.at_knob(m) for k, m in ENC.items()}             # drawn at x 0, the plug on the right: put in place


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
        add('panel', P['panel'], 'panel', 'chassis')
        add('standoffs', P['standoffs'], 'brass', 'chassis')
        add('s3', P['s3'], 'pcb', 'chassis')
        add('diffuser', P['diffuser'], 'diffuser', 'chassis')
    if knob:
        for k, mat in (('board', 'pcb'), ('body', 'steel'), ('shaft', 'steel'), ('plug', 'rubber')):
            add('enc_' + k, ENC[k].translate([0, 0, enc_dz]), mat, 'enc')
        add('nut', ENC['nut'], 'steel', 'ring')
        add('seat', P['seat'], 'seat', 'seat')
        add('ring', P['ring'], 'black', 'ring')
        add('knob', KNOB, 'knob', 'knob')
    if screws:
        add('under', P['screws']['under'], 'screw', 'sleeve')
        add('knob_screws', P['screws']['knob'], 'screw', 'seat')
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
                  f'{2 * HW:.0f} x {H:.1f} x {D:.0f}: the V5 sleeve at the P4 skin\'s 4 mm wall. No screws you can see; the P4 V6 ring and knob.'), 'p3v6-1-closed.png')

if 'apart' in WHICH:
    off = dict(sleeve=(0, -150, 0), seat=(0, 0, 60), ring=(0, 0, 95), knob=(0, 0, 130), enc=(0, 0, 30))
    sc = R.Scene(moved(parts(), off))
    cam = persp((-0.8, -1.1, 0.75), size=(1800, 1300), dist=1000, target=CENTRE + np.array([0, -60, 25]))
    im = sc.render(cam, ground=False)
    annotate(im, cam, [('sleeve: slides on from the front, over everything', (-80, -150 + 20, H), (-60, -90), 'mb'),
                       ('chassis (V6): panel on standoffs, diffuser on the panel', (-90, 40, M.ZO1), (-120, 150), 'rt'),
                       ('encoder: lowered in from above after the sleeve', (KX + 12, KY, SN.EB_TOP + 30), (180, -30), 'lm'),
                       ('knob seat (PETG): fills the walnut hole, two screws into the chassis', (KX + 19, KY, H + 60), (160, 10), 'lm'),
                       ('the P4 V6 ring and knob', (KX, KY, H + 130 + 8), (170, -40), 'lm')])
    save(R.titled(im, 'How it goes together',
                  'Chassis loaded on the bench (front-loading, as the P4); sleeve slid on and two screws from below; then the encoder, its seat, ring, nut and knob from above.'), 'p3v6-2-apart.png')

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
    ps = parts(clip=box(-200, 200, KY + 5.75, KY + 6.25, -50, 300))
    sc = R.Scene(ps)
    cam = ortho((0, -1, 0), (2000, 1000), 22.0, target=np.array([KX, KY, H - 2.0]))
    a = sc.render(cam, ground=False, crease=0.0)
    annotate(a, cam, [('knob seat (PETG)', (KX - 17, KY + 6, H - 2.0), (-80, -150), 'rb'),
                      ('M2.5 x 8 into a boss on the rail', (KX - 15, KY + 6, M.ZIN1 - 1), (-160, 120), 'rt'),
                      ('rail and lip: the board rests here as it goes in', (KX - 13.4, KY + 6, SN.EB_BOT - 0.8), (-120, 220), 'rt'),
                      ('encoder clamped up to the deck by its nut', (KX + 6, KY + 6, SN.EB_TOP + 2.5), (160, 170), 'lt'),
                      ('ring on the seat, 0.4 off the walnut', (KX + 20.5, KY + 6, H + 0.8), (150, -110), 'lb'),
                      ('walnut hole 37.5', (KX + 19.0, KY + 6, H - 1.0), (300, -40), 'lm')], fs=22)
    save(R.titled(a, 'The knob: section through the seat screws',
                  'Knob presses go through the deck and the two screws into the chassis, as on the P4. The knob hides the screw heads.'), 'p3v6-4-knob.png')

if 'encoder' in WHICH:
    ps = parts(sleeve=True, inside=True, knob=False, screws=False)
    enc = [R.Part('enc', M.tilted(M.encoder(), M.TILT[0]).translate([0, 0, 14.0]), 'pcb')]
    sc = R.Scene(ps + enc)
    cam = persp((-0.35, -1.0, 1.25), size=(1300, 1000), dist=330, target=np.array([KX, KY, H - 4]), yfov=0.5)
    a = sc.render(cam, ground=False)
    sc = R.Scene(parts(sleeve=False, inside=False, knob=False, screws=False))
    cam = persp((-0.35, -0.8, 1.3), size=(1300, 1000), dist=260, target=np.array([KX, KY + 4, M.ZIN1]), yfov=0.5)
    b = sc.render(cam, ground=False)
    annotate(b, cam, [('opening for the board, a notch for its plug', (KX + M.PLUG_SIDE * 17.0, KY, M.ZO1), (60, -230), 'lb'),
                      ('rails with lips under the board\'s edges', (KX - 13.5, KY - 8, M.ZIN1 - 1.0), (-120, 120), 'rt'),
                      ('boss for a seat screw', (KX + 15, KY + 6, M.ZO1), (200, -60), 'lb')], fs=22)
    save(R.titled(R.row([a, b]), 'The encoder goes in from above',
                  f'Plug side first, tilted {M.TILT[0]:.0f} deg, levelled over the last {M.TILT[1]:.0f} mm onto the lips. Right: the chassis top round the opening.'), 'p3v6-5-encoder.png')
