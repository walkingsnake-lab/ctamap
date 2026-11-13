"""Renders of every assembly point of the P4 bar sleeve (p4.py), from the model:
    python3 render_p4_assembly.py <img dir>        (CASE_WALL=4.0 for the 4 mm wall)
Needs pyrender on EGL (headless), as render_p3x2.py. Writes p4-assembly-01 ... -10 .png: an exploded overview with the
assembly points numbered, then a labelled section or close-up of each. The top screws under the knob have their own
script (render_p4_top.py). Colours are for reading, not the print colours: the two shell halves and the two tray halves
are shaded apart, the spine, bridge, sled and cleats are teal, every screw is blue."""
import math, os, sys, textwrap
os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')
import numpy as np
import trimesh
import pyrender
from PIL import Image, ImageDraw, ImageFont
import p4
from p4 import *
import case as C
import knob as KN, collar as CO, sensor as SN, cleat as CLT
import p4_cables as PC
from render_p3x2 import look_at, LIGHTS, AMBIENT

COL = dict(shell_top=[0.64, 0.43, 0.26], shell_bot=[0.52, 0.34, 0.20], tray_left=[0.24, 0.24, 0.28], tray_right=[0.37, 0.37, 0.43],
           dif_white=[0.90, 0.90, 0.85], dif_left=[0.08, 0.08, 0.09], dif_right=[0.17, 0.17, 0.19], panel=[0.14, 0.36, 0.30],
           spine=[0.14, 0.52, 0.56], bridge=[0.14, 0.52, 0.56], sled=[0.14, 0.52, 0.56], cleat_case=[0.14, 0.52, 0.56],
           cleat_wall=[0.74, 0.56, 0.16], wall=[0.78, 0.78, 0.75], s3=[0.50, 0.24, 0.55], sensor=[0.62, 0.26, 0.24],
           collar=[0.60, 0.67, 0.72], knob=[0.86, 0.85, 0.80], enc=[0.55, 0.55, 0.58], usb=[0.72, 0.72, 0.76],
           screw=[0.16, 0.42, 0.86], bumper=[0.10, 0.10, 0.10], window=[0.85, 0.80, 0.45], plates=[0.88, 0.80, 0.52])
BG = (247, 247, 245)
INK = (25, 25, 25)


def tm(m):
    me = m.to_mesh()
    return trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)


def mesh(m, color):
    """a manifold as a pyrender mesh, the shading baked into its face colours (as render_p3x2.load)"""
    t = tm(m)
    n = t.face_normals
    shade = AMBIENT * np.ones(len(n))
    for d, w in LIGHTS:
        d = np.array(d, float); d /= np.linalg.norm(d)
        shade += w * np.clip(n @ d, 0, None)
    rgb = np.clip(np.array(color)[None, :] * shade[:, None] * 1.25, 0, 1)
    t.visual.face_colors = np.hstack([(rgb * 255).astype(np.uint8), np.full((len(n), 1), 255, np.uint8)])
    return pyrender.Mesh.from_trimesh(t, smooth=False)


def shift(dx=0, dy=0, dz=0):
    m = np.eye(4); m[:3, 3] = [dx, dy, dz]; return m


def font(px):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    return ImageFont.load_default()


F_LABEL, F_TITLE, F_HEAD = font(22), font(24), font(30)


def gl(items, pose, size, yfov=None, ortho=None):
    scene = pyrender.Scene(bg_color=[BG[0] / 255, BG[1] / 255, BG[2] / 255, 1.0], ambient_light=[0.18, 0.18, 0.18])
    for m, col, T in items:
        if m.volume() > 1e-6:
            scene.add(mesh(m, col), pose=T)
    cam = pyrender.OrthographicCamera(xmag=ortho[0], ymag=ortho[1], znear=1.0, zfar=4000.0) if ortho else pyrender.PerspectiveCamera(yfov=yfov, znear=5.0, zfar=6000.0)
    scene.add(cam, pose=pose)
    r = pyrender.OffscreenRenderer(*size)
    color, _ = r.render(scene, flags=pyrender.RenderFlags.FLAT)
    r.delete()
    return Image.fromarray(color).convert('RGB')


def leader(d, a, b):
    for col, w in ((BG, 6), (INK, 2)):                           # a light halo, so the line reads over the dark parts
        d.line([a, b], fill=col, width=w)
    d.ellipse([a[0] - 6, a[1] - 6, a[0] + 6, a[1] + 6], fill=BG)
    d.ellipse([a[0] - 4, a[1] - 4, a[0] + 4, a[1] + 4], fill=INK)


VIEW = dict(front=((0, -1, 0), (0, 0, 1)), back=((0, 1, 0), (0, 0, 1)), right=((1, 0, 0), (0, 0, 1)), left=((-1, 0, 0), (0, 0, 1)),
            top=((0, 0, 1), (0, 1, 0)))                          # where the eye is, and which way is up


