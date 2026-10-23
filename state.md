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
| Lab core | Renderer and loop (WebGPU, WebGL 2 fallback), frame-time HUD, slider panel (saved per lab, `?set=` overrides, Copy values), WASD input | `src/core/` | all |
| Game camera | High isometric view (Keith 2026-10-24): 50° down at 40 m, fixed facing so W is up the screen, scroll zooms to 45° at 12 m, smooth follow; review cameras (close, side, back, feet) orbit | `src/core/isoCamera.ts` | walker |
| Terrain | Transverse dunes across the wind (slip faces 30-38°), meandering, breaking crests, crossing set, interdune flats, swell, bumps; pure height function; chunks streamed nearest first under a per-frame budget; vertex-coloured sand, optional facets | `src/world/terrain.ts`, `chunks.ts` | terrain |
| Desert light | Warm sun, strong cool sky fill (blue-slate shadows, not black), haze at the streaming edge, shadow box following the focus | `src/world/look.ts` | terrain, walker |
| Walker | Digitigrade legs on a pure sim: gait phase, duty factor, landing spots predicted on the ground and tilted to slope, mechanical swing and stomp, heel roll-off, body rides the feet and sinks toward the lower one, weight shift and hip roll with a level hull, footfall thud, committed heading, quicker steps near full stretch, settle steps when stopped | `src/mech/walker.ts`, `walkerTuning.ts` | walker |
| Rampart | The old project's v4 mech on the walker sim: each part rides its bone, leg lengths read from the model's joint markers; hull miniguns on both shoulders (right pod mirrored onto the left in place of the rocket box), barrels spin, pods track and kick; half-width ammo drum per gun (olive) under a stand-in power pack (boxes) | `src/mech/rampart.ts`, `public/models/` | walker (default) |
| Upper body | Twin-stick (Keith 2026-10-24): torso turns toward the mouse aim at a capped rate within a limit from the legs; guns track the rest inside their arc; spin-up before rounds, alternating guns, recoil, torso shake | `src/mech/upper.ts` | walker |
| Minigun FX | Tracers to the ground (spread cone, ray against the height function), muzzle flash and light, hit dust thrown downrange and sparks, casings ejected outboard bouncing on the ground; aim reticle amber when the guns bear, grey while turning | `src/fx/minigun.ts`, `src/world/raycast.ts` | walker |
| Cel look | Toon bands over vertex colours, inverted-hull ink outlines at constant pixel width (warm dark brown), for units and mechs only (the environment stays outline-free) | `src/look/toon.ts` | walker |
| Stand-in walker | Box salvage walker, kept for testing the walk alone (`?model=standin`) | `src/mech/walkerBody.ts` | walker |
| Footfall FX | Footprints (pooled, oldest recycled) and dust puffs | `src/fx/footfall.ts` | walker |
| Checks | Walker on dunes with stand-in and Rampart leg proportions (reach, clearance, sliding, both feet up, knees); terrain (determinism, slopes) | `tools/*-check.ts` | `npm test` |
| Assets | Rampart, back drums, belt link converted from the old repo's FBX; provenance in `docs/assets.md`; converter `tools/fbx-to-glb.ts` | `public/models/` | |
| Not started | Convoy, salvage, enemies and swarms, explosions, radar, mech classes, sound, a game page; an ammo belt from drum to gun; a modelled power pack | | |

## In progress

Nothing right now.

## Next candidates (ask Keith which)

- Convoy lab: a slow convoy of tracked and wheeled vehicles riding the dunes (suspension faked from the height
  function), with the range ring around it.
- Swarm lab: hundreds of instanced enemies chasing the mech over the dunes, with a frame-time budget.
- Swarm targets for the miniguns: something to shoot, with hits, knockback and death.
- Explosions (the old project's), and an ammo belt from each drum to its gun.
- A modelled power pack (Blender, in the Rampart's construction) to replace the box stand-in.
- Walker: leg types (the old lab had Humanoid and Stilt), jump packs.

## Changes

### 2026-10-24 · Rampart, twin hull miniguns, twin-stick, iso camera, cel look (Claude, cloud session)
- Keith: bring over the v4 mech and its minigun, miniguns on both hull sides, a power pack or backpack, WASD
  separate from aiming, and the high isometric view the game was designed for.
- New: `src/mech/rampart.ts`, `src/mech/upper.ts`, `src/look/toon.ts`, `src/fx/minigun.ts`, `src/world/raycast.ts`,
  `src/core/isoCamera.ts`, `tools/fbx-to-glb.ts`, `public/models/*.glb`, `docs/assets.md`. Walker lab rewritten
  around them (Rampart default, `?model=standin` for the box walker). Walker sim: `ankleBack` tuning, body pitch
  and roll exposed. Click-to-walk removed (left button fires now). Desert light: stronger cool fill.
- Checked: typecheck, `npm test` (now also with the Rampart's leg proportions: passes, sprint reach misses 0.56%),
  headless shots of game, close, back, stand-in and terrain views, no console errors.

### 2026-10-24 · state.md as the shared record (Claude, cloud session)
- Added this file; current state and next candidates moved here from `CLAUDE.md`; rule 10 makes updating it part
  of every change. Asked for by Keith to make working across agents easier.

### 2026-10-24 · Web restart (Claude, cloud session)
- Vite + TypeScript + Three.js r186 project; lab core; terrain lab (streamed dunes, desert light); walker lab
  (new digitigrade walker sim, stand-in model, footprints, dust); headless walker and terrain checks; `CLAUDE.md`,
  `docs/design.md`, `docs/decisions.md`.
- Checked: typecheck, `npm test` passing, headless shots of every page with no console errors. Vite itself not run
  (no npm registry in that workspace); first `npm install` on Keith's PC creates the lockfile.
