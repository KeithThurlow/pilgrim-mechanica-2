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
| Leg types | Archetype presets of walker tuning (proportions, stance, gait, feet): stand-in and Rampart (shorter stride, toe hinge 0.14 m, toes to 0.85 m), plus the Rampart Stilt (old legs.stilt) and Rampart Siege (old legs.heavywalker) variants; the old game's Humanoid and Short humanoid go here when they have models. The lab takes the archetype as its defaults; the model's measured bone lengths always win | `src/mech/legTypes.ts` | walker |
| Rampart | The old project's v4 mech on the walker sim (feet split at the toe hinge into heel block and toes): each part rides its bone, leg lengths read from the model's joint markers; hull miniguns on both shoulders (right pod mirrored onto the left in place of the rocket box), barrels spin, pods track and kick; half-width ammo drum per gun (olive) under a stand-in power pack (boxes) | `src/mech/rampart.ts`, `public/models/` | walker (default) |
| Mech variants | Seven Rampart variants (Keith 2026-10-24), any lab with `?mech=<id>`: `rampart-stilt` (stilt legs, Suzaku scout), `rampart-turret` (headless M1-style turret, Stratford-Aegis), `rampart-railgun` (railguns on hull arms, Novus-Lux), `rampart-siege` (heavy walker legs, siege cannon, Valhalla), `rampart-salvager` (cab torso, winch and roll cage, Goliath), `rampart-rocket` (compact torso, rocket salvo pods, Akiyama), `rampart-wildcat` (scrap-rebuilt). Same part contract as the Rampart; back kit placed and painted per variant. Built from Blender scripts in this repo (kit ported from the old project, `tools/blender/`; `run.mjs` queues Blender two at a time; `export_game.py --model --drop`) by `mech-modeler` agents with the `mech-modeling` skill | `src/mech/variants.ts`, `public/models/mechs/`, `tools/blender/mechs/variants/`, `docs/mechs/` | walker, all labs |
| Upper body | Twin-stick: torso turns toward the mouse aim at a capped rate within a limit from the legs. Each hull gun on its own (Keith 2026-10-24): aims from its own shoulder, swings inward at full speed and outward slower (so the arms turn at different speeds as the aim sweeps), its own spin-up, fire cone and fire clock (small left/right spin and rate splits), recoil; a limited drum per gun (1200 rounds), R resupplies in the lab | `src/mech/upper.ts` | walker |
| Minigun FX | Tracers to the ground (spread cone, ray against the height function), muzzle flash and light, hits by surface (Keith 2026-10-24): sand hits feed the dust system (a low layer torn up and pushed downrange, dust thrown up) plus grit; steel gets ricochet sparks, a few back off the face, and dark smoke; steel wreck stand-ins (`src/world/wrecks.ts`) to shoot at, rounds strike the first steel before the sand; a clang for steel hits; casings ejected outboard bouncing on the ground; aim reticle amber when the guns bear, grey while turning | `src/fx/minigun.ts`, `src/world/raycast.ts` | walker |
| Unit look | Plain lit paint (dielectric, roughness 0.55) over the model's vertex colours; no outline by default (Keith 2026-10-24); cel bands and the ink outline are still toggles | `src/look/toon.ts` | walker |
| Minigun sound | Ported from the old game, every gun its own voice: its own spin-up (pitched to its spin-up time) and spin-down from its muzzle, its own growl following its own spin and firing (offset and detuned), a spit per round ungated between the guns; dirt hit per round, impact brap gathered every 50 ms, casing tonk on landing; pan by screen position. Starts on the first click or key | `src/audio/` | walker |
| Stand-in walker | Box salvage walker, kept for testing the walk alone (`?model=standin`) | `src/mech/walkerBody.ts` | walker |
| Sand marks | Footprints, round craters (every 2nd round) and slide trails where a step breaks sand loose on a steep face, all flat decals whose shader lights a small hollow-and-rim height field from the sun (lit rim, shaded wall, churned darker sand inside); deeper on steeper sand; fade over 20 s, 900 pooled; the sun side of a rim stays faint (`markRim`) and a mark laid in a dune's shade gets no sun relief at all (marched toward the sun when laid), so no bright spots in shade. Sliders: Sand marks (Legs, Dust, Hits topics) | `src/fx/sandMarks.ts` | walker |
| Dust | After Keith's reference video (old repo `art-refs/particles/m2-res_1080p.mp4`): one pool of 4096 puffs, two kinds: clumps (dense, darker, thrown low, settling) and cloud (grows 3.5×, rises, drifts on the wind, hangs about 5 s). Sources: stomps (sand shoved out and carried along the walk), toe kicks as feet leave the sand (more when sprinting), minigun rounds into sand (spray streaks flung up and forward that fall back in a third of a second for the punch, thick packets churned up and shoved downrange, plus a plume thrown up and forward that strings into a column, after Keith's plume refs). Dust keeps the push of whatever threw it, then the wind takes over after `windIn`. Ground surfaces (sand, gravel, dirt, concrete) scale dust and clumps and darken them; only sand exists so far (`?surface=` to try the others). Puffs receive the sun's shadows (shadow map, four soft taps per pixel, looked up across and above the puff so the sand under it can't stripe it), plus a march toward the sun over the dunes per puff on the CPU (every 4th frame each, smoothed) for hill shadow that doesn't depend on the shadow map's area, so dust in shade takes a pale sky-lit grey-brown; they don't shadow each other. Drawn as soft sorted sprites with noise-frayed grainy edges, faked round shading (pale on the sun side, browner beneath) and a depth fade into the sand and the mech; a soft shadow under each puff, cast down the sun's ray onto the dune. Sliders: Dust topic (Dust, Dust: look, Dust: sources, Dust: surfaces) | `src/fx/dust.ts` (sim), `src/fx/dustDraw.ts` | walker |
| Checks | Baked bandit (feet on the ground every frame, no jumps or loop seams, rifle holds shape, playback); soft lock (`targeting-check`); convoy (`convoy-check`); death physics (floor matches the dunes, a thrown ragdoll lands that way in one piece, the cap, clearing); robot swarm (on ground, crowding, latching, firing from all three sizes, saw strikes, a few big ones, kills with each size much tougher than the last, stomps and shake-off, small legs in reach, medium and big feet planted on the sand and in reach, walkers stepping and not sagging, no NaN, arm and bucket hits, the elbow above the chassis); robot ragdolls of all three sizes in one piece; war band (seeded: no NaN, no vehicle flipped off the ground, rounds fired, gun runs, circling in band, never into the mech, wrecks settle, the next band comes); vehicles on dunes and flat; the bandit swarm; slopes on tilted planes (the uphill thigh folds, slower uphill, full speed downhill with the feet under the hips; `tools/slope-check.ts`); a close target under the guns' depression still fired on; walker on dunes with stand-in and Rampart leg proportions (reach, clearance, sliding, both feet up, knees, knee straight at push-off; reports thigh-back and knee angles at push-off); guns (independent on target, drums, arcs); terrain (determinism, slopes up to 75°, under 12% steeper than 30°). Dune runs allow 15% reach misses and skip the straight-knee rule (tall dunes); flat ground keeps 1% and 172°; audio (finite, under full scale, growl loops without a seam) | `tools/*-check.ts` | `npm test` |
| Weapon models | The library every weapon draws from (`src/weapons/library.ts`): a model by id (`createWeapon(id, look)`, after `preloadWeapons()`), loaded from `public/models/weapons/<id>.glb` + json sidecar when the file exists, else a `-left` mirror of the right one, else a code stand-in, so the desktop Blender agent's models (`docs/asset-list.md`) drop in with no code change. The desktop agent's W1 rocket launchers and rocket as delivered. Converted from the old kit: minigun L/M/H, hand cannon L/M/H, missile pod L/M/H (+ left files), back drums, belt segments. Code stand-ins built with a TypeScript port of the old Blender kit (`src/weapons/kit/`: lofts, lathes, sweeps, ribbed hoses, bolts, hazard stripes, chevrons, stencil digits, louvres, lamps): heavy mortar, line mortar rack (seven tubes), rail cannon hull and two-handed, autocannon, cannon, plasma cannon, laser projector, and the rocket, missile and mortar-shell projectiles. A `WeaponModel` has sockets (`Muzzle_n`, `Mount`, `Grip_R/L`, `Eject`, `Laser`, `Glow_n`, `FeedIn`), nested moving parts (`Spin`, `Slide`, `Barrel`, `Recoil`, `Lid`, `Door_n`, `Missile_n`, `Tube_n`, `Launcher`) and setters (spin, doors, missiles, slide, elevation, tube recoil, lid, kick, heat, lamps, paint scheme). Look (`weaponLook.ts`): paint by section from schemes (default the Rampart's khaki and olive), wear, sand dust on top, glinting bare metal, glowing lamps, barrel heat glow, rim light, a 1.1 px weapon-only ink line; a faint red targeting laser (`laserSight.ts`) on the minigun, launchers and pods. Fit on the Rampart (`mounts.ts`, no change to `rampart.ts`): hull guns on the gun pivots in place of the stock pods, shoulder weapons on the hull top, back weapons over the drums; scale 1.0. The arsenal draws every weapon and projectile through it (`models.ts` -> `modelSwap.ts`, `projectileDraw.ts`) | `src/weapons/library.ts`, `catalog.ts`, `parts.ts`, `weaponModel.ts`, `weaponLook.ts`, `palette.ts`, `laserSight.ts`, `mounts.ts`, `demo.ts`, `kit/`, `build/` | armoury |
| Assets | Rampart, back drums, belt link converted from the old repo's FBX; the bandit (Mixamo Vanguard + six clips baked to an animation texture by `tools/mixamo/bake-bandit.ts`); provenance in `docs/assets.md`; converter `tools/fbx-to-glb.ts` | `public/models/` | |
| Battlefield | The shared combat stage (`src/game/battlefield.ts`): dust, sand marks, gun effects and sound, wrecks, and every target; `fire()` resolves a round against the nearest unit of another team, steel or sand, draws it and applies damage; units give a real surface normal so sparks ricochet off vehicles and mechs (`sparkSize` slider). **Soft lock** (`src/game/targeting.ts`, Keith's ray rule): the enemy under the cursor along the camera ray (tall ones by their body), else the one nearest the line of fire through the cursor out to gun range; aim at centre of mass; orange brackets on the lock; sliders in Your mech > Targeting. `src/game/combatLab.ts` is the shell every combat lab shares (terrain, light, the player's Rampart on twin-stick, iso camera, panel with topics and hold-V, Report, hull bar and red edge when hit, demo) | `src/game/` | warband, bandits |
| Mech unit | Walker + guns + Rampart model + health as one unit (`src/game/mechUnit.ts`), for the player and bandit mechs (red Ramparts, Keith 2026-10-24); hits on a capsule from the feet past the hull; destroyed: dark wreck and smoke; the player's is rebuilt after a few seconds (lab) | `src/game/mechUnit.ts` | warband, bandits |
| Loadout | Step 1 of `docs/proposal-loadout.md` (Keith approved 2026-10-25). Items (pure, `src/items/`): base table (legs Rampart / Stilt / Siege: walk, sprint, accel, stride, stomp, turn, carry; hulls Rampart / Siege / Salvager: hull points, torso turn, two arm mounts and a pack mount, Salvager cargo racks; arms Rampart / Wildcat: their hand gun's arc and tracking; minigun Light (hand), Medium (hull weapon on an arm mount), Heavy (two-handed); packs stand-in / capacitor: dash charges and recharge, one back mount; back: ammo drums, full drums), five rarities with 0-4 Protocol sockets and rolls widened both ways per tier, eight data-only Protocols fitting by tags (item or whole-mech stat changes), seeded rolls, fit rules with cascades (a hull weapon in place of an arm drops its hand gun, a two-hander takes both hands and needs both arms, Medium only on hull mounts, back needs a pack), `resolve()` to walker/upper/mech/dash values, cargo (tonnes, legs' carry + hull racks) and an unlimited stash, `loseCargo()` (a hook for safety pockets). Each item has a `look` variant id (only "rampart" has a model; the rest draw as the Rampart). The default loadout is today's mech exactly. `applyLoadout` writes the values onto a mech unit, gives each gun its own values (or switches a side off), hides pods, drums or pack that aren't fitted. Bay screen (`src/ui/bay.ts`): slots, item card with sockets and a pick-a-Protocol control, fitting items with hover deltas, click to fit, cargo and stash lists with weights, loot rolls by rarity; saved in localStorage | `src/items/` (item, bases, rarity, protocols, loadout, generate, cargo), `src/game/loadoutApply.ts`, `src/ui/bay.ts`, `src/game/dummies.ts` + `dummiesDraw.ts` | loadout |
| Vehicles | Arcade car sim on the dunes (bicycle steering, grip and drift so hard turns slide, slope climb limit, four sprung wheels), technical and gun-truck presets; stand-in raider bodies with a turret; wheels throw dust and leave ruts | `src/vehicles/car.ts`, `carBody.ts` | warband |
| Convoy | A train (Keith 2026-10-24): six platforms in a line along the route (the 40×16 m mech bay leading, a 30×14 m tracked workshop, then wheeled housing, motor pool and fuel cars, and a second 40×16 m tracked mech bay at the back with its crane aft, Keith 2026-10-25), 9 m of sand between them for the mech to walk through (`trainGap`, was 12; bridges 11 m); decks are cut-cornered octagons, not rectangles (Keith 2026-10-25: more hexagonal; `outline.ts`: bigger cuts at the front, small at the back, a pointed prow on the lead), and the walkable deck, push-out footprint, rails, seams and edge pipes follow the outline; each car's middle on its line's path and turned along the chord between bogie points 40% of its length either side, so the line snakes through turns; in a turn the following cars drop back so the inside corners keep the gap (`spread`); optional two shorter lines side by side (`trainLanes`). Footbridges (`bridgeCount` per gap) between landing towers 3 m above the decks (the mech walks under): two telescoping gangway halves drawn between the cars' landings each frame, lifted clear like drawbridges when a tight turn pulls them out of reach. Dune-style crawler tracks on the bay and workshop: trapezoid pods (long run on the sand, shorter top, sloping ends; `trackPods` per side, standing `trackOut` past the deck so they read from above; the footprint grows with them), tread plates that scroll with the distance travelled. Every track pod and wheel leaves ruts (`SandMarks.rut`, one per line every `convoyRutEvery` m) and throws dust (`DustSim.wheel`, surface-scaled, drifting on the wind). Seeded pipe runs on every platform (`pipes.ts`, after the old project's greebler: bundles with brackets, flanges and valves along the skirts and deck edges, risers from junction boxes up hut and machine walls and over the top, low or up-and-over runs between machines, none across the bay's walkable deck; `pipeDensity`, `pipeSeed`, `pipeScale`). A technical and a gun truck tied down on the motor pool; escorts (`escortCount` 12, was 4, Keith 2026-10-25: more; technicals, gun trucks, six-wheelers, war rigs and a tank on the war band's car sim in the convoy's teal-grey) hold stations either side of the train with a weave (two scout ahead of the lead and two trail the tail, closer in), each surging faster and slower on its own rhythm (`escortSurge`), match speed, keep clear of platforms, each other and the mech, steer round steep dunes; `escort.mode` is the hook for defending (not built). The convoy rolls along a route at 3.3 m/s (Keith 2026-10-25: a little slower; was 4) on a heading slider with slow wander; the route flattens a 30 m road (edge blend, berms) into the dunes through an optional `DuneField.modifier` (still a pure function of position) that stays behind as a road home; chunks under new road are rebuilt in place. A jib crane on the bay (slew, luff and hoist each with a top speed and acceleration, quick since Keith 2026-10-25: pick-up about 12.7 s from coming in range to standing on the deck, launch about 10.4 s from the pad to letting go; the cradle hangs on the rope as a damped 2D pendulum pushed by the jib's and the platform's accelerations, the hanging mech leaning with it) picks the mech up automatically once it stays in range for 0.4 s (leave range before the cradle grips and it doesn't), lifts it over the rail, swings it aboard, holds it over the set-down pad until the swing settles and sets it down. Then the mech walks the moving deck (Keith 2026-10-24): the deck is its ground (`DeckGround`), the platform's motion carries it each frame (`WalkerSim.carry`), rails and deck furniture keep it on. Two parking bays: E kneels the mech there (Space dashes while walking free on the sand or a deck, as in the combat labs) ("the pilot can climb out here", not built), E stands it up. Defences (Keith 2026-10-25, `defence.ts`, `defenceBody.ts`): two twin-gun turrets per car on sponsons at the cut corners (`defenceCount`) and a heavy one on each mech bay's cab roof, slewing at their turn rates toward the nearest threat in range, sweeping about their rest bearing when idle; `target(points)` and `onFire` are the hooks for the combat code (nothing shoots yet; `?threat` puts a marker circling the train). With two bays the nearer crane comes for the mech, which then walks that bay's deck. Two launch pads by each crane: stand on one and the crane comes, lifts the mech out over that side, steadies it with the feet `craneDropHeight` (3 m) over the sand and lets go (Keith 2026-10-25): it falls keeping the convoy's velocity, legs bracing wide for the ground, and lands heavily (hips sink `craneLandSink` and spring back, the thud spring kicked by the fall speed via `WalkerSim.thud`; the lab adds a dust burst, deep prints and a crater mark, a bang and a camera shake), forced to follow for 2 s before WASD returns; step off first and it cancels; G launches from anywhere on the deck. No sand prints or dust on the deck. Stand-in looks | `src/convoy/` (route, platform, outline, train, tracks, trail, pipes, furniture, escort, defence, crane, carry, deck, hold; drawing: platformBody, trackBody, pipesDraw, bridgeBody, craneBody, escortBody, defenceBody, kit), `labs/convoy/` | convoy |
| War band | Raider technicals, gun trucks, six-wheelers (autocannon), a War Rig lead truck (eight wheels, front four steer, two turrets) and a makeshift tank (tracks, skid steer, stops to fire a slow heavy cannon) circle the mech at range and make gun runs a few at a time (attack tokens), turrets track with a turn rate and spread, hurt ones flee; drivers steer round dune faces too steep to climb and never drive into the mech (they aim for a line grazing a clearance round it and turn out to the side their nose points); driving sliders per kind (top speed only for the new three); every turret aims and fires on its own; bandit mechs hold off and strafe; killed vehicles blow up (blast, crater) and are thrown, tumbling and landing on their side or roof; bands keep coming | `src/combat/warband.ts` | warband |
| Bandit swarm | Hundreds on foot (SoA pool, spatial hash): run in fanned out, hold a firing band and shoot in bursts, separation, morale (deaths nearby frighten them into running, they rally later), stomps knock down or kill, bodies thrown and sink; 400 at about 0.4 ms a step. Drawn as Mixamo's Vanguard (Keith 2026-10-24) baked to an animation texture: one instanced mesh, 2.2k tris each, per-bandit clip, time, rate and crossfade in the vertex shader; run in (speed-matched), sprint when fleeing, rifle aim standing, walk-and-fire moving in the band (backward when backing off), flinch when hit; armour plates in the raider cloth colours; boxes still behind `banditLook`. Sliders: Bandits: look | `src/combat/infantry.ts`, `infantryDraw.ts`, `banditVat.ts`, `banditAnim.ts`, `infantryTarget.ts` | bandits |
| Robot swarm | Autonomous terraforming machines in three sizes (Keith 2026-10-24), industrial yellow and grey with wear, hazard stripes, lamps (stand-in geometry built in code, `robotShapes.ts`). **Small scrappers** (0.9 m, 8 m/s, 12 hp): a grey hub with a yellow top plate, cutting disc and jaws in front, a scrap hopper; four legs splayed on the diagonals, scuttling any way without turning, run as a pack, leap from 5 m and cling on the mech, tearing at it (sparks, plates flicked off, a grinding screech) until shot, stomped or shaken off; a fifth hang back and shoot. Light: rounds pierce them, splash hurts them fully. **Medium cutters** (15%, 2.2 m body 1.5 m up, about 2.5 m tall, 3.5 m/s, 90 hp): a crab chassis on four planted legs stepping in diagonal pairs (knees up over the body, a ram on each thigh), a circular saw on the right front, a scrap bin on the back; half hold at 9-16 m firing slugs (3 damage) after a 0.65 s tell (lamps flash red, it rears back, the aim fixes where the mech was), half walk right in; any within 4 m of the mech rears back with the saw spinning up and its lamps flashing red (0.7 s), then lunges where the mech was and saws (5 damage, sparks and torn plate), so a dash in time dodges both (Keith 2026-10-24: skill against the swarms). They stop rounds, take 35% of splash, ignore stomps. **Big excavators** (3.5%, about one a pack of 30, 500 hp): a small chassis (cab, engine house, striped counterweight, gun under the front) 10 m up on four legs that are excavator arms: boom up to an elbow about 15 m up, stick down to a bucket planted in the sand, three rams and a hose on each; one leg steps at a time (the bucket curls as it swings; dust on each footfall), swing in from the flank, stop at 18-30 m and, after a tell (chassis rears, gun lamp red), lob volleys of two slow charges from the chassis through `Battlefield.lob` (a ring on the sand where each lands; flight about 1-2 s from the charge speed, leading the mech's walk by a share, scattered), so they can be dashed out of; hit on the chassis or (half damage) the arms; cast long shadows. Walker feet drag along the sand rather than fall out of reach (saw lunges). `robotCentre()` gives aim points for all three. 300 at about 0.6-1.5 ms a step headless | `src/combat/robots.ts`, `robotLegs.ts` (shapes, leg maths), `robotShapes.ts` (stand-in geometry), `robotsDraw.ts`, `robotTarget.ts`, `robotTearFx.ts` | robots |
| Death physics | Rapier world holding only the dead (Keith 2026-10-24): bandit ragdolls (11 boxes, hinged knees and elbows), robot ragdolls (small: hub and four two-part legs; medium: chassis and four two-part legs; big: chassis and four arm legs as boom, stick and bucket falling from height; parts can be turned), raider wrecks as rigid bodies that can roll over; thrown by the kill; a heightfield floor from the dune function following the player; the oldest freeze past a cap, all sink and clear after a while | `src/physics/deaths.ts`, `bodies.ts`, `deadDraw.ts` | warband, bandits, robots |
| POIs and salvage | Placement is a pure function of position (`PoiField`): the world cut into cells (`poiCell` 400 m for tiers 1-2; tier 3 twice that, tiers 4-5 four times, levels ready but empty), each cell's hash decides 0-1 POI, its tier (tier weights), kind (weights per biome; `biomeAt` optional, all desert until `biomes.ts` lands), the flattest of `poiTries` spots kept `poiSpacing / 2` inside the cell (so spacing holds and pads never cross cells), yaw and seed; small ones give way to bigger ones nearby. Pads (`PoiPads`, a GroundModifier): a capsule levelled at the mean of the ground it covers, the swell cancelled by a quadratic fit, blended back over `padBlend`; stacked with the convoy road through `ModifierStack` / `addModifier` (`src/world/modifiers.ts`; folds exactly, `terrain.ts` untouched). Tier 1-2 kinds as seeded builders (props as data, sections and spots): rock outcrop with a wedged plate and strut, wreck part (a torn-off mech leg or a curved hull plate with ribs), crashed supply pod (furrow, scorch, chute, crates), debris field (2-3 heaps as sections, 4-8 spots, clutter, on a pad), dead convoy (2-4 burnt raider vehicles via `CarBody.setWrecked`, each a section, ruts, on a capsule pad). Salvage (`SalvageSim`): within `salvageReach` of the hips hold E, a bar fills over the spot's strip time, out of reach it pauses, a spot pays its scrap when done, a section banks when its last spot does; `onNoise` every `noiseEvery` s (`noiseRadius`) for swarms later. Drawn: rings and bobbing markers on spots, billboard progress bars, sparks (`gunFx.sparksAt`), hot bits flung and bouncing, grinding smoke and dust, the grind sound, a pulse on the sand per noise; HUD scrap counter and "Hold E" prompt; overhead map (M, `?view=map`) with tier icons over a few km | `src/world/pois.ts`, `poiPads.ts`, `modifiers.ts`; `src/pois/` (site, kinds, outcrop, wreckPart, supplyPod, debrisField, deadConvoy, salvage; drawing: poiDraw, salvageDraw, salvageHud, mapView) | pois |
| Craters | Blasts dent real ground (Keith 2026-10-25): a layer in the height function (`DuneField.dents`, added after the modifiers), so feet, wheels, AI, chunks and the death floor all follow it. A sparse 0.5 m lattice in 16 m tiles holds the sand moved; height = softness × saturated sum × one global slump factor, bilinear between nodes. A crater is a bowl and a rim (rim slider 1 balances the volume), fitted on the lattice: sand slides off steps steeper than the wall limit (30°) or than the ground already was, then a chamfer pass settles the rest; stacked blasts saturate toward a max depth. Hardness: bare rock 0.95, rocky sand 0.6, shallows 0.15; POI pads, the convoy road (any ground modifier's floor) and `protect()` circles fully hard plus a 4 m margin, softening over 4 m more, so they never change height. Craters slump back (95% after 180 s), healed tiles are dropped, past 200 the oldest heal over ~3 s. Hooks: `Battlefield.dent` from shells (`burst`: tank shells, bandit rockets, robot charges) and raider blow-ups; combat labs patch the touched chunk vertices in place (`TerrainStreamer.patchArea`, water sheet too) and rebuild the death floor; `?craters=N` sets off N blasts round the start | `src/world/craters.ts`, `terrain.ts`, `chunks.ts`, `src/game/battlefield.ts`, `combatLab.ts` | warband, bandits, robots |
| Weapons | `docs/proposal-weapons.md`. Controls (Keith 2026-10-25): left click fires the left side, right click the right (F both); shoulder weapons on keys 1-3 (shoulder mounts 1 and 2, back mount 3; 4 kept for drones): hold to paint, release to fire. Each weapon its own targeting, pure sims in `src/weapons/`: **RPG rocket** (hull item on a side button, shoulder item on a key; straight at the ground under the cursor, goes off early on a body, steel or a dune, big blast; `rocket.ts`), **missile pod** (up over the shoulder, 10 missiles share out the enemies within 8 m of the point and follow them down, scattering over the area if none; `swarm.ts`), **big mortar** (one huge shell, ring the blast's size, a dotted arc that rises over dunes, leads a locked walker), **line mortar** (step 1's line salvo as lobbed shells: strip centred on the cursor, snaps onto a line of targets, shells land in order up it; the strip stays dim while they fall), **rail cannon** (hold to charge, a beam hugging the sand pierces its line), **autocannon** (flying shells leading the lock). A very faint glinting **targeting laser** on miniguns and rocket launchers, stronger as the sun goes down. Every explosive goes through `Battlefield.blast`; its crater is queued and dug within a per-frame budget (merging close ones), the HUD shows the cost. Items: `rpg-medium`, `rail-light`, `rail-medium`, `ac-medium`, `sh-rpg`, `sh-missiles`, `sh-mortar`, `sh-linemortar`; loadout slots `shoulderL`, `shoulderR` (hull `mounts.shoulders`). Stand-in models, one function per weapon (`models.ts`), on the pod pivots, shoulder mounts or the back mount top. Sliders: Weapons topic (Painter, RPG rocket, Missile pod, Big mortar, Line mortar, Line mortar assist, Rail cannon, Autocannon, Targeting laser, Blasts, Weapon sound) in every combat lab | `src/weapons/`, hooks in `battlefield.ts` (`blast`, `onBlast`, `queueDent`, `dentStats`, `Hittable.knock`), `mechUnit.ts` (`weapons`, `keys`, `cursor`, `lock`, per-side `Trigger`), `upper.ts` (`GunStats.cls/own/light`, `Trigger`), `combatLab.ts` (buttons, keys, arsenal, shake, HUD), `rampart.ts` (`mount`, `showPod`), `sfx.ts` (`addSound`), `items/` (bases, slots) | weapons |
| Not started | Convoy (direction in `docs/design.md`), convoy escort and cranes, radar, mech classes, day-night cycle, mech joint and footstep sound, a game page | | |

## Known gaps

Things that exist in a partial or stand-in form, or that couldn't be done yet. Remove a line when it's fixed.

- **No ammo belt** from each back drum to its gun. The link model is converted (`public/models/ammo-belt-link.glb`);
  the Rampart's pods have no feed-in point yet, so one needs choosing on the model.
- **Power pack is a stand-in** built from boxes in `rampart.ts`; it needs a modelled one in the Rampart's construction.
- **Weapon stand-ins:** the mortars, rail cannons, autocannon, cannon, plasma and laser guns, the missile and the
  mortar shell are code stand-ins until the desktop agent's models land (`docs/asset-list.md`). The converted miniguns
  are over the 6k budget (10.6-14.5k) and the Heavy pod is 8.7k; their rebuilds are W9 and W4. A pod H costs about 60
  draw calls (31 moving parts plus ink); merge parts if it shows in the frame time. The weapon look's sliders live in
  the armoury lab only; the arsenal uses their defaults.
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
- **Sand marks are lit decals**, not deformed sand: from very low angles they read flat. Tyre and track ruts are
  chains of slide decals, so up close they look beaded rather than a continuous strip, and they fade with the other
  marks (20 s).
- **Convoy stand-ins**: the crawler pods, pipes, footbridges and landings are boxes and extrusions; nobody walks the
  footbridges yet (no pilot on foot); escorts don't fight (`escort.mode`); the escorts and the motor pool's vehicles
  share one material, so hold-V lights them together. Turrets don't shoot (no enemies in the convoy lab; the `onFire` hook is unwired) and their corner sponsons aren't in the push-out footprint (a mech hugging a corner can clip one). With two footbridges per gap the outer landings sit near the cut front corners. Heavier escorts (six-wheelers) pass closer to the cars in hard turns (3.2-3.9 m, was 8.5 with only light ones). The rear bay and its crane have no demo of their own (the demo uses the nearer crane, normally the front).
- **Only the main driving values are sliders per kind** in the war band lab (top speed, acceleration, grip, drift,
  steering); the rest of `CAR_PARAMS` (suspension, slopes) stays at the kind presets.
- **A raider can still rarely pass within about 2 m of the mech** (about one band in six in unseeded runs); the
  check runs seeded.
- **Ragdolls are boxes** (the bandit and robot stand-ins' parts as plain boxes; a Vanguard bandit turns into a box ragdoll when it dies); bandit mechs still just go dark
  where they fall (no topple). Rapier in the cloud workspace is a copy from Keith's PC (npm blocked there).
- **No concrete surface for hits yet** (dust plus a few sparks when something concrete exists); the grey wreck
  stand-ins are steel.
- **Baked bandit is rough in places:** no crouch or cover clip (the sim has no cover); downed bandits topple as a frozen pose; the rifle is boxes and the sprint and flinch carry it in the right hand only; a few triangles at the shoulders and elbows pinch at full swing (linear skinning); the run-and-fire clip is rarely chosen (bandits only shoot while standing in the band).
- **Mech joint, servo and stomp sounds** from the old game (`MechServoSynth`, the layered stomp, the thrum) aren't
  ported yet; only the minigun's.

- **POIs are stand-ins and walk-through:** props are boxes, rocks, I-beams and a capsule; the mech walks through them (no
  collision), rounds don't hit them (not steel for `Battlefield` yet), nothing listens to salvage noise yet, and spots
  are stripped whole (no item drops, no carrying value home; Keith: rarities later).
- **POI pads ride the biome-free ground:** pads cancel the swell assuming `floor = swell + lift`; if biomes change how the
  floor is made, `rawGround` in `src/world/poiPads.ts` needs a look.

- **Loadout step 1 is rough:** every part draws as the Rampart (the variants aren't pushed), so legs, hulls and arms
  change stats but not looks, and a hand gun or two-hander draws as the hull minigun pod; a two-hander fires from the
  right pod only. Shared gun sliders tune a gun only while its values match the first gun's (else the item's own
  values win). No bay pad or convoy bay yet (B opens it anywhere); no dragging (Protocols are picked from a list).
  Cargo has nothing to fill it yet (no item drops in the world).

- **Craters are rough in places:** the flat sand-mark decals laid before a blast (prints, ruts) keep their old height
  and float or sink in a new crater; a crater's bowl is only a few chunk vertices across at the 1 m grid, so small
  ones read soft; the convoy lab doesn't wire craters yet (the road is protected through the field's modifier, but
  `craters.invalidate` should follow `route.onChange` when it does); the wall limit is fitted on a 0.5 m lattice, so on
  sharp dune creases a few points run 2-4° over; dense tiles never shrink until they heal.

## In progress

- Convoy pass 3 merged (crane, drop-off, rear bay, turrets, octagon decks, 12 escorts, dash). Rough: heavy escorts pass 3-4 m from cars in hard turns; the drop lands in the escort lane; turrets not in the collision footprint.
- Ground dents (GPU dent layer + fine detail patch replacing the sand-mark decals): an agent on a worktree branch.
- Biomes: step 1 and water effects in. Rocky ground still reads as grey plateaus (needs boulders and broken edges, step 3); the rocky-to-shallows border blends to plain sand.
- Weapons: steps 1 and 2 merged. Next: cannon, plasma cannon, laser beam, hand guns, drones; weapon models swapped in from `src/weapons/library.ts` (each `models.ts` function returns the library model, the boxes are the fallback).
- Weapon models: library, converted old kit and stand-ins in (`src/weapons/library.ts`, armoury lab). Stand-ins left for W2-W3, W6-W8 and the energy guns until the desktop agent's models land; W1 is the desktop's GLBs.
- Pilot on foot: proposed (`docs/proposal-pilot.md`), waiting for Keith.
- Expedition loop (radar, way home, fuel, loot at risk): approved (`docs/proposal-expedition.md`); an agent is building it in the convoy lab on a worktree branch.

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

### 2026-10-25 · Weapon model library, the old kit converted, code stand-ins, armoury lab (Claude)
- Keith: take the sister project's weapons over and improve their look; build the classes that don't exist (explosives first). The old kit's 22 FBXs (all real files now) converted to `public/models/weapons/` with sidecars in this repo's frame (`tools/weapons-import.ts`; `tools/fbx-to-glb.ts` now keeps `Paint_<section>` slots as one primitive each). TypeScript port of the kit (`src/weapons/kit/`) and stand-ins (`src/weapons/build/`) for the asset list's W2-W3, W6-W8, the energy guns and the missile and mortar shell, named and socketed to the asset-list contract so Blender models replace them by path. Library (GLB at the item's path, else a mirrored right, else the stand-in; desktop GLBs carry paint in their vertex colours, divided back out with the sidecar palette so schemes still swap), model instance, look, laser, Rampart mounts, demo cycle; new lab `labs/armoury/` (on the Rampart from the game camera, turntable, line-up; Weapon paint, Laser, Fit, Viewer topics; hold V).
- Tris: stand-ins mortar-heavy 5.5k, mortar-line 4.0k, rail-cannon-hull 4.7k, -2h 1.8k, autocannon 2.5k, cannon 2.4k, plasma 5.1k, laser projector 3.4k, missile 244, mortar shell 288; converted minigun L/M/H 10.6k/10.7k/14.5k, hand cannon 2.6k/2.4k/3.1k, missile pod 3.6k/5.6k/8.7k; the desktop's W1 (rocket launcher hull 4.1k, shoulder 3.6k, rocket 208) used as delivered (my RPG stand-ins dropped).
- The swap (coordinator, after merging main): `src/weapons/models.ts` now returns the library's model for every arsenal kind (`modelSwap.ts`: rail, light rail at 0.75, autocannon, RPG hull and shoulder, missile pod H tilted up 30°, heavy and line mortar), sided (the arsenal passes left or right), boxes only while a GLB loads; the arsenal's kicks heat the barrels, hide the loaded rocket, open the pod doors and recoil the rack tubes; its glow opacity drives the lamps; its targeting laser starts at the model's `Laser` emitter. Rockets, missiles and line-mortar shells fly as the library's models (`projectileDraw.ts`; the line mortar's long white slugs are gone). `mounts.ts` uses the Rampart's `mount()`.
- Checked: typecheck; `tools/armoury-check.ts` (new, in npm test: every stand-in and GLB builds, sockets and moving nodes exist, muzzles never point back, parts wound outward, mirrors flip, budgets); shots of every model on a turntable and on the Rampart from the game camera. `tools/weapons-check.ts` still passes; weapons lab shot with the line mortar firing.

### 2026-10-25 · Frame cost breakdown; dust out of view skipped (Claude, cloud)
- Keith: the convoy lab fell to 28 FPS far from the convoy while firing the miniguns into the sand. Every lab's HUD now splits the frame into sim, submit and gpu/wait (`src/core/app.ts`, `hud.ts`); the convoy lab adds a `cpu ms:` line per stage (convoy, escorts, trail, turrets, mech, convoy bodies, camera, ground, light, sand marks, dents, gun fx, dust) via `src/core/costs.ts`, and `Battlefield.costs` splits its update when a lab sets it. Likely cause found by reading: `src/fx/dustDraw.ts` sorted, shaded and sun-marched every live puff in the world each frame, including the convoy's nonstop escort and track dust far out of view; it now skips puffs outside the camera frustum plus `dustCullMargin` (new slider, Dust: look, 15 m) before that work. They still simulate.
- Checked: typecheck of the changed files only (npm registry unreachable from the cloud box); no shots or FPS measurement yet. Needs Keith's numbers from the new HUD lines.

### 2026-10-25 · Both mouse buttons at once; minigun rounds on small targets (Claude, cloud)
- Keith: couldn't hold left and right click together; the left minigun fired off to the left of small targets while the autocannon hit them. Mouse: `src/game/combatLab.ts` reads both buttons from `PointerEvent.buttons` on every pointer event (a browser sends pointerdown/up only for the first button down and the last up; a second button arrives as a pointermove), a press starts only over the canvas, a release counts anywhere. Minigun: `src/game/mechUnit.ts` sends each round from the real muzzle straight at the target (like the autocannon) instead of along the barrel's heading, which carried the outward arm's slower swing and the muzzle-to-shoulder gap; the arms still swing toward the led lock, the rounds go at the lock itself (`step(..., shotAt)`). Still gated by the fire cone. Keith wants the two miniguns' beating to stay organic (independent clocks, no forced detune).
- Checked: typecheck of the changed files only (npm registry unreachable from the cloud box, so no `npm test` or shots); needs a play on Keith's PC.

### 2026-10-25 · Assets: W1 rocket launchers, hull and shoulder, and the rocket (desktop agent, Keith's PC)
- From `docs/asset-list.md` (W1, P0): `public/models/weapons/rocket-launcher-hull.glb`, `rocket-launcher-shoulder.glb`, `rocket.glb` with sidecars, built by `tools/blender/weapons/rocket_launcher.py` (old repo's `wkit.py`, GLB straight from Blender). A fat single tube in the Rampart's khaki and olive: ribbed heat shield, flared back-blast vent behind a hinged `Lid`, sight box, `Laser` emitter, hazard-striped muzzle with the red warhead nose out of it and a red warning band. Wiring is for the cloud side. Checked: three.js GLTFLoader reads the node tree, sockets and vertex colours in the game frame (muzzle +Z, the hull tube outboard on -X); tris 4,064 / 3,622 / 208 within budget; shots on the Rampart from the 40 m and 12 m game cameras in `docs/asset-shots/W1/`.

### 2026-10-25 · Asset list for the Blender agent (Keith, Claude)
- Keith: spec an asset list here, prioritised, for an agent on his PC (it has Blender) to work through. `docs/asset-list.md`: how to take, build and tick an item; the contract (GLB, +Z front, sockets and moving-part names from the old kit, vertex colour, budgets, game-camera check shots); P0 explosives (RPG hull and shoulder, heavy mortar, line mortar, missile pod pass, debris), P1 hull guns, Rampart power pack and variants, convoy turrets, crawlers and bridges, POI wrecks and salvage, vehicles; P2 and P3 later.
### 2026-10-25 · Weapons step 2: Keith's controls, RPG rocket, missile pod, big and line mortars, targeting laser, queued craters (Claude)
- Keith: left click the left side, right click the right; shoulder weapons on keys 1-4; hull roster (minigun, cannon, rail, autocannon, plasma cannon, laser beam, RPG-like rocket launcher); a faint targeting laser on rocket launchers and miniguns, brighter at night; shoulder rockets, missile pods, a huge mortar and a line mortar, drones later; explosives first. `src/weapons/rocket.ts`, `swarm.ts`, arsenal rewritten round sides and shoulders, `models.ts` one function per weapon, per-side triggers (`upper.ts` `Trigger`), keys in `combatLab.ts`, shoulder slots in `src/items/`, `Battlefield.queueDent` (dents dug within `dentBudget` ms a frame, merged within `dentMerge`). Weapons lab picker by button and key, flags `?left= ?right= ?k1= ?k2= ?k3= ?hold=N:x,z ?lmb= ?rmb=`. `docs/proposal-weapons.md` rewritten round Keith's roster.
- Checked: `tools/weapons-check.ts` adds: an RPG lands on its point, goes off early on a body, steel and a dune; a swarm makes 8-12 blasts all within reach of the point, only on enemies in reach (scatter when none); the big mortar lands in its area over a dune; per-side triggers; shoulder fit rules and keys. All checks pass (robots' 2 ms/step perf bound only fails while headless shots load the shared box; it passes alone). Shots from the game camera: rocket and its laser, swarm climbing, big mortar paint and blast, line mortar, night laser. Dent cost (shared box, software GL, so high): one dent 1-26 ms (most 11-22 ms; fit plus chunk patch); a 10-missile swarm dug its 10 dents one a frame (worst frame 17 ms) instead of ~170 ms in one, but one dent alone can still exceed a frame here: measure on Keith's PC (the HUD's blast dents line).

### 2026-10-25 · Weapons step 1: line rocket salvo, painter, rail cannon, mortar, autocannon, weapons lab (Claude)
- Keith: only the hull miniguns felt right in the old game; weapons with their own targeting; a line rocket launcher with ground targeting that works; more than minigun sizes in the loadout. Proposal defaults taken: right button for back weapons (hold to paint, release to fire), cooldowns. `src/weapons/` (tuning, painter + painterDraw, salvo, rail, mortar, autocannon, arsenal + arsenalDraw, models, weaponSound, ribbon). Loadout: bases `rail-light`, `rail-medium`, `ac-medium`, `back-salvo`, `back-mortar` with rolled ranges; `GunStats.cls` (a rail side charges instead of spinning up; autocannon rounds are shells), `Resolved.back`. Hooks outside src/weapons kept small: `Battlefield.blast` (shell burst made public) + `onBlast`, optional `Hittable.knock`, `MechUnit.weapons/heavy/cursor/lock`, `RampartBody.mount/showPod`, `Sfx.addSound/playSound`, combat lab right button, arsenal, shake, Weapons topic. `labs/weapons/`: a flattened range with a dune across it (`src/game/firingRange.ts`), cutout lines and columns and steel posts (`dummies.ts` gains hand layouts, light cutouts that pierce, splash and get thrown), trucks on a loop (`src/game/rangeVehicles.ts`), a weapon picker, damage/s and last-shot readouts; hub link.
- Checked: `tools/weapons-check.ts` (in npm test: salvo impacts inside the strip, in order up it, no gap in the blasts, seeded scatter, snap onto a broadside line, cooldown; rail hits all four bodies on its line and none of three off it, in order with falling damage, throws a cutout, stops at a dune, fizzle and cooldown; mortar shells inside the ring, the arc clears a 9 m dune, lead; autocannon lead hits a crossing truck and no lead misses; fit rules and resolve for the new bases; a rail gun never fires rounds), all checks pass, typecheck; headless shots of the strip, rockets, impacts, rail charge and beam, mortar, autocannon from the game camera.

### 2026-10-25 · Dash in every lab (Keith, Claude)
- Keith: the combat labs' dash feels really good; put it in all the labs. Walker lab (`labs/walker/main.ts`): Space dashes the way WASD points (or the way the legs face), hold Space to boost with fuel, dash dots and boost bar on the HUD, Dash sliders under Legs. The combat labs (warband, bandits, robots, pois, loadout) already had it through `combatLab.ts`; the convoy lab gets it in the convoy agent's pass.
- Checked: typecheck, dash, upper and walker checks; in the walker lab in a headless browser, Space spends a charge with no errors.

### 2026-10-25 · Expedition loop proposed (Claude)
- Keith's core loop: radar (big on the convoy, small out of range), one arrow home to the return point, fuel and a return estimate, loot at risk until banked, recovery loses loot, 10-15 minute expeditions. Plan in `docs/proposal-expedition.md`.

### 2026-10-25 · Craters: blasts dent walkable ground (Claude)
- Keith: deformable ground from rockets, mortars and shells, walkable (unlike the Snowflow demo), with ground that resists (outposts, pads, the road). `src/world/craters.ts` (layer, hardness, fit, slump), `DuneField.dents` hook (`terrain.ts`), `TerrainStreamer.patchArea` (in-place vertex and water updates, `chunks.ts`), `Battlefield.dent` + `onGround`, shells and raider blow-ups dent, `DeathPhysics.groundChanged`, combat labs wire it with a "Craters" group under Dunes and `?craters=N`.
- Checked: `tools/crater-check.ts` (in npm test: determinism, continuity, walls after stacked blasts, protected zones exact, rock, slumping, count, cost), all checks pass; shots of the warband lab with `?craters=8` (desert, close, shallows, rocky). Costs (node in the shared cloud box, so rough): height() 0.55-0.87 µs plain vs 0.70-1.15 µs among 500 craters; fitting a crater 1-3 ms where its tiles exist, ~10 ms when it first reaches new 16 m tiles (hardness read on a 1 m grid); patching its chunk vertices ~7 ms for a 4-6 m blast (434 vertices) against ~50-125 ms to rebuild the 2-4 chunks it touches (31 ms each). To measure on Keith's PC: the HUD's deaths line shows last fit and patch ms.

### 2026-10-25 · Pilot on foot proposed; crane faster (in progress) (Claude)
- Keith: get out of the mech with F (field and convoy), walk the decks and footbridges; crane faster, drop-off from a height with a fall, quicker pick-up, convoy slightly slower. Plan for the pilot in `docs/proposal-pilot.md` (waiting for Keith). Crane, drop and convoy speed handed to an agent.
### 2026-10-25 · Convoy: quick crane, drop-off from height, slower convoy, rear mech bay, turrets, cut-cornered decks, shorter gaps, more escorts, dash (agent)
- Keith: speed the crane up (asking for it slower was a mistake), drop the mech from a little higher on launch, quicker pick-up, the convoy a touch slower. Crane slew 16 → 60°/s (accel 5 → 40), luff 6 → 30°/s (4 → 40), hoist 1.8 → 7 m/s (1.2 → 8), rope damping 0.12 → 0.5, swing strength 0.5 → 0.3; steadying is now a pull back under the tip (`craneSteady` 1.5 /s) damped to critical, so a long rope settles in about 2 s instead of creeping in overdamped; the empty hook is steadied while it reaches; the swing starts once the load is nearly up. Waits in range and on the pad 1 / 0.8 → 0.4 s. Launch: no lowering; the crane lets go with the feet 3 m up and the mech falls at the convoy's velocity, legs bracing wide (new state `falling`, Drop-off sliders: height, let-go swing, landing crouch, thud, shake; `onTouchdown` for the dust burst, prints, crater mark, bang and camera shake in the lab; `WalkerSim.thud()`; `fallReach` and a brace in `hangPose`). Convoy 4 → 3.3 m/s.
- Keith's follow-ups: a rear mech bay (the last housing car replaced by a 40×16 m tracked bay with its crane aft, layout mirrored, cab in front; `CraneCarry` takes every crane, the nearer one comes, `DeckGround.bay` switches); turrets (`defence.ts`, `defenceBody.ts`: 2 twin per car at the cut corners, a heavy one per bay cab, `target()` / `onFire` hooks unwired, Defences topic and hold-V); `trainGap` 12 → 9 m (bridges 11 m); cut-cornered octagon decks (`outline.ts`; deck ground, keep-on, push-out, rails, seams, chassis and edge pipes follow it); 12 escorts of five kinds (sides, two scouts ahead, two trailing, `escortSurge`). The dash in the convoy lab (Space while walking free on the sand or a deck; HUD dots, Dash group in Your mech). Flags `?drop`, `?threat`.
- Files: `src/convoy/crane.ts`, `carry.ts`, `hold.ts`, `deck.ts`, `platform.ts`, `outline.ts` (new), `defence.ts` (new), `defenceBody.ts` (new), `platformBody.ts`, `craneBody.ts`, `furniture.ts`, `pipes.ts`, `escort.ts`, `train.ts`, `route.ts`, `src/mech/walker.ts`, `labs/convoy/main.ts`, `tools/convoy-check.ts`.
- Checked: typecheck; `convoy-check` (pick-up 12.7 s and launch 10.4 s from the pad, under the new 15 s limit; falls 3.00 m in 0.79 s at the convoy's velocity, never through the sand, planted feet exactly on the sand after touchdown, crouch to 2.2 m and back, within 0.02 m/s after the follow, at 3.3, 4 and 6 m/s; rear bay: its own crane picks up in 13.1 s, sets down 0.04 m off the pad, launches; deck walk still never past the (now cut) edge, no feet off it; pipes off the outline 0, furniture inside it; 12 escorts 99% on station, closest to a platform 3.9 m, to the mech 3.7 m; turrets off the walkable deck, idle sweep within its slider, all in range on a threat within 2.2 s, the fire hook fires; narrowest gap 8.7 m at 9, the mech still walks through); walker, upper, dash checks. Shots: the drop mid-fall and the landing, the cut decks with turrets and the rear bay.

### 2026-10-25 · Free waist; fitting an arm fills its hand (Claude)
- Keith: the 120° waist limit makes kiting impossible (walking away, the torso has to go the long way round). `torsoLimit` 120 → 180: the torso turns freely the shortest way to the aim (`src/mech/upper.ts`); upper-check now also checks a target 170° behind on either side is turned to the short way and shot (1.2 s at 150°/s torso turn).
- Keith: swapping the minigun for an arm left an empty mount. The bay now puts the best hand weapon from stash or cargo into an arm's hand when you fit the arm, or selects the hand slot if there's none (`src/ui/bay.ts`). The only weapons are still the three minigun sizes; hand guns and arms still draw as the hull pod (the weapons plan brings rail cannon, rockets, mortar).
- Checked: upper, loadout checks; typecheck. Dust: steps and hits make dust in the walker and loadout labs here (WebGPU and WebGL shots); bare rock and water make none by design, so a biome picker set to rocky, shallows or mixed would explain missing dust.

### 2026-10-25 · Boost and slide, better downhill (Claude)
- Keith enjoys the dash's slide: a boost item to slide around on, better downhill than uphill. `src/mech/dash.ts`: after the shove the mech glides on (`dashCarry` 4 m/s against `slideFriction` 5 m/s²); gravity along the slope (`dashSlope` 1.5 × g) speeds a slide downhill and kills it uphill, capped at `slideMax`; with boost fuel (`boostFuel`, 0 by default) holding Space after the dash keeps thrusting toward `boostSpeed`, steered by WASD at `boostTurn`, fuel regenerating when not boosting. Damage cut only during the shove. New item: Booster pack (2.5 s of fuel) in `src/items/bases.ts`; resolve and the bay show boost fuel. Combat labs track Space held; HUD shows the fuel bar when there is fuel.
- Checked: `tools/dash-check.ts` (on a 14° plane: dash up 8.7 m vs down 21 m; 2 s boost up 34 m vs down 100 m; flat dash 9 m plus its glide), loadout, walker checks.

### 2026-10-25 · Research: the Snowflow demo (Claude)
- Keith's link (Noniv/snowflow_demo, MIT, Babylon.js + WGSL). Notes in `docs/research-snowflow.md`: a GPU deformation buffer following the player (toroidal ping-pong, brushes, depth plus berm channels, relax), a one-mesh clipmap terrain displaced in the vertex shader, swept-mesh wakes; what fits us (a GPU dent window replacing sand-mark decals; a CPU crater layer for gameplay; swept wakes for tracked and hover mechs), a distance-field shore pass for the water, and walker, tracked and hover drives as a slot.

### 2026-10-25 · Loadout step 1: items, rarity, Protocols, fit rules, cargo, the bay screen, loadout lab (Claude)
- Keith approved the loadout plan (lists while scaffolding, a grid later; a destroyed mech loses its cargo; five rarities, sockets 0-4; Protocols on items). `src/items/` (pure): `item`, `bases`, `rarity`, `protocols`, `loadout` (slots, fit rules, `resolve`), `generate` (seeded rolls), `cargo`. Hooks outside: `UpperSim` guns get `enabled` and `stats` (their own rate, spin-up, drum, arc, tracking; `src/mech/upper.ts`), `MechUnit` fires each gun with its own damage, spread, range and pierce and sounds only fitted guns, `MechBody.showParts` (`RampartBody` hides pods, drums, pack), `CombatLab.refresh`. `src/game/loadoutApply.ts` puts a resolved loadout on a unit. `src/ui/bay.ts` + `bay.css`: the bay screen (B). `labs/loadout/` with target dummies (`src/game/dummies.ts`, `dummiesDraw.ts`: steel posts, some sliding, damage/s on the HUD) and a hub link; sliders in Loadout (Loot rolls, Bare mech) and Targets topics; flags `?bay=slot`, `?hover=N`, `?fit=slot:base:rarity,...`, `?fresh`. Checked: `tools/loadout-check.ts` (fit rules, sockets, Protocol tags, stats adding up, seeded rolls, rarity widening both ways, cargo limit, losing cargo, looks, gun hooks, default = today's values) in `npm test`; all checks pass; typecheck; headless shots of the lab and the bay screen.

### 2026-10-25 · Weapons and targeting modes proposed; loadout step 1 started (Claude)
- Keith: add weapon options; only the hull miniguns felt right in the old game; a line rocket launcher that works, with ground targeting; each weapon its own targeting. Plan in `docs/proposal-weapons.md` (five targeting modes with previews, right button for back weapons, first: line rocket salvo, mortar, rail cannon, autocannon; a weapons range lab). Loadout step 1 handed to an agent (items, rarity, fit rules, cargo, bay screen, loadout lab).

### 2026-10-25 · Soft lock leads moving targets (Claude)
- Keith: the miniguns didn't seem to lead targets. Targets now carry their velocity (`TargetCandidate.vx/vz` from every combat lab) and the lock aims `lockLead` seconds ahead (0.12 s, about the guns' tracking lag: they trail their aim by ~1 / gun tracking); the demo leads too. Measured in the war band demo: rounds hitting vehicles 71% → 78%. Rounds are still instant hits along the barrel, so the lead covers the guns' lag, not flight time.

### 2026-10-25 · Loadout and items proposed (Claude)
- Keith: equip the walker from the convoy; legs, hull, arms or hull weapons, power pack and back mounts; rarity with Protocol sockets; enemy mechs wear real gear and leave hulks to pull parts from. Plan in `docs/proposal-loadout.md` (slots, items, lists not grids, a bay screen on the parked mech, a loadout lab first). Noted: the seven Rampart variants exist only on Keith's PC (not pushed). Waiting for Keith.

### 2026-10-25 · Biome picker on the lab hub (Claude)
- Keith: biome launch choice as a drop-down on the hub. `index.html`: a Biome select (Desert, Rocky, Shallows, Biome map) on the walker, war band, bandits, robots, POI and terrain labs, remembered per lab, sets `?biome=` on the link; the convoy lab has none (it doesn't take biomes yet). The URL's biome now wins over a saved slider in every lab (`combatLab.ts`, walker and terrain labs). Checked: headless hub test (links follow the picker, kept after reload), typecheck.

### 2026-10-25 · Water effects: ripples, wakes and splashes in the shallows (Claude)
- Keith asked for ripples that wave out from units moving through water. `src/fx/water.ts` (pure: ripple rings that spread and fade, splash drops that fall back and leave tiny rings, wakes dropping a ring every `wakeEvery` m so they overlap into a V), `src/fx/waterDraw.ts` (instanced soft rings on the water, drop sprites). `Battlefield.water` and `inWater(x, z)`: rounds into water splash instead of dust and craters, shells burst in a big splash; mech footfalls splash and ring instead of prints and dust, lift-offs drip, the body pushes a wake, dashes throw spray, no skid furrows underwater; vehicles' wheels throw wakes and spray, no ruts; bandits and robots wading leave rings (a sixth of each swarm checked per frame). Combat labs take `?biome=mix|rocky|shallows` (desert by default) with the Biomes topic; "Water effects" sliders under Hits and dust.
- Checked: `tools/water-check.ts` (rings and drops expire, wake spacing, pools wrap, the shallows are under water), warband, walker, dash, infantry, robots checks. Shots pending.

### 2026-10-25 · POIs step 1: placement, pads, salvage, tier 1-2 kinds, POI lab (agent)
- Keith approved `docs/proposal-pois.md` (hold E to salvage, scrap for now, camps from wreckage). Pure placement on cells (`src/world/pois.ts`), POI pads as a ground modifier stacked with the road (`src/world/poiPads.ts`, `src/world/modifiers.ts`), seeded builders for outcrop, wreck part, supply pod, debris field, dead convoy (`src/pois/`), salvage sim + drawing + HUD + overhead map, `labs/pois/` (showcase ring of the five kinds, generated POIs streamed within `drawRadius`, Kind picker, Map, Restock, demo walks to spots and strips them; hold-V picks a POI kind or the salvage markers; flags `?kind=`, `?strip`, `?view=map`). `combatLab.ts` gains `setup`, `demo`, `onChange` options and `streamer`, `demoOn` on the lab. Hub link.
- Checked: typecheck; `tools/poi-check.ts` (new, in `npm test`: placement the same in any order, 289 POIs in 8×8 km, closest pair 152 m at 140, pads within their cells, pad floors within 0.17 m and 1° (swell fit), edges at most 63°, salvage sums per section/site/stripping over 300 sites, reach/pause/noise, road + pads stacked match each alone); shots of each kind from the game camera, stripping, the map.

### 2026-10-25 · Biomes step 1: desert, rocky, shallows and the borders between them (Claude)
- Keith approved the biome plan (regions at least 5 km, rocky always walkable). `src/world/biomes.ts` (warped Voronoi regions, 5 km, borders blended over 300 m, weights exactly 1 inside a region), `rock.ts` (terraced shelves, ridges, lumps, sand in hollows), `shallows.ts` (floor under a still water level, sandbars, outcrops), blended in `DuneField.sample` pairwise: rock rises through flattening sand; land sinks into the shallows. Labs without biome sliders stay all desert. `chunks.ts`: rock and wet-sand colours, a water sheet over shallows (depth tint, foam, shimmer). `DuneField.surfaceAt` feeds the dust (rock and water: none; rocky sand: gravel). Terrain lab: Biomes topic, "Next border", `?biome=`, `?border`; walker lab `?biome=mix|rocky|shallows`.
- Checked: `tools/biome-check.ts` (weights, determinism, no step over 0.2 m in 0.1 m anywhere, rocky under 45°, shallows never past the knee, height() 0.85 vs 0.6 µs); terrain, walker, slope, convoy, car, warband checks. Shots pending.

### 2026-10-25 · Points of interest proposed (Claude)
- Keith: POIs at many levels of commitment (outcrops, debris fields, wrecks, abandoned battlefields, crashed ships, bandit camps, a bandit fortress in about 9 sections); desolate and unsettled, few old structures. Plan in `docs/proposal-pois.md` (5 tiers, value split into sections you can bank and leave, placement as a pure seeded function like the ground, a minimal salvage action first). Waiting for Keith.

### 2026-10-25 · Biome blending proposed (Claude)
- Keith: desert, rocky desolation and shallows with outcrops; first, blending one biome into the next. Plan in `docs/proposal-biomes.md` (a biome map inside the pure ground function, per-biome heights met pairwise rather than averaged, surfaces from the same weights, height-and-noise blended look; water and outcrops as steps 2 and 3). Waiting for Keith.

### 2026-10-24 · Convoy as a train: gaps, footbridges, crawler tracks, ruts and dust, pipes, vehicles aboard, escorts (agent)
- Keith's convoy direction. Platforms follow each other along the route as a train (`src/convoy/train.ts`: gap, one or two lines, footbridges; `platform.ts` rides each car on bogie points and spreads the cars in turns), footbridges (`bridgeBody.ts`: telescoping halves, lifted when out of reach; landing towers on the cars, the bay's in `deck.ts` blocks), Dune-style trapezoid crawler pods with scrolling treads on the bay and workshop (`tracks.ts`, `trackBody.ts`), ruts and dust behind every pod, wheel and escort (`trail.ts` on `DustSim.wheel` and `SandMarks.rut`), seeded pipe runs (`pipes.ts`, `pipesDraw.ts`, furniture as data in `furniture.ts`), vehicles tied down on a new motor pool car, escorts on the car sim (`escort.ts`, `escortBody.ts`). Crane drawing moved to `craneBody.ts`, the shared box kit to `kit.ts`. Lab: topics Tracks and trail, Pipes, Escorts; hold-V for tracks, pipes, footbridges, escorts and vehicles aboard; `?watch=N|gapN|eN` camera flag.
- Checked: typecheck; `convoy-check` (all earlier sections, plus: 5 min of hard turns in one line and two: middles on their paths, narrowest gap 11.7 m at 12, lowered bridges 90-145% of rest and down 90%+ of the time, lowest 5.7 m over the sand; a mech sprints across through a gap with no push-out; 3 min of escorts: 99% on station, never within 8 m of a platform or 3.9 m of the mech, none tipped; pipes the same every run, none inside furniture or off the platform; tread loops close, ruts 19/s and dust 78 puffs/s for the whole convoy); car and walker checks. Shots: far view of a gap with tracks, ruts and a footbridge; side view of the bay's crawlers; pipes on the housing car; two lines with the motor pool.
### 2026-10-24 · Seven Rampart variants; the mech kit and modelling agents in this repo (Claude, Keith's PC)
- Keith: spin up agents with the old project's mech-modeling skill to model variants of the current mech, using the
  old catalogue's turret, stilt, railgun and other parts and the old `art-refs/`. Seven `mech-modeler` agents ran in
  parallel, one variant each (see the Mech variants row); notes and renders per variant in `docs/mechs/<id>/`
  (renders stay local, out of git: Keith 2026-10-25, keep heavy binaries out of git).
- Ported from the old project: the Blender mech kit (`hskit`, `mil_kit`, `vkit`, `stock`, the Rampart v1/v2/v4 study,
  `export_game.py`, `shots.py`, `ref/`) to `tools/blender/`; the skill to `.claude/skills/mech-modeling/` (v0.8: this
  repo's pipeline, the game's part contract, headless in-game shots); a reusable `.claude/agents/mech-modeler.md`.
- New: `tools/blender/run.mjs` (at most two Blender runs at once; Keith's PC is short of memory; fails on Python
  errors), `export_game.py --model <file> --drop <parts>` and gun hooks, `?mech=<id>` in `rampart.ts`,
  `src/mech/variants.ts` (back kit position and paint per variant), LEG_TYPES for stilt and siege, `shots.mjs`
  serves `public/` files missing from `dist/`.
- Checked: baseline Rampart from this repo matches `rampart.glb`; `npm run build`, `npm test` pass; headless walker
  shots of the Rampart and every variant (close and side), all load and walk. Stilt misses 3.5% of landing spots on
  dunes with its own stride (0% on flat).
- Open: the agents' skill notes (`docs/mechs/*/skill-notes.md`) aren't folded into the skill yet; shared kit wishes
  (a paint dict in `rampart_v4`, `Surface.project` reach, `shots.py --model` by path, kit helpers like `mirror_part`).
- Seen on 2026-10-25: `deaths-check` failed once in three runs (a medium robot ragdoll part 0.85 m under the sand); not touched by this work, flaky.

### 2026-10-24 · Robots as terraforming machines: scrappers, medium cutters, big excavators (agent)
- Telegraphed attacks (Keith: skill against the swarms by dodging): big ones lob charges via `bf.lob` (new sliders: tell, charge speed, arc, blast radius, lead, scatter; volleys of 2), medium ones' slug has a 0.65 s tell with the aim fixed at its start, and the saw lunge goes where the mech was at the end of the wind-up; `RobotSwarm.tell` drives red lamps and rearing in the drawer, `onLob` hands charges to the lab. Merged main (dash, shells) first; robots-check now also checks lobs (on the mech, flight from distance, at least 1 s, no hitscan from big ones) and that a dash during either medium tell dodges it.
- Keith: small scrappers, a new medium size, and a few big four-legged excavators whose legs are excavator arms; all functional-looking. Small ones keep the starfish scuttle, leap and tearing, now with a cutting disc, jaws and a hopper. New medium cutters (crab legs stepping in diagonal pairs, saw, scrap bin; hold-and-shoot or walk in, a telegraphed saw lunge up close). Tripods replaced by excavators (four arm legs with boom, stick, bucket feet, rams and hoses; one leg at a time; 3.5% of the swarm). Walkers share planted-foot stepping (`stepWalker`, `legPose`), a CUT state, `onCut` callback; shot callback now passes the kind. New sliders: Robots: medium (28), Robots: big ones reworked. Medium ones take a share of splash; small only are pierced.
- Files: `src/combat/robots.ts`, `robotLegs.ts`, `robotShapes.ts` (new), `robotsDraw.ts`, `robotTarget.ts`, `src/physics/bodies.ts`, `labs/robots/main.ts`, `tools/robots-check.ts`, `tools/deaths-check.ts`.
- Checked: typecheck; robots-check (medium and big feet planted on the sand and in reach, stepping, no NaN, saw strikes, kills), deaths-check (all three ragdolls in one piece), audio and targeting checks; headless shots from the game camera, close and far.

### 2026-10-24 · Convoy: crane swing, walking the deck, parking bays, launch pads (agent)
- Keith's convoy report. Crane axes accelerate and brake (new sliders: Crane motion), slower by default (slew 30 → 16°/s); the cradle swings on the rope as a damped pendulum (Crane swing: rope damping, swing strength, steadying, body lean); set-downs wait over the spot for the swing to settle. Aboard, the mech walks the moving deck (deck as ground, carried with the platform, kept on by rails and furniture), parks in a bay with E (kneels), launches from a pad by the crane. New `src/convoy/deck.ts`, `hold.ts`; `WalkerSim.carry()` (moving-ground hook) and `solve()` in `src/mech/walker.ts`; deck markings in `platformBody.ts` (own mesh, hold-V "Deck" topic); demo walks the whole loop; flags `?park`, `?hang`.
- Checked: typecheck; `convoy-check` (pick-up lands within 0.5 m of the set-down pad standing, swing bounded and dying down, walking the deck 2 min while the convoy turns and speeds up: never past the edge, planted feet on the deck, no overreach, no sliding standing; park, ride parked, stand and walk; launch from each pad at 4 and 6 m/s matching velocity; stepping off cancels); walker, slope, upper checks; shots hanging mid-swing, walking on the deck, parked, launching.

### 2026-10-24 · Telegraphed shells: tank shells and bandit rockets you can dash out of (Claude)
- Keith: give the player skill against the swarms (efficient targeting, dodging), so some enemies need slower, telegraphed weapons. `src/game/shells.ts` (pure: lobbed shells that land on a marked spot after a flight time), `src/fx/shellsDraw.ts` (a pulsing ring on the sand the size of the blast, a disc filling in as it comes down, a glowing slug with a smoke trail; "Telegraphs" sliders under Hits and dust), `Battlefield.lob` and a burst (dust, crater, thud) that damages through each target's `splash` (the mech now has one: falls off to half at the edge). The tank now lobs shells at where your walk takes you (22 m/s, 4 m blast, 35 damage, lead 0.6); a share of bandits (6%) are rocketeers lobbing a slow rocket every ~6 s (18 damage, 2.8 m) instead of firing bursts ("Bandit rockets"). Dashes aren't predicted: a dash gets you out of the ring.
- Checked: typecheck; `tools/shells-check.ts` (lands on its mark on time, arc height, lands once), warband-check (the tank lobs), infantry-check.

### 2026-10-24 · Dash on Space (Claude)
- Keith: Space dodges or lunges the way WASD points, on charges. `src/mech/dash.ts` (pure: 2 charges, 3 s each, a front-loaded 9 m shove over 0.45 s, crouch and lean); `walker.ts` gains `push` (planted feet skid with the body, a swinging foot's target is carried), `crouch`, `leanPitch`, `leanRoll`; `MechUnit.tryDash` with a sand burst, skid spray and furrows, damage taken ×0.5 while dashing, `onDash` for the labs: bandits are knocked flying (`InfantrySwarm.shove`), clinging robots thrown off and small ones in the way bowled over. Combat labs: Space, HUD dots, the demo sidesteps every 7 s. "Dash" group under Your mech. Check: `tools/dash-check.ts` (distance on the dunes walking and standing, skidding feet on the sand, no NaN, charges).

### 2026-10-24 · Rounds pierce and splash; small arms read small; mech tougher (Claude)
- Keith's playtest: swarms too hard to hit, the mech doesn't feel powerful. `Battlefield.fire` now carries a round through light bodies (`canPierce`: bandits, small robots; `roundPierce` 2, 70% kept each) and splashes swarm units near where it ends (`splash` on the swarm targets; `roundSplash` 1.6 m at `roundSplashShare` 0.5, half at the edge), so a near miss into the sand at their feet still counts. New "Rounds" group under Your mech. Hull 1000 → 1500; robot bite 1.5 → 0.8, small shot 2 → 1.2, big shot 15 → 10.
- Small arms read small: `FireOptions.hitScale` scales sparks, dust and grit, and below 0.6 leaves no crater (bandits and small robots 0.3, technicals 0.4, gun trucks 0.75, enemy mechs 0.7, tank 1.6).
- **Aim bug fixed:** the player's rounds flew along the barrel, whose pitch also carried the hull's walking lean, from a muzzle below the shoulder the guns aim from: they went about 2 m low at 20 m, into the sand in front of what you aimed at. Rounds now keep the barrel's heading (the guns' lag) but pitch to arrive at the aim's height (`mechUnit.ts`). Measured in the bandits demo: misses from the target centre went from 1.5-2.8 m (all low) to 0.2-1.2 m (the spread); kills per round about 1 in 3, was about 1 in 16. Bandit health 30 → 12. Pierced bodies show a puff (bandits) or sparks (small robots).
- Checked: typecheck; walker, upper, infantry, warband, robots, deaths, targeting, convoy, bandit-vat checks; headless miss and kill counts in the bandits lab.

### 2026-10-24 · Bandits as Mixamo's Vanguard on an animation texture (agent)
- Keith approved the plan. Offline baker `tools/mixamo/` (FBXLoader in Node with the embedded PNG caught and decoded, meshoptimizer thinning 11.4k → 2.2k tris, a box rifle, clips retargeted by bone name with the hips scaled and the walk taken out, CPU skinning per frame) writes `public/models/bandit-vat.{json,bin}` (1409 vertices × 134 frames, half-float positions, RG8 normals, 1.9 MB). Runtime `src/combat/banditVat.ts` (TSL vertex shader, instanced geometry), `banditAnim.ts` (clip playback, pure), `infantryDraw.ts` (clip by state, `banditLook`/`banditAnimSpeed`/`banditFade`/`banditScale` sliders). Sim untouched; deaths still go to the ragdolls.
- Checked: typecheck, `tools/bandit-vat-check.ts` (new, in `npm test`), `infantry-check`; WebGPU close and low shots (feet on the sand, facing and aiming at the mech, running, tints), WebGL game-camera shot.

### 2026-10-24 · Robots merged; soft lock on their centre (Claude)
- Merged the robot reshape; the robots lab's `targets()` now uses `robotCentre` (the hub, or a tripod's high body), so the soft lock takes tripods by their body. Convoy deck lighter (no metal sheen), crane jib chunkier. Checked: typecheck, robots, deaths, audio, targeting, warband, convoy checks.

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

### 2026-10-24 · Convoy lab (agent, merged by Claude)
- Route with a flattened road left behind, six platforms in formation, crane pick-up and deploy (`src/convoy/*`, `labs/convoy/`, `DuneField.modifier` in `terrain.ts`, `rebuildArea` in `chunks.ts`). Check: `tools/convoy-check.ts` (road deterministic and smooth, platforms ride flat, pick-up, walk-away abort, deploy at 4 and 6 m/s). Rough: the crane reads oddly from the game camera, the rope is rigid, no walking on deck, escorts not built. Tank damage 60 → 35 a shell.

### 2026-10-24 · Soft lock, report fixes, war band trucks, less damage (Claude)
- Soft lock by ray in every combat lab (`src/game/targeting.ts`, `combatLab.ts`; labs give `targets()` with centre of mass and radius instead of `nearestEnemy`). Check: `tools/targeting-check.ts` (under the cursor wins, tall walker by its body, nearest the line, never behind/out of range/off the line, sticky).
- Reports: marks last 20 s, craters 0.35 m, rim faint, no sun relief in dune shade (`sandMarks.ts`); dust gets hill shadow from a CPU march toward the sun (`dustDraw.ts`, `sunReach` in `src/world/raycast.ts`); sparks on vehicle and mech hits ricochet off a real normal and are bigger (`battlefield.ts`, `mechUnit.ts`, `minigun.ts`). Damage down (bandits, technicals, gun trucks, bandit mechs).
- War band: sixWheeler, warRig, tank (vehicle sims and bodies by an agent: `car.ts` any number of axles, tracks; `carBody.ts` turrets) wired into bands with per-turret gunners, hulls, guns, clearance, wreck boxes, ruts off the rear wheels. `warband-check` and `car-check` pass with the full band.
- Checked: typecheck, all checks; WebGPU and WebGL shots of the walker lab (dust) and the war band. WebGPU now works headless here (swiftshader Vulkan).

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
