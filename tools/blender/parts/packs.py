"""Power packs (pack mount, high on the back): five items, each built to say what it does from the game camera, which
looks down on the mech's back all game. docs/asset-pipeline.md batch 1; item bases in src/items/bases.ts.

    node tools/blender/run.mjs tools/blender/parts/packs.py -- --out public/models/parts [--only pack-medic] [--sheet <dir>]

Frame: the pack's origin is the middle of the old stand-in box (src/mech/rampart.ts powerPack): x across (+ the mech's
left), -y toward the hull, +y the rear face, z up. Envelope: x +-0.80, y -0.38..+0.55, z -0.35..+0.68 (a back weapon stands
on z 0.70). Budget 2,000 triangles (docs/asset-list.md).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as K  # noqa: E402
from partkit import H, V, X_, Y_, Z_, Vector  # noqa: E402

# Paint by maker (the Rampart family's values, tools/blender/mechs/studies/rampart/rampart_v4.py and the variants)
KHAKI, KHAKI_D, OLIVE, OLIVE_D = (0.63, 0.57, 0.42), (0.49, 0.45, 0.33), (0.42, 0.43, 0.30), (0.33, 0.34, 0.24)
FRAME, BARE, RUBBER = (0.25, 0.25, 0.205), (0.58, 0.57, 0.52), (0.17, 0.165, 0.155)
HAZARD, AMBER = (0.82, 0.52, 0.14), (1.0, 0.72, 0.30)


def housing(col, w=0.78, top=0.34, rear=0.46, name="housing"):
    """The armoured block every pack hangs its kit on: clipped in all three views, a sloped rear shoulder."""
    return K.mass({
        "x": ([(-0.38, -0.35), (rear - 0.16, -0.35), (rear, -0.19), (rear, top - 0.18), (rear - 0.12, top), (-0.38, top)], -w, w),
        "y": ([(-w + 0.08, -0.35), (w - 0.08, -0.35), (w, -0.22), (w, top - 0.14), (w - 0.12, top), (-w + 0.12, top), (-w, top - 0.14),
               (-w, -0.22)], -0.5, 0.7),
        "z": ([(-w, -0.38), (w, -0.38), (w, rear - 0.10), (w - 0.12, rear), (-w + 0.12, rear), (-w, rear - 0.10)], -0.5, 1.0),
    }, name, col, fillet=0.035)


def hull_hoses(b, x=0.56, r=0.045, col=RUBBER):
    """Two feed hoses from the pack's lower sides forward into the hull: what it powers."""
    for s in (-1, 1):
        V.pipe_run(b.body, [(s * x, 0.10, -0.26), (s * (x + 0.20), 0.02, -0.30), (s * (x + 0.20), -0.30, -0.32), (s * (x - 0.02), -0.46, -0.30)],
                   r, "dark", col, bend=0.10, n=6, clamps=2, clamp_col=BARE)


def cell(P, c, r, length, body, cap=FRAME, band=BARE, n=12, axis="x"):
    """A power cell: a barrel with dark end collars and two bright bands."""
    V.cyl(P, c, r, length, axis, n, None, "secondary", body)
    for t in (-1, 1):
        off = Vector((t * (length / 2 + 0.02), 0, 0)) if axis == "x" else Vector((0, 0, t * (length / 2 + 0.02)))
        V.cyl(P, Vector(c) + off, r * 1.08, 0.07, axis, n, None, "dark", cap)
        off2 = off * 0.42
        V.cyl(P, Vector(c) + off2, r * 1.04, 0.035, axis, n, None, "trim", band)


