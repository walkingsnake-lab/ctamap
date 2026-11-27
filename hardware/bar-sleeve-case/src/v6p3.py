"""V6 for the single P3 (Waveshare P3 64x32, 192 x 96), draft 1 (Nov 26, 2026). Units mm.

    python3 v6p3.py ../stl/p3-v6        # the print set (p3-v6-*.stl, the reused parts included) and the checks
    V6_FASTEN=tap python3 v6p3.py ...   # no heat-set inserts: every screw that would meet one cuts a printed pilot

What it is: the P4's V6 (v6.py) brought to the P3, with one structural difference kept on purpose. The P3's walnut
prints in one piece, so it stays the V5 one-piece sleeve and slides on from the front over the chassis, which goes in
from its back (the owner, Nov 26: keep sliding, but "reduce structural differences between the two"). Everything
inside is the P4 V6's:
- **Chassis** (black PETG, one piece: the P3's fits the bed whole): the V5 drawer tray (drawer.tray()) with V6's
  changes. Hidden louver ties (blind stretches, p4v55.py), no crush ribs, contact pads, the panel on six M3 x 30
  standoffs with a washer under each, the USB-C port framed in the right wall with V6's port stop, the S3's posts
  necked and flatted (v6.s3_post_relief), heat-set inserts (M3 x D5 x L4) wherever a screw threads in from outside, the
  front edge FRONT_CL behind the diffuser's flange.
- **The sleeve** (walnut, 4 mm wall as the P4's skin; V5's was 3.5): the V5 sleeve, with
  - a **rebate** inside its back edge (REB_T deep, from the back face to the plate, a 45 deg seat at its front end).
    A **lip** round the edge of the chassis's back plate sits on the seat: the back edge of all four walls, the stretch
    furthest from the hood and free on V5, rests on PETG 4 mm from its end, and the seat is the depth stop. The lip is
    the plate's edge grown outward, so it prints on the bed with the plate; nothing of the chassis stands behind the
    plate (its 4 mm inside the rim, the cleat and everything inside are V5's);
  - two black M3 x 10 flat heads from below in round countersinks (V6's), into inserts in V5's bottom bosses. The
    countersinks are drawn UNDER_BIAS in front of the screws and as much deeper: tightened, each head pulls the sleeve
    back onto the seat (a draw-bore) and ends flush; the seat, not the screws, sets the depth and the rim gap is the model's. A land round each screw
    (V6's lands()) so the walnut is clamped onto PETG;
  - the knob hole SEAT_HOLE across (V5's: 24), so the encoder goes in from above after the sleeve is on (below).
- **Knob seat** (black PETG): what v6.tower() is on the P4, as its own part. It fills the walnut's hole, rests on the
  chassis's top wall round a square opening and keys into it, and carries V5's collar pocket and deck. Two M2.5 x 8
  (V5's knob screws) through it into bosses on the chassis's encoder rails hold it down; the knob hides their heads.
  Knob presses go through the deck and the screws into the chassis, as on the P4.
- **Encoder**: the P4's way in reversed. Before the sleeve goes on, its QT cable (150 mm or more) is plugged in at the S3 (or
  the sensor; a 200 mm cable in practice) and its free end taped to the right rail under the opening, to be drawn out
  through the walnut's hole afterwards. The sleeve on, the encoder (its QT cable plugged in) is lowered through the
  walnut's hole and the chassis's opening, plug side first and a little tilted, onto two lips under the rails, which
  hold it 0.3 below its seat; then the knob seat over the bushing, the two screws, the ring, the nut (it pulls the body
  up into the pocket), the knob.
- **Trim ring, knob**: the P4 V6's 44 mm ring and 39 mm knob (same nut, bushing and knob stack). The ring here lies
  flat on the knob seat (no neck to reach over), raised RING_LIFT over the walnut round it.
- **Diffuser, sensor sled, cleats, Boot key**: V5's (stl/, stl/v5-drawer), reused. The diffuser rides on the panel
  RIM_GAP behind the rim, as on the P4.

Service: the knob, nut, ring, knob seat and encoder come out from above before the sleeve can slide off. Print the
sleeve with a brim: back-down, its footprint is now the 2.5 mm ring behind the rebate.

The V6 constants and functions below are copies of v6.py's (named where they come from). v6.py imports p4.py, which
sets up the P4 panel profile at import, so the P3 cannot import it. Merging the two into one module that takes a
panel is a later cleanup, once both are printed.
"""
import math, os, sys
os.environ.setdefault('PANEL', 'p3')
if os.environ['PANEL'] != 'p3':
    raise SystemExit('v6p3.py is the P3 build (PANEL=p3)')
os.environ.setdefault('CASE_WALL', '4.0')       # the P4 V6 skin's wall (V5's P3 sleeve: 3.5); the bore is unchanged
import numpy as np
from manifold3d import Manifold, CrossSection, JoinType
import case as C
import case2 as V
import plate3 as P3
import drawer as DR
import collar as CO
import sensor as SN
import panel
from case import box, cyl_y, cyl_z, prism_y, rr_cs, ADD, ZC, H, D, WALL, HW, KY, BORE_HX, BORE_HZ, BORE_R, Y_FACE, \
    PANEL_BACK, BACKL

DR.configure_shell()
V.BACKDOWN = True

# ---------------------------------------------------------------- settings
# the same as the P4 V6 (v6.py), named there
RIM_GAP = float(os.environ.get('V6_RIM_GAP', '0.15'))   # the diffuser and panel this far behind the V5 position: the rim
                                                        # covers the diffuser's border without pressing on it
FRONT_CL = 0.3                   # the chassis's front edge stays this far behind the diffuser's flange
STANDOFF_L, STANDOFF_AF = 30.0, 5.5          # M3 male-female hex standoff in each panel insert
WASHER_T = 0.5                   # an M3 washer between each standoff and its post
WASHER_REC = (7.4, 0.3)          # a recess in each post's foot that holds its washer while the panel is lowered in
SKIN_CL_D = 3.4                  # M3 clearance through the walnut
INS_D, INS_DEPTH, INS_RELIEF = 4.4, 5.0, 3.2   # heat-set insert M3 x D5 x L4: the hole, its depth, room past it
FASTEN = os.environ.get('V6_FASTEN', 'insert')
assert FASTEN in ('insert', 'tap'), FASTEN
DR.WIN_T = 0.5                   # the status window 0.5 thick (v6.py)
DR.TOP_FALL = True               # the top band's slots slope down going inward (drawer.TOP_FALL): its top row opens fully (Nov 26)
PAD_W, PAD_RUN = 4.0, 8.0
CSK_D = float(os.environ.get('V6_CSK_D', '6.4'))   # the countersink's mouth (to be set from the coupon, as the P4's)
CSK_HEAD, CSK_HEAD_K = 6.0, 1.7  # DIN 7991 flat head
CSK_K = (CSK_D - SKIN_CL_D) / 2
LAND_ID, LAND_OD = 7.0, 12.0     # the land round each screw from below (v6.lands)
PORT_FRAME = (V.PORT_W + 0.6, V.PORT_H + 0.6)
PORT_CH, BTN_CL = 0.5, 0.5
PORT_STOP = (0.6, 3.0, 5.5)
S3_EDGE_PARTS = dict(receptacle=(-4.47, 4.47, 0.0, 0.0, 3.2), down=(8.81, 11.76, 1.07, 1.0, 2.5), up=(18.59, 21.54, 0.94, 1.0, 2.5),
                     reset=(28.37, 31.32, 0.44, 1.0, 2.5))
