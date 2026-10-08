"""device.BoardFrame against draw.Frame: the board's palette-indexed frame
(logo blits, persistent colors, incremental palette writes) must show the
same pixels as the reference renderer, and redrawing must not keep
allocating. Hardware modules are stubbed so device.py imports under CPython."""

import os
import sys
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))
for name in ('bitmaptools', 'board', 'busio', 'displayio', 'framebufferio', 'rgbmatrix', 'digitalio'):
    sys.modules.setdefault(name, types.ModuleType(name))
for attr in ('DigitalInOut', 'Direction', 'Pull'):
    setattr(sys.modules['digitalio'], attr, object)


class FakeBitmap:
    def __init__(self, w=64, h=32):
        self.w, self.h = w, h
        self.v = bytearray(w * h)

    def fill(self, value):
        for i in range(len(self.v)):
            self.v[i] = value

    def __setitem__(self, xy, value):
        x, y = xy
        self.v[y * self.w + x] = value


def arrayblit(bitmap, data, x1=0, y1=0, x2=-1, y2=-1, skip_index=None):
    w = x2 - x1
    for i, val in enumerate(data[:w * (y2 - y1)]):
        if skip_index is not None and val == skip_index:
            continue
        bitmap[x1 + i % w, y1 + i // w] = val


def fill_region(bitmap, x1, y1, x2, y2, value):
    for y in range(y1, y2):
        for x in range(x1, x2):
            bitmap[x, y] = value


bt = sys.modules['bitmaptools']
bt.arrayblit = arrayblit
bt.fill_region = fill_region

from boardlib import device, draw  # noqa: E402
import test_app  # noqa: E402


def logo(seed, colors=40):
    """24 x 12 RGB with `colors` distinct colors."""
    pal = [((seed * 37 + n * 53) % 256, (seed * 11 + n * 97) % 256, (n * 29 + 7) % 256) for n in range(colors)]
    out = bytearray()
    for i in range(24 * 12):
        out += bytes(pal[(i * 7 + seed) % colors])
    return bytes(out)


def board_pixels(bf):
    pal = bf.palette
    out = []
    for i in range(64 * 32):
        v = pal[bf.bitmap.v[i]]
        out.append(((v >> 16) & 255, (v >> 8) & 255, v & 255))
    return out


def ref_pixels(f):
    return [f.get(i % 64, i // 64) for i in range(64 * 32)]


class TestBoardFrame(unittest.TestCase):
    def setUp(self):
        server = test_app.Server(test_app.Clock(), None)
        server.layout = 'logos'
        self.p = server.payload()
        self.now = self.p['now']
        self.logos = {'CHC-1': logo(3), 'STL-1': logo(9, 64)}
        self.bf = device.BoardFrame(FakeBitmap(), [0] * 256)

    def draw_board(self, p, screen, **kw):
        self.bf.begin()
        draw.render(p, self.bf, screen=screen, now=self.now, **kw)
        self.bf.commit()
        return board_pixels(self.bf)

    def test_logo_screen_matches_the_reference_renderer(self):
        for dim in (1.0, 0.9, 0.5):
            self.p['mlb']['dim'] = dim
            ref = draw.render(self.p, draw.Frame(), screen='baseball', now=self.now, logos=self.logos)
            got = self.draw_board(self.p, 'baseball', logos=self.logos)
            self.assertEqual(got, ref_pixels(ref), 'dim %s' % dim)
        self.assertEqual(sorted(k[0] for k in self.bf.logo_cache), ['CHC-1', 'STL-1'], 'the blit path ran')
        self.assertGreater(len(set(ref_pixels(ref))), 60, 'the logos are on screen')

    def test_redrawing_allocates_nothing_new(self):
        for _ in range(3):
            self.draw_board(self.p, 'baseball', logos=self.logos)
        colors, cache = len(self.bf.colors), len(self.bf.logo_cache)
        for _ in range(20):
            self.draw_board(self.p, 'baseball', logos=self.logos)
        self.assertEqual(len(self.bf.colors), colors, 'color table grew on redraw')
        self.assertEqual(len(self.bf.logo_cache), cache)
        self.assertEqual(self.bf.fresh, [])

    def test_screens_after_logos_still_match(self):
        # Persistent colors and the logo palette blocks don't leak into
        # other screens' pixels.
        self.draw_board(self.p, 'baseball', logos=self.logos)
        for screen in ('transit', 'ticker', 'weather', 'baseball'):
            ref = draw.render(self.p, draw.Frame(), screen=screen, now=self.now, logos=self.logos)
            self.assertEqual(self.draw_board(self.p, screen, logos=self.logos), ref_pixels(ref), screen)

    def test_a_full_glyph_cache_draws_the_rest_pixel_by_pixel(self):
        old = device.GLYPH_CACHE
        device.GLYPH_CACHE = 5
        try:
            for screen in ('transit', 'ticker', 'baseball'):
                ref = draw.render(self.p, draw.Frame(), screen=screen, now=self.now, logos=self.logos)
                self.assertEqual(self.draw_board(self.p, screen, logos=self.logos), ref_pixels(ref), screen)
                self.assertLessEqual(len(self.bf.glyphs), 5)
        finally:
            device.GLYPH_CACHE = old

    def test_radar_brightness_rewrites_the_radar_slots(self):
        data = bytes((i % 11) for i in range(2048))
        for rb in (100, 60, 60, 150, 100):
            self.bf.begin()
            self.bf.draw_radar(data, rb)
            self.bf.commit()
            ref = draw.Frame()
            draw.draw_radar_frame(ref, data, rb)
            got = board_pixels(self.bf)
            for i in range(64 * 32):
                if data[i]:
                    self.assertEqual(got[i], ref.get(i % 64, i // 64), 'rb %d value %d' % (rb, data[i]))

    def test_cache_keys_are_ints(self):
        # Tuple keys cost memory to keep and a new tuple per glyph per frame.
        for screen in ('transit', 'baseball'):
            self.draw_board(self.p, screen, logos=self.logos)
        self.assertTrue(self.bf.glyphs and all(isinstance(k, int) for k in self.bf.glyphs))
        self.assertTrue(all(isinstance(k, int) for k in self.bf.colors))
        self.assertTrue(all(isinstance(c, int) for ent in self.bf.logo_cache.values() for c in ent[0]))

    def test_the_color_table_resets_when_full(self):
        for n in range(400):
            self.bf.begin()
            self.bf.fill(0, 0, 1, 1, (n % 256, n // 256, 7))
            self.bf.commit()
            self.assertLessEqual(self.bf.next, 256)
        self.assertLessEqual(self.bf.next, device.COLOR_RESET + 1)
        self.bf.begin()
        self.bf.fill(0, 0, 64, 32, (1, 2, 3))
        self.bf.commit()
        self.assertEqual(board_pixels(self.bf)[0], (1, 2, 3))


if __name__ == '__main__':
    unittest.main()
