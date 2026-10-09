# Matrix Portal M4 hardware: the HUB75 matrix, the ESP32 WiFi co-processor,
# the UP/DOWN buttons, the status NeoPixel, and the watchdog. Only imported on the board; the
# rest of boardlib runs under CPython for tests.
#
# Libraries (copy to CIRCUITPY/lib, or `circup install`): adafruit_esp32spi,
# adafruit_requests, adafruit_connection_manager.

import gc
import time
from array import array

import bitmaptools
import board
import busio
import displayio
import framebufferio
import rgbmatrix
from digitalio import DigitalInOut, Direction, Pull

from . import draw

# Palette: 0 is black, 1-10 are the radar values (so a radar frame copies
# straight into the bitmap), then a block per team-logo position (so a logo
# copies in as one indexed blit), and the rest are allocated as colors are
# used. Allocated colors persist across frames (rebuilding the table every
# frame fragmented the heap) and reset only when the palette fills up.
RADAR_FIRST = 1
LOGO_FIRST = 11
LOGO_COLORS = 64  # per logo; the server caps each logo at this (mlb-logos.js MAX_COLORS)
LOGO_POSITIONS = 2  # away (top band) and home
FREE_FIRST = LOGO_FIRST + LOGO_POSITIONS * LOGO_COLORS  # 139
COLOR_RESET = 190  # at a frame start past this slot, forget allocated colors (65 left for one frame)
LOGO_CACHE = 4     # indexed logos kept (current game + next, by position)
RADAR_PACKED = 64 * 32 // 2  # a radar frame as the board stores it: 4 bits a pixel (values 0-10)
GLYPH_CACHE = 96  # glyph bitmaps kept for arrayblit, per font, codepoint, and palette slot
GLYPH_BYTES = 40  # bytes per cached glyph (w * h); bigger glyphs (clock digits) draw pixel by pixel
GLYPH_SLOTS = 128  # hash slots for the glyph cache (power of two, > GLYPH_CACHE)
COLOR_SLOTS = 256  # hash slots for allocated colors (power of two, > the 117 a cycle can use)
# Cache keys are plain ints (small ints don't allocate in CircuitPython):
# colors as 0xRRGGBB, glyphs as font << 24 | codepoint << 8 | slot. Tuple
# keys cost ~32 bytes each to keep, and a new one per glyph per frame.


class IntTable:
    """A fixed-size int -> int map, allocated once at boot. A dict grows by
    reallocating its whole table (73 -> 97 slots is one 776-byte block), and
    on a fragmented heap that block isn't there: the glyph cache's dict did
    exactly that and restarted the board. This never allocates after
    __init__; clear() empties it in place. Keys are ints >= 0; values are
    0-255 (palette slots, glyph pool indexes), so they're kept as bytes."""

    def __init__(self, slots):
        self.mask = slots - 1
        self.keys = array('l', [-1 for _ in range(slots)])
        self.vals = bytearray(slots)
        self.n = 0

    def _find(self, key):
        i = (key ^ (key >> 9)) & self.mask
        keys = self.keys
        while keys[i] != -1 and keys[i] != key:
            i = (i + 1) & self.mask
        return i

    def get(self, key, default=-1):
        i = self._find(key)
        return self.vals[i] if self.keys[i] == key else default

    def put(self, key, val):
        """Callers keep n well under the slot count (see the caps above)."""
        i = self._find(key)
        if self.keys[i] != key:
            self.keys[i] = key
            self.n += 1
        self.vals[i] = val

    def clear(self):
        keys = self.keys
        for i in range(len(keys)):
            keys[i] = -1
        self.n = 0

    def __len__(self):
        return self.n

    def __iter__(self):
        for k in self.keys:
            if k != -1:
                yield k

    def items(self):
        keys, vals = self.keys, self.vals
        for i in range(len(keys)):
            if keys[i] != -1:
                yield keys[i], vals[i]


def _rgb_int(rgb):
    return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]


def _int_rgb(k):
    return ((k >> 16) & 255, (k >> 8) & 255, k & 255)


JOIN_TRIES = 3       # attempts per network before moving on
JOIN_PAUSE_S = 2     # pause between attempts
WARMUP_S = 20        # max wait for the radio to see any network


def _pack(rgb):
    return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]


READ_CHUNK = 256  # bytes per socket read; the ESP32 socket allocates a temp copy of each


