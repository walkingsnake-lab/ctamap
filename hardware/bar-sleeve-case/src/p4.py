"""P4 bar sleeve: the v5 drawer case for a Waveshare RGB-Matrix-P4-64x32 (256 x 128), in parts that fit the X2D's
256 mm bed. Everything not listed here is the v5 drawer (drawer.py), built from the 'p4' panel profile.

Shell (walnut PLA, 4 mm wall): the v5 sleeve, split into a top and a bottom half at mid height. Only the two end walls
are cut. The joint (JOINT 'plate', Nov 9; the pairs' joint, p3x2.py, turned onto the end walls):
- outside, a V-groove: each half's visible edges at the joint are chamfered CHAMF x 45 deg (end wall, front rim, hood
  side, back rim), so the line reads as deliberate and there is no thin ledge for a seam blob to sit on;
- flat end faces, hollowed: each is relieved HOLLOW except a LAND-wide band along the visible edges, so two not-quite-
  flat printed faces still close where you see them, and they can be sanded flat on glass before gluing;
- inside each end wall, a rebate JP_H tall straddles the joint (JP_T + JP_CL deep, from JP_Y0 behind the rim's seat to
  JP_Y1 in front of the back rim); a flat PLA plate JP_T thick lies in it, half in each shell half, glued to both
  (PLA to PLA, ~11 cm2 a half an end), its face JP_CL below the bore so the trays never touch it. The plate lines the two
  halves' walls up and carries the joint's shear, tension and peel over that area. Printed back-down the rebate is a
  pocket in a vertical face; its front end slopes 45 deg, so it has no roof.
  JOINT=lap builds the half-lap this replaced (inner half of the wall LAP lower, as a lip on the top half into a pocket
  in the bottom half, ~1.8 cm2 of glue an end; its coupon fit Nov 5): kept for a coupon comparison. It is the joint that
  stepped on the first P2.5 pair, and a 1.9 mm lip is the kind of thin walnut feature every pair joint that failed had.
- The trays hold both halves: two M3 x 10 from below into the bottom half's side (drawer.py), and two M2.5 x 8 under the
  knob into the top half's (TOP_SCREWS below), so the tray halves, which cross the shell's joint, splint it.
- No relief behind the S3's edge buttons (case2.BTN_RELIEF): in the drawer the board's edge sits 3.15 mm inside the
  shell's wall, behind the tray's own wall, so the relief only thinned the wall to 0.8 mm right under the joint.
Diffuser seat: the pairs' (p3x2.py), 55 deg with a 1.0 mm overlap (the v5's 45 deg / 0.3 mm let a diffuser push through
the rim of a long wall).
Tray (black PETG): drawer.tray(), the print-tested v5 drawer tray, with its options for a split tray, cut at x = 0. Each
half bolts to its two corner inserts (M3 x 8 flanged button heads down the post tubes, floating +/-0.7 on flat floors)
and takes one M3 x 10 from below into a pilot. Two pieces cross the tray seam on the back face:
- spine (top): a 3 mm bar on the cleat's two bosses (2 x M3 x 10 countersunk into their pilots, flush). The French cleat
  bolts to the same bosses, so on a wall the case cleat replaces the spine;
- bridge (bottom): a plate and a post to the panel's bottom-centre insert (1 x M3 x 8 flanged button head); the post
  passes a notch half in each tray half, so it keys them.
The ribbon runs at the panel input's height on the left half and at the S3 connector's on the right (RIBBON_DROP lower):
one hook pair on each half, the ribbon folded twice at 45 deg between them.
Diffuser (two-colour PETG): the bar diffuser with an 8 mm flange, split at x = 0 on the grid rib between pixel columns 32
and 33. That rib is 1.2 mm (0.6 a half) instead of 0.8, so each half has a printable edge. The whole first layer is
white (the face and the flange's front, as the single builds); everything above it black. The printed halves are built
DIFF_SHRINK larger in x and y (PETG shrink, measured on the first P2.5 pair: a 128 mm half comes out ~0.6 mm short).
The two halves are glued into one before fitting: nothing else holds the centre joint closed.
Wall cleat: the single build's case cleat (it bolts to the spine's bosses), with a longer wall cleat (WALL_CLEAT_HW) for
the 282 mm case.
Panel: turned 180 deg in the case like the v5 drawer (MATRIX_ROTATION 180), data in on the left; the S3 sits on the right
tray half, ribbon to the panel's input. (Plugged straight onto the panel's input, the S3's edge buttons would leave under
1 mm of wall at the 8 mm bezel.)
Run: python3 p4.py <outdir>   -> STLs (print orientation), coupons, and fit numbers
"""
import math, os, sys
os.environ['PANEL'] = 'p4'
os.environ.setdefault('CASE_WALL', '4.0')       # 3.5 until Nov 9: ~1.5x stiffer; the halves still leave a 3 mm brim on the bed
import numpy as np
from manifold3d import Manifold, CrossSection, JoinType
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
V.BTN_RELIEF = False             # no relief behind the S3's edge buttons (it left 0.8 mm of wall under the joint)
DR.M25_GUIDE_L = 1.5             # guide bore at the mouth of the S3 posts' and the sled's M2.5 pilots (drawer.py)
# diffuser seat, as the two-panel bars (p3x2.py, Nov 7): rim 1.5 in from the bore, seat 55 deg, the diffuser's bevel 0.2:
# overlap 1.0 mm (the v5's 45 deg seat held it by 0.3, a wedge a long wall can't hold)
SEAT_DEG, RIM_IN, DIFF_BEV = 55.0, 1.5, 0.2
V.set_seat(SEAT_DEG, RIM_IN, DIFF_BEV)
DF.BEV = DIFF_BEV

