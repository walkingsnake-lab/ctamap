"""Render of the P4 diffuser's draw-screw joint (p4.py, joint_lugs):
    python3 render_p4_lugs.py <img dir>
Needs pyrender on EGL, as render_p4_top.py. Writes p4-diffuser-joint-lugs.png: the top border at the centre joint, seen
from behind with the diffuser face down, apart and drawn together. Lugs orange and screw blue so they read; the real
parts are black on a white first layer."""
import os, sys
os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')
import numpy as np
from PIL import Image, ImageDraw
import p4
from p4 import *
from render_p4_top import mesh, render, shift, font, BG, INK

COL = dict(left=[0.30, 0.30, 0.33], right=[0.40, 0.40, 0.44], white=[0.90, 0.89, 0.84], lug=[0.93, 0.52, 0.12], screw=[0.16, 0.42, 0.86])


def parts():
    with_l = p4.diffuser_halves()
    p4.JOINT_LUGS = False
    plain = p4.diffuser_halves()
    p4.JOINT_LUGS = True
    keep = box(-34, 34, 44, 80, -5, 30)
    Q = {}
    for side in ('left', 'right'):
        Q[side] = (with_l[(side, 'black')] ^ plain[(side, 'black')]) ^ keep
        Q[side + '_lug'] = (with_l[(side, 'black')] - plain[(side, 'black')]) ^ keep
        Q[side + '_white'] = with_l[(side, 'white')] ^ keep
    Q['screw'] = p4.lug_screws_env() ^ keep
    return Q


def view(Q, gap, screw_out, size):
    it = []
    for side, dx in (('left', -gap / 2), ('right', gap / 2)):
        it.append((mesh(Q[side], COL[side]), shift(dx=dx)))
        it.append((mesh(Q[side + '_lug'], COL['lug']), shift(dx=dx)))
        it.append((mesh(Q[side + '_white'], COL['white']), shift(dx=dx)))
    it.append((mesh(Q['screw'], COL['screw']), shift(dx=-gap / 2 - screw_out)))
    return render(it, eye=(-26, 104, 44), target=(1.5, 64, 1.5), size=size, yfov=0.42)


if __name__ == '__main__':
    img = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(img, exist_ok=True)
    Q = parts()
    W, H, top, gapx = 1000, 760, 110, 16
    a = view(Q, 7.0, 9.0, (W, H))
    b = view(Q, 0.0, 0.0, (W, H))
    im = Image.new('RGB', (2 * W + gapx, H + top), BG)
    d = ImageDraw.Draw(im)
    f = font(24)
    axes, y_out = p4.lug_axes()
    caps = ('Apart, from behind with the face down (the left half is the nearer one): a lug on\neach half behind the border, the left half\'s skirt cut away for the screw\'s way in',
            f'Drawn together: an M2.5 x {p4.LUG_SCREW:g} button head slips through the left lug and threads\n{p4.LUG_SCREW - p4.LUG_A:g} mm into the right one. The white edges meet; the lugs stay {2 * p4.LUG_FACE:g} mm apart')
    for i, (p, cap) in enumerate(zip((a, b), caps)):
        im.paste(p, (i * (W + gapx), top))
        d.multiline_text((i * (W + gapx) + 22, 18), cap, fill=INK, font=f, spacing=6)
    im.save(f'{img}/p4-diffuser-joint-lugs.png')
    print('ok')
