# Handoff: tube lights along gun streams (`wip/tubelight`)

Keith 2026-10-31: more tracers; "a tube light that goes out along there"; "more but weaker" tracer lights.

## Done
- `src/fx/gunStreams.ts`: pure stream tracker (match by family, muzzle within 1.4 m, line within 22°; rate from gaps;
  envelope on while the next round is due, swell tau/2, fade tau; pulse mode for the autocannon).
- `src/world/nightLights.ts`: `stream()` (also on `ShortLights` in `lamps.ts`), `streamBright`, `drawStreams` (core
  line, strip pools on the sand at night, `streamPoints` requests into the clusters), `familyColours()` factored out,
  cores drawn by day on the early-return path; tracer lights share 1, each `tracerLight / (share × tracerSplit)`.
  Sliders: group "Gun streams" (`GS`) in the Light topic.
- `src/fx/lampDraw.ts`: `lines` instanced mesh (camera-facing ribbons, tube texture), POOL_MAX 1024.
- `src/fx/minigun.ts`: `tracerFill` (2): extra GPU tracers leaving inside the gap to the slot's next round, only when the
  same slot fired within 0.2 s from within 1.5 m (swarms share slots round-robin).
- `src/game/battlefield.ts`: each drawn round feeds `stream()`; `src/weapons/arsenal.ts`: autocannon pulses.
- `tools/nightlights-check.ts`: streams, fade, noon, pool cap, more-but-weaker, tracer fill.

## Left
- Keith's look in a browser (URLs in state.md In progress). GPU cost of the lines unmeasured.

## Test
`npx tsx tools/nightlights-check.ts`; robots lab `?swarm=300&time=22`, `?k2=beltfeed&time=22`, convoy lab `?time=22&warband`.
