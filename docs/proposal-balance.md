# Proposal: balance (level-1 baseline, armour, modifiers)

Keith 2026-10-30: "start looking at balance. Start with a baseline set of items, all level one. Establish how to balance
damage versus velocity versus AoE versus the ability for things to split, the kinds of modifiers they can receive, and
anything else you can think of." And: armour must matter (low-damage, low-penetration weapons worth less against
armoured targets, high-penetration ones worth more).

**Status: proposal. No live value has changed** (rule 9). The tool `tools/balance-sheet.ts` measures today's values and
the proposal's side by side:

```
npx tsx tools/balance-sheet.ts             today
npx tsx tools/balance-sheet.ts --proposed  the values below
npx tsx tools/balance-sheet.ts --check     exit 1 if a weapon is over 130% of its budget (not in npm test yet)
```

It reads the live tables (`src/items/bases.ts`, `src/weapons/tuning.ts`, `src/mech/upper.ts`, `src/game/mechUnit.ts`,
`src/combat/robots.ts`, `warband.ts`, `partyBus.ts`, `infantry.ts`, `src/game/sheet.ts`, `src/game/shots.ts`,
`src/items/protocols.ts`, `generate.ts`, `level.ts`, `power.ts`), so after any change, rerun it. It is a model, not the
sim: hit chance and area are expected values from simple geometry (seeded Monte Carlo), and every assumption is in its
`REF` block and target table.

## 1. Audit: level 1, Common, middle rolls (today)

| Item | Slot | Dmg × per volley | Cycle (s) | Latency (s) | Raw DPS = card | Area (m) | Pen (m) | Speed | Range |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Light minigun | L | 6 | 0.05 (20/s) | spin 0.5 | 120 | splash 1.6 @50% (swarms) | 0.3 | hitscan, 4° | 38 |
| Minigun | M | 9 | 0.06 (16/s) | spin 0.8 | 144 | splash 1.6 @50% | 1.0 | hitscan, 3° | 45 |
| Heavy minigun | H | 14 | 0.045 (22/s) | spin 1.4 | 308 | splash 1.6 @50% | 2.0 | hitscan, 2.4° | 55 |
| Light rail | L | 495 | 0.49 + 1.2 | charge 0.49 | 293 | - | 6 | instant, no assist | 76 |
| Rail cannon | M | 900 | 0.7 + 1.2 | charge 0.7 | 474 | - | 10 | instant, no assist | 90 |
| Autocannon | M | 55 | 0.31 (3.2/s) | spin 0.15 | 176 | splash 1.8 @60% | 1.5 | 75 m/s | 70 |
| Rocket launcher | M | 380 | 2.2 | - | 173 | blast 4.5 | - | 55 m/s | 70 |
| Shoulder rocket | key | 380 | 4 + paint | paint | 95 | blast 4.5 | - | 55 m/s | 70 |
| Missile pod | key | 10 × 90 | 8 + paint | ~1.4 | 113 | blast 2.2 ×10, homing | - | 40 m/s | 70 |
| Big mortar | key | 650 | 10 + paint | 3 s flight | 65 | blast 7 | - | 3 s lob | 90 |
| Line mortar | key | 10 × 140 | 6 + paint | ~1.6 | 233 | blast 2.6 ×10 along 25 m | - | 34 m/s | 70 |

Feeds and power (shoulders): belt feed +12% rate, 25% quicker spin-up, Overdrive +60% for 4 s every 20 s (≈ ×1.25 on its
gun); incendiary feed +5% rate, +15% rounds, ignited rounds 6 s every 18 s, burn 14/s for 3 s (≈ +7 dps on a focused
target, ×1.1); capacitor bank: energy only (dash), no damage yet. **No weapon uses energy yet**; the minigun's limit is
ammo (1200 rounds: 75 s of fire on the Medium, 55 s on the Heavy); nothing has heat or reload.

