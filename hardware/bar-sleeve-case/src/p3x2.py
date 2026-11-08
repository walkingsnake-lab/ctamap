"""128 x 32 bar, P3: the v5 drawer sleeve for two Waveshare P3 64x32 panels side by side (384 x 96 of LEDs), in parts
that fit the X2D's 256 mm bed. Started fresh from the single P3 v5 shell (drawer.py + case2.shell2), not from the
P2.5 bar (bar128.py): its thin tongue-and-groove in the walnut stepped, blobbed and failed to slice cleanly.

Case frame as everywhere (x right seen from the front, y back, z up). Panel A (left) centred at x -96, B at +96.

Shell (walnut PLA, ~414 x 115 x 69 at CASE_WALL 5.0): the v5 sleeve from the 'p3x2' profile (bore 404 x 105.3), split at
x = 0 (the panel joint) into a left half A and a right half B. Both fit one plate back-down (each ~207 x 115 footprint).
- The wall is 5.0 (v5: 3.5), solid (6 walls in the slicer): the bar's long top and bottom walls flex far more than the
  single's, and the diffuser's rim seat and the joint both need it stiff.
- The joint (Nov 8, replaces the loose tenons of Nov 6): two glued joint plates. Inside the top and bottom walls a
  rebate JP_L long straddles the seam (JP_T + JP_CL deep, from JP_Y0 to JP_Y1 along the case depth); a flat PLA plate
  JP_T thick lies in it, half in each shell half, glued to both (PLA to PLA, ~49 cm2 the top plate, ~41 the bottom, which stops short of the screws from below). The plate locates the
  halves up/down (rebate floor) and front/back (rebate ends) the way the tenons did, and carries the seam's shear and
  tension over area instead of through four small tenons with clearance; the end faces are glued too. Permanent: the
  shell is a ring that is serviced from the back (trays and panels), never opened. Why not the tenons: the finished first
  bar still split at the seam under twist, with everything screwed down. The seam runs only through the top and bottom
  walls (~12 cm2 of face), the tenons had clearance in their pockets, CA on PETG tenons in wood PLA did not hold, and the
  inside chain (tray, panel, splice plates, panel, tray) has the splice slot's play in it: two stiff boxes on a floppy
  link. Bowtie keys were considered and dropped (they stop pull-apart, not twist).
- Seam faces are hollowed (HOLLOW): each half's end face at x = 0 is relieved HOLLOW deep except a LAND-wide band along
  the visible edges (outside, front rim, back rim), so two not-quite-flat printed faces still close at the edge you see,
  and the glue has somewhere to sit. Outside, every visible edge at the joint has a CHAMF x 45 deg chamfer each side (a
  V-groove round the case), stepped in V_STEPS bands of 0.1 mm.
- Knob at KNOB_X (+162, 45 mm from the right end, over tray B: its encoder board, 25.4 wide, clears tray B's top-right
  corner post at x 183.25), light sensor 40 mm toward the centre, USB-C at the right end. KNOB_X=96 is the stock-tray
  option (knob over panel B's centre, tray B = the single v5 tray).
Diffuser (two-colour, 0.4 nozzle, 0.2 face as the single P3): one per panel, split at the panel joint on the rib that
falls there (every rib is at a 3 mm pitch from the left edge, so x = 0 is a rib centre). No skirt on the seam edge.
JOINT_SPLIT (default): each half ends in its own wall at the seam, JOINT_WALL wide (a normal rib: the thinnest bead the
grid prints), so the joint is two walls, 2 x JOINT_WALL in all, split at x = 0. A gap between the halves then falls
between two white walls over the dead strip between the panels' edge columns, a dark hairline at worst; the first print
(Nov 7) had the rib on A only and B's face starting a half rib past its edge, so the same gap opened straight over B's
first column of LEDs. The cost: the two columns at the seam sit in cells a half rib narrower than the rest.
JOINT_SPLIT=0 is that first scheme: A owns the joint rib, JOINT_RIB wide (0.6 = a normal rib; 0.8 / 1.0 cover a gap
between the butted panels, and shift B right by the difference). The joint coupon has both: A pieces at JOINT_RIBS
(1-3 notches) and B (no notch) for the single rib, and the split pair (4 notches on A, 1 on B).
Splice plates (PETG): two short plates on the panels' inner corner inserts (x +/-8.75), screwed on first (M3 x 6 button
heads), a round hole on A's insert and a slot (x) on B's: they tie the panels into one unit so the rows can't step at the
seam, and let them butt freely. Panel A sits in its normal orientation and B turned 180 deg (the P2.5 bar's data chain:
S3 -> A's inner header, A's outer header -> B's inner one; nothing printed depends on it except the posts and these
plates), and the P3's inserts are not symmetric top and bottom (z +31 / -29), so B's hole sits SPLICE_DZ = 2 mm lower
than A's on both plates: one plate, used twice the same way up.
Trays (black PETG, the --trays run, PANEL=p3): one per panel, each the P3 v5 tray cut at the panel joint (no end wall
there: the panels fill it). Tray B is the v5 tray (S3, status window, Boot, USB-C slot) with the controls under the
knob: the encoder slot and rails at ENC_X (KNOB_X - 96) and the light-sensor sled 40 mm toward the centre. Tray A is
the same tray with no S3 and no controls, its posts at panel A's un-turned inserts. The inner posts of each are bolted
like the outer ones, standing on an M3 hex standoff that replaces the splice plate's screw at that insert (STANDOFF_L).
Each tray takes its own pair of screws from below and its own case cleat; one wall cleat (p3x2-cleat-wall.stl, 220 mm,
flat on the plate) takes both.
Underside: the single shell's two label recesses (marks.py) on half B, centred on panel B (in front of the screws from
below, inside the feet).
Run: python3 p3x2.py <outdir>   -> shell halves, joint plates, diffuser halves, splice plates, collar, coupons (seam: both
     halves' top wall across the joint, 60 wide, with a 60 mm plate; diffuser joint; splice holes), then the trays and
     wall cleat from a second run of this script with --trays (PANEL=p3). Case-frame copies for check_p3x2.py go to
     <outdir>/frames. JOINT_RIB=0.8 / SPLICE_HOLE=3.45 / JP_CL=0.1 set the sizes the coupons pick.
"""
import math, os, sys
TRAYS = '--trays' in sys.argv                    # the trays are built per panel, from the plain panel profile
WIDE = os.environ.get('WIDE', 'p3x2')            # 'p3x2' (default) or 'p25x2': the same parts round two P2.5 panels
BASE = WIDE[:-2]                                 # the single-panel profile the trays are built from
os.environ['PANEL'] = BASE if TRAYS else WIDE
os.environ.setdefault('CASE_WALL', '5.0')
import numpy as np
from manifold3d import Manifold, CrossSection
import panel
import case as C
import case2 as V
import plate3 as P3
import drawer as DR
from case import box, rr_cs, prism_y, prism_x, cyl_y, cyl_z, ZC, H, D, WALL, HW, RC, BORE_HX, BORE_HZ, BORE_R, JT, ADD, Y_FACE

