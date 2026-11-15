"""Fit checks for the P5 bar sleeve (p5.py): overlaps between parts that should only touch (volume, mm3), the smallest
gaps round the end-wall encoder, and the bed fit of the big parts. Everything is the model's: the panel is not in hand.
Run: python3 check_p5.py        (exit code 1 if a check fails)"""
import sys
import numpy as np
from manifold3d import Manifold
import p5 as B
import p4 as P4
import drawer as DR
import diffuser as DF
import cleat as CLT
from case import box, cyl_y, ZC, H, D, HW, WALL, ADD, KY

P = B.build()
M = dict(shell_a=P['a'], shell_b=P['b'], tray_l=P['tray_left'], tray_r=P['tray_right'], spine=P['spine'], bridge=P['bridge'],
         plate_top=P['plates'][0], plate_bot=P['plates'][1], panel=B.panel_p5(), encoder=B.encoder_envelope(),
         collar=B.collar_in_case(), knob=B.knob_in_case(), sensor=DR.sensor_envelope(), sled=DR.sled(),
         case_cleat=CLT.case_cleat(), wall_cleat=B.wall_cleat_p5())
# the S3 envelope's component boxes overrun its own mounting holes a little (the real parts clear them)
M['s3'] = DR.s3_envelope() - Manifold.batch_boolean([cyl_y(x, z, 0, D, 6.4, 32) for x, z in DR.S3_HOLES], ADD)
d = P['diffuser']
M['diff_l'] = P4.diffuser_in_case(d[('left', 'white')] + d[('left', 'black')])
M['diff_r'] = P4.diffuser_in_case(d[('right', 'white')] + d[('right', 'black')])
# seated, the trays and the bridge stand DR.POST_LONG further back than modelled (their posts are that much long, so
# the panel always sits on the diffuser): the panel pairs are checked there
for n in ('tray_l', 'tray_r', 'bridge'):
    M[n + '@seated'] = M[n].translate([0, DR.POST_LONG + 0.001, 0])

# (a, b, most overlap allowed in mm3, why)
PAIRS = [
    ('shell_a', 'tray_l', 12.0, 'crush ribs only'), ('shell_b', 'tray_r', 12.0, 'crush ribs only'),
    ('shell_a', 'tray_r', 0.5, ''), ('shell_b', 'tray_l', 0.5, ''), ('tray_l', 'tray_r', 0.01, ''),
    ('tray_l@seated', 'panel', 0.01, ''), ('tray_r@seated', 'panel', 0.01, ''), ('bridge@seated', 'panel', 0.01, ''),
    ('bridge', 'tray_l', 0.01, ''), ('bridge', 'tray_r', 0.01, ''), ('spine', 'tray_l', 0.01, ''), ('spine', 'tray_r', 0.01, ''),
    ('encoder', 'tray_r', 0.01, ''), ('encoder', 'shell_b', 0.01, ''), ('encoder', 'panel', 0.01, ''), ('encoder', 's3', 0.01, ''),
    ('encoder', 'sensor', 0.01, ''), ('encoder', 'diff_r', 0.01, ''),
    ('collar', 'shell_b', 6.0, 'collar crush ribs only'), ('collar', 'tray_r', 0.01, ''), ('collar', 'encoder', 0.01, ''),
    ('knob', 'shell_b', 0.01, ''), ('knob', 'collar', 0.01, ''),
    ('s3', 'tray_r', 0.01, ''), ('s3', 'shell_b', 0.01, ''), ('s3', 'panel', 0.01, ''),
    ('sensor', 'tray_r', 0.01, ''), ('sensor', 'shell_b', 0.01, ''), ('sled', 'tray_r', 0.01, ''), ('sled', 's3', 0.01, ''),
    ('sensor', 'panel', 0.01, ''), ('sled', 'panel', 0.01, ''),
    ('plate_top', 'shell_a', 0.01, ''), ('plate_top', 'shell_b', 0.01, ''), ('plate_bot', 'shell_a', 0.01, ''), ('plate_bot', 'shell_b', 0.01, ''),
    ('plate_top', 'tray_l', 1.0, 'crush ribs into the plate'), ('plate_top', 'tray_r', 1.0, 'crush ribs into the plate'),
    ('plate_bot', 'tray_l', 1.0, 'crush ribs into the plate'), ('plate_bot', 'tray_r', 1.0, 'crush ribs into the plate'),
    ('diff_l', 'diff_r', 0.01, ''), ('diff_l', 'shell_a', 0.01, ''), ('diff_r', 'shell_b', 0.01, ''), ('diff_l', 'panel', 5.0, 'snap bumps only'),
    ('diff_r', 'panel', 5.0, 'snap bumps only'), ('diff_l', 'tray_l', 0.01, ''), ('diff_r', 'tray_r', 0.01, ''),
    ('case_cleat', 'tray_l', 0.01, ''), ('case_cleat', 'tray_r', 0.01, ''), ('case_cleat', 'wall_cleat', 0.01, ''),
    ('wall_cleat', 'tray_l', 0.01, ''), ('wall_cleat', 'tray_r', 0.01, ''), ('wall_cleat', 'shell_a', 0.01, ''), ('wall_cleat', 'shell_b', 0.01, ''),
    ('spine', 'shell_a', 0.01, ''), ('spine', 'shell_b', 0.01, ''),
]
bad = 0
print('overlaps (mm3):')
for a, b, lim, why in PAIRS:
    v = (M[a] ^ M[b]).volume()
    ok = v <= lim
    bad += not ok
    if v > 1e-4 or not ok:
        print(f'  {"ok  " if ok else "FAIL"} {a:14s} {b:10s} {v:8.3f}  (limit {lim}) {why}')
