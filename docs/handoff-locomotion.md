# Handoff: locomotion (Keith's playtest notes 2026-10-26 18:28)

Branch pushed as `wip/locomotion`. Read `git log` and this note first when resuming.

## Task, in order

0. Keith's tuned values become the defaults. **Done.**
1. A real ground sprint gait (even left/right cadence, short flights, level hull, sprinter push-off, tuck, reach);
   the old bound becomes the airborne/landing entry; hull keeps clearance over rising ground (look-ahead).
2. The dash as a push-off off the planted leg: hips open, other knee drives out, slide, recover; hold flows into
   the sprint; cap leg spread.
3. Slide dust: any skidding foot throws dust and clumps along its carve (dash, drift, landing, downhill slides).
4. Slopes: uphill let the thigh rise toward horizontal; downhill cap leg extension and drop/slide instead.
5. Dust slider labels say what they do (stompCloud 0 still has toe-kick dust: keep the look).

Checks go in `walker-check`, `slope-check`, `dash-check` (no new files). Filmstrips: flat sprint 10/14 m/s, ramp
sprint, dash tap mid-step, dash held into sprint, downhill off a face, uphill walk.

## Step 0: values changed (Keith's pasted values that differed from the code)

| Key | Where | Was | Now |
| --- | --- | --- | --- |
| `boundDust` | `src/mech/bound.ts` | 0.55 | 1.9 |
| `dashLean` | `src/mech/dash.ts` | 9 | 19 |
| `stompCloud` | `src/fx/dust.ts` | 6 | 0 |
| `stompClump` | `src/fx/dust.ts` | 7 | 1 |
| `stompSize` | `src/fx/dust.ts` | 0.9 | 0.8 |
| `airSpread` (gun) | `src/mech/bound.ts` | 3 | 3, **renamed `airGunSpread`** |

- **Name clash fixed:** `airSpread` was two sliders: the walker's "feet apart in the air (× stance)" (1.15) and the
  sprint kit's "extra gun spread in the air (°)" (3). Every lab merges the mech values after the walker's, so the
  walker read 3: feet 3× the stance apart in every drop and crest flight. The gun one is now `airGunSpread`; the
  walker's stays 1.15. Keith's 3 was the gun's.
- `boostFuel` 4 was Keith's play with a booster on: the default stays 0 (no booster pack).
- `femur`, `shin`, `cannon`, `cannonRake`, `ankleHeight` are read from the model: skipped.
- Every other value already matched.

## State

- Step 0 committed.
- Step 1 (run gait) built, WIP: `src/mech/walker.ts`: `runK` (run share, eases over `runBlend`), `running`,
  `dutyNow`/`cpsNow` (planted share rate-limited at 0.5/s so feet never flip stance/swing), `runStart`/`runEnd`/
  `runSteer` (the bound's speed build, grip, drift, walls, ported from `boundStep`), `tuckPose` (FK tuck from
  `runThighUp`/`runShinBack`/`runHockFold`), `runSwing` (Hermite swing path in the body frame: follow-through back,
  tuck, reach, paw back into the plant), `groundAhead` + `runClear`/`runLookAhead` and a feed-forward spring
  (`Spring.stepFF`) for hull clearance, `runFromStance` (after a crest/fall landing stance, run on; `entryU` eases a
  mid-swing foot onto the path). `boundGallop` 1 brings back the old gallop. Sliders in `walkerTuning.ts` (Sprint
  group). `walker-check`: cadence (alternating, even, short flights, hips level) and ramp clearance checks; both fail
  on the old gallop (repeats, 0.5 s flights, 0.7 m hip bounce, 0.74 m hull clearance on 25°) and pass now.
- Next: step 4 slopes (legReachMax, swingThighFold sliders exist but are not wired yet), then step 2 dash, 3 dust.

## How to test

- Typecheck: `npx tsc --noEmit -p . --preserveSymlinks`. Checks: every `tools/*-check.ts` with `npx tsx`.
- Filmstrips: scratch scripts (`build.mjs`, `shotg.mjs`).
