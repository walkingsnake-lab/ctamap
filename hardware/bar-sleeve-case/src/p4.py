"""P4 bar sleeve: the v5 drawer case for a Waveshare RGB-Matrix-P4-64x32 (256 x 128), in parts that fit the X2D's
256 mm bed. Everything not listed here is the v5 drawer (drawer.py), built from the 'p4' panel profile.

Shell (walnut PLA): the v5 sleeve, split into a top and a bottom half at ZS (2 mm above centre, so both halves print the
same height). Only the two end walls are cut. The joint:
- a 1 mm x 1 mm reveal round each end (end wall, front rim, hood side, back rim), so the seam sits in shadow;
- a half-lap inside the wall: the inner half of the wall (WALL / 2) splits LAP lower than the outer half, so the top half
  carries a lip down over the bottom half. Glue (medium CA) goes on the lap faces. The lap stops 1 mm behind the screen
  face and 0.5 mm in front of the tray's back, so nothing of it shows in the hood or at the back rim.
- Glue the halves back-down on a flat sheet (the back rims are one plane), so they can't step front-to-back; the lap
  keys them in and out. Lap the front and finish after gluing.
Tray (black PETG): the v5 drawer tray, split at x = 0. Each half bolts to its two corner inserts (M3 x 8 countersunk down
the funnel tubes) and takes one M3 x 10 from below. Two bridges cross the tray seam on the back face:
- spine (top): a 3 mm bar on the cleat's two nuts (2 x M3 x 8). The French cleat bolts to the same nuts, so on a wall
  the case cleat replaces the spine;
- bridge (bottom): a plate and a funnel tube to the panel's bottom-centre insert (1 x M3 x 8 countersunk); the tube passes
  a notch half in each tray half, so it keys them.
Diffuser (two-colour PETG): the bar diffuser with an 8 mm flange, which is the bezel, split at x = 0 on the grid rib
between pixel columns 32 and 33. That rib is 1.2 mm (0.6 a half) instead of 0.8, so each half has a printable edge.
First layer: white over the pixels, black over the bezel; everything above it black.
Panel: turned 180 deg in the case like the v5 drawer (MATRIX_ROTATION 180), data in on the left; the S3 sits on the right
tray half, ribbon to the panel's input. (Plugged straight onto the panel's input, the S3's edge buttons would leave under
1 mm of wall at the 8 mm bezel.)
Run: python3 p4.py <outdir>   -> STLs (print orientation), coupons, and fit numbers
"""
import math, os, sys
os.environ['PANEL'] = 'p4'
os.environ.setdefault('CASE_WALL', '3.5')
import numpy as np
from manifold3d import Manifold, CrossSection
import panel
import case as C
import case2 as V
import plate3 as P3
import drawer as DR
import diffuser as DF
from case import box, rr_cs, prism_y, prism_x, cyl_y, cyl_z, ZC, H, D, WALL, HW, RC, BORE_HX, BORE_HZ, BORE_R, JT, ADD, SEG, \
    PANEL_BACK, PCB_Y0, Y_FACE, BACKL, PLATE_T, KY

DR.configure_shell()
V.BACKDOWN = True

# ---------------------------------------------------------------- shell split
LAP = 4.0                       # inner half of the wall splits this much lower than the outer half
REV_W, REV_D = 1.0, 1.0         # reveal: width (along z) and depth
ZS = (H + LAP) / 2              # outer split height: top and bottom halves come out the same height
LAP_Y0 = Y_FACE + 1.0           # lap only behind the screen face ...
LAP_Y1 = DR.Y1 - 0.5            # ... and in front of the tray's back (the back rim shows the plain reveal)
BED = 256.0


