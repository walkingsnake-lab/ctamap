"""V7, pass 3 (Nov 27, 2026): one custom board under the top wall, a cable bay behind the panel, a sensor window in
the knob collar. Built on the V6 P3 case model (v6p3.py). Units mm. Concept geometry: nothing printed or fitted.

    python3 v7.py            # model + checks (it reads the V6 model from ../../bar-sleeve-case/src)
    python3 v7.py render     # ... and the renders, written beside this file

Axes: x to the right seen from the front, y back from the front edge, z up. The sleeve and the chassis print back-down
(y is the print's vertical), the collar prints flange-top down.

History: pass 1 was reviewed by an independent agent (REVIEW-pass1.md); pass 2 fixed its blockers; pass 3 (this
file) closes its open points and takes the parts chosen for the board (../src/gen_board.py):
- board 1.2 mm thick (the vertical USB-C sockets are made for 0.8-1.0 mm boards; their 0.95 stakes end inside a 1.2
  board, so nothing of them stands above it), its height set by a Bourns PEC11R encoder with switch (body 6.5);
- the ribbon header is through-hole (the only one JLCPCB stocks): its tails stand 1.8 above the board, under a groove;
- panel power on two M3 surface-mount nuts behind the encoder; Boot, Reset and a status light in the bay's ceiling;
- the board's capture redone (review F2): the encoder's body keyed in the collar, lead-ins on every support, crush
  ribs above the board, fixed stops 0.4 below it, a fin that enters a flared notch 9.5 mm before home;
- guide plate 0.6 thick, 0.45 under the socket's mouth (it must fit in the ~1.6 between a mated plug's overmould and
  the mouth: inferred from GCT's mating view, not a labelled dimension);
- a cable clip at the bay's exit in place of the strap slots; wider haunches; one slot in the top wall, not two.
"""
import math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..', 'bar-sleeve-case', 'src'))
sys.path.insert(0, SRC); sys.path.insert(0, HERE)
os.chdir(SRC)                                    # the V6 model reads its fonts and data by relative path
RENDER = len(sys.argv) > 1 and sys.argv[1] == 'render'
sys.argv = ['x', HERE, 'none']
os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')
import numpy as np
from manifold3d import Manifold, CrossSection
import v6p3 as M
import drawer as DR, collar as CO, case as C, case2 as V, plate3 as P3, sensor as SN, knob as KN
from case import box, cyl_y, cyl_z, prism_y, rr_cs, ADD, ZC, H, D, WALL, HW, KY, BORE_HX, BORE_HZ, BORE_R

KX = M.KX                                        # knob axis x (65.0); KY 41.9
U = lambda l: Manifold.batch_boolean(list(l), ADD)

# ---------------------------------------------------------------- the board
ENC_BODY = (13.4, 12.5, 6.5)                     # Bourns PEC11R-4220F-S0024 (LCSC C143797), turned so its pin rows are on the x
                                                 # sides: 13.4 x 12.5 body (JLC's footprint), 6.5 tall with its switch (catalogue
                                                 # figure; the Adafruit 5880's part, the same pattern, is 6.3 in its CAD). MEASURE it.
                                                 # Not Alps EC11E: JLC's model of it has a 4.5 body, which would put the board 2 mm
                                                 # higher, into the chassis top wall
PCB_T = 1.2
EB_TOP = H + CO.DECK_BOT - ENC_BODY[2]           # the body clamps up against the collar's deck: the board's top, 105.40
EB_BOT = EB_TOP - PCB_T                          # 104.20
BX0, BX1 = 6.0, 98.0                             # 92 long: the module's antenna at the left end, 14 from the ribbon header; the right
                                                 # end stops at the chassis's rounded top-right corner (x 98.6 at the board's top face)
BY0, BY1 = 30.0, 59.5                            # 1.65 behind the panel's back; 0.5 in front of the top louver band (y 60)
STEP = (83.5, 41.5)                              # front-right corner cut back (x >, y <): the board passes behind the short standoff
                                                 # at x 87.25 on its way up into the collar (review F7)
NOTCH = (74.9, 77.1, 49.5)                       # notch in the back edge (x0, x1, its front end) for the bay wall's fin: 10 deep
FLARE = 1.5                                      # ... its mouth this much wider each side, over as much of its length
SEN_R = 16.1                                     # light sensor: this far left of the knob's axis, under the flange's ring
SX = KX - SEN_R
SEN = (3.0, 6.8, 2.35)                           # VEML7700-TT lying flat, x, y, height (Vishay: 6.8 x 2.35 x 3.0 package)
USB_H = 6.5                                      # SHOU HAN TYPE-C 16PLT-H6.5 (LCSC C3151748; GCT USB4120's pattern): 8.94 x 3.16 x 6.5
USB_XY = (90.5, 53.5)                            # socket centre: mid bay, 11.5 inside the back plate's outer face
TAIL = 2.15                                      # the ribbon header's posts above the board (3.3 in JLC's model, through 1.2)
GROOVE = 1.5                                     # relief in the chassis top wall over them: 1.0 of wall left, 0.5 over the tails
BTN = ((81.0, 46.0), (81.0, 53.0))               # Boot, Reset (5.1 x 5.1 x 1.5 tact switches)
STATUS = (94.3, 46.5)                            # status light (2 x 2 x 0.84)
NUTS = ((60.5, 54.5), (69.5, 54.5))              # panel power: M3 x 3 surface-mount nuts, GND and +5 V


