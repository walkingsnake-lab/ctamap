"""P5 bar sleeve, FIRST PASS (Nov 14): the P4's drawer case round a Waveshare RGB-Matrix-P5-64x32 (320 x 160), in parts
that fit the X2D's 256 mm bed. Nothing here is printed and the panel is not in hand: its inserts, headers and outline
are from Waveshare's photos (panel.py, 'p5'). It builds on p4.py (tray, diffuser, spine, bridge, collar, knob) with the
'p5' profile; what is different is below.

Shell (walnut PLA, 4.5 mm wall, ~347 x 187 x 78.5: the 3 mm diffuser grid, panel.py 'grid_h', makes it 1.5 deeper): too long for the P4's top / bottom halves (a 347 x 93 half needs a
310 mm bed even at 45 deg), so it is split left / right at x = 0 like the two-panel bars (p3x2.py), each half ~173 x 187
flat on its own plate, back-down, no 45 deg turn. The joint is the pairs': a V-groove outside (CHAMF), hollowed end
faces (HOLLOW / LAND) and a glued PLA plate in a rebate inside the top wall and one inside the bottom wall (JP_L long,
half in each shell half). The screws from below are at x +/-62 (SCREW_X), outside the bottom plate, so both plates run
the whole depth.
- Seam screws (provision, SEAM_SCREWS=1 cuts the holes): one M3 x 10 button head from above into each tray half, SS_X
  either side of the seam at the knob's depth (KY), through the top plate, into a pilot in a boss under the tray's top
  wall. The bosses and the plate's holes are always there; the shell prints without the holes, and they are drilled
  (3.4 mm, at the dimples inside the top wall) only if the glued plate alone does not hold the top wall's free ends.
- Knob on the right end wall, its axis KNOB_DROP below the case top at the top knob's depth (KY: the encoder's board
  stands behind the panel). The collar's flange stays on the flat of the end wall, below the corner's round. The S3 and
  its USB-C opening sit lower on the same wall (panel.py: drawer_s3_mid). No knob hole in the top wall
  (case2.KNOB_TOP); the light sensor stays under the top wall (drawer.tray(encoder=False)).
Tray (black PETG): the P4's, cut at x = 0. The single panel is bolted to both halves and the spine / case cleat and the
bridge tie them, so the tray braces the shell's joint although both seams are at x = 0. On its right end wall, for the
encoder: a slot open to the front edge past the encoder's body, a recess over the board along its way in, and two
rails beside the board's edges (the top wall's, drawer.enc_rails, turned onto the end wall).
Diffuser: the P4's two halves (p4.diffuser_halves) on the 5 mm pitch. Knob: the P4's 35 mm knob, the same file
(stl/p4/p4-knob.stl). Collar: the P4's 41 mm flange with a plug for the 4.5 mm wall and no screw holes.
Wall cleat: WALL_CLEAT_HW long with a stop either side of the case cleat, so a press on the knob can't slide the case
along the wall.
Run: python3 p5.py <outdir>   -> STLs (print orientation), coupons, and fit numbers
"""
import math, os, sys
os.environ['PANEL'] = os.environ['P4_PANEL'] = 'p5'   # P4_PANEL: p4.py, which this builds on, loads this profile too
os.environ.setdefault('CASE_WALL', '4.5')
os.environ.setdefault('P4_PANEL_T', '14.8')      # as the profile: nothing measured yet
os.environ.setdefault('P4_HOUSE_H', '160.0')     # housing height: not measured (the P4's 128 measured 127.8)
os.environ['TOP_SCREWS'] = '0'                   # the P4's screws under its top knob
import numpy as np
from manifold3d import Manifold, CrossSection
import panel
import case as C
import case2 as V
import plate3 as P3
import drawer as DR
import diffuser as DF
import p4 as P4
from case import box, rr_cs, prism_y, prism_x, cyl_y, cyl_z, ZC, H, D, WALL, HW, RC, BORE_HX, BORE_HZ, BORE_R, JT, ADD, SEG, \
    PANEL_BACK, PCB_Y0, Y_FACE, KY

BED = 256.0
V.KNOB_TOP = False
SCREW_X = 62.0                   # screws from below (x +/-): outside the bottom joint plate, clear of the tray's crush ribs (+/-47)
for _m in (C, V, P3):
    _m.SCREW_XS = (SCREW_X,)
