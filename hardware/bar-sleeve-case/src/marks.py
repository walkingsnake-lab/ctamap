"""Markings on the shell's underside (v5 drawer shell): two label recesses and debossed lettering.

One layout for every panel: it fits between the P2.5's feet (the narrowest shell), so P3 and a future P4 get the same
footprint, and one test print checks them all.

Why the underside: it prints as a vertical wall (the shell prints back-down), so a shallow recess or lettering only leaves
small overhangs. Seen in the print, a recess's front edge (smaller y) is a roof as wide as the recess, a bridge: it's
chamfered at 45 deg like the teardrops elsewhere. The lettering's roofs are a letter wide (< 4 mm), short enough to bridge.

- Setup sticker (QR to join the board's setup network): 1/2 x 1 3/4 in (12.7 x 44.45), the 80-up return-address sheet.
- Regulatory label (product, model, Part 15 statement): 1 x 2 5/8 in (25.4 x 66.68), the 30-up address sheet.
- Lettering, debossed (permanently marked, 47 CFR 2.925(d)): the model, and "Contains FCC ID: ..." (15.212). Nothing has to
  be debossed (a nameplate with permanent adhesive also counts), but these must outlast a peeled label. With a 0.4 nozzle
  it's three centred lines; with a 0.6 the ID line would reach the screws, so the model moves under the setup sticker.
  Placeholders until settled: MODEL, FCC_ID in the environment (FCC_ID: read it off the S3's module can).

Lettering size follows the nozzle: vertical strokes and the gaps between letters must be wider than a line (horizontal
strokes are layers, so they can be thinner), or the slicer drops or merges them. NOZZLE=0.4: caps 3.75 mm, strokes 0.9;
NOZZLE=0.6: caps 4.6, strokes 1.1. Any font works: one with thinner stems is thickened (outline offset) to the stroke, and
letter spacing is widened to keep the gaps. MARK_FONT=dejavu|atkinson|b612|ocrb, MARK_CAPS=1 for all caps.

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
MODEL_LINE = f'MODEL {MODEL}' if os.environ.get('MARK_MODEL', '1') != '0' else None   # MARK_MODEL=0: FCC ID only

_FD = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts')
FONTS = {                 # candidates (../fonts/README.md); compared on coupon-marks-ladder.stl
    'dejavu': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'atkinson': os.path.join(_FD, 'AtkinsonHyperlegible-Bold.ttf'),
    'b612': os.path.join(_FD, 'B612-Bold.ttf'),
    'ocrb': os.path.join(_FD, 'OCRB.otf'),
}
FONT = FONTS.get(os.environ.get('MARK_FONT', 'dejavu'), os.environ.get('MARK_FONT'))   # a name above, or a font file
CAPS = os.environ.get('MARK_CAPS', '0') == '1'   # all caps: no small lowercase counters (e, a, s) to fill in
NOZZLE = float(os.environ.get('NOZZLE', '0.4'))
STROKE = NOZZLE + 0.5     # narrowest feature in the lettering (vertical stroke, gap between letters): 0.9 at 0.4, 1.1 at 0.6
CAP_H = round(STROKE * 4.17, 2)   # cap height: 3.75 at 0.4, 4.59 at 0.6 (DejaVu Bold's own strokes are that wide there)
TEXT_PITCH = 1.71 * CAP_H
LINES = ['CONTAINS FCC ID:' if CAPS else 'Contains FCC ID:', FCC_ID]
TEXT_DEPTH = 0.6          # deboss depth (3 layers at 0.2 across a 3.5 mm wall)
REC_DEPTH = 0.5           # label recesses (a label is 0.1-0.25 thick: its edges sit below the surface, out of reach)
REC_CL = 0.4              # recess size past the label, a side
REC_R = 1.6               # label corner radius (round-cornered sheets: ~1.6 mm)
SETUP = (1.75 * IN, 0.5 * IN)        # w, h
REG = (2.625 * IN, 1.0 * IN)
GAP = 3.0                 # between the recesses
REC_Y0 = 11.8             # recesses' front edge (y): the bottom face starts at front_y(0) = 9
TEXT_GAP = 3.2            # recesses' back edge to the first line's cap top
MODEL_BESIDE = NOZZLE >= 0.6   # model line under the setup sticker instead of above the FCC ID


_METRICS = {}


def _metrics(font):
    """per unit font size: cap height, stem width (H's left stem at 30% height), the tightest side gap of H O N C 0
    (advance - outline width)"""
    if font not in _METRICS:
        from matplotlib.textpath import TextPath
        from matplotlib.font_manager import FontProperties
        from PIL import ImageFont
        tp = TextPath((0, 0), 'H', size=1, prop=FontProperties(fname=font))
        e = tp.get_extents()
        cs = CrossSection([p for p in tp.to_polygons() if len(p) >= 3], FillRule.EvenOdd)
        cut = cs ^ CrossSection.square([5, 0.002]).translate([-1, 0.3 * e.y1])
        stem = min((c.bounds()[0], c.bounds()[2] - c.bounds()[0]) for c in cut.decompose())[1]
        pil, fp = ImageFont.truetype(font, 1000), FontProperties(fname=font)
        gap = min(pil.getlength(c) / 1000 - TextPath((0, 0), c, size=1, prop=fp).get_extents().width for c in 'HONC0')
        _METRICS[font] = (e.y1, stem, gap)
    return _METRICS[font]


def _text_cs(s, x_center, y_top, cap_h=None, font=None, stroke=None):
    """one line of text as a CrossSection on the bottom (z = 0) plane, read from below with the front (y = 0) at the top:
    glyph right = +x, glyph up = -y. Stems thinner than the stroke are thickened by an outline offset; letters are placed
    one by one with extra spacing so the gaps stay a stroke wide."""
    from matplotlib.textpath import TextPath
    from matplotlib.font_manager import FontProperties
    from PIL import ImageFont
    cap_h, font, stroke = cap_h or CAP_H, font or FONT, stroke or STROKE
    cap_r, stem_r, gap_r = _metrics(font)
    size = cap_h / cap_r
    off = max(0.0, (stroke - stem_r * size) / 2)
    track = max(0.0, stroke - (gap_r * size - 2 * off))
    fp, pil = FontProperties(fname=font), ImageFont.truetype(font, 1000)
    polys, x = [], 0.0
    for ch in s:
        if ch != ' ':
            tp = TextPath((x, 0), ch, size=size, prop=fp)
            polys += [p for p in tp.to_polygons() if len(p) >= 3]
        x += pil.getlength(ch) * size / 1000 + track
    cs = CrossSection([np.column_stack([p[:, 0], cap_h - p[:, 1]]) for p in polys], FillRule.EvenOdd)
    if off > 0:
        cs = cs.offset(off, C.JT, circular_segments=16)
    b = cs.bounds()
    return cs.translate([x_center - (b[0] + b[2]) / 2, y_top + off])


def _rrect(x0, x1, y0, y1, r):
    return CrossSection.square([x1 - x0 - 2 * r, y1 - y0 - 2 * r]).translate([x0 + r, y0 + r]).offset(r, C.JT, circular_segments=48)


def layout():
    """[(name, CrossSection, depth, chamfer)] on the bottom plane, and the label rectangles [(name, x0, y0, w, h)]"""
    (sw, sh), (rw, rh) = SETUP, REG
    ws, wr = sw + 2 * REC_CL, rw + 2 * REC_CL
    hr = rh + 2 * REC_CL
    x0 = -(wr + GAP + ws) / 2
    xs = x0 + wr + GAP
    # setup sticker centred on the regulatory label's row, or at its front with the model line under it
    ys = REC_Y0 if MODEL_LINE and MODEL_BESIDE else REC_Y0 + (hr - sh - 2 * REC_CL) / 2
    rec_r = _rrect(x0, x0 + wr, REC_Y0, REC_Y0 + hr, REC_R + REC_CL)
    rec_s = _rrect(xs, xs + ws, ys, ys + sh + 2 * REC_CL, REC_R + REC_CL)
    text = CrossSection()
    y = REC_Y0 + hr + TEXT_GAP
    lines = list(LINES)
    if MODEL_LINE and MODEL_BESIDE:
        text = text + _text_cs(MODEL_LINE, xs + ws / 2, ys + sh + 2 * REC_CL + 2.4)
    elif MODEL_LINE:
        lines.insert(0, MODEL_LINE)
    for s in lines:
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


LADDER = [   # (font, caps, cap height, stroke): sizes first (DejaVu: below the 0.4 pick, the 0.4 pick, the 0.6 pick), then
    ('dejavu', False, 3.35, 0.8), ('dejavu', False, 3.75, 0.9), ('dejavu', False, 4.59, 1.1),   # fonts at the 0.4 pick
    ('dejavu', True, 3.75, 0.9), ('atkinson', True, 3.75, 0.9), ('b612', True, 3.75, 0.9), ('ocrb', True, 3.75, 0.9)]


def _ladder_rows():
    rows, y = [], 4.0
    for i, (f, caps, cap_h, stroke) in enumerate(LADDER, 1):
        t = f'{i}  ' + ('CONTAINS FCC ID: 0O1I5S8B' if caps else 'Contains FCC ID: 0O1Il5S8B')
        rows.append(_text_cs(t, 0.0, y, cap_h=cap_h, font=FONTS[f], stroke=stroke))
        y += cap_h + 3.2
    cs = rows[0]
    for r in rows[1:]:
        cs = cs + r
    return cs, y


def coupon_ladder():
    """a plate standing on its back edge, one numbered line per LADDER row: which size and font stay crisp. The ID part is
    the characters that blur into each other (0 O, 1 I l, 5 S, 8 B)"""
    cs, y = _ladder_rows()
    b = cs.bounds()
    w, h = (b[2] - b[0]) + 10.0, y + 3.0
    plate = Manifold.cube([w, h, 3.0]).translate([-w / 2, 0, 0])
    plate = plate - Manifold.extrude(cs, TEXT_DEPTH + 1).translate([0, 0, -1])
    flange = Manifold.cube([w, 5.0, 14.0]).translate([-w / 2, h - 5.0, 0])
    return plate + flange


def _stand(m):
    """print orientation: stood on the flange (the back, largest y) like the back-down shell; the lettered face toward -y"""
    y1 = m.bounding_box()[4]
    return m.transform([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, y1]])


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


def preview_ladder(out, px=0.04):
    """the ladder's lettering as it's cut (thickened, spaced), dark on walnut"""
    from PIL import Image
    cs, h = _ladder_rows()
    b = cs.bounds()
    x0, y0 = b[0] - 3, 0.0
    nx, ny = int((b[2] - b[0] + 6) / px), int((h + 1) / px)
    m = _raster(cs, x0, y0, nx, ny, px)
    img = np.empty((ny, nx, 3), np.uint8)
    img[:] = (128, 86, 54)
    img[m] = (62, 38, 22)
    Image.fromarray(img).save(out)


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
        _save(_stand(coupon_wall(sh)), os.path.join(d, 'coupon-marks-wall.stl'))
        _save(_stand(coupon_ladder()), os.path.join(d, 'coupon-marks-ladder.stl'))
        preview_ladder(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'img', 'marks-ladder.png'))
        print(d)
    else:
        print(__doc__)
