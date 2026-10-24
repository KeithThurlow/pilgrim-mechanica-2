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
| Topics and selection | The panel opens on topic buttons only (Keith 2026-10-24: too many sliders); a topic shows just its slider groups, All shows everything; Reset and Copy act on the shown topic. Hold V: things under the cursor light up with their name, a click opens their topic (walker lab: legs, hull, each minigun, ammo drums, ground = dunes, sky = light; terrain lab: marker, dunes, light). No firing while V is held | `src/core/tweaks.ts`, `src/core/select.ts` | all |
| Report box | A Report button in every lab (reports say what was selected and which topic was open): a note plus screenshot, lab, URL, camera, HUD and every tuning value go to the dev server, written to `reports/` with a line in `reports/inbox.md` for the Claude Code session on Keith's PC; `reports/replies.md` shows back in the box. Without the dev server the report downloads as a file. `reports/` is committed so any agent can read and answer them (Keith 2026-10-24; only Keith reports, revisit if others do). When a report is fixed, delete its `.md`, `.png` and `inbox.md` line in the same commit | `src/core/report.ts`, `tools/report-plugin.ts` | all |
| Game camera | High isometric view (Keith 2026-10-24): starts 50° down at 40 m, fixed facing so W is up the screen, scroll zooms from 45° at 12 m out to 55° at 80 m (mech about half size; Keith 2026-10-24), smooth follow; haze and shadow box scale with zoom; review cameras (close, side, back, feet) orbit | `src/core/isoCamera.ts` | walker |
| Terrain | Rounded crests (`crestSoft`), per-pixel sand surface in the shader (mottling, dark specks, faint wind ripples; colour from a 2 m-wide normal so no grid triangles), soft shadow edges (`shadowSoft`), 1 m grid (Keith 2026-10-24: match the reference video's simple, smooth dunes). Transverse dunes across the wind, tall and close (14 m high, 44 m apart; Keith 2026-10-24), steepest crests near 69°, meandering, breaking crests, crossing set, interdune flats, swell, bumps; pure height function; chunks streamed nearest first under a per-frame budget; vertex-coloured sand, optional facets | `src/world/terrain.ts`, `chunks.ts` | terrain |
| Desert light | Midday desert: a hard high sun, a procedural sky environment (blue above, pale horizon, warm sand below) for soft light, reflections and the sand bounce under vehicles, Neutral tone mapping (picked over ACES and AgX by A/B), haze from the camera, a shadow area that grows with the zoom; dunes cast shadows. Fixed time of day | `src/world/look.ts`, `chunks.ts` | terrain, walker |
| Walker | Digitigrade legs on a pure sim (slopes, Keith 2026-10-24: a squashed planted leg folds its thigh forward and turns its knee out at the hip; slows uphill with the grade; downhill keeps full speed, plants the feet in under the body, drops the hips a little and tips less nose-down; while moving the body leans over its feet, hips about 0.4 m ahead of the planted feet, Keith 2026-10-24): gait phase, duty factor, landing spots predicted on the ground and tilted to slope, mechanical swing and stomp, heel roll-off, body rides the feet and sinks toward the lower one, weight shift and hip roll with a level hull, footfall thud, committed heading, quicker steps near full stretch, settle steps when stopped. Cannon angle measured from the hip-ankle line so the lower leg pitches through the stride, gives under load, opens toward a straighter lower leg at push-off; the heel lifts from 60% of the stance and the foot rolls 48° over the ball of the foot while a hinged toe segment stays flat and pushes, then the toes curl under through the swing and open flat for the stomp (Keith 2026-10-24); feet planted further forward; stance comes in from standing to walking width | `src/mech/walker.ts`, `walkerTuning.ts` | walker |
| Leg types | Archetype presets of walker tuning (proportions, stance, gait, feet): stand-in and Rampart (shorter stride, toe hinge 0.14 m, toes to 0.85 m); the old game's Humanoid, Short humanoid and Stilt go here when they have models. The lab takes the archetype as its defaults; the model's measured bone lengths always win | `src/mech/legTypes.ts` | walker |
| Rampart | The old project's v4 mech on the walker sim (feet split at the toe hinge into heel block and toes): each part rides its bone, leg lengths read from the model's joint markers; hull miniguns on both shoulders (right pod mirrored onto the left in place of the rocket box), barrels spin, pods track and kick; half-width ammo drum per gun (olive) under a stand-in power pack (boxes) | `src/mech/rampart.ts`, `public/models/` | walker (default) |
| Upper body | Twin-stick: torso turns toward the mouse aim at a capped rate within a limit from the legs. Each hull gun on its own (Keith 2026-10-24): aims from its own shoulder, swings inward at full speed and outward slower (so the arms turn at different speeds as the aim sweeps), its own spin-up, fire cone and fire clock (small left/right spin and rate splits), recoil; a limited drum per gun (1200 rounds), R resupplies in the lab | `src/mech/upper.ts` | walker |
| Minigun FX | Tracers to the ground (spread cone, ray against the height function), muzzle flash and light, hits by surface (Keith 2026-10-24): sand hits feed the dust system (a low layer torn up and pushed downrange, dust thrown up) plus grit; steel gets ricochet sparks, a few back off the face, and dark smoke; steel wreck stand-ins (`src/world/wrecks.ts`) to shoot at, rounds strike the first steel before the sand; a clang for steel hits; casings ejected outboard bouncing on the ground; aim reticle amber when the guns bear, grey while turning | `src/fx/minigun.ts`, `src/world/raycast.ts` | walker |
| Unit look | Plain lit paint (dielectric, roughness 0.55) over the model's vertex colours; no outline by default (Keith 2026-10-24); cel bands and the ink outline are still toggles | `src/look/toon.ts` | walker |
| Minigun sound | Ported from the old game, every gun its own voice: its own spin-up (pitched to its spin-up time) and spin-down from its muzzle, its own growl following its own spin and firing (offset and detuned), a spit per round ungated between the guns; dirt hit per round, impact brap gathered every 50 ms, casing tonk on landing; pan by screen position. Starts on the first click or key | `src/audio/` | walker |
| Stand-in walker | Box salvage walker, kept for testing the walk alone (`?model=standin`) | `src/mech/walkerBody.ts` | walker |
| Sand marks | Footprints, round craters (every 2nd round) and slide trails where a step breaks sand loose on a steep face, all flat decals whose shader lights a small hollow-and-rim height field from the sun (lit rim, shaded wall, churned darker sand inside); deeper on steeper sand; fade over 45 s, 900 pooled. Sliders: Sand marks (Legs, Dust, Hits topics) | `src/fx/sandMarks.ts` | walker |
| Dust | After Keith's reference video (old repo `art-refs/particles/m2-res_1080p.mp4`): one pool of 4096 puffs, two kinds: clumps (dense, darker, thrown low, settling) and cloud (grows 3.5×, rises, drifts on the wind, hangs about 5 s). Sources: stomps (sand shoved out and carried along the walk), toe kicks as feet leave the sand (more when sprinting), minigun rounds into sand (spray streaks flung up and forward that fall back in a third of a second for the punch, thick packets churned up and shoved downrange, plus a plume thrown up and forward that strings into a column, after Keith's plume refs). Dust keeps the push of whatever threw it, then the wind takes over after `windIn`. Ground surfaces (sand, gravel, dirt, concrete) scale dust and clumps and darken them; only sand exists so far (`?surface=` to try the others). Puffs receive the sun's shadows (shadow map, four soft taps per pixel, looked up across and above the puff so the sand under it can't stripe it), so dust in shade takes a pale sky-lit grey-brown; they don't shadow each other. Drawn as soft sorted sprites with noise-frayed grainy edges, faked round shading (pale on the sun side, browner beneath) and a depth fade into the sand and the mech; a soft shadow under each puff, cast down the sun's ray onto the dune. Sliders: Dust topic (Dust, Dust: look, Dust: sources, Dust: surfaces) | `src/fx/dust.ts` (sim), `src/fx/dustDraw.ts` | walker |
| Checks | Death physics (floor matches the dunes, a thrown ragdoll lands that way in one piece, the cap, clearing); robot swarm (on ground, crowding, latching, firing, kills, stomps and shake-off, small legs in reach, tripod feet planted on the sand and in reach, tripods stepping, leg hits); robot ragdolls in one piece; war band (seeded: no NaN, no vehicle flipped off the ground, rounds fired, gun runs, circling in band, never into the mech, wrecks settle, the next band comes); vehicles on dunes and flat; the bandit swarm; slopes on tilted planes (the uphill thigh folds, slower uphill, full speed downhill with the feet under the hips; `tools/slope-check.ts`); a close target under the guns' depression still fired on; walker on dunes with stand-in and Rampart leg proportions (reach, clearance, sliding, both feet up, knees, knee straight at push-off; reports thigh-back and knee angles at push-off); guns (independent on target, drums, arcs); terrain (determinism, slopes up to 75°, under 12% steeper than 30°). Dune runs allow 15% reach misses and skip the straight-knee rule (tall dunes); flat ground keeps 1% and 172°; audio (finite, under full scale, growl loops without a seam) | `tools/*-check.ts` | `npm test` |
| Assets | Rampart, back drums, belt link converted from the old repo's FBX; provenance in `docs/assets.md`; converter `tools/fbx-to-glb.ts` | `public/models/` | |
| Battlefield | The shared combat stage (`src/game/battlefield.ts`): dust, sand marks, gun effects and sound, wrecks, and every target; `fire()` resolves a round against the nearest unit of another team, steel or sand, draws it and applies damage. `src/game/combatLab.ts` is the shell every combat lab shares (terrain, light, the player's Rampart on twin-stick, iso camera, panel with topics and hold-V, Report, hull bar and red edge when hit, demo) | `src/game/` | warband, bandits |
| Mech unit | Walker + guns + Rampart model + health as one unit (`src/game/mechUnit.ts`), for the player and bandit mechs (red Ramparts, Keith 2026-10-24); hits on a capsule from the feet past the hull; destroyed: dark wreck and smoke; the player's is rebuilt after a few seconds (lab) | `src/game/mechUnit.ts` | warband, bandits |
| Vehicles | Arcade car sim on the dunes (bicycle steering, grip and drift so hard turns slide, slope climb limit, four sprung wheels), technical and gun-truck presets; stand-in raider bodies with a turret; wheels throw dust and leave ruts | `src/vehicles/car.ts`, `carBody.ts` | warband |
| War band | Raider technicals and gun trucks circle the mech at range and make gun runs a few at a time (attack tokens), turrets track with a turn rate and spread, hurt ones flee; drivers steer round dune faces too steep to climb and never drive into the mech (they aim for a line grazing a clearance round it and turn out to the side their nose points); driving sliders per kind; bandit mechs hold off and strafe; killed vehicles blow up (blast, crater) and are thrown, tumbling and landing on their side or roof; bands keep coming | `src/combat/warband.ts` | warband |
| Bandit swarm | Hundreds on foot (SoA pool, spatial hash): run in fanned out, hold a firing band and shoot in bursts, separation, morale (deaths nearby frighten them into running, they rally later), stomps knock down or kill, bodies thrown and sink; 400 at about 0.4 ms a step | `src/combat/infantry.ts`, `infantryDraw.ts`, `infantryTarget.ts` | bandits |
| Robot swarm | Reshaped (Keith 2026-10-24). Small ones (0.9 m, 8 m/s, 12 hp): four-legged starfish, a low faceted hub with legs splayed on the diagonals, scuttling any way without turning (the hub drifts round; opposite legs step together), run as a pack, leap from 5 m and cling flat on the mech, tearing at it (each bite: sparks at the grip, sometimes a scrap of plate flicked off to the sand, a grinding screech every so often) until shot off, stomped off or shaken off at a run; a fifth hang back and shoot. Big ones (a tenth, 400 hp): War of the Worlds tripods, a 3 m hood 10 m up on three long legs, feet planted and stepping one at a time (dust on each footfall), swing in from the flank, stop at 18-30 m and fire heavy bursts from the hood, ignore stomps; hit on the hood or (half damage) the legs; cast long shadows. `robotCentre()` gives aim points. 300 at about 0.55 ms a step | `src/combat/robots.ts`, `robotLegs.ts` (shapes, leg maths), `robotsDraw.ts`, `robotTarget.ts`, `robotTearFx.ts` | robots |
| Death physics | Rapier world holding only the dead (Keith 2026-10-24): bandit ragdolls (11 boxes, hinged knees and elbows), robot ragdolls (hub and four two-part legs; tripods: hood and three long legs falling from height; parts can be turned), raider wrecks as rigid bodies that can roll over; thrown by the kill; a heightfield floor from the dune function following the player; the oldest freeze past a cap, all sink and clear after a while | `src/physics/deaths.ts`, `bodies.ts`, `deadDraw.ts` | warband, bandits, robots |
| Not started | Convoy (direction in `docs/design.md`), salvage, convoy escort and cranes, explosions, radar, mech classes, day-night cycle, mech joint and footstep sound, a game page | | |

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
- **Legs can't fully handle the tall dunes**: on steep slip faces the Rampart's feet fall out of reach on up to 10% of
  leg-frames (zigzag) and its knee runs straight at push-off; the walker checks were loosened for dunes to allow it.
  A walker that adapts its stride and stance to slope would let them tighten again.
- **Toe split is one hinge per foot** (all toes bend together) and the Rampart's back spur stays rigid on the heel.
- **Only two hit surfaces** (sand, steel) and the steel is box stand-ins; the old game also had rock, concrete, wood
  and flesh, ground marks and gouges.
- **Dust shadows not seen clearly yet** in headless shots (the low dust sits close to its own shadow at a 36° sun);
  `shadowStrength` may need raising. Dust colour is fixed, not driven by the sun or the time of day. Dust in shade
  is darkened from the shadow map but only checked loosely headless.
- **Plume shape only seen from above** in headless shots (it reads as a dense lump at the strike); its column height
  wants judging in motion.
- **Sand marks are lit decals**, not deformed sand: from very low angles they read flat. No tyre ruts yet.
- **Only the main driving values are sliders per kind** in the war band lab (top speed, acceleration, grip, drift,
  steering); the rest of `CAR_PARAMS` (suspension, slopes) stays at the kind presets.
- **A raider can still rarely pass within about 2 m of the mech** (about one band in six in unseeded runs); the
  check runs seeded.
- **Ragdolls are boxes** (the bandit and robot stand-ins' parts as plain boxes); bandit mechs still just go dark
  where they fall (no topple). Rapier in the cloud workspace is a copy from Keith's PC (npm blocked there).
- **No concrete surface for hits yet** (dust plus a few sparks when something concrete exists); the grey wreck
  stand-ins are steel.
- **Mech joint, servo and stomp sounds** from the old game (`MechServoSynth`, the layered stomp, the thrum) aren't
  ported yet; only the minigun's.

## In progress

Nothing right now.

## Next candidates (ask Keith which)

- **Combat labs (Keith 2026-10-24)**, `docs/proposal-combat-labs.md`: war band, bandit swarm and robot swarm built.
- **The convoy, its cranes and escort**: plan in `docs/proposal-convoy.md` (route, a flattened corridor in the height
  function, platforms, a crane state machine for deploy and pick-up, escorts), waiting for Keith.

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
- A real sprint cycle with a flight phase, more like a human sprint (Keith 2026-10-24: push-off extension only makes
  sense with both feet leaving the ground).
- More of the reference video's ground: ruts that stay, pebbles and scrub; other surfaces (gravel, dirt, concrete)
  in the terrain so the dust table has something to read.

## Changes

### 2026-10-24 · Robots reshaped: starfish scuttlers that tear at the mech, tripods on stilts (Claude, cloud session)
- Keith: small robots four-legged and starfish-like, crabbing around; effects for them tearing at the mech; big ones
  tall and stilt-like (War of the Worlds) coming in from the side with long shadows. Small: hub plus four diagonal
  legs, leg pose in the sim (`smallLegPose`), hub drifts instead of turning. Big: three-legged tripods with planted
  feet that step one at a time (sim state), hood at `robotBigHeight`, flank approach, hit capsules on the legs, shots
  from the hood. New `robotLegs.ts`, `robotTearFx.ts`; `robotCentre()` export; `robotRagdoll()` replaces
  `ROBOT_PARTS`/`ROBOT_JOINTS` (death physics parts can be turned); `MinigunFx.sparksAt`; a `grind` sound.
- New sliders: Robots (hub drift, foot lift), Robots: big ones (body height, come in from the side, keep apart, step
  time, step when off by, step lift, leg hit radius, leg hits count), Robots: tearing (sparks per bite, spark speed,
  plate chance, plate speed, plates lie for, grind every), Sound (robots tearing). Damage defaults untouched.
  Latch ring default 0.85 → 1.05 (clingers sat inside the Rampart's hull in the shots); big ones walk 3 m/s.
- Checked: typecheck, `npm test` checks (robots: legs in reach, tripod feet on the sand; deaths: robot ragdolls hold
  together; audio: grind), shots of the robots lab from the game camera and close (`?zoom=15`).

### 2026-10-24 · Reports go into git (Claude, Keith's PC)
- Keith: reports should be in git so any agent can interact with them; only he reports, so it's fine for now.
- `reports/` removed from `.gitignore`; the five reports so far were committed in `46d2b5d`. Comments in
  `CLAUDE.md` and `tools/report-plugin.ts` updated. All five are still open in `reports/inbox.md`.
  Keith: clean them up as they're fixed (delete the report's files and inbox line in the fixing commit).

### 2026-10-24 · Torso no longer jams on targets behind it (Claude, cloud session)
- Found in the war band lab: the demo took fire without shooting back. A target moving round behind the mech
  dragged the torso the short way round, across the back, into its 120° limit, where it stuck with both guns
  pinned. `upper.ts` now turns the torso only within its range (to the nearer limit, sticking to its side unless the
  other is clearly nearer). `tools/upper-check.ts` adds a target circling the mech twice (800 rounds now).
- `combatLab.ts` puts the lab on `window.__lab` for headless debugging.

### 2026-10-24 · Death physics cost cut (Claude, cloud session)
- The dead now collide only with the floor (and wrecks with each other), not with their own neighbouring parts:
  40 moving ragdolls went from about 3.8 to 2.1 ms a 60 Hz frame (Node, software); default cap 30.

### 2026-10-24 · Death physics with Rapier: ragdolls and wrecks (Claude, cloud session)
- Keith approved the plan. New `src/physics/deaths.ts` (world of the dead, heightfield floor, ragdoll and wreck
  builders, cap, freezing, clearing), `bodies.ts` (bandit and robot layouts), `deadDraw.ts` (instanced boxes),
  `tools/deaths-check.ts` (in `npm test`; it caught the floor transposed against the dunes). Swarms: `onDeath`
  and `hideDead`; war band wrecks use the physics (the old throw is the fallback without it); the combat shell
  steps it and adds a Deaths topic. Sand marks: craters every 3rd round, depth 0.9 (too many in the robot shot).
- Convoy answers recorded in `docs/proposal-convoy.md` (automatic crane pick-up while in range, direction slider,
  the route stays as a road).
- Checked: typecheck, `npm test` (ten checks, deaths 0.7 ms a step with 9 ragdolls), robot lab shot (robots read
  well, clingers on the mech). Ragdoll and wreck shots rendering.

### 2026-10-24 · Rapier added as a dependency (Claude, cloud session)
- `@dimforge/rapier3d-compat` ~0.12.0 in `package.json` (the version on Keith's PC); in the cloud workspace it was
  copied from his PC's `node_modules` through the device link. A test world (a ball dropped on a floor) runs.

### 2026-10-24 · Convoy proposal; combat labs in the shots; first enemies at once (Claude, cloud session, Keith away)
- `docs/proposal-convoy.md` (not built, rule 9). `tools/shots.mjs` covers the three combat labs. Bandit and robot
  labs send their first group at once instead of after the first gap.

### 2026-10-24 · Robot swarm lab; enemies hold fire behind dunes; sand marks on shaded slopes (Claude, cloud session, Keith away)
- Robot swarm sim, drawer and check by a helper agent (`src/combat/robots.ts`, `robotsDraw.ts`,
  `tools/robots-check.ts`, in `npm test`); the lead added `robotTarget.ts` and `labs/robots/` (clingers bite the
  mech's hull, stomps knock them off, big ones' rounds always draw).
- `Battlefield.canSee`: bandits, robots and raiders (every quarter second) only fire with a clear line over the sand.
- `sandMarks.ts`: marks are lit by their difference from flat sand, not a ratio; on slopes facing away from the sun
  the whole decal had gone solid dark (seen in a war band shot).
- Checked: typecheck, `npm test` (nine checks), shots of the war band lab (no page errors; just slow in software).

### 2026-10-24 · Walker lab on the shared battlefield; war band driving (Claude, cloud session, Keith away)
- Walker lab now uses `Battlefield` and `MechUnit` like the combat labs (318 → 253 lines); `MechBody` interface so
  the stand-in walker (no guns) runs on it too; `armed` on both bodies.
- War band: per-kind driving sliders (Raider driving), `avoidSteep` (steer round faces too steep to climb), mech
  clearance (grazing line from 35 m out, turn out to the nose's side inside it). New `tools/warband-check.ts`
  (seeded) in `npm test`; it found raiders driving through the mech, now fixed.
- Robot swarm sim and drawer being built by a helper agent (In progress).
- Checked: typecheck, `npm test` (eight checks), shots of the walker lab (Rampart firing at a wreck, stand-in).

### 2026-10-24 · Steel hits: sparks and soft smoke, no solid balls (Claude, cloud session)
- Keith: solid ball impacts on gunfire (bandit rounds on the mech, the minigun on the grey wrecks); steel should
  spark (concrete would be dust and some sparks).
- `minigun.ts`: the opaque ball pool is gone; steel smoke goes to the dust system through `onSteelSmoke`
  (`Battlefield` wires it); `dust.smoke()` for dark puffs (also used for burning wrecks and destroyed mechs).
- Checked: typecheck, `npm test`, close-up of the bandit lab (sparks at the mech's feet, no balls).

### 2026-10-24 · War band and bandit swarm labs, shared battlefield, vehicles (Claude, cloud session + two helper agents)
- Keith: the mech takes damage; no salvage yet; bandit mechs are red Ramparts; a convoy crane lab later; kills should
  physically affect the world (overturned vehicles, ragdolls). Helpers built the vehicle sim and the bandit swarm
  in their own worktrees; the lead built the rest and integrated.
- New: `src/game/battlefield.ts`, `mechUnit.ts`, `combatLab.ts`; `src/vehicles/car.ts`, `carBody.ts`;
  `src/combat/warband.ts`, `infantry.ts`, `infantryDraw.ts`, `infantryTarget.ts`; `labs/warband/`, `labs/bandits/`;
  `tools/car-check.ts`, `tools/infantry-check.ts` (in `npm test`). Minigun FX: 24 flash slots (lights only on the
  player's two), optional casings, a `flesh` surface. Dust: wheel dust; marks: ruts. Rampart: `paint()`.
- Key clashes fixed: the bandit sim's keys that clashed with others are `bandit…`; the dust's wind is now
  `dustWindAngle` (it shared `windAngle` with the dunes, so in the walker lab the dunes had been built at the dust's
  70° instead of their own 25°: they turn back unless a saved value says otherwise).
- Checked: typecheck, `npm test` (all seven checks), headless shots of both labs.

### 2026-10-24 · The impact: spray, craters, prints with depth; shade and banding fixes (Claude, cloud session)
- Keith (two screenshots of the walker lab): no visible impact where rounds hit, only the drifting cloud after; a
  dark red-brown blob (dust over a dune's shadow); banding on the sand and in the dust; wants pressed prints and
  churned sand that sell a heavy mech, cheaply.
- New `src/fx/sandMarks.ts` (replaces `footfall.ts`): prints, craters, slides with sun-lit fake relief. `dust.ts`:
  spray kind (streaks along their screen motion), plume puffs start compact and opaque. `dustDraw.ts`: sky-lit
  shade colour, shadow lookups never below the puff (the stripes), vec2 sprite scale and per-puff rotation.
  `chunks.ts`: ripples fade out beyond about 15 m (they aliased into bands from the game camera), 0.25 default.
- Proposal for the combat labs Keith described: `docs/proposal-combat-labs.md` (not built, rule 9).
- Checked: typecheck, `npm test`, headless shots firing at sand (plume, grit and crater rims at the reticle) and
  walking (a print with a lit rim).

### 2026-10-24 · Dust in shade, directional dust and plumes, surfaces, smoother dunes (Claude, cloud session)
- Keith: dust in shadow was as bright as dust in the sun; dust should come off in the direction of what made it
  (rounds churning thick packets forward, steps pushing it along) before the wind takes it; plumes from minigun
  fire (his `plume.png`, `plume2.png` in the old repo's `art-refs/particles/`); dust by surface (gravel less, dirt
  clods, concrete none); dunes nearer the video: no shading triangles, simple soft shapes.
- `dustDraw.ts`: puffs sample the sun's shadow map (built once the renderer has made it), `inShadow`,
  `dustShadowBlur`. `dust.ts`: per-puff drag and surface tint, `windIn`, `stepPush`, plume sliders, surface table
  and `surfaceAt` hook (lab flag `?surface=`). `terrain.ts`: `crestSoft` (profile averaged across the crest).
  `chunks.ts`: `MeshStandardNodeMaterial` with mottling, specks and ripples per pixel, vertex colours from a wide
  normal, flats less grey, 64 segments. `look.ts`: `shadowSoft` 6.
- Checked: typecheck, `npm test`, headless shots of terrain (before: orange from doubled vertex colours, fixed),
  walker demo, firing at sand close up, a low sun with dust in dune shade.

### 2026-10-24 · Sand dust after Keith's reference video (Claude, cloud session)
- Keith: the dust in `art-refs/particles/m2-res_1080p.mp4` (old repo) is the target: sand kicked up by the wheels,
  picked up by the air, casting shadows, swallowing the vehicle when it drives back through. Built in the walker lab
  (Keith: no separate dust lab).
- Studied the video frame by frame: a dense lumpy band rolled out low, a soft grainy cloud blooming above it that
  drifts and hangs 4-6 s, a soft shadow band under the trail, depth-soft against everything.
- New `src/fx/dust.ts` (sim, sliders) and `src/fx/dustDraw.ts` (TSL sprites and shadow discs). Sources: walker
  `onLiftOff` hook (new) for toe kicks, stomps, minigun sand hits (`onSandHit`; the opaque sand balls and their
  sliders are gone, grit stays). Footprints redrawn as soft rounded hollows (they were plain rectangles). New lab
  flag `?dt=` (fixed time per frame) so headless shots play at true speed.
- Checked: typecheck, `npm test`, headless shots walking, sprinting and firing at 16 m and from the 40 m game camera;
  two looks compared, the browner, lumpier one kept (`dustShade` 0.85, `billow` 0.7, `cloudDensity` 0.65,
  `edgeFray` 0.7). Frame cost not measurable here (software renderer); look at the HUD on Keith's PC.

### 2026-10-24 · The mech leans over its feet while moving (Claude, cloud session)
- Keith: while moving the centre of gravity should sit further over the feet, leaning over itself; the feet looked
  too far out in front, downhill especially.
- `walkerTuning.ts`: `stanceBack` 0.05 → 0.22 (feet land nearer the hips), new `moveLean` 4° nose-down with speed
  (Body), `downhillSitBack` 0 (it pulled the hips back), `downhillPlant` 0.2, `thighFold` 300 (to keep the fold
  visible with the new stance).
- Checked: hips ahead of the planted feet 0.08 → 0.41 m walking on flat, 0.48 m downhill; thigh back at push-off
  rises from about 4° to 16° walking (Keith's earlier note on the thigh trailing: watch this); `npm test` passes, tall
  dune reach misses 0.0 / 2.8 / 1.0% (walk, sprint, zigzag).

### 2026-10-24 · Guns fire again, slope walking, minigun hits by surface (Claude, cloud session)
- Keith: on a side slope the squashed leg's thigh stays straight up and down; slow down uphill; downhill the legs
  reach out in front and tiptoe with the weight out front, so keep the feet planted under the mech at full speed;
  the guns stopped firing; minigun hits should tear sand along the ground and kick dust up, sand by sand and sparks
  off metal, like the old game.
- Guns: a target closer than the guns could depress to was never "on target", so they never fired; the test now
  compares the clamped aim (`src/mech/upper.ts`), with a close-target case in `tools/upper-check.ts`.
- Walker (`walker.ts`, Terrain sliders): `thighFold` 250 (cannon angle searched for a thigh folded forward by
  compression, tipping the cannon forward of vertical if it must: the Rampart's long thigh over its short shin can't
  fold otherwise), `thighSplay` 90 (knee turned out), `uphillSlow` 0.35, `downhillPlant` 0.45, `downhillSitBack`
  0.35 m, `downhillCrouch` 0.3 m, `downhillLevel` 0.25. Grade along the heading is now one smoothed value.
- Hits (`src/fx/minigun.ts`, new "Minigun hits" sliders and a Hits topic): pooled instanced dust balls (2400), grit
  and sparks; `HitSurface` passed per round; `src/world/wrecks.ts`; `metalHit` sound (old BulletImpact recipe).
  New lab flag `?aimat=x,z`.
- Checked: typecheck, `npm test` (new slope check: uphill thigh 22° off vertical vs 10° before on a 19° side slope;
  2.68 m/s up a 17° grade, 4.0 down; downhill feet 0.01 m from under the hips vs 0.82 m out in front
  before), headless shots of sand and steel hits. Rebased on Keith's tall dunes: Rampart reach misses on them drop
  from 2.0 / 6.8 / 10.2% (walk, sprint, zigzag) to 0.2 / 3.9 / 2.0% with the slope changes; hit sizes scaled down to
  suit his hit size 2.1. Sound not heard; software rendering runs at 1 fps, so the low
  layer's streaming motion wasn't seen moving and needs Keith's eye.

### 2026-10-24 · Keith's walker lab values as defaults; tall dunes; checks loosened (Claude, Keith's PC)
- Keith's copied walker lab values became the defaults: gun spin-up 0.8 s, range 45 m; shorter tracers, bigger hit
  dust, softer casing kick (`upper.ts`, `minigun.ts`); sound levels (`sfx.ts`); dunes 14 m high, 44 m apart, meander
  0.7 (`terrain.ts`); sun 36° up, no tone mapping, haze 0.5 (`look.ts`); walker lab shadow box 30. Leg-type values
  left as committed (his copy predates the Rampart's shorter stride).
- Tall dunes fail the old limits (69° crests, reach misses up to 10%, knee straight on steep push-offs), so Keith
  asked for looser checks: `terrain-check.ts` slopes to 75°, steep share 12%; `walker-check.ts` dune runs 15% reach
  misses and no straight-knee rule, flat ground unchanged. `npm test` and `npm run build` pass.

### 2026-10-24 · Topics and hold-V selection (Claude, cloud session)
- Keith: overwhelmed by sliders last time; hold V, click a part (legs, minigun, dunes) and get only its options.
- `src/core/tweaks.ts`: topics (id, label, slider groups), panel opens on the topic buttons, `focus()`; `src/core/select.ts`:
  hold-V selector (raycast registered parts, emissive highlight, cursor tag, ground and sky picks, capture-phase
  click so orbit and firing never see it). Regions on the Rampart (`regions()`: legs, hull, each gun, drums) and the
  stand-in. Both labs declare topics and selectables; reports carry the selection and topic. `[hidden]` now wins in
  the lab CSS.
- Checked: typecheck, headless test holding V over the left minigun, a thigh, a foot, the torso, the drums and the
  ground: each lit up with its name and opened the right topic.

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
