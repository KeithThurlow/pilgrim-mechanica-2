"""Rampart Rocket: a rocket-salvo Rampart on a compact torso (Akiyama Motors, "The Utilitarian Standard"). 2026-10-24.

    node tools/blender/run.mjs tools/blender/mechs/studies/rampart/export_game.py -- \
        --model tools/blender/mechs/variants/rampart-rocket/rampart_rocket.py --out <scratch>/rampart-rocket.fbx
    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-rocket/shots_rocket.py -- --out <ABS DIR> [--only ...]

Built on rampart_v4 (legs and pelvis unchanged). What this module replaces (patched onto rampart_v4, whose build_full()
calls its own globals):
  * torso(): the old catalogue's compact torso ("a short core under a flat, wide chest wedge, a sensor head on a neck"):
    a 2.0 m wide, 0.9 m tall wedge lofted through six stations (a pike nose, a three-facet glacis), a short core column
    round the waist, a small faceted sensor head on a neck in a well on the deck. 1.8 m deep (v4 2.6 m), so the game's
    back drums and power pack hang clear behind it.
  * arm_r() / arm_l(): the rocket salvo pod (the game mirrors the right one onto the left shoulder): a launcher box with a
    raked face, a 3 x 4 tube grid in one bone-coloured face plate (the signature form, kept whole) behind an armoured lip,
    a top-hinged blast door shown open over the top on two struts, the elevation hinge on the shoulder axis (an axle into
    a collar on the box's inner face, a bolted hub on the outer face, an elevation ram under the belly), a reload hatch
    on the top rear, a backblast grille on the back.
  * export hooks: export_gun_points() (PodSpin_R on the hinge axis, PodMuzzle0..11_R at the tube mouths in firing order,
    PodEject_R at the backblast grille) and export_split_guns() (Part_PodSpin_R = the outer hub's plain cap, which turns
    invisibly about the hinge axis when the game spins it).

Units m, Z up, front -Y, the mech's left +X.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
RAMP = os.path.join(MECHS, "studies", "rampart")
for p in (HERE, RAMP, MECHS, os.path.join(MECHS, "studies", "military")):
    if p not in sys.path:
        sys.path.insert(0, p)

import bpy  # noqa: E402,F401
from mathutils import Matrix, Vector  # noqa: E402

import hskit as H  # noqa: E402
import mil_kit as K  # noqa: E402
from mil_kit import V  # noqa: E402
import rampart_v4 as R  # noqa: E402
from rampart_v2 import ccw, mx, rrect, ellipse, hull2d, flagall  # noqa: E402

V3 = Vector
X_, Y_, Z_ = V3((1, 0, 0)), V3((0, 1, 0)), V3((0, 0, 1))
slab, scoop, shell, panel, inset, flanges, bricks = R.slab, R.scoop, R.shell, R.panel, R.inset, R.flanges, R.bricks
region, groove, span, rect, Layers, sym, cached, mframe = R.region, R.groove, R.span, R.rect, R.Layers, R.sym, R.cached, R.mframe
PAL, GREY, BARE, MARK, GLOW, PIPE_COLS = R.PAL, R.GREY, R.BARE, R.MARK, R.GLOW, R.PIPE_COLS

# ---------------------------------------------------------------------------------------------- Akiyama palette (sRGB)
PLATE = (0.659, 0.584, 0.443)      # #A89571 plating
BONE = (0.714, 0.643, 0.498)       # #B6A47F secondary
DETAIL = (0.761, 0.710, 0.584)     # #C2B595
TRIM = (0.459, 0.396, 0.290)       # #75654A insets
GUN = (0.365, 0.373, 0.388)        # #5D5F63 mechanical
GUN_L = (0.52, 0.52, 0.50)         # lighter gunmetal: the tube collars (they catch the light)
VISOR = (0.243, 0.353, 0.345)      # #3E5A58
LAMP = (1.0, 0.70, 0.28)           # #FFB347
RUST = (0.58, 0.25, 0.15)
PLATE_D = V.shade(PLATE, 0.80)
BORE = (0.09, 0.085, 0.08)

# re-exported for export_game.py and shots.py
HIP_Z, GX, GZ, POSE, joints, build_full, build_mass = R.HIP_Z, R.GX, R.GZ, R.POSE, R.joints, R.build_full, R.build_mass
HAS_WEAPON_LAYER = True

# the compact torso's shoulder: on the wedge's flank, a little lower than v4's (1.02, 0.10, 4.34)
SH = V3((1.04, 0.05, 4.12))
R.SHOULDER = tuple(SH)


# =============================================================================================================== MASSES
# ---- the chest wedge: a loft along y through six stations (+x halves of (x, z)); the convex hull gives a pike nose and a
#      three-facet glacis (51 / 37 / 14 deg) up to the ridge at y -0.30, then a flat deck and a tapered back
WG_ST = [(-1.10, [(0.10, 3.90), (0.17, 3.98), (0.13, 4.06), (0.05, 4.09)]),
         (-0.90, [(0.27, 3.75), (0.47, 3.87), (0.50, 4.05), (0.40, 4.19), (0.14, 4.25)]),
         (-0.62, [(0.32, 3.66), (0.76, 3.79), (0.90, 3.98), (0.86, 4.23), (0.60, 4.37), (0.20, 4.43)]),
         (-0.30, [(0.34, 3.62), (0.86, 3.75), (1.03, 3.98), (1.01, 4.25), (0.80, 4.44), (0.26, 4.52)]),
         (0.40, [(0.34, 3.62), (0.84, 3.75), (1.01, 3.98), (0.99, 4.25), (0.78, 4.44), (0.26, 4.50)]),
         (0.80, [(0.30, 3.70), (0.70, 3.80), (0.84, 3.98), (0.82, 4.22), (0.66, 4.36), (0.24, 4.40)])]
NECK = V3((0.0, -0.02, 4.40))


def wedge_cuts(d, col=GREY):
    out = []
    for s in (-1, 1):
        out.append(slab((s * 0.74, -0.70, 4.28), (s * 0.6, -0.6, 0.53), d, col=col))                         # cheek facets
        out.append(scoop((s * 0.93, -0.20, 3.83), Y_, V3((s * 0.7, 0, 0.7)).normalized(), (s * 0.7, 0, -0.7), 0.80, 0.20, 0.07,
                         d, col=col))                                                                          # flank scoops (pipes)
    out.append(slab((0, -0.95, 3.84), (0, -0.55, -0.83), d, col=col))                                          # chin underside
    out.append(slab((0, 0.80, 4.34), (0, 0.6, 0.8), d, col=col))                                               # rear deck chamfer
    out.append(slab((0, 0.80, 3.72), (0, 0.6, -0.8), d, col=col))                                              # rear belly chamfer
    out.append(scoop((NECK.x, NECK.y, 4.515), X_, Y_, Z_, 0.46, 0.46, 0.06, d, corner=0.10, slope=0.5, col=col))  # neck well
    return out


@cached
def wedge_mass(d=0.0, col=GREY, flag=0, cuts=True):
    m = H.loft([(y, sym(h)) for y, h in WG_ST], "y", d, "primary", col, "wedge", flag)
    if cuts:
        H.carve(m, wedge_cuts(d, col), bevel=0.0)
        flagall(m, flag)
    return m


@cached
def core_mass(d=0.0, col=GREY, flag=0):
    """The short core column round the waist (flat octagon faces: machinery)."""
    return H.prism(ellipse(0.0, 0.10, 0.44, 0.40, 8, rot=math.pi / 8), "z", 3.36, 3.80, "dark", col, "core", d, flag)


# ---- the sensor head: a small faceted wedge on the neck, a V front
HD_ST = [(-0.40, [(0.12, 4.62), (0.16, 4.68), (0.10, 4.74)]),
         (-0.30, [(0.10, 4.58), (0.25, 4.63), (0.27, 4.74), (0.18, 4.83), (0.0, 4.85)]),
         (0.08, [(0.10, 4.58), (0.25, 4.61), (0.26, 4.75), (0.18, 4.86), (0.0, 4.88)]),
         (0.22, [(0.08, 4.62), (0.20, 4.66), (0.20, 4.76), (0.12, 4.82)])]


@cached
def head_mass(d=0.0, col=GREY, flag=0):
    m = H.loft([(y, sym(h)) for y, h in HD_ST], "y", d, "primary", col, "head", flag)
    H.carve(m, [slab((0, -0.30, 4.85), (0, -0.55, 0.83), d, col=col)], bevel=0.0)     # brow wedge
    flagall(m, flag)
    return m


# ---- the rocket pod (outward x: the mech's right pod at s = -1). Front view (x, z) and side profile (y, z), intersected;
#      the face rakes back 0.12 m over its height (a level shot glances up off it)
# the sides lean in 3-4 deg, the top falls 0.08 m to the back and the back leans forward (axis-aligned share: v1 0.67)
PB_F = [(1.50, 3.84), (2.13, 3.84), (2.23, 3.94), (2.17, 4.96), (2.05, 5.08), (1.58, 5.08), (1.46, 4.96), (1.40, 3.94)]
PB_S = [(-0.90, 3.84), (0.62, 3.84), (0.80, 4.02), (0.76, 4.78), (0.54, 5.00), (-0.78, 5.08), (-0.86, 5.00), (-0.98, 3.96)]
RAKE = 0.12 / 1.02
FACE_T = V3((0, RAKE, 1.0)).normalized()          # up the face
FACE_N = V3((0, -1.0, RAKE)).normalized()         # out of the face
PCX, FACE_Z = 1.81, 4.47                          # face centre (outward x), height
REC_W, REC_H, REC_D = 0.66, 0.84, 0.20            # the face recess behind the lip
FP_DEPTH, FP_HW, FP_HH = 0.05, 0.27, 0.37         # the face plate: 8 cm behind the face, half sizes
COLS, ROWS = (-0.165, 0.0, 0.165), (0.27, 0.09, -0.09, -0.27)   # tube offsets in the face frame (u outward, v up)
TUBE_R, COLLAR_R = 0.058, 0.070
HINGE = (-0.835, 5.15)                            # the blast door's hinge line (y, z) on the lip's top edge
DOOR_A = math.radians(10.0)                       # open: swung up and back over the top, 10 deg above level
DOOR_W, DOOR_L = 0.44, 0.96


def face_y(z):
    return -0.98 + RAKE * (z - 3.96)


def top_z(y):
    return 5.08 - 0.08 * (y + 0.78) / 1.32


def out_x(z):
    return 2.23 - 0.06 * (z - 3.94) / 1.02


def in_x(z):
    return 1.40 + 0.06 * (z - 3.94) / 1.02


def FP(s, x, y, z):
    return V3((s * x, y, z))


def face_c(s):
    return FP(s, PCX, face_y(FACE_Z), FACE_Z)


def pod_cuts(s, d, col=GREY):
    return [scoop(face_c(s), s * X_, FACE_T, FACE_N, REC_W, REC_H, REC_D, d, corner=0.06, slope=0.12, col=col),   # face recess
            scoop(FP(s, PCX, 0.30, top_z(0.30)), X_, Y_, Z_, 0.50, 0.46, 0.04, d, corner=0.04, slope=0.4, col=col),        # reload hatch well
            slab(FP(s, 2.20, -0.90, 3.88), (s * 0.55, -0.55, -0.63), d, col=col),                                  # outer bottom-front facet
            slab(FP(s, 2.16, -0.82, 5.02), (s * 0.6, -0.5, 0.62), d, col=col),                                     # outer top-front facet
            slab(FP(s, 1.42, 0.62, 3.86), (-s * 0.5, 0.6, -0.62), d, col=col)]                                      # inner belly-rear chamfer


@cached
def pod_mass(s, d=0.0, col=GREY, flag=0, cuts=True):
    m = H.intersect([H.prism(mx(PB_F, s), "y", -1.2, 1.0, "primary", col, "pbf", d, flag),
                     H.prism(ccw(hull2d(PB_S)), "x", *span(s * 1.2, s * 2.5), "primary", col, "pbs", d, flag)], "pod")
    if cuts:
        H.carve(m, pod_cuts(s, d, col), bevel=0.0)
        flagall(m, flag)
    return m


def door_M(s):
    v = V3((0, math.cos(DOOR_A), math.sin(DOOR_A)))
    n = V3((0, -math.sin(DOOR_A), math.cos(DOOR_A)))
    return H.frame_matrix(FP(s, PCX, *HINGE), X_, v, n), v, n


def door_solid(s, col=TRIM, mat="primary"):
    """The open blast door: a chamfered stamped slab in its hinge frame (u across, v from the hinge to the free edge, n up)."""
    M, _, _ = door_M(s)
    S = H.Solid("door")
    out = rrect(-DOOR_W, DOOR_W, 0.06, DOOR_L, (0.0, 0.0, 0.08, 0.08), 1)
    inn = rrect(-DOOR_W + 0.03, DOOR_W - 0.03, 0.09, DOOR_L - 0.03, (0.0, 0.0, 0.08, 0.08), 1)
    rings = [[V3((x, y, z)) for x, y in ccw(o)] for z, o in ((-0.03, out), (0.01, out), (0.035, inn))]
    V.prim(S, rings, mat, col, 0, M, jitter=0.0)
    return S


def tube_points(s):
    """Tube mouth centres on the face plate's front, in firing order (top row first; inner, outer, centre)."""
    c = face_c(s) - FACE_N * FP_DEPTH
    u = s * X_
    out = []
    for v in ROWS:
        for k in (0, 2, 1):
            out.append(c + u * COLS[k] + FACE_T * v)
    return out