def pack_rampart():
    """Stratford-Aegis standard pack. Says: a generator. Two fat cells in a cradle under a roll bar, a louvred radiator
    across the rear, twin exhaust stacks, hoses into the hull."""
    b = K.Build("pack-standin", "pack", "Rampart power pack", 21, "Stratford-Aegis", "generator: cells, radiator, exhaust")
    S = housing(KHAKI)
    K.cut(S, [
        H.cut_rect((0, 0.46, -0.03), X_, Z_, Y_, 1.04, 0.30, depth=0.07, corner=0.04, slope=0.5, col=FRAME),          # radiator bay
        H.cut_rect((0, -0.02, 0.34), X_, Y_, Z_, 1.30, 0.50, depth=0.10, corner=0.05, slope=0.5, col=KHAKI_D),        # cell cradle
    ] + [H.cut_rect((s * 0.78, 0.05, -0.04), Y_, Z_, s * X_, 0.46, 0.22, depth=0.03, corner=0.04, slope=0.8, col=KHAKI_D)
         for s in (-1, 1)], bevel=0.014)
    b.add(S)
    V.louvres(b.body, (0, 0.40, -0.03), X_, Z_, Y_, 0.96, 0.24, 6, "dark", (0.20, 0.20, 0.18), tilt=0.55, t=0.02)
    for s in (-1, 1):
        cell(b.body, (s * 0.37, -0.02, 0.38), 0.165, 0.50, OLIVE)
        V.bolt_row(b.body, (s * 0.795, -0.14, -0.04), (s * 0.795, 0.24, -0.04), 4, s * X_, 0.022, col=BARE)
        H.lifting_eye(b.body, (s * 0.60, 0.30, 0.34), Z_, r=0.055, t=0.02, col=BARE)
    # the junction block between the cells, and the roll bar over them
    V.blk(b.body, (0, -0.02, 0.26), (0.20, 0.42, 0.24), "primary", KHAKI, ch=0.03)
    V.pipe_run(b.body, [(-0.70, -0.30, 0.30), (-0.70, -0.30, 0.62), (0.70, -0.30, 0.62), (0.70, -0.30, 0.30)], 0.028, "trim", OLIVE_D, bend=0.10)
    # exhaust stacks, rear left
    for i in range(2):
        V.cyl(b.body, (0.55 - i * 0.16, 0.30, 0.46), 0.05, 0.30, "z", 8, [(0, 1.0), (0.8, 1.0), (1.0, 1.2)], "dark", (0.19, 0.18, 0.17))
    V.surf_blk(b.body, (-0.40, 0.385, 0.20), X_, Vector((0, -0.55, 0.83)), Vector((0, 0.83, 0.55)), 0.22, 0.09, 0.012, "trim", HAZARD)
    hull_hoses(b)
    b.lamp((-0.62, 0.468, 0.02), (0.05, 0.10), Y_, AMBER)
    b.socket("Mount", (0, -0.38, 0))
    b.socket("Top", (0, 0, 0.70))
    return b

# Novus-Lux (the railgun variant's paint) and the glows
WHITE, SLATE, SLATE_D, NAVY, NBARE = (0.79, 0.81, 0.86), (0.35, 0.41, 0.57), (0.27, 0.31, 0.45), (0.20, 0.22, 0.31), (0.70, 0.72, 0.77)
TEAL, GREEN, MEDWHITE, HOT = (0.35, 1.0, 0.92), (0.30, 0.95, 0.45), (0.90, 0.90, 0.86), (1.0, 0.55, 0.18)
MED_GREEN = (0.20, 0.55, 0.30)


