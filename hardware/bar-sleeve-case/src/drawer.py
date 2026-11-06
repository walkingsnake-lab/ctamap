"""Drawer (back v4): the flat back plate becomes a rigid tray that slides into the one-piece sleeve from the back.

Why: a flat plate held at the bottom pivots about its screws, so its top swung out and the panel corner without a post
gave when the screen was pushed. A deep tray inside a snug sleeve can't tilt (its walls would have to pass through the
sleeve's), and it stiffens the sleeve from inside along the whole depth.

- Tray: back + four walls (TRAY_WT thick, TRAY_CL inside the sleeve's bore) running forward to the diffuser's flange, so the
  flange is held between the screen rim and the tray's front edge. One pair of screws from below (x +/-46, both panels)
  stops it sliding out.
- The panel sits turned 180 deg in the case (MATRIX_ROTATION 180 in secrets.h): its input header is on the left. The S3 is
  turned 180 deg too, on the right, USB-C low on the right wall, centred between the panel's right-hand posts, so all four
  corner inserts get a bolted post (funnel tubes as plate v3). Boot and the status LED still face the back.
- Top wall: one open slot from the front edge past the knob encoder's body (it hangs from the sleeve's top), only as wide as
  the body. The light sensor rides on the tray, screwed under the top wall below a closed hole lined up with the sleeve's
  light hole (no bracket). Right wall: a slot (open to the front edge) for the USB-C plug and the S3's
  edge buttons.
- Back: two full-width louver bands (intake bottom, exhaust top); Boot hole, status-light hole (plain, 2 mm), ribbon hooks,
  tie loop, two nut bosses for the French cleat (cleat.py). No keyholes.
- Stiffness: the sleeve's walls are 3.5 mm (CASE_WALL; v4 2.5) and the tray's 2.5 (v4 plate skirt 2.0): a thin wall's bending
  stiffness goes with thickness cubed (~2.7x and ~2x). Crush ribs on the tray's outside (CR_H) take out the clearance so the
  two walls brace each other along their length instead of sliding. They're kept gentle for the wood PLA: 0.1 mm into the
  sleeve, with a 3 mm ramp at the leading end.
Shell: the v4 shell with 3.5 mm walls, the USB-C opening mirrored to the right wall, no tongue grooves, latches or detents.
The collar follows the wall (bar-encoder-collar-v5).
Run: python3 drawer.py <outdir>   (PANEL=p25 for the P2.5; FASTEN=insert for heat-set inserts)
"""
import math, os, sys
os.environ.setdefault('CASE_WALL', '3.5')   # thicker sleeve walls (2.5 -> 3.5: ~2.7x stiffer); set before case.py loads
import numpy as np
from manifold3d import Manifold, CrossSection
import case as C
import case2 as V
import plate3 as P3
import panel
from case import box, rr_cs, prism_y, prism_x, cyl_y, cyl_z, ZC, H, D, WALL, HW, BORE_HX, BORE_HZ, BORE_R, JT, ADD, SEG, \
    PANEL_X, PANEL_Z, PANEL_BACK, PCB_Y0, PORT_Y, Y_FACE, BACKL, PLATE_T, KY

# one pair of screws from below on both panels: with the tray boxed in by the sleeve they only stop it sliding out
SCREW_XS_V5 = (46.0,)
for _m in (C, V, P3):
    _m.SCREW_XS = SCREW_XS_V5

TRAY_CL = 0.25                                  # tray outside to the sleeve's bore, a side (tune with the fit coupon)
TRAY_WT = 2.5                                   # 2 -> 2.5: ~2x stiffer; 0.55 mm left past the diffuser skirt top and bottom
# crush ribs on the tray's outside, along the slide direction: they stand CR_H proud of the wall, CR_H - TRAY_CL into the
# sleeve, and shave down as the tray goes in, so the two walls brace each other along their length with no play
CR_H, CR_W, CR_RAMP = 0.45, 1.2, 3.0           # 0.2 into the sleeve (0.35 / 0.1 printed a touch loose, Oct 31; raise CR_H if the coupon wobbles)
FLANGE_BACK = Y_FACE + 1.2                      # diffuser flange's back face (FT 1.2)
YF = FLANGE_BACK                                # tray front edge: on the flange
Y1 = D - BACKL                                  # tray back, outer face (as plate v3: 4 mm inside the rim)
Y0 = Y1 - PLATE_T                               # tray back, inner face

# the panel turned 180 deg: inserts and headers point-mirrored
INSERTS = [(-x, -z) for x, z in panel.P['inserts']]
CORNERS = [max([q for q in INSERTS if q[0] * sx > 0 and q[1] * sz > 0], key=lambda q: (abs(q[0]), abs(q[1]))) for sx in (-1, 1) for sz in (-1, 1)]
HEADERS = [(-x, -z) for x, z in panel.P['headers']]   # [PI IN (left), PO OUT (right)] after the turn
SO_D = P3.SO_OD

# S3, turned 180 deg in its plane: USB edge on the right; board point (bx from the USB edge, by from the edge that is
# now at the bottom) -> case (x, z)
S3_EDGE = BORE_HX - TRAY_CL - TRAY_WT - 0.4     # board edge 0.4 mm inside the tray's right wall
_right = sorted([z for x, z in CORNERS if x > 0])
_z0, _z1 = _right[0] + SO_D / 2 + 0.6, _right[1] - SO_D / 2 - 0.6   # free band between the right-hand posts (rel ZC)
# board as low in the band as S3_LOW allows, so the USB-C plug (near the board's bottom edge) sits well below the case's
# centre; S3_LOW above the band's floor leaves the board ~1.8 mm clear of the lower post (the band already keeps 0.6)
S3_LOW = 1.2
_mid = panel.P.get('drawer_s3_mid', _z0 + S3_LOW + 44.45 / 2)
assert _z0 <= _mid - 44.45 / 2 and _mid + 44.45 / 2 <= _z1, ('S3 outside the band between the right-hand posts', _z0, _z1, _mid)
S3_Z0 = ZC + _mid - 44.45 / 2                   # board's bottom edge
USB_BY = V.S3_USB_BY
PORT_Z = S3_Z0 + USB_BY


def s3(bx, by):
    """Adafruit's board frame (bx from the USB edge, by from the edge nearest the USB-C); turned 180 deg that edge is
    now the bottom one"""
    return S3_EDGE - bx, S3_Z0 + by


S3_HOLES = [s3(bx, by) for bx, by in ((7.62, 15.875), (7.62, 35.56), (48.26, 35.56), (48.26, 15.875))]
S3_NEO = s3(12.192, 41.021)
S3_BOOT = s3(14.58, 28.524)
# edge buttons (Reset, Up, Down) now sit above the USB-C
BTN_Z0, BTN_Z1 = PORT_Z + 8.8, PORT_Z + 35.0
if 'drawer_btn_top' in panel.P:                 # cap the buttons' relief (board frame by): an S3 raised toward the
    BTN_Z1 = min(BTN_Z1, S3_Z0 + panel.P['drawer_btn_top'])   # shell's joint (P4) keeps it below the joint


def configure_shell():
    """the v4 shell for the drawer"""
    V.TONGUES, V.DETENT, V.LATCH = False, False, False
    V.SEAMLESS_RIM = True
    V.USB_SIDE = +1
    V.PORT_Z = PORT_Z
    V.BTN_Z0, V.BTN_Z1 = BTN_Z0, BTN_Z1
    V.SKINS, V.SKIN_USB, V.SENSOR_PRINTED, V.GLUED_FRAME = False, False, True, False   # light-sensor hole printed open (Ø2.1), Nov 2
    V.SENSOR_ROUND = True                          # round, not a teardrop: reads as a pinhole; ream with a 2 mm bit
    V.SCREW_FLOAT = SCREW_FLOAT
    V.CB_SQUARE = panel.KEY.startswith('p25')    # P2.5 builds (single and 128): square counterbores (case2.CB_SQUARE)


