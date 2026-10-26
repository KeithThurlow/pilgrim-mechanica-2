# Handoff: plough width (Keith 2026-10-26)

Keith: the plough should cut a road only as wide as the main convoy platforms, not a lane for the escorts too; the
escorts should meander over the rougher ground beside it.

## Done (all on `wip/plough-width`)
- Road and blade: `routeHalfWidth` 30 → 11 (22 m road; the widest car with its tracks is 19 m), `routeBlend` 15 → 12
  (8 left a wall the mech couldn't climb where a crest was cut), `bermOut` 8 → 2 (`src/convoy/route.ts`, `wake.ts`).
  `roadHalf(v)` in `wake.ts`: the half-width widened by `trainLaneSide` with two lines; route, wake, plough and
  escorts use it; the lab rebuilds the road when the lines change. The blade model sizes itself from it.
- Crane launch drops the mech 13 m out (`craneDeployReach` 21 → 13, `carry.ts`): 21 landed on the berm face.
- Escorts (`src/convoy/escort.ts`): stations 25 m out (`escortOut`), `escortSpread` 5, `escortWeave` 6 on a
  per-escort period; scouts 30 m ahead of the blade (`escortScoutLead`), 24 m out (`escortScoutOut`). Lane picker
  (`pickLane`, every 0.5 s) + line fan (`plan`, every 0.2 s, never > 1.6 rad off the route heading), both scored by
  `faceAt` (climb, side slope `escortRoll` 18, descent); stuck → back out, commit to the other side; ease off over
  rough ground; hard platform rule after the mech's; mech grazed on the outside. `duneKit` on the escorts' car values.
- Car sim (`src/vehicles/car.ts`): stick measured from max(ground under middle, wheel plane at middle); bumpLoss
  scaled down under ~2 m/s.
- `tools/convoy-check.ts`: road width vs train, car corners on the road; escorts off-road share, slowest 10 s pace
  (fail < 30%), leaning > 40° (fail > 0.5% of samples), tipped (roll at the sim's stop or > 75° off upright).
- All checks pass except robots/infantry timing under the box's load (pass alone; robots don't touch convoy or car).

## Left
1. Keith's look. Shots taken 2026-10-26 (session scratchpad `pw/`: plough-40.png, plough-75.png, convoy-120.png): the blade about the bay's width, scouts ahead on the dunes, escorts out on the dunes either side of the bay. Headless frames took ~25 s each on the loaded box, so no filmstrip of the weaving.
2. state.md Changes entry; remove the In progress line and this note on merge.

## Values
See above. Escort stats over 6 seeds × 2 min (scratch `tools/escort-probe3.mts`): 0.05% of samples lean past 40°,
4% of 10 s windows under half the convoy's pace, 99-100% off the road.

## Scratch probes (deleted; were untracked)
`tools/escort-probe.mts`, `escort-probe2.mts`, `escort-probe3.mts`, `slope-probe.mts`, `berm-probe.mts`.
