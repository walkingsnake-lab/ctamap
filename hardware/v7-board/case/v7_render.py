"""Renders of the V7 first pass (v7.py). Run through:  python3 v7.py render"""
import os, sys, math
import numpy as np
import render_v6p3 as RV
from render_v6p3 import R
import v7
from v7 import M, DR, CO, box, H, D, ZC, HW, KY, KX, EB_BOT, EB_TOP, SX

OUT = os.path.dirname(os.path.abspath(__file__))
R.MATS.update(shell=('plain', (0.80, 0.78, 0.72), 0.04, 30, 0.0), chip=('plain', (0.55, 0.56, 0.58), 0.2, 50, 0.03),
              metal=('plain', (0.72, 0.72, 0.74), 0.3, 60, 0.05), plug=('plain', (0.85, 0.33, 0.16), 0.05, 30, 0.0),
              black=('plain', (0.06, 0.06, 0.07), 0.2, 50, 0.02), module=('plain', (0.62, 0.63, 0.66), 0.3, 60, 0.04))
PMAT = dict(enc_body='metal', enc_bush='metal', pixel='new', sensor='new', enc_pins='metal', usb='metal', boot='black', reset='black',
            module='module', hub75='black', hub_plug='black', power='brass', hub_tails='metal', status='new', shifters='black', qwiic='black')


def parts(P, clip=None, sleeve=True, chassis=True, knob=True, plug=True, board=True, panel=True, collar=True, only=None):
    out = []

    def add(name, m, mat, **kw):
        if only is not None and name not in only:
            return
        if clip is not None:
            m = m ^ clip
        if m.is_empty():
            return
        p = R.Part(name, m, mat, **kw); p.grp = name
        out.append(p)
    if sleeve:
        add('sleeve', P['sleeve'], 'shell')
    if chassis:
        add('chassis', P['chassis'], 'petg')
        add('scr', P['screws']['back'] + P['screws']['bay'] + P['screws']['under'], 'screw')
    if panel:
        add('panel', P['panel'], 'panel'); add('diffuser', P['diffuser'], 'diffuser'); add('standoffs', P['standoffs'], 'brass')
    if board:
        add('board', P['board'], 'pcb')
        for k, (m, side) in P['parts'].items():
            add(k, m, PMAT[k])
    if collar:
        add('collar', P['collar'], 'ring')
    if knob:
        add('shaft', RV.ENC['shaft'], 'steel'); add('nut', RV.ENC['nut'], 'steel'); add('knob', RV.KNOB, 'knob')
    if plug:
        add('plug', v7.plug(False), 'plug')
    return out


