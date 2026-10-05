# What the board shows at each moment, and when its next animation starts.
#
# The player owns the animation state the simulator keeps in sim.html: the
# transit animator, ticker paging, the radar loop, and the alert blink. The
# scheduler (sched.py) asks it two things before any network request:
#   busy(ms)      - is an animation running right now?
#   quiet_ms(ms)  - how long until the next one starts?
# A request blocks the display for a second or more, so it only runs in a
# long enough gap (spec §2, "Scheduler").
#
# Pure Python; runs on CircuitPython and CPython (tests).

import math

from . import draw

SCREENS = ('transit', 'ticker', 'radar')
BLINK_START_WINDOW_MS = 150
FAR = 10 ** 9  # "no animation coming"


class Player:
    def __init__(self):
        self.p = None
        self.anim = draw.TransitAnimator()
        self.radar_frames = {}   # frame id -> bytes(2048)
        self.page = 0
        self.page_start = 0
        self.loop_start = 0
        self.blink_shift = 0     # ms; blink phase 0 (off) starts here
        self.screen = 'transit'
        self._screen_since = 0

    # ---- inputs ----

    def set_payload(self, p, ms):
        self.p = p
        # Keep only frames still in the loop.
        ids = (p.get('radar') or {}).get('frames') or []
        for k in list(self.radar_frames):
            if k not in ids:
                del self.radar_frames[k]

    def missing_frames(self):
        ids = (self.p.get('radar') or {}).get('frames') or [] if self.p else []
        return [i for i in ids if i not in self.radar_frames]

    def add_frame(self, fid, data):
        self.radar_frames[fid] = data

    def auto_screen(self, now):
        """The screen the server wants now: its `screen`, except that on the
        auto screen the radar is visited for `for` seconds at the start of
        every `every`-second cycle while rain is in the box. Mirrors
        autoScreen() in draw.js."""
        p = self.p
        screen = (p.get('screen') or 'transit') if p else 'transit'
        r = (p.get('radar') or {}) if p else {}
        v = r.get('visit')
        if screen != 'transit' or not r.get('on') or not v or not v.get('every', 0) > 0:
            return screen
        return 'radar' if int(now) % v['every'] < v['for'] else 'transit'

    def wants_frames(self):
        """Radar frames are needed on the radar screen, and ahead of visits."""
        if self.screen == 'radar':
            return True
        r = (self.p.get('radar') or {}) if self.p else {}
        return bool(r.get('on') and r.get('visit'))

    def set_screen(self, screen, ms):
        if screen != self.screen:
            self.screen = screen
            self._screen_since = ms
            self.page = 0
            self.page_start = ms
            self.loop_start = ms
            self.anim = draw.TransitAnimator()

    # ---- drawing ----

    def draw(self, frame, ms, now):
        """Render the current screen into frame at monotonic ms / epoch now."""
        p = self.p
        if self.screen == 'ticker':
            pages = draw.ticker_pages(p, now)
            if self.page >= pages:
                self.page = 0
            since = ms - self.page_start
            if since >= draw.PAGE_HOLD_MS + draw.SLIDE_MS:
                self.page = (self.page + 1) % pages
                self.page_start = ms
                since = 0
            slide = (since - draw.PAGE_HOLD_MS) / draw.SLIDE_MS if pages > 1 and since > draw.PAGE_HOLD_MS else 0
            return draw.render(p, frame, screen='ticker', now=now, page=self.page, slide=slide)
        if self.screen == 'radar':
            return draw.render(p, frame, screen='radar', now=now, idx=self.radar_idx(ms), frames=self.radar_frames, blink=self.blink_on(ms))
        view = self.anim.step(p, now, ms)
        return draw.render(p, frame, screen='transit', now=now, view=view, blink=self.blink_on(ms))

    # ---- alert blink vs. network fetches ----
    # A fetch freezes the display for longer than one blink phase. To make
    # that freeze look like one slightly long "on" phase instead of a random
    # glitch, fetches start right as the blink turns on, and the blink
    # restarts (off) the moment the fetch ends.

    def blink_on(self, ms):
        return ((ms - self.blink_shift) // draw.BLINK_MS) % 2 == 1

    def blinking(self):
        if not self.p or self.screen != 'transit':
            return False
        return any(r.get('a') for r in self.p.get('rows') or [])

    def at_blink_start(self, ms):
        """True in the first moments of an 'on' phase (or when nothing blinks)."""
        if not self.blinking():
            return True
        phase = (ms - self.blink_shift) % (2 * draw.BLINK_MS)
        return draw.BLINK_MS <= phase < draw.BLINK_MS + BLINK_START_WINDOW_MS

    def blink_restart(self, ms):
        self.blink_shift = ms

    def radar_idx(self, ms):
        n = len((self.p.get('radar') or {}).get('frames') or [])
        if not n:
            return -1
        cycle = max(1, n - 1) * draw.RADAR_FRAME_MS + draw.RADAR_HOLD_MS
        return min(n - 1, ((ms - self.loop_start) % cycle) // draw.RADAR_FRAME_MS)

    # ---- timing for the scheduler ----

    def busy(self, ms):
        if not self.p:
            return False
        if self.screen == 'ticker':
            since = ms - self.page_start
            return draw.ticker_pages(self.p, 0) > 1 and draw.PAGE_HOLD_MS < since < draw.PAGE_HOLD_MS + draw.SLIDE_MS
        if self.screen == 'radar':
            n = len((self.p.get('radar') or {}).get('frames') or [])
            if n < 2:
                return False
            cycle = (n - 1) * draw.RADAR_FRAME_MS + draw.RADAR_HOLD_MS
            return (ms - self.loop_start) % cycle < (n - 1) * draw.RADAR_FRAME_MS
        return transit_busy(self.anim, ms)

    def quiet_ms(self, ms, now):
        """Milliseconds until the next animation starts (0 while one runs)."""
        if not self.p:
            return FAR
        if self.busy(ms):
            return 0
        if self.screen == 'ticker':
            if draw.ticker_pages(self.p, now) < 2:
                return FAR
            return max(0, draw.PAGE_HOLD_MS - (ms - self.page_start))
        if self.screen == 'radar':
            n = len((self.p.get('radar') or {}).get('frames') or [])
            if n < 2:
                return FAR
            cycle = (n - 1) * draw.RADAR_FRAME_MS + draw.RADAR_HOLD_MS
            return cycle - (ms - self.loop_start) % cycle
        return transit_quiet_ms(self.p, now)


def transit_busy(anim, t):
    """True while any transit row or time is fading, moving, rolling, or
    easing color (mirrors the timing in draw.TransitAnimator.step)."""
    for st in anim.rows.values():
        if st.get('leaving'):
            return True
        if st.get('born') is not None and t - st['born'] < draw.FADE_MS * 2:
            return True
        if st.get('moveStart') is not None and t < st['moveStart'] + draw.MOVE_MS:
            return True
        if st.get('numRoll'):
            return True
        for c in st['cells']:
            if c.get('leaving') or c.get('roll'):
                return True
            if c.get('born') is not None and t - c['born'] < draw.FADE_MS:
                return True
            if c.get('colorStart') is not None and t - c['colorStart'] < draw.COLOR_MS:
                return True
            if c.get('moveStart') is not None and t < c['moveStart'] + draw.MOVE_MS:
                return True
    return False


def transit_quiet_ms(p, now):
    """Milliseconds until a shown time next changes (a roll) or a train drops
    off (a fade): the next minute boundary of any visible arrival."""
    view = draw.build_transit_view(p, now)
    best = FAR
    for row in view['rows']:
        for c in row['cells']:
            t = c['t']
            m = draw.minutes_until(t, now)
            if m > 1:
                at = t - 60 * (m - 1)     # when ceil((t - now) / 60) drops to m - 1
            else:
                at = t + draw.DROP_GRACE  # DUE until it drops off
            best = min(best, int(math.ceil((at - now) * 1000)))
    return max(0, best)
