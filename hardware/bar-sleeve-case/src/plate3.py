"""Back plate v3: bolted to the panel, solid (no pills), fixed nut and S3 screw holes.

Why (v2 problems found on the first build):
- The plate rocked: the hold-down posts' foam pushed it outward, the top tongues sit in grooves open to the
  back (they stop up/down, not in/out), so only the two bottom screws held it and the top swung out.
- The bottom M3 nuts sat in 9 mm slots open toward the panel, so a nut slid off the screw axis and the screw spun.
- The S3's M2.5 machine screws had to cut their own thread in a Ø2.2 pilot (printed ~Ø2.05) with no lead-in.

v3:
- Three standoffs screw the plate to the panel's own brass M3 inserts (M3 x 8 down a Ø6.4 tube from the
  outer face, no washer). The plate is rigidly parallel to the panel; the foam posts are gone. Three points set the plane
  exactly; the fourth left insert sits under the S3. Positions are photo estimates (±1 mm): panel_template() checks them before the plate
  is printed (correct STANDOFFS if needed); the feet's Ø3.6 holes then allow ±0.3 mm.
- Bottom screws now only stop the module sliding out. The boss hole is a y-slot and the nut floats ±0.6 mm along
  the slot, so the stack error between frame, panel and plate is taken up there: push the module forward until
  the diffuser seats on the frame, then tighten. The nut slot is closed at the back, and its mouth narrows to
  5.3 mm so a pushed-in nut snaps past it and can't walk back out.
- S3 posts: Ø2.4 pilot with a 0.5 mm 45-deg lead-in.
- Tray: the plate fills the bore (0.2 mm clearance all round, no edge gaps) with a 6 mm inward skirt, so its
  edge is stiff and the shell locates it along the whole outline (v2's open gaps left the edges flexing).
- 2 mm plate (as v2); a 4th standoff at the panel's bottom-centre insert ties the middle of the plate to the panel.
- Power cable: the stock cable's extra (~45 cm plus its spare plug) is folded and tied into its own bundle
  (~50 x 28 x 20 mm) and placed wherever it fits behind the panel; two optional tie-down loops above the ribbon, beside the power socket.
  Bolted to the panel, any push from the bundle is internal (taken by the standoff screws), not on the shell.
- Ribbon bay: a 1.2 mm pocket behind the S3's IDC plug gives the ribbon's fold ~5.9 mm instead of 4.7.
- Venting: 45-deg louver bands, inlet along the bottom and outlet along the top (a chimney ~85 mm tall). The slots
  rise going inward, so from eye level or above you see a blade, not the inside. ~1,300 mm2 in, ~1,000 out
  (face area). LOUVERS = False seals it; PILLS = True brings the v2 pills back.
- The shell is unchanged (same tongue grooves, same drilled screw holes).
Run: python3 plate3.py <outdir>
"""
import math, sys
import numpy as np
from manifold3d import Manifold, CrossSection
import case2 as V
from case import *

PILLS = False
GAP3 = 0.0                                   # plate fills the bore (0.2 mm clearance all round); no edge gaps
PLATE_T3 = 2.0                               # 2 mm (as v2): bolted to the panel, it doesn't need more; 3 mm cost ~25% more print time
SKIRT_D, SKIRT_T = 6.0, 2.0                  # inward perimeter skirt: stiffens the edge, bears on the bore all round
SKIRT_NOTCH = 16.0                           # top skirt cut back around the encoder (x within +/- this)
LOUVERS = True
LV_H, LV_PITCH, LV_DEPTH = 2.5, 4.5, 5.0     # slot height on the outer face, row pitch, band depth (slots rise 45 deg inward)
# louver rows: (outer-face z centre, [x segments]); bottom = inlet, top = outlet; segments dodge the bosses, standoffs,
# S3 light tube and post ribs, keyhole cups and the encoder
LV_BOTTOM = [(7.5, [(-84, -49), (-31, 31), (49, 96)]), (12.0, [(-84, -49), (-31, 31), (49, 96)]),
             (16.5, [(-84, -49), (-31, 31), (49, 96)]), (21.0, [(-31, 31), (49, 80)])]
for _row in LV_BOTTOM:                       # split the middle segment around the bottom-centre standoff
    _row[1][:] = [seg for a, b in _row[1] for seg in (((a, -2.0), (16.0, b)) if a < 7 < b else ((a, b),))]
