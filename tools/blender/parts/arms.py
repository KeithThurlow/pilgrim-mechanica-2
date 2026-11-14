"""Hull arms (Keith 2026-11-14: "it would be cool if we started adapting arms to suit the hull"): each hull's own two-bone
arm, in the hull's maker and paint, replacing the box stand-ins in src/mech/rampart.ts (ikArm). Arms aren't items the
player fits: each hull names its arm (src/items/bases.ts Base.arm). docs/asset-pipeline.md batch 4.

    node tools/blender/run.mjs tools/blender/parts/arms.py -- --out public/models/parts [--only arm-loader] [--sheet <dir>]

One GLB per arm, its pieces as nodes on the origin (no body), each read by name in the game:
  Joint  the shoulder bearing, centred on the shoulder point (the hull's frame: x across, z up, -y forward).
  Stub   the spacer from the hull's shoulder out to the arm's root, along +Z from 0 to 1 (stretched to its length).
  Upper  shoulder -> elbow, along +Z from 0 to the socket Upper_End (stretched to the bone's length).
  Elbow  the hinge, centred on the elbow; its axle along x.
  Fore   elbow -> wrist, along +Z from 0 to Fore_End.
  Hand   the fist round the held weapon's grip, centred on the hand point: -y is the aim, z up.
The game turns each bone so its x is the elbow's hinge and -y (game +z) the inside of the bend (the biceps; on the
forearm, its top when the arm reaches forward). Every piece is symmetric in x, so one model serves both sides.
Budget about 1,500 triangles an arm.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as K  # noqa: E402
from partkit import H, V, X_, Y_, Z_, Vector  # noqa: E402

UPPER_L = 1.45     # src/mech/upper.ts armUpper, armFore (the bones are stretched to the live values)
FORE_L = 1.45

# Paint by maker (the hulls' own values: rampart_v4, rampart_siege, rampart-salvager)
KHAKI, KHAKI_D, OLIVE, OLIVE_D = (0.63, 0.57, 0.42), (0.49, 0.45, 0.33), (0.42, 0.43, 0.30), (0.33, 0.34, 0.24)
FRAME, BARE, RUBBER = (0.25, 0.25, 0.205), (0.58, 0.57, 0.52), (0.17, 0.165, 0.155)
SLATE, SLATE_D, SLATE_2 = (0.47, 0.49, 0.47), (0.37, 0.39, 0.37), (0.40, 0.41, 0.38)
GUNMETAL = (0.24, 0.245, 0.24)
YELLOW, YELLOW_D, CHAR, ORANGE = (0.886, 0.643, 0.157), (0.72, 0.51, 0.12), (0.28, 0.27, 0.25), (0.82, 0.41, 0.165)
STEEL, STEEL_L, BLACK = (0.44, 0.44, 0.42), (0.60, 0.60, 0.57), (0.13, 0.125, 0.12)
HAZARD, AMBER = (0.82, 0.52, 0.14), (1.0, 0.72, 0.30)


def sleeve(z0, z1, w0, w1, d0, d1, col, ch=0.05, name="sleeve", y=0.0, x=0.0):
    """An armour sleeve along z: w (across) and d (front to back) from z0 to z1, its four long edges chamfered by ch, the
    ends clipped. The kit's way: the intersection of a side and a front profile."""
    c = ch
    side = [(y - d0 / 2, z0 + c), (y - d0 / 2 + c, z0), (y + d0 / 2 - c, z0), (y + d0 / 2, z0 + c),
            (y + d1 / 2, z1 - c), (y + d1 / 2 - c, z1), (y - d1 / 2 + c, z1), (y - d1 / 2, z1 - c)]
    front = [(x - w0 / 2, z0 + c), (x - w0 / 2 + c, z0), (x + w0 / 2 - c, z0), (x + w0 / 2, z0 + c),
             (x + w1 / 2, z1 - c), (x + w1 / 2 - c, z1), (x - w1 / 2 + c, z1), (x - w1 / 2, z1 - c)]
    return K.mass({"x": (side, -2, 2), "y": (front, -2, 2)}, name, col, fillet=0.02)


