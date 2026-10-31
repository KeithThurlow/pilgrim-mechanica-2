# Handoff: trample, rams, bandit dive rolls (wip/trample, Keith 2026-10-31)

Status: built and checked headless, ready to merge; never run in a browser (no Chromium in the agent box).

## What's there
- Rules `src/combat/trample.ts` (Trample slider group, in the mech topic): damage curve on the relative speed,
  fling, closing speed (gates contact), ram exchange by mass, the charge as a line threat, seeded pair chance, threat
  footprint test. Vehicle masses `VEHICLE_MASS`.
- `InfantrySwarm.trample()` / `dodge()` (dive and evade arrays, `rolledFor`, `dives`), hard keep-out at the target's
  radius + 5 cm (keepOut is now a soft steer). `RobotSwarm.trample()` (scrappers only). Adapters
  `InfantryTarget.crush`, `RobotTarget.crush`.
- Glue `src/game/bodyContact.ts`: mech velocity from its own motion, trample/ram/threats, thud + sand kick.
  Wired: bandits lab, warband lab (riders + rams), robots lab (scrappers), convoy loop (bandit camps, swarm camps,
  war bands; `loop.threatSource` set by the convoy lab).
- Leg stats `trample` / `crush` (bases, STATS, ResolvedValues, bay summary, level weight crush 0.5).
- Roll clip in the bake: rebake with the uploads' Mixamo folder plus `Dodge/Roll_F.fbx` (the old repo's LFS object
  29f2ef94..., fetched through the LFS batch API) in one dir as the second argument.

## Rough edges / next
- The mech isn't slowed or pushed by a ram (only the vehicle moves); big robots and enemy mechs aren't rammed.
- The dash crowd shove (`onDash`) still runs alongside the trample (double hit on a dash; harmless, they die anyway).
- The roll clip sinks the shoulder 18 cm into the sand at its low point and is played ~2.2× fast to fit 1.1 s.
- Painted strips before release aren't threats (only what's in the air, as the duel's list).

## Test
`npx tsx tools/trample-check.ts`; bandits lab `?manual` (sprint with Space held into a crowd), `?set=diveChance:1`;
convoy lab `?banditcamp`, `?warband` (ram a technical).
