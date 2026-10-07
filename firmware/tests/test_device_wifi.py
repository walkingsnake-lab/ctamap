"""device.Net.connect against a fake ESP32 with the failure modes seen on
the board: after a failed join it reports 'No such ssid' for every network
until disconnected, and a wedged radio fails scans until hardware-reset."""

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


class FakeESP:
    def __init__(self, visible, wedged_scans=0):
        self.visible = visible
        self.wedged_scans = wedged_scans  # scans that fail until a reset
        self.wedged = wedged_scans > 0
        self.stuck = False                # status stuck at 'No such ssid'
        self.joins = []
        self.resets = 0
        self.is_connected = False

    def scan_networks(self):
        if self.wedged:
            raise BrokenPipeError('Error response to command')
        return [{'ssid': s.encode('utf-8')} for s in self.visible]

    def reset(self):
        self.resets += 1
        self.wedged = False
        self.stuck = False

    def disconnect(self):
        self.stuck = False
        self.is_connected = False

    def connect_AP(self, ssid, password):
        self.joins.append(ssid)
        if self.stuck or ssid not in self.visible:
            self.stuck = True
            raise ConnectionError('No such ssid', ssid.encode('utf-8'))
        self.is_connected = True


def make_net(esp):
    net = device.Net.__new__(device.Net)
    net.esp = esp
    net._pool = object()
    net._close_all = lambda pool: None
    net.ping = lambda: True
    return net


class TestConnect(unittest.TestCase):
    def setUp(self):
        self._sleep = device.time.sleep
        device.time.sleep = lambda s: None

    def tearDown(self):
        device.time.sleep = self._sleep

    def test_joins_a_visible_network_after_a_missing_one(self):
        # The board's log: hotspot off, home network visible, every join
        # failed with 'No such ssid'.
        esp = FakeESP(['JakeAtHome2.4', 'Neighbor'])
        net = make_net(esp)
        nets = [('Jacob’s iPhone', 'pw'), ('JakeAtHome2.4', 'pw')]
        self.assertEqual(net.connect(nets, lambda *a: None), ('ok', 'JakeAtHome2.4'))
        self.assertEqual(esp.joins, ['JakeAtHome2.4'], 'visible networks go first')

    def test_still_connected_after_a_soft_reboot_skips_the_join(self):
        esp = FakeESP(['JakeAtHome2.4'])
        esp.is_connected = True
        esp.ap_info = types.SimpleNamespace(ssid='JakeAtHome2.4')
        net = make_net(esp)
        self.assertEqual(net.connect([('JakeAtHome2.4', 'pw')], lambda *a: None), ('ok', 'JakeAtHome2.4'))
        self.assertEqual(esp.joins, [])

    def test_unseen_networks_are_still_tried_last(self):
        esp = FakeESP(['Neighbor'])
        net = make_net(esp)
        esp.visible.append('Hidden')  # joinable, but missing from the scan
        esp.scan_networks = lambda: [{'ssid': b'Neighbor'}]
        self.assertEqual(net.connect([('Gone', 'pw'), ('Hidden', 'pw')], lambda *a: None), ('ok', 'Hidden'))
        self.assertIn('Gone', esp.joins)

    def test_a_wedged_radio_is_reset_and_recovers(self):
        esp = FakeESP(['JakeAtHome2.4'], wedged_scans=1)
        net = make_net(esp)
        self.assertEqual(net.connect([('JakeAtHome2.4', 'pw')], lambda *a: None), ('ok', 'JakeAtHome2.4'))
        self.assertGreaterEqual(esp.resets, 1)

    def test_no_network_resets_the_radio_for_the_next_round(self):
        esp = FakeESP(['Neighbor'])
        net = make_net(esp)
        self.assertEqual(net.connect([('Gone', 'pw')], lambda *a: None), ('nowifi', None))
        self.assertEqual(esp.resets, 1)


if __name__ == '__main__':
    unittest.main()
