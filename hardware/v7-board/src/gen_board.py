"""Trackside V7 controller board: schematic (as a netlist), placement and board file, generated with KiCad 7's pcbnew.

    python3 gen_board.py            # writes ../board/trackside-v7.kicad_pcb (UNROUTED: it replaces the routed board; run build_all.py for the whole chain), netlist.csv, bom-jlc.csv

Positions are given in the CASE's coordinates (v7.py: x to the right seen from the front, y back from the front edge),
because that is where they were fitted. The board file's own coordinates are the view from BELOW (the side with most
parts): X = BX1 - x, Y = BY1 - y, plus ORG. F.Cu is the underside in the case, B.Cu the side facing the case's top.
Nothing here has been electrically reviewed.
"""
import csv, math, os, sys
import pcbnew
from pcbnew import FromMM, ToMM, VECTOR2I

OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'board'))       # the KiCad project and everything made from it
JLC = os.path.join(OUT, 'jlc.pretty')
KI = '/usr/share/kicad/footprints'
os.makedirs(OUT, exist_ok=True)

# ---- the board's place in the case (v7.py)
BX0, BX1, BY0, BY1 = 6.0, 98.0, 30.0, 59.5
STEP = (83.5, 41.5)
NOTCH = (74.9, 77.1, 49.5); FLARE = 1.5
KX, KY = 65.0, 41.9
SX = KX - 16.1
USB_XY = (90.5, 53.5)
BTN = ((81.0, 46.0), (81.0, 53.0))
STATUS = (94.3, 46.5)
NUTS = ((60.5, 54.5), (69.5, 54.5))
ORG = (100.0, 100.0)
PCB_T = 1.2
EDGE_KEEP = 0.2
SPINE = [(68.0, 46.2), (97.3, 46.2), (97.3, 49.2), (92.4, 49.2), (92.4, 50.6), (88.6, 50.6), (88.6, 49.2), (74.2, 49.2), (74.2, 57.6), (68.0, 57.6)]


def P(x, y):
    """case (x, y) -> board file point"""
    return VECTOR2I(FromMM(ORG[0] + BX1 - x), FromMM(ORG[1] + BY1 - y))


def case_xy(pt):
    return BX1 - (ToMM(pt.x) - ORG[0]), BY1 - (ToMM(pt.y) - ORG[1])


# ---- parts: ref -> (library, footprint, value, LCSC, side, case x, case y, rotation, {pad: net})
J, K = JLC, KI
R0603, C0603, C0805 = (J, 'R0603'), (J, 'C0603'), (J, 'C0805')
V3, V5, G = '+3V3', '+5V', 'GND'
MOD = {1: G, 2: V3, 3: 'EN', 4: 'STATUS_PIX', 9: 'SDA', 10: 'SCL', 13: 'USB_DM', 14: 'USB_DP',
       17: 'ENC_A', 18: 'ENC_B', 19: 'ENC_SW', 20: 'KNOB_PIX', 22: 'OE_3V', 23: 'E_3V', 24: 'LAT_3V', 25: 'C_3V', 26: 'A_3V', 27: 'BOOT',
       28: 'D_3V', 29: 'B_3V', 30: 'B2_3V', 31: 'R2_3V', 32: 'G2_3V', 33: 'B1_3V', 34: 'G1_3V', 35: 'R1_3V', 36: 'RXD0', 37: 'TXD0',
       38: 'CLK_3V', 39: 'DBLTAP', 40: G, 41: G}
