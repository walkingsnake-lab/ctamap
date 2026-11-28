"""Draw the schematic for the Trackside V7 board from the same parts table the board is built from (gen_board.PARTS).
    python3 gen_sch.py        writes ../board/trackside-v7.kicad_sch, then check_sch.py compares its netlist with the board's
One A3 sheet, in blocks. Nets are joined by name (labels and power symbols), not by long wires."""
import math, os, re, sys, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sx import Q, parse, dump, find
import gen_board as GB

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'board'))
KSYM = '/usr/share/kicad/symbols'
PROJECT = 'trackside-v7'
ROOT = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'trackside-v7.sch'))
POWER = ('GND', '+5V', '+3V3')
_n = [0]


def uid():
    _n[0] += 1
    return Q(str(uuid.uuid5(uuid.NAMESPACE_DNS, f'trackside-v7.{_n[0]}')))


def g(v):
    return round(round(v / 1.27) * 1.27, 4)


def F(v):
    return ('%.4f' % v).rstrip('0').rstrip('.') if abs(v) > 1e-9 else '0'


# ---------------------------------------------------------------- symbol libraries
def lib_symbol(path, name):
    """one symbol's text out of a library file, parsed"""
    t = open(path, encoding='utf-8').read()
    i = t.index('\n  (symbol "%s"' % name) + 3
    depth, j, q = 0, i, False
    while True:
        c = t[j]
        if q:
            if c == '\\': j += 1
            elif c == '"': q = False
        elif c == '"': q = True
        elif c == '(': depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0: break
        j += 1
    return parse(t[i:j + 1])


def clean(sym, nick):
    """ready to embed in a schematic: library nickname on the name, old (id n) fields dropped"""
    assert not find(sym, 'extends'), sym[1]
    out = ['symbol', Q(nick + ':' + sym[1])]
    for c in sym[2:]:
        if isinstance(c, list) and c[0] == 'property':
            c = [x for x in c if not (isinstance(x, list) and x[0] == 'id')]
        out.append(c)
    return out


def box_symbol(name, ref, w, h, pins):
    """a plain rectangle with pins: for the parts that have no library symbol. pins: (number, name, x, y, angle)"""
    eff = ['effects', ['font', ['size', '1.27', '1.27']]]
    s = ['symbol', Q(name), ['in_bom', 'yes'], ['on_board', 'yes'],
         ['property', Q('Reference'), Q(ref), ['at', '0', F(h / 2 + 2.54), '0'], eff],
         ['property', Q('Value'), Q(name), ['at', '0', F(-h / 2 - 2.54), '0'], eff],
         ['property', Q('Footprint'), Q(''), ['at', '0', '0', '0'], ['effects', ['font', ['size', '1.27', '1.27']], 'hide']],
         ['property', Q('Datasheet'), Q(''), ['at', '0', '0', '0'], ['effects', ['font', ['size', '1.27', '1.27']], 'hide']],
         ['symbol', Q(name + '_0_1'), ['rectangle', ['start', F(-w / 2), F(h / 2)], ['end', F(w / 2), F(-h / 2)],
                                      ['stroke', ['width', '0.254'], ['type', 'default']], ['fill', ['type', 'background']]]]]
    body = ['symbol', Q(name + '_1_1')]
    for num, nm, x, y, a in pins:
        body.append(['pin', 'passive', 'line', ['at', F(x), F(y), str(a)], ['length', '2.54'],
                     ['name', Q(nm), eff], ['number', Q(num), eff]])
    s.append(body)
    return s


JLC = os.path.join(OUT, 'jlc.kicad_sym')
LIBS = {}                                            # lib_id -> embedded symbol
for nm in ('ESP32-S3-WROOM-1', 'TYPE-C16PLT-H6.5', 'USBLC6-2SC6', 'TS-1187A-B-A-B', 'WS2812B-2020-V6', 'AP2112K-3.3TRG1',
           'DC3-2.54-16PAS', 'SN74AHCT245PWR', 'PEC11R-4220F-S0024', 'VEML7700-TT'):
    LIBS['jlc:' + nm] = clean(lib_symbol(JLC, nm), 'jlc')
for lib, nm in (('Device', 'R'), ('Device', 'C'), ('Connector', 'TestPoint'), ('power', 'GND'), ('power', '+5V'), ('power', '+3V3')):
    LIBS[f'{lib}:{nm}'] = clean(lib_symbol(f'{KSYM}/{lib}.kicad_sym', nm), lib)
LIBS['trackside:SM04B-SRSS-TB'] = clean(box_symbol('SM04B-SRSS-TB', 'J', 10.16, 17.78,
    [('1', 'GND', -7.62, 6.35, 0), ('2', '3V3', -7.62, 3.81, 0), ('3', 'SDA', -7.62, 1.27, 0), ('4', 'SCL', -7.62, -1.27, 0),
     ('5', 'MP', -7.62, -3.81, 0), ('6', 'MP', -7.62, -6.35, 0)]), 'trackside')
