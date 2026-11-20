"""V6 case, draft 3 (Nov 16, 2026): the P4 case as a rigid PETG chassis with a two-half walnut skin. No glue. Units mm.

    python3 v6.py <out dir>          # the parts in print orientation (not released print files) and the checks
    V6_SKIN=four python3 v6.py ...   # the four-piece skin of draft 2 (planks and end caps), kept for comparison

Why: the first full P4 build (v5: p4.py) had walls that press in, a tray that creaks under the knob, light bleed at the
diffuser's edges, a fiddly glue-up and a diffuser that is seated blind. The owner would rather have no glue. Draft 2 cut
the walnut in four (planks, end caps); an independent review (Nov 16) found the chassis right and the four pieces the
complication, and that two halves work once the seam is a line that is meant to be there. See DESIGN-HISTORY.md.

What it is, in terms of the parts it is built from (every proven fit is kept):
- **Chassis** = p4v55.tray(), the reviewed "V5.5" tray: hidden louver ties, the split 24 mm right of centre with a
  tongue-and-knuckle joint, the V5 panel posts with their feet moved back for M3 x 30 standoffs in all six inserts.
  Here it loses its crush ribs and gains: contact pads under the walnut (pads(): top, bottom and end walls); a boss for
  each skin screw; an encoder tower in the top wall (tower()), so the knob's seat is PETG; a washer under each
  standoff; heat-set inserts (M3 x D5 x L4) wherever a screw threads into it from outside: skin, joint, cleat.
- **Skin** = p4's walnut shell cut at mid height into a top and a bottom half (skin_two()), SKIN_GAP apart: a line
  round each end, nothing to close, so the print's height error only changes the line's width. The top half's inner
  1.9 mm laps 3 mm down behind the bottom half on both ends, so there is walnut behind the whole line. Eight black
  M3 x 10 flanged button heads, all at the knob's depth: one at each end of the top and of the bottom, two on each
  end. The holes in the walnut are 1 mm long front to back so each half is set against the diffuser by eye. Underneath,
  the heads sit in 1 mm counterbores and the bumpers' recesses are FOOT_IN inboard of them. The two V5 screws under
  the case are left out (UNDER_SCREWS); their holes stay.
- **Panel, diffuser, knob**: p4's. The diffuser rides on the panel RIM_GAP behind the rim, which covers its border
  without clamping it. The collar becomes a trim ring whose cap lies over the tower's top under the encoder's nut.
- **Wall hanging**: the cleat (cleat.py, with p4.py's settings of Nov 17: a 60 deg bevel for about 17 mm of hook, stops on
  the wall cleat outside the case cleat's ends, two wall screws) on two inserts in the back plate, one in each chassis
  half. The joint's screws on the back are countersunk flush; the case cleat lies over the upper two, so it comes off
  before the halves are parted.
- **Build order**: ALL inserts in while the halves are apart (the knuckles' from under their bridges, the tongues'
  flush: 0.15 mm to the other half, whose wall covers them once joined; skin, cleat). NONE in the six panel posts:
  their 4.5 mm holes are clearance for the M3 x 8, and an insert there would take the panel's float away. Halves
  joined, seven countersunk screws. S3, sensor sled and its outside screw, encoder up into the tower with its nut on
  finger-tight (loose, it can drop onto the top-centre standoff), cables. A washer in each post's recess; the chassis
  face up on blocks, so the back screws can be reached from below; panel (standoffs on, each hex seated on its insert)
  lowered in, six flanged M3 x 8 from the back, snug. Diffuser pressed on, centred, and lit. Bottom walnut half on
  from below, top half from above, four screws each (snug: the end screws close 0.1-0.25 mm of air). Panel centred in
  the rim by eye and its screws tightened from the back. Nut off, ring on, nut, the two M2.5 (snug), knob. The case
  cleat last: it lies over the top-centre panel screw. Service: the panel comes out only with the knob, ring, both
  halves and diffuser off; the S3 with the panel out.

check() covers overlaps, each half's way on with the other fitted, the line and the lap (shut, shifted, what is behind
it), every screw's hole, the chassis halves' slide, the panel's way in, cables (p4_cables) and the cleat.
Not print-tested. Smaller cases (P3, P2.5) keep their one-piece sleeve and take only the tray's improvements.
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
WASHER_T = 0.5                   # an M3 washer between each standoff and its post: the hex alone laps the 4.5 mm hole by 0.25-0.5
SKIN_CL_D = 3.4                  # M3 clearance through the walnut
SKIN_SLOT = 0.5                  # and the holes are this much longer front and back: each piece is set against the diffuser by eye
PILOT_H = 3.0                    # M3 thread-forming pilot (kept for the T1 coupon script)
# Heat-set inserts everywhere a screw threads into the chassis from outside (the owner, Nov 15: M3 x D5 x L4, brass).
# Printed pilots proved a 0.1 mm window: 3.1 passed on the Nov 3 plate and would not start on the built tray.
INS_D, INS_DEPTH, INS_RELIEF = 4.4, 5.0, 3.2   # the hole (to confirm on the joint coupon), its depth, room past it for the screw's tip
# V6_FASTEN=tap: no inserts, for prototypes (the owner, Nov 19: "a no-insert version for now ... until final design"). Every
# screw that would meet an insert cuts its own thread in a printed pilot instead: drawer.TAP_D (3.0) where the hole lies
# flat in the print (skin, tongue, under the case), drawer.TAP_D_V (3.1) with a guide bore where it stands upright
# (knuckles, cleat). Same parts, same screws, same positions; the threads wear after a few assemblies and strip if forced.
FASTEN = os.environ.get('V6_FASTEN', 'insert')
BOSS, BOSS_H = 8.0, 3.5          # screw bosses on the chassis walls: square, with a 45 deg ramp on the back (bed) side
HEAD_D, HEAD_K = 6.9, 1.65       # M3 flanged button head (ISO 7380-2): a plain 5.7 head bears on only 13 mm2 round the long hole
FOOT_IN = 16.0                   # the bumpers' recesses, this far inboard of the plank screws (V5's were where the screws are now)
UNDER_SCREWS = False             # the two V5 screws under the case are left out (the skin is held at both ends); their holes
                                 # stay in the walnut and the chassis, for two M3 x 10 and inserts if the bottom ever buzzes
UNDER_CB = 7.6                   # counterbore for a flanged head (6.9) at the two screws under the case
PAD_H = 0.24                     # contact pads under the planks, as tall as the 0.25 gap: the walnut bears along its length, not
                                 # only at the screws (0.2 left 0.05 of air, which no print holds; a high pad only bows a plank a hair)
PAD_W = 4.0
RING_CAP = 0.4                   # the trim ring reaches over the tower's top under the encoder's nut, which is what holds it
RING_LIFT = 0.4                  # and its flange stands this far off the walnut: at 0 a plank printed 0.05 thick took the nut's clamp
WASHER_REC = (7.4, 0.3)          # a recess in each post's foot that holds its washer while the panel is lowered in

# skin screws, lined up (the owner: the staggered ones "look awful"). Planks: a front and a back one at each end, the same
# distance from the seam. End caps: two in a vertical line at the knob's depth.
XE = SEAM - 12.0
# The skin. 'two' (Nov 16, after the simplification review): p4's two shell halves, top and bottom, with a line of
# SKIN_GAP left between them on each end and bezel side: nothing has to close, so the print's height error only changes
# the line's width. One screw at each end of the top and of the bottom and two on each end, all at the knob's depth.
# 'four' (V6_SKIN=four): planks and end caps, as reviewed Nov 15-16.
SKIN = os.environ.get('V6_SKIN', 'two')
SKIN_GAP = float(os.environ.get('V6_SKIN_GAP', '0.7'))    # the line. 0.6 left 0.09 at the worst height stack (the Nov 16 check: it
                                 # closes at 0.51 drawn); to be set from the end coupon: drawn + what the print adds
LAP_T, LAP_H = 1.9, 3.0          # the top half's inner LAP_T (of the 4 mm wall) reaches LAP_H down behind the bottom half's outer
                                 # 1.7, on both ends, front to back: walnut behind the whole line (as first drawn the lap was
                                 # only at the hood's cheeks, and the line showed walnut, the diffuser's edge, black chassis and,
                                 # behind the back plate, daylight). It runs the print's whole height: no overhang.
LAP_END = 2.0
LAP_CL_X, LAP_CL_Z = 0.4, SKIN_GAP + 0.1   # room round the lap: the halves can shift 0.3 on the pads' play, and the lap must
                                 # never land before the line closes (0.3 under it did, at 0.31 of closure)
PAD_H_END = 0.15                 # pads on the end walls under the halves' legs: the legs slide down past them
PLANK_SCREWS = tuple((sx * XE, y) for sx in (-1, 1) for y in ((KY,) if SKIN == 'two' else (30.0, 60.0)))
CAP_SCREWS = ((KY, ZC + 50.0), (KY, ZC - 50.0))            # (y, z) on each end face; z +/-50 clears the S3 and its window

# chassis numbers taken from the tray
XIN = C.BORE_HX - DR.TRAY_CL - DR.TRAY_WT                 # inner half width (134.15)
HZ = C.BORE_HZ - DR.TRAY_CL - DR.TRAY_WT                  # inner half height (70.15)
RIN = C.BORE_R - DR.TRAY_CL - DR.TRAY_WT
ZIN0, ZIN1 = ZC - HZ, ZC + HZ                              # bottom / top wall, inner faces
ZO0, ZO1 = ZIN0 - DR.TRAY_WT, ZIN1 + DR.TRAY_WT            # outer faces
YB0, YB1 = DR.Y0, DR.Y1                                    # back plate: inner, outer face (67, 69)
PB = p4.PANEL_BACK - p4.PANEL_THIN + RIM_GAP + (p4.DF.GRID_H - 1.5) + (p4.DF.SKIN - 0.2)    # the panel housing's back in V6
BOSS_Y = PB + STANDOFF_L + WASHER_T                        # the posts' feet: a standoff and its washer behind the panel


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
    feet = V.FEET
    V.FEET = [(math.copysign(XE - FOOT_IN, fx), fy) for fx, fy in feet]     # the bumpers, inboard of the plank screws
    try:
        sh = V.shell2()
    finally:
        V.FEET = feet
    f = V.SCREW_FLOAT                                                       # the two screws under the case: V5's counterbore
    sh = sh - Manifold.batch_boolean([Manifold.extrude((V.teardrop_cs(UNDER_CB / 2, sx * x, V.SCREW_Y - f, seg=48)   # (6.4) left a
                                                        + V.teardrop_cs(UNDER_CB / 2, sx * x, V.SCREW_Y + f, seg=48)).hull(), 2.0).translate([0, 0, -1])   # flanged head 0.25 a side
                                      for sx in (-1, 1) for x in V.SCREW_XS], ADD)
    if p4.TOP_SCREWS:
        sh = sh - p4.shell_top_screw_cuts()
    if p4.LABELS:
        sh = sh - p4.label_cuts()
    sh = sh - knob_hole_tool()
    big = 400
    if SKIN == 'two':
        return skin_two(sh)
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
    slot_z = lambda x, y, z0, z1: (cyl_z(x, y - SKIN_SLOT, z0, z1, SKIN_CL_D) + cyl_z(x, y + SKIN_SLOT, z0, z1, SKIN_CL_D)).hull()
    holes_top = Manifold.batch_boolean([slot_z(x, y, H - WALL - 2, H + 2) for x, y in PLANK_SCREWS], ADD)
    holes_bot = Manifold.batch_boolean([slot_z(x, y, -2, WALL + 2) for x, y in PLANK_SCREWS], ADD)
    pieces['plank_top'] = pieces['plank_top'] - holes_top
    pieces['plank_bottom'] = pieces['plank_bottom'] - holes_bot
    # underneath, the heads sit in counterbores 1 mm deep as the two V5 screws do: a head standing its full 1.7-2 mm proud
    # would reach the table with the bumpers (2 mm proud)
    pieces['plank_bottom'] = pieces['plank_bottom'] - Manifold.batch_boolean(
        [Manifold.extrude((V.teardrop_cs(UNDER_CB / 2, x, y - SKIN_SLOT, seg=48) + V.teardrop_cs(UNDER_CB / 2, x, y + SKIN_SLOT, seg=48)).hull(), 2.0).translate([0, 0, -1])
         for x, y in PLANK_SCREWS], ADD)
    for sx, cap in ((-1, 'cap_left'), (1, 'cap_right')):
        x0, x1 = sorted((sx * (W / 2 - WALL - 2), sx * (W / 2 + 2)))
        pieces[cap] = pieces[cap] - Manifold.batch_boolean([(cyl_x(y - SKIN_SLOT, z, x0, x1, SKIN_CL_D) + cyl_x(y + SKIN_SLOT, z, x0, x1, SKIN_CL_D)).hull() for y, z in CAP_SCREWS], ADD)
    return pieces


def skin_two(sh):
    """half_top and half_bottom from the whole shell: split at mid height with SKIN_GAP between, lapped at the hood's
    ends, front to back. Each lowers (rises) straight onto the chassis; the top wall bears on the pads and the legs lie
    on the end walls' pads."""
    g = SKIN_GAP / 2
    top = sh ^ box(-400, 400, -5, D + 5, ZC + g, H + 5)
    bot = sh ^ box(-400, 400, -5, D + 5, -5, ZC - g)
    y0, y1 = bot.bounding_box()[1] + LAP_END, D - LAP_END
    for sx in (-1, 1):                                        # the lap takes the screen rim's end with it: cut at the line, the
        a, b = sorted((sx * (W / 2 - WALL - 14), sx * (W / 2 - WALL + LAP_T)))     # bottom half's rim would end in a nub with no root
        # it stops LAP_END short of the wall's front and back edges, where it would show end-on as a step in the line;
        # its back end is a 45 deg ramp (the halves print back-down: it would start in mid-air)
        # its front end is ramped too, and the notch's with it: square, the notch's front end was a 2.3 x 3.5 mm ceiling
        # over nothing in the bottom half's print (the final review, Nov 19)
        top = top + (sh ^ along_x([(y0, ZC + g + 0.02), (y1, ZC + g + 0.02), (y1 - LAP_H, ZC - LAP_H), (y0 + LAP_H + g, ZC - LAP_H)], a, b))
        a, b = sorted((sx * (W / 2 - WALL - 14), sx * (W / 2 - WALL + LAP_T + LAP_CL_X)))
        zf = ZC - LAP_H - LAP_CL_Z
        bot = bot - along_x([(y0 - 1.4, ZC + 1), (y1 + 0.4, ZC + 1), (y1 + 0.4, zf), (y0 - 0.4 + (ZC - zf), zf)], a, b)
    slot_z = lambda x, y, z0, z1: (cyl_z(x, y - SKIN_SLOT, z0, z1, SKIN_CL_D) + cyl_z(x, y + SKIN_SLOT, z0, z1, SKIN_CL_D)).hull()
    top = top - Manifold.batch_boolean([slot_z(x, y, H - WALL - 2, H + 2) for x, y in PLANK_SCREWS], ADD)
    bot = bot - Manifold.batch_boolean([slot_z(x, y, -2, WALL + 2) for x, y in PLANK_SCREWS], ADD)
    bot = bot - Manifold.batch_boolean(                       # underneath, heads in 1 mm counterbores (the bumpers stand 2 mm)
        [Manifold.extrude((V.teardrop_cs(UNDER_CB / 2, x, y - SKIN_SLOT, seg=48) + V.teardrop_cs(UNDER_CB / 2, x, y + SKIN_SLOT, seg=48)).hull(), 2.0).translate([0, 0, -1])
         for x, y in PLANK_SCREWS], ADD)
    ends = lambda zs: Manifold.batch_boolean([(cyl_x(y - SKIN_SLOT, z, x0, x1, SKIN_CL_D) + cyl_x(y + SKIN_SLOT, z, x0, x1, SKIN_CL_D)).hull()
                                               for sx in (-1, 1) for x0, x1 in [sorted((sx * (W / 2 - WALL - 2), sx * (W / 2 + 2)))]
                                               for y, z in CAP_SCREWS if (z > ZC) == zs], ADD)
    return dict(half_top=top - ends(True), half_bottom=bot - ends(False))


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
    """an insert hole from the outer face of a top / bottom wall, and room past it for the screw's tip"""
    zo, zend = (ZO1, ZIN1 - BOSS_H - 1) if sz > 0 else (ZO0, ZIN0 + BOSS_H + 1)
    if FASTEN == 'tap':                                     # a pilot through wall and boss, a short lead-in at the mouth
        lead = Manifold.cylinder(DR.TAP_LEAD + 0.02, DR.TAP_D / 2, DR.TAP_D / 2 + DR.TAP_LEAD + 0.02, 32)
        lead = lead.translate([x, y, zo - DR.TAP_LEAD]) if sz > 0 else lead.mirror([0, 0, 1]).translate([x, y, zo + DR.TAP_LEAD])
        return cyl_z(x, y, min(zo, zend) - 0.01, max(zo, zend) + 0.01, DR.TAP_D, 32) + lead
    return cyl_z(x, y, min(zo, zend) - 0.01, max(zo, zend) + 0.01, INS_RELIEF, 32) + cyl_z(x, y, *sorted((zo + sz * 0.01, zo - sz * INS_DEPTH)), INS_D, 32)


