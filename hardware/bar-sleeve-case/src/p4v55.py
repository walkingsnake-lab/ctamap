"""P4 "V5.5" tray (Nov 15, 2026): a stiffer tray for the existing P4 shell, diffuser, collar and knob. Units mm.

    python3 p4v55.py <out dir>      # the two tray halves in print orientation, and the checks

Why: on the first full P4 build the walls press in and the tray creaks under a knob press. An independent comparison of
that build with the V6 draft (v6.py) found that the sturdiness V6 gains is all in its PETG chassis and would fit the
existing shell, while V6's four-piece walnut skin costs 17 more screws, four seams and a tolerance stack at the rim. So
this is the tray alone, with what transfers. Nothing else is reprinted. See DESIGN-HISTORY.md (Nov 15).

What changes from p4.tray_p4():
- **Ties.** Stretches of the louver rows are blind (TIES, BLIND): the slots look as long as V5's from behind, but under
  each stretch the inner half of the 5 mm band is left solid and joins the wall to the back plate. 97 mm of the top
  wall's 227 mm louver span is tied against 10 on V5, 108 of the bottom's against 50 (check() measures it); the rows
  are solid round both centre posts and blind across the joint. (V6's rungs left the 86 mm round the knob untied.)
- **The split is 24 mm right of centre** (v6.JOINT_X), not under the knob: the encoder slot, both knob screws and both
  centre inserts are on the left half. No louver crosses it.
- **A joint in place of the spine and bridge:** v6's tongues inside the right half's top and bottom walls (two
  countersunk M3 x 10 each) and three block-under-bridge knuckles on the back plate (one countersunk M3 x 10 each, flush,
  so the wall cleat lies over them). The halves are joined on the bench and go into the sleeve as one tray.
- **Panel on standoffs.** An M3 x 30 male-female standoff in each of the panel's six inserts (the two centre ones were
  unused). The tray's posts are the V5 posts with their feet 30 mm further back (drawer.tray's post_dy): the same
  11 mm tube, 8.6 bore, 3 mm floor, 4.5 hole (+/-0.7 float) and sequential bridging, but the screw's seat is 4.6 mm
  inside the back face where it was 34. The V5 screws fit (M3 x 8 flanged button head).
- **Grid height.** With a taller diffuser grid (P4_GRID_H) the panel sits further back by the difference, and the posts'
  feet follow.

Unchanged: crush ribs, the two screws from below and the two beside the knob (with their pads), S3, status window, Boot,
sensor sled, ribbon hooks, cleat bosses, the encoder slot and rails. The tray's place in the shell is as V5 (the posts
stand it 0.3 off the diffuser's flange, the panel presses the diffuser onto the rim).
"""
import math, os, sys
import numpy as np
from manifold3d import Manifold
import p4
from p4 import box, cyl_y, cyl_z, ADD, DR, DF, H, D, ZC
import v6

