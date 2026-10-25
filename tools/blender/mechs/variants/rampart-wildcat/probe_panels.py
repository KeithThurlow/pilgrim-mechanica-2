"""Lists rampart_v4's plate panels (loose islands of each part's Plates piece): world centroid, area, mean colour.
Used once to pick which panels the Wildcat repaints as mismatched salvage.

    node tools/blender/run.mjs tools/blender/mechs/variants/rampart-wildcat/probe_panels.py -- --out <file.json>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STUDY = os.path.join(os.path.dirname(os.path.dirname(HERE)), "studies", "rampart")
sys.path.insert(0, HERE)
sys.path.insert(0, STUDY)

import rampart_v4 as R  # noqa: E402
from wildcat_util import islands  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[argv.index("--out") + 1]
R.V.clear_scene()
res = {}
for pt in R.build_parts():
    P = pt.layers.get("plates")
    if P is None:
        continue
    rows = []
    for faces in islands(P.bm):
        area = sum(f.calc_area() for f in faces)
        c = sum((f.calc_center_median() * f.calc_area() for f in faces), R.V3()) / max(area, 1e-9) + P.origin
        col = [0.0, 0.0, 0.0]
        for f in faces:
            a = f.calc_area()
            cc = f.loops[0][P.col]
            for i in range(3):
                col[i] += cc[i] * a / max(area, 1e-9)
        if area > 0.01:
            rows.append({"c": [round(x, 2) for x in c], "area": round(area, 3), "col": [round(x, 2) for x in col], "n": len(faces)})
    res[pt.name] = sorted(rows, key=lambda r: -r["area"])
with open(out, "w") as f:
    json.dump(res, f, indent=0)
print("PROBE done", out)
