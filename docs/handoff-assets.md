# Handoff: model and asset rebuild (Keith 2026-11-13)

Plan, review and order: `docs/asset-pipeline.md`. Branch `claude/project-thread-vum2tc`, backup `wip/assets`.

## Done
- Batch 0: plan, Blender in the cloud (`sh tools/blender/cloud-setup.sh`), `CHROME=` for `tools/shots.mjs`.
- Batch 1: `tools/blender/parts/partkit.py` + `packs.py`, five packs in `public/models/parts/`, `src/mech/partModels.ts`,
  `RampartBody.setPack`. Build: `node tools/blender/run.mjs tools/blender/parts/packs.py -- --out public/models/parts
  [--only <id>] [--sheet <dir>]`. Gotchas: collect a GLB's meshes before `look.apply` (it adds an outline child, a live
  traverse recurses for ever); Blender's colours are 16-bit normalised, `plain()` in partModels makes them floats.

## Next, in order
1. `tools/assets-check.ts` and `labs/icons/` + `npm run icons`; `src/ui/itemIcon.ts` shows `public/icons/<base>.webp`.
3. Inventory layout (own PR). 4. Arms, sensors, waist kit. 5. Robots. Then as the plan's table.

## How to test
- Shots here: `npm run build`, then `CHROME=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome node tools/shots.mjs "<lab url>"`.
- Keith's PC is off until about 2026-11-16: no reference art, no `wkit.py`, no GPU lane.
