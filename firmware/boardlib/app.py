# The board's main loop: connects, keeps the payload fresh, and draws.
#
# Board takes its hardware as plain objects so the whole loop can run under
# CPython against a fake network and clock (firmware/tests/test_app.py):
#   net      - connect(networks, status) / ping() / version() / update(boot)
#              / radar(frame_id) / mac; raises on failure
#   display  - show(draw_fn): draw_fn(frame) fills a fresh frame, then it's shown
#   clock    - ms(): monotonic milliseconds (int)
#   buttons  - up() / down(): True while held (optional)
#   watchdog - feed() (optional)

from . import draw
from . import status
from .control import ScreenOverride, Debounce
from .player import Player
from .sched import Scheduler, Job

VERSION_EVERY = 10000   # settings version check (spec: ~10 s)
UPDATE_EVERY = 30000    # combined update (spec: ~30 s)
RADAR_EVERY = 3000      # one missing radar frame per run
FAILS_BEFORE_RECONNECT = 3
RETRY_WIFI_MS = 60000


class Board:
    def __init__(self, net, display, clock, networks, buttons=None, watchdog=None, log=print):
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
        self.sync_now = 0
        self.fails = 0
        self.online = False
        self.last_draw = -1
        self.sched = Scheduler()
        self.version_job = self.sched.add(Job('version', VERSION_EVERY, 20000, self._version))
        self.update_job = self.sched.add(Job('update', UPDATE_EVERY, 30000, self._update))
        self.radar_job = self.sched.add(Job('radar', RADAR_EVERY, 120000, self._radar))
        self.stats = {'fetches': 0, 'forced': 0, 'draws': 0}

    # ---- time ----

    def now(self, ms):
        """Epoch seconds: server time at the last sync plus elapsed."""
        return self.sync_now + (ms - self.sync_ms) / 1000

    def _sync(self, server_now, ms):
        self.sync_now = server_now
        self.sync_ms = ms

    # ---- connecting ----

    def _status(self, kind, detail=None):
        if self.watchdog:
            self.watchdog.feed()
        self.display.show(lambda f: status.render(f, kind, detail))

    def connect(self, boot=True):
        """Blocks until online: tries each network, shows status screens,
        retries every minute. Then fetches an update; boot=1 only after a
        real restart (it resets the phone's screen/brightness overrides)."""
        while True:
            result, detail = self.net.connect(self.networks, self._status)
            if result == 'ok':
                self._status('ok', detail)
                try:
                    p = self.net.update(boot)
                    ms = self.clock.ms()
                    self._apply(p, ms)
                    self.update_job.due_at = ms + UPDATE_EVERY
                    self.version_job.due_at = ms + VERSION_EVERY
                    self.online = True
                    self.fails = 0
                    return
                except Exception as e:  # noqa: BLE001 - any failure: show it and retry
                    self.log('[board] first update failed: %r' % (e,))
                    self._status('noserver')
            else:
                self._status(result, detail if result == 'portal' else None)
            self._wait(RETRY_WIFI_MS)

    def _wait(self, ms_total):
        end = self.clock.ms() + ms_total
        while self.clock.ms() < end:
            if self.watchdog:
                self.watchdog.feed()
            self.clock.sleep_ms(min(1000, end - self.clock.ms()))

    # ---- jobs ----

    def _apply(self, p, ms):
        self._sync(p['now'], ms)
        self.player.set_payload(p, ms)
        self.player.set_screen(self.override.resolve(self.player.auto_screen(self.now(ms)), p.get('v')), ms)

    def _version(self, ms):
        r = self.net.version()
        self._sync(r['now'], self.clock.ms())
        if self.player.p is None or r.get('v') != self.player.p.get('v'):
            self.update_job.due_at = 0  # settings changed: fetch now
        return 'ok'

    def _update(self, ms):
        p = self.net.update(False)
        self._apply(p, self.clock.ms())
        return 'ok'

    def _radar(self, ms):
        # Frames are only needed on the radar screen or ahead of a visit.
        if not self.player.wants_frames():
            return 'skip'
        missing = self.player.missing_frames()
        if not missing:
            return 'skip'
        self.player.add_frame(missing[0], self.net.radar(missing[0]))
        if len(missing) > 1:
            self.radar_job.due_at = 0
        return 'ok'

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
        quiet = self.player.quiet_ms(ms, now)
        job = self.sched.pick(ms, busy, quiet)
        if job is not None:
            started = self.clock.ms()
            try:
                result = job.run(started)
                if result == 'ok':
                    self.fails = 0  # a skipped job proves nothing about the network
            except Exception as e:  # noqa: BLE001 - a failed fetch must not stop the board
                self.log('[board] %s failed: %r' % (job.name, e))
                result = 'fail'
                self.fails += 1
            ended = self.clock.ms()
            if result == 'skip':
                job.due_at = ended + job.interval_ms
            else:
                self.stats['fetches'] += 1
                if job.overdue(started) and (busy or quiet < self.sched.budget_ms):
                    self.stats['forced'] += 1
                self.sched.ran(job, started, ended, result == 'ok')
            if self.fails >= FAILS_BEFORE_RECONNECT:
                self.log('[board] %d failures in a row; reconnecting' % self.fails)
                self.online = False
                self.fails = 0
                self.connect(boot=False)
            ms = self.clock.ms()

        # Redraw: every ~33 ms while animating, otherwise 4x a second (alert
        # blink is 1 s; clocks change once a minute).
        interval = 33 if self.player.busy(ms) else 250
        if self.last_draw < 0 or ms - self.last_draw >= interval:
            now = self.now(ms)
            self.display.show(lambda f: self.player.draw(f, ms, now))
            self.last_draw = ms
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


def run():
    """Entry point on the board (code.py)."""
    import os
    from . import device
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
    )
    board = Board(hw.net, hw.display, hw.clock, networks, buttons=hw.buttons, watchdog=hw.watchdog)
    board.connect()
    last_report = hw.clock.ms()
    while True:
        board.step()
        ms = hw.clock.ms()
        if ms - last_report > 60000:
            print('[board] fetch budget %d ms, last draw %d ms, %r, mem free %s' % (
                board.sched.budget_ms, hw.display.last_ms, board.stats, hw.mem_free()))
            last_report = ms
        hw.clock.sleep_ms(5)