LV_TOP = [(97.0, [(-98, -49), (-31, -17), (17, 31), (49, 98)]), (92.5, [(-98, -49), (-31, -17), (17, 31), (49, 98)]),
          (88.0, [(-80, -49), (-31, -17), (17, 31), (49, 80)]), (83.5, [(-80, -49), (49, 80)])]
# panel inserts used (case x, z - ZC), from the panel-back photo (DESIGN-HISTORY, panel in normal orientation, PI IN on the right
# seen from the front); the 4th corner (-88, -26) is under the S3. All six estimates go on the template.
INSERTS_ALL = [(-88.0, 31.0), (88.0, 31.0), (-88.0, -26.0), (88.0, -26.0), (-14.0, 38.0), (7.0, -36.0)]
STANDOFFS = [(-88.0, 31.0), (88.0, 31.0), (88.0, -26.0), (7.0, -36.0)]   # 4th: bottom-centre insert, ties the plate's middle
# power cable: the stock cable (~50 cm, often 4 wires and a spare plug) is folded and tied into its own bundle
# (~50 x 28 x 20 mm) and placed wherever it fits; nothing prescribes its spot. Two optional tie-down loops in the open
# areas (x, z0, z1): a strap threads through a loop (tunnel along z) and round the bundle
TIE_LOOPS = [(-14.0, 64.0, 82.0), (14.0, 64.0, 82.0)]   # two, above the ribbon beside the power socket
STRAP_W, STRAP_H = 14.0, 2.2
# room for the ribbon's fold behind the S3's IDC plug: pocket into the 3 mm plate
BAY = (-54.0, -28.0, 20.0, 62.0)           # x0, x1, z0, z1
SO_OD, SO_BORE, SO_FLOOR, SO_HOLE = 9.0, 6.4, 3.0, 3.6   # no washer: the M3 button head (Ø5.7) seats on the floor
FOOT_Y = PANEL_BACK                          # foot face on the panel's insert bosses
NUT_W, NUT_MOUTH, NUT_H, NUT_FLOAT = 5.7, 5.3, 2.7, 0.6
NUT_CORNER = 5.5 / math.cos(math.pi / 6) / 2  # 3.175: nut centre to corner (corners point along the slot)
S3_PILOT, S3_LEAD = 2.4, 0.5


def standoff(x, z, y0):
    zc = ZC + z
    post = cyl_y(x, zc, FOOT_Y, y0 + 0.01, SO_OD, 48)
    post = post - cyl_y(x, zc, FOOT_Y + SO_FLOOR, D, SO_BORE, 48)         # tube for the screw head and the key
    post = post - cyl_y(x, zc, FOOT_Y - 1, FOOT_Y + SO_FLOOR + 0.1, SO_HOLE, 32)
    return post


