# Handoff: raiders2 (Keith 2026-10-29: robot danger, technicals for tanks, the party bus)

Branch `wip/raiders2`. Brief: robots scary (A), war band tank → technical with a salvaged turret (B), party bus that
drops bandit infantry (C).

## Done
- A: robot danger. `tools/robot-danger-check.ts` measures DPS per kind on a standing mech and a pack of 30's time to
  kill. Before: biter 2.0, scrapper shooter 1.1, cutter saw 2.1, cutter slugs 1.3, excavator 4.6 dps; pack 33.7 s
  (bites 72%). New defaults in `src/combat/robots.ts`: robotMidShotInterval 2, robotMidShotDamage 7, robotMidCutDamage
  12, robotMidCutRecover 0.7, robotBigRoundInterval 0.6, robotBigPause 2.2, robotBigAim 1, robotBigWindup 0.9,
  robotBigShotDamage 30. After: cutter saw 5.3, slugs 3.7, excavator 21.3 dps (2 × 30 every 2.8 s); pack 25.6 s.

## Left, in order
- B: technical in place of the tank (src/combat/warband.ts, carBody.ts).
- C: party bus (warband.ts + infantry drop-offs; labs/warband, src/expedition/warColumns.ts, humans.ts).
- Checks, state.md, decisions, CLAUDE.md flags.