def run(P):
    ux, uy = v7.USB_XY
    # 1. from behind: the bay in the back, the plug in it
    sc = R.Scene(parts(P), ground=-0.3)
    cam = RV.persp((0.55, 1.0, 0.35), size=(1500, 1000), dist=560, target=np.array([30.0, D / 2, H / 2]))
    a = sc.render(cam)
    RV.annotate(a, cam, [('cable bay: open to the back, full height', (ux, 66.0, 40.0), (260, 330), 'lt'),
                         ('port in the bay\'s ceiling, facing down', (ux, 62.0, EB_BOT - 12), (130, -330), 'lb'),
                         ('knob and collar: V6\'s, plus a sensor window', (KX, KY, H + 16), (120, -90), 'lb')], fs=23)
    # 2. slice through the bay, seen from the right end
    cl = box(ux - 0.3, ux + 0.3, -50, 200, -80, 300)
    sc2 = R.Scene(parts(P, clip=cl, plug=False) + [R.Part('plug', v7.plug(False) ^ cl, 'plug')])
    cam2 = RV.ortho((1, 0, 0), (1000, 1000), 8.2, target=np.array([ux, 40.0, 56.0]))
    b = sc2.render(cam2, ground=False, crease=0.0)
    RV.annotate(b, cam2, [('board', (ux, 46.0, EB_TOP - 0.8), (-60, -70), 'rb'),
                          ('socket', (ux, uy, EB_BOT - 5), (110, 30), 'lm'),
                          ('bay floor', (ux, 42.0, 60.0), (-60, 30), 'rt'),
                          ('short standoff', (ux, 36.0, ZC + 29.0), (-30, 70), 'rt'),
                          ('panel', (ux, 24.0, 50.0), (-90, 60), 'rt'),
                          ('open back', (ux, 64.0, 30.0), (60, 60), 'lt'), ('guide plate', (ux, 60.0, v7.GUIDE_Z0 + 0.3), (110, 90), 'lt')], fs=21)
    img = R.titled(R.row([a, b]), 'V7, third pass: one board under the top wall, a cable bay behind the panel',
                   'Concept model on the V6 P3 case. Left: from behind. Right: slice through the bay at the socket, seen from the right end (front of the case at the left).')
    img.save(f'{OUT}/v7-1-bay.png'); print('wrote v7-1-bay.png', img.size)

    # 3. slice through the knob and the sensor, seen from the front
    clip = box(-200, 200, KY - 0.3, KY + 0.3, -50, 300)
    sc3 = R.Scene(parts(P, clip=clip, plug=False))
    cam3 = RV.ortho((0, -1, 0), (1700, 800), 22.0, target=np.array([KX - 6, KY, H - 4.0]))
    c = sc3.render(cam3, ground=False, crease=0.0)
    RV.annotate(c, cam3, [('collar (translucent)', (KX + 14, KY, H + 0.9), (150, -150), 'lb'),
                          ('window in the collar\'s flange', (SX, KY, H + 1.4), (-90, -150), 'rb'),
                          ('light well through the shell', (SX, KY, H - 2.0), (-170, -30), 'rm'),
                          ('sensor on the board', (SX, KY, EB_TOP + 1.5), (-170, 90), 'rt'),
                          ('board', (KX - 30, KY, EB_TOP - 0.8), (-60, 170), 'rt'),
                          ('encoder, clamped up into the collar', (KX + 3, KY, EB_TOP + 3), (-60, 300), 'rt'),
                          ('bay wall under the board', (75.0, KY, EB_BOT - 5), (120, 60), 'lt')], fs=22)
    # 4. the same, close on the window
    cam4 = RV.ortho((0, -1, 0), (1700, 800), 60.0, target=np.array([SX + 6, KY, H - 2.5]))
    d = sc3.render(cam4, ground=False, crease=0.0)
    RV.annotate(d, cam4, [('0.2 mm of collar left: one printed layer', (SX, KY, H + CO.FL_T - 0.1), (40, -110), 'lb'),
                          ('knob\'s edge', (KX - 15.0, KY, H + 3.2), (260, 60), 'lm'),
                          ('shell, 4 mm', (SX - 5.0, KY, H - 2.0), (30, 90), 'lt'),
                          ('sensor (VEML7700, 2.35 tall)', (SX, KY, EB_TOP + 1.2), (230, 60), 'lt'),
                          ('chassis top wall, slotted', (SX - 4.5, KY, M.ZIN1 + 1.2), (-10, 110), 'lt')], fs=22)
    img = R.titled(R.stack([c, d]), 'The knob and the light sensor: slice through the knob\'s axis, seen from the front',
                   'Third pass. Top: collar (its pocket now keyed to the encoder), board, sensor. Bottom: close on the window, just outside the knob\'s edge.')
    img.save(f'{OUT}/v7-2-window.png'); print('wrote v7-2-window.png', img.size)

    # 5. the board alone: top and underside
    only = ['board'] + list(P['parts'])
    sc5 = R.Scene(parts(P, only=only))
    tgt = np.array([(v7.BX0 + v7.BX1) / 2, (v7.BY0 + v7.BY1) / 2, EB_TOP])
    cam5 = RV.ortho((0, 0, 1), (1500, 700), 14.5, target=tgt, up=(0, 1, 0))
    e = sc5.render(cam5, ground=False, crease=0.0)
    RV.annotate(e, cam5, [('encoder', (KX, KY + 4, EB_TOP + 6), (110, -80), 'lb'), ('knob light', (KX, KY - 9.7, EB_TOP + 1), (-60, 60), 'rt'),
                          ('light sensor', (SX, KY, EB_TOP + 3), (-90, -110), 'rb'), ('notch for the bay wall\'s fin', (76.0, 55.0, EB_TOP), (110, 40), 'lt'),
                          ('corner cut back', (90.0, 36.0, EB_TOP), (-40, 70), 'rt'), ('ribbon header\'s pin tails', (41.0, 35.0, EB_TOP + 2), (-60, -110), 'rb')], fs=22)
    cam6 = RV.ortho((0, 0, -1), (1500, 700), 14.5, target=tgt, up=(0, 1, 0))
    f = sc5.render(cam6, ground=False, crease=0.0)
    RV.annotate(f, cam6, [('USB-C socket, facing down', (v7.USB_XY[0], v7.USB_XY[1], EB_BOT - 6), (40, -110), 'lb'),
                          ('Boot, Reset', (81.0, 49.5, EB_BOT - 2), (60, 210), 'lt'),
                          ('status light', (v7.STATUS[0], v7.STATUS[1], EB_BOT - 1), (-10, 150), 'lt'),
                          ('panel power: two M3 nuts', (65.0, 54.5, EB_BOT - 7), (-10, -120), 'rb'),
                          ('encoder\'s pins', (KX, KY, EB_BOT - 2), (60, 230), 'lt'),
                          ('ESP32-S3 module, antenna at the end', (18.0, 49.0, EB_BOT - 3), (-200, -120), 'rb'),
                          ('level shifters', (43.5, 45.5, EB_BOT - 1), (-40, -150), 'rb'),
                          ('panel ribbon header', (41.0, 35.0, EB_BOT - 9), (-150, 70), 'rt')], fs=22)
    img = R.titled(R.stack([e, f]), 'The board: 92 x 29.5 x 1.2 mm, as blocks in the case model',
                   'Top: from above, back of the case at the top. Bottom: from below (left and right swapped). The same placement as the board file.')
    img.save(f'{OUT}/v7-3-board.png'); print('wrote v7-3-board.png', img.size)

    # 6. the chassis alone from behind, and the collar from below
    sc7 = R.Scene([R.Part('chassis', P['chassis'], 'petg')] + parts(P, only=['board'] + list(P['parts'])))
    cam7 = RV.persp((0.75, 1.0, 0.45), size=(1500, 1000), dist=520, target=np.array([35.0, D / 2 + 8, H / 2 + 4]))
    g = sc7.render(cam7, ground=False)
    RV.annotate(g, cam7, [('bay: floor, left wall, guide plate, open back', (ux, 55.0, 60.0), (330, 330), 'lt'),
                          ('slot for the encoder and sensor', (KX - 6, 20.0, M.ZO1), (150, -150), 'lb'),
                          ('cable clip', (v7.BAY_X0 + 3, 62.0, v7.CLIP_Z), (330, 20), 'lt')], fs=23)
    sc8 = R.Scene([R.Part('collar', P['collar'], 'ring')])
    cam8 = RV.persp((-0.75, -0.35, -0.6), size=(900, 1000), dist=78, target=np.array([KX - 2, KY, H]), yfov=0.5)
    h = sc8.render(cam8, ground=False, flip=True)
    RV.annotate(h, cam8, [('pocket over the sensor', (SX, KY, H + 0.2), (90, -170), 'lb'), ('pocket keyed to the encoder', (KX + 3, KY - 7.5, H - 3), (-200, 190), 'lt')], fs=23)
    img = R.titled(R.row([g, h]), 'Chassis and collar', 'Left: the chassis with the board in place, sleeve off. Right: the collar from below, with its window pocket.')
    img.save(f'{OUT}/v7-4-chassis-collar.png'); print('wrote v7-4-chassis-collar.png', img.size)
