"""Part kit: fitted mech parts (packs, arms, sensors, waist kit) and other single-piece assets as GLBs for the game.

Builds on hskit (masses by booleans, carving) and vkit (primitives, the colour bake). A part is a `Build`: closed masses and
details go into its body, lit faces into its glow, moving pieces into named nodes; `write()` bakes edge light and ambient
occlusion into the vertex colours and exports `<out>/<id>.glb` + `<id>.json` to the game's contract (docs/asset-list.md):
Y up, front +Z, the mech's left +X, one `Body` mesh in a `Paint_plating` material, a `Glow` mesh in `Paint_lighting`, empties
for sockets. `sheet()` renders the builder's check views with Cycles on the CPU (works in cloud sessions).

Author in Blender's frame: metres, Z up, front -Y, left +X, the part's mount point at the origin.

    node tools/blender/run.mjs tools/blender/parts/<script>.py -- --out public/models/parts [--only <id>] [--sheet <dir>]
"""
import argparse
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
for p in (os.path.join(TOOLS, "mechs"), os.path.join(TOOLS, "vehicles")):
    if p not in sys.path:
        sys.path.insert(0, p)
import hskit as H  # noqa: E402
import vkit as V  # noqa: E402

X_, Y_, Z_ = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
RIM_K = 1.22          # chamfers and fillets against the paint: the bright edge line (the Rampart's value)
BAKE_AT = 5.0         # the bake's ground gradient and low dust are for vehicles: parts ride high on a mech, so bake up there


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default=None)
    ap.add_argument("--sheet", default=None)
    a = ap.parse_args(argv)
    a.out = os.path.abspath(a.out)
    if a.sheet:
        a.sheet = os.path.abspath(a.sheet)
    return a


def ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return list(pts) if a > 0 else list(reversed(pts))


def ngon(cx, cy, rx, ry, n, phase=0.0):
    return [(cx + rx * math.cos(phase + 2 * math.pi * i / n), cy + ry * math.sin(phase + 2 * math.pi * i / n)) for i in range(n)]


def scale_faces(P, faces, k):
    for f in faces:
        for l in f.loops:
            c = l[P.col]
            l[P.col] = (V.clamp(c[0] * k), V.clamp(c[1] * k), V.clamp(c[2] * k), 1.0)


def rims(S, k=RIM_K):
    """Brightens every bevel a boolean left (cut rims, fused seams): the edge line that catches the sun at 40 m."""
    scale_faces(S, [f for f in S.bm.faces if f[S.tag] in (H.TAG_RIM, H.TAG_FILLET)], k)
    return S


def mass(outlines, name="mass", col=(0.5, 0.5, 0.5), mat="primary", fillet=0.03):
    """A mass as the intersection of up to three profile prisms: {"x": (outline (y, z), a0, a1), "y": ((x, z), ...), "z": ...}.
    Its rims between the profiles are chamfered and brightened."""
    solids = [H.prism(ccw(o), ax, a0, a1, mat, col, name + ax) for ax, (o, a0, a1) in outlines.items()]
    S = solids[0] if len(solids) == 1 else H.intersect(solids, name, fillet=fillet)
    return rims(S)


def cut(S, cutters, bevel=0.012):
    H.carve(S, cutters, bevel=bevel)
    return rims(S)


