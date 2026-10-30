# Handoff: balance pass 2 (wip/balance2)

Brief: `docs/proposal-balance.md` (its "Answers (Keith 2026-10-31)" win), steps 1-6 from the coordinator. **All six
built; full `npm test` passes. Never run in a browser.** Delete this note when the branch merges.

Done (state.md "Balance (armour, magazines, Protocols)" has the summary):
1. Armour and pierce: `src/game/armour.ts` (armourHit, `armourFloor` 0.15 in the weapons topic's Armour group).
   `Hittable.damage(amount, at, dir, pierce?)`, `SplashOpts.pierce`, `ShotCmd/FireOptions.pierce` (shot rows carry `ap`,
   children inherit), `SheetFire.pierce`, `Shell.pierce`, `Battlefield.blast(..., pierce)`. Adapters take their own
   armour: RobotTarget (0/3/10), Raider (tech 2, truck 4, six 6, rig 8, turret 12, tank +4, bus 5), MechUnit (hull item
   `armour` 8/12/5, bandit mech 6 by `armourOverride`), Dummy (`dummyArmour`), RangeCar (`carArmour` 4). No pierce =
   armour-ignoring (bites, saws, stomps, raider guns, burns). Weapon pierce: item stat `ap` + sliders (`railAp` …).
2. Level-1 values live; hulls ×2; robot damage ×1.5-1.75, raider guns ×1.5, `pilotHurt` 0.67, `banditMechDamage` 1.
   Level curve `levelGrowth` 0.075, `levelPower`, robots by area level (`SwarmCamps.power`, `enemyLevels`).
3. Protocols multiply (`src/items/protocols.ts`), new Quick loader and Caseless rounds, splitter on rockets
   (`protoRocketFan`). The sheet prints each one's niche (within a magazine) and sustained multiplier.
4. Magazines (`src/weapons/magazine.ts`, `Gun.mag` in `src/mech/upper.ts`, hull RPG on its side's gun record, shoulder
   rocket `Shoulder.mag`), stats `magazine`, `reload`, `magBonus`, `reloadSpeed`; waist Autoloader; energy hook
   (`WeaponCost.energy`, `GunStats.energy`, `Protocol.draw`). HUD: `src/ui/reloadHud.ts`.
5. `src/items/dps.ts` (cadenceOf, itemDpsPair) → `power.ts dpsText` on the bay card/rows and the pickup card.
6. `src/ui/healthBars.ts` (instanced quads, `Hittable.bars`), in combatLab (every combat lab, duel) and the convoy lab.

Checks: `tools/balance-check.ts` (new), `tools/balance-sheet.ts --check` in npm test; robot-danger, weapons, loadout
checks moved to the new values.

Rough edges for Keith: split on the shoulder rocket (magazine 3) loses sustained DPS under the cost rule; minigun pairs
take ~45 s on an excavator (armour 10; ~21 s with the default missile pod); raiders and bandits don't scale with area
level; old saved items keep their old rolls (drums read their old rounds as +50%); Choke shows no gain in the model (its
niche, far small targets, isn't a target set); `Sheet.dealt` readouts are before armour.
