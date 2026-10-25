"""Fixed orthographic turnarounds of a reference model at the game height, for the mass gate: textured (t_), grey (g_) or a
black mask (m_). The cameras match `studies/rampart/shots.py`'s `match_*` / `massmatch_*` shots (ortho 6.4 m, 7.5 m for
the three-quarter views, 1000 px, target (0, 0, 2.6)), plus the game camera at 40 m.

    blender -b --factory-startup -P tools/blender/mechs/ref/turn.py -- <ref.fbx> <outdir> [grey|mask] [--height 5.2]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import refcommon as R  # noqa: E402

VIEWS = {"front": (0, -30, 2.6), "back": (0, 30, 2.6), "left": (30, 0, 2.6), "right": (-30, 0, 2.6), "q34": (-16, -22, 9),
         "top": (0, -0.001, 40), "rear34": (16, 20, 8)}


def main():
    a = R.args()
    fbx, out = a[0], a[1]
    mode = a[2] if len(a) > 2 and a[2] in ("grey", "mask") else "tex"
    height = float(a[a.index("--height") + 1]) if "--height" in a else 5.2
    if mode == "tex":      # keep the model's own materials
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=fbx)
        obs = [o for o in bpy.data.objects if o.type == "MESH"]
        top = max((o.matrix_world @ v.co).z for o in obs for v in o.data.vertices)
        for o in bpy.data.objects:
            if o.parent is None:
                o.matrix_world = __import__("mathutils").Matrix.Scale(height / top, 4) @ o.matrix_world
    else:
        bm, _ = R.load_scaled_bmesh(fbx, height)
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        me = bpy.data.meshes.new("ref")
        bm.to_mesh(me)
        o = bpy.data.objects.new("ref", me)
        bpy.context.scene.collection.objects.link(o)
    sc = bpy.context.scene
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value, bg.inputs[1].default_value = (0.85, 0.83, 0.80, 1), 0.6
    if mode != "tex":
        m = bpy.data.materials.new("g")
        m.use_nodes = True
        nt = m.node_tree
        if mode == "mask":
            nt.nodes.remove(nt.nodes["Principled BSDF"])
            e = nt.nodes.new("ShaderNodeEmission")
            e.inputs[0].default_value = (0, 0, 0, 1)
            nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs[0])
            bg.inputs[0].default_value, bg.inputs[1].default_value = (1, 1, 1, 1), 1.0
            sc.view_settings.view_transform = "Standard"
        else:
            b = nt.nodes["Principled BSDF"]
            b.inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1)
            b.inputs["Roughness"].default_value = 0.8
        o.data.materials.append(m)
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x = sc.render.resolution_y = 1000
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sc.collection.objects.link(sun)
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    pre = {"tex": "t_", "grey": "g_", "mask": "m_"}[mode]
    for k, p in VIEWS.items():
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 7.5 if k in ("q34", "rear34") else 6.4
        cam.location = Vector(p)
        t = Vector((0, 0, 0)) if k == "top" else Vector((0, 0, 2.6))
        cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(out, pre + k + ".png")
        bpy.ops.render.render(write_still=True)
    cam.data.type, cam.data.lens, cam.data.sensor_width = "PERSP", 24, 36
    pp, t = math.radians(50), Vector((0, 0, 1.6))
    cam.location = t + Vector((0, -40 * math.cos(pp), 40 * math.sin(pp)))
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.render.filepath = os.path.join(out, pre + "game40.png")
    bpy.ops.render.render(write_still=True)


main()
