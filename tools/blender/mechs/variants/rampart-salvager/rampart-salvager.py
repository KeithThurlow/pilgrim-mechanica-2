"""Rampart Salvager: an industrial salvage Rampart from Goliath Earthworks ("The Industrial Leviathan"), 2026-10-24.

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-salvager/rampart-salvager.py -- [--mass] [--pose rest|stance]
        [--out DIR]

Built on rampart_v4 (legs, pelvis and the minigun arm kept), with:
  * the old catalogue's cab torso (torso.cab: "a construction cab with amber windows and the pilot inside: light, fast to
    turn, thinly armoured"): a cab massed as side ∩ front ∩ top prisms with a forward "<" prow (chin glass raking
    forward-down, windscreen raking back), tumblehome sides, a roof well; six cuts.
  * signature form (skill 7b): the front glazing frame, ONE plate round the windscreen and the chin glass, its back seam
    following the prow 0.24 m behind it. Nothing cuts through it.
  * service layer first: a grey roll cage, a work-lamp bar, an amber beacon, a roof rack with a cable spool, crates and
    jerrycans strapped down (tagged addon), lifting eyes on the shoulder housings (the convoy crane's pick points), rungs,
    grab rails, door hinges and handle, D-ring tie-downs, hazard striping, hull number.
  * a winch bumper under the chin: flat machinery, an open drum well, a hydraulic motor, a fairlead and a hook.
  * one heat feature: a diesel exhaust stack at the left rear corner.
  * the hull guns as heavier industrial rotary cannons (thicker barrels, muzzle brakes, a heavy clamp) with a work lamp;
    the spin cluster stays within the exporter's default split (barrel axis, radius < 0.25 m).
  * Goliath paint: yellow plating, charcoal lower parts and leg guards, grey steel machinery, orange accents, amber glass
    (rampart_v4's colours are remapped in place before the build, see recolour()).

The left arm is the right one mirrored (the game mirrors Part_Pod_R and ignores the left arm), so renders show both guns;
export_split_guns() drops Part_Pod_L from the game export.

Units m, Z up, front -Y, the mech's left +X.
"""
import argparse
import inspect
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
RAMP = os.path.join(MECHS, "studies", "rampart")
for _p in (os.path.join(MECHS, "studies", "military"), MECHS, RAMP, HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import hskit as H  # noqa: E402
import mil_kit as K  # noqa: E402
from mil_kit import V  # noqa: E402
import rampart as HD1  # noqa: E402
import rampart_v2 as R2  # noqa: E402
import rampart_v4 as R  # noqa: E402
from rampart_v4 import HIP_Z, GX, GZ, POSE, joints  # noqa: E402,F401  (read by export_game.py)
from rampart_v4 import ccw, mx, rrect, ellipse, sym, slab, scoop, shell, panel, flanges, region, Layers, span, rect  # noqa: E402
from rampart_v4 import mframe, new_part, frame3, recol, flagall  # noqa: E402

V3 = Vector
X_, Y_, Z_ = V3((1, 0, 0)), V3((0, 1, 0)), V3((0, 0, 1))
GREY = (0.62, 0.62, 0.62)

# ------------------------------------------------------------------------------------------------- Goliath palette
# goliath.json: plating #E2A428, secondary #D2692A, dark #2B2825, mechanical #6A6A66, lighting #FFD27A (sRGB)
YELLOW = (0.886, 0.643, 0.157)
YELLOW_D = (0.72, 0.51, 0.12)       # darker inset sub-panels
CHAR = (0.28, 0.27, 0.25)           # charcoal plates (the brand's dark lifted off black: frame and seals stay off near-black)
CHAR_D = (0.21, 0.205, 0.19)
ORANGE = (0.82, 0.41, 0.165)
STEEL = (0.44, 0.44, 0.42)          # mechanical grey: the cage, housings
STEEL_L = (0.60, 0.60, 0.57)
FRAME = (0.24, 0.235, 0.22)
GLASS = (0.46, 0.25, 0.06)          # amber glass (the cab description's amber windows), opaque in the game
GLASS_HI = (0.78, 0.50, 0.20)
LAMP = (1.0, 0.82, 0.48)
MARK = (0.90, 0.88, 0.80)
BLACK = (0.13, 0.125, 0.12)
CABLE = (0.30, 0.30, 0.29)
SUIT = (0.86, 0.42, 0.14)
HELMET = (0.86, 0.85, 0.80)

# rampart_v4 (and the v1 / v2 helpers it calls) -> Goliath, matched exactly on the constants they define
REMAP = {
    R.KHAKI: YELLOW, R.KHAKI_D: YELLOW_D, R.KHAKI2: CHAR, HD1.KHAKI2: CHAR, R.OLIVE: CHAR, R.OLIVE_D: CHAR_D,
    R.BROWN: ORANGE, R2.BROWN: ORANGE, R.FRAME: FRAME, HD1.DARK: (0.19, 0.185, 0.175), R.GLOW: LAMP, R.RED: BLACK,
}


def _map(v):
    if isinstance(v, tuple) and len(v) == 3 and v in REMAP:
        return REMAP[v]
    return v


def recolour():
    """Repaints rampart_v4 in place: module colour constants, palette dicts and colour defaults bound at def time (a lambda
    or call inside a builder reads the module constant at call time, so the constants cover those)."""
    for mod in (R, HD1, R2):
        for name, val in list(vars(mod).items()):
            if isinstance(val, tuple) and val in REMAP:
                setattr(mod, name, REMAP[val])
            elif inspect.isfunction(val) and val.__module__ == mod.__name__:
                if val.__defaults__:
                    val.__defaults__ = tuple(_map(x) for x in val.__defaults__)
                if val.__kwdefaults__:
                    val.__kwdefaults__ = {k: _map(x) for k, x in val.__kwdefaults__.items()}
    for pal, extra in ((R.PAL, {"bare": R.BARE, "dust": (0.70, 0.60, 0.45), "seals": (0.30, 0.29, 0.27)}), (HD1.PAL, {})):
        keep = {k: pal[k] for k in ("bare", "dust", "seals") if k in pal}
        pal.update(H.layer_palette(FRAME, R.BARE, YELLOW, LAMP, mounting=(0.80, 0.78, 0.71)))
        pal.update(keep)
        pal.update(extra)
    HD1.UNDER = V.shade(YELLOW, 0.55)


recolour()
PAL = R.PAL
WAIST = R.WAIST
SHOULDER = R.SHOULDER
cached = R.cached
P_ = R.P_


# =============================================================================================================== MASSES
# ---- the cab: side ∩ front ∩ top prisms. Side profile (y, z): the "<" prow (chin facet forward-down, windscreen back)
CAB_SIDE = [(1.02, 3.72), (0.90, 3.62), (-0.80, 3.62), (-1.18, 3.98), (-0.96, 4.62), (-0.74, 4.88), (0.70, 5.00), (0.92, 4.84)]
CAB_FRONT = [(0.60, 3.62), (0.84, 3.86), (0.91, 4.12), (0.75, 4.92), (0.58, 5.00), (0.0, 5.01)]     # +x half (x, z)
CAB_TOP = [(0.64, -1.22), (0.94, -0.84), (0.96, 0.70), (0.84, 1.02)]                               # +x half (x, y)
KNUCKLE = V3((0, -1.18, 3.98))
ROOF_N = V3((0, -0.12, 1.46)).normalized()                # the roof rises 0.12 m towards the back
ROOF_V = V3((0, 1.46, 0.12)).normalized()
SX = 0.854                                               # the cab's flank skin at the door (x at z 4.40)
BELT = 4.12                                              # the belt crease: the flank leans out below it, tumbles home above


def xs(z):
    """The flank skin's half width at height z (the front profile; the plan view only clips the corners)."""
    if z <= 3.86:
        return 0.60 + 0.24 * (z - 3.62) / 0.24
    if z <= BELT:
        return 0.84 + 0.07 * (z - 3.86) / 0.26
    return 0.91 - 0.16 * (z - BELT) / 0.80


def side_frame(s):
    """(up, n) of the upper flank (above the belt crease) on side s."""
    up = V3((-0.16 * s, 0, 0.80)).normalized()
    return up, V3((0.80 * s, 0, 0.16)).normalized()


def side_pt(s, y, z, out=0.0):
    up, n = side_frame(s)
    return V3((s * xs(z), y, z)) + n * out


REAR_N = V3((0, 1.12, 0.10)).normalized()                # the rear face leans in 5 deg
WS_T = V3((0, 0.22, 0.64)).normalized()                  # up the windscreen
WS_N = V3((0, -WS_T.z, WS_T.y))                          # its outward normal (forward and up)
CH_T = V3((0, -0.38, 0.36)).normalized()                 # up the chin facet (from the belly to the knuckle)
CH_N = V3((0, -CH_T.z, CH_T.y))                          # forward and down
if CH_N.y > 0:
    CH_N = -CH_N
# the glazing frame's back seam in side view (y, z): the prow moved 0.24 m back (it follows the form, skill f0)
SEAM = [(-0.46, 3.30), (-0.56, 3.62), (-0.94, 3.98), (-0.72, 4.62), (-0.50, 4.88), (-0.50, 5.40)]


def cab_cuts(d, col=GREY):
    out = [scoop((0, 0.42, 4.975), X_, Y_, Z_, 1.00, 0.90, 0.06, d, corner=0.06, slope=0.3, col=col),          # roof well
           scoop((0, 0.973, 4.25), X_, Z_, REAR_N, 0.80, 0.58, 0.05, d, corner=0.05, slope=0.3, col=col)]          # rear vent recess
    for s in (-1, 1):
        out.append(slab((s * 0.70, -0.74, 4.82), (s * 0.55, -0.45, 0.70), d, col=col))                      # roof front corners
        up, n = side_frame(s)
        out.append(scoop(side_pt(s, -0.46, 4.42, 0.001), Y_, up, n, 0.40, 0.56, 0.03, d, corner=0.05, slope=0.4,
                         col=col))                                                                          # door recess
        out.append(slab((s * 0.74, 0.95, 3.70), (s * 0.5, 0.6, -0.62), d, col=col))                         # lower rear corners
        out.append(slab((s * 0.58, -1.04, 3.72), (s * 0.6, -0.55, -0.58), d, col=col))                      # chin corners
    return out


@cached
def cab_mass(d=0.0, col=GREY, flag=0, cuts=True):
    m = H.intersect([H.prism(ccw(CAB_SIDE), "x", -1.3, 1.3, "primary", col, "cab_s", d, flag),
                     H.prism(sym(CAB_FRONT), "y", -1.6, 1.4, "primary", col, "cab_f", d, flag),
                     H.prism(sym(CAB_TOP), "z", 3.0, 5.6, "primary", col, "cab_t", d, flag)], "cab")
    if cuts:
        H.carve(m, cab_cuts(d, col), bevel=0.0)
        flagall(m, flag)
    return m


HOUSING = rrect(-0.24, 0.44, 3.94, 4.78, (0.10, 0.10, 0.16, 0.16), 1)      # side view (y, z), clipped corners


@cached
def housing_mass(s, d=0.0, col=GREY, flag=0):
    """The shoulder housing: a flat machinery block on the flank round the shoulder drum (the slew drive)."""
    m = H.intersect([H.prism(HOUSING, "x", *span(s * 0.68, s * 1.00), "trim", col, "housing", d, flag),
                     H.prism(mx([(0.68, 3.90), (1.00, 3.98), (1.00, 4.70), (0.68, 4.82)], s), "y", -0.4, 0.6, "trim", col,
                             "housing_f", d, flag)], "housing")
    return m


BUMPER_S = [(-0.82, 3.18), (-1.18, 3.18), (-1.28, 3.27), (-1.28, 3.44), (-1.21, 3.52), (-0.82, 3.52)]    # side view (y, z)


@cached
def bumper_mass(d=0.0, col=GREY, flag=0, cuts=True):
    m = H.intersect([H.prism(ccw(BUMPER_S), "x", -0.58, 0.58, "dark", col, "bumper", d, flag),
                     H.prism(sym([(0.46, 3.18), (0.58, 3.30), (0.58, 3.52)]), "y", -1.4, -0.7, "dark", col, "bumper_f", d,
                             flag)], "bumper")
    if cuts:
        H.carve(m, [scoop((0, -1.02, 3.52), X_, Y_, Z_, 0.82, 0.28, 0.20, d, corner=0.03, slope=0.2, col=col)], bevel=0.0)
        flagall(m, flag)
    return m


# the roll cage: two hoops over the roof joined by two top rails (a protective frame, ROPS)
CAGE_F = [(1.00, -0.84, 3.96), (1.00, -0.82, 4.20), (0.93, -0.78, 4.66), (0.70, -0.62, 5.24)]
CAGE_R = [(1.00, 0.84, 3.96), (1.00, 0.84, 4.20), (0.94, 0.84, 4.66), (0.72, 0.84, 5.24)]


def hoop(half):
    return [V3(p) for p in half] + [V3((-x, y, z)) for x, y, z in reversed(half)]


def cage(S, col=STEEL, r=0.045):
    for half in (CAGE_F, CAGE_R):
        V.tube_along(S, V.round_path(hoop(half), 0.14), r, "trim", col, n=8)
    for s in (-1, 1):
        V.tube_along(S, [V3((s * 0.70, -0.62, 5.24)), V3((s * 0.72, 0.84, 5.24))], r, "trim", col, n=8)
    return S


STACK = (0.90, 1.08)          # the exhaust stack's (x, y): the left rear corner, clear of the game's power pack


def stack(L_heat, L_service, col=CHAR):
    x, y = STACK
    V.tube_along(L_heat, V.round_path([V3((0.58, 0.98, 3.92)), V3((x, y, 3.98)), V3((x, y, 5.36))], 0.10), 0.08, "dark",
                 V.shade(col, 0.9), n=10)
    V.cyl(L_heat, (x, y, 4.88), 0.11, 0.56, axis="z", n=12, mat="trim", col=STEEL)              # heat sleeve
    for z in (4.68, 4.84, 5.00, 5.12):
        V.cyl(L_heat, (x, y, z), 0.114, 0.035, axis="z", n=12, mat="dark", col=CHAR_D)            # sleeve slots
    V.cyl(L_heat, (x, y, 5.38), 0.09, 0.05, axis="z", n=12, mat="trim", col=STEEL_L)
    f = V.cyl(L_heat, (x, y, 5.405), 0.065, 0.006, axis="z", n=10, mat="glow", col=(1.0, 0.45, 0.15))
    H.glow_flag(f, L_heat)
    cap = [V3((x - 0.10, y - 0.10, 5.42)), V3((x + 0.10, y - 0.10, 5.46)), V3((x + 0.10, y + 0.10, 5.49)), V3((x - 0.10, y + 0.10, 5.45))]
    V.prim(L_heat, [cap, [p + V3((0, 0, 0.015)) for p in cap]], "dark", CHAR_D, 0, None, jitter=0.0)   # the rain flap
    for z in (4.20, 5.30):          # clamps to the cab corner
        V.bar(L_service, V3((x, y, z)), V3((0.76, 1.0, z)), 0.022, "trim", STEEL_L, 6)


# ---- the guns: industrial rotary cannons (patched into rampart_v4's gatling)
def gatling(S, col=FRAME, mat="dark"):
    """Six thick 1.30 m barrels round a spindle, a heavy hub, three steel clamps, a muzzle brake on every barrel. Every island
    sits on the barrel axis within 0.22 m and ahead of y -0.46, so the exporter's default split takes it all as the spin
    cluster."""
    x, z = GX, GZ
    V.cyl(S, (x, -0.50, z), 0.22, 0.13, axis="y", n=12, mat=mat, col=V.shade(col, 0.9))           # hub
    V.cyl(S, (x, -0.585, z), 0.18, 0.05, axis="y", n=12, mat=mat, col=V.shade(col, 1.25))
    yc, ln = -1.20, 1.30
    for k in range(6):
        a = 2 * math.pi * k / 6
        bx, bz = x + math.cos(a) * 0.128, z + math.sin(a) * 0.128
        V.cyl(S, (bx, yc, bz), 0.056, ln, axis="y", n=8, mat=mat, col=col)
        V.cyl(S, (bx, -1.83, bz), 0.066, 0.10, axis="y", n=8, mat=mat, col=V.shade(col, 0.7))      # muzzle brake
    V.cyl(S, (x, yc, z), 0.06, ln + 0.02, axis="y", n=8, mat=mat, col=V.shade(col, 0.8))            # spindle
    for y, r, t in ((-0.70, 0.215, 0.10), (-1.22, 0.205, 0.08), (-1.70, 0.215, 0.14)):
        V.cyl(S, (x, y, z), r, t, axis="y", n=12, mat="trim", col=STEEL_L)
    return S


R.gatling = gatling


# ============================================================================================================ the mass layer
_R_MASS = R.mass_layer


def mirror_solid(S):
    S = S.copy("mirror")
    return H.xform(S, Matrix.Scale(-1, 4, X_))


def mass_layer():
    out = _R_MASS()
    tor = [H.fuse([cab_mass(), housing_mass(1), housing_mass(-1)], "cab_mass", fillet=0.02, segments=1), bumper_mass()]
    extra = P_("cab_extra")
    cage(extra, GREY)
    x, y = STACK
    V.cyl(extra, (x, y, 4.68), 0.10, 1.40, axis="z", n=10, mat="dark", col=GREY)
    V.cyl(extra, (0, 0.62, 5.075), 0.19, 0.46, axis="x", n=14, mat="dark", col=GREY)               # the cable spool
    for c, sz in (((-0.24, 0.10, 4.885), (0.36, 0.30, 0.26)), ((0.20, 0.10, 4.885), (0.30, 0.28, 0.20))):
        V.blk(extra, c, sz, "primary", GREY, ch=0.02)
    tor.append(extra)
    for s in (-1, 1):
        tor.append(H.prism(ellipse(SHOULDER[1], SHOULDER[2], 0.21, 0.21, 10), "x", *span(s * 0.9, s * 1.14), "dark", GREY, "shoulder"))
    out["Torso"] = tor
    out["Arm_L"] = [mirror_solid(S) for S in out["Arm_R"]]
    return out


R.mass_layer = mass_layer


# ======================================================================================================= layers 1-10
def pane(L, c, u, v, n, w, h, col=GLASS, layer="sensors"):
    """A glass pane set back in a window cut, with two lighter reflection streaks."""
    u, v, n = V3(u).normalized(), V3(v).normalized(), V3(n).normalized()
    V.surf_blk(L[layer], c - n * 0.07, u, v, n, w, h, 0.02, "glass", col)
    for k, (off, ww) in enumerate(((-0.18, 0.09), (0.02, 0.04))):
        a = math.radians(62)
        su = (u * math.cos(a) + v * math.sin(a)).normalized()
        sv = n.cross(su).normalized()
        V.surf_blk(L[layer], c - n * 0.05 + u * (off * w), sv, su, n, ww, min(w, h) * 0.85, 0.004, "glass", GLASS_HI)


def window_cut(c, u, v, n, w, h, depth=0.16, corner=0.05):
    u, v, n = frame3(u, v, n)
    return H.cut_rect(c, u, v, n, w, h, depth=depth, corner=corner, slope=0.2, mat="dark", col=(0.10, 0.095, 0.09))


def torso():
    part = new_part("Torso", WAIST, 50)
    L = Layers()
    cm = lambda d=0.0, col=YELLOW, flag=0: cab_mass(d, col, flag)  # noqa: E731
    cc = lambda d=0.0, col=CHAR, flag=0: cab_mass(d, col, flag)  # noqa: E731

    # ---- frame: the pilot tub (the cab shrunk 0.16) with a cavity behind the open left window, the waist and shoulder drums
    tub = mframe(cab_mass, -0.16, PAL["frame"], 0, False)
    waist = H.prism(ellipse(0.10, 0.10, 0.32, 0.32, 12), "z", 3.30, 3.70, "dark", V.shade(PAL["frame"], 1.15), "waist")
    drums = [H.prism(ellipse(SHOULDER[1], SHOULDER[2], 0.21, 0.21, 12), "x", *span(s * 0.80, s * 1.12), "dark",
                     V.shade(PAL["frame"], 1.15), "shoulder") for s in (-1, 1)]
    fr = H.fuse([tub, waist] + drums, "torso_frame", fillet=0.02, segments=1)
    H.carve(fr, [H.cut_rect(V3((xs(4.36) - 0.16, -0.50, 4.36)), Y_, Z_, X_, 0.60, 0.50, depth=0.62, corner=0.04, slope=0.05, mat="dark",
                            col=V.shade(PAL["frame"], 0.55))], bevel=0.01)
    L.add("frame", fr)
    # the seat (offset to the left door, as in an excavator cab) and the pilot in hi-vis with a white helmet, seen through
    # the open window (the cab's "pilot inside")
    px, py = 0.50, -0.52
    V.blk(L["frame"], (px, py + 0.18, 3.86), (0.40, 0.10, 0.62), "dark", CHAR_D, ch=0.03)             # seat back
    V.blk(L["frame"], (px, py + 0.02, 3.86), (0.38, 0.32, 0.10), "dark", CHAR_D, ch=0.02)             # seat pan
    V.blk(L["frame"], (px, py + 0.04, 3.96), (0.34, 0.20, 0.36), "primary", SUIT, ch=0.05)            # torso
    V.cyl(L["frame"], (px, py, 4.40), 0.105, 0.16, axis="z", n=10, mat="primary", col=HELMET)          # helmet
    V.cyl(L["frame"], (px, py, 4.49), 0.09, 0.03, axis="z", n=10, mat="primary", col=HELMET)
    V.surf_blk(L["frame"], V3((px, py - 0.10, 4.39)), X_, Z_, -Y_, 0.15, 0.07, 0.01, "glass", (0.15, 0.17, 0.18))
    V.bar(L["frame"], V3((px, py - 0.13, 4.02)), V3((px, py - 0.24, 4.10)), 0.02, "dark", BLACK, 6)    # control stick

    # ---- frame: the roll cage (mid grey so it reads against the yellow and the sand), feet bolted to the belt line
    cage(L["frame"], STEEL)
    for half in (CAGE_F, CAGE_R):
        for s in (-1, 1):
            p = V3((s * half[0][0], half[0][1], half[0][2]))
            V.blk(L["frame"], (p.x - s * 0.02, p.y, p.z - 0.07), (0.12, 0.16, 0.06), "trim", STEEL, ch=0.015)
    # bumper brackets (frame) from the cab belly down to the bumper
    for s in (-1, 1):
        V.blk(L["frame"], (s * 0.36, -0.88, 3.48), (0.06, 0.14, 0.18), "dark", V.shade(PAL["frame"], 1.2), ch=0.01)

    # ---- power: a cell pack under the cab floor, conduits to the shoulders along the belt gap
    V.blk(L["power"], (0.0, 0.66, 3.47), (0.62, 0.40, 0.16), "dark", PAL["power"], ch=0.03)
    for s in (-1, 1):
        V.tube_along(L["power"], V.round_path([V3((s * 0.24, 0.62, 3.56)), V3((s * 0.62, 0.56, 3.66)), V3((s * 0.84, 0.44, 3.88)),
                                               V3((s * 0.92, 0.30, 3.94))], 0.12), 0.045, "dark", PAL["power"], n=6)

    # ---- actuation: shoulder housings (flat machinery), slew rings, waist rams, pipes in the belt gap, the winch
    for s in (-1, 1):
        hm = recol(housing_mass(s), STEEL, "trim")
        H.carve(hm, [H.cut_rect(V3((s * 1.00, 0.10, 4.36)), Y_, Z_, s * X_, 0.50, 0.62, depth=0.03, corner=0.08, slope=0.5,
                                mat="trim", col=V.shade(STEEL, 0.8))], bevel=0.01)
        L.add("actuation", hm)
        V.bar(L["actuation"], V3((s * 0.97, SHOULDER[1], SHOULDER[2])), V3((s * 1.03, SHOULDER[1], SHOULDER[2])), 0.27, "trim",
              STEEL_L, 16)
        for k in range(8):
            a = 2 * math.pi * k / 8
            V.bolt(L["service"], V3((s * 1.03, SHOULDER[1] + math.cos(a) * 0.23, SHOULDER[2] + math.sin(a) * 0.23)), s * X_, r=0.016,
                   h=0.02, col=R.BARE)
        H.ram(L["actuation"], V3((s * 0.30, -0.10, 3.42)), V3((s * 0.42, 0.20, 3.64)), 0.03, sleeve_col=PAL["actuation"], rod_col=R.BARE)
        H.pipe_bundle(L["actuation"], [V3((s * 0.30, -0.30, 3.58)), V3((s * 0.64, -0.36, 3.70)), V3((s * 0.86, -0.20, 3.89)),
                                       V3((s * 0.90, 0.0, 3.92))], Z_, 3, 0.024, cols=R.PIPE_COLS)
    # the winch: drum in the bumper's well, cable wound on it, a hydraulic motor at one end with hoses up to the cab
    V.cyl(L["actuation"], (0.0, -1.02, 3.45), 0.115, 0.74, axis="x", n=12, mat="trim", col=STEEL)
    V.cyl(L["actuation"], (0.0, -1.02, 3.45), 0.135, 0.56, axis="x", n=12, mat="dark", col=CABLE)
    for x in (-0.31, 0.31):
        V.cyl(L["actuation"], (x, -1.02, 3.45), 0.16, 0.035, axis="x", n=12, mat="trim", col=ORANGE)
    V.cyl(L["actuation"], (-0.48, -1.02, 3.45), 0.09, 0.16, axis="x", n=10, mat="trim", col=STEEL_L)       # motor
    for dz in (-0.04, 0.04):
        V.pipe_run(L["actuation"], [V3((-0.48, -0.98, 3.50 + dz)), V3((-0.46, -0.90, 3.60 + dz)), V3((-0.40, -0.82, 3.66 + dz))],
                   0.018, "trim", V.shade(PAL["actuation"], 0.8), bend=0.06)

    # ---- mounting: deep flange hoops in the belt-line gap and behind the glazing frame's seam
    # (each hoop is taken on the mass trimmed to where its gap is, so it never shows through the glazing)
    rib_src = lambda y0, y1, z0, z1: H.intersect([cab_mass(-0.07, PAL["mounting"], 0, False),  # noqa: E731
                                                 H.prism(rect(y0, y1, z0, z1), "x", -2.0, 2.0, "sand", PAL["mounting"], "trim")],
                                                "rib_src")
    flanges(L, rib_src(-0.66, 1.4, 3.0, 6.0), [(V3((0, 0, 4.00)), Z_)], 20, 0.12, 0.05, stringers=())
    flanges(L, rib_src(-1.4, 1.4, 4.06, 6.0), [(V3((0, -0.81, 4.30)), V3((0, 0.946, -0.325)))], 18, 0.12, 0.05, stringers=())

    # ---- plates
    up = shell(cm, -0.08, 0.035)
    sh = shell(cm, -0.06, 0.0)
    thin = shell(cm, -0.07, -0.03)
    csh = shell(cc, -0.06, 0.0, CHAR)
    cthin = shell(cc, -0.07, -0.03, CHAR)
    # the signature form: ONE glazing frame plate round the windscreen and the chin glass (header, A-pillars, knuckle
    # mullion, sill); the windows are cut out of it and nothing else crosses it
    ws_c = KNUCKLE + WS_T * 0.35
    ch_c = KNUCKLE - CH_T * 0.25
    ws_cut = window_cut(ws_c, X_, WS_T, WS_N, 1.08, 0.50, corner=0.08)
    ch_cut = window_cut(ch_c, X_, CH_T, CH_N, 0.96, 0.32, corner=0.07)
    fr_out = ccw([(-0.56, 3.64)] + SEAM[2:] + [(-1.8, 5.40), (-1.8, 3.64)])     # stops short of the flat belly
    L.add("plates", panel(up, region(fr_out, "x", -1.3, 1.3), 0.045, "glazing_frame", cuts=[ws_cut, ch_cut]))
    pane(L, ws_c, X_, WS_T, WS_N, 1.10, 0.52)
    pane(L, ch_c, X_, CH_T, CH_N, 0.98, 0.34)
    E = H.offset_polyline(SEAM, -0.045)          # the far side of the frame's seam (rearward)
    ez = lambda z: next((a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1])  # noqa: E731
                         for a, b in zip(E, E[1:]) if min(a[1], b[1]) <= z <= max(a[1], b[1])), E[-1][0])
    # roof: two thin panels split on the centreline, an inset hatch and the big hull number on the left one
    for s in (-1, 1):
        cuts = []
        if s < 0:
            cuts = [R.inset(V3((-0.30, -0.22, 4.893)), Y_, X_, Z_, 0.28, 0.34, YELLOW_D, depth=0.025)]
        L.add("plates", panel(thin, region(mx(rect(0.02, 1.2, ez(4.90) + 0.06, 1.3), s), "z", 4.80, 5.6), 0.035, "roof", cuts=cuts))
    # flanks: the door (window cut; left one open), the rear quarter (louvre grille), a charcoal lower skirt below the belt gap
    for s in (-1, 1):
        door = [(ez(4.04), 4.04), (-0.30, 4.04), (-0.30, 4.76), (ez(4.76), 4.76), (ez(4.66), 4.66)]
        up, n = side_frame(s)
        dc = side_pt(s, -0.48, 4.42, -0.029)
        L.add("plates", panel(sh, region(ccw(door), "x", *span(s * 0.45, s * 1.2)), 0.04, "door",
                              cuts=[window_cut(dc, Y_, up, n, 0.34, 0.34, depth=0.14, corner=0.05)]))
        if s < 0:
            pane(L, dc, Y_, up, n, 0.36, 0.36)
        else:
            V.surf_blk(L["sensors"], dc + V3((0, 0.10, 0)) - n * 0.06, Y_, up, n, 0.16, 0.36, 0.02, "glass", GLASS)  # slid back
        qc = side_pt(s, 0.68, 4.62, 0.001)
        L.add("plates", panel(sh, region(rect(0.48, 1.3, 4.04, 4.76), "x", *span(s * 0.50, s * 1.2)), 0.04, "rear_quarter",
                              cuts=[H.cut_rect(qc, Y_, up, n, 0.28, 0.16, depth=0.10, corner=0.03, slope=0.2, mat="dark",
                                               col=(0.10, 0.095, 0.09)),
                                    R.inset(side_pt(s, 0.66, 4.33), Y_, up, n, 0.34, 0.26, YELLOW_D, depth=0.02)]))
        V.louvres(L["heat"], qc - n * 0.06, Y_, up, n, 0.26, 0.14, 3, "dark", V.shade(PAL["heat"], 0.8), tilt=0.5, t=0.02)
        skirt = [(ez(3.96), 3.96), (ez(3.62) + 0.02, 3.58), (-0.40, 3.40), (0.94, 3.40), (0.94, 3.96)]
        L.add("plates", panel(csh, region(ccw(skirt), "x", *span(s * 0.56, s * 1.2), CHAR), 0.035, "skirt"))
    # rear bulkhead (thin: the game hangs its drums and power pack here), a belly strip behind the waist
    L.add("plates", panel(cthin, region(rect(-0.44, 0.44, 3.70, 4.74), "y", 0.88, 1.6, CHAR), 0.03, "bulkhead"))
    # the winch bumper: charcoal machinery with a front plate (hazard band on it)
    L.add("plates", recol(bumper_mass(), CHAR, "dark"))
    bsh = shell(lambda d=0.0, col=CHAR, flag=0: bumper_mass(d, col, flag), -0.04, 0.012, CHAR)
    L.add("plates", panel(bsh, region(rect(-0.7, 0.7, 3.0, 3.7), "y", -1.6, -1.23, CHAR), 0.02, "bumper_face", skip_axis=True))
    # add-on tool bins on the skirts' rear ends (stowage, tagged addon)
    for s in (-1, 1):
        f = V.blk(L["plates"], (s * 0.84, 0.66, 3.50), (0.10, 0.40, 0.28), "primary", CHAR_D, ch=0.02)
        H.tag_faces(L["plates"], f or [], H.TAG_ADDON)
        V.bar(L["service"], V3((s * 0.90, 0.52, 3.72)), V3((s * 0.90, 0.80, 3.72)), 0.012, "trim", STEEL_L, 6)   # bin handle

    # ---- seals: the waist boot
    H.bellows(L["seals"], V3((0, 0.1, 3.32)), V3((0, 0.1, 3.60)), 0.36, 0.34, folds=3, depth=0.025, n=14, col=PAL["seals"])

    # ---- heat: the exhaust stack (the one strong heat feature)
    stack(L["heat"], L["service"])

    # ---- service (the scale cues): the roof rack, lifting eyes, rungs, rails, door hardware, tie-downs, hazard, stencils
    rack(L)
    for s in (-1, 1):
        H.lifting_eye(L["service"], V3((s * 0.92, 0.10, 4.73)), Z_, r=0.075, t=0.022)       # the convoy crane's pick points
        # door: hinges on the front edge, a handle, a grab rail on the rear edge, rungs and a step below on the skirt
        up, n = side_frame(s)
        for z in (4.20, 4.62):
            hp = side_pt(s, ez(z) + 0.05, z, 0.012)
            V.bar(L["service"], hp - up * 0.05, hp + up * 0.05, 0.025, "trim", STEEL_L, 6)
        V.bar(L["service"], side_pt(s, -0.36, 4.26, -0.02), side_pt(s, -0.33, 4.26, 0.02), 0.016, "trim", STEEL_L, 6)
        V.pipe_run(L["service"], [side_pt(s, -0.33, 4.16, -0.03), side_pt(s, -0.33, 4.18, 0.06), side_pt(s, -0.33, 4.66, 0.06),
                                  side_pt(s, -0.33, 4.68, -0.03)], 0.018, "trim", STEEL_L, bend=0.04)
        H.rungs(L["service"], V3((s * 0.67, -0.38, 3.69)), V3((s * 0.82, -0.38, 3.84)), 2, V3((s * 0.707, 0, -0.707)).normalized(),
                width=0.30, depth=0.08, r=0.016)
        V.tube_along(L["service"], V.round_path([V3((s * 0.70, -0.82, 3.70)), V3((s * 0.72, -0.82, 3.44)),
                                                 V3((s * 0.72, -0.58, 3.44)), V3((s * 0.70, -0.58, 3.70))], 0.04), 0.018,
                     "trim", STEEL_L, n=6)                                                    # the boarding step under the skirt
        for y in (-0.10, 0.26, 0.66):           # D-ring tie-downs along the skirt's top
            p = V3((s * (xs(3.92) + 0.015), y, 3.92))
            H.ring_tube(L["service"], [p + V3((s * 0.035 * (1 + math.cos(a)), 0, 0.035 * math.sin(a))) for a in
                                       [math.radians(t) for t in range(0, 360, 45)]], 0.010, "trim", STEEL_L)
        # a stencil on each door, a load mark on the rear quarter
        K.stencil(L["service"], "07", side_pt(s, 0.66, 4.33, -0.02), s * Y_, up, n, 0.17, "secondary", BLACK, off=0.008)
    K.hazard(L["service"], V3((0, -1.295, 3.36)), X_, Z_, -Y_, 1.0, 0.15, 9, YELLOW, BLACK)
    K.stencil(L["service"], "07", V3((0.32, -0.22, 4.896)), X_, ROOF_V, ROOF_N, 0.24, "secondary", BLACK, off=0.008)      # top-down read
    # the hook on its cable from the fairlead
    V.blk(L["service"], (0.0, -1.30, 3.32), (0.26, 0.06, 0.12), "trim", STEEL_L, ch=0.01)           # fairlead
    V.tube_along(L["service"], [V3((0, -1.16, 3.40)), V3((0, -1.32, 3.38)), V3((0, -1.35, 3.30)), V3((0, -1.35, 3.02))], 0.014,
                 "dark", CABLE, n=6)
    V.blk(L["service"], (0.0, -1.35, 2.94), (0.07, 0.07, 0.10), "secondary", ORANGE, ch=0.01)
    hk = [V3((0, -1.35 + 0.07 * math.sin(math.radians(a)), 2.86 - 0.07 * math.cos(math.radians(a)))) for a in range(-90, 200, 30)]
    V.tube_along(L["service"], hk, 0.022, "secondary", ORANGE, n=6)

    # ---- sensors: lamp bar on the cage, A-pillar lamps, the beacon
    V.blk(L["sensors"], (0.0, -0.62, 5.27), (0.96, 0.10, 0.12), "dark", CHAR_D, ch=0.02, mid=True)
    for x in (-0.36, -0.12, 0.12, 0.36):
        V.hex_lamp(L["sensors"], V3((x, -0.67, 5.27)), V3((0, -0.85, -0.5)), r=0.055, depth=0.035, col=LAMP, rim=CHAR_D)
    for s in (-1, 1):
        V.hex_lamp(L["sensors"], V3((s * 0.66, -0.99, 4.56)), V3((s * 0.25, -0.95, 0.15)), r=0.06, depth=0.04, col=LAMP, rim=CHAR_D)
    V.cyl(L["sensors"], (-0.36, 0.84, 5.31), 0.07, 0.06, axis="z", n=10, mat="dark", col=CHAR_D)
    f = V.cyl(L["sensors"], (-0.36, 0.84, 5.39), 0.06, 0.10, axis="z", n=10, mat="glow", col=(1.0, 0.60, 0.15), r2=0.035)
    H.glow_flag(f, L["sensors"])
    L.flush(part)
    return part


