"""Drawer (back v4): the flat back plate becomes a rigid tray that slides into the one-piece sleeve from the back.

Why: a flat plate held at the bottom pivots about its screws, so its top swung out and the panel corner without a post
gave when the screen was pushed. A deep tray inside a snug sleeve can't tilt (its walls would have to pass through the
sleeve's), and it stiffens the sleeve from inside along the whole depth.

- Tray: back + four walls (TRAY_WT thick, TRAY_CL inside the sleeve's bore) running forward to the diffuser's flange, so the
  flange is held between the screen rim and the tray's front edge. One pair of screws from below (x +/-46, both panels)
  stops it sliding out.
- The panel sits turned 180 deg in the case (MATRIX_ROTATION 180 in secrets.h): its input header is on the left. The S3 is
  turned 180 deg too, on the right, USB-C low on the right wall, centred between the panel's right-hand posts, so all four
  corner inserts get a bolted post (funnel tubes as plate v3). Boot and the status LED still face the back.
- Top wall: open slots from the front edge past the encoder's body and the light sensor (both hang from the sleeve's top),
  so the tray slides in past them. Right wall: a slot (open to the front edge) for the USB-C plug and the S3's
  edge buttons.
- Back: two full-width louver bands (intake bottom, exhaust top); Boot hole, status-light hole (plain, 2 mm), ribbon hooks,
  tie loop, two nut bosses for the French cleat (cleat.py). No keyholes.
- Stiffness: the sleeve's walls are 3.5 mm (CASE_WALL; v4 2.5) and the tray's 2.5 (v4 plate skirt 2.0): a thin wall's bending
  stiffness goes with thickness cubed (~2.7x and ~2x). Crush ribs on the tray's outside (CR_H) take out the clearance so the
  two walls brace each other along their length instead of sliding.
Shell: the v4 shell with 3.5 mm walls, the USB-C opening mirrored to the right wall, no tongue grooves, latches or detents.
The collar and the sensor bracket follow the wall (bar-encoder-collar-v5, bar-sensor-bracket-v5).
Run: python3 drawer.py <outdir>   (PANEL=p25 for the P2.5)
"""
import math, os, sys
os.environ.setdefault('CASE_WALL', '3.5')   # thicker sleeve walls (2.5 -> 3.5: ~2.7x stiffer); set before case.py loads
import numpy as np
from manifold3d import Manifold, CrossSection
import case as C
import case2 as V
import plate3 as P3
import panel
from case import box, rr_cs, prism_y, prism_x, cyl_y, cyl_z, ZC, H, D, WALL, HW, BORE_HX, BORE_HZ, BORE_R, JT, ADD, SEG, \
    PANEL_X, PANEL_Z, PANEL_BACK, PCB_Y0, PORT_Y, Y_FACE, BACKL, PLATE_T, KY

# one pair of screws from below on both panels: with the tray boxed in by the sleeve they only stop it sliding out
SCREW_XS_V5 = (46.0,)
for _m in (C, V, P3):
    _m.SCREW_XS = SCREW_XS_V5

TRAY_CL = 0.25                                  # tray outside to the sleeve's bore, a side (tune with the fit coupon)
TRAY_WT = 2.5                                   # 2 -> 2.5: ~2x stiffer; 0.55 mm left past the diffuser skirt top and bottom
# crush ribs on the tray's outside, along the slide direction: they stand CR_H proud of the wall, CR_H - TRAY_CL into the
# sleeve, and shave down as the tray goes in, so the two walls brace each other along their length with no play
CR_H, CR_W = 0.45, 1.2
FLANGE_BACK = Y_FACE + 1.2                      # diffuser flange's back face (FT 1.2)
YF = FLANGE_BACK                                # tray front edge: on the flange
Y1 = D - BACKL                                  # tray back, outer face (as plate v3: 4 mm inside the rim)
Y0 = Y1 - PLATE_T                               # tray back, inner face