def outer_inset(i):
    """case2.outer_body() (back-down version: chamfered front and back rims) moved inward by i"""
    ch = V.CH_F
    pts = []
    for (x, z) in rr_cs(HW - ch - i, H / 2 - ch - i, RC - ch - i).to_polygons()[0]:
        pts.append((x, V.front_y(z) + i, z))
    for (x, z) in rr_cs(HW - i, H / 2 - i, RC - i).to_polygons()[0]:
        pts.append((x, V.front_y(z) + ch + i, z))
    for (x, z) in rr_cs(HW - ch - i, H / 2 - ch - i, RC - ch - i).to_polygons()[0]:
        pts.append((x, D - i, z))
    for (x, z) in rr_cs(HW - i, H / 2 - i, RC - i).to_polygons()[0]:
        pts.append((x, D - ch - i, z))
    return Manifold.hull_points(np.array(pts))


def visible_layer(sh, d):
    """shell material within d of a face you can see: outside, the hood in front of the screen, the back rim"""
    deep = outer_inset(d)
    deep = deep - prism_y(rr_cs(BORE_HX + d, BORE_HZ + d, BORE_R + d), -50, Y_FACE + d)
    deep = deep - prism_y(rr_cs(BORE_HX + d, BORE_HZ + d, BORE_R + d), DR.Y1, D + 50)
    return sh - deep


def split_shell(sh):
    reveal = visible_layer(sh, REV_D) ^ box(-HW - 1, HW + 1, -1, D + 1, ZS - REV_W / 2, ZS + REV_W / 2)
    s = sh - reveal
    lip = s ^ outer_inset(WALL / 2) ^ box(-HW - 1, HW + 1, LAP_Y0, LAP_Y1, ZS - LAP, ZS + 0.01)   # the top half's lap lip
    top = (s ^ box(-HW - 1, HW + 1, -50, D + 1, ZS, H + 10)) + lip
    bot = (s ^ box(-HW - 1, HW + 1, -50, D + 1, -10, ZS)) - lip
    big = lambda m: max(m.decompose(), key=lambda q: q.volume())
    return big(top), big(bot)


# ---------------------------------------------------------------- tray (drawer.tray for the P4, split at x = 0)
SEAM_BAR = 5.0                  # louvers stop this far either side of the tray seam (top band)
BRIDGE_X = 18.0                 # bottom band: louvers stop this far either side (bridge plate)
BRIDGE_Z = ZC - 56.0            # panel's bottom-centre insert
HOOK_X = -22.0                  # ribbon hooks: on the left half, clear of the seam
SPINE_HW, SPINE_H, SPINE_T = 62.0, 14.0, 3.0
BRIDGE_HW, BRIDGE_H, BRIDGE_T = 15.0, 14.0, 3.0
NOTCH_D = P3.SO_OD + 0.6        # each tray half's half-hole round the bridge tube