S3_TIP_D, S3_TIP_L = 4.8, 1.6
S3_FLATS = {0: ((48.0, 2.2, 6.2), (-95.3, 2.7, 3.7))}
S3_NEAR = ((0, 45.0, 2.64, 0.0, 1.0), (0, 50.9, 2.91, 1.0, 5.64), (0, -95.3, 3.16, 0.0, 3.2), (2, -93.0, 2.81, 0.0, 1.1), (3, 86.5, 3.10, 0.0, 1.1))
RING_R, RING_LIFT = 22.0, 0.4    # the trim ring (v6.RING_R), its rim raised this far off the walnut
KNOB_R = 19.5                    # the P4 V6 knob (reused as is): its radius, for the checks

# the P3's own
PAD_H = 0.15                     # contact pads, top and bottom walls: 0.10 of air in the 0.25 gap. The P4's are 0.24 (0.01 of
                                 # air), but its halves are lowered straight on; here the sleeve slides ~45 mm over the front
                                 # pads, and a walnut print 0.2% small across 105 mm takes 0.1 of it. None on the end walls
                                 # (Fable review, Nov 26: across 212 mm a sleeve 0.1% small already bound on them, and the lip's
                                 # seat and the corners place the sleeve sideways)
LAND_H = DR.TRAY_CL              # the lands round the screws from below: the full gap, so the screws clamp the walnut onto PETG
                                 # without pulling the chassis down off the seat (at 0.15 they did, by 0.1). The sleeve's 45 deg
                                 # seat leads it onto them over their last ~11 mm
REB_T = 1.5                      # the rebate: this deep into the 4 mm wall (2.5 left, as under the P4's countersinks), from the back
                                 # face to SEAT_Y ...
REB_CL = 0.15                    # ... SEAT_Y this far behind the back plate's outer face, where the seat's 45 deg reaches REB_T
SEAT_Y = DR.Y1 + REB_CL
LIP_R = 0.75                     # the lip: out to this past the bore, on the seat's 45 deg (0.75 of contact), then straight back
                                 # to the plate's outer face for 0.6 (REB_T - REB_CL - LIP_R): the first layers, where elephant foot
                                 # is, stay 0.4-0.6 clear of the seat (review, Nov 26: 0.3 left 0.1 at the second layer)
SEAT_AIR = float(os.environ.get('V6P3_SEAT_AIR', '0.0'))   # the lip's face this far behind the seat's (seated, the sleeve comes
                                 # back by it): a trim for the first print's measured rim gap, +0.1 here takes 0.1 off the gap
END_RELIEF = 0.2                 # on the end walls' flats the lip's face is this much further back (0.14 normal to the seat): the
                                 # seat bears on the top and bottom walls and the corners, so a sleeve printed small across its
                                 # 212 mm width sets the depth by half as much as one small across its 105 mm height
UNDER_BIAS = 0.15                # the countersinks underneath are drawn this far in front of their screws (see above)
SEAT_HOLE = 37.5                 # the walnut's knob hole. The encoder board is 25.4 square (corners 17.96 from its centre); its QT
                                 # plug stands out to 18.94 (x 12.7-18.7, y +/-3) and the cable bends down past that. Tilted
                                 # 20 deg, plug side first, until its board is 8 mm over its seat, then levelled, it passes a 37
                                 # (check()); 39 would pass it level. The ring (44) covers its flat's corners by 1.4
SEAT_CL = 0.45                   # the knob seat in the walnut's hole, a side (the chassis locates it; the walnut never bears on it):
                                 # more than the depth the sleeve can sit off its seat (0.2 touched, Fable review)
SEAT_TRUNC = SEAT_HOLE / 2 + 0.6 # the hole's teardrop toward the front (the print's up), cut flat 0.6 past the circle: a 14.3 mm
                                 # bridge in the 4 mm wall, under the ring, whose sag stays clear of the knob seat (review, Nov 26)
TILT = (20.0, 8.0)               # the way in for check(): tilted this much (deg) until the board is this far over its seat (mm)
PASS = 12.7 + DR.RAIL_CL         # the opening in the chassis's top wall: the board's outline and the rails' clearance (13.15)
NOTCH = (21.0, 3.5)              # and a notch on the right for its QT plug and the cable's bend: out to x, +/- y about KY
GABLE = 6.0                      # the opening's front edge (the print's up) runs forward this far at 45 deg from each corner before
                                 # its flat: a 15 mm bridge instead of 27, its sag 6 mm in front of the knob seat's key (review, Nov 26)
WALL_OPEN = 0.3                  # the top wall's opening is this much larger than the rails' faces (no face shared with them)
SPIG_CL = 0.15                   # the knob seat's key in the wall's opening, a side
TS_XY = ((-15.0, KY + 6.0), (15.0, KY + 6.0))   # the two M2.5 x 8 holding the knob seat: outboard of the rails (as the P4's,
                                 # x 15), 6 behind the knob's axis to clear the plug's notch. Heads end 18.5 out: the knob hides them
TS_CLEAR, TS_HEAD = 2.9, 5.2     # their hole through the knob seat; the ring's hole round each head (p4.TS_FLANGE)
TS_PILOT, TS_LEAD, TS_LEN = DR.SLED_PILOT, 0.6, 8.0
TS_HEAD_D, TS_HEAD_K = 4.7, 1.6
TS_BOSS_OUT, TS_BOSS_HY = 2.8, 3.2
LIP_W, LIP_T, LIP_DROP = 1.2, 1.2, 0.3   # lips under the board's side edges: this far under it, this thick, this far below its
                                 # seat (the nut lifts it off them). Clear of its QT sockets (x 7.7-12.7 at y +/-3)
PIX = (1.5, -11.0, -8.4, 0.9)    # the encoder's NeoPixel: half width, its front and back edges from the board's centre (y), its
                                 # height. Measured Nov 26 from Adafruit's photo of the 5880 (mounting holes 20.32 apart for scale):
                                 # 3.0 x 2.6, centred on the board, between the front holes. Its height is still assumed
PIX_RELIEF, PIX_HX = 1.5, 3.0    # a pocket in the key's underside over it (v6.py's 1.5 deep: 2.4 mm of headroom over the board),
PIX_Y = (-12.6, -9.0)            # 1.5 clear of it either side and 1.6 in front; behind -9.0 the body's pocket (9.8 round) is over it
SKIRT_ROWS = ()                  # end-wall pad rows (v6.py's: 14, 34): none, see PAD_H

# chassis numbers taken from the tray
XIN = BORE_HX - DR.TRAY_CL - DR.TRAY_WT
HZ = BORE_HZ - DR.TRAY_CL - DR.TRAY_WT
ZIN0, ZIN1 = ZC - HZ, ZC + HZ
ZO0, ZO1 = ZIN0 - DR.TRAY_WT, ZIN1 + DR.TRAY_WT
PB = PANEL_BACK + RIM_GAP                                   # the panel's back in V6
BOSS_Y = PB + STANDOFF_L + WASHER_T                         # the posts' feet: a standoff and its washer behind the panel
FOOT_DY = BOSS_Y - WASHER_REC[1] - P3.FOOT_Y                # how far V5's post feet move back
CENTRE_POSTS = [q for q in DR.INSERTS if q not in DR.CORNERS]
UNDER_XY = [(sx * x, DR.BOT_Y) for sx in (-1, 1) for x in C.SCREW_XS]      # the two screws from below (V5's x +/-46)
# louver ties (p4v55.py's scheme): stretches of the rows left solid from the wall to the back plate, so the walls are not
# flaps hinged at the louvers. TIES: solid round the two centre posts. BLIND: the slot still cut from the back face (the row
# looks unbroken) but stopped drawer.TIE_BLIND short of the inside, which closes it to air. The P4 has one every ~24 mm over
# its 227 mm rows; at that rate the P3 passed 60% of V5's air (vent_area()). Nov 26 (the owner: heat is not a strong
# concern, but decent airflow for the worst case): one blind stretch in the middle of each free span of the top rows
# (+/-50, 12 mm: the falling slots below would otherwise nick the cleat's bosses), none added to the bottom rows, whose
# blind stretches over the two screw bosses (x +/-46, 13 mm) already sit there. Tied: 40 mm of the top band, 42 of the
# bottom (V5: 6 and 26; the P4's spacing: 66 and 71); the longest free stretch ~38 mm (V5 P3's ~77 never pressed in), and
# the lip now holds the sleeve's back edge. With the top band's slots turned to slope down going inward (drawer.TOP_FALL:
# its top row, cut short by the top wall before, opens fully, and no slot ends in the rails or the sensor's hooks):
# 2367 mm2 through, 95% of V5's 2489 (the ties alone: 84%).
TIES = dict(top=[(-20.0, -4.0)], bottom=[(4.7, 20.7)])
BLIND = dict(top=[(-56.0, -44.0), (44.0, 56.0)], bottom=[])   # 12 mm: the falling slots (below) would nick the cleat's bosses
VENT_MIN = 2250.0                # mm2: vent_area(), the louvers' through area, at least (V5's tray: 2489)


def ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return CrossSection([pts if a > 0 else pts[::-1]])


def cyl_x(y, z, x0, x1, d, seg=48):
    return Manifold.cylinder(x1 - x0, d / 2, d / 2, seg).rotate([0, 90, 0]).translate([x0, y, z])


def along_y(pts, y0, y1):
    return Manifold.extrude(ccw(pts), y1 - y0).rotate([90, 0, 0]).translate([0, y1, 0])


def along_x(pts, x0, x1):
    return Manifold.extrude(ccw(pts), x1 - x0).rotate([90, 0, 90]).translate([x0, 0, 0])


def along_z(pts, z0, z1):
    return Manifold.extrude(ccw(pts), z1 - z0).translate([0, 0, z0])


def bore_band(r_out, r_in, y0, y1):
    """the ring between two offsets of the bore's outline (r_out, r_in: outward from the bore), y0..y1"""
    return prism_y(rr_cs(BORE_HX + r_out, BORE_HZ + r_out, BORE_R + r_out), y0, y1) - \
        prism_y(rr_cs(BORE_HX + r_in, BORE_HZ + r_in, BORE_R + r_in), y0 - 1, y1 + 1)


def passage_cs(o=0.0):
    """the chassis's opening for the encoder (x, y), grown by o: the board's square and the plug's notch"""
    sq = CrossSection.square([2 * (PASS + o), 2 * (PASS + o)], center=True).translate([0, KY])
    nt = CrossSection.square([NOTCH[0] - PASS + 1.0 + o, 2 * (NOTCH[1] + o)]).translate([PASS - 1.0, KY - NOTCH[1] - o])
    return sq + nt


def gable_cs(o):
    """the opening's front edge, for the print: GABLE forward at 45 deg from the corners of the square grown by o, then flat.
    The knob seat's key fills it (grown by WALL_OPEN - SPIG_CL), so it still locates the key forward"""
    a, y0 = PASS + o, KY - PASS - o
    return ccw([(-a, y0 + 0.5), (-a, y0), (-a + GABLE, y0 - GABLE), (a - GABLE, y0 - GABLE), (a, y0), (a, y0 + 0.5)])


# ---------------------------------------------------------------- the sleeve
def rr_odd(r):
    """the bore's outline offset by r, its corners on a segment count of their own: a hull between two of these crosses the
    chassis's walls (rr_cs, C.SEG) away from their vertices, where a shared vertex line left near-duplicate points in the STL"""
    rr = max(BORE_R + r, 0.3)
    return CrossSection.square([2 * (BORE_HX + r - rr), 2 * (BORE_HZ + r - rr)], center=True).offset(rr, JoinType.Round, circular_segments=C.SEG + 13).translate([0, ZC])


def seat_hole_cs():
    return V.teardrop_cs(SEAT_HOLE / 2, 0.0, KY, trunc=SEAT_TRUNC, seg=128)


def csk_under(x, y):
    """a countersunk M3 clearance hole up through the bottom wall for the screw at (x, y) (v6.csk, axis z, s = -1): the hole on
    the screw's axis, the cone UNDER_BIAS in front of it and as much deeper (the draw-bore; the head, pulled that far off the
    cone's axis, ends level with the face). With the hole moved too, a sleeve 0.05 short of its seat already met the shank"""
    e, b = 0.02, UNDER_BIAS
    cone = Manifold.cylinder(CSK_K + e, CSK_D / 2 + e, SKIN_CL_D / 2, 64).translate([0, 0, b - e]) + Manifold.cylinder(b + e, CSK_D / 2 + e, CSK_D / 2 + e, 64).translate([0, 0, -e])
    return cone.translate([x, y - b, 0]) + cyl_z(x, y, -1, WALL + 1, SKIN_CL_D, 48)


def rebate():
    """the cut inside the sleeve's back edge: REB_T deep from the back face to SEAT_Y, then the 45 deg seat in to the bore (and
    0.1 on past it, so the cut has no face on the bore's). Its outlines are the lip's (rr_odd), so the two cones lie on one
    polyhedral surface and touch exactly"""
    seat = Manifold.batch_hull([prism_y(rr_odd(REB_T), SEAT_Y, SEAT_Y + 0.01), prism_y(rr_odd(-0.1), SEAT_Y - REB_T - 0.1, SEAT_Y - REB_T - 0.09)])
    return prism_y(rr_odd(REB_T), SEAT_Y, D + 1) + seat


def sleeve():
    saved = V.SCREW_XS, V.KNOB_TOP
    V.SCREW_XS, V.KNOB_TOP = (), False                  # V5's slotted holes underneath and its 24 mm hole: replaced below
    try:
        sh = V.shell2()
    finally:
        V.SCREW_XS, V.KNOB_TOP = saved
    cuts = [rebate(), Manifold.extrude(seat_hole_cs(), WALL + 2).translate([0, 0, H - WALL - 1])]
    cuts += [csk_under(x, y) for x, y in UNDER_XY]
    return sh - Manifold.batch_boolean(cuts, ADD)


# ---------------------------------------------------------------- the chassis
def port_frame():
    """v6.port_frame(): (add, cut) for the right wall, the wall put back round the USB-C port, and the channel in front"""
    py, pz = DR.PORT_Y, DR.PORT_Z
    fy, fz = PORT_FRAME[0] / 2, PORT_FRAME[1] / 2
    back = py + 5.0
    wt, top = DR.TRAY_WT, DR.BTN_Z0 - BTN_CL
    front = box(XIN, XIN + wt, DR.YF - 1, py - fy + 0.01, pz - 7.5, pz + fz)
    frame = box(XIN, XIN + wt, py - fy, back + 0.01, pz - 7.5, top)
    ramp = along_x([(py - fy - 2.0, pz + fz - 0.01), (py - fy + 0.01, pz + fz - 0.01), (py - fy + 0.01, top)], XIN, XIN + wt)
    window = box(XIN - 1, XIN + wt + 1, py - fy, py + fy, pz - fz, pz + fz)
    channel = box(XIN - 1, XIN + PORT_CH, DR.YF - 2, py - fy + 0.01, pz - 5.2, pz + 5.2)
    return (front + frame + ramp) - window, channel


def s3_dir(deg):
    return -math.cos(math.radians(deg)), math.sin(math.radians(deg))


def s3_post_relief():
    """v6.s3_post_relief(): a neck on all four S3 posts' tips, two flats on the first"""
    yc = DR.PCB_Y0 + 1.6
    r = P3.S3_POST_D / 2 + 0.2
    out = []
    for i, (hx, hz) in enumerate(DR.S3_HOLES):
        out.append(cyl_y(hx, hz, yc - 0.01, yc + S3_TIP_L, 2 * r, 48) - cyl_y(hx, hz, yc - 1, yc + S3_TIP_L + 1, S3_TIP_D, 48))
        for deg, f, length in S3_FLATS.get(i, ()):
            ux, uz = s3_dir(deg); vx, vz = -uz, ux
            quad = [(hx + f * ux + 4 * s * vx + e * ux, hz + f * uz + 4 * s * vz + e * uz) for s, e in ((-1, 0), (1, 0), (1, 4), (-1, 4))]
            out.append(along_y(quad, yc - 0.01, yc + length) ^ cyl_y(hx, hz, yc - 1, yc + length + 1, 2 * r, 48))
    return Manifold.batch_boolean(out, ADD)


