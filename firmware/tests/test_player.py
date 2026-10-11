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

    def test_the_loop_holds_until_the_set_is_complete(self):
        # Nothing yet: no loop, and the screen is the conditions screen, not empty radar.
        self.assertEqual(self.pl.radar_idx(0), -1)
        self.assertFalse(self.pl.busy(500))
        f = draw.Frame()
        self.pl.draw(f, 0, T0)
        ref = draw.render(self.pl.p, draw.Frame(), screen='weather', now=T0, frames={})
        self.assertEqual(f.px, ref.px)
        self.assertGreater(sum(1 for v in ref.px if v), 100, 'conditions drawn')
        # Filling in newest first: a still frame on the newest (never stepping
        # back in time), and nothing animating, so fetches run back to back.
        for k, fid in enumerate(self.pl.missing_frames()[:-1]):
            self.pl.add_frame(fid, self.pl.take_slot(), 1000 * k)
            self.assertEqual({self.pl.radar_idx(ms) for ms in range(0, 9000, 250)}, {3})
            self.assertFalse(self.pl.busy(1500))
        # The last frame restarts the loop at its oldest frame.
        self.pl.add_frame('a', self.pl.take_slot(), 7000)
        self.assertEqual([self.pl.radar_idx(ms) for ms in (7000, 8000, 9000, 10000, 11999, 12000)], [0, 1, 2, 3, 3, 0])
        self.assertTrue(self.pl.busy(7500))
        # A new newest frame not yet downloaded: hold on the last one on hand.
        self.r = dict(self.r, frames=['b', 'c', 'd', 'e'])
        self.pl.set_payload(payload([], screen='weather', radar=self.r, anim={'radarFrame': 1000, 'radarHold': 2000}), 0)
        self.assertEqual(self.pl.missing_frames(), ['e'])
        self.assertEqual({self.pl.radar_idx(ms) for ms in range(13000, 20000, 250)}, {2})
        self.pl.add_frame('e', self.pl.take_slot(), 20000)
        self.assertEqual([self.pl.radar_idx(ms) for ms in (20000, 23000)], [0, 3])

class RainTurns(unittest.TestCase):
    """Both (rain.loops, rain.alt): the loop plays `loops` full cycles, then the bars show for alt s."""
    def setUp(self):
        self.pl = player.Player()
        rain = {'h': [5] * 8, 'l': [2] * 8, 'title': 'RAIN NEXT 2 HRS', 'snow': 0, 'alt': 20, 'loops': 2}
        r = {'on': True, 'frames': ['a', 'b', 'c', 'd'], 'ft': [T0] * 4,
             'wx': {'temp': 60, 'icon': 'rain', 'word': 'RAIN', 'rain': rain}}
        self.pl.set_payload(payload([], screen='weather', radar=r, anim={'radarFrame': 1000, 'radarHold': 2000}), 0)
        self.pl.set_screen('weather', 0)
        for fid in ['a', 'b', 'c', 'd']:
            self.pl.add_frame(fid, self.pl.take_slot(), 0)  # the set completes at 0: the loop starts there

    def test_two_loops_then_bars_then_the_loop_again(self):
        # A 5 s cycle (3 steps + the 2 s hold): 2 loops are 10 s, then 20 s of bars.
        self.assertFalse(self.pl.rain_bars(9999))
        self.assertTrue(self.pl.rain_bars(10000))
        self.assertTrue(self.pl.rain_bars(29999))
        self.assertFalse(self.pl.rain_bars(30000))

    def test_the_loop_is_never_cut_off_and_bars_are_not_busy(self):
        self.assertTrue(self.pl.busy(5500))          # loop 2 steps (5 s cycle, 3 steps then the hold)
        self.assertFalse(self.pl.busy(9999))         # loop 2's hold: the bars come after it, not mid-loop
        self.assertFalse(self.pl.busy(10500))        # bars: nothing animates
        self.assertEqual(self.pl.quiet_ms(10000, T0), 20000)  # the gap is the bars

    def test_the_drawn_bars_match_the_reference_renderer(self):
        f = draw.Frame()
        self.pl.draw(f, 12000, T0)
        ref = draw.render(self.pl.p, draw.Frame(), screen='weather', now=T0, t=12000, frames=self.pl.radar_frames)
        self.assertEqual(f.px, ref.px)


