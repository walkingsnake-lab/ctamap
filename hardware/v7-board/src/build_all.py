"""gen_board -> route -> import -> finish, repeated (the router's result varies from run to run) until nothing is left unconnected"""
import os, re, subprocess, sys
H = os.path.dirname(os.path.abspath(__file__))
def run(*a):
    return subprocess.run([sys.executable, *a], cwd=H, capture_output=True, text=True)
r = run('gen_board.py'); open(os.path.join(H, '..', 'board', 'placement.txt'), 'w').write(r.stdout); print(r.stderr.strip()[-300:])
for attempt in range(1, 5):
    open(os.path.join(H, '..', 'board', 'route.log'), 'w').write(run('route.py', sys.argv[1] if len(sys.argv) > 1 else '150').stdout)
    print(run('import_ses.py').stdout.strip()[-200:])
    open(os.path.join(H, '..', 'board', 'finish.log'), 'w').write(run('finish.py').stdout)
    t = open(os.path.join(H, '..', 'board', 'drc.txt')).read()
    kinds = {}
    for k in re.findall(r'^\[(\w+)\]', t, re.M):
        kinds[k] = kinds.get(k, 0) + 1
    print('attempt', attempt, kinds or 'clean', re.findall(r'\*\* Found .*? \*\*', t))
    if 'unconnected_items' not in kinds:
        break