def thread_x(y, z, sx):
    xo, xend = sx * (XIN + DR.TRAY_WT), sx * (XIN - BOSS_H - 1)
    if FASTEN == 'tap':
        lead = Manifold.cylinder(DR.TAP_LEAD + 0.02, DR.TAP_D / 2, DR.TAP_D / 2 + DR.TAP_LEAD + 0.02, 32).rotate([0, 90, 0])   # widens toward +x
        lead = lead.translate([xo - DR.TAP_LEAD, y, z]) if sx > 0 else lead.mirror([1, 0, 0]).translate([xo + DR.TAP_LEAD, y, z])
        return cyl_x(y, z, min(xo, xend) - 0.01, max(xo, xend) + 0.01, DR.TAP_D, 32) + lead
    return cyl_x(y, z, min(xo, xend) - 0.01, max(xo, xend) + 0.01, INS_RELIEF, 32) + cyl_x(y, z, *sorted((xo + sx * 0.01, xo - sx * INS_DEPTH)), INS_D, 32)


def insert_xz():
    """all six panel inserts, panel turned 180 deg, in case (x, z)"""
    return [(x, ZC + z) for x, z in DR.INSERTS]


def pads(t):
    """contact pads on the chassis's top and bottom, PAD_H proud in the 0.25 mm gap: strips front to back every 22 mm under
    the planks, so a pressed wall meets PETG at once. A strip is left out where the wall under it is not solid (the sensor's
    openings in the top wall). None under the end caps: a pad on the corner round stopped a cap after 0.1 mm of travel, and
    the caps have to move in to meet the plank ends."""
    gap = DR.TRAY_CL - PAD_H
    y0, y1 = DR.YF + 4.0, DR.Y0 - 4.0
    band = C.prism_y(C.rr_cs(C.BORE_HX - gap, C.BORE_HZ - gap, C.BORE_R - gap), y0, y1) \
        - C.prism_y(C.rr_cs(C.BORE_HX - DR.TRAY_CL - 0.3, C.BORE_HZ - DR.TRAY_CL - 0.3, C.BORE_R - DR.TRAY_CL - 0.3), y0 - 1, y1 + 1)
    strips = []
    for x in np.arange(-110.0, 111.0, 22.0):
        for z0, z1, half in ((ZO1 - 1.2, ZO1 - 0.2, box(-400, 400, 0, D, ZC, H + 5)), (ZO0 + 0.2, ZO0 + 1.2, box(-400, 400, 0, D, -5, ZC))):
            under = box(x - PAD_W / 2, x + PAD_W / 2, y0, y1, z0, z1)
            if (under ^ t).volume() > 0.995 * under.volume():
                strips.append(box(x - PAD_W / 2, x + PAD_W / 2, 0, D, -5, H + 5) ^ half)
    clear = Manifold.batch_boolean([box(x - 4.5, x + 4.5, y - 4.5, y + 4.5, -5, H + 5) for x, y in PLANK_SCREWS], ADD)   # no pad on an insert's mouth
    out = (band ^ Manifold.batch_boolean(strips, ADD)) - clear
    if SKIN == 'two':                                          # rows on the end walls, front to back, where the wall is solid
        ge = DR.TRAY_CL - PAD_H_END
        band_e = C.prism_y(C.rr_cs(C.BORE_HX - ge, C.BORE_HZ - ge, C.BORE_R - ge), y0, y1) \
            - C.prism_y(C.rr_cs(C.BORE_HX - DR.TRAY_CL - 0.3, C.BORE_HZ - DR.TRAY_CL - 0.3, C.BORE_R - DR.TRAY_CL - 0.3), y0 - 1, y1 + 1)
        xo, rows = C.BORE_HX - DR.TRAY_CL, []
        for sx in (-1, 1):
            for z in (ZC + 34, ZC + 14, ZC - 14, ZC - 34):
                a, b = sorted((sx * (xo - 1.2), sx * (xo - 0.2)))
                under = box(a, b, y0, y1, z - PAD_W / 2, z + PAD_W / 2)
                if (under ^ t).volume() > 0.995 * under.volume():
                    a, b = sorted((sx * (xo - 3), sx * 400))
                    rows.append(box(a, b, 0, D, z - PAD_W / 2, z + PAD_W / 2))
        if rows:
            out = out + (band_e ^ Manifold.batch_boolean(rows, ADD))
    return out