# the panel turned 180 deg: inserts and headers point-mirrored
INSERTS = [(-x, -z) for x, z in panel.P['inserts']]
CORNERS = [max([q for q in INSERTS if q[0] * sx > 0 and q[1] * sz > 0], key=lambda q: (abs(q[0]), abs(q[1]))) for sx in (-1, 1) for sz in (-1, 1)]
HEADERS = [(-x, -z) for x, z in panel.P['headers']]   # [PO OUT (right), PI IN (left)] after the turn
SO_D = P3.SO_OD

# S3, turned 180 deg in its plane: USB edge on the right; board point (bx from the USB edge, by from the edge that is
# now at the bottom) -> case (x, z)
S3_EDGE = BORE_HX - TRAY_CL - TRAY_WT - 0.4     # board edge 0.4 mm inside the tray's right wall
_right = sorted([z for x, z in CORNERS if x > 0])
_z0, _z1 = _right[0] + SO_D / 2 + 0.6, _right[1] - SO_D / 2 - 0.6   # free band between the right-hand posts (rel ZC)
S3_Z0 = ZC + (_z0 + _z1) / 2 - 44.45 / 2        # board's bottom edge
USB_BY = V.S3_USB_BY
PORT_Z = S3_Z0 + USB_BY


def s3(bx, by):
    """Adafruit's board frame (bx from the USB edge, by from the edge nearest the USB-C); turned 180 deg that edge is
    now the bottom one"""
    return S3_EDGE - bx, S3_Z0 + by


S3_HOLES = [s3(bx, by) for bx, by in ((7.62, 15.875), (7.62, 35.56), (48.26, 35.56), (48.26, 15.875))]
S3_NEO = s3(12.192, 41.021)
S3_BOOT = s3(14.58, 28.524)
# edge buttons (Reset, Up, Down) now sit above the USB-C
BTN_Z0, BTN_Z1 = PORT_Z + 8.8, PORT_Z + 35.0


def configure_shell():
    """the v4 shell for the drawer"""
    V.TONGUES, V.DETENT, V.LATCH = False, False, False
    V.USB_SIDE = +1
    V.PORT_Z = PORT_Z
    V.BTN_Z0, V.BTN_Z1 = BTN_Z0, BTN_Z1
    V.SKINS, V.SKIN_USB, V.SENSOR_PRINTED, V.GLUED_FRAME = False, False, False, False


# ---- tray ----
LV_H, LV_PITCH, LV_DEPTH, LV_CH = 3.5, 5.0, 5.0, 1.5
LV_ROWS = 3
HOOK_RW = 20.3

# French cleat (cleat.py): the case cleat bolts to the tray's back between the louver bands, 2 x M3 into nuts in bosses inside
CLEAT_T = 12.0                                  # cleat depth = tray back to wall (the rim sits CLEAT_T - BACKL off the wall)
CLEAT_ATT = 14.0                                # case cleat's face on the tray (above its bevel)
_hz = BORE_HZ - TRAY_CL - TRAY_WT
CLEAT_ZTOP = ZC + _hz - 2.5 - LV_H - (LV_ROWS - 1) * LV_PITCH - 0.5 - 1.0   # 1 mm under the lowest top louver's opening
CLEAT_ZBOT = ZC - _hz + 2.5 + LV_H + (LV_ROWS - 1) * LV_PITCH - 0.5 + 1.0   # 1 mm over the highest bottom louver's opening
CLEAT_SCREWS = [(sx * 50.0, CLEAT_ZTOP - CLEAT_ATT / 2) for sx in (-1, 1)]
CLEAT_HW = min(75.0, min(S3_BOOT[0] - 2.4, S3_NEO[0] - 1.5) - 3.0)    # half length: clear of the Boot and status holes
CB_D, CB_H, CB_NUT = 10.0, 3.5, 5.6             # nut boss: diameter, height, nut across flats (snug)


