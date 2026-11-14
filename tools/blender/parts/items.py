"""Swords, shoulder feeds and power, summoner shoulders: the items that were code boxes or nothing (docs/asset-pipeline.md
batch 6; item bases in src/items/bases.ts). The game loads public/models/parts/<base id>.glb (src/weapons/partSwap.ts).

    node tools/blender/run.mjs tools/blender/parts/items.py -- --out public/models/parts [--only sword-heavy] [--sheet <dir>]

Swords. Frame: the origin is the hand (the swing's pivot), the blade along -y (the game's +Z), the edge down (-z), x the
flat. The hilt is the Body; the blade is the `Blade` node, its pivot 0.46 m ahead of the hand where the code stand-in's
blade began, built at its true length (the base's reach x Blade drawn x reach, less 0.46: Breaker 4.24, Buster 4.95,
Short 2.94 m) with its lit edge as the node's glow. The game divides the blade by its length and stretches it back to
the live reach, so a slider or a rolled reach still fits. Each blade is built at its base's heft (the game divides it out).

Shoulder gear. Frame: the origin is the shoulder mount's top, -y forward, z up, x across; the same model hangs on both
shoulders (mirrored by the mount), so each is near symmetric. Envelope, the code stand-ins': x +-0.45, y -0.6..0.5,
z -0.6..1.0. The feeds' chute runs down in front to the gun below. Lamps are the Glow mesh: the game lights it with the
gear's state (a feed's overdrive or ignited rounds, the bank's discharge ready). Budget 1,500 triangles an item.
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
WHITE, SLATE, NAVY, NBARE = (0.79, 0.81, 0.86), (0.35, 0.41, 0.57), (0.20, 0.22, 0.31), (0.70, 0.72, 0.77)
BRASS, TEAL, CYAN = (0.72, 0.56, 0.24), (0.35, 1.0, 0.92), (0.50, 0.88, 1.0)
STEEL, STEEL_D, OXBLOOD = (0.68, 0.67, 0.62), (0.45, 0.44, 0.41), (0.42, 0.16, 0.11)
EDGE = (1.0, 0.55, 0.25)
BLADE_AT = 0.46       # where the code stand-in's blade began, ahead of the hand (src/weapons/models.ts swordModel)
FWD = -Y_


def B(P, c, size, mat="primary", col=(0.5, 0.5, 0.5), **k):
    """A chamfered box by its centre (V.blk takes the bottom)."""
    return V.blk(P, c, size, mat, col, mid=True, **k)


def lit(P, faces):
    for f in faces or []:
        f[P.flag] = V.NOBAKE


def strip(P, pts, r, col, n=4, glow=False):
    """A run of bars through points (a spine, a lit edge)."""
    for a, b in zip(pts, pts[1:]):
        fs = V.bar(P, a, b, r, "glow" if glow else "dark", col, n)
        if glow:
            lit(P, fs)


def blade(b, L, spine, edge, t, steel, spine_col=FRAME, spine_r=0.04, tip_t=0.45):
    """The Blade node: a slab whose side view is the outline spine (base to tip) + edge (tip back to base), y = -s along
    the blade (pivot-local; the edge without the tip, which ends the spine), thinning to tip_t of its thickness at the point. The edge's points get the lit strip."""
    P = b.node("Blade", (0, -BLADE_AT, 0))
    out = [(y, z) for y, z in spine] + [(y, z) for y, z in edge]
    S = K.mass({
        "x": (out, -0.3, 0.3),
        "z": ([(-t, 0.02), (t, 0.02), (t * tip_t, -L - 0.02), (-t * tip_t, -L - 0.02)], -1.0, 1.0),
    }, "blade", steel, fillet=0.012)
    b.add(S, P)
    # the spine's ridge and the lit edge, a hair outside the slab
    strip(P, [Vector((0, y, z + 0.006)) for y, z in spine[:-1]], spine_r, spine_col)
    G = b.node_glow("Blade")
    strip(G, [Vector((0, y, z - 0.012)) for y, z in [spine[-1]] + edge], 0.022, EDGE, glow=True)
    return P