def port_stop():
    """v6.port_stop(): the block over the USB-C receptacle"""
    gap, depth, half = PORT_STOP
    py, pz = DR.PORT_Y, DR.PORT_Z
    top = DR.PCB_Y0 + 1.6 + S3_EDGE_PARTS['receptacle'][4]
    back = py + PORT_FRAME[0] / 2
    x1 = DR.S3_EDGE
    x0 = x1 - depth
    xw = XIN + 0.01
    return along_z([(x0, top + gap), (x1, top + gap), (x1, back), (xw, back), (xw, back + (xw - x0)), (x0, back)], pz - half, pz + half)


def base_tray():
    """drawer.tray() with V6's posts (feet moved back for the standoffs, two more at the centre inserts), hidden louver
    ties and its fastening: p4v55.tray() on the P3"""
    saved = DR.FASTEN, DR.INSERT_D, DR.INSERT_L
    DR.FASTEN, DR.INSERT_D, DR.INSERT_L = FASTEN, INS_D, INS_DEPTH            # the cleat's and the bottom screws' bosses
    try:
        rails = [(sx * (PASS - 0.6), sx * (PASS + DR.RAIL_W + 0.6)) for sx in (-1, 1)]
        blind = dict(top=BLIND['top'] + [tuple(sorted(r)) for r in rails], bottom=BLIND['bottom'])   # the rails run into the band
        t = DR.tray(post_dy={c: FOOT_DY for c in DR.CORNERS}, ties=TIES, blind=blind, boss_blind=True, encoder=False)
    finally:
        DR.FASTEN, DR.INSERT_D, DR.INSERT_L = saved
    with DR._foot(FOOT_DY):
        adds = [P3.standoff(x, z, DR.Y0) for x, z in CENTRE_POSTS]
        cuts = [cyl_y(x, ZC + z, P3.FOOT_Y + P3.SO_FLOOR + 0.02, DR.Y1 + 1, P3.SO_BORE + 0.04, 64) for x, z in CENTRE_POSTS]
        for x, z in list(DR.CORNERS) + CENTRE_POSTS:                          # every post's hole again, with its bridge layers
            cuts.append(cyl_y(x, ZC + z, P3.FOOT_Y - 1.01, P3.FOOT_Y + P3.SO_FLOOR + 0.1, P3.SO_HOLE + 0.04, 32))
            ys, h, lh, zc = P3.FOOT_Y + P3.SO_FLOOR, P3.SO_HOLE / 2 + 0.02, DR.BRIDGE_LH, ZC + z
            cuts.append(box(x - h, x + h, ys - lh, ys + 0.01, zc - P3.SO_BORE, zc + P3.SO_BORE) ^ cyl_y(x, zc, ys - 2 * lh, ys + 0.02, P3.SO_BORE - 0.06, 48))
            cuts.append(box(x - h, x + h, ys - 2 * lh, ys - lh + 0.01, zc - h, zc + h))
    return (t + Manifold.batch_boolean(adds, ADD)) - Manifold.batch_boolean(cuts, ADD)


def rails_lips_bosses():
    """(adds, cuts) round the encoder. Rails beside the board's side edges (drawer.enc_rails' place and clearance) with a lip
    under each edge, LIP_DROP below the board's seat: they guide it down and hold it until the nut lifts it off them. The
    knob seat's two screw bosses on the rails' outsides (p4.tray_top_bosses). The opening in the top wall, a notch for the
    QT plug through the right rail, and room round the board's sockets."""
    hw, (by0, by1), (bz0, bz1) = DR.enc_board()
    top = bz0 - LIP_DROP
    ya, yb = by0 + 1.0, DR.Y1 - DR.LV_DEPTH + 0.5                  # drawer.enc_rails' run: on into the louver band (blind there)
    adds, cuts = [], []
    for sx in (-1, 1):
        xi, xo = sx * PASS, sx * (PASS + DR.RAIL_W)
        adds.append(along_y([(xi - sx * LIP_W, top - LIP_T), (xo, top - LIP_T), (xo, ZIN1 + 0.5), (xi, ZIN1 + 0.5), (xi, top),
                             (xi - sx * LIP_W, top)], ya, yb))
        a, b = sorted((sx * 7.2, sx * (PASS + 0.3)))               # the board's sockets (x 7.69-12.64, y +/-3) and their pins
        cuts.append(box(a, b, KY - 3.5, KY + 3.5, top - LIP_T - 1, top + 0.3))
    zw, zo = ZIN1, ZO1
    rail_lo = bz1 - DR.RAIL_LAP
    for x, y in TS_XY:
        sx = 1 if x > 0 else -1
        x0, x1 = sorted((sx * PASS, x + sx * TS_BOSS_OUT))
        boss = box(x0, x1, y - TS_BOSS_HY, y + TS_BOSS_HY, rail_lo, zw + 0.5)
        gus = (box(x0, x1, y + TS_BOSS_HY - 0.01, y + TS_BOSS_HY, rail_lo, zw + 0.5)              # its back end 45 deg (the bed side)
               + box(x0, x1, y + TS_BOSS_HY, y + TS_BOSS_HY + (zw - rail_lo), zw, zw + 0.5)).hull()
        adds += [boss, gus]
        cuts.append(cyl_z(x, y, rail_lo - 1, zo + 1, TS_PILOT, 24))
        cuts.append(Manifold.cylinder(TS_LEAD + 0.01, TS_PILOT / 2, TS_PILOT / 2 + TS_LEAD + 0.01, 24).translate([x, y, zo - TS_LEAD]))
    cuts.append(box(PASS - 1.0, NOTCH[0], KY - NOTCH[1], KY + NOTCH[1], top - LIP_T - 2, zw + 0.3))   # the plug's way down
    cuts.append(Manifold.extrude(passage_cs(WALL_OPEN) + gable_cs(WALL_OPEN), zo - zw + 1.01).translate([0, 0, zw - 0.01]))   # the opening
    return Manifold.batch_boolean(adds, ADD), Manifold.batch_boolean(cuts, ADD)


def pads(t):
    """contact pads, PAD_H proud in the 0.25 gap (v6.pads, every wall the end walls' height): strips front to back on the top
    and bottom every 22 mm, rows on the end walls wherever the wall is solid. None under the knob seat or on a land."""
    gap = DR.TRAY_CL - PAD_H
    y0, y1 = DR.YF + RIM_GAP + FRONT_CL + 3.0, DR.Y0 - 4.0
    band = bore_band(-gap, -DR.TRAY_CL - 0.3, y0, y1)
    xo = BORE_HX - DR.TRAY_CL
    strips = []
    for x in np.arange(-88.0, 89.0, 22.0):
        for z0, z1, half in ((ZO1 - 1.2, ZO1 - 0.2, box(-400, 400, 0, D, ZC, H + 5)), (ZO0 + 0.2, ZO0 + 1.2, box(-400, 400, 0, D, -5, ZC))):
            edges = list(np.arange(y0, y1, 2.0)) + [y1]
            solid = [(box(x - PAD_W / 2, x + PAD_W / 2, c, e, z0, z1) ^ t).volume() > 0.995 * PAD_W * (e - c) * (z1 - z0) for c, e in zip(edges, edges[1:])]
            i = 0
            while i < len(solid):
                j = i
                while j < len(solid) and solid[j]:
                    j += 1
                if j > i and edges[j] - edges[i] >= PAD_RUN:
                    strips.append(box(x - PAD_W / 2, x + PAD_W / 2, edges[i], edges[j], -5, H + 5) ^ half)
                i = max(j, i + 1)
    for sx in (-1, 1):
        for z in [ZC + s * r for r in SKIRT_ROWS for s in (-1, 1)]:
            a, b = sorted((sx * (xo - 1.2), sx * (xo - 0.2)))
            edges = list(np.arange(y0, y1, 2.0)) + [y1]
            solid = [(box(a, b, c, e, z - PAD_W / 2, z + PAD_W / 2) ^ t).volume() > 0.995 * (b - a) * (e - c) * PAD_W for c, e in zip(edges, edges[1:])]
            a, b = sorted((sx * (xo - 3), sx * 400))
            i = 0
            while i < len(solid):
                j = i
                while j < len(solid) and solid[j]:
                    j += 1
                if j > i and edges[j] - edges[i] >= PAD_RUN:
                    strips.append(box(a, b, edges[i], edges[j], z - PAD_W / 2, z + PAD_W / 2))
                i = max(j, i + 1)
    keep_off = [cyl_z(0, KY, -5, H + 5, SEAT_HOLE + 2.0, 64)] + [cyl_z(x, y, -5, H + 5, LAND_OD + 1.0, 48) for x, y in UNDER_XY]
    return (band ^ Manifold.batch_boolean(strips, ADD)) - Manifold.batch_boolean(keep_off, ADD)


