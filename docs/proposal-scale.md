# Proposal: effects and shots at co-op scale

Status: **proposed, waiting for Keith** (2026-10-26). Nothing here is built except the measuring scenario.

Keith 2026-10-26: 4 players working together; each weapon with 3-6x today's particle effects; Protocols that split
shots, fire several, raise fire rate, widen areas, ricochet and chain. "The performance thresholds scale significantly
from here." In a big fight that is roughly 20-50x today's shots and particles. This proposal measures where that lands
on today's code and lays out how to carry it.

## The worst case, measured

`labs/stress/?worst` (`labs/stress/worst.ts`): the stress lab's full swarms (1,000 robots, 500 bandits, war band) plus
three AI allies (four player Ramparts in all, both miniguns always on the nearest enemy), every team round passed
through max-Protocol stand-ins (split x3, fire rate x2, area x1.5, one ricochet, a chain to 3), effect counts x4 (the
dust sources, sparks, grit and smoke sliders), and a missile swarm plus a big mortar per player every 4 s. The
stand-ins wrap the lab's own `Battlefield.fire`, so each round costs what a round costs today.

Measured on the shared cloud box after perf pass 1 (`?webgl&norender&dt=0.033&run&steps=100&settle=2&hold=3`, 92
frames; the box is loaded and software-rendered, so read ratios), worst case off and on:

