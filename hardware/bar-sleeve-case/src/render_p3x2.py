"""Renders of the P3 128 x 32 bar's shell halves and joint (p3x2.py), from the case-frame STLs in <outdir>/frames:
    python3 render_p3x2.py <outdir> <img dir>
Needs pyrender on EGL (headless). Writes p3x2-exploded.png (both halves pulled apart, the four tenons between them),
p3x2-joint.png (close-up of the top wall's pockets and a tenon) and p3x2-front.png (assembled, from the front)."""
import math, os, sys
os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')
import numpy as np
import trimesh
import pyrender

WALNUT = [0.36, 0.22, 0.12, 1.0]
PETG = [0.12, 0.12, 0.13, 1.0]


LIGHTS = (((-0.5, -0.6, 0.9), 0.55), ((0.9, -0.2, 0.3), 0.35), ((0.0, 0.8, -0.2), 0.15))   # direction, weight
AMBIENT = 0.3


def load(path, color):
    """the shading is baked into face colours (pyrender's directional lights barely register on EGL here) and the
    mesh is drawn with RenderFlags.FLAT, so GL only does the hidden-surface work"""
    t = trimesh.load(path, process=False)
    n = t.face_normals
    shade = AMBIENT * np.ones(len(n))
    for d, w in LIGHTS:
        d = np.array(d, float); d /= np.linalg.norm(d)
        shade += w * np.clip(n @ d, 0, None)
    rgb = np.clip(np.array(color[:3])[None, :] * shade[:, None] * 1.6, 0, 1)
    t.visual.face_colors = np.hstack([(rgb * 255).astype(np.uint8), np.full((len(n), 1), 255, np.uint8)])
    return t, pyrender.Mesh.from_trimesh(t, smooth=False)


def look_at(eye, target, up=(0, 0, 1)):
    eye, target, up = np.array(eye, float), np.array(target, float), np.array(up, float)
    f = target - eye; f /= np.linalg.norm(f)
    s = np.cross(f, up); s /= np.linalg.norm(s)
    u = np.cross(s, f)
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = s, u, -f, eye
    return m


def render(items, eye, target, size=(1600, 900), yfov=0.45, ortho=None):
    scene = pyrender.Scene(bg_color=[0.97, 0.97, 0.96, 1.0], ambient_light=[0.18, 0.18, 0.18])
    for t, m, pose in items:
        scene.add(m, pose=pose)
    cam = pyrender.OrthographicCamera(xmag=ortho[0], ymag=ortho[1]) if ortho else pyrender.PerspectiveCamera(yfov=yfov)
    scene.add(cam, pose=look_at(eye, target))
    r = pyrender.OffscreenRenderer(*size)
    color, _ = r.render(scene, flags=pyrender.RenderFlags.FLAT)
    r.delete()
    return color


def shift(dx=0, dy=0, dz=0):
    m = np.eye(4); m[:3, 3] = [dx, dy, dz]; return m


if __name__ == '__main__':
    from PIL import Image
    out, img = sys.argv[1], sys.argv[2]
    F = f'{out}/frames'
    a, ma = load(f'{F}/shell-A.stl', WALNUT)
    b, mb = load(f'{F}/shell-B.stl', WALNUT)
    tt, mt = load(f'{F}/tenon.stl', PETG)
    # case frame: x right, y back, z up; the renders look at the front (-y side)
    zc = a.bounds[1][2] / 2
    # exploded: halves 40 mm apart, tenons floating in the middle at their four pockets (the tenon STL sits at the front top)
    gap = 40.0
    ty = [(0, 0), (0, 32.0)]
    items = [(a, ma, shift(-gap / 2)), (b, mb, shift(gap / 2))]
    for dy in (0.0, 32.0):
        for dz in (0.0, -(a.bounds[1][2] - 5.0)):
            items.append((tt, mt, shift(0, dy, dz)))
    c = render(items, eye=(120, -520, 260), target=(0, 35, zc), yfov=0.62)
    Image.fromarray(c).save(f'{img}/p3x2-exploded.png')
    # joint close-up: the top wall near x = 0, halves 12 mm apart, one tenon half way into A
    items = [(a, ma, shift(-8)), (b, mb, shift(30)), (tt, mt, shift(-9.0))]
    c = render(items, eye=(48, -22, a.bounds[1][2] + 14), target=(-8, 34, a.bounds[1][2] - 3), yfov=0.32, size=(1600, 1000))
    Image.fromarray(c).save(f'{img}/p3x2-joint.png')
    # assembled, from the front
    items = [(a, ma, np.eye(4)), (b, mb, np.eye(4))]
    c = render(items, eye=(0, -900, zc + 160), target=(0, 20, zc), yfov=0.5)
    Image.fromarray(c).save(f'{img}/p3x2-front.png')
    print('ok')
