"""Power sockets and data ribbons on the 128 x 32 bar (bar128.py): each panel's 4-pin socket with the stock plug seated
in it and its wires turning flat behind it, checked against everything else behind the panels: the S3 and the encoder
on panel B, both trays (posts, bosses, hooks, tie loop), the splice plates, and the data plugs in use (S3 -> A in,
A out -> B in). Then the two data ribbons' routes (S3 -> A in along the trays' back walls, through tray B's ribbon
hooks; A out -> B in across the panel backs, behind A's input and power plugs), and their lengths.

With no argument it checks the socket where the P2.5 profile puts it (panel.py 'power', from the product photo); with
x,z it checks that spot (both pin-row directions); with --sweep it maps every spot over the panel back:
    python3 check_bar128_power.py [frames dir] [x,z | --sweep]
x, z: the socket's centre in mm from the panel's centre, seen from the front with the panel in its NORMAL orientation
(data in on the right), like the profiles' 'headers'. Each panel's orientation in the case (bar128.PANEL_TURNED, read
from the frames' trays.json) says where that lands. Run bar128.py first (frames dir: $BAR128_FRAMES or the temp dir, as check_bar128.py)."""
import os, sys, tempfile
import numpy as np
import trimesh
from manifold3d import Manifold, Mesh
os.environ['PANEL'] = 'p25'
os.environ.setdefault('CASE_WALL', '3.5')
import drawer as DR                                           # noqa: E402  (PANEL must be set first)
import case as C                                              # noqa: E402
from case import box, ZC, PANEL_BACK                          # noqa: E402

import panel                                                 # noqa: E402
SWEEP = '--sweep' in sys.argv
args = [a for a in sys.argv[1:] if ',' not in a and not a.startswith('--')]
spot = [a for a in sys.argv[1:] if ',' in a]
ROWS = 'xz'
if not spot and not SWEEP and panel.P.get('power'):
    spot = ['%s,%s' % panel.P['power']]
    ROWS = panel.P.get('power_row', 'xz')
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


import json
TURNED = json.load(open(f'{F}/trays.json')).get('turned', {'A': True, 'B': True})


def to_case(panel, x, z):
    """panel-local, normal orientation -> case frame (as that panel sits: turned 180 deg or not)"""
    return (PANEL_CX[panel] - x, ZC - z) if TURNED[panel] else (PANEL_CX[panel] + x, ZC + z)


def plug(gx, gz, row):
    """plug body + wire column; row 'x' or 'z': the direction the pin row runs"""
    bl, bw, wl, ww = (BODY_L, BODY_W, WIRE_L, WIRE_W) if row == 'x' else (BODY_W, BODY_L, WIRE_W, WIRE_L)
    return (box(gx - bl / 2, gx + bl / 2, PANEL_BACK, PANEL_BACK + PROUD, gz - bw / 2, gz + bw / 2)
            + box(gx - wl / 2, gx + wl / 2, PANEL_BACK, PANEL_BACK + PROUD + BEND, gz - ww / 2, gz + ww / 2))


obst = {n: load(n) for n in ('tray-A', 'tray-B', 'env-s3', 'env-encoder')}
for z in (32.25, -32.25):                                     # splice plates + their M3 heads (bar128.SPLICE_*)
    obst[f'splice plate {z:+.0f}'] = box(-23.5, 23.5, PANEL_BACK, PANEL_BACK + 2.0 + 1.7, ZC + z - 6, ZC + z + 6)
heads = {}                                                    # data headers (case x, z) as each panel sits
for p in 'AB':
    (xi, zi), (xo, zo) = panel.P['headers']                   # PI IN, PO OUT (normal orientation)
    heads[f'{p} in'], heads[f'{p} out'] = to_case(p, xi, zi), to_case(p, xo, zo)
assert heads['B out'][0] > 100, "B's output must be the header under the S3 (the chain's unused end)"
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
        for row in ROWS:
            h = hits(gx, gz, row)
            ok &= not h
            print(f'panel {p}, pin row along {row}: socket at case x {gx:+7.1f}, z {gz - ZC:+5.1f}: {"clear" if not h else "HITS " + ", ".join(h)}')
    print('power sockets clear' if ok else 'POWER SOCKET BLOCKED')
    # ---- data ribbons: 2x8 ribbon 20.3 wide (along the shrouds' long axis, z), ~1.3 thick, leaving each plug straight
    # back, then flat. Obstacles: everything above plus both power plugs as seated (profile spot, its pin row)
    W, T = 20.3 / 2, 1.3
    ob = dict(obst)
    for p in 'AB':
        ob[f'power plug {p}'] = plug(*to_case(p, *panel.P['power']), panel.P.get('power_row', 'z'))
    top = PANEL_BACK + IDC_PROUD + 6.0                        # a data plug's envelope top (plug + the ribbon's fold)
    (ax, az), (aox, aoz), (bx, bz) = heads['A in'], heads['A out'], heads['B in']
    # A out -> B in: up out of A's output plug, across behind A's input and power plugs, down into B's input
    yj = PANEL_BACK + PROUD + BEND + 0.5
    jumper = (box(aox - 4.5, aox + 4.5, top, yj + T, aoz - W, aoz + W)
              + box(min(aox, bx) - 4.5, max(aox, bx) + 4.5, yj, yj + T, min(aoz, bz) - W, max(aoz, bz) + W)
              + box(bx - 4.5, bx + 4.5, top, yj + T, bz - W, bz + W))
    # S3 -> A in: from the S3's IDC header back to the trays' back walls, flat on them behind tray B's ribbon-hook lips
    # (at the hooks' height, RZ), then forward and down into A's input
    rz = ZC + min(DR.HEADERS, key=lambda h: h[0])[1]
    ys1 = DR.Y0 - 0.3
    idc_x0 = DR.S3_EDGE + PANEL_CX['B'] - 63.8                # the S3's IDC header block (s3_envelope comp 50.5-63.8)
    s3r = (box(ax - 4.5, idc_x0, ys1 - T, ys1, rz - W, rz + W)
           + box(ax - 4.5, ax + 4.5, top, ys1, min(az, rz) - W, max(az, rz) + W))
    rib_ok = True
    for name, m, skip in (('A out -> B in', jumper, ()), ('S3 -> A in', s3r, ('env-s3',))):
        h = {n: round((m ^ o).volume(), 2) for n, o in ob.items() if n not in skip and (m ^ o).volume() > 0.05}
        rib_ok &= not h
        print(f'ribbon {name:14s}: ' + ('clear' if not h else f'HITS {h}'))
    j_len = 2 * (yj - top) + abs(bx - aox) + 2 * 8.0
    s3_len = (ys1 - (C.PCB_Y0 + 1.6 + 13.0)) + (idc_x0 + 6.65 - ax) + (ys1 - top) + 2 * 8.0
    print(f'  A out -> B in: ~{j_len / 10:.0f} cm seated, plugged on the bench (nothing moves): 20 cm tight, 25-30 cm comfortable')
    print(f'  S3 -> A in: ~{s3_len / 10:.0f} cm seated, ~{(s3_len + 60) / 10:.0f} cm with tray B held behind the opening to plug it')
    print('ribbons clear' if rib_ok else 'RIBBON ROUTE BLOCKED')
    sys.exit(0 if ok and rib_ok else 1)

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
