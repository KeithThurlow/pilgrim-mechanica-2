# Handoff: walk fix (Keith 2026-10-27: walk and run look bad; then his main-vs-branch notes)

Branch `wip/walk-fix` (on top of `wip/sprint-feel`, main merged after the scale build). Delete this file and
`docs/handoff-sprint-feel.md` when it merges. Done; waiting for Keith to judge the feel in the lab.

## Done

- **Walk and Shift run use the cannon and toes like the sprint** (`walkerTuning.ts` defaults): `hockExtend` 0.8, `rollOff` 70,
  `rollStart` 0.4, `swingTuck` 45, `liftHold` 0, `liftBox` 0. Push-off cannon -26° -> +21°, heel 70°; thigh swing speed
  walk 1830 -> 535°/s, Shift run 2650 -> 950°/s (main vs branch, `wf/table.mts`).
- Main's swing toe clamp (8aaa2bb) flattened the walking foot: walking it now only bends the toes up to the ground
  (`moveFoot` -> `toesClear(f, env, sprintK > 0, sprintK)`); the sprint keeps the full clamp.
- **Sprint back to main's shape**: the whip (19303de) removed. Keith's 4 m stance stretched the trailing cannon up to
  0.5 m: `toeDrag()` drags a planted toe on at full stretch (run and the landing stance). Reach misses 0.5% / 1.5%.
- Sink: sand 0.35 m (`sink.ts`); walking, the hips sink with the feet (`body()` `under`).
- Sliders: see decisions.md 2026-10-27 (15 removed or off the panel, 6 ranges widened).
- Checks: walker-check flight only where the planted share < 0.48; slope-check hips over planted spots; deaths-check
  seeded. All `tools/*-check.ts` pass.

## Not done (sprint-feel polish)

- Push-off sand (`sprintPushDust` 0.8), shake (`sprintShake` 0.05, ~1/10 of a 3 m landing), thump (`sprintThump` 0.35,
  about half a soft landing) left at the previous agent's values: Keith judges in play.

## Try

Walker lab: `?walk=straight&flat&cam=side` (walk), add `&sprint` (Shift run), `&bound` (sprint);
`?set=sinkSand:0` (no sink).
