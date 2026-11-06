"""128 x 32 bar, P3: the v5 drawer sleeve for two Waveshare P3 64x32 panels side by side (384 x 96 of LEDs), in parts
that fit the X2D's 256 mm bed. Started fresh from the single P3 v5 shell (drawer.py + case2.shell2), not from the
P2.5 bar (bar128.py): its thin tongue-and-groove in the walnut stepped, blobbed and failed to slice cleanly.

Case frame as everywhere (x right seen from the front, y back, z up). Panel A (left) centred at x -96, B at +96.

Shell (walnut PLA, ~414 x 115 x 69 at CASE_WALL 5.0): the v5 sleeve from the 'p3x2' profile (bore 404 x 105.3), split at
x = 0 (the panel joint) into a left half A and a right half B. Both fit one plate back-down (each ~207 x 115 footprint).
- The wall is 5.0 (v5: 3.5) so the joint can live inside it with nothing thin: SKIN | SLOT | SKIN = 1.5 | 2.0 | 1.5.
- The joint is loose tenons: the walnut only gets pockets (SLOT wide, TEN_IN deep into each half, open at the joint
  face), two per wall (top and bottom), front and back (TEN_Y). Pure subtraction from a thick wall: no lip, no stepped
  reveal, no bridge wider than the 2 mm slot end. Separate PETG tenons (tenon()) bridge the halves: flat bars that fill
  the pocket's length (so the fronts can't step) and are held on both faces by the skins (so the tops can't step).
  Crush ribs on one face (RIB_H proud; the tenon prints flat, ribs up) take up the clearance in PETG, where ribs work,
  not in the walnut. The halves' end faces are the seat in x (the tenon is TIP_CL short at each end).
- Outside, every visible edge at the joint has a CHAMF x 45 deg chamfer each side (a V-groove round the case), stepped
  in V_STEPS bands of 0.1 mm. The slot mouths are chamfered MOUTH at the joint face so a seam blob can't hold the halves
  apart or foul the tenon.
- Knob at KNOB_X (+162, 45 mm from the right end, over tray B: its encoder board, 25.4 wide, clears tray B's top-right
  corner post at x 183.25), light sensor 40 mm toward the centre, USB-C at the right end. KNOB_X=96 is the stock-tray
  option (knob over panel B's centre, tray B = the single v5 tray).
Run: python3 p3x2.py <outdir>   -> shell halves, tenons (RIB_H), the seam coupon (both halves' top wall across the
     joint, 40 wide, with three tenons at RIB_HS, 1-3 notches). Case-frame copies for the checks go to <outdir>/frames.
"""
import math, os, sys
os.environ['PANEL'] = 'p3x2'
os.environ.setdefault('CASE_WALL', '5.0')
import numpy as np
from manifold3d import Manifold, CrossSection
import panel
import case as C
import case2 as V
import plate3 as P3
import drawer as DR
from case import box, rr_cs, prism_y, prism_x, cyl_y, cyl_z, ZC, H, D, WALL, HW, RC, BORE_HX, BORE_HZ, BORE_R, JT, ADD, Y_FACE

KNOB_X = float(os.environ.get('KNOB_X', '162'))
SENSOR_X = KNOB_X - 40.0
V.SENSOR_X = SENSOR_X
DR.configure_shell()
V.BACKDOWN = True
V.KNOB_X = KNOB_X
for _m in (C, V, P3):
    _m.SCREW_XS = tuple(panel.P['screw_xs'])     # +/-50, +/-142: each tray's own +/-46