LIBS['trackside:M3_SMT_nut'] = clean(box_symbol('M3_SMT_nut', 'H', 7.62, 5.08, [('1', '1', -6.35, 0, 0)]), 'trackside')


def pins_of(lib_id):
    out = {}
    for sub in find(LIBS[lib_id], 'symbol'):
        for p in find(sub, 'pin'):
            at = find(p, 'at')[0]
            out[str(find(p, 'number')[0][1])] = (float(at[1]), float(at[2]), int(float(at[3])) % 360, float(find(p, 'length')[0][1]))
    return out


def prop_at(lib_id, name):
    for p in find(LIBS[lib_id], 'property'):
        if p[1] == name:
            at = find(p, 'at')[0]
            return float(at[1]), float(at[2])
    return 0.0, 0.0


SYM = {'U3': 'jlc:ESP32-S3-WROOM-1', 'J1': 'jlc:TYPE-C16PLT-H6.5', 'U4': 'jlc:USBLC6-2SC6', 'SW1': 'jlc:TS-1187A-B-A-B',
       'SW2': 'jlc:TS-1187A-B-A-B', 'D1': 'jlc:WS2812B-2020-V6', 'D2': 'jlc:WS2812B-2020-V6', 'U2': 'jlc:AP2112K-3.3TRG1',
       'J2': 'jlc:DC3-2.54-16PAS', 'U5': 'jlc:SN74AHCT245PWR', 'U1': 'jlc:SN74AHCT245PWR', 'SW3': 'jlc:PEC11R-4220F-S0024',
       'U6': 'jlc:VEML7700-TT', 'J3': 'trackside:SM04B-SRSS-TB', 'H1': 'trackside:M3_SMT_nut', 'H2': 'trackside:M3_SMT_nut'}

# ---------------------------------------------------------------- where each part goes on the sheet (mm, A2 landscape)
BLOCKS = [  # title, x0, y0, x1, y1, note
    ('USB-C in, ESD, panel power out', 15, 15, 150, 100,
     'CC1/CC2: 5.1k to ground = a USB-C sink. +5V is VBUS, straight to the panel nuts (no switch, no fuse: as Adafruit).'),
    ('3.3 V regulator, test pads', 154, 15, 246, 100, 'AP2112K-3.3: 600 mA. EN tied to +5V.'),
    ('Knob light, status light', 250, 15, 331, 100, 'WS2812B-2020 on 3.3 V, data straight from the ESP32 (as Adafruit). DO unused.'),
    ('Light sensor, I2C', 335, 15, 408, 100, 'J3 takes an external sensor board on the same bus.'),
    ('ESP32-S3 module', 15, 104, 166, 285,
     'N8R2: quad flash and PSRAM, so GPIO 35-37 are free. EN: 10k / 1 uF. IO1: 1M / 1 uF = double-tap reset (TinyUF2). USB on IO19/IO20.'),
    ('HUB75 level shifters and header', 170, 104, 296, 285,
     'SN74AHCT245 on 5 V: 3.3 V in, 5 V out. DIR = +5V (A to B), /OE = GND. OE_3V pulled up: panel blank until the firmware runs.'),
    ('Knob encoder', 300, 104, 408, 250, 'Read directly by the ESP32. Each line: 10k pull-up, 10 nF to ground.'),
]
AT = {  # ref: (x, y)
    'J1': (45, 52), 'U4': (108, 48), 'R1': (25, 80), 'R2': (40, 80), 'C3': (58, 80), 'C1': (78, 80), 'C2': (95, 80),
    'H2': (136, 74), 'H1': (136, 86),
    'U2': (200, 42), 'C5': (168, 78), 'C6': (184, 78), 'TP7': (203, 76), 'TP5': (218, 76), 'TP6': (233, 78),
    'D1': (287, 38), 'C12': (318, 40), 'D2': (287, 72), 'C13': (318, 74),
    'U6': (376, 38), 'C18': (397, 40), 'R9': (345, 78), 'R10': (360, 78), 'J3': (394, 76),
    'U3': (88, 188), 'R6': (25, 130), 'C14': (40, 130), 'C16': (60, 130), 'C17': (78, 130), 'TP1': (105, 130), 'TP2': (122, 130),
    'R7': (25, 250), 'C15': (40, 250), 'SW1': (146, 185), 'SW2': (146, 215),
    'U5': (205, 145), 'U1': (205, 205), 'J2': (268, 175), 'C7': (245, 128), 'C8': (262, 128), 'R8': (250, 240),
    'SW3': (354, 142), 'R3': (325, 185), 'R4': (354, 185), 'R5': (383, 185), 'C9': (325, 220), 'C10': (354, 220), 'C11': (383, 220),
}
FIELD = {  # ref: reference and value positions, as offsets from the part, where the library's would sit on a pin
    'U3': ((0, -24.5), (0, -22.0)), 'SW3': ((-13, -13.5), (-13, -11.0)), 'J1': ((-11.5, -18.5), (-11.5, -16.0)),
}

