# State

The live record of where the project is. **Every change updates this file in the same commit** (rule 10 in
`CLAUDE.md`), so any agent or session can pick up from here without reading the history.

How to update it:
- **Systems:** keep one short entry per system current. Change it when the system changes.
- **In progress:** add a line when you start something that will outlast your session or that another agent might
  touch; remove it when done. Say who (agent or session), what, which files, and since when.
- **Changes:** add a dated entry at the top for every change: what changed, the main files, what was checked
  (tests, shots), and who made it. Keep each entry a few lines; detail belongs in the commit or the code.

## Systems

| System | State | Where | Lab |
| --- | --- | --- | --- |
| Lab core | Renderer and loop (WebGPU, WebGL 2 fallback), frame-time HUD, slider panel (saved per lab, `?set=` overrides, Copy values), WASD and ground-tap input | `src/core/` | all |
| Terrain | Transverse dunes across the wind (slip faces 30-38°), meandering, breaking crests, crossing set, interdune flats, swell, bumps; pure height function; chunks streamed nearest first under a per-frame budget; vertex-coloured sand, optional facets | `src/world/terrain.ts`, `chunks.ts` | terrain |
| Desert light | Warm sun, cool sky fill, haze at the streaming edge, shadow box following the focus | `src/world/look.ts` | terrain, walker |
| Walker | Digitigrade legs on a pure sim: gait phase, duty factor, landing spots predicted on the ground and tilted to slope, mechanical swing and stomp, heel roll-off, body rides the feet and sinks toward the lower one, weight shift and hip roll with a level hull, footfall thud, committed heading, quicker steps near full stretch, settle steps when stopped | `src/mech/walker.ts`, `walkerTuning.ts` | walker |
| Walker look | Stand-in salvage walker from boxes (cab, armour, stacks, rack, rams behind the knees) | `src/mech/walkerBody.ts` | walker |
| Footfall FX | Footprints (pooled, oldest recycled) and dust puffs | `src/fx/footfall.ts` | walker |
| Checks | Walker on dunes (reach, clearance, sliding, both feet up, knees); terrain (determinism, slopes) | `tools/*-check.ts` | `npm test` |
| Not started | Convoy, salvage, enemies and swarms, weapons (minigun, explosions), radar, mech classes, sound, a game page | | |

## In progress

Nothing right now.

## Next candidates (ask Keith which)

- Convoy lab: a slow convoy of tracked and wheeled vehicles riding the dunes (suspension faked from the height
  function), with the range ring around it.
- Swarm lab: hundreds of instanced enemies chasing the mech over the dunes, with a frame-time budget.
- Weapons lab: port the old minigun and explosion feel.
- Walker: arms and a turning torso, leg types (the old lab had Humanoid and Stilt), jump packs.

## Changes

### 2026-10-24 · state.md as the shared record (Claude, cloud session)
- Added this file; current state and next candidates moved here from `CLAUDE.md`; rule 10 makes updating it part
  of every change. Asked for by Keith to make working across agents easier.

### 2026-10-24 · Web restart (Claude, cloud session)
- Vite + TypeScript + Three.js r186 project; lab core; terrain lab (streamed dunes, desert light); walker lab
  (new digitigrade walker sim, stand-in model, footprints, dust); headless walker and terrain checks; `CLAUDE.md`,
  `docs/design.md`, `docs/decisions.md`.
- Checked: typecheck, `npm test` passing, headless shots of every page with no console errors. Vite itself not run
  (no npm registry in that workspace); first `npm install` on Keith's PC creates the lockfile.
