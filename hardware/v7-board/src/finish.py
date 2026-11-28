"""Pour the zones, run KiCad's design-rule check, and export what a quote needs: Gerbers, drill file, parts list and
placement file in JLCPCB's column layout, and pictures of both sides.
    python3 build_all.py      (gen_board -> route -> import_ses -> this)"""
import csv, glob, os, re, shutil, subprocess, sys, zipfile
import pcbnew
from pcbnew import ToMM
import gen_board as GB

OUT = GB.OUT
SRC = os.path.join(OUT, 'trackside-v7.kicad_pcb')
# Library-bookkeeping checks are switched off in the project: the footprints on this board were edited on purpose (silkscreen
# trimmed off pads, part names moved), so they no longer match their library copies. Electrical and spacing checks are untouched.
import json
_pro = SRC.replace('.kicad_pcb', '.kicad_pro')
_j = json.load(open(_pro))
_j.setdefault('board', {}).setdefault('design_settings', {}).setdefault('rule_severities', {}).update({'lib_footprint_issues': 'ignore', 'lib_footprint_mismatch': 'ignore'})
json.dump(_j, open(_pro, 'w'), indent=2)
b = pcbnew.LoadBoard(SRC)
pcbnew.ZONE_FILLER(b).Fill(b.Zones())
pcbnew.SaveBoard(SRC, b)
rpt = os.path.join(OUT, 'drc.txt')
pcbnew.WriteDRCReport(b, rpt, pcbnew.EDA_UNITS_MILLIMETRES, True)
txt = open(rpt).read()
kinds = {}
for m in re.finditer(r'^\[(\w+)\]: (.*)$', txt, re.M):
    kinds[m.group(1)] = kinds.get(m.group(1), 0) + 1
head = re.findall(r'\*\* Found (\d+) (.*?) \*\*', txt)
print('DRC:', head, kinds)

G = os.path.join(OUT, 'gerbers')
shutil.rmtree(G, ignore_errors=True); os.makedirs(G)
layers = 'F.Cu,In1.Cu,In2.Cu,B.Cu,F.Paste,B.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts'
run = lambda *a: subprocess.run(a, capture_output=True, text=True)
r = run('kicad-cli', 'pcb', 'export', 'gerbers', '--output', G + '/', '--layers', layers, '--subtract-soldermask', SRC)
print('gerbers', r.returncode, (r.stdout + r.stderr).strip().splitlines()[-1:])
r = run('kicad-cli', 'pcb', 'export', 'drill', '--output', G + '/', '--format', 'excellon', '--excellon-separate-th', '--generate-map', '--map-format', 'gerberx2', SRC)
print('drill', r.returncode, (r.stdout + r.stderr).strip().splitlines()[-1:])
pos = os.path.join(OUT, 'pos-kicad.csv')
r = run('kicad-cli', 'pcb', 'export', 'pos', '--output', pos, '--format', 'csv', '--units', 'mm', '--side', 'both', SRC)
print('pos', r.returncode, (r.stdout + r.stderr).strip().splitlines()[-1:])

# placement file in JLCPCB's layout. KiCad's file lists SMD parts; through-hole parts are added from the board.
rows = []
for fp in b.GetFootprints():
    ref = fp.GetReference()
    if ref.startswith('TP'):
        continue
    p = fp.GetPosition()
    rows.append((ref, round(ToMM(p.x) - GB.ORG[0], 3), round(-(ToMM(p.y) - GB.ORG[1]), 3), 'Bottom' if fp.IsFlipped() else 'Top', round(fp.GetOrientationDegrees() % 360, 1)))
rows.sort(key=lambda q: (re.sub(r'\d', '', q[0]), int(re.sub(r'\D', '', q[0]) or 0)))
with open(os.path.join(OUT, 'cpl-jlc.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['Designator', 'Mid X', 'Mid Y', 'Layer', 'Rotation'])
    for ref, x, y, side, rot in rows:
        w.writerow([ref, f'{x}mm', f'{y}mm', side, rot])
print('cpl rows', len(rows), '(Top = the underside in the case)')

# pictures
for name, lay, mirror in (('underside', 'F.Cu,F.SilkS,F.Mask,Edge.Cuts', False), ('topside', 'B.Cu,B.SilkS,B.Mask,Edge.Cuts', True)):
    svg = os.path.join(OUT, f'board-{name}.svg')
    a = ['kicad-cli', 'pcb', 'export', 'svg', '--output', svg, '--layers', lay, '--page-size-mode', '2', '--exclude-drawing-sheet']
    if mirror:
        a.append('--mirror')
    r = run(*a, SRC)
    print('svg', name, r.returncode, (r.stdout + r.stderr).strip().splitlines()[-1:])

z = os.path.join(OUT, 'trackside-v7-gerbers.zip')
with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in sorted(glob.glob(G + '/*')):
        zf.write(f, os.path.basename(f))
print('zip', z, os.path.getsize(z), [os.path.basename(f) for f in sorted(glob.glob(G + '/*'))])
bb = b.GetBoardEdgesBoundingBox()
print('board', round(ToMM(bb.GetWidth()), 2), 'x', round(ToMM(bb.GetHeight()), 2), 'mm; layers', b.GetCopperLayerCount(), '; thickness', ToMM(b.GetDesignSettings().GetBoardThickness()))
