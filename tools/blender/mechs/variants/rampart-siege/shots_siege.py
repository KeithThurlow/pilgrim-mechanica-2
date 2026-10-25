"""Renders for the Rampart Siege: studies/rampart/shots.py's shots on this variant, plus a few of its own.

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-siege/shots_siege.py -- --out <ABS DIR>
        [--only game40,zoom10,gun_close,...] [--mass] [--pose stance|rest] [--ink thin] [--tag t]

Own shots: gun_close (the siege cannon from front-right), thigh_close (the thigh plate and skirt, front three-quarter),
side_rest (an ortho side view at rest with a pilot), front_rest (ortho front at rest), top40 (straight down at 40 m),
range_legs (the leg chain at both ends of its joint ranges: knee bent, hock opened, thigh swung).
Everything else is passed to shots.py (mass_game40, game40, zoom10, front_legs, feet_front, layer_map, ...).
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

import bpy  # noqa: E402
from mathutils import Euler  # noqa: E402

import shots as S  # noqa: E402
import rampart_siege as M  # noqa: E402

OWN = ("gun_close", "thigh_close", "side_rest", "front_rest", "top40", "range_legs")
LIGHT_GREY = (0.86, 0.82, 0.78)


def argval(argv, k, default):
    return argv[argv.index(k) + 1] if k in argv else default


def range_pose(root):
    """Both legs posed at range ends: left leg thigh swung forward 32 deg, knee bent; right thigh back 30, hock open."""
    emp = {o.name.split(".")[0]: o for o in root.children_recursive if o.type == "EMPTY"}
    rots = {"Thigh_L": (-0.56, 0, 0), "Shin_L": (0.95, 0, 0), "Meta_L": (-0.55, 0, 0), "Foot_L": (0.1, 0, 0),
            "Thigh_R": (0.52, 0, 0), "Shin_R": (0.25, 0, 0), "Meta_R": (0.45, 0, 0), "Foot_R": (-0.4, 0, 0)}
    for k, r in rots.items():
        if k in emp:
            emp[k].rotation_euler = Euler(r, "XYZ")
    bpy.context.view_layer.update()


def own(name, out, pose):
    S.HD = M
    if name == "gun_close":
        S.scene(1500, 1100)
        S.ground(60, LIGHT_GREY)
        _, info = S.mech(False, pose=pose)
        S.cam_look((-5.6, -6.4, 5.4), (-1.75, -0.9, 3.75), 50)
    elif name == "thigh_close":
        S.scene(1300, 1300)
        S.ground(60, LIGHT_GREY)
        _, info = S.mech(False, pose=pose)
        S.cam_look((3.9, -6.6, 3.3), (1.05, -0.2, 1.75), 50)
    elif name == "side_rest":
        S.scene(1300, 1000)
        S.ground(60, LIGHT_GREY)
        _, info = S.mech(False, pose="rest")
        S.human(0.0, -3.2, 0.0)
        S.cam_look((24, -0.6, 2.4), (0, -0.6, 2.4), 50, ortho=7.4)
    elif name == "front_rest":
        S.scene(1300, 1000)
        S.ground(60, LIGHT_GREY)
        _, info = S.mech(False, pose="rest")
        S.human(-3.2, -1.0, 0.0)
        S.cam_look((0, -30, 2.4), (0, 0, 2.4), 50, ortho=7.0)
    elif name == "top40":
        S.scene(1600, 1200, S.SAND, dil=0, crease=0.9)
        S.ground(200, S.SAND)
        _, info = S.mech(False, pose=pose)
        S.cam_look((0, -0.01, 40), (0, 0, 0), 24)
        bpy.context.scene.camera.data.sensor_width = 36
        bpy.context.scene.camera.data.lens = 70
    elif name == "range_legs":
        S.scene(1500, 1000)
        S.ground(60, LIGHT_GREY)
        root, info = S.mech(False, pose="rest")
        range_pose(root)
        S.cam_look((16, -9.5, 4.0), (0, -0.2, 2.3), 50, ortho=7.8)
    S.shot(out)
    return info


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    outdir = argval(argv, "--out", None)
    want = argval(argv, "--only", "mass_game40,mass_ref").split(",")
    tag = argval(argv, "--tag", "")
    pose = argval(argv, "--pose", "stance")
    S.POSE_MODE["mode"] = pose
    S.INK["mode"] = argval(argv, "--ink", "sepia")
    os.makedirs(outdir, exist_ok=True)
    mine = [w for w in want if w in OWN]
    rest = [w for w in want if w not in OWN]
    for w in mine:
        own(w, os.path.join(outdir, w + (("_" + tag) if tag else "") + ".png"), pose)
    if rest:
        keep = list(argv)
        if "--only" in keep:
            i = keep.index("--only")
            keep[i + 1] = ",".join(rest)
        else:
            keep += ["--only", ",".join(rest)]
        if "--model" not in keep:
            keep += ["--model", "rampart_siege"]
        sys.argv = [sys.argv[0], "--"] + keep
        S.main()


if __name__ == "__main__":
    main()
