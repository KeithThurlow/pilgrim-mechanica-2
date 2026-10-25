"""Renders for rampart-railgun: the Rampart study's shots.py on this variant, plus a few views of the gun.

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-railgun/shots_rg.py -- --out <ABS DIR> --only game40,zoom10
        [--pose rest|stance] [--ink sepia|thin|face] [--tag x]

Extra shots here: gun_close (the right gun from the outer front quarter), gun_side (side ortho of the gun and hull),
top40 (straight down at 40 m: the forward-barrel read), mass_top40.
"""
import importlib.util
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(MECHS, "studies", "rampart"))
spec = importlib.util.spec_from_file_location("rampart_railgun", os.path.join(HERE, "rampart-railgun.py"))
RG = importlib.util.module_from_spec(spec)
sys.modules["rampart_railgun"] = RG
spec.loader.exec_module(RG)

import shots as S  # noqa: E402

EXTRA = ("gun_close", "gun_side", "top40", "mass_top40", "gun_top")


def extra(name, out):
    if name == "gun_close":
        S.scene(1500, 1100)
        S.ground(60, (0.86, 0.82, 0.78))
        S.mech(False)
        S.cam_look((-5.6, -5.8, 5.6), (-1.7, -0.9, 3.9), 50)
    elif name == "gun_side":
        S.scene(1600, 900)
        S.ground(60, (0.86, 0.82, 0.78))
        S.mech(False, pose="rest")
        S.human(-2.6, -2.4, 0.0)
        S.cam_look((-30, -0.6, 3.2), (0, -0.6, 3.2), 50, ortho=6.2)
    elif name == "gun_top":
        S.scene(1600, 1000)
        S.ground(60, (0.86, 0.82, 0.78))
        S.mech(False, pose="rest")
        S.cam_look((-1.5, -0.8, 30), (-1.5, -0.8, 0), 50, ortho=4.6)
    elif name in ("top40", "mass_top40"):
        S.scene(1920, 1080, S.SAND, dil=0, crease=0.9)
        S.ground(200, S.SAND)
        S.mech(name.startswith("mass_"))
        S.human(2.6, -1.2)
        S.cam_look((0, -0.001, 40), (0, 0, 0), 50)
        bpy_cam = S.bpy.context.scene.camera
        bpy_cam.data.lens = 24
        bpy_cam.data.sensor_width = 36
    S.shot(out)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--only" in argv:
        i = argv.index("--only")
        want = argv[i + 1].split(",")
    else:
        want = ["game40"]
    a_out = argv[argv.index("--out") + 1]
    tag = ("_" + argv[argv.index("--tag") + 1]) if "--tag" in argv else ""
    S.HD = RG
    if "--pose" in argv:
        S.POSE_MODE["mode"] = argv[argv.index("--pose") + 1]
    if "--ink" in argv:
        S.INK["mode"] = argv[argv.index("--ink") + 1]
    os.makedirs(a_out, exist_ok=True)
    std = [w for w in want if w not in EXTRA]
    for w in want:
        if w in EXTRA:
            extra(w, os.path.join(a_out, w + tag + ".png"))
    if std:
        rest = [x for k, x in enumerate(argv) if not (k > 0 and argv[k - 1] in ("--only", "--model")) and x not in ("--only", "--model")]
        sys.argv = [sys.argv[0], "--"] + rest + ["--only", ",".join(std), "--model", "rampart_railgun"]
        S.main()


if __name__ == "__main__":
    main()