# ---- tray ----
LV_H, LV_PITCH, LV_DEPTH, LV_CH = 3.5, 5.0, 5.0, 1.5
LV_ROWS = 3
LV_SPLIT = 6.0                                  # bar across the middle of the top louvers: full-width slots left the band flexible
HOOK_RW = 20.3
TIE_OPEN, TIE_GAP, TIE_BAR, TIE_LEN, TIE_EXIT = 14.0, 3.0, 2.0, 6.0, 3.0   # tie loop: tunnel width, depth, bar, length, end room

# French cleat (cleat.py): the case cleat bolts to the tray's back between the louver bands, 2 x M3 threaded into bosses inside
CLEAT_T = 12.0                                  # cleat depth = tray back to wall (the rim sits CLEAT_T - BACKL off the wall)
CLEAT_ATT = 14.0                                # case cleat's face on the tray (above its bevel)
_hz = BORE_HZ - TRAY_CL - TRAY_WT
CLEAT_ZTOP = ZC + _hz - 2.5 - LV_H - (LV_ROWS - 1) * LV_PITCH - 0.5 - 1.0   # 1 mm under the lowest top louver's opening
CLEAT_ZBOT = ZC - _hz + 2.5 + LV_H + (LV_ROWS - 1) * LV_PITCH - 0.5 + 1.0   # 1 mm over the highest bottom louver's opening
CLEAT_SCREWS = [(sx * 50.0, CLEAT_ZTOP - CLEAT_ATT / 2) for sx in (-1, 1)]
CLEAT_HW = min(75.0, min(S3_BOOT[0] - 2.4, S3_NEO[0] - 1.5) - 3.0)    # half length: clear of the Boot and status holes
# cleat boss: diameter, height. The cleat's M3 x 10s thread into it (FASTEN below) and so can two M3s threaded in a few
# turns to draw the tray out. 4.5 tall: with the 2 mm back an M3 x 10 through the cleat's 4 mm engages ~5.3 mm, tip 0.5 short
CB_D, CB_H = 10.0, 4.5
# status light: a translucent window printed into the back face (bar-drawer-tray-window.stl, the tray's second part on the
# AMS, about 4 layers of swaps), lit through the full light tube; Boot: a 45-deg funnel round its hole that reads as
# "press here" and guides the key
WIN_D, WIN_T = 6.0, 1.0                         # window diameter, depth
BOOT_FUNNEL_D = 7.0                             # funnel diameter at the back face (45 deg down to the 2.6 hole)
BOOT_DOTS = False                               # two dots beside the Boot funnel: dropped Nov 3 (they didn't read as a label)
BOOT_DOT_D, BOOT_DOT_DEPTH = 1.4, 0.4

# light sensor (VEML7700, sensor.py's board frame and position) on the tray: chip side up under the top wall, its STEMMA QT
# sockets (4.25 tall) 0.35 under the channels in the wall; 4 x M2.5 x 5 up through the board into pillars hanging from it
# The pillars are short cantilevers off a wall that prints vertical; at 4.6 long their ridges printed poorly (Oct 30), so
# the sockets now sit in SEN_POCKET-deep channels in the wall (running out past the board's ends for the plugs), the board
# rises by that much and the pillars shrink to 2.9. The chip also ends up closer to the light hole (a wider view).
SEN_POCKET = 1.7                                # channel depth into the 2.5 mm top wall (0.8 left)
SEN_PLUG = 8.0                                  # channel run past each socket, outward, for the plug
SEN_GAP = 4.6 - SEN_POCKET
SEN_TOP = H - WALL - TRAY_CL - TRAY_WT - SEN_GAP     # board's top (chip side)
SEN_HOLE = round(V.GRILLE_SPAN + 1.8, 2)        # hole in the tray's top wall over the chip: clears the sleeve's drilled grille
                                                # (case2.GRILLE_SPAN: 5 holes, 1/16" bit, Ø6.47) with ~0.9 a side -> 8.27
ENC_HALF = 11.8 / 2 * math.sqrt(2)              # encoder body (11.8 square, turned 45 deg): half diagonal
ENC_SLOT = ENC_HALF + 1.0                       # top-wall slot half width
ENC_X = 0.0                                     # encoder (knob) x in the tray's frame: the slot, the rails and the
                                                # crush ribs kept off the slot follow it (bar128.py puts it near tray A's end)

# Screws into the tray (Nov 3): no nuts. The bottom M3 x 10s (from below) and the cleat's M3 x 10s (from the wall side)
# thread straight into pilots in solid PETG bosses. FASTEN 'tap' (default). 'insert': holes for M3 heat-set inserts
# instead (INSERT_D x INSERT_L, pressed in from the side the screw comes from), for when there's an iron: set it,
# regenerate and reprint the tray; nothing else changes. (The nut slot and #485's hex seat are in DESIGN-HISTORY.)
FASTEN = os.environ.get('FASTEN', 'tap')
TAP_D = 3.0                                     # bottom pilots, horizontal in the print: the fit set's best (#3 of 2.6 / 2.8 / 3.0, Nov 3)
TAP_D_V = 3.1                                   # cleat pilots, vertical in the print: 3.0 too tight to drive an M3, 3.2 / 3.3 / 3.4
                                                # too loose (Nov 3, two rounds): 3.1, with a deeper lead-in (the first layers on
                                                # the bed print tightest, and the screw enters there); test-plate-v5c checks 3.05-3.15
TAP_LEAD_V = 0.6
TAP_LEAD = 0.4                                  # 45 deg lead-in where the screw enters
INSERT_D, INSERT_L = 4.0, 6.0                   # M3 heat-set insert, 4.6-5.0 OD x 5.7 long class
SCREW_FLOAT = 0.4                               # the tray's +/- y float, in the shell's stadium holes (0.6 left the head no bearing)
BOSS_TOP = WALL + 9.0                           # bottom boss top (12.5 at the 3.5 wall): the pilot stops 0.8 under it, 0.7 past an M3 x 10's tip

# Posts (Nov 3): the tray's front edge meets the diffuser flange at the same moment the post feet meet the panel. If the
# posts print short, the four screws pull the panel back off the diffuser grid (soft pixels); if long, the tray edge just
# stands off the flange (harmless: the tray floats in y). POST_LONG puts the error on the harmless side.
POST_LONG = 0.3
P3.FOOT_Y = PANEL_BACK - POST_LONG
# seated, the tray then sits POST_LONG further back than in the model (its edge off the flange): the bottom bosses move
# forward by as much, so their screws land in the middle of the shell's stadium holes
BOT_Y = C.SCREW_Y - POST_LONG

