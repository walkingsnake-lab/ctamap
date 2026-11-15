"""V6 case, draft 1 (Nov 15, 2026): the P4 case rebuilt as a rigid PETG chassis with a walnut skin. Units mm.

    python3 v6.py <out dir>          # STLs of the draft parts (not print files yet) and a report

Why: the first full P4 build (v5 drawer, p4.py) had walls that press in, a tray that creaks under the knob, a wobbling
knob and light bleed at the diffuser's edges. An independent look at the model found the walnut sleeve open at the
back, the tray joined to it by friction only, the tray's walls cut loose from its back by the louver slots, and the tray
halves' seam right under the knob. See DESIGN-HISTORY.md (Nov 14-15) and the project's V6 notes.

What V6 is, in terms of the V5 parts it is built from (every proven fit is kept):
- **Chassis** = p4's tray made into the structure. One closed PETG box in two halves: no crush ribs (the walnut is
  screwed to it, 0.25 mm clear); the louver bands tied to the walls by rungs; the split moved from the centre to
  x = JOINT_X, clear of the encoder, with a lap tongue on the left half that slides inside the right half and is
  screwed from outside (back, top, bottom); the panel on M3 x 30 standoffs landing on bosses on the chassis back, a
  short screw from the back surface, at all six inserts (no post tubes, no bridge, no spine); a tower on the top wall
  that the encoder is nut-clamped to, so the knob's seat belongs to the chassis and not to the walnut.
- **Skin** = p4's walnut shell cut into four pieces where the corner rounds start: a top and a bottom plank and two end
  caps, V-grooved at the seams, screwed to the chassis from outside with black M3 button heads (holes staggered front
  to back so no two on one piece share print layers), plus the screws V5 already has under the knob and under the
  case. No glue. Each piece comes on square to its own face (planks down / up, caps from the sides): the rim's sloped
  seat only ever opens as a piece is lifted away.
- **Diffuser, knob**: p4's, the diffuser 0.3 mm back from the rim (RIM_GAP) so the rim covers its border without
  clamping it. The collar becomes a trim ring round the encoder tower. No glow round the knob: dropped to keep the
  tower simple (a well and a prong on the ring were drawn, Nov 15; see DESIGN-HISTORY.md).
- **Wall hanging**: the V5 cleat, on the same two bosses in the chassis back (one in each half, so it splices them too).

Draft: the geometry is checked for overlaps (see check()), not print-tested. Wall thickness, the tongue joint, the
tower and the ring's fixing are first answers.
"""
import math, os, sys
import numpy as np
from manifold3d import Manifold, CrossSection, JoinType
import p4
from p4 import box, cyl_y, cyl_z, ADD, DR, V, H, D, HW, ZC, WALL
W = 2 * HW
KY = V.KY if hasattr(V, 'KY') else p4.top_screw_xy()[0][1]
import case as C
import collar as CO
import panel

# ---------------------------------------------------------------- settings
SEAM = W / 2 - 15.5              # |x| where the corner round starts (125.4): plank | end cap
V_GROOVE = 0.5                   # chamfer a side at the skin's seams
RIM_GAP = 0.3                    # the diffuser (and panel) sit this far behind the V5 position: the rim only covers
JOINT_X = 24.0                   # the chassis's split: right of the encoder (rails and QT plugs reach x = 21)
TONGUE = 10.0                    # the left half's lap tongue reaches this far into the right half
TONGUE_T, TONGUE_CL = 2.5, 0.15
STANDOFF_L, STANDOFF_AF = 30.0, 5.5          # M3 male-female hex standoff, screwed into each panel insert by hand
SKIN_CL_D = 3.4                  # M3 clearance through the walnut
PILOT_H = 3.0                    # M3 thread-forming pilot, horizontal in the print (drawer.TAP_D, fit set #3)
PILOT_V = 3.1                    # vertical in the print (drawer.TAP_D_V)
INSERTS = os.environ.get('V6_INSERTS', '0') not in ('0', '', 'no', 'false')   # heat-set inserts at the skin and joint screws
INSERT_D, INSERT_L = DR.INSERT_D, DR.INSERT_L                                  # 4.0 x 6.0: the M3 x 5.7, 4.6-5.0 OD class
BOSS, BOSS_H = 8.0, 3.5          # screw bosses on the chassis walls: square, with a 45 deg ramp on the back (bed) side
HEAD_D, HEAD_K = 5.7, 1.65       # M3 button head

