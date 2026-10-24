# Proposal: points of interest, by how much they ask of you (approved by Keith 2026-10-25; step 1 built)

Keith 2026-10-25: many levels of points of interest (POIs).
- Small ones: rock outcrops, debris fields with something in them, crashes, wrecks, abandoned battlefields.
- Bigger ones: crashed ships, bandit camps and bandit fortresses.
- Each one asks for a different commitment to get its value out. Small ones are quick. A fortress might be nine
  sections to fight through, and you may leave early to make it back to the convoy.
- The world leans desolate and unsettled, unlike the sister project: few old structures. People survive on moving
  vehicles; bandits build from wreckage.

## From the sister project (ideas, not code)

- **POI table per biome** (`docs/proposal-roads-and-pois.md`). It placed compounds, camps (open, roadside, hidden,
  hilltop), lone caches and mech wrecks with a salvage cache (40% carried one).
- **Crashed ships** (`docs/proposal-ship-salvage-settlements.md`, `ship-crashes-*`): pods, landers and hull sections,
  sunk, torn or walk-in. They carry ship-grade parts and power cores, are slow to strip, and are loud.
- **Targeted salvage** (`docs/idea-targeted-salvage.md`). You read a beaten mech by sight and pull the part you want.
  The chance shows as a number; a failed pull jams the wreck but still gives scrap.
- **Curiosities** (`docs/proposal-easter-eggs.md`): set pieces with a reward. Minefields that chain-detonate (the
  prize is lost on the first blast), barrel fields only a mech can wade, deep water. Seeded, each with a rarity.

Kept: wrecks you strip, crashed ships, curiosities, and caches inside camps.
Dropped: villages, compounds and old buildings.

## Commitment tiers

| Tier | Time to empty it | Examples | What guards it |
| --- | --- | --- | --- |
| 1 Glance | seconds, on the way past | rock outcrop with scrap caught in it, a lone wreck part, a supply pod | nothing |
| 2 Stop | under a minute | debris field (a scatter of salvage spots), a dead vehicle convoy, a small crash pod | maybe a few scrappers |
| 3 Fight | 1-3 min | abandoned battlefield (mech hulks and vehicle wrecks to strip), robots already scrapping a wreck (you compete for it), bandit outpost | a pack or a war band arrives |
| 4 Expedition | 3-8 min | crashed ship (hull sections, compartments, a power core at the heart), bandit camp | bandits or robots on site, and more come |
| 5 Siege | 10+ min | bandit fortress: about 9 sections behind wreck walls and gates | sections guarded in turn, reinforcements |

**The rule that makes leaving a real choice:** a POI's value is split into **sections**. Each section is a ring of
the fortress, a compartment of the ship, or a cluster of the debris field. Clearing and stripping one section banks
its value straight away, so leaving half done still pays.

Big POIs are visible from far off, so you can decide before you commit: a smoke column, a beacon, the ship's hull on
the skyline, the fortress's lights. Later, a scanner could show the tier and a rough value.

## Data: each POI kind is one definition

- **Placement:** tier, footprint, flat pad (how much ground it levels), which biomes allow it, rarity, minimum
  spacing.
- **Contents:** its sections, each with salvage spots (value, strip time) and an encounter (what spawns, when and how
  many).
- **Approach:** open, or hidden among dunes and rocks.
- **Seeded builder:** most kinds are a plain set piece (an arrangement of props plus spots), so new POIs mostly need
  data, not code.

## Placement is a pure function, like the ground

- `poisIn(cell)`: the world is cut into cells (about 400 m). Each cell's hash decides whether it holds a POI, and
  which, by biome and rarity. Big tiers use a coarser grid, so a fortress is rare and spaced out.
- Any part of the world gives the same POIs in any order. The convoy's route can see what lies ahead.
- POIs that need flat ground level a pad through the ground's modifier, the same way the convoy's road does. Feet,
  wheels and enemies agree on it.

## Needs a salvage action first

There's no salvage yet, and Keith has ideas. A minimal version so POIs can be played:
- Walk the mech up to a salvage spot and hold E to strip it. A bar fills while sparks and pieces fly.
- Stripping is loud, so it draws the swarm.
- Scrap counts up on the HUD.
- Later, value rides home on the mech and is lost if it dies, which ties into making it back to the convoy.

## Lab and files

- `labs/pois/`: a field near the start with one of each kind (a picker to swap them), the mech to walk in, and an
  overhead map with tier icons. Sliders per kind; hold-V picks a POI to show its sliders.
- `src/world/pois.ts` (pure): placement and definitions. `src/pois/<kind>.ts`: seeded builders.
  `src/pois/salvage.ts`: the salvage spot sim. Drawing is kept separate.
- Check `tools/poi-check.ts`:
  - deterministic in any order;
  - spacing kept;
  - pads flat and level with the ground;
  - every section reachable;
  - salvage value adds up.

## Order (after biome step 1)

1. Placement, salvage spots and tiers 1-2: outcrops with scrap, debris fields, wrecks and pods.
2. Tier 3: abandoned battlefields with hulks to strip, and robots scrapping a wreck.
3. Tier 4: crashed ships with compartments, then bandit camps.
4. Tier 5: the bandit fortress in sections.

## Questions for Keith

- **Salvage:** is "stand there and hold E" fine for now, or do you have a particular way in mind (a grabber arm, a
  crane from the convoy, pulling parts off hulks)?
- **Value:** is it one currency (scrap) for now, with parts and items later?
- **Bandit camps and fortresses:** are they built only from wreckage (ship hulls, vehicle walls, containers)? I'd say
  yes, to keep the world unsettled.
