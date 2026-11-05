#!/usr/bin/env python3
"""Pull clock digits (0-9 and the colon) out of real bitmap fonts into
bitmap-digits.json for the clock mockups. Glyphs are the fonts' own drawings
at their native sizes (never scaled: they were drawn pixel by pixel),
cropped to their ink; the mockups space them (time_width).

  python3 scripts/mock-clock/build-bitmap-digits.py <folder of .pcf.gz/.bdf files>

Sources: Ubuntu's xfonts-75dpi, xfonts-100dpi and xfonts-base (the X11
bitmap fonts: Adobe, B&H, Bitstream, Misc), xfonts-terminus, Spleen
(github.com/fcambus/spleen), u8g2's BDF collection
(github.com/olikraus/u8g2, tools/font/bdf), and the board's own fonts.
PCF files are read with pcf2bdf. Each family picks, per role, the size
that fits it (see ROLES); only those sizes are kept.

Round 7 families may also be scaled by whole pixels (each source pixel an
s x s block, or with `dots` an (s-1) x (s-1) dot, like a dot-matrix sign):
the drawings stay exact, just bigger.
"""
import glob
import gzip
import json
import os
import subprocess
import sys

DIGITS = '0123456789:'

# key, label, note, XLFD match (foundry, family, weight) or a file-name match
FAMILIES = [
    ('helvetica', 'Helvetica Bold', 'Adobe\'s hand-tuned X11 bitmaps of Helvetica.', ('Adobe', 'Helvetica', 'Bold')),
    ('lucida', 'Lucida Sans Bold', 'Bigelow & Holmes drew Lucida for screens; the X11 cuts are some of the best bitmap sans ever made.', ('B&H', 'Lucida', 'Bold')),
    ('lucidabright', 'Lucida Bright Demibold', 'Lucida\'s serif, with bracketed serifs that survive at pixel sizes.', ('B&H', 'LucidaBright', 'DemiBold')),
    ('lucidatype', 'Lucida Typewriter Bold', 'The monospaced Lucida: tabular by design, a terminal look.', ('B&H', 'LucidaTypewriter', 'Bold')),
    ('schoolbook', 'New Century Schoolbook Bold', 'Adobe\'s bitmap of the textbook serif; round, open digits.', ('Adobe', 'New Century Schoolbook', 'Bold')),
    ('charter', 'Charter Bold', 'Matthew Carter\'s Charter, drawn for low-resolution output.', ('Bitstream', 'Charter', 'Bold')),
    ('terminus', 'Terminus Bold', 'A modern pixel font for terminals, sizes up to 32 px.', ('xos4', 'Terminus', 'Bold')),
    ('spleen', 'Spleen', 'A modern monospaced pixel font with sizes up to 64 px.', 'spleen-'),
    # Round 7: options: round, files (exact basenames), scales, dots.
    ('t0', 't0 Bold', 'A terminal bitmap font in u8g2\'s collection, drawn up to 40 px: the largest real bitmap digits here.',
     None, {'round': 7, 'files': ['t0-22b-uni.bdf', 't0-30b-uni.bdf', 't0-40b-uni.bdf', 't0-18b-uni.bdf']}),
    ('profont', 'ProFont', 'The classic Mac programming font, bitmap up to 29 px; squared-off, open digits.',
     None, {'round': 7, 'files': ['profont22.bdf', 'profont29.bdf', 'profont17.bdf']}),
    ('crox', 'Crox Helvetica Bold', 'Windows 3.x-era bitmap Helvetica (the Crox set in u8g2); chunkier than Adobe\'s X11 cut.',
     None, {'round': 7, 'files': ['win_crox4hb.bdf', 'win_crox5hb.bdf', 'win_crox3hb.bdf']}),
    ('callite', 'CalLite / CalBlk', 'Two calculator-display bitmap fonts from u8g2, light at 18 px and black at 26.',
     None, {'round': 7, 'files': ['CalLite24.bdf', 'CalBlk36.bdf']}),
    ('freedoom', 'Freedoom HUD', 'The status-bar numerals from Freedoom (the free Doom): 24 px, game-HUD style.',
     None, {'round': 7, 'files': ['freedoomr25n.bdf']}),
    ('amstrad', 'Amstrad CPC x3', 'The Amstrad CPC\'s 8 x 8 system font, each pixel drawn 3 x 3: big, blocky 8-bit digits.',
     None, {'round': 7, 'files': ['amstrad_cpc_extended.bdf'], 'scales': [2, 3]}),
    ('victoria', 'Victoria Bold x4', 'An 8 px pixel font scaled by 4 to the full 28 rows.',
     None, {'round': 7, 'files': ['VictoriaBold-8.bdf'], 'scales': [2, 3, 4]}),
    ('board5x7', 'Board 5x7 x4', 'The board\'s own 5x7 at 4x: the same digits as the arrival times, poster size.',
     None, {'round': 7, 'files': ['board-5x7.bdf'], 'scales': [2, 3, 4]}),
    ('dots', 'Dot-matrix 5x7', 'The board\'s 5x7 drawn as 3 x 3 dots on a 4 px grid, like a station sign made of LEDs.',
     None, {'round': 7, 'files': ['board-5x7.bdf'], 'scales': [2, 3, 4], 'dots': True}),
    ('thumbdots', 'Dot-matrix Tom Thumb', 'Tom Thumb (the board\'s smallest font) as dots, 4 or 5 px apart: tall enough for 64.',
     None, {'round': 7, 'files': ['tom-thumb.bdf'], 'scales': [3, 4, 5], 'dots': True}),
]
# Roles: (name, digit-height range, max width of the widest time "12:58").
ROLES = [
    ('big64', (16, 28), 64),
    ('dtd64', (12, 15), 52),  # leaves room for AM/PM beside it
    ('big128', (17, 28), 112),  # leaves room for AM/PM beside it
    ('panel128', (17, 28), 70),
]