ITEMS = []                                           # everything on the sheet, in order
PWR = [0]


def rot(x, y, deg):
    """turn a screen offset counter-clockwise (as KiCad turns a symbol)"""
    c, s = round(math.cos(math.radians(deg))), round(math.sin(math.radians(deg)))
    return x * c + y * s, -x * s + y * c


def eff(size=1.27, just=None, hide=False):
    e = ['effects', ['font', ['size', F(size), F(size)]]]
    if just: e.append(['justify'] + just.split())
    if hide: e.append('hide')
    return e


def inst(ref):
    return ['instances', ['project', Q(PROJECT), ['path', Q('/' + ROOT), ['reference', Q(ref)], ['unit', '1']]]]


def wire(a, c):
    ITEMS.append(['wire', ['pts', ['xy', F(a[0]), F(a[1])], ['xy', F(c[0]), F(c[1])]], ['stroke', ['width', '0'], ['type', 'default']], uid_()])


def uid_():
    return ['uuid', uid()]


def power(name, x, y, d):
    """a power symbol at the end of a stub that runs in direction d"""
    up = name != 'GND'                               # +5V and +3V3 draw upward, GND downward
    want = {(0, -1): 0, (0, 1): 180, (-1, 0): 90, (1, 0): 270}[d] if up else {(0, 1): 0, (0, -1): 180, (-1, 0): 270, (1, 0): 90}[d]
    PWR[0] += 1
    vx, vy = (x + d[0] * (4.6 + 0.55 * len(name)), y) if d[0] else (x, y + d[1] * 4.6)
    ITEMS.append(['symbol', ['lib_id', Q('power:' + name)], ['at', F(x), F(y), str(want)], ['unit', '1'], ['in_bom', 'yes'], ['on_board', 'yes'], ['dnp', 'no'],
                  uid_(),
                  ['property', Q('Reference'), Q('#PWR%03d' % PWR[0]), ['at', F(x), F(y), '0'], eff(hide=True)],
                  ['property', Q('Value'), Q(name), ['at', F(vx), F(vy), '90' if want in (90, 270) else '0'], eff(hide=(name == 'GND' and d[0] != 0))],   # a sideways ground needs no caption
                  ['property', Q('Footprint'), Q(''), ['at', F(x), F(y), '0'], eff(hide=True)],
                  ['property', Q('Datasheet'), Q(''), ['at', F(x), F(y), '0'], eff(hide=True)],
                  ['pin', Q('1'), uid_()], inst('#PWR%03d' % PWR[0])])


def label(name, x, y, d, flat):
    if d[0] or flat:                                 # horizontal text
        left = d[0] < 0
        ITEMS.append(['label', Q(name), ['at', F(x), F(y), '180' if left else '0'], eff(just='right bottom' if left else 'left bottom'), uid_()])
    else:
        down = d[1] > 0
        ITEMS.append(['label', Q(name), ['at', F(x), F(y), '270' if down else '90'], eff(just='right bottom' if down else 'left bottom'), uid_()])