# top crush ribs: the one at 0.3 * (ox - r) = +47 would cross the sensor sled's screw counterbore (x 48) and sit beside
# the light hole (x 55); one extra rib between the seam boss and the sensor keeps the right half of the top wall braced
DR.CR_TOP_SKIP = ((DR.SLED_SCREW[0] - DR.SLED_CB_D / 2 - 1.5, V.SENSOR_X + DR.SEN_HOLE / 2 + 1.5),)
DR.CR_TOP_EXTRA = (30.0,)
P4.BRIDGE_Z = ZC - 71.0          # the panel's bottom-centre insert (panel.py)
P4.HOOK_X, P4.HOOK2_X = -12.0, 45.0
HOOK0_X = -62.0                  # a third ribbon hook pair on the left half: the run from the panel input is ~220 mm
P4.WALL_CLEAT_HW = 120.0         # 240 mm: flat along the bed with 8 mm a side
P4.WALL_CLEAT_XS = (-105.0, 0.0, 105.0)

# ---------------------------------------------------------------- shell joint (p3x2.py's, at this case's size)
CHAMF, V_STEPS = P4.CHAMF, P4.V_STEPS
HOLLOW, LAND = P4.HOLLOW, P4.LAND
JP_T, JP_CL = P4.JP_T, P4.JP_CL
JP_L = 100.0                     # plate length along the case (50 into each half)
JP_Y0, JP_Y1 = Y_FACE + 2.0, DR.Y1 - 2.0         # behind the rim's seat, in front of the back rim
JP_CL_Y = 0.15                   # rebate longer than the plate at each end
JP_EC = 0.4
assert WALL - JP_T - JP_CL >= 3.0, WALL          # wall left behind the rebate (3.2)
assert SCREW_X - 3.2 - 4.2 >= JP_L / 2 + 2.0     # the screws' counterbores (r 3.2, +/-4.2 with the stadium) stay off the bottom rebate

# seam screws
SEAM_SCREWS = os.environ.get('SEAM_SCREWS', '0') not in ('0', '', 'no', 'false')
SS_X = 15.0                      # x +/-, one into each tray half
SS_BOSS_HX, SS_BOSS_HY, SS_BOSS_H = 5.0, 5.0, 5.0    # boss under the tray's top wall
SS_PAD = 0.1                     # pad on the tray's top under the screw: it stops 0.05 under the top plate's face (the plate is
                                 # JP_CL below the bore, the tray TRAY_CL), so the screw pulls the tray up that much and no more
SS_PLATE_HOLE = 3.6              # the top plate's holes
SS_DIMPLE = 1.2                  # drill marks inside the top wall (cone depth), under the plate

# knob on the right end wall
KNOB_DROP = 40.0                 # axis below the case top
KZ = H - KNOB_DROP
ENC_DROP = 1.4 + 6.3             # the board's encoder face inside the wall's outer face (collar deck + body), as sensor.py
EB_X1 = HW - ENC_DROP            # the board's face toward the wall
EB_X0 = EB_X1 - 1.57
ENC_REC = 0.6                    # recess in the tray's end wall over the board, along its whole way in (1.9 mm of wall left)
assert KZ + 17.5 * P4.KNOB_SCALE + 1.0 <= H - RC, 'the collar flange runs onto the corner round'
assert SS_PAD <= DR.TRAY_CL - JP_CL - 0.04, 'the seam screws\' pads reach the top plate'


def v_groove(sh):
    """the CHAMF x 45 deg chamfer on both halves' visible edges at x = 0, as V_STEPS stepped bands (p3x2.v_groove).
    Each band laps the next by 0.002: butted exactly, two steps met along a bare edge at the bottom front chamfer and
    at the rim's peak on half B (an edge shared by four faces: not watertight once the STL rounds to float32)."""
    cuts = []
    for k in range(V_STEPS):
        x0, x1 = CHAMF * k / V_STEPS, CHAMF * (k + 1) / V_STEPS
        dk = CHAMF - (x0 + x1) / 2
        band = box(-x1 - 0.002, x1 + 0.002, -50, D + 1, -1, H + 1)
        if k:
            band = band - box(-x0, x0, -51, D + 2, -2, H + 2)
        cuts.append((sh ^ band) - P4.deep(dk))
    return Manifold.batch_boolean(cuts, ADD)