PANEL_CX = panel.PROFILES[WIDE]['w'] / 4         # panel centres at x -/+96 (P3), -/+80 (P2.5)
PANEL_TURNED = {'A': False, 'B': True}
# knob (case x), by default as far right as the encoder board (25.4 wide) clears tray B's top-right corner post sideways
_KNOB = {'p3x2': 162.0, 'p25x2': 123.0}
KNOB_X = float(os.environ.get('KNOB_X', _KNOB[WIDE]))
SENSOR_X = KNOB_X - 40.0
if TRAYS:                                        # the tray run works in panel B's frame for the controls
    V.SENSOR_X = SENSOR_X - PANEL_CX             # set before sensor.py loads (it reads it once)
    DR.ENC_X = KNOB_X - PANEL_CX
    DR.SLED_SCREW = (V.SENSOR_X + 8.0, DR.SLED_SCREW[1])   # the sled's front screw 8 mm right of the chip (toward the knob)
    # top crush ribs: the one at 0.3 * (ox - r) = +28.3 would cross the sensor hole (Ø8.3 at 26) and the sled screw's
    # counterbore (Ø5 at 34); the one at +70.7 is under the knob slot anyway. One extra rib between the counterbore and
    # the knob slot keeps the right half of the top wall braced
    DR.CR_TOP_SKIP = ((V.SENSOR_X - DR.SEN_HOLE / 2 - 1.5, DR.SLED_SCREW[0] + DR.SLED_CB_D / 2 + 1.5),)
    DR.CR_TOP_EXTRA = (45.0,) if WIDE == 'p3x2' else ()   # P2.5: its ribs (+/-23.5, +/-58.7) clear the sensor (3) and knob (43)
    DR.ENC_RECESS = 1.2                          # the 5 mm wall raises the case top 1.5 over the tray: the encoder board (hung
                                                 # from the top) would sit 0.05 into the tray's wall; 1.2 off the wall's inner
                                                 # face (1.3 left) puts it 1.15 clear, the rails lapping it 1.9 mm
else:
    V.SENSOR_X = SENSOR_X
DR.configure_shell()
V.BACKDOWN = True
# diffuser seat for the bar (Nov 7): the v5 rim's 45 deg seat held the diffuser by 0.3 mm, a wedge the 350 mm walls
# couldn't hold (it pushed through under a thumb). Rim 1.5 (was 1.2 visible), seat 55 deg (wedge force 0.70x), the
# diffuser's bevel 0.2: overlap 1.0. Rough pop-through ~14 N as printed, ~23 N with solid walls (v5: ~3 N).
SEAT_DEG, RIM_IN, DIFF_BEV = 55.0, 1.5, 0.2
V.set_seat(SEAT_DEG, RIM_IN, DIFF_BEV)
import diffuser as _DF
_DF.BEV = DIFF_BEV
# skirt fit (Nov 7, P2.5 pair, generic black PETG on the 0.4 nozzle): the skirts came out 80.2 inside on a 79.9 mm panel
# with the single build's one 0.2 bump on the bottom skirt: 0.3 of slack, no snap, the half wiggled. Bumps 0.3 tall on
# the top skirt too (and the outer end, which pushes the half toward the seam): ~0.3 mm of interference over four bumps.
# Nov 7, third B print: 0.3 bumps held it without wiggle but a three-sided half peels off from its seam edge; pinching the
# skirts onto the panel held it, so the skirts bear along their length: clearance 0.05 (opening 80.1, printed ~80.0 on
# the 79.9 panel), bumps back to 0.2 as lead-in. The outer end gets the same 0.05, which also pushes the half toward
# the seam. DIFF_CLR / DIFF_BUMP to adjust.
_DF.CLR = float(os.environ.get('DIFF_CLR', '0.05'))
_DF.BUMP, _DF.TOP_BUMPS = float(os.environ.get('DIFF_BUMP', '0.2')), True
if not TRAYS:                                 # two bumps per half per long edge (the single's +/- quarter rule gave one)
    _DF.BUMP_XS = tuple(cx + dx for cx in (-PANEL_CX, PANEL_CX) for dx in (-40.0, 40.0))
V.KNOB_X = KNOB_X
if not TRAYS:
    for _m in (C, V, P3):
        _m.SCREW_XS = tuple(panel.P['screw_xs'])   # +/-50, +/-142: each tray's own +/-46 (the trays keep drawer's pair)

