"""Waist kit (the waist mounts, low on the back either side of the spine): the three items that had no model.
docs/asset-pipeline.md batch 4; item bases in src/items/bases.ts. The ammo drums keep their converted model.

    node tools/blender/run.mjs tools/blender/parts/waist.py -- --out public/models/parts [--only waist-rack] [--sheet <dir>]

Frame: the origin is the waist socket (where the half drum hangs, src/mech/rampart.ts): x across (the same model hangs
on both sides, so each is built symmetric), +y the rear, z up. Envelope, the drum's: x +-0.47, y -0.05..0.75,
z -0.41..0.31. Budget 1,000 triangles a side (docs/asset-list.md).
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
WHITE, SLATE, NAVY, NBARE = (0.79, 0.81, 0.86), (0.35, 0.41, 0.57), (0.20, 0.22, 0.31), (0.70, 0.72, 0.77)
BRASS, TEAL = (0.72, 0.56, 0.24), (0.35, 1.0, 0.92)


def bracket(b, col=FRAME):
    """The plate every waist item bolts to the hull by."""
    V.blk(b.body, (0, 0.03, -0.04), (0.70, 0.07, 0.56), "dark", col, ch=0.02)
    for s in (-1, 1):
        V.bolt_row(b.body, (s * 0.30, 0.066, -0.26), (s * 0.30, 0.066, 0.18), 3, Y_, 0.02, col=BARE)


def waist_autoloader():
    """Novus-Lux autoloader. Says: it feeds the gun fast. A revolving cylinder of brass shells on show at the rear in a
    white housing, a rammer on top, a feed chute curving up and forward to the gun."""
    b = K.Build("waist-autoloader", "waist", "Autoloader", 41, "Novus-Lux", "fast feed: shell carousel, rammer, chute")
    bracket(b, NAVY)
    S = K.mass({
        "x": ([(0.06, -0.40), (0.56, -0.40), (0.68, -0.28), (0.68, 0.14), (0.54, 0.28), (0.06, 0.28)], -0.44, 0.44),
        "z": ([(-0.44, 0.06), (0.44, 0.06), (0.44, 0.60), (0.36, 0.68), (-0.36, 0.68), (-0.44, 0.60)], -0.5, 0.4),
    }, "housing", WHITE, fillet=0.03)
    K.cut(S, [H.cut_rect((0, 0.68, -0.07), X_, Z_, Y_, 0.62, 0.54, depth=0.10, corner=0.27, slope=0.3, col=NAVY)], bevel=0.012)
    b.add(S)
    # the carousel: a hub and six shells round it, their brass bases to the rear
    hub = Vector((0, 0.60, -0.07))
    V.cyl(b.body, hub, 0.075, 0.10, "y", 8, None, "trim", NBARE)
    for i in range(6):
        a = i * math.tau / 6 + 0.5
        c = hub + Vector((math.cos(a) * 0.17, 0.0, math.sin(a) * 0.17))
        V.cyl(b.body, c, 0.058, 0.12, "y", 8, None, "trim", BRASS)
        V.cyl(b.body, c + Vector((0, 0.062, 0)), 0.026, 0.01, "y", 6, None, "dark", (0.30, 0.24, 0.12))
    # the rammer on the roof and the chute to the gun
    V.blk(b.body, (0, 0.42, 0.33), (0.26, 0.34, 0.10), "secondary", SLATE, ch=0.025)
    V.cyl(b.body, (0, 0.63, 0.33), 0.035, 0.12, "y", 6, None, "trim", NBARE)
    V.pipe_run(b.body, [(0.26, 0.30, 0.26), (0.26, 0.30, 0.44), (0.26, 0.02, 0.50), (0.26, -0.12, 0.50)], 0.07, "secondary", SLATE,
               bend=0.12, n=6, clamps=2, clamp_col=NBARE)
    for s in (-1, 1):
        V.louvres(b.body, (s * 0.44, 0.36, -0.08), Y_, Z_, s * X_, 0.36, 0.22, 4, "dark", NAVY, tilt=0.5, t=0.018)
    b.lamp((-0.24, 0.585, 0.20), (0.10, 0.04), Y_, TEAL)
    b.socket("Mount", (0, 0, 0))
    b.socket("FeedOut", (0.26, -0.12, 0.50), (0, -1, 0))
    return b


def crate(P, c, size, col, strap=FRAME):
    """A cargo crate: a chamfered box, a lid line, corner cleats and a strap over it."""
    c = Vector(c)
    V.blk(P, c, size, "primary", col, ch=0.02)
    V.blk(P, c + Vector((0, 0, size[2] * 0.28)), (size[0] + 0.012, size[1] + 0.012, 0.022), "trim", V.shade(col, 0.72), ch=0.004)
    V.blk(P, c, (0.07, size[1] + 0.02, size[2] + 0.02), "dark", strap, ch=0.006)


def waist_rack():
    """Stratford-Aegis cargo rack. Says: it carries more. An open tube cage with two strapped crates and a jerrycan, a
    bedroll lashed on top: plainly cargo, plainly not armour."""
    b = K.Build("waist-rack", "waist", "Cargo rack", 42, "Stratford-Aegis", "carries more: tube cage, crates, jerrycan, roll")
    bracket(b)
    # the floor and the tube cage
    V.blk(b.body, (0, 0.38, -0.385), (0.86, 0.66, 0.03), "dark", FRAME, ch=0.008)
    for s in (-1, 1):
        V.pipe_run(b.body, [(s * 0.43, 0.07, -0.38), (s * 0.43, 0.07, 0.20), (s * 0.43, 0.70, 0.20), (s * 0.43, 0.70, -0.38)], 0.022, "trim",
                   OLIVE_D, bend=0.07, n=5)
    V.bar(b.body, (-0.43, 0.70, -0.08), (0.43, 0.70, -0.08), 0.02, "trim", OLIVE_D, 5)
    V.bar(b.body, (-0.43, 0.70, 0.19), (0.43, 0.70, 0.19), 0.02, "trim", OLIVE_D, 5)
    # the load
    crate(b.body, (-0.19, 0.39, -0.20), (0.42, 0.52, 0.32), KHAKI)
    crate(b.body, (-0.17, 0.36, 0.07), (0.38, 0.44, 0.20), OLIVE)
    V.blk(b.body, (0.24, 0.40, -0.14), (0.26, 0.46, 0.44), "secondary", (0.50, 0.25, 0.14), ch=0.045)          # the jerrycan
    V.blk(b.body, (0.24, 0.40, -0.14), (0.268, 0.30, 0.30), "secondary", (0.43, 0.21, 0.12), ch=0.02)
    V.cyl(b.body, (0.24, 0.26, 0.11), 0.04, 0.06, "z", 6, None, "dark", FRAME)
    V.bar(b.body, (0.16, 0.44, 0.115), (0.32, 0.44, 0.115), 0.016, "dark", FRAME, 5)
    V.cyl(b.body, (0.0, 0.40, 0.25), 0.085, 0.74, "x", 8, [(0, 0.8), (0.08, 1.0), (0.92, 1.0), (1, 0.8)], "secondary", (0.38, 0.36, 0.27))
    for t in (-0.22, 0.22):
        V.cyl(b.body, (t, 0.40, 0.25), 0.09, 0.03, "x", 8, None, "dark", FRAME)
    V.surf_blk(b.body, (-0.19, 0.655, -0.20), X_, Z_, Y_, 0.16, 0.10, 0.006, "trim", HAZARD)
    b.socket("Mount", (0, 0, 0))
    return b


def waist_kit():
    """Suzaku cutting kit. Says: it cuts wrecks. Two gas bottles standing side by side (one hazard orange, one bare
    steel) with valves and gauges, a hose reel on the rear, a cutting torch clipped across."""
    b = K.Build("waist-kit", "waist", "Cutting kit", 43, "Suzaku Dynamics", "cuts wrecks: gas bottles, hose reel, torch")
    bracket(b)
    V.blk(b.body, (0, 0.30, -0.375), (0.80, 0.48, 0.05), "dark", FRAME, ch=0.012)                              # the tray
    for s, col in ((-1, HAZARD), (1, (0.52, 0.55, 0.56))):
        x = s * 0.20
        K.lathe(b.body, (x, 0.26, -0.35), (x, 0.26, 0.24), [(0, 0.15), (0.05, 0.165), (0.80, 0.165), (0.93, 0.10), (1.0, 0.05)], 10,
                "secondary", col)
        V.cyl(b.body, (x, 0.26, 0.255), 0.035, 0.07, "z", 6, None, "trim", BRASS)                              # the valve
        V.cyl(b.body, (x + s * 0.06, 0.26, 0.262), 0.04, 0.02, "x", 8, None, "trim", BARE)                     # its gauge
        V.cyl(b.body, (x, 0.26, -0.10), 0.172, 0.05, "z", 10, None, "dark", FRAME)                             # the strap
    V.blk(b.body, (0, 0.10, 0.02), (0.72, 0.06, 0.07), "dark", FRAME, ch=0.01)
    # the hose reel on the rear and the hose up to the torch
    V.cyl(b.body, (0, 0.56, -0.16), 0.19, 0.035, "y", 10, None, "trim", OLIVE)
    V.cyl(b.body, (0, 0.62, -0.16), 0.15, 0.10, "y", 10, None, "dark", RUBBER)
    V.cyl(b.body, (0, 0.685, -0.16), 0.19, 0.035, "y", 10, None, "trim", OLIVE)
    V.cyl(b.body, (0, 0.71, -0.16), 0.05, 0.03, "y", 6, None, "trim", BARE)
    V.pipe_run(b.body, [(0.15, 0.62, -0.16), (0.36, 0.62, -0.10), (0.40, 0.56, 0.18), (0.30, 0.50, 0.30)], 0.02, "dark", RUBBER, bend=0.08, n=5)
    # the torch, clipped across the top rear
    V.bar(b.body, (0.32, 0.50, 0.30), (-0.22, 0.50, 0.30), 0.028, "trim", BARE, 6)
    V.cyl(b.body, (0.24, 0.50, 0.30), 0.042, 0.16, "x", 6, None, "dark", FRAME)                                # the grip
    V.bar(b.body, (-0.22, 0.50, 0.30), (-0.34, 0.56, 0.24), 0.02, "trim", BRASS, 5)                            # the nozzle
    V.blk(b.body, (0.0, 0.47, 0.25), (0.06, 0.06, 0.10), "dark", FRAME, ch=0.008)
    b.lamp((-0.345, 0.565, 0.235), (0.035, 0.035), Vector((-0.8, 0.5, -0.4)).normalized(), AMBER)
    b.socket("Mount", (0, 0, 0))
    b.socket("Torch", (-0.34, 0.56, 0.24), (-0.8, 0.5, -0.4))
    return b


WAIST = [waist_autoloader, waist_rack, waist_kit]

if __name__ == "__main__":
    a = K.parse_args()
    for fn in WAIST:
        b = fn()
        if a.only and b.id != a.only:
            continue
        K.write(b, a.out)
        if a.sheet:
            K.sheet(os.path.join(a.sheet, b.id))
    H.report()