# ---------------------------------------------------------------- shell split
JOINT = os.environ.get('JOINT', 'plate')    # 'plate' (Nov 9) or 'lap' (the half-lap until then: kept for a coupon comparison)
assert JOINT in ('plate', 'lap'), JOINT
CHAMF, V_STEPS = 0.5, 5         # V-groove: each half's visible edges at the joint chamfered CHAMF x 45 deg, cut in 0.1 mm bands
HOLLOW, LAND = 0.3, 2.0         # plate joint: end faces relieved HOLLOW except a LAND band along the visible edges
JP_T = 1.2                      # joint plate thickness (6 layers at 0.2, printed flat)
JP_CL = float(os.environ.get('JP_CL', '0.1'))   # rebate deeper than the plate: its face sits this far below the bore
JP_H = 46.0                     # plate height, half in each shell half: 5.5 mm clear of the USB-C opening's edge, 7 mm inside the
                                # trays' side crush ribs (50 would leave 3.5 mm to the opening)
JP_Y0, JP_Y1 = Y_FACE + 2.0, DR.Y1 - 2.0        # plate along the depth: behind the rim's seat and the flange, in front of the back rim
JP_CL_E = 0.15                  # rebate larger than the plate at each end and edge
JP_EC = 0.4                     # lead chamfer on the plate's bore-side edges (its glued face stays flat)
assert WALL - JP_T - JP_CL >= 2.5, WALL         # wall left behind the rebate
LAP = 4.0                       # lap joint: inner half of the wall splits this much lower than the outer half
LAP_Y0 = Y_FACE + 1.0           # lap only behind the screen face ...
LAP_Y1 = DR.Y1 - 0.5            # ... and in front of the tray's back (the back rim shows the plain V)
LAP_CL = 0.12                   # glue gap on the lip's outer face and its ends (epoxy)
LAP_ZCL = 0.2                   # gap under the lip: the outer band is the only z seat


def joint_z(joint=None):
    """where the halves meet: mid height for the plate joint; LAP / 2 above it for the lap, so both halves (the top
    one with its lip) come out the same height"""
    return (H + LAP) / 2 if (JOINT if joint is None else joint) == 'lap' else H / 2


ZS = ZJ = joint_z()             # the joint plane, in the bottom of the V
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


def deep(d):
    """the shell's volume more than d from a face you can see: outside, the hood in front of the screen, the back rim"""
    m = outer_inset(d)
    m = m - prism_y(rr_cs(BORE_HX + d, BORE_HZ + d, BORE_R + d), -50, Y_FACE + d)
    m = m - prism_y(rr_cs(BORE_HX + d, BORE_HZ + d, BORE_R + d), DR.Y1, D + 50)
    return m


def visible_layer(sh, d):
    """shell material within d of a face you can see"""
    return sh - deep(d)


def lap_prism(cl, zcl, zj):
    """the lap's extent in y and z (all x): from the joint height down LAP, both ends chamfered 45 deg so neither
    the top half's lip nor the bottom half's pocket roof is a flat overhang when printed back-down. cl / zcl shrink it
    (the lip) inside the pocket."""
    z0, z1 = zj - LAP + zcl, zj + 0.01
    e = cl * math.sqrt(2)
    a = box(-HW - 1, HW + 1, LAP_Y0 + e, LAP_Y1 - e, z1 - 0.01, z1)
    b = box(-HW - 1, HW + 1, LAP_Y0 + e + (z1 - z0), LAP_Y1 - e - (z1 - z0), z0, z0 + 0.01)
    return (a + b).hull()


def v_groove(sh, zj):
    """the CHAMF x 45 deg chamfer on both halves' visible edges at the joint (z = zj), as V_STEPS stepped bands: in the
    band k steps out from the joint plane, the material within CHAMF less that distance of a visible face (p3x2.v_groove)"""
    cuts = []
    for k in range(V_STEPS):
        a, b = CHAMF * k / V_STEPS, CHAMF * (k + 1) / V_STEPS
        dk = CHAMF - (a + b) / 2
        band = box(-HW - 1, HW + 1, -50, D + 1, zj - b, zj + b)
        if k:
            band = band - box(-HW - 2, HW + 2, -51, D + 2, zj - a, zj + a)
        cuts.append(visible_layer(sh ^ band, dk))
    return Manifold.batch_boolean(cuts, ADD)


