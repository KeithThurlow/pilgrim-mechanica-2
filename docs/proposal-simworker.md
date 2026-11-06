# Sim in a worker, running alongside drawing (Keith 2026-11-06: approved; "we can always just revert back")

Goal: the convoy fight at ~7 ms CPU (144 fps), 100 fps floor. Today on Keith's PC (production build, `labs/convoy/?siege&manual`)
a frame is about 16 ms: sim 7.8 + render submit 7.3, one after the other on the main thread. With the sim's heavy work in a
worker, the frame becomes roughly the longer of the two instead of their sum. Background: `/mnt/project-files/perf/proposal-7ms.md`.

## Rules (Keith 2026-11-06)
- One system at a time, each step its own PR, merged when `npm test` passes, each with a play checklist.
- **The worker path is the default on main** as each step lands, so Keith tests it directly. `?noworker` runs everything on the
  main thread as before, for comparing; reverting the PR is the safety net.
- Nothing changes in how the game plays or looks. Every step gets a headless parity check: the worker's answer equals the
  main thread's for the same inputs.

## How it works
- **One module worker** (`src/sim/worker.ts`, started by `src/sim/host.ts` with Vite's `new Worker(new URL(...), { type: "module" })`).
  Plain messages with transferable typed arrays; no SharedArrayBuffer (it needs cross-origin isolation headers, which hosting
  may not give).
- **Results arrive a frame late.** Frame N: the main thread posts frame N's inputs and draws with frame N-1's results while the
  worker computes. That is where the overlap comes from. Systems where a frame of lag would be felt (the player's own mech,
  aim) stay on the main thread until the end.
- **The ground is mirrored, not shipped.** `DuneField.height` is a pure function of the values plus its modifiers (the road, POI
  pads, fortress walls, craters). The worker builds its own field from the same values and replays the same changes as plain
  events (route clock, craters dug, gates down, values changed), the way a co-op peer will (docs/multiplayer.md). A check
  samples both every step and fails on any difference.
- **Sims keep the multiplayer habits**: commands in, plain-data events out, stable ids. Moving a system means its glue stops
  touching scene objects inside the sim step and reads a snapshot instead.

## Steps (each one PR)
1. **Plumbing and the ground mirror.** Host, worker, message types, `?noworker`, HUD line (worker ms, lag, messages). The mirror
   with `tools/groundmirror-check.ts`. No system moved yet; nothing visible changes.
2. **Terrain building.** Chunk vertices (`TerrainStreamer`: build and the plough's patch strips), the ground window under the detail
   patch (`src/world/groundWindow.ts`). Pure ground maths out to typed arrays the main thread copies into geometry. About 8% of
   the PC frame (patchArea 2.8, groundWindow 1.7, detailPatch 1.7, chunk vertices 1.5). Check: worker arrays equal main-thread ones.
3. **Escorts** (`src/convoy/escort.ts` + car sims): about 5%. Out: each car's pose and wheels; in: the mech's position, the
   platforms' poses.
4. **Robot swarm and its fields** (swarm camps, crushers, striders): the largest sim block, and the one most tangled with the
   battlefield (shots, damage, line of sight). Shots and damage become events both ways.
5. **What's left of the sim** (deaths physics, dents, guardians), judged by the profile after step 4.

Expected: steps 2-3 take ~2 ms off the frame; step 4 most of the rest of the sim. The PC profile after each step decides the next.

## Open questions (recorded, not blocking)
- Keith asked whether this slows development once done. Some: a moved system's state lives in the worker and drawing reads a
  snapshot, so adding a field means adding it to the snapshot too, and a sim can't poke a mesh. Each step keeps that to a typed
  list per system, and `?noworker` keeps everything debuggable on one thread.
- The player's mech stays on the main thread (input lag). Revisit if the profile says it matters.
