"""Fit checks for the v5 drawer, against the model: screws, posts, encoder rails, sensor sled, louvers, status window.
Run: python3 check_v5.py            (P3)
     PANEL=p25 python3 check_v5.py  (P2.5)
     BASE=<old tray .stl, case frame> python3 check_v5.py   also compares the tray's back face with that tray
Prints one line per check; volumes are overlaps in mm^3 (0 = clear)."""
import math, os
os.environ.setdefault('CASE_WALL', '3.5')
import numpy as np
from manifold3d import Manifold, Mesh
import case as C
import case2 as V
import drawer as DR
import sensor as SN
import collar as CO
import cleat as CL
from case import box, cyl_z, cyl_y, KY

DR.configure_shell()
V.BACKDOWN = True
tray, shell = DR.tray(), V.shell2()
res = []


def ov(a, b):
    return round((a ^ b).volume(), 3)


def rep(name, val, ok=True):
    res.append((name, val, ok))
    print(('OK  ' if ok else 'FAIL'), name, val)


# ---- bottom screws (M3 x 10 from below, threaded into the tray)
zf = DR.tray_floor_z()
SEAT = DR.POST_LONG                                           # seated, the tray sits this far back of the model (posts long)
rep('bottom screws land in the middle of the shell holes when seated (mm off)', round(DR.BOT_Y + SEAT - C.SCREW_Y, 3), abs(DR.BOT_Y + SEAT - C.SCREW_Y) < 1e-6)
for dy in (-DR.SCREW_FLOAT, 0, DR.SCREW_FLOAT):                  # the tray floats in y against the shell's stadium holes
    scr = [cyl_z(x, C.SCREW_Y + dy, 1.0, 11.0, 3.0, 32) for x in DR.bottom_xs()]
    head = [cyl_z(x, C.SCREW_Y + dy, -1.0, 1.0, 5.7, 32) for x in DR.bottom_xs()]
    v = sum(ov(s, shell) for s in scr) + sum(ov(h, shell) for h in head)
    rep(f'bottom M3 x 10 at tray float {dy:+.1f}: screw + head vs shell', v, v < 1e-3)
x = DR.bottom_xs()[1]
ring = cyl_z(x, C.SCREW_Y + DR.SCREW_FLOAT, 1.0, 1.05, 5.7, 64)
rep('bottom screw head bearing on the counterbore floor at full float (mm^2; 18 centred on a round hole)', round(ov(ring, shell) / 0.05, 1), ov(ring, shell) > 0)
core = cyl_z(x, DR.BOT_Y, zf, 11.0, 2.0, 24)
rep(f'bottom pilot (Ø{DR.TAP_D}) open for the M3 core', ov(core, tray), ov(core, tray) < 1e-3)
bite = cyl_z(x, DR.BOT_Y, zf, 11.0, 3.0, 32) ^ tray
bb = bite.bounding_box()
rep('bottom thread engagement in PETG (mm)', round(bb[5] - max(bb[2], zf + DR.TAP_LEAD), 2), bb[5] - bb[2] >= 6.0)
rep('bottom pilot runs past the screw tip (mm)', round(DR.BOSS_TOP - 0.8 - 11.0, 2), DR.BOSS_TOP - 0.8 - 11.0 >= 0.3)

# ---- cleat screws (M3 x 10 from the wall side through the case cleat's 4 mm, threaded into the tray's bosses)
cc = CL.case_cleat()
for cx, cz in DR.CLEAT_SCREWS:
    head_y = DR.Y1 + CL.CBORE_LEFT
    scr = cyl_y(cx, cz, head_y - 10.0, head_y, 2.0, 24)               # the core
    rep(f'cleat screw at x {cx:+.0f}: core vs tray and cleat', ov(scr, tray) + ov(scr, cc), ov(scr, tray) + ov(scr, cc) < 1e-3)
    bite = cyl_y(cx, cz, head_y - 10.0, head_y, 3.0, 32) ^ tray
    bb = bite.bounding_box()
    rep(f'cleat thread engagement in PETG (mm), pilot Ø{DR.TAP_D_V}', round(bb[4] - DR.TAP_LEAD - bb[1], 2), bb[4] - bb[1] >= 5.0)
    rep('cleat screw tip inside the boss (mm short of its inner end)', round((head_y - 10.0) - (DR.Y0 - DR.CB_H), 2), head_y - 10.0 >= DR.Y0 - DR.CB_H)
