"""Shell v2: printed FRONT-DOWN, tilted so the slanted front rim lies flat on the bed.
Changes from case.py (v1, printed back-down):
- front rim: 0.45 mm chamfers (outer and inner edge) instead of 1 mm rounds; it is the first layer
- screen rim: a slim triangular rim (45 deg both faces, RIM_IN inward) instead of the flat ledge + seat;
  the diffuser's front edge (bore - 0.9) seats on the back slope, so its face stays at y = 12. Its top and
  bottom runs lie along the layers, and a flat ledge started and ended there in one layer (a 10-15 % area
  step); the triangle ramps in and out over several layers, with half the material
- no grilles in the shell (GRILLES = False): venting moved to the back plate (back_plate2: taller pill
  vents and hidden chimney gaps along its top and bottom edges). Every hole cut into the shell's walls
  splits the print layers it crosses into separate pieces and shows as a band; with no grilles the worst
  layer is 3 pieces. Optional light-sensor hole: drilled with drill_guide() (SENSOR_X, SENSOR_Y).
  GRILLES = True gives the front-to-back slot version (top and bottom zones on the same layers).
- teardrops point to the back (the print's up): encoder hole (key notch dropped, the teardrop keys
  the collar), foot recesses, screw holes
- left end, USB-C: a straight-through opening sized for the largest spec plug housing (12.85 x 7.0 mm
  + clearance), so any compliant cable's housing can travel in until it meets the port; the S3's port face
  sits ~1 mm inside the wall (0-3 mm all work), so the edge buttons never touch it. A relief behind the
  edge buttons stays as a margin.
- S3 position is one parameter (S3_EDGE_X); the back plate's light tube and Boot hole follow it, and the
  cradle (still to design) puts the board there
Back plate, diffuser and the rest are unchanged (case.py)."""
import math, sys
import numpy as np
import manifold3d
from manifold3d import Manifold, CrossSection
from case import *          # parameters and helpers from v1
import panel

K = (LT - LB) / H                         # front slope: y_front(z) = K * (H - z)
CH_F = 0.45                               # front rim chamfers (leaves ~1.6 mm of rim on the bed)
RIM_IN = 1.2                              # how far the rim reaches in from the bore (visible frame)
RIM_PEAK = Y_FACE - (RIM_IN - 0.9)        # 11.7: peak; the diffuser's front edge (bore - 0.9) meets the back slope at y = 12
BACKDOWN = False                         # True: shell prints back-down (layers square to the case); screen rim is a glued-in frame
GRILLES = False
DETENT = True                             # v4: top snap (dimples in the tongue grooves; bumps on plate3's tongues)
DET_W, DET_DEPTH = 20.0, 0.5
# Corner latches (both top corners): the tongue snap's spring was the shell's top wall, which also let it pop out. The
# shell can't be ribbed inside (the diffuser flange fills the bore all the way back), so the catch goes where the shell
# is already stiff, the R11.5 corner arcs: a dimple in each top corner's wall, and a springy PETG finger cut into the
# plate's corner (skirt included) with a bump that clicks into it. 30-deg lead-in, ~50-deg back face: it takes a firm pull,
# or a press on the finger from the back, to release.
LATCH = True
LT_A0, LT_A1 = 10.0, 80.0                 # finger: attached at LT_A0 (side), free at LT_A1 (top), degrees from the side
LT_FW, LT_SW = 3.0, 1.0                   # finger width (radial; the 2 mm skirt + 1 mm of plate), slot width
LT_BUMP_A = (50.0, 74.0)                  # bump's angular span on the finger
LT_H = 0.8                                # bump height; 0.6 of it is interference (the plate is 0.2 inside the bore)
# bump profile along y, relative to the plate's inner face y0: (dy, height)
LT_BUMP = [(-5.0, 0.0), (-3.6, LT_H), (-2.8, LT_H), (-2.1, 0.0)]
LT_DIMPLE = [(-5.6, 0.0), (-3.9, 0.7), (-2.6, 0.7), (-2.0, 0.0)]   # in the bore wall (0.7 deep: 1.8 mm of wall left)
LT_DIMPLE_A = (46.0, 78.0)
PLATE_Y0 = D - BACKL - PLATE_T            # the plate's inner face, seated
SKINS = True                              # print the knob hole and screw holes closed by a 0.5 mm
SKIN_USB = True                           # USB-C: cut out a larger opening; port_bezel() covers the cut edge
SENSOR_PRINTED = False                    # print the Ø2 light-sensor hole open instead of drilling it
SENSOR_POCKET = True                      # blind Ø2 pocket from inside, 0.8 mm short of the outside: marks the optional sensor
                                          # hole; drill through from inside only if the sensor is fitted
