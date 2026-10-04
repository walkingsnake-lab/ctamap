# Status screens (design spec §10): shown instead of failing silently.
#   CONNECTING  - trying the networks in settings.toml
#   WIFI OK     - connected and the server answered /board/ping
#   PORTAL      - a network answered with a captive portal; MAC shown for IT
#   NO WIFI     - no listed network could be joined
#   NO SERVER   - WiFi is fine but the server isn't answering

from . import draw

GREY = draw.C['grey']
WHITE = draw.C['label']
AMBER = draw.C['amber']
RED = draw.C['red']


def _center(f, font, s, base, color):
    f.text(font, s, (64 - draw.measure(font, s)) // 2, base, color)


def render(f, kind, detail=None):
    if kind == 'connecting':
        _center(f, '5x7', 'WIFI', 13, GREY)
        _center(f, 'small', (detail or '').upper()[:15], 22, GREY)
    elif kind == 'ok':
        _center(f, '5x7', 'WIFI OK', 13, WHITE)
        _center(f, 'small', (detail or '').upper()[:15], 22, GREY)
    elif kind == 'portal':
        _center(f, '5x7', 'PORTAL', 10, AMBER)
        # MAC as two lines of 3 octets, for IT to whitelist.
        mac = (detail or '').upper()
        _center(f, 'small', mac[:8], 20, WHITE)
        _center(f, 'small', mac[9:17], 27, WHITE)
    elif kind == 'nowifi':
        _center(f, '5x7', 'NO WIFI', 13, RED)
        _center(f, 'small', 'RETRYING', 22, GREY)
    elif kind == 'noserver':
        _center(f, '5x7', 'NO SERVER', 13, RED)
        _center(f, 'small', (detail or 'RETRYING').upper()[:15], 22, GREY)
    return f