# Post screws (Nov 3): the countersunk heads centred themselves in a 90 deg cone, so the four screws had no float at all,
# while the panel can sit ~0.45 off centre in the bore and the PETG tray shrinks (~0.2-0.5 %, so ~0.2-0.4 at each corner):
# with two parts located separately and four screws pulling them together, "close but not quite" was the result. Now:
# M3 x 8 flanged button heads (ISO 7380-2, flange ~6.9) on a flat floor with a POST_HOLE hole: +/-0.7 mm of float, the
# flange acting as the washer. A plain button head over an M3 washer dropped down the tube first works the same.
# The S3's place between the right-hand posts stays where the 9 mm posts put it (SO_D above), so the shell is unchanged.
POST_OD, POST_BORE, POST_HOLE = 11.0, 8.6, 4.5   # hole: +/-0.7 for an M3 with room for print facets; bore: a 6.9 flange 0.7 off centre, +0.15 a side
P3.SO_OD, P3.SO_BORE, P3.SO_HOLE = POST_OD, POST_BORE, POST_HOLE
P3.so_cone = lambda x, zc: Manifold()            # flat floor: no countersink cone
# The floor prints as a bridge over the tube (back-down), and a bridge with a round hole in it sagged into strands round the
# hole (test plate, Nov 3). Sequential bridging: its first layer (the screw's seat) is cut as a slot the hole's width,
# running across the whole tube, so every strand spans wall to wall; the second layer as a square the hole's size,
# bridging the other way over the first; the round hole starts above. BRIDGE_LH is the tray's layer height.
BRIDGE_LH = 0.24


def floor_bridge_cuts(x, zc):
    ys = P3.FOOT_Y + P3.SO_FLOOR                        # the floor's tube-side face (the screw's seat; its bottom in print)
    h = POST_HOLE / 2
    bore = cyl_y(x, zc, ys - 2 * BRIDGE_LH - 0.01, ys + 0.01, POST_BORE, 48)
    slot = box(x - h, x + h, ys - BRIDGE_LH, ys + 0.01, zc - POST_BORE, zc + POST_BORE) ^ bore
    sq = box(x - h, x + h, ys - 2 * BRIDGE_LH, ys - BRIDGE_LH + 0.01, zc - h, zc + h)
    return slot + sq


_standoff0 = P3.standoff
P3.standoff = lambda x, z, y0: _standoff0(x, z, y0) - floor_bridge_cuts(x, ZC + z)

# Encoder rails (Nov 3): the encoder's pocket in the collar is round and nothing keys its body, so a loosened nut let the
# body turn until its board's corner reached the panel (~4.9 deg). Two rails hang from the tray's top wall beside the
# board's side edges (it's a 25.4 square) and stop it at ~3.5 deg, on the tray. Square the board by eye when tightening.
RAIL_CL, RAIL_W = 0.45, 1.6                     # gap to the board's edge a side (0.7 had a little too much play, Nov 3); rail thickness
RAIL_LAP = 0.75                                 # how far the rails reach down past the board's top face (of its 1.57): they stop
                                                # 0.8 over its underside, clear of the QT plugs leaving under the board

# Light sensor (Nov 3): SENSOR_MOUNT 'sled'. The four pillars needed a driver aimed up at the top wall from 27-40 mm
# inside the tray's open front. Now the sensor screws chip up onto a flat sled on the bench (2-4 x M2.5 x 5 down from the
# chip side, straight driver); the sled's two back tabs swing into two hooks on the top louver band's face, then one
# M2.5 x 6 from OUTSIDE the tray's top wall (counterbored, under the sleeve) pulls the sled's front boss up to the wall.
# The board sits where it did (SEN_TOP), its sockets in the same channels. 'pillars' = the v5 mount.
SENSOR_MOUNT = os.environ.get('SENSOR_MOUNT', 'sled')
SLED_T = 2.0                                    # sled plate under the board
_DY = Y_FACE - 12.0                             # a deeper hood (P4: 16 mm) moves everything behind the face back by this
SLED_X_M, SLED_Y0 = 0.5, 31.0 + _DY             # margin past the board's ends; sled front edge (y)
SLED_TAB_W, SLED_GRIP = 4.4, 2.0                # back tabs: width, depth into the hooks
SLED_CL = 0.25                                  # tab clearance in the hook's slot (top and bottom; 0.2 a side in x)
HOOK_FLARE = 0.8                                # 45 deg flare at the slot's mouth
HOOK_WALL, HOOK_FRONT, HOOK_LIP = 1.2, 57.0 + _DY, 1.25   # hook cheeks either side of the slot, hook front face (y), lip under the tab
LV_BLIND = 1.5                                  # louver slots behind the hooks end this far behind the band's inner face (1 mm past the hook)
SLED_SCREW = (48.0, 34.5 + _DY)                 # front screw: 3.6 mm of web to the light hole, 10 mm from the nearest crush rib
SLED_BOSS_D, SLED_PILOT = 6.0, 2.4
SLED_CB_D, SLED_CB_DEPTH, SLED_CLEAR = 5.0, 1.8, 2.8   # counterbore in the tray's top (button head 4.4-4.7 x 1.4-1.6), 0.7 wall left