def sword_light():
    """Breaker sword. Says: a katana, mech-sized. A slim single-edged blade with a gentle curve and a clipped point, bare
    steel with a dark spine; a long wrapped grip, a round guard, a brass collar with a ready lamp."""
    b = K.Build("sword-light", "sword", "Breaker sword", 61, "Suzaku", "katana: slim, curved, single edge")
    L = 4.24
    rise = lambda s: 0.20 * (s / L) ** 2                                     # noqa: E731 the curve
    w = lambda s: 0.30 - 0.08 * (s / L)                                       # noqa: E731
    ss = [0.0, 0.6, 1.3, 2.1, 2.9, 3.5, L - 0.28]
    spine = [(-s, rise(s) + w(s) / 2) for s in ss] + [(-L, rise(L) + w(L) / 2 - 0.03)]
    edge = [(-(L - 0.42), rise(L - 0.42) - w(L) / 2 + 0.02)] + [(-s, rise(s) - w(s) / 2) for s in reversed(ss[:-1])]
    P = blade(b, L, spine, edge, 0.04, STEEL)
    B(P, (0, -0.10, 0.0), (0.10, 0.20, 0.32), "trim", BRASS, ch=0.02)          # the collar on the blade's root
    # the hilt
    V.cyl(b.body, (0, 0.12, 0), 0.075, 0.86, "y", 8, None, "dark", RUBBER)
    for i in range(5):
        y = 0.48 - i * 0.18
        for s in (-1, 1):
            V.bar(b.body, (s * 0.04, y + 0.06, 0.06), (-s * 0.04, y - 0.06, 0.06), 0.022, "trim", OLIVE, 4)
    V.cyl(b.body, (0, 0.57, 0), 0.095, 0.06, "y", 8, None, "trim", BRASS)                                   # the pommel
    V.cyl(b.body, (0, -0.33, 0), 0.25, 0.06, "y", 10, None, "secondary", FRAME)                               # the guard
    V.cyl(b.body, (0, -0.37, 0), 0.20, 0.03, "y", 10, None, "trim", OLIVE)
    B(b.body, (0, -0.42, 0), (0.12, 0.08, 0.26), "trim", BARE, ch=0.015)
    b.lamp((0.065, -0.42, 0.05), (0.04, 0.06), X_, TEAL)
    b.lamp((-0.065, -0.42, 0.05), (0.04, 0.06), -X_, TEAL)
    return b


def sword_heavy():
    """Buster sword. Says: a slab of armour plate with an edge. A broad straight cleaver with a chisel point, a raised
    spine rail with bolts, three sunken panels down each flat; a long two-hand grip, a wide block guard in hazard paint."""
    b = K.Build("sword-heavy", "sword", "Buster sword", 62, "Stratford-Aegis", "cleaver: broad slab, chisel point, spine rail")
    L, h = 4.95, 0.31
    spine = [(0.0, h - 0.06), (-0.30, h), (-(L - 0.05), h)]
    edge = [(-L, h - 0.08), (-(L - 0.70), -h), (-1.6, -h), (-0.25, -h), (0.0, -h + 0.06)]
    P = b.node("Blade", (0, -BLADE_AT, 0))
    S = K.mass({
        "x": (spine + edge, -0.3, 0.3),
        "z": ([(-0.075, 0.02), (0.075, 0.02), (0.05, -L - 0.02), (-0.05, -L - 0.02)], -1.0, 1.0),
    }, "blade", STEEL_D, fillet=0.02)
    K.cut(S, [H.cut_rect((s * 0.07, -(0.95 + i * 1.15), 0.02), Y_, Z_, s * X_, 0.82, 0.30, depth=0.03, corner=0.06, slope=0.5, col=FRAME)
              for i in range(3) for s in (-1, 1)], bevel=0.008)
    b.add(S, P)
    B(P, (0, -(L - 0.3) / 2, h + 0.03), (0.17, L - 0.4, 0.10), "secondary", OLIVE_D, ch=0.03)                # the spine rail
    for s in (-1, 1):
        V.bolt_row(P, (s * 0.086, -0.5, h + 0.03), (s * 0.086, -(L - 0.5), h + 0.03), 7, s * X_, 0.022, col=BARE)
    B(P, (0, -0.16, 0.0), (0.19, 0.30, 0.66), "trim", KHAKI_D, ch=0.025)                                       # the root plate
    G = b.node_glow("Blade")
    strip(G, [Vector((0, y, z - 0.012)) for y, z in edge[:-1]], 0.026, EDGE, glow=True)
    # the hilt: a long grip and a wide block guard
    V.cyl(b.body, (0, 0.10, 0), 0.095, 0.90, "y", 8, None, "dark", RUBBER)
    for i in range(4):
        V.cyl(b.body, (0, 0.46 - i * 0.24, 0), 0.105, 0.04, "y", 8, None, "trim", OLIVE_D)
    B(b.body, (0, 0.60, 0), (0.24, 0.14, 0.24), "secondary", OLIVE, ch=0.03)                                  # the pommel weight
    B(b.body, (0, -0.37, 0), (0.30, 0.18, 0.92), "primary", KHAKI, ch=0.04)                                   # the guard
    for s in (-1, 1):
        V.surf_blk(b.body, (s * 0.152, -0.37, s * 0.30), Y_, Z_, s * X_, 0.16, 0.22, 0.008, "trim", HAZARD)
        V.bolt_row(b.body, (s * 0.152, -0.37, -0.36), (s * 0.152, -0.37, 0.36), 4, s * X_, 0.02, col=BARE)
    b.lamp((0.152, -0.37, -0.02), (0.06, 0.06), X_, AMBER)
    b.lamp((-0.152, -0.37, -0.02), (0.06, 0.06), -X_, AMBER)
    return b


