# Handoff: sim in a worker (started 2026-11-06)

Plan and rules: `docs/proposal-simworker.md`. Worker path on by default; `?noworker` compares.

## Done
- Plan written and agreed (Keith 2026-11-06).
- Step 1 (merged): `src/sim/` host, worker, messages, ground events (recorder taps the objects' methods; outermost call only;
  values diffed before each event), ground mirror; `src/expedition/sitesGround.ts` split out; `tools/groundmirror-check.ts`.
  Rules for the mirror: the worker's `route.onChange` must do to the ground what the lab's does (today: craters.invalidate);
  `pois.extra` (hand-placed pads) isn't mirrored (the convoy lab never uses it); objects in the values aren't mirrored.

## Next, in order
1. Step 2: terrain building (chunks.ts TerrainStreamer build + patch strips, groundWindow.ts) through the worker.

## Facts to start from
- The worker is `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` in `src/sim/host.ts`; add
  message types in `src/sim/messages.ts`, and the frame's answer comes back in `SimHost.receive` a frame later.
- Convoy lab loop: `labs/convoy/main.ts` ~line 990-1130 (fixed substeps, then bodies, patches, flushGround).
- Profiles: `/mnt/project-files/pc-profile-siege-prod.md` (16.2 ms: sim 7.8, submit 7.3).
- Headless probes run on WebGL/swiftshader (~7 s a frame in the convoy lab: wait ~150 s); see `/mnt/project-files/perf/handoff-frame-rate.md`.
