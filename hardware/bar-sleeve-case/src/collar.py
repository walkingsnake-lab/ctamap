"""Collar insert for the encoder hole (bar sleeve case). Units mm.
Fills the shell's 24 mm teardrop hole (tip toward the back, shell v2) from above; its flange (Ø35) sits on the case top.
The encoder (Adafruit 5880, EC11-style: M7 bushing, ~12 mm body at 45° on its board) pushes up into
the pocket underneath and is clamped by its own M7 nut on top of the deck, so knob presses go into the
case, not into a keeper. Print flange-top down. Translucent PETG lets the encoder's NeoPixel (aimed at
the front, at the teardrop tip) light the collar; walnut hides it.
Collar coordinates: origin at the hole centre on the case top surface, +y toward the back, z up."""
import math, sys
import numpy as np, trimesh
import manifold3d
from manifold3d import Manifold, CrossSection

SEG = 128
HOLE_R = 12.0                    # shell ENC_HOLE / 2
CL = 0.4                         # clearance in the hole. 0.2 was too tight: the back-down shell prints this hole on its
                                 # side in wood PLA, which comes out undersize (the screen frame needed 0.30-0.45 too)
import os
WALL = float(os.environ.get('CASE_WALL', '2.5'))
FL_R, FL_T, FL_CH = 17.5, 1.6, 0.45
PLUG_BOT = -(WALL - 0.1)                  # 0.1 short of the wall's inner face
DECK_BOT = -1.4                  # encoder body top sits here (deck 3.0 thick to the flange top)
POCKET_R = 9.0                   # clears the 12 mm body's corners (8.5) at any angle
BUSH_R = 3.7                     # M7 bushing
RELIEF_R, RELIEF_TOP = 6.5, 0.2  # clears the body's anti-rotation tab wherever it sits
KEY = (1.3, 11.0, 14.3)          # half width, y0, y1 (shell notch: ±1.5, 11.5–14.5)


def cyl(r, z0, z1, r1=None):
    return Manifold.cylinder(z1 - z0, r, r if r1 is None else r1, SEG).translate([0, 0, z0])


TIP_BACK = True                  # shell v2 front-down: tip to the back; shell v3 back-down: tip to the front


def teardrop(r):
    c = CrossSection.circle(r, SEG)
    a = math.pi / 4
    pts = [(r * math.cos(a), r * math.sin(a)), (0, r * math.sqrt(2)), (-r * math.cos(a), r * math.sin(a))]
    if not TIP_BACK:
        pts = [(x, -y) for (x, y) in pts][::-1]
    tri = CrossSection([pts])
    return c + tri


def collar():
    fl = cyl(FL_R, 0, FL_T - FL_CH) + cyl(FL_R, FL_T - FL_CH, FL_T, FL_R - FL_CH)
    plug = Manifold.extrude(teardrop(HOLE_R).offset(-CL, manifold3d.JoinType.Miter), -PLUG_BOT).translate([0, 0, PLUG_BOT])
    c = fl + plug                    # the teardrop keys it; shell v2 has no separate notch
    c = c - cyl(POCKET_R, PLUG_BOT - 1, DECK_BOT)
    c = c - cyl(BUSH_R, PLUG_BOT - 1, FL_T + 1)
    c = c - cyl(RELIEF_R, DECK_BOT - 0.1, RELIEF_TOP)
    return c


def export(m, path, flip=True):
    if flip:
        m = m.mirror([0, 0, 1]).translate([0, 0, FL_T])      # flange top on the bed
    me = m.to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.export(path)
    return t


def fit_set(cls=(0.3, 0.4, 0.5)):
    """back-down collars at three clearances side by side; 1, 2, 3 notches in the flange rim mark them"""
    global CL
    saved, parts = CL, []
    try:
        for i, c in enumerate(cls):
            CL = c
            m = collar()
            for k in range(i + 1):
                m = m - Manifold.cube([1.2, 1.6, 10]).translate([-0.6 + (k - i / 2) * 2.4, -FL_R - 0.4, -5])   # notches at -y
            parts.append(m.translate([i * (2 * FL_R + 4), 0, 0]))
    finally:
        CL = saved
    return Manifold.batch_boolean(parts, manifold3d.OpType.Add)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    import os; os.makedirs(f'{out}/alternate-frontdown', exist_ok=True)
    t = export(collar(), f'{out}/alternate-frontdown/bar-encoder-collar.stl')
    print('collar (front-down shell) watertight', t.is_watertight)
    TIP_BACK = False
    t = export(collar(), f'{out}/bar-encoder-collar-backdown.stl')
    print('collar (back-down shell) watertight', t.is_watertight)
    t = export(fit_set(), f'{out}/bar-encoder-collar-fit-set.stl')
    print('collar fit set (0.3 / 0.4 / 0.5, 1-3 notches)', t.is_watertight)
    TIP_BACK = True