def tray():
    outer = rr_cs(BORE_HX - TRAY_CL, BORE_HZ - TRAY_CL, BORE_R - TRAY_CL)
    inner = rr_cs(BORE_HX - TRAY_CL - TRAY_WT, BORE_HZ - TRAY_CL - TRAY_WT, BORE_R - TRAY_CL - TRAY_WT)
    t = prism_y(outer, Y0, Y1) + (prism_y(outer, YF, Y0 + 0.01) - prism_y(inner, YF - 1, Y0 + 0.02))
    hz = BORE_HZ - TRAY_CL - TRAY_WT                       # inner half height
    zin0, zin1 = ZC - hz, ZC + hz
    xin = BORE_HX - TRAY_CL - TRAY_WT

    def rrect_y(x0, x1, z0, z1, r, ya, yb):
        cs = CrossSection.square([x1 - x0 - 2 * r, z1 - z0 - 2 * r], center=True).offset(r, JT, circular_segments=24).translate([(x0 + x1) / 2, (z0 + z1) / 2])
        return prism_y(cs, ya, yb)

    def rrect_z(x0, x1, ya, yb, r, z0, z1):
        cs = CrossSection.square([x1 - x0 - 2 * r, yb - ya - 2 * r], center=True).offset(r, JT, circular_segments=24).translate([(x0 + x1) / 2, (ya + yb) / 2])
        return Manifold.extrude(cs, z1 - z0).translate([0, 0, z0])

    # louver bands (as plate v3, full width between the corner posts)
    y_in = Y1 - LV_DEPTH
    x_lim = min(abs(x) for x, z in CORNERS) - SO_D / 2 - 2.0

    def band(zb0, zb1):
        pts = [(Y0 + 0.01, zb0), (y_in + LV_CH, zb0), (y_in, zb0 + LV_CH), (y_in, zb1 - LV_CH), (y_in + LV_CH, zb1), (Y0 + 0.01, zb1)]
        cs = CrossSection([pts])
        if cs.area() <= 0:
            cs = CrossSection([pts[::-1]])
        return prism_x(cs, -xin, xin) ^ prism_y(inner, y_in - 1, Y0 + 1)
    zb_rows = [zin0 + 2.5 + LV_H / 2 + i * LV_PITCH for i in range(LV_ROWS)]
    zt_rows = [zin1 - 2.5 - LV_H / 2 - i * LV_PITCH for i in range(LV_ROWS)][::-1]
    t = t + band(zin0, zb_rows[-1] + LV_H / 2 + LV_DEPTH + 1.5) + band(zt_rows[0] - LV_H / 2 - 1.5, zin1)
    # bottom screw bosses (plate v3's, now standing on the tray's bottom wall)
    for x in [sx * scx for sx in (-1, 1) for scx in C.SCREW_XS]:
        t = t + rrect_z(x - 5, x + 5, C.SCREW_Y - 4.5, Y0 + 0.01, 2.0, zin0 - 0.01, WALL + 12.0)
    # panel posts at the four corner inserts
    for x, z in CORNERS:
        t = t + P3.standoff(x, z, Y0)
    # S3: pad and posts, status-light tube, Boot tube
    yc = PCB_Y0 + 1.6
    hxs = [h[0] for h in S3_HOLES]; hzs = [h[1] for h in S3_HOLES]
    t = t + rrect_y(min(hxs) - 3.7, max(hxs) + 3.7, min(hzs) - 3.7, max(hzs) + 3.7, 3.7, Y0 - 3.0, Y0 + 0.01)
    for hx, hz_ in S3_HOLES:
        t = t + cyl_y(hx, hz_, yc, Y0 + 0.01, P3.S3_POST_D, 32)
    tube_end = yc + 1.5
    t = t + cyl_y(*_xz(S3_NEO), tube_end, Y0 + 0.01, 7.0, 48)
    btop = yc + 1.9
    t = t + cyl_y(*_xz(S3_BOOT), btop + 1.0, Y0 + 0.01, 5.0, 32)
    # cleat nut bosses
    for cx, cz in CLEAT_SCREWS:
        t = t + cyl_y(cx, cz, Y0 - CB_H, Y0 + 0.01, CB_D, 48)
    # ribbon hooks: one pair on the ribbon's run from the S3's connector to the panel input (left)
    idc_x = S3_EDGE - 57.0
    pi_x = min(h[0] for h in HEADERS)
    RZ = ZC + min(HEADERS, key=lambda h: h[0])[1]
    hook_xs = [round((idc_x + pi_x) / 2, 1)]
    for hx in hook_xs:
        for side in (-1, 1):
            zi = RZ + side * (HOOK_RW / 2 + 1.0); zo = zi + side * 3.0
            ya, yb = Y0 - 3.0 - 1.5, Y0 - 3.0
            t = t + box(hx - 2.5, hx + 2.5, ya, Y0 + 0.01, min(zi, zo), max(zi, zo))
            tip = zi - side * 4.0
            t = t + Manifold.batch_hull([box(hx - 2.5, hx + 2.5, ya, yb, min(zi, zo), max(zi, zo)), box(hx - 2.5, hx + 2.5, ya, ya + 0.01, tip - 0.005, tip + 0.005)])
    # tie loop for the power-cable bundle, above the ribbon
    tz = RZ + HOOK_RW / 2 + 12.0
    t = t + rrect_z(-10.0, 10.0, Y0 - 2.2 - 1.8, Y0 + 0.01, 0.9, tz - 4.0, tz + 4.0)
    # ---- cuts
    cuts = []
    r = LV_H / 2
    pad = (min(hxs) - 3.7 - 1.0, max(hxs) + 3.7 + 1.0)

    def minus(pieces, g0, g1):
        out = []
        for c, d in pieces:
            if d <= g0 or c >= g1:
                out.append((c, d))
                continue
            if g0 - c > 2 * r + 4: out.append((c, g0))
            if d - g1 > 2 * r + 4: out.append((g1, d))
        return out
    for zc in zb_rows + zt_rows:
        segs = [(-x_lim, x_lim)]
        lo, hi = zc - r - 0.5, zc + LV_DEPTH + r + 0.5                      # the slot rises LV_DEPTH going inward
        if any(lo < hz_ + P3.S3_POST_D / 2 + 3.7 and hi > hz_ - P3.S3_POST_D / 2 - 3.7 for hz_ in hzs):
            segs = minus(segs, *pad)
        if zc < ZC:                                                          # bottom rows: gaps at the screw bosses
            for scx in C.SCREW_XS:
                segs = minus(minus(segs, -scx - 6.5, -scx + 6.5), scx - 6.5, scx + 6.5)
        for xa, xb in segs:
            def slab(y, dz, xa=xa, xb=xb, zc=zc):
                cs = CrossSection.square([xb - xa - 2 * r, 0.01], center=True).offset(r, JT, circular_segments=16).translate([(xa + xb) / 2, zc + dz])
                return prism_y(cs, y, y + 0.01)
            cuts.append(Manifold.batch_hull([slab(Y1 + 0.5, -0.5), slab(y_in - 0.5, LV_DEPTH + 0.5)]))
    # screw slots and nut pockets (plate v3)
    nut_end = C.SCREW_Y + P3.NUT_FLOAT + P3.NUT_CORNER
    mouth_end = C.SCREW_Y - P3.NUT_FLOAT - P3.NUT_CORNER
    for x in [sx * scx for sx in (-1, 1) for scx in C.SCREW_XS]:
        yb = C.SCREW_Y - 4.5
        slot = CrossSection.square([0.01, 2 * P3.NUT_FLOAT], center=True).offset(1.75, JT, circular_segments=24).translate([x, C.SCREW_Y])
        cuts.append(Manifold.extrude(slot, 20).translate([0, 0, -1]))
        nz0 = WALL + 4.0
        cuts.append(box(x - P3.NUT_W / 2, x + P3.NUT_W / 2, mouth_end, nut_end, nz0, nz0 + P3.NUT_H))
        cuts.append(box(x - P3.NUT_MOUTH / 2, x + P3.NUT_MOUTH / 2, yb - 1, mouth_end + 0.01, nz0, nz0 + P3.NUT_H))
    for x, z in CORNERS:
        cuts.append(cyl_y(x, ZC + z, P3.FOOT_Y + P3.SO_FLOOR, Y1 + 1, P3.SO_BORE, 48))
        cuts.append(P3.so_cone(x, ZC + z))
    cuts.append(box(-10.0 + 2, 10.0 - 2, Y0 - 2.2, Y0 + 0.02, tz - 5, tz + 5))      # tie loop gap
    for cx, cz in CLEAT_SCREWS:                                                     # cleat screw holes, nut pockets open inward
        cuts.append(cyl_y(cx, cz, Y0 - CB_H - 1, Y1 + 1, 3.4, 24))
        cuts.append(cyl_y(cx, cz, Y0 - CB_H - 1, Y0, CB_NUT / math.cos(math.pi / 6), 6))
    nx, nz = _xz(S3_NEO)
    cuts.append(cyl_y(nx, nz, tube_end - 1, Y0 + 0.5, 4.5, 48))
    cuts.append(cyl_y(nx, nz, Y0 - 1, Y1 + 1, P3.STATUS_D, 32))
    cuts.append(Manifold.cylinder(P3.STATUS_CH + 0.01, P3.STATUS_D / 2, P3.STATUS_D / 2 + P3.STATUS_CH, 32).rotate([-90, 0, 0]).translate([nx, Y1 - P3.STATUS_CH, nz]))
    for hx, hz_ in S3_HOLES:
        cuts.append(cyl_y(hx, hz_, yc - 1, yc + 8.0, P3.S3_PILOT, 24))
        cuts.append(Manifold.cylinder(P3.S3_LEAD + 0.01, P3.S3_PILOT / 2 + P3.S3_LEAD, P3.S3_PILOT / 2, 24).rotate([-90, 0, 0]).translate([hx, yc - 0.01, hz_]))
    bx, bz = _xz(S3_BOOT)
    cuts.append(cyl_y(bx, bz, btop + 0.5, Y1 + 1, 2.6, 24))
    cuts.append(Manifold.cylinder(1.0, 1.3, 2.4, 32).rotate([-90, 0, 0]).translate([bx, Y1 - 1.0 + 0.001, bz]))
    # top-wall slots, open to the front edge, past the encoder body and the light sensor (+ their bracket)
    import sensor as SN
    ztw = H - WALL - TRAY_CL - TRAY_WT - 1.0
    cuts.append(box(-13.5, 13.5, YF - 1, KY + 14.0, ztw, H))   # encoder board (25.4 square) and its nuts
    cuts.append(box(SN.SB_X0 - 1.5, SN.SB_X1 + 1.5, YF - 1, SN.SB_Y1 + 1.5, ztw, H))
    # right wall: window for the USB-C plug and the edge buttons
    # open to the front edge: printed back-down, a closed window's front edge would be a ~45 mm bridge
    cuts.append(box(xin - 1, BORE_HX + 1, YF - 1, PORT_Y + 5.0, PORT_Z - 7.5, BTN_Z1 + 1.0))
    t = t - Manifold.batch_boolean(cuts, ADD)
    t = t + crush_ribs()
    return max(t.decompose(), key=lambda m: m.volume())


