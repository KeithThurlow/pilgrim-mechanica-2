# Handoff: the architecture migration (started 2026-11-07)

Plan: `docs/architecture-review.md` (§5 stages, §4 target, §4.6 rates and threads). Keith 2026-11-07: sim at 30 or 60 Hz,
drawn as fast as the graphics allow (144+, ideally 200+), interpolated; don't wait on him; one PR per stage, merged when
`npm test` passes, each with a play checklist; big behaviour changes behind a flag.

## Done
- Stage 1, one clock: `src/core/clock.ts` (fixed or frame-locked; `run(raw, fn)`, `alpha`, `every(n)`), `App.clock`,
  `?tick=N`; `tools/clock-check.ts`. Default still frame-locked: a fixed tick judders until drawing interpolates (stage 6).

- Stage 2, the ECS core: `src/ecs/world.ts`, `components.ts`, `snapshot.ts`; `tools/ecs-check.ts`. Component definitions
  hold no data (`world.columns(C)`, `world.objects(C)`), so two worlds can live in one thread (parity checks, ?noworker).

- Stage 3a: `src/game/combatRules.ts` (blasts, shells, craters, cover, canSee, solids, register; `blast`/`lob` events);
  Battlefield delegates and plays events (`playEvents`, `playBlast`). Craters by count per tick (`dentPerTick`).
  `tools/combatrules-check.ts` also guards the rules' run-time imports (no fx/audio/look/ui, no *Draw/*Body).

- Stage 3b: the rules own and step shots, burns, pools, chills (order kept); `freeze` event; Battlefield plays draws and
  lists. `src/core/rng.ts`; mechUnit and arsenal spread, war band spawns/runs/rings/turret clocks/spread seeded.

- Stage 4.1: `rules.world`, `rules.syncWorld()` (end of `rules.step`) calls `Hittable.syncWorld?`; `RobotTarget` →
  `src/combat/robotEntities.ts` over `src/ecs/slots.ts`; `tools/robotentities-check.ts`. Known: a RobotTarget taken out
  of `targets` leaves its entities in the world (no target is removed today).

- Stage 6a (done early, it unblocks interpolation): `App.onFrame`; `Battlefield.tick`/`frame`; the convoy lab and
  `combatLab.ts` run camera, streaming, light and `bf.frame` per drawn frame. Still per tick in those labs: the unit
  bodies' posing (mech `body.update`, robotsDraw, infantryDraw...) inside their sims' updates.

- Stage 6b: `src/look/treeInterp.ts` (capture after each tick, apply(alpha) per frame, restore after render via
  `App.onAfterRender`); used for the player's Rampart and the camera focus in the convoy lab and `combatLab.ts`, only
  with `?tick=N`.
- Stage 6c: `drawBetweenTicks(root)` + `InterpSet` (same file), run by `createApp` (`App.interp`) under `?tick=N`: the
  Rampart, walker stand-in, car, escort, crusher, strider, pilot, platform and crane bodies register themselves. Parts
  posed outside the tick are skipped (compared against the captured pose). New model kinds: wrap the root in
  `drawBetweenTicks` where it's built.
- Stage 6d: `SlotInterp` + `drawEachFrame` (same file); `RobotsDraw.update` under `betweenTicks()` only registers
  (first call) and the app draws it per frame with the arrays blended in place (restored at once after the draw).
- Stage 6e: `InfantryDraw` the same, through the shared `swarmBetweenTicks`.

## Next, in order
- The 60 Hz default: waiting on Keith (decision card 2026-11-07: flip now, or after he has played `?tick=60`). Then
  flip `clockFromUrl` (src/core/clock.ts) to 60 with `?tick=0` for frame-locked, after a stress-lab comparison
  (`labs/stress/?run` with and without `?tick=60`). Left per tick under the fixed clock: droids' visors and lasers,
  crusher and strider fx, dust and other fx that step in the tick (they're drawn per frame by bf.frame).
- Stage 4, re-planned (Claude 2026-11-07): skip 4.2 as its own step. Moving readers onto a mirror that is synced at the
  end of `rules.step` adds a one-tick-stale copy and no gain; the readers move when the swarm owns its state in the
  world (4.3). 4.3 is a big build (rule 9): propose it to Keith before starting. Outline:
  - A world with a fixed capacity per kind (ROBOT_MAX is fixed), so columns never get replaced and the swarm's arrays
    can be `subarray` views of its slice of the columns (Transform.x/z/heading, Health.hp/max...). Today the world
    grows by replacing columns (`World.columns` after `create`), which breaks views: add `new World({ capacity })`.
  - Slot index = entity index within the swarm's slice (a range of entity indices reserved per swarm), generations
    from the swarm's `gen`; `RobotEntities` and the sync go; robots-check and robotworker parity unchanged.
  - Then the register's robot owner, targeting and health bars read the components; the worker's robot snapshot
    becomes `packWorld` columns (stage 7).
  - Then infantry the same way.
- Stages 5 heavies, 7 host world in the worker, 8 co-op transport (review §5).

## Facts
- Under `?tick=N` the labs' tick bodies run 0-4 times a frame; what's seen is drawn between ticks (6b-6e). Fx still step
  in the tick in places (above).
- Hit-stop (`src/game/hitStop.ts`) still scales the sim's dt; to move to presentation in stage 6.
