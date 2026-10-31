# Handoff: dash rise and lean (wip/dashlean)

Keith 2026-10-31: dash start a touch faster; the mech leans briefly into direction changes.

Done:
- `dashRise` 0.07 → 0.045 s (`src/mech/walkerTuning.ts`).
- Lean into a change of velocity: `WalkerSim.accelLean` (spring in world x/z, driven by the body's acceleration from
  `pos` between updates; `carry()` moves its reference), applied in `orient()` (pitch/roll, hips shift, crouch) and in
  `bodyPitch` / `bodyRoll` / `hullRoll`. Sliders in group Lean (walker lab Hull topic, combat labs Legs topic).
- Probe `tools/lean-probe.ts` (`LEAN_SET='{...}'` to try values). All of dash, response, walker, slope, convoy checks pass.

Values: leanPerAccel 0.14, leanMax 10, leanInDash 0.6, leanStiff 260, leanDamp 0.6, leanSmooth 0.02, leanCrouch 0.1,
leanShift 0.25.

Known: the dash-check's mid-dash-back hips floor has 0.07 m margin; the lean must not roll about the outside hip.
Test: walker lab `?manual&flat`, `?cam=side`; duel lab `?manual`.
