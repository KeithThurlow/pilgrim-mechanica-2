"""Rampart-reference walker, modelled with the mech-modeling skill v0.1 (its first run, 2026-10-22).

    blender -b --factory-startup -P tools/blender/mechs/studies/rampart/rampart.py -- [--mass] [--out DIR]

Reference: art-refs/mech-reference/rampart.jpg (never committed). Breakdown: docs/mech-skill-2026-10-22/breakdown.md.

Construction (the skill's layers):
  0 mass       every mass is a CSG expression of 2D profiles (side ∩ front ∩ top prisms, plus unions and subtractions), and a
               function of an offset d: mass(d) is the same expression with every profile offset by d. So the plate shell
               (d -0.06..0), the rib hoops (d -0.075) and the frame (d -0.15..-0.2) are derived from the mass exactly, and
               the silhouette gated at step 2 is the plates' outer skin.
  5 plates     shell = mass(d1) - mass(d0) (a carve); each panel = shell ∩ a region prism (an intersect) whose walls become
               the panel's edge band; the rim where a region wall meets the outer skin gets a flat chamfer. Gaps between
               regions are the seams; panels on different shells (raised, inset) overlap like shingles.
  1-4, 6-10    fitted to the mass and the plates (see each part builder).

Units m, Z up, front -Y, the mech's left +X. Height 5.2 m (mechHeight), the cockpit top 4.8 m.
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, MECHS)
sys.path.insert(0, os.path.join(MECHS, "studies", "military"))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import hskit as H  # noqa: E402
import mil_kit as K  # noqa: E402
from mil_kit import V  # noqa: E402

REPO = os.path.abspath(os.path.join(MECHS, "..", "..", ".."))
V3 = Vector

# ----------------------------------------------------------------------------------------------------------- palette
KHAKI = (0.63, 0.57, 0.42)        # the reference's plates (sampled, lifted out of its dim studio light)
KHAKI2 = (0.53, 0.50, 0.37)       # the greener shin guards
DARK = (0.165, 0.158, 0.145)      # gunmetal frame
BARE = (0.55, 0.54, 0.50)
MARK = (0.88, 0.85, 0.74)         # cream stencils
RED = (0.70, 0.17, 0.12)
GLOW = (1.0, 0.72, 0.30)
PAL = H.layer_palette(DARK, BARE, KHAKI, GLOW, mounting=(0.76, 0.74, 0.68))
PAL.update({"bare": BARE, "dust": (0.70, 0.60, 0.45)})
UNDER = V.shade(KHAKI, 0.55)      # a plate's underside (cut by the inner shell)
GREY = (0.62, 0.62, 0.62)         # the mass layer render

# ------------------------------------------------------------------------------------------------------------ joints
SPLAY = math.radians(3.0)
HIP_X, HIP_Y, HIP_Z = 0.86, 0.02, 3.12
THIGH_L, SHIN_L = 1.50, 1.28
WAIST = V3((0.0, 0.10, 3.45))
POD_X, POD_Y, POD_Z = 1.66, -0.05, 4.02
F_REGION, F_INNER = 8, 16           # face flag bits: a panel's region walls, a shell's inner skin (cleared after use)


def leg_rot(s):
    return Matrix.Rotation(-s * SPLAY, 4, "Y")


def hip(s):
    return V3((s * HIP_X, HIP_Y, HIP_Z))


def knee(s):
    return hip(s) + leg_rot(s).to_3x3() @ V3((0, 0, -THIGH_L))


def ankle(s):
    return knee(s) + leg_rot(s).to_3x3() @ V3((0, 0, -SHIN_L))


def rect(x0, x1, y0, y1, clip=0.0):
    """A CCW rectangle with its corners clipped by `clip` (a tuple clips each corner: bl, br, tr, tl)."""
    c = clip if isinstance(clip, (tuple, list)) else (clip,) * 4
    pts = []
    for (x, y), (dx1, dy1), (dx2, dy2), k in (((x0, y0), (0, 1), (1, 0), c[0]), ((x1, y0), (-1, 0), (0, 1), c[1]),
                                              ((x1, y1), (0, -1), (-1, 0), c[2]), ((x0, y1), (1, 0), (0, -1), c[3])):
        if k > 1e-4:
            pts += [(x + dx1 * k, y + dy1 * k), (x + dx2 * k, y + dy2 * k)]
        else:
            pts.append((x, y))
    return pts


def mirror_x(pts, s):
    """Mirror an (x, ...) outline for side s, keeping it CCW."""
    if s > 0:
        return list(pts)
    return [(-x, y) for x, y in reversed(pts)]


def P(name="s"):
    return H.Solid(name)


# =============================================================================================================== MASSES
# Each returns a Solid in its part's local frame (legs) or world (torso, pelvis, pods). d grows (+) or shrinks (-) it.
CACHE = {}


def cached(fn):
    def w(*a, **kw):
        key = (fn.__name__, a, tuple(sorted(kw.items())))
        if key not in CACHE:
            CACHE[key] = fn(*a, **kw)
        return CACHE[key].copy(fn.__name__)
    return w


# ---- thigh (leg-local: origin at the hip, z down the bone, x outward for s = +1)
THIGH_F = [(-0.35, -1.38), (0.35, -1.38), (0.39, -1.0), (0.39, -0.05), (0.36, 0.08), (0.27, 0.16), (0.13, 0.20), (-0.13, 0.20),
           (-0.27, 0.16), (-0.36, 0.08), (-0.39, -0.05), (-0.39, -1.0)]
THIGH_S = [(-0.33, -1.38), (0.02, -1.38), (0.17, -1.24), (0.27, -0.75), (0.28, -0.05), (0.22, 0.10), (0.10, 0.18),
           (-0.12, 0.20), (-0.27, 0.14), (-0.36, 0.0), (-0.36, -0.9)]
THIGH_T = [(-0.39, -0.28), (-0.33, -0.36), (0.33, -0.36), (0.39, -0.28), (0.39, 0.23), (0.34, 0.28), (-0.34, 0.28), (-0.39, 0.23)]


@cached
def thigh_mass(s, d=0.0, channel=True, col=GREY, flag=0):
    m = H.intersect([H.prism(THIGH_F, "y", -0.6, 0.6, "primary", col, "tf", d, flag),
                     H.prism(THIGH_S, "x", -0.6, 0.6, "primary", col, "ts", d, flag),
                     H.prism(THIGH_T, "z", -1.6, 0.4, "primary", col, "tt", d, flag)], "thigh_mass")
    if channel:  # subtract: a channel down the inner side, where the mechanism shows
        x = -s * (0.39 + d)
        H.carve(m, [H.cut_rect(V3((x, -0.02, -0.66)), V3((0, 1, 0)), V3((0, 0, 1)), V3((-s, 0, 0)), 0.30 - 2 * d, 0.78 - 2 * d,
                               depth=0.10, corner=0.06, slope=0.3, mat="primary", col=col)], bevel=0.0)
        for f in m.bm.faces:
            f[m.flag] = flag
    return m


# ---- shin (leg-local: origin at the knee)
SHIN_F = [(-0.18, -1.22), (0.18, -1.22), (0.24, -0.30), (0.24, -0.06), (-0.24, -0.06), (-0.24, -0.30)]
SHIN_S = [(-0.17, -1.22), (0.15, -1.22), (0.25, -0.45), (0.22, -0.06), (-0.25, -0.06), (-0.24, -0.40)]
KNEE_S = [(-0.12, -0.24), (0.14, -0.24), (0.24, -0.12), (0.24, 0.08), (0.12, 0.2), (-0.14, 0.2), (-0.26, 0.08), (-0.26, -0.12)]


@cached
def shin_mass(s, d=0.0, col=GREY, flag=0):
    body = H.intersect([H.prism(SHIN_F, "y", -0.6, 0.6, "primary", col, "sf", d, flag),
                        H.prism(SHIN_S, "x", -0.6, 0.6, "primary", col, "ss", d, flag)], "shin_body")
    # subtract: a scoop out of the calf's lower back (the ankle ram lives there)
    H.carve(body, [H.cut_slab(V3((0, 0.17 + d, -0.95)), V3((0, 0.6, -0.8)), V3((1, 0, 0)), 0.8, 0.8, 0.12,
                              "primary", col)], bevel=0.0)
    for f in body.bm.faces:
        f[body.flag] = flag
    return body


def knee_mass(d=0.0, col=GREY):
    return H.prism(KNEE_S, "x", -0.25, 0.25, "dark", col, "knee", d)


# ---- foot (world, flat on the ground; built at the ankle's x, y)
def foot_mass(s, col=GREY, d=0.0, mat="dark"):
    a = ankle(s)
    parts = []
    toe = [(-0.80, 0.0), (-0.05, 0.0), (0.02, 0.24), (-0.26, 0.30), (-0.70, 0.11)]
    for k, (dx, yaw) in enumerate(((-0.21, 28), (0.0, 0), (0.21, -28))):
        w = 0.15 if k != 1 else 0.18
        t = H.prism(toe, "x", -w / 2, w / 2, mat, col, "toe", d)
        H.xform(t, Matrix.Translation(V3((a.x + dx * s, a.y - 0.02, 0))) @ Matrix.Rotation(math.radians(yaw * s), 4, "Z"))
        parts.append(t)
    heel = H.prism([(0.02, 0.0), (0.46, 0.0), (0.36, 0.13), (0.08, 0.26)], "x", -0.08, 0.08, mat, col, "heel", d)
    H.xform(heel, Matrix.Translation(V3((a.x, a.y, 0))))
    body = H.prism(rect(-0.23, 0.23, 0.07, 0.40, (0.07, 0.07, 0.12, 0.12)), "y", -0.26, 0.18, mat, col, "foot_body", d)
    H.xform(body, Matrix.Translation(V3((a.x, a.y, 0))))
    drum = H.prism([(math.cos(2 * math.pi * k / 10) * (0.15 + d), math.sin(2 * math.pi * k / 10) * (0.15 + d)) for k in range(10)],
                   "x", -0.17, 0.17, mat, col, "ankle_drum")
    H.xform(drum, Matrix.Translation(a))
    return H.fuse([body] + parts + [heel, drum], "foot", fillet=0.015, segments=1)


# ---- torso (world)
COCK_F = [(-0.42, 3.47), (0.42, 3.47), (0.62, 3.72), (0.67, 3.95), (0.67, 4.35), (0.55, 4.62), (0.38, 4.80), (-0.38, 4.80),
          (-0.55, 4.62), (-0.67, 4.35), (-0.67, 3.95), (-0.62, 3.72)]
COCK_S = [(-0.62, 3.47), (0.45, 3.47), (0.55, 3.70), (0.55, 4.62), (0.40, 4.80), (-0.62, 4.80), (-0.95, 4.42), (-0.95, 3.86)]
COCK_T = [(-0.32, -0.95), (0.32, -0.95), (0.67, -0.50), (0.67, 0.55), (-0.67, 0.55), (-0.67, -0.50)]


@cached
def cockpit_mass(d=0.0, col=GREY, flag=0):
    return H.intersect([H.prism(COCK_F, "y", -1.3, 0.9, "primary", col, "cf", d, flag),
                        H.prism(COCK_S, "x", -0.9, 0.9, "primary", col, "cs", d, flag),
                        H.prism(COCK_T, "z", 3.2, 5.0, "primary", col, "ct", d, flag)], "cockpit")


def yoke_mass(d=0.0, col=GREY, mat="dark"):
    yoke = H.prism(rect(-1.24, 1.24, 3.78, 4.26, 0.09), "y", -0.12, 0.62, mat, col, "yoke", d)
    core = H.prism(rect(-0.56, 0.56, 3.52, 4.58, (0.12, 0.12, 0.2, 0.2)), "y", 0.15, 1.02, mat, col, "core", d)
    side = H.prism([(0.15, 3.52), (1.02, 3.52), (1.02, 4.30), (0.62, 4.58), (0.15, 4.58)], "x", -0.56, 0.56, mat, col, "core_s", d)
    core = H.intersect([core, side], "core")
    return H.fuse([yoke, core], "yoke", fillet=0.03, segments=1)


def hood_mass(s, d=0.0, col=GREY, mat="dark"):
    hd = H.prism([(0.30, 4.48), (1.10, 4.48), (1.10, 4.74), (0.40, 5.16), (0.18, 5.16), (0.14, 4.98)], "x",
                 s * 0.44 - 0.18, s * 0.44 + 0.18, mat, col, "hood", d)
    top = H.prism(rect(s * 0.44 - 0.18, s * 0.44 + 0.18, 0.1, 1.10, (0.0, 0.0, 0.08, 0.08)), "z", 4.4, 5.3, mat, col, "hood_t", d)
    return H.intersect([hd, top], "hood")


# ---- pelvis (world)
def pelvis_mass(d=0.0, col=GREY, mat="dark"):
    blk = H.prism(rect(-0.44, 0.44, 2.94, 3.36, 0.08), "y", -0.46, 0.36, mat, col, "pelvis", d)
    chev = H.prism([(-0.44, -0.16), (0.0, -0.46), (0.44, -0.16), (0.44, 0.36), (-0.44, 0.36)], "z", 2.8, 3.5, mat, col, "chev", d)
    return H.intersect([blk, chev], "pelvis")


def hexagon(r, cz, cx=0.0):
    return [(cx + math.cos(math.pi / 6 + k * math.pi / 3) * r, cz + math.sin(math.pi / 6 + k * math.pi / 3) * r) for k in range(6)]


def hex_link(col=GREY, mat="dark"):
    """The dark hexagonal link hanging under the pelvis between the legs (subtract: a hex ring)."""
    ring = H.prism(hexagon(0.36, 2.66), "y", -0.07, 0.11, mat, col, "hex")
    H.carve(ring, [H.prism(hexagon(0.24, 2.66), "y", -0.3, 0.3, mat, V.shade(col, 0.8), "hex_in")], bevel=0.012)
    return ring


def skirt_mass(d=0.0, col=GREY, mat="primary"):
    return H.intersect([H.prism(rect(-0.27, 0.27, 2.70, 3.24, (0.09, 0.09, 0.0, 0.0)), "y", -0.56, -0.36, mat, col, "skirt", d),
                        H.prism([(-0.56, 2.76), (-0.38, 2.70), (-0.36, 3.24), (-0.52, 3.24)], "x", -0.4, 0.4, mat, col, "skirt_s", d)],
                       "skirt")


# ---- pods (world)
@cached
def pod_mass(s, d=0.0, col=GREY, flag=0):
    cx = s * POD_X
    f = H.prism(mirror_x([(x + cx, z) for x, z in rect(-0.31, 0.31, POD_Z - 0.46, POD_Z + 0.46, 0.13)], 1), "y", -0.8, 0.8,
                "primary", col, "pf", d, flag)
    sd = H.prism(rect(POD_Y - 0.55, POD_Y + 0.52, POD_Z - 0.46, POD_Z + 0.46, (0.10, 0.2, 0.08, 0.22)), "x", cx - 0.5, cx + 0.5,
                 "primary", col, "ps", d, flag)
    return H.intersect([f, sd], "pod")


def guns(s, col=GREY, mat="dark"):
    """Rough but believable: the mech's right (-X) carries twin rotary autocannons with ammo drums, its left (+X) twin long
    cannons. Barrels point forward (the game fires along the aim), not sideways as the reference poses them."""
    S = P("guns")
    cx = s * POD_X + s * 0.08
    y0 = POD_Y - 0.55
    if s < 0:
        for z in (POD_Z + 0.2, POD_Z - 0.1):
            V.cyl(S, (cx, y0 - 0.26, z), 0.135, 0.52, axis="y", n=10, mat=mat, col=col)          # shroud
            V.cyl(S, (cx, y0 - 0.58, z), 0.10, 0.14, axis="y", n=10, mat=mat, col=col)           # clamp
            for k in range(3):
                a = 2 * math.pi * k / 3 + 0.4
                V.cyl(S, (cx + math.cos(a) * 0.055, y0 - 1.0, z + math.sin(a) * 0.055), 0.03, 0.9, axis="y", n=6, mat=mat, col=col)
            V.cyl(S, (cx, y0 - 1.42, z), 0.095, 0.07, axis="y", n=10, mat=mat, col=col)          # muzzle ring
        V.cyl(S, (cx - s * -0.0, POD_Y + 0.1, POD_Z - 0.62), 0.16, 0.5, axis="x", n=12, mat=mat, col=col)  # ammo drum under
    else:
        for z in (POD_Z + 0.2, POD_Z - 0.08):
            V.cyl(S, (cx, y0 - 0.25, z), 0.11, 0.5, axis="y", n=10, mat=mat, col=col)            # recoil sleeve
            V.cyl(S, (cx, y0 - 1.25, z), 0.06, 1.6, axis="y", n=8, mat=mat, col=col)             # barrel
            V.cyl(S, (cx, y0 - 2.0, z), 0.08, 0.16, axis="y", n=8, mat=mat, col=col)             # muzzle
    return S


# ============================================================================================================ the mass layer
def mass_layer():
    """Every mass in world space as {part: [Solid]} (the step-2 gate renders these flat grey)."""
    out = {}
    out["Torso"] = [H.fuse([cockpit_mass(), yoke_mass()], "torso_mass", fillet=0.03, segments=1), hood_mass(1), hood_mass(-1)]
    out["Pelvis"] = [pelvis_mass(), skirt_mass(col=GREY), hex_link()]
    for s, sfx in ((1, "_L"), (-1, "_R")):
        Mt = Matrix.Translation(hip(s)) @ leg_rot(s)
        Ms = Matrix.Translation(knee(s)) @ leg_rot(s)
        out["Thigh" + sfx] = [H.xform(thigh_mass(s), Mt)]
        out["Shin" + sfx] = [H.xform(H.fuse([shin_mass(s), knee_mass()], "shin_mass", fillet=0.02, segments=1), Ms)]
        out["Foot" + sfx] = [foot_mass(s)]
        out["Pod" + sfx] = [pod_mass(s), guns(s)]
    return out


# ======================================================================================================= layers 1-10
X_, Y_, Z_ = V3((1, 0, 0)), V3((0, 1, 0)), V3((0, 0, 1))


def span(a, b):
    return (a, b) if a <= b else (b, a)


class Layers:
    """Working Solids per layer for one part, built in the part's local frame (legs) or world; flush() moves them by M
    (leg-local -> world) and commits them into the part's `<Part>__<Layer>` pieces."""

    def __init__(self):
        self.s = {}

    def __getitem__(self, k):
        if k not in self.s:
            self.s[k] = H.Solid(k)
        return self.s[k]

    def add(self, k, S):
        if S is not None and len(S.bm.faces):
            H.commit(S, self[k])

    def flush(self, part, M=None):
        for k, S in self.s.items():
            if not len(S.bm.faces):
                continue
            if M is not None:
                bmesh.ops.transform(S.bm, matrix=M, verts=S.bm.verts[:])
            H.commit(S, part[k])


