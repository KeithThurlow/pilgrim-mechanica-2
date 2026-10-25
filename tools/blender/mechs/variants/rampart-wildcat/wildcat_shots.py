"""Renders of the Wildcat with the Rampart study's shots.py (same cameras and toon look).

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-wildcat/wildcat_shots.py -- --out <ABS DIR> \
        --only game40,zoom10,ref,back34,plates_close,mass_vs_final,front_legs,layer_map [--pose rest|stance] [--ink thin]
Extra shot `compare_v4`: v4 (left) and the Wildcat (right) at rest, front three-quarter from above.
"""
import importlib.util
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STUDY = os.path.join(os.path.dirname(os.path.dirname(HERE)), "studies", "rampart")
sys.path.insert(0, HERE)
sys.path.insert(0, STUDY)

spec = importlib.util.spec_from_file_location("rampart_wildcat", os.path.join(HERE, "rampart-wildcat.py"))
mod = importlib.util.module_from_spec(spec)
sys.modules["rampart_wildcat"] = mod
spec.loader.exec_module(mod)

import shots  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--model" not in argv:
    argv += ["--model", "rampart_wildcat"]
extra = []
if "--only" in argv:
    i = argv.index("--only") + 1
    want = argv[i].split(",")
    extra = [w for w in want if w in ("compare_v4", "top40", "leg_l_close", "torso_top")]
    argv[i] = ",".join(w for w in want if w not in extra) or "none"
sys.argv = [sys.argv[0], "--"] + argv
shots.main()

out = argv[argv.index("--out") + 1]
for w in extra:
    import bpy  # noqa: E402
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    if w == "compare_v4":
        shots.scene(1800, 1000, shots.SAND)
        shots.ground(120, shots.SAND)
        mod.K.bake_all = mod._orig_bake
        mod.R.build_parts = mod._orig_build_parts
        shots.mech(False, loc=(-3.3, 0, 0), model=mod.R, pose="rest")
        mod.R.build_parts = mod.build_parts
        mod.K.bake_all = mod._bake_heavy
        shots.mech(False, loc=(3.3, 0, 0), model=mod, pose="rest")
        shots.cam_look((-6.0, -24.0, 17.0), (0.0, 0.0, 2.6), 50, ortho=13.5)
        shots.shot(os.path.join(out, "compare_v4.png"))
    elif w == "top40":
        # the game camera at 40 m, cropped close (the skill's 3x crop of the 160 px mech)
        shots.scene(1200, 1200, shots.SAND, dil=0, crease=0.9)
        shots.ground(200, shots.SAND)
        shots.mech(False)
        cam = shots.cam_game((0, 0, 2.2), 50, 40)
        cam.data.lens = 72
        shots.shot(os.path.join(out, "game40_crop.png"))
    elif w == "leg_l_close":
        # the left leg's outer side: the track skirt on the cannon, the yellow knee cap, the primer horn
        shots.scene(1300, 1300)
        shots.ground(60, (0.86, 0.82, 0.78))
        shots.mech(False)
        shots.cam_look((5.6, -3.0, 2.4), (1.2, 0.1, 1.3), 50)
        shots.shot(os.path.join(out, "leg_l_close.png"))
    elif w == "torso_top":
        # the hull from above and behind the left shoulder: sandbags, the tyre, the cage, the antenna
        shots.scene(1400, 1100)
        shots.ground(60, (0.86, 0.82, 0.78))
        shots.mech(False)
        shots.cam_look((4.5, 4.0, 9.0), (0.0, 0.3, 4.5), 50)
        shots.shot(os.path.join(out, "torso_top.png"))
