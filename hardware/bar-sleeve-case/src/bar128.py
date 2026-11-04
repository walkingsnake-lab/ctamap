"""128 x 32 bar: the v5 drawer sleeve for two Waveshare P2.5 64x32 panels side by side (320 x 80 of LEDs), in parts that
fit the X2D's 256 mm bed. Everything not listed here is the v5 drawer (drawer.py) and the P2.5 build.

Case frame as everywhere (x right seen from the front, y back, z up). Panel A (left) is centred at x -80, panel B at +80;
both are turned 180 deg, as in the single build.

Shell (walnut PLA, 347 x 96.3 x 69): the v5 sleeve built from the 'p25x2' profile (bore 340 x 89.3), split at x = 0
into a left and a right half, both on one plate. The joint is the P4 split's (p4.py on its branch) turned 90 deg: it
cuts the top and bottom walls, the hood and both rims.
- a 1 x 1 mm reveal centred on x = 0 wraps the case (top, bottom, front rim, hood, back rim). The halves meet outside at
  its right edge (XJ), so the joint line sits in the groove's shadow;
- a half-lap inside the top and bottom walls: half A's inner WALL / 2 runs on past the cut as a lip into a pocket in
  half B, to x = LAP, with LAP_CL of glue gap on its face and y ends and LAP_XCL at its tip, so the outer band is the
  only seat in x. The lip's y ends are 45 deg (no flat overhang back-down). It stays 1 mm behind the screen face and
  0.5 mm in front of the trays' back, so it never shows.
- the knob moves to x +80 (panel B's centre, where the P2.5 tray's encoder rails are), the light sensor to +120, the
  screws from below to x +/-34 and +/-126 (each tray's own +/-46).
Diffuser (two-colour): one per panel, split at the panel joint. No skirt on the seam edge. The rib over the joint is
A's: JOINT_RIB wide (0.45 = every other rib, plus any gap between the butted panels), so neither half carries a 0.225 mm
half rib (too thin to print on the 0.2 nozzle). B's diffuser starts 0.225 past its panel's edge.
Splice plates: two short PETG plates on the panels' inner corner inserts (x +/-17.5, z +/-32.25), one round hole and
one slot (x), screwed on first (M3 x 6 button heads): they tie the panels into one unit so their rows can't step at the
seam. The trays' inner posts stand on them, open tubes round the screw heads (push only).
Trays (black PETG): one per panel, each the P2.5 v5 tray cut at the panel joint (no end wall there: the panels fill it).
Tray B (right) is the P2.5 tray as built (S3, encoder rails, sensor sled hooks, status window, USB-C slot). Tray A (left)
is the same tray with none of those (drawer.tray(blank=True)). The two inner posts of each stand SPLICE_T further back,
on the splice plates, with no floor or screw. Both take their own pair of screws from below and their own wall cleat.
Run: python3 bar128.py <outdir>            -> shell halves, diffuser halves, trays, test pieces (sets PANEL itself; the
     trays come from a second run of this script with --trays and PANEL=p25). JOINT_RIB=0.55 / SPLICE_HOLE=3.45 set the
     two sizes the test pieces choose. Case-frame copies for check_bar128.py go to $BAR128_FRAMES (default: temp dir).
"""
import math, os, sys
TRAYS = '--trays' in sys.argv                    # the trays are built per panel, from the plain P2.5 profile
os.environ['PANEL'] = 'p25' if TRAYS else 'p25x2'
os.environ.setdefault('CASE_WALL', '3.5')
import numpy as np
from manifold3d import Manifold, CrossSection
import panel
import case as C
import case2 as V
import plate3 as P3
import drawer as DR
from case import box, rr_cs, prism_y, cyl_y, cyl_z, ZC, H, D, WALL, HW, RC, BORE_HX, BORE_HZ, BORE_R, JT, ADD, Y_FACE