def shell(mass_fn, d0, d1, col=KHAKI, mat="primary", name="shell"):
    """The plate shell between two offsets of a mass: mass(d1) - mass(d0). The inner skin is flagged F_INNER, so panel()
    knows which edges are the outer rims."""
    outer = mass_fn(d=d1, col=col)
    inner = mass_fn(d=d0, col=V.shade(col, 0.55), flag=F_INNER)
    for S in (outer, inner):
        for f in S.bm.faces:
            f[S.sec] = V.sec_index(mat)
    H.carve(outer, [inner], bevel=0.0, name=name)
    return outer


def region(outline, axis, a0, a1, col=KHAKI, mat="primary"):
    a0, a1 = span(a0, a1)
    return H.prism(outline, axis, a0, a1, mat, V.shade(col, 0.85), "region", 0.0, F_REGION)


def panel(sh, reg, ch=0.03, name="panel", cuts=(), cut_bevel=0.008):
    """One plate panel: the shell ∩ a region prism. The region's walls are the panel's edge band (its visible thickness);
    the rim where a wall meets the outer skin gets a flat chamfer `ch` (the bright line). `cuts` are carved afterwards
    (seams, vents, slots)."""
    S = H.intersect([sh.copy(name), reg], name)
    if not len(S.bm.faces):
        return S
    m = F_REGION | F_INNER
    rim = [e for e in S.bm.edges if len(e.link_faces) == 2 and
           sorted(f[S.flag] & m for f in e.link_faces) == [0, F_REGION]]
    rimf = set(H._bevel(S, rim, ch, 1, tag=H.TAG_RIM))
    tint(S, [f for f in S.bm.faces if f[S.flag] & F_REGION and f not in rimf], WALL_K)   # the edge band: a shade darker
    tint(S, rimf, RIM_K)                                                                  # the chamfer: the bright line
    for f in S.bm.faces:
        f[S.flag] &= ~m
    if cuts:
        H.carve(S, list(cuts), bevel=cut_bevel, name=name)
    return S


