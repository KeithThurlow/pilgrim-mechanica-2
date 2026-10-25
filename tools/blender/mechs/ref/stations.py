"""Section stations through a reference model: for each region box and station along an axis, bisect the mesh, keep the cut
segments inside the box, take the 2D convex hull and simplify it to <= K vertices (drop the vertex whose removal loses the
least area). The hulls feed `H.loft` stations directly.

    blender -b --factory-startup -P tools/blender/mechs/ref/stations.py -- <ref.fbx> <regions.json> <out.json> [--height 5.2]

regions.json: {"name": ["z", [1.5, 1.6, ...], [x0, x1, y0, y1, z0, z1], K], ...}  (axis, stations, box in metres at the game
height, max hull vertices). Hull points are (y, z) for an x axis, (x, z) for y, (x, y) for z.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

import refcommon as R  # noqa: E402


def hull(pts):
    pts = sorted(set((round(a, 4), round(b, 4)) for a, b in pts))
    if len(pts) < 3:
        return pts
    cr = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])  # noqa: E731
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def simplify(h, K):
    h = list(h)
    tri = lambda a, b, c: abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2  # noqa: E731
    while len(h) > K:
        i = min(range(len(h)), key=lambda i: tri(h[i - 1], h[i], h[(i + 1) % len(h)]))
        h.pop(i)
    return [(round(a, 3), round(b, 3)) for a, b in h]


AX = {"x": (1, 2), "y": (0, 2), "z": (0, 1)}


def main():
    a = R.args()
    fbx, regf, out = a[0], a[1], a[2]
    height = float(a[a.index("--height") + 1]) if "--height" in a else 5.2
    bm0, _ = R.load_scaled_bmesh(fbx, height)
    regs = json.load(open(regf))
    res = {}
    for name, (ax, sts, box, K) in regs.items():
        ia, ib = AX[ax]
        axi = "xyz".index(ax)
        res[name] = {"axis": ax, "st": {}}
        for st in sts:
            bm = bm0.copy()
            no = Vector([1.0 if i == axi else 0.0 for i in range(3)])
            r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=no * st, plane_no=no, dist=1e-6)
            pts = []
            for e in r["geom_cut"]:
                if isinstance(e, bmesh.types.BMEdge):
                    for v in e.verts:
                        p = v.co
                        if box[0] <= p.x <= box[1] and box[2] <= p.y <= box[3] and box[4] <= p.z <= box[5]:
                            pts.append((p[ia], p[ib]))
            bm.free()
            h = hull(pts)
            if len(h) >= 3:
                res[name]["st"]["%.2f" % st] = {"hull": simplify(h, K), "n": len(pts)}
    json.dump(res, open(out, "w"), indent=1)
    for name, d in res.items():
        print("REG", name, d["axis"])
        for st, v in d["st"].items():
            print("  ", st, v["hull"])


main()