PARTS = [
    # --- underside (F.Cu)
    ('U3', J, 'WIRELM-SMD_ESP32-S3-WROOM-1', 'ESP32-S3-WROOM-1-N8R2', 'C2913204', 'F', None, None, 270, MOD),      # placed below: antenna to the left end
    ('J1', J, 'USB-C-SMD_SOUHAN_TYPE-C-16PLT-H6.5', 'TYPE-C 16PLT-H6.5', 'C3151748', 'F', USB_XY[0], USB_XY[1], 0,
     {'A1': G, 'A12': G, 'B1': G, 'B12': G, '0': G, 'A4': V5, 'A9': V5, 'B4': V5, 'B9': V5, 'A5': 'CC1', 'B5': 'CC2',
      'A6': 'USB_DP', 'B6': 'USB_DP', 'A7': 'USB_DM', 'B7': 'USB_DM'}),
    ('U4', J, 'SOT-23-6_L2.9-W1.6-P0.95-LS2.8-BL', 'USBLC6-2SC6', 'C7519', 'F', 90.5, 46.2, 0, {6: 'USB_DP', 2: G, 4: 'USB_DM', 5: V5}),   # pins 6 and 4 face the socket; 1 and 3 are the same lines inside the part: left open
    ('R1', *R0603, '5.1k', 'C23186', 'F', 86.0, 58.3, 0, {1: 'CC1', 2: G}),
    ('R2', *R0603, '5.1k', 'C23186', 'F', 94.9, 50.3, 90, {1: 'CC2', 2: G}),   # in front of the socket, where CC2's pad is
    ('SW1', J, 'SW-SMD_4P-L5.1-W5.1-P3.70-LS6.5-TL_H1.5', 'BOOT', 'C318884', 'F', BTN[0][0], BTN[0][1], 0, {1: 'BOOT', 4: G}),
    ('SW2', J, 'SW-SMD_4P-L5.1-W5.1-P3.70-LS6.5-TL_H1.5', 'RESET', 'C318884', 'F', BTN[1][0], BTN[1][1], 0, {1: 'EN', 4: G}),
    ('D2', J, 'LED-SMD_4P-L2.2-W2.0-P1.00_WS2815C-2020-4P', 'WS2812B-2020 status', 'C52917434', 'F', STATUS[0], STATUS[1], 0, {2: G, 3: 'STATUS_PIX', 4: V3}),
    ('C13', *C0603, '100nF', 'C14663', 'F', 94.3, 44.3, 0, {1: V3, 2: G}),
    ('C3', *C0805, '22uF', 'C45783', 'F', 86.6, 49.7, 0, {1: V5, 2: G}),
    ('H1', J, 'SMD_BD5.6-D4.1', 'M3 nut GND', 'C2915308', 'F', NUTS[0][0], NUTS[0][1], 0, {1: G}),
    ('H2', J, 'SMD_BD5.6-D4.1', 'M3 nut +5V', 'C2915308', 'F', NUTS[1][0], NUTS[1][1], 0, {1: V5}),
    ('C1', *C0805, '22uF', 'C45783', 'F', 65.0, 51.2, 0, {1: V5, 2: G}),
    ('C2', *C0805, '22uF', 'C45783', 'F', 55.3, 56.5, 90, {1: V5, 2: G}),
    ('U2', J, 'SOT-25-5_L2.9-W1.6-P0.95-LS2.8-BL', 'AP2112K-3.3', 'C51118', 'F', 49.5, 55.3, 0, {1: V5, 2: G, 3: V5, 5: V3}),
    ('C5', *C0805, '10uF', 'C15850', 'F', 52.5, 52.3, 0, {1: V5, 2: G}),
    ('C6', *C0805, '10uF', 'C15850', 'F', 46.5, 52.3, 0, {1: V3, 2: G}),
    ('J2', J, 'IDC-TH_16P-P2.54_C3406', 'HUB75 2x8', 'C2977594', 'F', 41.0, 35.05, 0,
     {1: 'HUB_R1', 2: 'HUB_G1', 3: 'HUB_B1', 4: G, 5: 'HUB_R2', 6: 'HUB_G2', 7: 'HUB_B2', 8: 'HUB_E', 9: 'HUB_A', 10: 'HUB_B',
      11: 'HUB_C', 12: 'HUB_D', 13: 'HUB_CLK', 14: 'HUB_LAT', 15: 'HUB_OE', 16: G}),
    ('U5', J, 'TSSOP-20_L6.5-W4.4-P0.65-LS6.4-BL', 'SN74AHCT245PWR', 'C10910', 'F', 40.5, 45.6, 180,   # outputs toward the header
     {1: V5, 2: 'R1_3V', 3: 'G1_3V', 4: 'B1_3V', 5: 'G2_3V', 6: 'R2_3V', 7: 'B2_3V', 8: 'CLK_3V', 9: 'B_3V', 10: G, 11: 'HUB_B', 12: 'HUB_CLK',
      13: 'HUB_B2', 14: 'HUB_R2', 15: 'HUB_G2', 16: 'HUB_B1', 17: 'HUB_G1', 18: 'HUB_R1', 19: G, 20: V5}),
    ('U1', J, 'TSSOP-20_L6.5-W4.4-P0.65-LS6.4-BL', 'SN74AHCT245PWR', 'C10910', 'F', 50.0, 45.6, 180,
     {1: V5, 2: G, 3: G, 4: 'D_3V', 5: 'A_3V', 6: 'C_3V', 7: 'LAT_3V', 8: 'E_3V', 9: 'OE_3V', 10: G, 11: 'HUB_OE', 12: 'HUB_E',
      13: 'HUB_LAT', 14: 'HUB_C', 15: 'HUB_A', 16: 'HUB_D', 19: G, 20: V5}),
    ('C7', *C0603, '100nF', 'C14663', 'F', 40.5, 50.6, 0, {1: V5, 2: G}),
    ('C8', *C0603, '100nF', 'C14663', 'F', 55.0, 46.4, 90, {1: V5, 2: G}),
    ('R8', *R0603, '10k', 'C25804', 'F', 45.2, 50.6, 0, {1: 'OE_3V', 2: V3}),
    ('R9', *R0603, '5.1k', 'C23186', 'F', 40.0, 56.5, 0, {1: 'SDA', 2: V3}),
    ('R10', *R0603, '5.1k', 'C23186', 'F', 43.3, 56.5, 0, {1: 'SCL', 2: V3}),
    ('R3', *R0603, '10k', 'C25804', 'F', 58.3, 31.2, 0, {1: 'ENC_A', 2: V3}),
    ('C9', *C0603, '10nF', 'C57112', 'F', 58.3, 33.0, 0, {1: 'ENC_A', 2: G}),
    ('R4', *R0603, '10k', 'C25804', 'F', 61.8, 31.2, 0, {1: 'ENC_B', 2: V3}),
    ('C10', *C0603, '10nF', 'C57112', 'F', 61.8, 33.0, 0, {1: 'ENC_B', 2: G}),
    ('R5', *R0603, '10k', 'C25804', 'F', 69.2, 31.2, 0, {1: 'ENC_SW', 2: V3}),
    ('C11', *C0603, '10nF', 'C57112', 'F', 69.2, 33.0, 0, {1: 'ENC_SW', 2: G}),
    ('R7', *R0603, '1M', 'C22935', 'F', 15.5, 38.0, 0, {1: 'DBLTAP', 2: G}),
    ('C15', *C0603, '1uF', 'C15849', 'F', 19.0, 38.0, 0, {1: 'DBLTAP', 2: G}),
    ('J3', J, 'CONN-SMD_4P-P1.00_SM04B-SRSS-TB-LF-SN', 'I2C (JST SH)', 'C160404', 'F', 79.0, 34.0, 0, {1: G, 2: V3, 3: 'SDA', 4: 'SCL', 5: G, 6: G}),
    ('TP1', K + '/TestPoint.pretty', 'TestPoint_Pad_D1.5mm', 'TXD0', '', 'F', 15.0, 32.0, 0, {1: 'TXD0'}),
    ('TP2', K + '/TestPoint.pretty', 'TestPoint_Pad_D1.5mm', 'RXD0', '', 'F', 18.0, 32.0, 0, {1: 'RXD0'}),
    ('TP5', K + '/TestPoint.pretty', 'TestPoint_Pad_D1.5mm', '3V3', '', 'F', 46.3, 55.9, 0, {1: V3}),
    ('TP6', K + '/TestPoint.pretty', 'TestPoint_Pad_D1.5mm', 'GND', '', 'F', 18.0, 35.3, 0, {1: G}),
    ('TP7', K + '/TestPoint.pretty', 'TestPoint_Pad_D1.5mm', '5V', '', 'F', 21.0, 35.3, 0, {1: V5}),
    # --- the side facing the case's top (B.Cu): 1.15 mm of room, except in the chassis's slot over the encoder and sensor
    ('SW3', J, 'SW-TH_5P-L12.5-W13.4-P2.50-LS14.5-EH13.2', 'PEC11R-4220F-S0024', 'C143797', 'B', KX, KY, 90, {1: 'ENC_A', 2: G, 3: 'ENC_B', 4: 'ENC_SW', 5: G, 7: G, 8: G}),
    ('D1', J, 'LED-SMD_4P-L2.2-W2.0-P1.00_WS2815C-2020-4P', 'WS2812B-2020 knob', 'C52917434', 'B', KX, KY - 9.7, 0, {2: G, 3: 'KNOB_PIX', 4: V3}),
    ('C12', *C0603, '100nF', 'C14663', 'B', 68.6, KY - 9.7, 0, {1: V3, 2: G}),
    ('U6', J, 'SENSOR-SMD_EML7700-TT', 'VEML7700-TT', 'C1850416', 'B', SX, KY, 90, {1: 'SCL', 2: V3, 3: G, 4: 'SDA'}),
    ('C18', *C0603, '100nF', 'C14663', 'B', SX, 47.3, 0, {1: V3, 2: G}),
    ('C16', *C0603, '10uF', 'C19702', 'B', 15.2, 57.2, 0, {1: V3, 2: G}),
    ('C17', *C0603, '100nF', 'C14663', 'B', 18.4, 57.2, 0, {1: V3, 2: G}),
    ('R6', *R0603, '10k', 'C25804', 'B', 21.6, 57.2, 0, {1: 'EN', 2: V3}),
    ('C14', *C0603, '1uF', 'C15849', 'B', 24.8, 57.2, 0, {1: 'EN', 2: G}),
]
MPN = {'C52917434': 'WS2812B-2020-V6', 'C2915308': 'SMTSO3030CTJ (M3 x 3 SMT nut)', 'C318884': 'TS-1187A-B-A-B', 'C2977594': 'DC3-2.54-16PAS',
       'C160404': 'SM04B-SRSS-TB(LF)(SN)', 'C51118': 'AP2112K-3.3TRG1'}   # the parts list's name where the board's value is a role