GLUED_FRAME = True                        # back-down only: plain sleeve + glued screen_frame(); False = built-in rim (as front-down)
CUT_H, CUT_W, CUT_R = 15.6, 10.2, 2.1     # the cut-out opening (z x y) the bezel's plug fills
SKIN_T = 0.5                              # outer skin (cut / drilled out after printing) so the outer wall stays one loop;
                                          # just over one 0.4-nozzle line (~0.42): at 0.4 the slicer dropped it
SL_W, SL_PITCH = 1.5, 4.0                 # slots (GRILLES = True only)
SENSOR_X, SENSOR_Y, SENSOR_D = panel.P['sensor_x'], 42.0, 2.0   # light-sensor hole (Ø2, a 2 mm or 5/64" bit), drilled through drill_guide()
TOP_SL = dict(xc=57.0, n=16, y0=30.5, y1=46.5)
BOT_SL = dict(xs=[50.0 + 4.0 * i for i in range(7)], y0=TOP_SL['y0'] + 9.0, y1=TOP_SL['y1'] + 9.0)  # +9: same layers
BTN_Z0, BTN_Z1 = PORT_Z - 35.0, PORT_Z - 8.8  # Down (-10.3), Up (-20.1), Reset (-29.9) sit below the USB-C   # Down (+9.9), Up (+19.8), Reset (+29.7) on the S3 edge
BTN_WALL = 0.8                                 # wall left behind the buttons
PORT_H, PORT_W = 13.65, 8.0                    # USB-C opening: along the port's long axis (z) x across (y);
                                               # spec housing max 12.85 x 7.0 + 0.4 a side, +0.2 across for print sag
PORT_CH = 0.5                                  # outer edge chamfer
S3_EDGE_X = -HW + WALL + 2.0                   # S3 port face / board edge, 2 mm inside the wall (edge buttons clear it sliding in)
S3_USB_BY = 8.255                              # Adafruit board file (board frame: x from the button edge, y up the edge)
def s3xz(bx, by):
    """S3 board point -> case (x, z): component side faces the back plate, so seen from the back the board is
    rotated 180 deg from Adafruit's top view; the USB-C is the top of the edge, then Down, Up, Reset below it"""
    return S3_EDGE_X + bx, PORT_Z + S3_USB_BY - by
S3_PCB_Y = PCB_Y0                              # PCB front (panel-side) face; component side at PCB_Y0 + 1.6
S3_HOLES = [s3xz(7.62, 15.875), s3xz(7.62, 35.56), s3xz(48.26, 35.56), s3xz(48.26, 15.875)]   # M2.5, plated
S3_NEO_X, S3_NEO_Z = s3xz(12.192, 41.021)      # WS2812B 3535 status LED
S3_BOOT_X, S3_BOOT_Z = s3xz(14.58, 28.524)     # KMR2 Boot switch, 1.9 mm tall


def tilt_matrix():
    phi = math.atan2(1.0, K)              # rotate about x so the front plane's normal (0, 1, K) points up
    c, s = math.cos(phi), math.sin(phi)
    return np.array([[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1.0]])


def front_y(z):
    return K * (H - z)


def outer_body():
    """slanted-front sleeve: chamfered front edge, RIM_R rounds on the back rim"""
    pts = []
    for (x, z) in rr_cs(HW - CH_F, H / 2 - CH_F, RC - CH_F).to_polygons()[0]:
        pts.append((x, front_y(z), z))
    for (x, z) in rr_cs(HW, H / 2, RC).to_polygons()[0]:
        pts.append((x, front_y(z) + CH_F, z))
    if BACKDOWN:                                   # back rim on the bed: chamfers, like the front
        for (x, z) in rr_cs(HW - CH_F, H / 2 - CH_F, RC - CH_F).to_polygons()[0]:
            pts.append((x, D, z))
        for (x, z) in rr_cs(HW, H / 2, RC).to_polygons()[0]:
            pts.append((x, D - CH_F, z))
        return Manifold.hull_points(np.array(pts))
    r = RIM_R
    sp = sphere_pts(r)
    for (x, z) in rr_cs(HW - r, H / 2 - r, RC - r).to_polygons()[0]:
        pts.extend(sp + np.array([x, D - r, z]))
    return Manifold.hull_points(np.array(pts))