def tray_p4():
    """drawer.tray() with the changes the split needs: no louver slot crosses the seam (a 10 mm bar at the top, a 36 mm
    gap for the bridge plate at the bottom), ribbon hooks moved onto the left half, and a notch for the bridge tube."""
    TRAY_CL, TRAY_WT, YF, Y0, Y1 = DR.TRAY_CL, DR.TRAY_WT, DR.YF, DR.Y0, DR.Y1
    LV_H, LV_PITCH, LV_DEPTH, LV_CH, LV_ROWS = DR.LV_H, DR.LV_PITCH, DR.LV_DEPTH, DR.LV_CH, DR.LV_ROWS
    outer = rr_cs(BORE_HX - TRAY_CL, BORE_HZ - TRAY_CL, BORE_R - TRAY_CL)
    inner = rr_cs(BORE_HX - TRAY_CL - TRAY_WT, BORE_HZ - TRAY_CL - TRAY_WT, BORE_R - TRAY_CL - TRAY_WT)
    t = prism_y(outer, Y0, Y1) + (prism_y(outer, YF, Y0 + 0.01) - prism_y(inner, YF - 1, Y0 + 0.02))
    inner_ov = rr_cs(BORE_HX - TRAY_CL - TRAY_WT + 0.3, BORE_HZ - TRAY_CL - TRAY_WT + 0.3, BORE_R - TRAY_CL - TRAY_WT + 0.3)
    hz = BORE_HZ - TRAY_CL - TRAY_WT
    zin0, zin1 = ZC - hz, ZC + hz
    xin = BORE_HX - TRAY_CL - TRAY_WT

    def rrect_y(x0, x1, z0, z1, r, ya, yb):
        cs = CrossSection.square([x1 - x0 - 2 * r, z1 - z0 - 2 * r], center=True).offset(r, JT, circular_segments=24).translate([(x0 + x1) / 2, (z0 + z1) / 2])
        return prism_y(cs, ya, yb)

    def rrect_z(x0, x1, ya, yb, r, z0, z1):
        cs = CrossSection.square([x1 - x0 - 2 * r, yb - ya - 2 * r], center=True).offset(r, JT, circular_segments=24).translate([(x0 + x1) / 2, (ya + yb) / 2])
        return Manifold.extrude(cs, z1 - z0).translate([0, 0, z0])

    y_in = Y1 - LV_DEPTH
    x_lim = min(abs(x) for x, z in DR.CORNERS) - DR.SO_D / 2 - 2.0

    def band(zb0, zb1):
        pts = [(Y0 + 0.01, zb0), (y_in + LV_CH, zb0), (y_in, zb0 + LV_CH), (y_in, zb1 - LV_CH), (y_in + LV_CH, zb1), (Y0 + 0.01, zb1)]
        cs = CrossSection([pts])
        if cs.area() <= 0:
            cs = CrossSection([pts[::-1]])
        return prism_x(cs, -xin - 0.5, xin + 0.5) ^ prism_y(inner_ov, y_in - 1, Y0 + 1)
    zb_rows = [zin0 + 2.5 + LV_H / 2 + i * LV_PITCH for i in range(LV_ROWS)]
    zt_rows = [zin1 - 2.5 - LV_H / 2 - i * LV_PITCH for i in range(LV_ROWS)][::-1]
    t = t + band(zin0 - 0.5, zb_rows[-1] + LV_H / 2 + LV_DEPTH + 1.5) + band(zt_rows[0] - LV_H / 2 - 1.5, zin1 + 0.5)
    for x in [sx * scx for sx in (-1, 1) for scx in C.SCREW_XS]:                       # bottom screw bosses
        t = t + rrect_z(x - 5, x + 5, C.SCREW_Y - 4.5, Y0 + 0.01, 2.0, zin0 - 0.01, WALL + 12.0)
    for x, z in DR.CORNERS:                                                             # corner posts
        t = t + P3.standoff(x, z, Y0)
    yc = PCB_Y0 + 1.6                                                                   # S3: pad, posts, light and Boot tubes
    hxs = [h[0] for h in DR.S3_HOLES]; hzs = [h[1] for h in DR.S3_HOLES]
    t = t + rrect_y(min(hxs) - 3.7, max(hxs) + 3.7, min(hzs) - 3.7, max(hzs) + 3.7, 3.7, Y0 - 3.0, Y0 + 0.01)
    for hx, hz_ in DR.S3_HOLES:
        t = t + cyl_y(hx, hz_, yc, Y0 + 0.01, P3.S3_POST_D, 32)
    tube_end = yc + 1.5
    t = t + cyl_y(*DR.S3_NEO, tube_end, Y0 + 0.01, 7.0, 48)
    btop = yc + 1.9
    t = t + cyl_y(*DR.S3_BOOT, btop + 1.0, Y0 + 0.01, 5.0, 32)
    import sensor as SN
    zw = H - WALL - TRAY_CL - TRAY_WT
    for x, y in SN.SH:                                                                  # light-sensor pillars
        prof = CrossSection([[(x - 2.5, y - 2.5), (x + 2.5, y - 2.5), (x + 2.5, y), (x, y + 2.5), (x - 2.5, y)]])
        t = t + Manifold.extrude(prof, zw + 0.01 - DR.SEN_TOP).translate([0, 0, DR.SEN_TOP])
    for cx, cz in DR.CLEAT_SCREWS:                                                      # cleat / spine nut bosses
        t = t + cyl_y(cx, cz, Y0 - DR.CB_H, Y0 + 0.01, DR.CB_D, 48)
    # ribbon hooks on the left half, on the ribbon's run from the S3's connector to the panel input
    pi_z = ZC + min(DR.HEADERS, key=lambda h: h[0])[1]
    for side in (-1, 1):
        zi = pi_z + side * (DR.HOOK_RW / 2 + 1.0); zo = zi + side * 3.0
        ya, yb = Y0 - 3.0 - 1.5, Y0 - 3.0
        t = t + box(HOOK_X - 2.5, HOOK_X + 2.5, ya, Y0 + 0.01, min(zi, zo), max(zi, zo))
        tip = zi - side * 4.0
        t = t + Manifold.batch_hull([box(HOOK_X - 2.5, HOOK_X + 2.5, ya, yb, min(zi, zo), max(zi, zo)), box(HOOK_X - 2.5, HOOK_X + 2.5, ya, ya + 0.01, tip - 0.005, tip + 0.005)])
    # tie loop for the power-cable bundle: right half, between the seam and the S3's connector, above the ribbon
    tx0, tx1 = SEAM_BAR + 4.0, DR.S3_EDGE - 63.8 - 1.0
    tx = (tx0 + tx1) / 2
    band_lo = zt_rows[0] - LV_H / 2 - 1.5
    tz = (pi_z + DR.HOOK_RW / 2 + band_lo) / 2
    assert band_lo - (pi_z + DR.HOOK_RW / 2) >= DR.TIE_LEN + 2 * DR.TIE_EXIT and tx1 - tx0 >= DR.TIE_OPEN + 4, 'no room for the tie loop'
    t = t + rrect_z(tx - DR.TIE_OPEN / 2 - 2.0, tx + DR.TIE_OPEN / 2 + 2.0, Y0 - DR.TIE_GAP - DR.TIE_BAR, Y0 + 0.01, 0.9, tz - DR.TIE_LEN / 2, tz + DR.TIE_LEN / 2)
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
        lo, hi = zc - r - 0.5, zc + LV_DEPTH + r + 0.5
        if any(lo < hz_ + P3.S3_POST_D / 2 + 3.7 and hi > hz_ - P3.S3_POST_D / 2 - 3.7 for hz_ in hzs):
            segs = minus(segs, *pad)
        if zc > ZC:
            segs = minus(segs, -SEAM_BAR, SEAM_BAR)
        else:
            segs = minus(segs, -BRIDGE_X, BRIDGE_X)
            for scx in C.SCREW_XS:
                segs = minus(minus(segs, -scx - 6.5, -scx + 6.5), scx - 6.5, scx + 6.5)
        for xa, xb in segs:
            def slab(y, dz, xa=xa, xb=xb, zc=zc):
                cs = CrossSection.square([xb - xa - 2 * r, 0.01], center=True).offset(r, JT, circular_segments=16).translate([(xa + xb) / 2, zc + dz])
                return prism_y(cs, y, y + 0.01)
            sl = Manifold.batch_hull([slab(Y1 + 0.5, -0.5), slab(y_in - 0.5, LV_DEPTH + 0.5)])
            cuts.append(sl ^ box(-HW, HW, Y0 - 20, D + 5, -5, zin1 - 0.6))
    nut_end = C.SCREW_Y + P3.NUT_FLOAT + P3.NUT_CORNER                                  # bottom screw slots + nut pockets
    mouth_end = C.SCREW_Y - P3.NUT_FLOAT - P3.NUT_CORNER
    for x in [sx * scx for sx in (-1, 1) for scx in C.SCREW_XS]:
        yb = C.SCREW_Y - 4.5
        slot = CrossSection.square([0.01, 2 * P3.NUT_FLOAT], center=True).offset(1.75, JT, circular_segments=24).translate([x, C.SCREW_Y])
        cuts.append(Manifold.extrude(slot, 20).translate([0, 0, -1]))
        nz0 = WALL + 4.0
        cuts.append(box(x - DR.BN_W / 2, x + DR.BN_W / 2, mouth_end, nut_end, nz0, nz0 + DR.BN_H))
        cuts.append(box(x - DR.BN_MOUTH / 2, x + DR.BN_MOUTH / 2, yb - 1, mouth_end + 0.01, nz0, nz0 + DR.BN_H))
    for x, z in DR.CORNERS:
        cuts.append(cyl_y(x, ZC + z, P3.FOOT_Y + P3.SO_FLOOR, Y1 + 1, P3.SO_BORE, 48))
        cuts.append(P3.so_cone(x, ZC + z))
    cuts.append(box(tx - DR.TIE_OPEN / 2, tx + DR.TIE_OPEN / 2, Y0 - DR.TIE_GAP, Y0 + 0.02, tz - DR.TIE_LEN, tz + DR.TIE_LEN))
    for cx, cz in DR.CLEAT_SCREWS:
        cuts.append(cyl_y(cx, cz, Y0 - DR.CB_H - 1, Y1 + 1, 3.4, 24))
        cuts.append(cyl_y(cx, cz, Y0 - DR.CB_H - 1, Y0, DR.CB_NUT / math.cos(math.pi / 6), 6))
    nx, nz = DR.S3_NEO
    cuts.append(cyl_y(nx, nz, tube_end - 1, Y1 - DR.WIN_T + 0.01, 4.5, 48))
    cuts.append(cyl_y(nx, nz, Y1 - DR.WIN_T, Y1 + 1, DR.WIN_D, 48))
    for hx, hz_ in DR.S3_HOLES:
        cuts.append(cyl_y(hx, hz_, yc - 1, yc + 8.0, P3.S3_PILOT, 24))
        cuts.append(Manifold.cylinder(P3.S3_LEAD + 0.01, P3.S3_PILOT / 2 + P3.S3_LEAD, P3.S3_PILOT / 2, 24).rotate([-90, 0, 0]).translate([hx, yc - 0.01, hz_]))
    bx, bz = DR.S3_BOOT
    cuts.append(cyl_y(bx, bz, btop + 0.5, Y1 + 1, 2.6, 24))
    fd = (DR.BOOT_FUNNEL_D - 2.6) / 2
    cuts.append(Manifold.cylinder(fd + 0.01, 1.3, DR.BOOT_FUNNEL_D / 2 + 0.01, 48).rotate([-90, 0, 0]).translate([bx, Y1 - fd, bz]))
    for dz in (-1.5, 1.5):
        cuts.append(cyl_y(bx + DR.BOOT_FUNNEL_D / 2 + 2.2, bz + dz, Y1 - DR.BOOT_DOT_DEPTH, Y1 + 1, DR.BOOT_DOT_D, 24))
    ztw = H - WALL - TRAY_CL - TRAY_WT - 1.0                                            # top wall: encoder slot, light hole
    cuts.append(box(-DR.ENC_SLOT, DR.ENC_SLOT, YF - 1, KY + DR.ENC_HALF + 1.5, ztw, H))
    cuts.append(cyl_z(SN.SX, SN.SY, ztw, H, DR.SEN_HOLE, 32))
    for x, y in SN.SH:
        cuts.append(cyl_z(x, y, DR.SEN_TOP - 1, DR.SEN_TOP + DR.SEN_GAP + 1.6, 2.4, 24))
    (_, sy0), (_, sy1) = SN.sb(0, 11.8), SN.sb(0, 6)
    for (bx0, bx1), out in (((0.5, 4.8), -1), ((20.6, 24.9), 1)):
        xa, xb = SN.sb(bx0, 0)[0], SN.sb(bx1, 0)[0]
        xa, xb = (xa - DR.SEN_PLUG, xb + 0.5) if out < 0 else (xa - 0.5, xb + DR.SEN_PLUG)
        cuts.append(box(xa, xb, sy0 - 0.5, sy1 + 0.5, zw - 1, zw + DR.SEN_POCKET))
    cuts.append(box(xin - 1, BORE_HX + 1, YF - 1, C.PORT_Y + 5.0, DR.PORT_Z - 7.5, DR.BTN_Z1 + 1.0))  # USB-C + buttons window
    cuts.append(cyl_y(0, BRIDGE_Z, Y0 - 10, Y1 + 1, NOTCH_D, 48))                       # bridge tube notch (half in each half)
    t = t - Manifold.batch_boolean(cuts, ADD)
    t = t + DR.crush_ribs()
    return max(t.decompose(), key=lambda m: m.volume())