def circle(r, n=12):
    return [V3((r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n))) for k in range(n)]


def face_plate(s):
    """The signature form: one bone plate filling the recess, a 3 x 4 grid of tube mouths bored through it."""
    c = face_c(s) - FACE_N * FP_DEPTH
    M = H.frame_matrix(c, X_, FACE_T, FACE_N)
    S = H.Solid("face_plate")
    out = rrect(-FP_HW, FP_HW, -FP_HH, FP_HH, 0.05, 1)
    inn = rrect(-FP_HW + 0.025, FP_HW - 0.025, -FP_HH + 0.025, FP_HH - 0.025, 0.05, 1)
    rings = [[V3((x, y, z)) for x, y in ccw(o)] for z, o in ((-0.05, out), (-0.018, out), (0.0, inn))]
    V.prim(S, rings, "primary", DETAIL, 0, M, jitter=0.0)
    cutters = [H.cutter_prism(circle(TUBE_R, 10), t, X_, FACE_T, FACE_N, depth=0.12, out=0.05, slope=0.0, mat="dark", col=BORE)
               for t in tube_points(s)]
    H.carve(S, cutters, bevel=0.006, name="face_plate", min_keep=0.3)
    return S


# ============================================================================================================ mass layer
_ORIG_MASS = R.mass_layer