NECK_R = 9.5                     # the tower above the walnut: narrower, so the trim ring keeps 2.7 mm round the screw holes
PIX_RELIEF = 1.5                 # a blind pocket in the top wall over the front of the encoder board, where V5's tray had an
                                 # open slot: the board's NeoPixel stands there (2.4 mm of headroom; 1.0 mm of wall left)


def tower_cs(r):
    """a circle on the knob axis with a 45 deg wedge toward the back: the tower prints sticking out sideways"""
    a = r * math.cos(math.pi / 4)
    return CrossSection.circle(r, 96).translate([0, KY]) + ccw([(a, KY + a), (0, KY + r * math.sqrt(2)), (-a, KY + a)])


def tower():
    """the encoder's seat on the chassis: the V5 collar's plug and deck, made part of the top wall. The plug fills the
    walnut's knob hole (CO.CL clear); above the walnut a narrower neck stands up under the trim ring's cap. Ring cap and
    neck together are as tall as the V5 collar's flange, so the bushing, nut and knob sit exactly as on V5. The pocket's
    roof is a truncated teardrop toward the front (the print's up). The tray's encoder slot is closed: the encoder goes
    up into the pocket from inside. Returns (adds, cuts), case frame."""
    z_top = H + CO.FL_T - RING_CAP
    body = Manifold.extrude(tower_cs(V.ENC_HOLE / 2 - CO.CL), H - ZIN1).translate([0, 0, ZIN1]) \
        + Manifold.extrude(tower_cs(NECK_R), z_top - H + 0.01).translate([0, 0, H - 0.01])
    fill = box(-DR.ENC_SLOT - 0.5, DR.ENC_SLOT + 0.5, DR.YF + 0.6, KY + DR.ENC_HALF + 2.0, ZIN1, ZO1)
    pocket = Manifold.extrude(V.teardrop_cs(CO.POCKET_R, 0, KY, trunc=CO.POCKET_R + 0.25, seg=96), H + CO.DECK_BOT - (ZIN1 - 1)).translate([0, 0, ZIN1 - 1])
    bush = cyl_z(0, KY, ZIN1 - 1, z_top + 1, 2 * CO.BUSH_R, 64)
    relief = cyl_z(0, KY, H + CO.DECK_BOT - 0.1, H + CO.RELIEF_TOP, 2 * CO.RELIEF_R, 64)
    cuts = pocket + bush + relief + box(-DR.ENC_SLOT, DR.ENC_SLOT, KY - 13.2, KY - 9.0, ZIN1 - 1, ZIN1 + PIX_RELIEF)
    return body + fill, cuts


