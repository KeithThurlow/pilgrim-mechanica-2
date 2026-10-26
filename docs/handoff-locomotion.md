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
- Step 4 (slopes) built, WIP: uphill, `uphillLead` sends the swinging foot forward early (the long thigh can only rise
  once the foot is ahead) and `swingThighFold` past `swingFoldFrom` squash raises the swinging thigh (`foldTheta`: knee
  placed at the wanted angle, hock solved behind; the angle eased 1.5°/frame and the cannon 4°/frame so it never
  jumps). Downhill, `legReachMax` (0.93): `aim()` marks a target out of reach `short` and lifts it to the lowest
  reachable point; a short foot `hang`s instead of landing; with nothing planted the mech `launch`es and falls; in
  `body()` the hips never ride above what planted legs reach (not in the run, where hull clearance wins). `slope-check`:
  mid-swing thigh uphill 76° (0° before), planted legs within the cap on 17° and 33°, walking off 3 and 6 m faces drops
  and walks on. Walker check allows up to 3 drops on a dune walk (was 1).
- Step 2 (dash) built, WIP: `src/mech/walker.ts` `dashMove` starts when `push` passes 2 m/s (`dashBegin`: push foot P =
  the planted one, the one further back along the dash if both, the lower if neither; lead L = the other), `dashFeet`
  (P held `dashPushTime` or until full stretch / spread, then drawn back beside L over `dashRecover`; L steps out
  `dashLeadReach` toward the dash over `dashLeadTime` and slides; the two sit apart across the dash direction, keeping
  their order (`sg`) so they never cross; spread capped at `dashSpreadMax`, legs at `legReachMax`), `hipOpen` (pelvis
  turns toward the dash, `dashHipOpen`), `kneeYaw` (lead knee, `dashKneeOut`), `dashEnd` (foot behind steps first),
  `runFromDash` (held: run at up to `dashIntoRun`, course within drift of the heading). `src/mech/dash.ts`:
  `dashPushShare` ramps the shove in (same distance), `cut()`. `src/mech/bound.ts`: `dashHoldRun` (0.15 s) held into a
  dash cuts it into the run. `dash-check`: 80 dashes (walking/standing, 8 step phases, 5 directions) keep the feet
  within 2.6 m (old code: 3.0) and are back in gait right after the slide; held dash runs after 0.15 s at 11 m/s with
  alternating footfalls.
- Next: step 3 slide dust, 5 labels, filmstrips (batch 1 running: side10 side14 rampside upside downside).

## How to test

- Typecheck: `npx tsc --noEmit -p . --preserveSymlinks`. Checks: every `tools/*-check.ts` with `npx tsx`.
- Filmstrips: scratch scripts (`build.mjs`, `shotg.mjs`).