def board():
    b = box(BX0, BX1, BY0, BY1, EB_BOT, EB_TOP)
    b = b - box(STEP[0], BX1 + 1, BY0 - 1, STEP[1], EB_BOT - 1, EB_TOP + 1)
    n0, n1, ny = NOTCH
    mouth = tri_z([(n0 - FLARE, BY1 + 0.01), (n1 + FLARE, BY1 + 0.01), (n1, BY1 - FLARE), (n0, BY1 - FLARE)], EB_BOT - 1, EB_TOP + 1)
    return b - box(n0, n1, ny, BY1 + 1, EB_BOT - 1, EB_TOP + 1) - mouth


def tri_z(pts, z0, z1):
    cs = CrossSection([pts])
    cs = cs if cs.area() > 0 else CrossSection([pts[::-1]])
    return Manifold.extrude(cs, z1 - z0).translate([0, 0, z0])


def board_parts():
    """every part on the board as a block: {name: (solid, side)}; side 'top' or 'under'"""
    z1, z0 = EB_TOP, EB_BOT
    ux, uy = USB_XY
    sw = lambda c: box(c[0] - 2.55, c[0] + 2.55, c[1] - 2.55, c[1] + 2.55, z0 - 1.5, z0)
    p = dict(
        enc_body=(box(KX - ENC_BODY[0] / 2, KX + ENC_BODY[0] / 2, KY - ENC_BODY[1] / 2, KY + ENC_BODY[1] / 2, z1, H + CO.DECK_BOT), 'top'),
        enc_bush=(cyl_z(KX, KY, H + CO.DECK_BOT, H + 6.0, 7.0, 48), 'top'),
        pixel=(box(KX - 1.0, KX + 1.0, KY - 10.7, KY - 8.7, z1, z1 + 0.84), 'top'),            # WS2812B-2020 under the collar's tip
        sensor=(box(SX - SEN[0] / 2, SX + SEN[0] / 2, KY - SEN[1] / 2, KY + SEN[1] / 2, z1, z1 + SEN[2]), 'top'),
        hub_tails=(box(31.6, 50.4, 33.3, 36.8, z1, z1 + TAIL), 'top'),
        enc_pins=(box(KX - 8.5, KX + 8.5, KY - 7.5, KY + 7.5, z0 - 2.6, z0), 'under'),          # 3.5 terminals through 1.2
        usb=(box(ux - 4.47, ux + 4.47, uy - 1.58, uy + 1.58, z0 - USB_H, z0), 'under'),
        boot=(sw(BTN[0]), 'under'), reset=(sw(BTN[1]), 'under'),
        status=(box(STATUS[0] - 1.0, STATUS[0] + 1.0, STATUS[1] - 1.0, STATUS[1] + 1.0, z0 - 0.84, z0), 'under'),
        module=(box(6.0, 31.5, 40.0, 58.0, z0 - 3.1, z0), 'under'),           # ESP32-S3-WROOM-1-N8R2 (25.5 x 18 x 3.1), antenna at x 6-12
        hub75=(box(27.05, 54.95, 30.6, 39.5, z0 - 9.0, z0), 'under'),         # 2x8 shrouded header, through-hole (27.9 x 8.9 x 9.0)
        hub_plug=(box(28.0, 54.0, 31.3, 38.8, z0 - 15.5, z0 - 9.0), 'under'),  # the ribbon's plug, mated
        power=(U(cyl_z(x, y, z0 - 7.0, z0, 7.0, 32) for x, y in NUTS), 'under'),   # nut 3, then lug and screw head
        shifters=(box(37.4, 53.1, 41.9, 49.3, z0 - 1.2, z0), 'under'),        # two TSSOP-20 (as routed, Nov 27)
        qwiic=(box(75.5, 82.5, 31.0, 37.0, z0 - 3.0, z0), 'under'),           # spare I2C connector (takes today's sensor board)
    )
    return p