def read_into(r, buf):
    """Fill buf from an adafruit_requests Response body. Uses the library's
    _readinto (private, but it's what iter_content uses) so nothing the size
    of buf is allocated; falls back to small iter_content chunks. Reads are
    capped at READ_CHUNK: esp32spi's recv_into allocates a bytes of each
    read's size, so one 2 KB read needs a 2 KB block all the same."""
    mv = memoryview(buf)
    got = 0
    readinto = getattr(r, '_readinto', None)
    if readinto is not None:
        while got < len(buf):
            n = readinto(mv[got:got + READ_CHUNK])
            if not n:
                break
            got += n
    else:
        for chunk in r.iter_content(64):
            n = min(len(chunk), len(buf) - got)
            mv[got:got + n] = chunk[:n]
            got += n
    if got != len(buf):
        raise ValueError('short read: %d of %d bytes' % (got, len(buf)))


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
        # Caches allocated once, here, while the heap is whole (IntTable).
        self.colors = IntTable(COLOR_SLOTS)   # 0xRRGGBB -> palette slot
        self.colors.put(0, 0)
        self.next = FREE_FIRST
        self.k = 1
        self.glyphs = IntTable(GLYPH_SLOTS)   # int key (see GLYPH_CACHE) -> index into glyph_pool
        self.glyph_pool = [bytearray(GLYPH_BYTES) for _ in range(GLYPH_CACHE)]
        self.font_ids = {}
        self.fresh = []          # (0xRRGGBB, slot) allocated since the last commit
        self.committed_k = None  # brightness the palette was last written for
        self.radar_rb = 100      # radar brightness (radar.rb) of palette slots 1-10
        self.logo_cache = {}     # (logo id, position) -> [colors, slots, packed, packed_for]
        self.logo_drawn = {}     # position -> cache entry drawn this frame
        self.logo_written = {}   # position -> (entry, dim, k) last written to the palette

    def begin(self):
        self.bitmap.fill(0)
        if self.next > COLOR_RESET:
            self.colors.clear()
            self.colors.put(0, 0)
            self.next = FREE_FIRST
            self.glyphs.clear()  # keyed by slot
            self.committed_k = None
        self.k = 1
        self.clip = None
        self._clips = []
        self.logo_drawn = {}

    def draw_logo(self, lid, data, x, top, dim):
        """A 24 x 12 RGB logo as one indexed blit. Converted once per logo and
        position into slots of that position's palette block; the colors
        (dimmed, then brightness and gamma) are written in commit(). Same
        pixels as draw_logo_band's per-pixel path, without allocating per pixel."""
        pos = 0 if top < 12 else 1
        key = (lid, pos)
        ent = self.logo_cache.get(key)
        if ent is None:
            if len(self.logo_cache) >= LOGO_CACHE:
                self.logo_cache = {}
            base = LOGO_FIRST + pos * LOGO_COLORS
            cols = []  # 0xRRGGBB
            seen = {}
            slots = bytearray(24 * 12)
            for i in range(24 * 12):
                j = i * 3
                c = (data[j] << 16) | (data[j + 1] << 8) | data[j + 2]
                n = seen.get(c)
                if n is None:
                    n = len(cols)
                    if n >= LOGO_COLORS:
                        n = LOGO_COLORS - 1  # over the server's cap: share the last slot
                    else:
                        cols.append(c)
                        seen[c] = n
                slots[i] = base + n
            ent = [cols, slots, None, None]
            self.logo_cache[key] = ent
        self.logo_drawn[pos] = (ent, dim)
        bitmaptools.arrayblit(self.bitmap, ent[1], x, top, x + 24, top + 12)

    def _index(self, rgb):
        rgb = _rgb_int(rgb)
        i = self.colors.get(rgb)
        if i < 0:
            if self.next > 255:
                return 255  # out of slots: reuse the last (never seen in practice)
            i = self.next
            self.next += 1
            self.colors.put(rgb, i)
            self.fresh.append((rgb, i))
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

    def _glyph(self, font_name, cp, d, o, idx):
        """The glyph as slot bytes for arrayblit (a preallocated pool buffer;
        arrayblit reads only the first w * h bytes), or None when the cache
        is full or the glyph is too big (the caller draws it pixel by pixel)."""
        fid = self.font_ids.get(font_name)
        if fid is None:
            fid = self.font_ids[font_name] = len(self.font_ids)
        key = (fid << 24) | (cp << 8) | idx
        n = self.glyphs.get(key)
        if n >= 0:
            return self.glyph_pool[n]
        w, h = d[o + 1], d[o + 2]
        n = len(self.glyphs)
        if n >= GLYPH_CACHE or n >= len(self.glyph_pool) or w * h > GLYPH_BYTES:
            return None
        data = self.glyph_pool[n]
        for r in range(h):
            bits = draw.glyph_row(d, o, r)
            for col in range(w):
                data[r * w + col] = idx if (bits >> (w - 1 - col)) & 1 else 0
        self.glyphs.put(key, n)
        return data

    def text(self, font_name, s, x, baseline, rgb):
        # Same as draw.Frame.text. Glyphs fully inside the clip are copied in
        # one arrayblit; clipped ones (rolls, slides) go pixel by pixel.
        d = draw.assets.FONT_DATA[font_name]
        idx = self._index(rgb)
        bmp = self.bitmap
        c = self.clip or (0, 0, 63, 31)
        cx0, cy0, cx1, cy1 = max(0, c[0]), max(0, c[1]), min(63, c[2]), min(31, c[3])
        for ch in s:
            cp = ord(ch)
            o = draw.glyph(font_name, cp)
            if o < 0:
                continue
            dw, w, h, xo, yo = d[o], d[o + 1], d[o + 2], d[o + 3] - 128, d[o + 4] - 128
            top = baseline - (yo + h)
            left = x + xo
            if idx and w and h and left >= cx0 and top >= cy0 and left + w - 1 <= cx1 and top + h - 1 <= cy1:
                data = self._glyph(font_name, cp, d, o, idx)
                if data is not None:
                    bitmaptools.arrayblit(bmp, data, left, top, left + w, top + h, 0)
                    x += dw
                    continue
            for r in range(h):
                yy = top + r
                if yy < cy0 or yy > cy1:
                    continue
                bits = draw.glyph_row(d, o, r)
                for col in range(w):
                    if (bits >> (w - 1 - col)) & 1:
                        xx = x + xo + col
                        if cx0 <= xx <= cx1:
                            bmp[xx, yy] = idx
            x += dw
        return x

    def draw_radar(self, data, rb=100):
        # Radar values 1-10 are palette slots 1-10; 0 (nothing) is skipped.
        # A new radar brightness rewrites those slots at commit.
        if rb != self.radar_rb:
            self.radar_rb = rb
            self.committed_k = None
        if len(data) != RADAR_PACKED:
            bitmaptools.arrayblit(self.bitmap, data, 0, 0, 64, 32, 0)
            return
        # Packed (2 pixels a byte, left pixel in the high nibble): set each
        # lit pixel by its linear index (y * 64 + x; an int, so no tuple).
        bmp = self.bitmap
        i = 0
        for b in data:
            if b:
                if b >> 4:
                    bmp[i] = b >> 4
                if b & 15:
                    bmp[i + 1] = b & 15
            i += 2

    def set_brightness(self, k):
        self.k = k

    def commit(self):
        k = self.k
        pal = self.palette
        lut, floor = self.lut, self.floor

        def packed(rgb):
            return _pack(correct(draw.scale_color(rgb, k) if k != 1 else rgb, lut, floor))
        if k != self.committed_k:
            # Brightness changed (or the table reset): rewrite everything.
            for c, i in self.colors.items():
                pal[i] = packed(_int_rgb(c))
            rc = draw.radar_for(self.radar_rb)
            for v in range(RADAR_FIRST, LOGO_FIRST):
                pal[v] = packed(rc[v])
            self.logo_written = {}
            self.committed_k = k
        else:
            for c, i in self.fresh:
                pal[i] = packed(_int_rgb(c))
        self.fresh = []
        for pos, (ent, dim) in self.logo_drawn.items():
            if self.logo_written.get(pos) == (id(ent), dim, k):
                continue
            if ent[3] != (dim, k):
                ent[2] = [packed((draw.jsround((c >> 16) * dim), draw.jsround(((c >> 8) & 255) * dim), draw.jsround((c & 255) * dim))) for c in ent[0]]
                ent[3] = (dim, k)
            base = LOGO_FIRST + pos * LOGO_COLORS
            for n, v in enumerate(ent[2]):
                pal[base + n] = v
            self.logo_written[pos] = (id(ent), dim, k)


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