def lathe(P, a, b, prof, n=12, mat="dark", col=(0.2, 0.2, 0.2), flag=0):
    """A turned shape between two points: prof = [(t 0-1 along a->b, radius), ...] (nozzles, bells, tanks at any angle)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    M = Matrix.Translation(a) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    rings = [[Vector((math.cos(2 * math.pi * k / n) * r, math.sin(2 * math.pi * k / n) * r, t * d.length)) for k in range(n)]
             for t, r in prof]
    return V.prim(P, rings, mat, col, flag, M)


class Build:
    """One part: a body piece, a glow piece, moving nodes (each its own piece on a pivot) and sockets."""

    def __init__(self, pid, kind, name, seed=1, maker="", says=""):
        self.id, self.kind, self.name, self.maker, self.says = pid, kind, name, maker, says
        self.body = V.Piece("Body", (0, 0, 0), seed)
        self.glow = V.Piece("Glow", (0, 0, 0), seed + 1)
        self.nodes = {}        # name -> (Piece, pivot, parent name or None, {"axis", "travel"} for the sidecar)
        self.sockets = {}      # name -> (position, forward or None)
        self.rng = random.Random(seed)

    def add(self, S, piece=None):
        """A finished Solid into the body (or a node's piece)."""
        H.commit(S, piece or self.body)
        return S

    def node(self, name, pivot, parent=None, **move):
        P = V.Piece(name, pivot, len(self.nodes) + 11)
        self.nodes[name] = (P, Vector(pivot), parent, move)
        return P

    def socket(self, name, at, forward=None):
        self.sockets[name] = (Vector(at), Vector(forward) if forward else None)

    def lamp(self, c, size, n, col, piece=None):
        """A lit rectangle or disc face (size (w, h) or a radius) facing n: into the glow piece, kept out of the bake."""
        P = piece or self.glow
        n = Vector(n).normalized()
        u, v, _ = V.basis_from(n)
        c = Vector(c)
        if isinstance(size, (int, float)):
            fs = V.bar(P, c, c + n * 0.012, size, "glow", col, 10)
        else:
            fs = V.surf_blk(P, c, u, v, n, size[0], size[1], 0.012, "glow", col)
        for f in fs or []:
            f[P.flag] = V.NOBAKE


def _ao(P, rays=14, reach=0.45, strength=0.6):
    """Ambient occlusion into the loop colours: rays over each face's hemisphere against the piece itself. Crevices, the
    undersides of overhangs and the gaps between cylinders go dark, which is what makes forms read under a high sun."""
    bm = P.bm
    if not len(bm.faces):
        return
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    rng = random.Random(7)
    dirs = []
    while len(dirs) < rays:
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.15, 1)))
        if 0.05 < d.length <= 1.0:
            dirs.append(d.normalized())
    for f in bm.faces:
        if f[P.flag] & V.NOBAKE:
            continue
        n = f.normal
        u, v, _ = V.basis_from(n)
        cen = f.calc_center_median()
        for l in f.loops:
            o = l.vert.co.lerp(cen, 0.12) + n * 0.006
            occ = 0.0
            for d in dirs:
                w = u * d.x + v * d.y + n * d.z
                hit = tree.ray_cast(o, w, reach)
                if hit[0] is not None:
                    occ += 1.0 - hit[3] / reach
            k = 1.0 - strength * (occ / rays)
            c = l[P.col]
            l[P.col] = (c[0] * k, c[1] * k, c[2] * k, 1.0)


def _emit(P, parent, mat_name, wear):
    if P.empty():
        return None
    _ao(P)
    origin = P.origin.copy()
    P.origin = origin + Vector((0, 0, BAKE_AT))
    obj = V.emit(P, parent, wear)
    P.origin = origin
    obj.location = (0, 0, 0)      # the body sits on the root; a node's mesh sits on its pivot empty
    me = obj.data
    me.materials.clear()
    me.materials.append(V.material(mat_name, (0.6, 0.6, 0.6)))
    for poly in me.polygons:
        poly.material_index = 0
        poly.use_smooth = False
    return obj


