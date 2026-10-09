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

from . import draw

SCREENS = ('transit', 'ticker', 'weather', 'baseball')
# Radar frame buffers, allocated once while the heap is still whole. After
# hours of JSON parsing the heap is too fragmented for a fresh 2 KB block
# (MemoryError with 37 KB free), so frames are read into these instead.
RADAR_SLOTS = 6          # the loop's length (contract: up to 6 frames)
RADAR_BYTES = 64 * 32
# Team logos (logo layout), same reason: 4 slots hold the game on screen and
# the next one in the rotation, fetched ahead so a rotation shows no gap.
LOGO_SLOTS = 4
LOGO_BYTES = 24 * 12 * 3
BLINK_START_WINDOW_MS = 150
FAR = 10 ** 9  # "no animation coming"


class Player:
    def __init__(self):
        self.p = None
        self.gen = 0             # bumped with every payload
        self.anim = draw.TransitAnimator()
        self.radar_frames = {}   # frame id -> one of the slot buffers
        self.radar_free = [bytearray(RADAR_BYTES) for _ in range(RADAR_SLOTS)]
        self.logos = {}          # logo id -> one of the logo slot buffers
        self.logo_free = [bytearray(LOGO_BYTES) for _ in range(LOGO_SLOTS)]
        self.page = 0
        self.page_start = 0
        self.loop_start = 0
        self.blink_shift = 0     # ms; blink phase 0 (off) starts here
        self.screen = 'transit'
        self._screen_since = 0
        self.bb_shown = None     # baseball texts last drawn (for rolls)
        self.bb_rolls = {}       # text key -> {'from', 'start'}
        # Next transit change (epoch s), kept between loop passes: building
        # the transit view to find it allocated ~1 KB on every pass, which
        # churned and fragmented the heap. -1 means none (FAR).
        self._quiet_gen = -1
        self._quiet_now = -1     # the second it was computed at
        self._quiet_at = -1

    # ---- inputs ----

    def set_payload(self, p, ms):
        # A new station: start transit and the ticker fresh. Animating from
        # the old station's rows to the new one's overlapped them mid-fade.
        if self.p is not None and p.get('stn') != self.p.get('stn'):
            self.anim = draw.TransitAnimator()
            self.page = 0
            self.page_start = ms
        self.p = p
        self.gen += 1
        # Keep only frames still in the loop.
        ids = (p.get('radar') or {}).get('frames') or []
        for k in list(self.radar_frames):
            if k not in ids:
                self.radar_free.append(self.radar_frames.pop(k))
        # Keep only logos the games still use.
        self._keep_logos(self._game_logos(range(len(self._games()))))

    def missing_frames(self):
        """Frames not yet downloaded, newest first: the loop plays the
        frames on hand, so it starts with the current one."""
        ids = (self.p.get('radar') or {}).get('frames') or [] if self.p else []
        return [ids[i] for i in range(len(ids) - 1, -1, -1) if ids[i] not in self.radar_frames]

    def take_slot(self):
        """A free frame buffer, or None if all are holding frames."""
        return self.radar_free.pop() if self.radar_free else None

    def release_slot(self, buf):
        """Return a buffer whose fetch failed."""
        self.radar_free.append(buf)

    def add_frame(self, fid, buf, ms=None):
        """buf: a buffer from take_slot(), now holding frame fid. The frame
        that completes the set restarts the loop at its oldest frame."""
        self.radar_frames[fid] = buf
        if ms is not None and self._loop_len():
            self.loop_start = ms

    def _games(self):
        mlb = (self.p.get('mlb') or {}) if self.p else {}
        return (mlb.get('games') or []) if mlb.get('layout') == 'logos' else []

    def _game_logos(self, idxs):
        games = self._games()
        out = []
        for i in idxs:
            for k in ('away', 'home'):
                lg = (games[i].get(k) or {}).get('lg')
                if lg and lg not in out:
                    out.append(lg)
        return out

    def _keep_logos(self, want):
        for k in list(self.logos):
            if k not in want:
                self.logo_free.append(self.logos.pop(k))

    def wanted_logos(self, now):
        """Logo ids for the game on screen, then the next one in the
        rotation (logo layout only). Mirrors draw.pick_game()."""
        games = self._games()
        if not games:
            return []
        all_games = (self.p.get('mlb') or {}).get('all') is True
        pick = draw.pick_game(games, now, draw.timing(self.p)['game'], all_games)
        live = [] if all_games else [i for i, gm in enumerate(games) if gm.get('st') == 'live']
        pool = live if live else list(range(len(games)))
        idxs = [pick['i']]
        if pick['of'] > 1:
            idxs.append(pool[(pick['pos'] + 1) % pick['of']])
        return self._game_logos(idxs)

    def live_game(self):
        """True while the baseball screen is up with a game in progress."""
        if self.screen != 'baseball' or not self.p:
            return False
        return any(g.get('st') == 'live' for g in (self.p.get('mlb') or {}).get('games') or [])

    def missing_logos(self, now):
        """Logos to fetch: only while the baseball screen is up. Frees the
        slots of logos the current and next game don't use."""
        if self.screen != 'baseball':
            return []
        want = self.wanted_logos(now)
        self._keep_logos(want)
        return [i for i in want if i not in self.logos]

    def take_logo_slot(self):
        return self.logo_free.pop() if self.logo_free else None

    def release_logo_slot(self, buf):
        self.logo_free.append(buf)

    def add_logo(self, lid, buf):
        """buf: a buffer from take_logo_slot(), now holding logo lid."""
        self.logos[lid] = buf

    def auto_screen(self, now):
        """The screen the server wants now: its `screen`, except that on the
        auto screen `rot` alternates the main screens every `every` s, and the
        weather screen is visited for `for` seconds at the start of every
        `every`-second cycle while rain is in the box (or always). Both
        epoch-aligned. Mirrors autoScreen() in draw.js."""
        p = self.p
        base = (p.get('screen') or 'transit') if p else 'transit'
        screen = base
        rot = p.get('rot') if p else None
        if rot and len(rot.get('screens') or []) > 1 and rot.get('every', 0) > 0 and base in rot['screens']:
            screen = rot['screens'][(int(now) // rot['every']) % len(rot['screens'])]
        r = (p.get('radar') or {}) if p else {}
        v = r.get('visit')
        if base not in ('transit', 'ticker', 'baseball') or not v or not v.get('every', 0) > 0 or not (r.get('on') or v.get('always')):
            return screen
        return 'weather' if int(now) % v['every'] < v['for'] else screen

    def wants_frames(self):
        """Radar frames are needed on the radar screen, and ahead of visits."""
        if self.screen == 'weather':
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
            self.bb_shown = None
            self.bb_rolls = {}

    # ---- drawing ----

    def draw(self, frame, ms, now):
        """Render the current screen into frame at monotonic ms / epoch now."""
        p = self.p
        if self.screen == 'ticker':
            pages = draw.ticker_pages(p, now)
            if self.page >= pages:
                self.page = 0
            since = ms - self.page_start
            tm = draw.timing(p)
            if since >= tm['pageHold'] + tm['slide']:
                self.page = (self.page + 1) % pages
                self.page_start = ms
                since = 0
            slide = (since - tm['pageHold']) / tm['slide'] if pages > 1 and since > tm['pageHold'] else 0
            return draw.render(p, frame, screen='ticker', now=now, page=self.page, slide=slide)
        if self.screen == 'baseball':
            # Scores, inning, count, and outs roll when they change (not
            # across a change of game or state). Mirrors sim.html.
            bt = draw.baseball_texts(p, now)
            if bt and self.bb_shown and self.bb_shown['key'] == bt['key']:
                for k, v in bt['texts'].items():
                    old = self.bb_shown['texts'].get(k)
                    if old is not None and old != v:
                        self.bb_rolls[k] = {'from': old, 'start': ms}
            else:
                self.bb_rolls = {}
            self.bb_shown = bt
            rolls = {}
            for k in list(self.bb_rolls):
                r = self.bb_rolls[k]
                rp = (ms - r['start']) / draw.ROLL_MS
                if rp >= 1:
                    del self.bb_rolls[k]
                else:
                    rolls[k] = {'from': r['from'], 'p': rp}
            return draw.render(p, frame, screen='baseball', now=now, rolls=rolls, logos=self.logos)
        if self.screen == 'weather':
            return draw.render(p, frame, screen='weather', now=now, idx=self.radar_idx(ms), frames=self.radar_frames, blink=self.blink_on(ms))
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
        if not self.p or self.screen not in ('transit', 'weather'):
            return False
        w = self.p.get('warn') or {}
        tornado = w.get('kind') == 'tor' and w.get('lvl') == 'warning'
        if self.screen == 'weather':
            return tornado
        return any(r.get('a') for r in self.p.get('rows') or []) or bool(tornado and self.p.get('wx'))

    def at_blink_start(self, ms):
        """True in the first moments of an 'on' phase (or when nothing blinks)."""
        if not self.blinking():
            return True
        phase = (ms - self.blink_shift) % (2 * draw.BLINK_MS)
        return draw.BLINK_MS <= phase < draw.BLINK_MS + BLINK_START_WINDOW_MS

    def blink_restart(self, ms):
        self.blink_shift = ms

    def radar_idx(self, ms):
        ids = (self.p.get('radar') or {}).get('frames') or []
        return draw.radar_loop_idx(ids, self.radar_frames, ms - self.loop_start, draw.timing(self.p))

    def _loop_len(self):
        """Frames in the playing loop: all of them once every frame is on
        hand, else 0 (the screen holds on the newest on hand)."""
        ids = (self.p.get('radar') or {}).get('frames') or [] if self.p else []
        return len(ids) if ids and draw.radar_on_hand(ids, self.radar_frames) == len(ids) else 0

    def frame_key(self, ms, now):
        """Everything a still frame depends on, or None while an animation
        needs every frame. The board redraws only when this changes."""
        if self.screen != 'weather' and self.busy(ms):
            return None
        key = (self.screen, self.gen, now, self.blinking() and self.blink_on(ms))
        if self.screen == 'ticker':
            tm = draw.timing(self.p)
            return key + (self.page, ms - self.page_start >= tm['pageHold'] + tm['slide'])
        if self.screen == 'weather':
            return key + (self.radar_idx(ms), len(self.radar_frames))
        if self.screen == 'baseball':
            return key + (len(self.logos),)
        return key

    # ---- timing for the scheduler ----

    def busy(self, ms):
        if not self.p:
            return False
        if self.screen == 'ticker':
            since = ms - self.page_start
            tm = draw.timing(self.p)
            return draw.ticker_pages(self.p, 0) > 1 and tm['pageHold'] < since < tm['pageHold'] + tm['slide']
        if self.screen == 'baseball':
            return any(ms - r['start'] < draw.ROLL_MS for r in self.bb_rolls.values())
        if self.screen == 'weather':
            n = self._loop_len()
            if n < 2:
                return False
            tm = draw.timing(self.p)
            cycle = (n - 1) * tm['radarFrame'] + tm['radarHold']
            return (ms - self.loop_start) % cycle < (n - 1) * tm['radarFrame']
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
            return max(0, draw.timing(self.p)['pageHold'] - (ms - self.page_start))
        if self.screen == 'baseball':
            return FAR  # rolls follow fetched changes; the rotation swaps without animating
        if self.screen == 'weather':
            n = self._loop_len()
            if n < 2:
                return FAR
            tm = draw.timing(self.p)
            cycle = (n - 1) * tm['radarFrame'] + tm['radarHold']
            return cycle - (ms - self.loop_start) % cycle
        if self._quiet_gen != self.gen or (now != self._quiet_now and 0 <= self._quiet_at <= now):
            # A new payload, or the cached change is here. Before it, no
            # shown time changes and no train drops off, so the answer holds;
            # at it, recompute once per second (a train due to drop this
            # second keeps the answer at 0 until the next one).
            self._quiet_gen = self.gen
            self._quiet_now = now
            at = transit_next_change(self.p, now)
            self._quiet_at = -1 if at is None else at
        if self._quiet_at < 0:
            return FAR
        return max(0, (self._quiet_at - now) * 1000)


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


def transit_next_change(p, now):
    """Epoch second when a shown time next changes (a roll) or a train drops
    off (a fade): the next minute boundary of any visible arrival. None if
    nothing on screen will change. Until that second passes, the answer
    stays the same (each cell's boundary is fixed until it's reached)."""
    view = draw.build_transit_view(p, now)
    best = None
    for row in view['rows']:
        for c in row['cells']:
            t = c['t']
            m = draw.minutes_until(t, now)
            if m > 1:
                at = t - 60 * (m - 1)     # when ceil((t - now) / 60) drops to m - 1
            else:
                at = t + draw.DROP_GRACE  # DUE until it drops off
            if best is None or at < best:
                best = at
    return best


def transit_quiet_ms(p, now):
    """Milliseconds until a shown time next changes or a train drops off."""
    at = transit_next_change(p, now)
    return FAR if at is None else max(0, (at - now) * 1000)
