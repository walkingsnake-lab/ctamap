"""Renders the scenarios from scenarios.js with firmware/boardlib/draw.py and
compares every pixel with draw.js. Usage: python3 parity.py scenarios.json
Exit status 0 when everything matches; otherwise prints the first mismatches."""

import base64
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))
from boardlib import draw  # noqa: E402

# --device: render through the board's BoardFrame (palette-indexed bitmap,
# fills and radar copies via bitmaptools stand-ins) instead of draw.Frame.
DEVICE = '--device' in sys.argv
if DEVICE:
    import fakehw  # noqa: E402
    fakehw.install()
    from boardlib import device  # noqa: E402
    import displayio  # noqa: E402


class Result:
    def __init__(self, px):
        self.px = px


def new_frame():
    if not DEVICE:
        return draw.Frame()
    f = device.BoardFrame(displayio.Bitmap(64, 32, 256), displayio.Palette(256))
    f.begin()
    return f


def finish(f):
    if not DEVICE:
        return f
    f.commit()
    return Result(fakehw.to_rgb(f))


def diff(name, want_b64, f, limit=6):
    want = base64.b64decode(want_b64)
    if bytes(f.px) == want:
        return None
    bad = []
    for i in range(0, len(want), 3):
        if want[i:i + 3] != bytes(f.px[i:i + 3]):
            p = i // 3
            bad.append('(%d,%d) want %s got %s' % (p % 64, p // 64, tuple(want[i:i + 3]), tuple(f.px[i:i + 3])))
    return '%s: %d px differ: %s' % (name, len(bad), '; '.join(bad[:limit]))


def main(path):
    scenarios = json.load(open(path))
    fails = []
    count = 0
    for s in scenarios:
        if 'renders' in s:
            frames = {k: bytes(v) for k, v in s['frames'].items()} if s.get('frames') else None
            logos = {k: bytes(v) for k, v in s['logos'].items()} if s.get('logos') else None
            for r in s['renders']:
                o = r['opts']
                f = finish(draw.render(s['payload'], new_frame(), screen=o.get('screen'), now=o.get('now'),
                                       blink=o.get('blink', False), page=o.get('page', 0), slide=o.get('slide', 0),
                                       idx=o.get('idx'), frames=frames, game=o.get('game'), rolls=o.get('rolls'), logos=logos))
                count += 1
                d = diff('%s %s' % (s['name'], json.dumps(o)), r['px'], f)
                if d:
                    fails.append(d)
        else:
            anim = draw.TransitAnimator()
            for i, st in enumerate(s['steps']):
                view = anim.step(st['payload'], st['now'], st['t'])
                f = finish(draw.render(st['payload'], new_frame(), screen='transit', now=st['now'], view=view, blink=st['blink']))
                count += 1
                d = diff('%s step %d (t=%s)' % (s['name'], i, st['t']), st['px'], f)
                if d:
                    fails.append(d)
    for x in fails[:20]:
        print(x)
    print('%d frames compared, %d differ' % (count, len(fails)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main([a for a in sys.argv[1:] if not a.startswith('--')][0]))
