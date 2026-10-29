# Handoff: raiders2 (Keith 2026-10-29: robot danger, technicals for tanks, the party bus)

Branch `wip/raiders2`. All three parts built; waiting to merge and for Keith to play. Delete this note on merge.

## Done
- A: robot danger. `tools/robot-danger-check.ts` measures DPS per kind on a standing mech and a pack of 30's time to
  kill, and holds targets. Before: biter 2.0, scrapper shooter 1.1, cutter saw 2.1, cutter slugs 1.3, excavator 4.6
  dps; pack 33.7 s. New defaults (`src/combat/robots.ts`): robotMidShotInterval 2, robotMidShotDamage 7,
  robotMidCutDamage 12, robotMidCutRecover 0.7, robotBigRoundInterval 0.6, robotBigPause 2.2, robotBigAim 1,
  robotBigWindup 0.9, robotBigShotDamage 30. After: saw 5.3, slugs 3.7, excavator 21.3; pack 25.6 s.
- B: `turretTruck` car kind (car.ts, carBody.ts `salvagedTurret` on a timber crib) replaces the war band's tank;
  `turret*` values in warband.ts; `shellGun()` covers it and the tank. Tank kind kept (escorts, rival military later).
  Columns: turret truck at the back when n >= 5 and danger > 0.6. Factions: powTurretTruck, powPartyBus (powTank gone).
- C: `partyBus` car kind (carBody `buildBus`, lights `flashLights`), `src/combat/partyBus.ts` (BusCrew: drops, cap,
  ids), `src/audio/busMusic.ts` + `Sfx.startSoundLoop/setSoundLoop/stopLoop`. Warband: `riders` (an InfantrySwarm),
  `name` (id prefix), `onDrop`. War band lab: its own rider swarm, drawn baked. Convoy lab: WarBands.riders = the
  camps' swarm (loop.ts); riders taken off when a band is handed back. `?warband[=N]` (default 6).

## Rough edges
- Not run in a browser: the bus and turret truck models, lights and music are unseen.
- The war band's own randomness is still Math.random (spawn spread, gun spread); the bus crew and its drops are seeded.
- Bus riders in the convoy lab belong to no camp and no fight group: they always go for the mech or pilot.