def drum(P, c, r, length, col, cap_col, bolts=6, bolt_col=BARE, n=14):
    """A hinge drum along x: the barrel, a narrower collar each end and bolts round each face."""
    V.cyl(P, c, r, length, "x", n, None, "dark", col)
    for s in (-1, 1):
        V.cyl(P, Vector(c) + Vector((s * (length / 2 + 0.02), 0, 0)), r * 0.72, 0.05, "x", n, None, "trim", cap_col)
        for k in range(bolts):
            a = 6.2832 * k / bolts
            p = Vector(c) + Vector((s * (length / 2 + 0.045), r * 0.5 * math.cos(a), r * 0.5 * math.sin(a)))
            V.bolt(P, p, s * X_, r=0.016, col=bolt_col)


def ram(P, a, b, r, body, rod, n=8):
    """A hydraulic ram from a to b: the cylinder over 60% of the way, the bright rod on, an eye at each end."""
    a, b = Vector(a), Vector(b)
    m = a.lerp(b, 0.6)
    V.bar(P, a, m, r, "secondary", body, n)
    V.bar(P, m - (b - a).normalized() * 0.04, b, r * 0.45, "trim", rod, n)
    for p in (a, b):
        V.cyl(P, p, r * 0.9, r * 1.5, "x", n, None, "dark", FRAME)


def fist(P, w, h, l, palm, knuckle, finger, fingers=4):
    """A closed fist round a grip, centred on the hand point, the aim along -y: the palm block, a knuckle guard across its
    front-top, the curled fingers under the front."""
    V.blk(P, (0, 0.02, 0), (w, l, h), "dark", palm, ch=0.04, mid=True)
    V.blk(P, (0, -l / 2 + 0.06, h * 0.18), (w + 0.04, 0.14, h * 0.55), "primary", knuckle, ch=0.035, mid=True)
    fw = (w - 0.02) / fingers
    for i in range(fingers):
        x = -w / 2 + 0.01 + fw * (i + 0.5)
        V.blk(P, (x, -l / 2 + 0.04, -h * 0.30), (fw - 0.016, 0.12, h * 0.42), "dark", finger, ch=0.02, mid=True)
    # the wrist's back plate
    V.blk(P, (0, l / 2 - 0.02, h * 0.10), (w * 0.86, 0.06, h * 0.7), "trim", knuckle, ch=0.02, mid=True)