def crush_ribs():
    """triangular ribs on the tray's outside, running front to back, clear of the wall slots"""
    import sensor as SN
    ox, oz = BORE_HX - TRAY_CL, BORE_HZ - TRAY_CL                # tray outside half sizes
    y_a, y_b = YF + 4.0, Y0 - 1.0
    ribs = []

    def rib(c0, c1, axis, sign):
        # triangle in the (x, z) plane at the wall: base CR_W along the wall, apex CR_H out
        if axis == 'z':                                          # on the top (+1) / bottom (-1) wall, at x = c0
            z = ZC + sign * oz
            pts = [(c0 - CR_W / 2, z - sign * 0.3), (c0 + CR_W / 2, z - sign * 0.3), (c0, z + sign * CR_H)]
        else:                                                    # on the right (+1) / left (-1) wall, at z = c0
            x = sign * ox
            pts = [(x - sign * 0.3, c0 - CR_W / 2), (x - sign * 0.3, c0 + CR_W / 2), (x + sign * CR_H, c0)]
        cs = CrossSection([pts])
        if cs.area() <= 0:
            cs = CrossSection([pts[::-1]])
        return prism_y(cs, y_a, y_b)
    xs = [-0.75 * (ox - BORE_R), -0.3 * (ox - BORE_R), 0.3 * (ox - BORE_R), 0.75 * (ox - BORE_R)]
    top_block = [(-13.5 - 2, 13.5 + 2), (SN.SB_X0 - 3.5, SN.SB_X1 + 3.5)]
    for x in xs:
        ribs.append(rib(x, None, 'z', -1))
        if not any(a < x < b for a, b in top_block):
            ribs.append(rib(x, None, 'z', +1))
    zs = [ZC - 0.5 * (oz - BORE_R), ZC + 0.5 * (oz - BORE_R)]
    for z in zs:
        ribs.append(rib(z, None, 'x', -1))
        if not (PORT_Z - 9.5 < z < BTN_Z1 + 3.0):
            ribs.append(rib(z, None, 'x', +1))
    return Manifold.batch_boolean(ribs, ADD)