THT = {'SW3', 'J2'}                                 # through-hole: hand or wave soldered at assembly
POWER = (V5, V3)


def outline_pts():
    n0, n1, ny = NOTCH
    c = [(BX0, BY0), (STEP[0], BY0), (STEP[0], STEP[1]), (BX1, STEP[1]), (BX1, BY1),
         (n1 + FLARE, BY1), (n1, BY1 - FLARE), (n1, ny), (n0, ny), (n0, BY1 - FLARE), (n0 - FLARE, BY1), (BX0, BY1)]
    return c


def build():
    b = pcbnew.BOARD()
    b.SetCopperLayerCount(4)                     # outer layers: parts and signals. Inner 1: ground. Inner 2: +5 V
    b.SetLayerType(pcbnew.In1_Cu, pcbnew.LT_POWER); b.SetLayerType(pcbnew.In2_Cu, pcbnew.LT_POWER)
    ds = b.GetDesignSettings()
    ds.SetBoardThickness(FromMM(PCB_T))
    ds.m_TrackMinWidth = FromMM(0.15); ds.m_MinClearance = FromMM(0.15); ds.m_ViasMinSize = FromMM(0.45); ds.m_MinThroughDrill = FromMM(0.2)
    ds.m_CopperEdgeClearance = FromMM(0.25); ds.m_HoleClearance = FromMM(0.25); ds.m_HoleToHoleMin = FromMM(0.25)
    nc = ds.m_NetSettings.m_DefaultNetClass
    nc.SetClearance(FromMM(0.15)); nc.SetTrackWidth(FromMM(0.2)); nc.SetViaDiameter(FromMM(0.6)); nc.SetViaDrill(FromMM(0.3))
    nets = {}

    def net(name):
        if name not in nets:
            ni = pcbnew.NETINFO_ITEM(b, name)
            b.Add(ni)
            nets[name] = ni
        return nets[name]

    # outline
    pts = outline_pts()
    for a, c in zip(pts, pts[1:] + pts[:1]):
        s = pcbnew.PCB_SHAPE(b)
        s.SetShape(pcbnew.SHAPE_T_SEGMENT); s.SetStart(P(*a)); s.SetEnd(P(*c)); s.SetLayer(pcbnew.Edge_Cuts); s.SetWidth(FromMM(0.1))
        b.Add(s)

    io = pcbnew.PCB_PLUGIN()
    placed = {}
    for ref, lib, name, value, lcsc, side, x, y, rot, pads in PARTS:
        fp = io.FootprintLoad(lib, name)
        assert fp is not None, (lib, name)
        fp.SetReference(ref); fp.SetValue(value)
        fp.SetFPID(pcbnew.LIB_ID(os.path.basename(lib).replace('.pretty', ''), name))   # the library nickname the project's table uses
        if lcsc:
            fp.SetProperty('LCSC', lcsc)
        b.Add(fp)
        if ref == 'U3':                              # the module: its long axis along the board, antenna at the left end of the case
            # footprint: antenna toward -Y, body from 9.1 below the origin to 16.4 above it. Turned 270: antenna toward +X (case -x)
            fp.SetPosition(VECTOR2I(FromMM(ORG[0] + 92.0 - 16.4), FromMM(ORG[1] + BY1 - 49.0)))
        else:
            fp.SetPosition(P(x, y))
        if side == 'B':
            fp.Flip(fp.GetPosition(), False)
        fp.SetOrientationDegrees(rot)
        used = set()
        for pad in fp.Pads():
            nm = pad.GetNumber()
            key = int(nm) if nm.isdigit() and int(nm) in pads else nm
            if key in pads:
                pad.SetNet(net(pads[key])); used.add(key)
            if ref == 'J1' and nm == '':             # the socket's two locating pegs: plain holes
                pad.SetAttribute(pcbnew.PAD_ATTRIB_NPTH)
            if ref in ('H1', 'H2') and pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH:   # the nut's shank hole: copper out to the nut's pad
                pad.SetSize(VECTOR2I(FromMM(5.6), FromMM(5.6)))
        missing = set(pads) - used
        assert not missing, (ref, missing, sorted({p.GetNumber() for p in fp.Pads()}))
        placed[ref] = fp

    # antenna keep-out: no copper on either layer under and beside the module's antenna (the last 7.4 mm of the board)
    z = pcbnew.ZONE(b)
    z.SetIsRuleArea(True); z.SetDoNotAllowCopperPour(True); z.SetDoNotAllowTracks(True); z.SetDoNotAllowVias(True); z.SetDoNotAllowPads(False)
    z.SetDoNotAllowFootprints(False)
    z.SetLayerSet(pcbnew.LSET.AllCuMask(4))
    o = z.Outline(); o.NewOutline()
    for x, y in ((BX0 - 0.5, BY0 + 8.0), (12.4, BY0 + 8.0), (12.4, BY1 + 0.5), (BX0 - 0.5, BY1 + 0.5)):
        o.Append(P(x, y))
    b.Add(z)

    # no tracks or vias within EDGE_KEEP of any edge (the router's own clearance comes on top of it)
    pts = outline_pts()
    area = sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(pts, pts[1:] + pts[:1]))
    for a, c in zip(pts, pts[1:] + pts[:1]):
        dx, dy = c[0] - a[0], c[1] - a[1]
        L = math.hypot(dx, dy)
        nx, ny = (-dy / L, dx / L) if area > 0 else (dy / L, -dx / L)      # inward normal
        ex, ey = dx / L * EDGE_KEEP, dy / L * EDGE_KEEP                       # run past the corners
        z = pcbnew.ZONE(b)
        z.SetIsRuleArea(True); z.SetDoNotAllowCopperPour(False); z.SetDoNotAllowTracks(True); z.SetDoNotAllowVias(True)
        z.SetDoNotAllowPads(False); z.SetDoNotAllowFootprints(False); z.SetLayerSet(pcbnew.LSET.AllCuMask(4))
        o = z.Outline(); o.NewOutline()
        for x, y in ((a[0] - ex, a[1] - ey), (c[0] + ex, c[1] + ey), (c[0] + ex + nx * EDGE_KEEP, c[1] + ey + ny * EDGE_KEEP), (a[0] - ex + nx * EDGE_KEEP, a[1] - ey + ny * EDGE_KEEP)):
            o.Append(P(x, y))
        b.Add(z)

    def pour(netname, layer, pts, prio):
        z = pcbnew.ZONE(b)
        z.SetLayer(layer); z.SetNet(net(netname)); z.SetAssignedPriority(prio)
        z.SetMinThickness(FromMM(0.2)); z.SetLocalClearance(FromMM(0.25)); z.SetThermalReliefGap(FromMM(0.25)); z.SetThermalReliefSpokeWidth(FromMM(0.4))
        z.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)
        z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
        o = z.Outline(); o.NewOutline()
        for x, y in pts:
            o.Append(P(x, y))
        b.Add(z)
        return z
    whole = [(BX0 - 1, BY0 - 1), (BX1 + 1, BY0 - 1), (BX1 + 1, BY1 + 1), (BX0 - 1, BY1 + 1)]
    pour(G, pcbnew.F_Cu, whole, 0)
    pour(G, pcbnew.B_Cu, whole, 0)
    # the two inner layers are unbroken planes: ground, and +5 V. The panel's 3-4 A goes from the socket to the two nuts in them.
    for netname, layer in ((G, pcbnew.In1_Cu), (V5, pcbnew.In2_Cu)):
        z = pour(netname, layer, whole, 0)
        z.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL); z.SetThermalReliefSpokeWidth(FromMM(0.5))   # spokes on through-hole pins: solderable
    for ref in ('H1', 'H2', 'J1'):                   # the nuts and the socket's stakes carry the panel's current: solid into the planes
        for pad in placed[ref].Pads():
            if pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH:
                pad.SetZoneConnection(pcbnew.ZONE_CONNECTION_FULL)
    # the socket's two front VBUS pads: a short track each and a via into the +5 V plane, fixed before the router runs
    for pad in placed['J1'].Pads():
        cx, cy = case_xy(pad.GetPosition())
        if pad.GetNumber() in ('A4', 'A9', 'B4', 'B9') and cy < USB_XY[1]:
            vy = 50.0
            tr = pcbnew.PCB_TRACK(b)
            tr.SetStart(pad.GetPosition()); tr.SetEnd(P(cx, vy)); tr.SetWidth(FromMM(0.3)); tr.SetLayer(pcbnew.F_Cu); tr.SetNet(net(V5)); tr.SetLocked(True)
            b.Add(tr)
            via = pcbnew.PCB_VIA(b)
            via.SetPosition(P(cx, vy)); via.SetWidth(FromMM(0.6)); via.SetDrill(FromMM(0.3)); via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
            via.SetNet(net(V5)); via.SetLocked(True)
            b.Add(via)

    # each rear VBUS pad sits straight across from a front one: a fixed stitch between the two rows joins them
    jp = {p.GetNumber(): p for p in placed['J1'].Pads()}
    for a_, c_ in (('A4', 'B9'), ('A9', 'B4')):
        tr = pcbnew.PCB_TRACK(b)
        tr.SetStart(jp[a_].GetPosition()); tr.SetEnd(jp[c_].GetPosition()); tr.SetWidth(FromMM(0.25)); tr.SetLayer(pcbnew.F_Cu); tr.SetNet(net(V5)); tr.SetLocked(True)
        b.Add(tr)

    fanout(b, placed, net)

    tidy_silk(b, placed)
    return b, placed, nets


