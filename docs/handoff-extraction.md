# Handoff: extraction pads and convoy unlocks (branch wip/extraction)

Spec: `docs/proposal-extraction.md` (Answers), `docs/proposal-economy.md` ("the convoy grows with scrap").

## Done
- `src/expedition/unlocks.ts` (pure): pickup (250), radar range (3 levels), crane speed (2 levels); `Unlocks` class (buy, load, mul).
- `src/expedition/pads.ts` (pure): `PadField` (seeded grid, by depth ring), `padQuote` (carried first, bank tops up at markup),
  `PadCaller` (hold E, wait, cancel refund, lift, extract). `Expedition.extracted()` / `spendScrap()` added; EndReason "extracted".
- Checks in `tools/expedition-check.ts` (pads and unlocks section at the end).

## Left, in order
1. Loop wiring (`loop.ts`): PadField + PadCaller + Unlocks, beacon effects (noise, `ThreatField.pullNear`, raid), HUD line, radar pads.
2. `padDraw.ts` (pad, lights, mast, stand-in quadcopter).
3. Convoy lab: unlock panel at the bay terminal, save with the bay, apply radar and crane multipliers, `?pad[=m]`, `?unlock=all`.
4. CLAUDE.md flags, state.md, docs/decisions.md.

## Test
`npx tsx tools/expedition-check.ts`. Lab: `labs/convoy/?pad=60&unlock=all`.
