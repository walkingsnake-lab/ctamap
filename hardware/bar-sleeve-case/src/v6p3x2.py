"""V6 for the 128 x 32 P3 bar (two Waveshare P3 64x32 side by side, 384 x 96), draft 3 (Nov 27, 2026). Units mm.

    python3 v6p3x2.py ../stl/p3x2-v6      # the print set (p3x2-v6-*.stl, reused parts and coupons included) and the checks

What it is: the single P3 V6 (v6p3.py) twice, joined at the panel seam (x = 0).
- **Walnut**: the P3 V6 sleeve drawn round the 128's bore (404 x 105.3) at the same 4 mm wall (412 x 113.3 x 69), with its
  rebate and seat, cut at x = 0 into two halves (each 206 wide: the X2D takes one whole), then made one sleeve again by
  two glued seam keys (owner, Nov 27: no glue and no threads in walnut were never hard rules; what matters is how it
  looks, without piling on screws).
  - The seam: butted, p3x2's 0.5 x 45 deg V-groove each side and hollowed faces (0.3 off except a 2 mm land along the
    edges you see). The faces stay dry: no glue in the line.
  - **Seam keys**: p3x2's joint plates, 96 x 1.2, PLA (it bonds to the wood PLA; PETG does not as well), one in a rebate
    across the seam inside the top wall and one inside the bottom, 0.1 under the bore. Glued to both halves with slow
    (30 minute) two-part epoxy, on the joined chassis as the jig. Not CA: it grabs in seconds and its fumes can bloom
    white on dark filament.
  - **One locator**: the sleeve seats on the chassis's lip all round and is drawn back by four flat heads from below
    (x +/-50, +/-142). Only half B's inner countersink is round; the other three are slots along x (SLOTS), because one
    412 mm sleeve cannot be pinned at four cones once walnut and PETG shrink differently. The lip stays relieved
    (END_RELIEF) round both outer ends' flats and corners.
- **Chassis**: two P3 V6 chassis, one per panel, cut at x = 0 (CH_GAP between them). B (right) is the single P3 V6
  chassis (S3, USB-C frame and stop, encoder slot, rails and ledges, sensor, status window, Boot). A (left) is the same
  tray with none of that, its posts at panel A's un-turned inserts (the P3 pair's data chain: B turned 180 deg).
  - **Tongues**: A's top and bottom walls run on TONGUE mm inside B's as solid lap tongues, two M3 x 10 flat heads each
    (staggered) through B's wall into inserts in the tongue, flush under the walnut.
  - **Back strap**: a flat PETG plate across the seam on the back plates, in the 4 mm inside the rim, two M3 x 10 flat
    heads into each half (inserts set from the back, into bosses). The tongues alone were weak against bending in plan
    (review, Nov 27); the strap is the tie at the back. The wall cleat is notched for it (wall_cleat_v6).
  - Every screw is the builds' black M3 x 10 flat head (DIN 7991) into an M3 x D5 x L4 insert.
- **Panels**: one splice plate (p3x2.py's) on each pair of inner corner inserts holds the rows level across the seam, under
  the inner standoffs, so those two posts' feet sit SPLICE_T further back.
- **Diffuser**: the P3 pair's two halves (p3x2.diffuser_halves), split joint only: each half ends in its own full-height
  grid wall at the seam (JOINT_WALL, a normal rib), so the seam cell is closed on both sides (owner, Nov 26). The rim and
  seat are the single P3 V6's (45 deg, v5 rim), not the 128 V5's 55 deg / 1.5: that was for a diffuser held by the rim,
  which pushed through under a thumb; in V6 it sits on the screwed-down panel RIM_GAP behind the rim, and the 55 deg seat
  is a 900 mm2 overhang in the back-down print. Print the halves from this set (BEV 0.6): the V5 pair's (BEV 0.2) meet
  the 45 deg rim.
- Knob 45 mm from the right end (x +161), sensor 40 inboard; V5's 30 mm knob and translucent collar, as the P3 V6.

Glue-up (once; try it on the seam coupon first: coupons/coupon-p3x2-v6-seam-*):
1. Join the chassis halves back-down on a flat surface: the tongues' and strap's eight inserts first (0.2 under the
   face), four tongue screws, the strap and its four.
2. Packing tape on the chassis's top and bottom walls across the seam (epoxy does not hold on it).
3. Slide both walnut halves on from the front and start all four screws from below, loose. Push A against B (or against
   a shim, up to 0.3, if a line looks better than the plain V: the coupon shows), then snug B's inner screw first.
4. Scuff the keys and their rebates, a thin coat of epoxy on each key, and in through the open front into its rebate
   (the panels are not in yet); press it home, wipe what squeezes out, tape or a spring clamp until it cures. A bead left
   to harden inside the bore keeps the chassis from sliding in.
5. Cured: screws out, sleeve off the chassis, tape off.
Assembly after that is the single P3 V6's: panel pair (splice plates, twelve standoffs, diffusers) into the sleeve and a
washer on each standoff; collar and encoder into half B; the joined chassis in from the back; twelve M3 x 8 from the
back, four flat heads from below (B's inner one first), then the knob. Service: the sleeve comes off in one piece.
"""
import json, math, os, subprocess, sys
STAGE = 'chassis' if '--chassis' in sys.argv else 'skin'
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ['CASE_WALL'] = '4.0'
# The walnut is one sleeve once its seam keys are glued (Nov 27), so it cannot be pinned at four cones: wood PLA and PETG
# shrink differently over the 284 mm between the outer screws. One round countersink locates it along the bar, half B's
# inner one (x +50: B has the knob, the sensor and the USB-C opening); the other three are slots along x, (toward -x,
# toward +x) of room each, sized for a walnut print 0 to SHRINK_MAX small and a seam shimmed 0 to SHIM_MAX at glue-up.
# All four still draw the sleeve back onto its seat (the bias is along y).
LOCATOR_X = 50.0
SLOTS = {-142: (-0.60, 0.35), -50: (-0.35, 0.35), 142: (-0.05, 0.30)}   # a small print's holes sit toward the locator: the slots reach away from it
SHRINK_MAX, SHIM_MAX = 0.003, 0.3
CH_GAP = 0.3                       # between the chassis halves
PANEL_CX = 96.0
SPLICE_T = 2.0                     # p3x2's splice plate

