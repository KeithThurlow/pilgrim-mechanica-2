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
| Lab core | Renderer and loop (WebGPU, WebGL 2 fallback), frame-time HUD, slider panel (saved per lab with the defaults they were saved against, so a changed default in code wins over a stale save; `?set=` overrides, Copy values), WASD input, frame capture | `src/core/` | all |
| Report box | A Report button in every lab: a note plus screenshot, lab, URL, camera, HUD and every tuning value go to the dev server, written to `reports/` with a line in `reports/inbox.md` for the Claude Code session on Keith's PC; `reports/replies.md` shows back in the box. Without the dev server the report downloads as a file. `reports/` is not in git | `src/core/report.ts`, `tools/report-plugin.ts` | all |
| Game camera | High isometric view (Keith 2026-10-24): starts 50° down at 40 m, fixed facing so W is up the screen, scroll zooms from 45° at 12 m out to 55° at 80 m (mech about half size; Keith 2026-10-24), smooth follow; haze and shadow box scale with zoom; review cameras (close, side, back, feet) orbit | `src/core/isoCamera.ts` | walker |
| Terrain | Transverse dunes across the wind (slip faces 30-38°), meandering, breaking crests, crossing set, interdune flats, swell, bumps; pure height function; chunks streamed nearest first under a per-frame budget; vertex-coloured sand, optional facets | `src/world/terrain.ts`, `chunks.ts` | terrain |
| Desert light | Midday desert: a hard high sun, a procedural sky environment (blue above, pale horizon, warm sand below) for soft light, reflections and the sand bounce under vehicles, Neutral tone mapping (picked over ACES and AgX by A/B), haze from the camera, a shadow area that grows with the zoom; dunes cast shadows. Fixed time of day | `src/world/look.ts`, `chunks.ts` | terrain, walker |
| Walker | Digitigrade legs on a pure sim: gait phase, duty factor, landing spots predicted on the ground and tilted to slope, mechanical swing and stomp, heel roll-off, body rides the feet and sinks toward the lower one, weight shift and hip roll with a level hull, footfall thud, committed heading, quicker steps near full stretch, settle steps when stopped. Cannon angle measured from the hip-ankle line so the lower leg pitches through the stride, gives under load, opens toward a straighter lower leg at push-off; the heel lifts from 60% of the stance and the foot rolls 48° over the ball of the foot while a hinged toe segment stays flat and pushes, then the toes curl under through the swing and open flat for the stomp (Keith 2026-10-24); feet planted further forward; stance comes in from standing to walking width | `src/mech/walker.ts`, `walkerTuning.ts` | walker |
| Leg types | Archetype presets of walker tuning (proportions, stance, gait, feet): stand-in and Rampart (shorter stride, toe hinge 0.14 m, toes to 0.85 m); the old game's Humanoid, Short humanoid and Stilt go here when they have models. The lab takes the archetype as its defaults; the model's measured bone lengths always win | `src/mech/legTypes.ts` | walker |
| Rampart | The old project's v4 mech on the walker sim (feet split at the toe hinge into heel block and toes): each part rides its bone, leg lengths read from the model's joint markers; hull miniguns on both shoulders (right pod mirrored onto the left in place of the rocket box), barrels spin, pods track and kick; half-width ammo drum per gun (olive) under a stand-in power pack (boxes) | `src/mech/rampart.ts`, `public/models/` | walker (default) |
| Upper body | Twin-stick: torso turns toward the mouse aim at a capped rate within a limit from the legs. Each hull gun on its own (Keith 2026-10-24): aims from its own shoulder, swings inward at full speed and outward slower (so the arms turn at different speeds as the aim sweeps), its own spin-up, fire cone and fire clock (small left/right spin and rate splits), recoil; a limited drum per gun (1200 rounds), R resupplies in the lab | `src/mech/upper.ts` | walker |
| Minigun FX | Tracers to the ground (spread cone, ray against the height function), muzzle flash and light, hit dust thrown downrange and sparks, casings ejected outboard bouncing on the ground; aim reticle amber when the guns bear, grey while turning | `src/fx/minigun.ts`, `src/world/raycast.ts` | walker |
| Unit look | Plain lit paint (dielectric, roughness 0.55) over the model's vertex colours; no outline by default (Keith 2026-10-24); cel bands and the ink outline are still toggles | `src/look/toon.ts` | walker |
| Minigun sound | Ported from the old game, every gun its own voice: its own spin-up (pitched to its spin-up time) and spin-down from its muzzle, its own growl following its own spin and firing (offset and detuned), a spit per round ungated between the guns; dirt hit per round, impact brap gathered every 50 ms, casing tonk on landing; pan by screen position. Starts on the first click or key | `src/audio/` | walker |
| Stand-in walker | Box salvage walker, kept for testing the walk alone (`?model=standin`) | `src/mech/walkerBody.ts` | walker |
| Footfall FX | Footprints (pooled, oldest recycled) and dust puffs | `src/fx/footfall.ts` | walker |
| Checks | Walker on dunes with stand-in and Rampart leg proportions (reach, clearance, sliding, both feet up, knees, knee straight at push-off; reports thigh-back and knee angles at push-off); guns (independent on target, drums, arcs); terrain (determinism, slopes); audio (finite, under full scale, growl loops without a seam) | `tools/*-check.ts` | `npm test` |
| Assets | Rampart, back drums, belt link converted from the old repo's FBX; provenance in `docs/assets.md`; converter `tools/fbx-to-glb.ts` | `public/models/` | |
| Not started | Convoy (direction in `docs/design.md`), salvage, enemies and swarms, explosions, radar, mech classes, day-night cycle, mech joint and footstep sound, a game page | | |