# ---------------------------------------------------------------------------------------------------------- the arms
def arm_rampart(heavy=False):
    """Stratford-Aegis (the Rampart) and Valhalla's heavier take on it (the Siege). Says: a soldier's arm. Armoured
    sleeves over a dark frame, a hydraulic ram up the back of the upper arm, a rounded shoulder cap, a forearm guard
    plate on top, a gauntlet fist. The Siege's is the same arm thicker, in gunmetal slate, a second plate on the guard
    and a heavier ram."""
    if heavy:
        pid, name, maker = "arm-siege", "Siege arm", "Suzaku"
        P1, P1D, P2, DK = SLATE, SLATE_D, SLATE_2, GUNMETAL
    else:
        pid, name, maker = "arm-rampart", "Rampart arm", "Stratford-Aegis"
        P1, P1D, P2, DK = KHAKI, KHAKI_D, OLIVE, FRAME
    g = 1.12 if heavy else 1.0
    b = K.Build(pid, "arm", name, 41 if heavy else 31, maker, "armoured sleeves, back ram, gauntlet")

    J = b.node("Joint", (0, 0, 0))
    drum(J, (0, 0, 0), 0.27 * g, 0.42, DK, P2, bolts=6)
    S = b.node("Stub", (0, 0, 0))
    V.cyl(S, (0, 0, 0.5), 0.17 * g, 1.0, "z", 10, None, "dark", DK)

    U = b.node("Upper", (0, 0, 0))
    V.blk(U, (0, 0, 0.08), (0.24 * g, 0.26 * g, UPPER_L - 0.16), "dark", DK, ch=0.03)
    sl = sleeve(0.16, UPPER_L - 0.30, 0.40 * g, 0.34 * g, 0.42 * g, 0.36 * g, P1, ch=0.06)
    K.cut(sl, [H.cut_rect((0, -0.21 * g, 0.62), X_, Z_, -Y_, 0.22 * g, 0.40, depth=0.025, corner=0.03, slope=0.5, col=P1D)]
          + sum([H.cut_vents((s * 0.20 * g, 0.02, 0.58), Y_, Z_, s * X_, 0.22, 0.30, 3, 0.05, 0.02) for s in (-1, 1)], []), bevel=0.01)
    b.add(sl, U)
    # the shoulder cap: a rounded plate over the joint end
    cap = sleeve(-0.10, 0.34, 0.50 * g, 0.44 * g, 0.50 * g, 0.46 * g, P2, ch=0.10, name="cap")
    b.add(cap, U)
    ram(U, (0, 0.24 * g, 0.30), (0, 0.22 * g, UPPER_L - 0.22), 0.055 * g, P2, BARE)
    V.bolt_row(U, (0.21 * g, -0.12, 0.30), (0.19 * g, -0.12, UPPER_L - 0.40), 3, X_, 0.018, col=BARE)
    V.bolt_row(U, (-0.21 * g, -0.12, 0.30), (-0.19 * g, -0.12, UPPER_L - 0.40), 3, -X_, 0.018, col=BARE)

    E = b.node("Elbow", (0, 0, 0))
    drum(E, (0, 0, 0), 0.23 * g, 0.36 * g, DK, P2, bolts=5)
    V.blk(E, (0, 0.10 * g, 0), (0.18 * g, 0.20, 0.30), "trim", RUBBER, ch=0.03, mid=True)   # the back of the joint: a boot

    F = b.node("Fore", (0, 0, 0))
    V.blk(F, (0, 0, 0.10), (0.22 * g, 0.24 * g, FORE_L - 0.12), "dark", DK, ch=0.03)
    fs = sleeve(0.18, FORE_L - 0.20, 0.34 * g, 0.40 * g, 0.36 * g, 0.42 * g, P1, ch=0.06)
    K.cut(fs, [H.cut_rect((0, 0.21 * g, 0.80), X_, Z_, Y_, 0.20 * g, 0.50, depth=0.025, corner=0.03, slope=0.5, col=P1D)], bevel=0.01)
    b.add(fs, F)
    # the guard plate along the top (-y: the inside of the bend), raised off the sleeve
    gd = sleeve(0.26, FORE_L - 0.30, 0.30 * g, 0.36 * g, 0.10, 0.10, P2, ch=0.03, name="guard", y=-0.22 * g)
    b.add(gd, F)
    if heavy:
        gd2 = sleeve(0.60, FORE_L - 0.36, 0.26 * g, 0.32 * g, 0.08, 0.08, P1D, ch=0.025, name="guard2", y=-0.30 * g)
        b.add(gd2, F)
        V.bolt_row(F, (0, -0.35 * g, 0.66), (0, -0.35 * g, FORE_L - 0.42), 3, -Y_, 0.02, col=BARE)
    # the wrist collar and a cable down the underside
    V.cyl(F, (0, 0, FORE_L - 0.08), 0.16 * g, 0.12, "z", 10, None, "dark", RUBBER)
    V.pipe_run(F, [(0.08, 0.22 * g, 0.20), (0.10, 0.25 * g, 0.70), (0.08, 0.22 * g, FORE_L - 0.24)], 0.025, "dark", RUBBER, bend=0.1, n=6)
    b.lamp((0.12 * g, -0.24 * g, FORE_L - 0.36), (0.05, 0.08), -Y_, AMBER, piece=F)

    Hd = b.node("Hand", (0, 0, 0))
    fist(Hd, 0.36 * g, 0.32 * g, 0.36 * g, DK, P1, RUBBER)

    b.socket("Upper_End", (0, 0, UPPER_L))
    b.socket("Fore_End", (0, 0, FORE_L))
    return b


