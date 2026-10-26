# Handoff: performance pass 1, the worst case, the scale proposal (2026-10-26)

Branch `worktree-agent-a75ac043d2ce94ef9`, pushed to `wip/performance`. Detail and tables: `docs/perf-2026-10-26.md`
(section "Pass 1" and "The worst case"); the proposal: `docs/proposal-scale.md` (waiting for Keith).

## Done (fixes 1-5 of the ranked list), stress lab at 100%, headless CPU profile, ms per frame

| | before | after |
| --- | --- | --- |
| busy CPU, whole frame | 103.5 | 56.4 |
| ground height function, all callers | 41.5 | 9.5 |
| dust sim / dust draw | 6.3 / 26.6 | 0.7 / 1.8 |
| robots draw (of which `setHex`) | 12.7 (3.5) | 5.6 (0) |
| small robots' legs' ground | 4.1 | 0.4 |
| shadow pass triangles (terrain share) | 1,075k (385k) | 786k (6k) |
| 60 deaths in one frame: worst physics frame (node) | 56-121 | 13-26 |

1. Dust: `src/world/chunkGround.ts` (cheap ground off the chunks' triangles), per-puff ground planes in `dust.ts`
   (`floorAt`) and `dustDraw.ts` (shadow point), sun march every 8 frames. Sliders `dustGroundRefresh`,
   `dustGroundEvery`, `dustSunEvery`.
2. Dent patch casts no shadow when the shadow copy is on (`detailPatch.ts`). Spacing/window were already sliders.
3. Shadow-only terrain copy per chunk (`chunks.ts` `makeShadow`, `SHADOW_ONLY_LAYER`; `look.ts` enables the layer on
   the sun's shadow camera). Sliders `shadowTerrain`, `shadowSpacing` (4 m), `shadowSink` (0.3 m).
4. Robots draw: cached linear colours, colour upload only on change (`robotsDraw.ts`); `RobotSwarm.lookGround` for
   small legs (set in the stress, robots and convoy/swarmCamps wiring).
5. Ragdolls: `ragdollsPerFrame` (6) in `deaths.ts`; the rest queued, drifting ballistic until made.

Every new slider is in a "Performance" group; Performance topic added in combatLab, walker, convoy, terrain labs.
Checked: typecheck, `npm test` all pass; walker lab game-camera shots before/after at normal and low sun (no visible
change; low-sun dune shadows keep shape, no acne).

## Half done

- Patch spacing look check (0.25 vs 0.5 m at the game camera): shots were rendering when stopped
  (scratch `perf1/wz-new50.png`, `w-new50.png`). The default stays 0.25; the `PATCH` placeholder in
  `docs/perf-2026-10-26.md` ("Looks at the game camera") still needs the verdict. If 0.5 m looks the same at 40 m,
  make it the default (295k to 74k triangles).

## Left, in order

1. Finish the patch-spacing verdict above.
2. Fix 6: far bandits and robots: a near/far split per instanced mesh (far: no shadow; bandits a 300-500 tri bake past
   ~40 m), a shadow distance slider. Bandits (1.1M tris) and robots (650k) are now most of both passes.
3. Then the scale proposal's order of work, once Keith approves: effects budget gate, register (in progress
   elsewhere), shots as data, GPU particles.

## The worst case

`labs/stress/?worst` (`labs/stress/worst.ts`, sliders in "Stress worst case"): three AI allied Ramparts, every team
round through max-Protocol stand-ins wrapping the lab's own `bf.fire` (split 3, rate 2, area 1.5, 1 ricochet, chain 3),
effect-count sliders x4, a barrage per player. Measured (headless, run at 100%): sim tick 50 to 83 ms; team fire calls
~1 to 32 a frame (54 peak); dust requests 92 to 3,508 a frame into a 4,096 pool (recycled within ~a frame); tracers
0.6 to 38.5; bodies 5 to 147; meshes 93 to ~120, triangles +5%. Rendered draw counts not taken (software rendering is
~20 s a frame here); the in-page traversal counts stand in. The run table also reports shots, rounds, ricochets and
chain hops.

## Known issues

- `tools/deaths-check.ts` is flaky (2-3 in 90 runs a robot ragdoll part ends 0.3 m+ under a flat floor); the same rate
  before this pass (measured), random spins, not the queue.
- `worst.ts` reads Battlefield's private `hit` vector for the round's end point; if the rail agent's sheet hits change
  `fire`, recheck it (stress lab only).
- The ChunkGround is up to 13 cm off the true ground between vertices: looks only, never for rules.
- The triangle script misses the bandits' VAT mesh (instanced geometry, not InstancedMesh).

## How to measure

Scripts in the session scratchpad `perf1/` (copy them): `build.mjs` (esbuild bundle into `site/`), `prof.mjs url warm
rec` (CPU profile, `SITE=`, `OUT=`), `callers.mjs frames` (who calls the ground), `incl.mjs` (inclusive per
function), `selfby.mjs` (grouped self time), `run.mjs` (the stress Run table; `NOSHOT=1`), `shadowtris.mjs site url`
(triangles and meshes in view and the shadow pass), `probe.mjs url frames expr` (evaluate in the page),
`shotg.mjs` (shots; `SITE=`). The box is too loaded for the full 25-150% ramp; use `?run&steps=100&settle=2&hold=3`
and CPU profiles, and read ratios. Keith's PC: open the stress lab, Run, copy the table.
