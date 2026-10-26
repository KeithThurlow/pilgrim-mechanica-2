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
12. **Stay ready for multiplayer** (Keith 2026-10-26: 4-player co-op later, one player hosting first; plan in
   `docs/multiplayer.md`). Nothing is networked yet, but code must keep these habits:
   - **Randomness:** seeded in anything that changes game state. `Math.random()` only in FX, sound and drawing.
   - **Commands:** sims take commands (move, aim, fire, dash, salvage, hop out) and never read input themselves.
   - **Events:** what happens (blasts, hits, deaths, pick-ups, banking) is plain-data events.
   - **Ids:** stable ids for anything peers must agree on.
   - **Ownership:** know who owns each piece of state: host (enemies, damage, loot, convoy, expedition), player (own
     movement and aim) or cosmetic (FX, ragdolls). Say so in the file header when it isn't obvious.
13. **Assume you can be cut off at any moment** (Keith 2026-10-26: agents hit usage limits mid-work and can't see them
   coming). Work so a cutoff loses little:
   - **Commit at every working step** on your branch, not only at the end. WIP commits are fine; say "WIP" in the
     message.
   - **Keep a handoff note current** as you go, in `docs/handoff-<topic>.md`: what's done, what's half done (files and
     functions), what's left in order, values chosen, known bugs, how to test. Commit it with the work and point to
     it from state.md's In progress. Delete it when the work merges.
   - **When resumed after a cutoff,** read your handoff note and `git log` first, then carry on.
   - **The coordinator** merges finished pieces promptly rather than holding them, and backs up agent branches when
     Keith allows it.

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
  (not saved), e.g. `?set=sunAzimuth:120,height:12`. `?norender` runs the ticks without drawing (headless CPU timing).
- Walker lab: `?cam=game|close|side|back|feet|head` (head: face to face with the hull), `?sensor=<sensor base id>|none` (the sensor on the hull; default the visor head), `?model=standin` (box walker), `?flat` (no dunes),
  `?walk=straight` (constant heading for filmstrips), `?sprint` (with `walk=straight`), `?fire` (hold the trigger),
  `?manual` (no demo), `?zoom=metres` (game camera distance), `?aimat=x,z` (hold the aim on a point; steel wrecks
  near the start at 22,-28 / 6,-26 / 15,-18), `?dt=0.033` (fixed time per frame, for headless shots and filmstrips),
  `?surface=gravel|dirt|concrete|snow` (dust and dents as if the ground were that), `?dash`, `?at=x,z`, `?warm=seconds` (run that much sim time before the
  first drawn frame, for slow headless filmstrips), `?drop=metres[,m/s]` (start in the air that high, as if a crane let
  go, optionally moving), `?bound` (the bound spike: hold Space; with `?walk=straight` the demo bounds).
- Terrain lab: `?shot` (marker parked), `?view=high` (overhead, no haze), `?seed=N`.
- Combat labs (warband, bandits, robots): `?manual` (no demo), `?zoom=metres`, `?dt=0.033`, `?flat`,
  `?biome=mix|rocky|shallows` (desert by default), `?craters=N` (N blasts dent the ground round the start, one under
  the mech). Walker lab takes `?biome=` too. Robots lab: `?left= ?right= ?k1-3=` (fit weapons as the weapons lab),
  `?robotline[=m]` (a frozen line of mixed robots ahead, no packs; m: start that far to the side, meeting the
  centre at `?lmb`'s distance, so a shot from an arm runs down it), `?lmb=x,z` and `?fireat=N` (hold the left button aimed
  there, let go after N frames).
- Loadout lab: `?bay=slot` (open the bay on a slot; rolls a few items into an empty stash), `?hover=N` (preview the Nth
  fitting item), `?fit=slot:base:rarity,...` (fit rolled items first; slots legs, hull, sensor, mountL/R, heldL/R, shoulderL/R,
  pack, waistL/R), `?choice=arm|hull` (what the bay offers a hull mount), `?fresh` (ignore the saved bay).
- Armoury lab: `?model=<id>`, `?view=rampart|turntable|lineup`, `?cam=game|close`, `?zoom=metres`, `?dt=0.033`, `?t=seconds`
  (start the firing cycle there), `?still` (no cycle), `?mech=<variant>`.
