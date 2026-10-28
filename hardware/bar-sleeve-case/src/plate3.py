"""Back plate v3: bolted to the panel, solid (no pills), fixed nut and S3 screw holes.

Why (v2 problems found on the first build):
- The plate rocked: the hold-down posts' foam pushed it outward, the top tongues sit in grooves open to the
  back (they stop up/down, not in/out), so only the two bottom screws held it and the top swung out.
- The bottom M3 nuts sat in 9 mm slots open toward the panel, so a nut slid off the screw axis and the screw spun.
- The S3's M2.5 machine screws had to cut their own thread in a Ø2.2 pilot (printed ~Ø2.05) with no lead-in.

v3:
- Three standoffs screw the plate to the panel's own brass M3 inserts (M3 x 8 down a Ø6.4 tube from the
  outer face, no washer). The plate is rigidly parallel to the panel; the foam posts are gone. Three points set the plane
  exactly; the fourth left insert sits under the S3. Positions are photo estimates (±1 mm): panel_template() checks them before the plate
  is printed (correct STANDOFFS if needed); the feet's Ø3.6 holes then allow ±0.3 mm.
- Bottom screws now only stop the module sliding out. The boss hole is a y-slot and the nut floats ±0.6 mm along
  the slot, so the stack error between frame, panel and plate is taken up there: push the module forward until
  the diffuser seats on the frame, then tighten. The nut slot is closed at the back, and its mouth narrows to
  5.3 mm so a pushed-in nut snaps past it and can't walk back out.
- S3 posts: Ø2.4 pilot with a 0.5 mm 45-deg lead-in.
- Tray: the plate fills the bore (0.2 mm clearance all round, no edge gaps) with a 6 mm inward skirt, so its
  edge is stiff and the shell locates it along the whole outline (v2's open gaps left the edges flexing).
- 2 mm plate (as v2); a 4th standoff at the panel's bottom-centre insert ties the middle of the plate to the panel.
- Power cable: the stock cable's extra (~45 cm plus its spare plug) is folded and tied into its own bundle
  (~50 x 28 x 20 mm) and placed wherever it fits behind the panel; one optional tie-down bridge above the ribbon.
  Bolted to the panel, any push from the bundle is internal (taken by the standoff screws), not on the shell.
- v4 (shell 6 mm deeper): the plate sits further back, so the ribbon has ~10 mm to fold behind the S3's plug (no
  pocket needed); four bottom screws (x +/-40, +/-52); a snap bump on each top tongue seats in a dimple in the shell's groove.
- Venting: one continuous louver band along the bottom (inlet) and one along the top (outlet), a chimney ~85 mm
  tall; three rows of slots each in a regular, left-right symmetric pattern. The slots rise 45 deg going inward, so
  from eye level or above you see a blade, not the inside. ~970 mm2 in, ~790 out (face area).
  LOUVERS = False seals it; PILLS = True brings the v2 pills back.
- Clean inside face: chamfered bands, rounded bosses, stadium keyhole bumps, one rounded pad under the S3's posts,
  one tie-down bridge. All holes and slots are cut after all solids are added.
- The shell is unchanged (same tongue grooves, same drilled screw holes).
Run: python3 plate3.py <outdir>
"""
import math, sys
import numpy as np
from manifold3d import Manifold, CrossSection
import case2 as V
from case import *
import panel

PILLS = False
GAP3 = 0.0                                   # plate fills the bore (0.2 mm clearance all round); no edge gaps
PLATE_T3 = 2.0                               # 2 mm (as v2): bolted to the panel, it doesn't need more; 3 mm cost ~25% more print time
SKIRT_D, SKIRT_T = 6.0, 2.0                  # inward perimeter skirt: stiffens the edge, bears on the bore all round
SKIRT_NOTCH = 16.0                           # top skirt cut back around the encoder (x within +/- this)
# S3 corner (lower left seen from the front): its panel insert sits under the S3, so there is no standoff and the corner
# flexed. The skirt deepens there into an L-flange (edge stiffness ~ depth^3: 10 vs 6 mm is ~4.6x), up the left edge to
# the top-left standoff and along the bottom to just short of the nearest boss, with 45-deg tapers back to SKIRT_D, plus
# a rib from the top-left standoff to the flange so the flange hangs off the standoff directly.
CF_CLEAR = 2.4                               # flange tip to the S3's tallest edge parts (USB-C, buttons: 3.5 mm)
                                             # and 2.5 to a plugged cable's housing (7 mm thick, centred on the port)
CF_RIB_T = 2.0
CF_DEPTH = 10.0                              # 16 fitted but read as a wall; 10 does most of the job with the rib
LOUVERS = True
LV_H, LV_PITCH, LV_DEPTH = 3.5, 5.0, 5.0     # slot height on the outer face, row pitch, band depth (slots rise 45 deg inward;
                                             # the 5 mm rise still hides a 3.5 mm slot from eye level)