Rarity: 0-4 Protocol sockets; rolls widen ±50% of the Common width per tier and lift +15% of it (+1.5% damage per tier
for a 10% spread): **the sockets are rarity's power**, not the rolls. Level: +4% per level on damage and hull, +2% on
fire rate (×2.5 DPS at level 21, ×7.3 at 60). Only miniguns take behaviour Protocols; rails, autocannon and launchers
have none that fit.

Enemies (hp; there is **no armour today**, only part shares and pen costs): scrapper 12 (bites 2/s each, 24 can latch),
bandit 12, cutter 90 (round splash ×0.35), excavator 500 (legs ×0.5, feet ×0.3, blasts ×0.5, round splash ×0),
technical 140, gun truck 380, six-wheeler 650, War Rig 1400, turret truck 1100, party bus 2600, bandit mech 650 (deals
×0.2), rival mech = its rolled hull (Rampart 1500, Siege 2100, Salvager 1200), player hull 1500. Depth raises **counts**
(camps ×2.5 at 2 km), never hp.

Item card (`src/items/power.ts`): power = mean stat ratio to the base ×100; DPS = damage × rate (× split × rate
Protocols) or damage × per volley / cycle. It ignores area, hit chance, penetration, burn and armour, so it ranks the
rail first (474) and the big mortar last (65).

## 2. Today's matrix (effective DPS, % of slot budget)

Budget 150 eDPS per mount (Light 0.9, Heavy 1.9, shoulder 0.5); the swarm set counts double (see 3).

| Item | Swarm (36 at 0.2/m²) | Cutter | Excavator | Raider technical | Rival @35 m | Best | Off-role mean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Light minigun | 169 [63] | 101 [75] | 107 [79] | 110 [81] | 117 [86] | rival | 74% |
| Minigun | 357 [119] | 114 [76] | 125 [83] | 127 [85] | 140 [93] | swarm | 84% |
| Heavy minigun | 953 [167] | 217 [76] | 255 [90] | 250 [88] | 292 [102] | swarm | 89% |
| Light rail | 36 [13] | 237 [175] | 230 [171] | 199 [148] | 199 [148] | cutter | 120% |
| **Rail cannon** | 32 [11] | 383 **[255]** | 372 **[248]** | 322 **[215]** | 322 **[215]** | cutter | 172% |
| Autocannon | 239 [80] | 161 [107] | 161 [107] | 46 [31] | 120 [80] | cutter | 74% |
| Rocket launcher | 86 [29] | 171 [114] | 86 [58] | 88 [58] | 144 [96] | cutter | 60% |
| Missile pod | 51 [34] | 93 [125] | 53 [70] | 67 [90] | 92 [122] | cutter | 79% |
| **Big mortar** | 41 [27] | 45 [60] | 28 [38] | 3 [4] | 12 [16] | cutter | 21% |
| Line mortar | 30 [20] | 52 [69] | 37 [49] | 12 [16] | 30 [40] | cutter | 31% |

- **Over:** the rail cannon (2.1-2.6× budget everywhere but swarms; two slugs kill a 1500-hull mech), the light rail
  (~1.5-1.75×), the Heavy minigun against swarms (1.7×).
- **Under:** the big mortar (3 s lob misses anything moving; its point is the alpha on a static camp), the line mortar,
  rockets against the excavator (its blast ×0.5).
- **Flat:** miniguns are 75-95% against everything: with no armour nothing punishes many small hits, so there are no
  roles yet, only bigger and smaller numbers.
- **Enemies are paper:** two Medium miniguns kill a cutter in 0.7 s, an excavator in 2.3 s, a rival mech in 5.6 s.

## 3. The framework

**Effective DPS** = raw DPS × hit share × targets per volley × (1 − armour loss) × uptime.

