# Decisions

Newest first. Raised by / decided by: Keith or Claude. Only Keith's calls are marked as his.

| Date | Decision | Raised | Decided | Notes |
| --- | --- | --- | --- | --- |
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