def arm_loader():
    """Goliath Earthworks (the Salvager): a working arm off a construction machine. Says: lifting. Open steel channel
    beams (two side plates, the dark gap between them), a big yellow ram up the front of each bone with a bright rod,
    hazard bands at the elbow, an orange slew drum at the shoulder and a three-jaw grab for a hand."""
    b = K.Build("arm-loader", "arm", "Loader arm", 51, "Suzaku", "channel beams, rams, grab")
    J = b.node("Joint", (0, 0, 0))
    drum(J, (0, 0, 0), 0.30, 0.46, CHAR, ORANGE, bolts=8, bolt_col=STEEL_L)
    S = b.node("Stub", (0, 0, 0))
    V.cyl(S, (0, 0, 0.5), 0.19, 1.0, "z", 10, None, "dark", STEEL)

    def beam(P, z0, z1, w, d):
        """A channel beam: two yellow side plates with a charcoal web between, lightening holes cut in the plates."""
        for s in (-1, 1):
            pl = sleeve(z0, z1, 0.07, 0.07, d, d * 0.86, YELLOW, ch=0.03, name="plate", x=s * (w / 2 - 0.035))
            K.cut(pl, [H.cut_rect((s * (w / 2), 0, z0 + (z1 - z0) * t), Y_, Z_, s * X_, d * 0.40, 0.22, depth=0.04,
                                  corner=0.06, slope=0.3, col=CHAR) for t in (0.35, 0.65)], bevel=0.008)
            b.add(pl, P)
        V.blk(P, (0, 0, z0 + 0.04), (w - 0.10, d * 0.5, z1 - z0 - 0.08), "dark", CHAR, ch=0.02)

    U = b.node("Upper", (0, 0, 0))
    beam(U, 0.02, UPPER_L - 0.06, 0.42, 0.40)
    ram(U, (0, -0.30, 0.16), (0, -0.28, UPPER_L - 0.20), 0.075, YELLOW_D, STEEL_L, n=10)
    V.blk(U, (0, -0.20, 0.10), (0.16, 0.14, 0.14), "trim", STEEL, ch=0.02)              # the ram's foot
    V.pipe_run(U, [(0.14, 0.24, 0.20), (0.16, 0.26, 0.80), (0.14, 0.24, UPPER_L - 0.20)], 0.03, "dark", BLACK, bend=0.1, n=6)
    V.pipe_run(U, [(-0.14, 0.24, 0.20), (-0.16, 0.26, 0.80), (-0.14, 0.24, UPPER_L - 0.20)], 0.03, "dark", BLACK, bend=0.1, n=6)

    E = b.node("Elbow", (0, 0, 0))
    drum(E, (0, 0, 0), 0.24, 0.40, CHAR, ORANGE, bolts=6, bolt_col=STEEL_L)
    for s in (-1, 1):
        V.surf_blk(E, (s * 0.226, 0, 0), Y_, Z_, s * X_, 0.30, 0.30, 0.01, "trim", BLACK)
        for k in range(3):
            V.surf_blk(E, (s * 0.232, -0.10 + k * 0.10, 0), Vector((0, 0.7, 0.7)), Vector((0, -0.7, 0.7)), s * X_, 0.05, 0.30, 0.01, "trim", YELLOW)

    F = b.node("Fore", (0, 0, 0))
    beam(F, 0.02, FORE_L - 0.10, 0.40, 0.38)
    ram(F, (0, -0.28, 0.14), (0, -0.25, FORE_L - 0.22), 0.065, YELLOW_D, STEEL_L, n=10)
    V.cyl(F, (0, 0, FORE_L - 0.07), 0.18, 0.14, "z", 10, None, "dark", STEEL)          # the wrist's rotator
    for k in range(4):
        V.surf_blk(F, (-0.105 + k * 0.07, 0.20, FORE_L - 0.40), Vector((0.7, 0, 0.7)), Vector((-0.7, 0, 0.7)), Y_, 0.035, 0.12, 0.01, "trim", BLACK)
    b.lamp((0, -0.20, FORE_L - 0.16), 0.045, -Y_, AMBER, piece=F)

    Hd = b.node("Hand", (0, 0, 0))
    # the grab: a charcoal palm block, two jaws over the grip and a thumb jaw under it, orange tips
    V.blk(Hd, (0, 0.06, 0), (0.40, 0.30, 0.30), "dark", CHAR, ch=0.04, mid=True)
    for s in (-1, 1):
        V.blk(Hd, (s * 0.12, -0.14, 0.10), (0.10, 0.22, 0.12), "primary", YELLOW, ch=0.025, mid=True)
        V.blk(Hd, (s * 0.12, -0.26, 0.02), (0.10, 0.08, 0.16), "secondary", ORANGE, ch=0.02, mid=True)
    V.blk(Hd, (0, -0.14, -0.13), (0.14, 0.22, 0.10), "primary", YELLOW, ch=0.025, mid=True)
    V.blk(Hd, (0, -0.25, -0.07), (0.14, 0.08, 0.12), "secondary", ORANGE, ch=0.02, mid=True)

    b.socket("Upper_End", (0, 0, UPPER_L))
    b.socket("Fore_End", (0, 0, FORE_L))
    return b


