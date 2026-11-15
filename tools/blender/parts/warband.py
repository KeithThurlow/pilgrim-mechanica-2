"""War band vehicles (docs/asset-pipeline.md batch 8, asset-list V1): bodies for the raider vehicles the sim drives
(src/vehicles/car.ts), in place of the boxes in src/vehicles/carBody.ts. The technical first, as the trial.

    node tools/blender/run.mjs tools/blender/parts/warband.py -- --out public/models/vehicles [--only technical] [--sheet <dir>]

A vehicle is three or four meshes on the root: `Body` (everything in its own colours), `Paint` (the panels the game
paints: authored near white, multiplied by the vehicle's colour when loaded, so raiders are rust and escorts their own),
`Glow` (lamps) and `Wheel` (one wheel about its hub, its axle along x; the game draws it at every hub).

Frame: the origin is the sim's body centre (ride height above the ground); x across (+x the left), -y the front, z up.
Each body is built to its kind's default tuning (wheelbase, track, ride height, wheel radius in CAR_KINDS): the game
keeps the boxes when those sliders are moved off the defaults. The gun stays the game's (it turns): the post and ring
it stands on are here. Budget 12,000 triangles (docs/asset-list.md).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as K  # noqa: E402
from partkit import H, V, X_, Y_, Z_, Vector  # noqa: E402
from mathutils import Matrix  # noqa: E402

PAINT = (0.92, 0.92, 0.92)                      # multiplied by the vehicle's colour in the game
STEEL, DARK, RUST, TYRE = (0.42, 0.415, 0.40), (0.21, 0.19, 0.18), (0.48, 0.23, 0.12), (0.14, 0.13, 0.125)
HAZARD, SAND, TEAL, BONE, GLASS = (0.85, 0.63, 0.10), (0.79, 0.71, 0.54), (0.25, 0.42, 0.40), (0.85, 0.81, 0.72), (0.10, 0.09, 0.07)
OLIVE = (0.36, 0.35, 0.24)
HEAD, TAIL, AMBER = (1.0, 0.95, 0.78), (1.0, 0.22, 0.12), (1.0, 0.70, 0.25)
UP, FWD, BACK = Z_, -1 * Y_, Y_


def B(P, c, size, mat="primary", col=(0.5, 0.5, 0.5), **k):
    """A chamfered box by its centre (V.blk takes the bottom)."""
    return V.blk(P, c, size, mat, col, mid=True, **k)


def wheel(b, R, w, lugs=9):
    """One all-terrain wheel about its hub (axle along x): a fat tyre with tread blocks, a dished steel rim with a
    beadlock ring, a hub and one painted spoke so the roll reads."""
    P = b.node("Wheel", (0, 0, 0))
    K.lathe(P, (-w / 2, 0, 0), (w / 2, 0, 0), [(0, R * 0.62), (0.06, R * 0.86), (0.2, R * 0.95), (0.8, R * 0.95), (0.94, R * 0.86), (1, R * 0.62)], 14,
            "dark", TYRE)
    for i in range(lugs):
        a = i * math.tau / lugs
        for s, off in ((-1, 0.0), (1, math.pi / lugs)):
            c = Vector((s * w * 0.22, math.cos(a + off) * R * 0.965, math.sin(a + off) * R * 0.965))
            out = Vector((0, math.cos(a + off), math.sin(a + off)))
            V.surf_blk(P, c, X_, out.cross(X_), out, w * 0.36, R * 0.24, 0.035, "dark", (0.105, 0.10, 0.095))
    for s in (-1, 1):
        V.cyl(P, (s * w * 0.40, 0, 0), R * 0.60, w * 0.16, "x", 12, [(0, 1.0), (1, 0.82)] if s > 0 else [(0, 0.82), (1, 1.0)], "trim", STEEL)
        V.cyl(P, (s * (w / 2 + 0.005), 0, 0), R * 0.64, 0.03, "x", 12, None, "trim", RUST)
        V.cyl(P, (s * (w / 2 + 0.02), 0, 0), R * 0.22, 0.07, "x", 6, None, "dark", DARK)
        for i in range(5):
            a = i * math.tau / 5
            B(P, (s * (w / 2 + 0.012), math.cos(a) * R * 0.40, math.sin(a) * R * 0.40), (0.035, 0.07, 0.07), "trim", HAZARD if i == 0 else DARK, ch=0.01)
    return P


def technical():
    """The technical: the war band's pickup, a fast armoured all-terrain truck with a gun on a post in the bed.
    Says: quick, scrappy, dangerous at the back. A wedge nose behind a ram bumper with two tusks, a slit-windowed cab
    with a light bar, flared arches over fat tyres, a low bed with a roll cage, crates and a fuel drum round the post."""
    b = K.Build("technical", "vehicle", "Technical", 81, "War band", "quick and scrappy: ram nose, slit cab, gun bed")
    paint = b.node("Paint", (0, 0, 0))
    R, T, HUB = 0.45, 1.9, -0.45
    yF, yR = -1.6, 1.6                                    # the axles (the front is -y)
    deck = 0.30

    # ---- the painted masses: the hull tub with its arches and bed, the cab
    S = K.mass({
        "x": ([(-2.47, 0.16), (-2.38, -0.18), (-2.20, -0.26), (2.14, -0.26), (2.27, -0.04), (2.25, 0.56), (-1.10, 0.56), (-2.36, 0.38)], -0.92, 0.92),
        "z": ([(-0.91, 2.26), (0.91, 2.26), (0.91, -1.95), (0.76, -2.47), (-0.76, -2.47), (-0.91, -1.95)], -0.3, 0.6),
    }, "hull", PAINT, fillet=0.04)
    cuts = [H.cut_rect((0, 1.32, 0.56), X_, Y_, UP, 1.62, 1.70, depth=0.25, corner=0.05, slope=0.1, col=PAINT)]
    for s in (-1, 1):
        for y in (yF, yR):
            cuts.append(H.cut_rect((s * 0.91, y, -0.10), Y_, Z_, s * X_, 1.16, 0.76, depth=0.20, corner=0.22, slope=0.2, col=PAINT))
    K.cut(S, cuts, bevel=0.015)
    b.add(S, paint)
    C = K.mass({
        "x": ([(-1.16, 0.54), (0.36, 0.54), (0.31, 1.19), (-0.52, 1.22), (-0.62, 1.16)], -0.9, 0.9),
        "y": ([(-0.86, 0.54), (0.86, 0.54), (0.86, 0.86), (0.72, 1.22), (-0.72, 1.22), (-0.86, 0.86)], -1.2, 0.4),
    }, "cab", PAINT, fillet=0.035)
    b.add(C, paint)

    P = b.body
    # ---- under it: the ladder frame, sump guard, a skid plate under the nose
    for s in (-1, 1):
        B(P, (s * 0.36, -0.05, -0.30), (0.12, 4.30, 0.14), "dark", DARK, ch=0.02)
    for y in (yF, yR):
        V.bar(P, (-0.80, y, HUB), (0.80, y, HUB), 0.06, "dark", DARK, 6)                  # the axle
        V.cyl(P, (0.0, y, HUB), 0.15, 0.24, "x", 8, [(0, 0.6), (0.3, 1), (0.7, 1), (1, 0.6)], "dark", STEEL)
        for s in (-1, 1):                                                                  # a damper to each hub
            V.bar(P, (s * 0.62, y + 0.12, HUB + 0.05), (s * 0.50, y + 0.20, 0.10), 0.035, "trim", HAZARD if s > 0 else STEEL, 6)
    V.surf_blk(P, (0, -2.30, -0.20), X_, Vector((0, -0.45, 0.9)).normalized(), Vector((0, -0.9, -0.45)).normalized(), 1.30, 0.50, 0.04, "trim", STEEL, ch=0.01)

    # ---- the nose: grille slats, the ram bumper and its tusks, headlamps in guards, tow hooks
    V.louvres(P, (0, -2.445, 0.20), X_, Z_, FWD, 0.86, 0.24, 5, "dark", DARK, tilt=0.5, t=0.02)
    B(P, (0, -2.62, -0.02), (1.96, 0.14, 0.20), "trim", STEEL, ch=0.03)
    for s in (-1, 1):
        B(P, (s * 0.52, -2.54, -0.02), (0.10, 0.20, 0.12), "dark", DARK, ch=0.015)        # the bumper's arms
        V.blk(P, (s * 0.52, -2.74, -0.20), (0.12, 0.34, 0.50), "trim", STEEL, ch=0.02, nose=(0.30, 0.0), mid=False)
        B(P, (s * 0.93, -2.60, -0.02), (0.14, 0.16, 0.24), "trim", HAZARD, ch=0.02)
        V.cyl(P, (s * 0.60, -2.47, 0.30), 0.105, 0.06, "y", 8, None, "dark", DARK)
        b.lamp((s * 0.60, -2.505, 0.30), 0.078, FWD, HEAD)
        for dz in (-0.05, 0.05):
            V.bar(P, (s * 0.60 - 0.11, -2.52, 0.30 + dz), (s * 0.60 + 0.11, -2.52, 0.30 + dz), 0.01, "trim", STEEL, 4)
    # ---- the hood: a raised intake with a hazard stripe beside it, tie-downs, a snorkel up the right pillar
    n_h = Vector((0, -0.143, 0.99)).normalized()
    up_h = Vector((0, 0.99, -0.143)).normalized()
    hc = Vector((0, -1.72, 0.475))
    V.surf_blk(P, hc + X_ * -0.12, X_, up_h, n_h, 0.52, 0.80, 0.10, "secondary", RUST, ch=0.03)
    V.louvres(P, hc + X_ * -0.12 + n_h * 0.10, X_, up_h, n_h, 0.38, 0.50, 5, "dark", DARK, tilt=0.5, t=0.018)
    V.surf_blk(P, hc + X_ * 0.50, X_, up_h, n_h, 0.20, 1.00, 0.012, "trim", HAZARD)
    V.pipe_run(P, [(-0.80, -1.50, 0.50), (-0.88, -1.30, 0.62), (-0.86, -0.80, 1.05), (-0.82, -0.62, 1.34)], 0.045, "dark", DARK, bend=0.10, n=6)
    V.cyl(P, (-0.82, -0.64, 1.38), 0.075, 0.10, "z", 6, None, "dark", STEEL)

    # ---- the arches: flared plates over each wheel, a mud flap behind, rock sliders between
    for s in (-1, 1):
        for y, col in ((yF, RUST), (yR, DARK)):
            V.surf_blk(P, (s * 0.93, y, 0.285), Y_, s * X_, UP, 0.92, 0.42, 0.045, "secondary", col, ch=0.012)
            for e in (-1, 1):
                d = Vector((0, e * 0.42, -0.42)).normalized()
                V.surf_blk(P, (s * 0.93, y + e * 0.60, 0.16), d, s * X_, d.cross(s * X_) * -e * s, 0.34, 0.42, 0.045, "secondary", col, ch=0.012)
            B(P, (s * 0.93, y + 0.72, -0.16), (0.36, 0.03, 0.36), "dark", TYRE, ch=0.005)
        V.bar(P, (s * 0.96, -0.86, -0.22), (s * 0.96, 0.86, -0.22), 0.045, "trim", STEEL, 6)
        for y in (-0.6, 0.0, 0.6):
            V.bar(P, (s * 0.96, y, -0.22), (s * 0.74, y, -0.22), 0.03, "dark", DARK, 5)

    # ---- the cab: slit glass behind shutters, a colour block on the doors, a roof plate with the light bar
    d_w = Vector((0, 0.54, 0.62)).normalized()
    n_w = Vector((0, -0.62, 0.54)).normalized()
    wc = Vector((0, -0.89, 0.86))
    V.surf_blk(P, wc, X_, d_w, n_w, 1.34, 0.40, 0.012, "dark", GLASS)
    for t in (-0.17, 0.17):
        V.surf_blk(P, wc + d_w * t, X_, d_w, n_w, 1.42, 0.07, 0.035, "trim", STEEL, ch=0.008)
    for x in (-0.70, -0.24, 0.24, 0.70):
        V.surf_blk(P, wc + X_ * x, X_, d_w, n_w, 0.05, 0.40, 0.03, "trim", STEEL, ch=0.008)
    for s in (-1, 1):
        n_s = Vector((s * 0.938, 0, 0.346)).normalized()
        v_s = Vector((-s * 0.346, 0, 0.938)).normalized()
        V.surf_blk(P, (s * 0.79, -0.36, 1.04), Y_, v_s, n_s, 0.86, 0.22, 0.012, "dark", GLASS)
        V.surf_blk(P, (s * 0.79, -0.36, 1.04), Y_, v_s, n_s, 0.05, 0.26, 0.03, "trim", STEEL)
        V.surf_blk(P, (s * 0.86, -0.38, 0.69), Y_, Z_, s * X_, 0.98, 0.26, 0.02, "secondary", TEAL, ch=0.006)     # the door's colour block
        V.surf_blk(P, (s * 0.88, -0.70, 0.70), Y_, Z_, s * X_, 0.10, 0.03, 0.03, "dark", DARK)                     # its handle
        V.bolt_row(P, (s * 0.865, -1.05, 0.60), (s * 0.865, 0.25, 0.60), 5, s * X_, 0.018, col=STEEL)
        V.cyl(P, (s * 0.98, -0.98, 0.98), 0.06, 0.03, "y", 6, None, "dark", DARK)                                  # a mirror
        V.bar(P, (s * 0.84, -0.98, 0.92), (s * 0.98, -0.98, 0.98), 0.012, "dark", DARK, 4)
    B(P, (0, -0.12, 1.235), (1.36, 0.92, 0.035), "secondary", RUST, ch=0.01)
    B(P, (0, -0.50, 1.29), (1.20, 0.10, 0.08), "dark", DARK, ch=0.02)
    for x in (-0.45, -0.15, 0.15, 0.45):
        V.cyl(P, (x, -0.555, 1.30), 0.062, 0.05, "y", 8, None, "trim", STEEL)
        b.lamp((x, -0.582, 1.30), 0.05, FWD, AMBER)
    V.bar(P, (0.56, 0.20, 1.24), (0.60, 0.34, 2.10), 0.012, "trim", STEEL, 4, r2=0.005)                           # the whip aerial
    B(P, (0.20, 0.02, 1.30), (0.50, 0.36, 0.10), "secondary", OLIVE, ch=0.02)                                      # a bedroll box
    # the exhaust stack up the cab's back, left of the gunner
    V.pipe_run(P, [(-0.72, 0.20, 0.10), (-0.72, 0.46, 0.34), (-0.72, 0.46, 1.86)], 0.055, "dark", DARK, bend=0.10, n=6)
    V.cyl(P, (-0.72, 0.46, 1.50), 0.085, 0.50, "z", 8, None, "trim", STEEL)
    V.cyl(P, (-0.72, 0.46, 1.90), 0.07, 0.08, "z", 6, [(0, 1.0), (1, 1.25)], "dark", DARK)

    # ---- the bed: a dark floor, capped sides, tailgate, the roll cage, the gun's post and ring, the load
    B(P, (0, 1.32, deck + 0.025), (1.60, 1.68, 0.03), "dark", DARK, ch=0.004)
    for s in (-1, 1):
        B(P, (s * 0.86, 1.34, 0.585), (0.13, 1.84, 0.05), "trim", SAND, ch=0.012)
        V.bolt_row(P, (s * 0.915, 0.60, 0.42), (s * 0.915, 2.10, 0.42), 4, s * X_, 0.02, col=STEEL)
    B(P, (0, 2.27, 0.42), (1.70, 0.05, 0.30), "trim", STEEL, ch=0.012)
    B(P, (0.46, 2.30, 0.45), (0.50, 0.02, 0.10), "trim", HAZARD)
    for s in (-1, 1):
        b.lamp((s * 0.77, 2.275, 0.20), (0.16, 0.08), BACK, TAIL)
        V.bar(P, (s * 0.40, 2.26, -0.20), (s * 0.40, 2.40, -0.24), 0.03, "trim", STEEL, 5)        # tow hooks
    cy, cz = 0.50, 1.62
    for s in (-1, 1):
        x = s * 0.78
        V.bar(P, (x, cy, deck), (x, cy, cz), 0.045, "trim", STEEL, 6)
        V.bar(P, (x, cy, cz), (s * 0.70, -0.30, 1.26), 0.04, "trim", STEEL, 6)
        V.bar(P, (x, cy, cz), (x, cy + 0.74, 0.60), 0.035, "trim", STEEL, 6)
    V.bar(P, (-0.78, cy, cz), (0.78, cy, cz), 0.045, "trim", STEEL, 6)
    V.bar(P, (-0.78, cy, 1.0), (0.78, cy, 1.0), 0.03, "trim", STEEL, 5)
    gy = 1.1975                                                                                    # the gun's post (the game's turret stands on it)
    V.cyl(P, (0, gy, deck + 0.07), 0.27, 0.10, "z", 10, None, "trim", STEEL)
    V.bolt_row(P, (-0.20, gy, deck + 0.12), (0.20, gy, deck + 0.12), 2, UP, 0.025, col=DARK)
    K.lathe(P, (0, gy, deck + 0.10), (0, gy, deck + 1.0), [(0, 0.11), (0.25, 0.075), (0.85, 0.075), (1.0, 0.11)], 8, "dark", DARK)
    for a in (0.7, 2.6, 4.4):
        V.bar(P, (math.cos(a) * 0.24, gy + math.sin(a) * 0.24, deck + 0.10), (0, gy, deck + 0.52), 0.022, "trim", STEEL, 4)
    # the load, low so the gun swings over it
    B(P, (-0.52, 0.80, deck + 0.17), (0.46, 0.50, 0.28), "secondary", OLIVE, ch=0.02)             # ammunition crates
    B(P, (-0.52, 0.80, deck + 0.25), (0.47, 0.51, 0.02), "trim", V.shade(OLIVE, 0.7))
    B(P, (-0.54, 0.78, deck + 0.40), (0.38, 0.40, 0.18), "secondary", SAND, ch=0.02)
    B(P, (-0.54, 0.78, deck + 0.40), (0.06, 0.41, 0.19), "dark", DARK)
    K.lathe(P, (0.54, 0.84, deck + 0.04), (0.54, 0.84, deck + 0.58), [(0, 0.20), (0.04, 0.215), (0.96, 0.215), (1.0, 0.20)], 10, "secondary", RUST)   # the fuel drum
    for t in (0.2, 0.42):
        V.cyl(P, (0.54, 0.84, deck + t), 0.225, 0.025, "z", 10, None, "dark", DARK)
    V.cyl(P, (0.60, 0.90, deck + 0.59), 0.035, 0.03, "z", 6, None, "trim", STEEL)
    V.cyl(P, (0.0, 2.36, 0.52), 0.34, 0.20, "y", 12, [(0, 0.86), (0.25, 1), (0.75, 1), (1, 0.86)], "dark", TYRE)                                      # the spare on the tailgate
    V.cyl(P, (0.0, 2.44, 0.52), 0.18, 0.06, "y", 8, None, "trim", STEEL)
    for s in (-1, 1):
        B(P, (s * 0.64, 1.86, deck + 0.20), (0.16, 0.30, 0.36), "secondary", RUST if s > 0 else OLIVE, ch=0.03)                                       # jerrycans
        V.cyl(P, (s * 0.64, 1.76, deck + 0.39), 0.03, 0.04, "z", 6, None, "dark", DARK)

    wheel(b, R, 0.36)
    b.socket("Turret", (0, gy, deck + 1.0))
    for i, (s, y) in enumerate(((1, yF), (-1, yF), (1, yR), (-1, yR))):
        b.socket("Hub_%d" % i, (s * T / 2, y, HUB))
    return b


def heavy(pid, name, seed, says, six, tt=False):
    """The gun truck and the six-wheeler: one build, two characters. Both are armoured cab trucks with a plough nose,
    slat armour down the bed and a gun ring; the six-wheeler is longer on a tandem rear, in olive, its ring up on a
    pedestal inside a wall of sandbags, jerrycans and a spare wheel on the bed."""
    b = K.Build(pid, "vehicle", name, seed, "War band", says)
    paint = b.node("Paint", (0, 0, 0))
    R, T, hw = (0.62, 2.4, 1.15) if tt else (0.6, 2.3, 1.10)
    if tt:
        # the turret truck: the six-wheeler's chassis, heavier, a salvaged tank turret on a timber crib on the bed
        HUB, axles, front, back, deck, cab0, cab1, bed0, gy = -0.58, [-2.30, 1.60, 3.00], -3.35, 3.85, 0.25, -1.75, -0.05, 0.07, 1.86
    elif six:
        HUB, axles, front, back, deck, cab0, cab1, bed0, gy = -0.60, [-2.15, 1.45, 2.85], -3.20, 3.70, 0.22, -1.60, 0.10, 0.22, 1.76
    else:
        HUB, axles, front, back, deck, cab0, cab1, bed0, gy = -0.55, [-2.30, 2.30], -3.35, 3.15, 0.27, -1.75, -0.05, 0.07, 1.51
    zb, zt, top = deck - 0.56, deck + 0.26, deck + 1.0
    door = OLIVE if six else SAND

    # ---- the painted masses: the hull tub with arches and bed, the cab
    S = K.mass({
        "x": ([(front - 0.02, deck - 0.10), (front + 0.07, zb + 0.10), (front + 0.25, zb), (back - 0.12, zb), (back + 0.02, zb + 0.24), (back, zt),
               (cab0 + 0.04, zt), (front + 0.08, zt - 0.12)], -hw - 0.02, hw + 0.02),
        "z": ([(-hw, back), (hw, back), (hw, front + 0.55), (hw - 0.16, front - 0.02), (-hw + 0.16, front - 0.02), (-hw, front + 0.55)], zb - 0.05, zt + 0.05),
    }, "hull", PAINT, fillet=0.045)
    cuts = [H.cut_rect((0, (bed0 + back) / 2, zt), X_, Y_, UP, 2 * hw - 0.22, back - bed0 - 0.18, depth=0.25, corner=0.05, slope=0.1, col=PAINT)]
    groups = [(axles[0], 0.0), ((axles[1] + axles[-1]) / 2, axles[-1] - axles[1])]
    arch_top = HUB + R + 0.30
    for s in (-1, 1):
        for y, span in groups:
            cuts.append(H.cut_rect((s * hw, y, arch_top - 0.5), Y_, Z_, s * X_, span + 2 * R + 0.30, 1.0, depth=0.26, corner=0.26, slope=0.2, col=PAINT))
    K.cut(S, cuts, bevel=0.015)
    b.add(S, paint)
    C = K.mass({
        "x": ([(cab0 - 0.04, zt - 0.02), (cab1 + 0.04, zt - 0.02), (cab1 - 0.02, top), (cab0 + 0.42, top + 0.02), (cab0 + 0.30, top - 0.06)], -hw, hw),
        "y": ([(-hw + 0.05, zt - 0.02), (hw - 0.05, zt - 0.02), (hw - 0.05, zt + 0.36), (hw - 0.20, top + 0.02), (-hw + 0.20, top + 0.02), (-hw + 0.05, zt + 0.36)],
              cab0 - 0.1, cab1 + 0.1),
    }, "cab", PAINT, fillet=0.04)
    b.add(C, paint)

    P = b.body
    # ---- under it: frame rails, axles with their diffs, dampers
    for s in (-1, 1):
        B(P, (s * 0.44, (front + back) / 2, zb - 0.04), (0.14, back - front - 0.5, 0.16), "dark", DARK, ch=0.02)
    for y in axles:
        V.bar(P, (-T / 2 + 0.2, y, HUB), (T / 2 - 0.2, y, HUB), 0.075, "dark", DARK, 6)
        V.cyl(P, (0.0, y, HUB), 0.19, 0.30, "x", 8, [(0, 0.6), (0.3, 1), (0.7, 1), (1, 0.6)], "dark", STEEL)
        for s in (-1, 1):
            V.bar(P, (s * (T / 2 - 0.42), y + 0.14, HUB + 0.06), (s * (T / 2 - 0.56), y + 0.22, zb + 0.30), 0.04, "trim", HAZARD if s > 0 else STEEL, 6)

    # ---- the nose: the plough, grille, lamps in cages, tow eyes
    n_p = Vector((0, -0.84, 0.54)).normalized()
    v_p = Vector((0, 0.54, 0.84)).normalized()
    V.surf_blk(P, (0, front - 0.36, zb + 0.20), X_, v_p, n_p, 2 * hw + 0.24, 0.66, 0.07, "secondary", RUST, ch=0.015)
    for x in (-0.8, -0.27, 0.27, 0.8):
        V.surf_blk(P, (x, front - 0.36, zb + 0.20), X_, v_p, n_p, 0.07, 0.70, 0.05, "trim", STEEL, off=0.07, ch=0.01)
    V.surf_blk(P, (0, front - 0.52, zb + 0.46), X_, v_p, n_p, 2 * hw + 0.30, 0.08, 0.10, "trim", HAZARD, ch=0.015)
    for s in (-1, 1):
        B(P, (s * 0.55, front - 0.12, zb + 0.22), (0.12, 0.34, 0.14), "dark", DARK, ch=0.02)
        V.cyl(P, (s * 0.74, front - 0.03, deck + 0.02), 0.12, 0.07, "y", 8, None, "dark", DARK)
        b.lamp((s * 0.74, front - 0.07, deck + 0.02), 0.09, FWD, HEAD)
        for dz in (-0.06, 0.0, 0.06):
            V.bar(P, (s * 0.74 - 0.13, front - 0.09, deck + 0.02 + dz), (s * 0.74 + 0.13, front - 0.09, deck + 0.02 + dz), 0.011, "trim", STEEL, 4)
    V.louvres(P, (0, front - 0.025, deck - 0.02), X_, Z_, FWD, 0.90, 0.30, 5, "dark", DARK, tilt=0.5, t=0.022)
    # ---- the hood: an armoured engine cover with vents, a hazard stripe, twin stacks behind the cab
    hy = (front + cab0) / 2 + 0.05
    B(P, (0, hy, zt + 0.045), (1.50, cab0 - front - 0.45, 0.09), "secondary", RUST, ch=0.03)
    for s in (-1, 1):
        V.louvres(P, (s * 0.40, hy, zt + 0.09), X_, Y_, UP, 0.46, cab0 - front - 0.80, 5, "dark", DARK, tilt=0.5, t=0.02)
    V.surf_blk(P, (0.92, hy, zt), X_, Y_, UP, 0.16, cab0 - front - 0.5, 0.012, "trim", HAZARD)
    sk = -0.62 if tt else 0.0                                                # the turret truck's stacks stay under the barrel
    for s in (-1, 1):
        V.pipe_run(P, [(s * 0.80, cab1 + 0.02, zb + 0.3), (s * 0.80, cab1 + 0.14, deck + 0.2), (s * 0.80, cab1 + 0.14, top + 0.72 + sk)], 0.065, "dark", DARK, bend=0.10, n=6)
        V.cyl(P, (s * 0.80, cab1 + 0.14, top + 0.30 + sk * 0.6), 0.10, 0.56 + sk * 0.6, "z", 8, None, "trim", STEEL)
        V.cyl(P, (s * 0.80, cab1 + 0.14, top + 0.76 + sk), 0.085, 0.09, "z", 6, [(0, 1.0), (1, 1.25)], "dark", DARK)

    # ---- the arches: plate fenders over each axle group, mud flaps, steps up to the cab
    for s in (-1, 1):
        for (y, span), col in zip(groups, (RUST, DARK)):
            L = span + 2 * R + 0.10
            V.surf_blk(P, (s * (hw + 0.04), y, arch_top + 0.02), Y_, s * X_, UP, L, 0.50, 0.05, "secondary", col, ch=0.012)
            for e in (-1, 1):
                B(P, (s * (hw + 0.04), y + e * (L / 2 + 0.10), arch_top - 0.10), (0.50, 0.05, 0.30), "secondary", col, ch=0.012)
            B(P, (s * (hw + 0.02), y + L / 2 + 0.14, arch_top - 0.46), (0.46, 0.03, 0.46), "dark", TYRE, ch=0.005)
        for k, z in enumerate((zb + 0.02, zb + 0.30)):
            B(P, (s * (hw + 0.10 - k * 0.04), (axles[0] + R + 0.45 + groups[1][0] - groups[1][1] / 2 - R - 0.45) / 2, z), (0.22, 0.9, 0.04), "trim", STEEL, ch=0.008)

    # ---- the cab: a slit windscreen behind bars, shuttered side slits, door blocks, roof plate, lamps
    d_w = Vector((0, 0.34, 0.74)).normalized()
    n_w = Vector((0, -0.74, 0.34)).normalized()
    wc = Vector((0, cab0 + 0.115, zt + 0.52))
    V.surf_blk(P, wc, X_, d_w, n_w, 2 * hw - 0.50, 0.26, 0.012, "dark", GLASS)
    for t in (-0.15, 0.15):
        V.surf_blk(P, wc + d_w * t, X_, d_w, n_w, 2 * hw - 0.40, 0.07, 0.04, "trim", STEEL, ch=0.008)
    for i in range(6):
        V.surf_blk(P, wc + X_ * (-0.75 + i * 0.30), X_, d_w, n_w, 0.045, 0.30, 0.035, "trim", RUST, ch=0.006)
    cy = (cab0 + cab1) / 2
    for s in (-1, 1):
        n_s = Vector((s * 0.94, 0, 0.34)).normalized()
        v_s = Vector((-s * 0.34, 0, 0.94)).normalized()
        sc = Vector((s * (hw - 0.125), cy - 0.05, zt + 0.55))
        V.surf_blk(P, sc, Y_, v_s, n_s, cab1 - cab0 - 0.6, 0.18, 0.012, "dark", GLASS)
        V.surf_blk(P, sc + v_s * 0.13, Y_, v_s, n_s, cab1 - cab0 - 0.5, 0.06, 0.05, "trim", STEEL, ch=0.008)
        V.surf_blk(P, (s * (hw - 0.05), cy, zt + 0.17), Y_, Z_, s * X_, cab1 - cab0 - 0.45, 0.28, 0.025, "secondary", door, ch=0.006)
        V.bolt_row(P, (s * (hw - 0.045), cab0 + 0.15, zt + 0.02), (s * (hw - 0.045), cab1 - 0.15, zt + 0.02), 6, s * X_, 0.02, col=STEEL)
        V.surf_blk(P, (s * (hw - 0.02), cy - 0.35, zt + 0.20), Y_, Z_, s * X_, 0.12, 0.035, 0.035, "dark", DARK)
    B(P, (0, cy + 0.05, top + 0.04), (2 * hw - 0.34, cab1 - cab0 - 0.05, 0.04), "secondary", BONE if six else RUST, ch=0.01)
    lb = -0.16 if tt else 0.10                                               # the turret truck's lamps sit on the cab's brow
    B(P, (0, cab0 + (0.30 if tt else 0.52), top + lb), (1.60, 0.12, 0.09), "dark", DARK, ch=0.02)
    for x in (-0.6, -0.3, 0.0, 0.3, 0.6):
        V.cyl(P, (x, cab0 + (0.235 if tt else 0.455), top + lb + 0.01), 0.07, 0.05, "y", 8, None, "trim", STEEL)
        b.lamp((x, cab0 + (0.208 if tt else 0.428), top + lb + 0.01), 0.056, FWD, AMBER)
    if not tt:
        V.bar(P, (-0.7, cab1 - 0.2, top + 0.05), (-0.74, cab1 - 0.05, top + 1.1), 0.013, "trim", STEEL, 4, r2=0.005)

    # ---- the bed: floor, capped sides with slat armour, tailgate, tail lamps
    by = (bed0 + back) / 2
    B(P, (0, by, deck + 0.025), (2 * hw - 0.24, back - bed0 - 0.2, 0.03), "dark", DARK, ch=0.004)
    slats = 0 if tt else 7 if six else 5
    for s in (-1, 1):
        B(P, (s * (hw - 0.05), by + 0.04, zt + 0.03), (0.14, back - bed0 - 0.06, 0.06), "trim", STEEL, ch=0.012)
        B(P, (s * (hw + 0.13), by, deck + 0.50), (0.07, back - bed0 - 0.3, 0.09), "trim", STEEL, ch=0.01)
        for i in range(slats):
            y = bed0 + 0.30 + i * (back - bed0 - 0.6) / (slats - 1)
            V.blk(P, (s * (hw + 0.10), y, deck - 0.22), (0.05, 0.13, 0.80), "dark", DARK, ch=0.008)
    B(P, (0, back + 0.02, deck + 0.12), (2 * hw - 0.06, 0.06, 0.34), "trim", STEEL, ch=0.012)
    B(P, (0.55, back + 0.055, deck + 0.16), (0.55, 0.02, 0.10), "trim", HAZARD)
    for s in (-1, 1):
        b.lamp((s * 0.90, back + 0.025, deck - 0.18), (0.18, 0.09), BACK, TAIL)
        V.bar(P, (s * 0.44, back, zb + 0.02), (s * 0.44, back + 0.16, zb - 0.02), 0.035, "trim", STEEL, 5)
    # the cage behind the cab (not on the turret truck: the barrel swings over the cab)
    cz, ky = top + 0.45, bed0 + 0.05
    for s in () if tt else (-1, 1):
        x = s * (hw - 0.14)
        V.bar(P, (x, ky, deck), (x, ky, cz), 0.05, "trim", STEEL, 6)
        V.bar(P, (x, ky, cz), (x * 0.92, cy + 0.2, top + 0.06), 0.045, "trim", STEEL, 6)
        V.bar(P, (x, ky, cz), (x, ky + 0.8, zt), 0.04, "trim", STEEL, 6)
    if not tt:
        V.bar(P, (-hw + 0.14, ky, cz), (hw - 0.14, ky, cz), 0.05, "trim", STEEL, 6)

    # ---- the gun's ring (the game's turret sits on it) and the load round it
    if tt:
        # five layers of timber, chained down; outriggers kicked out to the sand; a spare on the door
        crib = deck + 0.8
        for i in range(5):
            z = deck + 0.12 + i * 0.15
            for s in (-1, 1):
                c = (s * 0.75, gy, z) if i % 2 == 0 else (0, gy + s * 0.75, z)
                B(P, c, (0.2, 1.9, 0.15) if i % 2 == 0 else (1.9, 0.2, 0.15), "secondary", BONE if i % 2 == 0 else SAND, ch=0.02)
        for s in (-1, 1):
            for t in (-1, 1):
                V.bar(P, (s * 0.9, gy + t * 0.9, crib), (s * hw, gy + t * 1.0, deck), 0.028, "dark", DARK, 5)
                y = gy + t * 1.55
                V.bar(P, (s * (hw - 0.1), y, deck - 0.1), (s * (hw + 0.9), y + t * 0.2, HUB - R + 0.15), 0.065, "trim", STEEL, 6)
                B(P, (s * (hw + 0.9), y + t * 0.2, HUB - R + 0.12), (0.45, 0.45, 0.06), "dark", DARK, ch=0.01)
        V.cyl(P, (0, gy, crib + 0.02), 0.9, 0.16, "z", 12, None, "dark", DARK)
        V.cyl(P, (0, gy, crib + 0.085), 0.96, 0.04, "z", 12, None, "trim", STEEL)
        V.cyl(P, (hw + 0.10, cy, zt + 0.16), R * 0.85, 0.26, "x", 12, [(0, 0.86), (0.25, 1), (0.75, 1), (1, 0.86)], "dark", TYRE)
        V.cyl(P, (hw + 0.24, cy, zt + 0.16), R * 0.4, 0.04, "x", 8, None, "trim", STEEL)
        for i in range(3):
            B(P, (-0.6 + i * 0.6, bed0 + 0.40, deck + 0.20), (0.46, 0.5, 0.32), "secondary", OLIVE if i != 1 else RUST, ch=0.025)   # shell crates behind the cab
        wheel(b, R, 0.5, 10)
        b.socket("Turret", (0, gy, crib + 0.1))
        return b
    if six:
        K.lathe(P, (0, gy, deck + 0.04), (0, gy, deck + 0.60), [(0, 0.34), (0.15, 0.275), (0.85, 0.275), (1.0, 0.36)], 10, "dark", DARK)
        ring_z = deck + 0.65
        for i in range(8):                                                   # the sandbag wall
            a = i * math.tau / 8
            c = Vector((math.sin(a) * 0.95, gy - 0.2 - math.cos(a) * 0.95, deck + 0.15))
            V.blk(P, c, (0.52, 0.30, 0.22), "secondary", SAND if i % 2 else V.shade(SAND, 0.86), ch=0.07,
                  rot=Matrix.Rotation(-a, 4, "Z"), mid=True)
        for i in range(4):                                                   # jerrycans along the right side
            B(P, (-hw + 0.26, back - 0.42 - i * 0.34, deck + 0.24), (0.18, 0.30, 0.40), "secondary", OLIVE if i % 2 else RUST, ch=0.03)
        V.cyl(P, (hw - 0.52, back - 0.75, deck + 0.20), R * 0.85, 0.30, "z", 12, [(0, 0.86), (0.25, 1), (0.75, 1), (1, 0.86)], "dark", TYRE)
        V.cyl(P, (hw - 0.52, back - 0.75, deck + 0.36), R * 0.42, 0.04, "z", 8, None, "trim", STEEL)
    else:
        ring_z = deck + 0.25
        B(P, (0, bed0 + 0.42, deck + 0.24), (0.9, 0.5, 0.4), "secondary", OLIVE, ch=0.025)            # ammunition lockers behind the cab
        B(P, (0, bed0 + 0.42, deck + 0.36), (0.91, 0.51, 0.025), "trim", V.shade(OLIVE, 0.7))
        for s in (-1, 1):
            K.lathe(P, (s * 0.72, back - 0.42, deck + 0.04), (s * 0.72, back - 0.42, deck + 0.70), [(0, 0.24), (0.04, 0.26), (0.96, 0.26), (1.0, 0.24)], 10,
                    "secondary", RUST if s > 0 else TEAL)
            for t in (0.25, 0.5):
                V.cyl(P, (s * 0.72, back - 0.42, deck + t), 0.27, 0.03, "z", 10, None, "dark", DARK)
        V.cyl(P, (0.0, back + 0.14, deck + 0.20), R * 0.8, 0.26, "y", 12, [(0, 0.86), (0.25, 1), (0.75, 1), (1, 0.86)], "dark", TYRE)
    V.cyl(P, (0, gy, ring_z), 0.80, 0.30, "z", 12, [(0, 0.92), (0.2, 1), (1, 1)], "dark", DARK)
    V.cyl(P, (0, gy, ring_z + 0.13), 0.86, 0.05, "z", 12, None, "trim", STEEL)
    for i in range(8):
        a = i * math.tau / 8
        V.cyl(P, (math.cos(a) * 0.83, gy + math.sin(a) * 0.83, ring_z + 0.165), 0.03, 0.03, "z", 6, None, "trim", HAZARD if i == 0 else STEEL)

    wheel(b, R, 0.5, 10)
    b.socket("Turret", (0, gy, deck + (0.8 if six else 0.45)))
    return b


def gun_truck():
    """Says: the band's brawler. A blunt armoured cab truck behind a plough, twin stacks, slat armour, a heavy gun ring."""
    return heavy("gunTruck", "Gun truck", 82, "the brawler: plough nose, slat armour, twin stacks, heavy gun ring", False)


def six_wheeler():
    """Says: the long gun. A longer truck on a tandem rear in olive, its autocannon ring up on a pedestal in sandbags."""
    return heavy("sixWheeler", "Six-wheeler", 83, "the long gun: tandem rear, pedestal ring in sandbags, jerrycans", True)


def turret_truck():
    """Says: the band's heavy gun. The six-wheeler's chassis under a salvaged tank turret, on a crib of timber chained to
    the bed, outriggers kicked out to the sand."""
    return heavy("turretTruck", "Turret truck", 84, "the heavy gun: timber crib, chains, outriggers under a tank turret", True, True)


VEHICLES = [technical, gun_truck, six_wheeler, turret_truck]

if __name__ == "__main__":
    a = K.parse_args()
    for fn in VEHICLES:
        b = fn()
        if a.only and b.id != a.only:
            continue
        K.write(b, a.out)
        if a.sheet:
            K.sheet(os.path.join(a.sheet, b.id), views=[("front34", 215, 30, 16.0), ("rear34", 35, 35, 16.0)], res=(640, 480), target=(0, 0.0, 0.2))
    H.report()