def mass_layer():
    out = _ORIG_MASS()
    out["Torso"] = [wedge_mass(), core_mass(), head_mass(),
                    H.prism(ellipse(NECK.x, NECK.y, 0.13, 0.13, 8), "z", 4.36, 4.64, "dark", GREY, "neck")]
    for s in (1, -1):
        out["Torso"].append(H.prism(ellipse(SH.y, SH.z, 0.21, 0.21, 10), "x", *span(s * 0.86, s * 1.14), "dark", GREY, "shoulder"))
    for s, sfx in ((1, "_L"), (-1, "_R")):
        out["Arm" + sfx] = [pod_mass(s), door_solid(s, GREY),
                            H.prism(ellipse(SH.y, SH.z, 0.17, 0.17, 12), "x", *span(s * 1.06, s * 1.46), "dark", GREY, "axle"),
                            H.prism(rrect(-0.22, 0.40, 3.66, 4.02, 0.08, 1), "x", *span(s * 1.10, s * 1.38), "dark", GREY, "pylon"),
                            H.prism(ellipse(SH.y, SH.z, 0.29, 0.29, 16), "x", *span(s * 2.16, s * 2.29), "dark", GREY, "hub")]
    return out


# ================================================================================================================ torso
def torso():
    part = R.new_part("Torso", R.WAIST, 50)
    L = Layers()
    surf = H.Surface(wedge_mass())
    top = lambda x, y: surf.project(V3((x, y, 5.2)), along=-Z_)  # noqa: E731  (the wedge's top skin at (x, y); the ray reaches 3 m)
    # frame: the pilot tub (the wedge shrunk), the core column, the waist drum, shoulder drums, the neck collar
    tub = mframe(wedge_mass, -0.16, PAL["frame"], 0, False)
    core = recol_dark(core_mass(0.0, PAL["frame"]))
    waist = H.prism(ellipse(0.10, 0.10, 0.32, 0.32, 12), "z", 3.30, 3.70, "dark", V.shade(PAL["frame"], 1.15), "waist")
    sh_d = [H.prism(ellipse(SH.y, SH.z, 0.21, 0.21, 12), "x", *span(s * 0.84, s * 1.14), "dark", V.shade(PAL["frame"], 1.15),
                    "shoulder") for s in (-1, 1)]
    fr = H.fuse([tub, core, waist] + sh_d, "torso_frame", fillet=0.02, segments=1)
    R.pockets(fr, [H.cut_rect(V3((0, 0.62, 3.98)), X_, Z_, Y_, 0.50, 0.24, depth=0.12, corner=0.04, slope=0.2, mat="dark",
                              col=V.shade(PAL["frame"], 0.6))])
    L.add("frame", fr)
    L.add("frame", H.prism(ellipse(NECK.x, NECK.y, 0.19, 0.19, 12), "z", 4.40, 4.50, "dark", V.shade(PAL["frame"], 1.25), "collar"))
    L.add("frame", H.prism(ellipse(NECK.x, NECK.y, 0.12, 0.12, 8), "z", 4.42, 4.64, "dark", V.shade(PAL["frame"], 1.1), "neck"))
    # power: cells round the core column, conduits up to the shoulders
    for s in (-1, 1):
        for y in (-0.12, 0.30):
            V.cyl(L["power"], (s * 0.40, y, 3.56), 0.09, 0.34, axis="z", n=10, mat="dark", col=PAL["power"])
        V.tube_along(L["power"], V.round_path([V3((s * 0.36, 0.36, 3.72)), V3((s * 0.66, 0.30, 3.80)), V3((s * 0.88, 0.12, 3.96)),
                                               V3((s * 0.92, SH.y, SH.z - 0.16))], 0.12), 0.05, "dark", PAL["power"], n=6)
    # actuation: pipe bundles out of the flank scoops into the pod's axle, waist twist rams
    for s in (-1, 1):
        H.pipe_bundle(L["actuation"], [V3((s * 0.60, -0.56, 3.80)), V3((s * 0.88, -0.30, 3.82)), V3((s * 1.00, -0.08, 3.86)),
                                       V3((s * 1.06, 0.16, 3.92))], Z_, 3, 0.024, cols=PIPE_COLS)
        H.ram(L["actuation"], V3((s * 0.30, -0.12, 3.42)), V3((s * 0.42, 0.20, 3.70)), 0.03, sleeve_col=PAL["actuation"],
              rod_col=BARE)
    # mounting: flange hoops round the wedge under the cheek / flank seam and the glacis / deck seam
    flanges(L, wedge_mass(-0.07, PAL["mounting"], 0, False), [(V3((0, 0, 3.95)), Z_), (V3((0, -0.40, 0)), Y_)], 18, 0.12, 0.05,
            stringers=())
    # plates. Tank logic: the glacis thickest and raised, cheeks and flanks medium, deck and back thin.
    wm = lambda d=0.0, col=PLATE, flag=0: wedge_mass(d, col, flag)  # noqa: E731
    up = shell(wm, -0.08, 0.035, PLATE)
    sh = shell(wm, -0.06, 0.0, PLATE)
    thin = shell(wm, -0.07, -0.03, PLATE)
    # the glacis: one plate from the nose to the ridge, its sides following the wedge's V; a vision slit, a darker inset
    gl_slit_p, gl_slit_n = top(0.0, -0.80)
    slit = H.cut_rect(gl_slit_p + gl_slit_n * 0.035, X_, gl_slit_n.cross(X_), gl_slit_n, 0.46, 0.06, depth=0.12, corner=0.015, slope=0.3,
                      mat="dark", col=BORE)
    ip, inn = top(0.0, -0.52)
    L.add("plates", panel(up, region(ccw([(-0.16, -1.12), (0.16, -1.12), (0.60, -0.42), (-0.60, -0.42)]), "z", 3.98, 4.9, PLATE),
                          0.045, "glacis", cuts=[slit, inset(ip + inn * 0.035, X_, Y_, inn, 0.56, 0.12, PLATE_D)]))
    for s in (-1, 1):
        L.add("plates", panel(sh, region(mx([(0.194, -1.122), (1.3, -1.122), (1.3, -0.42), (0.634, -0.442)], s), "z", 3.97, 4.9, PLATE),
                              0.04, "cheek"))
        L.add("plates", panel(sh, region(ccw([(-0.38, 3.97), (0.56, 3.97), (0.56, 4.9), (-0.38, 4.9)]), "x", *span(s * 0.66, s * 1.3),
                                         BONE), 0.04, "wedge_side",
                              cuts=[inset(V3((s * 0.985, 0.36, 4.12)), Y_, Z_, s * X_, 0.30, 0.18, TRIM)]))
        L.add("plates", panel(sh, region(ccw([(-1.2, 3.5), (0.56, 3.5), (0.56, 3.93), (-1.2, 3.93)]), "x", *span(s * 0.50, s * 1.3), PLATE),
                              0.035, "flank"))
        L.add("plates", panel(thin, region(mx(rect(0.24, 0.62, -0.38, 0.56), s), "z", 4.30, 4.9, PLATE), 0.03, "deck"))
    L.add("plates", panel(thin, region(rect(-0.20, 0.20, 0.26, 0.56), "z", 4.30, 4.9, PLATE), 0.03, "deck_spine"))
    L.add("plates", panel(sh, region(rect(-0.46, 0.46, 3.5, 3.93), "y", -1.2, -0.40, PLATE), 0.035, "chin"))
    # the back plate, with a window for the deck louvres (the one heat feature)
    hn = V3((0, 0.6, 0.8))
    hv = V3((0, -0.8, 0.6))
    hc = V3((0, 0.70, 4.415))
    L.add("plates", panel(thin, region(rect(-1.3, 1.3, 3.5, 4.9), "y", 0.60, 1.2, PLATE), 0.03, "back",
                          cuts=[H.cut_rect(hc, X_, hv, hn, 0.90, 0.15, depth=0.20, corner=0.02, slope=0.1, mat="dark", col=BORE)]))
    V.louvres(L["heat"], hc - hn * 0.05, X_, hv, hn, 0.86, 0.13, 6, "dark", V.shade(PAL["heat"], 0.8), tilt=0.5, t=0.018)
    back_rack(L)
    # the head: crown and a lower band, a visor slot across the V front; frame inside
    hm = lambda d=0.0, col=PLATE, flag=0: head_mass(d, col, flag)  # noqa: E731
    L.add("frame", mframe(head_mass, -0.06, PAL["frame"]))
    hsh = shell(hm, -0.045, 0.0, PLATE)
    hsb = shell(hm, -0.045, 0.0, BONE)
    visor = H.cut_rect(V3((0, -0.36, 4.705)), X_, Z_, -Y_, 0.46, 0.07, depth=0.10, corner=0.01, slope=0.2, mat="dark", col=BORE)
    L.add("plates", panel(hsb, region(rect(-0.6, 0.6, -0.6, 0.4), "z", 4.775, 5.1, BONE), 0.025, "head_crown"))
    L.add("plates", panel(hsh, region(rect(-0.6, 0.6, -0.6, 0.4), "z", 4.4, 4.745, PLATE), 0.025, "head_low", cuts=[visor]))
    # seals: the waist boot and the neck boot
    H.bellows(L["seals"], V3((0, 0.1, 3.34)), V3((0, 0.1, 3.64)), 0.36, 0.34, folds=3, depth=0.025, n=14, col=PAL["seals"])
    H.bellows(L["seals"], V3((NECK.x, NECK.y, 4.48)), V3((NECK.x, NECK.y, 4.60)), 0.15, 0.13, folds=2, depth=0.015, n=10,
              col=PAL["seals"])
    # service: rivet rows along the glacis foot and the deck seams (stamped steel), lifting eyes, a grab bar, the unit number
    for s in (-1, 1):
        p0, n0 = top(s * 0.28, -0.96)
        p1, n1 = top(s * 0.58, -0.50)
        V.bolt_row(L["service"], p0 + n0 * 0.035, p1 + n1 * 0.035, 5, (n0 + n1).normalized(), r=0.018, col=BARE)
        pe, ne = top(s * 0.44, 0.40)
        H.lifting_eye(L["service"], pe + ne * (-0.03), Z_, r=0.07, t=0.02)
        K.stencil(L["service"], "05", V3((s * 0.958, 0.36, 4.12)), s * Y_, Z_, s * X_, 0.12, "secondary", MARK)
    # sensors: the vision block behind the slit, the head's three lens ports in the visor slot (teal, one amber), an antenna
    V.blk(L["sensors"], tuple(gl_slit_p - gl_slit_n * 0.05), (0.42, 0.08, 0.05), "glass", VISOR, ch=0.01, mid=True)
    for x, r, col in ((-0.12, 0.030, VISOR), (0.0, 0.040, VISOR), (0.12, 0.026, LAMP)):
        V.cyl(L["sensors"], (x, -0.33, 4.705), r + 0.012, 0.05, axis="y", n=12, mat="dark", col=R.FRAME)
        f = V.cyl(L["sensors"], (x, -0.358, 4.705), r, 0.008, axis="y", n=12, mat="glow" if col is LAMP else "glass", col=col)
        if col is LAMP:
            H.glow_flag(f, L["sensors"])
    V.bar(L["sensors"], V3((0.16, 0.10, 4.84)), V3((0.20, 0.18, 5.40)), 0.012, "trim", BARE, 5)
    L.flush(part)
    return part


