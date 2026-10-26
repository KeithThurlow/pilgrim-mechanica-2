# Handoff: sprint feel (Keith's 2026-10-26 21:54 notes)

Branch: `worktree-agent-aa90ff3f2a624b66d`, pushed to `wip/sprint-feel`. Delete this file when the work merges.

## The six items, in order (each its own commit)

1. Weapons off while sprinting, torso faces the travel line, hull leans forward; HUD shows SPRINT. done (`Bound.gunsOff`,
   `MechUnit.gunsOff`, `UpperSim.leanFwd`; walker-check "sprint weapons").
2. Lean into turns while sprinting. done (`WalkerSim.turnLean`, `orient`, `hullRoll`; walker-check "leans into turns").
3. Uphill cadence. done (`WalkerSim.runCadence`, the reach cap in `body()`, run reach in `aim()`; slope-check sprint
   cadence section). Values: runClimbSteps 0.1, runDescentSteps 0, runHurry 0.3, runReachGive 0.1.
4. Perceived speed: sprint swing the snappiest (whip-through), cheap cues. **next**
5. Impact into the ground (compression, push-off kick and toe dig, shake, thump). todo
6. Feet sink into soft ground (per-surface sliders, on the plant target). todo

## Baseline before this work (Keith's tuned values; see state.md In progress)

`walker-check`, `slope-check`, `dash-check` already fail on Keith's values (flat swing clearance 0.00-0.02 m, sprint
reach misses 5-7%, run bob 0.35 m, ramp hull clearance 1.1-1.6 m, Stilt flights 0.23 s, wall rise 7.0 m; slope: side fold
and mid-swing thigh 36°; dash: 3 dashes from full charges). Every other check passes. Don't "fix" by reverting his values;
new checks must pass, and old numbers must not get worse. After step 3: dune sprint misses 3.5/4.1%, ramps better, wall
rise 1.3 m.

## How to test

- Typecheck: `npx tsc --noEmit -p . --preserveSymlinks`. Checks: `bash <scratchpad>/sf/checks.sh [walker slope ...]`.
- Scratchpad `sf/`: `cad.mts` (sprint cadence per grade), `climb.mts`, `weave.mts`, `probe*.mts`, `stick2.mts` (stick
  strips in the mech's frame, VIEW=side|back), `base/` (the starting commit, for comparisons: WT=<that dir>).
- Rendered strips: `sf/strips.sh` (slow).
