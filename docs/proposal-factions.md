# Proposal: enemy factions, and what happens when they meet (not built; waiting for Keith)

Keith 2026-10-28: get the other enemy groups into the convoy lab. Bandits should fight robots when groups meet.
Bandits and war bands are too similar today, so tell them apart. Add rival military mechs ("we don't want you to always
feel like the biggest bad out there") and more kinds of robot, including one close to a mech in size and power.

## Factions

| Faction | Who | Where | How they fight |
| --- | --- | --- | --- |
| **Robots** (the clearance) | scrappers, cutters, excavators, plus a new mech-sized one (below) | roam everywhere; camps, packs, raids; denser with depth | swarm; hostile to every human |
| **Bandits** (settled) | infantry with rifles, a few bandit mechs, fixed guns | hold territory: camps at wrecks and points of interest, patrols nearby | defensive and territorial: cover, firing lines, they hold ground; leave their turf and they stop chasing |
| **War bands** (nomads) | raider vehicles that keep dropping off melee infantry | roam the sand in columns; drawn by noise and salvage heat | loose and aggressive: drive-bys, circle and shoot; infantry jump out and sprint at you with blades and clubs to swarm and chop |
| **Rival military** (a mech faction) | disciplined squads of mechs on the player's own part set: legs, hulls, weapons, Protocols | patrols and outposts, mostly Deep and Far | fight like you: lock, flank, cover each other, focus fire; drop real mech parts |

- **Relations:**
  - Robots are hostile to everyone human.
  - Bandits, war bands and rival military are hostile to robots and to you.
  - Bandits and war bands are wary of each other: they fight if provoked.
  - Rival military fights everyone.
  - All of it lives in one table of sliders, so it's easy to change.

## When groups meet

- **Within view:** groups that see each other pick targets among all their enemies by distance and threat. At most
  2–3 groups are engaged at once, to keep the frame cost and the chaos readable. The shared register makes targeting
  across groups cheap.
- **Out of view:** no full simulation. Their strength drains on both sides over time, by size and type. The radar
  shows a "fighting" flicker. Arrive and you find the fight in progress or its aftermath: wrecks and bodies to loot.
- **Meetings come from placement:** bandits hold turf, war bands roam, robots swarm, so clashes happen now and then at
  the edges. Raids and salvage heat can drag in more than one faction.
- **Loot from all sides:** robots drop parts and scrap, humans drop weapons and Protocols, rival mechs drop real mech
  parts.

## New enemies

- **War band melee infantry:** the bandit swarm's baked character with the old project's Mixamo melee clips. These are
  in `pilgrim-mechanica/Assets/_Project/Art/Animations/Mixamo/Melee/`: three-hit combo, horizontal, overhead, jump
  attack, spin. They're baked into the same vertex animation texture (`tools/mixamo/`).
  - They're dropped off from moving vehicles, sprint at you, and hack at your legs (small damage, many of them).
  - A stomp or the dash scatters them.
- **A mech-sized robot** (working name **Reclaimer**): about the Rampart's size, much stronger than a cutter.
  - It runs on the walker sim with a robot body: reverse-jointed legs, a cutter-arm hull, a heavy rivet gun or plasma
    torch.
  - Slow, armoured, telegraphed heavy attacks; one or two lead a pack.
  - Reusing the walker means it walks, lands and staggers like a mech for free.
- **Rival mechs:** the war band's bandit mechs grown up. Squads of 2–4, using the player's loadout system (`src/items`)
  for their parts, an AI driving the same commands the player sends (rule 12), and real loot.

## Order

1. Bandits (camps, patrols) and war bands (columns, drive-bys) in the convoy lab, placed by depth like robot camps.
2. The faction table, fights within view, off-view fights resolved by numbers, the radar flicker.
3. War band melee infantry (bake the melee clips, drop-offs, swarm).
4. The Reclaimer.
5. Rival military mech squads.

## Questions for Keith

1. **Bandits and war bands:** wary of each other (fight if provoked), or always hostile?
2. **Rival military:** a proper faction with its own look (cleaner, painted, uniform), or rogue mechs?
3. **The mech-sized robot:** a reverse-jointed walker like ours, or a big humanoid?