BED = 256.0
# ---------------------------------------------------------------- joint
CHAMF = 0.5                     # V-groove: each half's visible edges at the joint chamfered this much x 45 deg
V_STEPS = 5                     # the chamfer is cut in bands this many deep (0.1 mm steps)
HOLLOW, LAND = 0.3, 2.0         # seam faces relieved HOLLOW except a LAND band along the visible edges (incl. the V)
JP_T = 1.2                      # joint plate thickness (6 layers at 0.2, printed flat)
JP_CL = float(os.environ.get('JP_CL', '0.1'))   # rebate deeper than the plate: it sits this far below the bore
JP_L = 100.0                    # plate length along the bar (50 into each half)
JP_Y0, JP_Y1 = Y_FACE + 2.0, DR.Y1 - 2.0        # plate span along the depth: behind the rim's seat, in front of the back rim
JP_Y1_BOT = C.SCREW_Y - 4.5                     # the bottom plate stops short of the screws from below (counterbore r 3.2 at SCREW_Y)
JP_CL_Y = 0.15                  # rebate longer than the plate at each end (the ends line the fronts up)
JP_EC = 0.4                     # lead chamfer on the plate's four edges (the mating faces stay flat)
assert WALL - JP_T - JP_CL >= 3.5, WALL
# JOINT=tenon rebuilds the Nov 6 joint (loose PETG tenons in pockets) for comparison: its shell halves, tenon and seam
# coupons go out under *-tenon-* names beside the plate joint's files (p3x2.py <outdir> --tenon-set writes only those).
# The hollowed faces and the V-groove are on both.
JOINT = os.environ.get('JOINT', 'plate')
assert JOINT in ('plate', 'tenon'), JOINT
SKIN = 1.5                      # wall = SKIN | SLOT | SKIN
SLOT = WALL - 2 * SKIN          # 2.0: the tenon pocket's width (across the wall)
TEN_IN = 12.0                   # pocket depth into each half from the joint face
TIP_CL = 0.25                   # tenon end short of the pocket bottom, each end: the end faces at x = 0 seat first
MOUTH = 0.5                     # pocket mouth chamfer at the joint face (room for a seam blob)
TEN_L = 20.0                    # tenon length along the case depth
TEN_Y = ((Y_FACE + 2.5, Y_FACE + 2.5 + TEN_L), (D - 2.5 - TEN_L, D - 2.5))   # front and back pockets (y)
TEN_CL_Y = 0.15                 # tenon clearance to the pocket's y ends, a side (the pocket's ends line the fronts up)
TEN_T = SLOT - 0.4              # tenon body thickness: 0.2 a side in the pocket before the ribs (a slot printed on its side
                                #   in wood PLA comes out ~0.2-0.3 undersize, as the collar hole did; the ribs take up the rest)
RIB_HS = (0.45, 0.55, 0.65)     # the coupon's three rib heights: interference 0.05 / 0.15 / 0.25 in a slot printed to size,
                                #   0.25 / 0.35 / 0.45 in one printed 0.2 undersize (the ribbed face only: the flat face bears on the skin)
RIB_H = float(os.environ.get('RIB_H', '0.55'))
RIB_W, RIB_CREST, RIB_LEAD, RIB_N = 1.4, 0.6, 2.0, 3   # rib base and crest widths (a trapezoid: its top layer is one
                                                      # 0.6 mm line printed flat), ramp length at each end, ribs per tenon
END_CH = 0.4                    # lead-in chamfer on the tenon's x ends

assert SLOT >= 1.8 and SKIN >= 1.3, (SLOT, SKIN)


def outer_inset(i):
    """case2's back-down outer body (chamfered front and back rims) moved inward by i"""
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
    """shell material more than d from a face you can see: outside, the screen rim in front of the face, the back rim"""
    m = outer_inset(d)
    m = m - prism_y(rr_cs(BORE_HX + d, BORE_HZ + d, BORE_R + d), -50, Y_FACE + d)
    m = m - prism_y(rr_cs(BORE_HX + d, BORE_HZ + d, BORE_R + d), DR.Y1, D + 50)
    return m


def v_groove(sh):
    """the CHAMF x 45 deg chamfer on both halves' visible edges at x = 0, as V_STEPS stepped bands"""
    cuts = []
    for k in range(V_STEPS):
        x0, x1 = CHAMF * k / V_STEPS, CHAMF * (k + 1) / V_STEPS
        dk = CHAMF - (x0 + x1) / 2
        band = box(-x1, x1, -50, D + 1, -1, H + 1)
        if k:
            band = band - box(-x0, x0, -51, D + 2, -2, H + 2)
        cuts.append((sh ^ band) - deep(dk))
    return Manifold.batch_boolean(cuts, ADD)


def rebate_cuts():
    """the joint plates' rebates: in the bore faces of the top and bottom walls, JP_L long about x = 0, JP_T + JP_CL
    deep, JP_Y0 - JP_CL_Y .. JP_Y1 + JP_CL_Y along the depth. Printed back-down the rebate is a pocket in a vertical
    face whose front end (smaller y) is its roof: that end slopes 45 deg (the floor meets the bore d further forward),
    as the label recesses do; the back end is square and is the plate's y datum."""
    d = JP_T + JP_CL
    y0 = JP_Y0 - JP_CL_Y
    zt, zb = H - WALL, WALL                        # the bore's top and bottom faces
    out = []
    for y1, za, zb_ in ((JP_Y1 + JP_CL_Y, zt - 0.01, zt + d), (JP_Y1_BOT + JP_CL_Y, zb - d, zb + 0.01)):
        full = box(-JP_L / 2, JP_L / 2, y0, y1, za, zb_)
        if zb_ > H / 2:                                    # top wall: bore face at za
            mouth = box(-JP_L / 2, JP_L / 2, y0 - d, y1, za, za + 0.01)
        else:                                              # bottom wall: bore face at zb_
            mouth = box(-JP_L / 2, JP_L / 2, y0 - d, y1, zb_ - 0.01, zb_)
        out.append(Manifold.batch_hull([full, mouth]))
    return out


def wall_slots():
    """(z0, z1) of the pocket across each wall: top and bottom"""
    return [(H - WALL + SKIN, H - SKIN), (SKIN, WALL - SKIN)]


def pocket_cuts():
    """the tenon pockets in both halves (symmetric about x = 0) with their mouth chamfers"""
    cuts = []
    for z0, z1 in wall_slots():
        for y0, y1 in TEN_Y:
            cuts.append(box(-TEN_IN, TEN_IN, y0, y1, z0, z1))
            cuts.append(Manifold.batch_hull([box(-0.005, 0.005, y0, y1, z0 - MOUTH, z1 + MOUTH),
                                             box(-MOUTH, MOUTH, y0, y1, z0, z1)]))
    return cuts


