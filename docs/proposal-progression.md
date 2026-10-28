# Proposal: progression outside items, a passive tree for builds (not built; waiting for Keith)

Keith 2026-10-28: "How we allow players to get a sense of progression outside of items. I do think that having a
passive tree does kind of make sense, and having people lean into builds and searching for items of particular types
... more drone-like builds ... high manufacturing rate ... energy-like builds ... bullet hose builds ... armor and
tanky builds."

This builds on the old project's idea (`pilgrim-mechanica/docs/idea-scrap-passive-trees.md`, Keith 2026-10-04): a
passive tree drawn as a "Vitruvian mech" (the old idea paid it with scrap; Keith 2026-10-28: a separate currency instead, see the bottom).

## The tree

- **Paid with banked scrap:**
  - Scrap brought home is spent on nodes, so scrap is both money and experience.
  - Each node costs more the more nodes you own, so every run moves you along.
  - This is the long-term scrap sink that makes every banking moment matter.
- **Laid out as a mech, where you build tells you what you get:**

  | Region | Archetype | What it pushes |
  | --- | --- | --- |
  | Back and pack | **Drones / manufacturing** | manufacturing rate (drones and scrapper launchers built faster), drone count, drone toughness |
  | Core and pack | **Energy** | energy bars, refill speed, energy weapon damage, cheaper dashes |
  | Arms and guns | **Bullet hose** | fire rate, ammo and reload, spin-up, spread control, penetration |
  | Hull and plates | **Armour / tank** | hull, damage cut, stagger resistance, shove, landing absorb |
  | Legs | **Mobility** | sprint top speed, turn grip, dash distance, jump |
  | Head and sensors | **Scout** | radar range, seekers, loot rarity, salvage heat dampening |

- **Keystones** at the end of each region change how you play, at a cost. For example:
  - "Foundry": drones build twice as fast, guns −20%.
  - "Capacitor frame": two extra energy bars, hull −15%.
  - "Hose": fire rate +40%, spread +50%.
  - "Bulwark": shove knocks down, sprint top speed −20%.
- **Small nodes** are plain stat steps along paths between regions, so hybrid builds are possible.

## How it ties to items

- Items carry archetype tags: drone, energy, kinetic, armour, mobility, sensor. The tree's nodes boost tagged stats, so
  a drone build goes looking for drone-tagged items.
- The tree shapes and leans a build; items, Protocols and skills stay the main build axis. That's the old project's
  "construction blocks, not build-defining" rule.
- **Protocols as unlocks** (Claude's suggestion; Keith agreed 2026-10-28):
  - a found Protocol joins your library for good, its rarity setting its strength;
  - duplicates level it up;
  - item sockets limit how many you run;
  - swap them free at the convoy, never in the field.

## Screen and data

- `src/progression/tree.ts` (pure): nodes, links, costs, effects as stat changes into the same resolved values the
  loadout produces. `treeDraw` / `src/ui/tree.ts`: a mech outline with the nodes on it, at a walk-up terminal on the
  convoy.
- Saved with the bay. A headless check makes sure node effects add up, no unreachable nodes, and costs rise.

## Questions for Keith

1. **One tree for the mech, or a separate small one for the pilot?** The old idea had both. I'd do mech only first.
2. ~~Paid in scrap?~~ No: a separate progression currency earned by exploring (Keith 2026-10-28).
3. **Respec:** free, costly, or none? I'd say costly in scrap, so builds feel committed but fixable.
4. ~~Protocols as unlocks, or consumables?~~ Unlocks (Keith 2026-10-28).
5. **Drones and manufacturing** need the drone weapons first. Build the tree's drone region alongside a first drone
   bay?

## Change (Keith 2026-10-28): a separate progression currency, not scrap

- **Two currencies.** Scrap is money: items, the fabricator, convoy upgrades. The tree runs on a separate progression
  currency, so players never choose between getting stronger and buying things.
- **Earned by exploring:** venturing further and finding new areas. Default sources:
  - first visits to new ground (the convoy radar's unknown areas, new cells);
  - the deepest point reached in a run, by ring;
  - finding points of interest;
  - some from big kills.
- **Name** (open; Keith isn't sure "experience" is right). Candidates:
  - **Survey** (survey points from mapping the wastes; fits the convoy and radar);
  - **Intel**;
  - **Data**;
  - **Salvage logs**.

  Default: Survey.
- **The convoy grows with scrap** (`docs/proposal-economy.md`): it starts with fewer capabilities, and scrap unlocks
  them, including extraction pickups and, later, heli drop-offs further out at harder spots.

## Starting frames (Keith 2026-10-28, after Anthem's javelins)

You pick a starting frame, which is really just your first set of parts. Every part stays interchangeable afterwards.
Each frame leans toward a tree region and a play style, and its legs set its own dodge. That matches the old project's
"each weight class has its own dodge" idea.

| Frame (working name) | Like Anthem's | Parts | Dodge | Play |
| --- | --- | --- | --- | --- |
| **Light: Skimmer** | Interceptor | Stilt-type legs, light hull, short arms | three quick dashes (more, smaller energy bars) | fast hit and run, low hull; melee later if it comes back |
| **Medium: Rampart** | Ranger | today's Rampart | the dash as built | balanced: miniguns, missile pod, the all-rounder |
| **Medium energy: Tempest** | Storm | a hover or thruster drive, a capacitor hull | short hover-dash, glides over ground | glass-cannon "magic": energy weapons (plasma, lasers, arcs), big area strikes, lives on energy |
| **Heavy: Bastion** | Colossus | Siege-type legs, heavy hull | none: Space raises a deployable shield or hydraulic brace | tank: most hull, heavy weapons (mortars, autocannon, flamer later), shove and crowd control |

A summoner build isn't a starting frame. Manufacturing hulls (high build rate, drone bays) are found as parts, so any
frame can become one.

### Questions for Keith

1. **The four starting frames:** these four? Or three at first: light, medium and heavy, with the energy frame
   unlocked later?
2. **Names:** keep ours (Skimmer, Rampart, Tempest, Bastion are placeholders), and avoid Anthem's.
3. **The heavy's dodge:** does it really give up the dash for a shield or brace, as in Anthem?
4. **The energy frame's hover drive:** is it a new leg type (hover) for this frame, or thrusters on normal legs?