WALL_K, RIM_K = 0.66, 1.2   # panel edge band and rim chamfer value against the paint


def tint(S, faces, k):
    for f in faces:
        for lp in f.loops:
            c = lp[S.col]
            lp[S.col] = (min(1.0, c[0] * k), min(1.0, c[1] * k), min(1.0, c[2] * k), 1.0)


def groove(c, along, across, n, length, w=0.022, depth=0.024):
    """A panel seam carved into a plate: a thin slot with a dark floor."""
    return H.cut_rect(c, along, across, n, length, w, depth=depth, corner=0.0, slope=0.4, mat="dark", col=V.shade(DARK, 0.8))


def roundel(S, c, r=0.1):
    """The star roundel, painted on a face looking -Y."""
    c = V3(c)
    V.cyl(S, c + V3((0, -0.002, 0)), r, 0.006, axis="y", n=16, mat="secondary", col=MARK)
    V.cyl(S, c + V3((0, -0.004, 0)), r * 0.84, 0.006, axis="y", n=16, mat="primary", col=V.shade(KHAKI, 0.62))
    pts = []
    for k in range(10):
        a = math.pi / 2 + k * math.pi / 5
        rr = r * (0.8 if k % 2 == 0 else 0.33)
        pts.append((math.cos(a) * rr, math.sin(a) * rr))
    V.prim(S, [[c + V3((x, -0.006 - t, z)) for x, z in pts] for t in (0.0, 0.004)], "secondary", MARK, 0, None, jitter=0.0)


