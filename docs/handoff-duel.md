# Handoff: duel lab (a rival mech)

Keith 2026-10-29: "another lab where we can really hone in fighting a harder enemy, another rival mech, and make that
feel scary ... that mech spawns with random weapons, and we can test how our loadout feels against it." First piece of
factions step 5 (rival military, `docs/proposal-factions.md`). Branch `wip/duel`.

## Proposal (built straight away, Keith asked directly)

Files:
- `src/combat/rivalAi.ts` (pure): the rival's brain. Takes a plain-data `DuelView` (itself, the foe, threats, cover
  spots, a line-of-sight test, the arena) and returns a `MechCommand`, the same commands the player's mech takes: move
  (WASD), aim and shotAt (mouse), lock and cursor (the soft lock and the ground point), trigger per side (mouse buttons),
  keys 1-3 (hold to paint, release to fire), dash (Space) and sprint. Never touches a sim. Seeded.
- `src/combat/rivalKit.ts` (pure): what a resolved loadout carries as the AI sees it (each weapon's control, kind,
  range, projectile speed, blast), its preferred range; `rollRivalLoadout(seed)` (random legs, hull, sensor, pack and
  weapons on the mounts through the fit rules, `rollItem` seeded) and `?rivalfit=slot:base:rarity` on top.
- `src/combat/duelThreats.ts`: the lab glue: reads a mech's live Arsenal and the battlefield's shells into threats
  (mortar rings, line mortar strips, missile swarms, rockets in flight, a charging rail's line) and the AI's own weapon
  states; builds the view from two MechUnits.
- `src/game/duelGround.ts` (pure): the arena (a flattened circle, gentle dunes left at `duelDunes`), steep cover
  mounds with a steel wreck on each (shots stop in the sand and on the steel; walkers can't climb the faces), and the
  line-of-sight test.
- `src/combat/duelScore.ts` (pure): rounds, time to kill, damage dealt and taken by weapon.
- `src/combat/duelSim.ts` (headless, for the check): two mechs on WalkerSim + Dash with simple weapon models fed by
  the same kit stats, both driven by RivalAi.
- `labs/duel/` (index.html, main.ts): the combat lab shell plus the rival, health bars, scoreboard, Reroll, R restarts.
- `tools/duel-check.ts`.

AI states: `engage` (hold the preferred range band, strafe/circle with seeded flips), `press` (the foe is exposed:
sprinting with guns off, out of dash, staggered, airborne or low: close in and use everything), `cover` (weapons
cooling and hurt: get behind a mound away from the foe, peek out when ready), `retreat` (hull under `aiRetreatAt`:
open the range, cover, mortar the way back). Dodges sit over every state: a threat noticed after `aiReaction` that
covers where it stands is walked out of if there's time, else dashed out of (`aiDashUse`).

Key values (sliders, topic "Rival"): aggression 0.6, reaction 0.35 s, aim error 1.2 m at 30 m wandering at 0.6 Hz,
lead share 0.85, dash use 0.75 (keeps 1 charge for dodges), preferred range 0 = from its weapons (minigun 32, rail 50,
autocannon 40, rocket 34, mortar 55, line mortar 38, missiles 42; mean of what it carries), band ±8 m, strafe 0.7, flip
every ~3.5 s, retreat at 35% hull, cover 0.6, paint time 0.7 s (its telegraphs stay readable).

## Status (2026-10-29)

- [x] AI (`rivalAi.ts`), kit (`rivalKit.ts`), arena (`duelGround.ts`, wreck stand-ins take scale/sink/rebuild), score,
  threats glue, headless duel, lab (`labs/duel/`, hub entry), check (`tools/duel-check.ts`, in `npm test`), state.md,
  CLAUDE.md, decisions.
- Combat lab shell: new `wrecks` option (steel stand-ins on the battlefield).
- Not done / next: never run in a browser (no browser in the agent's box): Keith's first play is the real test. Then:
  the rival going for the pilot on foot; rival squads (2-4, factions step 5); real loot from a killed rival.

As built, differences from the proposal: a rail can't be dodged (instant, the lock follows), so the AI dashes after a
random 0-1 s beat once a rail is charged past 0.9, for the shove's half damage; homing missiles the same (a dash as
they land). Retreat and cover are time-boxed (out after 1.5-4 s hidden or 10 s, then fights `aiPeek` 2.5 s before it
may hide again). Arm lead 0.12 s (the player's lockLead). The damage board tags each weapon's work by wrapping the
arsenals' rail/shells/rockets/shoulder steps and the battlefield's shell update (lab-only glue in `labs/duel/main.ts`).

Known rough edges: rolled rails (900+ a slug) make short rounds; the rival's minigun rounds have no penetration sheet
(like bandit mechs); the rival doesn't target the pilot on foot; rivalAi's view `sees` reads the height function (dunes
and drifts) plus wreck height, not the wreck meshes.

## How to test

- Lab: `labs/duel/?rival=3`, `?rival=7&left=rail&right=minigun`, `?rivalfit=mountL:rail-medium:epic,pack:sh-mortar`,
  `?flat`, `?manual`, `?zoom=60`.
- Check: `npx tsx tools/duel-check.ts`.
