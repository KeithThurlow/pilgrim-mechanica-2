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

## Next, in order
- Stage 3b: move into the rules the rest of the damage path: `resolveShots` (Shots already writes events and draws:
  the rules keep events and damage, Battlefield plays the draws), `stepBurns`/`stepPools`/`stepChills` (damage and
  pace in the rules, flames, mist and freeze cracks as events), `sheetHits`/`resolveSheet`. Then the mechs' spread
  (`mechUnit.ts`, Math.random before a ShotCmd) from a seeded stream. Check: rules-check extended; shots-check,
  fire-check, chill-check unchanged.
- Stage 3, damage as data (split `Battlefield`), then 4 crowds, 5 heavies, 6 60 Hz default + interpolation, 7 host world
  in the worker, 8 co-op transport.

## Facts
- Labs' tick bodies mix sim and drawing; with `?tick=N` the whole body runs per tick (0-4 times a frame). Splitting each
  lab's body into a sim tick and a per-frame draw comes with stage 6.
- Hit-stop (`src/game/hitStop.ts`) still scales the sim's dt; to move to presentation in stage 6.
