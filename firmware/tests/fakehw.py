"""Stand-ins for the CircuitPython hardware modules, so boardlib/device.py
imports and its BoardFrame can be checked under CPython. Behavior follows
the CircuitPython docs for the calls device.py uses:
  bitmaptools.fill_region(bmp, x1, y1, x2, y2, value)   x2/y2 exclusive
  bitmaptools.arrayblit(bmp, data, x1, y1, x2, y2, skip_index)
"""

import sys
import types


class Bitmap:
    def __init__(self, w, h, n):
        self.width = w
        self.height = h
        self.n = n
        self.data = bytearray(w * h)

    def __setitem__(self, xy, v):
        x, y = xy
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise IndexError('pixel out of range: %r' % (xy,))
        if not (0 <= v < self.n):
            raise ValueError('value out of range: %r' % v)
        self.data[y * self.width + x] = v

    def __getitem__(self, xy):
        x, y = xy
        return self.data[y * self.width + x]

    def fill(self, v):
        for i in range(len(self.data)):
            self.data[i] = v


class Palette:
    def __init__(self, n):
        self.colors = [0] * n

    def __setitem__(self, i, v):
        self.colors[i] = v

    def __getitem__(self, i):
        return self.colors[i]


def fill_region(bmp, x1, y1, x2, y2, value):
    for y in range(y1, y2):
        for x in range(x1, x2):
            bmp[x, y] = value


def arrayblit(bmp, data, x1=0, y1=0, x2=None, y2=None, skip_index=None):
    x2 = bmp.width if x2 is None else x2
    y2 = bmp.height if y2 is None else y2
    i = 0
    for y in range(y1, y2):
        for x in range(x1, x2):
            v = data[i]
            i += 1
            if skip_index is None or v != skip_index:
                bmp[x, y] = v


def install():
    def mod(name, **attrs):
        m = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(m, k, v)
        sys.modules[name] = m
    mod('bitmaptools', fill_region=fill_region, arrayblit=arrayblit)
    mod('displayio', Bitmap=Bitmap, Palette=Palette, release_displays=lambda: None)
    mod('board')
    mod('busio')
    mod('framebufferio')
    mod('rgbmatrix')
    mod('digitalio', DigitalInOut=None, Direction=None, Pull=None)


def to_rgb(frame):
    """A device BoardFrame's bitmap + palette as RGB bytes, like draw.Frame.px."""
    out = bytearray(64 * 32 * 3)
    for i, v in enumerate(frame.bitmap.data):
        c = frame.palette[v]
        out[i * 3] = (c >> 16) & 255
        out[i * 3 + 1] = (c >> 8) & 255
        out[i * 3 + 2] = c & 255
    return out