LV_CH = 1.5                                  # 45-deg chamfer on the bands' inner edges
# one continuous band along the bottom (inlet) and one along the top (outlet), each with three rows of slots in a regular,
# left-right symmetric pattern; the gaps fall at the bottom bosses and centre standoff (bottom) and at the keyholes and
# encoder (top)
LV_BOTTOM_X = list(panel.P['lv_bottom_x'])   # P3: gaps at the bosses (+/-40, +/-52) and centre standoff
LV_TOP_X = list(panel.P['lv_top_x'])         # P3: gaps at the keyholes
LV_BOTTOM_Z = [7.25, 12.25, 17.25]
LV_TOP_Z = [87.0 + 2 * DZ, 92.0 + 2 * DZ, 97.0 + 2 * DZ]   # follow the plate's top edge
ENC_NOTCH = (15.0, 95.0 + 2 * DZ)                     # top band stays below z 95 within |x| < 15 (the encoder board)
# panel inserts used (case x, z - ZC), from the panel-back photo (DESIGN-HISTORY, panel in normal orientation, PI IN on the right
# seen from the front); the 4th corner (-88, -26) is under the S3. All six estimates go on the template.
INSERTS_ALL = list(panel.P['inserts'])
STANDOFFS = list(panel.P['standoffs'])     # P3: three corners + the bottom-centre insert, which ties the plate's middle
# power cable: the stock cable (~50 cm, often 4 wires and a spare plug) is folded and tied into its own bundle
# (~50 x 28 x 20 mm) and placed wherever it fits; nothing prescribes its spot. An optional tie-down bridge on the plate:
# a strap threads under it and round the bundle
_tb = panel.P['tie_bridge']
TIE_BRIDGE = (_tb[0], _tb[1], _tb[2] + DZ, _tb[3] + DZ)   # one bridge above the ribbon, beside the power socket: x0, x1, z0, z1
STRAP_H = 2.2                                # strap gap under the bridge (a 12-14 mm tie threads through anywhere along it)
# room for the ribbon's fold behind the S3's IDC plug: pocket into the plate
BAY = None                                 # v4: the 6 mm deeper case leaves the ribbon ~10 mm to fold; no pocket needed
SO_OD, SO_BORE, SO_FLOOR, SO_HOLE = 9.0, 6.4, 3.0, 3.6   # no washer
# funnel floor: a 90-deg cone from the bore down to the hole (1.4 mm deep). A screw dropped down the tube lands on the
# cone and slides into the hole; an M3 x 8 countersunk head (Ø6 or less) self-centres in it. Prints as a 45-deg roof.
SO_CONE_H = (SO_BORE - SO_HOLE) / 2
FOOT_Y = PANEL_BACK                          # foot face on the panel's insert bosses
NUT_W, NUT_MOUTH, NUT_H, NUT_FLOAT = 5.7, 5.3, 2.7, 0.6
NUT_CORNER = 5.5 / math.cos(math.pi / 6) / 2  # 3.175: nut centre to corner (corners point along the slot)
S3_PILOT, S3_LEAD = 2.4, 0.5
S3_POST_D = 6.0                                  # posts are ~22 mm long in the deeper case
BUMP_W, BUMP_H = 20.0, 0.7                       # top snap: the tongue sits 0.3 below the groove roof, so the bump rides
                                                 # 0.4 into the roof while sliding (the top wall flexes) and drops into the 0.5 dimple
# keyholes, as small as stays usable: Ø8 entry for a head up to ~7.6 mm (#6, #8 or M4 pan head), 4.2 slot for the shank,
# 6 mm travel (the head sits fully off the entry); the head pocket clears it by 0.75 a side, the bump wall is 1.5
KH_ENTRY, KH_SLOT, KH_TRAVEL = 8.0, 4.2, 6.0
KH_POCKET_R = KH_ENTRY / 2 + 0.75                 # 4.75: pocket half width and end radius
KH_WALL, KH_POCKET_D, KH_BUMP_D = 1.5, 4.5, 6.0
# wall stand-off: the keyhole screws hold the top 2 mm off the wall (heads set 8 mm out). At the bottom, a printed spacer
# disc glued into a shallow recess on the outer face (the bed side) carries the same round bumper as the case feet
# (0.5 in x 0.15 in: 12.7 x 3.81 mm), so the bottom stands out 2 mm too. The gap around the rim is the inlet (bottom)
# and outlet (top) on a wall.
WB_X, WB_Z = 46.0, WALL + 7.0                     # x +/-46 (solid plate between the bottom louvers and bosses), z 9.5
WB_GAP, WB_PAD_H = 2.0, 0.15 * 25.4               # wall gap; bumper height
WB_RECESS_D, WB_RECESS_T = 13.4, 0.4              # locating recess for the spacer
WB_SPACER_D = 13.0
WB_SPACER_T = BACKL + WB_GAP - WB_PAD_H + WB_RECESS_T   # 2.59: 2.19 stands proud of the plate
ROD_D, ROD_HEAD_D, ROD_HEAD_T = 4.3, 5.8, 0.6   # status-light rod (translucent PETG): shaft in the Ø4.5 tube, flush head
ROD_GAP = 0.8                                    # rod tip above the LED's top (LED ~0.9 mm tall on the component face)