DR.configure_shell()
V.BACKDOWN = True
V.KNOB_X = 80.0                                  # panel B's centre: the P2.5 tray's encoder slot and rails
for _m in (C, V, P3):
    _m.SCREW_XS = tuple(panel.P['screw_xs'])     # +/-34, +/-126: each tray's own +/-46

BED = 256.0
# ---------------------------------------------------------------- shell split (p4.py's joint, about x instead of z)
LAP = 4.0                       # half A's inner half-wall runs on to x = LAP
REV_W, REV_D = 1.0, 1.0         # reveal: width (along x) and depth
XS = 0.0                        # reveal centre: the panel joint
XJ = XS + REV_W / 2             # where the halves meet outside: the reveal's right edge
LAP_Y0 = Y_FACE + 1.0           # lap only behind the screen face ...
LAP_Y1 = DR.Y1 - 0.5            # ... and in front of the trays' back (the back rim shows the plain reveal)
LAP_CL = 0.12                   # glue gap on the lip's outer face and its y ends (medium CA)
LAP_XCL = 0.2                   # gap at the lip's tip: the outer band at XJ is the only seat in x


def outer_inset(i):
    """case2's back-down outer body (chamfered front and back rims) moved inward by i (as p4.py)"""
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


def visible_layer(sh, d):
    """shell material within d of a face you can see: outside, the hood in front of the screen, the back rim"""
    deep = outer_inset(d)
    deep = deep - prism_y(rr_cs(BORE_HX + d, BORE_HZ + d, BORE_R + d), -50, Y_FACE + d)
    deep = deep - prism_y(rr_cs(BORE_HX + d, BORE_HZ + d, BORE_R + d), DR.Y1, D + 50)
    return sh - deep


def lap_prism(cl, xcl):
    """the lap's extent in x and y (all z): from the joint XJ to XS + LAP, both y ends 45 deg so neither the lip nor the
    pocket's roof is a flat overhang printed back-down. cl / xcl shrink it (the lip) inside the pocket."""
    x0, x1 = XJ - 0.01, XS + LAP - xcl
    e = cl * math.sqrt(2)
    a = box(x0, x0 + 0.01, LAP_Y0 + e, LAP_Y1 - e, -1, H + 1)
    b = box(x1 - 0.01, x1, LAP_Y0 + e + (x1 - x0), LAP_Y1 - e - (x1 - x0), -1, H + 1)
    return (a + b).hull()


def split_shell(sh):
    """left (A) and right (B) halves. Outside they meet at XJ; inside the top and bottom walls A's lip (inner WALL / 2)
    runs on to XS + LAP into a pocket in B."""
    reveal = visible_layer(sh, REV_D) ^ box(XS - REV_W / 2, XS + REV_W / 2, -50, D + 1, -1, H + 1)
    s = sh - reveal
    pocket = s ^ outer_inset(WALL / 2) ^ lap_prism(0, 0)
    lip = s ^ outer_inset(WALL / 2 + LAP_CL) ^ lap_prism(LAP_CL, LAP_XCL)
    a = (s ^ box(-HW - 1, XJ, -50, D + 1, -1, H + 1)) + lip
    b = (s ^ box(XJ, HW + 1, -50, D + 1, -1, H + 1)) - pocket
    out = []
    for m in (a, b):
        parts = sorted(m.decompose(), key=lambda q: -q.volume())
        assert all(q.volume() < 0.01 for q in parts[1:]), [q.volume() for q in parts[1:]]
        out.append(parts[0])
    return tuple(out)


def seam_coupon(a, b, wall='top'):
    """both halves across the seam, 50 mm wide, the front 34 mm deep (hood, rim, reveal and the lap's front end), one wall:
    test the lap's fit and the glue, and see how the reveal reads after finishing"""
    zr = (H - 15.0, H + 1) if wall == 'top' else (-1, 15.0)
    reg = box(-25.0, 25.0, -50, 34.0, *zr)
    return a ^ reg, b ^ reg


