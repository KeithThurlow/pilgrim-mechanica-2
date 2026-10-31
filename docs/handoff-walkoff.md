# Handoff: walk off the convoy (`wip/walkoff`, 2026-10-31)

Keith: no rails on the launch pad, the mech can walk or run off the side; the crane pick-up and launch stay.

## Done
- `src/convoy/outline.ts`: `keepInside(..., open)` skips the long side edges (`isSide`).
- `src/convoy/deck.ts`: sliders `deckOpenSides` (1), `deckEdgeOver` (0.2 m), `deckStepOff` (2 m/s) in a Walk off group
  (Deck topic); `keepOnDeck` leaves the sides open; `offSide()` says when the middle is past a side line;
  `MECH_PUSH_R` (2) shared with the lab and check.
- `src/convoy/carry.ts`: `keep()` calls `walkOff()`: own velocity (deck-relative) + deck velocity, outward at least
  `deckStepOff` and enough to clear tracks + push radius by landing; state `falling` (so the expedition launches as
  after a crane drop), `armed` false, `walkOffs`++, `walkedOff` (no forced follow: player's stick in the air, landing
  timer 0).
- `src/convoy/platformBody.ts`: bay long sides drawn as a low kerb with hazard marks instead of rails.
- `labs/convoy/main.ts`: no platform push-out while falling; sprint (Space hold) allowed aboard with open sides;
  `?walkoff[=dash]` demo.
- `tools/convoy-check.ts`: test 5 runs with the old rails (`deckOpenSides` 0); new 7c (walk, run, dash, sprint each
  side).

## Known rough edges
- Pushing along the back rail into a rear corner cut slides the mech out to the side line and off.
- Sprinting into the cab or back rail on deck just pins the mech there (no wall bounce).
- The deck's turn rate isn't added to the leaving velocity (under ~0.3 m/s on the route's gentle turns).

## Test
`npx tsx tools/convoy-check.ts` (7c lines "walk off ..."); convoy lab `?manual&aboard`, `?aboard&walkoff=dash`.
