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
        font = assets.FONTS[font_name]
        for ch in s:
            g = font.get(ord(ch))
            if not g:
                continue
            dw, w, h, xo, yo = g[0], g[1], g[2], g[3], g[4]
            top = baseline - (yo + h)
            for r in range(h):
                bits = g[5 + r]
                for c in range(w):
                    if (bits >> (w - 1 - c)) & 1:
                        self.set(x + xo + c, top + r, rgb)
            x += dw
        return x


def measure(font_name, s):
    font = assets.FONTS[font_name]
    w = 0
    for ch in s:
        g = font.get(ord(ch))
        if g:
            w += g[0]
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


def row_tops(n, has_header, has_weather):
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


def live_rows(p, now):
    out = []
    for r in p.get('rows') or []:
        t = []
        s = []
        rs = r.get('s')
        for i, x in enumerate(r['t']):
            if x >= now - DROP_GRACE:
                t.append(x)
                s.append(rs[i] if rs else 0)
        if t:
            row = dict(r)
            row['t'] = t
            row['s'] = s
            out.append(row)
    return out


def live_ticker(p, now):
    return [x for x in (p.get('ticker') or []) if x['t'] >= now - DROP_GRACE]


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
DIGIT = dict(LINE)
DIGIT['BR'] = hexc('#a8673f')
DIGIT['PR'] = hexc('#9168e0')