def tenon(rib_h=RIB_H, notches=0, y=None):
    """one tenon in the case frame, in the front top pocket (or the span y): a flat bar TEN_T thick, filling the
    pocket's length less TEN_CL_Y a side, 2 * TIP_CL short of the two pockets' combined depth, with RIB_N crush ribs
    rib_h proud on its +z face running along x (ramped to nothing over RIB_LEAD at each end) and END_CH lead-in
    chamfers on its x ends. Prints flat, ribs up. notches: 1-3 marks on its front edge (the coupon's sizes)."""
    y0, y1 = TEN_Y[0] if y is None else y
    y0, y1 = y0 + TEN_CL_Y, y1 - TEN_CL_Y
    z0, z1 = wall_slots()[0]
    zb = z0 + 0.1                                   # the bar's underside, 0.1 off the pocket's inside face
    zt = zb + TEN_T
    hl = TEN_IN - TIP_CL
    t = box(-hl, hl, y0, y1, zb, zt)
    for sx in (-1, 1):                              # end chamfers, both z edges
        for ze, sgn in ((zt, -1), (zb, 1)):
            tri = CrossSection([[(sx * hl, ze), (sx * (hl - END_CH), ze), (sx * hl, ze + sgn * END_CH)]])
            if tri.area() <= 0:
                tri = CrossSection([[(sx * hl, ze), (sx * hl, ze + sgn * END_CH), (sx * (hl - END_CH), ze)]])
            t = t - prism_y(tri, y0 - 1, y1 + 1)
    ribs = []
    for i in range(RIB_N):
        yc = y0 + (y1 - y0) * (i + 1) / (RIB_N + 1)

        def rib_cs(h):
            """trapezoid: RIB_W at the base, RIB_CREST at the top (one solid line when printed flat), h tall"""
            pts = [(yc - RIB_W / 2, zt - 0.02), (yc + RIB_W / 2, zt - 0.02), (yc + RIB_CREST / 2, zt + h), (yc - RIB_CREST / 2, zt + h)]
            cs = CrossSection([pts])
            return cs if cs.area() > 0 else CrossSection([pts[::-1]])
        xa, xb = -hl + END_CH + 0.3, hl - END_CH - 0.3    # ribs start 0.3 in from the chamfer edge (off its edge line)
        ribs.append(prism_x(rib_cs(rib_h), xa + RIB_LEAD, xb - RIB_LEAD))
        # ramps: from the full rib down to a 0.05 mm sliver of its base at each end (a box, so no zero-area faces)
        for e0, e1 in ((xa, xa + RIB_LEAD), (xb - RIB_LEAD, xb)):
            full = prism_x(rib_cs(rib_h), e1 - 0.01, e1) if e0 == xa else prism_x(rib_cs(rib_h), e0, e0 + 0.01)
            end_x = e0 if e0 == xa else e1 - 0.01
            ribs.append(Manifold.batch_hull([full, box(end_x, end_x + 0.01, yc - RIB_W / 2, yc + RIB_W / 2, zt - 0.02, zt + 0.05)]))
    t = t + Manifold.batch_boolean(ribs, ADD)
    for k in range(notches):                        # 1 mm notches in the front edge, 2 mm apart, on the bar's centre
        nx = (k - (notches - 1) / 2) * 2.0
        t = t - box(nx - 0.5, nx + 0.5, y0 - 1, y0 + 0.8, zb - 1, zt + 1)
    return t


def hollow_cuts(sh):
    """the seam faces' relief: HOLLOW off each half's face at x = 0, wherever the wall is more than LAND from a visible
    face (deep(LAND)): the band you see stays full height"""
    return (sh ^ box(-HOLLOW, HOLLOW, -50, D + 1, -1, H + 1)) ^ deep(LAND)


def split_shell(sh):
    """left (A) and right (B) halves: the V-groove, the hollowed faces and the joint (JOINT: the plate rebates, or the
    tenon pockets) cut, then the shell cut at x = 0"""
    joint = rebate_cuts() if JOINT == 'plate' else pocket_cuts()
    s = sh - v_groove(sh) - hollow_cuts(sh) - Manifold.batch_boolean(joint, ADD)
    a = s ^ box(-HW - 1, 0.0, -50, D + 1, -1, H + 1)
    b = s ^ box(0.0, HW + 1, -50, D + 1, -1, H + 1)
    out = []
    for m in (a, b):
        parts = sorted(m.decompose(), key=lambda q: -q.volume())
        assert all(q.volume() < 0.01 for q in parts[1:]), [q.volume() for q in parts[1:]]
        out.append(parts[0])
    return tuple(out)


def joint_plate(top=True, length=JP_L):
    """one joint plate in the case frame, in its rebate (top or bottom wall), its face JP_CL below the bore: a flat bar
    length x (JP_Y1 - JP_Y0) x JP_T with JP_EC x 45 deg chamfers on the four edges of its bore-side face (the rebate-side
    face and the edges stay square)"""
    zt, zb = H - WALL, WALL
    y1 = JP_Y1 if top else JP_Y1_BOT
    if top:
        z0, z1 = zt + JP_CL, zt + JP_CL + JP_T              # bore side at z0
        full = box(-length / 2, length / 2, JP_Y0, y1, z0 + JP_EC, z1)
    else:
        z0, z1 = zb - JP_CL - JP_T, zb - JP_CL              # bore side at z1
        full = box(-length / 2, length / 2, JP_Y0, y1, z0, z1 - JP_EC)
    inset = box(-length / 2 + JP_EC, length / 2 - JP_EC, JP_Y0 + JP_EC, y1 - JP_EC, z0, z1)
    return Manifold.batch_hull([full, inset])


def coupon(a, b):
    """both halves' top wall across the joint, 60 wide, from the hood to the back rim: the hood, the front rim, the
    V-groove, the hollowed face and the rebate (with a 60 mm plate). The cut face prints on the bed, as the halves do."""
    reg = box(-30.0, 30.0, -50, D + 1, H - 16.0, H + 1)
    return a ^ reg, b ^ reg


def tm(m, mat=None, process=False):
    """manifold -> trimesh, cleaned the way the slicer will see it: vertices welded at float32 (STL) precision, then the
    sliver triangles that collapse in that rounding (manifold leaves them on big flat faces; welded, they turn into
    duplicate-vertex faces and read as non-manifold edges) and duplicate faces dropped. process=True also runs
    trimesh's own pass."""
    import trimesh
    me = m.to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3].astype(np.float32).astype(np.float64), me.tri_verts, process=process)
    t.merge_vertices()
    f = t.faces
    t.update_faces((f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2]))   # collapsed only: a collinear
    t.update_faces(t.unique_faces())                                                     # zero-area one still closes the mesh
    if mat is not None:
        t.apply_transform(mat)
    return t