# skin screws. Planks: (x, y), a front and a back one at each end, all four depths different on a plank.
PLANK_SCREWS = ((-(SEAM - 13.0), 24.0), (-(SEAM - 20.0), 57.0), (SEAM - 13.0, 51.0), (SEAM - 20.0, 30.0))
CAP_SCREWS = ((30.0, ZC + 50.0), (52.0, ZC - 50.0))        # (y, z) on each end face: one high in front, one low behind (above and below the S3)

# chassis numbers taken from the tray
XIN = C.BORE_HX - DR.TRAY_CL - DR.TRAY_WT                 # inner half width (134.15)
HZ = C.BORE_HZ - DR.TRAY_CL - DR.TRAY_WT                  # inner half height (70.15)
RIN = C.BORE_R - DR.TRAY_CL - DR.TRAY_WT
ZIN0, ZIN1 = ZC - HZ, ZC + HZ                              # bottom / top wall, inner faces
ZO0, ZO1 = ZIN0 - DR.TRAY_WT, ZIN1 + DR.TRAY_WT            # outer faces
YB0, YB1 = DR.Y0, DR.Y1                                    # back plate: inner, outer face (67, 69)
PB = p4.PANEL_BACK - p4.PANEL_THIN + RIM_GAP               # the panel housing's back in V6
BOSS_Y = PB + STANDOFF_L                                   # where a standoff ends: the boss's front face


def ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return CrossSection([pts if a > 0 else pts[::-1]])


def cyl_x(y, z, x0, x1, d, seg=48):
    return Manifold.cylinder(x1 - x0, d / 2, d / 2, seg).rotate([0, 90, 0]).translate([x0, y, z])


def along_y(pts, y0, y1):
    """polygon in (x, z), from y0 to y1"""
    return Manifold.extrude(ccw(pts), y1 - y0).rotate([90, 0, 0]).translate([0, y1, 0])


def along_x(pts, x0, x1):
    """polygon in (y, z), from x0 to x1"""
    return Manifold.extrude(ccw(pts), x1 - x0).rotate([90, 0, 90]).translate([x0, 0, 0])


def along_z(pts, z0, z1):
    return Manifold.extrude(ccw(pts), z1 - z0).translate([0, 0, z0])


# ---------------------------------------------------------------- skin
def knob_hole_tool():
    """the knob hole with a point toward the back as well as the front (the encoder tower's printing wedge passes
    through it): the whole outline 0.02 larger than V5's hole, so the tool's wall lies on none of the hole's"""
    r = V.ENC_HOLE / 2
    a = r * math.cos(math.pi / 4)
    cs = CrossSection.circle(r, 96) + ccw([(a, a), (0, r * math.sqrt(2)), (-a, a)]) + ccw([(a, -a), (-a, -a), (0, -r * math.sqrt(2))])
    return Manifold.extrude(cs.offset(0.02, JoinType.Round, 2.0, 96), WALL + 2).translate([0, KY, H - WALL - 1])


def seam_cut(sx, sz):
    """half of the V groove at a seam, for the piece on the centre side (plank: toward x = 0) or the outer side (cap) of
    the seam at x = sx * SEAM, on the top (sz = +1) or bottom (sz = -1) wall. V_GROOVE x 45 deg off the edges that
    show: the outer face, the hood's underside and the front edge. Each tool runs 0.2 past the piece's end face and
    0.02 past its surfaces, so no face or edge of the tool lies on the piece."""
    def tool(side):                               # side +1: for the plank (it lies toward the centre); -1: for the cap
        o, e, v = 0.2, 0.02, V_GROOVE
        zo = H if sz > 0 else 0.0                 # outer face
        zi = zo - sz * WALL                       # inner face (the hood's underside in front of the rim)
        def L(l, z):                              # l: distance into the piece from the seam (negative: past its end face)
            return (sx * (SEAM - side * l), z)
        outer = along_y([L(v + e, zo + sz * e), L(-o, zo + sz * e), L(-o, zo - sz * (v + o))], -1, D + 1)
        inner = along_y([L(v + e, zi - sz * e), L(-o, zi + sz * (v + o)), L(-o, zi - sz * e)], -1, D + 1)
        z0, z1 = sorted((zo - sz * (WALL + 4.0), zo + sz * 1.0))
        front = along_z([L(v + e, -e), L(-o, -e), L(-o, v + o)], z0, z1)
        return outer + inner + front
    return tool(+1), tool(-1)


