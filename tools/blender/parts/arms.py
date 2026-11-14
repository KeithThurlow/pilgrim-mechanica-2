"""Arms (on a hull mount in place of a hull weapon; they hold the held weapons): three, one per hull family.
docs/asset-pipeline.md batch 4; item bases in src/items/bases.ts. The game poses an arm as two bones (src/mech/rampart.ts
drawArm): it puts Body on the shoulder, stretches Upper from the shoulder to the elbow and Fore from the elbow to the
fist, sets Elbow on the elbow and Hand on the fist turned to the gun's aim.

    node tools/blender/run.mjs tools/blender/parts/arms.py -- --out public/models/parts [--only arm-loader] [--sheet <dir>]

Frame: every piece is authored about its own joint. Upper and Fore run up +z from 0 to their length (the game scales
them to the bone, so the length here only sets the proportions: 1.45 m each, the Arm pose sliders' defaults); a bone's
twist about its length isn't fixed, so they are built to read from any side. Hand: -y is the way the gun points.
The sheet shows the arm hanging straight. Budget 1,500 triangles (docs/asset-list.md).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as K  # noqa: E402
from partkit import H, V, X_, Y_, Z_, Vector  # noqa: E402

KHAKI, KHAKI_D, OLIVE, OLIVE_D = (0.63, 0.57, 0.42), (0.49, 0.45, 0.33), (0.42, 0.43, 0.30), (0.33, 0.34, 0.24)
FRAME, BARE, RUBBER = (0.25, 0.25, 0.205), (0.58, 0.57, 0.52), (0.17, 0.165, 0.155)
HAZARD, AMBER = (0.82, 0.52, 0.14), (1.0, 0.72, 0.30)
WHITE, SLATE, SLATE_D, NAVY, NBARE = (0.79, 0.81, 0.86), (0.35, 0.41, 0.57), (0.27, 0.31, 0.45), (0.20, 0.22, 0.31), (0.70, 0.72, 0.77)
TEAL = (0.35, 1.0, 0.92)
L = 1.45
# Where the sheet hangs each piece (the game poses them itself): shoulder at the top, the fist at the bottom.
HANG = {"Upper": (0, 0, -L), "Elbow": (0, 0, -L), "Fore": (0, 0, -2 * L), "Hand": (0, 0, -2 * L)}


def B(P, c, size, mat="primary", col=(0.5, 0.5, 0.5), **k):
    """A chamfered box by its centre (V.blk takes the bottom)."""
    return V.blk(P, c, size, mat, col, mid=True, **k)


def nodes(b):
    """The four posed pieces. In the file they hang straight down from the shoulder; the upper pieces are authored
    from their far joint up (z 0 at the elbow / the fist), so both bones run +z toward the shoulder... the game flips
    nothing: it reads each mesh about its own node."""
    return {n: b.node(n, HANG[n]) for n in ("Upper", "Elbow", "Fore", "Hand")}


def piston(P, a, b_, r, col_rod=BARE, col_cyl=FRAME):
    a, b_ = Vector(a), Vector(b_)
    m = a.lerp(b_, 0.55)
    V.bar(P, a, m, r, "dark", col_cyl, 6)
    V.bar(P, m, b_, r * 0.55, "trim", col_rod, 6)


def fist(P, col, knuckle, w=0.34, fingers=3):
    """A closed fist: a palm block, finger blocks curled forward, a thumb across."""
    B(P, (0, 0.02, 0), (w, 0.26, 0.30), "dark", col, ch=0.04)
    fw = (w - 0.04) / fingers
    for i in range(fingers):
        x = -w / 2 + 0.02 + fw * (i + 0.5)
        B(P, (x, -0.16, 0.03), (fw - 0.02, 0.14, 0.24), "dark", knuckle, ch=0.025)
    B(P, (w / 2 - 0.02, -0.10, -0.12), (0.10, 0.22, 0.10), "dark", knuckle, ch=0.025)


def arm_rampart():
    """Stratford-Aegis Rampart arm. Says: an armoured working arm. Khaki plate shells over a dark frame, a round olive
    pauldron, a drum elbow with a bare cap, a gauntlet cuff, a three-finger fist."""
    b = K.Build("arm-rampart", "arm", "Rampart arm", 61, "Stratford-Aegis", "armoured arm: plate shells, pauldron, gauntlet")
    N = nodes(b)
    K.lathe(b.body, (0, 0, -0.16), (0, 0, 0.30), [(0, 0.30), (0.45, 0.36), (0.8, 0.27), (1, 0.10)], 10, "secondary", OLIVE)   # pauldron
    V.cyl(b.body, (0, 0, -0.17), 0.31, 0.05, "z", 10, None, "dark", FRAME)
    up = N["Upper"]
    V.cyl(up, (0, 0, L / 2), 0.13, L, "z", 8, None, "dark", FRAME)
    S = K.mass({"z": (K.ngon(0, 0, 0.21, 0.23, 8, math.pi / 8), 0.30, 1.22)}, "shell", KHAKI, fillet=0.03)
    K.cut(S, [H.cut_rect((0, s * 0.23, 0.76), X_, Z_, s * Y_, 0.20, 0.52, depth=0.035, corner=0.03, slope=0.6, col=KHAKI_D) for s in (-1, 1)], bevel=0.012)
    b.add(S, up)
    for s in (-1, 1):
        piston(up, (s * 0.225, 0, 1.18), (s * 0.20, 0, 0.12), 0.045)
        V.bolt_row(up, (s * 0.212, 0.0, 0.40), (s * 0.212, 0.0, 1.10), 4, s * X_, 0.02, col=BARE)
    V.cyl(up, (0, 0, 1.30), 0.17, 0.10, "z", 8, None, "secondary", OLIVE_D)
    el = N["Elbow"]
    V.cyl(el, (0, 0, 0), 0.25, 0.46, "x", 10, [(0, 0.8), (0.12, 1.0), (0.88, 1.0), (1, 0.8)], "dark", FRAME)
    for s in (-1, 1):
        V.cyl(el, (s * 0.245, 0, 0), 0.13, 0.03, "x", 8, None, "trim", BARE)
    fo = N["Fore"]
    V.cyl(fo, (0, 0, L / 2), 0.115, L, "z", 8, None, "dark", FRAME)
    K.lathe(fo, (0, 0, 0.12), (0, 0, 1.16), [(0, 0.24), (0.14, 0.26), (0.30, 0.205), (1, 0.165)], 8, "primary", KHAKI)        # the gauntlet, wide at the wrist
    V.cyl(fo, (0, 0, 0.13), 0.275, 0.07, "z", 8, None, "secondary", OLIVE)
    V.cyl(fo, (0, 0, 0.62), 0.215, 0.05, "z", 8, None, "secondary", OLIVE)
    V.pipe_run(fo, [(0.0, 0.20, 1.25), (0.0, 0.26, 0.95), (0.0, 0.25, 0.50), (0.0, 0.22, 0.30)], 0.028, "dark", RUBBER, bend=0.10, n=5)
    fist(N["Hand"], FRAME, (0.33, 0.33, 0.28))
    b.socket("Shoulder", (0, 0, 0))
    b.socket("Grip", (0, 0, -2 * L), (0, -1, 0))
    return b


def arm_wildcat():
    """Novus-Lux Wildcat arm. Says: quick and precise. Slim slate tubes in white fairings, small ball joints, a lit strip
    down the forearm, a two-finger gripper hand."""
    b = K.Build("arm-wildcat", "arm", "Wildcat arm", 62, "Novus-Lux", "slim quick arm: fairings, ball joints, lit forearm")
    N = nodes(b)
    K.lathe(b.body, (0, 0, -0.14), (0, 0, 0.22), [(0, 0.20), (0.4, 0.27), (0.8, 0.22), (1, 0.08)], 10, "primary", WHITE)
    V.cyl(b.body, (0, 0, -0.15), 0.215, 0.04, "z", 10, None, "secondary", SLATE)
    up = N["Upper"]
    V.cyl(up, (0, 0, L / 2), 0.085, L, "z", 8, None, "secondary", SLATE_D)
    K.lathe(up, (0, 0, 0.26), (0, 0, 1.24), [(0, 0.12), (0.2, 0.17), (0.75, 0.185), (1, 0.13)], 8, "primary", WHITE)
    for z in (0.50, 0.98):
        V.cyl(up, (0, 0, z), 0.19, 0.035, "z", 8, None, "secondary", SLATE)
    for s in (-1, 1):
        V.bar(up, (s * 0.15, 0.10, 1.20), (s * 0.12, 0.08, 0.14), 0.022, "trim", NBARE, 5)
    el = N["Elbow"]
    K.lathe(el, (-0.20, 0, 0), (0.20, 0, 0), [(0, 0.10), (0.15, 0.185), (0.85, 0.185), (1, 0.10)], 10, "secondary", SLATE)
    V.cyl(el, (0, 0, 0), 0.195, 0.06, "x", 10, None, "trim", NBARE)
    fo = N["Fore"]
    V.cyl(fo, (0, 0, L / 2), 0.075, L, "z", 8, None, "secondary", SLATE_D)
    K.lathe(fo, (0, 0, 0.16), (0, 0, 1.20), [(0, 0.15), (0.25, 0.175), (1, 0.115)], 8, "primary", WHITE)
    V.cyl(fo, (0, 0, 0.15), 0.165, 0.05, "z", 8, None, "dark", NAVY)
    for a in range(2):
        n = Vector((math.cos(a * math.pi), math.sin(a * math.pi), 0))
        V.surf_blk(b.node_glow("Fore"), Vector((0, 0, 0.62)) + n * 0.158, Z_, n.cross(Z_), n, 0.52, 0.03, 0.01, "glow", TEAL, flag=V.NOBAKE)
    hd = N["Hand"]
    B(hd, (0, 0.03, 0), (0.24, 0.20, 0.22), "dark", NAVY, ch=0.04)
    V.cyl(hd, (0, 0.03, 0), 0.10, 0.27, "x", 8, None, "trim", NBARE)
    for s in (-1, 1):
        B(hd, (s * 0.10, -0.15, 0.0), (0.06, 0.20, 0.16), "secondary", SLATE, ch=0.02)
        B(hd, (s * 0.075, -0.28, 0.0), (0.05, 0.12, 0.12), "primary", WHITE, ch=0.02)
    b.socket("Shoulder", (0, 0, 0))
    b.socket("Grip", (0, 0, -2 * L), (0, -1, 0))
    return b


def arm_loader():
    """Suzaku Loader arm. Says: it lifts and tears. A box girder upper arm with exposed rams both sides, a big drum
    elbow, a heavy forearm with hazard bands at the wrist, a broad pincer hand."""
    b = K.Build("arm-loader", "arm", "Loader arm", 63, "Suzaku Dynamics", "heavy lifter: girder, exposed rams, pincer hand")
    N = nodes(b)
    B(b.body, (0, 0, 0.04), (0.62, 0.56, 0.40), "secondary", OLIVE, ch=0.09)
    V.cyl(b.body, (0, 0, 0.0), 0.20, 0.70, "x", 8, None, "dark", FRAME)
    up = N["Upper"]
    S = K.mass({"z": (K.ngon(0, 0, 0.20, 0.24, 4, math.pi / 4), 0.16, 1.30)}, "girder", OLIVE, fillet=0.025)
    K.cut(S, [H.cut_rect((0, s * 0.17, z), X_, Z_, s * Y_, 0.16, 0.26, depth=0.05, corner=0.05, slope=0.4, col=FRAME)
              for s in (-1, 1) for z in (0.46, 0.80, 1.14)], bevel=0.012)
    b.add(S, up)
    V.cyl(up, (0, 0, L / 2), 0.11, L, "z", 6, None, "dark", FRAME)
    for s in (-1, 1):
        piston(up, (s * 0.24, 0, 1.26), (s * 0.24, 0, 0.06), 0.065)
        V.cyl(up, (s * 0.24, 0, 1.26), 0.08, 0.10, "y", 6, None, "trim", BARE)
    el = N["Elbow"]
    V.cyl(el, (0, 0, 0), 0.30, 0.56, "x", 10, [(0, 0.85), (0.1, 1.0), (0.9, 1.0), (1, 0.85)], "dark", FRAME)
    V.cyl(el, (0, 0, 0), 0.31, 0.16, "x", 10, None, "secondary", OLIVE_D)
    for s in (-1, 1):
        V.cyl(el, (s * 0.295, 0, 0), 0.12, 0.03, "x", 6, None, "trim", BARE)
    fo = N["Fore"]
    V.cyl(fo, (0, 0, L / 2), 0.13, L, "z", 6, None, "dark", FRAME)
    S = K.mass({"z": (K.ngon(0, 0, 0.25, 0.25, 8, math.pi / 8), 0.14, 1.12)}, "fore", KHAKI, fillet=0.03)
    b.add(S, fo)
    for z, c in ((0.20, HAZARD), (0.29, FRAME), (0.38, HAZARD)):
        V.cyl(fo, (0, 0, z), 0.262, 0.07, "z", 8, None, "trim", c, phase=math.pi / 8)
    V.cyl(fo, (0, 0, 1.10), 0.20, 0.10, "z", 8, None, "secondary", OLIVE_D)
    hd = N["Hand"]
    B(hd, (0, 0.04, 0), (0.44, 0.24, 0.34), "dark", FRAME, ch=0.05)
    for s in (-1, 1):                                             # the pincer's two jaws
        B(hd, (s * 0.17, -0.18, 0.0), (0.12, 0.26, 0.28), "secondary", OLIVE_D, ch=0.03)
        B(hd, (s * 0.12, -0.36, 0.0), (0.09, 0.16, 0.22), "trim", BARE, ch=0.03)
        V.cyl(hd, (s * 0.17, -0.06, 0.0), 0.07, 0.30, "z", 6, None, "trim", BARE)
    b.socket("Shoulder", (0, 0, 0))
    b.socket("Grip", (0, 0, -2 * L), (0, -1, 0))
    return b


ARMS = [arm_rampart, arm_wildcat, arm_loader]

if __name__ == "__main__":
    a = K.parse_args()
    for fn in ARMS:
        b = fn()
        if a.only and b.id != a.only:
            continue
        K.write(b, a.out)
        if a.sheet:
            K.sheet(os.path.join(a.sheet, b.id), views=[("front34", 150, 15, 11.0)], res=(360, 620))
    H.report()