def lands():
    """v6.lands(): a ring round each screw from below, LAND_H proud (the pads' height: the sleeve's bottom wall slides
    ~11 mm over it as it comes home): the screw clamps the walnut onto it"""
    out = []
    for x, y in UNDER_XY:
        ring = cyl_z(x, y, ZO0 - LAND_H, ZO0 + 0.3, LAND_OD, 64) - cyl_z(x, y, ZO0 - 1, ZO0 + 1, LAND_ID, 48)
        out.append(ring ^ box(-400, 400, 0, SEAT_Y - REB_T - 0.5, -5, H + 5))   # short of the seat: whole, at y 59.2 a ring reached
                                                                                # 0.2 past the back face and lifted the print off the bed
    return Manifold.batch_boolean(out, ADD)


def back_lip():
    """the lip round the back plate's edge: on the rebate's 45 deg seat (radius r out from the bore at y = SEAT_Y - REB_T + r)
    from inside the 0.25 gap out to LIP_R, then straight to the back face for LIP_FOOT. On the bed in the print, narrowing
    as it rises"""
    def lip(air):
        on_seat = lambda r: SEAT_Y - REB_T + r + air
        r_in, y_top = -DR.TRAY_CL - 0.3, SEAT_Y - REB_T + LIP_R + air
        assert DR.Y1 - y_top > 0.3, y_top
        m = Manifold.batch_hull([prism_y(rr_odd(r_in), on_seat(r_in), on_seat(r_in) + 0.01), prism_y(rr_odd(LIP_R), y_top, DR.Y1)])
        ri = -DR.TRAY_CL - DR.TRAY_WT + 1.0                   # its inside 1 mm into the walls (no face shared with them)
        return m - prism_y(rr_odd(ri), on_seat(r_in) - 1, DR.Y1 + 1)
    return (lip(SEAT_AIR) - end_flats()) + (lip(SEAT_AIR + END_RELIEF) ^ end_flats(0.01))


def end_flats(grow=0.0):
    """the end walls' flats (between the corners' arcs), where the lip is relieved; grown by grow inward and in z"""
    hz = BORE_HZ - BORE_R + grow
    return Manifold.batch_boolean([box(BORE_HX - 3.0 - grow, BORE_HX + 3.0, 0, D + 1, ZC - hz, ZC + hz),
                                   box(-BORE_HX - 3.0, -BORE_HX + 3.0 + grow, 0, D + 1, ZC - hz, ZC + hz)], ADD)


def chassis():
    t = base_tray()
    pf_add, pf_cut = port_frame()
    t = (t + pf_add + port_stop()) - pf_cut - s3_post_relief()
    # no crush ribs; the front edge clear of the diffuser's flange, which sits RIM_GAP further back
    t = t ^ prism_y(rr_cs(BORE_HX - DR.TRAY_CL, BORE_HZ - DR.TRAY_CL, BORE_R - DR.TRAY_CL), 0, D)
    t = t - box(-400, 400, 0, DR.YF + RIM_GAP + FRONT_CL, -5, H + 5)
    # the encoder (V5's slot in the top wall and its rails are not built: encoder=False): rails, lips, bosses, the opening
    ra, rc = rails_lips_bosses()
    t = (t + ra) - rc
    t = t - Manifold.batch_boolean([cyl_y(x, ZC + z, BOSS_Y - WASHER_REC[1] - 1, BOSS_Y, WASHER_REC[0], 48) for x, z in DR.INSERTS], ADD)
    t = t + back_lip()
    t = t + pads(t) + lands()
    return max(t.decompose(), key=lambda m: m.volume())


# ---------------------------------------------------------------- the knob seat and ring
def knob_seat():
    """the encoder's seat (case frame): a disc in the walnut's hole from the chassis's top face to the case top, a key in the
    chassis's opening below it, V5's collar pocket and deck (collar.py), the two screws' holes. Prints top face down."""
    disc = Manifold.extrude(CrossSection.circle(SEAT_HOLE / 2 - SEAT_CL, 160).translate([0, KY]), H - ZO1).translate([0, 0, ZO1])
    key = Manifold.extrude((passage_cs(WALL_OPEN - SPIG_CL) + gable_cs(WALL_OPEN - SPIG_CL)) ^ CrossSection.circle(SEAT_HOLE / 2 - SEAT_CL - 0.3, 160).translate([0, KY]), ZO1 - ZIN1 + 0.01).translate([0, 0, ZIN1])
    s = disc + key                         # the key's notch and corners stop 0.3 inside the disc: it comes down through the walnut
    cuts = [cyl_z(0, KY, ZIN1 - 1, H + CO.DECK_BOT, 2 * CO.POCKET_R, 96),
            cyl_z(0, KY, ZIN1 - 1, H + 1, 2 * CO.BUSH_R, 64),
            cyl_z(0, KY, H + CO.DECK_BOT - 0.1, H + 1, 2 * CO.RELIEF_R, 64)]          # through: the ring's underside goes on
    cuts += [cyl_z(x, y, ZIN1 - 1, H + 1, TS_CLEAR, 32) for x, y in TS_XY]
    cuts.append(box(-PIX_HX, PIX_HX, KY + PIX_Y[0], KY + PIX_Y[1], ZIN1 - 1, ZIN1 + PIX_RELIEF))   # over the board's NeoPixel (v6.PIX_RELIEF): closed at the
                                                    # front, so its light has no way out round the key under the ring
    # a 0.4 lead-in round the key's foot, so it finds the opening
    o = WALL_OPEN - SPIG_CL
    ko = lambda g: passage_cs(g) + gable_cs(g)
    lead = Manifold.extrude(ko(o + 0.01), 0.4).translate([0, 0, ZIN1 - 0.01]) - \
        Manifold.batch_hull([Manifold.extrude(ko(o - 0.4), 0.01).translate([0, 0, ZIN1 - 0.02]),
                             Manifold.extrude(ko(o), 0.01).translate([0, 0, ZIN1 + 0.4])])
    return s - Manifold.batch_boolean(cuts, ADD) - lead


