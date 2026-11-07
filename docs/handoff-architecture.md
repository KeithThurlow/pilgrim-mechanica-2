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

## Next, in order
- Stage 6e: infantryDraw and the droids the same way as 6d (a SlotInterp over the arrays the drawer reads, the
  drawer on `drawEachFrame`, its `update` only setting up under `betweenTicks()`); the bandit VAT animation time too.
  Then flip the default to `?tick=60` (clock.ts `clockFromUrl`), with `?tick=0` for frame-locked, after a stress-lab
  comparison.
- Stage 4, the robot swarm onto the ECS, strangler-style (each step its own PR, robots-check and robotworker parity
  unchanged at every step):
  - 4.2 Readers move to the components: the register's robot owner, targeting, health bars, then `robotsDraw`
    (interpolating with `drawnAt` once stage 6 lands).
  - 4.3 The swarm writes the components itself (its x/z/heading/hp arrays become views of the columns, or the swarm
    keeps slot-indexed private state only); the sync goes. The worker's robot snapshot becomes `packWorld` columns.
  - Then infantry the same way.
- Stages 5 heavies, 6 60 Hz default + interpolation, 7 host world in the worker, 8 co-op transport (review §5).

## Facts
- Labs' tick bodies mix sim and drawing; with `?tick=N` the whole body runs per tick (0-4 times a frame). Splitting each
  lab's body into a sim tick and a per-frame draw comes with stage 6.
- Hit-stop (`src/game/hitStop.ts`) still scales the sim's dt; to move to presentation in stage 6.