def bdf_text(path):
    if path.endswith('.pcf.gz'):
        return subprocess.run(['pcf2bdf'], input=gzip.open(path).read(), capture_output=True).stdout.decode('latin-1')
    return open(path, encoding='latin-1').read()


def parse(txt):
    font, glyphs, cur, rows = '', {}, None, None
    for line in txt.splitlines():
        if line.startswith('FONT ') and not font:
            font = line[5:].strip()
        if line.startswith('STARTCHAR'):
            cur = {}
        elif cur is not None and line.startswith('ENCODING'):
            cur['enc'] = int(line.split()[1])
        elif cur is not None and line.startswith('DWIDTH'):
            cur['dw'] = int(line.split()[1])
        elif cur is not None and line.startswith('BBX'):
            cur['bbx'] = list(map(int, line.split()[1:5]))
        elif cur is not None and line == 'BITMAP':
            rows = []
        elif line == 'ENDCHAR':
            if cur and cur.get('enc', -1) >= 0 and chr(cur['enc']) in DIGITS:
                w, h, xo, yo = cur['bbx']
                bits = []
                for r in rows:
                    v, n = int(r or '0', 16), len(r) * 4
                    bits.append([(v >> (n - 1 - i)) & 1 for i in range(w)])
                glyphs[chr(cur['enc'])] = {'dw': cur['dw'], 'w': w, 'h': h, 'xo': xo, 'yo': yo, 'bits': bits}
            cur, rows = None, None
        elif rows is not None:
            rows.append(line.strip())
    return font, glyphs


def digit_band(g):
    """Rows (relative to the baseline, up is negative) the digits' ink spans."""
    top, bot = 99, -99
    for ch in '0123456789':
        q = g[ch]
        for j, row in enumerate(q['bits']):
            if any(row):
                y = j - (q['yo'] + q['h'])  # row relative to baseline
                top, bot = min(top, y), max(bot, y)
    return top, bot


