# Proposal: bandit fortresses and robot manufacturing hubs (waiting for Keith; placement started)

Keith 2026-10-31: place fortresses and manufacturing hubs on the map. Fortresses are where bandits and war bands
gather: rings with limited entrances you may have to destroy, fight inward, reach the centre, loot, destroy, maybe a
boss, then leave. Manufacturing hubs are where the robots come from.

Already decided (docs/proposal-pois.md, Keith 2026-10-25): a fortress is tier 5 "Siege", about 9 sections behind
wreck walls and gates; its value is split into sections so leaving half done still pays; camps and fortresses are
built from wreckage. The POI grid already has an empty level for tiers 4-5 (cells of 4 × 400 m).

## Placement (pure, a function of position like the ground)

- Two new tier 5 kinds in `src/world/pois.ts`: `fortress` (bandits) and `hub` (robots), on the coarse 1600 m cells.
  With `bigChance` 0.6 that is roughly one of either every 2 km; none within 1200 m of the start, more likely with
  depth (the same depth curve the camps use).
- Biomes: fortresses favour desert flats, hubs favour rocky ground; neither in the shallows.
- Each levels a big pad through the ground's modifier (radius about 110 m), like the convoy's road, so feet, wheels
  and enemies agree on where the ground is.
- Visible from far off: the fortress's lights and a smoke column, the hub's furnace glow. On the radar as a big
  marker once seen.

## A fortress

```
          outer wall (r 95 m), 2 gates
        .-------[G]--------.
      /    middle wall (r 58 m), 1 gate (offset 120° from the outer ones, so you work round)
     |   .----[G]---.        |
     |  |   keep (r 24 m), 1 gate     |
     |  |    [vault + warlord]  |     |
     |   '----------'        |
      \                      /
        '-------[G]--------'
```

- **Walls** are wreckage banked with sand, built as part of the ground (like the duel lab's cover drifts): 7 m high,
  faces steeper than the walker's wall grade, so nothing walks up them. Steel stand-ins (hulls, plates, containers)
  sit along the top, so rounds spark off steel or bury in sand. A good sprint jump off a dune may still clear a wall:
  emergent "jumping into fortresses" (Keith 2026-10-26) stays possible.
- **Gates** are the limited entrances: a 10 m gap in the wall plugged with a steel barricade that has health
  (`gateHp` 3000, about 15 s of a level-1 mech's focused fire). While it stands it is part of the ground (a wall).
  Destroyed: an event (`gateDown`, a stable id), the plug drops out of the ground (an area rebuild, as craters do),
  the barricade's steel falls through the death physics. Host owns gate health.
- **Sections:** the yards between walls. First build: 3 sections (outer yard, inner yard, keep). Then each yard is
  cut into sectors by inner barricades to reach Keith's ~9 (outer 4, inner 3, keep 2) without new code, only data.
- **Garrison per section:** bandit infantry posted at the walls and gates (the bandit camps' swarm and behaviour),
  scaled by depth and by ring (inner rings bigger and tougher). Hitting a gate alerts its whole section; the next
  section stays asleep until its gate is hit or you're inside. Turret trucks parked as gun emplacements behind the
  gates.
- **Salvage per section:** salvage spots and scrap clumps in each yard (the sites' salvage), so a cleared yard pays
  before you go deeper.
- **The keep:** a vault (a big strip: an item cache, rarity rolled up a step) and the **warlord**: a bandit mech run
  by the duel lab's rival brain (`rivalAi`), on a rolled loadout a few levels up. Kill it and the vault opens.
- **War bands gather there:** war band columns roll out of the nearest fortress, and when a fortress is under attack
  a column or two is sent back to it as reinforcements (`fortReinforce` seconds after the alarm).
- **Leaving:** nothing holds you inside; the convoy's clock does the rest.

## A manufacturing hub

- A different shape: no rings. A walled pit of wreck and machinery with **fabricators** (3-5 destructible steel
  towers, `fabHp` 2500 each) round a **core**. Each fabricator builds a robot every `fabEvery` seconds (scrappers
  mostly, cutters and excavators with depth) while the hub is awake, up to a cap on the field.
- Destroy the fabricators to stop the flow; the core then becomes strippable: lots of scrap and a machine-part cache.
- **Where robots come from:** roaming packs and raids (`threats.ts`) spawn on the side of the nearest hub and drift
  out from it; a hub you've destroyed stops feeding packs for the rest of the expedition.

## Files

- `src/world/pois.ts`: the two kinds and their pads. `src/pois/fortress.ts` and `src/pois/hub.ts` (pure, seeded
  layout: rings, gates, sections, spots, garrisons). `src/pois/fortressGround.ts` (walls and gate plugs as a ground
  modifier that reads gate state). `src/pois/fortressDraw.ts`, `hubDraw.ts` (stand-in steel, lights).
- `src/expedition/fortresses.ts`, `hubs.ts` (glue: garrisons, gates' health, fabricators, events, warlord).
- `labs/fortress/`: a fortress or hub at the start (`?kind=fortress|hub`, `?seed=N`, `?ring=0|1|2` start in that
  ring, `?gates=open`), the combat-lab flags. Convoy lab: `?fortress[=m]` and `?hub[=m]` start that far from the
  nearest one. Sliders under a "Fortress" topic (layout, gates, garrison, warlord) and "Manufacturing hub" topic; hold-V
  picks a gate, a wall or a fabricator.
- `tools/fortress-check.ts`: placement deterministic in any order and spaced; none near the start; pads flat; walls
  never walkable (slope over the wall grade all round, except at gates); every section reachable once its gates are
  down and none before; a gate's plug gone from the ground after `gateDown`.

## Order

1. Placement of both kinds, the pads, map and radar markers (no contents). Check.
2. The fortress: walls, gates, garrisons per section, salvage, the keep's vault. Fortress lab, then the convoy lab.
3. The warlord (the rival brain) and war band reinforcements.
4. The hub: fabricators, the core, packs and raids coming from hubs.

First PR: steps 1 and 2.

## Questions for Keith

- **Breaching:** gates only for now (walls can't be shot through), with jumping over as the trick? Later, heavy
  weapons could breach weak wall sections.
- **The warlord:** a bandit mech with the rival brain, or something bigger (a walking fortress gun, a crane-mech)?
- **Hubs:** is "destroy the fabricators, then strip the core" the shape you had in mind?
