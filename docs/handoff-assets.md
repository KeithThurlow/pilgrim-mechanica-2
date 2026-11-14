# Handoff: model and asset rebuild (Keith 2026-11-13)

Plan, review and order: `docs/asset-pipeline.md`. Branch `claude/project-thread-vum2tc`, backup `wip/assets`.

## Done
- Batch 0: plan, Blender in the cloud (`sh tools/blender/cloud-setup.sh`), `CHROME=` for `tools/shots.mjs`.
- Batch 1: `tools/blender/parts/partkit.py` + `packs.py`, five packs in `public/models/parts/`, `src/mech/partModels.ts`,
  `RampartBody.setPack`. Build: `node tools/blender/run.mjs tools/blender/parts/packs.py -- --out public/models/parts
  [--only <id>] [--sheet <dir>]`. Gotchas: collect a GLB's meshes before `look.apply` (it adds an outline child, a live
  traverse recurses for ever); Blender's colours are 16-bit normalised, `plain()` in partModels makes them floats.

- Batch 2: `labs/icons/`, `tools/icons.mjs` (`npm run build && CHROME=... npm run icons`, then build again),
  `src/ui/itemIcon.ts` shows `public/icons/<base>.png`; `tools/assets-check.ts`. After any model change rerun icons.

- Batch 3: the inventory's layout (`src/ui/inventory.ts` `TILES`, `dollBox`, `statStrip`, `cargoColumn`; `inventory.css`).

- Batch 4: `sensors.py` (five, in `public/models/sensors/`), `waist.py` (three), `RampartBody.setWaist`. Arms were
  built in another thread (PR 356, `arms.py`). Kit gotchas: `V.blk` takes the box's bottom (use the local `B` for a
  centre); a node's pieces are authored about the node's pivot.

## Next, in order
1. Robots: scrapper, cutter, excavator, quads; drones and the scrap swarm (instanced: one merged geometry a kind).
2. Then as the plan's table (`docs/asset-pipeline.md`).

## How to test
- Shots here: `npm run build`, then `CHROME=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome node tools/shots.mjs "<lab url>"`.
- Keith's PC is off until about 2026-11-16: no reference art, no `wkit.py`, no GPU lane.
