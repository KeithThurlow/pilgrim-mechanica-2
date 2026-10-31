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

## Left, in order

1. Keith's answers to the proposal's questions; adjust.
2. The warlord in the keep: a bandit mech on the rival brain (`src/combat/rivalAi.ts`, `rivalKit.ts`, as the duel lab
   does), a few levels up; the vault opens (or pays more) when it dies.
3. War bands gather at fortresses: columns (`warColumns.ts`) roll out of the nearest fortress; a column or two sent back
   when its alarm goes.
4. Hubs: fabricators as targets (like gates), building robots into the swarm (`swarmCamps.addGroup`) while awake; packs
   and raids (`threats.ts`) spawning on the nearest hub's side; a destroyed hub stops feeding them.
5. Looks: the walls are stand-in boxes and plates on sand berms; fortress lights and a smoke column so they read from
   far off; radar markers for tier 5.

## Known rough edges

- Nothing seen in a real browser yet (headless Chromium only proved the labs load and the HUD numbers move).
- Garrison bandits use the camps' rifles; no rocketeers or turrets on the walls yet.
- Robots ignore the walls (only bandits on foot are fenced); vehicles too.
- Depth doesn't scale garrisons or fortress frequency yet.

## How to test

`npx tsx tools/fortress-check.ts`; `labs/fortress/` (`?manual&near`, `?ring=1`, `?kind=hub`); convoy lab `?fortress`.
