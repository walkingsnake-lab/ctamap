"""Cables and connectors in the P4 bar sleeve, seated, for fit checks (not printed).

Positions on the S3 come from Adafruit's board file (Adafruit-MatrixPortal-S3-PCB, `Adafruit MatrixPortal S3.brd`,
board frame bx from the USB edge, by from the long edge nearest the USB-C; drawer.s3() maps it into the case):
  JP2  2x8 shrouded IDC header (27.94 x 8.8 outline)  (57.15, 22.225) R270
  TP1  M3 SMT nut (power)                            (58.42,  4.445)
  TP2  M3 SMT nut (power)                            (58.42, 40.132)
  CONN1 STEMMA QT, JST SH 4 side entry, opening toward the by = 0 edge (body by 0.45-4.70, bx -3.0/+3.1)  (11.43, 3.048)
  SENSE JST PH 3 (unused)                            (48.895, 4.381) R180
  X5   USB-C (5.08, 8.255) R270
Bought-part dimensions are typical catalogue values, not measured (each is a constant below):
  ribbon 16-way 1.27 mm pitch: 20.32 x 1.0; IDC plug: 13 mm above the S3's board (as drawer.s3_envelope), 9 mm above
  the panel housing (as p4.panel_p4); JST VH 4 plug (VHR-4N): 15.8 x 7.8, 13.5 tall off the panel's board; wires
  Ø2.0 (20 AWG); fork lugs for M3 (insulated): tongue Ø6.4 x 0.8, barrel Ø5.0 x 12; M3 SMT nut 3.0 tall, pan head
  Ø5.5 x 2.2; JST SH plug: 5.0 wide x 2.9 thick, 2.5 out past the socket; its 4 wires a 4.0 x 1.0 bundle, bent at
  r 1.5; USB-C plug: 8.4 x 2.6 shell, 12.4 x 6.5 overmold.
Run: python3 p4_cables.py   -> collisions and clearances for every cable and plug
"""
import math, os, sys
os.environ['PANEL'] = 'p4'
from manifold3d import Manifold
import p4
DR = p4.DR
from case import box, cyl_y, cyl_z, ZC, H, D, HW, KY, PCB_Y0, PANEL_BACK, Y_FACE, PORT_Y, ADD
import sensor as SN

RIB_W, RIB_T = 20.32, 1.0
IDC_TOP_S3 = 13.0                 # IDC plug's strain relief above the S3's board top (drawer.s3_envelope's box)
IDC_TOP_PANEL = 8.0               # above the panel's housing back (p4.panel_p4's plug)
VH_W, VH_D, VH_H = 15.8, 7.8, 13.5
WIRE_D = 2.0
NUT_H, HEAD_D, HEAD_H = 3.0, 5.5, 2.2
LUG_TONGUE, LUG_T, LUG_BARREL_D, LUG_BARREL_L = 6.4, 0.8, 5.0, 12.0
SH_W, SH_T, SH_OUT, SH_BUNDLE = 5.0, 2.9, 2.5, (4.0, 1.0)
SH_BEND = 1.5
Y_TOP = PCB_Y0 + 1.6              # S3 component side (faces the tray's back wall)
WALL_IN = DR.Y0                   # tray back wall, inner face
RIB_FOLD_X = -12.0                # the ribbon's vertical run (between its two 45 deg folds) starts here
QT_RUN_Y = 53.0                   # the S3's QT cable runs behind the S3 at this depth: left under its bottom edge ...
QT_UP_X = 100.0                   # ... up behind the middle of the S3 here (clear of its posts, light and Boot tubes) ...
QT_RUN_Z = ZC + 47.0              # ... to this height, then left to the sensor


def s3b(bx0, bx1, by0, by1, y0, y1):
    """box from an S3 board-frame rectangle, between depths y0..y1"""
    (xa, za), (xb, zb) = DR.s3(bx0, by0), DR.s3(bx1, by1)
    return box(min(xa, xb), max(xa, xb), y0, y1, min(za, zb), max(za, zb))