## Known gaps

Things that exist in a partial or stand-in form, or that couldn't be done yet. Remove a line when it's fixed.

- **No ammo belt** from each back drum to its gun. The link model is converted (`public/models/ammo-belt-link.glb`);
  the Rampart's pods have no feed-in point yet, so one needs choosing on the model.
- **Power pack is a stand-in** built from boxes in `rampart.ts`; it needs a modelled one in the Rampart's construction.
- **Old weapon kit models missing:** only the half and full back drums, the belt link and the Rampart itself were in
  Git LFS. The Light and Heavy miniguns, hand cannons and missile pods would need rebuilding from the old repo's
  `tools/blender/weapons/` (`docs/assets.md`).
- **Rampart rocket box hidden, not removed:** it's still in `rampart.glb`.
- **Blender sources not in this repo:** the Rampart's scripts (`rampart_v4.py`, `export_game.py`, kits) live in the old
  repo; changes to the model mean going back there and converting again with `tools/fbx-to-glb.ts`.
- **Vite never run in the cloud workspace** (no npm registry there): builds are typechecked and bundled with esbuild
  and screenshotted headless. The first `npm install` on Keith's PC creates the lockfile.
- **Headless shots are WebGL on a software renderer**, so their frame times mean nothing; real numbers come from
  Keith's PC.
