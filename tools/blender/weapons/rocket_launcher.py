"""W1 (docs/asset-list.md): the RPG rocket launcher, hull (M) and shoulder (M), plus its rocket.

    blender -b --factory-startup -P tools/blender/weapons/rocket_launcher.py -- [--out DIR] [--only hull,shoulder,rocket]
    (or through tools/blender/run.mjs, which queues Blender runs on Keith's PC)

Writes public/models/weapons/rocket-launcher-hull.glb, rocket-launcher-shoulder.glb, rocket.glb, each with a .json
sidecar. Built with the old project's weapon kit (pilgrim-mechanica/tools/blender/weapons/wkit.py, read from the sibling
repo, or PM1_BLENDER_TOOLS): lofts, lathes and painted markings in kit space (+Y forward, +Z up, +X right, metres).

The game frame (the asset list's contract): GLB, Y up, front (muzzle) along +Z, the mech's left along +X. Kit space maps
to it as (x, y, z) -> (-x, z, y), a proper rotation, so hinge angles keep their sign and only the axis turns.

Look: one fat single tube (Keith: "like an RPG scaled to a mech") in the Rampart's khaki and olive, ribbed heat-shield
bands over the middle, a big flared back-blast vent behind a hinged blast cover, a sight box on the inboard side, a
targeting laser under the muzzle, hazard stripes on the muzzle collar and the red-orange warhead nose standing out of
the bore, which is the "explosive" tell from the 40 m camera.

Colour: the vertex colour COLOR_0 carries paint x AO x wear in sRGB (as rampart.glb); the material slots stay named
Paint_<section> with a white base so the game can retint a section. Paint_lighting is emissive.
"""
import argparse
import json
import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
OLD_TOOLS = os.environ.get("PM1_BLENDER_TOOLS") or os.path.join(os.path.dirname(REPO), "pilgrim-mechanica", "tools",
                                                                  "blender")
sys.path.insert(0, OLD_TOOLS)
from weapons import wkit as W  # noqa: E402

# Paint sections in the Rampart's family (sRGB). detail is the warhead's red-orange here (bolts use mechanical).
PALETTE = {
    "plating": 0xb7a77c,     # khaki, the Rampart's plates
    "secondary": 0x6c7546,   # olive, the power pack's and drums' second tone
    "dark": 0x34332e,        # bore, rubber, scorched vent
    "mechanical": 0x6e6d66,  # steel bands, clamps, rails
    "trim": 0xe0ad2c,        # hazard yellow
    "lighting": 0xff4a24,    # laser lens and motor glow
    "detail": 0xcf4a26,      # warhead
    "visor": 0x4fa4a8,       # sight lens
}
EMISSIVE = {"lighting": 2.0, "visor": 0.4}
RECOIL = 0.15        # m back along -Z on firing
LID_OPEN = 100.0     # deg the blast cover flaps up and back on firing
K2G = Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0)))  # kit -> game frame (det +1)


def V(x, y, z):
    return Vector((x, y, z))


def to_game(p):
    return [round(c, 4) for c in (K2G @ Vector(p))]


# ---------------------------------------------------------------------------------------------- the tube assembly

