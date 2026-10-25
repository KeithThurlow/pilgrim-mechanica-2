# Proposal: equipping the walker: parts, items, rarity, Protocols, cargo (not built; waiting for Keith)

Keith 2026-10-25:
- Back on the convoy, equip the walker. The sister project's ideas carry over:
  - legs, a hull (the torso), arms;
  - arms that hold weapons, or hull weapons mounted straight on the hull in place of an arm;
  - a power pack, with mounts under it;
  - more equipment later;
  - Protocols, which amend an item the way Path of Exile 2's supports amend a skill. Rarer items get more Protocol
    slots.
- He liked the old concepts but none of the old inventory UI.
- He wants enemy mechs to spawn wearing their real gear. Destroying one lets you pull parts off it: the first pull is
  sure, each later pull less likely. A legendary on an enemy is a high-risk, high-reward target.

## What carries over from the sister project (ideas, not code)

- **Walker parts** (`docs/walker-parts-and-items.md` there):
  - legs: digitigrade, humanoid, stilt, heavy;
  - arms: long arms hold forearm and two-handed guns, short arms hold small arms;
  - torsos: compact, long, tall, turret, cab;
  - add-ons: power pack, back arms, shoulder pods.
- **Weapon sizes decide the mount:** Light goes on a forearm, Medium on the hull (or shoulder), Heavy is two-handed.
  The minigun and rail cannon are Light forearm, Medium hull, Heavy two-handed.
- **Rarity makes wilder baselines:** stronger, but not always better (more damage, slower). Items carry tags, and
  Protocols fit by tag.
- **Targeted salvage** (`docs/idea-targeted-salvage.md` there):
  - Open the hulk and see what's on it, with the next pull's chance shown as a number.
  - The first pull always succeeds; later pulls drop.
  - A failed pull jams the hulk, which still gives scrap.
  - Enemy mechs carry real loadouts, so what you see is what you can pull.

## Already in this repo

- The Rampart on the walker and upper-body sims, with two hull miniguns, back drums and a stand-in power pack.
- **Seven Rampart variants modelled on Keith's PC:** Stilt, Turret, Railgun, Siege, Salvager, Rocket, Wildcat.
  - They share the Rampart's part and joint contract and are picked with `?mech=<id>`.
  - **They aren't pushed yet:** `src/mech/variants.ts` and the models exist on the PC only.
  - Because every variant uses the same joints, their legs, hull and arms can be mixed. That's what makes parts as
    items cheap here: each slot's look comes from whichever variant the item was made by.

## Slots (calling the torso the hull)

| Slot | Takes | What it decides |
| --- | --- | --- |
| Legs | leg items (Rampart, Stilt, Siege legs...) | walk and sprint speed, stride, stomp, turn, how much weight it carries well |
| Hull | hull items | hull points, torso turn, and the **mounts it offers**: two arm mounts, plus a back mount |
| Left / right arm mount | an **arm**, or a **hull weapon** that replaces the arm | an arm holds a hand weapon; a hull weapon aims only where the hull faces (slower, heavier hitting) |
| Left / right hand | a hand weapon (only with an arm there) | Light guns: forearm minigun, rail cannon, autocannon...; a Heavy two-handed gun takes both hands |
| Power pack | power pack items | energy and its regen (for energy weapons and the dash), heat, and the **back mount** under it |
| Back mount | ammo drums, a rocket pod, a mortar, later back arms | extra ammo, or a back weapon |

Weapons keep the old size rule: Light in a hand, Medium as a hull weapon, Heavy two-handed or on the back. Rarer
hulls might later offer more mounts.

## Items