# Status NeoPixel colors (r, g, b), kept very dim: it sits behind the panel
# and shouldn't light up the wall at night.
LED_COLORS = {
    'off': (0, 0, 0),
    'fetch': (0, 0, 10),        # blue: a request is blocking the loop (the display is frozen)
    'connecting': (8, 6, 0),    # yellow: joining WiFi
    'portal': (10, 3, 0),       # amber: captive portal
    'offline': (12, 0, 0),      # red: no WiFi, or the server isn't answering
    'failing': (3, 0, 0),       # dim red: online, but the last request failed
    'oom': (8, 0, 8),           # magenta (blinks): a MemoryError was caught
    'watchdog': (6, 6, 6),      # white, at startup: the last reset was the watchdog
    'crash': (12, 0, 0),        # red (blinks): code.py caught a crash and restarts in 10 s
}


class StatusLed:
    """The NeoPixel on the Matrix Portal, written with the built-in
    neopixel_write (no neopixel library: a 3-byte buffer, nothing else on
    the heap). mode: 2 = every state, 1 = no fetch light, 0 = never built."""

    def __init__(self, mode=2):
        import neopixel_write
        self._write = neopixel_write.neopixel_write
        self._pin = DigitalInOut(board.NEOPIXEL)
        self._pin.direction = Direction.OUTPUT
        self._buf = bytearray(3)
        self.mode = mode
        self.state = None
        self.set('off')

    def set(self, name):
        if self.mode < 2 and name == 'fetch':
            name = 'off'
        if name == self.state:
            return
        self.state = name
        r, g, b = LED_COLORS.get(name, LED_COLORS['off'])
        buf = self._buf
        buf[0] = g  # the NeoPixel takes GRB
        buf[1] = r
        buf[2] = b
        self._write(self._pin, buf)