def arm_light():
    """Novus-Lux (the Cuirass): a light arm. Says: quick. A slim olive frame with one khaki shell on each bone, an open
    piston up the back, a small elbow, a narrow fist."""
    b = K.Build("arm-wildcat", "arm", "Light arm", 61, "Novus-Lux", "slim shells, open piston")
    J = b.node("Joint", (0, 0, 0))
    drum(J, (0, 0, 0), 0.22, 0.34, FRAME, OLIVE, bolts=5)
    S = b.node("Stub", (0, 0, 0))
    V.cyl(S, (0, 0, 0.5), 0.13, 1.0, "z", 8, None, "dark", FRAME)
    U = b.node("Upper", (0, 0, 0))
    V.blk(U, (0, 0, 0.06), (0.16, 0.18, UPPER_L - 0.12), "dark", OLIVE_D, ch=0.025)
    us = sleeve(0.14, UPPER_L - 0.36, 0.30, 0.24, 0.32, 0.24, KHAKI, ch=0.07)
    K.cut(us, [H.cut_rect((0, -0.16, 0.56), X_, Z_, -Y_, 0.14, 0.34, depth=0.02, corner=0.03, slope=0.5, col=KHAKI_D)], bevel=0.008)
    b.add(us, U)
    V.bar(U, (0, 0.17, 0.24), (0, 0.15, UPPER_L - 0.20), 0.03, "trim", BARE, 6)
    V.bar(U, (0, 0.17, 0.24), (0, 0.16, 0.80), 0.045, "secondary", OLIVE, 6)
    E = b.node("Elbow", (0, 0, 0))
    drum(E, (0, 0, 0), 0.18, 0.28, FRAME, OLIVE, bolts=4)
    F = b.node("Fore", (0, 0, 0))
    V.blk(F, (0, 0, 0.06), (0.15, 0.17, FORE_L - 0.08), "dark", OLIVE_D, ch=0.025)
    fs = sleeve(0.20, FORE_L - 0.22, 0.24, 0.30, 0.26, 0.30, KHAKI, ch=0.07)
    K.cut(fs, H.cut_vents((0, 0.15, 0.80), X_, Z_, Y_, 0.16, 0.30, 3, 0.04, 0.02), bevel=0.008)
    b.add(fs, F)
    V.cyl(F, (0, 0, FORE_L - 0.06), 0.12, 0.10, "z", 8, None, "dark", RUBBER)
    b.lamp((0, -0.155, FORE_L - 0.40), (0.04, 0.10), -Y_, (0.55, 0.85, 1.0), piece=F)
    Hd = b.node("Hand", (0, 0, 0))
    fist(Hd, 0.30, 0.27, 0.30, FRAME, KHAKI, RUBBER, fingers=3)
    b.socket("Upper_End", (0, 0, UPPER_L))
    b.socket("Fore_End", (0, 0, FORE_L))
    return b


BUILDS = {"arm-rampart": lambda: arm_rampart(False), "arm-siege": lambda: arm_rampart(True), "arm-loader": arm_loader,
          "arm-wildcat": arm_light}


def main():
    a = K.parse_args()
    for pid, fn in BUILDS.items():
        if a.only and pid != a.only:
            continue
        b = fn()
        K.write(b, a.out)


if __name__ == "__main__":
    main()