def trim_ring():
    """the P4 V6's ring (RING_R, the collar's flange profile) lying flat on the knob seat: 1.6 thick there (the nut clamps it,
    as the P4's cap and the seat's deck clamp together: 3.0 over the encoder's body, V5's collar deck), raised RING_LIFT
    over the walnut outside the seat"""
    R = RING_R
    fl = CO.cyl(R, 0, CO.FL_T - CO.FL_CH) + CO.cyl(R, CO.FL_T - CO.FL_CH, CO.FL_T, R - CO.FL_CH)
    lift = CO.cyl(R + 1, -1, RING_LIFT) - CO.cyl(SEAT_HOLE / 2 - SEAT_CL - 0.2, -2, RING_LIFT + 1)
    ring = fl - lift - Manifold.cylinder(CO.FL_T + 2, CO.BUSH_R + 0.1, CO.BUSH_R + 0.1, 64).translate([0, 0, -1])
    ring = ring - CO.cyl(CO.RELIEF_R, -1, 0.2)                                      # the relief, carried on from the seat's deck
    ring = ring - Manifold.batch_boolean([Manifold.cylinder(CO.FL_T + 2, TS_HEAD / 2, TS_HEAD / 2, 48).translate([x, y - KY, -1]) for x, y in TS_XY], ADD)
    return ring.translate([0, KY, H])


# ---------------------------------------------------------------- what goes inside (checks, renders)
def diffuser_in_case():
    import diffuser as DF
    m = DF.diffuser()
    return m.transform([[1, 0, 0, 0], [0, 0, 1, Y_FACE + RIM_GAP], [0, -1, 0, ZC]])


def panel_p3():
    """the P3 in the case, turned 180 deg: LED board (2.5 incl. LEDs), housing to its back (a 6 mm frame and the insert
    bosses; the inside ribs not modelled), the two shrouds (top 1 mm under the back, ASSUMED), a ribbon plug on data in"""
    yf, yb = Y_FACE + 0.2 + 1.5 + RIM_GAP, PB
    pw, ph = panel.P['w'], panel.P['h']
    parts = [box(-pw / 2, pw / 2, yf, yf + 2.5, ZC - ph / 2, ZC + ph / 2)]
    hous = box(-pw / 2, pw / 2, yf + 2.5 - 0.01, yb, ZC - ph / 2, ZC + ph / 2) - box(-pw / 2 + 6, pw / 2 - 6, yf, yb + 1, ZC - ph / 2 + 6, ZC + ph / 2 - 6)
    for x, z in DR.INSERTS:
        hous = hous + cyl_y(x, ZC + z, yf + 2.5, yb, 8.5, 32)
    parts.append(hous)
    for x, z in DR.HEADERS:
        parts.append(box(x - 4.45, x + 4.45, yf + 2.5, yb - 1.0, ZC + z - 10.15, ZC + z + 10.15))
    pi = min(DR.HEADERS, key=lambda h: h[0])
    parts.append(box(pi[0] - 6.5, pi[0] + 6.5, yb - 1.0, yb + 8.0, ZC + pi[1] - 17.0, ZC + pi[1] + 17.0))
    return Manifold.batch_boolean(parts, ADD)


def standoffs():
    af = STANDOFF_AF / math.sqrt(3)
    out = []
    for x, z in DR.INSERTS:
        out.append(Manifold.cylinder(STANDOFF_L, af, af, 6).rotate([-90, 0, 0]).translate([x, PB, ZC + z]))
        out.append(cyl_y(x, ZC + z, PB + STANDOFF_L, PB + STANDOFF_L + WASHER_T, 7.0, 32))
    return Manifold.batch_boolean(out, ADD)


def encoder(dz=0.0):
    """the 5880 as seated (sensor.py's envelopes) with its bushing and a QT plug in the right socket, its cable bent down"""
    e = SN.envelopes()
    m = e['enc_pcb'] + e['enc_body'] + e['enc_qt'] + e['enc_pins']
    m = m + cyl_z(0, KY, H + CO.DECK_BOT, H + 6.0, 7.0, 48)
    m = m + plug() + pixel()
    return m.translate([0, 0, dz])


def pixel():
    """the encoder's NeoPixel (PIX): at the board's front edge, between its front mounting holes"""
    hx, y0, y1, h = PIX
    return box(-hx, hx, KY + y0, KY + y1, SN.EB_TOP, SN.EB_TOP + h)


def plug():
    """the QT plug in the encoder's right socket (out 6 past the board's edge, p4.encoder_envelope) and its cable bending down"""
    eb = SN.EB_BOT
    return box(8.5, 18.7, KY - 3.0, KY + 3.0, eb - 2.96, eb) + box(17.2, 20.2, KY - 1.5, KY + 1.5, eb - 12.0, eb - 1.0)


def screws():
    """seated: the two from below (flat heads, in their countersinks, pulled UNDER_BIAS back against the seat), the knob
    seat's two M2.5 x 8, six M3 x 8 flanged into the standoffs from the back"""
    under, knob, back = [], [], []
    k = (CSK_HEAD - 3.0) / 2                                  # the head's cone; a CSK_HEAD_K - k rim under it, level with the face
    rim = CSK_HEAD_K - k                                      # in a CSK_D mouth (DIN 7991 in 6.4)
    for x, y in UNDER_XY:
        m = Manifold.cylinder(rim, CSK_HEAD / 2 - 0.02, CSK_HEAD / 2 - 0.02, 32) + Manifold.cylinder(k, CSK_HEAD / 2 - 0.02, 1.5, 32).translate([0, 0, rim]) \
            + Manifold.cylinder(10.0 - CSK_HEAD_K, 1.5, 1.5, 24).translate([0, 0, CSK_HEAD_K])
        under.append(m.translate([x, y, 0.0]))                # on the screw's axis, UNDER_BIAS off the cone's, which is sunk as much: flush
    for x, y in TS_XY:
        knob.append(cyl_z(x, y, H, H + TS_HEAD_K, TS_HEAD_D, 48) + cyl_z(x, y, H - TS_LEN, H + 0.01, 2.5, 32))
    seat = BOSS_Y - WASHER_REC[1] + P3.SO_FLOOR
    for x, z in DR.INSERTS:
        back.append(cyl_y(x, ZC + z, seat - 8.0, seat, 3.0, 24) + cyl_y(x, ZC + z, seat, seat + 1.65, 6.9, 32))
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return dict(under=u(under), knob=u(knob), back=u(back))


def build():
    return dict(sleeve=sleeve(), chassis=chassis(), seat=knob_seat(), ring=trim_ring(), panel=panel_p3(),
                diffuser=diffuser_in_case(), standoffs=standoffs(), encoder=encoder(), s3=DR.s3_envelope(),
                sensor=DR.sensor_envelope() + DR.sensor_plugs(), sled=DR.sled(), screws=screws())


def tilted(m, deg):
    """m turned deg about the y axis through the board's centre, its right side (the plug's) down"""
    zc = (SN.EB_TOP + SN.EB_BOT) / 2
    return m.translate([0, 0, -zc]).rotate([0, deg, 0]).translate([0, 0, zc])


def vent_area(t, fall=None):
    """the louvers' through area (mm2): for each of the six rows, the part of its slot's cross-section (+/- LV_H / 2 about its
    centre line, within the rows' x span) open at every one of twelve depths from the back face to the band's inside, the
    cross-sections taken square to the back face and shifted onto one another along the slot's 45 deg. A stretch closed at any
    depth (a blind tie) counts for nothing, and nothing outside the slots (post bores, chamfers) counts. Square to the back
    face, not to the 45 deg slot: the true throat is about 0.71 of it, so compare it with V5's, not with a fan's rating"""
    r = DR.LV_H / 2
    fall = DR.TOP_FALL if fall is None else fall
    xl = min(abs(x) for x, z in DR.CORNERS) - DR.SO_D / 2 - 2.0          # the rows' span (drawer.tray's x_lim)
    zs = [ZIN1 - 2.5 - r - i * DR.LV_PITCH for i in range(DR.LV_ROWS)] + [ZIN0 + 2.5 + r + i * DR.LV_PITCH for i in range(DR.LV_ROWS)]
    y_in = DR.Y1 - DR.LV_DEPTH
    m = t.rotate([-90, 0, 0])                                      # (x, y, z) -> (x, z, -y): slice at -y gives the (x, z) section
    ys = np.linspace(DR.Y1 - 0.3, y_in + 0.2, 12)
    secs = [m.slice(-y) for y in ys]
    tot = 0.0
    for zc in zs:
        s = -1 if (zc > ZC and fall) else 1                        # the slot rises (or falls) LV_DEPTH going inward
        through = None
        for y, sec in zip(ys, secs):
            dz = s * (DR.Y1 - y)
            win = CrossSection.square([2 * xl, 2 * r]).translate([-xl, zc + dz - r])
            open_ = (win - sec).translate([0, -dz])
            through = open_ if through is None else through ^ open_
        tot += through.area()
    return tot