def inner_back_chamfer():
    pts = []
    for (x, z) in rr_cs(BORE_HX + CH_F, BORE_HZ + CH_F, BORE_R + CH_F).to_polygons()[0]:
        pts += [(x, D + 0.01, z), (x, D + 3.0, z)]
    for (x, z) in rr_cs(BORE_HX, BORE_HZ, BORE_R).to_polygons()[0]:
        pts.append((x, D - CH_F, z))
    return Manifold.hull_points(np.array(pts))


def inner_front_chamfer():
    pts = []
    for (x, z) in rr_cs(BORE_HX + CH_F, BORE_HZ + CH_F, BORE_R + CH_F).to_polygons()[0]:
        pts += [(x, front_y(z) - 3.0, z), (x, front_y(z) - 0.01, z)]
    for (x, z) in rr_cs(BORE_HX, BORE_HZ, BORE_R).to_polygons()[0]:
        pts.append((x, front_y(z) + CH_F, z))
    return Manifold.hull_points(np.array(pts))


def sector_cs(cx, cz, r0, r1, a0, a1, n=24):
    """annular sector in the (x, z) plane; angles in degrees from +x toward +z"""
    a = np.radians(np.linspace(a0, a1, n))
    outer = [(cx + r1 * math.cos(t), cz + r1 * math.sin(t)) for t in a]
    inner = [(cx + r0 * math.cos(t), cz + r0 * math.sin(t)) for t in a[::-1]]
    cs = CrossSection([outer + inner])
    return cs if cs.area() > 0 else CrossSection([(outer + inner)[::-1]])


def corner_arcs():
    """top-right and top-left corner centres and their angle maps (side end at 0 deg)"""
    cx, cz = BORE_HX - BORE_R, ZC + BORE_HZ - BORE_R
    return [((cx, cz), lambda t: t), ((-cx, cz), lambda t: 180.0 - t)]


def radial_sweep(centre, r_base, profile, angles, y_ref):
    """solid on an arc: at each y station (y_ref + dy) it spans r_base - 0.5 .. r_base + h, over the given angles"""
    (cx, cz), amap = centre
    a0, a1 = sorted((amap(angles[0]), amap(angles[1])))
    def sl(dy, h):
        return prism_y(sector_cs(cx, cz, r_base - 0.5, r_base + max(h, 0.01), a0, a1), y_ref + dy, y_ref + dy + 0.001)
    return Manifold.batch_boolean([Manifold.batch_hull([sl(*p), sl(*q)]) for p, q in zip(profile, profile[1:])], ADD)


def latch_dimples():
    return Manifold.batch_boolean([radial_sweep(c, BORE_R, LT_DIMPLE, LT_DIMPLE_A, PLATE_Y0) for c in corner_arcs()], ADD)


def teardrop_cs(r, cx, cy, trunc=None, seg=64):
    """circle with a 45-deg point toward +y (the print's up); optionally truncated flat at cy + trunc"""
    a = r * math.cos(math.pi / 4)
    tip = r * math.sqrt(2)
    if trunc is None or trunc >= tip:
        tri = [(a, a), (0, tip), (-a, a)]
    else:
        w = tip - trunc
        tri = [(a, a), (w, trunc), (-w, trunc), (-a, a)]
    if BACKDOWN:                                   # print's up is -y: point the teardrop to the front
        tri = [(x, -y) for (x, y) in tri][::-1]
    return (CrossSection.circle(r, seg) + CrossSection([tri])).translate([cx, cy])


def slot_z(x, y0, y1, z0, z1):
    cs = CrossSection.square([0.01, (y1 - y0) - SL_W], center=True).offset(SL_W / 2, JT, circular_segments=24).translate([x, (y0 + y1) / 2])
    return Manifold.extrude(cs, z1 - z0).translate([0, 0, z0])


