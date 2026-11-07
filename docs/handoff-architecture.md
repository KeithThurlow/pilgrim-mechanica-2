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

## Next, in order
- Stage 4, the robot swarm onto the ECS, strangler-style (each step its own PR, robots-check and robotworker parity
  unchanged at every step):
  - 4.1 A host `World` as a rules resource (`rules.world`) and a sync system: each live robot slot gets an entity (by
    uid, kept while it lives), Transform, PrevTransform, Health, Team, Collider written from the swarm's arrays each
    tick. Nothing reads them yet. Check: the components equal the swarm's arrays every tick of a camp fight.
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
