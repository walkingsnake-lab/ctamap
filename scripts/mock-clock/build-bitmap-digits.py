#!/usr/bin/env python3
"""Pull clock digits (0-9 and the colon) out of real bitmap fonts into
bitmap-digits.json for the clock mockups. Glyphs are the fonts' own drawings
at their native sizes (never scaled: they were drawn pixel by pixel),
cropped to their ink; the mockups space them (time_width).

  python3 scripts/mock-clock/build-bitmap-digits.py <folder of .pcf.gz/.bdf files>

Sources: Ubuntu's xfonts-75dpi, xfonts-100dpi and xfonts-base (the X11
bitmap fonts: Adobe, B&H, Bitstream, Misc), xfonts-terminus, and Spleen
(github.com/fcambus/spleen). PCF files are read with pcf2bdf. Each family
picks, per role, the size that fits it (see ROLES); only those sizes are kept.
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
]
# Roles: (name, digit-height range, max width of the widest time "12:58").
ROLES = [
    ('big64', (18, 28), 64),
    ('dtd64', (12, 15), 52),  # leaves room for AM/PM beside it
    ('big128', (19, 28), 120),
    ('panel128', (19, 28), 70),
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


def time_width(p, s, h):
    """Width of a time string in the mockups' layout: each digit centered in a
    slot as wide as the widest digit (tabular, so nothing shifts as the
    minutes change), the colon at its own ink width, gap_for(h) between."""
    slot = max(len(p[d][0]) for d in '0123456789')
    return sum(len(p[c][0]) if c == ':' else slot for c in s) + gap_for(h) * (len(s) - 1)


def main():
    src = sys.argv[1]
    files = glob.glob(os.path.join(src, '**', '*.pcf.gz'), recursive=True) + glob.glob(os.path.join(src, '**', '*.bdf'), recursive=True)
    fonts = []
    for path in files:
        font, g = parse(bdf_text(path))
        if all(c in g for c in DIGITS):
            fonts.append((path, font, g))
    out = {}
    for key, label, note, match in FAMILIES:
        cands = []
        for path, font, g in fonts:
            if isinstance(match, str):
                if match not in os.path.basename(path) or 'ibm' in path:
                    continue
            else:
                f = font.split('-')
                if len(f) < 14 or (f[1], f[2], f[3]) != match or f[4] != 'R' or f[5] != 'Normal' or not f[-2:] in (['ISO10646', '1'], ['ISO8859', '1']):
                    continue
            top, bot = digit_band(g)
            p = packed(g, top, bot)
            w = time_width(p, '12:58', bot - top + 1)
            cands.append({'h': bot - top + 1, 'w': w, 'src': font or os.path.basename(path), 'glyphs': p})
        sizes, roles = {}, {}
        for role, (lo, hi), maxw in ROLES:
            ok = [c for c in cands if lo <= c['h'] <= hi and c['w'] <= maxw]
            if not ok:
                continue
            best = max(ok, key=lambda c: (c['h'], -c['w']))  # tallest that fits
            k = str(best['h'])
            sizes[k] = {'w': best['w'], 'src': best['src'], 'glyphs': best['glyphs']}
            roles[role] = k
        out[key] = {'label': label, 'note': note, 'roles': roles, 'sizes': sizes}
        print(f"{key:14s} " + '  '.join(f"{r}={roles.get(r, '-')}" for r, _, _ in ROLES))
    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bitmap-digits.json')
    json.dump(out, open(dst, 'w'), separators=(',', ':'))
    print(f'wrote {dst}')


if __name__ == '__main__':
    main()
