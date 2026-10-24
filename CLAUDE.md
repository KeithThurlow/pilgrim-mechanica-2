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
   Group the sliders into **topics** (what they tune: the legs, a gun, the dunes) and register the matching parts with
   the **hold-V selector** (`src/core/select.ts`), so Keith can click a thing and see only its sliders (Keith
   2026-10-24). New sliders go in an existing group or a new group added to a topic, never loose.
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
10. **Every change updates `state.md` in the same commit** (Keith 2026-10-24): the system's entry if it changed, a
   dated line at the top of Changes (what, main files, what was checked, who), and In progress while work spans
   sessions or agents. Read `state.md` first when you start; it is the shared record between agents.
11. **Check the report inbox.** Keith reports from inside the labs (the Report button). Reports land in
   `reports/inbox.md` on his PC (`reports/<id>.md` has the note, a screenshot, the URL and every tuning value). When
   you start, and when Keith says he's reported something, read the inbox, handle the open lines, tick them
   (`- [x]`) and answer each in `reports/replies.md` (`<id>: what you did`), which shows back in the box.

## Stack

- **Three.js r186** (`three/webgpu`: WebGPU renderer, falls back to WebGL 2 by itself), **TypeScript**, **Vite**.
- Shaders, when needed: TSL (`three/tsl`), which compiles to WGSL or GLSL. Classic materials also work.
- Physics: Rapier (`@dimforge/rapier3d-compat` 0.12, WebAssembly) for death physics only (ragdolls, wrecks); the
  living run on their own sims.
- No game engine, no ECS library yet. Swarms will need data-oriented arrays and instanced meshes; add structure
  when a system needs it, not before.

## Commands

- `npm run dev`: dev server with hot reload, opens the lab hub. `npm run check`: typecheck. `npm test`: headless checks.
- `npm run build`: typecheck + production build to `dist/`. `npm run shots`: screenshots of the labs into `shots/`
  (needs a build; `npx playwright install chromium` once).

## Lab URL flags

- Every lab: `?webgl` forces WebGL 2. `?set=key:value,key:value` overrides any tuning value for that page load
  (not saved), e.g. `?set=sunAzimuth:120,height:12`.
- Walker lab: `?cam=game|close|side|back|feet`, `?model=standin` (box walker), `?flat` (no dunes),
  `?walk=straight` (constant heading for filmstrips), `?sprint` (with `walk=straight`), `?fire` (hold the trigger),
  `?manual` (no demo), `?zoom=metres` (game camera distance), `?aimat=x,z` (hold the aim on a point; steel wrecks
  near the start at 22,-28 / 6,-26 / 15,-18), `?dt=0.033` (fixed time per frame, for headless shots and filmstrips),
  `?surface=gravel|dirt|concrete` (dust as if the ground were that).
- Terrain lab: `?shot` (marker parked), `?view=high` (overhead, no haze), `?seed=N`.
- Combat labs (warband, bandits, robots): `?manual` (no demo), `?zoom=metres`, `?dt=0.033`, `?flat`.
- Convoy lab: `?manual`, `?aboard` (start on the deck), `?deploy` (start launching), `?park` (start parked), `?hang`
  (start hanging from the crane, about to lift), `?zoom`, `?dt`, `?flat`, `?watch=N` (camera on car N, 0 the lead;
  `gapN` the gap ahead of car N; `eN` escort N); E parks in a bay, G launches from anywhere.

## Layout

```
state.md                live state of every system, work in progress, change history
reports/                Keith's in-lab reports and your replies (in git, so any agent can pick them up; delete one when fixed)
index.html              lab hub
labs/<name>/            one page per system (index.html + main.ts)
src/core/               app (renderer, loop), hud (frame time), tweaks (slider panel), input
src/world/              noise, terrain (the dune height function), chunks (streaming), look (light, haze), wrecks (steel stand-ins)
src/core/isoCamera.ts   the high isometric game camera
src/mech/               walker (leg sim), upper (torso and guns sim), walkerTuning, legTypes (leg archetypes), rampart (model rig), walkerBody (stand-in)
src/look/               toon (unit materials, optional cel bands, ink outlines)
src/audio/              synth (procedural sounds), sfx (player), minigunAudio
src/fx/                 dust (sim) + dustDraw, sandMarks (prints, craters, slides, ruts), minigun (tracers, flash, hits, casings)
src/game/               battlefield (shared combat stage), mechUnit (a mech with health), combatLab (combat lab shell), targeting (soft lock)
src/convoy/             route (heading + flattened road), platform, crane (axes + rope swing), carry (pick-up, park,
                        launch), deck (deck as ground, riding, spots), hold (crane hang and park poses), train (line
                        layout, footbridges), tracks (crawler pods), trail (ruts, dust), pipes (seeded pipe runs),
                        furniture, escort (escort driving); drawing: platformBody, trackBody, pipesDraw, bridgeBody,
                        craneBody, escortBody, kit
src/vehicles/           car (vehicle sim), carBody (stand-in raider vehicles)
src/combat/             warband (raider vehicles and bandit mechs), infantry (bandit swarm) + infantryDraw, infantryTarget,
                        banditVat + banditAnim (Vanguard on a baked vertex animation texture; baker in tools/mixamo/),
                        robots (starfish and tripod swarm) + robotLegs, robotsDraw, robotTarget, robotTearFx
src/physics/            deaths (Rapier world of the dead: ragdolls, wrecks), bodies (ragdoll layouts), deadDraw
public/models/          GLB models (provenance in docs/assets.md)
tools/                  *-check.ts headless checks, shots.mjs screenshots
docs/                   design.md (the game), decisions.md (log)
```

## Key conventions

- Units: metres, seconds; degrees in tuning, radians in code. Y up. Heading 0 faces +Z; +X is the mech's left.
- **The ground is a function.** `DuneField.height(x, z)` is pure and deterministic: chunks, feet, vehicles and AI all
  read the same function, so any chunk can be built in any order and nothing disagrees about where the ground is.
- Mech scale: the Rampart is about 4.4 m to the hood, hips at 3.05 m; walk 4 m/s, sprint 6.5 m/s (from the old project).
- Camera: the game is played from a high isometric view (Keith 2026-10-24): 50° down at 40 m, zoom from 45° at 12 m
  out to 55° at 80 m.
  Judge looks and readability from that camera first; close views are for detail.
- Controls: twin-stick. WASD moves the legs (relative to the screen), the mouse aims the torso and guns, left button
  fires.
- Models: parts that ride sim bones are baked to rest-pose world space and hung under pivots on their joints;
  read proportions from the model's joint markers rather than hardcoding them.
- Sound is procedural (`src/audio/synth.ts`, recipes from the old game's SfxSynth): no audio files. It starts on the
  first click or key press.
- Sims step at a fixed 120 Hz inside the frame (see the walker lab) so feel doesn't change with frame rate.

## State

Where every system stands, what's in progress, the next candidates and the change history: `state.md`. Read it
first; update it with every change (rule 10).