def hollow_cuts(sh):
    """the seam faces' relief: HOLLOW off each half's face at x = 0, wherever the wall is more than LAND from a visible face"""
    return (sh ^ box(-HOLLOW, HOLLOW, -50, D + 1, -1, H + 1)) ^ P4.deep(LAND)


def rebate_cuts():
    """the joint plates' rebates in the bore faces of the top and bottom walls: JP_L long about x = 0, JP_T + JP_CL deep.
    Printed back-down each is a pocket in a vertical face whose front end is its roof: that end slopes 45 deg."""
    d = JP_T + JP_CL
    y0, y1 = JP_Y0 - JP_CL_Y, JP_Y1 + JP_CL_Y
    zt, zb = H - WALL, WALL
    out = []
    for za, zb_, top in ((zt - 0.01, zt + d, True), (zb - d, zb + 0.01, False)):
        full = box(-JP_L / 2, JP_L / 2, y0, y1, za, zb_)
        mouth = box(-JP_L / 2, JP_L / 2, y0 - d, y1, za, za + 0.01) if top else box(-JP_L / 2, JP_L / 2, y0 - d, y1, zb_ - 0.01, zb_)
        out.append(Manifold.batch_hull([full, mouth]))
    return out


def seam_screw_xy():
    return [(-SS_X, KY), (SS_X, KY)]


def seam_dimples():
    """drill marks on the rebate's floor, inside the top wall: a small cone at each seam screw (under the glued plate,
    so they are drilled before the glue-up, or from outside by measurement: SS_X from the seam, KY from the top front edge)"""
    zf = H - WALL + JP_T + JP_CL
    return Manifold.batch_boolean([Manifold.cylinder(SS_DIMPLE, SS_DIMPLE, 0.01, 24).translate([x, y, zf - 0.01]) for x, y in seam_screw_xy()], ADD)


def seam_screw_cuts():
    """SEAM_SCREWS: clearance stadiums through the top wall, +/-DR.SCREW_FLOAT along y as the screws from below"""
    r, f = 1.7, DR.SCREW_FLOAT
    cuts = []
    for x, y in seam_screw_xy():
        cs = (V.teardrop_cs(r, x, y - f, trunc=r + 0.25, seg=32) + V.teardrop_cs(r, x, y + f, trunc=r + 0.25, seg=32)).hull()
        cuts.append(Manifold.extrude(cs, WALL + 2).translate([0, 0, H - WALL - 1]))
    return Manifold.batch_boolean(cuts, ADD)


def knob_hole():
    """the collar's hole in the right end wall: the top wall's 24 mm teardrop, its point toward the front (the print's
    up, back-down)"""
    r = C.ENC_HOLE / 2
    a, tip = r * math.cos(math.pi / 4), r * math.sqrt(2)
    tri = CrossSection([[(-a, a), (-tip, 0.0), (-a, -a)]])
    if tri.area() <= 0:
        tri = CrossSection([[(-a, -a), (-tip, 0.0), (-a, a)]])
    cs = (CrossSection.circle(r, SEG) + tri).translate([KY, KZ])
    return prism_x(cs, HW - WALL - 1, HW + 1)


def split_shell(sh):
    """left (A) and right (B) halves: the V-groove, the hollowed faces and the plates' rebates cut, then the shell cut
    at x = 0 (p3x2.split_shell)"""
    s = sh - v_groove(sh) - hollow_cuts(sh) - Manifold.batch_boolean(rebate_cuts(), ADD) - seam_dimples()
    out = []
    for m in (s ^ box(-HW - 1, 0.0, -50, D + 1, -1, H + 1), s ^ box(0.0, HW + 1, -50, D + 1, -1, H + 1)):
        parts = sorted(m.decompose(), key=lambda q: -q.volume())
        assert all(q.volume() < 0.01 for q in parts[1:]), [q.volume() for q in parts[1:]]
        out.append(parts[0])
    return tuple(out)