# ---------------------------------------------------------------- the collar
WIN_SKIN = 0.2                                   # plastic left over the sensor: ONE 0.2 first layer, printed on the bed
WIN_R = M.KNOB_R + 0.3, CO.FL_R - 0.6            # the pocket's radial span: 0.3 outside the knob's edge to 0.6 inside the rim
WIN_HALF = 30.0                                  # its half angle (deg): 16.9 long at r 16.1
HOLE_R = WIN_R[0] - 0.4, WIN_R[1] + 0.05         # the light well through the sleeve's top wall, a little larger
HOLE_HALF = 31.5
RIB_FREE = 40.0                                  # no crush rib within this of the well's middle (deg): the 2.9 web beside it
KEY_CL = 0.2                                     # the keyed pocket's clearance round the encoder's body, a side


def sector(r0, r1, half, n=24):
    """annular sector about the knob's axis, centred on -x (toward the middle of the case); knob at the origin"""
    a = [math.radians(180 - half + 2 * half * i / n) for i in range(n + 1)]
    pts = [(r1 * math.cos(t), r1 * math.sin(t)) for t in a] + [(r0 * math.cos(t), r0 * math.sin(t)) for t in reversed(a)]
    cs = CrossSection([pts])
    return cs if cs.area() > 0 else CrossSection([pts[::-1]])


def collar():
    """V5's collar (collar.py: flange 35, tip to the front, crush ribs) with
    - the window pocket: cut up from the flange's underside to WIN_SKIN under its top face (the first layer on the bed);
    - no crush rib beside the well;
    - a keyed pocket: V5's is round (r 9.8), so nothing sets the encoder's angle; here the pocket's sides close in to the
      body's rectangle + KEY_CL, which clocks the board to the collar (and the collar's teardrop clocks it to the sleeve)"""
    c = CO.collar()
    pocket = Manifold.extrude(sector(*WIN_R, WIN_HALF), CO.FL_T - WIN_SKIN + 0.5).translate([0, 0, -0.5])
    ribs = Manifold.extrude(sector(CO.HOLE_R - CO.CL + 0.02, CO.HOLE_R + 1.0, RIB_FREE), WALL + 1).translate([0, 0, -WALL - 1])
    hx, hy = ENC_BODY[0] / 2 + KEY_CL, ENC_BODY[1] / 2 + KEY_CL
    z0, z1 = CO.PLUG_BOT, CO.DECK_BOT
    key = Manifold.cylinder(z1 - z0, CO.POCKET_R + 0.3, CO.POCKET_R + 0.3, 96).translate([0, 0, z0]) - box(-hx, hx, -hy, hy, z0 - 1, z1 + 1)
    lead = Manifold.batch_hull([box(-hx, hx, -hy, hy, z0 + 0.8, z0 + 0.81), box(-hx - 0.8, hx + 0.8, -hy - 0.8, hy + 0.8, z0 - 0.01, z0)])
    return (c - pocket - ribs + (key - lead)).translate([KX, KY, H])


def plain_collar():
    saved, CO.RIB_R = CO.RIB_R, None
    try:
        return collar()
    finally:
        CO.RIB_R = saved


# ---------------------------------------------------------------- the sleeve
def sleeve():
    """V6's sleeve with the end-wall USB-C opening (and its button relief) and the old sensor pinhole filled, and the
    light well under the collar's flange"""
    s = M.sleeve()
    wall = V.outer_body() - prism_y(rr_cs(BORE_HX, BORE_HZ, BORE_R), -50, D + 1)
    port = box(HW - WALL - 0.01, HW + 1, DR.PORT_Y - 16.0, DR.PORT_Y + 12.0, DR.PORT_Z - 12.0, DR.BTN_Z1 + 6.0)
    pin = cyl_z(V.SENSOR_X, V.SENSOR_Y, H - WALL - 0.01, H + 1, 6.0, 32)
    s = s + (wall ^ (port + pin))
    well = Manifold.extrude(sector(*HOLE_R, HOLE_HALF), WALL + 2).translate([KX, KY, H - WALL - 1])
    return s - well


# ---------------------------------------------------------------- the chassis
SO_SHORT = 12.0                                  # M3 hex standoff at the two right-hand corner inserts (the others: 30)
BOSS7 = M.PB + SO_SHORT + M.WASHER_T             # those standoffs' washers end here (40.85)
BAY_FACE = BOSS7 - M.WASHER_REC[1]               # the bay floor's front face (the washers sit 0.3 into it)
BAY_YF = 43.0                                    # the bay floor's inner face: 22 from the back plate's outer face, 26 from the rim
BAY_X0 = 77.0                                    # the bay's left inner face (pass 2: 76; now 1.5 from the encoder's pins);
BAY_T = 2.0                                      # its left wall, x 75-77. The bay's right is the tray's right wall (x 103.25)
STOP = 0.4                                       # the supports under the board stand this far below it (review F2: fixed stops)
BAY_ZT = EB_BOT - STOP
CRUSH = 0.15                                     # the ribs over the board press this far into it (they crush as the chassis goes in)
RIB_W = 0.45
RIB_XS = (80.0, 96.0)                            # either side of the socket, clear of its stakes (x 88.1, 92.9)
LEAD = 1.5                                       # 45 deg lead-in on the front end of every support
GUIDE_T, GUIDE_CL = 0.6, 0.45                    # guide plate under the socket's mouth: thickness (3 layers), air under the mouth
                                                 # (more than the board can sit low: the stops are 0.4 down)
