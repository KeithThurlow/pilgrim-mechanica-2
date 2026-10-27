# Proposal: paid extraction pads, and danger and loot that rise with distance (direction set by Keith 2026-10-27; not built)

Keith 2026-10-27: "Encourage expeditions further and further out... the further out you go, the better the loot, but
the more dangerous it gets... extraction points, kind of like ARC Raiders... helicopter pads that a large quadcopter
can come out and pick people up from... to use these points you have to pay a whole lot of scrap... you can walk all
the way back to your convoy and collect all loot, all gear, or you can keep venturing out, going into more and more
danger, collect more and more scrap, items, protocols... as you progress further out, extraction cost goes up, but
you can still go to these extraction points and essentially pay to return."

## The idea in one line

Walking home is free but slow and limited by fuel. A pad far out is a paid way home. So the deep run becomes a bet:
whether what you're carrying is worth more than the fee and the fight at the pad.

## 1. Distance sets danger and loot

- **Measure it from the convoy's road, not from the convoy.** The convoy moves, but the road is planned ahead and laid
  behind, so "how far from the road" is a fixed property of each place. It's pure and deterministic, so every player
  and the host agree (CLAUDE.md rule 12).
- **Rings** (sliders):

  | Ring | Distance from the road | What's there |
  | --- | --- | --- |
  | Near | 0–400 m | today's mix: tier 1–2 points of interest, small camps |
  | Out | 400–1,000 m | more tier 2, the first tier 3 (Fight), bigger camps, cutters common |
  | Deep | 1,000–2,000 m | tier 3–4 (Expedition), excavators in packs, raids more often, rare items |
  | Far | 2,000 m+ | tier 4–5 (Siege), legendary chances, the worst swarms |

- **Scaling with depth:**
  - Points-of-interest tiers, loot rarity, camp size and robot mix all scale with the ring.
  - The expedition's existing threats (camps, roaming packs, raids) read the ring for their density and pace.
  - The radar's danger heat already estimates this, so the player can see the gradient before going.
- **Fuel is the brake:** going deep on foot and walking back can't be done on starting fuel, which is where the pads
  come in.

## 2. Extraction pads

- **Where:**
  - Pads sit out in the world on their own grid: a helipad, landing lights and a beacon mast.
  - None in the Near ring. They get a little more common further out, so a deep run usually has one within reach.
  - Seeded like points of interest.
  - The convoy radar shows them, and the mech radar shows nearby ones with their price.
- **The fee** is paid in scrap: `fee = padBase + padPerKm × km from the convoy`, measured from where the convoy is now,
  since that's how far the quadcopter flies. So the price rises as you go deeper, and keeps rising as the convoy rolls
  on without you. The HUD shows the nearest pad's distance, price and the time to walk to it.
- **Calling it:**
  1. Stand on the pad and hold E.
  2. The fee is charged, a beacon lights up, and the quadcopter is on its way: an arrival time of 30–60 s by distance.
  3. The beacon is loud: it wakes camps and draws packs, so the wait is a defence (the ARC Raiders tension).
  4. If you leave the pad, the call is cancelled and half the fee is lost.
- **Pickup:**
  - A large quadcopter comes in low, hovers and lowers a cradle like the convoy crane's.
  - The mech is clamped, lifted, and the screen fades. You arrive in a bay with **everything banked**: scrap, items and
    Protocols.
  - Later this could be a real flight back to the convoy, with the crane taking the mech off the quadcopter.
- **Mech destroyed while waiting:** everything carried is lost, the same rule as today. The fee is gone too.

## 3. How it fits what's built

- **Ways home:** walking home (the crane banks it) stays free. A forced recovery (out of fuel, or holding Q) still
  loses the at-risk loot. A pad is the third way: paid, and it keeps everything.
- **Fuel:** a pad is how a deep run gets home when fuel won't stretch. Low fuel plus a reachable pad you can afford is
  the interesting situation.
- **Heli drops** (Keith, earlier "later"): the same quadcopter flown the other way, dropping you at a far point of
  interest for a fee.
- **Expedition length:** pads let a run go longer than the 10–15 minute aim. Whether the 20 minute cap should hold for
  deep runs is a question below.
- **Progression:**
  - Convoy upgrades could make pads cheaper, or the quadcopter faster.
  - A sensor seeker mode could show pads.
  - A "beacon" item could call a quadcopter anywhere for a premium.

## 4. Starting values (all sliders)

| Value | Default |
| --- | --- |
| `padBase` | 60 scrap |
| `padPerKm` | 80 scrap per km from the convoy |
| Pad grid | 700 m cells; chance 0 / 0.25 / 0.45 / 0.6 by ring |
| Quadcopter arrival | 30 s + 10 s per km, capped at 60 s |
| Beacon noise | wakes camps within 250 m, packs hunt the pad within 500 m |
| Cancel refund | 50% |

These would be tuned so a Deep run carries a few times the fee home, and a Far run more.

## 5. Files

- `src/expedition/depth.ts` (pure): the distance from the road to a point, the ring, and the per-ring scaling that
  points of interest, camps and threats read.
- `src/expedition/pads.ts` (pure): pad placement, fee, call, arrival, the pickup state, cancel and refund.
- `src/expedition/padDraw.ts` (pad, beacon, lights) and `quadcopter.ts` (sim) plus `quadcopterBody.ts` (a stand-in
  until the desktop agent models it; an asset-list item).
- **Wiring:** `loop.ts` and the expedition state get a "Extracted" path that banks everything. The radar shows pads
  and depth rings. The HUD shows the nearest pad, its price and arrival time.
- **Checks** (`expedition-check`, extended):
  - depth is the same for every peer and every clock time;
  - the fee rises with distance;
  - a paid pickup banks everything;
  - cancel refunds half;
  - destruction while waiting loses all;
  - no pads in the Near ring.

## 6. Order

1. Depth rings scaling points of interest, loot and camps (deeper runs feel different).
2. Pads, fee, call, defend, pickup with a fade, banked.
3. The quadcopter model and a real flight home later; heli drops out using the same craft.

## Questions for Keith

1. **What pays the fee:** the scrap you're carrying, or scrap already banked on the convoy? My suggestion: carried scrap
   first, the bank can top it up, and it's shown before you commit.
2. **Calling the quadcopter:** is the wait and defend right, or should it be instant once paid?
3. **Pickup:** fade and arrive (simple, now), or a real flight back to the convoy (later)?
4. **The 20 minute cap:** does it still hold for deep runs, or can a Far run go longer?
5. **Depth from the road:** should it be measured from the road, or from where the convoy is right now? From the road
   is steadier, and multiplayer-safe.

## Answers (Keith 2026-10-27)

- **No fuel.** Drop fuel, and munitions as a resource, for now; bring them back only if needed. "Fuel is the brake" in
  section 1 no longer applies. What keeps you from roaming endlessly is the convoy rolling away, the danger of depth,
  and the energy bar (below).
- **Loot:** almost any item can drop almost anywhere, within reason. Depth and risk raise the drop rates and rarity
  rather than gating them by ring. Further out there are more enemies and a bigger chance of being overwhelmed.
- **The wait grows with distance:** like ARC Raiders, triggering a pad means surviving until the pickup, and the
  further out you are the longer it takes. That wait is part of why it costs more.
- Still open: what pays the fee, fade vs a real flight, the 20 minute cap, depth from the road vs the convoy.