def joint_plate(top=True):
    """one joint plate in the case frame, in its rebate, its face JP_CL below the bore; JP_EC chamfers on the four edges
    of its bore-side face. The top plate has the seam screws' holes."""
    zt, zb = H - WALL, WALL
    if top:
        z0, z1 = zt + JP_CL, zt + JP_CL + JP_T              # bore side at z0
        full = box(-JP_L / 2, JP_L / 2, JP_Y0, JP_Y1, z0 + JP_EC, z1)
    else:
        z0, z1 = zb - JP_CL - JP_T, zb - JP_CL              # bore side at z1
        full = box(-JP_L / 2, JP_L / 2, JP_Y0, JP_Y1, z0, z1 - JP_EC)
    m = Manifold.batch_hull([full, box(-JP_L / 2 + JP_EC, JP_L / 2 - JP_EC, JP_Y0 + JP_EC, JP_Y1 - JP_EC, z0, z1)])
    if top:
        m = m - Manifold.batch_boolean([cyl_z(x, y, z0 - 1, z1 + 1, SS_PLATE_HOLE, 32) for x, y in seam_screw_xy()], ADD)
    return m


def plate_flat(top=True):
    """a plate as it prints: its glued face on the bed"""
    m = joint_plate(top)
    return m.mirror([0, 0, 1]) if top else m             # top plate: glued face is its upper one


# ---------------------------------------------------------------- underside: the two label recesses, on half B
LABELS = os.environ.get('LABELS', '1') not in ('0', '', 'no', 'false')
LABEL_CX = 80.0                  # x 22-138: off the seam, short of the front foot (x 147). Its first 28 mm lie over the bottom
                                 # plate's rebate (2.7 mm of wall between them there, backed by the glued plate)


def label_cuts():
    import marks as MK
    MK.CX, MK.REC_Y0 = LABEL_CX, V.front_y(0) + P4.LABEL_FRONT
    items = MK.layout()[0]
    bad = MK.check(items)
    assert not bad, bad
    return MK.cuts()


# ---------------------------------------------------------------- tray
def enc_rails_end():
    """two rails on the tray's right end wall beside the encoder board's upper and lower edges, from the recess floor in
    to RAIL_LAP past the board's wall-side face (0.8 over its other face, clear of the QT plugs leaving under it), from
    1 mm behind the board's front edge back into the tray's back. Front ends cut back 45 deg on the board's side."""
    xw = BORE_HX - DR.TRAY_CL - DR.TRAY_WT                       # end wall's inner face
    by0 = KY - 12.7
    out = []
    for s in (-1, 1):
        za, zb = KZ + s * (12.7 + DR.RAIL_CL), KZ + s * (12.7 + DR.RAIL_CL + DR.RAIL_W)
        r = box(EB_X1 - DR.RAIL_LAP, xw + ENC_REC + 0.01, by0 + 1.0, DR.Y0 + 0.01, min(za, zb), max(za, zb))
        y0 = by0 + 1.0
        pts = [(y0 - 0.1, za - s * 0.2), (y0 - 0.1, za + s * 1.0), (y0 + 1.2, za - s * 0.2)]
        tri = CrossSection([pts]) if CrossSection([pts]).area() > 0 else CrossSection([pts[::-1]])
        out.append(r - prism_x(tri, EB_X0 - 2, xw + ENC_REC + 1))
    return Manifold.batch_boolean(out, ADD)


def enc_wall_cuts():
    """the right end wall's slot past the encoder's body (open to the front edge) and the recess over its board"""
    xw = BORE_HX - DR.TRAY_CL - DR.TRAY_WT
    slot = box(xw - 1, BORE_HX + 1, DR.YF - 1, KY + DR.ENC_HALF + 1.5, KZ - DR.ENC_SLOT, KZ + DR.ENC_SLOT)
    hz = 12.7 + DR.RAIL_CL + DR.RAIL_W
    rec = box(xw - 0.01, xw + ENC_REC, DR.YF - 1, KY + 12.7 + 1.0, KZ - hz, KZ + hz)
    return [slot, rec]


