"""Power sockets on the 128 x 32 bar (bar128.py): each panel's 4-pin socket with the stock plug seated in it and its wires
turning flat behind it, checked against everything else behind the panels: the S3 and the encoder on panel B, both
trays (posts, bosses, hooks, tie loop), the splice plates, and the data plugs in use (S3 -> A in, A out -> B in).

The P2.5's socket position isn't measured. With no argument this sweeps it over the panel back and prints a map per
panel; with one, it checks that spot on both panels:
    python3 check_bar128_power.py [frames dir] [x,z]
x, z: the socket's centre in mm from the panel's centre, seen from the front with the panel in its NORMAL orientation
(data in on the right), like the profiles' 'headers'. Both panels sit turned 180 deg in the case, so the same socket
lands at a mirrored spot on each. Run bar128.py first (frames dir: $BAR128_FRAMES or the temp dir, as check_bar128.py)."""
import os, sys, tempfile
import numpy as np
import trimesh
from manifold3d import Manifold, Mesh
os.environ['PANEL'] = 'p25'
os.environ.setdefault('CASE_WALL', '3.5')
import drawer as DR                                           # noqa: E402  (PANEL must be set first)
from case import box, ZC, PANEL_BACK                          # noqa: E402

args = [a for a in sys.argv[1:] if ',' not in a]
spot = [a for a in sys.argv[1:] if ',' in a]
F = args[0] if args else os.environ.get('BAR128_FRAMES', os.path.join(tempfile.gettempdir(), 'bar128-frames'))

# the plug: VH 3.96 mm x 4 class (VHR-4N): BODY_L x BODY_W, seated ~PROUD past the housing back (the socket sits in the
# housing's opening, as the 2x8 shrouds do). Its four wires leave straight back from the pin row (WIRE_L x WIRE_W) and
# need ~BEND past the plug to turn flat. The pin row may lie along x or along z on the board: both are checked.
BODY_L, BODY_W, PROUD = 20.0, 10.0, 5.0
WIRE_L, WIRE_W, BEND = 14.0, 5.0, 12.0
PANEL_CX = {'A': -80.0, 'B': 80.0}
SHR_X, SHR_Z, IDC_PROUD = 9.0, 25.6, 5.0                      # 2x8 shroud footprint; a seated IDC plug past the housing


def load(n):
    t = trimesh.load(f'{F}/{n}.stl', process=True)
    t.merge_vertices()
    return Manifold(Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))


def to_case(panel, x, z):
    """panel-local, normal orientation -> case frame (the panel turned 180 deg)"""
    return PANEL_CX[panel] - x, ZC - z


def plug(gx, gz, row):
    """plug body + wire column; row 'x' or 'z': the direction the pin row runs"""
    bl, bw, wl, ww = (BODY_L, BODY_W, WIRE_L, WIRE_W) if row == 'x' else (BODY_W, BODY_L, WIRE_W, WIRE_L)
    return (box(gx - bl / 2, gx + bl / 2, PANEL_BACK, PANEL_BACK + PROUD, gz - bw / 2, gz + bw / 2)
            + box(gx - wl / 2, gx + wl / 2, PANEL_BACK, PANEL_BACK + PROUD + BEND, gz - ww / 2, gz + ww / 2))


obst = {n: load(n) for n in ('tray-A', 'tray-B', 'env-s3', 'env-encoder')}
for z in (32.25, -32.25):                                     # splice plates + their M3 heads (bar128.SPLICE_*)
    obst[f'splice plate {z:+.0f}'] = box(-23.5, 23.5, PANEL_BACK, PANEL_BACK + 2.0 + 1.7, ZC + z - 6, ZC + z + 6)
heads = {}                                                    # data headers (case x), after the turn
for p in 'AB':
    (xi, zi), (xo, zo) = sorted(DR.HEADERS)                   # PI IN on the left, PO OUT on the right
    heads[f'{p} in'], heads[f'{p} out'] = (PANEL_CX[p] + xi, ZC + zi), (PANEL_CX[p] + xo, ZC + zo)
for n in ('A in', 'A out', 'B in'):                           # B's output stays empty (P25-128-BUILD.md)
    gx, gz = heads[n]
    obst[f'{n} plug'] = box(gx - SHR_X / 2, gx + SHR_X / 2, PANEL_BACK, PANEL_BACK + IDC_PROUD + 6.0, gz - SHR_Z / 2, gz + SHR_Z / 2)


def on_header(gx, gz):
    """a socket can't overlap a data header on the board: those spots aren't candidates"""
    return any(abs(gx - hx) < (SHR_X + BODY_W) / 2 and abs(gz - hz) < (SHR_Z + BODY_W) / 2 for hx, hz in heads.values())


def hits(gx, gz, row):
    p = plug(gx, gz, row)
    return [n for n, m in obst.items() if (p ^ m).volume() > 0.05]


def code(n):
    return 'S' if n == 'env-s3' else 'E' if n == 'env-encoder' else 'T' if n.startswith('tray') else 'P' if n.startswith('splice') else 'D'


if spot:
    x, z = (float(v) for v in spot[0].split(','))
    ok = True
    for p in 'AB':
        gx, gz = to_case(p, x, z)
        for row in 'xz':
            h = hits(gx, gz, row)
            ok &= not h
            print(f'panel {p}, pin row along {row}: socket at case x {gx:+7.1f}, z {gz - ZC:+5.1f}: {"clear" if not h else "HITS " + ", ".join(h)}')
    print('power sockets clear' if ok else 'POWER SOCKET BLOCKED')
    sys.exit(0 if ok else 1)

xs, zs = np.arange(-40, 40.1, 5.0), np.arange(-25, 25.1, 5.0)
print('socket centre, mm from the panel centre (normal orientation, seen from the front; data in on the right).')
print('. clear either way   x / z clear only with the pin row along x / z   otherwise what it hits: S the S3, E encoder,')
print('T tray feature, P splice plate, D a data plug in use   - a data header is there\n')
for p in 'AB':
    print(f'panel {p}' + ' ' * 3 + ''.join(f'{x:>5.0f}' for x in xs))
    for z in zs[::-1]:
        row = ''
        for x in xs:
            gx, gz = to_case(p, x, z)
            if on_header(gx, gz):
                c = '-'
            else:
                hx_, hz_ = hits(gx, gz, 'x'), hits(gx, gz, 'z')
                c = '.' if not hx_ and not hz_ else 'x' if not hx_ else 'z' if not hz_ else ''.join(sorted({code(n) for n in hx_ + hz_}))
            row += c.rjust(5)
        print(f'  z {z:+4.0f} ' + row)
    print()
