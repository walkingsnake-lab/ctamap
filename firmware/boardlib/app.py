# The board's main loop: connects, keeps the payload fresh, and draws.
#
# Board takes its hardware as plain objects so the whole loop can run under
# CPython against a fake network and clock (firmware/tests/test_app.py):
#   net      - connect(networks, status) / ping() / version(health) / update(boot, screen)
#              / radar(frame_id, buf) / logo(logo_id, buf) (fill buf) / mac;
#              raises on failure
#   display  - show(draw_fn): draw_fn(frame) fills a fresh frame, then it's shown
#   clock    - ms(): monotonic milliseconds (int)
#   buttons  - up() / down(): True while held (optional)
#   watchdog - feed() (optional)

import gc

from . import draw
from . import status
from .control import ScreenOverride, Debounce
from .player import Player
from .sched import Scheduler, Job

VERSION_EVERY = 10000   # settings version check (spec: ~10 s)
UPDATE_EVERY = 30000    # combined update (spec: ~30 s)
LIVE_EVERY = 10000      # combined update while a live game is on screen
RADAR_EVERY = 3000      # one missing radar frame per run
LOGO_EVERY = 3000       # one missing team logo per run (baseball logo layout)
FAILS_BEFORE_RECONNECT = 3
HEALTH_EVERY = 60000    # ms between health snapshots sent with the version check
OOM_STREAK_MAX = 50     # draws in a row that hit MemoryError before giving up (restart)
RETRY_WIFI_MS = (10000, 20000, 30000, 60000)  # waits between rounds, then every minute