def tray(top_bar=None, bottom_gap=0.0, ribbon_hooks=None, hook_lip=1.5, tie_x0=None, extra_cuts=(), blank=False, post_dy=None,
         s3=None, controls=None):
    """the v5 tray. The split options are for trays split in two (p4.py), and their defaults give the one-piece tray:
    top_bar: half width of the solid bar across the middle of the top louver rows (LV_SPLIT / 2);
    bottom_gap: half width of a gap in the bottom louver rows at the middle (0: none);
    ribbon_hooks: [(x, z)] of the ribbon hook pairs (default: one pair between the S3's connector and the panel input);
    hook_lip: the hooks' lip thickness (their reach is 4 mm: 4.0 makes the lip's underside 45 deg back-down);
    tie_x0: left end of the tie loop's patch (default: just right of the first hook pair); extra_cuts: more cuts.
    blank: no S3, light tube, Boot, encoder slot and rails, light sensor or USB-C window. Or separately: s3=False drops
    the S3 and what goes with it (pad, posts, light tube and window, Boot, USB-C window); controls=False drops the encoder
    slot and rails and the light sensor (bar128.py: tray B keeps the S3, tray A takes the controls at ENC_X / the
    sensor's x). post_dy: {(x, z): dy} moves those posts' feet back by dy (bar128.py: the inner posts stand on its
    splice plates)."""
    post_dy = post_dy or {}
    s3 = (not blank) if s3 is None else s3
    controls = (not blank) if controls is None else controls
    outer = rr_cs(BORE_HX - TRAY_CL, BORE_HZ - TRAY_CL, BORE_R - TRAY_CL)
    inner = rr_cs(BORE_HX - TRAY_CL - TRAY_WT, BORE_HZ - TRAY_CL - TRAY_WT, BORE_R - TRAY_CL - TRAY_WT)
    t = prism_y(outer, Y0, Y1) + (prism_y(outer, YF, Y0 + 0.01) - prism_y(inner, YF - 1, Y0 + 0.02))
    inner_ov = rr_cs(BORE_HX - TRAY_CL - TRAY_WT + 0.3, BORE_HZ - TRAY_CL - TRAY_WT + 0.3, BORE_R - TRAY_CL - TRAY_WT + 0.3)
    hz = BORE_HZ - TRAY_CL - TRAY_WT                       # inner half height
    zin0, zin1 = ZC - hz, ZC + hz
    xin = BORE_HX - TRAY_CL - TRAY_WT

    def rrect_y(x0, x1, z0, z1, r, ya, yb):
        cs = CrossSection.square([x1 - x0 - 2 * r, z1 - z0 - 2 * r], center=True).offset(r, JT, circular_segments=24).translate([(x0 + x1) / 2, (z0 + z1) / 2])
        return prism_y(cs, ya, yb)

    def rrect_z(x0, x1, ya, yb, r, z0, z1):
        cs = CrossSection.square([x1 - x0 - 2 * r, yb - ya - 2 * r], center=True).offset(r, JT, circular_segments=24).translate([(x0 + x1) / 2, (ya + yb) / 2])
        return Manifold.extrude(cs, z1 - z0).translate([0, 0, z0])

    # louver bands (as plate v3, full width between the corner posts)
    y_in = Y1 - LV_DEPTH
    x_lim = min(abs(x) for x, z in CORNERS) - SO_D / 2 - 2.0

    def band(zb0, zb1):
        pts = [(Y0 + 0.01, zb0), (y_in + LV_CH, zb0), (y_in, zb0 + LV_CH), (y_in, zb1 - LV_CH), (y_in + LV_CH, zb1), (Y0 + 0.01, zb1)]
        cs = CrossSection([pts])
        if cs.area() <= 0:
            cs = CrossSection([pts[::-1]])
        return prism_x(cs, -xin - 0.5, xin + 0.5) ^ prism_y(inner_ov, y_in - 1, Y0 + 1)   # overlaps the walls: no touching seams
    zb_rows = [zin0 + 2.5 + LV_H / 2 + i * LV_PITCH for i in range(LV_ROWS)]
    zt_rows = [zin1 - 2.5 - LV_H / 2 - i * LV_PITCH for i in range(LV_ROWS)][::-1]
    t = t + band(zin0 - 0.5, zb_rows[-1] + LV_H / 2 + LV_DEPTH + 1.5) + band(zt_rows[0] - LV_H / 2 - 1.5, zin1 + 0.5)   # into the walls
    # bottom screw bosses (plate v3's, now standing on the tray's bottom wall)
    t = t + bottom_bosses(zin0)
    # panel posts at the four corner inserts
    for x, z in CORNERS:
        with _foot(post_dy.get((x, z), 0.0)):
            t = t + P3.standoff(x, z, Y0)
    # S3: pad and posts, status-light tube, Boot tube
    yc = PCB_Y0 + 1.6
    hxs = [h[0] for h in S3_HOLES]; hzs = [h[1] for h in S3_HOLES]
    tube_end = yc + 1.5
    btop = yc + 1.9
    import sensor as SN
    if s3:
        t = t + rrect_y(min(hxs) - 3.7, max(hxs) + 3.7, min(hzs) - 3.7, max(hzs) + 3.7, 3.7, Y0 - 3.0, Y0 + 0.01)
        for hx, hz_ in S3_HOLES:
            t = t + cyl_y(hx, hz_, yc, Y0 + 0.01, P3.S3_POST_D, 32)
        t = t + cyl_y(*_xz(S3_NEO), tube_end, Y0 + 0.01, 7.0, 48)
        t = t + cyl_y(*_xz(S3_BOOT), btop + 1.0, Y0 + 0.01, 5.0, 32)
    if controls:
        # light sensor mount (pillars or sled hooks)
        t = t + sensor_mount()
        t = t + enc_rails()
    # cleat nut bosses
    for cx, cz in CLEAT_SCREWS:
        t = t + cyl_y(cx, cz, Y0 - CB_H, Y0 + 0.01, CB_D, 48)
    # ribbon hooks: one pair on the ribbon's run from the S3's connector to the panel input (left)
    idc_x = S3_EDGE - 57.0
    pi_x = min(h[0] for h in HEADERS)
    RZ = ZC + min(HEADERS, key=lambda h: h[0])[1]
    hooks = ribbon_hooks if ribbon_hooks is not None else [(round((idc_x + pi_x) / 2, 1), RZ)]
    for hx, hz_r in hooks:
        for side in (-1, 1):
            zi = hz_r + side * (HOOK_RW / 2 + 1.0); zo = zi + side * 3.0
            ya, yb = Y0 - 3.0 - hook_lip, Y0 - 3.0
            t = t + box(hx - 2.5, hx + 2.5, ya, Y0 + 0.01, min(zi, zo), max(zi, zo))
            tip = zi - side * 4.0
            t = t + Manifold.batch_hull([box(hx - 2.5, hx + 2.5, ya, yb, min(zi, zo), max(zi, zo)), box(hx - 2.5, hx + 2.5, ya, ya + 0.01, tip - 0.005, tip + 0.005)])
    # tie loop for the power-cable bundle (12 mm hook-and-loop strap): a bar over a tunnel running up and down the back wall,
    # in the clear patch above the ribbon, between the ribbon hook and the S3's connector, below the top louver band, with
    # TIE_EXIT free at each end so the strap can turn out over the bundle
    tx0, tx1 = (hooks[0][0] + 2.5 + 1.0 if tie_x0 is None else tie_x0), S3_EDGE - 63.8 - 1.0
    tx = (tx0 + tx1) / 2
    band_lo = zt_rows[0] - LV_H / 2 - 1.5
    tz = (RZ + HOOK_RW / 2 + band_lo) / 2
    assert band_lo - (RZ + HOOK_RW / 2) >= TIE_LEN + 2 * TIE_EXIT and tx1 - tx0 >= TIE_OPEN + 4, 'no room for the tie loop'
    t = t + rrect_z(tx - TIE_OPEN / 2 - 2.0, tx + TIE_OPEN / 2 + 2.0, Y0 - TIE_GAP - TIE_BAR, Y0 + 0.01, 0.9, tz - TIE_LEN / 2, tz + TIE_LEN / 2)
    # ---- cuts
    cuts = []
    r = LV_H / 2
    pad = (min(hxs) - 3.7 - 1.0, max(hxs) + 3.7 + 1.0)

    def minus(pieces, g0, g1):
        out = []
        for c, d in pieces:
            if d <= g0 or c >= g1:
                out.append((c, d))
                continue
            if g0 - c > 2 * r + 4: out.append((c, g0))
            if d - g1 > 2 * r + 4: out.append((g1, d))
        return out
    for zc in zb_rows + zt_rows:
        segs = [(-x_lim, x_lim)]
        lo, hi = zc - r - 0.5, zc + LV_DEPTH + r + 0.5                      # the slot rises LV_DEPTH going inward
        if s3 and any(lo < hz_ + P3.S3_POST_D / 2 + 3.7 and hi > hz_ - P3.S3_POST_D / 2 - 3.7 for hz_ in hzs):
            segs = minus(segs, *pad)
        if zc > ZC:                                                          # top rows: a bar in the middle
            tb = LV_SPLIT / 2 if top_bar is None else top_bar
            segs = minus(segs, -tb, tb)
        if zc < ZC:                                                          # bottom rows: gaps at the screw bosses
            if bottom_gap:
                segs = minus(segs, -bottom_gap, bottom_gap)
            for scx in C.SCREW_XS:
                segs = minus(minus(segs, -scx - 6.5, -scx + 6.5), scx - 6.5, scx + 6.5)
        for xa, xb in segs:
            def slab(y, dz, xa=xa, xb=xb, zc=zc):
                cs = CrossSection.square([xb - xa - 2 * r, 0.01], center=True).offset(r, JT, circular_segments=16).translate([(xa + xb) / 2, zc + dz])
                return prism_y(cs, y, y + 0.01)
            sl = Manifold.batch_hull([slab(Y1 + 0.5, -0.5), slab(y_in - 0.5, LV_DEPTH + 0.5)])
            # the top row's slot rises into the top wall near its inner end: stop it 0.6 under the wall (a slot roof
            # grazing the wall's face left a zero-thickness sheet, non-manifold in the STL)
            sl = sl ^ box(-HW, HW, Y0 - 20, D + 5, -5, zin1 - 0.6)
            if zc > ZC and controls:                                         # blind behind the sensor sled's hooks
                for g0, g1 in louver_gaps(zc, r):
                    sl = sl - box(g0, g1, Y0 - 20, y_in + LV_BLIND, -5, H + 5)
            cuts.append(sl)
    # bottom screw holes and nut pockets
    cuts += bottom_nut_cuts()
    for x, z in CORNERS:
        with _foot(post_dy.get((x, z), 0.0)):
            cuts.append(cyl_y(x, ZC + z, P3.FOOT_Y + P3.SO_FLOOR, Y1 + 1, P3.SO_BORE, 48))
            cuts.append(P3.so_cone(x, ZC + z))
    cuts.append(box(tx - TIE_OPEN / 2, tx + TIE_OPEN / 2, Y0 - TIE_GAP, Y0 + 0.02, tz - TIE_LEN, tz + TIE_LEN))   # tie tunnel
    cuts += cleat_cuts()                                                            # cleat screws: pilots (or insert holes)
    if blank:
        t = t - Manifold.batch_boolean(cuts, ADD)
        t = t + crush_ribs()
        return max(t.decompose(), key=lambda m: m.volume())
    if s3:
        nx, nz = _xz(S3_NEO)
        cuts.append(cyl_y(nx, nz, tube_end - 1, Y1 - WIN_T + 0.01, 4.5, 48))     # light tube straight through to the window
        cuts.append(cyl_y(nx, nz, Y1 - WIN_T, Y1 + 1, WIN_D, 48))                  # window pocket (flat roof: a 0.75 mm ring)
        for hx, hz_ in S3_HOLES:
            cuts.append(cyl_y(hx, hz_, yc - 1, yc + 8.0, P3.S3_PILOT, 24))
            cuts.append(Manifold.cylinder(P3.S3_LEAD + 0.01, P3.S3_PILOT / 2 + P3.S3_LEAD, P3.S3_PILOT / 2, 24).rotate([-90, 0, 0]).translate([hx, yc - 0.01, hz_]))
        bx, bz = _xz(S3_BOOT)
        cuts.append(cyl_y(bx, bz, btop + 0.5, Y1 + 1, 2.6, 24))
        fd = (BOOT_FUNNEL_D - 2.6) / 2                                              # 45 deg: as deep as it is wide
        cuts.append(Manifold.cylinder(fd + 0.01, 1.3, BOOT_FUNNEL_D / 2 + 0.01, 48).rotate([-90, 0, 0]).translate([bx, Y1 - fd, bz]))
        for dz in ((-1.5, 1.5) if BOOT_DOTS else ()):
            cuts.append(cyl_y(bx + BOOT_FUNNEL_D / 2 + 2.2, bz + dz, Y1 - BOOT_DOT_DEPTH, Y1 + 1, BOOT_DOT_D, 24))
    if controls:
        # top wall: slot open to the front edge past the encoder body; light hole and sensor pilots
        ztw = H - WALL - TRAY_CL - TRAY_WT - 1.0
        cuts.append(box(ENC_X - ENC_SLOT, ENC_X + ENC_SLOT, YF - 1, KY + ENC_HALF + 1.5, ztw, H))
        cuts.append(cyl_z(SN.SX, SN.SY, ztw, H, SEN_HOLE, 32))
        cuts += sensor_cuts()
    if s3:
        # right wall: window for the USB-C plug and the edge buttons
        # open to the front edge: printed back-down, a closed window's front edge would be a ~45 mm bridge
        cuts.append(box(xin - 1, BORE_HX + 1, YF - 1, PORT_Y + 5.0, PORT_Z - 7.5, BTN_Z1 + 1.0))
    cuts += list(extra_cuts)
    t = t - Manifold.batch_boolean(cuts, ADD)
    t = t + crush_ribs()
    return max(t.decompose(), key=lambda m: m.volume())


