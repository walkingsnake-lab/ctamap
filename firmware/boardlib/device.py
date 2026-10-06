# Matrix Portal M4 hardware: the HUB75 matrix, the ESP32 WiFi co-processor,
# the UP/DOWN buttons, and the watchdog. Only imported on the board; the
# rest of boardlib runs under CPython for tests.
#
# Libraries (copy to CIRCUITPY/lib, or `circup install`): adafruit_esp32spi,
# adafruit_requests, adafruit_connection_manager.

import gc
import time

import bitmaptools
import board
import busio
import displayio
import framebufferio
import rgbmatrix
from digitalio import DigitalInOut, Direction, Pull

from . import draw

# Palette: 0 is black, 1-10 are the radar values (so a radar frame copies
# straight into the bitmap), the rest are allocated per frame.
RADAR_FIRST = 1
FREE_FIRST = 11
GLYPH_CACHE = 96  # glyph bitmaps kept for arrayblit, per font, codepoint, and palette slot


def _pack(rgb):
    return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]


def gamma_lut(gamma):
    """0-255 -> 0-255 through a power curve. The panel's PWM is linear in
    light, while the palette is authored in sRGB-ish values, so without this
    dim values and minor channels come out too bright (Red reads pink)."""
    if gamma == 1:
        return None
    return bytes(int((v / 255) ** gamma * 255 + 0.5) for v in range(256))


def correct(rgb, lut, floor):
    """Apply the gamma LUT. If the whole color would fall below one visible
    step, lift its brightest channel to that step (and drop the rest) so dim
    elements never vanish without picking up a tint."""
    if lut is None:
        return rgb
    out = (lut[rgb[0]], lut[rgb[1]], lut[rgb[2]])
    m = max(out)
    if m >= floor or not (rgb[0] or rgb[1] or rgb[2]):
        return out
    top = max(rgb)
    return tuple(floor if c == top else 0 for c in rgb)


class BoardFrame(draw.Frame):
    """draw.Frame drawing into a palette-indexed displayio Bitmap. Colors get
    palette slots as they're used; brightness scales the palette."""

    def __init__(self, bitmap, palette, gamma=1, bit_depth=5):
        self.lut = gamma_lut(gamma)
        # Smallest 8-bit value that survives quantization (RGB565, then the
        # top bit_depth bits; red and blue only have 5).
        self.floor = 256 >> min(bit_depth, 5)
        self.w = 64
        self.h = 32
        self.clip = None
        self._clips = []
        self.bitmap = bitmap
        self.palette = palette
        self.colors = {}
        self.next = FREE_FIRST
        self.k = 1
        self.glyphs = {}

    def begin(self):
        self.bitmap.fill(0)
        self.colors = {(0, 0, 0): 0}
        self.next = FREE_FIRST
        self.k = 1
        self.clip = None
        self._clips = []

    def _index(self, rgb):
        i = self.colors.get(rgb)
        if i is None:
            if self.next > 255:
                return 255  # out of slots: reuse the last (never seen in practice)
            i = self.next
            self.next += 1
            self.colors[rgb] = i
        return i

    def set(self, x, y, rgb):
        if x < 0 or y < 0 or x >= 64 or y >= 32:
            return
        c = self.clip
        if c and (x < c[0] or y < c[1] or x > c[2] or y > c[3]):
            return
        self.bitmap[x, y] = self._index(rgb)

    def fill(self, x, y, w, h, rgb):
        x0, y0, x1, y1 = max(0, x), max(0, y), min(63, x + w - 1), min(31, y + h - 1)
        c = self.clip
        if c:
            x0, y0, x1, y1 = max(x0, c[0]), max(y0, c[1]), min(x1, c[2]), min(y1, c[3])
        if x0 > x1 or y0 > y1:
            return
        bitmaptools.fill_region(self.bitmap, x0, y0, x1 + 1, y1 + 1, self._index(rgb))

    def _glyph(self, font_name, cp, g, idx):
        key = (font_name, cp, idx)
        data = self.glyphs.get(key)
        if data is None:
            if len(self.glyphs) >= GLYPH_CACHE:
                self.glyphs = {}
            w, h = g[1], g[2]
            data = bytearray(w * h)
            for r in range(h):
                bits = g[5 + r]
                for col in range(w):
                    if (bits >> (w - 1 - col)) & 1:
                        data[r * w + col] = idx
            self.glyphs[key] = data
        return data

    def text(self, font_name, s, x, baseline, rgb):
        # Same as draw.Frame.text. Glyphs fully inside the clip are copied in
        # one arrayblit; clipped ones (rolls, slides) go pixel by pixel.
        font = draw.assets.FONTS[font_name]
        idx = self._index(rgb)
        bmp = self.bitmap
        c = self.clip or (0, 0, 63, 31)
        cx0, cy0, cx1, cy1 = max(0, c[0]), max(0, c[1]), min(63, c[2]), min(31, c[3])
        for ch in s:
            g = font.get(ord(ch))
            if not g:
                continue
            dw, w, h, xo, yo = g[0], g[1], g[2], g[3], g[4]
            top = baseline - (yo + h)
            left = x + xo
            if idx and w and h and left >= cx0 and top >= cy0 and left + w - 1 <= cx1 and top + h - 1 <= cy1:
                bitmaptools.arrayblit(bmp, self._glyph(font_name, ord(ch), g, idx), left, top, left + w, top + h, 0)
                x += dw
                continue
            for r in range(h):
                yy = top + r
                if yy < cy0 or yy > cy1:
                    continue
                bits = g[5 + r]
                for col in range(w):
                    if (bits >> (w - 1 - col)) & 1:
                        xx = x + xo + col
                        if cx0 <= xx <= cx1:
                            bmp[xx, yy] = idx
            x += dw
        return x

    def draw_radar(self, data):
        # Radar values 1-10 are palette slots 1-10; 0 (nothing) is skipped.
        bitmaptools.arrayblit(self.bitmap, data, 0, 0, 64, 32, 0)

    def set_brightness(self, k):
        self.k = k

    def commit(self):
        k = self.k
        pal = self.palette
        lut, floor = self.lut, self.floor
        for rgb, i in self.colors.items():
            pal[i] = _pack(correct(draw.scale_color(rgb, k) if k != 1 else rgb, lut, floor))
        for v in range(RADAR_FIRST, FREE_FIRST):
            rgb = draw.RADAR[v]
            pal[v] = _pack(correct(draw.scale_color(rgb, k) if k != 1 else rgb, lut, floor))


