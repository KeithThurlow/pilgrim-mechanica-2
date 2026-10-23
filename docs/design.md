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

## Mechs

- **Several mechs in the convoy**, chosen per trip: a light, fast one that can't fight much; a medium all-rounder;
  a heavy one that stays near the convoy but chews through swarms and salvages fast.
- Procedural walking (feet placed properly on the ground) for the player's mech; enemies and swarms can be cheaper.

## Convoy upgrades (ideas)

- Bigger radar range; automated salvagers; more mech bays.

## Carried over from Pilgrim Mechanica 1

- Salvaging parts from wrecks; the minigun and explosion feel; the procedural walker; the desert style.
- Not carried over: the maps and terrain (didn't work well), the Unity code.

## Open questions

- What's the out-of-range rule: a hard leash, a fuel or energy bar, or both?
- Does the convoy ever stop (camps, events), or always roll?
- Swarm scaling: by time out, by distance from the convoy, or both?
- Smarter enemies (bosses, guards on high-value salvage) alongside the data-oriented swarm: how many, how they're
  marked on the radar.
- Camera: top-down / isometric like Halls of Torment, or closer behind the mech? (Labs default to a 50-degree game
  view at about 34 m, close to the old game's 50 degrees at 40 m.)
- Who steers the convoy: no one for now (Keith 2026-10-24: get the gameplay loop right first; a story loop later).
