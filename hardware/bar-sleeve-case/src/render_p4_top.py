"""Renders of the P4's top screws under the knob (p4.py, TOP_SCREWS):
    python3 render_p4_top.py <img dir>        (CASE_WALL=4.0 for the 4 mm wall)
Needs pyrender on EGL (headless), as render_p3x2.py. Writes
  p4-top-screws-section.png   the case cut through the knob axis, seen from the front, with the parts named
  p4-top-screws-views.png     from straight above with the knob on; the knob lifted off; the tray's top wall from inside
The screws are drawn blue and the material added to the tray orange so they read; the real parts are black."""
import math, os, sys
os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')
import numpy as np
import trimesh
import pyrender
from PIL import Image, ImageDraw, ImageFont
import p4
from p4 import *
import knob as KN, collar as CO, sensor as SN
from render_p3x2 import look_at, LIGHTS, AMBIENT

COLORS = dict(shell=[0.62, 0.42, 0.26], tray=[0.25, 0.25, 0.28], added=[0.93, 0.52, 0.12], collar=[0.60, 0.67, 0.72],
              knob=[0.86, 0.85, 0.80], board=[0.10, 0.42, 0.28], body=[0.60, 0.60, 0.62], shaft=[0.60, 0.60, 0.62],
              socks=[0.80, 0.76, 0.60], plugs=[0.80, 0.76, 0.60], nut=[0.50, 0.50, 0.52], screws=[0.16, 0.42, 0.86])
BG = (247, 247, 245)
INK = (25, 25, 25)


def mesh(m, color):
    """a manifold as a pyrender mesh, the shading baked into its face colours (as render_p3x2.load)"""
    me = m.to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    n = t.face_normals
    shade = AMBIENT * np.ones(len(n))
    for d, w in LIGHTS:
        d = np.array(d, float); d /= np.linalg.norm(d)
        shade += w * np.clip(n @ d, 0, None)
    rgb = np.clip(np.array(color)[None, :] * shade[:, None] * 1.25, 0, 1)
    t.visual.face_colors = np.hstack([(rgb * 255).astype(np.uint8), np.full((len(n), 1), 255, np.uint8)])
    return pyrender.Mesh.from_trimesh(t, smooth=False)


def render(items, eye, target, size, yfov=0.5, ortho=None, up=(0, 0, 1)):
    scene = pyrender.Scene(bg_color=[BG[0] / 255, BG[1] / 255, BG[2] / 255, 1.0], ambient_light=[0.18, 0.18, 0.18])
    for m, pose in items:
        scene.add(m, pose=pose)
    cam = pyrender.OrthographicCamera(xmag=ortho[0], ymag=ortho[1], znear=1.0, zfar=2000.0) if ortho else pyrender.PerspectiveCamera(yfov=yfov)
    scene.add(cam, pose=look_at(eye, target, up))
    r = pyrender.OffscreenRenderer(*size)
    color, _ = r.render(scene, flags=pyrender.RenderFlags.FLAT)
    r.delete()
    return Image.fromarray(color).convert('RGB')


def shift(dx=0, dy=0, dz=0):
    m = np.eye(4); m[:3, 3] = [dx, dy, dz]; return m


def font(px):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    return ImageFont.load_default()


def parts():
    P = p4.build()
    p4.TOP_SCREWS = False
    tray0 = p4.tray_p4()
    p4.TOP_SCREWS = True
    eb_top, eb_bot = SN.EB_TOP, SN.EB_BOT
    board = box(-12.7, 12.7, KY - 12.7, KY + 12.7, eb_bot, eb_top)
    body = Manifold.cube([12.0, 12.0, H - 1.4 - eb_top], True).rotate([0, 0, 45]).translate([0, KY, (H - 1.4 + eb_top) / 2])
    shaft = cyl_z(0, KY, H - 1.4, H + 6.0, 7.0) + cyl_z(0, KY, H + 6.0, H + KN.TIP_Z, 6.0)
    socks = box(-12.7, -8.5, KY - 3.0, KY + 3.0, eb_bot - 2.96, eb_bot) + box(8.5, 12.7, KY - 3.0, KY + 3.0, eb_bot - 2.96, eb_bot)
    plugs = box(-12.7 - 6, -12.7, KY - 3.0, KY + 3.0, eb_bot - 2.96, eb_bot) + box(12.7, 12.7 + 6, KY - 3.0, KY + 3.0, eb_bot - 2.96, eb_bot)
    nut = Manifold.cylinder(2.2, 11.0 / math.sqrt(3), 11.0 / math.sqrt(3), 6).translate([0, KY, H + CO.FL_T]) - cyl_z(0, KY, H, H + 9, 7.0)
    sc = p4.top_screws_env()
    return dict(shell=P['top'] + P['bot'], tray=P['tray'] ^ tray0, added=P['tray'] - tray0, collar=p4.collar_knob(), knob=p4.knob_in_case(),
                board=board, body=body, shaft=shaft, socks=socks, plugs=plugs, nut=nut, screws=sc[0] + sc[1])


