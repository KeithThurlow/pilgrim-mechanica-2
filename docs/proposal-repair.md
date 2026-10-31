# Proposal: health HUD, repair kits, a second consumable, heal zones

Keith 2026-10-31: "more UI around health for the player", a repair kit on Q that doesn't refill by itself, maybe an
"energy potion" (unsure what it refills), and timed abilities on some hulls or packs that put down heal or regen
zones, with co-op healing in mind. This is the outline (rule 9); nothing is built yet.

## Where things stand today

- The mech's hull is a world-space bar over the mech (`src/ui/healthBars.ts`, from `MechUnit.bars`). Nothing on the
  screen itself. The pilot on foot has a small bar in `pilotHud.ts`.
- Nothing heals. Hull damage doesn't carry between runs yet (economy answers).
- Energy bars at the left edge (`energyBar.ts`) power dash, sprint and the capacitor bank's discharge, and recharge.
- **Q is taken:** hold Q 1.5 s calls recovery in the convoy lab (`recallHold`).
- Keys: 1-2 shoulders, 3 the pack mount (back weapon), 4 kept for drones, E salvage / terminal, R reload, F hop out.

## 1. Health HUD (`src/ui/vitalsHud.ts`, one job: draws a `Vitals` view)

- **A hull bar on the screen**, bottom left, wide (about 260 px), with the number (`3120 / 3600`) and the armour
  value as a small shield icon. The energy bars stay at the left edge above it, so all your vitals sit in one corner.
- **Damage ghost:** a pale chunk shows what the last hits took, then drains away after 0.4 s, so big hits read.
- **Hurt edge:** a red vignette that pulses on a hit (by hit size) and stays faintly on below 30% hull, with a low
  procedural warning tone below 20% (synth recipe, no files).
- **Hit direction:** a short red arc on a ring round the mech's screen spot pointing at where the hit came from
  (fades in 0.8 s). Useful once swarms surround you.
- **Kit slots:** the repair kit icon and count beside the bar, greyed while it can't be used, a fill while it works.
- **Ability slot(s)** next to that: icon, key, cooldown sweep.
- On foot the same bar shows the pilot's health (pilotHud's bar moves into it); the mech's hull shrinks to a small
  second bar under it, so you see your ride is being hit while you're out.
- **Co-op, later:** allies' names and hull bars stacked small above yours. The view takes a list so this is free.

Sliders ("Health HUD" topic): ghost delay and drain, vignette strength, low-hull threshold, warning threshold,
hit-arc time. Registered with hold-V as "health HUD".

## 2. Repair kit (`src/items/consumables.ts` pure, plus the use rule in `src/game/repair.ts`)

- **Tap Q:** repairs **35% of max hull over 2 s** (a fast tick, not instant, so it reads and can be out-damaged).
  Can't use at full hull (no wasted kit), not while destroyed, 1 s lockout between kits. Sparks and a green weld
  shimmer on the hull while it works; a ratchet-and-hiss sound.
- **Never refills by itself.** You carry up to **3** (slider; a convoy unlock to 4 and 5 later).
- **Getting more:** bought at a bay terminal for scrap (40 each, slider), and found sometimes when stripping
  salvage (wrecks more than scrap piles). A kit in the field is at risk like loot? I'd say no: kits you carry out
  are spent or kept, so the shop isn't a trap. Your call if you want them lost with the mech.
- **On foot:** hold Q beside your mech to patch it by hand with a kit (slower, 4 s, but the same amount). In co-op
  that's also how you'd help a friend's kneeling mech.
- **Q clash with recall:** I'd move recovery to **hold X** (free today) and give Q to the kit, since you'll press the
  kit far more often, mid-fight. The other way is tap Q = kit, hold Q = recall, but then the kit has to wait for
  the key to come up before it knows, which feels laggy when you're panicking. I'll go with hold X unless you say.

Multiplayer habits: `useKit` is a command, `repairStarted` / `repaired` are events, hull and kit counts are owned by
the host.

## 3. The second consumable: what should it refill?

Options, my pick first:

1. **Power cell: energy and ability charge.** Fills every energy bar at once and takes 50% off the cooldown of your
   ability. Energy already gates dash, sprint and the capacitor; a cell turns "I'm out of dashes in a swarm" into a
   choice. Fits the "potion" feel best and needs nothing new. Key: tap Z (next to X). Carry 2.