def back_rack(L):
    """The universal back rack (Akiyama: modular, bolt anything on): the game hangs its ammo drums (front face y 1.15,
    z 3.29-4.01) and power pack (front y 1.10, z 4.40-5.10) about 1.1 m behind the waist; the compact hull ends at y 0.80,
    so two L-brackets carry a shelf under the pack and a face plate of rails the drums clamp to."""
    fcol = V.shade(PAL["frame"], 1.3)
    for s in (-1, 1):
        x0, x1 = span(s * 0.40, s * 0.47)
        bracket = [(0.60, 4.22), (1.04, 4.22), (1.04, 3.42), (1.11, 3.42), (1.11, 4.38), (0.60, 4.38)]     # an L in (y, z)
        L.add("frame", H.prism(ccw(bracket), "x", x0, x1, "dark", fcol, "rack"))
        H.ram(L["actuation"], V3((s * 0.43, 0.70, 3.72)), V3((s * 0.43, 1.02, 4.20)), 0.022, sleeve_col=PAL["actuation"], rod_col=BARE)
        for z in (3.62, 3.90, 4.33):
            V.blk(L["service"], (s * 0.435, 1.115, z), (0.10, 0.03, 0.08), "trim", BARE, ch=0.008, mid=True)   # clamp blocks
    for z, r in ((4.34, 0.03), (3.47, 0.028)):
        V.bar(L["frame"], V3((-0.62, 1.075, z)), V3((0.62, 1.075, z)), r, "dark", fcol, 6)
    V.bar(L["frame"], V3((-0.62, 0.80, 4.34)), V3((0.62, 0.80, 4.34)), 0.03, "dark", fcol, 6)
    H.pipe_bundle(L["actuation"], [V3((0.20, 0.72, 3.90)), V3((0.24, 0.92, 3.96)), V3((0.26, 1.08, 4.10)), V3((0.28, 1.10, 4.36))], X_,
                  2, 0.022, cols=PIPE_COLS)