def skin():
    """{name: manifold} of the four walnut pieces, from p4's shell (top screws, labels, knob hole, USB-C opening kept)"""
    sh = V.shell2()
    if p4.TOP_SCREWS:
        sh = sh - p4.shell_top_screw_cuts()
    if p4.LABELS:
        sh = sh - p4.label_cuts()
    sh = sh - knob_hole_tool()
    big = 400
    mid = box(-SEAM, SEAM, -5, D + 5, -5, H + 5)
    pieces = dict(plank_top=sh ^ mid ^ box(-big, big, -5, D + 5, ZC, H + 5),
                  plank_bottom=sh ^ mid ^ box(-big, big, -5, D + 5, -5, ZC),
                  cap_left=sh ^ box(-big, -SEAM, -5, D + 5, -5, H + 5),
                  cap_right=sh ^ box(SEAM, big, -5, D + 5, -5, H + 5))
    for sx, cap in ((-1, 'cap_left'), (1, 'cap_right')):
        for sz, plank in ((1, 'plank_top'), (-1, 'plank_bottom')):
            t_plank, t_cap = seam_cut(sx, sz)
            pieces[plank] = pieces[plank] - t_plank
            pieces[cap] = pieces[cap] - t_cap
    holes_top = Manifold.batch_boolean([cyl_z(x, y, H - WALL - 2, H + 2, SKIN_CL_D) for x, y in PLANK_SCREWS], ADD)
    holes_bot = Manifold.batch_boolean([cyl_z(x, y, -2, WALL + 2, SKIN_CL_D) for x, y in PLANK_SCREWS], ADD)
    pieces['plank_top'] = pieces['plank_top'] - holes_top
    pieces['plank_bottom'] = pieces['plank_bottom'] - holes_bot
    for sx, cap in ((-1, 'cap_left'), (1, 'cap_right')):
        x0, x1 = sorted((sx * (W / 2 - WALL - 2), sx * (W / 2 + 2)))
        pieces[cap] = pieces[cap] - Manifold.batch_boolean([cyl_x(y, z, x0, x1, SKIN_CL_D) for y, z in CAP_SCREWS], ADD)
    return pieces


# ---------------------------------------------------------------- chassis
def boss_wall(x, y, sz):
    """a screw boss inside the top (sz +1) or bottom (sz -1) wall at (x, y): square, BOSS_H proud, a 45 deg ramp toward
    the back so it prints back-down without an overhang"""
    zw = ZIN1 if sz > 0 else ZIN0                 # the wall's inner face
    z_in, z_out = zw - sz * BOSS_H, zw + sz * 0.5
    b, h = BOSS / 2, BOSS_H
    return along_x([(y - b, z_out), (y + b + h + 0.5, z_out), (y + b, z_in), (y - b, z_in)], x - b, x + b)      # the ramp runs on into the wall


def boss_end(y, z, sx):
    """the same inside an end wall"""
    xi = sx * XIN
    x_in, x_out = xi - sx * BOSS_H, xi + sx * 0.5
    b, h = BOSS / 2, BOSS_H
    return along_z([(x_out, y - b), (x_out, y + b + h + 0.5), (x_in, y + b), (x_in, y - b)], z - b, z + b)


def thread_z(x, y, sz):
    """pilot (or insert hole from the screw's side, then pilot) through a top / bottom wall and its boss"""
    zo, zend = (ZO1, ZIN1 - BOSS_H - 1) if sz > 0 else (ZO0, ZIN0 + BOSS_H + 1)
    cut = cyl_z(x, y, min(zo, zend) - 0.01, max(zo, zend) + 0.01, PILOT_H, 32)
    if INSERTS:
        a, b = sorted((zo + sz * 0.01, zo - sz * INSERT_L))
        cut = cut + cyl_z(x, y, a, b, INSERT_D, 32)
    return cut