def seam_bosses():
    """(adds, cuts) for the tray: per seam screw a boss under the top wall, its back end sloped 45 deg (no flat overhang
    back-down), a pad on the wall's outer face and a blind pilot (drawer.TAP_D, as the screws from below)"""
    zw = DR._zw()
    zo = zw + DR.TRAY_WT
    adds, cuts = [], []
    for x, y in seam_screw_xy():
        x0, x1 = x - SS_BOSS_HX, x + SS_BOSS_HX
        boss = box(x0, x1, y - SS_BOSS_HY, y + SS_BOSS_HY, zw - SS_BOSS_H, zw + 0.01)
        gus = (box(x0, x1, y + SS_BOSS_HY - 0.01, y + SS_BOSS_HY, zw - SS_BOSS_H, zw + 0.01)
               + box(x0, x1, y + SS_BOSS_HY, y + SS_BOSS_HY + SS_BOSS_H, zw, zw + 0.01)).hull()
        pad = (box(x - 3.5, x + 3.5, y - 6.0, y + 6.0, zo - 0.3, zo) + box(x - 3.5, x + 3.5, y - 4.5, y + 4.5, zo, zo + SS_PAD)).hull()
        adds += [boss, gus, pad]
        cuts.append(cyl_z(x, y, zw - SS_BOSS_H + 0.8, zo + SS_PAD + 1, DR.TAP_D, 24))
        cuts.append(Manifold.cylinder(DR.TAP_LEAD + 0.01, DR.TAP_D / 2, DR.TAP_D / 2 + DR.TAP_LEAD + 0.01, 24)
                    .translate([x, y, zo + SS_PAD - DR.TAP_LEAD]))
    return Manifold.batch_boolean(adds, ADD), Manifold.batch_boolean(cuts, ADD)


def tray_p5():
    """drawer.tray() as p4.tray_p4() builds it (no louver across the seam, the bridge's notch, the ribbon folded between
    hook pairs at two heights), with no encoder in the top wall; then the end wall's slot, recess and rails, and the
    seam screws' bosses"""
    notch = cyl_y(0, P4.BRIDGE_Z, DR.Y0 - 10, DR.Y1 + 1, P4.NOTCH_D, 48)
    t = DR.tray(top_bar=P4.SEAM_BAR, bottom_gap=P4.BRIDGE_X,
                ribbon_hooks=[(HOOK0_X, P4.RIB_Z), (P4.HOOK_X, P4.RIB_Z), (P4.HOOK2_X, P4.IDC_Z)],
                hook_lip=P4.RIB_HOOK_LIP, tie_x0=P4.SEAM_BAR + 4.0, extra_cuts=[notch] + enc_wall_cuts(), encoder=False)
    adds, cuts = seam_bosses()
    t = (t + enc_rails_end() + adds) - cuts
    return max(t.decompose(), key=lambda m: m.volume())


# ---------------------------------------------------------------- knob, collar, cleat
def collar_in_case():
    """the collar in the right end wall (collar frame: z out of the wall, y toward the back)"""
    return P4.collar_p4().rotate([0, 90, 0]).translate([HW, KY, KZ])


def knob_in_case():
    return P4.knob_p4().rotate([0, 90, 0]).translate([HW, KY, KZ])


def encoder_envelope():
    """5880 encoder on the end wall (p4.encoder_envelope turned): board, body, bushing, the two QT sockets on the
    board's upper and lower edges, and a plug in each"""
    board = box(EB_X0, EB_X1, KY - 12.7, KY + 12.7, KZ - 12.7, KZ + 12.7)
    body = Manifold.cube([HW - 1.4 - EB_X1, 12.0, 12.0], True).rotate([45, 0, 0]).translate([(HW - 1.4 + EB_X1) / 2, KY, KZ])
    bush = Manifold.cylinder(7.4, 3.5, 3.5, 32).rotate([0, 90, 0]).translate([HW - 1.4, KY, KZ])
    socks = [box(EB_X0 - 2.96, EB_X0, KY - 3.0, KY + 3.0, KZ + s * 8.5 if s > 0 else KZ - 12.7, KZ + 12.7 if s > 0 else KZ - 8.5) for s in (-1, 1)]
    plugs = [box(EB_X0 - 2.96, EB_X0, KY - 3.0, KY + 3.0, KZ + 8.5 if s > 0 else KZ - 12.7 - 6, KZ + 12.7 + 6 if s > 0 else KZ - 8.5) for s in (-1, 1)]
    return Manifold.batch_boolean([board, body, bush] + socks + plugs, ADD)


CLEAT_STOP_GAP, CLEAT_STOP_W = 0.6, 8.0


def wall_cleat_p5():
    """the wall cleat, WALL_CLEAT_HW long, with a stop either side of the case cleat (CLEAT_STOP_GAP clear of its ends,
    0.6 behind the tray's back): a press on the end-wall knob pushes the case along the wall, and the stops take it"""
    import cleat as CLT
    c = P4.wall_cleat_p4()
    hw = DR.CLEAT_HW + CLEAT_STOP_GAP
    for s in (-1, 1):
        xa, xb = sorted((s * hw, s * (hw + CLEAT_STOP_W)))
        c = c + box(xa, xb, DR.Y1 + 0.6, CLT.YW, CLT.ZB - CLT.T + 0.01, CLT.ZB + 6.0)
    return c


