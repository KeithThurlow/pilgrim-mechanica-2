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

- Stage 4.3b, health bars from the world (Claude 2026-11-07; Keith "please continue", relayed): new `Bar` component
  (width, lift, always; cosmetic) and robots' `Armour.flat`, written in `RobotSwarm.publish`; `src/game/entityBars.ts`
  `gatherBars(world, team, out)` pushes a bar for every entity with Transform, Health, Team, Armour and Bar off the
  viewer's team; `HealthBars` takes the host world (combat labs, convoy lab). `RobotTarget.bars` only covers a swarm in a
  world of its own (`RobotBlock.own`). Keys are entity ids. Also fixed from 4.3: the convoy lab's camp swarm
  (`swarmCamps.ts`) and the stress lab's now use the host world too. Checked: robotworld-check compares every bar with
  the old adapter's, every tick. Targeting (the soft lock) reads the register, which robots fill from their columns.

- Stage 4.4, infantry in the world (Claude 2026-11-07): the swarm-block code shared by both kinds is
  `src/ecs/swarmBlock.ts` (`SwarmBlock`: reserve, views of Transform, PrevTransform, Velocity, Health, Status, Team,
  Collider, Armour; link, unlink, relink, keepPrevious, publish); `RobotBlock` extends it. `InfantrySwarm(v, ground, seed,
  world?)` keeps its px, py (Transform.y: the feet), pz, heading, vx, vz, hp, pace, state, stateTime, look, uid, frozen as
  views (`src/combat/infantryWorld.ts`, new `Infantry` component); Health.max is the spawn health. Entities from spawn to
  death (downed bandits are alive). Bandits, war band riders, humans' camps, fortress garrisons, the range's runners and
  the stress lab's bandits use the host world. `rules.world` grew to 16 swarms (20480). Checked: a scripted fight of
  robots and bandits in one world hashes the same as main (9d26da88); `tools/infantryworld-check.ts`; full `npm test`;
  the bandit, war band, convoy (bandit camp, fortress), weapons (runners) and stress labs load headless clean.

- Stage 5 proposal (Claude 2026-11-07; Keith "continue re-architecting as you see fit", relayed: build without
  waiting). Heavies keep their object sims (review §4.1); each becomes an entity in the host world through
  `src/ecs/heavy.ts` (`HeavyLink`: Transform, PrevTransform, Health, Team, Collider, Armour, Bar, and the `Sim` object
  component holding the thing), written each tick by `Hittable.syncWorld` (CombatRules.syncWorld, end of the rules'
  step; a target that leaves the list gets `leaveWorld`). Readers move over as each kind lands: its health bars first
  (`gatherBars`), so its own `bars()` goes. Order, one PR each: 5a mechs (MechUnit: player, rivals, guardians,
  replicas, bandit mechs), 5b vehicles (war band cars, the party bus, escorts), 5c crushers and striders. Later, when a
  co-op peer needs it: MechUnit split into a sim without three and a render system (the review's 5 "L" part), so the
  host world can step in the worker (stage 7).
- Stage 5a, mechs (Claude 2026-11-07): `MechUnit.link` (HeavyLink), `syncWorld`/`leaveWorld`; its health bar comes from
  the world (MechUnit.bars gone). Bars now sit where the mech was at the end of the rules' step (at most a tick
  behind the old live pelvis). `tools/heavy-check.ts`.
- Stage 5b, vehicles (Claude 2026-11-07): war band raiders (`Raider`: cars, trucks, the party bus, War Rig) and the
  weapons lab's range trucks (`RangeCar`) sync through HeavyLink; their bars come from the world. Escorts aren't
  targets (nothing shoots them), so they get no entity yet. heavy-check runs a war band.
- Stage 5c, crushers and striders (Claude 2026-11-07): `HeavyPack` (src/ecs/heavy.ts) keeps a HeavyLink per unit
  behind a pack adapter (`CrusherTarget.heavies`, `StriderTarget.heavies`); their bars come from the world. Stage 5's
  entity part is done: every enemy and mech on a battlefield is an entity with Transform, Health, Team, Collider,
  Armour (and Bar). Still pushing their own bars: props and POIs (dummies, the test swarm, gates, towers, fabricators,
  spawners). Not done from the review's stage 5: MechUnit split into a three-free sim and a render system.

## Next, in order
- The 60 Hz tick is the only clock (Keith 2026-11-07). Left: the tool labs (terrain, parts, armoury, inventory, pose,
  stress) move their camera in the tick; split them like the walker lab when it matters. Still per tick: droids'
  visors and lasers, crusher and strider fx.
- Stage 4.3b, more readers onto the components: the robots' register publish could become a world system over
  `Robot` + `Transform` + `Collider` once Collider is written by the sim (today publish computes it); the worker's robot
  snapshot becomes `packWorld` columns of the swarm's block (stage 7).
- Stage 7 (the host world in the worker): proposal `docs/proposal-stage7.md`, steps 7a (one snapshot format), 7b
  (infantry in the worker), 7c (MechUnit split; wants Keith to play-test), 7d (the rules in the worker), 7e (retire the
  remotes). Then stage 8, co-op transport.

## Facts
- The labs' tick bodies run 0-4 times a drawn frame (60 Hz); what's seen is drawn between ticks (6b-6e). Fx still step
  in the tick in places (above).
- Hit-stop (`src/game/hitStop.ts`) still scales the sim's dt; to move to presentation in stage 6.
