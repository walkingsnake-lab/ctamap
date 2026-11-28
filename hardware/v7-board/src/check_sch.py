"""Compare the schematic's netlist with the board's, pin for pin. Exit 1 on any difference."""
import csv, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sx import parse, find
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'board'))
net = os.path.join(OUT, 'sch.net')
r = subprocess.run(['kicad-cli', 'sch', 'export', 'netlist', '--format', 'kicadsexpr', '-o', net, os.path.join(OUT, 'trackside-v7.kicad_sch')], capture_output=True, text=True)
print((r.stdout + r.stderr).strip()[-300:])
t = parse(open(net, encoding='utf-8').read())
sch = {}
for n in find(find(t, 'nets')[0], 'net'):
    name = str(find(n, 'name')[0][1]).lstrip('/')
    pins = {f"{find(x, 'ref')[0][1]}.{find(x, 'pin')[0][1]}" for x in find(n, 'node')}
    if not name.startswith('unconnected-'):
        sch[name] = pins
brd = {}
for row in csv.DictReader(open(os.path.join(OUT, 'netlist.csv'))):
    brd[row['Net']] = {p for p in row['Pins'].split() if not p.endswith('.')}
bad = 0
for n in sorted(set(sch) | set(brd)):
    a, b = sch.get(n, set()), brd.get(n, set())
    if a != b:
        bad += 1
        print('DIFF', n, '| only in schematic:', sorted(a - b), '| only on board:', sorted(b - a))
comps = {str(find(c, 'ref')[0][1]): str(find(c, 'footprint')[0][1]) for c in find(find(t, 'components')[0], 'comp')}
print('schematic: %d nets, %d parts | board: %d nets | differences: %d' % (len(sch), len(comps), len(brd), bad))
sys.exit(1 if bad else 0)
