# Handoff: sprint feel (Keith's 2026-10-26 21:54 notes)

Branch `worktree-agent-aa90ff3f2a624b66d`, pushed to `wip/sprint-feel`. Main merged in at e1822b3 (main 5088dda, Keith's
clean-start sprint values). Work stopped 2026-10-27 at the coordinator's request; a fresh agent takes over. Delete this file
when the work merges.

## Done (each its own commit)

| # | What | Commit | On main? |
| --- | --- | --- | --- |
| 1 | Weapons off while sprinting after `sprintGunsAfter`; torso faces the travel line; hull leans forward; HUD SPRINT | 246dca5 | yes (2946b5e) |
| 2 | Lean into sprint turns (`turnLean`, `orient`, `hullRoll`) | 02360d8 | yes |
| 3 | Uphill sprint cadence (`runCadence`), the run's hip cap by reach, eased hurry, run reach in `aim()` | 117ed65 | yes |
| 3b | Check fixes: knee stop, `toesClear`, run swing kept in reach; outdated limits moved | 8aaa2bb | yes |
| 4 | Sprint swing whip (`runWhip` 0.5, `runWhipAt` 0.3 in `runSwing`) | 19303de | no |
| 5 | Sprint impact: plant compression, push-off sand and toe dig, shake, thump | b051c01 | no |
| 6 | Feet sink into soft ground (`src/mech/sink.ts`, `WalkerSim.sinkAt`, `Battlefield.sinkDepth`) | 96a953b | no |
| - | Walker lab `?turnat=seconds` | 42f2ba4 | no |
| - | Merge of main (state.md and decisions.md conflicts resolved, main's newer entries on top) | e1822b3 | - |

## Changes that affect the plain walk and the Shift run (not just the sprint)

The Shift run is the walk gait (`runK` 0); "run" in the code (`runK`, `running`) means the sprint. Everything gated on
`runK > 0`, `running` or `bound` leaves the walk and the Shift run alone.

1. **Knee stop, 8aaa2bb (on main).** `pose()`: a planted, not airborne leg's hock is kept within `dKnee` of the hip, where
   `dKnee` is the hip-hock distance at knee angle `kneeMaxPlanted` (165°, slider, Legs group). Past it, the binary search that
   already swung the cannon toward the hip for reach runs against this limit too (the hock opens), and `f.theta` is then
   rewritten from the cannon direction actually used. **This changes every walking stance near push-off** (the walk's knee was
   at 175-176° with Keith's `hockExtend` 0). To test whether it's the culprit: `?set=kneeMaxPlanted:180` turns it off. The
   `f.theta` rewrite also changes `liftTheta` at lift-off, so the swing's cannon starts from the opened angle.
2. **`toesClear`, swing, 8aaa2bb (on main).** At the end of `moveFoot`'s swing branch (walk swing too): on the plate's real
   frame, the toes-down `f.pitch` is eased (binary search) until the ball of the foot clears the ground by `m`, then `f.toe`
   is bent up until the toe tips clear. `m` peaks mid-swing at `toeClear` (0.1 m, Feet group). **This changes the walk's
   swing foot pose**: the walk leaves the push-off pitched toes-down and curls the toes (`swingCurl` 30, `toeCurl` 35), so
   the clamp flattens the foot and lifts the toes through much of the walk's low swing (Keith's `liftHeight` 0.4). This is the
   likeliest cause of "walk looks bad". There is no full off switch: `toeClear` 0 still clamps to a 0.02 m margin
   (`(0.02 + toeClear) * env` since 96a953b; `0.02 + toeClear * env` on main). To test without it, comment out the
   `this.toesClear(f)` call at the end of the swing branch of `moveFoot`. Consider adding a slider to switch it off, or
   clamp only the toe tips (not the pitch).
3. **`toesClear` on planted feet and in the air, 96a953b (not on main).** The planted branch of `moveFoot` calls
   `toesClear(f, 0, false)` (toes only bend up, down to the sink depth, on curved ground); `fly()` and the gallop's lifted
   foot call `toesClear(f, 0.5)`. This changes planted toes on dunes for the walk too.
4. **Feet sink, 96a953b (not on main).** With a `MechUnit` (every lab), `WalkerSim.sinkAt` puts planted and landing spots
   `sink` m under the ground: sand 0.09, rocky sand 0.025, rock 0 (`src/mech/sink.ts`, "Feet sink" group). **The walk's hips
   ride ~0.09 m lower on sand** (`body()` reads `groundY` from the planted spots). Swing floors ease out of the sink
   (`- sk * (1 - liftK)` in `moveFoot`), and `scuffs` counts against `g - sk`. Off: `?set=sinkSand:0`.
5. **Run swing kept in reach, 8aaa2bb.** `runSwing` only (sprint), not the walk.
6. **Hip cap by reach, eased hurry, run reach in `aim()`, 117ed65.** All gated on `rk > 0` / `runK > 0.5` (sprint only).
   `this.hurry` is eased only when `rk > 0`; the walk keeps the old instant hurry.
7. **`orient()`, 02360d8.** Replaces the three pelvisQ/hullQ setters; for the walk it is the same math (turnRoll is 0
   outside the sprint, and `plantPitch` is 0, b051c01). `carry()` now also turns `course` (deck riding).
8. **Plant compression, b051c01.** `body()`, gated by `rk` (sprint only).

So for "walk and run look bad on main", look first at the knee stop and the swing `toesClear` (both from 8aaa2bb, on
main); then, once this branch merges, at the sink and the planted `toesClear` too.

## Half done

- **Rendered strips** (rule 7): rendered but not yet reviewed, in the session scratchpad `sf/`: `r-turn-back.png`,
  `r-turn-game.png` (lean into a turn, `?turnat=6`), `r-side.png` (sprint footfalls), `r-climb.png` (climb onto a 20°
  wall). Made before the main merge, so on the old sprint values. Stick strips: `sf/turn-back.png`, `sf/whip-side.png`,
  `sf/impact-side.png`.
- **Checks after the merge:** `npm test` fails in `walker-check` only on Keith's clean-start values (main 5088dda):
  sprint reach misses 5.0% (Rampart) and 5.2% (Stilt), no flight phase at 10 m/s (boundStanceLen 4). Main's state.md
  also lists `slope-check` (5.1% misses up 10°), but `npm test` stopped at walker-check before reaching it. Not looked into.

## Left of items 4-6

- 4: other speed cues (dust trail, camera) weren't added; Keith's clean-start values set `boundLean` 0, which takes the
  forward lean away. Re-measure the whip on his new values (`sf/hip.mts`: walk ~1430°/s, Shift run ~1900, sprint ~2000 with
  the whip at the old values).
- 5: judge in rendered strips and play (sand amount, shake, thump volume); the thump reuses `brap` (no footfall sound yet).
- 6: snow exists only through `?surface=snow`; the sink comes off convoy decks by a height comparison in `MechUnit`.

## How to test

- Typecheck `npx tsc --noEmit -p . --preserveSymlinks`; `npm test`; also `tools/{armoury,dents,targeting,bandit-vat}-check.ts`.
- Scratchpad `sf/`: `hip.mts` (thigh sweep per gait), `knee.mts` (walk push-off knee and toe clearance), `cad.mts`,
  `climb.mts` (cadence per grade), `weave.mts`, `miss.mts` (where sprint reach misses happen), `ramp.mts`, `slopeprobe.mts`,
  `stick2.mts` (stick strips, `VIEW=side|back`), `render.sh` (rendered strips), `base/` (the starting commit 22c4407).