def trim_ring():
    """the V5 collar's flange, as a cap: it lies on the walnut round the tower and reaches over the tower's top, where
    the encoder's nut clamps it (drawn loose before: its screw holes are larger than the screw heads, as on V5, so the
    two screws beside the knob never held it). It covers the knob hole's clearance and both of its printing points."""
    R = CO.FL_R * p4.KNOB_SCALE
    fl = CO.cyl(R, RING_LIFT, CO.FL_T - CO.FL_CH) + CO.cyl(R, CO.FL_T - CO.FL_CH, CO.FL_T, R - CO.FL_CH)
    ring = fl - Manifold.extrude(tower_cs(NECK_R + 0.2).translate([0, -KY]), CO.FL_T - RING_CAP + 1).translate([0, 0, -1]) \
        - Manifold.cylinder(CO.FL_T + 2, CO.BUSH_R + 0.1, CO.BUSH_R + 0.1, 64).translate([0, 0, -1])
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


def tongue_legs(boss_h=3.5, insert=None):
    """the left half's lap tongues inside the right half's top and bottom walls: plates TONGUE_T thick, TONGUE_CL clear,
    their back edge at 45 deg (the print's underside), rooted in the left half's wall. Each takes two countersunk screws
    through the right half's wall. boss_h: how far each screw's boss stands off the tongue (p4v55.py: taller, so an
    M3 x 10 ends inside it). Returns (adds, cuts in the tongue, cuts in the right half)."""
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
            adds.append(along_x([(y - b, zb + sz * 0.5), (y + b + boss_h + 0.5, zb + sz * 0.5), (y + b, zb - sz * boss_h), (y - b, zb - sz * boss_h)], xm - b, xm + b))
            if insert:                      # (hole diameter, depth, relief): pressed in from the tongue's outer face before joining
                cut_t.append(cyl_z(xm, y, *sorted((zb - sz * (boss_h + 1.0), za + sz * 0.01)), insert[2], 32))
                cut_t.append(cyl_z(xm, y, *sorted((za - sz * insert[1], za + sz * 0.01)), insert[0], 32))
            else:
                cut_t.append(cyl_z(xm, y, *sorted((zb - sz * (boss_h + 1.0), za + sz * 0.01)), PILOT_H, 32))
            zo = zw + sz * DR.TRAY_WT
            cut_r.append(cyl_z(xm, y, *sorted((zw - sz * 1.0, zo + sz * 1.0)), 3.4, 32))
            cs = Manifold.cylinder(1.71, 3.4 / 2, p4.CSK_D / 2, 48)        # 90 deg countersink, wide end out
            cut_r.append(cs.translate([xm, y, zo - 1.7]) if sz > 0 else cs.mirror([0, 0, 1]).translate([xm, y, zo + 1.7]))
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return u(adds), u(cut_t), u(cut_r)


