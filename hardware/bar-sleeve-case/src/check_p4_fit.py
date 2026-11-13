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

    print(f'shell joint ({p4.JOINT})')
    expect(vol(top, bot) < 0.01, f'halves seated: overlap {vol(top, bot):.3f} mm3')
    for n, m in (('top', top), ('bottom', bot)):
        expect(len([q for q in m.decompose() if q.volume() > 0.01]) == 1, f'{n} half: one body, {m.volume() / 1000:.1f} cm3')
        sq = p4.bed_fit(m, 1)[0]
        expect((p4.BED - sq) / 2 >= 3.1, f'{n} half on the bed: {sq} mm square, {(p4.BED - sq) / 2:.1f} mm a side (a 3 mm brim needs 3.1)')
    slab = box(-BIG, BIG, -BIG, BIG, ZJ - 0.06, ZJ + 0.01)
    seat = vol(top.translate([0, 0, -0.05]), bot ^ slab) / 0.05
    far = vol(top.translate([0, 0, -0.05]), (bot ^ slab) - p4.visible_layer(bot, p4.LAND)) / 0.05
    # the V: material removed from the outer skin at the joint, left end, mid depth
    sk = box(-HW, -HW + 0.1, 40, 41, ZJ - 0.6, ZJ + 0.6)
    opening = (P['shell'] ^ sk).volume() / 0.1 - ((top + bot) ^ sk).volume() / 0.1
    deepc = box(-HW + 0.42, -HW + 0.48, 40, 41, ZJ - 0.6, ZJ + 0.6)
    at_depth = (P['shell'] ^ deepc).volume() / 0.06 - ((top + bot) ^ deepc).volume() / 0.06
    expect(0.8 <= opening <= 1.0 and at_depth <= 0.25, f'V-groove outside: {opening:.2f} mm wide at the surface, {at_depth:.2f} at 0.45 mm deep')
    if p4.JOINT == 'plate':
        expect(seat > 100, f'the halves meet on {seat:.0f} mm2 ({seat / 2:.0f} an end): a {p4.LAND:g} mm land along the visible edges, less the V')
        expect(far < 0.03 * seat, f'of that, more than {p4.LAND:g} mm from a visible face: {far:.1f} mm2 (the rest is hollowed {p4.HOLLOW} mm)')
        pl = P['plates'][0] + P['plates'][1]
        w, h = p4.JP_Y1 - p4.JP_Y0, p4.JP_H
        print(f'  plates: {w:g} x {h:g} x {p4.JP_T} mm, one inside each end wall; glued face {w * h / 2 / 100:.1f} cm2 in each half ({w * h / 100:.1f} cm2 an end); '
              f'wall behind the rebate {WALL - p4.JP_T - p4.JP_CL:.1f} mm')
        expect(vol(pl, shell) < 0.01 and len([q for q in pl.decompose() if q.volume() > 1]) == 2, f'plates in their rebates: overlap with the shell {vol(pl, shell):.3f} mm3')
        one = P['plates'][0]
        gx = gap(one, shell, (-1, 0, 0), limit=1.0)
        gb = gap(one, shell, (1, 0, 0), limit=1.0)
        expect(gx <= 0.02, f'plate on the rebate\'s floor (moves {gx:.2f} mm outward before it touches)')
        gy0, gy1 = gap(one, shell, (0, -1, 0), limit=3.0), gap(one, shell, (0, 1, 0), limit=3.0)
        gz0, gz1 = gap(one, shell, (0, 0, -1), limit=3.0), gap(one, shell, (0, 0, 1), limit=3.0)
        expect(abs(gy1 - p4.JP_CL_E) < 0.03 and abs(gz0 - p4.JP_CL_E) < 0.03 and abs(gz1 - p4.JP_CL_E) < 0.03,
               f'play in the rebate: {gy1:.2f} mm at its back end, {gz0:.2f} / {gz1:.2f} at its lower / upper edge; {gy0:.2f} toward its sloped front end')
        expect(vol(pl, trays) < 0.01, f'plates vs the trays seated: {vol(pl, trays):.3f} mm3; plate face {p4.JP_CL + DR.TRAY_CL:.2f} mm from the tray\'s wall')
        worst = max(vol(trays.translate([0, float(dy), 0]), pl) for dy in np.arange(0.0, 60.0, 2.0))
        expect(worst < 0.01, f'trays sliding in past the plates (60 mm): worst overlap {worst:.3f} mm3')
        rib_z = [ZC - 0.5 * (BORE_HZ - DR.TRAY_CL - BORE_R), ZC + 0.5 * (BORE_HZ - DR.TRAY_CL - BORE_R)]
        clear_r = min(abs(z - ZJ) for z in rib_z) - (p4.JP_H / 2 + p4.JP_CL_E)
        expect(clear_r >= 3.0, f'trays\' side crush ribs run {clear_r:.1f} mm outside the rebates (they bear on walnut, not on the plates)')
        usb_top = DR.PORT_Z + V.PORT_H / 2 + V.PORT_CH
        clear_u = (ZJ - p4.JP_H / 2 - p4.JP_CL_E) - usb_top
        expect(clear_u >= 5.0, f'right end: rebate\'s lower edge to the USB-C opening: {clear_u:.1f} mm of full wall')
        s3 = DR.s3_envelope()
        expect(vol(pl, s3) < 0.01, f'plates vs the S3: {vol(pl, s3):.3f} mm3 (the plate is inside the wall)')
    else:
        expect(seat > 150, f'seat at the joint plane: {seat:.0f} mm2 in all ({seat / 2:.0f} an end)')
        gx = min(gap(top, bot, (1, 0, 0)), gap(top, bot, (-1, 0, 0)))
        expect(abs(gx - LAP_CL) < 0.03, f'lip sideways in its pocket: {gx:.2f} mm (glue gap {LAP_CL})')
        lip_t, lip_l = WALL / 2 - LAP_CL, LAP - LAP_ZCL
        print(f'  lip {lip_t:.2f} mm thick, {lip_l:.1f} mm long, lap face {((LAP_Y1 - LAP_Y0) - lip_l) * lip_l:.0f} mm2 an end')
    w = min((bot ^ box(HW - WALL - 0.5, HW + 0.5, y - 0.1, y + 0.1, z - 0.1, z + 0.1)).volume() / 0.04
            for y in np.arange(20.0, 72.0, 2.0) for z in np.arange(ZC - 28, ZJ - 0.5, 1.0))
    least = (WALL - p4.JP_T - p4.JP_CL) if p4.JOINT == 'plate' else WALL / 2
    expect(w >= least - 0.01, f'right end wall between the USB-C opening and the joint: {w:.2f} mm at its thinnest '
           f'({"behind the plate" if p4.JOINT == "plate" else "at the lap\'s pocket"}; 0.8 with the old relief)')

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
    expect(vol(dif, trays) < 0.05, f'tray front edges at the flange as modelled (seated they stand {DR.POST_LONG} off it; the panel holds the diffuser on the rim): overlap {vol(dif, trays):.3f} mm3')
    k = 1.0 / (1.0 - p4.DIFF_SHRINK)
    HSW, HSH = DF.HOUSE_W or DF.PW, DF.HOUSE_H or DF.PH             # the housing's measured outline (the grid: DF.PW x DF.PH)
    print(f'  printed halves built {p4.DIFF_SHRINK * 100:.2f}% large: flange {2 * DF.FL_HX * k:.2f} x {2 * DF.FL_HZ * k:.2f} mm built, '
          f'{2 * DF.FL_HX:.1f} x {2 * DF.FL_HZ:.1f} once shrunk (bore {2 * BORE_HX:.1f} x {2 * BORE_HZ:.1f}); skirt opening '
          f'{(HSW + 2 * DF.CLR) * k:.2f} x {(HSH + 2 * DF.CLR) * k:.2f} built for a {HSW:g} x {HSH:g} housing')
    # the skirts on the measured housing: measured off the printed parts once shrunk, clear of the bumps and at one
    dp = P['diffuser_print']
    whole = (dp[('left', 'black')] + dp[('right', 'black')]).scale([1 / k, 1 / k, 1.0])     # as it comes out, shrunk
    zt = DF.SKIN + DF.GRID_H + DF.SK_D
    house = box(-HSW / 2, HSW / 2, -HSH / 2, HSH / 2, DF.SKIN + DF.GRID_H + 0.05, zt + 5)
    def room(axis, sign, x0, x1):                                 # how far the housing can move before it meets the part there
        probe = house ^ (box(x0, x1, -200, 200, -5, 30) if axis == 1 else box(-200, 200, x0, x1, -5, 30))
        for t in np.arange(0.0, 1.0, 0.01):
            d = [0.0, 0.0, 0.0]; d[axis] = sign * float(t)
            if vol(probe.translate(d), whole) > 1e-4:
                return round(float(t) - 0.01, 2)
        return 1.0
    g_top, g_bot = room(1, 1, 40.0, 60.0), room(1, -1, 40.0, 60.0)
    expect(abs(g_top - DF.CLR) < 0.03 and abs(g_bot - DF.CLR) < 0.03, f'skirts to the {HSH:g} mm housing, top / bottom: {g_top:.2f} / {g_bot:.2f} mm (meant {DF.CLR})')
    e_l, e_r = room(0, -1, -30.0, 30.0), room(0, 1, -30.0, 30.0)   # the housing's ends to the end skirts (HSW assumed)
    ecl = DF.CLR if DF.END_CLR is None else DF.END_CLR
    expect(abs(e_l - ecl) < 0.03 and abs(e_r - ecl) < 0.03, f'end skirts to a {HSW:g} mm housing: {e_l:.2f} / {e_r:.2f} mm (meant {ecl}; the width is not measured)')
    inside = vol(whole, box(-HSW / 2, HSW / 2, -HSH / 2, HSH / 2, DF.SKIN + DF.GRID_H + 0.05, zt + 5))
    expect(inside < 1e-3, f'no bumps: nothing of the diffuser stands inside the housing\'s outline ({inside:.3f} mm3); the skirts only locate')
    if p4.JOINT_LUGS:
        print('diffuser joint: the draw screws')
        axes, y_out = p4.lug_axes()
        L = (dp[('left', 'black')]).scale([1 / k, 1 / k, 1.0]); R = (dp[('right', 'black')]).scale([1 / k, 1 / k, 1.0])
        WLs = (dp[('left', 'white')]).scale([1 / k, 1 / k, 1.0]); WRs = (dp[('right', 'white')]).scale([1 / k, 1 / k, 1.0])
        expect(len([q for q in L.decompose() if q.volume() > 1e-3]) == 1 and len([q for q in R.decompose() if q.volume() > 1e-3]) == 1, 'each half\'s black part is one body, lugs and all')
        gaps = []
        for yc, zc in axes:
            reg = box(-12, 12, min(yc - 4, yc + 4), max(yc - 4, yc + 4), DF.SKIN + DF.GRID_H + DF.SK_D + 0.3, 12)     # above the skirt: the lugs alone
            gaps.append((round(-(L ^ reg).bounding_box()[3], 3), round((R ^ reg).bounding_box()[0], 3)))
        expect(all(abs(a - p4.LUG_FACE) < 1e-3 and abs(b - p4.LUG_FACE) < 1e-3 for a, b in gaps) and p4.LUG_FACE >= 0.08,
               f'lug faces stand {p4.LUG_FACE} mm behind the joint plane on each half ({2 * p4.LUG_FACE:.1f} apart): the white edges are the only stop, the screws tie')
        expect(abs(WLs.bounding_box()[3]) < 1e-3 and abs(WRs.bounding_box()[0]) < 1e-3, 'the white first layers reach the joint plane too')
        sc = p4.lug_screws_env()
        expect(vol(sc, L + WLs) < 0.005, f'screws through the left half: overlap {vol(sc, L + WLs):.3f} mm3 (clearance {p4.LUG_CLEAR})')
        way = max(vol(sc.translate([-float(t), 0, 0]), L + WLs) for t in np.arange(0.0, p4.LUG_SCREW + 0.51, 0.25))
        expect(way < 0.005, f'each screw\'s way in, straight along its axis from {p4.LUG_SCREW + 0.5:g} mm out (tip at the lug\'s outer face): worst overlap with the left half {way:.3f} mm3 (the skirt is cut away for it)')
        for yc, zc in axes:                                       # no ledge for the panel: the lugs' inner faces only slope or stand
            sy = 1 if yc > 0 else -1
            flat = 0.0
            for zz in np.arange(DF.SKIN + DF.GRID_H + 0.3, 6.5, 0.1):
                a = (R ^ box(1.0, 2.0, min(sy * 63.0, sy * 66.0), max(sy * 63.0, sy * 66.0), float(zz), float(zz) + 0.1))
                b = (R ^ box(1.0, 2.0, min(sy * 63.0, sy * 66.0), max(sy * 63.0, sy * 66.0), float(zz) + 0.1, float(zz) + 0.2))
                if a.volume() > 1e-6 and b.volume() > 1e-6:
                    ia = min(abs(a.bounding_box()[1]), abs(a.bounding_box()[4])); ib = min(abs(b.bounding_box()[1]), abs(b.bounding_box()[4]))
                    flat = max(flat, ib - ia)
            expect(flat <= 0.15, f'{"top" if sy > 0 else "bottom"} lug\'s inner face: steepest step outward per 0.1 mm of height {flat:.2f} mm (45 deg or steeper: no ledge)')
        expect(p4.LUG_SCREW - p4.LUG_A >= 4.0 and p4.LUG_PILOT_DEPTH >= p4.LUG_SCREW - p4.LUG_A + 1.5, f'thread in the right lug: {p4.LUG_SCREW - p4.LUG_A:.1f} mm of an M2.5 x {p4.LUG_SCREW:g}, pilot {p4.LUG_PILOT_DEPTH} deep')
        expect(axes[0][1] - p4.LUG_HEAD_D / 2 - DF.FT >= 0.3, f'head ({p4.LUG_HEAD_D}) clears the flange\'s back by {axes[0][1] - p4.LUG_HEAD_D / 2 - DF.FT:.2f} mm')
        both = Manifold.batch_boolean([p4.diffuser_in_case(v.scale([1 / k, 1 / k, 1.0])) for v in dp.values()], ADD) + p4.diffuser_in_case(sc)
        for nm, m in (('shell', shell), ('bridge', P['bridge']), ('spine', P['spine']), ('panel', p4.panel_p4()), ('encoder', p4.encoder_envelope()), ('collar', p4.collar_knob())):
            expect(vol(both, m) < 0.01, f'joined diffuser and its screws, seated, vs {nm}: {vol(both, m):.3f} mm3')
        worst = max(vol(both, trays.translate([dx, dyb, dz])) for dx in (-0.3, 0, 0.3) for dz in (-0.55, 0, 0.55) for dyb in (0.0, 0.3))
        expect(worst < 0.01, f'vs the trays floated +/-0.3 along, +/-0.55 up and down, 0-0.3 back: worst {worst:.3f} mm3 (lugs {y_out:.2f} out, tray wall from {DF.BORE_HZ - DR.TRAY_CL - DR.TRAY_WT:.2f})')
        worst = max(vol(both, trays.translate([0, float(t), 0.55 * s])) for t in np.arange(0.3, 62, 1.0) for s in (-1, 0, 1))
        expect(worst < 0.01, f'trays sliding in past the lugs (62 mm): worst {worst:.3f} mm3')
        worst = max(vol(both.translate([0, float(t), 0]), shell + p4.collar_knob()) for t in np.arange(0.5, 58, 1.0))
        expect(worst < 0.05, f'joined diffuser sliding in from the back, past the shell and the collar: worst {worst:.3f} mm3')
        worst = max(vol(both, p4.panel_p4().translate([0, float(t), 0])) for t in np.arange(0.0, 20, 0.5))
        expect(worst < 0.01, f'panel coming in from behind onto the diffuser (20 mm): worst {worst:.3f} mm3')
    if p4.JOINT_BARS:
        print('diffuser joint: splice bars, screws driven down')
        yc, y_out, y_in, z_top = p4.bar_geom()
        L = (dp[('left', 'black')]).scale([1 / k, 1 / k, 1.0]); R = (dp[('right', 'black')]).scale([1 / k, 1 / k, 1.0])
        Wh = (dp[('left', 'white')] + dp[('right', 'white')]).scale([1 / k, 1 / k, 1.0])
        expect(len([q for q in L.decompose() if q.volume() > 1e-3]) == 1 and len([q for q in R.decompose() if q.volume() > 1e-3]) == 1, 'each half\'s black part is one body, bosses and all')
        def free(m, x, y, z):
            dm = 0.0
            for d in np.arange(1.8, 3.4, 0.05):
                if vol(cyl_z(x, y, z - 0.02, z + 0.02, float(d), 48), m) < 1e-6:
                    dm = float(d)
            return dm
        ok = True
        for m, sx in ((L, -1), (R, 1)):
            for sy in (1, -1):
                x, y = sx * p4.BAR_X, sy * yc
                ok = ok and free(m + Wh, x, y, z_top - 0.5) >= p4.BAR_GUIDE_D - 0.11 and abs(free(m + Wh, x, y, z_top - 3.0) - p4.BAR_PILOT) < 0.11 \
                    and free(m + Wh, x, y, DF.FT + 0.2) >= p4.BAR_PILOT - 0.11 and free(m + Wh, x, y, DF.FT - 0.2) == 0.0
        expect(ok, f'four bosses at x +/-{p4.BAR_X:g}: guide {p4.BAR_GUIDE_D} x {p4.BAR_GUIDE_L}, pilot {p4.BAR_PILOT} down to the flange\'s back, the {DF.FT} mm flange under it whole')
        bars = p4.joint_bar(1) + p4.joint_bar(-1)
        sc = p4.bar_screws_env()
        thread = p4.BAR_SCREW - p4.BAR_T - p4.BAR_GUIDE_L
        expect(thread >= 3.5 and z_top + p4.BAR_T - p4.BAR_SCREW >= DF.FT + 0.5, f'M2.5 x {p4.BAR_SCREW:g} through the {p4.BAR_T} bar: {thread:.1f} mm of thread below the guide, tip {z_top + p4.BAR_T - p4.BAR_SCREW - DF.FT:.1f} above the flange\'s back')
        expect(vol(bars, L + R + Wh) < 0.005 and vol(sc, bars) < 0.005, f'bars on the boss tops: overlap with the halves {vol(bars, L + R + Wh):.3f}, screws in the slots {vol(sc, bars):.3f} mm3')
        fl = (p4.BAR_SLOT_L - 2.5) / 2
        expect(fl >= 0.6, f'slots let each boss sit +/-{fl:.1f} mm along the joint\'s pull: no dimension closes the joint, the bars clamp the halves where they are pushed')
        expect(min(y_out - yc - p4.BAR_SLOT_W / 2, yc - p4.BAR_SLOT_W / 2 - y_in) >= 0.8, f'bar walls beside the slot: {y_out - yc - p4.BAR_SLOT_W / 2:.2f} / {yc - p4.BAR_SLOT_W / 2 - y_in:.2f} mm, {p4.BAR_T} thick')
        both = Manifold.batch_boolean([p4.diffuser_in_case(v.scale([1 / k, 1 / k, 1.0])) for v in dp.values()], ADD) + p4.diffuser_in_case(bars) + p4.diffuser_in_case(sc)
        for nm, m in (('shell', shell), ('bridge', P['bridge']), ('spine', P['spine']), ('panel', p4.panel_p4()), ('encoder', p4.encoder_envelope()), ('collar', p4.collar_knob()),
                      ('S3', DR.s3_envelope()), ('sensor and sled', DR.sensor_envelope() + DR.sensor_plugs() + DR.sled())):
            expect(vol(both, m) < 0.01, f'joined diffuser, bars and screws (to {z_top + p4.BAR_T + p4.BAR_HEAD_K:.1f} behind the face), seated, vs {nm}: {vol(both, m):.3f} mm3')
        worst = max(vol(both, trays.translate([dx, dyb, dz])) for dx in (-0.3, 0, 0.3) for dz in (-0.55, 0, 0.55) for dyb in (0.0, 0.3))
        expect(worst < 0.01, f'vs the trays floated +/-0.3 along, +/-0.55 up and down, 0-0.3 back: worst {worst:.3f} mm3 (bars {y_out:.2f} out, tray wall from {DF.BORE_HZ - DR.TRAY_CL - DR.TRAY_WT:.2f})')
        worst = max(vol(both, trays.translate([0, float(t), 0.55 * s])) for t in np.arange(0.3, 62, 1.0) for s in (-1, 0, 1))
        expect(worst < 0.01, f'trays sliding in past the bars (62 mm): worst {worst:.3f} mm3')
        worst = max(vol(both.translate([0, float(t), 0]), shell + p4.collar_knob()) for t in np.arange(0.5, 58, 1.0))
        expect(worst < 0.05, f'joined diffuser with its bars sliding in from the back, past the shell and the collar: worst {worst:.3f} mm3')
        worst = max(vol(both, p4.panel_p4().translate([0, float(t), dz])) for t in np.arange(0.0, 20, 0.5) for dz in (-0.14, 0.0, 0.14))
        expect(worst < 0.01, f'panel coming in from behind, centred and 0.14 mm off up or down (20 mm): worst {worst:.3f} mm3 (bars {y_in - HSH / 2:.2f} from its edge)')
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
