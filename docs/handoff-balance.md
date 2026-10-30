# Handoff: balance (wip/balance)

Done:
- `tools/balance-sheet.ts`: the model (effective DPS = raw × hit share × targets per volley × armour × uptime), today vs
  `--proposed` (patch tables `P_WEAPON`, `P_TARGET`, `P_PROTO`, `OTHERS`), `--check` (any weapon > 130% of budget).
  Assumptions in `REF` and `targets()`.
- `docs/proposal-balance.md`: audit, today's matrix, framework, armour (Keith's call), exchange rates, modifiers, TTK
  targets, proposed values, questions. Logged in `docs/decisions.md`, state.md In progress and Changes.

Left (only after Keith answers the proposal's questions):
1. Armour in the sim: an `armour` per target or part on the hit adapters (robotTarget, infantryTarget, warband cars,
   mechUnit) and `pierce` on rounds (ShotCmd / sheet hits / blasts), the formula `max(floor·d, d − A(1 − ap))` in one
   pure helper; a slider group "Armour".
2. The proposed values into `src/items/bases.ts`, `src/weapons/tuning.ts`, `src/combat/robots.ts`, `warband.ts`;
   mech-on-mech ×0.5 in `mechUnit.damage` for mech attackers.
3. Protocol prices and additive stacking (`src/items/protocols.ts` shotProtocolsOf, `protoMaxGen`).
4. The level curve (`src/items/level.ts`) and enemy hp/damage by area level (`src/expedition/depth.ts` consumers).
5. Then add `npx tsx tools/balance-sheet.ts --check` to `npm test`, and the item card's rated eDPS (`src/items/power.ts`).

Known model limits: swarm pack clear is optimistic (a fixed-area cluster); handling, arc and tracking aren't modelled;
the line mortar has no "column" target set; camp size by depth is taken as linear.
