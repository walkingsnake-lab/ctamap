# The board's big fixed allocations: the matrix and its framebuffer, the
# palette-indexed bitmap, and the radar and logo slot buffers. code.py makes
# them first, before the fonts, renderer and app load. Those leave their
# bytecode spread across the heap; allocated after them, these blocks had to
# fit between the pieces, and boot ran out of memory. Imports nothing from
# boardlib (draw.py and assets.py are the big ones). Only imported on the board.
#
# Slot counts and sizes must match player.py (RADAR_SLOTS, RADAR_BYTES,
# LOGO_SLOTS, LOGO_BYTES); Player checks them and allocates its own if not.
import board
import displayio
import framebufferio
import rgbmatrix

RADAR_SLOTS = 6
RADAR_BYTES = 64 * 32 // 2
LOGO_SLOTS = 4
LOGO_BYTES = 24 * 12 * 3


class Matrix:
    def __init__(self, bit_depth=5):
        displayio.release_displays()
        m = rgbmatrix.RGBMatrix(
            width=64, height=32, bit_depth=bit_depth,
            rgb_pins=[board.MTX_R1, board.MTX_G1, board.MTX_B1, board.MTX_R2, board.MTX_G2, board.MTX_B2],
            addr_pins=[board.MTX_ADDRA, board.MTX_ADDRB, board.MTX_ADDRC, board.MTX_ADDRD],
            clock_pin=board.MTX_CLK, latch_pin=board.MTX_LAT, output_enable_pin=board.MTX_OE,
        )
        self.bit_depth = bit_depth
        self.display = framebufferio.FramebufferDisplay(m, auto_refresh=False)
        self.bitmap = displayio.Bitmap(64, 32, 256)
        self.palette = displayio.Palette(256)
        self.radar = [bytearray(RADAR_BYTES) for _ in range(RADAR_SLOTS)]
        self.logos = [bytearray(LOGO_BYTES) for _ in range(LOGO_SLOTS)]
