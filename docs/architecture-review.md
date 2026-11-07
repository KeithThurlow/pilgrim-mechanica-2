# Architecture review (adversarial), 2026-11-07

Keith asked (2026-11-07), after deciding to stay on three.js (`docs/engine-options.md`), for an architecture "we're happy
with and feel is maintainable, with a strong entity component system", built to reach **~144 fps CPU solo and ~100 fps
in 4-player co-op**. Smoothness is what counts, so a lower fixed sim and damage tick (30 or 60 Hz) with interpolated
drawing is fine. He also asked what tick rates ARPGs use.

**Targets after Keith's answers (2026-11-07):**
- **Sim:** 30 or 60 Hz is fine.
- **Drawn frames:** as high as the graphics allow, interpolated: **at least 144 fps, ideally 200+**. That is a 6.9 ms
  main-thread frame, 5 ms at 200 fps.
- **Rates:** each part of the game runs at its own rate and on its own thread where that makes sense, for example
  animation at the drawn rate apart from the sim (section 4.6).

Claude wrote this from main `6f5425c` (after #276). It reads the code, `state.md`, `docs/sim-scope.md`,
`docs/proposal-simworker.md`, `docs/handoff-simworker.md`, `docs/multiplayer.md`, `docs/engine-options.md` and the PC
profiles in the project files. It also takes in the parallel threads' recent work: the sim worker steps (#252-#274) and
the robot view cull (#276). The draw-cost (merged parts, instancing) and far-sim threads were still in flight. **Nothing here
is built.** This is the review to review. No restructuring starts until Keith has read it.

"Adversarial" means it looks for what will hurt, not what works. A lot works, and section 2 says what to keep.

---

## 1. Short answer

- **Tick rate:** a fixed **60 Hz game tick** for everything with rules: damage, AI, projectiles and enemy movement.
  The player's walker keeps its 120 Hz feel by running two substeps inside each tick. Drawing runs at the display's
  rate, interpolated between the last two ticks. Far things run on slower rate groups (30 and 15 Hz). Peers get
  snapshots at 20-30 Hz. ARPGs run at about this rate (section 6).
- **The biggest problem isn't speed. The game has no single loop, clock or world.** The convoy lab's `main.ts`
  (1212 lines) is the game. It steps each system its own way: some at frame dt, some in variable substeps, some
  through the worker. So results change with frame rate, the tick rate can't be changed in one place, and multiplayer
  has nothing to hook onto. Fix this first. It is cheap.
- **Entities come in about five shapes:** SoA swarms, OO units holding three.js objects, `Hittable` adapters with 20
  optional methods, the register's copy, and the worker's views. Every cross-cutting feature (burning, chill, armour,
  parry, knockback) is added once per shape. That is the maintainability cost Keith feels, and the ECS fixes it.
- **The worker is solid groundwork, but it is the wrong shape to scale to.** Each moved system needs its own remote
  file, a view that replays commands, and full-array snapshots. It works, and the parity checks are excellent, but the
  cloud bench measured little gain (sim 7.8 vs 8.1 ms). Converge it on **one host world in the worker with one
  snapshot/event protocol**. That same protocol is the netcode.
- **The target:** a small in-house ECS (SoA typed-array columns, generational ids, systems with a declared phase and
  rate), one fixed-tick scheduler, a **host world** (worker now, a peer or Node later) that takes commands in and sends
  events and snapshots out, and a **view world** on the main thread that predicts the local mech and draws through
  instanced, per-kind render systems.
- **Migration:** nine stages, each its own PR with a parity or determinism check, and each leaves the game playable.
  Stages 1-3 (one clock, the ECS core, damage as data) are small. They unblock everything else and change nothing
  you can see.

---

## 2. What to keep (it's good)

- **The ground is a function** (`DuneField.height`). This is the best decision in the codebase. It makes streaming,
  the worker mirror and co-op cheap.
- **Pure sims for the crowds.** `robots.ts` and `infantry.ts` import no three.js, use structure of arrays and have no
  `Math.random`. They are already ECS-shaped.
- **The register** (`src/game/register.ts`): one spatial index over everything, with stable ids. It is the spatial
  query an ECS needs. Keep it as a system-maintained resource.
- **Commands and events as habits** (`MoveCommand`, `Aim`, `RobotEvent`, ground events). The direction is right.
- **Parity checks** (`tools/*worker-check.ts`): the bit-for-bit idea is the strongest testing tool here. Generalise it
  into a determinism check for the whole world.
- **Labs and sliders.** The ECS must keep them. A lab becomes "a world with these systems and a spawn script".
- **Seeded world content** (POIs, camps, loot) and abstract far groups (`sim-scope.md`). This is interest management
  already.

---

## 3. Findings, ranked

Severity: **H** blocks the goals (performance, co-op, maintainability), **M** costs us steadily, **L** is friction.

### F1 (H). No single game loop or fixed tick; the lab is the game
- `createApp`'s loop hands each tick a frame dt clamped to 1/20 s, so a slow frame slows game time.
- Then each system decides for itself:
  - The convoy, carry, airlift, pilot and escorts substep with `sub = ceil(dt·120)`, step `dt/sub`
    (`labs/convoy/main.ts` ~1009). That is **variable** substeps, between 1/240 and 1/120 s, not a fixed 120 Hz.
  - `MechUnit.step` (`src/game/mechUnit.ts:452`) and the war band vehicles (`src/combat/warband.ts:727`) do the same.
  - The robot swarm, battlefield, turrets, guardians, summons and the expedition loop step **once per frame at frame
    dt**.
- CLAUDE.md says "sims step at a fixed 120 Hz". In practice only the substep count is bounded.
- `hitStop.dtScale` scales the whole sim's dt for a melee hit. That is fine solo, but in co-op one player's hit-stop
  can't slow the host's world.
- Consequences:
  - The same inputs give different results at 60 fps and 144 fps, so there are no replays and no lockstep.
  - "Run damage at 60 Hz" can't be done in one place.
  - Two sims that interact (robots and the mech) step at different granularities.
  - Every new lab copies the ordering logic (the 1212-line `main.ts`, plus `combatLab.ts` and seven other labs).
- **Fix:** one scheduler (stage 1), which is small. Order systems by phase in one place, not in each lab.

### F2 (H). Entities have no common shape
Today a "thing" is one of these:
1. **A slot in a SoA swarm**: robots (57 typed arrays), infantry (28), each with its own pool, hash, ids and events.
2. **An OO object holding three.js state**: `MechUnit` (walker, guns, Rampart model and health in one), war band
   vehicles, escorts, guardians, crushers, striders, drones and replicas.
3. **A `Hittable` adapter**: an interface with about 20 optional methods (`hitRay`, `damage`, `splash`, `sheet`,
   `pick`, `unitOf`, `slow`, `knock`, `parry`, `normalAt`, `armourOf`, `bars`...) and 17 implementations.
4. **A register entry**: a copy of each thing's position and size, rebuilt every tick.
5. **A worker view**: `robotsRemote`, `escortsRemote`.

Burning, chill, armour types, knockback and parry each had to touch every adapter. A new enemy kind means a new pool,
a new adapter, register publishing, a draw class, and maybe a remote. This is the "hard to keep changing" cost, and it
grows with every enemy and effect. **Fix:** an ECS. Health, armour, matter, status (burn, chill), collider and
knockback become components that one system handles for every kind (stages 2-5).

### F3 (H). `Battlefield` is a god object that mixes host rules with cosmetics
`src/game/battlefield.ts` resolves shots and damage (host rules), and it also owns dust, dents, the GPU particles,
tracers, sound, water, blast waves, novas, flames, the heat texture and the detail patch. It calls `Math.random` 31
times, and its sim calls take `THREE.Vector3`. So damage can't move to the worker, a peer or a server without dragging
the renderer along. This is the main reason the worker has moved little of the frame. **Fix:** split it into a
**hit-resolution system** (pure, host) that emits hit, blast and death events, and **FX/audio consumers** of those
events on the main thread (stage 3).

  *Correction while building stage 3 (2026-11-07).* This finding was overstated in two places:
  - Its 31 `Math.random` calls are all cosmetic.
  - Shots were already data with events (`src/game/shots.ts`).

  The real coupling was elsewhere. Blasts did damage and effects in one call, and crater digging (host ground) was capped
  by wall-clock milliseconds, which is nondeterministic. Stage 3a fixed both (`src/game/combatRules.ts`).

### F4 (M-H). The worker design doesn't scale past a few systems
- Each moved system needs:
  - a remote file;
  - a main-thread *view* that applies calls at once, records them as commands, gets overwritten by each snapshot, and
    then **replays** the commands made since;
  - a dedicated parity check.
- `robotsRemote` snapshots **every typed array, sliced to `hi`, every frame**. Its cost grows with the pool's
  high-water mark, not with what changed.
- At 2+ frames of lag a call on the view can act on a robot the worker already killed. The design handles this, but
  it is a known edge.
- What stays on the main thread (drawing glue, deaths, guardians, dust) means the gain was small: 7.8 vs 8.1 ms on the
  cloud bench at 300 robots, and none at 40.
- Nine more systems this way means nine bespoke protocols, and the netcode would be a tenth.
- **Fix:** the worker hosts **one world**. Main sends commands, and the worker sends back one snapshot of changed
  columns plus one event list. The main thread doesn't run a mirror of each system. It predicts the local player and
  interpolates the rest (stage 7). Keep the ground mirror and the parity idea.

### F5 (H for performance). Drawing pays per object
- Half the siege frame is three's per-object submit (about 14 µs per object, ~195 camera and ~135 shadow objects;
  `engine-options.md`).
- Units are scene-graph trees: a mech is dozens of `Object3D`s riding bones.
- The crowds are already instanced, but their draw classes still do per-instance CPU work (`robotsDraw.update`
  ~1.1 ms before #276's cull).
- The draw-cost thread is attacking this.
- **Architecture implication:** render systems should draw **per kind, not per entity**: one InstancedMesh or
  BatchedMesh per (model, material) part. They read interpolated transform columns, with no `Object3D` per entity.
  Mechs (few, complex) can keep a merged rig per mech.

### F6 (M). Sim and drawing split unevenly
- 185 of 414 files in `src/` import three.
- Robots and infantry are pure, but `MechUnit`, `warband.ts`, `arsenal.ts`, `guardians.ts`, `shots.ts` and the walker
  use `THREE.Vector3` in their sim state, and `MechUnit` owns its model.
- The player's mech is the thing co-op needs most on the host, and today it can't run without a scene.
- **Fix:** sim components hold plain numbers (or `{x, y, z}`), and the model moves into a render system
  (stages 5-6).

### F7 (M). Randomness in game state
- `Math.random` appears 399 times.
- The known-debt files are unchanged since 2026-10-26: `battlefield.ts` 31, `arsenal.ts` 27, `warband.ts` 14,
  `mechUnit.ts` 9.
- Most of these are cosmetic, but spread, misses and loot jitter are not, and grep can't tell which is which.
- **Fix:** the world owns a seeded RNG per system (or per entity); cosmetic code gets a separate `fxRandom`. Then a
  lint check (`tools/random-check.ts`) can fail on `Math.random` in sim folders.

### F8 (M). One flat bag of tuning values
- The convoy lab's values object `V` holds about 3000 sliders that every system reads.
- The worker mirror has to diff the whole bag (#274 cut how often), and objects inside it aren't mirrored.
- In co-op the host's values must reach peers.
- **Fix:** keep the sliders exactly as they are for Keith, but systems read typed per-system **config resources**
  (the same `Param[]` groups). A change becomes one plain event ("config `robots`, key `robotHp`, 120"), sent to the
  worker and to peers alike.

### F9 (M). Per-frame ground lookups
- `fbm`/`duneSet` cost about 6 µs a call, and dust, shadows, feet and vehicles make tens of thousands of calls a frame
  (~1-1.5 ms).
- The function stays the truth. A cached height grid resource round the focus, invalidated by the ground events that
  already exist, serves the bulk queries.
- The far-sim thread may take this. It belongs in the architecture as a **world resource** shared by systems.

### F10 (M). Callbacks into update
Robots now queue events (4a). Elsewhere, systems call each other's handlers mid-step (`onShot`, `onLob`, `onBeam`,
`onDeath`, `onFootfall`...), so their order is implicit and a handler's effect lands inside another system's step.
**Fix:** one event bus per tick. Systems emit events, and later phases or the next tick consume them.

### F11 (M). Ids aren't network-grade yet
- Register ids are `owner·2³² + serial`, where the owner number comes from the order owners were added.
- They are fine on one machine, but they are rebuilt from the swarms' own serials, and peers would have to add owners
  in the same order.
- **Fix:** ECS entity ids (index + generation) handed out by the host, with a replicated-id table for peers.

### F12 (L). The shared record is drifting
- `state.md` is 2209 lines, with duplicated system rows (Game camera, Terrain, Dust, Ground dents, Checks, Convoy,
  Expedition, Loot) and duplicated In progress lines.
- CLAUDE.md's "fixed 120 Hz" claim is out of date (F1).
- Agents start from these files, so drift costs every session.
- **Fix:** a one-off dedupe, plus a check that fails on duplicate system rows.

### Risks, ranked

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Co-op can't be bolted on: no single tick, no single world, OO units holding three.js state (F1, F2, F6) | High | Very high: a rewrite later | Stages 1-7 before any netcode |
| R2 | Render submit stays at ~7 ms and caps us below 144 whatever the sim does (F5) | Medium | High | Per-kind render systems; the draw-cost thread; the Bevy spike stays as the fallback |
| R3 | Every new enemy or effect costs more than the last (F2) | High (it's happening) | High for speed of change | ECS components shared by all kinds |
| R4 | The migration stalls halfway, leaving two architectures | Medium | High | Strangler order: each stage has an adapter so old and new live side by side; stop after any stage and the game still works |
| R5 | The worker protocol multiplies (F4) | High if we continue per system | Medium | Stop adding per-system remotes after robots; converge in stage 7 |
| R6 | A 60 Hz tick feels worse than today (input, legs, fast rounds) | Low-medium | Medium | Local walker stays at 120 Hz substeps; rays are swept; interpolation; a slider and `?tick=120` to compare |
| R7 | Determinism breaks quietly (`Math.random`, iteration order, float order across threads) | Medium | Medium (host/worker drift; replays) | A determinism check: same commands → same world hash; the random lint |
| R8 | An ECS adds ceremony that slows small changes (rule 1) | Medium | Medium | In-house and small; no codegen; components are plain typed arrays you can poke in a lab; heavy sims stay as opaque components |

---

## 4. Target architecture

```
 main thread (view)                                   worker (host world)            later: peers / Node host
 ─────────────────                                    ───────────────────            ────────────────────────
 input → Commands ───────────────────────────────────▶ command queue                 same commands over WebRTC
 local mech: predicted at 120 Hz substeps              Scheduler: fixed 60 Hz tick
   (same walker code, reconciled to host)                phases: input → AI → move →
 interpolation buffer (last two snapshots) ◀─────────── snapshot (changed columns)    same snapshot, quantised,
 render systems (per kind, instanced) read it            physics/contact → shots →     interest-managed per peer
 FX / audio consume events ◀───────────────────────────  damage → status → death →
 HUD / UI read view state                                spawn/despawn → events
                                                       resources: ground (+cache), register,
                                                         config, RNG streams, clock
```

### 4.1 The world and the ECS
- **In-house, small** (`src/ecs/`, about 400 lines to start). The reasons for not using a library:
  - Column storage has to be exactly what the snapshot and network send: typed arrays, transferable, sliceable,
    quantisable.
  - Systems have to be steppable from a lab with sliders.
  - Rule 1 says nothing precious: we can change our own ECS in an afternoon.
  - bitECS is the reference design to borrow from. Revisit it if ours grows past ~1000 lines.
- **Entities:** a 32-bit id, 20 bits of index and 12 of generation. Ids are handed out by the host, and freed
  indices are reused with a new generation. Peers map host ids one to one.
- **Components:** SoA columns in typed arrays, one array per field, sized to capacity and grown by doubling. A
  component declares its fields and a **replication** rule: `host` (sent to peers), `local` (never sent), `cosmetic`.
  For example:
  - `Transform` (x, y, z, heading), plus `PrevTransform` for interpolation;
  - `Velocity`, `Team`, `Health` (hp, max), `Armour` (flat, type), `Matter`;
  - `Collider` (kind, radius, height, reach: what the register indexes);
  - `Burning`, `Chilled` (pace), `Knockable` (mass);
  - `Brain` (state, target id, timer: per-kind AI reads it);
  - `Weapon` mounts (by slot), `Loot` (seed, level), `Salvage`;
  - render tags such as `Model` (kind, variant) and `Lod`.
- **Kinds with complex internal sims** (the walker's legs, a car's wheels, the crane, Rapier ragdolls) aren't forced
  into flat columns. They get an **opaque sim component**: an array of sim objects indexed by entity, stepped by their
  kind's system. The rest of the game still sees their `Transform`, `Health` and `Collider`.
  - The walker stays the pure maths it is. The ECS wraps it rather than rewriting it.
  - These few heavy entities (mechs, vehicles) are where flat columns gain nothing.
- **Queries:** a component bitmask per entity, and per-query dense lists updated on add and remove (sparse sets). No
  archetype tables. Our entity counts (≤ 4k) don't need them, and sparse sets keep add and remove cheap and simple.
- **Systems:** plain functions `(world, dt) → void` with a declared **phase** and **rate** (every tick, or 1/2, 1/4,
  1/8 for far LOD groups, chosen per entity by a `Lod` component). One file, one job (rule 5). The robots' AI is a
  system over `Brain + Transform + RobotKind`, and its leg animation is a render system.
- **Resources:** world singletons such as the ground (function plus cached height grid, F9), the register (rebuilt by
  a system from `Transform + Collider`), the config per system (F8), the RNG streams (F7), the clock, and the convoy
  route.
- **Events:** a typed, plain-data buffer per tick (`Hit`, `Blast`, `Death`, `Spawn`, `Pickup`, `Bank`, `Sound`...).
  Host events are replicated. Cosmetic events are made on each side from them.

### 4.2 The tick (see section 6 for why)
- A **fixed 60 Hz** world tick.
  - An accumulator on the main thread decides how many ticks are due, at most 4 per frame.
  - A slow frame catches up without slowing game time, and a long stall drops the excess.
  - This replaces the 1/20 dt clamp.
- **Systems that need finer steps substep inside their own system:** the walker at 2×60 = 120 Hz, as today, and
  vehicles at 2×. Their maths and feel don't change.
- **Rate groups:** near entities every tick; out of view or past ~150 m every 2nd tick (30 Hz); asleep or abstract
  every 8th tick or event-driven. This generalises the escorts' LOD (#250) and the frozen camps.
- **Drawing** interpolates `PrevTransform → Transform` by `alpha = accumulator / tickDt`.
- **The local player's mech** is predicted on the main thread at its own substeps (zero added input lag) and
  reconciled to the host's state when it disagrees past a threshold. Today that is a no-op solo.
- **Hit-stop** becomes a presentation effect (the camera, the hit unit's animation clock, the player's own input
  scale), not a world-time scale.

### 4.3 Host and view
- **Host world:**
  - Solo it runs in the worker.
  - In co-op it runs on the hosting player's worker, and the other players are views over WebRTC.
  - For a dedicated server, the same world runs in Node with no renderer. The headless checks already prove this
    works.
- **One protocol for the worker and the network:**
  - **commands** in (per player, tagged with a tick);
  - **events** out (per tick);
  - **snapshots** out: dirty columns of `host`-replicated components. Change bits per entity, deltas against the last
    acknowledged snapshot, quantised for the network (positions at 1 cm, heading at 1/1024 turn).
  - Every tick to the local view, 20-30 Hz to remote peers, with interest management by distance (the register
    already answers "what's near player N").
- **The ground** stays mirrored by events, as today.
- **View world (main):** the same component definitions holding the latest two snapshots, plus local-only
  components (render handles, animation clocks). Render systems, FX and UI read only the view.

### 4.4 Rendering
- One render system per kind (robots, infantry, vehicles, mechs, drops, props). It owns its InstancedMesh or
  BatchedMesh pools and writes instance matrices from the interpolated transforms of visible entities. That means view
  culling per kind (#276's `ViewCull`), not per `Object3D`.
- Mechs (≤ 4 players + rivals + guardians) can keep a rigged model each, but with merged parts per bone (the
  draw-cost thread).
- Shadows: the same per-kind batches, with cheaper proxies (`ShadowProxies` already exists).
- FX stay as they are (GPU particles and dents). They are driven by events, not by sim calls.

### 4.5 Budgets (estimates, to be measured)
The frame budget is 6.9 ms at 144 fps and 10 ms at 100 fps.

Keith's later target (200+ fps) means a 5 ms main thread. Reaching it needs the render systems at ~3.5 ms, which is
beyond the table below. It probably needs the per-kind batching and animation LOD of section 4.6, and a GPU that isn't
the limit.

| | Solo, 144 fps | Co-op host, 100 fps | Basis |
| --- | --- | --- | --- |
| Main: input, prediction, interpolation | ~0.5 ms | ~0.7 | Local walker ~0.7 ms at 120 Hz today (profile: walkers 4-5% of 16 ms, several mechs) |
| Main: render systems + submit | ~5 ms | ~6 | Today ~7; the draw-cost thread's target 1.5-2 ms off; per-kind batching more |
| Main: FX, HUD, uploads | ~1 ms | ~1.5 | Today ~1 ms uploads, dust draw ~1 |
| **Main total** | **~6.5 ms** | **~8.2 ms** | Fits, if the render work lands |
| Worker: host tick at 60 Hz | ~4-6 ms per tick | ~7-10 ms per tick | Today's sim ~6-8 ms per frame at frame rate; 60 Hz halves the rate vs 120 Hz substeps; co-op adds 3 mechs and ~1.5-2× enemies |
| Worker budget per tick | 16.7 ms | 16.7 ms | It runs alongside the main thread |

- The sim leaves the frame budget entirely. It has its own 16.7 ms per tick on another core, so **solo has about
  3× headroom on the sim**.
- That makes the main thread's render cost the gate for both goals, which matches `engine-options.md`.
- If render submit can't get under ~6 ms, the Bevy spike is the next call, not more sim work.

### 4.6 Each part at its own rate and thread (Keith 2026-11-07)
Keith asked whether animation could be separated from the sim, and whether parts could be threaded differently, each
with its own performance threshold. Yes. The rule: **the sim decides *what* happens at a fixed rate; everything you
*see* is computed at the drawn rate from the sim's state.** A part that nothing else depends on (cosmetic) can run at
any rate, on any thread, and skip work when it's far or off screen.

| Part | Thread | Rate | Budget | Notes |
| --- | --- | --- | --- | --- |
| Host rules: damage, shots, projectiles, enemy movement, status effects | Worker (host) | **60 Hz** | ≤ 8 ms per tick (of 16.7) | Rays are swept, so fast rounds don't tunnel. DoT damage is applied at 10 Hz, its look every frame. |
| AI decisions near the player (target picks, paths, attack choices) | Worker | 10-20 Hz, staggered across ticks | inside the above | Movement still steps every tick. Spreading decisions over ticks flattens spikes. |
| AI far, or out of view | Worker | 30 / 15 Hz rate groups | inside the above | Generalises the escort and guardian LOD (#250, the off-screen guardians). |
| Abstract groups (roaming packs, clashes, war columns) | Worker | 2 Hz | ~0.1 ms | Already about this (clashes every 0.5 s). |
| Spatial index (register) | Worker | every tick | ~0.3 ms | One per world. The view has its own for the cursor. |
| Your own mech's legs and IK (walker sim) | **Main**, predicted | 120 Hz (2 substeps per tick) | ~0.7 ms per frame | Zero input lag. In co-op the host keeps an authoritative copy and corrects when it drifts. |
| Remote mechs' legs and poses | Main | drawn rate, from interpolated state | ~0.2 ms each | Foot plants come from the host's state. The pose is cosmetic. |
| Enemy animation (robot legs, bandit baked clips, swaying hoses) | Main | **drawn rate near**, ½ or ¼ rate far (animation LOD), none off screen | ≤ 1 ms | Read from interpolated transforms. This is where `robotsDraw`'s ~1 ms goes today. |
| Particles: dust, sparks, tracers, casings | GPU compute | drawn rate | GPU time | Spawned from sim events. Already on the GPU (scale step 5). |
| Ground dents, heat | GPU / main | dents every frame, heat 4-30 Hz | ~0.3 ms | Cosmetic, made from ground events. |
| Death physics (Rapier ragdolls, wrecks) | Main now, a second worker later | 60 Hz fixed, interpolated | ~1 ms | Cosmetic, so it can live in its own worker without touching the host. |
| Terrain chunks and patches | Worker | on demand, budgeted | ≤ 4 ms per frame in the background | Already there (worker steps 2 and 2b). |
| Audio | Web Audio's own thread | events at the tick, mixed natively | ~0.2 ms main | Sounds start from sim events. Pitch and spin follow the interpolated state. |
| Camera, HUD, UI | Main | drawn rate (text HUD 10 Hz) | ~0.3 ms | |
| Network | Worker (host) | inputs every tick; snapshots to peers at 20-30 Hz | ~0.5 ms per peer | The same snapshot the local view gets, quantised and filtered by distance. |

Threads: **main** (input, prediction, interpolation, animation, drawing, at 5-6.9 ms a frame), **host worker** (the
world at 60 Hz, at most 8 ms of each 16.7 ms tick) and an optional **cosmetic worker** (ragdolls, maybe animation
baking). The GPU runs particles and dents, and Web Audio mixes on its own thread. The clock (stage 1) carries this. It
runs the fixed ticks and gives every drawn-rate part an `alpha` between the last two ticks, and a part declares its rate
when it registers.

---

## 5. Migration plan (staged, each stage a PR, nothing visible changes until stage 6)

The order is a strangler: each stage adds the new path beside the old and moves callers over, so we can stop after any
stage and the game still plays. Each stage comes with a check.

| Stage | What | Size | Check | Unblocks |
| --- | --- | --- | --- | --- |
| **1. One clock** | `src/core/clock.ts`: fixed-tick accumulator, catch-up cap, `alpha` for the drawn-rate parts, rate groups (every Nth tick). Every lab's ticks go through it. The default stays frame-locked (as today) until interpolation lands; `?tick=60` (or 30, 120) runs the fixed tick now, so it can be felt and measured. Expect judder on a 144 Hz screen until stage 6. | S (1-2 sessions) | `tools/determinism-check.ts`: a scripted headless fight twice at different frame rates (30, 60, 144 fps of render) gives the same world hash | Everything below |
| **2. ECS core** | `src/ecs/`: world, ids, columns, queries, systems, events, resources; replication tags. No game code moved. | S | `ecs-check`: add/remove/query against brute force, id reuse, column growth | 3-5 |
| **3. Damage as data** | Split `Battlefield`: `HitSystem` (pure: shots, sheets, splash, armour, matter, status) emits `Hit`/`Blast`/`Death` events; FX and sound consume them. `Hittable` adapters become thin bridges writing ECS components. Seeded RNG for spread. | M (2-3 sessions) | The existing weapon, sheet, splash and armour checks unchanged; a new event-stream parity check | 4-7, co-op damage |
| **4. Crowds onto the ECS** | Robots, then infantry: their SoA arrays *become* component columns (mostly a rename); their AI becomes systems; their draw classes become render systems reading `Transform`. Register rebuilt from components. | M each | robots-check, infantry checks, robotworker parity | Rate groups, per-kind render |
| **5. Heavies onto the ECS** | Mechs (player, rival, guardians, replicas), war band vehicles, escorts, crushers, striders: opaque sim components (walker, car); `MechUnit` split into sim (no three) and a render system. | L (several sessions, one kind per PR) | Duel and walker checks; `weaponscaling-check`; duel sim headless | Co-op mechs on the host |
| **6. 60 Hz + interpolation** (Keith 2026-11-07: 30 or 60 fine, drawn 144-200+) | Tick to 60 by default; walker and car substep ×2 inside; `PrevTransform` and interpolated drawing; rate groups for far LOD. A slider and `?tick=120` keep the old feel to compare. | S-M | Determinism check at 60; walker feel numbers (cadence, swing, bob) equal to the 120 Hz run within tolerance | The performance goal |
| **7. Host world in the worker** | The whole host world steps in the worker; one snapshot (dirty columns) + events back; main is the view, with the local mech predicted. `robotsRemote`/`escortsRemote` retired. `?noworker` runs the same world on main. | M-L | Parity: worker and main worlds equal bit for bit for a scripted run (the generalised robotworker check) | Co-op transport |
| **8. Co-op transport** | WebRTC data channel carrying the same protocol, quantised, 20-30 Hz, interest-managed; signalling server; remote mechs interpolated. | L | A two-tab headless test: same world hash at the host, remote sees within quantisation | Co-op |
| **9. Clean-ups** | Random lint, config resources (F8), ground height cache (F9), state.md dedupe (F12). Do these whenever convenient; they are independent. | S each | Their own checks | — |

Notes:
- **Stage 1 before anything else.** Changing the tick later is a one-line change only if every system reads the
  scheduler. It also makes every performance measurement repeatable (the `?bench` A/B already wants this).
- **Stop adding per-system worker remotes now** (robots and escorts stay as they are until stage 7). The parallel
  "move the swarm into the worker" work is done, and the next candidates in `handoff-simworker.md` (deaths, guardians)
  should wait for stage 7 rather than get their own remotes.
- **The draw-cost and far-sim threads aren't blocked.** Merged parts and instancing feed stage 4-5's render systems
  directly, and far-sim LOD is stage 6's rate groups. Their code should keep sim data in plain numbers (not in
  `Object3D`s) so it carries over.
- **Content work goes on during the migration.** New enemies written after stage 4 should be written as ECS
  entities. Before that, writing them as today is fine.

---

## 6. Tick rates: what ARPGs and others use

**Known** means published by the developer or measured and reproduced widely by the community (breakpoint tables
built from frame counts). **Reported** means it comes from community claims with no developer source found.
**Unknown** means nothing reliable was found.

| Game | Game-logic tick | Status | Source |
| --- | --- | --- | --- |
| Diablo II | 25 per second (40 ms) | Known (community-measured; every attack and cast breakpoint table is built on 25 fps frames) | [maxroll D2 breakpoints](https://maxroll.gg/d2/resources/breakpoints-animations) |
| Diablo III | 60 per second (16.7 ms) | Known (community-measured; attack-speed breakpoints in 1/60 s frames) | [maxroll D3 breakpoints](https://maxroll.gg/d3/resources/attack-speed-breakpoints-explained) |
| Diablo IV | 60 per second | Reported (community: "checking the game state every 60 frames"; attack-speed breakpoints exist) | [maxroll D4 attack speed](https://maxroll.gg/d4/resources/attack-speed-mechanics) |
| Path of Exile | ~33 ms server tick (~30 per second) | Reported (forum posts; cooldowns and channelled skills appear to resolve per server tick; no GGG statement found) | [PoE forum: CWC and server tick rate](https://www.pathofexile.com/forum/view-thread/3181125), [server frames and channelling](https://www.pathofexile.com/forum/view-thread/2936557) |
| Path of Exile 2 | Unknown | — | — |

From memory, not checked this session: shooters with competitive netcode run higher (Valorant and CS2 servers at 128
and 64 Hz plus sub-tick input; Overwatch at about 63 Hz). Big co-op and battle-royale games run lower (about 20-30 Hz).
Treat these as background, not facts.

What this tells us:
- ARPGs run their rules at **25-60 Hz** and feel smooth because animation, movement prediction and effects are drawn
  at the display rate. Nobody feels a 16.7 ms damage tick. Players notice breakpoints only because the tick quantises
  attack speeds, and with continuous fire rates we can avoid that by carrying fractional time per weapon.
- **60 Hz** is the right rule tick here:
  - It's as fine as Diablo III/IV.
  - It halves the sim's per-second cost against today's 120 Hz substeps.
  - Fast things are already swept rays.
  - The walker keeps its 120 Hz feel through internal substeps.
- **30 Hz** would also be defensible for enemies far from the player (as a rate group), but not for the player's mech,
  melee timings (parry windows of ~100 ms are 3 ticks at 30 Hz, 6 at 60), or the sword's swing contact. So 60 Hz base,
  with 30 and 15 Hz rate groups for far or idle entities.
- **Network snapshots** to remote peers at 20-30 Hz (≈ 40-60 KB/s per peer for 300 robots, `multiplayer.md`'s
  estimate), interpolated with about 100 ms of buffer.
- **DoTs** (burning, fire pools) can tick their damage at whatever rate design wants (4-10 Hz is usual in ARPGs), with
  the effect shown every frame.

---

## 7. Open questions for Keith (defaults chosen; none blocks stages 1-3)

1. **Tick:** answered (Keith 2026-11-07): 30 or 60 Hz is fine, drawn as fast as the graphics allow. We're going with
   60, and `?tick=30` lets you compare.
2. **ECS:** in-house (default) or bitECS? In-house keeps the storage under our control for the snapshot and network.
3. **Order:** stages 1-3 first (default, small and invisible), then crowds, then heavies. Or heavies first if co-op
   mechs matter sooner?
4. **The worker:** pause per-system worker moves until stage 7 (default)?
5. **Co-op authority:** the host-authoritative listen server from `multiplayer.md` (default). Nothing here changes it.
