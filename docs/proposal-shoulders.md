# Proposal: shoulder mounts on every mech, with three kinds of shoulder gear (not built; waiting for Keith)

Keith 2026-10-30: a hull gun takes away that side's shoulder, so the convoy's default mech (a minigun on each hull
mount) has no keyed weapons at all. Shoulder weapons are the powerful, keyed moments (rockets, bombards). He'd like
shoulder mounts you can always fit, with abilities on them, or feeds that feed that side's weapon better, or more
energy.

## Today

- Each hull mount holds a hull gun **or** an arm. Only an arm brings a held weapon and a shoulder slot (keys 1 and 2).
- The pack mount takes a power pack or a back weapon (key 3).
- The waist mounts take ammo drums, which already feed their own side's gun.

## The change

**Shoulder slots no longer depend on arms.**
- The hull carries two shoulder hardpoints (left and right), on keys 1 and 2, whatever is on its hull mounts. With a
  hull gun under it, the shoulder sits on the hull top above the gun; with an arm, on the arm as today.
- Later, the hull item decides how many it has (a light hull one, a heavy hull two and a bigger size).

**Three families of shoulder gear.** Every one has a key, so nothing is a pure stat stick (the old project's rule:
passive gear also carries a weaker active).

| Family | Examples | Passive | Key (1 / 2) |
| --- | --- | --- | --- |
| **Launchers** (today's) | rocket, missile pod, big mortar, line mortar; later a bombard, smoke, flares | none | the ability: paint, release, fire |
| **Feeds** | belt feed, linked hopper, coolant loop, rail capacitor | that side's gun: fire rate, no reload or bigger belt, less heat or spin-up, faster rail charge | **Overdrive**: that gun runs hot for a few seconds (e.g. +60% fire rate for 4 s, 20 s cooldown) |
| **Power** | capacitor bank, reactor spur | an extra energy bar or faster refill | **Discharge**: refill a bar at once, or a short shield pulse |

- Feeds tie into the "bullet hose" build and power into the "energy" build in the passive tree
  (`docs/proposal-progression.md`); launchers into AoE builds.
- Feeds overlap with the waist drums (which already feed a side's gun). Suggestion: the waist keeps cheap, small,
  passive kit (drums, cargo), the shoulder takes the big feed with the overdrive key. The two stack.
- Shoulder gear adds mass like anything else (soft costs, `docs/proposal-progression.md`).

## The convoy's default mech

Miniguns on both hull mounts, a **missile pod** on the left shoulder (key 1) and a **belt feed** on the right
(key 2: overdrive the right minigun). So a fresh player has a keyed weapon and a keyed boost from the start.

## Files

- `src/items/loadout.ts`: shoulder slots exist whatever the mount holds; the fit rule loses the arm check; resolve
  feeds and power into the same values as drums and packs.
- `src/items/bases.ts`: `kind: "shoulder"` grows a `family` (`launcher | feed | power`) and the feed and power bases.
- `src/weapons/arsenal.ts`: keys 1 and 2 on a feed or power item trigger the overdrive or discharge instead of a
  paint.
- `src/weapons/mounts.ts`: a shoulder socket on the hull top for a side with a hull gun; stand-in models for feeds
  (a belt box with a chute to the gun) and power (a capacitor block with cables).
- Checks: loadout-check (a shoulder fits over a hull gun; feeds only boost their own side; old saves still load),
  weapons-check (overdrive raises fire rate for its time, then cools down).

## Questions for Keith

1. **Two shoulders on every hull** for now, or should the hull decide the count already?
2. **A key on feeds and power** (overdrive, discharge), or purely passive?
3. **Default mech:** missile pod plus belt feed, or two launchers?
