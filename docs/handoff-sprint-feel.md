# Handoff: sprint feel (Keith's 2026-10-26 21:54 notes)

Branch: `worktree-agent-aa90ff3f2a624b66d`, pushed to `wip/sprint-feel`. Delete this file when the work merges.

## The six items, in order (each its own commit)

1. Weapons off while sprinting, torso faces the travel line, hull leans forward; HUD shows SPRINT. done (`Bound.gunsOff`,
   `MechUnit.gunsOff`, `UpperSim.leanFwd`; walker-check "sprint weapons").
2. Lean into turns while sprinting. done (`WalkerSim.turnLean`, `orient`, `hullRoll`; walker-check "leans into turns").
3. Uphill cadence. done (`WalkerSim.runCadence`, the reach cap in `body()`, run reach in `aim()`; slope-check sprint
   cadence section). Values: runClimbSteps 0.1, runDescentSteps 0, runHurry 0.3, runReachGive 0.1.
3b. npm test green (coordinator): toes clear in swing (`toesClear`, toeClear 0.1), knee stop (kneeMaxPlanted 165), run
   swing within reach; outdated limits moved (bob, ramp clearance, side fold, swing thigh, dash charges), reasons in checks.
4. Perceived speed: sprint swing the snappiest (whip-through), cheap cues. **next** (measured: thigh mean swing speed
   walk 451, Shift run 643, sprint 363-414 deg/s; swing 0.55-0.66 s vs 0.8-0.9 s; `sf/hip.mts`)
5. Impact into the ground (compression, push-off kick and toe dig, shake, thump). todo
6. Feet sink into soft ground (per-surface sliders, on the plant target). todo

## Checks

`npm test` is fully green since step 3b; keep it green.

## How to test

- Typecheck: `npx tsc --noEmit -p . --preserveSymlinks`. Checks: `bash <scratchpad>/sf/checks.sh [walker slope ...]`.
- Scratchpad `sf/`: `cad.mts` (sprint cadence per grade), `climb.mts`, `weave.mts`, `probe*.mts`, `stick2.mts` (stick
  strips in the mech's frame, VIEW=side|back), `base/` (the starting commit, for comparisons: WT=<that dir>).
- Rendered strips: `sf/strips.sh` (slow).
