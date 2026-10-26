# Handoff: sprint feel (Keith's 2026-10-26 21:54 notes)

Branch: `worktree-agent-aa90ff3f2a624b66d`, pushed to `wip/sprint-feel`. Delete this file when the work merges.

## The six items, in order (each its own commit)

1. Weapons off while sprinting, torso faces the travel line, hull leans forward; HUD shows SPRINT. **in progress**
2. Lean into turns while sprinting (roll by lateral acceleration, drift, inside leg short). todo
3. Uphill cadence (strides/s per degree of grade, stride shortens). todo
4. Perceived speed: sprint swing the snappiest (whip-through), cheap cues. todo
5. Impact into the ground (compression, push-off kick and toe dig, shake, thump). todo
6. Feet sink into soft ground (per-surface sliders, on the plant target). todo

## Baseline before this work (Keith's tuned values; see state.md In progress)

`walker-check`, `slope-check`, `dash-check` already fail on Keith's values (flat swing clearance 0.00-0.02 m, sprint
reach misses 5-7%, run bob 0.35 m, ramp hull clearance 1.1-1.6 m, Stilt flights 0.23 s, wall rise 7.0 m; slope: side fold
and mid-swing thigh 36°; dash: 3 dashes from full charges). Every other check passes. Don't "fix" by reverting his values;
new checks must pass, and old numbers must not get worse.

## How to test

- Typecheck: `npx tsc --noEmit -p . --preserveSymlinks`. Checks: `bash <scratchpad>/sf/checks.sh [walker slope ...]`.
- Stick strips: `<scratchpad>/sf/stick.mts`; rendered strips: `<scratchpad>/sf/strips.sh` (slow).
