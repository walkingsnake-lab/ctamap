"""Bring Freerouting's result (out/v7.ses, a Specctra session) into the board file as tracks and vias.
KiCad 7's own importer needs the editor window, so this reads the session file directly: coordinates are in 0.1 um,
y upward."""
import os, re
import pcbnew
from pcbnew import FromMM, VECTOR2I
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'board'))
SRC = os.path.join(OUT, 'trackside-v7.kicad_pcb')
SES = os.path.join(OUT, 'v7.ses')


def parse(text):
    tok = re.findall(r'"[^"]*"|\(|\)|[^\s()]+', text)
    pos = 0

    def node():
        nonlocal pos
        out = []
        while pos < len(tok):
            t = tok[pos]; pos += 1
            if t == '(':
                out.append(node())
            elif t == ')':
                return out
            else:
                out.append(t.strip('"'))
        return out
    return node()[0]


def find(n, name):
    return [c for c in n if isinstance(c, list) and c and c[0] == name]


b = pcbnew.LoadBoard(SRC)
for t in list(b.GetTracks()):
    if not t.IsLocked():                           # the fixed VBUS stubs and vias stay
        b.Remove(t)
tree = parse(open(SES).read())
routes = find(tree, 'routes')[0]
res = find(routes, 'resolution')[0]
assert res[1] == 'um', res
K = 1.0 / (float(res[2]) * 1000.0)                 # units -> mm
pt = lambda x, y: VECTOR2I(FromMM(float(x) * K), FromMM(-float(y) * K))
layer = {'F.Cu': pcbnew.F_Cu, 'B.Cu': pcbnew.B_Cu}
nseg = nvia = 0
length = 0.0
for net in find(find(routes, 'network_out')[0], 'net'):
    ni = b.FindNet(net[1])
    assert ni is not None, net[1]
    for w in find(net, 'wire'):
        p = find(w, 'path')[0]
        lay, width, xy = layer[p[1]], float(p[2]) * K, p[3:]
        pts = [pt(xy[i], xy[i + 1]) for i in range(0, len(xy), 2)]
        for a, c in zip(pts, pts[1:]):
            if abs(a.x - c.x) + abs(a.y - c.y) < 10000:      # under 0.01 mm: a stub the router leaves on a pad, no use to anyone
                continue
            tr = pcbnew.PCB_TRACK(b)
            tr.SetStart(a); tr.SetEnd(c); tr.SetWidth(FromMM(width)); tr.SetLayer(lay); tr.SetNet(ni)
            b.Add(tr); nseg += 1; length += tr.GetLength() / 1e6
    for v in find(net, 'via'):
        m = re.search(r'_(\d+):(\d+)_um', v[1])
        via = pcbnew.PCB_VIA(b)
        via.SetPosition(pt(v[2], v[3])); via.SetWidth(FromMM(int(m.group(1)) / 1000)); via.SetDrill(FromMM(int(m.group(2)) / 1000))
        via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu); via.SetNet(ni)
        b.Add(via); nvia += 1
pcbnew.SaveBoard(SRC, b)
print('imported: track segments', nseg, '| vias', nvia, '| track length mm', round(length, 1))