GUIDE_Z1 = EB_BOT - USB_H - GUIDE_CL             # it passes under the socket as the chassis slides in
GUIDE_Z0 = GUIDE_Z1 - GUIDE_T
PLUG_GAP = 1.6                                   # a mated plug's overmould this far below the mouth (GCT mating views: 6.55 min of
                                                 # plug shell, 4.92 of it inside). INFERRED from unlabelled figures: check before printing
FLOOR_TOP = GUIDE_Z1                             # the floor runs up into the plate
HAUNCH = (6.5, 8.0)                              # 45 deg fillets in the floor's corners, left and right: it prints as a bridge
                                                 # between them (11.75 mm). The left one stops short of the bay screws' heads
ENC_SLOT = ENC_BODY[0] / 2 + 1.1                 # top-wall slot half width over the encoder's body
SEN_SLOT = SEN[0] / 2 + 0.55                     # ... and over the sensor
CLIP_Z = 12.5                                    # cable clip: its middle; on the bay's left wall, at the back
RIGHT = [q for q in DR.CORNERS if q[0] > 0]      # the two right-hand corner inserts


def inner(grow=0.0):
    r = DR.TRAY_CL + DR.TRAY_WT - grow
    return prism_y(rr_cs(BORE_HX - r, BORE_HZ - r, BORE_R - r), 0, D + 1)


def tray7():
    """drawer.tray() without the S3 or the V5 controls, with V6's posts, ties and fastening (v6p3.base_tray), one slot in
    the top wall over the encoder's body and the sensor (open to the front edge: they pass along it as the chassis slides
    in), and a groove over the ribbon header's tails (open to the front too)"""
    z0 = M.ZIN1 - 0.5
    cuts = [box(SX - SEN_SLOT, KX + ENC_SLOT, DR.YF - 1, KY + ENC_BODY[1] / 2 + 1.5, z0, H),
            box(31.0, 51.0, DR.YF - 1, 37.6, z0, M.ZIN1 + GROOVE)]
    saved = DR.FASTEN, DR.INSERT_D, DR.INSERT_L
    DR.FASTEN, DR.INSERT_D, DR.INSERT_L = M.FASTEN, M.INS_D, M.INS_DEPTH
    try:
        t = DR.tray(post_dy={c: M.FOOT_DY for c in DR.CORNERS}, ties=M.TIES, blind=M.BLIND, boss_blind=True,
                    s3=False, controls=False, extra_cuts=cuts)
    finally:
        DR.FASTEN, DR.INSERT_D, DR.INSERT_L = saved
    with DR._foot(M.FOOT_DY):                     # v6p3.base_tray: the two centre posts, every post's hole and bridge layers
        adds = [P3.standoff(x, z, DR.Y0) for x, z in M.CENTRE_POSTS]
        cuts = [cyl_y(x, ZC + z, P3.FOOT_Y + P3.SO_FLOOR + 0.02, DR.Y1 + 1, P3.SO_BORE + 0.04, 64) for x, z in M.CENTRE_POSTS]
        for x, z in list(DR.CORNERS) + M.CENTRE_POSTS:
            cuts.append(cyl_y(x, ZC + z, P3.FOOT_Y - 1.01, P3.FOOT_Y + P3.SO_FLOOR + 0.1, P3.SO_HOLE + 0.04, 32))
            ys, h, lh, zc = P3.FOOT_Y + P3.SO_FLOOR, P3.SO_HOLE / 2 + 0.02, DR.BRIDGE_LH, ZC + z
            cuts.append(box(x - h, x + h, ys - lh, ys + 0.01, zc - P3.SO_BORE, zc + P3.SO_BORE) ^ cyl_y(x, zc, ys - 2 * lh, ys + 0.02, P3.SO_BORE - 0.06, 48))
            cuts.append(box(x - h, x + h, ys - 2 * lh, ys - lh + 0.01, zc - h, zc + h))
    return (t + U(adds)) - U(cuts)


def yz(pts, x0, x1):
    """a prism along x from a (y, z) outline"""
    return M.along_x(pts, x0, x1)