# ---------------------------------------------------------------- diffuser halves
import diffuser as DF
JOINT_RIBS = (0.45, 0.55, 0.65)   # the coupon's three; the build uses JOINT_RIB
JOINT_RIB = float(os.environ.get('JOINT_RIB', '0.45'))
HALF = 0.225                      # half of a normal rib (P2.5 rib 0.45)
SKIRT_EDGE = DF.OUT               # the skirts stand this far past the panel edge


def diffuser_halves(rib=JOINT_RIB, skin=None):
    """DF.diffuser() over both panels (the 'p25x2' profile: 128 columns, skirts and bumps on the outer ends, top and bottom),
    split at the panel joint. A keeps the joint rib, widened to rib (from -HALF to rib - HALF); B starts at +HALF.
    Returns {('A'|'B', 'white'|'black'): manifold} in DF's frame (z = 0 the face, +z toward the LEDs; x as seen from the
    front, so A is x < 0)."""
    skin = DF.VARIANTS['white'] if skin is None else skin
    d = DF.diffuser(skin=skin)
    hy = DF.PH / 2
    xa1 = rib - HALF
    if xa1 > HALF:                                           # widen the joint rib onto B's side
        d = d + box(HALF - 0.01, xa1, -hy + 0.29, hy - 0.29, skin - 0.01, skin + DF.GRID_H)
    lo = d.bounding_box()
    big = box(lo[0] - 1, lo[3] + 1, lo[1] - 1, lo[4] + 1, -1, 20)
    face = box(lo[0] - 1, lo[3] + 1, lo[1] - 1, lo[4] + 1, -1, skin)
    a = d ^ box(lo[0] - 1, xa1, lo[1] - 1, lo[4] + 1, -1, 20)
    b = d ^ box(HALF, lo[3] + 1, lo[1] - 1, lo[4] + 1, -1, 20)
    return {('A', 'white'): a ^ face, ('A', 'black'): a - face, ('B', 'white'): b ^ face, ('B', 'black'): b - face}


def diffuser_joint_coupons():
    """6 columns either side of the joint (cut at a rib's outer edge, so no half rib at the coupon's own edge), the bottom edge (skirt, bezel) and 10 rows: an A piece per joint rib width
    (1-3 notches cut in its bezel edge) and one B piece. Hold A and B on the butted panels at the bottom of the joint;
    the width whose seam column looks like the rest is the build's JOINT_RIB."""
    hy = DF.PH / 2
    reg = lambda x0, x1: box(x0, x1, -hy - 20, -hy + 25.0, -5, 20)
    out = []
    for n, rib in enumerate(JOINT_RIBS, 1):
        h = diffuser_halves(rib)
        notches = Manifold.batch_boolean([box(-12.0 + k * 2.2, -12.0 + k * 2.2 + 1.0, -DF.FL_HZ - 1, -DF.FL_HZ + 1.0, -1, 20)
                                          for k in range(n)], ADD)
        out.append((f'A{rib:.2f}', h[('A', 'white')] ^ reg(-15.23, 2.0) - notches, h[('A', 'black')] ^ reg(-15.23, 2.0) - notches))
    h = diffuser_halves(JOINT_RIBS[0])
    out.append(('B', h[('B', 'white')] ^ reg(-2.0, 15.23), h[('B', 'black')] ^ reg(-2.0, 15.23)))
    return out


# ---------------------------------------------------------------- splice plates
SPLICE_X = 80.0 - 62.5            # inner corner inserts: x +/-17.5 (each panel's corner at 62.5 from its centre)
SPLICE_T, SPLICE_W, SPLICE_L = 2.0, 12.0, 2 * SPLICE_X + 12.0
SPLICE_SLOT = 0.5                 # B's hole is a slot, +/-0.5 in x: the plate holds the rows, the panels butt freely
SPLICE_HOLES = (3.3, 3.45, 3.6)   # printed vertical, so they come out small: pick the snuggest an M3 passes freely
SPLICE_HOLE = float(os.environ.get('SPLICE_HOLE', '3.45'))   # the build's (set from the test piece)


