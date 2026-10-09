# CTA LED board. Copy this folder's code.py, boardlib/, and settings.toml to
# the CIRCUITPY drive (see firmware/README.md).
import sys
import time

import supervisor

import gc

from boardlib import crash  # tiny; imported first so the crash handler needs no import


def free():
    gc.collect()
    return gc.mem_free()


# Free memory after each import, for the startup memory report.
mem = [('boot', free())]
try:
    from boardlib import assets
    mem.append(('fonts', free()))
    from boardlib import draw
    mem.append(('draw', free()))
    from boardlib import app
    mem.append(('app', free()))
    app.run(mem)
except Exception as e:  # noqa: BLE001 - any crash: log it, then restart cleanly
    import traceback
    gc.collect()
    try:
        tb = ''.join(traceback.format_exception(e))
    except Exception:  # noqa: BLE001 - out of memory even for that
        tb = ''
    print(tb or repr(e))
    crash.save(e, tb)  # nvm survives the reload: the next run sends it with its health
    # Blink the status NeoPixel red until the restart. Only if device was
    # already imported: no new imports while handling a crash.
    led = None
    try:
        dev = sys.modules.get('boardlib.device')
        led = dev.status_led() if dev else None
    except Exception:  # noqa: BLE001 - the restart matters more than the light
        pass
    for i in range(20):
        if led:
            led.set('crash' if i % 2 == 0 else 'off')
        time.sleep(0.5)
    supervisor.reload()
