"""Bar sleeve case for the Waveshare P3 64x32 + white diffuser + Matrix Portal S3 (on its ribbon).
Shell (black walnut wood PLA) and back plate (PETG) with a separate status-window insert.
Case frame: x right (seen from the front), y back (top front edge at y = 0), z up (shell bottom at z = 0). Units mm.
Run: python3 case.py <outdir>   -> shell, back plate, status window STLs + a summary.
"""
import math, sys
import numpy as np
import manifold3d
from manifold3d import Manifold, CrossSection

# ---------------- parameters ----------------
PANEL_X, PANEL_Z, PT = 96.0, 48.0, 14.5          # panel half sizes, thickness
STACK = 1.7                                       # diffuser face 0.2 + grid 1.5 in front of the LEDs
WALL = 2.5
BORE_HX, BORE_HZ, BORE_R = 106.0, 52.65, 11.5     # opening for the diffuser flange (+0.3 mm all round)
HW = BORE_HX + WALL                               # outer half width 108.5
H = 2 * (BORE_HZ + WALL)                          # 110.3
RC = BORE_R + WALL                                # outer corner radius 14
ZC = H / 2
LT, LB = 12.0, 3.0                                # front lip past the face: 12 at the top, 3 at the bottom
LEDGE_IN, LEDGE_T = 1.5, 1.2                      # face ledge: 1.5 mm inward, 1.2 thick, 45-deg chamfer behind it
D = 69.0                                          # 63 in v1-v3; v4 adds 6 mm behind the panel for the stock cables
BACKL, PLATE_T = 4.0, 2.0                         # back lip, back plate
Y_FACE = LT                                       # diffuser front face
PANEL_BACK = Y_FACE + STACK + PT                  # 28.2
PCB_Y0 = PANEL_BACK + 1.0 + 8.5                   # Portal PCB front face (bottom socket toward the panel)
PORT_Y = PCB_Y0 + 1.6 + 1.6                       # USB-C centre depth (top-mounted)
PORT_Z = ZC                                       # USB-C at mid-height (cradle sets the Portal to match)
KY = PANEL_BACK + 1.0 + 12.7                      # encoder centre: its board clears the panel back
ENC_HOLE = 24.0                                   # collar insert hole (insert designed when the encoder arrives)
GR_PITCH, GR_R = 3.2, 0.8
NEO_X, NEO_Z = -96.5, ZC + 30.6                   # status NeoPixel (estimate from Adafruit's photo)
FEET = [(sx * 84.0, fy) for sx in (-1, 1) for fy in (22.0, D - 11.0)]   # front pair 22 mm back: the recess teardrop's point
                                                  # (toward the front) stops ~3.5 mm inside the bottom front edge (y 9)
FOOT_D, FOOT_DEPTH = 13.2, 1.5                    # recesses for 3M SJ5312 (12.7 mm) bumpers
SCREW_X, SCREW_Y = 40.0, D - BACKL - PLATE_T - 3.5   # back plate screws from below
SCREW_XS = (40.0, 52.0)                          # v4: two pairs (x = +/-40 and +/-52)
KEY_X, KEY_Z = 40.0, ZC + 30.0                    # wall keyholes
TONGUE_X, TONGUE_W = 40.0, 30.0
SEG = 64

JT = manifold3d.JoinType.Round
ADD = manifold3d.OpType.Add


# ---------------- helpers ----------------
def box(x0, x1, y0, y1, z0, z1):
    return Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])


def rr_cs(hx, hz, r):
    """rounded rectangle in the (x, z) plane, centred on (0, ZC)"""
    r = max(r, 0.3)
    return CrossSection.square([2 * (hx - r), 2 * (hz - r)], center=True).offset(r, JT, circular_segments=SEG).translate([0, ZC])


def prism_y(cs, y0, y1):
    """extrude an (x, z) cross-section along y from y0 to y1"""
    return Manifold.extrude(cs, y1 - y0).rotate([90, 0, 0]).translate([0, y1, 0])