def ribbon():
    """the 16-way ribbon seated: up off the panel's data-in plug to the back wall, along the wall at the input's height
    through the left hooks, down p4.RIBBON_DROP (22 mm) in two 45 deg folds (doubled where it folds), along the wall at the S3
    connector's height through the right hooks, then off the wall onto the S3's IDC plug. Slack: a flat Z (3 layers)
    on the right half's wall between the folds and the right hooks. Returns {piece: manifold}."""
    rz, iz = p4.RIB_Z, p4.IDC_Z
    pi_x = min(DR.HEADERS, key=lambda h: h[0])[0]
    idc_x = DR.s3(57.15, 0)[0]
    hw, y1 = RIB_W / 2, WALL_IN - 0.02
    yp = PANEL_BACK + IDC_TOP_PANEL
    out = dict(
        rise_panel=box(pi_x - RIB_T / 2, pi_x + RIB_T / 2, yp, y1 - 3.0, rz - hw, rz + hw),
        bend_panel=box(pi_x - RIB_T / 2, pi_x + 3.0, y1 - 3.0, y1, rz - hw, rz + hw),
        run_left=box(pi_x + 3.0, RIB_FOLD_X, y1 - RIB_T, y1, rz - hw, rz + hw),
        folds=box(RIB_FOLD_X, RIB_FOLD_X + RIB_W, y1 - 2.5, y1, iz - hw, rz + hw),          # two layers + crease
        slack_z=box(RIB_FOLD_X + RIB_W, p4.HOOK2_X - 3.0, y1 - 3.5, y1, iz - hw, iz + hw),   # three layers
        run_right=box(p4.HOOK2_X - 3.0, idc_x - 3.0, y1 - RIB_T, y1, iz - hw, iz + hw),
        bend_s3=box(idc_x - 3.0, idc_x + RIB_T / 2, y1 - 3.0, y1, iz - hw, iz + hw),
        drop_s3=box(idc_x - RIB_T / 2, idc_x + RIB_T / 2, Y_TOP + IDC_TOP_S3, y1 - 3.0, iz - hw, iz + hw))
    return out


def ribbon_length():
    pi_x = min(DR.HEADERS, key=lambda h: h[0])[0]
    idc_x = DR.s3(57.15, 0)[0]
    up = (WALL_IN - (PANEL_BACK + IDC_TOP_PANEL)) + (WALL_IN - (Y_TOP + IDC_TOP_S3))
    along = (idc_x - pi_x) + (p4.RIB_Z - p4.IDC_Z) - RIB_W                    # 45 deg folds: the drop costs (drop - width)
    return up + along + 2 * 15.0                                              # + the length inside both plugs


def sensor_plug_z():
    """the sensor's QT plugs' mid height (drawer.sensor_plugs: they come out past each end of its board, in channels
    in the tray's top wall; the 4 x 1 bundle leaves them flat, its top 0.5 above this)"""
    return DR.SEN_TOP + 2.1


def sensor_plug_y():
    return SN.sb(0, 11.6)[1], SN.sb(0, 6.2)[1]