def packed(g, top, bot):
    out = {}
    for ch in DIGITS:
        q = g[ch]
        cols = [i for i in range(q['w']) if any(r[i] for r in q['bits'])]
        x0, x1 = (cols[0], cols[-1]) if cols else (0, 0)
        rows = []
        for y in range(top, bot + 1):
            j = y + q['yo'] + q['h']
            r = q['bits'][j] if 0 <= j < q['h'] else [0] * q['w']
            rows.append(''.join('#' if r[i] else '.' for i in range(x0, x1 + 1)))
        out[ch] = rows
    return out


def gap_for(h):
    return 3 if h >= 24 else 2


def time_width(p, s, gap):
    """Width of a time string in the mockups' layout: each digit centered in a
    slot as wide as the widest digit (tabular, so nothing shifts as the
    minutes change), the colon at its own ink width, `gap` between."""
    slot = max(len(p[d][0]) for d in '0123456789')
    return sum(len(p[c][0]) if c == ':' else slot for c in s) + gap * (len(s) - 1)


def scaled(p, k, dots):
    """Each pixel as a k x k block, or a (k-1) x (k-1) dot on a k grid."""
    out = {}
    for ch, rows in p.items():
        big = []
        for r in rows:
            for j in range(k):
                line = ''
                for c in r:
                    on = c == '#' and not (dots and j == k - 1)
                    line += ''.join('#' if on and not (dots and i == k - 1) else '.' for i in range(k))
                big.append(line.rstrip('.') if False else line)
        if dots:  # drop the trailing gap row/column so ink ends at the last dot
            big = [l[:-1] for l in big[:-1]]
        out[ch] = big
    return out


def main():
    src = sys.argv[1]
    files = glob.glob(os.path.join(src, '**', '*.pcf.gz'), recursive=True) + glob.glob(os.path.join(src, '**', '*.bdf'), recursive=True)
    fonts = []
    for path in files:
        try:
            font, g = parse(bdf_text(path))
        except (TypeError, ValueError):  # a few u8g2 files aren't plain BDF
            continue
        if all(c in g for c in DIGITS):
            fonts.append((path, font, g))
    out = {}
    for fam in FAMILIES:
        key, label, note, match = fam[:4]
        opt = fam[4] if len(fam) > 4 else {}
        cands = []
        for path, font, g in fonts:
            if opt.get('files'):
                if os.path.basename(path) not in opt['files']:
                    continue
            elif isinstance(match, str):
                if match not in os.path.basename(path) or 'ibm' in path:
                    continue
            else:
                f = font.split('-')
                if len(f) < 14 or (f[1], f[2], f[3]) != match or f[4] != 'R' or f[5] != 'Normal' or not f[-2:] in (['ISO10646', '1'], ['ISO8859', '1']):
                    continue
            top, bot = digit_band(g)
            p0 = packed(g, top, bot)
            for k in opt.get('scales', [1]):
                p = scaled(p0, k, opt.get('dots')) if k > 1 or opt.get('dots') else p0
                h = len(p['0'])
                gap = k if k > 1 else gap_for(h)
                src = (font or os.path.basename(path)) + (f' x{k}' if k > 1 else '')
                cands.append({'h': h, 'w': time_width(p, '12:58', gap), 'gap': gap, 'src': src, 'glyphs': p})
        sizes, roles = {}, {}
        for role, (lo, hi), maxw in ROLES:
            ok = [c for c in cands if lo <= c['h'] <= hi and c['w'] <= maxw]
            if not ok:
                continue
            best = max(ok, key=lambda c: (c['h'], -c['w']))  # tallest that fits
            k = str(best['h'])
            sizes[k] = {'w': best['w'], 'gap': best['gap'], 'src': best['src'], 'glyphs': best['glyphs']}
            roles[role] = k
        out[key] = {'label': label, 'note': note, 'round': opt.get('round', 6), 'roles': roles, 'sizes': sizes}
        print(f"{key:14s} " + '  '.join(f"{r}={roles.get(r, '-')}" for r, _, _ in ROLES))
    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bitmap-digits.json')
    json.dump(out, open(dst, 'w'), separators=(',', ':'))
    print(f'wrote {dst}')


if __name__ == '__main__':
    main()