def thread_x(y, z, sx):
    xo, xend = sx * (XIN + DR.TRAY_WT), sx * (XIN - BOSS_H - 1)
    cut = cyl_x(y, z, min(xo, xend) - 0.01, max(xo, xend) + 0.01, PILOT_H, 32)
    if INSERTS:
        a, b = sorted((xo + sx * 0.01, xo - sx * INSERT_L))
        cut = cut + cyl_x(y, z, a, b, INSERT_D, 32)
    return cut


def insert_xz():
    """all six panel inserts, panel turned 180 deg, in case (x, z)"""
    return [(x, ZC + z) for x, z in DR.INSERTS]


def standoff_bosses():
    """(cuts, adds, holes): each V5 post tube becomes a solid boss from the back plate forward to the standoff's end
    (same diameter, so what was tube is filled); the tube in front of it is cut away; a clearance hole for the screw
    from the back"""
    xz = insert_xz()
    cuts = [cyl_y(x, z, PB - 12, BOSS_Y - 0.01, DR.POST_OD + 0.6, 64) for x, z in xz]
    adds = [cyl_y(x, z, BOSS_Y, YB1, DR.POST_OD, 64) for x, z in xz]
    holes = [cyl_y(x, z, BOSS_Y - 1, YB1 + 1, 3.4, 32) for x, z in xz]
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return u(cuts), u(adds), u(holes)


RUNG_XS = (-118.0, -90.0, -62.0, -34.0, 52.0, 78.0, 104.0, 124.0)
RUNG_W, RUNG_Z, RUNG_Y = 4.0, 18.0, 5.0


def rungs(avoid):
    """ties across the louver bands: a 4 mm pillar from each wall down the back plate past the three louver rows,
    5 mm proud inside. Dropped where one would foul what the tray carries (avoid: a manifold of envelopes)."""
    out, used = [], []
    for sz in (1, -1):
        for x in RUNG_XS:
            z0, z1 = sorted((ZIN1 + 0.3, ZIN1 - RUNG_Z)) if sz > 0 else sorted((ZIN0 - 0.3, ZIN0 + RUNG_Z))
            r = box(x - RUNG_W / 2, x + RUNG_W / 2, YB0 - RUNG_Y, YB1, z0, z1)
            if (r ^ avoid).volume() < 0.01:
                out.append(r); used.append((x, sz))
    return Manifold.batch_boolean(out, ADD), used


NECK_R = 9.5                     # the tower above the walnut: narrower, so the trim ring keeps 2.7 mm round the screw holes
PIX_RELIEF = 1.5                 # a blind pocket in the top wall over the front of the encoder board, where V5's tray had an
                                 # open slot: the board's NeoPixel stands there (2.4 mm of headroom; 1.0 mm of wall left)


def tower_cs(r):
    """a circle on the knob axis with a 45 deg wedge toward the back: the tower prints sticking out sideways"""
    a = r * math.cos(math.pi / 4)
    return CrossSection.circle(r, 96).translate([0, KY]) + ccw([(a, KY + a), (0, KY + r * math.sqrt(2)), (-a, KY + a)])