def s3_connectors():
    """the plugs and lugs that mate with the S3 (in place), and its unused JST PH socket"""
    out = {}
    out['idc_plug'] = s3b(57.15 - 4.4, 57.15 + 4.4, 22.225 - 13.97, 22.225 + 13.97, Y_TOP, Y_TOP + IDC_TOP_S3)
    for name, by, sgn in (('lug_lower', 4.445, -1), ('lug_upper', 40.132, 1)):
        x, z = DR.s3(58.42, by)
        y0 = Y_TOP + NUT_H
        nut = cyl_y(x, z, Y_TOP, y0, 5.2, 24)
        tongue = cyl_y(x, z, y0, y0 + LUG_T, LUG_TONGUE, 24) + box(x - 7.0, x, y0, y0 + LUG_T, z - LUG_TONGUE / 2 + 1.2, z + LUG_TONGUE / 2 - 1.2)
        head = cyl_y(x, z, y0 + LUG_T, y0 + LUG_T + HEAD_H, HEAD_D, 24)
        yb = y0 + LUG_BARREL_D / 2                                             # barrel axis: its underside on the tongue
        barrel = Manifold.cylinder(LUG_BARREL_L, LUG_BARREL_D / 2, LUG_BARREL_D / 2, 24).rotate([0, -90, 0]).translate([x - 7.0, yb, z])
        out[name] = nut + tongue + head + barrel                              # pointing -x, off the S3's left edge
    # STEMMA QT plug in CONN1, entering from the board's bottom edge, its wires bent back toward the tray's wall
    cx = 11.43 + 0.05
    plug = s3b(cx - SH_W / 2, cx + SH_W / 2, 0.454 - SH_OUT, 2.0, Y_TOP + 0.05, Y_TOP + SH_T)
    bw, bt = SH_BUNDLE
    zb = DR.S3_Z0 + 0.454 - SH_OUT                                            # plug's rear face (case z)
    xa, xb = sorted((DR.s3(cx - bw / 2, 0)[0], DR.s3(cx + bw / 2, 0)[0]))
    bend = box(xa, xb, Y_TOP + 0.5, Y_TOP + 0.5 + SH_BEND + 2 * bt, zb - SH_BEND - 2 * bt, zb)   # 90 deg bend, r 1.5
    yr = QT_RUN_Y                                                             # just behind the S3's components (ESP32 module 3.1 tall)
    zl = zb - SH_BEND - 2 * bt                                                # the bend's lowest point
    back = box(xa, xb, Y_TOP + 0.5 + SH_BEND + bt, yr + 1.0, zl, zl + bt)
    left = box(QT_UP_X - 1.0, xb, yr - 1.0, yr + 1.0, zl, zl + 2.0)          # along under the board's bottom edge
    up = box(QT_UP_X - 1.0, QT_UP_X + 1.0, yr - 1.0, yr + 1.0, zl, QT_RUN_Z)  # up behind the middle of the S3 (2 mm loose bundle)
    sx = SN.SB_X1 + 7.5                                                       # the sensor's right-hand plug
    across = box(sx - 2.0, QT_UP_X + 1.0, yr - 1.0, yr + 1.0, QT_RUN_Z - 2.0, QT_RUN_Z)
    pz, (py0, py1) = sensor_plug_z(), sensor_plug_y()
    rise = box(sx - 2.0, sx, py0 + 1.7, yr + 1.0, QT_RUN_Z - 2.0, pz + 0.5)    # up the sensor's right end, into its plug
    run = back + left + up + across + rise
    out['qt_plug'] = plug + bend
    out['qt_run'] = run
    # unused JST PH 3 (vertical, ~8 x 4.5 x 6 tall) at SENSE
    out['ph3_socket'] = s3b(48.895 - 4.0, 48.895 + 4.0, 4.381 - 2.25, 4.381 + 2.25, Y_TOP, Y_TOP + 6.0)
    return out


def power_lead():
    """the panel's power lead: VH4 plug on the panel's header, four wires back off it, one pair over to each lug"""
    x0, z0 = 21.7, ZC - 7.3                                                   # header after the 180 deg turn (p4.panel_p4)
    yb = Y_FACE + 1.7 + 2.5                                                   # the panel's board back
    plug = box(x0 - VH_W / 2, x0 + VH_W / 2, yb, yb + VH_H, z0 - VH_D / 2, z0 + VH_D / 2)
    yw = yb + VH_H                                                            # wires leave the plug's top
    ys = Y_TOP + NUT_H + LUG_BARREL_D / 2                                     # the lug barrels' axis depth
    lugs = {k: DR.s3(58.42, by) for k, by in (('lower', 4.445), ('upper', 40.132))}
    out = dict(vh4_plug=plug, wires_up=box(x0 - 2 * WIRE_D, x0 + 2 * WIRE_D, yw, ys + WIRE_D / 2, z0 - WIRE_D / 2, z0 + WIRE_D / 2))
    for k, (lx, lz) in lugs.items():                                          # straight runs (hull of the two ends)
        a = cyl_y(x0, z0, ys - WIRE_D / 2, ys + WIRE_D / 2, 2 * WIRE_D, 16)
        b = cyl_y(lx - 7.0 - LUG_BARREL_L, lz, ys - WIRE_D / 2, ys + WIRE_D / 2, 2 * WIRE_D, 16)
        out[f'pair_{k}'] = (a + b).hull()
    return out


