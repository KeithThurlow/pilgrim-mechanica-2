# Handoff: day-night cycle (wip/daynight)

Brief: Keith 2026-10-28, day-night cycle; night 0.35 of the day, moonlit and starlit, long but finite evening shadows.

## Done
- `src/world/daynight.ts` (pure): `DayClock` (host state), `sunAt` (hemisphere path from noon az/el + night share),
  `skyAt` (key light sun or moon, never both; clamped shadow sun; grade keys by sun height, evening and morning sets).
- `tools/daynight-check.ts` in `npm test`.

## Left, in order
1. `src/world/look.ts`: drive DesertLook from `skyAt` when `dayCycle` is on; env dome regenerated (throttled, same
   render target); stars + moon disc; dust tint; `?time=`.
2. `src/world/nightLights.ts`: pooled point lights (cap slider), mech headlamp spot, blast flashes, convoy deck lamps.
3. Wire into labs (walker, convoy (running), combat labs, terrain, armoury): Light topic gets "Time of day", "Night lights".
4. Shots at noon, 18.5, 20.3, 23 in the convoy lab; fix; state.md; decisions.md.

## How to test
`npx tsx tools/daynight-check.ts`; convoy lab `?time=18.5`, walker lab `?time=21`.
