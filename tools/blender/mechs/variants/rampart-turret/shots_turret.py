"""Renders for the Rampart turret variant, on the Rampart study's toon look (studies/rampart/shots.py helpers).

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-turret/shots_turret.py -- --out <ABS DIR> \
        --only mass_game40,mass_q34,... [--pose stance|rest] [--ink thin] [--tag x]

A name starting with mass_ renders the mass layer flat; any other renders the full model. Views: game40, game40_crop (the
same camera at 3x), q34, front, side, top, back34, turret_close, roof_close, cheek_close, under_close, zoom10, front_legs,
layer_map, technique_map, layers_exploded, mass_vs_final.
"""
import argparse
import importlib.util
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
RAMP = os.path.join(MECHS, "studies", "rampart")
for p in (os.path.join(MECHS, "studies", "military"), MECHS, RAMP, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

spec = importlib.util.spec_from_file_location("rampart_turret", os.path.join(HERE, "rampart-turret.py"))
RT = importlib.util.module_from_spec(spec)
sys.modules["rampart_turret"] = RT
spec.loader.exec_module(RT)

import hskit as H  # noqa: E402
import shots as S  # noqa: E402

PAPER_G = (0.86, 0.82, 0.78)
CAMS = {   # name: (pos, target, lens, ortho)
    "q34": ((-9.5, -12.5, 8.0), (0.0, -0.2, 2.9), 50, None),
    "front": ((0, -30, 2.6), (0, 0, 2.6), 50, 6.6),
    "side": ((30, -0.2, 2.6), (0, -0.2, 2.6), 50, 6.6),
    "top": ((0, -0.001, 40), (0, -0.2, 0), 50, 6.6),
    "back34": ((9.0, 13.5, 7.0), (0, 0, 2.8), 50, None),
    "turret_close": ((-4.6, -6.4, 7.0), (0.0, -0.4, 4.2), 50, None),
    "roof_close": ((2.6, -3.6, 8.2), (0.0, 0.0, 4.6), 50, None),
    "cheek_close": ((-3.4, -4.6, 4.6), (-0.4, -1.0, 4.1), 50, None),
    "under_close": ((-4.8, -3.4, 2.6), (-0.4, 0.0, 3.8), 50, None),
    "rear_close": ((3.6, 5.0, 6.4), (0.0, 0.6, 4.2), 50, None),
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="mass_game40,mass_q34")
    ap.add_argument("--tag", default="")
    ap.add_argument("--ink", default="thin", choices=("sepia", "thin", "face"))
    ap.add_argument("--pose", default="stance", choices=("stance", "rest"))
    a = ap.parse_args(argv)
    S.POSE_MODE["mode"] = a.pose
    S.HD = RT
    S.INK["mode"] = a.ink
    os.makedirs(a.out, exist_ok=True)
    tag = ("_" + a.tag) if a.tag else ""
    out = lambda n: os.path.join(a.out, n + tag + ".png")  # noqa: E731
    info = {}
    for w in a.only.split(","):
        mass = w.startswith("mass_") and w != "mass_vs_final"
        v = w[5:] if mass else w
        if v in ("game40", "game40_crop"):
            S.scene(1920, 1080, S.SAND, dil=0, crease=0.9)
            S.ground(200, S.SAND)
            _, info = S.mech(mass)
            S.human(2.6, -1.2)
            cam = S.cam_game((0, 0, 1.6), 50, 40)
            if v == "game40_crop":
                cam.data.lens = 72
        elif v == "zoom10":
            S.scene(1920, 1080, S.SAND)
            S.ground(200, S.SAND)
            _, info = S.mech(mass, yaw=math.radians(-20))
            S.human(2.4, -1.6)
            S.cam_game((0.4, 0, 2.6), 45, 10)
        elif v in CAMS:
            S.scene(1400, 1100)
            S.ground(80, PAPER_G)
            _, info = S.mech(mass)
            if v in ("q34", "side", "front"):
                S.human(2.7, -1.6, 0.2)
            S.cam_look(*CAMS[v])
        elif v in ("front_legs", "front_legs_stance"):
            S.scene(1200, 1000)
            S.ground(60, PAPER_G)
            root, info = S.mech(False, pose="stance" if v.endswith("stance") else "rest")
            S.leg_guides(root)
            S.cam_look((0, -30, 1.9), (0, 0, 1.9), 50, ortho=4.6)
        elif v == "mass_vs_final":
            S.scene(1800, 900)
            S.ground(80, PAPER_G)
            S.mech(True, loc=(-2.8, 0, 0), pose="rest")
            _, info = S.mech(False, loc=(2.8, 0, 0), pose="rest")
            S.cam_look((-5.0, -26.0, 14.0), (0.0, 0.0, 3.2), 50, ortho=11.5)
        elif v in ("layer_map", "technique_map"):
            S.scene(1500, 1100)
            S.ground(60, PAPER_G)
            root, info = S.mech(False)
            S.paint_debug(S.meshes(root), "layer" if v == "layer_map" else "tag")
            S.cam_look((-7.5, -12.0, 7.0), (0, 0, 2.8), 50)
        elif v == "layers_exploded":
            S.scene(2400, 900)
            S.ground(200, PAPER_G)
            for i, lay in enumerate(("frame", "actuation", "power", "mounting", "plates", "seals", "heat", "service", "sensors",
                                     "weapon")):
                root, info = S.mech(False, layers={lay}, loc=((i - 4.5) * 3.6, 0, 0))
                S.paint_debug(S.meshes(root), "layer")
            S.cam_look((-4.0, -40.0, 12.0), (0, 0, 2.6), 50, ortho=37.0)
        else:
            print("unknown view", w)
            continue
        S.shot(out(w))
    with open(os.path.join(a.out, "shots_info%s.json" % tag), "w") as f:
        json.dump(info, f, indent=1, default=str)
    print("HSSTATS", json.dumps(H.report()["stats"]))


if __name__ == "__main__":
    main()
