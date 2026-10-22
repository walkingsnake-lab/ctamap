"""device.Net.connect against a fake ESP32 (the M4) with the failure modes
seen on the board: after a failed join it reports 'No such ssid' for every
network until disconnected, and a wedged radio fails scans until
hardware-reset. Also against a fake native radio (the S3's wifi.radio)."""

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


def make_net(esp, radio=None):
    net = device.Net.__new__(device.Net)
    net.radio = radio or device.Esp32SpiRadio(esp)
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

    def test_scan_keeps_only_our_networks(self):
        # A busy building: dozens of networks. Listing them all ran the
        # boot heap out of memory (MemoryError in _warm_up).
        esp = FakeESP(['N%d' % i for i in range(40)] + ['JakeAtHome2.4'])
        net = make_net(esp)
        seen = net._warm_up(['JakeAtHome2.4', 'Gone'], lambda *a: None)
        self.assertEqual(seen, ['JakeAtHome2.4'])

    def test_still_connected_to_another_network_scans(self):
        esp = FakeESP(['JakeAtHome2.4'])
        esp.is_connected = True
        esp.ap_info = types.SimpleNamespace(ssid=b'Neighbor')
        net = make_net(esp)
        self.assertEqual(net.connect([('JakeAtHome2.4', 'pw')], lambda *a: None), ('ok', 'JakeAtHome2.4'))
        self.assertEqual(esp.joins, ['JakeAtHome2.4'])

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


class FakeWifiRadio:
    """CircuitPython's wifi.radio on the S3: connect() raises
    ConnectionError for a missing network; ap_info is None until joined;
    scans must be stopped before joining."""

    def __init__(self, visible, scan_fails=0):
        self.visible = visible
        self.scan_fails = scan_fails
        self.scanning = False
        self.joins = []
        self.toggles = 0
        self.ap_info = None
        self.mac_address = bytes([0xf4, 0x12, 0xfa, 0x00, 0x01, 0x02])
        self._enabled = True

    def start_scanning_networks(self):
        if self.scan_fails:
            self.scan_fails -= 1
            raise RuntimeError('Wifi scan failed')
        self.scanning = True
        return iter([types.SimpleNamespace(ssid=s, rssi=-50) for s in self.visible])

    def stop_scanning_networks(self):
        self.scanning = False

    def connect(self, ssid, password, timeout=None):
        assert not self.scanning, 'join while a scan is running'
        self.joins.append(ssid)
        if ssid not in self.visible:
            raise ConnectionError('No network with that ssid')
        self.ap_info = types.SimpleNamespace(ssid=ssid, rssi=-58)

    @property
    def enabled(self):
        return self._enabled

    @enabled.setter
    def enabled(self, v):
        if not v:
            self.toggles += 1
            self.ap_info = None
        self._enabled = v


class TestNativeConnect(unittest.TestCase):
    def setUp(self):
        self._sleep = device.time.sleep
        device.time.sleep = lambda s: None

    def tearDown(self):
        device.time.sleep = self._sleep

    def net(self, radio):
        return make_net(None, device.NativeRadio(radio))

    def test_joins_a_visible_network_after_a_missing_one(self):
        radio = FakeWifiRadio(['JakeAtHome2.4', 'Neighbor'])
        net = self.net(radio)
        nets = [('Jacob’s iPhone', 'pw'), ('JakeAtHome2.4', 'pw')]
        self.assertEqual(net.connect(nets, lambda *a: None), ('ok', 'JakeAtHome2.4'))
        self.assertEqual(radio.joins, ['JakeAtHome2.4'], 'visible networks go first')
        self.assertFalse(radio.scanning, 'the scan is stopped')
        self.assertEqual(net.rssi(), -58)

    def test_still_connected_skips_the_scan_and_join(self):
        radio = FakeWifiRadio(['JakeAtHome2.4'])
        radio.ap_info = types.SimpleNamespace(ssid='JakeAtHome2.4', rssi=-60)
        net = self.net(radio)
        radio.start_scanning_networks = None  # a scan would fail the test
        self.assertEqual(net.connect([('JakeAtHome2.4', 'pw')], lambda *a: None), ('ok', 'JakeAtHome2.4'))
        self.assertEqual(radio.joins, [])

    def test_a_failed_scan_resets_the_radio_and_recovers(self):
        radio = FakeWifiRadio(['JakeAtHome2.4'], scan_fails=1)
        net = self.net(radio)
        self.assertEqual(net.connect([('JakeAtHome2.4', 'pw')], lambda *a: None), ('ok', 'JakeAtHome2.4'))
        self.assertEqual(radio.toggles, 1)
        self.assertTrue(radio.enabled)

    def test_portal_reports_the_mac(self):
        radio = FakeWifiRadio(['Work Visitor'])
        net = self.net(radio)
        net.ping = lambda: False
        self.assertEqual(net.connect([('Work Visitor', '')], lambda *a: None), ('portal', 'f4:12:fa:00:01:02'))

    def test_no_network_resets_the_radio_for_the_next_round(self):
        radio = FakeWifiRadio(['Neighbor'])
        net = self.net(radio)
        self.assertEqual(net.connect([('Gone', 'pw')], lambda *a: None), ('nowifi', None))
        self.assertEqual(radio.toggles, 1)
        self.assertEqual(len(radio.joins), device.JOIN_TRIES)

    def test_reads_in_bigger_chunks_than_the_esp32(self):
        self.assertGreater(device.NativeRadio.read_chunk, device.Esp32SpiRadio.read_chunk)


if __name__ == '__main__':
    unittest.main()
