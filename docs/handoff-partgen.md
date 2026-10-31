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

## Left, in order (needs Keith's PC, Remote Control session)

1. Check the PC: GPU and VRAM, ComfyUI version (0.34+ for the native TRELLIS.2 / Pixal3D nodes), image models.
2. Install TripoSplat (ComfyUI template) and the Pixal3D / TRELLIS.2 weights (template `3d_pixal3d_trellis2_image_to_model`).
3. Build `tools/partgen/workflows/concept.json`, `lane-a.json`, `lane-b.json` (Export (API), title the nodes), commit.
4. Bake-off: `npx tsx tools/partgen/run.ts --kind hull|shoulder|wreck --seed 1..3 --lane both`; find each lane's
   `--front/--up` (generators differ), commit the parts, Keith picks a lane in `labs/parts/`.
5. Then: legs (cut at the joints), and hooking parts into the loadout (the "show equipped hulls" thread owns the swap).

## Known rough edges

- Lane A's mesh is as soft as the field: sharp hard-surface edges round off at resolution 160. Raise `--res` or
  prefer lane B if that shows.
- Lighting baked into a generator's texture becomes paint. The concept prompt asks for flat light; may need de-lighting.
- Shoulder and wreck parts aren't put on the Rampart yet, only on the stand.

## Test

`npx tsx tools/partgen-check.ts`; `labs/parts/` (`?part=sample-hull`).