def splice_plate(d, notches=0):
    """flat, print as exported. Round hole at A's insert (-SPLICE_X), slot at B's (+SPLICE_X); notches mark the size."""
    cs = CrossSection.square([SPLICE_L - 6.0, SPLICE_W - 6.0], center=True).offset(3.0, JT, circular_segments=32)
    p = Manifold.extrude(cs, SPLICE_T)
    p = p - cyl_z(-SPLICE_X, 0, -1, SPLICE_T + 1, d, 40)
    slot = CrossSection.square([2 * SPLICE_SLOT, 0.01], center=True).offset(d / 2, JT, circular_segments=40).translate([SPLICE_X, 0])
    p = p - Manifold.extrude(slot, SPLICE_T + 2).translate([0, 0, -1])
    for k in range(notches):
        x = -3.0 + k * 3.0
        p = p - box(x - 0.6, x + 0.6, SPLICE_W / 2 - 1.0, SPLICE_W / 2 + 1, -1, SPLICE_T + 1)
    return p


# ---------------------------------------------------------------- export helpers
def to_tm(m):
    import trimesh
    me = m.to_mesh()
    return trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)


DOWN = None


def backdown(m):
    """case frame -> print frame, back face (y = D) on the bed"""
    import trimesh
    t = to_tm(m)
    t.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
    return t


def layout(rows, gap=8.0):
    """rows: [[trimesh, ...], ...] of parts sharing nothing; lays each row left to right, rows front to back, centred.
    Parts given as tuples are moved together (two-colour pairs share one frame)."""
    import trimesh
    placed, y = [], 0.0
    for row in rows:
        x, depth = 0.0, 0.0
        for item in row:
            grp = item if isinstance(item, tuple) else (item,)
            lo = np.min([g.bounds[0] for g in grp], axis=0); hi = np.max([g.bounds[1] for g in grp], axis=0)
            for g in grp:
                g.apply_translation([x - lo[0], y - lo[1], -lo[2]])
            placed.append(grp)
            x += hi[0] - lo[0] + gap
            depth = max(depth, hi[1] - lo[1])
        y += depth + gap
    allv = np.vstack([g.vertices for grp in placed for g in grp])
    c = -(allv.min(0) + allv.max(0)) / 2
    c[2] = 0
    for grp in placed:
        for g in grp:
            g.apply_translation(c)
    return placed


def report(name, t):
    ext = np.round(t.extents, 1).tolist()
    print(f'{name:52s} watertight={t.is_watertight} extents={ext}')
    return dict(watertight=bool(t.is_watertight), extents=ext, volume_cm3=round(float(t.volume) / 1000, 1))


def build_coupons(out):
    import trimesh, json
    os.makedirs(out, exist_ok=True)
    rep = {}
    sh = V.shell2()
    a, b = split_shell(sh)
    # seam lap: top wall pair, print orientation as the shell (back-down: the 34 mm cut face on the bed)
    ca, cb = seam_coupon(a, b, 'top')
    ta, tb = backdown(ca), backdown(cb)
    layout([[ta, tb]], gap=10.0)
    for n, t in (('coupon-128-seam-A-walnut.stl', ta), ('coupon-128-seam-B-walnut.stl', tb)):
        t.export(f'{out}/{n}'); rep[n] = report(n, t)
    # diffuser joint: all four pieces on one plate, one object with two parts (white face = first layer, black above)
    pieces = diffuser_joint_coupons()
    pairs = [(to_tm(w), to_tm(k)) for _, w, k in pieces]
    layout([pairs[:2], pairs[2:]], gap=6.0)
    W = trimesh.util.concatenate([p[0] for p in pairs]); K = trimesh.util.concatenate([p[1] for p in pairs])
    for n, t in (('coupon-128-diffuser-joint-white.stl', W), ('coupon-128-diffuser-joint-black.stl', K)):
        t.export(f'{out}/{n}'); rep[n] = report(n, t)
    # splice plates: three hole sizes, 1-3 notches
    sp = [to_tm(splice_plate(d, i + 1)) for i, d in enumerate(SPLICE_HOLES)]
    layout([[s] for s in sp], gap=6.0)
    S = trimesh.util.concatenate(sp)
    n = 'coupon-128-splice-plates.stl'; S.export(f'{out}/{n}'); rep[n] = report(n, S)
    return rep, (sh, a, b)