def corner_flange(y0, hz):
    """Deep skirt (L-flange) and rib at the S3 corner; see CF_CLEAR."""
    y_front = max(V.S3_PCB_Y + 1.6 + 3.5 + CF_CLEAR,                     # S3 edge parts (USB-C, buttons)
                  PORT_Y + 3.5 + 2.5,                                    # a spec-max USB-C plug housing (P3 y 46.9)
                  y0 - CF_DEPTH)                                         # and no deeper than CF_DEPTH
    depth = y0 - y_front
    if depth <= SKIRT_D + 1:
        return Manifold()
    tl = [(x, z) for x, z in STANDOFFS if x < 0 and z > 0]
    if not tl:
        return Manifold()
    sx, sz = max(tl, key=lambda q: q[1]); z_full = ZC + sz              # top-left standoff
    x_end = -max(SCREW_XS) - 5.0 - 1.0                                   # 1 mm short of the nearest boss
    x_full = x_end - (depth - SKIRT_D)                                   # 45-deg taper in x
    z_end = z_full + (depth - SKIRT_D)                                   # 45-deg taper in z
    zbot = ZC - hz
    yd = y0 - SKIRT_D
    # bottom run: taper in (x, y), extruded over all z, kept to the bottom band
    cs_b = CrossSection([[(-500, y_front - 1), (x_full, y_front - 1), (x_end, yd), (x_end, y0 + 1), (-500, y0 + 1)]])
    if cs_b.area() <= 0:
        cs_b = CrossSection([[(-500, y_front - 1), (-500, y0 + 1), (x_end, y0 + 1), (x_end, yd), (x_full, y_front - 1)]])
    rb = Manifold.extrude(cs_b, 400).translate([0, 0, -200]) ^ box(-500, 500, -500, 500, -10, zbot + 12)
    # left run: taper in (z, y), along x, kept to the left band
    cs_l = CrossSection([[(y_front - 1, -100), (y0 + 1, -100), (y0 + 1, z_end), (yd, z_end), (y_front - 1, z_full)]])
    if cs_l.area() <= 0:
        cs_l = CrossSection([[(y_front - 1, -100), (y_front - 1, z_full), (yd, z_end), (y0 + 1, z_end), (y0 + 1, -100)]])
    rl = prism_x(cs_l, -500, -BORE_HX + 12)
    ring = rr_cs(BORE_HX - 0.2, hz, BORE_R - 0.2) - rr_cs(BORE_HX - 0.2 - SKIRT_T, hz - SKIRT_T, BORE_R - 0.2 - SKIRT_T)
    deep = prism_y(ring, y_front, y0 + 0.01) ^ (rb + rl)
    x_in = -(BORE_HX - 0.2 - SKIRT_T)                                    # flange inner face
    rib = box(x_in - 0.5, sx - SO_OD / 2 + 0.5, y_front, y0 + 0.01, z_full - CF_RIB_T / 2, z_full + CF_RIB_T / 2)
    return deep + rib


def louver_segments(zc, segs):
    """A louver row's x segments, minus the S3's post pad wherever the slot would cut into a post's root.
    P3: the rows stay below the posts, nothing changes."""
    hxs = [h[0] for h in V.S3_HOLES]; hzs = [h[1] for h in V.S3_HOLES]
    px0, px1 = min(hxs) - 3.7 - 1.0, max(hxs) + 3.7 + 1.0
    r = LV_H / 2
    s_lo, s_hi = zc - r - 0.5, zc + LV_DEPTH + r + 0.5                   # the slot rises LV_DEPTH going inward
    if not any(s_lo < hz + S3_POST_D / 2 and s_hi > hz - S3_POST_D / 2 for hz in hzs):
        return segs
    out = []
    for xa, xb in segs:
        for a, b in ((xa, min(xb, px0)), (max(xa, px1), xb)):
            if (a, b) == (xa, xb) or b - a >= 2 * r + 4.0:               # untouched, or a clipped piece long enough to keep
                out.append((a, b))
    return out


def standoff(x, z, y0):
    zc = ZC + z
    post = cyl_y(x, zc, FOOT_Y, y0 + 0.01, SO_OD, 48)
    post = post - cyl_y(x, zc, FOOT_Y + SO_FLOOR, D, SO_BORE, 48)         # tube for the screw head and the key
    post = post - cyl_y(x, zc, FOOT_Y - 1, FOOT_Y + SO_FLOOR + 0.1, SO_HOLE, 32)
    post = post - so_cone(x, zc)
    return post


