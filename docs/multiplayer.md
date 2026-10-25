# Multiplayer (direction, not built)

Keith 2026-10-26: 4-player co-op eventually, "kind of Risk of Rain like". Local items with one player hosting to
start; maybe later a remote server with server-side items, so it plays more like an always-online ARPG (Path of Exile
2). Nothing is built yet. **The habits at the bottom apply to all code from now on**, so the game stays easy to make
networked when the time comes. Keith: managing performance will be the main thing; refine it when we have to.

## Stages

1. **One player hosts (start here).**
   - One browser runs the authoritative game. Up to 3 others connect peer to peer over WebRTC data channels.
   - **The host decides:** enemies and their AI, damage and deaths, loot rolls, salvage, the convoy and the expedition
     state.
   - **Each player moves their own mech locally** (client-side prediction, so it feels instant) and sends their
     inputs and position. The host checks them and corrects only on large disagreement.
   - **Remote mechs** are drawn slightly in the past and interpolated, so they don't jitter.
   - **Servers:** only a tiny signalling server (matchmaking, connection set-up), plus a TURN relay for players whose
     networks block direct connections. Close to free at this scale.
   - The same split as the old Unity project's plan (listen server, host owns AI, loot and hits, clients own their
     own movement).
2. **A dedicated server, if wanted.**
   - The sims are plain TypeScript with no rendering in them (walker, upper body, swarms, convoy, expedition, items),
     the same code the headless checks already run in Node.
   - A Node process can run the host's role with no browser: friends host one, or we run them.
3. **Server-side items (the Path of Exile 2 way): a separate, smaller service.**
   - What has to be trusted is **who owns what**, not the combat.
   - An account and item service: login, stash and cargo stored server side, loot rolled server side from seeds
     (`src/items/generate.ts` is already seeded), banking confirmed by the server.
   - It can sit beside either stage 1 or 2 and changes nothing about how combat runs.
   - The cost: a login and an always-on service to keep running.

## What already helps

- **The ground is a function** (`DuneField.height`), craters included. A blast goes over the wire as "blast at x, z,
  size"; every peer digs the same crater. The GPU dents are cosmetic, rebuilt from the same events.
- **The convoy follows a seeded route.** Peers only need the shared clock.
- **POIs are seeded placement.** Only what's been stripped needs sending.
- **Loot from seeds:** the host or server sends the seed and the item id, not the whole item.
- **Cosmetic and per-player:** dust, sparks, tracers, casings, water ripples, sound and death ragdolls (Rapier).
  Each peer simulates its own; they don't need to match.
- **Bandwidth is small.** 300 robots at about 6 bytes each (quantised position, heading, state) is about 2 KB a
  snapshot: 40 KB/s at 20 Hz, less with interest management (send only what's near each player).
- **Fixed-step sims at 120 Hz** already make the simulation independent of frame rate.

## Design questions for later (Keith)

- **Loot:** shared drops (Risk of Rain), per-player instanced drops, or a shared cargo the crew splits at the
  convoy?
- **Difficulty:** scaling for 1–4 players (swarm size, enemy health, expedition length).
- **Death and recovery in a group:** one destroyed mech ends their run, or teammates can carry them home?
- **The convoy:** one shared convoy (one crane queue) or a bay per player?
- **Friendly fire,** and whether blasts shove teammates.

## Habits from now on (also in CLAUDE.md)

1. **Seeded randomness in sims:** never `Math.random()` in anything that changes game state; use a seeded generator
   owned by the system.
   - Cosmetic code (FX, sound, drawing) may keep `Math.random()`.
   - Known debt (2026-10-26), fix when touched: `src/combat/warband.ts`, `src/expedition/swarmCamps.ts`,
     `src/game/battlefield.ts`, `src/game/mechUnit.ts`, `src/weapons/arsenal.ts`. The rest of the 130 uses are
     cosmetic.
2. **Inputs as commands:** a sim takes a command (move, aim, fire, dash, salvage, hop out) and never reads the
   keyboard or mouse itself. Labs turn input into commands; later the network does too. `MoveCommand` and `Aim` are
   the model.
3. **Events for what happened:** blasts, hits, deaths, pick-ups, salvage, banking. These are what a host will send.
   Keep them as plain data.
4. **Stable ids** for anything a peer must agree on (units, vehicles, POIs, items, salvage spots). The shared
   register (`docs/proposal-register.md`, coming) hands these out.
5. **Know who owns each piece of state:**
   - **host-owned:** enemies, damage, loot, the convoy, the expedition;
   - **player-owned:** your own mech's movement and aim;
   - **cosmetic:** FX and ragdolls.

   Say which in the file's header comment when it isn't obvious.
6. **No game state in drawing code,** which is rule 5 already. A server never runs the draw files.