def shell2():
    s = outer_body() - inner_front_chamfer()
    bore_cs = rr_cs(BORE_HX, BORE_HZ, BORE_R)
    if BACKDOWN:
        s = s - inner_back_chamfer()
    if BACKDOWN and GLUED_FRAME:                   # plain sleeve; the screen rim is screen_frame(), glued in
        cuts = [prism_y(bore_cs, -50, D + 1)]
    else:                                          # built-in rim: two 45-deg slopes, prints either way up without supports
        lo = rr_cs(BORE_HX - RIM_IN, BORE_HZ - RIM_IN, BORE_R - RIM_IN)
        y_a, y_b = RIM_PEAK - RIM_IN, RIM_PEAK + RIM_IN
        cuts = [prism_y(bore_cs, -50, y_a),
                Manifold.batch_hull([prism_y(bore_cs, y_a - 0.001, y_a), prism_y(lo, RIM_PEAK, RIM_PEAK + 0.001)]),   # front slope
                Manifold.batch_hull([prism_y(lo, RIM_PEAK - 0.001, RIM_PEAK), prism_y(bore_cs, y_b, y_b + 0.001)]),   # back slope = diffuser seat
                prism_y(bore_cs, y_b - 0.001, D + 1)]
    # slots (optional)
    for sx in ((-1, 1) if GRILLES else ()):
        for i in range(TOP_SL['n']):
            x = sx * (TOP_SL['xc'] + (i - (TOP_SL['n'] - 1) / 2) * SL_PITCH)
            cuts.append(slot_z(x, TOP_SL['y0'], TOP_SL['y1'], H - WALL - 1, H + 1))
        for x in BOT_SL['xs']:
            cuts.append(slot_z(sx * x, BOT_SL['y0'], BOT_SL['y1'], -1, WALL + 1))
    # encoder / collar hole: teardrop toward the back
    ztop = H - SKIN_T if SKINS else H + 1          # skin: blind from inside, cut out along the pocket wall (the collar flange hides the edge)
    cuts.append(Manifold.extrude(teardrop_cs(ENC_HOLE / 2, 0, KY, seg=SEG), ztop - (H - WALL - 1)).translate([0, 0, H - WALL - 1]))
    if SENSOR_POCKET and not SENSOR_PRINTED:       # blind pocket from inside: invisible outside, guides the bit when drilled
        cuts.append(Manifold.extrude(teardrop_cs(SENSOR_D / 2 + 0.05, SENSOR_X, SENSOR_Y, seg=24), WALL - 0.8 + 1).translate([0, 0, H - WALL - 1]))
    if SENSOR_PRINTED:                             # Ø2 light-sensor hole through the top (teardrop toward the print's up)
        cuts.append(Manifold.extrude(teardrop_cs(SENSOR_D / 2 + 0.05, SENSOR_X, SENSOR_Y, seg=24), WALL + 2).translate([0, 0, H - WALL - 1]))
    # USB-C: straight-through opening for the plug housing, 0.5 mm chamfer outside;
    # relief behind the edge buttons (its top edge at 45 deg for printing)
    def stad(w_y, h_z, r=1.5):            # rounded rectangle (r 1.5 clears a square-cornered spec-max housing)
        return CrossSection.square([w_y - 2 * r, h_z - 2 * r], center=True).offset(r, JT, circular_segments=SEG).translate([PORT_Y, PORT_Z])
    if SKINS and SKIN_USB:                          # blind from inside; cut the skin out along the pocket wall; the bezel hides the edge
        port = prism_x(stad(CUT_W, CUT_H, CUT_R), -HW + SKIN_T, -HW + WALL + 1)
        port_ch = Manifold()
    else:
        port = prism_x(stad(PORT_W, PORT_H), -HW - 1, -HW + WALL + 1)
        port_ch = Manifold.batch_hull([prism_x(stad(PORT_W + 2 * PORT_CH, PORT_H + 2 * PORT_CH, 1.5 + PORT_CH), -HW - 1, -HW), prism_x(stad(PORT_W, PORT_H), -HW + PORT_CH, -HW + PORT_CH + 0.01)])
    def rel(y0, y1, x0, x1):
        cs = CrossSection.square([y1 - y0 - 3.0, BTN_Z1 - BTN_Z0 - 3.0], center=True).offset(1.5, JT, circular_segments=32).translate([(y0 + y1) / 2, (BTN_Z0 + BTN_Z1) / 2])
        return prism_x(cs, x0, x1)
    inner = -HW + WALL + 0.5
    deep = -HW + BTN_WALL
    if BACKDOWN:                                   # the relief's roof is its front edge: 45 deg there
        btn = Manifold.batch_hull([rel(PORT_Y - 7.0, PORT_Y + 4.5, deep, inner), rel(PORT_Y - 7.0 - (inner - deep), PORT_Y + 4.5, inner - 0.01, inner)])
    else:
        btn = Manifold.batch_hull([rel(PORT_Y - 7.0, PORT_Y + 4.5, deep, inner), rel(PORT_Y - 7.0, PORT_Y + 4.5 + (inner - deep), inner - 0.01, inner)])
    cuts += [port, port_ch, btn]
    # feet recesses (full teardrop toward the back: no flat roof to curl and catch the nozzle; the point shows ~3 mm past the bumper, underneath)
    for fx, fy in FEET:
        cuts.append(Manifold.extrude(teardrop_cs(FOOT_D / 2, fx, fy), FOOT_DEPTH + 1).translate([0, 0, -1]))
    # back plate screws from below
    for sx in (-1, 1):
      for scx in SCREW_XS:
        z0 = 1.0 + SKIN_T if SKINS else -1          # skin at the counterbore floor; drill through with a 3.4 mm bit
        cuts.append(Manifold.extrude(teardrop_cs(1.7, sx * scx, SCREW_Y, seg=32), WALL + 1 - z0).translate([0, 0, z0]))
        cuts.append(Manifold.extrude(teardrop_cs(3.2, sx * scx, SCREW_Y, seg=48), 2.0).translate([0, 0, -1]))
    # tongue grooves (as v1)
    yp0 = D - BACKL - PLATE_T
    for sx in (-1, 1):
        cuts.append(box(sx * TONGUE_X - TONGUE_W / 2 - 0.3, sx * TONGUE_X + TONGUE_W / 2 + 0.3, yp0 - 0.3, D + 1, H - WALL - 0.01, H - WALL + 1.3))
        if DETENT:                                  # v4: dimple in the groove roof where the plate's tongue bump seats
            cuts.append(box(sx * TONGUE_X - DET_W / 2 - 1, sx * TONGUE_X + DET_W / 2 + 1, yp0 + 0.0, yp0 + PLATE_T + 0.1,
                            H - WALL + 1.3 - 0.01, H - WALL + 1.3 + DET_DEPTH))
    if LATCH:
        cuts.append(latch_dimples())
    return s - Manifold.batch_boolean(cuts, ADD)


