# Handoff: responsive walk (`wip/responsive`)

Done, awaiting merge. Delete this note when it merges.

- What: twin-stick walk. `WalkerSim.walkSteer` (src/mech/walker.ts) replaces the walk branch's heading-gated speed; the
  sprint (`runSteer`, `boundStep`) and the dash are untouched. `aim()` lands walking feet along the travel, on their own
  side; `crossed()` / `offLegs()` hurry the cadence after hard turns. `mechUnit.step` passes `face` (aim direction).
- Values (Move sliders): walkAccel 30, walkStop 40, walkWeight 0.5, legTurnRate 360, backArc 125, backSpeed 0.9,
  crossHurry 4, turnHurry 2, overBrake 6, turnSlow 0.
- Test: `npx tsx tools/response-check.ts`; play the duel lab, walker lab `?manual`, robots lab.
- Rough edges: on fast reversals without an aim the legs swing round over planted feet for a moment (crossed briefly);
  backstepping uses the forward gait run backwards (no dedicated backstep pose); sidesteps at walk speed are short-lived
  since the legs turn to the travel.
