# Handoff: dashsnap (Keith 2026-10-31: the dash's start and stop, a tap that sticks in the run, rails vs dash)

Branch `wip/dashsnap`. Probe: `npx tsx tools/dash-probe.ts` (press to peak, peak to walk, metres).

Done:
- The dash's speed is a burst by time from the press (`dashBurst` in `src/mech/dashSteps.ts`): up to `dashSpeedOut`
  20 m/s in `dashRise` 0.07 s, held `dashHold` 0.42 s, down to the stick's walk in `dashStop` 0.15 s. Sliders in the
  Dash group; `dashKick`, `dashStepsTop`, `dashBoostAccel`, `dashRun`, `dashRolloff` gone.
- Beats shortened (load 0.02, push 0.06, overlap 0.01, through 0.1) so the steps keep up.
- `walker.ts`: dashSteer follows the burst; dashHandOver passes the time on (`burstT`, `burstFrom`, `burstSlope`);
  runSteer's burst follows it and ends on time; in the stop the run keeps its cadence and hurries in full
  (`burstCps`), feet aim along the burst curve (`burstGo`), the hand-over to the walk waits for no foot late in its
  swing and keeps a swinging foot's phase (`burstDone` in runEnd); planted feet drag after the body in the steps (no
  splits); a tapped dash doesn't leave the ground off crests.
- dash-check harness drives the dash as MechUnit does (sim.dash, no shove push). Passes.

Left, in order:
1. Backpedal (`dashPedalSteps`) still gates a reverse dash (peak at 0.5 s): decide (off by default?).
2. Bug: a tap sometimes sticks in the run (Keith). Find, fix, add a check.
3. Rails: no dash while a rail charges or is charged; dash cancels the charge (player + rival AI). Check.
4. response/walker/slope/convoy/duel checks; state.md, decisions.md; full npm test.
