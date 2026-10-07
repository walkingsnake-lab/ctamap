"""device.read_into: radar frames are read into a preallocated buffer, never
through Response.content (a fresh 2 KB bytes a fragmented heap can't fit).
The hardware modules are stubbed so device.py imports under CPython."""

import os
import sys
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
for name in ('bitmaptools', 'board', 'busio', 'displayio', 'framebufferio', 'rgbmatrix', 'digitalio'):
    sys.modules.setdefault(name, types.ModuleType(name))
for attr in ('DigitalInOut', 'Direction', 'Pull'):
    setattr(sys.modules['digitalio'], attr, object)
from boardlib import device  # noqa: E402


class FakeResponse:
    """Body served in small reads, like adafruit_requests over the ESP32."""

    def __init__(self, body, step=100, private=True):
        self.body = body
        self.pos = 0
        self.step = step
        if not private:
            self._readinto = None

    biggest = 0

    def _readinto(self, buf):
        self.biggest = max(self.biggest, len(buf))
        n = min(len(buf), self.step, len(self.body) - self.pos)
        buf[:n] = self.body[self.pos:self.pos + n]
        self.pos += n
        return n

    def iter_content(self, size):
        while self.pos < len(self.body):
            chunk = self.body[self.pos:self.pos + size]
            self.pos += len(chunk)
            yield chunk

    @property
    def content(self):
        raise AssertionError('read_into must not build the whole body')


class TestReadInto(unittest.TestCase):
    body = bytes(i % 11 for i in range(2048))

    def test_fills_the_buffer_in_place(self):
        buf = bytearray(2048)
        device.read_into(FakeResponse(self.body), buf)
        self.assertEqual(bytes(buf), self.body)

    def test_reads_are_small(self):
        # esp32spi allocates a temp bytes per read, sized to the request.
        r = FakeResponse(self.body, step=4096)
        buf = bytearray(2048)
        device.read_into(r, buf)
        self.assertEqual(bytes(buf), self.body)
        self.assertLessEqual(r.biggest, device.READ_CHUNK)

    def test_falls_back_to_small_chunks_without_readinto(self):
        buf = bytearray(2048)
        device.read_into(FakeResponse(self.body, private=False), buf)
        self.assertEqual(bytes(buf), self.body)

    def test_short_body_raises(self):
        with self.assertRaises(ValueError):
            device.read_into(FakeResponse(self.body[:2000]), bytearray(2048))


if __name__ == '__main__':
    unittest.main()
