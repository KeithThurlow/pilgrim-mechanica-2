"""Rampart "Wildcat": the scrap-built Rampart (Wildcat / Scrap-Crafted, "The Self-Made Anomaly"), 2026-10-24.

    node tools/blender/run.mjs tools/blender/mechs/studies/rampart/export_game.py -- \
        --model tools/blender/mechs/variants/rampart-wildcat/rampart-wildcat.py --out <scratchpad>/rampart-wildcat.fbx
    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-wildcat/wildcat_shots.py -- --out <DIR> --only game40,...

The same machine as rampart_v4 (same masses, joints, legs, twin hull miniguns: the game contract), kept running by
salvagers who rebuilt it from whatever they found. Everything here sits on top of v4's construction:

  * paint: panels replaced from other machines in other paint (faded blue-grey, construction yellow, red-oxide primer, bare
    steel), never as a pair: the right thigh's front plate is blue where the left is khaki, the left knee cap yellow, the
    left pauldron blue, one hood side primer (repaint(): each listed panel keeps its edge bands and insets, only its paint
    changes). A stray unit number ("27") on the blue thigh plate says where it came from.
  * scrap armour (layer 10, mods, dialled heavy): torch-cut plates with clipped corners welded on over hit spots with visible
    weld beads (a primer patch on the face shield's leg, plates on the thigh, shin, hull flank, gun receiver), a stop sign
    welded on as a patch, weld-stitched crack repairs.
  * spaced armour: a tyre hung on the crotch skirt by chains, a tyre and sandbags strapped on the side-box tops (they read
    from the 50 deg game camera), a track section hung down the left cannon, a rebar slat cage over the left hull flank,
    a rusted corrugated sheet on brackets off the right thigh (a side skirt).
  * sensors: a lamp bar on posts over the brow, a spot on the left pauldron, a lamp clamped on each gun, a scavenged
    fishbone antenna on the hood.
  * the guns show field repairs: strap bands round the receiver, a welded patch, a feed box from another gun (yellow).
  * wear: the bake's chipping and dust turned up (K.bake_all wear 0.7, dust 0.35).

Signature form kept whole: the face shield (the chest's upside-down U); the primer patch is welded ON it, its outline and
the seams round it are v4's. The back (y > 1.0 behind the hull) stays clear for the game's drums and power pack.
Units m, Z up, front -Y, the mech's left +X (as v4).
"""
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
STUDY = os.path.join(MECHS, "studies", "rampart")
for p in (HERE, STUDY, MECHS, os.path.join(MECHS, "studies", "military")):
    if p not in sys.path:
        sys.path.insert(0, p)

import rampart_v4 as R  # noqa: E402
import hskit as H  # noqa: E402
import mil_kit as K  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from rampart_v2 import ccw  # noqa: E402
from wildcat_util import islands  # noqa: E402

V3 = Vector
X_, Y_, Z_ = V3((1, 0, 0)), V3((0, 1, 0)), V3((0, 0, 1))
V = R.V

# what export_game.py and shots.py read from a model module
HIP_Z, GX, GZ, POSE, HAS_WEAPON_LAYER = R.HIP_Z, R.GX, R.GZ, R.POSE, True
joints, build_mass, mass_layer = R.joints, R.build_mass, R.mass_layer

# ------------------------------------------------------------------------------------------------------------ palette
BLUEGREY = (0.40, 0.47, 0.52)     # a faded plate off another faction's machine
YELLOW = (0.74, 0.60, 0.22)       # construction-machine yellow, sun-faded
PRIMER = (0.56, 0.25, 0.17)       # red-oxide primer on a fresh patch
STEEL = (0.55, 0.54, 0.50)        # bare plate, never painted
SCRAP_DK = (0.36, 0.35, 0.31)     # grey scrap plate
RUST = (0.42, 0.26, 0.17)         # rebar
BEAD = (0.24, 0.22, 0.21)         # weld beads (dark, heat-tinted)
RUBBER = (0.16, 0.155, 0.15)
SHEET = (0.47, 0.38, 0.29)        # an old rusted sheet (the thigh skirt)
CANVAS = (0.46, 0.44, 0.31)       # olive-drab sandbags
CANVAS2 = (0.60, 0.53, 0.38)      # tan sandbags
STOP_RED = (0.66, 0.13, 0.11)
WHITE = (0.86, 0.84, 0.78)
LAMP = (0.30, 0.30, 0.28)
GLOW = R.GLOW
TRACK = (0.30, 0.29, 0.27)

