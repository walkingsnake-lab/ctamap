"""Render of the P4 diffuser's joint (p4.py: bar_bosses, joint_bar; or joint_lugs with P4_JOINT_LUGS=1 P4_JOINT_BARS=0):
    python3 render_p4_lugs.py <img dir>
Needs pyrender on EGL, as render_p4_top.py. Writes p4-diffuser-joint.png: the top border at the centre joint, seen from
behind with the diffuser face down, apart and joined. Bosses orange, bar green, screws blue so they read; the real
parts are black on a white first layer."""
import os, sys
os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')
import numpy as np
from PIL import Image, ImageDraw
import p4
from p4 import *
from render_p4_top import mesh, render, shift, font, BG, INK

COL = dict(left=[0.30, 0.30, 0.33], right=[0.40, 0.40, 0.44], white=[0.90, 0.89, 0.84], lug=[0.93, 0.52, 0.12], screw=[0.16, 0.42, 0.86],
           bar=[0.25, 0.62, 0.50])


def parts():
    with_l = p4.diffuser_halves()
    lugs, bars = p4.JOINT_LUGS, p4.JOINT_BARS
    p4.JOINT_LUGS = p4.JOINT_BARS = False
    plain = p4.diffuser_halves()
    p4.JOINT_LUGS, p4.JOINT_BARS = lugs, bars
    keep = box(-40, 40, 44, 80, -5, 30)
    Q = {}
    for side in ('left', 'right'):
        Q[side] = (with_l[(side, 'black')] ^ plain[(side, 'black')]) ^ keep
        Q[side + '_lug'] = (with_l[(side, 'black')] - plain[(side, 'black')]) ^ keep
        Q[side + '_white'] = with_l[(side, 'white')] ^ keep
    if p4.JOINT_BARS:
        Q['bar'] = p4.joint_bar(1)
        Q['screw'] = p4.bar_screws_env(1)
    else:
        Q['screw'] = p4.lug_screws_env() ^ keep
    return Q


def view(Q, gap, lift, size):
    it = []
    for side, dx in (('left', -gap / 2), ('right', gap / 2)):
        it.append((mesh(Q[side], COL[side]), shift(dx=dx)))
        it.append((mesh(Q[side + '_lug'], COL['lug']), shift(dx=dx)))
        it.append((mesh(Q[side + '_white'], COL['white']), shift(dx=dx)))
    if 'bar' in Q:
        it.append((mesh(Q['bar'], COL['bar']), shift(dz=lift)))
        it.append((mesh(Q['screw'], COL['screw']), shift(dz=1.9 * lift)))
    else:
        it.append((mesh(Q['screw'], COL['screw']), shift(dx=-gap / 2 - lift)))
    return render(it, eye=(-34, 112, 52), target=(1.0, 64, 5.0), size=size, yfov=0.50)


if __name__ == '__main__':
    img = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(img, exist_ok=True)
    Q = parts()
    W, H, top, gapx = 1000, 800, 110, 16
    a = view(Q, 6.0, 4.5, (W, H))
    b = view(Q, 0.0, 0.0, (W, H))
    im = Image.new('RGB', (2 * W + gapx, H + top), BG)
    d = ImageDraw.Draw(im)
    f = font(24)
    if p4.JOINT_BARS:
        caps = ('Apart, from behind with the face down (left half nearer): a boss on each\nhalf behind the border (orange), a slotted bar (green), two M2.5 x 8 (blue)',
                f'Joined: halves pushed together by hand, the bar laid on the two boss\ntops, each screw driven straight down. The same at the bottom border')
    else:
        caps = ('Apart, from behind with the face down: a lug on each half behind the border', 'Drawn together by an M2.5 screw along the border')
    for i, (p, cap) in enumerate(zip((a, b), caps)):
        im.paste(p, (i * (W + gapx), top))
        d.multiline_text((i * (W + gapx) + 22, 18), cap, fill=INK, font=f, spacing=6)
    im.save(f'{img}/p4-diffuser-joint.png')
    print('ok')
