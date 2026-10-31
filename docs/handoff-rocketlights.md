# Handoff: rocket barrage and rocket lights (2026-10-31, `wip/rocketlights`)

Keith: "rocket pods on the hull, on either hull arm, rocket launchers on the shoulders... fire lots into a swarm and
light up all the rockets", plus light clustering.

## Done
- `?barrage` / `?barrage=arms` (`barragePick` in `src/items/weaponPick.ts`, read by `pickFromParams`: robots, weapons,
  duel, convoy labs). New side pick `rocketpod`.
- Arm rocket pod: base `rpg-light` (`src/items/bases.ts`), sliders `pod*` (`src/weapons/tuning.ts`), arsenal light rpg
  stats and tube cycling (`rpgStats(.., light)`, `Side.tube`, `muzzleOf(.., tube)` in `src/weapons/arsenal.ts`), model
  kind `rpgLight` (box stand-in in `models.ts`, library `missile-pod-l` ×2.4 in `modelSwap.ts`).
- Lights: `src/world/lightCluster.ts` (pure clustering); `NightLights.rocket()`, `.launch()`, `shortLights()`,
  `stats`; new sliders in Night lights; `ArsenalDraw` takes a `() => NightLights` and posts every rocket/missile;
  `Arsenal.fireRocket` and missile launches post launch flashes; `Battlefield.nightLights` getter.
- Checks: `tools/nightlights-check.ts` (clustering + barrage probe), `tools/weapons-check.ts` (barrage picks).

## Left / rough
- Not seen in a browser: pod scale and seat, flicker as real lights move between clusters.
- Enemy rockets (bandits, war band, party bus) don't call `nightLights.rocket` yet.

## Test
`npx tsx tools/nightlights-check.ts`; robots lab `?barrage&time=22&proto=splitter`, `?barrage=arms&time=22`.
