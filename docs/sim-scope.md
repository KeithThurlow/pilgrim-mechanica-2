# How much of the world is simulated (2026-11-07)

Answer to Keith: "Is the whole thing being simmed? Are we using localized loading?" Read from the code at main
`1f21de4` (after #272). Numbers are the defaults in each system's params; every one is a slider. Nothing here changes
gameplay.

## Short answer

No, the world is not simulated as a whole. It is **infinite and almost entirely a function**: the ground
(`DuneField.height(x, z)`), the points of interest (`src/world/pois.ts`), swarm camp and bandit camp placement
(`camps.ts`, `banditCamps.ts`), fortresses and hubs are all pure, seeded functions of position. Nothing about a place
exists in memory until the mech is within a few hundred metres, apart from small pieces of host state (roaming packs,
war columns, remembered kills). So yes, it is localized loading already, and the "markers on the map, spawn when you get
close" idea is mostly what the code does today. The gaps are listed at the end.

## By distance from the mech (convoy lab, out on an expedition)

Radii are from the mech (the player) unless it says convoy.

| Distance | What is going on |
| --- | --- |
| 0 to ~130 m | Full sim, every frame (fixed 120 Hz steps): awake robots, infantry, war bands, turrets, your weapons. This is where the cost is. |
| ~130 m (`campWake`, `banditWake` 110, `fortWake` 110, `hubWake` 200, `roamEngage` 130, `colEngage` 170) | Sleepers wake, roaming packs and war columns that hunt you stop being points and come onto the field as real robots, infantry and vehicles. |
| ~300 m | Bandit camps "stir" (`banditActive` 300): patrols walk, the rest stand at posts. Fortresses go active at 320 (`fortActive`). Awake swarm robots freeze again past `campGiveUp` 320 m (they stop where they are, not stepped). |
| 550 to 750 m | Crushers grazing salvage stand up inside 550 and are taken off past 750 (health remembered). |
| 650 to 700 m | Swarm camps and bandit camps stream in as **asleep, frozen** robots/infantry within 650 (`campSpawn`, `banditSpawn`); fortresses and hubs at 700. POI sites (wrecks, scrap, salvage) are built and drawn within 700 (`drawRadius`). Terrain chunks cover about 350 m (see below). |
| 950 to 1000 m | They stream out (`campDrop` 950, `banditDrop` 950, `fortDrop` 1000, `roamDrop` 1000), their survivors and remembered kills go back to the abstract count. |
| 1500 to 1800 m | War band columns exist as points to 1500 (`colSpawn`) and drop at 1800 (`colDrop`). |
| Beyond | Not spawned. Camps and sites are only a function of position. The radar can show camps as heat blobs (a rough guess, off by up to 40%) from the cell function without anything being created. |

## The four states

**Fully simulated (every frame).** The mech and its guns; awake robots (up to `ROBOT_MAX` 1024 slots, structure of
arrays) and infantry (`INFANTRY_MAX` 1024); war bands that closed with you; the fortress yard you are in; crushers
inside 550 m; your summons; the ground's dents, dust and fire; ragdolls and wrecks (Rapier, cosmetic); the convoy
(every car, the plough, turrets, guardian mechs) because it is always near the mech by design.

**Reduced rate.** Escorts farther than 90 m from the mech step at 60 Hz instead of 120, alternating which ones each step
(`escortLodDist`, #250; drive error under a metre). Terrain chunks are built a few per frame inside a 4 ms budget, nearest
first, and chunks beyond 1.5 chunks are built in the sim worker. Fortress garrisons wake yard by yard rather than all at once.

**Abstract (numbers or points, no bodies).**
- Roaming packs (`threats.ts`, up to `roamMax` 16): a point with heading and size, drifting; they hear the mech within 200 m
  (more while it is loud), and only become robots inside `roamEngage` 130 m. Kept topped up round the mech.
- Raids: points that spawn 340 m out (`raidFrom`) every ~120 s while out, homing on where you last made noise.
- Distant blasts: only a radar flicker and a mark at the screen edge, 140 to 380 m out.
- War columns: points (where, what vehicles, how hurt) until they engage inside 170 m.
- **Off-screen clashes** (`fights.ts`, `game/factions.ts`, #258): any two hostile groups that are not on the field, i.e.
  swarm camps, roaming packs, bandit camps and war columns, within `clashRange` 90 m of each other fight by Lanchester's
  square law on their strength numbers, checked every half second. One side breaks below 25% of its start; the winner
  keeps damaged survivors, the loser is gone, and the spot becomes a salvage site with item drops. A group nearer the
  player than `clashView` 700 m is simulated instead. A group that comes onto the field mid-clash carries its current
  strength with it. The radar shows a flicker.

**Frozen (exists, does nothing).** Sleeping camps inside spawn range are real robots/infantry with `frozen = 1`: no AI,
no movement, no attacks (`robots.ts` skips them in its step), still hittable, still drawn if on screen. Awake swarm
robots farther than 320 m from the mech also freeze where they stand. Remembered kills and damaged hull are kept when a
camp streams out.

**Not spawned.** Everything beyond the stream-out radii above, camps you have not been near, and the contents of a
cell until the function is asked.

## Terrain

`TerrainStreamer` (`src/world/chunks.ts`): 64 m chunks (`chunkSize`), view radius 5 chunks, so about 11 by 11 = 121
chunks, roughly 700 m square (350 m each way) around the focus. Nearest missing first, a few per frame inside a 4 ms
budget, far ones dropped, shared edge vertices so no seams. Vertices come from `chunkFill.ts`; in the sim worker the
builds beyond 1.5 chunks (and crater patches) run there. The ground is a pure function so any chunk can be
made in any order; craters and dents are the only terrain state, and they are small (kept as a list of blasts, replayed
into the worker's copy).

## What runs in the sim worker (#252 to #270, convoy lab, on by default)

One module worker (`src/sim/worker.ts`, `host.ts`), one system per step, each with a bit-for-bit parity check
(`tools/*worker-check.ts`), `?noworker` to compare, `?bench` for the A/B:
1. The ground's copy: the main thread records every ground-changing call as plain events (about 3 events and 180 bytes a
   frame) and the worker replays them (`groundEvents.ts`, `groundMirror.ts`).
2. Terrain chunk builds and patches (`chunkFill.ts`); 2b: the fine ground rows under the detail patch.
3. The escorts and the convoy's own copy (`escortsRemote.ts`): they drive in the worker, snapshots come back.
4. The robot swarm (`robotsRemote.ts`, #270): the whole `RobotSwarm` steps in the worker, main holds a view that applies
   commands immediately and is overwritten by each snapshot (then the commands since are replayed). The infantry swarm,
   war bands, crushers, drones and the mech itself are still on the main thread.

## Where the frame cost comes from

From the production siege profile (`pc-profile-siege-prod.md`, Keith's 3080, `?siege&manual`): the main thread is about
half "convoy lab update" (the game's own sim and glue, about 24% self-included update paths: battlefield, dust, sample
of the ground `fbm` at 5%) and about a third renderer: `_renderScene` 34%, shadow passes (`updateShadow` about 10%),
`updateMatrixWorld` 6%, `_projectObject` 5.5%, `traverseVisible` 3%. `fbm`/`duneSet` ground lookups are the biggest single
sim cost (the dust and shadows ask for the height tens of thousands of times a frame, about 6 µs a call). So the cost is
**not** "too much world simulated": it is draw submission and shadows for what is near, plus per-frame ground queries.
Far camps cost almost nothing (frozen robots skip the step; stream-in cost is a one-off).

## Opportunities

1. **Markers, spawn on approach: mostly already so.** The remaining pieces that are not like this: war columns are
   host state from 1500 m (cheap, they are points); roaming packs are kept topped up to 16 round the mech (a spawn
   policy, not a cost). Nothing big is simulated far away.
2. **Frozen camps inside 650 m still cost something.** A sleeping camp is real slots (robots up to 1024 total), draws if
   in view, and costs memory and the hit-test lists. A cheaper form: keep camps as markers until they are inside the
   view (about 150 to 250 m), and spawn the robots at wake time. Camps are a function of position, so this is
   straightforward and also removes `campSpawn`/`campDrop` hysteresis. It would also help multiplayer (spawn what a
   peer is near).
3. **Wake-time spawn for bandit camps and fortress yards** the same way, leaving the radar to read the abstract camp.
4. **Frozen far swarm robots** (awake, past 320 m): collapse them into an abstract pack (a point with a count and
   strength) so they join the clash system instead of standing as bodies. Today they stay slots until `campDrop`.
5. **Move more to the worker:** infantry swarm and war bands next; they are the other big per-frame steppers, and the
   robots' pattern (view + commands + snapshot) already works.
6. **Cut ground lookups:** a cached height grid for dust and shadow queries would take the largest sim line off.
7. **Terrain radius** is a slider (5 chunks); fewer chunks on a lower setting is a free cost cut if the haze hides them.
8. **Open question for Keith:** whether stream-in at 650 m feels right when sleeping camps are only ever seen at the
   radar's edge. Shrinking `campSpawn` to about 400 would roughly halve the area (and so the sleeping bodies) with no
   visible difference if the haze hides beyond that; check in the convoy lab with `?nearcamp` on the PC.
