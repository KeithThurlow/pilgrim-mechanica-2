# Proposal: the expedition loop: radar, the way home, fuel, loot at risk (not built; waiting for Keith)

Keith 2026-10-25: the core loop.
- You go out, recover things, get back to the convoy, upgrade, and it feels amazing. There's always pressure not to
  venture too far.
- An expedition of value takes about 10–15 minutes, and none should run past 20.
- **Radar:**
  - The mech has a small nearby radar.
  - On the convoy, or in its range, the radar is huge. It shows points of interest and where large swarms are, so you
    plan a direction before launching.
  - Out of range it zooms in and becomes much smaller, and you keep track of things yourself.
  - One arrow points back to the convoy's return point.
- **Fuel:** a fuel-like system on the mech, plus an estimate of the return time.
- **Quitting:** the convoy sends out a helicopter or similar to recover you, but not your loot. Make it clear what's
  at risk: the scrap, the things picked up.
- **Mech destroyed:** for now, everything carried is lost and you're returned to the convoy. Something more
  compelling may come later.
- **Progression:** upgrade the convoy's radar to see further; upgrade the mech to range further, go faster, recover
  better gear and fight larger enemies.

## The loop, as states

`Aboard` → (launch) → `Out` → (picked up by the crane) → `Banked` → `Aboard`

Two ways it can go wrong:
- `Out` → **Call recovery** (a key, held) or quit → `Recovered`: the mech comes home, loot lost.
- `Out` → mech destroyed → `Lost`: everything carried is lost, back on the convoy.

The **at-risk** list is everything picked up since launch: scrap, items and Protocols. It shows on the HUD the whole
time you're out, amber, with a lock icon once it's banked. Being picked up by the crane banks it.

## Radar

- **Two ranges:**
  - **Convoy radar** (big; starts about 1.5 km, upgradeable). Used while aboard or within the convoy's range.
  - **Mech radar** (small; starts about 150 m; upgradeable later with a sensor part).
  - Crossing the convoy's range edge zooms the radar out or in over a second, with a sound, so you feel it.
- **What it shows:**
  - **Convoy radar:**
    - points of interest as icons by tier;
    - swarms as heat blobs: rough size, not exact counts;
    - the convoy's route ahead;
    - your mech.
  - **Mech radar:** only contacts in range (enemies as dots, POIs you're near) and the **arrow home** at the edge.
- **The arrow points to the return point,** not to where the convoy is now. The convoy moves along a route that's
  planned ahead, so the return point is where you'd meet it if you headed back at walking speed. The arrow and the
  estimate both follow that point.
- **Look:** a round scope in a corner, drawn on a small canvas over the game, with a sweep and contacts fading
  between sweeps.

## Return estimate and fuel

- **Return time** = time to reach the return point at walking speed, plus a margin. Shown as "Home 3:40".
- **Fuel** lives in the power pack, measured in minutes of walking. Sprinting, dashing and boosting burn faster, and
  idling burns almost nothing. Shown as "Fuel 9:20".
- **Warning:** when fuel time is no longer comfortably above return time, the HUD goes amber, then red, and the arrow
  pulses.
- **Out of fuel:** limp mode. Half speed, no sprint, dash or boost, guns still work. You can still crawl home if
  you're close. Otherwise call recovery and lose the loot.
- **Expedition length** comes from tuning, not rules: convoy speed, fuel per pack, and the convoy's range edge. I'd
  tune the starting gear so a straight run out and back takes about 12 minutes with a stop or two.

## Progression on the convoy

Scrap buys:
- **convoy radar:** range, then showing POI tiers, then swarm size, then moving contacts;
- **fuel tanks and better packs:** longer range;
- **mech parts**, from the bay;
- later, **convoy speed and route control**.

Each upgrade lets you go further or choose better, which is the point.

## Files

- `src/expedition/`:
  - `expedition.ts` (pure: the state machine, the at-risk list, banking and losing);
  - `returnPoint.ts` (pure: where you'd meet the convoy, from its planned route);
  - `fuel.ts` (pure: the burn rates);
  - `radar.ts` (pure: contacts in range, the zoom, swarm blobs from the robot, bandit and war band lists);
  - `radarDraw.ts` (the scope, on a 2D canvas);
  - `expeditionHud.ts` (home time, fuel, the at-risk list, recovery).
- **Lab:** the convoy lab becomes the expedition lab, or gains the loop:
  - POIs placed by the existing placement around the route;
  - a few enemy groups out in the sand;
  - launch, go out, strip something, come back and bank it, or call recovery and lose it.
- **Check `tools/expedition-check.ts`:**
  - banking only on pick-up;
  - recovery and destruction lose the at-risk list but not fitted gear;
  - the return point is reachable in the estimated time on flat ground;
  - fuel never goes negative;
  - limp mode engages at zero.

## Questions for Keith

1. **Out of fuel:** limp home at half speed (my suggestion), or a hard stop that forces a recovery?
2. **Recovery:** instant (the screen fades, you're back aboard), or a short wait for the helicopter, during which you
   can still be killed? I'd start instant.
3. **Swarms on the convoy radar:** heat blobs without exact numbers, so there's still uncertainty?