class _foot:
    """with _foot(dy): P3.FOOT_Y moved back by dy for the posts built inside the block"""
    def __init__(self, dy):
        self.dy = dy

    def __enter__(self):
        P3.FOOT_Y += self.dy

    def __exit__(self, *a):
        P3.FOOT_Y -= self.dy


# ---- tray parts kept apart (other trays, e.g. the P4's split one, reuse them)
def _rrect_z(x0, x1, ya, yb, r, z0, z1):
    cs = CrossSection.square([x1 - x0 - 2 * r, yb - ya - 2 * r], center=True).offset(r, JT, circular_segments=24).translate([(x0 + x1) / 2, (ya + yb) / 2])
    return Manifold.extrude(cs, z1 - z0).translate([0, 0, z0])


def bottom_xs():
    return [sx * scx for sx in (-1, 1) for scx in C.SCREW_XS]


def bottom_bosses(zin0):
    """screw bosses on the tray's bottom wall, one per screw from below: solid, 10 wide, 5 mm in front of the screw"""
    return Manifold.batch_boolean([_rrect_z(x - 5, x + 5, BOT_Y - 5.0, Y0 + 0.01, 2.0, zin0 - 0.01, BOSS_TOP)
                                   for x in bottom_xs()], ADD)


def tray_floor_z():
    """the tray's outer bottom face (it rests on the shell's floor, TRAY_CL above it)"""
    return ZC - (BORE_HZ - TRAY_CL)


def bottom_nut_cuts():
    """'tap': a blind TAP_D pilot up through the floor into the boss, 45 deg lead-in at the floor's outer face.
    'insert': an INSERT_D x INSERT_L hole from below for a heat-set insert, M3 clearance on past it"""
    cuts = []
    z0 = tray_floor_z()
    for x in bottom_xs():
        if FASTEN == 'insert':
            cuts.append(cyl_z(x, BOT_Y, z0 - 1, z0 + INSERT_L, INSERT_D, 32))
            cuts.append(cyl_z(x, BOT_Y, z0 - 1, BOSS_TOP - 0.8, 3.4, 24))
            continue
        cuts.append(cyl_z(x, BOT_Y, z0 - 1, BOSS_TOP - 0.8, TAP_D, 24))
        cuts.append(Manifold.cylinder(TAP_LEAD + 0.01, TAP_D / 2 + TAP_LEAD + 0.01, TAP_D / 2, 24).translate([x, BOT_Y, z0 - 0.01]))
    return cuts


def cleat_cuts():
    """the cleat's screws come in from the wall side (the back face): 'tap': a TAP_D_V pilot through the back and the boss,
    lead-in at the back face; 'insert': an INSERT_D x INSERT_L hole from the back face, M3 clearance past it"""
    cuts = []
    for cx, cz in CLEAT_SCREWS:
        if FASTEN == 'insert':
            cuts.append(cyl_y(cx, cz, Y1 - INSERT_L, Y1 + 1, INSERT_D, 32))
            cuts.append(cyl_y(cx, cz, Y0 - CB_H - 1, Y1, 3.4, 24))
            continue
        cuts.append(cyl_y(cx, cz, Y0 - CB_H - 1, Y1 + 1, TAP_D_V, 24))
        cuts.append(Manifold.cylinder(TAP_LEAD_V + 0.01, TAP_D_V / 2, TAP_D_V / 2 + TAP_LEAD_V + 0.01, 24).rotate([-90, 0, 0])
                    .translate([cx, Y1 - TAP_LEAD_V, cz]))
    return cuts


def enc_board():
    """the encoder board's extent: x half width, y range, z range"""
    import sensor as SN
    return 12.7, (KY - 12.7, KY + 12.7), (SN.EB_BOT, SN.EB_TOP)


def rail_xs():
    hw = enc_board()[0]
    return [(ENC_X + sx * (hw + RAIL_CL), ENC_X + sx * (hw + RAIL_CL + RAIL_W)) for sx in (-1, 1)]