def rack(L):
    """The roof rack in the roof well: a low rail frame with tie-down rings, a cable spool and crates strapped down (add-ons),
    a hazard band on its front rail."""
    z0, z1 = 4.885, 5.06
    pts = [V3((-0.50, -0.04, z1)), V3((0.50, -0.04, z1)), V3((0.50, 0.86, z1)), V3((-0.50, 0.86, z1))]
    for a, b in zip(pts, pts[1:] + pts[:1]):
        V.bar(L["service"], a, b, 0.024, "trim", STEEL_L, 6)
    for p in pts + [V3((0.0, -0.04, z1)), V3((0.0, 0.86, z1))]:
        V.bar(L["service"], V3((p.x, p.y, z0)), p, 0.02, "trim", STEEL_L, 6)
    for p in pts:
        H.ring_tube(L["service"], [p + V3((0.045 * math.cos(math.radians(t)), 0, 0.045 * math.sin(math.radians(t)) + 0.05))
                                   for t in range(0, 360, 45)], 0.010, "trim", STEEL_L)
    K.hazard(L["service"], V3((0.0, -0.068, z1 - 0.04)), X_, Z_, -Y_, 0.90, 0.06, 8, YELLOW, BLACK)
    # the cable spool (orange flanges read from the top) and two crates, a pair of jerrycans; straps over them
    M = L["mods"]
    sp = []
    sz_ = z0 + 0.19
    sp += V.cyl(M, (0.0, 0.62, sz_), 0.16, 0.42, axis="x", n=14, mat="dark", col=CABLE) or []
    for x in (-0.22, 0.22):
        sp += V.cyl(M, (x, 0.62, sz_), 0.19, 0.04, axis="x", n=14, mat="secondary", col=ORANGE) or []
    sp += V.cyl(M, (0.0, 0.62, sz_), 0.045, 0.52, axis="x", n=8, mat="trim", col=STEEL_L) or []
    H.tag_faces(M, sp, H.TAG_ADDON)
    for c, sz, col in (((-0.24, 0.10, z0), (0.36, 0.30, 0.26), CHAR), ((0.20, 0.10, z0), (0.30, 0.28, 0.20), (0.36, 0.40, 0.30))):
        f = V.blk(M, c, sz, "cargo", col, ch=0.02)
        H.tag_faces(M, f or [], H.TAG_ADDON)
        V.blk(M, (c[0], c[1], c[2] + sz[2] - 0.004), (sz[0] + 0.01, 0.05, 0.012), "dark", BLACK, ch=0.0)     # strap
    for y in (0.26, 0.40):
        f = V.blk(M, (0.40, y, z0), (0.10, 0.12, 0.24), "cargo", ORANGE, ch=0.015)
        H.tag_faces(M, f or [], H.TAG_ADDON)