def prism_x(cs, x0, x1):
    """extrude a (y, z) cross-section along x from x0 to x1"""
    m = Manifold.extrude(cs, x1 - x0)
    return m.transform([[0, 0, 1, x0], [1, 0, 0, 0], [0, 1, 0, 0]])


def cyl_z(x, y, z0, z1, d, seg=48):
    return Manifold.cylinder(z1 - z0, d / 2, d / 2, seg).translate([x, y, z0])


def cyl_y(x, z, y0, y1, d, seg=48):
    return Manifold.cylinder(y1 - y0, d / 2, d / 2, seg).rotate([-90, 0, 0]).translate([x, y0, z])


def stadium_cs(c0, c1, hl, r):
    """vertical stadium in a plane: centre (c0, c1), half-length hl along the second axis, radius r"""
    return CrossSection.square([2 * r, max(2 * (hl - r), 0.01)], center=True).offset(r, JT, circular_segments=SEG).translate([c0, c1]) \
        if False else CrossSection.square([0.01, max(2 * (hl - r), 0.01)], center=True).offset(r, JT, circular_segments=SEG).translate([c0, c1])


def grid_holes_z(cx, cy, nx, ny, z0, z1):
    hs = []
    for i in range(nx):
        for j in range(ny):
            hs.append(cyl_z(cx + (i - (nx - 1) / 2) * GR_PITCH, cy + (j - (ny - 1) / 2) * GR_PITCH, z0, z1, 2 * GR_R, 16))
    return Manifold.batch_boolean(hs, ADD)


# ---------------- shell ----------------
RIM_R = 1.0                                       # round on the front lip and back rim


def sphere_pts(r, n=6):
    pts = []
    for i in range(n + 1):
        th = math.pi * i / n
        m = max(1, int(round(2 * n * math.sin(th))))
        for j in range(m):
            ph = 2 * math.pi * j / m
            pts.append((r * math.sin(th) * math.cos(ph), r * math.sin(th) * math.sin(ph), r * math.cos(th)))
    return np.array(pts)


def rounded_outer():
    """Outer body (rounded-rect outline, slanted front, flat back) with RIM_R rounds on every edge:
    shrink the convex body by RIM_R, then hull spheres placed at its vertices (exact for a convex body)."""
    r = RIM_R
    k = (LT - LB) / H
    poly = rr_cs(HW - r, H / 2 - r, RC - r).to_polygons()[0]
    sp = sphere_pts(r)
    pts = []
    for x, z in poly:
        for y in (k * (H - z) + r * math.sqrt(1 + k * k), D - r):
            pts.append(sp + np.array([x, y, z]))
    return Manifold.hull_points(np.concatenate(pts))