# ---------------------------------------------------------------- diffuser halves (PANEL=p3x2 run)
# the diffuser's face: one 0.2 layer on the 0.4 nozzle for both pairs (the P2.5 pair too: its 0.14 face on the 0.2 nozzle
# printed crisper squares, but the two halves took ~12.5 h; a 0.4 coupon, Nov 7, was judged good enough). DIFF_FACE=0.14
# for the 0.2-nozzle version.
DIFF_FACE = float(os.environ.get('DIFF_FACE', '0.2'))
# PETG shrink: the first P2.5 pair's black grid printed 0.45% small (88.3 on 88.7 tall), which left each half ~0.8 mm
# short of the seam against its panel's outer edge and the top/bottom skirts too narrow to go round the panel (they
# perched on its edges and fell off). The diffuser halves and their coupon are built this much larger in x and y
# (not z: the face stays one layer); the single-panel diffusers are not. Set 0 for a PLA grid.
DIFF_SHRINK = float(os.environ.get('DIFF_SHRINK', '0.0045'))
DIFF_SCALE = 1.0 / (1.0 - DIFF_SHRINK)
HALF = panel.P['rib'] / 2 if not TRAYS else None   # half of a normal rib (P3 0.3, P2.5 0.225)
JOINT_RIBS = tuple(round(panel.P['rib'] + k * panel.P['rib'] / 3, 2) for k in range(3)) if not TRAYS else ()   # P3 0.6 / 0.8 / 1.0
JOINT_RIB = float(os.environ.get('JOINT_RIB', JOINT_RIBS[0] if JOINT_RIBS else 0))   # default: a normal rib (panels butted tight)
# Split joint (Nov 8, the default): a wall on each half's seam edge, JOINT_WALL wide (default a normal rib, the thinnest
# bead the grid prints), split at x = 0. JOINT_SPLIT=0: A owns the whole joint rib (JOINT_RIB), B has no wall.
JOINT_SPLIT = os.environ.get('JOINT_SPLIT', '1') not in ('0', '', 'no', 'false')
JOINT_WALL = float(os.environ.get('JOINT_WALL', panel.P['rib'] if not TRAYS else 0))


def diffuser_halves(rib=JOINT_RIB, skin=None, split=None, wall=None):
    """diffuser.diffuser() over both panels (the 'p3x2' profile: 128 columns, skirts and bumps on the outer ends, top and
    bottom), split at the panel joint. split (JOINT_SPLIT): the joint rib is replaced by two walls, wall (JOINT_WALL)
    wide each, one on A ending at x = 0 and one on B starting there. Otherwise A keeps the joint rib, widened to rib
    (from -HALF to rib - HALF), and B starts at +HALF. Returns {('A'|'B', 'white'|'black'): manifold} in the diffuser's
    frame (z = 0 the face, +z toward the LEDs; x as seen from the front, so A is x < 0)."""
    import diffuser as DF
    skin = DIFF_FACE if skin is None else skin
    split = JOINT_SPLIT if split is None else split
    wall = JOINT_WALL if wall is None else wall
    d = DF.diffuser(skin=skin)
    hy = DF.PH / 2
    if split:
        xa1 = xb0 = 0.0
        if wall > HALF:                                      # widen the joint rib to two walls (one each side of x = 0)
            d = d + box(-wall, wall, -hy + 0.29, hy - 0.29, skin - 0.01, skin + DF.GRID_H)
    else:
        xa1, xb0 = rib - HALF, HALF
        if xa1 > HALF:                                       # widen the joint rib onto B's side
            d = d + box(HALF - 0.01, xa1, -hy + 0.29, hy - 0.29, skin - 0.01, skin + DF.GRID_H)
    lo = d.bounding_box()
    face = box(lo[0] - 1, lo[3] + 1, lo[1] - 1, lo[4] + 1, -1, skin)
    a = d ^ box(lo[0] - 1, xa1, lo[1] - 1, lo[4] + 1, -1, 20)
    b = d ^ box(xb0, lo[3] + 1, lo[1] - 1, lo[4] + 1, -1, 20)
    out = {('A', 'white'): a ^ face, ('A', 'black'): a - face, ('B', 'white'): b ^ face, ('B', 'black'): b - face}
    return {k: v.scale([DIFF_SCALE, DIFF_SCALE, 1.0]) for k, v in out.items()}   # shrink compensation, about the seam


def diffuser_joint_coupons():
    """6 columns either side of the joint (cut at a rib's outer edge, so no half rib at the coupon's own edge), the
    bottom edge (skirt, flange) and 8 rows. Single-rib scheme: an A piece per joint rib width (1-3 notches in its flange
    edge) and one B piece (no notch). Split scheme: an A piece (4 notches) and a B piece (1 notch), each with its own
    wall at the seam. Hold a pair on the butted panels at the bottom of the joint, lit; the pair whose seam looks like
    the rest of the grid is the build's (JOINT_SPLIT / JOINT_RIB)."""
    import diffuser as DF
    hy = DF.PH / 2
    reg = lambda x0, x1: box(x0, x1, -hy - 20, -hy + 25.0, -5, 20)
    x6 = 6 * panel.P['pitch'] + HALF                           # cut at the sixth rib's outer edge

    def notched(n):
        return Manifold.batch_boolean([box(-12.0 + k * 2.2, -12.0 + k * 2.2 + 1.0, -DF.FL_HZ - 1, -DF.FL_HZ + 1.0, -1, 20)
                                       for k in range(n)], ADD) if n else Manifold()

    def piece(name, h, side, n):
        r = reg(-x6, 2.0) if side == 'A' else reg(-2.0, x6)
        nk = notched(n).translate([0 if side == 'A' else 18.0, 0, 0])   # B's notch on its own side of the seam (x +6)
        return (name, h[(side, 'white')] ^ r - nk, h[(side, 'black')] ^ r - nk)
    out = []
    for n, rib in enumerate(JOINT_RIBS, 1):
        out.append(piece(f'A{rib:.2f}', diffuser_halves(rib, split=False), 'A', n))
    out.append(piece('B', diffuser_halves(JOINT_RIBS[0], split=False), 'B', 0))
    h = diffuser_halves(split=True)
    out.append(piece('Asplit', h, 'A', 4))
    out.append(piece('Bsplit', h, 'B', 1))
    return out


