"""Fit check for the P4's two top screws under the knob (p4.py, TOP_SCREWS):
    python3 check_p4_top.py            (CASE_WALL=4.0 for a 4 mm wall)
Checks the tray's two bosses and pads, the shell's holes, the collar's flange holes and the screws themselves against
the encoder (board, body, sockets, both QT plugs), the knob (at rest and pressed), the collar, the shell, the panel and
the sensor, seated, with the tray at the ends of its float, and along the tray's slide-in path. Prints every number and
ends with PASS or FAIL."""
import math, sys
import numpy as np
import p4
from p4 import *
import knob as KN, collar as CO, sensor as SN

FAILS = []


def vol(a, b):
    return (a ^ b).volume()


def gap(a, b, axis, sign, limit=6.0, step=0.01):
    """how far a can move along axis (sign) before it overlaps b; limit if it never does"""
    lo, hi = 0.0, limit
    d = [0.0, 0.0, 0.0]
    d[axis] = sign * limit
    if vol(a.translate(d), b) < 1e-4 and all(vol(a.translate([sign * t if i == axis else 0 for i in range(3)]), b) < 1e-4
                                                 for t in np.arange(0.25, limit, 0.25)):
        return limit
    for t in np.arange(step, limit + step, step):
        d[axis] = sign * t
        if vol(a.translate(d), b) > 1e-4:
            return round(float(t - step), 2)
    return limit


def expect(ok, text):
    print(('  ok   ' if ok else '  FAIL ') + text)
    if not ok:
        FAILS.append(text)


