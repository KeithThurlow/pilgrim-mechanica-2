"""Rampart Railgun (variant id `rampart-railgun`): the Rampart v4 with railguns on single-joint arms from the hull sides in
place of the miniguns, restyled toward Novus-Lux ("The Digital Aristocrat"). Built on rampart_v4: the legs, pelvis and hull
masses are v4's; this module patches its palette, torso, arms and mass layer, and gives export_game.py its gun hooks.

    node tools/blender/run.mjs tools/blender/mechs/studies/rampart/export_game.py -- \
        --model tools/blender/mechs/variants/rampart-railgun/rampart-railgun.py --out <scratch>/rampart-railgun.fbx
    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-railgun/shots_rg.py -- --out <ABS DIR> --only game40,...

Notes in docs/mechs/rampart-railgun/ (breakdown, critique, skill-notes). Units m, Z up, front -Y, the mech's left +X.

How the palette is swapped: v4 binds its paint tuples as default arguments at import, so reassigning R.KHAKI alone would
miss them. _repaint() reassigns the module constants AND rewrites every function default in rampart_v4 and rampart (v1)
that equals an old paint value (see skill-notes: a palette parameter in rampart_v4 would make this unnecessary).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
for p in (os.path.join(MECHS, "studies", "rampart"), MECHS, os.path.join(MECHS, "studies", "military")):
    if p not in sys.path:
        sys.path.insert(0, p)

import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import rampart_v4 as R  # noqa: E402
import rampart as HD1  # noqa: E402

# ------------------------------------------------------------------------------------------------ Novus-Lux palette
WHITE = (0.79, 0.81, 0.86)        # seamless white paneling (a touch cool, held under 0.86 so the desert sun keeps the bands)
PERI = (0.50, 0.56, 0.79)         # periwinkle insets
PERI_L = (0.66, 0.70, 0.83)       # the lower-leg guards: a pale periwinkle-grey
SLATE = (0.35, 0.41, 0.57)        # hood, shroud, drums
SLATE_D = (0.27, 0.31, 0.45)
NAVY = (0.20, 0.22, 0.31)         # the navy undersuit (frame); kept off near-black so gaps don't read as holes
NAVY_PAD = (0.24, 0.27, 0.38)
BARE = (0.70, 0.72, 0.77)
MARK = (0.30, 0.35, 0.52)         # slate stencils on white
TEAL = (0.35, 1.0, 0.92)          # the family glow
RUBBER = (0.18, 0.19, 0.23)
GUNMETAL = (0.42, 0.44, 0.50)
CERAMIC = (0.88, 0.89, 0.92)      # rail insulators
HOT = (1.0, 0.50, 0.16)           # heat vents: this gets hot
RED = (0.74, 0.16, 0.14)

SWAP = {"KHAKI": WHITE, "KHAKI_D": PERI, "KHAKI2": PERI_L, "OLIVE": SLATE, "OLIVE_D": SLATE_D, "BROWN": NAVY_PAD,
        "FRAME": NAVY, "BARE": BARE, "MARK": MARK, "GLOW": TEAL, "RUBBER": RUBBER, "BARREL": GUNMETAL}


def _repaint():
    old = {}
    for mod in (R, HD1):
        for n, new in SWAP.items():
            if hasattr(mod, n):
                old[tuple(getattr(mod, n))] = new
                setattr(mod, n, new)

    def fix(fn):
        f = getattr(fn, "__func__", fn)
        if getattr(f, "__defaults__", None):
            f.__defaults__ = tuple(old.get(d, d) if isinstance(d, tuple) else d for d in f.__defaults__)
    for mod in (R, HD1):
        for v in list(vars(mod).values()):
            if callable(v) and getattr(v, "__module__", None) == mod.__name__:
                fix(v)
    pal = R.H.layer_palette(NAVY, BARE, WHITE, TEAL, mounting=(0.80, 0.79, 0.90))
    pal.update({"bare": BARE, "dust": (0.74, 0.66, 0.52), "seals": (0.30, 0.31, 0.38)})
    R.PAL.clear()
    R.PAL.update(pal)
    R.PIPE_COLS = ((0.62, 0.64, 0.70), (0.36, 0.40, 0.52), (0.30, 0.70, 0.70))
    # brand: no visible fasteners (bolt rows and rivets go; single axle caps stay), never weathering
    R.V.bolt_row = lambda *a, **k: []
    bake = R.K.bake_all

    def bake_clean(pieces, pal, seed=0, **kw):
        kw["wear"] = 0.0
        kw["dust"] = min(kw.get("dust", 0.25), 0.08)
        return bake(pieces, pal, seed, **kw)
    R.K.bake_all = bake_clean


_repaint()

from rampart_v4 import *  # noqa: E402,F401,F403  (after the repaint, so the constants come in repainted)
from rampart_v4 import H, K, V, V3, X_, Y_, Z_, GX, GZ, span, rect, mx, ccw, hull2d, region, groove, inset, shell, panel  # noqa
from rampart_v4 import mframe, flanges, pockets, new_part, Layers, frame3, scoop, slab, cached, P_, recol  # noqa: E402,F811

HAS_WEAPON_LAYER = True
R.STANCE_FIXED["Arm_L"] = (-7, 0, -5)          # both guns raised a little, unevenly (the rocket box no longer sets it)
R.STANCE_FIXED["Arm_R"] = (-3, 0, 5)

# =============================================================================================================== the gun
# Right gun (s = -1, outward is -X). GX, GZ: the bore axis (as v4's minigun). Receiver y +0.90 -> -0.40, coil ring -0.46 ->
# -0.58, shroud -0.64 -> -1.86, bare rails to the muzzle brace at -2.47.
RCV_ST = [(-0.40, (0.24, 3.82, 4.20, 0.10, 0.09)), (-0.28, (0.31, 3.77, 4.28, 0.12, 0.11)), (0.52, (0.31, 3.76, 4.30, 0.12, 0.11)),
          (0.80, (0.27, 3.82, 4.26, 0.12, 0.11)), (0.90, (0.20, 3.88, 4.20, 0.09, 0.08))]
FIN_Y = (0.36, 0.74)               # the fin stack recess on the receiver's top-rear
SHR_ST = [(-0.64, 0.235, 0.215), (-0.80, 0.245, 0.225), (-1.55, 0.205, 0.185), (-1.86, 0.165, 0.150)]
RAIL_Y = (-0.44, -2.40)
RAIL_DZ, RAIL_W, RAIL_H = 0.078, 0.10, 0.07
RING_Y = (-0.46, -0.58)
BRACE_Y = -2.40
SPIN_PIVOT = V3((GX, -0.52, GZ))
SPIN_FWD = V3((GX, -1.02, GZ))
MUZZLE_R = V3((GX, -2.52, GZ))
EJECT_R = V3((GX - 0.34, -0.20, 4.06))


@cached
def rg_recv_mass(d=0.0, col=R.GREY, flag=0):
    m = H.loft([(y, R.rcv_sect(*a)) for y, a in RCV_ST], "y", d, "primary", col, "rg_receiver", flag)
    H.carve(m, [scoop((GX, sum(FIN_Y) / 2, 4.31), Y_, X_, Z_, FIN_Y[1] - FIN_Y[0], 0.34, 0.09, d, corner=0.03, slope=0.2, col=col),
                slab((GX, -0.30, 4.27), (0, -0.55, 0.83), d, col=col),                     # top-front wedge
                slab((GX, 0.66, 3.82), (0, 0.6, -0.8), d, col=col),                        # rear belly chamfer
                slab((GX - 0.30, -0.36, 4.0), (-0.6, -0.8, 0.0), d, col=col),              # outer front corner facet
                slab((GX + 0.30, -0.36, 4.0), (0.6, -0.8, 0.0), d, col=col)], bevel=0.0)   # inner front corner facet
    R.flagall(m, flag)
    return m


def shr_sect(hw, hh):
    """The shroud's section: a flat top, a shoulder crease each side, sides raking in to a narrower belly."""
    return ccw(hull2d([(GX - hw * 0.55, GZ + hh), (GX + hw * 0.55, GZ + hh), (GX + hw, GZ + hh * 0.22), (GX + hw * 0.72, GZ - hh),
                       (GX - hw * 0.72, GZ - hh), (GX - hw, GZ + hh * 0.22)]))


