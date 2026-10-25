"""Raw plane sections of a reference model at the game height, for plotting with plot.py (0.1 m grid).

    blender -b --factory-startup -P tools/blender/mechs/ref/sections.py -- <ref.fbx> <out.json> [--height 5.2]
        [--z 0.1:5.1:0.1] [--x -2,-1.4,...] [--y -1.2,-0.6,...]

Keys are "z1.50", "x-0.90", "y0.30"; each holds the cut segments [[p, q], ...] in world metres.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

import refcommon as R  # noqa: E402


def vals(spec):
    if ":" in spec:
        a, b, s = (float(x) for x in spec.split(":"))
        return [round(a + s * k, 3) for k in range(int(round((b - a) / s)) + 1)]
    return [float(x) for x in spec.split(",") if x]


def main():
    a = R.args()
    fbx, out = a[0], a[1]
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d  # noqa: E731
    bm0, _ = R.load_scaled_bmesh(fbx, float(opt("--height", "5.2")))
    res = {}
    for ax, spec in (("z", opt("--z", "0.1:5.1:0.1")), ("x", opt("--x", "-2,-1.4,-0.9,-0.45,0,0.45,0.9,1.4,2")),
                     ("y", opt("--y", "-1.2,-0.6,0,0.6"))):
        axi = "xyz".index(ax)
        for v in vals(spec):
            bm = bm0.copy()
            no = Vector([1.0 if i == axi else 0.0 for i in range(3)])
            r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=no * v, plane_no=no, dist=1e-5)
            res["%s%.2f" % (ax, v)] = [[list(e.verts[0].co), list(e.verts[1].co)] for e in r["geom_cut"]
                                       if isinstance(e, bmesh.types.BMEdge)]
            bm.free()
    json.dump(res, open(out, "w"))
    print("SECTIONS", len(res))


main()