TONGUE_BOSS = 4.85               # with the 2.5 wall and tongue, an M3 x 10 countersunk ends inside the boss
KN_GAP = 0.5                     # block to bridge: clear whatever the first layer's height (0.2 left none at 0.24)
INSERT = (INS_D, INS_DEPTH, INS_RELIEF) if FASTEN == 'insert' else None


def chassis():
    """(left, right, info). p4v55's tray (hidden louver ties, the V5 posts with their feet moved back for the standoffs,
    the centre posts) without its crush ribs, with contact pads, the skin's bosses, the encoder tower, and inserts."""
    import p4v55 as T
    saved = DR.FASTEN, DR.INSERT_D, DR.INSERT_L
    DR.FASTEN, DR.INSERT_D, DR.INSERT_L = FASTEN, INS_D, INS_DEPTH            # the cleat's and the bottom screws' bosses
    try:
        t = T.tray(extra_dy=BOSS_Y - WASHER_REC[1] - (T.P3.FOOT_Y + T.FOOT_DY))
    finally:
        DR.FASTEN, DR.INSERT_D, DR.INSERT_L = saved
    # no crush ribs; the front edge clear of the diffuser's flange, which sits RIM_GAP further back
    t = t ^ C.prism_y(C.rr_cs(C.BORE_HX - DR.TRAY_CL, C.BORE_HZ - DR.TRAY_CL, C.BORE_R - DR.TRAY_CL), 0, D)
    t = t - box(-400, 400, 0, DR.YF + 2 * RIM_GAP, -5, H + 5)
    adds = [boss_wall(x, y, sz) for sz in (1, -1) for x, y in PLANK_SCREWS] + [boss_end(y, z, sx) for sx in (-1, 1) for y, z in CAP_SCREWS]
    t = t - Manifold.batch_boolean([cyl_y(x, z, BOSS_Y - WASHER_REC[1] - 1, BOSS_Y, WASHER_REC[0], 48) for x, z in insert_xz()], ADD)   # washer recesses
    t = t + Manifold.batch_boolean(adds, ADD) + pads(t)
    tw_add, tw_cut = tower()
    t = (t + tw_add) - tw_cut
    cuts = [thread_z(x, y, sz) for sz in (1, -1) for x, y in PLANK_SCREWS] + [thread_x(y, z, sx) for sx in (-1, 1) for y, z in CAP_SCREWS]
    t = t - Manifold.batch_boolean(cuts, ADD)
    # the split, off centre: tongues inside the right half's walls, knuckles on the back plate
    left = t ^ box(-400, JOINT_X, -5, D + 5, -5, H + 5)
    right = t ^ box(JOINT_X, 400, -5, D + 5, -5, H + 5)
    tg_add, tg_cut, r_cut = tongue_legs(TONGUE_BOSS, INSERT)
    kl_add, kl_cut, kr_add, kr_cut = T.knuckles(INSERT, KN_GAP)
    hit = ((tg_add + kl_add) ^ (right - kr_cut)).volume()          # what the right half already had where the joint goes
    left = (left + tg_add + kl_add) - tg_cut - kl_cut
    right = ((right - kr_cut) + kr_add) - r_cut - kr_cut
    biggest = lambda m: max(m.decompose(), key=lambda c: c.volume())
    lost = round(sum(m.volume() - biggest(m).volume() for m in (left, right)), 2)     # slivers only: anything real is reported
    return biggest(left), biggest(right), dict(joint_meets_right_half_mm3=round(hit, 2), dropped_islands_mm3=lost)