@cached
def shroud_mass(d=0.0, col=R.GREY, flag=0):
    m = H.loft([(y, shr_sect(hw, hh)) for y, hw, hh in SHR_ST], "y", d, "primary", col, "shroud", flag)
    H.carve(m, [slab((GX, -1.84, GZ + 0.13), (0, -0.62, 0.78), d, col=col),               # the nose facet on top
                slab((GX, -1.84, GZ - 0.12), (0, -0.7, -0.7), d, col=col)], bevel=0.0)   # and under
    R.flagall(m, flag)
    return m


def boom_oct(yc, zc, hy, hz, c):
    return ccw([(yc - hy + c, zc - hz), (yc + hy - c, zc - hz), (yc + hy, zc - hz + c), (yc + hy, zc + hz - c), (yc + hy - c, zc + hz),
                (yc - hy + c, zc + hz), (yc - hy, zc + hz - c), (yc - hy, zc - hz + c)])


@cached
def boom_mass(d=0.0, col=R.GREY, flag=0):
    """The single-joint arm: an octagonal boom from the shoulder drum out to the receiver's inner face, raked forward and down."""
    m = H.loft([(-1.74, boom_oct(0.02, 4.16, 0.25, 0.22, 0.09)), (-1.42, boom_oct(0.05, 4.25, 0.19, 0.19, 0.07)),
                (-1.10, boom_oct(0.10, 4.34, 0.22, 0.21, 0.08))], "x", d, "primary", col, "boom", flag)
    H.carve(m, [slab((-1.40, -0.12, 4.42), (0, -0.62, 0.78), d, col=col),
                slab((-1.40, 0.28, 4.10), (0, 0.6, -0.8), d, col=col)], bevel=0.0)
    R.flagall(m, flag)
    return m


def gun_mass_solids():
    """The gun's masses for the step-2 gate (right side)."""
    S = P_("rails")
    rails(S, R.GREY)
    brace(S, R.GREY)
    ring = P_("ring")
    coil(ring, R.GREY)
    return [rg_recv_mass(), shroud_mass(), boom_mass(),
            H.prism(R.ellipse(0.10, 4.34, 0.27, 0.27, 14), "x", -1.20, -1.08, "dark", R.GREY, "hub"), S, ring]