P3 = DR.P3
JOINT_X = v6.JOINT_X
STANDOFF_L = 30.0
GRID_EXTRA = DF.GRID_H - 1.5                 # a taller grid sets the panel this much further back
FOOT_DY = STANDOFF_L + GRID_EXTRA
CENTRE_POSTS = [q for q in DR.INSERTS if q not in DR.CORNERS]        # (0, -56), (0, 56) about the centre
# louver rows left solid (x0, x1). Both walls: round each centre post, across the joint (12 each side), and every ~28 mm.
# The bottom rows are also solid at the two screw bosses (x = +/-46) and the top ones are blind behind the sensor's hooks.
# The louvers keep V5's look (the owner, Nov 15: a first draft that cut the rows into unequal lengths with solid ties
# "looks weird"; an even grid of short slots was the other choice). Full-length rows, solid only round the two centre posts
# (and at the bottom screw bosses, as V5). The ties are BLIND stretches: the slot is still cut from the back face there but
# stops drawer.TIE_BLIND (2.5 mm) short of the band's inner face, so it looks unbroken from behind and that much of the
# 5 mm band joins the wall to the plate. One every 24 mm, 10 wide, and 20 across the joint.
TIES = dict(top=[(-8, 8)], bottom=[(-8, 8)])
_b = [(c - 5, c + 5) for c in (-100, -76, -52, -28, 48, 72, 96)] + [(JOINT_X - 10, JOINT_X + 10)]
BLIND = dict(top=_b, bottom=_b)
# knuckles on the back plate: (z about the centre, block half height, pier). Two above the ribbon, one below it.
KNUCKLES = ((21.0, 6.0, 4.0), (41.0, 6.0, 4.0), (-41.0, 5.0, 2.5))
KN_BLOCK, KN_Y0, KN_CL = v6.KN_BLOCK, v6.KN_Y0, v6.KN_CL
KN_Y1 = DR.Y1 - 4.0                           # the blocks' top: 4 mm blocks, so an M3 x 10's last 5.8 mm are in the bridge
# Screws that thread into the tray from the back. On the built V5 the spine's M3s would not start in the cleat bosses'
# 3.1 mm pilots (the owner, Nov 15: "wouldn't start ... too tight to drive"), though that size was right on the Nov 3
# test plate. So each such pilot gets a guide bore at its mouth, as the M2.5 pilots have (drawer.M25_GUIDE_L): the screw
# drops in GUIDE_L and stands square before it cuts. The thread size itself is for the coupon to confirm.
GUIDE_D, GUIDE_L = 3.4, 1.2
TONGUE_BOSS = 4.85                            # the tongue screws' bosses: with the 2.5 wall and tongue, an M3 x 10 ends inside
KN_SCREW_X = JOINT_X + KN_BLOCK / 2 + 0.3


def tray(extra_dy=0.0):
    """the whole tray, before the split. extra_dy: the posts' feet this much further back still (v6.py: a washer on each
    standoff, and its panel sits behind the rim)"""
    dy = FOOT_DY + extra_dy
    post_dy = {c: dy for c in DR.CORNERS}
    t = DR.tray(ribbon_hooks=[(p4.HOOK_X, p4.RIB_Z), (p4.HOOK2_X, p4.IDC_Z)], hook_lip=p4.RIB_HOOK_LIP, tie_x0=v6.TIE_X0,
                post_dy=post_dy, ties=TIES, blind=BLIND)
    with DR._foot(dy):                                  # the two centre posts, as drawer.tray() builds the corner ones
        adds = [P3.standoff(x, z, DR.Y0) for x, z in CENTRE_POSTS]
        cuts = [cyl_y(x, ZC + z, P3.FOOT_Y + P3.SO_FLOOR + 0.02, DR.Y1 + 1, P3.SO_BORE + 0.04, 64) for x, z in CENTRE_POSTS]   # a hair over the post's own bore, so the two walls don't coincide
        # the screw holes again, through to the bores, with their bridge layers: with the feet this far back the corner
        # posts' floors reach into the louver band, which is added after the posts and closed the holes (found by the
        # Nov 16 check: a 1.2 mm skin in each of the six)
        for x, z in list(DR.CORNERS) + list(CENTRE_POSTS):
            cuts.append(cyl_y(x, ZC + z, P3.FOOT_Y - 1.01, P3.FOOT_Y + P3.SO_FLOOR + 0.1, P3.SO_HOLE + 0.04, 32))
            ys, h, lh, zc = P3.FOOT_Y + P3.SO_FLOOR, P3.SO_HOLE / 2 + 0.02, DR.BRIDGE_LH, ZC + z   # drawer.floor_bridge_cuts(), a hair
            cuts.append(box(x - h, x + h, ys - lh, ys + 0.01, zc - P3.SO_BORE, zc + P3.SO_BORE)      # inside the bore's wall
                        ^ cyl_y(x, zc, ys - 2 * lh, ys + 0.02, P3.SO_BORE - 0.06, 48))
            cuts.append(box(x - h, x + h, ys - 2 * lh, ys - lh + 0.01, zc - h, zc + h))
    t = (t + Manifold.batch_boolean(adds, ADD)) - Manifold.batch_boolean(cuts, ADD)
    if p4.TOP_SCREWS:
        adds, cuts = p4.tray_top_bosses()
        t = (t + adds) - cuts
    if DR.FASTEN == 'tap':                                   # guide bores at the cleat pilots' mouths (the back face)
        t = t - Manifold.batch_boolean([cyl_y(cx, cz, DR.Y1 - GUIDE_L, DR.Y1 + 1, GUIDE_D, 32) for cx, cz in DR.CLEAT_SCREWS], ADD)
    return max(t.decompose(), key=lambda m: m.volume())


