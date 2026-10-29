# Handoff: extraction pads and convoy unlocks (branch wip/extraction)

Spec: `docs/proposal-extraction.md` (Answers), `docs/proposal-economy.md` ("the convoy grows with scrap"). Delete this note when the work merges.

## Done (all of it)
- `src/expedition/unlocks.ts` (pure), `pads.ts` (pure), `padDraw.ts` (stand-in drawing), `src/ui/convoyShop.ts` (panel).
- Wiring: `loop.ts` (`updatePads`, `padPrompt`, `padHud`), `expedition.ts` (`extracted`, `spendScrap`), `threats.ts` (`pullNear`),
  radar (`pads` blips, price on the mech scope), `expeditionHud.ts` (PAD line), `bayState.ts` (scrap and unlocks in the save), convoy lab.
- Checks: end of `tools/expedition-check.ts`. Docs: CLAUDE.md flags, state.md, docs/decisions.md.

## Rough edges
- Never run in a browser. The mech is not physically lifted: the cradle clamps over it and the fade covers the hand-off.
- Radar/crane multipliers overwrite the slider values in the lab (base kept apart); the panel's Reset may not re-base.
- Pads are drawn on a slab sunk to the lowest sand, no ground flattening.
- Wait/fee numbers are starting values to tune.

## Test
`npx tsx tools/expedition-check.ts`. Lab: `labs/convoy/?pad=60&unlock=all`, or `?pad&bank=300` then B to buy the pickup.
