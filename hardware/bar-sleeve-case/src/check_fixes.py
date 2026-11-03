"""Fit checks for the Nov 3 assembly fixes (hex nut seats, sensor sled, collar bore retainer), against the model.
Run: python3 check_fixes.py            (v5 drawer, P3)
     PANEL=p4 python3 check_fixes.py   (P4: imports p4.py)
Prints one line per check; volumes are overlaps in mm^3 (0 = clear)."""
import math, os, sys
os.environ.setdefault('CASE_WALL', '3.5')
P4 = os.environ.get('PANEL') == 'p4'
if P4:
    import p4
import numpy as np
from manifold3d import Manifold
import case as C
import case2 as V
import drawer as DR
import sensor as SN
import collar as CO
from case import box, cyl_z, H, KY

DR.configure_shell()
V.BACKDOWN = True
if P4:
    tray = p4.tray_p4()
    shell = V.shell2()
else:
    tray = DR.tray()
    shell = V.shell2()
res = []


def ov(a, b):
    return round((a ^ b).volume(), 3)


def rep(name, val, ok):
    res.append((name, val, ok))
    print(('OK  ' if ok else 'FAIL'), name, val)


# ---- nuts
zin0 = C.ZC - (C.BORE_HZ - DR.TRAY_CL - DR.TRAY_WT)
band_top = zin0 + 2.5 + DR.LV_H / 2 + (DR.LV_ROWS - 1) * DR.LV_PITCH + DR.LV_H / 2 + DR.LV_DEPTH + 1.5
worst = 0.0
for x in DR.bottom_xs():
    for z in np.arange(band_top + 3, DR.nut_z0() - 0.01, -0.5):
        nut = DR.hex_z(x, C.SCREW_Y, 5.45, z, z + 2.4)          # nut drops down the chimney (5.45 flats, 2.4 thick)
        worst = max(worst, ov(nut, tray))
rep('nut drops down the chimney to the seat (5.45 nut)', worst, worst < 1e-3)
seat = [ov(DR.hex_z(x, C.SCREW_Y, 5.5, DR.nut_z0(), DR.nut_z0() + 2.4), tray) for x in DR.bottom_xs()]
rep('5.5 nut in the 5.7 seat (expect 0: the grip comes from the printed hole running small, as the cleat pockets)', max(seat), max(seat) < 1e-3)
for dy in (-DR.SCREW_FLOAT, 0, DR.SCREW_FLOAT):                 # the tray (and its nut) float against the shell
    scr = [cyl_z(x, C.SCREW_Y + dy, 1.0, 11.0, 3.0, 32) for x in DR.bottom_xs()]
    head = [cyl_z(x, C.SCREW_Y + dy, -1.0, 1.0, 5.7, 32) for x in DR.bottom_xs()]
    t_sh = sum(ov(s, shell) for s in scr) + sum(ov(h, shell) for h in head)
    t_tr = sum(ov(s.translate([0, -dy, 0]), tray) for s in scr)
    rep(f'M3 x 10 from below, tray float {dy:+.1f}: screw+head vs shell / screw vs tray', (t_sh, t_tr), t_sh < 1e-3 and t_tr < 1e-3)
# head bearing at full float: the counterbore floor under the head
for dy in (DR.SCREW_FLOAT,):
    x = DR.bottom_xs()[0]
    ring = cyl_z(x, C.SCREW_Y + dy, 1.0, 1.05, 5.7, 64)
    rep(f'head bearing on the counterbore floor at float {dy:+.1f} (mm^2 of the {math.pi * 2.85 ** 2 - math.pi * 1.5 ** 2:.0f} a centred head has on a plain hole)', round(ov(ring, shell) / 0.05, 2), ov(ring, shell) > 0)

wall = (C.SCREW_Y - DR.BOSS_FRONT) - (C.SCREW_Y - (CB := DR.CB_NUT / 2 / math.cos(math.pi / 6)) * (0.5 + math.cos(math.pi / 6)))
rep('boss wall in front of the seat peak (mm)', round(-wall, 2), -wall >= 1.5)

# ---- sensor sled
sl = DR.sled()
env = DR.sensor_envelope()
plugs = DR.sensor_plugs()
rep('sled seated vs tray', ov(sl, tray), ov(sl, tray) < 1e-3)
rep('board, sockets, chip, heads vs tray', ov(env, tray), ov(env, tray) < 1e-3)
rep('QT plugs vs tray (seated)', ov(plugs, tray), ov(plugs, tray) < 1e-3)
rep('board stack vs sled', ov(env, sl), ov(env, sl) < 1e-3)
assy = sl + env + plugs
zs0, zs1 = DR.sled_z()
piv_y, piv_z = DR.HOOK_FRONT + DR.SLED_GRIP - 0.6, (zs0 + zs1) / 2


def pose(m, th, dy=0.0, dz=0.0):
    """tilt the front down by th deg about the tab, then move"""
    return m.translate([0, -piv_y, -piv_z]).rotate([th, 0, 0]).translate([0, piv_y + dy, piv_z + dz])