def sword_short():
    """Short sword. Says: a quick machete. A broad leaf blade that widens toward a dropped point, a hazard band at the
    root; a short grip with a knuckle bow round the hand, a squat guard."""
    b = K.Build("sword-short", "sword", "Short sword", 63, "Suzaku", "machete: leaf blade, knuckle bow")
    L = 2.94
    spine = [(0.0, 0.14), (-1.0, 0.14), (-2.0, 0.15), (-2.55, 0.12), (-L, -0.02)]
    edge = [(-(L - 0.14), -0.10), (-2.45, -0.22), (-1.8, -0.24), (-0.9, -0.17), (-0.25, -0.14), (0.0, -0.13)]
    P = blade(b, L, spine, edge, 0.045, STEEL, spine_r=0.035, tip_t=0.5)
    for s in (-1, 1):
        V.surf_blk(P, (s * 0.045, -0.34, 0.0), Y_, Z_, s * X_, 0.22, 0.24, 0.008, "trim", HAZARD)
    # the hilt
    V.cyl(b.body, (0, 0.10, 0), 0.075, 0.70, "y", 8, None, "dark", RUBBER)
    V.cyl(b.body, (0, 0.47, 0), 0.10, 0.08, "y", 8, None, "trim", OLIVE_D)
    B(b.body, (0, -0.33, -0.02), (0.14, 0.10, 0.40), "secondary", OLIVE, ch=0.025)                          # the guard
    V.pipe_run(b.body, [(0, -0.30, -0.20), (0, -0.10, -0.24), (0, 0.30, -0.22), (0, 0.46, -0.08)], 0.026, "trim", BARE, bend=0.10, n=5)
    B(b.body, (0, -0.42, 0), (0.11, 0.08, 0.28), "trim", BARE, ch=0.015)
    b.lamp((0.071, -0.33, 0.08), (0.05, 0.05), X_, HOT)
    b.lamp((-0.071, -0.33, 0.08), (0.05, 0.05), -X_, HOT)
    return b


# ---------------------------------------------------------------- shoulder gear

def mount_plate(b, col=FRAME):
    """The plate every shoulder item stands on."""
    B(b.body, (0, 0, 0.03), (0.66, 0.74, 0.06), "dark", col, ch=0.015)
    for s in (-1, 1):
        V.bolt_row(b.body, (s * 0.29, -0.30, 0.065), (s * 0.29, 0.30, 0.065), 3, Z_, 0.02, col=BARE)


def chute(b, col, link_col, x=0.0):
    """The feed chute from the box's front down to the gun, belt links showing at its mouth."""
    pts = [(x, -0.40, 0.22), (x, -0.56, 0.10), (x, -0.62, -0.20), (x, -0.58, -0.52)]
    V.pipe_run(b.body, pts, 0.075, "secondary", col, bend=0.12, n=6, clamps=2, clamp_col=BARE)
    for i in range(3):
        B(b.body, (x, -0.50 - i * 0.05, 0.31 - i * 0.07), (0.14, 0.05, 0.05), "trim", link_col, ch=0.008, rot=(0.6 + i * 0.25, 0, 0))


