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
1. **Batch 6 first** (items with boxes or nothing; robots moved after it, see below):
   - Swords ×3 (`sword-light` Breaker, katana-like; `sword-heavy` Buster; `sword-short`). Today one code model,
     `swordModel` in `src/weapons/models.ts`: a `swing` group (hilt, +Z from the hand), a `blade` group 1 long that the
     arsenal stretches to the reach and thickens by base (`src/weapons/arsenal.ts` near "A heavier sword is a thicker"),
     one `edge` glow material the arsenal drives. A GLB needs: hilt as Body, a `Blade` node 1 m long along forward with
     its lit edge as the node's glow piece (`b.node_glow("Blade")`); the model must be picked by base id, not kind.
   - Belt feed, incendiary feed, capacitor bank (`beltFeedModel`, `incendiaryFeedModel`, `capacitorModel`, same file;
     each has a lamp in `m.glow` the arsenal lights). Drone rack and swarm hive have no model at all (`sh-drones`,
     `sh-hive`): find where shoulder items without a `shoulder:` weapon are drawn (nothing today) and hang a part there.
2. **Robots** (was batch 5): on reading `src/combat/robotShapes.ts` they are not boxes. Each body is a designed, merged,
   instanced geometry built to Keith's own notes (2026-11-01 thorax, turret and abdomen; 2026-11-06 reactor mast) and
   tied to the leg specs (`HUB_R`, `MID_SPEC`, `BIG_SPEC`, saw and turret positions in `robotLegs.ts`), with eyes, saws
   and lenses drawn apart. Rebuild them with `art-refs/robot-reference/` to hand (Keith's PC), keeping those anchors;
   until then leave them. Drones (`src/summon/dronesDraw.ts` `frameGeometry`) and the scrap swarm can go with them.
3. Crusher, strider; war band vehicles; second pass on the kit weapons (`docs/asset-pipeline.md`).

## How to test
- Shots here: `npm run build`, then `CHROME=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome node tools/shots.mjs "<lab url>"`.
- Keith's PC is off until about 2026-11-16: no reference art, no `wkit.py`, no GPU lane.
