"""One-piece white diffuser for the bar sleeve case (panel profile from panel.py: P3 default, PANEL=p25).
Same face/grid/skirt as the grid15 diffuser that fit (0.2 mm face, 1.5 mm grid, skirts on
all four sides with 0.15 mm clearance, 0.2 mm snap bumps on left/right/bottom); the flange
is a rounded rectangle that fills the case opening (fits the bore with 0.3 mm all round).
Prints face-down: z = 0 is the face, +z toward the LEDs. Units mm."""
import sys
import manifold3d
import numpy as np
from manifold3d import Manifold, CrossSection
import panel

PW, PH = panel.P['w'], panel.P['h']
SKIN = float(sys.argv[2]) if len(sys.argv) > 2 else 0.2   # face skin (0.2 white; 0.3 for translucent grey)
GRID_H = 1.5                        # grid behind the skin
SK_T, SK_D, CLR, BUMP = 1.2, 3.0, 0.15, 0.2
FT = 1.2                            # flange thickness
PITCH, RIB = panel.P['pitch'], panel.P['rib']
OUT = CLR + SK_T                    # skirt outline past the panel edge (1.35)
BORE_HX, BORE_HZ, BORE_R = panel.BORE_HX, panel.BORE_HZ, panel.BORE_R   # case opening (bore) half sizes and corner radius
FL_HX, FL_HZ, FL_R = BORE_HX - 0.3, BORE_HZ - 0.3, BORE_R - 0.3      # flange back edge: 0.3 mm clear of the bore
BEV = 0.6                                        # flange front edge 0.6 mm smaller: clears the ledge chamfer, seats on its flat


def box(x0, x1, y0, y1, z0, z1):
    return Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])


def rrect(hx, hy, r, z0, z1, n=48):
    cs = CrossSection.square([2 * (hx - r), 2 * (hy - r)], center=True).offset(r, manifold3d.JoinType.Round, circular_segments=n)
    return Manifold.extrude(cs, z1 - z0).translate([0, 0, z0])


def diffuser(grid=True):
    hx, hy = PW / 2, PH / 2
    o = OUT
    zg0, zg1 = SKIN - 0.01, SKIN + GRID_H
    zt = zg1 + SK_D
    front = rrect(FL_HX - BEV, FL_HZ - BEV, FL_R - BEV, 0, 0.05)
    back = rrect(FL_HX, FL_HZ, FL_R, FT - 0.05, FT)
    plate = Manifold.batch_hull([front, back])
    face = rrect(FL_HX - BEV, FL_HZ - BEV, FL_R - BEV, 0, SKIN)
    flange = plate - box(-hx - o + 0.01, hx + o - 0.01, -hy - o + 0.01, hy + o - 0.01, -1, FT + 1)
    frame = box(-hx - o, hx + o, -hy - o, hy + o, zg0, zg1) - box(-hx + 0.3, hx - 0.3, -hy + 0.3, hy - 0.3, -1, 10)
    skirt = box(-hx - o, hx + o, -hy - o, hy + o, zg1 - 0.01, zt) - box(-hx - CLR, hx + CLR, -hy - CLR, hy + CLR, -1, 20)
    d = face + flange + frame + skirt
    # lead-in chamfers on the inside of the skirt tips
    c = 0.6
    for sx in (-1, 1):
        wedge = Manifold.extrude(CrossSection([[(0, 0), (0, -c), (c, 0)]]), 2 * hy + 10).rotate([90, 0, 0])
        wedge = wedge.mirror([1, 0, 0]) if sx < 0 else wedge
        d = d - wedge.translate([sx * (hx + CLR), hy + 5, zt + 0.01])
    for sy in (-1, 1):
        wedge = Manifold.extrude(CrossSection([[(0, 0), (0, -c), (c, 0)]]), 2 * hx + 10).rotate([90, 0, 90])
        wedge = wedge.mirror([0, 1, 0]) if sy < 0 else wedge
        d = d - wedge.translate([-hx - 5, sy * (hy + CLR), zt + 0.01])
    # snap bumps on left, right and bottom (as on the part that fit)
    zb = zt - 1.2
    cyl = Manifold.cylinder(6, 0.9, 0.9, 48, True)
    for yc in (-hy / 2, hy / 2):
        for sx in (-1, 1):
            b = cyl.rotate([90, 0, 0]).translate([sx * (hx + CLR), yc, zb])
            keep = box(hx + CLR - BUMP, hx + CLR, yc - 3, yc + 3, 0, 20) if sx > 0 else box(-hx - CLR, -hx - CLR + BUMP, yc - 3, yc + 3, 0, 20)
            d = d + (b ^ keep)
    for xc in (-hx / 2, hx / 2):
        b = cyl.rotate([0, 90, 0]).translate([xc, -hy - CLR, zb])
        d = d + (b ^ box(xc - 3, xc + 3, -hy - CLR, -hy - CLR + BUMP, 0, 20))
    if grid:
        ribs = []
        for i in range(1, panel.COLS):
            x = -hx + i * PITCH
            ribs.append(box(x - RIB / 2, x + RIB / 2, -hy + 0.29, hy - 0.29, zg0, zg1))
        for j in range(1, panel.ROWS):
            y = -hy + j * PITCH
            ribs.append(box(-hx + 0.29, hx - 0.29, y - RIB / 2, y + RIB / 2, zg0, zg1))
        d = d + Manifold.batch_boolean(ribs, manifold3d.OpType.Add)
    return d


import manifold3d
if __name__ == '__main__':
    out = sys.argv[1]
    m = diffuser()
    mesh = m.to_mesh()
    import trimesh
    tm = trimesh.Trimesh(vertices=mesh.vert_properties[:, :3], faces=mesh.tri_verts, process=True)
    print('watertight', tm.is_watertight, 'volume mm3', round(tm.volume, 1), 'bounds', np.round(tm.bounds, 2).tolist())
    tm.export(out)