def split_tray(t):
    left = t ^ box(-HW, 0, -10, D + 10, -10, H + 10)
    right = t ^ box(0, HW, -10, D + 10, -10, H + 10)
    return max(left.decompose(), key=lambda m: m.volume()), max(right.decompose(), key=lambda m: m.volume())


def spine():
    """bar across the tray seam on the back face, on the cleat's two nuts (the case cleat replaces it on a wall)"""
    zc = DR.CLEAT_SCREWS[0][1]
    cs = CrossSection.square([2 * SPINE_HW - 6, SPINE_H - 6], center=True).offset(3, JT, circular_segments=24).translate([0, zc])
    s = prism_y(cs, DR.Y1, DR.Y1 + SPINE_T)
    for cx, cz in DR.CLEAT_SCREWS:
        s = s - cyl_y(cx, cz, DR.Y1 - 1, DR.Y1 + SPINE_T + 1, 3.4, 24)
    return s


def bridge():
    """plate across the tray seam at the bottom + funnel tube to the panel's bottom-centre insert (M3 x 8 countersunk)"""
    cs = CrossSection.square([2 * BRIDGE_HW - 6, BRIDGE_H - 6], center=True).offset(3, JT, circular_segments=24).translate([0, BRIDGE_Z])
    b = prism_y(cs, DR.Y1, DR.Y1 + BRIDGE_T)
    b = b + cyl_y(0, BRIDGE_Z, P3.FOOT_Y, DR.Y1 + 0.01, P3.SO_OD, 48)
    b = b - cyl_y(0, BRIDGE_Z, P3.FOOT_Y + P3.SO_FLOOR, DR.Y1 + BRIDGE_T + 1, P3.SO_BORE, 48)
    b = b - cyl_y(0, BRIDGE_Z, P3.FOOT_Y - 1, P3.FOOT_Y + P3.SO_FLOOR + 0.1, P3.SO_HOLE, 32)
    b = b - P3.so_cone(0, BRIDGE_Z)
    return b


