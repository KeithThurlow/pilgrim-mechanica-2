"""Study kit for the lean military mech (2026-10-21, asset-smith).

Builds on the vehicle kit (tools/blender/vehicles/vkit.py, imported read-only) and adds what a mech needs past the van
(Keith 2026-10-21: "no part of the mech is a plain box or cylinder"):

- `lofted`: a limb segment lofted through several stations, each an asymmetric section (front deeper than back, its own
  front and back chamfers, a raised front ridge that can sit off centre), offset per station, so a thigh swells, kinks and
  narrows along its length instead of being a box between two joints.
- `plate`: an armour plate bowed across its width and sagged along its length, tapered, with bevelled ends and a thin
  edge lip, laid on a surface frame (u along the width, v along the length, n outward). Layered over the structure.
- `drum`: a lathe profile on an axis (flange, body, step, cap) for joint housings, with an optional bolt circle.
- `piston`: a hydraulic ram between two points: a stepped barrel with a collar and gland, a thinner bright rod, eye ends.
- `stencil`: seven-segment stencil numerals and bars laid on a plate (big painted markings).
- `hazard`: diagonal stripe band round a limb.
- `bake_all`: raycast ambient occlusion over every piece at once, stepped into the deep tone in crevices, plus a light
  per-facet tone wobble, chipped edges on chamfer faces and dust low down, into the Color layer; a one-hot Section layer
  (R primary, G secondary, B trim, A glow, black = dark metal; the hf_kit code) so paint schemes can recolour.

Conventions (as hf_kit): 1 unit = 1 m, Z up, front = -Y, the mech's left = +X. Every piece is built in world rest-pose
coordinates; a vkit Piece subtracts its origin (the joint it turns about).
"""
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_TOOLS = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.join(BLENDER_TOOLS, "vehicles"))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector, noise  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import vkit as V  # noqa: E402  (read-only import; never edited from here)
from vkit import (Piece, prim, blk, bar, sweep, beam, pipe, bolt, bolt_row, pipe_run, cable_loom, louvres,  # noqa: E402,F401
                  heat_sink, surf_blk, frame_mat, basis_from, tube_along, round_path, hex_lamp, NOBAKE)

# Our paint sections, in the hf_kit order. vkit's section names map onto them.
SECTIONS = ["primary", "secondary", "trim", "dark_metal", "glow"]
SECTION_CODE = [(1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 0), (0, 0, 0, 1)]
FROM_VKIT = {"primary": 0, "secondary": 1, "trim": 2, "cargo": 2, "dark": 3, "tyre": 3, "sand": 3, "glow": 4, "glass": 3}
X = Vector((1, 0, 0))
Z = Vector((0, 0, 1))


def frame(a, b, across=X):
    """(along, across, front) for a segment a->b: along the bone, across ~ world X, front = along x across (faces -Y for a
    bone that points down)."""
    a, b = Vector(a), Vector(b)
    al = (b - a).normalized()
    ac = Vector(across) - al * al.dot(Vector(across))
    if ac.length < 1e-4:
        ac = Vector((0, 1, 0)) - al * al.y
    ac.normalize()
    fr = al.cross(ac).normalized()
    return al, ac, fr


def section(hw, f, b, cf, cb, ridge=0.0, rx=0.0):
    """Nine-point asymmetric section in (across, front) coords: half width hw, front depth f, back depth b, front chamfer cf,
    back chamfer cb, a ridge raised `ridge` in front of the front face at across = rx * hw (an off-centre crease)."""
    cfl, cfr = cf if isinstance(cf, tuple) else (cf, cf)
    cbl, cbr = cb if isinstance(cb, tuple) else (cb, cb)
    cfl, cfr = min(cfl, hw * 0.8, f * 0.9), min(cfr, hw * 0.8, f * 0.9)
    cbl, cbr = min(cbl, hw * 0.8, b * 0.9), min(cbr, hw * 0.8, b * 0.9)
    return [(-hw + cbl, -b), (hw - cbr, -b), (hw, -b + cbr), (hw, f - cfr), (hw - cfr, f), (rx * hw, f + ridge),
            (-hw + cfl, f), (-hw, f - cfl), (-hw, -b + cbl)]