def back_plate3(window=True):
    y1 = D - BACKL + (PLATE_T3 - PLATE_T)
    y0 = y1 - PLATE_T3
    hz = BORE_HZ - 0.2 - GAP3
    p = prism_y(rr_cs(BORE_HX - 0.2, hz, BORE_R - 0.2), y0, y1)
    for sx in (-1, 1):                                                   # tongues reach up across the top gap (as v2)
        p = p + box(sx * TONGUE_X - TONGUE_W / 2, sx * TONGUE_X + TONGUE_W / 2, y0, y1, ZC + hz - 0.5, ZC + BORE_HZ + 1.0)
    # perimeter skirt
    ring = rr_cs(BORE_HX - 0.2, hz, BORE_R - 0.2) - rr_cs(BORE_HX - 0.2 - SKIRT_T, hz - SKIRT_T, BORE_R - 0.2 - SKIRT_T)
    skirt = prism_y(ring, y0 - SKIRT_D, y0 + 0.01) - box(-SKIRT_NOTCH, SKIRT_NOTCH, y0 - SKIRT_D - 1, y0 - 0.5, ZC, ZC + 60)
    p = p + skirt
    if LOUVERS:
        cuts = []
        for rows in (LV_BOTTOM, LV_TOP):
            for zc, segs in rows:
                for xa, xb in segs:
                    p = p + box(xa - 2.0, xb + 2.0, y1 - LV_DEPTH, y0 + 0.01, zc - LV_H / 2 - 1.5, zc + LV_H / 2 + LV_DEPTH + 1.5)
                    r = LV_H / 2
                    def slab(y, dz):
                        cs = CrossSection.square([xb - xa - 2 * r, 0.01], center=True).offset(r, JT, circular_segments=16).translate([(xa + xb) / 2, zc + dz])
                        return prism_y(cs, y, y + 0.01)
                    cuts.append(Manifold.batch_hull([slab(y1 + 0.5, -0.5), slab(y1 - LV_DEPTH - 0.5, LV_DEPTH + 0.5)]))
        louver_cuts = Manifold.batch_boolean(cuts, ADD)
    # bottom bosses: y-slot screw hole, closed nut slot with a narrowed mouth
    nut_end = SCREW_Y + NUT_FLOAT + NUT_CORNER                           # nut centre can reach SCREW_Y + 0.6
    mouth_end = SCREW_Y - NUT_FLOAT - NUT_CORNER                         # and SCREW_Y - 0.6 before it meets the mouth
    for sx in (-1, 1):
        x = sx * SCREW_X
        yb = SCREW_Y - 4.5
        b = box(x - 5, x + 5, yb, y1, WALL + 0.2, WALL + 12.0)
        slot = CrossSection.square([0.01, 2 * NUT_FLOAT], center=True).offset(1.75, JT, circular_segments=24).translate([x, SCREW_Y])
        b = b - Manifold.extrude(slot, 20).translate([0, 0, WALL - 1])
        nz0 = WALL + 4.0
        b = b - box(x - NUT_W / 2, x + NUT_W / 2, mouth_end, nut_end, nz0, nz0 + NUT_H)
        b = b - box(x - NUT_MOUTH / 2, x + NUT_MOUTH / 2, yb - 1, mouth_end + 0.01, nz0, nz0 + NUT_H)
        # lead-in on the mouth so the nut can be pushed in with a screwdriver tip
        b = b - Manifold.batch_hull([box(x - NUT_W / 2 - 0.4, x + NUT_W / 2 + 0.4, yb - 1, yb, nz0 - 0.2, nz0 + NUT_H + 0.2),
                                     box(x - NUT_MOUTH / 2, x + NUT_MOUTH / 2, yb + 0.6, yb + 0.61, nz0, nz0 + NUT_H)])
        p = p + b
    for x, z in STANDOFFS:
        p = p + standoff(x, z, y0)
        p = p - cyl_y(x, ZC + z, y0 - 1, y1 + 1, SO_BORE, 48)                # tube opens on the outer face
    for sx in (-1, 1):                                                   # keyhole cups and keyholes (as v2)
        x = sx * KEY_X
        p = p + box(x - 7, x + 7, y0 - 6, y0 + 0.01, KEY_Z - 7, KEY_Z + 15)
        p = p - box(x - 5.5, x + 5.5, y0 - 4.5, y0 + 0.02, KEY_Z - 5.5, KEY_Z + 13.5)
        kh = CrossSection.circle(4.0, 48).translate([x, KEY_Z]) + CrossSection.square([4.2, 10.0]).translate([x - 2.1, KEY_Z])
        p = p - prism_y(kh, y0 - 1, y1 + 1)
    if PILLS:
        vents = []
        for x in V.PILL_XS:
            st = CrossSection.square([0.01, (V.PILL_Z1 - V.PILL_Z0) - 4.4], center=True).offset(2.2, JT, circular_segments=SEG).translate([x, (V.PILL_Z0 + V.PILL_Z1) / 2])
            vents.append(prism_y(st, y0 - 1, y1 + 1))
        p = p - Manifold.batch_boolean(vents, ADD)
    if LOUVERS:
        p = p - louver_cuts
    # tie-down loops (open both ends)
    for lx, lz0, lz1 in TIE_LOOPS:
        lp = box(lx - STRAP_W / 2 - 2, lx + STRAP_W / 2 + 2, y0 - STRAP_H - 1.8, y0 + 0.01, lz0, lz1)
        lp = lp - box(lx - STRAP_W / 2, lx + STRAP_W / 2, y0 - STRAP_H, y0 + 0.02, lz0 - 1, lz1 + 1)
        p = p + lp
    # ribbon bay behind the S3's plug
    bx0, bx1, bz0, bz1 = BAY
    p = p - box(bx0, bx1, y0 - 1, y1 - 0.8, bz0, bz1)
    # status light tube and window (as v2)
    tube_end = PCB_Y0 + 1.6 + 1.5
    p = p + cyl_y(V.S3_NEO_X, V.S3_NEO_Z, tube_end, y0 + 0.01, 7.0, 48)
    p = p - cyl_y(V.S3_NEO_X, V.S3_NEO_Z, tube_end - 1, y0 + 0.5, 4.5, 48)
    if window == 'open':                         # one colour, opaque: the tube opens in a Ø3 hole, 0.5 mm chamfer outside
        p = p - cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y0 - 1, y1 + 1, 3.0, 32)
        p = p - Manifold.cylinder(0.51, 1.5, 2.0, 32).rotate([-90, 0, 0]).translate([V.S3_NEO_X, y1 - 0.5, V.S3_NEO_Z])
        window = None
    elif window:
        p = p - cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y0 + 0.4, y1 + 1, 6.0, 48)
        window = cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y0 + 0.4, y1, 5.9, 48)
    else:
        p = p - cyl_y(V.S3_NEO_X, V.S3_NEO_Z, y0 - 1, y1 - 0.6, 4.5, 48)
        window = None
    # S3 posts: Ø2.4 pilot, 0.5 mm 45-deg lead-in at the board face
    yc = V.S3_PCB_Y + 1.6
    for hx, hz_ in V.S3_HOLES:
        p = p + cyl_y(hx, hz_, yc, y0 + 0.01, 5.0, 32)
        p = p - cyl_y(hx, hz_, yc - 1, yc + 8.0, S3_PILOT, 24)
        p = p - Manifold.cylinder(S3_LEAD + 0.01, S3_PILOT / 2 + S3_LEAD, S3_PILOT / 2, 24).rotate([-90, 0, 0]).translate([hx, yc - 0.01, hz_])
    (x1, z1), (x2, z2), (x3, z3), (x4, z4) = V.S3_HOLES
    for (ax, az), (bx_, bz) in (((x1, z1), (x2, z2)), ((x4, z4), (x3, z3)), ((x1, z1), (x4, z4)), ((x2, z2), (x3, z3))):
        p = p + box(min(ax, bx_) - 1.2, max(ax, bx_) + 1.2, y0 - 7.0, y0 + 0.01, min(az, bz) - 1.2, max(az, bz) + 1.2)
    # Boot guide tube (as v2)
    btop = yc + 1.9
    p = p + cyl_y(V.S3_BOOT_X, V.S3_BOOT_Z, btop + 1.0, y0 + 0.01, 5.0, 32)
    p = p - cyl_y(V.S3_BOOT_X, V.S3_BOOT_Z, btop + 0.5, y1 + 1, 2.6, 24)
    p = p - Manifold.cylinder(1.0, 1.3, 2.4, 32).rotate([-90, 0, 0]).translate([V.S3_BOOT_X, y1 - 1.0 + 0.001, V.S3_BOOT_Z])
    # ribbon hooks (as v2)
    RZ, RW = ZC - 5.0, 20.3
    for hx in (-22.5, 22.5):
        for side in (-1, 1):
            zp = RZ + side * (RW / 2 + 1.5)
            p = p + box(hx - 2, hx + 2, y0 - 4.5, y0 + 0.01, zp - 1.0, zp + 1.0)
            p = p + Manifold.batch_hull([box(hx - 2, hx + 2, y0 - 4.5, y0 - 1.5, zp - 1.0, zp + 1.0),
                                         box(hx - 2, hx + 2, y0 - 4.5, y0 - 4.49, zp - side * 3.0 - 0.01, zp - side * 3.0 + 0.01)])
    return p, window


