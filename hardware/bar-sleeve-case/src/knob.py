"""Knob for the 5880 encoder on the bar sleeve case. Main style (Oct 26): a pebble, Ø30 x 12.7, smooth sides, a big
rounded shoulder blending (tangent) into a gently domed top, with its skirt down over the encoder's nut to 1 mm above
the collar. Also here: disc() (floating Ø36 disc with grip ridges) and coin() (reeded Ø27 coin, flat top). Dimensions from Adafruit's CAD model of the 5880 (EC11-style): the body clamps up against the
collar's deck, so, measured from the case top: deck top +1.6, M7 nut (~2 mm, plus an optional washer) to ~+4.1,
bushing top +6.0, 6 mm shaft round to +7.2, then a D-flat 1.55 mm from the axis to the tip at +13.7.
- The knob seats when its bore's ceiling meets the shaft tip, which puts the skirt 1 mm above the collar (the push
  switch travels ~0.5 mm, so a press never bottoms the skirt on the collar).
- Fit set: three knobs with the bore 0.1 mm apart (Ø6.05 / 6.15 / 6.25, flat 1.50 / 1.55 / 1.60); one, two or three dots
  on the skirt's underside mark them. Keep the one that pushes on snugly and doesn't wobble.
- The pebble prints upright (skirt on the bed) with no supports: the cavity ceilings are 45° cones, so nothing bridges
  except the Ø6 bore top. The disc prints upright with supports under the disc; the coin prints top face down.
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


def coin(bore_d=6.15, flat=1.55, marks=2):
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


def bore_cuts(bore_d, flat, z_from):
    """nut recess, bushing clearance, round bore, D bore (flat at `flat` from the axis), relief over the shaft tip"""
    br = bore_d / 2
    c = cyl(NUT_R, z_from, NUT_TOP) + cyl(BUSH_R, z_from, BUSH_TOP) + cyl(br, z_from, D_START + 0.01, seg=48)
    dcs = CrossSection.circle(br, 48) ^ CrossSection.square([2 * br + 2, br + flat + 1]).translate([-br - 1, -br - 1])
    c = c + Manifold.extrude(dcs, TIP_Z - D_START).translate([0, 0, D_START])
    return c + cyl(br - 0.6, TIP_Z - 0.01, TIP_Z + 0.4, br - 1.0, seg=48)


DISC_R, HUB_R, DISC_BOT = 18.0, 9.0, 9.0
DOME = 0.9                         # top centre to the start of the rim round
GRIP_N = 96


def _arc(cx, cz, r, a0, a1, n=8):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def disc(bore_d=6.15, flat=1.55, marks=2):
    """floating disc: dome on top, rim rounds, grip ridges on the edge, hub over the nut"""
    top = TIP_Z + TOP_T
    rr = DISC_R - 1.5
    dome = [(r, top - DOME * (r / rr) ** 2) for r in np.linspace(0, rr, 14)]
    edge_top = top - DOME - 1.5
    prof = [(0, SKIRT_Z), (HUB_R - 0.8, SKIRT_Z)] + _arc(HUB_R - 0.8, SKIRT_Z + 0.8, 0.8, -90, 0, 4) \
        + _arc(HUB_R + 1.5, DISC_BOT - 1.5, 1.5, 180, 90, 6) + _arc(DISC_R - 1.0, DISC_BOT + 1.0, 1.0, -90, 0, 6) \
        + _arc(rr, edge_top, 1.5, 0, 90, 8) + dome[::-1]
    cs = CrossSection([prof])
    if cs.area() <= 0:
        cs = CrossSection([prof[::-1]])
    k = Manifold.revolve(cs, 160)
    grip = [Manifold.cylinder(edge_top - DISC_BOT - 1.4, 0.45, 0.45, 12)
            .translate([(DISC_R + 0.05) * math.cos(2 * math.pi * i / GRIP_N), (DISC_R + 0.05) * math.sin(2 * math.pi * i / GRIP_N), DISC_BOT + 1.0])
            for i in range(GRIP_N)]
    k = k - Manifold.batch_boolean(grip, manifold3d.OpType.Add)
    k = k - bore_cuts(bore_d, flat, SKIRT_Z - 1)
    for j in range(marks):                                                    # fit marks under the hub
        a = math.radians(90 + (j - (marks - 1) / 2) * 25)
        k = k - Manifold.sphere(0.45, 16).translate([7.8 * math.cos(a), 7.8 * math.sin(a), SKIRT_Z])
    return k


PEB_R, SHOULDER_R, SHOULDER_END = 15.0, 5.0, 75.0      # radius, shoulder round, where the shoulder hands over to the dome (deg)


def pebble_cuts(bore_d, flat, z_from):
    """as bore_cuts, but every ceiling a 45° cone so it prints upright without bridging (the D starts at +8.5, still
    5 mm of flat engagement; the shaft's flat starts at +7.2)"""
    br = bore_d / 2
    nut_cone = Manifold.cylinder(NUT_R - BUSH_R, NUT_R, BUSH_R, SEG).translate([0, 0, NUT_TOP])
    bush_top = NUT_TOP + (NUT_R - BUSH_R)
    bush_cone = Manifold.cylinder(BUSH_R - br, BUSH_R, br, 64).translate([0, 0, bush_top])
    d0 = bush_top + (BUSH_R - br)
    c = cyl(NUT_R, z_from, NUT_TOP + 0.01) + nut_cone + cyl(BUSH_R, z_from, bush_top + 0.01) + bush_cone + cyl(br, z_from, d0 + 0.01, seg=48)
    dcs = CrossSection.circle(br, 48) ^ CrossSection.square([2 * br + 2, br + flat + 1]).translate([-br - 1, -br - 1])
    c = c + Manifold.extrude(dcs, TIP_Z - d0).translate([0, 0, d0])
    return c


def knob(bore_d=6.15, flat=1.55, marks=2):
    """pebble: smooth side, shoulder round handing over tangentially to a shallow dome"""
    top = TIP_Z + TOP_T
    a = math.radians(SHOULDER_END)
    r_e = PEB_R - SHOULDER_R + SHOULDER_R * math.cos(a)
    k = (1 / math.tan(a)) / (2 * r_e)                       # dome z = top - k r^2, slope matched to the shoulder
    zc = top - k * r_e ** 2 - SHOULDER_R * math.sin(a)      # shoulder centre height
    dome = [(r, top - k * r * r) for r in np.linspace(0, r_e, 16)]
    prof = [(0, SKIRT_Z), (PEB_R - 1.0, SKIRT_Z)] + _arc(PEB_R - 1.0, SKIRT_Z + 1.0, 1.0, -90, 0, 6) \
        + _arc(PEB_R - SHOULDER_R, zc, SHOULDER_R, 0, SHOULDER_END, 14) + dome[::-1][1:]
    cs = CrossSection([prof])
    if cs.area() <= 0:
        cs = CrossSection([prof[::-1]])
    m = Manifold.revolve(cs, 192) - pebble_cuts(bore_d, flat, SKIRT_Z - 1)
    for j in range(marks):                                                    # fit marks under the skirt
        ang = math.radians(90 + (j - (marks - 1) / 2) * 14)
        m = m - Manifold.sphere(0.5, 16).translate([(PEB_R - 3.0) * math.cos(ang), (PEB_R - 3.0) * math.sin(ang), SKIRT_Z])
    return m


def to_bed(m):
    """upright: skirt (or hub) on the bed"""
    return m.translate([0, 0, -SKIRT_Z])


def to_bed_coin(m):
    """top face down"""
    return m.mirror([0, 0, 1]).translate([0, 0, TIP_Z + TOP_T])


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    parts = [to_bed(knob(d, f, i + 1)).translate([i * (2 * PEB_R + 6), 0, 0]) for i, (d, f) in enumerate(FITS)]
    def save(m, name):
        me = m.to_mesh(); t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
        t.export(f'{out}/{name}'); print(name, t.is_watertight, np.round(t.extents, 1).tolist())
    save(Manifold.batch_boolean(parts, manifold3d.OpType.Add), 'bar-knob-fit-set.stl')
    save(to_bed(knob(*FITS[1], 2)), 'bar-knob.stl')
