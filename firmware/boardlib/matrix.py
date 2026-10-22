# The board's big fixed allocations: the matrix and its framebuffer, the
# palette-indexed bitmap, and the radar and logo slot buffers. code.py makes
# them first, before the fonts, renderer and app load. Those leave their
# bytecode spread across the heap; allocated after them, these blocks had to
# fit between the pieces, and boot ran out of memory. Imports nothing from
# boardlib (draw.py and assets.py are the big ones). Only imported on the board.
#
# Buffer sizes must match player.py (RADAR_BYTES, LOGO_BYTES); Player checks
# them and allocates its own if not. Counts follow the board's memory: the
# M4 has ~130 KB of heap at boot, the S3 ~2 MB (PSRAM), so the S3 gets more
# logo slots. Everything else is the same on both. (The glyph cache doesn't
# need it: every screen together uses ~64 of the M4's 96 entries.)
import gc

import board
import displayio
import framebufferio
import rgbmatrix

RADAR_SLOTS = 6  # the loop's length (contract: up to 6 frames), on both boards
RADAR_BYTES = 64 * 32 // 2
LOGO_BYTES = 24 * 12 * 3
BIG_HEAP = 512 * 1024  # free bytes at boot above which a board counts as big (the S3)


def logo_slots(free, coprocessor=True):
    """Logo slots for a heap with `free` bytes. Small (M4): 4, the game on
    screen and the next. Big (S3): 32 (~28 KB), enough to keep a day's games
    without refetching as the rotation comes back around. A board without
    the M4's ESP32 co-processor counts as big too, in case its heap reports
    less at boot than it can grow to (CircuitPython on the ESP32-S3 may)."""
    return 32 if free >= BIG_HEAP or not coprocessor else 4


class Matrix:
    def __init__(self, bit_depth=5, rotation=0):
        displayio.release_displays()
        m = rgbmatrix.RGBMatrix(
            width=64, height=32, bit_depth=bit_depth,
            rgb_pins=[board.MTX_R1, board.MTX_G1, board.MTX_B1, board.MTX_R2, board.MTX_G2, board.MTX_B2],
            addr_pins=[board.MTX_ADDRA, board.MTX_ADDRB, board.MTX_ADDRC, board.MTX_ADDRD],
            clock_pin=board.MTX_CLK, latch_pin=board.MTX_LAT, output_enable_pin=board.MTX_OE,
        )
        self.bit_depth = bit_depth
        self.display = framebufferio.FramebufferDisplay(m, auto_refresh=False, rotation=rotation)
        self.bitmap = displayio.Bitmap(64, 32, 256)
        self.palette = displayio.Palette(256)
        gc.collect()
        self.heap = gc.mem_free()
        logos = logo_slots(self.heap, hasattr(board, 'ESP_CS'))
        self.radar = [bytearray(RADAR_BYTES) for _ in range(RADAR_SLOTS)]
        self.logos = [bytearray(LOGO_BYTES) for _ in range(logos)]