def supports(crush=True):
    """what holds the board, all running front to back (the print's vertical), each with a 45 deg lead-in at its front end
    (the end that meets the board first as the chassis slides in):
    - under it, STOP below: the bay wall's top (x 75-77) and a ledge under its right edge;
    - over it: two crush ribs either side of the socket, CRUSH into the board (crush=False: left out, for the checks);
    - beside its right edge: a fence; in its notch: a fin with a pointed nose, which enters the notch's flared mouth
      (BY1 - nose) = 9.5 before home and fixes the board's turn about the knob"""
    out = []
    y0, y1 = BAY_YF, DR.Y1
    zt = BAY_ZT
    # ledge under the right edge, out to the wall's corner; its top ramps down toward the front
    out.append(yz([(y0, zt - 5.0), (y1, zt - 5.0), (y1, zt), (y0 + LEAD, zt), (y0, zt - LEAD)], BX1 - 1.7, M.XIN + 0.3))
    # (the bay wall's own top gets the same ramp: cut in bay())
    tip = EB_TOP - CRUSH
    for x in (RIB_XS if crush else ()):                              # ribs: tip ramps up toward the front
        out.append(yz([(y0 + 1.0, tip + LEAD), (y0 + 1.0 + LEAD, tip), (DR.Y0 + 0.01, tip), (DR.Y0 + 0.01, M.ZIN1 + 0.3), (y0 + 1.0, M.ZIN1 + 0.3)], x - RIB_W / 2, x + RIB_W / 2))
    # fence: 0.25 beside the right edge; its face steps away over LEAD at the front
    fx = BX1 + 0.25
    out.append(tri_z([(fx, y0 + LEAD), (fx + LEAD, y0), (M.XIN + 0.3, y0), (M.XIN + 0.3, y1), (fx, y1)], zt - 0.01, EB_TOP))
    # fin: 1.4 wide in the 2.2 notch, a pointed nose over its first 2.0
    fa, fb, fy = NOTCH[0] + 0.4, NOTCH[1] - 0.4, NOTCH[2] + 0.5
    fm = (fa + fb) / 2
    out.append(tri_z([(fm - 0.2, fy), (fm + 0.2, fy), (fb, fy + 2.0), (fb, y1), (fa, y1), (fa, fy + 2.0)], zt - 0.01, EB_TOP))
    return U(out)


def clip():
    """cable clip on the bay's left wall at the bay's exit, running front to back (prints upright): two prongs with lips,
    a 4.5 seat behind a 3.3 mouth. The cable turns from hanging to leaving backward here and presses in sideways; a tug
    from outside lands on the chassis"""
    z, x0 = CLIP_Z, BAY_X0 - 0.01
    lo = M.along_y([(x0, z - 3.75), (x0 + 6.0, z - 3.75), (x0 + 6.0, z - 1.65), (x0 + 5.0, z - 2.25), (x0, z - 2.25)], 53.0, DR.Y1)
    hi = M.along_y([(x0, z + 2.25), (x0 + 5.0, z + 2.25), (x0 + 6.0, z + 1.65), (x0 + 6.0, z + 3.75), (x0, z + 3.75)], 53.0, DR.Y1)
    return lo + hi


def bay(crush=True):
    """(clear, add, cut): the block of the tray the bay replaces; its floor, left wall, haunches, guide plate, clip and the
    board's supports; and the holes in them"""
    zb = M.ZIN0 - 0.3
    ux, uy = USB_XY
    clear = box(BAY_X0 - BAY_T, M.XIN + 1, BAY_FACE, D + 1, -5, BAY_ZT) ^ inner()
    floor = box(BAY_X0 - BAY_T, M.XIN + 0.3, BAY_FACE, BAY_YF, zb, FLOOR_TOP)
    wall = box(BAY_X0 - BAY_T, BAY_X0, BAY_FACE, DR.Y1, zb, BAY_ZT)
    wall = wall - yz([(BAY_FACE - 0.01, BAY_ZT - LEAD), (BAY_FACE + LEAD, BAY_ZT + 0.01), (BAY_FACE - 0.01, BAY_ZT + 0.01)], BAY_X0 - BAY_T - 1, BAY_X0 + 1)
    hl = tri_z([(BAY_X0 - 0.01, BAY_YF - 0.01), (BAY_X0 + HAUNCH[0], BAY_YF - 0.01), (BAY_X0 - 0.01, BAY_YF + HAUNCH[0])], zb, FLOOR_TOP)
    hr = tri_z([(M.XIN + 0.3, BAY_YF - 0.01), (M.XIN + 0.3, BAY_YF + HAUNCH[1]), (M.XIN - HAUNCH[1], BAY_YF - 0.01)], zb, FLOOR_TOP)
    guide = box(BAY_X0 - 0.01, M.XIN + 0.3, BAY_YF - 0.01, DR.Y1, GUIDE_Z0, GUIDE_Z1)       # closes the bay's ceiling under the board
    add = U([floor, wall, hl, hr, guide, clip(), supports(crush)]) ^ inner(0.3)
    cut = []
    hole = box(ux - 4.5, ux + 4.5, uy - 1.6, uy + 1.6, GUIDE_Z0 - 1, GUIDE_Z1 + 1)          # 9.0 x 3.2 for the plug's 8.34 x 2.56 shell
    lead = Manifold.batch_hull([box(ux - 4.5, ux + 4.5, uy - 1.6, uy + 1.6, GUIDE_Z1 - 0.2, GUIDE_Z1 - 0.19),
                                box(ux - 4.9, ux + 4.9, uy - 2.0, uy + 2.0, GUIDE_Z0 - 0.01, GUIDE_Z0)])   # 45 deg lead-in from below
    cut += [hole, lead]
    for bx, by in BTN:                            # a 3 mm hole under Boot and under Reset, for a pen tip
        cut.append(cyl_z(bx, by, GUIDE_Z0 - 1, GUIDE_Z1 + 1, 3.0, 24))
    cut.append(cyl_z(STATUS[0], STATUS[1], GUIDE_Z0 - 1, GUIDE_Z1 + 1, 2.6, 24))             # the status light shows in the bay
    for x, z in RIGHT:                            # the short standoffs' screws, from inside the bay; their washers' recesses
        cut.append(cyl_y(x, ZC + z, BAY_FACE - 1, BAY_YF + 1, P3.SO_HOLE, 32))
        cut.append(cyl_y(x, ZC + z, BAY_FACE - 1, BOSS7, M.WASHER_REC[0], 48))
    return clear, add, U(cut)


