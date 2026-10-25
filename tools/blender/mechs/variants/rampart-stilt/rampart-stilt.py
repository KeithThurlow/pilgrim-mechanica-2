"""Rampart-Stilt: the Rampart on the old game's stilt legs, a light fast scout (Suzaku Dynamics, "The High-Revving Scout").

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-stilt/rampart-stilt.py -- [--mass] [--pose rest|stance]
        [--out DIR]
    export: node tools/blender/run.mjs tools/blender/mechs/studies/rampart/export_game.py -- \
        --model tools/blender/mechs/variants/rampart-stilt/rampart-stilt.py --out <scratch>/rampart-stilt.fbx

Built on rampart_v4 (imported, patched, never edited):
  * legs: new joints from the old part legs.stilt (lab x 0.693: femur 1.25, shin 0.82, cannon 1.23, hip 3.05); a slim
    tapered thigh loft, a short flat-sided shin, the cannon as one long blade carried 0.42 m past the hock as a horn (the
    signature form: its front is ONE plate from the hock to the ankle), the Rampart's machine foot scaled to a small plate
    foot about the ankle.
  * torso: the Rampart's (face shield kept whole) passed through one lightening map, torso_D: narrower and tapering upward
    (sloped sides), the rear hull shallower and sloping off backwards, a little shorter; reactive bricks dropped. Added: a
    chin sensor pod, a laser ranger, whip antennas (sensors forward), twin upswept exhausts (the heat feature), a red
    Suzaku stripe.
  * pelvis 0.82x narrower; the minigun arm moved in with the shoulders; no left arm (the game mirrors the right pod).

Units m, Z up, front -Y, the mech's left +X (as v4).
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
RAMP = os.path.join(MECHS, "studies", "rampart")
for p in (os.path.join(MECHS, "studies", "military"), MECHS, RAMP, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import bpy  # noqa: E402,F401
from mathutils import Matrix, Vector  # noqa: E402

import hskit as H  # noqa: E402
import mil_kit as K  # noqa: E402
from mil_kit import V  # noqa: E402
import rampart as HD1  # noqa: E402
import rampart_v4 as R  # noqa: E402
from rampart_v2 import ccw, rrect, ellipse, hull2d  # noqa: E402

V3 = Vector
X_, Y_, Z_ = V3((1, 0, 0)), V3((0, 1, 0)), V3((0, 0, 1))
KHAKI, KHAKI_D, KHAKI2, OLIVE, OLIVE_D = R.KHAKI, R.KHAKI_D, R.KHAKI2, R.OLIVE, R.OLIVE_D
FRAME, BARE, MARK, RED, GLOW, GREY = R.FRAME, R.BARE, R.MARK, R.RED, R.GLOW, R.GREY
PAL = R.PAL
POSE = R.POSE
HAS_WEAPON_LAYER = True
span, rect = HD1.span, HD1.rect

# ------------------------------------------------------------------------------------------------------------ joints
HIP_X, HIP_Y, HIP_Z = 0.64, 0.0, 3.05
K_ = (0.08, -0.33, -1.20)          # knee: world z 1.85, a high knee
HK_ = (0.13, 0.36, -1.64)          # hock: the short shin kicks back almost level (the old stilt strip)
A_ = (0.18, 0.04, -2.83)           # ankle: world z 0.22, the cannon raked ~15 deg back
A_BUILD_Z = -2.78                  # the Rampart foot is built at its own ankle height, then scaled down (FOOT_K)
FOOT_K = (0.72, 0.56, 0.22 / 0.27)  # x, y about the ankle; z from the ground (keeps the ankle drum on the ankle)

R.HIP_X, R.HIP_Y, R.HIP_Z = HIP_X, HIP_Y, HIP_Z
R.K_, R.HK_, R.A_ = K_, HK_, A_
R.STANCE_LEGS = {"_L": {"thigh_pitch": 6, "ankle": (0.04, 0.24, 0.0), "foot_yaw": 6},
                 "_R": {"thigh_pitch": -18, "ankle": (-0.08, -0.70, 0.0), "foot_yaw": -8}}
R.bricks = lambda *a, **k: None        # a glass cannon carries no reactive armour (the torso's add-on bricks)

# ---------------------------------------------------------------------------------------------- the lightening map
W0 = V3((0.0, 0.10, 3.45))           # the waist: fixed by the map (the torso's joint)


def torso_D(p):
    """The Rampart torso -> the scout's: 0.86x narrower at the waist tapering to 0.78x at the top (sloped sides), the
    rear hull 0.74x as deep, the nose 4% further forward, 0.90x as tall, the top of the rear dropped toward the back."""
    dy, dz = p.y - W0.y, p.z - W0.z
    up = min(1.0, max(0.0, dz / 1.5))
    sx = 0.86 - 0.08 * up
    y = W0.y + (dy * 0.74 if dy > 0 else dy * 1.04)
    z = W0.z + dz * 0.90 - 0.12 * max(0.0, dy) / 1.2 * max(0.0, dz) / 1.6
    return V3((p.x * sx, y, z))


def pelvis_D(p):
    return V3((p.x * 0.82, p.y, p.z))


SH0 = V3((-R.SHOULDER[0], R.SHOULDER[1], R.SHOULDER[2]))      # the right (-X) shoulder, where the gun arm is built
SH1 = torso_D(SH0)
DELTA = SH1 - SH0                    # the right arm moves in (and down) with the narrower shoulders
GX, GZ = R.GX + DELTA.x, R.GZ + DELTA.z


def arm_D(p):
    return p + DELTA


def deform_piece(P, f, origin=None):
    o = V3(P.origin)
    no = V3(origin) if origin is not None else f(o)
    for v in P.bm.verts:
        v.co = f(v.co + o) - no
    P.origin = no
    P.bm.normal_update()
    if getattr(P, "decor", None) is not None:
        deform_piece(P.decor, f, origin)
    return P


def deform_part(part, f, origin):
    for P in part.layers.values():
        deform_piece(P, f, origin)
    part.origin = V3(origin)
    return part


def joints():
    j = {"Pelvis": V3((0, HIP_Y, HIP_Z)), "Torso": R.WAIST}
    for s, sfx in ((1, "_L"), (-1, "_R")):
        j["Thigh" + sfx], j["Shin" + sfx], j["Meta" + sfx], j["Foot" + sfx] = R.hip(s), R.knee(s), R.hock(s), R.ankle(s)
        j["Arm" + sfx] = V3((-s * SH1.x, SH1.y, SH1.z))
    return j


R.joints = joints


# =============================================================================================================== MASSES
def link_frame(s, a, b):
    return R.link_frame(s, a, b)


# ---- thigh: a slim tapered loft along the bone (hip -> knee), its hip housing carried above the hip drum, a pike front
#          t (along the bone),  half width, q front (-), q back (+)
TH_ST = [(-0.24, 0.10, -0.08, 0.12),
         (-0.14, 0.19, -0.20, 0.21),
         (0.10, 0.22, -0.27, 0.22),
         (0.55, 0.21, -0.25, 0.19),
         (0.95, 0.18, -0.20, 0.16),
         (1.12, 0.14, -0.13, 0.13)]


def th_outline(hw, q0, q1):
    """A pike front (a glacis V, no flat face to the front), flat sides, chamfered back corners."""
    qs = q0 + 0.35 * (q1 - q0)
    cb = min(0.07, hw * 0.4)
    return ccw([(0.0, q0 - 0.03), (hw * 0.6, q0 + 0.02), (hw, qs), (hw, q1 - cb), (hw - cb, q1), (-hw + cb, q1), (-hw, q1 - cb),
                (-hw, qs), (-hw * 0.6, q0 + 0.02)])


def thigh_cuts(s, d, col=GREY):
    sc, sl = R.scoop, R.slab
    return [
        sc(V3((s * 0.215, 0.55, 0.00)), Z_, Y_, s * X_, 0.17, 0.56, 0.06, d, corner=0.03, slope=0.3, col=col),   # outer ram recess
        sc(V3((0.0, 1.02, -0.20)), X_, Y_, V3((0, -0.25, -0.97)), 0.20, 0.20, 0.05, d, col=col),                  # knee scoop
        sl(V3((0.0, -0.16, -0.17)), (0, -0.6, -0.8), d, col=col),                                                 # hip-front chamfer
        sl(V3((0.0, 1.08, 0.12)), (0, 0.6, 0.8), d, col=col),                                                     # lower back chamfer
        sc(V3((-s * 0.215, 0.02, 0.0)), Z_, Y_, -s * X_, 0.26, 0.30, 0.05, d, col=col),                           # inner hip scoop
    ]


@R.cached
def st_thigh_mass(s, d=0.0, col=GREY, flag=0, cuts=True):
    M, L = link_frame(s, (0, 0, 0), K_)
    m = H.loft([(t, th_outline(hw, q0, q1)) for t, hw, q0, q1 in TH_ST], "y", d, "primary", col, "thigh", flag)
    if cuts:
        H.carve(m, thigh_cuts(s, d, col), bevel=0.0)
    R.flagall(m, flag)
    return H.xform(m, M)


@R.cached
def st_shin_mass(s, d=0.0, col=GREY, flag=0):
    return R.link_mass(s, K_, HK_, 0.15, 0.13, 0.13, 0.05, d, col, flag, name="shin")


# ---- the cannon: one long blade along the bone (hock -> ankle), carried 0.42 m past the hock as a horn, a heel spur
#           t, half width, q front, q back
CAN_ST = [(-0.42, 0.06, 0.02, 0.12),
          (-0.34, 0.10, -0.04, 0.18),
          (-0.16, 0.14, -0.10, 0.21),
          (0.06, 0.15, -0.12, 0.20),
          (0.45, 0.14, -0.11, 0.17),
          (0.85, 0.12, -0.09, 0.14),
          (1.12, 0.10, -0.07, 0.12),
          (1.20, 0.08, -0.02, 0.16),
          (1.28, 0.05, 0.06, 0.20)]


def cannon_cuts(d, col=GREY):
    sc, sl = R.scoop, R.slab
    return [
        sc(V3((0, 0.45, 0.17)), Y_, X_, Z_, 0.62, 0.11, 0.07, d, corner=0.02, slope=0.3, col=col),          # back channel (rams)
        sc(V3((0.145, 0.50, 0.04)), Y_, Z_, X_, 0.56, 0.08, 0.022, d, corner=0.03, slope=0.6, col=col),     # outer side recess
        sc(V3((-0.145, 0.50, 0.04)), Y_, Z_, -X_, 0.56, 0.08, 0.022, d, corner=0.03, slope=0.6, col=col),   # inner side recess
        sl(V3((0, -0.36, 0.05)), (0, -0.55, -0.83), d, col=col),                                            # horn wedge
        sl(V3((0, 1.10, 0.15)), (0, 0.45, 0.89), d, col=col),                                               # heel step
    ]


def can_outline(hw, q0, q1):
    return R.can_outline(hw, q0, q1, c0=0.07, c1=0.09)


@R.cached
def st_cannon_mass(s, d=0.0, col=GREY, flag=0, cuts=True):
    M, L = link_frame(s, HK_, A_)
    m = H.loft([(t, can_outline(hw, q0, q1)) for t, hw, q0, q1 in CAN_ST], "y", d, "primary", col, "cannon", flag)
    if cuts:
        H.carve(m, cannon_cuts(d, col), bevel=0.0)
    R.flagall(m, flag)
    return H.xform(m, M)


@R.cached
def st_meta_bone(s, d=0.0, col=GREY, flag=0):
    return R.link_mass(s, HK_, A_, 0.10, 0.08, 0.08, 0.03, d, col, flag, name="meta")


def foot_scale_fn(s):
    a = R.ankle(s)
    kx, ky, kz = FOOT_K
    return lambda p: V3((a.x + (p.x - a.x) * kx, a.y + (p.y - a.y) * ky, p.z * kz))


def with_build_ankle(fn, *a, **kw):
    saved = R.A_
    R.A_ = (A_[0], A_[1], A_BUILD_Z)
    try:
        return fn(*a, **kw)
    finally:
        R.A_ = saved


SENSOR_POD = [(-1.27, 3.42), (-0.92, 3.36), (-0.86, 3.60), (-1.08, 3.64), (-1.24, 3.56)]     # (y, z): a hooded wedge


def sensor_pod_mass(d=0.0, col=GREY, flag=0):
    return H.prism(ccw(SENSOR_POD), "x", -0.19, 0.19, "primary", col, "sensor_pod", d, flag)


# ============================================================================================================ mass layer
def mass_layer():
    out = {}
    tor = [H.fuse([R.chest_mass(), R.rear_mass()], "torso_mass", fillet=0.02, segments=1), R.hood_mass(), sensor_pod_mass()]
    for s in (1, -1):
        tor.append(R.pauldron_mass(s))
        tor.append(H.prism(ellipse(R.SHOULDER[1], R.SHOULDER[2], 0.21, 0.21, 10), "x", *span(s * 0.9, s * 1.14), "dark", GREY, "shoulder"))
    out["Torso"] = [deform_piece(S, torso_D, V3()) for S in tor]
    pel = [R.pelvis_core(col=GREY), R.wing_mass(), R.skirt_mass(), R.rear_skirt_mass(), R.keel_mass()]
    out["Pelvis"] = [deform_piece(S, pelvis_D, V3()) for S in pel]
    for s, sfx in ((1, "_L"), (-1, "_R")):
        M = R.leg_M(s)
        out["Thigh" + sfx] = [H.xform(st_thigh_mass(s), M)]
        out["Shin" + sfx] = [H.xform(st_shin_mass(s), M)]
        out["Meta" + sfx] = [H.xform(st_cannon_mass(s), M)]
        out["Foot" + sfx] = [deform_piece(with_build_ankle(R.foot_mass, s), foot_scale_fn(s), V3())]
    gun = R.P_("gun")
    R.gatling(gun, GREY)
    V.cyl(gun, R.REEL, 0.19, 0.48, axis="y", n=14, mat="dark", col=GREY)
    for y in (0.0, 0.29):
        V.cyl(gun, (R.DRUM[0], y, R.DRUM[1]), 0.27, 0.27, axis="y", n=14, mat="dark", col=GREY)
    out["Arm_R"] = [deform_piece(S, arm_D, V3()) for S in (R.recv_mass(), R.gun_mount(), R.arm_link(-1), gun)]
    return out


# ======================================================================================================== layers 1-10
Layers, shell, panel, inset, flanges, servo, mframe = R.Layers, R.shell, R.panel, R.inset, R.flanges, R.servo, R.mframe
PIPE_COLS = R.PIPE_COLS


def bone_region(M, x0, x1, z0, z1, y0, y1, col=KHAKI):
    """A region prism in a bone frame (x lateral, y along the bone, z back), moved into hip-local by M."""
    x0, x1 = span(x0, x1)
    return H.xform(H.prism(rect(x0, x1, z0, z1), "y", y0, y1, "primary", col, "region", 0.0, HD1.F_REGION), M)


def thigh(s):
    sfx = "_L" if s > 0 else "_R"
    part = R.new_part("Thigh" + sfx, R.hip(s), 10 + s)
    L = Layers()
    M, Ln = link_frame(s, (0, 0, 0), K_)
    M3 = M.to_3x3()
    mf = lambda d=0.0, col=KHAKI, flag=0: st_thigh_mass(s, d, col, flag)  # noqa: E731
    RG = lambda *a, **k: bone_region(M, *a, **k)  # noqa: E731
    # frame: the mass shrunk by plate + rib, the hip drum, knee clevis cheeks (round at the knee), a lightening pocket
    fr = mframe(st_thigh_mass, s, -0.10, PAL["frame"], 0, False)
    hipd = H.prism(ellipse(0, 0, 0.18, 0.18, 12), "x", *span(-s * 0.30, s * 0.04), "dark", V.shade(PAL["frame"], 1.15), "hipdrum")
    cheeks = [H.xform(H.prism(rrect(0.90, Ln + 0.11, -0.12, 0.12, (0.0, 0.11, 0.11, 0.0), 2), "x", *span(sx * 0.155, sx * 0.205),
                              "dark", V.shade(PAL["frame"], 1.1), "cheek"), M) for sx in (-1, 1)]
    fr = H.fuse([fr, hipd] + cheeks, "thigh_frame", fillet=0.015, segments=1)
    L.add("frame", fr)
    # mounting: a deep flange hoop in the gap over the knee guard, stringers down the length
    flanges(L, st_thigh_mass(s, -0.065, PAL["mounting"], 0, False), [(M @ V3((0, 0.87, 0)), (M3 @ Y_).normalized())], 14, 0.10,
            0.045, stringers=(0, 7))
    # plates: a raised glacis front (thickest, tank logic), a knee guard, side plates round the ram recess, a thin back
    front = shell(mf, -0.08, 0.035)
    sh = shell(mf, -0.06, 0.0)
    thin = shell(mf, -0.06, -0.025)
    nfo = (M3 @ V3((s * 0.85, 0, -0.53))).normalized()            # the glacis's outer facet
    c_in = M @ V3((s * 0.172, 0.42, -0.168)) + nfo * 0.035
    L.add("plates", panel(front, RG(-0.6, 0.6, -0.6, -0.10, -0.45, 0.84), 0.045, "thigh_front",
                          cuts=[inset(c_in, M3 @ Y_, M3 @ Z_, nfo, 0.36, 0.09)]))
    L.add("plates", panel(sh, RG(-0.6, 0.6, -0.6, -0.08, 0.90, 1.4), 0.035, "thigh_knee_guard"))
    for sx in (-1, 1):
        L.add("plates", panel(sh, RG(sx * 0.08, sx * 0.6, -0.06, 0.10, -0.45, 1.4), 0.03, "thigh_side"))
    L.add("plates", panel(thin, RG(-0.6, 0.6, 0.14, 0.6, -0.45, 0.84), 0.03, "thigh_back_up"))
    # actuation: the hip ram in the outer recess, a pipe bundle down the inner-back corner gap into the knee
    H.ram(L["actuation"], M @ V3((s * 0.205, 0.30, 0.0)), M @ V3((s * 0.205, 0.83, 0.0)), 0.042, sleeve_col=PAL["actuation"],
          rod_col=BARE)
    H.pipe_bundle(L["actuation"], [M @ V3((-s * 0.19, -0.10, 0.165)), M @ V3((-s * 0.20, 0.35, 0.17)),
                                   M @ V3((-s * 0.18, 0.80, 0.15)), M @ V3((-s * 0.12, 1.18, 0.10))],
                  M3 @ V3((-s, 0, 1)), 3, 0.02, cols=PIPE_COLS)
    # power: hamstring bundles under the back plate (they show in the knee-guard gap)
    for x in (-0.05, 0.06):
        V.tube_along(L["power"], V.round_path([M @ V3((x, 0.30, 0.13)), M @ V3((x, 0.65, 0.15)), M @ V3((x, 1.00, 0.11))], 0.1),
                     0.04, "dark", PAL["power"], n=6)
    # seals: the hip boot towards the pelvis
    H.bellows(L["seals"], V3((-s * 0.20, 0.0, 0.0)), V3((-s * 0.32, 0.0, 0.0)), 0.17, 0.17, folds=2, depth=0.02, n=12,
              col=PAL["seals"])
    # service: the Suzaku red chevron on the glacis, the unit number on the outer side plate
    for k, t in enumerate((0.04, 0.13)):
        c = M @ V3((s * 0.12, t, -0.215)) + nfo * 0.04
        V.surf_blk(L["service"], c, M3 @ Y_, (M3 @ Z_), nfo, 0.05, 0.12, 0.006, "secondary", RED if k == 0 else MARK)
    n_side = (M3 @ X_).normalized() * s
    up = -(M3 @ Y_).normalized()
    K.stencil(L["service"], "07", M @ V3((s * 0.222, 0.55, 0.06)), n_side.cross(up) * -1, up, n_side, 0.11, "secondary", MARK)
    L.flush(part, R.leg_M(s))
    return part


def knee_cap_mass(s, d=0.0, col=GREY, flag=0):
    """A faceted disc round the knee axis covering the knee's front and top (in the shin frame the shin runs off at 0 deg,
    world forward is about 213 deg and up 123 deg)."""
    M, _ = link_frame(s, K_, HK_)
    arc = [(0.205 * math.cos(math.radians(t)), 0.205 * math.sin(math.radians(t))) for t in range(80, 321, 24)]
    return H.xform(H.prism(ccw(hull2d(arc + [(0.06, 0.0)])), "x", -0.19, 0.19, "primary", col, "kneecap", d, flag), M)


def shin(s):
    part = R.new_part("Shin" + ("_L" if s > 0 else "_R"), R.knee(s), 20 + s)
    L = Layers()
    M, Ln = link_frame(s, K_, HK_)
    M3 = M.to_3x3()
    mf = lambda d=0.0, col=KHAKI2, flag=0: st_shin_mass(s, d, col, flag)  # noqa: E731
    RG = lambda *a, **k: bone_region(M, *a, **k)  # noqa: E731
    # frame: the beam, the knee drum (reaching the thigh's cheeks) and the hock drum, flat side links with slots
    fr = mframe(st_shin_mass, s, -0.05, PAL["frame"])
    kd = H.xform(H.prism(ellipse(0, 0, 0.14, 0.14, 12), "x", -0.245, 0.245, "dark", V.shade(PAL["frame"], 1.15), "kneedrum"), M)
    hd = H.xform(H.prism(ellipse(Ln, 0, 0.12, 0.12, 12), "x", -0.21, 0.21, "dark", V.shade(PAL["frame"], 1.15), "hockdrum"), M)
    L.add("frame", H.fuse([fr, kd, hd], "shin_frame", fillet=0.015, segments=1))
    for sx in (-1, 1):
        lk = H.xform(H.prism(rrect(-0.05, Ln + 0.05, -0.10, 0.10, 0.05, 1), "x", *span(sx * 0.135, sx * 0.16), "dark",
                             V.shade(PAL["frame"], 1.25), "shin_link"), M)
        H.carve(lk, [H.xform(H.cut_rect(V3((sx * 0.16, Ln * 0.5, 0.0)), Y_, Z_, sx * X_, Ln * 0.45, 0.07, depth=0.04,
                                        corner=0.03, slope=0.0, mat="dark", col=V.shade(PAL["frame"], 0.6)), M)], bevel=0.0)
        L.add("frame", lk)
        servo(L, M, sx * 0.24, 0.115, 0.04, sx, name="knee_servo")
    # plates: the knee cap (an olive inset), a raised top plate (faces up-back: the 50 deg camera sees it), an under plate,
    # side plates
    km = lambda d=0.0, col=KHAKI, flag=0: knee_cap_mass(s, d, col, flag)  # noqa: E731
    kc = shell(km, -0.045, 0.0)
    capr = H.xform(H.prism(ccw(rect(-0.5, 0.07, -0.5, 0.5)), "x", -0.17, 0.17, "primary", KHAKI, "region", 0.0, HD1.F_REGION), M)
    L.add("plates", panel(kc, capr, 0.03, "knee_cap",
                          cuts=[H.xform(inset(V3((0, -0.115, 0.17)), X_, V3((0, -0.83, 0.55)), V3((0, -0.55, 0.83)), 0.16, 0.08,
                                              OLIVE, depth=0.02), M)]))
    sh = shell(mf, -0.045, 0.0, KHAKI2)
    up = shell(mf, -0.03, 0.03, KHAKI2)
    L.add("plates", panel(up, RG(-0.6, 0.6, 0.10, 0.6, 0.20, Ln - 0.03, KHAKI2), 0.03, "shin_top"))
    L.add("plates", panel(sh, RG(-0.6, 0.6, -0.6, -0.10, 0.22, Ln - 0.03, KHAKI2), 0.025, "shin_under"))
    for sx in (-1, 1):
        L.add("plates", panel(sh, RG(sx * 0.07, sx * 0.6, -0.07, 0.07, 0.20, Ln - 0.03, KHAKI2), 0.025, "shin_side"))
    # actuation: the hock drive ram along the top, a pipe pair down the outer side
    H.ram(L["actuation"], M @ V3((0.0, 0.10, 0.205)), M @ V3((0.0, Ln - 0.06, 0.19)), 0.035, sleeve_col=PAL["actuation"],
          rod_col=BARE)
    H.pipe_bundle(L["actuation"], [M @ V3((s * 0.175, -0.04, -0.06)), M @ V3((s * 0.18, Ln * 0.5, -0.07)),
                                   M @ V3((s * 0.175, Ln + 0.04, -0.06))], (M3 @ Z_), 2, 0.018, cols=PIPE_COLS)
    # seals: a boot under the knee, on the camera's (front) side
    H.bellows(L["seals"], M @ V3((-0.13, 0.02, -0.12)), M @ V3((0.13, 0.02, -0.12)), 0.08, 0.08, folds=3, depth=0.016, n=10,
              col=PAL["seals"])
    L.flush(part, R.leg_M(s))
    return part


def meta(s):
    part = R.new_part("Meta" + ("_L" if s > 0 else "_R"), R.hock(s), 25 + s)
    L = Layers()
    M, Ln = link_frame(s, HK_, A_)
    M3 = M.to_3x3()
    RG = lambda *a, **k: bone_region(M, *a, **k)  # noqa: E731
    # frame: the blade's core and its bone, the hock drum inside the blade's top
    core = mframe(st_cannon_mass, s, -0.09, PAL["frame"], 0, False)
    bone = mframe(st_meta_bone, s, 0.0, PAL["frame"])
    hd = H.xform(H.prism(ellipse(0.0, 0.0, 0.13, 0.13, 12), "x", -0.17, 0.17, "dark", V.shade(PAL["frame"], 1.15), "hock"), M)
    L.add("frame", H.fuse([core, bone, hd], "meta_frame", fillet=0.015, segments=1))
    # mounting: a flange hoop in the horn / blade gap
    flanges(L, st_cannon_mass(s, -0.06, PAL["mounting"], 0, False), [(M @ V3((0, -0.11, 0)), (M3 @ Y_).normalized())], 12,
            0.08, 0.04, stringers=(3,))
    cm = lambda d=0.0, col=KHAKI, flag=0: st_cannon_mass(s, d, col, flag)  # noqa: E731
    co = lambda d=0.0, col=OLIVE, flag=0: st_cannon_mass(s, d, col, flag)  # noqa: E731
    cg = lambda d=0.0, col=KHAKI2, flag=0: st_cannon_mass(s, d, col, flag)  # noqa: E731
    # plates. THE SIGNATURE FORM: one front plate from the hock gap to the heel cap, never cut (skill 7b)
    L.add("plates", panel(shell(co, -0.06, 0.03, OLIVE), RG(-0.6, 0.6, -0.6, 0.6, -0.8, -0.13, OLIVE), 0.035, "horn",
                          cuts=[H.xform(inset(V3((0, -0.30, 0.20)), Y_, X_, V3((0, -0.2, 0.98)), 0.09, 0.14, OLIVE_D), M)]))
    L.add("plates", panel(shell(cm, -0.07, 0.035), RG(-0.6, 0.6, -0.6, -0.05, -0.09, 1.10), 0.045, "cannon_front"))
    gsh = shell(cg, -0.05, 0.0, KHAKI2)
    for sx in (-1, 1):
        L.add("plates", panel(gsh, RG(sx * 0.07, sx * 0.6, -0.01, 0.6, -0.09, 1.10, KHAKI2), 0.03, "cannon_guard"))
    L.add("plates", panel(shell(cm, -0.05, 0.0), RG(-0.6, 0.6, -0.6, 0.6, 1.14, 1.5), 0.025, "heel_cap"))
    # actuation: twin rams down the back channel, a pipe pair down the outer side recess, hock servos
    for x in (-0.032, 0.032):
        H.ram(L["actuation"], M @ V3((x, 0.18, 0.14)), M @ V3((x, 0.76, 0.14)), 0.026, sleeve_col=PAL["actuation"], rod_col=BARE)
    H.pipe_bundle(L["actuation"], [M @ V3((s * 0.14, -0.05, 0.05)), M @ V3((s * 0.145, 0.40, 0.045)),
                                   M @ V3((s * 0.13, 0.80, 0.04)), M @ V3((s * 0.10, 1.10, 0.02))], (M3 @ Z_), 2, 0.018,
                  cols=PIPE_COLS, clamp_every=0.3)
    V.tube_along(L["power"], V.round_path([M @ V3((-s * 0.10, 0.10, 0.06)), M @ V3((-s * 0.11, 0.55, 0.06)),
                                           M @ V3((-s * 0.09, 0.95, 0.05))], 0.1), 0.032, "dark", PAL["power"], n=6)
    for sx in (-1, 1):
        servo(L, M, sx * 0.17, 0.10, 0.04, sx, name="hock_servo")
    # service: the leg number on the outer guard, a red Suzaku tick on the horn
    n_o = (M3 @ X_).normalized() * s
    upv = -(M3 @ Y_).normalized()
    K.stencil(L["service"], "1" if s > 0 else "2", M @ V3((s * 0.142, 0.20, 0.10)), n_o.cross(upv) * -1, upv, n_o, 0.09,
              "secondary", MARK)
    L.flush(part, R.leg_M(s))
    return part


def foot(s):
    part = with_build_ankle(R.foot, s)
    return deform_part(part, foot_scale_fn(s), R.ankle(s))


def pelvis():
    return deform_part(R.pelvis(), pelvis_D, V3((0, HIP_Y, HIP_Z)))


def torso_extras(part):
    """Sensors forward, the exhausts, the Suzaku stripe; built in the Rampart's frame, then mapped with the torso."""
    L = Layers()
    # the chin sensor pod under the nose: a hooded wedge, three lenses forward
    pod = sensor_pod_mass(0.0, OLIVE)
    H.carve(pod, [H.cut_rect(V3((0, -1.255, 3.49)), X_, Z_, V3((0, -0.985, -0.17)), 0.30, 0.10, depth=0.05, corner=0.02,
                             slope=0.3, mat="dark", col=(0.08, 0.08, 0.08))], bevel=0.008)
    L.add("plates", pod)
    for k, x in enumerate((-0.09, 0.0, 0.09)):
        r = 0.045 if k == 1 else 0.03
        V.cyl(L["sensors"], (x, -1.235, 3.49), r + 0.01, 0.04, axis="y", n=10, mat="dark", col=FRAME)
        f = V.cyl(L["sensors"], (x, -1.258, 3.49), r, 0.008, axis="y", n=10, mat="glow", col=GLOW)
        H.glow_flag(f, L["sensors"])
    V.bar(L["frame"], V3((0, -0.90, 3.47)), V3((0, -0.80, 3.47)), 0.06, "dark", FRAME, 8)
    # a laser ranger on the right pauldron
    V.cyl(L["sensors"], (-0.82, -0.52, 4.64), 0.065, 0.34, axis="y", n=10, mat="dark", col=V.shade(FRAME, 1.2))
    f = V.cyl(L["sensors"], (-0.82, -0.695, 4.64), 0.045, 0.01, axis="y", n=10, mat="glow", col=(1.0, 0.35, 0.2))
    H.glow_flag(f, L["sensors"])
    # whip antennas off the hood's back
    for s in (-1, 1):
        V.bar(L["sensors"], V3((s * 0.38, 0.95, 5.0)), V3((s * 0.46, 1.15, 5.95)), 0.011, "trim", BARE, 5)
    # heat: twin upswept motorcycle exhausts out of the rear hull's top corners, glowing ends (the one strong heat feature)
    for s in (-1, 1):
        path = V.round_path([V3((s * 0.66, 0.70, 4.55)), V3((s * 0.80, 0.98, 4.70)), V3((s * 0.84, 1.16, 5.05))], 0.14)
        V.tube_along(L["heat"], path, 0.075, "dark", V.shade(PAL["heat"], 0.9), n=8)
        V.cyl(L["heat"], (s * 0.84, 1.16, 5.06), 0.09, 0.08, axis="z", n=10, mat="trim", col=BARE)
        g = V.cyl(L["heat"], (s * 0.84, 1.16, 5.105), 0.06, 0.01, axis="z", n=10, mat="glow", col=(1.0, 0.45, 0.15))
        H.glow_flag(g, L["heat"])
    # service: the red Suzaku stripe down the hood spine
    V.surf_blk(L["service"], V3((0.0, 0.40, 5.085)), Y_, X_, Z_, 1.20, 0.06, 0.006, "secondary", RED)
    L.flush(part)


