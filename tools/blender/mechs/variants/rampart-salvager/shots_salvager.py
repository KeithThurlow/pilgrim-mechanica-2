"""Renders for the Rampart Salvager: rampart_v4's shots.py on this variant, plus its own close-ups.

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-salvager/shots_salvager.py -- --out <ABS DIR>
        --only mass_game40,game40,zoom10,cab_close,... [--pose rest|stance] [--ink thin] [--tag x]

Standard shots (studies/rampart/shots.py): mass_game40, mass_ref, mass_side, game40, zoom10, plates_close, back34,
layers_exploded, layer_map, technique_map, front_legs, feet_front, mass_vs_final, ...
Own shots: cab_close (front three-quarter of the cab), cab_side (the door side), roof_top (top-down on the rack),
cab_front (front ortho, the glazing frame), mass_cab_front (the same on the mass), massvsfinal_cab (the signature check).
"""
import importlib.util
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
RAMP = os.path.join(MECHS, "studies", "rampart")
for _p in (os.path.join(MECHS, "studies", "military"), MECHS, RAMP, HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

spec = importlib.util.spec_from_file_location("rampart_salvager", os.path.join(HERE, "rampart-salvager.py"))
MOD = importlib.util.module_from_spec(spec)
sys.modules["rampart_salvager"] = MOD
spec.loader.exec_module(MOD)

import shots as S  # noqa: E402

OWN = ("window_close", "cab_close", "cab_side", "roof_top", "cab_front", "mass_cab_front", "massvsfinal_cab", "cab_back34", "gun_close")
BG = (0.86, 0.82, 0.78)


def own(w, out):
    info = {}
    if w == "cab_close":
        S.scene(1500, 1200)
        S.ground(60, BG)
        _, info = S.mech(False)
        S.human(-2.2, -2.0, 0.4)
        S.cam_look((-4.4, -8.0, 6.4), (0.0, -0.3, 4.0), 50)
    elif w == "cab_side":
        S.scene(1500, 1200)
        S.ground(60, BG)
        _, info = S.mech(False, pose="rest")
        S.cam_look((7.5, -3.2, 5.4), (0.6, -0.3, 4.1), 50)
    elif w == "roof_top":
        S.scene(1300, 1300)
        S.ground(60, BG)
        _, info = S.mech(False, pose="rest")
        S.cam_look((0.0, -2.4, 13.0), (0.0, 0.1, 4.6), 50, ortho=3.4)
    elif w in ("cab_front", "mass_cab_front"):
        S.scene(1300, 1000)
        S.ground(60, BG)
        _, info = S.mech(w.startswith("mass"), pose="rest")
        S.cam_look((0.0, -30.0, 4.25), (0.0, 0.0, 4.25), 50, ortho=2.9)
    elif w == "massvsfinal_cab":
        S.scene(1800, 900)
        S.ground(80, BG)
        S.mech(True, loc=(-2.8, 0, 0), pose="rest")
        _, info = S.mech(False, loc=(2.8, 0, 0), pose="rest")
        S.cam_look((-1.0, -30.0, 6.0), (0.0, 0.0, 3.9), 50, ortho=9.0)
    elif w == "cab_back34":
        S.scene(1300, 1200)
        S.ground(60, BG)
        _, info = S.mech(False, pose="rest")
        S.cam_look((6.0, 7.5, 7.2), (0.0, 0.2, 4.2), 50)
    elif w == "window_close":
        S.scene(1300, 1000)
        S.ground(60, BG)
        _, info = S.mech(False, pose="rest")
        S.cam_look((3.4, -2.2, 4.9), (0.6, -0.45, 4.38), 50)
    elif w == "gun_close":
        S.scene(1400, 1100)
        S.ground(60, BG)
        _, info = S.mech(False, pose="rest")
        S.cam_look((-5.0, -5.5, 5.8), (-1.6, -0.6, 4.1), 50)
    S.shot(out)
    return info


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--model" not in argv:
        argv += ["--model", "rampart_salvager"]
    i = argv.index("--only") if "--only" in argv else -1
    want = argv[i + 1].split(",") if i >= 0 else ["mass_game40", "mass_ref"]
    std = [w for w in want if w not in OWN]
    mine = [w for w in want if w in OWN]
    if std:
        a2 = list(argv)
        if i >= 0:
            a2[i + 1] = ",".join(std)
        sys.argv = [sys.argv[0], "--"] + a2
        S.main()
    if mine:
        import argparse
        ap = argparse.ArgumentParser()
        ap.add_argument("--out", required=True)
        ap.add_argument("--only")
        ap.add_argument("--tag", default="")
        ap.add_argument("--model")
        ap.add_argument("--ink", default="sepia")
        ap.add_argument("--pose", default="stance")
        a = ap.parse_args(argv)
        S.HD = MOD
        S.INK["mode"] = a.ink
        S.POSE_MODE["mode"] = a.pose
        os.makedirs(a.out, exist_ok=True)
        tag = ("_" + a.tag) if a.tag else ""
        info = {}
        for w in mine:
            info = own(w, os.path.join(a.out, w + tag + ".png")) or info
        with open(os.path.join(a.out, "own_info%s.json" % tag), "w") as f:
            json.dump(info, f, indent=1, default=str)


main()
