"""The board's main loop (boardlib/app.py) against a simulated server, clock,
display, and buttons. Requests take simulated time, so these check the
scheduling the real board depends on: fetches land in animation gaps, data
stays fresh, settings changes show up fast, radar frames are fetched only
when needed, and buttons follow "last action wins"."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from boardlib import app, draw, player  # noqa: E402

T0 = 1791140000  # epoch seconds at the start of each simulation
LATENCY = 1500   # ms per request


class Clock:
    def __init__(self):
        self.t = 0

    def ms(self):
        return self.t

    def sleep_ms(self, ms):
        self.t += max(0, int(ms))


class Server:
    """Serves payloads built around a simulated 'now', like /board/update."""

    def __init__(self, clock, board):
        self.clock = clock
        self.board = board  # set after Board exists, for busy/quiet checks
        self.v = 1
        self.screen = 'transit'
        self.radar_on = False
        self.calls = []
        self.fail_next = 0
        self.wifi = ['ok']
        self.visit = None
        self.alert = 0

    def now(self):
        return T0 + self.clock.t / 1000

    def _call(self, name):
        b = self.board[0] if self.board else None
        ms = self.clock.t
        rec = {'name': name, 'ms': ms}
        if b and b.player.p:
            rec['busy'] = b.player.busy(ms)
            rec['quiet'] = b.player.quiet_ms(ms, b.now(ms))
            rec['budget'] = b.sched.budget_ms
            rec['phase'] = (ms - b.player.blink_shift) % 2000
        self.calls.append(rec)
        self.clock.t += LATENCY
        if self.fail_next:
            self.fail_next -= 1
            raise OSError('simulated failure')

    def payload(self):
        now = int(self.now())
        # Trains every ~4 minutes each way, so times roll every minute.
        rows = [
            {'ln': 'RD', 'lbl': 'HOWARD', 't': [now + 75 + k * 240 - (now % 240) for k in range(3)], 's': [0, 0, 0], 'a': self.alert},
            {'ln': 'RD', 'lbl': '95TH', 't': [now + 130 + k * 240 - (now % 240) for k in range(3)], 's': [0, 0, 0], 'a': 0},
        ]
        frames = ['40100-%d' % (now // 300 * 300 - k * 300) for k in range(5, -1, -1)] if self.radar_on else []
        return {
            'v': self.v, 'now': now, 'tzo': -18000, 'age': 3, 'screen': 'radar' if self.radar_on and not self.visit else self.screen,
            'bright': 100, 'header': 'MORSE', 'view': 'dest', 'rows': rows,
            'ticker': [{'ln': 'RD', 'd': 'Howard', 't': t, 's': 0, 'a': 0} for t in rows[0]['t']] +
                      [{'ln': 'RD', 'd': '95th', 't': t, 's': 0, 'a': 0} for t in rows[1]['t']],
            'wx': None, 'warn': None,
            'radar': {'on': self.radar_on, 'visit': self.visit, 'frames': frames, 'ft': [T0] * len(frames), 'clock': [40, 0, 24, 22], 'split': False},
        }

    # net interface
    mac = 'aa:bb:cc:dd:ee:ff'

    def connect(self, networks, status_cb):
        for ssid, _ in networks:
            status_cb('connecting', ssid)
            self.clock.t += 3000
        result = self.wifi.pop(0) if len(self.wifi) > 1 else self.wifi[0]
        if result == 'ok':
            return ('ok', networks[0][0])
        return (result, self.mac if result == 'portal' else None)

    def version(self):
        self._call('version')
        return {'v': self.v, 'now': int(self.now())}

    def update(self, boot):
        self._call('update-boot' if boot else 'update')
        return self.payload()

    def radar(self, fid):
        self._call('radar:' + fid)
        return bytes(2048)


class Display:
    def __init__(self, clock):
        self.clock = clock
        self.statuses = []
        self.frames = 0

    def show(self, fn):
        f = draw.Frame()
        fn(f)
        self.frames += 1
        self.last = f
        self.clock.t += 20  # render cost


class Buttons:
    def __init__(self):
        self.held = {'up': False, 'down': False}

    def up(self):
        return self.held['up']

    def down(self):
        return self.held['down']


def make(wifi=('ok',), buttons=False):
    clock = Clock()
    holder = []
    server = Server(clock, holder)
    server.wifi = list(wifi)
    display = Display(clock)
    btn = Buttons() if buttons else None
    board = app.Board(server, display, clock, [('home', 'pw'), ('phone', 'pw')], buttons=btn, log=lambda *a: None)
    holder.append(board)
    statuses = []
    orig = board._status

    def spy(kind, detail=None):
        statuses.append(kind)
        orig(kind, detail)
    board._status = spy
    return board, server, clock, display, btn, statuses


def run_for(board, clock, ms, every=5):
    end = clock.t + ms
    while clock.t < end:
        board.step()
        clock.sleep_ms(every)


class TestBoardLoop(unittest.TestCase):
    def test_fetches_land_in_gaps_and_data_stays_fresh(self):
        board, server, clock, _, _, _ = make()
        board.connect()
        self.assertEqual(server.calls[0]['name'], 'update-boot')
        run_for(board, clock, 10 * 60 * 1000)
        fetches = [c for c in server.calls[1:] if 'busy' in c]
        self.assertGreater(len(fetches), 50)
        in_gap = [c for c in fetches if not c['busy'] and c['quiet'] >= c['budget']]
        # Nearly every request waits for a gap; a forced one is allowed only
        # past its deadline.
        self.assertGreaterEqual(len(in_gap), len(fetches) - board.stats['forced'])
        self.assertLessEqual(board.stats['forced'], 2)
        # Updates at least once a minute, version checks at least every 30 s.
        updates = [c['ms'] for c in server.calls if c['name'].startswith('update')]
        versions = [c['ms'] for c in server.calls if c['name'] == 'version']
        self.assertLessEqual(max(b - a for a, b in zip(updates, updates[1:])), 62000)
        self.assertLessEqual(max(b - a for a, b in zip(versions, versions[1:])), 32000)
        # The budget learned the request time.
        self.assertTrue(1500 <= board.sched.budget_ms <= 2200, board.sched.budget_ms)

    def test_settings_change_shows_up_fast(self):
        board, server, clock, _, _, _ = make()
        board.connect()
        run_for(board, clock, 15000)
        server.v = 2
        server.screen = 'ticker'
        changed_at = clock.t
        while board.player.screen != 'ticker':
            board.step()
            clock.sleep_ms(5)
            self.assertLess(clock.t - changed_at, 30000, 'phone change took too long')
        self.assertEqual(board.player.p['v'], 2)

    def test_radar_frames_only_on_the_radar_screen_and_once_each(self):
        board, server, clock, _, _, _ = make()
        board.connect()
        run_for(board, clock, 60000)
        self.assertFalse([c for c in server.calls if c['name'].startswith('radar')])
        server.radar_on = True
        server.v = 2
        run_for(board, clock, 90000)
        self.assertEqual(board.player.screen, 'radar')
        got = [c['name'] for c in server.calls if c['name'].startswith('radar')]
        self.assertEqual(len(got), len(set(got)), 'a frame was fetched twice')
        self.assertEqual(board.player.missing_frames(), [])

    def test_buttons_override_until_the_phone_changes_something(self):
        board, server, clock, _, btn, _ = make(buttons=True)
        board.connect()
        run_for(board, clock, 5000)
        btn.held['down'] = True
        run_for(board, clock, 200)
        btn.held['down'] = False
        run_for(board, clock, 200)
        self.assertEqual(board.player.screen, 'ticker')
        run_for(board, clock, 70000)  # several updates, same version
        self.assertEqual(board.player.screen, 'ticker')
        btn.held['up'] = True
        run_for(board, clock, 100)
        btn.held['up'] = False
        run_for(board, clock, 100)
        self.assertEqual(board.player.screen, 'transit')
        btn.held['up'] = True
        run_for(board, clock, 100)
        btn.held['up'] = False
        run_for(board, clock, 100)
        self.assertEqual(board.player.screen, 'radar')  # UP wraps around
        server.v = 5  # a phone change: the board follows the server again
        run_for(board, clock, 30000)
        self.assertEqual(board.player.screen, 'transit')

    def test_status_screens_and_retry(self):
        board, server, clock, _, _, statuses = make(wifi=('nowifi', 'portal', 'ok'))
        board.connect()
        self.assertEqual([s for s in statuses if s != 'connecting'], ['nowifi', 'portal', 'ok'])
        self.assertEqual(server.calls[-1]['name'], 'update-boot')

    def test_reconnects_after_repeated_failures(self):
        board, server, clock, _, _, statuses = make()
        board.connect()
        run_for(board, clock, 20000)
        n = len(statuses)
        server.fail_next = 3
        run_for(board, clock, 60000)
        self.assertIn('connecting', statuses[n:])
        names = [c['name'] for c in server.calls]
        self.assertEqual(names.count('update-boot'), 1)  # only the real boot resets overrides
        self.assertTrue(board.player.p)

    def test_fetches_start_as_the_alert_blink_turns_on(self):
        board, server, clock, _, _, _ = make()
        server.alert = 1
        board.connect()
        run_for(board, clock, 5 * 60 * 1000)
        fetches = [c for c in server.calls[1:] if 'phase' in c]
        self.assertGreater(len(fetches), 30)
        off_beat = [c for c in fetches if not 1000 <= c['phase'] < 1200]
        self.assertLessEqual(len(off_beat), board.stats['forced'])
        self.assertLessEqual(board.stats['forced'], 2)
        # Data still stays fresh while blinking.
        updates = [c['ms'] for c in server.calls if c['name'].startswith('update')]
        self.assertLessEqual(max(b - a for a, b in zip(updates, updates[1:])), 62000)

    def test_blink_restarts_off_after_a_fetch(self):
        board, server, clock, _, _, _ = make()
        server.alert = 1
        board.connect()
        run_for(board, clock, 40000)
        p = board.player
        self.assertTrue(p.blinking())
        # Right after a fetch ends the blink is in its off phase.
        ended = p.blink_shift
        self.assertFalse(p.blink_on(ended + 10))
        self.assertTrue(p.blink_on(ended + 1010))

    def test_time_follows_the_server(self):
        board, server, clock, _, _, _ = make()
        board.connect()
        run_for(board, clock, 45000)
        self.assertAlmostEqual(board.now(clock.t), server.now(), delta=2)


class TestRadarVisits(unittest.TestCase):
    def test_auto_visits_the_radar_on_a_timer_and_prefetches_frames(self):
        board, server, clock, _, _, _ = make()
        server.radar_on = True
        server.visit = {'every': 240, 'for': 60}
        board.connect()
        screens = []
        for _ in range(int(10 * 60 * 1000 / 50)):
            board.step()
            screens.append((int(board.now(clock.t)) % 240, board.player.screen))
            clock.sleep_ms(50)
        # Radar exactly in the first 60 s of each 240 s cycle (a few seconds of
        # slack at the edges for the 30 s update cadence).
        for phase, scr in screens:
            if 3 <= phase < 57:
                self.assertEqual(scr, 'radar', phase)
            elif 63 <= phase < 237:
                self.assertEqual(scr, 'transit', phase)
        self.assertEqual(board.player.missing_frames(), [])  # fetched before the visit

    def test_buttons_beat_the_timer(self):
        board, server, clock, _, btn, _ = make(buttons=True)
        server.radar_on = True
        server.visit = {'every': 240, 'for': 60}
        board.connect()
        run_for(board, clock, 2000)
        btn.held['down'] = True
        run_for(board, clock, 200)
        btn.held['down'] = False
        pressed = board.player.screen
        run_for(board, clock, 200000)  # many cycles, same settings version
        self.assertEqual(board.player.screen, pressed)

    def test_no_visits_without_rain_or_when_off(self):
        board, server, clock, _, _, _ = make()
        server.radar_on = False
        server.visit = {'every': 240, 'for': 60}
        board.connect()
        run_for(board, clock, 5 * 60 * 1000)
        self.assertEqual(board.player.screen, 'transit')
        self.assertFalse([c for c in server.calls if c['name'].startswith('radar')])


class TestPlayerTiming(unittest.TestCase):
    def test_quiet_until_the_next_minute_boundary(self):
        now = T0
        p = {'now': now, 'tzo': 0, 'header': None, 'view': 'dest', 'wx': None,
             'rows': [{'ln': 'RD', 'lbl': 'HOWARD', 't': [now + 125], 's': [0], 'a': 0}]}
        # 125 s out shows 3; it becomes 2 at 120 s out, i.e. in 5 s.
        self.assertEqual(player.transit_quiet_ms(p, now), 5000)
        # At DUE (40 s out), the next change is the drop 30 s after arrival.
        self.assertEqual(player.transit_quiet_ms(p, now + 85), 70000)


if __name__ == '__main__':
    unittest.main()