def power_bundle():
    """the spare power cable folded in ~3.5 cm lengths, tied through the tie loop (as main's README)"""
    tx = (p4.SEAM_BAR + 4.0 + DR.S3_EDGE - 63.8 - 1.0) / 2
    y_in = DR.Y1 - DR.LV_DEPTH
    zin1 = ZC + (DR.BORE_HZ - DR.TRAY_CL - DR.TRAY_WT)
    zt0 = zin1 - 2.5 - DR.LV_H / 2 - (DR.LV_ROWS - 1) * DR.LV_PITCH
    band_lo = zt0 - DR.LV_H / 2 - 1.5
    tz = (p4.RIB_Z + DR.HOOK_RW / 2 + band_lo) / 2
    return box(tx - 6.0, tx + 6.0, WALL_IN - DR.TIE_GAP - DR.TIE_BAR - 6.0, WALL_IN - DR.TIE_GAP - DR.TIE_BAR, tz - 17.5, tz + 17.5)


def usb_plug():
    """USB-C plug in the S3's receptacle: shell 8.4 x 2.6, in 6.0 past the board's edge; overmold 12.4 x 6.5 outside"""
    pz = DR.PORT_Z
    shell_in = box(DR.S3_EDGE - 6.0, HW + 0.5, PORT_Y - 1.3, PORT_Y + 1.3, pz - 4.2, pz + 4.2)
    over = box(HW + 0.5, HW + 25.0, PORT_Y - 3.25, PORT_Y + 3.25, pz - 6.2, pz + 6.2)
    return dict(usb_shell=shell_in, usb_overmold=over)


def statics():
    P = p4.build()
    dif = {k: p4.diffuser_in_case(v) for k, v in P['diffuser'].items()}
    return dict(shell_top=P['top'], shell_bot=P['bot'], tray_left=P['tray_left'], tray_right=P['tray_right'],
                spine=P['spine'], bridge=P['bridge'], panel=p4.panel_p4(),
                diffuser=Manifold.batch_boolean(list(dif.values()), ADD), s3=DR.s3_envelope(),
                sensor=DR.sensor_envelope() + DR.sensor_plugs(), sled=DR.sled(), encoder=p4.encoder_envelope(),
                collar=p4.collar_knob(), window=DR.status_window())


# pairs that touch by design (a plug in its own socket, a lug on its own nut, the ribbon in its own plugs)
MATES = {('lug_lower', 'pair_lower'), ('lug_upper', 'pair_upper'), ('pair_lower', 'wires_up'), ('pair_upper', 'wires_up'),
         ('pair_lower', 'pair_upper'), ('qt_plug', 'qt_run'), ('idc_plug', 's3'), ('lug_lower', 's3'), ('lug_upper', 's3'), ('qt_plug', 's3'), ('ph3_socket', 's3'),
         ('vh4_plug', 'panel'), ('drop_s3', 's3'), ('rise_panel', 'panel'), ('usb_shell', 's3'), ('usb_shell', 'tray_right'),
         ('usb_shell', 'shell_bot'), ('usb_overmold', 'shell_bot')}


def items():
    out = {}
    out.update(ribbon()); out.update(s3_connectors()); out.update(power_lead()); out.update(usb_plug())
    out['power_bundle'] = power_bundle()
    zt = H - p4.WALL - DR.TRAY_CL - DR.TRAY_WT                               # tray top wall's inner face
    sl = SN.SB_X0 - 7.5                                                       # the sensor's left-hand plug end
    ey = (KY - 3.0, KY + 3.0)
    pz, (py0, py1) = sensor_plug_z(), sensor_plug_y()
    eb = SN.EB_BOT - 1.48                                                     # the encoder's plugs' mid height (p4.encoder_envelope)
    out['qt_sensor_encoder'] = (box(12.7 + 6.0, 12.7 + 8.0, ey[0], ey[1], zt - 12.0, eb + 1.0)   # down off the encoder's plug,
                                + box(12.7 + 6.0, sl + 2.0, ey[0], ey[1], zt - 12.0, zt - 9.0)  # over under the rails,
                                + box(sl, sl + 2.0, ey[0], py1 - 1.7, zt - 12.0, pz + 0.5))     # up into the sensor's left plug
    return out


