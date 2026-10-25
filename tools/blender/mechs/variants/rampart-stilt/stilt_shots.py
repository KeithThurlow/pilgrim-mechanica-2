"""Renders for rampart-stilt through the Rampart's shots.py (same toon look and cameras), plus this variant's side views.

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-stilt/stilt_shots.py -- --out <ABS DIR> \
        --model rampart-stilt --only mass_game40,mass_side,... [--pose rest|stance] [--ink thin]

Extra shots here: side_rest (ortho side of the whole mech, the leg's zigzag and the long blade), range_leg (the right leg at
the walker's extremes: knee and hock folded, and stretched, ghosted side by side).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
RAMP = os.path.join(MECHS, "studies", "rampart")
for p in (os.path.join(MECHS, "studies", "military"), MECHS, RAMP, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import shots as S  # noqa: E402

_orig_main = S.main


def extra(name, out):
    import importlib
    S.HD = importlib.import_module("rampart-stilt")
    if name == "side_rest":
        S.scene(1300, 1100)
        S.ground(60, (0.86, 0.82, 0.78))
        S.mech(False, pose="rest")
        S.human(-1.8, -2.4, 0.0)
        S.cam_look((24, -0.3, 2.6), (0, -0.3, 2.6), 50, ortho=6.6)
        S.shot(out)
    elif name == "range_leg":
        # three copies: rest, folded (high knee lift: thigh up 45, shin and cannon folded), stretched (push-off)
        S.scene(1800, 900)
        S.ground(80, (0.86, 0.82, 0.78))
        for k, rot in enumerate(({}, {"Thigh_R": (math.radians(-45), 0, 0), "Shin_R": (math.radians(55), 0, 0),
                                       "Meta_R": (math.radians(-50), 0, 0)},
                                 {"Thigh_R": (math.radians(28), 0, 0), "Shin_R": (math.radians(-10), 0, 0),
                                  "Meta_R": (math.radians(20), 0, 0)})):
            root, _ = S.mech(False, loc=(0, (k - 1) * 4.2, 0), pose="rest")
            for e in root.children_recursive:
                if e.type == "EMPTY" and e.name.split(".")[0] in rot:
                    e.rotation_euler = rot[e.name.split(".")[0]]
        S.cam_look((-30, 0, 2.2), (0, 0, 2.2), 50, ortho=13.0)
        S.shot(out)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--only" in argv:
        i = argv.index("--only") + 1
        names = argv[i].split(",")
        mine = [n for n in names if n in ("side_rest", "range_leg")]
        rest = [n for n in names if n not in mine]
        o = argv[argv.index("--out") + 1]
        os.makedirs(o, exist_ok=True)
        tag = ("_" + argv[argv.index("--tag") + 1]) if "--tag" in argv else ""
        for n in mine:
            extra(n, os.path.join(o, n + tag + ".png"))
        if not rest:
            return
        argv[i] = ",".join(rest)
        sys.argv = sys.argv[:sys.argv.index("--") + 1] + argv
    _orig_main()


if __name__ == "__main__":
    main()
