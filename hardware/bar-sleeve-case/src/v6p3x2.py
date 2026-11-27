"""V6 for the 128 x 32 P3 bar (two Waveshare P3 64x32 side by side, 384 x 96), draft 8 (Nov 27, 2026). Units mm.

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
  - **Labels**: marks.py's two recesses under half B (setup sticker 1/2 x 1 3/4 in, regulatory label 1 x 2 5/8 in, 0.5
    deep), as on the V5 shells and the P4: label_cuts().
- **Chassis**: two P3 V6 chassis, one per panel, cut at x = 0 (CH_GAP between them). B (right) is the single P3 V6
  chassis (S3, USB-C frame and stop, encoder slot, rails and ledges, sensor, status window, Boot). A (left) is the same
  tray with none of that, its posts at panel A's un-turned inserts (the P3 pair's data chain: B turned 180 deg).
  - **Tongues**: A's top and bottom walls run on TONGUE mm inside B's as solid lap tongues, two M3 x 10 flat heads each
    (staggered) through B's wall into inserts in the tongue, flush under the walnut.
  - **Knuckles**: the P4 V6's, two of them: blocks on A's back plate reach 9 mm past the seam into notches in B's, under
    bridges inside B; one M3 x 10 flat head from the back through each block into an insert in its bridge, flush. The
    tongues alone were weak against bending in plan (review, Nov 27); the knuckles are the tie at the back. Nothing
    stands outside the back plates.
- **Cleats**: the P4 V6's design (60 deg bevel, pockets in the wall cleat, a stop against sliding along it), the wall
  cleat 300 mm long with three screws: see cleats(). Wall anchors: self-drilling or molly, not small plastic cones.
- **USB-C cable**: a right-angle plug (the port's long side is vertical: the usual kind turns the cable back toward the
  wall), then behind the bar and along a channel in the wall cleat's wall face, down through a slot in its floor (four to
  choose from). Lay it in before the cleat goes on the wall; leave ~30 mm of slack at the plug for the 17 mm lift.
  - Every screw is the builds' black M3 x 10 flat head (DIN 7991) into an M3 x D5 x L4 insert.
- **Panels**: one splice plate (p3x2.py's, 1.6 thick here) on each pair of inner corner inserts holds the rows level across the seam, under
  the inner standoffs, so those two posts' feet sit SPLICE_T further back.
- **Diffuser**: the P3 pair's two halves (p3x2.diffuser_halves), split joint only: each half ends in its own full-height
  grid wall at the seam (JOINT_WALL, a normal rib), so the seam cell is closed on both sides (owner, Nov 26). The rim and
  seat are the single P3 V6's (45 deg, v5 rim), not the 128 V5's 55 deg / 1.5: that was for a diffuser held by the rim,
  which pushed through under a thumb; in V6 it sits on the screwed-down panel RIM_GAP behind the rim, and the 55 deg seat
  is a 900 mm2 overhang in the back-down print. Print the halves from this set (BEV 0.6): the V5 pair's (BEV 0.2) meet
  the 45 deg rim.
- Knob 45 mm from the right end (x +161), sensor 40 inboard; V5's 30 mm knob and translucent collar, as the P3 V6.

Glue-up (once; try it on the seam coupon first: coupons/coupon-p3x2-v6-seam-*):
1. Join the chassis halves back-down on a flat surface: six inserts first (four in the tongues, 0.2 under the face;
   two in B's knuckle bridges, pressed in from the back through the notches), slide A's tongues and blocks into B
   along the bar, then four tongue screws and two knuckle screws.
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
LABEL_CX = 110.0                   # the label recesses' centre along the bar (p3x2's: 96, on panel B's centre)
CH_GAP = 0.3                       # between the chassis halves
PANEL_CX = 96.0
SPLICE_T = 1.6                     # the splice plates (p3x2's are 2.0): at 2.0 the inner posts' back-screw heads stood 0.2 proud of
                                   # the back plate, under the wall cleat's face (review, Nov 27); at 1.6 they end 0.2 inside it

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

    PX.SPLICE_T = SPLICE_T
    S.LABELS = False                # the single's centred label recesses would cross the seam: label_cuts() below
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

    def label_cuts():
        """the two label recesses under the bar (marks.py: the setup sticker and the regulatory label, 0.5 deep), as on the
        V5 shells and the P4: under half B, in front of the screws from below, LABEL_CX along the bar so they clear the
        bottom seam key's rebate (to x 48) and the wall keeps its 4 mm less the recess everywhere"""
        import marks as MK
        MK.CX = LABEL_CX
        items = MK.layout()[0]
        bad = MK.check(items)
        assert not bad, bad
        cut = MK.cuts()
        keep = Manifold.batch_boolean(PX.rebate_cuts() + [csk_under(x, y) for x, y in S.UNDER_XY], ADD)
        gap = cut.min_gap(keep, 5.0)
        assert gap >= 1.5, f'label recesses {gap:.2f} from the key rebate or the screws from below'
        return cut

    def halves():
        """the sleeve cut at x = 0, butted: p3x2's V-groove (0.5 x 45 deg a side) and hollowed seam faces (0.3 off except a
        2 mm land along the edges you see, so two not-quite-flat faces close where it shows), and the keys' rebates"""
        sh = S.sleeve()
        s_ = sh - PX.v_groove(sh) - PX.hollow_cuts(sh) - Manifold.batch_boolean(PX.rebate_cuts(), ADD)
        a = s_ ^ box(-C.HW - 1, 0.0, -50, C.D + 1, -1, C.H + 1)
        b = s_ ^ box(0.0, C.HW + 1, -50, C.D + 1, -1, C.H + 1)
        b = b - label_cuts()
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
        if os.environ.get('V6P3X2_PREVIEW'):                        # the underside as marks.py draws it (render_v6p3x2.py's 8th image)
            import marks as MK
            MK.preview(a + b, os.environ['V6P3X2_PREVIEW'], px=0.12, stickers=True, title='128 P3 V6, underneath (front edge at the top)')
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