def hollow_cuts(sh, zj):
    """the end faces' relief: HOLLOW off each half's face at the joint, wherever the wall is more than LAND from a
    visible face: the band you see stays full height (p3x2.hollow_cuts)"""
    return (sh ^ box(-HW - 1, HW + 1, -50, D + 1, zj - HOLLOW, zj + HOLLOW)) ^ deep(LAND)


def rebate_cuts(zj):
    """the joint plates' rebates, one in each end wall's bore face: JP_H (+ clearance) tall about the joint, JP_T + JP_CL
    deep, JP_Y0 .. JP_Y1 (+ clearance) along the depth. Printed back-down each is a pocket in a vertical face: its front
    end (the print's top) slopes 45 deg out to the bore face, so nothing bridges."""
    d = JP_T + JP_CL
    y0, y1 = JP_Y0 - JP_CL_E, JP_Y1 + JP_CL_E
    z0, z1 = zj - JP_H / 2 - JP_CL_E, zj + JP_H / 2 + JP_CL_E
    full = box(BORE_HX - 0.01, BORE_HX + d, y0, y1, z0, z1)
    mouth = box(BORE_HX - 0.01, BORE_HX, y0 - d, y1, z0, z1)
    cut = (full + mouth).hull()
    return cut + cut.mirror([1, 0, 0])


def joint_plate(side, zj=None):
    """one joint plate in the case, in its rebate (side -1: left end wall, +1: right), its glued face on the rebate's
    floor and its other face JP_CL below the bore; JP_EC chamfers on that face's edges"""
    zj = ZJ if zj is None else zj
    x0, x1 = BORE_HX + JP_CL, BORE_HX + JP_CL + JP_T                       # bore side at x0
    full = box(x0 + JP_EC, x1, JP_Y0, JP_Y1, zj - JP_H / 2, zj + JP_H / 2)
    inset = box(x0, x1, JP_Y0 + JP_EC, JP_Y1 - JP_EC, zj - JP_H / 2 + JP_EC, zj + JP_H / 2 - JP_EC)
    m = (full + inset).hull()
    return m if side > 0 else m.mirror([1, 0, 0])


def joint_plate_flat():
    """the plate as it prints: its glued face on the bed"""
    w, h = JP_Y1 - JP_Y0, JP_H
    return (box(0, w, 0, h, 0, JP_T - JP_EC) + box(JP_EC, w - JP_EC, JP_EC, h - JP_EC, 0, JP_T)).hull()


def split_shell(sh, joint=None):
    """top and bottom halves; outside they meet at the joint plane, in the bottom of the V-groove.
    'plate': hollowed flat faces and a rebate in each end wall's bore face for a glued plate.
    'lap': the top half's lip (inner WALL / 2) runs LAP down into a pocket in the bottom half, LAP_CL / LAP_ZCL of glue gap."""
    joint = JOINT if joint is None else joint
    zj = joint_z(joint)
    s = sh - v_groove(sh, zj)
    upper, lower = box(-HW - 1, HW + 1, -50, D + 1, zj, H + 10), box(-HW - 1, HW + 1, -50, D + 1, -10, zj)
    if joint == 'lap':
        pocket = s ^ outer_inset(WALL / 2) ^ lap_prism(0, 0, zj)
        lip = s ^ outer_inset(WALL / 2 + LAP_CL) ^ lap_prism(LAP_CL, LAP_ZCL, zj)
        top, bot = (s ^ upper) + lip, (s ^ lower) - pocket
    else:
        s = s - hollow_cuts(sh, zj) - rebate_cuts(zj)
        top, bot = s ^ upper, s ^ lower
    out = []
    for m in (top, bot):
        parts = sorted(m.decompose(), key=lambda q: -q.volume())
        assert all(q.volume() < 0.01 for q in parts[1:]), [q.volume() for q in parts[1:]]
        out.append(parts[0])
    return tuple(out)


# ---------------------------------------------------------------- top screws, under the knob
# Two M2.5 x 8 button heads either side of the knob axis, one into each tray half: down through a hole in the collar's
# flange (the head sits on the walnut, flush with the flange top, under the knob's skirt), a clearance stadium in the
# shell's top wall and into a pilot in a boss on the tray's top wall, built onto the encoder rail. They hold the top
# shell half down on both tray halves (the screws from below hold the bottom half), so the trays splint the shell joint,
# the 274 mm top wall is tied at mid-span, and knob presses go into the trays. TOP_SCREWS=0 builds without them.
TOP_SCREWS = os.environ.get('TOP_SCREWS', '1') not in ('0', '', 'no', 'false')
TS_X = 15.0                     # screw x, +/-: the pilot keeps 0.65 mm of wall to the rail's inner face (13.15)
TS_LEN = 8.0                    # M2.5 x 8: its tip stops above the rail's lower edge (and the QT plugs under the board)
TS_HEAD_D, TS_HEAD_K = 4.7, 1.6 # button head, largest (ISO 7380-1: 4.7 x 1.5; the kit's measure ~4.5 x 1.4)
TS_SHANK = 2.5
TS_CLEAR = 2.9                  # shell hole: +/-0.2 in x (the tray halves' play); +/-DR.SCREW_FLOAT along y, as the screws from below
TS_FLANGE = 5.2                 # hole through the collar's flange for the head
TS_PILOT = DR.SLED_PILOT        # 2.4, horizontal in the print: the sensor sled's M2.5 pilot (fit Nov 3)
TS_BOSS_OUT = 2.8               # boss past the screw axis, outboard
TS_BOSS_HY = 3.2                # boss half length along y
TS_PAD = 0.2                    # pad on the tray's top under the screw: takes up TRAY_CL (0.25) so the screw doesn't dish the walnut
TS_PAD_HX, TS_PAD_HY, TS_PAD_RAMP = 3.5, 4.5, 1.5
TS_LEAD = 0.6                   # lead-in at the pilot's mouth (0.4 until Nov 9): the screw starts blind, through the walnut. No guide
                                # bore here: the boss has only ~4 mm of thread. Pre-thread it on the bench (P4-BUILD.md)


