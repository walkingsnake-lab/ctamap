"""Markings on the shell's underside (v5 drawer shell): two label recesses and debossed lettering.

One layout for every panel: it fits between the P2.5's feet (the narrowest shell), so P3 and a future P4 get the same
footprint, and one test print checks them all.

Why the underside: it prints as a vertical wall (the shell prints back-down), so a shallow recess or lettering only leaves
small overhangs. Seen in the print, a recess's front edge (smaller y) is a roof as wide as the recess, a bridge: it's
chamfered at 45 deg like the teardrops elsewhere. The lettering's roofs are a letter wide (< 4 mm), short enough to bridge.

- Setup sticker (QR to join the board's setup network): 1/2 x 1 3/4 in (12.7 x 44.45), the 80-up return-address sheet.
- Regulatory label (product, model, Part 15 statement): 1 x 2 5/8 in (25.4 x 66.68), the 30-up address sheet.
- Lettering, debossed (permanently marked, 47 CFR 2.925(d)): "Contains FCC ID: ..." (15.212), two lines. Nothing has to be
  debossed (a nameplate with permanent adhesive also counts), but this is the marking that must outlast a peeled label.
  Placeholders until settled: MODEL, FCC_ID in the environment (FCC_ID: read it off the S3's module can).

Lettering size follows the nozzle: vertical strokes (DejaVu Sans Bold: 0.175 x size) and the gaps between letters must be
wider than a line, or the slicer drops or merges them. NOZZLE=0.4 gives 5.1 mm text (strokes 0.9); NOZZLE=0.6 gives 6.3.

It reads correctly seen from below with the case's front edge at the top (tip the case back to look underneath).
Run: python3 marks.py preview <out.png>    a shaded preview of the underside (PANEL=p25 for the P2.5)
     python3 marks.py check                the layout clears the feet, screws and edges on every panel profile
     python3 marks.py coupon <dir>         test prints: the underside wall with the real layout, and a lettering ladder
"""
import os, sys, math
import numpy as np
from manifold3d import Manifold, CrossSection, FillRule
import case as C
import case2 as V

IN = 25.4
MODEL = os.environ.get('MODEL', 'AB-1')
FCC_ID = os.environ.get('FCC_ID', '2AC7Z-XXXXXXXXXXX')   # 17 characters: as long as Espressif's longest S3 module ID
LINES = ['Contains FCC ID:', FCC_ID]   # the minimum: the one marking with a permanence rule. The model is on the label;
if os.environ.get('MARK_MODEL'):         # MARK_MODEL=1 debosses it too (fits with a 0.4 nozzle only)
    LINES.insert(0, f'MODEL {MODEL}')

