"""Rampart Siege: the heavy siege Rampart (Valhalla Munitions, "The Artillery Platform"), a variant on rampart_v4.

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-siege/rampart_siege.py -- [--mass] [--pose rest|stance]
        [--out DIR]
    export: node tools/blender/run.mjs tools/blender/mechs/studies/rampart/export_game.py --
        --model tools/blender/mechs/variants/rampart-siege/rampart_siege.py --out <scratch>/rampart-siege.fbx

From the old catalogue: legs.heavywalker (bulkier thighs, thighBulk 1.8; a wider stance, walkSpread x1.25) and the Heavy
Siege rails chassis gear (hull-side guns on single-joint arms, big recoil). Breakdown: docs/mechs/rampart-siege/.

What it changes on the Rampart (rampart_v4 is imported and patched; its build_full() runs our parts):
  * legs: new masses on a shorter, thicker digitigrade chain (hip 2.72 m, 0.92 m out; femur 1.44, shin 0.68, cannon
    0.85), never knock-kneed. The thigh is a big barrel with the signature form: ONE armoured thigh plate wrapping the pike
    front, the top and the outer-front facet down to a V over the knee (nothing cuts it). A tank side skirt (two shingled
    panels on standoffs) hangs off the thigh's outer face past the knee. Thicker shin and cannon (with a small skirt over
    the ankle rams); broad machine feet with three splayed toes on one hinge line and a heel spur.
  * hull and pelvis: the Rampart's, transformed (hull x1.12 wide, x0.88 tall and 0.37 m lower; pelvis x1.18 wide).
  * weapon: a siege cannon on each shoulder (the right modelled, the left its mirror, as the game does): cradle, a thick
    faceted mantlet, two big recoil cylinders over the barrel and a recuperator under it, a sleeved barrel with a fume
    extractor and a box muzzle brake, the breech at the back. A recoil collar at the mantlet is Part_PodSpin_R.
  * paint: Valhalla gunmetal slate over the Rampart's khaki family (a per-channel gain on every 'primary' face), hazard
    yellow and black on the knee guards and the cradle.
Units m, Z up, front -Y, the mech's left +X.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
RAMP = os.path.join(MECHS, "studies", "rampart")
for p in (os.path.join(MECHS, "studies", "military"), MECHS, RAMP, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import hskit as H  # noqa: E402
import mil_kit as K  # noqa: E402
from mil_kit import V  # noqa: E402
import rampart as HD1  # noqa: E402
import rampart_v4 as R  # noqa: E402
from rampart_v2 import ccw, mx, rrect, ellipse, hull2d, seg_profile, flagall, recol  # noqa: E402,F401

V3 = Vector
X_, Y_, Z_ = V3((1, 0, 0)), V3((0, 1, 0)), V3((0, 0, 1))
GREY = R.GREY
KHAKI, KHAKI_D, KHAKI2, OLIVE, OLIVE_D = R.KHAKI, R.KHAKI_D, R.KHAKI2, R.OLIVE, R.OLIVE_D
FRAME, BARE, MARK, PAL, PIPE_COLS = R.FRAME, R.BARE, R.MARK, R.PAL, R.PIPE_COLS
BARREL = (0.36, 0.36, 0.34)
YELLOW = (0.86, 0.66, 0.16)
# Valhalla gunmetal slate: every 'primary' face is multiplied by SLATE / KHAKI per channel, so the Rampart's khaki family
# (khaki, darker insets, greener guards, olive) keeps its relations in the new hue.
SLATE = (0.47, 0.49, 0.47)
GAIN = tuple(n / k for n, k in zip(SLATE, KHAKI))
HAS_WEAPON_LAYER = True
POSE = R.POSE
span, region, groove, pocket, pockets = HD1.span, HD1.region, HD1.groove, HD1.pocket, HD1.pockets
shell, panel, slab, scoop, inset, bricks, flanges, servo = R.shell, R.panel, R.slab, R.scoop, R.inset, R.bricks, R.flanges, R.servo
link_frame, link_mass, mframe, hl = R.link_frame, R.link_mass, R.mframe, R.hl
CACHE = {}


def cached(fn):
    """rampart_v4's cache, but our own dict: our masses share names with its (thigh_mass, shin_mass, ...)."""
    def w(*a, **kw):
        key = (fn.__name__, a, tuple(sorted(kw.items())))
        if key not in CACHE:
            CACHE[key] = fn(*a, **kw)
        return CACHE[key].copy(fn.__name__)
    w.__name__ = fn.__name__
    return w

# ------------------------------------------------------------------------------------------------------------ joints
ORIG = {"HIP_X": R.HIP_X, "HIP_Y": R.HIP_Y, "HIP_Z": R.HIP_Z, "WAIST": R.WAIST.copy(), "SHOULDER": R.SHOULDER,
        "K_": R.K_, "HK_": R.HK_, "A_": R.A_, "TH_SHEAR": R.TH_SHEAR}
HIP_X, HIP_Y, HIP_Z = 0.92, 0.0, 2.72
K_ = (0.24, -0.24, -1.40)          # knee, world z 1.32: forward of the hip, outboard of the hip-ankle line
HK_ = (0.30, 0.40, -1.62)          # hock (the reverse joint), world z 1.10, inside the cannon's top
A_ = (0.36, 0.08, -2.40)           # ankle, world z 0.32 (a tall broad foot), x 1.28
DZ_PELVIS = HIP_Z - ORIG["HIP_Z"]
PELV_SX = 1.18                     # the pelvis widened so its hip drums reach the wider-set hips


def T_torso(p):
    """The Rampart hull -> the siege hull: x1.12 wide, x0.88 tall about the waist, the waist 0.37 m lower."""
    return V3((p[0] * 1.12, p[1], 3.08 + (p[2] - 3.45) * 0.88))


