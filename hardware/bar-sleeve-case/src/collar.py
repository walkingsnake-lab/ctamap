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
POCKET_R = 9.8                   # clears the real body (~12.4 x 13.4 with its frame, corners r 9.13) plus print shrink; 9.0 jammed (Nov 2)
BUSH_R = 3.7                     # M7 bushing
RELIEF_R, RELIEF_TOP = 6.5, 0.2  # clears the body's anti-rotation tab wherever it sits
RIB_R = 12.15                    # crush-rib crest radius (nominal hole r 12.0); None = plain plug. 12.15 (2 notches): snug; 12.25 took too much force (Nov 2)
RIB_W, RIB_N, RIB_LEAD = 1.0, 12, 0.6   # rib width, count on a 30° grid (those near the teardrop tip are dropped), lead-in
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
    if RIB_R is not None:
        c = c + ribs(RIB_R)
    c = c - cyl(POCKET_R, PLUG_BOT - 1, DECK_BOT)
    c = c - cyl(BUSH_R, PLUG_BOT - 1, FL_T + 1)
    c = c - cyl(RELIEF_R, DECK_BOT - 0.1, RELIEF_TOP)
    return c


def ribs(rib_r):
    """Crush ribs on the plug's round part: they crest past the hole wall and deform to its printed size, so the
    collar pushes in firmly instead of sitting in the 0.4 mm clearance. The tip end leads in (0.3 -> full over RIB_LEAD)."""
    body_r = HOLE_R - CL
    depth = rib_r - body_r + 0.3                          # rib root sits 0.3 inside the plug body
    h = -PLUG_BOT
    tip = -90 if not TIP_BACK else 90                     # teardrop tip direction (deg); the hole leaves the circle within 45°
    out = []
    for i in range(RIB_N):
        a = 360 * i / RIB_N
        if abs((a - tip + 180) % 360 - 180) < 50:
            continue
        r = Manifold.cube([depth, RIB_W, h - RIB_LEAD]).translate([rib_r - depth, -RIB_W / 2, PLUG_BOT + RIB_LEAD])
        lead = Manifold.hull(Manifold.cube([0.3, RIB_W, 0.01]).translate([rib_r - depth, -RIB_W / 2, PLUG_BOT])
                             + Manifold.cube([depth, RIB_W, 0.01]).translate([rib_r - depth, -RIB_W / 2, PLUG_BOT + RIB_LEAD]))
        out.append((r + lead).rotate([0, 0, a]))
    return Manifold.batch_boolean(out, manifold3d.OpType.Add)


def export(m, path, flip=True):
    if flip:
        m = m.mirror([0, 0, 1]).translate([0, 0, FL_T])      # flange top on the bed
    me = m.to_mesh()
    t = trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)
    t.export(path)
    return t


def fit_set(cls=(0.3, 0.4, 0.5)):
    """back-down plain collars (no ribs) at three clearances side by side; 1, 2, 3 notches in the flange rim mark them"""
    global CL, RIB_R
    saved, saved_r, parts = CL, RIB_R, []
    RIB_R = None
    try:
        for i, c in enumerate(cls):
            CL = c
            m = collar()
            for k in range(i + 1):
                m = m - Manifold.cube([1.2, 1.6, 10]).translate([-0.6 + (k - i / 2) * 2.4, -FL_R - 0.4, -5])   # notches at -y
            parts.append(m.translate([i * (2 * FL_R + 4), 0, 0]))
    finally:
        CL, RIB_R = saved, saved_r
    return Manifold.batch_boolean(parts, manifold3d.OpType.Add)


def ribbed_fit_set(radii=(12.05, 12.15, 12.25)):
    """back-down ribbed collars at three rib radii (same steps as the grille-guide plug); 1-3 notches mark them"""
    global RIB_R
    saved, parts = RIB_R, []
    try:
        for i, r in enumerate(radii):
            RIB_R = r
            m = collar()
            for k in range(i + 1):
                m = m - Manifold.cube([1.2, 1.6, 10]).translate([-0.6 + (k - i / 2) * 2.4, -FL_R - 0.4, -5])
            parts.append(m.translate([i * (2 * FL_R + 4), 0, 0]))
    finally:
        RIB_R = saved
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
    t = export(ribbed_fit_set(), f'{out}/bar-encoder-collar-ribbed-fit-set.stl')
    print('ribbed collar fit set (ribs 12.05 / 12.15 / 12.25, 1-3 notches)', t.is_watertight)
    TIP_BACK = True
