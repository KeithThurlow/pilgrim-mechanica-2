# Decisions

Newest first. Raised by / decided by: Keith or Claude. Only Keith's calls are marked as his.

| Date | Decision | Raised | Decided | Notes |
| --- | --- | --- | --- | --- |
| 2026-10-24 | In-lab reports (`reports/`) are committed to git so any agent can read and answer them | Keith | Keith | Only Keith reports; revisit if other people start sending reports. Reports are cleaned up as they're fixed: delete the report's `.md` and `.png` and its line in `inbox.md` in the commit that fixes it. |
| 2026-10-24 | Convoy pick-up is automatic: a crane animation, and the mech is picked up as long as it stays in range until the crane connects | Keith | Keith | `docs/proposal-convoy.md` |
| 2026-10-24 | The convoy's direction is a slider for now; the flattened route stays behind as a road back to the convoy | Keith | Keith | |
| 2026-10-24 | Death physics with Rapier: ragdolls for bandits and robots, rigid-body wrecks for vehicles, in a world that holds only the dead | Claude | Keith | Living units stay on their own sims; cap on moving bodies. |
| 2026-10-24 | Robot swarm: small quadrupeds leap on and cling (biting) until shot, stomped or shaken off; big ones hold off and fire heavy bursts | Keith | Keith | Clinging and shaking off are Claude's take on "swarm the mech" (values are sliders). |
| 2026-10-24 | In the combat labs the mech takes damage; no salvage drops yet (fun first, Keith has ideas for salvage) | Keith | Keith | |
| 2026-10-24 | Bandit mechs are red Ramparts for now | Keith | Keith | |
| 2026-10-24 | A convoy crane lab: cranes on 6-7 big platforms pick the mech up and drop it off beside the moving convoy | Keith | Keith | In `docs/proposal-combat-labs.md`; the convoy may flatten the sand ahead (long term). |
| 2026-10-24 | Deaths should have physics: vehicles overturn, people and robots ragdoll | Keith | Keith | Wrecks tumble on a simple throw now; ragdolls with Rapier next (Claude). |
| 2026-10-24 | War band lab first, then bandits on foot (built the same day), then robots, escort, cranes | Claude | Keith | Keith: go ahead, use several agents. |
| 2026-10-24 | Sell the impact: hits and steps press marks into the sand, hits throw a visible spray, cheaply | Keith | Keith | Lit decals with a fake height field, not mesh deformation; spray streaks (Claude). |
| 2026-10-24 | Combat labs to explore: convoy escort vehicles, raider war bands (incl. bandit mechs), bandits on foot, quadruped robot swarms; power plus threat | Keith | open | Proposal in `docs/proposal-combat-labs.md`; order and details for Keith. |
| 2026-10-24 | Dust receives shadows from other things (not from itself) | Keith | Keith | Shadow-map lookups per dust pixel, four taps (Claude). |
| 2026-10-24 | Dust leaves in the direction of what made it, then the wind takes over; minigun hits throw plumes | Keith | Keith | Refs `plume.png`, `plume2.png`. |
| 2026-10-24 | How much dust comes off depends on the surface: sand most, gravel little, dirt clods, concrete none | Keith | Keith | Multipliers are sliders (Claude's values); terrain has only sand so far. |
| 2026-10-24 | Dunes should look like the reference video: simple soft shapes, no shading triangles | Keith | Keith | Rounded crests, per-pixel sand detail, softer shadows (Claude). |
| 2026-10-24 | While moving, the mech leans over its feet: centre of gravity forward over the feet, not behind them (downhill too) | Keith | Keith | Feet land nearer the hips and a 4° lean with speed (Claude's values). |
| 2026-10-24 | Dust is built and tuned in the walker lab, no separate dust lab | Keith | Keith | Target: Keith's reference video `art-refs/particles/m2-res_1080p.mp4` in the old repo. |
| 2026-10-24 | On slopes a squashed leg uses its thigh at the hip; slow uphill; downhill full speed with the feet planted under the mech | Keith | Keith | Fold forward plus knee turned out, values Claude's (sliders under Terrain). |
| 2026-10-24 | Minigun hits by surface, like the old game: sand torn up low along the ground plus dust kicked up; sparks off metal | Keith | Keith | Opaque dust balls (the old HitDust streamers); steel wreck stand-ins to test (Claude). |
| 2026-10-24 | Taller, closer dunes (14 m high, 44 m apart) with the terrain and walker checks loosened to allow them | Keith | Keith | Crests reach about 69°; dune runs allow 15% reach misses and skip the straight-knee rule, flat ground keeps the strict limits (Claude's split). |
| 2026-10-24 | Hold V to select things in the scene; a click opens only that thing's options; the panel opens on topics, not every slider | Keith | Keith | Ground opens the dunes, sky the light (Claude's defaults). Applies to every lab. |
| 2026-10-24 | Feet get a toe joint: roll over the ball at push-off with the toes flat, curl the toes through the swing | Keith | Keith | One hinge per foot (Claude's default); Rampart hinge where its toes begin. |
| 2026-10-24 | Legs come as archetypes (presets of walker tuning), ready for the old game's other leg types | Keith | Keith | `src/mech/legTypes.ts`. |
| 2026-10-24 | A Report box in every lab that reaches the Claude Code session on Keith's PC (`reports/inbox.md`, replies in `reports/replies.md`) | Keith | Keith | Like his web modelling app's in-app agent link. |
| 2026-10-24 | Limited ammunition per trip; munition depots worth a detour | Keith | Keith | Per-gun drums in the walker lab (1200 rounds, Claude's default). |
| 2026-10-24 | Each gun is its own gun and sound; arms swing inward faster than outward instead of one arm faster | Keith | Keith | Outward at 0.55 of the tracking speed (Claude's default); small spin and rate splits kept as sliders. |
| 2026-10-24 | No outline on the mech; lighting should read like a tank in the desert sun | Keith | Keith | Sky environment + Neutral tone mapping, picked by A/B (Claude). |
| 2026-10-24 | Push off from the toes sooner; the thigh shouldn't swing so far back | Keith | Keith | Heel lift 48° from 60% of the stance, feet planted further forward (values Claude's, after the old lab's 52°). |
| 2026-10-24 | Dunes cast shadows | Keith | Keith | |
| 2026-10-24 | Convoy: platforms of different sizes, the largest on tracks with the mech bays and smaller-than-before gantries; a crane picks the mech up from alongside; on board the mech drives one big platform, the pilot walks the rest | Keith | Keith | `docs/design.md`. Not built yet. |
| 2026-10-24 | A full day-night cycle that changes salvage outcomes | Keith | Keith | Not built; labs use a fixed midday sun. |
| 2026-10-24 | Try the mech without cel shading, under a harsher bright sun | Keith | Keith | Cel shading is a toggle (off); the ink outline stays as its own slider (Claude's default, 1.2 px). |
| 2026-10-24 | The game camera can zoom out to about 80 m, the mech about half its game-view size | Keith | Keith | 55° at 80 m (pitch is Claude's default). |
| 2026-10-24 | Minigun sound ported from the old game, one growl voice per gun | Keith | Keith | Per-gun detune and loop offsets keep the two growls beating against each other (Claude). |
| 2026-10-24 | Walking stance narrower than standing; cannon angle moves through the stride | Keith | Keith | Keith: the cannon looked locked and the gait too wide. Values from the old lab. |
| 2026-10-24 | The Rampart (old v4 mech study) is the starting mech, with hull miniguns on both sides and a backpack | Keith | Keith | Right minigun pod mirrored onto the left in place of the rocket box; half drums per gun under a power pack (the pack is a box stand-in, Claude's default until a modelled one). |
| 2026-10-24 | Twin-stick: WASD moves the legs, the mouse aims the torso and guns, left button fires | Keith | Keith | Click-to-walk dropped. Torso limit 120° from the legs, gun arc 30° (from the old game's fire arcs). |
| 2026-10-24 | The game is played from a high isometric view | Keith | Keith | Default 50° at 40 m (the old game's decision), zoom to 45° at 12 m; fixed facing. |
| 2026-10-24 | Cel shading with warm dark ink outlines on units and mechs; environment without outlines (superseded the same day: cel off, ink kept) | Claude | open | Carries the old project's art direction (Keith 2026-10-10, 2026-10-14). |
| 2026-10-24 | `state.md` records every change and the live state of each system, updated in the same commit | Keith | Keith | Makes working across agents easier; rule 10 in `CLAUDE.md`. |
| 2026-10-24 | Old walker code is a guideline, not something to port line by line | Keith | Keith | The new walker is a fresh, smaller sim (`src/mech/walker.ts`); starting tuning values come from the old lab's build 65 Mechanical walk, scaled to metres. |
| 2026-10-24 | Feet must place properly on the ground for the player's mech; enemies and swarms can be cheaper | Keith | Keith | The ground is a pure height function so feet query it exactly. |
| 2026-10-24 | The convoy isn't steered by the player for now; it travels over procedural land | Keith | Keith | Gameplay loop first, story loop later. |
| 2026-10-24 | Build in the web; iteration time matters more than performance at this stage | Keith | Keith | After Unity's test loops and build times slowed small changes down. |
| 2026-10-24 | Three.js r186 (WebGPU renderer with WebGL 2 fallback) + TypeScript + Vite, no engine | Claude | Keith | Godot's web export lacks WebGPU and C#; Unity was the slow loop being left. |
| 2026-10-24 | Ground rules: lab per system, every feel value a slider, frame time in every lab, rewrite over workaround | Claude | Keith | In `CLAUDE.md`. Keith: half the Unity slowdown was not setting rules early enough. |
| 2026-10-24 | Restart as Pilgrim Mechanica 2: a moving convoy village, salvage runs against the convoy's range, swarms | Keith | Keith | `docs/design.md`. |
| 2026-10-24 | Terrain: transverse dunes with a crossing set, streamed chunks, vertex colours | Claude | open | Tune in the terrain lab. |
