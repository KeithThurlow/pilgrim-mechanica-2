# Part pipeline workflows

ComfyUI workflows in API format, one per step, built against ComfyUI 0.42.5 (Comfy Desktop) on Keith's PC.
`tools/partgen/run.ts` patches them by node title (see `tools/partgen/comfy.ts`); `--concept/--lane-a/--lane-b x.json`
runs another file in a step's place.

| File | Step | Models | Titled nodes | Writes |
| --- | --- | --- | --- | --- |
| `concept.json` | prompt → concept image | FLUX.2 Klein 4B distilled (4 steps, 1024²), Qwen3 4B text encoder, flux2 VAE | `PG_PROMPT` (CLIPTextEncode), `PG_SEED` (RandomNoise) | PNG |
| `lane-a.json` | image → splat | BiRefNet cut-out, TripoSplat fp16, DINOv3-H, flux2 VAE, TripoSplat VAE decoder; 262k Gaussians | `PG_IMAGE`, `PG_SEED` (KSampler) | 3DGS `.ply` |
| `lane-b.json` | image → textured mesh at the level's budget | BiRefNet, TRELLIS.2 int8 (Keith's choice in his own workflow) | `PG_IMAGE`, `PG_SEED` (the samplers), `PG_RES` (upsample stage, 1024), `PG_FACES` (DecimateMesh face target) | `.glb`: base colour and normal map, 2048² |

`lane-b.json` is generated: `python tools/partgen/workflows/build-lane-b.py` (`--model pixal` for Pixal3D, `--res`,
`--remesh`, `--tex`, `--dense` for an undecimated reference). It follows Keith's "PM2 02 - Part to 3D (TRELLIS.2)"
workflow (`ComfyUI/user/default/workflows/`): the template's full shape path (512 then upsampled to 1024), the solid
remesh at 768 with 20 smoothing passes, then down to the level's budget with edge-keeping QEM, unwrapped, and the
base colour plus a normal map baked from the dense surface. No AO, metallic or roughness maps (no light in the
colours). The runner queues it once per level; ComfyUI's cache reruns only the decimator onward.

Axes: TRELLIS.2 builds the part in its own frame (`--front +z --up +y`, the defaults); Pixal3D builds it in the
concept's camera frame (`--front +z --up +y --yaw 45,snap`).

The files are hand-built from the Comfy templates `3d_triposplat_image_to_gaussian_splat`,
`3d_pixal3d_trellis2_image_to_model` and `image_flux2_klein_text_to_image`; open one in ComfyUI with
Workflow → Open to edit it.