def top_screw_xy():
    return [(-TS_X, KY), (TS_X, KY)]


def shell_top_screw_cuts():
    """clearance stadiums through the shell's top wall (truncated teardrops toward the print's up, as the holes below)"""
    r, f = TS_CLEAR / 2, DR.SCREW_FLOAT
    cuts = []
    for x, y in top_screw_xy():
        cs = (V.teardrop_cs(r, x, y - f, trunc=r + 0.25, seg=32) + V.teardrop_cs(r, x, y + f, trunc=r + 0.25, seg=32)).hull()
        cuts.append(Manifold.extrude(cs, WALL + 2).translate([0, 0, H - WALL - 1]))
    return Manifold.batch_boolean(cuts, ADD)


def tray_top_bosses():
    """(adds, cuts) for the tray: per screw a boss hanging from the top wall on the outside of the encoder rail, as deep
    as the rail (so it clears the QT plugs under the encoder's board as the rail does), its back end sloped 45 deg (no
    flat overhang back-down); a pad on the wall's outer face; a through pilot with a lead-in at the top."""
    bz1 = DR.enc_board()[2][1]                                   # the encoder board's top face
    zw, zb = DR._zw(), bz1 - DR.RAIL_LAP                        # top wall's inner face, the rails' lower edge
    zo = zw + DR.TRAY_WT                                         # top wall's outer face
    adds, cuts = [], []
    for (x, y), (xa, xb) in zip(top_screw_xy(), sorted(DR.rail_xs(), key=lambda r: r[0])):
        sx = 1 if x > 0 else -1
        x0, x1 = sorted((xa, x + sx * TS_BOSS_OUT))              # from the rail's inner face outward
        boss = box(x0, x1, y - TS_BOSS_HY, y + TS_BOSS_HY, zb, zw + 0.01)
        gus = (box(x0, x1, y + TS_BOSS_HY - 0.01, y + TS_BOSS_HY, zb, zw + 0.01)
               + box(x0, x1, y + TS_BOSS_HY, y + TS_BOSS_HY + (zw - zb), zw, zw + 0.01)).hull()
        pad = (box(x - TS_PAD_HX, x + TS_PAD_HX, y - TS_PAD_HY - TS_PAD_RAMP, y + TS_PAD_HY + TS_PAD_RAMP, zo - 0.3, zo)
               + box(x - TS_PAD_HX, x + TS_PAD_HX, y - TS_PAD_HY, y + TS_PAD_HY, zo, zo + TS_PAD)).hull()
        adds += [boss, gus, pad]
        cuts.append(cyl_z(x, y, zb - 1, zo + TS_PAD + 1, TS_PILOT, 24))
        cuts.append(Manifold.cylinder(TS_LEAD + 0.01, TS_PILOT / 2, TS_PILOT / 2 + TS_LEAD + 0.01, 24).translate([x, y, zo + TS_PAD - TS_LEAD]))
    return Manifold.batch_boolean(adds, ADD), Manifold.batch_boolean(cuts, ADD)


def collar_top_screw_cuts():
    """holes through the collar's flange for the screw heads (collar frame: origin at the knob hole on the case top)"""
    import collar as CO
    f = DR.SCREW_FLOAT
    cuts = []
    for x, _ in top_screw_xy():
        cs = (CrossSection.circle(TS_FLANGE / 2, 48).translate([x, -f]) + CrossSection.circle(TS_FLANGE / 2, 48).translate([x, f])).hull()
        cuts.append(Manifold.extrude(cs, CO.FL_T + 1.01).translate([0, 0, -0.01]))
    return Manifold.batch_boolean(cuts, ADD)


def top_screws_env(dx=0.0, dy=0.0):
    """the two screws seated (fit checks): head on the case top, shank TS_LEN down; dx / dy = the tray's float"""
    out = []
    for x, y in top_screw_xy():
        out.append(cyl_z(x + dx, y + dy, H, H + TS_HEAD_K, TS_HEAD_D, 48) + cyl_z(x + dx, y + dy, H - TS_LEN, H + 0.01, TS_SHANK, 32))
    return out