BED = 256.0
# ---------------------------------------------------------------- joint
CHAMF = 0.5                     # V-groove: each half's visible edges at the joint chamfered this much x 45 deg
V_STEPS = 5                     # the chamfer is cut in bands this many deep (0.1 mm steps)
SKIN = 1.5                      # wall = SKIN | SLOT | SKIN
SLOT = WALL - 2 * SKIN          # 2.0: the tenon pocket's width (across the wall)
TEN_IN = 12.0                   # pocket depth into each half from the joint face
TIP_CL = 0.25                   # tenon end short of the pocket bottom, each end: the end faces at x = 0 seat first
MOUTH = 0.5                     # pocket mouth chamfer at the joint face (room for a seam blob)
TEN_L = 20.0                    # tenon length along the case depth
TEN_Y = ((Y_FACE + 2.5, Y_FACE + 2.5 + TEN_L), (D - 2.5 - TEN_L, D - 2.5))   # front and back pockets (y)
TEN_CL_Y = 0.15                 # tenon clearance to the pocket's y ends, a side (the pocket's ends line the fronts up)
TEN_T = SLOT - 0.4              # tenon body thickness: 0.2 a side in the pocket before the ribs (a slot printed on its side
                                #   in wood PLA comes out ~0.2-0.3 undersize, as the collar hole did; the ribs take up the rest)
RIB_HS = (0.45, 0.55, 0.65)     # the coupon's three rib heights: interference 0.05 / 0.15 / 0.25 in a slot printed to size,
                                #   0.25 / 0.35 / 0.45 in one printed 0.2 undersize (the ribbed face only: the flat face bears on the skin)
RIB_H = float(os.environ.get('RIB_H', '0.55'))
RIB_W, RIB_CREST, RIB_LEAD, RIB_N = 1.4, 0.6, 2.0, 3   # rib base and crest widths (a trapezoid: its top layer is one
                                                      # 0.6 mm line printed flat), ramp length at each end, ribs per tenon
END_CH = 0.4                    # lead-in chamfer on the tenon's x ends
assert SLOT >= 1.8 and SKIN >= 1.3, (SLOT, SKIN)


def outer_inset(i):
    """case2's back-down outer body (chamfered front and back rims) moved inward by i"""
    ch = V.CH_F
    pts = []
    for (x, z) in rr_cs(HW - ch - i, H / 2 - ch - i, RC - ch - i).to_polygons()[0]:
        pts.append((x, V.front_y(z) + i, z))
    for (x, z) in rr_cs(HW - i, H / 2 - i, RC - i).to_polygons()[0]:
        pts.append((x, V.front_y(z) + ch + i, z))
    for (x, z) in rr_cs(HW - ch - i, H / 2 - ch - i, RC - ch - i).to_polygons()[0]:
        pts.append((x, D - i, z))
    for (x, z) in rr_cs(HW - i, H / 2 - i, RC - i).to_polygons()[0]:
        pts.append((x, D - ch - i, z))
    return Manifold.hull_points(np.array(pts))


def deep(d):
    """shell material more than d from a face you can see: outside, the screen rim in front of the face, the back rim"""
    m = outer_inset(d)
    m = m - prism_y(rr_cs(BORE_HX + d, BORE_HZ + d, BORE_R + d), -50, Y_FACE + d)
    m = m - prism_y(rr_cs(BORE_HX + d, BORE_HZ + d, BORE_R + d), DR.Y1, D + 50)
    return m


def v_groove(sh):
    """the CHAMF x 45 deg chamfer on both halves' visible edges at x = 0, as V_STEPS stepped bands"""
    cuts = []
    for k in range(V_STEPS):
        x0, x1 = CHAMF * k / V_STEPS, CHAMF * (k + 1) / V_STEPS
        dk = CHAMF - (x0 + x1) / 2
        band = box(-x1, x1, -50, D + 1, -1, H + 1)
        if k:
            band = band - box(-x0, x0, -51, D + 2, -2, H + 2)
        cuts.append((sh ^ band) - deep(dk))
    return Manifold.batch_boolean(cuts, ADD)


def wall_slots():
    """(z0, z1) of the pocket across each wall: top and bottom"""
    return [(H - WALL + SKIN, H - SKIN), (SKIN, WALL - SKIN)]


