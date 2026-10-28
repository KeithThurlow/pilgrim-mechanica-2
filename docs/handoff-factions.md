# Handoff: factions (steps 1 and 2 of docs/proposal-factions.md)

Branch `worktree-agent-a6693839bdf5c8f8a`, pushed to `wip/factions`.

## Done
- Sims take their own targets: `InfantrySwarm` (frozen, calm, setTarget/clearTarget), `RobotSwarm` (setTarget/clearTarget,
  no leap on a foreign target, small ones bite; `onShot` now also gets the robot index), `Warband` (`autoWaves`, `targetFor`,
  `spawnColumn`).

## Left (in order)
1. `src/game/factions.ts`: teams, relation table (sliders), provocation, strength and the numbers clash.
2. Placement: `src/expedition/banditCamps.ts`, `warColumns.ts` (seeded, depth).
3. Glue: `src/expedition/humans.ts` (streaming, sleep, leash, columns), `fights.ts` (in view targeting through the register,
   engaged cap, off-view clash, aftermath), wire in `loop.ts`; radar colours per faction; convoy lab flags.
4. Checks in `tools/expedition-check.ts`; state.md, decisions.md; delete this note when merged.
