"""Renders for Rampart Rocket: builds the mech once, then renders every asked view (studies/rampart/shots.py rebuilds
per view, which costs a Blender slot for minutes). Uses that script's toon look, ground, pilot and cameras.

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-rocket/shots_rocket.py -- --out <ABS DIR>
        [--only game40,zoom10,...] [--mass] [--pose stance|rest] [--tag x]

Views: game40 (+ game40_x3, the 3x crop), zoom10, q34, pod_close, face_close, front, side, top, back34, legs_front,
layer_map (last: it repaints the meshes).
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MECHS = os.path.dirname(os.path.dirname(HERE))
RAMP = os.path.join(MECHS, "studies", "rampart")
for p in (HERE, RAMP, MECHS, os.path.join(MECHS, "studies", "military")):
    if p not in sys.path:
        sys.path.insert(0, p)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import shots as S  # noqa: E402
import rampart_rocket as M  # noqa: E402
import hskit as H  # noqa: E402

LIGHT_BG = (0.86, 0.82, 0.78)


def views():
    return {
        "game40": (1920, 1080, "game", lambda: S.cam_game((0, 0, 1.6), 50, 40)),
        "game40_x3": (1920, 1080, "game", lambda: lens(S.cam_game((0, 0, 1.6), 50, 40), 72)),
        "zoom10": (1920, 1080, "game", lambda: S.cam_game((0.0, 0, 2.8), 45, 10)),
        "q34": (1300, 1100, "paper", lambda: S.cam_look((-7.8, -10.5, 6.8), (0, 0, 3.0), 50)),
        "pod_close": (1400, 1100, "paper", lambda: S.cam_look((-4.6, -5.2, 6.4), (-1.75, -0.4, 4.45), 50)),
        "face_close": (1300, 1100, "paper", lambda: S.cam_look((-2.6, -5.4, 4.9), (-1.6, -0.9, 4.45), 50)),
        "front": (1100, 1000, "paper", lambda: S.cam_look((0, -30, 2.7), (0, 0, 2.7), 50, ortho=6.8)),
        "side": (1100, 1000, "paper", lambda: S.cam_look((-30, 0, 2.7), (0, 0, 2.7), 50, ortho=6.8)),
        "top": (1000, 1000, "paper", lambda: S.cam_look((0, -0.001, 40), (0, 0, 0), 50, ortho=6.4)),
        "back34": (1100, 1100, "paper", lambda: S.cam_look((9.0, 13.5, 6.6), (0, 0, 3.0), 50)),
        "legs_front": (1200, 1000, "paper", lambda: S.cam_look((0, -30, 1.9), (0, 0, 1.9), 50, ortho=4.6)),
        "layer_map": (1500, 1100, "paper", lambda: S.cam_look((-7.5, -12.0, 6.0), (0, 0, 2.8), 50)),
    }


def lens(cam, mm):
    cam.data.lens = mm
    return cam


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="game40,game40_x3,zoom10,q34,pod_close,front,side")
    ap.add_argument("--mass", action="store_true")
    ap.add_argument("--pose", default="stance", choices=("stance", "rest"))
    ap.add_argument("--tag", default="")
    ap.add_argument("--ink", default="thin", choices=("sepia", "thin", "face"))
    a = ap.parse_args(argv)
    S.INK["mode"] = a.ink
    S.POSE_MODE["mode"] = a.pose
    S.HD = M
    os.makedirs(a.out, exist_ok=True)
    tag = ("_" + a.tag) if a.tag else ""
    sc = S.scene(1920, 1080, S.SAND, dil=0, crease=0.9)
    g_sand = S.ground(200, S.SAND)
    g_paper = S.ground(80, LIGHT_BG, z=-0.002)
    root, info = S.mech(a.mass)
    S.human(-2.9, -1.4, 0.2)
    want = a.only.split(",")
    V = views()
    for w in want:
        res_x, res_y, kind, cam = V[w]
        sc.render.resolution_x, sc.render.resolution_y = res_x, res_y
        game = kind == "game"
        g_sand.hide_render, g_paper.hide_render = not game, game
        S.compositor(sc, S.SAND if game else S.PAPER, 0 if game else 1, 0.9 if game else 0.55)
        if w == "layer_map":
            S.paint_debug(S.meshes(root), "layer")
        guides = []
        if w == "legs_front":           # the knock-knee guides only in this view
            before = set(bpy.data.objects)
            S.leg_guides(root)
            guides = [o for o in bpy.data.objects if o not in before]
        cam()
        S.shot(os.path.join(a.out, w + ("_mass" if a.mass else "") + tag + ".png"))
        for o in guides:
            bpy.data.objects.remove(o, do_unlink=True)
    keep = {k: info[k] for k in ("tris_total", "tris_by_part", "tris_by_layer", "axis_aligned_plates", "legs", "hskit")
            if k in info}
    with open(os.path.join(a.out, "info%s%s.json" % ("_mass" if a.mass else "", tag)), "w") as f:
        json.dump(keep, f, indent=1)
    print("HSSTATS", json.dumps(H.report()["stats"]))
    print("TRIS", info.get("tris_total"), json.dumps(info.get("tris_by_part", {})))
    if "axis_aligned_plates" in info:
        print("AXIS", json.dumps({k: v["share"] for k, v in info["axis_aligned_plates"].items()}))


if __name__ == "__main__":
    main()
