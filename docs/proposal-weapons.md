# Weapons: the roster, the controls and how each one targets

Status: step 1 built (rail cannon, autocannon, line strip, big mortar, painter, weapons lab); step 2 built
(controls, RPG rocket, missile pod, both mortars, targeting laser, queued craters). Hand guns, cannon, plasma, laser
beam and drones are roster only.

## What Keith asked for

2026-10-25 (first pass):
- Only the hull miniguns looked, felt and performed right in the sister project ("they felt powerful, they felt good").
- A rocket launcher that fires a line of rockets, with ground targeting, that works ("it just straight up didn't
  really work" there).
- Each weapon its own targeting: some AoE, ground targeting and prediction; some auto-target and lead, like the
  miniguns.
- Back rockets and mortars paint the ground like a military targeting laser; mortars go over hills.

2026-10-25 18:22 (Keith's roster and controls, replacing "right button = back weapon"):

**Controls**
- Left click fires the left arm's or left hull weapon; right click fires the right side's.
- Shoulder weapons go on number keys 1-4. Claude's default: hold the key to paint (strip or ring), release to fire.
- Space stays the dash, E salvage.

**Hull weapons** (fitted in place of an arm): minigun; cannon; rail gun; autocannon (between cannon and minigun);
plasma cannon (a plasma blast; was "laser"); laser beam (continuous, minigun-like but a long beam); rocket launcher,
RPG-like: a straight line from the mech to the ground point under the cursor, a big explosion, goes off early if it
hits something on the way.

**Targeting laser:** a very faint line on rocket launchers and miniguns that glistens a little; brighter at night,
quite faint by day.

**Shoulder weapons** (keys 1-4): rockets (the same RPG rocket); missile pods (up over the shoulder, then 8-12 missiles
swarm down onto enemies, a series of explosions); mortars in two forms: one huge mortar, and a line mortar that blasts
a row; drones (summoning, later).

**Arms and hand guns** (later): arms may give faster salvage; hand guns: SMG, AR, a two-handed minigun about on par
with the hull one, a two-handed rail cannon. Hand guns are weaker but give more utility.

**Archetypes** (ideas, open): summoning (shoulder drones that orbit and attack, mini scavenger-robot launchers, maybe a
backpack, maybe a torso manufacturing speed that sets the drone rate); energy weapons; legs with abilities later.

**Step 2 order:** explosives first, to drive the ground deformation work.

## Why the old ones didn't work (Claude's read of the sister project)

- One input for everything, no preview: a line rocket went where the cursor was, nothing showed where it would land.
- Projectiles with no help against small fast targets on a high camera.
- Weak feedback: small blasts, no shake, no ground mark.

The miniguns worked because they assist (soft lock), never stop, show every round and hit hard.

## Targeting modes (each weapon has one, with its own preview)

| Mode | Input | Preview | Help | Weapons |
| --- | --- | --- | --- | --- |
| **Assist** | hold the side's button | lock brackets, the faint targeting laser | soft lock, lead by velocity | minigun, autocannon |
| **Ground shot** | the side's button (hull) or hold the key (shoulder) | faint laser to the ground under the cursor; on a key, a ring the blast's size | none: straight at the point, early on anything in the way | RPG rocket |
| **Line** | hold the key: a laser from the launcher and a strip on the sand; release | the strip, then a running light up it; the strip stays dim while the shells fall | the strip snaps onto a line of targets near it | line mortar |
| **Point** | hold the key: a ring and a dotted arc over the hills; release | ring the blast's size, dotted lob | the ring leads a locked target's walk | big mortar |
| **Swarm** | hold the key: a ring of the swarm's reach; release | the ring | missiles share out the enemies in reach and follow them down | missile pod |
| **Skill shot** | hold to charge, release | a thin beam thickening | none | rail cannon |
| **Auto** (later) | none | a faint arc of reach | nearest in arc | turrets, drones |

## Slots and keys (what's built)

| Slot | Takes | Fired with |
| --- | --- | --- |
| Left / right arm mount | an arm, or a Medium hull weapon (minigun, rail cannon, autocannon, rocket launcher) | left / right click |
| Left / right hand | a Light weapon (Light rail cannon, Light minigun) with an arm; a Heavy two-hander takes both | left / right click |
| Left / right shoulder (hull mounts; the Salvager hull has one) | a shoulder weapon | keys 1 / 2 |
| Back mount (under the power pack) | ammo drums, or a shoulder weapon | key 3 |
| Key 4 | kept for drones | |

Cooldowns, not ammo, for the heavy weapons for now (Keith 2026-10-25).

## Shared pieces (built once)

- **The blast** (`Battlefield.blast`): dust, debris, sound, splash damage, camera shake by size and distance; its
  crater is queued and dug within a per-frame time budget (merging close ones), because a dent costs about 10-17 ms
  of CPU and a 12-missile swarm must not stall a frame. The GPU dent layer (another agent) hangs off the same call.
- **The painter**: the laser plus a strip or ring on the sand, red-orange and pulsing, grey while cooling.
- **The targeting laser**: faint, glinting, strength from the sun's height (sliders for day and night).
- **Projectiles**: straight rockets (`rocket.ts`), curved rockets and shells (`salvo.ts`, `swarm.ts`), lobbed shells
  (`src/game/shells.ts`), flying autocannon shells (`autocannon.ts`).
- Stand-in models, one function per weapon (`models.ts`), until the modelled ones (`library.ts`, another agent).

## Next

- The rest of the hull roster: cannon, plasma cannon, laser beam.
- Hand guns (SMG, AR, two-handed minigun, two-handed rail cannon) with utility; arms with faster salvage.
- Enemy versions with the same telegraphs (the strip painted toward you), so the war band can field them.
- Drones on key 4 (summoning archetype).