# ---------------------------------------------------------------- splice plates
_INS = panel.PROFILES[BASE]['inserts'][:4]      # the panel's four corner inserts
SPLICE_X = PANEL_CX - max(abs(x) for x, z in _INS)   # inner corner inserts: x +/-8.75 (P3), +/-17.5 (P2.5)
_ZT, _ZB = max(z for x, z in _INS), min(z for x, z in _INS)
SPLICE_DZ = _ZT + _ZB             # B's (turned) insert sits this much lower than A's (un-turned), top and bottom: 2 (P3: 31
                                  # vs 29), 0 (P2.5: symmetric)
SPLICE_T, SPLICE_W, SPLICE_L = 2.0, 14.0, 2 * SPLICE_X + 12.0
SPLICE_SLOT = 0.5                 # B's hole is a slot, +/-0.5 in x: the plate holds the rows, the panels butt freely
SPLICE_HOLES = (3.3, 3.45, 3.6)   # printed vertical, so they come out small: pick the snuggest an M3 passes freely
SPLICE_HOLE = float(os.environ.get('SPLICE_HOLE', '3.45'))   # the build's (set from the test piece)
# Inner posts (Nov 8): at each inner insert the plate's M3 x 6 is an M3 male-female hex standoff instead (brass, body
# STANDOFF_L long, STANDOFF_AF across flats, stud ~6 mm: 4 into the insert through the 2 mm plate, as the screw it
# replaces). Its top is the inner post's seat and the post screw (M3 x 8 or 10) threads into its female end: all four
# posts bolted, the plate clamped, and the inner posts float on their screws like the outer ones (Ø POST_HOLE on an M3:
# +/-0.7; the standoff's hex top, 6.35 across corners, stays under the floor's bearing annulus at that offset). No socket
# keys the standoff: tighten it into the insert first (pliers or a 5.5 mm wrench), the post screw only clamps.
# INNER_DY moves the inner posts' feet back by the plate and the standoff from the outer posts' feet (which keep POST_LONG).
STANDOFF_L, STANDOFF_AF = 6.0, 5.5
INNER_DY = SPLICE_T + STANDOFF_L


def splice_z(side, top):
    """z (rel ZC) of a panel's inner corner insert: A un-turned, B turned 180 deg"""
    z = _ZT if top else _ZB
    return -z if PANEL_TURNED[side] else z


def splice_plate(d, notches=0):
    """flat, print as exported (its frame: x along the bar, y = case z rel A's hole, z = thickness). Round hole at A's
    insert (-SPLICE_X, 0), slot at B's (+SPLICE_X, -SPLICE_DZ); notches mark the size."""
    cs = CrossSection.square([SPLICE_L - 6.0, SPLICE_W - 6.0], center=True).offset(3.0, JT, circular_segments=32).translate([0, -SPLICE_DZ / 2])
    p = Manifold.extrude(cs, SPLICE_T)
    p = p - cyl_z(-SPLICE_X, 0, -1, SPLICE_T + 1, d, 40)
    slot = CrossSection.square([2 * SPLICE_SLOT, 0.01], center=True).offset(d / 2, JT, circular_segments=40).translate([SPLICE_X, -SPLICE_DZ])
    p = p - Manifold.extrude(slot, SPLICE_T + 2).translate([0, 0, -1])
    for k in range(notches):
        x = -3.0 + k * 3.0
        p = p - box(x - 0.6, x + 0.6, SPLICE_W / 2 - SPLICE_DZ / 2 - 1.0, SPLICE_W / 2 + 1, -1, SPLICE_T + 1)
    return p


def splice_in_case(top):
    """a plate seated on the panels' inner inserts (case frame), its back face SPLICE_T behind the panel back"""
    p = splice_plate(SPLICE_HOLE).rotate([90, 0, 0])            # x along, y = thickness, z = case z rel A's hole
    return p.translate([0, C.PANEL_BACK + SPLICE_T, ZC + splice_z('A', top)])


# ---------------------------------------------------------------- trays and cleat (PANEL=p3 run)
TRAY_GAP = 0.15                   # each tray stops this far short of the panel joint (0.3 between them)
PFX = WIDE                        # file name prefix: p3x2- or p25x2-


def corners_for(side):
    """the four corner inserts in the tray's own frame: B turned (drawer's default), A un-turned"""
    if PANEL_TURNED[side]:
        return list(DR.CORNERS)
    ins = panel.P['inserts']
    return [max([q for q in ins if q[0] * sx > 0 and q[1] * sz > 0], key=lambda q: (abs(q[0]), abs(q[1]))) for sx in (-1, 1) for sz in (-1, 1)]


def trays():
    """(tray A, tray B, B's status window) in the case frame. Only valid in the --trays run (PANEL=p3)."""
    assert TRAYS

    def build(side, sx, **kw):
        saved = DR.CORNERS
        DR.CORNERS = corners_for(side)
        try:
            inner = {c: INNER_DY for c in DR.CORNERS if c[0] * sx > 0}   # the corners toward the joint: floating posts, on the standoffs
            t = DR.tray(post_dy=inner, **kw)
        finally:
            DR.CORNERS = saved
        return t.translate([-sx * PANEL_CX, 0, 0])
    tb = build('B', -1) ^ box(TRAY_GAP, 500, -50, 200, -50, 200)
    ta = build('A', +1, s3=False, controls=False) ^ box(-500, -TRAY_GAP, -50, 200, -50, 200)
    big = lambda m: max(m.decompose(), key=lambda q: q.volume())
    return big(ta), big(tb), DR.status_window().translate([PANEL_CX, 0, 0])


WALL_CLEAT_HW = 110.0             # one wall cleat for both case cleats: spans x +/-110, so it catches 89 mm of each case
                                  # cleat (they run +/-(21..171)) and lies flat on the plate (220 < 256)