if STAGE == 'skin':
    os.environ['PANEL'] = 'p3x2'
    os.environ['P3X2_NO_PLATES'] = '1'
    os.environ['KNOB_X'] = '161'   # 45 from the right end at the 4 mm wall (412 wide); p3x2's 162 was its 5 mm wall's
    import numpy as np
    from manifold3d import Manifold
    import p3x2 as PX              # the 128 profile and its diffuser halves, the screws from below at +/-50, +/-142
    PX.V.set_seat()                # ... but the single P3 V6's rim and seat (45 deg), not the 128 V5's 55 deg (see the docstring)
    PX._DF.BEV = 0.6
    import v6p3 as S               # the P3 V6 sleeve, drawn on that bore
    from case import box, ADD
    import case as C
    import drawer as DR

    PX.JP_L = 96.0                  # 48 into each half (100 put the ends' edges on the countersinks' x, 50: a bad weld)
    PX.JP_Y1 = DR.Y1 - 5.0          # the keys' rebates end 3 mm in front of the back rebate's seat (p3x2's ran to 63)

    _csk_round = S.csk_under

    def csk_under(x, y):
        """v6p3.csk_under, or its slot along x for the three screws in SLOTS (cone and hole each hulled over the slot)"""
        if round(x) not in SLOTS:
            return _csk_round(x, y)
        e, bb = 0.02, S.UNDER_BIAS
        cone = lambda dx: (Manifold.cylinder(S.CSK_K + e, S.CSK_D / 2 + e, S.SKIN_CL_D / 2, 64).translate([0, 0, bb - e])
                           + Manifold.cylinder(bb + e, S.CSK_D / 2 + e, S.CSK_D / 2 + e, 64).translate([0, 0, -e])).translate([x + dx, y - bb, 0])
        hole = lambda dx: C.cyl_z(x + dx, y, -1, C.WALL + 1, S.SKIN_CL_D, 48)
        lo, hi = SLOTS[round(x)]
        return Manifold.batch_hull([cone(lo), cone(hi)]) + Manifold.batch_hull([hole(lo), hole(hi)])
    S.csk_under = csk_under

    def halves():
        """the sleeve cut at x = 0, butted: p3x2's V-groove (0.5 x 45 deg a side) and hollowed seam faces (0.3 off except a
        2 mm land along the edges you see, so two not-quite-flat faces close where it shows), and the keys' rebates"""
        sh = S.sleeve()
        s_ = sh - PX.v_groove(sh) - PX.hollow_cuts(sh) - Manifold.batch_boolean(PX.rebate_cuts(), ADD)
        a = s_ ^ box(-C.HW - 1, 0.0, -50, C.D + 1, -1, C.H + 1)
        b = s_ ^ box(0.0, C.HW + 1, -50, C.D + 1, -1, C.H + 1)
        big = lambda m: max(m.decompose(), key=lambda q: q.volume())
        return big(a), big(b)

    def diffusers():
        """the split diffuser halves in the case frame (built scale undone: the frame is the part as it comes off the bed)"""
        h = PX.diffuser_halves(split=True, wall=PX.JOINT_WALL)
        un = 1.0 / PX.DIFF_SCALE
        to_case = [[1, 0, 0, 0], [0, 0, 1, C.Y_FACE + S.RIM_GAP], [0, -1, 0, C.ZC]]
        return {k: v.scale([un, un, 1.0]).transform(to_case) for k, v in h.items()}, h

    def seam_walls(h):
        """each half's grid at the seam: the fraction of a slab a normal rib less 0.1 wide (0.5: the thinnest bead the grid
        prints) on its own side of x = 0, over the grid's full height and the lit rows, that is solid. 1.0 = a full wall on
        both halves; a rib split down the middle (0.3 each) fails"""
        import diffuser as DF
        out = {}
        w = PX.panel.P['rib'] - 0.1
        for side, x0, x1 in (('A', -w - 0.05, -0.05), ('B', 0.05, w + 0.05)):
            m = h[(side, 'black')].scale([1 / PX.DIFF_SCALE, 1 / PX.DIFF_SCALE, 1])
            slab = box(x0, x1, -DF.PH / 2 + 3.0, DF.PH / 2 - 3.0, PX.DIFF_FACE + 0.05, PX.DIFF_FACE + DF.GRID_H - 0.05)
            out[side] = round((m ^ slab).volume() / slab.volume(), 3)
        return out

    if __name__ == '__main__':
        import trimesh
        out = sys.argv[1] if len(sys.argv) > 1 else '.'
        fr = f'{out}/frames'
        os.makedirs(fr, exist_ok=True)
        a, b = halves()
        dif, h = diffusers()
        for n, m in (('sleeve-A', a), ('sleeve-B', b), ('diffuser-A', dif[('A', 'white')] + dif[('A', 'black')]),
                     ('diffuser-B', dif[('B', 'white')] + dif[('B', 'black')]),
                     ('keys', PX.joint_plate(True, PX.JP_L) + PX.joint_plate(False, PX.JP_L)),
                     ('splice-top', PX.splice_in_case(True).translate([0, S.RIM_GAP, 0])),
                     ('splice-bot', PX.splice_in_case(False).translate([0, S.RIM_GAP, 0]))):
            PX.tm(m).export(f'{fr}/{n}.stl')
        down = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
        for m, n in ((a, 'A'), (b, 'B')):
            t = PX.tm(m, down); t.apply_translation(-t.bounds[0]); t.export(f'{out}/p3x2-v6-sleeve-{n}-walnut.stl')
            print(f'p3x2-v6-sleeve-{n}-walnut', np.round(t.extents, 1).tolist(), 'watertight', t.is_watertight, f'{t.volume / 1000:.1f} cm3')
        for side in ('A', 'B'):
            w, k = PX.tm(h[(side, 'white')], process=True), PX.tm(h[(side, 'black')], process=True)
            lo = np.minimum(w.bounds[0], k.bounds[0])
            for col, t in (('white', w), ('black', k)):
                t.apply_translation(-lo); t.export(f'{out}/p3x2-v6-diffuser-{side}-{col}.stl')
            print(f'p3x2-v6-diffuser-{side}', np.round(k.extents, 1).tolist())
        for top, n in ((True, 'top'), (False, 'bottom')):
            t = PX.tm(PX.joint_plate(top, PX.JP_L)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/p3x2-v6-seam-key-{n}-pla.stl')
            print(f'p3x2-v6-seam-key-{n}', np.round(t.extents, 2).tolist())
        os.makedirs(f'{out}/coupons', exist_ok=True)                 # the seam coupon: both halves' top wall, 60 wide, and a 56 mm key
        for m, n in zip(PX.coupon(a, b), ('A', 'B')):
            t = PX.tm(m, down); t.apply_translation(-t.bounds[0]); t.export(f'{out}/coupons/coupon-p3x2-v6-seam-{n}-walnut.stl')
        t = PX.tm(PX.joint_plate(True, 56.0)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/coupons/coupon-p3x2-v6-seam-key-pla.stl')
        sp = [PX.tm(PX.splice_plate(PX.SPLICE_HOLE)) for _ in range(2)]
        PX.layout([sp], gap=6.0)
        trimesh.util.concatenate(sp).export(f'{out}/p3x2-v6-splice-plates-black.stl')
        json.dump(dict(hw=C.HW, h=C.H, d=C.D, zc=C.ZC, yf=DR.YF, y1=DR.Y1, kx=S.KX, sensor_x=S.V.SENSOR_X,
                       under=[list(q) for q in S.UNDER_XY], seam_walls=seam_walls(h), joint_wall=PX.JOINT_WALL,
                       split=True), open(f'{fr}/skin.json', 'w'), indent=1)
        print('diffuser seam walls (solid fraction, A / B):', seam_walls(h))
        env = dict(os.environ); env.pop('PANEL', None); env.pop('KNOB_X', None)
        sys.exit(subprocess.run([sys.executable, __file__, out, '--chassis'], env=env).returncode)

# ==================================================================== the chassis stage (PANEL=p3: one panel's frame)
os.environ['PANEL'] = 'p3'
import numpy as np
import trimesh
from manifold3d import Manifold, Mesh
import v6p3 as S                   # the P3 V6, knob at x 65 in panel B's frame = 161 in the case
from v6p3 import DR, P3, CO, SN, box, cyl_y, cyl_z, ADD, ZC, H, D, KY, BORE_HX, BORE_HZ, BORE_R, along_x, along_y, along_z
import panel

INS = panel.P['inserts']           # panel A, un-turned (the P3's own list); B's (turned) are DR.INSERTS
A_CORNERS = [max([q for q in INS if q[0] * sx > 0 and q[1] * sz > 0], key=lambda q: (abs(q[0]), abs(q[1]))) for sx in (-1, 1) for sz in (-1, 1)]
A_CENTRE = [q for q in INS if q not in A_CORNERS]
# the louver ties round the centre posts (v6p3.TIES, B's) mirrored for A's un-turned centre posts
A_TIES = dict(top=[(min(x for x, z in A_CENTRE if z > 0) - 8.0, min(x for x, z in A_CENTRE if z > 0) + 8.0)],
              bottom=[(min(x for x, z in A_CENTRE if z < 0) - 8.0, min(x for x, z in A_CENTRE if z < 0) + 8.0)])

# the joint (v6.tongue_legs' numbers)
TONGUE, TONGUE_T, TONGUE_CL = 16.0, 7.5, 0.15   # into B; thick (inner face 4 mm above the splice plates and inner posts); clear
TONGUE_SCREWS = ((12.0, 33.5), (4.5, 47.0))   # (x into B, y) of each tongue's two screws: staggered in x and y (review, Nov 27:
                                 # both at one x left a 10 mm couple against bending in plan), inside the 45 deg back edge
TONGUE_YS = tuple(y for _, y in TONGUE_SCREWS)
INS_RECESS = 0.2                   # the inserts set this far under the tongue's face: one left proud cannot hold the joint open
CSK_HEAD_K = 1.5                   # DIN 7991 M3: 6.0 head, 90 deg
TONGUE_ROOT = 10.0                 # how far back into A the tongues are rooted
SEAM_PAD_FREE = 14.0               # B has no pad strip within this of the seam (the joint screws' heads)
LEG_Y0, LEG_Y1 = None, None        # set below: behind the panel, in front of the louver band
STRAIGHT_X = 93.0                  # panel frame: the slab 92-93 lies past the inner posts (91.75), short of the corner (94.5)
INS_D, INS_DEPTH, INS_RELIEF = S.INS_D, S.INS_DEPTH, S.INS_RELIEF


def inner(c, side):
    return c[0] > 0 if side == 'A' else c[0] < 0


def end_relief(grow=0.0):
    """the outer end's flats and corners (v6p3.end_flats covers the flats only): the halves are placed sideways by their
    countersinks"""
    x0 = BORE_HX - BORE_R - 0.5 - grow
    return Manifold.batch_boolean([box(x0, BORE_HX + 5, 0, D + 1, -5, H + 5), box(-BORE_HX - 5, -x0, 0, D + 1, -5, H + 5)], ADD)


def chassis_half(side):
    """v6p3.chassis() in the panel's own frame, for B (everything) or A (no S3 or controls, un-turned posts), the two inner
    posts' feet SPLICE_T further back, the lip relieved round the outer end"""
    saved = DR.CORNERS, DR.FASTEN, DR.INSERT_D, DR.INSERT_L, S.KX, S.end_flats
    corners = list(DR.CORNERS) if side == 'B' else A_CORNERS
    centre = S.CENTRE_POSTS if side == 'B' else A_CENTRE
    allins = corners + centre
    DR.CORNERS = corners
    DR.FASTEN, DR.INSERT_D, DR.INSERT_L = S.FASTEN, INS_D, INS_DEPTH
    S.end_flats = end_relief
    if side == 'A':
        S.KX = 1e3                 # no knob: pads() keeps off nothing there
    try:
        dy = {c: S.FOOT_DY + (SPLICE_T if inner(c, side) else 0.0) for c in corners}
        kw = {} if side == 'B' else dict(s3=False, controls=False)
        t = DR.tray(post_dy=dy, ties=S.TIES if side == 'B' else A_TIES, blind=S.BLIND, boss_blind=True, **kw)
        with DR._foot(S.FOOT_DY):
            adds = [P3.standoff(x, z, DR.Y0) for x, z in centre]
            cuts = [cyl_y(x, ZC + z, P3.FOOT_Y + P3.SO_FLOOR + 0.02, DR.Y1 + 1, P3.SO_BORE + 0.04, 64) for x, z in centre]
        for x, z in allins:        # every post's hole again, with its bridge layers (v6p3.base_tray)
            with DR._foot(dy.get((x, z), S.FOOT_DY)):
                cuts.append(cyl_y(x, ZC + z, P3.FOOT_Y - 1.01, P3.FOOT_Y + P3.SO_FLOOR + 0.1, P3.SO_HOLE + 0.04, 32))
                ys, hh, lh, zc = P3.FOOT_Y + P3.SO_FLOOR, P3.SO_HOLE / 2 + 0.02, DR.BRIDGE_LH, ZC + z
                cuts.append(box(x - hh, x + hh, ys - lh, ys + 0.01, zc - P3.SO_BORE, zc + P3.SO_BORE) ^ cyl_y(x, zc, ys - 2 * lh, ys + 0.02, P3.SO_BORE - 0.06, 48))
                cuts.append(box(x - hh, x + hh, ys - 2 * lh, ys - lh + 0.01, zc - hh, zc + hh))
        t = (t + Manifold.batch_boolean(adds, ADD)) - Manifold.batch_boolean(cuts, ADD)
        if side == 'B':
            pf_add, pf_cut = S.port_frame()
            t = (t + pf_add + S.port_stop()) - pf_cut - S.s3_post_relief()
        t = t ^ S.prism_y(S.rr_cs(BORE_HX - DR.TRAY_CL, BORE_HZ - DR.TRAY_CL, BORE_R - DR.TRAY_CL), 0, D)
        t = t - box(-400, 400, 0, DR.YF + S.RIM_GAP + S.FRONT_CL, -5, H + 5)
        if side == 'B':
            t = t + S.at_knob(S.ledges())
        rec = S.WASHER_REC
        t = t - Manifold.batch_boolean([cyl_y(x, ZC + z, S.BOSS_Y + (SPLICE_T if (x, z) in dy and inner((x, z), side) else 0) - rec[1] - 1,
                                              S.BOSS_Y + (SPLICE_T if (x, z) in dy and inner((x, z), side) else 0), rec[0], 48) for x, z in allins], ADD)
        t = t + S.back_lip()
        pd = S.pads(t)
        if side == 'B':
            pd = pd - box(-200, -PANEL_CX + SEAM_PAD_FREE, -5, D + 5, -5, H + 5)
        t = t + pd + S.lands()
    finally:
        DR.CORNERS, DR.FASTEN, DR.INSERT_D, DR.INSERT_L, S.KX, S.end_flats = saved
    t = straight_end(t, -1 if side == 'B' else 1)
    return max(t.decompose(), key=lambda m: m.volume())


def straight_end(t, sx):
    """the seam end made straight: the single P3's tray turns its corner from |x| 94.5 (panel frame), 1.35 mm before the
    seam (96), which dipped the walls, the lip and the back plate by up to 0.08 outside and more inside. Everything past
    STRAIGHT_X toward the seam is replaced by a 1 mm slab inboard of it (walls, back plate, lip; no louver or pad reaches
    it, but B's top inner post foot grazes it: a 1.4 mm2 ridge along the back plate's inside, harmless), run on past the cut"""
    xs = sx * STRAIGHT_X
    c = xs - sx * 1.0                                          # a 1 mm slab inboard of xs, stretched outward about its inner face:
    slab = t ^ (box(c, xs, -50, 200, -50, 200) if sx > 0 else box(xs, c, -50, 200, -50, 200))   # its face there is
    k = (PANEL_CX + 2.0 - abs(c))                              # the kept part's cut face, vertex for vertex
    run = slab.translate([-c, 0, 0]).scale([k, 1, 1]).translate([c, 0, 0])
    keep = box(-400, c, -50, 200, -50, 200) if sx > 0 else box(c, 400, -50, 200, -50, 200)
    return (t ^ keep) + run


def joint():
    """(adds to A, cuts in A, cuts in B, screw ys), case frame: A's top and bottom walls run on inside B's as solid tongues,
    TONGUE_T thick, TONGUE_CL clear of B's wall, behind the panel and in front of the louver band. Their back edge (the
    print's underside: both halves print back-down) climbs 45 deg from A's end, so a tongue builds on itself with nothing
    under it. Two M3 x 10 flat heads each, through B's wall from outside, flush (under the walnut), into inserts set in
    the tongue's outer face. No bosses: the tongue is thick enough for the insert and the screw's tip"""
    global LEG_Y0, LEG_Y1
    cl, g = TONGUE_CL, CH_GAP / 2
    LEG_Y0 = S.PB + 1.0
    LEG_Y1 = DR.Y1 - DR.LV_DEPTH - 1.5 - 0.5
    x0, x1 = -g - TONGUE_ROOT, g + TONGUE
    adds, cut_a, cut_b = [], [], []
    ys = TONGUE_YS
    for sx_, y in TONGUE_SCREWS:
        xm = g + sx_
        assert y - INS_D / 2 - 1.5 >= LEG_Y0 and y + INS_D / 2 + 1.5 <= LEG_Y1 - (xm + INS_D / 2 + g), (sx_, y)
    for sz in (1, -1):
        zw = S.ZIN1 if sz > 0 else S.ZIN0                       # the wall's inner face
        za, zb = zw - sz * cl, zw - sz * (cl + TONGUE_T)       # the tongue's outer and inner face
        lap = [(x0, LEG_Y0), (x1, LEG_Y0), (x1, LEG_Y1 - (x1 + g)), (-g, LEG_Y1), (x0, LEG_Y1)]
        adds.append(along_z(lap, *sorted((za, zb))))
        adds.append(along_z([(x0, LEG_Y0), (-g, LEG_Y0), (-g, DR.Y1 - DR.LV_DEPTH + 0.5), (x0, DR.Y1 - DR.LV_DEPTH + 0.5)], *sorted((zw + sz * 0.01, zb))))
        # the root, in A, runs back into the louver band (solid there): it stands on it in the print
        for sx_, y in TONGUE_SCREWS:
            xm = g + sx_
            cut_a.append(cyl_z(xm, y, *sorted((za - sz * INS_DEPTH, za + sz * 0.01)), INS_D, 32))
            cut_a.append(cyl_z(xm, y, *sorted((zb - sz * 1.0, za + sz * 0.01)), INS_RELIEF, 32))
            zo = zw + sz * DR.TRAY_WT
            cut_b.append(cyl_z(xm, y, *sorted((zw - sz * 1.0, zo + sz * 1.0)), S.SKIN_CL_D, 32))
            cs = Manifold.cylinder(S.CSK_K + 0.01, S.SKIN_CL_D / 2, S.CSK_D / 2 + 0.01, 48)
            cut_b.append(cs.translate([xm, y, zo - S.CSK_K]) if sz > 0 else cs.mirror([0, 0, 1]).translate([xm, y, zo + S.CSK_K]))
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return u(adds), u(cut_a), u(cut_b), ys


def joint_screws(ys=None):
    """the four M3 x 10 flat heads (DIN 7991), seated flush in B's countersinks"""
    g = CH_GAP / 2
    out = []
    for sx_, y in TONGUE_SCREWS:
        xm = g + sx_
        for zo, sz in ((S.ZO1, 1), (S.ZO0, -1)):
            m = Manifold.cylinder(CSK_HEAD_K, 1.5, 3.0 - 0.02, 32).translate([0, 0, -CSK_HEAD_K]) + Manifold.cylinder(10.0, 1.5, 1.5, 24).translate([0, 0, -10.0])
            out.append((m if sz > 0 else m.mirror([0, 0, 1])).translate([xm, y, zo]))
    return Manifold.batch_boolean(out, ADD)


def insert_bodies():
    """the four inserts as set (INS_RECESS under the tongue's outer face, 4 long, 5.0 round)"""
    g = CH_GAP / 2
    out = []
    for sx_, y in TONGUE_SCREWS:
        for zw, sz in ((S.ZIN1, 1), (S.ZIN0, -1)):
            za = zw - sz * TONGUE_CL
            out.append(cyl_z(g + sx_, y, *sorted((za - sz * INS_RECESS, za - sz * (INS_RECESS + 4.0))), 4.4, 32))
    return Manifold.batch_boolean(out, ADD)


# the back strap (Nov 27): a flat PETG plate across the seam on the back plates' outer faces, in the 4 mm inside the rim,
# two M3 x 10 flat heads into each half (inserts set from the back into bosses inside the plate). It ties the halves at
# the back, 20-30 mm behind the tongues' screws: the couple against bending in plan that the tongues alone lacked
STRAP_HX, STRAP_HZ, STRAP_T = 19.0, 13.0, 3.0
STRAP_Z = 49.5                     # its centre: between the case cleats' inner ends (|x| 21), above the inner posts (z to 32).
                                   # The wall cleat lies on the back plate from z 30 to 74: it gets a notch (wall_cleat_v6)
STRAP_XZ = [(sx * 10.0, dz) for sx in (-1, 1) for dz in (-7.0, 7.0)]      # (x, z about ZC)
STRAP_BOSS = (9.0, 6.5)            # the bosses: diameter, height off the plate's inner face (the screw's tip ends 7 in)


def strap_bosses():
    """(adds, cuts) for both halves' back plates"""
    adds = [cyl_y(x, STRAP_Z + z, DR.Y0 - STRAP_BOSS[1], DR.Y0 + 0.01, STRAP_BOSS[0], 48) for x, z in STRAP_XZ]
    cuts = [cyl_y(x, STRAP_Z + z, DR.Y1 - INS_DEPTH - INS_RECESS, DR.Y1 + 0.01, INS_D, 32) for x, z in STRAP_XZ]
    cuts += [cyl_y(x, STRAP_Z + z, DR.Y0 - STRAP_BOSS[1] - 1, DR.Y1, INS_RELIEF, 32) for x, z in STRAP_XZ]
    return Manifold.batch_boolean(adds, ADD), Manifold.batch_boolean(cuts, ADD)


def strap():
    from manifold3d import CrossSection, JoinType
    cs = CrossSection.square([2 * STRAP_HX - 6, 2 * STRAP_HZ - 6], center=True).offset(3.0, JoinType.Round, circular_segments=32)
    m = Manifold.extrude(cs, STRAP_T).rotate([-90, 0, 0]).mirror([0, 0, 1]).translate([0, DR.Y1, STRAP_Z])
    yo = DR.Y1 + STRAP_T
    cuts = []
    for x, z in STRAP_XZ:
        cuts.append(cyl_y(x, STRAP_Z + z, DR.Y1 - 1, yo + 1, S.SKIN_CL_D, 32))
        cuts.append(Manifold.cylinder(S.CSK_K + 0.01, S.SKIN_CL_D / 2, S.CSK_D / 2 + 0.01, 48).rotate([-90, 0, 0]).translate([x, yo - S.CSK_K, STRAP_Z + z]))
    return m - Manifold.batch_boolean(cuts, ADD)


def strap_screws():
    yo = DR.Y1 + STRAP_T
    return Manifold.batch_boolean([Manifold.cylinder(CSK_HEAD_K, 1.5, 3.0 - 0.02, 32).rotate([-90, 0, 0]).translate([x, yo - CSK_HEAD_K, STRAP_Z + z])
                                   + cyl_y(x, STRAP_Z + z, yo - 10.0, yo, 3.0, 24) for x, z in STRAP_XZ], ADD)


def strap_inserts():
    return Manifold.batch_boolean([cyl_y(x, STRAP_Z + z, DR.Y1 - INS_RECESS - 4.0, DR.Y1 - INS_RECESS, 4.4, 32) for x, z in STRAP_XZ], ADD)


def wall_cleat_v6():
    """p3x2's 220 mm wall cleat with a notch for the back strap: cut right through between the case cleats' inner ends
    (they start at |x| 21), from 0.5 under the strap to the top, so the strap passes as the case is lifted off and
    nothing bridges in the print. A bar 6 mm tall joins the two sides along the bottom: still one piece to level.
    Its middle screw moves out of the notch: four wall screws, at +/-35 and +/-95"""
    import cleat as CLT
    wc = CLT.wall_cleat(hw=110.0, xs=[-95.0, -35.0, 35.0, 95.0])
    return wc - box(-STRAP_HX - 1.5, STRAP_HX + 1.5, DR.Y1 - 1, DR.Y1 + 50, STRAP_Z - STRAP_HZ - 0.5, H + 50)


def turn(m):
    """B's (turned) frame to A's un-turned panel: 180 deg about the case's depth axis through the panel's centre"""
    return m.rotate([0, 180, 0]).translate([0, 0, 2 * ZC])


def load(path):
    t = trimesh.load(path)
    return Manifold(Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))


def standoffs_side(side):
    """the six standoffs and washers for a panel, the inner corners' SPLICE_T further back (on the plate)"""
    af = S.STANDOFF_AF / math.sqrt(3)
    corners = list(DR.CORNERS) if side == 'B' else A_CORNERS
    ins = (list(DR.INSERTS) if side == 'B' else list(INS))
    out = []
    for x, z in ins:
        dy = SPLICE_T if ((x, z) in corners and inner((x, z), side)) else 0.0
        out.append(Manifold.cylinder(S.STANDOFF_L, af, af, 6).rotate([-90, 0, 0]).translate([x, S.PB + dy, ZC + z]))
        out.append(cyl_y(x, ZC + z, S.PB + dy + S.STANDOFF_L, S.PB + dy + S.STANDOFF_L + S.WASHER_T, 7.0, 32))
    return Manifold.batch_boolean(out, ADD)


def back_screws_side(side):
    corners = list(DR.CORNERS) if side == 'B' else A_CORNERS
    ins = (list(DR.INSERTS) if side == 'B' else list(INS))
    out = []
    for x, z in ins:
        dy = SPLICE_T if ((x, z) in corners and inner((x, z), side)) else 0.0
        seat = S.BOSS_Y + dy - S.WASHER_REC[1] + P3.SO_FLOOR
        out.append(cyl_y(x, ZC + z, seat - 8.0, seat, 3.0, 24) + cyl_y(x, ZC + z, seat, seat + 1.65, 6.9, 32))
    return Manifold.batch_boolean(out, ADD)


def build(fr):
    a = chassis_half('A').translate([-PANEL_CX, 0, 0]) ^ box(-500, -CH_GAP / 2, -50, 200, -50, 200)
    b = chassis_half('B').translate([PANEL_CX, 0, 0]) ^ box(CH_GAP / 2, 500, -50, 200, -50, 200)
    big = lambda m: max(m.decompose(), key=lambda q: q.volume())
    a, b = big(a), big(b)
    j_add, j_cut_a, j_cut_b, ys = joint()
    pre_b = b
    sb_add, sb_cut = strap_bosses()
    boss_hit = (sb_add ^ (a + b + j_add)).volume() - sum(math.pi * (STRAP_BOSS[0] / 2) ** 2 * 0.01 for _ in STRAP_XZ)
    a = big((a + j_add + (sb_add ^ box(-400, 0, -50, 200, -50, 200))) - j_cut_a - sb_cut)
    b = big((b + (sb_add ^ box(0, 400, -50, 200, -50, 200))) - j_cut_b - sb_cut)
    B = lambda m: m.translate([PANEL_CX, 0, 0])
    A = lambda m: turn(m).translate([-PANEL_CX, 0, 0])
    sa, sb = load(f'{fr}/sleeve-A.stl'), load(f'{fr}/sleeve-B.stl')
    P = dict(chassis_a=a, chassis_b=b, sleeve_a=sa, sleeve_b=sb, joint_add=j_add, joint_in_b=(j_add ^ pre_b).volume(), ys=ys,
             panel=A(S.panel_p3()) + B(S.panel_p3()),
             diffuser=load(f'{fr}/diffuser-A.stl') + load(f'{fr}/diffuser-B.stl'),
             splice=load(f'{fr}/splice-top.stl') + load(f'{fr}/splice-bot.stl'), keys=load(f'{fr}/keys.stl'),
             standoffs=standoffs_side('A').translate([-PANEL_CX, 0, 0]) + B(standoffs_side('B')),
             encoder=B(S.encoder()), collar=B(S.collar()), plain_collar=B(S.plain_collar()),
             s3=B(DR.s3_envelope()), sensor=B(DR.sensor_envelope() + DR.sensor_plugs()), sled=B(DR.sled()),
             back=back_screws_side('A').translate([-PANEL_CX, 0, 0]) + B(back_screws_side('B')),
             jscrews=joint_screws(), strap=strap(), strap_screws=strap_screws(), strap_bosses=sb_add, boss_hit=boss_hit)
    u = S.screws()['under']                                    # the two from below, per half
    P['under'] = u.translate([-PANEL_CX, 0, 0]) + B(u)
    return P


def check(P, sk):
    v = lambda a, b: round((a ^ b).volume(), 2)
    ca, cb, sa, sb = P['chassis_a'], P['chassis_b'], P['sleeve_a'], P['sleeve_b']
    ch, sl = ca + cb, sa + sb
    pan, dif, so, spl, enc = P['panel'], P['diffuser'], P['standoffs'], P['splice'], P['encoder']
    s3, sen, sled = P['s3'], P['sensor'], P['sled']
    inside = pan + dif + so + spl
    rows = []
    for n, m, want in (('chassis A', ca, DR.Y1), ('chassis B', cb, DR.Y1), ('sleeve A', sa, D), ('sleeve B', sb, D)):
        bb = m.bounding_box()
        rows.append((f'{n} on the bed (its back at {bb[4]:.3f}) and on the X2D ({bb[3] - bb[0]:.1f} x {bb[5] - bb[2]:.1f})',
                     round(abs(bb[4] - want) * 100, 2) + (0 if max(bb[3] - bb[0], bb[5] - bb[2]) <= 250 else 1)))
    for n, s_, c_ in (('A', sa, ca), ('B', sb, cb)):
        rows.append((f'sleeve {n} / chassis, seated', v(s_, ch)))
        rows.append((f'chassis {n} 0.1 further forward / sleeve {n} (its lip meets the seat: > 0)', 0.0 if v(c_.translate([0, -0.1, 0]), s_) > 0.2 else 1.0))
    rows.append(('walnut halves, butted at the seam', v(sa, sb)))
    under_sh = Manifold.batch_boolean([cyl_z(sx * x, DR.BOT_Y, -1, S.WALL + 1, 3.0, 32) for sx in (-1, 1) for x in (50.0, 142.0)], ADD)
    worst = 0.0
    for shrink in (0.0, SHRINK_MAX):
        for shim in (0.0, SHIM_MAX):                                # B about its locator; A about its seam face, against B's less the shim
            b_ = sb.translate([-LOCATOR_X, 0, 0]).scale([1 - shrink, 1, 1]).translate([LOCATOR_X, 0, 0])
            a_ = sa.scale([1 - shrink, 1, 1]).translate([LOCATOR_X * shrink - shim, 0, 0])
            worst = max(worst, v(under_sh, a_ + b_))
    rows.append((f'screws from below / walnut printed 0 to {SHRINK_MAX * 100:g} % small, seam shimmed 0 to {SHIM_MAX}: the slots take it', worst))
    st, ss, si = P['strap'], P['strap_screws'], strap_inserts()
    rows.append(('strap bosses / chassis (before they were added), panels, standoffs, splice plates, S3, sensor, sled, encoder',
                 round(P['boss_hit'] + (P['strap_bosses'] ^ (pan + so + spl + s3 + sen + sled + enc)).volume(), 2)))
    rows.append(('back strap / chassis, walnut, back screws', v(st, ch + sl + P['back'])))
    rows.append((f'back strap inside the rim (its face {D - DR.Y1 - STRAP_T:.1f} under the back edge)', 0.0 if DR.Y1 + STRAP_T <= D - 0.5 else 1.0))
    rows.append(('strap screws / strap, chassis outside the inserts', v(ss - si, st + ch)))
    rows.append(('strap inserts / chassis (their holes)', v(si, ch)))
    eng = (ss ^ si).volume() / (math.pi * 1.5 ** 2) / 4
    rows.append((f'strap screws: {eng:.2f} mm in each insert (3.5 or more)', 0.0 if eng >= 3.5 else round(3.5 - eng, 2)))
    keys = P['keys']
    rows.append(('seam keys / chassis', v(keys, ch)))
    rows.append(('seam keys / walnut (in their rebates)', v(keys, sl)))
    rows.append((f'seam keys: each half holds them ({v(keys, sa.translate([0, 0, 0.3])) > 0} / {v(keys, sb.translate([0, 0, 0.3])) > 0}: a 0.3 step at the seam hits)', 0.0 if v(keys, sa.translate([0, 0, 0.3])) > 0 and v(keys, sb.translate([0, 0, 0.3])) > 0 else 1.0))
    cg = ca.min_gap(cb, 2.0)
    rows.append((f'chassis A / B, joined: nearest {cg:.2f} (0.1 or more)', 0.0 if cg >= 0.1 else round(0.15 - cg, 2)))
    rows.append(('the joint\'s tongues and lap / chassis B before its cuts (they sit in clear space)', round(P['joint_in_b'], 2)))
    js, ins = P['jscrews'], insert_bodies()
    rows.append(('joint screws (DIN 7991 heads) / chassis B (holes and countersinks open)', v(js, cb)))
    rows.append(('joint screws / chassis A, outside the inserts (insert holes and reliefs open)', v(js - ins.translate([0, 0, 0]), ca)))
    rows.append(('inserts, set 0.2 under / chassis A, B (their holes)', v(ins, ca + cb)))
    rows.append(('joint screws / walnut, panels, splice plates, S3, sensor', v(js, sl + pan + spl + s3 + sen)))
    eng = (js ^ ins).volume() / (math.pi * 1.5 ** 2) / 4                 # mm of thread per screw inside its insert
    rows.append((f'joint screws: {eng:.2f} mm in each insert (3.5 or more of its 4)', 0.0 if eng >= 3.5 else round(3.5 - eng, 2)))
    tip = min(abs(S.ZO1 - 10.0 - (S.ZIN1 - TONGUE_CL - TONGUE_T)), abs(S.ZO0 + 10.0 - (S.ZIN0 + TONGUE_CL + TONGUE_T)))
    rows.append((f'joint screws\' tips {tip:.2f} inside the tongue\'s inner face', 0.0 if S.ZO1 - 10.0 > S.ZIN1 - TONGUE_CL - TONGUE_T else 1.0))
    rows += [('chassis / panels', v(ch, pan)), ('chassis / diffusers', v(ch, dif)), ('sleeve / diffusers', v(sl, dif)),
             ('sleeve 0.1 further back / diffusers (the rim keeps at least that)', v(sl.translate([0, 0.1, 0]), dif)),
             ('diffusers 0.25 further back / chassis', v(dif.translate([0, 0.25, 0]), ch)),
             ('chassis / standoffs', v(ch, so)), ('chassis / splice plates', v(ch, spl)),
             ('splice plates / standoffs', v(spl, so)), ('splice plates / panels', v(spl, pan)),
             ('chassis / sensor and plugs', v(ch, sen)), ('chassis / sled', v(ch, sled)),
             ('chassis / encoder and its plug, seated', v(ch, enc)),
             ('collar, less its crush ribs / sleeve, chassis, encoder', v(P['plain_collar'], sl + ch + enc)),
             ('encoder / panels, S3, sensor, sled, splice plates', v(enc, pan + s3 + sen + sled + spl)),
             ('screws from below / sleeve and chassis', v(P['under'], ch + sl)),
             ('back screws / chassis (holes open; the posts\' bridge layers at both seat depths aside)',
              v(P['back'], ch - Manifold.batch_boolean([box(-400, 400, sd - 0.01, sd + 0.03, -5, H + 5) for sd in
                                                         (S.BOSS_Y - S.WASHER_REC[1] + P3.SO_FLOOR, S.BOSS_Y + SPLICE_T - S.WASHER_REC[1] + P3.SO_FLOOR)], ADD))),
             ('back screws / panels, S3, sensor, encoder', v(P['back'], pan + s3 + sen + enc))]
    # the ways in: the panel pair (spliced) into both halves, then the joined chassis past the hung encoder
    steps = (0.3, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 40, 50, 60, 70)
    rows.append(('panel pair, standoffs, splice plates, diffusers into the walnut first (0.3-70 out)', round(max(v(inside.translate([0, q, 0]), sl) for q in steps), 2)))
    cha = ch + s3 + sen + sled
    rows.append(('joined chassis sliding in past the encoder and the seated panels (0.3-70 out)', round(max(v(cha.translate([0, q, 0]), sl + P['collar'] + enc + inside) for q in steps), 2)))
    rows.append((f'encoder {S.LEDGE_GAP + 0.1:.1f} lower (a knob press) / chassis: the ledges take it (> 0)', 0.0 if v(enc.translate([0, 0, -S.LEDGE_GAP - 0.1]), ch) > 0.05 else 1.0))
    for n, s_, c_, sx in (('A', sa, ca, -1), ('B', sb, cb, 1)):
        xr = PANEL_CX + BORE_HX - BORE_R + 0.5               # the relieved outer end (end_relief)
        reg = box(xr, 400, -5, D + 5, -5, H + 5) if sx > 0 else box(-400, -xr, -5, D + 5, -5, H + 5)
        eg = (c_ ^ reg).min_gap(s_, 1.0)
        rows.append((f'half {n}: lip round the outer end {eg:.2f} off the seat (0.1 or more: placed by its screws)', 0.0 if eg >= 0.1 else round(0.15 - eg, 2)))
    for n, m in (('A', ca), ('B', cb)):
        va = S.vent_area(m.translate([PANEL_CX if n == 'A' else -PANEL_CX, 0, 0]))
        rows.append((f'louvers, half {n}: {va:.0f} mm2 (the single P3 V6: 2376; at least {S.VENT_MIN:.0f} less the cut ends)', 0.0 if va >= S.VENT_MIN - 150 else round(S.VENT_MIN - va, 1)))
    w = sk['seam_walls']
    rows.append((f'diffuser seam: a full grid wall on each half (solid A {w["A"]}, B {w["B"]})', 0.0 if min(w.values()) >= 0.98 and sk['split'] else 1.0))
    return rows


if __name__ == '__main__':
    out = [x for x in sys.argv[1:] if not x.startswith('--')][0]
    fr = f'{out}/frames'
    sk = json.load(open(f'{fr}/skin.json'))
    assert abs(sk['yf'] - DR.YF) < 1e-6 and abs(sk['zc'] - ZC) < 1e-6 and abs(sk['y1'] - DR.Y1) < 1e-6, sk
    assert abs(sk['kx'] - (S.KX + PANEL_CX)) < 1e-6, (sk['kx'], S.KX)
    P = build(fr)

    def save(m, name, frame=None):
        mm = m.rotate([-90, 0, 0]); ref = (frame if frame is not None else m).rotate([-90, 0, 0])
        me = mm.to_mesh()
        t = trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3], np.asarray(me.tri_verts)); t.merge_vertices()
        b = ref.bounding_box()
        t.apply_translation([-(b[0] + b[3]) / 2, -(b[1] + b[4]) / 2, -b[2]]); t.export(f'{out}/{name}.stl')
        print(f'{name}: {np.round(t.extents, 1).tolist()}, {m.volume() / 1000:.1f} cm3, {len(t.split(only_watertight=False))} body')
    save(P['chassis_a'], 'p3x2-v6-chassis-A-black')
    save(P['chassis_b'], 'p3x2-v6-chassis-B-black')
    me = P['strap'].rotate([90, 0, 0]).to_mesh(); t = trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3], np.asarray(me.tri_verts)); t.merge_vertices()
    t.apply_translation(-t.bounds[0]); t.export(f'{out}/p3x2-v6-back-strap-black.stl'); print('back strap', np.round(t.extents, 1).tolist())
    reg = box(-30, 30, -50, 200, S.ZO1 - 14.0, H + 5)                # the seam coupon's chassis: both top walls, the tongue and its two screws
    save(P['chassis_a'] ^ reg, 'coupons/coupon-p3x2-v6-seam-chassis-A-black')
    save(P['chassis_b'] ^ reg, 'coupons/coupon-p3x2-v6-seam-chassis-B-black')
    save(DR.status_window().translate([PANEL_CX, 0, 0]), 'p3x2-v6-chassis-B-window-translucent', frame=P['chassis_b'])
    t = CO.export(CO.collar(), f'{out}/p3x2-v6-encoder-collar-translucent.stl'); print('collar', np.round(t.extents, 1).tolist())
    me = DR.sled().to_mesh(); t = trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3], np.asarray(me.tri_verts)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/p3x2-v6-sensor-sled-black.stl')
    import shutil, cleat as CLT
    wc = wall_cleat_v6()                                         # one 220 mm wall cleat: catches both case cleats
    me = wc.rotate([-90, 0, 0]).to_mesh(); t = trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3], np.asarray(me.tri_verts)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/p3x2-v6-cleat-wall-black.stl')
    for a, b in (('bar-knob', 'knob-white'), ('v5-drawer/bar-cleat-case', 'cleat-case-black-x2'), ('bar-boot-key', 'boot-key')):
        shutil.copyfile(os.path.join(HERE, '..', 'stl', a + '.stl'), os.path.join(out, f'p3x2-v6-{b}.stl'))
    # hung on the wall: both case cleats on the one wall cleat
    cc = CLT.case_cleat()
    hung = [P['strap'], P['strap_screws'], P['chassis_a'], P['chassis_b'], P['sleeve_a'], P['sleeve_b'], cc.translate([-PANEL_CX, 0, 0]), cc.translate([PANEL_CX, 0, 0])]
    seated = lambda dz=0.0: round(sum((m.translate([0, 0, dz]) ^ wc).volume() for m in hung), 2)
    rows = check(P, sk)
    rows.append(('case cleats / back strap and its screws', round(sum((cc.translate([s_ * PANEL_CX, 0, 0]) ^ (P['strap'] + P['strap_screws'])).volume() for s_ in (-1, 1)), 2)))
    rows.append(('case cleats / chassis and back screws', round(sum(((cc.translate([s * PANEL_CX, 0, 0])) ^ (P['chassis_a'] + P['chassis_b'] + P['back'])).volume() for s in (-1, 1)), 2)))
    rows.append(('wall cleat / everything hung', seated()))
    rows.append((f'lifted straight off the wall cleat (0.5 to {CLT.hook() + 6:.0f})', max(seated(q) for q in np.arange(0.5, CLT.hook() + 6.01, 0.5))))
    print(dict(case=[round(2 * sk['hw'], 1), round(sk['h'], 1), sk['d']], knob_x=sk['kx'], sensor_x=sk['sensor_x'], 
               tongue_y=(round(LEG_Y0, 2), round(LEG_Y1, 2)), joint_screws_y=[round(y, 1) for y in P['ys']]))
    hits = 0
    for name, val in rows:
        print(f'  {"ok  " if val < 0.05 else "HIT "} {name}: {val}')
        hits += val >= 0.05
    print('PASS' if not hits else f'FAIL ({hits})')
    sys.exit(1 if hits else 0)
