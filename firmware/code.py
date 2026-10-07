# CTA LED board. Copy this folder's code.py, boardlib/, and settings.toml to
# the CIRCUITPY drive (see firmware/README.md).
import time

import supervisor

import gc


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
    traceback.print_exception(e)
    time.sleep(10)
    supervisor.reload()