print(f'  {len(PAIRS)} pairs checked')

print('gaps (mm):')
xw = B.BORE_HX - DR.TRAY_CL - DR.TRAY_WT
board = box(B.EB_X0, B.EB_X1, KY - 12.7, KY + 12.7, B.KZ - 12.7, B.KZ + 12.7)
GAPS = [
    ('encoder board to the tray (rails, recess)', board, M['tray_r'], 0.35),
    ('encoder (with plugs) to the tray', M['encoder'], M['tray_r'], 0.35),
    ('encoder to the panel', M['encoder'], M['panel'], 0.9),
    ('encoder (with plugs) to the S3', M['encoder'], M['s3'], 5.0),
    ('knob to the shell', M['knob'], M['shell_b'], 0.8),
    ('collar to the tray', M['collar'], M['tray_r'], 0.2),
    ('S3 to the panel', M['s3'], M['panel'], 0.5),
    ('sensor sled to the panel', M['sled'], M['panel'], 0.5),
]
for name, a, b, need in GAPS:
    g = a.min_gap(b, 30.0)
    ok = g >= need
    bad += not ok
    print(f'  {"ok  " if ok else "FAIL"} {name}: {g:.2f} (needs {need})')

print('numbers:')
slot_lo, win_hi = B.KZ - DR.ENC_SLOT, DR.BTN_Z1 + 1.0
print(f'  end wall, tray: USB / button window top {win_hi:.1f}, encoder slot {slot_lo:.1f}..{B.KZ + DR.ENC_SLOT:.1f}: {slot_lo - win_hi:.1f} of wall between')
print(f'  encoder board face {xw - B.EB_X1:.2f} inside the tray wall ({xw + B.ENC_REC - B.EB_X1:.2f} to the recess floor); rails lap it {DR.RAIL_LAP}')
print(f'  seam screws: pad {B.SS_PAD} proud of the tray top, {DR.TRAY_CL - B.JP_CL - B.SS_PAD:.2f} under the top plate; boss {B.SS_BOSS_H} deep')
print(f'  knob axis {B.KNOB_DROP} below the top, {B.KZ:.1f} above the bottom; USB-C {DR.PORT_Z:.1f} above the bottom')
rz = [h for h in DR.S3_HOLES]
print(f'  S3 board z {DR.S3_Z0:.1f}..{DR.S3_Z0 + 44.45:.1f}; right-hand posts at z {ZC - 71:.1f} and {ZC + 71:.1f} (Ø{DR.POST_OD})')
for n in ('shell_a', 'shell_b', 'tray_l', 'tray_r', 'diff_l', 'diff_r'):
    sq, deg = P4.bed_fit(M[n], 1)
    ok = sq <= B.BED - 10
    bad += not ok
    print(f'  {"ok  " if ok else "FAIL"} {n}: fits a {sq} mm square, {(B.BED - sq) / 2:.1f} spare a side')
print('FAILED' if bad else 'all checks pass')
sys.exit(1 if bad else 0)