def check(P):
    """overlap volumes (mm3) that should be zero, and the ways in"""
    v = lambda a, b: round((a ^ b).volume(), 2)
    ch, sl, seat, ring = P['chassis'], P['sleeve'], P['seat'], P['ring']
    dif, pan, so, enc, s3, sen = P['diffuser'], P['panel'], P['standoffs'], P['encoder'], P['s3'], P['sensor']
    S = P['screws']
    saved, DR.TOP_FALL = DR.TOP_FALL, False
    try:
        v5 = DR.tray()                                             # V5's tray as printed
    finally:
        DR.TOP_FALL = saved
    rows = [(f'chassis on the bed: its back {ch.bounding_box()[4]:.3f}, the plate\'s outer face {DR.Y1:.3f}', round(abs(ch.bounding_box()[4] - DR.Y1) * 100, 2)),
            (f'sleeve on the bed: its back {sl.bounding_box()[4]:.3f}, D {D:.3f}', round(abs(sl.bounding_box()[4] - D) * 100, 2)),
            ('sleeve / chassis, seated (the lip on the seat)', v(sl, ch)),
            ('chassis 0.1 further forward / sleeve (the lip meets the seat: > 0)', 0.0 if v(ch.translate([0, -0.1, 0]), sl) > 0.5 else 1.0),
            ('chassis / panel', v(ch, pan)), ('chassis / diffuser', v(ch, dif)), ('sleeve / diffuser', v(sl, dif)),
            ('sleeve 0.1 further back / diffuser (the rim keeps at least that)', v(sl.translate([0, 0.1, 0]), dif)),
            ('diffuser 0.25 further back / chassis (its flange has that behind it)', v(dif.translate([0, 0.25, 0]), ch)),
            ('chassis / standoffs', v(ch, so)),
            ('chassis / S3, beyond the V5 tray less the post relief (its posts stand in the envelope)', round(v(ch, s3) - v(v5 - s3_post_relief(), s3), 2)),
            ('chassis / sensor and its plugs', v(ch, sen)), ('chassis / sensor sled', v(ch, P['sled'])),
            ('chassis / encoder and its QT plug, seated', v(ch, enc)),
            ('knob seat / chassis', v(seat, ch)), ('knob seat / sleeve', v(seat, sl)), ('knob seat / encoder', v(seat, enc)),
            ('ring / sleeve', v(ring, sl)), ('ring / chassis', v(ring, ch)), ('ring / encoder (the bushing)', v(ring, enc)),
            ('ring / knob seat', v(ring, seat)),
            ('standoffs / encoder, S3, sensor', v(so, enc + s3 + sen)),
            ('encoder / panel, S3, sensor, sled', v(enc, pan + s3 + sen + P['sled'])),
            ('the NeoPixel 1.0 taller than drawn, 0.5 bigger round / knob seat (the relief: 2.4 over the board)',
             v(box(-PIX[0] - 0.5, PIX[0] + 0.5, KY + PIX[1] - 0.5, KY + PIX[2] + 0.5, SN.EB_TOP, SN.EB_TOP + PIX[3] + 1.0), seat))]
    # screws
    rows.append(('screws from below / sleeve and chassis (a 3.0 shank in 3.4 holes and the insert)', v(S['under'], ch + sl)))
    core = Manifold.batch_boolean([cyl_z(x, y, H - TS_LEN, H, 1.9, 24) for x, y in TS_XY], ADD)
    rows.append(('knob seat screws: core (1.9) / chassis, seat (pilots and holes open)', v(core, ch + seat)))
    rows.append(('knob seat screws / seat (2.9 holes)', v(S['knob'], seat)))
    rows.append(('knob seat screws / encoder, plug, panel, sensor', v(S['knob'], enc + pan + sen)))
    rows.append(('back screws / chassis (holes open)', v(S['back'], ch - box(-400, 400, BOSS_Y - WASHER_REC[1] + P3.SO_FLOOR - 0.01, BOSS_Y - WASHER_REC[1] + P3.SO_FLOOR + 0.03, -5, H + 5))))
    rows.append(('back screws / panel, S3, sensor, encoder', v(S['back'], pan + s3 + sen + enc)))
    # USB-C (v6.check)
    py, pz = DR.PORT_Y, DR.PORT_Z
    plg = box(DR.S3_EDGE + 0.5, HW + 20, py - 3.5, py + 3.5, pz - 6.425, pz + 6.425)
    rows.append(('largest USB-C plug housing (12.85 x 7.0) in to 0.5 mm from the board / chassis and sleeve', v(plg, ch + sl)))
    face = DR.PCB_Y0 + 1.6
    edge = [box(DR.S3_EDGE - 0.5, DR.S3_EDGE + max(past, 0.5 if name == 'receptacle' else 0.0) + 0.4, DR.YF, face + y1 + 0.4, pz + z0 - 0.4, pz + z1 + 0.4)
            for name, (z0, z1, past, y0, y1) in S3_EDGE_PARTS.items()]
    rows.append(("the S3's receptacle (0.5 proud) and button plungers, 0.4 clear, seated and swept in from the front / chassis", v(Manifold.batch_boolean(edge, ADD), ch)))
    rows.append(("a seated USB-C plug's metal shell / chassis and sleeve", v(box(DR.S3_EDGE - 6.2, HW + 5, py - 1.3, py + 1.3, pz - 4.2, pz + 4.2), ch + sl)))
    gap = 9.0
    for post, deg, dist, y0, y1 in S3_NEAR:
        hx, hz = DR.S3_HOLES[post]; ux, uz = s3_dir(deg)
        gap = min(gap, cyl_y(hx + dist * ux, hz + dist * uz, face + y0 + 0.02, face + y1, 0.02, 8).min_gap(ch, 2.0) - 0.01)
    rows.append((f"the parts beside the S3's posts, nearest {gap:.2f} / chassis (0.3 or more)", 0.0 if gap >= 0.3 else round(0.35 - gap, 2)))
    top = face + S3_EDGE_PARTS['receptacle'][4]
    tip = box(DR.S3_EDGE - 2.5, DR.S3_EDGE - 0.5, top + 0.7, top + 1.5, pz - 4.1, pz + 4.1)
    rows.append(("a plug's tip over the receptacle, not blocked by the port stop, mm3", round(tip.volume() - (tip ^ ch).volume(), 2)))
    va = vent_area(ch)
    rows.append((f'louver open area {va:.0f} mm2 (V5 {vent_area(v5, False):.0f}; at least {VENT_MIN:.0f})', 0.0 if va >= VENT_MIN else round(VENT_MIN - va, 1)))
    # the ways in
    loaded = ch + pan + so + dif + s3 + sen + P['sled']
    rows.append(('loaded chassis sliding into the sleeve from the back (0.3-70 mm out)', round(max(v(loaded.translate([0, q, 0]), sl) for q in (0.3, 0.5, 1, 2, 4, 8, 16, 24, 32, 40, 50, 60, 70)), 2)))
    rows.append(('panel with its standoffs and washers going into the chassis from the front (1-40 mm out)', round(max(v((pan + so).translate([0, -q, 0]), ch) for q in (1, 2, 4, 8, 16, 24, 32, 40)), 2)))
    rest = sl + ch + pan + so + s3 + sen + P['sled']
    straight = max(v(enc.translate([0, 0, q - LIP_DROP]), rest) for q in (0.05, 1, 2, 4, 8, 12, 16, 24, 32, 40))
    rows.append((f'encoder lowered straight in, plug and cable on, onto the lips (info: {straight} mm3, the cable\'s bend; it goes in tilted)', 0.0))
    d0, q0 = TILT
    path = [(d0, q) for q in (40, 30, 24, 20, 16, 12, 10)] + [(d0 * q / q0, q) for q in np.linspace(q0, 0, 13)]
    worst = max(v(tilted(enc, d).translate([0, 0, q - LIP_DROP]), rest) for d, q in path)
    rows.append((f'encoder lowered in tilted {d0:.0f} deg, plug side first, levelled over the last {q0:.0f} mm onto the lips', worst))
    rows.append(('encoder resting on the lips / chassis', v(enc.translate([0, 0, -LIP_DROP]), ch)))
    rows.append(('encoder 0.1 lower than the lips / chassis (they hold it: > 0)', 0.0 if v(enc.translate([0, 0, -LIP_DROP - 0.1]), ch) > 0.05 else 1.0))
    rows.append(('knob seat lowered on over the bushing (0.3-30 mm up) / sleeve, chassis, encoder on its lips',
                 round(max(v(seat.translate([0, 0, q]), sl + ch + enc.translate([0, 0, -LIP_DROP])) for q in (0.3, 0.5, 1, 2, 4, 8, 16, 30)), 2)))
    w = min(abs(x) - TS_PILOT / 2 - PASS for x, _ in TS_XY)
    rows.append((f'knob seat screws: PETG between each pilot and the board\'s opening {w:.2f} (0.5 or more; the P4\'s 0.65)', 0.0 if w >= 0.5 else round(0.5 - w, 2)))
    hd = max(math.hypot(x, y - KY) + TS_HEAD_D / 2 for x, y in TS_XY)
    rows.append((f'knob seat screw heads end {hd:.2f} from the axis; the knob {KNOB_R} (hidden from above: >= 0.5 short)', 0.0 if hd <= KNOB_R - 0.5 else round(hd - KNOB_R + 0.5, 2)))
    rg = ring.min_gap(sl, 1.0)
    rows.append((f'ring over the walnut {rg:.2f} (0.3 or more)', 0.0 if rg >= 0.3 else round(0.3 - rg, 2)))
    eg = (ch ^ end_flats(-0.5)).min_gap(sl, 1.0)
    rows.append((f'lip on the end walls\' flats {eg:.2f} off the seat (0.1 or more: the seat bears top and bottom)', 0.0 if eg >= 0.1 else round(0.1 - eg + 0.05, 2)))
    under_sh = Manifold.batch_boolean([cyl_z(x, y, -1, WALL + 1, 3.0, 32) for x, y in UNDER_XY], ADD)
    rows.append(('screws from below, sleeve 0.15 short of its seat / walnut (the shank clears it)', v(under_sh, sl.translate([0, -0.15, 0]))))
    rows.append(('knob seat, sleeve 0.3 short of its seat / walnut', v(seat, sl.translate([0, -0.3, 0]))))
    cover = math.hypot(math.sqrt(2) * SEAT_HOLE / 2 - SEAT_TRUNC, SEAT_TRUNC)      # the teardrop's flat's corners
    rows.append((f'the ring covers the walnut hole (its corners {cover:.2f} from the axis, the ring {RING_R}; 1.0 or more)', 0.0 if RING_R - cover >= 1.0 else round(1.0 - RING_R + cover, 2)))
    # the cleat (V5's, on the back plate inside the chassis's back walls)
    import cleat as CLT
    cc, wc = CLT.case_cleat(), CLT.wall_cleat()
    rows.append(('case cleat / chassis and back screws', v(cc, ch + S['back'])))
    hung = [ch, sl, cc]
    seated = lambda dx=0.0, dy=0.0, dz=0.0: round(sum(v(m.translate([dx, dy, dz]), wc) for m in hung), 2)
    hk = CLT.hook()
    rows.append(('wall cleat / chassis, sleeve, case cleat, hung', seated()))
    rows.append((f'lifted straight off the wall cleat (0.5 to {hk + 6:.0f} mm; hook {hk:.1f})', max(seated(dz=q) for q in np.arange(0.5, hk + 6.01, 0.5))))
    return rows