def shell():
    s = rounded_outer()
    # face ledge: 1.5 mm lip in front (y 10.8-12), a 0.9 mm flat seat for the diffuser at y = 12,
    # then a 45-deg chamfer out to the bore so it prints back-down without supports
    lo = rr_cs(BORE_HX - LEDGE_IN, BORE_HZ - LEDGE_IN, BORE_R - LEDGE_IN)
    seat_edge = rr_cs(BORE_HX - 0.6, BORE_HZ - 0.6, BORE_R - 0.6)
    bore_cs = rr_cs(BORE_HX, BORE_HZ, BORE_R)
    front = prism_y(bore_cs, -50, Y_FACE - LEDGE_T)
    ledge_open = prism_y(lo, Y_FACE - LEDGE_T - 0.01, Y_FACE + 0.01)
    cham = Manifold.batch_hull([prism_y(seat_edge, Y_FACE, Y_FACE + 0.001), prism_y(bore_cs, Y_FACE + 0.6, Y_FACE + 0.601)])
    bore = prism_y(bore_cs, Y_FACE + 0.6, D + 1)
    s = s - front - ledge_open - cham - bore
    # top grilles (5 rows) and bottom grilles (4 rows, clear of the feet)
    cuts = []
    for sx in (-1, 1):
        cuts.append(grid_holes_z(sx * 57.0, KY, 21, 5, H - WALL - 1, H + 1))
        cuts.append(grid_holes_z(sx * 50.0, KY, 15, 4, -1, WALL + 1))
    # encoder / collar insert hole: teardrop toward the front so it prints back-down
    eh = CrossSection.circle(ENC_HOLE / 2, SEG) + CrossSection([[(-ENC_HOLE / 2 * math.cos(math.pi / 4), -ENC_HOLE / 2 * math.sin(math.pi / 4)), (0, -ENC_HOLE / 2 * math.sqrt(2)), (ENC_HOLE / 2 * math.cos(math.pi / 4), -ENC_HOLE / 2 * math.sin(math.pi / 4))]]).translate([0, 0])
    cuts.append(Manifold.extrude(eh.translate([0, KY]), WALL + 2).translate([0, 0, H - WALL - 1]))
    cuts.append(box(-1.5, 1.5, KY + ENC_HOLE / 2 - 0.5, KY + ENC_HOLE / 2 + 2.5, H - WALL - 1, H + 1))   # anti-rotation key notch
    # USB-C: dish (1 mm deep pill pocket), opening, and an inner pocket thinning the wall to 0.8
    dish = prism_x(CrossSection.square([0.01, 2 * (7.5 - 4.0)], center=True).offset(4.0, JT, circular_segments=SEG).translate([PORT_Y, PORT_Z]), -HW - 1, -HW + 1.0)
    usb = prism_x(CrossSection.square([0.01, 2 * (4.75 - 1.9)], center=True).offset(1.9, JT, circular_segments=SEG).translate([PORT_Y, PORT_Z]), -HW - 1, -HW + WALL + 1)
    pocket = prism_x(CrossSection.square([12.0, 16.0], center=True).offset(1.5, JT, circular_segments=SEG).translate([PORT_Y - 1.0, PORT_Z]), -HW + 1.8, -HW + WALL + 0.5)
    cuts += [dish, usb, pocket]
    # feet recesses
    for fx, fy in FEET:
        cuts.append(cyl_z(fx, fy, -1, FOOT_DEPTH, FOOT_D, 64))
    # back plate screws: clearance holes + 1 mm counterbores from below
    for sx in (-1, 1):
        cuts.append(cyl_z(sx * SCREW_X, SCREW_Y, -1, WALL + 1, 3.4, 32))
        cuts.append(cyl_z(sx * SCREW_X, SCREW_Y, -1, 1.0, 6.4, 32))
    # grooves for the back plate's top tongues (cut into the top wall, open to the back)
    yp0 = D - BACKL - PLATE_T
    for sx in (-1, 1):
        cuts.append(box(sx * TONGUE_X - TONGUE_W / 2 - 0.3, sx * TONGUE_X + TONGUE_W / 2 + 0.3, yp0 - 0.3, D + 1, H - WALL - 0.01, H - WALL + 1.3))
    s = s - Manifold.batch_boolean(cuts, ADD)
    return s


