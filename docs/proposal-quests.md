# Proposal: contracts (quests) and high value targets

Keith 2026-10-31: "I kind of want to add the idea of high value targets. These could be things like mechs out in the
world. Maybe we make it so that you can go into the area of a high value target and summon it by destroying enough
enemies in the area of a given type... mini bosses or like quest targets." And quests that pop up: go to a place for
scrap, eliminate a target, tow a mech back, recover escape pods (a lore reason for how we're recovered). No NPCs yet,
so contracts come over the convoy's radio. Fortresses are a separate thread.

Step 1 (this PR) is built so Keith can play it; everything below is a slider or a flag, and every call here is
Claude's unless marked.

## How it plays

- **Contracts pop up over the radio.** Every `contractEvery` (100 s) while out, or at once when the board is empty,
  dispatch offers one: a note at the top ("Contract offered · Tow · 620 m NE · +180 scrap · J to accept") and a line
  in the contract panel (top right, under the radar). **J** accepts the newest offer; an offer not taken in
  `offerTime` (30 s) lapses. Up to `contractsMax` (2) active. **Hold J** (1.2 s) drops the newest active contract.
- **Rewards are paid at the bank.** Finishing a contract puts its bonus scrap on the at-risk list ("Contract: Tow"),
  so it still has to come home, like every other pickup. Lost run = lost bonus (and the contract fails if it was
  carrying something: a tow or pods).
- **Each active contract** has a gold diamond on the radar (on the rim with its distance when off the scope) and an
  edge-of-screen mark ("CONTRACT · 420 m").

## Contract kinds (step 1)

| Kind | Where | Goal | Done when | Bonus (scrap) |
| --- | --- | --- | --- | --- |
| **Salvage run** | an unstripped POI 300-900 m out | strip `salvageShare` (60%) of its spots | the share is stripped | 80 + 0.15/m |
| **Cull** | a robot or bandit camp | kill N of one kind inside its area (24 scrappers, 6 cutters, 15 bandits) | the count is reached | 60 + 0.12/m |
| **Bounty** | a high value target's lair | draw it out (the cull) and kill it | it dies | 160 + 0.2/m, plus its drops |
| **Tow** | a downed convoy mech 400-900 m out | hold E by it to hook it, drag it to the crane | the crane picks you up with it | 140 + 0.2/m |
| **Escape pods** | a crash site 300-800 m out, 3 pods within 40 m | walk over each (mech or pilot) | the crane picks you up with all of them | 40 a pod + 0.15/m |

Distance is from the convoy's lead car when offered. Deeper offers pay more because the bonus scales with metres.

**Towing:** the hulk hangs on a 9 m cable behind the mech and is dragged over the sand (pure sim: a point pulled to
the rope length, sliding on the height function). While towing the mech walks at `towSlow` (0.6) of its speed and
cannot sprint or dash (a dash would snap the cable: it's blocked instead). Hold E again to drop it. Losing the run
loses the hulk (the contract fails). Lore: this is how the convoy gets downed pilots back; the same rules can bring
the player's own wreck home later.

**Escape pods:** picked up by walking within 4 m (mech or pilot on foot). They ride as at-risk cargo in the contract
panel ("2/3 pods, at risk") and fail with a lost run.

## High value targets

- **Lairs** sit on swarm camps and bandit camps (one in `hvtShare`, 35%, of camps further than `hvtMinDepth` 400 m
  from the road, seeded by the camp's id). Each has a named mech (seeded names: "Rustjaw", "Widow Nine"...), a kind to
  cull (scrappers or cutters at a robot camp, bandits at a bandit camp) and a count.
- **Summoning:** kills of that kind inside `hvtRadius` (180 m) of the lair count up. At the count, a warning
  ("Rustjaw is coming") and `hvtDelay` (6 s) later the HVT walks in from `hvtSpawn` (110 m) away, on the far side.
- **The HVT** is a rival mech (the duel lab's brain, `src/combat/rivalAi.ts`, and its rolled loadouts,
  `rivalKit.ts`) at the area's item level + `hvtUp` (3), hull × `hvtHull` (2), the Veteran preset. It fights inside
  its lair's circle (`hvtArena` 260 m). Walk further than `hvtLeash` (420 m) from the lair and it goes back to
  ground: the count resets.
- **Its death** drops `hvtDrops` (3) items, at least rare, and the lair is spent for this run. Lairs work without a
  bounty contract (kill the HVT and take its drops); a bounty adds the bonus.
- Only one HVT on the field at a time (one extra Rampart drawn; its body loads on the first summon).

## Files

- `src/quests/contracts.ts`: the pure contract board (offers, accept, drop, progress, completion, fail, events).
- `src/quests/hvt.ts`: pure lair placement on camps, kill counting, summon and leash rules, events.
- `src/quests/tow.ts`: pure cable and drag sim; pod pick-up rule.
- `src/quests/hvtMech.ts`: glue: the HVT's Rampart, arsenal and rival brain on the field.
- `src/quests/questDraw.ts`: beacons at targets, the hulk stand-in, pods, the cable.
- `src/quests/questHud.ts`: the contract panel.
- `src/quests/questLoop.ts`: glue into `ExpeditionLoop` (kills, salvage, banking, loss, radar, marks).
- `tools/quests-check.ts`: the rules (below).
- Sliders: topic "Contracts and HVTs" in the convoy lab (groups Contracts, Contract rewards, Tow, High value targets).

## Multiplayer habits (rule 12)

Host owned: the board, lairs, kill counts, the HVT, the tow and pods. Offers and lairs are seeded (contract ids
`c<n>`, lair ids `hvt:<camp id>`); kills, summons, completions are plain events. The tow is a command (hook, drop).

## Headless checks (`tools/quests-check.ts`)

- the same seed offers the same contracts in the same places; lair placement is seeded and only on camps;
- only kills of the right kind inside the lair's radius count; the summon fires once at the count; leaving past the
  leash resets it; a dead HVT never summons again this run;
- a contract completes once, pays once, and only onto the at-risk list; a lost run fails tow and pod contracts;
- the towed hulk never gets further than the cable from the mech and never sinks under the ground;
- pods are picked up only within reach.

## Other contract ideas that fit what we have (not built)

- **Hold the beacon:** stand on an extraction pad's beacon while it charges (waves come, like the pickup call).
- **Black box:** a war band column carries a crate; kill the turret truck and pick it up.
- **Sabotage:** wreck the pylons at a robot camp (static targets with health) to stop its packs for a while.
- **Survey:** sweep three spots in an unknown area with the sensor (clears the fog for the convoy radar).
- **Escort:** walk beside a crawler (an escort vehicle) to a pad and keep it alive.
- **Rescue:** an escape pod with a live pilot who walks home on foot beside you (the pilot code exists).
- **Bring back your own wreck:** a lost mech's hulk stays out there as a tow job for the next run (keeps the fitted
  items' story).

## Questions for Keith

1. J to accept and hold J to drop, or contracts only from a convoy terminal (bay screen) once NPCs exist?
2. Bonus scrap only, or should contracts also pay items or a progression currency later?
3. HVTs: mechs only, or also champion robots (a huge excavator "foreman" at manufacturing hubs)?