# swing: tabs in the hooks, front tilted down, swung up to seated
sweep = {th: ov(pose(assy, th), tray) for th in range(0, 25, 2)}
th_ok = max([th for th in sweep if all(sweep[t] < 1e-3 for t in sweep if t <= th)])
rep(f'swing-in clear from {th_ok} deg to seated (overlap by angle: { {k: v for k, v in sweep.items() if v > 0} })', th_ok, th_ok >= 10)
# entry: at th_ok, tabs slide in along the sled's own plane from 4 mm out
TH_IN = 10                                                      # the tilt the build sheet says to use
a = math.radians(TH_IN)
entry = max(ov(pose(assy, TH_IN, -d * math.cos(a), -d * math.sin(a)), tray) for d in np.arange(0, 6.01, 0.25))
rep(f'tabs slide into the hooks at {TH_IN} deg (from 6 mm out)', entry, entry < 1e-3)
# front screw M2.5 x 6 from outside: head in the counterbore, shank through the wall into the boss
sx, sy = DR.SLED_SCREW
zo = DR._zw() + DR.TRAY_WT
seat_z = zo - DR.SLED_CB_DEPTH
head = cyl_z(sx, sy, seat_z, seat_z + 1.6, 4.7, 32)
shank = cyl_z(sx, sy, seat_z - 6.0, seat_z, 2.5, 32)
rep('front screw head below the tray top (mm)', round(zo - (seat_z + 1.6), 2), zo - (seat_z + 1.6) >= 0.1)
rep('front screw head + shank vs tray', ov(head, tray) + ov(shank, tray), ov(head, tray) + ov(shank, tray) < 1e-3)
eng = (sl ^ cyl_z(sx, sy, seat_z - 6.0, seat_z, 3.2, 32)).bounding_box()
rep('front screw engagement in the sled boss (mm)', round(eng[5] - (seat_z - 6.0), 2), eng[5] - (seat_z - 6.0) >= 4.0)
rep('front screw tip below the sled (mm, >0 = pokes out underneath, harmless)', round(zs0 - (seat_z - 6.0), 2), True)
drv = cyl_z(sx, sy, zo + 0.01, zo + 120, 5.0, 32)
rep('straight driver line down to the counterbore (tray only, on the bench)', ov(drv, tray), ov(drv, tray) < 1e-3)
web = math.hypot(sx - SN.SX, sy - SN.SY) - DR.SLED_CB_D / 2 - DR.SEN_HOLE / 2
rep('web between the counterbore and the light hole (mm)', round(web, 2), web >= 2.0)
# encoder clear of the sled (both inside the tray)
enc = SN.envelopes()
encm = enc['enc_pcb'] + enc['enc_body'] + enc['enc_qt'] + enc['enc_pins']
rep('sled vs encoder', ov(sl, encm), ov(sl, encm) < 1e-3)
if not P4:
    s3 = DR.s3_envelope()
    rep('sled vs S3', ov(sl, s3), ov(sl, s3) < 1e-3)
# louver open area in the top band, at the band's face (sled vs pillars)


def louver_area(t, y):
    zw = DR._zw()
    slab = box(-C.HW, C.HW, y, y + 0.05, zw - 20, zw)
    solid = (t ^ slab).volume() / 0.05
    full = (box(-(C.BORE_HX - DR.TRAY_CL - DR.TRAY_WT), C.BORE_HX - DR.TRAY_CL - DR.TRAY_WT, y, y + 0.05, zw - 20, zw)).volume() / 0.05
    return full - solid


sv = DR.SENSOR_MOUNT
DR.SENSOR_MOUNT = 'pillars'
t_old = p4.tray_p4() if P4 else DR.tray()
DR.SENSOR_MOUNT = sv
for where, y in (('band face', DR.Y1 - DR.LV_DEPTH + 0.6), ('back face', DR.Y1 - 0.1)):
    a_new, a_old = louver_area(tray, y), louver_area(t_old, y)
    rep(f'top louver open area at the {where}: {a_old:.0f} -> {a_new:.0f} mm^2 ({100 * (a_old - a_new) / a_old:.1f}% less)', round(a_new, 0), True)

# ---- collar retainer
CO.TIP_BACK = False
col = CO.collar()
bush = Manifold.cylinder(7.4, 3.5, 3.5, 64).translate([0, 0, CO.DECK_BOT])     # M7 bushing (major r 3.5) seated
rib_ov = ov(col, bush)
rep(f'bushing (r 3.5) into the bore ribs (crest r {CO.RET_R}): overlap mm^3, to be crushed', rib_ov, rib_ov > 0)
CO.RET_R = None
plain = ov(CO.collar(), bush)
rep('plain bore vs bushing (expect 0)', plain, plain < 1e-3)
CO.RET_R = 3.40

print('\n', 'all OK' if all(ok for _, _, ok in res) else 'SOME FAILED')
