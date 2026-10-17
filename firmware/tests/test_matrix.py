"""matrix.logo_slots: the M4 keeps 4 logo slots; the S3 (big heap, or no
ESP32 co-processor) gets 32."""

import os
import sys
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
for name in ('board', 'displayio', 'framebufferio', 'rgbmatrix'):
    sys.modules.setdefault(name, types.ModuleType(name))
from boardlib import matrix, player  # noqa: E402


class TestLogoSlots(unittest.TestCase):
    def test_m4(self):
        self.assertEqual(matrix.logo_slots(130 * 1024), player.LOGO_SLOTS)

    def test_s3(self):
        self.assertEqual(matrix.logo_slots(2 * 1024 * 1024), 32)
        # Even if its heap reports small at boot: no co-processor means S3.
        self.assertEqual(matrix.logo_slots(200 * 1024, coprocessor=False), 32)

    def test_buffer_sizes_match_the_player(self):
        self.assertEqual(matrix.RADAR_SLOTS, player.RADAR_SLOTS)
        self.assertEqual(matrix.RADAR_BYTES, player.RADAR_BYTES)
        self.assertEqual(matrix.LOGO_BYTES, player.LOGO_BYTES)


if __name__ == '__main__':
    unittest.main()
