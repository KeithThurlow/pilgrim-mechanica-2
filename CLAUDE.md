# Pilgrim Mechanica 2

A mech salvage game in the browser. Your base is a convoy village that never stops rolling across a procedural
desert. You take a mech out to salvage wrecks and scrap while swarms of enemies close in, and you have to get back
before the convoy rolls out of range. Better mechs and convoy upgrades let you range further. Keith's pitch, the
loop and the open questions are in `docs/design.md`.

This is a restart of `KeithThurlow/pilgrim-mechanica` (Unity, prototype stage). Keep the ideas, not the code.
Carried over: the procedural digitigrade walker (rewritten), the salvage-from-wrecks loop, swarm combat, the
desert look direction. What came from where: `docs/decisions.md`.

## Ground rules (Keith 2026-10-24: these exist because the Unity project slowed to a crawl)

1. **Iteration speed beats performance, and beats preserving code.** Save a file, see it in the browser in under a
   second. If a system starts slowing changes down, rewrite it rather than working around it. Nothing here is
   precious; the project must stay easy to change.
2. **Every system gets its own lab page** in `labs/<name>/` (an `index.html` and `main.ts`; Vite picks it up by
   itself). Tune a system in its lab, not in the whole game. New system = new lab first.
3. **Every feel value is a slider.** Tuning values live in a params list (`Param[]` plus a defaults object) next to
   the system and show in the lab's panel (`src/core/tweaks.ts`). Never hardcode a value someone will want to tune.
4. **Every lab shows frame time** (`src/core/hud.ts`, automatic via `createApp`). We don't optimise early, but we
   always see the cost of what we add. Budget: 16.7 ms on Keith's PC.
5. **Small files, one job each.** Simulation is separate from rendering (e.g. `walker.ts` is pure maths, `walkerBody.ts`
   draws it), so systems can be tested headless and their looks swapped freely.
6. **Headless checks for anything with rules**: `npm test` runs `tools/*-check.ts`. Add a check when a system has
   things that must never happen (feet through the ground, legs out of reach, terrain cliffs).
7. **Look at your work.** After visual changes, `npm run build && npm run shots` and look at the PNGs in `shots/`
   before calling it done. Labs take URL flags for repeatable shots (below).
8. **Log decisions** in `docs/decisions.md` (dated, who raised it, who decided). Mark only Keith's calls as his.
9. **Propose before big builds.** For a new system, outline files, data and key values first and wait for Keith.

## Stack

- **Three.js r186** (`three/webgpu`: WebGPU renderer, falls back to WebGL 2 by itself), **TypeScript**, **Vite**.
- Shaders, when needed: TSL (`three/tsl`), which compiles to WGSL or GLSL. Classic materials also work.
- Physics: none yet. Rapier (`@dimforge/rapier3d-compat`, WebAssembly) when we need collisions or vehicles.
- No game engine, no ECS library yet. Swarms will need data-oriented arrays and instanced meshes; add structure
  when a system needs it, not before.

## Commands

- `npm run dev`: dev server with hot reload, opens the lab hub. `npm run check`: typecheck. `npm test`: headless checks.
- `npm run build`: typecheck + production build to `dist/`. `npm run shots`: screenshots of the labs into `shots/`
  (needs a build; `npx playwright install chromium` once).

## Lab URL flags

- Every lab: `?webgl` forces WebGL 2. `?set=key:value,key:value` overrides any tuning value for that page load
  (not saved), e.g. `?set=sunAzimuth:120,height:12`.
- Walker lab: `?cam=game|close|side|feet`, `?flat` (no dunes), `?walk=straight` (constant heading for filmstrips),
  `?sprint` (with `walk=straight`), `?manual` (no auto walk).
- Terrain lab: `?shot` (marker parked), `?view=high` (overhead, no haze), `?seed=N`.

## Layout

```
index.html              lab hub
labs/<name>/            one page per system (index.html + main.ts)
src/core/               app (renderer, loop), hud (frame time), tweaks (slider panel), input
src/world/              noise, terrain (the dune height function), chunks (streaming), look (light, haze)
src/mech/               walker (sim), walkerTuning (params), walkerBody (stand-in model)
src/fx/                 footfall (prints, dust)
tools/                  *-check.ts headless checks, shots.mjs screenshots
docs/                   design.md (the game), decisions.md (log)
```

## Key conventions

- Units: metres, seconds; degrees in tuning, radians in code. Y up. Heading 0 faces +Z; +X is the mech's left.
- **The ground is a function.** `DuneField.height(x, z)` is pure and deterministic: chunks, feet, vehicles and AI all
  read the same function, so any chunk can be built in any order and nothing disagrees about where the ground is.
- Mech scale: about 5 m to the top of the hull, hips at 3.2 m; walk 4 m/s, sprint 6.5 m/s (from the old project).
- Sims step at a fixed 120 Hz inside the frame (see the walker lab) so feel doesn't change with frame rate.

## Current state (2026-10-24)

- **Terrain:** transverse dunes across the wind (long windward slope, ~30-38 degree slip face), meandering and
  breaking crests, a crossing dune set, interdune flats, swell and small bumps; streamed in chunks around a focus,
  nearest first inside a per-frame time budget; vertex-coloured sand (slip faces darker, flats paler); optional
  faceted look. Desert light: warm sun, cool sky fill, haze at the streaming edge, shadow box following the focus.
- **Walker:** digitigrade legs (thigh, shin, cannon, three-toe plate) on a pure sim: shared gait phase, duty factor,
  landing spots predicted on the real ground and tilted to the slope, mechanical swing (lift, hydraulic travel,
  stomp), heel roll-off, body rides the feet and sinks toward the lower one on slopes, weight shift and hip roll
  with a level hull, footfall thud, committed heading. Quicker steps when a leg nears full stretch; settle steps
  when stopped. Stand-in salvage-walker model, footprints and dust. `tools/walker-check.ts` passes on dunes.
- **Not yet:** the convoy, salvage, enemies and swarms, weapons (the old minigun and explosions), radar, multiple
  mech classes, sound, a game page.

## Next candidates (ask Keith which)

- Convoy lab: a slow convoy of tracked and wheeled vehicles riding the dunes (suspension faked from the height
  function), with the range ring around it.
- Swarm lab: hundreds of instanced enemies chasing the mech over the dunes, with a frame-time budget.
- Weapons lab: port the old minigun and explosion feel.
- Walker: arms and a turning torso, leg types (the old lab had Humanoid and Stilt), jump packs.