_led = []


def status_led():
    """The one StatusLed (the pin can only be claimed once), or None when
    STATUS_LED = 0 in settings.toml or the pixel can't be set up. Shared
    with code.py's crash blink."""
    if not _led:
        import os
        v = os.getenv('STATUS_LED')  # settings.toml ints come back as ints; 0 is falsy
        mode = 2 if v is None or v == '' else int(v)
        led = None
        if mode > 0:
            try:
                led = StatusLed(mode)
            except Exception as e:  # noqa: BLE001 - the board runs fine without it
                print('[board] no status LED: %r' % (e,))
        _led.append(led)
    return _led[0]


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
        self._pool = pool
        self._close_all = adafruit_connection_manager.connection_manager_close_all
        self.url = url.rstrip('/')
        self.board_id = board_id
        self.token = token
        self.feed = None  # watchdog feed, set by Hardware

    @property
    def mac(self):
        b = getattr(self.esp, 'MAC_address_actual', None) or bytes(reversed(self.esp.MAC_address))
        return ':'.join('%02x' % x for x in b)

    def connect(self, networks, status_cb):
        """Try each (ssid, password) in order, networks the radio can see
        first. Returns ('ok', ssid), ('portal', mac) if a network answered
        with a captive portal, or ('nowifi', None)."""
        portal = False
        seen = self._warm_up(status_cb)
        if seen:
            networks = [n for n in networks if n[0] in seen] + [n for n in networks if n[0] not in seen]
        for ssid, password in networks:
            if not self._join(ssid, password, status_cb):
                continue
            # A fresh join can fail its first request (DHCP/DNS still
            # settling), so one failed ping doesn't mean a captive portal.
            if self.ping() or (time.sleep(JOIN_PAUSE_S) or self.ping()):
                return ('ok', ssid)
            portal = True
            print('[wifi] %s: joined, but /board/ping failed (captive portal?)' % ssid)
        if not portal:
            self._reset_radio('no network joined')  # start the next round clean
        return ('portal', self.mac) if portal else ('nowifi', None)

    def _reset_radio(self, why):
        """Hardware-reset the ESP32. After failed joins it can keep
        reporting 'No such ssid' for visible networks, then stop answering
        commands (BrokenPipeError) until it's reset."""
        print('[wifi] resetting radio: %s' % why)
        try:
            self._close_all(self._pool)  # sockets from before the reset are dead
        except Exception:  # noqa: BLE001
            pass
        self.esp.reset()

    def _warm_up(self, status_cb):
        """After a reset the ESP32 answers before its radio is ready, and
        every join fails with 'No such ssid'. Scan until it sees any network
        (up to WARMUP_S), logging what it sees. A failed scan means the
        ESP32 is wedged: reset it and keep scanning. Returns the SSIDs seen."""
        end = time.monotonic() + WARMUP_S
        while True:
            status_cb('connecting', None)  # feeds the watchdog
            try:
                seen = self.esp.scan_networks()
            except Exception as e:  # noqa: BLE001
                seen = []
                print('[wifi] scan failed: %r' % (e,))
                self._reset_radio('scan failed')
            if seen:
                names = []
                for ap in seen:
                    n = ap.ssid if hasattr(ap, 'ssid') else ap['ssid']
                    n = n.decode('utf-8') if isinstance(n, bytes) else n
                    if n and n not in names:
                        names.append(n)
                print('[wifi] radio ready; sees: %s' % ', '.join(names))
                return names
            if time.monotonic() > end:
                print('[wifi] radio still sees nothing after %d s' % WARMUP_S)
                return []
            time.sleep(1)

    def _join(self, ssid, password, status_cb):
        """Join one network, with a few tries (a hotspot can drop out of a
        scan now and then). status_cb feeds the watchdog before each try.
        Always disconnects first: a failed join leaves the ESP32's status at
        'No such ssid', and without a disconnect the next join (even to a
        visible network) reports it too."""
        # After a soft reboot the ESP32 is often still on this network:
        # dropping and rejoining failed the first try, ~12 s at every boot.
        try:
            if self.esp.is_connected and self.esp.ap_info.ssid == ssid:
                print('[wifi] %s: still connected' % ssid)
                return True
        except Exception:  # noqa: BLE001 - fall through to a fresh join
            pass
        for attempt in range(JOIN_TRIES):
            status_cb('connecting', ssid)
            try:
                self.esp.disconnect()
            except Exception:  # noqa: BLE001 - not connected: nothing to drop
                pass
            try:
                self.esp.connect_AP(ssid, password)
                return True
            except Exception as e:  # noqa: BLE001
                print('[wifi] %s: try %d/%d: %r' % (ssid, attempt + 1, JOIN_TRIES, e))
                time.sleep(JOIN_PAUSE_S)
        return False

    def _get(self, path, auth=True):
        if self.feed:
            self.feed()
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

    def version(self, health=''):
        """health: '&h...=' query fields (app.Board builds them)."""
        return self._json('/board/version?b=' + self.board_id + health)

    def rssi(self):
        return self.esp.rssi

    def update(self, boot, screen=None):
        """screen: a button-pressed screen whose sections to send."""
        return self._json('/board/update?b=' + self.board_id + ('&boot=1' if boot else '') + ('&s=' + screen if screen else ''))

    def logo(self, logo_id, buf):
        """Read one logo (864 bytes) into buf, like radar()."""
        r = self._get('/board/logo/' + logo_id + '?b=' + self.board_id)
        try:
            size = r.headers.get('content-length')
            if size != str(len(buf)):
                raise ValueError('logo is %s bytes' % size)
            read_into(r, buf)
        finally:
            r.close()

    def radar(self, frame_id, buf):
        """Read one frame into buf (1024 bytes, packed 4 bits a pixel:
        pk=4) without allocating it: r.content builds a fresh bytes, which
        a fragmented heap may not fit."""
        r = self._get('/board/radar/' + frame_id + '?b=' + self.board_id + '&pk=4')
        try:
            size = r.headers.get('content-length')
            if size != str(len(buf)):
                raise ValueError('radar frame is %s bytes' % size)
            read_into(r, buf)
        finally:
            r.close()