# panels to repaint (part, world centroid of the panel at rest from probe_panels.py, new paint)
REPAINT = [
    ("Torso", (0.82, -0.27, 4.32), BLUEGREY),      # left pauldron: off another machine
    ("Torso", (-0.87, 0.81, 4.15), YELLOW),        # right hull flank, back panel
    ("Torso", (-0.29, 0.35, 4.83), PRIMER),        # right hood side: a new plate, primed, never painted
    ("Torso", (0.75, -0.16, 3.70), STEEL),         # left chest side: bare
    ("Thigh_R", (-0.94, -0.33, 2.34), BLUEGREY),   # the replaced thigh front: does not match its pair
    ("Thigh_L", (1.17, 0.21, 1.92), PRIMER),       # left thigh, lower back
    ("Shin_L", (1.12, -0.24, 1.30), YELLOW),       # left knee cap from a loader
    ("Meta_L", (1.15, 0.74, 1.38), PRIMER),        # left horn
    ("Meta_R", (-1.25, 0.30, 0.48), STEEL),        # right lower pod: bare
    ("Pelvis", (0.50, -0.37, 3.35), BLUEGREY),     # left hip wing
    ("Arm_R", (-2.21, -0.17, 4.00), PRIMER),       # gun receiver, outer front (both guns in the game)
    ("Arm_R", (-1.96, 0.92, 4.02), YELLOW),        # feed box off another gun
    ("Arm_R", (-1.42, 0.27, 4.40), BLUEGREY),      # gun shoulder cap
    ("Foot_L", (1.55, -0.46, 0.23), PRIMER),       # one toe cap replaced
    ("Torso", (-0.71, 0.44, 4.66), STEEL),         # right side-box top, under the tyre: bare
    ("Meta_R", (-1.15, 0.74, 1.38), R.KHAKI),      # right horn: a khaki one where the pair is primer
]


def repaint(part, centre, col, tol=0.08):
    """Repaints the plate panel of `part` whose centroid is nearest `centre` (within tol): every face is scaled by
    col / the panel's base paint, so its lighter rim, darker edge band, insets and inner skin keep their relations."""
    P = part.layers.get("plates")
    if P is None:
        return False
    best, bd = None, tol
    for faces in islands(P.bm):
        area = sum(f.calc_area() for f in faces)
        if area < 0.01:
            continue
        c = sum((f.calc_center_median() * f.calc_area() for f in faces), V3()) / area + P.origin
        d = (c - V3(centre)).length
        if d < bd:
            best, bd = faces, d
    if best is None:
        print("WILDCAT repaint miss", part.name, centre)
        return False
    hist = {}                    # the base paint: the brightest colour covering 20% of the panel (not the inner skin)
    tot = 0.0
    for f in best:
        key = tuple(round(x, 2) for x in f.loops[0][P.col][:3])
        hist[key] = hist.get(key, 0.0) + f.calc_area()
        tot += f.calc_area()
    base = max((c for c, a in hist.items() if a >= 0.2 * tot), key=sum, default=max(hist, key=hist.get))
    k = [col[i] / max(base[i], 1e-3) for i in range(3)]
    for f in best:
        for lp in f.loops:
            c = lp[P.col]
            lp[P.col] = (min(1.0, c[0] * k[0]), min(1.0, c[1] * k[1]), min(1.0, c[2] * k[2]), 1.0)
    return True