def tower():
    """the encoder's seat on the chassis: the V5 collar's plug and deck, made part of the top wall. The plug fills the
    walnut's knob hole (CO.CL clear); above the walnut a narrower neck stands FL_T proud, so the bushing, nut and knob
    sit exactly as on V5. The pocket's roof is a truncated teardrop toward the front (the print's up). The tray's
    encoder slot is closed: the encoder goes up into the pocket from inside. Returns (adds, cuts), case frame."""
    z_top = H + CO.FL_T
    body = Manifold.extrude(tower_cs(V.ENC_HOLE / 2 - CO.CL), H - ZIN1).translate([0, 0, ZIN1]) \
        + Manifold.extrude(tower_cs(NECK_R), CO.FL_T + 0.01).translate([0, 0, H - 0.01])
    fill = box(-DR.ENC_SLOT - 0.5, DR.ENC_SLOT + 0.5, DR.YF + 0.6, KY + DR.ENC_HALF + 2.0, ZIN1, ZO1)
    pocket = Manifold.extrude(V.teardrop_cs(CO.POCKET_R, 0, KY, trunc=CO.POCKET_R + 0.25, seg=96), H + CO.DECK_BOT - (ZIN1 - 1)).translate([0, 0, ZIN1 - 1])
    bush = cyl_z(0, KY, ZIN1 - 1, z_top + 1, 2 * CO.BUSH_R, 64)
    relief = cyl_z(0, KY, H + CO.DECK_BOT - 0.1, H + CO.RELIEF_TOP, 2 * CO.RELIEF_R, 64)
    cuts = pocket + bush + relief + box(-DR.ENC_SLOT, DR.ENC_SLOT, KY - 13.2, KY - 9.0, ZIN1 - 1, ZIN1 + PIX_RELIEF)
    return body + fill, cuts


def trim_ring():
    """the V5 collar's flange alone: a ring on the walnut round the tower's neck, held by the two screws beside the knob.
    It covers the knob hole's clearance and both of its printing points."""
    R = CO.FL_R * p4.KNOB_SCALE
    fl = CO.cyl(R, 0, CO.FL_T - CO.FL_CH) + CO.cyl(R, CO.FL_T - CO.FL_CH, CO.FL_T, R - CO.FL_CH)
    ring = fl - Manifold.extrude(tower_cs(NECK_R + 0.2).translate([0, -KY]), CO.FL_T + 2).translate([0, 0, -1])
    if p4.TOP_SCREWS:
        ring = ring - p4.collar_top_screw_cuts()
    return ring.translate([0, KY, H])


def pixel():
    """the encoder's NeoPixel, for the renders and checks: 2 mm square on the board at the front, as the build notes
    place it (not measured)"""
    import sensor as SN
    return box(-1.0, 1.0, KY - 11.6, KY - 9.6, SN.EB_TOP, SN.EB_TOP + 0.9)


# the chassis joint. Everything on it slides together along x, and prints back-down without support.
LEG_Y0, LEG_Y1 = 34.0, 64.0                               # the wall tongues: behind the panel, in front of the louver band
LEG_SCREW_Y = (38.0, 47.0)                                # M3 x 8 countersunk through the right half's walls, heads under the planks
LEG_ROOT_X = 10.0                                         # how far back into the left half the tongues are rooted
ENC_KEEP = (21.5, 59.6)                                   # the top tongue's root stays right of x, or behind y: the encoder
KNUCKLE_Z = (ZC + 21.0, ZC + 41.0)                        # back-plate knuckles: above the ribbon, below the top louvers
KN_BLOCK, KN_HZ, KN_PIER = 9.0, 6.0, 4.0                  # the left half's block: reach past the joint, half height; the right's piers
KN_Y0, KN_Y1 = 56.0, 64.0                                 # the right half's bridge over the block: its front face, the block's top
KN_CL = 0.2


