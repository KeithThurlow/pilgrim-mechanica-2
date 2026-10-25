"""Rampart walker v2: the mech-modeling skill v0.2's second run, from a 3D reference (2026-10-22).

    blender -b --factory-startup -P tools/blender/mechs/studies/rampart/rampart_v2.py -- [--mass] [--out DIR]

Reference: a Tripo3D model Keith supplied (art-refs/mech-reference/rampart/, never committed), measured at mechHeight 5.2
(turnarounds, bisected regions and plane sections: docs/mech-skill-rampart-v2-2026-10-22/form-study.md). Colours and
markings from the painting (rampart.jpg). v1 (rampart.py) supplies the shell / region / panel helpers.

What changed from v1 (the manager's critique):
  * every profile is a faceted rounded outline (rrect, seg_profile, ellipse; 2-3 facets per corner), so the side ∩ front ∩
    top intersections come out as faceted rounded forms in every view, not flat slabs; panels cut from those shells curve
    and crease with them.
  * the legs follow the reference: a tall slab thigh hanging outboard of the hip, a knee drum at its front bottom, a short
    link raking back to a reverse hock under a big oval armour pod, a metatarsal raking forward to the ankle, a 3-toe foot.
  * the cockpit is a wide wedge: a forward nose at 3.75 m, a long sloped face up to the brow, a V chin under it, and an
    olive dorsal hood overhanging the brow.
  * weapons on arms as in the reference: a minigun (receiver, 6-barrel gatling, reel, ammo drums) on the right, a 2 x 5
    rocket box on a pivot disc on the left. Barrels forward.
  * links (shin, metatarsal) are built in their own frame along the bone: link_mass().

Units m, Z up, front -Y, the mech's left +X. Height 5.2 m (the rocket box top).
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, MECHS)
sys.path.insert(0, os.path.join(MECHS, "studies", "military"))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import hskit as H  # noqa: E402
import mil_kit as K  # noqa: E402
from mil_kit import V  # noqa: E402
import rampart as HD1  # noqa: E402  (v1: shell, region, panel, Layers, groove, roundel, pocket helpers)

V3 = Vector
X_, Y_, Z_ = V3((1, 0, 0)), V3((0, 1, 0)), V3((0, 0, 1))

# ----------------------------------------------------------------------------------------------------------- palette
KHAKI = (0.63, 0.57, 0.42)        # the painting's plates
KHAKI2 = (0.55, 0.52, 0.38)       # the greener lower-leg guards
OLIVE = (0.42, 0.43, 0.30)        # the dorsal hood and ammo drums (the reference's darker green panels)
BROWN = (0.33, 0.25, 0.19)        # the riveted pads on the thigh's outer face
DARK = (0.165, 0.158, 0.145)
BARE = (0.55, 0.54, 0.50)
MARK = (0.88, 0.85, 0.74)
RED = (0.70, 0.17, 0.12)
GLOW = (1.0, 0.72, 0.30)
RUBBER = (0.12, 0.115, 0.11)
PAL = H.layer_palette(DARK, BARE, KHAKI, GLOW, mounting=(0.76, 0.74, 0.68))
PAL.update({"bare": BARE, "dust": (0.70, 0.60, 0.45)})
GREY = (0.62, 0.62, 0.62)
HAS_WEAPON_LAYER = True

# ------------------------------------------------------------------------------------------------------------ joints
SPLAY = math.radians(0.0)          # the reference's thighs hang plumb (the 4 deg splay overshot the gate)
HIP_X, HIP_Y, HIP_Z = 0.78, 0.0, 3.05
LX = 0.24                                   # the lower leg's centre line, outboard of the hip (hip-local x)
K_L = (-0.21, -1.67)                        # knee drum (hip-local y, z): the front bottom of the thigh
HK_L = (0.50, -1.90)                        # hock: the reverse joint behind
A_L = (0.09, -2.78)                         # ankle
SHOULDER = (1.02, 0.10, 4.34)


def leg_rot(s):
    return Matrix.Rotation(-s * SPLAY, 4, "Y")


def hip(s):
    return V3((s * HIP_X, HIP_Y, HIP_Z))


def leg_pt(s, yz, x=LX):
    return hip(s) + leg_rot(s).to_3x3() @ V3((s * x, yz[0], yz[1]))


def knee(s):
    return leg_pt(s, K_L)


def hock(s):
    return leg_pt(s, HK_L)


def ankle(s):
    return leg_pt(s, A_L)


def leg_M(s):
    return Matrix.Translation(hip(s)) @ leg_rot(s)


# ------------------------------------------------------------------------------------------------------------ outlines
def ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return list(pts) if a > 0 else list(reversed(pts))


def mx(pts, s):
    """Mirror an (x, ...) outline for side s, CCW."""
    return ccw([(s * x, y) for x, y in pts])


def rrect(x0, x1, y0, y1, r=0.0, n=2):
    """A rectangle with faceted round corners (n facets per corner; r a number or (bl, br, tr, tl)). The skill's 3-6 planes
    per quarter turn, counting the flat sides."""
    rs = r if isinstance(r, (tuple, list)) else (r,) * 4
    pts = []
    for (cx, cy, a0), rr in zip(((x0, y0, 180), (x1, y0, 270), (x1, y1, 0), (x0, y1, 90)), rs):
        if rr <= 1e-4:
            pts.append((cx, cy))
            continue
        ox = cx + (rr if cx == x0 else -rr)
        oy = cy + (rr if cy == y0 else -rr)
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((ox + math.cos(a) * rr, oy + math.sin(a) * rr))
    return ccw(pts)


def ellipse(cx, cy, rx, ry, n=12, rot=0.0):
    c, s = math.cos(rot), math.sin(rot)
    return ccw([(cx + c * rx * math.cos(2 * math.pi * k / n) - s * ry * math.sin(2 * math.pi * k / n),
                 cy + s * rx * math.cos(2 * math.pi * k / n) + c * ry * math.sin(2 * math.pi * k / n)) for k in range(n)])


def hull2d(pts):
    pts = sorted(set((round(x, 6), round(y, 6)) for x, y in pts))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def seg_profile(a, b, ra, rb, n=10):
    """Convex hull of two faceted circles: a link from a drum of radius ra to one of rb (a bone between two joints)."""
    pts = []
    for (cx, cy), r in ((a, ra), (b, rb)):
        pts += [(cx + math.cos(2 * math.pi * k / n) * r, cy + math.sin(2 * math.pi * k / n) * r) for k in range(n)]
    return hull2d(pts)


def P_(name="s"):
    return H.Solid(name)


def flagall(S, flag):
    for f in S.bm.faces:
        f[S.flag] = flag
    return S


def recol(S, col, mat=None):
    for f in S.bm.faces:
        for lp in f.loops:
            lp[S.col] = (*col, 1.0)
        if mat:
            f[S.sec] = V.sec_index(mat)
    return S


# =============================================================================================================== MASSES
CACHE = {}


def cached(fn):
    def w(*a, **kw):
        key = (fn.__name__, a, tuple(sorted(kw.items())))
        if key not in CACHE:
            CACHE[key] = fn(*a, **kw)
        return CACHE[key].copy(fn.__name__)
    w.__name__ = fn.__name__
    return w


# ---- thigh (hip-local: origin at the hip, x mirrored by s; the slab hangs outboard of the hip)
TH_S = [(-0.44, -1.40), (-0.40, -1.52), (-0.30, -1.61), (-0.12, -1.65), (0.08, -1.63), (0.20, -1.56), (0.29, -1.44),
        (0.47, -0.22), (0.50, 0.04), (0.46, 0.18), (0.36, 0.26), (-0.20, 0.28), (-0.34, 0.22), (-0.42, 0.10), (-0.45, -0.06)]
TH_F = [(-0.18, -0.02), (-0.17, 0.13), (-0.10, 0.24), (0.0, 0.28), (0.44, 0.28), (0.52, 0.23), (0.56, 0.13), (0.56, -1.44),
        (0.53, -1.55), (0.46, -1.62), (0.36, -1.65), (0.14, -1.65), (0.06, -1.61), (0.02, -1.55)]
TH_T = [(-0.10, -0.46), (0.40, -0.46), (0.50, -0.41), (0.56, -0.31), (0.56, 0.20), (0.50, 0.33), (0.36, 0.47), (0.20, 0.53),
        (0.0, 0.53), (-0.12, 0.46), (-0.18, 0.34), (-0.18, -0.33), (-0.16, -0.41)]
REC_Y, REC_Z, REC_W, REC_H, REC_D = 0.07, -0.74, 0.46, 1.20, 0.11      # the recess down the outer face


@cached
def thigh_mass(s, d=0.0, col=GREY, flag=0, recess=True):
    m = H.intersect([H.prism(mx(TH_F, s), "y", -0.8, 0.8, "primary", col, "tf", d, flag),
                     H.prism(ccw(TH_S), "x", -1.0, 1.0, "primary", col, "ts", d, flag),
                     H.prism(mx(TH_T, s), "z", -1.9, 0.5, "primary", col, "tt", d, flag)], "thigh_mass")
    if recess:   # subtract: the recess down the outer face (brown pads and the mechanism live in it)
        H.carve(m, [H.cut_rect(V3((s * (0.56 + d), REC_Y, REC_Z)), Y_, Z_, s * X_, REC_W - 2 * d, REC_H - 2 * d, depth=REC_D,
                               corner=0.07, slope=0.25, mat="primary", col=col)], bevel=0.0)
        flagall(m, flag)
    return m


# ---- links: a bone between two joints, built along the bone and moved into hip-local
def link_frame(s, a, b, x=LX):
    a, b = V3((0, a[0], a[1])), V3((0, b[0], b[1]))
    u = (b - a).normalized()
    n = V3((0, -u.z, u.y))            # 90 deg from u in the side plane (for hock -> ankle it points back)
    M = Matrix(((1, 0, 0, s * x), (0, u.y, n.y, a.y), (0, u.z, n.z, a.z), (0, 0, 0, 1)))
    return M, (b - a).length


def link_mass(s, a, b, ra, rb, hw, ch, d=0.0, col=GREY, flag=0, mat="primary", name="link"):
    """A bone from joint a to joint b (hip-local (y, z)): side profile = hull of the two drums, section = a chamfered
    rectangle hw half-wide; mass(d) like every other mass."""
    M, L = link_frame(s, a, b)
    R = max(ra, rb)
    side = H.prism(seg_profile((0, 0), (L, 0), ra, rb), "x", -hw, hw, mat, col, name + "_s", d, flag)
    sec = H.prism(rrect(-hw, hw, -R, R, ch, 1), "y", -R - 0.4, L + R + 0.4, mat, col, name + "_x", d, flag)
    return H.xform(H.intersect([side, sec], name), M)


@cached
def shin_mass(s, d=0.0, col=GREY, flag=0):
    return link_mass(s, K_L, HK_L, 0.17, 0.18, 0.20, 0.06, d, col, flag, name="shin")


@cached
def meta_mass(s, d=0.0, col=GREY, flag=0):
    return link_mass(s, HK_L, A_L, 0.17, 0.13, 0.17, 0.05, d, col, flag, name="meta")


@cached
def pod_mass(s, d=0.0, col=GREY, flag=0):
    """The big oval armour on the back of the metatarsal (the reverse knee's guard): ellipse (along the bone) ∩ ellipse
    (across it), so it reads round from every side, faceted."""
    M, L = link_frame(s, HK_L, A_L)
    side = H.prism(ellipse(0.36 * L, 0.10, 0.50, 0.17, 14), "x", -0.6, 0.6, "primary", col, "pod_s", d, flag)
    cross = H.prism(ellipse(0.0, 0.06, 0.23, 0.23, 12), "y", -0.4, L + 0.2, "primary", col, "pod_x", d, flag)
    top = H.prism(rrect(-0.25, 0.25, -0.30, L * 0.80, (0.0, 0.0, 0.12, 0.12), 2), "z", -0.1, 0.40, "primary", col, "pod_t", d,
                  flag)
    return H.xform(H.intersect([side, cross, top], "pod"), M)


# ---- foot (world, flat on the ground under the ankle)
TOE_S = [(-0.66, 0.0), (-0.18, 0.0), (0.04, 0.10), (0.04, 0.24), (-0.16, 0.30), (-0.46, 0.22), (-0.66, 0.08)]
HEEL_S = [(0.0, 0.0), (0.56, 0.0), (0.56, 0.06), (0.30, 0.20), (0.04, 0.26)]


def toe_solid(s, k, d=0.0, col=GREY, mat="dark", flag=0):
    a = ankle(s)
    dx, yaw, w = ((-0.20, 24, 0.17), (0.0, 0, 0.21), (0.20, -24, 0.17))[k]
    t = H.prism(ccw(TOE_S), "x", -w / 2, w / 2, mat, col, "toe", d, flag)
    return H.xform(t, Matrix.Translation(V3((a.x + dx * s, a.y - 0.04, 0))) @ Matrix.Rotation(math.radians(yaw * s), 4, "Z"))


def foot_mass(s, col=GREY, mat="dark"):
    a = ankle(s)
    parts = [toe_solid(s, k, col=col, mat=mat) for k in range(3)]
    heel = H.xform(H.prism(ccw(HEEL_S), "x", -0.09, 0.09, mat, col, "heel"), Matrix.Translation(V3((a.x, a.y, 0))))
    body = H.xform(H.intersect([H.prism(rrect(-0.25, 0.25, 0.06, 0.40, (0.06, 0.06, 0.12, 0.12), 2), "y", -0.30, 0.24, mat, col,
                                            "fb"),
                                H.prism(rrect(-0.30, 0.24, 0.06, 0.40, (0.04, 0.06, 0.10, 0.14), 2), "x", -0.25, 0.25, mat, col,
                                        "fbs")], "foot_body"), Matrix.Translation(V3((a.x, a.y, 0))))
    drum = H.xform(H.prism(ellipse(0, 0, 0.15, 0.15, 10), "x", -0.17, 0.17, mat, col, "ankle_drum"), Matrix.Translation(a))
    return H.fuse([body] + parts + [heel, drum], "foot", fillet=0.015, segments=1)


# ---- torso (world)
CH_S = [(-0.80, 3.20), (-1.12, 3.62), (-1.20, 3.74), (-1.19, 3.86), (-0.66, 4.42), (-0.50, 4.56), (0.35, 4.56), (0.35, 3.20)]
CH_F = [(-0.34, 3.20), (0.34, 3.20), (0.62, 3.40), (0.80, 3.70), (0.82, 3.92), (0.82, 4.18), (0.72, 4.40), (0.46, 4.56),
        (-0.46, 4.56), (-0.72, 4.40), (-0.82, 4.18), (-0.82, 3.92), (-0.80, 3.70), (-0.62, 3.40)]
CH_T = [(-0.28, -1.18), (0.0, -1.215), (0.28, -1.18), (0.56, -1.00), (0.74, -0.84), (0.82, -0.62), (0.82, 0.35), (-0.82, 0.35),
        (-0.82, -0.62), (-0.74, -0.84), (-0.56, -1.00)]


@cached
def chest_mass(d=0.0, col=GREY, flag=0):
    return H.intersect([H.prism(ccw(CH_F), "y", -1.6, 0.6, "primary", col, "cf", d, flag),
                        H.prism(ccw(CH_S), "x", -1.0, 1.0, "primary", col, "cs", d, flag),
                        H.prism(ccw(CH_T), "z", 3.0, 4.8, "primary", col, "ct", d, flag)], "chest")


HB_S = [(-0.45, 3.70), (1.05, 3.70), (1.15, 3.82), (1.15, 4.82), (1.05, 4.94), (0.35, 5.00), (-0.45, 4.82)]


@cached
def hull_mass(d=0.0, col=GREY, flag=0, mat="primary"):
    return H.intersect([H.prism(ccw(HB_S), "x", -0.48, 0.48, mat, col, "hs", d, flag),
                        H.prism(rrect(-0.48, 0.48, 3.70, 5.0, (0.10, 0.10, 0.16, 0.16), 1), "y", -0.7, 1.3, mat, col, "hf", d,
                                flag)], "hull")


HD_T = [(-0.16, -0.82), (0.16, -0.82), (0.38, -0.44), (0.40, 1.22), (-0.40, 1.22), (-0.38, -0.44)]
HD_S = [(-0.84, 4.72), (1.22, 4.86), (1.22, 5.0), (1.1, 5.08), (0.35, 5.11), (-0.62, 4.95), (-0.84, 4.83)]
HD_F = [(-0.42, 4.70), (0.42, 4.70), (0.42, 4.92), (0.28, 5.15), (-0.28, 5.15), (-0.42, 4.92)]


@cached
def hood_mass(d=0.0, col=GREY, flag=0):
    return H.intersect([H.prism(ccw(HD_T), "z", 4.5, 5.4, "primary", col, "ht", d, flag),
                        H.prism(ccw(HD_S), "x", -0.6, 0.6, "primary", col, "hs", d, flag),
                        H.prism(ccw(HD_F), "y", -1.2, 1.4, "primary", col, "hf", d, flag)], "hood")


SB_S = [(-0.30, 3.96), (1.30, 3.96), (1.38, 4.06), (1.38, 4.70), (1.30, 4.78), (-0.10, 4.78), (-0.34, 4.56), (-0.34, 4.10)]
SB_F = [(0.44, 3.96), (0.86, 3.96), (0.94, 4.05), (0.94, 4.67), (0.84, 4.78), (0.44, 4.78)]


@cached
def sidebox_mass(s, d=0.0, col=GREY, flag=0):
    return H.intersect([H.prism(ccw(SB_S), "x", *HD1.span(s * 0.40, s * 1.0), "primary", col, "sbs", d, flag),
                        H.prism(mx(SB_F, s), "y", -0.6, 1.5, "primary", col, "sbf", d, flag)], "sidebox")


# ---- pelvis (world)
def pelvis_core(d=0.0, col=GREY, mat="dark"):
    return H.intersect([H.prism(rrect(-0.42, 0.42, 2.80, 3.40, (0.10, 0.10, 0.04, 0.04), 1), "y", -0.42, 0.42, mat, col, "pc", d),
                        H.prism(rrect(-0.42, 0.42, 2.80, 3.40, (0.14, 0.10, 0.04, 0.04), 1), "x", -0.5, 0.5, mat, col, "ps", d)],
                       "pelvis")


WING = [(-0.02, 3.30), (0.68, 3.21), (0.68, 3.34), (0.44, 3.53), (-0.02, 3.53)]


@cached
def wing_mass(d=0.0, col=GREY, flag=0):
    halves = [H.prism(mx(WING, s), "y", -0.48, -0.22, "primary", col, "wing", d, flag) for s in (1, -1)]
    return H.fuse(halves, "wing", fillet=0.0, segments=1)


@cached
def skirt_mass(d=0.0, col=GREY, flag=0):
    return H.intersect([H.prism(rrect(-0.28, 0.28, 2.70, 3.30, (0.08, 0.08, 0.0, 0.0), 1), "y", -0.52, -0.26, "primary", col,
                                "sk", d, flag),
                        H.prism(ccw([(-0.52, 2.78), (-0.40, 2.70), (-0.26, 2.70), (-0.26, 3.30), (-0.50, 3.30)]), "x", -0.4, 0.4,
                                "primary", col, "sks", d, flag)], "skirt")


# ---- arms (world). Right (s = -1): the minigun. Left (s = +1): the rocket box.
# measured from the reference's gun region (front, side and top ortho; the arm is yawed in on it, built here straight)
RCV_X, RCV_Y, RCV_Z = (1.56, 2.36), (-0.36, 0.80), (3.98, 4.46)       # the outer receiver (mirrored by s = -1)
INR_X, INR_Y, INR_Z = (1.21, 1.62), (0.0, 0.72), (3.66, 4.62)         # the tall inner block with the stencil
BCK_Y, BCK_Z = (0.62, 0.98), (3.72, 4.52)                              # the olive back block


@cached
def recv_mass(d=0.0, col=GREY, flag=0):
    s = -1
    outer = H.intersect([H.prism(mx(rrect(*RCV_X, *RCV_Z, (0.10, 0.10, 0.10, 0.06), 2), s), "y", *RCV_Y, "primary", col, "ro", d,
                                 flag),
                         H.prism(rrect(*RCV_Y, *RCV_Z, (0.12, 0.08, 0.06, 0.12), 2), "x", -2.6, -1.3, "primary", col, "ros", d,
                                 flag)], "recv_outer")
    inner = H.intersect([H.prism(mx(rrect(*INR_X, *INR_Z, (0.06, 0.06, 0.08, 0.08), 1), s), "y", *INR_Y, "primary", col, "ri", d,
                                 flag),
                         H.prism(rrect(*INR_Y, *INR_Z, (0.06, 0.06, 0.10, 0.10), 1), "x", -1.8, -1.0, "primary", col, "ris", d,
                                 flag)], "recv_inner")
    out = H.fuse([outer, inner], "receiver", fillet=0.0, segments=1)
    return flagall(out, flag)


def back_block(col=OLIVE, d=0.0, flag=0):
    return H.intersect([H.prism(mx(rrect(1.62, 2.30, *BCK_Z, 0.08, 1), -1), "y", *BCK_Y, "primary", col, "bb", d, flag),
                        H.prism(rrect(*BCK_Y, *BCK_Z, (0.06, 0.06, 0.10, 0.10), 1), "x", -2.4, -1.5, "primary", col, "bbs", d,
                                flag)], "back_block")


RB_F = [(1.66, 3.96), (2.14, 3.96), (2.26, 4.08), (2.26, 5.08), (2.14, 5.20), (1.66, 5.20), (1.54, 5.08), (1.54, 4.08)]
RB_S = [(-0.86, 4.04), (-0.78, 3.96), (0.50, 3.96), (0.70, 4.16), (0.70, 5.04), (0.56, 5.20), (-0.76, 5.20), (-0.86, 5.10)]


@cached
def rocket_mass(d=0.0, col=GREY, flag=0):
    return H.intersect([H.prism(ccw(RB_F), "y", -1.2, 1.0, "primary", col, "rbf", d, flag),
                        H.prism(ccw(RB_S), "x", 1.3, 2.5, "primary", col, "rbs", d, flag),
                        H.prism(rrect(1.54, 2.26, -0.86, 0.70, 0.05, 1), "z", 3.8, 5.4, "primary", col, "rbt", d, flag)], "rocket")


GUN_X, GUN_Z = -1.96, 3.97
REEL = (-1.98, 0.12, 4.56)         # the rubber reel on top, axis y
DRUM = (-1.98, 3.60)               # the two ammo drums under the receiver, axis y, coaxial


def gatling(S, col=DARK, mat="dark"):
    """Six barrels round a spindle, a hub at the receiver, two clamp rings and a muzzle ring (the reference's gatling)."""
    x, z = GUN_X, GUN_Z
    V.cyl(S, (x, -0.43, z), 0.165, 0.16, axis="y", n=12, mat=mat, col=col)          # hub
    V.cyl(S, (x, -0.54, z), 0.12, 0.08, axis="y", n=12, mat=mat, col=V.shade(col, 1.3))
    for k in range(6):
        a = 2 * math.pi * k / 6
        V.cyl(S, (x + math.cos(a) * 0.088, -0.97, z + math.sin(a) * 0.088), 0.036, 0.86, axis="y", n=6, mat=mat, col=col)
    V.cyl(S, (x, -0.97, z), 0.03, 0.88, axis="y", n=6, mat=mat, col=col)            # spindle
    for y, r, t in ((-0.84, 0.145, 0.06), (-1.20, 0.14, 0.05), (-1.36, 0.15, 0.07)):
        V.cyl(S, (x, y, z), r, t, axis="y", n=12, mat=mat, col=V.shade(col, 1.15))
    return S


def rockets(S):
    for cx in (1.77, 2.03):
        for k in range(5):
            z = 4.18 + 0.205 * k
            V.cyl(S, (cx, -0.74, z), 0.088, 0.14, axis="y", n=10, mat="dark", col=(0.10, 0.10, 0.10))       # tube mouth
            V.cyl(S, (cx, -0.80, z), 0.072, 0.12, axis="y", n=10, mat="trim", col=(0.36, 0.38, 0.34), r2=0.03)  # warhead
            V.cyl(S, (cx, -0.865, z), 0.032, 0.02, axis="y", n=8, mat="secondary", col=RED)                    # red tip
    return S


# ============================================================================================================ the mass layer
def mass_layer():
    """Every mass in world space as {part: [Solid]} (the step-2 gate renders these flat grey)."""
    out = {}
    out["Torso"] = [H.fuse([chest_mass(), hull_mass(), sidebox_mass(1), sidebox_mass(-1)], "torso_mass", fillet=0.02, segments=1),
                    hood_mass()]
    for s in (1, -1):
        out["Torso"].append(H.prism(ellipse(SHOULDER[1], SHOULDER[2], 0.21, 0.21, 10), "x", *HD1.span(s * 0.9, s * 1.14), "dark",
                                    GREY, "shoulder"))
    out["Pelvis"] = [pelvis_core(col=GREY), wing_mass(), skirt_mass()]
    ub = P_("ubar")
    for s_ in (-1, 1):
        V.bar(ub, V3((s_ * 0.30, -0.10, 2.82)), V3((s_ * 0.30, -0.10, 2.56)), 0.05, "dark", GREY, 6)
    V.bar(ub, V3((-0.33, -0.10, 2.56)), V3((0.33, -0.10, 2.56)), 0.06, "dark", GREY, 6)
    out["Pelvis"].append(ub)
    for s, sfx in ((1, "_L"), (-1, "_R")):
        M = leg_M(s)
        out["Thigh" + sfx] = [H.xform(thigh_mass(s), M)]
        out["Shin" + sfx] = [H.xform(shin_mass(s), M)]
        out["Meta" + sfx] = [H.xform(meta_mass(s), M), H.xform(pod_mass(s), M)]
        out["Foot" + sfx] = [foot_mass(s)]
    out["Arm_R"] = [recv_mass(), arm_link(-1)]
    gun = P_("gun")
    gatling(gun, GREY)
    V.cyl(gun, REEL, 0.21, 0.48, axis="y", n=14, mat="dark", col=GREY)                                   # reel
    for y in (0.0, 0.32):
        V.cyl(gun, (DRUM[0], y, DRUM[1]), 0.25, 0.30, axis="y", n=14, mat="dark", col=GREY)              # ammo drums
    out["Arm_R"] += [gun, back_block(GREY)]
    out["Arm_L"] = [rocket_mass(), rocket_under(), arm_link(1),
                    H.prism(ellipse(-0.02, 4.50, 0.28, 0.28, 14), "x", 1.40, 1.55, "dark", GREY, "collar"),
                    H.prism(ellipse(-0.06, 4.52, 0.33, 0.33, 16), "x", 2.25, 2.37, "dark", GREY, "hub")]
    return out


def arm_link(s, col=GREY, mat="dark", d=0.0, flag=0):
    """The short upper arm from the shoulder drum to the weapon (the reference's arms are stubby: the weapon is the forearm)."""
    x0, x1 = (1.08, 1.44) if s > 0 else (1.08, 1.24)
    return H.intersect([H.prism(mx(rrect(x0, x1, 3.98, 4.62, 0.06, 1), s), "y", -0.22, 0.42, mat, col, "upper_arm", d, flag),
                        H.prism(rrect(-0.22, 0.42, 3.98, 4.62, (0.10, 0.10, 0.14, 0.14), 1), "x", *HD1.span(s * x0, s * x1), mat,
                                col, "ua_s", d, flag)], "upper_arm")


def shoulder_cap(L, s):
    """A khaki cap over the upper arm: top and front of the arm link's own shell (the reference's shoulders are plated)."""
    am = lambda d=0.0, col=KHAKI, flag=0: arm_link(s, col, "primary", d, flag)  # noqa: E731
    up = shell(am, -0.02, 0.04)
    L.add("plates", panel(up, region(mx(rect(0.9, 1.6, -0.4, 0.6), s), "z", 4.40, 4.9), 0.035, "shoulder_cap"))
    L.add("plates", panel(up, region(mx(rect(0.9, 1.6, 3.9, 4.36), s), "y", -0.5, -0.10), 0.03, "shoulder_front"))


def rocket_under(col=GREY, d=0.0, flag=0, mat="dark"):
    """The block under the rocket box (its elevation drive)."""
    return H.intersect([H.prism(rrect(1.45, 2.10, 3.66, 4.0, (0.08, 0.08, 0.0, 0.0), 1), "y", -0.50, 0.40, mat, col, "ru", d, flag),
                        H.prism(rrect(-0.50, 0.40, 3.66, 4.0, (0.10, 0.06, 0.0, 0.0), 1), "x", 1.4, 2.2, mat, col, "rus", d, flag)],
                       "rocket_under")


# ======================================================================================================= layers 1-10
shell, region, panel, groove, pocket, pockets, darken, Layers = (HD1.shell, HD1.region, HD1.panel, HD1.groove, HD1.pocket,
                                                                  HD1.pockets, HD1.darken, HD1.Layers)
span, rect, tint = HD1.span, HD1.rect, HD1.tint


def mframe(fn, *a, **kw):
    """A mass as frame: dark, its own paint section."""
    return darken(recol(fn(*a, **kw), PAL["frame"]))


def hoops_web(L, src, stations, axis, n=12, r=0.013):
    hoops = [h for h in (H.section_loop(src, c, axis, n) for c in stations) if h]
    if hoops:
        H.rib_web(L["mounting"], hoops, "sand", PAL["mounting"], r=r, diag=False, every=2)
    return hoops


# ------------------------------------------------------------------------------------------------------------- thigh
def thigh(s):
    part = H.Part("Thigh" + ("_L" if s > 0 else "_R"), hip(s), 10 + s)
    L = Layers()
    mf = lambda d=0.0, col=KHAKI, flag=0: thigh_mass(s, d, col, flag)  # noqa: E731
    # frame: the mass shrunk by plate + rib depth, the hip drum, knee clevis cheeks, lightening pockets
    fr = mframe(thigh_mass, s, -0.17, PAL["frame"], 0, False)
    hipd = H.prism(ellipse(0, 0, 0.20, 0.20, 12), "x", *span(-s * 0.36, s * 0.02), "dark", V.shade(PAL["frame"], 1.15), "hipdrum")
    cheeks = [H.prism(rrect(-0.36, -0.06, -1.76, -1.40, (0.12, 0.12, 0.0, 0.0), 1), "x", *span(s * x, s * (x + 0.07)), "dark",
                      PAL["frame"], "cheek") for x in (0.0, 0.42)]
    fr = H.fuse([fr, hipd] + cheeks, "thigh_frame", fillet=0.02, segments=1)
    pockets(fr, [pocket(V3((s * (0.56 - 0.17), REC_Y, z)), Y_, Z_, s * X_, 0.26, 0.32, 0.05) for z in (-0.40, -0.98)] +
            [pocket(V3((s * 0.18, 0.47 - 0.17, z)), X_, Z_, Y_, 0.26, 0.30, 0.05) for z in (-0.95, -1.30)])
    L.add("frame", fr)
    # mounting: hoops just under the plates (they show in the outer recess and the open lower back)
    hoops_web(L, thigh_mass(s, -0.085, PAL["mounting"], 0, False), [V3((0, 0, z)) for z in (-0.25, -0.75, -1.25)], Z_, 14)
    # plates: shells at three depths, panels by region
    sh = shell(mf, -0.06, 0.0)
    up = shell(mf, -0.025, 0.035)
    ins = shell(mf, -0.09, -0.03)
    F = lambda pts: mx(pts, s)  # noqa: E731
    L.add("plates", panel(up, region(F(rect(-0.4, 0.8, 0.0, 0.6)), "z", -0.02, 0.6), 0.04, "thigh_cap"))
    L.add("plates", panel(sh, region(F(rect(-0.4, 0.8, -0.58, -0.06)), "y", -1.0, -0.25), 0.04, "thigh_front_up",
                          cuts=[H.cut_rect(V3((-s * 0.02, -0.462, -0.22)), X_, Z_, -Y_, 0.12, 0.2, depth=0.08, corner=0.02,
                                           slope=0.3, mat="dark", col=(0.08, 0.08, 0.085))]))
    L.add("plates", panel(up, region(F(rect(-0.4, 0.8, -1.16, -0.62)), "y", -1.0, -0.25), 0.04, "thigh_front_mid"))
    L.add("plates", panel(ins, region(F(rect(-0.4, 0.8, -1.8, -1.20)), "y", -1.0, -0.25), 0.03, "thigh_front_low"))
    L.add("plates", panel(sh, region(rect(-0.21, 0.6, -1.5, -0.06), "x", *span(-s * 1.0, -s * 0.0)), 0.035, "thigh_inner",
                          cuts=[groove(V3((-s * 0.115, 0.15, -0.50)), Z_, Y_, -s * X_, 0.5)]))
    L.add("plates", panel(up, region(rect(0.395, 0.62, -0.75, -0.06), "x", *span(s * 0.05, s * 1.0)), 0.035, "thigh_back_up"))
    L.add("plates", panel(ins, region(rect(0.30, 0.62, -1.36, -0.80), "x", *span(-s * 0.10, s * 1.0)), 0.03, "thigh_back_low"))
    # the outer recess: brown riveted pads in its back half; its front half stays open (ram, hoses, frame)
    pad = shell(mf, -0.16, -0.10, BROWN)
    for z0, z1 in ((-0.70, -0.16), (-1.30, -0.74)):
        L.add("plates", panel(pad, region(rect(0.05, 0.31, z0, z1), "x", *span(s * 0.30, s * 0.5), BROWN), 0.02, "thigh_pad"))
        V.bolt_row(L["service"], V3((s * 0.465, 0.27, z1 - 0.04)), V3((s * 0.465, 0.27, z0 + 0.04)), 5, s * X_, r=0.015, col=BARE)
    # actuation: a knee ram down the open front of the recess, hoses down the inner back
    H.ram(L["actuation"], V3((s * 0.40, -0.08, -0.22)), V3((s * 0.36, -0.12, -1.42)), 0.055, sleeve_col=PAL["actuation"],
          rod_col=BARE)
    for k, x in enumerate((0.0, 0.10)):
        V.pipe_run(L["actuation"], [V3((s * x, 0.40, 0.0)), V3((s * x, 0.46, -0.6)), V3((s * x, 0.36, -1.3)),
                                    V3((s * (x + 0.1), 0.0, -1.62))], 0.026 - 0.006 * k, "trim",
                   V.shade(PAL["actuation"], 1 - 0.12 * k), bend=0.12, clamps=2 if k == 0 else 0)
    # power: hamstring bundles in the open lower back
    for x in (0.12, 0.25, 0.38):
        pts = [V3((s * x, 0.33, -0.70)), V3((s * x, 0.40, -1.0)), V3((s * x, 0.30, -1.38))]
        V.tube_along(L["power"], V.round_path(pts, 0.12), 0.045, "dark", PAL["power"], n=6)
    # seals: the hip boot towards the pelvis (front, where the camera sees it)
    H.bellows(L["seals"], V3((-s * 0.20, -0.02, 0.0)), V3((-s * 0.36, -0.02, 0.0)), 0.21, 0.21, folds=2, depth=0.022, n=12,
              col=PAL["seals"])
    # service: the hull number, roundel or bolts, a triangle, handholds in the recess
    sx = s * 0.15
    K.stencil(L["service"], "03", V3((sx, -0.502, -0.92)), X_, Z_, -Y_, 0.24, "secondary", MARK)
    if s > 0:
        HD1.roundel(L["service"], V3((sx, -0.50, -0.70)), 0.085)
    else:
        V.surf_blk(L["service"], V3((sx, -0.50, -0.70)), X_, Z_, -Y_, 0.20, 0.05, 0.006, "secondary", RED)   # a red band
    tri = [V3((sx - 0.05, -0.47, -1.42)), V3((sx + 0.05, -0.47, -1.42)), V3((sx, -0.47, -1.34))]
    V.prim(L["service"], [[p + V3((0, -t, 0)) for p in tri] for t in (0.0, 0.006)], "secondary", MARK, 0, None, jitter=0.0)
    H.rungs(L["service"], V3((s * 0.47, -0.02, -1.05)), V3((s * 0.47, -0.02, -0.35)), 3, s * X_, width=0.14, depth=0.05, r=0.014)
    L.flush(part, leg_M(s))
    return part


# -------------------------------------------------------------------------------------------------------------- shin
def shin(s):
    part = H.Part("Shin" + ("_L" if s > 0 else "_R"), knee(s), 20 + s)
    L = Layers()
    mf = lambda d=0.0, col=KHAKI, flag=0: shin_mass(s, d, col, flag)  # noqa: E731
    M, Ln = link_frame(s, K_L, HK_L)
    fr = mframe(shin_mass, s, -0.07, PAL["frame"])
    kd = H.xform(H.prism(ellipse(0, 0, 0.16, 0.16, 12), "x", -0.24, 0.24, "dark", V.shade(PAL["frame"], 1.15), "kneedrum"), M)
    hd = H.xform(H.prism(ellipse(Ln, 0, 0.15, 0.15, 12), "x", -0.23, 0.23, "dark", V.shade(PAL["frame"], 1.15), "hockdrum"), M)
    fr = H.fuse([fr, kd, hd], "shin_frame", fillet=0.015, segments=1)
    pockets(fr, [H.xform(pocket(V3((s * 0.13, Ln * 0.5, 0.0)), Y_, Z_, s * X_, 0.30, 0.14, 0.04), M)])
    L.add("frame", fr)
    # plates: a raised top guard and the outer cheek (the reference's link is mostly exposed frame)
    sh = shell(mf, -0.05, 0.0)
    up = shell(mf, -0.02, 0.035)
    top = region(rect(-0.4, 0.4, -0.12, 0.6), "z", 0.06, 0.6)
    L.add("plates", panel(up, H.xform(top, M) if False else region_in(top, M), 0.03, "shin_top"))
    L.add("plates", panel(sh, region_in(region(rect(0.12, Ln - 0.06, -0.14, 0.10), "x", *span(s * 0.08, s * 0.6)), M), 0.025,
                          "shin_outer"))
    # actuation: the hock ram under the link
    H.ram(L["actuation"], leg_local(s, -0.12, -1.88), leg_local(s, 0.42, -2.07), 0.045, sleeve_col=PAL["actuation"], rod_col=BARE)
    # seals: a knee boot on the front, where the camera looks
    H.bellows(L["seals"], leg_local(s, -0.30, -1.52, LX - 0.22), leg_local(s, -0.30, -1.52, LX + 0.22), 0.11, 0.11, folds=3,
              depth=0.02, n=10, col=PAL["seals"])
    L.flush(part, leg_M(s))
    return part


def leg_local(s, y, z, x=LX):
    return V3((s * x, y, z))


def region_in(R, M):
    """A region prism built in a link's own frame, moved to hip-local (its F_REGION flags survive)."""
    return H.xform(R, M)


# -------------------------------------------------------------------------------------------------------- metatarsal
def meta(s):
    part = H.Part("Meta" + ("_L" if s > 0 else "_R"), hock(s), 25 + s)
    L = Layers()
    M, Ln = link_frame(s, HK_L, A_L)
    # frame: the bone, exposed down its front
    fr = mframe(meta_mass, s, -0.04, PAL["frame"])
    pockets(fr, [H.xform(pocket(V3((s * 0.13, Ln * 0.45, -0.02)), Y_, Z_, s * X_, 0.40, 0.12, 0.04), M)])
    L.add("frame", fr)
    # plates: the big oval pod on the back in two shingled panels; a lower guard on the bone's front
    pm = lambda d=0.0, col=KHAKI, flag=0: pod_mass(s, d, col, flag)  # noqa: E731
    psh = shell(pm, -0.06, 0.0)
    pup = shell(pm, -0.025, 0.035)
    L.add("plates", panel(pup, region_in(region(rect(-0.6, 0.6, -0.4, Ln * 0.40), "y", -0.4, Ln * 0.40), M) if False else
                          region_in(H.prism(rect(-0.6, 0.6, -0.5, 0.6), "y", -0.4, Ln * 0.40, "primary", KHAKI, "region", 0.0,
                                            HD1.F_REGION), M), 0.04, "pod_up"))
    L.add("plates", panel(psh, region_in(H.prism(rect(-0.6, 0.6, -0.5, 0.6), "y", Ln * 0.43, Ln + 0.3, "primary", KHAKI, "region",
                                                 0.0, HD1.F_REGION), M), 0.035, "pod_low"))
    mm = lambda d=0.0, col=KHAKI2, flag=0: meta_mass(s, d, col, flag)  # noqa: E731
    gsh = shell(mm, -0.04, 0.03, KHAKI2)
    L.add("plates", panel(gsh, region_in(H.prism(rect(-0.6, 0.6, -0.5, 0.0), "y", Ln * 0.55, Ln * 0.92, "primary", KHAKI2, "region",
                                                 0.0, HD1.F_REGION), M), 0.03, "meta_guard"))
    # mounting: standoffs from the bone up to the pod
    for t in (0.25, 0.55):
        for x in (-0.10, 0.10):
            a = M @ V3((s * 0 + x, Ln * t, 0.08))
            b = M @ V3((x, Ln * t, 0.15))
            V.bar(L["mounting"], a, b, 0.022, "sand", PAL["mounting"], 6)
    # actuation: two pistons down the open front (the reference shows them between the guards)
    for x in (-0.07, 0.07):
        H.ram(L["actuation"], M @ V3((x, 0.10, -0.14)), M @ V3((x, Ln * 0.62, -0.13)), 0.032, sleeve_col=PAL["actuation"],
              rod_col=BARE)
    # power: side bundles
    for x in (-0.16, 0.16):
        V.tube_along(L["power"], V.round_path([M @ V3((x, 0.15, 0.0)), M @ V3((x * 1.1, Ln * 0.5, 0.02)),
                                               M @ V3((x, Ln * 0.85, 0.0))], 0.1), 0.04, "dark", PAL["power"], n=6)
    # service: a stencil on the pod
    L.flush(part, leg_M(s))
    return part


# -------------------------------------------------------------------------------------------------------------- foot
def foot(s):
    a = ankle(s)
    part = H.Part("Foot" + ("_L" if s > 0 else "_R"), a, 30 + s)
    L = Layers()
    L.add("frame", foot_mass(s, PAL["frame"]))
    for k in range(3):   # toe caps: a thin shell on each toe prism (single prisms offset cleanly), its top-front region
        tm = lambda d=0.0, col=KHAKI, flag=0, k=k: toe_solid(s, k, d, col, "primary", flag)  # noqa: E731
        cap = shell(tm, -0.02, 0.035)
        L.add("plates", panel(cap, region(rect(a.x - 1.0, a.x + 1.0, a.y - 1.2, a.y + 0.2), "z", 0.15, 0.6), 0.018, "toe_cap"))
    hm = lambda d=0.0, col=KHAKI, flag=0: flagall(recol(H.xform(H.intersect([  # noqa: E731
        H.prism(rrect(-0.25, 0.25, 0.06, 0.40, (0.06, 0.06, 0.12, 0.12), 2), "y", -0.30, 0.24, "primary", col, "fb", d),
        H.prism(rrect(-0.30, 0.24, 0.06, 0.40, (0.04, 0.06, 0.10, 0.14), 2), "x", -0.25, 0.25, "primary", col, "fbs", d)], "fbody"),
        Matrix.Translation(V3((a.x, a.y, 0)))), col, "primary"), flag)
    L.add("plates", panel(shell(hm, -0.02, 0.03), region(rect(a.x - 1, a.x + 1, a.y - 1, a.y + 1), "z", 0.30, 0.6), 0.02, "foot_top"))
    H.bellows(L["seals"], a + V3((0, -0.02, 0.10)), a + V3((0, -0.02, 0.30)), 0.12, 0.11, folds=2, depth=0.02, n=10, col=PAL["seals"])
    H.ram(L["actuation"], a + V3((0, 0.22, 0.75)), a + V3((0, 0.30, 0.0)), 0.035, sleeve_col=PAL["actuation"], rod_col=BARE)
    L.flush(part)
    return part


# ------------------------------------------------------------------------------------------------------------ pelvis
def pelvis():
    part = H.Part("Pelvis", V3((0, HIP_Y, HIP_Z)), 40)
    L = Layers()
    core = pelvis_core(0.0, PAL["frame"])
    drums = [H.prism(ellipse(HIP_Y, HIP_Z, 0.21, 0.21, 12), "x", *span(s * 0.36, s * 0.60), "dark", V.shade(PAL["frame"], 1.15),
                     "hip") for s in (-1, 1)]
    core = H.fuse([core] + drums, "pelvis_frame", fillet=0.02, segments=1)
    pockets(core, [pocket(V3((0, 0.42, 3.10)), X_, Z_, Y_, 0.5, 0.3)])
    L.add("frame", core)
    ubar = P_("ubar")   # the U bracket hanging under the pelvis
    for s in (-1, 1):
        V.bar(ubar, V3((s * 0.30, -0.10, 2.82)), V3((s * 0.30, -0.10, 2.56)), 0.05, "dark", PAL["frame"], 6)
    V.bar(ubar, V3((-0.33, -0.10, 2.56)), V3((0.33, -0.10, 2.56)), 0.06, "dark", PAL["frame"], 6)
    L.add("frame", ubar)
    wsh = shell(lambda d=0.0, col=KHAKI, flag=0: wing_mass(d, col, flag), -0.05, 0.0)
    for s in (-1, 1):
        L.add("plates", panel(wsh, region(mx(rect(0.018, 0.9, 3.0, 3.7), s), "y", -1.0, 0.0), 0.035, "wing"))
    ssh = shell(lambda d=0.0, col=KHAKI, flag=0: skirt_mass(d, col, flag), -0.05, 0.0)
    L.add("plates", panel(ssh, region(rect(-0.6, 0.6, 2.6, 3.4), "y", -1.0, -0.2), 0.035, "skirt",
                          cuts=[H.cut_rect(V3((0, -0.52, 2.98)), X_, Z_, V3((0, -1, 0)), 0.36, 0.38, depth=0.03, corner=0.03,
                                           slope=0.6, mat="primary", col=V.shade(KHAKI, 0.85))]))
    K.stencil(L["service"], "|", V3((0.0, -0.485, 3.43)), X_, Z_, -Y_, 0.08, "secondary", MARK)
    for s in (-1, 1):
        V.bar(L["mounting"], V3((s * 0.16, -0.30, 3.12)), V3((s * 0.16, -0.20, 3.14)), 0.03, "sand", PAL["mounting"], 6)
        H.ram(L["actuation"], V3((s * 0.36, 0.30, 3.25)), V3((s * 0.26, 0.42, 3.66)), 0.035, sleeve_col=PAL["actuation"], rod_col=BARE)
    L.flush(part)
    return part


# ------------------------------------------------------------------------------------------------------------- torso
WAIST = V3((0.0, 0.10, 3.45))
FACE_N = V3((0, -0.726, 0.687)).normalized()      # the upper face's outward normal (nose -> brow slope)
FACE_T = V3((0, 0.687, 0.726)).normalized()       # up the face


def torso():
    part = H.Part("Torso", WAIST, 50)
    L = Layers()
    # frame: the pilot tub (the chest shrunk), the hull core with pockets, the waist drum, shoulder drums
    tub = mframe(chest_mass, -0.16, PAL["frame"])
    core = mframe(hull_mass, -0.12, PAL["frame"])
    waist = H.prism(ellipse(0.10, 0.10, 0.32, 0.32, 12), "z", 3.30, 3.78, "dark", V.shade(PAL["frame"], 1.15), "waist")
    sh_d = [H.prism(ellipse(SHOULDER[1], SHOULDER[2], 0.21, 0.21, 12), "x", *span(s * 0.80, s * 1.12), "dark",
                    V.shade(PAL["frame"], 1.15), "shoulder") for s in (-1, 1)]
    fr = H.fuse([tub, core, waist] + sh_d, "torso_frame", fillet=0.02, segments=1)
    pockets(fr, [H.cut_rect(V3((0, 1.15 - 0.12, 4.30)), X_, Z_, Y_, 0.5, 0.5, depth=0.22, corner=0.06, slope=0.2, mat="dark",
                            col=V.shade(PAL["frame"], 0.6))])     # the rear window onto the core
    L.add("frame", fr)
    # power: the core drum behind the rear window, conduits to the shoulders
    V.cyl(L["power"], (0, 0.86, 4.30), 0.22, 0.6, axis="z", n=12, mat="dark", col=PAL["power"])
    for s in (-1, 1):
        V.tube_along(L["power"], V.round_path([V3((s * 0.30, 0.55, 4.0)), V3((s * 0.62, 0.40, 3.92)), V3((s * 0.86, 0.2, 4.12)),
                                               V3((s * 0.95, 0.12, 4.30))], 0.12), 0.05, "dark", PAL["power"], n=6)
    # actuation: hoses from under the side boxes to the arms, twist rams at the waist
    for s in (-1, 1):
        for j, y in enumerate((0.0, 0.2)):
            V.pipe_run(L["actuation"], [V3((s * 0.50, y, 3.86)), V3((s * 0.80, y - 0.05, 3.80)), V3((s * 1.05, y, 3.95)),
                                        V3((s * 1.18, y, 4.15))], 0.03 - 0.006 * j, "trim", V.shade(PAL["actuation"], 1 - 0.1 * j),
                       bend=0.12, clamps=1)
        H.ram(L["actuation"], V3((s * 0.30, -0.10, 3.42)), V3((s * 0.42, 0.20, 3.74)), 0.03, sleeve_col=PAL["actuation"], rod_col=BARE)
    # mounting: hoops round the chest just under its plates (seen through the seams and under the chin)
    hoops_web(L, chest_mass(-0.085, PAL["mounting"]), [V3((0, y, 0)) for y in (-0.85, -0.45, -0.05)], Y_, 16, 0.015)
    # plates
    sh = shell(chest_mass, -0.06, 0.0)
    up = shell(chest_mass, -0.025, 0.035)
    ins = shell(chest_mass, -0.09, -0.03)
    vis = H.cut_rect(V3((-0.24, -1.05, 4.08)), X_, FACE_T, FACE_N, 0.20, 0.16, depth=0.12, corner=0.02, slope=0.3, mat="dark",
                     col=(0.07, 0.07, 0.075))
    L.add("plates", panel(up, region(rect(-0.44, 0.44, 3.88, 4.40, (0, 0, 0.06, 0.06)), "y", -1.6, -0.55), 0.045, "face",
                          cuts=[vis, groove(V3((0.06, -0.92, 4.22)), FACE_T, X_, FACE_N, 0.36)]))
    L.add("plates", panel(ins, region(rect(-0.9, 0.9, 3.70, 3.84), "y", -1.6, -0.55), 0.025, "nose_band"))
    for s in (-1, 1):
        L.add("plates", panel(sh, region(mx(rect(0.02, 0.9, 3.0, 3.66), s), "y", -1.6, -0.35), 0.04, "chin"))
        L.add("plates", panel(sh, region(mx(rect(0.48, 0.9, 3.88, 4.60), s), "y", -1.6, -0.62), 0.04, "cheek",
                              cuts=[groove(V3((s * 0.66, -0.89 - 0.02 * k, 4.06 + 0.10 * k)), V3((0.55 * s, 0.84, 0)).normalized(),
                                           Z_, V3((0.84 * s, -0.55, 0)).normalized(), 0.22, w=0.018) for k in (0, 1)]))
        L.add("plates", panel(sh, region(rect(-0.58, 0.30, 3.30, 4.50), "x", *span(s * 0.72, s * 1.0)), 0.04, "chest_side",
                              cuts=[groove(V3((s * 0.822, -0.15, 3.90)), Z_, Y_, s * X_, 0.8)]))
    L.add("plates", panel(up, region(rect(-0.45, 0.45, -0.66, 0.2), "z", 4.44, 4.9), 0.035, "brow"))
    # hull: the back face (a hatch), the hull top behind the hood is the hood itself
    hsh = shell(lambda d=0.0, col=KHAKI, flag=0: hull_mass(d, col, flag), -0.06, 0.0)
    L.add("plates", panel(hsh, region(rect(-0.6, 0.6, 3.6, 4.98), "y", 1.05, 1.7), 0.04, "hull_back",
                          cuts=[H.cut_rect(V3((0, 1.15, 4.32)), X_, Z_, Y_, 0.52, 0.52, depth=0.2, corner=0.06, slope=0.2, mat="dark",
                                           col=V.shade(PAL["frame"], 0.6))]))
    # the olive hood: a raised centre spine and two side panels, the brow overhang carries two lenses
    hm = lambda d=0.0, col=OLIVE, flag=0: hood_mass(d, col, flag)  # noqa: E731
    hsh2 = shell(hm, -0.05, 0.0, OLIVE)
    hup = shell(hm, -0.02, 0.03, OLIVE)
    L.add("plates", panel(hup, region(rect(-0.17, 0.17, -1.0, 1.3), "z", 4.6, 5.4, OLIVE), 0.035, "hood_spine"))
    for s in (-1, 1):
        L.add("plates", panel(hsh2, region(mx(rect(0.20, 0.6, -1.0, 1.3), s), "z", 4.6, 5.4, OLIVE), 0.03, "hood_side"))
    # side boxes: top (raised), outer side, front; their backs are the heat vents
    for s in (-1, 1):
        sm = lambda d=0.0, col=KHAKI, flag=0, s=s: sidebox_mass(s, d, col, flag)  # noqa: E731
        ssh = shell(sm, -0.05, 0.0)
        sup = shell(sm, -0.02, 0.03)
        L.add("plates", panel(sup, region(mx(rect(0.3, 1.2, -0.5, 1.5), s), "z", 4.66, 5.2), 0.035, "sbox_top"))
        L.add("plates", panel(ssh, region(rect(-0.5, 1.5, 3.8, 4.62), "x", *span(s * 0.88, s * 1.2)), 0.035, "sbox_side",
                              cuts=[groove(V3((s * 0.942, 0.45, 4.30)), Z_, Y_, s * X_, 0.6)]))
        L.add("plates", panel(ssh, region(mx(rect(0.3, 1.2, 3.8, 4.62), s), "y", -0.6, -0.16), 0.035, "sbox_front"))
        # heat: a deep vent in the box's back, louvres and a glowing floor (the one strong heat feature)
        c = V3((s * 0.69, 1.38, 4.37))
        vent = H.cut_rect(c, X_, Z_, Y_, 0.36, 0.52, depth=0.24, corner=0.03, slope=0.15, mat="dark", col=(0.07, 0.065, 0.06))
        box = sidebox_mass(s, 0.0, PAL["heat"])
        H.carve(box, [vent], bevel=0.015)
        H.carve(box, [H.prism(rect(-1.4, 1.4, 3.0, 5.4), "y", -1.0, 1.22, "dark", PAL["heat"], "vent_back")], bevel=0.0)
        L.add("heat", darken(box))
        V.louvres(L["heat"], c - Y_ * 0.06, X_, Z_, Y_, 0.34, 0.48, 4, "dark", V.shade(PAL["heat"], 0.8), tilt=0.5, t=0.02)
        f = V.surf_blk(L["heat"], c - Y_ * 0.23, X_, Z_, Y_, 0.32, 0.46, 0.01, "glow", (1.0, 0.45, 0.15))
        H.glow_flag(f, L["heat"])
    # seals: the waist boot
    H.bellows(L["seals"], V3((0, 0.1, 3.34)), V3((0, 0.1, 3.66)), 0.36, 0.34, folds=3, depth=0.025, n=14, col=PAL["seals"])
    # service: lifting eyes on the hood, rungs up the chest side, the hull number and the badge on the face
    for s in (-1, 1):
        H.lifting_eye(L["service"], V3((s * 0.30, 0.95, 5.06)), Z_, r=0.07, t=0.02)
    H.rungs(L["service"], V3((-0.84, -0.28, 3.55)), V3((-0.84, -0.28, 4.30)), 3, -X_, width=0.18, depth=0.07, r=0.016)
    fc = V3((0.20, -1.19, 3.86)) + FACE_T * 0.36 + FACE_N * 0.037
    K.stencil(L["service"], "03", fc, X_, FACE_T, FACE_N, 0.11, "secondary", MARK)
    bc = V3((0.14, -1.19, 3.86)) + FACE_T * 0.18 + FACE_N * 0.037
    V.surf_blk(L["service"], bc, X_, FACE_T, FACE_N, 0.16, 0.12, 0.006, "secondary", (0.26, 0.38, 0.62))   # the blue badge
    V.surf_blk(L["service"], bc, X_, FACE_T, FACE_N, 0.10, 0.07, 0.009, "secondary", MARK)
    # sensors: the vision block in its slot, two lenses under the hood's brow, an antenna
    V.blk(L["sensors"], tuple(V3((-0.24, -1.00, 4.06))), (0.14, 0.1, 0.12), "glass", (0.20, 0.30, 0.24), ch=0.01, mid=True)
    for s in (-1, 1):
        V.cyl(L["sensors"], (s * 0.11, -0.80, 4.74), 0.045, 0.08, axis="y", n=10, mat="dark", col=DARK)
        f = V.cyl(L["sensors"], (s * 0.11, -0.845, 4.74), 0.03, 0.01, axis="y", n=10, mat="glow", col=GLOW)
        H.glow_flag(f, L["sensors"])
    V.bar(L["sensors"], V3((-0.34, 1.0, 5.0)), V3((-0.38, 1.1, 5.75)), 0.012, "trim", BARE, 5)
    L.flush(part)
    return part


# --------------------------------------------------------------------------------------------------------------- arms
def arm_r():
    """The minigun arm (the mech's right, -X): a two-block receiver, the gatling forward, a rubber reel on top, two olive
    ammo drums under it, an olive back block, a handle pipe arcing over to the inner block."""
    s = -1
    part = H.Part("Arm_R", V3((s * SHOULDER[0], SHOULDER[1], SHOULDER[2])), 61)
    L = Layers()
    L.add("frame", recol(arm_link(s, d=-0.04), PAL["frame"], "dark"))
    shoulder_cap(L, s)
    rm = lambda d=0.0, col=KHAKI, flag=0: recv_mass(d, col, flag)  # noqa: E731
    L.add("frame", mframe(recv_mass, -0.10, PAL["frame"]))
    sh = shell(rm, -0.06, 0.0)
    up = shell(rm, -0.02, 0.035)
    ins = shell(rm, -0.09, -0.03)
    # the outer receiver: a raised top cap, a front panel, the outer face split in two (shingled), an inset belly
    L.add("plates", panel(up, region(rect(-2.6, -1.50, -0.5, 0.9), "z", 4.36, 4.8), 0.04, "recv_top"))
    L.add("plates", panel(sh, region(rect(-2.6, -1.50, 3.9, 4.36), "y", -0.6, -0.24), 0.04, "recv_front"))
    L.add("plates", panel(sh, region(rect(-0.4, 0.16, 3.9, 4.36), "x", -2.6, -2.22), 0.04, "recv_out_front",
                          cuts=[H.cut_rect(V3((-2.362, -0.10, 4.22)), Y_, Z_, -X_, 0.18, 0.12, depth=0.08, corner=0.02, slope=0.3,
                                           mat="dark", col=(0.08, 0.08, 0.085))]))
    L.add("plates", panel(up, region(rect(0.20, 0.9, 3.9, 4.36), "x", -2.6, -2.22), 0.04, "recv_out_back"))
    L.add("plates", panel(ins, region(rect(-2.6, -1.50, -0.4, 0.9), "z", 3.6, 4.08), 0.03, "recv_belly"))
    # the inner block: a panel with a window on its front, its inner face, its top
    L.add("plates", panel(up, region(rect(-1.66, -1.10, 3.5, 4.7), "y", -0.2, 0.08), 0.04, "inner_front",
                          cuts=[H.cut_rect(V3((-1.36, -0.015, 4.12)), X_, Z_, -Y_, 0.16, 0.22, depth=0.06, corner=0.02, slope=0.3,
                                           mat="dark", col=(0.10, 0.10, 0.10))]))
    L.add("plates", panel(sh, region(rect(-0.1, 0.8, 3.5, 4.7), "x", -1.30, -1.0), 0.035, "inner_side"))
    L.add("plates", panel(sh, region(rect(-1.80, -1.10, 0.08, 0.9), "z", 4.5, 4.8), 0.035, "inner_top"))
    # the olive back block (its own mass, two panels)
    bm_ = lambda d=0.0, col=OLIVE, flag=0: back_block(col, d, flag)  # noqa: E731
    bsh = shell(bm_, -0.05, 0.0, OLIVE)
    L.add("frame", darken(recol(back_block(PAL["frame"], -0.06), PAL["frame"])))
    L.add("plates", panel(bsh, region(rect(-2.5, -1.4, 3.5, 4.12), "y", 0.6, 1.2, OLIVE), 0.03, "back_low"))
    L.add("plates", panel(bsh, region(rect(-2.5, -1.4, 4.16, 4.7), "y", 0.6, 1.2, OLIVE), 0.03, "back_up"))
    # weapon: the gatling, the reel, the drums
    g = P_("gatling")
    gatling(g, DARK)
    L.add("weapon", g)
    reel = P_("reel")
    V.cyl(reel, REEL, 0.21, 0.48, axis="y", n=16, mat="tyre", col=RUBBER)
    for dy in (-0.16, 0.0, 0.16):
        V.cyl(reel, (REEL[0], REEL[1] + dy, REEL[2]), 0.222, 0.05, axis="y", n=16, mat="tyre", col=V.shade(RUBBER, 1.3))
    V.cyl(reel, (REEL[0], REEL[1] - 0.26, REEL[2]), 0.09, 0.05, axis="y", n=8, mat="trim", col=OLIVE)
    V.blk(reel, (REEL[0], REEL[1] - 0.29, REEL[2] - 0.02), (0.08, 0.03, 0.14), "trim", OLIVE, ch=0.01, mid=True)
    for y in (-0.04, 0.28):
        V.bar(reel, V3((REEL[0] - 0.26, y, 4.40)), V3((REEL[0] + 0.26, y, 4.40)), 0.03, "dark", DARK, 6)   # the cradle
    L.add("weapon", reel)
    drums = P_("drums")
    for y in (0.0, 0.32):
        V.cyl(drums, (DRUM[0], y, DRUM[1]), 0.25, 0.30, axis="y", n=16, mat="primary", col=OLIVE)
        V.cyl(drums, (DRUM[0], y, DRUM[1]), 0.262, 0.04, axis="y", n=16, mat="trim", col=V.shade(OLIVE, 0.75))
    V.cyl(drums, (DRUM[0], -0.16, DRUM[1]), 0.10, 0.03, axis="y", n=8, mat="trim", col=V.shade(OLIVE, 0.6))
    L.add("weapon", drums)
    # actuation: the belt from the drums up into the receiver, the handle pipe, an elbow ram
    belt = V.round_path([V3((-2.24, 0.16, 3.42)), V3((-2.30, 0.10, 3.70)), V3((-2.22, -0.02, 3.96))], 0.1)
    V.tube_along(L["actuation"], belt, 0.045, "trim", (0.62, 0.55, 0.40), n=6)
    for p in belt[::2]:
        V.cyl(L["actuation"], tuple(p), 0.06, 0.03, axis="z", n=6, mat="trim", col=(0.55, 0.48, 0.34))
    V.pipe_run(L["actuation"], [V3((-1.42, -0.02, 4.62)), V3((-1.42, -0.30, 4.70)), V3((-1.42, -0.62, 4.44)),
                                V3((-1.42, -0.62, 4.0)), V3((-1.62, -0.56, 3.90))], 0.035, "trim", V.shade(PAL["actuation"], 0.8),
               bend=0.12, clamps=0)
    H.ram(L["actuation"], V3((-1.10, 0.36, 4.06)), V3((-1.40, 0.50, 4.28)), 0.03, sleeve_col=PAL["actuation"], rod_col=BARE)
    H.bellows(L["seals"], V3((-0.94, 0.10, 4.34)), V3((-1.10, 0.10, 4.34)), 0.18, 0.18, folds=2, depth=0.02, n=12, col=PAL["seals"])
    # service: the receiver's stencils and a hazard band over the gun
    K.stencil(L["service"], "03", V3((-2.37, 0.48, 4.16)), -Y_, Z_, -X_, 0.13, "secondary", MARK)
    K.stencil(L["service"], "220", V3((-1.36, -0.005, 4.44)), X_, Z_, -Y_, 0.06, "secondary", MARK)
    K.hazard(L["service"], V3((-1.96, -0.365, 4.30)), X_, Z_, -Y_, 0.50, 0.07, 6, RED, MARK)
    L.flush(part)
    return part


def arm_l():
    """The rocket arm (the mech's left, +X): a tall octagonal box, a 2 x 5 rack recessed in its face, a collar where the arm
    enters, a big hub on the outer face, an elevation block under it."""
    s = 1
    part = H.Part("Arm_L", V3((s * SHOULDER[0], SHOULDER[1], SHOULDER[2])), 62)
    L = Layers()
    L.add("frame", recol(arm_link(s, d=-0.04), PAL["frame"], "dark"))
    shoulder_cap(L, s)
    L.add("frame", recol(rocket_under(), PAL["frame"], "dark"))
    L.add("frame", H.prism(ellipse(-0.02, 4.50, 0.28, 0.28, 14), "x", 1.40, 1.55, "dark", PAL["frame"], "collar"))
    hub = H.prism(ellipse(-0.06, 4.52, 0.33, 0.33, 16), "x", 2.25, 2.37, "dark", V.shade(PAL["frame"], 1.2), "hub")
    H.carve(hub, [H.cut_rect(V3((2.37, -0.06, 4.52)), Y_, Z_, X_, 0.40, 0.40, depth=0.06, corner=0.2, slope=0.3, mat="dark",
                             col=V.shade(PAL["frame"], 0.7))], bevel=0.01)
    L.add("frame", hub)
    V.cyl(L["actuation"], (2.36, -0.06, 4.52), 0.12, 0.08, axis="x", n=12, mat="trim", col=PAL["actuation"])
    for k in range(8):
        a = 2 * math.pi * k / 8
        V.cyl(L["actuation"], (2.37, -0.06 + math.cos(a) * 0.26, 4.52 + math.sin(a) * 0.26), 0.025, 0.04, axis="x", n=6,
              mat="trim", col=BARE)
    rm = lambda d=0.0, col=KHAKI, flag=0: rocket_mass(d, col, flag)  # noqa: E731
    L.add("frame", mframe(rocket_mass, -0.12, PAL["frame"]))
    sh = shell(rm, -0.06, 0.0)
    up = shell(rm, -0.02, 0.035)
    face_cut = H.cut_rect(V3((1.90, -0.86, 4.58)), X_, Z_, -Y_, 0.56, 1.10, depth=0.18, corner=0.08, slope=0.15, mat="dark",
                          col=(0.08, 0.08, 0.085))
    L.add("plates", panel(sh, region(rect(1.3, 2.5, 3.8, 5.4), "y", -1.2, -0.62), 0.045, "rb_face", cuts=[face_cut]))
    L.add("plates", panel(up, region(rect(1.3, 2.5, -0.58, 0.9), "z", 5.12, 5.6), 0.04, "rb_top",
                          cuts=H.cut_vents(V3((1.72, -0.40, 5.235)), Y_, X_, Z_, 0.05, 0.22, 3, gap=0.6, depth=0.04, mat="dark",
                                           col=V.shade(PAL["heat"], 0.8))))
    L.add("plates", panel(sh, region(rect(-0.58, 0.05, 3.8, 5.08), "x", 2.18, 2.6), 0.04, "rb_out_front"))
    L.add("plates", panel(up, region(rect(0.09, 0.9, 3.8, 5.08), "x", 2.18, 2.6), 0.04, "rb_out_back"))
    L.add("plates", panel(sh, region(rect(-0.58, 0.9, 3.8, 5.08), "x", 1.2, 1.62), 0.035, "rb_inner",
                          cuts=[groove(V3((1.538, 0.10, 4.58)), Z_, Y_, -X_, 0.9)]))
    L.add("plates", panel(sh, region(rect(1.3, 2.5, 3.8, 5.08), "y", 0.62, 1.2), 0.035, "rb_back"))
    L.add("plates", panel(sh, region(rect(1.3, 2.5, -0.58, 0.9), "z", 3.6, 4.06), 0.03, "rb_belly"))
    rk = P_("rockets")
    rockets(rk)
    L.add("weapon", rk)
    # service: hazard stripes down the face's inner rim, a stencil on the box side, a lamp under the face
    K.hazard(L["service"], V3((1.585, -0.872, 4.58)), X_, Z_, -Y_, 0.05, 0.9, 7, RED, MARK)
    K.stencil(L["service"], "03", V3((2.275, 0.50, 4.90)), -Y_, Z_, X_, 0.14, "secondary", MARK)
    V.cyl(L["sensors"], (2.0, -0.56, 3.86), 0.06, 0.12, axis="y", n=10, mat="dark", col=DARK)
    f = V.cyl(L["sensors"], (2.0, -0.625, 3.86), 0.048, 0.01, axis="y", n=10, mat="glow", col=GLOW)
    H.glow_flag(f, L["sensors"])
    H.ram(L["actuation"], V3((1.16, 0.36, 4.06)), V3((1.50, 0.30, 3.86)), 0.03, sleeve_col=PAL["actuation"], rod_col=BARE)
    H.bellows(L["seals"], V3((0.94, 0.10, 4.34)), V3((1.10, 0.10, 4.34)), 0.18, 0.18, folds=2, depth=0.02, n=12, col=PAL["seals"])
    L.flush(part)
    return part


# ================================================================================================================ build
PARENT = {"Pelvis": None, "Torso": "Pelvis", "Arm_L": "Torso", "Arm_R": "Torso", "Thigh_L": "Pelvis", "Thigh_R": "Pelvis",
          "Shin_L": "Thigh_L", "Shin_R": "Thigh_R", "Meta_L": "Shin_L", "Meta_R": "Shin_R", "Foot_L": "Meta_L", "Foot_R": "Meta_R"}
ORDER = ["Pelvis", "Torso", "Arm_L", "Arm_R", "Thigh_L", "Thigh_R", "Shin_L", "Shin_R", "Meta_L", "Meta_R", "Foot_L", "Foot_R"]


def joints():
    j = {"Pelvis": V3((0, HIP_Y, HIP_Z)), "Torso": WAIST}
    for s, sfx in ((1, "_L"), (-1, "_R")):
        j["Thigh" + sfx], j["Shin" + sfx], j["Meta" + sfx], j["Foot" + sfx] = hip(s), knee(s), hock(s), ankle(s)
        j["Arm" + sfx] = V3((s * SHOULDER[0], SHOULDER[1], SHOULDER[2]))
    return j


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


def build_parts():
    parts = [pelvis(), torso(), arm_l(), arm_r()]
    for s in (1, -1):
        parts += [thigh(s), shin(s), meta(s), foot(s)]
    return parts


def build_full(layers=None):
    parts = build_parts()
    pieces = [pc for pt in parts for pc in pt.pieces()]
    K.bake_all(pieces, PAL, 3, ao_rays=12, ao_dist=0.5, wear=0.3, dust=0.2)
    root, emp, J = hierarchy("Rampart_v2")
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


def build_mass():
    root, emp, J = hierarchy("Rampart_v2_mass")
    tris, objs = {}, []
    for k, solids in mass_layer().items():
        pc = V.Piece(k + "__Mass", J[k], 1)
        for S in solids:
            H.commit(S, pc)
        K.bake_all([pc], PAL, 1, ao_rays=4, wear=0.0, dust=0.0, deep=2.0)
        objs.append(K.emit(pc, emp[k], V3()))
        tris[k] = pc.tris
    return root, objs, {"tris": tris, "tris_total": sum(tris.values()), "hskit": H.report()["stats"]}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--mass", action="store_true")
    ap.add_argument("--out", default=os.path.join(os.environ.get("TEMP", "."), "rampart_v2_out"))
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    V.clear_scene()
    root, objs, info = build_mass() if a.mass else build_full()
    name = "MechStudy_Rampart_v2" + ("_mass" if a.mass else "")
    V.export_fbx(root, os.path.join(a.out, name + ".fbx"))
    with open(os.path.join(a.out, name + ".json"), "w") as f:
        json.dump(info, f, indent=1)
    print("TRIS", info["tris_total"], json.dumps(info.get("tris_by_part", info["tris"])))
    print("HSSTATS", json.dumps(H.report()["stats"]))


if __name__ == "__main__":
    main()