def rails(S, col=GUNMETAL):
    """Two flat rails, top and bottom of the bore, from the receiver through the ring and shroud to the brace."""
    y0, y1 = RAIL_Y
    for e in (1, -1):
        V.blk(S, (GX, (y0 + y1) / 2, GZ + e * RAIL_DZ), (RAIL_W, y0 - y1, RAIL_H), "trim", col, ch=0.012, mid=True)
    # a copper-faced bore liner strip on each rail's bore face (only the bare section past the shroud shows it)
    for e in (1, -1):
        V.blk(S, (GX, -2.12, GZ + e * (RAIL_DZ - RAIL_H / 2 - 0.006)), (RAIL_W * 0.6, 0.58, 0.012), "trim", (0.70, 0.44, 0.28),
              ch=0.0, mid=True)


def brace(S, col=NAVY):
    """The muzzle brace: a chamfered frame round the rail tips, two stays back to the shroud nose."""
    y = BRACE_Y - 0.03
    V.blk(S, (GX, y, GZ + 0.165), (0.38, 0.13, 0.08), "dark", col, ch=0.025, mid=True)
    V.blk(S, (GX, y, GZ - 0.165), (0.32, 0.13, 0.08), "dark", col, ch=0.025, mid=True)
    for e in (1, -1):
        V.blk(S, (GX + e * 0.15, y, GZ), (0.08, 0.13, 0.36), "dark", col, ch=0.02, mid=True)


def coil(S, col=GUNMETAL):
    """The rail-slide coil ring between the receiver and the shroud (the game's spin piece)."""
    yc = sum(RING_Y) / 2
    ln = RING_Y[0] - RING_Y[1]
    V.cyl(S, (GX, yc, GZ), 0.235, ln, axis="y", n=12, mat="trim", col=col)
    for dy in (-ln / 2 + 0.015, ln / 2 - 0.015):
        V.cyl(S, (GX, yc + dy, GZ), 0.26, 0.03, axis="y", n=12, mat="trim", col=V.shade(col, 1.25))
    for k in range(8):                       # winding blocks round the ring
        a = 2 * math.pi * (k + 0.5) / 8
        V.blk(S, (GX + math.cos(a) * 0.245, yc, GZ + math.sin(a) * 0.245), (0.05, ln * 0.7, 0.05), "trim", V.shade(col, 0.8),
              ch=0.008, mid=True)