# ------------------------------------------------------------------------------------------------- surfaces to build on
def skin(solids):
    """One projection target over several solids (the ray takes the first hit, so plates over plates work)."""
    S = H.Solid("skin")
    for x in solids:
        H.commit(x, S)
    return H.Surface(S)


def tframe(n, up=Z_, spin=0.0):
    """u (across), v (up the surface) for a surface normal n; spin turns them in the plane (degrees)."""
    n = V3(n).normalized()
    u = V3(up).cross(n)
    if u.length < 1e-3:
        u = X_.cross(n) if abs(n.x) < 0.9 else Y_.cross(n)
    u.normalize()
    v = n.cross(u).normalized()
    if spin:
        a = math.radians(spin)
        u, v = u * math.cos(a) + v * math.sin(a), v * math.cos(a) - u * math.sin(a)
    return u, v


def on(surf, p, along):
    """The first surface hit looking along `along` through p (from far behind p, so p can sit anywhere on the line)."""
    d = V3(along).normalized()
    loc = surf.tree.ray_cast(V3(p) - d * 6.0, d, 12.0)[0]
    if loc is None:
        print("WILDCAT on() miss", tuple(p))
        return surf.project(V3(p))
    return surf.project(loc, along=d)


# ---------------------------------------------------------------------------------------------------- mods primitives
def scrap_plate(S, co, n, w, h, t=0.035, col=SCRAP_DK, seed=0, up=Z_, spin=0.0, sink=0.015, bead=0.014, bolts=2):
    """A torch-cut scrap plate welded on: a rectangle with randomly clipped corners and a slightly ragged outline, sunk a
    little into the plate below (it follows no seam: it covers a hit), a weld bead all round its foot, a few bolts."""
    rnd = random.Random(seed)
    u, v = tframe(n, up, spin)
    hw, hh = w / 2, h / 2
    pts = []
    for cx, cy, a0, a1 in ((hw, -hh, (0, 1), (-1, 0)), (hw, hh, (-1, 0), (0, -1)), (-hw, hh, (0, -1), (1, 0)),
                           (-hw, -hh, (1, 0), (0, 1))):
        c = rnd.uniform(0.0, 0.32) * min(w, h)
        if c > 0.035:
            pts += [(cx + a1[0] * c, cy + a1[1] * c), (cx + a0[0] * c, cy + a0[1] * c)]
        else:
            pts.append((cx, cy))
    pts = [(x + rnd.uniform(-0.008, 0.008), y + rnd.uniform(-0.008, 0.008)) for x, y in pts]
    outline = ccw(R.hull2d(pts))
    M = H.frame_matrix(V3(co) - V3(n) * sink, u, v, n)
    pl = H.prism(outline, "z", 0.0, t + sink, "primary", col, "scrap")
    H.xform(pl, M)
    nn = V3(n).normalized()
    for f in pl.bm.faces:                       # torch-cut edges darker than the face (the thickness reads)
        if abs(f.normal.dot(nn)) < 0.5:
            for lp in f.loops:
                c = lp[pl.col]
                lp[pl.col] = (c[0] * 0.72, c[1] * 0.72, c[2] * 0.72, 1.0)
    H.commit(pl, S)
    if bead:
        chain = [M @ V3((x, y, sink + 0.002)) for x, y in outline]
        H.weld_bead(S, chain + [chain[0]], bead, "dark", BEAD, pitch=0.05)
    for i in range(bolts):
        x, y = outline[(i * len(outline)) // max(1, bolts)]
        V.bolt(S, M @ V3((x * 0.78, y * 0.78, t + sink)), nn, r=0.016, h=0.018, col=STEEL)
    return M


def stop_sign(S, co, n, r=0.20, up=Z_, sink=0.012):
    """A stop sign welded on as a patch (Wildcat: rebar, stop signs and raw spite): a white octagon under a red one."""
    u, v = tframe(n, up)
    nn = V3(n).normalized()
    M = H.frame_matrix(V3(co) - nn * sink, u, v, nn)
    oct_ = lambda rr: [(rr * math.cos(math.radians(22.5 + 45 * k)), rr * math.sin(math.radians(22.5 + 45 * k)))  # noqa
                       for k in range(8)]
    for rr, z0, z1, col in ((r, 0.0, sink + 0.012, WHITE), (r - 0.022, sink + 0.012, sink + 0.016, STOP_RED)):
        pl = H.prism(oct_(rr), "z", z0, z1, "secondary", col, "stop")
        H.commit(H.xform(pl, M), S)
    chain = [M @ V3((x, y, sink + 0.002)) for x, y in oct_(r)]
    H.weld_bead(S, chain + [chain[0]], 0.012, "dark", BEAD, pitch=0.05)


def weld_line(S, surf, pts, along, r=0.012, lift=0.003, step=0.03):
    """A weld bead stitched along a crack: a polyline projected onto the surface."""
    out = []
    for a, b in zip(pts, pts[1:]):
        a, b = V3(a), V3(b)
        k = max(1, int((b - a).length / step))
        for i in range(k):
            co, n = on(surf, a.lerp(b, i / k), along)
            out.append(co + n * lift)
    co, n = on(surf, pts[-1], along)
    out.append(co + n * lift)
    H.weld_bead(S, out, r, "dark", BEAD, pitch=0.045)


def zigzag(a, b, amp, n, side):
    """A crack's path from a to b, wandering across `side` by up to amp."""
    a, b, side = V3(a), V3(b), V3(side)
    rnd = random.Random(int((a.x + a.y * 3 + a.z * 7) * 1000))
    return [a.lerp(b, i / n) + side * (rnd.uniform(-amp, amp) if 0 < i < n else 0.0) for i in range(n + 1)]


def tyre(S, c, axis, R_=0.30, r=0.095, col=RUBBER, seg=18):
    """A tyre: a squarish torus (the tread flat, the walls bulged), axis through the hub."""
    a = V3(axis).normalized()
    e1 = a.orthogonal().normalized()
    e2 = a.cross(e1)
    rings = []
    for i in range(seg):
        th = 2 * math.pi * i / seg
        rad = e1 * math.cos(th) + e2 * math.sin(th)
        cen = V3(c) + rad * R_
        ring = []
        for j in range(8):
            ph = 2 * math.pi * j / 8
            cr, sr = math.cos(ph), math.sin(ph)
            x = math.copysign(abs(cr) ** 0.6, cr) * r
            y = math.copysign(abs(sr) ** 0.6, sr) * r * 0.85
            ring.append(cen + rad * x + a * y)
        rings.append(ring)
    return V.prim(S, rings, "tyre", col, 0, None, jitter=0.0, closed=True)


def track_section(S, path, n, width=0.24, col=TRACK):
    """A length of track hung as spaced armour: a link plate per segment with a grouser bar across it and pins between."""
    nn = V3(n).normalized()
    for a, b in zip(path, path[1:]):
        a, b = V3(a), V3(b)
        v = (b - a)
        L = v.length
        v.normalize()
        u = v.cross(nn).normalized()
        c = (a + b) / 2
        V.surf_blk(S, c, u, v, nn, width, L * 0.86, 0.035, "trim", col, ch=0.008)
        V.surf_blk(S, c + v * L * 0.15, u, v, nn, width * 0.92, 0.035, 0.025, "trim", V.shade(col, 1.15), off=0.035, ch=0.006)
        V.bar(S, a + nn * 0.018 - u * (width / 2 + 0.02), a + nn * 0.018 + u * (width / 2 + 0.02), 0.014, "trim", STEEL, 6)


def lamp(S, c, d, r=0.065, col=LAMP, guard=True):
    """A work lamp: a short housing along d, a glowing lens, a wire guard across the lens."""
    d = V3(d).normalized()
    c = V3(c)
    V.bar(S, c - d * 0.05, c + d * 0.07, r, "trim", col, 10, r2=r * 1.1)
    f = V.bar(S, c + d * 0.07, c + d * 0.085, r * 0.92, "glow", GLOW, 10)
    H.glow_flag(f, S)
    if guard:
        u = d.orthogonal().normalized()
        w = d.cross(u)
        for e in (u, w):
            V.bar(S, c + d * 0.095 - e * r, c + d * 0.095 + e * r, 0.006, "trim", STEEL, 4)


def chain(S, a, b, links=6, r=0.012):
    """A hanging chain (short bars, alternating twist) from a to b."""
    a, b = V3(a), V3(b)
    for i in range(links):
        p, q = a.lerp(b, i / links), a.lerp(b, (i + 1) / links)
        V.bar(S, p, q, r * (1.0 if i % 2 else 0.7), "trim", V.shade(STEEL, 0.8), 5)


def strap(S, pts, w=0.05, col=(0.25, 0.24, 0.20)):
    """A ratchet strap / steel band over something: flat bars along a polyline."""
    for a, b in zip(pts, pts[1:]):
        V.bar(S, a, b, w * 0.35, "trim", col, 4)


# ------------------------------------------------------------------------------------------------------------ per part
def mods_torso(part):
    S = H.Solid("mods")
    sen = H.Solid("sensors")
    up = R.chest_mass(0.035)
    surf = skin([up, R.rear_mass(0.03), R.hood_mass(0.03), R.pauldron_mass(1, 0.0), R.pauldron_mass(-1, 0.0)])
    # the face shield: a primer patch welded on the left leg of the U (on it, not through it: the outline stays v4's)
    co, n = on(surf, (0.42, -2.0, 3.50), Y_)
    scrap_plate(S, co, n, 0.24, 0.20, 0.03, PRIMER, seed=3, spin=-18, bolts=0)
    # crack welds: across the right cheek, down the left chest side
    weld_line(S, surf, zigzag((-0.62, -2, 4.20), (-0.80, -2, 3.98), 0.025, 5, X_), Y_)
    weld_line(S, surf, zigzag((2.0, -0.48, 3.92), (2.0, -0.20, 3.46), 0.03, 6, Y_), -X_)
    co, n = on(surf, (-0.70, -2.0, 3.62), Y_)
    scrap_plate(S, co, n, 0.26, 0.30, 0.03, SCRAP_DK, seed=5, spin=14)
    # the right hull flank: the stop sign over the yellow panel, scrap plates lower down
    co, n = on(surf, (-2.0, 0.85, 4.28), X_)
    stop_sign(S, co, n, 0.17)
    co, n = on(surf, (-2.0, 0.62, 3.88), X_)
    scrap_plate(S, co, n, 0.34, 0.22, 0.03, STEEL, seed=11, spin=6)
    co, n = on(surf, (-2.0, 0.98, 3.92), X_)
    scrap_plate(S, co, n, 0.22, 0.26, 0.03, SCRAP_DK, seed=12, spin=-9)
    # the left hull flank: a rebar slat cage standing off the back panel (spaced armour over the vent side)
    co, n = on(surf, (2.0, 0.78, 4.12), -X_)
    u, v = tframe(n)
    H.slats(S, co, u, v, n, 0.62, 0.56, 4, standoff=0.14, r=0.016, mat="cargo", col=RUST)
    # side-box tops (they read from the 50 deg camera): sandbags left, a tyre strapped flat on the right
    for x, y, col, yaw, lift in ((0.64, 0.22, CANVAS, 1.62, 0.0), (0.84, 0.30, CANVAS2, 1.50, -0.04), (0.66, 0.72, CANVAS2, 1.55, 0.0),
                                 (0.86, 0.74, CANVAS, 1.64, -0.04), (0.74, 0.48, CANVAS, 1.57, 0.12)):
        co, n = on(surf, (x, y, 6.0), -Z_)
        H.sandbag(S, co + n * (lift - 0.03), (0.50, 0.28, 0.15), yaw=yaw, col=col, up=n)
    co, n = on(surf, (0.74, 0.47, 6.0), -Z_)
    strap(S, [co + V3((-0.26, 0, -0.08)), co + V3((-0.20, 0, 0.30)), co + V3((0.20, 0, 0.30)), co + V3((0.28, 0, -0.12))])
    co, n = on(surf, (-0.72, 0.52, 6.0), -Z_)
    tyre(S, co + n * 0.08, n, 0.24, 0.085)
    strap(S, [co + V3((0.0, -0.40, -0.06)), co + n * 0.19 + V3((0, -0.16, 0)), co + n * 0.19 + V3((0, 0.16, 0)),
              co + V3((0.0, 0.40, -0.06))])
    # a lamp bar on two posts over the brow, three lamps; a spot on the left pauldron
    for x in (-0.22, 0.22):
        co, n = on(surf, (x, -0.36, 6.0), -Z_)
        V.bar(S, co, V3((x, -0.50, 5.02)), 0.02, "trim", STEEL, 6)
    V.bar(S, V3((-0.42, -0.50, 5.02)), V3((0.42, -0.50, 5.02)), 0.025, "trim", V.shade(STEEL, 0.85), 6)
    for x in (-0.24, 0.0, 0.24):
        lamp(sen, V3((x, -0.58, 5.02)), V3((0, -1, -0.25)), 0.06)
    co, n = on(surf, (0.86, -0.36, 6.0), -Z_)
    V.bar(S, co, co + V3((0, 0, 0.12)), 0.02, "trim", STEEL, 6)
    lamp(sen, co + V3((0, -0.06, 0.18)), V3((0.1, -1, -0.15)), 0.075)
    # a scavenged fishbone antenna on the hood's left rear, next to v4's whip
    co, n = on(surf, (0.30, 0.92, 6.0), -Z_)
    top = co + V3((0.02, 0.06, 0.95))
    V.bar(S, co, top, 0.018, "trim", STEEL, 6, r2=0.010)
    for k in range(5):
        p = co.lerp(top, 0.45 + 0.13 * k)
        hw = 0.20 - 0.025 * k
        V.bar(S, p - V3((hw, 0, 0)), p + V3((hw, 0, 0)), 0.007, "trim", STEEL, 4)
    V.bar(S, co.lerp(top, 0.35) + V3((0, -0.02, 0)), co.lerp(top, 0.35) + V3((0, -0.20, 0.04)), 0.008, "trim", STEEL, 4)
    V.surf_blk(S, co, X_, Y_, n, 0.14, 0.14, 0.03, "trim", V.shade(STEEL, 0.8))       # its welded foot plate
    commit(part, "mods", S)
    commit(part, "sensors", sen)


def mods_pelvis(part):
    S = H.Solid("mods")
    surf = skin([R.skirt_mass(0.0), R.wing_mass(0.0), R.keel_mass(0.0)])
    # a tyre hung on the crotch skirt by two chains from the wings (spaced armour in front of the hip block)
    c = V3((0.0, -0.66, 2.94))
    tyre(S, c, V3((0, 1, 0.12)), 0.27, 0.085)
    for x in (-0.22, 0.22):
        co, n = on(surf, (x, -2.0, 3.30), Y_)
        chain(S, co + n * 0.01, c + V3((x * 0.8, 0.0, 0.24)), 5)
    co, n = on(surf, (-0.42, -2.0, 3.36), Y_)
    weld_line(S, surf, zigzag((-0.50, -2, 3.40), (-0.32, -2, 3.25), 0.02, 4, Z_), Y_)
    commit(part, "mods", S)


def thigh_world(s, d):
    return H.xform(R.thigh_mass(s, d), R.leg_M(s) @ R.shear(s))


def mods_thigh(part, s):
    S = H.Solid("mods")
    surf = skin([thigh_world(s, 0.035)])
    if s > 0:
        # left: a primer plate low on the front, a stitched crack higher up, a grey plate on the outer prow
        co, n = on(surf, (0.92, -2.0, 2.02), Y_)
        scrap_plate(S, co, n, 0.30, 0.24, 0.035, PRIMER, seed=21, spin=7)
        weld_line(S, surf, zigzag((0.78, -2, 2.80), (1.06, -2, 2.58), 0.03, 6, Z_), Y_)
        co, n = on(surf, (2.0, -0.06, 2.75), -X_)
        scrap_plate(S, co, n, 0.26, 0.30, 0.03, SCRAP_DK, seed=22, spin=-5)
    else:
        # right: the replaced blue front plate keeps its old unit's number, a bolt row along its V edge where it was refitted
        co, n = on(surf, (-0.958, -2.0, 2.45), Y_)       # v4's "01" painted out in a darker blue
        u, v = tframe(n)
        V.surf_blk(S, co, u, v, n, 0.30, 0.22, 0.012, "primary", V.shade(BLUEGREY, 0.84), ch=0.004)
        co, n = on(surf, (-0.93, -2.0, 2.13), Y_)
        u, v = tframe(n)
        K.stencil(S, "27", co + n * 0.004, u, v, n, 0.11, "secondary", WHITE)
        for x in (-0.80, -0.94, -1.08, -1.20):
            co, n = on(surf, (x, -2.0, 1.86 - 0.18 * abs(x + 0.94)), Y_)
            V.bolt(S, co, n, r=0.02, h=0.02, col=STEEL)
        # a big rusted sheet hung off the outer flank on three brackets: a side skirt (spaced armour), corrugated
        co, n = on(surf, (-2.0, 0.02, 2.36), X_)
        u, v = tframe(n)
        M = scrap_plate(S, co + n * 0.11, n, 0.62, 0.86, 0.025, SHEET, seed=23, spin=3, sink=0.0, bead=0.0, bolts=4)
        for k in range(7):                       # corrugation ribs pressed into the sheet
            x = -0.24 + 0.08 * k
            V.bar(S, M @ V3((x, -0.36, 0.03)), M @ V3((x, 0.36, 0.03)), 0.011, "primary", V.shade(SHEET, 1.12), 4)
        for dz in (-0.30, 0.0, 0.30):           # brackets welded to the thigh plate
            c2, n2 = on(surf, co + v * dz + u * 0.12, X_)
            V.bar(S, c2, c2 + n2 * 0.12, 0.022, "trim", V.shade(STEEL, 0.75), 6)
            H.weld_bead(S, [c2 + n2 * 0.005 - u * 0.03, c2 + n2 * 0.005 + u * 0.03], 0.012, "dark", BEAD, pitch=0.03)
    commit(part, "mods", S)


def mods_shin(part, s):
    S = H.Solid("mods")
    M = R.leg_M(s)
    surf = skin([H.xform(R.shin_mass(s, 0.03), M), H.xform(R.knee_cap_mass(s, 0.0), M)])
    if s < 0:
        co, n = on(surf, (-2.0, 0.05, 1.22), X_)
        scrap_plate(S, co, n, 0.20, 0.18, 0.03, PRIMER, seed=31, spin=12)
    else:
        weld_line(S, surf, zigzag((1.02, -2, 1.46), (1.20, -2, 1.36), 0.02, 4, Z_), Y_)
    commit(part, "mods", S)


def mods_meta(part, s):
    S = H.Solid("mods")
    surf = skin([H.xform(R.cannon_mass(s, 0.035), R.leg_M(s))])
    hk, an = R.hock(s), R.ankle(s)
    if s > 0:
        # left: a length of track hung down the outer side as a skirt (spaced armour over the pipes), on a chain at the top
        path, nrm = [], V3()
        for t in (0.10, 0.24, 0.38, 0.52, 0.66, 0.80):
            p = hk.lerp(an, t)
            co, n = on(surf, p + V3((1.0, 0, 0)), -X_)
            path.append(co + n * 0.07)
            nrm += n
        track_section(S, path, nrm.normalized(), 0.22)
        co, n = on(surf, hk.lerp(an, 0.02) + V3((1.0, 0, 0.05)), -X_)
        chain(S, co, path[0] + V3((0, 0, 0.02)), 3)
    else:
        weld_line(S, surf, zigzag(hk.lerp(an, 0.55) + V3((-1, 0, 0)), hk.lerp(an, 0.80) + V3((-1, 0, 0)), 0.03, 5, Y_), X_)
        co, n = on(surf, hk.lerp(an, 0.30) + V3((-1.0, 0, 0)), X_)
        scrap_plate(S, co, n, 0.18, 0.24, 0.03, SCRAP_DK, seed=41, spin=-10)
    commit(part, "mods", S)


def mods_gun(part):
    """Field repairs on the minigun (the game mirrors this pod onto the left shoulder). Nothing within 0.25 m of the barrel
    axis ahead of the hub, so the spinning cluster's split stays clean."""
    S = H.Solid("mods")
    sen = H.Solid("sensors")
    gx = R.GX
    surf = skin([R.recv_mass(0.035), R.gun_mount(0.0)])
    # two steel strap bands round the receiver (a cracked casing held together)
    for y in (-0.10, 0.36):
        ring = []
        for x, z in ((gx - 0.40, 3.86), (gx - 0.40, 4.22), (gx - 0.10, 4.36), (gx + 0.10, 4.36), (gx + 0.40, 4.22),
                     (gx + 0.40, 3.86)):
            co, n = on(surf, (x, y, z), V3((gx, y, 4.04)) - V3((x, y, z)))
            ring.append(co + n * 0.012)
        strap(S, ring, 0.06, (0.30, 0.29, 0.26))
    # a welded patch on the outer flank behind the ejection port, a crack stitched along the top
    co, n = on(surf, (gx - 1.0, 0.52, 4.02), X_)
    scrap_plate(S, co, n, 0.24, 0.20, 0.03, SCRAP_DK, seed=51, spin=-8)
    weld_line(S, surf, zigzag((gx - 0.18, 0.05, 5.0), (gx + 0.12, 0.30, 5.0), 0.03, 5, X_), -Z_)
    # a lamp clamped on top, ahead of the reel, looking down the barrels
    co, n = on(surf, (gx + 0.14, -0.30, 5.0), -Z_)
    V.bar(S, co, co + V3((0, 0, 0.10)), 0.02, "trim", STEEL, 6)
    lamp(sen, co + V3((0, -0.02, 0.15)), V3((0, -1, -0.05)), 0.06)
    commit(part, "mods", S)
    commit(part, "sensors", sen)


def commit(part, layer, S):
    if len(S.bm.faces):
        H.commit(S, part[layer])


_orig_build_parts = R.build_parts


def build_parts():
    parts = _orig_build_parts()
    by = {p.name: p for p in parts}
    for name, c, col in REPAINT:
        repaint(by[name], c, col)
    mods_torso(by["Torso"])
    mods_pelvis(by["Pelvis"])
    mods_gun(by["Arm_R"])
    for s, sfx in ((1, "_L"), (-1, "_R")):
        mods_thigh(by["Thigh" + sfx], s)
        mods_shin(by["Shin" + sfx], s)
        mods_meta(by["Meta" + sfx], s)
    return parts


R.build_parts = build_parts

# wear dialled heavy (layer 10's dial): more chipped chamfers, more dust up the legs
_orig_bake = K.bake_all


def _bake_heavy(pieces, pal, seed=0, ao_rays=20, ao_dist=0.55, wear=0.35, dust=0.25, deep=0.62):
    return _orig_bake(pieces, pal, seed, ao_rays, ao_dist, wear=0.7, dust=0.35, deep=deep)


if getattr(K.bake_all, "__name__", "") != "_bake_heavy":
    K.bake_all = _bake_heavy
build_full = R.build_full
