# Handoff: loot feel (Keith 2026-10-28)

Branch `wip/loot-feel` (main with depth merged in). All steps of the brief are built, plus Keith's 19:33 additions (item
levels, power and DPS, Diablo-style drop sounds, `?drop=rarity[,level]`). Not yet seen running: this session had no
browser, so it is checked by typecheck and the headless checks only.

## Done
- `expedition.ts`: plain-data `events` (added, banked with the lines and the bank before, lost with the lines).
- `drops.ts` (pure): seeded drops from spots and kills, rarity leaned by danger and heat, level by live depth, pick-up, forget.
- `loot.ts` (glue, made by `loop.ts`): spots -> clumps + drops, robot deaths (chained `onDeath`) -> drops, collectors
  (mech when driven, else the pilot), events -> beams, sounds, the at-risk list; drains `exp.events` into the panel.
- `scrapClumps.ts`, `dropsDraw.ts` (beams, legendary flare), `lootHud.ts` (at risk, banking, loss, pickup card),
  `src/audio/lootSound.ts`.
- Items: `level` (old saves = 1, `bayState.ts`), `src/items/level.ts`, `levelGrowth` slider, `src/items/power.ts`; the bay
  shows level, power and DPS.
- Convoy lab: `?drop=rarity[,level]`, `?drop=all`, `?items=N`; banked items go to the bay stash; hold V on drops.
- Checks: `tools/expedition-check.ts` loot section passes.

## Known / rough
- `npm test`: slope and convoy checks fail on walker numbers (not touched here; likely already failing on main).
- Clumps still in the air when the crane grips keep clinking after the count-in starts.
- Power compares any item kind to 100; only meaningful within a kind.

## Next
Keith plays it; then convoy upgrades and the fabricator (`docs/proposal-economy.md`).

## Test
`npx tsx tools/expedition-check.ts`; convoy lab `?drop=all,10&manual`, `?drop=legendary,20&manual`, `?out&loot=120&items=5`.
