# Proposal: one register and spatial grid for "what's near here?"

Status: **approved by Keith 2026-10-26; steps 1, 2 and 3 built** (2026-10-26). Step 3 was built differently from
its plan: see "Step 3 as built". Steps 4-6 not started.

## As built (steps 1-2)

What changed from the sketch below while building it:

- `src/game/register.ts` (pure). Columns: `x y z` (centre of mass), `r` (body radius), **`foot`** (a walker's footprint,
  0 if none: the soft lock's "cursor among its feet"), **`vx vz`** (ground velocity, for leads), `kind team flags owner
  index id`. `KIND`, `FLAG` and `kindBit` are plain objects (no `const enum`: the build is `isolatedModules`).
- **Ids** (rule 12): `owner number * 2^32 + serial`. The owner number is the order owners were added (`add()` returns
  it; the host adds them in a fixed order); the serial is the owner's own, handed out at spawn and never reused
  (`RobotSwarm.uid`, `InfantrySwarm.uid`; `ObjectSerials` for object owners: a new serial per life, so a respawned
  dummy or a reused bandit mech is a new id). `find(id)` gives this tick's entry or -1.
- `Filter` also has `none` (flags it must not have), e.g. `{ all: Hittable, none: Asleep }`.
- Queries (each measures entries by body, footprint or hit reach: `MEASURE`, added in step 3): `near(x, z, R, f, out, measure?)`, `nearest(x, z, maxR, f)` (centre distance, searches outward doubling),
  `ray(ox, oz, dx, dz, len, width, f, hits)` (**flat**, swept `width` each side; `RayHits` in order along the line with
  `t0`, `t1` and `chord(k)`: the line query step 3 needs), `cone(x, z, dx, dz, range, width, halfAngle, f, out)`
  (centre ahead within `r + width + t tan(halfAngle)`), `each(f, fn)`. The 3D tests (a camera ray, a round's height)
  stay with the caller on the candidates the flat queries hand back.
- The grid walks a line or cone one column of cells at a time along its major axis (each cell once), and falls back
  to a straight scan when the shape covers more cells than there are entries (the radar's big disc).
- Owners: `RobotSwarm.publish(reg, team)`, `InfantrySwarm.publish(reg, team)`, `Warband.publish(reg)` (raiders as
  vehicles, bandit mechs as mechs), `src/game/registerOwners.ts` for object lists (`listOwner`, `mechOwner`: the
  player's mech, the range's dummies and trucks). `MechUnit` and `Dummy` didn't get a `publish()` of their own (other
  agents' files); the helpers do it from outside.
- `Battlefield.register` holds it; the combat-lab shell and the convoy lab rebuild it at the top of each frame (before
  the soft lock: positions as last drawn), as a "register" cost stage. Not inside the 120 Hz sub-steps.
- Step 2: `Targeting.pick(reg, filter, query, values)`; `SoftAim.pick(mouse, reg, filter, from, values)`;
  `CombatLab.targets` is gone, `CombatLab.enemies` (a filter: `enemiesOf(player.team)`) replaces it; every lab
  (robots, bandits, war band, weapons, loadout, stress, convoy) adds owners instead of writing a list. The arsenal
  still takes a `candidates()` list (now `EntryList`: built once per rebuild, however often it's asked) and gets
  `findTarget(key)` (an id lookup), so a missile tracking its target no longer rebuilds the list each frame.
  `planStrip` and `swarmAims` keep their list for now (one list a tick is cheap; moving them to `near` is a small
  follow-up in the weapons files).
- `robotCandidates` (`src/combat/robotTarget.ts`) was left unused in step 2 and deleted in step 3.

Measured (`tools/targeting-check.ts`, node on the agent box, 2,039 entries: 1,020 robots and 1,020 bandits): rebuild
0.24 ms, `near` r = 3 m 3 µs, a 200 m `ray` through the swarm 8 µs (25 crossed). The stress lab shows the rebuild as
its own stage and the queries as "inside the above: register queries" (with counts of entries and queries).

Keith 2026-10-26, on whether to move to an ECS: no ECS library now. Swarms, particles and projectiles are already flat
typed arrays drawn instanced. The weakness is that every system answers "what's near here?" on its own. Keith: "that
shared register and spatial grid ... sounds like something we should maybe start on." The stress numbers that go with
this are in `docs/perf-2026-10-26.md`.

## What the register is for

Not speed first. At today's counts a linear scan over 2,500 things costs about 13 µs, and the two swarms already keep
their own spatial hashes for separation. The register is about **structure**: one place that knows every thing that can
be hit, seen, salvaged or woken, so that

- a new kind of thing (escorts, turrets, the pilot on foot, farm mechs, drones) is added once and every query sees it;
- splash, stomp, shove, soft lock, the radar and the turrets stop needing a hand-written adapter per lab;
- the queries that do multiply (each swarm unit asking for neighbours, each round, each missile each frame) get a grid
  without each system building its own.

The speed it does buy is where queries repeat: the missile swarm rebuilding the whole target list per missile per frame,
every round scanning every bandit and every robot, the convoy turrets and the radar scanning all robots, the war band's
O(n²) avoidance.

## Every place that finds nearby things today

| What | Where | How it finds things now |
| --- | --- | --- |
| Soft lock (guns) | `src/game/combatLab.ts` tick → `lab.targets()` → `Targeting.pick` (`src/game/targeting.ts`) | Each lab builds a fresh `TargetCandidate[]` (an object per live enemy) every call; `pick` scans it twice (cursor ray, line of fire) |
| Demo aim | `combatLab.ts` `demo()`; `labs/stress/main.ts` `demo()` | Nearest of `lab.targets()`, linear |
| Rounds | `Battlefield.fire` (`src/game/battlefield.ts`) | Loops `bf.targets` (Hittables); each swarm adapter's `hitRay` scans **every unit** linearly: `InfantrySwarm.hitRay`, `RobotSwarm.hitRay` (`src/combat/infantry.ts`, `robots.ts`); `MechUnit.hitRay`, `Raider.hitRay`, `Dummy.hitRay` one each |
| Splash (rounds) | `Battlefield.fire` splash option → `Hittable.splash` | `RobotTarget.splash`, `InfantryTarget.splash` linear over all units; `MechUnit.splash`, `Dummy.splash` |
| Blasts | `Battlefield.blast` (shells, rockets, missiles, mortars) | Same `splash()` path over every Hittable; `queueDent` merges against the dent queue linearly |
| Stomp | `MechUnit` footfall → lab's `player.onStomp` → `RobotSwarm.stomp`, `InfantrySwarm.stomp` | Linear over every unit |
| Shove on dash | `player.onDash`: `labs/robots/main.ts` (inline loop), `InfantrySwarm.shove`, `SwarmCamps.dashed` (`src/expedition/swarmCamps.ts`) | Linear over every unit; written three times |
| Robot clinging and attacks | `RobotSwarm.update` (`claimSlot`, latch ring, leap, saw `CUT`) | Knows only the one target passed in (the mech); separation through its own hash `buildHash`/`near` |
| Bandit separation | `InfantrySwarm.update` (`buildHash`, `near`) | Its own counting-sort hash (4096 buckets), rebuilt every update |
| Robot separation | `RobotSwarm.update` (`buildHash`, `near`) | Its own counting-sort hash, same code again |
| War band | `Warband.drive` (`src/combat/warband.ts`) | Each raider loops every other raider (O(n²)) to keep clear; targets only the player; `walkMech` the same |
| Radar contacts | `SwarmCamps.contacts` → `radarPicture` (`src/expedition/radar.ts`) | Linear over every robot, then `radarPicture` filters POIs, blobs and fog by distance, `inFog` linear over unknowns |
| Camps and unknown areas | `CampField.campsNear`, `unknownNear`, `hidden` (`src/expedition/camps.ts`) | Its own coarse grid (one camp per cell) |
| Camps waking | `SwarmCamps.update`, `noise` | Distance to each live camp's centre, which is re-averaged over its robots every call |
| Salvage prompts | `SalvageSim.nearest`, `update` (`src/pois/salvage.ts`); `FieldSites.poisIn` (`src/expedition/sites.ts`) | Linear over every spot; POIs by box from the POI field |
| Turret targeting | `Defence.update` (`src/convoy/defence.ts`) ← `ExpeditionLoop.turretThreats` ← `SwarmCamps.threats` | Threats: linear over awake camps' robots, a new `Vector3` each; each turret then scans the threats |
| Demo in the field | `ExpeditionLoop.demoField` (`src/expedition/loop.ts`) | Nearest awake robot, linear |
| Missile swarm | `Arsenal.stepShoulder` → `swarmAims` (`src/weapons/swarm.ts`); per-missile `track()` | `swarmAims` filters and sorts all candidates; **`track()` calls `candidates().find()` for each missile every frame**, rebuilding the lab's whole target list each time |
| Line mortar snap | `planStrip` (`src/weapons/salvo.ts`) | All candidates, linear, every frame the key is held |
| RPG and rockets | `Rockets.update` (`src/weapons/rocket.ts`) | Every step: `hitRay` on every Hittable (so every unit) for early detonation |
| Autocannon shells | `CannonShells.update` (`src/weapons/autocannon.ts`) | Same, per shell per step |
| Rail beam | `railFire` (`src/weapons/rail.ts`) | `hitRay` on every Hittable per path segment |
| Water wakes | `labs/robots/main.ts`, `labs/bandits/main.ts` (a sixth of the swarm a frame), `Warband` wheels | `bf.inWater` per unit (a ground sample each) |
| Deaths | `DeathPhysics.follow`, `step` (`src/physics/deaths.ts`) | No query of the living; Rapier's own broadphase for the dead; the floor follows the mech |
| Enemy line of sight | `Battlefield.canSee` | Marches the ground every 1.5 m per shot (a ground query, not a neighbour query: out of scope) |

Three separate hashes or grids exist (robots, bandits, camps), five `splash`/`hitRay` adapters, three dash shoves, and
every lab writes its own `targets()`.

## The register

One module, `src/game/register.ts` (pure, no Three.js), plus one small adapter per owner system.

### Data

Structure of arrays, one slot per entity, rebuilt from the owners each sim tick (the owners' typed arrays stay the
source of truth; the register copies position and radius in and indexes them, it never runs behaviour):

```ts
export const enum Kind { Unit = 0, Vehicle = 1, Mech = 2, Prop = 3, Salvage = 4, Poi = 5 }
export const enum Flag { Hittable = 1, Detectable = 2, Salvageable = 4, Light = 8 /* rounds pierce */, Asleep = 16 }

/** Who owns an entry: a swarm, the war band, the salvage sim... Each owner answers for its own indices. */
export interface Owner {
  readonly id: number;                 // set by the register
  readonly name: string;               // "robots", "bandits", "warband", "salvage", ...
  /** Write this tick's entries: reg.put(kind, x, y, z, r, team, flags, index) for each live thing. */
  publish(reg: Register): void;
  /** Exact tests the grid can't do (shape, legs, pierce), on candidates the grid hands back. */
  hitRay?(index: number, o: Vec3, d: Vec3, maxDist: number): number;
  splash?(index: number, at: Vec3, radius: number, damage: number, dir: Vec3): boolean;
  damage?(index: number, amount: number, at: Vec3, dir: Vec3): boolean;
  /** Velocity for leads (soft lock, autocannon, mortar). */
  velocity?(index: number, out: { x: number; z: number }): void;
}

export class Register {
  // per entry
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array; readonly r: Float32Array;
  readonly kind: Uint8Array; readonly team: Uint8Array; readonly flags: Uint8Array;
  readonly owner: Uint8Array; readonly index: Int32Array; // back into the owner's arrays
  count: number;

  constructor(cell = 4, max = 8192);
  add(o: Owner): void;
  /** Once per sim tick: every owner publishes, then the grid is rebuilt (counting sort, like the swarms' hashes). */
  rebuild(): void;
  put(kind: Kind, x: number, y: number, z: number, r: number, team: number, flags: number, index: number): void;

  // queries: results are entry numbers into the arrays above (no objects), into a caller's array
  near(x: number, z: number, r: number, f: Filter, out: number[]): number[];
  nearest(x: number, z: number, maxR: number, f: Filter): number;            // -1 if none
  ray(o: Vec3, d: Vec3, maxDist: number, f: Filter, out: RayHit): boolean;  // grid walk, owner.hitRay exact, nearest
  cone(from: Vec3, dirX: number, dirZ: number, range: number, halfAngle: number, f: Filter, out: number[]): number[];
  each(f: Filter, fn: (e: number) => void): void;                           // radar, everything of a kind
  /** Stable key for an entry while its thing lives (owner, index, the owner's generation). */
  key(e: number): number;
}

/** What to include: kinds and flags it must have, and a team to leave out (or to keep). */
export interface Filter { kinds?: number /* bit per Kind */; all?: number /* flags */; notTeam?: number; team?: number }
```

- **Grid:** a uniform grid of 4 m cells, hashed into 4,096 buckets, rebuilt by counting sort every tick (the code the
  robot and bandit swarms already use, shared). Things wider than a cell (vehicles, POIs, the big excavators) go on a
  short "big" list every query also checks. One grid for all kinds; the filter skips by kind and flags. If one kind
  ever dominates a query (the radar over a 150 m disc), a second grid with bigger cells for POIs and camps is the first
  thing to add, not before.
- **Rebuild per tick**, not incremental: the swarms move every unit every tick, so incremental updates would touch every
  entry anyway, and a rebuild has no stale state to get wrong.
- **Keys:** `owner << 24 | index`, plus the owner's generation counter (the swarms already keep `gen[]`) so a lock or a
  missile's target doesn't jump to a new unit reusing a dead one's slot.
- **What stays with the owners:** behaviour, shapes, state machines and their own hashes for separation (those run
  inside the 120 Hz sub-steps; step 6 below can move them over once the register is proven).

### Cost (measured)

Headless microbenchmark (node, this box, a prototype of the grid above; `docs/perf-2026-10-26.md` has the setup):

| Entities | Rebuild | Copy in from the swarms | near r=3 | near r=8 | ray 60 m (candidates) | linear scan, for scale |
| --- | --- | --- | --- | --- | --- | --- |
| 2,500 (1,000 robots, 1,000 bandits, 40 vehicles and mechs, 350 props and salvage) | 0.16 ms | 0.01 ms | 4 µs | 5 µs | 13 µs | 13 µs |
| 5,000 | 0.28 ms | 0.02 ms | 2 µs | 4 µs | 13 µs | 14 µs |

Once per frame that is 0.2-0.3 ms at the stress counts, about 2% of the 16.7 ms budget; most of it is clearing the
4,096 buckets, so it barely grows with the count. For comparison, one round through `InfantrySwarm.hitRay` over 1,000
bandits is 9 µs today, and the stress lab's single biggest cost (the dust's ground lookups) is 40-60 ms headless. The
register is not where the frame goes; it is cheap enough to add without thinking about it.

## Moving the callers over, one step at a time

Each step ships on its own and leaves every lab working. Old paths are deleted in the same step that replaces them.

1. **The register and the swarms publish** (no caller changes). `src/game/register.ts`, `tools/register-check.ts`
   (near, nearest, ray and cone against brute force on random layouts; keys survive slot reuse; big entries found).
   `RobotSwarm`, `InfantrySwarm`, `Warband` (raiders and bandit mechs), `MechUnit`, `Dummy` get `publish()`.
   `Battlefield` owns the register and rebuilds it at the top of each tick; the stress lab shows its cost as a line.
2. **Targets and soft lock.** `lab.targets()` disappears: `Targeting.pick` takes the register and a filter (hittable,
   not my team) and uses `cone` for the line of fire and `ray` for the cursor. The arsenal's `candidates` callback
   becomes the register, so the missile swarm's `track()` is a key lookup (no list rebuild) and `swarmAims`,
   `planStrip` use `near`. Every combat lab loses its hand-written `targets()`.
3. **Rounds, splash, blasts.** `Battlefield.fire` walks `ray` and calls the owner's exact `hitRay` on candidates only;
   `splash` and `blast` use `near` and call the owner's `splash(index)`. The `RobotTarget`/`InfantryTarget` adapters
   shrink to the per-index tests. Rockets, autocannon shells and the rail beam use the same `ray`.
4. **Stomp and shove.** One `bf.shove(x, z, r, dir, ...)` and `bf.stomp(...)` over `near`, calling the owners; the three
   dash shoves (robots lab, bandits lab, swarm camps) become one.
5. **The field: radar, turrets, camps, salvage.** Salvage spots and POIs publish (kind Salvage/Poi, flag Salvageable);
   `SalvageSim.nearest` becomes `nearest(..., {all: Salvageable})`. `SwarmCamps.contacts` and `threats` become `near`
   with the Detectable flag (no `Vector3` per threat); the turrets pick with `nearest`. Camps stay on their own coarse
   grid (they are streamed world data, not live entities) but their sleeping robots carry the Asleep flag so waking is
   a `near` from the noise.
6. **Separation (optional, later).** If having two swarm hashes still costs us changes, the swarms read neighbours
   from the register instead; this needs the register rebuilt inside the 120 Hz sub-step, so only if step 1-5 numbers
   say it's cheap enough. The war band's O(n²) avoidance moves to `near` here too.

Water wakes and `canSee` are ground queries, not neighbour queries; they stay as they are.

### Step 3 as built (2026-10-26): every hit test culled by the grid

The plan below (kept for the record) moved the exact tests to per-index owner calls from `Battlefield`. Built instead,
because it needed no change at any caller (fire, the sheet, rockets, autocannon shells, the rail, splash, blasts all go
through the `Hittable` adapters) and left the rail gun agent's sheet and penetration code as it was:

- **The swarm adapters cull themselves.** `RobotTarget` and `InfantryTarget` are register owners (`bf.register.add(
  target)`; labs do this instead of a `publish` wrapper). Once added, their `hitRay`, `sheet` and `splash` ask the
  register (`SwarmCull` in `register.ts`: `segment`, `line`, `round`) for their own units whose **hit reach** the shot
  could touch, widened by `reg.slack` (2 m: they moved since the rebuild), and test only those
  (`RobotSwarm.hitRay` / `InfantrySwarm.hitRay` take an `only` list). Not added (headless checks): every unit, as before.
- **Hit reach** is a third size per entry (`MEASURE.Reach`): robots publish the sphere their own tests reject with (a
  walker's legs and arms: height × 1.3 + size), raiders their capsule's half-length + radius, mechs their capsule,
  range trucks the longest truck. Entries reaching past 8 m (excavators, war rigs) sit on the big list.
- Robots that are **down** are published too (still hittable), flagged `FLAG.Down`; the soft lock's `enemiesOf` leaves
  them out, so the lock is unchanged.
- **Objects in the sheet's ray fan** (raiders, mechs, dummies, trucks): `sheetHits` asks the register once for what
  the sheet's line comes within reach of; an object the register holds (`reg.published(obj)`, entries tagged with
  their object by `ref`) but the line doesn't reach is skipped before its 15 rays.
- `robotCandidates` is deleted.
- Penetration is untouched: `sheet.ts` already walks the hits in order with chords; the swarms' own sheet tests give
  the exact chord through each body, which the register's circle chord would only approximate.

Measured (`targeting-check`, node, 1,010 robots + 1,000 bandits, medians on a shared box): a minigun sheet or an enemy
round that passes **beside** the crowds costs 4 µs culled against 10-33 µs testing every unit; one **through** the
robot crowd costs about the same either way (50-90 µs; the exact leg tests on the walkers it actually crosses
dominate). On twin swarms moved after the rebuild, 800 culled rounds and 800 culled sheets hit exactly what full scans
hit, 40 blasts damage exactly the same units, 200 sheets over 60 capsule objects find the same hits with and without
the cull.

Still open from the plan: `bf.targets` stays (wrecks and the pilot on foot aren't published; `Battlefield.fire`'s
enemy-round loop still calls every target's `hitRay`, which for the swarms is now culled and for objects is one
capsule each); through-the-crowd shots could get cheaper only by cheaper exact tests on walkers (a body-only first
pass), not by the grid. Steps 4-6 as planned.

### Step 3 as first planned: rounds and blasts on the line query

Keith 2026-10-26: direct fire is a vertical sheet along its line, and penetration is measured as distance through
bodies and terrain (`src/game/sheet.ts`, `src/game/sheetFire.ts`, `Battlefield.fire`'s `sheet` option). The swarms
already answer per unit; vehicles, mechs, the pilot and wrecks are tested with a fan of 15 rays through the sheet's
height. The register's `ray` is that sheet seen from above:

1. **Candidates in order.** `Battlefield.fire` asks `reg.ray(muzzle.x, muzzle.z, d.x, d.z, flatRange, sheetHalfWidth,
   { all: Hittable, notTeam: team }, hits)`: every body whose footprint the line crosses, sorted by where the line
   enters it, with the chord through it (`t1 - t0`). The sheet's height is not in the flat query: a body is in the
   sheet if its height band overlaps the sheet's at `t0..t1`; add a `top` column (or `y` and a half-height) to the
   register when the sheet needs it, rather than testing per owner.
2. **Penetration as distance.** Walk the hits in order with the round's remaining penetration: each body costs its
   chord × its material's density (light bandits and small robots little, steel walkers and vehicles a lot); terrain
   between hits costs from the ground march `sheet.ts` already does over the same t range. Stop when it runs out; the
   last body takes the round's remainder. No ray fan: one flat query replaces the 15 rays for vehicles, mechs, the
   pilot and wrecks.
3. **Exact tests stay with owners, on candidates only.** Where shape matters (a walker's legs vs its body, a hull's
   capsule), the owner gets `hitRay(index, o, d, maxDist)` / `hitSheet(index, ...)` for that one entry; damage is
   `owner.damage(index, amount, at, dir)`. `RobotTarget` and `InfantryTarget` shrink to these per-index tests (their
   whole-swarm loops go); `robotCandidates` is deleted.
4. **Splash and blasts.** `Battlefield.blast` and round splash use `near(x, z, radius, ...)` and call the owner's
   `splash(index, ...)` per entry (`RobotTarget.splash`'s and `InfantryTarget.splash`'s loops over every unit go).
5. **Rockets, autocannon shells, the rail slug.** Each step's segment is a short `ray` (the swept width = the shell's
   radius) instead of `hitRay` on every Hittable.
6. Owners not yet in the register for rounds: wrecks (steel stand-ins: kind Prop, static, published once per rebuild
   like the dummies) and the pilot on foot (kind Unit, team 1). Both are needed before `bf.targets` can go.

Checks for step 3 (in `weapons-check` / `targeting-check`): the line query against brute force with chords (already
in `targeting-check`), a sheet through a crowd stopping where its penetration runs out, the same hits as the ray fan
on vehicles and mechs.

## How it would grow into an ECS, if the numbers ever ask

The register is already the core of one: entities with a kind, components as typed arrays (position, radius, team,
flags) and owners as systems. If the stress numbers ever show the owners' own loops (not the queries) are the cost, or
we find ourselves adding the same field to three owners, the path is:

1. Move a shared field (health, velocity) out of the owners into a register column, so damage and leads need no owner
   call.
2. Give entries a lifetime of their own (allocated slots with generations rather than republished each tick), so the
   owners write into register columns instead of copying in.
3. Only then consider a library (bitECS-style SoA), when systems iterate by component rather than by owner.

Nothing in the stress numbers asks for that today: the swarm sims themselves are a few ms at 1,000 units each; the time
goes to ground lookups, drawing and physics (`docs/perf-2026-10-26.md`).

## Not in this proposal

No component framework, no events bus, no change to how the swarms simulate or draw, no change to the ground function
(its cost is a separate fix, first on the perf list), no networking concerns.