def tidy_silk(b, placed):
    """Silkscreen a person could read: no ink on pads or over the edge, each part's name beside it where there is room
    (hidden where there is none), the board's name on the open side."""
    poly = outline_pts()

    def box(bb, grow=0.0):
        (xa, ya), (xb, yb) = case_xy(VECTOR2I(bb.GetLeft(), bb.GetTop())), case_xy(VECTOR2I(bb.GetRight(), bb.GetBottom()))
        return min(xa, xb) - grow, min(ya, yb) - grow, max(xa, xb) + grow, max(ya, yb) + grow

    def hit(p, q):
        return p[0] < q[2] and q[0] < p[2] and p[1] < q[3] and q[1] < p[3]

    def inboard(r, margin=0.4):
        for x, y in ((r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3]), ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)):
            inside = False
            for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
                if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                    inside = not inside
                dx, dy = x2 - x1, y2 - y1
                t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
                if math.hypot(x - x1 - t * dx, y - y1 - t * dy) < margin:
                    return False
            if not inside:
                return False
        return True

    pads = {True: [], False: []}                      # front?, pad boxes (through-hole pads count on both sides)
    for fp in placed.values():
        for pad in fp.Pads():
            r = box(pad.GetBoundingBox(), 0.12)
            for front in (True, False):
                if pad.IsOnLayer(pcbnew.F_Cu if front else pcbnew.B_Cu):
                    pads[front].append(r)
    ink = {True: [], False: []}
    removed = 0
    for fp in placed.values():
        for it in list(fp.GraphicalItems()):
            if it.GetLayer() not in (pcbnew.F_SilkS, pcbnew.B_SilkS):
                continue
            front = it.GetLayer() == pcbnew.F_SilkS
            r = box(it.GetBoundingBox())
            if any(hit(r, p) for p in pads[front]) or not inboard(r, 0.2) or any(hit(r, q) for q in ink[front] if q[4] != fp.GetReference()):
                fp.Remove(it); removed += 1               # on a pad, over the edge, or across another part's outline
            else:
                ink[front].append((*r, fp.GetReference()))
    shown = hidden = 0
    H, TH = 0.8, 0.13                                 # letter height and stroke
    order = sorted(placed.items(), key=lambda kv: -len(list(kv[1].Pads())))        # big parts choose first
    for ref, fp in order:
        t = fp.Reference()
        front = not fp.IsFlipped()
        t.SetTextSize(VECTOR2I(FromMM(H), FromMM(H))); t.SetTextThickness(FromMM(TH)); t.SetKeepUpright(True)
        t.SetTextAngleDegrees(0); t.SetVisible(True)
        xs, ys = [], []
        for pad in fp.Pads():
            r = box(pad.GetBoundingBox()); xs += [r[0], r[2]]; ys += [r[1], r[3]]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        w, h = 0.82 * H * len(ref) + 0.2, H + 0.2
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        spots = []
        for gap in (0.5, 0.9, 1.4):
            spots += [(cx, y0 - gap - h / 2), (cx, y1 + gap + h / 2), (x0 - gap - w / 2, cy), (x1 + gap + w / 2, cy),
                      (x0 + w / 2, y0 - gap - h / 2), (x1 - w / 2, y0 - gap - h / 2), (x0 + w / 2, y1 + gap + h / 2), (x1 - w / 2, y1 + gap + h / 2)]
        if len(list(fp.Pads())) > 12:
            spots.insert(0, (cx, cy))                 # a big part with open ground under its body: its name goes inside
        for tx, ty in spots:
            t.SetPosition(P(tx, ty))
            r = box(t.GetBoundingBox(), 0.12)         # the text as KiCad will draw it
            if inboard(r) and not any(hit(r, p) for p in pads[front]) and not any(hit(r, q) for q in ink[front]):
                ink[front].append((*r, ref)); shown += 1
                break
        else:
            t.SetVisible(False); hidden += 1
    for k, (txt, y) in enumerate((('TRACKSIDE V7  rev A', 49.0), ('circuit from Adafruit Matrix Portal S3, CC BY-SA', 51.2))):
        t = pcbnew.PCB_TEXT(b)                        # on the side facing the case's top: it is nearly empty
        sz = 1.0 if k == 0 else 0.8
        t.SetText(txt); t.SetLayer(pcbnew.B_SilkS); t.SetMirrored(True); t.SetPosition(P(38.0, y))
        t.SetTextSize(VECTOR2I(FromMM(sz), FromMM(sz))); t.SetTextThickness(FromMM(0.15 if k == 0 else 0.13))
        b.Add(t)
    print('silkscreen: marks removed', removed, '| part names shown', shown, 'hidden', hidden, file=sys.stderr)