# The knuckles on the back plate (Nov 27: the P4 V6's, p4v55.knuckles, on this chassis; they replace a strap screwed on
# outside). A's plate carries blocks that reach KN_BLOCK past the seam, on the print bed; B's plate is notched for each
# and bridges over it between two piers. One M3 x 10 flat head from the back through each block into an insert pressed
# into the bridge's underside (through the notch, before the halves are joined), its head flush. They tie the halves at
# the back, 15-30 mm behind the tongues' screws: the couple against bending in plan the tongues alone lacked.
# (z, block half height, pier). Two, not the P4's three: the P3's back is 96 tall, and between the inner posts (to z 32.2
# and from 81) and the ribbons crossing the seam at mid height (z ~49 to 69, in front of the bridges) there is room for two
KNUCKLES = ((40.5, 4.5, 2.5), (72.7, 4.5, 2.5))
KN_BLOCK, KN_CL, KN_GAP = 9.0, 0.2, 0.5      # reach past the seam; clearance round a block; block to bridge (v6.KN_GAP)
KN_Y1 = DR.Y1 - 4.0                          # the blocks' inner face: 4 mm blocks (the 2 mm plate and 2 more)
KN_ROOF = KN_Y1 - KN_GAP                     # the bridges' underside
KN_Y0 = KN_ROOF - INS_DEPTH                  # ... and their front face: the insert's hole runs through
KN_SCREW_X = KN_BLOCK / 2 + 0.3


def knuckles():
    """(A adds, A cuts, B adds, B cuts), case frame: p4v55.knuckles() with inserts, about the seam at x = 0"""
    la, lc, ra, rc = [], [], [], []
    xs, lh, g = KN_SCREW_X, DR.BRIDGE_LH, CH_GAP / 2
    for zc, hz, pier in KNUCKLES:
        la.append(box(-8.0, KN_BLOCK, KN_Y1, DR.Y1, zc - hz, zc + hz))
        lc.append(cyl_y(xs, zc, KN_Y1 - 1, DR.Y1 + 1, S.SKIN_CL_D, 32))
        lc.append(Manifold.cylinder(S.CSK_K + 0.01, S.SKIN_CL_D / 2, S.CSK_D / 2 + 0.01, 48).rotate([-90, 0, 0]).translate([xs, DR.Y1 - S.CSK_K, zc]))
        z0, z1 = zc - hz - KN_CL, zc + hz + KN_CL
        cav = box(-0.01, KN_BLOCK + KN_CL, KN_ROOF, DR.Y1 + 0.01, z0, z1)
        ra.append(box(g, KN_BLOCK + KN_CL + 2.0, KN_Y0, DR.Y0 + 0.01, z0 - pier, z1 + pier) - cav)
        rc.append(cav)
        r = INS_D / 2
        rc.append(cyl_y(xs, zc, KN_Y0 - 1, KN_ROOF - INS_DEPTH + 0.01, INS_RELIEF, 32))       # room for the screw's tip
        rc.append(cyl_y(xs, zc, KN_ROOF - INS_DEPTH, KN_ROOF - 2 * lh + 0.01, INS_D, 32))     # the insert
        rc.append(box(xs - r, xs + r, KN_ROOF - lh, KN_ROOF + 0.01, z0 - 0.01, z1 + 0.01))    # layer 1: strands pier to pier
        rc.append(box(xs - r, xs + r, KN_ROOF - 2 * lh, KN_ROOF - lh + 0.01, zc - r, zc + r)) # layer 2: across them
    u = lambda l: Manifold.batch_boolean(l, ADD)
    return u(la), u(lc), u(ra), u(rc)