class Display:
    def __init__(self, bit_depth=5, gamma=1):
        displayio.release_displays()
        matrix = rgbmatrix.RGBMatrix(
            width=64, height=32, bit_depth=bit_depth,
            rgb_pins=[board.MTX_R1, board.MTX_G1, board.MTX_B1, board.MTX_R2, board.MTX_G2, board.MTX_B2],
            addr_pins=[board.MTX_ADDRA, board.MTX_ADDRB, board.MTX_ADDRC, board.MTX_ADDRD],
            clock_pin=board.MTX_CLK, latch_pin=board.MTX_LAT, output_enable_pin=board.MTX_OE,
        )
        self.display = framebufferio.FramebufferDisplay(matrix, auto_refresh=False)
        self.bitmap = displayio.Bitmap(64, 32, 256)
        self.palette = displayio.Palette(256)
        group = displayio.Group()
        group.append(displayio.TileGrid(self.bitmap, pixel_shader=self.palette))
        self.display.root_group = group
        self.frame = BoardFrame(self.bitmap, self.palette, gamma, bit_depth)
        self.last_ms = 0
        self.max_ms = 0

    def show(self, draw_fn):
        t0 = time.monotonic_ns()
        f = self.frame
        f.begin()
        draw_fn(f)
        f.commit()
        self.display.refresh(minimum_frames_per_second=0)
        self.last_ms = (time.monotonic_ns() - t0) // 1000000
        self.max_ms = max(self.max_ms, self.last_ms)


class Clock:
    @staticmethod
    def ms():
        return time.monotonic_ns() // 1000000

    @staticmethod
    def sleep_ms(ms):
        if ms > 0:
            time.sleep(ms / 1000)


class Buttons:
    """UP/DOWN on the Matrix Portal (active low)."""

    def __init__(self):
        self._up = self._pin(board.BUTTON_UP)
        self._down = self._pin(board.BUTTON_DOWN)

    @staticmethod
    def _pin(p):
        d = DigitalInOut(p)
        d.direction = Direction.INPUT
        d.pull = Pull.UP
        return d

    def up(self):
        return not self._up.value

    def down(self):
        return not self._down.value


