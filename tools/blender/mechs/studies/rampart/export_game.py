"""Rampart walker v4 -> the game's walker skin (Keith 2026-10-22: "get this in the game").

    blender -b --factory-startup -P tools/blender/mechs/studies/rampart/export_game.py -- --out <ABS path>.fbx

Builds rampart_v4 at rest, then rewrites it into the layout the game's MechSkinBuilder reads
(Assets/_Project/Combat/Editor/MechSkinBuilder.cs, docs/rampart-ingame-2026-10-22/README.md):

  * one mesh per walker bone, `Part_<Bone>[_L|_R]`, every visible layer of the part joined (the mass layer is never built
    here); origins stay at the part's joint. Bones: Pelvis, Torso, Thigh, Shin (knee -> hock), Cannon (= v4's Meta, hock
    -> foot), Foot, and Pod (= v4's Arm_L / Arm_R: the whole arm with its minigun or rocket box, held on the shoulder).
  * empties at the walker's joints, named as the builder looks them up: Thigh_L (hip), Shin_L (knee), Cannon_L (hock),
    Foot_L (the walker's foot point: under the ankle, FOOT_POINT_H above the sole, where the solver's plate point sits
    0.22 lab m above the ground), UpperArm_L (shoulder).
  * one material slot, colours in the "Color" corner layer (sRGB paint x AO x wear, from the kit's bake); the "Section"
    layer is dropped so Unity reads the paint as the vertex colour.
  * the guns (Keith 2026-10-23, docs/rampart-guns-2026-10-23/): the minigun's barrel cluster (hub, six barrels, spindle,
    rings) is its own piece `Part_PodSpin_R`, turning about the empties PodSpin_R -> PodSpinFwd_R; each rocket (warhead and
    red tip) is `Part_PodRocket<i>_L`, hidden in the game while its tube reloads. Muzzle empties: PodMuzzle0_R at the barrel
    tips, PodMuzzle<i>_L at each tube mouth (i = firing order: top row first, alternating columns); PodEject_R on the
    receiver's outer side (casings go outboard).
  * every mesh is cleaned (zero-area faces dissolved) and triangulated here (beauty), so Unity has no
    concave or self-intersecting n-gons to drop on import (Keith 2026-10-23: "a hole in the front plate").

Units m, Z up, front -Y, the mech's left +X (as v4); the FBX goes out Y up, -Z forward like the other kit exports.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import importlib.util  # noqa: E402


def _model_module():
    """`--model <file.py>` exports a variant built on rampart_v4 (pilgrim-mechanica-2, 2026-10-24); default rampart_v4.

    A variant module must provide what this exporter reads from rampart_v4 (HIP_Z, GX, GZ, POSE, V, build_full,
    joints) and may define hooks for guns that differ from the minigun and rocket box:
      export_gun_points()        -> {empty name: Vector} replacing gun_points() (must still give PodSpin_R,
                                    PodSpinFwd_R, PodMuzzle0_R and PodEject_R for the game)
      export_split_guns(parts, split_off) -> {key: object} replacing split_guns() (give "PodSpin_R" if anything turns)
    """
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    path = argv[argv.index("--model") + 1] if "--model" in argv else None
    if not path:
        import rampart_v4
        return rampart_v4
    path = os.path.abspath(path)
    sys.path.insert(0, os.path.dirname(path))
    spec = importlib.util.spec_from_file_location(os.path.splitext(os.path.basename(path))[0], path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


HV = _model_module()

# The solver's foot plate point is 0.22 lab m over the ground; the builder scales the model by 4.4 / hip height (3.05 m).
FOOT_POINT_H = 0.22 * HV.HIP_Z / 4.4
BONE_OF = {"Meta": "Cannon", "Arm": "Pod"}


def part_name(part):
    base, _, side = part.partition("_")
    return "Part_" + BONE_OF.get(base, base) + ("_" + side if side else "")


def join_parts(objs):
    """Joins each part's layer meshes into one object (origin at the part's joint, world placement kept)."""
    groups = {}
    for o in objs:
        groups.setdefault(o.name.split("__")[0], []).append(o)
    out = {}
    for part, group in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        if len(group) > 1:
            bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        o.name = part_name(part)
        o.data.name = o.name
        me = o.data
        sec = me.color_attributes.get("Section")
        if sec is not None:
            me.color_attributes.remove(sec)
        col = me.color_attributes.get("Color")
        if col is not None:
            me.color_attributes.active_color = col
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        for p in me.polygons:
            p.material_index = 0
        mat = me.materials[0] if len(me.materials) else None
        me.materials.clear()
        me.materials.append(bpy.data.materials.get("Rampart") or (mat.copy() if mat else bpy.data.materials.new("Rampart")))
        me.materials[0].name = "Rampart"
        out[part] = o
    return out


# ---- the guns (2026-10-23) ----
# Rocket tubes in firing order: the top row first, alternating columns (inner, outer).
TUBES = [(cx, -0.94 + (4.18 + 0.205 * k - 4.04) * 0.113, 4.18 + 0.205 * k) for k in (4, 3, 2, 1, 0) for cx in (1.77, 2.03)]
SPIN_PIVOT = Vector((HV.GX, -0.50, HV.GZ))      # the gatling's hub; the cluster turns about the barrel axis (-Y)
SPIN_FWD = Vector((HV.GX, -1.00, HV.GZ))
MUZZLE_R = Vector((HV.GX, -1.90, HV.GZ))        # the barrel tips (the muzzle ring ends at -1.855)
EJECT_R = Vector((HV.GX - 0.37, -0.20, 4.00))   # the receiver's outer (-X) face, ahead of the side channel


def islands(bm):
    """Loose parts of a bmesh as lists of faces."""
    bm.faces.index_update()
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, group = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            group.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        out.append(group)
    return out


def split_off(o, pick, name):
    """Moves the loose parts pick(centroid, points) accepts into a new object `name` (same origin and transform)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    mw = o.matrix_world
    n = 0
    for f in bm.faces:
        f.select = False
    for v in bm.verts:
        v.select = False
    for group in islands(bm):
        vs = {v for f in group for v in f.verts}
        pts = [mw @ v.co for v in vs]
        c = sum(pts, Vector()) / len(pts)
        if pick(c, pts):
            n += 1
            for f in group:
                f.select = True
                for v in f.verts:
                    v.select = True
    if n == 0:
        bm.free()
        return None, 0
    bm.to_mesh(o.data)
    bm.free()
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    before = set(bpy.data.objects)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    new = [x for x in bpy.data.objects if x not in before][0]
    new.name = name
    new.data.name = name
    return new, n


