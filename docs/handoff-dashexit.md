# Handoff: dash exit (wip/dashexit)

Keith 2026-10-31: the dash feels drifty afterwards; shorter, more deceleration unless it carries on into a sprint.

Done (all checks pass):
- Decision point at the burst's hold end (`dashHoldEnd` = dashRise + dashHold = 0.325 s): `Bound.update` starts the
  sprint only if Space is still held then (held since the press). `dashHoldRun` removed.
- Tapped: `dashHold` 0.28, `dashStop` 0.1; the stop blends the velocity from where it was to the stick's walk velocity
  (`WalkerSim.dashStick`), in `runSteer`'s burst branch (from the velocity at the stop's start, remapped so a mid-stop
  hand-over from the steps is continuous) and in `dashSteer` (if the steps are still going at the hold's end).
- `dashBend` 12 m/s²: the hold's line turns toward the stick (dashSteer: `dm.bend`; runSteer: course and heading).
- Probes: `tools/dash-probe.ts` (tail: exit times, press length → sprint).

Left: Keith's feel test. Rough edges: through the 0.1 s stop the legs keep their heading and the planted feet slide with
any across motion; the walk turns them after. Downhill vs uphill only differ by ~0.2 m now.
Delete this note when merged.