# ---------------------------------------------------------------- diffuser halves
CENTRE_RIB = 1.2                 # 0.6 each side of the split


def diffuser_halves():
    """DF.diffuser() (8 mm flange = bezel) split at x = 0. Returns {(side, part): manifold} in DF's frame
    (z = 0 is the face, +z toward the LEDs; y up the panel). part: 'white' (first layer over the pixels) or 'black'."""
    d = DF.diffuser(skin=DF.SKIN)
    hy = DF.PH / 2
    d = d + box(-CENTRE_RIB / 2, CENTRE_RIB / 2, -hy + 0.29, hy - 0.29, DF.SKIN - 0.01, DF.SKIN + DF.GRID_H)
    hx = DF.PW / 2
    white_zone = box(-hx, hx, -hy, hy, -1, DF.SKIN)
    out = {}
    for side, xs in (('left', (-200, 0)), ('right', (0, 200))):
        half = d ^ box(xs[0], xs[1], -200, 200, -5, 20)
        out[(side, 'white')] = half ^ white_zone
        out[(side, 'black')] = half - white_zone
    return out


def diffuser_in_case(m):
    """DF frame -> case frame: face at Y_FACE, panel turned 180 deg (symmetric part, bumps follow)"""
    return m.transform([[1, 0, 0, 0], [0, 0, 1, Y_FACE], [0, -1, 0, ZC]])        # x stays, DF's +y (panel up) -> case down