def ammo_box(b, col, lid_col, h=0.52):
    """The belt box: a chamfered can with a ribbed lid, latches and a carry handle."""
    S = K.mass({
        "x": ([(-0.42, 0.06), (0.40, 0.06), (0.46, 0.14), (0.46, h), (0.40, h + 0.06), (-0.36, h + 0.06), (-0.42, h)], -0.36, 0.36),
        "z": ([(-0.36, -0.42), (0.36, -0.42), (0.36, 0.46), (-0.36, 0.46)], -0.5, 1.0),
    }, "box", col, fillet=0.03)
    K.cut(S, [H.cut_rect((s * 0.36, 0.02, h * 0.55), Y_, Z_, s * X_, 0.62, h * 0.5, depth=0.025, corner=0.03, slope=0.5, col=V.shade(col, 0.8))
              for s in (-1, 1)], bevel=0.01)
    b.add(S)
    B(b.body, (0, 0.02, h + 0.085), (0.76, 0.86, 0.05), "secondary", lid_col, ch=0.015)
    for i in range(3):
        B(b.body, (0, -0.26 + i * 0.26, h + 0.12), (0.70, 0.05, 0.03), "trim", V.shade(lid_col, 0.8), ch=0.006)
    for s in (-1, 1):
        B(b.body, (s * 0.375, -0.30, h - 0.04), (0.03, 0.08, 0.14), "trim", BARE, ch=0.006)
        B(b.body, (s * 0.375, 0.32, h - 0.04), (0.03, 0.08, 0.14), "trim", BARE, ch=0.006)
    V.pipe_run(b.body, [(-0.18, 0.10, h + 0.11), (-0.18, 0.10, h + 0.22), (0.18, 0.10, h + 0.22), (0.18, 0.10, h + 0.11)], 0.022, "dark",
               FRAME, bend=0.05, n=5)


def sh_beltfeed():
    """Belt feed. Says: more rounds, faster. A khaki ammo can with a ribbed olive lid, a booster motor with cooling fins on
    its flank, the chute curving down in front to the gun; an amber lamp lights while the overdrive runs."""
    b = K.Build("sh-beltfeed", "shoulder", "Belt feed", 71, "Stratford-Aegis", "ammo can, booster motor, chute to the gun")
    mount_plate(b)
    ammo_box(b, KHAKI, OLIVE)
    V.cyl(b.body, (0, 0.30, 0.68), 0.12, 0.50, "x", 10, None, "dark", FRAME)                                   # the booster motor
    for i in range(4):
        V.cyl(b.body, (-0.18 + i * 0.12, 0.30, 0.68), 0.15, 0.025, "x", 10, None, "trim", BARE)
    V.surf_blk(b.body, (0, -0.42, 0.30), X_, Z_, FWD, 0.30, 0.10, 0.006, "trim", HAZARD)
    chute(b, OLIVE_D, BRASS)
    b.lamp((0.25, -0.425, 0.42), (0.10, 0.06), FWD, AMBER)
    b.lamp((-0.25, -0.425, 0.42), (0.10, 0.06), FWD, AMBER)
    b.lamp((0.24, 0.465, 0.36), (0.10, 0.05), Y_, AMBER)
    b.socket("FeedOut", (0, -0.58, -0.52), (0, 0, -1))
    return b


def sh_incendiary():
    """Incendiary feed. Says: the rounds come out burning. The ammo can in oxblood with a hazard band, a fuel tank strapped
    across the top with a hose into the can, red-tipped links in the chute; its lamps glow while ignited rounds load."""
    b = K.Build("sh-incendiary", "shoulder", "Incendiary feed", 72, "Suzaku", "oxblood can, fuel tank on top, hot links")
    mount_plate(b)
    ammo_box(b, OXBLOOD, FRAME, h=0.46)
    for s in (-1, 1):
        V.surf_blk(b.body, (s * 0.362, 0.0, 0.30), Y_, Z_, s * X_, 0.84, 0.08, 0.006, "trim", HAZARD)
    K.lathe(b.body, (-0.36, 0.08, 0.78), (0.36, 0.08, 0.78), [(0, 0.10), (0.06, 0.17), (0.94, 0.17), (1, 0.10)], 12, "secondary", KHAKI)
    for x in (-0.20, 0.20):
        V.cyl(b.body, (x, 0.08, 0.78), 0.178, 0.04, "x", 12, None, "dark", FRAME)                               # straps
    V.cyl(b.body, (0.36, 0.08, 0.78), 0.05, 0.06, "x", 6, None, "trim", BRASS)                                 # the cap
    V.pipe_run(b.body, [(-0.36, 0.08, 0.78), (-0.42, 0.10, 0.70), (-0.42, 0.30, 0.56), (-0.30, 0.38, 0.56)], 0.03, "dark", RUBBER,
               bend=0.06, n=5)
    chute(b, FRAME, HOT)
    b.lamp((0.24, -0.425, 0.36), (0.12, 0.06), FWD, HOT)
    b.lamp((-0.24, -0.425, 0.36), (0.12, 0.06), FWD, HOT)
    b.lamp((0, 0.08, 0.958), (0.10, 0.04), Z_, HOT)
    b.lamp((0.24, 0.465, 0.30), (0.10, 0.05), Y_, HOT)
    b.socket("FeedOut", (0, -0.58, -0.52), (0, 0, -1))
    return b