def knuckle_screws():
    return Manifold.batch_boolean([Manifold.cylinder(CSK_HEAD_K, 1.5, 3.0 - 0.02, 32).rotate([-90, 0, 0]).translate([KN_SCREW_X, DR.Y1 - CSK_HEAD_K, zc])
                                   + cyl_y(KN_SCREW_X, zc, DR.Y1 - 10.0, DR.Y1, 3.0, 24) for zc, _, _ in KNUCKLES], ADD)


def knuckle_inserts():
    """as set: INS_RECESS above the bridge's underside, 4 long"""
    return Manifold.batch_boolean([cyl_y(KN_SCREW_X, zc, KN_ROOF - INS_RECESS - 4.0, KN_ROOF - INS_RECESS, 4.4, 32) for zc, _, _ in KNUCKLES], ADD)


# The cleats (Nov 27): the P4 V6's (p4.py, Nov 17) on this back. A 60 deg bevel (about 17 mm of lift to unhook, V5's 45
# deg: 10), pockets in the wall cleat's wall face, a flat counterbore wide enough for a flanged head, two wall screws.
# The stop: the P4's wall cleat has one outside each end of its single case cleat. Here the two case cleats (x 21 to 171
# each side) run past the wall cleat's ends, so the stop is one block between their inner ends: plugging in the USB-C at
# the right end pushes the bar toward -x and the right case cleat's inner end lands on it; pulling the plug, the left one's.
# Review, Nov 27 (independent, of the 220 mm cleat with screws at +/-95, z 42): the mechanism is right and safe (about 1 kg
# hung), but the cleat ended 51 mm short of the knob, so a firm press there (about 2.2 x the weight) rocked the bar on the
# cleat's end; its screws sat 12 mm above its bottom edge, poor leverage for the anchors; and 0.5 at the stop was tight
# for hanging blind. So: 300 mm long (rocks at about 13.6 x the weight; it prints on the bed's diagonal, as the P4's
# walnut halves do), screws at +/-135 and one at the centre for a stud, at z WALL_SCREW_Z, and 0.8 at the stop.
CLEAT_BEVEL = 60.0
CLEAT_STOP = (0.8, 5.0)            # clearance to each case cleat's inner end, lead-in
CLEAT_POCKETS = (8.0, 4.0)         # depth (of 12), rib
WALL_CLEAT_HW, WALL_CLEAT_XS = 150.0, (-135.0, 0.0, 135.0)
# The USB-C cable (Nov 27): from a right-angle plug at the right end it turns back to the wall, runs behind the bar (12 mm
# between the back plate and the wall, 8 behind the walnut's rim) and into a channel in the wall cleat's wall face: under
# the screws, through the pockets' ribs, the cleat's full length, with slots down through its floor where the cable can
# drop (or it runs on out of the left end). Laid in before the cleat is screwed to the wall; the wall closes it. Hooks
# under the cleat's bottom edge were drawn first: the walnut's bottom rim sweeps that space as the bar is lifted on and
# off, and they could not print without supports. The channel is a groove in the face that prints upward.
CABLE_CH = (5.0, 6.5, 6.5)         # the channel: its floor this far above the cleat's bottom edge, its height, its depth from the wall
CABLE_D = 5.5                      # the thickest cable it is checked for
CABLE_EXITS = (-110.0, -25.0, 25.0, 110.0)   # x of the slots down through the floor (7 wide)
WALL_SCREW_Z = 50.0                # the wall screws' height (cleat.py's default: 42.2, the middle of the wall face): 20 mm above the bottom edge