# ---------------------------------------------------------------- envelopes for fit checks (not printed)
def panel_p4():
    """P4 panel in the case, turned 180 deg: LED board (2.5 mm incl. LEDs) + 12 mm housing (rim, ribs, insert bosses),
    the two HUB75 shrouds (top 1 mm under the housing back, ASSUMED), VH4 power header, a ribbon plug on data in"""
    yf, yb = Y_FACE + DF.SKIN + DF.GRID_H, PANEL_BACK
    pw, ph = panel.P['w'], panel.P['h']
    parts = [box(-pw / 2, pw / 2, yf, yf + 2.5, ZC - ph / 2, ZC + ph / 2)]
    hous = box(-pw / 2 + 0.15, pw / 2 - 0.15, yf + 2.5 - 0.01, yb, ZC - ph / 2 + 0.15, ZC + ph / 2 - 0.15)
    hous = hous - box(-pw / 2 + 6, pw / 2 - 6, yf, yb + 1, ZC - ph / 2 + 6, ZC + ph / 2 - 6)
    for x in (-64.0, 0.0, 64.0):
        hous = hous + box(x - 4.5, x + 4.5, yf + 2.5, yb, ZC - ph / 2, ZC + ph / 2)
    for x, z in panel.P['inserts']:
        hous = hous + cyl_y(-x, ZC - z, yf + 2.5, yb, 8.5, 32)
    parts.append(hous)
    for x, z in DR.HEADERS:                                                  # shrouds (turned): top 1 mm under the back
        parts.append(box(x - 4.45, x + 4.45, yf + 2.5, yb - 1.0, ZC + z - 10.15, ZC + z + 10.15))
    pi = min(DR.HEADERS, key=lambda h: h[0])                                 # data in (left): ribbon plug, 9 mm proud
    parts.append(box(pi[0] - 6.5, pi[0] + 6.5, yb - 1.0, yb + 8.0, ZC + pi[1] - 17.0, ZC + pi[1] + 17.0))
    parts.append(box(21.7 - 9, 21.7 + 9, yf + 2.5, yf + 2.5 + 7.5, ZC - 7.3 - 3.5, ZC - 7.3 + 3.5))   # VH4 (turned)
    return Manifold.batch_boolean(parts, ADD)