def _xz(p):
    return p[0], p[1]


def s3_envelope():
    """S3 board and its parts, for fit checks (component side toward the back)"""
    def comp(bx0, bx1, by0, by1, h, top=True):
        (xa, za), (xb, zb) = s3(bx0, by0), s3(bx1, by1)
        y0 = PCB_Y0 + 1.6
        ys = (y0, y0 + h) if top else (PCB_Y0 - h, PCB_Y0)
        return box(min(xa, xb), max(xa, xb), ys[0], ys[1], min(za, zb), max(za, zb))
    pcb = box(S3_EDGE - 63.5, S3_EDGE, PCB_Y0, PCB_Y0 + 1.6, S3_Z0, S3_Z0 + 44.45)
    for hx, hz in S3_HOLES:
        pcb = pcb - cyl_y(hx, hz, PCB_Y0 - 1, PCB_Y0 + 3, P3.S3_POST_D + 0.4, 32)
    return Manifold.batch_boolean([pcb, comp(50.5, 63.8, 5.0, 39.4, 13.0), comp(51.65, 62.65, 5.5, 38.9, 8.5, top=False),
                                   comp(21.1, 39.1, 14.8, 40.3, 3.1), comp(8.3, 14.8, 17.2, 23.7, 5.8),
                                   comp(55.8, 61.0, 1.8, 7.0, 7.0), comp(55.8, 61.0, 37.5, 42.7, 7.0)], ADD)