def cleats():
    """(case cleat in its panel's frame, wall cleat in the case frame)"""
    import cleat as CLT
    CLT.BEVEL_DEG, CLT.WALL_STOPS, CLT.WALL_POCKETS, CLT.CBORE_D = CLEAT_BEVEL, None, CLEAT_POCKETS, 7.4
    CLT.wall_screws = lambda xs=None: [(x, WALL_SCREW_Z) for x in (WALL_CLEAT_XS if xs is None else xs)]
    assert WALL_SCREW_Z + CLT.WS_D / 2 + 1.5 <= CLT.ZB - CLT.drop(), 'the wall screws come out through the bevel'
    wc = CLT.wall_cleat(hw=WALL_CLEAT_HW, xs=list(WALL_CLEAT_XS))
    cl, lead = CLEAT_STOP
    xe = PANEL_CX - DR.CLEAT_HW - cl                                  # the stop's faces, +/- this
    ztop = CLT.ZB - CLT.tip_z()
    v = CLT.poly([(CLT.YW, CLT.ZB - CLT.drop() - 0.01), (DR.Y1 + CLT.TIP - 0.01, ztop), (CLT.YW, ztop)])   # the V above the bevel
    blk = CLT.prism_x(v, -xe, xe)
    w = Manifold.extrude(CLT.poly([(0, 0), (lead, 0), (0, -lead)]), 3 * CLT.T).rotate([90, 0, 0]).translate([0, CLT.YW + CLT.T, ztop + 0.01])
    blk = blk - w.translate([-xe, 0, 0]).mirror([1, 0, 0]) - w.translate([-xe, 0, 0])   # its faces lean away from the cleats toward the top
    z0, zh, dp = CABLE_CH
    za = CLT.ZW0 + z0
    assert za + zh + 3.0 <= WALL_SCREW_Z - CLT.WS_D / 2, 'the cable channel reaches the wall screws'
    cut = [box(-WALL_CLEAT_HW - 1, WALL_CLEAT_HW + 1, CLT.YW - dp, CLT.YW + 1, za, za + zh)]
    cut += [box(x - 3.5, x + 3.5, CLT.YW - dp, CLT.YW + 1, CLT.ZW0 - 1, za + 0.01) for x in CABLE_EXITS]
    return CLT.case_cleat(), (wc + blk) - Manifold.batch_boolean(cut, ADD), CLT