s3 = DR.s3_envelope()
near = Manifold.batch_boolean([box(cx - 8, cx + 8, DR.Y0 - DR.CB_H - 1, DR.Y1, cz - 8, cz + 8) for cx, cz in DR.CLEAT_SCREWS], C.ADD)
rep('cleat bosses (now 4.5 tall) vs S3', ov(tray ^ near, s3), ov(tray ^ near, s3) < 1e-3)

# ---- posts
rep('post feet in front of the panel back at nominal (mm; the tray edge then stands this far off the flange, harmless)',
    round(C.PANEL_BACK - DR.P3.FOOT_Y, 2), C.PANEL_BACK - DR.P3.FOOT_Y > 0)

# ---- post screws (M3 x 8 flanged button head, floating on the flat floor)
fl = 6.9
worst_core, worst_tube, min_bear = 0.0, 0.0, 1e9
for x, z in DR.CORNERS:
    zc = C.ZC + z
    for a in range(0, 360, 30):
        dx, dz = 0.7 * math.cos(math.radians(a)), 0.7 * math.sin(math.radians(a))
        y_seat = DR.P3.FOOT_Y + DR.P3.SO_FLOOR
        core = cyl_y(x + dx, zc + dz, y_seat - 8.0, y_seat, 3.0, 24) ^ box(-500, 500, y_seat - 8.0, y_seat - 0.01, -500, 500)
        flange = cyl_y(x + dx, zc + dz, y_seat + 0.01, y_seat + 1.6, fl, 48)
        worst_core = max(worst_core, ov(core, tray)); worst_tube = max(worst_tube, ov(flange, tray))
    ring = cyl_y(x + 0.7, zc, y_seat - 0.1, y_seat - 0.05, fl, 64)          # just under the seat face (coplanar slices read short)
    min_bear = min(min_bear, ov(ring, tray) / 0.05)
rep('post screw core through the floor at 0.7 mm off centre, any direction (overlap)', worst_core, worst_core < 1e-3)
rep('post screw flange (Ø6.9) clear of the tube wall at 0.7 off centre', worst_tube, worst_tube < 1e-3)
rep('post screw flange bearing on the floor at 0.7 off centre (mm^2)', round(min_bear, 1), min_bear > 10)
posts = Manifold.batch_boolean([DR.P3.standoff(x, z, DR.Y0) for x, z in DR.CORNERS], C.ADD)
rep('posts (Ø11) vs S3', ov(posts, s3), ov(posts, s3) < 1e-3)

# ---- encoder rails
enc = SN.envelopes()
hw = 12.7
plugs_e = Manifold.batch_boolean([box(sx * 7.7, sx * (hw + 7.0), KY - 3.0, KY + 3.0, SN.EB_BOT - 2.96, SN.EB_BOT) for sx in (-1, 1)], C.ADD)
encm = enc['enc_pcb'] + enc['enc_body'] + enc['enc_qt'] + enc['enc_pins'] + plugs_e    # with its QT plugs, out past the edges
rails_bot = SN.EB_TOP - DR.RAIL_LAP
rep('rails clear the encoder QT plugs by (mm)', round(rails_bot - SN.EB_BOT, 2), rails_bot - SN.EB_BOT >= 0.7)
rep('encoder (board, body, sockets, pins) vs tray, seated', ov(encm, tray), ov(encm, tray) < 1e-3)
worst = max(ov(encm, tray.translate([0, dy, 0])) for dy in np.arange(0, 56, 2.0))
rep('tray slides in past the encoder (0-54 mm out)', worst, worst < 1e-3)
pcb = enc['enc_pcb']


def turned(a):
    return pcb.translate([0, -KY, 0]).rotate([0, 0, a]).translate([0, KY, 0])


rails = DR.enc_rails()
stop = next(a / 10 for a in range(0, 200) if ov(turned(a / 10), rails) > 0.01)
panel = box(-200, 200, C.PANEL_BACK - 15, C.PANEL_BACK, -200, 200)
hit = next((a / 10 for a in range(0, 300) if ov(turned(a / 10), panel) > 0.01), None)
rep(f'board turning about the shaft stops on the rails at (deg); it would reach the panel at {hit}', stop, hit is None or stop < hit)
worst = max(ov(turned(2.0), tray.translate([0, dy, 0])) for dy in np.arange(6, 56, 2.0))
rep('tray still slides in with the board turned 2 deg, rails clear until the lead-in (mm^3 outside the last 6 mm)', worst, worst < 1e-3)