if __name__ == '__main__':
    import shutil, trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    P = build()

    def save(m, name, bed='back', frame=None):
        """back: the case's back on the bed, as every V5 part; top: turned over, the top face on the bed"""
        turn = (lambda q: q.rotate([-90, 0, 0])) if bed == 'back' else (lambda q: q.mirror([0, 0, 1]))
        m, ref = turn(m), turn(frame if frame is not None else m)
        me = m.to_mesh()
        t = trimesh.Trimesh(vertices=np.asarray(me.vert_properties)[:, :3], faces=np.asarray(me.tri_verts)); t.merge_vertices()
        b = ref.bounding_box()
        t.apply_translation([-(b[0] + b[3]) / 2, -(b[1] + b[4]) / 2, -b[2]])
        t.export(f'{out}/{name}.stl')
        return f'{name}: {np.round(t.extents, 1).tolist()} on the bed, {m.volume() / 1000:.1f} cm3, {len(t.split(only_watertight=False))} body'
    pre = 'p3-v6-'
    print(save(P['sleeve'], f'{pre}sleeve-walnut'))
    print(save(P['chassis'], f'{pre}chassis-black'))
    print(save(DR.status_window(), f'{pre}chassis-window-translucent', frame=P['chassis']))
    print(save(P['seat'], f'{pre}knob-seat-black', 'top'))
    print(save(P['ring'], f'{pre}trim-ring-black', 'top'))
    import cleat as CLT
    for m, name in ((DR.sled(), 'sensor-sled-black'),):
        me = m.to_mesh(); t = trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3], np.asarray(me.tri_verts)); t.merge_vertices()
        t.apply_translation(-t.bounds[0]); t.export(f'{out}/{pre}{name}.stl'); print(f'{pre}{name}: {np.round(t.extents, 1).tolist()}')
    # reused unchanged: the P4 V6's knob, V5's diffuser, cleats and Boot key (the cleats are drawer.py's: the back plate and
    # its bosses are V5's)
    here = os.path.dirname(os.path.abspath(__file__))
    reused = [('p4-v6/p4-v6-knob-white', 'knob-white'), ('bar-diffuser-white-face', 'diffuser-face-white'),
              ('bar-diffuser-white-grid-black', 'diffuser-grid-black'), ('v5-drawer/bar-cleat-case', 'cleat-case-black'),
              ('v5-drawer/bar-cleat-wall', 'cleat-wall-black'), ('bar-boot-key', 'boot-key')]
    for a, b in reused:
        shutil.copyfile(os.path.join(here, '..', 'stl', a + '.stl'), os.path.join(out, pre + b + '.stl'))
    print('reused:', ', '.join(pre + b for _, b in reused))
    print(dict(case=[round(2 * HW, 1), round(H, 1), D], wall=WALL, rim_gap=RIM_GAP, rebate=(REB_T, round(D - SEAT_Y, 2)), seat_hole=SEAT_HOLE,
               post_seat_from_back=round(DR.Y1 - (BOSS_Y - WASHER_REC[1] + P3.SO_FLOOR), 2),
               under_thread_mm=round(10.0 - ZO0, 2), knob_screw_thread_mm=round(TS_LEN - (H - ZO1), 2)))
    hits = 0
    for name, val in check(P):
        print(f'  {"ok  " if val < 0.05 else "HIT "} {name}: {val}')
        hits += val >= 0.05
    print('PASS' if not hits else f'FAIL ({hits})')
    sys.exit(1 if hits else 0)