GAP = 2.5                                  # chimney gaps between the back plate and the shell, top and bottom
PILL_Z0, PILL_Z1 = ZC - 35.0, ZC + 20.0     # taller pills; tops stay below the keyhole cups (ZC + 23)
PILL_R, PILL_STEP = 2.2, 9.0
_PILL_LIM = -max(hx for hx, _ in S3_HOLES) - 5.7              # stay 1 mm clear of the S3's post-and-rib frame
PILL_XS = [k * PILL_STEP for k in range(-20, 21) if abs(k * PILL_STEP) <= _PILL_LIM]   # P3: 11 pills, -45..45


def pill_span(x):
    """z range of the pill at x: PILL_Z0..PILL_Z1, shortened to keep 2 mm clear of any v2 hold-down post it lines up
    with (P3: none do)"""
    z0, z1 = PILL_Z0, PILL_Z1
    for px, pz in POSTS:
        if abs(px - x) < POST_D / 2 + PILL_R + 1.0:
            if pz < ZC:
                z0 = max(z0, pz + POST_D / 2 + 2.0)
            else:
                z1 = min(z1, pz - POST_D / 2 - 2.0)
    return z0, z1


def back_plate2(window=True):
    """v1 plate with: outline 2.5 mm short at the top and bottom edges (air in along the bottom, out along the top,
    hidden inside the 4 mm back lip), tongues and screw bosses bridging the gaps, and 55 mm pill vents."""
    y1 = D - BACKL
    y0 = y1 - PLATE_T
    hz = BORE_HZ - 0.2 - GAP
    p = prism_y(rr_cs(BORE_HX - 0.2, hz, BORE_R - 0.2), y0, y1)
    for sx in (-1, 1):                                                   # tongues reach down across the top gap
        p = p + box(sx * TONGUE_X - TONGUE_W / 2, sx * TONGUE_X + TONGUE_W / 2, y0, y1, ZC + hz - 0.5, ZC + BORE_HZ + 1.0)
    for sx in (-1, 1):                                                   # screw bosses (as v1; they span the bottom gap)
        x = sx * SCREW_X
        b = box(x - 5, x + 5, SCREW_Y - 4.5, y1, WALL + 0.2, WALL + 12.0)   # full depth to the outer face: the part below
        b = b - cyl_z(x, SCREW_Y, WALL - 1, WALL + 13, 3.3, 32)              # the plate's edge stands on the bed, no overhang
        b = b - box(x - 2.9, x + 2.9, SCREW_Y - 6, SCREW_Y + 3.0, WALL + 4.0, WALL + 6.7)
        p = p + b
    for px, pz in POSTS:
        p = p + cyl_y(px, pz, PANEL_BACK + 0.5, y0 + 0.01, POST_D, 48)
    for sx in (-1, 1):
        x = sx * KEY_X
        p = p + box(x - 7, x + 7, y0 - 6, y0 + 0.01, KEY_Z - 7, KEY_Z + 15)
        p = p - box(x - 5.5, x + 5.5, y0 - 4.5, y0 + 0.02, KEY_Z - 5.5, KEY_Z + 13.5)
        kh = CrossSection.circle(4.0, 48).translate([x, KEY_Z]) + CrossSection.square([4.2, 10.0]).translate([x - 2.1, KEY_Z])
        p = p - prism_y(kh, y0 - 1, y1 + 1)
    vents = []
    for x in PILL_XS:
        z0, z1 = pill_span(x)
        st = CrossSection.square([0.01, (z1 - z0) - 2 * PILL_R], center=True).offset(PILL_R, JT, circular_segments=SEG).translate([x, (z0 + z1) / 2])
        vents.append(prism_y(st, y0 - 1, y1 + 1))
    p = p - Manifold.batch_boolean(vents, ADD)
    tube_end = PCB_Y0 + 1.6 + 1.5
    p = p + cyl_y(S3_NEO_X, S3_NEO_Z, tube_end, y0 + 0.01, 7.0, 48)
    p = p - cyl_y(S3_NEO_X, S3_NEO_Z, tube_end - 1, y0 + 0.5, 4.5, 48)
    if window:                                   # separate translucent window in a black plate
        p = p - cyl_y(S3_NEO_X, S3_NEO_Z, y0 + 0.4, y1 + 1, 6.0, 48)
        window = cyl_y(S3_NEO_X, S3_NEO_Z, y0 + 0.4, y1, 5.9, 48)
    else:                                        # whole plate translucent: the tube's bore stops 0.6 mm short of the outer face
        p = p - cyl_y(S3_NEO_X, S3_NEO_Z, y0 - 1, y1 - 0.6, 4.5, 48)
        window = None
    # S3 mount: four Ø5 posts to its M2.5 holes (M2.5 x 8 from the panel side, self-tapping into a Ø2.2 pilot),
    # tied by ribs near the plate so a cable push can't flex them
    yc = S3_PCB_Y + 1.6                                   # component face
    for hx, hz in S3_HOLES:
        p = p + cyl_y(hx, hz, yc, y0 + 0.01, 5.0, 32)
        p = p - cyl_y(hx, hz, yc - 1, yc + 8.0, 2.2, 24)
    (x1, z1), (x2, z2), (x3, z3), (x4, z4) = S3_HOLES
    for (ax, az), (bx_, bz) in (((x1, z1), (x2, z2)), ((x4, z4), (x3, z3)), ((x1, z1), (x4, z4)), ((x2, z2), (x3, z3))):
        p = p + box(min(ax, bx_) - 1.2, max(ax, bx_) + 1.2, y0 - 7.0, y0 + 0.01, min(az, bz) - 1.2, max(az, bz) + 1.2)
    # Boot: guide tube from the plate to 1 mm above the switch; Ø2.6 bore, countersunk outside for the printed key
    btop = yc + 1.9
    p = p + cyl_y(S3_BOOT_X, S3_BOOT_Z, btop + 1.0, y0 + 0.01, 5.0, 32)
    p = p - cyl_y(S3_BOOT_X, S3_BOOT_Z, btop + 0.5, y1 + 1, 2.6, 24)
    p = p - Manifold.cylinder(1.0, 1.3, 2.4, 32).rotate([-90, 0, 0]).translate([S3_BOOT_X, y1 - 1.0 + 0.001, S3_BOOT_Z])
    # ribbon hooks: two pairs on the bars between pills; the 20.3 mm ribbon runs flat along the plate at about ZC - 5
    RZ, RW = ZC - 5.0, 20.3
    for hx in panel.P['hooks']:
        for side in (-1, 1):
            zp = RZ + side * (RW / 2 + 1.5)
            p = p + box(hx - 2, hx + 2, y0 - 4.5, y0 + 0.01, zp - 1.0, zp + 1.0)
            lip = Manifold.batch_hull([box(hx - 2, hx + 2, y0 - 4.5, y0 - 1.5, zp - 1.0, zp + 1.0),   # 45-deg underside: prints unsupported
                                       box(hx - 2, hx + 2, y0 - 4.5, y0 - 4.49, zp - side * 3.0 - 0.01, zp - side * 3.0 + 0.01)])
            p = p + lip
    return p, window