# ---------------------------------------------------------------- tray (drawer.tray with its split options, cut at x = 0)
SEAM_BAR = 5.0                  # top louver rows: a solid bar this far either side of the tray seam
BRIDGE_X = 18.0                 # bottom louver rows: a gap this far either side (the bridge plate)
BRIDGE_Z = ZC - 56.0            # panel's bottom-centre insert
HOOK_X = -22.0                  # first ribbon hook pair: left half, at the panel input's height, clear of the seam
HOOK2_X = 45.0                  # second pair: right half, at the S3's connector height (the ribbon drops between them)
RIB_HOOK_LIP = 4.0              # ribbon hooks' lip as thick as its 4 mm reach: 45 deg underside back-down
SPINE_HW, SPINE_H, SPINE_T = 62.0, 14.0, 3.0
CSK_D = 6.8                     # countersink at the spine's outer face (ISO 10642 M3 head: 6.72 max), 90 deg
BRIDGE_HW, BRIDGE_H, BRIDGE_T = 15.0, 14.0, 3.0
NOTCH_D = P3.SO_OD + 0.6        # each tray half's half-hole round the bridge tube (the drawer's 11 mm posts)
RIB_Z = ZC + min(DR.HEADERS, key=lambda h: h[0])[1]          # the ribbon at the panel input (left after the turn)
IDC_Z = DR.S3_Z0 + (5.0 + 39.4) / 2                         # the ribbon at the S3's 2x8 connector (drawer.s3_envelope)
RIBBON_DROP = RIB_Z - IDC_Z


def tray_p4():
    """drawer.tray() (posts with float, pilots, sensor-sled hooks, encoder rails, status window pocket) with the split's
    options: no louver crosses the seam (a 10 mm bar at the top, a 36 mm gap for the bridge plate at the bottom); two
    ribbon hook pairs, one at the panel input's height on the left half and one at the S3 connector's on the right, with
    the ribbon folded twice at 45 deg between them; the tie loop on the right half; a notch for the bridge tube."""
    notch = cyl_y(0, BRIDGE_Z, DR.Y0 - 10, DR.Y1 + 1, NOTCH_D, 48)
    t = DR.tray(top_bar=SEAM_BAR, bottom_gap=BRIDGE_X, ribbon_hooks=[(HOOK_X, RIB_Z), (HOOK2_X, IDC_Z)],
                hook_lip=RIB_HOOK_LIP, tie_x0=SEAM_BAR + 4.0, extra_cuts=[notch])
    if TOP_SCREWS:
        adds, cuts = tray_top_bosses()
        t = (t + adds) - cuts
    return t


SEAM_CH = 0.5                   # 45 deg chamfer on the tray seam's edges that meet as the right half slides in


def seam_chamfer(t, side):
    """remove a SEAM_CH x 45 deg chamfer from a tray half's edges on the seam (x = 0): the right half's (side +1)
    front-facing edges, which lead as it slides in, and the left half's (side -1) back-facing ones, which they pass.
    The half's section on the seam, extruded SEAM_CH into the half and sheared back (right) or forward (left) by
    SEAM_CH at the seam, is what may stay in that slab. The section is grown 0.01 so none of its faces lands (almost)
    on the half's own: a slice's round-off there leaves zero-area slivers that break the STL."""
    to_yzx = [[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 0, 0]]                 # (x, y, z) -> (y, z, x)
    sec = t.transform(to_yzx).slice(side * 0.01).offset(0.01, JoinType.Miter)   # (y, z)
    k = Manifold.extrude(sec, SEAM_CH + 0.2).transform([[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0]])
    k = k.translate([-0.1, 0, 0])                                        # x -0.1..SEAM_CH + 0.1
    if side < 0:
        k = k.mirror([1, 0, 0])
    # shear: y += side * (SEAM_CH - |x|), so the section steps SEAM_CH away from the leading side at the seam
    k = k.transform([[1, 0, 0, 0], [-1.0, 1, 0, SEAM_CH], [0, 0, 1, 0]] if side > 0 else
                    [[1, 0, 0, 0], [-1.0, 1, 0, -SEAM_CH], [0, 0, 1, 0]])
    slab = box(-0.1, SEAM_CH, -10, D + 10, -10, H + 10) if side > 0 else box(-SEAM_CH, 0.1, -10, D + 10, -10, H + 10)
    return t - (slab - k)


def split_tray(t):
    left = t ^ box(-HW, 0, -10, D + 10, -10, H + 10)
    right = t ^ box(0, HW, -10, D + 10, -10, H + 10)
    left, right = (max(m.decompose(), key=lambda m: m.volume()) for m in (left, right))
    return seam_chamfer(left, -1), seam_chamfer(right, 1)


