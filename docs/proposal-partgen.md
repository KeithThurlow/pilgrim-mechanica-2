# Proposal: generated parts and assets (Keith 2026-10-31)

Keith: "stand up a part generation and asset generation" pipeline with a state-of-the-art local Gaussian splat model
and a splat-to-mesh step; ComfyUI is installed on the PC but needn't be used. Waiting on Keith's go (rule 9).

## The constraint that shapes it

Splats never ship (decision 2026-10-31: baked lighting can't follow the day-night cycle). So a splat is only ever an
intermediate, and the game needs what the Rampart already has: a GLB in metres, front +Z, left +X, one mesh per sim
bone (`Part_*`), joint empties (`Thigh_L`, `Shin_L`, ...), vertex colours for paint, AO and wear, a tri budget (the
Rampart is 34.6k for a whole mech). No generator gives that; the back half of the pipeline has to.

## Models (checked 2026-10-31)

| Step | Pick | Why | Licence |
| --- | --- | --- | --- |
| Concept image | whatever image model is already in Keith's ComfyUI (Flux-class) | one clean part on grey, three-quarter view, house style prompt | as installed |
| Image → splat | **TripoSplat** (VAST, mid 2026) | open, single image to up to 262k Gaussians, PLY out, ComfyUI template, ~8 GB VRAM | MIT |
| Image → mesh (direct) | **Pixal3D** (SIGGRAPH 2026, on TRELLIS.2) with **TRELLIS.2** (Microsoft, Dec 2025) as the switch | native ComfyUI nodes since 2026 (template `3d_pixal3d_trellis2_image_to_model`), textured mesh with PBR maps, remesh/decimate/fill-holes nodes built in | TRELLIS.2 MIT; Pixal3D: check before use |
| Splat → mesh | render the splat from ~64 views (colour + depth), then TSDF fusion; **MILo** (TOG 2025) only if TSDF is too soft | MILo and 2DGS/GOF train from images, not from a finished splat, so they'd re-fit from our renders anyway. MILo gives ~10x fewer vertices than 2DGS/GOF | MILo: check |

My recommendation: **run both lanes on the same concept images and let Keith judge the meshes in the armoury lab.**
Splat → mesh is the lane Keith asked for; direct mesh is one step shorter and is what Comfy now ships natively, and I
expect it to give cleaner hard-surface edges. A one-afternoon bake-off settles it on real parts, not on papers.

## Pipeline

```
prompt (part kind + style)  ─►  concept image (ComfyUI)  ─►  background cut (BiRefNet)
    ├─ lane A: TripoSplat ─► .ply ─► render 64 views ─► TSDF mesh
    └─ lane B: Pixal3D / TRELLIS.2 ─► textured .glb
                     ▼
  game prep (Blender headless, tools/partgen/prep.py; the part kind's template says what it needs)
    1. orient and scale: fit to the kind's bounding box (a stilt shin is ~2.4 m), front +Z
    2. remesh + decimate to the kind's tri budget (shin 2-4k, hull 6-10k)
    3. bake base colour and AO to vertex colours (the toon look reads vertex colour, not maps); drop the maps
    4. cut into `Part_*` pieces and add joint empties at the template's sockets (hip, knee, hock, foot point)
    5. export public/models/gen/<kind>-<seed>.glb + a json sidecar (prompt, seeds, model versions, lane)
                     ▼
  armoury lab ?model=gen/<id>: on the Rampart, game camera, side by side with the hand-built part
```

The templates (`tools/partgen/kinds/*.json`) are where the game knowledge lives: per part kind, the box it must fill,
the sockets and the cut planes, read from `rampart.glb`'s joint markers (never hardcoded). Legs are the hard case
because they're cut at the joints; hulls, shoulder pods and wrecks are single pieces and the easy first targets.

## How it runs

- The GPU steps run on Keith's PC through a Remote Control session: ComfyUI's HTTP API (`/prompt` with a saved
  workflow json, outputs read back from its output folder), driven by `tools/partgen/run.ts`. TripoSplat and
  Pixal3D both have Comfy templates, so lane A and lane B are two workflow files.
- Blender prep runs wherever Blender is (the PC, or headless here), so it's testable without the GPU.
- A headless check `tools/partgen-check.ts`: every generated GLB has the kind's `Part_*` names and sockets, is under
  budget, has vertex colours, sits in its box, no non-manifold holes in the ground-contact parts (feet).
- Everything seeded and logged in the sidecar so a part can be remade.

## Order

1. Keith: start the Remote Control session; I check what's installed (ComfyUI version, GPU and VRAM, image models,
   Blender), install TripoSplat and the Pixal3D/TRELLIS.2 weights.
2. Bake-off on 3 single-piece parts (a hull, a shoulder pod, a wreck): both lanes, raw meshes into `shots/partgen/`,
   Keith picks the lane.
3. Game prep + armoury lab hook for single pieces; check.
4. Leg templates (stilt first, using the old project's stilt proportions) once single pieces work.

## Open questions for Keith

- Which GPU and how much VRAM? (TRELLIS.2 at full resolution wants a lot; the int8 weights help.)
- Which image model is in your ComfyUI, and do you have a style reference (old renders, the Rampart) to condition on?
- The splat model from your other thread: if it isn't TripoSplat, give me the name and I'll swap it into lane A.

Sources: ComfyUI blog "trellis2 and pixal3d are now native"; docs.comfy.org/tutorials/3d/trellis2; ScriptByAI on
TripoSplat (2026-06-09); MILo, arXiv 2506.24096v2.
