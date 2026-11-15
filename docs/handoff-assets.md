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

- Batch 6 (2026-11-14): `items.py` (swords, shoulder feeds and power, drone rack, hive, the five strikes) into
  `public/models/parts/`, swapped in by `src/weapons/partSwap.ts` (`swordFromGlb`, `gearFromGlb`, `shoulderPart`; hooks in
  `arsenal.ts` configure). Sword blades are built at true length and divided by it in the game. `partkit.sheet` takes a
  `target`. Headless shots: the weapons lab's picker hides the mech; use the swarm lab or the pose lab.

## Next, in order
1. **Robots** (was batch 5): on reading `src/combat/robotShapes.ts` they are not boxes. Each body is a designed, merged,
   instanced geometry built to Keith's own notes (2026-11-01 thorax, turret and abdomen; 2026-11-06 reactor mast) and
   tied to the leg specs (`HUB_R`, `MID_SPEC`, `BIG_SPEC`, saw and turret positions in `robotLegs.ts`), with eyes, saws
   and lenses drawn apart. Rebuild them with `art-refs/robot-reference/` to hand (Keith's PC), keeping those anchors;
   until then leave them. Drones (`src/summon/dronesDraw.ts` `frameGeometry`) and the scrap swarm can go with them.
2. Crusher, strider; war band vehicles; second pass on the kit weapons (`docs/asset-pipeline.md`).

## How to test
- Shots here: `npm run build`, then `CHROME=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome node tools/shots.mjs "<lab url>"`.
- Keith's PC is off until about 2026-11-16: no reference art, no `wkit.py`, no GPU lane.