# --------------------------------------------------------------------------------------------------------------- arms
_R_ARM_R = R.arm_r
ARM_CACHE = {}


def arm_r():
    """The rotary cannon arm: rampart_v4's arm repainted with the heavier barrels, plus a work lamp on the receiver's outer
    front corner (it lights where the gun points), hazard on the yoke and a cable guard."""
    if "R" in ARM_CACHE:
        return ARM_CACHE.pop("R")
    part = with_paint(_R_ARM_R, CHAR, CHAR_D, YELLOW)
    L = Layers()
    s = -1
    V.blk(L["sensors"], (GX - 0.36, -0.30, 4.26), (0.16, 0.12, 0.14), "dark", CHAR_D, ch=0.02, mid=True)
    V.hex_lamp(L["sensors"], V3((GX - 0.36, -0.36, 4.26)), -Y_, r=0.055, depth=0.03, col=LAMP, rim=CHAR_D)
    V.bar(L["service"], V3((GX - 0.36, -0.26, 4.19)), V3((GX - 0.32, -0.20, 4.10)), 0.02, "trim", STEEL_L, 6)
    K.hazard(L["service"], V3((-1.45, -0.183, 4.42)), X_, Z_, -Y_, 0.40, 0.10, 4, YELLOW, BLACK)
    L.flush(part)
    return part


