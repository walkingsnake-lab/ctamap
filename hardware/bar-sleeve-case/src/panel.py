"""Panel profiles for the bar sleeve case. Pick one with the PANEL environment variable (default p3):
    PANEL=p25 python3 case2.py ../stl-p25
Everything panel-specific lives here; case.py, case2.py, plate3.py, diffuser.py and plinth.py derive the rest.
Panel frame: x right seen from the front, z up from the panel centre (ZC). Units mm.
Positions the case keeps relative to the P3 build move by DX (bore half width vs P3) and DZ (bore half height vs P3);
both are exactly 0 for P3, so its STLs don't change."""
import os

PROFILES = {
    'p3': dict(                          # Waveshare RGB-Matrix-P3-64x32, SKU 20117 (the current build)
        name='Waveshare P3 64x32',
        w=192.0, h=96.0, t=14.5,         # outline, thickness (measured)
        pitch=3.0, rib=0.6,              # diffuser grid: LED pitch, rib width (0.4 nozzle)
        faces={'white': 0.2, 'translucent': 0.4},   # diffuser face = one first layer: 0.2 (0.4 nozzle), 0.4 (0.6 nozzle)
        # brass M3 inserts on the panel back (x, z - ZC). Corners confirmed Oct 31 with check_corners.py: the v3 frame
        # fits all four (v2 at +/-88 / +86.5 only took one end's pair at a time). x +/-87.25 on both rows (174.5 mm end
        # to end), z +31 / -29 (estimated -26). The middle two are from photos (+/-0.5 mm). (-87.25, -29) is under the
        # S3 in plate v3
        inserts=((-87.25, 31.0), (87.25, 31.0), (-87.25, -29.0), (87.25, -29.0), (-12.7, 38.0), (12.0, -36.0)),
        standoffs=((-87.25, 31.0), (87.25, 31.0), (87.25, -29.0), (12.0, -36.0)),   # plate v3 bolts to these
        tie_bridge=(-17.0, 17.0, 63.0, 78.0),   # plate v3 tie-down bridge: x0, x1, z0, z1 (z in the P3 case, moves by DZ)
        hooks=(-22.5, 22.5),             # ribbon hooks on the plate (x), on bars between the louvers / pills
        # plate v3 louver rows (x segments): gaps at the bottom bosses (+/-40, +/-52) and centre standoff, and at the keyholes
        lv_bottom_x=((-86.0, -61.0), (-31.0, -13.0), (18.0, 31.0), (61.0, 86.0)),   # gap 13..18 clears the centre standoff (x 12)
        lv_top_x=((-80.0, -46.5), (-33.5, 33.5), (46.5, 80.0)),
        headers=((63.0, 2.5), (-63.0, 2.5)),   # PI IN, PO OUT centres (x, z - ZC), vertical 2x8 shrouds
        s3_back=0.0,                     # extra gap between the panel back and the S3's bottom socket (the case deepens by it)
        # S3 3.1 mm above the drawer's default: its STEMMA QT plug (side entry on the board's bottom edge) sat on the
        # lower-right post (check_v5.py); its top edge now stays 0.7 under the upper-right post
        drawer_s3_mid=0.6,
        sensor_x=55.0,                   # optional light sensor (hole in the case top, board hung from the encoder)
        key_x=40.0,                      # plate v3 keyholes (x +/-)
        screw_xs=(40.0, 52.0),           # screws from below into the plate's bosses (x +/-): stop the insert sliding out
        # push foot for the corner under the S3 (no standoff there): x0, x1 and z0, z1 above the panel's bottom edge. A post
        # beside the S3, in the gap between the panel's left edge and the first louver slot; the S3 is 11.8 mm above the edge
        corner_foot=(-95.0, -89.0, 0.5, 10.3),
        posts=((-75, 43), (75, 43), (-60, -43), (60, -43)),   # plate v2 only: foam hold-downs (x, z - ZC)
        assumed=(),
    ),
    'p25': dict(                         # Waveshare RGB-Matrix-P2.5-64x32, SKU 23707 (standard) / 33839 (GOB)
        name='Waveshare P2.5 64x32',
        w=160.0, h=80.0, t=14.5,         # outline from Waveshare's spec table; thickness ASSUMED (= P3), measure
        pitch=2.5, rib=0.45,             # 0.45 rib = two lines from a 0.2 nozzle (crisp). On a 0.4 it's one bead, and a print
                                         # (classic walls, Oct 28) came out wavy and uneven: the P2.5 diffuser needs the 0.2
        faces={'white': 0.14},           # whole diffuser on the 0.2 nozzle, first layer set to 0.14 (its max): one-layer face
        # inserts: corners confirmed Oct 31 with check_corners.py (an M3 dropped into all four at 125 x 64.5 mm); the
        # listing-photo estimate (+/-63.5, +/-33.5) was 1-1.3 mm too far out. The two middle ones are from a photo of the
        # panel back (+/-0.5 mm; the drawer tray doesn't use them). Six on the top and bottom rails, point-symmetric
        inserts=((-62.5, 32.25), (62.5, 32.25), (-62.5, -32.25), (62.5, -32.25), (-12.0, 32.25), (12.0, -32.25)),
        standoffs=((-62.5, 32.25), (62.5, 32.25), (62.5, -32.25)),   # three corners; no centre one: the bottom louvers run through
        tie_bridge=(-9.0, 17.0, 59.0, 74.0),   # narrowed (moved ribbon hook) and lowered 4 mm (clears the top louver band)
        hooks=(-13.5, 22.5),             # left hook moved clear of the S3's IDC plug
        # louvers: one unbroken run per row, between the bottom bosses (+/-46) and clear of the S3's lower posts (x -39.7) and between the keyhole
        # bumps (+/-45.25); the bottom rows behind the S3's posts are still cut back (plate3.louver_segments)
        lv_bottom_x=((-35.0, 35.0),),
        lv_top_x=((-45.0, 45.0),),
        headers=((40.1, -1.2), (-40.1, -1.2)),   # from the photo; PO OUT sits under the S3's bottom socket (see README)
        # PO OUT sits under the S3's bottom socket; the S3 would move back by the header's height above the insert faces
        s3_back=0.0,                     # PO OUT sits below the frame top (a ruler across the frame clears it, Oct 29)
        sensor_x=40.0,                   # moved in: at 55 its bracket hits the top-right standoff (x 63.5)
        # 4-pin power socket (POWER1, VH 3.96 class, pins in a vertical row): centre (x, z), from Waveshare's product photo
        # of the back (Nov 4), scaled to the confirmed corner inserts; the headers and middle inserts land within ~1 mm
        # of the values above on the same photo. +5V is the top pair, GND the bottom. check_bar128_power.py uses it
        power=(1.7, 0.2), power_row='z',
        key_x=51.5,                      # keyholes beside the corner standoffs, so the top louvers run unbroken between them
        screw_xs=(46.0,),                # one pair (the plate bolts to the panel; these only stop the insert sliding out)
        # push foot: a blade under the S3 (only 3.8 mm between its edge and the panel's), clear of the screw boss
        corner_foot=(-78.0, -56.0, 0.5, 2.9),
        posts=((-60, 35), (60, 35), (-14, -36), (60, -36)),   # plate v2 only (placeholders)
        assumed=('thickness', 'headers (photo, +/-1 mm)', 'header height above the rails'),
    ),
    'p4': dict(                          # Waveshare RGB-Matrix-P4-64x32 (SMD2121, 1/16 scan). Built by p4.py (split parts)
        name='Waveshare P4 64x32',
        w=256.0, h=128.0, t=14.5,        # outline; housing 12 mm deep (2D drawing) + LED board ~2.5 (ASSUMED, measure)
        hood=(16.0, 4.0),                # front lip top / bottom: the P3's 12 / 3 scaled 4/3, so the front's slant matches the P3 (4.5 deg)
        pitch=4.0, rib=0.8,              # 0.8 = two 0.4-nozzle lines; SMD2121 leaves ~1.9 mm between packages
        faces={'white': 0.2},
        # inserts from Waveshare's 2D drawing (RGB-Matrix-P4-64x32-2D.dwg): M3 on Ø8.5 bosses, x -120 / 0 / +120, z +/-56,
        # normal orientation (data in on the right seen from the front). p4.py turns the panel 180 deg like the v5 drawer
        inserts=((-120.0, 56.0), (120.0, 56.0), (-120.0, -56.0), (120.0, -56.0), (0.0, 56.0), (0.0, -56.0)),
        standoffs=((-120.0, 56.0), (120.0, 56.0), (-120.0, -56.0), (120.0, -56.0), (0.0, -56.0)),
        tie_bridge=(-17.0, 17.0, 63.0, 78.0),   # plate v3 only (p4.py has its own tray)
        hooks=(-22.5, 22.5),             # plate v3 only
        lv_bottom_x=((-110.0, -20.0), (20.0, 110.0)),
        lv_top_x=((-110.0, -20.0), (20.0, 110.0)),
        # data in / data out centres (x, z - ZC), vertical 2x8 shrouds: from the product photo scaled to the drawing's
        # inserts (+/-1 mm). Power (VH4) is at about (-21.7, +7.3)
        headers=((80.8, 0.0), (-81.2, 0.0)),
        s3_back=0.0,
        # S3 5.5 mm above the drawer's lowest place: its STEMMA QT plug enters from the board's bottom edge, right over
        # the lower-right post (p4_cables.py); the buttons' relief stops 3.0 above Reset, leaving 1.1 mm of full wall
        # under the shell joint's pocket
        drawer_s3_mid=-22.0, drawer_btn_top=41.1,
        sensor_x=55.0,
        key_x=40.0,
        screw_xs=(46.0,),
        corner_foot=(-95.0, -89.0, 0.5, 10.3),  # plate v3 only
        posts=((-75, 43), (75, 43), (-60, -43), (60, -43)),   # plate v2 only (placeholders)
        # bore pads: an 8 mm bezel all round (the diffuser's flange, black). The diffuser's front edge sits 0.9 inside the
        # bore (as P3), so the pads are 8.9; the rim covers 1.2 of it, ~7.7 mm shows
        bore_pad=(8.9, 8.9),
        assumed=('thickness (housing 12 per drawing + board 2.5)', 'headers (photo, +/-1 mm)', 'header height'),
    ),
}