def chassis(crush=True):
    t = tray7()
    clear, add, cut = bay(crush)
    t = (t - clear) + add - cut
    # V6's finishing (v6p3.chassis): no crush ribs outside, the front edge clear of the diffuser's flange, washer recesses, lip, pads, lands
    t = t ^ prism_y(rr_cs(BORE_HX - DR.TRAY_CL, BORE_HZ - DR.TRAY_CL, BORE_R - DR.TRAY_CL), 0, D)
    t = t - box(-400, 400, 0, DR.YF + M.RIM_GAP + M.FRONT_CL, -5, H + 5)
    t = t - U(cyl_y(x, ZC + z, M.BOSS_Y - M.WASHER_REC[1] - 1, M.BOSS_Y, M.WASHER_REC[0], 48) for x, z in DR.INSERTS if (x, z) not in RIGHT)
    t = t + M.back_lip()
    t = t + M.pads(t) + M.lands()
    return max(t.decompose(), key=lambda m: m.volume())


# ---------------------------------------------------------------- hardware and what goes inside
def standoffs():
    af = M.STANDOFF_AF / math.sqrt(3)
    out = []
    for x, z in DR.INSERTS:
        L = SO_SHORT if (x, z) in RIGHT else M.STANDOFF_L
        out.append(Manifold.cylinder(L, af, af, 6).rotate([-90, 0, 0]).translate([x, M.PB, ZC + z]))
        out.append(cyl_y(x, ZC + z, M.PB + L, M.PB + L + M.WASHER_T, 7.0, 32))
    return U(out)


def screws():
    S = M.screws()
    seat6 = M.BOSS_Y - M.WASHER_REC[1] + P3.SO_FLOOR
    back = [cyl_y(x, ZC + z, seat6 - 8.0, seat6, 3.0, 24) + cyl_y(x, ZC + z, seat6, seat6 + 1.65, 6.9, 32) for x, z in DR.INSERTS if (x, z) not in RIGHT]
    bay_s = [cyl_y(x, ZC + z, BAY_YF - 8.0, BAY_YF, 3.0, 24) + cyl_y(x, ZC + z, BAY_YF, BAY_YF + 1.65, 6.9, 32) for x, z in RIGHT]
    return dict(under=S['under'], back=U(back), bay=U(bay_s))


def plug(big=True, routed=True):
    """a USB-C plug seated in the socket, hanging down, with its strain relief and its cable. big: a 16 x 9 overmould
    (larger than any measured here); else the spec maximum, 12.35 x 6.5. routed: the cable carried on down, through the
    clip and out of the back of the bay (as a chain of cylinders), so its way out is in the model"""
    ux, uy = USB_XY
    w, t = (16.0, 9.0) if big else (12.35, 6.5)
    mouth = EB_BOT - USB_H
    body = box(ux - w / 2, ux + w / 2, uy - t / 2, uy + t / 2, mouth - PLUG_GAP - 30.0, mouth - PLUG_GAP)
    tongue = box(ux - 4.17, ux + 4.17, uy - 1.28, uy + 1.28, mouth - PLUG_GAP, mouth + 4.92)
    relief = cyl_z(ux, uy, mouth - PLUG_GAP - 45.0, mouth - PLUG_GAP - 30.0, 8.0, 32)
    out = body + tongue + relief
    if routed:
        pts = [(ux, uy, mouth - PLUG_GAP - 45.0), (ux - 3.0, uy - 1.0, 34.0), (BAY_X0 + 6.0, 49.5, 20.0), (BAY_X0 + 2.9, 50.0, CLIP_Z), (BAY_X0 + 2.9, 80.0, CLIP_Z)]
        for a, b in zip(pts, pts[1:]):
            ball = lambda p: Manifold.sphere(2.0, 16).translate(list(p))
            out = out + Manifold.batch_hull([ball(a), ball(b)])
    else:
        out = out + cyl_z(ux, uy, 12.0, mouth - PLUG_GAP - 45.0, 4.5, 24)
    return out