def with_paint(fn, primary, inset_col, drum_col):
    """Runs a rampart_v4 builder with another paint: its plates (KHAKI and the defaults of shell / region / inset) in `primary`,
    its insets in `inset_col` and its ammo drums (KHAKI2) in `drum_col`. The guns are charcoal machinery with yellow drums, so
    they separate from the yellow cab at 40 m."""
    keep = (R.KHAKI, R.KHAKI_D, R.KHAKI2, R.shell.__defaults__, HD1.region.__defaults__, R.inset.__defaults__)
    sub = {YELLOW: primary, YELLOW_D: inset_col}
    R.KHAKI, R.KHAKI_D, R.KHAKI2 = primary, inset_col, drum_col
    for f in (R.shell, HD1.region, R.inset):
        f.__defaults__ = tuple(sub.get(x, x) if isinstance(x, tuple) else x for x in f.__defaults__)
    try:
        return fn()
    finally:
        R.KHAKI, R.KHAKI_D, R.KHAKI2, R.shell.__defaults__, HD1.region.__defaults__, R.inset.__defaults__ = keep


def mirror_part(src, name):
    """A copy of a built part mirrored across x = 0 (pieces in part-local coordinates: co.x and the origin's x flip)."""
    o = V3(src.origin)
    dst = H.Part(name, V3((-o.x, o.y, o.z)), src.seed + 1)
    for k, P in src.layers.items():
        if P.empty():
            continue
        Q = dst[k]
        Q.bm.free()
        Q.bm = P.bm.copy()
        Q.col = Q.bm.loops.layers.color.get("Color")
        Q.sec = Q.bm.faces.layers.int.get("sec")
        Q.flag = Q.bm.faces.layers.int.get("flag")
        for v in Q.bm.verts:
            v.co.x = -v.co.x
        bmesh.ops.reverse_faces(Q.bm, faces=Q.bm.faces[:])
        Q.bm.normal_update()
    return dst


