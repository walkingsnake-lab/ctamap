"""Renders of the V5.5 tray (p4v55.py):  python3 render_v55.py <out dir>.  Needs pyrender on EGL and rend.py."""
import os, sys, math
import numpy as np
from PIL import Image, ImageDraw
from manifold3d import Manifold
import rend as R
import p4, v6, p4v55 as T
from p4 import box, DR, H, D, ZC, HW

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
R.MATS.update(petgL=('plain', (0.30, 0.30, 0.325), 0.06, 40, 0.008), petgR=('plain', (0.44, 0.47, 0.53), 0.06, 40, 0.008),
              screw=('plain', (0.75, 0.75, 0.78), 0.30, 70, 0.05), brass=('plain', (0.72, 0.58, 0.28), 0.30, 60, 0.08),
              pcb=('plain', (0.08, 0.36, 0.24), 0.05, 30, 0.0))
CENTRE = np.array([0, D / 2, H / 2])
L, Rt = T.halves()
P = p4.build()


def part(name, m, mat, grp):
    p = R.Part(name, m, mat); p.grp = grp
    return p


def annotate(img, cam, notes, fs=24):
    d = ImageDraw.Draw(img); f = R.font(fs)
    for text, pt, (dx, dy), anchor in notes:
        x, y = cam.project(pt); tx, ty = x + dx, y + dy
        for col, w in ((R.BG, 7), (R.INK, 2)):
            d.line([x, y, tx, ty], fill=col, width=w)
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=R.INK, outline=R.BG)
        R.label(d, (tx + (10 if anchor[0] == 'l' else -10 if anchor[0] == 'r' else 0), ty), text, f, anchor=anchor)
    return img


def save(img, name):
    img.save(os.path.join(OUT, name)); print('wrote', os.path.join(OUT, name), flush=True)


# 1: the backs, V5 over V5.5 (seen from behind: the case's left is on the right)
def back(parts):
    cam = R.Cam(R.look_at(CENTRE + np.array([0, 900.0, 0]), CENTRE), (1700, 950), xmag=1700 / 5.8 / 2)
    return R.Scene(parts).render(cam, ground=False), cam
a, cam = back([part('l', P['tray_left'], 'petgL', 'l'), part('r', P['tray_right'], 'petgR', 'r'), part('spine', P['spine'], 'ring', 's'), part('bridge', P['bridge'], 'ring', 's')])
annotate(a, cam, [('seam on the centre line, under the knob', (0, 69, ZC + 20), (-170, 30), 'rm'),
                  ('spine', (40, 72, ZC + 45.6), (150, 130), 'lt'), ('bridge', (10, 72, ZC - 56), (-160, -60), 'rb'),
                  ('panel screws: 34 mm down these tubes', (-120, 69, ZC + 56), (-140, 110), 'rt'),
                  ('louvers: the top wall is joined to the back only here', (0, 69, v6.ZIN1 - 9), (160, 60), 'rt')])
b, cam = back([part('l', L, 'petgL', 'l'), part('r', Rt, 'petgR', 'r'), part('screws', T.screws(), 'screw', 's')])
annotate(b, cam, [('split 24 mm off centre', (T.JOINT_X, 69, ZC - 15), (-40, 0), 'rm'),
                  ('three knuckles, screws flush', (T.KN_SCREW_X, 69, ZC + 41), (-220, 90), 'rt'),
                  ('panel screws: 4.6 mm in, all six inserts', (-120, 69, ZC + 56), (-140, 150), 'rt'),
                  ('ties: louver rows left solid', (-70, 69, v6.ZIN1 - 9), (120, 60), 'rt'),
                  ('solid across the joint and round the centre posts', (10, 69, v6.ZIN0 + 9), (160, -70), 'rb')])
save(R.titled(R.stack([R.titled(a, 'V5 tray (as built), from behind', scale=0.8), R.titled(b, 'V5.5 tray, from behind', scale=0.8)]),
              'V5.5 tray: what changes on the back', 'Same outline, same shell. Seen from behind, so the case\'s left half (dark) is on the right.'), 'v55-1-back.png')

# 2: the halves apart, from the front, with the panel's standoffs
so = T.standoffs()
ps = [part('l', L, 'petgL', 'l'), part('r', Rt.translate([34, 0, 0]), 'petgR', 'r'),
      part('so_l', so ^ box(-400, T.JOINT_X, -50, 200, -50, 300), 'brass', 'l'), part('so_r', (so ^ box(T.JOINT_X, 400, -50, 200, -50, 300)).translate([34, 0, 0]), 'brass', 'r')]
e = np.array([-0.35, -1.25, 0.95]); e /= np.linalg.norm(e)
tgt = CENTRE + np.array([14, 10, -4])
cam = R.Cam(R.look_at(tgt + 800 * e, tgt), (1900, 1250), yfov=0.42)
im = R.Scene(ps, ground=-0.3).render(cam)
annotate(im, cam, [('encoder slot, knob screws: all on the left half', (0, 22, v6.ZO1), (-60, -150), 'mb'),
                   ('M3 x 30 standoffs (they go on the panel first)', (-120, 45, ZC - 56), (-10, 190), 'mt'),
                   ('short post: the V5 post with its foot 30 mm back', (0, 62, ZC - 56), (60, 260), 'mt'),
                   ('tongue under the right half\'s wall', (T.JOINT_X + 5, 42, v6.ZIN0 + 3), (250, 150), 'mt'),
                   ('knuckles', (T.JOINT_X + 4, 64, ZC + 31), (330, 40), 'lm'),
                   ('crush ribs, S3, sensor mount, hooks: unchanged', (120 + 34, 40, v6.ZO1), (60, -120), 'mb')])
save(R.titled(im, 'V5.5 tray halves, pulled apart', 'Joined on the bench with seven screws, then into the sleeve as one tray.'), 'v55-2-halves.png')