def split_guns(parts):
    """The barrel cluster and each rocket as their own pieces."""
    out = {}
    arm_r, arm_l = parts.get("Arm_R"), parts.get("Arm_L")
    if arm_r is not None:
        def rad(p):
            return ((p.x - HV.GX) ** 2 + (p.z - HV.GZ) ** 2) ** 0.5

        def gat(c, pts):
            return c.y < -0.46 and rad(c) < 0.15 and max(rad(p) for p in pts) < 0.25
        o, n = split_off(arm_r, gat, "Part_PodSpin_R")
        print("HDX split %d gatling islands -> %s" % (n, o.name if o else None))
        if o is not None:
            out["PodSpin_R"] = o
    if arm_l is not None:
        for i, (cx, y, z) in enumerate(TUBES):
            heads = (Vector((cx, y, z)), Vector((cx, y - 0.065, z)))
            o, n = split_off(arm_l, lambda c, pts, h=heads: min((c - p).length for p in h) < 0.035, "Part_PodRocket%d_L" % i)
            print("HDX split rocket %d: %d islands" % (i, n))
            if o is not None:
                out["PodRocket%d_L" % i] = o
    return out


def gun_points():
    pts = {"PodSpin_R": SPIN_PIVOT, "PodSpinFwd_R": SPIN_FWD, "PodMuzzle0_R": MUZZLE_R, "PodEject_R": EJECT_R}
    for i, (cx, y, z) in enumerate(TUBES):
        pts["PodMuzzle%d_L" % i] = Vector((cx, y - 0.09, z))   # just ahead of the red tip
    return pts


