"""Plot sections from sections.json onto metric grids. python plot.py <sections.json> <outdir> key1,key2,... <name> [x0 x1 y0 y1]"""
import json, sys, os
from PIL import Image, ImageDraw
src, out, keys, name = sys.argv[1], sys.argv[2], sys.argv[3].split(","), sys.argv[4]
d = json.load(open(src))
win = [float(v) for v in sys.argv[5:9]] if len(sys.argv) > 8 else None
COLS = [(200, 30, 30), (30, 120, 200), (30, 160, 60), (180, 100, 20), (140, 40, 160), (20, 150, 150), (90, 90, 90), (220, 140, 0)]


def axes(key):
    k = key[0]
    return {"z": (0, 1), "x": (1, 2), "y": (0, 2)}[k]   # z slice: plot x,y ; x slice: y,z ; y slice: x,z


segs_all = []
for i, k in enumerate(keys):
    a, b = axes(k)
    for p, q in d[k]:
        segs_all.append(((p[a], p[b]), (q[a], q[b]), COLS[i % len(COLS)]))
if not segs_all:
    print("empty"); sys.exit()
if win:
    x0, x1, y0, y1 = win
else:
    xs = [p[0] for s in segs_all for p in s[:2]]; ys = [p[1] for s in segs_all for p in s[:2]]
    x0, x1, y0, y1 = min(xs) - 0.1, max(xs) + 0.1, min(ys) - 0.1, max(ys) + 0.1
S = 900 / max(x1 - x0, y1 - y0)
W, H = int((x1 - x0) * S) + 40, int((y1 - y0) * S) + 40
im = Image.new("RGB", (W, H), (250, 250, 248)); dr = ImageDraw.Draw(im)
f = lambda x, y: (20 + (x - x0) * S, H - 20 - (y - y0) * S)  # noqa
import math
g = 0.1
k0 = math.floor(x0 / g)
while k0 * g <= x1:
    xx = k0 * g; c = (200, 200, 200) if k0 % 5 else (150, 150, 150)
    if abs(xx) < 1e-6: c = (60, 60, 60)
    dr.line([f(xx, y0), f(xx, y1)], fill=c); k0 += 1
k0 = math.floor(y0 / g)
while k0 * g <= y1:
    yy = k0 * g; c = (200, 200, 200) if k0 % 5 else (150, 150, 150)
    if abs(yy) < 1e-6: c = (60, 60, 60)
    dr.line([f(x0, yy), f(x1, yy)], fill=c); k0 += 1
for p, q, c in segs_all:
    dr.line([f(*p), f(*q)], fill=c, width=2)
for i, k in enumerate(keys):
    dr.text((24, 6 + 12 * i), k, fill=COLS[i % len(COLS)])
dr.text((W - 260, 6), "grid 0.1 m, bold 0.5 m; %s" % name, fill=(0, 0, 0))
im.save(os.path.join(out, name + ".png"))
print("saved", name, (x0, x1, y0, y1))
