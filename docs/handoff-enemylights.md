# Handoff: enemy lights, the excavator beam, lit telegraphs (2026-10-31, `wip/enemylights`)

Keith 2026-10-31: "lights being a large part of how the game works. We want visual effects to really reward the
player." Built on `wip/rocketlights` (merged in: `src/world/lightCluster.ts`, `NightLights.rocket/launch`).

## Done
- Beam sim in `src/combat/robots.ts`: sliders `robotBeam*` (group "Robots: beam"), arrays `beamT`, `beamClock`,
  `bax/bay/baz`, `onBeam(RobotBeamEvent)`, `beamFrom`, `beamLine`, `RobotSwarm.beamReaches` (the hit rule),
  `chargeBeam`. Seeded; first beam spread by `seed[i]` (no extra draws).
- `tools/robot-danger-check.ts`: beam counted in DPS and the pack; beam duel (side-step after lock never burnt,
  standing always burnt).

## Left, in order
1. Night lights: families (player / bandit / robot) on rocket/launch/flash, gun flashes, `hold()` with priority,
   `telegraph()` / `telegraphLine()`; LampSource gets the NightLights as a 4th arg.
2. Battlefield: enemy muzzle flashes in `fire()`, shells lit in flight + their rings, blasts by team.
3. ArsenalDraw: family from the unit's team; painted strips / rings / line mortar lit.
4. Beam draw (inside RobotsDraw), `src/game/robotBeam.ts` (resolve on the battlefield: sheet, scorch, flash, sound),
   wire `onBeam` in robots lab, swarmCamps, stress enemies; `?beam` flag.
5. nightlights-check: enemy requests cluster within the pool; beam charge ranks above lamps/blasts.
6. state.md, CLAUDE.md flags, decisions, balance sheet if it lists excavator attacks.

## Test
`npx tsx tools/robot-danger-check.ts`, `npx tsx tools/nightlights-check.ts`.