def panel_template():
    """Flat check piece laid on the panel's back (print it panel side down; that face goes onto the panel).
    Rim on the panel outline, a Ø3.4 hole at every insert estimate inside a Ø11 ring (the standoff foot),
    and an arrow tab on the PI IN side (case +x). If an M3 screw drops into each insert through the template,
    the estimates hold; otherwise measure the offset at each hole."""
    t = 1.2
    y0, y1 = PANEL_BACK, PANEL_BACK + t
    hx, hz = PANEL_X, PANEL_Z
    rim = box(-hx, hx, y0, y1, ZC - hz, ZC + hz) - box(-hx + 5, hx - 5, y0 - 1, y1 + 1, ZC - hz + 5, ZC + hz - 5)
    parts = [rim]
    for x, z in INSERTS_ALL:
        zc = ZC + z
        parts.append(cyl_y(x, zc, y0, y1, 11.0, 48))
        # spoke to the nearest rim edge (horizontal)
        ex = hx - 2.5 if x > 0 else -hx + 2.5
        parts.append(box(min(x, ex), max(x, ex), y0, y1, zc - 1.5, zc + 1.5))
    parts.append(box(hx, hx + 8, y0, y1, ZC - 4, ZC + 4))
    m = Manifold.batch_boolean(parts, ADD)
    m = m + Manifold.batch_hull([box(hx + 8, hx + 8.01, y0, y1, ZC - 7, ZC + 7), box(hx + 15, hx + 15.01, y0, y1, ZC - 0.01, ZC + 0.01)])
    for x, z in INSERTS_ALL:
        zc = ZC + z
        m = m - cyl_y(x, zc, y0 - 1, y1 + 1, 3.4, 32)
        m = m - (cyl_y(x, zc, y0 - 1, y1 + 1, 10.0, 48) - cyl_y(x, zc, y0 - 1, y1 + 1, 9.2, 48)).translate([0, t * 0.6, 0])   # ring groove marks the foot
    return m