def so_cone(x, zc):
    y_top = FOOT_Y + SO_FLOOR
    return Manifold.cylinder(SO_CONE_H + 0.01, SO_HOLE / 2, SO_BORE / 2 + 0.01, 48).rotate([-90, 0, 0]).translate([x, y_top - SO_CONE_H, zc])


def back_plate3(window=True):
    y1 = D - BACKL + (PLATE_T3 - PLATE_T)
    y0 = y1 - PLATE_T3
    hz = BORE_HZ - 0.2 - GAP3
    p = prism_y(rr_cs(BORE_HX - 0.2, hz, BORE_R - 0.2), y0, y1)
    t_top = ZC + BORE_HZ + 1.0
    for sx in (-1, 1):                                                   # tongues reach up into the shell's top grooves
        p = p + box(sx * TONGUE_X - TONGUE_W / 2, sx * TONGUE_X + TONGUE_W / 2, y0, y1, ZC + hz - 0.5, t_top)
        if V.DETENT:                                                     # snap bump: gentle lead-in toward the front, steeper back face
            pts = [(y0 + 0.2, t_top - 0.01), (y0 + 0.8, t_top + BUMP_H), (y0 + 1.3, t_top + BUMP_H), (y0 + 1.6, t_top - 0.01)]
            cs = CrossSection([pts])
            if cs.area() <= 0:
                cs = CrossSection([pts[::-1]])
            p = p + prism_x(cs, sx * TONGUE_X - BUMP_W / 2, sx * TONGUE_X + BUMP_W / 2)
    # perimeter skirt
    ring = rr_cs(BORE_HX - 0.2, hz, BORE_R - 0.2) - rr_cs(BORE_HX - 0.2 - SKIRT_T, hz - SKIRT_T, BORE_R - 0.2 - SKIRT_T)
    skirt = prism_y(ring, y0 - SKIRT_D, y0 + 0.01)
    if y0 - SKIRT_D < KY + 12.7 + 1.0:                                   # skirt reaches the encoder board: cut it back there
        skirt = skirt - box(-SKIRT_NOTCH, SKIRT_NOTCH, y0 - SKIRT_D - 1, y0 - 0.5, ZC, ZC + 60)
    p = p + skirt
    p = p + corner_flange(y0, hz)
    if V.LATCH:                                                          # corner latch bumps (case2.LATCH)
        rp = BORE_R - 0.2
        p = p + Manifold.batch_boolean([V.radial_sweep(c, rp, V.LT_BUMP, V.LT_BUMP_A, y0) for c in V.corner_arcs()], ADD)
    inner_cs = rr_cs(BORE_HX - 0.2 - SKIRT_T, hz - SKIRT_T, BORE_R - 0.2 - SKIRT_T)
    y_in = y1 - LV_DEPTH                                                  # bands stand 3 mm off the plate's inner face

    def band(zb0, zb1):
        pts = [(y0 + 0.01, zb0), (y_in + LV_CH, zb0), (y_in, zb0 + LV_CH), (y_in, zb1 - LV_CH), (y_in + LV_CH, zb1), (y0 + 0.01, zb1)]
        cs = CrossSection([pts])
        if cs.area() <= 0:                                               # clockwise comes back empty: use the other winding
            cs = CrossSection([pts[::-1]])
        return prism_x(cs, -BORE_HX, BORE_HX) ^ prism_y(inner_cs, y_in - 1, y0 + 1)

    def rrect_y(x0, x1, z0, z1, r, ya, yb):                               # rounded rectangle in (x, z), along y
        cs = CrossSection.square([x1 - x0 - 2 * r, z1 - z0 - 2 * r], center=True).offset(r, JT, circular_segments=24).translate([(x0 + x1) / 2, (z0 + z1) / 2])
        return prism_y(cs, ya, yb)

    def rrect_z(x0, x1, ya, yb, r, z0, z1):                               # rounded rectangle in (x, y), along z
        cs = CrossSection.square([x1 - x0 - 2 * r, yb - ya - 2 * r], center=True).offset(r, JT, circular_segments=24).translate([(x0 + x1) / 2, (ya + yb) / 2])
        return Manifold.extrude(cs, z1 - z0).translate([0, 0, z0])

    zbot = ZC - hz
    ztop = ZC + hz
    rows = [(z, LV_BOTTOM_X) for z in LV_BOTTOM_Z] + [(z, LV_TOP_X) for z in LV_TOP_Z]
    if LOUVERS:
        p = p + band(zbot, LV_BOTTOM_Z[-1] + LV_H / 2 + LV_DEPTH + 1.5)
        top = band(LV_TOP_Z[0] - LV_H / 2 - 1.5, ztop)
        if y_in < KY + 12.7 + 1.0:                                       # band reaches the encoder board: cut it back there
            nx, nz = ENC_NOTCH
            top = top - rrect_y(-nx, nx, nz, ztop + 10, 3.0, y_in - 1, y0 - 0.5)
        p = p + top
    # solids first; every hole and slot is cut at the end, so nothing added later fills them
    for x in [sx * scx for sx in (-1, 1) for scx in SCREW_XS]:           # bottom bosses (rounded)
        p = p + rrect_z(x - 5, x + 5, SCREW_Y - 4.5, y1, 2.0, WALL + 0.2, WALL + 12.0)
    for x, z in STANDOFFS:
        p = p + standoff(x, z, y0)
    for sx in (-1, 1):                                                   # keyhole bumps (stadiums)
        x = sx * KEY_X
        rb = KH_POCKET_R + KH_WALL
        p = p + rrect_y(x - rb, x + rb, KEY_Z - rb, KEY_Z + KH_TRAVEL + rb, rb - 0.1, y0 - KH_BUMP_D, y0 + 0.01)
    bx0, bx1, bz0, bz1 = TIE_BRIDGE                                      # tie-down bridge
    p = p + rrect_z(bx0, bx1, y0 - STRAP_H - 1.8, y0 + 0.01, 0.9, bz0, bz1)
    tube_end = PCB_Y0 + 1.6 + 1.5                                        # status light tube
    p = p + cyl_y(V.S3_NEO_X, V.S3_NEO_Z, tube_end, y0 + 0.01, 7.0, 48)
    yc = V.S3_PCB_Y + 1.6                                                # S3: one rounded pad under the four posts, then the posts
    hxs = [h[0] for h in V.S3_HOLES]; hzs = [h[1] for h in V.S3_HOLES]
    p = p + rrect_y(min(hxs) - 3.7, max(hxs) + 3.7, min(hzs) - 3.7, max(hzs) + 3.7, 3.7, y0 - 3.0, y0 + 0.01)
    for hx, hz_ in V.S3_HOLES:
        p = p + cyl_y(hx, hz_, yc, y0 + 0.01, S3_POST_D, 32)
    btop = yc + 1.9                                                      # Boot guide tube
    p = p + cyl_y(V.S3_BOOT_X, V.S3_BOOT_Z, btop + 1.0, y0 + 0.01, 5.0, 32)
    # ribbon hooks: the 20.3 mm ribbon (with its fold, ~2.5 mm thick) slides under a lip on each side. v2's hooks left 1.5 mm
    # under the lip, 0.5 mm beside the ribbon and 1.5 mm of overlap; now 3 mm, 1 mm and 3 mm, on sturdier 5 x 3 mm posts
    RZ, RW = ZC - 5.0, 20.3
    HK_W, HK_T, HK_GAP, HK_LIP, HK_SIDE, HK_LIP_T = 5.0, 3.0, 3.0, 3.0, 1.0, 1.5
    for hx in panel.P['hooks']:
        for side in (-1, 1):
            zi = RZ + side * (RW / 2 + HK_SIDE)                         # post's inner face
            zo = zi + side * HK_T                                       # post's outer face
            ya, yb = y0 - HK_GAP - HK_LIP_T, y0 - HK_GAP                # lip: HK_GAP off the plate, HK_LIP_T thick
            p = p + box(hx - HK_W / 2, hx + HK_W / 2, ya, y0 + 0.01, min(zi, zo), max(zi, zo))
            tip = zi - side * (HK_SIDE + HK_LIP)                        # lip reaches HK_LIP over the ribbon's edge
            p = p + Manifold.batch_hull([box(hx - HK_W / 2, hx + HK_W / 2, ya, yb, min(zi, zo), max(zi, zo)),   # 45-deg underside: prints unsupported
                                         box(hx - HK_W / 2, hx + HK_W / 2, ya, ya + 0.01, tip - 0.005, tip + 0.005)])
    # ---- cuts
    cuts = []
    if LOUVERS:
        r = LV_H / 2
        for zc, segs in rows:
            for xa, xb in louver_segments(zc, segs):
                def slab(y, dz):
                    cs = CrossSection.square([xb - xa - 2 * r, 0.01], center=True).offset(r, JT, circular_segments=16).translate([(xa + xb) / 2, zc + dz])
                    return prism_y(cs, y, y + 0.01)
                cuts.append(Manifold.batch_hull([slab(y1 + 0.5, -0.5), slab(y_in - 0.5, LV_DEPTH + 0.5)]))
    if PILLS:
        for x in V.PILL_XS:
            st = CrossSection.square([0.01, (V.PILL_Z1 - V.PILL_Z0) - 4.4], center=True).offset(2.2, JT, circular_segments=SEG).translate([x, (V.PILL_Z0 + V.PILL_Z1) / 2])
            cuts.append(prism_y(st, y0 - 1, y1 + 1))
    nut_end = SCREW_Y + NUT_FLOAT + NUT_CORNER                           # bottom bosses: y-slot screw hole, closed nut slot
    mouth_end = SCREW_Y - NUT_FLOAT - NUT_CORNER                         # with a narrowed mouth and a lead-in
    for x in [sx * scx for sx in (-1, 1) for scx in SCREW_XS]:
        yb = SCREW_Y - 4.5
        slot = CrossSection.square([0.01, 2 * NUT_FLOAT], center=True).offset(1.75, JT, circular_segments=24).translate([x, SCREW_Y])
        cuts.append(Manifold.extrude(slot, 20).translate([0, 0, WALL - 1]))
        nz0 = WALL + 4.0
        cuts.append(box(x - NUT_W / 2, x + NUT_W / 2, mouth_end, nut_end, nz0, nz0 + NUT_H))
        cuts.append(box(x - NUT_MOUTH / 2, x + NUT_MOUTH / 2, yb - 1, mouth_end + 0.01, nz0, nz0 + NUT_H))
        cuts.append(Manifold.batch_hull([box(x - NUT_W / 2 - 0.4, x + NUT_W / 2 + 0.4, yb - 1, yb, nz0 - 0.2, nz0 + NUT_H + 0.2),
                                         box(x - NUT_MOUTH / 2, x + NUT_MOUTH / 2, yb + 0.6, yb + 0.61, nz0, nz0 + NUT_H)]))
    for x, z in STANDOFFS:                                               # standoff tubes, open on the outer face
        cuts.append(cyl_y(x, ZC + z, FOOT_Y + SO_FLOOR, y1 + 1, SO_BORE, 48))
        cuts.append(so_cone(x, ZC + z))
    for sx in (-1, 1):                                                   # keyhole: head pocket (stadium) and the keyhole
        x = sx * KEY_X
        r = KH_POCKET_R
        cuts.append(rrect_y(x - r, x + r, KEY_Z - r, KEY_Z + KH_TRAVEL + r, r - 0.05, y0 - KH_POCKET_D, y0 + 0.02))
        kh = CrossSection.circle(KH_ENTRY / 2, 48).translate([x, KEY_Z]) + CrossSection.square([KH_SLOT, KH_TRAVEL]).translate([x - KH_SLOT / 2, KEY_Z])
        cuts.append(prism_y(kh, y0 - 1, y1 + 1))
    cuts.append(box(bx0 + 2, bx1 - 2, y0 - STRAP_H, y0 + 0.02, bz0 - 1, bz1 + 1))   # tie-down bridge gap
    for sx in (-1, 1):                                                   # wall-spacer recesses (outer face)
        cuts.append(cyl_y(sx * WB_X, WB_Z, y1 - WB_RECESS_T, y1 + 1, WB_RECESS_D, 64))
    if BAY:                                                              # ribbon bay behind the S3's plug (v3 only)
        bx0_, bx1_, bz0_, bz1_ = BAY
        cuts.append(box(bx0_, bx1_, y0 - 1, y1 - 0.8, bz0_, bz1_))
    cuts.append(cyl_y(V.S3_NEO_X, V.S3_NEO_Z, tube_end - 1, y0 + 0.5, 4.5, 48))
    for hx, hz_ in V.S3_HOLES:                                           # S3 pilots, Ø2.4 with a 0.5 mm lead-in
        cuts.append(cyl_y(hx, hz_, yc - 1, yc + 8.0, S3_PILOT, 24))
        cuts.append(Manifold.cylinder(S3_LEAD + 0.01, S3_PILOT / 2 + S3_LEAD, S3_PILOT / 2, 24).rotate([-90, 0, 0]).translate([hx, yc - 0.01, hz_]))
    cuts.append(cyl_y(V.S3_BOOT_X, V.S3_BOOT_Z, btop + 0.5, y1 + 1, 2.6, 24))
    cuts.append(Manifold.cylinder(1.0, 1.3, 2.4, 32).rotate([-90, 0, 0]).translate([V.S3_BOOT_X, y1 - 1.0 + 0.001, V.S3_BOOT_Z]))
    if window == 'rod':                          # one colour, opaque, with a translucent rod down the tube (status_rod())
        cuts.append(cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y0 - 1, y1 + 1, ROD_D + 0.2, 32))
        cuts.append(cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y1 - ROD_HEAD_T, y1 + 1, ROD_HEAD_D + 0.2, 48))
        window = status_rod()
    elif window == 'open':                       # one colour, opaque: the tube opens in a Ø3 hole, 0.5 mm chamfer outside
        cuts.append(cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y0 - 1, y1 + 1, 3.0, 32))
        cuts.append(Manifold.cylinder(0.51, 1.5, 2.0, 32).rotate([-90, 0, 0]).translate([V.S3_NEO_X, y1 - 0.5, V.S3_NEO_Z]))
        window = None
    elif window:
        cuts.append(cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y0 + 0.4, y1 + 1, 6.0, 48))
        window = cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y0 + 0.4, y1, 5.9, 48)
    else:
        cuts.append(cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y0 - 1, y1 - 0.6, 4.5, 48))
        window = None
    if V.LATCH:                                                          # free the corner fingers: an arc slot inside each
        rp = BORE_R - 0.2                                                # and a radial cut at its free end
        r_in = rp - V.LT_FW
        da = math.degrees(V.LT_SW / rp)
        for (cx, cz), amap in V.corner_arcs():
            a0, a1 = sorted((amap(V.LT_A0), amap(V.LT_A1)))
            cuts.append(prism_y(V.sector_cs(cx, cz, r_in - V.LT_SW, r_in, a0, a1), y0 - SKIRT_D - 1, y1 + 1))
            af = amap(V.LT_A1)
            b0, b1 = sorted((af, af + (da if af > amap(V.LT_A0) else -da)))
            cuts.append(prism_y(V.sector_cs(cx, cz, r_in - V.LT_SW, rp + 2.0, b0, b1, 6), y0 - SKIRT_D - 1, y1 + 1))
    p = p - Manifold.batch_boolean(cuts, ADD)
    p = max(p.decompose(), key=lambda m: m.volume())                    # drop zero-volume slivers left by the latch slot cuts
    return p, window