def pack_capacitor():
    """Novus-Lux capacitor pack. Says: stored charge. Six capacitors standing in two rows with lit rings, bus bars across
    their heads, cooling fins down both flanks."""
    b = K.Build("pack-capacitor", "pack", "Capacitor pack", 22, "Novus-Lux", "stored charge: six lit capacitors, bus bars")
    S = housing(WHITE, top=0.08)
    K.cut(S, [H.cut_rect((0, 0.46, -0.14), X_, Z_, Y_, 1.10, 0.14, depth=0.05, corner=0.03, slope=0.5, col=NAVY)], bevel=0.014)
    b.add(S)
    b.lamp((0, 0.412, -0.14), (0.96, 0.05), Y_, TEAL)
    for iy, y in enumerate((-0.17, 0.17)):
        for ix in (-1, 0, 1):
            x = ix * 0.40
            V.cyl(b.body, (x, y, 0.11), 0.17, 0.06, "z", 12, None, "dark", NAVY)
            V.cyl(b.body, (x, y, 0.33), 0.145, 0.40, "z", 12, None, "secondary", SLATE)
            V.cyl(b.body, (x, y, 0.565), 0.10, 0.07, "z", 12, [(0, 1.3), (0.5, 1.0), (1, 0.8)], "trim", NBARE)
            fs = V.cyl(b.glow, (x, y, 0.45), 0.152, 0.045, "z", 12, None, "glow", TEAL)
            for f in fs:
                f[b.glow.flag] = V.NOBAKE
        # a bus bar across each row's heads
        V.blk(b.body, (0, y, 0.585), (1.02, 0.07, 0.035), "trim", (0.72, 0.56, 0.36), ch=0.008)
    V.blk(b.body, (0, 0, 0.622), (0.09, 0.42, 0.03), "trim", (0.72, 0.56, 0.36), ch=0.008)
    for s in (-1, 1):
        for i in range(5):
            V.surf_blk(b.body, (s * 0.78, -0.24 + i * 0.13, -0.10), Y_, Z_, s * X_, 0.035, 0.36, 0.07, "trim", SLATE_D)
    hull_hoses(b, col=NAVY)
    b.socket("Mount", (0, -0.38, 0))
    b.socket("Top", (0, 0, 0.70))
    return b


def pack_medic():
    """Stratford-Aegis medic pack. Says: repair. A white rear door with a green cross, two repair beacons racked on top
    ready to throw, a nanite tank with a lit gauge, a whip aerial."""
    b = K.Build("pack-medic", "pack", "Medic pack", 23, "Stratford-Aegis", "repair: white door, green cross, racked beacons")
    S = housing(KHAKI)
    K.cut(S, [H.cut_rect((0, 0.46, -0.02), X_, Z_, Y_, 0.86, 0.36, depth=0.03, corner=0.05, slope=0.6, col=KHAKI_D)], bevel=0.014)
    b.add(S)
    V.surf_blk(b.body, (0, 0.43, -0.02), X_, Z_, Y_, 0.78, 0.30, 0.03, "secondary", MEDWHITE, ch=0.012)
    V.surf_blk(b.body, (0, 0.46, -0.02), X_, Z_, Y_, 0.085, 0.24, 0.012, "trim", MED_GREEN)
    V.surf_blk(b.body, (0, 0.46, -0.02), X_, Z_, Y_, 0.24, 0.085, 0.013, "trim", MED_GREEN)
    # the beacon rack: two canisters lying fore and aft in saddles, lit caps to the rear
    for s in (-1, 1):
        x = s * 0.30
        for y in (-0.20, 0.14):
            V.blk(b.body, (x, y, 0.33), (0.34, 0.06, 0.12), "dark", FRAME, ch=0.02)
        V.cyl(b.body, (x, -0.03, 0.50), 0.13, 0.56, "y", 12, None, "secondary", MEDWHITE)
        V.cyl(b.body, (x, -0.03, 0.50), 0.136, 0.10, "y", 12, None, "trim", MED_GREEN)
        V.cyl(b.body, (x, -0.33, 0.50), 0.10, 0.06, "y", 12, [(0, 0.6), (1, 1.0)], "dark", FRAME)
        fs = V.cyl(b.glow, (x, 0.27, 0.50), 0.105, 0.04, "y", 12, [(0, 1.0), (1, 0.7)], "glow", GREEN)
        for f in fs:
            f[b.glow.flag] = V.NOBAKE
        V.bolt_row(b.body, (s * 0.795, -0.14, -0.04), (s * 0.795, 0.24, -0.04), 4, s * X_, 0.022, col=BARE)
    # nanite tank on the left flank, a lit gauge down it; the aerial on the right
    V.cyl(b.body, (0.80, 0.10, 0.02), 0.11, 0.46, "z", 10, [(0, 0.8), (0.12, 1.0), (0.88, 1.0), (1, 0.8)], "secondary", OLIVE)
    b.lamp((0.915, 0.10, 0.02), (0.045, 0.26), X_, GREEN)
    V.bar(b.body, (-0.68, 0.28, 0.34), (-0.70, 0.30, 0.68), 0.016, "dark", FRAME, 5, r2=0.008)
    V.cyl(b.body, (-0.68, 0.28, 0.36), 0.045, 0.05, "z", 8, None, "dark", FRAME)
    hull_hoses(b)
    b.socket("Mount", (0, -0.38, 0))
    b.socket("Top", (0, 0, 0.70))
    return b