def place(ref, lib_id, value, footprint, lcsc, nets):
    x, y = g(AT[ref][0]), g(AT[ref][1])
    pins = pins_of(lib_id)
    small = len(pins) <= 2
    turn = 0
    if small:                                        # two-pin parts and test pads: supply at the top, ground at the bottom
        for num, (px, py, a, L) in pins.items():
            n = nets.get(num)
            top = py > 0 or (len(pins) == 1 and a == 270)
            if len(pins) == 1:
                top = False                          # a test pad's lead points down
            if (n == 'GND' and top) or (n in ('+5V', '+3V3') and not top):
                turn = 180
    sym = ['symbol', ['lib_id', Q(lib_id)], ['at', F(x), F(y), str(turn)], ['unit', '1'], ['in_bom', 'yes'], ['on_board', 'yes'], ['dnp', 'no'], uid_()]
    if small:
        rx, ry, vx, vy, just = x + 2.54, y - 1.27, x + 2.54, y + 1.27, ('left' if turn == 0 else 'right')   # a turned part's text is drawn mirrored
        if len(pins) == 1:
            rx, ry, vx, vy = x + 2.54, y - 3.81 if turn == 0 else y + 3.81, x + 2.54, y - 1.9 if turn == 0 else y + 5.7
    elif ref in FIELD:
        (ax, ay), (bx, by) = FIELD[ref]
        rx, ry, vx, vy, just = x + ax, y + ay, x + bx, y + by, None
    else:
        (ax, ay), (bx, by) = prop_at(lib_id, 'Reference'), prop_at(lib_id, 'Value')
        rx, ry, vx, vy, just = x + ax, y - ay, x + bx, y - by, None
    sym += [['property', Q('Reference'), Q(ref), ['at', F(rx), F(ry), '0'], eff(just=just)],
            ['property', Q('Value'), Q(value), ['at', F(vx), F(vy), '0'], eff(just=just)],
            ['property', Q('Footprint'), Q(footprint), ['at', F(x), F(y), '0'], eff(hide=True)],
            ['property', Q('Datasheet'), Q(''), ['at', F(x), F(y), '0'], eff(hide=True)]]
    if lcsc:
        sym.append(['property', Q('LCSC'), Q(lcsc), ['at', F(x), F(y), '0'], eff(hide=True)])
    for num in pins:
        sym.append(['pin', Q(num), uid_()])
    sym.append(inst(ref))
    ITEMS.append(sym)
    missing = set(nets) - set(pins)
    assert not missing, (ref, lib_id, 'pads with no symbol pin', missing)
    for num, (px, py, a, L) in pins.items():
        ox, oy = rot(px, -py, turn)
        cx, cy = x + ox, y + oy                      # the pin's end
        dx, dy = rot(-round(math.cos(math.radians(a))), round(math.sin(math.radians(a))), turn)   # away from the body
        d = (int(dx), int(dy))
        n = nets.get(num)
        if n is None:
            ITEMS.append(['no_connect', ['at', F(cx), F(cy)], uid_()])
            continue
        stub = 2.54 if (small or d[0]) else 3.81      # a little longer below a big part: its labels are written downward
        ex, ey = cx + d[0] * stub, cy + d[1] * stub
        wire((cx, cy), (ex, ey))
        if n in POWER:
            power(n, ex, ey, d)
        else:
            label(n, ex, ey, d, flat=small)


def text(s, x, y, size=1.27, bold=False):
    f = ['font', ['size', F(size), F(size)]] + ([['thickness', F(size / 5)], 'bold'] if bold else [])
    ITEMS.append(['text', Q(s), ['at', F(x), F(y), '0'], ['effects', f, ['justify', 'left', 'bottom']], uid_()])


def build():
    for title, x0, y0, x1, y1, note in BLOCKS:
        pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
        ITEMS.append(['polyline', ['pts'] + [['xy', F(a), F(b)] for a, b in pts], ['stroke', ['width', '0.15'], ['type', 'dash']], ['fill', ['type', 'none']], uid_()])
        text(title, x0 + 3, y0 + 6.5, 2.2, True)
        words, line, yy = note.split(), '', y1 - 2.5 - 2.2 * (len(note) * 1.12 // max(1, (x1 - x0 - 6)))
        for w in words:                              # wrap the note to the block's width
            if (len(line) + len(w) + 1) * 1.12 > x1 - x0 - 6:
                text(line, x0 + 3, yy); yy += 2.2; line = w
            else:
                line = (line + ' ' + w).strip()
        text(line, x0 + 3, yy)
    for ref, lib, name, value, lcsc, side, x, y, r, pads in GB.PARTS:
        nets = {str(k): v for k, v in pads.items()}
        lib_id = SYM.get(ref) or ('Device:R' if ref.startswith('R') else 'Device:C' if ref.startswith('C') else 'Connector:TestPoint')
        nick = os.path.basename(lib).replace('.pretty', '')
        place(ref, lib_id, value, f'{nick}:{name}', lcsc, nets)
    used = sorted({i[1][1] for i in ITEMS if i[0] == 'symbol'})
    sch = ['kicad_sch', ['version', '20230121'], ['generator', 'eeschema'], ['uuid', Q(ROOT)], ['paper', Q('A3')],
           ['title_block', ['title', Q('Trackside V7 controller board')], ['date', Q('2026-11-27')], ['rev', Q('A draft')],
            ['comment', '1', Q('Circuit derived from the Adafruit Matrix Portal S3 (Limor Fried/Ladyada, CC BY-SA).')],
            ['comment', '2', Q('Drawn by script from the board\'s parts table. Not electrically reviewed.')]],
           ['lib_symbols'] + [LIBS[k] for k in used]] + ITEMS + [['sheet_instances', ['path', Q('/'), ['page', Q('1')]]]]
    path = os.path.join(OUT, PROJECT + '.kicad_sch')
    open(path, 'w', encoding='utf-8').write(dump(sch) + '\n')
    print('wrote', path, '|', sum(1 for i in ITEMS if i[0] == 'symbol' and not i[1][1].startswith('power:')), 'parts,', PWR[0], 'power symbols')


if __name__ == '__main__':
    build()
