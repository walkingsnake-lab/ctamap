"""Fit check for the P4 bar sleeve's joints (p4.py): the shell's V-groove half-lap, the diffuser's seat and its way in,
USB-C and the S3's edge buttons with no relief in the wall, and the wall cleat.
    python3 check_p4_fit.py
Prints every number and ends with PASS or FAIL. The top screws have check_p4_top.py, the cables p4_cables.py."""
import math, sys
import numpy as np
import p4
from p4 import *
import case as C
import cleat as CLT

FAILS = []
BIG = 1000.0


def vol(a, b):
    return (a ^ b).volume()


def gap(a, b, d, limit=4.0, step=0.01):
    """how far a can move along the unit direction d before it overlaps b (limit if it never does)"""
    d = np.array(d, float)
    for t in np.arange(step, limit + step, step):
        if vol(a.translate(list(d * t)), b) > 1e-3:
            return round(float(t - step), 2)
    return limit


def expect(ok, text):
    print(('  ok   ' if ok else '  FAIL ') + text)
    if not ok:
        FAILS.append(text)


def main():
    print(f'wall {WALL}  case {2 * HW:.1f} x {H:.1f} x {D:.1f}')
    P = p4.build()
    top, bot = P['top'], P['bot']
    shell = top + bot
    trays = P['tray_left'] + P['tray_right']

    print('shell joint')
    expect(vol(top, bot) < 0.01, f'halves seated: overlap {vol(top, bot):.3f} mm3')
    for n, m in (('top', top), ('bottom', bot)):
        expect(len([q for q in m.decompose() if q.volume() > 0.01]) == 1, f'{n} half: one body, {m.volume() / 1000:.1f} cm3')
        sq = p4.bed_fit(m, 1)[0]
        expect((p4.BED - sq) / 2 >= 3.1, f'{n} half on the bed: {sq} mm square, {(p4.BED - sq) / 2:.1f} mm a side (a 3 mm brim needs 3.1)')
    left = box(-BIG, 0, -BIG, BIG, -BIG, BIG)
    seat = vol(top.translate([0, 0, -0.05]), bot ^ box(-BIG, BIG, -BIG, BIG, ZJ - 0.06, ZJ + 0.01)) / 0.05
    expect(seat > 150, f'seat at the joint plane: {seat:.0f} mm2 in all ({seat / 2:.0f} an end)')
    far = vol(top.translate([0, 0, -0.05]), (bot ^ box(-BIG, BIG, -BIG, BIG, ZJ - 0.06, ZJ + 0.01)) - p4.visible_layer(bot, 2.0)) / 0.05
    expect(far < 0.02 * seat, f'seat more than 2 mm from a visible face: {far:.1f} of {seat:.0f} mm2 (the seat is already only a 2 mm land along the visible edges: nothing to hollow)')
    gx = min(gap(top, bot, (1, 0, 0)), gap(top, bot, (-1, 0, 0)))
    gy = min(gap(top, bot, (0, 1, 0)), gap(top, bot, (0, -1, 0)))
    expect(abs(gx - LAP_CL) < 0.03, f'lip sideways in its pocket: {gx:.2f} mm (glue gap {LAP_CL})')
    expect(0.1 <= gy <= 0.25, f'lip front to back: {gy:.2f} mm')
    lip_t, lip_l = WALL / 2 - LAP_CL, LAP - LAP_ZCL
    lap_len = (LAP_Y1 - LAP_Y0) - lip_l                                # its mean length (45 deg ends)
    print(f'  lip {lip_t:.2f} mm thick, {lip_l:.1f} mm long, lap face {lap_len * lip_l:.0f} mm2 an end; end faces {WALL * D:.0f} mm2 an end')
    # the V: material removed from the outer 0.05 mm skin at the joint, left end, mid depth
    sk = box(-HW, -HW + 0.1, 40, 41, ZJ - 0.6, ZJ + 0.6)
    opening = (P['shell'] ^ sk).volume() / 0.1 - ((top + bot) ^ sk).volume() / 0.1
    deepc = box(-HW + 0.42, -HW + 0.48, 40, 41, ZJ - 0.6, ZJ + 0.6)
    at_depth = (P['shell'] ^ deepc).volume() / 0.06 - ((top + bot) ^ deepc).volume() / 0.06
    expect(0.8 <= opening <= 1.0 and at_depth <= 0.25, f'V-groove outside: {opening:.2f} mm wide at the surface, {at_depth:.2f} at 0.45 mm deep')
    thin = box(HW - WALL, HW, 20, 72, ZC - 45, ZJ)
    w = min((bot ^ box(HW - WALL - 0.5, HW + 0.5, y - 0.1, y + 0.1, z - 0.1, z + 0.1)).volume() / 0.04
            for y in np.arange(20.0, 72.0, 2.0) for z in np.arange(ZC - 28, ZJ - LAP - 0.3, 1.0))
    expect(w >= WALL - 0.01, f'right end wall between the USB-C opening and the joint: {w:.2f} mm at its thinnest (was 0.8 with the relief)')

    print('diffuser seat')
    dif = Manifold.batch_boolean([p4.diffuser_in_case(v) for v in P['diffuser'].values()], ADD)
    expect(vol(dif, shell) < 0.05, f'seated against the rim: overlap with the shell {vol(dif, shell):.3f} mm3')
    g_f = gap(dif, shell, (0, -1, 0), limit=1.0)
    expect(g_f <= 0.05, f'forward of its seat it meets the rim within {g_f:.2f} mm')
    held = vol(dif.translate([0, -0.3, 0]), shell)
    over = V.RIM_IN - 0.3 - DF.BEV
    expect(held > 20 and abs(over - 1.0) < 0.01, f'rim overlap {over:.2f} mm all round ({held:.0f} mm3 in the way 0.3 mm forward); seat {V.SEAT_DEG:g} deg')
    worst = max(vol(dif.translate([0, float(dy), 0]), shell) for dy in np.arange(0.5, 58.0, 1.0))
    expect(worst < 0.05, f'sliding in from the back (58 mm): worst overlap with the shell {worst:.3f} mm3')
    expect(vol(dif, trays) < 0.05, f'tray front edge on the flange: overlap {vol(dif, trays):.3f} mm3')
    k = 1.0 / (1.0 - p4.DIFF_SHRINK)
    print(f'  printed halves built {p4.DIFF_SHRINK * 100:.2f}% large: flange {2 * DF.FL_HX * k:.2f} x {2 * DF.FL_HZ * k:.2f} mm built, '
          f'{2 * DF.FL_HX:.1f} x {2 * DF.FL_HZ:.1f} once shrunk (bore {2 * BORE_HX:.1f} x {2 * BORE_HZ:.1f}); skirt opening '
          f'{(DF.PW + 2 * DF.CLR) * k:.2f} x {(DF.PH + 2 * DF.CLR) * k:.2f} built for a {DF.PW:g} x {DF.PH:g} panel')
    wl = P['diffuser'][('left', 'white')]
    bb = wl.bounding_box()
    expect(abs((bb[3] - bb[0]) - DF.FL_HX + DF.BEV) < 0.3 and bb[5] - bb[2] <= DF.SKIN + 1e-6,
           f'white part = the whole first layer: {bb[3] - bb[0]:.1f} x {bb[4] - bb[1]:.1f} x {bb[5] - bb[2]:.2f} mm a half (face and flange front)')

    print('USB-C and the S3\'s edge buttons, no relief in the wall')
    pz, py = DR.PORT_Z, C.PORT_Y
    tunnel = HW - DR.S3_EDGE
    print(f'  board edge {BORE_HX - DR.S3_EDGE:.2f} mm inside the wall\'s inner face (tray wall {DR.TRAY_WT} + {DR.TRAY_CL} + 0.4); '
          f'{tunnel:.2f} mm behind the outer face (3.5 mm wall, as the P3 drawer: {tunnel - (WALL - 3.5):.2f})')
    def housing(w, t, r):                                             # a plug's housing, w along the port x t across, corners r, 0.5 mm from the board
        cs = CrossSection.square([t - 2 * r, w - 2 * r], center=True).offset(r, JT, circular_segments=32).translate([py, pz])
        return prism_x(cs, DR.S3_EDGE + 0.5, HW + 25.0)
    over_mold = housing(12.35, 6.5, 0.05)                             # the USB-C spec's overmold limit, square-cornered
    v_s, v_t = vol(over_mold, shell), vol(over_mold, trays)
    expect(v_s < 0.01 and v_t < 0.01, f'spec-limit plug housing (12.35 x 6.5, square corners) pushed in to 0.5 mm from the board: shell {v_s:.2f}, tray {v_t:.2f} mm3')
    big = housing(12.85, 7.0, 1.5)                                    # the larger figure the opening was sized for (case2.PORT_H / PORT_W), rounded
    expect(vol(big, shell) < 0.01 and vol(big, trays) < 0.01, f'12.85 x 7.0 housing (the size the opening was drawn for): shell {vol(big, shell):.2f}, tray {vol(big, trays):.2f} mm3')
    gs = min(gap(over_mold, shell, (0, 1, 0)), gap(over_mold, shell, (0, -1, 0)), gap(over_mold, shell, (0, 0, 1)), gap(over_mold, shell, (0, 0, -1)))
    gt = min(gap(over_mold, trays, (0, 1, 0)), gap(over_mold, trays, (0, -1, 0)), gap(over_mold, trays, (0, 0, 1)), gap(over_mold, trays, (0, 0, -1)))
    expect(gs >= 0.4 and gt >= 0.6, f'room round the 12.35 x 6.5 housing: {gs:.2f} mm in the shell\'s opening (least at its rounded corners), {gt:.2f} in the tray\'s window')
    yb0, yb1 = PCB_Y0 + 1.6, PCB_Y0 + 1.6 + 3.5                                                # edge parts stand 3.5 mm off the board's back face
    zb0, zb1 = pz + 8.8 - 2.5, pz + 35.0                                                       # Down, Up, Reset along the edge (drawer.BTN_Z0 / BTN_Z1 uncapped)
    for b in (1.0, 2.0, 3.0):
        btn = box(DR.S3_EDGE - 3.0, DR.S3_EDGE + b, yb0, yb1, zb0, zb1)
        seated = vol(btn, shell)
        slide = max(vol(btn.translate([0, float(dy), 0]), shell) for dy in np.arange(0.0, 60.0, 2.0))
        expect(seated < 0.01 and slide < 0.01, f'buttons standing {b:g} mm past the board\'s edge: shell {seated:.2f} mm3 seated, {slide:.2f} sliding in')
    lim = BORE_HX - DR.S3_EDGE
    print(f'  a button would have to stand {lim:.2f} mm past the board\'s edge to reach the walnut')
    v_tb = vol(box(DR.S3_EDGE - 3.0, DR.S3_EDGE + 2.0, yb0, yb1, zb0 + 2.5, pz + 29.7 + 2.0), trays)
    expect(v_tb < 0.01, f'buttons (2 mm proud, Down to Reset) in the tray wall\'s window: overlap {v_tb:.2f} mm3')

    print('wall cleat')
    cc, wc = CLT.case_cleat(), p4.wall_cleat_p4()
    bb = wc.bounding_box()
    print(f'  wall cleat {bb[3] - bb[0]:.0f} mm long (case cleat {cc.bounding_box()[3] - cc.bounding_box()[0]:.0f}); wall screws at x {list(p4.WALL_CLEAT_XS)}')
    expect(max(vol(wc, shell), vol(wc, trays), vol(wc, cc), vol(cc, shell), vol(cc, trays)) < 0.01, 'seated: no overlap between the cleats, the shell and the trays')
    case = shell + trays + cc
    T = CLT.T
    worst = 0.0
    for s in np.linspace(0, 1, 26):
        worst = max(worst, vol(case.translate([0, -T * (1 - s), T + 0.5]), wc))
    for s in np.linspace(0, 1, 26):
        worst = max(worst, vol(case.translate([0, 0, (T + 0.5) * (1 - s)]), wc))
    expect(worst < 0.01, f'hang path (lift {T + 0.5:g}, push in, drop): worst overlap {worst:.3f} mm3')
    bx, bz = DR.S3_BOOT
    nx, nz = DR.S3_NEO
    expect(bx - DR.BOOT_FUNNEL_D / 2 - bb[3] >= 3.0, f'wall cleat\'s end to the Boot funnel: {bx - DR.BOOT_FUNNEL_D / 2 - bb[3]:.1f} mm; to the status window: {nx - DR.WIN_D / 2 - bb[3]:.1f} mm')
    expect(bb[3] - bb[0] <= p4.BED - 10, f'prints flat: {bb[3] - bb[0]:.0f} mm on the {p4.BED:g} mm bed')
    print(f'  rim to wall {CLT.YW - D:g} mm; each end of the case overhangs the wall cleat by {HW - bb[3]:.0f} mm (was {HW - (DR.CLEAT_HW - 0.5):.0f})')
    print('PASS' if not FAILS else f'FAIL ({len(FAILS)})')
    return 0 if not FAILS else 1


if __name__ == '__main__':
    sys.exit(main())