def knuckles(insert=None, cl_y=KN_CL):
    """the joint at the back plate, as v6.knuckles() with what its review asked for. The left half's plate carries
    blocks that reach KN_BLOCK past the joint, on the print bed; the right half's plate is notched for each and bridges
    over it between two piers. One M3 x 10 countersunk from the back through each block into the bridge, its head flush
    (the cleat lies over two of them). The bridge's first two layers are cut as drawer.floor_bridge_cuts() cuts the post
    floors (a slot across the span, then a square), so no strand ends at the screw's hole.
    insert: (hole diameter, hole depth, relief diameter) puts a heat-set insert in each bridge, pressed in from its
    underside through the notch before the halves are joined (v6.py). cl_y: the gap between a block and its bridge.
    Returns (left adds, left cuts, right adds, right cuts)."""
    la, lc, ra, rc = [], [], [], []
    xs, lh = KN_SCREW_X, DR.BRIDGE_LH
    for dz, hz, pier in KNUCKLES:
        zc = ZC + dz
        la.append(box(JOINT_X - 8.0, JOINT_X + KN_BLOCK, KN_Y1, DR.Y1, zc - hz, zc + hz))
        lc.append(cyl_y(xs, zc, KN_Y1 - 1, DR.Y1 + 1, 3.4, 32))
        lc.append(Manifold.cylinder(1.71, 1.7, p4.CSK_D / 2, 48).rotate([-90, 0, 0]).translate([xs, DR.Y1 - 1.7, zc]))
        z0, z1 = zc - hz - KN_CL, zc + hz + KN_CL
        cav = box(JOINT_X - 0.01, JOINT_X + KN_BLOCK + KN_CL, KN_Y1 - cl_y, DR.Y1 + 0.01, z0, z1)
        ra.append(box(JOINT_X + KN_CL, JOINT_X + KN_BLOCK + KN_CL + 2.0, KN_Y0, DR.Y0 + 0.01, z0 - pier, z1 + pier) - cav)
        rc.append(cav)
        roof = KN_Y1 - cl_y                                                  # the bridge's underside in the print
        if insert:
            g = insert[0] / 2
            rc.append(cyl_y(xs, zc, KN_Y0 - 1, roof - insert[1] + 0.01, insert[2], 32))        # room for the screw's tip
            rc.append(cyl_y(xs, zc, roof - insert[1], roof - 2 * lh + 0.01, insert[0], 32))    # the insert
        else:
            g = GUIDE_D / 2
            rc.append(cyl_y(xs, zc, KN_Y0 - 1, roof - GUIDE_L + 0.01, DR.TAP_D_V, 32))        # the thread
            rc.append(cyl_y(xs, zc, roof - GUIDE_L, roof - 2 * lh + 0.01, GUIDE_D, 32))        # the guide bore
        rc.append(box(xs - g, xs + g, roof - lh, roof + 0.01, z0 - 0.01, z1 + 0.01))          # layer 1: strands pier to pier
        rc.append(box(xs - g, xs + g, roof - 2 * lh, roof - lh + 0.01, zc - g, zc + g))      # layer 2: across them
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return u(la), u(lc), u(ra), u(rc)