def section(title, items, keep, view, centre, xmag, size, labels, margin=460, wrap=35):
    """an orthographic panel: items [(manifold, colour)], drawn in that priority (an item is cut away where an earlier
    one is, so screws read inside the parts they thread into), each cut to the box `keep`; labels [(text, (x, y, z),
    side)] with side -1 (left margin) or +1 (right margin). Returns the panel as an image."""
    W, Hh = size
    ymag = xmag * Hh / W
    acc, draw = None, []
    for m, col in items:
        mm = m ^ keep if keep is not None else m
        draw.append((mm if acc is None else mm - acc, col, np.eye(4)))
        acc = mm if acc is None else acc + mm
    e, up = VIEW[view]
    c = np.array(centre, float)
    pose = look_at(c + 600.0 * np.array(e, float), c, up)
    img = gl(draw, pose, size, ortho=(xmag, ymag))
    s, u = pose[:3, 0], pose[:3, 1]
    top = 50
    im = Image.new('RGB', (W + 2 * margin, Hh + top + 14), BG)
    im.paste(img, (margin, top))
    d = ImageDraw.Draw(im)
    d.rectangle([margin, top, margin + W - 1, top + Hh - 1], outline=(190, 190, 186))
    d.text((16, 10), title, fill=INK, font=F_TITLE)
    px = lambda p: (margin + W / 2 + float((np.array(p, float) - c) @ s) / xmag * W / 2,
                    top + Hh / 2 - float((np.array(p, float) - c) @ u) / ymag * Hh / 2)
    for side in (-1, 1):
        rows = sorted([l for l in labels if l[2] == side], key=lambda l: px(l[1])[1])
        for i, (text, at, _) in enumerate(rows):
            y = top + Hh * (i + 0.5) / len(rows)
            b = (margin - 12, y) if side < 0 else (margin + W + 12, y)
            leader(d, px(at), b)
            lines = textwrap.wrap(text.replace('\n', ' '), wrap)       # one paragraph per label, wrapped to the margin
            for j, ln in enumerate(lines):
                yy = y + (j - (len(lines) - 1) / 2) * 27
                d.text((b[0] - 8, yy) if side < 0 else (b[0] + 8, yy), ln, fill=INK, font=F_LABEL, anchor='rm' if side < 0 else 'lm')
    return im


def persp(title, items, eye, target, size, yfov=0.6, callouts=(), legend=None):
    """a perspective panel: items [(manifold, colour, pose)]; callouts [(number or text, world point)]; legend: lines of
    text for a column on the right"""
    W, Hh = size
    pose = look_at(eye, target)
    img = gl(items, pose, size, yfov=yfov)
    top = 50
    lw = 640 if legend else 0
    im = Image.new('RGB', (W + lw, Hh + top + 14), BG)
    im.paste(img, (0, top))
    d = ImageDraw.Draw(im)
    d.text((16, 10), title, fill=INK, font=F_TITLE)
    inv = np.linalg.inv(pose)
    t = math.tan(yfov / 2)
    for tag, p in callouts:
        pc = inv @ np.array([p[0], p[1], p[2], 1.0])
        x = W / 2 * (1 + pc[0] / (-pc[2] * t * W / Hh))
        y = top + Hh / 2 * (1 - pc[1] / (-pc[2] * t))
        r = 17
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255), outline=INK, width=2)
        d.text((x, y), str(tag), fill=INK, font=F_LABEL, anchor='mm')
    if legend:
        for i, ln in enumerate(legend):
            d.text((W + 20, top + 16 + i * 31), ln, fill=INK, font=F_LABEL)
    return im


