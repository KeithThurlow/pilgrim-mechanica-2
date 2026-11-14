"""Sensors: two heads (front of the hull, they follow the aim) and three clusters (on top, they sweep or stand).
docs/asset-pipeline.md batch 4; item bases in src/items/bases.ts; the game loads public/models/sensors/<id>.glb
(src/mech/sensorModels.ts) and turns the nodes: Head (yaw about its up axis), HeadPitch (under Head, tips), Sweep.

    node tools/blender/run.mjs tools/blender/parts/sensors.py -- --out public/models/sensors [--only sensor-dish] [--sheet <dir>]

Frame: the origin is the socket (Sensor_Front for a head, Sensor_Top for a cluster): x across, -y forward, z up.
A node's geometry is authored about its own pivot. Sizes follow the code stand-ins the game was tuned on (a head's
block 0.9 wide, its pitch pivot 0.5 above the socket). Budget 1,000 triangles (docs/asset-list.md).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as K  # noqa: E402
from partkit import H, V, X_, Y_, Z_, Vector  # noqa: E402

KHAKI, KHAKI_D, OLIVE, OLIVE_D = (0.63, 0.57, 0.42), (0.49, 0.45, 0.33), (0.42, 0.43, 0.30), (0.33, 0.34, 0.24)
FRAME, BARE, RUBBER = (0.25, 0.25, 0.205), (0.58, 0.57, 0.52), (0.17, 0.165, 0.155)
WHITE, SLATE, SLATE_D, NAVY, NBARE = (0.79, 0.81, 0.86), (0.35, 0.41, 0.57), (0.27, 0.31, 0.45), (0.20, 0.22, 0.31), (0.70, 0.72, 0.77)
LENS, LAMP, TEAL, GLASS = (1.0, 0.42, 0.12), (1.0, 0.95, 0.78), (0.35, 1.0, 0.92), (0.10, 0.11, 0.13)
FWD = -Y_


def B(P, c, size, mat="primary", col=(0.5, 0.5, 0.5), **k):
    """A chamfered box by its centre (V.blk takes the bottom)."""
    return V.blk(P, c, size, mat, col, mid=True, **k)


def lens(b, node, c, r, col, depth=0.14, rim=FRAME, n=10):
    """A lens barrel pointing forward from c (pivot-local) with its lit glass."""
    P = b.nodes[node][0]
    c = Vector(c)
    V.cyl(P, c + FWD * (depth / 2), r * 1.28, depth, "y", n, None, "dark", rim)
    b.lamp(c + FWD * (depth + 0.004), r, FWD, col, piece=b.node_glow(node))


def sensor_visor():
    """Stratford-Aegis visor head. Says: a tank commander's sight. An armoured wedge block on a yoke: sloped brow, a
    recessed visor band with one big amber lens off-centre and two lamps, a chin guard, an aerial."""
    b = K.Build("sensor-visor", "sensor", "Rampart visor head", 51, "Stratford-Aegis", "armoured sight: visor band, one big lens")
    V.cyl(b.body, (0, 0, 0.07), 0.38, 0.14, "z", 12, [(0, 1.06), (0.6, 1.0), (1, 0.88)], "dark", FRAME)
    head = b.node("Head", (0, 0, 0.14), axis="y")
    B(head, (0, 0.02, 0.10), (0.52, 0.40, 0.20), "dark", FRAME, ch=0.03)
    for s in (-1, 1):                                             # the yoke's cheeks and trunnion caps
        B(head, (s * 0.50, 0.0, 0.30), (0.09, 0.36, 0.46), "secondary", OLIVE, ch=0.03)
        V.cyl(head, (s * 0.555, 0.0, 0.36), 0.085, 0.03, "x", 8, None, "trim", BARE)
    pitch = b.node("HeadPitch", (0, 0, 0.50), parent="Head", axis="x")
    S = K.mass({
        "x": ([(-0.30, -0.23), (0.24, -0.23), (0.32, -0.12), (0.32, 0.14), (0.20, 0.23), (-0.24, 0.23), (-0.40, 0.11), (-0.40, -0.12)], -0.44, 0.44),
        "z": ([(-0.34, -0.40), (0.34, -0.40), (0.44, -0.28), (0.44, 0.32), (-0.44, 0.32), (-0.44, -0.28)], -0.3, 0.3),
    }, "visor", KHAKI, fillet=0.03)
    K.cut(S, [H.cut_rect((0, -0.40, 0.0), X_, Z_, FWD, 0.74, 0.19, depth=0.06, corner=0.03, slope=0.5, col=GLASS),
              H.cut_rect((0, 0.32, 0.0), X_, Z_, Y_, 0.50, 0.22, depth=0.04, corner=0.03, slope=0.5, col=FRAME)], bevel=0.012)
    b.add(S, pitch)
    V.louvres(pitch, (0, 0.29, 0.0), X_, Z_, Y_, 0.44, 0.17, 4, "dark", (0.20, 0.20, 0.18), tilt=0.5, t=0.018)
    B(pitch, (0, -0.12, 0.255), (0.96, 0.56, 0.05), "secondary", OLIVE, ch=0.015, nose=(0.10, 0.03))      # the brow plate
    V.surf_blk(pitch, (0, -0.33, -0.21), X_, Vector((0, -0.8, -0.6)), Vector((0, -0.6, 0.8)), 0.70, 0.16, 0.035, "secondary", OLIVE)   # chin
    lens(b, "HeadPitch", (0.14, -0.35, 0.0), 0.085, LENS, depth=0.10)
    for x in (-0.20, -0.30):
        b.lamp((x, -0.348, 0.01), (0.055, 0.075), FWD, LAMP, piece=b.node_glow("HeadPitch"))
    for s in (-1, 1):
        V.bolt_row(pitch, (s * 0.442, -0.18, 0.12), (s * 0.442, 0.22, 0.12), 3, s * X_, 0.02, col=BARE)
    V.bar(pitch, (-0.34, 0.22, 0.22), (-0.34, 0.26, 0.78), 0.014, "dark", FRAME, 5)                           # the aerial
    V.cyl(pitch, (-0.34, 0.22, 0.26), 0.035, 0.06, "z", 6, None, "trim", BARE)
    return b


def sensor_optic():
    """Novus-Lux twin-optic head. Says: binoculars. A white drum across a slim neck with two long lens barrels side by
    side, slate cheek plates, a range-finder lamp between the eyes."""
    b = K.Build("sensor-optic", "sensor", "Twin-optic head", 52, "Novus-Lux", "binoculars: two lens barrels on a drum")
    V.cyl(b.body, (0, 0, 0.06), 0.31, 0.12, "z", 12, [(0, 1.08), (0.6, 1.0), (1, 0.85)], "dark", NAVY)
    head = b.node("Head", (0, 0, 0.12), axis="y")
    V.cyl(head, (0, 0, 0.16), 0.115, 0.32, "z", 8, None, "secondary", SLATE_D)
    V.cyl(head, (0, 0, 0.09), 0.15, 0.04, "z", 8, None, "trim", NBARE)
    pitch = b.node("HeadPitch", (0, 0, 0.40), parent="Head", axis="x")
    V.cyl(pitch, (0, 0.02, 0), 0.27, 0.80, "x", 12, [(0, 0.8), (0.06, 1.0), (0.94, 1.0), (1, 0.8)], "primary", WHITE)
    V.cyl(pitch, (0, 0.02, 0), 0.278, 0.10, "x", 12, None, "secondary", SLATE)                                # the centre band
    for s in (-1, 1):
        B(pitch, (s * 0.455, 0.02, 0.0), (0.09, 0.56, 0.48), "secondary", SLATE, ch=0.05)
        V.cyl(pitch, (s * 0.20, -0.28, 0.03), 0.125, 0.26, "y", 10, [(0, 1.12), (0.3, 1.0), (1, 1.0)], "primary", WHITE)
        lens(b, "HeadPitch", (s * 0.20, -0.33, 0.03), 0.082, TEAL, depth=0.11, rim=NAVY)
        V.bar(pitch, (s * 0.32, 0.20, 0.20), (s * 0.34, 0.30, 0.50), 0.012, "dark", NAVY, 5)                  # whisker aerials
    B(pitch, (0, -0.24, -0.15), (0.14, 0.10, 0.08), "dark", NAVY, ch=0.015)
    b.lamp((0, -0.292, -0.15), (0.09, 0.04), FWD, LAMP, piece=b.node_glow("HeadPitch"))
    V.louvres(pitch, (0, 0.285, 0.0), X_, Z_, Y_, 0.36, 0.20, 4, "dark", NAVY, tilt=0.5, t=0.016)
    return b


def sensor_mast():
    """Stratford-Aegis mast. Says: a radio mast. A braced lattice post with a small dish and a yagi on a turning collar,
    a red-amber beacon on top."""
    b = K.Build("sensor-mast", "sensor", "Rampart mast", 53, "Stratford-Aegis", "radio mast: braced post, small dish, beacon")
    B(b.body, (0, 0, 0.06), (0.46, 0.46, 0.12), "dark", FRAME, ch=0.03)
    V.cyl(b.body, (0, 0, 0.62), 0.055, 1.02, "z", 8, [(0, 1.5), (0.12, 1.0), (1, 0.8)], "secondary", OLIVE_D)
    for a in range(3):                                            # three guy braces
        ang = a * math.tau / 3 + 0.5
        V.bar(b.body, (math.cos(ang) * 0.20, math.sin(ang) * 0.20, 0.11), (math.cos(ang) * 0.04, math.sin(ang) * 0.04, 0.56), 0.016, "trim", BARE, 5)
    V.cyl(b.body, (0, 0, 1.15), 0.075, 0.05, "z", 8, None, "dark", FRAME)
    b.lamp((0, 0, 1.175), 0.055, Z_, LENS)
    V.cyl(b.glow, (0, 0, 1.21), 0.05, 0.07, "z", 8, None, "glow", LENS, flag=V.NOBAKE)
    sw = b.node("Sweep", (0, 0, 0), axis="y")
    V.cyl(sw, (0, 0, 0.74), 0.09, 0.10, "z", 8, None, "trim", BARE)
    B(sw, (0, 0, 0.74), (0.56, 0.08, 0.06), "secondary", OLIVE, ch=0.012)
    for s in (-1, 1):
        B(sw, (s * 0.27, 0, 0.80), (0.07, 0.12, 0.26), "primary", KHAKI, ch=0.02)
    axis = Vector((0, -0.89, 0.45)).normalized()                  # the dish looks forward and up
    c = Vector((0, -0.08, 0.98))
    K.lathe(sw, c - axis * 0.02, c + axis * 0.10, [(0, 0.07), (0.3, 0.20), (1, 0.34)], 10, "primary", KHAKI)
    K.lathe(sw, c + axis * 0.101, c + axis * 0.105, [(0, 0.30), (1, 0.30)], 10, "dark", KHAKI_D)
    V.bar(sw, c + axis * 0.10, c + axis * 0.30, 0.016, "dark", FRAME, 5)
    V.bar(sw, (0, 0.05, 0.92), c - axis * 0.02, 0.03, "dark", FRAME, 5)
    return b


def sensor_dish():
    """Novus-Lux survey dish. Says: it scans far. A big white dish on a slate pedestal that turns, a feed horn held on
    three struts with a lit tip, a counterweight behind."""
    b = K.Build("sensor-dish", "sensor", "Survey dish", 54, "Novus-Lux", "scanner: big turning dish, lit feed horn")
    V.cyl(b.body, (0, 0, 0.08), 0.36, 0.16, "z", 12, [(0, 1.06), (0.6, 1.0), (1, 0.88)], "dark", NAVY)
    sw = b.node("Sweep", (0, 0, 0.16), axis="y")
    B(sw, (0, 0.02, 0.19), (0.44, 0.30, 0.38), "secondary", SLATE, ch=0.05)
    for s in (-1, 1):
        V.cyl(sw, (s * 0.235, 0.02, 0.26), 0.08, 0.03, "x", 8, None, "trim", NBARE)
    axis = Vector((0, -0.87, 0.50)).normalized()
    c = Vector((0, -0.02, 0.50))
    K.lathe(sw, c - axis * 0.04, c + axis * 0.16, [(0, 0.10), (0.25, 0.34), (0.65, 0.58), (1, 0.70)], 14, "primary", WHITE)
    K.lathe(sw, c + axis * 0.161, c + axis * 0.166, [(0, 0.655), (1, 0.655)], 14, "secondary", (0.62, 0.65, 0.72))   # the dish's face
    K.lathe(sw, c + axis * 0.167, c + axis * 0.172, [(0, 0.16), (1, 0.16)], 10, "dark", NAVY)
    tip = c + axis * 0.56
    u, v, _ = V.basis_from(axis)
    for a in range(3):
        ang = a * math.tau / 3 + math.pi / 2
        V.bar(sw, c + axis * 0.16 + (u * math.cos(ang) + v * math.sin(ang)) * 0.52, tip, 0.014, "trim", NBARE, 4)
    K.lathe(sw, tip - axis * 0.10, tip + axis * 0.02, [(0, 0.075), (1, 0.045)], 8, "dark", NAVY)
    b.lamp(tip - axis * 0.105, 0.06, -axis, TEAL, piece=b.node_glow("Sweep"))
    B(sw, Vector((0, 0.02, 0.42)) - axis * 0.20, (0.26, 0.16, 0.14), "dark", NAVY, ch=0.03)               # counterweight
    return b


def sensor_array():
    """Suzaku long array. Says: long range. A wide bar of five tilted panels up on two braced posts, lit tips: the widest
    thing on the hull."""
    b = K.Build("sensor-array", "sensor", "Long array", 55, "Suzaku Dynamics", "long range: a wide bar of panels, lit tips")
    B(b.body, (0, 0, 0.06), (0.92, 0.40, 0.12), "dark", FRAME, ch=0.03)
    for s in (-1, 1):
        B(b.body, (s * 0.32, 0, 0.40), (0.10, 0.12, 0.58), "secondary", OLIVE_D, ch=0.02)
        V.bar(b.body, (s * 0.32, 0.17, 0.12), (s * 0.32, 0.05, 0.56), 0.02, "trim", BARE, 5)
    V.bar(b.body, (-0.32, 0, 0.30), (0.32, 0, 0.52), 0.018, "trim", BARE, 5)
    sw = b.node("Sweep", (0, 0, 0.70), axis="y")
    B(sw, (0, 0, 0), (2.0, 0.16, 0.13), "secondary", OLIVE, ch=0.03)
    up, out = Vector((0, 0.20, 0.98)).normalized(), Vector((0, -0.98, 0.20)).normalized()
    for i in range(5):
        x = -0.8 + i * 0.4
        V.surf_blk(sw, Vector((x, -0.03, 0.26)), X_, up, out, 0.34, 0.40, 0.045, "primary", KHAKI, ch=0.03)
        V.surf_blk(sw, Vector((x, -0.03, 0.26)) + out * 0.046, X_, up, out, 0.26, 0.30, 0.006, "dark", (0.21, 0.23, 0.26))
        V.bar(sw, (x, 0.02, 0.06), (x, 0.03, 0.20), 0.02, "dark", FRAME, 5)
    for s in (-1, 1):
        B(sw, (s * 1.03, 0, 0.0), (0.08, 0.20, 0.17), "dark", FRAME, ch=0.02)
        b.lamp((s * 1.03, -0.102, 0.0), (0.06, 0.10), FWD, LENS, piece=b.node_glow("Sweep"))
        V.bar(sw, (s * 1.03, 0.04, 0.08), (s * 1.06, 0.10, 0.46), 0.011, "dark", FRAME, 4)
    return b


SENSORS = [sensor_visor, sensor_optic, sensor_mast, sensor_dish, sensor_array]

if __name__ == "__main__":
    a = K.parse_args()
    for fn in SENSORS:
        b = fn()
        if a.only and b.id != a.only:
            continue
        K.write(b, a.out)
        if a.sheet:
            K.sheet(os.path.join(a.sheet, b.id), views=[("front34", 150, 22, 5.0)], res=(420, 420))
    H.report()
