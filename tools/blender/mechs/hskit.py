"""Hard-surface kit for mech parts (2026-10-22, Keith's review of the mech studies).

Keith: "I'm not seeing much sign of using booleans to shape/carve armor ... I would expect more massing, the use of booleans
to join those masses. More use of strip modeling to create plates and then to extrude them. More use of welding to have
distinct curved surfaces that meet other curved surfaces."

Four scriptable techniques, headless (blender -b), on top of the vehicle kit's Piece (tools/blender/vehicles/vkit.py, read-only):

1. fuse()         massing + boolean union: overlapping masses (lofts, superellipse stations, anything closed) are joined by the
                  Boolean modifier (EXACT) into one manifold shell, cleaned (merge by distance, limited dissolve that keeps
                  paint sections, normals), and the intersection edges are bevelled into a cast fillet.
2. carve()        boolean carving: difference cutters (cutter_prism / cut_rect / cut_vents / cut_slab) make panel recesses,
                  chamfered cut-outs, vents, stepped edges and sloped cuts that expose an inner layer; the cut rims are bevelled.
                  A cutter's faces become the cut's walls and floor, so the cutter carries the paint of what the cut exposes.
3. strip_plate()  strip modelling: a strip of quads laid along a path and projected onto a mass (shrinkwrap to the nearest
                  surface point, smooth normals), its outline shaped (taper, notches, angled ends), then extruded to thickness
                  with a chamfered rim, standing `off` off the surface so the layering reads.
4. weld()         welding curved surfaces: two distinct curved solids unioned along their intersection with a fillet, plus an
                  optional weld bead swept along the seam (a rippled tube), so curved meets curved cleanly.

Everything works on a Solid (a vkit Piece at the origin, so every vkit / ikit / mil_kit primitive builds into it), and commit()
copies a finished Solid into a part's Piece (its joint origin), where the study's bake and emit take over unchanged.

Every face carries an int "hs_tag" (TAG_*): which technique made it. emit() keeps it as a mesh attribute, so a render can
paint the techniques (the technique map), and nothing else reads it.

Robustness: inputs are healed (merge, hole fill, normals); every boolean result is checked (manifold edges, volume, cutter
actually hit); EXACT falls back to EXACT hole-tolerant, then FAST, then (union) a plain join or (difference) cutter by cutter,
skipping a bad cutter. Bevels are undone if they break the mesh. Every fallback is logged in LOG (and printed "HSKIT ...").

Conventions as the studies: 1 unit = 1 m, Z up, the mech's front is -Y, its left +X; build in world rest-pose coordinates.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector, geometry
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "vehicles"))
import vkit as V  # noqa: E402  (read-only reuse)

LOG = []
STATS = {"booleans": 0, "exact_ok": 0, "fallbacks": 0, "skipped_cutters": 0, "bevel_undone": 0, "plate_refolds": 0}

TAG_NONE, TAG_MASS, TAG_FILLET, TAG_CUT, TAG_RIM, TAG_PLATE, TAG_BEAD, TAG_ADDON = 0, 1, 2, 3, 4, 5, 6, 7
TAG_NAMES = {0: "other", 1: "fused mass", 2: "fillet / weld seam", 3: "carved wall or floor", 4: "cut rim bevel",
             5: "strip plate", 6: "weld bead", 7: "add-on (reactive bricks, stowage; skipped by the axis-aligned check)"}
_CUT_BASE = 100000
_next_op = [1]


def log(msg):
    LOG.append(msg)
    print("HSKIT", msg)


def _fresh_op():
    _next_op[0] += 1
    return _next_op[0]


# ------------------------------------------------------------------------------------------------------------ Solid
class Solid(V.Piece):
    """A vkit Piece at the world origin with two extra face layers: hs_op (which operand a face came from, for seams) and
    hs_tag (which technique made it). Build masses into it with any vkit / ikit / mil_kit primitive."""

    def __init__(self, name="solid", seed=0, tag=TAG_MASS):
        super().__init__(name, (0, 0, 0), seed)
        self.op = self.bm.faces.layers.int.new("hs_op")
        self.tag = self.bm.faces.layers.int.new("hs_tag")
        self.default_tag = tag
        self.decor = None  # a Solid for geometry kept out of later booleans (weld beads, plates): see decor_solid()
        self.seams = []   # polylines (lists of Vector) of the last fuse / weld
        self.rims = []    # polylines of the last carve's cut rims

    def rebind(self, bm):
        """Points the layer handles at a new bmesh (after a boolean)."""
        self.bm = bm
        L = bm.loops.layers.color
        self.col = L.get("Color") or L.new("Color")
        F = bm.faces.layers.int
        self.sec = F.get("sec") or F.new("sec")
        self.flag = F.get("flag") or F.new("flag")
        self.op = F.get("hs_op") or F.new("hs_op")
        self.tag = F.get("hs_tag") or F.new("hs_tag")

    def tag_untagged(self, tag=None):
        t = self.default_tag if tag is None else tag
        for f in self.bm.faces:
            if f[self.tag] == 0:
                f[self.tag] = t

    def set_op(self, op):
        for f in self.bm.faces:
            f[self.op] = op

    def decor_solid(self):
        """The Solid that holds this solid's add-ons (weld beads, strip plates): separate shells that overlap the surface, so
        they stay out of the booleans (a boolean target must not self-intersect) and commit() copies them along."""
        if self.decor is None:
            self.decor = Solid(self.name + "_decor", self.seed, TAG_NONE)
        return self.decor

    def copy(self, name=None):
        S = Solid(name or self.name, self.seed, self.default_tag)
        S.rebind(self.bm.copy())
        S.decor = self.decor
        return S


def tris(bm):
    return sum(len(f.verts) - 2 for f in bm.faces)


def nonmanifold(bm):
    return sum(1 for e in bm.edges if not e.is_manifold)


def volume(bm):
    try:
        return abs(bm.calc_volume(signed=False))
    except Exception:
        return 0.0


def heal(S, what="solid"):
    """Merge by distance, fill holes, recalc normals. Returns the non-manifold edge count left."""
    bm = S.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bad = [e for e in bm.edges if not e.is_manifold]
    if bad:
        bmesh.ops.holes_fill(bm, edges=[e for e in bad if e.is_boundary], sides=0)
        left = nonmanifold(bm)
        log("heal %s: %d non-manifold edges, %d after hole fill" % (what, len(bad), left))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return nonmanifold(bm)


def clean(S, dissolve_deg=1.0, merge=1e-4):
    """Merge by distance, drop degenerate faces, limited dissolve of near-flat edges that never crosses a paint section,
    flag or technique boundary, recalc normals. Keeps the triangle count in check after booleans."""
    bm = S.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=merge)
    bmesh.ops.dissolve_degenerate(bm, dist=merge * 0.5, edges=bm.edges[:])
    if dissolve_deg > 0:
        for e in bm.edges:
            lf = e.link_faces
            e.seam = len(lf) == 2 and (lf[0][S.sec] != lf[1][S.sec] or lf[0][S.flag] != lf[1][S.flag] or
                                       lf[0][S.tag] != lf[1][S.tag])
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(dissolve_deg), use_dissolve_boundaries=False,
                                 verts=bm.verts[:], edges=bm.edges[:], delimit={"SEAM"})
        for e in bm.edges:
            e.seam = False
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


# ------------------------------------------------------------------------------------------------------- booleans
def _obj(bm, name, coll):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return o


def _tmp_coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def _drop(coll):
    for o in list(coll.objects):
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
    bpy.data.collections.remove(coll)


def _boolean(target_bm, operand_bms, operation, solver="EXACT", hole_tolerant=False, use_self=False):
    """Runs the Boolean modifier on copies; returns a new bmesh (or None on an exception)."""
    STATS["booleans"] += 1
    work = _tmp_coll("hs_work")
    ops = bpy.data.collections.new("hs_ops")
    work.children.link(ops)
    try:
        tgt = _obj(target_bm, "hs_target", work)
        for i, b in enumerate(operand_bms):
            _obj(b, "hs_operand%d" % i, ops)
        m = tgt.modifiers.new("hs", "BOOLEAN")
        m.operation = operation
        m.solver = solver
        if solver == "EXACT":
            m.use_hole_tolerant = hole_tolerant
            m.use_self = use_self
        if solver == "EXACT":
            m.operand_type = "COLLECTION"
            m.collection = ops
        else:
            m.operand_type = "OBJECT"
            m.object = ops.objects[0]
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        me = bpy.data.meshes.new_from_object(tgt.evaluated_get(dg))
        out = bmesh.new()
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
        return out
    except Exception as ex:  # noqa: BLE001
        log("boolean %s %s raised %s" % (operation, solver, ex))
        return None
    finally:
        for o in list(ops.objects):
            me = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.meshes.remove(me)
        bpy.data.collections.remove(ops)
        _drop(work)


def _chains(edges):
    """Edge set -> polylines (lists of Vector), walking vertex to vertex."""
    adj = {}
    for e in edges:
        for v in e.verts:
            adj.setdefault(v, []).append(e)
    used = set()
    out = []
    starts = [v for v, es in adj.items() if len(es) == 1] + list(adj.keys())
    for s in starts:
        for e0 in adj[s]:
            if e0 in used:
                continue
            chain = [s.co.copy()]
            v, e = s, e0
            while e is not None and e not in used:
                used.add(e)
                v = e.other_vert(v)
                chain.append(v.co.copy())
                nxt = [x for x in adj.get(v, []) if x not in used]
                e = nxt[0] if nxt else None
            if len(chain) > 1:
                out.append(chain)
    return out


def _bevel(S, edges, width, segments, profile=0.5, tag=None):
    """Bevels edges in place; undone (and logged) if it breaks the manifold. Returns the new faces."""
    edges = [e for e in edges if e.is_valid and e.is_manifold]
    if not edges or width <= 0:
        return []
    before = S.bm.copy()
    nm0 = nonmanifold(S.bm)
    try:
        res = bmesh.ops.bevel(S.bm, geom=edges, offset=width, offset_type="OFFSET", segments=segments, profile=profile,
                              affect="EDGES", clamp_overlap=True, loop_slide=True, mark_seam=False, mark_sharp=False,
                              harden_normals=False, face_strength_mode="NONE", miter_outer="SHARP", miter_inner="SHARP",
                              spread=0.1, vmesh_method="ADJ", profile_type="SUPERELLIPSE")
        faces = res["faces"]
    except Exception as ex:  # noqa: BLE001
        log("bevel raised %s; undone" % ex)
        S.rebind(before)
        STATS["bevel_undone"] += 1
        return []
    if nonmanifold(S.bm) > nm0:
        log("bevel (%d edges, %.3f m) broke the manifold (%d -> %d); undone" % (len(edges), width, nm0, nonmanifold(S.bm)))
        S.bm.free()
        S.rebind(before)
        STATS["bevel_undone"] += 1
        return []
    before.free()
    if tag is not None:
        for f in faces:
            f[S.tag] = tag
    return faces


def fuse(solids, name="fused", fillet=0.03, segments=2, profile=0.5, bead=0.0, bead_mat="dark", bead_col=(0.2, 0.19, 0.18),
         bead_pitch=0.07, dissolve=1.0, fillet_tag=TAG_FILLET):
    """Massing + boolean union. solids: overlapping closed Solids (each a mass). Returns one Solid: the union, cleaned, its
    intersection edges bevelled (fillet: width in m, segments 2-3 reads as a cast fillet, 1 as a chamfer), optionally a weld
    bead swept along each seam. The seam polylines are left in .seams."""
    solids = [s for s in solids if s is not None and len(s.bm.faces)]
    if not solids:
        return Solid(name)
    for s in solids:
        s.tag_untagged()
        heal(s, s.name)
        s.set_op(_fresh_op())
    vols = [volume(s.bm) for s in solids]
    if len(solids) == 1:
        out = solids[0].copy(name)
        clean(out, dissolve)
        return out
    target, rest = solids[0], solids[1:]
    res, how = None, ""
    for solver, tol in (("EXACT", False), ("EXACT", True), ("FAST", False)):
        if solver == "FAST":
            # FAST takes one operand at a time
            bm = target.bm.copy()
            ok = True
            for r in rest:
                nb = _boolean(bm, [r.bm], "UNION", "FAST")
                bm.free()
                if nb is None:
                    ok = False
                    break
                bm = nb
            cand = bm if ok else None
        else:
            cand = _boolean(target.bm, [r.bm for r in rest], "UNION", solver, tol)
        if cand is None:
            continue
        v, nm = volume(cand), nonmanifold(cand)
        if len(cand.faces) and nm == 0 and max(vols) * 0.97 <= v <= sum(vols) * 1.03:
            res, how = cand, solver + (" hole-tolerant" if tol else "")
            break
        log("union %s: %s%s rejected (volume %.4f, expected %.4f..%.4f, non-manifold %d)" %
            (name, solver, " hole-tolerant" if tol else "", v, max(vols), sum(vols), nm))
        cand.free()
    out = Solid(name, solids[0].seed)
    if res is None:
        STATS["fallbacks"] += 1
        log("union %s: every solver failed; joined the masses without a union (no fillet)" % name)
        bm = bmesh.new()
        for s in solids:
            me = bpy.data.meshes.new("hs_join")
            s.bm.to_mesh(me)
            bm.from_mesh(me)
            bpy.data.meshes.remove(me)
        out.rebind(bm)
        _merge_decor(out, solids)
        return out
    if how == "EXACT":
        STATS["exact_ok"] += 1
    else:
        STATS["fallbacks"] += 1
        log("union %s: used %s" % (name, how))
    out.rebind(res)
    _merge_decor(out, solids)
    clean(out, dissolve)
    seam = [e for e in out.bm.edges if len(e.link_faces) == 2 and e.link_faces[0][out.op] != e.link_faces[1][out.op]]
    out.seams = _chains(seam)
    _bevel(out, seam, fillet, segments, profile, tag=fillet_tag)
    if bead > 0:
        for ch in out.seams:
            weld_bead(out.decor_solid(), ch, bead, bead_mat, bead_col, pitch=bead_pitch)
    return out


def _merge_decor(out, solids):
    for s in solids:
        if s.decor is not None and len(s.decor.bm.faces):
            _append(out.decor_solid(), s.decor)


def weld(a, b, name="welded", fillet=0.025, segments=2, bead=0.022, bead_mat="dark", bead_col=(0.2, 0.19, 0.18), **kw):
    """Welds two distinct curved solids: boolean union along their intersection, a fillet on the seam and a weld bead swept
    along it. Same as fuse([a, b]) with a bead; kept separate so a builder says what it means."""
    return fuse([a, b], name, fillet=fillet, segments=segments, bead=bead, bead_mat=bead_mat, bead_col=bead_col, **kw)


def weld_bead(S, chain, r, mat="dark", col=(0.2, 0.19, 0.18), pitch=0.07, n=5, ripple=0.25):
    """A weld bead: a low tube swept along a polyline, its radius rippling every `pitch` metres (stacked weld puddles)."""
    pts = _resample(chain, pitch * 0.5)
    if len(pts) < 2:
        return []
    rings = []
    prev_u = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        u = prev_u - t * prev_u.dot(t) if prev_u is not None else t.orthogonal()
        if u.length < 1e-6:
            u = t.orthogonal()
        u.normalize()
        prev_u = u
        w = t.cross(u)
        rr = r * (1.0 if i % 2 == 0 else 1.0 - ripple)
        if i in (0, len(pts) - 1):
            rr *= 0.5
        rings.append([p + (u * math.cos(2 * math.pi * k / n) + w * math.sin(2 * math.pi * k / n)) * rr for k in range(n)])
    faces = V.prim(S, rings, mat, col, 0, None, jitter=0.0)
    for f in faces:
        f[S.tag] = TAG_BEAD
    return faces


def _resample(chain, step):
    out = [chain[0]]
    for a, b in zip(chain, chain[1:]):
        L = (b - a).length
        k = max(1, int(L / step))
        for i in range(1, k + 1):
            out.append(a.lerp(b, i / k))
    return out


def carve(S, cutters, bevel=0.012, segments=1, profile=0.5, dissolve=1.0, name=None, rim_tag=TAG_RIM, min_keep=0.15):
    """Boolean carving: subtracts every cutter Solid from S (in place). The cutters' faces become the cut walls and floors
    (tag TAG_CUT, the cutter's paint section and colour); the cut rims (edges between the old surface and a cut wall) are
    bevelled by `bevel` (segments 1 = a chamfer). Cutters that miss or break the mesh are skipped and logged. A result
    keeping less than `min_keep` of the volume counts as a failed solve: pass a small value when hollowing a thin shell
    (mass(d1) - mass(d0) keeps only a few % of a big mass)."""
    name = name or S.name
    cutters = [c for c in cutters if c is not None and len(c.bm.faces)]
    if not cutters:
        return S
    S.tag_untagged()
    heal(S, name)
    S.set_op(_fresh_op())
    for i, c in enumerate(cutters):
        heal(c, "%s cutter %d" % (name, i))
        c.set_op(_CUT_BASE + i)
        for f in c.bm.faces:
            f[c.tag] = TAG_CUT
    v0 = volume(S.bm)

    def ok(bm, label, ref=None):
        ref = v0 if ref is None else ref
        v, nm = volume(bm), nonmanifold(bm)
        hit = any(f[bm.faces.layers.int["hs_op"]] >= _CUT_BASE for f in bm.faces)
        good = len(bm.faces) and nm == 0 and v <= ref * 1.002 and v >= ref * min_keep and hit
        if not good:
            log("carve %s: %s rejected (volume %.4f of %.4f, non-manifold %d, cutter hit %s)" % (name, label, v, ref, nm, hit))
        return good

    res = None
    for solver, tol, slf in (("EXACT", False, False), ("EXACT", True, False), ("EXACT", False, True)):
        label = solver + (" hole-tolerant" if tol else "") + (" self-intersecting" if slf else "")
        cand = _boolean(S.bm, [c.bm for c in cutters], "DIFFERENCE", solver, tol, slf)
        if cand is not None and ok(cand, label):
            res = cand
            if tol or slf:
                STATS["fallbacks"] += 1
            else:
                STATS["exact_ok"] += 1
            break
        if cand is not None:
            cand.free()
    if res is None:
        # one cutter at a time, EXACT then FAST; skip the ones that fail
        STATS["fallbacks"] += 1
        log("carve %s: all-at-once failed; cutting one by one" % name)
        bm = S.bm.copy()
        for i, c in enumerate(cutters):
            done = False
            for solver in ("EXACT", "FAST"):
                cand = _boolean(bm, [c.bm], "DIFFERENCE", solver)
                if cand is None:
                    continue
                good = ok(cand, "cutter %d %s" % (i, solver), volume(bm))
                if good:
                    bm.free()
                    bm = cand
                    done = True
                    break
                cand.free()
            if not done:
                STATS["skipped_cutters"] += 1
                log("carve %s: skipped cutter %d" % (name, i))
        res = bm
    S.bm.free()
    S.rebind(res)
    clean(S, dissolve)
    rim = [e for e in S.bm.edges if len(e.link_faces) == 2 and
           ((e.link_faces[0][S.op] >= _CUT_BASE) != (e.link_faces[1][S.op] >= _CUT_BASE))]
    S.rims = _chains(rim)
    _bevel(S, rim, bevel, segments, profile, tag=rim_tag)
    return S


# --------------------------------------------------------------------------------------------------------- cutters
def offset_outline(pts, d):
    """Miter offset of a closed CCW 2D outline by d (outward > 0)."""
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e1, e2 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n1, n2 = Vector((e1.y, -e1.x)), Vector((e2.y, -e2.x))
        m = n1 + n2
        k = 1.0 + n1.dot(n2)
        out.append(p1 + m * (d / max(k, 0.25)))
    return out


def safe_offset(pts, d):
    """offset_outline that never turns an edge inside out: an inset larger than a short edge (a clipped corner) would fold
    the outline and wreck the boolean, so the inset is halved until every edge keeps its direction."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    for _ in range(8):
        o = offset_outline(pts, d)
        if all((o[(i + 1) % n] - o[i]).dot(pts[(i + 1) % n] - pts[i]) > 1e-7 for i in range(n)):
            return o
        d *= 0.5
    return pts


def rect_outline(w, h, corner=0.0, cx=0.0, cy=0.0, skew=0.0):
    """A w x h rectangle (CCW) with its corners clipped by `corner`; skew shifts the top edge along x (a parallelogram)."""
    a, b = w / 2, h / 2
    c = min(corner, a * 0.9, b * 0.9)
    if c <= 1e-4:
        pts = [(-a, -b), (a, -b), (a + skew, b), (-a + skew, b)]
    else:
        pts = [(-a + c, -b), (a - c, -b), (a, -b + c), (a + skew, b - c), (a + skew - c, b), (-a + skew + c, b), (-a + skew, b - c),
               (-a, -b + c)]
    return [(x + cx, y + cy) for x, y in pts]


def cutter_prism(outline, c, u, v, n, depth=0.05, out=0.4, slope=0.6, mat="dark", col=(0.2, 0.19, 0.18), flag=0, steps=None):
    """A cutter: a 2D outline (CCW in the u, v frame at c, n outward) extruded from `depth` below the surface to `out` above.
    slope (metres of offset per metre of height) splays the walls: the cut is wider at the surface than at its floor, a
    chamfered, cast-looking recess. steps: optional [(h, extra_offset)] for stepped (terraced) walls."""
    c, u, v, n = Vector(c), Vector(u).normalized(), Vector(v).normalized(), Vector(n).normalized()
    levels = [(-depth, -slope * depth)]
    for h, e in (steps or []):
        levels.append((h, slope * h + e))
    levels.append((out, slope * out))
    rings = []
    for h, d in sorted(levels):
        o2 = safe_offset(outline, d)
        rings.append([c + u * p.x + v * p.y + n * h for p in o2])
    C = Solid("cutter", tag=TAG_CUT)
    V.prim(C, rings, mat, col, flag, None, jitter=0.0)
    return C


def cut_rect(c, u, v, n, w, h, depth=0.04, corner=0.03, slope=0.8, mat="dark", col=(0.2, 0.19, 0.18), skew=0.0, out=0.4):
    """A panel recess or chamfered cut-out: a clipped-corner rectangle."""
    return cutter_prism(rect_outline(w, h, corner, skew=skew), c, u, v, n, depth, out, slope, mat, col)


def cut_vents(c, u, v, n, w, h, count, gap=0.35, depth=0.06, slope=0.5, mat="dark", col=(0.12, 0.11, 0.11), corner=0.01):
    """`count` parallel vent slots across a w x h area (slots run along u; gap = the land between them as a share of a slot)."""
    pitch = h / count
    sh = pitch * (1 - gap)
    out = []
    for i in range(count):
        cy = -h / 2 + pitch * (i + 0.5)
        # the caps above the surface are staggered: coplanar overlapping caps of neighbouring cutters upset EXACT
        out.append(cutter_prism(rect_outline(w, sh, corner, cy=cy), c, u, v, n, depth, 0.4 + 0.017 * i, slope, mat, col))
    return out


def cut_slab(p, n, u, w, h, d, mat="dark", col=(0.2, 0.19, 0.18), slope=0.0):
    """A slab cutter: everything within w (along u) x h (along n x u) x d (along -n, into the part) under the plane through p
    with normal n. Rotate n to slice a sloped facet off a mass, keep d shallow to make a stepped edge."""
    p, n, u = Vector(p), Vector(n).normalized(), Vector(u).normalized()
    v = n.cross(u).normalized()
    return cutter_prism(rect_outline(w, h), p, u, v, n, d, 0.6, slope, mat, col)


# ------------------------------------------------------------------------------------------------------ strip plates
class Surface:
    """A projection target: the nearest point on a Solid (or Piece / bmesh), with smooth (interpolated vertex) normals."""

    def __init__(self, src):
        bm = (src.bm if hasattr(src, "bm") else src).copy()
        origin = getattr(src, "origin", Vector((0, 0, 0)))
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.normal_update()
        bm.faces.ensure_lookup_table()
        self.tri = [[(l.vert.co + origin, l.vert.normal.copy()) for l in f.loops] for f in bm.faces]
        if origin.length:
            for vv in bm.verts:
                vv.co += origin
        self.tree = BVHTree.FromBMesh(bm)
        bm.free()

    def project(self, p, along=None):
        p = Vector(p)
        hit = None
        if along is not None:
            d = Vector(along).normalized()
            hit = self.tree.ray_cast(p - d * 1.5, d, 3.0)
            if hit[0] is None:
                hit = None
        if hit is None:
            hit = self.tree.find_nearest(p)
        loc, fn, idx, _ = hit
        if loc is None:
            return p, Vector((0, 0, 1))
        (a, na), (b, nb), (c, nc) = self.tri[idx]
        w = geometry.barycentric_transform(loc, a, b, c, Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
        n = na * w.x + nb * w.y + nc * w.z
        if n.length < 1e-6 or n.dot(fn) < 0.2:
            n = fn
        return loc, n.normalized()


def _path_at(path, cum, s):
    L = cum[-1]
    if s <= 0:
        return path[0] + (path[1] - path[0]).normalized() * s
    if s >= L:
        return path[-1] + (path[-1] - path[-2]).normalized() * (s - L)
    for i in range(1, len(cum)):
        if s <= cum[i]:
            k = (s - cum[i - 1]) / max(1e-9, cum[i] - cum[i - 1])
            return path[i - 1].lerp(path[i], k)
    return path[-1]


def _self_overlaps(faces):
    """Pairs of non-adjacent faces that intersect (a folded plate)."""
    from mathutils.bvhtree import BVHTree
    verts, idx, polys = [], {}, []
    for f in faces:
        poly = []
        for v in f.verts:
            if v not in idx:
                idx[v] = len(verts)
                verts.append(v.co.copy())
            poly.append(idx[v])
        polys.append(poly)
    t = BVHTree.FromPolygons(verts, polys)
    return sum(1 for a, b in t.overlap(t) if a != b and not (set(polys[a]) & set(polys[b])))


def strip_plate(P, surf, path, width=0.2, n_across=None, thick=0.05, off=0.012, ch=0.02, mat="primary", col=(0.5, 0.5, 0.5),
                skew=(0.0, 0.0), notches=(), row_len=0.2, along=None, flag=0, tag=TAG_PLATE, crown=0.0, info=None):
    """strip_plate with a fold guard: a strong skew (angled end) on a wide plate wrapped round a curve can fold the strip
    through itself, which poisons any later boolean on it. The plate is checked for self-intersection and rebuilt with the
    skew halved (twice, then dropped) until it is clean; every retry is logged."""
    sk = tuple(skew)
    for attempt in range(4):
        faces = _strip_plate(P, surf, path, width, n_across, thick, off, ch, mat, col, sk, notches, row_len, along, flag, tag,
                             crown, info)
        bad = _self_overlaps(faces)
        if not bad or sk == (0.0, 0.0):
            if bad:
                log("strip_plate %s: %d self-intersections left with no skew" % (P.name, bad))
            return faces
        log("strip_plate %s: folded (%d face pairs) at skew %s; retrying with half the skew" % (P.name, bad, sk))
        STATS["plate_refolds"] = STATS.get("plate_refolds", 0) + 1
        vs = {v for f in faces for v in f.verts}
        bmesh.ops.delete(P.bm, geom=list(vs), context="VERTS")
        sk = (0.0, 0.0) if attempt == 2 else (sk[0] * 0.5, sk[1] * 0.5)
    return faces


def _strip_plate(P, surf, path, width=0.2, n_across=None, thick=0.05, off=0.012, ch=0.02, mat="primary", col=(0.5, 0.5, 0.5),
                 skew=(0.0, 0.0), notches=(), row_len=0.2, along=None, flag=0, tag=TAG_PLATE, crown=0.0, info=None):
    """A strip-modelled armour plate on `surf` (a Surface).

    path: points roughly on the surface (the plate's centre line). width: half width, (w_start, w_end) tapered, or a callable
    s (0..1) -> (left, right). skew: (start, end) metres the end edge shifts along the path per metre across (angled ends).
    notches: [(s0, s1, side, depth)] cut `depth` off one side (side -1 left, +1 right) between s0 and s1. along: project along
    this direction instead of to the nearest point. crown: extra thickness at the strip's centre line (a raised spine).

    The strip of quads is projected onto the surface (smooth normals), stood off it by `off`, then extruded `thick` with a
    `ch` chamfer round the top rim. Writes into P (a Piece or Solid); returns the faces."""
    if n_across is None:  # columns across: enough to follow the surface's curve, no more
        wmax = max(width) if isinstance(width, (tuple, list)) else (0.2 if callable(width) else width)
        n_across = 2 if wmax <= 0.17 else 3 if wmax <= 0.24 else 4
    path = [Vector(p) for p in path]
    cum = [0.0]
    for a, b in zip(path, path[1:]):
        cum.append(cum[-1] + (b - a).length)
    L = cum[-1]
    if callable(width):
        wf = width
    elif isinstance(width, (tuple, list)):
        wf = lambda s: (width[0] + (width[1] - width[0]) * s,) * 2  # noqa: E731
    else:
        wf = lambda s: (width, width)  # noqa: E731

    def widths(s):
        wl, wr = wf(s)
        for s0, s1, side, depth in notches:
            if s0 <= s <= s1:
                if side < 0:
                    wl -= depth
                else:
                    wr -= depth
        return max(wl, ch * 2.2), max(wr, ch * 2.2)

    # rows (in s 0..1): the ends, the chamfer rows, even rows, and twin rows at every notch step
    cs = min(0.45, ch / max(L, 1e-4))
    rows = {0.0, cs, 1.0 - cs, 1.0}
    nr = max(2, int(math.ceil(L / row_len)))
    rows.update(cs + (1 - 2 * cs) * i / nr for i in range(1, nr))
    eps = 0.004 / max(L, 1e-4)
    for s0, s1, _, _ in notches:
        for sx in (s0, s1):
            rows.update((max(cs, sx - eps), min(1 - cs, sx + eps)))
    rows = sorted(rows)
    # the notch twin rows must take the outer width on their outer side
    rowspec = []
    for s in rows:
        wl, wr = widths(s)
        rowspec.append((s, wl, wr))
    R = len(rowspec)
    C = n_across + 3  # outer, chamfer, n_across - 1 interior, chamfer, outer
    surf_pts = []
    for i, (s, wl, wr) in enumerate(rowspec):
        row = []
        cols = [-wl, -wl + ch] + [-wl + ch + (wl + wr - 2 * ch) * k / n_across for k in range(1, n_across)] + [wr - ch, wr]
        for j, a in enumerate(cols):
            k0, k1 = skew
            sh = (k0 * (1 - s) + k1 * s) * a
            sm = s * L + sh
            c0 = _path_at(path, cum, sm)
            t = (_path_at(path, cum, sm + 0.02) - _path_at(path, cum, sm - 0.02)).normalized()
            pc, nc = surf.project(c0, along)
            t = (t - nc * t.dot(nc)).normalized()
            b = t.cross(nc).normalized()
            q, nq = surf.project(pc + b * a, along)
            outer = i in (0, R - 1) or j in (0, C - 1)
            mid = 1.0 - abs((j - (C - 1) / 2) / ((C - 1) / 2))
            h_top = off + (thick - ch if outer else thick + crown * mid)
            row.append((q + nq * off, q + nq * h_top))
        surf_pts.append(row)
    if info is not None:
        # outline of the plate's underside (closed, world space), its top rim, its centre line: for beads, bolts, ribs
        ring_ij = [(0, j) for j in range(C)] + [(i, C - 1) for i in range(1, R)] + \
                  [(R - 1, j) for j in range(C - 2, -1, -1)] + [(i, 0) for i in range(R - 2, 0, -1)]
        info["outline"] = [surf_pts[i][j][0] for i, j in ring_ij]
        info["rim"] = [surf_pts[i][j][1] for i, j in ring_ij]
        info["centre"] = [surf_pts[i][C // 2][1] for i in range(R)]
        info["grid"] = surf_pts
    bm = P.bm
    o = P.origin
    B = [[bm.verts.new(p[0] - o) for p in row] for row in surf_pts]
    T = [[bm.verts.new(p[1] - o) for p in row] for row in surf_pts]
    faces = []

    def quad(a, b, c, d):
        try:
            faces.append(bm.faces.new((a, b, c, d)))
        except ValueError:
            pass

    for i in range(R - 1):
        for j in range(C - 1):
            quad(T[i][j], T[i][j + 1], T[i + 1][j + 1], T[i + 1][j])
            quad(B[i][j], B[i + 1][j], B[i + 1][j + 1], B[i][j + 1])
    ring = [(0, j) for j in range(C)] + [(i, C - 1) for i in range(1, R)] + [(R - 1, j) for j in range(C - 2, -1, -1)] + \
           [(i, 0) for i in range(R - 2, 0, -1)]
    for k in range(len(ring)):
        (i0, j0), (i1, j1) = ring[k], ring[(k + 1) % len(ring)]
        quad(B[i0][j0], B[i1][j1], T[i1][j1], T[i0][j0])
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    si = V.sec_index(mat)
    tl = bm.faces.layers.int.get("hs_tag") or bm.faces.layers.int.new("hs_tag")
    for f in faces:
        f[P.sec] = si
        f[P.flag] = flag
        f[tl] = tag
        k = 1.0 + P.rng.uniform(-0.01, 0.01)
        for l in f.loops:
            l[P.col] = (min(1, col[0] * k), min(1, col[1] * k), min(1, col[2] * k), 1.0)
    return faces


# ---------------------------------------------------------------------------------------------------------- commit
def commit(S, P):
    """Copies a finished Solid (and its decor: beads, plates) into a part's Piece (sections, flags, colours, technique tags),
    relative to P.origin. Returns the face count copied."""
    n = _append(P, S)
    if S.decor is not None:
        n += _append(P, S.decor)
    return n


def _append(P, S):
    src = S.bm
    dst = P.bm
    tl = dst.faces.layers.int.get("hs_tag") or dst.faces.layers.int.new("hs_tag")
    vmap = {}
    o = P.origin
    for v in src.verts:
        vmap[v] = dst.verts.new(v.co - o)
    n = 0
    for f in src.faces:
        try:
            nf = dst.faces.new([vmap[v] for v in f.verts])
        except ValueError:
            continue
        nf[P.sec] = f[S.sec]
        nf[P.flag] = f[S.flag]
        nf[tl] = f[S.tag]
        for l0, l1 in zip(f.loops, nf.loops):
            l1[P.col] = l0[S.col]
        n += 1
    return n


def report():
    return {"stats": dict(STATS), "log": list(LOG)}


# ===================================================================================================== construction layers
# Keith 2026-10-22: a mech part is built inside out in layers. Each layer is its own mesh per part
# (<Part>__<Layer>), so the game can strip them in damage states (plates off -> ribs -> power and actuation -> frame).
LAYERS = ("frame", "actuation", "power", "mounting", "plates", "seals", "heat", "service", "sensors", "mods")
LAYER_TITLE = {k: k.capitalize() for k in LAYERS}
LAYER_ROLE = {
    "frame": "the mechanical shape: bones, joint drums, bearings, the pilot tub (dark)",
    "actuation": "servos, pistons, hydraulic pipes, tubes, cable looms (metallic, a little lighter than the frame)",
    "power": "muscle-like actuator bundles, power cells, conduit bundles, the torso core (close to the frame, dark)",
    "mounting": "the rib web and brackets the plates bolt to (light; seen in the gaps between plates)",
    "plates": "the paintable plate armour and cast shells (strip plates, boolean carving, welds)",
    "seals": "rubber boots, bellows and guard rings at the joints (soft, dark, matte)",
    "heat": "radiator fins, louvres, exhaust stacks, heat sinks (glow faces flagged for a later emissive)",
    "service": "handholds, rungs, lifting eyes, hatches, tie-downs, stencils and labels, sized to a 1.8 m pilot",
    "sensors": "lenses, lamps, antennas and the face (glow colour per family)",
    "mods": "field mods and wear: patch plates, replacement panels, salvaged plating, sandbags, slats, cargo, tarps",
}
# Default paint section per layer (vkit section names, so both study kits' material slots and Section codes work).
LAYER_SECTION = {"frame": "dark", "actuation": "trim", "power": "dark", "mounting": "sand", "plates": "primary",
                 "seals": "tyre", "heat": "dark", "service": "trim", "sensors": "glow", "mods": "cargo"}
MODS_LEVELS = ("none", "light", "heavy")  # faction clean, holdout farm, bandit
DAMAGE_ORDER = ("mods", "plates", "sensors", "service", "heat", "seals", "mounting", "power", "actuation", "frame")


def _mixc(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def layer_palette(dark, trim, primary, glow=(1.0, 0.7, 0.3), mounting=(0.70, 0.69, 0.65)):
    """Layer colours from a family's scheme, in Keith's value order: frame dark; actuation metallic and lighter; power close
    to the frame (a cool tint); mounting light; plates the paint; seals matte rubber; heat a touch darker than the frame;
    service bare metal; sensors the family glow; mods weathered salvage."""
    return {
        "frame": tuple(dark),
        "actuation": _mixc(dark, trim, 0.62),
        "power": (min(1, dark[0] * 1.05), min(1, dark[1] * 1.12), min(1, dark[2] * 1.3)),
        "mounting": tuple(mounting),
        "plates": tuple(primary),
        "seals": (0.105, 0.10, 0.095),
        "heat": (dark[0] * 0.85, dark[1] * 0.85, dark[2] * 0.85),
        "service": tuple(trim),
        "sensors": tuple(glow),
        "mods": (0.46, 0.40, 0.31),
    }


class Part:
    """One rigid mech part split into construction layers: part["frame"] is a vkit Piece (origin at the joint) named
    <name>__Frame; build into it with any primitive. pieces() lists the non-empty layer pieces in layer order and stamps a
    face int 'hs_layer'. Any layer name works (new layers can be added); LAYERS gives the order."""

    def __init__(self, name, origin, seed=0):
        self.name, self.origin, self.seed = name, Vector(origin), seed
        self.layers = {}

    def __getitem__(self, layer):
        if layer not in self.layers:
            P = V.Piece("%s__%s" % (self.name, LAYER_TITLE.get(layer, layer.capitalize())), self.origin,
                        self.seed * 31 + len(self.layers))
            P.layer = layer
            self.layers[layer] = P
        return self.layers[layer]

    def order(self):
        return list(LAYERS) + [k for k in self.layers if k not in LAYERS]

    def pieces(self, only=None):
        order = self.order()
        out = []
        for k in order:
            if only is not None and k not in only:
                continue
            P = self.layers.get(k)
            if P is not None and not P.empty():
                tl = P.bm.faces.layers.int.get("hs_layer") or P.bm.faces.layers.int.new("hs_layer")
                idx = order.index(k)
                for f in P.bm.faces:
                    f[tl] = idx
                out.append(P)
        return out

    def tris(self):
        return {k: tris(P) for k, P in self.layers.items() if not P.empty()}


def layer_of(name):
    """'Part_Thigh_L__Plates' -> 'plates' (None for a mesh with no layer suffix)."""
    if "__" not in name:
        return None
    return name.split("__")[-1].split(".")[0].lower()


# -------------------------------------------------------------------------------------------- layer helpers
def basis(axis):
    t = Vector(axis).normalized()
    u = t.orthogonal().normalized()
    return t, u, t.cross(u).normalized()


def bellows(P, a, b, r0, r1, folds=4, depth=0.04, n=14, mat="tyre", col=(0.105, 0.10, 0.095), squash=1.0, up=None):
    """A rubber bellows / boot from a to b: `folds` accordion folds `depth` deep, radius r0 -> r1. The folds are the slack
    that keeps the boot covering the joint through its bend range. squash < 1 flattens it along `up` (an oval boot)."""
    a, b = Vector(a), Vector(b)
    t = (b - a).normalized()
    if up is not None:
        w = Vector(up) - t * Vector(up).dot(t)
        w.normalize()
        u = w.cross(t).normalized()
    else:
        _, u, w = basis(t)
    rings = []
    K = folds * 2
    for i in range(K + 1):
        k = i / K
        r = r0 + (r1 - r0) * k - (depth if i % 2 else 0.0)
        c = a.lerp(b, k)
        rings.append([c + (u * math.cos(2 * math.pi * j / n) + w * math.sin(2 * math.pi * j / n) * squash) * r
                      for j in range(n)])
    return V.prim(P, rings, mat, col, 0, None, jitter=0.0)


def ring_tube(P, pts, r, mat, col, n=4):
    """A closed tube through pts (a rib hoop), square section by default."""
    pts = [Vector(p) for p in pts]
    N = len(pts)
    rings = []
    for i in range(N):
        tng = (pts[(i + 1) % N] - pts[i - 1]).normalized()
        _, u, w = basis(tng)
        rings.append([pts[i] + (u * math.cos(2 * math.pi * k / n + math.pi / 4) + w * math.sin(2 * math.pi * k / n + math.pi / 4)) * r
                      for k in range(n)])
    return V.prim(P, rings, mat, col, 0, None, jitter=0.0, closed=True)


def strut(P, a, b, w, h, mat, col, up=(0, 0, 1)):
    """A flat rib strut (rectangular section, w wide, h deep along `up`) from a to b: a stringer or a web diagonal."""
    a, b = Vector(a), Vector(b)
    t = (b - a)
    if t.length < 1e-4:
        return []
    t.normalize()
    upv = Vector(up)
    u = upv - t * upv.dot(t)
    if u.length < 1e-3:
        u = t.orthogonal()
    u.normalize()
    v = t.cross(u)
    ring = lambda c: [c + u * x + v * y for x, y in ((-h / 2, -w / 2), (h / 2, -w / 2), (h / 2, w / 2), (-h / 2, w / 2))]  # noqa: E731
    return V.prim(P, [ring(a), ring(b)], mat, col, 0, None, jitter=0.0)


def rib_web(P, hoops, mat="sand", col=(0.70, 0.69, 0.65), r=0.02, diag=True, every=1, closed=True, hoop_r=None):
    """The mounting layer's spider web: hoops (lists of points, same count, ordered along the part; closed or open arcs),
    stringers between matching points and (diag) crossing diagonals, so the plates have something to bolt to."""
    faces = []
    hr = hoop_r or r
    for h in hoops:
        if closed:
            faces += ring_tube(P, h, hr, mat, col)
        else:
            for p0, p1 in zip(h, h[1:]):
                c = sum(h, Vector()) / len(h)
                faces += strut(P, p0, p1, hr * 1.8, hr * 1.2, mat, col, up=((p0 + p1) / 2 - c))
    for h0, h1 in zip(hoops, hoops[1:]):
        n = len(h0)
        c0 = sum(h0, Vector()) / n
        rng = range(0, n, every) if closed else range(0, n, every)
        for j in rng:
            faces += strut(P, h0[j], h1[j], r * 1.6, r * 1.1, mat, col, up=(h0[j] - c0))
            if diag and j % 2 == 0:
                j2 = (j + 1) % n if closed else min(j + 1, n - 1)
                if j2 != j:
                    faces += strut(P, h0[j], h1[j2], r * 1.1, r * 0.8, mat, col, up=(h0[j] - c0))
    return faces


def standoffs(P, plate_info, surf, every=3, r=0.018, mat="sand", col=(0.70, 0.69, 0.65), bolts=None, bolt_col=(0.5, 0.49, 0.47),
              skip=()):
    """Brackets from a mass (surf) up to a strip plate's underside along its outline, with a foot washer; bolt heads go on
    the plate top into `bolts` (a Piece, e.g. the plates layer) so the plate visibly hangs on the mounting layer."""
    out = []
    ol, rim = plate_info["outline"], plate_info["rim"]
    cen = plate_info["centre"][len(plate_info["centre"]) // 2]
    for k in range(0, len(ol), every):
        if k in skip:
            continue
        top = ol[k]
        hit = surf.project(top)
        if hit is None:
            continue
        base, n = hit
        if (top - base).length < 0.006:
            continue
        inward = (cen - top)
        inward = (inward - n * inward.dot(n)).normalized() * 0.035
        out += V.bar(P, base - n * 0.01 + inward, top + inward, r, mat, col, 4)
        R = n.to_track_quat("Z", "Y").to_matrix().to_4x4()
        out += V.cyl(P, base + inward, r * 2.0, 0.025, axis="z", n=5, mat=mat, col=col, rot=R)
        if bolts is not None:
            rk = rim[k] + (cen - rim[k]).normalized() * 0.04
            V.bolt(bolts, rk, n, 0.017, 0.016, "trim", bolt_col)
    return out


def rungs(P, a, b, count, n, width=0.34, depth=0.11, r=0.017, mat="trim", col=(0.55, 0.54, 0.5)):
    """Boarding rungs from a (bottom) to b (top) on a surface with outward normal n: U-bars `width` wide standing `depth`
    out, spaced for a 1.8 m pilot (about 0.3 m apart)."""
    a, b, n = Vector(a), Vector(b), Vector(n).normalized()
    up = (b - a).normalized()
    side = up.cross(n).normalized()
    faces = []
    for i in range(count):
        c = a.lerp(b, i / max(1, count - 1))
        p0, p1 = c - side * width / 2, c + side * width / 2
        pts = [p0 - n * 0.02, p0 + n * depth, p1 + n * depth, p1 - n * 0.02]
        faces += V.tube_along(P, V.round_path(pts, 0.035), r, mat, col, n=6) or []
    return faces


def lifting_eye(P, c, n, r=0.06, t=0.018, mat="trim", col=(0.55, 0.54, 0.5)):
    """A lifting eye: a lug plate with a ring, standing on a surface (crane hook point)."""
    c, n = Vector(c), Vector(n).normalized()
    _, u, w = basis(n)
    pts = [c + n * (r * 0.9) + (u * math.cos(2 * math.pi * k / 8) + n * math.sin(2 * math.pi * k / 8)) * r for k in range(8)]
    f = ring_tube(P, pts, t, mat, col, n=6)
    f += V.prim(P, [[c + u * x + w * y for x, y in ((-r, -0.02), (r, -0.02), (r, 0.02), (-r, 0.02))],
                    [c + n * (r * 0.6) + u * x * 0.6 + w * y for x, y in ((-r, -0.02), (r, -0.02), (r, 0.02), (-r, 0.02))]],
                mat, col, 0, None, jitter=0.0)
    return f


def sandbag(P, c, size, yaw=0.0, col=(0.62, 0.55, 0.40), mat="cargo", up=(0, 0, 1)):
    """A sandbag: a squashed, lumpy loft lying on a surface whose normal is `up` (field mods)."""
    c = Vector(c)
    L, W, H = size
    upv = Vector(up).normalized()
    ref = Vector((math.cos(yaw), math.sin(yaw), 0))
    ax = (ref - upv * ref.dot(upv))
    if ax.length < 1e-3:
        ax = upv.orthogonal()
    ax.normalize()
    side = upv.cross(ax).normalized()
    rings = []
    for k, f in ((0.0, 0.5), (0.1, 0.9), (0.5, 1.0), (0.9, 0.9), (1.0, 0.5)):
        cc = c + ax * (k - 0.5) * L
        ring = []
        for j in range(10):
            ang = 2 * math.pi * j / 10
            x = math.copysign(abs(math.cos(ang)) ** 0.7, math.cos(ang)) * W / 2 * f
            z = math.copysign(abs(math.sin(ang)) ** 0.8, math.sin(ang)) * H / 2 * f
            ring.append(cc + side * x + upv * (z + H / 2))
        rings.append(ring)
    return V.prim(P, rings, mat, col, 0, None, jitter=0.03)


def slats(P, origin, u, v, n, w, h, count, standoff=0.12, r=0.016, mat="cargo", col=(0.30, 0.28, 0.25)):
    """Slat armour: `count` bars across a w x h frame standing `standoff` off a surface (frame centre at origin, u across,
    v up, n out)."""
    o, u, v, n = Vector(origin), Vector(u).normalized(), Vector(v).normalized(), Vector(n).normalized()
    faces = []
    c0 = o + n * standoff
    cs = [c0 - u * w / 2 - v * h / 2, c0 + u * w / 2 - v * h / 2, c0 + u * w / 2 + v * h / 2, c0 - u * w / 2 + v * h / 2]
    for k in range(4):
        faces += strut(P, cs[k], cs[(k + 1) % 4], r * 2.2, r * 1.4, mat, col, up=n)
        faces += V.bar(P, cs[k], cs[k] - n * standoff, r, mat, col, 5)
    for i in range(1, count):
        y = -h / 2 + h * i / count
        faces += strut(P, c0 - u * w / 2 + v * y, c0 + u * w / 2 + v * y, r * 1.5, r * 0.7, mat, col, up=n)
    return faces


def tarp(P, corners, sag=0.06, res=4, col=(0.42, 0.40, 0.30), mat="cargo", n=None, thick=0.012):
    """A tarp lashed over something: a sagging quad patch through four corners (thin slab)."""
    c = [Vector(p) for p in corners]
    nn = Vector(n) if n is not None else (c[1] - c[0]).cross(c[3] - c[0]).normalized()
    top, bot = [], []
    for i in range(res + 1):
        for j in range(res + 1):
            s, t = i / res, j / res
            p = (c[0] * (1 - s) + c[1] * s) * (1 - t) + (c[3] * (1 - s) + c[2] * s) * t
            p = p - nn * (sag * math.sin(math.pi * s) * math.sin(math.pi * t))
            top.append(p)
    bm, o = P.bm, P.origin
    A = [bm.verts.new(p - o) for p in top]
    B = [bm.verts.new(p - o - nn * thick) for p in top]
    faces = []
    idx = lambda i, j: i * (res + 1) + j  # noqa: E731
    for i in range(res):
        for j in range(res):
            q = [idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)]
            faces.append(bm.faces.new([A[k] for k in q]))
            faces.append(bm.faces.new([B[k] for k in reversed(q)]))
    ring = [idx(i, 0) for i in range(res + 1)] + [idx(res, j) for j in range(1, res + 1)] + \
           [idx(i, res) for i in range(res - 1, -1, -1)] + [idx(0, j) for j in range(res - 1, 0, -1)]
    for k in range(len(ring)):
        a, b = ring[k], ring[(k + 1) % len(ring)]
        faces.append(bm.faces.new([A[b], A[a], B[a], B[b]]))
    si = V.sec_index(mat)
    for f in faces:
        f[P.sec] = si
        f[P.flag] = 0
        for lp in f.loops:
            lp[P.col] = (col[0], col[1], col[2], 1.0)
    return faces


def glow_flag(faces, P):
    """Mark faces as glow (no bake): heat-sink faces that should light up later, lamp faces, lenses."""
    for f in faces:
        f[P.flag] = V.NOBAKE
    return faces


def ram(P, a, b, r, split=0.55, sleeve_col=(0.45, 0.44, 0.42), rod_col=(0.80, 0.79, 0.74), n=8, mat="trim"):
    """A lean hydraulic ram (about 100 tris): a chamfered sleeve from a, a bright rod to b, a gland collar and an eye at each
    end. For actuation where a full piston (500 tris) is too dear."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    if L < 1e-4:
        return []
    t = d / L
    _, u, w = basis(t)
    m = a + d * split

    def ring(c, rr):
        return [c + (u * math.cos(2 * math.pi * k / n) + w * math.sin(2 * math.pi * k / n)) * rr for k in range(n)]
    f = V.prim(P, [ring(a + t * 0.02, r * 0.8), ring(a + t * 0.05, r), ring(m - t * 0.03, r), ring(m, r * 0.85)], mat, sleeve_col, 0,
               None, jitter=0.0)
    f += V.prim(P, [ring(m - t * 0.01, r * 0.55), ring(b - t * 0.03, r * 0.55)], mat, rod_col, 0, None, jitter=0.0)
    f += V.prim(P, [ring(m, r * 1.08), ring(m + t * 0.035, r * 1.08)], mat, sleeve_col, 0, None, jitter=0.0)
    for e in (a, b):
        f += V.bar(P, e - w * r * 0.9, e + w * r * 0.9, r * 0.75, "dark", (0.16, 0.15, 0.15), 6)
    return f


# ================================================================================ profile massing (2026-10-22, skill trial)
# The mech-modeling skill's mass layer: closed prisms from 2D profiles, intersected (side ∩ front ∩ top gives a hull), every
# mass a function of an offset d so the plate, rib and frame shells are the same expression offset in or out.
def convex_offset(pts, d):
    """Offsets a convex 2D outline by d (outward > 0) as an intersection of shifted half-planes, so an inset larger than a
    short edge (a clipped corner) just drops that edge instead of folding the outline. Returns CCW (x, y) tuples."""
    P = [Vector((p[0], p[1])) for p in pts]
    n = len(P)
    area = sum(P[i].x * P[(i + 1) % n].y - P[(i + 1) % n].x * P[i].y for i in range(n))
    if area < 0:
        P.reverse()
    lines = []
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        e = b - a
        if e.length < 1e-9:
            continue
        nrm = Vector((e.y, -e.x)).normalized()   # outward for a CCW outline
        lines.append((a + nrm * d, nrm))
    big = 1e3
    poly = [Vector((-big, -big)), Vector((big, -big)), Vector((big, big)), Vector((-big, big))]
    for q, nrm in lines:
        out = []
        m = len(poly)
        for i in range(m):
            a, b = poly[i], poly[(i + 1) % m]
            da, db = (a - q).dot(nrm), (b - q).dot(nrm)
            if da <= 0:
                out.append(a)
            if (da < 0) != (db < 0) and abs(da - db) > 1e-12:
                out.append(a + (b - a) * (da / (da - db)))
        poly = out
        if len(poly) < 3:
            return []
    return [(p.x, p.y) for p in poly]


def prism(outline, axis, a0, a1, mat="primary", col=(0.5, 0.5, 0.5), name="prism", d=0.0, flag=0):
    """A closed prism: a convex 2D outline in the plane across `axis`, extruded from a0 to a1 along it.
    axis 'x': outline in (y, z); 'y': outline in (x, z); 'z': outline in (x, y). d offsets the outline (convex_offset) and
    the two caps (a0 - d, a1 + d), so prism(..., d) is the same mass grown or shrunk by d."""
    o = convex_offset(outline, d) if d else list(outline)
    S = Solid(name)
    if len(o) < 3 or a1 + d <= a0 - d:
        return S
    rings = []
    for t in (a0 - d, a1 + d):
        if axis == "x":
            rings.append([Vector((t, u, v)) for u, v in o])
        elif axis == "y":
            rings.append([Vector((u, t, v)) for u, v in o])
        else:
            rings.append([Vector((u, v, t)) for u, v in o])
    V.prim(S, rings, mat, col, flag, None, jitter=0.0)
    return S


def xform(S, M):
    """Transforms a Solid (and its decor) in place by a 4x4 matrix; normals are recalculated (a mirror flips them)."""
    bmesh.ops.transform(S.bm, matrix=M, verts=S.bm.verts[:])
    bmesh.ops.recalc_face_normals(S.bm, faces=S.bm.faces[:])
    if S.decor is not None:
        xform(S.decor, M)
    return S


def intersect(solids, name="intersect", fillet=0.0, segments=1, profile=0.5, dissolve=1.0, rim_tag=TAG_RIM):
    """Boolean intersection: the volume common to every solid (the side ∩ front ∩ top profile trick, or a shell trimmed to
    a panel region). The rim edges (where faces from different operands meet) are bevelled by `fillet` (segments 1 = a
    flat chamfer: the plate edge that catches the light). Same fallbacks and checks as fuse()."""
    solids = [s for s in solids if s is not None and len(s.bm.faces)]
    if not solids:
        return Solid(name)
    for s in solids:
        s.tag_untagged()
        heal(s, s.name)
        s.set_op(_fresh_op())
    vols = [volume(s.bm) for s in solids]
    if len(solids) == 1:
        out = solids[0].copy(name)
        clean(out, dissolve)
        return out
    target, rest = solids[0], solids[1:]
    res, how = None, ""
    for solver, tol in (("EXACT", False), ("EXACT", True), ("FAST", False)):
        bm = target.bm.copy()
        ok = True
        for r in rest:  # pairwise, one operand at a time: the result is the volume common to all of them
            nb = _boolean(bm, [r.bm], "INTERSECT", solver, tol)
            bm.free()
            if nb is None:
                ok = False
                break
            bm = nb
        cand = bm if ok else None
        if cand is None:
            continue
        v, nm = volume(cand), nonmanifold(cand)
        if len(cand.faces) and nm == 0 and 1e-7 < v <= min(vols) * 1.03:
            res, how = cand, solver + (" hole-tolerant" if tol else "")
            break
        log("intersect %s: %s%s rejected (volume %.4f, max %.4f, non-manifold %d)" %
            (name, solver, " hole-tolerant" if tol else "", v, min(vols), nm))
        cand.free()
    out = Solid(name, solids[0].seed)
    if res is None:
        STATS["fallbacks"] += 1
        STATS["skipped_cutters"] += 1
        log("intersect %s: every solver failed; result empty" % name)
        return out
    if how == "EXACT":
        STATS["exact_ok"] += 1
    else:
        STATS["fallbacks"] += 1
        log("intersect %s: used %s" % (name, how))
    out.rebind(res)
    clean(out, dissolve)
    rim = [e for e in out.bm.edges if len(e.link_faces) == 2 and e.link_faces[0][out.op] != e.link_faces[1][out.op]]
    out.rims = _chains(rim)
    _bevel(out, rim, fillet, segments, profile, tag=rim_tag)
    return out


def section_loop(S, co, no, n=12):
    """The closed outline where the plane (co, no) cuts a Solid, resampled to n points evenly by arc length: a rib hoop
    that follows the inside of the plates (the mounting layer). Returns [] if the plane misses."""
    bm = S.bm.copy()
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=Vector(co), plane_no=Vector(no))
    cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    chains = _chains(cut)
    bm.free()
    if not chains:
        return []
    ch = max(chains, key=lambda c: sum((b - a).length for a, b in zip(c, c[1:])))
    if (ch[0] - ch[-1]).length > 1e-5:
        ch = ch + [ch[0]]
    L = [0.0]
    for a, b in zip(ch, ch[1:]):
        L.append(L[-1] + (b - a).length)
    out = []
    for k in range(n):
        s = L[-1] * k / n
        i = max(1, next((j for j in range(1, len(L)) if L[j] >= s), len(L) - 1))
        t = (s - L[i - 1]) / max(1e-9, L[i] - L[i - 1])
        out.append(ch[i - 1].lerp(ch[i], t))
    return out


# ------------------------------------------------------------------------------------------- v3 additions (2026-10-22)
def loft(stations, axis, d=0.0, mat="primary", col=(0.5, 0.5, 0.5), name="loft", flag=0):
    """A mass through section stations: stations = [(t, convex 2D outline), ...] along `axis` ('x' outline (y, z), 'y' (x, z),
    'z' (x, y)), ordered by t. The solid is the convex hull of every station, so it bulges and tapers between them (a barrel
    thigh, a pod) where three intersected prisms can only make straight walls. d grows it like prism(..., d): every outline
    is convex_offset by d and the two end stations move d outward along the axis, so loft(..., d) is mass(d)."""
    st = sorted(stations, key=lambda s: s[0])
    S = Solid(name)
    pts = []
    for i, (t, o) in enumerate(st):
        oo = convex_offset(o, d) if d else list(o)
        if len(oo) < 3:
            continue
        tt = t - d if i == 0 else (t + d if i == len(st) - 1 else t)
        for u, v in oo:
            pts.append(Vector((tt, u, v)) if axis == "x" else (Vector((u, tt, v)) if axis == "y" else Vector((u, v, tt))))
    if len(pts) < 4:
        return S
    bm = S.bm
    vs = [bm.verts.new(p) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=vs)
    drop = [v for v in res.get("geom_interior", []) if isinstance(v, bmesh.types.BMVert)]
    drop += [v for v in res.get("geom_unused", []) if isinstance(v, bmesh.types.BMVert)]
    if drop:
        bmesh.ops.delete(bm, geom=list(set(drop)), context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts[:], edges=bm.edges[:])
    si = V.sec_index(mat)
    for f in bm.faces:
        f[S.sec] = si
        f[S.flag] = flag
        for lp in f.loops:
            lp[S.col] = (*col, 1.0)
    return S


def flange_web(P, hoops, depth=0.10, width=0.035, mat="sand", col=(0.70, 0.69, 0.65), stringers=(0,), s_depth=None,
               s_width=None, closed=True):
    """The mounting layer as big readable ribs (Keith 2026-10-22: deep and few, wide flanges, read at 40 m in plate gaps):
    each hoop becomes a flat flange `depth` deep (pointing at the hoop's centre) and `width` thick; stringers join matching
    points of neighbouring hoops at the listed indices. No diagonals."""
    faces = []
    for h in hoops:
        c = sum(h, Vector()) / len(h)
        segs = list(zip(h, h[1:] + ([h[0]] if closed else [])))
        for p0, p1 in segs:
            m = (p0 + p1) / 2
            inward = (c - m)
            if inward.length < 1e-6:
                continue
            inward.normalize()
            faces += strut(P, p0 + inward * depth / 2, p1 + inward * depth / 2, width, depth, mat, col, up=inward)
    sd, sw = s_depth or depth * 0.8, s_width or width
    for h0, h1 in zip(hoops, hoops[1:]):
        c0 = sum(h0, Vector()) / len(h0)
        for j in stringers:
            if j >= len(h0) or j >= len(h1):
                continue
            inward = (c0 - h0[j]).normalized()
            faces += strut(P, h0[j] + inward * sd / 2, h1[j] + inward * sd / 2, sw, sd, mat, col, up=inward)
    return faces


def pipe_bundle(P, pts, side, count=3, r=0.022, gap=0.012, mat="trim", cols=((0.40, 0.40, 0.38),), bend=0.12, clamp_every=0.35,
                clamp_col=(0.30, 0.29, 0.27)):
    """Several parallel pipes along one route (offset along `side`), with flat clamp straps every `clamp_every` metres: the
    plumbing that runs between and under plates (Keith 2026-10-22). Gauges step down across the bundle."""
    side = Vector(side).normalized()
    path0 = V.round_path([Vector(p) for p in pts], bend)
    faces = []
    for k in range(count):
        rr = r * (1.0 - 0.18 * k)
        off = side * ((k - (count - 1) / 2) * (2 * r + gap))
        V.tube_along(P, [p + off for p in path0], rr, mat, cols[k % len(cols)], n=6)
    L = [0.0]
    for a, b in zip(path0, path0[1:]):
        L.append(L[-1] + (b - a).length)
    if clamp_every and L[-1] > clamp_every:
        n = int(L[-1] / clamp_every)
        for i in range(1, n + 1):
            s = L[-1] * i / (n + 1)
            j = max(1, next((q for q in range(1, len(L)) if L[q] >= s), len(L) - 1))
            t = (s - L[j - 1]) / max(1e-9, L[j] - L[j - 1])
            p = path0[j - 1].lerp(path0[j], t)
            tan = (path0[j] - path0[j - 1]).normalized()
            w = count * (2 * r + gap) + 0.02
            faces += strut(P, p - side * w / 2, p + side * w / 2, 0.035, 2 * r + 0.025, mat, clamp_col, up=side.cross(tan))
    return faces


def addon_bricks(P, c, u, v, n, cols, rows, size=(0.16, 0.12), t=0.05, gap=0.02, mat="primary", col=(0.5, 0.5, 0.5),
                 bolt_col=None):
    """Reactive-armour bricks (a purposeful rectilinear add-on): a cols x rows grid of chamfered boxes on a surface at c, its
    plane (u, v), outward n. Tag the result TAG_ADDON (see tag_faces) so the axis-aligned plate check skips them."""
    u, v, n = Vector(u).normalized(), Vector(v).normalized(), Vector(n).normalized()
    faces = []
    w, h = size
    for i in range(cols):
        for j in range(rows):
            p = Vector(c) + u * ((i - (cols - 1) / 2) * (w + gap)) + v * ((j - (rows - 1) / 2) * (h + gap))
            faces += V.surf_blk(P, p, u, v, n, w, h, t, mat, col, ch=min(0.015, t * 0.3)) or []
            if bolt_col:
                V.bolt(P, p + n * t, n, 0.012, 0.012, "trim", bolt_col)
    return faces


def tag_faces(S, faces, tag):
    for f in faces:
        if f.is_valid:
            f[S.tag] = tag
    return faces


def axis_aligned_share(objs, layer="plates", deg=3.0, skip_tags=(TAG_ADDON,)):
    """Per object of the given layer: the share of face area whose world normal lies within `deg` of +-X, +-Y or +-Z (faces
    tagged in skip_tags left out). Returns {part: (share, area)}: the skill's step-8 check for rectilinear plates."""
    cos_t = math.cos(math.radians(deg))
    out = {}
    for o in objs:
        if layer_of(o.name) != layer:
            continue
        part = o.name.split("__")[0]
        me = o.data
        tags = me.attributes.get("hs_tag")
        M3 = o.matrix_world.to_3x3()
        a_all = a_ax = 0.0
        for poly in me.polygons:
            if tags is not None and tags.data[poly.index].value in skip_tags:
                continue
            nn = (M3 @ poly.normal).normalized()
            a = poly.area
            a_all += a
            if max(abs(nn.x), abs(nn.y), abs(nn.z)) >= cos_t:
                a_ax += a
        s, A = out.get(part, (0.0, 0.0))
        out[part] = ((s * A + a_ax) / max(1e-9, A + a_all), A + a_all)
    return out


# ------------------------------------------------------------------------------------- 7. flow regions, stance solve (v4)
def frame_matrix(origin, u, v, n):
    """A 4x4 from a surface frame: local x = u, y = v, z = n (orthonormalised, v kept in the plane across n)."""
    from mathutils import Matrix
    n = Vector(n).normalized()
    v = (Vector(v) - n * Vector(v).dot(n)).normalized()
    u2 = v.cross(n).normalized()
    if u2.dot(Vector(u)) < 0:
        u2 = -u2     # u and v both as asked (a mirrored frame; xform recalculates the normals)
    o = Vector(origin)
    return Matrix(((u2.x, v.x, n.x, o.x), (u2.y, v.y, n.y, o.y), (u2.z, v.z, n.z, o.z), (0, 0, 0, 1)))


def flow_region(outline, origin, u, v, n, a0=-0.5, a1=0.5, mat="primary", col=(0.5, 0.5, 0.5), flag=0, name="region"):
    """A panel region drawn on a surface, not on a world axis (skill f0: seams follow the flow). `outline` is a 2D polygon in
    the surface frame (u along the form, v across it), extruded along the surface normal n from a0 to a1. Concave outlines
    are fine (an arch, a chevron edge): prism uses a raw outline when it is not offset. Intersect a shell with it."""
    S = prism(list(outline), "z", a0, a1, mat, col, name, 0.0, flag)
    return xform(S, frame_matrix(origin, u, v, n))


def offset_polyline(pts, d):
    """A 2D polyline moved sideways by d (left of the walking direction positive), corners mitred: the far edge of a seam,
    so the next panel's outline follows this one's edge at a constant gap."""
    out = []
    P = [Vector((p[0], p[1])) for p in pts]
    for i, p in enumerate(P):
        ts = []
        if i > 0:
            ts.append((p - P[i - 1]).normalized())
        if i < len(P) - 1:
            ts.append((P[i + 1] - p).normalized())
        t = (ts[0] + ts[-1]).normalized() if len(ts) > 1 else ts[0]
        nrm = Vector((-t.y, t.x))
        k = 1.0
        if len(ts) > 1:
            k = 1.0 / max(0.4, nrm.dot(Vector((-ts[0].y, ts[0].x))))
        out.append((p.x + nrm.x * d * k, p.y + nrm.y * d * k))
    return out


def solve(residual, x0, iters=30, h=1e-4, tol=1e-6, damp=1e-6):
    """Damped Gauss-Newton on residual(x) -> list (finite differences): the stance's leg chains (pick joint angles that put an
    ankle on its target with the foot flat). Returns (x, |residual|)."""
    x = list(x0)
    from mathutils import Matrix  # noqa: F401
    for _ in range(iters):
        r = residual(x)
        err = math.sqrt(sum(e * e for e in r))
        if err < tol:
            break
        J = []
        for j in range(len(x)):
            xp = list(x)
            xp[j] += h
            rp = residual(xp)
            J.append([(a - b) / h for a, b in zip(rp, r)])        # J[j][i] = d r_i / d x_j
        n = len(x)
        A = [[sum(J[a][i] * J[b][i] for i in range(len(r))) + (damp if a == b else 0.0) for b in range(n)] for a in range(n)]
        g = [sum(J[a][i] * r[i] for i in range(len(r))) for a in range(n)]
        dx = _lin_solve(A, [-v for v in g])
        x = [a + b for a, b in zip(x, dx)]
    r = residual(x)
    return x, math.sqrt(sum(e * e for e in r))


def _lin_solve(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        if abs(M[c][c]) < 1e-12:
            continue
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                M[r] = [a - f * b2 for a, b2 in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] if abs(M[i][i]) > 1e-12 else 0.0 for i in range(n)]


def leg_line(hip, knee, ankle, side):
    """The knock-knee check (skill 6b): how far the knee sits outboard of the straight hip -> ankle line, in metres at the
    knee's height, seen from the front (x, z). Positive = outboard (straight to slightly open legs), negative = knock-kneed.
    side: +1 for a leg on +X, -1 on -X."""
    h, k, a = Vector(hip), Vector(knee), Vector(ankle)
    t = (h.z - k.z) / max(1e-6, h.z - a.z)
    x_line = h.x + (a.x - h.x) * t
    return (k.x - x_line) * side