def build_trays(out, frames):
    import trimesh, json
    ta, tb, win = trays()
    for n, m in (('tray-A', ta), ('tray-B', tb), ('tray-B-window', win)):
        tm(m).export(f'{frames}/{n}.stl')
    import sensor as SN
    enc = (box(-12.7, 12.7, C.KY - 12.7, C.KY + 12.7, SN.EB_BOT, SN.EB_TOP)
           + Manifold.cube([12.0, 12.0, H - 1.4 - SN.EB_TOP], True).rotate([0, 0, 45]).translate([0, C.KY, (H - 1.4 + SN.EB_TOP) / 2])
           + cyl_z(0, C.KY, H - 1.4, H + 6.0, 7.0))
    for n, m in (('env-s3', DR.s3_envelope().translate([PANEL_CX, 0, 0])),
                 ('env-sensor', (DR.sensor_envelope() + DR.sensor_plugs()).translate([PANEL_CX, 0, 0])),
                 ('env-sled', DR.sled().translate([PANEL_CX, 0, 0])), ('env-encoder', enc.translate([KNOB_X, 0, 0]))):
        tm(m).export(f'{frames}/{n}.stl')
    import cleat as CL
    wc = CL.wall_cleat(hw=WALL_CLEAT_HW, xs=[-(WALL_CLEAT_HW - 15.0), 0.0, WALL_CLEAT_HW - 15.0])
    tm(wc).export(f'{frames}/wall-cleat.stl')
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
    t = tm(wc, down); t.apply_translation(-t.bounds[0]); t.export(f'{out}/{PFX}-cleat-wall.stl')
    print(f'{PFX}-cleat-wall.stl', 'watertight', t.is_watertight, np.round(t.extents, 1).tolist())
    fb = tm(tb, down)
    for n, m, f in ((f'{PFX}-tray-A.stl', ta, None), (f'{PFX}-tray-B.stl', tb, None), (f'{PFX}-tray-B-window.stl', win, fb)):
        t = tm(m, down)
        ref = t if f is None else f
        t.apply_translation(-ref.bounds[0]); t.export(f'{out}/{n}')
        print(n, 'watertight', t.is_watertight, np.round(t.extents, 1).tolist(), 'vol cm3', round(t.volume / 1000, 1))
    t = tm(DR.sled()); t.apply_translation(-t.bounds[0]); t.export(f'{out}/{PFX}-sensor-sled.stl')
    json.dump(dict(port_z=DR.PORT_Z, s3_edge=DR.S3_EDGE + PANEL_CX, s3_z0=DR.S3_Z0, ky=C.KY,
                   sensor_x=V.SENSOR_X + PANEL_CX, knob_x=DR.ENC_X + PANEL_CX, turned=PANEL_TURNED,
                   bottom_xs=[x + PANEL_CX * s for s in (-1, 1) for x in DR.bottom_xs()],
                   bot_y=DR.BOT_Y, foot_y=P3.FOOT_Y, y0=DR.Y0, y1=DR.Y1, yf=DR.YF, inner_dy=INNER_DY, standoff=(STANDOFF_L, STANDOFF_AF),
                   corners={side: [(x + PANEL_CX * sx, z) for x, z in corners_for(side)] for side, sx in (('A', -1), ('B', 1))},
                   cleat=[(x + PANEL_CX * s, z) for s in (-1, 1) for x, z in DR.CLEAT_SCREWS]),
              open(f'{frames}/trays.json', 'w'), indent=1)


def layout(rows, gap=8.0):
    """rows: [[trimesh, ...], ...]: lays each row left to right, rows front to back, centred on the origin. Parts given
    as tuples move together (two-colour pairs share one frame)."""
    placed, y = [], 0.0
    for row in rows:
        x, depth = 0.0, 0.0
        for item in row:
            grp = item if isinstance(item, tuple) else (item,)
            lo = np.min([g.bounds[0] for g in grp], axis=0); hi = np.max([g.bounds[1] for g in grp], axis=0)
            for g in grp:
                g.apply_translation([x - lo[0], y - lo[1], -lo[2]])
            placed.append(grp)
            x += hi[0] - lo[0] + gap
            depth = max(depth, hi[1] - lo[1])
        y += depth + gap
    allv = np.vstack([g.vertices for grp in placed for g in grp])
    c = -(allv.min(0) + allv.max(0)) / 2
    c[2] = 0
    for grp in placed:
        for g in grp:
            g.apply_translation(c)
    return placed