def panel_p5():
    """the panel in the case, turned 180 deg (fit checks): LED board, housing rim, insert bosses, the two HUB75 shrouds
    with a ribbon plug on data in, the power header. All from the photos."""
    yf, yb = Y_FACE + DF.SKIN + DF.GRID_H, PANEL_BACK
    pw, ph = panel.P['w'], panel.P['h']
    parts = [box(-pw / 2, pw / 2, yf, yf + 2.5, ZC - ph / 2, ZC + ph / 2)]
    hous = box(-pw / 2, pw / 2, yf + 2.5 - 0.01, yb, ZC - ph / 2, ZC + ph / 2)
    hous = hous - box(-pw / 2 + 6, pw / 2 - 6, yf, yb + 1, ZC - ph / 2 + 6, ZC + ph / 2 - 6)
    hous = hous + box(-6.0, 6.0, yf + 2.5, yb, ZC - ph / 2, ZC + ph / 2)        # the centre web
    for x, z in panel.P['inserts']:
        hous = hous + cyl_y(-x, ZC - z, yf + 2.5, yb, 8.5, 32)
    parts.append(hous)
    for x, z in DR.HEADERS:
        parts.append(box(x - 4.45, x + 4.45, yf + 2.5, yb - 1.0, ZC + z - 10.15, ZC + z + 10.15))
    pi = min(DR.HEADERS, key=lambda h: h[0])
    parts.append(box(pi[0] - 6.5, pi[0] + 6.5, yb - 1.0, yb + 8.0, ZC + pi[1] - 17.0, ZC + pi[1] + 17.0))
    parts.append(box(32.0 - 9, 32.0 + 9, yf + 2.5, yf + 2.5 + 7.5, ZC - 13.0 - 3.5, ZC - 13.0 + 3.5))   # VH4 (turned)
    return Manifold.batch_boolean(parts, ADD)


def seam_coupon(a, b):
    """both halves' top wall across the joint, 60 wide, from the hood to the back rim (p3x2.coupon): the hood, the front
    rim and its 55 deg seat, the V-groove, the hollowed faces and the rebate, with a 60 mm plate"""
    reg = box(-30.0, 30.0, -50, D + 1, H - 18.0, H + 1)
    return a ^ reg, b ^ reg


def knob_coupon(b):
    """the right end wall round the knob hole, 44 mm square and the wall's depth: the collar's fit in a hole printed in
    the end wall"""
    return b ^ box(HW - WALL - 2.0, HW + 1, KY - 22.0, KY + 22.0, KZ - 22.0, KZ + 22.0)


def build():
    sh = V.shell2() - knob_hole()
    if SEAM_SCREWS:
        sh = sh - seam_screw_cuts()
    if LABELS:
        sh = sh - label_cuts()
    a, b = split_shell(sh)
    tr = tray_p5()
    tl, trr = P4.split_tray(tr)
    return dict(shell=sh, a=a, b=b, tray=tr, tray_left=tl, tray_right=trr, spine=P4.spine(), bridge=P4.bridge(),
                diffuser=P4.diffuser_halves(), diffuser_print=P4.diffuser_halves(printed=True),
                plates=[joint_plate(True), joint_plate(False)])