def tube(rec, lid, war, A, k=1.0, kl=1.0, inboard=-1):
    """The launcher tube on the Recoil piece (pivot A, the tube's axis), the blast cover on `lid` and the warhead round
    on `war`. k scales radii, kl lengths; inboard is the side (kit x sign) the sight box goes on. Returns sockets."""
    def y(t):
        return A.y + t * kl

    def at(t, x=0.0, z=0.0):
        return V(A.x + x * k, y(t), A.z + z * k)
    yax = (0, 1, 0)

    def ax(prof):
        return [(t * kl, r * k) for t, r in prof]
    # main tube: a solid from the rear nozzle to the bottom of the bore
    W.lathe(rec, A, yax, ax([(-0.64, 0), (-0.64, 0.200), (-0.58, 0.212), (1.00, 0.212), (1.00, 0)]), "plating", n=16,
            secs=["dark", "mechanical", "plating", "dark"])
    # the bore's wall from there to the muzzle collar
    W.lathe(rec, A, yax, ax([(0.96, 0.19), (0.96, 0.214), (1.42, 0.214), (1.42, 0.19)]), "plating", n=16, ring=True,
            secs=["plating", "plating", "plating", "dark"])
    # heat shield: an olive sleeve over the middle with raised steel ribs
    W.lathe(rec, A, yax, ax([(-0.42, 0.208), (-0.40, 0.243), (0.40, 0.243), (0.42, 0.208)]), "secondary", n=16,
            ring=True)
    for i in range(6):
        t = -0.33 + 0.132 * i
        W.lathe(rec, A, yax, ax([(t - 0.025, 0.236), (t - 0.018, 0.262), (t + 0.018, 0.262), (t + 0.025, 0.236)]),
                "mechanical", n=16, ring=True)
    # clamp bands riding the cradle rails, a bolt on each
    for t in (-0.52, 0.52):
        W.lathe(rec, A, yax, ax([(t - 0.045, 0.205), (t - 0.045, 0.252), (t + 0.045, 0.252), (t + 0.045, 0.205)]),
                "mechanical", n=16, ring=True)
        for s in (1, -1):
            W.bolt(rec, at(t, s * 0.252, 0), (s, 0, 0), 0.022 * k, sec="mechanical")
    # a warhead-red warning band behind the muzzle: the explosive tell from any side (from behind the nose is hidden)
    W.lathe(rec, A, yax, ax([(1.20, 0.208), (1.21, 0.226), (1.35, 0.226), (1.36, 0.208)]), "detail", n=16, ring=True)
    # back-blast vent: a big flare with a scorched inside and the nozzle throat
    W.lathe(rec, A, yax, ax([(-0.60, 0.17), (-0.60, 0.225), (-0.70, 0.248), (-0.86, 0.318), (-0.885, 0.318),
                             (-0.885, 0.292), (-0.70, 0.20)]), "secondary", n=16, ring=True,
            secs=["mechanical", "secondary", "secondary", "mechanical", "mechanical", "dark", "dark"])
    W.lathe(rec, A, yax, ax([(-0.66, 0.075), (-0.66, 0.12), (-0.76, 0.15), (-0.76, 0.105)]), "mechanical", n=10,
            ring=True)
    # hinge brackets for the blast cover on the vent's top rim
    hinge = at(-0.90, 0, 0.335)
    for s in (1, -1):
        W.prism(rec, at(-0.84, s * 0.11, 0.30), at(-0.90, s * 0.11, 0.335), W.oct_ring(0.022 * k, 0.03 * k, 0.008),
                "mechanical")
    # muzzle collar: an octagon (a flat on top) with hazard stripes on the three upper flats
    W.lathe(rec, A, yax, ax([(1.40, 0.19), (1.40, 0.24), (1.43, 0.265), (1.70, 0.265), (1.73, 0.25), (1.73, 0.19)]),
            "mechanical", n=8, ring=True, phase=math.pi / 8,
            secs=["mechanical", "mechanical", "mechanical", "mechanical", "mechanical", "dark"])
    apo = 0.265 * k * math.cos(math.pi / 8) + 0.0005
    for a in (math.pi / 4, math.pi / 2, 3 * math.pi / 4):
        n = V(-math.cos(a), 0, math.sin(a))
        W.hazard(rec, V(A.x, y(1.565), A.z) + n * apo, V(0, 1, 0), V(-math.sin(a), 0, -math.cos(a)), 0.24 * kl,
                 0.265 * k * 0.70, 5, sec_a="trim", sec_b="dark")
    # sight box on the inboard top, on a bracket, its lens forward under a hood
    s = inboard
    sb = at(0.78, s * 0.21, 0.205)
    W.loft_y(rec, [(sb.y - 0.20 * kl, W.oct_ring(0.07 * k, 0.065 * k, 0.025 * k), sb.z),
                   (sb.y + 0.17 * kl, W.oct_ring(0.075 * k, 0.07 * k, 0.025 * k), sb.z),
                   (sb.y + 0.20 * kl, W.oct_ring(0.068 * k, 0.062 * k, 0.022 * k), sb.z)], "dark", x0=sb.x)
    W.prism(rec, at(0.78, s * 0.13, 0.13), sb + V(0, 0, -0.04 * k), W.oct_ring(0.035 * k, 0.05 * k, 0.012),
            "mechanical")
    W.plate(rec, sb + V(0, 0.20 * kl + 0.002, 0.0), V(-1, 0, 0), V(0, 0, 1), 0.09 * k, 0.07 * k, 0.006, "visor",
            ch=0.015 * k, bevel=0)
    W.plate(rec, sb + V(0, 0.16 * kl, 0.07 * k), V(1, 0, 0), V(0, 1, 0), 0.15 * k, 0.12 * kl, 0.012, "mechanical",
            ch=0.02 * k)
    # targeting laser under the muzzle: a small emitter can on a bracket, a glowing lens
    lz = -0.30
    W.prism(rec, at(1.10, 0, -0.205), at(1.10, 0, lz + 0.03), W.oct_ring(0.03 * k, 0.045 * kl, 0.01), "mechanical")
    W.lathe(rec, at(0.98, 0, lz), yax, [(0, 0), (0, 0.045 * k), (0.20 * kl, 0.045 * k), (0.22 * kl, 0.036 * k),
                                       (0.22 * kl, 0)], "mechanical", n=10, secs=["mechanical"] * 3 + ["lighting"])
    # blast cover on its hinge: an octagonal plate over the vent, knuckle on top, a hazard chevron on its back
    c = at(-0.895, 0, 0)
    W.extrude(lid, W.oct_ring(0.322 * k, 0.322 * k, 0.13 * k), c, V(-1, 0, 0), V(0, 0, 1), V(0, -1, 0), 0.03 * k,
              "secondary", bevel=0.012 * k)
    W.lathe(lid, hinge - V(0.08 * k, 0, 0), (1, 0, 0), [(0, 0), (0, 0.028 * k), (0.16 * k, 0.028 * k),
                                                         (0.16 * k, 0)], "mechanical", n=8)
    W.chevrons(lid, c + V(0, -0.03 * k - 0.001, -0.06 * k), V(0, 0, -1), V(1, 0, 0), 0.30 * k, 0.24 * k, 2, sec="trim")
    # the warhead round: a thin boom from the bore, a fat red-orange cone, a yellow band, the ogive and its fuse spike
    tail = at(1.06)
    prof = [(0, 0), (0, 0.09), (0.10, 0.09), (0.14, 0.175), (0.52, 0.175), (0.52, 0.18), (0.58, 0.18), (0.58, 0.172)]
    og = [(0.58 + 0.30 * t, 0.172 * math.cos(t * math.pi / 2) ** 0.7 + 0.04 * t) for t in (0.25, 0.5, 0.72, 0.9)]
    prof += og + [(0.885, 0.04), (0.95, 0.03), (0.96, 0)]
    secs = []
    for (t0, _), (t1, _) in zip(prof, prof[1:]):
        tm = (t0 + t1) / 2
        secs.append("mechanical" if tm < 0.12 or tm > 0.88 else "trim" if 0.52 <= tm <= 0.58 else "detail")
    W.lathe(war, tail, yax, ax(prof), "detail", n=12, secs=secs)
    return {
        "Muzzle_0": at(1.74),
        "Laser": at(1.21, 0, lz),
        "hinge": hinge,
        "tail": tail,
        "tip": at(1.06 + 0.96),
    }


