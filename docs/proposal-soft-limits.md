# Soft limits instead of "can't equip" (Keith 2026-11-14)

Keith: "rather than us having like, hey, you can't equip this thing, we just have it so that, oh, you don't really have
enough energy to charge this." Parts get an **optimal range**; going past it is allowed and costs a penalty that grows
the further you go. Everything fits; the bay shows what it costs.

## What there is today (survey)

- **Hard fit rules** (`src/items/loadout.ts` `fitProblem`): slot kinds, hull mounts (what each takes), sensor sockets,
  arms for held weapons, two-handers need two arms, pack and waist mounts. These are *physical* (a hull with no mount
  there) and stay hard.
- **The one weight rule:** hover legs `lifts` 6 t (`liftProblem`): Rampart and Siege hulls can't be fitted on them.
  This is the hard limit that becomes soft.
- **Weight:** every item has a weight (t, `Item.weight` + its Protocols, `itemWeight`), today used only for the hover
  rule, scrap value and the rival kit's hull pick. The default mech carries 17.5 t above its legs; the range is about
  10 t (Cuirass, light guns) to 29 t (Siege hull, two sunder beams, two mortars, replica bay).
- **Energy:** the hull's reactor (`src/mech/reactor.ts`, cap 3-5.5 bars, regen 0.32-0.55/s), energy weapons pay per
  shot from it (`energySim.ts`). The sunder beam already pays all 2.5 bars at the press ("not enough: it won't
  start"), but no weapon needs more than any reactor holds, and the bay says nothing about it. The capacitor bank
  (shoulder) speeds the regen and refills bars on its key; it adds no capacity.

## 1. Leg load (PR 1)

- Legs get **Best load** (`carry`, t: the weight above the legs at which they still reach full speed) and **Strain**
  (`strain`, × how hard the penalty bites). Rampart 20 t, Stilt 16 t, Siege 27 t, Hover 15 t with strain 1.5 (hover
  legs "can't support heavy hulls": now they can, at a crawl).
- **Load** = everything fitted except the legs (hull, arms, weapons, gear, Protocols).
- Over = max(0, load / carry − 1) × strain. Walk and sprint × max(floor, 1 − 0.5 × over); speed-up × (1 − 0.8 × over);
  turn rate × (1 − 0.6 × over); floor 0.4. So 10% over costs 5% speed, 50% over 25%. At or under the best load
  nothing changes (no bonus for running light), so the leg speed retune keeps its numbers for normal builds.
- Applied in `resolve()`, so the player, rivals, field rivals and the duel sim all get it. Sliders: **Leg load** group
  in the Loadout topic. The bay summary and the doll's figures show load against best load and the speed ×.
- The hover `lifts` rule goes; the rival kit picks a hull that leaves about 9 t of the legs' best load for weapons
  (hover legs: the Cuirass and Salvager, as before; Stilt legs: no Siege hull).

## 2. Capacitor-gated firing (PR 2)

- Each energy weapon has a **need**: the bars it commits to one shot (a lance at full charge, a sunder beam at the
  press, a bolt or tick for the rest). The mech's **capacity** is the reactor plus capacitor gear: the capacitor bank
  (shoulder) and capacitor pack add capacity as well as their regen.
- **Commit weapons** (sunder beam): need more than the capacity and it won't fire at all ("underpowered"). **Charged
  weapons** (nova lance): the charge stops at capacity / need, so the shot is weaker. Per-shot weapons are never
  gated (their need is tiny).
- The sunder beam's need goes up to 4.5 bars: over the Rampart's 4 and the Salvager's 3, under the Siege hull's 5.5;
  a capacitor bank brings a Rampart up to it. Bay: the weapon's card and the summary say "needs 4.5 bars, you have 4";
  HUD: the reactor bar shows a need tick and the weapon reads underpowered.
- Aligns with the arc caster's capacitor spool-up (another thread): the same capacity number.

## Open questions for Keith

- Should running under the best load give a small bonus (light builds faster), or only heavy builds slower?
- Should weight also slow the dash, the sprint's top end only, or the torso turn?
- Which other hard rules should go soft next: two-handers on one arm (wild spread), cluster sensors on a head socket
  (half range), more Protocols than sockets?
- The sunder beam at 4.5 bars: right as the first "big hull only" weapon?
- Should a weak reactor also charge heavy weapons slower (a draw rate per hull), not just cap them?