def gun_part(name, seed):
    """The right railgun and its boom as one part (origin at the right shoulder)."""
    part = new_part(name, V3((-R.SHOULDER[0], R.SHOULDER[1], R.SHOULDER[2])), seed)
    L = Layers()
    # ---- frame: the boom's core, the receiver's core, the shoulder hub, a spine under the shroud's slot
    L.add("frame", mframe(boom_mass, -0.08, R.PAL["frame"]))
    L.add("frame", mframe(rg_recv_mass, -0.10, R.PAL["frame"]))
    hub = H.prism(R.ellipse(0.10, 4.34, 0.26, 0.26, 14), "x", -1.19, -1.07, "dark", V.shade(R.PAL["frame"], 1.15), "hub")
    L.add("frame", hub)
    V.blk(L["frame"], (GX, -1.24, GZ - 0.16), (0.10, 1.10, 0.05), "dark", V.shade(R.PAL["frame"], 1.2), ch=0.01, mid=True)
    # ---- plates: the boom (white top and front; its back and belly open on the navy core)
    bm = lambda d=0.0, col=WHITE, flag=0: boom_mass(d, col, flag)  # noqa: E731
    bsh = shell(bm, -0.05, 0.0)
    L.add("plates", panel(bsh, region(rect(-1.80, -1.0, -0.6, 0.7), "z", 4.33, 4.9), 0.035, "boom_top",
                          cuts=[inset(V3((-1.42, 0.06, 4.44)), X_, Y_, Z_, 0.20, 0.14, PERI, depth=0.02)]))
    L.add("plates", panel(bsh, region(rect(-1.80, -1.0, 3.9, 4.29), "y", -0.6, -0.04), 0.03, "boom_front"))
    # ---- plates: the receiver. Raised top (one panel, a periwinkle stripe), outer plate split at the capacitor bay, inner
    # plate, thin belly; the capacitor bay is a dark window cut through the outer plate.
    rm = lambda d=0.0, col=WHITE, flag=0: rg_recv_mass(d, col, flag)  # noqa: E731
    up = shell(rm, -0.06, 0.035)
    sh = shell(rm, -0.05, 0.0)
    th = shell(rm, -0.06, -0.02)
    L.add("plates", panel(up, region(rect(-2.6, -1.50, -0.6, 1.0), "z", 4.19, 4.8), 0.035, "recv_top",
                          cuts=[inset(V3((GX - 0.12, -0.02, 4.31)), Y_, X_, Z_, 0.62, 0.07, PERI, depth=0.025)]))
    bay = H.cut_rect(V3((GX - 0.31, 0.12, 4.00)), Y_, Z_, -X_, 0.66, 0.26, depth=0.16, corner=0.04, slope=0.15, mat="dark",
                     col=V.shade(NAVY, 0.75))
    port = H.cut_rect(V3((GX - 0.31, -0.20, 4.06)), Y_, Z_, -X_, 0.14, 0.10, depth=0.14, corner=0.02, slope=0.2, mat="dark",
                      col=(0.10, 0.10, 0.12))
    L.add("plates", panel(sh, region(rect(-0.6, 0.55, 3.70, 4.17), "x", -2.6, GX - 0.20), 0.035, "recv_out_front",
                          cuts=[bay, port]))
    L.add("plates", panel(sh, region(rect(0.59, 1.0, 3.70, 4.17), "x", -2.6, GX - 0.20), 0.035, "recv_out_back"))
    L.add("plates", panel(sh, region(rect(-0.6, 1.0, 3.70, 4.17), "x", GX + 0.20, -1.5), 0.035, "recv_in"))
    L.add("plates", panel(th, region(rect(-2.6, -1.50, -0.6, 1.0), "z", 3.6, 3.84), 0.025, "recv_belly"))
    # ---- plates: the shroud. The signature: ONE slate plate over the top and both shoulders from the coil ring to the nose.
    # The side plates below the crease carry the windows and vents; a slot under the bore stays open on the rails.
    sm = lambda d=0.0, col=SLATE, flag=0: shroud_mass(d, col, flag)  # noqa: E731
    ssh = shell(sm, -0.06, 0.035, SLATE)
    sth = shell(sm, -0.05, 0.0, WHITE)
    crease = GZ + 0.02
    L.add("plates", panel(ssh, region(rect(GX - 0.5, GX + 0.5, crease, GZ + 0.5), "y", -2.0, -0.5, SLATE), 0.045, "shroud_line"))
    surf = H.Surface(shroud_mass(0.0))
    side_cuts = {}
    for e in (-1, 1):                       # e = -1 outer side, +1 inner side
        cuts = []
        for y in (-0.98, -1.36):            # windows onto the rails and the flange ribs
            p, n = surf.project(V3((GX + e * 0.7, y, GZ - 0.095)), along=V3((-e, 0, 0)))
            cuts.append(H.cut_rect(p, Y_, n.cross(Y_).normalized(), n, 0.30, 0.10, depth=0.12, corner=0.02, slope=0.1, mat="dark",
                                   col=V.shade(NAVY, 0.7)))
        p, n = surf.project(V3((GX + e * 0.7, -1.68, GZ - 0.085)), along=V3((-e, 0, 0)))
        cuts += H.cut_vents(p, Y_, n.cross(Y_).normalized(), n, 0.28, 0.13, 3, gap=0.4, depth=0.10, mat="dark",
                            col=V.shade(NAVY, 0.6))
        side_cuts[e] = (cuts, p, n)
        L.add("plates", panel(sth, region(rect(GX - 0.6, GX - 0.035, GZ - 0.5, crease - 0.04) if e < 0 else
                                          rect(GX + 0.035, GX + 0.6, GZ - 0.5, crease - 0.04), "y", -2.0, -0.5), 0.03,
                              "shroud_side", cuts=cuts))
        # heat: an orange-hot floor behind the vent slots (the gun's heat vents read as "this gets hot")
        f = V.surf_blk(L["heat"], p - n * 0.075, Y_, n.cross(Y_).normalized(), n, 0.28, 0.13, 0.01, "glow", HOT)
        H.glow_flag(f, L["heat"])
    # mounting: two flange hoops inside the shroud, behind the windows
    flanges(L, shroud_mass(-0.07, R.PAL["mounting"]), [(V3((GX, y, GZ)), Y_) for y in (-0.98, -1.36)], 12, 0.08, 0.04, stringers=())
    # ---- weapon: rails, coil ring, brace, rail insulators
    w = P_("rails")
    rails(w)
    for y in (-1.98, -2.20):
        V.blk(w, (GX, y, GZ), (0.17, 0.05, 0.27), "trim", CERAMIC, ch=0.012, mid=True)
    L.add("weapon", w)
    br = P_("brace")
    brace(br)
    for e in (1, -1):                       # stays from the brace back to the shroud's flanks
        V.bar(br, V3((GX + e * 0.15, BRACE_Y + 0.02, GZ + 0.10)), V3((GX + e * 0.14, -1.80, GZ + 0.06)), 0.022, "dark",
              V.shade(NAVY, 1.2), 6)
    V.blk(br, (GX, BRACE_Y - 0.03, GZ + 0.215), (0.26, 0.10, 0.025), "primary", SLATE, ch=0.008, mid=True)
    L.add("weapon", br)
    ring = P_("coil")
    coil(ring)
    f = V.cyl(ring, (GX, sum(RING_Y) / 2, GZ), 0.25, 0.025, axis="y", n=12, mat="glow", col=TEAL)
    H.glow_flag(f, ring)
    L.add("weapon", ring)
    # ---- power: the capacitor banks (2 x 5, end caps lit teal) in the outer bay; a conduit from the hull down the boom
    for zc in (3.935, 4.065):
        for k in range(5):
            y = -0.12 + 0.12 * k
            V.cyl(L["power"], (GX - 0.235, y, zc), 0.048, 0.11, axis="x", n=10, mat="dark", col=V.shade(NAVY, 1.15))
            V.cyl(L["power"], (GX - 0.292, y, zc), 0.052, 0.012, axis="x", n=10, mat="trim", col=BARE)
            f = V.cyl(L["power"], (GX - 0.300, y, zc), 0.030, 0.006, axis="x", n=8, mat="glow", col=TEAL)
            H.glow_flag(f, L["power"])
    V.tube_along(L["power"], V.round_path([V3((-1.10, 0.30, 4.16)), V3((-1.40, 0.30, 4.06)), V3((-1.66, 0.36, 3.98)),
                                           V3((-1.80, 0.62, 3.96))], 0.12), 0.05, "dark", R.PAL["power"], n=6)
    # ---- actuation: sleeved coolant conduits (fixed runs, not hoses) from the bay along the flank into the coil ring; the
    # boom's elevation ram; the recoil buffer pair under the receiver (each shot swings the arm back)
    H.pipe_bundle(L["actuation"], [V3((GX - 0.27, 0.46, 3.84)), V3((GX - 0.28, -0.20, 3.84)), V3((GX - 0.21, -0.40, 3.86))], Z_, 2, 0.022, cols=R.PIPE_COLS[1:], clamp_every=0.3,
                  clamp_col=SLATE_D)
    H.ram(L["actuation"], V3((-1.12, 0.40, 4.04)), V3((-1.62, 0.36, 3.84)), 0.034, sleeve_col=R.PAL["actuation"], rod_col=BARE)
    for e in (1, -1):
        H.ram(L["actuation"], V3((GX + e * 0.13, 0.70, 3.70)), V3((GX + e * 0.13, -0.26, 3.72)), 0.04, sleeve_col=R.PAL["actuation"],
              rod_col=BARE)
    # ---- heat: the fin stack in the receiver's top recess, orange floor
    for k in range(7):
        y = FIN_Y[0] + 0.05 + k * (FIN_Y[1] - FIN_Y[0] - 0.10) / 6
        V.blk(L["heat"], (GX, y, 4.31), (0.28, 0.018, 0.10), "dark", V.shade(R.PAL["heat"], 0.9), ch=0.0, mid=True)
    f = V.surf_blk(L["heat"], V3((GX, sum(FIN_Y) / 2, 4.258)), Y_, X_, Z_, FIN_Y[1] - FIN_Y[0] - 0.06, 0.30, 0.008, "glow", HOT)
    H.glow_flag(f, L["heat"])
    # ---- seals: the boot at the boom's root
    H.bellows(L["seals"], V3((-0.94, 0.10, 4.34)), V3((-1.08, 0.10, 4.34)), 0.18, 0.18, folds=2, depth=0.02, n=12,
              col=R.PAL["seals"])
    # ---- sensors: a teal ring round the shoulder hub, the rangefinder on the receiver's inner front
    f = V.cyl(L["sensors"], (-1.195, 0.10, 4.34), 0.265, 0.012, axis="x", n=14, mat="glow", col=TEAL)
    H.glow_flag(f, L["sensors"])
    V.cyl(L["sensors"], (GX + 0.20, -0.40, 4.18), 0.045, 0.10, axis="y", n=10, mat="dark", col=NAVY)
    f = V.cyl(L["sensors"], (GX + 0.20, -0.455, 4.18), 0.032, 0.01, axis="y", n=10, mat="glow", col=TEAL)
    H.glow_flag(f, L["sensors"])
    # teal light seam in the shroud's outer crease gap (a Novus-Lux light line, not a stencil)
    a, na = surf.project(V3((GX - 0.7, -0.72, crease - 0.02)), along=X_)
    b, nb = surf.project(V3((GX - 0.7, -1.70, crease - 0.02)), along=X_)
    f = V.bar(L["sensors"], a - na * 0.01, b - nb * 0.01, 0.011, "glow", TEAL, 4)
    H.glow_flag(f, L["sensors"])
    # ---- service: a red index mark on the brace, a slate band on the receiver's outer back (no text: the left gun is a mirror)
    V.surf_blk(L["service"], V3((GX - 0.19, BRACE_Y - 0.03, GZ)), Y_, Z_, -X_, 0.10, 0.03, 0.006, "secondary", RED)
    V.surf_blk(L["service"], V3((GX - 0.283, 0.70, 4.02)), Y_, Z_, -X_, 0.05, 0.30, 0.006, "secondary", MARK)
    L.flush(part)
    return part


