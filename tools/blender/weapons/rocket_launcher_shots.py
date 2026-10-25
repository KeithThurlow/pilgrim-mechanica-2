"""Check shots for W1 (docs/asset-list.md): the rocket launchers alone and on the Rampart from the game camera.

    node tools/blender/run.mjs tools/blender/weapons/rocket_launcher_shots.py -- [--out DIR]

Reads the exported GLBs (public/models/weapons/) and public/models/rampart.glb, so it shows what the game loads. The
hull launcher goes on the right shoulder (the Rampart's minigun arm hidden), the minigun pod is mirrored onto the left
as the game does, and the shoulder launcher sits on the hull's left top. Game camera: 50 deg down, 40 m away, a 40 deg
vertical field of view, 1280 x 720; also the closest zoom (45 deg at 12 m). Writes docs/asset-shots/W1/*.jpg (JPEG to
keep the repo light).
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
MODELS = os.path.join(REPO, "public", "models")
SAND = (0.80, 0.66, 0.46)


def srgb_lin(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def load(path, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    holder = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(holder)
    for r in roots:
        r.parent = holder
    return holder, new


def vc_material(name, emissive=None):
    m = bpy.data.materials.new("shot_" + name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.55
    a = nt.nodes.new("ShaderNodeVertexColor")
    nt.links.new(a.outputs["Color"], b.inputs["Base Color"])
    if emissive:
        b.inputs["Emission Color"].default_value = (*emissive, 1)
        b.inputs["Emission Strength"].default_value = 3.0
    return m


def shade(objs):
    """Vertex colour materials (the game multiplies paint by COLOR_0 the same way); lamps emissive."""
    plain = vc_material("plain")
    lamp = vc_material("lamp", srgb_lin((1.0, 0.29, 0.14)))
    for o in objs:
        if o.type != "MESH":
            continue
        for i, m in enumerate(o.data.materials):
            o.data.materials[i] = lamp if m and m.name.startswith("Paint_lighting") else plain


def scene_setup():
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = 32
    try:
        sc.view_settings.view_transform = "Khronos PBR Neutral"
    except TypeError:
        sc.view_settings.view_transform = "Standard"
    sc.world = bpy.data.worlds.new("sky")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (*srgb_lin((0.62, 0.74, 0.90)), 1)
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.0
    sun.angle = math.radians(2)
    so = bpy.data.objects.new("sun", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(35), 0, math.radians(150))  # high midday sun from behind the camera's left
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
    g = bpy.context.active_object
    gm = bpy.data.materials.new("sand")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb_lin(SAND), 1)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    g.data.materials.append(gm)
    return sc


def camera(sc, target, dist, down_deg, yaw_deg, fov_deg=40.0, res=(1280, 720)):
    """A camera dist from target, down_deg below the horizontal, looking from yaw_deg (0 = from +Y, behind a mech
    facing -Y)."""
    cam = sc.camera
    if cam is None:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
        sc.camera = cam
    d, y = math.radians(down_deg), math.radians(yaw_deg)
    off = Vector((math.sin(y) * math.cos(d), math.cos(y) * math.cos(d), math.sin(d))) * dist
    cam.location = Vector(target) + off
    cam.rotation_euler = (-off).to_track_quat("-Z", "Y").to_euler()
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(fov_deg)
    cam.data.clip_end = 1000
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100


def render(sc, path):
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("W1 shot", path)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "docs", "asset-shots", "W1"))
    a = ap.parse_args(argv)
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = scene_setup()

    # ---- the models alone, on a plinth height so the sand doesn't cut them
    hull, hull_objs = load(os.path.join(MODELS, "weapons", "rocket-launcher-hull.glb"), "hull")
    sh, sh_objs = load(os.path.join(MODELS, "weapons", "rocket-launcher-shoulder.glb"), "shoulder")
    rk, rk_objs = load(os.path.join(MODELS, "weapons", "rocket.glb"), "rocket")
    shade(hull_objs + sh_objs + rk_objs)
    hull.location = (0, 0, 1.2)
    sh.location = (-2.6, 0, 0.0)
    rk.location = (2.2, 0, 0.4)
    rk.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    for name, tgt, dist, down, yaw in (("hull_34front", (0.9, -0.3, 0.9), 4.2, 18, 215),
                                       ("hull_side", (0.9, -0.3, 0.9), 4.2, 4, 270),
                                       ("hull_back34", (0.9, -0.3, 0.9), 4.2, 25, 35),
                                       ("shoulder_34front", (-2.6, -0.3, 0.45), 3.6, 18, 215),
                                       ("shoulder_side", (-2.6, -0.3, 0.45), 3.6, 4, 90),
                                       ("rocket_side", (2.2, -0.55, 0.4), 1.8, 10, 250)):
        camera(sc, tgt, dist, down, yaw, fov_deg=40, res=(1280, 720))
        render(sc, os.path.join(out, name + ".jpg"))
    for h in (hull, sh, rk):
        h.location = (0, 0, -100)  # out of the way

    # ---- on the Rampart
    mech, mech_objs = load(os.path.join(MODELS, "rampart.glb"), "rampart")
    for o in mech_objs:
        if o.type == "MESH":
            if not o.data.color_attributes:
                continue
            m = vc_material("rampart")
            o.data.materials.clear()
            o.data.materials.append(m)
    by = {o.name: o for o in mech_objs}
    bpy.context.view_layer.update()
    sr = by["UpperArm_R"].matrix_world.translation.copy()
    sl = by["UpperArm_L"].matrix_world.translation.copy()
    print("W1 shoulders", tuple(round(c, 3) for c in sr), tuple(round(c, 3) for c in sl))
    pods = [o for o in mech_objs if o.type == "MESH" and ("Pod" in o.name)]
    # the left arm: a mirrored copy of the right minigun pod (the game's own trick); the right: the launcher
    M = Matrix.Scale(-1, 4, (1, 0, 0))
    for o in pods:
        if o.name.endswith("_R") or "_R." in o.name or "Spin_R" in o.name:
            c = o.copy()
            c.data = o.data.copy()
            sc.collection.objects.link(c)
            c.parent = None
            c.matrix_world = M @ o.matrix_world
            o.hide_render = True
        elif o.name.endswith("_L"):
            o.hide_render = True
    hull.location = sr
    torso = by.get("Part_Torso")
    top = max((torso.matrix_world @ Vector(c)).z for c in torso.bound_box) if torso else sl.z + 0.3
    sh.location = (sl.x * 0.45, sl.y + 0.15, top - 0.05)
    bpy.context.view_layer.update()
    tgt = (0, 0, 3.2)
    for name, dist, down, yaw in (("game40_behind", 40, 50, 0), ("game40_34front", 40, 50, 145),
                                  ("game12_behind", 12, 45, 20), ("game12_34front", 12, 45, 150)):
        camera(sc, tgt, dist, down, yaw)
        render(sc, os.path.join(out, name + ".jpg"))


if __name__ == "__main__":
    main()