# ---------------------------------------------------------------- trays (PANEL=p25 run)
PANEL_CX = 80.0                   # panel centres at x -/+80
TRAY_GAP = 0.15                   # each tray stops this far short of the panel joint (0.3 between them)


def trays():
    """(tray A, tray B, B's status window) in the case frame. Only valid in the --trays run (PANEL=p25)."""
    assert TRAYS
    inner = lambda sx: {c: SPLICE_T for c in DR.CORNERS if c[0] * sx > 0}   # the corners toward the joint

    def open_posts(t, corners):
        """the inner posts carry no screw (the splice plate's screws take those inserts): no floor, an open tube whose
        rim stands on the plate round the screw head"""
        y = P3.FOOT_Y + SPLICE_T
        return t - Manifold.batch_boolean([cyl_y(x, ZC + z, y - 1, y + P3.SO_FLOOR + 0.6, DR.POST_BORE, 48) for x, z in corners], ADD)
    tb = open_posts(DR.tray(post_dy=inner(-1)), inner(-1)).translate([PANEL_CX, 0, 0]) ^ box(TRAY_GAP, 500, -50, 200, -50, 200)
    ta = open_posts(DR.tray(blank=True, post_dy=inner(+1)), inner(+1)).translate([-PANEL_CX, 0, 0]) ^ box(-500, -TRAY_GAP, -50, 200, -50, 200)
    big = lambda m: max(m.decompose(), key=lambda q: q.volume())
    return big(ta), big(tb), DR.status_window().translate([PANEL_CX, 0, 0])


def build_trays(out, frame_dir):
    """print files (back face down; B's window shares B's frame) and case-frame copies in frame_dir for the checks"""
    rep = {}
    ta, tb, win = trays()
    for n, m in (('tray-A', ta), ('tray-B', tb), ('tray-B-window', win)):
        to_tm(m).export(f'{frame_dir}/{n}.stl')
    # envelopes on panel B, for the checks: S3 and its parts, the light sensor (board, plugs) on its sled, the encoder
    import sensor as SN
    enc = (box(-12.7, 12.7, C.KY - 12.7, C.KY + 12.7, SN.EB_BOT, SN.EB_TOP)
           + Manifold.cube([12.0, 12.0, H - 1.4 - SN.EB_TOP], True).rotate([0, 0, 45]).translate([0, C.KY, (H - 1.4 + SN.EB_TOP) / 2])
           + cyl_z(0, C.KY, H - 1.4, H + 6.0, 7.0))
    for n, m in (('env-s3', DR.s3_envelope()), ('env-sensor', DR.sensor_envelope() + DR.sensor_plugs()), ('env-sled', DR.sled()),
                 ('env-encoder', enc)):
        to_tm(m.translate([PANEL_CX, 0, 0])).export(f'{frame_dir}/{n}.stl')
    fb = backdown(tb)
    for n, m, f in (('bar128-tray-A.stl', ta, None), ('bar128-tray-B.stl', tb, None), ('bar128-tray-B-window.stl', win, fb)):
        t = backdown(m)
        ref = t if f is None else f
        t.apply_translation([-ref.bounds[0][0], -ref.bounds[0][1], -ref.bounds[0][2]])
        t.export(f'{out}/{n}'); rep[n] = report(n, t)
    import json
    json.dump(dict(rep=rep, port_z=DR.PORT_Z, s3_edge=DR.S3_EDGE + PANEL_CX, s3_z0=DR.S3_Z0, ky=C.KY,
                   sensor_x=V.SENSOR_X + PANEL_CX, bottom_xs=[x + PANEL_CX * s for s in (-1, 1) for x in DR.bottom_xs()],
                   bot_y=DR.BOT_Y, foot_y=P3.FOOT_Y, y0=DR.Y0, y1=DR.Y1, yf=DR.YF,
                   corners=[(x + PANEL_CX * s, z) for s in (-1, 1) for x, z in DR.CORNERS],
                   cleat=[(x + PANEL_CX * s, z) for s in (-1, 1) for x, z in DR.CLEAT_SCREWS]),
              open(f'{frame_dir}/trays.json', 'w'), indent=1)
    return rep