FRAME_Y0, FRAME_Y1 = 9.5, Y_FACE               # glued-in screen frame: front 0.5 behind the bottom lip's edge, back = diffuser seat
FRAME_IN, FRAME_CL, FRAME_CH = 1.2, 0.15, 0.5


def screen_frame():
    """Back-down shell only. Thin ring glued inside the opening; its back face stops the diffuser (face at y 12),
    its inner edge is the visible frame around the screen (1.2 mm in from the bore). Prints front face down."""
    outer = rr_cs(BORE_HX - FRAME_CL, BORE_HZ - FRAME_CL, BORE_R - FRAME_CL)
    inner = rr_cs(BORE_HX - FRAME_IN, BORE_HZ - FRAME_IN, BORE_R - FRAME_IN)
    ch = rr_cs(BORE_HX - FRAME_IN + FRAME_CH, BORE_HZ - FRAME_IN + FRAME_CH, BORE_R - FRAME_IN + FRAME_CH)
    f = prism_y(outer, FRAME_Y0, FRAME_Y1) - prism_y(inner, FRAME_Y0 - 1, FRAME_Y1 + 1)
    f = f - Manifold.batch_hull([prism_y(ch, FRAME_Y0 - 1, FRAME_Y0), prism_y(inner, FRAME_Y0 + FRAME_CH, FRAME_Y0 + FRAME_CH + 0.01)])
    return f