class Net:
    """Board endpoints over the ESP32 co-processor (contract.md)."""

    def __init__(self, url, board_id, token):
        from adafruit_esp32spi import adafruit_esp32spi
        import adafruit_connection_manager
        import adafruit_requests
        spi = busio.SPI(board.SCK, board.MOSI, board.MISO)
        self.esp = adafruit_esp32spi.ESP_SPIcontrol(
            spi, DigitalInOut(board.ESP_CS), DigitalInOut(board.ESP_BUSY), DigitalInOut(board.ESP_RESET))
        pool = adafruit_connection_manager.get_radio_socketpool(self.esp)
        ssl = adafruit_connection_manager.get_radio_ssl_context(self.esp)
        self.requests = adafruit_requests.Session(pool, ssl)
        self.url = url.rstrip('/')
        self.board_id = board_id
        self.token = token

    @property
    def mac(self):
        b = getattr(self.esp, 'MAC_address_actual', None) or bytes(reversed(self.esp.MAC_address))
        return ':'.join('%02x' % x for x in b)

    def connect(self, networks, status_cb):
        """Try each (ssid, password) in order. Returns ('ok', ssid),
        ('portal', mac) if a network answered with a captive portal, or
        ('nowifi', None)."""
        portal = False
        for ssid, password in networks:
            status_cb('connecting', ssid)
            try:
                if self.esp.is_connected:
                    self.esp.disconnect()
                self.esp.connect_AP(ssid, password)
            except Exception as e:  # noqa: BLE001
                print('[wifi] %s: %r' % (ssid, e))
                continue
            if self.ping():
                return ('ok', ssid)
            portal = True
            print('[wifi] %s: joined, but /board/ping failed (captive portal?)' % ssid)
        return ('portal', self.mac) if portal else ('nowifi', None)

    def _get(self, path, auth=True):
        headers = {'X-Board-Token': self.token} if auth and self.token else {}
        r = self.requests.get(self.url + path, headers=headers, timeout=10)
        if r.status_code != 200:
            code = r.status_code
            r.close()
            raise OSError('HTTP %d for %s' % (code, path))
        return r

    def _json(self, path):
        r = self._get(path)
        try:
            return r.json()
        finally:
            r.close()

    def ping(self):
        try:
            r = self._get('/board/ping', auth=False)
            try:
                return r.json().get('ok') == 1
            finally:
                r.close()
        except Exception:  # noqa: BLE001 - HTML, redirects, timeouts all mean "not our server"
            return False

    def version(self):
        return self._json('/board/version?b=' + self.board_id)

    def update(self, boot):
        return self._json('/board/update?b=' + self.board_id + ('&boot=1' if boot else ''))

    def logo(self, logo_id):
        r = self._get('/board/logo/' + logo_id + '?b=' + self.board_id)
        try:
            data = r.content
        finally:
            r.close()
        if len(data) != 864:
            raise ValueError('logo is %d bytes' % len(data))
        return data

    def radar(self, frame_id):
        r = self._get('/board/radar/' + frame_id + '?b=' + self.board_id)
        try:
            data = r.content
        finally:
            r.close()
        if len(data) != 2048:
            raise ValueError('radar frame is %d bytes' % len(data))
        return data


class Watchdog:
    """Resets the board if the loop stops feeding it (a hung request)."""

    def __init__(self, timeout=60):
        try:
            from microcontroller import watchdog
            from watchdog import WatchDogMode
            watchdog.timeout = timeout
            watchdog.mode = WatchDogMode.RESET
            self.wd = watchdog
        except Exception as e:  # noqa: BLE001
            print('[board] no watchdog: %r' % (e,))
            self.wd = None

    def feed(self):
        if self.wd:
            self.wd.feed()


def cold_boot():
    """True after power-on or the RESET button. False after code.py's
    reload on a crash or a watchdog reset, so those don't reset the board's
    brightness (and light up a board that was switched off)."""
    import microcontroller
    import supervisor
    try:
        if supervisor.runtime.run_reason != supervisor.RunReason.STARTUP:
            return False
        return microcontroller.cpu.reset_reason != microcontroller.ResetReason.WATCHDOG
    except AttributeError:
        return True


class Hardware:
    def __init__(self, url, board_id, token, bit_depth=5, gamma=1):
        self.display = Display(bit_depth, gamma)
        self.clock = Clock()
        self.buttons = Buttons()
        self.net = Net(url, board_id, token)
        self.watchdog = Watchdog()

    @staticmethod
    def mem_free():
        gc.collect()
        return gc.mem_free()