if __name__ == '__main__':
    import trimesh, json, subprocess
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    out = args[0] if args else '.'
    frames = f'{out}/frames'
    os.makedirs(out, exist_ok=True); os.makedirs(frames, exist_ok=True); os.makedirs(f'{out}/coupons', exist_ok=True)
    if TRAYS:
        build_trays(out, frames)
        sys.exit()
    sh = V.shell2()
    a, b = split_shell(sh)
    import marks as MK                                              # the single shell's label recesses, on half B
    MK.CX = PANEL_CX
    bad = MK.check(MK.layout()[0])
    assert not bad, bad
    b = MK.mark(b)
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])      # y = D on the bed (back down)

    def put(m, name, mat=down, frame=None):
        t = tm(m, mat)
        f = tm(frame, mat) if frame is not None else t
        t.apply_translation([-f.bounds[0][0], -f.bounds[0][1], -f.bounds[0][2]]); t.export(f'{out}/{name}')
        print(name, 'watertight', t.is_watertight, np.round(t.extents, 1).tolist(), 'vol cm3', round(t.volume / 1000, 1))
        return t
    if JOINT == 'tenon':                                             # the comparison set, then stop
        for m, name in ((a, 'A'), (b, 'B')):
            put(m, f'{PFX}-shell-{name}-tenon-walnut-backdown.stl')
        t = tm(tenon(RIB_H)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/{PFX}-tenon.stl')
        print(f'{PFX}-tenon.stl', 'watertight', t.is_watertight, np.round(t.extents, 2).tolist())
        ca, cb = coupon(a, b)
        for m, name in ((ca, 'A'), (cb, 'B')):
            put(m, f'coupons/coupon-{PFX}-seam-tenon-{name}-walnut.stl')
        for n, hh in enumerate(RIB_HS, 1):
            t = tm(tenon(hh, notches=n)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/coupons/coupon-{PFX}-tenon-{hh:.2f}.stl')
            print(f'coupon-{PFX}-tenon-{hh:.2f}.stl', 'watertight', t.is_watertight, np.round(t.extents, 2).tolist(), f'{n} notch(es)')
        sys.exit()
    for m, name in ((a, 'A'), (b, 'B')):
        tm(m).export(f'{frames}/shell-{name}.stl')
        put(m, f'{PFX}-shell-{name}-walnut-backdown.stl')
    # joint plates: flat; the top one (plain) and the bottom one (shorter: it stops before the screws from below)
    for top in (True, False):
        tm(joint_plate(top)).export(f'{frames}/plate-{"top" if top else "bot"}.stl')
    for top, n in ((True, 'top'), (False, 'bottom')):
        t = tm(joint_plate(top)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/{PFX}-joint-plate-{n}.stl')
        print(f'{PFX}-joint-plate-{n}.stl', 'watertight', t.is_watertight, np.round(t.extents, 2).tolist(), 'flat')
    # diffuser halves: face down, white face + black grid in one frame per half
    h = diffuser_halves(JOINT_RIB)
    for side in ('A', 'B'):
        w, k = tm(h[(side, 'white')], process=True), tm(h[(side, 'black')], process=True)
        lo = np.minimum(w.bounds[0], k.bounds[0])
        for n, t in ((f'{PFX}-diffuser-{side}-white.stl', w), (f'{PFX}-diffuser-{side}-black.stl', k)):
            t.apply_translation(-lo); t.export(f'{out}/{n}')
            print(n, 'watertight', t.is_watertight, np.round(t.extents, 1).tolist())
        for part in ('white', 'black'):
            tm(h[(side, part)]).export(f'{frames}/diffuser-{side}-{part}.stl')
    # splice plates (two), flat
    sp = [tm(splice_plate(SPLICE_HOLE)) for _ in range(2)]
    layout([sp], gap=6.0)
    S = trimesh.util.concatenate(sp); S.export(f'{out}/{PFX}-splice-plates.stl')
    print(f'{PFX}-splice-plates.stl', 'watertight', S.is_watertight, np.round(S.extents, 1).tolist())
    for top in (True, False):
        tm(splice_in_case(top)).export(f'{frames}/splice-{"top" if top else "bot"}.stl')
    # coupons: seam (both halves' top wall across the joint, with a 60 mm plate), diffuser joint, splice holes
    ca, cb = coupon(a, b)
    for m, name in ((ca, 'A'), (cb, 'B')):
        put(m, f'coupons/coupon-{PFX}-seam-{name}-walnut.stl')
    t = tm(joint_plate(True, 60.0)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/coupons/coupon-{PFX}-joint-plate.stl')
    print(f'coupon-{PFX}-joint-plate.stl', 'watertight', t.is_watertight, np.round(t.extents, 2).tolist())
    pieces = diffuser_joint_coupons()
    pairs = [(tm(w, process=True), tm(k, process=True)) for _, w, k in pieces]
    layout([pairs[:2], pairs[2:4], pairs[4:]], gap=6.0)
    W = trimesh.util.concatenate([p[0] for p in pairs]); K = trimesh.util.concatenate([p[1] for p in pairs])
    for n, t in ((f'coupon-{PFX}-diffuser-joint-white.stl', W), (f'coupon-{PFX}-diffuser-joint-black.stl', K)):
        t.export(f'{out}/coupons/{n}'); print(n, 'watertight', t.is_watertight, np.round(t.extents, 1).tolist())
    spc = [tm(splice_plate(d, i + 1)) for i, d in enumerate(SPLICE_HOLES)]
    layout([[q] for q in spc], gap=6.0)
    S = trimesh.util.concatenate(spc); S.export(f'{out}/coupons/coupon-{PFX}-splice-plates.stl')
    print(f'coupon-{PFX}-splice-plates.stl', 'watertight', S.is_watertight, np.round(S.extents, 1).tolist())
    import collar as CO                                             # the collar's plug follows the 5 mm wall (CASE_WALL)
    CO.TIP_BACK = False
    t = CO.export(CO.collar(), f'{out}/{PFX}-encoder-collar.stl'); print(f'{PFX}-encoder-collar.stl', 'watertight', t.is_watertight, np.round(t.extents, 1).tolist())
    import diffuser as DF
    json.dump(dict(knob_x=KNOB_X, sensor_x=SENSOR_X, port_z=DR.PORT_Z, screw_xs=list(V.SCREW_XS), screw_y=C.SCREW_Y,
                   hw=HW, h=H, d=D, zc=ZC, bore=(BORE_HX, BORE_HZ), y_face=Y_FACE, panel_back=C.PANEL_BACK,
                   joint_rib=JOINT_RIB, joint_split=JOINT_SPLIT, joint_wall=JOINT_WALL, splice=dict(x=SPLICE_X, t=SPLICE_T, dz=SPLICE_DZ, za=(splice_z('A', True), splice_z('A', False))),
                   skin=DIFF_FACE, grid_h=DF.GRID_H, wide=WIDE, pfx=PFX, panel_cx=PANEL_CX,
                   plate=dict(l=JP_L, y0=JP_Y0, y1=JP_Y1, y1_bot=JP_Y1_BOT, t=JP_T, cl=JP_CL), hollow=HOLLOW, land=LAND),
              open(f'{frames}/case.json', 'w'), indent=1)
    print(dict(W=2 * HW, H=round(H, 2), D=D, wall=WALL, plate=(JP_L, JP_Y0, JP_Y1, JP_T, JP_CL), knob=KNOB_X, sensor=SENSOR_X, screws=V.SCREW_XS,
               feet=C.FEET, port_z=round(DR.PORT_Z - ZC, 2), joint_rib=JOINT_RIB, splice_x=SPLICE_X, splice_dz=SPLICE_DZ))
    env = dict(os.environ)
    env.pop('PANEL', None)
    subprocess.run([sys.executable, __file__, out, '--trays'], check=True, env=env)
    if JOINT == 'plate':                                             # and the tenon joint's comparison set
        subprocess.run([sys.executable, __file__, out, '--tenon-set'], check=True, env=dict(env, JOINT='tenon'))