# Two P2.5 panels side by side (128 x 32, bar128.py): one 320 x 80 "panel" for the parts that span both (shell, diffuser).
# Panel A's centre at x -80, B's at +80 (panel frame, before the 180 deg turn); each keeps the P2.5's own inserts and
# headers. The trays are built per panel with the plain 'p25' profile (bar128.py), so the plate-v3 fields below are the
# P2.5's, unused.
def _pair(pts):
    return tuple((cx + x, z) for cx in (-80.0, 80.0) for x, z in pts)


PROFILES['p25x2'] = dict(PROFILES['p25'], name='2 x Waveshare P2.5 64x32 (128 x 32)', w=320.0, cols=128,
                         inserts=_pair(PROFILES['p25']['inserts']), headers=_pair(PROFILES['p25']['headers']),
                         standoffs=_pair(PROFILES['p25']['standoffs']),
                         sensor_x=83.0,           # 40 mm from the knob toward the centre (bar128.KNOB_X, x +123)
                         screw_xs=(34.0, 126.0))  # each tray's pair from below (x +/-46 about its panel)

# Two P3 panels side by side (128 x 32, p3x2.py): one 384 x 96 "panel" for the parts that span both (shell, diffuser).
# Panel A's centre at x -96, B's at +96. The trays are built per panel with the plain 'p3' profile.
def _pair3(pts):
    return tuple((cx + x, z) for cx in (-96.0, 96.0) for x, z in pts)


