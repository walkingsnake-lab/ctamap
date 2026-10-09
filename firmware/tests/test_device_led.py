"""device.StatusLed and device.status_led against a fake neopixel_write."""

import os
import sys
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
for name in ('bitmaptools', 'board', 'busio', 'displayio', 'framebufferio', 'rgbmatrix', 'digitalio'):
    sys.modules.setdefault(name, types.ModuleType(name))
from boardlib import device  # noqa: E402


class Pin:
    def __init__(self, p):
        self.p = p
        self.direction = None


class TestStatusLed(unittest.TestCase):
    def setUp(self):
        self.writes = []
        nw = types.ModuleType('neopixel_write')
        nw.neopixel_write = lambda pin, buf: self.writes.append(bytes(buf))
        sys.modules['neopixel_write'] = nw
        self.saved = (device.DigitalInOut, device.Direction, device.board)
        device.DigitalInOut = Pin
        device.Direction = types.SimpleNamespace(OUTPUT='out')
        device.board = types.SimpleNamespace(NEOPIXEL='np')
        device._led[:] = []

    def tearDown(self):
        device.DigitalInOut, device.Direction, device.board = self.saved
        sys.modules.pop('neopixel_write', None)
        os.environ.pop('STATUS_LED', None)
        device._led[:] = []

    def test_writes_grb_and_skips_repeats(self):
        led = device.StatusLed()
        self.assertEqual(self.writes, [b'\x00\x00\x00'])  # off at startup
        led.set('offline')
        led.set('offline')
        led.set('fetch')
        r, g, b = device.LED_COLORS['offline']
        self.assertEqual(self.writes[1], bytes((g, r, b)))
        self.assertEqual(len(self.writes), 3)

    def test_mode_1_hides_the_fetch_light(self):
        led = device.StatusLed(1)
        led.set('fetch')
        led.set('failing')
        self.assertEqual(led.state, 'failing')
        self.assertEqual(len(self.writes), 2)  # off at startup, then failing; no blue

    def test_every_state_is_dim(self):
        for name, rgb in device.LED_COLORS.items():
            self.assertLessEqual(max(rgb), 16, name)

    def test_status_led_is_shared_and_follows_settings(self):
        a = device.status_led()
        self.assertIs(device.status_led(), a)
        self.assertEqual(a.mode, 2)
        device._led[:] = []
        os.environ['STATUS_LED'] = '0'
        self.assertIsNone(device.status_led())
        device._led[:] = []
        os.environ['STATUS_LED'] = '1'
        self.assertEqual(device.status_led().mode, 1)

    def test_no_pixel_means_no_led(self):
        sys.modules.pop('neopixel_write')
        sys.modules['neopixel_write'] = None  # import fails
        self.assertIsNone(device.status_led())


if __name__ == '__main__':
    unittest.main()