def pack_replica():
    """Replica bay (Novus-Lux and Suzaku). Says: things are built in here and come out. The biggest pack: a slatted bay door
    across the rear between hazard jambs with a lit lintel, two feed hoppers on the roof, a gantry rail over them."""
    b = K.Build("pack-replica", "pack", "Replica bay", 24, "Novus-Lux", "fabricator: slatted bay door, hoppers, gantry")
    S = housing(WHITE, w=0.80, top=0.44, rear=0.54)
    K.cut(S, [H.cut_rect((0, 0.54, -0.02), X_, Z_, Y_, 1.06, 0.50, depth=0.09, corner=0.03, slope=0.35, col=NAVY)], bevel=0.016)
    b.add(S)
    # the door: slats lying flat, a pull bar at the bottom
    for i in range(7):
        V.surf_blk(b.body, (0, 0.455, -0.215 + i * 0.065), X_, Z_, Y_, 0.98, 0.055, 0.022, "secondary", SLATE if i % 2 else SLATE_D)
    V.surf_blk(b.body, (0, 0.47, -0.245), X_, Z_, Y_, 0.50, 0.03, 0.03, "trim", NBARE)
    for s in (-1, 1):
        for i in range(4):   # hazard jambs
            V.surf_blk(b.body, (s * 0.63, 0.54, -0.20 + i * 0.12), X_, Z_, Y_, 0.085, 0.06, 0.008, "trim", HAZARD if i % 2 == 0 else NAVY)
        # a hopper on the roof each side: wide mouth, narrow throat
        K.lathe(b.body, (s * 0.40, -0.10, 0.44), (s * 0.40, -0.10, 0.66), [(0, 0.10), (0.35, 0.12), (1.0, 0.20)], 8, "secondary", SLATE)
        K.lathe(b.body, (s * 0.40, -0.10, 0.661), (s * 0.40, -0.10, 0.666), [(0, 0.165), (1, 0.165)], 8, "dark", (0.12, 0.13, 0.18))   # the mouth
        V.bar(b.body, (s * 0.72, -0.30, 0.44), (s * 0.72, -0.30, 0.64), 0.025, "trim", NBARE, 6)
        V.bar(b.body, (s * 0.72, 0.30, 0.44), (s * 0.72, 0.30, 0.64), 0.025, "trim", NBARE, 6)
        V.bar(b.body, (s * 0.72, -0.32, 0.64), (s * 0.72, 0.32, 0.64), 0.028, "trim", NBARE, 6)
    # the gantry beam and its head, parked over the door
    V.blk(b.body, (0, 0.22, 0.615), (1.50, 0.07, 0.06), "trim", NBARE, ch=0.012)
    V.blk(b.body, (0.12, 0.22, 0.50), (0.16, 0.14, 0.12), "dark", NAVY, ch=0.02)
    b.lamp((0, 0.545, 0.285), (0.96, 0.04), Y_, AMBER)
    hull_hoses(b, col=NAVY)
    b.socket("Mount", (0, -0.38, 0))
    b.socket("Top", (0, 0, 0.70))
    b.socket("Bay", (0, 0.56, -0.02), (0, 1, 0))
    return b