- Weapons lab: `?left=`/`?right=minigun|lightmg|rail|lightrail|autocannon|rpg`, `?k1=`/`?k2=none|rpg|missiles|mortar|linemortar`
  (a side given a shoulder weapon becomes an arm with a light gun), `?k3=pack|rpg|missiles|mortar|linemortar` (a back
  weapon in place of the pack), `?hold=N:x,z` (hold key N aimed there), `?lmb=x,z` / `?rmb=x,z` (hold a mouse button
  aimed there), `?aim=x,z`, `?fireat=N` (let go after N frames), `?lockcar` (guns on the first truck with the lock on
  it), `?start=x,z` (where the mech stands), plus the combat-lab flags.
- Combat controls (every combat lab): left click fires the left side's weapon, right click the right side's (both can
  be held); keys 1-3 hold to paint a shoulder weapon, release to fire; hold F to hop out of the mech, hold F by it to get
  back in (Keith 2026-10-26; F no longer fires).
- Pilot (every combat lab and the convoy lab): `?onfoot` (start on foot beside the mech), `?holdf=seconds` (F held
  from the start, for shots of getting out).
- Stress lab: `?run` (start the ramp once loaded), `?steps=25,50,100,150`, `?settle=s`, `?hold=s`, plus the combat-lab flags.
  Results go to the screen, the console and `window.__stress`.
- Convoy lab: `?manual`, `?aboard` (start on the deck), `?deploy` (start launching), `?park` (start parked), `?hang`
  (start hanging from the crane, about to lift), `?drop` (just after the crane lets go), `?threat` (a marker circling the train for the turrets), `?zoom`, `?dt`, `?flat`, `?watch=N` (camera on car N, 0 the lead;
  `gapN` the gap ahead of car N; `eN` escort N); E parks in a bay, G launches from anywhere. Expedition: `?out` (start out in
  the field, 280 m off, scrap at risk), `?far` (850 m out, mech radar), `?lowfuel[=seconds]` (little fuel left), `?loot=N`
  (N scrap at risk), `?nearcamp[=metres]` (just outside the nearest swarm camp, or that close); E strips salvage on the sand, hold Q recovers, Tab cycles the sensor's seeker,
  `?seek=scrap|wreck|rare|legendary`.
  Pilot: `?onfoot` starts on foot beside the mech parked in the lead bay (with `?out`, `?far`, `?nearcamp` or `?field`, on
  the sand beside it instead), `?pilotat=N,x,z` (on car N at local x, z) or `?pilotat=bN,t` (on footbridge N, t of the
  way across), `?bay` (bay screen open). On foot E at a bay terminal opens the bay screen; B anywhere.
  Weapons as in the combat labs (only while driving the mech); a fresh convoy bay fits miniguns, missile pod and big mortar,
  `?left= ?right= ?k1= ?k2= ?k3=` (as the weapons lab) fit those instead. `?bigclose[=metres]` (an excavator that close,
  cursor held on its bucket, both guns firing), `?raid` (a raid at once).

## Layout

