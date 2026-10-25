"""Vehicle kit helpers (Keith 2026-10-20: futuristic vans, trucks and road trains in place of present-day cars).

Self-contained bmesh builder for hard-surface vehicles. Conventions match tools/blender/nature/nature.py:
- 1 unit = 1 m, Z up in Blender, pivot at the ground under the vehicle's centre; the vehicle's front is -Y (as props2.py's wrecks).
- Colour is baked in the vertex colours (sRGB bytes, single encoded): the base paint per primitive, times a ground/underside
  AO gradient, per-vertex dirt noise, and for wrecks soot, rust and drifted dust. No transparency anywhere: glass is an
  opaque dark panel with a lighter highlight band (flag NOBAKE keeps highlights and glow out of the bake).
- Material slots are the paint sections (SECTIONS): primary, secondary, trim, dark, glow, glass, tyre, cargo, sand, so faction
  paint can retint a slot later. Slot order is fixed, so material_index is stable across every piece.
- A Piece is one mesh object with its origin at `origin` (a wheel's origin is its hub, so the game can spin and steer it).
Everything builds in world (vehicle) coordinates; the Piece subtracts its origin.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

# Real steel sections (I / U / L beams, pipe radii, plate and bolt sizes) come from the building stock table, so a chassis rail
# here is the same section a building's beam is (Keith 2026-10-19, docs/todo-building-materials-and-canopies.md).
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "buildings"))
import stock as S  # noqa: E402

SECTIONS = ("primary", "secondary", "trim", "dark", "glow", "glass", "tyre", "cargo", "sand")
SECTION_PREVIEW = {  # the material's viewport colour only; the real colour is in the vertex colours
    "primary": (0.6, 0.55, 0.4), "secondary": (0.85, 0.8, 0.7), "trim": (0.3, 0.3, 0.3), "dark": (0.12, 0.12, 0.13),
    "glow": (1.0, 0.7, 0.2), "glass": (0.06, 0.09, 0.11), "tyre": (0.1, 0.1, 0.1), "cargo": (0.5, 0.5, 0.45),
    "sand": (0.75, 0.62, 0.42)}
NOBAKE = 1  # face flag: skip the AO/wear bake (glow, glass highlights)
SOOT = (0.075, 0.068, 0.062)
SOOT_DEEP = (0.045, 0.040, 0.037)
RUST = (0.42, 0.22, 0.11)
DUST = (0.74, 0.62, 0.44)


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def shade(c, s):
    return tuple(clamp(x * s) for x in c)


def sec_index(name):
    return SECTIONS.index(name)


class Piece:
    """One mesh object. Primitives append to its bmesh; emit() bakes the colours and creates the Blender object."""

    def __init__(self, name, origin=(0, 0, 0), seed=0):
        self.name = name
        self.origin = Vector(origin)
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new("Color")
        self.sec = self.bm.faces.layers.int.new("sec")
        self.flag = self.bm.faces.layers.int.new("flag")
        self.rng = random.Random(seed)
        self.seed = seed
        self.tris = 0

    def empty(self):
        return len(self.bm.faces) == 0


def _ring(hb, ht, zt, ch):
    """A chamfered trapezoid section (x, z): base half width hb at z 0, top half width ht at zt."""
    if ch <= 0.002:
        return [(-hb, 0.0), (hb, 0.0), (ht, zt), (-ht, zt)]
    cb = min(ch, hb * 0.8, zt * 0.45)
    ct = min(ch, ht * 0.8, zt * 0.45)
    return [(-hb + cb, 0.0), (hb - cb, 0.0), (hb, cb), (ht, zt - ct), (ht - ct, zt), (-ht + ct, zt), (-ht, zt - ct), (-hb, cb)]


def prim(P, rings, mat, col, flag=0, M=None, jitter=0.025, closed=False):
    """Builds a closed solid from rings (lists of 3D points, same count), capped at both ends (closed=True: the last ring joins
    the first, a loop with no caps: tracks, belts). Returns the new faces."""
    bm = P.bm
    vr = []
    for ring in rings:
        vs = []
        for p in ring:
            q = Vector(p)
            if M is not None:
                q = M @ q
            vs.append(bm.verts.new(q - P.origin))
        vr.append(vs)
    n = len(vr[0])
    faces = []
    for i in range(len(vr) - (0 if closed else 1)):
        i2 = (i + 1) % len(vr)
        for j in range(n):
            a, b = vr[i][j], vr[i][(j + 1) % n]
            c, d = vr[i2][(j + 1) % n], vr[i2][j]
            try:
                faces.append(bm.faces.new((a, b, c, d)))
            except ValueError:
                pass
    for ring in (() if closed else (vr[0], vr[-1][::-1])):
        try:
            faces.append(bm.faces.new(ring))
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    si = sec_index(mat)
    for f in faces:
        f[P.sec] = si
        f[P.flag] = flag
        k = 1.0 + P.rng.uniform(-jitter, jitter)
        for l in f.loops:
            l[P.col] = (clamp(col[0] * k), clamp(col[1] * k), clamp(col[2] * k), 1.0)
    return faces


def _rot(rot):
    if isinstance(rot, Matrix):
        return rot.to_4x4()
    if not rot:
        return Matrix.Identity(4)
    return Matrix.Rotation(rot[2], 4, "Z") @ Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X")


def blk(P, c, size, mat="primary", col=(0.5, 0.5, 0.5), ch=0.05, nose=(0.0, 0.0), tail=(0.0, 0.0), batter=0.0,
        rot=None, mid=False, flag=0):
    """A chamfered box. c = (x, y, z of the bottom), or the centre with mid=True. size = (w, l, h). nose/tail = (drop, inset):
    how far the top at the -Y / +Y end is lowered and narrowed (hoods, windscreens, tapers); batter narrows the top."""
    w, l, h = size
    rings = []
    for yy, (drop, inset) in ((-l / 2, nose), (l / 2, tail)):
        ht = max(0.02, w / 2 - batter - inset)
        zt = max(0.04, h - drop)
        rings.append([Vector((x, yy, z - h / 2)) for x, z in _ring(w / 2, ht, zt, ch)])
    centre = Vector(c) if mid else Vector((c[0], c[1], c[2] + h / 2))
    M = Matrix.Translation(centre) @ _rot(rot)
    return prim(P, rings, mat, col, flag, M)


def loft(P, secs, mat, col, ch=0.05, flag=0, M=None):
    """secs = [(y, half_w_base, half_w_top, z_bottom, z_top), ...] along Y: wedges, noses, windscreens, hulls."""
    rings = []
    for y, hb, ht, zb, zt in secs:
        rings.append([Vector((x, y, zb + z)) for x, z in _ring(hb, ht, zt - zb, ch)])
    return prim(P, rings, mat, col, flag, M)


def _axis(axis, u, v, t):
    if axis == "x":
        return (t, u, v)
    if axis == "y":
        return (u, t, v)
    return (u, v, t)


def cyl(P, c, r, length, axis="x", n=12, profile=None, mat="dark", col=(0.2, 0.2, 0.2), rot=None, flag=0, r2=None, phase=0.0):
    """A cylinder (or barrel/cone via profile [(t 0-1, radius factor)]) centred on c along axis."""
    if profile is None:
        profile = [(0.0, 1.0), (1.0, (r2 / r) if r2 is not None else 1.0)]
    rings = []
    for t, rf in profile:
        tt = (t - 0.5) * length
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n + phase
            ring.append(Vector(_axis(axis, math.cos(a) * r * rf, math.sin(a) * r * rf, tt)))
        rings.append(ring)
    M = Matrix.Translation(Vector(c)) @ _rot(rot)
    return prim(P, rings, mat, col, flag, M)


def bar(P, a, b, r, mat="dark", col=(0.2, 0.2, 0.2), n=6, r2=None):
    """A thin round strut between two points (rails, pipes, stays). r2 tapers it to a cone."""
    a, b = Vector(a), Vector(b)
    d = b - a
    ln = d.length
    if ln < 1e-4:
        return []
    q = d.to_track_quat("Z", "Y")
    M = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
    rings = []
    for t, rr in ((-0.5, r), (0.5, r if r2 is None else r2)):
        rings.append([Vector((math.cos(2 * math.pi * k / n) * rr, math.sin(2 * math.pi * k / n) * rr, t * ln)) for k in range(n)])
    return prim(P, rings, mat, col, 0, M)


# ---------------------------------------------------------------- pass 2: surfaces, stock sections, technical detail
def frame_mat(u, v, n):
    """A 4x4 whose local X is u (along the surface), local Z is v (up the surface) and local Y is -n (into it), so a blk with
    size (w along u, thickness, h along v) sits flat on a surface with outward normal n (u x v = n)."""
    u, v, n = Vector(u).normalized(), Vector(v).normalized(), Vector(n).normalized()
    m = Matrix(((u.x, -n.x, v.x), (u.y, -n.y, v.y), (u.z, -n.z, v.z)))
    return m.to_4x4()


def surf_blk(P, c, u, v, n, w, h, t, mat, col, off=0.0, ch=0.0, flag=0, batter=0.0):
    """A plate on a surface: centre c (on the surface), spans w along u and h along v, t thick, standing `off` off the surface."""
    c = Vector(c) + Vector(n).normalized() * (off + t / 2)
    return blk(P, c, (w, t, h), mat, col, ch=ch, rot=frame_mat(u, v, n), mid=True, flag=flag, batter=batter)


def basis_from(n, up=(0, 0, 1)):
    """(u, v, n) for a surface with outward normal n: u horizontal, v up the surface."""
    n = Vector(n).normalized()
    u = Vector(up).cross(n)
    if u.length < 1e-4:
        u = Vector((1, 0, 0))
    u.normalize()
    v = n.cross(u)
    return u, v, n


def sweep(P, profile, centres, frames, mat, col, flag=0, closed=False):
    """A solid from a 2D profile (u, v points) swept through centres with a (right, up) frame at each (as stock.sweep)."""
    rings = []
    for c, (r, v) in zip(centres, frames):
        c = Vector(c)
        rings.append([c + r * u + v * w for u, w in profile])
    return prim(P, rings, mat, col, flag, None, closed=closed)


def beam(P, kind, a, b, size="M", mat="dark", col=(0.2, 0.2, 0.2), up=(0, 0, 1)):
    """A stock I / U / L beam (kind 'i', 'u', 'l'; sizes of buildings/stock.py) from a to b."""
    prof_ = {"i": S.i_profile, "u": S.u_profile, "l": S.l_profile}[kind](size)
    a, b = Vector(a), Vector(b)
    if (b - a).length < 1e-4:
        return []
    r, v = S._frame(b - a, up)
    return sweep(P, prof_, [a, b], [(r, v), (r, v)], mat, col)


def pipe(P, a, b, size="S", mat="dark", col=(0.2, 0.2, 0.2), n=6):
    """A stock steel pipe (outer radius from stock.PIPE_R, floored at stock.MIN_ROD)."""
    r = S.rod_r(S.PIPE_R[size] if isinstance(size, str) else size)
    return bar(P, a, b, r, mat, col, n)


def bolt(P, pos, normal, r=0.022, h=0.022, mat="trim", col=(0.5, 0.5, 0.5)):
    n = Vector(normal).normalized()
    return bar(P, Vector(pos), Vector(pos) + n * h, r, mat, col, 6)


def bolt_row(P, a, b, n, normal, r=0.02, mat="trim", col=(0.5, 0.5, 0.5)):
    a, b = Vector(a), Vector(b)
    for i in range(n):
        bolt(P, a + (b - a) * ((i + 0.5) / n), normal, r, r, mat, col)


def _transport(tans):
    u = tans[0].cross(Vector((0, 0, 1)))
    if u.length < 1e-3:
        u = tans[0].cross(Vector((1, 0, 0)))
    u.normalize()
    out = []
    for t in tans:
        u = u - t * u.dot(t)
        if u.length < 1e-5:
            u = t.orthogonal()
        u.normalize()
        out.append((u, t.cross(u)))
    return out


def round_path(pts, bend=0.15, seg=3):
    """A polyline with its corners rounded (quadratic bends)."""
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = pts[i - 1], pts[i], pts[i + 1]
        d0, d2 = p0 - p1, p2 - p1
        r = min(bend, d0.length * 0.45, d2.length * 0.45)
        if r < 1e-4:
            out.append(p1)
            continue
        a, b = p1 + d0.normalized() * r, p1 + d2.normalized() * r
        for k in range(seg + 1):
            t = k / seg
            out.append(a * (1 - t) ** 2 + p1 * (2 * (1 - t) * t) + b * (t * t))
    out.append(pts[-1])
    return out


def tube_along(P, path, r, mat, col, n=6, flag=0, r_end=None):
    path = [Vector(p) for p in path]
    tans = []
    for i in range(len(path)):
        d = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
        tans.append(d.normalized() if d.length > 1e-6 else Vector((0, 0, 1)))
    frames = _transport(tans)
    prof_ = [(math.cos(2 * math.pi * k / n), math.sin(2 * math.pi * k / n)) for k in range(n)]
    rings = []
    for i, (c, (u, v)) in enumerate(zip(path, frames)):
        rr = r if r_end is None else r + (r_end - r) * i / max(1, len(path) - 1)
        rings.append([c + u * (x * rr) + v * (y * rr) for x, y in prof_])
    return prim(P, rings, mat, col, flag, None, jitter=0.015)


def pipe_run(P, pts, r=0.03, mat="dark", col=(0.2, 0.2, 0.2), bend=0.15, n=6, clamps=0, clamp_col=None):
    """A pipe through a polyline with rounded bends, optionally with clamp collars (hydraulic lines, coolant runs)."""
    path = round_path(pts, bend)
    tube_along(P, path, r, mat, col, n)
    if clamps and len(path) >= 2:
        for i in range(clamps):
            t = (i + 0.5) / clamps
            k = min(len(path) - 2, int(t * (len(path) - 1)))
            a, b = path[k], path[k + 1]
            m = (a + b) / 2
            d = b - a
            if d.length > 1e-4:
                bar(P, m - d.normalized() * 0.025, m + d.normalized() * 0.025, r * 1.55, "trim", clamp_col or (0.5, 0.5, 0.48), n)


def cable_droop(P, a, b, sag=0.15, r=0.014, mat="dark", col=(0.1, 0.1, 0.11), n=4, segs=7):
    """A cable hanging between two points (a parabola sagging down by `sag` mid span)."""
    a, b = Vector(a), Vector(b)
    path = []
    for i in range(segs + 1):
        t = i / segs
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        path.append(p)
    return tube_along(P, path, r, mat, col, n)


CABLE_COLS = [(0.10, 0.10, 0.11), (0.62, 0.20, 0.12), (0.12, 0.18, 0.30), (0.78, 0.62, 0.16)]


def cable_loom(P, a, b, n=3, spread=0.03, r=0.012, sag=0.1, rng=None, cols=None, ties=2):
    """A bundle of n cables from a to b (slightly different sags), with cable ties along it."""
    rng = rng or random.Random(5)
    a, b = Vector(a), Vector(b)
    d = b - a
    if d.length < 1e-3:
        return
    t = d.normalized()
    u = t.cross(Vector((0, 0, 1)))
    if u.length < 1e-3:
        u = t.cross(Vector((1, 0, 0)))
    u.normalize()
    v = t.cross(u)
    cols = cols or CABLE_COLS
    for k in range(n):
        ang = 2 * math.pi * k / n
        off = (u * math.cos(ang) + v * math.sin(ang)) * spread
        cable_droop(P, a + off, b + off, sag * rng.uniform(0.85, 1.15), r, "dark", cols[k % len(cols)], 4, 6)
    for i in range(ties):
        tt = (i + 1) / (ties + 1)
        c = a.lerp(b, tt)
        c.z -= sag * 4 * tt * (1 - tt)
        bar(P, c - t * 0.02, c + t * 0.02, spread + r * 1.8, "trim", (0.2, 0.2, 0.2), 6)


def junction_box(P, c, n=(0, -1, 0), w=0.36, h=0.28, d=0.14, mat="trim", col=(0.35, 0.35, 0.33), lamp_col=(0.45, 0.85, 1.0), conduit=True):
    """A bolted-on junction box on a surface (outward normal n): body, a door plate with four bolts, an indicator lamp, conduit."""
    u, v, nn = basis_from(n)
    c = Vector(c)
    surf_blk(P, c, u, v, nn, w, h, d, mat, col, ch=0.02)
    surf_blk(P, c, u, v, nn, w * 0.86, h * 0.84, 0.02, "dark", shade(col, 0.6), off=d, ch=0.01)
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        bolt(P, c + u * sx * w * 0.38 + v * sy * h * 0.36 + nn * (d + 0.02), nn, 0.016, 0.014)
    surf_blk(P, c + u * w * 0.2 + v * h * 0.12, u, v, nn, 0.05, 0.03, 0.015, "glow", lamp_col, off=d + 0.02, flag=NOBAKE)
    if conduit:
        bar(P, c - v * h * 0.5, c - v * (h * 0.5 + 0.18) + nn * 0.02, 0.022, "dark", (0.18, 0.18, 0.2), 6)


def ladder(P, base, top, across, width=0.42, mat="trim", col=(0.4, 0.4, 0.38), rung=0.3, r=0.02):
    """A rung ladder (round rails and rungs) from base to top; `across` is the direction of its width."""
    base, top = Vector(base), Vector(top)
    ac = Vector(across).normalized() * width / 2
    for s in (1, -1):
        bar(P, base + ac * s, top + ac * s, r, mat, col, 6)
    ln = (top - base).length
    for i in range(1, int(ln / rung)):
        p = base + (top - base) * (i * rung / ln)
        bar(P, p - ac, p + ac, r * 0.8, mat, col, 5)


def handrail(P, pts, post_z0=None, r=0.02, post_every=0.9, mat="trim", col=(0.4, 0.4, 0.38)):
    pts = [Vector(p) for p in pts]
    tube_along(P, round_path(pts, 0.12, 2), r, mat, col, 6)
    if post_z0 is not None:
        for a, b in zip(pts[:-1], pts[1:]):
            ln = (b - a).length
            for i in range(max(1, int(ln / post_every) + 1)):
                p = a.lerp(b, min(1.0, i * post_every / ln)) if ln > 1e-4 else a
                bar(P, Vector((p.x, p.y, post_z0)), p, r * 0.9, mat, col, 5)


def louvres(P, c, u, v, n, w, h, count, mat="dark", col=(0.1, 0.1, 0.11), tilt=0.5, t=0.025, back=True):
    """Angled slat vents on a surface; a dark backing plate behind."""
    u, v, nn = Vector(u).normalized(), Vector(v).normalized(), Vector(n).normalized()
    c = Vector(c)
    if back:
        surf_blk(P, c, u, v, nn, w, h, 0.02, "dark", shade(col, 0.55), ch=0.0)
    R = frame_mat(u, v, nn) @ Matrix.Rotation(tilt, 4, "X")
    for i in range(count):
        p = c + v * (-h / 2 + (i + 0.5) * h / count) + nn * (0.03 + t)
        blk(P, p, (w, t * 2.2, h / count * 0.78), mat, col, ch=0.0, rot=R, mid=True)


def heat_sink(P, c, w, l, h, fins, axis="y", mat="trim", col=(0.45, 0.45, 0.43), base=0.05):
    """A finned heat sink: a base plate with thin fins standing on it, fins running along `axis` (y or x), spaced across the other."""
    cx, cy, cz = c
    blk(P, (cx, cy, cz), (w, l, base), mat, shade(col, 0.8), ch=0.01)
    for i in range(fins):
        f = (i + 0.5) / fins - 0.5
        if axis == "y":
            blk(P, (cx + f * (w - 0.06), cy, cz + base), (0.022, l - 0.04, h), mat, col, ch=0.0)
        else:
            blk(P, (cx, cy + f * (l - 0.06), cz + base), (w - 0.04, 0.022, h), mat, col, ch=0.0)


def hex_lamp(P, c, n, r=0.1, depth=0.05, col=(1.0, 0.74, 0.28), rim=(0.15, 0.15, 0.16), wreck=False):
    """A hexagonal lamp: dark housing, glowing face."""
    u, v, nn = basis_from(n)
    c = Vector(c)
    bar(P, c, c + nn * depth, r * 1.18, "dark", rim, 6)
    fs = bar(P, c + nn * depth, c + nn * (depth + 0.012), r * 0.92, "glow", col, 6)
    for f in fs:
        f[P.flag] = 0 if wreck else NOBAKE


def shell(P, stations, mat, col, flag=0, jitter=0.02):
    """A hull loft: stations = [(y, [(x, z), ...])], same point count at every station (see prof())."""
    rings = [[Vector((x, y, z)) for x, z in pts] for y, pts in stations]
    return prim(P, rings, mat, col, flag, None, jitter=jitter)


def prof(wb, ws, wt, zb, zs, zt, c=0.06):
    """A 10-point faceted section: base width wb at zb, shoulder width ws at zs (the belt line), top width wt at zt, chamfer c."""
    c = max(0.0, min(c, (zt - zb) * 0.3, wt * 0.8, wb * 0.8))
    return [(-wb + c, zb), (wb - c, zb), (wb, zb + c), (ws, zs), (wt, zt - c), (wt - c, zt),
            (-wt + c, zt), (-wt, zt - c), (-ws, zs), (-wb, zb + c)]


def st(y, wb, ws, wt, zb, zs, zt, c=0.06):
    return (y, prof(wb, ws, wt, zb, zs, zt, c))


def placed(P, fn, M):
    """Runs fn() (which builds into P) and then moves everything it created by the matrix M."""
    before = set(P.bm.verts)
    fn()
    new = [v for v in P.bm.verts if v not in before]
    bmesh.ops.transform(P.bm, matrix=M, verts=new)
    return new


def dune(P, c, L, W, h, yaw=0.0, lean=0.3, seed=0, res=(18, 11), col=(0.82, 0.69, 0.48)):
    """A smooth sculpted sand mound: a long asymmetric heap (steep one end, long tail), noise on top, feathered to nothing at
    the rim so it merges with the ground. c = centre on the ground, L along the local Y, W across, h the crest height."""
    bm = P.bm
    nu, nv = res
    s0 = Vector((seed * 1.3 + 0.4, seed * 0.7 + 2.2, seed * 0.5 + 5.1))
    R = Matrix.Rotation(yaw, 4, "Z")
    verts = []
    for i in range(nu + 1):
        row = []
        for j in range(nv + 1):
            u = i / nu * 2 - 1
            v = j / nv * 2 - 1
            uu = u + lean * (1 - u * u) * 0.5
            fu = max(0.0, 1 - uu * uu)
            fv = max(0.0, 1 - v * v)
            f = (fu ** 1.5) * (fv ** 1.3)
            p = Vector((v * W / 2, u * L / 2, 0.0))
            n1 = noise.noise(Vector((p.x * 0.5, p.y * 0.4, 0)) + s0) * 0.5 + 0.5
            z = h * f * (0.78 + 0.34 * n1) - 0.05
            z += 0.018 * math.sin((u * L * 1.6 + v * 0.9) * 3.0) * min(1.0, f * 4)
            q = Vector((p.x, p.y, max(z, -0.05)))
            row.append(bm.verts.new(R @ q + Vector(c) - P.origin))
        verts.append(row)
    si = sec_index("sand")
    for i in range(nu):
        for j in range(nv):
            try:
                f = bm.faces.new((verts[i][j], verts[i][j + 1], verts[i + 1][j + 1], verts[i + 1][j]))
            except ValueError:
                continue
            f[P.sec] = si
            f[P.flag] = 0
            f.smooth = True
            for l in f.loops:
                z = l.vert.co.z
                k = 0.90 + 0.14 * clamp(z / max(h, 0.1)) + 0.03 * math.sin(l.vert.co.y * 4.0 + l.vert.co.x * 1.5)
                l[P.col] = (clamp(col[0] * k), clamp(col[1] * k), clamp(col[2] * k), 1.0)
    bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces])


def limb(P, a, b, w, d, mat="primary", col=(0.5, 0.5, 0.5), ch=0.06, taper=0.0, flag=0):
    """A chamfered box along a->b (width w across, depth d front-back as seen with Z up); taper narrows the b end."""
    a, b = Vector(a), Vector(b)
    ln = (b - a).length
    if ln < 1e-4:
        return []
    q = (b - a).to_track_quat("Z", "Y")
    R = q.to_matrix().to_4x4()
    hw0, hw1 = w / 2, w / 2 * (1 - taper)
    hd0, hd1 = d / 2, d / 2 * (1 - taper)
    rings = []
    for t, hw, hd in ((-0.5, hw0, hd0), (0.5, hw1, hd1)):
        c = min(ch, hw * 0.8, hd * 0.8)
        ring = [(-hw + c, -hd), (hw - c, -hd), (hw, -hd + c), (hw, hd - c), (hw - c, hd), (-hw + c, hd), (-hw, hd - c), (-hw, -hd + c)]
        rings.append([Vector((x, y, t * ln)) for x, y in ring])
    M = Matrix.Translation((a + b) / 2) @ R
    return prim(P, rings, mat, col, flag, M)


def bake(P, wear, strength=1.0):
    """AO-style ground/underside shading, dirt noise, and for wrecks soot, rust and dust, all into the loop colours."""
    bm = P.bm
    bm.normal_update()
    wear = wear or {}
    soot, rust, dust = wear.get("soot", 0.0), wear.get("rust", 0.0), wear.get("dust", 0.2)
    desat = wear.get("desat", 0.0)
    scorch = [(Vector(c), r, k) for c, r, k in wear.get("scorch", [])]   # (centre, radius, strength): burnt patches
    s0 = Vector((P.seed * 1.7 + 3.1, P.seed * 0.9 + 7.7, P.seed * 0.4 + 1.3))
    for f in bm.faces:
        if f[P.flag] & NOBAKE:
            continue
        nz = f.normal.z
        sec = SECTIONS[f[P.sec]]
        for l in f.loops:
            p = l.vert.co + P.origin
            c = Vector(l[P.col][:3])
            ao = 0.70 + 0.30 * smooth(p.z / 1.3)
            if sec == "sand":
                ao = 0.95
            nf = 0.86 + 0.14 * nz if nz >= 0 else 0.86 + 0.30 * nz
            c *= (ao * nf) ** strength
            n1 = noise.noise(p * 0.85 + s0) * 0.5 + 0.5
            n2 = noise.noise(p * 2.7 + s0 * 1.3) * 0.5 + 0.5
            c *= 0.93 + 0.14 * n2
            col = tuple(c)
            if desat > 0 and sec not in ("glow", "glass"):
                lum = 0.3 * col[0] + 0.55 * col[1] + 0.15 * col[2]
                col = mix(col, (lum, lum * 0.97, lum * 0.92), desat)
            if sec in ("primary", "secondary", "trim", "cargo", "dark"):
                if rust > 0:
                    col = mix(col, RUST, rust * smooth((n2 - 0.45) * 2.4) * (0.6 if sec != "dark" else 0.35))
                if soot > 0:
                    col = mix(col, SOOT, soot * smooth((n1 - 0.40) * 3.2) * (0.5 + 0.5 * clamp(1.5 - p.z * 0.3)))
            if scorch and sec != "glow":
                t = 0.0
                for sc_c, sc_r, sc_k in scorch:
                    t = max(t, smooth(1.0 - (p - sc_c).length / sc_r) * sc_k)
                if t > 0.0:
                    rim = clamp(1.0 - abs(t - 0.28) * 4.5) * 0.45   # heat-tempered brown ring round the char
                    col = mix(col, (0.30, 0.17, 0.09), rim)
                    col = mix(col, SOOT_DEEP, clamp(t * 1.25) * 0.92)
            if sec != "glow" and dust > 0:
                low = clamp(1.0 - p.z / 1.1)
                col = mix(col, DUST, dust * (max(0.0, nz) * (0.45 + 0.55 * n1) * 0.8 + low * 0.35 * n2))
            l[P.col] = (clamp(col[0]), clamp(col[1]), clamp(col[2]), 1.0)


def material(name, rgb):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*rgb, 1.0)
    return m


def emit(P, parent, wear=None, location=None):
    """Bakes and turns the piece into a mesh object under `parent`. Returns the object (or None if empty)."""
    if P.empty():
        return None
    bake(P, wear)
    bm = P.bm
    me = bpy.data.meshes.new(P.name)
    cols = [tuple(l[P.col]) for f in bm.faces for l in f.loops]
    mats = [f[P.sec] for f in bm.faces]
    bm.to_mesh(me)
    bm.free()
    for s in SECTIONS:
        me.materials.append(material("Veh_" + s.capitalize(), SECTION_PREVIEW[s]))
    sand = SECTIONS.index("sand")
    for poly, mi in zip(me.polygons, mats):
        poly.material_index = mi
        poly.use_smooth = (mi == sand)   # drifts are sculpted, smooth shaded; everything hard-surface stays faceted
    ca = me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for i, c in enumerate(cols):
        ca.data[i].color_srgb = c
    me.update()
    me.calc_loop_triangles()
    P.tris = len(me.loop_triangles)
    obj = bpy.data.objects.new(P.name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = P.origin
    return obj


def new_empty(name, parent=None, loc=(0, 0, 0), kind="PLAIN_AXES", size=0.3):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind
    e.empty_display_size = size
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def export_fbx(root, path):
    bpy.ops.object.select_all(action="DESELECT")
    objs = [root] + list(root.children_recursive)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={"MESH", "EMPTY"},
                             apply_scale_options="FBX_SCALE_UNITS", axis_forward="-Z", axis_up="Y",
                             bake_space_transform=True, mesh_smooth_type="OFF", add_leaf_bones=False,
                             path_mode="STRIP", use_mesh_modifiers=False, colors_type="SRGB")
