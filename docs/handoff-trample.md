# Handoff: trample, rams, bandit dive rolls (wip/trample, Keith 2026-10-31)

Brief: the mech's body hurts what it runs into (bandits, scrappers: trample by closing speed; vehicles: ram, both
shoved by mass, both hurt); the legs set the reach (`trample`) and bite (`crush`); bandits get a seeded chance to dive
roll out of a charge or a telegraphed shot; the roll clip baked into the bandit VAT.

## Done
- Roll clip: `Dodge/Roll_F.fbx` from the old project's LFS (fetched through the LFS batch API; the uploads copy has no
  Dodge folder). Baked: `tools/mixamo/bake-bandit.ts` clip `roll` (2.37 s, 72 frames, 1.95 m/s), `VAT_CLIPS` has it.
  Rebake: put the uploads' Mixamo folder plus `Dodge/Roll_F.fbx` in one dir and pass it as the second argument.
- `src/combat/trample.ts`: rules (damage curve, fling, closing speed, ram exchange, charge threat, seeded pair chance,
  threat footprint test).

## Left, in order
1. infantry.ts: `trample()`, dive/evade arrays, `dodge(threats)`; hard keep-out clamp to the body radius only.
2. robots.ts: `trample()` for scrappers.
3. Leg stats `trample` and `crush` (bases.ts, STATS, loadout ResolvedValues + summary, level weights).
4. Glue `src/game/trampleGlue.ts`; wire bandits lab, robots lab, warband lab (rams), convoy (humans.ts, swarmCamps).
5. infantryDraw: play `roll` while diving.
6. `tools/trample-check.ts`; state.md, decisions.md.