# ---------------------------------------------------------------- what goes inside (for checks and renders)
def panel_v6():
    return p4.panel_p4().translate([0, RIM_GAP, 0])


def diffuser_v6():
    d = p4.diffuser_halves()
    return {k: p4.diffuser_in_case(v).translate([0, RIM_GAP, 0]) for k, v in d.items()}


def standoffs():
    """the six standoffs on the panel, each with its washer"""
    af = STANDOFF_AF / math.sqrt(3)
    out = []
    for x, z in insert_xz():
        out.append(Manifold.cylinder(STANDOFF_L, af, af, 6).rotate([-90, 0, 0]).translate([x, PB, z]))
        out.append(cyl_y(x, z, PB + STANDOFF_L, PB + STANDOFF_L + WASHER_T, 7.0, 32))
    return Manifold.batch_boolean(out, ADD)


def screws():
    """every screw seated, one manifold per group. skin: black M3 x 10 button heads (top and ends). under: the same under
    the bottom plank, and the four M3 x 10 countersunk of the tongues, flush under the planks. back: six M3 x 8 button
    heads into the standoffs, and the knuckles' three M3 x 10 countersunk, flush."""
    import p4v55 as T
    skin_s, back_s, hid = [], [], []
    for x, y in PLANK_SCREWS:
        skin_s.append(cyl_z(x, y, H - 10.0, H, 3.0, 24) + cyl_z(x, y, H, H + HEAD_K, HEAD_D, 32))
        hid.append(cyl_z(x, y, 1.0, 11.0, 3.0, 24) + cyl_z(x, y, 1.0 - HEAD_K, 1.0, HEAD_D, 32))     # in its 1 mm counterbore
    for sx in (-1, 1):
        for y, z in CAP_SCREWS:
            a, b = sorted((sx * (W / 2 - 10.0), sx * W / 2)); c, e = sorted((sx * W / 2, sx * (W / 2 + HEAD_K)))
            skin_s.append(cyl_x(y, z, a, b, 3.0, 24) + cyl_x(y, z, c, e, HEAD_D, 32))
    seat = BOSS_Y - WASHER_REC[1] + T.P3.SO_FLOOR
    for x, z in insert_xz():                  # M3 x 8 with a washer under its head (the head alone could drop into the 4.5 mm hole)
        back_s.append(cyl_y(x, z, seat - 8.0, seat, 3.0, 24) + cyl_y(x, z, seat, seat + HEAD_K, HEAD_D, 32))   # flanged (6.9): no washer under it
    for dz, _, _ in T.KNUCKLES:
        back_s.append(cyl_y(T.KN_SCREW_X, ZC + dz, YB1 - 10.0, YB1, 3.0, 24))
    xm = JOINT_X + TONGUE / 2
    for y in LEG_SCREW_Y:
        hid.append(cyl_z(xm, y, ZO1 - 10.0, ZO1, 3.0, 24) + cyl_z(xm, y, ZO0, ZO0 + 10.0, 3.0, 24))
    tsa, tsb = p4.top_screws_env()            # the two M2.5 beside the knob, as V5: through the ring's holes and the plank into the chassis
    for sx in (C.SCREW_XS if UNDER_SCREWS else ()):   # the two M3 x 10 under the case, as V5, into inserts in the bottom bosses
        for x in (sx, -sx):
            hid.append(cyl_z(x, DR.BOT_Y, 1.0, 11.0, 3.0, 24) + cyl_z(x, DR.BOT_Y, 1.0 - HEAD_K, 1.0, HEAD_D, 32))
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return dict(skin=u(skin_s), back=u(back_s), under=u(hid), knob=tsa + tsb)