def recol_dark(S):
    return R.darken(S)


# ================================================================================================================== pod
def pod(s):
    """The rocket salvo pod on the shoulder at side s (the game uses the right one, s = -1, and mirrors it)."""
    sfx = "_L" if s > 0 else "_R"
    part = R.new_part("Arm" + sfx, V3((s * SH.x, SH.y, SH.z)), 62 if s > 0 else 61)
    L = Layers()
    F = lambda x, y, z: FP(s, x, y, z)  # noqa: E731
    fcol = PAL["frame"]
    # frame: the elevation axle from the shoulder drum into the box (on the game's pitch axis), the pylon foot under it, the
    # box's inner core, the collar where the axle enters, the bolted hub on the outer face
    L.add("frame", H.prism(ellipse(SH.y, SH.z, 0.17, 0.17, 12), "x", *span(s * 1.06, s * 1.46), "dark", V.shade(fcol, 1.15), "axle"))
    L.add("frame", H.prism(rrect(-0.22, 0.40, 3.66, 4.02, 0.08, 1), "x", *span(s * 1.10, s * 1.38), "dark", fcol, "pylon"))
    L.add("frame", mframe(pod_mass, s, -0.12, fcol))
    L.add("frame", H.prism(ellipse(SH.y, SH.z, 0.26, 0.26, 14), "x", *span(s * 1.32, s * 1.47), "dark", V.shade(fcol, 1.1), "collar"))
    hub = H.prism(ellipse(SH.y, SH.z, 0.29, 0.29, 16), "x", *span(s * 2.16, s * 2.29), "dark", V.shade(fcol, 1.25), "hub")
    H.carve(hub, [H.cut_rect(F(2.29, SH.y, SH.z), Y_, Z_, s * X_, 0.36, 0.36, depth=0.05, corner=0.17, slope=0.3, mat="dark",
                             col=V.shade(fcol, 0.7))], bevel=0.01)
    L.add("frame", hub)
    for k in range(8):
        a = 2 * math.pi * k / 8 + math.pi / 8
        V.bolt(L["service"], F(2.29, SH.y + math.cos(a) * 0.235, SH.z + math.sin(a) * 0.235), s * X_, r=0.024, h=0.03, col=BARE)
    # the spinning piece (Part_PodSpin_R): a plain cap in the hub's centre on the hinge axis, so a spin doesn't show
    cap = H.Solid("cap")
    V.cyl(cap, tuple(F(2.30, SH.y, SH.z)), 0.13, 0.06, axis="x", n=16, mat="trim", col=GUN)
    V.cyl(cap, tuple(F(2.345, SH.y, SH.z)), 0.06, 0.03, axis="x", n=12, mat="trim", col=GUN_L)
    L.add("weapon", cap)
    # plates: an armoured lip round the face (raised, its back seam leaning with the face), the sides split by a seam
    # leaning the same way, a thin top, belly and back
    pm = lambda d=0.0, col=PLATE, flag=0: pod_mass(s, d, col, flag)  # noqa: E731
    up = shell(pm, -0.035, 0.035, PLATE)
    sh = shell(pm, -0.06, 0.0, PLATE)
    thin = shell(pm, -0.05, -0.015, PLATE)
    xs = span(s * 1.2, s * 2.5)
    lip_y = lambda z: face_y(z) + 0.16  # noqa: E731
    seam = lambda z: -0.34 + RAKE * (z - 3.96)  # noqa: E731
    L.add("plates", panel(up, region(ccw([(-1.3, 3.6), (lip_y(3.6), 3.6), (lip_y(5.4), 5.4), (-1.3, 5.4)]), "x", *xs, PLATE), 0.045,
                          "pod_lip"))
    L.add("plates", panel(sh, region(ccw([(lip_y(3.9) + 0.04, 3.9), (seam(3.9), 3.9), (seam(4.94), 4.94), (lip_y(4.94) + 0.04, 4.94)]), "x",
                                     *span(s * 2.0, s * 2.6), PLATE), 0.04, "pod_out_front"))
    L.add("plates", panel(sh, region(ccw([(seam(3.9) + 0.04, 3.9), (0.60, 3.9), (0.60, 4.94), (seam(4.94) + 0.04, 4.94)]), "x",
                                     *span(s * 2.0, s * 2.6), PLATE), 0.04, "pod_out_back",
                          cuts=[inset(F(out_x(4.62), 0.30, 4.62), Y_, Z_, s * X_, 0.30, 0.22, BONE, depth=0.02)]))
    L.add("plates", panel(sh, region(ccw([(lip_y(3.9) + 0.04, 3.9), (0.60, 3.9), (0.60, 4.94), (lip_y(4.94) + 0.04, 4.94)]), "x",
                                     *span(s * 1.2, s * 1.62), PLATE), 0.035, "pod_in",
                          cuts=[groove(F(in_x(4.62), -0.30, 4.62), Y_, Z_, -s * X_, 0.60)]))
    thin_b = shell(pm, -0.05, -0.015, BONE)
    L.add("plates", panel(thin_b, region(mx(rect(1.2, 2.5, lip_y(5.08) + 0.04, 0.60), s), "z", 4.97, 5.6, BONE), 0.03, "pod_top"))
    L.add("plates", panel(thin, region(mx(rect(1.2, 2.5, lip_y(3.84) + 0.04, 0.60), s), "z", 3.5, 3.88, PLATE), 0.025, "pod_belly"))
    bc = F(1.81, 0.78, 4.42)
    L.add("plates", panel(thin, region(mx(rect(1.2, 2.5, 3.5, 5.4), s), "y", 0.64, 1.2, PLATE), 0.03, "pod_back",
                          cuts=[H.cut_rect(bc, X_, Z_, Y_, 0.50, 0.46, depth=0.20, corner=0.03, slope=0.1, mat="dark", col=BORE)]))
    # the signature form: the face plate with its 3 x 4 tube grid
    L.add("plates", face_plate(s))
    # the open blast door over the top, its hinge knuckles on the lip, two struts holding it
    L.add("plates", door_solid(s))
    M, dv, dn = door_M(s)
    hz = FP(s, PCX, *HINGE)
    for k, u in enumerate((-0.33, -0.11, 0.11, 0.33)):
        V.cyl(L["actuation"] if k % 3 == 0 else L["plates"], tuple(hz + s * X_ * u), 0.045, 0.13, axis="x", n=10, mat="trim",
              col=GUN if k % 3 == 0 else PLATE)
    V.bar(L["actuation"], hz - X_ * 0.42, hz + X_ * 0.42, 0.02, "trim", BARE, 6)
    for x in (1.36, 2.26):
        a = F(x, -0.64, 4.70)
        b = F(x, HINGE[0] + 0.45 * dv.y, HINGE[1] + 0.45 * dv.z - 0.03)
        H.ram(L["actuation"], a, b, 0.026, sleeve_col=PAL["actuation"], rod_col=BARE)
        V.blk(L["frame"], tuple(a), (0.06, 0.08, 0.08), "dark", fcol, ch=0.01, mid=True)
    # stiffener ribs and a hazard band on the door's up face (stamped steel)
    for u in (-0.22, 0.22):
        p0, p1 = M @ V3((u, 0.14, 0.035)), M @ V3((u, DOOR_L - 0.12, 0.035))
        V.bar(L["plates"], p0, p1, 0.022, "primary", BONE, 4)
    K.hazard(L["service"], M @ V3((0.0, DOOR_L - 0.10, 0.037)), X_, dv, dn, 0.70, 0.07, 7, RUST, MARK)
    # weapon: per tube a bright collar ring on the plate, a warhead nose 5-17 cm back with a rust tip, a dark liner behind
    wk = H.Solid("tubes")
    for t in tube_points(s):
        ring = [t + FACE_N * 0.006 + s * X_ * p.x + FACE_T * p.y for p in circle(COLLAR_R, 10)]
        H.ring_tube(wk, ring, 0.012, "trim", GUN_L)
        V.cyl(wk, tuple(t + Y_ * 0.11), 0.048, 0.12, axis="y", n=8, mat="trim", col=(0.42, 0.43, 0.40),
              profile=[(0.0, 0.45), (0.5, 1.0), (1.0, 1.0)])
        V.cyl(wk, tuple(t + Y_ * 0.045), 0.020, 0.012, axis="y", n=8, mat="secondary", col=RUST)
        V.cyl(wk, tuple(t + Y_ * 0.31), 0.064, 0.28, axis="y", n=8, mat="dark", col=BORE)
    L.add("weapon", wk)
    # the reload hatch in the top well: a bone hatch, a hinge bar along its inner edge, two latch handles, the round count
    hc = F(PCX, 0.30, top_z(0.30) - 0.04 - 0.015)
    V.surf_blk(L["service"], hc, X_, Y_, Z_, 0.42, 0.38, 0.025, "primary", DETAIL, ch=0.008)
    V.bar(L["service"], hc + V3((-s * 0.22, -0.17, 0.03)), hc + V3((-s * 0.22, 0.17, 0.03)), 0.018, "trim", BARE, 6)
    for y in (-0.10, 0.10):
        q = hc + V3((s * 0.15, y, 0.025))
        V.bar(L["service"], q, q + V3((0, 0, 0.05)), 0.012, "trim", BARE, 5)
        V.bar(L["service"], q + V3((0, 0, 0.05)), q + V3((s * 0.06, 0, 0.05)), 0.012, "trim", BARE, 5)
        V.bar(L["service"], q + V3((s * 0.06, 0, 0.05)), q + V3((s * 0.06, 0, 0.0)), 0.012, "trim", BARE, 5)
    K.stencil(L["service"], "12", hc + V3((0, 0.0, 0.026)) + V3((-s * 0.04, 0, 0)), X_, Y_, Z_, 0.10, "secondary", MARK)
    # heat: the backblast grille in the back window
    V.louvres(L["heat"], bc + Y_ * (-0.06), X_, Z_, Y_, 0.46, 0.42, 5, "dark", V.shade(PAL["heat"], 0.8), tilt=0.5, t=0.02)
    # actuation: the elevation ram from the pylon foot forward under the belly, the shoulder boot, feed hoses into the box
    ra, rb = F(1.30, 0.32, 3.72), F(1.50, -0.66, 3.76)
    H.ram(L["actuation"], ra, rb, 0.042, sleeve_col=PAL["actuation"], rod_col=BARE)
    V.blk(L["frame"], tuple(rb + V3((0, 0, 0.04))), (0.10, 0.12, 0.08), "dark", fcol, ch=0.015, mid=True)
    H.bellows(L["seals"], F(1.08, SH.y, SH.z), F(1.30, SH.y, SH.z), 0.20, 0.20, folds=2, depth=0.02, n=12, col=PAL["seals"])
    H.pipe_bundle(L["actuation"], [F(1.14, 0.30, 3.92), F(1.30, 0.40, 3.98), F(1.38, 0.42, 4.30), F(1.38, 0.30, 4.62)], Y_, 2, 0.024,
                  cols=PIPE_COLS)
    # add-on bricks low on the outer front flank (spaced armour facing the side threat)
    bricks(L, F(out_x(4.12), -0.52, 4.12), s * Y_, Z_, s * X_, 2, 2, (0.16, 0.14), col=BONE)
    # service: a hazard band under the face, the pod number on the outer back panel, a lifting eye, a grab rail on the inside
    K.hazard(L["service"], F(PCX, face_y(4.0), 4.0) + FACE_N * 0.04, X_, FACE_T, FACE_N, 0.50, 0.045, 6, RUST, MARK)
    K.stencil(L["service"], "05", F(out_x(4.62) - 0.018, 0.30, 4.62), s * Y_, Z_, s * X_, 0.12, "secondary", MARK)
    H.lifting_eye(L["service"], F(1.68, 0.50, top_z(0.50) - 0.02), Z_, r=0.06, t=0.018)
    V.bar(L["service"], F(in_x(4.80) - 0.06, -0.40, 4.80), F(in_x(4.80) - 0.06, 0.30, 4.80), 0.016, "trim", BARE, 6)
    for y in (-0.40, 0.30):
        V.bar(L["service"], F(in_x(4.80) - 0.06, y, 4.80), F(in_x(4.80), y, 4.80), 0.016, "trim", BARE, 6)
    # sensors: a sight lens on the outer front corner (amber), in a small housing
    V.blk(L["frame"], tuple(F(2.27, -0.72, 3.98)), (0.10, 0.14, 0.12), "dark", fcol, ch=0.015, mid=True)
    f = V.cyl(L["sensors"], tuple(F(2.27, -0.795, 3.98)), 0.035, 0.012, axis="y", n=10, mat="glow", col=LAMP)
    H.glow_flag(f, L["sensors"])
    L.flush(part)
    return part