def encoder_envelope():
    """5880 encoder as sensor.py places it: body clamped up against the collar deck, board, QT sockets below"""
    import sensor as SN
    eb_top, eb_bot = SN.EB_TOP, SN.EB_BOT
    board = box(-12.7, 12.7, KY - 12.7, KY + 12.7, eb_bot, eb_top)
    body = Manifold.cube([12.0, 12.0, H - 1.4 - eb_top], True).rotate([0, 0, 45]).translate([0, KY, (H - 1.4 + eb_top) / 2])
    bush = cyl_z(0, KY, H - 1.4, H + 6.0, 7.0)
    socks = box(-12.7, -8.5, KY - 3.0, KY + 3.0, eb_bot - 2.96, eb_bot) + box(8.5, 12.7, KY - 3.0, KY + 3.0, eb_bot - 2.96, eb_bot)
    plugs = box(-12.7 - 6, -8.5, KY - 3.0, KY + 3.0, eb_bot - 2.96, eb_bot) + box(8.5, 12.7 + 6, KY - 3.0, KY + 3.0, eb_bot - 2.96, eb_bot)
    return board + body + bush + socks + plugs


def collar_knob():
    import collar as CO, knob as KN
    CO.TIP_BACK = False
    c = CO.collar().translate([0, KY, H])
    return c


# ---------------------------------------------------------------- coupons
def seam_coupon(top, bot):
    """the right end of both shell halves, 30 mm wide and the front 34 mm deep: test the lap's fit, the glue and how the
    reveal reads after finishing"""
    reg = box(HW - 30, HW + 1, -50, 34, ZS - 30, ZS + 30)
    return top ^ reg, bot ^ reg


def diffuser_joint_coupon(halves):
    """a 40 mm wide strip across the diffuser's centre joint, bottom edge included (skirt, bezel): print both halves and
    hold them on the panel to see the joint lit and dark"""
    hy = DF.PH / 2
    reg = box(-20, 20, -hy - 20, -hy + 30, -5, 20)
    return {k: v ^ reg for k, v in halves.items()}


# ---------------------------------------------------------------- export
def to_tm(m):
    import trimesh
    me = m.to_mesh()
    return trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)