def torso():
    part = R.torso()
    torso_extras(part)
    return deform_part(part, torso_D, R.WAIST)


def arm_r():
    return deform_part(R.arm_r(), arm_D, SH1)


# ================================================================================================================ build
def build_parts():
    R.SKIN.clear()
    parts = [pelvis(), torso(), arm_r()]
    for s in (1, -1):
        parts += [thigh(s), shin(s), meta(s), foot(s)]
    return parts


def build_full(layers=None):
    parts = build_parts()
    pieces = [pc for pt in parts for pc in pt.pieces()]
    K.bake_all(pieces, PAL, 3, ao_rays=12, ao_dist=0.5, wear=0.3, dust=0.2)
    root, emp, J = R.hierarchy("Rampart_Stilt")
    tris, objs = {}, []
    for pt in parts:
        for pc in pt.pieces():
            if layers is not None and H.layer_of(pc.name) not in layers:
                continue
            objs.append(K.emit(pc, emp[pt.name], V3()))
            tris[pc.name] = pc.tris
    axis = R.axis_report(objs) if layers is None or "plates" in layers else {}
    R.apply_pose(root, emp)
    by_part, by_layer = {}, {}
    for k, v in tris.items():
        pk, lk = k.split("__")
        by_part[pk] = by_part.get(pk, 0) + v
        by_layer[lk] = by_layer.get(lk, 0) + v
    rep = H.report()
    info = {"tris": tris, "tris_total": sum(tris.values()), "tris_by_part": by_part, "tris_by_layer": by_layer,
            "axis_aligned_plates": axis, "legs": R.leg_report(), "pose": POSE["mode"], "hskit": rep["stats"],
            "hskit_log": rep["log"][-40:], "joints": {k: [round(c, 3) for c in v] for k, v in joints().items()}}
    return root, objs, info