FONT = os.environ.get('MARK_FONT', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
NOZZLE = float(os.environ.get('NOZZLE', '0.4'))
STROKE = NOZZLE + 0.5     # narrowest feature in the lettering (vertical stroke, gap between letters): 0.9 at 0.4, 1.1 at 0.6
TEXT_SIZE = round(STROKE / 0.175, 1)   # 5.1 mm at 0.4 (caps 3.7), 6.3 at 0.6 (caps 4.6)
TRACK = max(0.0, STROKE - 0.1 * TEXT_SIZE)   # extra letter spacing: DejaVu Bold's own gap is ~0.1 x size
TEXT_PITCH = 1.25 * TEXT_SIZE
TEXT_DEPTH = 0.6          # deboss depth (3 layers at 0.2 across a 3.5 mm wall)
REC_DEPTH = 0.5           # label recesses (a label is 0.1-0.25 thick: its edges sit below the surface, out of reach)
REC_CL = 0.4              # recess size past the label, a side
REC_R = 1.6               # label corner radius (round-cornered sheets: ~1.6 mm)
SETUP = (1.75 * IN, 0.5 * IN)        # w, h
REG = (2.625 * IN, 1.0 * IN)
GAP = 3.0                 # between the recesses
REC_Y0 = 11.8             # recesses' front edge (y): the bottom face starts at front_y(0) = 9
TEXT_GAP = 3.2            # recesses' back edge to the first line's cap top


def _advance(ch, size):
    from PIL import ImageFont
    f = ImageFont.truetype(FONT, 1000)
    return f.getlength(ch) * size / 1000


def _text_cs(s, x_center, y_top, size=None, track=None):
    """one line of text as a CrossSection on the bottom (z = 0) plane, read from below with the front (y = 0) at the top:
    glyph right = +x, glyph up = -y. Letters placed one by one so tracking can widen the gaps."""
    from matplotlib.textpath import TextPath
    from matplotlib.font_manager import FontProperties
    size = TEXT_SIZE if size is None else size
    track = TRACK if track is None else track
    fp = FontProperties(fname=FONT)
    cap = TextPath((0, 0), 'H', size=size, prop=fp).get_extents().y1
    polys, x = [], 0.0
    for ch in s:
        if ch != ' ':
            tp = TextPath((x, 0), ch, size=size, prop=fp)
            polys += [p for p in tp.to_polygons() if len(p) >= 3]
        x += _advance(ch, size) + track
    width = x - track
    out = [np.column_stack([x_center + p[:, 0] - width / 2, y_top + cap - p[:, 1]]) for p in polys]
    return CrossSection(out, FillRule.EvenOdd)


def _rrect(x0, x1, y0, y1, r):
    return CrossSection.square([x1 - x0 - 2 * r, y1 - y0 - 2 * r]).translate([x0 + r, y0 + r]).offset(r, C.JT, circular_segments=48)


def layout():
    """[(name, CrossSection, depth, chamfer)] on the bottom plane, and the label rectangles [(name, x0, y0, w, h)]"""
    (sw, sh), (rw, rh) = SETUP, REG
    ws, wr = sw + 2 * REC_CL, rw + 2 * REC_CL
    hr = rh + 2 * REC_CL
    x0 = -(wr + GAP + ws) / 2
    xs = x0 + wr + GAP
    ys = REC_Y0 + (hr - sh - 2 * REC_CL) / 2          # setup sticker centred on the regulatory label's row
    rec_r = _rrect(x0, x0 + wr, REC_Y0, REC_Y0 + hr, REC_R + REC_CL)
    rec_s = _rrect(xs, xs + ws, ys, ys + sh + 2 * REC_CL, REC_R + REC_CL)
    text = CrossSection()
    y = REC_Y0 + hr + TEXT_GAP
    for s in LINES:
        text = text + _text_cs(s, 0.0, y)
        y += TEXT_PITCH
    items = [('regulatory label', rec_r, REC_DEPTH, True), ('setup sticker', rec_s, REC_DEPTH, True),
             ('lettering', text, TEXT_DEPTH, False)]
    labels = [('reg', x0 + REC_CL, REC_Y0 + REC_CL, rw, rh), ('setup', xs + REC_CL, ys + REC_CL, sw, sh)]
    return items, labels


def keep_out():
    """feet, the bottom screws' counterbores, and the bottom face's edges, as CrossSections"""
    k = [CrossSection.circle(C.FOOT_D / 2 + 1.0, 48).translate([fx, fy]) for fx, fy in C.FEET]
    for sx in (-1, 1):
        for x in V.SCREW_XS:
            k.append(_rrect(sx * x - 4.2, sx * x + 4.2, V.SCREW_Y - 4.6, V.SCREW_Y + 4.6, 4.1))
    return k


def check(items):
    bad = []
    for name, cs, *_ in items:
        b = cs.bounds()
        if b[1] < V.front_y(0) + 1.5 or b[3] > C.D - C.BACKL - 1.0 or b[0] < -C.HW + C.WALL + 4 or b[2] > C.HW - C.WALL - 4:
            bad.append((name, 'edge', [round(v, 1) for v in b]))
        for k in keep_out():
            if (cs ^ k).area() > 1e-6:
                bad.append((name, 'feet/screws'))
    return bad


def _cut(cs, depth, chamfer):
    """the cut for one item, from below the face to depth; chamfered: the front (roof) edge slopes back 45 deg. Needs a
    convex outline (the recesses are rounded rectangles)"""
    if not chamfer:
        return Manifold.extrude(cs, depth + 1).translate([0, 0, -1])
    top = Manifold.extrude(cs, 1).translate([0, 0, -1])
    b = cs.bounds()
    # the outline at full depth: its front edge depth further back (y), the other three edges where they were
    floor = cs ^ CrossSection.square([b[2] - b[0] + 2, b[3] - b[1]]).translate([b[0] - 1, b[1] + depth])
    deep = Manifold.extrude(floor, 0.001).translate([0, 0, depth - 0.001])
    return Manifold.batch_hull([top, deep])


def cuts():
    items, _ = layout()
    return Manifold.batch_boolean([_cut(cs, d, ch) for _, cs, d, ch in items], C.ADD)


def mark(shell):
    return shell - cuts()


# ---- test prints ----

def coupon_wall(shell):
    """the bottom wall with the real layout (x within the P2.5's feet), standing on a flange at the back: print it back-down
    like the shell, no supports. Stick real labels in it and look at the lettering in raking light"""
    xw = 61.0
    wall = shell ^ C.box(-xw, xw, V.front_y(0) - 1, C.D + 1, -1, C.WALL)
    flange = C.box(-xw, xw, C.D - 5.0, C.D, 0, 16.0)
    return wall + flange


def coupon_ladder():
    """a plate standing on its back edge with the ID line at three sizes (0.4 and 0.6 nozzle picks and one below), so a
    print shows where the lettering stops holding up"""
    w, y, cs = 120.0, 5.0, CrossSection()
    for size, stroke in ((4.6, 0.8), (5.1, 0.9), (6.3, 1.1)):     # one below the 0.4 pick, the 0.4 pick, the 0.6 pick
        cs = cs + _text_cs(f'{size:g} {FCC_ID}', 0.0, y, size=size, track=max(0.0, stroke - 0.1 * size))
        y += 1.25 * size + 3.0
    h = y + 2.0
    plate = Manifold.cube([w, h, 3.0]).translate([-w / 2, 0, 0])
    plate = plate - Manifold.extrude(cs, TEXT_DEPTH + 1).translate([0, 0, -1])
    flange = Manifold.cube([w, 5.0, 14.0]).translate([-w / 2, h - 5.0, 0])
    return plate + flange


def _save(m, path):
    import trimesh
    mesh = m.to_mesh()
    trimesh.Trimesh(vertices=mesh.vert_properties[:, :3], faces=mesh.tri_verts).export(path)


# ---- preview: a shaded height map of the underside, from slices ----

def _raster(cs, x0, y0, nx, ny, px):
    from PIL import Image, ImageDraw
    acc = np.zeros((ny, nx), bool)
    for poly in cs.to_polygons():
        p = np.asarray(poly)
        im = Image.new('1', (nx, ny), 0)
        ImageDraw.Draw(im).polygon([((x - x0) / px, (y - y0) / px) for x, y in p], fill=1)
        acc ^= np.array(im, bool)
    return acc


def preview(shell, out, px=0.08, stickers=False, title=''):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.colors import LightSource
    x0, x1, y0, y1 = -C.HW, C.HW, 0.0, C.D
    nx, ny = int((x1 - x0) / px), int((y1 - y0) / px)
    depth = np.full((ny, nx), np.nan)
    for z in reversed(np.arange(0.05, 1.6, 0.1)):     # lowest z with material wins
        depth[_raster(shell.slice(z), x0, y0, nx, ny, px)] = z
    solid = ~np.isnan(depth)
    hgt = np.where(solid, -np.nan_to_num(depth, nan=2.0), -2.0)   # surface height seen from below (0 = bottom face)
    shade = LightSource(azdeg=315, altdeg=35).hillshade(hgt, vert_exag=6, dx=px, dy=px)
    walnut = np.array([0.42, 0.27, 0.16])
    dark = np.where(solid, 1.0 - 0.9 * np.clip(np.nan_to_num(depth, nan=0.0) - 0.05, 0, 0.6), 1.0)
    img = np.clip(walnut[None, None, :] * (0.55 + 0.75 * shade[..., None]) * dark[..., None], 0, 1)
    img[~solid] = [0.08, 0.08, 0.08]
    fig, ax = plt.subplots(figsize=(14 * C.HW / 109.5, 14 * C.HW / 109.5 * ny / nx + 0.6), dpi=110)
    ax.imshow(img, extent=[x0, x1, y1, y0], interpolation='bilinear')
    if stickers:
        _draw_stickers(ax)
    ax.set_xlim(x0, x1); ax.set_ylim(y1, V.front_y(0) - 2)
    ax.set_xticks([]); ax.set_yticks([])
    ax.set_title(title + (' with labels' if stickers else ''), fontsize=11)
    fig.savefig(out, bbox_inches='tight'); plt.close(fig)


def _draw_stickers(ax):
    import qrcode
    from matplotlib.patches import FancyBboxPatch
    _, labels = layout()
    L = {n: (x, y, w, h) for n, x, y, w, h in labels}
    for x, y, w, h in L.values():
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f'round,pad=0,rounding_size={REC_R}', fc='#f4f4f0', ec='#bbb', lw=0.6, zorder=3))
    fig = ax.figure
    pt = fig.get_size_inches()[0] * 72 / (2 * C.HW)   # points per mm at this figure's scale
    x, y, w, h = L['setup']
    q = qrcode.QRCode(border=1, box_size=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
    q.add_data('WIFI:T:WPA;S:Board-H3HM;P:7q76qp5dvn;;'); q.make()
    m = np.array(q.get_matrix(), float)
    s = h - 1.4
    ax.imshow(1 - m, cmap='gray', extent=[x + 0.7, x + 0.7 + s, y + 0.7 + s, y + 0.7], zorder=4, interpolation='nearest')
    tx = x + s + 2.0
    ax.text(tx, y + 1.6, 'WiFi setup', fontsize=1.9 * pt, weight='bold', va='top', zorder=5)
    ax.text(tx, y + 5.0, 'Board-H3HM\nPass 7q76qp5dvn', fontsize=1.75 * pt, va='top', zorder=5, linespacing=1.3, family='monospace')
    x, y, w, h = L['reg']
    ax.text(x + 2.2, y + 1.8, f'Arrivals Board  ·  Model {MODEL}', fontsize=2.1 * pt, weight='bold', va='top', zorder=5)
    import textwrap
    stmt = '\n'.join(textwrap.wrap('This device complies with part 15 of the FCC Rules. Operation is subject to the following '
                                   'two conditions: (1) This device may not cause harmful interference, and (2) this device '
                                   'must accept any interference received, including interference that may cause undesired '
                                   'operation.', 62))
    ax.text(x + 2.2, y + 5.4, stmt, fontsize=1.65 * pt, va='top', zorder=5, linespacing=1.35)


def _shell(panel):
    os.environ['PANEL'] = panel
    import importlib, panel as P
    for mod in (P, C, V):
        importlib.reload(mod)
    import drawer as Dw
    importlib.reload(Dw)
    Dw.configure_shell()
    V.BACKDOWN = True
    return V.shell2()


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'check':
        for p in ('p3', 'p25'):
            _shell(p)
            print(p, check(layout()[0]) or 'clear of the feet, screws and edges')
    elif cmd == 'preview' and len(sys.argv) >= 3:
        p = os.environ.get('PANEL', 'p3')
        sh = mark(_shell(p))
        print('layout check:', check(layout()[0]) or 'clear of the feet, screws and edges')
        bottom = sh ^ C.box(-C.HW - 1, C.HW + 1, -1, C.D + 1, -1, 2.0)   # the bottom wall only: fast slices
        out = sys.argv[2]
        name = {'p3': 'P3', 'p25': 'P2.5'}.get(p, p)
        t = f'{name} underside, seen from below (front edge at the top), lettering for a {NOZZLE:g} nozzle'
        preview(bottom, out, title=t)
        preview(bottom, out.replace('.png', '-labels.png'), stickers=True, title=t)
        print(out)
    elif cmd == 'coupon' and len(sys.argv) >= 3:
        d = sys.argv[2]
        os.makedirs(d, exist_ok=True)
        sh = mark(_shell(os.environ.get('PANEL', 'p25')))
        _save(coupon_wall(sh), os.path.join(d, 'coupon-marks-wall.stl'))
        _save(coupon_ladder(), os.path.join(d, 'coupon-marks-ladder.stl'))
        print(d)
    else:
        print(__doc__)
