"""The board's main loop (boardlib/app.py) against a simulated server, clock,
display, and buttons. Requests take simulated time, so these check the
scheduling the real board depends on: fetches land in animation gaps, data
stays fresh, settings changes show up fast, radar frames are fetched only
when needed, and buttons follow "last action wins"."""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))
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
        self.radar_oom = 0
        self.health = []
        self.update_screens = []
        self.games = None  # fn(now) -> mlb games, replacing the one live game
        self.wifi = ['ok']
        self.visit = None
        self.alert = 0
        self.layout = 'classic'
        self.latency = lambda: LATENCY

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
        self.clock.t += self.latency()
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
        frames = ['40100-%d' % (now // 360 * 360 - k * 360) for k in range(player.RADAR_SLOTS - 1, -1, -1)] if self.radar_on else []
        return {
            'v': self.v, 'now': now, 'tzo': -18000, 'age': 3, 'screen': 'weather' if self.radar_on and not self.visit else self.screen,
            'bright': 100, 'header': 'MORSE', 'view': 'dest', 'rows': rows,
            'ticker': [{'ln': 'RD', 'd': 'Howard', 't': t, 's': 0, 'a': 0} for t in rows[0]['t']] +
                      [{'ln': 'RD', 'd': '95th', 't': t, 's': 0, 'a': 0} for t in rows[1]['t']],
            'wx': None, 'warn': None,
            'radar': {'on': self.radar_on, 'visit': self.visit, 'frames': frames, 'ft': [T0] * len(frames), 'timeBox': [40, 0, 24, 22], 'split': False},
            'mlb': {'layout': self.layout, 'games': self.games(now) if self.games else [{
                'id': 1, 'st': 'live', 'start': now - 3600, 'inn': 3, 'half': 'T', 'b': 0, 's': 0, 'o': 0, 'on': [0, 0, 0],
                'away': {'ab': 'CHC', 'c': '#2a5bd8', 'r': 1, 'lg': 'CHC-1' if self.layout == 'logos' else None, 'bd': '#204882'},
                'home': {'ab': 'STL', 'c': '#d62a2a', 'r': 0, 'lg': 'STL-1' if self.layout == 'logos' else None, 'bd': '#c12626'},
            }]},
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

    def version(self, health=''):
        self._call('version')
        self.health.append(health)
        return {'v': self.v, 'now': int(self.now())}

    def update(self, boot, screen=None):
        self._call('update-boot' if boot else 'update')
        self.update_screens.append(screen)
        return self.payload()

    def radar(self, fid, buf):
        self._call('radar:' + fid)
        if self.radar_oom:
            self.radar_oom -= 1
            raise MemoryError('memory allocation failed, allocating 2049 bytes')
        buf[:] = bytes([int(fid.rsplit('-', 1)[1]) % 251 + 1]) * len(buf)

    def logo(self, lid, buf):
        self._call('logo:' + lid)
        buf[:] = bytes([sum(lid.encode()) % 251 + 1]) * len(buf)


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
        self.assertEqual(board.player.screen, 'weather')
        got = [c['name'] for c in server.calls if c['name'].startswith('radar')]
        self.assertEqual(len(got), len(set(got)), 'a frame was fetched twice')
        self.assertEqual(board.player.missing_frames(), [])

    def test_radar_frames_reuse_six_preallocated_buffers(self):
        # A fragmented heap can't fit a fresh 2 KB frame, so frames go into
        # buffers allocated at startup, recycled as the loop moves on.
        board, server, clock, _, _, _ = make()
        pool = {id(b) for b in board.player.radar_free}
        self.assertEqual(len(pool), player.RADAR_SLOTS)
        server.radar_on = True
        board.connect()
        run_for(board, clock, 40 * 60 * 1000)  # the loop turns over 3+ times
        got = [c['name'] for c in server.calls if c['name'].startswith('radar')]
        self.assertGreaterEqual(len(got), 2 * player.RADAR_SLOTS)
        self.assertEqual(board.player.missing_frames(), [])
        held = board.player.radar_frames
        self.assertEqual({id(b) for b in held.values()} | {id(b) for b in board.player.radar_free}, pool)
        for fid, buf in held.items():
            self.assertEqual(len(buf), player.RADAR_BYTES)
            self.assertEqual(buf[0], int(fid.rsplit('-', 1)[1]) % 251 + 1, 'frame %s holds stale data' % fid)

    def test_radar_loop_fills_in_back_to_back(self):
        # After the first frame, the rest follow right away instead of one
        # per loop cycle (ran() used to push each to the next gap).
        board, server, clock, _, _, _ = make()
        board.connect()
        run_for(board, clock, 30000)
        server.radar_on = True
        server.v = 2
        run_for(board, clock, 60000)
        fetches = [c['ms'] for c in server.calls if c['name'].startswith('radar')]
        # (Plus one more if the 6-minute grid stepped during the run.)
        self.assertIn(len(fetches), (player.RADAR_SLOTS, player.RADAR_SLOTS + 1))
        fill = fetches[:player.RADAR_SLOTS]
        self.assertLess(fill[-1] - fill[0], player.RADAR_SLOTS * (LATENCY + 500))

    def test_radar_memory_error_is_retried_without_reconnecting(self):
        board, server, clock, _, _, statuses = make()
        server.radar_on = True
        board.connect()
        connects = statuses.count('connecting')
        server.radar_oom = 5
        run_for(board, clock, 90000)
        self.assertEqual(statuses.count('connecting'), connects, 'a MemoryError reconnected WiFi')
        self.assertEqual(server.radar_oom, 0)
        self.assertEqual(board.player.missing_frames(), [])
        self.assertEqual(len(board.player.radar_frames) + len(board.player.radar_free), player.RADAR_SLOTS)

    def test_logos_only_on_the_baseball_screen_and_once_each(self):
        board, server, clock, _, _, _ = make()
        server.layout = 'logos'
        board.connect()
        run_for(board, clock, 60000)
        self.assertFalse([c for c in server.calls if c['name'].startswith('logo')])  # transit: none
        server.screen = 'baseball'
        server.v = 2
        run_for(board, clock, 90000)
        self.assertEqual(board.player.screen, 'baseball')
        got = [c['name'] for c in server.calls if c['name'].startswith('logo')]
        self.assertEqual(sorted(got), ['logo:CHC-1', 'logo:STL-1'])
        self.assertEqual(board.player.missing_logos(board.now(clock.t)), [])
        server.layout = 'bands'  # bands use no logos: the cache empties
        server.v = 3
        run_for(board, clock, 30000)
        self.assertEqual(board.player.logos, {})

    def test_logos_hold_the_current_and_next_game_in_four_slots(self):
        # Three pregame games rotate a minute each. The board holds the one
        # on screen and the next (fetched ahead), never more than 4 logos.
        board, server, clock, _, _, _ = make()
        server.layout = 'logos'
        server.screen = 'baseball'
        teams = [('CHC', 'STL'), ('CWS', 'CLE'), ('NYY', 'BOS')]

        def games(now):
            return [{'id': i + 1, 'st': 'pre', 'start': now + 3600,
                     'away': {'ab': a, 'c': '#2a5bd8', 'r': 0, 'lg': a + '-1', 'bd': '#204882'},
                     'home': {'ab': h, 'c': '#d62a2a', 'r': 0, 'lg': h + '-1', 'bd': '#c12626'}}
                    for i, (a, h) in enumerate(teams)]
        server.games = games
        pool = {id(b) for b in board.player.logo_free}
        self.assertEqual(len(pool), player.LOGO_SLOTS)
        board.connect()
        shown_without_logos = 0
        for _ in range(5 * 60 * 20):  # 5 minutes in 50 ms steps
            board.step()
            clock.sleep_ms(50)
            now = board.now(clock.t)
            gm = draw.pick_game(board.player.p['mlb']['games'], now)
            on_screen = [gm_side['lg'] for gm_side in (board.player.p['mlb']['games'][gm['i']]['away'], board.player.p['mlb']['games'][gm['i']]['home'])]
            if any(lg not in board.player.logos for lg in on_screen) and clock.t > 20000:
                shown_without_logos += 1
            self.assertLessEqual(len(board.player.logos), player.LOGO_SLOTS)
        # After the first fetches, a rotation never shows a game without its logos.
        self.assertEqual(shown_without_logos, 0)
        self.assertEqual({id(b) for b in board.player.logos.values()} | {id(b) for b in board.player.logo_free}, pool)
        for lid, buf in board.player.logos.items():
            self.assertEqual(buf[0], sum(lid.encode()) % 251 + 1, 'slot %s holds stale data' % lid)

    def test_a_draw_memory_error_skips_the_frame_instead_of_crashing(self):
        board, server, clock, display, _, _ = make()
        board.connect()
        real = display.show
        fails = [3]

        def flaky(fn):
            if fails[0]:
                fails[0] -= 1
                raise MemoryError('memory allocation failed, allocating 640 bytes')
            real(fn)
        display.show = flaky
        run_for(board, clock, 5000)
        self.assertEqual(fails[0], 0)
        self.assertEqual(board.stats['oom'], 3)
        self.assertGreater(board.stats['draws'], 0, 'drawing resumed')

    def test_a_memory_error_elsewhere_in_the_loop_skips_the_pass(self):
        board, server, clock, _, _, _ = make()
        board.connect()
        real = board.player.frame_key
        fails = [3]

        def flaky(ms, now):
            if fails[0]:
                fails[0] -= 1
                raise MemoryError('memory allocation failed, allocating 200 bytes')
            return real(ms, now)
        board.player.frame_key = flaky
        run_for(board, clock, 5000)
        self.assertEqual(fails[0], 0)
        self.assertEqual(board.stats['oom'], 3)
        self.assertGreater(board.stats['draws'], 0, 'the loop carried on')

    def test_a_loop_that_never_recovers_still_restarts(self):
        board, server, clock, _, _, _ = make()
        board.connect()

        def broken(ms, now):
            raise MemoryError('memory allocation failed')
        board.player.frame_key = broken
        with self.assertRaises(MemoryError):
            run_for(board, clock, 60000)

    def test_other_loop_errors_still_reach_code_py(self):
        board, server, clock, _, _, _ = make()
        board.connect()

        def broken(ms, now):
            raise KeyError('rows')
        board.player.frame_key = broken
        with self.assertRaises(KeyError):
            run_for(board, clock, 1000)

    def test_a_draw_that_never_recovers_still_restarts(self):
        board, server, clock, display, _, _ = make()
        board.connect()

        def broken(fn):
            raise MemoryError('memory allocation failed')
        display.show = broken
        with self.assertRaises(MemoryError):
            run_for(board, clock, 60000)

    def test_a_button_press_fetches_the_new_screens_sections_right_away(self):
        board, server, clock, _, btn, _ = make(buttons=True)
        board.connect()
        run_for(board, clock, 40000)
        before = len(server.update_screens)
        btn.held['down'] = True
        run_for(board, clock, 100)
        btn.held['down'] = False
        pressed_at = clock.t
        while len(server.update_screens) == before:
            board.step()
            clock.sleep_ms(5)
            self.assertLess(clock.t - pressed_at, 3000, 'no update after the press')
        self.assertEqual(server.update_screens[-1], board.player.screen)
        self.assertEqual(server.update_screens[-1], 'ticker')

    def test_health_rides_on_the_version_check_once_a_minute(self):
        board, server, clock, _, _, _ = make()
        board.mem_free = lambda: 26000
        board.largest_block = lambda: 4032
        board.connect()
        server.fail_next = 1
        run_for(board, clock, 150000)
        sent = [h for h in server.health if h]
        self.assertTrue(all(h.startswith('&hu=') for h in sent))
        self.assertIn('&hm=26000', sent[-1])
        self.assertIn('&hl=4032', sent[-1])
        self.assertIn('&hf=1', sent[-1])
        self.assertTrue(sent[-1].endswith('&he=version:OSError') or '&he=update:OSError' in sent[-1], sent[-1])
        self.assertLessEqual(len(set(sent)), 4, 'rebuilt at most once a minute')

    def test_health_uptime_counts_from_this_run_and_names_the_last_crash(self):
        # time.monotonic() keeps going through code.py's reload: a run that
        # starts at 1 h of monotonic time still reports its own uptime.
        clock = Clock()
        clock.t = 3600000
        holder = []
        server = Server(clock, holder)
        board = app.Board(server, Display(clock), clock, [('home', 'pw')], log=lambda *a: None,
                          started='SUPERVISOR_RELOAD', crash='MemoryError:player:312:quiet_ms')
        holder.append(board)
        board.connect()
        run_for(board, clock, 70000)
        sent = [h for h in server.health if h][-1]
        uptime = int(sent.split('&hu=')[1].split('&')[0])
        self.assertLess(uptime, 120)
        self.assertIn('&hs=SUPERVISOR_RELOAD', sent)
        self.assertIn('&hc=MemoryError:player:312:quiet_ms', sent)

    def test_live_games_update_faster(self):
        board, server, clock, _, _, _ = make()
        board.connect()
        run_for(board, clock, 60000)
        self.assertEqual(board.update_job.interval_ms, app.UPDATE_EVERY)  # transit
        server.screen = 'baseball'
        server.v = 2
        run_for(board, clock, 20000)
        start = clock.t
        run_for(board, clock, 120000)
        updates = [c['ms'] for c in server.calls if c['name'] == 'update' and c['ms'] >= start]
        self.assertGreaterEqual(len(updates), 9)
        self.assertLessEqual(max(b - a for a, b in zip(updates, updates[1:])), 15000)

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
        self.assertEqual(board.player.screen, 'baseball')  # UP wraps around
        server.v = 5  # a phone change: the board follows the server again
        run_for(board, clock, 30000)
        self.assertEqual(board.player.screen, 'transit')

    def test_status_screens_and_retry(self):
        board, server, clock, _, _, statuses = make(wifi=('nowifi', 'portal', 'ok'))
        board.connect()
        self.assertEqual([s for s in statuses if s != 'connecting'], ['nowifi', 'portal', 'ok'])
        self.assertEqual(server.calls[-1]['name'], 'update-boot')

    def test_first_retries_come_quickly(self):
        board, server, clock, _, _, statuses = make(wifi=('nowifi', 'nowifi', 'nowifi', 'nowifi', 'ok'))
        start = clock.t
        board.connect()
        # 10 + 20 + 30 + 60 s of waiting, plus 6 s of simulated joins per round.
        self.assertLess(clock.t - start, 160000)  # was 270 s at a flat minute
        self.assertGreater(clock.t - start, 120000)

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

    def test_syncs_never_set_the_clock_back_while_it_is_right(self):
        board, server, clock, _, _, _ = make()
        lat = [400, 2600, 900, 1800, 300, 3100, 1200]
        n = [0]

        def latency():
            n[0] += 1
            return lat[n[0] % len(lat)]
        server.latency = latency
        board.connect()
        last = board.now_ms(clock.t)
        for _ in range(int(5 * 60 * 1000 / 5)):
            board.step()
            t = board.now_ms(clock.t)
            self.assertGreaterEqual(t, last)
            self.assertLess(abs(t - server.now() * 1000), 3500)
            last = t
            clock.sleep_ms(5)

    def test_a_drifting_clock_is_pulled_back_in(self):
        board, server, clock, _, _, _ = make()
        board.connect()
        board.epoch_ms += 20000  # 20 s fast
        run_for(board, clock, 15000)
        self.assertLess(abs(board.now_ms(clock.t) - server.now() * 1000), 3000)
        board.epoch_ms -= 40000  # 20 s slow
        run_for(board, clock, 15000)
        self.assertLess(abs(board.now_ms(clock.t) - server.now() * 1000), 3000)

    def test_idle_screens_redraw_only_when_something_changes(self):
        board, server, clock, display, _, _ = make()
        board.connect()
        run_for(board, clock, 5000)
        start = display.frames
        run_for(board, clock, 5 * 60 * 1000)
        per_s = (display.frames - start) / 300
        # Was 4 a second plus animations; now about one a second (the
        # clock's seconds) plus the animation frames.
        self.assertLess(per_s, 2, per_s)
        self.assertGreater(per_s, 0.9, per_s)


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
                self.assertEqual(scr, 'weather', phase)
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

    def test_the_cached_quiet_time_matches_a_fresh_one_every_second(self):
        now = T0
        rows = [{'ln': 'RD', 'lbl': 'HOWARD', 't': [now + 125, now + 400, now + 700], 's': [0, 0, 1], 'a': 0},
                {'ln': 'RD', 'lbl': '95TH', 't': [now + 15, now + 290], 's': [0, 0], 'a': 0},
                {'ln': 'PR', 'lbl': 'LINDEN', 't': [now + 61], 's': [1], 'a': 0}]
        for view in ('dest', 'chrono'):
            pl = player.Player()
            pl.set_payload({'now': now, 'tzo': 0, 'header': None, 'view': view, 'wx': None, 'rows': rows}, 0)
            for s in range(0, 800):
                self.assertEqual(pl.quiet_ms(0, now + s), player.transit_quiet_ms(pl.p, now + s), (view, s))
            self.assertEqual(pl.quiet_ms(0, now + 800), player.FAR, 'every train gone')

    def test_the_transit_view_is_not_rebuilt_every_loop_pass(self):
        board, server, clock, _, _, _ = make()
        board.connect()
        builds = [0]
        real = draw.build_transit_view

        def counting(p, now):
            builds[0] += 1
            return real(p, now)
        draw.build_transit_view = counting
        try:
            run_for(board, clock, 60000)
        finally:
            draw.build_transit_view = real
        # Draws build their own (the animator); the quiet time used to add
        # one per loop pass (~12,000 here).
        self.assertLess(builds[0], board.stats['draws'] + 100)


class StrictMath:
    """math as CircuitPython runs it: floor and ceil go through a float with
    22 bits of precision, so they're only exact for smaller numbers."""

    def __getattr__(self, name):
        return getattr(math, name)

    @staticmethod
    def floor(x):
        assert abs(x) < 2 ** 21, 'math.floor(%r) loses precision on CircuitPython' % (x,)
        return math.floor(x)

    @staticmethod
    def ceil(x):
        assert abs(x) < 2 ** 21, 'math.ceil(%r) loses precision on CircuitPython' % (x,)
        return math.ceil(x)


class TestCircuitPythonNumbers(unittest.TestCase):
    def setUp(self):
        self.saved = draw.math
        draw.math = StrictMath()

    def tearDown(self):
        draw.math = self.saved

    def test_epoch_times_stay_exact_on_every_screen(self):
        board, server, clock, _, _, _ = make()
        server.radar_on = True
        server.visit = {'every': 120, 'for': 30}
        board.connect()
        self.assertIsInstance(board.now(clock.t), int)
        for screen in ('transit', 'ticker', 'weather', 'baseball'):
            board.player.set_screen(screen, clock.t)
            run_for(board, clock, 70000)
        g = {'id': 1, 'st': 'live', 'start': T0, 'inn': 7, 'half': 'T', 'b': 2, 's': 1, 'o': 2, 'on': [1, 0, 1],
             'away': {'ab': 'CHC', 'c': '#2a5bd8', 'r': 3, 'w': 92, 'l': 70, 'at': T0},
             'home': {'ab': 'STL', 'c': '#d62a2a', 'r': 2, 'w': 88, 'l': 74}}
        board.player.p = dict(board.player.p, mlb={'games': [g, dict(g, id=2, st='pre')]})
        run_for(board, clock, 70000)


class TestColdBoot(unittest.TestCase):
    def boot(self, run_reason, reset_reason):
        import types
        import fakehw
        fakehw.install()
        sup = types.ModuleType('supervisor')
        sup.RunReason = types.SimpleNamespace(STARTUP=0, AUTO_RELOAD=1, SUPERVISOR_RELOAD=2, REPL_RELOAD=3)
        sup.runtime = types.SimpleNamespace(run_reason=getattr(sup.RunReason, run_reason))
        mc = types.ModuleType('microcontroller')
        mc.ResetReason = types.SimpleNamespace(POWER_ON=0, RESET_PIN=1, WATCHDOG=2, BROWNOUT=3, SOFTWARE=4)
        mc.cpu = types.SimpleNamespace(reset_reason=getattr(mc.ResetReason, reset_reason))
        sys.modules['supervisor'] = sup
        sys.modules['microcontroller'] = mc
        from boardlib import device
        return device.cold_boot()

    def tearDown(self):
        sys.modules.pop('supervisor', None)
        sys.modules.pop('microcontroller', None)

    def test_power_on_and_reset_button_reset_the_brightness(self):
        self.assertTrue(self.boot('STARTUP', 'POWER_ON'))
        self.assertTrue(self.boot('STARTUP', 'RESET_PIN'))

    def test_crash_reloads_and_watchdog_resets_do_not(self):
        self.assertFalse(self.boot('SUPERVISOR_RELOAD', 'POWER_ON'))
        self.assertFalse(self.boot('AUTO_RELOAD', 'POWER_ON'))
        self.assertFalse(self.boot('STARTUP', 'WATCHDOG'))


if __name__ == '__main__':
    unittest.main()
