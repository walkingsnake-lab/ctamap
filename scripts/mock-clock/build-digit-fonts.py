#!/usr/bin/env python3
"""Rasterize clock digits from TrueType fonts into 1-bit bitmaps for the
clock mockups (digit-fonts.json). Each font is drawn 8x oversize with
anti-aliasing, then cut to the panel grid and kept where a pixel is at
least half covered, so the shapes follow the outline rather than the
font's own hinting. Digits are scaled so a '0' is exactly H rows tall.

  python3 scripts/mock-clock/build-digit-fonts.py <folder with the .ttf files>

The fonts (all SIL Open Font License) come from github.com/google/fonts;
they aren't committed, only the bitmaps made from them.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONTS = [
    # key, label, file, weight (variable fonts), note
    ('bigshoulders', 'Big Shoulders Display', 'BigShouldersDisplay[wght].ttf', 700,
     'Patric King\'s typeface for the Chicago Design System (2019), drawn partly from the city\'s railroad history.'),
    ('bigshoulders-light', 'Big Shoulders Display Light', 'BigShouldersDisplay[wght].ttf', 400, 'The same face, lighter.'),
    ('bebas', 'Bebas Neue', 'BebasNeue-Regular.ttf', None, 'Tall all-caps poster sans; a common clock-widget face.'),
    ('antonio', 'Antonio', 'Antonio[wght].ttf', 700, 'Very condensed, near-rectangular digits.'),
    ('oswald', 'Oswald', 'Oswald[wght].ttf', 600, 'Condensed grotesk after the old gothic poster faces.'),
    ('dmserif', 'DM Serif Display', 'DMSerifDisplay-Regular.ttf', None, 'High-contrast serif, like a printed timetable.'),
]
HEIGHTS = [28, 14]
SS = 8


def font_at(path, size, wght):
    f = ImageFont.truetype(path, size)
    if wght is not None:
        try:
            f.set_variation_by_axes([wght])
        except Exception:
            pass
    return f


def raster(f, ch, scale_box):
    """Render ch oversize; return (rows of 0/1, x offset of ink, baseline row)."""
    big = Image.new('L', scale_box, 0)
    d = ImageDraw.Draw(big)
    d.text((SS * 4, SS * 4), ch, font=f, fill=255)
    return big


def build(path, wght, H):
    # Find the font size whose '0' is H rows tall at 1x.
    def zero_height(size):
        f = font_at(path, size * SS, wght)
        b = f.getbbox('0')
        return (b[3] - b[1]) / SS, f
    size = H
    for _ in range(40):
        h, f = zero_height(size)
        if abs(h - H) < 0.05:
            break
        size *= H / h
    f = font_at(path, size * SS, wght)
    top = f.getbbox('0')[1]  # every glyph is placed against the '0' cap line
    glyphs = {}
    for ch in '0123456789:':
        b = f.getbbox(ch)
        w = (b[2] - b[0])
        W = int(-(-w // SS)) + 2
        img = Image.new('L', (W * SS, H * SS), 0)
        ImageDraw.Draw(img).text((-b[0] + (W * SS - w) / 2, -top), ch, font=f, fill=255)
        small = img.resize((W, H), Image.BOX)
        rows = [[1 if small.getpixel((x, y)) >= 128 else 0 for x in range(W)] for y in range(H)]
        # trim empty columns either side
        cols = [x for x in range(W) if any(r[x] for r in rows)]
        x0, x1 = (cols[0], cols[-1]) if cols else (0, 0)
        glyphs[ch] = [''.join('#' if r[x] else '.' for x in range(x0, x1 + 1)) for r in rows]
    return glyphs


def main():
    src = sys.argv[1]
    out = {}
    for key, label, file, wght, note in FONTS:
        path = os.path.join(src, file)
        out[key] = {'label': label, 'note': note, 'sizes': {str(H): build(path, wght, H) for H in HEIGHTS}}
    dst = os.path.join(os.path.dirname(__file__), 'digit-fonts.json')
    with open(dst, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    print(f'wrote {dst}')


if __name__ == '__main__':
    main()