def pack_booster():
    """Suzaku booster pack. Says: thrust. Two big bells pointing down and back with hot throats, a fuel tank slung across
    between intake scoops."""
    b = K.Build("pack-booster", "pack", "Booster pack", 25, "Suzaku Dynamics", "thrust: twin bells, fuel tank, intakes")
    S = housing(OLIVE, w=0.66, top=0.30, rear=0.34)
    K.cut(S, [H.cut_rect((0, 0.34, 0.02), X_, Z_, Y_, 0.60, 0.20, depth=0.04, corner=0.03, slope=0.5, col=FRAME)], bevel=0.014)
    b.add(S)
    V.louvres(b.body, (0, 0.30, 0.02), X_, Z_, Y_, 0.54, 0.16, 4, "dark", (0.20, 0.20, 0.18), tilt=0.5, t=0.02)
    aft = Vector((0, 0.80, -0.60)).normalized()
    for s in (-1, 1):
        root = Vector((s * 0.50, 0.16, -0.02))
        K.lathe(b.body, root - aft * 0.10, root + aft * 0.16, [(0, 0.15), (0.5, 0.17), (1, 0.12)], 12, "dark", FRAME)
        K.lathe(b.body, root + aft * 0.14, root + aft * 0.52, [(0, 0.11), (0.35, 0.17), (0.8, 0.235), (1, 0.25)], 12, "trim", (0.43, 0.42, 0.40))
        K.lathe(b.body, root + aft * 0.50, root + aft * 0.55, [(0, 0.255), (1, 0.262)], 12, "trim", (0.40, 0.43, 0.55))      # the heat-blued lip
        K.lathe(b.body, root + aft * 0.551, root + aft * 0.556, [(0, 0.235), (1, 0.235)], 12, "dark", (0.10, 0.10, 0.10))       # the throat's dark
        fs = K.lathe(b.glow, root + aft * 0.557, root + aft * 0.562, [(0, 0.135), (1, 0.135)], 12, "glow", HOT)
        for f in fs:
            f[b.glow.flag] = V.NOBAKE
        # intake scoop on the shoulder, mouth forward
        V.blk(b.body, (s * 0.46, -0.10, 0.30), (0.30, 0.46, 0.16), "primary", KHAKI, ch=0.035, tail=(0.10, 0.04))
        V.surf_blk(b.body, (s * 0.46, -0.33, 0.38), X_, Z_, -Y_, 0.22, 0.09, 0.01, "dark", (0.12, 0.12, 0.11))
    V.cyl(b.body, (0, -0.02, 0.44), 0.16, 0.56, "x", 12, [(0, 0.55), (0.14, 1.0), (0.86, 1.0), (1, 0.55)], "secondary", KHAKI)
    for t in (-0.17, 0.17):
        V.cyl(b.body, (t, -0.02, 0.44), 0.168, 0.04, "x", 12, None, "trim", BARE)
    V.blk(b.body, (0, -0.02, 0.28), (0.44, 0.24, 0.05), "dark", FRAME, ch=0.01)
    hull_hoses(b, x=0.44)
    b.socket("Mount", (0, -0.38, 0))
    b.socket("Top", (0, 0, 0.70))
    b.socket("Thrust_L", (0.50, 0.58, -0.33), tuple(aft))
    b.socket("Thrust_R", (-0.50, 0.58, -0.33), tuple(aft))
    return b


PACKS = [pack_rampart, pack_capacitor, pack_medic, pack_replica, pack_booster]

if __name__ == "__main__":
    a = K.parse_args()
    for fn in PACKS:
        b = fn()
        if a.only and b.id != a.only:
            continue
        K.write(b, a.out)
        if a.sheet:
            K.sheet(os.path.join(a.sheet, b.id))
    H.report()