def frame_guide():
    """Glue-up stand: a thin rounded-rect tube that stands on the table inside the back-down shell; its top edge
    holds the frame's back face exactly at y = 12, square to the case. Prints as-is, no bridges."""
    o = rr_cs(BORE_HX - 0.4, BORE_HZ - 0.4, BORE_R - 0.4)
    i = rr_cs(BORE_HX - 1.25, BORE_HZ - 1.25, BORE_R - 1.25)
    return prism_y(o, FRAME_Y1, D) - prism_y(i, FRAME_Y1 - 1, D + 1)


def port_bezel():
    """USB-C trim: flange on the end wall covers the cut edge; its plug fills the cut-out opening (keyed by its
    shape); its own opening is the spec-max plug-housing envelope, so any compliant cable reaches the port.
    Frame: case coordinates, installed. Prints flange face down."""
    def rr(w_y, h_z, r):
        return CrossSection.square([w_y - 2 * r, h_z - 2 * r], center=True).offset(r, JT, circular_segments=SEG).translate([PORT_Y, PORT_Z])
    FT, FH, FW, FR, FC = 1.2, 19.5, 13.5, 4.0, 0.45
    x_out = -HW - FT
    flange = Manifold.batch_hull([prism_x(rr(FW - 2 * FC, FH - 2 * FC, FR - FC), x_out, x_out + 0.01),
                                  prism_x(rr(FW, FH, FR), x_out + FC, -HW)])
    plug = prism_x(rr(CUT_W - 0.3, CUT_H - 0.3, CUT_R - 0.15), -HW - 0.01, -HW + WALL - 0.3)
    b = flange + plug
    b = b - prism_x(rr(PORT_W, PORT_H, 1.5), x_out - 1, 0)
    b = b - Manifold.batch_hull([prism_x(rr(PORT_W + 2 * 0.5, PORT_H + 2 * 0.5, 2.0), x_out - 1, x_out), prism_x(rr(PORT_W, PORT_H, 1.5), x_out + 0.5, x_out + 0.51)])
    return b


def boot_key():
    """Ø2-ish rod (a 1.6 mm square turned 45 deg so it prints flat) + T grip; reaches the Boot switch through the plate"""
    reach = (D - BACKL) - (PCB_Y0 + 1.6 + 1.9) + 0.6
    rod = Manifold.cube([reach, 1.6, 1.6]).rotate([45, 0, 0]).translate([0, 0, 1.13])
    grip = Manifold.cube([2.0, 10.0, 2.26]).translate([-2.0, -5.0, 0])
    return rod + grip


