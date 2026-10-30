# Handoff: balance pass 2 (wip/balance2)

Brief: `docs/proposal-balance.md` (its "Answers (Keith 2026-10-31)" win), steps 1-6 from the coordinator.

Done:
1. Armour and pierce: `src/game/armour.ts` (armourHit, floor slider `armourFloor` 0.15 in the weapons topic's Armour
   group). `Hittable.damage(amount, at, dir, pierce?)`, `SplashOpts.pierce`, `ShotCmd/FireOptions.pierce` (shots rows
   carry `ap`, children inherit), `SheetFire.pierce`, `Shell.pierce`, `Battlefield.blast(..., pierce)`. Adapters take
   their own armour: RobotTarget (robotArmour 0 / robotMidArmour 3 / robotBigArmour 10), Raider (tech 2, truck 4, six 6,
   rig 8, turret 12, tank +4, bus 5), MechUnit (hull item `armour`: Rampart 8, Siege 12, Salvager 5; bandit mech 6 by
   `armourOverride`), Dummy (`dummyArmour` 0), RangeCar (`carArmour` 4). Hits with no pierce (bites, saws, stomps,
   raider guns, burns) ignore armour. Weapon pierce: item stat `ap` (spread 0) and sliders `railAp` 0.9, `railLightAp`
   0.8, `acAp` 0.5, `rpgAp` 0.6, `swarmAp` 0.3, `mortarAp` 0.4, `salvoAp` 0.3, minigun `roundAp` 0.1 (items: light 0,
   medium 0.1, heavy 0.25).
2. Level-1 values (section 8) live; hulls ×2 (3000 / 4200 / 2400, bandit mech 1800) instead of ×0.5 mech-on-mech;
   robot damage ×1.5-1.75 and raider guns ×1.5 so a pack still kills a standing mech in ~30 s (pilotHurt 0.67 keeps the
   pilot as he was). One level curve: `levelGrowth` 0.075 (damage, hull; no rate), robots spawned in the convoy lab get
   `levelPower(1 + depth/levelMetres)` on hp and damage (`SwarmCamps.power`, `enemyLevels` 0/1).

Left, in order: 3 Protocols (multiplicative, ×1.2-1.3 niche each), 4 magazines and reloads (+HUD ring), 5 item DPS
preview (one shared function with the sheet), 6 enemy health bars; then the balance sheet on the live values,
`tools/balance-check.ts` (armour floor, pierce, magazine, split cost, stacking), state.md, decisions.md, delete
`docs/handoff-balance.md`.

Known: old saved items keep their old rolls (`?fresh` in the loadout lab); raiders and bandits don't scale with area
level yet (robots only); bandit infantry rifles unchanged.