def spokes(S, hoop, inward, n=4, r=0.012):
    cen = sum(hoop, V3()) / len(hoop)
    for k in range(0, len(hoop), max(1, len(hoop) // n)):
        p = hoop[k]
        H.strut(S, p, p + (cen - p).normalized() * inward, r * 1.6, r * 1.1, "sand", PAL["mounting"], up=(p - cen))


def disc(r, cu, cv, n=12):
    return [(cu + math.cos(2 * math.pi * k / n) * r, cv + math.sin(2 * math.pi * k / n) * r) for k in range(n)]


def darken(S, mat="dark"):
    for f in S.bm.faces:
        f[S.sec] = V.sec_index(mat)
    return S


def pockets(S, cuts):
    H.carve(S, cuts, bevel=0.01)
    return S


def pocket(c, u, v, n, w, h, depth=0.06):
    return H.cut_rect(c, u, v, n, w, h, depth=depth, corner=0.04, slope=0.3, mat="dark", col=V.shade(PAL["frame"], 0.68))


# ------------------------------------------------------------------------------------------------------------- thigh
def thigh(s):
    part = H.Part("Thigh" + ("_L" if s > 0 else "_R"), hip(s), 10 + s)
    L = Layers()
    mf = lambda d=0.0, col=KHAKI, flag=0: thigh_mass(s, d, True, col, flag)  # noqa: E731
    X, Y, Z = X_, Y_, Z_
    # frame: the mass shrunk by plate + rib depth (a box beam), pockets, the hip drum, the knee clevis cheeks
    fr = darken(thigh_mass(s, -0.17, False, PAL["frame"]))
    hipd = H.prism(disc(0.17, 0, 0), "x", *span(-s * 0.05 - 0.2, -s * 0.05 + 0.2), "dark", V.shade(PAL["frame"], 1.15), "hipdrum")
    cheeks = [H.prism(rect(-0.14, 0.14, -1.60, -1.12, (0.07, 0.07, 0.0, 0.0)), "x", *span(k * 0.2, k * 0.31), "dark",
                      PAL["frame"], "cheek") for k in (-1, 1)]
    fr = H.fuse([fr, hipd] + cheeks, "thigh_frame", fillet=0.02, segments=1)
    xi = -s * (0.39 - 0.17)
    pockets(fr, [pocket(V3((xi, 0.0, z)), Y, Z, -s * X, 0.18, 0.34) for z in (-0.38, -0.86)] +
            [pocket(V3((0.0, 0.11, z)), X, Z, Y, 0.22, 0.3, 0.05) for z in (-0.3, -0.7)])
    L.add("frame", fr)
    # mounting: rib hoops cut from the mass just under the plates, stringers, spokes to the frame
    rib_src = thigh_mass(s, -0.085, False, PAL["mounting"])
    hoops = [h for h in (H.section_loop(rib_src, V3((0, 0, z)), Z, 12) for z in (-0.22, -0.62, -1.02)) if h]
    H.rib_web(L["mounting"], hoops, "sand", PAL["mounting"], r=0.014, diag=True, every=2)
    for h in hoops:
        spokes(L["mounting"], h, 0.07)
    # plates: three shells (main, raised cap, inset knee), five panels, two seams
    sh = shell(mf, -0.06, 0.0)
    cap_sh = shell(mf, -0.025, 0.035)
    low_sh = shell(mf, -0.09, -0.03)
    seam_x = -s * 0.12
    L.add("plates", panel(sh, region(rect(-0.45, 0.45, -1.06, -0.06), "y", -1.0, -0.20), 0.03, "thigh_front",
                          cuts=[groove(V3((seam_x, -0.362, -0.56)), Z, X, -Y, 0.98)]))
    L.add("plates", panel(cap_sh, region(rect(-0.5, 0.5, -0.16, 0.45), "y", -1.0, 0.4), 0.035, "thigh_cap"))
    L.add("plates", panel(low_sh, region(rect(-0.45, 0.45, -1.48, -1.0), "y", -1.0, -0.15), 0.02, "thigh_knee"))
    L.add("plates", panel(sh, region(rect(-0.165, 0.31, -1.30, -0.06), "x", s * 0.22, s * 1.0), 0.025, "thigh_side",
                          cuts=[groove(V3((s * 0.392, 0.06, -0.82)), Y, Z, s * X, 0.5)]))
    L.add("plates", panel(sh, region(rect(-0.18, 0.2, -1.36, -1.12), "x", -s * 0.22, -s * 1.0), 0.02, "thigh_inner_low"))
    V.bolt_row(L["plates"], V3((s * 0.395, -0.13, -0.2)), V3((s * 0.395, -0.13, -1.2)), 7, s * X, r=0.016, col=BARE)
    # actuation: the knee ram down the open back, two hoses through the inner channel
    H.ram(L["actuation"], V3((s * 0.05, 0.2, -0.16)), V3((s * 0.05, 0.22, -1.5)), 0.05, sleeve_col=PAL["actuation"], rod_col=BARE)
    for k, y in enumerate((-0.07, 0.05)):
        V.pipe_run(L["actuation"], [V3((-s * 0.2, y, 0.06)), V3((-s * 0.33, y, -0.3)), V3((-s * 0.33, y, -1.0)),
                                    V3((-s * 0.18, y, -1.42))], 0.024 - 0.005 * k, "trim", V.shade(PAL["actuation"], 1 - 0.12 * k),
                   bend=0.1, clamps=2 if k == 0 else 0)
    # power: muscle bundles where a hamstring would be
    for x in (-0.22, -0.11, 0.17):
        pts = [V3((s * x, 0.12, -0.08)), V3((s * x, 0.19, -0.45)), V3((s * x, 0.19, -0.9)), V3((s * x, 0.12, -1.25))]
        V.tube_along(L["power"], V.round_path(pts, 0.15), 0.045, "dark", PAL["power"], n=6)
    # seals: a knee boot behind the joint, a hip boot towards the pelvis
    H.bellows(L["seals"], V3((0, 0.06, -1.26)), V3((0, 0.08, -1.62)), 0.15, 0.14, folds=2, depth=0.025, n=10, col=PAL["seals"])
    H.bellows(L["seals"], V3((-s * 0.27, 0.0, 0.0)), V3((-s * 0.40, 0.0, 0.0)), 0.23, 0.23, folds=1, depth=0.02, n=10,
              col=PAL["seals"])
    # service: the big stencil, the roundel or the hull number, handholds on the outer slab
    sx = s * 0.12
    K.stencil(L["service"], "03", V3((sx, -0.364, -0.70)), X, Z, -Y, 0.22, "secondary", MARK)
    if s > 0:
        roundel(L["service"], V3((sx, -0.362, -0.42)), 0.1)
    else:
        V.bolt_row(L["service"], V3((sx - 0.12, -0.366, -0.42)), V3((sx + 0.12, -0.366, -0.42)), 4, -Y, r=0.018, col=BARE)
    H.rungs(L["service"], V3((s * 0.39, 0.1, -1.05)), V3((s * 0.39, 0.1, -0.3)), 3, s * X, width=0.15, depth=0.06, r=0.014)
    L.flush(part, Matrix.Translation(hip(s)) @ leg_rot(s))
    return part


# -------------------------------------------------------------------------------------------------------------- shin
def shin(s):
    part = H.Part("Shin" + ("_L" if s > 0 else "_R"), knee(s), 20 + s)
    L = Layers()
    mf = lambda d=0.0, col=KHAKI2, flag=0: shin_mass(s, d, col, flag)  # noqa: E731
    X, Y, Z = X_, Y_, Z_
    fr = darken(shin_mass(s, -0.10, PAL["frame"]))
    kn = H.prism(KNEE_S, "x", -0.17, 0.17, "dark", PAL["frame"], "knee")
    drum = H.prism(disc(0.2, 0, 0), "x", -0.19, 0.19, "dark", V.shade(PAL["frame"], 1.15), "kneedrum")
    cheeks = [H.prism(rect(-0.1, 0.1, -1.38, -1.08, (0.0, 0.0, 0.05, 0.05)), "x", *span(k * 0.18, k * 0.24), "dark",
                      PAL["frame"], "acheek") for k in (-1, 1)]
    fr = H.fuse([fr, kn, drum] + cheeks, "shin_frame", fillet=0.02, segments=1)
    pockets(fr, [pocket(V3((-s * 0.14, 0.0, z)), Y, Z, -s * X, 0.16, 0.26, 0.05) for z in (-0.45, -0.85)])
    L.add("frame", fr)
    rib_src = shin_mass(s, -0.065, PAL["mounting"])
    hoops = [h for h in (H.section_loop(rib_src, V3((0, 0, z)), Z, 10) for z in (-0.3, -0.62, -0.94)) if h]
    H.rib_web(L["mounting"], hoops, "sand", PAL["mounting"], r=0.012, diag=False, every=2)
    sh = shell(mf, -0.05, 0.0, KHAKI2)
    low = shell(mf, -0.08, -0.03, KHAKI2)
    L.add("plates", panel(sh, region(rect(-0.32, 0.32, -0.70, -0.08), "y", -1.0, -0.06, KHAKI2), 0.025, "shin_guard",
                          cuts=[groove(V3((0, -0.252, -0.40)), X, Z, -Y, 0.3)]))
    L.add("plates", panel(low, region(rect(-0.32, 0.32, -1.12, -0.73), "y", -1.0, -0.06, KHAKI2), 0.02, "shin_low"))
    L.add("plates", panel(sh, region(rect(-0.02, 0.22, -0.58, -0.14), "x", s * 0.14, s * 1.0, KHAKI2), 0.02, "shin_outer"))
    H.ram(L["actuation"], V3((0, 0.2, -0.18)), V3((0, 0.1, -1.22)), 0.04, sleeve_col=PAL["actuation"], rod_col=BARE)
    H.ram(L["actuation"], V3((-s * 0.2, 0.06, -0.2)), V3((-s * 0.16, 0.0, -1.18)), 0.03, sleeve_col=PAL["actuation"], rod_col=BARE)
    for x in (-0.09, 0.09):
        pts = [V3((x, 0.12, -0.12)), V3((x, 0.21, -0.4)), V3((x, 0.15, -0.85))]
        V.tube_along(L["power"], V.round_path(pts, 0.12), 0.04, "dark", PAL["power"], n=6)
    H.bellows(L["seals"], V3((0, 0.0, -1.12)), V3((0, 0.0, -1.26)), 0.12, 0.12, folds=2, depth=0.02, n=10, col=PAL["seals"])
    H.rungs(L["service"], V3((s * 0.26, 0.08, -0.6)), V3((s * 0.26, 0.08, -0.25)), 2, s * X, width=0.13, depth=0.05, r=0.012)
    L.flush(part, Matrix.Translation(knee(s)) @ leg_rot(s))
    return part


# -------------------------------------------------------------------------------------------------------------- foot
def _flag(S, flag):
    for f in S.bm.faces:
        f[S.flag] = flag
    return S


def foot(s):
    a = ankle(s)
    part = H.Part("Foot" + ("_L" if s > 0 else "_R"), a, 30 + s)
    L = Layers()
    L.add("frame", foot_mass(s, PAL["frame"]))
    cap_sh = shell(lambda d=0.0, col=KHAKI, flag=0: _flag(foot_mass(s, col, d, "primary"), flag), 0.0, 0.035)
    L.add("plates", panel(cap_sh, region(rect(a.x - 0.12, a.x + 0.12, a.y - 1.0, a.y - 0.22, 0.03), "z", 0.13, 0.6), 0.015,
                          "toe_cap"))
    L.flush(part)
    return part


# ------------------------------------------------------------------------------------------------------------ pelvis
def pelvis():
    part = H.Part("Pelvis", V3((0, HIP_Y, HIP_Z)), 40)
    L = Layers()
    X, Y, Z = X_, Y_, Z_
    core = pelvis_mass(0.0, PAL["frame"])
    drums = [H.prism(disc(0.21, HIP_Y, HIP_Z), "x", *span(k * 0.36, k * 0.5), "dark", V.shade(PAL["frame"], 1.15), "hip")
             for k in (-1, 1)]
    core = H.fuse([core] + drums, "pelvis_frame", fillet=0.02, segments=1)
    pockets(core, [pocket(V3((0, 0.36, 3.15)), X, Z, Y, 0.5, 0.24)])
    L.add("frame", core)
    L.add("frame", hex_link(PAL["frame"]))
    for k in (-1, 1):  # hangers from the pelvis to the hex link
        V.bar(L["frame"], V3((k * 0.2, 0.02, 2.99)), V3((k * 0.24, 0.02, 2.84)), 0.04, "dark", PAL["frame"], 6)
    sh = shell(lambda d=0.0, col=KHAKI, flag=0: _flag(pelvis_mass(d, col, "primary"), flag), -0.05, 0.03)
    L.add("plates", panel(sh, region(rect(-0.6, 0.6, 3.20, 3.6), "y", -1.0, 0.12), 0.025, "chevron"))
    sk = skirt_mass(0.0, KHAKI, "primary")
    H.carve(sk, [groove(V3((0, -0.54, 3.02)), X, Z, V3((0, -0.997, -0.083)), 0.6)], bevel=0.006)
    L.add("plates", sk)
    for k in (-1, 1):
        V.bar(L["mounting"], V3((k * 0.16, -0.38, 3.12)), V3((k * 0.16, -0.25, 3.14)), 0.03, "sand", PAL["mounting"], 6)
        H.ram(L["actuation"], V3((k * 0.36, 0.3, 3.3)), V3((k * 0.24, 0.42, 3.62)), 0.035, sleeve_col=PAL["actuation"], rod_col=BARE)
    L.flush(part)
    return part


# ------------------------------------------------------------------------------------------------------------- torso
def torso():
    part = H.Part("Torso", WAIST, 50)
    L = Layers()
    X, Y, Z = X_, Y_, Z_
    # frame: the yoke and back core (exposed, dark) with pockets, the waist drum, pod pivot stubs, the pilot tub
    yk = yoke_mass(0.0, PAL["frame"])
    waist = H.prism(disc(0.3, 0, 0.1), "z", 3.30, 3.62, "dark", V.shade(PAL["frame"], 1.15), "waist")
    stubs = [H.prism(disc(0.19, POD_Y + 0.05, POD_Z), "x", *span(k * 1.16, k * 1.38), "dark", V.shade(PAL["frame"], 1.15), "stub")
             for k in (-1, 1)]
    yk = H.fuse([yk, waist] + stubs, "torso_frame", fillet=0.025, segments=1)
    pockets(yk, [pocket(V3((k * 0.92, -0.12, 4.02)), X, Z, -Y, 0.42, 0.24, 0.07) for k in (-1, 1)] +
            [pocket(V3((k * 0.92, 0.25, 4.26)), X, Y, Z, 0.42, 0.36) for k in (-1, 1)] +
            [H.cut_rect(V3((0, 1.02, 4.05)), X, Z, Y, 0.62, 0.6, depth=0.26, corner=0.08, slope=0.2, mat="dark",
                        col=V.shade(PAL["frame"], 0.6))])   # the rear window onto the power core
    L.add("frame", yk)
    L.add("frame", darken(cockpit_mass(-0.16, PAL["frame"])))   # the pilot tub
    # power: the core drum behind the cockpit (seen through the rear window), cells, conduits to the pods along the yoke
    V.cyl(L["power"], (0, 0.70, 4.05), 0.25, 0.7, axis="z", n=12, mat="dark", col=PAL["power"])
    for k in (-1, 1):
        V.blk(L["power"], (k * 0.33, 0.86, 3.98), (0.14, 0.2, 0.46), "dark", V.shade(PAL["power"], 1.2), ch=0.02, mid=True)
        V.tube_along(L["power"], V.round_path([V3((k * 0.3, 0.45, 4.3)), V3((k * 0.7, 0.35, 4.32)), V3((k * 1.1, 0.3, 4.3)),
                                               V3((k * 1.3, 0.22, 4.2))], 0.15), 0.05, "dark", PAL["power"], n=6)
    # actuation: hoses looping to the pods under the yoke, a twist ram at the waist
    for k in (-1, 1):
        for j, y in enumerate((0.0, 0.18)):
            V.pipe_run(L["actuation"], [V3((k * 0.5, y, 3.76)), V3((k * 0.8, y - 0.05, 3.6)), V3((k * 1.1, y - 0.05, 3.64)),
                                        V3((k * 1.3, y, 3.84))], 0.03 - 0.006 * j, "trim", V.shade(PAL["actuation"], 1 - 0.1 * j),
                       bend=0.15, clamps=1)
        H.ram(L["actuation"], V3((k * 0.32, -0.05, 3.42)), V3((k * 0.42, 0.25, 3.72)), 0.03, sleeve_col=PAL["actuation"],
              rod_col=BARE)
    # mounting: rib hoops round the cockpit just under its plates (seen under the chin and through the seams)
    rib_src = cockpit_mass(-0.085, PAL["mounting"])
    hoops = [h for h in (H.section_loop(rib_src, V3((0, y, 0)), Y, 14) for y in (-0.62, -0.2, 0.22)) if h]
    H.rib_web(L["mounting"], hoops, "sand", PAL["mounting"], r=0.016, diag=True, every=2)
    # plates: panels cut from three shells by region prisms; the facets come from the mass
    sh = shell(cockpit_mass, -0.06, 0.0)
    up = shell(cockpit_mass, -0.025, 0.035)
    inset = shell(cockpit_mass, -0.09, -0.03)
    L.add("plates", panel(up, region(rect(-0.30, 0.30, 4.165, 4.40, (0.0, 0.0, 0.04, 0.04)), "y", -1.6, -0.7), 0.03, "face_up",
                          cuts=[H.cut_rect(V3((-0.17, -0.985, 4.28)), X, Z, -Y, 0.17, 0.17, depth=0.1, corner=0.02, slope=0.3,
                                           mat="dark", col=(0.07, 0.07, 0.075))]))
    L.add("plates", panel(up, region(rect(-0.30, 0.30, 3.88, 4.13, (0.04, 0.04, 0.0, 0.0)), "y", -1.6, -0.7), 0.03, "face_low"))
    L.add("plates", panel(sh, region(rect(-0.30, 0.30, -1.3, -0.27), "z", 4.435, 5.3), 0.03, "brow"))
    L.add("plates", panel(sh, region(rect(-0.46, 0.46, -0.23, 0.6, 0.06), "z", 4.6, 5.3), 0.03, "deck"))
    for x0, x1 in ((-0.30, -0.018), (0.018, 0.30)):
        L.add("plates", panel(inset, region(rect(x0, x1, 3.2, 3.86), "y", -1.6, -0.32), 0.02, "chin"))
    for k in (-1, 1):
        ox = [(k * 0.335, -1.3), (k * 0.95, -1.3), (k * 0.95, -0.285), (k * 0.335, -0.285)]
        ox = ox if k > 0 else list(reversed(ox))
        n = V3((0.79 * k, -0.61, 0.0))
        u = V3((0.61 * k, 0.79, 0.0))
        L.add("plates", panel(sh, region(ox, "z", 4.0, 4.75), 0.03, "cheek_up",
                              cuts=[groove(V3((k * 0.52, -0.693, 4.36)), u, Z, n, 0.5)]))
        L.add("plates", panel(sh, region(ox, "z", 3.3, 3.96), 0.025, "cheek_low",
                              cuts=H.cut_vents(V3((k * 0.48, -0.744, 3.84)), u, Z, n, 0.24, 0.2, 3, gap=0.4, depth=0.045,
                                               mat="dark", col=V.shade(PAL["heat"], 0.8))))
        L.add("plates", panel(sh, region([(-0.25, 3.62), (0.5, 3.62), (0.5, 4.6), (-0.25, 4.6)], "x", k * 0.6, k * 1.0), 0.03,
                              "cockpit_side", cuts=[groove(V3((k * 0.672, 0.12, 4.1)), Z, Y, k * X, 0.8)]))
    # heat: the two hoods behind the cockpit (the one strong feature): a deep mouth, louvres, a glowing floor
    for k in (-1, 1):
        hd = hood_mass(k, 0.0, PAL["heat"], "dark")
        v = V3((0, -0.16, 0.5)).normalized()
        n = V3((0, -0.95, -0.30)).normalized()
        c = V3((k * 0.44, 0.172, 4.88))
        H.carve(hd, [H.cut_rect(c, X, v, n, 0.28, 0.22, depth=0.28, corner=0.03, slope=0.15, mat="dark", col=(0.07, 0.065, 0.06))],
                bevel=0.015)
        L.add("heat", hd)
        V.louvres(L["heat"], c - n * 0.1, X, v, n, 0.26, 0.2, 3, "dark", V.shade(PAL["heat"], 0.8), tilt=0.5, t=0.02)
        f = V.surf_blk(L["heat"], c - n * 0.27, X, v, n, 0.24, 0.18, 0.01, "glow", (1.0, 0.45, 0.15))
        H.glow_flag(f, L["heat"])
    # seals: the waist boot
    H.bellows(L["seals"], V3((0, 0.1, 3.34)), V3((0, 0.1, 3.5)), 0.35, 0.34, folds=2, depth=0.025, n=14, col=PAL["seals"])
    # service: lifting eyes, boarding rungs up the left side, the hull number and roundel on the face
    for k in (-1, 1):
        H.lifting_eye(L["service"], V3((k * 0.3, 0.2, 4.80)), Z, r=0.07, t=0.02)
    H.rungs(L["service"], V3((0.69, 0.25, 3.68)), V3((0.69, 0.25, 4.45)), 3, X, width=0.18, depth=0.07, r=0.016)
    roundel(L["service"], V3((0.15, -0.99, 4.28)), 0.075)
    K.stencil(L["service"], "03", V3((0.15, -0.992, 4.06)), X, Z, -Y, 0.13, "secondary", MARK)
    # sensors: the camera block left of the vision slot, a dark glass strip in the slot, an antenna
    V.blk(L["sensors"], (-0.17, -0.93, 4.28), (0.1, 0.1, 0.1), "dark", DARK, ch=0.012, mid=True)   # camera in the recess
    f = V.cyl(L["sensors"], (-0.17, -0.985, 4.28), 0.032, 0.02, axis="y", n=8, mat="glow", col=GLOW)
    H.glow_flag(f, L["sensors"])
    V.bar(L["sensors"], V3((-0.32, 0.4, 4.78)), V3((-0.36, 0.5, 5.6)), 0.012, "trim", BARE, 5)
    L.flush(part)
    return part


# --------------------------------------------------------------------------------------------------------------- pods
def pod(s):
    part = H.Part("Pod" + ("_L" if s > 0 else "_R"), V3((s * 1.30, POD_Y + 0.05, POD_Z)), 60 + s)
    L = Layers()
    X, Y, Z = X_, Y_, Z_
    cx = s * POD_X
    mf = lambda d=0.0, col=KHAKI, flag=0: pod_mass(s, d, col, flag)  # noqa: E731
    core = darken(pod_mass(s, -0.1, PAL["frame"]))
    pockets(core, [pocket(V3((cx - s * 0.21, POD_Y, POD_Z - 0.05)), Y, Z, -s * X, 0.5, 0.4)])
    L.add("frame", core)
    rib_src = pod_mass(s, -0.075, PAL["mounting"])
    hoops = [h for h in (H.section_loop(rib_src, V3((0, y, 0)), Y, 10) for y in (POD_Y - 0.25, POD_Y + 0.1, POD_Y + 0.4)) if h]
    H.rib_web(L["mounting"], hoops, "sand", PAL["mounting"], r=0.014, diag=True, every=2)
    sh = shell(mf, -0.05, 0.0)
    up = shell(mf, -0.02, 0.035)
    ins = shell(mf, -0.08, -0.03)
    fy = POD_Y - 0.55
    L.add("plates", panel(ins, region(rect(cx - 0.45, cx + 0.45, POD_Z - 0.6, POD_Z + 0.6), "y", -3.0, fy + 0.1), 0.02, "pod_face"))
    L.add("plates", panel(up, region(rect(cx - 0.45, cx + 0.45, fy - 0.3, POD_Y + 0.62), "z", POD_Z + 0.26, POD_Z + 1.0), 0.03,
                          "pod_top"))
    L.add("plates", panel(sh, region(rect(fy + 0.12, POD_Y + 0.46, POD_Z - 0.42, POD_Z + 0.23), "x", cx + s * 0.12, cx + s * 1.0),
                          0.025, "pod_side", cuts=[groove(V3((cx + s * 0.312, POD_Y - 0.05, POD_Z - 0.1)), Z, Y, s * X, 0.58)]))
    # weapons (rough; their own layer so the plates stay the plates)
    L.add("weapon", guns(s, DARK, "dark"))
    # service: a hazard band, the hull number on the left pod
    fz = fy + 0.03 - 0.004
    K.hazard(L["service"], V3((cx - s * 0.19, fz, POD_Z + 0.02)), Z, X, -Y, 0.5, 0.1, 5, RED, MARK)
    if s > 0:
        K.stencil(L["service"], "03", V3((cx + 0.06, fz - 0.002, POD_Z - 0.3)), X, Z, -Y, 0.13, "secondary", MARK)
    # actuation: the elevation ram on the open inner side; a feed chute on the autocannon side; a lamp on the other
    H.ram(L["actuation"], V3((cx - s * 0.27, POD_Y + 0.35, POD_Z - 0.32)), V3((cx - s * 0.27, POD_Y - 0.25, POD_Z + 0.12)), 0.035,
          sleeve_col=PAL["actuation"], rod_col=BARE)
    if s < 0:
        V.pipe_run(L["actuation"], [V3((cx, POD_Y + 0.1, POD_Z - 0.62)), V3((cx + 0.08, POD_Y - 0.35, POD_Z - 0.6)),
                                    V3((cx + 0.08, POD_Y - 0.62, POD_Z - 0.3))], 0.05, "trim", PAL["actuation"], bend=0.12)
    else:
        V.cyl(L["sensors"], (cx - 0.05, POD_Y - 0.3, POD_Z - 0.53), 0.075, 0.3, axis="y", n=10, mat="dark", col=DARK)
        f = V.cyl(L["sensors"], (cx - 0.05, POD_Y - 0.46, POD_Z - 0.53), 0.06, 0.02, axis="y", n=10, mat="glow", col=GLOW)
        H.glow_flag(f, L["sensors"])
    H.bellows(L["seals"], V3((cx - s * 0.42, POD_Y + 0.05, POD_Z)), V3((cx - s * 0.30, POD_Y + 0.05, POD_Z)), 0.21, 0.21,
              folds=1, depth=0.02, n=12, col=PAL["seals"])
    L.flush(part)
    return part


def build_full(layers=None):
    """Every part in layers 1-10 (+ a rough weapon layer). Returns (root, objs, info)."""
    parts = [pelvis(), torso(), pod(1), pod(-1)]
    for s in (1, -1):
        parts += [thigh(s), shin(s), foot(s)]
    pieces = [pc for pt in parts for pc in pt.pieces()]
    K.bake_all(pieces, PAL, 3, ao_rays=12, ao_dist=0.5, wear=0.3, dust=0.2)
    root, emp, J = hierarchy("Rampart_v1")
    tris, objs = {}, []
    for pt in parts:
        for pc in pt.pieces():
            if layers is not None and H.layer_of(pc.name) not in layers:
                continue
            objs.append(K.emit(pc, emp[pt.name], V3()))
            tris[pc.name] = pc.tris
    by_part, by_layer = {}, {}
    for k, v in tris.items():
        pk, lk = k.split("__")
        by_part[pk] = by_part.get(pk, 0) + v
        by_layer[lk] = by_layer.get(lk, 0) + v
    rep = H.report()
    info = {"tris": tris, "tris_total": sum(tris.values()), "tris_by_part": by_part, "tris_by_layer": by_layer,
            "hskit": rep["stats"], "hskit_log": rep["log"]}
    return root, objs, info


JOINTS = {}


def joints():
    j = {"Pelvis": V3((0, HIP_Y, HIP_Z)), "Torso": WAIST}
    for s, sfx in ((1, "_L"), (-1, "_R")):
        j["Thigh" + sfx], j["Shin" + sfx], j["Foot" + sfx] = hip(s), knee(s), ankle(s)
        j["Pod" + sfx] = V3((s * 1.30, POD_Y + 0.05, POD_Z))
    return j


PARENT = {"Pelvis": None, "Torso": "Pelvis", "Pod_L": "Torso", "Pod_R": "Torso", "Thigh_L": "Pelvis", "Thigh_R": "Pelvis",
          "Shin_L": "Thigh_L", "Shin_R": "Thigh_R", "Foot_L": "Shin_L", "Foot_R": "Shin_R"}
ORDER = ["Pelvis", "Torso", "Pod_L", "Pod_R", "Thigh_L", "Thigh_R", "Shin_L", "Shin_R", "Foot_L", "Foot_R"]


def hierarchy(name):
    J = joints()
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    emp = {}
    for k in ORDER:
        e = bpy.data.objects.new(k, None)
        bpy.context.scene.collection.objects.link(e)
        par = PARENT[k]
        e.parent = emp[par] if par else root
        e.location = J[k] - (J[par] if par else V3())
        emp[k] = e
    return root, emp, J


def build_mass():
    """The mass layer as objects (flat grey, one mesh per part): the step-2 gate."""
    root, emp, J = hierarchy("Rampart_mass")
    tris = {}
    objs = []
    for k, solids in mass_layer().items():
        pc = V.Piece(k + "__Mass", J[k], 1)
        for S in solids:
            H.commit(S, pc)
        K.bake_all([pc], PAL, 1, ao_rays=4, wear=0.0, dust=0.0, deep=2.0)
        o = K.emit(pc, emp[k], V3())
        tris[k] = pc.tris
        objs.append(o)
    return root, objs, {"tris": tris, "tris_total": sum(tris.values()), "hskit": H.report()["stats"]}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--mass", action="store_true")
    ap.add_argument("--out", default=os.path.join(os.environ.get("TEMP", "."), "rampart_out"))
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    V.clear_scene()
    if a.mass:
        root, objs, info = build_mass()
    else:
        root, objs, info = build_full()
    name = "MechStudy_Rampart" + ("_mass" if a.mass else "")
    V.export_fbx(root, os.path.join(a.out, name + ".fbx"))
    with open(os.path.join(a.out, name + ".json"), "w") as f:
        json.dump(info, f, indent=1)
    print("TRIS", info["tris_total"], json.dumps(info["tris"]))
    print("HSSTATS", json.dumps(H.report()["stats"]))


if __name__ == "__main__":
    main()