def drill_guide():
    """Sits on the case top: a plug keyed into the knob hole (same teardrop as the collar), an arm to the
    sensor spot, and a guide bore for the drill. Frame: knob-hole centre at the origin on the case top, z up."""
    plug = Manifold.extrude(teardrop_cs(ENC_HOLE / 2 - 0.2, 0, 0, seg=SEG), 2.3).translate([0, 0, -2.3])
    sx, sy = SENSOR_X, SENSOR_Y - KY
    arm = Manifold.hull(Manifold.cylinder(2.5, 15.0, 15.0, 96) + Manifold.cylinder(2.5, 7.0, 7.0, 64).translate([sx, sy, 0]))
    boss = Manifold.cylinder(10.0, 6.0, 6.0, 64).translate([sx, sy, 0])
    g = plug + arm + boss
    g = g - Manifold.cylinder(20, (SENSOR_D + 0.15) / 2, (SENSOR_D + 0.15) / 2, 48).translate([sx, sy, -5])
    return g


def to_print(m):
    import trimesh
    me = m.to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.apply_transform(tilt_matrix())
    return t


def export_backdown(out):
    import trimesh
    global BACKDOWN
    BACKDOWN = True
    try:
        down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])      # y = D on the bed
        def put(m, mat, name):
            me = m.to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
            t.apply_transform(mat); t.apply_translation([0, 0, -t.bounds[0][2]]); t.export(f'{out}/{name}')
            print(name, t.is_watertight, np.round(t.extents, 1).tolist())
        put(shell2(), down, 'bar-shell-v4-walnut-backdown.stl')
        up = trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])         # y = FRAME_Y0 (front face) on the bed
        put(screen_frame(), up, 'bar-screen-frame.stl')
        put(frame_guide(), up, 'bar-frame-glue-guide.stl')
        g = drill_guide().mirror([0, 0, 1])
        put(g, np.eye(4), 'bar-sensor-drill-guide-backdown.stl')
    finally:
        BACKDOWN = False


def export_open(out, backdown):
    """Main build (Oct 26): built-in screen rim, the openings printed open (no skins, bezel or glued frame); the cut-out
    skins and glued rim still banded on wood PLA. The light-sensor hole stays optional: a blind Ø2 pocket from inside,
    drilled through from inside only if the sensor is fitted.
    Back-down is the main shell; front-down is kept as an alternate."""
    import trimesh
    global SKINS, SKIN_USB, SENSOR_PRINTED, GLUED_FRAME, BACKDOWN
    saved = SKINS, SKIN_USB, SENSOR_PRINTED, GLUED_FRAME, BACKDOWN
    SKINS, SKIN_USB, SENSOR_PRINTED, GLUED_FRAME, BACKDOWN = False, False, False, False, backdown   # sensor hole: drilled, optional
    try:
        m = shell2()
        if backdown:
            me = m.to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
            t.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))   # y = D on the bed
            name = 'bar-shell-v4-walnut-backdown.stl'
        else:
            t = to_print(m)
            name = 'bar-shell-v4-walnut-frontdown.stl'
        t.apply_translation([0, 0, -t.bounds[0][2]])
        t.export(f'{out}/{name}')
        print(name, t.is_watertight, np.round(t.extents, 1).tolist(), 'vol cm3', round(t.volume / 1000, 1))
    finally:
        SKINS, SKIN_USB, SENSOR_PRINTED, GLUED_FRAME, BACKDOWN = saved


if __name__ == '__main__':
    import os, trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    alt = f'{out}/alternate-frontdown'
    os.makedirs(alt, exist_ok=True)
    export_open(out, backdown=True)
    export_open(alt, backdown=False)
    k = boot_key(); me = k.to_mesh(); tk = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    tk.apply_translation(-tk.bounds[0]); tk.export(f'{out}/bar-boot-key.stl'); print('key', tk.is_watertight, np.round(tk.extents, 1).tolist())
    # drill_guide(), export_backdown() and port_bezel() still make the drill guide, skinned back-down shell, glued frame, glue guide and
    # USB-C bezel (GLUED_FRAME/SKINS = True); they are no longer part of the build set
