# Handoff: cutting three's per-object draw cost (2026-11-07)

Goal: fewer objects through three's renderer (~14 µs each on Keith's PC, ~330 a frame in the convoy siege). Plan in
`docs/engine-options.md` A.1-A.4. One change per PR, merged to main when `npm test` passes, each with a play checklist.

## Measuring
- `npm run dev`, then `CHROME=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome node tools/drawcount-probe.mjs "labs/convoy/?siege&manual" 25`
  (about 3 minutes on the cloud box's software GPU). `DRILL=rampart` splits an owner by part; `TREE=1` lists the scene
  graph by owner (all, hidden, auto-updating matrices). Object counts are exact; times only compare runs on one machine.

## Done
- A.1 merged parts (PR 1): weapon models (`planFor` in `src/weapons/weaponModel.ts`), code stand-ins (`mergeTinted` in
  `src/look/mergeGeometry.ts`: sensors, pack, arm stand-ins). `?nomerge` compares. Siege camera pass 209 → 111.
  Check: `tools/mergeparts-check.ts`.

- A.2 matrix work (PR 2): hidden subtrees skip the walk (`src/core/matrixSkip.ts`, `?allmatrices` off), ink shells and
  POI sites frozen, crushers off screen hidden. Siege matrix walk 2.16 → 1.28 ms (cloud box).

- A.4 shadows (PR 3): the terrain's shadow copies batched in `src/look/shadowProxies.ts` (shadow-only layer kept).
  Siege shadow pass 42 → 23.5 objects.

## Next, in order
1. Still walking every frame: guardian mechs off screen (~100 objects each; the robot-swarm thread owns guardians),
   escorts (~150), the player's mech (~280).
2. What's left in the camera pass after PR 1: unnamed "Group" owners (~21 objects: boxes, spheres, a ring), the Rampart's
   own bone meshes (16 a mech: they ride different bones, so they can't merge), drums.
3. Camera pass after all this: ~111 in the siege: 16 bone meshes a mech (separate bones, can't merge), the feeds,
   ~20 small FX and reticle meshes, 7 terrain chunks.

## Known
- A painted mech (guardian, bandit, wreck) caches its paint list on its first paint; a sensor fitted after that isn't
  repainted (true before the merge too).
