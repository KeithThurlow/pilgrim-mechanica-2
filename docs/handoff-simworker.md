# Handoff: sim in a worker (started 2026-11-06)

Plan and rules: `docs/proposal-simworker.md`. Worker path on by default; `?noworker` compares.

## Done
- Plan written and agreed (Keith 2026-11-06). No code yet.

## Next, in order
1. Step 1: `src/sim/host.ts`, `src/sim/worker.ts`, `src/sim/messages.ts`; ground mirror (`src/sim/groundMirror.ts`: a DuneField
   built from the same values, the route, POI pads, fortress walls and craters replayed from events); `tools/groundmirror-check.ts`.
   Find every place the convoy lab changes the ground (route.update, craters add, gates down, POI extras, values) and send each
   as an event.
2. Step 2: terrain building (chunks.ts TerrainStreamer build + patch strips, groundWindow.ts) through the worker.

## Facts to start from
- Convoy lab loop: `labs/convoy/main.ts` ~line 990-1130 (fixed substeps, then bodies, patches, flushGround).
- Profiles: `/mnt/project-files/pc-profile-siege-prod.md` (16.2 ms: sim 7.8, submit 7.3).
- Headless probes run on WebGL/swiftshader (~7 s a frame in the convoy lab: wait ~150 s); see `/mnt/project-files/perf/handoff-frame-rate.md`.
