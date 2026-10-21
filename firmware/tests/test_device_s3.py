"""Matrix Portal S3: device.radio() picks the built-in WiFi when the `wifi`
module exists, and Net.connect works through NativeRadio the same way it
does through the M4's ESP32."""

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


class FakeRadio:
    """wifi.radio: joins fail for networks it can't see; scanning must be
    stopped before a join."""

    def __init__(self, visible):
        self.visible = visible
        self.connected = False
        self.ap_info = None
        self.mac_address = b'\x01\x02\x03\x04\x05\x06'
        self.enabled = True
        self.scanning = False
        self.joins = []
        self.toggles = 0

    def start_scanning_networks(self):
        self.scanning = True
        return iter([types.SimpleNamespace(ssid=s, rssi=-50) for s in self.visible])

    def stop_scanning_networks(self):
        self.scanning = False

    def connect(self, ssid, password, timeout=None):
        assert not self.scanning, 'joined while a scan was running'
        self.joins.append(ssid)
        if ssid not in self.visible:
            raise ConnectionError('No network with that ssid')
        self.connected = True
        self.ap_info = types.SimpleNamespace(ssid=ssid, rssi=-48)

    def stop_station(self):
        self.connected = False
        self.ap_info = None

    def __setattr__(self, k, v):
        if k == 'enabled' and v is False:
            self.__dict__['toggles'] = self.__dict__.get('toggles', 0) + 1
        object.__setattr__(self, k, v)


def make_net(radio):
    net = device.Net.__new__(device.Net)
    net.kind = 's3'
    net.esp = device.NativeRadio(radio)
    net._pool = object()
    net._close_all = lambda pool: None
    net.ping = lambda: True
    return net


class TestS3(unittest.TestCase):
    def setUp(self):
        self._sleep = device.time.sleep
        device.time.sleep = lambda s: None

    def tearDown(self):
        device.time.sleep = self._sleep
        sys.modules.pop('wifi', None)

    def test_built_in_wifi_is_detected(self):
        r = FakeRadio([])
        sys.modules['wifi'] = types.SimpleNamespace(radio=r)
        kind, radio = device.radio()
        self.assertEqual(kind, 's3')
        self.assertIs(radio.radio, r)

    def test_joins_the_visible_network(self):
        r = FakeRadio(['JakeAtHome2.4'])
        net = make_net(r)
        nets = [('Jacob’s iPhone', 'pw'), ('JakeAtHome2.4', 'pw')]
        self.assertEqual(net.connect(nets, lambda *a: None), ('ok', 'JakeAtHome2.4'))
        self.assertEqual(r.joins, ['JakeAtHome2.4'])
        self.assertEqual(net.rssi(), -48)
        self.assertEqual(net.mac, '01:02:03:04:05:06')

    def test_still_connected_skips_the_join(self):
        r = FakeRadio(['JakeAtHome2.4'])
        r.connect('JakeAtHome2.4', 'pw')
        r.joins = []
        net = make_net(r)
        self.assertEqual(net.connect([('JakeAtHome2.4', 'pw')], lambda *a: None), ('ok', 'JakeAtHome2.4'))
        self.assertEqual(r.joins, [])

    def test_no_network_power_cycles_the_radio(self):
        r = FakeRadio(['Neighbor'])
        net = make_net(r)
        self.assertEqual(net.connect([('Gone', 'pw')], lambda *a: None), ('nowifi', None))
        self.assertEqual(r.toggles, 1)
        self.assertTrue(r.enabled)


if __name__ == '__main__':
    unittest.main()