def halves():
    """(left, right)"""
    t = tray()
    left = t ^ box(-400, JOINT_X, -5, D + 5, -5, H + 5)
    right = t ^ box(JOINT_X, 400, -5, D + 5, -5, H + 5)
    tg_add, tg_cut, r_cut = v6.tongue_legs(TONGUE_BOSS)
    kl_add, kl_cut, kr_add, kr_cut = knuckles()
    left = (left + tg_add + kl_add) - tg_cut - kl_cut
    right = ((right - kr_cut) + kr_add) - r_cut - kr_cut
    return left, right


# ---------------------------------------------------------------- what it meets (checks, renders)
def standoffs():
    """the six standoffs on the panel: from the insert faces (where V5's post feet stood) STANDOFF_L back"""
    af = v6.STANDOFF_AF / math.sqrt(3)
    y0 = P3.FOOT_Y + GRID_EXTRA
    return Manifold.batch_boolean([Manifold.cylinder(STANDOFF_L, af, af, 6).rotate([-90, 0, 0]).translate([x, y0, ZC + z])
                                   for x, z in DR.INSERTS], ADD)


def panel():
    return p4.panel_p4()                      # p4 places it behind the grid, whatever its height


def screws():
    """seated: six panel screws (M3 x 8 flanged) and three knuckle screws (M3 x 10 countersunk) from the back, four tongue
    screws (M3 x 10 countersunk) through the right half's walls"""
    out = []
    seat = P3.FOOT_Y + FOOT_DY + P3.SO_FLOOR
    for x, z in DR.INSERTS:
        out.append(cyl_y(x, ZC + z, seat - 8.0, seat, 3.0, 24) + cyl_y(x, ZC + z, seat, seat + 1.65, 6.9, 32))
    for dz, _, _ in KNUCKLES:
        out.append(cyl_y(KN_SCREW_X, ZC + dz, DR.Y1 - 10.0, DR.Y1, 3.0, 24))
    xm = JOINT_X + v6.TONGUE / 2
    for y in v6.LEG_SCREW_Y:
        out.append(cyl_z(xm, y, v6.ZO1 - 10.0, v6.ZO1, 3.0, 24) + cyl_z(xm, y, v6.ZO0, v6.ZO0 + 10.0, 3.0, 24))
    return Manifold.batch_boolean(out, ADD)


def tie_length(m, side, x0=-113.5, x1=113.5, step=0.25):
    """mm of the louver span over which the band is solid from the wall to the plate (a 0.25 mm column through the band's
    three rows is all material)"""
    za, zb = (ZC + 55.5, v6.ZIN1 - 0.7) if side == 'top' else (v6.ZIN0 + 0.7, ZC - 56.5)
    n = 0
    xs = np.arange(x0, x1, step)
    for x in xs:
        col = box(x, x + step, DR.Y1 - 3.5, DR.Y1 - 2.5, za, zb)
        n += (col ^ m).volume() > 0.999 * col.volume()
    return n * step


