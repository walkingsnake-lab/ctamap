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
        self.assertEqual(self.pl.auto_screen(t + 10), 'radar')
        self.assertEqual(self.pl.auto_screen(t + 100), 'baseball')

    def test_tornado_warning_blinks_on_radar_and_the_weather_row(self):
        pl = player.Player()
        tor = {'kind': 'tor', 'lvl': 'warning'}
        pl.set_payload(payload([], screen='radar', warn=tor), 0)
        pl.set_screen('radar', 0)
        self.assertTrue(pl.blinking())
        pl.set_payload(payload([], screen='radar', warn={'kind': 'tor', 'lvl': 'watch'}), 0)
        self.assertFalse(pl.blinking())
        pl.set_payload(payload([], screen='transit', warn=tor, wx={'icon': 'storm', 'temp': 54, 'word': 'STORMS'}), 0)
        pl.set_screen('transit', 0)
        self.assertTrue(pl.blinking())
        pl.set_payload(payload([], screen='transit', warn=tor), 0)  # weather row hidden
        self.assertFalse(pl.blinking())


if __name__ == '__main__':
    unittest.main()