def mirror_part(part, name, seed):
    """A copy of a right-side part mirrored onto the left (x -> -x about the hull's centre)."""
    o = part.origin
    out = H.Part(name, V3((-o.x, o.y, o.z)), seed)
    for k, P in part.layers.items():
        if P.empty():
            continue
        Q = out[k]
        Q.bm.free()
        Q.bm = P.bm.copy()
        Q.col = Q.bm.loops.layers.color["Color"]
        Q.sec = Q.bm.faces.layers.int["sec"]
        Q.flag = Q.bm.faces.layers.int["flag"]
        bmesh.ops.scale(Q.bm, vec=(-1, 1, 1), verts=Q.bm.verts[:])
        bmesh.ops.reverse_faces(Q.bm, faces=Q.bm.faces[:])
        Q.tris = P.tris
    return out


def arm_r():
    return gun_part("Arm_R", 61)


def arm_l():
    return mirror_part(gun_part("Arm_Lsrc", 62), "Arm_L", 62)


# ============================================================================================================== the hull
def fin_mass(s, d=0.0, col=R.GREY, flag=0):
    """A swept crest fin on the hood (the brand's swept fins): a thin blade with a ridge, raked back, leaning outward."""
    side = [(-0.50, 4.76), (0.28, 4.90), (0.60, 5.28), (0.40, 5.30)]
    thin = H.convex_offset(ccw(side), -0.02)
    m = H.loft([(-0.035, thin), (0.0, ccw(side)), (0.035, thin)], "x", d, "primary", col, "fin", flag)
    M = Matrix.Translation(V3((s * 0.24, 0, 4.86))) @ Matrix.Rotation(math.radians(-s * 13), 4, "Y") @ \
        Matrix.Translation(V3((0, 0, -4.86)))
    return H.xform(m, M)


