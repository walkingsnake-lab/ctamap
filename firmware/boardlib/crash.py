# Why the board (re)started, for the health report. code.py's crash handler
# reloads the board, and a reload keeps time.monotonic() and loses the
# serial log, so the crash is saved to microcontroller.nvm (flash; written
# once per crash) and sent with the next run's health reports.
#
# No hardware imports at module level: code.py imports this in its crash
# handler, and the tests run it under CPython.

MARK = 0xC7   # nvm[0]: a saved crash follows (fresh flash reads 0xFF)
MAX_LEN = 60  # characters kept
SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_:'


def _safe(s):
    """Letters, digits, '_' and ':' only (the server drops anything else)."""
    return ''.join(c if c in SAFE else '_' for c in s)


def describe(e, tb_text):
    """'<Exception>:<file>:<line>:<function>' for the innermost frame of a
    formatted traceback, e.g. 'MemoryError:player:312:quiet_ms'."""
    where = ''
    for line in tb_text.split('\n'):
        line = line.strip()
        if line.startswith('File "') and ', line ' in line:
            path = line[6:line.index('"', 6)]
            name = path.split('/')[-1]
            if '.' in name:
                name = name[:name.index('.')]
            rest = line[line.index(', line ') + 7:]
            num = rest.split(',')[0].strip()
            fn = rest[rest.index(', in ') + 5:].strip() if ', in ' in rest else ''
            where = '%s:%s:%s' % (name, num, fn)
    s = type(e).__name__ + (':' + where if where else '')
    return _safe(s)[:MAX_LEN]


def save(e, tb_text, nvm=None):
    """Keep e's description in nvm for the next run. Never raises."""
    try:
        if nvm is None:
            import microcontroller
            nvm = microcontroller.nvm
        b = describe(e, tb_text).encode()
        nvm[0:2 + len(b)] = bytes([MARK, len(b)]) + b
    except Exception:  # noqa: BLE001 - best effort: the reload must happen
        pass


def take(nvm=None):
    """The saved crash ('' if none), cleared so it's reported once per run
    that follows it. Never raises."""
    try:
        if nvm is None:
            import microcontroller
            nvm = microcontroller.nvm
        if nvm[0] != MARK:
            return ''
        n = nvm[1]
        s = bytes(nvm[2:2 + min(n, MAX_LEN)]).decode()
        nvm[0:1] = b'\x00'
        return _safe(s)
    except Exception:  # noqa: BLE001
        return ''


def _enum_name(cls, v):
    for k in dir(cls):
        if not k.startswith('_') and getattr(cls, k) == v:
            return k
    return str(v).split('.')[-1]


def start_reason():
    """What started this run: SUPERVISOR_RELOAD (code.py's crash restart),
    AUTO_RELOAD (files copied), or for a fresh start the chip's reset
    reason: POWER_ON, WATCHDOG, BROWNOUT, RESET_PIN, SOFTWARE, ..."""
    try:
        import microcontroller
        import supervisor
        rr = supervisor.runtime.run_reason
        if rr != supervisor.RunReason.STARTUP:
            return _safe(_enum_name(supervisor.RunReason, rr))
        return _safe(_enum_name(microcontroller.ResetReason, microcontroller.cpu.reset_reason))
    except Exception:  # noqa: BLE001 - CPython, or an older CircuitPython
        return ''
