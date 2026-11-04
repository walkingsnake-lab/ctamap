"""Markings on the shell's underside (v5 drawer shell): two label recesses and debossed lettering.

Why the underside: it prints as a vertical wall (the shell prints back-down), so a shallow recess or lettering only leaves
small, harmless overhangs. On the tray's back (printed face-down on the bed) the same recess would be a 100 mm bridge with
its label sitting on the sagged strands.

- Recess A, the setup sticker (QR code to join the board's setup network): 1 1/3 x 4 in (33.9 x 101.6), 14 a sheet.
- Recess B, the regulatory label (Part 15 statement, ordered printed on polyester): RB_W x RB_H.
- Lettering, debossed (permanently marked on the enclosure, 47 CFR 2.925(d)): product and model, the radio module's FCC
  ID, power input, origin. Placeholders until they're settled: set PRODUCT, MODEL, FCC_ID, POWER, ORIGIN in the
  environment (FCC_ID: read it off the S3's module can).

It reads correctly seen from below with the case's front edge at the top (tip the case back to look underneath).
Run: python3 marks.py preview <out.png>   (a shaded preview of the underside; STLs are unchanged until marks are on)
"""
import os, sys, math
import numpy as np
from manifold3d import Manifold, CrossSection, FillRule
import case as C
import case2 as V

# what the lettering says (placeholders)
PRODUCT = os.environ.get('PRODUCT', 'ARRIVALS BOARD')
MODEL = os.environ.get('MODEL', 'AB-1')
FCC_ID = os.environ.get('FCC_ID', '2AC7Z-XXXXXXXX')
POWER = os.environ.get('POWER', '5 V DC 3 A  USB-C')
ORIGIN = os.environ.get('ORIGIN', 'Assembled in USA')

