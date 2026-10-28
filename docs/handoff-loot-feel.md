# Handoff: loot feel (Keith 2026-10-28)

Branch `wip/loot-feel`. Brief: scrap like money (clumps fly to the mech, rolling count, coin jingle), item drops with
beams (walk over to grab), the at-risk list on the HUD, the banking count-in, the visible loss. Added by Keith 19:33:
item levels (deeper = higher), item power and weapon DPS (pickup card with +/- vs fitted, the bay), Diablo-style drop
sounds (legendary the big one), `?drop=rarity[,level]` in the convoy lab (bare `?drop` is still the crane drop).

Depth: `src/expedition/depth.ts` is on `wip/depth` (not main). Loot reads danger and heat through stubs in
`loop.ts` (`lootDanger`, `lootHeat`, `lootDepth`): wire them to `DepthField` / `convoyDepth` / salvage heat on merge.

## Done
- `expedition.ts`: plain-data `events` (added, banked with the lines and the bank before, lost with the lines).
- `drops.ts` (pure): seeded drops from spots and kills, rarity leaned by danger and heat, pick-up and forget.
- Items: `level` (optional; old saves = 1), `src/items/level.ts` (per-stat growth weights), `levelGrowth` slider,
  `src/items/power.ts` (power, DPS, versus fitted).

## Left (in order)
1. Drop levels from depth; loop glue (spots, kills, collectors, events); `dropsDraw.ts` (beams); `lootSound.ts`.
2. HUD: rolling scrap, item lines, pickup card, banking count-in, loss strike-through. Scrap clumps (`scrapClumps.ts`).
3. Bay: level, power, DPS on the item card.
4. Checks in `tools/expedition-check.ts`; state.md; decisions.

## Test
`npx tsx tools/expedition-check.ts`; convoy lab `?out&manual`, `?drop=legendary,12`.
