"""Renders for the Rampart-reference study (mech-modeling skill trial, 2026-10-22). Toon look of the military study:
flat paint x two bands, a cream edge highlight on faces turned at the sun (the chamfers), sepia silhouette ink, interior creases
darkening the face colour (never black).

    blender -b --factory-startup -P tools/blender/mechs/studies/rampart/shots.py -- --out <ABS DIR> [--only a,b] [--mass]

Shots: mass_game40, mass_ref, ref, game40, zoom10, plates_close, back34, layers_exploded, layer_map, technique_map;
v4: front_legs / front_legs_stance (knock-knee check, hip-ankle guide lines), compare_v3, mass_vs_final, chest_close,
legtech_close, feet_front, feet_q34.
The reference side-by-side is composed separately into the scratchpad (never committed).
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
MECHS = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, MECHS)
sys.path.insert(0, os.path.join(MECHS, "studies", "military"))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hskit as H  # noqa: E402
import mil_kit as K  # noqa: E402
import importlib  # noqa: E402

import rampart as HD  # noqa: E402  (replaced by --model)

INK = {"mode": "sepia"}     # --ink: sepia (v1: thick dark-brown silhouette), thin (lighter, 1 px), face (the face colour darkened)

# ---------------------------------------------------------------- copied from studies/military/render_military.py (toon look)
SEPIA = (0.298, 0.196, 0.180)
PAPER = (0.925, 0.89, 0.87)
SAND = (0.80, 0.68, 0.50)
LIGHT_TO = Vector((-0.5, -0.62, 0.62)).normalized()   # towards the sun: upper left front as seen from the hero camera


def srgb2lin(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def toon(name="Toon", ink=1.0, ground=False):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    n, L = nt.nodes, nt.links.new
    d = n.new("ShaderNodeBsdfDiffuse")
    d.inputs[0].default_value = (1, 1, 1, 1)
    s2 = n.new("ShaderNodeShaderToRGB")
    bw = n.new("ShaderNodeRGBToBW")
    L(d.outputs[0], s2.inputs[0])
    L(s2.outputs[0], bw.inputs[0])
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    el = ramp.color_ramp.elements
    if ground:
        el[0].position, el[0].color = 0.0, (0.74, 0.71, 0.74, 1)
        el[1].position, el[1].color = 0.3, (1, 1, 1, 1)
    else:
        el[0].position, el[0].color = 0.0, (0.80, 0.78, 0.80, 1)    # shadow: a warm multiply, same hue
        el[1].position, el[1].color = 0.16, (1, 1, 1, 1)            # lit
    L(bw.outputs[0], ramp.inputs[0])
    va = n.new("ShaderNodeVertexColor")
    va.layer_name = "Color"
    mul = n.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    L(va.outputs[0], mul.inputs[6])
    L(ramp.outputs[0], mul.inputs[7])
    last = mul.outputs[2]
    if not ground:
        # cream edge highlight: faces turned almost straight at the sun (chamfers, rims), a hard step
        hi = n.new("ShaderNodeMath")
        hi.operation = "GREATER_THAN"
        hi.inputs[1].default_value = 0.93
        L(bw.outputs[0], hi.inputs[0])
        sc = n.new("ShaderNodeMath")
        sc.operation = "MULTIPLY"
        sc.inputs[1].default_value = 0.5
        L(hi.outputs[0], sc.inputs[0])
        mx = n.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.inputs[7].default_value = (*srgb2lin((0.745, 0.66, 0.573)), 1)   # #bea892
        L(sc.outputs[0], mx.inputs[0])
        L(last, mx.inputs[6])
        last = mx.outputs[2]
    em = n.new("ShaderNodeEmission")
    L(last, em.inputs[0])
    out = n.new("ShaderNodeOutputMaterial")
    L(em.outputs[0], out.inputs[0])
    aov = n.new("ShaderNodeOutputAOV")
    aov.aov_name = "ink"
    aov.inputs["Value"].default_value = ink
    return m


def scene(w, h, bg=PAPER, dil=1, crease=0.55):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights):
        for x in list(coll):
            coll.remove(x)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.eevee.taa_render_samples = 16
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.0
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sc.collection.objects.link(sun)
    sun.data.energy = math.pi
    sun.data.angle = math.radians(1.0)
    sun.rotation_euler = (-LIGHT_TO).to_track_quat("-Z", "Y").to_euler()
    vl = sc.view_layers[0]
    vl.use_pass_normal = True
    vl.use_pass_z = True
    if "ink" not in [a.name for a in vl.aovs]:
        a = vl.aovs.add()
        a.name = "ink"
        a.type = "VALUE"
    compositor(sc, bg, dil, crease)
    return sc


def compositor(sc, bg, dil=1, crease=0.55):
    sc.use_nodes = True
    nt = sc.node_tree
    nt.nodes.clear()
    n, L = nt.nodes, nt.links.new
    rl = n.new("CompositorNodeRLayers")

    def node(kind, **kw):
        x = n.new(kind)
        for k, v in kw.items():
            setattr(x, k, v)
        return x

    def math_(op, a, b=None, bv=None):
        m = node("CompositorNodeMath", operation=op)
        L(a, m.inputs[0])
        if b is not None:
            L(b, m.inputs[1])
        elif bv is not None:
            m.inputs[1].default_value = bv
        return m.outputs[0]

    def sobel(src):
        f = node("CompositorNodeFilter", filter_type="SOBEL")
        L(src, f.inputs[1])
        b = node("CompositorNodeRGBToBW")
        L(f.outputs[0], b.inputs[0])
        return b.outputs[0]

    mask = rl.outputs["ink"]
    # silhouette: the unit mask's edge (both sides) plus depth breaks inside the unit (an arm in front of the body)
    sil_m = math_("GREATER_THAN", sobel(mask), bv=0.25)
    dz = math_("DIVIDE", sobel(rl.outputs["Depth"]), rl.outputs["Depth"])
    sil_d = math_("MULTIPLY", math_("GREATER_THAN", dz, bv=0.09), mask)
    sil = math_("MAXIMUM", sil_m, sil_d)
    if INK["mode"] != "sepia":
        dil = 0
    if dil:
        dn = node("CompositorNodeDilateErode", mode="STEP", distance=dil)
        L(sil, dn.inputs[0])
        sil = dn.outputs[0]
    # creases: normal breaks inside the unit, not where the silhouette already is
    cr = math_("GREATER_THAN", sobel(rl.outputs["Normal"]), bv=crease)
    cr = math_("MULTIPLY", cr, mask)
    cr = math_("MULTIPLY", cr, math_("LESS_THAN", sil, bv=0.5))
    # background under everything
    ao = node("CompositorNodeAlphaOver")
    ao.inputs[1].default_value = (*srgb2lin(bg), 1)
    L(rl.outputs["Image"], ao.inputs[2])
    m1 = node("CompositorNodeMixRGB", blend_type="MULTIPLY")
    m1.inputs[2].default_value = (0.58, 0.55, 0.55, 1)
    L(cr, m1.inputs[0])
    L(ao.outputs[0], m1.inputs[1])
    out = n.new("CompositorNodeComposite")
    if INK["mode"] == "face":
        # the line takes the colour of the face it sits on, darkened (inside the unit only; the outer edge is the
        # unit's own pixels darkened, so it never prints a foreign brown on the ground)
        m2 = node("CompositorNodeMixRGB", blend_type="MULTIPLY")
        m2.inputs[2].default_value = (0.36, 0.34, 0.33, 1)
        L(math_("MULTIPLY", sil, mask), m2.inputs[0])
        L(m1.outputs[0], m2.inputs[1])
    else:
        m2 = node("CompositorNodeMixRGB", blend_type="MIX")
        col = SEPIA if INK["mode"] == "sepia" else (0.36, 0.28, 0.24)
        m2.inputs[2].default_value = (*srgb2lin(col), 1)
        L(math_("MULTIPLY", sil, bv=0.95 if INK["mode"] == "sepia" else 0.8), m2.inputs[0])
        L(m1.outputs[0], m2.inputs[1])
    L(m2.outputs[0], out.inputs[0])


def assign(objs, mat):
    for o in objs:
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(mat)


def ground(size, col, z=0.0):
    me = bpy.data.meshes.new("ground")
    s = size / 2
    me.from_pydata([(-s, -s, z), (s, -s, z), (s, s, z), (-s, s, z)], [], [(0, 1, 2, 3)])
    ca = me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for d in ca.data:
        d.color_srgb = (*col, 1)
    o = bpy.data.objects.new("ground", me)
    bpy.context.scene.collection.objects.link(o)
    assign([o], toon("ToonGround", 0.0, ground=True))
    return o


def guide(a, b, r=0.018, col=(0.85, 0.12, 0.10)):
    """A thin guide bar from a to b (the hip-ankle line in the knock-knee check)."""
    import bmesh
    a, b = Vector(a), Vector(b)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=r, radius2=r, depth=(b - a).length)
    me = bpy.data.meshes.new("guide")
    bm.to_mesh(me)
    bm.free()
    ca = me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for d in ca.data:
        d.color_srgb = (*col, 1)
    o = bpy.data.objects.new("guide", me)
    bpy.context.scene.collection.objects.link(o)
    o.location = (a + b) / 2
    o.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    assign([o], toon("ToonGuide", 0.0, ground=True))
    return o


def leg_guides(root):
    """Hip-ankle lines and a knee marker per leg, from the posed joint empties."""
    bpy.context.view_layer.update()
    E = {o.name: o for o in root.children_recursive if o.type == "EMPTY"}
    for sfx in ("_L", "_R"):
        h, k, a = (E[n + sfx].matrix_world.translation.copy() for n in ("Thigh", "Shin", "Foot"))
        guide(h + Vector((0, -1.4, 0)), a + Vector((0, -1.4, 0)))
        guide(k + Vector((0, -1.4, 0.06)), k + Vector((0, -1.4, -0.06)), r=0.05, col=(0.10, 0.30, 0.85))


def human(x, y, yaw=0.0):
    """A 1.8 m pilot in workwear: lofted legs, body, arms, head and helmet."""
    P = K.Piece("Human", (0, 0, 0), seed=3)
    coat, pants, skin, dark = (0.55, 0.47, 0.36), (0.33, 0.3, 0.26), (0.82, 0.66, 0.52), (0.2, 0.19, 0.18)
    V3 = Vector
    for s in (-1, 1):
        K.lofted(P, V3((s * 0.1, 0, 0.92)), V3((s * 0.11, 0.02, 0.08)), [(0, 0.08, 0.08, 0.08, 0.03, 0.03),
                                                                       (1, 0.06, 0.06, 0.06, 0.02, 0.02)], "dark", pants)
        K.blk(P, (s * 0.11, -0.04, 0.0), (0.12, 0.28, 0.1), "dark", dark, ch=0.03)
        K.lofted(P, V3((s * 0.22, 0, 1.45)), V3((s * 0.27, -0.02, 0.86)), [(0, 0.055, 0.06, 0.06, 0.02, 0.02),
                                                                         (1, 0.045, 0.05, 0.05, 0.02, 0.02)], "primary",
                 coat)
    K.lofted(P, V3((0, 0, 0.85)), V3((0, 0, 1.5)), [(0, 0.17, 0.12, 0.11, 0.05, 0.04), (0.7, 0.21, 0.13, 0.12, 0.06, 0.05),
                                                    (1, 0.18, 0.11, 0.1, 0.05, 0.05)], "primary", coat, across=V3((-1, 0, 0)))
    K.lathe(P, V3((0, 0, 1.5)), (0, 0, 1), [(0, 0.05), (0.06, 0.05), (0.08, 0.1), (0.2, 0.11), (0.29, 0.07)], 8,
            "secondary", skin)
    K.lathe(P, V3((0, 0.01, 1.65)), (0, 0, 1), [(0, 0.125), (0.06, 0.125), (0.13, 0.1), (0.155, 0.04)], 8, "dark", dark)
    K.bake_all([P], {"bare": (0.5, 0.5, 0.5), "dust": (0.7, 0.6, 0.45)}, 3, ao_rays=8, dust=0.0)
    o = K.emit(P, None, V3((x, y, 0)))
    o.rotation_euler = (0, 0, yaw)
    assign([o], toon())
    return o


def cam_look(pos, target, lens=50.0, ortho=None):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.clip_end = 500
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    cam.location = pos
    cam.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def cam_game(target, pitch_deg, dist):
    """The game camera: perspective, 24 mm on a 36 mm sensor (as the vehicle renders), pitch from the horizontal."""
    p = math.radians(pitch_deg)
    pos = Vector(target) + Vector((0, -dist * math.cos(p), dist * math.sin(p)))
    cam = cam_look(pos, target, 24)
    cam.data.sensor_width = 36
    return cam


def shot(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("RENDER", path)


# ------------------------------------------------------------------------------------------------------- this study
MATCH = {"front": (0, -30, 2.6), "back": (0, 30, 2.6), "left": (30, 0, 2.6), "right": (-30, 0, 2.6), "q34": (-16, -22, 9),
         "top": (0, -0.001, 40), "rear34": (16, 20, 8)}
REF_CAM = ((-2.4, -21.0, 2.1), (0.0, 0.0, 2.65), 85)     # the reference's angle: near front, a touch left, thigh height


def meshes(root):
    return [o for o in root.children_recursive if o.type == "MESH"]


def mech(mass=False, layers=None, loc=(0, 0, 0), yaw=0.0, mat=None, model=None, pose=None):
    global HD
    keep = HD
    HD = model or HD
    if hasattr(HD, "POSE"):
        HD.POSE["mode"] = pose or POSE_MODE["mode"]
    try:
        return _mech(mass, layers, loc, yaw, mat)
    finally:
        HD = keep


POSE_MODE = {"mode": "stance"}


def _mech(mass=False, layers=None, loc=(0, 0, 0), yaw=0.0, mat=None):
    if mass:
        root, objs, info = HD.build_mass()
    else:
        root, objs, info = HD.build_full(layers)
    root.location = loc
    root.rotation_euler = (0, 0, yaw)
    assign(meshes(root), mat or toon())
    return root, info


def flat_layer_material():
    """Debug colour from a corner attribute 'Dbg', lit by a fixed light (no toon bands)."""
    m = bpy.data.materials.new("Dbg")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    n, L = nt.nodes, nt.links.new
    a = n.new("ShaderNodeAttribute")
    a.attribute_name = "Dbg"
    geo = n.new("ShaderNodeNewGeometry")
    dot = n.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = tuple(LIGHT_TO)
    mr = n.new("ShaderNodeMapRange")
    mr.inputs[1].default_value, mr.inputs[2].default_value = -1.0, 1.0
    mr.inputs[3].default_value, mr.inputs[4].default_value = 0.55, 1.0
    mx = n.new("ShaderNodeMix")
    mx.data_type, mx.blend_type = "RGBA", "MULTIPLY"
    mx.inputs[0].default_value = 1.0
    em = n.new("ShaderNodeEmission")
    out = n.new("ShaderNodeOutputMaterial")
    L(geo.outputs["True Normal"], dot.inputs[0])
    L(dot.outputs["Value"], mr.inputs[0])
    L(a.outputs[0], mx.inputs[6])
    L(mr.outputs[0], mx.inputs[7])
    L(mx.outputs[2], em.inputs[0])
    L(em.outputs[0], out.inputs[0])
    aov = n.new("ShaderNodeOutputAOV")
    aov.aov_name = "ink"
    aov.inputs["Value"].default_value = 1.0
    return m


LAYER_COLS = {"frame": (0.15, 0.15, 0.16), "actuation": (0.55, 0.57, 0.60), "power": (0.18, 0.24, 0.40), "mounting": (0.88, 0.87, 0.82),
              "plates": (0.90, 0.50, 0.18), "seals": (0.06, 0.06, 0.06), "heat": (0.78, 0.22, 0.12), "service": (0.95, 0.85, 0.25),
              "sensors": (0.35, 0.90, 0.85), "mods": (0.50, 0.42, 0.30),
              "weapon": (0.60, 0.30, 0.65)}
TAG_COLS = {0: (0.55, 0.55, 0.55), 1: (0.62, 0.66, 0.72), 2: (0.95, 0.45, 0.15), 3: (0.20, 0.45, 0.85), 4: (0.25, 0.85, 0.95),
            5: (0.95, 0.80, 0.20), 6: (0.85, 0.20, 0.25), 7: (0.55, 0.85, 0.30)}


def paint_debug(objs, mode):
    mat = flat_layer_material()
    for o in objs:
        me = o.data
        ca = me.color_attributes.new("Dbg", "FLOAT_COLOR", "CORNER")
        lay = H.layer_of(o.name)
        tags = me.attributes.get("hs_tag")
        for poly in me.polygons:
            if mode == "tag":
                c = TAG_COLS.get(tags.data[poly.index].value if tags is not None else 0, (0.5, 0.5, 0.5))
            else:
                c = LAYER_COLS.get(lay, (0.8, 0.78, 0.74))
            for li in poly.loop_indices:
                ca.data[li].color = (*srgb2lin(c), 1.0)
        me.materials.clear()
        me.materials.append(mat)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="mass_game40,mass_ref")
    ap.add_argument("--tag", default="")
    ap.add_argument("--model", default="rampart")
    ap.add_argument("--ink", default="sepia", choices=("sepia", "thin", "face"))
    ap.add_argument("--pose", default="stance", choices=("stance", "rest"))
    a = ap.parse_args(argv)
    POSE_MODE["mode"] = a.pose
    global HD
    HD = importlib.import_module(a.model)
    INK["mode"] = a.ink
    os.makedirs(a.out, exist_ok=True)
    want = a.only.split(",")
    tag = ("_" + a.tag) if a.tag else ""
    out = lambda n: os.path.join(a.out, n + tag + ".png")  # noqa: E731
    info = {}
    for w in want:
        mass = w.startswith("mass_")
        if w in ("mass_game40", "game40"):
            scene(1920, 1080, SAND, dil=0, crease=0.9)
            ground(200, SAND)
            _, info = mech(mass, loc=(0, 0, 0))
            human(2.6, -1.2)
            cam_game((0, 0, 1.6), 50, 40)
            shot(out(w))
        elif w in ("mass_ref", "ref"):
            scene(1100, 866)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(mass)
            human(-2.7, 0.3, 0.2)
            cam_look(*REF_CAM)
            shot(out(w))
        elif w == "ref_rest":
            scene(1100, 866)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(False, pose="rest")
            human(-2.7, 0.3, 0.2)
            cam_look(*REF_CAM)
            shot(out(w))
        elif w == "compare_v2":
            # our own models only: v2 left, this model right, both at rest, from the reference's angle pulled back
            scene(1800, 900)
            ground(80, (0.86, 0.82, 0.78))
            old = importlib.import_module("rampart_v2")
            mech(False, loc=(-3.4, 0, 0), model=old, pose="rest")
            _, info = mech(False, loc=(3.4, 0, 0), pose="rest")
            human(0.0, -1.5, 0.2)
            cam_look((-3.0, -30.0, 4.0), (0.0, 0.0, 2.6), 50, ortho=12.5)
            shot(out(w))
        elif w in ("front_legs", "front_legs_stance"):
            # the knock-knee check (skill 6b): front ortho of the legs, hip-ankle lines red, knees blue
            scene(1200, 1000)
            ground(60, (0.86, 0.82, 0.78))
            root, info = mech(False, pose="stance" if w.endswith("stance") else "rest")
            leg_guides(root)
            cam_look((0, -30, 1.9), (0, 0, 1.9), 50, ortho=4.6)
            shot(out(w))
        elif w == "compare_v3":
            scene(1800, 900)
            ground(80, (0.86, 0.82, 0.78))
            old = importlib.import_module("rampart_v3")
            mech(False, loc=(-3.0, 0, 0), model=old, pose="rest")
            _, info = mech(False, loc=(3.0, 0, 0), pose="rest")
            human(0.0, -1.5, 0.2)
            cam_look((-3.0, -30.0, 4.0), (0.0, 0.0, 2.6), 50, ortho=11.8)
            shot(out(w))
        elif w == "mass_vs_final":
            # skill 7b: did the signature forms survive? the mass (left) and the final (right), at rest, from the reference's
            # low front angle where the face shield's upside-down U reads
            scene(1800, 900)
            ground(80, (0.86, 0.82, 0.78))
            mech(True, loc=(-2.7, 0, 0), pose="rest")
            _, info = mech(False, loc=(2.7, 0, 0), pose="rest")
            cam_look((-1.6, -30.0, 2.4), (0.0, 0.0, 3.3), 50, ortho=11.0)
            shot(out(w))
        elif w == "chest_close":
            scene(1500, 1200)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(False)
            cam_look((-4.2, -7.6, 5.2), (-0.15, -0.45, 3.9), 50)
            shot(out(w))
        elif w == "legtech_close":
            scene(1300, 1300)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(False)
            cam_look((-5.6, -3.4, 1.9), (-1.15, 0.0, 1.25), 50)
            shot(out(w))
        elif w == "feet_front":
            scene(1500, 800)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(False, pose="rest")
            cam_look((0.0, -12.0, 0.9), (0.0, 0.0, 0.35), 50, ortho=3.6)
            shot(out(w))
        elif w == "feet_q34":
            scene(1300, 1000)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(False, pose="rest")
            cam_look((-4.3, -4.0, 1.7), (-1.30, -0.15, 0.25), 50)
            shot(out(w))
        elif w == "leg_close":
            scene(1300, 1300)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(False)
            cam_look((-5.2, 3.6, 2.6), (-1.0, 0.2, 1.7), 50)
            shot(out(w))
        elif w == "mass_side":
            scene(1100, 866)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(True)
            human(0.0, -3.0, 0.0)
            cam_look((24, -0.2, 2.7), (0, -0.2, 2.7), 50, ortho=7.0)
            shot(out(w))
        elif w == "zoom10":
            scene(1920, 1080, SAND)
            ground(200, SAND)
            _, info = mech(False, yaw=math.radians(-20))
            human(2.4, -1.6)
            cam_game((0.4, 0, 2.6), 45, 10)
            shot(out(w))
        elif w == "plates_close":
            scene(1500, 1200)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(False)
            cam_look((-3.6, -7.0, 4.6), (-0.1, -0.2, 3.3), 50)
            shot(out(w))
        elif w == "back34":
            scene(1100, 1100)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(False)
            human(2.0, 1.8, 2.8)
            cam_look((9.0, 13.5, 5.6), (0, 0, 2.6), 50)
            shot(out(w))
        elif w == "inner_close":
            scene(1300, 1200)
            ground(60, (0.86, 0.82, 0.78))
            _, info = mech(False)
            cam_look((3.2, 5.6, 2.2), (0.8, 0.0, 2.2), 50)
            shot(out(w))
        elif w in ("layer_map", "technique_map"):
            scene(1500, 1100)
            ground(60, (0.86, 0.82, 0.78))
            root, info = mech(False)
            paint_debug(meshes(root), "layer" if w == "layer_map" else "tag")
            cam_look((-7.5, -12.0, 5.0), (0, 0, 2.6), 50)
            shot(out(w))
        elif w.startswith("match_") or w.startswith("massmatch_"):
            # the reference-match cameras (the same as the reference turnaround script): ortho 6.4 m, 1000 px, target
            # (0, 0, 2.6); flat grey on a plain background so the silhouettes can be overlaid
            view = w.split("_", 1)[1]
            mass = w.startswith("massmatch_")
            if view == "game40":
                scene(1920, 1080, SAND, dil=0, crease=0.9)
                ground(200, SAND)
                _, info = mech(mass)
                cam_game((0, 0, 1.6), 50, 40)
            else:
                scene(1000, 1000)
                _, info = mech(mass)
                p = MATCH[view]
                cam_look(p, (0, 0, 0) if view == "top" else (0, 0, 2.6), 50,
                         ortho=7.5 if view in ("q34", "rear34") else 6.4)
            shot(out(w))
        elif w == "layers_exploded":
            scene(2400, 900)
            ground(200, (0.86, 0.82, 0.78))
            for i, lay in enumerate(("frame", "actuation", "power", "mounting", "plates", "seals", "heat", "service", "sensors", "weapon")):
                if lay == "weapon" and not getattr(HD, "HAS_WEAPON_LAYER", False):
                    continue
                root, info = mech(False, layers={lay}, loc=((i - 4.5) * 3.6, 0, 0))
                paint_debug(meshes(root), "layer")
            cam_look((-4.0, -40.0, 9.0), (0, 0, 2.6), 50, ortho=37.0)
            shot(out(w))
    with open(os.path.join(a.out, "shots_info%s.json" % tag), "w") as f:
        json.dump(info, f, indent=1)
    print("HSSTATS", json.dumps(H.report()["stats"]))


if __name__ == "__main__":
    main()
