"""Renders of the P5 bar sleeve (p5.py), straight from the model:
    python3 render_p5.py <img dir>
Needs pyrender on EGL (headless), as render_p3x2.py, whose shading and camera it uses. Writes p5-front.png (assembled,
from the front right), p5-end-wall.png (the right end: knob, collar, USB-C), p5-exploded.png (from the back: shell
halves apart with their plates, trays pulled out), p5-tray-end.png (the right tray half's end wall from inside: the
encoder's slot, recess and rails, the USB-C window) and p5-knob-section.png (a cut through the knob's axis, from above)."""
import os, sys, tempfile
import numpy as np
import trimesh
from PIL import Image
import render_p3x2 as R
import p5 as B
import p4 as P4
import drawer as DR
import cleat as CLT
from case import box, ZC, H, D, HW, KY

WALNUT, BLACK, WHITE = R.WALNUT, [0.13, 0.13, 0.14, 1.0], [0.90, 0.90, 0.88, 1.0]
PLATE, GREY, KNOB, GREEN = [0.80, 0.78, 0.72, 1.0], [0.45, 0.45, 0.47, 1.0], [0.96, 0.95, 0.92, 1.0], [0.20, 0.50, 0.30, 1.0]
TMP = tempfile.mkdtemp()


def L(m, color, name, cut=None):
    """manifold -> (trimesh, pyrender mesh); cut: a manifold to keep the inside of (a section)"""
    t = P4.to_tm(m ^ cut if cut is not None else m)
    path = f'{TMP}/{name}.stl'
    t.export(path)
    return R.load(path, color)


def save(items, name, **kw):
    Image.fromarray(R.render([(t, m, pose) for (t, m), pose in items], **kw)).save(f'{sys.argv[1]}/{name}')
    print(name)


I4 = np.eye(4)
P = B.build()
d = P['diffuser']
dif = lambda m: P4.diffuser_in_case(m)
a, b = L(P['a'], WALNUT, 'a'), L(P['b'], WALNUT, 'b')
tl, tr = L(P['tray_left'], BLACK, 'tl'), L(P['tray_right'], BLACK, 'tr')
dw = [L(dif(d[(s, 'white')]), WHITE, f'dw{s}') for s in ('left', 'right')]
db = [L(dif(d[(s, 'black')]), BLACK, f'db{s}') for s in ('left', 'right')]
pt, pb = L(P['plates'][0], PLATE, 'pt'), L(P['plates'][1], PLATE, 'pb')
collar, knob = L(B.collar_in_case(), KNOB, 'collar'), L(B.knob_in_case(), KNOB, 'knob')
spine, bridge = L(P['spine'], GREY, 'spine'), L(P['bridge'], GREY, 'bridge')

# assembled, from the front right and a little above
front = [(a, I4), (b, I4), (dw[0], I4), (dw[1], I4), (collar, I4), (knob, I4)]
save(front, 'p5-front.png', eye=(430, -640, ZC + 150), target=(15, 30, ZC - 5), yfov=0.42)
# the right end wall
save(front + [(tr, I4)], 'p5-end-wall.png', eye=(560, -150, ZC + 70), target=(HW - 20, 40, ZC + 5), yfov=0.42, size=(1400, 1000))
# exploded, from the back
gap = 50.0
ex = [(a, R.shift(-gap / 2)), (b, R.shift(gap / 2)), (pt, I4), (pb, I4), (tl, R.shift(-gap / 2, 130)), (tr, R.shift(gap / 2, 130)),
      (spine, R.shift(0, 175)), (bridge, R.shift(0, 175)), (collar, R.shift(gap / 2 + 25)), (knob, R.shift(gap / 2 + 45))]
for s in (0, 1):
    ex += [(dw[s], R.shift((2 * s - 1) * gap / 2, -80)), (db[s], R.shift((2 * s - 1) * gap / 2, -80))]
save(ex, 'p5-exploded.png', eye=(420, 820, ZC + 380), target=(0, 55, ZC - 10), yfov=0.62)
# the right tray half's end wall from inside (looking from the seam toward the end), with the encoder and the S3 in place
enc = L(B.encoder_envelope(), GREEN, 'enc')
s3 = L(DR.s3_envelope(), GREEN, 's3')
save([(tr, I4), (enc, I4), (s3, I4)], 'p5-tray-end.png', eye=(-40, -230, ZC + 60), target=(HW - 30, 55, ZC + 10), yfov=0.5, size=(1500, 1000))
# cut through the knob's axis (z = KZ), seen from above: wall, collar, knob, encoder, the tray's end wall and rails, panel
cut = box(HW - 75, HW + 60, -60, D + 60, -10, B.KZ)
sec = [(L(P['b'], WALNUT, 'sb', cut), I4), (L(P['tray_right'], BLACK, 'st', cut), I4), (L(B.collar_in_case(), KNOB, 'sc', cut), I4),
       (L(B.knob_in_case(), [0.75, 0.75, 0.78, 1.0], 'sk', cut), I4), (L(B.encoder_envelope(), GREEN, 'se', cut), I4),
       (L(B.panel_p5(), [0.30, 0.32, 0.38, 1.0], 'sp', cut), I4),
       (L(dif(d[('right', 'white')] + d[('right', 'black')]), WHITE, 'sd', cut), I4)]
save(sec, 'p5-knob-section.png', eye=(HW - 28, 39.7, B.KZ + 80), target=(HW - 28, 40, B.KZ), ortho=(62, 44), size=(1500, 1064))   # a hair off the vertical (straight down has no 'up'), inside the ortho camera's 100 mm range