# ---------------------------------------------------------------------------------------------- the two mounts

def build_hull(seed):
    """Hull (M): replaces an arm. Root and Mount at the shoulder joint; built for the RIGHT side (outboard +X in kit,
    the game's -X); the game mirrors it onto the left as it does the minigun pod."""
    A = V(0.92, 0.0, -0.28)  # the tube axis (the Rampart's minigun barrels: 0.94 out, 0.32 down from the shoulder)
    body = W.Piece("Body", seed=seed)
    rec = W.Piece("Recoil", pivot=A, seed=seed + 1)
    lid = W.Piece("Lid", seed=seed + 2)
    war = W.Piece("Missile_0", seed=seed + 3)
    so = tube(rec, lid, war, A, inboard=-1)
    lid.pivot, war.pivot = so["hinge"], so["tail"]
    # shoulder cap: a turned hub on the joint, bolted
    W.lathe(body, V(0, 0, 0), (1, 0, 0), [(0, 0), (0, 0.24), (0.03, 0.262), (0.16, 0.262), (0.19, 0.225), (0.19, 0)],
            "secondary", n=14, secs=["mechanical", "mechanical", "secondary", "mechanical", "mechanical"])
    W.bolt_circle(body, V(0.19, 0, 0), (1, 0, 0), 0.16, 8, 0.02, sec="mechanical")
    # yoke: two chamfered beams out and down to the cradle, a cover plate over them
    cz = A.z - 0.335  # the saddle's top just under the clamp bands
    beam = V(A.x - 0.17, 0, cz) - V(0.12, 0, -0.02)
    for s in (1, -1):
        W.prism(body, V(0.12, s * 0.13, -0.02), V(A.x - 0.17, s * 0.13, cz), W.oct_ring(0.06, 0.085, 0.03),
                "secondary")
    bn = V(0, -1, 0).cross(beam.normalized())
    W.plate(body, V(0.12, 0, -0.02) + beam * 0.4 + bn * 0.09, V(0, -1, 0), beam.normalized(), 0.36, 0.32, 0.035,
            "plating", ch=0.06)
    # cradle under the tube: a chamfered saddle, two recoil rails, a buffer cylinder under it
    W.loft_y(body, [(-0.62, W.oct_ring(0.17, 0.08, 0.03, belly=0.03), cz), (0.60, W.oct_ring(0.17, 0.08, 0.03,
                                                                                              belly=0.03), cz),
                    (0.66, W.oct_ring(0.13, 0.06, 0.025), cz)], "secondary", x0=A.x)
    for s in (1, -1):  # the recoil rails the clamp bands slide on
        W.prism(body, V(A.x + s * 0.11, -0.60, cz + 0.095), V(A.x + s * 0.11, 0.60, cz + 0.095),
                W.oct_ring(0.022, 0.016, 0.006), "mechanical")
    W.lathe(body, V(A.x, -0.48, cz - 0.10), (0, 1, 0), [(0, 0), (0, 0.065), (0.50, 0.065), (0.52, 0.05), (0.52, 0)],
            "mechanical", n=10)
    W.lathe(body, V(A.x, 0.04, cz - 0.10), (0, 1, 0), [(0, 0), (0, 0.026), (0.30, 0.026), (0.30, 0)], "dark", n=8)
    # unit markings on the outboard face of the cradle, a cable loom from the shoulder to the sight box bracket
    f = V(A.x + 0.171, 0, cz)
    W.stencil_digits(body, f + V(0, -0.30, 0), V(0, 1, 0), V(0, 0, 1), 0.07, "07")
    W.chevrons(body, f + V(0, 0.22, 0), V(0, -1, 0), V(0, 0, -1), 0.28, 0.06, 3)  # pointing forward
    W.cable_loom(body, V(0.10, -0.15, 0.10), V(A.x - 0.18, -0.40, cz + 0.06), V(0, -0.05, 0.08), 0.014, count=3)
    pieces = {"Body": body, "Recoil": rec, "Lid": lid, "Missile_0": war}
    sockets = {"Mount": V(0, 0, 0), "Muzzle_0": so["Muzzle_0"], "Laser": so["Laser"]}
    return pieces, sockets, so, dict(cls="RocketLauncher", size="M", mount="hull",
                                     note="replaces an arm: root and Mount on the shoulder joint; right side (the game's "
                                          "-X outboard), mirror it for the left as the minigun pod is")


