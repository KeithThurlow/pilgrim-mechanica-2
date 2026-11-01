# Builds lane-b.json (ComfyUI API format) from the Comfy template 3d_pixal3d_trellis2_image_to_model, set up the way
# Keith's own "PM2 02 - Part to 3D (TRELLIS.2)" workflow runs it (2026-11-01: his 1,000-triangle tests with baked maps
# beat our vertex-coloured parts by a mile). Dense shape first, then straight down to the level's budget, with the
# base colour and a normal map baked from the dense surface (no AO, metallic or roughness: no light in the colours).
#   python tools/partgen/workflows/build-lane-b.py [out.json] [--model trellis|pixal] [--res 1024] [--remesh 768]
#                                                   [--faces 5000] [--tex 2048] [--dense]  (--dense: no decimation, a reference)
import json, sys

args = sys.argv[1:]
def opt(k, d):
    return args[args.index(f"--{k}") + 1] if f"--{k}" in args else d
out = args[0] if args and not args[0].startswith("--") else "tools/partgen/workflows/lane-b.json"
model, res, remesh = opt("model", "trellis"), int(opt("res", "1024")), int(opt("remesh", "768"))
faces, tex, dense = int(opt("faces", "5000")), int(opt("tex", "2048")), "--dense" in args

def n(c, i, t=None):
    return {"class_type": c, "inputs": i, "_meta": {"title": t or c}}

pixal = model == "pixal"
w = {
    "1": n("LoadImage", {"image": "example.png"}, "PG_IMAGE"),
    "2": n("LoadBackgroundRemovalModel", {"bg_removal_name": "birefnet.safetensors"}),
    "3": n("RemoveBackground", {"bg_removal_model": ["2", 0], "image": ["1", 0]}),
    # Keith's crop: no padding (the template's 1.1 is for Pixal3D)
    "4": n("ImageCropToMask", {"images": ["1", 0], "masks": ["3", 0], "width": 1024, "height": 1024, "pad_factor": 1.1 if pixal else 1.0, "grow_mask": 0, "background": "#000000"}),
    "5": n("CLIPVisionLoader", {"clip_name": "dino_v3_L_naf_fp32.safetensors"}),
    "10": n("UNETLoader", {"unet_name": "pixal3d_int8_convrot.safetensors" if pixal else "trellis_2_int8_convrot.safetensors", "weight_dtype": "default"}),
    "11": n("VAELoader", {"vae_name": "trellis_2_shape_vae_bf16.safetensors"}),
    "12": n("VAELoader", {"vae_name": "trellis_2_texture_vae_bf16.safetensors"}),
    # structure
    "20": n("CFGOverride", {"model": ["10", 0], "cfg": 1, "start_percent": 0.667, "end_percent": 1}),
    "21": n("RescaleCFG", {"model": ["20", 0], "multiplier": 0.7}),
    "22": n("ModelSamplingSD3", {"model": ["21", 0], "shift": 5}),
    "23": n("EmptyTrellis2LatentStructure", {"batch_size": 1}),
    "24": n("KSampler", {"model": ["22", 0], "positive": ["9", 0], "negative": ["9", 1], "latent_image": ["23", 0], "seed": 1, "steps": 12, "cfg": 7.5, "sampler_name": "euler", "scheduler": "normal", "denoise": 1}, "PG_SEED"),
    "25": n("VaeDecodeStructureTrellis2", {"samples": ["24", 0], "vae": ["11", 0], "resolution": "32"}),
    # shape at 512, then upsampled (the template's full path)
    "30": n("CFGOverride", {"model": ["10", 0], "cfg": 1, "start_percent": 0.769, "end_percent": 1}),
    "31": n("RescaleCFG", {"model": ["30", 0], "multiplier": 0.5}),
    "32": n("Trellis2ShapeStage", {"positive": ["9", 0], "negative": ["9", 1], "voxel": ["25", 0]}),
    "33": n("KSampler", {"model": ["31", 0], "positive": ["32", 0], "negative": ["32", 1], "latent_image": ["32", 2], "seed": 1, "steps": 20, "cfg": 7.5, "sampler_name": "euler", "scheduler": "normal", "denoise": 1}, "PG_SEED"),
    "35": n("Trellis2UpsampleStage", {"positive": ["32", 0], "negative": ["32", 1], "shape_latent": ["33", 0], "vae": ["11", 0], "target_resolution": res}, "PG_RES"),
    "36": n("KSampler", {"model": ["31", 0], "positive": ["35", 0], "negative": ["35", 1], "latent_image": ["35", 2], "seed": 1, "steps": 12, "cfg": 7.5, "sampler_name": "euler", "scheduler": "simple", "denoise": 1}, "PG_SEED"),
    "37": n("VaeDecodeShapeTrellis", {"samples": ["36", 0], "vae": ["11", 0]}),
    # texture
    "40": n("Trellis2TextureStage", {"positive": ["35", 0], "negative": ["35", 1], "shape_latent": ["36", 0]}),
    "41": n("KSampler", {"model": ["10", 0], "positive": ["40", 0], "negative": ["40", 1], "latent_image": ["40", 2], "seed": 1, "steps": 12, "cfg": 1, "sampler_name": "euler", "scheduler": "normal", "denoise": 1}, "PG_SEED"),
    "42": n("VaeDecodeTextureTrellis", {"samples": ["41", 0], "vae": ["12", 0], "shape_subdivides": ["37", 1]}),
    # the template's clean dense surface (Keith's settings)
    "50": n("RemeshMesh", {"mesh": ["37", 0], "resolution": remesh, "sign_mode": "solid", "sign_mode.fill": 20.0, "sign_mode.qef": False, "band": 1.0, "project_back": 0.0, "fix_poles": False, "smooth_iters": 20, "drop_small_components": 0.01, "precluster_max_verts": 20000000}),
}
if pixal:
    w["6"] = n("LoadMoGeModel", {"model_name": "moge_2_vitl_normal_fp16.safetensors"})
    w["7"] = n("MoGeInference", {"moge_model": ["6", 0], "image": ["4", 0], "resolution_level": 9, "fov_x_degrees": 0, "batch_size": 4, "force_projection": True, "apply_mask": True, "refine_steps": 3})
    w["8"] = n("MoGeGeometryToFOV", {"moge_geometry": ["7", 0], "axis": "horizontal", "unit": "degrees"})
    w["9"] = n("Pixal3DConditioning", {"clip_vision_model": ["5", 0], "image": ["4", 0], "camera_angle_x": ["8", 0]})