def cable(exit_x):
    """a CABLE_D cable from the right end behind the bar, along the channel and down the slot at exit_x"""
    import cleat as CLT
    z0, zh, dp = CABLE_CH
    y, z = CLT.YW - CABLE_D / 2 - 0.3, CLT.ZW0 + z0 + zh / 2
    run = Manifold.cylinder(PANEL_CX + BORE_HX + 4.0 - exit_x, CABLE_D / 2, CABLE_D / 2, 24).rotate([0, 90, 0]).translate([exit_x, y, z])
    return run + cyl_z(exit_x, y, -5.0, z, CABLE_D, 24)


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
    kl_add, kl_cut, kr_add, kr_cut = knuckles()
    inside_plate = box(-400, 400, -50, DR.Y0 - 0.02, -50, 200)        # what the knuckles add in front of the back plates
    kn_hit = ((kl_add ^ inside_plate) ^ a).volume() + ((kr_add ^ inside_plate) ^ (b + j_add)).volume()
    a = big((a + j_add + kl_add) - j_cut_a - kl_cut)
    b = big(((b - kr_cut) + kr_add) - j_cut_b - kr_cut)
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
             jscrews=joint_screws(), kn_screws=knuckle_screws(), kn_adds=(kl_add + kr_add) ^ inside_plate, kn_hit=kn_hit)
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
    ks, ki, kn = P['kn_screws'], knuckle_inserts(), P['kn_adds']
    rows.append(('knuckles (inside the back plates) / chassis before they were added, panels, standoffs, splice plates, S3, sensor, sled, encoder',
                 round(P['kn_hit'] + (kn ^ (pan + so + spl + s3 + sen + sled + enc)).volume(), 2)))
    rows.append(('knuckle screws (DIN 7991 heads) / chassis outside the inserts, back screws', v(ks - ki, ch + P['back'])))
    rows.append(('knuckle inserts, set 0.2 in / chassis (their holes)', v(ki, ch)))
    eng = (ks ^ ki).volume() / (math.pi * 1.5 ** 2) / len(KNUCKLES)
    rows.append((f'knuckle screws: {eng:.2f} mm in each insert (3.5 or more)', 0.0 if eng >= 3.5 else round(3.5 - eng, 2)))
    bk = ca.bounding_box()[4]
    rows.append((f'knuckle blocks on the bed with the plate (A\'s back {bk:.3f})', round(abs(bk - DR.Y1) * 100, 2)))
    rows.append(('chassis A slid out along the bar (0.5-30 mm) / chassis B: tongues and knuckles go together that way',
                 round(max(v(ca.translate([-q, 0, 0]), cb) for q in (0.5, 1, 2, 4, 6, 8, 10, 14, 18, 24, 30)), 2)))
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
    reg = box(-30, 30, -50, 200, S.ZO1 - 14.0, H + 5)                # the seam coupon's chassis: both top walls, the tongue and its two screws
    save(P['chassis_a'] ^ reg, 'coupons/coupon-p3x2-v6-seam-chassis-A-black')
    save(P['chassis_b'] ^ reg, 'coupons/coupon-p3x2-v6-seam-chassis-B-black')
    save(DR.status_window().translate([PANEL_CX, 0, 0]), 'p3x2-v6-chassis-B-window-translucent', frame=P['chassis_b'])
    t = CO.export(CO.collar(), f'{out}/p3x2-v6-encoder-collar-translucent.stl'); print('collar', np.round(t.extents, 1).tolist())
    me = DR.sled().to_mesh(); t = trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3], np.asarray(me.tri_verts)); t.apply_translation(-t.bounds[0]); t.export(f'{out}/p3x2-v6-sensor-sled-black.stl')
    import shutil
    cc, wc, CLT = cleats()
    for m, n, rot in ((cc, 'cleat-case-black-x2', -90), (wc, 'cleat-wall-black', 90)):     # case cleat wall face down; wall cleat front face down
        me = m.rotate([rot, 0, 0]).to_mesh(); t = trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3], np.asarray(me.tri_verts)); t.merge_vertices()
        if n.startswith('cleat-wall'):                             # 300 long: turned 45 deg on the plate, as it has to print
            t.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 4, [0, 0, 1]))
        t.apply_translation(-t.bounds[0]); t.export(f'{out}/p3x2-v6-{n}.stl'); print(n, np.round(t.extents, 1).tolist())
    for a, b in (('bar-knob', 'knob-white'), ('bar-boot-key', 'boot-key')):
        shutil.copyfile(os.path.join(HERE, '..', 'stl', a + '.stl'), os.path.join(out, f'p3x2-v6-{b}.stl'))
    # hung on the wall: both case cleats on the one wall cleat
    ccs = cc.translate([-PANEL_CX, 0, 0]) + cc.translate([PANEL_CX, 0, 0])
    hung = [P['kn_screws'], P['back'], P['chassis_a'], P['chassis_b'], P['sleeve_a'], P['sleeve_b'], ccs]
    seated = lambda dz=0.0, dx=0.0: round(sum((m.translate([dx, 0, dz]) ^ wc).volume() for m in hung), 2)
    rows = check(P, sk)
    rows.append(('case cleats / chassis, back and knuckle screws', round((ccs ^ (P['chassis_a'] + P['chassis_b'] + P['back'] + P['kn_screws'])).volume(), 2)))
    worst = max(round((cable(x) ^ (wc + ccs + P['chassis_a'] + P['chassis_b'] + P['sleeve_a'] + P['sleeve_b'] + P['back'])).volume(), 2) for x in CABLE_EXITS)
    rows.append((f'a {CABLE_D} mm cable from the right end, behind the bar, along the wall cleat\'s channel and down each slot / cleats, chassis, walnut', worst))
    rows.append((f'hung, 0.5 either way along the wall cleat: free', max(seated(dx=-0.5), seated(dx=0.5))))
    rows.append((f'hung, 1.5 either way along the wall cleat: on the stop (> 0 both ways)', 0.0 if min(seated(dx=-1.5), seated(dx=1.5)) > 1.0 else 1.0))
    wb = wc.bounding_box()
    rows.append((f'wall cleat {wb[3] - wb[0]:.0f} long, on the back between the louver bands (z {wb[2]:.1f} to {wb[5]:.1f}; {DR.CLEAT_ZBOT:.1f} to {DR.CLEAT_ZTOP:.1f} free)', 0.0 if wb[2] >= DR.CLEAT_ZBOT and wb[5] <= DR.CLEAT_ZTOP else 1.0))
    diag = ((wb[3] - wb[0]) + (wb[5] - wb[2])) / math.sqrt(2)
    rows.append((f'wall cleat on the bed\'s diagonal: needs a {diag:.0f} mm square (250 or less)', 0.0 if diag <= 250 else round(diag - 250, 1)))
    bh = max(P['back'].bounding_box()[4], P['kn_screws'].bounding_box()[4])
    rows.append((f'back and knuckle screw heads at or under the back plate\'s face ({bh - DR.Y1:+.2f})', 0.0 if bh <= DR.Y1 + 0.001 else round(bh - DR.Y1, 2)))
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
