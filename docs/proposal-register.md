# Proposal: one register and spatial grid for "what's near here?"

Status: **proposed, waiting for Keith** (2026-10-26). Nothing here is built.

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
