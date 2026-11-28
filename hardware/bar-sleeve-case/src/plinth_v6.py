"""Socket plinth for the V6 P3 and the 128 P3 V6 (draft 5): black, tilts the case back TILT degrees. The case's four fitted bumpers drop
into sockets on short bosses, so the case rides on its own rubber and floats REVEAL above the deck. Front face square to
the deck; ends stop where the sleeve's bottom stops being flat; toe-kick across the front; a heel behind the case: a low
lip that catches the sleeve's back edge if the case is pushed over backwards, sloping down to the desk HEEL_LEN behind
the case, with the rear bumpers under it. Prints bottom-down, no supports. Units mm.
The 128 (PLINTH=p3x2): the same section, one piece under the middle of the bar, sockets at the bar's bumpers
(v6p3x2.FEET_X, moved inboard for this), checked against v6p3x2.py's frames (pass their folder as the third argument).
python3 plinth_v6.py <out dir> [tilt]          PLINTH=p3x2 python3 plinth_v6.py <out dir> <tilt> <v6p3x2 out>/frames"""
import math, os, sys
import trimesh
from manifold3d import Manifold, CrossSection, JoinType, OpType
import v6p3 as M
import case as C
import panel

TILT = 12.0
WIDE = os.environ.get('PLINTH', 'p3') == 'p3x2'
FEET_X = 127.0 if WIDE else None          # v6p3x2.FEET_X (the single: case.FEET)
END = 9.9                                 # the plinth's ends this far outside the sockets' centres (the single: the sleeve's flat)
LEG = 32.5                                # each end's leg beside the toe-kick
FOOT_OD, FOOT_H = 12.7, 3.6               # SJ5312 per 3M: 12.7 x 3.5-3.6 (+/-0.5). MEASURE the fitted ones.
PROUD = FOOT_H - C.FOOT_DEPTH             # below the case
GAP = 1.0                                 # boss tops to the case, whatever the feet measure
SOCK = PROUD - GAP                        # socket depth
SOCK_D, SOCK_CH = 13.6, 0.4               # 0.45 a side on the peg: print scale across the 168 mm spacing
DROP = 2.0                                # the deck sits this far below the boss tops
REVEAL = GAP + DROP
BOSS_WALL = 1.6
TB = 6.0                                  # world height of the case's bottom back edge
Y_FRONT, R = 13.0, 8.0                    # front edge at case-local y 13 (the sleeve's bottom front edge is y 9)
CH_TOP, CH_BOT = 0.5, 1.0
KICK_D, KICK_BAR = 8.0, 3.5              # toe-kick: depth, the bar left over it
HEEL_GAP, HEEL_TOP, HEEL_T = 0.6, 6.0, 3.0   # lip: this far behind the sleeve's back, up to case-local z, flat this wide
HEEL_LEN, HEEL_END_H, HEEL_R = 15.0, 2.0, 6.0   # the heel ends this far behind the case's bottom back edge
OWN_D, OWN_DEPTH = 13.2, 1.5
SEG = 96
BIG = 600.0


def case_feet():
    return [(math.copysign(FEET_X, fx), fy) for fx, fy in C.FEET] if WIDE else list(C.FEET)


def half_len():
    """the single: half the sleeve bottom's flat (its outer corner radius is the bore's plus the wall); the 128: END past the sockets"""
    return FEET_X + END if WIDE else M.HW - (M.BORE_R + M.WALL)


def xf(tilt):
    a = math.radians(tilt); c, s = math.cos(a), math.sin(a)
    return [[1, 0, 0, 0], [0, c, s, M.D * (1 - c)], [0, -s, c, TB + s * M.D]], c, s


