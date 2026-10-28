# Proposal: making scrap valuable and loot feel good (direction set by Keith 2026-10-28; loot feel being built)

Keith 2026-10-28: "Really lean into making scrap feel valuable, making loot feel good, making scrapping things feel
risky." Risky salvage, depth danger and harder-sooner combat are being built now (`wip/depth`). This covers the
rest: what scrap is for, and how loot arrives and lands.

## 1. What scrap buys (the convoy as the shop)

Scrap only matters if it's spent on things that change the next run. At the convoy (walk-up terminals, or B in labs):

| Sink | What it does | Rough price |
| --- | --- | --- |
| **Repairs** | Hull damage carries over between runs; repair costs scrap | 1 scrap per 10 hull |
| **Convoy upgrades** | Radar range, mech energy bars, refill speed, crane speed, turret count, a second bay | 150–1,500, rising per level |
| **Fabricator** | Build a base part or weapon you've seen (seen = picked up once), at common rarity | 100–600 |
| **Reroll and upgrade** | Reroll an item's stats, add a Protocol socket, raise rarity one step (chance) | 50–800 |
| **Extraction** | The pad fee (from `docs/proposal-extraction.md`) | 60 + 80 per km |

Repairs make scrap matter from the first run. Upgrades and the fabricator give it a goal.

## 2. Loot that feels good

- **Drops in the world:** enemies and stripped spots drop items as well as scrap. Rarity rolls are better with depth
  and with salvage heat.
- **How a drop looks:** a short beam in the rarity's colour, visible from the 40 m camera. The mech walks over it, or
  holds E, to grab it. A pickup chime by rarity. The at-risk list shows it as it comes in.
- **Scrap:** spots burst into clumps that fly to the mech with a ticking count.
- **Banking ceremony:** when the crane grips the mech, the at-risk list is counted into the convoy's bank one line at
  a time, with a sound, so getting home pays off.
- **Losing it:** on a forced recovery or destruction, the list visibly empties ("lost"), so the loss is felt too.

## 3. Order

1. Repairs and the bank (scrap has a use at once), and the banking ceremony.
2. Item drops in the world, with beams and pickup.
3. Convoy upgrades (a few levels each).
4. Fabricator, then reroll and upgrade.

## Questions for Keith

1. **Hull damage carries over between runs** and costs scrap to repair. Yes?
2. **The fabricator:** can it build parts you've seen, or only from blueprints you find?
3. **Pickups:** walk over items, or hold E like salvage? I'd say walk over items and hold E for scrap spots.
4. **Extraction defaults:** I'll take the fee from carried scrap, topped up from the bank; fade to the convoy for now;
   no 20-minute cap for deep runs; depth measured from the road. Change any of these if you disagree.

## Answers (Keith 2026-10-28)

- **Scrap like money:** it ticks up, with satisfying jingles to collect. The banking moment should feel good, and the
  at-risk list visibly empties when it's lost.
- **No hull damage carrying over** for now, so repairs aren't a sink.
- **A fabricator to build things:** yes. Default: parts you've seen.
- **Pickups:** walk over items; hold E for scrap spots.
- **No 20-minute cap:** runs are open-ended. Missions may add conditions later.
- **Depth:** unsure whether from the road or from the convoy ("more dynamic"). Built both ways: the road for what's
  placed in the world, the convoy (right now) for live threats, with a blend slider to try.