def coupon_s3_pilots():
    """Three Ø5 posts, 10 mm tall, pilots Ø2.3 / 2.4 / 2.5 with the lead-in, on a 2 mm base. Try an M2.5 x 8 in each."""
    base = Manifold.cube([30, 10, 2])
    m = base
    for i, d in enumerate((2.3, 2.4, 2.5)):
        x = 5 + i * 10
        post = Manifold.cylinder(12, 2.5, 2.5, 32).translate([x, 5, 0])
        post = post - Manifold.cylinder(10, d / 2, d / 2, 24).translate([x, 5, 2.01])
        post = post - Manifold.cylinder(S3_LEAD + 0.01, d / 2, d / 2 + S3_LEAD, 24).translate([x, 5, 12 - S3_LEAD])
        m = m + post
        for k in range(i + 1):                                           # 1, 2, 3 notches in the base mark the sizes
            m = m - Manifold.cube([1, 1.2, 3]).translate([x - 2 + k * 1.6, -0.01, -0.5])
    return m


def boot_key3():
    """v2 key, 1 mm longer for the 3 mm plate"""
    reach = (D - BACKL + (PLATE_T3 - PLATE_T)) - (PCB_Y0 + 1.6 + 1.9) + 0.6
    rod = Manifold.cube([reach, 1.6, 1.6]).rotate([45, 0, 0]).translate([0, 0, 1.13])
    grip = Manifold.cube([2.0, 10.0, 2.26]).translate([-2.0, -5.0, 0])
    return rod + grip


def to_bed_back_down(m):
    import trimesh
    me = m.to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))     # +y -> -z: outer face on the bed
    return t


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    p, _ = back_plate3(window='open')
    t = to_bed_back_down(p); t.apply_translation([0, 0, -t.bounds[0][2]]); t.export(f'{out}/bar-backplate-v3.stl')
    print('plate', t.is_watertight, np.round(t.extents, 1).tolist())
    # template: panel-side face (y = PANEL_BACK) on the bed
    me = panel_template().to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])); t.apply_translation([0, 0, -t.bounds[0][2]])
    t.export(f'{out}/check-panel-insert-template.stl'); print('template', t.is_watertight, np.round(t.extents, 1).tolist())
    me = coupon_s3_pilots().to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.export(f'{out}/coupon-v4-s3-pilots.stl'); print('pilot coupon', t.is_watertight)
    # boss coupon: the plate's bottom-left corner around one boss; screw it through the real shell's floor hole
    region = box(-SCREW_X - 9, -SCREW_X + 9, 40, D, 0, 18)
    c = to_bed_back_down(p ^ region); c.apply_translation([0, 0, -c.bounds[0][2]])
    c.export(f'{out}/coupon-v4-plate-boss.stl'); print('boss coupon', c.is_watertight, np.round(c.extents, 1).tolist())