if __name__ == '__main__':
    import json, trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    P = build()
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])      # y = D on the bed (back down)
    report = {}

    def put(m, name, mat=None, drop_axis=1, frame=None):
        t = P4.to_tm(m)
        r = P4.to_tm(frame) if frame is not None else t.copy()
        for tt in {id(t): t, id(r): r}.values():
            if mat is not None:
                tt.apply_transform(mat)
        t.apply_translation([-(r.bounds[0][0] + r.bounds[1][0]) / 2, -(r.bounds[0][1] + r.bounds[1][1]) / 2, -r.bounds[0][2]])
        t.export(f'{out}/{name}')
        sq = P4.bed_fit(m, drop_axis)
        report[name] = dict(watertight=bool(t.is_watertight), extents=np.round(t.extents, 1).tolist(), square=sq[0],
                            spare_a_side=round((BED - sq[0]) / 2, 1), volume_cm3=round(float(t.volume) / 1000, 1))
    put(P['a'], 'p5-shell-left-walnut-backdown.stl', down)
    put(P['b'], 'p5-shell-right-walnut-backdown.stl', down)
    put(plate_flat(True), 'p5-joint-plate-top.stl', None, drop_axis=2)
    put(plate_flat(False), 'p5-joint-plate-bottom.stl', None, drop_axis=2)
    put(P['tray_left'], 'p5-tray-left.stl', down)
    put(P['tray_right'], 'p5-tray-right.stl', down)
    put(DR.status_window(), 'p5-tray-right-window.stl', down, frame=P['tray_right'])
    put(P['spine'], 'p5-spine.stl', down)
    put(P['bridge'], 'p5-bridge.stl', down)
    pair = lambda d, side: d[(side, 'white')] + d[(side, 'black')]
    dp = P4.same_way(P['diffuser_print'])
    for (side, part), m in dp.items():
        put(m, f'p5-diffuser-{side}-{part}.stl', None, drop_axis=2, frame=pair(dp, side))
    if P4.JOINT_BARS:
        put(P4.joint_bar(), 'p5-diffuser-bar.stl', None, drop_axis=2)
    import collar as CO, cleat as CLT
    put(P4.collar_p4().mirror([0, 0, 1]).translate([0, 0, CO.FL_T]), 'p5-encoder-collar.stl', None, drop_axis=2)   # flange top down
    put(DR.sled(), 'p5-sensor-sled.stl', None, drop_axis=2)
    put(CLT.case_cleat(), 'p5-cleat-case.stl', down); put(wall_cleat_p5(), 'p5-cleat-wall.stl', down)
    put(V.boot_key(), 'p5-boot-key.stl', None, drop_axis=2)
    # checks and coupons
    import check_corners as CK
    # a frame over all six inserts (305 x 142) doesn't fit the bed: this one covers one end's corner pair and the centre
    # pair, and is used twice (turn it half a turn for the other end; the pattern is symmetric)
    ix, iz = max(x for x, z in panel.P['inserts']), max(z for x, z in panel.P['inserts'])
    cf = CK.frame(ix + 10.0, 2 * iz + 10.0, [(sx * ix / 2, sz * iz) for sx in (-1, 1) for sz in (-1, 1)])
    put(cf, 'check-p5-corner-inserts.stl', None, drop_axis=2)
    ca, cb = seam_coupon(P['a'], P['b'])
    put(ca, 'coupon-p5-seam-left.stl', down); put(cb, 'coupon-p5-seam-right.stl', down)
    put(knob_coupon(P['b']), 'coupon-p5-knob-wall.stl', down)
    dj = P4.same_way(P4.diffuser_joint_coupon(P['diffuser_print']), whole=False)
    for (side, part), m in dj.items():
        put(m, f'coupon-p5-diffuser-joint-{side}-{part}.stl', None, drop_axis=2, frame=pair(dj, side))
    cs, ctr = DR.fit_coupon(P['shell'], P['tray'])
    put(cs, 'coupon-p5-drawer-fit-shell.stl', down); put(ctr, 'coupon-p5-drawer-fit-tray.stl', down)
    for k, v in report.items():
        print(k, v)
    summary = dict(W=round(2 * HW, 1), H=round(H, 1), D=D, wall=WALL, bore=(BORE_HX, BORE_HZ), plates=(JP_L, round(JP_Y1 - JP_Y0, 1), JP_T),
                   knob=dict(below_top=KNOB_DROP, y=round(KY, 2), flange_to_corner_round=round(H - RC - KZ - 17.5 * P4.KNOB_SCALE, 2)),
                   S3_edge=round(DR.S3_EDGE, 2), port_z=round(DR.PORT_Z - ZC, 2), port_above_bottom=round(DR.PORT_Z, 2),
                   corners=DR.CORNERS, bridge_z=round(P4.BRIDGE_Z - ZC, 1), spine_z=round(DR.CLEAT_SCREWS[0][1] - ZC, 1),
                   ribbon_drop=round(P4.RIB_Z - P4.IDC_Z, 2), screws_below_x=SCREW_X, seam_screws=SEAM_SCREWS, seam_screw_x=SS_X,
                   diff_shrink=P4.DIFF_SHRINK, wall_cleat=2 * P4.WALL_CLEAT_HW, assumed=list(panel.P['assumed']))
    print(summary)
    json.dump(dict(parts=report, summary=summary), open(f'{out}/p5-report.json', 'w'), indent=1)
