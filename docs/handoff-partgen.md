# Handoff: generated parts pipeline

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
- Workflows: `tools/partgen/workflows/` (README there). Lane B stops at the 512 shape stage, remeshes at 128 (`PG_RES`),
  decimates to each level's budget (`PG_FACES`), bakes base colour only.
- Concept prompts in `kinds.ts` name only the part: Klein runs at cfg 1, so "no legs" drew legs.
- Axes (found on the cannon, whose barrel is unambiguous; noted in `run.ts`):
  - lane A (TripoSplat, Y-down splat, object-aligned): `--front +x --up -y`
  - lane B (Pixal3D, camera-aligned, camera at +Z): `--front +z --up +y --yaw 45,snap` (the concept's front faces the
    viewer's left; `snap` boxes the part tightest within ±45°, `boxYaw` in `prep.ts`)
- Bake-off, seed 1, both lanes on the same concept (`bash shots/partgen/probe/bake.sh <kind>` is gitignored; it's lane A
  with the concept, then lane B with `--image shots/partgen/raw/<kind>-1-concept.png`):

  | Part | Lane A tris (full/lod1/lod2) | Lane B tris | Lane A time | Lane B time |
  | --- | --- | --- | --- | --- |
  | hull | 6500 / 2054 / 700 | 6480 / 2198 / 696 | 46 s (incl. 9 s concept) | 82 s |
  | hullweapon | 5000 / 1700 / 549 | 4998 / 1700 / 550 | 43 s | 140 s |
  | shoulder | 1754 / 700 / 249 | 2000 / 698 / 201 | 44 s | 154 s |

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
- Lane B's time varies (54-154 s) with what else is on the GPU; ComfyUI's cache reruns only the decimator onward for
  levels 1 and 2.

## Test

`npx tsx tools/partgen-check.ts`; `labs/parts/` (`?part=sample-hull`).