- **No ambient occlusion pass**: crevices only get the AO baked into the Rampart's vertex colours. A screen-space AO
  (Three's GTAO node) would ground the mech and the dunes further.
- **Shadows stop at the edge of the shadow area** (it follows the focus and grows with zoom); with a very low sun,
  far dunes don't shadow.
- **The walk may still not match the old lab's feel**: push-off now rolls over hinged toes and the Rampart has a
  shorter stride, but the old lab's swing was blended in joint angles and had AT-ST hip arms; this sim uses a foot
  path and IK. Keith to judge.
- **Toe split is one hinge per foot** (all toes bend together) and the Rampart's back spur stays rigid on the heel.
- **Mech joint, servo and stomp sounds** from the old game (`MechServoSynth`, the layered stomp, the thrum) aren't
  ported yet; only the minigun's.

## In progress

Nothing right now.

## Next candidates (ask Keith which)

- Convoy lab: the convoy as Keith described it 2026-10-24 (`docs/design.md`): platforms of different sizes riding the
  dunes, the biggest on tracks carrying the mech bays and gantries, and a crane that swings out to pick a mech up
  from alongside and set it down. Propose the plan first (rule 9).
- Day-night cycle (Keith 2026-10-24), feeding salvage outcomes.
- Port the old mech joint, stomp and thrum sounds.
- Swarm lab: hundreds of instanced enemies chasing the mech over the dunes, with a frame-time budget.
- Swarm targets for the miniguns: something to shoot, with hits, knockback and death.
- Explosions (the old project's), and an ammo belt from each drum to its gun.
- A modelled power pack (Blender, in the Rampart's construction) to replace the box stand-in.
- Walker: leg types (the old lab had Humanoid and Stilt), jump packs.

## Changes

### 2026-10-24 · Toe joint and leg archetypes (Claude, cloud session)
- Keith: the toes need rigging for the walk to look right, pushing off and curling as the leg comes through; be
  ready for different leg archetypes, as the old game had.
- Sim: a toe hinge per foot (`toeHinge`, `toeLength`, `toeCurl`): at push-off the foot pivots about the ball and the
  toes stay flat; in swing the toes start bent up, curl under, open flat before the stomp; `LegPose.toeHinge/toeQ`.
  `src/mech/legTypes.ts` (stand-in, Rampart); `RAMPART_LEGS` moved there. Rampart foot mesh split at the hinge
  (heel block and toes); stand-in toes hinged too. Rampart stride shortened (2.3 + 0.4 per m/s): thigh back at
  push-off 7° walking, 13° sprinting; a steeper heel lift was tried and made it worse (reach misses, knee 175°).
- Checked: typecheck, `npm test`, side filmstrip of the lower legs (toes flat at push-off, curled in swing).

### 2026-10-24 · Desert lighting, no outline, independent guns, ammo, push-off, dune shadows, Report box (Claude, cloud session)
- Keith: something still drew outlines; the shading looked like a 90s model with the gamma off, not a tank in the
  desert; each gun should be its own gun and sound (arms swinging inward faster than outward, not one arm faster);
  limited ammo per trip; the thigh swung too far back at push-off; dunes cast no shadows; a report box in the app
  that reaches the Claude Code session on his PC.
- Light: sky environment (PMREM of a procedural dome), Neutral tone mapping, sun 3.2, env 0.5 (A/B of ACES, AgX,
  Neutral); dunes cast shadows; shadow area and haze scale with the camera in both labs. Colour space checked: the
  Rampart's vertex colours are linear and read correctly. Look: ink width 0, paint dielectric. Saved slider values
  now carry their defaults, so changed defaults reach Keith's browser. Guns: per-gun aim, inward/outward tracking,
  spin, cone, clock, drums; sound per gun. Walk: `rollOff` 48 from `rollStart` 0.6, `stanceBack` 0.05,
  `hockExtend` 0.45. Report box: `src/core/report.ts`, `tools/report-plugin.ts`, `app.capture()`.
- Checked: typecheck, `npm test` (walker, new upper check, terrain, audio), the report loop end to end in headless
  Chromium (note, screenshot and values written, inbox line added), shots of close, game, side, low-sun terrain.
  Sound not heard.

### 2026-10-24 · Walk fixes, far zoom, minigun sound, no cel shading, harsh sun (Claude, cloud session)
- Keith: the cannon looked locked to one angle and the gait unbelievably wide; let the camera go out until the mech
  is about half size; bring over the minigun sounds; try the mech without cel shading and a harsher bright sun.
- Walker: cannon angle now measured from the hip-ankle line (pitches through the stride), gives under load, opens
  at push-off, never tips past vertical (`hockExtend`, `hockCompress`, `hockMinSlow/Fast`); stance narrows from
  `footSpread` to `walkSpread` once moving; the Rampart uses the old game's widths (0.97 / 0.66 m), no longer its
  wide rest pose. Camera: far zoom 55° at 80 m, log-even scroll steps, `?zoom=` flag; haze and shadows scale with
  zoom. Sound: `src/audio/synth.ts` (old SfxSynth recipes), `sfx.ts` (player), `minigunAudio.ts`; hit and casing
  hooks in `src/fx/minigun.ts`. Look: `celShading` toggle (off), ink 1.2 px; sun 5 at 58°, fill 1.1, exposure 0.72.
  New `tools/audio-check.ts` in `npm test`. Gaps listed under Known gaps. Convoy, salvage and day-night direction
  written into `docs/design.md`.
- Checked: typecheck, `npm test` (walker both leg sets, terrain, audio), headless shots: side filmstrip on flat,
  back, close (shaded and lit sides), game view firing, far zoom; no console errors. Sound not heard (headless).

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