def light_seam(L, pts, r=0.012):
    for a, b in zip(pts, pts[1:]):
        f = V.bar(L["sensors"], a, b, r, "glow", TEAL, 4)
        H.glow_flag(f, L["sensors"])


def torso():
    """v4's torso restyled: white shell, the face shield kept whole, a teal visor slit for the vision block, teal light
    seams round the shield, swept strakes for the chest-side bricks, a slate hood with two swept crest fins."""
    part = new_part("Torso", R.WAIST, 50)
    L = Layers()
    tub = mframe(R.chest_mass, -0.18, R.PAL["frame"], 0, False)
    core = mframe(R.rear_mass, -0.16, R.PAL["frame"], 0, False)
    waist = H.prism(R.ellipse(0.10, 0.10, 0.32, 0.32, 12), "z", 3.30, 3.78, "dark", V.shade(R.PAL["frame"], 1.15), "waist")
    sh_d = [H.prism(R.ellipse(R.SHOULDER[1], R.SHOULDER[2], 0.21, 0.21, 12), "x", *span(s * 0.80, s * 1.12), "dark",
                    V.shade(R.PAL["frame"], 1.15), "shoulder") for s in (-1, 1)]
    fr = H.fuse([tub, core, waist] + sh_d, "torso_frame", fillet=0.02, segments=1)
    pockets(fr, [H.cut_rect(V3((0, 1.16, 4.24)), X_, Z_, Y_, 0.42, 0.44, depth=0.20, corner=0.06, slope=0.2, mat="dark",
                            col=V.shade(R.PAL["frame"], 0.6))])
    L.add("frame", fr)
    V.cyl(L["power"], (0, 0.88, 4.24), 0.20, 0.56, axis="z", n=12, mat="dark", col=R.PAL["power"])
    for s in (-1, 1):
        V.tube_along(L["power"], V.round_path([V3((s * 0.30, 0.55, 4.0)), V3((s * 0.62, 0.40, 3.92)), V3((s * 0.86, 0.2, 4.12)),
                                               V3((s * 0.95, 0.12, 4.30))], 0.12), 0.05, "dark", R.PAL["power"], n=6)
        H.pipe_bundle(L["actuation"], [V3((s * 0.55, -0.40, 3.30)), V3((s * 0.70, -0.12, 3.36)), V3((s * 0.86, 0.10, 3.62)),
                                       V3((s * 1.06, 0.12, 3.92)), V3((s * 1.18, 0.10, 4.06))], V3((0, 1, 0)), 3, 0.026,
                      cols=R.PIPE_COLS)
        H.ram(L["actuation"], V3((s * 0.30, -0.10, 3.42)), V3((s * 0.42, 0.20, 3.74)), 0.03, sleeve_col=R.PAL["actuation"],
              rod_col=BARE)
        H.pipe_bundle(L["actuation"], [V3((s * 0.20, 1.10, 3.70)), V3((s * 0.40, 1.16, 3.86)), V3((s * 0.50, 1.20, 4.10)),
                                       V3((s * 0.50, 1.18, 4.50))], X_, 2, 0.022, cols=R.PIPE_COLS)
    flanges(L, R.chest_mass(-0.07, R.PAL["mounting"], 0, False), [(V3((0, 0, 3.90)), Z_)], 18, 0.12, 0.05, stringers=())
    flanges(L, R.rear_mass(-0.07, R.PAL["mounting"], 0, False), [(V3((0, 0.36, 0)), Y_), (V3((0, 0, 4.30)), Z_)], 18, 0.14, 0.05,
            stringers=())
    # the chest: the face shield (the Rampart's signature, kept whole), now with a teal visor slit across its upper face
    cm = R.chest_mass
    up = shell(cm, -0.08, 0.035)
    sh = shell(cm, -0.06, 0.0)
    ins = shell(cm, -0.10, -0.03)
    capp = shell(cm, 0.03, 0.065, PERI)
    surf = H.Surface(R.chest_mass())
    onf = lambda x, z: surf.project(V3((x, -2.0, z)), along=Y_)  # noqa: E731
    pv, nv = onf(0.0, 4.20)
    tv = R.FACE_T - nv * R.FACE_T.dot(nv)
    vis = H.cut_rect(pv, X_, tv.normalized(), nv, 0.54, 0.075, depth=0.09, corner=0.03, slope=0.4, mat="dark", col=(0.07, 0.08, 0.11))
    grooves = []
    for sx in (-1, 1):
        (pa, na), (pb, nb) = onf(sx * 0.30, 3.30), onf(sx * 0.46, 3.76)
        grooves.append(groove((pa + pb) / 2, (pb - pa).normalized(), X_, (na + nb).normalized(), (pb - pa).length * 0.9))
    L.add("plates", panel(up, region(R.sym_concave(R.SHIELD_HALF + R.ARCH_HALF), "y", -1.6, -0.62), 0.045, "face_shield",
                          cuts=[vis] + grooves))
    L.add("plates", panel(ins, region(R.sym_concave(R.ARCH_INSET), "y", -1.6, -0.62, PERI), 0.025, "face_arch"))
    E = H.offset_polyline(R.SHIELD_EDGE, 0.04)
    for s in (-1, 1):
        cheek_o = E[:3] + [(0.95, E[2][1] - 0.06), (0.95, 4.75), (E[0][0], 4.75)]
        chin_o = [(E[2][0], E[2][1] - 0.045)] + E[3:] + [(E[-1][0], 2.95), (0.95, 2.95), (0.95, E[2][1] - 0.105)]
        L.add("plates", panel(sh, region(mx(cheek_o, s), "y", -1.6, -0.66), 0.04, "cheek"))
        L.add("plates", panel(sh, region(mx(chin_o, s), "y", -1.6, -0.62), 0.04, "chin_side"))
        L.add("plates", panel(sh, region(ccw([(-0.56, 3.30), (0.30, 3.30), (0.30, 3.96), (-0.40, 3.96)]), "x",
                                         *span(s * 0.70, s * 1.0)), 0.04, "chest_side"))
        # a swept strake along the chest side, raised like a shingle, in place of v4's add-on bricks (brand: sleek)
        L.add("plates", panel(capp, region(ccw([(-0.52, 3.60), (0.12, 3.66), (0.24, 3.78), (-0.44, 3.80)]), "x",
                                           *span(s * 0.70, s * 1.0), PERI), 0.02, "strake"))
        R.pauldron(L, s)
        # teal light seam in the gap round the shield (both legs of the U)
        pts = []
        for x, z in H.offset_polyline(R.SHIELD_EDGE, 0.02):
            p, n = onf(s * x, z)
            pts.append(p - n * 0.012)
        light_seam(L, pts)
    L.add("plates", panel(up, region(rect(-0.45, 0.45, -0.62, 0.2), "z", 4.44, 4.9), 0.035, "brow"))
    # rear hull
    rm = lambda d=0.0, col=WHITE, flag=0: R.rear_mass(d, col, flag)  # noqa: E731
    rsh = shell(rm, -0.06, 0.0)
    rth = shell(rm, -0.07, -0.03)
    rup = shell(rm, -0.03, 0.03)
    for s in (-1, 1):
        L.add("plates", panel(rup, region(mx(rect(0.56, 1.2, -0.6, 1.5), s), "z", 4.55, 5.2), 0.035, "sbox_top"))
        L.add("plates", panel(rsh, region(rect(-0.60, 0.31, 3.7, 4.56), "x", *span(s * 0.80, s * 1.2)), 0.035, "sbox_side_front",
                              cuts=[inset(V3((s * 0.97, -0.05, 4.18)), Y_, Z_, s * X_, 0.32, 0.36, PERI)]))
        L.add("plates", panel(rsh, region(rect(0.41, 1.5, 3.7, 4.56), "x", *span(s * 0.80, s * 1.2)), 0.035, "sbox_side_back",
                              cuts=[groove(V3((s * 0.975, 0.80, 4.10)), Z_, Y_, s * X_, 0.5)]))
        L.add("plates", panel(rth, region(mx(rect(0.54, 1.1, 3.7, 4.7), s), "y", 1.0, 1.6), 0.03, "sbox_back",
                              cuts=[H.cut_rect(V3((s * 0.74, 1.24, 4.20)), X_, Z_, Y_, 0.30, 0.44, depth=0.24, corner=0.03, slope=0.15,
                                               mat="dark", col=(0.08, 0.08, 0.10))]))
        c = V3((s * 0.74, 1.20, 4.20))
        V.louvres(L["heat"], c, X_, Z_, Y_, 0.28, 0.40, 4, "dark", V.shade(R.PAL["heat"], 0.8), tilt=0.5, t=0.02)
        f = V.surf_blk(L["heat"], c - Y_ * 0.14, X_, Z_, Y_, 0.28, 0.40, 0.01, "glow", HOT)
        H.glow_flag(f, L["heat"])
    L.add("plates", panel(rsh, region(rect(-0.44, 0.44, 3.6, 4.9), "y", 1.0, 1.6), 0.04, "hull_back"))
    # the slate hood, its spine, side panels with insets; teal seams along the spine; two swept crest fins
    hm = lambda d=0.0, col=SLATE, flag=0: R.hood_mass(d, col, flag)  # noqa: E731
    hsh = shell(hm, -0.05, 0.0, SLATE)
    hup = shell(hm, -0.02, 0.03, SLATE)
    L.add("plates", panel(hup, region(rect(-0.15, 0.15, -1.0, 1.3), "z", 4.6, 5.4, SLATE), 0.03, "hood_spine"))
    hs = H.Surface(R.hood_mass())
    for s in (-1, 1):
        L.add("plates", panel(hsh, region(mx(rect(0.18, 0.6, -1.0, 1.3), s), "z", 4.6, 5.4, SLATE), 0.03, "hood_side",
                              cuts=[inset(V3((s * 0.30, 0.55, 5.03)), Y_, X_, V3((s * 0.25, 0, 0.97)).normalized(), 0.50, 0.12,
                                          SLATE_D)]))
        pts = []
        for y in (-0.70, -0.30, 0.20, 0.80, 1.15):
            p, n = hs.project(V3((s * 0.165, y, 6.0)), along=-Z_)
            pts.append(p - n * 0.008)
        light_seam(L, pts, 0.01)
        fm = lambda d=0.0, col=WHITE, flag=0, s=s: fin_mass(s, d, col, flag)  # noqa: E731
        L.add("plates", recol(fm(), WHITE, "primary"))
        fl = fin_mass(s)
        fs = H.Surface(fl)
        a, na = fs.project(V3((s * 0.9, -0.20, 4.88)), along=V3((-s, 0, 0)))
        b, nb = fs.project(V3((s * 0.9, 0.38, 5.22)), along=V3((-s, 0, 0)))
        light_seam(L, [a + na * 0.004, b + nb * 0.004], 0.009)
    H.bellows(L["seals"], V3((0, 0.1, 3.34)), V3((0, 0.1, 3.66)), 0.36, 0.34, folds=3, depth=0.025, n=14, col=R.PAL["seals"])
    for s in (-1, 1):
        H.lifting_eye(L["service"], V3((s * 0.30, 0.95, 5.07)), Z_, r=0.07, t=0.02)
    H.rungs(L["service"], V3((-0.86, -0.20, 3.45)), V3((-0.86, -0.20, 3.85)), 2, -X_, width=0.18, depth=0.07, r=0.016)
    fc = V3((0.20, -1.19, 3.73)) + R.FACE_T * 0.40 + R.FACE_N * 0.036
    K.stencil(L["service"], "01", fc, X_, R.FACE_T, R.FACE_N, 0.11, "secondary", MARK)
    # sensors: the visor's glow strip in the slit, two brow lenses, an antenna
    f = V.surf_blk(L["sensors"], pv - nv * 0.06, X_, tv.normalized(), nv, 0.48, 0.035, 0.012, "glow", TEAL)
    H.glow_flag(f, L["sensors"])
    for s in (-1, 1):
        V.cyl(L["sensors"], (s * 0.11, -0.80, 4.72), 0.045, 0.08, axis="y", n=10, mat="dark", col=NAVY)
        f = V.cyl(L["sensors"], (s * 0.11, -0.845, 4.72), 0.03, 0.01, axis="y", n=10, mat="glow", col=TEAL)
        H.glow_flag(f, L["sensors"])
    V.bar(L["sensors"], V3((-0.34, 1.0, 5.0)), V3((-0.38, 1.1, 5.75)), 0.012, "trim", BARE, 5)
    L.flush(part)
    return part