def bed_fit(m, drop_axis):
    """smallest square the part fits in when printed with drop_axis vertical, and the rotation that achieves it"""
    v = m.to_mesh().vert_properties[:, :3]
    p2 = v[:, [i for i in range(3) if i != drop_axis]]
    ext = np.ptp(p2, axis=0)
    if max(ext) <= BED:
        return round(float(max(ext)), 1), 0.0
    best = None
    for deg in np.arange(0, 90.25, 0.25):
        t = math.radians(deg)
        R = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
        q = p2 @ R.T
        side = max(np.ptp(q[:, 0]), np.ptp(q[:, 1]))
        if best is None or side < best[0]:
            best = (side, deg)
    return round(float(best[0]), 1), float(best[1])


def build():
    sh = V.shell2()
    top, bot = split_shell(sh)
    tr = tray_p4()
    tl, trr = split_tray(tr)
    return dict(shell=sh, top=top, bot=bot, tray=tr, tray_left=tl, tray_right=trr, spine=spine(), bridge=bridge(),
                diffuser=diffuser_halves())


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    P = build()
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])      # y = D on the bed (back down)
    spin45 = trimesh.transformations.rotation_matrix(math.pi / 4, [0, 0, 1])
    report = {}

    def put(m, name, mat=None, diag=False, drop_axis=1):
        t = to_tm(m)
        if mat is not None:
            t.apply_transform(mat)
        if diag:
            t.apply_transform(spin45)                         # pre-rotated 45 deg: drops onto the X2D's bed diagonally
        t.apply_translation([-(t.bounds[0][0] + t.bounds[1][0]) / 2, -(t.bounds[0][1] + t.bounds[1][1]) / 2, -t.bounds[0][2]])
        t.export(f'{out}/{name}')
        sq = bed_fit(m, drop_axis)
        report[name] = dict(watertight=bool(t.is_watertight), extents=np.round(t.extents, 1).tolist(), square=sq[0],
                            spare_a_side=round((BED - sq[0]) / 2, 1), volume_cm3=round(t.volume / 1000, 1))
    put(P['top'], 'p4-shell-top-walnut-backdown.stl', down, diag=True)
    put(P['bot'], 'p4-shell-bottom-walnut-backdown.stl', down, diag=True)
    put(P['tray_left'], 'p4-tray-left.stl', down)
    put(P['tray_right'], 'p4-tray-right.stl', down)
    put(P['spine'], 'p4-spine.stl', down)
    put(P['bridge'], 'p4-bridge.stl', down)
    for (side, part), m in P['diffuser'].items():               # face down, z = 0 is the face: as exported
        put(m, f'p4-diffuser-{side}-{part}.stl', None, drop_axis=2)
    # coupons
    ct, cb = seam_coupon(P['top'], P['bot'])
    put(ct, 'coupon-p4-seam-top.stl', down); put(cb, 'coupon-p4-seam-bottom.stl', down)
    for (side, part), m in diffuser_joint_coupon(P['diffuser']).items():
        put(m, f'coupon-p4-diffuser-joint-{side}-{part}.stl', None, drop_axis=2)
    cs, ctr = DR.fit_coupon(P['shell'], P['tray'])
    put(cs, 'coupon-p4-drawer-fit-shell.stl', down); put(ctr, 'coupon-p4-drawer-fit-tray.stl', down)
    import json
    for k, v in report.items():
        print(k, v)
    summary = dict(W=round(2 * HW, 1), H=round(H, 1), D=D, ZS_above_centre=round(ZS - ZC, 2), lap=LAP, bore=(BORE_HX, BORE_HZ),
                   S3_edge=round(DR.S3_EDGE, 2), port_z=round(DR.PORT_Z - ZC, 2), corners=DR.CORNERS, bridge_z=round(BRIDGE_Z - ZC, 1),
                   spine_z=round(DR.CLEAT_SCREWS[0][1] - ZC, 1))
    print(summary)
    json.dump(dict(parts=report, summary=summary), open(f'{out}/p4-report.json', 'w'), indent=1)