def write(b, out_dir, wear=None):
    """Bakes and exports the build. Returns its numbers (also in the sidecar)."""
    V.clear_scene()
    wear = wear if wear is not None else {"dust": 0.12}
    root = V.new_empty(b.id)
    objs, tris = [], 0
    body = _emit(b.body, root, "Paint_plating", wear)
    glow = _emit(b.glow, root, "Paint_lighting", wear)
    made = {None: root}
    for name, (P, pivot, parent, move) in b.nodes.items():
        par = made[parent]
        e = V.new_empty(name, par, pivot - Vector(par.get("pivot", (0, 0, 0))))
        e["pivot"] = tuple(pivot)
        made[name] = e
        P.name = name + "_Mesh"
        o = _emit(P, e, "Paint_plating", wear)
        if o:
            objs.append(o)
    for name, (at, fwd) in b.sockets.items():
        e = V.new_empty(name, root, at)
        if fwd:
            e.rotation_euler = fwd.to_track_quat("-Y", "Z").to_euler()
    for o in (body, glow):
        if o:
            objs.append(o)
    for o in objs:
        tris += len(o.data.loop_triangles)
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    bpy.context.view_layer.update()
    for o in objs:
        for vtx in o.data.vertices:
            w = o.matrix_world @ vtx.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, b.id + ".glb")
    bpy.ops.object.select_all(action="DESELECT")
    for o in [root] + list(root.children_recursive):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                              export_vertex_color="ACTIVE", export_active_vertex_color_when_no_material=True,
                              export_all_vertex_colors=False, export_texcoords=False, export_normals=True,
                              export_materials="EXPORT", export_animations=False, export_extras=False)
    # the sidecar speaks the game's frame: x left, y up, z forward (Blender's x, z, -y)
    g = lambda p: [round(p.x, 4), round(p.z, 4), round(-p.y, 4)]  # noqa: E731
    side = {
        "id": b.id, "kind": b.kind, "name": b.name, "maker": b.maker, "says": b.says, "tris": tris,
        "meshes": len(objs), "size": [round(hi.x - lo.x, 3), round(hi.z - lo.z, 3), round(hi.y - lo.y, 3)],
        "min": g(Vector((lo.x, hi.y, lo.z))), "max": g(Vector((hi.x, lo.y, hi.z))),
        "sockets": {k: g(at) for k, (at, _) in b.sockets.items()},
        "moving": {k: dict(move, pivot=g(pivot)) for k, (_, pivot, _, move) in b.nodes.items()},
        "source": "tools/blender/parts/" + os.path.basename(sys.modules["__main__"].__file__),
    }
    with open(os.path.join(out_dir, b.id + ".json"), "w") as f:
        json.dump(side, f, indent=1)
        f.write("\n")
    print("PART %-18s %5d tris  %d meshes  size %.2f x %.2f x %.2f (w h d)" % (b.id, tris, len(objs), *side["size"]))
    return side


def sheet(path, views=None, res=(620, 520), samples=24, extra=None):
    """Renders the scene as it stands (after write()) from the builder's check views, with Cycles on the CPU: a hard high sun
    like the game's, the paint from the vertex colours. views: [(name, yaw from behind (deg), pitch down (deg), distance)].
    `extra(scene)` can add stand-in context (a slab for the hull's back)."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.view_settings.view_transform = "Standard"
    for m in bpy.data.materials:
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        col = nt.nodes.new("ShaderNodeVertexColor")
        col.layer_name = "Color"
        if m.name == "Paint_lighting":
            sh = nt.nodes.new("ShaderNodeEmission")
            sh.inputs["Strength"].default_value = 2.5
            nt.links.new(col.outputs["Color"], sh.inputs["Color"])
            nt.links.new(sh.outputs["Emission"], out.inputs["Surface"])
        else:
            sh = nt.nodes.new("ShaderNodeBsdfPrincipled")
            sh.inputs["Roughness"].default_value = 0.55
            nt.links.new(col.outputs["Color"], sh.inputs["Base Color"])
            nt.links.new(sh.outputs["BSDF"], out.inputs["Surface"])
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.78, 0.74, 0.66, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    sc.world = w
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.0
    sun.data.angle = 0.03
    sun.rotation_euler = (math.radians(38), 0, math.radians(-35))
    sc.collection.objects.link(sun)
    if extra:
        extra(sc)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 70
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = Vector((0, 0.05, 0.12))
    views = views or [("game", 0, 50, 5.2), ("rear34", 38, 22, 4.6), ("side", 80, 12, 4.6)]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for name, yaw, pitch, dist in views:
        y, p = math.radians(yaw), math.radians(pitch)
        d = Vector((math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p)))    # from behind (+Y), turned by yaw
        cam.location = target + d * dist
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = "%s-%s.png" % (path, name)
        bpy.ops.render.render(write_still=True)