def build():
    bp = board_parts()
    return dict(sleeve=sleeve(), chassis=chassis(), chassis_plain=chassis(crush=False), collar=collar(), panel=M.panel_p3(),
                diffuser=M.diffuser_in_case(), standoffs=standoffs(), board=board(), top=U(m for m, s in bp.values() if s == 'top'),
                under=U(m for m, s in bp.values() if s == 'under'), screws=screws(), parts=bp)


# ---------------------------------------------------------------- checks
def check(P):
    v = lambda a, b: round((a ^ b).volume(), 2)
    ch, chp, sl, col, pan, dif, so = P['chassis'], P['chassis_plain'], P['sleeve'], P['collar'], P['panel'], P['diffuser'], P['standoffs']
    bd, top, und, S = P['board'], P['top'], P['under'], P['screws']
    brd = bd + top + und
    rows = []
    r = lambda name, val, ok=None: rows.append((name, val, (val < 0.05) if ok is None else ok))
    pos = lambda name, val, least=0.3: rows.append((name, val, val > least))
    r('sleeve / chassis, seated', v(sl, ch))
    pos('chassis 0.1 further forward / sleeve (the lip meets the seat: > 0)', v(ch.translate([0, -0.1, 0]), sl), 0.5)
    r('chassis / panel', v(ch, pan)); r('chassis / diffuser', v(ch, dif)); r('sleeve / diffuser', v(sl, dif))
    r('chassis / standoffs and washers', v(ch, so))
    r('chassis, less the crush ribs / board', v(chp, bd))
    pos(f'the crush ribs / board (meant: {CRUSH} in)', v(ch, bd), 0.1)
    r('chassis / parts on top of the board (with the ribbon header\'s tails)', v(ch, top)); r('chassis / parts under the board', v(ch, und))
    r('sleeve / board and its parts', v(sl, brd))
    r('collar (less its crush ribs) / sleeve, chassis, board, encoder body, sensor', v(plain_collar(), sl + ch + bd + P['parts']['enc_body'][0] + P['parts']['sensor'][0]))
    r('collar WITH its crush ribs / the web between the well and the knob hole (no rib there)',
      v(col, sl ^ (Manifold.extrude(sector(CO.HOLE_R - 0.5, HOLE_R[0] + 0.5, HOLE_HALF + 2), WALL + 2).translate([KX, KY, H - WALL - 1]))))
    r('panel, standoffs / board and its parts', v(pan + so, brd))
    seat6 = M.BOSS_Y - M.WASHER_REC[1] + P3.SO_FLOOR
    seats = box(-400, 400, seat6 - 0.01, seat6 + 0.03, -5, H + 5) + box(-400, 400, BAY_YF - 0.03, BAY_YF + 0.01, -5, H + 5)   # the heads' seat planes
    r('screws (under, back, bay) / chassis and sleeve, beyond their holes', v(S['under'] + S['back'] + S['bay'], (ch - seats) + sl))
    r('bay screws / board parts, panel', v(S['bay'], brd + pan))
    r('a 16 x 9 plug, seated, its cable through the clip and out of the back / chassis, sleeve, screws, board parts', v(plug(True), ch + sl + S['bay'] + bd + (und - P['parts']['usb'][0])))
    pos('a 4 mm cable pressed 1 mm deeper into the clip / its prongs (it grips: > 0)', v(Manifold.cylinder(8, 2.0, 2.0, 24).rotate([-90, 0, 0]).translate([BAY_X0 + 2.9, 55.0, CLIP_Z + 1.0]), ch), 0.1)
    # the ways in
    steps = (0.3, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 40, 50, 60, 70)
    fixed = sl + col + brd + pan + so + dif
    worst = max((v(chp.translate([0, q, 0]), fixed), q) for q in steps)
    r(f'chassis (less the crush ribs) sliding in past the board, panel, standoffs (0.3-70 mm out; worst at {worst[1]})', worst[0])
    for dz in (-0.3, 0.3):
        low = sl + col + brd.translate([0, 0, dz]) + pan + so + dif
        r(f'... the same with the board {dz:+.1f} (the height stack\'s tolerance)', max(v(chp.translate([0, q, 0]), low) for q in steps))
    front = pan + so + dif
    r('panel, standoffs, diffuser into the sleeve first (0.3-70 mm out)', max(v(front.translate([0, q, 0]), sl) for q in steps))
    r('board and its parts lowered 1-20 mm (its way up into the collar) / panel, standoffs, sleeve',
      max(v(brd.translate([0, 0, -q]), pan + so + sl) for q in (1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20)))
    # supports
    pos(f'board {STOP + 0.1:.1f} lower / chassis (the stops take a pull on the plug: > 0)', v(bd.translate([0, 0, -STOP - 0.1]), chp), 0.5)
    turn = min(v(bd.translate([-KX, -KY, 0]).rotate([0, 0, a]).translate([KX, KY, 0]), ch) for a in (-1.5, 1.5))
    pos('board turned 1.5 deg about the knob, either way / chassis (fin and fence stop it: > 0)', turn)
    key = min(v(P['parts']['enc_body'][0].translate([-KX, -KY, 0]).rotate([0, 0, a]).translate([KX, KY, 0]), plain_collar()) for a in (-3.0, 3.0))
    pos('encoder body turned 3 deg in the collar / the keyed pocket (it clocks the board: > 0)', key, 0.05)
    # the cleat
    import cleat as CLT
    cc, wc = CLT.case_cleat(), CLT.wall_cleat()
    r('case cleat / chassis, back screws', v(cc, ch + S['back']))
    r('wall cleat / chassis, sleeve', v(wc, ch + sl))
    return rows


