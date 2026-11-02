# Handoff: energy weapons (Keith 2026-11-02)

Thread agent on `claude/project-thread-7z9btg` (backup `wip/energy`).

## Done (batch 1)
- Energy pool: `Dash.use(n)` (src/mech/dash.ts) spends the energy bars, emptiest first, pausing the refill.
- `src/weapons/energy/`: `energySim.ts` (pure timing and energy per class), `energyGuns.ts` (rays, damage, effects,
  sounds; the arsenal calls `step(i, ...)` for a side holding an energy weapon), `energyDraw.ts` (bolts, beams, charge
  ball; drawn from `ArsenalDraw`), `energySound.ts`, `energyTuning.ts` (sliders, spread into WEAPON_DEFAULTS/PARAMS),
  `energyBases.ts` (items, spread into BASES/STATS).
- Classes: `laser` (pulse), `beam`, `lance`. GunClass in `src/mech/upper.ts`; `isEnergy()` guards the class switches
  (loadout resolve, upper's gun clock, reload HUD, arsenal configure/step).
- `tools/energy-check.ts` in npm test.

## Left, in order (batch 2)
1. `plasma`: projectile bolts (about 42 m/s), swept each step with the same trace, splash on impact (splashBlast), green.
2. `orb`: slow particle orb (about 8 m/s) hovering over the sand, splashBlast every 0.1 s within its radius as it
   travels through enemies, pops at the end of its range.
3. `arc`: lightning: first target the lock, else the nearest enemy near the aim within range (register `near`, filter
   notTeam + Hittable; fall back to candidates when the register is empty), then hops to the nearest not yet hit
   within hop range, damage × keep per hop; damage by a small splashBlast at each; jagged flickering bolts in the draw.
4. Add each to ENERGY_CLASSES, energyStats, energyBases, weaponPick SIDE/HULL_BASE/HELD_BASE, models EnergyKind +
   KIND_MODELS, energy-check cases.

## Known gaps
- Rivals (rivalKit) ignore energy weapons. Protocols don't affect energy weapons. No Light (arm) versions yet.

## Test
- `npx tsx tools/energy-check.ts`; weapons lab `?left=beam&right=lance`, robots lab `?left=laser&right=beam`.
