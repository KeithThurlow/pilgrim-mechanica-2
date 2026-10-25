# Proposal: weapons and how each one targets (not built; waiting for Keith)

Keith 2026-10-25:
- Start adding weapon options. The sister project had many, but only the hull miniguns looked, felt and performed
  right ("they felt powerful, they felt good").
- He likes the idea of a rocket launcher that fires a line of rockets, but it "just straight up didn't really work"
  there. It should work, with ground targeting.
- Each weapon gets its own targeting:
  - some rely on AoE, ground targeting and prediction;
  - some auto-target, as the miniguns should, leading what they lock.
- From 2026-10-24: back rockets and mortars should paint the ground like a military targeting laser, perhaps from
  the mech itself; mortars can go over hills.

## Why the old ones didn't work (my read of the sister project)

- **One input for everything:**
  - Skills fired on a key press at the cursor, with no preview by default.
  - A line rocket could only go where the cursor already was. Nothing showed where it would land or that it was
    coming.
- **Projectiles with no help:** rockets flew straight with no lead and no assist, against small, fast targets on a
  high camera. They mostly missed.
- **Weak feedback:** small blasts, no shake, no ground mark, so a hit didn't read as one.

The miniguns worked because they are the opposite. They assist (soft lock), never stop, show every round, and the
impacts are big.

## The fix: each weapon class has one targeting mode, with its own preview

| Mode | Input | Preview | Help | Weapons |
| --- | --- | --- | --- | --- |
| **Assist** (auto-target) | hold left button | lock brackets on the target | soft lock by the ray rule, lead by velocity (built) | miniguns, autocannon |
| **Line** | hold right button: a laser runs from the mech to the cursor and paints a strip on the sand; release fires | the painted strip, its width and length | the line snaps to cover a locked group if one is close | **line rocket salvo** |
| **Point** (ground AoE) | hold right button: a ring on the ground at the cursor; release fires | ring the size of the blast, plus a dotted arc showing the lob | aim leads the locked target's walk (as the enemy tank does) | mortar, grenade launcher |
| **Skill shot** | hold to charge, release to fire straight along the aim | a thin beam that thickens as it charges | none (that's the point: big damage for good aim) | rail cannon |
| **Auto** | none: the weapon picks its own targets | a faint arc on the ground showing its reach | picks the nearest in its arc | back turret, point defence (later) |

**Buttons:**
- Left button fires the hand and hull guns.
- Right button aims and fires the back weapon, the slow and heavy thing.
- Space is the dash, E salvage.
- Later, keys 1–2 could pick between two back weapons.

The old game's quick-cast has no place here. Every slow weapon previews while held, so firing it is a decision.

## The first new weapons

1. **Line rocket salvo** (back mount), Keith's favourite idea, done properly.
   - Hold right button: a red laser runs from the launcher to the cursor and paints a strip on the sand, about 25 m
     long and 4 m wide (sliders). Release fires 8–12 rockets.
   - They leave in a fast ripple, arc a little, and land one after another walking up the strip. Each one blasts the
     ground at its point, so the whole strip gets hit.
   - The enemies' version: the same strip painted toward you before they fire, so you can dash out of it.
   - Its strength is a line of bandits or a column of vehicles. Long reload or ammo, so it's a decision.
2. **Mortar** (back mount): hold right button for a ring at the cursor and a dotted arc over hills. Release lobs
   3 shells into the ring. Slow and heavy; hits behind dunes where your guns can't see.
3. **Rail cannon** (hand or hull, a skill shot): hold to charge for 1 s, release for a straight beam. It pierces
   everything in the line, throws them back and leaves a glowing trail. No assist. Huge damage.
4. **Autocannon** (hull, assist): slower explosive shells that really fly, so lead matters, with a small splash.
   Between the minigun and the rail cannon.

Each sits in the loadout's slots: Light in a hand, Medium on the hull, back weapons on the power pack's mount.

## What's shared (built once)

- **The blast:** dust, crater, sound, damage through `splash()`, shake by size. It already exists for shells; it gets
  a size and a look per weapon.
- **The painter:** a laser beam from the muzzle plus a strip or ring on the sand, readable from the 40 m camera.
- **Player projectiles that fly:** the shells already exist for enemies; the player gets them too, with lead.
- **Telegraphs for enemies with the same weapons**, so the swarm and the war band can field them later.

## Lab and files

- `labs/weapons/`: a firing range with lines and columns of dummy targets, moving vehicles and a dune to shoot over,
  plus a weapon picker. Every weapon's numbers are sliders.
- Files:
  - `src/weapons/`: one file per weapon's sim (salvo, mortar, rail, autocannon), plus `targeting modes`, `painter`
    (draw) and `blast`.
  - They hook into the loadout's slots once that lands; the loadout is being built in parallel.
- Checks:
  - a salvo covers its strip;
  - mortar shells land in their ring;
  - a rail beam hits everything on its line;
  - lead puts autocannon shells on a crossing target.

## Order

1. The line rocket salvo, the painter and the range lab. It's Keith's favourite and the hardest to get right.
2. Mortar.
3. Rail cannon.
4. Autocannon.

Then each goes into the loadout as an item.

## Questions for Keith

- Is the right button right for back weapons, with left for the guns?
- Should the salvo fire on release, as I'd do it? Or fire at once, with the strip shown only briefly?
- Ammo or cooldowns for the heavy ones? I'd start with cooldowns, which are easier to tune, and keep ammo for later
  if it ties into salvage.