else:
    w["9"] = n("Trellis2Conditioning", {"clip_vision_model": ["5", 0], "image": ["4", 0]})
# to the level's budget, keeping sharp edges
w["51"] = n("DecimateMesh", {"mesh": ["50", 0], "target_face_count": 700000 if dense else faces, "placement_mode": "midpoint" if dense else "qem",
            **({} if dense else {"placement_mode.line_quadric_weight": 1.0, "placement_mode.feature_edge_quadric_weight": 100.0, "placement_mode.feature_edge_min_dihedral_deg": 30.0, "placement_mode.clamp_v_to_edge": True})},
            None if dense else "PG_FACES")
w["52"] = n("MeshSmoothNormals", {"mesh": ["51", 0], "crease_angle": 180 if dense else 40})
w["53"] = n("UnwrapMesh", {"mesh": ["52", 0], "segmenter": "pec", "resolution": tex, "padding": 4, "weld_distance": 0.0002})
w["54"] = n("BakeTextureFromVoxel", {"mesh": ["53", 0], "voxel_colors": ["42", 0], "reference_mesh": ["37", 0], "texture_size": tex})
maps = {"base_color": ["54", 0]}
if not dense:
    w["55"] = n("BakeNormalMapFromMesh", {"low_poly": ["53", 0], "high_poly": ["50", 0], "resolution": tex, "cage_distance": 0.05, "ignore_backfaces": True})
    maps["normal_map"] = ["55", 0]
w["56"] = n("ApplyTextureToMesh", {"mesh": ["53", 0], **maps})
w["57"] = n("MeshToFile3D", {"mesh": ["56", 0]})
w["58"] = n("SaveGLB", {"mesh": ["57", 0], "filename_prefix": "partgen/lane-b"})

with open(out, "w", encoding="utf8", newline="\n") as f:
    json.dump(w, f, indent=2)
    f.write("\n")
print(out)
