# Handoff: fortresses and manufacturing hubs (branch `wip/fortress`, PR from `claude/project-thread-uuxl4w`)

Keith 2026-10-31 asked for fortresses (bandits and war bands gather there; rings with limited entrances to blow,
fight inward, loot the centre, maybe a boss, leave) and manufacturing hubs (where the robots come from). Plan:
`docs/proposal-fortresses.md` (its three questions to Keith are still open: breaching, what the warlord is, the hub's
shape).

## Done (steps 1 and 2 of the proposal)

- Placement: `fortress` and `hub` are tier 5 kinds in `src/world/pois.ts` (pads `fortPad` 104, `hubPad` 68,
  `siegeClear` 900). Expedition: `FieldSites.edgeBlocked` keeps them off the road all round their pad.
- Layouts and sites: `src/pois/fortress.ts` (`fortLayout`, `buildFortress`), `src/pois/hub.ts` (`hubLayout`,
  `buildHub`). Walls in the ground: `src/pois/fortressGround.ts` (`SiegeWalls`, `wallHeight`, `fenced`, `regionOf`,
  `routeVia`, `gateBox`).
- Gates: `src/pois/gates.ts` (Hittable, events), `src/pois/gatesDraw.ts`.
- Garrison glue: `src/expedition/fortresses.ts` (`Fortresses`), wired into `src/expedition/loop.ts` (kills drop loot,
  noise, dash shove, trample, register, reset, HUD line) and the convoy lab (`?fortress`, `?hub`, hold-V entries,
  `groundChanged` → `streamer.rebuildArea`).
- Infantry: `hold`, `hurry`, `fence` in `src/combat/infantry.ts`.
- Lab: `labs/fortress/` (gate-breaking demo; `?kind=hub`, `?ring=N`, `?gates=open`, `?near`, `?seed=N`).
- Check: `tools/fortress-check.ts` (in `npm test`).

## Done (step 3: Claude's defaults, Keith asked to make it work first)

- Warlord: `src/expedition/warlord.ts`, placed by `Fortresses.stepWarlord`; the loop's `attachWarlord` (convoy lab loads
  the red Rampart) rolls its drops. Fortress lab has it too.
- War bands: `loop.ts` `fortCalls` sends one column out of a fortress 20 s after its first alarm.
- Hubs: `src/pois/fabricators.ts` (targets), `fabricatorsDraw.ts`, `src/expedition/hubs.ts` (wake, batches into
  `swarmCamps.addGroup`, cap, dead), `threats.from` = `hubs.bearing`. Fortress lab `?kind=hub` builds robots too.

## Open questions for Keith (defaults in place)

1. Breaching: gates only, or can walls be blown too (and by what)?
2. The warlord: a tougher red Rampart on simple AI now. Should it be a rival-brain mech (duel lab AI), a unique hull, a
   vehicle? Should killing it open the vault (now the vault is just strippable)?
3. Hub shape: one open ring, 4 towers, a core. Walls, gates and a garrison of robots too?
4. War bands: one column per fortress alarm. More, or columns based at fortresses that roam out on their own?
5. Hubs: batch size, cap, and whether killing a hub should drop loot (now only the strip spots pay).
6. Depth: should garrisons, warlord and batches grow with depth (they don't yet)?

## Left, in order

1. Keith's answers; adjust.
2. Looks: stand-in walls, plates, slabs and towers; fortress lights and a smoke column so they read from far off; radar
   markers for tier 5; a tower's fall.
3. Robots fenced by walls; garrison rocketeers or wall turrets.

## Known rough edges

- Nothing seen in a real browser yet (headless Chromium only proved the labs load and the HUD numbers move).
- Garrison bandits use the camps' rifles; no rocketeers or turrets on the walls yet.
- Robots ignore the walls (only bandits on foot are fenced); vehicles too. A column called out of a fortress may spawn on rough ground.
- The warlord's AI is simple: no dash, no shoulder weapons, it doesn't take cover.
- Depth doesn't scale garrisons or fortress frequency yet.

## How to test

`npx tsx tools/fortress-check.ts`; `labs/fortress/` (`?manual&near`, `?ring=2` for the warlord, `?kind=hub&near`); convoy lab `?fortress`, `?hub`.
