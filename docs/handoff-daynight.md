# Handoff: day-night cycle (wip/daynight)

Brief: Keith 2026-10-28, day-night cycle; night about 0.35 of the day, moonlit and starlit, long but finite evening shadows.
Status: built and checked, ready to merge. Delete this note on merge.

## Done
- `src/world/daynight.ts` (pure): `DayClock` (host state), `sunAt` (hemisphere path: latitude/declination solved from
  noon height + night share), `skyAt` (key light sun or moon, never both, none at the handover; shadow sun clamped to
  `shadowMinEl`; grade keyed by sun height, evening and morning sets blended across noon/midnight).
- `src/world/look.ts`: `dayCycle` on (or `?time=`, not saved) drives sun colour/strength/direction, shadow strength and
  softness, hemisphere fill, the sky environment (dome repainted into the same PMREM target, throttled 250 ms), haze
  colour and density, background, exposure, stars and a moon disc; `look.tint` tints the dust (`dustDraw.tint`).
- `src/world/nightLights.ts`: pool of point lights (made on first night, then kept: one shader change), convoy terminal
  lamps (`addLamps`), blast flashes (`Battlefield.blast`), headlamp spot from the sensor head's lamp glows (`track`).
- Labs: walker, convoy (dayCycle 1, running, from 16:00), combat labs (`combatLab.ts`), terrain, armoury; Light topic
  lists `LIGHT_GROUPS` (Look, Time of day, Night lights).
- `tools/daynight-check.ts` in `npm test`.

## Values
Day 20 min, night share 0.35, shadow floor 13°, low-sun shadow 0.55 / softness ×1.8 / fill 0.4, handover -2° with a 4°
blue hour, moon 50° at 140° drifting 30°, moonlight 0.18, moon shadow 0.7, night exposure ×1.4, night fill 0.3,
6 pooled lights, lamps 22 / 14 m, headlamp 220 / 50 m / 30° cone / 24° dip, blast flash 900 for 0.45 s.
With the default noon sun (215°, 36°): golden hour about 18.5, sunset 19.8, blue hour about 20-20.5, night 21-3.5,
pink dawn about 4-5.

## Known rough edges
- Blue hour (about 20.3) is dark and muddy purple; could use a bit more fill.
- The star dome and moon are above the game camera's view (only seen zoomed far out or in close cameras).
- Only the player's muzzle flashes carry lights (as before); enemy fire and convoy turrets don't light the ground.
- The headlamp reads warm and strong at night; tune `headlampStrength`.

## How to test
`npx tsx tools/daynight-check.ts`; convoy lab `?time=18.5`, `?time=23&set=dayRun:0`; walker lab `?time=21`.