def tongue_legs():
    """the left half's lap tongues inside the right half's top and bottom walls: plates TONGUE_T thick, TONGUE_CL clear,
    their back edge at 45 deg (the print's underside), rooted in the left half's wall. Each takes two countersunk screws
    through the right half's wall. Returns (adds, cuts in the tongue, cuts in the right half)."""
    cl, t = TONGUE_CL, TONGUE_T
    x0, x1 = JOINT_X, JOINT_X + TONGUE
    xm = JOINT_X + TONGUE / 2
    adds, cut_t, cut_r = [], [], []
    for sz in (1, -1):
        zw = ZIN1 if sz > 0 else ZIN0                      # the wall's inner face
        za, zb = zw - sz * cl, zw - sz * (cl + t)          # the tongue's outer and inner face
        lap = [(x0 - 0.01, LEG_Y0), (x1, LEG_Y0), (x1, LEG_Y1 - TONGUE), (x0 - 0.01, LEG_Y1)]
        if sz > 0:
            root = [(ENC_KEEP[0], LEG_Y0), (x0, LEG_Y0), (x0, LEG_Y1 + 0.2), (LEG_ROOT_X, LEG_Y1 + 0.2), (LEG_ROOT_X, ENC_KEEP[1]), (ENC_KEEP[0], ENC_KEEP[1])]
        else:
            root = [(LEG_ROOT_X, LEG_Y0), (x0, LEG_Y0), (x0, LEG_Y1 + 0.2), (LEG_ROOT_X, LEG_Y1 + 0.2)]
        adds.append(along_z(lap, *sorted((za, zb))))
        adds.append(along_z(root, *sorted((zw + sz * 0.01, zb))))
        for y in LEG_SCREW_Y:
            b = BOSS / 2
            adds.append(along_x([(y - b, zb + sz * 0.5), (y + b + 4.0, zb + sz * 0.5), (y + b, zb - sz * 3.5), (y - b, zb - sz * 3.5)], xm - b, xm + b))
            cut_t.append(cyl_z(xm, y, *sorted((zb - sz * 4.5, za + sz * 0.01)), PILOT_H, 32))
            zo = zw + sz * DR.TRAY_WT
            cut_r.append(cyl_z(xm, y, *sorted((zw - sz * 1.0, zo + sz * 1.0)), 3.4, 32))
            cs = Manifold.cylinder(1.71, 3.4 / 2, p4.CSK_D / 2, 48)        # 90 deg countersink, wide end out
            cut_r.append(cs.translate([xm, y, zo - 1.7]) if sz > 0 else cs.mirror([0, 0, 1]).translate([xm, y, zo + 1.7]))
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return u(adds), u(cut_t), u(cut_r)


def knuckles():
    """the joint at the back plate. A flat tongue there would print as a shelf 2 mm above the bed, so: the left half's
    back plate carries blocks that reach KN_BLOCK past the joint, on the bed; the right half's plate is notched for each
    and bridges over it between two piers (a 12 mm bridge). One M3 from the back through each block into the bridge.
    Returns (left adds, left cuts, right adds, right cuts)."""
    la, lc, ra, rc = [], [], [], []
    xs = JOINT_X + KN_BLOCK / 2 + 0.3
    for zc in KNUCKLE_Z:
        la.append(box(JOINT_X - 8.0, JOINT_X + KN_BLOCK, KN_Y1, YB1, zc - KN_HZ, zc + KN_HZ))
        lc.append(cyl_y(xs, zc, KN_Y1 - 1, YB1 + 1, 3.4, 32))
        z0, z1 = zc - KN_HZ - KN_CL, zc + KN_HZ + KN_CL
        cav = box(JOINT_X - 0.01, JOINT_X + KN_BLOCK + KN_CL, KN_Y1 - KN_CL, YB1 + 0.01, z0, z1)
        ra.append(box(JOINT_X + KN_CL, JOINT_X + KN_BLOCK + KN_CL + 2.0, KN_Y0, YB0 + 0.01, z0 - KN_PIER, z1 + KN_PIER) - cav)
        rc.append(cav)
        rc.append(cyl_y(xs, zc, KN_Y0 - 1, KN_Y1, PILOT_V, 32))
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return u(la), u(lc), u(ra), u(rc)