def stack(head, panels, path):
    W = max(p.size[0] for p in panels)
    Hh = sum(p.size[1] for p in panels) + 64
    im = Image.new('RGB', (W, Hh), BG)
    ImageDraw.Draw(im).text((16, 14), head, fill=INK, font=F_HEAD)
    y = 64
    for p in panels:
        im.paste(p, ((W - p.size[0]) // 2, y)); y += p.size[1]
    im.save(path)
    print(os.path.basename(path), im.size)


# ---------------------------------------------------------------- fasteners and stand-ins (case frame)
def flanged(x, z, y_seat, length=8.0):
    """M3 flanged button head (ISO 7380-2), axis along y, its head toward the back, seated at y_seat"""
    return cyl_y(x, z, y_seat, y_seat + 0.6, 6.9, 32) + cyl_y(x, z, y_seat + 0.6, y_seat + 1.9, 5.7, 32) + cyl_y(x, z, y_seat - length, y_seat + 0.01, 3.0, 24)


def parts():
    P = p4.build()
    Q = dict(shell_top=P['top'], shell_bot=P['bot'], tray_left=P['tray_left'], tray_right=P['tray_right'], spine=P['spine'], bridge=P['bridge'])
    dif = {k: p4.diffuser_in_case(v) for k, v in P['diffuser'].items()}
    Q['dif_white'] = dif[('left', 'white')] + dif[('right', 'white')]
    Q['dif_left'], Q['dif_right'] = dif[('left', 'black')], dif[('right', 'black')]
    Q['panel'] = p4.panel_p4()
    Q['s3'] = DR.s3_envelope()
    Q['sensor'] = DR.sensor_envelope()
    Q['sled'] = DR.sled()
    Q['window'] = DR.status_window()
    Q['collar'] = p4.collar_knob()
    Q['knob'] = p4.knob_in_case()
    eb_top, eb_bot = SN.EB_TOP, SN.EB_BOT
    Q['enc'] = (box(-12.7, 12.7, KY - 12.7, KY + 12.7, eb_bot, eb_top)
                + Manifold.cube([12.0, 12.0, H - 1.4 - eb_top], True).rotate([0, 0, 45]).translate([0, KY, (H - 1.4 + eb_top) / 2])
                + cyl_z(0, KY, H - 1.4, H + 6.0, 7.0) + cyl_z(0, KY, H + 6.0, H + KN.TIP_Z, 6.0)
                + Manifold.cylinder(2.2, 11.0 / math.sqrt(3), 11.0 / math.sqrt(3), 6).translate([0, KY, H + CO.FL_T]))
    ys = P3.FOOT_Y + P3.SO_FLOOR                                                 # the posts' floor, tube side
    Q['sc_posts'] = Manifold.batch_boolean([flanged(x, ZC + z, ys) for x, z in DR.CORNERS], ADD)
    Q['sc_bridge'] = flanged(0, BRIDGE_Z, ys)
    Q['sc_bottom'] = Manifold.batch_boolean([cyl_z(x, DR.BOT_Y, 1.0 - 1.65, 1.0, 5.7, 32) + cyl_z(x, DR.BOT_Y, 0.99, 11.0, 3.0, 24) for x in DR.bottom_xs()], ADD)
    yo = DR.Y1 + SPINE_T
    Q['sc_spine'] = Manifold.batch_boolean([Manifold.cylinder(1.7, 1.5, 3.0, 32).rotate([-90, 0, 0]).translate([x, yo - 1.7, z])
                                            + cyl_y(x, z, yo - 10.0, yo - 1.69, 3.0, 24) for x, z in DR.CLEAT_SCREWS], ADD)
    sc = p4.top_screws_env()
    Q['sc_top'] = sc[0] + sc[1]
    Q['sc_s3'] = Manifold.batch_boolean([cyl_y(x, z, PCB_Y0 - 1.5, PCB_Y0, 4.5, 24) + cyl_y(x, z, PCB_Y0 - 0.01, PCB_Y0 + 8.0, 2.5, 24) for x, z in DR.S3_HOLES], ADD)
    zo = H - WALL - DR.TRAY_CL
    sx, sy = DR.SLED_SCREW
    Q['sc_sled'] = cyl_z(sx, sy, zo - 1.8, zo - 0.3, 4.5, 24) + cyl_z(sx, sy, zo - 1.8 - 6.0, zo - 1.79, 2.5, 24)
    Q['sc_cleat'] = Manifold.batch_boolean([cyl_y(x, z, DR.Y1 + 4.0, DR.Y1 + 5.65, 5.7, 32) + cyl_y(x, z, DR.Y1 - 6.0, DR.Y1 + 4.01, 3.0, 24) for x, z in DR.CLEAT_SCREWS], ADD)
    Q['bumpers'] = Manifold.batch_boolean([cyl_z(fx, fy, C.FOOT_DEPTH - 3.8, C.FOOT_DEPTH, 12.7, 48) for fx, fy in C.FEET], ADD)
    up = PC.usb_plug()
    Q['usb'] = up['usb_shell'] + up['usb_overmold']
    Q['cleat_case'], Q['cleat_wall'] = CLT.case_cleat(), p4.wall_cleat_p4()
    Q['plates'] = P['plates'][0] + P['plates'][1] if P['plates'] else Manifold()
    return Q


def it(Q, *names):
    """items for a section, in drawing priority"""
    return [(Q[n], COL['screw'] if n.startswith('sc_') else COL.get(n, COL['enc'])) for n in names]


BIG = 1000.0
def slab(x=(-BIG, BIG), y=(-BIG, BIG), z=(-BIG, BIG)):
    return box(x[0], x[1], y[0], y[1], z[0], z[1])


# ---------------------------------------------------------------- 01 overview
def overview(Q, out):
    up = 46
    off = dict(shell_top=(0, 0, up), shell_bot=(0, 0, -up), plates=(0, 0, 0), dif_left=(-8, -125, 0), dif_right=(8, -125, 0),
               panel=(0, -62, 0), tray_left=(-14, 105, 0), tray_right=(14, 105, 0), s3=(14, 105, 0), sensor=(14, 105, 0), sled=(14, 105, 0),
               window=(14, 105, 0), sc_s3=(14, 105, 0), sc_sled=(14, 105, 0), spine=(0, 160, 0), bridge=(0, 160, 0), sc_spine=(0, 190, 0),
               sc_bridge=(0, 190, 0), sc_posts=(0, 165, 0), sc_bottom=(0, 0, -up - 30), bumpers=(0, 0, -up - 14), collar=(0, 0, up + 18),
               enc=(0, 0, up - 22), knob=(0, 0, up + 56), sc_top=(0, 0, up + 38))
    dw_l, dw_r = Q['dif_white'] ^ slab(x=(-BIG, 0)), Q['dif_white'] ^ slab(x=(0, BIG))      # the white faces ride with their halves
    items = [(Q[n], COL['screw'] if n.startswith('sc_') else COL.get(n, COL['enc']), shift(*o)) for n, o in off.items()]
    items += [(dw_l, COL['dif_white'], shift(*off['dif_left'])), (dw_r, COL['dif_white'], shift(*off['dif_right']))]
    P = lambda p, n: tuple(np.array(p, float) + np.array(off[n], float))
    zsp = DR.CLEAT_SCREWS[0][1]
    back = [(1, P((BORE_HX + 1, 44, ZJ), 'plates')), (4, P((120, DR.Y1, ZC + 56), 'tray_right')), (4, P((-120, DR.Y1, ZC + 56), 'tray_left')),
            (5, P((30, 72, zsp), 'spine')), (6, P((0, 72, BRIDGE_Z), 'bridge')), (7, P((46, DR.BOT_Y, -4), 'sc_bottom')),
            (8, P((TS_X + 6, KY, H + 4), 'sc_top')), (9, P((0, KY, H + 12), 'knob')), (10, P((HW, C.PORT_Y, DR.PORT_Z), 'shell_bot')),
            (12, P((114.9, 62, -3), 'bumpers'))]
    front = [(1, P((-BORE_HX - 1, 30, ZJ), 'plates')), (2, P((-70, Y_FACE, ZC + BORE_HZ - 2), 'dif_left')), (3, P((8, Y_FACE, ZC + 20), 'dif_right')),
             (8, P((-TS_X - 6, KY, H + 4), 'sc_top')), (9, P((0, KY, H + 12), 'knob')), (11, P((V.SENSOR_X, V.SENSOR_Y, H), 'shell_top')),
             (12, P((-114.9, 25, -3), 'bumpers'))]
    legend = ['1  Shell joint: a plate glued into a rebate inside',
              '    each end wall; V-groove outside',
              '2  Diffuser in the shell: its flange behind the rim,',
              '    the trays\' front edge behind the flange',
              '3  Diffuser centre joint: two halves, epoxy on the rib',
              '4  Panel to tray: 4 corner posts, M3 x 8 flanged',
              '5  Tray seam, top: spine, 2 x M3 x 10 countersunk',
              '6  Tray seam, bottom: bridge to the panel\'s',
              '    bottom-centre insert, M3 x 8 flanged',
              '7  Trays to the shell\'s bottom half: 2 x M3 x 10',
              '    from below; crush ribs all round',
              '8  Trays to the shell\'s top half (new): 2 x M2.5 x 8',
              '    under the knob',
              '9  Encoder: collar pressed into the top, M7 nut,',
              '    knob pushed onto the shaft',
              '10  S3 on the right tray half: 4 x M2.5 x 8;',
              '    USB-C through the end wall',
              '11  Light sensor (optional): sled in 2 hooks,',
              '    M2.5 x 6; pinhole in the top',
              '12  Feet: 4 bumpers. On a wall, the cleat',
              '    replaces the spine']
    c = np.array([0.0, 28.0, ZC + 20.0])
    a = persp('From the back, right and above (the trays, spine and bridge are nearest)', items, eye=tuple(c + 1050 * np.array([0.60, 0.62, 0.50])),
              target=tuple(c), size=(1500, 1060), yfov=0.50, callouts=back, legend=legend)
    b = persp('From the front, left and above (the diffuser halves are nearest)', items, eye=tuple(c + 1050 * np.array([-0.60, -0.62, 0.50])),
              target=tuple(c), size=(1500, 1060), yfov=0.50, callouts=front,
              legend=['Colours are for reading, not the print colours:', '  shell halves: two browns (both walnut)',
                      '  tray halves: two greys (both black PETG)', '  spine, bridge, sled: teal (black PETG)',
                      '  every screw: blue; joint plates: sand (any PLA)', '  panel: green; S3: purple; sensor: red'])
    stack(f'P4 bar sleeve, exploded: the assembly points (wall {WALL:g} mm)', [a, b], f'{out}/p4-assembly-01-overview.png')


# ---------------------------------------------------------------- 02 shell joint
def shell_joint(Q, out):
    xo = -HW                                                         # the left end wall's outer face
    xb = -BORE_HX                                                    # ... and its inner (bore) face
    w, h = p4.JP_Y1 - p4.JP_Y0, p4.JP_H
    near = slab(x=(-BIG, -96))
    lift = 34.0
    left_plate = Q['plates'] ^ slab(x=(-BIG, 0))
    a = persp(f'Left end from inside the case, the top half lifted {lift:g} mm: the plate stands in the bottom half\'s rebate; the top half\'s comes down over it',
              [(Q['shell_top'] ^ near, COL['shell_top'], shift(dz=lift)), (Q['shell_bot'] ^ near, COL['shell_bot'], np.eye(4)),
               (left_plate, COL['plates'], np.eye(4))],
              eye=(-40, -96, ZJ + 62), target=(-136, 40, ZJ + 12), size=(1500, 900), yfov=0.50,
              callouts=[('a', (xb - 0.6, 46, ZJ + 12)), ('b', (xb - 0.6, 50, ZJ + lift + 12)), ('c', (xo + WALL - 0.2, 8, ZJ)),
                        ('d', (xo + 2.2, 70.6, ZJ))],
              legend=[f'a  joint plate, {w:g} x {h:g} x {p4.JP_T} mm, any PLA, printed', '    flat: half in each shell half, glued to both',
                      f'b  rebate in the wall\'s inner face, {p4.JP_T + p4.JP_CL:.1f} mm deep', '    (its front end slopes 45 deg: no roof to print)',
                      f'c  V-groove round the end, {CHAMF:g} mm x 45 deg on', '    each half: outside, front rim, hood side, back rim',
                      f'd  flat end faces: a {p4.LAND:g} mm land along the visible', f'    edges, the rest hollowed {p4.HOLLOW} mm', '',
                      'The right end is the same, mirrored; its rebate', 'ends 5.5 mm above the USB-C opening.'])
    b = section('Section through the left end wall at mid depth, seen from the front (outside is on the left)',
                it(Q, 'plates', 'tray_left', 'shell_top', 'shell_bot'), slab(y=(45, 52)), 'front', (xo + 3.6, 45, ZJ), 8.0, (1300, 800),
                [('top half', (xo + 0.9, 45, ZJ + 3.8), -1),
                 (f'V-groove: {CHAMF:g} mm x 45 deg on each half, on every visible edge of the joint', (xo + 0.12, 45, ZJ), -1),
                 (f'land: the halves meet on this {p4.LAND:g} mm band along the outside', (xo + 1.2, 45, ZJ), -1),
                 ('bottom half', (xo + 0.9, 45, ZJ - 3.8), -1),
                 (f'hollow: {p4.HOLLOW} mm off each face behind the land, so only the visible edge has to close', (xo + 2.35, 45, ZJ), 1),
                 (f'joint plate, {p4.JP_T} mm, glued to both halves; {WALL - p4.JP_T - p4.JP_CL:.1f} mm of wall behind it', (xb - p4.JP_CL - p4.JP_T / 2, 45, ZJ + 2.6), 1),
                 (f'plate\'s face {p4.JP_CL} mm below the bore: the tray never touches it', (xb - p4.JP_CL / 2, 45, ZJ - 2.2), 1),
                 ('tray\'s end wall (PETG), 0.25 mm from the shell', (xb + DR.TRAY_CL + 1.25, 45, ZJ - 3.8), 1)])
    c = section('The left end wall\'s inner face, seen from inside the case with the tray out (front of the case is on the left)',
                it(Q, 'plates', 'shell_top', 'shell_bot'), slab(x=(-BIG, xb + 2.0)), 'right', (xb, D / 2, ZJ), 42.0, (1300, 900),
                [('hood (no plate here: the fronts are lined up on the flat sheet)', (xb, 6.0, ZJ + 14), -1),
                 ('rim and diffuser seat', (xb, Y_FACE - 0.6, ZJ + 6), -1),
                 ('rebate\'s sloped front end', (xb, p4.JP_Y0 - 0.8, ZJ - 14), -1),
                 ('joint line', (xb, 9.0, ZJ), -1),
                 (f'joint plate: {h / 2:g} mm into each half, {w:g} mm along the depth', (xb, 44.0, ZJ + 10), 1),
                 (f'plate has {p4.JP_CL_E} mm of play in the rebate; its square back end sets it front to back', (xb, p4.JP_Y1, ZJ - 8), 1),
                 ('joint line', (xb, 70.5, ZJ), 1),
                 ('back rim', (xb, D - 1.0, ZJ - 20), 1)])
    stack(f'1. Shell joint: top and bottom halves (wall {WALL:g} mm)', [a, b, c], f'{out}/p4-assembly-02-shell-joint.png')


# ---------------------------------------------------------------- 03 diffuser
def diffuser(Q, out):
    xp = -62.0                                                        # through a column of pixels on the left half
    zt = ZC + BORE_HZ
    a = section('Section through the top edge, seen from the right (front of the case is on the left)',
                it(Q, 'dif_white', 'dif_left', 'tray_left', 'panel', 'shell_top'), slab(x=(xp - 12, xp)), 'right', (xp, 19.5, H - 10.5), 20.0, (1300, 780),
                [('hood: the shell runs 16 mm\npast the screen at the top', (xp, 5.0, H - 1.7), -1),
                 (f'rim: the diffuser\'s flange seats behind it ({V.SEAT_DEG:g} deg, {V.RIM_IN - 0.3 - DF.BEV:.1f} mm overlap)', (xp, Y_FACE - 0.5, zt - 0.6), -1),
                 ('white first layer, 0.2 mm: the face and the flange\'s front', (xp, Y_FACE + 0.1, H - 17.0), -1),
                 ('black grid, 1.5 mm:\nits ribs sit between the LEDs', (xp, Y_FACE + 1.0, H - 20.0), -1),
                 ('shell top wall (walnut)', (xp, 28.0, H - WALL / 2), 1),
                 ('flange: the 8 mm border round the pixels, white in front, 1.2 mm thick, 0.3 mm clear of the bore', (xp, Y_FACE + 0.7, zt - 3.5), 1),
                 ('tray\'s front edge: 0.3 mm off the flange\nonce the posts seat on the panel', (xp, DR.YF + 1.5, zt - 1.5), 1),
                 (f'skirt over the panel\'s edge: locates\nonly ({DF.CLR:g} mm clear, no bumps)', (xp, Y_FACE + 3.4, ZC + 64.8), 1),
                 ('panel', (xp, 27.0, H - 20.0), 1)])
    b = section('Centre joint, cut level through a row of pixels and seen from above (screen face at the bottom)',
                it(Q, 'dif_white', 'dif_left', 'dif_right', 'panel'), slab(z=(ZC + 0.6, ZC + 2.0)), 'top', (0, Y_FACE + 1.9, ZC + 2), 9.0, (1300, 500),
                [('left half: a pixel\'s cell', (-6.0, Y_FACE + 0.95, ZC + 2), -1), ('normal rib, 0.8 mm', (-4.0, Y_FACE + 1.0, ZC + 2), -1),
                 ('white face, 0.2 mm: only this layer\nreaches the joint, so it is what meets', (-2.0, Y_FACE + 0.1, ZC + 2), -1),
                 (f'joint: two {CENTRE_RIB / 2:g} mm walls, the black set\n{p4.JOINT_SETBACK:g} mm back; screws at the borders', (0.0, Y_FACE + 1.1, ZC + 2), 1),
                 ('right half: normal rib', (4.0, Y_FACE + 1.0, ZC + 2), 1), ('panel (LED board)', (6.0, Y_FACE + 2.6, ZC + 2), 1)])
    stack('2 and 3. Diffuser: its seat in the shell, and its centre joint', [a, b], f'{out}/p4-assembly-03-diffuser.png')


# ---------------------------------------------------------------- 04 panel to tray
def posts(Q, out):
    px_, pz = 120.0, ZC + 56.0
    ys = P3.FOOT_Y + P3.SO_FLOOR
    a = section('Top-right corner post, cut through its axis and seen from the right (front on the left). The other three are the same.',
                it(Q, 'sc_posts', 'tray_right', 'dif_white', 'dif_right', 'panel', 'shell_top'), slab(x=(px_ - 14, px_)), 'right', (px_, 44.5, pz + 2.5), 31.5, (1300, 780),
                [('diffuser', (px_, Y_FACE + 1.0, pz - 9), -1), ('panel housing', (px_, 22.0, pz + 1.0), -1),
                 ('M3 insert boss on the panel\'s back\n(the screw reaches ~5 mm into it)', (px_, 29.5, pz + 3.4), -1),
                 ('post foot on the boss; posts are\n0.3 mm long so the panel stays\non the diffuser', (px_, P3.FOOT_Y + 0.4, pz - 4.6), -1),
                 ('shell top wall', (px_, 40.0, H - WALL / 2), 1), ('tray top wall', (px_, 48.0, DR._zw() + 1.2), 1),
                 ('M3 x 8 flanged button head\non a flat floor', (px_, ys + 1.0, pz + 1.5), 1),
                 (f'floor hole {DR.POST_HOLE:g} mm:\nthe screw floats +/-0.7 mm', (px_, ys - 1.5, pz - 2.0), 1),
                 (f'post tube, {DR.POST_BORE:g} mm bore:\nthe 2 mm key reaches down it', (px_, 55.0, pz - 2.5), 1),
                 ('tray back', (px_, DR.Y1 - 1.0, pz - 12), 1)])
    b = section('Bridge at the bottom of the tray seam, cut on the seam and seen from the right (front on the left)',
                it(Q, 'sc_bridge', 'bridge', 'tray_left', 'dif_white', 'dif_left', 'panel', 'shell_bot'), slab(x=(-14, 0)), 'right', (0, 44.5, BRIDGE_Z - 1.0), 31.5, (1300, 780),
                [('diffuser', (0, Y_FACE + 1.0, BRIDGE_Z + 12), -1), ('panel housing', (0, 24.0, BRIDGE_Z + 12), -1),
                 ('panel\'s bottom-centre insert', (0, 29.5, BRIDGE_Z + 3.4), -1), ('shell bottom wall', (0, 26.0, WALL / 2), -1),
                 ('M3 x 8 flanged button head', (0, ys + 1.0, BRIDGE_Z + 1.5), 1),
                 ('bridge post: passes a notch,\nhalf in each tray half', (0, 52.0, BRIDGE_Z + 4.6), 1),
                 ('bridge plate across the seam,\non the tray\'s back', (0, DR.Y1 + 1.5, BRIDGE_Z - 5.5), 1),
                 ('shell\'s back rim: the plate sits 1 mm inside it', (0, D - 1.2, WALL / 2), 1)])
    stack('4 and 6. Panel to tray: the four corner posts, and the bridge', [a, b], f'{out}/p4-assembly-04-posts-bridge.png')


# ---------------------------------------------------------------- 05 tray seam, spine
def seam(Q, out):
    zc = DR.CLEAT_SCREWS[0][1]
    back = [(Q['shell_top'], COL['shell_top'], np.eye(4)), (Q['shell_bot'], COL['shell_bot'], np.eye(4)),
            (Q['tray_left'], COL['tray_left'], np.eye(4)), (Q['tray_right'], COL['tray_right'], np.eye(4)), (Q['window'], COL['window'], np.eye(4)),
            (Q['spine'], COL['spine'], shift(dy=34)), (Q['bridge'], COL['bridge'], shift(dy=34)), (Q['sc_spine'], COL['screw'], shift(dy=62)),
            (Q['sc_bridge'], COL['screw'], shift(dy=62)), (Q['sc_posts'], COL['screw'], shift(dy=50))]
    a = persp('The back, with the spine, the bridge and the post screws pulled out', back, eye=(210, 520, ZC + 170), target=(0, 62, ZC - 4),
              size=(1500, 900), yfov=0.58,
              callouts=[('a', (0, DR.Y1 + 36, zc)), ('b', (0, DR.Y1 + 36, BRIDGE_Z)), ('c', (0, DR.Y1, ZC)), ('d', (120, DR.Y1 + 52, ZC + 56)),
                        ('e', (DR.S3_BOOT[0] if hasattr(DR, 'S3_BOOT') else 100, DR.Y1, ZC - 10))],
              legend=['a  spine: 2 x M3 x 10 countersunk into the', '    cleat bosses, one in each tray half',
                      'b  bridge: M3 x 8 flanged into the panel\'s', '    bottom-centre insert', 'c  tray seam (crosses the shell\'s joint)',
                      'd  4 x M3 x 8 flanged down the post tubes', 'e  Boot funnel and status window (right half)'])
    b = section('Spine, cut level through its two screws and seen from above (the back of the case is at the top)',
                it(Q, 'sc_spine', 'spine', 'tray_left', 'tray_right', 'shell_top'), slab(z=(zc - 5.0, zc)), 'top', (0, 64.5, zc), 66.0, (1500, 330),
                [('left tray half', (-30.0, DR.Y1 - 1.0, zc), -1), ('cleat boss with a 3.1 mm pilot', (-50.0, DR.Y0 - 2.5, zc), -1),
                 ('M3 x 10 countersunk, flush (no float: the spine sets the spacing)', (-50.0, DR.Y1 + 2.2, zc), -1),
                 ('spine, 3 mm, 124 mm long', (22.0, DR.Y1 + 1.5, zc), 1), ('seam: edges chamfered 0.5 mm\nso the right half can\'t catch', (0.0, DR.Y1 - 1.0, zc), 1),
                 ('right tray half', (30.0, DR.Y1 - 1.0, zc), 1)], margin=420)
    stack('5. Tray seam: the spine (top) and the bridge (bottom) tie the two halves', [a, b], f'{out}/p4-assembly-05-tray-seam.png')


# ---------------------------------------------------------------- 06 tray in the shell
def tray_fit(Q, out):
    xr = -0.3 * (BORE_HX - DR.TRAY_CL - BORE_R)                       # a top crush rib (left half)
    zo = H - WALL - DR.TRAY_CL
    a = section('A crush rib on the tray\'s top wall, cut across it and seen from the front',
                it(Q, 'tray_left', 'shell_top'), slab(y=(45, 50)), 'front', (xr, 45, H - 3.15), 6.5, (1300, 700),
                [('shell top wall (walnut)', (xr - 4.0, 45, H - 1.6), -1), (f'{DR.TRAY_CL} mm clearance\nall round', (xr - 4.5, 45, zo + 0.12), -1),
                 ('tray top wall (PETG, 2.5 mm)', (xr - 4.0, 45, zo - 1.3), -1),
                 (f'crush rib, {DR.CR_H} mm proud:\n{DR.CR_H - DR.TRAY_CL:.1f} mm into the walnut,\nshaved as the tray slides in', (xr, 45, zo + 0.2), 1),
                 ('4 ribs on the top, 4 on the bottom,\n2 on each end (3 on the right end)', (xr + 3.5, 45, zo - 1.8), 1)])
    xb = -46.0
    b = section('A screw from below, cut through its axis and seen from the right (front on the left). One per tray half.',
                it(Q, 'sc_bottom', 'tray_left', 'shell_bot'), slab(x=(xb - 12, xb)), 'right', (xb, 58.0, 6.5), 20.0, (1300, 780),
                [('tray floor', (xb, 46.0, DR.tray_floor_z() + 1.2), -1), ('shell bottom wall', (xb, 46.0, WALL / 2), -1),
                 (f'stadium hole: the tray floats\n+/-{DR.SCREW_FLOAT} mm front to back', (xb, DR.BOT_Y - 2.0, 2.2), -1),
                 ('M3 x 10 button head\nin a 1 mm counterbore', (xb, DR.BOT_Y, 0.2), -1),
                 (f'boss with a {DR.TAP_D:g} mm pilot:\nthe M3 threads into the PETG', (xb, DR.BOT_Y + 3.4, 8.5), 1),
                 ('tray back, here the bottom louver band', (xb, DR.Y1 - 2.0, 16.0), 1),
                 ('back rim, 4 mm past the tray', (xb, D - 1.5, 1.5), 1)])
    stack('7. Trays in the shell: crush ribs, and the two screws from below', [a, b], f'{out}/p4-assembly-06-tray-in-shell.png')


# ---------------------------------------------------------------- 08 S3 and USB-C
def s3_usb(Q, out):
    pz = DR.PORT_Z
    a = section('USB-C, cut level through the port and seen from above (the back of the case is at the top, the right end on the right)',
                it(Q, 'usb', 's3', 'tray_right', 'shell_bot'), slab(z=(pz - 3.0, pz)), 'top', (119.0, 52.5, pz), 30.0, (1300, 760),
                [('S3 board (component side\ntoward the back)', (112.0, PCB_Y0 + 0.8, pz), -1), ('tray back wall', (100.0, DR.Y1 - 1.0, pz), -1),
                 ('plug\'s metal shell, in the USB-C socket on the board\'s edge', (DR.S3_EDGE - 3.0, C.PORT_Y, pz), -1),
                 ('tray\'s right wall, open at the port', (BORE_HX - DR.TRAY_CL - 1.2, 60.0, pz), 1),
                 ('shell end wall: 13.65 x 8 mm opening,\nlarge enough for any plug\'s housing', (HW - WALL / 2, C.PORT_Y + 5.5, pz), 1),
                 ('cable\'s plug', (HW + 6.0, C.PORT_Y, pz), 1),
                 (f'board edge {BORE_HX - DR.S3_EDGE:.2f} mm inside the wall, {HW - DR.S3_EDGE:.2f} mm behind its outer face: the plug\'s housing goes in through the opening', (DR.S3_EDGE, PCB_Y0 + 0.8, pz), 1)])
    hz = DR.S3_HOLES[1][1]                                             # the upper pair of posts
    b = section('The S3\'s upper pair of posts, cut level through them and seen from above',
                it(Q, 'sc_s3', 's3', 'tray_right', 'shell_bot', 'shell_top'), slab(z=(hz - 3.0, hz)), 'top', (112.0, 52.5, hz), 37.0, (1300, 760),
                [('M2.5 x 8 from the panel side,\nself-tapping into the post', (DR.S3_HOLES[2][0], PCB_Y0 - 0.7, hz), -1),
                 ('S3 post on the tray\'s back', (DR.S3_HOLES[2][0], 58.0, hz), -1), ('tray back wall', (95.0, DR.Y1 - 1.0, hz), -1),
                 ('S3 board', (80.0, PCB_Y0 + 0.8, hz), -1),
                 ('second post, beside the edge buttons', (DR.S3_HOLES[1][0], 58.0, hz), 1),
                 (f'no relief now: the full {WALL:g} mm wall behind the edge buttons, {BORE_HX - DR.S3_EDGE:.2f} mm from the board\'s edge', (HW - WALL / 2, 44.0, hz), 1),
                 ('tray\'s right wall (open in front of the buttons and the port)', (BORE_HX - DR.TRAY_CL - 1.2, 60.0, hz), 1)])
    stack('10. S3 on the right tray half, and USB-C through the end wall', [a, b], f'{out}/p4-assembly-07-s3-usb.png')


# ---------------------------------------------------------------- 09 light sensor, encoder
def sensor_sled(Q, out):
    sx, sy = DR.SLED_SCREW
    zo = H - WALL - DR.TRAY_CL
    zs0, zs1 = DR.sled_z()
    a = section('Light-sensor sled (optional), cut through its front screw and seen from the right (front on the left)',
                it(Q, 'sc_sled', 'sensor', 'sled', 'tray_right', 'shell_top'), slab(x=(sx - 9, sx)), 'right', (sx, 49.0, H - 11.0), 26.0, (1300, 780),
                [('M2.5 x 6 button head from outside the\ntray\'s top, counterbored under the shell', (sx, sy, zo - 1.0), -1),
                 ('sled\'s boss: the screw pulls\nits front up to the wall', (sx, sy, DR._zw() - 2.0), -1),
                 ('sensor board, chip side up\n(screwed to the sled on the bench)', (sx, 50.0, DR.SEN_TOP - 0.8), -1),
                 ('sled plate', (sx, 46.0, (zs0 + zs1) / 2), -1),
                 ('shell top wall; its 2 mm pinhole\nis over the chip, 7 mm to the right of this cut', (sx, 46.0, H - WALL / 2), 1),
                 ('tray top wall', (sx, 62.5, zo - 1.2), 1),
                 ('hook on the top louver band: the sled\'s\nback tab swings into its slot', (sx, DR.HOOK_FRONT + 1.5, zs0 - 1.0), 1),
                 ('top louver band', (sx, DR.Y1 - 2.5, H - 14.0), 1)])
    under = slab(x=(22, 80), y=(DR.YF - 1, DR.Y1 + 1), z=(H - 24, H + 5))
    items = [((Q[n] ^ under), ([0.52, 0.52, 0.57] if n == 'tray_right' else COL['screw'] if n.startswith('sc_') else COL[n]), np.eye(4))
             for n in ('tray_right', 'sled', 'sensor', 'sc_sled')]
    b = persp('The sled from below and in front (shell hidden, the tray cut away 24 mm under its top)', items, eye=(86, -28, H - 92), target=(51, 50, H - 9),
              size=(1500, 760), yfov=0.50, callouts=[('a', (DR.hook_xs()[0], DR.HOOK_FRONT + 1, zs0 - 2)), ('a', (DR.hook_xs()[1], DR.HOOK_FRONT + 1, zs0 - 2)),
                                                    ('b', (sx, sy, zs0 - 1)), ('c', (V.SENSOR_X, 50, zs0))],
              legend=['a  two hooks; the back tabs sit in them', 'b  front boss and its screw (from above)', 'c  sled plate under the sensor board',
                      '', 'Tilt the sled ~10 deg, tabs into the hooks,', 'swing the front up, drive the one screw.'])
    stack('11. Light sensor on its sled (optional)', [a, b], f'{out}/p4-assembly-09-sensor-sled.png')


# ---------------------------------------------------------------- 10 wall cleat, feet
def cleat(Q, out):
    xc, zc = DR.CLEAT_SCREWS[0]
    wall = box(-200, 200, CLT.YW, CLT.YW + 6.0, -50, 250)
    items = [(Q['sc_cleat'], COL['screw']), (Q['cleat_case'], COL['cleat_case']), (Q['cleat_wall'], COL['cleat_wall']),
             (wall, COL['wall']), (Q['tray_left'], COL['tray_left']), (Q['shell_top'], COL['shell_top']), (Q['shell_bot'], COL['shell_bot'])]
    a = section('Wall cleat (optional, replaces the spine), cut through a case-cleat screw, seen from the right',
                items, slab(x=(xc - 40, xc)), 'right', (xc, 70.0, ZC + 28.0), 22.0, (900, 1500),
                [('tray back', (xc, DR.Y1 - 1.0, ZC + 12), -1), ('cleat boss in the tray\n(the spine\'s bosses)', (xc, DR.Y0 - 2.5, zc + 3.6), -1),
                 ('top louver band; the shell\'s rim ends 8 mm off the wall, so the louvers stay open', (xc, DR.Y1 - 2.5, CLT.CLEAT_ZTOP + 6.0), -1),
                 ('case cleat, 150 mm long, 12 mm deep: 2 x M3 x 10 from the wall side', (xc, DR.Y1 + 8.0, zc + 3.0), 1), ('M3 x 10 in a counterbore', (xc, DR.Y1 + 4.8, zc), 1),
                 ('45 deg bevels: the case drops\nonto the wall cleat', (xc, DR.Y1 + 6.0, CLT.ZB - 6.0), 1),
                 (f'wall cleat, {2 * p4.WALL_CLEAT_HW:g} mm long: its face also holds the tray\'s back plumb', (xc, DR.Y1 + 5.0, CLT.ZB - 30.0), 1),
                 (f'3 wood screws or anchors through the wall cleat, at the centre and {p4.WALL_CLEAT_XS[-1]:g} mm either side (not in this cut)', (xc, CLT.YW - 2.0, CLT.wall_screws()[0][1]), 1), ('wall', (xc, CLT.YW + 3.0, ZC + 4.0), 1)], margin=470)
    feet = [(Q['shell_top'], COL['shell_top'], np.eye(4)), (Q['shell_bot'], COL['shell_bot'], np.eye(4)),
            (Q['bumpers'], COL['bumper'], shift(dz=-16)), (Q['sc_bottom'], COL['screw'], shift(dz=-26))]
    b = persp('Underneath, seen from below and in front: four bumpers and the two screws from below, pulled out', feet, eye=(150, -250, -330), target=(0, 36, -6),
              size=(1500, 700), yfov=0.50, callouts=[('a', (114.9, 25, -19)), ('a', (-114.9, 25, -19)), ('a', (114.9, 62, -19)), ('a', (-114.9, 62, -19)),
                                                    ('b', (46, DR.BOT_Y, -36)), ('b', (-46, DR.BOT_Y, -36))],
              legend=['a  bumpers, 12.7 x 3.8 mm, in 1.5 mm recesses', 'b  M3 x 10 from below, one into each tray half'])
    stack('12. On a wall: the French cleat. On a shelf: the feet', [a, b], f'{out}/p4-assembly-10-cleat-feet.png')


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
    os.makedirs(out, exist_ok=True)
    Q = parts()
    for name, fn in (('overview', overview), ('shell', shell_joint), ('diffuser', diffuser), ('posts', posts), ('seam', seam), ('fit', tray_fit),
                     ('s3', s3_usb), ('sensor', sensor_sled), ('cleat', cleat)):
        if only is None or name in only:
            fn(Q, out)
    print('ok')