```
state.md                live state of every system, work in progress, change history
reports/                Keith's in-lab reports and your replies (in git, so any agent can pick them up; delete one when fixed)
index.html              lab hub
labs/<name>/            one page per system (index.html + main.ts)
src/core/               app (renderer, loop), hud (frame time), tweaks (slider panel), input
src/world/              noise, terrain (the dune height function), chunks (streaming), look (light, haze), wrecks (steel stand-ins),
                        craters (blast dents in the ground: hardness, slump), walkable (the ground plus registered surfaces
                        with moving frames, for anyone on foot)
src/core/isoCamera.ts   the high isometric game camera
src/mech/               walker (leg sim), upper (torso and guns sim), walkerTuning, legTypes (leg archetypes), rampart (model rig), walkerBody (stand-in)
src/look/               toon (unit materials, optional cel bands, ink outlines)
src/audio/              synth (procedural sounds), sfx (player), minigunAudio
src/fx/                 dust (sim) + dustDraw, dents (GPU dent layer) + dentRule + groundMarks (every mark on the ground),
                        minigun (tracers, flash, hits, casings),
                        water (ripples, wakes, splashes) + waterDraw, shellsDraw (telegraph rings)
src/game/               battlefield (shared combat stage), sheet + sheetFire (direct fire as a vertical sheet with a penetration
                        budget), mechUnit (a mech with health), combatLab (combat lab shell), targeting (soft lock),
                        playerAim (mouse buttons, soft aim + reticle and brackets, camera shake, the arsenal; shared by the combat
                        labs and the convoy lab), loadoutApply (a loadout onto a mech), dummies + dummiesDraw (target dummies and cutouts),
                        firingRange (the weapons lab's ground and target spots), rangeVehicles (trucks on a loop)
src/convoy/             route (heading + flattened road), platform, crane (axes + rope swing), carry (pick-up, park,
                        launch), deck (deck as ground, riding, spots), hold (crane hang and park poses), train (line
                        layout, footbridges), tracks (crawler pods), trail (ruts, dust), pipes (seeded pipe runs),
                        furniture, escort (escort driving), walkways (decks, stairs, landings, footbridges as walkable
                        surfaces); drawing: platformBody, trackBody, pipesDraw, bridgeBody, craneBody, escortBody, kit
src/vehicles/           car (vehicle sim), carBody (stand-in raider vehicles)
src/combat/             warband (raider vehicles and bandit mechs), infantry (bandit swarm) + infantryDraw, infantryTarget,
                        banditVat + banditAnim (Vanguard on a baked vertex animation texture; baker in tools/mixamo/),
                        robots (scrappers, cutters, excavators) + robotLegs, robotShapes, robotsDraw, robotTarget, robotTearFx
src/items/              item, bases (the part and weapon table), rarity, protocols, loadout (slots, fit rules, resolve),
                        generate (seeded loot), cargo (cargo and stash lists), weaponPick (a quick pick per button and key)
src/ui/                 bay (the bay screen: fit parts, sockets, loot)
src/pilot/              the pilot on foot: pilot (capsule controller), mount (hold F out and in), quarry (the pilot as a
                        target, who enemies pick); glue: onFoot; drawing: pilotBody (Vanguard bake), pilotHud
src/expedition/         the loop: expedition (states, at-risk list, bank), fuel, returnPoint, radar, camps (swarm camps, unknown
                        areas), threats (roaming packs, raids, distant blasts); glue: loop, sites (POIs + salvage), swarmCamps (camps
                        and packs as the robot swarm); radarDraw, radarSound, threatMarks (edge-of-screen marks),
                        expeditionHud
src/weapons/            the new weapons, each with its own targeting: tuning (sliders), painter (strip, ring, laser) + painterDraw,
                        salvo (line rockets), rail, mortar, autocannon (pure sims), arsenal (a mech's weapons on the battlefield)
                        + arsenalDraw, models (each kind's model: the library's via modelSwap, boxes as the fallback),
                        projectileDraw, weaponSound, ribbon (ground-hugging marks).
                        Models: library (by id: GLB at public/models/weapons/<id>.glb, else a code stand-in), catalog, parts,
                        weaponModel, weaponLook + palette (paint sections, schemes, heat, lamps), laserSight, mounts (on the
                        Rampart), demo; kit/ (the old Blender weapon kit ported to TS), build/ (stand-ins)
src/physics/            deaths (Rapier world of the dead: ragdolls, wrecks), bodies (ragdoll layouts), deadDraw
public/models/          GLB models (provenance in docs/assets.md)
tools/                  *-check.ts headless checks, shots.mjs screenshots
docs/                   design.md (the game), decisions.md (log)
```

## Key conventions

- Units: metres, seconds; degrees in tuning, radians in code. Y up. Heading 0 faces +Z; +X is the mech's left.
- **The ground is a function.** `DuneField.height(x, z)` is pure and deterministic: chunks, feet, vehicles and AI all
  read the same function, so any chunk can be built in any order and nothing disagrees about where the ground is.
- Mech scale: the Rampart is about 4.4 m to the hood, hips at 3.05 m; walk 6 m/s, sprint (Shift) 8.5 m/s (Keith 2026-10-26; was the old project's 4 / 6.5).
- Camera: the game is played from a high isometric view (Keith 2026-10-24): 50° down at 40 m, zoom from 45° at 12 m
  out to 55° at 80 m.
  Judge looks and readability from that camera first; close views are for detail.
- Controls: twin-stick. WASD moves the legs (relative to the screen), the mouse aims the torso and guns, left click
  fires the left side's weapon and right click the right side's (Keith 2026-10-25), keys 1-4 the shoulder weapons.
  Hold F to hop out (the mech kneels; at the convoy, parked in a bay) and hold F within 3 m of it to get back in
  (Keith 2026-10-26); on foot WASD walks the pilot, Shift runs, E uses a bay terminal or strips salvage by hand.
- Models: parts that ride sim bones are baked to rest-pose world space and hung under pivots on their joints;
  read proportions from the model's joint markers rather than hardcoding them.
- Sound is procedural (`src/audio/synth.ts`, recipes from the old game's SfxSynth): no audio files. It starts on the
  first click or key press.
- Sims step at a fixed 120 Hz inside the frame (see the walker lab) so feel doesn't change with frame rate.

## State

Where every system stands, what's in progress, the next candidates and the change history: `state.md`. Read it
first; update it with every change (rule 10).