def chassis():
    """(left, right, info)"""
    t = DR.tray(ribbon_hooks=[(p4.HOOK_X, p4.RIB_Z), (p4.HOOK2_X, p4.IDC_Z)], hook_lip=p4.RIB_HOOK_LIP, tie_x0=JOINT_X + TONGUE + 4.0)
    if p4.TOP_SCREWS:
        adds, cuts = p4.tray_top_bosses()
        t = (t + adds) - cuts
    # no crush ribs; the front edge clear of the diffuser's flange, which now sits RIM_GAP further back
    t = t ^ C.prism_y(C.rr_cs(C.BORE_HX - DR.TRAY_CL, C.BORE_HZ - DR.TRAY_CL, C.BORE_R - DR.TRAY_CL), 0, D)
    t = t - box(-400, 400, 0, DR.YF + 2 * RIM_GAP, -5, H + 5)
    # panel: standoff bosses for post tubes
    tubes, bosses, holes = standoff_bosses()
    t = (t - tubes) + bosses
    # skin screw bosses
    adds = [boss_wall(x, y, sz) for sz in (1, -1) for x, y in PLANK_SCREWS] + [boss_end(y, z, sx) for sx in (-1, 1) for y, z in CAP_SCREWS]
    t = t + Manifold.batch_boolean(adds, ADD)
    # louver ties
    avoid = DR.s3_envelope() + DR.sensor_envelope() + p4.encoder_envelope() + panel_v6() + standoffs()
    rg, used = rungs(avoid)
    t = t + rg
    # encoder tower
    tw_add, tw_cut = tower()
    t = (t + tw_add) - tw_cut
    # threads
    cuts = [thread_z(x, y, sz) for sz in (1, -1) for x, y in PLANK_SCREWS] + [thread_x(y, z, sx) for sx in (-1, 1) for y, z in CAP_SCREWS]
    t = t - Manifold.batch_boolean(cuts, ADD) - holes
    # the split, off centre, with the lap tongue
    left = t ^ box(-400, JOINT_X, -5, D + 5, -5, H + 5)
    right = t ^ box(JOINT_X, 400, -5, D + 5, -5, H + 5)
    tg_add, tg_cut, r_cut = tongue_legs()
    kl_add, kl_cut, kr_add, kr_cut = knuckles()
    hit = ((tg_add + kl_add) ^ (right - kr_cut)).volume()          # what the right half already had where the joint goes
    lost = ((kr_add - right) ^ (DR.s3_envelope() + DR.sensor_envelope())).volume()
    left = (left + tg_add + kl_add) - tg_cut - kl_cut
    right = ((right - kr_cut) + kr_add) - r_cut - kr_cut
    return left, right, dict(rungs=len(used), joint_meets_right_half_mm3=round(hit, 2), knuckles_meet_s3_sensor_mm3=round(lost, 2))


# ---------------------------------------------------------------- what goes inside (for checks and renders)
def panel_v6():
    return p4.panel_p4().translate([0, RIM_GAP, 0])


def diffuser_v6():
    d = p4.diffuser_halves()
    return {k: p4.diffuser_in_case(v).translate([0, RIM_GAP, 0]) for k, v in d.items()}


def standoffs():
    out = []
    for x, z in insert_xz():
        hexa = Manifold.cylinder(STANDOFF_L, STANDOFF_AF / math.sqrt(3), STANDOFF_AF / math.sqrt(3), 6).rotate([-90, 0, 0]).translate([x, PB, z])
        out.append(hexa)
    return Manifold.batch_boolean(out, ADD)


def screws():
    """every screw seated, as one manifold per group: skin (black button heads), back (panel and joint), under the planks"""
    skin_s, back_s, hid = [], [], []
    for x, y in PLANK_SCREWS:
        skin_s.append(cyl_z(x, y, H - 9.5, H, 3.0, 24) + cyl_z(x, y, H, H + HEAD_K, HEAD_D, 32))
        hid.append(cyl_z(x, y, 0, 9.5, 3.0, 24) + cyl_z(x, y, -HEAD_K, 0, HEAD_D, 32))
    for sx in (-1, 1):
        for y, z in CAP_SCREWS:
            a, b = sorted((sx * (W / 2 - 9.5), sx * W / 2)); c, e = sorted((sx * W / 2, sx * (W / 2 + HEAD_K)))
            skin_s.append(cyl_x(y, z, a, b, 3.0, 24) + cyl_x(y, z, c, e, HEAD_D, 32))
    for x, z in insert_xz():
        back_s.append(cyl_y(x, z, YB1 - 11.5, YB1, 3.0, 24) + cyl_y(x, z, YB1, YB1 + HEAD_K, HEAD_D, 32))
    xs = JOINT_X + KN_BLOCK / 2 + 0.3
    for z in KNUCKLE_Z:
        back_s.append(cyl_y(xs, z, YB1 - 11.5, YB1, 3.0, 24) + cyl_y(xs, z, YB1, YB1 + HEAD_K, HEAD_D, 32))
    xm = JOINT_X + TONGUE / 2
    for y in LEG_SCREW_Y:
        hid.append(cyl_z(xm, y, ZO1 - 8.0, ZO1, 3.0, 24) + cyl_z(xm, y, ZO0, ZO0 + 8.0, 3.0, 24))
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return dict(skin=u(skin_s), back=u(back_s), under=u(hid))