def build():
    left, right, info = chassis()
    return dict(skin=skin(), chassis_left=left, chassis_right=right, info=info, panel=panel_v6(), diffuser=diffuser_v6(),
                standoffs=standoffs(), screws=screws(), ring=trim_ring(), knob=p4.knob_in_case(),
                encoder=p4.encoder_envelope(), s3=DR.s3_envelope(), sensor=DR.sensor_envelope())


TIE_X0 = JOINT_X + TONGUE + 4.0  # the power bundle's tie loop starts here: right of the joint's knuckles


def cables(P):
    """every cable and plug of p4_cables (ribbon, power lead and its spare bundle, QT cables, USB-C) against the chassis,
    standoffs and skin. The bundle is moved to this chassis's tie loop; the USB-C plug passes through its openings."""
    import p4_cables as CB
    I = CB.items()
    tx1 = DR.S3_EDGE - 63.8 - 1.0                                          # as drawer.tray() places the loop
    I['power_bundle'] = I['power_bundle'].translate([(TIE_X0 + tx1) / 2 - (p4.SEAM_BAR + 4.0 + tx1) / 2, 0, 0])
    solid = P['chassis_left'] + P['chassis_right'] + P['standoffs'] + Manifold.batch_boolean(list(P['skin'].values()), ADD)
    worst = max(((m ^ solid).volume(), n) for n, m in I.items() if not n.startswith('usb'))
    each = sum((I[a] ^ I['power_bundle']).volume() for a in I if a != 'power_bundle')
    return (f'cables and plugs / chassis, standoffs, skin (worst: {worst[1]}); the moved power bundle / other cables', round(worst[0] + each, 2))


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
            ('skin, knob and bottom screws / panel, diffuser, S3, sensor, encoder, ring', v(P['screws']['skin'] + P['screws']['under'] + P['screws']['knob'], P['panel'] + dif + P['s3'] + P['sensor'] + P['encoder'] + P['ring']))]
    rows.append(cables(P))
    plank_top_z = max(m.bounding_box()[5] for k, m in P['skin'].items() if k in ('plank_top', 'half_top'))
    rows.append(('ring flange above the top plank, mm, less 0.3 (should be >= 0)', round(P['ring'].bounding_box()[2] - plank_top_z - 0.3, 2) * -1 if P['ring'].bounding_box()[2] - plank_top_z < 0.3 else 0.0))
    import cleat as CLT, p4v55 as T
    rows.append(('case cleat / chassis and the screws on its back', v(p4.case_cleat_p4(), ch + P['screws']['back'])))
    cc, wc = p4.case_cleat_p4(), p4.wall_cleat_p4()                # the wall cleat is fixed; the case and its cleat move
    hung = [ch, sk, cc, P['screws']['back']]
    seated = lambda dx=0.0, dy=0.0, dz=0.0: round(sum(v(m.translate([dx, dy, dz]), wc) for m in hung), 2)
    hk = CLT.hook()
    rows.append(('wall cleat / chassis, skin, case cleat, back screws, hung', seated()))
    rows.append((f'lifted straight off the wall cleat (0.5 to {hk + 6:.0f} mm; hook {hk:.1f})', max(seated(dz=q) for q in np.arange(0.5, hk + 6.01, 0.5))))
    rows.append(('hanging: above the hook, pushed to the wall from 10 mm off, then lowered', max([seated(dy=-q, dz=hk + 1.0) for q in (10, 5, 2, 1, 0.5, 0)] + [seated(dz=q) for q in np.arange(hk + 1.0, 0, -0.5)])))
    clear = lambda q: all(seated(dy=-d, dz=q) == 0 for d in np.arange(1.0, CLT.T + 2.01, 1.0))
    free = min(q for q in np.arange(0, hk + 8, 0.25) if clear(q))                           # how far up before it comes straight off the wall
    rows.append((f'it must be lifted {free:.2f} mm before it pulls off the wall (the hook, {hk:.1f}; info)', 0.0 if abs(free - hk) < 1.5 else free))
    # lowered 4 mm off centre: the stops' lead-ins must steer it, so being off centre by less than the lead-in never jams;
    # hung, it must not move further sideways than the stops' clearance
    slide = max(q for q in np.arange(0, 3.01, 0.1) if seated(dx=q) == 0 and seated(dx=-q) == 0)
    rows.append((f'hung, it slides {slide:.1f} mm each way before a stop (info)', 0.0 if slide <= p4.CLEAT_STOPS[0] + 0.11 else slide))
    rows.append(('back screws / chassis (every hole open to its screw)', v(P['screws']['back'], ch - box(-400, 400, BOSS_Y - WASHER_REC[1] + T.P3.SO_FLOOR - 0.01, BOSS_Y - WASHER_REC[1] + T.P3.SO_FLOOR + 0.03, -5, H + 5))))   # less the 0.02 the centre bores start late (p4v55.tray)
    rows.append(('back screws / panel, S3, sensor, encoder', v(P['screws']['back'], P['panel'] + P['s3'] + P['sensor'] + P['encoder'])))
    rows.append(('right chassis half slid on sideways (0.3-12 mm) / left half', round(max(v(P['chassis_right'].translate([q, 0, 0]), P['chassis_left']) for q in (0.3, 1, 3, 6, 9, 12)), 2)))
    rows.append(('panel with its standoffs and washers going in from the front (1-40 mm out) / chassis', round(max(v((P['panel'] + P['standoffs']).translate([0, -q, 0]), ch) for q in (1, 2, 4, 8, 16, 24, 32, 40)), 2)))
    rest = ch + dif + P['panel']
    if SKIN == 'two':
        for name, d, other in (('half_top', 1, 'half_bottom'), ('half_bottom', -1, 'half_top')):
            steps = (0.3, 0.5, 1, 2, 4, 8, 16, 32, 64, 80)
            worst = max((P['skin'][name].translate([0, 0, d * s]) ^ (rest + P['skin'][other] + P['encoder'] + P['s3'] + P['sensor'])).volume() for s in steps)
            rows.append((f'{name} lifted straight off (0.3-80 mm), vs chassis, diffuser, panel, encoder, S3, sensor and the other half', round(worst, 2)))
        ht, hb = P['skin']['half_top'], P['skin']['half_bottom']
        vs = v(P['screws']['skin'], ch + sk)
        if FASTEN == 'tap':                                   # a drawn 3.0 shank in a 3.0 pilot: only the facets' corners touch
            rows.append((f'skin screws / chassis and skin: {vs} mm3 where the threads are cut (tap; closed holes would be > 20)', 0.0 if vs < 1.0 else vs))
        else:
            rows.append(('skin screws / chassis and skin (every hole open to its screw)', vs))
        # the halves closed until the line shuts: the lap must not land first; and shifted sideways by the pads' play
        rows.append((f'top half lowered {SKIN_GAP - 0.02:.2f} (the line shut) / bottom half', v(ht.translate([0, 0, -(SKIN_GAP - 0.02)]), hb)))
        rows.append(('top half shifted 0.3 left or right / bottom half', round(max(v(ht.translate([q, 0, 0]), hb) for q in (-0.3, 0.3)), 2)))
        # looking along the line from each end: is there walnut behind it everywhere the bottom half's leg runs?
        open_mm = 0.0
        for sx in (-1, 1):
            for y in np.arange(hb.bounding_box()[1] + LAP_END + 0.5, D - LAP_END - LAP_H, 0.5):    # between the lap's ends
                a, b = sorted((sx * (W / 2 - WALL - 0.3), sx * (W / 2 + 1)))
                if (ht ^ box(a, b, y - 0.05, y + 0.05, ZC - 0.05, ZC + 0.05)).volume() < 1e-6:
                    open_mm += 0.5
        rows.append(('length of the line with no walnut behind it, mm (both ends, between the lap\'s ends)', open_mm))
        return rows
    for name, d in (('plank_top', (0, 0, 1)), ('plank_bottom', (0, 0, -1)), ('cap_left', (-1, 0, 0)), ('cap_right', (1, 0, 0))):
        worst = max((P['skin'][name].translate([d[0] * s, d[1] * s, d[2] * s]) ^ rest).volume() for s in (0.5, 1, 2, 4, 8, 16))
        rows.append((f'{name} lifted straight off (0.5-16 mm), vs chassis, diffuser, panel', round(worst, 2)))
    return rows


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    P = build()
    def save(m, name, bed='back', frame=None):
        """back: the case's back on the bed, as every V5 part; top: turned over, the top face on the bed. frame: another
        part (in the case frame) whose placement on the bed this one shares: the second part of a two-material print."""
        def turn(q):
            q = q.rotate([-90, 0, 0]) if bed in ('back', 'diag') else q.mirror([0, 0, 1])
            return q.rotate([0, 0, 45]) if bed == 'diag' else q          # a half is 281.8 long: on the 256 bed's diagonal, as V5's
        m, ref = turn(m), turn(frame if frame is not None else m)
        me = m.to_mesh()
        t = trimesh.Trimesh(vertices=np.asarray(me.vert_properties)[:, :3], faces=np.asarray(me.tri_verts)); t.merge_vertices()
        b = ref.bounding_box()
        t.apply_translation([-(b[0] + b[3]) / 2, -(b[1] + b[4]) / 2, -b[2]])
        t.export(f'{out}/{name}.stl')
        return f'{name}: {np.round(t.extents, 1).tolist()} on the bed, {m.volume() / 1000:.1f} cm3, {len(t.split(only_watertight=False))} body'
    for k, m in P['skin'].items():
        print(save(m, f'v6-skin-{k.replace("_", "-")}-walnut', 'diag' if SKIN == 'two' else 'back'))
    print(save(P['chassis_left'], 'v6-chassis-left')); print(save(P['chassis_right'], 'v6-chassis-right')); print(save(P['ring'], 'v6-trim-ring', 'top'))
    # the status window: a translucent disc in the right half's pocket over the S3's LED, printed as that half's second part
    # (AMS), on the bed with it (left out of the V6 exports until Nov 19: the owner noticed)
    print(save(DR.status_window(), 'v6-chassis-right-window', frame=P['chassis_right']))
    print('info', P['info'])
    import p4v55 as T
    print('  louver span tied wall to plate, mm (top, bottom):', T.tie_length(P['chassis_left'] + P['chassis_right'], 'top'), T.tie_length(P['chassis_left'] + P['chassis_right'], 'bottom'))
    hits = 0
    for name, val in check(P):
        print(f'  {"ok  " if val < 0.05 else "HIT "} {name}: {val}')
        hits += val >= 0.05
    print('PASS' if not hits else f'FAIL ({hits})')
    sys.exit(1 if hits else 0)
