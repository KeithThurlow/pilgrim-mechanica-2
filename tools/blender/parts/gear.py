"""Shoulder gear (the hull-top mounts, keys 1 and 2): the feeds and power that were boxes, and the summoner's rack and
hive, which had no model at all. docs/asset-pipeline.md batch 5; item bases in src/items/bases.ts.

    node tools/blender/run.mjs tools/blender/parts/gear.py -- --out public/models/parts [--only sh-hive] [--sheet <dir>]

Frame: the origin is the shoulder mount (the base sits on the hull top): x across, -y the front (the gun is below and
ahead), z up. The same model sits on both shoulders, so each is built near symmetric. Envelope, the stand-ins':
x +-0.48, y -0.8..0.5, z -0.3..1.0. Budget 2,000 triangles (docs/asset-list.md, a shoulder weapon).
The lit faces are the lamp the arsenal drives (ready, running, cooling) for the feeds and the bank.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as K  # noqa: E402
from partkit import H, V, X_, Y_, Z_, Vector  # noqa: E402

KHAKI, KHAKI_D, OLIVE, OLIVE_D = (0.63, 0.57, 0.42), (0.49, 0.45, 0.33), (0.42, 0.43, 0.30), (0.33, 0.34, 0.24)
FRAME, BARE, RUBBER = (0.25, 0.25, 0.205), (0.58, 0.57, 0.52), (0.17, 0.165, 0.155)
HAZARD, AMBER, HOT = (0.82, 0.52, 0.14), (1.0, 0.72, 0.30), (1.0, 0.42, 0.16)
RED, RED_D = (0.50, 0.17, 0.12), (0.36, 0.13, 0.10)
WHITE, SLATE, NAVY, NBARE = (0.79, 0.81, 0.86), (0.35, 0.41, 0.57), (0.20, 0.22, 0.31), (0.70, 0.72, 0.77)
BRASS, TEAL = (0.72, 0.56, 0.24), (0.35, 1.0, 0.92)
UP, FWD = Z_, -1 * Y_


def B(P, c, size, mat="primary", col=(0.5, 0.5, 0.5), **k):
    """A chamfered box by its centre (V.blk takes the bottom)."""
    return V.blk(P, c, size, mat, col, mid=True, **k)


def foot(b, col=FRAME, w=0.78, l=0.84):
    """The plate every shoulder item bolts to the hull top by."""
    B(b.body, (0, 0, 0.03), (w, l, 0.06), "dark", col, ch=0.015)
    for s in (-1, 1):
        V.bolt_row(b.body, (s * (w / 2 - 0.04), -l / 2 + 0.06, 0.06), (s * (w / 2 - 0.04), l / 2 - 0.06, 0.06), 3, UP, 0.02, col=BARE)


def chute(b, col, link, x=0.0):
    """The belt chute: out of the box's front, over and down to the gun. Segmented like a flexible feed, the belt's
    links showing along its top."""
    pts = [Vector((x, -0.36, 0.34)), Vector((x, -0.52, 0.30)), Vector((x, -0.66, 0.14)), Vector((x, -0.74, -0.06)), Vector((x, -0.76, -0.24))]
    for i in range(len(pts) - 1):
        a, c = pts[i], pts[i + 1]
        for k in range(2):
            p = a + (c - a) * ((k + 0.5) / 2)
            d = (c - a).normalized()
            n = Vector((0, d.z, -d.y))                       # the chute's outer face
            V.surf_blk(b.body, p - n * 0.05, X_, d, n, 0.20, (c - a).length / 2 - 0.012, 0.10, "trim", col, ch=0.012)
            V.surf_blk(b.body, p + n * 0.05, X_, d, n, 0.12, (c - a).length / 2 - 0.03, 0.022, "trim", link, ch=0.004)
    B(b.body, (x, -0.40, 0.34), (0.26, 0.10, 0.20), "dark", FRAME, ch=0.02)                    # the box's feed throat
    B(b.body, (x, -0.76, -0.26), (0.24, 0.14, 0.06), "dark", FRAME, ch=0.012)                  # the gun's feed collar


def sh_beltfeed():
    """Stratford-Aegis belt feed. Says: more rounds, faster. A big ribbed ammunition box with a hinged lid and latches,
    a brass belt on show through the side window, the chute to the gun and a round counter lamp."""
    b = K.Build("sh-beltfeed", "shoulder", "Belt feed", 51, "Stratford-Aegis", "more rounds faster: ammo box, belt window, chute")
    foot(b)
    S = K.mass({
        "x": ([(-0.40, 0.06), (0.42, 0.06), (0.42, 0.50), (0.34, 0.58), (-0.32, 0.58), (-0.40, 0.50)], -0.35, 0.35),
        "z": ([(-0.35, -0.40), (0.35, -0.40), (0.35, 0.42), (-0.35, 0.42)], 0.0, 0.7),
    }, "box", OLIVE, fillet=0.025)
    cuts = [H.cut_rect((s * 0.35, 0.02, 0.30), Y_, Z_, s * X_, 0.46, 0.20, depth=0.05, corner=0.03, slope=0.3, col=FRAME) for s in (-1, 1)]
    K.cut(S, cuts, bevel=0.01)
    b.add(S)
    # the belt in the windows: brass rounds side by side
    for s in (-1, 1):
        for i in range(7):
            V.cyl(b.body, (s * 0.315, -0.17 + i * 0.065, 0.30), 0.026, 0.17, "z", 6, None, "trim", BRASS)
    # the lid: a khaki cap with ribs, a hinge at the rear, latches at the front
    B(b.body, (0, 0.01, 0.60), (0.74, 0.86, 0.07), "secondary", KHAKI, ch=0.02)
    for y in (-0.24, -0.08, 0.08, 0.24):
        B(b.body, (0, y, 0.645), (0.60, 0.07, 0.03), "secondary", KHAKI_D, ch=0.01)
    V.cyl(b.body, (0, 0.44, 0.585), 0.03, 0.56, "x", 6, None, "trim", BARE)
    for s in (-1, 1):
        B(b.body, (s * 0.24, -0.425, 0.53), (0.09, 0.03, 0.14), "trim", BARE, ch=0.008)
        V.surf_blk(b.body, (s * 0.372, 0.30, 0.44), Y_, Z_, s * X_, 0.12, 0.10, 0.006, "trim", HAZARD)
    for s in (-1, 1):                                                                           # carry handles
        V.pipe_run(b.body, [(s * 0.37, -0.12, 0.50), (s * 0.44, -0.12, 0.50), (s * 0.44, 0.12, 0.50), (s * 0.37, 0.12, 0.50)], 0.016, "dark", FRAME, bend=0.03, n=5)
    chute(b, OLIVE_D, BRASS)
    b.lamp((0.26, -0.405, 0.50), (0.12, 0.06), FWD, HOT)
    b.lamp((0.26, -0.33, 0.636), (0.12, 0.06), UP, HOT)
    b.socket("Mount", (0, 0, 0))
    b.socket("FeedOut", (0, -0.76, -0.28), (0, 0, -1))
    return b


def sh_incendiary():
    """Suzaku incendiary feed. Says: the rounds come out burning. The belt box in dark red with a hazard band, a fuel
    tank strapped across the top, an injector line down to the chute and a pilot light at the throat."""
    b = K.Build("sh-incendiary", "shoulder", "Incendiary feed", 52, "Suzaku Dynamics", "burning rounds: red belt box, fuel tank, injector")
    foot(b)
    S = K.mass({
        "x": ([(-0.40, 0.06), (0.42, 0.06), (0.42, 0.44), (0.36, 0.50), (-0.34, 0.50), (-0.40, 0.44)], -0.35, 0.35),
        "z": ([(-0.35, -0.40), (0.35, -0.40), (0.35, 0.42), (-0.35, 0.42)], 0.0, 0.7),
    }, "box", RED, fillet=0.025)
    b.add(S)
    B(b.body, (0, -0.10, 0.36), (0.72, 0.16, 0.10), "trim", HAZARD, ch=0.008)                   # the hazard band
    for s in (-1, 1):
        V.louvres(b.body, (s * 0.35, 0.16, 0.24), Y_, Z_, s * X_, 0.34, 0.20, 4, "dark", RED_D, tilt=0.5, t=0.018)
    # the fuel tank across the top on two saddles, strapped, a filler cap and a gauge
    for x in (-0.20, 0.20):
        B(b.body, (x, 0.10, 0.53), (0.07, 0.34, 0.08), "dark", FRAME, ch=0.012)
    K.lathe(b.body, (-0.40, 0.10, 0.72), (0.40, 0.10, 0.72), [(0, 0.08), (0.06, 0.17), (0.94, 0.17), (1.0, 0.08)], 10, "secondary", KHAKI)
    for x in (-0.20, 0.20):
        V.cyl(b.body, (x, 0.10, 0.72), 0.178, 0.045, "x", 10, None, "dark", FRAME)
    V.cyl(b.body, (0.0, 0.10, 0.90), 0.045, 0.05, "z", 6, None, "trim", BARE)
    V.cyl(b.body, (-0.42, 0.10, 0.72), 0.06, 0.03, "x", 8, None, "trim", BARE)
    # the injector: from the tank's end forward and down into the chute's throat
    V.pipe_run(b.body, [(0.41, 0.10, 0.72), (0.46, 0.10, 0.72), (0.46, -0.30, 0.60), (0.20, -0.46, 0.44), (0.12, -0.46, 0.36)], 0.028, "trim", BRASS,
               bend=0.08, n=6, clamps=2, clamp_col=FRAME)
    chute(b, RED_D, HOT)
    V.cyl(b.body, (0.0, -0.47, 0.46), 0.05, 0.06, "y", 6, None, "dark", FRAME)                 # the pilot light's hood
    b.lamp((0.0, -0.50, 0.46), 0.036, FWD, HOT)
    b.lamp((-0.24, -0.33, 0.51), (0.12, 0.06), UP, HOT)
    b.socket("Mount", (0, 0, 0))
    b.socket("FeedOut", (0, -0.76, -0.28), (0, 0, -1))
    return b


def sh_capacitor():
    """Novus-Lux capacitor bank. Says: stored power, ready to dump. Three tall cells in a white cradle, each capped by
    a glowing ring, a bus bar across their heads, cooling fins behind and two heavy cables down into the hull."""
    b = K.Build("sh-capacitor", "shoulder", "Capacitor bank", 53, "Novus-Lux", "stored power: three cells, bus bar, fins, cables")
    foot(b, NAVY, 0.84, 0.80)
    S = K.mass({
        "x": ([(-0.36, 0.06), (0.36, 0.06), (0.36, 0.36), (0.26, 0.46), (-0.26, 0.46), (-0.36, 0.36)], -0.42, 0.42),
        "z": ([(-0.42, -0.30), (-0.34, -0.38), (0.34, -0.38), (0.42, -0.30), (0.42, 0.38), (-0.42, 0.38)], 0.0, 0.6),
    }, "cradle", WHITE, fillet=0.03)
    K.cut(S, [H.cut_rect((0, -0.38, 0.22), X_, Z_, FWD, 0.56, 0.16, depth=0.03, corner=0.03, slope=0.4, col=NAVY)], bevel=0.01)
    b.add(S)
    for i, x in enumerate((-0.26, 0.0, 0.26)):
        K.lathe(b.body, (x, -0.04, 0.42), (x, -0.04, 0.94), [(0, 0.125), (0.10, 0.115), (0.72, 0.115), (0.76, 0.125), (0.90, 0.125), (1.0, 0.07)], 10,
                "secondary", SLATE)
        V.cyl(b.body, (x, -0.04, 0.60), 0.122, 0.04, "z", 10, None, "trim", NBARE)
        V.cyl(b.body, (x, -0.04, 0.965), 0.045, 0.05, "z", 6, None, "trim", BRASS)             # the terminal
        b.lamp((x, -0.04, 0.925), 0.10, UP, TEAL)
        b.lamp((x, -0.158, 0.66), (0.07, 0.16), FWD, TEAL)
    B(b.body, (0, -0.04, 1.0), (0.66, 0.07, 0.035), "trim", BRASS, ch=0.008)                    # the bus bar
    # cooling fins behind the cells
    for k in range(6):
        B(b.body, (-0.30 + k * 0.12, 0.26, 0.64), (0.03, 0.22, 0.38), "dark", NAVY, ch=0.006)
    B(b.body, (0, 0.26, 0.47), (0.72, 0.24, 0.06), "dark", NAVY, ch=0.01)
    # the cables down into the hull
    for s in (-1, 1):
        V.pipe_run(b.body, [(s * 0.30, -0.04, 1.0), (s * 0.44, -0.04, 1.0), (s * 0.46, 0.10, 0.50), (s * 0.44, 0.30, 0.10), (s * 0.36, 0.42, -0.10)], 0.035,
                   "dark", RUBBER, bend=0.10, n=6, clamps=2, clamp_col=NBARE)
    b.lamp((0, -0.385, 0.22), (0.40, 0.05), FWD, TEAL)
    b.socket("Mount", (0, 0, 0))
    return b


def sh_drones():
    """Novus-Lux drone rack. Says: drones live here. A sloped launch tray with four docking cells, a drone folded in
    each with its eye lit, charge rails between them, a comms mast and a status strip along the front lip."""
    b = K.Build("sh-drones", "shoulder", "Drone rack", 54, "Novus-Lux", "drones live here: launch tray, four docked drones, mast")
    foot(b, NAVY)
    S = K.mass({
        "x": ([(-0.42, 0.06), (0.40, 0.06), (0.40, 0.56), (0.30, 0.60), (-0.42, 0.34)], -0.42, 0.42),
        "z": ([(-0.42, -0.36), (-0.36, -0.42), (0.36, -0.42), (0.42, -0.36), (0.42, 0.40), (-0.42, 0.40)], 0.0, 0.7),
    }, "tray", WHITE, fillet=0.03)
    # the deck slopes up to the rear: its normal and the way up it
    up = Vector((0, 0.72, 0.26)).normalized()
    n = Vector((0, -0.26, 0.72)).normalized()
    mid = Vector((0, -0.04, 0.455))
    cells = [mid + X_ * (sx * 0.19) + up * (sy * 0.19) for sy in (-1, 1) for sx in (-1, 1)]
    K.cut(S, [H.cut_rect(c + n * 0.01, X_, up, n, 0.32, 0.32, depth=0.07, corner=0.05, slope=0.25, col=NAVY) for c in cells], bevel=0.01)
    b.add(S)
    for c in cells:
        # a drone lying in its cell, tipped to the deck
        P = b.body
        base = c - n * 0.035
        V.surf_blk(P, base, X_, up, n, 0.17, 0.22, 0.06, "secondary", SLATE, ch=0.02)
        V.surf_blk(P, base + up * 0.02, X_, up, n, 0.09, 0.11, 0.03, "dark", NAVY, off=0.06, ch=0.008)
        for sx in (-1, 1):
            for sy in (-1, 1):
                p = base + X_ * (sx * 0.105) + up * (sy * 0.085) + n * 0.02
                V.bar(P, p, p + n * 0.03, 0.048, "dark", FRAME, 8)
        b.lamp(base - up * 0.085 + n * 0.062, (0.07, 0.025), n, TEAL)
    # the charge rail between the rows, the side rails, the mast
    V.surf_blk(b.body, mid, X_, up, n, 0.78, 0.04, 0.03, "trim", NBARE, ch=0.008)
    for s in (-1, 1):
        V.bar(b.body, mid + X_ * (s * 0.40) - up * 0.40 + n * 0.05, mid + X_ * (s * 0.40) + up * 0.40 + n * 0.05, 0.018, "trim", NBARE, 5)
    V.bar(b.body, (0.33, 0.36, 0.56), (0.33, 0.40, 0.98), 0.014, "trim", NBARE, 5, r2=0.006)
    V.cyl(b.body, (0.33, 0.365, 0.60), 0.04, 0.06, "z", 6, None, "dark", NAVY)
    B(b.body, (-0.24, 0.37, 0.60), (0.22, 0.10, 0.10), "secondary", SLATE, ch=0.02)             # the link box
    b.lamp((0, -0.425, 0.24), (0.50, 0.045), FWD, TEAL)
    b.socket("Mount", (0, 0, 0))
    b.socket("Launch", tuple(mid + n * 0.1), tuple(n))
    return b


def sh_hive():
    """Suzaku swarm hive. Says: a nest of small machines. A fat ribbed drum on a cradle, its top and flanks pocked with
    hexagonal cells glowing amber inside, two scrappers half out of their cells, a feed hopper for scrap at the rear."""
    b = K.Build("sh-hive", "shoulder", "Swarm hive", 55, "Suzaku Dynamics", "a nest of small machines: hex cells, scrappers crawling out")
    foot(b)
    for y in (-0.24, 0.24):
        B(b.body, (0, y, 0.14), (0.66, 0.10, 0.18), "dark", FRAME, ch=0.02)                     # the cradle
    cz = 0.52
    K.lathe(b.body, (0, -0.40, cz), (0, 0.40, cz), [(0, 0.24), (0.07, 0.36), (0.93, 0.36), (1.0, 0.24)], 12, "primary", OLIVE)
    for y in (-0.30, 0.0, 0.30):
        V.cyl(b.body, (0, y, cz), 0.372, 0.05, "y", 12, None, "trim", OLIVE_D)
    # the cells: hex sockets round the drum's upper half, in two staggered rows
    k = 0
    for row, y in enumerate((-0.15, 0.15)):
        for i in range(5):
            a = math.radians(-64 + i * 32 + (16 if row else 0))
            if row and i == 4:
                continue
            out = Vector((math.sin(a), 0, math.cos(a)))
            c = Vector((0, y, cz)) + out * 0.35
            V.bar(b.body, c - out * 0.02, c + out * 0.045, 0.085, "dark", FRAME, 6)
            crawler = k in (2, 6)
            if crawler:
                # a scrapper half out: a body, a red eye, two forelegs over the rim
                V.bar(b.body, c + out * 0.03, c + out * 0.13, 0.055, "secondary", KHAKI_D, 6, r2=0.035)
                side = Vector((out.z, 0, -out.x))
                for s in (-1, 1):
                    V.bar(b.body, c + out * 0.10 + side * (s * 0.03), c + out * 0.06 + side * (s * 0.11), 0.012, "dark", FRAME, 4)
                b.lamp(c + out * 0.132, 0.022, out, HOT)
            else:
                b.lamp(c + out * 0.047, 0.058, out, AMBER)
            k += 1
    # the front cap: a hex hatch and its lamp; the scrap hopper at the rear
    V.cyl(b.body, (0, -0.415, cz), 0.17, 0.05, "y", 6, None, "secondary", KHAKI)
    V.cyl(b.body, (0, -0.445, cz), 0.10, 0.02, "y", 6, None, "dark", FRAME)
    b.lamp((0, -0.456, cz), 0.06, FWD, AMBER)
    B(b.body, (0, 0.50, cz + 0.10), (0.36, 0.20, 0.30), "secondary", KHAKI, ch=0.03, batter=-0.2)
    B(b.body, (0, 0.50, cz + 0.26), (0.30, 0.14, 0.03), "dark", FRAME, ch=0.006)
    V.surf_blk(b.body, (0, 0.60, cz + 0.08), X_, Z_, Y_, 0.20, 0.10, 0.006, "trim", HAZARD)
    for s in (-1, 1):
        V.pipe_run(b.body, [(s * 0.22, 0.38, 0.30), (s * 0.30, 0.44, 0.16), (s * 0.26, 0.40, 0.06)], 0.03, "dark", RUBBER, bend=0.06, n=5)
    b.socket("Mount", (0, 0, 0))
    b.socket("Launch", (0, 0, cz + 0.45), (0, 0, 1))
    return b


GEAR = [sh_beltfeed, sh_incendiary, sh_capacitor, sh_drones, sh_hive]

if __name__ == "__main__":
    a = K.parse_args()
    for fn in GEAR:
        b = fn()
        if a.only and b.id != a.only:
            continue
        K.write(b, a.out)
        if a.sheet:
            K.sheet(os.path.join(a.sheet, b.id), views=[("front34", 215, 35, 5.5)], res=(420, 420))
    H.report()
