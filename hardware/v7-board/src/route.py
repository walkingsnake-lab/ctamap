"""Autoroute the generated board with Freerouting (run as an offline command-line tool).
    python3 gen_board.py && python3 route.py [passes]
The routing is a machine's first attempt. It makes the files a quote needs; it is not a reviewed layout."""
import os, re, subprocess, sys
import pcbnew
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'board'))
SRC = os.path.join(OUT, 'trackside-v7.kicad_pcb')
DSN, SES = os.path.join(OUT, 'v7.dsn'), os.path.join(OUT, 'v7.ses')
JAR = os.path.join(HERE, 'tools', 'fr-1.9.0.jar')      # Freerouting 1.9.0: not in the repo, download it there (github.com/freerouting/freerouting, releases)
PASSES = sys.argv[1] if len(sys.argv) > 1 else '40'
POWER = ('+3V3',)

b = pcbnew.LoadBoard(SRC)
# The router is given no pours. Ground and +5 V are already done: every pad has its own via into the inner planes (gen_board's
# fanout). So that the router leaves them alone, each pad-and-via group goes to it as a separate, already finished net.
for base in ('GND', '+5V'):
    pads = [p for fp in b.GetFootprints() for p in fp.Pads() if p.GetNetname() == base]
    trk = [t for t in b.GetTracks() if t.GetNetname() == base]
    items = pads + trk
    parent = list(range(len(items)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    vias = {(t.GetPosition().x, t.GetPosition().y): len(pads) + k for k, t in enumerate(trk) if t.Type() == pcbnew.PCB_VIA_T}
    for k, t in enumerate(trk):
        if t.Type() == pcbnew.PCB_VIA_T:
            continue
        for pt in (t.GetStart(), t.GetEnd()):
            if (pt.x, pt.y) in vias:
                parent[root(len(pads) + k)] = root(vias[(pt.x, pt.y)])
            for j, p in enumerate(pads):
                if p.IsOnLayer(t.GetLayer()) and p.HitTest(pt):
                    parent[root(len(pads) + k)] = root(j)
    for i, p in enumerate(pads):                     # pads stacked on one spot (a nut's ring and its plated hole) are one thing
        for j in range(i):
            if pads[j].GetPosition() == p.GetPosition() and pads[j].GetParent() == p.GetParent():
                parent[root(i)] = root(j)
    made = {}
    for i, it in enumerate(items):
        g = root(i)
        if g not in made:
            ni = pcbnew.NETINFO_ITEM(b, f'{base}_{len(made)}'); b.Add(ni); made[g] = ni
        it.SetNet(made[g])
    print(base, 'groups', len(made))
for z in list(b.Zones()):
    if not z.GetIsRuleArea():
        b.Remove(z)
ok = pcbnew.ExportSpecctraDSN(b, DSN)
print('dsn', ok, os.path.getsize(DSN))
s = open(DSN).read()
# wider tracks for the supply nets: take them out of the default class and give them their own
m = re.search(r'\(class kicad_default(.*?)\n\s*\(circuit', s, re.S)
names = m.group(1)
for n in POWER:
    names = re.sub(r'(?<![\w+"])"?' + re.escape(n) + r'"?(?![\w])', ' ', names)
s = s.replace(m.group(1), names)
VIA = re.search(r'\(use_via "?([^")\s]+)"?\)', s).group(1)      # the through via KiCad named for this layer count
cls = ('\n    (class Power ' + ' '.join(f'"{n}"' for n in POWER) +
       '\n      (circuit\n        (use_via "' + VIA + '")\n      )\n      (rule\n        (width 300)\n        (clearance 165)\n      )\n    )')
i = s.rfind('(class kicad_default')
j = s.find('\n    )', s.find('(rule', i)) + len('\n    )')
s = s[:j] + cls + s[j:]
s = s.replace('(clearance 150.1', '(clearance 165')         # the router works to 0.165; KiCad then checks at 0.15
open(DSN, 'w').write(s)
if os.path.exists(SES):
    os.remove(SES)
cmd = ['xvfb-run', '-a', 'java', '-jar', JAR, '-de', DSN, '-do', SES, '-mp', PASSES, '-mt', '0']      # -mt 0: no clean-up phase after routing; it ran 18 minutes without finishing
print(' '.join(cmd))
try:
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    log = r.stdout + r.stderr
except subprocess.TimeoutExpired as e:
    log = (e.stdout or b'').decode(errors='replace') + (e.stderr or b'').decode(errors='replace') + '\nTIMEOUT: router stopped after 300 s\n'
    subprocess.run(['pkill', '-f', 'fr-1.9.0.jar'])
open(os.path.join(OUT, 'freerouting.log'), 'w').write(log)
print(log[-1500:])
print('ses', os.path.exists(SES) and os.path.getsize(SES))