def panel_template():
    """Flat check piece laid on the panel's back (print it panel side down; that face goes onto the panel).
    Rim on the panel outline, a Ø3.4 hole at every insert estimate inside a Ø11 ring (the standoff foot),
    and an arrow tab on the PI IN side (case +x). If an M3 screw drops into each insert through the template,
    the estimates hold; otherwise measure the offset at each hole."""
    t = 1.2
    y0, y1 = PANEL_BACK, PANEL_BACK + t
    hx, hz = PANEL_X, PANEL_Z
    rim = box(-hx, hx, y0, y1, ZC - hz, ZC + hz) - box(-hx + 5, hx - 5, y0 - 1, y1 + 1, ZC - hz + 5, ZC + hz - 5)
    parts = [rim]
    for x, z in INSERTS_ALL:
        zc = ZC + z
        parts.append(cyl_y(x, zc, y0, y1, 11.0, 48))
        # spoke to the nearest rim edge (horizontal)
        ex = hx - 2.5 if x > 0 else -hx + 2.5
        parts.append(box(min(x, ex), max(x, ex), y0, y1, zc - 1.5, zc + 1.5))
    parts.append(box(hx, hx + 8, y0, y1, ZC - 4, ZC + 4))
    m = Manifold.batch_boolean(parts, ADD)
    m = m + Manifold.batch_hull([box(hx + 8, hx + 8.01, y0, y1, ZC - 7, ZC + 7), box(hx + 15, hx + 15.01, y0, y1, ZC - 0.01, ZC + 0.01)])
    for x, z in INSERTS_ALL:
        zc = ZC + z
        m = m - cyl_y(x, zc, y0 - 1, y1 + 1, 3.4, 32)
        m = m - (cyl_y(x, zc, y0 - 1, y1 + 1, 10.0, 48) - cyl_y(x, zc, y0 - 1, y1 + 1, 9.2, 48)).translate([0, t * 0.6, 0])   # ring groove marks the foot
    return m


