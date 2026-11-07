# Handoff: sim in a worker (started 2026-11-06)

Plan and rules: `docs/proposal-simworker.md`. Worker path on by default; `?noworker` compares.

## Done
- Plan written and agreed (Keith 2026-11-06).
- Step 1 (merged): `src/sim/` host, worker, messages, ground events (recorder taps the objects' methods; outermost call only;
  values diffed before each event), ground mirror; `src/expedition/sitesGround.ts` split out; `tools/groundmirror-check.ts`.
  Rules for the mirror: the worker's `route.onChange` must do to the ground what the lab's does (today: craters.invalidate);
  `pois.extra` (hand-placed pads) isn't mirrored (the convoy lab never uses it); objects in the values aren't mirrored.

- Step 2 (chunk builds and patches): `src/world/chunkFill.ts`, `TerrainStreamer.remote` / `takeBuild` / `takePatch`,
  `chunk` and `patch` messages; `tools/terrainworker-check.ts`. The main thread's crater patches read a cache of the
  ground under the dents that can hold road it has since cut; the worker reads fresh (a few vertices differ, the worker's
  closer to the ground).

- Step 3 (escorts): `src/sim/escortsRemote.ts`; the convoy recorded (`GroundRecorder.convoy`) and the escorts' calls as
  commands in the same stream (`GroundRecorder.command`), so the worker steps them at the same points as the main thread
  would; snapshot back with each frame answer; `tools/escortworker-check.ts` (bit for bit). Ruts and dust are laid once a
  frame from the snapshot's moved total (was per substep). Commands bypass the recorder's depth rule: use them for calls
  the mirror doesn't make by itself (route.onChange's memo invalidation is nested inside convoy.update).

- Step 4a (robot swarm worker-ready): `RobotEvent` queue in `src/combat/robots.ts` (`step(dt, base)` returns the step's
  events, `dispatch(events, onShot, onBite, onCut)` hands them out; `update` = both); outside writes are methods
  (`setFrozen`, `shakeOff`, `scaleHp`, `setHealth`, `setPace`, `setShooter`, `primeAttacks`; plus `setTarget`,
  `clearTarget`, `damage`, `hitAt`, `hurtLeg`, `hurtOwn`, `trample`, `stomp`, `spawn`, `remove` as before). Tools still
  poke `hp[]` (headless only). `reactors.at` is still a synchronous read inside the step (4b: positions as a command).

## Next, in order
Step 4: the robot swarm (`src/combat/robots.ts` RobotSwarm, 2172 lines), specced 2026-11-06 (Claude). Keith's PC: far from
the convoy fighting robots the sim alone is ~20 ms (2026-11-06), so this is next. Headless (`?siege=120&manual&norender`,
20 awake): swarm camps 2.4 ms, turrets 2.0, mech 1.1; the PC fight's own stage list (a Report from it) would say more.

