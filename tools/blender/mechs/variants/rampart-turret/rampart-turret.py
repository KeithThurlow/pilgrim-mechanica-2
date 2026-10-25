"""Rampart turret (variant `rampart-turret`, 2026-10-24): the Rampart v4 with its hull and cockpit head replaced by a low,
wide, long faceted tank turret (old catalogue `torso.turret`: "Headless, wide, long and angular, like an M1 Abrams turret:
heavily armoured, slow to traverse"). Brand Stratford-Aegis. Breakdown: docs/mechs/rampart-turret/breakdown.md.

    node tools/blender/run.mjs tools/blender/mechs/studies/rampart/export_game.py -- \
        --model tools/blender/mechs/variants/rampart-turret/rampart-turret.py --out <ABS>.fbx
    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-turret/shots_turret.py -- --out <ABS DIR> --only ...

Built on rampart_v4: legs, pelvis, feet and the right minigun pod are v4's (repainted); the torso is replaced (patched onto
the rampart_v4 module, whose build_full() calls its own globals); the left pod is the right one mirrored (renders only:
the game mirrors the right pod itself, so the export leaves it out).

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
from rampart_v2 import ccw, mx, rrect, ellipse, flagall, recol  # noqa: E402

V3 = Vector
X_, Y_, Z_ = V3((1, 0, 0)), V3((0, 1, 0)), V3((0, 0, 1))

# what export_game.py reads from the model module
HIP_Z, GX, GZ, POSE = R.HIP_Z, R.GX, R.GZ, R.POSE
joints = R.joints
HAS_WEAPON_LAYER = True
EXPORTING = any("export_game" in a for a in sys.argv)

# ------------------------------------------------------------------------------------------------- Stratford-Aegis paint
BRAND_PAINT = True
SA_GREY = (0.60, 0.61, 0.60)        # pale aerospace grey: the main plates
SA_GREY_D = (0.47, 0.48, 0.48)      # darker inset sub-panels
SA_GUN = (0.36, 0.38, 0.41)         # blue-grey gunmetal: glacis, bricks, lower-leg guards
SA_GUN_D = (0.27, 0.285, 0.31)
SA_FRAME = (0.23, 0.235, 0.235)     # frame: neutral dark grey (never near-black)
SA_RED = (0.72, 0.14, 0.11)
SA_MARK = (0.90, 0.90, 0.87)
GLASS = (0.16, 0.24, 0.22)
GLOW = R.GLOW
BARE = R.BARE
# v4 colour -> brand colour; matched by chromaticity, so rim / wall tints (a colour times k) map to the same k times the new one
REMAP = [(R.KHAKI, SA_GREY), (R.KHAKI_D, SA_GREY_D), (R.KHAKI2, (0.50, 0.52, 0.54)), (R.OLIVE, SA_GUN), (R.OLIVE_D, SA_GUN_D),
         (R.BROWN, (0.30, 0.30, 0.32)), (R.FRAME, SA_FRAME), (R.MARK, SA_MARK)]


def _chroma(c):
    s = c[0] + c[1] + c[2]
    return (c[0] / s, c[1] / s) if s > 1e-6 else (0.333, 0.333)


def brand_paint(pieces):
    """Repaints every loop whose colour is a v4 paint colour (times any k) into the brand colour times the same k."""
    src = [(_chroma(a), a, b) for a, b in REMAP]
    for P in pieces:
        for f in P.bm.faces:
            for lp in f.loops:
                c = lp[P.col]
                ch = _chroma(c)
                best, bd = None, 0.006
                for sc, a, b in src:
                    dd = abs(ch[0] - sc[0]) + abs(ch[1] - sc[1])
                    if dd < bd:
                        best, bd = (a, b), dd
                if best is None:
                    continue
                a, b = best
                k = (c[0] + c[1] + c[2]) / (a[0] + a[1] + a[2])
                lp[P.col] = (min(1.0, b[0] * k), min(1.0, b[1] * k), min(1.0, b[2] * k), 1.0)


# ================================================================================================================ MASS
# The turret: plan (z) ∩ side (x) ∩ front (y) profiles, then cuts. +x halves are mirrored by R.sym.
PLAN_H = [(0.0, -1.70), (0.36, -1.55), (1.00, -1.12), (1.06, -0.88), (1.06, 0.30), (0.92, 0.64), (0.74, 1.02), (0.0, 1.02)]
SIDE = [(-1.70, 4.14), (-0.74, 4.70), (0.60, 4.80), (1.02, 4.74), (1.02, 4.20), (0.62, 3.92), (-0.90, 3.80), (-1.40, 3.86)]
FRONT_H = [(0.0, 3.78), (0.78, 3.78), (1.06, 4.00), (1.04, 4.22), (0.96, 4.58), (0.78, 4.72), (0.0, 4.80)]   # sides lean, roof crowned
# the glacis plane (the signature form): lip (-1.70, 4.14) -> crease (-0.74, 4.70), a 30 degree slope
GL_O = V3((0.0, -1.22, 4.42))
GL_V = V3((0.0, 0.96, 0.56)).normalized()          # up the slope
GL_N = V3((0.0, -0.56, 0.96)).normalized()         # out of it (forward and up)
GL_HALF = 0.5557
LOW_N = V3((0.0, -0.28, -0.30)).normalized()       # the lower front face under the lip (faces forward and down)
LOW_V = V3((0.0, -0.30, 0.28)).normalized()
CHEEK_N = V3((0.45, -0.70, 0.55)).normalized()     # the compound cheek facet (x mirrored per side)
SHOULDER_REC = (0.78, 0.56, 0.14)                  # w (along y), h, depth of the shoulder recesses


def turret_cuts(d, col=R.GREY):
    out = []
    for s in (-1, 1):
        out.append(R.slab((s * 0.92, -1.22, 4.40), (s * CHEEK_N.x, CHEEK_N.y, CHEEK_N.z), d, col=col))      # cheek facet
        out.append(R.slab((s * 0.95, -1.10, 3.92), (s * 0.5, -0.45, -0.74), d, col=col))                     # front lower corner
        out.append(R.slab((s * 0.90, 0.80, 4.06), (s * 0.55, 0.25, -0.80), d, col=col))                      # bustle lower side
        w, h, dep = SHOULDER_REC
        out.append(R.scoop((s * 1.055, R.SHOULDER[1], R.SHOULDER[2]), Y_, Z_, (s, 0, 0), w, h, dep, d, corner=0.12, slope=0.35,
                           col=col))                                                                          # shoulder recess
    out.append(R.slab((0, 1.02, 4.52), (0, 0.55, 0.83), d, col=col))                                         # bustle top-rear
    out.append(R.scoop((0, -1.55, 4.00), X_, LOW_V, LOW_N, 1.10, 0.17, 0.07, d, corner=0.03, slope=0.4, col=col))  # vision band
    out.append(R.scoop((0.42, 0.40, 4.757), X_, Y_, Z_, 0.58, 0.58, 0.05, d, corner=0.17, slope=0.5, col=col))  # hatch well
    return out


@R.cached
def turret_mass(d=0.0, col=R.GREY, flag=0, cuts=True):
    m = H.intersect([H.prism(R.sym(PLAN_H), "z", 3.0, 5.6, "primary", col, "tp", d, flag),
                     H.prism(ccw(SIDE), "x", -1.6, 1.6, "primary", col, "ts", d, flag),
                     H.prism(R.sym(FRONT_H), "y", -2.2, 1.6, "primary", col, "tf", d, flag)], "turret")
    if cuts:
        H.carve(m, turret_cuts(d, col), bevel=0.0)
    flagall(m, flag)
    return m


RING_R, RING_Z = 0.68, (3.58, 3.84)


def ring_solid(col=R.GREY, mat="dark", d=0.0):
    return H.prism(ellipse(0.0, R.WAIST.y, RING_R, RING_R, 16), "z", RING_Z[0], RING_Z[1], mat, col, "ring", d)


def mirror_x(S):
    return H.xform(S, Matrix.Scale(-1.0, 4, X_))


_mass_layer_v4 = R.mass_layer


def mass_layer():
    out = _mass_layer_v4()
    out["Torso"] = [turret_mass(), ring_solid()]
    for s in (-1, 1):
        out["Torso"].append(H.prism(ellipse(R.SHOULDER[1], R.SHOULDER[2], 0.21, 0.21, 10), "x", *HD1.span(s * 0.9, s * 1.14),
                                    "dark", R.GREY, "shoulder"))
    out["Arm_L"] = [mirror_x(S.copy("mir")) for S in out["Arm_R"]]
    return out


R.mass_layer = mass_layer
build_mass = R.build_mass
build_full = R.build_full


# ============================================================================================================== LAYERS
F_REGION = HD1.F_REGION
WAIST = R.WAIST
PALf = R.PAL["frame"]


def greg(outline, a0, a1, col=SA_GREY):
    """A panel region drawn in the glacis plane (u = x, v up the slope), extruded along its normal."""
    return H.flow_region(ccw(outline), GL_O, X_, GL_V, GL_N, a0, a1, "primary", V.shade(col, 0.85), F_REGION)


def reg(outline, axis, a0, a1, col=SA_GREY):
    return R.region(ccw(outline), axis, a0, a1, col)


def gpt(u, v, n=0.0):
    """A point in the glacis frame."""
    return GL_O + X_ * u + GL_V * v + GL_N * n


def side_front_y(z, v=0.47):
    """y where the slanted seam plane (v = const in the glacis frame) crosses height z."""
    return GL_O.y + (v - GL_V.z * (z - GL_O.z)) / GL_V.y


GLACIS = [(-0.40, -0.80), (0.40, -0.80), (0.62, 0.525), (-0.62, 0.525)]   # a wedge widening up the slope
CHEEK = [(0.404, -1.05), (1.9, -1.05), (1.9, 0.38), (0.95, 0.38), (0.95, 0.62), (0.681, 0.62), (0.664, 0.518)]   # glacis edge + 4.5 cm


def torso():
    part = R.new_part("Torso", WAIST, 50)
    L = R.Layers()
    tm = lambda d=0.0, col=SA_GREY, flag=0: turret_mass(d, col, flag)  # noqa: E731
    # ---- frame: the turret's inner hull (the pilot tub), the ring and basket, the waist drum, shoulder drums
    tub = R.mframe(turret_mass, -0.20, PALf, 0, True)
    ring = H.prism(ellipse(0.0, WAIST.y, RING_R, RING_R, 16), "z", RING_Z[0], 4.06, "dark", V.shade(PALf, 1.1), "ring")
    waist = H.prism(ellipse(0.0, WAIST.y, 0.32, 0.32, 12), "z", 3.30, 3.62, "dark", V.shade(PALf, 1.15), "waist")
    sh_d = [H.prism(ellipse(R.SHOULDER[1], R.SHOULDER[2], 0.21, 0.21, 12), "x", *HD1.span(s * 0.80, s * 1.12), "dark",
                    V.shade(PALf, 1.15), "shoulder") for s in (-1, 1)]
    fr = H.fuse([tub, ring, waist] + sh_d, "turret_frame", fillet=0.02, segments=1)
    cuts = []
    for k in range(8):           # lightening pockets round the basket (it carries the turret, so it shows how)
        a = 2 * math.pi * (k + 0.5) / 8
        n = V3((math.cos(a), math.sin(a), 0))
        cuts.append(HD1.pocket(V3((0, WAIST.y, 3.70)) + n * (RING_R * math.cos(math.pi / 16)), Z_.cross(n), Z_, n, 0.16, 0.12, 0.04))
    R.pockets(fr, cuts)
    L.add("frame", fr)
    # the race: a bright bearing lip where the turret turns on the basket
    L.add("actuation", H.prism(ellipse(0.0, WAIST.y, 0.75, 0.75, 20), "z", 3.76, 3.81, "trim", R.PAL["actuation"], "race"))
    # ---- actuation: traverse drives on the ring, pipe bundles under the overhang out to the gun yokes
    for s in (-1, 1):
        c = V3((s * 0.50, WAIST.y - 0.46, 3.66))
        V.blk(L["actuation"], tuple(c), (0.26, 0.22, 0.18), "trim", R.PAL["actuation"], ch=0.03, mid=True)
        V.cyl(L["actuation"], (c.x, c.y, c.z - 0.13), 0.08, 0.10, axis="z", n=10, mat="trim", col=V.shade(R.PAL["actuation"], 0.85))
        H.pipe_bundle(L["actuation"], [V3((s * 0.62, -0.30, 3.70)), V3((s * 0.84, -0.12, 3.72)), V3((s * 0.98, 0.06, 3.84)),
                                       V3((s * 1.10, 0.14, 3.98)), V3((s * 1.20, 0.12, 4.08))], Z_, 3, 0.024, cols=R.PIPE_COLS)
    # ---- power: conduits out of the bustle's underside (where the pack plugs in) round under the turret to the shoulders
    for s in (-1, 1):
        V.tube_along(L["power"], V.round_path([V3((s * 0.28, 0.98, 3.96)), V3((s * 0.44, 0.72, 3.78)), V3((s * 0.70, 0.40, 3.72)),
                                               V3((s * 0.90, 0.16, 3.92)), V3((s * 0.94, 0.10, 4.16))], 0.12), 0.05, "dark",
                     R.PAL["power"], n=6)
    # ---- mounting: two deep flange hoops just under the surface, framed by the two wide seams (8 and 12 cm) so the light web
    # reads at 40 m: the slanted cheek / side seam and the ring round the turret at y 0.60 (sides and roof)
    src = turret_mass(-0.045, R.PAL["mounting"], 0, True)
    R.flanges(L, src, [(gpt(0, 0.425), GL_V), (V3((0, 0.60, 0)), Y_)], 28, 0.14, 0.06, stringers=())
    for s in (-1, 1):       # a pipe pair clipped along the y 0.60 seam, from under the turret up to the roof edge
        H.pipe_bundle(L["actuation"], [V3((s * 0.86, 0.62, 3.84)), V3((s * 0.99, 0.62, 3.98)), V3((s * 0.99, 0.62, 4.30)),
                                       V3((s * 0.90, 0.62, 4.62))], Y_, 2, 0.022, cols=R.PIPE_COLS, clamp_every=0.22)
    # ---- plates. Tank logic: the glacis thickest and raised highest, cheeks thick, sides normal, roof and back thin.
    gl = R.shell(tm, -0.11, 0.06, SA_GUN)
    up = R.shell(tm, -0.09, 0.04)
    sh = R.shell(tm, -0.07, 0.0)
    thin = R.shell(tm, -0.06, -0.02)
    # the signature form: ONE glacis plate, narrow at the lip and widening up the slope like an arrowhead from above,
    # wrapping over the lip; only a red stripe inset sits inside it, nothing cuts across it
    stripe = R.inset(gpt(0.0, 0.33, 0.06), X_, GL_V, GL_N, 0.92, 0.07, SA_RED, depth=0.022)
    L.add("plates", R.panel(gl, greg(GLACIS, -0.12, 0.40, SA_GUN), 0.045, "glacis", cuts=[stripe]))
    for s in (-1, 1):
        creg = H.intersect([greg(mx(CHEEK, s), -1.5, 0.40), reg(mx([(0.45, -2.5), (2.0, -2.5), (2.0, 1.0), (0.45, 1.0)], s), "z",
                                                                  3.0, 5.6)], "cheek_region")
        ins = R.inset(V3((s * 1.10, -0.62, 4.10)), Y_, Z_, (s, 0, 0), 0.30, 0.14, SA_GREY_D, depth=0.022)
        L.add("plates", R.panel(up, creg, 0.045, "cheek", cuts=[ins]))
        L.add("plates", R.panel(sh, reg([(side_front_y(3.5), 3.5), (0.54, 3.5), (0.54, 4.58), (side_front_y(4.58), 4.58)], "x",
                                        s * 0.80, s * 1.6), 0.035, "side"))
        L.add("plates", R.panel(sh, reg([(0.66, 3.5), (1.4, 3.5), (1.4, 4.58), (0.66, 4.58)], "x", s * 0.66, s * 1.6), 0.035,
                                "bustle_side"))
    lb = [(-1.242, 4.397), (-1.924, 3.666), (-1.924, 3.3), (-0.95, 3.3), (-0.95, 4.397)]
    L.add("plates", R.panel(sh, reg(lb, "x", -0.58, 0.58), 0.03, "lower_front"))
    L.add("plates", R.panel(thin, reg([(-1.3, -0.72), (1.3, -0.72), (1.3, 0.54), (-1.3, 0.54)], "z", 4.62, 5.4), 0.03, "roof_front",
                            cuts=[R.inset(V3((0.40, -0.25, 4.71)), Y_, X_, Z_, 0.50, 0.20, SA_GREY_D, depth=0.02)]))
    nv = V3((0, 0.55, 0.83)).normalized()
    vc = V3((-0.36, 0.85, 4.633)) - nv * 0.02
    vents = H.cut_rect(vc, X_, V3((0, -0.83, 0.55)), nv, 0.46, 0.26, depth=0.07, corner=0.03, slope=0.2, mat="dark",
                       col=(0.08, 0.075, 0.07))
    L.add("plates", R.panel(thin, reg([(-1.3, 0.66), (1.3, 0.66), (1.3, 1.4), (-1.3, 1.4)], "z", 4.54, 5.4), 0.03, "roof_rear",
                            cuts=[vents]))
    L.add("plates", R.panel(thin, reg([(-0.62, 3.5), (0.62, 3.5), (0.62, 4.49), (-0.62, 4.49)], "y", 0.95, 1.4), 0.025, "back"))
    # add-on armour: reactive bricks on each cheek's front face (the plan-angled face under the glacis) and its flank
    for s in (-1, 1):
        nf = V3((s * 0.558, -0.830, 0.0))
        uf = V3((s * 0.830, 0.558, 0.0))
        R.bricks(L, V3((s * 0.80, -1.255, 4.07)) + nf * 0.045, uf * s, Z_, nf, 2, 2, (0.19, 0.17), t=0.06, col=SA_GUN)
        R.bricks(L, V3((s * 1.10, -0.66, 4.33)), Y_, Z_, V3((s * 0.97, 0, 0.25)).normalized(), 2, 1, (0.20, 0.14), t=0.05,
                 col=SA_GUN)
    # the gunner's sight "doghouse" on the roof front right: an armoured wedge box, its window facing forward
    dh = H.prism(ccw([(-0.74, 4.66), (-0.28, 4.66), (-0.28, 4.95), (-0.40, 4.99), (-0.62, 4.99)]), "x", -0.64, -0.30, "primary",
                 SA_GUN, "doghouse")
    H.tag_faces(dh, list(dh.bm.faces), H.TAG_ADDON)
    L.add("plates", dh)
    # ---- sensors (the face): three amber lenses in the dark vision band under the glacis lip
    cb = V3((0, -1.55, 4.00)) - LOW_N * 0.05
    V.surf_blk(L["sensors"], cb, X_, LOW_V, LOW_N, 1.00, 0.11, 0.012, "glass", GLASS)
    for x, r in ((-0.32, 0.045), (0.0, 0.06), (0.32, 0.045)):
        p = cb + X_ * x + LOW_N * 0.012
        V.bar(L["sensors"], p, p + LOW_N * 0.05, r + 0.02, "dark", SA_FRAME, 10)
        f = V.bar(L["sensors"], p + LOW_N * 0.05, p + LOW_N * 0.058, r, "glow", GLOW, 10)
        H.glow_flag(f, L["sensors"])
    # the doghouse window, the commander's independent viewer, periscopes round the hatch, laser-warning domes, antennas
    wn = V3((0, -0.913, 0.406))
    V.surf_blk(L["sensors"], V3((-0.47, -0.69, 4.82)), X_, V3((0, 0.406, 0.913)), wn, 0.26, 0.13, 0.012, "glass", GLASS)
    f = V.bar(L["sensors"], V3((-0.36, -0.70, 4.83)), V3((-0.36, -0.715, 4.836)), 0.022, "glow", GLOW, 8)
    H.glow_flag(f, L["sensors"])
    V.cyl(L["sensors"], (0.02, 0.10, 4.80), 0.13, 0.14, axis="z", n=10, mat="dark", col=SA_FRAME)
    head = H.prism(ccw([(-0.06, 4.86), (0.22, 4.86), (0.22, 5.02), (0.04, 5.02), (-0.06, 4.96)]), "x", -0.13, 0.17, "primary",
                   SA_GUN, "citv")
    L.add("sensors", head)
    V.surf_blk(L["sensors"], V3((0.02, -0.065, 4.91)), X_, Z_, -Y_, 0.20, 0.07, 0.012, "glass", GLASS)
    hc = V3((0.42, 0.40, 4.70))
    for a in (-150, -110, -70, -30, 10):
        t = math.radians(a)
        n = V3((math.cos(t), math.sin(t), 0))
        V.surf_blk(L["sensors"], hc + n * 0.33 + Z_ * 0.07, Z_.cross(n), Z_, n, 0.10, 0.06, 0.03, "glass", GLASS)
    for s in (-1, 1):
        V.cyl(L["sensors"], (s * 0.74, -0.98, 4.66), 0.065, 0.06, axis="z", n=10, mat="dark", col=SA_FRAME)
        V.cyl(L["sensors"], (s * 0.74, -0.98, 4.70), 0.05, 0.03, axis="z", n=10, mat="glass", col=GLASS)
        V.cyl(L["sensors"], (s * 0.62, 0.90, 4.60), 0.03, 0.08, axis="z", n=8, mat="trim", col=BARE)
        V.bar(L["sensors"], V3((s * 0.62, 0.90, 4.64)), V3((s * 0.66, 0.98, 5.60)), 0.01, "trim", BARE, 5)
    V.bar(L["sensors"], V3((0.0, 0.92, 4.57)), V3((0.0, 0.92, 5.02)), 0.018, "trim", BARE, 6)       # wind sensor mast
    V.bar(L["sensors"], V3((-0.09, 0.92, 5.02)), V3((0.09, 0.92, 5.02)), 0.014, "trim", BARE, 6)
    for s in (-1, 1):       # amber running lamps low on the cheek faces
        nl = V3((s * 0.558, -0.83, 0))
        f = V.surf_blk(L["sensors"], V3((s * 0.98, -1.15, 3.92)) + nl * 0.05, V3((s * 0.83, 0.558, 0)), Z_, nl, 0.08, 0.04, 0.012,
                       "glow", GLOW)
        H.glow_flag(f, L["sensors"])
    # ---- heat: the louvre bank in the bustle chamfer (the sight and avionics coolers)
    V.louvres(L["heat"], vc - nv * 0.05, X_, V3((0, -0.83, 0.55)), nv, 0.42, 0.22, 4, "dark", V.shade(R.PAL["heat"], 0.8), tilt=0.5,
              t=0.02)
    # ---- service: the commander's hatch in its well, the loader's hatch, lifting eyes, rungs, smoke dischargers, stencils
    V.cyl(L["service"], tuple(hc + Z_ * 0.01), 0.24, 0.05, axis="z", n=14, mat="trim", col=V.shade(BARE, 0.9))
    V.bar(L["service"], hc + V3((-0.10, 0.06, 0.05)), hc + V3((0.10, 0.06, 0.05)), 0.018, "trim", BARE, 6)
    V.cyl(L["service"], (-0.40, 0.30, 4.752), 0.22, 0.03, axis="z", n=14, mat="trim", col=V.shade(BARE, 0.9))
    V.bar(L["service"], V3((-0.48, 0.32, 4.78)), V3((-0.32, 0.32, 4.78)), 0.018, "trim", BARE, 6)
    for s in (-1, 1):
        H.lifting_eye(L["service"], V3((s * 0.70, -0.62, 4.71)), Z_, r=0.06, t=0.02)
        H.lifting_eye(L["service"], V3((s * 0.56, 0.74, 4.70)), Z_, r=0.06, t=0.02)
        H.rungs(L["service"], V3((s * 0.97, 0.80, 3.92)), V3((s * 0.97, 0.80, 4.36)), 2, V3((s, 0, 0)), width=0.18, depth=0.07, r=0.016)
        for i in range(4):          # smoke dischargers on the cheek top-sides, angled up, out and forward
            base = V3((s * 1.02, -1.02 + 0.11 * (i % 2), 4.44 + 0.10 * (i // 2)))
            V.bar(L["service"], base, base + V3((s * 0.10, -0.12, 0.14)), 0.045, "dark", SA_FRAME, 8)
        K.stencil(L["service"], "07", V3((s * 1.117, -0.62, 4.10)), Y_ * s, Z_, V3((s, 0, 0)), 0.10, "secondary", SA_MARK)
    # ---- seals: the waist boot under the basket
    H.bellows(L["seals"], V3((0, WAIST.y, 3.32)), V3((0, WAIST.y, 3.60)), 0.36, 0.34, folds=3, depth=0.025, n=14, col=R.PAL["seals"])
    L.flush(part)
    return part


def arm_l_mirror():
    """The left gun as the right one mirrored (renders only; the game mirrors Part_Pod_R itself)."""
    part = R.arm_r()
    part.name = "Arm_L"
    part.origin = V3((-part.origin.x, part.origin.y, part.origin.z))
    for P in part.layers.values():
        P.name = P.name.replace("Arm_R", "Arm_L")
        P.origin = part.origin.copy()
        for v in P.bm.verts:
            v.co.x = -v.co.x
        bmesh.ops.reverse_faces(P.bm, faces=P.bm.faces[:])
    return part


def build_parts():
    R.SKIN.clear()
    parts = [R.pelvis(), torso(), R.arm_r()]
    if not EXPORTING:
        parts.append(arm_l_mirror())
    for s in (1, -1):
        parts += [R.thigh(s), R.shin(s), R.meta(s), R.foot(s)]
    if BRAND_PAINT:
        brand_paint([pc for pt in parts for pc in pt.pieces()])
    return parts


R.torso = torso
R.build_parts = build_parts
R.STANCE_FIXED["Arm_L"] = (-4, 0, -4)


def export_gun_points():
    """export_game hook: the minigun's points only (v4's rocket-tube muzzles are not on this variant)."""
    return {"PodSpin_R": V3((GX, -0.50, GZ)), "PodSpinFwd_R": V3((GX, -1.00, GZ)), "PodMuzzle0_R": V3((GX, -1.90, GZ)),
            "PodEject_R": V3((GX - 0.37, -0.20, 4.00))}