# ---- sensor sled (optional)
sl = DR.sled()
env = DR.sensor_envelope()
plugs = DR.sensor_plugs()
rep('sled seated vs tray', ov(sl, tray), ov(sl, tray) < 1e-3)
rep('sensor board, sockets, chip, heads vs tray', ov(env, tray), ov(env, tray) < 1e-3)
rep('QT plugs vs tray (seated)', ov(plugs, tray), ov(plugs, tray) < 1e-3)
assy = sl + env + plugs
zs0, zs1 = DR.sled_z()
piv_y, piv_z = DR.HOOK_FRONT + DR.SLED_GRIP - 0.6, (zs0 + zs1) / 2


def pose(m, th, dy=0.0, dz=0.0):
    return m.translate([0, -piv_y, -piv_z]).rotate([th, 0, 0]).translate([0, piv_y + dy, piv_z + dz])


sweep = {th: ov(pose(assy, th), tray) for th in range(0, 25, 2)}
th_ok = max([th for th in sweep if all(sweep[t] < 1e-3 for t in sweep if t <= th)])
rep('sled swing clear from (deg) to seated', th_ok, th_ok >= 10)
a = math.radians(10)
entry = max(ov(pose(assy, 10, -d * math.cos(a), -d * math.sin(a)), tray) for d in np.arange(0, 6.01, 0.25))
rep('sled tabs slide into the hooks at 10 deg', entry, entry < 1e-3)
rep('sled vs encoder, S3, rails', ov(sl, encm) + ov(sl, s3) + ov(sl, rails), ov(sl, encm) + ov(sl, s3) + ov(sl, rails) < 1e-3)
sx, sy = DR.SLED_SCREW
zo = DR._zw() + DR.TRAY_WT
rep('front screw head under the tray top (mm)', round(DR.SLED_CB_DEPTH - 1.6, 2), DR.SLED_CB_DEPTH - 1.6 >= 0.1)

# ---- louvers


def louver_area(t, y):
    zw = DR._zw()
    slab = box(-C.HW, C.HW, y, y + 0.05, zw - 20, zw)
    full = box(-(C.BORE_HX - DR.TRAY_CL - DR.TRAY_WT), C.BORE_HX - DR.TRAY_CL - DR.TRAY_WT, y, y + 0.05, zw - 20, zw).volume() / 0.05
    return full - (t ^ slab).volume() / 0.05


base = os.environ.get('BASE')
if base:
    import trimesh
    bt = trimesh.load(base)
    old = Manifold(Mesh(vert_properties=np.asarray(bt.vertices, np.float32), tri_verts=np.asarray(bt.faces, np.uint32)))
    a0, a1 = louver_area(old, DR.Y1 - DR.LV_DEPTH + 0.6), louver_area(tray, DR.Y1 - DR.LV_DEPTH + 0.6)
    rep(f'top louver band open through: {a0:.0f} -> {a1:.0f} mm^2 ({100 * (a0 - a1) / a0:.1f}% less)', round(a1))
    back = box(-500, 500, DR.Y1 - 0.6, 500, -500, 500) - Manifold.batch_boolean(
        [cyl_y(cx, cz, DR.Y1 - 1, DR.Y1 + 1, 4.5, 32) for cx, cz in DR.CLEAT_SCREWS]     # cleat holes: Ø3.4 -> pilot + lead-in
        + [cyl_y(x, C.ZC + z, DR.Y1 - 1, DR.Y1 + 1, DR.POST_BORE + 0.6, 48) for x, z in DR.CORNERS], C.ADD)   # post tubes: Ø6.4 -> 8.6
    d = ((old ^ back) - (tray ^ back)).volume() + ((tray ^ back) - (old ^ back)).volume()
    rep('tray back face (outer 0.6 mm; cleat holes and post tube openings aside) vs the base tray (mm^3 different)', round(d, 3), d < 0.05)

# ---- status window, collar
w = DR.status_window()
rep('status window part vs tray (overlap) / fills its pocket (mm^3)', (ov(w, tray), round(w.volume(), 1)), ov(w, tray) < 1e-3)
CO.TIP_BACK = False
bush = Manifold.cylinder(7.4, 3.5, 3.5, 64).translate([0, 0, CO.DECK_BOT])
rep('collar bore vs the encoder bushing', ov(CO.collar(), bush), ov(CO.collar(), bush) < 1e-3)

print('\n', 'all OK' if all(ok for _, _, ok in res) else 'SOME FAILED')
