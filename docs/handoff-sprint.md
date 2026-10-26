# Handoff: the sprint (2026-10-26)

Branch: the sprint worktree (`worktree-agent-af697ad4a95739088`). Spec: `docs/proposal-bound.md` (Keith's answers at
the bottom, "As built" after them).

## Done and working (committed, all checks pass)

- **Input**: Space dashes at once; keep holding and the sprint starts as the dash's shove ends (or after `boundTap`
  0.2 s with no charge). Let go: lands out of the stride, runs on, skids the rest. Rocket boost on hold removed.
  `src/mech/bound.ts` (`Bound.update`), `src/mech/dash.ts` (`stop()`, `boosting`, no boost phase).
- **Gait** in `src/mech/walker.ts` (`bound` flag): `boundStart`, `boundStep` (stance), `boundLaunch` (push-off),
  `boundLand` (touchdown under `boundAbsorb`), `endBound` (let go mid-stance), `airFoot` (leap leg poses),
  `boundTurnRates`, `faceScrub` (walls). Gallop: staggered two-foot stances, lead foot swapping, trailing leg drawn up.
- **Walls / fling fix**: `faceScrub` on sprint, dash push, skid, walk; `launchUpMax` cap in `leaves()` and push-off;
  air contact while rising into a face (`fly()`).
- **Handling**: grip turning, drift and skid (`footSlip`), little air steering.
- **MechUnit**: `bound` member, guns while sprinting (`boundGuns`, `airSpread`), dust per stride (`boundDust`), skid FX,
  crowd shove via `onDash`. **Fuel**: `fuelBound` per metre (`fuel.ts` `Burn.bounding`); "sprint home" HUD line
  (`loop.ts` `homeSprint`, `expeditionHud.ts`). **Camera**: `IsoCamera.update(target, dt, motion)` look-ahead and
  pull-out. **Labs**: walker, combat (`combatLab.ts`), convoy (sand only). Spike file deleted.

## Values

Rampart top 14 m/s (Stilt 18, Siege 12 in `legTypes.ts`), build 0.3/s, push-off 2.4 m/s, stance 2.1 m, stagger 0.3,
reach 0.6, split 1.6, swing 6/s, lean 18°, grip 0.7 g, yaw 0.6, drift max 30°, absorb 7 m/s; walls 0.9 / 1.6 rise per
m, `launchUpMax` 6 m/s; booster +3 m/s, glide 0.3, burn 0.25/s; guns on, air spread 3°; fuel 0.27 s/m; camera lead
0.6 s from 7 m/s (max 14 m), pull-out 1.2 m per m/s.

## Half done

- **Filmstrips**: side at 10 and 20 m/s seen and good (runs, push-off, lean). Still rendering when stopped: side 14,
  game camera 14, crest side/game, dash into a 55° wall. Scripts in the session scratchpad `sprint/strips.sh` (build
  with `build.mjs`, `fstrip.mjs`). The box is slow (software GL, 2 CPUs): one strip takes 10-30 min.

## Left, in order

1. Look at the game-camera, crest and wall strips; tune dust per stride and the camera lead if they read badly.
2. Keith plays it: gallop feel, 14 m/s, crest risk (Rampart lands ~11-13 m/s off big crests: a little damage), guns.
3. `boundTop` (and grip, hop) as a stat on leg items (`src/items/bases.ts`, `loadout.ts` `ResolvedValues`).
4. Landing poses aimed at steep faces; chasers that keep up; fortress jumps.

## Known issues

- A sprint into a 50° face can still hop partway up it (hips stay within 1.5 m of standing, so no fling).
- Running into a cliff mid-leap lands hard (stagger, a little damage) by design of "speed into the ground".
- `airSpread` only widens minigun rounds, not the arsenal's other weapons.
- Booster stays a simple top-speed + glide.

## How to test

- Checks: `npx tsx tools/walker-check.ts` (sprint section per leg type), `tools/dash-check.ts` (walls),
  `tools/expedition-check.ts`; all of `tools/*-check.ts` pass (infantry/robots timing limits can trip on a loaded box).
- Walker lab: `?bound&walk=straight` (demo sprints), `&flat&cam=side`, `&set=boundTop:20,boundBuild:3`, `&warm=6&dt=0.033`;
  `?wall=55[,8]&dashat=4.8&walk=straight&flat` (dash into a wall); crest flight in the straight demo at about 21-22.7 s.
- Any combat lab or the convoy lab (`?out`): hold Space while driving.