def lofted(P, a, b, stations, mat="primary", col=(0.5, 0.5, 0.5), across=X, jitter=0.02, flag=0):
    """A limb lofted from a to b. stations: dicts or tuples (t, hw, f, b, cf, cb, ridge, rx, ox, of): t 0-1 along a->b,
    the section, and an offset ox across / of to the front. Returns faces."""
    a, b = Vector(a), Vector(b)
    al, ac, fr = frame(a, b, across)
    ln = (b - a).length
    rings = []
    for s in stations:
        s = tuple(s) + (0.0,) * (10 - len(s))
        t, hw, f, bk, cf, cb, rg, rx, ox, of = s
        c = a + al * (t * ln) + ac * ox + fr * of
        rings.append([c + ac * x + fr * y for x, y in section(hw, f, bk, cf, cb, rg, rx)])
    return prim(P, rings, mat, col, flag, None, jitter=jitter)


def plate(P, c, u, v, n, w, h, t=0.05, bow=0.04, sag=0.0, taper=0.0, skew=0.0, ch=0.05, mat="primary",
          col=(0.5, 0.5, 0.5), m=5, lip=True, flag=0):
    """An armour plate centred at c on a surface (u across its width, v along its length, n outward): bowed `bow` across,
    sagged `sag` along (outward at the middle), tapered (the +v end narrower by `taper` of the width), skewed (the +v end
    shifted along u by skew * w), ends bevelled by ch. The underside follows the curve, so it can lie on a curved shell."""
    c, u, v, n = Vector(c), Vector(u).normalized(), Vector(v).normalized(), Vector(n).normalized()
    rings = []
    ts = [-0.5, -0.5 + min(0.45, ch / h)] + [(-0.5 + (i + 1) / m) * 0.98 for i in range(m - 1)] + [0.5 - min(0.45, ch / h), 0.5]
    ts = sorted(set(round(x, 4) for x in ts))
    for i, s in enumerate(ts):
        end = (i == 0 or i == len(ts) - 1)
        hw = w / 2 * (1 - taper * (s + 0.5))
        if end:
            hw -= ch * 0.6
        tt = t * (0.45 if end else 1.0)
        off = sag * (1 - 4 * s * s)
        cc = c + v * (s * h) + u * (skew * w * (s + 0.5)) + n * off
        ring = []
        xs = [(-1.0, 0.35), (-0.86, 1.0), (0.0, 1.0), (0.86, 1.0), (1.0, 0.35), (1.0, 0.0), (0.0, 0.0), (-1.0, 0.0)]
        for x, k in xs:
            zc = bow * (1 - x * x)
            z = zc + (tt * k if k > 0 else 0.0)
            if lip and k == 1.0 and abs(x) > 0.8:
                z += tt * 0.25     # a raised rolled edge just inside the bevel
            ring.append(cc + u * (x * hw) + n * z)
        rings.append(ring)
    return prim(P, rings, mat, col, flag, None, jitter=0.015)


def lathe(P, c, axis, profile, n=12, mat="dark", col=(0.2, 0.2, 0.2), phase=0.0, jitter=0.02, flag=0, squash=1.0):
    """A solid of revolution: profile = [(x along the axis, radius), ...]. squash flattens it on the second radial axis."""
    c, ax = Vector(c), Vector(axis).normalized()
    u = ax.cross(Z if abs(ax.z) < 0.9 else X).normalized()
    w = ax.cross(u)
    rings = []
    for x, r in profile:
        rings.append([c + ax * x + u * (math.cos(phase + 2 * math.pi * k / n) * r)
                      + w * (math.sin(phase + 2 * math.pi * k / n) * r * squash) for k in range(n)])
    return prim(P, rings, mat, col, flag, None, jitter=jitter)