def window_report(P):
    """numbers for the light path"""
    col = collar()
    probe = lambda z0, z1: box(SX - 0.05, SX + 0.05, KY - 0.05, KY + 0.05, z0, z1)
    over = (col ^ probe(H, H + 5)).volume() / 0.01                 # plastic straight above the sensor's centre
    wall = (P['sleeve'] ^ probe(H - WALL - 1, H + 1)).volume() / 0.01
    tray = (P['chassis'] ^ probe(EB_TOP, H)).volume() / 0.01
    chip_top = EB_TOP + SEN[2]
    skin_z = H + CO.FL_T - WIN_SKIN
    return dict(skin_mm=round(over, 2), sleeve_over_sensor_mm=round(wall, 2), chassis_over_sensor_mm=round(tray, 2),
                window_mm2=round(sector(*WIN_R, WIN_HALF).area(), 1), window_radial_mm=round(WIN_R[1] - WIN_R[0], 2),
                window_long_mm=round(2 * math.radians(WIN_HALF) * sum(WIN_R) / 2, 2), knob_edge_r=M.KNOB_R, window_r=WIN_R,
                flange_r=CO.FL_R, flange_land_outside_well=round(CO.FL_R - HOLE_R[1], 2),
                land_with_collar_0p4_off_centre=round(CO.FL_R - HOLE_R[1] - CO.CL, 2),
                wall_between_well_and_knob_hole=round(HOLE_R[0] - CO.HOLE_R, 2), chip_top_to_skin_mm=round(skin_z - chip_top, 2))


def capture_report():
    """the tolerances the board's capture allows, from the geometry"""
    arm_fence = math.hypot(BX1 - KX, BY1 - KY)
    arm_fin = math.hypot((NOTCH[0] + NOTCH[1]) / 2 - KX, BY1 - KY)
    return dict(board_top_below_top_wall=round(M.ZIN1 - EB_TOP, 2), stops_below_board=STOP, ribs_into_board=CRUSH,
                keyed_pocket_allows_deg=round(math.degrees(KEY_CL / (ENC_BODY[0] / 2)), 1),
                fence_lead_in_catches_deg=round(math.degrees(LEAD / arm_fence), 1),
                fin_mouth_catches_deg=round(math.degrees((FLARE + 0.4) / arm_fin), 1),
                fin_enters_before_home_mm=round(BY1 - (NOTCH[2] + 0.5), 1), fin_side_play=0.4,
                guide_plate=dict(z=(round(GUIDE_Z0, 2), round(GUIDE_Z1, 2)), under_mouth=GUIDE_CL, needs_plug_gap_over=round(GUIDE_CL + GUIDE_T, 2), assumed_plug_gap=PLUG_GAP))


if __name__ == '__main__':
    P = build()
    for k in ('sleeve', 'chassis', 'collar'):
        m = P[k]
        print(f'{k}: {m.volume() / 1000:.1f} cm3, {len(m.decompose())} body, bbox {[round(q, 2) for q in m.bounding_box()]}')
    print(dict(board=(BX1 - BX0, BY1 - BY0, PCB_T), board_z=(round(EB_BOT, 2), round(EB_TOP, 2)),
               bay=dict(width=round(M.XIN - BAY_X0, 2), depth_from_plate=DR.Y1 - BAY_YF, depth_from_rim=D - BAY_YF, floor_t=round(BAY_YF - BAY_FACE, 2)),
               socket_mouth_z=round(EB_BOT - USB_H, 2), sensor_xy=(SX, KY)))
    print('window:', window_report(P))
    print('capture:', capture_report())
    hits = 0
    for name, val, ok in check(P):
        print(f'  {"ok  " if ok else "HIT "} {name}: {val}')
        hits += not ok
    print('PASS' if not hits else f'FAIL ({hits})')
    if RENDER:
        import v7_render
        v7_render.run(P)