- **Each item has:**
  - a base (Minigun, Rail cannon, Stilt legs, Salvager hull...);
  - a size (L/M/H);
  - a rarity;
  - a few rolled stats in its base's ranges, with rarity widening the ranges both ways;
  - tags;
  - Protocol sockets;
  - a maker (the variant's brand: Suzaku, Stratford-Aegis, Novus-Lux...), which decides its look.
- **Rarity:** Common, Uncommon, Rare, Epic, Legendary. Sockets 0, 1, 2, 3, 4. Each rarity has its own colour on the
  label and a light beam where it drops.
- **Protocols** are items too, socketed into an item at the bay.
  - Here they attach to **items**, not skills, because the guns are auto-fire and there are no skills yet.
  - Each one is a trade-off that changes behaviour. Examples:
    - Overpressure: +35% damage, slower spin-up.
    - Ricochet: rounds that hit steel bounce once.
    - Shredder: pierce +2, less damage on the first hit.
    - Coolant loop: dash recharges faster, less hull.
  - Tags decide what fits: weapon, ballistic, energy, legs, hull.
- **Value:** scrap, the one currency, buys rerolls and repairs. Selling or breaking down items gives scrap.

## Cargo and stash: no grid Tetris

- **Cargo on the mech:** a short list with a capacity in weight. Light items are cheap, legs and hulls heavy, so you
  may stop pulling parts because you're full.
  - Ties into the loop: what's in cargo is at risk until you're back on the convoy.
  - What happens to it when the mech is destroyed is still open.
- **Stash on the convoy:** a big list, filterable by slot and rarity.

## The bay screen (where you equip)

When the mech is parked in a convoy bay (E, already built), the bay screen opens:
- **The mech** in the middle, life-size and live. Click a slot on it, or pick one from a short list down the side.
- **A list** of everything in stash and cargo that fits that slot. Hover an item to see the change against what's
  fitted (speed +0.4, hull −120, damage +18%) and a ghost of it on the mech. Click to fit it.
- **Protocol sockets** show on the item's card; drag a Protocol in. That's the only drag in the whole screen.
- **No grid and no dragging items between bags.** Lists, filters and one click to fit.
- An **Auto-fit best** button per slot can come later.

## Enemy mechs wear their gear

- Bandit mechs roll a real loadout on the same rules: hull, legs, arms or hull weapons, and a power pack.
- Their rarity is the rarest part's. They fight with it, and you can see it: a legendary rail cannon glows on the
  arm.
- **Destroyed, they leave a hulk.** Hold E to open it:
  - It lists what's still attached, each part with a "fits / fits another mount" note, and the next pull's chance.
  - The first pull is sure; later pulls fall off (sliders), and heavier and rarer parts are harder.
  - A failed pull jams the hulk, which can still be stripped for scrap with the existing salvage action.

## Files

- `src/items/` (pure):
  - `item.ts`: the item and its rolled stats;
  - `bases.ts`: the base table, as data;
  - `rarity.ts`;
  - `protocols.ts`;
  - `loadout.ts`: slots, fit rules, and the stats a loadout adds up to;
  - `generate.ts`: seeded rolls;
  - `salvagePull.ts`: pull chances and jamming.
- `src/mech/` reads a loadout. The walker and upper values come from the parts, the guns from the weapons, and the
  model is built from each slot's variant pieces.
- `src/ui/bay.ts`: the bay screen, plain DOM over the canvas in the house style.
- **`labs/loadout/`** first (rule 2):
  - the mech on a bay pad;
  - "Roll loot" buttons by rarity;
  - the bay screen;
  - the mech walking out to a range of targets, so you feel the change.
- After that, wire it into the convoy's parking bays.
- Check `tools/loadout-check.ts`:
  - fit rules: no hand weapon without an arm, a two-hander takes both hands, sockets by rarity;
  - stats add up and are deterministic per seed;
  - pull chances fall and jams stick;
  - every base resolves to a model piece.

## Order

1. Item data, rarity, the generator, fit rules and the loadout lab with the bay screen.
   - Legs and hull from the variants (once they're pushed).
   - Two-handed and hand weapons start as minigun sizes, so the existing gun sim covers them.
2. More weapon bases with their own feel: rail cannon, autocannon, rocket pod on the back. Each is a new gun sim, so
   they come in a few at a time.
3. Into the convoy: parking in a bay opens the bay screen. The stash lives on the convoy, cargo on the mech.
4. Enemy mechs wear rolled gear; hulks and pulls.
5. Protocols: sockets plus a first handful.

## Questions for Keith

1. **Inventory:** OK with lists and a weight capacity instead of a grid? I think it's better here, and it's quick to
   build.
2. **Cargo:** if your mech is destroyed out in the field, what happens to it? Options:
   - all lost;
   - left in your wreck to come back for;
   - kept, if you're not carrying much.
3. **Rarity:** five tiers with sockets 0–4, as above?
4. **Protocols:** on items, not skills, since there are no skills yet. Later, if weapons get active skills, Protocols
   could attach to the skill as in the old design. OK?
5. **The variants on your PC:** can the desktop session commit and push them? Parts-as-items builds on them.