class Board:
    def __init__(self, net, display, clock, networks, buttons=None, watchdog=None, log=print, mem_free=None):
        self.net = net
        self.display = display
        self.clock = clock
        self.networks = networks
        self.buttons = buttons
        self.watchdog = watchdog
        self.log = log
        self.player = Player()
        self.override = ScreenOverride()
        self.up = Debounce()
        self.down = Debounce()
        self.sync_ms = 0
        self.epoch_ms = 0
        self.synced = False
        self.fails = 0
        self.online = False
        self.last_draw = -1
        self.last_key = None
        self.sched = Scheduler()
        self.version_job = self.sched.add(Job('version', VERSION_EVERY, 20000, self._version))
        self.update_job = self.sched.add(Job('update', UPDATE_EVERY, 30000, self._update))
        self.radar_job = self.sched.add(Job('radar', RADAR_EVERY, 120000, self._radar))
        self.logo_job = self.sched.add(Job('logo', LOGO_EVERY, 120000, self._logo))
        self.stats = {'fetches': 0, 'forced': 0, 'draws': 0, 'oom': 0, 'fails': 0, 'reconnects': 0}
        self.mem_free = mem_free     # () -> bytes free, for health reports
        self.last_error = ''         # '<job>:<ExceptionName>' of the latest failure
        self.health_q = ''
        self.health_at = None
        self.oom_streak = 0

    # ---- time ----
    # Epoch time stays in integers: CircuitPython floats have 22 bits of
    # precision, which is about 8 minutes at today's epoch seconds.

    def now_ms(self, ms):
        return self.epoch_ms + (ms - self.sync_ms)

    def now(self, ms):
        """Epoch seconds (int)."""
        return self.now_ms(ms) // 1000

    def _sync(self, server_now, started, ended):
        """The server's whole-second `now` puts the true time at `ended`
        between `lo` and `hi`. The clock starts at `lo` and moves only when
        it's outside that range, to its nearest edge: forward as better
        samples come in, back only if the board's own clock runs fast."""
        lo = server_now * 1000
        hi = lo + 1000 + (ended - started)
        t = self.now_ms(ended) if self.synced else lo
        self.synced = True
        self.epoch_ms = min(max(t, lo), hi)
        self.sync_ms = ended

    # ---- connecting ----

    def _status(self, kind, detail=None):
        if self.watchdog:
            self.watchdog.feed()
        self.display.show(lambda f: status.render(f, kind, detail))

    def connect(self, boot=True):
        """Blocks until online: tries each network, shows status screens,
        retries after 10, 20, 30 s, then every minute. Then fetches an update; boot=1 only after a
        real restart (it resets the phone's screen/brightness overrides)."""
        round_ = 0
        while True:
            result, detail = self.net.connect(self.networks, self._status)
            if result == 'ok':
                self._status('ok', detail)
                try:
                    started = self.clock.ms()
                    p = self.net.update(boot)
                    ms = self.clock.ms()
                    self._apply(p, started, ms)
                    self.update_job.due_at = ms + self.update_job.interval_ms
                    self.version_job.due_at = ms + VERSION_EVERY
                    self.online = True
                    self.fails = 0
                    return
                except Exception as e:  # noqa: BLE001 - any failure: show it and retry
                    self.log('[board] first update failed: %r' % (e,))
                    self._status('noserver')
            else:
                self._status(result, detail if result == 'portal' else None)
            self._wait(RETRY_WIFI_MS[min(round_, len(RETRY_WIFI_MS) - 1)])
            round_ += 1

    def _wait(self, ms_total):
        end = self.clock.ms() + ms_total
        while self.clock.ms() < end:
            if self.watchdog:
                self.watchdog.feed()
            self.clock.sleep_ms(min(1000, end - self.clock.ms()))

    # ---- jobs ----

    def _apply(self, p, started, ms):
        self._sync(p['now'], started, ms)
        self.player.set_payload(p, ms)
        self.player.set_screen(self.override.resolve(self.player.auto_screen(self.now(ms)), p.get('v')), ms)
        self.update_job.interval_ms = LIVE_EVERY if self.player.live_game() else UPDATE_EVERY
        # Free the old payload now, in one piece, rather than leaving it to
        # be collected mid-draw between newer allocations.
        gc.collect()

    def _draw(self, ms, now):
        """Draw one frame. A MemoryError (a fragmented heap that can't fit
        one allocation) skips the frame instead of crashing the board; the
        next loop pass tries again. Returns True if the frame was shown."""
        try:
            self.display.show(lambda f: self.player.draw(f, ms, now))
            self.oom_streak = 0
            return True
        except MemoryError as e:
            self.stats['oom'] += 1
            self.oom_streak += 1
            if self.oom_streak >= OOM_STREAK_MAX:
                raise  # stuck: let code.py restart the board
            if self.oom_streak == 1:
                self.log('[board] draw skipped: %r' % (e,))
            gc.collect()
            return False

    def health_query(self, ms):
        """Health fields for the version check (contract: /board/version),
        rebuilt at most once a minute: free memory, skipped draws, fetch
        budget, uptime, failed fetches, reconnects, last error, WiFi signal."""
        if self.health_at is None or ms - self.health_at >= HEALTH_EVERY:
            self.health_at = ms
            q = '&hu=%d&hb=%d&ho=%d&hf=%d&hr=%d' % (
                ms // 1000, self.sched.budget_ms, self.stats['oom'], self.stats['fails'], self.stats['reconnects'])
            if self.mem_free:
                q += '&hm=%d' % self.mem_free()
            rssi = getattr(self.net, 'rssi', None)
            if rssi:
                try:
                    q += '&hw=%d' % rssi()
                except Exception:  # noqa: BLE001 - nice to have
                    pass
            if self.last_error:
                q += '&he=' + self.last_error
            self.health_q = q
        return self.health_q

    def _version(self, ms):
        r = self.net.version(self.health_query(ms))
        self._sync(r['now'], ms, self.clock.ms())
        if self.player.p is None or r.get('v') != self.player.p.get('v'):
            self.update_job.due_at = 0  # settings changed: fetch now
        return 'ok'

    def _update(self, ms):
        # The server sends only the shown screen's sections; while a button
        # press overrides the screen, ask for that one.
        p = self.net.update(False, self.override.screen)
        self._apply(p, ms, self.clock.ms())
        return 'ok'

    def _logo(self, ms):
        # Team logos (24 x 12, immutable ids) for the baseball logo layout:
        # the game on screen and the next one, in preallocated slots.
        missing = self.player.missing_logos(self.now(ms))
        if not missing:
            return 'skip'
        buf = self.player.take_logo_slot()
        if buf is None:
            return 'skip'
        try:
            self.net.logo(missing[0], buf)
        except Exception:
            self.player.release_logo_slot(buf)
            raise
        self.player.add_logo(missing[0], buf)
        return 'more' if len(missing) > 1 else 'ok'

    def _radar(self, ms):
        # Frames are only needed on the radar screen or ahead of a visit.
        if not self.player.wants_frames():
            return 'skip'
        missing = self.player.missing_frames()
        if not missing:
            return 'skip'
        buf = self.player.take_slot()
        if buf is None:
            return 'skip'
        try:
            self.net.radar(missing[0], buf)
        except Exception:
            self.player.release_slot(buf)
            raise
        self.player.add_frame(missing[0], buf)
        return 'more' if len(missing) > 1 else 'ok'

    # ---- loop ----

    def step(self):
        """One loop pass: buttons, at most one network job, and a redraw when
        something on screen can have changed."""
        ms = self.clock.ms()
        if self.watchdog:
            self.watchdog.feed()
        self._buttons(ms)

        now = self.now(ms)
        if self.player.p:
            # Timed radar visits: follow the server's schedule unless a
            # button press is overriding it.
            self.player.set_screen(self.override.resolve(self.player.auto_screen(now), self.player.p.get('v')), ms)
        busy = self.player.busy(ms)
        quiet = max(0, self.player.quiet_ms(ms, now) - self.now_ms(ms) % 1000)
        job = self.sched.pick(ms, busy, quiet)
        if job is not None and not job.overdue(ms) and not self.player.at_blink_start(ms):
            job = None  # wait for the alert blink to turn on, then fetch
        if job is not None:
            if self.player.blinking():
                # Show the lit frame now; the freeze will hold it.
                self._draw(ms, now)
                self.last_draw = ms
            started = self.clock.ms()
            try:
                result = job.run(started)
                if result in ('ok', 'more'):
                    self.fails = 0  # a skipped job proves nothing about the network
            except Exception as e:  # noqa: BLE001 - a failed fetch must not stop the board
                self.log('[board] %s failed: %r' % (job.name, e))
                result = 'fail'
                self.stats['fails'] += 1
                self.last_error = job.name + ':' + type(e).__name__  # letters only: safe in a URL
                if isinstance(e, MemoryError):
                    gc.collect()  # says nothing about the network: don't count it toward a reconnect
                else:
                    self.fails += 1
            ended = self.clock.ms()
            if self.player.blinking() and ended - started > 300:
                self.player.blink_restart(ended)
            if result == 'skip':
                job.due_at = ended + job.interval_ms
            else:
                self.stats['fetches'] += 1
                if job.overdue(started) and (busy or quiet < self.sched.budget_ms):
                    self.stats['forced'] += 1
                self.sched.ran(job, started, ended, result != 'fail')
                if result == 'more':
                    # More of a set to fetch (radar frames, logos). Set after
                    # ran(), which would push it to the next gap: one radar
                    # frame per loop cycle. While that screen is showing,
                    # go again right away (the loop is incomplete anyway);
                    # while prefetching, take the next gap.
                    showing = self.player.screen == ('weather' if job is self.radar_job else 'baseball')
                    job.due_at = ended - job.deadline_ms if showing else ended
            if self.fails >= FAILS_BEFORE_RECONNECT:
                self.log('[board] %d failures in a row; reconnecting' % self.fails)
                self.online = False
                self.fails = 0
                self.stats['reconnects'] += 1
                self.connect(boot=False)
            ms = self.clock.ms()

        # Redraw every ~33 ms while animating; otherwise only when something
        # on screen can have changed.
        now = self.now(ms)
        key = self.player.frame_key(ms, now)
        if self.last_draw < 0 or (ms - self.last_draw >= 33 if key is None else key != self.last_key):
            if self._draw(ms, now):
                self.last_draw = ms
                self.last_key = key
                self.stats['draws'] += 1

    def _buttons(self, ms):
        if not self.buttons or not self.player.p:
            return
        step = 0
        if self.up.update(self.buttons.up(), ms):
            step = -1
        if self.down.update(self.buttons.down(), ms):
            step = 1
        if step:
            screen = self.override.press(step, self.player.screen, self.player.p.get('v'))
            self.player.set_screen(screen, ms)
            self.radar_job.due_at = 0
            # The payload only has the old screen's data: fetch the new one now.
            self.update_job.due_at = ms - self.update_job.deadline_ms


def run():
    """Entry point on the board (code.py)."""
    import os

    def free():
        gc.collect()
        return gc.mem_free()
    mem = [('start', free())]
    from . import device
    mem.append(('device', free()))
    networks = []
    for i in (1, 2, 3):
        ssid = os.getenv('WIFI_SSID_%d' % i)
        if ssid:
            networks.append((ssid, os.getenv('WIFI_PASSWORD_%d' % i) or ''))
    hw = device.Hardware(
        url=os.getenv('BOARD_URL') or 'https://ctamap.fly.dev',
        board_id=os.getenv('BOARD_ID') or 'home',
        token=os.getenv('BOARD_TOKEN') or '',
        bit_depth=int(os.getenv('MATRIX_BIT_DEPTH') or 5),
        gamma=float(os.getenv('MATRIX_GAMMA') or 1),
    )
    mem.append(('hardware', free()))
    board = Board(hw.net, hw.display, hw.clock, networks, buttons=hw.buttons, watchdog=hw.watchdog, mem_free=hw.mem_free)
    mem.append(('board', free()))
    board.connect(boot=device.cold_boot())
    mem.append(('online', free()))
    # Where the heap goes, for tuning: free bytes after each startup stage.
    print('[board] memory free: ' + ', '.join('%s %d' % m for m in mem))
    last_report = hw.clock.ms()
    while True:
        board.step()
        ms = hw.clock.ms()
        if ms - last_report > 60000:
            print('[board] fetch budget %d ms, draw %d ms (max %d), %r, mem free %s' % (
                board.sched.budget_ms, hw.display.last_ms, hw.display.max_ms, board.stats, hw.mem_free()))
            hw.display.max_ms = 0
            last_report = ms
        hw.clock.sleep_ms(5)