def check(clear=0.5):
    """overlaps of every cable and plug with every part (and each other), and anything within `clear` mm (the item
    shifted by `clear` along each axis still overlaps)"""
    S, I = statics(), items()
    hits, near = [], []
    names = list(I)
    shifts = [(sx * clear, 0, 0) for sx in (-1, 1)] + [(0, sy * clear, 0) for sy in (-1, 1)] + [(0, 0, sz * clear) for sz in (-1, 1)]
    for n in names:
        m = I[n]
        for sn, s in list(S.items()) + [(k, I[k]) for k in names if k > n]:
            if (n, sn) in MATES or (sn, n) in MATES:
                continue
            v = (m ^ s).volume()
            if v > 0.01:
                bb = (m ^ s).bounding_box()
                hits.append((n, sn, round(v, 2), 'x %.1f..%.1f y %.1f..%.1f z %+.1f..%+.1f (rel ZC)' % (bb[0], bb[3], bb[1], bb[4], bb[2] - ZC, bb[5] - ZC)))
            elif any((m.translate(list(t)) ^ s).volume() > 0.01 for t in shifts):
                near.append((n, sn))
    return hits, near


def qt_lengths():
    """seated route lengths (mm), squared off (laid diagonally behind the S3 they're ~2 cm shorter): the S3's QT cable to
    the sensor and, without the sensor, to the encoder; and the sensor's cable to the encoder"""
    zb = DR.S3_Z0 + 0.454 - SH_OUT - SH_BEND - 2 * SH_BUNDLE[1]
    xq = DR.s3(11.48, 0)[0]
    to_top = (QT_RUN_Y - Y_TOP) + (xq - QT_UP_X) + (QT_RUN_Z - zb) + 10.0          # + the bend and both plug ends
    to_sensor = to_top + (QT_UP_X - (SN.SB_X1 + 7.5)) + (sensor_plug_z() - QT_RUN_Z) + 4.0   # + the jog into the plug
    to_encoder = to_top + (QT_UP_X - 18.7) + ((SN.EB_BOT - 1.48) - QT_RUN_Z)        # over, then up into the encoder's plug
    zt = H - p4.WALL - DR.TRAY_CL - DR.TRAY_WT
    sensor_encoder = (sensor_plug_z() - (zt - 12.0)) + ((SN.SB_X0 - 7.5) - 18.7) + ((SN.EB_BOT - 1.48) - (zt - 12.0)) + 6.0
    return round(to_sensor), round(to_encoder), round(sensor_encoder)


def pose_lengths():
    """QT spans (mm) in assembly step 7's pose, where the encoder end is plugged: the right tray half front up on the case's
    back over the left half, turned end for end (x -> -x, its back wall up). Sensor -> encoder, and S3 -> encoder without
    the sensor (its in-tray route, then out over the case's back rim to the encoder)."""
    pose = lambda p: (-p[0], DR.Y1 + (DR.Y1 - p[1]), p[2])
    L = lambda pts: sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
    enc = (18.7, KY, SN.EB_BOT - 1.48)
    rim = (enc[0] + 5.0, D + 2.0, enc[2])
    to_sensor, _, _ = qt_lengths()
    sensor = pose((SN.SB_X0 - 7.5, sensor_plug_y()[0] + 2.7, sensor_plug_z()))
    s3 = to_sensor + ((SN.SB_X1 + 7.5) - (SN.SB_X0 - 7.5)) + L([pose((SN.SB_X0 - 7.5, QT_RUN_Y, sensor_plug_z())), rim, enc])
    return round(L([enc, rim, sensor]) + 6.0), round(s3)


if __name__ == '__main__':
    hits, near = check()
    print(f'wall {p4.WALL} mm, joint {p4.JOINT}, top screws {p4.TOP_SCREWS}')
    print('QT routes seated, S3 -> sensor, S3 -> encoder (no sensor), sensor -> encoder (mm):', qt_lengths())
    print('QT spans in step 7\'s pose, sensor -> encoder, S3 -> encoder (no sensor) (mm):', pose_lengths())
    print('ribbon length seated (mm):', round(ribbon_length()))
    print('S3 board bottom edge z rel ZC:', round(DR.S3_Z0 - ZC, 2), ' QT plug rear z rel:', round(DR.S3_Z0 + 0.454 - SH_OUT - ZC, 2))
    print('collisions:' if hits else 'collisions: none')
    for h in hits:
        print('  ', h)
    print('within 0.5 mm:', near if near else 'none')