R.torso = torso
R.arm_r = lambda: pod(-1)
R.arm_l = lambda: pod(1)
R.mass_layer = mass_layer
R.STANCE_FIXED["Arm_R"] = (-6, 0, 3)
R.STANCE_FIXED["Arm_L"] = (-12, 0, -4)


# ============================================================================================================ export hooks
SPIN_C = FP(-1, 2.30, SH.y, SH.z)


def export_gun_points():
    pts = {"PodSpin_R": SPIN_C, "PodSpinFwd_R": SPIN_C + V3((-0.5, 0, 0)),
           "PodEject_R": FP(-1, PCX, 0.95, 4.42)}
    for i, t in enumerate(tube_points(-1)):
        pts["PodMuzzle%d_R" % i] = t + V3((0, -0.05, 0))
    return pts


def export_split_guns(parts, split_off):
    arm = parts.get("Arm_R")
    out = {}
    if arm is None:
        return out
    C = SPIN_C

    def pick(c, pts):
        return (c - C).length < 0.07 and max((p - C).length for p in pts) < 0.16
    o, n = split_off(arm, pick, "Part_PodSpin_R")
    print("HDX split %d hub-cap islands -> %s" % (n, o.name if o else None))
    if o is not None:
        out["PodSpin_R"] = o
    return out