C = {
    'label': hexc('#d8d8d8'), 'clock': hexc('#cccccc'), 'radarTime': hexc('#7a7a7a'), 'radarAmpm': hexc('#555555'), 'wxText': hexc('#555555'), 'amber': hexc('#ffb000'), 'dimAmber': hexc('#9c6a00'),
    'sch': hexc('#b0b0b0'), 'schDim': hexc('#6e6e6e'), 'grey': hexc('#8f8f8f'), 'band': hexc('#202020'),
    'divider': hexc('#333333'), 'tickerHead': hexc('#a6a6a6'), 'index': hexc('#1f2f35'), 'white': hexc('#ffffff'),
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
SLIDE_MS = 1200
PAGE_HOLD_MS = 8000
BLINK_MS = 1000
RADAR_FRAME_MS = 500
RADAR_HOLD_MS = 4000

RADAR_FILL = 0.65
RADAR = {
    1: scale_color(hexc('#1f8f1f'), RADAR_FILL), 2: scale_color(hexc('#2ee02e'), RADAR_FILL),
    3: scale_color(hexc('#ffe000'), RADAR_FILL), 4: scale_color(hexc('#ff8c00'), RADAR_FILL),
    5: scale_color(hexc('#ff1a1a'), RADAR_FILL), 6: hexc('#34485e'), 7: hexc('#ffffff'),
    8: scale_color(hexc('#4f86ff'), RADAR_FILL), 9: scale_color(hexc('#a9c9ff'), RADAR_FILL),
    10: scale_color(hexc('#ffffff'), RADAR_FILL),
}


def g(cp):
    return chr(cp)


def rtext(f, font, s, right, base, rgb):
    return f.text(font, s, right - measure(font, s) + 1, base, rgb)


# ---- time (Chicago, via the payload's UTC offset) ----

def clock_text(t, tzo):
    lt = int(math.floor(t + tzo))
    h = (lt // 3600) % 24
    m = (lt // 60) % 60
    h12 = h % 12 or 12
    return '%d:%02d' % (h12, m)


def ampm_text(t, tzo):
    lt = int(math.floor(t + tzo))
    return 'PM' if (lt // 3600) % 24 >= 12 else 'AM'


# ---- pieces ----

def draw_icon(f, name, x, y):
    for j, row in enumerate(assets.ICONS[name]):
        for i, c in enumerate(row):
            if c != '.':
                f.fill(x + i, y + j, 1, 1, assets.ICON_PALETTE[c])


def draw_header(f, name, now, tzo, band, name_color):
    if band:
        f.fill(0, 0, 64, 7, band)
    f.text('small', name, 1, 6, name_color)
    rtext(f, 'small', clock_text(now, tzo), 62, 6, C['clock'])


def draw_weather(f, wx, warn):
    f.fill(0, 22, 64, 1, C['divider'])
    draw_icon(f, wx['icon'], 0, 24)
    base = 31
    f.text('small', str(wx['temp']) + '°', 10, base, C['wxText'])
    if warn:
        glyph = g(assets.FUNNEL if warn['kind'] == 'tor' else assets.BOLT)
        word = 'WARNING' if warn['lvl'] == 'warning' else 'WATCH'
        if warn['lvl'] == 'watch':
            color = C['watch']
        else:
            color = C['warnTornado'] if warn['kind'] == 'tor' else C['warnSevere']
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
    tops = row_tops(len(rows), bool(p.get('header')), bool(p.get('wx')))
    return {
        'now': now, 'mode': 'dest', 'header': p.get('header'), 'wx': p.get('wx'), 'warn': p.get('warn'),
        'tzo': p.get('tzo', 0),
        'rows': [{'key': r['ln'] + ':' + r['lbl'], 'ln': r['ln'], 'lbl': r['lbl'], 'a': r.get('a'),
                  'num': None, 'numRoll': None, 'top': tops[i], 'alpha': 1, 'cells': layout_cells(r, now)}
                 for i, r in enumerate(rows)],
    }


def build_chrono_view(p, now):
    rows = live_rows(p, now)[:max_rows(bool(p.get('header')), bool(p.get('wx')))]
    tops = row_tops(len(rows), bool(p.get('header')), bool(p.get('wx')))
    out = []
    seen_dest = set()
    for i, r in enumerate(rows):
        dest = '%s:%s' % (r['ln'], r['lbl'])
        due = dest not in seen_dest
        seen_dest.add(dest)
        key = ('rn:' + str(r['rn'])) if r.get('rn') is not None else '%s:%s:%s' % (r['ln'], r['lbl'], r['t'][0])
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
        'header': p.get('header'), 'wx': p.get('wx'), 'warn': p.get('warn'), 'tzo': p.get('tzo', 0), 'rows': out,
    }


def draw_view_row(f, row, blink):
    top = jsround(row['top'])
    line = fade(DIGIT[row['ln']] if row.get('num') is not None else LINE[row['ln']], row['alpha'])
    if row.get('a') and blink:
        for j, r in enumerate(assets.ALERT_BANG):
            for i, c in enumerate(r):
                if c == '#':
                    f.fill(i, top + j, 1, 1, line)
    elif row.get('num') is not None:
        draw_time_cell(f, str(row['num']), 2, top, line, row.get('numRoll'))
    else:
        f.fill(0, top, 3, 5, line)
    f.text('small', row['lbl'], 5, top + 5, fade(C['label'], row['alpha']))
    for cell in row['cells']:
        a = cell['alpha'] * row['alpha']
        if a <= 0:
            continue
        draw_time_cell(f, cell['text'], jsround(cell['right']), top, fade(cell['color'], a), cell.get('roll'))


def draw_overnight(f, view, now):
    clock = clock_text(now, view.get('tzo', 0))
    nt = 'NO TRAINS'
    block_h = 10 + 3 + 5
    area_h = 22 if view.get('wx') else 32
    top = (area_h - block_h) // 2
    f.text('clock', clock, (64 - measure('clock', clock)) // 2, top + 10, C['clock'])
    f.text('small', nt, (64 - measure('small', nt)) // 2, top + 18, C['noTrains'])


def draw_transit_view(f, view, blink):
    if not view['rows']:
        draw_overnight(f, view, view['now'])
    else:
        if view.get('header'):
            draw_header(f, view['header'], view['now'], view.get('tzo', 0), C['band'], C['grey'])
        f.push_clip(0, 7 if view.get('header') else 0, 63, 21 if view.get('wx') else 31)
        try:
            for row in view['rows']:
                draw_view_row(f, row, blink)
        finally:
            f.pop_clip()
    if view.get('wx'):
        draw_weather(f, view['wx'], view.get('warn'))


def render_transit(p, f, now=None, blink=False, view=None):
    if now is None:
        now = p['now']
    if view is None:
        view = build_transit_view(p, now)
    draw_transit_view(f, view, blink)
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


class TransitAnimator:
    """Keeps arrivals' identity across frames and updates so the board can
    animate what changed (rolls, fades, color easing, row slides). step()
    returns the view to draw at animation time t (ms)."""

    def __init__(self):
        self.next_id = 1
        self.rows = {}  # key -> row state (insertion-ordered, like a JS Map)

    def _match_cells(self, state, cells, t, is_new_row):
        unmatched = [c for c in state['cells'] if not c.get('leaving')]
        used = []
        out = []
        moved = []
        joined = []
        for c in cells:
            m = None
            for u in unmatched:
                if not _contains(used, u) and abs(u['t'] - c['t']) <= MATCH_S:
                    m = u
                    break
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
                'warn': target.get('warn'), 'tzo': target.get('tzo', 0), 'rows': []}
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

def draw_ticker_item(f, it, idx, top, now, due=True):
    base = top + 9
    f.fill(0, top, 5, 12, C['index'])
    f.fill(5, top, 59, 12, scale_color(LINE[it['ln']], 0.55))
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
        draw_header(f, th, now, p.get('tzo', 0), None, C['tickerHead'])
    items = live_ticker(p, now)
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
            draw_ticker_item(f, it, n + 1, 7 + i * 13 + shift, now, first_of['%s:%s' % (it['ln'], it['d'])] == n)

    f.push_clip(0, 7, 63, 31)
    try:
        draw_page(page, -offset)
        if offset > 0 and pages > 1:
            draw_page((page + 1) % pages, 26 - offset)
    finally:
        f.pop_clip()
    return f


# ---- radar ----

def draw_conditions(f, wx):
    draw_icon(f, wx['icon'], 1, 2)
    x = f.text('5x7', str(wx['temp']), 12, 10, C['label'])
    f.text('small', '°', x, 8, C['label'])
    f.text('small', wx['word'], 1, 20, C['label'])
    if wx.get('hi') is not None and wx.get('lo') is not None:
        hl = 'H %s  L %s' % (wx['hi'], wx['lo'])
        if 1 + measure('small', hl) - 1 > 37:
            hl = 'H %s L %s' % (wx['hi'], wx['lo'])
        f.text('small', hl, 1, 28, C['grey'])


def draw_radar_frame(f, data):
    """Radar values -> colors. The board overrides this with a C-speed copy."""
    for y in range(32):
        for x in range(64):
            c = RADAR.get(data[y * 64 + x])
            if c:
                f.fill(x, y, 1, 1, c)


def render_radar(p, f, now=None, idx=None, frames=None):
    r = p.get('radar') or {}
    ids = r.get('frames') or []
    if not ids:
        idx = -1
    elif idx is not None:
        idx = max(0, min(len(ids) - 1, idx))
    else:
        idx = len(ids) - 1
    data = frames.get(ids[idx]) if idx >= 0 and frames else None
    if data:
        f.draw_radar(data) if hasattr(f, 'draw_radar') else draw_radar_frame(f, data)
    if not ids and r.get('wx'):
        draw_conditions(f, r['wx'])
    if r.get('split') and r.get('timeBox'):
        f.fill(r['timeBox'][0] - 1, 0, 1, 32, C['divider'])
    bx, by, bw, bh = r.get('timeBox') or (40, 0, 24, 32)
    right = min(62, bx + bw - 1)
    top = by + 2
    ft = r.get('ft')
    if idx >= 0 and ft and ft[idx] is not None:
        t = ft[idx]
    else:
        t = now if now is not None else p['now']
    tzo = p.get('tzo', 0)
    if ids:
        seg_w = 2
        seg_gap = 1
        x = right - (len(ids) * (seg_w + seg_gap) - seg_gap) + 1
        for i in range(len(ids)):
            f.fill(x, top, seg_w, 2, C['amber'] if i == idx else C['indicator'])
            x += seg_w + seg_gap
    warn_glyph = None
    warn_color = C['warnSevere']
    if p.get('warn'):
        warn_glyph = g(assets.FUNNEL if p['warn']['kind'] == 'tor' else assets.BOLT)
        if p['warn']['kind'] == 'tor':
            warn_color = C['warnTornado']
    if r.get('showTime') is False:
        if warn_glyph is not None:
            f.text('small', warn_glyph, right - measure('small', warn_glyph) + 1, top + 8, warn_color)
        return f
    rtext(f, '5x7', clock_text(t, tzo), right, top + 11, C['radarTime'])
    ap = ampm_text(t, tzo)
    ap_x = right - measure('small', ap) + 1
    f.text('small', ap, ap_x, top + 18, C['radarAmpm'])
    if warn_glyph is not None:
        f.text('small', warn_glyph, ap_x - 2 - measure('small', warn_glyph), top + 18, warn_color)
    return f


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


def render(p, f, screen=None, now=None, blink=False, view=None, page=0, slide=0, idx=None, frames=None):
    screen = screen or p.get('screen')
    if screen == 'ticker':
        render_ticker(p, f, now=now, page=page, slide=slide)
    elif screen == 'radar':
        render_radar(p, f, now=now, idx=idx, frames=frames)
    else:
        render_transit(p, f, now=now, blink=blink, view=view)
    return apply_brightness(f, p.get('bright'))
