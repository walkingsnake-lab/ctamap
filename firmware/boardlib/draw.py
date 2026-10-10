# Board drawing for CircuitPython: a line-by-line port of
# server/board/draw.js, the reference renderer. Given the same payload, time,
# and animation state, it must produce the same pixels; firmware/tests checks
# that against draw.js. Change draw.js first, then mirror the change here.
#
# Differences from draw.js, all deliberate:
#   - Colors are (r, g, b) tuples, not hex strings.
#   - Clock text uses the payload's `tzo` (UTC offset, seconds) instead of
#     Intl: CircuitPython has no time zone database.
#   - jsround() reproduces JavaScript's Math.round (halves round up);
#     Python's round() would round halves to even and shift pixels.
#   - Truthiness checks mirror the JS ones exactly (0 is falsy in both).
#
# Runs on CircuitPython and CPython: no typing, dataclasses, or re.

import math

from . import assets


def jsround(x):
    return math.floor(x + 0.5)


def hexc(s):
    return (int(s[1:3], 16), int(s[3:5], 16), int(s[5:7], 16))


# ---- frame ----

class Frame:
    """64x32 RGB framebuffer. The board subclasses it to draw into a bitmap."""

    def __init__(self, w=64, h=32):
        self.w = w
        self.h = h
        self.px = bytearray(w * h * 3)
        self.clip = None  # (x0, y0, x1, y1) inclusive
        self._clips = []

    def set(self, x, y, rgb):
        if x < 0 or y < 0 or x >= self.w or y >= self.h:
            return
        c = self.clip
        if c and (x < c[0] or y < c[1] or x > c[2] or y > c[3]):
            return
        i = (y * self.w + x) * 3
        self.px[i] = rgb[0]
        self.px[i + 1] = rgb[1]
        self.px[i + 2] = rgb[2]

    def get(self, x, y):
        i = (y * self.w + x) * 3
        return (self.px[i], self.px[i + 1], self.px[i + 2])

    def fill(self, x, y, w, h, rgb):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.set(i, j, rgb)

    def push_clip(self, x0, y0, x1, y1):
        self._clips.append(self.clip)
        self.clip = (x0, y0, x1, y1)

    def pop_clip(self):
        self.clip = self._clips.pop()

    # Text with its baseline at row `baseline` (glyph rows with BDF y >= 0
    # land on rows baseline-1 and up). Returns x after the last advance.
    def text(self, font_name, s, x, baseline, rgb):
        d = assets.FONT_DATA[font_name]
        for ch in s:
            o = glyph(font_name, ord(ch))
            if o < 0:
                continue
            dw, w, h, xo, yo = d[o], d[o + 1], d[o + 2], d[o + 3] - 128, d[o + 4] - 128
            top = baseline - (yo + h)
            for r in range(h):
                bits = glyph_row(d, o, r)
                for c in range(w):
                    if (bits >> (w - 1 - c)) & 1:
                        self.set(x + xo + c, top + r, rgb)
            x += dw
        return x


# ---- packed fonts (assets.py) ----
# A glyph is an offset into assets.FONT_DATA[font]: dwidth, w, h, xoff + 128,
# yoff + 128, then its rows (1 byte each, 2 when wider than 8 px).

def glyph(font_name, cp):
    """Offset of codepoint cp's glyph in FONT_DATA[font_name], or -1."""
    if assets.LOW0 <= cp < assets.LOW0 + 224:
        t = assets.FONT_LOW[font_name]
        i = (cp - assets.LOW0) << 1
    elif assets.PUA <= cp < assets.PUA + 16:
        t = assets.FONT_PUA[font_name]
        i = (cp - assets.PUA) << 1
    else:
        return -1
    o = (t[i] << 8) | t[i + 1]
    return -1 if o == 0xFFFF else o


def glyph_row(d, o, r):
    """Row r's bits (MSB-left) of the glyph at offset o in font data d."""
    if d[o + 1] > 8:
        p = o + 5 + (r << 1)
        return (d[p] << 8) | d[p + 1]
    return d[o + 5 + r]


def measure(font_name, s):
    d = assets.FONT_DATA[font_name]
    w = 0
    for ch in s:
        o = glyph(font_name, ord(ch))
        if o >= 0:
            w += d[o]
    return w - 1 if w > 0 else 0


# ---- pure helpers ----

def minutes_until(t, now):
    return math.ceil((t - now) / 60)


def time_text(t, now, due=True):
    m = minutes_until(t, now)
    if m <= 1:
        return 'DUE' if due else '2'
    return str(m)


def chrono_text(t, now, due=True):
    m = minutes_until(t, now)
    if m <= 1:
        return 'DUE' if due else '2m'
    return str(m) + 'm'


DROP_GRACE = 30


def max_rows(has_header, has_weather):
    return (4 if has_header else 5) - (2 if has_weather else 0)


def row_tops(n, has_header, has_weather, divider=False):
    """Mirrors rowTops in draw.js: without the header's divider line, the
    header layouts move up so the gap under the header matches the rest."""
    if has_header and not has_weather and n == 2:
        return [12, 21] if divider else [10, 19]
    tops = _row_tops_base(n, has_header, has_weather)
    if not has_header or divider or not tops:
        return tops
    shift = 2 if (not has_weather and n <= 2) else 1
    return [t - shift for t in tops]