def build_shoulder(seed):
    """Shoulder (M): sits on top beside the hull. Root and Mount at the centre of its base flange."""
    k, kl = 0.86, 0.84
    A = V(0.0, 0.0, 0.44)
    body = W.Piece("Body", seed=seed)
    rec = W.Piece("Recoil", pivot=A, seed=seed + 1)
    lid = W.Piece("Lid", seed=seed + 2)
    war = W.Piece("Missile_0", seed=seed + 3)
    so = tube(rec, lid, war, A, k=k, kl=kl, inboard=-1)
    lid.pivot, war.pivot = so["hinge"], so["tail"]
    # base flange and a yaw drum on it
    W.lathe(body, V(0, 0, 0), (0, 0, 1), [(0, 0), (0, 0.30), (0.035, 0.30), (0.05, 0.27), (0.05, 0)], "mechanical",
            n=14)
    W.bolt_circle(body, V(0, 0, 0.05), (0, 0, 1), 0.25, 8, 0.018, sec="mechanical")
    W.lathe(body, V(0, 0, 0.05), (0, 0, 1), [(0, 0), (0, 0.22), (0.13, 0.22), (0.16, 0.19), (0.16, 0)], "secondary",
            n=14)
    # trunnion yoke: a saddle on the drum and a cheek each side with a turned hub on the tube's axis
    W.loft_y(body, [(-0.24, W.oct_ring(0.27, 0.04, 0.02), 0.20), (0.24, W.oct_ring(0.27, 0.04, 0.02), 0.20)],
             "secondary")
    for s in (1, -1):
        W.plate(body, V(s * 0.245, 0.0, 0.40), V(0, s, 0), V(0, 0, 1), 0.44, 0.34, 0.045, "plating", ch=0.08,
                batter=0.05)
        W.lathe(body, V(s * 0.29, 0, A.z), (s, 0, 0), [(0, 0), (0, 0.10), (0.03, 0.10), (0.05, 0.075), (0.05, 0)],
                "mechanical", n=10)
    f = V(0.245 + 0.046, 0, 0.40)
    W.stencil_digits(body, f + V(0, -0.16, -0.03), V(0, 1, 0), V(0, 0, 1), 0.07, "08")
    W.hazard(body, f + V(0, 0.0, -0.125), V(0, 1, 0), V(0, 0, 1), 0.34, 0.04, 7, sec_a="trim", sec_b="dark")
    pieces = {"Body": body, "Recoil": rec, "Lid": lid, "Missile_0": war}
    sockets = {"Mount": V(0, 0, 0), "Muzzle_0": so["Muzzle_0"], "Laser": so["Laser"]}
    return pieces, sockets, so, dict(cls="RocketLauncher", size="M", mount="shoulder",
                                     note="sits on top beside the hull: root and Mount at the centre of its base; the "
                                          "Recoil node's origin is on the trunnion axis, so it can also pitch the tube")