| per frame | today's stress lab (pass 1) | worst case |
| --- | --- | --- |
| sim tick, all systems (ms) | 50.1 | 83.0 |
| dust (ms) | 6.1 | 12.5 |
| death physics (ms) | 5.3 | 12.6 |
| robots draw (ms) | 9.5 | 11.4 |
| gun effects (ms) | 0.7 | 4.6 |
| the allies and the Protocol stand-ins (ms) | 0 | 5.6 |
| dent layer brushes (ms) | 2.6 | 4.8 |
| bodies on the field | 5 | 147 |
| player-team gun shots (8 guns, 16/s each, spin-up and arcs) | about 1 | 2-4 |
| `Battlefield.fire` calls from the team | about 1 | 32 (14 rounds, 14 ricochets, 4 chain hops) average, 54 at peak |
| dust puffs asked for (`DustSim.emit`) | 92 | 3,508 (38x) |
| tracers drawn | 0.6 | 38.5 (60x) |
| dust puffs alive | 3,300 | 4,096 (the pool's cap) |
| meshes in view / in the shadow pass | 93 / 93 | 117 / 121 |
| triangles in view / in the shadow pass (bandit bake not counted) | 1,139k / 766k | 1,184k / 839k |


## Where it breaks

- **The particle pools saturate before the CPU does.** 3,508 dust requests a frame into a 4,096 pool means every puff
  is recycled within about a frame of being born: the cost is capped (dust only doubles, 6 to 12.5 ms) but the look is
  gone, trails and clouds blink out. Same for tracers (160), sparks (600), grit (600): fixed pools hide the cost by
  dropping the effects. Raising the caps on the CPU multiplies the dust cost by the same 38x (it is per live puff).
- **Rounds scale linearly and each one scans everything.** 32-54 `fire` calls a frame from the team alone, each a ray
  against every Hittable (every bandit and robot linearly), a splash over every unit, and its own effects. Bandits add
  their own rounds on top. At 4 players with fast weapons this is the second wall.
- **Death physics doubles** with the kills (147 bodies, 12.6 ms; the per-frame cap keeps the spikes down, `maxRagdolls`
  is the knob).
- **The GPU side barely moves:** meshes and triangles are instanced pools of fixed size, +3 Ramparts. The GPU cost of
  the worst case is fill (dust sprites overlapping) once the pools are big enough to show it, not geometry.


## 1. GPU particles

**What moves:** dust (4,096-puff pool, CPU sim and sort today), sparks and grit (600 each), tracers (160), casings
(240), smoke (shares the dust pool), water splashes. Today each is a CPU structure-of-arrays sim that writes instance
attributes every frame; the pools are fixed, so at worst-case rates they recycle their oldest particles long before
they fade (a cost cap, but the look breaks first: dust trails vanish in the middle of a fight).

**The shape:** one particle system per look (dust, sparks, streaks, casings), each a storage buffer of N particles
(position, velocity, age, life, size, seed, kind: about 48 bytes) stepped by a TSL compute pass, drawn by the same
sprite / instanced materials reading the buffers directly (`instancedArray` / `storage` nodes; no CPU copy).

- **Emitting:** the CPU never touches the particle buffers. It appends emit requests (where, direction, count, kind,
  strength; 32 bytes each) to a small per-frame spawn buffer. The compute pass, one invocation per particle, checks
  whether its slot falls in this frame's ring range `[head, head + spawned)` and if so initialises itself from the
  request it maps to (a prefix table of request counts, binary searched); otherwise it steps. No scatter writes, no
  atomics, so it runs on both backends.
- **The ground:** puffs need the floor and their shadow's ground. The detail patch already keeps the true ground round
  the focus in a float texture (`GroundWindow.fineH`, 25 cm); the chunks' coarse grid is a second texture. Compute reads
  those, so the ground lookups that were 60% of the CPU frame before pass 1 cost nothing on the CPU.
- **Dune shade:** the CPU sun march per puff (`sunReach`) becomes a sample of the sun's shadow map in the material
  (already done per pixel today) plus a coarse "behind a dune" texture marched once per frame on the GPU over the
  window (64 x 64 texels), read per puff.
- **Sorting:** dust is sorted back to front today. On the GPU: no sort; soft premultiplied puffs that read well in any
  order (they are one colour family), or a bitonic sort on WebGPU only. Sparks and streaks are additive and need none.
- **Collisions with units:** none (cosmetic). Sparks that bounce read the ground texture only.

**WebGL 2 fallback (r186):** three's WebGL backend runs `renderer.compute()` as a vertex pass with rasterisation off and
**transform feedback** writing the storage buffers (`WebGLBackend.compute`, `beginTransformFeedback`). That covers the
shape above: one invocation per particle, reading uniforms, textures and other buffers, writing only its own element.
What WebGL 2 can't do: atomics, workgroup memory, random-access writes, compute writing textures. The design avoids
all four, so the same TSL runs on both; only the optional bitonic sort is WebGPU-only (WebGL draws unsorted). If a
WebGL 2 machine turns out slow there, the fallback is today's CPU path with the budget below (it stays in the code
until the GPU path is proven on Keith's PC).

**Expected cost:** 60k particles stepped on the GPU is well under 0.5 ms on a GTX 1060-class card; the CPU cost of
effects drops to building the spawn list (tens of µs). Fill rate becomes the limit: big soft dust sprites overlapping at
the 40 m camera. That is what the budget's thinning is for.

## 2. An effects budget that degrades gracefully

A fixed budget per frame (particles spawned, live particles per look, tracers drawn, lights), sliders under
Performance. Every effect request goes through one gate (`src/fx/budget.ts`) before it reaches a pool:

1. **The local player's effects always pass at full** (their own muzzle flashes, impacts within 15 m of their mech,
   their mech's footfalls). Co-op: each peer's own effects are local to it, so every player keeps full feedback.
2. **Merge:** impacts in the same 1.5 m cell in the same frame merge into one bigger effect (the count goes into its
   strength: a 20-round burst on one robot is one spray scaled by sqrt(20), not 20 sprays). Merging is a spatial hash
   cleared each frame; it also cuts the sound voices.
3. **Thin with distance and crowding:** past 30 m from the camera focus, a share of requests kept that falls with
   distance and with how full the budget is this frame (deterministic per request id so it doesn't flicker).
4. **Trim the extras first:** each effect lists its parts in order of importance (the impact flash and main puff;
   then plume; then spray, grit, casings, smoke). Under pressure the tail goes first.
5. **Live caps per look**, oldest-and-thinnest recycled first, so trails don't vanish mid-fight.

The budget is what makes the 3-6x effects safe: up close every hit looks like the reference; at the edge of a 4-player
fight the screen is full but the frame isn't.

## 3. Shots as data

Today each round is a `Battlefield.fire` call that resolves immediately (ray against the ground, every Hittable's
`hitRay`, splash over every unit) and spawns its effects. At worst-case rates that is 32-54 calls a frame from the team
(plus the bandits' rounds), each scanning every unit.

**The shape:** one projectile system (`src/game/shots.ts`), structure of arrays, drawn instanced and batched per look:

- **A shot** is a row: origin, direction, speed (hitscan = infinite), range, damage, team, owner id, weapon id, seed,
  and its Protocol data: `split`, `rateMul`, `ricochets` left, `chain` left and range, `area` multiplier, pierce budget
  (the sheet hits and penetration the rail agent is building become fields here: sheet height, penetration left).
- **Protocols are data on the shot, not code in each weapon.** Split and fire rate expand at fire time into more rows
  (seeded fan); ricochet and chain spawn child rows at the hit (with `generation` so they can't loop); area scales the
  splash radius on the row. A new Protocol is a field and a rule in one place, and every weapon that fires shots gets it.
- **Resolution once per sim tick, batched:** all rows advance, then hits resolve against the shared register
  (`docs/proposal-register.md`, approved and being built): one grid walk per shot for candidates, the owner's exact
  test (`hitRay`, sheets) only on those. Splash and chain use `register.near`. At 2,000 shots a tick that is about
  2,000 x 13 µs = 26 ms today's linear way, about 2-3 ms through the grid (measured candidate walk 13 µs at 60 m
  without the linear scans behind it; most shots are much shorter).
- **Output is events:** `hit(shotId, targetKey, part, damage, point, normal)`, `ricochet(...)`, `chain(...)`,
  `miss(point)`. Damage applies from the events; effects are made from the events through the budget gate.

## 4. The multiplayer fit

Rule 12 in CLAUDE.md already says it; this design follows it.

- **Shots are commands, hits are events.** A player's fire becomes `fire(weaponId, origin, dir, seed, tick)`; the host
  expands it (split, rate) with the seed, resolves it and sends hit events. Peers can predict their own shots' tracers
  locally with the same seed and correct on the host's events.
- **Effects are cosmetic per peer.** Every peer builds its own particles from the hit events through its own budget,
  with `Math.random()`; nothing about them is synced. Each peer is "the local player" for its own effects.
- **Bandwidth:** hit events merged per target per tick (one event with a count and total damage), not per round:
  a 2,000-round tick across 300 targets is at most 300 events, about 6 KB, and far fewer in practice.

## Expected costs at the worst case

Rough, from the measurements above and the register benchmark, on Keith's PC (about 4-6x the cloud box headless):

| | today at the worst case | after |
| --- | --- | --- |
| dust, sparks, tracers (CPU) | 17 ms headless, with the pools dropping most effects | under 0.5 ms CPU (spawn lists), GPU step under 0.5 ms for 60k particles; fill bounded by the budget |
| rounds (resolve and splash) | grows with rounds x units: 32-54 rounds x 1,500 units scanned | grid walk per shot (13 µs at 60 m measured), about 1-2 ms for 2,000 a tick |
| effects actually shown | about 1 in 40 dust requests survives a frame | budgeted: full near the player, merged and thinned far |
| death physics | 12.6 ms headless | unchanged (Rapier); far bodies could skip ragdolls (a canned fall) past a count |


## Order of work

1. **The effects budget gate** on today's CPU pools (merge, thin, trim, local player full). Cheap, immediately makes the
   worst case survivable, and the gate's interface is what the GPU path plugs into. About a day.
2. **The register** (approved, in progress elsewhere): hits and splash through the grid.
3. **Shots as data** on the register: one system, Protocols as fields, hits as events, the sheet and penetration work
   folded in. The minigun first, then each weapon. Two to three days.
4. **GPU particles,** one look at a time: sparks and grit first (simplest, additive), then tracers and casings, then
   dust (the ground texture, no sort, the dune-shade texture). Each behind a slider (GPU / CPU) until Keith has played
   it. Three to four days.
5. **Far LOD and shadow distance for units** (pass 1's leftover): bandits past 40 m on a 300-500 triangle bake, far
   bandits and robots out of the shadow pass (split each instanced mesh into near casters and far non-casters).

## Risks

- **WebGL 2 compute speed:** transform feedback works, but some drivers run it slowly; the CPU path stays as the
  fallback until measured on real machines.
- **Fill rate:** GPU particles move the cost from CPU to overdraw. The budget's thinning and a far-size cap handle it,
  but it has to be watched at the 80 m zoom.
- **Feel:** merging and thinning could make big fights read thinner than Keith wants. Everything is a slider; the local
  player's own hits are never thinned.
- **Determinism:** shots as data must take their spread and fan from the shot's seed, not `Math.random()`, or peers
  disagree on hits.
- **Two agents' work lands in the same place** (the register; sheet hits and penetration). Shots as data should start
  after both merge, built on them, not beside them.
