"""Rampart walker v4: the mech-modeling skill v0.6's run on Keith's v3 review (2026-10-22).

    blender -b --factory-startup -P tools/blender/mechs/studies/rampart/rampart_v4.py -- [--mass] [--pose rest|stance]
        [--out DIR]

What changed from v3 (Keith: "another leap forward"; the final model must live up to the mass):
  * signature form kept whole: the chest's one front plate in an upside-down U (the face_shield, a concave flow region
    wrapping the nose and both sides of the chin round a dark inset arch); seams go round it, never through it.
  * seams follow the flow (H.flow_region, slanted and V / arc edges): the thigh front is one plate with a V edge over the
    knee, slanted prow and side-box seams, shin and pelvis cut along their forms.
  * pauldrons: a lofted plate per side wraps the side box's top-front corner and runs down over the cheek onto the chest.
  * never knock-kneed: knee x 0.34 and hock 0.40 hip-local (v3 0.18 / 0.32), the thigh sheared outward down its length;
    the knee sits outboard of the hip-ankle line at rest and in the stance (H.leg_line, in the build json).
  * legs get technical parts (flat machinery is allowed): knee servo housings, shin side links, a hock servo, ankle rams
    and trunnion; the knee cap is a shaped disc shell round the knee drum, not a lump.
  * feet are machines: a low wedge, two splayed toes with a split between them, a heel spur, toe hinges and rams, tread pads.
  * a real stance (H.solve on the joint chain): weight on the left leg, a stride, pelvis shifted and rolled, guns raised
    unevenly. The meshes stay at rest under the joint empties.
  * minigun barrels 1.35 m in lighter gunmetal; drums and reel recoloured; the chest flange hoop (v3's halo) is gone.

v3's notes follow.

Reference: the Tripo3D model Keith supplied (art-refs/mech-reference/rampart/, never committed), measured at mechHeight 5.2
with plane sections at many stations through every bulge and taper (scratchpad stations.json); paint and markings from the
painting. v2 (rampart_v2.py) and v1 (rampart.py) supply outline and shell / region / panel helpers.

What changed from v2 (Keith's review):
  * masses are lofts through measured section stations (H.loft), not boxes: a barrel thigh with an outer prow, a lofted chest
    (pike nose, V chin, faceted cheeks), one rear hull for the side boxes and core, a lofted hood; each big mass then carries
    4-7 cuts (scoops, steps, chamfer slabs, recesses), all offset-consistent so every shell fits.
  * the lower-leg "cannon" (metatarsal + pod) is one lofted mass carried 0.56 m past the hock as an olive horn, with a heel
    spur at the ankle: the hock pivot sits inside the mass, not at its end.
  * joints splay outward down the leg like the reference (feet at x 1.28); bigger feet (0.6 x 1.3).
  * the minigun is a slimmer chamfered receiver with a 0.33 m barrel cluster, three thick rings, 0.27 m drums.
  * tank plating: fronts thickest and raised, sides and backs thinner, pike and V faces, add-on bricks (tagged addon), darker
    inset sub-panels and small overlapping shingles on every big mass.
  * deep flange ribs in deliberate plate gaps; pipe bundles down the leg backs, the cannon sides, under the side boxes and
    into the weapons. Frame dark olive, seals mid grey (no near-black holes).
  * --pose stance|rest: the part empties are rotated for a stance like the reference's; the meshes stay at rest.
  * build info carries the axis-aligned plate share per part (H.axis_aligned_share).

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

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import hskit as H  # noqa: E402
import mil_kit as K  # noqa: E402
from mil_kit import V  # noqa: E402
import rampart as HD1  # noqa: E402  (v1: shell, region, panel, Layers, groove, roundel, pocket helpers)
from rampart_v2 import ccw, mx, rrect, ellipse, hull2d, seg_profile, flagall, recol  # noqa: E402

V3 = Vector
X_, Y_, Z_ = V3((1, 0, 0)), V3((0, 1, 0)), V3((0, 0, 1))

# ----------------------------------------------------------------------------------------------------------- palette
KHAKI = (0.63, 0.57, 0.42)        # the painting's plates
KHAKI_D = (0.49, 0.45, 0.33)      # darker inset sub-panels (Keith: one flat khaki everywhere reads as a toy)
KHAKI2 = (0.55, 0.52, 0.38)       # the greener lower-leg guards
OLIVE = (0.42, 0.43, 0.30)        # hood, horn, drums
OLIVE_D = (0.33, 0.34, 0.24)
BROWN = (0.36, 0.27, 0.20)        # the riveted pads in the thigh recess
FRAME = (0.25, 0.25, 0.205)       # dark olive frame (v2's near-black read as holes)
BARE = (0.58, 0.57, 0.52)
MARK = (0.88, 0.85, 0.74)
RED = (0.70, 0.17, 0.12)
GLOW = (1.0, 0.72, 0.30)
RUBBER = (0.17, 0.165, 0.155)
PAL = H.layer_palette(FRAME, BARE, KHAKI, GLOW, mounting=(0.80, 0.78, 0.71))
PAL.update({"bare": BARE, "dust": (0.70, 0.60, 0.45), "seals": (0.30, 0.29, 0.27)})
GREY = (0.62, 0.62, 0.62)
HAS_WEAPON_LAYER = True
POSE = {"mode": "rest"}

# ------------------------------------------------------------------------------------------------------------ joints
# hip-local (x outward, y, z from the hip); the leg splays outward down its length like the reference
HIP_X, HIP_Y, HIP_Z = 0.78, 0.0, 3.05
K_ = (0.34, -0.21, -1.67)          # knee drum, world z 1.38, x 1.12: outboard of the hip-ankle line (v3 0.18 read knock-kneed)
HK_ = (0.40, 0.50, -1.90)          # hock (the reverse joint), inside the cannon's top
A_ = (0.50, 0.09, -2.78)           # ankle, world x 1.28
SHOULDER = (1.02, 0.10, 4.34)
TH_SHEAR = 0.10 / 1.60             # the thigh leans outward down its length: +0.10 m at the knee (hip-local x per metre down)


def shear(s):
    """The thigh's outward lean as a hip-local shear (x grows going down), applied with the leg matrix."""
    return Matrix(((1, 0, -s * TH_SHEAR, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))


def hl(s, p):
    return V3((s * p[0], p[1], p[2]))


def hip(s):
    return V3((s * HIP_X, HIP_Y, HIP_Z))


def knee(s):
    return hip(s) + hl(s, K_)


def hock(s):
    return hip(s) + hl(s, HK_)


def ankle(s):
    return hip(s) + hl(s, A_)


def leg_M(s):
    return Matrix.Translation(hip(s))


def sym(half):
    """A symmetric outline from its +x half."""
    return ccw(hull2d(list(half) + [(-x, y) for x, y in half]))


def P_(name="s"):
    return H.Solid(name)


CACHE = {}


def cached(fn):
    def w(*a, **kw):
        key = (fn.__name__, a, tuple(sorted(kw.items())))
        if key not in CACHE:
            CACHE[key] = fn(*a, **kw)
        return CACHE[key].copy(fn.__name__)
    w.__name__ = fn.__name__
    return w


def slab(p, n, d, w=4.0, h=4.0, u=None, depth=0.002, col=GREY):
    """A chamfer slab offset-consistent with mass(d): the plane moves out by d."""
    n = V3(n).normalized()
    u = V3(u) if u is not None else (X_ if abs(n.x) < 0.9 else Y_)
    u = (u - n * u.dot(n)).normalized()
    if w < 3.0:          # a limited footprint has side walls: they move with the offset like a recess's, or shells share them
        w, h = max(0.02, w - 2 * d), max(0.02, h - 2 * d)
    return H.cut_slab(V3(p) + n * d, n, u, w, h, depth, mat="primary", col=col)


def frame3(u, v, n):
    """u, v made perpendicular to n (v keeps its direction in the plane, u = v x n flipped to follow the given u)."""
    n = V3(n).normalized()
    v = (V3(v) - n * V3(v).dot(n)).normalized()
    uu = v.cross(n).normalized()
    return (uu if uu.dot(V3(u)) >= 0 else -uu), v, n


def scoop(c, u, v, n, w, h, depth, d, corner=0.04, slope=0.4, col=GREY):
    """A recess cutter offset-consistent with mass(d): the floor moves out by d, the outline shrinks by d."""
    u, v, n = frame3(u, v, n)
    return H.cut_rect(V3(c) + n * d, u, v, n, max(0.02, w - 2 * d), max(0.02, h - 2 * d), depth=depth, corner=corner,
                      slope=slope, mat="primary", col=col)


# =============================================================================================================== MASSES
# ---- thigh: a barrel loft through the reference's z stations (hip-local), an outer prow, then six cuts
#        world z,  xi,    xo,   ya,   xfo,   yf,   xbo,  yb      (x outward from the hip, y; measured stations.json)
TH_ST = [(1.45, 0.06, 0.46, 0.00, 0.30, -0.36, 0.34, 0.06),
         (1.55, 0.04, 0.52, -0.02, 0.36, -0.40, 0.40, 0.12),
         (1.70, 0.00, 0.58, -0.04, 0.40, -0.43, 0.42, 0.24),
         (2.05, -0.07, 0.66, -0.05, 0.42, -0.44, 0.42, 0.44),
         (2.45, -0.13, 0.64, -0.03, 0.42, -0.42, 0.36, 0.53),
         (2.85, -0.18, 0.55, 0.00, 0.36, -0.36, 0.30, 0.56),
         (3.10, -0.22, 0.42, 0.05, 0.30, -0.27, 0.24, 0.48),
         (3.22, -0.20, 0.34, 0.06, 0.24, -0.20, 0.20, 0.42),
         (3.30, -0.12, 0.22, 0.12, 0.14, -0.02, 0.12, 0.30)]


def th_outline(s, xi, xo, ya, xfo, yf, xbo, yb):
    pts = [(xi + 0.05, yf + 0.035), ((xi + xfo) / 2, yf), (xfo, yf + 0.035),          # a shallow pike front (no flat face)
           (xfo + 0.55 * (xo - xfo), yf + 0.22 * (ya - yf)), (xo, ya),               # front-outer facet, the prow apex
           (xo - 0.1 * (xo - xbo), ya + 0.5 * (yb - ya)), (xbo + 0.45 * (xo - xbo), ya + 0.8 * (yb - ya)), (xbo, yb),
           (xi + 0.05, yb - 0.03), (xi, yb - 0.12), (xi, yf + 0.12)]
    return ccw(hull2d([(s * x, y) for x, y in pts]))


REC_N = V3((0.96, 0.28, 0.0)).normalized()        # the outer-back facet's normal (x outward), the recess sits on it
REC_C = (0.615, 0.13, -0.78)                      # the recess centre on that facet (hip-local, x outward)
REC_W, REC_H, REC_D = 0.30, 0.92, 0.10


def thigh_cuts(s, d, col=GREY):
    F = lambda x, y, z: V3((s * x, y, z))  # noqa: E731
    n_rec = V3((s * REC_N.x, REC_N.y, 0)).normalized()
    u_rec = Z_.cross(n_rec).normalized()
    return [
        scoop(F(*REC_C), u_rec, Z_, n_rec, REC_W, REC_H, REC_D, d, corner=0.06, slope=0.25, col=col),   # outer recess
        scoop(F(0.20, -0.36, -1.55), X_, V3((0, 0.8, -0.6)), V3((0, -0.6, -0.8)), 0.52, 0.26, 0.07, d, col=col),  # knee scoop
        slab(F(0.0, -0.20, 0.12), (0, -0.6, 0.8), d, col=col),                       # top-front chamfer
        scoop(F(-0.215, 0.05, -0.02), Y_, Z_, -s * X_, 0.42, 0.34, 0.05, d, col=col),  # inner hip scoop
        slab(F(0.0, 0.20, -1.40), (0, 0.6, -0.8), d, col=col),                       # lower back chamfer
        slab(F(0.15, -0.41, -1.27), (0, -1, 0), d, w=2.0, h=0.56, u=X_, depth=0.028, col=col),   # mid-front step
    ]


@cached
def thigh_mass(s, d=0.0, col=GREY, flag=0, cuts=True):
    m = H.loft([(zw - HIP_Z, th_outline(s, *r)) for zw, *r in TH_ST], "z", d, "primary", col, "thigh", flag)
    if cuts:
        H.carve(m, thigh_cuts(s, d, col), bevel=0.0)
        flagall(m, flag)
    return m


# ---- links: a bone between two joints, in its own frame (x lateral, y along the bone, z = n, back), moved into hip-local
def link_frame(s, a, b):
    A, B = hl(s, a), hl(s, b)
    u = (B - A).normalized()
    w = (X_ - u * u.x).normalized()
    n = w.cross(u).normalized()
    M = Matrix(((w.x, u.x, n.x, A.x), (w.y, u.y, n.y, A.y), (w.z, u.z, n.z, A.z), (0, 0, 0, 1)))
    return M, (B - A).length


def link_mass(s, a, b, ra, rb, hw, ch, d=0.0, col=GREY, flag=0, mat="primary", name="link"):
    M, L = link_frame(s, a, b)
    R = max(ra, rb)
    side = H.prism(seg_profile((0, 0), (L, 0), ra, rb), "x", -hw, hw, mat, col, name + "_s", d, flag)
    sec = H.prism(rrect(-hw, hw, -R, R, ch, 1), "y", -R - 0.4, L + R + 0.4, mat, col, name + "_x", d, flag)
    return H.xform(H.intersect([side, sec], name), M)


@cached
def shin_mass(s, d=0.0, col=GREY, flag=0):
    return link_mass(s, K_, HK_, 0.19, 0.20, 0.20, 0.07, d, col, flag, name="shin")


# ---- the cannon: metatarsal + pod as one loft along the bone (hock -> ankle), carried 0.56 m past the hock as a horn
#           t (along the bone from the hock), half width, q front, q back (q = n, pointing back)
CAN_ST = [(-0.56, 0.08, 0.03, 0.19),
          (-0.46, 0.15, -0.05, 0.31),
          (-0.22, 0.21, -0.14, 0.35),
          (0.05, 0.23, -0.18, 0.35),
          (0.40, 0.22, -0.17, 0.28),
          (0.70, 0.19, -0.15, 0.24),
          (0.88, 0.15, -0.12, 0.20),
          (0.97, 0.10, -0.02, 0.25),          # the heel spur: the cannon carried on past the ankle, back and down
          (1.05, 0.06, 0.12, 0.30)]


def can_outline(hw, q0, q1, c0=0.06, c1=0.11):
    c1 = min(c1, (q1 - q0) * 0.45, hw * 0.8)
    c0 = min(c0, (q1 - q0) * 0.3, hw * 0.6)
    return ccw([(-hw + c0, q0), (hw - c0, q0), (hw, q0 + c0), (hw, q1 - c1), (hw - c1, q1), (-hw + c1, q1), (-hw, q1 - c1),
                (-hw, q0 + c0)])


def cannon_cuts(d, col=GREY):
    """In the bone frame: a front channel (pistons), recesses down both sides, a horn wedge, a heel step."""
    return [
        scoop(V3((0, 0.38, -0.17)), Y_, X_, -Z_, 0.62, 0.20, 0.10, d, corner=0.03, slope=0.3, col=col),     # front channel
        scoop(V3((0.225, 0.30, 0.06)), Y_, Z_, X_, 0.50, 0.16, 0.035, d, corner=0.04, slope=0.6, col=col),   # outer side recess
        scoop(V3((-0.225, 0.30, 0.06)), Y_, Z_, -X_, 0.50, 0.16, 0.035, d, corner=0.04, slope=0.6, col=col),  # inner side recess
        slab(V3((0, -0.50, 0.10)), (0, -0.55, -0.83), d, col=col),                      # horn: the front-top wedge face
        slab(V3((0, 0.80, 0.22)), (0, 0.45, 0.89), d, col=col),                         # heel step on the back
    ]


@cached
def cannon_mass(s, d=0.0, col=GREY, flag=0, cuts=True):
    M, L = link_frame(s, HK_, A_)
    m = H.loft([(t, can_outline(hw, q0, q1)) for t, hw, q0, q1 in CAN_ST], "y", d, "primary", col, "cannon", flag)
    if cuts:
        H.carve(m, cannon_cuts(d, col), bevel=0.0)
    flagall(m, flag)
    return H.xform(m, M)


@cached
def meta_bone(s, d=0.0, col=GREY, flag=0):
    return link_mass(s, HK_, A_, 0.16, 0.13, 0.15, 0.05, d, col, flag, name="meta")


# ---- foot (world, on the ground under the ankle): a feet-are-machines rebuild (skill 6b). A low wedge body, two front
#      toes splayed out +-14 deg with a clear split between them, a heel spur; the sole sits 3 cm up on rubber tread pads.
SOLE = 0.03
TOE_S = [(-0.60, 0.0), (-0.16, 0.0), (0.03, 0.09), (0.03, 0.22), (-0.14, 0.27), (-0.46, 0.23), (-0.64, 0.13)]   # (y, z)
TOE_W, TOE_YAW, TOE_DX, TOE_Y = 0.20, 14.0, 0.135, -0.20
HEEL_S = [(0.0, 0.0), (0.56, 0.0), (0.56, 0.06), (0.30, 0.19), (0.02, 0.26)]
FOOT_DX = 0.05      # the foot sits a touch outboard of the ankle (the reference)


def toe_M(s, k):
    """Toe k (0 inner, 1 outer): its root frame on the sole (the toe runs along -y, x across)."""
    a = ankle(s)
    sx = (-1, 1)[k] * s
    return (Matrix.Translation(V3((a.x + s * FOOT_DX + sx * TOE_DX, a.y + TOE_Y, SOLE))) @
            Matrix.Rotation(math.radians(TOE_YAW * sx), 4, "Z"))     # tips splay outward


def toe_solid(s, k, d=0.0, col=GREY, mat="dark", flag=0):
    t = H.prism(ccw(TOE_S), "x", -TOE_W / 2, TOE_W / 2, mat, col, "toe", d, flag)
    return H.xform(t, toe_M(s, k))


def foot_body(s, d=0.0, col=GREY, mat="dark", flag=0):
    a = ankle(s)
    b = H.intersect([H.prism(rrect(-0.25, 0.25, 0.0, 0.33, (0.05, 0.05, 0.11, 0.11), 2), "y", -0.36, 0.30, mat, col, "fb", d, flag),
                     H.prism(ccw([(-0.36, 0.0), (0.30, 0.0), (0.30, 0.22), (0.14, 0.33), (-0.12, 0.33), (-0.36, 0.15)]), "x",
                             -0.25, 0.25, mat, col, "fbs", d, flag)], "foot_body")
    return H.xform(b, Matrix.Translation(V3((a.x + s * FOOT_DX, a.y, SOLE))))


def heel_solid(s, d=0.0, col=GREY, mat="dark", flag=0):
    a = ankle(s)
    return H.xform(H.prism(ccw(HEEL_S), "x", -0.09, 0.09, mat, col, "heel", d, flag),
                   Matrix.Translation(V3((a.x + s * FOOT_DX, a.y + 0.12, SOLE))))


def foot_mass(s, col=GREY, mat="dark"):
    a = ankle(s)
    parts = [toe_solid(s, k, col=col, mat=mat) for k in range(2)]
    drum = H.xform(H.prism(ellipse(0, 0, 0.15, 0.15, 10), "x", -0.17, 0.17, mat, col, "ankle_drum"), Matrix.Translation(a))
    return H.fuse([foot_body(s, col=col, mat=mat), heel_solid(s, col=col, mat=mat)] + parts + [drum], "foot", fillet=0.015,
                  segments=1)


# ---- torso (world). The chest: a loft through the reference's y stations (+x halves of (x, z))
CH_ST = [(-1.20, [(0.10, 3.70), (0.12, 3.74), (0.10, 3.78)]),
         (-1.12, [(0.15, 3.60), (0.27, 3.76), (0.26, 3.86), (0.22, 3.91)]),
         (-1.04, [(0.18, 3.52), (0.29, 3.64), (0.34, 3.84), (0.33, 3.96), (0.26, 4.04)]),
         (-0.96, [(0.18, 3.44), (0.28, 3.56), (0.45, 3.85), (0.46, 3.98), (0.32, 4.14), (0.18, 4.22)]),
         (-0.88, [(0.19, 3.35), (0.52, 3.70), (0.66, 3.87), (0.64, 3.99), (0.45, 4.20), (0.25, 4.34), (0.0, 4.38)]),
         (-0.80, [(0.20, 3.21), (0.62, 3.64), (0.74, 3.84), (0.73, 4.02), (0.44, 4.34), (0.24, 4.42)]),
         (-0.64, [(0.30, 3.11), (0.76, 3.64), (0.78, 3.80), (0.76, 4.10), (0.58, 4.30), (0.38, 4.49)]),
         (-0.48, [(0.42, 3.11), (0.78, 3.62), (0.82, 3.90), (0.79, 4.24), (0.42, 4.53), (0.14, 4.62)]),
         (0.30, [(0.40, 3.36), (0.78, 3.62), (0.82, 3.90), (0.80, 4.24), (0.42, 4.53), (0.14, 4.60)])]
FACE_N = V3((0, -0.75, 0.66)).normalized()      # the long sloped face, nose -> brow
FACE_T = V3((0, 0.66, 0.75)).normalized()       # up the face


# the signature form (skill 7b): the face shield, one plate in an upside-down U. +x halves in the front view (x, z), from
# the top centre round the outside and up the arch to its apex; sym_concave mirrors them into one (concave) outline.
SHIELD_HALF = [(0.0, 4.46), (0.36, 4.46), (0.44, 4.30), (0.58, 3.98), (0.62, 3.70), (0.54, 3.36), (0.40, 3.12), (0.22, 3.12)]
ARCH_HALF = [(0.20, 3.30), (0.17, 3.47), (0.10, 3.59), (0.0, 3.63)]
ARCH_INSET = [(0.0, 3.595), (0.07, 3.555), (0.135, 3.45), (0.165, 3.29), (0.165, 3.0), (0.0, 3.0)]
SHIELD_EDGE = SHIELD_HALF[1:7]        # the shield's outer edge: the cheek and chin-side seams follow it at a constant gap


def sym_concave(half):
    """A symmetric, possibly concave outline from its +x half (an ordered path that starts and ends on x = 0)."""
    mir = [(-x, z) for x, z in reversed(half)]
    if abs(half[0][0]) < 1e-6 and abs(half[-1][0]) < 1e-6:
        mir = mir[1:-1]
    return ccw(list(half) + mir)


# the pauldrons: a lofted plate per side wrapping the side box's top-front corner, running forward and down over the cheek
# onto the chest (Keith: shoulder plates flow down onto the chest). +x halves (x, z) at y stations.
PAUL_ST = [(0.32, [(0.74, 4.68), (0.96, 4.64), (1.04, 4.44), (1.00, 4.30), (0.80, 4.42)]),
           (-0.36, [(0.66, 4.64), (0.95, 4.58), (1.03, 4.32), (0.99, 4.08), (0.80, 4.22)]),
           (-0.62, [(0.60, 4.48), (0.86, 4.38), (0.93, 4.08), (0.88, 3.88), (0.70, 4.06)]),
           (-0.82, [(0.62, 4.16), (0.77, 4.08), (0.82, 3.90), (0.75, 3.78), (0.64, 3.92)])]


@cached
def pauldron_mass(s, d=0.0, col=GREY, flag=0):
    return H.loft([(y, mx(o, s)) for y, o in PAUL_ST], "y", d, "primary", col, "pauldron", flag)


def chest_cuts(d, col=GREY):
    out = []
    for s in (-1, 1):
        out.append(slab((s * 0.55, -0.80, 4.20), (s * 0.6, -0.45, 0.65), d, col=col))               # turret cheek facets
        out.append(scoop((s * 0.70, -0.12, 3.40), Y_, V3((s * 0.7, 0, 0.7)).normalized(), (s * 0.7, 0, -0.7), 0.62, 0.26, 0.08, d,
                         col=col))                                                                    # side scoops (pipes)
    p_brow = V3((0, -1.19, 3.73)) + FACE_T * 0.98                                                     # the brow step
    out.append(slab(p_brow, FACE_N, d, w=1.6, h=0.28, u=X_, depth=0.035, col=col))
    out.append(scoop((0, -0.80, 3.235), X_, V3((0, 0.86, -0.5)), (0, -0.5, -0.86), 0.18, 0.34, 0.05, d, col=col))  # chin notch
    out.append(slab((0, -1.10, 3.66), (0, -0.8, -0.6), d, col=col))                                  # nose underside
    return out


@cached
def chest_mass(d=0.0, col=GREY, flag=0, cuts=True):
    m = H.loft([(y, sym(h)) for y, h in CH_ST], "y", d, "primary", col, "chest", flag)
    if cuts:
        H.carve(m, chest_cuts(d, col), bevel=0.0)
        flagall(m, flag)
    return m


# ---- the rear hull: side boxes and core in one loft along z (+x halves of (x, y)), its sides leaning in
RH_ST = [(3.72, [(0.70, -0.26), (0.84, 0.0), (0.86, 0.92), (0.72, 1.18), (0.30, 1.29)]),
         (3.95, [(0.86, -0.36), (0.93, -0.12), (0.94, 0.86), (0.84, 1.17), (0.30, 1.37)]),
         (4.40, [(0.92, -0.38), (0.99, -0.15), (0.99, 0.80), (0.88, 1.15), (0.30, 1.29)]),
         (4.62, [(0.76, -0.30), (0.88, -0.02), (0.88, 0.84), (0.80, 1.13), (0.28, 1.25)]),
         (4.82, [(0.44, -0.22), (0.54, 0.0), (0.56, 0.72), (0.47, 1.00), (0.24, 1.20)])]


def rear_cuts(d, col=GREY):
    out = [scoop((0, 1.335, 4.24), X_, Z_, Y_, 0.50, 0.52, 0.10, d, col=col),                     # rear hatch recess
           slab((0, 1.20, 3.80), (0, 0.6, -0.8), d, col=col),                                     # lower rear chamfer
           slab((0, -0.30, 4.72), (0, -0.7, 0.7), d, col=col)]                                    # top-front chamfer
    for s in (-1, 1):
        out.append(scoop((s * 0.50, 1.30, 4.22), X_, Z_, Y_, 0.08, 0.86, 0.20, d, corner=0.02, slope=0.15, col=col))  # box slot
        out.append(slab((s * 0.90, -0.30, 3.95), (s * 0.5, -0.6, -0.62), d, col=col))       # box front-bottom chamfer
    return out


@cached
def rear_mass(d=0.0, col=GREY, flag=0, cuts=True):
    m = H.loft([(z, ccw(hull2d(list(h) + [(-x, y) for x, y in h]))) for z, h in RH_ST], "z", d, "primary", col, "rear", flag)
    if cuts:
        H.carve(m, rear_cuts(d, col), bevel=0.0)
        flagall(m, flag)
    return m


# ---- the olive hood: a loft along y with leaning sides and a ridge
#            y,    half w, z0,   z1
HOOD_ST = [(-0.84, 0.14, 4.72, 4.82), (-0.40, 0.28, 4.66, 4.87), (-0.10, 0.44, 4.63, 4.95), (0.30, 0.48, 4.65, 5.02),
           (1.10, 0.47, 4.69, 5.05), (1.24, 0.42, 4.74, 5.00)]


def hood_outline(w, z0, z1):
    return sym([(w, z0), (w - 0.03, z0 + 0.14), (w - 0.13, z1), (0.0, z1 + 0.025)])


@cached
def hood_mass(d=0.0, col=GREY, flag=0):
    m = H.loft([(y, hood_outline(w, z0, z1)) for y, w, z0, z1 in HOOD_ST], "y", d, "primary", col, "hood", flag)
    H.carve(m, [slab((0, -0.70, 4.84), (0, -0.5, 0.86), d, col=col)], bevel=0.0)   # the brow's top wedge
    flagall(m, flag)
    return m


# ---- pelvis (world)
PELV_F = [(-0.34, 2.52), (0.34, 2.52), (0.50, 2.72), (0.50, 3.30), (0.40, 3.47), (-0.40, 3.47), (-0.50, 3.30), (-0.50, 2.72)]
PELV_S = [(-0.28, 2.52), (0.30, 2.52), (0.42, 2.68), (0.42, 3.40), (0.30, 3.47), (-0.40, 3.47), (-0.44, 2.92)]


def pelvis_core(d=0.0, col=GREY, mat="dark"):
    """The crotch block (the reference hangs it to z 2.5): front and side profiles with clipped corners, intersected."""
    return H.intersect([H.prism(ccw(PELV_F), "y", -0.6, 0.6, mat, col, "pc", d),
                        H.prism(ccw(PELV_S), "x", -0.7, 0.7, mat, col, "ps", d)], "pelvis")


WING = [(-0.02, 3.30), (0.68, 3.21), (0.63, 3.36), (0.44, 3.53), (-0.02, 3.53)]
WING_TILT = Matrix.Translation(V3((0, -0.35, 3.40))) @ Matrix.Rotation(math.radians(-14), 4, "X") @ \
    Matrix.Translation(V3((0, 0.35, -3.40)))


@cached
def wing_mass(d=0.0, col=GREY, flag=0):
    halves = [H.prism(mx(WING, s), "y", -0.48, -0.22, "primary", col, "wing", d, flag) for s in (1, -1)]
    return H.xform(H.fuse(halves, "wing", fillet=0.0, segments=1), WING_TILT)


@cached
def skirt_mass(d=0.0, col=GREY, flag=0):
    return H.intersect([H.prism(ccw([(-0.20, 2.56), (0.20, 2.56), (0.30, 2.66), (0.37, 3.30), (-0.37, 3.30), (-0.30, 2.66)]), "y",
                                -0.62, -0.20, "primary", col, "sk", d, flag),
                        H.prism(ccw([(-0.52, 2.70), (-0.40, 2.56), (-0.22, 2.56), (-0.22, 3.33), (-0.46, 3.26)]), "x", -0.4, 0.4,
                                "primary", col, "sks", d, flag)], "skirt")


@cached
def rear_skirt_mass(d=0.0, col=GREY, flag=0):
    """A rear skirt over the pelvis's back (v3 left it bare frame): a trapezoid front view, a raked side profile."""
    return H.intersect([H.prism(ccw([(-0.28, 2.66), (0.28, 2.66), (0.38, 3.32), (-0.38, 3.32)]), "y", 0.20, 0.56, "primary", col,
                                "rsk", d, flag),
                        H.prism(ccw([(0.22, 3.34), (0.22, 2.74), (0.32, 2.66), (0.50, 3.16), (0.48, 3.34)]), "x", -0.5, 0.5,
                                "primary", col, "rsks", d, flag)], "rear_skirt")


@cached
def keel_mass(d=0.0, col=GREY, flag=0):
    """The crotch keel: a V plate under the pelvis block, its point down (it sheds a hit from below and reads as a prow)."""
    return H.intersect([H.prism(ccw([(-0.22, 2.60), (0.22, 2.60), (0.06, 2.44), (-0.06, 2.44)]), "y", -0.36, 0.30, "primary", col,
                                "keel", d, flag),
                        H.prism(ccw([(-0.36, 2.60), (-0.26, 2.46), (0.20, 2.46), (0.30, 2.60)]), "x", -0.3, 0.3, "primary", col,
                                "keels", d, flag)], "keel")


# ---- arms (world). Right (s = -1): the minigun. Left (s = +1): the rocket box.
GX, GZ = -1.96, 4.02               # the barrel axis


def rcv_sect(hw, z0, z1, ct=0.12, cb=0.10, lean=0.04):
    """The receiver's section: leaning sides, chamfered top and bottom corners, a low ridge on top and a keel under."""
    return ccw(hull2d([(GX - hw + cb, z0), (GX, z0 - 0.02), (GX + hw - cb, z0), (GX + hw, z0 + cb), (GX + hw - lean, z1 - ct),
                       (GX + hw - lean - ct, z1), (GX, z1 + 0.03), (GX - hw + lean + ct, z1), (GX - hw + lean, z1 - ct),
                       (GX - hw, z0 + cb)]))


RCV_ST = [(-0.44, (0.24, 3.80, 4.24, 0.10, 0.10)), (-0.32, (0.33, 3.81, 4.27, 0.12, 0.11)), (0.40, (0.34, 3.82, 4.28, 0.12, 0.10)),
          (0.68, (0.30, 3.86, 4.24, 0.13, 0.12)), (0.78, (0.24, 3.92, 4.18, 0.10, 0.09))]


@cached
def recv_mass(d=0.0, col=GREY, flag=0):
    m = H.loft([(y, rcv_sect(*a)) for y, a in RCV_ST], "y", d, "primary", col, "receiver", flag)
    H.carve(m, [scoop((GX - 0.33, 0.14, 4.02), Y_, Z_, -X_, 0.62, 0.22, 0.05, d, col=col),           # outer side channel
                slab((GX, -0.30, 4.27), (0, -0.55, 0.83), d, col=col),                             # top-front wedge
                slab((GX, 0.62, 3.84), (0, 0.6, -0.8), d, col=col)], bevel=0.0)                    # rear belly chamfer
    flagall(m, flag)
    return m


@cached
def gun_mount(d=0.0, col=GREY, flag=0):
    """The yoke from the short upper arm to the receiver's inner face (a tapered loft along x)."""
    oct_ = lambda y0, y1, z0, z1, c: ccw([(y0 + c, z0), (y1 - c, z0), (y1, z0 + c), (y1, z1 - c), (y1 - c, z1), (y0 + c, z1),  # noqa
                                         (y0, z1 - c), (y0, z0 + c)])
    return H.loft([(-1.66, oct_(-0.10, 0.66, 3.72, 4.46, 0.14)), (-1.22, oct_(-0.16, 0.70, 3.68, 4.58, 0.16))], "x", d, "primary",
                  col, "gun_mount", flag)


RB_F = [(1.66, 3.96), (1.90, 3.93), (2.14, 3.96), (2.26, 4.08), (2.19, 5.08), (2.10, 5.20), (1.90, 5.24), (1.70, 5.20), (1.61, 5.08),
        (1.54, 4.08)]
RB_S = [(-1.04, 4.04), (-0.96, 3.96), (0.64, 3.96), (0.86, 4.16), (0.78, 5.02), (0.64, 5.14), (-0.80, 5.20), (-0.92, 5.10)]
RB_FACE_N = V3((0, -1.06, 0.12)).normalized()


@cached
def rocket_mass(d=0.0, col=GREY, flag=0):
    m = H.intersect([H.prism(ccw(RB_F), "y", -1.2, 1.0, "primary", col, "rbf", d, flag),
                     H.prism(ccw(RB_S), "x", 1.3, 2.5, "primary", col, "rbs", d, flag)], "rocket")
    H.carve(m, [slab((2.20, -0.84, 5.10), (0.6, -0.5, 0.62), d, col=col),         # outer top-front corner facet
                slab((1.60, 0.60, 4.00), (-0.5, 0.6, -0.62), d, col=col)], bevel=0.0)
    flagall(m, flag)
    return m


GUN_LEN = (-0.46, -1.44)
REEL = (GX, 0.12, 4.50)            # the rubber reel on top, axis y
DRUM = (GX - 0.02, 3.60)           # two ammo drums under the receiver, axis y


BARREL = (0.40, 0.40, 0.37)        # lighter gunmetal (v3's near-black barrels made a muddy cluster at 40 m)


def gatling(S, col=FRAME, mat="dark"):
    """Six 1.35 m barrels round a spindle (v3's 0.92 m read short next to the housing), a hub at the collar, three bright
    rings: a band clamp near the hub, a mid support, the muzzle ring."""
    x, z = GX, GZ
    V.cyl(S, (x, -0.50, z), 0.21, 0.12, axis="y", n=12, mat=mat, col=V.shade(col, 0.9))           # hub
    V.cyl(S, (x, -0.58, z), 0.17, 0.06, axis="y", n=12, mat=mat, col=V.shade(col, 1.25))
    yc, ln = -1.19, 1.35
    for k in range(6):
        a = 2 * math.pi * k / 6
        V.cyl(S, (x + math.cos(a) * 0.115, yc, z + math.sin(a) * 0.115), 0.046, ln, axis="y", n=6, mat=mat, col=col)
    V.cyl(S, (x, yc, z), 0.05, ln + 0.02, axis="y", n=6, mat=mat, col=V.shade(col, 0.8))            # spindle
    for y, r, t in ((-0.68, 0.195, 0.09), (-1.24, 0.185, 0.07), (-1.80, 0.20, 0.11)):
        V.cyl(S, (x, y, z), r, t, axis="y", n=12, mat="trim", col=V.shade(col, 1.45))
    return S


def rockets(S):
    for cx in (1.77, 2.03):
        for k in range(5):
            z = 4.18 + 0.205 * k
            y = -0.94 + (z - 4.04) * 0.113
            V.cyl(S, (cx, y + 0.06, z), 0.088, 0.14, axis="y", n=10, mat="dark", col=(0.12, 0.12, 0.11))        # tube mouth
            V.cyl(S, (cx, y, z), 0.072, 0.12, axis="y", n=10, mat="trim", col=(0.36, 0.38, 0.34), r2=0.03)        # warhead
            V.cyl(S, (cx, y - 0.065, z), 0.032, 0.02, axis="y", n=8, mat="secondary", col=RED)                   # red tip
    return S


def arm_link(s, col=GREY, mat="dark", d=0.0, flag=0):
    """The short upper arm from the shoulder drum to the weapon."""
    x0, x1 = (1.08, 1.44) if s > 0 else (1.08, 1.26)
    return H.intersect([H.prism(mx(rrect(x0, x1, 3.98, 4.62, 0.06, 1), s), "y", -0.22, 0.42, mat, col, "upper_arm", d, flag),
                        H.prism(rrect(-0.22, 0.42, 3.98, 4.62, (0.10, 0.10, 0.14, 0.14), 1), "x", *HD1.span(s * x0, s * x1), mat,
                                col, "ua_s", d, flag)], "upper_arm")


def rocket_under(col=GREY, d=0.0, flag=0, mat="dark"):
    return H.intersect([H.prism(rrect(1.45, 2.10, 3.66, 4.0, (0.10, 0.10, 0.0, 0.0), 1), "y", -0.50, 0.40, mat, col, "ru", d, flag),
                        H.prism(ccw([(-0.50, 3.80), (-0.40, 3.66), (0.30, 3.66), (0.40, 3.80), (0.40, 4.0), (-0.50, 4.0)]), "x", 1.4,
                                2.2, mat, col, "rus", d, flag)], "rocket_under")


# ============================================================================================================ the mass layer
def mass_layer():
    """Every mass in world space as {part: [Solid]} (the step-2 gate renders these flat grey)."""
    out = {}
    out["Torso"] = [H.fuse([chest_mass(), rear_mass()], "torso_mass", fillet=0.02, segments=1), hood_mass()]
    for s in (1, -1):
        out["Torso"].append(pauldron_mass(s))
        out["Torso"].append(H.prism(ellipse(SHOULDER[1], SHOULDER[2], 0.21, 0.21, 10), "x", *HD1.span(s * 0.9, s * 1.14), "dark",
                                    GREY, "shoulder"))
    out["Pelvis"] = [pelvis_core(col=GREY), wing_mass(), skirt_mass(), rear_skirt_mass(), keel_mass()]
    for s, sfx in ((1, "_L"), (-1, "_R")):
        M = leg_M(s)
        out["Thigh" + sfx] = [H.xform(thigh_mass(s), M @ shear(s))]
        out["Shin" + sfx] = [H.xform(shin_mass(s), M)]
        out["Meta" + sfx] = [H.xform(cannon_mass(s), M)]
        out["Foot" + sfx] = [foot_mass(s)]
    gun = P_("gun")
    gatling(gun, GREY)
    V.cyl(gun, REEL, 0.19, 0.48, axis="y", n=14, mat="dark", col=GREY)
    for y in (0.0, 0.29):
        V.cyl(gun, (DRUM[0], y, DRUM[1]), 0.27, 0.27, axis="y", n=14, mat="dark", col=GREY)
    out["Arm_R"] = [recv_mass(), gun_mount(), arm_link(-1), gun]
    out["Arm_L"] = [rocket_mass(), rocket_under(), arm_link(1),
                    H.prism(ellipse(-0.02, 4.50, 0.28, 0.28, 14), "x", 1.40, 1.55, "dark", GREY, "collar"),
                    H.prism(ellipse(-0.06, 4.52, 0.33, 0.33, 16), "x", 2.25, 2.37, "dark", GREY, "hub")]
    return out


# ======================================================================================================= layers 1-10
region, groove, pocket, pockets, darken, Layers = HD1.region, HD1.groove, HD1.pocket, HD1.pockets, HD1.darken, HD1.Layers
span, rect, tint = HD1.span, HD1.rect, HD1.tint
CUR = {"part": None}
SKIN = {}          # part -> [axis-aligned outer-skin area, outer-skin area] (the step-8 check on what you see)
AX_COS = math.cos(math.radians(3.0))


def new_part(name, origin, seed):
    CUR["part"] = name
    return H.Part(name, origin, seed)


def shell(mass_fn, d0, d1, col=KHAKI, mat="primary", name="shell"):
    """v1's shell (mass(d1) - mass(d0), inner skin flagged) with the carve's volume floor lowered: a 4-8 cm skin keeps only
    a few % of a big mass, which the default floor rejects as a failed solve."""
    outer = mass_fn(d=d1, col=col)
    inner = mass_fn(d=d0, col=V.shade(col, 0.55), flag=HD1.F_INNER)
    for S in (outer, inner):
        for f in S.bm.faces:
            f[S.sec] = V.sec_index(mat)
    H.carve(outer, [inner], bevel=0.0, name=name, min_keep=0.01)
    return outer


def panel(sh, reg, ch=0.03, name="panel", cuts=(), cut_bevel=0.008, skip_axis=False):
    """v1's panel (shell ∩ region, rim chamfer, edge band), plus the axis-aligned check on its outer skin: the faces that are
    neither region walls (the plate's edge thickness) nor the inner skin, measured before the flags are cleared."""
    S = H.intersect([sh.copy(name), reg], name)
    if not len(S.bm.faces):
        return S
    m = HD1.F_REGION | HD1.F_INNER
    rim = [e for e in S.bm.edges if len(e.link_faces) == 2 and sorted(f[S.flag] & m for f in e.link_faces) == [0, HD1.F_REGION]]
    rimf = set(H._bevel(S, rim, ch, 1, tag=H.TAG_RIM))
    if not skip_axis and CUR["part"]:
        acc = SKIN.setdefault(CUR["part"], [0.0, 0.0])
        for f in S.bm.faces:
            if f[S.flag] & m:
                continue
            a, n = f.calc_area(), f.normal
            acc[1] += a
            if max(abs(n.x), abs(n.y), abs(n.z)) >= AX_COS:
                acc[0] += a
    tint(S, [f for f in S.bm.faces if f[S.flag] & HD1.F_REGION and f not in rimf], HD1.WALL_K)
    tint(S, rimf, HD1.RIM_K)
    for f in S.bm.faces:
        f[S.flag] &= ~m
    if cuts:
        H.carve(S, list(cuts), bevel=cut_bevel, name=name)
    return S
PIPE_COLS = ((0.46, 0.45, 0.41), (0.36, 0.37, 0.33), (0.52, 0.42, 0.30))


def mframe(fn, *a, **kw):
    return darken(recol(fn(*a, **kw), PAL["frame"]))


def inset(c, u, v, n, w, h, col=KHAKI_D, depth=0.03):
    """A darker inset sub-panel: a shallow pocket cut into a plate, its floor in a darker paint."""
    u, v, n = frame3(u, v, n)
    return H.cut_rect(c, u, v, n, w, h, depth=depth, corner=0.03, slope=0.7, mat="primary", col=col)


def flanges(L, src, planes, n=14, depth=0.12, width=0.05, stringers=(0,)):
    """Big flange ribs (Keith: deep and few, read at 40 m in the plate gaps): hoops where the planes cut a mass just inside
    the plates, a flat flange pointing inwards from each."""
    hoops = [h for h in (H.section_loop(src, c, no, n) for c, no in planes) if h]
    if hoops:
        H.flange_web(L["mounting"], hoops, depth=depth, width=width, col=PAL["mounting"], stringers=stringers)
    return hoops


def on_plane(c, p, n, out=0.0):
    """c projected onto the plane through p with normal n (plus `out` along n)."""
    n = V3(n).normalized()
    c = V3(c)
    return c - n * (c - V3(p)).dot(n) + n * out


def bricks(L, c, u, v, n, cols, rows, size=(0.17, 0.14), t=0.05, col=KHAKI2):
    f = H.addon_bricks(L["plates"], c, u, v, n, cols, rows, size, t, gap=0.022, col=col, bolt_col=BARE)
    H.tag_faces(L["plates"], f, H.TAG_ADDON)


def region_in(R, M):
    return H.xform(R, M)


# ------------------------------------------------------------------------------------------------------------- thigh
def thigh(s):
    part = new_part("Thigh" + ("_L" if s > 0 else "_R"), hip(s), 10 + s)
    L = Layers()
    mf = lambda d=0.0, col=KHAKI, flag=0: thigh_mass(s, d, col, flag)  # noqa: E731
    F = lambda pts: mx(pts, s)  # noqa: E731
    P = lambda x, y, z: V3((s * x, y, z))  # noqa: E731
    # frame: the mass shrunk by plate + rib depth, the hip drum, knee clevis cheeks, lightening pockets
    fr = mframe(thigh_mass, s, -0.21, PAL["frame"], 0, False)
    hipd = H.prism(ellipse(0, 0, 0.20, 0.20, 12), "x", *span(-s * 0.38, s * 0.02), "dark", V.shade(PAL["frame"], 1.15), "hipdrum")
    cheeks = [H.prism(rrect(-0.40, -0.02, -1.80, -1.40, (0.14, 0.14, 0.0, 0.0), 1), "x", *span(s * x, s * (x + 0.07)), "dark",
                      PAL["frame"], "cheek") for x in (-0.04, 0.45)]
    fr = H.fuse([fr, hipd] + cheeks, "thigh_frame", fillet=0.02, segments=1)
    pockets(fr, [pocket(P(0.30, -0.10, z), Y_, Z_, s * X_, 0.22, 0.30, 0.05) for z in (-0.50, -1.00)])
    L.add("frame", fr)
    # mounting: two deep flange hoops under the front and back gaps, a stringer between them
    flanges(L, thigh_mass(s, -0.07, PAL["mounting"], 0, False), [(V3((0, 0, z)), Z_) for z in (-0.97, -0.81)], 16, 0.12, 0.05,
            stringers=(0, 4, 8, 12))
    # plates: thick raised fronts, thinner sides, thin backs and top (tank logic)
    front = shell(mf, -0.08, 0.035)
    sh = shell(mf, -0.06, 0.0)
    thin = shell(mf, -0.07, -0.03)
    cap = shell(mf, 0.03, 0.065)
    nf = V3((0, -1, 0))
    L.add("plates", panel(thin, region(F(rect(-0.4, 0.8, 0.0, 0.6)), "z", 0.0, 0.6), 0.03, "thigh_top"))
    V_EDGE = [(-0.40, -1.12), (-0.10, -1.30), (0.14, -1.38), (0.30, -1.28), (0.42, -1.18)]   # follows the knee scoop
    L.add("plates", panel(front, region(F([(-0.40, -0.02), (0.42, -0.02)] + V_EDGE[::-1]), "y", -1.0, -0.24), 0.045,
                          "thigh_front", cuts=[inset(P(0.14, -0.475, -0.60), X_, Z_, nf, 0.34, 0.30),
                                               H.cut_rect(P(-0.02, -0.47, -0.20), X_, Z_, nf, 0.10, 0.16, depth=0.08, corner=0.02,
                                                          slope=0.3, mat="dark", col=(0.10, 0.10, 0.09))]))
    L.add("plates", panel(cap, region(F(rect(-0.10, 0.36, -0.30, -0.05)), "y", -1.0, -0.24), 0.025, "thigh_front_shingle"))
    L.add("plates", panel(sh, region(F([(x, z - 0.045) for x, z in V_EDGE] + [(0.42, -1.66), (-0.40, -1.66)]), "y", -1.0, -0.24),
                          0.04, "thigh_knee_guard"))
    seam = lambda z: -0.04 + 0.12 * (-0.04 - z) / 1.46  # noqa: E731  (the prow seam leans back going down, with the form)
    L.add("plates", panel(front, region(ccw([(-0.62, -1.5), (seam(-1.5), -1.5), (seam(-0.04), -0.04), (-0.62, -0.04)]), "x",
                                        *span(s * 0.40, s * 1.0)), 0.04, "thigh_prow_front"))
    L.add("plates", panel(sh, region(ccw([(seam(-0.05) + 0.045, -0.05), (0.62, -0.05), (0.62, -0.30), (seam(-0.30) + 0.045, -0.30)]),
                                     "x", *span(s * 0.30, s * 1.0)), 0.035, "thigh_prow_back_up"))
    L.add("plates", panel(sh, region(ccw([(seam(-1.28) + 0.045, -1.28), (0.62, -1.28), (0.62, -1.50), (seam(-1.50) + 0.045, -1.50)]),
                                     "x", *span(s * 0.30, s * 1.0)), 0.035, "thigh_prow_back_low"))
    L.add("plates", panel(sh, region(rect(-0.50, 0.30, -1.5, -0.10), "x", *span(-s * 1.0, -s * 0.02)), 0.035, "thigh_inner",
                          cuts=[groove(P(-0.11, -0.12, -0.70), Z_, Y_, -s * X_, 0.6),
                                inset(P(-0.105, 0.10, -1.05), Y_, Z_, -s * X_, 0.24, 0.30)]))
    L.add("plates", panel(thin, region(F(rect(0.06, 0.62, -0.76, -0.04)), "y", 0.30, 1.0), 0.03, "thigh_back_up"))
    L.add("plates", panel(thin, region(F(rect(0.06, 0.62, -1.40, -0.86)), "y", 0.10, 1.0), 0.03, "thigh_back_low"))
    # add-on bricks on the front-outer facet (the flank facing fire)
    nb = V3((s * 0.948, -0.317, 0)).normalized()
    bricks(L, P(0.60, -0.19, -0.80) + nb * 0.035, Z_.cross(nb).normalized(), Z_, nb, 1, 3, (0.20, 0.16))
    # the outer recess: brown riveted pads in its back half, the knee ram in its front half (no ribs: v2's ladder)
    nr = V3((s * REC_N.x, REC_N.y, 0)).normalized()
    ur = Z_.cross(nr).normalized() * (1 if s > 0 else -1)
    c0 = P(*REC_C) - nr * (REC_D - 0.005)
    for z0, z1 in ((-0.66, -0.36), (-1.20, -0.70)):
        V.surf_blk(L["plates"], c0 + ur * 0.06 + Z_ * ((z0 + z1) / 2 - REC_C[2]), ur, Z_, nr, 0.14, z1 - z0, 0.035, "primary", BROWN,
                   ch=0.012)
        V.bolt_row(L["service"], c0 + ur * 0.06 + nr * 0.035 + Z_ * (z1 - 0.04 - REC_C[2]),
                   c0 + ur * 0.06 + nr * 0.035 + Z_ * (z0 + 0.04 - REC_C[2]), 4, nr, r=0.014, col=BARE)
    H.ram(L["actuation"], c0 - ur * 0.07 + nr * 0.05 + Z_ * (0.40), c0 - ur * 0.08 + nr * 0.05 + Z_ * (-0.62), 0.055,
          sleeve_col=PAL["actuation"], rod_col=BARE)
    # pipes: a bundle down the inner-back corner gap and into the knee; a hose looping across the knee
    H.pipe_bundle(L["actuation"], [P(0.00, 0.40, -0.10), P(0.01, 0.43, -0.45), P(0.02, 0.40, -0.85), P(0.05, 0.28, -1.20),
                                   P(0.10, 0.08, -1.48), P(0.16, -0.06, -1.62)], V3((s * 0.7, -0.7, 0)), 3, 0.024, cols=PIPE_COLS)
    V.pipe_run(L["actuation"], [P(0.42, 0.16, -1.40), P(0.44, 0.34, -1.72), P(0.40, 0.46, -1.86)], 0.032, "trim",
               V.shade(PAL["actuation"], 0.9), bend=0.12, clamps=1)
    # power: hamstring bundles behind the back gap
    for x in (0.16, 0.28, 0.40):
        pts = [P(x, 0.36, -0.55), P(x, 0.44, -0.85), P(x, 0.32, -1.25)]
        V.tube_along(L["power"], V.round_path(pts, 0.12), 0.045, "dark", PAL["power"], n=6)
    # seals: the hip boot towards the pelvis
    H.bellows(L["seals"], P(-0.20, -0.02, 0.0), P(-0.36, -0.02, 0.0), 0.21, 0.21, folds=2, depth=0.022, n=12, col=PAL["seals"])
    # service: the hull number, roundel or red band, a triangle, rungs on the recess
    sx = 0.16
    K.stencil(L["service"], "01", P(0.14, -0.452, -0.60), X_, Z_, -Y_, 0.15, "secondary", MARK)
    if s > 0:
        HD1.roundel(L["service"], P(sx, -0.49, -0.38), 0.06)
    else:
        V.surf_blk(L["service"], P(sx, -0.49, -0.38), X_, Z_, -Y_, 0.20, 0.05, 0.006, "secondary", RED)
    tri = [P(0.27, -0.445, -1.50), P(0.37, -0.445, -1.50), P(0.32, -0.445, -1.42)]
    V.prim(L["service"], [[p + V3((0, -t, 0)) for p in tri] for t in (0.0, 0.006)], "secondary", MARK, 0, None, jitter=0.0)
    L.flush(part, leg_M(s) @ shear(s))
    return part


# -------------------------------------------------------------------------------------------------------------- shin
def knee_cap_mass(s, d=0.0, col=GREY, flag=0):
    """The knee cap shaped to the knee: a faceted disc round the knee axis (in the shin's bone frame: x lateral, y down the
    bone, z back), wrapping the drum's front from above it to below it, 0.27 m radius, 0.23 m half width."""
    M, _ = link_frame(s, K_, HK_)
    arc = [(0.27 * math.cos(math.radians(t)), 0.27 * math.sin(math.radians(t))) for t in range(140, 401, 26)]
    return H.xform(H.prism(ccw(hull2d(arc + [(0.0, 0.06)])), "x", -0.23, 0.23, "primary", col, "kneecap", d, flag), M)


def servo(L, M, x, r, t, s, col=None, bolts=4, name="servo"):
    """A flat servo housing on a joint axis (machinery may be flat): an octagonal block on the bone frame's x axis at x (its
    outer face at x + s * t), a raised disc cover and a bolt circle."""
    col = col or PAL["actuation"]
    x0, x1 = span(x, x + s * t)
    blk = H.xform(H.prism(ccw([(r * math.cos(math.radians(22.5 + 45 * k)), r * math.sin(math.radians(22.5 + 45 * k)))
                                for k in range(8)]), "x", x0, x1, "trim", col, name), M)
    L.add("actuation", blk)
    ax = (M.to_3x3() @ X_).normalized() * s
    c = M @ V3((x + s * t, 0, 0))
    V.bar(L["actuation"], c, c + ax * 0.026, r * 0.62, "trim", V.shade(col, 1.18), 12)
    for k in range(bolts):
        a = 2 * math.pi * k / bolts
        q = M @ V3((x + s * t, math.cos(a) * r * 0.80, math.sin(a) * r * 0.80))
        V.bolt(L["service"], q, ax, r=0.016, h=0.02, col=BARE)


def shin(s):
    part = new_part("Shin" + ("_L" if s > 0 else "_R"), knee(s), 20 + s)
    L = Layers()
    mf = lambda d=0.0, col=KHAKI2, flag=0: shin_mass(s, d, col, flag)  # noqa: E731
    M, Ln = link_frame(s, K_, HK_)
    RG = lambda outline, axis, a0, a1, col=KHAKI2: region_in(H.prism(ccw(outline), axis, a0, a1, "primary", col, "region", 0.0,  # noqa
                                                                     HD1.F_REGION), M)
    # frame: the shin beam, the knee and hock drums (wide enough to reach the thigh's clevis cheeks), a lightening pocket
    fr = mframe(shin_mass, s, -0.07, PAL["frame"])
    kd = H.xform(H.prism(ellipse(0, 0, 0.17, 0.17, 12), "x", -0.30, 0.30, "dark", V.shade(PAL["frame"], 1.15), "kneedrum"), M)
    hd = H.xform(H.prism(ellipse(Ln, 0, 0.15, 0.15, 12), "x", -0.24, 0.24, "dark", V.shade(PAL["frame"], 1.15), "hockdrum"), M)
    fr = H.fuse([fr, kd, hd], "shin_frame", fillet=0.015, segments=1)
    pockets(fr, [H.xform(pocket(V3((s * 0.135, Ln * 0.5, 0.0)), Y_, Z_, s * X_, 0.30, 0.14, 0.04), M)])
    L.add("frame", fr)
    # frame: flat side links knee -> hock behind the side plates, with lightening slots (they carry the load)
    for sx in (-1, 1):
        lk = H.xform(H.prism(rrect(-0.06, Ln + 0.06, 0.02, 0.19, 0.05, 1), "x", *span(sx * 0.205, sx * 0.235), "dark",
                             V.shade(PAL["frame"], 1.25), "shin_link"), M)
        H.carve(lk, [H.xform(H.cut_rect(V3((sx * 0.235, Ln * 0.5, 0.105)), Y_, Z_, sx * X_, Ln * 0.42, 0.07, depth=0.05,
                                        corner=0.03, slope=0.0, mat="dark", col=V.shade(PAL["frame"], 0.6)), M)], bevel=0.0)
        L.add("frame", lk)
    # actuation: servo housings both sides of the knee (outboard of the thigh's clevis cheeks), a small one at the hock
    for sx in (-1, 1):
        servo(L, M, sx * 0.30, 0.17, 0.07, sx, name="knee_servo")
    # plates: the knee cap (shaped to the knee, KHAKI with an olive inset), a front plate whose top follows the cap's arc,
    # outer and inner side plates with a seam leaning with the bone
    km = lambda d=0.0, col=KHAKI, flag=0: knee_cap_mass(s, d, col, flag)  # noqa: E731
    kc = shell(km, -0.05, 0.0)
    L.add("plates", panel(kc, RG(rect(-0.5, 0.5, -0.5, 0.05), "x", -0.21, 0.21, KHAKI), 0.035, "knee_cap",
                          cuts=[H.xform(inset(V3((0, 0.02, -0.268)), X_, Y_, -Z_, 0.18, 0.13, OLIVE, depth=0.022), M)]))
    sh = shell(mf, -0.05, 0.0, KHAKI2)
    up = shell(mf, -0.03, 0.035, KHAKI2)
    L.add("plates", panel(up, RG([(-0.4, 0.31), (-0.20, 0.30), (0.0, 0.33), (0.20, 0.30), (0.4, 0.31), (0.4, Ln - 0.07),
                                  (-0.4, Ln - 0.07)], "z", -0.6, -0.10), 0.03, "shin_front"))
    for sx in (-1, 1):
        L.add("plates", panel(sh, RG([(0.18, -0.16), (Ln - 0.06, -0.16), (Ln - 0.02, 0.03), (0.30, 0.03)], "x",
                                     *span(sx * 0.10, sx * 0.6)), 0.025, "shin_side"))
    H.ram(L["actuation"], hl(s, (K_[0] + s * 0.0 + 0.02, -0.12, -1.90)), hl(s, (HK_[0] - 0.02, 0.40, -2.08)), 0.045,
          sleeve_col=PAL["actuation"], rod_col=BARE)
    H.pipe_bundle(L["actuation"], [M @ V3((s * 0.22, -0.05, 0.16)), M @ V3((s * 0.24, Ln * 0.5, 0.20)),
                                   M @ V3((s * 0.22, Ln + 0.05, 0.16))], (M.to_3x3() @ Z_), 2, 0.02, cols=PIPE_COLS)
    kn = hl(s, K_)
    H.bellows(L["seals"], kn + V3((-0.24, -0.10, 0.12)), kn + V3((0.24, -0.10, 0.12)), 0.11, 0.11, folds=3, depth=0.02, n=10,
              col=PAL["seals"])
    L.flush(part, leg_M(s))
    return part


# -------------------------------------------------------------------------------------------------- the cannon (meta)
def meta(s):
    part = new_part("Meta" + ("_L" if s > 0 else "_R"), hock(s), 25 + s)
    L = Layers()
    M, Ln = link_frame(s, HK_, A_)
    RG = lambda x0, x1, z0, z1, y0, y1, col=KHAKI: region_in(H.prism(rect(x0, x1, z0, z1), "y", y0, y1, "primary", col, "region",  # noqa
                                                                     0.0, HD1.F_REGION), M)
    # frame: the bone and the cannon's core, the hock drum inside the cannon's top
    core = mframe(cannon_mass, s, -0.15, PAL["frame"], 0, False)
    bone = mframe(meta_bone, s, 0.0, PAL["frame"])
    hd = H.xform(H.prism(ellipse(0.0, 0.0, 0.17, 0.17, 12), "x", -0.25, 0.25, "dark", V.shade(PAL["frame"], 1.15), "hock"), M)
    fr = H.fuse([core, bone, hd], "meta_frame", fillet=0.015, segments=1)
    L.add("frame", fr)
    # mounting: flange hoops at the two plate gaps (horn / pod and the pod shingle)
    flanges(L, cannon_mass(s, -0.065, PAL["mounting"], 0, False),
            [(M @ V3((0, t, 0)), (M.to_3x3() @ Y_).normalized()) for t in (-0.135, 0.415)], 14, 0.10, 0.045, stringers=(3, 10))
    # plates: the olive horn past the hock, the khaki pod in two shingled panels, greener guards beside the front channel
    cm = lambda d=0.0, col=KHAKI, flag=0: cannon_mass(s, d, col, flag)  # noqa: E731
    co = lambda d=0.0, col=OLIVE, flag=0: cannon_mass(s, d, col, flag)  # noqa: E731
    cg = lambda d=0.0, col=KHAKI2, flag=0: cannon_mass(s, d, col, flag)  # noqa: E731
    horn = shell(co, -0.07, 0.03, OLIVE)
    pup = shell(cm, -0.07, 0.035)
    plo = shell(cm, -0.06, 0.0)
    gsh = shell(cg, -0.05, 0.0, KHAKI2)
    L.add("plates", panel(horn, RG(-0.6, 0.6, -0.6, 0.6, -0.8, -0.16, OLIVE), 0.04, "horn",
                          cuts=[H.xform(inset(V3((0, -0.40, 0.326)), Y_, X_, Z_, 0.12, 0.18, OLIVE_D), M)]))
    L.add("plates", panel(pup, RG(-0.6, 0.6, -0.02, 0.6, -0.11, 0.39), 0.04, "pod_up",
                          cuts=[H.xform(inset(V3((0.255, 0.12, 0.12)), Y_, Z_, X_, 0.30, 0.12), M),
                                H.xform(inset(V3((-0.255, 0.12, 0.12)), Y_, Z_, -X_, 0.30, 0.12), M)]))
    L.add("plates", panel(plo, RG(-0.6, 0.6, -0.02, 0.6, 0.44, 1.2), 0.035, "pod_low"))
    L.add("plates", panel(shell(cm, 0.035, 0.065), RG(-0.10, 0.10, 0.1, 0.6, -0.08, 0.20), 0.02, "pod_cap"))
    for x0, x1 in ((0.08, 0.6), (-0.6, -0.08)):
        L.add("plates", panel(gsh, RG(x0, x1, -0.6, -0.06, 0.02, 0.86, KHAKI2), 0.03, "cannon_guard"))
    # actuation: two pistons down the front channel, a pipe pair down the outer side recess, hoses round the hock
    for x in (-0.06, 0.06):
        H.ram(L["actuation"], M @ V3((x, 0.08, -0.12)), M @ V3((x, 0.70, -0.12)), 0.034, sleeve_col=PAL["actuation"], rod_col=BARE)
    H.pipe_bundle(L["actuation"], [M @ V3((0.20, -0.05, 0.05)), M @ V3((0.215, 0.30, 0.05)), M @ V3((0.21, 0.62, 0.04)),
                                   M @ V3((0.16, 0.86, -0.02))], (M.to_3x3() @ Z_), 2, 0.022, cols=PIPE_COLS, clamp_every=0.25)
    V.pipe_run(L["actuation"], [M @ V3((-0.14, -0.30, -0.10)), M @ V3((-0.22, -0.05, -0.18)), M @ V3((-0.14, 0.20, -0.16))], 0.03,
               "trim", V.shade(PAL["actuation"], 0.85), bend=0.1, clamps=0)
    # power: side bundles under the guards
    for x in (-0.13, 0.13):
        V.tube_along(L["power"], V.round_path([M @ V3((x, 0.15, -0.04)), M @ V3((x * 1.1, Ln * 0.5, -0.03)),
                                               M @ V3((x, Ln * 0.82, -0.04))], 0.1), 0.04, "dark", PAL["power"], n=6)
    # actuation: flat servo housings on the hock axis, both sides (the reverse joint's drive)
    for sx in (-1, 1):
        servo(L, M, sx * 0.245, 0.15, 0.06, sx, name="hock_servo")
    # service: a stencil and a lifting eye on the pod
    K.stencil(L["service"], "1" if s > 0 else "2", M @ V3((0.236 * 1.0, 0.62, 0.10)), (M.to_3x3() @ -Y_), (M.to_3x3() @ Z_),
              (M.to_3x3() @ X_), 0.10, "secondary", MARK)
    L.flush(part, leg_M(s))
    return part


# -------------------------------------------------------------------------------------------------------------- foot
def foot(s):
    """The foot as a machine: a wedge body and heel spur (frame), two articulated toes each on a hinge drum with a small ram
    and a khaki cap, rubber tread pads and sole bricks underneath, ankle rams and a trunnion block, a hose into the ankle."""
    a = ankle(s)
    cx = a.x + s * FOOT_DX
    part = new_part("Foot" + ("_L" if s > 0 else "_R"), a, 30 + s)
    L = Layers()
    drum = H.xform(H.prism(ellipse(0, 0, 0.15, 0.15, 10), "x", -0.17, 0.17, "dark", V.shade(PAL["frame"], 1.15), "ankle_drum"),
                   Matrix.Translation(a))
    L.add("frame", H.fuse([foot_body(s, col=PAL["frame"]), heel_solid(s, col=PAL["frame"]), drum], "foot_frame", fillet=0.015,
                          segments=1))
    # the body's top plate (khaki), its seam following the body's slope; an olive cap on the heel spur
    fm = lambda d=0.0, col=KHAKI, flag=0: flagall(recol(foot_body(s, d, col, "primary"), col, "primary"), flag)  # noqa: E731
    L.add("plates", panel(shell(fm, -0.02, 0.03), region(ccw([(a.y - 0.40, SOLE + 0.17), (a.y + 0.34, SOLE + 0.25),
                                                                (a.y + 0.34, 0.8), (a.y - 0.40, 0.8)]), "x", cx - 0.4, cx + 0.4),
                          0.02, "foot_top"))
    hm = lambda d=0.0, col=OLIVE, flag=0: flagall(recol(heel_solid(s, d, col, "primary"), col, "primary"), flag)  # noqa: E731
    L.add("plates", panel(shell(hm, -0.02, 0.025, OLIVE), region(rect(-9, 9, -9, 9), "z", SOLE + 0.10, 0.8, OLIVE), 0.015,
                          "heel_cap"))
    for k in range(2):
        TM = toe_M(s, k)
        sx = (-1, 1)[k] * s
        L.add("frame", toe_solid(s, k, col=V.shade(PAL["frame"], 1.08)))
        tm = lambda d=0.0, col=KHAKI, flag=0, k=k: toe_solid(s, k, d, col, "primary", flag)  # noqa: E731
        cap = shell(tm, -0.02, 0.035)
        L.add("plates", panel(cap, H.xform(region(ccw([(-0.70, 0.10), (-0.08, 0.17), (-0.08, 0.6), (-0.70, 0.6)]), "x", -0.4, 0.4),
                                           TM), 0.018, "toe_cap"))
        # the hinge drum at the toe root, a ram from the body's top to the toe's back
        ax = (TM.to_3x3() @ X_).normalized()
        hc = TM @ V3((0, 0.0, 0.11))
        V.bar(L["actuation"], hc - ax * 0.135, hc + ax * 0.135, 0.085, "trim", PAL["actuation"], 10)
        for e in (-1, 1):
            V.bar(L["actuation"], hc + ax * e * 0.135, hc + ax * e * 0.155, 0.05, "trim", V.shade(PAL["actuation"], 1.2), 8)
        H.ram(L["actuation"], V3((cx + sx * 0.08, a.y - 0.12, SOLE + 0.36)), TM @ V3((0, -0.30, 0.27)), 0.026,
              sleeve_col=PAL["actuation"], rod_col=BARE)
        # rubber tread pads under the toe (in the toe's frame, from the ground up to the sole)
        for t0, t1 in ((-0.60, -0.40), (-0.36, -0.14)):
            pad = P_("pad")
            V.blk(pad, (0, (t0 + t1) / 2, -SOLE), (TOE_W - 0.03, t1 - t0, SOLE + 0.012), "tyre", RUBBER, ch=0.008)
            L.add("seals", H.xform(pad, TM))
    for y0 in (-0.30, -0.08, 0.14):     # sole bricks under the body and heel
        for x0 in (-0.13, 0.13):
            V.blk(L["seals"], (cx + x0, a.y + y0 + 0.08, 0.0), (0.20, 0.16, SOLE + 0.012), "tyre", RUBBER, ch=0.008)
    V.blk(L["seals"], (cx, a.y + 0.40, 0.0), (0.16, 0.24, SOLE + 0.012), "tyre", RUBBER, ch=0.008)
    # the ankle: a flat trunnion block either side of the drum, two rams from the cannon's back down to the heel, a boot, a hose
    for e in (-1, 1):
        tb = H.prism(rrect(a.y - 0.16, a.y + 0.16, SOLE + 0.20, a.z + 0.10, (0.0, 0.0, 0.06, 0.06), 1), "x",
                     *span(a.x + e * 0.175, a.x + e * 0.235), "dark", V.shade(PAL["frame"], 1.25), "trunnion")
        L.add("frame", tb)
        V.bolt(L["service"], a + V3((e * 0.235, 0, 0)), V3((e, 0, 0)), r=0.04, h=0.03, col=BARE)
        H.ram(L["actuation"], a + V3((e * 0.12, 0.30, 0.62)), V3((cx + e * 0.12, a.y + 0.36, SOLE + 0.22)), 0.032,
              sleeve_col=PAL["actuation"], rod_col=BARE)
    H.bellows(L["seals"], a + V3((0, -0.02, 0.10)), a + V3((0, -0.02, 0.32)), 0.13, 0.12, folds=2, depth=0.02, n=10, col=PAL["seals"])
    V.pipe_run(L["actuation"], [a + V3((s * 0.10, 0.26, 0.80)), a + V3((s * 0.22, 0.24, 0.40)), a + V3((s * 0.18, 0.10, 0.12))],
               0.028, "trim", V.shade(PAL["actuation"], 0.85), bend=0.1, clamps=1)
    L.flush(part)
    return part


# ------------------------------------------------------------------------------------------------------------ pelvis
def pelvis():
    part = new_part("Pelvis", V3((0, HIP_Y, HIP_Z)), 40)
    L = Layers()
    core = pelvis_core(0.0, PAL["frame"])
    drums = [H.prism(ellipse(HIP_Y, HIP_Z, 0.21, 0.21, 12), "x", *span(s * 0.40, s * 0.60), "dark", V.shade(PAL["frame"], 1.15),
                     "hip") for s in (-1, 1)]
    core = H.fuse([core] + drums, "pelvis_frame", fillet=0.02, segments=1)
    pockets(core, [pocket(V3((0, 0.44, 3.10)), X_, Z_, Y_, 0.5, 0.3)])
    L.add("frame", core)
    # plates: the wings split by a seam that leans with their taper, the front skirt cut along its taper into a centre panel
    # and two angled side cheeks, a rear skirt, the crotch keel (KHAKI2)
    wsh = shell(lambda d=0.0, col=KHAKI, flag=0: wing_mass(d, col, flag), -0.05, 0.0)
    for s in (-1, 1):
        L.add("plates", panel(wsh, region(mx([(0.018, 3.0), (0.38, 3.0), (0.28, 3.8), (0.018, 3.8)], s), "y", -1.0, 0.0), 0.035,
                              "wing_in"))
        L.add("plates", panel(wsh, region(mx([(0.42, 3.0), (0.9, 3.0), (0.9, 3.8), (0.32, 3.8)], s), "y", -1.0, 0.0), 0.035,
                              "wing_out", cuts=[inset(V3((s * 0.52, -0.46, 3.30)), X_, Z_, V3((0, -0.97, 0.24)), 0.14, 0.08)]))
    ssh = shell(lambda d=0.0, col=KHAKI, flag=0: skirt_mass(d, col, flag), -0.05, 0.0)
    L.add("plates", panel(ssh, region(ccw([(-0.15, 2.58), (0.15, 2.58), (0.27, 3.30), (-0.27, 3.30)]), "y", -1.0, -0.2), 0.035,
                          "skirt", cuts=[inset(V3((0, -0.494, 2.98)), X_, Z_, V3((0, -0.995, 0.0995)), 0.24, 0.36)]))
    for s in (-1, 1):
        L.add("plates", panel(ssh, region(mx([(0.19, 2.58), (0.40, 2.58), (0.48, 3.30), (0.31, 3.30)], s), "y", -1.0, -0.2), 0.03,
                              "skirt_side"))
    rsh = shell(lambda d=0.0, col=KHAKI, flag=0: rear_skirt_mass(d, col, flag), -0.05, 0.0)
    L.add("plates", panel(rsh, region(ccw([(-0.6, 2.6), (0.6, 2.6), (0.6, 3.40), (-0.6, 3.40)]), "y", 0.24, 0.9), 0.03,
                          "rear_skirt", cuts=[groove(V3((0, 0.43, 3.00)), Z_, X_, V3((0, 0.94, -0.33)), 0.50)]))
    ksh = shell(lambda d=0.0, col=KHAKI2, flag=0: keel_mass(d, col, flag), -0.04, 0.0, KHAKI2)
    L.add("plates", panel(ksh, region(rect(-0.6, 0.6, 2.30, 2.58), "y", -0.32, 0.26, KHAKI2), 0.025, "keel"))
    # actuation: flat hip actuator housings round the hip drums (machinery may be flat)
    for s in (-1, 1):
        Mh = Matrix.Translation(V3((0, HIP_Y, HIP_Z)))
        servo(L, Mh, s * 0.38, 0.27, 0.07, s, name="hip_servo")
    K.stencil(L["service"], "|", V3((0.0, -0.50, 3.43)), X_, Z_, -Y_, 0.08, "secondary", MARK)
    # service: the recovery loop under the crotch (a tow and lifting hard point, as on the reference)
    loop = [V3((-0.30, -0.06, 2.56)), V3((-0.30, -0.06, 2.34)), V3((-0.20, -0.06, 2.24)), V3((0.20, -0.06, 2.24)),
            V3((0.30, -0.06, 2.34)), V3((0.30, -0.06, 2.56))]
    for q0, q1 in zip(loop, loop[1:]):
        V.bar(L["service"], q0, q1, 0.045, "trim", V.shade(BARE, 0.8), 6)
    for s in (-1, 1):
        V.bar(L["mounting"], V3((s * 0.16, -0.32, 3.12)), V3((s * 0.16, -0.20, 3.14)), 0.03, "sand", PAL["mounting"], 6)
        H.ram(L["actuation"], V3((s * 0.36, 0.30, 3.25)), V3((s * 0.26, 0.42, 3.66)), 0.035, sleeve_col=PAL["actuation"], rod_col=BARE)
        H.pipe_bundle(L["actuation"], [V3((s * 0.10, 0.40, 3.38)), V3((s * 0.30, 0.46, 3.20)), V3((s * 0.46, 0.30, 3.12))], Z_, 2,
                      0.022, cols=PIPE_COLS)
    L.flush(part)
    return part


# ------------------------------------------------------------------------------------------------------------- torso
def pauldron(L, s):
    """One pauldron: a shell of its loft trimmed by a slanted lower edge (side view), an olive stripe inset along its crown,
    a bolt row along the outer face. It overlaps the cheek and side box like a shingle."""
    pm = lambda d=0.0, col=KHAKI, flag=0: pauldron_mass(s, d, col, flag)  # noqa: E731
    psh = shell(pm, -0.06, 0.0)
    ps = H.Surface(pauldron_mass(s))
    (ct, nt) = ps.project(V3((s * 0.84, -0.30, 6.0)), along=-Z_)
    (co, no) = ps.project(V3((s * 2.0, -0.10, 4.30)), along=-s * X_)
    (co2, no2) = ps.project(V3((s * 2.0, -0.60, 4.02)), along=-s * X_)
    L.add("plates", panel(psh, region(ccw([(0.36, 4.22), (0.36, 4.95), (-0.95, 4.95), (-0.95, 3.70)]), "x", *span(s * 0.5, s * 1.2)),
                          0.04, "pauldron", cuts=[inset(ct, Y_, X_, nt, 0.62, 0.10, OLIVE_D, depth=0.025)]))
    V.bolt_row(L["service"], co + no * 0.005, co2 + no2 * 0.005, 4, (no + no2).normalized(), r=0.016, col=BARE)


WAIST = V3((0.0, 0.10, 3.45))


def torso():
    part = new_part("Torso", WAIST, 50)
    L = Layers()
    # frame: the pilot tub (the chest shrunk), the rear core, the waist drum, shoulder drums
    tub = mframe(chest_mass, -0.18, PAL["frame"], 0, False)
    core = mframe(rear_mass, -0.16, PAL["frame"], 0, False)
    waist = H.prism(ellipse(0.10, 0.10, 0.32, 0.32, 12), "z", 3.30, 3.78, "dark", V.shade(PAL["frame"], 1.15), "waist")
    sh_d = [H.prism(ellipse(SHOULDER[1], SHOULDER[2], 0.21, 0.21, 12), "x", *span(s * 0.80, s * 1.12), "dark",
                    V.shade(PAL["frame"], 1.15), "shoulder") for s in (-1, 1)]
    fr = H.fuse([tub, core, waist] + sh_d, "torso_frame", fillet=0.02, segments=1)
    pockets(fr, [H.cut_rect(V3((0, 1.16, 4.24)), X_, Z_, Y_, 0.42, 0.44, depth=0.20, corner=0.06, slope=0.2, mat="dark",
                            col=V.shade(PAL["frame"], 0.6))])
    L.add("frame", fr)
    # power: the core drum behind the hatch, conduits to the shoulders
    V.cyl(L["power"], (0, 0.88, 4.24), 0.20, 0.56, axis="z", n=12, mat="dark", col=PAL["power"])
    for s in (-1, 1):
        V.tube_along(L["power"], V.round_path([V3((s * 0.30, 0.55, 4.0)), V3((s * 0.62, 0.40, 3.92)), V3((s * 0.86, 0.2, 4.12)),
                                               V3((s * 0.95, 0.12, 4.30))], 0.12), 0.05, "dark", PAL["power"], n=6)
    # actuation: pipe bundles out of the side scoops under the boxes into the arms, waist twist rams
    for s in (-1, 1):
        H.pipe_bundle(L["actuation"], [V3((s * 0.55, -0.40, 3.30)), V3((s * 0.70, -0.12, 3.36)), V3((s * 0.86, 0.10, 3.62)),
                                       V3((s * 1.06, 0.12, 3.92)), V3((s * 1.18, 0.10, 4.06))], V3((0, 1, 0)), 3, 0.026,
                      cols=PIPE_COLS)
        H.ram(L["actuation"], V3((s * 0.30, -0.10, 3.42)), V3((s * 0.42, 0.20, 3.74)), 0.03, sleeve_col=PAL["actuation"], rod_col=BARE)
        H.pipe_bundle(L["actuation"], [V3((s * 0.20, 1.10, 3.70)), V3((s * 0.40, 1.16, 3.86)), V3((s * 0.50, 1.20, 4.10)),
                                       V3((s * 0.50, 1.18, 4.50))], X_, 2, 0.022, cols=PIPE_COLS)
    # mounting: a flange hoop round the chest under the cheek / chin-side seam (v3's hoop at y -0.60 read as a halo over the
    # face at 40 m), round the rear hull under the side-panel gap
    flanges(L, chest_mass(-0.07, PAL["mounting"], 0, False), [(V3((0, 0, 3.90)), Z_)], 18, 0.12, 0.05, stringers=())
    flanges(L, rear_mass(-0.07, PAL["mounting"], 0, False), [(V3((0, 0.36, 0)), Y_), (V3((0, 0, 4.30)), Z_)], 18, 0.14, 0.05,
            stringers=())
    # plates: the chest. The signature form: ONE face shield in an upside-down U over the face, nose and both sides of the
    # chin, round a dark inset arch. Everything else is cut round its edge (skill 7b); nothing slices through it.
    up = shell(chest_mass, -0.08, 0.035)
    sh = shell(chest_mass, -0.06, 0.0)
    ins = shell(chest_mass, -0.10, -0.03)
    cap = shell(chest_mass, 0.03, 0.065)
    surf = H.Surface(chest_mass())
    onf = lambda x, z: surf.project(V3((x, -2.0, z)), along=Y_)  # noqa: E731  (the chest's front skin at (x, z))
    vis = H.cut_rect(V3((-0.24, -1.03, 4.08)), X_, FACE_T, FACE_N, 0.20, 0.16, depth=0.12, corner=0.02, slope=0.3, mat="dark",
                     col=(0.08, 0.08, 0.08))
    grooves = []
    for sx in (-1, 1):       # flow grooves down each leg of the U, along the leg (not a world axis)
        (pa, na), (pb, nb) = onf(sx * 0.30, 3.30), onf(sx * 0.46, 3.76)
        grooves.append(groove((pa + pb) / 2, (pb - pa).normalized(), X_, (na + nb).normalized(), (pb - pa).length * 0.9))
    grooves.append(groove(V3((0.06, -0.94, 4.20)), FACE_T, X_, FACE_N, 0.30))
    L.add("plates", panel(up, region(sym_concave(SHIELD_HALF + ARCH_HALF), "y", -1.6, -0.62), 0.045, "face_shield",
                          cuts=[vis] + grooves))
    L.add("plates", panel(ins, region(sym_concave(ARCH_INSET), "y", -1.6, -0.62, KHAKI_D), 0.025, "face_arch"))
    L.add("plates", panel(cap, region(rect(-0.38, -0.06, 3.80, 3.96, 0.03), "y", -1.6, -0.70), 0.025, "face_shingle"))
    E = H.offset_polyline(SHIELD_EDGE, 0.04)        # the far side of the shield's seam, outboard
    for s in (-1, 1):
        cheek_o = E[:3] + [(0.95, E[2][1] - 0.06), (0.95, 4.75), (E[0][0], 4.75)]
        chin_o = [(E[2][0], E[2][1] - 0.045)] + E[3:] + [(E[-1][0], 2.95), (0.95, 2.95), (0.95, E[2][1] - 0.105)]
        L.add("plates", panel(sh, region(mx(cheek_o, s), "y", -1.6, -0.66), 0.04, "cheek"))
        L.add("plates", panel(sh, region(mx(chin_o, s), "y", -1.6, -0.62), 0.04, "chin_side"))
        L.add("plates", panel(sh, region(ccw([(-0.56, 3.30), (0.30, 3.30), (0.30, 3.96), (-0.40, 3.96)]), "x",
                                         *span(s * 0.70, s * 1.0)), 0.04, "chest_side"))
        bricks(L, V3((s * 0.80, -0.30, 3.74)), Y_, Z_, V3((s * 0.995, 0, -0.1)).normalized(), 3, 2)
        pauldron(L, s)
    L.add("plates", panel(up, region(rect(-0.45, 0.45, -0.62, 0.2), "z", 4.44, 4.9), 0.035, "brow"))
    # plates: rear hull (side boxes and core)
    rm = lambda d=0.0, col=KHAKI, flag=0: rear_mass(d, col, flag)  # noqa: E731
    rsh = shell(rm, -0.06, 0.0)
    rth = shell(rm, -0.07, -0.03)
    rup = shell(rm, -0.03, 0.03)
    for s in (-1, 1):
        L.add("plates", panel(rup, region(mx(rect(0.56, 1.2, -0.6, 1.5), s), "z", 4.55, 5.2), 0.035, "sbox_top"))
        L.add("plates", panel(rsh, region(rect(-0.60, 0.31, 3.7, 4.56), "x", *span(s * 0.80, s * 1.2)), 0.035, "sbox_side_front",
                              cuts=[inset(V3((s * 0.97, -0.05, 4.18)), Y_, Z_, s * X_, 0.32, 0.36)]))
        L.add("plates", panel(rsh, region(rect(0.41, 1.5, 3.7, 4.56), "x", *span(s * 0.80, s * 1.2)), 0.035, "sbox_side_back",
                              cuts=[groove(V3((s * 0.975, 0.80, 4.10)), Z_, Y_, s * X_, 0.5)]))
        L.add("plates", panel(rth, region(mx(rect(0.54, 1.1, 3.7, 4.7), s), "y", 1.0, 1.6), 0.03, "sbox_back",
                              cuts=[H.cut_rect(V3((s * 0.74, 1.24, 4.20)), X_, Z_, Y_, 0.30, 0.44, depth=0.24, corner=0.03, slope=0.15,
                                               mat="dark", col=(0.08, 0.075, 0.07))]))
        # heat: louvres and a glowing floor in each box's back vent (the one strong heat feature)
        c = V3((s * 0.74, 1.20, 4.20))
        V.louvres(L["heat"], c, X_, Z_, Y_, 0.28, 0.40, 4, "dark", V.shade(PAL["heat"], 0.8), tilt=0.5, t=0.02)
        f = V.surf_blk(L["heat"], c - Y_ * 0.14, X_, Z_, Y_, 0.28, 0.40, 0.01, "glow", (1.0, 0.45, 0.15))
        H.glow_flag(f, L["heat"])
    L.add("plates", panel(rsh, region(rect(-0.44, 0.44, 3.6, 4.9), "y", 1.0, 1.6), 0.04, "hull_back"))
    # the olive hood: raised spine, side panels with darker insets
    hm = lambda d=0.0, col=OLIVE, flag=0: hood_mass(d, col, flag)  # noqa: E731
    hsh = shell(hm, -0.05, 0.0, OLIVE)
    hup = shell(hm, -0.02, 0.03, OLIVE)
    L.add("plates", panel(hup, region(rect(-0.15, 0.15, -1.0, 1.3), "z", 4.6, 5.4, OLIVE), 0.03, "hood_spine"))
    for s in (-1, 1):
        L.add("plates", panel(hsh, region(mx(rect(0.18, 0.6, -1.0, 1.3), s), "z", 4.6, 5.4, OLIVE), 0.03, "hood_side",
                              cuts=[inset(V3((s * 0.30, 0.55, 5.03)), Y_, X_, V3((s * 0.25, 0, 0.97)).normalized(), 0.50, 0.12,
                                          OLIVE_D)]))
    # seals: the waist boot
    H.bellows(L["seals"], V3((0, 0.1, 3.34)), V3((0, 0.1, 3.66)), 0.36, 0.34, folds=3, depth=0.025, n=14, col=PAL["seals"])
    # service: lifting eyes, rungs up the chest side, the hull number and badge on the face
    for s in (-1, 1):
        H.lifting_eye(L["service"], V3((s * 0.30, 0.95, 5.07)), Z_, r=0.07, t=0.02)
    H.rungs(L["service"], V3((-0.86, -0.20, 3.45)), V3((-0.86, -0.20, 3.85)), 2, -X_, width=0.18, depth=0.07, r=0.016)
    fc = V3((0.20, -1.19, 3.73)) + FACE_T * 0.42 + FACE_N * 0.036
    K.stencil(L["service"], "01", fc, X_, FACE_T, FACE_N, 0.11, "secondary", MARK)
    bc = V3((0.14, -1.19, 3.73)) + FACE_T * 0.22 + FACE_N * 0.036
    V.surf_blk(L["service"], bc, X_, FACE_T, FACE_N, 0.16, 0.12, 0.006, "secondary", (0.26, 0.38, 0.62))
    V.surf_blk(L["service"], bc, X_, FACE_T, FACE_N, 0.10, 0.07, 0.009, "secondary", MARK)
    # sensors: the vision block, two lenses under the hood's brow, an antenna
    V.blk(L["sensors"], tuple(V3((-0.24, -0.98, 4.06))), (0.14, 0.1, 0.12), "glass", (0.20, 0.30, 0.24), ch=0.01, mid=True)
    for s in (-1, 1):
        V.cyl(L["sensors"], (s * 0.11, -0.80, 4.72), 0.045, 0.08, axis="y", n=10, mat="dark", col=FRAME)
        f = V.cyl(L["sensors"], (s * 0.11, -0.845, 4.72), 0.03, 0.01, axis="y", n=10, mat="glow", col=GLOW)
        H.glow_flag(f, L["sensors"])
    V.bar(L["sensors"], V3((-0.34, 1.0, 5.0)), V3((-0.38, 1.1, 5.75)), 0.012, "trim", BARE, 5)
    L.flush(part)
    return part


# --------------------------------------------------------------------------------------------------------------- arms
def shoulder_cap(L, s):
    am = lambda d=0.0, col=KHAKI, flag=0: arm_link(s, col, "primary", d, flag)  # noqa: E731
    up = shell(am, -0.02, 0.04)
    L.add("plates", panel(up, region(mx(rect(0.9, 1.6, -0.4, 0.6), s), "z", 4.40, 4.9), 0.035, "shoulder_cap"))
    L.add("plates", panel(up, region(mx(rect(0.9, 1.6, 3.9, 4.36), s), "y", -0.5, -0.10), 0.03, "shoulder_front"))


def arm_r():
    """The minigun arm (the mech's right, -X): a chamfered receiver beam, the 6-barrel gatling forward with three thick rings,
    a rubber reel on top, two olive drums under it, a yoke to the upper arm, a handle pipe arcing over."""
    s = -1
    part = new_part("Arm_R", V3((s * SHOULDER[0], SHOULDER[1], SHOULDER[2])), 61)
    L = Layers()
    L.add("frame", recol(arm_link(s, d=-0.04), PAL["frame"], "dark"))
    shoulder_cap(L, s)
    L.add("frame", mframe(recv_mass, -0.10, PAL["frame"]))
    L.add("frame", mframe(gun_mount, -0.06, PAL["frame"]))
    rm = lambda d=0.0, col=KHAKI, flag=0: recv_mass(d, col, flag)  # noqa: E731
    up = shell(rm, -0.06, 0.035)
    sh = shell(rm, -0.05, 0.0)
    L.add("plates", panel(up, region(rect(-2.6, -1.50, -0.5, 0.9), "z", 4.18, 4.8), 0.035, "recv_top",
                          cuts=[inset(V3((GX - 0.10, 0.20, 4.295)), Y_, X_, Z_, 0.40, 0.12)]))
    L.add("plates", panel(sh, region(rect(-0.6, 0.12, 3.70, 4.20), "x", -2.6, GX - 0.20), 0.035, "recv_out_front"))
    L.add("plates", panel(sh, region(rect(0.18, 0.9, 3.70, 4.20), "x", -2.6, GX - 0.20), 0.035, "recv_out_back"))
    L.add("plates", panel(sh, region(rect(-0.6, 0.9, 3.70, 4.20), "x", GX + 0.20, -1.5), 0.035, "recv_in"))
    L.add("plates", panel(shell(rm, -0.06, -0.02), region(rect(-2.6, -1.50, -0.6, 0.9), "z", 3.6, 3.86), 0.025, "recv_belly"))
    gm = lambda d=0.0, col=KHAKI, flag=0: gun_mount(d, col, flag)  # noqa: E731
    gsh = shell(gm, -0.05, 0.0)
    L.add("plates", panel(gsh, region(rect(-1.70, -1.20, -0.4, 0.9), "z", 4.30, 4.8), 0.03, "mount_top"))
    L.add("plates", panel(gsh, region(rect(-1.70, -1.20, 3.7, 4.30), "y", -0.4, 0.10), 0.03, "mount_front"))
    # an olive ammo feed box at the back (a purposeful rectilinear add-on)
    fb = V.blk(L["plates"], (GX, 0.92, 4.02), (0.46, 0.30, 0.34), "primary", OLIVE, ch=0.03, mid=True)
    H.tag_faces(L["plates"], fb or [], H.TAG_ADDON)
    fb = V.blk(L["plates"], (GX - 0.30, 0.30, 3.78), (0.14, 0.40, 0.20), "primary", OLIVE_D, ch=0.02, mid=True)
    H.tag_faces(L["plates"], fb or [], H.TAG_ADDON)
    # weapon: gatling, reel, drums
    g = P_("gatling")
    gatling(g, BARREL)
    L.add("weapon", g)
    reel = P_("reel")
    V.cyl(reel, REEL, 0.19, 0.48, axis="y", n=16, mat="primary", col=OLIVE)          # the reel in olive with a dark band
    for dy, c in ((-0.20, OLIVE_D), (0.0, FRAME), (0.20, OLIVE_D)):
        V.cyl(reel, (REEL[0], REEL[1] + dy, REEL[2]), 0.20, 0.05, axis="y", n=16, mat="trim", col=c)
    V.cyl(reel, (REEL[0], REEL[1] - 0.26, REEL[2]), 0.09, 0.05, axis="y", n=8, mat="trim", col=OLIVE)
    for y in (-0.04, 0.28):
        V.bar(reel, V3((REEL[0] - 0.22, y, 4.31)), V3((REEL[0] + 0.22, y, 4.31)), 0.03, "dark", FRAME, 6)
    L.add("weapon", reel)
    drums = P_("drums")
    for y in (0.0, 0.29):
        V.cyl(drums, (DRUM[0], y, DRUM[1]), 0.27, 0.27, axis="y", n=16, mat="primary", col=KHAKI2)      # drums khaki2, olive rims
        for dy in (-0.12, 0.12):
            V.cyl(drums, (DRUM[0], y + dy, DRUM[1]), 0.285, 0.035, axis="y", n=16, mat="trim", col=OLIVE)
        V.cyl(drums, (DRUM[0], y - 0.14, DRUM[1]), 0.12, 0.02, axis="y", n=8, mat="trim", col=OLIVE_D)
    L.add("weapon", drums)
    # actuation: the belt from the drums up into the receiver, pipes into the receiver, the handle pipe, an elbow ram
    belt = V.round_path([V3((GX - 0.28, 0.16, 3.42)), V3((GX - 0.36, 0.10, 3.70)), V3((GX - 0.30, -0.02, 3.90))], 0.1)
    V.tube_along(L["actuation"], belt, 0.045, "trim", (0.62, 0.55, 0.40), n=6)
    for p in belt[::2]:
        V.cyl(L["actuation"], tuple(p), 0.06, 0.03, axis="z", n=6, mat="trim", col=(0.55, 0.48, 0.34))
    H.pipe_bundle(L["actuation"], [V3((-1.20, 0.30, 3.98)), V3((-1.40, 0.36, 3.82)), V3((-1.62, 0.40, 3.86)),
                                   V3((-1.66, 0.62, 4.00))], Z_, 2, 0.022, cols=PIPE_COLS)
    V.pipe_run(L["actuation"], [V3((-1.44, 0.10, 4.48)), V3((-1.46, -0.22, 4.56)), V3((-1.56, -0.50, 4.36)),
                                V3((-1.66, -0.56, 4.10))], 0.035, "trim", V.shade(PAL["actuation"], 0.8), bend=0.12, clamps=0)
    H.ram(L["actuation"], V3((-1.10, 0.36, 4.06)), V3((-1.40, 0.50, 4.28)), 0.03, sleeve_col=PAL["actuation"], rod_col=BARE)
    H.bellows(L["seals"], V3((-0.94, 0.10, 4.34)), V3((-1.10, 0.10, 4.34)), 0.18, 0.18, folds=2, depth=0.02, n=12, col=PAL["seals"])
    # service: stencils and a hazard band over the gun
    K.stencil(L["service"], "01", V3((GX - 0.335, 0.48, 4.06)), -Y_, Z_, -X_, 0.12, "secondary", MARK)
    K.stencil(L["service"], "220", V3((-1.44, -0.13, 4.18)), X_, Z_, -Y_, 0.06, "secondary", MARK)
    K.hazard(L["service"], V3((GX, -0.43, 4.16)), X_, Z_, -Y_, 0.36, 0.06, 5, RED, MARK)
    L.flush(part)
    return part


def arm_l():
    """The rocket arm (the mech's left, +X): a tapered box with a leaning face, a 2 x 5 rack recessed in it, a collar where the
    arm enters, a big hub on the outer face, an elevation block under it."""
    s = 1
    part = new_part("Arm_L", V3((s * SHOULDER[0], SHOULDER[1], SHOULDER[2])), 62)
    L = Layers()
    L.add("frame", recol(arm_link(s, d=-0.04), PAL["frame"], "dark"))
    shoulder_cap(L, s)
    L.add("frame", recol(rocket_under(), PAL["frame"], "dark"))
    L.add("frame", H.prism(ellipse(-0.02, 4.50, 0.28, 0.28, 14), "x", 1.40, 1.55, "dark", PAL["frame"], "collar"))
    hub = H.prism(ellipse(-0.06, 4.52, 0.33, 0.33, 16), "x", 2.21, 2.33, "dark", V.shade(PAL["frame"], 1.2), "hub")
    H.carve(hub, [H.cut_rect(V3((2.33, -0.06, 4.52)), Y_, Z_, X_, 0.40, 0.40, depth=0.06, corner=0.2, slope=0.3, mat="dark",
                             col=V.shade(PAL["frame"], 0.7))], bevel=0.01)
    L.add("frame", hub)
    V.cyl(L["actuation"], (2.32, -0.06, 4.52), 0.12, 0.08, axis="x", n=12, mat="trim", col=PAL["actuation"])
    for k in range(8):
        a = 2 * math.pi * k / 8
        V.cyl(L["actuation"], (2.33, -0.06 + math.cos(a) * 0.26, 4.52 + math.sin(a) * 0.26), 0.025, 0.04, axis="x", n=6,
              mat="trim", col=BARE)
    rm = lambda d=0.0, col=KHAKI, flag=0: rocket_mass(d, col, flag)  # noqa: E731
    L.add("frame", mframe(rocket_mass, -0.12, PAL["frame"]))
    sh = shell(rm, -0.06, 0.0)
    up = shell(rm, -0.03, 0.035)
    thin = shell(rm, -0.06, -0.02)
    fc = V3((1.90, -0.98, 4.58))
    face_cut = H.cut_rect(fc, X_, V3((0, 0.112, 0.994)), RB_FACE_N, 0.56, 1.10, depth=0.18, corner=0.08, slope=0.15, mat="dark",
                          col=(0.09, 0.09, 0.085))
    L.add("plates", panel(up, region(rect(1.3, 2.5, 3.8, 5.4), "y", -1.3, -0.76), 0.045, "rb_face", cuts=[face_cut]))
    L.add("plates", panel(thin, region(rect(1.3, 2.5, -0.72, 1.0), "z", 5.08, 5.6), 0.035, "rb_top",
                          cuts=H.cut_vents(V3((1.72, -0.30, 5.165)), Y_, X_, Z_, 0.05, 0.22, 3, gap=0.6, depth=0.04, mat="dark",
                                           col=V.shade(PAL["heat"], 0.8))))
    L.add("plates", panel(sh, region(rect(-0.72, 0.05, 3.8, 5.06), "x", 2.0, 2.6), 0.04, "rb_out_front"))
    L.add("plates", panel(up, region(rect(0.11, 1.0, 3.8, 5.06), "x", 2.0, 2.6), 0.04, "rb_out_back",
                          cuts=[inset(V3((2.235, 0.50, 4.95)), Y_, Z_, V3((0.99, 0, 0.07)).normalized(), 0.26, 0.16)]))
    L.add("plates", panel(sh, region(rect(-0.72, 1.0, 3.8, 5.06), "x", 1.2, 1.80), 0.035, "rb_inner",
                          cuts=[groove(V3((1.585, 0.10, 4.58)), Z_, Y_, -X_, 0.9),
                                inset(V3((1.575, -0.30, 4.30)), Y_, Z_, -X_, 0.30, 0.40)]))
    L.add("plates", panel(thin, region(rect(1.3, 2.5, 3.8, 5.06), "y", 0.76, 1.3), 0.03, "rb_back"))
    L.add("plates", panel(thin, region(rect(1.3, 2.5, -0.72, 1.0), "z", 3.6, 4.06), 0.03, "rb_belly"))
    # add-on bricks on the outer flank, below the hub
    bricks(L, V3((2.292, 0.36, 4.12)), Y_, Z_, V3((0.995, 0, 0.07)).normalized(), 2, 2, (0.16, 0.14), col=KHAKI2)
    rk = P_("rockets")
    rockets(rk)
    L.add("weapon", rk)
    # pipes from the arm into the box's elevation block
    H.pipe_bundle(L["actuation"], [V3((1.20, 0.34, 3.98)), V3((1.40, 0.38, 3.82)), V3((1.56, 0.30, 3.74))], Z_, 2, 0.022,
                  cols=PIPE_COLS)
    K.hazard(L["service"], V3((1.585, -1.02, 4.58)), X_, V3((0, 0.112, 0.994)), RB_FACE_N, 0.05, 0.9, 7, RED, MARK)
    K.stencil(L["service"], "01", V3((2.262, 0.50, 4.62)), Y_, Z_, X_, 0.14, "secondary", MARK)  # +Y: reads left to right on the outer (+X) face
    V.cyl(L["sensors"], (2.0, -0.56, 3.86), 0.06, 0.12, axis="y", n=10, mat="dark", col=FRAME)
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
# the stance (skill: work posed, rig at rest). A weighted stance: the weight on the left leg (the pelvis shifted over it,
# dropped, rolled up on that side and turned), the right leg striding forward, the torso counter-turned, the guns raised
# unevenly. Fixed rotations are degrees, local XYZ euler on each joint empty; the legs are solved (H.solve) so each ankle lands
# on its target with the foot flat on the ground. Rest pose = all zero (the export default, easy to rig).
STANCE_FIXED = {"Pelvis": (0, -5, 4), "Torso": (2, 3, 6), "Arm_R": (-4, 0, 4), "Arm_L": (-16, 0, -6)}
STANCE_ROOT = (0.16, 0.05, -0.16)            # the pelvis over the planted leg, dropped
STANCE_LEGS = {"_L": {"thigh_pitch": 6, "ankle": (0.04, 0.28, 0.0), "foot_yaw": 6},       # planted, a little back
               "_R": {"thigh_pitch": -22, "ankle": (-0.10, -0.80, 0.0), "foot_yaw": -10}}  # striding forward
AXIS_LIMIT = {"Arm_R": 0.50, "Arm_L": 0.50}
STANCE_CACHE = {}


def fk(J, rots, root_loc=(0, 0, 0)):
    """World matrices of the joint empties (mirrors hierarchy(): parent @ T(offset) @ R(euler XYZ, radians))."""
    from mathutils import Euler
    W = {}
    for k in ORDER:
        par = PARENT[k]
        base = W[par] if par else Matrix.Translation(V3(root_loc))
        off = J[k] - (J[par] if par else V3())
        W[k] = base @ Matrix.Translation(off) @ Euler(rots.get(k, (0, 0, 0)), "XYZ").to_matrix().to_4x4()
    return W


def solve_stance():
    """Leg chains solved on the fixed pelvis / torso pose: thigh roll, shin and meta pitch put the ankle on its target (thigh
    pitch given), then the foot's local rotation keeps it flat with a yaw. Returns (rots in radians, root location, residuals)."""
    if STANCE_CACHE:
        return STANCE_CACHE["v"]
    from mathutils import Euler
    J = joints()
    rots = {k: tuple(math.radians(a) for a in v) for k, v in STANCE_FIXED.items()}
    res_out = {}
    for sfx, spec in STANCE_LEGS.items():
        target = J["Foot" + sfx] + V3(spec["ankle"])
        p1 = math.radians(spec["thigh_pitch"])

        def res(x, sfx=sfx, target=target, p1=p1):
            r = dict(rots)
            r["Thigh" + sfx], r["Shin" + sfx], r["Meta" + sfx] = (p1, x[0], 0.0), (x[1], 0.0, 0.0), (x[2], 0.0, 0.0)
            return list(fk(J, r, STANCE_ROOT)["Foot" + sfx].translation - target)
        x, err = H.solve(res, [0.0, 0.0, 0.0])
        rots["Thigh" + sfx], rots["Shin" + sfx], rots["Meta" + sfx] = (p1, x[0], 0.0), (x[1], 0.0, 0.0), (x[2], 0.0, 0.0)
        W = fk(J, rots, STANCE_ROOT)
        want = Euler((0, 0, math.radians(spec["foot_yaw"])), "XYZ").to_matrix()
        loc = W["Meta" + sfx].to_3x3().inverted() @ want
        rots["Foot" + sfx] = tuple(loc.to_euler("XYZ"))
        res_out[sfx] = {"residual_m": round(err, 5), "deg": {k + sfx: [round(math.degrees(a), 2) for a in rots[k + sfx]]
                                                              for k in ("Thigh", "Shin", "Meta", "Foot")}}
    STANCE_CACHE["v"] = (rots, STANCE_ROOT, res_out)
    return STANCE_CACHE["v"]


def leg_report():
    """The knock-knee check per leg at rest and in the stance (skill 6b): knee, hock and ankle world x, and how far the knee
    sits outboard of the hip-ankle line from the front (negative = knock-kneed), in world x (the pelvis turn is only 5 deg)."""
    J = joints()
    out = {}
    rots, root, res = solve_stance()
    for mode in ("rest", "stance"):
        W = fk(J, rots if mode == "stance" else {}, root if mode == "stance" else (0, 0, 0))
        for sfx, sd in (("_L", 1), ("_R", -1)):
            h, k, hk, a = (W[n + sfx].translation for n in ("Thigh", "Shin", "Meta", "Foot"))
            out.setdefault(sfx, {})[mode] = {"hip_x": round(h.x, 3), "knee_x": round(k.x, 3), "hock_x": round(hk.x, 3),
                                             "ankle_x": round(a.x, 3), "knee_out_of_line_m": round(H.leg_line(h, k, a, sd), 3)}
    for sfx in out:
        out[sfx]["solve"] = res[sfx]
    return out


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


def apply_pose(root, emp, mode=None):
    """Rotates the joint empties into the solved stance (the meshes stay at rest under them). mode None = POSE['mode']."""
    mode = mode or POSE["mode"]
    rots, loc, _ = solve_stance() if mode == "stance" else ({}, (0, 0, 0), None)
    for k, e in emp.items():
        e.rotation_euler = rots.get(k, (0.0, 0.0, 0.0))
    root.location = V3(loc)
    bpy.context.view_layer.update()


def build_parts():
    SKIN.clear()
    parts = [pelvis(), torso(), arm_l(), arm_r()]
    for s in (1, -1):
        parts += [thigh(s), shin(s), meta(s), foot(s)]
    return parts


def axis_report(objs):
    """Per part: the outer-skin share of the plate panels (the check; add-on bricks and stowage are not panels) and the kit's
    all-faces share for reference (it also counts region walls and inner skins, which are axis-aligned by construction)."""
    bpy.context.view_layer.update()
    sh = H.axis_aligned_share(objs, "plates", 3.0)
    out = {}
    for k, (v, a) in sorted(sh.items()):
        lim = AXIS_LIMIT.get(k, 0.25)
        ax, tot = SKIN.get(k, (0.0, 0.0))
        skin = ax / tot if tot else 0.0
        out[k] = {"share": round(skin, 3), "skin_area_m2": round(tot, 3), "all_faces_share": round(v, 3), "limit": lim,
                  "flag": skin > lim}
    return out


def build_full(layers=None):
    parts = build_parts()
    pieces = [pc for pt in parts for pc in pt.pieces()]
    K.bake_all(pieces, PAL, 3, ao_rays=12, ao_dist=0.5, wear=0.3, dust=0.2)
    root, emp, J = hierarchy("Rampart_v4")
    tris, objs = {}, []
    for pt in parts:
        for pc in pt.pieces():
            if layers is not None and H.layer_of(pc.name) not in layers:
                continue
            objs.append(K.emit(pc, emp[pt.name], V3()))
            tris[pc.name] = pc.tris
    axis = axis_report(objs) if layers is None or "plates" in layers else {}
    apply_pose(root, emp)
    by_part, by_layer = {}, {}
    for k, v in tris.items():
        pk, lk = k.split("__")
        by_part[pk] = by_part.get(pk, 0) + v
        by_layer[lk] = by_layer.get(lk, 0) + v
    rep = H.report()
    info = {"tris": tris, "tris_total": sum(tris.values()), "tris_by_part": by_part, "tris_by_layer": by_layer,
            "axis_aligned_plates": axis, "legs": leg_report(), "pose": POSE["mode"], "hskit": rep["stats"], "hskit_log": rep["log"]}
    return root, objs, info


def build_mass():
    root, emp, J = hierarchy("Rampart_v4_mass")
    tris, objs = {}, []
    for k, solids in mass_layer().items():
        pc = V.Piece(k + "__Mass", J[k], 1)
        for S in solids:
            H.commit(S, pc)
        K.bake_all([pc], PAL, 1, ao_rays=4, wear=0.0, dust=0.0, deep=2.0)
        objs.append(K.emit(pc, emp[k], V3()))
        tris[k] = pc.tris
    apply_pose(root, emp)
    return root, objs, {"tris": tris, "tris_total": sum(tris.values()), "pose": POSE["mode"], "hskit": H.report()["stats"]}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--mass", action="store_true")
    ap.add_argument("--pose", default="rest", choices=("rest", "stance"))
    ap.add_argument("--out", default=os.path.join(os.environ.get("TEMP", "."), "rampart_v4_out"))
    a = ap.parse_args(argv)
    POSE["mode"] = a.pose
    os.makedirs(a.out, exist_ok=True)
    V.clear_scene()
    root, objs, info = build_mass() if a.mass else build_full()
    name = "MechStudy_Rampart_v4" + ("_mass" if a.mass else "") + ("_stance" if a.pose == "stance" else "")
    V.export_fbx(root, os.path.join(a.out, name + ".fbx"))
    with open(os.path.join(a.out, name + ".json"), "w") as f:
        json.dump(info, f, indent=1)
    print("TRIS", info["tris_total"], json.dumps(info.get("tris_by_part", info["tris"])))
    if "axis_aligned_plates" in info:
        print("AXIS", json.dumps({k: v["share"] for k, v in info["axis_aligned_plates"].items()}))
    print("HSSTATS", json.dumps(H.report()["stats"]))
    print("LEGS", json.dumps(leg_report()))


if __name__ == "__main__":
    main()
