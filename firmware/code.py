# CTA LED board. Copy this folder's code.py, boardlib/, and settings.toml to
# the CIRCUITPY drive (see firmware/README.md).
import time

import supervisor

try:
    from boardlib import app
    app.run()
except Exception as e:  # noqa: BLE001 - any crash: log it, then restart cleanly
    import traceback
    traceback.print_exception(e)
    time.sleep(10)
    supervisor.reload()
