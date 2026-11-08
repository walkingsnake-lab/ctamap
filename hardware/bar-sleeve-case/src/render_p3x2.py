"""Renders of the P3 128 x 32 bar's shell halves and joint (p3x2.py), from the case-frame STLs in <outdir>/frames:
    python3 render_p3x2.py <outdir> <img dir> [prefix]
Needs pyrender on EGL (headless). Writes p3x2-exploded.png (both halves pulled apart, the two joint plates between
them), p3x2-joint.png (the front of the case cut away: both rebates with their plates lying in them, halves apart),
p3x2-underside.png (half B from below: the label recesses), p3x2-front.png (assembled, from the front) and
p3x2-exploded-all.png (everything, from the back)."""
import math, os, sys
os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')
import numpy as np
import trimesh
import pyrender

WALNUT = [0.62, 0.42, 0.26, 1.0]   # lighter than the oiled wood: the features read
PETG = [0.12, 0.12, 0.13, 1.0]


LIGHTS = (((-0.5, -0.6, 0.9), 0.55), ((0.9, -0.2, 0.3), 0.35), ((0.0, 0.8, -0.2), 0.15))   # direction, weight
AMBIENT = 0.3


def load(path, color):
    """the shading is baked into face colours (pyrender's directional lights barely register on EGL here) and the
    mesh is drawn with RenderFlags.FLAT, so GL only does the hidden-surface work"""
    t = trimesh.load(path, process=False, force='mesh')
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
    pfx = sys.argv[3] if len(sys.argv) > 3 else 'p3x2'          # file name prefix (p25x2 for the P2.5 pair)
    F = f'{out}/frames'
    a, ma = load(f'{F}/shell-A.stl', WALNUT)
    b, mb = load(f'{F}/shell-B.stl', WALNUT)
    PLATE = [0.80, 0.78, 0.72, 1.0]
    pt, mpt = load(f'{F}/plate-top.stl', PLATE)
    pb, mpb = load(f'{F}/plate-bot.stl', PLATE)
    # case frame: x right, y back, z up; the renders look at the front (-y side)
    zc = a.bounds[1][2] / 2
    H = a.bounds[1][2]
    # exploded: halves 40 mm apart, the plates floating between them in their rebates' places
    gap = 40.0
    items = [(a, ma, shift(-gap / 2)), (b, mb, shift(gap / 2)), (pt, mpt, np.eye(4)), (pb, mpb, np.eye(4))]
    c = render(items, eye=(120, -520, 260), target=(0, 35, zc), yfov=0.62)
    Image.fromarray(c).save(f'{img}/{pfx}-exploded.png')
    # joint: the front 34 mm of the case cut away, halves 24 mm apart, both plates in A's rebates (B's come down over
    # their other halves), seen from the front: the two rebates with the plates lying in them
    ya = 34.0
    def section(t, x0, x1):
        return t.slice_plane([0, ya, 0], [0, 1, 0], cap=True).slice_plane([x0, 0, 0], [1, 0, 0], cap=True).slice_plane([x1, 0, 0], [-1, 0, 0], cap=True)
    sa = section(trimesh.load(f'{F}/shell-A.stl', force='mesh'), -80, 0); sb = section(trimesh.load(f'{F}/shell-B.stl', force='mesh'), 0, 80)
    spt = section(trimesh.load(f'{F}/plate-top.stl', force='mesh'), -80, 80); spb = section(trimesh.load(f'{F}/plate-bot.stl', force='mesh'), -80, 80)
    for t, pth in ((sa, 'sec-A'), (sb, 'sec-B'), (spt, 'sec-pt'), (spb, 'sec-pb')):
        t.export(f'{F}/{pth}.stl')
    A2, mA2 = load(f'{F}/sec-A.stl', WALNUT); B2, mB2 = load(f'{F}/sec-B.stl', WALNUT)
    P2, mP2 = load(f'{F}/sec-pt.stl', PLATE); Q2, mQ2 = load(f'{F}/sec-pb.stl', PLATE)
    g = 24.0
    items = [(A2, mA2, shift(-g / 2)), (B2, mB2, shift(g / 2)), (P2, mP2, shift(-g / 2)), (Q2, mQ2, shift(-g / 2))]
    c = render(items, eye=(90, -260, zc + 70), target=(0, 50, zc), yfov=0.62, size=(1600, 1000))
    Image.fromarray(c).save(f'{img}/{pfx}-joint.png')
    # underside: half B from below, front edge at the top of the picture: the two label recesses, the screw holes, feet
    items = [(b, mb, np.eye(4))]
    c = render(items, eye=(110, 150, -400), target=(110, 32, 0), yfov=0.5, size=(1600, 900))
    Image.fromarray(c).save(f'{img}/{pfx}-underside.png')
    # assembled, from the front
    items = [(a, ma, np.eye(4)), (b, mb, np.eye(4))]
    c = render(items, eye=(0, -900, zc + 160), target=(0, 20, zc), yfov=0.5)
    Image.fromarray(c).save(f'{img}/{pfx}-front.png')
    # everything, exploded from the back: trays pulled out behind, diffusers in front, splice plates and tenons in place
    if os.path.exists(f'{F}/tray-A.stl'):
        BLACK = [0.10, 0.10, 0.11, 1.0]; WHITE = [0.92, 0.92, 0.90, 1.0]; GREY = [0.45, 0.45, 0.47, 1.0]
        ta, mta = load(f'{F}/tray-A.stl', BLACK); tb, mtb = load(f'{F}/tray-B.stl', BLACK)
        dif = np.array([[1, 0, 0, 0], [0, 0, 1, 12.0], [0, -1, 0, zc], [0, 0, 0, 1]], float)   # diffuser frame -> case
        da, mda = load(f'{F}/diffuser-A-black.stl', BLACK); db, mdb = load(f'{F}/diffuser-B-black.stl', BLACK)
        wa, mwa = load(f'{F}/diffuser-A-white.stl', WHITE); wb, mwb = load(f'{F}/diffuser-B-white.stl', WHITE)
        st, mst = load(f'{F}/splice-top.stl', GREY); sb, msb = load(f'{F}/splice-bot.stl', GREY)
        items = [(a, ma, shift(-gap / 2)), (b, mb, shift(gap / 2)), (ta, mta, shift(-gap / 2, 95)), (tb, mtb, shift(gap / 2, 95)),
                 (st, mst, shift(0, 55)), (sb, msb, shift(0, 55))]
        for d, m, dx in ((da, mda, -gap / 2), (db, mdb, gap / 2), (wa, mwa, -gap / 2), (wb, mwb, gap / 2)):
            items.append((d, m, shift(dx, -70) @ dif))
        items += [(pt, mpt, np.eye(4)), (pb, mpb, np.eye(4))]
        c = render(items, eye=(260, 700, zc + 330), target=(0, 40, zc), yfov=0.62)
        Image.fromarray(c).save(f'{img}/{pfx}-exploded-all.png')
    print('ok')
