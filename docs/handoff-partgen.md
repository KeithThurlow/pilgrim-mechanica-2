# Handoff: generated parts pipeline

**Paused 2026-11-01 (Keith): the parts are still blobs. Unmerged; pick up from here when Keith returns to it.**

Keith 2026-10-31: stand up part and asset generation with a local splat model plus splat-to-mesh. Proposal:
`docs/proposal-partgen.md`. Branch `wip/partgen` (thread agent).

## Done (cloud, no GPU)

- `tools/partgen/glb.ts`: minimal GLB reader (meshes with node transforms, UVs, colours, embedded PNG/JPEG base colour)
  and writer (vertex-coloured parts plus empties).
- `tools/partgen/splat.ts`: 3DGS PLY in and out; `splatToMesh` (opacity field, surface nets, colours, islands).
  Defaults: resolution 160, iso 0.5, minAlpha 0.05, trim 0.5%, reach 3σ, islands below 5% dropped.
- `tools/partgen/kinds.ts`: hull / hullweapon / shoulder / wreck, boxes from the game's models, budgets and socket
  names from the asset contract (`docs/asset-list.md`, Keith 2026-10-26), three levels of detail each.
- `tools/partgen/prep.ts`: orient (`--front`, `--up`), fit, weld, simplify, flip if inside out, normals, sockets.
- `tools/partgen/comfy.ts` + `run.ts`: ComfyUI client and CLI; workflows patched by node titles `PG_PROMPT`,
  `PG_IMAGE`, `PG_SEED`.
- `labs/parts/`, `tools/partgen-check.ts` (in `npm test`), two sample parts in `public/models/gen/`.

## Done on Keith's PC (2026-11-01, Remote Control)

- PC: RTX 3080 10 GB, 32 GB RAM. ComfyUI is Comfy Desktop's standalone install, v0.42.5, at
  `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs\ComfyUI`; models in `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\models`.
  Run it headless (what this session did) from that folder's `ComfyUI\`:
  `.venv\Scripts\python.exe main.py --extra-model-paths-config "%APPDATA%\Comfy Desktop\instance-model-paths\inst-1792962429804.yaml" --input-directory <Shared>\input --output-directory <Shared>\output --enable-manager --port 8188`,
  or just open Comfy Desktop (check its port is 8188, else pass `--comfy`).
- Models: Pixal3D / TRELLIS.2 int8 set came with Comfy Desktop; added TripoSplat (fp16, its VAE decoder, DINOv3-H, flux2 VAE)
  and FLUX.2 Klein 4B distilled + Qwen3 4B (Apache-2.0). FLUX.3 Klein is gated on Hugging Face (needs Keith's login).
- Workflows: `tools/partgen/workflows/` (README there). Lane B: see the quality fix below.
- Concept prompts in `kinds.ts` name only the part: Klein runs at cfg 1, so "no legs" drew legs.
- Axes (found on the cannon, whose barrel is unambiguous; noted in `run.ts`):
  - lane A (TripoSplat, Y-down splat, object-aligned): `--front +x --up -y`
  - lane B with TRELLIS.2 (now the default): `--front +z --up +y`, the defaults
  - lane B with Pixal3D (camera-aligned, camera at +Z): `--front +z --up +y --yaw 45,snap` (the concept's front faces the
    viewer's left; `snap` boxes the part tightest within ±45°, `boxYaw` in `prep.ts`)
- Bake-off, seed 1, both lanes on the same concept (`bash shots/partgen/probe/bake.sh <kind>` is gitignored; it's lane A
  with the concept, then lane B with `--image shots/partgen/raw/<kind>-1-concept.png`):

  | Part | Lane A tris (full/lod1/lod2) | Lane B tris | Lane A time | Lane B time |
  | --- | --- | --- | --- | --- |
  | hull | 6500 / 2054 / 700 | 6480 / 2198 / 696 | 46 s (incl. 9 s concept) | 82 s |
  | hullweapon | 5000 / 1700 / 549 | 4998 / 1700 / 550 | 43 s | 140 s |
  | shoulder | 1754 / 700 / 249 | 2000 / 698 / 201 | 44 s | 154 s |

## Lane B quality fix (2026-11-01, Keith: "puddles of mesh")

Which stage lost the quality, on hullweapon seed 1 (same concept: 1024², one clean object on plain grey, so not the concept):
- **Prep, mostly.** It threw lane B's texture away and painted its colour onto the ≤5,000 vertices (no normal map), so
  every part read as a blurry blob. Keith's own good results (`output/3d/PilgrimMechanica/test_A_hires_1000`,
  `test_B_lowres_1000`) are 1,000-triangle meshes that keep a 2048² base colour and normal map plus AO/ORM.
- **The workflow, second.** I'd stopped Pixal3D at its 512 stage and remeshed at 128, which melts sharp edges.
- Fix: `prepareTextured` (orient and fit only; UVs, normals, base colour and normal map kept), the GLB writer writes
  textured parts, the toon look keeps a part's `map`/`normalMap`, setfit keeps them. Lane B is now Keith's workflow
  (TRELLIS.2, upsample 1024, remesh 768) decimated to each level's budget with the maps baked from the dense surface
  (`build-lane-b.py`). Over-budget decimations are retried lower, the last try with plain (midpoint) decimation.
- TRELLIS.2's baked albedo comes out much darker than the concept (cannon 53/255 against 106/255: the parts read
  black in the lab). The runner scales a textured part's base colour in linear light to the concept object's mean
  brightness (`matchAlbedo` in `prep.ts`, gain capped at 3, `--albedo 0..1`, default 1; the gains go in the sidecar).
  Made parts: hull ×1.24, cannon ×2.9-3 (capped), shoulder ×1.1-1.6, Pixal3D cannon ×1.3.