def spine():
    """bar across the tray seam on the back face, on the cleat's two bosses: 2 x M3 x 10 countersunk into their pilots
    (the case cleat bolts to the same bosses on a wall, so it replaces the spine)"""
    zc = DR.CLEAT_SCREWS[0][1]
    cs = CrossSection.square([2 * SPINE_HW - 6, SPINE_H - 6], center=True).offset(3, JT, circular_segments=24).translate([0, zc])
    s = prism_y(cs, DR.Y1, DR.Y1 + SPINE_T)
    y_out = DR.Y1 + SPINE_T
    for cx, cz in DR.CLEAT_SCREWS:                       # countersunk: head flush, 1 mm inside the back rim
        s = s - cyl_y(cx, cz, DR.Y1 - 1, y_out + 1, 3.4, 24)
        s = s - Manifold.cylinder(CSK_D / 2 - 1.7 + 0.01, 1.7, CSK_D / 2 + 0.01, 48).rotate([-90, 0, 0]).translate([cx, y_out - (CSK_D / 2 - 1.7), cz])
    return s


def bridge():
    """plate across the tray seam at the bottom + a post to the panel's bottom-centre insert, as the drawer's posts: flat
    floor with a Ø4.5 hole for an M3 x 8 flanged button head (+/-0.7 float), sequentially bridged, POST_LONG long"""
    cs = CrossSection.square([2 * BRIDGE_HW - 6, BRIDGE_H - 6], center=True).offset(3, JT, circular_segments=24).translate([0, BRIDGE_Z])
    b = prism_y(cs, DR.Y1, DR.Y1 + BRIDGE_T)
    b = b + cyl_y(0, BRIDGE_Z, P3.FOOT_Y, DR.Y1 + 0.01, P3.SO_OD, 48)
    b = b - cyl_y(0, BRIDGE_Z, P3.FOOT_Y + P3.SO_FLOOR, DR.Y1 + BRIDGE_T + 1, P3.SO_BORE, 48)
    b = b - cyl_y(0, BRIDGE_Z, P3.FOOT_Y - 1, P3.FOOT_Y + P3.SO_FLOOR + 0.1, P3.SO_HOLE, 32)
    b = b - DR.floor_bridge_cuts(0, BRIDGE_Z)
    return b


# ---------------------------------------------------------------- diffuser halves
CENTRE_RIB = 1.2                 # 0.6 each side of the split
# PETG shrink (p3x2.py, Nov 7): the first P2.5 pair's black PETG grid printed 0.45% small. Each P4 half is 128 mm wide
# and tall, so uncompensated it comes out ~0.6 mm short each way: the skirts too tight for the panel and the ribs
# walking off the gaps between the LEDs. The printed halves are built this much larger in x and y (z untouched).
# DIFF_SHRINK=0 for a PLA grid; measure a printed half (145.2 mm tall over the flange) and adjust.
DIFF_SHRINK = float(os.environ.get('DIFF_SHRINK', '0.0045'))


def diffuser_halves(printed=False):
    """DF.diffuser() (8 mm flange) split at x = 0. Returns {(side, part): manifold} in DF's frame (z = 0 is the face, +z
    toward the LEDs; y up the panel). part: 'white' (the whole first layer: the face and the flange's front) or 'black'
    (everything above it). printed: built DIFF_SHRINK larger in x and y, about the centre joint, for the PETG's shrink;
    otherwise the size it should come out (fit checks, renders)."""
    d = DF.diffuser(skin=DF.SKIN)
    hy = DF.PH / 2
    d = d + box(-CENTRE_RIB / 2, CENTRE_RIB / 2, -hy + 0.29, hy - 0.29, DF.SKIN - 0.01, DF.SKIN + DF.GRID_H)
    first = box(-400, 400, -400, 400, -1, DF.SKIN)
    k = 1.0 / (1.0 - DIFF_SHRINK) if printed else 1.0
    out = {}
    for side, xs in (('left', (-200, 0)), ('right', (0, 200))):
        half = d ^ box(xs[0], xs[1], -200, 200, -5, 20)
        out[(side, 'white')] = (half ^ first).scale([k, k, 1.0])
        out[(side, 'black')] = (half - first).scale([k, k, 1.0])
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


# ---------------------------------------------------------------- knob and collar: 18% bigger, for the P4's proportions
KNOB_SCALE = 1.18                # chosen from renders (Nov 3); 1.33 (the panel ratio) read heavy and put the collar 3.8 mm
                                 # from the back edge


def knob_p4(bore_d=None, flat=None, marks=2):
    """knob.py's pebble knob, KNOB_SCALE wider and taller. Everything that fits the encoder stays: bore and D fit
    (knob.FITS[1], settled on the P3), the shaft-tip stop (TIP_Z), the nut recess and press travel, the 1 mm gap over the
    collar (SKIRT_Z). The extra height goes into a thicker top; the flutes keep their spacing."""
    import knob as KN
    if bore_d is None:
        bore_d, flat = KN.FITS[1]
    saved = KN.PEB_R, KN.SHOULDER_R, KN.TOP_T, KN.FLUTES
    try:
        KN.PEB_R = saved[0] * KNOB_SCALE
        KN.SHOULDER_R = saved[1] * KNOB_SCALE
        KN.TOP_T = (KN.TIP_Z + saved[2] - KN.SKIRT_Z) * KNOB_SCALE + KN.SKIRT_Z - KN.TIP_Z
        KN.FLUTES = int(round(saved[3] * KNOB_SCALE / 4)) * 4
        return KN.knob(bore_d, flat, marks)
    finally:
        KN.PEB_R, KN.SHOULDER_R, KN.TOP_T, KN.FLUTES = saved