def _crosses(a, b, c, d):
    def cr(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return cr(a, b, c) * cr(a, b, d) < 0 and cr(c, d, a) * cr(c, d, b) < 0


def mesh_report(o):
    """Non-manifold edges, boundary edges, zero-area faces and n-gons that fold over themselves (Unity drops those)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    nm = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
    bd = sum(1 for e in bm.edges if e.is_boundary)
    zero = sum(1 for f in bm.faces if f.calc_area() < 1e-9)
    bad = []
    for f in bm.faces:
        if len(f.verts) <= 3:
            continue
        nrm = f.normal
        if nrm.length < 1e-9:
            bad.append(f)
            continue
        ax = nrm.orthogonal().normalized()
        ay = nrm.cross(ax)
        p2 = [(v.co.dot(ax), v.co.dot(ay)) for v in f.verts]
        m = len(p2)
        hit = any(_crosses(p2[i], p2[(i + 1) % m], p2[j], p2[(j + 1) % m])
                  for i in range(m) for j in range(i + 2, m) if (j + 1) % m != i)
        if hit:
            bad.append(f)
    where = [tuple(round(x, 2) for x in (o.matrix_world @ f.calc_center_median())) for f in bad[:4]]
    bm.free()
    return nm, bd, zero, len(bad), where


def clean_and_triangulate(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()


def joint_empties():
    J = HV.joints()
    names = {}
    for sfx in ("_L", "_R"):
        a = J["Foot" + sfx]
        names["Thigh" + sfx] = J["Thigh" + sfx]
        names["Shin" + sfx] = J["Shin" + sfx]
        names["Cannon" + sfx] = J["Meta" + sfx]
        names["Foot" + sfx] = Vector((a.x, a.y, FOOT_POINT_H))
        names["UpperArm" + sfx] = J["Arm" + sfx]
    names["Waist"] = J["Torso"]
    names.update(HV.export_gun_points() if hasattr(HV, "export_gun_points") else gun_points())
    made = []
    for n, p in names.items():
        e = bpy.data.objects.new(n, None)
        bpy.context.scene.collection.objects.link(e)
        e.location = p
        made.append(e)
    return made, names


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default=None, help="variant module (read at import, see _model_module)")
    ap.add_argument("--drop", nargs="*", default=[],
                    help="parts to leave out, e.g. Arm_L (the web game mirrors the right pod and never reads the left)")
    a = ap.parse_args(argv)
    HV.POSE["mode"] = "rest"
    HV.V.clear_scene()
    root, objs, info = HV.build_full()
    old = [o for o in bpy.data.objects if o.type == "EMPTY"]
    parts = join_parts(objs)
    for e in old:
        bpy.data.objects.remove(e, do_unlink=True)
    for name in a.drop:
        o = parts.pop(name, None)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)
            print("HDX dropped", name)
    parts.update(HV.export_split_guns(parts, split_off) if hasattr(HV, "export_split_guns") else split_guns(parts))
    for n in sorted(parts):
        nm, bd, zero, bad, where = mesh_report(parts[n])
        print("HDX check %-18s non-manifold %4d boundary %5d zero-area %3d folded n-gons %3d %s" % (parts[n].name, nm, bd, zero, bad, where))
        clean_and_triangulate(parts[n])
        nm, bd, zero, bad, where = mesh_report(parts[n])
        print("HDX clean %-18s non-manifold %4d boundary %5d zero-area %3d" % (parts[n].name, nm, bd, zero))
    empties, J = joint_empties()
    bpy.context.view_layer.update()
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in list(parts.values()) + empties:
        o.select_set(True)
    bpy.ops.export_scene.fbx(filepath=a.out, use_selection=True, object_types={"EMPTY", "MESH"}, add_leaf_bones=False,
                             bake_anim=False, axis_forward="-Z", axis_up="Y", apply_scale_options="FBX_SCALE_UNITS",
                             mesh_smooth_type="FACE", colors_type="SRGB", use_mesh_modifiers=False, path_mode="STRIP")
    tot = 0
    for n in sorted(parts):
        o = parts[n]
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        tot += tris
        print("HDX part %-14s tris %6d origin %s" % (o.name, tris, tuple(round(c, 3) for c in o.location)))
    for n, p in sorted(J.items()):
        print("HDX joint %-12s %s" % (n, tuple(round(c, 3) for c in p)))
    print("HDX total tris", tot, "->", a.out)


if __name__ == "__main__":
    main()