def enc_rails():
    """two rails from the top wall down to RAIL_LAP past the board's top face, beside its side edges, from 1 mm behind the
    board's front edge (clear of the panel) back to the top louver band, merged into it (nothing overhangs back-down).
    Their front ends are cut back 45 deg on the inside so a slightly turned board is guided straight as the tray slides in."""
    hw, (by0, by1), (bz0, bz1) = enc_board()
    zw, y_in = _zw(), Y1 - LV_DEPTH
    out = []
    for xa, xb in rail_xs():
        r = box(min(xa, xb), max(xa, xb), by0 + 1.0, y_in + 0.5, bz1 - RAIL_LAP, zw + 0.01)
        sgn = 1 if xb > xa else -1                    # from the face toward the board (xa) into the rail
        y0 = by0 + 1.0
        pts = [(xa - sgn * 0.2, y0 - 0.1), (xa + sgn * 1.0, y0 - 0.1), (xa - sgn * 0.2, y0 + 1.2)]
        tri = CrossSection([pts]) if CrossSection([pts]).area() > 0 else CrossSection([pts[::-1]])
        lead = Manifold.extrude(tri, zw - bz0 + 2).translate([0, 0, bz0 - 1])
        out.append(r - lead)
    return Manifold.batch_boolean(out, ADD)


def status_window():
    """the translucent window filling the back face's pocket over the S3's status LED (print it as the tray's second part)"""
    nx, nz = _xz(S3_NEO)
    return cyl_y(nx, nz, Y1 - WIN_T, Y1, WIN_D, 48)


def _zw():
    return H - WALL - TRAY_CL - TRAY_WT                        # top wall's inner face


def sled_z():
    """sled plate bottom and top (the top is the board's underside)"""
    top = SEN_TOP - 1.6
    return top - SLED_T, top


def hook_xs():
    import sensor as SN
    return [SN.SX - 9.5, SN.SX + 9.5]                  # far enough apart that the louver piece between their gaps stays


def hook_half():
    return SLED_TAB_W / 2 + 0.2 + HOOK_WALL


def hook_bottom():
    return sled_z()[0] - SLED_CL - HOOK_LIP


def louver_gaps(zc, r):
    """x ranges of a top louver row (centre zc, slot half height r) behind the sensor hooks: there the slot stops
    LV_BLIND short of the band's inner face (blind), so the hook's root stays whole and the back face looks as before"""
    lo, hi = zc + LV_DEPTH + 0.5 - r, zc + LV_DEPTH + 0.5 + r          # the slot's inner end, where the hooks are
    out = []
    if SENSOR_MOUNT == 'sled' and not (hi < hook_bottom() or lo > _zw()):
        out += [(hx - hook_half() - 0.6, hx + hook_half() + 0.6) for hx in hook_xs()]
    if not (hi < enc_board()[2][1] - RAIL_LAP or lo > _zw()):          # and the encoder rails
        out += [(min(xa, xb) - 0.6, max(xa, xb) + 0.6) for xa, xb in rail_xs()]
    return out


def sled_hooks():
    """two hooks on the top louver band's front face: a block from the top wall down past the tab, merged into the band
    (y_in) so every face that points at the bed when printed back-down sits on the band; a slot open to the front holds
    the sled's tab (SLED_GRIP deep, SLED_CL over and under it, cheeks either side locate it in x)"""
    zw, y_in = _zw(), Y1 - LV_DEPTH
    zs0, zs1 = sled_z()
    out = []
    for hx in hook_xs():
        hw = hook_half()
        blk = box(hx - hw, hx + hw, HOOK_FRONT, y_in + 0.5, hook_bottom(), zw + 0.01)
        slot = box(hx - SLED_TAB_W / 2 - 0.2, hx + SLED_TAB_W / 2 + 0.2, HOOK_FRONT - 1, HOOK_FRONT + SLED_GRIP + 0.3,
                   zs0 - SLED_CL, zs1 + SLED_CL)
        # mouth flared 45 deg top and bottom (HOOK_FLARE): the tilted tab enters, and the sled can swing ~20 deg
        f = HOOK_FLARE
        flare = Manifold.batch_hull([box(hx - SLED_TAB_W / 2 - 0.2, hx + SLED_TAB_W / 2 + 0.2, HOOK_FRONT - 0.01, HOOK_FRONT,
                                         zs0 - SLED_CL - f, zs1 + SLED_CL + f),
                                     box(hx - SLED_TAB_W / 2 - 0.2, hx + SLED_TAB_W / 2 + 0.2, HOOK_FRONT + f, HOOK_FRONT + f + 0.01,
                                         zs0 - SLED_CL, zs1 + SLED_CL)])
        out.append(blk - slot - flare)
    return Manifold.batch_boolean(out, ADD)


def sled():
    """the sensor's sled, in place (case frame). Prints plate down, boss up."""
    import sensor as SN
    zs0, zs1 = sled_z()
    zw = _zw()
    body = box(SN.SB_X0 - SLED_X_M, SN.SB_X1 + SLED_X_M, SLED_Y0, SN.SB_Y1 + 0.8, zs0, zs1)
    tabs = [box(hx - SLED_TAB_W / 2, hx + SLED_TAB_W / 2, SN.SB_Y1 + 0.5, HOOK_FRONT + SLED_GRIP, zs0, zs1) for hx in hook_xs()]
    sx, sy = SLED_SCREW
    boss = cyl_z(sx, sy, zs1 - 0.01, zw - 0.1, SLED_BOSS_D, 40)
    s = Manifold.batch_boolean([body, boss] + tabs, ADD)
    holes = [cyl_z(x, y, zs0 - 1, zs1 + 1, P3.S3_PILOT, 24) for x, y in SN.SH]                   # board screws, self-tapping
    holes += [Manifold.cylinder(0.31, P3.S3_PILOT / 2, P3.S3_PILOT / 2 + 0.3, 24).translate([x, y, zs1 - 0.3]) for x, y in SN.SH]
    holes.append(cyl_z(sx, sy, zs0 - 1, zw + 1, SLED_PILOT, 24))                                 # front screw from outside
    holes.append(Manifold.cylinder(0.41, SLED_PILOT / 2, SLED_PILOT / 2 + 0.4, 24).translate([sx, sy, zw - 0.1 - 0.4]))
    s = s - Manifold.batch_boolean(holes, ADD)
    # tab tips: 0.6 x 45 deg off both edges, so they find the hook's slot while the sled is still tilted
    tip = HOOK_FRONT + SLED_GRIP
    for zc, sgn in ((zs1, 1), (zs0, -1)):
        tri = CrossSection([[(tip + 0.01, zc + sgn * 0.01), (tip - 0.6, zc + sgn * 0.01), (tip + 0.01, zc - sgn * 0.61)]])
        if tri.area() < 0 or tri.area() == 0:
            tri = CrossSection([[(tip + 0.01, zc + sgn * 0.01), (tip + 0.01, zc - sgn * 0.61), (tip - 0.6, zc + sgn * 0.01)]])
        s = s - prism_x(tri, SN.SB_X0 - 5, SN.SB_X1 + 5)
    return s


def sensor_mount():
    """SENSOR_MOUNT 'sled': the hooks (the sled is a separate part). 'pillars': light-sensor pillars, 5 mm wide, pointed
    (45 deg) on the back side, so printed back face down their underside is a roof, not a flat overhang (a gusset there
    would hit the board's STEMMA QT sockets)"""
    import sensor as SN
    if SENSOR_MOUNT == 'sled':
        return sled_hooks()
    zw = H - WALL - TRAY_CL - TRAY_WT
    out = []
    for x, y in SN.SH:
        prof = CrossSection([[(x - 2.5, y - 2.5), (x + 2.5, y - 2.5), (x + 2.5, y), (x, y + 2.5), (x - 2.5, y)]])
        out.append(Manifold.extrude(prof, zw + 0.01 - SEN_TOP).translate([0, 0, SEN_TOP]))
    return Manifold.batch_boolean(out, ADD)