WATCHDOG_S = 16  # the SAMD51's maximum


class Watchdog:
    """Resets the board if the loop stops feeding it (a hung request). The
    loop feeds it every pass, and Net feeds it before each request, so one
    request gets the whole WATCHDOG_S."""

    def __init__(self, timeout=WATCHDOG_S):
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
    def __init__(self, url, board_id, token, bit_depth=5, gamma=1, note=None):
        note = note or (lambda stage: None)  # startup memory report
        self.display = Display(bit_depth, gamma)
        note('display')
        self.clock = Clock()
        self.buttons = Buttons()
        self.net = Net(url, board_id, token)
        note('net libs')
        self.watchdog = Watchdog()
        self.net.feed = self.watchdog.feed
        self.led = status_led()

    @staticmethod
    def largest_block():
        """Largest single allocation the heap can take right now (bytes,
        within 64): the fragmentation measure. Free memory alone can look
        fine while no contiguous block is big enough."""
        gc.collect()
        lo, hi = 0, gc.mem_free()
        while hi - lo > 64:
            mid = (lo + hi) // 2
            try:
                b = bytearray(mid)
                del b
                lo = mid
            except MemoryError:
                hi = mid
        gc.collect()
        return lo

    @staticmethod
    def mem_free():
        gc.collect()
        return gc.mem_free()
