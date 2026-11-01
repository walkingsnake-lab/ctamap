"""French cleat for the v5 drawer case: hang it on a wall with the louvers standing off it.

- Case cleat: bolts to the tray's back between the louver bands (2 x M3 x 10 socket or button head,
  from the wall side, into nuts in the tray's bosses). Its bevel faces down and toward the wall.
- Wall cleat: screws to the wall (2 x #8 / 4 mm countersunk wood screws, or anchors). Its bevel faces up; its front face
  holds the tray's back, so the case hangs plumb with no bottom spacer.
- Both are CLEAT_T deep: the tray's back sits CLEAT_T off the wall and the rim CLEAT_T - BACKL. The two cleats fill the
  middle of the back and leave the louver bands open: air comes in at the bottom of the gap and leaves at the top.
- To hang: hold the case CLEAT_T higher than its resting spot, push it to the wall, let it drop onto the bevel.
Print both wall face down (no overhangs past 45 deg, no supports), PETG.
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
TIP = 1.0                           # knife edges cut back
WALL_H = 45.0                       # wall cleat's front face, at most
ZW0 = max(CLEAT_ZBOT, ZB - WALL_H)  # wall cleat's bottom
CBORE_D, CBORE_LEFT = 6.6, 4.0      # case cleat: counterbore for the M3 head from the wall side, 4 mm of cleat left under it
WS_D, WS_HEAD = 4.5, 9.0            # wall screws: #8 / 4 mm countersunk


def poly(pts):
    cs = CrossSection([pts])
    return cs if cs.area() > 0 else CrossSection([pts[::-1]])


def case_cleat():
    hw = CLEAT_HW
    c = prism_x(poly([(Y1, ZB), (Y1, CLEAT_ZTOP), (YW, CLEAT_ZTOP), (YW, ZB - T + TIP), (YW - TIP, ZB - T + TIP)]), -hw, hw)
    cuts = []
    for x, z in CLEAT_SCREWS:
        cuts.append(cyl_y(x, z, Y1 - 1, YW + 1, 3.4, 24))
        cuts.append(cyl_y(x, z, Y1 + CBORE_LEFT, YW + 1, CBORE_D, 32))
    return c - Manifold.batch_boolean(cuts, ADD)


def wall_screws():
    zs = (ZW0 + ZB - T) / 2
    return [(sx * (CLEAT_HW - 15.0), zs) for sx in (-1, 1)]


def wall_cleat():
    hw = CLEAT_HW - 0.5
    c = prism_x(poly([(YW, ZW0), (YW, ZB - T), (Y1 + TIP, ZB - TIP), (Y1, ZB - TIP), (Y1, ZW0)]), -hw, hw)
    cuts = []
    for x, z in wall_screws():
        cuts.append(cyl_y(x, z, Y1 - 1, YW + 1, WS_D, 32))
        cs = (WS_HEAD - WS_D) / 2                                       # 90-degree countersink at the front face
        cuts.append(Manifold.cylinder(cs + 0.01, WS_HEAD / 2, WS_D / 2, 48).rotate([-90, 0, 0]).translate([x, Y1 - 0.01, z]))
    return c - Manifold.batch_boolean(cuts, ADD)


if __name__ == '__main__':
    import numpy as np, trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])       # wall face (y = YW) on the bed
    for m, name in ((case_cleat(), 'bar-cleat-case.stl'), (wall_cleat(), 'bar-cleat-wall.stl')):
        me = m.to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
        t.apply_transform(down); t.apply_translation([0, 0, -t.bounds[0][2]]); t.export(f'{out}/{name}')
        print(name, t.is_watertight, np.round(t.extents, 1).tolist())
    print(dict(case_cleat_z=(round(ZB - T - ZC, 1), round(CLEAT_ZTOP - ZC, 1)), wall_cleat_z=(round(ZW0 - ZC, 1), round(ZB - ZC, 1)),
               half_len=round(CLEAT_HW, 1), screws=[(x, round(z - ZC, 1)) for x, z in CLEAT_SCREWS],
               wall_screws=[(x, round(z - ZC, 1)) for x, z in wall_screws()], rim_off_wall=T - DR.BACKL if hasattr(DR, 'BACKL') else None))