2. **Fuel canister.** Adds 25% of the tank. Fuel is what decides how far you range from the convoy, so this plays
   straight into the core loop (stay out longer). Less of a combat button, more a planning one.
3. **Coolant / ammo cell.** Refills both magazines at once and clears weapon heat. Overlaps R reload a lot.
4. **Shield cell.** A 6 s overshield (25% of hull) on top. Strong, but it's a second health potion in a coat.

If it's the power cell, energy bars stay on natural recharge as now; the cell is the burst.

## 4. Timed abilities and heal zones (`src/abilities/`)

An item can carry one **ability** (`Base.ability`, a new optional field on hulls and packs). Pack abilities go on
**key 3** (the pack mount's own key, like a back weapon); hull abilities on **key 4** (drones can come from a pack
later). A loadout can have both.

Files: `ability.ts` (pure: cooldowns, charges, takes `useAbility` commands), `zones.ts` (pure: a list of zones with
id, owner, position, radius, rate, end time; each tick heals everyone inside through a health adapter, the same way
`armour.ts` reaches targets), `zonesDraw.ts` (a ground ring and rising motes, `Math.random` only here).

First three, so there's something for each slot:

| Ability | On | What it does | Starting values |
| --- | --- | --- | --- |
| **Repair beacon** | Medic pack (new pack, a bit less power than the stand-in) | Throw a beacon (aimed at the cursor, up to 20 m); an 8 m zone repairs **2% max hull per s** for 10 s to every friendly mech and pilot inside | cooldown 30 s |
| **Nanite field** | Salvager hull | A 6 m zone round you that follows the mech for 6 s: **3% per s** to you and allies inside | cooldown 25 s |
| **Field weld** | Siege hull | Plant and brace: 4 s rooted, takes 40% less damage and repairs **5% per s** | cooldown 35 s |

- **Solo still works, co-op is better:** abilities heal you at a self share (slider, 60% to start) and allies at
  full, so a medic loadout is worth running alone but shines with friends. Zones stack up to 2 (slider), so two
  healers don't make you immortal.
- Zones also repair convoy turrets and escorts parked in them later, so a healer has a job during raids.
- Everything is a slider in an "Abilities" topic, one group per ability; zones register with hold-V.

## 5. Lab and checks

- **`labs/repair/`**: your mech on the range with a "chipper" turret that hits it at a set damage per second (slider),
  kits in hand, both abilities fitted. Flags: `?hurt=0.4` (start at 40% hull), `?kits=N`, `?ability=beacon|nanite|weld`,
  `?ally` (a parked friendly mech at 15% hull, to heal), `?onfoot`.
- **`tools/repair-check.ts`**: never heals past max; no kit used at full hull or while destroyed; no hull rises with no
  kit or zone (nothing regens by itself); a zone heals nobody outside its radius or after it ends; stacking cap holds;
  the same commands and seed give the same hull over time.
- The HUD then goes into the combat labs and the convoy lab via `combatLab.ts` and the convoy's HUD wiring.

## Order of work

1. Health HUD (no new rules, useful at once). 2. Repair kit on Q, the X recall move, kit shop line and salvage drops.
3. The second consumable once you pick. 4. Abilities and zones, with the repair lab first.

Overlap: the hull and stilt-leg thread is changing hull looks and the protocols thread is in `protocols.ts`. This
adds one optional field to `bases.ts` and one new pack; no model work.

## Questions for Keith

1. Second consumable: power cell (my pick), fuel canister, coolant, or shield?
2. OK to move recall from hold Q to hold X?
3. Kits bought with scrap (40) and found in salvage, carry 3, kept if the mech is lost. Right?
4. Abilities heal you at 60% and allies at full: does that split sound right for solo play?

## Answers (Keith 2026-10-31) and what was built

- Second consumable: skipped for now. Recall: moved to hold X. Kit, HUD and zones: build them, pick defaults, ask later.
- Built as above, with the defaults listed. Not built yet: hold-V on the HUD itself (it's DOM, not in the 3D pick), the
  kit's weld shimmer on the hull model, zones healing convoy turrets and escorts, co-op ally bars.
