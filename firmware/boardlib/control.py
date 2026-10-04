# UP/DOWN buttons vs. the phone (design spec §9): last action wins.
#
# A button press sets a local screen override and records the server's
# settings version. The override holds until the version changes (someone
# changed something on the phone), then the board follows the server again.

SCREENS = ('transit', 'ticker', 'radar')


class ScreenOverride:
    def __init__(self):
        self.screen = None
        self.at_v = None

    def press(self, step, current, server_v):
        """step: +1 (DOWN) or -1 (UP). Returns the new screen."""
        i = SCREENS.index(current) if current in SCREENS else 0
        self.screen = SCREENS[(i + step) % len(SCREENS)]
        self.at_v = server_v
        return self.screen

    def resolve(self, server_screen, server_v):
        if self.screen is not None and server_v != self.at_v:
            self.screen = None  # a phone change wins
        return self.screen or server_screen


class Debounce:
    """Edge detector for an active-low button read once per loop."""

    def __init__(self, hold_ms=40):
        self.hold_ms = hold_ms
        self.pressed = False
        self.since = None

    def update(self, down, ms):
        """True once per press."""
        if down and not self.pressed:
            if self.since is None:
                self.since = ms
            if ms - self.since >= self.hold_ms:
                self.pressed = True
                return True
        elif not down:
            self.pressed = False
            self.since = None
        return False