def pocket_cuts():
    """the tenon pockets in both halves (symmetric about x = 0) with their mouth chamfers"""
    cuts = []
    for z0, z1 in wall_slots():
        for y0, y1 in TEN_Y:
            cuts.append(box(-TEN_IN, TEN_IN, y0, y1, z0, z1))
            cuts.append(Manifold.batch_hull([box(-0.005, 0.005, y0, y1, z0 - MOUTH, z1 + MOUTH),
                                             box(-MOUTH, MOUTH, y0, y1, z0, z1)]))
    return cuts


def split_shell(sh):
    """left (A) and right (B) halves: the V-groove and the pockets cut, then the shell cut at x = 0"""
    s = sh - v_groove(sh) - Manifold.batch_boolean(pocket_cuts(), ADD)
    a = s ^ box(-HW - 1, 0.0, -50, D + 1, -1, H + 1)
    b = s ^ box(0.0, HW + 1, -50, D + 1, -1, H + 1)
    out = []
    for m in (a, b):
        parts = sorted(m.decompose(), key=lambda q: -q.volume())
        assert all(q.volume() < 0.01 for q in parts[1:]), [q.volume() for q in parts[1:]]
        out.append(parts[0])
    return tuple(out)


def tenon(rib_h=RIB_H, notches=0, y=None):
    """one tenon in the case frame, in the front top pocket (or the span y): a flat bar TEN_T thick, filling the
    pocket's length less TEN_CL_Y a side, 2 * TIP_CL short of the two pockets' combined depth, with RIB_N crush ribs
    rib_h proud on its +z face running along x (ramped to nothing over RIB_LEAD at each end) and END_CH lead-in
    chamfers on its x ends. Prints flat, ribs up. notches: 1-3 marks on its front edge (the coupon's sizes)."""
    y0, y1 = TEN_Y[0] if y is None else y
    y0, y1 = y0 + TEN_CL_Y, y1 - TEN_CL_Y
    z0, z1 = wall_slots()[0]
    zb = z0 + 0.1                                   # the bar's underside, 0.1 off the pocket's inside face
    zt = zb + TEN_T
    hl = TEN_IN - TIP_CL
    t = box(-hl, hl, y0, y1, zb, zt)
    for sx in (-1, 1):                              # end chamfers, both z edges
        for ze, sgn in ((zt, -1), (zb, 1)):
            tri = CrossSection([[(sx * hl, ze), (sx * (hl - END_CH), ze), (sx * hl, ze + sgn * END_CH)]])
            if tri.area() <= 0:
                tri = CrossSection([[(sx * hl, ze), (sx * hl, ze + sgn * END_CH), (sx * (hl - END_CH), ze)]])
            t = t - prism_y(tri, y0 - 1, y1 + 1)
    ribs = []
    for i in range(RIB_N):
        yc = y0 + (y1 - y0) * (i + 1) / (RIB_N + 1)

        def rib_cs(h):
            """trapezoid: RIB_W at the base, RIB_CREST at the top (one solid line when printed flat), h tall"""
            pts = [(yc - RIB_W / 2, zt - 0.02), (yc + RIB_W / 2, zt - 0.02), (yc + RIB_CREST / 2, zt + h), (yc - RIB_CREST / 2, zt + h)]
            cs = CrossSection([pts])
            return cs if cs.area() > 0 else CrossSection([pts[::-1]])
        xa, xb = -hl + END_CH + 0.3, hl - END_CH - 0.3    # ribs start 0.3 in from the chamfer edge (off its edge line)
        ribs.append(prism_x(rib_cs(rib_h), xa + RIB_LEAD, xb - RIB_LEAD))
        # ramps: from the full rib down to a 0.05 mm sliver of its base at each end (a box, so no zero-area faces)
        for e0, e1 in ((xa, xa + RIB_LEAD), (xb - RIB_LEAD, xb)):
            full = prism_x(rib_cs(rib_h), e1 - 0.01, e1) if e0 == xa else prism_x(rib_cs(rib_h), e0, e0 + 0.01)
            end_x = e0 if e0 == xa else e1 - 0.01
            ribs.append(Manifold.batch_hull([full, box(end_x, end_x + 0.01, yc - RIB_W / 2, yc + RIB_W / 2, zt - 0.02, zt + 0.05)]))
    t = t + Manifold.batch_boolean(ribs, ADD)
    for k in range(notches):                        # 1 mm notches in the front edge, 2 mm apart, on the bar's centre
        nx = (k - (notches - 1) / 2) * 2.0
        t = t - box(nx - 0.5, nx + 0.5, y0 - 1, y0 + 0.8, zb - 1, zt + 1)
    return t