def drum(P, c, axis, r, w, mat="dark", col=(0.2, 0.2, 0.2), cap_col=None, bolts=6, n=12, hub=True):
    """A joint housing: a chamfered flange, a waisted body, a stepped cap and a hub boss, symmetric about c on the axis,
    with a bolt circle on each cap."""
    h = w / 2
    prof = [(-h, r * 0.62), (-h + 0.03, r * 0.9), (-h * 0.75, r), (-h * 0.35, r * 0.93), (h * 0.35, r * 0.93),
            (h * 0.75, r), (h - 0.03, r * 0.9), (h, r * 0.62)]
    out = lathe(P, c, axis, prof, n, mat, col)
    ax = Vector(axis).normalized()
    if hub:
        for s in (-1, 1):
            lathe(P, Vector(c) + ax * s * h, ax * s, [(0.0, r * 0.5), (0.03, r * 0.5), (0.05, r * 0.36), (0.08, r * 0.3),
                                                    (0.09, r * 0.12)], 8, "trim", cap_col or (0.55, 0.52, 0.46))
    if bolts:
        u = ax.cross(Z if abs(ax.z) < 0.9 else X).normalized()
        wv = ax.cross(u)
        for s in (-1, 1):
            for k in range(bolts):
                ang = 2 * math.pi * (k + 0.5) / bolts
                p = Vector(c) + ax * s * h + (u * math.cos(ang) + wv * math.sin(ang)) * r * 0.74
                bolt(P, p, ax * s, 0.022, 0.02, "trim", (0.5, 0.48, 0.42))
    return out


def piston(P, a, b, r=0.06, split=0.55, col=(0.18, 0.18, 0.19), rod_col=(0.62, 0.6, 0.55), sleeve=None):
    """Hydraulic ram a->b: eye, stepped barrel with a collar and a gland, the rod, the far eye."""
    a, b = Vector(a), Vector(b)
    d = b - a
    ln = d.length
    ax = d.normalized()
    bl = ln * split
    lathe(P, a, ax, [(-r * 0.6, r * 0.55), (r * 0.5, r * 0.55), (r * 0.8, r * 1.05), (r * 1.6, r * 1.15), (bl * 0.5, r * 1.0),
                      (bl * 0.55, r * 1.25), (bl * 0.62, r * 1.25), (bl * 0.67, r * 1.0), (bl - r * 0.6, r * 1.0),
                      (bl - r * 0.3, r * 1.2), (bl, r * 0.8)], 8, "dark", sleeve or col)
    lathe(P, a, ax, [(bl - 0.02, r * 0.5), (ln - r * 0.9, r * 0.5), (ln - r * 0.7, r * 0.75), (ln + r * 0.5, r * 0.6)], 6,
          "trim", rod_col)


def stencil_digit(P, ch, c, u, v, n, h, mat="secondary", col=(0.85, 0.8, 0.68), t=0.003, off=0.0):
    """One stencil character (0-9, '-', '|') as raised paint bars, h tall, on a surface frame."""
    segs = {"0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgecd", "7": "abc",
            "8": "abcdefg", "9": "abcdfg", "-": "g", "|": "bc"}[ch]
    w = h * 0.55
    s = h * 0.13
    gap = s * 0.35
    geo = {"a": (0, h / 2, w - 2 * gap, s), "g": (0, 0, w - 2 * gap, s), "d": (0, -h / 2, w - 2 * gap, s),
           "f": (-w / 2, h / 4, s, h / 2 - 2 * gap), "b": (w / 2, h / 4, s, h / 2 - 2 * gap),
           "e": (-w / 2, -h / 4, s, h / 2 - 2 * gap), "c": (w / 2, -h / 4, s, h / 2 - 2 * gap)}
    for k in segs:
        x, y, sw, sh = geo[k]
        surf_blk(P, Vector(c) + Vector(u) * x + Vector(v) * y, u, v, n, sw, sh, t, mat, col, off=off)
    return w


