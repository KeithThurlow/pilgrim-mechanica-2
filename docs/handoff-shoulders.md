# Handoff: shoulder gear (branch `wip/shoulders`)

Delete this file when the work merges. Spec: `docs/proposal-shoulders.md` (with Keith's answers).

## Done (all of it)
- Shoulder slots need no arm (`fitProblem` in `src/items/loadout.ts`); a hull gun no longer bounces its shoulder. Feeds and
  power go only on `shoulderL/R`; the pack mount takes launchers only.
- `Base.family` (launcher | feed | power), `SHOULDER_FAMILY`, `RoundType` in `src/items/bases.ts`; bases `sh-beltfeed`,
  `sh-incendiary`, `sh-capacitor`; new stats (`feedRate`, `feedSpin`, `feedAmmo`, `refill`, `boost`, `effectTime`, `burnTime`,
  `burnDps`, `dischargeBars`) roll with rarity like any stat.
- `src/weapons/gear.ts` (pure `GearSim`, `gearStats`); `src/game/burn.ts` (`Burns`); `ShotProtocols.burn` + `ignite` event in
  `src/game/shots.ts`; `Battlefield.burns` + flames; tracer tint (`hot`) in `minigun.ts` / `gpuTracers.ts`.
- `Gun.rateMul/spinCut/ammoMul` (`upper.ts`), `Dash.refillMul/refillNow` (`dash.ts`), `Arsenal.stepGear/rounds` + HUD line.
- Stand-in models (`models.ts`), "Shoulder gear" sliders (`tuning.ts`, weapons topic), picker (`weaponPick.ts`), bay text.
- Default loadout: pod on shoulderL, belt feed on shoulderR; convoy lab kit the same.
- Checks: loadout-check, weapons-check, shots-check updated and extended; full `npm test` passes.

## Left / not done
- Nothing in the spec. Not seen in a browser (gear models, orange tracers, flames).
- Ideas: flames that follow moving targets (Burns keeps the last hit point), a burn event stream for co-op, more round
  types (add to `RoundType`), hull item deciding the shoulder count.

## Values
Belt feed +12% rate, -25% spin-up, Overdrive +60% / 4 s / 20 s. Incendiary +5% rate, +15% rounds, ignited 6 s / 18 s, burn
14/s for 3 s. Capacitor +30% refill, Discharge 1 bar / 25 s. Burn tick 0.25 s, cap 192 targets.

## Test
`npx tsx tools/loadout-check.ts`, `weapons-check.ts`, `shots-check.ts`, then `npm test`. By hand: weapons lab
`?k1=missiles&k2=beltfeed` (hold right mouse, tap 2), `?k2=incendiary`, `?k1=capacitor` (dash first, tap 1).
