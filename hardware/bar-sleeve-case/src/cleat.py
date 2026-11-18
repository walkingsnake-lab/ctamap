"""French cleat for the v5 drawer case: hang it on a wall with the louvers standing off it.

- Case cleat: bolts to the tray's back between the louver bands (2 x M3 x 10 socket or button head,
  from the wall side, threaded into the tray's bosses). Its bevel faces down and toward the wall.
- Wall cleat: screws to the wall (2 x #8 / 4 mm countersunk wood screws, or anchors). Its bevel faces up; its front face
  holds the tray's back, so the case hangs plumb with no bottom spacer.
- Both are CLEAT_T deep: the tray's back sits CLEAT_T off the wall and the rim CLEAT_T - BACKL. The two cleats fill the
  middle of the back and leave the louver bands open: air comes in at the bottom of the gap and leaves at the top.
- To hang: hold the case CLEAT_T higher than its resting spot, push it to the wall, let it drop onto the bevel.
Print the case cleat wall face down and the wall cleat FRONT face down (each narrows as it rises: no overhang at any
bevel angle, no supports), PETG.
Settings a build can change (p4.py does, Nov 17): BEVEL_DEG (45: the bevel's angle from the horizontal; 60 gives ~18 mm
of hook in the same 12 mm depth instead of 10), WALL_STOPS (blocks on the wall cleat just outside the case cleat's ends,
so the case cannot slide along it), WALL_POCKETS (the wall cleat's wall face hollowed between ribs).
Run: python3 cleat.py <outdir>   (PANEL=p25 for the P2.5)
"""
import math, os, sys
os.environ.setdefault('CASE_WALL', '3.5')
from manifold3d import Manifold, CrossSection
import drawer as DR
from case import prism_x, cyl_y, ZC, ADD
from drawer import Y1, CLEAT_T as T, CLEAT_ATT, CLEAT_ZTOP, CLEAT_ZBOT, CLEAT_SCREWS, CLEAT_HW

YW = Y1 + T                         # wall plane
ZB = CLEAT_ZTOP - CLEAT_ATT         # bevel's top at the tray; the bevel drops 45 deg toward the wall
TIP = 1.0                           # knife edges cut back (measured toward the wall)
WALL_H = 45.0                       # wall cleat's front face, at most
ZW0 = max(CLEAT_ZBOT, ZB - WALL_H)  # wall cleat's bottom
BEVEL_DEG = 45.0                    # the bevel's angle from the horizontal
WALL_STOPS = None                   # (clearance each side, length, lead-in): blocks that fill the V beyond the case cleat's ends
WALL_POCKETS = None                 # (depth, rib): pockets in the wall cleat's wall face


def drop():
    """how far the bevel falls across the cleat's depth T"""
    return T * math.tan(math.radians(BEVEL_DEG))


def tip_z():
    return TIP * math.tan(math.radians(BEVEL_DEG))


def hook():
    """how far the case must be lifted to come off"""
    return drop() - 2 * tip_z()
CBORE_D, CBORE_LEFT = 6.6, 4.0      # case cleat: counterbore for the M3 head from the wall side, 4 mm of cleat left under it
WS_D, WS_HEAD = 4.5, 9.0            # wall screws: #8 / 4 mm countersunk


def poly(pts):
    cs = CrossSection([pts])
    return cs if cs.area() > 0 else CrossSection([pts[::-1]])


def case_cleat():
    hw = CLEAT_HW
    c = prism_x(poly([(Y1, ZB), (Y1, CLEAT_ZTOP), (YW, CLEAT_ZTOP), (YW, ZB - drop() + tip_z()), (YW - TIP, ZB - drop() + tip_z())]), -hw, hw)
    cuts = []
    for x, z in CLEAT_SCREWS:
        cuts.append(cyl_y(x, z, Y1 - 1, YW + 1, 3.4, 24))
        cuts.append(cyl_y(x, z, Y1 + CBORE_LEFT, YW + 1, CBORE_D, 32))
    return c - Manifold.batch_boolean(cuts, ADD)


