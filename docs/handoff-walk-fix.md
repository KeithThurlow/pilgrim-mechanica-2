# Handoff: walk fix (Keith 2026-10-27: "the walk cycle and run cycle are looking pretty bad on the latest on main")

Branch pushed to `wip/walk-fix`; starts from `wip/sprint-feel` (fc9356e, see `docs/handoff-sprint-feel.md`) with main merged.
Delete this file (and the sprint-feel one) when the work merges.

## What broke the walk and the Shift run

Compared on flat ground (scratchpad `wf/gait.mts`, `wf/stick2.mts`) at 22c4407 (Keith's values), main and this branch.
Only two things differ for the walk (hips, body pitch and roll, swing heights all identical):

1. **`toesClear` in the swing (8aaa2bb)**: eased the foot's toes-down pitch and bent the toes up by 0.1 m clearance. The
   foot plate went flat and the toes pointed up through the swing (toe curl max 40° -> 12°): a shuffle.
2. **Knee stop `kneeMaxPlanted` 165° (8aaa2bb)**: the push-off knee 175° -> 165°, hock 118° -> 112°.

## Fix (done)

- Swing toes, walking (`moveFoot` -> `toesClear(f, env, sprintK > 0, sprintK)`): the pitch is left alone; where the
  curled toes would be in the sand the foot rises `toeLift` (0.3, new slider, Feet) of the way over them and the toes
  bend up for the rest so the tips just touch. The sprint (`sprintK` 1) keeps the old clamp exactly.
- Knee stop split: `kneeMaxWalk` (177°, new slider, Legs) for the walk and Shift run, `kneeMaxPlanted` (165°) for the
  sprint, blended by `sprintK` (`bound ? 1 : runK`).
- Sink: `body()`'s `under` also sinks (walking only), so on sand the whole walk sits 0.09 m lower with the same leg shape
  (the hips dropped only 0.063 before).
- walker-check knee limit: `kneeMaxWalk + 0.5` (was 172; reason in the check).

## Left, in order

1. npm test fully green on Keith's 5088dda values: sprint reach misses 5.0% / 5.2%, no flight at 10 m/s, slope-check.
2. Sprint-feel polish: push-off sand, per-footfall shake, thump (judge in strips).
3. Rendered strips of walk / Shift run / sprint; state.md, decisions.md.

## How to test

`npx tsc --noEmit -p . --preserveSymlinks`; `npx tsx tools/walker-check.ts`. Walk numbers: scratchpad `wf/cmp.sh walk shift`.