def collar_p4():
    """collar.py's back-down collar (crush-ribbed plug, 9.8 pocket) with its flange KNOB_SCALE wider. The plug, the shell's
    24 mm hole and the flange thickness (which sets how much bushing the nut gets) don't change."""
    import collar as CO
    saved = CO.FL_R, CO.TIP_BACK, CO.RIB_PHASE
    try:
        CO.FL_R = saved[0] * KNOB_SCALE
        CO.TIP_BACK = False
        if TOP_SCREWS:
            CO.RIB_PHASE = 15.0                     # no crush rib on the x axis, where the screw holes leave 1.55 mm of walnut
        c = CO.collar()
        return c - collar_top_screw_cuts() if TOP_SCREWS else c
    finally:
        CO.FL_R, CO.TIP_BACK, CO.RIB_PHASE = saved


WALL_CLEAT_HW = 110.0           # wall cleat half length: 220 mm for the 282 mm case (the single's is 149); flat on the bed,
                                # and 5 mm short of the Boot funnel on the right tray half's back
WALL_CLEAT_XS = (-95.0, 0.0, 95.0)   # its three wall screws


def wall_cleat_p4():
    import cleat as CLT
    return CLT.wall_cleat(hw=WALL_CLEAT_HW, xs=WALL_CLEAT_XS)


def collar_knob():
    """the collar in the case (fit checks)"""
    return collar_p4().translate([0, KY, H])


def knob_in_case():
    import knob as KN
    return knob_p4().translate([0, KY, H])


# ---------------------------------------------------------------- coupons
def seam_coupon(top, bot, zj=None):
    """the LEFT end of both shell halves, 30 mm wide and the full depth (hood, front rim and its seat, V-groove, the
    whole joint, back rim): test the joint's fit over its whole length, the glue and how the V reads after finishing.
    (The front 34 mm alone, as before Nov 9, can't show a step along the depth.)"""
    zj = ZJ if zj is None else zj
    reg = box(-HW - 1, -HW + 30, -50, D + 1, zj - 32, zj + 32)
    return top ^ reg, bot ^ reg


def top_screw_coupon(top, tray):
    """one top screw's stack: the shell's top wall round its hole (walnut) and the tray's top wall with the pad, boss
    and pilot (PETG), 18 x 18 mm each. Drive an M2.5 x 8 through the walnut into the PETG: it should thread in firmly and
    pull the two together with no gap and no dishing."""
    x, y = top_screw_xy()[1]
    reg = box(x - 7.0, x + 11.0, y - 9.0, y + 9.0, H - 30, H + 5)
    return top ^ reg, tray ^ reg


def diffuser_joint_coupon(halves):
    """a 40 mm wide strip across the diffuser's centre joint, bottom edge included (skirt, bezel): print both halves and
    hold them on the panel to see the joint lit and dark"""
    hy = DF.PH / 2
    reg = box(-20, 20, -hy - 20, -hy + 30, -5, 20)
    return {k: v ^ reg for k, v in halves.items()}