def build_rocket(seed):
    """The projectile (<= 300 tris): the same warhead on a motor body with four fins. Root at the motor's tail on the
    axis, nose along +Z; Glow_0 at the nozzle."""
    P = W.Piece("Body", seed=seed)
    prof = [(0, 0), (0, 0.07), (0.05, 0.10), (0.30, 0.10), (0.36, 0.175), (0.74, 0.175), (0.74, 0.18), (0.80, 0.18),
            (0.92, 0.15), (1.03, 0.09), (1.10, 0.035), (1.16, 0)]
    secs = ["dark", "mechanical", "secondary", "detail", "detail", "trim", "trim", "detail", "detail", "detail",
            "mechanical"]
    W.lathe(P, V(0, 0, 0), (0, 1, 0), prof, "detail", n=8, secs=secs, phase=math.pi / 8)
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        d = V(math.cos(ang), 0, math.sin(ang))
        W.prism(P, d * 0.09 + V(0, 0.03, 0), d * 0.21 + V(0, 0.03, 0),
                [(0, -0.008), (0.22, -0.008), (0.22, 0.008), (0, 0.008)], "secondary", up=d.cross(V(0, 1, 0)))
    sockets = {"Glow_0": V(0, -0.02, 0)}
    return {"Body": P}, sockets, {}, dict(cls="Rocket", size="M", mount="projectile",
                                          note="root at the motor's tail on the axis; flies along +Z")


# ---------------------------------------------------------------------------------------------- colour, export

def section_material(sec):
    name = "Paint_" + sec
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if m.get("pm_ready"):
        return m
    m["pm_ready"] = True
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    if sec in EMISSIVE:
        rgb = srgb_lin(PALETTE[sec])
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
        bsdf.inputs["Emission Strength"].default_value = EMISSIVE[sec]
    vc = m.node_tree.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    m.node_tree.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def srgb(hexv):
    return tuple(((hexv >> s) & 255) / 255.0 for s in (16, 8, 0))