def build_mass():
    root, emp, J = R.hierarchy("Rampart_Stilt_mass")
    tris, objs = {}, []
    for k, solids in mass_layer().items():
        pc = V.Piece(k + "__Mass", J[k], 1)
        for S in solids:
            H.commit(S, pc)
        K.bake_all([pc], PAL, 1, ao_rays=4, wear=0.0, dust=0.0, deep=2.0)
        objs.append(K.emit(pc, emp[k], V3()))
        tris[k] = pc.tris
    R.apply_pose(root, emp)
    return root, objs, {"tris": tris, "tris_total": sum(tris.values()), "pose": POSE["mode"], "hskit": H.report()["stats"]}


# ---- export hooks (export_game.py): only the right gun exists; its points move with the arm
def export_gun_points():
    return {"PodSpin_R": V3((GX, -0.50, GZ)), "PodSpinFwd_R": V3((GX, -1.00, GZ)), "PodMuzzle0_R": V3((GX, -1.90, GZ)),
            "PodEject_R": V3((GX - 0.37, -0.20, GZ - 0.02))}


def export_split_guns(parts, split_off):
    out = {}
    arm_r = parts.get("Arm_R")
    if arm_r is not None:
        def rad(p):
            return ((p.x - GX) ** 2 + (p.z - GZ) ** 2) ** 0.5

        def gat(c, pts):
            return c.y < -0.46 and rad(c) < 0.15 and max(rad(p) for p in pts) < 0.25
        o, n = split_off(arm_r, gat, "Part_PodSpin_R")
        print("HDX split %d gatling islands -> %s" % (n, o.name if o else None))
        if o is not None:
            out["PodSpin_R"] = o
    return out