def diffuser_shrink_coupon(printed):
    """the bottom strip of the printed left half, its whole width (flange, skirt and the first rows of the grid): a
    quick print to measure the PETG's shrink before the halves. Built length (flange edge to the joint face):
    DF.FL_HX / (1 - DIFF_SHRINK); it should measure DF.FL_HX (136.6). Otherwise DIFF_SHRINK = 1 - measured / built."""
    hy = DF.PH / 2
    reg = box(-400, 0.5, -hy - 20, -hy + 9.0, -5, 20)
    return {k: v ^ reg for k, v in printed.items() if k[0] == 'left'}


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
    if TOP_SCREWS:
        sh = sh - shell_top_screw_cuts()
    top, bot = split_shell(sh)
    tr = tray_p4()
    tl, trr = split_tray(tr)
    return dict(shell=sh, top=top, bot=bot, tray=tr, tray_left=tl, tray_right=trr, spine=spine(), bridge=bridge(),
                diffuser=diffuser_halves(), diffuser_print=diffuser_halves(printed=True),
                plates=[joint_plate(-1), joint_plate(1)] if JOINT == 'plate' else [])


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    P = build()
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])      # y = D on the bed (back down)
    spin45 = trimesh.transformations.rotation_matrix(math.pi / 4, [0, 0, 1])
    report = {}

    def put(m, name, mat=None, diag=False, drop_axis=1, frame=None):
        """frame: centre and drop on this part instead (a two-colour pair shares one frame, so its parts stay registered)"""
        t = to_tm(m)
        r = to_tm(frame) if frame is not None else t.copy()
        for tt in {id(t): t, id(r): r}.values():
            if mat is not None:
                tt.apply_transform(mat)
            if diag:
                tt.apply_transform(spin45)                    # pre-rotated 45 deg: drops onto the X2D's bed diagonally
        t.apply_translation([-(r.bounds[0][0] + r.bounds[1][0]) / 2, -(r.bounds[0][1] + r.bounds[1][1]) / 2, -r.bounds[0][2]])
        t.export(f'{out}/{name}')
        sq = bed_fit(m, drop_axis)
        report[name] = dict(watertight=bool(t.is_watertight), extents=np.round(t.extents, 1).tolist(), square=sq[0],
                            spare_a_side=round((BED - sq[0]) / 2, 1), volume_cm3=round(t.volume / 1000, 1))
    put(P['top'], 'p4-shell-top-walnut-backdown.stl', down, diag=True)
    put(P['bot'], 'p4-shell-bottom-walnut-backdown.stl', down, diag=True)
    put(P['tray_left'], 'p4-tray-left.stl', down)
    put(P['tray_right'], 'p4-tray-right.stl', down)
    put(DR.status_window(), 'p4-tray-right-window.stl', down, frame=P['tray_right'])   # its second part (AMS)
    put(P['spine'], 'p4-spine.stl', down)
    put(P['bridge'], 'p4-bridge.stl', down)
    pair = lambda d, side: d[(side, 'white')] + d[(side, 'black')]
    for (side, part), m in P['diffuser_print'].items():         # face down, z = 0 is the face: as exported (built for the shrink)
        put(m, f'p4-diffuser-{side}-{part}.stl', None, drop_axis=2, frame=pair(P['diffuser_print'], side))
    # coupons
    ct, cb = seam_coupon(P['top'], P['bot'])
    put(ct, 'coupon-p4-seam-top.stl', down); put(cb, 'coupon-p4-seam-bottom.stl', down)
    if JOINT == 'plate':
        put(joint_plate_flat(), 'p4-joint-plate.stl', None, drop_axis=2)          # print two (one per end); a third for the seam coupon
        lt, lb = split_shell(P['shell'], 'lap')                                    # the half-lap, for the coupon comparison
        ct, cb = seam_coupon(lt, lb, joint_z('lap'))
        put(ct, 'coupon-p4-seam-lap-top.stl', down); put(cb, 'coupon-p4-seam-lap-bottom.stl', down)
    dj = diffuser_joint_coupon(P['diffuser_print'])
    for (side, part), m in dj.items():
        put(m, f'coupon-p4-diffuser-joint-{side}-{part}.stl', None, drop_axis=2, frame=pair(dj, side))
    ds = diffuser_shrink_coupon(P['diffuser_print'])
    for (side, part), m in ds.items():
        put(m, f'coupon-p4-diffuser-shrink-{part}.stl', None, drop_axis=2, frame=pair(ds, side))
    import knob as KN, collar as CO
    put(KN.to_bed(knob_p4()), 'p4-knob.stl', None, drop_axis=2)                        # skirt on the bed
    cm = collar_p4()
    put(cm.mirror([0, 0, 1]).translate([0, 0, CO.FL_T]), 'p4-encoder-collar.stl', None, drop_axis=2)   # flange top down
    put(DR.sled(), 'p4-sensor-sled.stl', None, drop_axis=2)                           # plate down
    import cleat as CLT                                                                  # wall hanging (replaces the spine)
    put(CLT.case_cleat(), 'p4-cleat-case.stl', down); put(wall_cleat_p4(), 'p4-cleat-wall.stl', down)
    if TOP_SCREWS:
        cw, cp = top_screw_coupon(P['top'], P['tray'])
        put(cw, 'coupon-p4-top-screw-shell.stl', down); put(cp, 'coupon-p4-top-screw-tray.stl', down)
    put(V.boot_key(), 'p4-boot-key.stl', None, drop_axis=2)
    cs, ctr = DR.fit_coupon(P['shell'], P['tray'])
    put(cs, 'coupon-p4-drawer-fit-shell.stl', down); put(ctr, 'coupon-p4-drawer-fit-tray.stl', down)
    import json
    for k, v in report.items():
        print(k, v)
    summary = dict(W=round(2 * HW, 1), H=round(H, 1), D=D, joint=JOINT, joint_above_centre=round(ZJ - ZC, 2), plate=(round(JP_Y1 - JP_Y0, 1), JP_H, JP_T) if JOINT == 'plate' else None, bore=(BORE_HX, BORE_HZ),
                   S3_edge=round(DR.S3_EDGE, 2), port_z=round(DR.PORT_Z - ZC, 2), corners=DR.CORNERS, bridge_z=round(BRIDGE_Z - ZC, 1),
                   spine_z=round(DR.CLEAT_SCREWS[0][1] - ZC, 1), ribbon_drop=round(RIBBON_DROP, 2), idc_z=round(IDC_Z - ZC, 2),
                   wall=WALL, seat_deg=SEAT_DEG, rim_in=RIM_IN, diff_shrink=DIFF_SHRINK, shrink_strip_built=round(DF.FL_HX / (1 - DIFF_SHRINK), 2),
                   wall_cleat=2 * WALL_CLEAT_HW, top_screws=TOP_SCREWS)
    print(summary)
    json.dump(dict(parts=report, summary=summary), open(f'{out}/p4-report.json', 'w'), indent=1)