- **Raw DPS:** damage × per volley / cycle (cycle = 1/rate, charge + cooldown, or cooldown + paint).
- **Hit share** (single targets): hitscan by the spread cone against the target's width plus the sheet's half-width;
  projectiles by the lead error σ = target speed × flight time × juke (how unpredictably it moves: robots 0.25-0.35,
  vehicles 0.5, a rival mech 0.6; missiles home, ×0.3), then the blast's falloff (full at the part, half at the edge).
  No-assist weapons (the rail) × 0.85 aim skill, ×0.8 more against a juking mech.
- **Targets per volley** (swarms): penetration walks bodies along the line (each costs its chord × density, damage kept
  by budget left ^0.5); splash and blasts integrate over the ring at the swarm's density, each unit capped at its hp
  (overkill is wasted); chains and ricochets add their kept share.
- **Armour** (proposed, Keith's call): see 4.
- **Uptime:** spin-up or charge is paid once per engagement (swarm 8 s, cutter 4, excavator 12, technical 6, rival 25).

**Reference target sets** (the tool's `targets()`): a scrapper swarm (36 at 0.2/m², 25 m), a lone cutter (22 m), an
excavator (30 m), a raider technical (15 m/s circling, 28 m), a rival mech (6 m/s, juking, 35 m).

**Budget and roles.** One budget per mount at level 1 (150 eDPS), shares by slot (Light 0.9, Medium 1, Heavy 1.9 across
both mounts, a shoulder launcher 0.5 on top). The swarm set counts double: an area weapon should take about twice the hp
per second out of a camp-density swarm that a single-target gun takes out of one body. **Rule (solo-first):** each
weapon is ~100% (90-130%) against its best set and 50-70% on average elsewhere; nothing below ~15% against a set it can
reach. `--check` fails anything over 130%.

**Roles (proposed):**

| Weapon | Best at | Weak at |
| --- | --- | --- |
| Miniguns | swarms, infantry, light vehicles | armour (excavator, turret truck, mechs) |
| Heavy minigun | swarms, still fine at everything (two mounts' worth) | heavy armour |
| Rail cannons | armour and big single targets, lines of them | swarms (overkill) |
| Autocannon | cutters and armour at mid range | fast vehicles (75 m/s shells) |
| Rockets (hull, shoulder) | cutters, mechs, groups | fast vehicles |
| Missile pod | spread groups, anything that moves (homing) | heavy armour |
| Big mortar | static and slow targets, camps (alpha: one shell can clear a camp) | anything moving |
| Line mortar | lines and columns, slow heavies | fast movers |

## 4. Armour (Keith 2026-10-30)

**Flat armour per hit, cut by armour pierce, with a floor:**

```
damage taken = max(0.15 × d, d − A × (1 − ap))
```

`A` is the target's (or the hit part's) armour, `ap` the weapon's armour pierce (0-1). Many small hits lose most of their
damage; big hits barely notice. Pierce is a separate stat from the sheet's penetration budget (that one is "how many
bodies does the shot pass through", in metres; pierce is "how much of each body's armour it ignores"): they correlate
(rails high in both) but a shotgun-like split could have penetration without pierce, an AP round pierce without
penetration. Blasts take armour per target on the share that reaches it. Burn ignores armour (Claude's call: it is the
anti-armour answer for small guns, so keep it per-second, not per-hit).

Proposed armour: scrapper 0, bandit 0, cutter 3, **excavator 8** (body; the part shares stay), technical 2, gun truck 4,
six-wheeler 6, War Rig 8, turret truck 12, party bus 5, bandit mech 6, rival mechs 8 (the player's hull the same),
rival tanks later 16. Hit zones: the robots already split body, legs and feet; vehicles and mechs have part hitboxes
(convoy turrets, cars) that could carry their own armour later (a mech's back lighter, a truck's cab heavier).

Proposed pierce: light minigun 0, minigun 0.1, heavy minigun 0.25, autocannon 0.5, rockets 0.6, missiles 0.3, mortars
0.3-0.4, light rail 0.8, rail 0.9.

Today's weapons against an excavator by its armour (damage per hit kept, eDPS; ap 0 everywhere as today):

| Weapon | A 0 | A 6 | A 12 | A 20 |
| --- | --- | --- | --- | --- |
| Minigun (9) | 100% 125 | 28% 35 | 15% 19 | 15% 19 |
| Heavy minigun (14) | 100% 255 | 54% 137 | 15% 38 | 15% 38 |
| Rail (900) | 100% 372 | 99% 370 | 99% 367 | 98% 363 |
| Autocannon (55) | 100% 161 | 88% 142 | 76% 123 | 61% 98 |
| Rocket (380 × blast 0.5) | 100% 86 | 97% 84 | 94% 81 | 89% 77 |
| Missiles (90) | 100% 53 | 87% 46 | 73% 38 | 56% 29 |

**AP rounds from a feed later** (+0.5 pierce while loaded): on the proposed Medium minigun against armour 8 ×2.0, against
a rival ×1.8, nothing against swarms. Price an AP feed's key like the incendiary's (a 6 s window on ~18 s).

## 5. Exchange rates (from the tool)

- **Velocity** (expected % of a shell's damage on a juking mech at 35 m):

  | Blast \ speed | 20 | 40 | 55 | 75 | 120 | instant |
  | --- | --- | --- | --- | --- | --- | --- |
  | direct hit only | 6% | 20% | 33% | 52% | 80% | 100% |
  | 2 m | 11% | 40% | 59% | 78% | 94% | 100% |
  | 4.5 m | 29% | 68% | 83% | 92% | 98% | 100% |
  | 7 m | 46% | 82% | 90% | 95% | 99% | 100% |

  Rule: blast radius buys back what speed loses against movers; a slow shell needs ~2× the blast to hold its share.
  Against swarms and static targets speed is free, so slow shells must trade for area or damage, not be cheap.
- **Area:** at camp density each +1 m of blast radius from 2 to 4 m roughly doubles the units a volley reaches; it is
  worth nothing against a single body. Wide bore (×1.6 splash for −15% range) is worth ×1.39 against swarms: it needs a
  damage price (−12%).
- **Split:** N rounds at k damage are worth N·k against a swarm and k against one body (the 6° fan puts one round on a
  mech at 35 m). Price: k = 1.3/N (splitter 3 rounds at 0.43: ×1.3 swarm, ×0.43 single, and lower still against armour).
- **Rate:** ×r rounds at k damage are worth r·k unarmoured, much less armoured (each smaller hit loses more to armour),
  and burn ammo r× faster. Price k ≈ 1.2/r (overclock ×2 at 0.6), and armour does the rest.
- **Damage up** (overpressure) is worth more the more armour there is (×1.25 damage is ×1.6 against a rival mech).
- **Penetration:** worth nothing against one body, a share of a body per extra metre against a line; armour pierce is
  where penetration-like stats should pay against heavies.

## 6. Modifiers: Protocols, feeds, rarity, level

- **Price every Protocol against the budget:** its best-case set gain is at most +25% per socket, and it leaves no set
  below 0.5× (armour may take a split or rate Protocol lower: that is the trade). Proposed prices: splitter 0.5 → 0.43,
  overclock 0.7 → 0.6, arc link 0.8 → 0.75, ricochet 0.9 → 0.95, overpressure 1.35 → 1.25, wide bore −12% damage.
- **Stacking: gains add, they don't multiply.** Today a legendary minigun with splitter, overclock, arc link and
  ricochet is ×2.2 against swarms (and the stress lab's `?proto=` stand-ins more); with additive stacking it would be
  ×(1 + Σ gains). Mechanism: the item's per-round damage gets one normalising factor (1 + Σ g_i) / Π(1 + g_i), where
  g_i is each Protocol's swarm gain from the table; children of a ricochet or chain never split or chain again
  (`protoMaxGen` 4 → 2). Cap: a full legendary at most ×2 its plain value against its best set.
- **Feeds** are priced as a share of their side's gun: ≤ +25% on average (belt feed is exactly there; incendiary ~+10%
  on focused targets, nothing on swarms: it could take a little more).
- **Rarity** stays: sockets are the power, rolls are wilder. A legendary with four full sockets reaches ×2 its plain
  value against its best set, not more.
- **Level: one power curve for both sides.** P(n) = 1 + 0.075(n − 1) on an item's DPS (damage only, so rate and feel
  don't change with level) and hull; enemies at an area level (the drop level there: 1 + depth/100 m) get P(n) on hp and
  damage. Then time-to-kill holds at level, out-gearing an area shortens it, and depth's "harder" stays the counts
  (camps ×2.5 at 2 km). Today's level curve is close by accident to 2 km (item DPS ×2.5, pack hp ×2.5), then items run
  away (×7.3 DPS at 60 against ×3.25 counts, and the player's hull ×3.4 against unscaled enemy damage).

## 7. Time-to-kill targets (level 1, at level; two weapons on the mounts)

| Enemy | Target | Why | Proposed values give |
| --- | --- | --- | --- |
| Scrapper, bandit | one hit of most guns | they are the horde; misses and overkill are the cost | minigun 12 dmg one-shots; light 9 two |
| Scrapper pack (36) | 2-5 s for a swarm loadout | camps feel like mowing | mg+mg 1.4 s in the model (optimistic: real packs spread) |
| Cutter | 1-2 s focused | the "pick it out of the crowd" target | mg+mg 1.4 s, mixed pairs 0.3-0.6 s |
| Excavator | 8-12 s on-role, ~20 s off-role | a boss of the field: you either brought the answer or you work | rail+ac 5.8, ac+rpg 7.4, mg+rail 8.1, mg+mg 19.6 |
| Technical | ~1 s | fast and fragile: hitting it is the challenge | 0.4-0.9 s |
| Turret truck | 5-10 s on-role | the war band's heavy | 5-10 s; mg+mg 26 s |
| Rival mech | 12-20 s | a duel inside a fight, long enough for dashes and cover to matter | 11-14 s on-role, 26 s mg+mg |
| Player mech | a camp pack kills a standing mech in 20-40 s; a rival in 15-25 s | time to read, dash, get out | 36 s (24 scrappers latched), rival 13 s today → ~26 s with mechs taking ×0.5 from mechs |

## 8. Proposed level-1 values (current → proposed)

| Value | Today | Proposed | Why |
| --- | --- | --- | --- |
| Light minigun damage × rate | 6 × 20 | 9 × 15 (ap 0) | one-shot nearly; fewer, bigger rounds |
| Minigun damage × rate | 9 × 16 | 12 × 12 (ap 0.1) | one-shots a scrapper, same raw DPS (144) |
| Heavy minigun damage × rate | 14 × 22 | 20 × 14 (ap 0.25) | 280 raw: within budget against swarms, keeps a bite on armour |
| Light rail damage | 495 | 300 (ap 0.8) | 175% → ~105% |
| Rail cannon damage | 900 | 450 (ap 0.9) | 255% → ~125%; a rival takes ~7 slugs |
| Autocannon damage | 55 | 50 (ap 0.5) | anti-cutter/armour brawler |
| Rocket (hull, shoulder) damage | 380 | 300 (ap 0.6) | ~90% vs cutters, ~75% vs mechs |
| Missile damage | 90 | 60 (ap 0.3) | 125% → 80% |
| Big mortar cooldown | 10 | 8 | the alpha weapon: more often |
| Line mortar cooldown, blast | 6, 2.6 | 4, 3.2 | 30% → ~60-115% |
| Cutter hp, armour | 90, 0 | 220, 3 | 1-2 s focused |
| Excavator hp, armour, blast share | 500, 0, 0.5 | 1800, 8, 0.8 | 8-12 s on-role; rockets count again |
| Mech-on-mech damage | ×1 (bandit mechs deal ×0.2) | ×0.5 for every mech's weapons on a mech | rival 12-20 s without retuning hulls or robots |
| Bandit mech hull | 650 | 900 | with ×0.5: ~1800 effective |
| Vehicle armour | none | technical 2, truck 4, six 6, rig 8, turret truck 12, bus 5 | |
| Protocol prices | see 6 | see 6 | ≤ +25% per socket, additive stacking |
| Level curve | +4% dmg, +2% rate per level | P(n) = 1 + 0.075(n − 1) on damage and hull; enemy hp and damage by area level | |

The tool's `--proposed` prints all of this; `P_WEAPON`, `P_TARGET` and `P_PROTO` in it are the table above.

## 9. Also worth balancing (not modelled yet)

- **Energy:** weapons don't spend it; the capacitor bank only feeds the dash. Energy weapons (laser, plasma) should
  spend bars per shot, and the rail could (Keith's direction in the old project: energy as mana).
- **Ammo** is the minigun's only limit (75 s of fire per trip): rate Protocols spend it twice as fast; that is a real
  cost the item card should show (seconds of fire).
- **Mass:** items have weight and legs carry 12 t; nothing else pays for it. A soft cost (slower speed-up and turning
  above, say, 80% of carry) would price heavy weapons.
- **Salvage heat vs loot:** louder weapons (mortar, rail) could add heat that draws packs, a cost for the alpha weapons.
- **Burn** ignores armour (proposed) and doesn't stack; fine as the small guns' answer to armour.
- **Friendly fire:** none, kept.
- **A column target set** (a war band on the move, a charging line) for the line mortar and rails, which the five sets
  don't reward.
- **The item card's number** should become the rated eDPS against the item's best set (or a small row of five), from
  the same model, so the card and the balance agree.

## Questions for Keith

1. Armour as above (flat per hit, pierce, floor 15%)? Excavator 8 and rival mechs 8 about right, or heavier?
2. Mechs take ×0.5 from mech weapons (rivals ~15 s, the player lasts as long against them), or raise every hull?
3. TTK targets: rival 12-20 s and excavator 8-12 s on-role, ~20 s off-role?
4. Additive Protocol stacking with a ×2 cap for a full legendary?
5. One level curve shared with enemy hp and damage by depth, with depth still adding counts?
6. Should the item card show the rated eDPS (from this model) instead of raw damage × rate?

## Answers (Keith 2026-10-31)

- **Protocols are multipliers, PoE2 style, and they stack multiplicatively.** Each one is worth roughly ×1.2-1.3 in
  its niche, with a downside. Example: split shot on rockets gives three rockets at 0.4 each, about ×1.2 total
  damage (more against crowds, less against one target). Fork and chain work the same way: a modest total gain plus
  a downside. **No ×2 cap: runaway builds are part of the fun**; players find broken builds and we balance later if
  needed. (This replaces section 6's additive stacking and cap.)
- **Cost is the main downside, by weapon type:**
  - **Munitions** (guns, launchers) have a magazine and a reload. A Protocol that adds shots (split, more rate)
    uses the magazine faster, so you reach the reload sooner. Some Protocols reduce cost (fewer rounds per shot).
    Reload speed becomes a stat players can build around: a Protocol, gear or a tree node.
  - **Energy weapons** (lasers and the like, later) draw from an energy meter; Protocols raise or lower the draw.
  - (Keith 2026-10-27's "no munitions resource" stays: no ammo to carry or buy, only magazines and reloads.)
- **Item DPS previews:** an item shows its base DPS, and its DPS with its Protocols. The player judges sockets and
  potential themselves.
- **Mech on mech:** Keith takes Claude's recommendation: raise every hull rather than a ×0.5 rule for mech weapons,
  so one rule covers every attacker.
- **Kill times** of 12-20 s are fine **only with enemy health bars**, so the player sees progress. Health bars come
  with this pass.
- Not answered, so the proposal stands: the armour model (excavator armour 10, Claude's lean, rather than 8), the
  one shared level curve.
