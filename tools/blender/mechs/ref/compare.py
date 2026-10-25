"""Side-by-side and silhouette overlay: python compare.py <ref_dir> <ref_prefix> <ours_dir> <ours_prefix> <outdir> views...
Overlay: ref only = blue, ours only = red, both = grey. Prints IoU per view."""
import sys, os
from PIL import Image, ImageChops
rd, rp, od, op, out = sys.argv[1:6]
views = sys.argv[6:]
os.makedirs(out, exist_ok=True)


def mask(im):
    im = im.convert("RGB")
    bg = im.getpixel((2, 2))
    w, h = im.size
    px = im.load()
    m = Image.new("L", im.size, 0)
    mp = m.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) > 24:
                mp[x, y] = 255
    return m


for v in views:
    a = Image.open(os.path.join(rd, rp + v + ".png")).convert("RGB")
    b = Image.open(os.path.join(od, op + v + ".png")).convert("RGB").resize(a.size)
    sbs = Image.new("RGB", (a.width * 2, a.height), (255, 255, 255))
    sbs.paste(a, (0, 0)); sbs.paste(b, (a.width, 0))
    sbs.save(os.path.join(out, "sbs_" + v + ".png"))
    if v == "game40":
        continue
    mp_ = os.path.join(rd, "m_" + v + ".png")
    ma, mb = mask(Image.open(mp_) if os.path.exists(mp_) else a), mask(b)
    ov = Image.new("RGB", a.size, (250, 250, 250))
    pa, pb, po = ma.load(), mb.load(), ov.load()
    inter = uni = 0
    for y in range(a.height):
        for x in range(a.width):
            A, B = pa[x, y] > 0, pb[x, y] > 0
            if A and B: po[x, y] = (150, 150, 150); inter += 1
            elif A: po[x, y] = (40, 90, 230)
            elif B: po[x, y] = (230, 50, 40)
            uni += A or B
    ov.save(os.path.join(out, "ov_" + v + ".png"))
    print(v, "IoU %.3f" % (inter / max(1, uni)))
