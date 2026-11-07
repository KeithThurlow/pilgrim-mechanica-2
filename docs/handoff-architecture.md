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
- Stage 4.3 (Claude 2026-11-07; Keith 2026-11-07 "continue re-architecting as you see fit", relayed by the coordinator,
  counted as the go-ahead for this proposal):
  - Proposal: the swarm's state lives in the world, one copy. `new World({ capacity })` is fixed (never grows, so
    columns stay put); `world.reserve(n)` hands a pool n contiguous entity indices that `create` never uses;
    `createAt(index)` / `destroy` make and end the entity there (the index stays the pool's, next generation).
    `RobotSwarm(v, ground, seed, world?)` reserves ROBOT_MAX in the host's world (`rules.world`, room for 8 swarms +
    4096; the front's and the summoner's allies' swarms use it) and its shared arrays are `subarray` views: Transform
    (px, hubY, pz, heading), Velocity, Health (hp, maxHp), Status.pace, and a new `Robot` component (kind, state,
    stateTime, size, variant, weapon, uid, frozen). The AI's own clocks and the leg arrays stay swarm arrays (opaque sim,
    review §4.1). Entity lives from spawn to death (hooks in `spawn` and `setState`); PrevTransform copied at the start
    of `update`; Team and Collider written in `publish` (they need the publisher's team and sliders). Snapshots into the
    worker's view `relink`. Without a world, or with no room, a swarm makes its own world (a warning once).
  - Built: `src/combat/robotWorld.ts` (`RobotBlock`, `Robot`), `src/ecs/world.ts` (capacity, reserve, createAt, at,
    attach), `robots.ts` (views, hooks), `robotsRemote.ts` (relink). `RobotEntities`, `src/ecs/slots.ts` and the robots'
    `syncWorld` are gone. `tools/robotworld-check.ts` replaces robotentities-check.
  - Behaviour: identical. A scripted camp fight (2400 ticks, spawns, damage, removals) hashes every snapshot array the
    same before and after (7d39aee7), in the swarm's own world and in a shared one; robots, robotworker, allies checks
    unchanged.
  - Known: blocks are never given back; a lab that makes more than 8 swarms over its life (field rivals with summoner gear,
    one each) has the extra ones fall back to worlds of their own (still correct, just outside the host world).

## Next, in order
- The 60 Hz tick is the only clock (Keith 2026-11-07). Left: the tool labs (terrain, parts, armoury, inventory, pose,
  stress) move their camera in the tick; split them like the walker lab when it matters. Still per tick: droids'
  visors and lasers, crusher and strider fx.
- Stage 4.3b, readers onto the components: the register's robot owner, targeting and health bars query the world
  (`Robot`, `Transform`, `Health`) instead of the swarm's arrays (today they read the same memory through the swarm). Then
  the worker's robot snapshot becomes `packWorld` columns of the swarm's block (stage 7).
- Stage 4.4: infantry the same way (`InfantrySwarm` reserves a block; its arrays become views).
- Stages 5 heavies, 7 host world in the worker, 8 co-op transport (review §5).

## Facts
- The labs' tick bodies run 0-4 times a drawn frame (60 Hz); what's seen is drawn between ticks (6b-6e). Fx still step
  in the tick in places (above).
- Hit-stop (`src/game/hitStop.ts`) still scales the sim's dt; to move to presentation in stage 6.
