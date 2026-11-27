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
    plate (its 4 mm inside the rim, the cleat's bosses and everything inside are V5's);
  - two black M3 x 10 flat heads from below in round countersinks (V6's), into inserts in V5's bottom bosses. The
    countersinks are drawn UNDER_BIAS in front of the screws and as much deeper: tightened, each head pulls the sleeve
    back onto the seat (a draw-bore) and ends flush; the seat, not the screws, sets the depth and the rim gap is the model's. A land round each screw
    (V6's lands()) so the walnut is clamped onto PETG;
  - V5's knob hole (24, teardrop), for V5's collar.
- **Knob** toward the right end (KX, 45 mm from it, as on the V5 double-wide; V6P3_KNOB_X moves it), the light sensor
  40 mm toward the centre (p3x2.py's grouping). The encoder's QT cable from the sensor goes into its left socket.
- **Knob, collar, encoder: V5's** (Nov 26: the P3's knob is meant to be smaller than the P4's). V5's 30 mm knob
  (stl/bar-knob.stl) on V5's 35 mm collar (collar.py, built for the 4 mm wall), the encoder clamped up into the collar
  by its nut before the chassis goes in, and V5's open slot and rails in the chassis's top wall, which slide past it.
  Draft 1's PETG knob seat (the encoder dropped in from above, P4-style, through a 37.5 mm hole) needed the P4's
  39 mm knob to hide its screws; it is in git history (PR #557, commits up to df03719). What V6 adds here: two
  **ledges** under the board's side edges behind its QT sockets, LEDGE_GAP under it, ramped at the front: a knob press
  that moves the encoder down that far lands in the chassis, not only in the walnut.
- **Diffuser, sensor sled, Boot key**: V5's (stl/), reused. The diffuser rides on the panel RIM_GAP behind the rim, as on
  the P4.
- **Underneath**: marks.py's two label recesses, as on the V5 shell and the P4 (label_cuts()).
- **Cleats** (Nov 27): the P4 V6's design: a 60 deg bevel, a stop outside each end of the case cleat, pockets, three
  wall screws; and a channel for the USB-C cable in the wall cleat's wall face (cleats()). V5's cleats do not fit these.

Assembly in V5's order (the panel's top edge passes where the encoder's board hangs, so the panel goes in first):
1. On the bench: standoffs into the panel's inserts, the diffuser snapped on, the ribbon and power leads on the panel.
2. Sleeve on its hood: panel in from the back, standoffs up, forward onto the rim; a washer on each standoff's end.
3. Sleeve top down: the collar in its hole, the encoder up into it from inside, nut on (V5: README "Encoder"); its QT
   cable plugged in and routed down.
4. Chassis (S3, sensor, sled on it; the cables to the S3 plugged in) slides in from the back, its posts onto the
   standoffs; six M3 x 8 from the back through the post tubes, the two flat heads from below; then the knob.
Service: the reverse; the chassis comes out with the encoder left in the sleeve. Print the
sleeve with a brim: back-down, its footprint is now the 2.5 mm ring behind the rebate.

The V6 constants and functions below are copies of v6.py's (named where they come from). v6.py imports p4.py, which
sets up the P4 panel profile at import, so the P3 cannot import it. Merging the two into one module that takes a
panel is a later cleanup, once both are printed.
"""
import math, os, sys
os.environ.setdefault('PANEL', 'p3')
if os.environ['PANEL'] not in ('p3', 'p3x2'):          # p3x2: v6p3x2.py borrows the sleeve for the 128 (its walnut stage)
    raise SystemExit('v6p3.py is the P3 build (PANEL=p3)')
os.environ.setdefault('CASE_WALL', '4.0')       # the P4 V6 skin's wall (V5's P3 sleeve: 3.5); the bore is unchanged
import numpy as np
from manifold3d import Manifold, CrossSection, JoinType
import case as C
import case2 as V
# The knob toward the right end (owner, Nov 26: "similar to the V5 double-wide"): 45 mm from the end as on p3x2.py (x +162 on
# its 414 case), the light sensor 40 mm toward the centre (p3x2.py's grouping). Set before sensor.py loads (it reads it once)
KX = float(os.environ.get('V6P3_KNOB_X', str(C.HW - 45.0)))
V.SENSOR_X = KX - 40.0
import plate3 as P3
import drawer as DR
import collar as CO
import sensor as SN
import panel
from case import box, cyl_y, cyl_z, prism_y, rr_cs, ADD, ZC, H, D, WALL, HW, KY, BORE_HX, BORE_HZ, BORE_R, Y_FACE, \
    PANEL_BACK, BACKL

DR.configure_shell()
V.BACKDOWN = True
DR.ENC_X = KX
CO.TIP_BACK = False              # the collar's teardrop to the front, as the back-down sleeve's hole (drawer.py)
DR.SLED_SCREW = (V.SENSOR_X + 8.0, DR.SLED_SCREW[1])     # the sled's front screw 8 mm from the chip toward the knob (p3x2.py)
PLUG_SIDE = -1                   # the encoder's QT cable in its left socket, toward the sensor (S3 -> sensor -> encoder): the
                                 # notch, the plug and the way in are drawn on the right and mirrored when this is -1


def at_knob(m):
    """a part drawn with the knob's axis at x 0 and the plug on the right, put in place"""
    return (m.mirror([1, 0, 0]) if PLUG_SIDE < 0 else m).translate([KX, 0, 0])

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
KNOB_R = 15.0                    # V5's P3 knob (stl/bar-knob.stl, 30), for the renders

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
LEDGE_GAP = 0.2                  # the ledges: this far under the encoder board, as hung from its collar ...
LEDGE_W, LEDGE_T = 1.2, 1.2      # ... this far in under its side edges, this thick ...
LEDGE_Y0 = 3.5                   # ... from this far behind the board's centre (its QT sockets and the plug, at +/-3, pass over
                                 # the ledges' line as the chassis slides in: only behind them can a ledge stand) back to the band
PIX = (1.5, -11.0, -8.4, 0.9)    # the encoder's NeoPixel: half width, its front and back edges from the board's centre (y), its
                                 # height. Measured Nov 26 from Adafruit's photo of the 5880 (mounting holes 20.32 apart for scale):
                                 # 3.0 x 2.6, centred on the board, between the front holes. Its height is still assumed
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


# ---------------------------------------------------------------- the sleeve
def rr_odd(r):
    """the bore's outline offset by r, its corners on a segment count of their own: a hull between two of these crosses the
    chassis's walls (rr_cs, C.SEG) away from their vertices, where a shared vertex line left near-duplicate points in the STL"""
    rr = max(BORE_R + r, 0.3)
    return CrossSection.square([2 * (BORE_HX + r - rr), 2 * (BORE_HZ + r - rr)], center=True).offset(rr, JoinType.Round, circular_segments=C.SEG + 13).translate([0, ZC])


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
    saved = V.SCREW_XS, V.KNOB_X
    V.SCREW_XS, V.KNOB_X = (), KX                       # V5's slotted holes underneath: replaced below; its knob hole at KX
    try:
        sh = V.shell2()
    finally:
        V.SCREW_XS, V.KNOB_X = saved
    cuts = [rebate()]
    cuts += [csk_under(x, y) for x, y in UNDER_XY]
    if LABELS:
        cuts.append(label_cuts())
    return sh - Manifold.batch_boolean(cuts, ADD)


LABELS = True                      # v6p3x2.py turns this off: the 128 puts its own under half B, off the seam


def label_cuts():
    """the two label recesses underneath (marks.py: the regulatory label 1 x 2 5/8 in and the setup sticker 1/2 x 1 3/4 in,
    0.5 deep), as on the V5 shell and the P4: centred, in front of the screws from below"""
    import marks as MK
    bad = MK.check(MK.layout()[0])
    assert not bad, bad
    return MK.cuts()


# The cleats (Nov 27): the P4 V6's design (p4.py, Nov 17) with what the 128's independent review of its wall hanging found
# (v6p3x2.py). A 60 deg bevel (about 17 mm of lift to unhook; V5's 45 deg: 10), a stop on the wall cleat outside each end
# of the case cleat (pushing the USB-C plug in at the right end pushes the bar along the cleat; pulling it, the other
# way), pockets in its wall face, a flat counterbore wide enough for a flanged head. The wall cleat is 171 long (the
# stops end 0.4 short of the Boot hole), past the knob (x 65), so a knob press cannot rock the bar on its end. Three wall
# screws, +/-65 and the centre (a stud), 20 mm above its bottom edge (the middle of the wall face gave the anchors poor
# leverage). Drywall: self-drilling or molly anchors, not small plastic cones.
CLEAT_BEVEL = 60.0
CLEAT_STOPS = (0.8, 9.7, 5.0)      # clearance each side, length, lead-in
CLEAT_POCKETS = (8.0, 4.0)         # depth (of 12), rib
WALL_CLEAT_XS = (-65.0, 0.0, 65.0)
WALL_SCREW_Z = 50.0
# The USB-C cable: from a right-angle plug at the right end (the port's long side is vertical: the usual kind turns the
# cable back toward the wall) it runs behind the bar (12 mm between the back plate and the wall, 8 behind the walnut's
# rim) and into a channel in the wall cleat's wall face, under the screws and through the pockets' ribs, the cleat's full
# length, with slots down through its floor where the cable can drop (or it runs on out of the left end). Laid in before
# the cleat is screwed to the wall; the wall closes it.
CABLE_CH = (5.0, 6.5, 6.5)         # the channel: its floor this far above the cleat's bottom edge, its height, its depth from the wall
CABLE_D = 5.5                      # the thickest cable it is checked for
CABLE_EXITS = (-45.0, -20.0, 20.0, 45.0)     # x of the slots down through the floor (7 wide)


def cleats():
    """(case cleat, wall cleat, cleat module)"""
    import cleat as CLT
    CLT.BEVEL_DEG, CLT.WALL_STOPS, CLT.WALL_POCKETS, CLT.CBORE_D = CLEAT_BEVEL, CLEAT_STOPS, CLEAT_POCKETS, 7.4
    CLT.wall_screws = lambda xs=None: [(x, WALL_SCREW_Z) for x in (WALL_CLEAT_XS if xs is None else xs)]
    assert WALL_SCREW_Z + CLT.WS_D / 2 + 1.5 <= CLT.ZB - CLT.drop(), 'the wall screws come out through the bevel'
    hw = DR.CLEAT_HW + CLEAT_STOPS[0] + CLEAT_STOPS[1]
    assert hw <= DR.S3_BOOT[0] - 2.4 - 0.3, 'the wall cleat reaches the Boot hole'
    wc = CLT.wall_cleat(hw=hw, xs=list(WALL_CLEAT_XS))
    z0, zh, dp = CABLE_CH
    za = CLT.ZW0 + z0
    assert za + zh + 3.0 <= WALL_SCREW_Z - CLT.WS_D / 2, 'the cable channel reaches the wall screws'
    cut = [box(-hw - 1, hw + 1, CLT.YW - dp, CLT.YW + 1, za, za + zh)]
    cut += [box(x - 3.5, x + 3.5, CLT.YW - dp, CLT.YW + 1, CLT.ZW0 - 1, za + 0.01) for x in CABLE_EXITS]
    return CLT.case_cleat(), wc - Manifold.batch_boolean(cut, ADD), CLT


def cable(exit_x):
    """a CABLE_D cable from the right end behind the bar, along the channel and down the slot at exit_x"""
    import cleat as CLT
    z0, zh, dp = CABLE_CH
    y, z = CLT.YW - CABLE_D / 2 - 0.3, CLT.ZW0 + z0 + zh / 2
    run = Manifold.cylinder(HW + 4.0 - exit_x, CABLE_D / 2, CABLE_D / 2, 24).rotate([0, 90, 0]).translate([exit_x, y, z])
    return run + cyl_z(exit_x, y, -5.0, z, CABLE_D, 24)


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
        t = DR.tray(post_dy={c: FOOT_DY for c in DR.CORNERS}, ties=TIES, blind=BLIND, boss_blind=True)   # V5's slot and rails at ENC_X
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


def ledges():
    """the two ledges (knob at x 0, the plug on the right: at_knob() puts them in place): under each side edge of the encoder
    board, LEDGE_GAP below it, joined up to drawer.enc_rails' rail beside it, from LEDGE_Y0 behind the board's centre back into
    the louver band. Their front ends ramp 45 deg down toward the front, so a board hanging low rides up onto them"""
    hw, (by0, by1), (bz0, bz1) = DR.enc_board()
    top = bz0 - LEDGE_GAP
    rail_lo = bz1 - DR.RAIL_LAP
    ya, yb = KY + LEDGE_Y0, DR.Y1 - DR.LV_DEPTH + 0.5
    out = []
    for sx in (-1, 1):
        xi, xo = sx * (hw + DR.RAIL_CL), sx * (hw + DR.RAIL_CL + DR.RAIL_W)
        e = sx * 0.3                                               # the web 0.3 inside the rail's faces: no face shared with it
        prof = [(xi - sx * LEDGE_W, top - LEDGE_T), (xo - e, top - LEDGE_T), (xo - e, rail_lo + 0.5), (xi + e, rail_lo + 0.5), (xi + e, top), (xi - sx * LEDGE_W, top)]
        m = along_y(prof, ya, yb)
        a, b = sorted((xi - sx * (LEDGE_W + 1), xo + sx))
        ramp = along_x([(ya - 0.01, top - LEDGE_T - 0.01), (ya + LEDGE_T + 0.01, top + 0.01), (ya - 0.01, top + 0.01)], a, b)
        out.append(m - ramp)
    return Manifold.batch_boolean(out, ADD)


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
    keep_off = [cyl_z(KX, KY, -5, H + 5, 2 * CO.FL_R + 2.0, 64)] + [cyl_z(x, y, -5, H + 5, LAND_OD + 1.0, 48) for x, y in UNDER_XY]
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
    t = t + at_knob(ledges())                                   # under the encoder board (V5's slot and rails are the tray's)
    t = t - Manifold.batch_boolean([cyl_y(x, ZC + z, BOSS_Y - WASHER_REC[1] - 1, BOSS_Y, WASHER_REC[0], 48) for x, z in DR.INSERTS], ADD)
    t = t + back_lip()
    t = t + pads(t) + lands()
    return max(t.decompose(), key=lambda m: m.volume())


# ---------------------------------------------------------------- the collar
def collar():
    """V5's encoder collar (collar.py, for this wall), in place"""
    return at_knob(CO.collar().translate([0, KY, H]))


def plain_collar():
    """the collar without its crush ribs, for the checks"""
    saved, CO.RIB_R = CO.RIB_R, None
    try:
        return collar()
    finally:
        CO.RIB_R = saved


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
    """the 5880 as seated (sensor.py's envelopes) with its bushing, a QT plug (PLUG_SIDE) and its NeoPixel, in place"""
    e = SN.envelopes()
    m = e['enc_pcb'] + e['enc_body'] + e['enc_qt'] + e['enc_pins']
    m = m + cyl_z(0, KY, H + CO.DECK_BOT, H + 6.0, 7.0, 48)
    m = m + plug()
    return at_knob(m).translate([0, 0, dz]) + pixel().translate([0, 0, dz])


def pixel():
    """the encoder's NeoPixel (PIX): at the board's front edge, between its front mounting holes"""
    hx, y0, y1, h = PIX
    return at_knob(box(-hx, hx, KY + y0, KY + y1, SN.EB_TOP, SN.EB_TOP + h))


def plug():
    """the QT plug in the encoder's socket (drawn in the right one, knob at x 0: at_knob() puts it in place), out 6 past the
    board's edge (p4.encoder_envelope), its cable bending down"""
    eb = SN.EB_BOT
    return box(8.5, 18.7, KY - 3.0, KY + 3.0, eb - 2.96, eb) + box(17.2, 20.2, KY - 1.5, KY + 1.5, eb - 12.0, eb - 1.0)


def screws():
    """seated: the two from below (flat heads, in their countersinks, pulled UNDER_BIAS back against the seat), six M3 x 8
    flanged into the standoffs from the back"""
    under, back = [], []
    k = (CSK_HEAD - 3.0) / 2                                  # the head's cone; a CSK_HEAD_K - k rim under it, level with the face
    rim = CSK_HEAD_K - k                                      # in a CSK_D mouth (DIN 7991 in 6.4)
    for x, y in UNDER_XY:
        m = Manifold.cylinder(rim, CSK_HEAD / 2 - 0.02, CSK_HEAD / 2 - 0.02, 32) + Manifold.cylinder(k, CSK_HEAD / 2 - 0.02, 1.5, 32).translate([0, 0, rim]) \
            + Manifold.cylinder(10.0 - CSK_HEAD_K, 1.5, 1.5, 24).translate([0, 0, CSK_HEAD_K])
        under.append(m.translate([x, y, 0.0]))                # on the screw's axis, UNDER_BIAS off the cone's, which is sunk as much: flush
    seat = BOSS_Y - WASHER_REC[1] + P3.SO_FLOOR
    for x, z in DR.INSERTS:
        back.append(cyl_y(x, ZC + z, seat - 8.0, seat, 3.0, 24) + cyl_y(x, ZC + z, seat, seat + 1.65, 6.9, 32))
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return dict(under=u(under), back=u(back))


def build():
    return dict(sleeve=sleeve(), chassis=chassis(), collar=collar(), panel=panel_p3(),
                diffuser=diffuser_in_case(), standoffs=standoffs(), encoder=encoder(), s3=DR.s3_envelope(),
                sensor=DR.sensor_envelope() + DR.sensor_plugs(), sled=DR.sled(), screws=screws())


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
    ch, sl, col = P['chassis'], P['sleeve'], P['collar']
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
            ('collar, less its crush ribs (V5: 0.15 into the walnut, meant) / sleeve, chassis, encoder', v(plain_collar(), sl + ch + enc)),
            ('standoffs / encoder, S3, sensor', v(so, enc + s3 + sen)),
            ('encoder / panel, S3, sensor, sled', v(enc, pan + s3 + sen + P['sled'])),
            ('the NeoPixel 1.0 taller than drawn, 0.5 bigger round / chassis, collar',
             v(at_knob(box(-PIX[0] - 0.5, PIX[0] + 0.5, KY + PIX[1] - 0.5, KY + PIX[2] + 0.5, SN.EB_TOP, SN.EB_TOP + PIX[3] + 1.0)), ch + col))]
    # screws
    rows.append(('screws from below / sleeve and chassis (a 3.0 shank in 3.4 holes and the insert)', v(S['under'], ch + sl)))
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
    steps = (0.3, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 40, 50, 60, 70)
    front = pan + so + dif                                         # V5's order: the panel first (its top edge passes where the
    rows.append(('panel, standoffs and washers, diffuser into the sleeve first (0.3-70 mm out)',   # encoder's board hangs), ...
                 round(max(v(front.translate([0, q, 0]), sl) for q in steps), 2)))
    cha = ch + s3 + sen + P['sled']                                # ... then the encoder into its collar, then the chassis
    rows.append(('chassis (S3, sensor, sled) sliding in past the encoder in its collar and the seated panel (0.3-70 mm out)',
                 round(max(v(cha.translate([0, q, 0]), sl + col + enc + front) for q in steps), 2)))
    rows.append(('the panel slid in after the encoder would hit its board (> 0: hence the order)', 0.0 if max(v(front.translate([0, q, 0]), enc) for q in (4, 8, 16)) > 1 else 1.0))
    rows.append((f'encoder {LEDGE_GAP + 0.1:.1f} lower (a knob press) / chassis: the ledges take it (> 0)', 0.0 if v(enc.translate([0, 0, -LEDGE_GAP - 0.1]), ch) > 0.05 else 1.0))
    eg = (ch ^ end_flats(-0.5)).min_gap(sl, 1.0)
    rows.append((f'lip on the end walls\' flats {eg:.2f} off the seat (0.1 or more: the seat bears top and bottom)', 0.0 if eg >= 0.1 else round(0.1 - eg + 0.05, 2)))
    under_sh = Manifold.batch_boolean([cyl_z(x, y, -1, WALL + 1, 3.0, 32) for x, y in UNDER_XY], ADD)
    rows.append(('screws from below, sleeve 0.15 short of its seat / walnut (the shank clears it)', v(under_sh, sl.translate([0, -0.15, 0]))))
    # the cleats (cleats(): the P4 V6's design, on V5's bosses on the back plate)
    cc, wc, CLT = cleats()
    rows.append(('case cleat / chassis and back screws', v(cc, ch + S['back'])))
    hung = [ch, sl, cc, S['back']]
    seated = lambda dx=0.0, dy=0.0, dz=0.0: round(sum(v(m.translate([dx, dy, dz]), wc) for m in hung), 2)
    hk = CLT.hook()
    rows.append(('wall cleat / chassis, sleeve, case cleat, back screws, hung', seated()))
    rows.append((f'lifted straight off the wall cleat (0.5 to {hk + 6:.0f} mm; hook {hk:.1f})', max(seated(dz=q) for q in np.arange(0.5, hk + 6.01, 0.5))))
    rows.append(('hung, 0.5 either way along the wall cleat: free', max(seated(dx=-0.5), seated(dx=0.5))))
    rows.append(('hung, 1.5 either way along the wall cleat: on a stop (> 0 both ways)', 0.0 if min(seated(dx=-1.5), seated(dx=1.5)) > 1.0 else 1.0))
    wb = wc.bounding_box()
    rows.append((f'wall cleat {wb[3] - wb[0]:.0f} long, between the louver bands (z {wb[2]:.1f} to {wb[5]:.1f}; {DR.CLEAT_ZBOT:.1f} to {DR.CLEAT_ZTOP:.1f} free), short of the Boot hole',
                 0.0 if wb[2] >= DR.CLEAT_ZBOT and wb[5] <= DR.CLEAT_ZTOP and wb[3] <= DR.S3_BOOT[0] - 2.4 and wb[3] - wb[0] <= 250 else 1.0))
    bh = S['back'].bounding_box()[4]
    rows.append((f'back screw heads at or under the back plate\'s face ({bh - DR.Y1:+.2f})', 0.0 if bh <= DR.Y1 + 0.001 else round(bh - DR.Y1, 2)))
    worst = max(round((cable(x) ^ (wc + cc + ch + sl + S['back'])).volume(), 2) for x in CABLE_EXITS)
    rows.append((f'a {CABLE_D} mm cable from the right end, behind the bar, along the wall cleat\'s channel and down each slot / cleats, chassis, walnut', worst))
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
    t = CO.export(CO.collar(), f'{out}/{pre}encoder-collar-translucent.stl')      # V5's collar for the 4 mm wall; translucent PETG (100% infill) so the NeoPixel lights it
    print(f'{pre}encoder-collar-translucent: {np.round(t.extents, 1).tolist()}, watertight {t.is_watertight}')
    for m, name in ((DR.sled(), 'sensor-sled-black'),):
        me = m.to_mesh(); t = trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3], np.asarray(me.tri_verts)); t.merge_vertices()
        t.apply_translation(-t.bounds[0]); t.export(f'{out}/{pre}{name}.stl'); print(f'{pre}{name}: {np.round(t.extents, 1).tolist()}')
    cc, wc, CLT = cleats()
    for m, name, rot in ((cc, 'cleat-case-black', -90), (wc, 'cleat-wall-black', 90)):   # case cleat wall face down; wall cleat front face down
        me = m.rotate([rot, 0, 0]).to_mesh(); t = trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3], np.asarray(me.tri_verts)); t.merge_vertices()
        t.apply_translation(-t.bounds[0]); t.export(f'{out}/{pre}{name}.stl'); print(f'{pre}{name}: {np.round(t.extents, 1).tolist()}')
    # reused unchanged: V5's knob, diffuser and Boot key
    here = os.path.dirname(os.path.abspath(__file__))
    reused = [('bar-knob', 'knob-white'), ('bar-diffuser-white-face', 'diffuser-face-white'),
              ('bar-diffuser-white-grid-black', 'diffuser-grid-black'), ('bar-boot-key', 'boot-key')]
    for a, b in reused:
        shutil.copyfile(os.path.join(here, '..', 'stl', a + '.stl'), os.path.join(out, pre + b + '.stl'))
    print('reused:', ', '.join(pre + b for _, b in reused))
    print(dict(case=[round(2 * HW, 1), round(H, 1), D], wall=WALL, rim_gap=RIM_GAP, rebate=(REB_T, round(D - SEAT_Y, 2)), knob_x=KX, sensor_x=V.SENSOR_X,
               post_seat_from_back=round(DR.Y1 - (BOSS_Y - WASHER_REC[1] + P3.SO_FLOOR), 2), under_thread_mm=round(10.0 - ZO0, 2)))
    hits = 0
    for name, val in check(P):
        print(f'  {"ok  " if val < 0.05 else "HIT "} {name}: {val}')
        hits += val >= 0.05
    print('PASS' if not hits else f'FAIL ({hits})')
    sys.exit(1 if hits else 0)
