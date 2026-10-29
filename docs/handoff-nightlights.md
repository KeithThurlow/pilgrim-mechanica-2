# Handoff: night lights (Keith 2026-10-29)

Branch pushed to `wip/nightlights`. Delete this note when it merges.

## Done
- `src/world/lamps.ts`: lamp kinds and how bodies declare lamps (`userData.lamps` local spots, `userData.lampSource` world emitters).
- `src/fx/lampDraw.ts`: faked lamps, three instanced additive meshes (glows, ground pools, beam cones).
- `src/world/nightLights.ts`: scans the scene every 0.5 s for lamps; fakes every lamp in reach (`lightFar`); fixed pools of
  real lights (points `nightLightCap` 6, unshadowed spots `nightSpotCap` 4) handed out by priority (robot 3, flood 2,
  headlight 1.2, cab 0.8; divided by 1 + distance/20); the mech headlamp casts shadows (`headlampShadow`, map 1024,
  near 0.6 m; shadow map only drawn at night) and has a faint beam cone. New slider groups: Vehicle lights, Robot
  lights, Convoy lights (all in the Light topic via `LIGHT_GROUPS`). Hold-V: "Night lamps" (the glows) opens Light.
- Lamps: `carBody.ts` (headlights + tail lights on every kind; off when wrecked; off on the motor pool),
  `platformBody.ts` (cab headlights and window, running lights every `runningGap` m, bay floods from the tower onto the
  parking bays, posts at the launch pads lighting the pad and the sand outside), `ploughBody.ts` (light bar),
  `robotsDraw.ts` (red eye per working robot, sweeping `robotSweep`° at `robotSweepRate`, locked while attacking).
- Labs set `look.lights.ground` and `.camera` (combatLab, convoy, walker).
- `tools/nightlights-check.ts` (in `npm test`).

## Left / ideas
- Judge in the browser (looks never seen by the agent beyond any shots listed in state.md).
- Escort bodies get lamps via CarBody automatically; war band vehicles too.

## Test
- `npx tsx tools/nightlights-check.ts`; convoy lab `?time=23&set=dayRun:0`; robots lab `?time=22`.