def fanout(b, placed, net):
    """every surface-mount ground and +5 V pad gets its own short track and via into the inner planes, placed before the router runs
    (the way a person lays out a four-layer board). Through-hole pins meet the planes directly."""
    VR, TW, GAP = 0.3, 0.3, 0.2                       # via radius, stub width, spacing wanted to other copper
    poly = outline_pts()

    def inside(x, y, margin):
        hit = False
        for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                hit = not hit
            dx, dy = x2 - x1, y2 - y1
            t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
            if math.hypot(x - x1 - t * dx, y - y1 - t * dy) < margin:
                return False
        return hit and not (x < 12.4 + 0.5 and y > BY0 + 8.0 - 0.5)          # and out of the antenna's keep-out

    def rect(pad):
        bb = pad.GetBoundingBox()
        (xa, ya), (xb, yb) = case_xy(VECTOR2I(bb.GetLeft(), bb.GetTop())), case_xy(VECTOR2I(bb.GetRight(), bb.GetBottom()))
        return min(xa, xb), min(ya, yb), max(xa, xb), max(ya, yb)

    def drect(x, y, r):
        return math.hypot(max(r[0] - x, 0, x - r[2]), max(r[1] - y, 0, y - r[3]))

    pads = []
    for ref, fp in placed.items():
        for pad in fp.Pads():
            th = pad.GetAttribute() in (pcbnew.PAD_ATTRIB_PTH, pcbnew.PAD_ATTRIB_NPTH)
            pads.append((pad, rect(pad), pad.GetNetname(), th, pad.IsOnLayer(pcbnew.F_Cu), ref))
    vias, segs = [], []                                # what has been placed so far: (x, y, net), ((x1, y1), (x2, y2), net, front)
    for t in b.GetTracks():
        if t.Type() == pcbnew.PCB_VIA_T:
            vias.append((*case_xy(t.GetPosition()), t.GetNetname()))
        else:
            segs.append((case_xy(t.GetStart()), case_xy(t.GetEnd()), t.GetNetname(), t.GetLayer() == pcbnew.F_Cu))

    def dseg(x, y, a, c):
        dx, dy = c[0] - a[0], c[1] - a[1]
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - a[0]) * dx + (y - a[1]) * dy) / L2))
        return math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)

    def ok(pad, px, py, vx, vy, netname, front):
        if not inside(vx, vy, VR + 0.45):
            return False
        for q, r, n, th, qf, ref in pads:
            d = drect(vx, vy, r)
            if d < (VR + 0.1 if (n == netname and not th) else VR + GAP + (0.1 if th else 0.0)):   # no via in or against a pad
                return False
            if q is not pad and n != netname and (th or qf == front):                                # the stub past other pads
                for k in range(9):
                    if drect(px + (vx - px) * k / 8, py + (vy - py) * k / 8, r) < TW / 2 + GAP:
                        return False
        for x, y, n in vias:
            if math.hypot(vx - x, vy - y) < (2 * VR + GAP if n != netname else 2 * VR + 0.1):
                return False
            if n != netname and dseg(x, y, (px, py), (vx, vy)) < VR + TW / 2 + GAP:
                return False
        for a, c, n, f in segs:
            if n != netname:
                if dseg(vx, vy, a, c) < VR + 0.15 + GAP:
                    return False
                if f == front and min(dseg(px + (vx - px) * k / 8, py + (vy - py) * k / 8, a, c) for k in range(9)) < TW + GAP:
                    return False
        return True

    done, failed = 0, []
    order = sorted((p for p in pads if p[2] in (G, V5) and not p[3]), key=lambda p: (p[1][2] - p[1][0]) * (p[1][3] - p[1][1]))   # small pads first
    for pad, r, netname, th, front, ref in order:
        if ref == 'J1' and netname == V5:              # the socket's VBUS pads have their fixed tracks and vias already
            continue
        if ref in ('H1', 'H2'):                        # the nuts' shank holes are plated through both planes
            continue
        if ref == 'U3' and pad.GetNumber() == '41':      # the module's centre pad is nine squares: two vias (opposite corners) serve them
            ep = sorted((case_xy(q.GetPosition()) for q in placed['U3'].Pads() if q.GetNumber() == '41'))
            if case_xy(pad.GetPosition()) not in (ep[0], ep[-1]):
                continue
        px, py = case_xy(pad.GetPosition())
        fx, fy = case_xy(placed[ref].GetPosition())
        base = math.atan2(py - fy, px - fx) if (abs(px - fx) + abs(py - fy)) > 0.01 else 0.0
        w, h = r[2] - r[0], r[3] - r[1]
        if min(w, h) < 0.5 and max(w, h) > 2 * min(w, h):   # a fine-pitch pin: leave along its own length
            base = (0.0 if px >= fx else math.pi) if w > h else (math.pi / 2 if py >= fy else -math.pi / 2)
        best = None
        for rad in (0.75, 0.9, 1.05, 1.2, 1.4, 1.6, 1.9, 2.2, 2.6, 3.0):
            for k in range(17):
                ang = base + (k + 1) // 2 * (1 if k % 2 else -1) * math.pi / 8
                vx, vy = px + rad * math.cos(ang), py + rad * math.sin(ang)
                if ok(pad, px, py, vx, vy, netname, front):
                    best = (vx, vy); break
            if best:
                break
        if not best:
            failed.append(f'{ref}.{pad.GetNumber()}'); continue
        vx, vy = best
        tr = pcbnew.PCB_TRACK(b)
        tr.SetStart(pad.GetPosition()); tr.SetEnd(P(vx, vy)); tr.SetWidth(FromMM(min(TW, max(0.2, min(w, h)))))
        tr.SetLayer(pcbnew.F_Cu if front else pcbnew.B_Cu); tr.SetNet(net(netname)); tr.SetLocked(True)
        b.Add(tr)
        via = pcbnew.PCB_VIA(b)
        via.SetPosition(P(vx, vy)); via.SetWidth(FromMM(2 * VR)); via.SetDrill(FromMM(0.3)); via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
        via.SetNet(net(netname)); via.SetLocked(True)
        b.Add(via)
        vias.append((vx, vy, netname)); segs.append(((px, py), (vx, vy), netname, front)); done += 1
    print('fanout: vias placed', done, '| pads with none:', ' '.join(failed) or 'none', file=sys.stderr)