def section(Q, img):
    """cut at the knob axis (y = KY), the back half seen from the front, orthographic (x right as seen from the front);
    the names sit in a margin either side"""
    W, Hh, M = 1400, 840, 400
    xmag = 33.0
    ymag = xmag * Hh / W
    cz = H + 1.0
    keep = box(-200, 200, KY, 200, -50, 400)
    items = [(mesh(Q[k] ^ keep, COLORS[k]), np.eye(4)) for k in Q]
    c = render(items, eye=(0, KY - 300, cz), target=(0, KY, cz), size=(W, Hh), ortho=(xmag, ymag))
    top = 70
    im = Image.new('RGB', (W + 2 * M, Hh + top), BG)
    im.paste(c, (M, top))
    d = ImageDraw.Draw(im)
    f, fs = font(23), font(22)
    px = lambda x, z: (M + W / 2 + x / xmag * W / 2, top + Hh / 2 - (z - cz) / ymag * Hh / 2)

    def label(text, at, row, side):
        a = px(*at)
        y = top + 60 + row * 150
        b = (M - 14, y) if side < 0 else (M + W + 14, y)
        for col, w in ((BG, 6), (INK, 2)):                      # a light halo, so the leader reads over the dark parts
            d.line([a, b], fill=col, width=w)
        d.ellipse([a[0] - 6, a[1] - 6, a[0] + 6, a[1] + 6], fill=BG)
        d.ellipse([a[0] - 4, a[1] - 4, a[0] + 4, a[1] + 4], fill=INK)
        lines = text.split('\n')
        for i, ln in enumerate(lines):
            yy = y + (i - (len(lines) - 1) / 2) * 28
            d.text((b[0] - 8, yy) if side < 0 else (b[0] + 8, yy), ln, fill=INK, font=f, anchor='rm' if side < 0 else 'lm')
    zw = DR._zw()
    zo = zw + DR.TRAY_WT
    zb = DR.enc_board()[2][1] - DR.RAIL_LAP
    thread = (zo + TS_PAD) - (H - TS_LEN)
    label('knob', (-9.0, H + 9.0), 0, -1)
    label('collar\n(flange 1.6 mm)', (-19.3, H + 0.8), 1, -1)
    label(f'shell top wall\nwalnut, {WALL:g} mm', (-25.0, H - WALL / 2), 2, -1)
    label('tray top wall\nPETG, 2.5 mm', (-25.0, zw + 1.25), 3, -1)
    label('encoder board', (-6.0, (SN.EB_TOP + SN.EB_BOT) / 2), 4, -1)
    label(f'M2.5 x {TS_LEN:g} button head\nflush in the collar flange', (TS_X, H + 0.9), 0, 1)
    label('1.0 mm under the knob\n(press travel 0.5)', (TS_X + 1.2, H + 2.1), 1, 1)
    label(f'new boss on the rail\n{thread:.2f} mm of thread', (TS_X + 2.2, (zw + zb) / 2), 2, 1)
    label('screw tip: 1.27 mm\nabove the plug', (TS_X, H - TS_LEN - 0.55), 3, 1)
    label('QT plug\n(boss passes 0.82 over it)', (16.5, SN.EB_BOT - 1.5), 4, 1)
    d.text((24, 22), f'P4 top screws: section through the knob axis, seen from the front (wall {WALL:g} mm). '
                     f'Screws drawn blue and the new tray material orange; the real parts are black.', fill=INK, font=fs)
    im.save(f'{img}/p4-top-screws-section.png')


def views(Q, img):
    W, Hh, top, gap = 840, 760, 96, 16
    f = font(22)
    # 1. straight down, knob on (orthographic): what shows of the heads
    near = box(-62, 62, -5, D + 1, H - 40, H + 60)
    it = [(mesh(Q[k] ^ near, COLORS[k]), np.eye(4)) for k in ('shell', 'collar', 'shaft', 'nut', 'screws', 'knob')]
    xm = 36.0
    a = render(it, eye=(0, KY, H + 300), target=(0, KY, H), size=(W, Hh), ortho=(xm, xm * Hh / W), up=(0, 1, 0))
    # 2. the knob lifted off
    it = [(mesh(Q[k] ^ near, COLORS[k]), np.eye(4)) for k in ('shell', 'collar', 'shaft', 'nut', 'screws')]
    it.append((mesh(Q['knob'], COLORS['knob']), shift(dz=24.0)))
    b = render(it, eye=(46, KY - 120, H + 92), target=(0, KY, H + 6), size=(W, Hh), yfov=0.60)
    # 3. the tray's top wall from inside and below (shell, knob and collar hidden), cut off 13 mm under the case top
    under = box(-34, 34, DR.YF - 1, DR.Y1 - 4.0, H - 13.0, H + 5)
    cols = dict(COLORS, tray=[0.46, 0.46, 0.50])
    it = [(mesh(Q[k] ^ under, cols[k]), np.eye(4)) for k in ('tray', 'added', 'board', 'socks', 'screws')]   # plugs left out: they hide the bosses
    c = render(it, eye=(16, KY - 26, H - 84), target=(0, KY + 3, H - 7), size=(W, Hh), yfov=0.62)
    im = Image.new('RGB', (3 * W + 2 * gap, Hh + top), BG)
    d = ImageDraw.Draw(im)
    caps = ('From straight above, knob on:\nthe heads stay under the knob',
            'Knob lifted off: the two heads sit\nflush in the collar flange',
            'Tray top wall from below (shell and plugs hidden):\nthe new boss (orange) outside each rail, screw tip in it')
    for i, (p, cap) in enumerate(zip((a, b, c), caps)):
        im.paste(p, (i * (W + gap), top))
        d.multiline_text((i * (W + gap) + 20, 16), cap, fill=INK, font=f, spacing=6)
    im.save(f'{img}/p4-top-screws-views.png')


if __name__ == '__main__':
    img = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(img, exist_ok=True)
    Q = parts()
    section(Q, img)
    views(Q, img)
    print('ok')