def stencil(P, text, c, u, v, n, h, mat="secondary", col=(0.85, 0.8, 0.68), off=0.0):
    """A string of stencil characters centred at c."""
    u, v, n = Vector(u).normalized(), Vector(v).normalized(), Vector(n).normalized()
    adv = h * 0.8
    x0 = -adv * (len(text) - 1) / 2
    for i, chh in enumerate(text):
        if chh != " ":
            stencil_digit(P, chh, Vector(c) + u * (x0 + i * adv), u, v, n, h, mat, col, off=off)


def hazard(P, c, u, v, n, w, h, stripes=5, a_col=(0.86, 0.66, 0.16), b_col=(0.16, 0.15, 0.14), off=0.0, t=0.012,
           slant=0.6):
    """A hazard band on a surface patch: a dark backing and slanted paint parallelograms cut to the band's edges."""
    u, v, n = Vector(u).normalized(), Vector(v).normalized(), Vector(n).normalized()
    c = Vector(c)
    surf_blk(P, c, u, v, n, w, h, t * 0.6, "dark", b_col, off=off)
    pitch = w / stripes
    sk = h * slant
    for i in range(stripes):
        x0 = -w / 2 + i * pitch
        quad = [(x0, -h / 2), (x0 + pitch * 0.5, -h / 2), (x0 + pitch * 0.5 + sk, h / 2), (x0 + sk, h / 2)]
        quad = [(max(-w / 2, min(w / 2, x)), y) for x, y in quad]
        rings = []
        for z in (off + t * 0.6, off + t * 1.2):
            rings.append([c + u * x + v * y + n * z for x, y in quad])
        prim(P, rings, "trim", a_col, 0, None, jitter=0.01)


def seam(P, a, b, n, w=0.014, t=0.006, col=(0.2, 0.19, 0.17)):
    """A panel seam: a thin dark strip laid on a surface from a to b (the ink pass draws its edges as crease lines)."""
    a, b, n = Vector(a), Vector(b), Vector(n).normalized()
    d = b - a
    if d.length < 1e-4:
        return
    u = d.normalized()
    v = n.cross(u)
    surf_blk(P, (a + b) / 2, u, v, n, d.length, w, t, "dark", col)