def fit_coupon(sh, tr):
    """the sleeve's and the tray's top-right corner, 25 mm deep: slide one into the other to tune TRAY_CL"""
    cx, cz = BORE_HX - BORE_R, ZC + BORE_HZ - BORE_R
    reg = box(cx - 20, HW + 1, Y1 - 25, D + 1, cz - 20, H + 1)
    return sh ^ reg, tr ^ reg


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    configure_shell()
    V.BACKDOWN = True
    sh = V.shell2()
    tr = tray()
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])      # y = D on the bed (back down)

    def put(m, name, mat=down):
        me = m.to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
        t.apply_transform(mat); t.apply_translation([0, 0, -t.bounds[0][2]]); t.export(f'{out}/{name}')
        print(name, t.is_watertight, np.round(t.extents, 1).tolist())
    put(sh, 'bar-shell-v5-walnut-backdown.stl')
    put(tr, 'bar-drawer-tray.stl')                 # back face down, walls up
    cs, ct = fit_coupon(sh, tr)
    import collar as CO, sensor as SN                    # both follow the 3.5 mm wall
    CO.TIP_BACK = False
    t = CO.export(CO.collar(), f'{out}/bar-encoder-collar-v5.stl'); print('bar-encoder-collar-v5.stl', t.is_watertight)
    me = SN.bracket().to_mesh(); tb = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    tb.apply_translation([0, 0, -tb.bounds[0][2]]); tb.export(f'{out}/bar-sensor-bracket-v5.stl'); print('bar-sensor-bracket-v5.stl', tb.is_watertight)
    put(cs, 'coupon-v5-drawer-fit-shell.stl'); put(ct, 'coupon-v5-drawer-fit-tray.stl')
    print(dict(D=D, S3_edge=round(S3_EDGE, 2), s3_z0=round(S3_Z0 - ZC, 2), port_z=round(PORT_Z - ZC, 2), corners=CORNERS))