def sh_capacitor():
    """Capacitor bank. Says: stored power. A navy block of three tall white cells, each banded with a lit ring and capped
    with a lit disc, a heat-sink across the front, thick cables looping back and down into the hull."""
    b = K.Build("sh-capacitor", "shoulder", "Capacitor bank", 73, "Novus-Lux", "three lit cells, heat sink, power cables")
    mount_plate(b, NAVY)
    S = K.mass({
        "x": ([(-0.40, 0.06), (0.36, 0.06), (0.42, 0.14), (0.42, 0.40), (0.34, 0.48), (-0.32, 0.48), (-0.40, 0.40)], -0.42, 0.42),
        "y": ([(-0.42, 0.06), (0.42, 0.06), (0.42, 0.42), (0.36, 0.48), (-0.36, 0.48), (-0.42, 0.42)], -0.5, 0.5),
    }, "block", NAVY, fillet=0.03)
    b.add(S)
    for x in (-0.25, 0.0, 0.25):
        K.lathe(b.body, (x, 0.02, 0.46), (x, 0.02, 1.0), [(0, 0.11), (0.08, 0.10), (0.92, 0.10), (1, 0.08)], 10, "primary", WHITE)
        V.cyl(b.body, (x, 0.02, 0.50), 0.12, 0.06, "z", 10, None, "trim", SLATE)
        b.lamp((x, 0.02, 1.004), 0.07, Z_, CYAN)
        lit(b.glow, V.cyl(b.glow, (x, 0.02, 0.80), 0.106, 0.05, "z", 10, None, "glow", CYAN))
    V.heat_sink(b.body, (0, -0.44, 0.10), 0.70, 0.08, 0.30, 7, "x", "trim", NBARE)
    for s in (-1, 1):
        V.pipe_run(b.body, [(s * 0.30, 0.40, 0.30), (s * 0.30, 0.56, 0.24), (s * 0.30, 0.58, -0.10), (s * 0.30, 0.42, -0.40)], 0.05, "dark",
                   RUBBER, bend=0.10, n=6, clamps=1, clamp_col=NBARE)
    b.lamp((0, -0.425, 0.40), (0.20, 0.04), FWD, TEAL)
    return b


def drone(P, G, c, k=0.72):
    """A docked attack drone (the field's drones, src/summon/dronesDraw.ts) at k of their size: a pod body, four arms with
    rotor cans and their blades, a gun."""
    c = Vector(c)
    at = lambda x, y, z: c + Vector((x, y, z)) * k                                                       # noqa: E731
    V.cyl(P, at(0, 0, 0.10), 0.24 * k, 0.18 * k, "z", 8, [(0, 1.0), (1, 0.8)], "primary", WHITE)
    V.cyl(P, at(0, 0.04, 0.22), 0.16 * k, 0.07 * k, "z", 8, None, "dark", NAVY)
    for sx in (-1, 1):
        for sy in (-1, 1):
            e = at(sx * 0.30, sy * 0.30, 0.12)
            V.bar(P, at(0, 0, 0.12), e, 0.03 * k, "dark", NAVY, 4)
            V.cyl(P, e, 0.07 * k, 0.12 * k, "z", 8, None, "primary", WHITE)
            V.bar(P, e + Vector((-0.17, 0.05, 0.05)) * k, e + Vector((0.17, -0.05, 0.05)) * k, 0.02 * k, "dark", SLATE, 4)
    V.bar(P, at(0, -0.10, 0.04), at(0, -0.42, 0.04), 0.03 * k, "dark", FRAME, 6)
    lit(G, V.surf_blk(G, at(0, -0.245, 0.12), X_, Z_, FWD, 0.12 * k, 0.04 * k, 0.01, "glow", TEAL))