# ============================================================================================================ mass layer
_mass_v4 = R.mass_layer


def mass_layer():
    out = _mass_v4()
    out["Torso"] += [fin_mass(1), fin_mass(-1)]
    gun = gun_mass_solids()
    out["Arm_R"] = gun
    flip = Matrix.Scale(-1, 4, X_)
    out["Arm_L"] = [H.xform(S.copy("m"), flip) for S in gun_mass_solids()]
    return out


R.torso, R.arm_r, R.arm_l, R.mass_layer = torso, arm_r, arm_l, mass_layer
build_full, build_mass, joints, POSE, HIP_Z = R.build_full, R.build_mass, R.joints, R.POSE, R.HIP_Z


# ================================================================================================= export_game.py hooks
def export_gun_points():
    return {"PodSpin_R": SPIN_PIVOT, "PodSpinFwd_R": SPIN_FWD, "PodMuzzle0_R": MUZZLE_R, "PodEject_R": EJECT_R}


def export_split_guns(parts, split_off):
    """The coil ring (and its glow band) as Part_PodSpin_R, turning about the bore axis."""
    out = {}
    arm_r = parts.get("Arm_R")
    if arm_r is None:
        return out

    def rad(p):
        return ((p.x - GX) ** 2 + (p.z - GZ) ** 2) ** 0.5

    def pick(c, pts):
        return (RING_Y[1] - 0.02 < c.y < RING_Y[0] + 0.02 and all(RING_Y[1] - 0.03 < p.y < RING_Y[0] + 0.03 for p in pts)
                and max(rad(p) for p in pts) < 0.30)
    o, n = split_off(arm_r, pick, "Part_PodSpin_R")
    print("HDX split %d coil islands -> %s" % (n, o.name if o else None))
    if o is not None:
        out["PodSpin_R"] = o
    return out