class NumberRolls(unittest.TestCase):
    """Clocks and weather numbers roll when they change (NumRoller)."""

    def setUp(self):
        self.t = T0 - T0 % 60 + 50   # 10 s before a minute rolls over
        self.pl = player.Player()
        self.pl.set_payload(payload([], screen='transit', now=self.t, header='MORSE',
                                    rows=[{'ln': 'RD', 'lbl': 'HOWARD', 't': [self.t + 3600], 's': [0], 'a': 0}]), 0)
        self.pl.set_screen('transit', 0)

    def draw(self, ms):
        return self.pl.draw(draw.Frame(), ms, self.t + ms // 1000)

    def test_the_clock_rolls_at_the_minute_and_settles(self):
        self.draw(0)
        self.assertFalse(self.pl.busy(0))
        # The next minute is the next animation: fetches wait for a gap before it.
        self.assertEqual(self.pl.quiet_ms(0, self.t), 10000)
        self.draw(10000)   # first frame of the new minute starts the roll
        mid = self.draw(10000 + draw.ROLL_MS // 2)
        self.assertTrue(self.pl.busy(10000 + draw.ROLL_MS // 2))
        self.assertIsNone(self.pl.frame_key(10000 + draw.ROLL_MS // 2, self.t + 10))
        done = self.draw(10000 + draw.ROLL_MS + 10)
        self.assertFalse(self.pl.busy(10000 + draw.ROLL_MS + 10))
        still = draw.render(self.pl.p, draw.Frame(), screen='transit', now=self.t + 10)
        self.assertEqual(bytes(done.px), bytes(still.px))
        self.assertNotEqual(bytes(mid.px), bytes(done.px))

    def test_no_roll_across_a_screen_change(self):
        self.draw(0)
        self.pl.set_screen('ticker', 9000)
        self.pl.draw(draw.Frame(), 10000, self.t + 10)
        self.assertFalse(self.pl.busy(10000))

    def test_a_new_temperature_rolls(self):
        wx = {'icon': 'sun', 'temp': 63, 'word': 'SUNNY'}
        self.pl.set_payload(dict(self.pl.p, wx=wx), 0)
        self.draw(0)
        self.pl.set_payload(dict(self.pl.p, wx=dict(wx, temp=64)), 2000)
        self.draw(2000)
        self.assertTrue(self.pl.busy(2100))

    def test_no_clock_no_minute_gap(self):
        self.pl.set_payload(dict(self.pl.p, header=None), 0)
        self.draw(0)
        self.assertFalse(self.pl.nums.clock())


class RollStackAndMetrics(unittest.TestCase):
    """The board's Python stack is small (pystack exhausted on the header
    clock once); a roll must draw no deeper than the same text drawn still."""

    def test_roll_metrics_match_the_fonts(self):
        from boardlib import assets
        for font, want in draw.ROLL_FONT.items():
            d = assets.FONT_DATA[font]
            t0, t1 = 99, -99
            for cp in range(48, 58):
                o = draw.glyph(font, cp)
                h, yo = d[o + 2], d[o + 4] - 128
                for r in range(h):
                    if draw.glyph_row(d, o, r):
                        t0, t1 = min(t0, r - (yo + h)), max(t1, r - (yo + h))
            self.assertEqual(want, (t1 - t0 + 2, t0, t1), font)

    def test_a_rolling_clock_draws_no_deeper_than_a_still_one(self):
        import inspect

        class DepthFrame(draw.Frame):
            deepest = 0

            def text(self, *a):
                DepthFrame.deepest = max(DepthFrame.deepest, len(inspect.stack(0)))
                return draw.Frame.text(self, *a)

        t = T0 - T0 % 60
        p = payload([], screen='transit', now=t, header='MORSE', wx={'icon': 'sun', 'temp': 63, 'word': 'SUNNY'},
                    rows=[{'ln': 'RD', 'lbl': 'HOWARD', 't': [t + 3600], 's': [0], 'a': 0}])
        depth = {}
        for name, nums in (('still', None), ('roll', {'hdr.clock': {'from': '11:59', 'p': 0.5}, 'row.temp': {'from': '9°', 'p': 0.5}})):
            DepthFrame.deepest = 0
            draw.render(p, DepthFrame(), screen='transit', now=t, nums=nums)
            depth[name] = DepthFrame.deepest
        self.assertLessEqual(depth['roll'], depth['still'])


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