def build_case(out, frame_dir):
    """shell halves (back-down), diffuser halves (face down, white + black in one frame), splice plates; case-frame
    copies for the checks"""
    import json
    rep = {}
    sh = V.shell2()
    a, b = split_shell(sh)
    for n, m in (('shell-A', a), ('shell-B', b)):
        to_tm(m).export(f'{frame_dir}/{n}.stl')
    for n, m in (('bar128-shell-A-walnut-backdown.stl', a), ('bar128-shell-B-walnut-backdown.stl', b)):
        t = backdown(m); t.apply_translation(-t.bounds[0]); t.export(f'{out}/{n}'); rep[n] = report(n, t)
    h = diffuser_halves(JOINT_RIB)
    for side in ('A', 'B'):
        w, k = to_tm(h[(side, 'white')]), to_tm(h[(side, 'black')])
        lo = np.minimum(w.bounds[0], k.bounds[0])
        for n, t in ((f'bar128-diffuser-{side}-white.stl', w), (f'bar128-diffuser-{side}-black.stl', k)):
            t.apply_translation(-lo); t.export(f'{out}/{n}'); rep[n] = report(n, t)
        for part in ('white', 'black'):
            to_tm(h[(side, part)]).export(f'{frame_dir}/diffuser-{side}-{part}.stl')
    import trimesh
    sp = [to_tm(splice_plate(SPLICE_HOLE)) for _ in range(2)]
    layout([sp], gap=6.0)
    S = trimesh.util.concatenate(sp); n = 'bar128-splice-plates.stl'; S.export(f'{out}/{n}'); rep[n] = report(n, S)
    json.dump(dict(knob_x=V.KNOB_X, sensor_x=V.SENSOR_X, port_z=V.PORT_Z, screw_xs=list(V.SCREW_XS), screw_y=C.SCREW_Y,
                   hw=HW, h=H, d=D, zc=ZC, bore=(BORE_HX, BORE_HZ), y_face=Y_FACE, panel_back=C.PANEL_BACK,
                   joint_rib=JOINT_RIB, fl=(DF.FL_HX, DF.FL_HZ)), open(f'{frame_dir}/case.json', 'w'), indent=1)
    return rep, (sh, a, b)


if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    out = args[0] if args else '.'
    import tempfile
    frame_dir = os.environ.get('BAR128_FRAMES', os.path.join(tempfile.gettempdir(), 'bar128-frames'))
    os.makedirs(out, exist_ok=True); os.makedirs(frame_dir, exist_ok=True)
    if TRAYS:
        build_trays(out, frame_dir)
        sys.exit()
    build_case(out, frame_dir)
    build_coupons(os.path.join(out, 'coupons'))
    import subprocess
    env = dict(os.environ, BAR128_FRAMES=frame_dir)
    env.pop('PANEL', None)
    subprocess.run([sys.executable, __file__, out, '--trays'], check=True, env=env)