def build():
    left, right, info = chassis()
    return dict(skin=skin(), chassis_left=left, chassis_right=right, info=info, panel=panel_v6(), diffuser=diffuser_v6(),
                standoffs=standoffs(), screws=screws(), ring=trim_ring(), knob=p4.knob_in_case(),
                encoder=p4.encoder_envelope(), s3=DR.s3_envelope(), sensor=DR.sensor_envelope())


def check(P):
    """overlap volumes (mm3) that should be zero, and what each skin piece meets as it comes on"""
    v = lambda a, b: round((a ^ b).volume(), 2)
    ch = P['chassis_left'] + P['chassis_right']
    sk = Manifold.batch_boolean(list(P['skin'].values()), ADD)
    dif = Manifold.batch_boolean(list(P['diffuser'].values()), ADD)
    rows = [('chassis halves, each other', v(P['chassis_left'], P['chassis_right'])),
            ('skin / chassis', v(sk, ch)),
            ('skin pieces, each other', round(sum((a ^ b).volume() for i, a in enumerate(P['skin'].values()) for b in list(P['skin'].values())[i + 1:]), 2)),
            ('chassis / panel', v(ch, P['panel'])), ('chassis / diffuser', v(ch, dif)), ('skin / diffuser', v(sk, dif)),
            ('chassis / standoffs', v(ch, P['standoffs'])), ('chassis / S3, beyond the V5 tray (its posts stand in the envelope)', round(v(ch, P['s3']) - v(p4.tray_p4(), P['s3']), 2)), ('chassis / sensor', v(ch, P['sensor'])),
            ('chassis / encoder', v(ch, P['encoder'])), ('ring / skin', v(P['ring'], sk)), ('ring / chassis', v(P['ring'], ch)), ('ring / encoder', v(P['ring'], P['encoder'])), ('chassis / pixel', v(ch, pixel())),
            ('standoffs / encoder, S3, sensor', v(P['standoffs'], P['encoder'] + P['s3'] + P['sensor'])),
            ('skin screws / panel, diffuser, S3, sensor, encoder', v(P['screws']['skin'] + P['screws']['under'], P['panel'] + dif + P['s3'] + P['sensor'] + P['encoder']))]
    rest = ch + dif + P['panel']
    for name, d in (('plank_top', (0, 0, 1)), ('plank_bottom', (0, 0, -1)), ('cap_left', (-1, 0, 0)), ('cap_right', (1, 0, 0))):
        worst = max((P['skin'][name].translate([d[0] * s, d[1] * s, d[2] * s]) ^ rest).volume() for s in (0.5, 1, 2, 4, 8, 16))
        rows.append((f'{name} lifted straight off (0.5-16 mm), vs chassis, diffuser, panel', round(worst, 2)))
    return rows


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    P = build()
    def save(m, name, bed='back'):
        """back: the case's back on the bed, as every V5 part; top: turned over, the top face on the bed"""
        m = m.rotate([-90, 0, 0]) if bed == 'back' else m.mirror([0, 0, 1])
        me = m.to_mesh()
        t = trimesh.Trimesh(vertices=np.asarray(me.vert_properties)[:, :3], faces=np.asarray(me.tri_verts)); t.merge_vertices()
        t.apply_translation([-(t.bounds[0][0] + t.bounds[1][0]) / 2, -(t.bounds[0][1] + t.bounds[1][1]) / 2, -t.bounds[0][2]])
        t.export(f'{out}/{name}.stl')
        return f'{name}: {np.round(t.extents, 1).tolist()} on the bed, {m.volume() / 1000:.1f} cm3, {len(t.split(only_watertight=False))} body'
    for k, m in P['skin'].items():
        print(save(m, f'v6-skin-{k.replace("_", "-")}-walnut'))
    print(save(P['chassis_left'], 'v6-chassis-left')); print(save(P['chassis_right'], 'v6-chassis-right')); print(save(P['ring'], 'v6-trim-ring', 'top'))
    print('info', P['info'])
    for name, val in check(P):
        print(f'  {"ok  " if val < 0.05 else "HIT "} {name}: {val}')