def check():
    import p4_cables as CB
    L, R = halves()
    T = L + R
    P = p4.build()
    v5 = P['tray_left'] + P['tray_right']
    v = lambda a, b: round((a ^ b).volume(), 2)
    dif = Manifold.batch_boolean([p4.diffuser_in_case(m) for m in P['diffuser'].values()], ADD)      # already built at DF.GRID_H
    so, pan, enc = standoffs(), panel(), p4.encoder_envelope()
    import cleat as CLT
    rows = [('halves, each other', v(L, R)),
            ('tray / shell beyond the V5 tray (its crush ribs press on the shell by design)', round(v(T, P['shell']) - v(v5, P['shell']), 2)),
            ('tray / panel', v(T, pan)), ('tray / diffuser', v(T, dif)), ('tray / standoffs', v(T, so)),
            ('tray / S3 beyond the V5 tray (its posts stand in the envelope)', round(v(T, DR.s3_envelope()) - v(v5, DR.s3_envelope()), 2)),
            ('tray / sensor', v(T, DR.sensor_envelope())), ('tray / encoder', v(T, enc)), ('tray / collar and knob', v(T, p4.collar_knob())),
            ('standoffs / encoder, S3, sensor', v(so, enc + DR.s3_envelope() + DR.sensor_envelope())),
            ('case cleat / tray and its back screws', v(CLT.case_cleat(), T + screws())),
            ('screws / panel, S3, sensor, encoder', v(screws(), pan + DR.s3_envelope() + DR.sensor_envelope() + enc))]
    I = CB.items()
    tx1 = DR.S3_EDGE - 63.8 - 1.0
    I['power_bundle'] = I['power_bundle'].translate([(v6.TIE_X0 + tx1) / 2 - (p4.SEAM_BAR + 4.0 + tx1) / 2, 0, 0])
    worst = max(((m ^ (T + so)).volume(), n) for n, m in I.items() if not n.startswith('usb'))
    rows.append((f'cables and plugs (p4_cables) / tray, standoffs (worst: {worst[1]})', round(worst[0], 2)))
    # the right half slides onto the left sideways; the joined tray slides into the sleeve from the back past what is
    # already there (panel with its standoffs on the diffuser, the encoder hanging from the collar)
    rows.append(('right half slid on sideways (0.3-12 mm) / left half', round(max(v(R.translate([s, 0, 0]), L) for s in (0.3, 1, 3, 6, 9, 12)), 2)))
    fixed = pan + so + enc + dif
    rows.append(('tray sliding in from the back (1-60 mm out) / panel, standoffs, encoder, diffuser',
                 round(max(v(T.translate([0, s, 0]), fixed) for s in (1, 2, 4, 8, 16, 24, 32, 40, 50, 60)), 2)))
    info = dict(ties={k: (tie_length(v5, k), tie_length(T, k)) for k in ('top', 'bottom')},
                near_knob={k: (tie_length(v5, k, -40, 40), tie_length(T, k, -40, 40)) for k in ('top', 'bottom')},
                volume_cm3=(round(v5.volume() / 1000, 1), round(T.volume() / 1000, 1)),
                post_seat_from_back=round(DR.Y1 - (P3.FOOT_Y + FOOT_DY + P3.SO_FLOOR), 2), grid_h=DF.GRID_H,
                thread_mm=dict(knuckle=round(10.0 - (DR.Y1 - KN_Y1) - KN_CL - GUIDE_L, 2), tongue=round(10.0 - DR.TRAY_WT - v6.TONGUE_CL, 2),
                               tongue_tip_inside_boss=round(DR.TRAY_WT + v6.TONGUE_CL + v6.TONGUE_T + TONGUE_BOSS - 10.0, 2),
                               cleat=round(DR.Y1 - DR.Y0 + DR.CB_H - GUIDE_L, 2)))
    return rows, info


if __name__ == '__main__':
    import trimesh
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    L, R = halves()

    def save(m, name, frame=None):
        f = (frame if frame is not None else m).rotate([-90, 0, 0]).bounding_box()
        m = m.rotate([-90, 0, 0]).translate([-(f[0] + f[3]) / 2, -(f[1] + f[4]) / 2, -f[2]])
        me = m.to_mesh()
        t = trimesh.Trimesh(vertices=np.asarray(me.vert_properties)[:, :3], faces=np.asarray(me.tri_verts)); t.merge_vertices()
        t.export(f'{out}/{name}.stl')
        return f'{name}: {np.round(t.extents, 1).tolist()} on the bed, {m.volume() / 1000:.1f} cm3, {len(t.split(only_watertight=False))} body'
    print(save(L, 'p4-v55-tray-left')); print(save(R, 'p4-v55-tray-right'))
    print(save(DR.status_window(), 'p4-v55-tray-right-window', frame=R))
    rows, info = check()
    for name, val in rows:
        print(f'  {"ok  " if abs(val) < 0.05 else "HIT "} {name}: {val}')
    print('  louver span solid from wall to plate, mm (V5, V5.5):', info['ties'], '; within 40 mm of the centre:', info['near_knob'])
    print('  thread, mm:', info['thread_mm'])
    print('  PETG cm3 (V5 trays, V5.5):', info['volume_cm3'], '; panel screw seat', info['post_seat_from_back'], 'mm inside the back face; grid', info['grid_h'])