# ---------------- back plate (prints outer face down) ----------------
def back_plate():
    y1 = D - BACKL                       # outer face
    y0 = y1 - PLATE_T
    cs = rr_cs(BORE_HX - 0.2, BORE_HZ - 0.2, BORE_R - 0.2)
    p = prism_y(cs, y0, y1)
    # top tongues into the shell's grooves
    for sx in (-1, 1):
        p = p + box(sx * TONGUE_X - TONGUE_W / 2, sx * TONGUE_X + TONGUE_W / 2, y0, y1, ZC + BORE_HZ - 0.3, ZC + BORE_HZ + 1.0)
    # bosses for the two M3 screws from below, with nut slots opening toward the panel side
    for sx in (-1, 1):
        x = sx * SCREW_X
        b = box(x - 5, x + 5, SCREW_Y - 4.5, y0 + 0.01, WALL + 0.2, WALL + 12.0)
        b = b - cyl_z(x, SCREW_Y, WALL - 1, WALL + 13, 3.3, 32)
        b = b - box(x - 2.9, x + 2.9, SCREW_Y - 6, SCREW_Y + 3.0, WALL + 4.0, WALL + 6.7)
        p = p + b
    # hold-down posts: press the panel's frame band forward (0.5 mm short for a foam dot)
    for px, pz in ((-75, ZC + 43), (75, ZC + 43), (-60, ZC - 43), (60, ZC - 43)):
        p = p + cyl_y(px, pz, PANEL_BACK + 0.5, y0 + 0.01, 8.0, 48)
    # keyhole cups (keep screw heads off the electronics), then the keyholes
    for sx in (-1, 1):
        x = sx * KEY_X
        p = p + box(x - 7, x + 7, y0 - 6, y0 + 0.01, KEY_Z - 7, KEY_Z + 15)
        p = p - box(x - 5.5, x + 5.5, y0 - 4.5, y0 + 0.02, KEY_Z - 5.5, KEY_Z + 13.5)
        kh = CrossSection.circle(4.0, 48).translate([x, KEY_Z]) + CrossSection.square([4.2, 10.0]).translate([x - 2.1, KEY_Z])
        p = p - prism_y(kh, y0 - 1, y1 + 1)
    # pill vents: 13 vertical slots, the rocker/USB motif
    vents = []
    for i in range(13):
        x = (i - 6) * 9.0
        st = CrossSection.square([0.01, 28.0], center=True).offset(2.2, JT, circular_segments=SEG).translate([x, ZC])
        vents.append(prism_y(st, y0 - 1, y1 + 1))
    p = p - Manifold.batch_boolean(vents, ADD)
    # status window hole + light tube (hollow, black) down toward the NeoPixel
    tube_end = PCB_Y0 + 1.6 + 1.5
    p = p + cyl_y(NEO_X, NEO_Z, tube_end, y0 + 0.01, 7.0, 48)
    p = p - cyl_y(NEO_X, NEO_Z, tube_end - 1, y0 + 0.5, 4.5, 48)
    p = p - cyl_y(NEO_X, NEO_Z, y0 + 0.4, y1 + 1, 6.0, 48)
    window = cyl_y(NEO_X, NEO_Z, y0 + 0.4, y1, 5.9, 48)
    return p, window


def export(m, path, flip_to_bed=None):
    import trimesh
    mesh = m.to_mesh()
    tm = trimesh.Trimesh(vertices=mesh.vert_properties[:, :3], faces=mesh.tri_verts, process=False)
    if flip_to_bed is not None:
        tm.apply_transform(flip_to_bed)
        tm.apply_translation([0, 0, -tm.bounds[0][2]])
    tm.export(path)
    return tm


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    import trimesh
    s = shell()
    p, w = back_plate()
    # print orientations: shell back-down (y = D on the bed), plate outer face down (y = D - BACKL on the bed)
    back_down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])     # +y -> -z
    tms = export(s, f'{out}/bar-shell-walnut.stl', back_down)
    import trimesh as T
    def place(m):
        mesh = m.to_mesh()
        t = T.Trimesh(vertices=mesh.vert_properties[:, :3], faces=mesh.tri_verts, process=False)
        t.apply_transform(back_down)
        return t
    tmp, tmw = place(p), place(w)
    dz = -tmp.bounds[0][2]
    for t in (tmp, tmw):
        t.apply_translation([0, 0, dz])        # same offset: the window drops into the plate as a part
    tmp.export(f'{out}/bar-backplate-petg.stl'); tmw.export(f'{out}/bar-status-window-translucent.stl')
    for name, t in (('shell', tms), ('back plate', tmp), ('window', tmw)):
        print(name, 'watertight', t.is_watertight, 'size', np.round(t.extents, 1).tolist(), 'volume cm3', round(t.volume / 1000, 1))
    print(dict(W=2 * HW, H=round(H, 2), D=D, panel_back=PANEL_BACK, pcb_y=PCB_Y0, port_y=PORT_Y, KY=KY))