def report(placed):
    """each part's pad extent in case coordinates (the check against v7.py's blocks), and same-side courtyard clashes"""
    rows = []
    for ref, fp in placed.items():
        xs, ys = [], []
        for pad in fp.Pads():
            bb = pad.GetBoundingBox()
            for px, py in ((bb.GetLeft(), bb.GetTop()), (bb.GetRight(), bb.GetBottom())):
                cx, cy = case_xy(VECTOR2I(px, py))
                xs.append(cx); ys.append(cy)
        rows.append((ref, 'B' if fp.IsFlipped() else 'F', round(min(xs), 2), round(max(xs), 2), round(min(ys), 2), round(max(ys), 2)))
    return rows


def write_lists(placed, nets):
    by = {}
    for ref, lib, name, value, lcsc, side, x, y, rot, pads in PARTS:
        if ref.startswith('TP'):
            continue
        by.setdefault((MPN.get(lcsc, value), name, lcsc), []).append(ref)
    with open(os.path.join(OUT, 'bom-jlc.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Comment', 'Designator', 'Footprint', 'LCSC Part #'])
        for (value, name, lcsc), refs in sorted(by.items(), key=lambda q: q[1][0]):
            w.writerow([value, ','.join(refs), name, lcsc])
    with open(os.path.join(OUT, 'netlist.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Net', 'Pins'])
        table = {}
        for ref, fp in placed.items():
            for pad in fp.Pads():
                n = pad.GetNetname()
                if n:
                    table.setdefault(n, set()).add(f'{ref}.{pad.GetNumber()}')
        for n in sorted(table):
            w.writerow([n, ' '.join(sorted(table[n]))])
    return by


if __name__ == '__main__':
    b, placed, nets = build()
    path = os.path.join(OUT, 'trackside-v7.kicad_pcb')
    pcbnew.SaveBoard(path, b)
    by = write_lists(placed, nets)
    print('saved', path, '|', len(placed), 'footprints,', len(nets), 'nets,', len(by), 'BOM lines')
    for r in report(placed):
        print('  %-5s %s  x %7.2f %7.2f  y %7.2f %7.2f' % r)
