# Handoff: plough width (Keith 2026-10-26)

Keith: the plough should cut a road only as wide as the main convoy platforms, not a lane for the escorts too; the
escorts should meander over the rougher ground beside it.

## Done
- Road and blade: `routeHalfWidth` 30 → 11 (22 m road; the widest car with its tracks is 19 m), `routeBlend` 15 → 8,
  `bermOut` 8 → 2 (`src/convoy/route.ts`, `wake.ts`). The blade model already sizes itself from the half-width.
- Escorts (`src/convoy/escort.ts`): stations out on the dunes (`escortOut` 25, new `escortSpread` 5 per-escort in/out,
  `escortWeave` 6 on a per-escort period); scouts ahead of the blade and out to the sides (new `escortScoutLead` 30,
  `escortScoutOut` 24); a local planner (`plan()`): a fan of headings scored by the slope under a short drive along
  each, road and platform costs, commit to a side when going round; stuck → back out and go round the other side;
  ease off over rough ground; hard platform rule applied after the mech's.
- Car sim (`src/vehicles/car.ts`): the stick-to-ground pull measured from the plane through the wheels' ground at
  the body's middle (was the ground right under the middle: stalled trucks in hollows); bumpLoss scaled down when
  crawling (under ~2 m/s).
- `tools/convoy-check.ts`: road width against the train; car corners on the road; escorts off the road share,
  slowest 10 s pace, worst roll.

## Half done / left (in order)
1. Escorts still: an occasional big roll (~50°) and one stuck spell in convoy-check section 11. Tune the planner.
2. Two-line trains (`trainLanes` 2) ride off the narrow road: make the road half-width grow with the lanes.
3. Mech-over-berm check fails (the berm now sits on the cut face); launch landing on the berm off by 0.8 m/s.
4. Road continuity check marginal (0.243 vs 0.24).
5. Shots, state.md, decisions.md.

## Scratch probes (delete before merge)
`tools/escort-probe.mts`, `tools/escort-probe2.mts`, `tools/slope-probe.mts`.