def srgb_lin(hexv):
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb(hexv))


def bake_colour(objs, ao_dist=0.35, rays=14, seed=7):
    """COLOR_0 = section paint (sRGB) x wear (the kit's bake) x ambient occlusion from rays over every piece."""
    verts, polys = [], []
    for o in objs:
        mw = o.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    bvh = BVHTree.FromPolygons(verts, polys)
    rng = random.Random(seed)
    dirs = []
    for _ in range(rays):  # cosine-weighted hemisphere about +Z, turned onto each normal below
        u1, u2 = rng.random(), rng.random()
        r, a = math.sqrt(u1), 2 * math.pi * u2
        dirs.append(V(r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - u1))))
    for o in objs:
        me = o.data
        wear = me.color_attributes.get("Color")
        wv = None
        if wear is not None:
            wv = [(d.color_srgb if wear.data_type == "BYTE_COLOR" else d.color)[:3] for d in wear.data]
        col = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        mw = o.matrix_world
        rot = mw.to_3x3()
        cache = {}
        for p in me.polygons:
            sec = me.materials[p.material_index].name.replace("Paint_", "")
            paint = srgb(PALETTE[sec])
            n = (rot @ p.normal).normalized()
            q = n.to_track_quat("Z", "Y").to_matrix()
            for li in p.loop_indices:
                vi = me.loops[li].vertex_index
                key = (vi, round(n.x, 2), round(n.y, 2), round(n.z, 2))
                ao = cache.get(key)
                if ao is None:
                    pos = mw @ me.vertices[vi].co + n * 0.003
                    hit = 0.0
                    for d in dirs:
                        loc, _, _, dist = bvh.ray_cast(pos, q @ d, ao_dist)
                        if loc is not None:
                            hit += 1.0 - dist / ao_dist * 0.5
                    ao = 1.0 - 0.55 * hit / len(dirs)
                    cache[key] = ao
                if sec in EMISSIVE:
                    ao = 1.0
                w = wv[li] if wv else (1, 1, 1)
                col.data[li].color_srgb = (paint[0] * w[0] * ao, paint[1] * w[1] * ao, paint[2] * w[2] * ao, 1.0)
        if wear is not None:
            me.color_attributes.remove(wear)
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        for i, m in enumerate(me.materials):
            me.materials[i] = section_material(m.name.replace("Paint_", ""))