def coupon_s3_pilots():
    """Three Ø5 posts, 10 mm tall, pilots Ø2.3 / 2.4 / 2.5 with the lead-in, on a 2 mm base. Try an M2.5 x 8 in each."""
    base = Manifold.cube([30, 10, 2])
    m = base
    for i, d in enumerate((2.3, 2.4, 2.5)):
        x = 5 + i * 10
        post = Manifold.cylinder(12, 2.5, 2.5, 32).translate([x, 5, 0])
        post = post - Manifold.cylinder(10, d / 2, d / 2, 24).translate([x, 5, 2.01])
        post = post - Manifold.cylinder(S3_LEAD + 0.01, d / 2, d / 2 + S3_LEAD, 24).translate([x, 5, 12 - S3_LEAD])
        m = m + post
        for k in range(i + 1):                                           # 1, 2, 3 notches in the base mark the sizes
            m = m - Manifold.cube([1, 1.2, 3]).translate([x - 2 + k * 1.6, -0.01, -0.5])
    return m


def wall_spacer():
    """Disc glued into the plate's recess; the bumper sticks on its face. Print 2, flat, 100% infill."""
    m = Manifold.cylinder(WB_SPACER_T, WB_SPACER_D / 2, WB_SPACER_D / 2, 64)
    return m - (Manifold.cylinder(0.41, WB_SPACER_D / 2 + 1, WB_SPACER_D / 2 + 1, 64) -
                Manifold.cylinder(0.41, WB_SPACER_D / 2 - 0.4, WB_SPACER_D / 2 + 0.01, 64)).translate([0, 0, WB_SPACER_T - 0.4])   # 0.4 chamfer on the top edge