def _row_tops_base(n, has_header, has_weather):
    if n == 0:
        return []
    if not has_header:
        if not has_weather and n == 4:
            return [1, 9, 17, 25]
        area_h = 22 if has_weather else 32
        gap = max(1, jsround((area_h - 5 * n) / (n + 1)))
        top = (area_h - 5 * n - (n - 1) * gap) // 2
        return [top + i * (5 + gap) for i in range(n)]
    if has_header and not has_weather and n == 4:
        return [9, 15, 21, 27]
    if has_header and not has_weather and n == 3:
        return [10, 18, 26]
    if has_header and not has_weather and n == 2:
        return [13, 23]
    area_top = 9
    area_bottom = 20 if has_weather else 31
    area_h = area_bottom - area_top + 1
    preferred = {2: 8, 3: 8, 4: 6, 5: 6}
    pitch = 0 if n == 1 else min(preferred[n], (area_h - 5) // (n - 1))
    block = (n - 1) * pitch + 5
    top = area_top + max(0, (area_h - block) // 2)
    return [top + i * pitch for i in range(n)]


# A train drops DROP_GRACE s after its time, as the server drops it, but
# only once a payload made after that moment agrees: until then it stays
# (DUE), since the server may have pushed its time later (a held train).
# HOLD_MAX caps the wait. Mirrors isShown() in draw.js.
HOLD_MAX = 60


def is_shown(x, now, pnow):
    return x >= now - DROP_GRACE or (pnow is not None and pnow < x + DROP_GRACE and x >= now - DROP_GRACE - HOLD_MAX)


def live_rows(p, now):
    out = []
    pnow = p.get('now')
    for r in p.get('rows') or []:
        t = []
        s = []
        rs = r.get('s')
        for i, x in enumerate(r['t']):
            if is_shown(x, now, pnow):
                t.append(x)
                s.append(rs[i] if rs else 0)
        if t:
            row = dict(r)
            row['t'] = t
            row['s'] = s
            out.append(row)
    return out


def live_ticker(p, now):
    pnow = p.get('now')
    return [x for x in (p.get('ticker') or []) if is_shown(x['t'], now, pnow)]


def slot_key(r, k):
    return '%s:%s:%d' % (r['ln'], r['lbl'], k)


def ease_in_out(x):
    return 2 * x * x if x < 0.5 else 1 - math.pow(-2 * x + 2, 2) / 2


def scale_color(rgb, k):
    return (jsround(rgb[0] * k), jsround(rgb[1] * k), jsround(rgb[2] * k))


def fade(rgb, alpha):
    return rgb if alpha >= 1 else scale_color(rgb, max(0, alpha))


# ---- colors ----

LINE = {
    'RD': hexc('#c60c30'), 'BL': hexc('#00a1de'), 'BR': hexc('#62361b'), 'GR': hexc('#009b3a'),
    'OR': hexc('#f9461c'), 'PR': hexc('#522398'), 'PK': hexc('#e27ea6'), 'YL': hexc('#f9e300'),
}
# Index digits in the chronological view: Brown and Purple brightened.

C = {
    'label': hexc('#d8d8d8'), 'clock': hexc('#cccccc'), 'radarTime': hexc('#7a7a7a'), 'radarAmpm': hexc('#8f8f8f'), 'radarSub': hexc('#666666'), 'wxText': hexc('#8f8f8f'), 'amber': hexc('#ffb000'), 'dimAmber': hexc('#664600'),
    'sch': hexc('#b0b0b0'), 'schDim': hexc('#474747'), 'grey': hexc('#8f8f8f'),
    'divider': hexc('#333333'), 'head': hexc('#808080'), 'index': hexc('#2d2d2d'), 'white': hexc('#ffffff'),
    'red': hexc('#ff2020'), 'watch': hexc('#ffd800'), 'warnSevere': hexc('#ff8000'), 'warnTornado': hexc('#ff2020'),
    'noTrains': hexc('#6c6c6c'), 'indicator': hexc('#3a3a3a'),
}

TIME_GAP = 3
TIGHT_GAP = 2
LABEL_GAP = 3
TAG_GAP = 3
ROLL_DIST = 6

ROLL_MS = 400
FADE_MS = 700
MOVE_MS = 500
COLOR_MS = 700
MATCH_S = 90
BLINK_MS = 1000


def timing(p):
    """Speed settings from the payload's `anim` (ms; `game` in s), with
    defaults. Mirrors timing() in draw.js."""
    a = (p.get('anim') if p else None) or {}
    return {
        'pageHold': a.get('pageHold') or 8000, 'slide': a.get('slide') or 1200,
        'radarFrame': a.get('radarFrame') or 500, 'radarHold': a.get('radarHold') or 4000,
        'game': a.get('game') or 60,
    }

# Precip fills at ~65%; the greens (light rain, most of any loop, and the
# brightest color on the panel) at 70% of that. rb (radar.rb, percent,
# default 100) scales all precip. Mirrors radarColors() in draw.js.
RADAR_FILL = 0.65
RADAR_BASE = ((1, '#1f8f1f', 0.7), (2, '#2ee02e', 0.7), (3, '#ffe000', 1), (4, '#ff8c00', 1), (5, '#ff1a1a', 1),
              (8, '#4f86ff', 1), (9, '#a9c9ff', 1), (10, '#ffffff', 1))


def radar_colors(rb):
    out = {6: hexc('#34485e'), 7: hexc('#ffffff')}
    for v, c, trim in RADAR_BASE:
        out[v] = scale_color(hexc(c), RADAR_FILL * trim * rb / 100)
    return out


RADAR = radar_colors(100)
_radar_rc = [100, RADAR]  # last rb and its colors: rebuilt only when rb changes


def radar_for(rb):
    if rb is None:
        rb = 100
    if rb != _radar_rc[0]:
        _radar_rc[0] = rb
        _radar_rc[1] = radar_colors(rb)
    return _radar_rc[1]


def g(cp):
    return chr(cp)


def rtext(f, font, s, right, base, rgb):
    return f.text(font, s, right - measure(font, s) + 1, base, rgb)


def text_box(font, s, x, base):
    y0 = None
    y1 = None
    d = assets.FONT_DATA[font]
    for ch in s:
        o = glyph(font, ord(ch))
        if o >= 0 and d[o + 1] and d[o + 2]:
            yo = d[o + 4] - 128
            top = base - (yo + d[o + 2])
            bottom = base - yo - 1
            y0 = top if y0 is None else min(y0, top)
            y1 = bottom if y1 is None else max(y1, bottom)
    return (x, y0, x + measure(font, s) - 1, y1)


# ---- time (Chicago, via the payload's UTC offset) ----
# Integer math on epoch times: CircuitPython's math.floor goes through a
# float, which can't hold epoch seconds.

def clock_text(t, tzo):
    lt = int((t + tzo) // 1)
    h = (lt // 3600) % 24
    m = (lt // 60) % 60
    h12 = h % 12 or 12
    return '%d:%02d' % (h12, m)


def ampm_text(t, tzo):
    lt = int((t + tzo) // 1)
    return 'PM' if (lt // 3600) % 24 >= 12 else 'AM'


# ---- pieces ----

def draw_icon(f, name, x, y):
    icon = assets.ICONS[name]  # 8 x 8 bytes, palette letter codes; 46 ('.') = none
    for j in range(8):
        for i in range(8):
            c = icon[j * 8 + i]
            if c != 46:
                f.fill(x + i, y + j, 1, 1, assets.ICON_PALETTE[c])


# Station name + clock on rows 1-5, flush to the screen edges, both in the
# header grey (transit and ticker). `divider`: a line on row 7 (transit).
def draw_header(f, name, now, tzo, divider=False, clock=True):
    f.text('small', name, 0, 6, C['head'])
    if clock:
        rtext(f, 'small', clock_text(now, tzo), 63, 6, C['head'])
    if divider:
        f.fill(0, 7, 64, 1, C['divider'])


def warn_style(warn):
    glyph = g(assets.FUNNEL if warn['kind'] == 'tor' else assets.BOLT)
    if warn['lvl'] == 'watch':
        color = C['watch']
    else:
        color = C['warnTornado'] if warn['kind'] == 'tor' else C['warnSevere']
    return glyph, color, warn['kind'] == 'tor' and warn['lvl'] == 'warning'


def draw_weather(f, wx, warn, blink=False, divider=True):
    if divider:
        f.fill(0, 22, 64, 1, C['divider'])
    draw_icon(f, wx['icon'], 0, 24)
    base = 31
    f.text('small', str(wx['temp']) + '°', 10, base, C['wxText'])
    if warn:
        glyph, color, blinks = warn_style(warn)
        word = 'WARNING' if warn['lvl'] == 'warning' else 'WATCH'
        if not (blinks and blink):
            w = measure('small', glyph) + TAG_GAP + measure('small', word)
            x = f.text('small', glyph, 63 - w + 1, base, color)
            f.text('small', word, x + TAG_GAP - 1, base, color)
    else:
        rtext(f, 'small', wx['word'], 63, base, C['wxText'])


def _is_num(s):
    if not s:
        return False
    if s[-1] == 'm':
        s = s[:-1]
    if not s:
        return False
    for ch in s:
        if ch < '0' or ch > '9':
            return False
    return True


# One time cell, right-aligned at `right`, optionally mid-roll from
# roll['from']. Same-length numbers roll only the digits that changed.
def draw_time_cell(f, text, right, top, color, roll):
    base = top + 5
    if not roll or roll['from'] == text or roll['p'] >= 1:
        rtext(f, 'small', text, right, base, color)
        return
    up = jsround(ease_in_out(roll['p']) * ROLL_DIST)
    f.push_clip(0, top, 63, top + 4)
    try:
        frm = roll['from']
        if len(frm) == len(text) and _is_num(frm) and _is_num(text):
            x = right - measure('small', text) + 1
            for i in range(len(text)):
                if frm[i] == text[i]:
                    f.text('small', text[i], x, base, color)
                else:
                    f.text('small', frm[i], x, base - up, color)
                    f.text('small', text[i], x, base - up + ROLL_DIST, color)
                x += measure('small', text[i]) + 1
        else:
            rtext(f, 'small', frm, right, base - up, color)
            rtext(f, 'small', text, right, base - up + ROLL_DIST, color)
    finally:
        f.pop_clip()


def layout_cells(r, now):
    texts = [time_text(t, now, k == 0) for k, t in enumerate(r['t'])]

    def width_at(gap):
        w = 0
        for i, txt in enumerate(texts):
            w += measure('small', txt) + (gap if i else 0)
        return w

    label_end = 5 + measure('small', r['lbl']) - 1
    gap = TIME_GAP if 63 - width_at(TIME_GAP) + 1 - label_end - 1 >= LABEL_GAP else TIGHT_GAP
    cells = [None] * len(texts)
    x = 63
    rs = r.get('s')
    for k in range(len(texts) - 1, -1, -1):
        sch = rs and rs[k]
        if sch:
            color = C['schDim'] if k else C['sch']
        else:
            color = C['dimAmber'] if k else C['amber']
        cells[k] = {'id': slot_key(r, k), 't': r['t'][k], 'text': texts[k], 'right': x,
                    'alpha': 1, 'roll': None, 'color': color}
        x -= measure('small', texts[k]) + gap
    return cells


def build_transit_view(p, now):
    if p.get('view') == 'chrono':
        return build_chrono_view(p, now)
    rows = live_rows(p, now)
    tops = row_tops(len(rows), bool(p.get('header')), bool(p.get('wx')), p.get('headerDivider') is True)
    return {
        'now': now, 'mode': 'dest', 'header': p.get('header'), 'wx': p.get('wx'), 'warn': p.get('warn'),
        'hdiv': p.get('headerDivider') is True, 'wdiv': p.get('wxDivider') is not False,
        'clock': p.get('hclock') is not False, 'lnc': p.get('lnc') is True,
        'stale': p.get('stale'), 'tzo': p.get('tzo', 0),
        'rows': [{'key': r['ln'] + ':' + r['lbl'], 'ln': r['ln'], 'lbl': r['lbl'], 'a': r.get('a'),
                  'num': None, 'numRoll': None, 'top': tops[i], 'alpha': 1, 'cells': layout_cells(r, now)}
                 for i, r in enumerate(rows)],
    }


def _first_t(r):
    return r['t'][0]


def build_chrono_view(p, now):
    # Sorted here too, by time (stable). Mirrors buildChronoView in draw.js.
    rows = sorted(live_rows(p, now), key=_first_t)[:max_rows(bool(p.get('header')), bool(p.get('wx')))]
    tops = row_tops(len(rows), bool(p.get('header')), bool(p.get('wx')), p.get('headerDivider') is True)
    out = []
    seen_dest = set()
    seen_key = set()
    for i, r in enumerate(rows):
        dest = '%s:%s' % (r['ln'], r['lbl'])
        due = dest not in seen_dest
        seen_dest.add(dest)
        key = ('rn:' + str(r['rn'])) if r.get('rn') is not None else '%s:%s:%s' % (r['ln'], r['lbl'], r['t'][0])
        if key in seen_key:
            key += '#%d' % i
        seen_key.add(key)
        sch = r.get('s') and r['s'][0]
        if sch:
            color = C['schDim'] if i else C['sch']
        else:
            color = C['dimAmber'] if i else C['amber']
        out.append({'key': key, 'ln': r['ln'], 'lbl': r['lbl'], 'a': r.get('a'), 'num': i + 1, 'numRoll': None,
                    'top': tops[i], 'alpha': 1,
                    'cells': [{'id': key, 't': r['t'][0], 'text': chrono_text(r['t'][0], now, due), 'right': 63,
                               'alpha': 1, 'roll': None, 'color': color}]})
    return {
        'now': now, 'mode': 'chrono', 'pitch': (tops[1] - tops[0]) if len(tops) > 1 else 6,
        'header': p.get('header'), 'wx': p.get('wx'), 'warn': p.get('warn'), 'stale': p.get('stale'),
        'hdiv': p.get('headerDivider') is True, 'wdiv': p.get('wxDivider') is not False,
        'clock': p.get('hclock') is not False, 'lnc': p.get('lnc') is True,
        'tzo': p.get('tzo', 0), 'rows': out,
    }


# Chronological rows: digit in columns 0-2, the 3px line-color block at
# CHRONO_BLOCK_X (1px gap), the label 2px after it.
CHRONO_BLOCK_X = 4
CHRONO_LABEL_X = 9


def draw_view_row(f, row, blink, lnc=False):
    top = jsround(row['top'])
    chrono = row.get('num') is not None
    line = fade(LINE[row['ln']], row['alpha'])
    if chrono:
        draw_time_cell(f, str(row['num']), 2, top, fade(LINE[row['ln']], row['alpha']), row.get('numRoll'))
    bx = CHRONO_BLOCK_X if chrono else 0
    if row.get('a') and blink:
        for j, r in enumerate(assets.ALERT_BANG):
            for i, c in enumerate(r):
                if c == '#':
                    f.fill(bx + i, top + j, 1, 1, line)
    else:
        f.fill(bx, top, 3, 5, line)
    f.text('small', row['lbl'], CHRONO_LABEL_X if chrono else 5, top + 5, fade(LINE[row['ln']] if lnc else C['label'], row['alpha']))
    for cell in row['cells']:
        a = cell['alpha'] * row['alpha']
        if a <= 0:
            continue
        draw_time_cell(f, cell['text'], jsround(cell['right']), top, fade(cell['color'], a), cell.get('roll'))


def draw_overnight(f, view, now):
    clock = clock_text(now, view.get('tzo', 0))
    nt = 'NO DATA' if view.get('stale') else 'NO TRAINS'
    block_h = 10 + 3 + 5
    area_h = 22 if view.get('wx') else 32
    top = (area_h - block_h) // 2
    f.text('clock', clock, (64 - measure('clock', clock)) // 2, top + 10, C['clock'])
    f.text('small', nt, (64 - measure('small', nt)) // 2, top + 18, C['noTrains'])


def draw_stale(f, p):
    if p.get('stale'):
        f.fill(0, 0, 64, 1, C['red'])


def draw_transit_view(f, view, blink):
    if not view['rows']:
        draw_overnight(f, view, view['now'])
    else:
        if view.get('header'):
            draw_header(f, view['header'], view['now'], view.get('tzo', 0), view.get('hdiv') is True, view.get('clock') is not False)
        f.push_clip(0, 7 if view.get('header') else 0, 63, 21 if view.get('wx') else 31)
        try:
            for row in view['rows']:
                draw_view_row(f, row, blink, view.get('lnc') is True)
        finally:
            f.pop_clip()
    if view.get('wx'):
        draw_weather(f, view['wx'], view.get('warn'), blink, view.get('wdiv') is not False)


def render_transit(p, f, now=None, blink=False, view=None):
    if now is None:
        now = p['now']
    if view is None:
        view = build_transit_view(p, now)
    draw_transit_view(f, view, blink)
    draw_stale(f, p)
    return f


# ---- transit animation (createTransitAnimator) ----

def _lerp(a, b, k):
    return a + (b - a) * k


def _lerp_color(c1, c2, k):
    if k >= 1 or c1 == c2:
        return c2
    return (jsround(_lerp(c1[0], c2[0], k)), jsround(_lerp(c1[1], c2[1], k)), jsround(_lerp(c1[2], c2[2], k)))


def _clamp01(x):
    return max(0, min(1, x))


def _tween(frm, to, start, dur, t):
    if t <= start:
        return frm
    if t >= start + dur:
        return to
    return _lerp(frm, to, ease_in_out((t - start) / dur))


def _pair_cells(old, cells):
    n = len(old)
    m = len(cells)
    cost = [[0] * (m + 1) for _ in range(n + 1)]
    how = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(n, -1, -1):
        for j in range(m, -1, -1):
            if i == n or j == m:
                cost[i][j] = (n - i + m - j) * MATCH_S
                continue
            best = cost[i + 1][j] + MATCH_S
            pick = 'old'
            if cost[i][j + 1] + MATCH_S < best:
                best = cost[i][j + 1] + MATCH_S
                pick = 'new'
            d = abs(old[i]['t'] - cells[j]['t'])
            if d <= MATCH_S and cost[i + 1][j + 1] + d < best:
                best = cost[i + 1][j + 1] + d
                pick = 'pair'
            cost[i][j] = best
            how[i][j] = pick
    out = [None] * m
    i = 0
    j = 0
    while i < n and j < m:
        if how[i][j] == 'pair':
            out[j] = old[i]
            i += 1
            j += 1
        elif how[i][j] == 'old':
            i += 1
        else:
            j += 1
    return out


class TransitAnimator:
    """Keeps arrivals' identity across frames and updates so the board can
    animate what changed (rolls, fades, color easing, row slides). step()
    returns the view to draw at animation time t (ms)."""

    def __init__(self):
        self.next_id = 1
        self.rows = {}  # key -> row state (insertion-ordered, like a JS Map)

    def _match_cells(self, state, cells, t, is_new_row):
        unmatched = [c for c in state['cells'] if not c.get('leaving')]
        pairs = _pair_cells(unmatched, cells)
        used = []
        out = []
        moved = []
        joined = []
        for j, c in enumerate(cells):
            m = pairs[j]
            if m is not None:
                used.append(m)
                if m['text'] != c['text']:
                    m['roll'] = {'from': m['text'], 'start': t}
                if m['color'] != c['color']:
                    m['fromColor'] = m.get('shownColor') or m['color']
                    m['colorStart'] = t
                if m['right'] != c['right']:
                    m['fromRight'] = m['right'] if m.get('shownRight') is None else m['shownRight']
                    m['moveStart'] = t
                    moved.append(m)
                m['t'] = c['t']
                m['text'] = c['text']
                m['color'] = c['color']
                m['right'] = c['right']
                out.append(m)
            else:
                n = dict(c)
                n['id'] = self.next_id
                self.next_id += 1
                n['born'] = None if is_new_row else t
                if not is_new_row:
                    joined.append(n)
                out.append(n)
        for u in unmatched:
            if not _contains(used, u):
                u['leaving'] = t
                out.append(u)
        for c in state['cells']:
            if c.get('leaving') and c['leaving'] != t and t - c['leaving'] < FADE_MS:
                out.append(c)
        dedup = []
        for c in out:
            if not _contains(dedup, c):
                dedup.append(c)
        state['cells'] = dedup
        # Cells slide and join only once the leaving ones have faded.
        until = t
        for c in state['cells']:
            if c.get('leaving'):
                until = max(until, c['leaving'] + FADE_MS)
        for m in moved:
            m['moveStart'] = until
        for n in joined:
            n['born'] = until + (MOVE_MS if moved else 0)

    def step(self, p, now, t):
        target = build_transit_view(p, now)
        chrono = target['mode'] == 'chrono'
        keys = [r['key'] for r in target['rows']]
        current = [st for st in self.rows.values() if not st.get('leaving')]
        first_top = min([st['top'] for st in current]) if current else float('inf')
        continuing = False
        for st in current:
            if st['key'] in keys:
                continuing = True
                break
        leaving_until = 0
        for key, st in list(self.rows.items()):
            if key not in keys and not st.get('leaving'):
                st['leaving'] = t
                if chrono and st.get('mode') == 'chrono' and st['top'] == first_top:
                    st['fromTop'] = st['shownTop']
                    st['top'] = st['top'] - target['pitch']
                    st['moveStart'] = t
            if st.get('leaving'):
                if t - st['leaving'] >= FADE_MS:
                    del self.rows[key]
                elif not (chrono and st.get('mode') == 'chrono'):
                    leaving_until = max(leaving_until, st['leaving'] + FADE_MS)
        for r in target['rows']:
            st = self.rows.get(r['key'])
            is_new_row = st is None or bool(st.get('leaving'))
            if is_new_row:
                st = {'key': r['key'], 'top': r['top'], 'shownTop': r['top'],
                      'born': t if len(self.rows) else None, 'cells': [], 'num': None}
                if chrono and continuing:
                    st['fromTop'] = r['top'] + target['pitch']
                    st['moveStart'] = t
                # A JS Map keeps a re-set key in its original position.
                self.rows[r['key']] = st
            elif st['top'] != r['top']:
                st['fromTop'] = st['shownTop']
                st['moveStart'] = max(t, leaving_until)
                st['top'] = r['top']
            if r.get('num') is not None and st.get('num') is not None and st['num'] != r['num'] and not is_new_row:
                st['numRoll'] = {'from': str(st['num']), 'start': t}
            st['ln'] = r['ln']
            st['lbl'] = r['lbl']
            st['a'] = r.get('a')
            st['num'] = r.get('num')
            st['mode'] = target['mode']
            self._match_cells(st, r['cells'], t, is_new_row)

        view = {'now': now, 'mode': target['mode'], 'header': target.get('header'), 'wx': target.get('wx'),
                'hdiv': target.get('hdiv'), 'wdiv': target.get('wdiv'),
                'clock': target.get('clock') is not False, 'lnc': target.get('lnc') is True,
                'warn': target.get('warn'), 'stale': target.get('stale'), 'tzo': target.get('tzo', 0), 'rows': []}
        if not target['rows'] and not any(st.get('leaving') for st in self.rows.values()):
            self.rows.clear()
            return view
        for st in self.rows.values():
            st['shownTop'] = _tween(st['fromTop'], st['top'], st['moveStart'], MOVE_MS, t) \
                if st.get('moveStart') is not None else st['top']
            if st.get('leaving'):
                alpha = 1 - _clamp01((t - st['leaving']) / FADE_MS)
            elif st.get('born') is not None:
                alpha = _clamp01((t - max(st['born'], leaving_until)) / FADE_MS)
            else:
                alpha = 1
            cells = []
            for c in st['cells']:
                if c.get('leaving') and not (t - c['leaving'] < FADE_MS):
                    continue
                c['shownRight'] = _tween(c['fromRight'], c['right'], c['moveStart'], MOVE_MS, t) \
                    if c.get('moveStart') is not None else c['right']
                if c.get('colorStart') is not None:
                    c['shownColor'] = _lerp_color(c['fromColor'], c['color'],
                                                  ease_in_out(_clamp01((t - c['colorStart']) / COLOR_MS)))
                else:
                    c['shownColor'] = c['color']
                roll_p = (t - c['roll']['start']) / ROLL_MS if c.get('roll') else 1
                if roll_p >= 1:
                    c['roll'] = None
                if c.get('leaving'):
                    ca = 1 - _clamp01((t - c['leaving']) / FADE_MS)
                elif c.get('born') is not None:
                    ca = _clamp01((t - c['born']) / FADE_MS)
                else:
                    ca = 1
                cells.append({'id': c['id'], 'text': c['text'], 'right': c['shownRight'], 'color': c['shownColor'],
                              'alpha': ca, 'roll': {'from': c['roll']['from'], 'p': roll_p} if c.get('roll') else None})
            st['cells'] = [c for c in st['cells'] if not c.get('leaving') or t - c['leaving'] < FADE_MS]
            num_p = (t - st['numRoll']['start']) / ROLL_MS if st.get('numRoll') else 1
            if num_p >= 1:
                st['numRoll'] = None
            view['rows'].append({
                'key': st['key'], 'ln': st['ln'], 'lbl': st['lbl'], 'a': st.get('a'), 'top': st['shownTop'],
                'alpha': alpha, 'cells': cells, 'num': st.get('num'),
                'numRoll': {'from': st['numRoll']['from'], 'p': num_p} if st.get('numRoll') else None,
            })
        return view


def _contains(lst, obj):
    for x in lst:
        if x is obj:
            return True
    return False


# ---- ticker ----

def draw_ticker_item(f, it, idx, top, now, due, fill):
    base = top + 9
    f.fill(0, top, 5, 12, C['index'])
    f.fill(5, top, 59, 12, scale_color(LINE[it['ln']], fill))
    if it.get('a'):
        f.text('small', g(assets.ALERT_DISC), 0, base, C['red'])
        f.text('small', g(assets.ALERT_MARK), 0, base, C['white'])
    elif it.get('s'):
        f.text('small', g(assets.CLOCK), 0, base, C['label'])
    else:
        f.text('small', str(idx), 1, base, C['label'])
    f.text('5x7', it['d'], 7, base, C['white'])
    m = minutes_until(it['t'], now)
    if m <= 1 and due:
        rtext(f, '5x7', 'Due', 62, base, C['white'])
    else:
        # A second train within a minute of the first shows 2, not Due.
        mw = measure('5x7', g(assets.MIN))
        f.text('5x7', g(assets.MIN), 62 - mw + 1, base, C['white'])
        rtext(f, '5x7', str(2 if m <= 1 else m), 62 - mw - 2, base, C['white'])


def ticker_pages(p, now):
    return max(1, -(-len(live_ticker(p, now)) // 2))


def render_ticker(p, f, now=None, page=0, slide=0):
    if now is None:
        now = p['now']
    th = p['tickerHeader'] if 'tickerHeader' in p else p.get('header')
    if th:
        draw_header(f, th, now, p.get('tzo', 0), False, p.get('hclock') is not False)
    items = live_ticker(p, now)
    fill = (p.get('tickerFill') or 55) / 100
    pages = max(1, -(-len(items) // 2))
    page = (page or 0) % pages
    offset = jsround(ease_in_out(min(1, max(0, slide or 0))) * 26)

    # Only the soonest train per destination may read Due.
    first_of = {}
    for i, it in enumerate(items):
        k = '%s:%s' % (it['ln'], it['d'])
        if k not in first_of or it['t'] < items[first_of[k]]['t']:
            first_of[k] = i

    def draw_page(pg, shift):
        for i, it in enumerate(items[pg * 2:pg * 2 + 2]):
            n = pg * 2 + i
            draw_ticker_item(f, it, n + 1, 7 + i * 13 + shift, now, first_of['%s:%s' % (it['ln'], it['d'])] == n, fill)

    f.push_clip(0, 7, 63, 31)
    try:
        draw_page(page, -offset)
        if offset > 0 and pages > 1:
            draw_page((page + 1) % pages, 26 - offset)
    finally:
        f.pop_clip()
    draw_stale(f, p)
    return f


# ---- radar ----

# ---- weather screen (design spec §7) ----
# The radar screen without rain (no frames). Mirrors drawWeatherScreen() in
# draw.js.

WX_BLUE = hexc('#1e90ff')
WX_DROP = ('.#.', '###', '###', '.#.')
WARN_TEXT = {
    'svr': {'watch': 'TSTORM WATCH', 'warning': 'TSTORM WARNING'},
    'tor': {'watch': 'TORNADO WATCH', 'warning': 'TORNADO WARN'},
}


TEMP_STOPS = ((-10, hexc('#3050ff')), (20, hexc('#40a0ff')), (40, hexc('#30d0d0')), (55, hexc('#40d040')),
              (70, hexc('#ffd000')), (85, hexc('#ff8000')), (100, hexc('#ff2020')))


def temp_color(t):
    if t <= TEMP_STOPS[0][0]:
        return TEMP_STOPS[0][1]
    for i in range(1, len(TEMP_STOPS)):
        t1, c1 = TEMP_STOPS[i]
        if t <= t1:
            t0, c0 = TEMP_STOPS[i - 1]
            return _lerp_color(c0, c1, (t - t0) / (t1 - t0))
    return TEMP_STOPS[-1][1]


def draw_weather_screen(f, wx, warn, blink, shadow=False):
    def draw_temp(dx, dy, color):
        x = dx
        if wx['temp'] < 0:
            f.fill(x, 8 + dy, 5, 2, color)
            x += 7
        x = f.text('clock', str(abs(wx['temp'])), x, 14 + dy, color)
        f.fill(x, 4 + dy, 3, 1, color)
        f.fill(x, 6 + dy, 3, 1, color)
        f.fill(x, 5 + dy, 1, 1, color)
        f.fill(x + 2, 5 + dy, 1, 1, color)
        return x + 2

    if shadow:
        draw_temp(1, 1, scale_color(temp_color(wx["temp"]), 0.2))
    temp_right = draw_temp(0, 0, C['label']) + (1 if shadow else 0)
    if wx.get('icon') in assets.ICONS:
        draw_icon(f, wx['icon'], 55, 1)
    word = wx.get('word')
    if word and 63 - measure('small', word) + 1 > temp_right + 2:
        rtext(f, 'small', word, 63, 16, C['wxText'])
    f.fill(0, 18, 64, 1, C['divider'])
    if wx.get('feels') is not None:
        f.text('small', 'FEELS %s°' % wx['feels'], 0, 25, C['grey'])
    if wx.get('wind'):
        rtext(f, 'small', wx['wind'], 63, 25, C['label'])
    if warn:
        glyph, color, blinks = warn_style(warn)
        if not (blinks and blink):
            gx = f.text('small', glyph, 0, 31, color)
            f.text('small', WARN_TEXT[warn['kind']][warn['lvl']], gx + TAG_GAP - 1, 31, color)
        return
    pop_left = 64
    if wx.get('pop') is not None:
        t = '%s%%' % wx['pop']
        px = 63 - measure('small', t) + 1
        f.text('small', t, px, 31, C['label'])
        for j, row in enumerate(WX_DROP):
            for i, c in enumerate(row):
                if c == '#':
                    f.fill(px - 5 + i, 27 + j, 1, 1, WX_BLUE)
        pop_left = px - 5
    if wx.get('hi') is not None and wx.get('lo') is not None:
        hl = 'H %s° L %s°' % (wx['hi'], wx['lo'])
        if measure('small', hl) + 3 > pop_left:
            hl = 'H %s L %s' % (wx['hi'], wx['lo'])
        f.text('small', hl, 0, 31, C['grey'])


# ---- 5-day layout ----
# The weather screen without rain when wx carries `days`. Mirrors
# drawFiveDay() in draw.js.

FD_LETTER = hexc('#4a4a4a')
FD_NUM = C['grey']
FD_PITCH = 13
FD_ICON_X = 1
FD_HL_RIGHT = 62
FD_TEMP_X = FD_ICON_X + 10


def _tight_temp(s):
    return len(s) >= 3 or s[0] == '-'


def _tight_adv(ch):
    return 3 if ch == '1' or ch == '-' else 4


def temp_width(s):
    if not _tight_temp(s):
        return measure('small', s)
    w = -1
    for ch in s:
        w += _tight_adv(ch)
    return w


def draw_temp_text(f, s, x, base, color):
    if not _tight_temp(s):
        return f.text('small', s, x, base, color)
    for ch in s:
        if ch == '-':
            f.fill(x, base - 3, 2, 1, color)
        else:
            f.text('small', ch, x, base, color)
        x += _tight_adv(ch)
    return x


def draw_day_temp(f, s, cx, base, color):
    draw_temp_text(f, s, cx - temp_width(s) // 2, base, color)


def _fd_left(parts):
    w = -1
    for t, c, n in parts:
        w += (temp_width(t) if n else measure('small', t)) + 1
    return FD_HL_RIGHT - w + 1


def draw_top_bar(f, wx):
    if wx.get('icon') in assets.ICONS:
        draw_icon(f, wx['icon'], FD_ICON_X, 0)
    sh = scale_color(temp_color(wx['temp']), 0.2)
    temp_right = f.text('small', '°', f.text('5x7', str(wx['temp']), FD_TEMP_X + 1, 8, sh), 7, sh) - 2
    x = f.text('5x7', str(wx['temp']), FD_TEMP_X, 7, C['label'])
    f.text('small', '°', x, 6, C['label'])
    if wx.get('hi') is not None and wx.get('lo') is not None:
        hi, lo = str(wx['hi']), str(wx['lo'])
        up, down = g(assets.UP), g(assets.DOWN)
        ways = (((up, FD_LETTER, False), (hi, FD_NUM, True), (' ' + down, FD_LETTER, False), (lo, FD_NUM, True)),
                ((up, FD_LETTER, False), (hi, FD_NUM, True), (down, FD_LETTER, False), (lo, FD_NUM, True)),
                ((hi, FD_NUM, True), (' ', FD_NUM, False), (lo, FD_NUM, True)))
        parts = ways[-1]
        for w in ways:
            if _fd_left(w) >= temp_right + 2:
                parts = w
                break
        hx = _fd_left(parts)
        for t, c, n in parts:
            hx = draw_temp_text(f, t, hx, 6, c) if n else f.text('small', t, hx, 6, c)


def draw_five_day(f, wx):
    draw_top_bar(f, wx)
    for i in range(1, 5):
        f.fill(i * FD_PITCH - 1, 10, 1, 22, C['divider'])
    for i, d in enumerate(wx['days'][:5]):
        cx = i * FD_PITCH + 6
        ctext(f, 'small', d['d'], cx, 15, C['grey'])
        if d.get('icon') in assets.ICONS:
            draw_icon(f, d['icon'], cx - 4, 17)
        draw_day_temp(f, str(d['hi']), cx, 31, temp_color(d['hi']))


# ---- hourly layout ----
# Mirrors drawHourly() in draw.js.

def draw_hourly(f, wx):
    draw_top_bar(f, wx)
    for i in range(1, 4):
        f.fill(i * 16 - 1, 10, 1, 22, C['divider'])
    for i, h in enumerate(wx['hours'][:4]):
        cx = i * 16 + 7
        ctext(f, 'small', h['h'], cx, 15, C['grey'])
        if h.get('icon') in assets.ICONS:
            draw_icon(f, h['icon'], cx - 4, 17)
        draw_day_temp(f, str(h['t']), cx, 31, temp_color(h['t']))


# ---- rain bars ----
# The weather screen while precipitation is falling or due in the next 2
# hours (wx.rain). Mirrors drawRainBars() in draw.js.

RAIN_LEVELS = (hexc('#0a2a78'), hexc('#0f48c0'), hexc('#1a6cff'))
SNOW_LEVELS = (hexc('#3357a6'), hexc('#6e83a6'), hexc('#a6a6a6'))
RAIN_TEXT = hexc('#60b0ff')
SNOW_TEXT = hexc('#a9c9ff')
RAIN_DRY = hexc('#081428')
AXIS = hexc('#555555')
FLAKE = ('..#..', '#.#.#', '.###.', '#.#.#', '..#..')


def draw_art(f, art, x, y, color):
    for j, row in enumerate(art):
        for i, c in enumerate(row):
            if c == '#':
                f.fill(x + i, y + j, 1, 1, color)


def draw_rain_bars(f, wx, warn, blink):
    rain = wx['rain']
    draw_top_bar(f, wx)
    color = SNOW_TEXT if rain.get('snow') else RAIN_TEXT
    if warn:
        glyph, wcolor, blinks = warn_style(warn)
        if not (blinks and blink):
            t = WARN_TEXT[warn['kind']][warn['lvl']]
            x = 32 - (measure('small', glyph) + TAG_GAP + measure('small', t)) // 2
            gx = f.text('small', glyph, x, 14, wcolor)
            f.text('small', t, gx + TAG_GAP - 1, 14, wcolor)
    else:
        title = rain['title']
        art = (FLAKE if rain.get('snow') else WX_DROP) if rain.get('now') else None
        mark_w = len(art[0]) + 2 if art and measure('small', title) + len(art[0]) + 2 <= 64 else 0
        x = 32 - (measure('small', title) + mark_w) // 2
        if mark_w:
            draw_art(f, art, x, 10, color if rain.get('snow') else WX_BLUE)
        f.text('small', title, x + mark_w, 14, color)
    levels = SNOW_LEVELS if rain.get('snow') else RAIN_LEVELS
    for i, h in enumerate(rain['h'][:8]):
        if not h:
            f.fill(i * 8, 25, 7, 1, RAIN_DRY)
        else:
            f.fill(i * 8, 26 - h, 7, h, levels[max(1, min(3, rain['l'][i])) - 1])
    ctext(f, 'small', '1H', 31, 31, AXIS)
    rtext(f, 'small', '2H', 62, 31, AXIS)


def radar_value(data, i):
    """Pixel i of a frame: 2048 bytes (one a pixel, as from the server), or
    1024 packed (two a byte, left pixel in the high nibble, as the board
    stores them to halve their memory)."""
    if len(data) == 2048:
        return data[i]
    b = data[i >> 1]
    return b & 15 if i & 1 else b >> 4


def draw_radar_frame(f, data, rb=100):
    """Radar values -> colors. The board overrides this with its own copy."""
    rc = radar_for(rb)
    for y in range(32):
        for x in range(64):
            c = rc.get(radar_value(data, y * 64 + x))
            if c:
                f.fill(x, y, 1, 1, c)


def radar_on_hand(ids, frames):
    n = 0
    if frames:
        for fid in ids:
            if fid in frames:
                n += 1
    return n


def radar_loop_idx(ids, frames, t, tm):
    """The radar loop: with every frame on hand, step through them in time
    order, then hold on the newest; while any is still downloading, hold on
    the newest on hand. t: ms since the loop started. Mirrors radarLoopIdx()
    in draw.js. Returns an index into ids, or -1 with none on hand."""
    n = radar_on_hand(ids, frames)
    if not n:
        return -1
    if n < len(ids):
        for i in range(len(ids) - 1, -1, -1):
            if ids[i] in frames:
                return i
    cycle = max(1, n - 1) * tm['radarFrame'] + tm['radarHold']
    return min(n - 1, (t % cycle) // tm['radarFrame'])


def render_weather(p, f, now=None, idx=None, frames=None, blink=False):
    """The weather screen: the radar loop while there are frames, current
    conditions otherwise. Mirrors renderWeather() in draw.js."""
    r = p.get('radar') or {}
    ids = r.get('frames') or []
    if not ids:
        idx = -1
    elif idx is not None:
        idx = max(0, min(len(ids) - 1, idx))
    else:
        idx = len(ids) - 1
    wx = r.get('wx')
    rn = wx.get('rain') if wx else None
    t = now if now is not None else p.get('now')
    bars_turn = bool(rn and rn.get('h') and rn.get('alt') and (t // rn['alt']) % 2 == 1)
    if ((not ids or (frames is not None and not radar_on_hand(ids, frames))) or bars_turn) and wx:
        # Rain bars when sent (alternating with the radar loop while the
        # payload says so); the 5-day layout has no room for a warning:
        # conditions while one is on.
        if r['wx'].get('rain') and r['wx']['rain'].get('h'):
            draw_rain_bars(f, r['wx'], p.get('warn'), blink)
        elif r['wx'].get('hours') and not p.get('warn'):
            draw_hourly(f, r['wx'])
        elif r['wx'].get('days') and not p.get('warn'):
            draw_five_day(f, r['wx'])
        else:
            draw_weather_screen(f, r['wx'], p.get('warn'), blink, r.get('tempShadow'))
        return f
    data = frames.get(ids[idx]) if idx >= 0 and frames else None
    if data:
        rb = r.get('rb', 100)
        f.draw_radar(data, rb) if hasattr(f, 'draw_radar') else draw_radar_frame(f, data, rb)
    if r.get('split') and r.get('timeBox'):
        f.fill(r['timeBox'][0] - 1, 0, 1, 32, C['divider'])
    bx, by, bw, bh = r.get('timeBox') or (40, 0, 24, 32)
    right = min(63, bx + bw - 1)
    top = by + 2
    # The clock: the frame's time (dim), or the current time (white) with
    # clock 'now' or before any frame.
    now_clock = r.get('clock') == 'now'
    ft = r.get('ft')
    if not now_clock and idx >= 0 and ft and ft[idx] is not None:
        t = ft[idx]
    else:
        t = now if now is not None else p['now']
    tzo = p.get('tzo', 0)
    black = hexc('#000000')

    def clear(b):
        if b[1] is not None and b[1] <= b[3]:
            f.fill(b[0] - 1, b[1] - 1, b[2] - b[0] + 3, b[3] - b[1] + 3, black)

    seg_w = 2
    seg_gap = 1
    ind_x = right - (len(ids) * (seg_w + seg_gap) - seg_gap) + 1
    if ids:
        clear((ind_x, top, right, top + 1))

    def draw_indicator():
        x = ind_x
        for i in range(len(ids)):
            f.fill(x, top, seg_w, 2, C['amber'] if i == idx else C['indicator'])
            x += seg_w + seg_gap

    ws = warn_style(p['warn']) if p.get('warn') else None
    hide_warn = bool(ws and ws[2] and blink)

    def draw_warn_tag():
        word = 'WARN' if p['warn']['lvl'] == 'warning' else 'WATCH'
        x0 = 64 - (measure('small', ws[0]) + TAG_GAP + measure('small', word))
        f.fill(x0 - 1, 25, 64 - x0 + 1, 7, black)
        if not hide_warn:
            x = f.text('small', ws[0], x0, 31, ws[1])
            f.text('small', word, x + TAG_GAP - 1, 31, ws[1])

    if r.get('showTime') is False and r.get('temp') is not None:
        ts = str(r['temp']) + '°'
        icon = r.get('icon') if r.get('icon') in assets.ICONS else None
        x0 = right + 1 - ((10 if icon else 0) + measure('small', ts))
        if icon:
            clear((x0, top + 4, x0 + 7, top + 11))
        clear(text_box('small', ts, x0 + (10 if icon else 0), top + 10))
        draw_indicator()
        if icon:
            draw_icon(f, icon, x0, top + 4)
        f.text('small', ts, x0 + (10 if icon else 0), top + 10, C['label'])
        if ws:
            draw_warn_tag()
        return f
    if r.get('cond'):
        # Time with conditions: time and A/P on one line, the temperature
        # under it, the warning tag at the bottom right (as with time off).
        clock = clock_text(t, tzo)
        ap = ampm_text(t, tzo)[0]
        ap_x = right - measure('small', ap) + 1
        clock_right = ap_x - 2
        ct = str(r['temp']) + '°' if r.get('temp') is not None else None
        clear(text_box('5x7', clock, clock_right - measure('5x7', clock) + 1, top + 11))
        clear(text_box('small', ap, ap_x, top + 11))
        if ct:
            clear(text_box('small', ct, right - measure('small', ct) + 1, top + 18))
        draw_indicator()
        rtext(f, '5x7', clock, clock_right, top + 11, C['clock'] if now_clock else C['radarTime'])
        f.text('small', ap, ap_x, top + 11, C['radarSub'])
        if ct:
            rtext(f, 'small', ct, right, top + 18, C['radarSub'])
        if ws:
            draw_warn_tag()
        return f
    clock = clock_text(t, tzo)
    ap = ampm_text(t, tzo)
    ap_x = right - measure('small', ap) + 1
    w_x = ap_x - 2 - measure('small', ws[0]) if ws else 0
    clear(text_box('5x7', clock, right - measure('5x7', clock) + 1, top + 11))
    clear(text_box('small', ap, ap_x, top + 18))
    if ws:
        clear(text_box('small', ws[0], w_x, top + 18))
    draw_indicator()
    # A frame's time is dimmed so it doesn't read as the current time.
    rtext(f, '5x7', clock, right, top + 11, C['clock'] if now_clock else C['radarTime'])
    f.text('small', ap, ap_x, top + 18, C['radarAmpm'])
    if ws and not hide_warn:
        f.text('small', ws[0], w_x, top + 18, ws[1])
    return f


# ---- baseball (design spec §8) ----
# Two layouts (p['mlb']['layout']): 'classic' (default) and 'logos'. Classic:
# team rows on the left (color block + 5x7 abbreviation + score), status
# panel centered on x51, divider on row 24, bottom line right-aligned.

BB = {'live': hexc('#f0f0f0'), 'lose': hexc('#6a6a6a'), 'base': hexc('#454545'), 'infield': hexc('#3a3a3a')}
BB_ROW_TOPS = (2, 12)   # away, home
SCORE_RIGHT = 30
PANEL_X = 51
BB_BOTTOM = 31
BB_DIVIDER = 24
SCORE_ROLL = 8
SCORE_HOLD_S = 30
SCORE_FADE_S = 5
HALF = {'T': 'TOP', 'B': 'BOT', 'M': 'MID', 'E': 'END'}


def ctext(f, font, s, cx, base, rgb):
    return f.text(font, s, cx - measure(font, s) // 2, base, rgb)


def bb_record(t):
    if t.get('w') is None or t.get('l') is None:
        return ''
    return '%d-%d' % (t['w'], t['l'])


def pick_game(games, now, every=60, all_games=False):
    """Live games take precedence (unless all_games); `every` seconds each by wall time."""
    if not games:
        return {'i': -1, 'pos': 0, 'of': 0}
    live = [] if all_games else [i for i, gm in enumerate(games) if gm.get('st') == 'live']
    pool = live if live else list(range(len(games)))
    pos = int(now // every) % len(pool)
    return {'i': pool[pos], 'pos': pos, 'of': len(pool)}


def score_color(side, now, rest=None):
    if rest is None:
        rest = BB['live']
    if side.get('at') is None:
        return rest
    age = now - side['at']
    if age < 0 or age < SCORE_HOLD_S:
        return C['amber']
    if age >= SCORE_HOLD_S + SCORE_FADE_S:
        return rest
    return _lerp_color(C['amber'], rest, (age - SCORE_HOLD_S) / SCORE_FADE_S)


def draw_score(f, text, top, color, roll):
    base = top + 6
    if not roll or roll['from'] == text or roll['p'] >= 1:
        rtext(f, '5x7', text, SCORE_RIGHT, base, color)
        return
    up = jsround(ease_in_out(roll['p']) * SCORE_ROLL)
    f.push_clip(SCORE_RIGHT - 12, top, SCORE_RIGHT, top + 6)
    try:
        frm = roll['from']
        if len(frm) == len(text):
            x = SCORE_RIGHT - measure('5x7', text) + 1
            for i in range(len(text)):
                if frm[i] == text[i]:
                    f.text('5x7', text[i], x, base, color)
                else:
                    f.text('5x7', frm[i], x, base - up, color)
                    f.text('5x7', text[i], x, base - up + SCORE_ROLL, color)
                x += measure('5x7', text[i]) + 1
        else:
            rtext(f, '5x7', frm, SCORE_RIGHT, base - up, color)
            rtext(f, '5x7', text, SCORE_RIGHT, base - up + SCORE_ROLL, color)
    finally:
        f.pop_clip()


def draw_diamond(f, cx, cy, r, color, filled):
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            d = abs(dx) + abs(dy)
            if d == r or (filled and d < r):
                f.fill(cx + dx, cy + dy, 1, 1, color)


def draw_infield(f, on, cy=7):
    draw_diamond(f, PANEL_X, cy, 5, BB['infield'], False)
    draw_diamond(f, PANEL_X, cy - 5, 2, C['amber'] if on[1] else BB['base'], True)
    draw_diamond(f, PANEL_X - 5, cy, 2, C['amber'] if on[2] else BB['base'], True)
    draw_diamond(f, PANEL_X + 5, cy, 2, C['amber'] if on[0] else BB['base'], True)


def draw_roll_text(f, text, left, base, color, roll, from_left=None):
    if not roll or roll['from'] == text or roll['p'] >= 1:
        f.text('small', text, left, base, color)
        return
    frm = roll['from']
    up = jsround(ease_in_out(roll['p']) * ROLL_DIST)
    old_left = from_left if from_left is not None else left + measure('small', text) - measure('small', frm)
    same_shape = old_left == left and len(frm) == len(text)
    if same_shape:
        for i in range(len(text)):
            if measure('small', text[i]) != measure('small', frm[i]):
                same_shape = False
                break
    f.push_clip(0, base - 5, 63, base - 1)
    try:
        if same_shape:
            x = left
            for i in range(len(text)):
                if frm[i] == text[i]:
                    f.text('small', text[i], x, base, color)
                else:
                    f.text('small', frm[i], x, base - up, color)
                    f.text('small', text[i], x, base - up + ROLL_DIST, color)
                x += measure('small', text[i]) + 1
        else:
            f.text('small', frm, old_left, base - up, color)
            f.text('small', text, left, base - up + ROLL_DIST, color)
    finally:
        f.pop_clip()


def _bottom_layout(count, outs):
    outs_left = 63 - measure('small', outs) + 1
    return outs_left - 5 - measure('small', count), outs_left


def draw_bottom_line(f, t, rolls):
    """Count and outs, right-aligned; outgoing texts keep the old layout.
    Mirrors drawBottomLine() in draw.js."""
    def was(k):
        r = rolls.get(k)
        return r['from'] if r and r['p'] < 1 else t[k]
    count_left, outs_left = _bottom_layout(t['count'], t['outs'])
    old_count_left, old_outs_left = _bottom_layout(was('count'), was('outs'))
    draw_roll_text(f, t['outs'], outs_left, BB_BOTTOM, C['grey'], rolls.get('outs'), old_outs_left)
    draw_roll_text(f, t['count'], count_left, BB_BOTTOM, C['label'], rolls.get('count'), old_count_left)


def live_texts(gm):
    brk = gm.get('half') in ('M', 'E')
    return {
        'inn': '%s %s' % (HALF.get(gm.get('half')) or 'TOP', gm.get('inn')),
        'count': '' if brk else '%d-%d' % (gm.get('b') or 0, gm.get('s') or 0),
        'outs': '' if brk else '%d OUT' % (gm.get('o') or 0),
    }


def draw_no_games(f, now, tzo):
    clock = clock_text(now, tzo)
    label = 'NO GAMES'
    top = (32 - 18) // 2
    f.text('clock', clock, (64 - measure('clock', clock)) // 2, top + 10, C['clock'])
    f.text('small', label, (64 - measure('small', label)) // 2, top + 18, C['noTrains'])


BLACK = (0, 0, 0)


def emboss_text(f, font, s, x, base, color, shadow=BLACK):
    for dx, dy in ((1, 0), (0, 1), (1, 1)):
        f.text(font, s, x + dx, base + dy, shadow)
    return f.text(font, s, x, base, color)


# ---- baseball, logo layout ----

LG_W = 24
LG_ROWS = 12
LG_TOPS = (0, 12)
LG_BAND_R = 37
LG_CX = 30
LG_INFIELD_Y = 8
LG_INN_BASE = 21
LG_DIM = 0.9
LG_ROLL = 8
LG_LIGHT = 140


def lg_ink(side, dim):
    """White text, or black (unlit) on a light band."""
    base = hexc(side['bd']) if side.get('bd') else (hexc(side['c']) if side.get('c') else C['grey'])
    r, g, b = scale_color(base, dim)
    return BLACK if (299 * r + 587 * g + 114 * b) / 1000 > LG_LIGHT else BB['live']


def draw_logo_band(f, side, top, logos, bands, dim):
    base = hexc(side['bd']) if side.get('bd') else (hexc(side['c']) if side.get('c') else C['grey'])
    f.fill(0, top, LG_BAND_R + 1, LG_ROWS, scale_color(base, dim))
    if bands:
        ab = side.get('ab') or ''
        f.text('5x7', ab, (LG_W >> 1) - measure('5x7', ab) // 2, top + 9, lg_ink(side, dim))
        return
    data = logos.get(side['lg']) if side.get('lg') and logos else None
    if data and len(data) >= LG_W * LG_ROWS * 3 and hasattr(f, 'draw_logo'):
        f.draw_logo(side['lg'], data, 0, top, dim)  # the board: one indexed blit, same pixels
    elif data and len(data) >= LG_W * LG_ROWS * 3:
        for y in range(LG_ROWS):
            for x in range(LG_W):
                i = (y * LG_W + x) * 3
                f.set(x, top + y, (jsround(data[i] * dim), jsround(data[i + 1] * dim), jsround(data[i + 2] * dim)))
    else:
        ctext(f, '5x7', side.get('ab') or '', LG_W >> 1, top + 9, lg_ink(side, dim))


def _lg_left(t):
    return LG_CX - measure('5x7', t) // 2


def draw_logo_score(f, text, top, color, roll):
    base = top + 9
    if not roll or roll['from'] == text or roll['p'] >= 1:
        f.text('5x7', text, _lg_left(text), base, color)
        return
    up = jsround(ease_in_out(roll['p']) * LG_ROLL)
    f.push_clip(LG_W, base - 6, LG_BAND_R + 1, base)
    try:
        frm = roll['from']
        if len(frm) == len(text):
            x = _lg_left(text)
            for i in range(len(text)):
                if frm[i] == text[i]:
                    f.text('5x7', text[i], x, base, color)
                else:
                    f.text('5x7', frm[i], x, base - up, color)
                    f.text('5x7', text[i], x, base - up + LG_ROLL, color)
                x += measure('5x7', text[i]) + 1
        else:
            f.text('5x7', frm, _lg_left(frm), base - up, color)
            f.text('5x7', text, _lg_left(text), base - up + LG_ROLL, color)
    finally:
        f.pop_clip()


def render_baseball_logos(f, p, gm, now, tzo, rolls, logos):
    bands = (p.get('mlb') or {}).get('layout') == 'bands'
    dim = (p.get('mlb') or {}).get('dim')
    if dim is None:
        dim = LG_DIM
    final = gm['st'] == 'final'
    winner = None
    if final:
        if gm['away']['r'] > gm['home']['r']:
            winner = 'away'
        elif gm['home']['r'] > gm['away']['r']:
            winner = 'home'
    sides = (('away', LG_TOPS[0]), ('home', LG_TOPS[1]))
    for k, top in sides:
        draw_logo_band(f, gm[k], top, logos, bands, dim)
    f.fill(0, BB_DIVIDER, 64, 1, C['divider'])

    if gm['st'] == 'pre':
        for k, top in sides:
            if not bands:
                draw_logo_score(f, gm[k].get('ab') or '', top, lg_ink(gm[k], dim), None)
            ctext(f, 'small', bb_record(gm[k]), PANEL_X, top + 8, C['grey'])
        f.text('small', 'TODAY', 0, BB_BOTTOM, C['grey'])
        ap = ampm_text(gm['start'], tzo)
        rtext(f, 'small', ap, 63, BB_BOTTOM, C['grey'])
        rtext(f, 'small', clock_text(gm['start'], tzo), 63 - measure('small', ap) - 3, BB_BOTTOM, C['label'])
        return f

    if final:
        for k, top in sides:
            draw_logo_score(f, str(gm[k]['r']), top, C['amber'] if winner == k else lg_ink(gm[k], dim), rolls.get(k))
            ctext(f, 'small', bb_record(gm[k]), PANEL_X, top + 8, C['grey'])
        rtext(f, 'small', 'FINAL', 63, BB_BOTTOM, C['label'])
        return f

    draw_logo_score(f, str(gm['away']['r']), LG_TOPS[0], score_color(gm['away'], now, lg_ink(gm['away'], dim)), rolls.get('away'))
    draw_logo_score(f, str(gm['home']['r']), LG_TOPS[1], score_color(gm['home'], now, lg_ink(gm['home'], dim)), rolls.get('home'))
    draw_infield(f, gm.get('on') or [0, 0, 0], LG_INFIELD_Y)
    t = live_texts(gm)
    draw_roll_text(f, t['inn'], PANEL_X - measure('small', t['inn']) // 2, LG_INN_BASE, C['label'], rolls.get('inn'))
    draw_bottom_line(f, t, rolls)
    return f


def render_baseball(p, f, now=None, game=None, rolls=None, logos=None):
    if now is None:
        now = p['now']
    tzo = p.get('tzo', 0)
    games = (p.get('mlb') or {}).get('games') or []
    if not games:
        draw_no_games(f, now, tzo)
        return f
    gm = games[game % len(games) if game is not None else pick_game(games, now, timing(p)['game'], (p.get('mlb') or {}).get('all') is True)['i']]
    rolls = rolls or {}
    if (p.get('mlb') or {}).get('layout') in ('logos', 'bands'):
        return render_baseball_logos(f, p, gm, now, tzo, rolls, logos or {})
    final = gm['st'] == 'final'
    winner = None
    if final:
        if gm['away']['r'] > gm['home']['r']:
            winner = 'away'
        elif gm['home']['r'] > gm['away']['r']:
            winner = 'home'

    name_end = 0
    for k, top in (('away', BB_ROW_TOPS[0]), ('home', BB_ROW_TOPS[1])):
        side = gm[k]
        f.fill(0, top, 3, 6, hexc(side['c']) if side.get('c') else C['grey'])
        name_end = max(name_end, f.text('5x7', side['ab'], 5, top + 6, C['amber'] if winner == k else C['label']))
    f.fill(0, BB_DIVIDER, 64, 1, C['divider'])

    if gm['st'] == 'pre':
        f.text('small', bb_record(gm['away']), name_end + 2, BB_ROW_TOPS[0] + 6, C['grey'])
        f.text('small', bb_record(gm['home']), name_end + 2, BB_ROW_TOPS[1] + 6, C['grey'])
        f.text('small', 'TODAY', 0, BB_BOTTOM, C['grey'])
        ap = ampm_text(gm['start'], tzo)
        rtext(f, 'small', ap, 63, BB_BOTTOM, C['grey'])
        rtext(f, 'small', clock_text(gm['start'], tzo), 63 - measure('small', ap) - 3, BB_BOTTOM, C['label'])
        return f

    if final:
        for k, top in (('away', BB_ROW_TOPS[0]), ('home', BB_ROW_TOPS[1])):
            if winner == k:
                color = C['amber']
            elif winner:
                color = BB['lose']
            else:
                color = C['label']
            draw_score(f, str(gm[k]['r']), top, color, rolls.get(k))
            ctext(f, 'small', bb_record(gm[k]), PANEL_X, top + 6, C['grey'])
        rtext(f, 'small', 'FINAL', 63, BB_BOTTOM, C['label'])
        return f

    draw_score(f, str(gm['away']['r']), BB_ROW_TOPS[0], score_color(gm['away'], now), rolls.get('away'))
    draw_score(f, str(gm['home']['r']), BB_ROW_TOPS[1], score_color(gm['home'], now), rolls.get('home'))
    draw_infield(f, gm.get('on') or [0, 0, 0])
    t = live_texts(gm)
    draw_roll_text(f, t['inn'], PANEL_X - measure('small', t['inn']) // 2, 20, C['label'], rolls.get('inn'))
    draw_bottom_line(f, t, rolls)
    return f


def baseball_texts(p, now):
    """Texts that roll when they change, keyed by game and state."""
    games = (p.get('mlb') or {}).get('games') or []
    if not games:
        return None
    gm = games[pick_game(games, now, timing(p)['game'], (p.get('mlb') or {}).get('all') is True)['i']]
    texts = {'away': str(gm['away']['r']), 'home': str(gm['home']['r'])}
    if gm['st'] == 'live':
        texts.update(live_texts(gm))
    return {'key': '%s:%s' % (gm['id'], gm['st']), 'texts': texts}


# ---- whole screen ----

def apply_brightness(f, bright):
    k = max(0, min(100, 100 if bright is None else bright)) / 100
    if hasattr(f, 'set_brightness'):
        f.set_brightness(k)  # the board scales its palette instead of pixels
        return f
    if k == 1:
        return f
    px = f.px
    for i in range(len(px)):
        px[i] = jsround(px[i] * k)
    return f


def render(p, f, screen=None, now=None, blink=False, view=None, page=0, slide=0, idx=None, frames=None, game=None, rolls=None, logos=None):
    screen = screen or p.get('screen')
    if screen == 'ticker':
        render_ticker(p, f, now=now, page=page, slide=slide)
    elif screen == 'weather':
        render_weather(p, f, now=now, idx=idx, frames=frames, blink=blink)
    elif screen == 'baseball':
        render_baseball(p, f, now=now, game=game, rolls=rolls, logos=logos)
    else:
        render_transit(p, f, now=now, blink=blink, view=view)
    return apply_brightness(f, p.get('bright'))