def coupon(a, b):
    """both halves' top wall across the joint, 40 wide, from the hood to 2.5 mm past the front pocket's end (as the
    pocket's own back end in the part): the hood, the front rim, the V-groove and the front pocket. The cut face
    prints on the bed, as the halves do."""
    reg = box(-20.0, 20.0, -50, TEN_Y[0][1] + 2.5, H - 16.0, H + 1)
    return a ^ reg, b ^ reg


def tm(m, mat=None):
    import trimesh
    me = m.to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    if mat is not None:
        t.apply_transform(mat)
    return t


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    frames = f'{out}/frames'
    os.makedirs(out, exist_ok=True); os.makedirs(frames, exist_ok=True); os.makedirs(f'{out}/coupons', exist_ok=True)
    sh = V.shell2()
    a, b = split_shell(sh)
    down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])      # y = D on the bed (back down)

    def put(m, name, mat=down, frame=None):
        t = tm(m, mat)
        f = tm(frame, mat) if frame is not None else t
        t.apply_translation([-f.bounds[0][0], -f.bounds[0][1], -f.bounds[0][2]]); t.export(f'{out}/{name}')
        print(name, 'watertight', t.is_watertight, np.round(t.extents, 1).tolist(), 'vol cm3', round(t.volume / 1000, 1))
        return t
    for m, name in ((a, 'A'), (b, 'B')):
        tm(m).export(f'{frames}/shell-{name}.stl')
        put(m, f'p3x2-shell-{name}-walnut-backdown.stl')
    # tenons: the build's, four of them on one plate (flat as built: z up)
    tens = [tenon(RIB_H).translate([0, 0, 0]) for _ in range(4)]
    tm(tenon(RIB_H)).export(f'{frames}/tenon.stl')
    t = tm(tenon(RIB_H)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/p3x2-tenon.stl')
    print('p3x2-tenon.stl', 'watertight', t.is_watertight, np.round(t.extents, 2).tolist())
    # coupons: both halves' top wall across the joint + the three tenon sizes
    ca, cb = coupon(a, b)
    for m, name in ((ca, 'A'), (cb, 'B')):
        put(m, f'coupons/coupon-p3x2-seam-{name}-walnut.stl')
    for n, h in enumerate(RIB_HS, 1):
        t = tm(tenon(h, notches=n)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/coupons/coupon-p3x2-tenon-{h:.2f}.stl')
        print(f'coupon-p3x2-tenon-{h:.2f}.stl', 'watertight', t.is_watertight, np.round(t.extents, 2).tolist(), f'{n} notch(es)')
    import collar as CO                                             # the collar's plug follows the 5 mm wall (CASE_WALL)
    CO.TIP_BACK = False
    t = CO.export(CO.collar(), f'{out}/p3x2-encoder-collar.stl'); print('p3x2-encoder-collar.stl', 'watertight', t.is_watertight, np.round(t.extents, 1).tolist())
    print(dict(W=2 * HW, H=round(H, 2), D=D, wall=WALL, slot=SLOT, skin=SKIN, knob=KNOB_X, sensor=SENSOR_X, screws=V.SCREW_XS,
               feet=C.FEET, ten_y=TEN_Y, port_z=round(DR.PORT_Z - ZC, 2)))
