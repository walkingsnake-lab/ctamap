"""Light-sensor grille drill guide for the v4 back-down shell: drills a small grille of straight holes through the
case top over the VEML7700 (case2.SENSOR_X/Y) instead of one Ø2 hole.

- Location, one feature per direction so they never fight:
    rotation and front-back: a fence hooks down over the case's back face (the flat face printed on the bed, so it is
      accurate whatever the hole came out at). Push the guide back against it while drilling. 74 mm long, so a
      0.1 mm gap is 0.08 deg.
    left-right: crush ribs on the knob-hole plug, only on the left and right sides (ribs front and back would fight
      the fence). The knob hole's printed size varies (v1 guide at RIB_R 11.9 still twisted), so print the plug fit
      set first and use the rib radius that pushes in firmly (RIB_R; 1-3 notches = 12.05 / 12.15 / 12.25).
- One flat slab (top and bottom parallel), so it prints top face down with the plug up and no supports; the ribs
  print vertical. It sits flat on the case top, so the bores are square to it. Use it before the collar goes in.
- Bores are printed at the bit size: small FDM holes print undersize, so run the bit through the guide once first;
  the bore is then exactly the bit. SLAB (6 mm) + the 2.5 mm wall = 8.5 mm, well within a 1/16" jobber bit's ~19 mm
  flutes.
- Pitch follows the bit: webs between holes WEB (0.85 mm) wide, so the grille stays as small as the bit allows.
    '5': dice five, centre + 4 corners;  '4': square.
Run: python3 grille_guide.py <outdir> [bit_mm]     (default bit 1.59 = 1/16")
"""
import math, sys
import numpy as np
import manifold3d
from manifold3d import Manifold, CrossSection
import case2 as V

SLAB = 6.0                 # guide thickness = bore length
PLUG_D = 2.4               # plug depth into the knob hole (wall 2.5)
PLUG_CL = 0.5              # plug body clearance; the ribs take up the rest
RIB_R = 12.15              # rib crest radius (nominal hole r 12.0); set from the fit set
FENCE_GAP = 0.15           # fence's inner face behind the case's back face
FENCE_T, FENCE_DROP = 2.5, 6.0
FENCE_X = (-12.0, 62.0)
RIB_W, RIB_N = 1.0, 12     # rib width, count on a 30° grid; only those within 40° of ±x are kept
WEB = 0.85                 # wall left between neighbouring holes
SX, SY = V.SENSOR_X, V.SENSOR_Y - V.KY     # sensor spot relative to the knob-hole centre


def pattern(name, bit):
    p = bit + WEB                                              # centre-to-centre of neighbours
    if name == '5':
        c = p / math.sqrt(2)                                   # corners at (±c, ±c): p from the centre hole
        return [(0, 0)] + [(sx * c, sy * c) for sx in (-1, 1) for sy in (-1, 1)]
    if name == '4':
        return [(sx * p / 2, sy * p / 2) for sx in (-1, 1) for sy in (-1, 1)]
    raise ValueError(name)


def teardrop(r):
    V.BACKDOWN = True      # v4 back-down shell: knob-hole teardrop tip to the front (-y)
    try:
        return V.teardrop_cs(r, 0, 0, seg=V.SEG)
    finally:
        V.BACKDOWN = False


def plug(rib_r=RIB_R):
    """Frame: case top at z = 0, plug below it."""
    p = Manifold.extrude(teardrop(V.ENC_HOLE / 2 - PLUG_CL), PLUG_D).translate([0, 0, -PLUG_D])
    ribs = []
    for i in range(RIB_N):
        a = 2 * math.pi * i / RIB_N
        if abs(math.cos(a)) < math.cos(math.radians(40)):      # left/right ribs only: the fence sets front-back
            continue
        depth = rib_r - (V.ENC_HOLE / 2 - PLUG_CL) + 0.3       # rib root sits 0.3 inside the plug body
        r = Manifold.cube([depth, RIB_W, PLUG_D - 0.6]).translate([rib_r - depth, -RIB_W / 2, -PLUG_D + 0.6])
        lead = Manifold.hull(Manifold.cube([0.3, RIB_W, 0.01]).translate([rib_r - depth, -RIB_W / 2, -PLUG_D])
                             + Manifold.cube([depth, RIB_W, 0.01]).translate([rib_r - depth, -RIB_W / 2, -PLUG_D + 0.6]))
        ribs.append((r + lead).rotate([0, 0, math.degrees(a)]))   # 0.6 mm lead-in at the tip so the ribs start to crush
    return p + Manifold.batch_boolean(ribs, manifold3d.OpType.Add)


