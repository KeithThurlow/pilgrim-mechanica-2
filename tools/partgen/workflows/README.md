# Part pipeline workflows

ComfyUI workflows in API format, one per step, built against ComfyUI 0.42.5 (Comfy Desktop) on Keith's PC.
`tools/partgen/run.ts` patches them by node title (see `tools/partgen/comfy.ts`).

| File | Step | Models | Titled nodes | Writes |
| --- | --- | --- | --- | --- |
| `concept.json` | prompt → concept image | FLUX.2 Klein 4B distilled (4 steps, 1024²), Qwen3 4B text encoder, flux2 VAE | `PG_PROMPT` (CLIPTextEncode), `PG_SEED` (RandomNoise) | PNG |
| `lane-a.json` | image → splat | BiRefNet cut-out, TripoSplat fp16, DINOv3-H, flux2 VAE, TripoSplat VAE decoder; 262k Gaussians | `PG_IMAGE`, `PG_SEED` (KSampler) | 3DGS `.ply` |
| `lane-b.json` | image → textured mesh | BiRefNet, MoGe-2 (field of view), Pixal3D int8 on the TRELLIS.2 pipeline | `PG_IMAGE`, `PG_SEED` (the three KSamplers), `PG_RES` (RemeshMesh resolution, 128), `PG_FACES` (DecimateMesh face target) | `.glb`, base colour PNG only |

Lane B is kept low from the start (Keith 2026-11-01): it stops at the 512 shape stage (no 1536 upsample), remeshes
the shape as one solid at resolution 128 with sharp-edge vertex placement, decimates to the level's budget, unwraps
and bakes only the base colour (no metallic, roughness, AO or normal maps, so no light in the colours). The runner
queues it once per level; ComfyUI's cache means only the decimator onward reruns.

To swap Pixal3D for TRELLIS.2 in lane B: node 10's `unet_name` → `trellis_2_int8_convrot.safetensors` and node 9
→ `Trellis2Conditioning` (inputs `clip_vision_model`, `image`; no field of view).

The files are hand-built from the Comfy templates `3d_triposplat_image_to_gaussian_splat`,
`3d_pixal3d_trellis2_image_to_model` and `image_flux2_klein_text_to_image`; open one in ComfyUI with
Workflow → Open to edit it.