def main():
    print(f'wall {WALL}  case {2 * HW:.1f} x {H:.1f} x {D:.1f}  knob axis y {KY:.1f}  screws at x +/-{TS_X}, M2.5 x {TS_LEN:g}')
    P = p4.build()
    shell = P['top'] + P['bot']
    tray = P['tray']
    p4.TOP_SCREWS = False
    tray0 = p4.tray_p4()
    p4.TOP_SCREWS = True
    added = tray - tray0                                          # the bosses, gussets and pads
    drilled = tray0 - tray                                        # the pilots through the old top wall
    enc = p4.encoder_envelope()                                   # board, body, bushing, both sockets and both plugs
    env = SN.envelopes()
    collar = p4.collar_knob()
    knob = p4.knob_in_case()
    panel_ = p4.panel_p4()
    sensor = DR.sensor_envelope() + DR.sensor_plugs() + DR.sled()
    s3 = DR.s3_envelope()
    zw = DR._zw()
    zo = zw + DR.TRAY_WT
    zb = DR.enc_board()[2][1] - DR.RAIL_LAP

    print('tray bosses and pads')
    print(f'  added {added.volume():.1f} mm3 in {len(added.decompose())} pieces; boss {zw - zb:.2f} deep under the wall, '
          f'bottom {H - zb:.2f} under the case top')
    for name, other in (('encoder (board, body, sockets, plugs)', enc), ('collar', collar), ('shell', shell), ('panel', panel_),
                        ('sensor, its plugs and sled', sensor), ('S3', s3), ('knob', knob)):
        v = vol(added, other)
        expect(v < 0.01, f'seated, vs {name}: {v:.2f} mm3')
    g_plug = gap(added, enc, 2, -1)
    expect(g_plug >= 0.7, f'boss to the QT plugs under the board, straight down: {g_plug:.2f} mm (the rails have 0.8)')
    g_board = gap(added, env['enc_pcb'], 0, -1), gap(added, env['enc_pcb'], 0, 1)
    expect(min(g_board) >= DR.RAIL_CL, f'nothing added inboard of the rails: new material starts {min(g_board):.2f} mm from the '
           f'encoder board (the rails keep their {DR.RAIL_CL})')
    g_shell = gap(added, shell, 2, 1)
    expect(0.0 <= g_shell <= 0.1, f'pad to the shell top wall: {g_shell:.2f} mm (clearance {DR.TRAY_CL} less the {TS_PAD} pad)')
    worst = 0.0
    for dy in np.arange(0.0, 62.01, 0.5):                         # the tray's way in, from 62 mm out
        a = added.translate([0, float(dy), 0])
        worst = max(worst, vol(a, enc), vol(a, collar), vol(a, shell), vol(a, knob))
    expect(worst < 0.01, f'sliding in (0-62 mm out, 0.5 steps), vs encoder, collar, shell: worst {worst:.2f} mm3')
    for side, half in (('left', P['tray_left']), ('right', P['tray_right'])):
        parts = [q for q in half.decompose() if q.volume() > 0.01]
        nb = vol(half, added)
        expect(len(parts) == 1 and nb > 20, f'{side} tray half: one body, {nb:.0f} mm3 of boss and pad on it')

    print('screws')
    for dx, dy in ((0, 0), (0.2, 0.4), (-0.2, -0.4), (0.2, -0.4), (-0.2, 0.4)):
        for i, sc in enumerate(p4.top_screws_env(dx, dy)):
            tag = f'float x {dx:+.1f} y {dy:+.1f}, screw {"LR"[i]}'
            ve, vs, vc = vol(sc, enc), vol(sc, shell), vol(sc, collar)
            vk = vol(sc, knob)
            vk5 = vol(sc, knob.translate([0, 0, -0.5]))
            if not (ve < 0.005 and vs < 0.005 and vc < 0.005 and vk < 0.005 and vk5 < 0.005):
                expect(False, f'{tag}: encoder {ve:.2f}, shell {vs:.2f}, collar {vc:.2f}, knob {vk:.2f}, knob pressed {vk5:.2f} mm3')
    expect(True, 'at 5 float positions (x +/-0.2, y +/-0.4): no overlap with the encoder, shell, collar or knob (also pressed 0.5)')
    sc = p4.top_screws_env()
    both = sc[0] + sc[1]
    g_knob = gap(knob, both, 2, -1)
    expect(g_knob >= 0.7, f'knob down onto the heads: {g_knob:.2f} mm (press travel ~0.5)')
    g_tip = gap(both, enc, 2, -1)
    expect(g_tip >= 0.8, f'screw tips to the QT plugs: {g_tip:.2f} mm')
    tip = H - TS_LEN
    eng = min(zo + TS_PAD, H) - max(tip, zb)
    expect(eng >= 3.5, f'thread in the tray: {eng:.2f} mm (pad top {H - zo - TS_PAD:.2f} to tip {TS_LEN:.2f} under the case top; boss ends {H - zb:.2f})')
    expect(eng - TS_LEAD >= 3.0, f'full thread below the {TS_LEAD} lead-in: {eng - TS_LEAD:.2f} mm (1.3 x the screw diameter; no guide bore here)')
    expect(tip >= zb, f'tip stays inside the boss by {tip - zb:.2f} mm')
    r_out = TS_X + 0.2 + TS_HEAD_D / 2                           # farthest point of a head from the knob axis, tray 0.2 off
    r_knob = KN.PEB_R * p4.KNOB_SCALE
    expect(r_out < r_knob, f'largest head (4.7), tray 0.2 off: ends {r_out:.2f} mm from the knob axis; the knob is {r_knob:.2f} '
           f'({r_knob - r_out:.2f} under its edge; a 4.5 head centred: {r_knob - TS_X - 2.25:.2f}). The flutes are below the shoulder, '
           f'so they open no view from above')
    r_hole = TS_X + TS_FLANGE / 2
    expect(r_hole < r_knob, f'flange holes end {r_hole:.2f} mm out ({r_knob - r_hole:.2f} under the knob\'s edge)')
    # bearing: the head's footprint on the walnut round the stadium
    for dy in (0.0, DR.SCREW_FLOAT):
        hd = cyl_z(TS_X, KY + dy, H - 0.2, H, TS_HEAD_D - 0.3, 48)              # the kit's smaller head (4.4)
        a = vol(hd, shell) / 0.2
        expect(a >= 5.0, f'head bearing on the walnut (4.4 head, tray {dy:+.1f} in y): {a:.1f} mm2')

    print('shell and collar')
    expect(len([q for q in P["top"].decompose() if q.volume() > 0.01]) == 1, 'shell top: one body')
    lig = TS_X - TS_CLEAR / 2 - 12.0
    print(f'  walnut between the knob hole and each screw hole: {lig:.2f} mm; wall {WALL}')
    c = p4.collar_p4()
    expect(len([q for q in c.decompose() if q.volume() > 0.01]) == 1, 'collar: one body')
    print(f'  collar flange: {TS_X - TS_FLANGE / 2 - (CO.HOLE_R - CO.CL):.2f} mm from each hole to the plug, '
          f'{CO.FL_R * p4.KNOB_SCALE - r_hole:.2f} to the flange edge')
    print(f'  encoder board top to the tray wall above it: {zw - SN.EB_TOP:.2f} mm')
    for n in ('top', 'bot'):
        sq = p4.bed_fit(P[n], 1)[0]
        expect((p4.BED - sq) / 2 >= 3.0, f'shell {n}: {sq} mm square on the bed, {(p4.BED - sq) / 2:.1f} a side')
    print('PASS' if not FAILS else f'FAIL ({len(FAILS)})')
    return 0 if not FAILS else 1


if __name__ == '__main__':
    sys.exit(main())