def status_rod():
    """Translucent light rod for the status LED, in case coordinates: flush head in the plate's outer recess, shaft down
    the light tube to ROD_GAP above the LED. Print head down (the flush face on the bed), 100% infill."""
    y1 = D - BACKL + (PLATE_T3 - PLATE_T)
    tip = V.S3_PCB_Y + 1.6 + 0.9 + ROD_GAP
    rod = cyl_y(V.S3_NEO_X, V.S3_NEO_Z, tip, y1, ROD_D, 32) + cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y1 - ROD_HEAD_T, y1, ROD_HEAD_D, 48)
    return rod


def boot_key3():
    """Boot key for a plate of PLATE_T3 (same as case2.boot_key() at 2 mm)"""
    reach = (D - BACKL + (PLATE_T3 - PLATE_T)) - (PCB_Y0 + 1.6 + 1.9) + 0.6
    rod = Manifold.cube([reach, 1.6, 1.6]).rotate([45, 0, 0]).translate([0, 0, 1.13])
    grip = Manifold.cube([2.0, 10.0, 2.26]).translate([-2.0, -5.0, 0])
    return rod + grip


def to_bed_back_down(m):
    import trimesh
    me = m.to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))     # +y -> -z: outer face on the bed
    return t


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    p, rod = back_plate3(window='rod')
    t = to_bed_back_down(p); t.apply_translation([0, 0, -t.bounds[0][2]]); t.export(f'{out}/bar-backplate-v3.stl')
    print('plate', t.is_watertight, np.round(t.extents, 1).tolist())
    t = to_bed_back_down(rod); t.apply_translation([0, 0, -t.bounds[0][2]]); t.export(f'{out}/bar-status-rod-translucent.stl')
    print('rod', t.is_watertight, np.round(t.extents, 2).tolist())
    # template: panel-side face (y = PANEL_BACK) on the bed
    me = panel_template().to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])); t.apply_translation([0, 0, -t.bounds[0][2]])
    t.export(f'{out}/check-panel-insert-template.stl'); print('template', t.is_watertight, np.round(t.extents, 1).tolist())
    me = wall_spacer().to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.export(f'{out}/bar-wall-spacer.stl'); print('wall spacer', t.is_watertight, np.round(t.extents, 2).tolist())
    me = coupon_s3_pilots().to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.export(f'{out}/coupon-v4-s3-pilots.stl'); print('pilot coupon', t.is_watertight)
    # boss coupon: the plate's bottom-left corner around one boss; screw it through the real shell's floor hole
    region = box(-SCREW_XS[0] - 9, -SCREW_XS[0] + 9, 40, D, 0, 18)
    c = to_bed_back_down(p ^ region); c.apply_translation([0, 0, -c.bounds[0][2]])
    c.export(f'{out}/coupon-v4-plate-boss.stl'); print('boss coupon', c.is_watertight, np.round(c.extents, 1).tolist())
    # funnel coupon: one standoff (top right) on a patch of plate; drop an M3 x 8 countersunk down it, screw it into an insert
    sx_, sz_ = max(STANDOFFS, key=lambda q: (q[0], q[1]))
    region = box(sx_ - 8, sx_ + 8, 0, D + 1, ZC + sz_ - 8, ZC + sz_ + 8)
    c = to_bed_back_down(p ^ region); c.apply_translation([0, 0, -c.bounds[0][2]])
    c.export(f'{out}/coupon-v4-standoff-funnel.stl'); print('funnel coupon', c.is_watertight, np.round(c.extents, 1).tolist())
    if V.LATCH:   # latch coupons: the shell's top-right corner and the plate's, to try the click before the full prints
        saved = V.SKINS, V.SKIN_USB, V.SENSOR_PRINTED, V.GLUED_FRAME, V.BACKDOWN
        V.SKINS, V.SKIN_USB, V.SENSOR_PRINTED, V.GLUED_FRAME, V.BACKDOWN = False, False, False, False, True
        try:
            sh = V.shell2()
        finally:
            V.SKINS, V.SKIN_USB, V.SENSOR_PRINTED, V.GLUED_FRAME, V.BACKDOWN = saved
        (lcx, lcz), _ = V.corner_arcs()[0]
        reg = box(lcx - 14, lcx + 20, V.PLATE_Y0 - 12, D + 1, lcz - 14, lcz + 20)
        c = to_bed_back_down(sh ^ reg); c.apply_translation([0, 0, -c.bounds[0][2]])
        c.export(f'{out}/coupon-v4-latch-shell.stl'); print('latch shell coupon', c.is_watertight, np.round(c.extents, 1).tolist())
        c = to_bed_back_down(p ^ reg); c.apply_translation([0, 0, -c.bounds[0][2]])
        c.export(f'{out}/coupon-v4-latch-plate.stl'); print('latch plate coupon', c.is_watertight, np.round(c.extents, 1).tolist())