# ---------------------------------------------------------------------------------------------------------------- bake
def bake_all(pieces, pal, seed=0, ao_rays=20, ao_dist=0.55, wear=0.35, dust=0.25, deep=0.62):
    """Colours every piece's loops in place (before emit). pieces: list of vkit Pieces built in world coords minus origin.
    The palette maps our section names to sRGB; base colour = palette[section] x the per-primitive tint the builder gave
    (the builder colour is read as a tint relative to a neutral 0.5 grey only for 'tint' faces; here the builder colours
    are the final paint, so the palette only supplies glow and the AO / wear treatment)."""
    verts, tris = [], []
    for P in pieces:
        base = len(verts)
        idx = {}
        for vv in P.bm.verts:
            idx[vv] = len(verts)
            verts.append(vv.co + P.origin)
        for f in P.bm.faces:
            vs = [idx[l.vert] for l in f.loops]
            for k in range(1, len(vs) - 1):
                tris.append((vs[0], vs[k], vs[k + 1]))
    gb = len(verts)
    verts += [Vector((-40, -40, 0)), Vector((40, -40, 0)), Vector((40, 40, 0)), Vector((-40, 40, 0))]
    tris += [(gb, gb + 1, gb + 2), (gb, gb + 2, gb + 3)]
    tree = BVHTree.FromPolygons(verts, tris)
    dirs = []
    for i in range(ao_rays):
        uu, vv = (i + 0.5) / ao_rays, (i * 0.61803398875) % 1.0
        r = math.sqrt(uu)
        dirs.append(Vector((r * math.cos(2 * math.pi * vv), r * math.sin(2 * math.pi * vv), math.sqrt(1 - uu))))
    s0 = Vector((seed * 1.7 + 3.1, seed * 0.9 + 7.7, seed * 0.4 + 1.3))
    for P in pieces:
        bm = P.bm
        bm.normal_update()
        ao = {}
        for vv in bm.verts:
            nrm = vv.normal.copy()
            if nrm.length < 1e-6:
                nrm = Z.copy()
            t = nrm.cross(Z if abs(nrm.z) < 0.9 else X).normalized()
            bt = nrm.cross(t)
            p = vv.co + P.origin + nrm * 0.012
            hit = 0
            for d in dirs:
                loc, _, _, _ = tree.ray_cast(p, t * d.x + bt * d.y + nrm * d.z, ao_dist)
                if loc is not None:
                    hit += 1
            ao[vv] = hit / ao_rays
        P.sec_out = []
        for f in bm.faces:
            vsec = V.SECTIONS[f[P.sec]]
            s = FROM_VKIT.get(vsec, 3)
            P.sec_out.append(s)
            if f[P.flag] & NOBAKE or s == 4:
                continue
            cen = f.calc_center_median() + P.origin
            fr = (math.sin(f.index * 12.9898 + seed * 78.233) * 43758.5453) % 1.0
            tone = 1.0 + (fr - 0.5) * 0.012   # near-flat: one lit tone per section, no patchwork
            # chamfer strips: small faces whose normal sits between two big ones; chip some of them to bare metal
            chip = 0.0
            if s in (0, 1) and f.calc_area() < 0.006:
                nz = noise.noise(cen * 2.3 + s0)
                if nz > 0.55 - wear * 0.6:
                    chip = 0.4
            for l in f.loops:
                c = Vector(l[P.col][:3]) * tone
                a = ao[l.vert]
                if a > deep:
                    c *= 0.72          # the deep accent: one hard step, only in real crevices
                if chip:
                    c = c.lerp(Vector(pal["bare"]), chip)
                p = l.vert.co + P.origin
                low = max(0.0, 1.0 - p.z / 0.9)
                n1 = noise.noise(p * 1.3 + s0) * 0.5 + 0.5
                c = c.lerp(Vector(pal["dust"]), min(0.6, dust * low * (0.6 + 0.8 * n1)))
                l[P.col] = (min(1, c.x), min(1, c.y), min(1, c.z), 1.0)


def material(name, rgb):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*rgb, 1.0)
    return m


PREVIEW = {"primary": (0.55, 0.5, 0.38), "secondary": (0.35, 0.33, 0.27), "trim": (0.85, 0.65, 0.2),
           "dark_metal": (0.13, 0.13, 0.13), "glow": (1.0, 0.7, 0.3)}


def emit(P, parent, loc):
    """Turns a baked piece into a mesh object under parent at loc (relative to the parent): material slots per our five
    sections, Color (paint x AO x wear, sRGB) and Section (one-hot) corner layers, flat shaded."""
    bm = P.bm
    me = bpy.data.meshes.new(P.name)
    cols = [tuple(l[P.col]) for f in bm.faces for l in f.loops]
    secs = list(P.sec_out)
    bm.to_mesh(me)
    bm.free()
    for s in SECTIONS:
        me.materials.append(material("Mech_" + s, PREVIEW[s]))
    for poly, s in zip(me.polygons, secs):
        poly.material_index = s
        poly.use_smooth = False
    ca = me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    sa = me.color_attributes.new("Section", "BYTE_COLOR", "CORNER")
    i = 0
    for poly, s in zip(me.polygons, secs):
        for _ in poly.loop_indices:
            ca.data[i].color_srgb = cols[i]
            sa.data[i].color_srgb = SECTION_CODE[s]
            i += 1
    me.update()
    me.calc_loop_triangles()
    P.tris = len(me.loop_triangles)
    obj = bpy.data.objects.new(P.name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    return obj