def guide(name, bit=1.59, rib_r=RIB_R):
    """Frame: knob-hole centre at the origin on the case top (z = 0), z up."""
    yb = V.D - V.KY                                            # case back face, from the knob-hole centre
    strip = CrossSection.square([FENCE_X[1] - FENCE_X[0], 1.0]).translate([FENCE_X[0], yb - 1.0])
    body = Manifold.extrude(CrossSection.batch_hull([teardrop(14.5), CrossSection.circle(7.5, 64).translate([SX, SY]), strip]), SLAB)
    f0 = yb + FENCE_GAP
    fence = V.box(FENCE_X[0], FENCE_X[1], f0, f0 + FENCE_T, -FENCE_DROP, SLAB)
    fence = fence - Manifold.cube([FENCE_X[1] - FENCE_X[0] + 2, 1.2, 1.2], center=True).rotate([45, 0, 0]).translate(
        [(FENCE_X[0] + FENCE_X[1]) / 2, f0, 0])                # relief in the inside corner: clears the 0.45 edge chamfer
    g = body + fence + plug(rib_r)
    r = bit / 2
    holes = []
    for dx, dy in pattern(name, bit):
        x, y = SX + dx, SY + dy
        holes.append(Manifold.cylinder(SLAB + 2, r, r, 32).translate([x, y, -1]))
        holes.append(Manifold.cylinder(0.5, r, r + 0.5, 32).translate([x, y, SLAB - 0.5 + 0.001]))  # lead-in at the top
    g = g - Manifold.batch_boolean(holes, V.ADD)
    g = g - V.box(6, 30, -0.6, 0.6, SLAB - 0.4, SLAB + 1)                  # groove on top: knob -> sensor
    # pry slot on the edge so the snug plug comes back out
    return g - V.box(-16, -12, -2, 2, -0.01, 1.2)


def fit_set(rs=(12.05, 12.15, 12.25)):
    """plug coupons (plug + 2 mm disc) at three rib radii; 1-3 notches in the disc rim mark them"""
    parts = []
    for i, rr in enumerate(rs):
        m = plug(rr) + Manifold.extrude(teardrop(14.5), 2.0)
        for k in range(i + 1):
            m = m - V.box(-0.6 + (k - i / 2) * 2.4, 0.6 + (k - i / 2) * 2.4, 13.0, 16, -1, 3)   # notches at +y (back)
        parts.append(m.translate([i * 33, 0, 0]))
    return Manifold.batch_boolean(parts, manifold3d.OpType.Add)


def check(name, bit):
    pts = [(SX + dx, SY + dy) for dx, dy in pattern(name, bit)]
    webs = [math.dist(a, b) - bit for i, a in enumerate(pts) for b in pts[i + 1:]]
    off = max(math.hypot(dx, dy) + bit / 2 for dx, dy in pattern(name, bit))
    return dict(holes=len(pts), min_web=round(min(webs), 2), grille_span=round(2 * off, 2),
                view_angle_deg=round(math.degrees(math.atan2(off, 4.15)), 1))   # chip 4.15 under the wall (sensor.py)


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    bit = float(sys.argv[2]) if len(sys.argv) > 2 else 1.59
    flip = trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0])     # top face on the bed, plug up (a rotation, not a mirror)

    def put(m, fn, info=''):
        me = m.to_mesh()
        t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
        t.apply_transform(flip)
        t.apply_translation([0, 0, -t.bounds[0][2]])
        t.export(f'{out}/{fn}')
        print(fn, t.is_watertight, np.round(t.extents, 1).tolist(), info)
    for name in ('5', '4'):
        put(guide(name, bit), f'bar-sensor-grille-guide-{name}hole.stl', check(name, bit))
    put(fit_set(), 'bar-sensor-grille-guide-plug-fit-set.stl', 'ribs 12.05 / 12.15 / 12.25 (1-3 notches)')
