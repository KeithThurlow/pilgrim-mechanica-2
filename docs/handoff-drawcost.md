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

## Next, in order
1. Static matrices (A.2): find owners with many auto-updating objects (`TREE=1`), turn `matrixAutoUpdate` off where
   nothing moves them relative to their parent.
2. What's left in the camera pass after PR 1: unnamed "Group" owners (~21 objects: boxes, spheres, a ring), the Rampart's
   own bone meshes (16 a mech: they ride different bones, so they can't merge), drums.
3. Shadows (A.4): casters are already batched (`src/look/shadowProxies.ts`); the shadow pass is ~44 objects, mostly
   terrain chunks (23).

## Known
- A painted mech (guardian, bandit, wreck) caches its paint list on its first paint; a sensor fitted after that isn't
  repainted (true before the merge too).