def make(kind, seed=1):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build = {"hull": build_hull, "shoulder": build_shoulder, "rocket": build_rocket}[kind]
    pieces, sockets, so, info = build(seed)
    name = {"hull": "RocketLauncherHull", "shoulder": "RocketLauncherShoulder", "rocket": "Rocket"}[kind]
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    objs = {}
    for pname, P in pieces.items():
        o = W.emit(P, root, 0, 0.5, wear=0.8)
        if o is not None:
            objs[pname] = o
    # the blast cover and the round ride the recoiling tube
    for child in ("Lid", "Missile_0"):
        if child in objs and "Recoil" in objs:
            o = objs[child]
            o.parent = objs["Recoil"]
            o.location = pieces[child].pivot - pieces["Recoil"].pivot
    bpy.context.view_layer.update()
    bake_colour(list(objs.values()))
    tris = {n: sum(len(p.vertices) - 2 for p in o.data.polygons) for n, o in objs.items()}
    # sockets: empties under the root
    for sname, p in sockets.items():
        e = bpy.data.objects.new(sname, None)
        e.empty_display_type, e.empty_display_size = "ARROWS", 0.1
        bpy.context.scene.collection.objects.link(e)
        e.parent = root
        e.location = p
    # sidecar (game frame)
    lo = V(1e9, 1e9, 1e9)
    hi = -lo
    for o in objs.values():
        for v in o.data.vertices:
            g = K2G @ (o.matrix_world @ v.co)
            lo = V(min(lo.x, g.x), min(lo.y, g.y), min(lo.z, g.z))
            hi = V(max(hi.x, g.x), max(hi.y, g.y), max(hi.z, g.z))
    moving = []
    if "Recoil" in objs:
        moving.append(dict(node="Recoil", kind="slide", axis=to_game((0, -1, 0)), travel=RECOIL,
                           pivot=to_game(pieces["Recoil"].pivot),
                           note="the tube kicks back along -Z on firing and returns; carries Lid and Missile_0"))
        # kit: the cover opens by -LID_OPEN about kit +X (bottom edge swings back and up); kit +X is game -X, so in the
        # game frame it is +LID_OPEN about +X. Checked below on a point under the hinge.
        moving.append(dict(node="Lid", kind="hinge", axis=[1, 0, 0], angleDeg=LID_OPEN, parent="Recoil",
                           pivot=to_game(pieces["Lid"].pivot),
                           note="rear blast cover: rotate about local +X by angleDeg to flap it up and back on firing "
                                "(closed = 0)"))
        moving.append(dict(node="Missile_0", kind="slide", axis=to_game((0, 1, 0)), travel=0.0, parent="Recoil",
                           pivot=to_game(pieces["Missile_0"].pivot),
                           note="the loaded round, warhead out of the muzzle: hide it on firing (the game spawns "
                                "rocket.glb at Muzzle_0) and show it again when reloaded"))
        _check_lid(pieces)
    meta = {
        "class": info["cls"], "size": info["size"], "mount": info["mount"], "note": info["note"],
        "units": "metres at game size",
        "frame": "glTF: +Y up, +Z forward (muzzle), +X the mech's left; root at the mount point",
        "bounds": {"min": [round(c, 3) for c in lo], "max": [round(c, 3) for c in hi],
                   "size": [round(b - a, 3) for a, b in zip(lo, hi)]},
        "tris": sum(tris.values()), "trisPerNode": tris,
        "nodes": {n: {"materials": [m.name for m in o.data.materials],
                      "pivot": to_game(pieces[n].pivot),
                      "parent": o.parent.name if o.parent else None} for n, o in objs.items()},
        "moving": moving,
        "sockets": {n: to_game(p) for n, p in sockets.items()},
        "palette": {k: "#%06x" % v for k, v in PALETTE.items()},
        "colour": "COLOR_0 = section paint x wear x AO (sRGB, as rampart.glb); materials Paint_<section> with white "
                  "base; Paint_lighting emissive",
        "source": "tools/blender/weapons/rocket_launcher.py (kit: pilgrim-mechanica tools/blender/weapons/wkit.py)",
    }
    return root, objs, meta


def _check_lid(pieces):
    """The blast cover's bottom edge must swing back (-Z) and up (+Y) in the game frame with the sidecar's angle."""
    h = pieces["Lid"].pivot
    p = K2G @ (V(h.x, h.y, h.z - 0.3) - h)
    q = Matrix.Rotation(math.radians(LID_OPEN), 3, "X") @ p
    assert q.z < -0.2 and q.y > p.y, ("lid opens the wrong way", p, q)


def export(root, objs, meta, path):
    R = Matrix.Rotation(math.pi, 4, "Z")  # kit front +Y -> Blender -Y, which the glTF exporter writes as +Z
    for o in root.children:
        if o.type == "MESH":
            o.data.transform(R)
        o.location = R @ o.location
    for o in objs.values():
        if o.parent is not root and o.parent is not None:  # nested (Lid, Missile_0): their meshes and offsets turn too
            o.data.transform(R)
            o.location = R @ o.location
    bpy.context.view_layer.update()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in [root] + list(root.children_recursive):
        o.select_set(True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
              export_normals=True, export_materials="EXPORT", export_cameras=False, export_lights=False,
              export_animations=False, export_extras=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    with open(os.path.splitext(path)[0] + ".json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)


FILES = {"hull": "rocket-launcher-hull.glb", "shoulder": "rocket-launcher-shoulder.glb", "rocket": "rocket.glb"}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "public", "models", "weapons"))
    ap.add_argument("--only", default="hull,shoulder,rocket")
    a = ap.parse_args(argv)
    for kind in a.only.split(","):
        root, objs, meta = make(kind)
        path = os.path.join(os.path.abspath(a.out), FILES[kind])
        export(root, objs, meta, path)
        print("W1 %-9s %5d tris %s m -> %s" % (kind, meta["tris"], meta["bounds"]["size"], path))


if __name__ == "__main__":
    main()
