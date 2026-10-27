"""Knob for the 5880 encoder on the bar sleeve case: a reeded coin, Ø27, whose skirt comes down over the encoder's nut
to 1 mm above the collar. Dimensions from Adafruit's CAD model of the 5880 (EC11-style): the body clamps up against the
collar's deck, so, measured from the case top: deck top +1.6, M7 nut (~2 mm, plus an optional washer) to ~+4.1,
bushing top +6.0, 6 mm shaft round to +7.2, then a D-flat 1.55 mm from the axis to the tip at +13.7.
- The knob seats when its bore's ceiling meets the shaft tip, which puts the skirt 1 mm above the collar (the push
  switch travels ~0.5 mm, so a press never bottoms the skirt on the collar).
- Fit set: three knobs with the bore 0.1 mm apart (Ø6.05 / 6.15 / 6.25, flat 1.50 / 1.55 / 1.60); one, two or three dots
  on the skirt's underside mark them. Keep the one that pushes on snugly and doesn't wobble.
- Prints top face down, no supports (every cavity widens toward the bed's far side).
Knob coordinates: axis at the origin, z from the case top up. Run: python3 knob.py <outdir>
"""
import math, sys
import numpy as np
import manifold3d
from manifold3d import Manifold, CrossSection

SEG = 96
KD = 27.0                        # diameter
SKIRT_Z, TIP_Z, TOP_T = 2.6, 13.7, 1.6
NUT_R, NUT_TOP = 6.6, 5.1        # recess for the nut (+ washer) and the press travel
BUSH_R, BUSH_TOP = 3.9, 7.0      # clearance over the bushing
D_START = 7.6                    # D section of the bore starts here (shaft's flat starts at +7.2)
REEDS, REED_D = 72, 0.45         # coin-edge reeding
CH = 0.6                         # top and bottom edge chamfers
FITS = [(6.05, 1.50), (6.15, 1.55), (6.25, 1.60)]


def cyl(r, z0, z1, r1=None, seg=SEG):
    return Manifold.cylinder(z1 - z0, r, r if r1 is None else r1, seg).translate([0, 0, z0])


def knob(bore_d=6.15, flat=1.55, marks=2):
    r = KD / 2
    top = TIP_Z + TOP_T
    k = cyl(r - CH, SKIRT_Z, SKIRT_Z + CH, r) + cyl(r, SKIRT_Z + CH, top - CH) + cyl(r, top - CH, top, r - CH)
    reeds = []
    for i in range(REEDS):
        a = 2 * math.pi * i / REEDS
        g = Manifold.cylinder(top - SKIRT_Z - 2 * CH - 0.6, 0.45, 0.45, 12).translate([(r + 0.45 - REED_D) * math.cos(a), (r + 0.45 - REED_D) * math.sin(a), SKIRT_Z + CH + 0.3])
        reeds.append(g)
    k = k - Manifold.batch_boolean(reeds, manifold3d.OpType.Add)
    k = k - cyl(NUT_R, SKIRT_Z - 1, NUT_TOP) - cyl(BUSH_R, SKIRT_Z - 1, BUSH_TOP)
    br = bore_d / 2
    k = k - cyl(br, SKIRT_Z - 1, D_START + 0.01, seg=48)
    dcs = CrossSection.circle(br, 48) ^ CrossSection.square([2 * br + 2, 2 * br + 2]).translate([-br - 1, -br - 1 + 0]) \
        ^ CrossSection.square([2 * br + 2, br + flat + 1]).translate([-br - 1, -br - 1])
    k = k - Manifold.extrude(dcs, TIP_Z - D_START).translate([0, 0, D_START])
    k = k - cyl(br - 0.6, TIP_Z - 0.01, TIP_Z + 0.4, br - 1.0, seg=48)        # small relief over the shaft's chamfered tip
    for j in range(marks):                                                    # fit marks under the skirt
        a = math.radians(90 + (j - (marks - 1) / 2) * 12)
        k = k - Manifold.sphere(0.5, 16).translate([(r - 2.6) * math.cos(a), (r - 2.6) * math.sin(a), SKIRT_Z])
    return k


def to_bed(m):
    """top face down"""
    return m.mirror([0, 0, 1]).translate([0, 0, TIP_Z + TOP_T])


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    parts = []
    for i, (d, f) in enumerate(FITS):
        parts.append(to_bed(knob(d, f, i + 1)).translate([i * (KD + 6), 0, 0]))
    def save(m, name):
        me = m.to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
        t.export(f'{out}/{name}'); print(name, t.is_watertight, np.round(t.extents, 1).tolist())
    save(Manifold.batch_boolean(parts, manifold3d.OpType.Add), 'bar-knob-fit-set.stl')
    save(to_bed(knob(*FITS[1], 2)), 'bar-knob.stl')