L_TORSO = Matrix(((1.12, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0.88, 0), (0, 0, 0, 1)))
L_PELVIS = Matrix(((PELV_SX, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))


def T_pelvis(p):
    return V3((p[0] * PELV_SX, p[1], p[2] + DZ_PELVIS))


WAIST = T_torso(ORIG["WAIST"])
SHOULDER = tuple(T_torso(ORIG["SHOULDER"]))
GX, GZ = -1.86, 3.90               # the cannon's barrel axis

for k, v in {"HIP_X": HIP_X, "HIP_Y": HIP_Y, "HIP_Z": HIP_Z, "K_": K_, "HK_": HK_, "A_": A_, "TH_SHEAR": 0.0,
             "WAIST": WAIST, "SHOULDER": SHOULDER, "GX": GX, "GZ": GZ}.items():
    setattr(R, k, v)
R.STANCE_ROOT = (0.13, 0.04, -0.12)
R.STANCE_LEGS = {"_L": {"thigh_pitch": 6, "ankle": (0.04, 0.22, 0.0), "foot_yaw": 6},
                 "_R": {"thigh_pitch": -20, "ankle": (-0.08, -0.62, 0.0), "foot_yaw": -10}}
R.STANCE_FIXED = {"Pelvis": (0, -4, 4), "Torso": (2, 3, 6), "Arm_R": (-6, 0, 3), "Arm_L": (-3, 0, -3)}

hip, knee, hock, ankle, leg_M, joints = R.hip, R.knee, R.hock, R.ankle, R.leg_M, R.joints


class rampart_frame:
    """Inside: rampart_v4's own joint constants (to build its pelvis and hull where they were designed)."""

    def __enter__(self):
        self.keep = {k: getattr(R, k) for k in ORIG}
        for k, v in ORIG.items():
            setattr(R, k, v)

    def __exit__(self, *a):
        for k, v in self.keep.items():
            setattr(R, k, v)


def xform_part(part, lin, aff):
    """Moves a finished part (pieces hold verts relative to their origin): origin -> aff(origin), verts by lin."""
    o = aff(part.origin)
    for P in part.layers.values():
        if len(P.bm.verts):
            bmesh.ops.transform(P.bm, matrix=lin, verts=P.bm.verts[:])
        P.origin = V3(o)
    part.origin = V3(o)
    return part


def xform_solid_world(S, aff_lin, aff):
    for v in S.bm.verts:
        v.co = aff(v.co)
    return S


# =============================================================================================================== MASSES
# ---- thigh: a barrel loft (hip-local z stations), the outward lean built into the stations (no shear)
#            z,     xi,    xo,    yf,    yb
TH_ST = [(0.30, -0.06, 0.36, -0.22, 0.28),
         (0.20, -0.20, 0.56, -0.42, 0.46),
         (0.02, -0.28, 0.64, -0.52, 0.55),
         (-0.40, -0.26, 0.70, -0.56, 0.58),
         (-0.80, -0.20, 0.70, -0.56, 0.54),
         (-1.10, -0.10, 0.68, -0.52, 0.44),
         (-1.32, 0.00, 0.62, -0.46, 0.30),
         (-1.48, 0.10, 0.50, -0.32, 0.14)]


def th_outline(s, xi, xo, yf, yb):
    w, dp = xo - xi, yb - yf
    pts = [(xi + 0.10 * w, yf + 0.06 * dp), (xi + 0.45 * w, yf), (xi + 0.80 * w, yf + 0.05 * dp),   # a shallow pike front
           (xo, yf + 0.35 * dp),                                                                       # the prow apex
           (xo - 0.03 * w, yf + 0.65 * dp), (xo - 0.22 * w, yb), (xi + 0.25 * w, yb), (xi, yb - 0.22 * dp), (xi, yf + 0.25 * dp)]
    return ccw(hull2d([(s * x, y) for x, y in pts]))


def thigh_cuts(s, d, col=GREY):
    F = lambda x, y, z: V3((s * x, y, z))  # noqa: E731
    return [
        scoop(F(0.30, -0.42, -1.38), X_, V3((0, 0.8, -0.6)), V3((0, -0.6, -0.8)), 0.62, 0.30, 0.08, d, col=col),  # knee scoop
        slab(F(0.0, -0.30, 0.17), (0, -0.6, 0.8), d, col=col),                                              # top-front chamfer
        scoop(F(-0.28, 0.02, -0.02), Y_, Z_, -s * X_, 0.46, 0.36, 0.05, d, col=col),                       # inner hip scoop
        slab(F(0.0, 0.26, -1.22), (0, 0.6, -0.8), d, col=col),                                              # lower back chamfer
        slab(F(0.20, -0.57, -0.98), (0, -1, 0), d, w=2.0, h=0.40, u=X_, depth=0.026, col=col),             # front step
        slab(F(0.66, 0.40, -0.10), (s * 0.7, 0.7, 0.14), d, col=col),                                       # outer-back facet
        slab(F(-0.05, -0.50, -0.5), (-s * 0.6, -0.8, 0), d, col=col),                                       # front-inner facet
        slab(F(0.50, -0.30, 0.10), (s * 0.5, -0.5, 0.7), d, col=col),                                       # top-outer-front facet
    ]


@cached
def thigh_mass(s, d=0.0, col=GREY, flag=0, cuts=True):
    m = H.loft([(z, th_outline(s, *r)) for z, *r in TH_ST], "z", d, "primary", col, "thigh", flag)
    if cuts:
        H.carve(m, thigh_cuts(s, d, col), bevel=0.0)
        flagall(m, flag)
    return m


# ---- the thigh skirt (a tank side skirt): front view (x, z) with a lip turning in over the top, side view (y, z)
SK_FRONT = [(0.70, -0.36), (0.90, -0.40), (1.00, -1.80), (0.91, -1.82), (0.81, -0.52), (0.70, -0.47)]   # flares out 4 deg
SK_SIDE = [(-0.34, -0.38), (0.50, -0.38), (0.46, -1.58), (0.28, -1.80), (-0.30, -1.80), (-0.42, -1.58)]
SK_YAW = 6.0          # the skirt's front tucked in (deg), so a shot from ahead glances off it


def sk_M(s):
    """The skirt's toe-in: a turn about z through its hanger line (hip-local)."""
    c = V3((s * 0.85, 0.10, 0.0))
    return Matrix.Translation(c) @ Matrix.Rotation(math.radians(-s * SK_YAW), 4, "Z") @ Matrix.Translation(-c)


def sk_x(s, x, z):
    """The skirt's outer face x (hip-local, unsigned) at height z, before the toe-in."""
    return 0.90 + 0.10 * (-0.40 - z) / 1.40


def skirt_mass(s, col=KHAKI, flag=0, out=0.0):
    a = H.prism(mx([(x + out, z) for x, z in SK_FRONT], s), "y", -0.8, 0.8, "primary", col, "skf", 0.0, flag)
    b = H.prism(ccw(SK_SIDE), "x", *span(s * 0.5, s * 1.2), "primary", col, "sks", 0.0, flag)
    return H.xform(H.intersect([a, b], "skirt"), sk_M(s))


# ---- shin: a thick link knee -> hock
@cached
def shin_mass(s, d=0.0, col=GREY, flag=0):
    return link_mass(s, K_, HK_, 0.22, 0.22, 0.24, 0.08, d, col, flag, name="shin")


def knee_cap_mass(s, d=0.0, col=GREY, flag=0):
    M, _ = link_frame(s, K_, HK_)
    arc = [(0.30 * math.cos(math.radians(t)), 0.30 * math.sin(math.radians(t))) for t in range(140, 401, 26)]
    return H.xform(H.prism(ccw(hull2d(arc + [(0.0, 0.06)])), "x", -0.25, 0.25, "primary", col, "kneecap", d, flag), M)


# ---- the cannon (metatarsal + pod): a loft along the bone (hock -> ankle), a horn 0.42 m past the hock, a heel spur
#          t,     hw,   q front, q back
CAN_ST = [(-0.42, 0.10, 0.02, 0.20),
          (-0.33, 0.19, -0.08, 0.34),
          (-0.14, 0.27, -0.18, 0.38),
          (0.08, 0.29, -0.22, 0.38),
          (0.38, 0.28, -0.21, 0.32),
          (0.60, 0.24, -0.18, 0.27),
          (0.74, 0.19, -0.14, 0.22),
          (0.83, 0.12, -0.03, 0.26),
          (0.89, 0.07, 0.10, 0.30)]


def cannon_cuts(d, col=GREY):
    return [
        scoop(V3((0, 0.32, -0.21)), Y_, X_, -Z_, 0.50, 0.22, 0.10, d, corner=0.03, slope=0.3, col=col),     # front channel
        scoop(V3((0.285, 0.26, 0.07)), Y_, Z_, X_, 0.42, 0.18, 0.035, d, corner=0.04, slope=0.6, col=col),   # outer side recess
        scoop(V3((-0.285, 0.26, 0.07)), Y_, Z_, -X_, 0.42, 0.18, 0.035, d, corner=0.04, slope=0.6, col=col),
        slab(V3((0, -0.38, 0.10)), (0, -0.55, -0.83), d, col=col),                     # horn: the front-top wedge
        slab(V3((0, 0.66, 0.24)), (0, 0.45, 0.89), d, col=col),                         # heel step
    ]


@cached
def cannon_mass(s, d=0.0, col=GREY, flag=0, cuts=True):
    M, L = link_frame(s, HK_, A_)
    m = H.loft([(t, R.can_outline(hw, q0, q1)) for t, hw, q0, q1 in CAN_ST], "y", d, "primary", col, "cannon", flag)
    if cuts:
        H.carve(m, cannon_cuts(d, col), bevel=0.0)
    flagall(m, flag)
    return H.xform(m, M)


@cached
def meta_bone(s, d=0.0, col=GREY, flag=0):
    return link_mass(s, HK_, A_, 0.17, 0.14, 0.17, 0.05, d, col, flag, name="meta")


# ---- the foot: a broad low wedge, three toes splayed on one hinge line 0.24 m ahead of the foot point, a heel spur
SOLE = R.SOLE
TOE_S = [(-0.56, 0.0), (-0.12, 0.0), (0.05, 0.09), (0.05, 0.22), (-0.13, 0.27), (-0.42, 0.22), (-0.58, 0.12)]   # (y, z)
TOE_W, TOE_HINGE = 0.20, 0.24
TOES = [(-0.20, -20.0), (0.0, 0.0), (0.20, 20.0)]      # (root x across the foot, yaw: the tips splay outward)
HEEL_S = [(0.0, 0.0), (0.50, 0.0), (0.50, 0.07), (0.28, 0.20), (0.02, 0.28)]
FOOT_DX = 0.04
FB_W, FB_Y0, FB_Y1, FB_H = 0.31, -0.26, 0.34, 0.38


def toe_M(s, k):
    a = ankle(s)
    x0, yaw = TOES[k]
    return (Matrix.Translation(V3((a.x + s * FOOT_DX + s * x0, a.y - TOE_HINGE, SOLE))) @
            Matrix.Rotation(math.radians(yaw * s), 4, "Z"))


def toe_solid(s, k, d=0.0, col=GREY, mat="dark", flag=0):
    t = H.prism(ccw(TOE_S), "x", -TOE_W / 2, TOE_W / 2, mat, col, "toe", d, flag)
    return H.xform(t, toe_M(s, k))


def foot_body(s, d=0.0, col=GREY, mat="dark", flag=0):
    a = ankle(s)
    b = H.intersect([H.prism(rrect(-FB_W, FB_W, 0.0, FB_H, (0.05, 0.05, 0.12, 0.12), 2), "y", FB_Y0, FB_Y1, mat, col, "fb", d, flag),
                     H.prism(ccw([(FB_Y0, 0.0), (FB_Y1, 0.0), (FB_Y1, 0.24), (0.18, FB_H), (-0.08, FB_H), (FB_Y0, 0.20)]), "x",
                             -FB_W, FB_W, mat, col, "fbs", d, flag)], "foot_body")
    return H.xform(b, Matrix.Translation(V3((a.x + s * FOOT_DX, a.y, SOLE))))


def heel_solid(s, d=0.0, col=GREY, mat="dark", flag=0):
    a = ankle(s)
    return H.xform(H.prism(ccw(HEEL_S), "x", -0.12, 0.12, mat, col, "heel", d, flag),
                   Matrix.Translation(V3((a.x + s * FOOT_DX, a.y + 0.14, SOLE))))


def foot_mass(s, col=GREY, mat="dark"):
    a = ankle(s)
    parts = [toe_solid(s, k, col=col, mat=mat) for k in range(3)]
    drum = H.xform(H.prism(ellipse(0, 0, 0.16, 0.16, 10), "x", -0.20, 0.20, mat, col, "ankle_drum"), Matrix.Translation(a))
    return H.fuse([foot_body(s, col=col, mat=mat), heel_solid(s, col=col, mat=mat)] + parts + [drum], "foot", fillet=0.015,
                  segments=1)


# ---- the siege cannon (right pod, world). The barrel axis (GX, y, GZ) along -y.
def arm_link(col=GREY, mat="dark", d=0.0, flag=0):
    """The short single-joint upper arm from the shoulder drum to the yoke."""
    sz = SHOULDER[2]
    return H.intersect([H.prism(mx(rrect(1.12, 1.40, sz - 0.32, sz + 0.30, 0.07, 1), -1), "y", -0.26, 0.44, mat, col, "ua", d, flag),
                        H.prism(rrect(-0.26, 0.44, sz - 0.32, sz + 0.30, (0.10, 0.10, 0.15, 0.15), 1), "x", -1.40, -1.12, mat, col,
                                "ua_s", d, flag)], "upper_arm")


def oct_(y0, y1, z0, z1, c):
    return ccw([(y0 + c, z0), (y1 - c, z0), (y1, z0 + c), (y1, z1 - c), (y1 - c, z1), (y0 + c, z1), (y0, z1 - c), (y0, z0 + c)])


@cached
def yoke_mass(d=0.0, col=GREY, flag=0):
    return H.loft([(-1.60, oct_(-0.24, 0.66, GZ - 0.36, GZ + 0.36, 0.14)), (-1.34, oct_(-0.20, 0.62, GZ - 0.30, GZ + 0.44, 0.15))],
                  "x", d, "primary", col, "yoke", flag)


CR_ST = [(-0.40, (0.26, GZ - 0.26, GZ + 0.20, 0.10, 0.09)), (-0.30, (0.30, GZ - 0.30, GZ + 0.24, 0.12, 0.10)),
         (0.62, (0.30, GZ - 0.30, GZ + 0.24, 0.12, 0.10)), (0.92, (0.27, GZ - 0.24, GZ + 0.20, 0.12, 0.10)),
         (1.04, (0.21, GZ - 0.18, GZ + 0.14, 0.09, 0.08))]


@cached
def cradle_mass(d=0.0, col=GREY, flag=0):
    m = H.loft([(y, R.rcv_sect(*a)) for y, a in CR_ST], "y", d, "primary", col, "cradle", flag)
    H.carve(m, [scoop((GX - 0.30, 0.36, GZ + 0.02), Y_, Z_, -X_, 0.52, 0.24, 0.05, d, col=col),        # outer side channel
                slab((GX, -0.20, GZ + 0.24), (0, -0.55, 0.83), d, col=col),                           # top-front wedge
                slab((GX, 0.86, GZ - 0.26), (0, 0.6, -0.8), d, col=col),                              # rear belly chamfer
                slab((GX - 0.30, 0.0, GZ + 0.22), (-0.6, 0, 0.8), d, col=col)], bevel=0.0)            # outer top bevel
    flagall(m, flag)
    return m


def mant_outline(w, h, c, zc=GZ + 0.04):
    return ccw([(GX - w + c, zc - h), (GX + w - c, zc - h), (GX + w, zc - h + c), (GX + w, zc + h - c), (GX + w - c, zc + h),
                (GX - w + c, zc + h), (GX - w, zc + h - c), (GX - w, zc - h + c)])


#           y,     half w, half h, corner
MANT_ST = [(-0.34, 0.44, 0.40, 0.14), (-0.60, 0.44, 0.40, 0.14), (-0.72, 0.36, 0.32, 0.12), (-0.80, 0.22, 0.20, 0.07)]


@cached
def mantlet_mass(d=0.0, col=GREY, flag=0):
    m = H.loft([(y, mant_outline(w, h, c)) for y, w, h, c in MANT_ST], "y", d, "primary", col, "mantlet", flag)
    H.carve(m, [slab((GX, -0.50, GZ + 0.44), (0, -0.45, 0.89), d, col=col),         # a sloped glacis top
                slab((GX, -0.56, GZ - 0.36), (0, -0.6, -0.8), d, col=col),          # the chin
                slab((GX - 0.44, -0.56, GZ + 0.04), (-0.62, -0.78, 0), d, col=col),  # turret-cheek facets both sides
                slab((GX + 0.44, -0.56, GZ + 0.04), (0.62, -0.78, 0), d, col=col)], bevel=0.0)
    flagall(m, flag)
    return m


MUZZLE_Y = -2.76
SPIN_Y = -0.88


def barrel(S, col=BARREL):
    """The tube: a thermal sleeve with clamp bands, a fume extractor, the bare chase, a box muzzle brake (as solids)."""
    x, z = GX, GZ
    V.cyl(S, (x, -1.32, z), 0.135, 1.06, axis="y", n=10, mat="dark", col=V.shade(col, 1.08))           # thermal sleeve
    for y in (-1.02, -1.30, -1.80):
        V.cyl(S, (x, y, z), 0.152, 0.05, axis="y", n=10, mat="trim", col=V.shade(col, 1.4))             # clamp bands
    V.cyl(S, (x, -1.55, z), 0.175, 0.34, axis="y", n=12, mat="dark", col=V.shade(col, 0.95),
          profile=[(0.0, 0.80), (0.18, 1.0), (0.82, 1.0), (1.0, 0.80)])                                  # fume extractor
    V.cyl(S, (x, -1.60, z), 0.105, 1.50, axis="y", n=10, mat="dark", col=col)                          # the chase
    return S


def brake_solid(col=BARREL):
    b = H.prism(rrect(GX - 0.17, GX + 0.17, GZ - 0.13, GZ + 0.13, 0.04, 1), "y", MUZZLE_Y + 0.02, -2.32, "dark", col, "brake")
    cuts = []
    for sx in (-1, 1):
        cuts += H.cut_vents(V3((GX + sx * 0.17, -2.53, GZ)), Y_, Z_, sx * X_, 0.34, 0.16, 3, gap=0.45, depth=0.07, mat="dark",
                            col=(0.10, 0.10, 0.10))
    cuts.append(H.cut_rect(V3((GX, MUZZLE_Y + 0.02, GZ)), X_, Z_, -Y_, 0.15, 0.15, depth=0.16, corner=0.05, slope=0.2, mat="dark",
                           col=(0.06, 0.06, 0.06)))
    H.carve(b, cuts, bevel=0.008)
    return b


def collar(S, col=FRAME):
    """The recoil collar (the game's spinning piece): a ring round the barrel in front of the mantlet, six lugs."""
    V.cyl(S, (GX, SPIN_Y, GZ), 0.18, 0.08, axis="y", n=12, mat="trim", col=V.shade(PAL["actuation"], 1.0))
    for k in range(6):
        a = 2 * math.pi * k / 6 + math.pi / 6
        V.cyl(S, (GX + math.cos(a) * 0.15, SPIN_Y - 0.05, GZ + math.sin(a) * 0.15), 0.024, 0.03, axis="y", n=6, mat="trim",
              col=BARE)
    return S


# ============================================================================================================ the mass layer
def mass_layer():
    out = {}
    with rampart_frame():
        tor = [H.fuse([R.chest_mass(), R.rear_mass()], "torso_mass", fillet=0.02, segments=1), R.hood_mass()]
        for s in (1, -1):
            tor.append(R.pauldron_mass(s))
        pel = [R.pelvis_core(col=GREY), R.wing_mass(), R.skirt_mass(), R.rear_skirt_mass(), R.keel_mass()]
    out["Torso"] = [xform_solid_world(S, None, T_torso) for S in tor]
    out["Pelvis"] = [xform_solid_world(S, None, T_pelvis) for S in pel]
    for s, sfx in ((1, "_L"), (-1, "_R")):
        M = leg_M(s)
        out["Thigh" + sfx] = [H.xform(thigh_mass(s), M), H.xform(skirt_mass(s), M)]
        out["Shin" + sfx] = [H.xform(shin_mass(s), M)]
        out["Meta" + sfx] = [H.xform(cannon_mass(s), M)]
        out["Foot" + sfx] = [foot_mass(s)]
    gun = H.Solid("gun")
    barrel(gun, GREY)
    arm = [cradle_mass(), mantlet_mass(), yoke_mass(), arm_link(), gun, brake_solid(GREY)]
    out["Arm_R"] = arm
    out["Arm_L"] = [H.xform(S.copy("m"), Matrix.Scale(-1, 4, X_)) for S in arm]     # xform recalculates the normals
    return out


# ======================================================================================================= layers 1-10
new_part = R.new_part
Layers = HD1.Layers


def P_(name="s"):
    return H.Solid(name)


# ------------------------------------------------------------------------------------------------------------- thigh
def thigh(s):
    part = new_part("Thigh" + ("_L" if s > 0 else "_R"), hip(s), 10 + s)
    L = Layers()
    mf = lambda d=0.0, col=KHAKI, flag=0: thigh_mass(s, d, col, flag)  # noqa: E731
    F = lambda pts: mx(pts, s)  # noqa: E731
    P = lambda x, y, z: V3((s * x, y, z))  # noqa: E731
    kx, ky, kz = K_
    # frame: the mass shrunk by plate + rib depth, the hip drum, knee clevis cheeks, lightening pockets
    fr = mframe(thigh_mass, s, -0.20, PAL["frame"], 0, False)
    hipd = H.prism(ellipse(0, 0, 0.21, 0.21, 12), "x", *span(-s * 0.40, s * 0.02), "dark", V.shade(PAL["frame"], 1.15), "hipdrum")
    cheeks = [H.prism(rrect(ky - 0.18, ky + 0.22, kz - 0.14, kz + 0.34, (0.15, 0.15, 0.0, 0.0), 1), "x",
                      *span(s * (kx + e), s * (kx + e + 0.07)), "dark", PAL["frame"], "cheek") for e in (-0.27, 0.20)]
    fr = H.fuse([fr, hipd] + cheeks, "thigh_frame", fillet=0.02, segments=1)
    pockets(fr, [pocket(P(0.46, 0.10, z), Y_, Z_, s * X_, 0.24, 0.30, 0.05) for z in (-0.62, -1.02)])
    L.add("frame", fr)
    # mounting: deep flange hoops under the back gap and the V seam, stringers; the skirt's hanger brackets
    flanges(L, thigh_mass(s, -0.07, PAL["mounting"], 0, False), [(V3((0, 0, z)), Z_) for z in (-0.74, -0.62)], 16, 0.12, 0.05,
            stringers=(0, 4, 8, 12))
    for z in (-0.56, -1.12):
        for y in (0.0, 0.22, 0.42):
            V.bar(L["mounting"], P(0.60, y, z), sk_M(s) @ P(0.86, y, z - 0.02), 0.035, "sand", PAL["mounting"], 6)
            V.blk(L["mounting"], tuple(sk_M(s) @ P(0.81, y, z - 0.02)), (0.05, 0.12, 0.14), "sand", PAL["mounting"], ch=0.01,
                  mid=True)
    # plates
    front = shell(mf, -0.08, 0.035)
    sh = shell(mf, -0.06, 0.0)
    thin = shell(mf, -0.07, -0.03)
    nf = V3((0, -1, 0))
    surf = H.Surface(thigh_mass(s))
    onf = lambda x, z: surf.project(P(x, -1.5, z), along=Y_)  # noqa: E731
    # THE SIGNATURE FORM: one armoured thigh plate over the top-front, the pike front and the outer-front facet, down to a V
    # over the knee. Region A (front view, the V) intersected with region B (top view, its back edge wrapping the prow).
    V_EDGE = [(-0.60, -0.98), (-0.45, -1.04), (-0.05, -1.15), (0.28, -1.20), (0.55, -1.12), (0.95, -0.99), (1.20, -0.90)]
    regA = region(F([(-0.60, 0.70)] + V_EDGE + [(1.20, 0.70)]), "y", -1.0, 0.6)
    B_EDGE = [(1.20, 0.04), (0.50, -0.10), (-0.60, -0.10)]
    regB = H.prism(F([(-0.60, -1.0), (1.20, -1.0)] + B_EDGE), "z", -2.0, 1.0, "primary", V.shade(KHAKI, 0.85), "region", 0.0,
                   HD1.F_REGION)
    (pi, ni) = onf(0.18, -0.52)
    L.add("plates", panel(front, H.intersect([regA, regB], "sig_region"), 0.05, "thigh_plate",
                          cuts=[inset(pi + ni * 0.035, X_, Z_, ni, 0.34, 0.30)]))
    # Valhalla rivets along its top and over its V edge (they hold it on; nothing cuts it)
    for x in (-0.10, 0.06, 0.22, 0.38, 0.54):
        (pr, nr) = onf(x, -0.06)
        V.bolt(L["service"], pr + nr * 0.035, nr, r=0.024, h=0.024, col=BARE)
    for (xa, za), (xb, zb) in zip(V_EDGE[2:4], V_EDGE[3:5]):
        for t in (0.25, 0.75):
            (pr, nr) = onf(xa + (xb - xa) * t, za + (zb - za) * t + 0.08)
            V.bolt(L["service"], pr + nr * 0.035, nr, r=0.022, h=0.022, col=BARE)
    # around it: the knee guard under the V (the seam follows it), the top over the hip, the inner plate, the outer upper
    # plate behind the prow, two thin back plates with the flange gap between them
    L.add("plates", panel(sh, region(F([(x, z - 0.045) for x, z in V_EDGE] + [(1.20, -1.66), (-0.60, -1.66)]), "y", -1.0, -0.10),
                          0.04, "thigh_knee_guard"))
    L.add("plates", panel(thin, H.prism(F([(-0.60, -0.06), (0.50, -0.06), (1.20, 0.08), (1.20, 0.8), (-0.60, 0.8)]), "z", 0.16, 0.9,
                                        "primary", V.shade(KHAKI, 0.85), "region", 0.0, HD1.F_REGION), 0.03, "thigh_top"))
    L.add("plates", panel(sh, region(rect_yz(-0.06, 0.62, -1.46, 0.12), "x", *span(-s * 1.0, s * 0.05)), 0.035, "thigh_inner",
                          cuts=[groove(P(-0.265, 0.30, -0.70), Z_, Y_, -s * X_, 0.6),
                                inset(P(-0.255, 0.20, -1.10), Y_, Z_, -s * X_, 0.24, 0.24)]))
    L.add("plates", panel(sh, region(rect_yz(0.02, 0.30, -0.45, 0.12), "x", *span(s * 0.45, s * 1.2)), 0.035, "thigh_outer"))
    L.add("plates", panel(thin, region(F(HD1.rect(0.10, 1.2, -0.62, 0.12)), "y", 0.34, 1.0), 0.03, "thigh_back_up"))
    L.add("plates", panel(thin, region(F(HD1.rect(0.10, 1.2, -1.42, -0.74)), "y", 0.30, 1.0), 0.03, "thigh_back_low"))
    # the side skirt: two shingled panels (the upper stood out 3.5 cm over the lower), bolt rows on the hanger line
    up = skirt_mass(s, out=0.035)
    lo = skirt_mass(s)
    SM = sk_M(s)
    nsk = (SM.to_3x3() @ V3((s * 0.9975, 0, 0.071))).normalized()
    SP = lambda y, z, out=0.0: SM @ P(sk_x(s, 0, z) + out, y, z)  # noqa: E731  (a point on the skirt's outer face)
    side_in = H.convex_offset(ccw(SK_SIDE), -0.012)       # the regions sit just inside the skirt, so every rim is chamfered
    uy = (SM.to_3x3() @ Y_).normalized()
    L.add("plates", panel(up, H.xform(region(clip_z(side_in, -1.04, 1.0), "x", *span(s * 0.5, s * 1.3)), SM), 0.04, "skirt_up",
                          cuts=[inset(SP(0.24, -0.70, 0.035), uy, Z_, nsk, 0.30, 0.34)]))
    L.add("plates", panel(lo, H.xform(region(clip_z(side_in, -2.5, -0.98), "x", *span(s * 0.5, s * 1.3)), SM), 0.04, "skirt_low",
                          cuts=[inset(SP(-0.02, -1.44), uy, Z_, nsk, 0.46, 0.22)]))
    vmark(L["service"], SP(0.24, -0.70, 0.035 - 0.03 + 0.004), uy * -s, Z_, nsk, 0.20)
    for z, out in ((-0.56, 0.035), (-1.12, 0.0)):
        V.bolt_row(L["service"], SP(-0.24, z, out), SP(0.40, z, out), 4, nsk, r=0.02, col=BARE)
    H.rungs(L["service"], SP(0.30, -1.62), SP(0.30, -1.20), 2, nsk, width=0.20, depth=0.07, r=0.016)
    # actuation: the knee ram down the outer face behind the skirt, a pipe bundle down the inner-back corner into the knee,
    # a hose looping across the knee
    H.ram(L["actuation"], P(0.62, 0.20, -0.20), P(0.56, 0.02, -1.22), 0.065, sleeve_col=PAL["actuation"], rod_col=BARE)
    H.pipe_bundle(L["actuation"], [P(-0.04, 0.50, -0.10), P(-0.03, 0.54, -0.45), P(0.00, 0.50, -0.85), P(0.06, 0.36, -1.20),
                                   P(0.10, 0.14, -1.46), P(0.14, -0.04, -1.56)], V3((s * 0.7, -0.7, 0)), 3, 0.026, cols=PIPE_COLS)
    V.pipe_run(L["actuation"], [P(0.36, 0.22, -1.34), P(0.40, 0.36, -1.62), P(0.36, 0.44, -1.72)], 0.034, "trim",
               V.shade(PAL["actuation"], 0.9), bend=0.12, clamps=1)
    # power: hamstring bundles behind the back gap
    for x in (0.20, 0.34, 0.48):
        V.tube_along(L["power"], V.round_path([P(x, 0.46, -0.45), P(x, 0.55, -0.70), P(x, 0.44, -1.05)], 0.12), 0.05, "dark",
                     PAL["power"], n=6)
    # seals: the hip boot toward the pelvis
    H.bellows(L["seals"], P(-0.22, -0.02, 0.0), P(-0.40, -0.02, 0.0), 0.22, 0.22, folds=2, depth=0.022, n=12, col=PAL["seals"])
    # service: the hull number in the plate's inset, a hazard band on the knee guard, a red tag
    K.stencil(L["service"], "13", pi + ni * 0.012, X_, Z_, ni, 0.16, "secondary", MARK)
    (pk, nk) = onf(-0.16, -1.26)
    K.hazard(L["service"], pk + nk * 0.008, X_, Z_, nk, 0.24, 0.08, 4, YELLOW, (0.14, 0.13, 0.12))
    L.flush(part, leg_M(s))
    return part


def vmark(P, c, u, v, n, h, col=YELLOW):
    """Valhalla's mark: a stencilled V (two slanted paint bars), symmetric so it survives the game's mirrored pod."""
    u, v, n = V3(u).normalized(), V3(v).normalized(), V3(n).normalized()
    for k in (-1, 1):
        a, b = c + u * k * h * 0.36 + v * h * 0.5, c - v * h * 0.5
        d = (a - b).normalized()
        V.surf_blk(P, (a + b) / 2, n.cross(d).normalized(), d, n, h * 0.17, (a - b).length + h * 0.08, 0.004, "secondary", col)


def rect_yz(y0, y1, z0, z1):
    return HD1.rect(y0, y1, z0, z1)


def clip_z(pts, z0, z1):
    """A 2D outline (u, z) clipped to z0 <= z <= z1 (Sutherland-Hodgman on two horizontal lines)."""
    def clip(poly, keep, zc):
        out = []
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            ia, ib = keep(a), keep(b)
            if ia:
                out.append(a)
            if ia != ib:
                t = (zc - a[1]) / (b[1] - a[1])
                out.append((a[0] + t * (b[0] - a[0]), zc))
        return out
    return ccw(clip(clip(list(pts), lambda q: q[1] >= z0, z0), lambda q: q[1] <= z1, z1))


# -------------------------------------------------------------------------------------------------------------- shin
def shin(s):
    part = new_part("Shin" + ("_L" if s > 0 else "_R"), knee(s), 20 + s)
    L = Layers()
    mf = lambda d=0.0, col=KHAKI2, flag=0: shin_mass(s, d, col, flag)  # noqa: E731
    M, Ln = link_frame(s, K_, HK_)
    RG = lambda outline, axis, a0, a1, col=KHAKI2: R.region_in(H.prism(ccw(outline), axis, a0, a1, "primary", col, "region", 0.0,  # noqa
                                                                       HD1.F_REGION), M)
    fr = mframe(shin_mass, s, -0.07, PAL["frame"])
    kd = H.xform(H.prism(ellipse(0, 0, 0.19, 0.19, 12), "x", -0.30, 0.30, "dark", V.shade(PAL["frame"], 1.15), "kneedrum"), M)
    hd = H.xform(H.prism(ellipse(Ln, 0, 0.17, 0.17, 12), "x", -0.27, 0.27, "dark", V.shade(PAL["frame"], 1.15), "hockdrum"), M)
    fr = H.fuse([fr, kd, hd], "shin_frame", fillet=0.015, segments=1)
    L.add("frame", fr)
    for sx in (-1, 1):       # flat side links knee -> hock (they carry the load), lightening slots
        lk = H.xform(H.prism(rrect(-0.06, Ln + 0.06, 0.02, 0.21, 0.05, 1), "x", *span(sx * 0.245, sx * 0.275), "dark",
                             V.shade(PAL["frame"], 1.25), "shin_link"), M)
        H.carve(lk, [H.xform(H.cut_rect(V3((sx * 0.275, Ln * 0.5, 0.115)), Y_, Z_, sx * X_, Ln * 0.40, 0.08, depth=0.05,
                                        corner=0.03, slope=0.0, mat="dark", col=V.shade(PAL["frame"], 0.6)), M)], bevel=0.0)
        L.add("frame", lk)
        servo(L, M, sx * 0.30, 0.19, 0.08, sx, name="knee_servo")
    km = lambda d=0.0, col=KHAKI, flag=0: knee_cap_mass(s, d, col, flag)  # noqa: E731
    kc = shell(km, -0.05, 0.0)
    L.add("plates", panel(kc, RG(HD1.rect(-0.5, 0.5, -0.5, 0.05), "x", -0.23, 0.23, KHAKI), 0.035, "knee_cap",
                          cuts=[H.xform(inset(V3((0, 0.02, -0.298)), X_, Y_, -Z_, 0.20, 0.14, OLIVE, depth=0.022), M)]))
    sh = shell(mf, -0.05, 0.0, KHAKI2)
    upp = shell(mf, -0.03, 0.035, KHAKI2)
    L.add("plates", panel(upp, RG([(-0.4, 0.34), (-0.20, 0.33), (0.0, 0.36), (0.20, 0.33), (0.4, 0.34), (0.4, Ln - 0.07),
                                   (-0.4, Ln - 0.07)], "z", -0.6, -0.10), 0.03, "shin_front"))
    for sx in (-1, 1):
        L.add("plates", panel(sh, RG([(0.20, -0.18), (Ln - 0.06, -0.18), (Ln - 0.02, 0.03), (0.32, 0.03)], "x",
                                     *span(sx * 0.10, sx * 0.6)), 0.025, "shin_side"))
    kx, ky, kz = K_
    H.ram(L["actuation"], hl(s, (kx + 0.02, ky + 0.10, kz - 0.24)), hl(s, (HK_[0] - 0.02, HK_[1], HK_[2] - 0.19)), 0.05,
          sleeve_col=PAL["actuation"], rod_col=BARE)
    H.pipe_bundle(L["actuation"], [M @ V3((s * 0.26, -0.05, 0.17)), M @ V3((s * 0.28, Ln * 0.5, 0.21)),
                                   M @ V3((s * 0.26, Ln + 0.05, 0.17))], (M.to_3x3() @ Z_), 2, 0.022, cols=PIPE_COLS)
    kn = hl(s, K_)
    H.bellows(L["seals"], kn + V3((-0.26, -0.10, 0.13)), kn + V3((0.26, -0.10, 0.13)), 0.12, 0.12, folds=3, depth=0.02, n=10,
              col=PAL["seals"])
    L.flush(part, leg_M(s))
    return part


# -------------------------------------------------------------------------------------------------- the cannon (meta)
def meta(s):
    part = new_part("Meta" + ("_L" if s > 0 else "_R"), hock(s), 25 + s)
    L = Layers()
    M, Ln = link_frame(s, HK_, A_)
    RG = lambda x0, x1, z0, z1, y0, y1, col=KHAKI: R.region_in(H.prism(HD1.rect(x0, x1, z0, z1), "y", y0, y1, "primary", col,  # noqa
                                                                       "region", 0.0, HD1.F_REGION), M)
    core = mframe(cannon_mass, s, -0.15, PAL["frame"], 0, False)
    bone = mframe(meta_bone, s, 0.0, PAL["frame"])
    hd = H.xform(H.prism(ellipse(0.0, 0.0, 0.19, 0.19, 12), "x", -0.30, 0.30, "dark", V.shade(PAL["frame"], 1.15), "hock"), M)
    L.add("frame", H.fuse([core, bone, hd], "meta_frame", fillet=0.015, segments=1))
    flanges(L, cannon_mass(s, -0.065, PAL["mounting"], 0, False),
            [(M @ V3((0, t, 0)), (M.to_3x3() @ Y_).normalized()) for t in (-0.11, 0.32)], 14, 0.10, 0.045, stringers=(3, 10))
    cm = lambda d=0.0, col=KHAKI, flag=0: cannon_mass(s, d, col, flag)  # noqa: E731
    co = lambda d=0.0, col=OLIVE, flag=0: cannon_mass(s, d, col, flag)  # noqa: E731
    cg = lambda d=0.0, col=KHAKI2, flag=0: cannon_mass(s, d, col, flag)  # noqa: E731
    horn = shell(co, -0.07, 0.03, OLIVE)
    pup = shell(cm, -0.07, 0.035)
    plo = shell(cm, -0.06, 0.0)
    gsh = shell(cg, -0.05, 0.0, KHAKI2)
    L.add("plates", panel(horn, RG(-0.6, 0.6, -0.6, 0.6, -0.8, -0.13, OLIVE), 0.04, "horn",
                          cuts=[H.xform(inset(V3((0, -0.30, 0.36)), Y_, X_, Z_, 0.14, 0.16, OLIVE_D), M)]))
    L.add("plates", panel(pup, RG(-0.6, 0.6, -0.02, 0.6, -0.09, 0.30), 0.04, "pod_up",
                          cuts=[H.xform(inset(V3((0.32, 0.10, 0.12)), Y_, Z_, X_, 0.26, 0.13), M),
                                H.xform(inset(V3((-0.32, 0.10, 0.12)), Y_, Z_, -X_, 0.26, 0.13), M)]))
    L.add("plates", panel(plo, RG(-0.6, 0.6, -0.02, 0.6, 0.34, 1.2), 0.035, "pod_low"))
    L.add("plates", panel(shell(cm, 0.035, 0.065), RG(-0.11, 0.11, 0.1, 0.6, -0.06, 0.16), 0.02, "pod_cap"))
    for x0, x1 in ((0.08, 0.6), (-0.6, -0.08)):
        L.add("plates", panel(gsh, RG(x0, x1, -0.6, -0.06, 0.02, 0.70, KHAKI2), 0.03, "cannon_guard"))
    # the lower-leg skirt: a stand-off plate over the outer side (the bone frame's x is world +X on both legs), on two brackets
    CSK = [(0.20, -0.16), (0.72, -0.14), (0.70, 0.30), (0.26, 0.34)]
    sk = H.xform(H.prism(ccw(CSK), "x", *span(s * 0.36, s * 0.42), "primary", KHAKI2, "csk"), M)
    creg = R.region_in(H.prism(ccw(H.convex_offset(ccw(CSK), -0.012)), "x", -0.6, 0.6, "primary", KHAKI2, "region", 0.0,
                               HD1.F_REGION), M)
    L.add("plates", panel(sk, creg, 0.025, "cannon_skirt"))
    for t in (0.30, 0.60):
        V.bar(L["mounting"], M @ V3((s * 0.27, t, 0.08)), M @ V3((s * 0.37, t, 0.08)), 0.03, "sand", PAL["mounting"], 6)
    V.bolt_row(L["service"], M @ V3((s * 0.42, 0.26, -0.08)), M @ V3((s * 0.42, 0.66, -0.06)), 3, (M.to_3x3() @ X_) * s, r=0.016,
               col=BARE)
    for x in (-0.07, 0.07):
        H.ram(L["actuation"], M @ V3((x, 0.06, -0.15)), M @ V3((x, 0.56, -0.15)), 0.038, sleeve_col=PAL["actuation"], rod_col=BARE)
    H.pipe_bundle(L["actuation"], [M @ V3((0.26, -0.05, 0.05)), M @ V3((0.275, 0.26, 0.05)), M @ V3((0.26, 0.52, 0.04)),
                                   M @ V3((0.20, 0.72, -0.02))], (M.to_3x3() @ Z_), 2, 0.022, cols=PIPE_COLS, clamp_every=0.25)
    for x in (-0.15, 0.15):
        V.tube_along(L["power"], V.round_path([M @ V3((x, 0.12, -0.05)), M @ V3((x * 1.1, Ln * 0.5, -0.04)),
                                               M @ V3((x, Ln * 0.80, -0.05))], 0.1), 0.045, "dark", PAL["power"], n=6)
    for sx in (-1, 1):
        servo(L, M, sx * 0.29, 0.17, 0.07, sx, name="hock_servo")
    L.flush(part, leg_M(s))
    return part


# -------------------------------------------------------------------------------------------------------------- foot
def foot(s):
    a = ankle(s)
    cx = a.x + s * FOOT_DX
    part = new_part("Foot" + ("_L" if s > 0 else "_R"), a, 30 + s)
    L = Layers()
    drum = H.xform(H.prism(ellipse(0, 0, 0.16, 0.16, 10), "x", -0.20, 0.20, "dark", V.shade(PAL["frame"], 1.15), "ankle_drum"),
                   Matrix.Translation(a))
    L.add("frame", H.fuse([foot_body(s, col=PAL["frame"]), heel_solid(s, col=PAL["frame"]), drum], "foot_frame", fillet=0.015,
                          segments=1))
    fm = lambda d=0.0, col=KHAKI, flag=0: flagall(recol(foot_body(s, d, col, "primary"), col, "primary"), flag)  # noqa: E731
    L.add("plates", panel(shell(fm, -0.02, 0.03), region(ccw([(a.y + FB_Y0 - 0.1, SOLE + 0.19), (a.y + FB_Y1, SOLE + 0.27),
                                                                (a.y + FB_Y1, 0.9), (a.y + FB_Y0 - 0.1, 0.9)]), "x", cx - 0.5, cx + 0.5),
                          0.025, "foot_top", cuts=[inset(V3((cx, a.y + 0.05, SOLE + FB_H + 0.03)), X_, Y_, Z_, 0.30, 0.16)]))
    hm = lambda d=0.0, col=OLIVE, flag=0: flagall(recol(heel_solid(s, d, col, "primary"), col, "primary"), flag)  # noqa: E731
    L.add("plates", panel(shell(hm, -0.02, 0.025, OLIVE), region(HD1.rect(-9, 9, -9, 9), "z", SOLE + 0.10, 0.8, OLIVE), 0.015,
                          "heel_cap"))
    for k in range(3):
        TM = toe_M(s, k)
        L.add("frame", toe_solid(s, k, col=V.shade(PAL["frame"], 1.08)))
        tm = lambda d=0.0, col=KHAKI, flag=0, k=k: toe_solid(s, k, d, col, "primary", flag)  # noqa: E731
        cap = shell(tm, -0.02, 0.035)
        L.add("plates", panel(cap, H.xform(region(ccw([(-0.66, 0.10), (-0.08, 0.17), (-0.08, 0.6), (-0.66, 0.6)]), "x", -0.4, 0.4),
                                           TM), 0.018, "toe_cap"))
        ax = (TM.to_3x3() @ X_).normalized()
        hc = TM @ V3((0, 0.0, 0.11))
        V.bar(L["actuation"], hc - ax * 0.12, hc + ax * 0.12, 0.085, "trim", PAL["actuation"], 10)
        for e in (-1, 1):
            V.bar(L["actuation"], hc + ax * e * 0.12, hc + ax * e * 0.14, 0.05, "trim", V.shade(PAL["actuation"], 1.2), 8)
        root = V3((cx + s * TOES[k][0] * 0.6, a.y - 0.10, SOLE + FB_H - 0.02))
        H.ram(L["actuation"], root, TM @ V3((0, -0.28, 0.27)), 0.026, sleeve_col=PAL["actuation"], rod_col=BARE)
        for t0, t1 in ((-0.56, -0.38), (-0.34, -0.14)):
            pad = P_("pad")
            V.blk(pad, (0, (t0 + t1) / 2, -SOLE), (TOE_W - 0.03, t1 - t0, SOLE + 0.012), "tyre", R.RUBBER, ch=0.008)
            L.add("seals", H.xform(pad, TM))
    for y0 in (-0.20, 0.02, 0.22):
        for x0 in (-0.19, 0.0, 0.19):
            V.blk(L["seals"], (cx + x0, a.y + y0, 0.0), (0.16, 0.16, SOLE + 0.012), "tyre", R.RUBBER, ch=0.008)
    V.blk(L["seals"], (cx, a.y + 0.44, 0.0), (0.20, 0.26, SOLE + 0.012), "tyre", R.RUBBER, ch=0.008)
    for e in (-1, 1):
        tb = H.prism(rrect(a.y - 0.18, a.y + 0.18, SOLE + 0.22, a.z + 0.12, (0.0, 0.0, 0.07, 0.07), 1), "x",
                     *span(a.x + e * 0.20, a.x + e * 0.27), "dark", V.shade(PAL["frame"], 1.25), "trunnion")
        L.add("frame", tb)
        V.bolt(L["service"], a + V3((e * 0.27, 0, 0)), V3((e, 0, 0)), r=0.045, h=0.03, col=BARE)
        H.ram(L["actuation"], a + V3((e * 0.14, 0.28, 0.52)), V3((cx + e * 0.14, a.y + 0.34, SOLE + 0.24)), 0.036,
              sleeve_col=PAL["actuation"], rod_col=BARE)
    H.bellows(L["seals"], a + V3((0, -0.02, 0.10)), a + V3((0, -0.02, 0.32)), 0.14, 0.13, folds=2, depth=0.02, n=10, col=PAL["seals"])
    V.pipe_run(L["actuation"], [a + V3((s * 0.12, 0.26, 0.70)), a + V3((s * 0.25, 0.24, 0.36)), a + V3((s * 0.21, 0.10, 0.12))],
               0.03, "trim", V.shade(PAL["actuation"], 0.85), bend=0.1, clamps=1)
    L.flush(part)
    return part


# ------------------------------------------------------------------------------------------------- pelvis and hull
def pelvis():
    with rampart_frame():
        part = R.pelvis()
    return xform_part(part, L_PELVIS, T_pelvis)


def torso():
    with rampart_frame():
        part = R.torso()
    xform_part(part, L_TORSO, T_torso)
    # Valhalla ignores avionics: the Rampart's whip antenna goes (the sensor faces above the hood)
    sen = part.layers.get("sensors")
    if sen is not None:
        oz, seen, drop = sen.origin.z, set(), []
        for f in sen.bm.faces:          # whole loose parts only, so no open caps are left
            if f in seen:
                continue
            stack, group = [f], []
            seen.add(f)
            while stack:
                g = stack.pop()
                group.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h not in seen:
                            seen.add(h)
                            stack.append(h)
            if max(v.co.z for g in group for v in g.verts) + oz > 4.55:
                drop += group
        bmesh.ops.delete(sen.bm, geom=drop, context="FACES")
    return part


# --------------------------------------------------------------------------------------------------------------- arms
def arm_r():
    """The siege cannon (the mech's right, -X)."""
    s = -1
    part = new_part("Arm_R", V3((-SHOULDER[0], SHOULDER[1], SHOULDER[2])), 61)
    L = Layers()
    sz = SHOULDER[2]
    # frame: the upper arm, the yoke and cradle cores, the breech
    L.add("frame", recol(arm_link(d=-0.04), PAL["frame"], "dark"))
    L.add("frame", mframe(cradle_mass, -0.10, PAL["frame"]))
    L.add("frame", mframe(yoke_mass, -0.06, PAL["frame"]))
    L.add("frame", mframe(mantlet_mass, -0.12, PAL["frame"]))
    br = H.prism(rrect(GX - 0.17, GX + 0.17, GZ - 0.16, GZ + 0.16, 0.05, 1), "y", 1.00, 1.22, "dark", V.shade(PAL["frame"], 1.2), "breech")
    H.carve(br, [H.cut_rect(V3((GX, 1.22, GZ)), X_, Z_, Y_, 0.20, 0.20, depth=0.05, corner=0.07, slope=0.3, mat="dark",
                            col=V.shade(PAL["frame"], 0.7))], bevel=0.01)
    L.add("frame", br)
    V.cyl(L["actuation"], (GX, 1.235, GZ), 0.06, 0.04, axis="y", n=10, mat="trim", col=BARE)
    # plates: the shoulder cap, the yoke, the cradle (raised top, sides, belly), the mantlet
    am = lambda d=0.0, col=KHAKI, flag=0: arm_link(col, "primary", d, flag)  # noqa: E731
    aup = shell(am, -0.02, 0.04)
    L.add("plates", panel(aup, region(mx(HD1.rect(1.0, 1.6, -0.5, 0.7), s), "z", sz + 0.12, sz + 0.6), 0.035, "shoulder_cap"))
    L.add("plates", panel(aup, region(mx(HD1.rect(1.0, 1.6, sz - 0.40, sz + 0.08), s), "y", -0.6, -0.12), 0.03, "shoulder_front"))
    ym = lambda d=0.0, col=KHAKI, flag=0: yoke_mass(d, col, flag)  # noqa: E731
    ysh = shell(ym, -0.05, 0.0)
    L.add("plates", panel(ysh, region(HD1.rect(-1.66, -1.30, -0.4, 0.9), "z", GZ + 0.10, GZ + 0.8), 0.03, "yoke_top"))
    L.add("plates", panel(ysh, region(HD1.rect(-1.66, -1.30, GZ - 0.5, GZ + 0.06), "y", -0.5, 0.02), 0.03, "yoke_front"))
    cm = lambda d=0.0, col=KHAKI, flag=0: cradle_mass(d, col, flag)  # noqa: E731
    cup = shell(cm, -0.06, 0.035)
    csh = shell(cm, -0.05, 0.0)
    L.add("plates", panel(cup, region(HD1.rect(-2.6, -1.40, -0.38, 1.1), "z", GZ + 0.14, GZ + 0.6), 0.035, "cradle_top",
                          cuts=[inset(V3((GX + 0.08, 0.44, GZ + 0.275)), Y_, X_, Z_, 0.42, 0.14)]))
    L.add("plates", panel(csh, region(HD1.rect(-0.5, 0.10, GZ - 0.4, GZ + 0.10), "x", -2.6, GX - 0.18), 0.035, "cradle_out_front"))
    L.add("plates", panel(csh, region(HD1.rect(0.16, 1.1, GZ - 0.4, GZ + 0.10), "x", -2.6, GX - 0.18), 0.035, "cradle_out_back",
                          cuts=[H.cut_rect(V3((GX - 0.30, 0.38, GZ - 0.02)), Y_, Z_, -X_, 0.32, 0.16, depth=0.12, corner=0.03,
                                           slope=0.2, mat="dark", col=(0.07, 0.07, 0.065))]))          # the ejection port
    L.add("plates", panel(csh, region(HD1.rect(-0.5, 1.1, GZ - 0.4, GZ + 0.10), "x", GX + 0.18, -1.4), 0.035, "cradle_in"))
    L.add("plates", panel(shell(cm, -0.06, -0.02), region(HD1.rect(-2.6, -1.40, -0.5, 1.1), "z", GZ - 0.6, GZ - 0.20), 0.025,
                          "cradle_belly"))
    mm = lambda d=0.0, col=KHAKI, flag=0: mantlet_mass(d, col, flag)  # noqa: E731
    # the mantlet: one thick faceted shield (the gun's own signature), only the barrel boss cut in it
    msh = shell(mm, -0.09, 0.0)
    L.add("plates", panel(msh, region(HD1.rect(-2.6, -1.0, GZ - 0.6, GZ + 0.7), "y", -0.9, -0.36), 0.05, "mantlet",
                          cuts=[H.cut_rect(V3((GX, -0.80, GZ)), X_, Z_, -Y_, 0.26, 0.26, depth=0.04, corner=0.09, slope=0.3,
                                           mat="dark", col=V.shade(PAL["frame"], 0.9))]))
    bricks(L, V3((GX - 0.295, -0.10, GZ - 0.06)), Y_, Z_, V3((-0.993, 0, 0.12)).normalized(), 2, 2, (0.18, 0.13), col=KHAKI2)
    # weapon: the barrel, the brake, the recoil collar (Part_PodSpin_R)
    g = P_("barrel")
    barrel(g)
    L.add("weapon", g)
    L.add("weapon", brake_solid())
    c = P_("collar")
    collar(c)
    L.add("weapon", c)
    # actuation: two big recoil cylinders over the cradle and a recuperator under it, anchored to lugs on the mantlet's back;
    # the rods run bright into the mantlet (Valhalla: massive recoil compensators)
    for sx in (-1, 1):
        a0, a1 = V3((GX + sx * 0.17, 0.66, GZ + 0.33)), V3((GX + sx * 0.17, -0.30, GZ + 0.33))
        H.ram(L["actuation"], a0, a1, 0.095, split=0.80, sleeve_col=PAL["actuation"], rod_col=BARE, n=10)
        V.cyl(L["actuation"], tuple(a0 + Y_ * 0.03), 0.11, 0.06, axis="y", n=10, mat="trim", col=V.shade(PAL["actuation"], 0.8))
        V.blk(L["frame"], tuple(V3((GX + sx * 0.17, 0.66, GZ + 0.25))), (0.12, 0.10, 0.12), "dark", V.shade(PAL["frame"], 1.2),
              ch=0.02, mid=True)
    H.ram(L["actuation"], V3((GX, 0.60, GZ - 0.37)), V3((GX, -0.30, GZ - 0.37)), 0.085, split=0.8, sleeve_col=PAL["actuation"],
          rod_col=BARE, n=10)
    # the ammo feed: a flexible chute from the cradle's inner back toward the hull's back (the game's magazine)
    chute = V.round_path([V3((GX + 0.30, 0.80, GZ - 0.06)), V3((-1.42, 0.98, GZ - 0.16)), V3((-1.24, 1.08, GZ - 0.30))], 0.12)
    V.tube_along(L["actuation"], chute, 0.075, "trim", (0.40, 0.40, 0.36), n=8)
    for p in chute[1:-1:2]:
        V.cyl(L["actuation"], tuple(p), 0.09, 0.03, axis="x", n=8, mat="trim", col=(0.30, 0.30, 0.28))
    # pipes into the cradle, the shoulder ram, the elbow boot
    H.pipe_bundle(L["actuation"], [V3((-1.20, 0.34, sz - 0.08)), V3((-1.40, 0.40, sz - 0.20)), V3((-1.62, 0.44, GZ - 0.10)),
                                   V3((-1.62, 0.66, GZ + 0.02))], Z_, 2, 0.024, cols=PIPE_COLS)
    H.ram(L["actuation"], V3((-1.14, 0.40, sz + 0.10)), V3((-1.42, 0.52, GZ + 0.36)), 0.035, sleeve_col=PAL["actuation"], rod_col=BARE)
    H.bellows(L["seals"], V3((-1.00, 0.10, sz)), V3((-1.16, 0.10, sz)), 0.19, 0.19, folds=2, depth=0.02, n=12, col=PAL["seals"])
    # service: lifting eyes on the mantlet, stencils, a hazard band on the cradle top, a ranging sight with its lens
    for sx in (-1, 1):
        H.lifting_eye(L["service"], V3((GX + sx * 0.27, -0.40, GZ + 0.44)), Z_, r=0.06, t=0.02)
    vmark(L["service"], V3((GX - 0.292, 0.80, GZ - 0.08)), -Y_, Z_, V3((-0.993, 0, 0.12)), 0.16)
    K.hazard(L["service"], V3((GX, -0.46, GZ + 0.443)), X_, Y_, Z_, 0.36, 0.07, 5, YELLOW, (0.14, 0.13, 0.12))
    V.blk(L["sensors"], (GX + 0.22, 0.10, GZ + 0.19), (0.10, 0.22, 0.16), "dark", FRAME, ch=0.015)
    f = V.cyl(L["sensors"], (GX + 0.22, -0.015, GZ + 0.27), 0.035, 0.01, axis="y", n=10, mat="glow", col=R.GLOW)
    H.glow_flag(f, L["sensors"])
    L.flush(part)
    return part


def mirror_part(src, name, seed):
    """The left pod as the right one mirrored across x = 0 (what the game does with Part_Pod_R)."""
    o = src.origin
    part = new_part(name, V3((-o.x, o.y, o.z)), seed)
    for k, P in src.layers.items():
        if P.empty():
            continue
        Q = part[k]
        bm = P.bm.copy()
        bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts[:])
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        Q.bm.free()
        Q.bm = bm
        Q.col = bm.loops.layers.color.get("Color")
        Q.sec = bm.faces.layers.int.get("sec")
        Q.flag = bm.faces.layers.int.get("flag")
    return part


