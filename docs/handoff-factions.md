# Handoff: factions (steps 1 and 2 of docs/proposal-factions.md)

Branch `worktree-agent-a6693839bdf5c8f8a`, pushed to `wip/factions`. Built and checked; waiting for merge and for Keith to play it. Delete this note when it merges.

## Done
- Sims take per-member targets: `InfantrySwarm` (frozen, calm, setTarget), `RobotSwarm` (setTarget; foreign targets: no leap, small ones bite), `Warband` (`targetFor`, `spawnColumn`).
- `src/game/factions.ts` (relations, strength, clash maths, fight director), `fightGroups.ts` (adapters).
- `src/expedition/banditCamps.ts`, `warColumns.ts` (seeded placement by depth), `humans.ts` (streaming, sleep, leash), `fights.ts` (out-of-view clashes, wreckage, loot), wired in `loop.ts`; radar colours; convoy lab flags.
- `tools/expedition-check.ts` covers placement, depth, live fights, cap, never-fight, clashes. Full `npm test` green.

## Try it (convoy lab)
`?clash` (a robot pack walks into a bandit camp 330 m ahead, out of view), `?warband` (a column 260 m ahead hunting you), `?banditcamp[=m]` (just outside the nearest bandit camp). Sliders: topics "Factions and fights" and "Bandits and war bands".

## Rough edges
- Never run in a browser (checks only). No ragdolls for bandits in the convoy lab.
- The cap counts group-vs-group fights only; groups seek enemies only within `fightRange` (packs sent with a goal, as in `?clash`, walk there).
- Aftermath layout is a stand-in (reuses the dead-convoy POI look); war bands have no melee drop-offs yet.