def arm_l():
    part = arm_r()
    ARM_CACHE["R"] = part
    return mirror_part(part, "Arm_L")


R.torso = torso
R.arm_r = arm_r
R.arm_l = arm_l
build_full = R.build_full
build_mass = R.build_mass


# --------------------------------------------------------------------------------------------------------------- export
def export_gun_points():
    """The right gun's empties only (rampart_v4's default also writes the rocket box's muzzles, which this variant lacks)."""
    return {"PodSpin_R": V3((GX, -0.50, GZ)), "PodSpinFwd_R": V3((GX, -1.00, GZ)), "PodMuzzle0_R": V3((GX, -1.90, GZ)),
            "PodEject_R": V3((GX - 0.37, -0.20, 4.00))}


def export_split_guns(parts, split_off):
    """The default split for the right gun (the spin cluster), and the mirrored left arm dropped: the game mirrors Part_Pod_R
    onto the left shoulder and ignores the left arm."""
    arm_l_obj = parts.pop("Arm_L", None)
    if arm_l_obj is not None:
        bpy.data.objects.remove(arm_l_obj, do_unlink=True)
    out = {}

    def rad(p):
        return ((p.x - GX) ** 2 + (p.z - GZ) ** 2) ** 0.5

    def gat(c, pts):
        return c.y < -0.46 and rad(c) < 0.15 and max(rad(p) for p in pts) < 0.25
    o, n = split_off(parts["Arm_R"], gat, "Part_PodSpin_R")
    print("HDX split %d spin-cluster islands -> %s" % (n, o.name if o else None))
    if o is not None:
        out["PodSpin_R"] = o
    return out


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--mass", action="store_true")
    ap.add_argument("--pose", default="rest", choices=("rest", "stance"))
    ap.add_argument("--out", default=os.path.join(os.environ.get("TEMP", "."), "rampart_salvager_out"))
    a = ap.parse_args(argv)
    POSE["mode"] = a.pose
    os.makedirs(a.out, exist_ok=True)
    V.clear_scene()
    root, objs, info = build_mass() if a.mass else build_full()
    name = "rampart-salvager" + ("_mass" if a.mass else "") + ("_stance" if a.pose == "stance" else "")
    with open(os.path.join(a.out, name + ".json"), "w") as f:
        json.dump(info, f, indent=1)
    print("TRIS", info["tris_total"], json.dumps(info.get("tris_by_part", info["tris"])))
    if "axis_aligned_plates" in info:
        print("AXIS", json.dumps({k: v["share"] for k, v in info["axis_aligned_plates"].items()}))
    print("HSSTATS", json.dumps(H.report()["stats"]))


if __name__ == "__main__":
    main()