def lengths():
    J = joints()
    return {"femur": round((J["Shin_L"] - J["Thigh_L"]).length, 3), "shin": round((J["Meta_L"] - J["Shin_L"]).length, 3),
            "cannon": round((J["Foot_L"] - J["Meta_L"]).length, 3)}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--mass", action="store_true")
    ap.add_argument("--pose", default="rest", choices=("rest", "stance"))
    ap.add_argument("--out", default=os.path.join(os.environ.get("TEMP", "."), "rampart_stilt_out"))
    a = ap.parse_args(argv)
    POSE["mode"] = a.pose
    os.makedirs(a.out, exist_ok=True)
    V.clear_scene()
    root, objs, info = build_mass() if a.mass else build_full()
    name = "Rampart_Stilt" + ("_mass" if a.mass else "") + ("_stance" if a.pose == "stance" else "")
    V.export_fbx(root, os.path.join(a.out, name + ".fbx"))
    with open(os.path.join(a.out, name + ".json"), "w") as f:
        json.dump(info, f, indent=1)
    print("TRIS", info["tris_total"], json.dumps(info.get("tris_by_part", info["tris"])))
    if "axis_aligned_plates" in info:
        print("AXIS", json.dumps({k: (v["share"], v["all_faces_share"]) for k, v in info["axis_aligned_plates"].items()}))
    print("HSSTATS", json.dumps(H.report()["stats"]))
    print("LEGS", json.dumps(R.leg_report()))
    print("LENGTHS", json.dumps(lengths()))


if __name__ == "__main__":
    main()
