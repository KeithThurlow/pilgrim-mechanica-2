"""Shared helpers for the reference toolkit: import a reference model headless and scale it to the game height.

Reference models (Tripo3D exports and the like) never enter the repo; pass their path on the command line."""
import bmesh
import bpy
from mathutils import Matrix


def args():
    import sys
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def load_scaled_bmesh(fbx, height=5.2):
    """Imports `fbx` into an empty scene and returns (bmesh in world space scaled so its top sits at `height`, scale).
    The model's own z 0 is the ground (Tripo exports stand on it); the scale is height / top z."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=fbx)
    obs = [o for o in bpy.data.objects if o.type == "MESH"]
    bm = bmesh.new()
    for o in obs:
        b = bmesh.new()
        b.from_mesh(o.data)
        b.transform(o.matrix_world)
        me = bpy.data.meshes.new("tmp")
        b.to_mesh(me)
        b.free()
        bm.from_mesh(me)
    s = height / max(v.co.z for v in bm.verts)
    bm.transform(Matrix.Scale(s, 4))
    return bm, s