PROFILES['p3x2'] = dict(PROFILES['p3'], name='2 x Waveshare P3 64x32 (128 x 32)', w=384.0, cols=128,
                        inserts=_pair3(PROFILES['p3']['inserts']), headers=_pair3(PROFILES['p3']['headers']),
                        standoffs=_pair3(PROFILES['p3']['standoffs']),
                        sensor_x=122.0,          # 40 mm from the knob toward the centre (p3x2.KNOB_X, x +162)
                        screw_xs=(50.0, 142.0))  # each tray's pair from below (x +/-46 about its panel)

KEY = os.environ.get('PANEL', 'p3').lower()
if KEY not in PROFILES:
    raise SystemExit(f'PANEL={KEY!r}: use one of {", ".join(PROFILES)}')
P = PROFILES[KEY]
COLS, ROWS = P.get('cols', 64), 32       # pixels

# case opening (bore): the same borders past the panel edge for every panel, unless the profile sets bore_pad (P4: an
# 8 mm bezel all round)
BORE_PAD_X, BORE_PAD_Z, BORE_R = 10.0, 4.65, 11.5
_PX, _PZ = P.get('bore_pad', (BORE_PAD_X, BORE_PAD_Z))
BORE_HX = P['w'] / 2 + _PX               # P3: 106
BORE_HZ = P['h'] / 2 + _PZ               # P3: 52.65
DX = BORE_HX - (192.0 / 2 + BORE_PAD_X)  # 0 for P3
DZ = BORE_HZ - (96.0 / 2 + BORE_PAD_Z)   # 0 for P3
