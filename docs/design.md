# Design: the game

Keith's pitch, 2026-10-24, written up by Claude. Direction, not final: correct anything that's off.

## The loop

- **Your base is a moving village**: a low, salvaged convoy of tracked and big-wheeled vehicles (Mad Max, Path of
  Exile 2 Act 2), not a towering walking city. It rolls slowly and never stops, across rolling dunes.
- **You go out to salvage** wrecks, scrap and parts, then **get back before the convoy is out of range**. The clock
  is the convoy's distance, probably with a fuel or energy limit on how long a mech can stay out.
- **Swarms close in over time** while you're out (Vampire Survivors, Halls of Torment): the longer and further you
  stay, the harder it gets.
- **Progression is range.** First trips are short and slow. Better mechs (faster, stronger guns, jump packs over
  obstacles) and convoy upgrades let you reach further and bring back more.
- **No load screens.** Leaving and returning to the convoy is seamless; the world keeps moving past.
- **A radar in the village** shows salvage relative to the convoy. When something comes up, you decide whether to go.

## Camera and controls

- **High isometric view** (Keith 2026-10-24: the game was designed for it): 50 degrees down at about 40 m, zoom in
  to about 45 degrees at 12 m, and out much further, to about 80 m where the mech is half the size.
- **Twin-stick:** WASD moves, the mouse aims the torso and guns, separately (Keith 2026-10-24).

## Mechs

- **Starting mech: the Rampart** (the old project's v4 study), with hull-mounted miniguns on both sides and a
  backpack: ammo drums under a power pack (Keith 2026-10-24).
- **Look:** trying plain lit materials on the mech rather than cel shading, under a harsh bright sun (Keith 2026-10-24).

- **Several mechs in the convoy**, chosen per trip: a light, fast one that can't fight much; a medium all-rounder;
  a heavy one that stays near the convoy but chews through swarms and salvages fast.
- Procedural walking (feet placed properly on the ground) for the player's mech; enemies and swarms can be cheaper.

## The convoy (Keith 2026-10-24)

- **Platforms of varying sizes**, linked into one mechanical convoy. The **largest ride on rolling tracks**; that's
  where the mechs are stored and where the mech gantries are.
- **Gantries smaller than the old game's**: similar look, scaled down, because space is at a premium on a convoy.
- **A crane picks the mech up.** Walk alongside the convoy and a crane swings out, lifts the mech and sets it on
  board; it's also how you get off. No load screens either way.
- **On board, the mech can be piloted around one large mech platform** (the loading bay). To reach the other parts of
  the convoy you hop out and walk around as the human pilot.

## Ammunition (Keith 2026-10-24)

- **You head out with a limited amount of ammunition**, so a trip runs against two clocks: the convoy rolling away and
  your rounds running out. Each gun's drum counts down (in the walker lab today: 1200 rounds a gun).
- **Munition depots** (or caches, wrecks with ammo) out in the world are worth a detour on the way out: resupply
  first, then go for the salvage.

## Salvage (open)

- Keith 2026-10-24, undecided: does the pilot hop out of the mech to salvage on foot, or can the mech salvage? (The
  old game did both: on foot looted more but slower, the mech fast and loud for less.)

## Time of day (Keith 2026-10-24)

- **A full day-night cycle**, and it changes what a salvage run is like: what's out there, how dangerous, what you
  can see. Today the labs use one fixed harsh midday sun.

## Convoy upgrades (ideas)

- Bigger radar range; automated salvagers; more mech bays.

## Carried over from Pilgrim Mechanica 1

- Salvaging parts from wrecks; the minigun and explosion feel; the procedural walker; the desert style.
- Not carried over: the maps and terrain (didn't work well), the Unity code.

## Robots: the roster (Keith 2026-11-01)

Sci-fi machines, not construction plant: white plate, mostly cylindrical, squarish dark mechanics, pipes and cables
dangling (a procedural sway, no physics). Red lights mean seeking, blue means a weapon, and the big ones' blue weapons
terraform the ground. Refs are on Keith's PC: `pilgrim-mechanica/art-refs/robot-reference/`. Smallest to largest, room
to add more:

| # | Type | What it is | Rig and look | Weapons | State |
| --- | --- | --- | --- | --- | --- |
| 1 | **Crabs** (scuttlers) | The swarm: tiny, low, many. Leap on and latch. | Code geometry: a mite with a cylindrical abdomen, a small head, four thin legs (`robotShapes.ts`) | Bites; a share shoot | Built (the small robots) |
| 2 | **Small quads** | A size up from the crabs and taller: a white body high on four armoured legs, a blue visor, an antenna ("small quad.png") | Code geometry on the walker legs | Light guns or a cutter | Next |
| 3 | **Weapon quads** | Larger again, almost mech-like: a cylindrical turret body on four legs with weapons on its sides ("medium quad bots with weapons.png"). They drop their weapons as loot | Code geometry; the player's weapon models and effects reused | Miniguns, rocket launchers, lasers, rail guns | Next |
| 4 | **Mech quads** (striders) | Really large, wiry and mech-like | The mech rig (WalkerSim) scaled up | Big guns | In its own thread |
| 5 | **Humanoids** | A few variants, the middle ground among the walkers | The human rig (the Vanguard bake) | Varied | In its own thread |
| 6 | **Terraforming walkers** | The towers: thorax and abdomen 15 m up on four long legs (Keith's tall beam-walker ref) | Code geometry (`robotShapes.ts`) | Lobbed charges, a blue line beam that digs a trench, a blue pulse straight down that craters the ground and shoves you away | Built (the big robots) |

The medium cutters (crab-like walkers with a blue cutter disc) sit between 1 and 2 today; they fold into the small
quads or the weapon quads when those are built.

## Open questions

- Salvage on foot, by mech, or both (see Salvage)?
- What's the out-of-range rule: a hard leash, a fuel or energy bar, or both?
- Does the convoy ever stop (camps, events), or always roll?
- Swarm scaling: by time out, by distance from the convoy, or both?
- Smarter enemies (bosses, guards on high-value salvage) alongside the data-oriented swarm: how many, how they're
  marked on the radar.
- Who steers the convoy: no one for now (Keith 2026-10-24: get the gameplay loop right first; a story loop later).