What it touches (2026-11-06 inventory): ~30 files read the swarm's arrays (drawing, targets, register, loot, ragdolls,
fights, fortresses, humans, droids, allies, bodyContact, robotBeam, chill, arsenal, energyGuns...). Writes from outside:
array pokes (`frozen`, `shake`, `hasT`, `hp`, `state`... in swarmCamps 6, fortresses 18, fronts/robots 8, humans 5,
allies 2, droidCamps, infantryTarget, robotTarget) and methods (`damage`, `hitAt`, `hurtLeg`, `hurtOwn`, `trample`,
`stomp`, `spawn`, `remove`, `setTarget`, `clearTarget`). Callbacks fired from inside `update` that act on main-thread
things: `onShot`/`onBite`/`onCut` (args of update), `onLob`, `onBeam`, `onPulse`, `onDeathBlast`, `onLegLost`,
`onDeath`, `onFootfall`. Hooks read inside update: `keepOut` (the safe zone round the convoy), `reactors` (the death
physics' falling cores: a synchronous read of Rapier, main thread), `lookGround`.

Plan, one PR each:
- ~~4a~~ (done) **4a, worker-ready, nothing moved** (pure refactor): every outside write goes through a method (`setFrozen`,
  `shakeOff`, ...: no more array pokes), every callback becomes a plain-data event queued during update and handed to
  the same handlers after it (`drain(handlers)`), `spawn` can take the slots to use. Behaviour changes only in that a
  handler's own effect on the swarm (a beam hurting robots) lands after the step instead of inside it. Checks:
  robots-check, robot-danger, robotweak, testswarm, the swarm and convoy labs' checks unchanged.
- ~~4b~~ (done, design below) **4b, the swarm in the worker** (convoy lab only, `?noworker` as now): main keeps a RobotSwarm as a view; its
  mutating methods apply to the view (so same-frame readers, e.g. damage's "killed", still work) and are recorded as
  commands in the ground's stream (`GroundRecorder.command`, as the escorts'); `update` is a command (dt, the prey);
  spawn picks slots on main and sends them. The worker answers each frame with the arrays drawing and targeting read
  (0..hi, transferables) and the queued events, which main hands to the handlers. `keepOut` is rebuilt in the worker
  on its own convoy (src/convoy/safeZone.ts); `reactors` positions go over as a command each frame (a frame late).
  The view's RNG state comes back in the snapshot.
- **4b design, as built (Claude 2026-11-06; src/sim/robotsRemote.ts):**
  - Known edge: at a lag of 2+ frames a call on the view acts on a state missing the worker's latest step (it can hit a
    robot the worker already killed); the death goes out once (uid) and the next snapshot puts the view right.
  - Snapshot = every typed array the swarm owns (private ones too, sliced to `hi`; per-leg ones `hi × 4`; fixed-size
    ones like the hash in full) plus its number/boolean fields and `cores`, found generically (`Object.keys`), so a new
    field needs no snapshot code. Main overwrites the view with it when it arrives.
  - Main-side ops (spawn, remove, damage, setFrozen...) apply to the view at once (their events, e.g. a death, are
    handed out there and then) and go to the worker as commands; the worker applies them silently (its hooks are null).
  - The step: `update` on main hands out the events queued from the worker's answers (with this call's handlers), then
    records the step; the worker runs the frame's steps after the frame's other commands.
  - Late snapshots: ops recorded after the snapshot's frame are replayed on the view, silently, after it's applied.
  - One random stream; its state comes back in the snapshot, so replayed calls draw what the worker's did.
- ~~4c~~ (done with 4b) **4c, the parity check** (`tools/robotworker-check.ts`): a camp fight headless both ways, bit for bit (as the
  escorts'), with damage, trample, stomps, spawns and a pack calming down.
- Then striders, crushers and droids (their own fields) the same way, if the PC profile says so.

Done before this: step 2b (the window's fine rows), step 3 (escorts, see Done).

## After step 4 (cloud bench 2026-11-07, Keith away a week)
- Headless `?siege=300&manual&norender&bench`: sim 7.8 ms (worker) vs 8.1-8.35 (noworker); swarm camps 2.4 vs 3.1. At
  `?siege` (40 robots) no difference. The swarm step was under 1 ms of the main thread here; the remaining swarm-camps
  time is drawing (`robotsDraw.update` ~1.1 ms, CPU per-instance work).
- Next candidates by main-thread ms in that fight: death physics (Rapier, `src/physics/deaths.ts`) ~1 ms, guardian mechs
  (`src/convoy/guardians.ts`) ~0.8, robotsDraw ~1.1 (drawing, stays on main: an LOD or cheaper small-leg pose), dust
  draw ~1. To do when Keith is back: his PC `labs/convoy/?siege&manual&bench`, to pick between them on real numbers.

## Facts to start from
- The worker is `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` in `src/sim/host.ts`; add
  message types in `src/sim/messages.ts`, and the frame's answer comes back in `SimHost.receive` a frame later.
- Convoy lab loop: `labs/convoy/main.ts` ~line 990-1130 (fixed substeps, then bodies, patches, flushGround).
- Profiles: `/mnt/project-files/pc-profile-siege-prod.md` (16.2 ms: sim 7.8, submit 7.3).
- Headless probes run on WebGL/swiftshader (~7 s a frame in the convoy lab: wait ~150 s); see `/mnt/project-files/perf/handoff-frame-rate.md`.