def sensor_cuts():
    """pilots in the pillars and the STEMMA QT socket channels in the top wall"""
    import sensor as SN
    cuts = []
    if SENSOR_MOUNT == 'sled':                  # front screw: counterbore in the tray's outer top, clearance through
        sx, sy = SLED_SCREW
        zo = _zw() + TRAY_WT
        cuts.append(cyl_z(sx, sy, zo - SLED_CB_DEPTH, zo + 1, SLED_CB_D, 40))
        cuts.append(cyl_z(sx, sy, _zw() - 1, zo, SLED_CLEAR, 24))
    else:
        for x, y in SN.SH:
            cuts.append(cyl_z(x, y, SEN_TOP - 1, SEN_TOP + SEN_GAP + 1.6, 2.4, 24))   # M2.5 x 5 (x 6 reaches 0.1 short of the end)
    zw = H - WALL - TRAY_CL - TRAY_WT
    (_, sy0), (_, sy1) = SN.sb(0, 11.8), SN.sb(0, 6)
    for (bx0, bx1), out in (((0.5, 4.8), -1), ((20.6, 24.9), 1)):           # socket channels, open toward each board end
        xa, xb = SN.sb(bx0, 0)[0], SN.sb(bx1, 0)[0]
        xa, xb = (xa - SEN_PLUG, xb + 0.5) if out < 0 else (xa - 0.5, xb + SEN_PLUG)
        cuts.append(box(xa, xb, sy0 - 0.5, sy1 + 0.5, zw - 1, zw + SEN_POCKET))
    return cuts


def crush_ribs():
    """triangular ribs on the tray's outside, running front to back, clear of the wall slots"""
    import sensor as SN
    ox, oz = BORE_HX - TRAY_CL, BORE_HZ - TRAY_CL                # tray outside half sizes
    y_a, y_b = YF + 4.0, Y0 - 1.0
    ribs = []

    def rib(c0, c1, axis, sign):
        # triangle in the (x, z) plane at the wall: base CR_W along the wall, apex CR_H out; ramps up over CR_RAMP at the
        # leading (front) end so it eases into the sleeve
        def tri(h):
            if axis == 'z':                                      # on the top (+1) / bottom (-1) wall, at x = c0
                z = ZC + sign * oz
                pts = [(c0 - CR_W / 2, z - sign * 0.3), (c0 + CR_W / 2, z - sign * 0.3), (c0, z + sign * h)]
            else:                                                # on the right (+1) / left (-1) wall, at z = c0
                x = sign * ox
                pts = [(x - sign * 0.3, c0 - CR_W / 2), (x - sign * 0.3, c0 + CR_W / 2), (x + sign * h, c0)]
            cs = CrossSection([pts])
            return cs if cs.area() > 0 else CrossSection([pts[::-1]])
        ramp = Manifold.batch_hull([prism_y(tri(0.0), y_a, y_a + 0.01), prism_y(tri(CR_H), y_a + CR_RAMP, y_a + CR_RAMP + 0.01)])
        return prism_y(tri(CR_H), y_a + CR_RAMP, y_b) + ramp
    xs = [-0.75 * (ox - BORE_R), -0.3 * (ox - BORE_R), 0.3 * (ox - BORE_R), 0.75 * (ox - BORE_R)]
    top_block = [(ENC_X - ENC_SLOT - 2, ENC_X + ENC_SLOT + 2)]
    for x in xs:
        ribs.append(rib(x, None, 'z', -1))
        if not any(a < x < b for a, b in top_block):
            ribs.append(rib(x, None, 'z', +1))
    zs = [ZC - 0.5 * (oz - BORE_R), ZC + 0.5 * (oz - BORE_R)]
    for z in zs:
        ribs.append(rib(z, None, 'x', -1))
        if not (PORT_Z - 9.5 < z < BTN_Z1 + 3.0):
            ribs.append(rib(z, None, 'x', +1))
    return Manifold.batch_boolean(ribs, ADD)


def _xz(p):
    return p[0], p[1]


def s3_envelope():
    """S3 board and its parts, for fit checks (component side toward the back)"""
    def comp(bx0, bx1, by0, by1, h, top=True):
        (xa, za), (xb, zb) = s3(bx0, by0), s3(bx1, by1)
        y0 = PCB_Y0 + 1.6
        ys = (y0, y0 + h) if top else (PCB_Y0 - h, PCB_Y0)
        return box(min(xa, xb), max(xa, xb), ys[0], ys[1], min(za, zb), max(za, zb))
    pcb = box(S3_EDGE - 63.5, S3_EDGE, PCB_Y0, PCB_Y0 + 1.6, S3_Z0, S3_Z0 + 44.45)
    for hx, hz in S3_HOLES:
        pcb = pcb - cyl_y(hx, hz, PCB_Y0 - 1, PCB_Y0 + 3, P3.S3_POST_D + 0.4, 32)
    return Manifold.batch_boolean([pcb, comp(50.5, 63.8, 5.0, 39.4, 13.0), comp(51.65, 62.65, 5.5, 38.9, 8.5, top=False),
                                   comp(21.1, 39.1, 14.8, 40.3, 3.1), comp(8.3, 14.8, 17.2, 23.7, 5.8),
                                   comp(55.8, 61.0, 1.8, 7.0, 7.0), comp(55.8, 61.0, 37.5, 42.7, 7.0)], ADD)


def sensor_envelope():
    """the light sensor on the tray, for fit checks: board, sockets, chip, screw heads underneath"""
    import sensor as SN
    b = SEN_TOP - 1.6
    parts = [box(SN.SB_X0, SN.SB_X1, SN.SB_Y0, SN.SB_Y1, b, SEN_TOP),
             box(SN.SX - 1.0, SN.SX + 1.0, SN.SY - 1.0, SN.SY + 1.0, SEN_TOP, SEN_TOP + 0.85)]
    parts += [box(SN.sb(bx0, 6)[0], SN.sb(bx1, 6)[0], SN.sb(0, 11.8)[1], SN.sb(0, 6)[1], SEN_TOP, SEN_TOP + 4.25) for bx0, bx1 in ((0.5, 4.8), (20.6, 24.9))]
    if SENSOR_MOUNT == 'sled':                                          # heads on the chip side, into the sled
        parts += [cyl_z(x, y, SEN_TOP, SEN_TOP + 1.6, 4.6, 24) for x, y in SN.SH]
    else:
        parts += [cyl_z(x, y, b - 1.8, b, 4.6, 24) for x, y in SN.SH]
    return Manifold.batch_boolean(parts, ADD)


def sensor_plugs():
    """STEMMA QT plugs in the sensor's two sockets (plugged on the bench), for fit checks: out past each board end"""
    import sensor as SN
    out = []
    for (bx0, bx1), sgn in (((0.5, 4.8), -1), ((20.6, 24.9), 1)):
        xa, xb = SN.sb(bx0, 6)[0], SN.sb(bx1, 6)[0]
        ya, yb = SN.sb(0, 11.6)[1], SN.sb(0, 6.2)[1]
        x0, x1 = (xa - 6.0, xa + 1.5) if sgn < 0 else (xb - 1.5, xb + 6.0)
        out.append(box(x0, x1, ya, yb, SEN_TOP + 0.2, SEN_TOP + 4.0))
    return Manifold.batch_boolean(out, ADD)