def build(tilt=TILT):
    T, c, s = xf(tilt)
    w = lambda y, z: (c * y + s * z + M.D * (1 - c), -s * y + c * z + TB + s * M.D)
    hx = half_len()
    FEET, kick_hx, own_x = case_feet(), hx - LEG, hx - 10.5
    yl = M.D + HEEL_GAP                                    # the lip's face, case-local
    cs = CrossSection.square([2 * (hx - R), 140 - 2 * R], center=True).offset(R, JoinType.Round, circular_segments=SEG).translate([0, Y_FRONT + 70])
    # deck (case-local): sides square to it, top edge chamfered; ends at the lip
    low = Manifold.extrude(cs, 80).translate([0, 0, -REVEAL - CH_TOP - 80])
    top = Manifold.extrude(cs.offset(-CH_TOP, JoinType.Round, circular_segments=SEG), 0.01).translate([0, 0, -REVEAL - 0.01])
    body = Manifold.hull(low + top) ^ Manifold.cube([BIG, BIG, BIG]).translate([-BIG / 2, yl - BIG, -BIG / 2])
    body += Manifold.cube([2 * hx, 80, 80 + HEEL_TOP]).translate([-hx, yl - 0.01, -80])          # heel block, cut to shape below
    keep = Manifold.extrude(cs.offset(-CH_TOP - 0.1, JoinType.Round, circular_segments=SEG), 10).translate([0, 0, -5])
    bo = SOCK_D / 2 + BOSS_WALL
    bosses = [Manifold.cylinder(DROP + 0.5, bo, bo, SEG).translate([fx, fy, -REVEAL - 0.5]) for fx, fy in FEET]
    body += Manifold.batch_boolean(bosses, OpType.Add) ^ keep
    socks = []
    for fx, fy in FEET:
        k = Manifold.cylinder(SOCK + 5, SOCK_D / 2, SOCK_D / 2, SEG).translate([fx, fy, -PROUD])
        k += Manifold.cylinder(SOCK_CH + 0.01, SOCK_D / 2, SOCK_D / 2 + SOCK_CH, SEG).translate([fx, fy, -GAP - SOCK_CH])
        socks.append(k)
    body -= Manifold.batch_boolean(socks, OpType.Add)
    wb = body.transform(T) ^ Manifold.cube([BIG, BIG, 300]).translate([-BIG / 2, -BIG / 2, 0])
    # heel: from the lip's flat top down to HEEL_END_H at the back edge; rear corners rounded in plan
    ye = M.D + HEEL_LEN
    yt, zt = w(yl + HEEL_T, HEEL_TOP)
    wb ^= M.along_x([(-200, -1), (ye, -1), (ye, HEEL_END_H), (yt, zt), (yt - 5, 200), (-200, 200)], -hx - 1, hx + 1)
    plan = CrossSection.square([2 * (hx - HEEL_R), 300 - 2 * HEEL_R], center=True).offset(HEEL_R, JoinType.Round, circular_segments=SEG).translate([0, ye - 150])
    wb ^= Manifold.extrude(plan, 200)
    # toe-kick: the middle of the front set back under a KICK_BAR bar; the 45 deg roof starts at the raked front face
    yb, zdeck = w(Y_FRONT, -REVEAL)
    zb = zdeck - KICK_BAR
    yf = yb - (zdeck - zb) * s / c
    yk = yb + KICK_D
    wb -= M.along_x([(yf - 10, -1), (yk, -1), (yk, zb - (yk - yf)), (yf, zb), (yf - 10, zb)], -kick_hx, kick_hx)
    # bottom chamfer on the outer outline (a true one; the toe-kick's inner edges are left square)
    out0 = wb.slice(0.001).hull()
    env = Manifold.hull(Manifold.extrude(out0.offset(-CH_BOT, JoinType.Miter), 0.01) + Manifold.extrude(out0, 200).translate([0, 0, CH_BOT]))
    wb ^= env
    bb = wb.bounding_box()
    own = [(sx * own_x, y) for sx in (-1, 1) for y in (bb[1] + 10.5, ye - CH_BOT - 2.4 - OWN_D / 2)]
    for x, y in own:
        wb -= Manifold.cylinder(OWN_DEPTH + 0.01, OWN_D / 2, OWN_D / 2, SEG).translate([x, y, -0.01])
    size = wb.bounding_box()
    rear_edge = own[1][1] + FOOT_OD / 2
    info = dict(tilt=tilt, size=[round(size[3] - size[0], 1), round(size[4] - size[1], 1), round(size[5] - size[2], 1)],
                socket_depth=round(SOCK, 2), reveal=round(REVEAL, 2), front_deck_h=round(zdeck, 1), lip_top_h=round(zt, 1),
                heel_behind_case=HEEL_LEN, case_top_back_y=round(w(M.D, M.H)[0], 1), rear_foot_edge_y=round(rear_edge, 1),
                roof_over_rear_own_foot=round(HEEL_END_H + (zt - HEEL_END_H) * (ye - rear_edge) / (ye - yt) - OWN_DEPTH, 2),
                toe_y=round(size[1], 2), sleeve_front_bottom_y=round(w(C.LT - C.LB, 0)[0], 2),
                pieces=len(wb.decompose()), cc=round(wb.volume() / 1000, 0), bed_diagonal_square=round((size[3] - size[0] + size[4] - size[1]) / math.sqrt(2), 1),
                clear_to_deg=round(math.degrees(math.atan2(M.BORE_HZ - panel.P['h'] / 2 if 'h' in panel.P else M.BORE_HZ - 48.0, C.LT)) + tilt, 1))
    return wb, T, own, info