def wall_screws(xs=None):
    zs = (ZW0 + ZB - drop()) / 2
    xs = [sx * (CLEAT_HW - 15.0) for sx in (-1, 1)] if xs is None else xs
    return [(x, zs) for x in xs]


def wall_cleat(hw=None, xs=None):
    """hw: half length (default: the case cleat's, less 0.5); xs: the wall screws' x (default: 15 mm in from each end).
    bar128.py makes one long wall cleat for its two case cleats."""
    hw = CLEAT_HW - 0.5 if hw is None else hw
    ztop = ZB - tip_z()
    c = prism_x(poly([(YW, ZW0), (YW, ZB - drop()), (Y1 + TIP, ztop), (Y1, ztop), (Y1, ZW0)]), -hw, hw)
    if WALL_STOPS:
        cl, ln, lead = WALL_STOPS
        v = poly([(YW, ZB - drop() - 0.01), (Y1 + TIP - 0.01, ztop), (YW, ztop)])           # the V above the bevel, to the cleat's top
        for sx in (-1, 1):
            x0 = CLEAT_HW + cl
            blk = prism_x(v, x0, min(x0 + ln, hw)) if sx > 0 else prism_x(v, -min(x0 + ln, hw), -x0)
            # lead-in: the stop's inner face leans away from the case cleat toward the top, so the cleat centres as it drops
            wedge = Manifold.extrude(poly([(0, 0), (lead, 0), (0, -lead)]), 3 * T).rotate([90, 0, 0]).translate([x0, YW + T, ztop + 0.01])
            c = c + (blk - (wedge if sx > 0 else wedge.mirror([1, 0, 0])))
    cuts = []
    if WALL_POCKETS:
        dp, rib = WALL_POCKETS
        za, zb_ = ZW0 + rib, ZB - drop() - rib
        edges = sorted([-hw] + [x for x, _ in wall_screws(xs)] + [hw])
        keep = [(x - WS_HEAD / 2 - rib, x + WS_HEAD / 2 + rib) for x, _ in wall_screws(xs)]          # solid round each screw
        x = -hw + rib
        spans = []
        for k0, k1 in keep + [(hw - rib, hw)]:
            if k0 - x > 12:
                n = max(1, round((k0 - x) / 40.0))                                            # a rib about every 40 mm
                w = (k0 - x - (n - 1) * rib) / n
                spans += [(x + i * (w + rib), x + i * (w + rib) + w) for i in range(n)]
            x = k1
        from case import box as _box
        for a, b in spans:
            if zb_ - za > 6:
                cuts.append(_box(a, b, YW - dp, YW + 1, za, zb_))
    for x, z in wall_screws(xs):
        cuts.append(cyl_y(x, z, Y1 - 1, YW + 1, WS_D, 32))
        cs = (WS_HEAD - WS_D) / 2                                       # 90-degree countersink at the front face
        cuts.append(Manifold.cylinder(cs + 0.01, WS_HEAD / 2, WS_D / 2, 48).rotate([-90, 0, 0]).translate([x, Y1 - 0.01, z]))
    return c - Manifold.batch_boolean(cuts, ADD)


if __name__ == '__main__':
    import numpy as np, trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])       # wall face (y = YW) on the bed
    up = trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])           # front face (y = Y1) on the bed
    for m, name, rot in ((case_cleat(), 'bar-cleat-case.stl', down), (wall_cleat(), 'bar-cleat-wall.stl', up)):
        me = m.to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
        t.apply_transform(rot); t.apply_translation([0, 0, -t.bounds[0][2]]); t.export(f'{out}/{name}')
        print(name, t.is_watertight, np.round(t.extents, 1).tolist())
    print(dict(case_cleat_z=(round(ZB - T - ZC, 1), round(CLEAT_ZTOP - ZC, 1)), wall_cleat_z=(round(ZW0 - ZC, 1), round(ZB - ZC, 1)),
               half_len=round(CLEAT_HW, 1), screws=[(x, round(z - ZC, 1)) for x, z in CLEAT_SCREWS],
               wall_screws=[(x, round(z - ZC, 1)) for x, z in wall_screws()], rim_off_wall=T - DR.BACKL if hasattr(DR, 'BACKL') else None))
