"""The player (boardlib/player.py) on its own: baseball rolls and timing,
radar visits over baseball, and which warnings make the screen blink."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from boardlib import draw, player  # noqa: E402

T0 = 1791140000


def game(**extra):
    g = {'id': 1, 'st': 'live', 'start': T0 - 3600, 'inn': 7, 'half': 'T', 'b': 2, 's': 1, 'o': 2, 'on': [1, 0, 1],
         'away': {'ab': 'CHC', 'c': '#2a5bd8', 'r': 3, 'w': 92, 'l': 70},
         'home': {'ab': 'STL', 'c': '#d62a2a', 'r': 2, 'w': 88, 'l': 74}}
    g.update(extra)
    return g


def payload(games, **extra):
    p = {'v': 1, 'now': T0, 'tzo': -18000, 'screen': 'baseball', 'bright': 100, 'rows': [], 'ticker': [],
         'wx': None, 'warn': None, 'radar': {'on': False, 'frames': [], 'ft': []}, 'mlb': {'games': games}}
    p.update(extra)
    return p


class BaseballPlayer(unittest.TestCase):
    def setUp(self):
        self.pl = player.Player()
        self.pl.set_payload(payload([game()]), 0)
        self.pl.set_screen('baseball', 0)

    def draw(self, ms):
        return self.pl.draw(draw.Frame(), ms, T0 + ms / 1000)

    def test_a_score_change_rolls_then_settles(self):
        self.draw(0)
        self.assertFalse(self.pl.busy(0))
        self.pl.set_payload(payload([game(away={'ab': 'CHC', 'c': '#2a5bd8', 'r': 4, 'w': 92, 'l': 70})]), 1000)
        self.draw(1000)  # the roll starts with the first draw of the new score
        mid = self.draw(1000 + draw.ROLL_MS // 2)
        self.assertEqual(self.pl.bb_rolls['away']['from'], '3')
        self.assertTrue(self.pl.busy(1000 + draw.ROLL_MS // 2))
        self.assertEqual(self.pl.quiet_ms(1000 + draw.ROLL_MS // 2, T0), 0)
        done = self.draw(1000 + draw.ROLL_MS + 10)
        self.assertEqual(self.pl.bb_rolls, {})
        self.assertFalse(self.pl.busy(1000 + draw.ROLL_MS + 10))
        self.assertNotEqual(bytes(mid.px), bytes(done.px))
        still = draw.render(payload([game(away={'ab': 'CHC', 'c': '#2a5bd8', 'r': 4, 'w': 92, 'l': 70})]),
                            draw.Frame(), screen='baseball', now=T0 + (1000 + draw.ROLL_MS + 10) / 1000)
        self.assertEqual(bytes(done.px), bytes(still.px))

    def test_no_roll_across_a_change_of_state(self):
        self.draw(0)
        self.pl.set_payload(payload([game(st='final', away={'ab': 'CHC', 'c': '#2a5bd8', 'r': 5, 'w': 93, 'l': 70})]), 1000)
        self.draw(1100)
        self.assertEqual(self.pl.bb_rolls, {})

    def test_inning_count_and_outs_roll(self):
        self.draw(0)
        self.pl.set_payload(payload([game(half='B', b=0, s=0, o=0)]), 1000)
        self.draw(1100)
        self.assertEqual(sorted(self.pl.bb_rolls), ['count', 'inn', 'outs'])

    def test_radar_visits_interrupt_baseball_on_auto(self):
        r = {'on': True, 'frames': [], 'ft': [], 'visit': {'every': 240, 'for': 60}}
        self.pl.set_payload(payload([game()], radar=r), 0)
        t = (T0 // 240) * 240
        self.assertEqual(self.pl.auto_screen(t + 10), 'weather')
        self.assertEqual(self.pl.auto_screen(t + 100), 'baseball')

    def test_tornado_warning_blinks_on_radar_and_the_weather_row(self):
        pl = player.Player()
        tor = {'kind': 'tor', 'lvl': 'warning'}
        pl.set_payload(payload([], screen='weather', warn=tor), 0)
        pl.set_screen('weather', 0)
        self.assertTrue(pl.blinking())
        pl.set_payload(payload([], screen='weather', warn={'kind': 'tor', 'lvl': 'watch'}), 0)
        self.assertFalse(pl.blinking())
        pl.set_payload(payload([], screen='transit', warn=tor, wx={'icon': 'storm', 'temp': 54, 'word': 'STORMS'}), 0)
        pl.set_screen('transit', 0)
        self.assertTrue(pl.blinking())
        pl.set_payload(payload([], screen='transit', warn=tor), 0)  # weather row hidden
        self.assertFalse(pl.blinking())


class SpeedSettings(unittest.TestCase):
    def test_ticker_hold_and_radar_loop_follow_anim(self):
        pl = player.Player()
        tk = [{'ln': 'RD', 'd': 'Howard', 't': T0 + 300 + 60 * i, 's': 0, 'a': 0} for i in range(4)]
        pl.set_payload(payload([], screen='ticker', ticker=tk, anim={'pageHold': 5000, 'slide': 800}), 0)
        pl.set_screen('ticker', 0)
        self.assertEqual(pl.quiet_ms(1000, T0), 4000)
        self.assertTrue(pl.busy(5400))
        self.assertFalse(pl.busy(5900))
        pl.draw(draw.Frame(), 5900, T0)
        self.assertEqual(pl.page, 1)
        r = {'on': True, 'frames': ['a', 'b', 'c'], 'ft': [T0] * 3}
        pl.set_payload(payload([], screen='weather', radar=r, anim={'radarFrame': 1000, 'radarHold': 2000}), 0)
        pl.set_screen('weather', 0)
        for fid in r['frames']:
            pl.add_frame(fid, pl.take_slot())
        self.assertEqual([pl.radar_idx(ms) for ms in (0, 999, 1000, 2000, 3999, 4000)], [0, 0, 1, 2, 2, 0])


class RadarLoop(unittest.TestCase):
    def setUp(self):
        self.pl = player.Player()
        self.r = {'on': True, 'frames': ['a', 'b', 'c', 'd'], 'ft': [T0] * 4, 'wx': {'temp': 60, 'icon': 'rain', 'word': 'RAIN'}}
        self.pl.set_payload(payload([], screen='weather', radar=self.r, anim={'radarFrame': 1000, 'radarHold': 2000}), 0)
        self.pl.set_screen('weather', 0)

    def test_newest_is_fetched_first(self):
        self.assertEqual(self.pl.missing_frames(), ['d', 'c', 'b', 'a'])
        self.pl.add_frame('d', self.pl.take_slot())
        self.assertEqual(self.pl.missing_frames(), ['c', 'b', 'a'])

    def test_the_loop_plays_only_frames_on_hand(self):
        # Nothing yet: no loop, and the screen is the conditions screen, not empty radar.
        self.assertEqual(self.pl.radar_idx(0), -1)
        self.assertFalse(self.pl.busy(500))
        f = draw.Frame()
        self.pl.draw(f, 0, T0)
        ref = draw.render(self.pl.p, draw.Frame(), screen='weather', now=T0, frames={})
        self.assertEqual(f.px, ref.px)
        self.assertGreater(sum(1 for v in ref.px if v), 100, 'conditions drawn')
        # Newest only: held.
        self.pl.add_frame('d', self.pl.take_slot())
        self.assertEqual({self.pl.radar_idx(ms) for ms in range(0, 6000, 250)}, {3})
        # A missing frame in the middle is skipped, never shown.
        self.pl.add_frame('a', self.pl.take_slot())
        self.pl.add_frame('b', self.pl.take_slot())
        self.assertEqual([self.pl.radar_idx(ms) for ms in (0, 1000, 2000, 3999, 4000)], [0, 1, 3, 3, 0])
        # A new newest frame not yet downloaded: the loop holds on the last one on hand.
        self.r = dict(self.r, frames=['b', 'c', 'd', 'e'])
        self.pl.set_payload(payload([], screen='weather', radar=self.r, anim={'radarFrame': 1000, 'radarHold': 2000}), 0)
        self.assertEqual(self.pl.missing_frames(), ['e', 'c'])
        self.assertNotIn(3, {self.pl.radar_idx(ms) for ms in range(0, 6000, 250)})


if __name__ == '__main__':
    unittest.main()


class StationChange(unittest.TestCase):
    """A new station starts transit fresh instead of animating from the old
    station's rows to the new one's (they overlapped mid-fade)."""

    def rows(self, lbls):
        return [{'ln': 'RD', 'lbl': l, 't': [T0 + 120 + 60 * i], 's': [0], 'a': 0} for i, l in enumerate(lbls)]

    def test_new_station_drops_the_old_rows_at_once(self):
        pl = player.Player()
        pl.set_payload(payload([], screen='transit', stn='40100', header='MORSE', view='dest', rows=self.rows(['HOWARD', '95TH'])), 0)
        pl.set_screen('transit', 0)
        for ms in range(0, 3000, 50):
            pl.draw(draw.Frame(), ms, T0)
        pl.set_payload(payload([], screen='transit', stn='41320', header='BELMONT', view='dest', rows=self.rows(['KIMBALL', 'LOOP'])), 3000)
        pl.draw(draw.Frame(), 3000, T0)
        self.assertEqual(sorted(k.split(':')[1] for k in pl.anim.rows), ['KIMBALL', 'LOOP'], 'no old rows fading out')
        self.assertFalse(pl.busy(3000 + 2 * draw.FADE_MS + 100))

    def test_same_station_keeps_animating(self):
        pl = player.Player()
        pl.set_payload(payload([], screen='transit', stn='40100', header='MORSE', view='dest', rows=self.rows(['HOWARD', '95TH'])), 0)
        pl.set_screen('transit', 0)
        pl.draw(draw.Frame(), 0, T0)
        anim = pl.anim
        pl.set_payload(payload([], screen='transit', stn='40100', header='MORSE', view='dest', rows=self.rows(['HOWARD'])), 1000)
        self.assertIs(pl.anim, anim)


# Same table as AUTO_CASES in server/board/draw.test.js.
AUTO_CASES = [
    ({'screen': 'transit', 'rot': {'screens': ['transit', 'ticker'], 'every': 60}}, 0, 'transit'),
    ({'screen': 'transit', 'rot': {'screens': ['transit', 'ticker'], 'every': 60}}, 60, 'ticker'),
    ({'screen': 'transit', 'rot': {'screens': ['transit', 'ticker'], 'every': 60}}, 119, 'ticker'),
    ({'screen': 'transit', 'rot': {'screens': ['transit', 'ticker'], 'every': 60}}, 120, 'transit'),
    ({'screen': 'baseball', 'rot': {'screens': ['transit', 'ticker'], 'every': 60}}, 60, 'baseball'),
    ({'screen': 'transit', 'radar': {'on': False, 'visit': {'every': 240, 'for': 60, 'always': True}}}, 10, 'weather'),
    ({'screen': 'transit', 'radar': {'on': False, 'visit': {'every': 240, 'for': 60}}}, 10, 'transit'),
    ({'screen': 'ticker', 'rot': {'screens': ['transit', 'ticker'], 'every': 120}, 'radar': {'on': True, 'visit': {'every': 240, 'for': 60}}}, 30, 'weather'),
    ({'screen': 'ticker', 'rot': {'screens': ['transit', 'ticker'], 'every': 120}, 'radar': {'on': True, 'visit': {'every': 240, 'for': 60}}}, 130, 'ticker'),
    ({'screen': 'weather', 'rot': None}, 0, 'weather'),
]


class AutoScreenTable(unittest.TestCase):
    def test_matches_the_simulator_table(self):
        base = 1800000000 - (1800000000 % 240)
        for p, off, want in AUTO_CASES:
            pl = player.Player()
            pl.p = dict(p)
            self.assertEqual(pl.auto_screen(base + off), want, '%r +%d' % (p, off))