def feet(T=None, at=None):
    if at is None:
        ms = [Manifold.cylinder(FOOT_H, FOOT_OD / 2, FOOT_OD / 2 - 0.6, 48).rotate([180, 0, 0]).translate([fx, fy, C.FOOT_DEPTH]) for fx, fy in case_feet()]
        return Manifold.batch_boolean(ms, OpType.Add).transform(T)
    ms = [Manifold.cylinder(FOOT_H, FOOT_OD / 2 - 0.6, FOOT_OD / 2, 48).translate([x, y, OWN_DEPTH - FOOT_H]) for x, y in at]
    return Manifold.batch_boolean(ms, OpType.Add)


if __name__ == '__main__':
    import numpy as np
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    tilt = float(sys.argv[2]) if len(sys.argv) > 2 else TILT
    b, T, own, info = build(tilt)
    if WIDE:
        from manifold3d import Mesh
        fr = sys.argv[3]
        def load(n):
            q = trimesh.load(f'{fr}/{n}.stl')
            return Manifold(Mesh(vert_properties=np.asarray(q.vertices, np.float32), tri_verts=np.asarray(q.faces, np.uint32)))
        P = dict(sleeve=load('sleeve-A') + load('sleeve-B'))       # the chassis is inside it; the case cleats start 30 mm up the back
        assert not P['sleeve'].is_empty()
    else:
        P = {k: v for k, v in M.build().items() if k in ('sleeve', 'chassis')}
    ov = [(b ^ P[k].transform(T)).volume() for k in P] + [(b ^ feet(T)).volume(), (b ^ feet(at=own)).volume()]
    seated = (feet(T) ^ P['sleeve'].transform(T)).volume()          # the bumpers sit in the sleeve's recesses: 0 if the recesses are there
    m = b.simplify(1e-3).to_mesh()
    t = trimesh.Trimesh(vertices=np.round(m.vert_properties[:, :3].astype(np.float64), 4), faces=m.tri_verts, process=True)
    t.update_faces(t.nondegenerate_faces()); t.remove_unreferenced_vertices()      # slivers where the heel, corner rounds and chamfer meet
    name = f"{'p3x2' if WIDE else 'p3'}-v6-plinth-{tilt:g}deg-black"
    t.export(f'{out}/{name}.stl')
    t2 = trimesh.load(f'{out}/{name}.stl')
    n = t2.face_normals; a = t2.area_faces
    down = (n[:, 2] < -0.72) & (t2.triangles_center[:, 2] > 0.05)          # steeper than 45 deg overhang, off the bed
    print(info)
    print('reloaded STL watertight', t2.is_watertight, 'bodies', t2.body_count, 'zero-area faces', int((a < 1e-9).sum()), 'volume vs model', round(float(t2.volume - b.volume()), 2),
          '| overlap', ' / '.join(P), '/ case feet / own feet mm3', [round(v, 3) for v in ov], '| case bumpers / sleeve (0: its recesses are where the sockets are)', round(seated, 3))
    zs = t2.triangles_center[down][:, 2]
    print('unsupported down-facing area mm2 by height:', {round(float(z), 1): round(float(a[down][np.isclose(zs, z, atol=0.05)].sum()), 1) for z in sorted(set(np.round(zs, 1)))})
    bad = [n for n, ok in (('watertight, one body, no zero-area faces', t2.is_watertight and t2.body_count == 1 and not (a < 1e-9).any()),
                           ('overlaps', max(abs(v) for v in ov) < 0.01 and seated < 0.01),
                           ('fits the bed (a 250 mm square on its diagonal, or 250 long)', min(info['bed_diagonal_square'], info['size'][0]) <= 250),
                           ('no overhang but its own bumpers\' recesses', all(abs(z - OWN_DEPTH) < 0.06 for z in zs)),
                           ('socket depth 0.8 or more', SOCK >= 0.8)) if not ok]
    print('PASS' if not bad else f'FAIL: {bad}')
    sys.exit(1 if bad else 0)