- "Low-res from the start" (Keith's earlier call) matches this: his low-res test was the generator at 1024 rather than
  1536, both at 1,000 faces with baked maps. It doesn't mean a coarse voxel remesh.

Variants on the cannon (raw GLBs in `shots/partgen/raw/hullweapon-1-laneB-*.glb`, gitignored):

| Variant | Tris | Time | VRAM peak |
| --- | --- | --- | --- |
| Keith's workflow as is (TRELLIS.2 1024, 700k, 2048² base colour) `-his` | 699,440 | 227 s | 9.6 GB |
| Pixal3D template at full 1536, 700k `-pixalfull` | 699,308 | 771 s | 10.0 GB (spills into system RAM) |
| TRELLIS.2 1024 → 5,000 with base colour + normal map `-trellis` (now lane B) | 4,922 | 67 s | 7.3 GB |
| Pixal3D 1024 → 5,000 with base colour + normal map `-pixal` | 4,984 | 150 s | 9.0 GB |

In the lab: `hullweapon-b-1` (TRELLIS.2, the new lane B) and `hullweapon-b-pixal` (Pixal3D, same settings).

## Left, in order

1. Keith compares the lanes in `labs/parts/` and picks one (or both: lane A for some kinds).
2. More seeds (`--seed 2..3`) and the wreck kind.
3. Then: legs (cut at the joints), and hooking parts into the loadout (the "show equipped hulls" thread owns the swap).

## Keith's calls (2026-11-01)

- No lighting baked into colours: unlit concept prompt, lane B uses only the base colour, lane A is de-lit (`--delight`).
- Low-res from the start beats dense-then-reduced: each level is meshed at its own budget. In the lane B workflow,
  title the generator's or remesher's face target `PG_FACES` (and its resolution `PG_RES` if it has one) so the
  runner sets it per level.
- Pixal3D's licence is fine.

## Fitting parts

`labs/parts/`: Fit sliders move the part on its mount; Copy fit → `npx tsx tools/partgen/setfit.ts <id> ...` bakes it
into `<id>.glb`, `-lod1`, `-lod2` and the sockets, and appends it to the sidecar's `fit`. Reset the sliders after.

## Known rough edges

- Lane A's mesh is as soft as the field: sharp hard-surface edges round off at resolution 160. Raise `--res` or
  prefer lane B if that shows.
- De-lighting only takes out one broad light plus ambient; hard cast shadows in a concept image would survive.
- Shoulder and wreck parts aren't put on the Rampart yet, only on the stand.
- TripoSplat aligns each object to its own frame, not the camera's, so lane A's front differs per part. 2026-11-01 check
  (each lane A part's height + width profile along Z against lane B's): hull and cannon match at `--front +x` (0.99, 0.95);
  the launcher matched only flipped, so shoulder-a-1 is re-prepped at `--front -x` (now 0.64, flipped -0.42). Test this
  on every lane A rerun rather than assume +x.
- Lane A's lod1 can come in under budget (the hull's 2054 of 2200; the shoulder full level 1754 of 2000): the splat
  meshing's resolution step is coarse at small budgets.
- Lane B's time varies with what else is on the GPU; ComfyUI's cache reruns only the decimator onward for levels 1
  and 2, but each level still unwraps and bakes its own 2048² maps (~4-6 MB per level GLB). Lower levels could take
  1024/512 maps (not wired: needs a `PG_TEX` title).
- TRELLIS.2 builds parts in its own frame (like TripoSplat), so its front could differ per part: confirmed +Z on the cannon.

## Test

`npx tsx tools/partgen-check.ts`; `labs/parts/` (`?part=sample-hull`).
