# Stage 7: the host world in the worker (proposal, Claude 2026-11-07)

Keith 2026-11-07 (relayed by the coordinator): carry on with the re-architecture as we see fit, don't wait on him.
Plan: `docs/architecture-review.md` §4.3 (host and view) and §5 stage 7. Where we are: `docs/handoff-architecture.md`.

## Where things stand
- The sim worker (`src/sim/`) already runs the ground mirror, chunk builds, the escorts, the robot swarm
  (`robotsRemote.ts`: a view swarm on main, commands recorded, a snapshot of every swarm array back each frame) and the
  death physics. Each is its own "remote" with its own protocol.
- The host world (`CombatRules.world`) now holds every enemy and mech as an entity: swarms as their own columns
  (stages 4.3-4.4), heavies mirrored each tick (stage 5, `src/ecs/heavy.ts`). Health bars read it.
- What blocks moving the whole host world: the heavies' sims hold three objects and drawing (MechUnit builds its body,
  fires FX, plays sound inside `step`); the battlefield mixes rules and FX (stage 3 split most of it out:
  `combatRules.ts`); the convoy lab's loop calls the sims directly.

## The steps (one PR each, each behind `?noworker` as today, parity-checked headless)
- **7a. One snapshot format.** `packBlock(world, base, n, comps)` / `applyBlock` in `src/ecs/snapshot.ts`: a swarm
  block's columns as one transferable buffer per component. `robotsRemote` ships the robots' block columns that way
  (Transform, Velocity, Health, Status, Robot) plus the AI arrays by name as now. Check: robotworker parity unchanged.
- **7b. Infantry in the worker** the robots' way (the bandits and riders: camps, fortresses, war bands), on the 7a
  format. Check: an infantryworker parity check (camp fight both ways, bit for bit).
- **7c. MechUnit split** (the review's stage 5 "L" part): `MechSim` (walker, upper, dash, reactor, health, weapons'
  rules: no three, events out) and `MechView` (body, FX, sound from events). Guardians and rival AIs first (host
  mechs), the player's mech stays predicted on main. Check: duel-check and walker-check unchanged; a duel sim headless
  through MechSim.
- **7d. The rules in the worker.** `CombatRules` (shots, blasts, burns, pools, chills, the register) steps in the worker
  with the swarms and host mechs; main keeps the view world from snapshots and plays the rules' events (already plain
  data since stage 3). The per-system remotes merge into one message per tick. Check: a generalised parity check (the
  host world hashed after a scripted convoy fight, worker vs `?noworker`).
- **7e. Retire the remotes** (`robotsRemote`, `escortsRemote`): one protocol (commands in, events and snapshots out),
  the one co-op will carry (stage 8).

## Values and risks
- Message size: robots' block columns at 1024 slots are ~50 KB a tick uncompressed; cut to `hi` as now, and later to
  dirty entities. Measure with the convoy lab's `?bench` on Keith's PC before and after 7d.
- Latency: the view is a tick behind the worker (as the robots are now); the player's mech stays on main, so input
  feel doesn't change.
- 7c is the big one (MechUnit is ~800 lines with drawing woven in). It wants Keith's eyes after: mechs must look and
  feel the same. The rest is checkable headless.

## Open for Keith (defaults chosen, not blocking)
- Order: 7a, 7b first (headless-checkable, low risk), 7c when he can play-test mechs.