FONT = os.environ.get('MARK_FONT', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
TEXT_SIZE = 3.6           # font size (mm): caps ~2.6 mm, strokes ~0.55 mm (bold), above a 0.4 nozzle's line
TEXT_PITCH = 5.4          # line spacing
TEXT_DEPTH = 0.6          # deboss depth (3 layers at 0.2; 3.5 mm wall)
REC_DEPTH = 0.5           # label recesses (a label is 0.1-0.25 thick: its edges sit below the surface, out of reach)
REC_CL = 0.4              # recess size past the label, a side
REC_R = 1.6               # recess corner radius (labels have ~1.6 mm corners)
RA_W, RA_H = 101.6, 33.87  # setup sticker, 1 1/3 x 4 in
RB_W, RB_H = 46.0, 33.87   # regulatory label
GAP = 3.0                 # between the two recesses
REC_Y0 = 11.8             # recesses' front edge (y): the bottom face starts at front_y(0) = 9
TEXT_Y0 = 50.5            # first lettering line's cap top (y), between the bottom screws (x +/-46)


def _text_cs(s, x_center, y_top, size=TEXT_SIZE):
    """one line of text as a CrossSection on the bottom (z = 0) plane, read from below with the front (y = 0) at the top:
    glyph right = +x, glyph up = -y"""
    from matplotlib.textpath import TextPath
    from matplotlib.font_manager import FontProperties
    tp = TextPath((0, 0), s, size=size, prop=FontProperties(fname=FONT))
    polys = [p for p in tp.to_polygons() if len(p) >= 3]
    ext = tp.get_extents()
    cap = TextPath((0, 0), 'H', size=size, prop=FontProperties(fname=FONT)).get_extents().y1
    out = []
    for p in polys:
        u, v = p[:, 0], p[:, 1]
        x = x_center + (u - (ext.x0 + ext.x1) / 2)
        y = y_top + (cap - v)
        out.append(np.column_stack([x, y]))
    return CrossSection(out, FillRule.EvenOdd)


def _rrect(x0, x1, y0, y1, r):
    return CrossSection.square([x1 - x0 - 2 * r, y1 - y0 - 2 * r]).translate([x0 + r, y0 + r]).offset(r, C.JT, circular_segments=48)


def layout():
    """[(name, CrossSection, depth)] on the bottom plane"""
    wa, wb = RA_W + 2 * REC_CL, RB_W + 2 * REC_CL
    h = RA_H + 2 * REC_CL
    x0 = -(wa + GAP + wb) / 2
    rec_a = _rrect(x0, x0 + wa, REC_Y0, REC_Y0 + h, REC_R + REC_CL)
    rec_b = _rrect(x0 + wa + GAP, x0 + wa + GAP + wb, REC_Y0, REC_Y0 + h, REC_R + REC_CL)
    lines = [f'{PRODUCT}  ·  MODEL {MODEL}', f'Contains FCC ID: {FCC_ID}', f'{POWER}  ·  {ORIGIN}']
    text = CrossSection()
    for i, s in enumerate(lines):
        text = text + _text_cs(s, 0.0, TEXT_Y0 + i * TEXT_PITCH)
    return [('setup sticker', rec_a, REC_DEPTH), ('regulatory label', rec_b, REC_DEPTH), ('lettering', text, TEXT_DEPTH)], (x0, wa, wb, h)


def check(items):
    """clear of the feet, the bottom screws' counterbores and the bottom face's edges"""
    keep_out = []
    for fx, fy in C.FEET:
        keep_out.append(CrossSection.circle(C.FOOT_D / 2 + 1.0, 48).translate([fx, fy]))
    for sx in (-1, 1):
        for x in V.SCREW_XS:
            keep_out.append(_rrect(sx * x - 4.2, sx * x + 4.2, V.SCREW_Y - 4.6, V.SCREW_Y + 4.6, 4.1))
    bad = []
    for name, cs, _ in items:
        b = cs.bounds()
        if b[1] < V.front_y(0) + 1.5 or b[3] > C.D - C.BACKL - 1.0 or b[0] < -C.HW + C.WALL + 4 or b[2] > C.HW - C.WALL - 4:
            bad.append((name, 'edge', [round(v, 1) for v in b]))
        for k in keep_out:
            if (cs ^ k).area() > 1e-6:
                bad.append((name, 'feet/screws'))
    return bad


def cuts():
    items, _ = layout()
    return Manifold.batch_boolean([Manifold.extrude(cs, d + 1).translate([0, 0, -1]) for _, cs, d in items], C.ADD)


def mark(shell):
    return shell - cuts()


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


def preview(shell, out, px=0.08, stickers=False):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.colors import LightSource
    x0, x1, y0, y1 = -C.HW, C.HW, 0.0, C.D
    nx, ny = int((x1 - x0) / px), int((y1 - y0) / px)
    depth = np.full((ny, nx), np.nan)
    levels = np.arange(0.05, 1.6, 0.1)
    for z in reversed(levels):                       # lowest z with material wins
        sl = _raster(shell.slice(z), x0, y0, nx, ny, px)
        depth[sl] = z
    solid = ~np.isnan(depth)
    hgt = np.where(solid, -np.nan_to_num(depth, nan=2.0), -2.0)   # surface height seen from below (0 = bottom face)
    ls = LightSource(azdeg=315, altdeg=35)
    walnut = np.array([0.42, 0.27, 0.16])
    shade = ls.hillshade(hgt, vert_exag=6, dx=px, dy=px)
    # cavity floors darker (ambient occlusion, roughly): lettering reads as it does in raking light
    dark = np.where(solid, 1.0 - 0.9 * np.clip(np.nan_to_num(depth, nan=0.0) - 0.05, 0, 0.6), 1.0)
    img = np.clip(walnut[None, None, :] * (0.55 + 0.75 * shade[..., None]) * dark[..., None], 0, 1)
    img[~solid] = [0.08, 0.08, 0.08]
    fig, ax = plt.subplots(figsize=(14, 14 * ny / nx + 0.6), dpi=110)
    ax.imshow(img, extent=[x0, x1, y1, y0], interpolation='bilinear')
    if stickers:
        _draw_stickers(ax)
    ax.set_xlim(x0, x1); ax.set_ylim(y1, V.front_y(0) - 2)
    ax.set_xticks([]); ax.set_yticks([])
    ax.set_title('Underside, seen from below (front edge at the top)' + (' with labels' if stickers else ''), fontsize=12)
    fig.savefig(out, bbox_inches='tight'); plt.close(fig)


def _draw_stickers(ax):
    import qrcode
    from matplotlib.patches import FancyBboxPatch
    _, (x0, wa, wb, h) = layout()
    ra = (x0 + REC_CL, REC_Y0 + REC_CL)
    rb = (x0 + wa + GAP + REC_CL, REC_Y0 + REC_CL)
    for (x, y), w in ((ra, RA_W), (rb, RB_W)):
        ax.add_patch(FancyBboxPatch((x, y), w, RA_H, boxstyle=f'round,pad=0,rounding_size={REC_R}', fc='#f4f4f0', ec='#bbb', lw=0.6, zorder=3))
    q = qrcode.QRCode(border=1, box_size=1); q.add_data('WIFI:T:WPA;S:Board-H3HM;P:7q76qp5dvn;;'); q.make()
    m = np.array(q.get_matrix(), float)
    s = 27.0
    ax.imshow(1 - m, cmap='gray', extent=[ra[0] + 3, ra[0] + 3 + s, ra[1] + 3.4 + s, ra[1] + 3.4], zorder=4, interpolation='nearest')
    tx = ra[0] + s + 7
    ax.text(tx, ra[1] + 6, 'Set up WiFi', fontsize=8, weight='bold', va='top', zorder=5)
    ax.text(tx, ra[1] + 11, 'Scan to join Board-H3HM\nPassword 7q76qp5dvn', fontsize=6.4, va='top', zorder=5, linespacing=1.5)
    ax.text(tx, ra[1] + 22, 'Then open the owner link\non the card in the box.', fontsize=6.4, va='top', zorder=5, color='#444', linespacing=1.5)
    ax.text(tx, ra[1] + RA_H - 3, 'Board ID kitchen', fontsize=5.6, va='bottom', zorder=5, color='#666')
    ax.text(rb[0] + 2.5, rb[1] + 3, f'{PRODUCT} · {MODEL}', fontsize=5.4, weight='bold', va='top', zorder=5)
    stmt = ('This device complies with part 15 of\nthe FCC Rules. Operation is subject to\nthe following two conditions: (1) This\n'
            'device may not cause harmful\ninterference, and (2) this device must\naccept any interference received,\n'
            'including interference that may\ncause undesired operation.')
    ax.text(rb[0] + 2.5, rb[1] + 7.5, stmt, fontsize=4.1, va='top', zorder=5, linespacing=1.35)


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'preview':
        import drawer as Dw
        Dw.configure_shell()
        V.BACKDOWN = True
        items, _ = layout()
        problems = check(items)
        print('layout check:', problems or 'clear of the feet, screws and edges')
        sh = mark(V.shell2())
        bottom = sh ^ C.box(-C.HW - 1, C.HW + 1, -1, C.D + 1, -1, 2.0)   # the bottom wall only: fast slices
        out = sys.argv[2]
        preview(bottom, out)
        preview(bottom, out.replace('.png', '-labels.png'), stickers=True)
        print(out)
    else:
        print(__doc__)
