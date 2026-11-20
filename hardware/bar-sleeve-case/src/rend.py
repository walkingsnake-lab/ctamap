"""Small deferred renderer for the case renders (render_v6.py).
pyrender (EGL) draws three flat passes (world normal, part id, depth); the shading is done here in numpy: a soft key light
and a sky dome, both through shadow maps, a little bounce light, crease darkening, and procedural materials (walnut with
print-layer banding, satin black, the lit diffuser face)."""
import os, math
os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')
import numpy as np
import trimesh, pyrender
import pyrender.renderer as _PR
from OpenGL.GL import GL_MULTISAMPLE
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from manifold3d import Manifold

# ids must come back exact: no multisampling in the flat passes (edges are smoothed by supersampling instead)
_glEnable = _PR.glEnable
_PR.glEnable = lambda x: _PR.glDisable(x) if x == GL_MULTISAMPLE else _glEnable(x)
_glRSM = _PR.glRenderbufferStorageMultisample
_PR.glRenderbufferStorageMultisample = lambda target, samples, fmt, w, h: _glRSM(target, 0, fmt, w, h)

HERE = os.path.dirname(os.path.abspath(__file__))
BG = (247, 247, 245)
INK = (28, 28, 28)
GREY = (95, 95, 95)


def s2l(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


BG_LIN = s2l(np.array(BG) / 255.0)
# kind, base colour (sRGB), spec strength, gloss exponent, env reflection
MATS = dict(
    walnut=('wood', (0.435, 0.275, 0.165), 0.016, 14, 0.004),
    black=('plain', (0.070, 0.070, 0.076), 0.10, 45, 0.015),
    panel=('plain', (0.12, 0.12, 0.125), 0.03, 20, 0.0),
    diffuser=('diffuser', (0.955, 0.955, 0.935), 0.03, 30, 0.006),
    knob=('plain', (0.90, 0.885, 0.84), 0.06, 40, 0.02),
    ring=('plain', (0.80, 0.82, 0.78), 0.05, 30, 0.0),
    rubber=('plain', (0.06, 0.06, 0.06), 0.02, 10, 0.0),
    steel=('plain', (0.62, 0.63, 0.66), 0.35, 60, 0.10),
    bed=('bed', (0.80, 0.80, 0.775), 0.02, 10, 0.0),
    ghost=('plain', (0.86, 0.50, 0.45), 0.02, 10, 0.0),
    ground=('ground', (1, 1, 1), 0, 1, 0),
)
KEY_DIR = np.array((-0.50, -0.80, 0.62))
FILL_DIR = np.array((0.85, -0.45, 0.25))
BACK_DIR = np.array((0.2, 0.9, 0.5))


def font(px, w='Regular'):
    for f in (f'/usr/share/fonts/opentype/inter/Inter-{w}.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    return ImageFont.load_default()


# ------------------------------------------------------------------ meshes
def tm(m):
    me = m.to_mesh()
    return trimesh.Trimesh(me.vert_properties[:, :3], me.tri_verts, process=False)


def smooth(t, angle=25.0):
    """split vertices along edges sharper than angle; returns (vertices, faces, vertex normals)"""
    adj, ang = t.face_adjacency, t.face_adjacency_angles
    ok = ang < math.radians(angle)
    # sliver triangles (left by the booleans) have no usable normal: tie each to the neighbour across its longest edge
    V0 = np.asarray(t.vertices); tri = V0[t.faces]
    el = np.stack([np.linalg.norm(tri[:, (k + 1) % 3] - tri[:, k], axis=1) for k in range(3)], 1)
    area = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    sliver = area / np.maximum(el.max(1), 1e-9) < 0.02
    if sliver.any():
        ae = t.face_adjacency_edges
        alen = np.linalg.norm(V0[ae[:, 0]] - V0[ae[:, 1]], axis=1)
        inv = sliver[adj[:, 0]] | sliver[adj[:, 1]]
        ok[inv] = False
        best = {}
        for r in np.flatnonzero(inv):
            for fidx in adj[r]:
                if sliver[fidx] and alen[r] > best.get(fidx, (-1, -1))[0]:
                    best[fidx] = (alen[r], r)
        for _, r in best.values():
            ok[r] = True
    lab = trimesh.graph.connected_component_labels(adj[ok], node_count=len(t.faces))
    nl = int(lab.max()) + 1
    key = t.faces.astype(np.int64) * nl + lab[:, None]
    uniq, inv = np.unique(key.ravel(), return_inverse=True)
    v = np.asarray(t.vertices)[uniq // nl]
    f = inv.reshape(-1, 3)
    # area-weighted normals: a big flat face keeps its own normal where it meets a round
    tri = v[f]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    return v, f, n


class Part:
    """one printed piece (or item) in the scene. T places the mesh: world = T @ local. axis: the print-layer normal in
    local coordinates (wood banding)."""

    def __init__(self, name, m, mat, axis=(0, 1, 0), T=None, seed=0, lit=True):
        self.name, self.mat, self.axis, self.seed, self.lit = name, mat, np.array(axis, float), seed, lit
        self.T = np.eye(4) if T is None else np.array(T, float)
        self.m = m
        t = tm(m) if isinstance(m, Manifold) else m
        self.v, self.f, self.n = smooth(t)

    def moved(self, T=None, offset=None):
        p = Part.__new__(Part)
        p.__dict__.update(self.__dict__)
        M = np.eye(4)
        if offset is not None:
            M[:3, 3] = offset
        if T is not None:
            M = np.array(T, float)
        p.T = M @ self.T
        return p

    def world(self):
        v = self.v @ self.T[:3, :3].T + self.T[:3, 3]
        n = self.n @ self.T[:3, :3].T
        return v, n


def look_at(eye, target, up=(0, 0, 1)):
    eye, target, up = np.array(eye, float), np.array(target, float), np.array(up, float)
    f = target - eye; f /= np.linalg.norm(f)
    s = np.cross(f, up); s /= np.linalg.norm(s)
    u = np.cross(s, f)
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = s, u, -f, eye
    return m


class Cam:
    def __init__(self, pose, size, yfov=None, xmag=None, znear=None, zfar=None):
        self.pose, self.size, self.yfov, self.xmag = np.array(pose, float), size, yfov, xmag
        self.ymag = None if xmag is None else xmag * size[1] / size[0]
        self.znear = znear if znear else (50.0 if yfov else 1.0)
        self.zfar = zfar if zfar else 6000.0

    def pr(self):
        if self.yfov:
            return pyrender.PerspectiveCamera(yfov=self.yfov, znear=self.znear, zfar=self.zfar, aspectRatio=self.size[0] / self.size[1])
        return pyrender.OrthographicCamera(xmag=self.xmag, ymag=self.ymag, znear=self.znear, zfar=self.zfar)

    def true_depth(self, d):
        """pyrender applies the perspective depth formula to every camera; undo it for orthographic ones"""
        if self.yfov:
            return d
        n, f = self.znear, self.zfar
        with np.errstate(divide='ignore'):
            return np.where(d > 0, (f + n) - n * f / np.where(d > 0, d, 1), 0)

    def rays(self, W, H):
        xs = (np.arange(W, dtype=np.float32) + 0.5) / W * 2 - 1
        ys = 1 - (np.arange(H, dtype=np.float32) + 0.5) / H * 2
        return np.meshgrid(xs, ys)

    def world(self, depth):
        H, W = depth.shape
        X, Y = self.rays(W, H)
        if self.yfov:
            t = math.tan(self.yfov / 2)
            pc = np.stack([X * t * W / H * depth, Y * t * depth, -depth], -1)
        else:
            pc = np.stack([X * self.xmag, Y * self.ymag, -depth], -1)
        return pc @ self.pose[:3, :3].T.astype(np.float32) + self.pose[:3, 3].astype(np.float32)

    def project(self, P):
        """world point -> pixel (x, y) in the final image"""
        P = np.asarray(P, float)
        pc = (P - self.pose[:3, 3]) @ self.pose[:3, :3]
        W, H = self.size
        if self.yfov:
            t = math.tan(self.yfov / 2)
            x, y = pc[..., 0] / (-pc[..., 2] * t * W / H), pc[..., 1] / (-pc[..., 2] * t)
        else:
            x, y = pc[..., 0] / self.xmag, pc[..., 1] / self.ymag
        return np.stack([(x * 0.5 + 0.5) * W, (0.5 - y * 0.5) * H], -1)


_R = [None]
_MAT1 = None


def _renderer(w, h):
    if _R[0] is None:
        _R[0] = pyrender.OffscreenRenderer(w, h)
    r = _R[0]
    r.viewport_width, r.viewport_height = w, h
    return r


def gl_pass(parts, cam, size, mode):
    """mode 'normal' / 'id' / 'depth'; returns (rgb uint8 or None, true depth)"""
    scene = pyrender.Scene(bg_color=[0, 0, 0, 0], ambient_light=[1, 1, 1])
    mat = pyrender.MetallicRoughnessMaterial(baseColorFactor=[1, 1, 1, 1], metallicFactor=0, roughnessFactor=1)
    for i, p in enumerate(parts):
        v, n = p.world()
        if mode == 'id':
            col = np.tile(np.array([[i + 1, (i + 1) * 7 % 256, 0, 255]], np.uint8), (len(v), 1))
        else:
            col = np.hstack([np.clip((n * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8), np.full((len(v), 1), 255, np.uint8)])
        t = trimesh.Trimesh(v, p.f, vertex_normals=n, process=False)
        t.visual.vertex_colors = col
        scene.add(pyrender.Mesh.from_trimesh(t, smooth=True))
    scene.add(cam.pr(), pose=cam.pose)
    r = _renderer(*size)
    if mode == 'depth':
        d = r.render(scene, flags=pyrender.RenderFlags.DEPTH_ONLY)
        return None, cam.true_depth(d)
    c, d = r.render(scene, flags=pyrender.RenderFlags.FLAT)
    return c, cam.true_depth(d)


# ------------------------------------------------------------------ lights (shadow maps)
def _hemi_dirs(k, zmin=0.12):
    out = []
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(k):
        z = zmin + (1 - zmin) * (i + 0.5) / k
        r = math.sqrt(1 - z * z)
        out.append((r * math.cos(i * ga), r * math.sin(i * ga), z))
    return np.array(out)


def _cone_dirs(d, k, spread):
    d = d / np.linalg.norm(d)
    a = np.cross(d, (0, 0, 1)); a /= np.linalg.norm(a)
    b = np.cross(d, a)
    out = [d]
    for i in range(k - 1):
        r = spread * math.sqrt((i + 0.5) / (k - 1)); t = i * 2.4
        v = d + r * (math.cos(t) * a + math.sin(t) * b)
        out.append(v / np.linalg.norm(v))
    return np.array(out)


class Scene:
    def __init__(self, parts, ground=None, n_sky=40, n_key=12):
        """ground: z of a shadow-catching plane, or None"""
        self.parts = [p for p in parts if p is not None]
        self.ground = ground
        allv = np.vstack([p.world()[0] for p in self.parts])
        self.lo, self.hi = allv.min(0), allv.max(0)
        self.c = (self.lo + self.hi) / 2
        self.rad = float(np.linalg.norm(self.hi - self.lo) / 2) + 6.0
        self.n_sky, self.n_key = n_sky, n_key
        self.maps = None

    def build_maps(self, kind, key_dir=None):
        out = []
        casters = [p for p in self.parts]
        dirs, S = (_hemi_dirs(self.n_sky), 1024) if kind == 'sky' else (_cone_dirs(key_dir, self.n_key, 0.055), 2048)
        if True:
            for d in dirs:
                up = (0, 0, 1) if abs(d[2]) < 0.95 else (0, 1, 0)
                pose = look_at(self.c + d * (self.rad + 50), self.c, up)
                cam = Cam(pose, (S, S), xmag=self.rad, znear=1.0, zfar=2 * self.rad + 100)
                _, dep = gl_pass(casters, cam, (S, S), 'depth')
                dep = np.where(dep > 0, dep, 1e9).astype(np.float32)
                out.append(dict(kind=kind, d=d, pose=pose, S=S, dep=dep, tex=2 * self.rad / S))
        return out

    def visibility(self, P, N, key_dir=KEY_DIR):
        """returns (key visibility 0..1, sky irradiance for normal N, 1 = open upward face)"""
        if self.maps is None:
            self.maps = {'sky': self.build_maps('sky')}
        kk = tuple(np.round(key_dir, 4))
        if kk not in self.maps:
            self.maps[kk] = self.build_maps('key', np.array(key_dir, float))
        key = np.zeros(len(P), np.float32); nk = 0
        sky = np.zeros(len(P), np.float32)
        for m in self.maps['sky'] + self.maps[kk]:
            S, tex = m['S'], m['tex']
            Po = P + N * (1.6 * tex)
            pc = (Po - m['pose'][:3, 3].astype(np.float32)) @ m['pose'][:3, :3].astype(np.float32)
            u = (pc[:, 0] / self.rad * 0.5 + 0.5) * S - 0.5
            v = (0.5 - pc[:, 1] / self.rad * 0.5) * S - 0.5
            d = -pc[:, 2] - 1.2 * tex
            u0 = np.floor(u); v0 = np.floor(v)
            fu = u - u0; fv = v - v0
            iu = np.clip(u0.astype(np.int32), 0, S - 2); iv = np.clip(v0.astype(np.int32), 0, S - 2)
            dep = m['dep']
            vis = ((d <= dep[iv, iu]) * (1 - fu) * (1 - fv) + (d <= dep[iv, iu + 1]) * fu * (1 - fv)
                   + (d <= dep[iv + 1, iu]) * (1 - fu) * fv + (d <= dep[iv + 1, iu + 1]) * fu * fv).astype(np.float32)
            if m['kind'] == 'key':
                key += vis; nk += 1
            else:
                sky += vis * np.clip(N @ m['d'].astype(np.float32), 0, None)
        return key / max(nk, 1), sky * (2.0 / self.n_sky)

    # ---------------------------------------------------------------- render
    def render(self, cam, ss=2, lit=True, crease=1.0, ground=True, flip=False, exposure=1.0):
        """flip: turn the lights half a turn about the vertical (for views from behind)"""
        F = np.array((-1.0, -1.0, 1.0)) if flip else np.ones(3)
        W, H = cam.size[0] * ss, cam.size[1] * ss
        parts = list(self.parts)
        gz = self.ground if ground else None
        if gz is not None:
            g = trimesh.creation.box(extents=[9000, 9000, 1.0])
            g.apply_translation([self.c[0], self.c[1], gz - 0.5])
            gp = Part.__new__(Part)
            gp.name, gp.mat, gp.axis, gp.seed, gp.lit, gp.T = 'ground', 'ground', np.array((0, 0, 1.0)), 0, False, np.eye(4)
            gp.v, gp.f, gp.n = smooth(g)
            parts.append(gp)
        nimg, depth = gl_pass(parts, cam, (W, H), 'normal')
        idimg, _ = gl_pass(parts, cam, (W, H), 'id')
        pid = idimg[..., 0].astype(np.int32) - 1
        valid = (depth > 0) & (pid >= 0) & (pid < len(parts))
        out = np.empty((H, W, 3), np.float32); out[:] = BG_LIN
        emis = np.zeros((H, W, 3), np.float32)
        Pw = cam.world(depth.astype(np.float32))
        P = Pw[valid]; del Pw
        N = nimg[valid].astype(np.float32) / 127.5 - 1.0
        N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
        ids = pid[valid]
        if cam.yfov:
            V = cam.pose[:3, 3].astype(np.float32) - P
            V /= np.linalg.norm(V, axis=1, keepdims=True)
        else:
            V = np.tile(cam.pose[:3, 2].astype(np.float32), (len(P), 1))
        keyv, skyE = self.visibility(P, N, KEY_DIR * F)
        cav = _crease(nimg, depth, valid, ss, cam.pose)[valid] * crease if crease else np.zeros(len(P), np.float32)
        # ---- material buffers
        alb = np.zeros((len(P), 3), np.float32); spec = np.zeros(len(P), np.float32); gloss = np.ones(len(P), np.float32)
        env = np.zeros(len(P), np.float32); em = np.zeros((len(P), 3), np.float32); emask = np.zeros(len(P), np.float32)
        isground = np.zeros(len(P), bool)
        for i, p in enumerate(parts):
            sel = ids == i
            if not sel.any():
                continue
            kind, base, sp, gl, ev = MATS[p.mat]
            base = s2l(base)
            spec[sel], gloss[sel], env[sel] = sp, gl, ev
            if kind == 'ground':
                isground[sel] = True; alb[sel] = 1.0
                continue
            Ti = np.linalg.inv(p.T)
            Pl = P[sel] @ Ti[:3, :3].T.astype(np.float32) + Ti[:3, 3].astype(np.float32)
            if kind == 'wood':
                alb[sel] = base * wood(Pl, p.axis, p.seed)
            elif kind == 'diffuser':
                Nl = N[sel] @ Ti[:3, :3].T.astype(np.float32)
                a, e, mk = diffuser_face(Pl, Nl, base, lit and p.lit)
                alb[sel], em[sel], emask[sel] = a, e, mk
            elif kind == 'bed':
                alb[sel] = base * bed_tex(Pl)
                keyv[sel] = 1 - 0.30 * (1 - keyv[sel]); skyE[sel] = 1 - 0.45 * (1 - np.clip(skyE[sel], 0, 1))
            else:
                alb[sel] = base
        # ---- lighting (linear)
        kd = KEY_DIR * F / np.linalg.norm(KEY_DIR); fd = FILL_DIR * F / np.linalg.norm(FILL_DIR); bd = BACK_DIR * F / np.linalg.norm(BACK_DIR)
        nl = np.clip(N @ kd.astype(np.float32), 0, None)
        key = 1.55 * nl * keyv
        fill = 0.22 * np.clip(N @ fd.astype(np.float32) * 0.6 + 0.4, 0, None) + 0.16 * np.clip(N @ bd.astype(np.float32), 0, None)
        amb = 0.62 * skyE + 0.20 * (0.5 - 0.5 * N[:, 2]) + 0.10
        occ = 1.0 - 0.55 * np.clip(cav, 0, 1) + 0.05 * np.clip(-cav, 0, 1)
        E = (key + (fill + amb) * occ)
        Hh = V + kd.astype(np.float32); Hh /= np.linalg.norm(Hh, axis=1, keepdims=True)
        sp1 = spec * np.clip(N @ kd.astype(np.float32) > 0, 0, 1) * keyv * np.clip(np.einsum('ij,ij->i', N, Hh), 0, 1) ** gloss * (gloss + 8) / 8.0
        Rv = 2 * np.einsum('ij,ij->i', N, V)[:, None] * N - V
        fres = (1 - np.clip(np.einsum('ij,ij->i', N, V), 0, 1)) ** 4
        envl = (0.35 + 0.65 * np.clip(Rv[:, 2] * 0.5 + 0.5, 0, 1)) * env * (1.0 + 4.0 * fres) * occ
        edge = 0.07 * np.clip(-cav, 0, 1) * (env >= 0.015)
        col = alb * E[:, None] * 0.55 + (sp1 + envl + edge)[:, None]
        col = col * exposure
        col = np.where(col > 0.7, 0.7 + (1 - np.exp(-(col - 0.7) / 0.3)) * 0.3, col)      # gentle shoulder
        col = col * (1 - emask[:, None]) + em * emask[:, None]
        if isground.any():
            g = isground
            # the floor only shows shadow: background colour, darkened under and behind the case
            import cv2
            mk = np.zeros((H, W), np.float32); a = np.zeros((H, W), np.float32); b = np.zeros((H, W), np.float32)
            vi = np.flatnonzero(valid.ravel())[g]
            mk.ravel()[vi] = 1; a.ravel()[vi] = keyv[g]; b.ravel()[vi] = np.clip(skyE[g], 0, 1)
            bl = lambda x, s: cv2.GaussianBlur(x * mk, (0, 0), s * ss) / np.maximum(cv2.GaussianBlur(mk, (0, 0), s * ss), 1e-4)
            sh = 0.30 * bl(a, 4.0).ravel()[vi] + 0.70 * bl(b, 7.0).ravel()[vi] ** 1.6
            Pg = P[g]
            dist = np.hypot(np.maximum(np.maximum(self.lo[0] - Pg[:, 0], Pg[:, 0] - self.hi[0]), 0),
                            np.maximum(np.maximum(self.lo[1] - Pg[:, 1], Pg[:, 1] - self.hi[1]), 0))
            fade = np.clip((85.0 - dist) / 73.0, 0, 1); fade = fade * fade * (3 - 2 * fade)
            col[g] = BG_LIN * (1.0 - 0.80 * (1 - sh) * fade)[:, None]
        out[valid] = col
        emis[valid] = em * emask[:, None]
        img = Image.fromarray((l2s(out) * 255 + 0.5).astype(np.uint8))
        if emis.max() > 0:
            g = Image.fromarray((np.clip(l2s(emis), 0, 1) * 255).astype(np.uint8))
            glow = np.asarray(g.filter(ImageFilter.GaussianBlur(5 * ss)), np.float32) * 0.26 + np.asarray(g.filter(ImageFilter.GaussianBlur(16 * ss)), np.float32) * 0.12
            a = np.asarray(img, np.float32)
            img = Image.fromarray(np.clip(255 - (255 - a) * (255 - glow) / 255, 0, 255).astype(np.uint8))
        if ss > 1:
            img = img.resize(cam.size, Image.BOX)
        return img


def _crease(nimg, depth, valid, ss, pose):
    """how much the normals of nearby pixels on the same surface lean toward this one: > 0 in a groove or an inside
    corner, < 0 on an outer edge, 0 on anything flat. (From the normals, not the depth: the software rasteriser's depth
    has half-pixel glitches along triangle edges.)"""
    N = nimg.astype(np.float32) / 127.5 - 1.0
    right, up = pose[:3, 0].astype(np.float32), pose[:3, 1].astype(np.float32)
    nr, nu = N @ right, N @ up
    d = depth.astype(np.float32)
    acc = np.zeros_like(d); wsum = np.zeros_like(d)
    for r in (2 * ss, 4 * ss):
        for k in range(8):
            a = k * math.pi / 4 + (0.39 if r > 2 * ss else 0)
            dx, dy = int(round(r * math.cos(a))), int(round(r * math.sin(a)))
            L = math.hypot(dx, dy)
            sh = lambda x: np.roll(x, (-dy, -dx), (0, 1))            # value at (x + dx, y + dy)
            dn = sh(d)
            w = (np.abs(dn - d) < 2.5) & (dn > 0)
            c = -((sh(nr) - nr) * (dx / L) + (sh(nu) - nu) * (-dy / L))
            acc += np.where(w, c, 0); wsum += w
    m = acc / np.maximum(wsum, 1) * 2.2
    m = np.sign(m) * np.maximum(np.abs(m) - 0.10, 0)
    return np.where(valid, m, 0)


# ------------------------------------------------------------------ procedural materials
_RT = np.random.default_rng(7).random(16384).astype(np.float32)


def vn1(x):
    i = np.floor(x); f = (x - i).astype(np.float32); f = f * f * (3 - 2 * f)
    i = i.astype(np.int64)
    return _RT[i & 16383] * (1 - f) + _RT[(i + 1) & 16383] * f


def vn2(x, y):
    i = np.floor(x); j = np.floor(y)
    fx = (x - i).astype(np.float32); fy = (y - j).astype(np.float32)
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    i = i.astype(np.int64); j = j.astype(np.int64)
    h = lambda a, b: _RT[((a * 73856093) ^ (b * 19349663)) & 16383]
    return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fy) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fy


def wood(Pl, axis, seed):
    """wood-fill PLA: tone bands that follow the print layers (s along the layer normal) and long faint streaks"""
    axis = axis / np.linalg.norm(axis)
    s = Pl @ axis.astype(np.float32)
    o = np.array((0.577, 0.577, 0.577)) if abs(axis[0]) < 0.9 else np.array((0, 1.0, 0))
    a = np.cross(axis, o); a /= np.linalg.norm(a); b = np.cross(axis, a)
    u = Pl @ a.astype(np.float32); v = Pl @ b.astype(np.float32)
    k = seed * 131.7
    n = (vn1(s / 6.0 + k) - 0.5) * 0.10 + (vn1(s / 1.7 + k + 40) - 0.5) * 0.09 + (vn1(s / 0.55 + k + 90) - 0.5) * 0.08
    n += (vn2(s / 0.45 + k, (u + 0.7 * v) / 38.0 + k) - 0.5) * 0.07
    n += (vn2(s / 9.0 + k + 5, (u - v) / 60.0) - 0.5) * 0.06
    tint = np.stack([1 + n, 1 + 1.12 * n, 1 + 1.25 * n], -1)
    return tint.astype(np.float32)


_PIX = [None]


def pixel_frame():
    if _PIX[0] is None:
        fn = ImageFont.load(os.path.join(HERE, 'rend-fonts', 'b57.pil'))
        im = Image.new('RGB', (64, 32))
        d = ImageDraw.Draw(im)
        red, amber, blue, green = (235, 30, 50), (255, 150, 20), (40, 140, 255), (70, 215, 110)
        d.rectangle([1, 2, 6, 8], fill=red)
        d.text((9, 2), 'Howard', font=fn, fill=amber); d.text((52, 2), '3m', font=fn, fill=amber)
        d.rectangle([1, 12, 6, 18], fill=red)
        d.text((9, 12), '95th', font=fn, fill=amber); d.text((52, 12), '7m', font=fn, fill=amber)
        d.text((1, 23), '48', font=fn, fill=green); d.point((12, 23), fill=green)
        d.text((40, 23), '7:42', font=fn, fill=blue)
        _PIX[0] = np.asarray(im).astype(np.float32) / 255.0
    return _PIX[0]


WIN_W, WIN_H, WIN_ZC = 256.0, 128.0, 76.9


def diffuser_face(Pl, Nl, base, lit):
    """the white face over the cell grid: lit cells glow as soft squares; local frame = the case frame"""
    x, z = Pl[:, 0], Pl[:, 2]
    front = Nl[:, 1] < -0.7
    fi = (x + WIN_W / 2) / 4.0; fj = (WIN_ZC + WIN_H / 2 - z) / 4.0
    i = np.floor(fi).astype(np.int32); j = np.floor(fj).astype(np.int32)
    inwin = front & (i >= 0) & (i < 64) & (j >= 0) & (j < 32)
    dx = np.abs(fi - i - 0.5) * 4.0; dz = np.abs(fj - j - 0.5) * 4.0
    m = np.maximum(dx, dz)
    cell = np.clip((1.95 - m) / 0.55, 0, 1); cell = cell * cell * (3 - 2 * cell)
    alb = np.tile(base, (len(x), 1)).astype(np.float32)
    rib = np.where(inwin, 1.0 - 0.035 * (1 - cell), 1.0)
    alb *= rib[:, None]
    em = np.zeros_like(alb); mask = np.zeros(len(x), np.float32)
    if lit:
        px = pixel_frame()
        ic, jc = np.clip(i, 0, 63), np.clip(j, 0, 31)
        c = px[jc, ic]
        on = inwin & (c.max(1) > 0.2)
        soft = cell * (0.80 + 0.20 * np.clip(1 - m / 1.6, 0, 1))
        em = s2l(np.clip(0.03 + 0.97 * c, 0, 1)) * 1.0
        mask = np.where(on, soft * 0.96, 0).astype(np.float32)
    return alb, em.astype(np.float32), mask


def bed_tex(Pl):
    x, y = Pl[:, 0], Pl[:, 1]
    g = np.minimum(np.abs((x + 1000) % 32.0 - 16.0), np.abs((y + 1000) % 32.0 - 16.0))
    line = np.clip(1 - g / 0.5, 0, 1)
    return (1.0 - 0.07 * line)[:, None].astype(np.float32)


# ------------------------------------------------------------------ 2D helpers
def titled(img, title, sub=None, scale=1.0):
    ft, fs = font(int(34 * scale), 'SemiBold'), font(int(23 * scale))
    top = int((66 if sub is None else 104) * scale)
    im = Image.new('RGB', (img.width, img.height + top), BG)
    im.paste(img, (0, top))
    d = ImageDraw.Draw(im)
    d.text((int(26 * scale), int(18 * scale)), title, fill=INK, font=ft)
    if sub:
        d.text((int(26 * scale), int(62 * scale)), sub, fill=GREY, font=fs)
    return im


def stack(imgs, pad=20):
    W = max(i.width for i in imgs)
    out = Image.new('RGB', (W, sum(i.height for i in imgs) + pad * (len(imgs) - 1)), BG)
    y = 0
    for i in imgs:
        out.paste(i, (0, y)); y += i.height + pad
    return out


def row(imgs, pad=20):
    Hh = max(i.height for i in imgs)
    out = Image.new('RGB', (sum(i.width for i in imgs) + pad * (len(imgs) - 1), Hh), BG)
    x = 0
    for i in imgs:
        out.paste(i, (x, 0)); x += i.width + pad
    return out


def label(d, xy, text, f, anchor='mm', fill=INK, pad=5, box=True):
    if box:
        b = d.textbbox(xy, text, font=f, anchor=anchor)
        d.rounded_rectangle([b[0] - pad - 2, b[1] - pad, b[2] + pad + 2, b[3] + pad], radius=6, fill=(255, 255, 255), outline=(200, 200, 196))
    d.text(xy, text, font=f, anchor=anchor, fill=fill)