def post_test(z_tube=8.0):
    """one post, short: the flat floor (printed as a bridge back-down, like the tray's) and the hole, on a small base"""
    x, z = CORNERS[0]
    y0 = P3.FOOT_Y + P3.SO_FLOOR + z_tube
    p = P3.standoff(x, z, y0) + (box(x - 8, x + 8, y0, y0 + 2.0, ZC + z - 8, ZC + z + 8) - cyl_y(x, ZC + z, y0 - 1, y0 + 3, POST_BORE, 48))
    return p


def test_pieces(tr):
    """the fits that are new and unconfirmed, as small pieces of the real tray (case frame; they print back-down like it):
    top: the top wall from the knob slot to past the sensor, with the encoder rails (slide the real encoder board between
    them), the sensor hooks, socket channels, light hole and the front screw's counterbore (swing the sled in, drive the
    screw); window: the status window and the Boot funnel (the AMS swap; returned separately as 'window_part');
    pilots: three cleat bosses with vertical pilots 2.8 / 2.9 / 3.0 (1-3 notches): drive an M3 x 10 into each."""
    import sensor as SN
    zw = _zw()
    hw = enc_board()[0] + RAIL_CL + RAIL_W + 2.0
    top = tr ^ box(-hw, SN.SB_X1 + 6.0, 27.0, Y1 + 1, zw - 14.0, H + 1)
    nx, nz = _xz(S3_NEO)
    bx, bz = _xz(S3_BOOT)
    win = tr ^ box(min(nx, bx) - 9, max(nx, bx) + 11, Y1 - 5.0, Y1 + 1, min(nz, bz) - 8, max(nz, bz) + 8)
    pil = pilot_block((TAP_D_V - 0.1, TAP_D_V, TAP_D_V + 0.1))
    big = lambda m: max(m.decompose(), key=lambda p: p.volume())
    return dict(top=big(top), window=big(win), window_part=status_window(), pilots=pil, post=post_test())


def pilot_block(ds):
    """cleat bosses with vertical pilots of the sizes ds, 1-3 notches"""
    cuts = []
    blk = box(0, 12.0 * len(ds), Y0, Y1, 0, 14)
    for i, d in enumerate(ds):
        x = 6.0 + 12.0 * i
        blk = blk + cyl_y(x, 7.0, Y0 - CB_H, Y0 + 0.01, CB_D, 48)
        cuts.append(cyl_y(x, 7.0, Y0 - CB_H - 1, Y1 + 1, d, 24))
        cuts.append(Manifold.cylinder(TAP_LEAD_V + 0.01, d / 2, d / 2 + TAP_LEAD_V + 0.01, 24).rotate([-90, 0, 0]).translate([x, Y1 - TAP_LEAD_V, 7.0]))
        for k in range(i + 1):
            mx = x + (k - i / 2) * 2.0
            cuts.append(box(mx - 0.5, mx + 0.5, Y0 - 1, Y1 + 1, 13.0, 15.0))
    return blk - Manifold.batch_boolean(cuts, ADD)


def retest_plate():
    """round 3 (Nov 3): the cleat pilots only, at 3.05 / 3.1 / 3.15 with the deeper lead-in"""
    import trimesh
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
    out, x = [], 0.0
    for m in (pilot_block((3.05, 3.1, 3.15)),):
        me = m.to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
        t.apply_transform(down)
        mn, mx = t.bounds
        t.apply_translation([x - mn[0], -mn[1], -mn[2]])
        out.append(t)
        x += (mx[0] - mn[0]) + 8.0
    return trimesh.util.concatenate(out)


def test_plate(tr):
    """all the test pieces and the sled laid out on one plate (print orientation, as trimeshes): returns (petg, window)"""
    import trimesh
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])

    def tm(m):
        me = m.to_mesh(); return trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    p = test_pieces(tr)
    items = [(tm(p['top']), None, True), (tm(p['window']), tm(p['window_part']), True), (tm(p['pilots']), None, True),
             (tm(p['post']), None, True), (tm(sled()), None, False)]
    petg, wins, x = [], [], 0.0
    for m, w, rot in items:
        for g in (m, w):
            if g is not None and rot:
                g.apply_transform(down)
        mn, mx = m.bounds
        d = [x - mn[0], -mn[1], -mn[2]]
        for g in (m, w):
            if g is not None:
                g.apply_translation(d)
        petg.append(m)
        if w is not None:
            wins.append(w)
        x += (mx[0] - mn[0]) + 8.0
    P = trimesh.util.concatenate(petg)
    W = trimesh.util.concatenate(wins)
    c = -(P.bounds[0] + P.bounds[1]) / 2
    c[2] = 0
    P.apply_translation(c); W.apply_translation(c)
    return P, W


def fit_coupon(sh, tr):
    """the sleeve's and the tray's top-right corner, 25 mm deep: slide one into the other to tune TRAY_CL"""
    cx, cz = BORE_HX - BORE_R, ZC + BORE_HZ - BORE_R
    x0 = min(cx - 20, 0.75 * (BORE_HX - TRAY_CL - BORE_R) - 4)          # takes in the nearest top crush rib
    reg = box(x0, HW + 1, Y1 - 25, D + 1, cz - 20, H + 1)
    return sh ^ reg, tr ^ reg


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    configure_shell()
    V.BACKDOWN = True
    sh = V.shell2()
    tr = tray()
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])      # y = D on the bed (back down)

    def tm(m, mat=down):
        me = m.to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
        t.apply_transform(mat)
        return t

    def put(m, name, mat=down, frame=None):
        """frame: drop on this part's bed instead (a two-part print shares one frame)"""
        t = tm(m, mat)
        f = tm(frame, mat) if frame is not None else t
        t.apply_translation([0, 0, -f.bounds[0][2]]); t.export(f'{out}/{name}')
        print(name, t.is_watertight, np.round(t.extents, 1).tolist())
    put(sh, 'bar-shell-v5-walnut-backdown.stl')
    put(tr, 'bar-drawer-tray.stl')                                  # back face down, walls up
    put(status_window(), 'bar-drawer-tray-window.stl', frame=tr)    # its second part (translucent), same frame
    import collar as CO                                             # follows the 3.5 mm wall
    CO.TIP_BACK = False
    t = CO.export(CO.collar(), f'{out}/bar-encoder-collar-v5.stl'); print('bar-encoder-collar-v5.stl', t.is_watertight)
    t = tm(sled(), np.eye(4)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/bar-sensor-sled.stl')   # plate down
    print('bar-sensor-sled.stl', t.is_watertight, np.round(t.extents, 1).tolist())
    _mod = sys.modules[__name__]
    _mod.FASTEN, _saved = 'insert', _mod.FASTEN
    put(tray(), 'bar-drawer-tray-inserts.stl')                      # the same tray with heat-set insert holes (later)
    _mod.FASTEN = _saved
    P, W = test_plate(tr)
    os.makedirs(f'{out}/../archive/fit-tests', exist_ok=True)     # the fits are settled: the test plate lives with the archive
    tp = f'{out}/../archive/fit-tests/' + ('p25' if panel.KEY == 'p25' else 'p3')
    os.makedirs(tp, exist_ok=True)
    P.export(f'{tp}/test-plate-v5.stl'); W.export(f'{tp}/test-plate-v5-window.stl')
    t = retest_plate(); t.export(f'{tp}/test-plate-v5c.stl'); print('test plates ->', tp, t.is_watertight)
    print('test-plate-v5.stl', P.is_watertight, np.round(P.extents, 1).tolist(), '+ window', W.is_watertight)
    print(dict(D=D, S3_edge=round(S3_EDGE, 2), s3_z0=round(S3_Z0 - ZC, 2), port_z=round(PORT_Z - ZC, 2), corners=CORNERS))