def sh_drones():
    """Drone rack. Says: it launches drones. A slate launch frame with two docked drones nose-forward, one low in front,
    one on a raised cradle behind, side rails, a hazard launch edge and teal ready lamps."""
    b = K.Build("sh-drones", "shoulder", "Drone rack", 74, "Novus-Lux", "launch frame, two docked drones")
    mount_plate(b, NAVY)
    B(b.body, (0, 0.04, 0.16), (0.74, 0.96, 0.18), "secondary", SLATE, ch=0.03, nose=(0.06, 0.02))
    for s in (-1, 1):
        V.bar(b.body, (s * 0.40, 0.48, 0.30), (s * 0.40, -0.46, 0.30), 0.03, "trim", NBARE, 6)
        for y in (-0.38, 0.40):
            V.bar(b.body, (s * 0.40, y, 0.30), (s * 0.36, y, 0.18), 0.025, "trim", NBARE, 4)
        V.bar(b.body, (s * 0.16, 0.24, 0.25), (s * 0.16, 0.24, 0.56), 0.035, "trim", NBARE, 6)               # the cradle's posts
    V.surf_blk(b.body, (0, -0.445, 0.20), X_, Z_, FWD, 0.66, 0.06, 0.006, "trim", HAZARD)
    B(b.body, (0, -0.20, 0.27), (0.20, 0.20, 0.04), "dark", FRAME, ch=0.01)
    drone(b.body, b.glow, (0, -0.22, 0.29))
    B(b.body, (0, 0.24, 0.58), (0.38, 0.22, 0.05), "dark", FRAME, ch=0.01)
    drone(b.body, b.glow, (0, 0.26, 0.61))
    for s in (-1, 1):
        b.lamp((s * 0.30, 0.52, 0.20), (0.08, 0.06), Y_, TEAL)
    return b


def sh_hive():
    """Swarm hive. Says: a nest that breeds machines. A hexagonal canister tipped forward, its front a honeycomb of seven
    glowing cells, ribs round its sides, a rear vent."""
    b = K.Build("sh-hive", "shoulder", "Swarm hive", 75, "Suzaku", "hex nest, glowing honeycomb face")
    mount_plate(b)
    B(b.body, (0, 0.10, 0.16), (0.40, 0.40, 0.20), "dark", FRAME, ch=0.03)                                  # the pedestal
    tilt = math.radians(60)     # the honeycomb up toward the game camera
    a = Vector((0, 0.40, 0.42))
    d = Vector((0, -math.cos(tilt), math.sin(tilt)))          # forward and up
    face = a + d * 0.72
    K.lathe(b.body, a, face, [(0, 0.30), (0.06, 0.38), (0.86, 0.38), (1, 0.36)], 6, "primary", KHAKI_D)
    for t in (0.25, 0.55):
        p = a + d * (0.72 * t)
        K.lathe(b.body, p, p + d * 0.05, [(0, 0.395), (1, 0.395)], 6, "trim", HAZARD)
    # the honeycomb: seven hex cells on the face
    u, w = X_, d.cross(X_).normalized()
    if w.z < 0:
        w = -w
    cells = [(0, 0)] + [(math.cos(k * math.pi / 3 + math.pi / 6) * 0.20, math.sin(k * math.pi / 3 + math.pi / 6) * 0.20) for k in range(6)]
    for cx, cy in cells:
        c = face + u * cx + w * cy
        K.lathe(b.body, c - d * 0.03, c + d * 0.02, [(0, 0.098), (1, 0.098)], 6, "dark", FRAME)
        lit(b.glow, V.cyl(b.glow, c + d * 0.024, 0.075, 0.012, "z", 6, None, "glow", AMBER, rot=d.to_track_quat("Z", "Y").to_matrix()))
    V.louvres(b.body, a + Vector((0, 0.02, 0.0)), X_, Z_, Y_, 0.40, 0.24, 4, "dark", FRAME, tilt=0.5, t=0.018)
    return b


ITEMS = [sword_light, sword_heavy, sword_short, sh_beltfeed, sh_incendiary, sh_capacitor, sh_drones, sh_hive]

if __name__ == "__main__":
    a = K.parse_args()
    for fn in ITEMS:
        b = fn()
        if a.only and b.id != a.only:
            continue
        K.write(b, a.out)
        if a.sheet:
            sword = b.kind == "sword"
            K.sheet(os.path.join(a.sheet, b.id), views=[("side", 90, 30, 9.0)] if sword else [("rear34", 35, 25, 5.0)],
                    res=(900, 300) if sword else (420, 420), target=(0, -2.4, 0) if sword else (0, 0.05, 0.12))
    H.report()