# ================================================================================================================ build
def repaint(parts):
    """Valhalla gunmetal: a per-channel gain on every 'primary' face (the plates and their insets, bricks, edge bands)."""
    prim = V.sec_index("primary")
    for pt in parts:
        for P in pt.layers.values():
            for f in P.bm.faces:
                if f[P.sec] != prim:
                    continue
                for lp in f.loops:
                    c = lp[P.col]
                    lp[P.col] = (min(1.0, c[0] * GAIN[0]), min(1.0, c[1] * GAIN[1]), min(1.0, c[2] * GAIN[2]), 1.0)


def build_parts():
    R.SKIN.clear()
    ar = arm_r()
    parts = [pelvis(), torso(), mirror_part(ar, "Arm_L", 62), ar]
    for s in (1, -1):
        parts += [thigh(s), shin(s), meta(s), foot(s)]
    repaint(parts)
    return parts


R.build_parts = build_parts
R.mass_layer = mass_layer
build_full, build_mass, V = R.build_full, R.build_mass, R.V


# ---- export hooks (export_game.py --model)
def export_gun_points():
    return {"PodSpin_R": V3((GX, SPIN_Y, GZ)), "PodSpinFwd_R": V3((GX, SPIN_Y - 0.5, GZ)),
            "PodMuzzle0_R": V3((GX, MUZZLE_Y - 0.04, GZ)), "PodEject_R": V3((GX - 0.36, 0.38, GZ - 0.02))}


def export_split_guns(parts, split_off):
    """The recoil collar (ring and lugs) is Part_PodSpin_R; the left pod (the mirrored cannon, for renders) is dropped:
    the game mirrors Part_Pod_R itself."""
    out = {}
    arm_l = parts.pop("Arm_L", None)
    if arm_l is not None:
        bpy.data.objects.remove(arm_l, do_unlink=True)
    arm_r = parts.get("Arm_R")
    if arm_r is None:
        return out

    def rad(p):
        return ((p.x - GX) ** 2 + (p.z - GZ) ** 2) ** 0.5

    def pick(c, pts):
        return SPIN_Y - 0.09 < c.y < SPIN_Y + 0.06 and max(rad(p) for p in pts) < 0.21 and min(p.y for p in pts) > SPIN_Y - 0.10
    o, n = split_off(arm_r, pick, "Part_PodSpin_R")
    print("HDX split %d collar islands -> %s" % (n, o.name if o else None))
    if o is not None:
        out["PodSpin_R"] = o
    return out


if __name__ == "__main__":
    R.main()
