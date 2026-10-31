# Part pipeline workflows

ComfyUI workflows in API format (in ComfyUI: Workflow menu → Export (API)), one per step. `tools/partgen/run.ts`
patches them by node title (see `tools/partgen/comfy.ts`): title the prompt node `PG_PROMPT`, the LoadImage node
`PG_IMAGE`, the sampler `PG_SEED`.

| File | Step | Starts from | Must write |
| --- | --- | --- | --- |
| `concept.json` | prompt → concept image | an image model on the PC (Flux-class) | a PNG or JPEG |
| `lane-a.json` | image → splat | ComfyUI's TripoSplat template | a 3DGS `.ply` |
| `lane-b.json` | image → mesh | ComfyUI's `3d_pixal3d_trellis2_image_to_model` template (Pixal3D, or TRELLIS.2 by its switch) | a `.glb` with an embedded PNG/JPEG base colour |

Not here yet: they're made on Keith's PC, where the models are installed (docs/proposal-partgen.md, Order).
