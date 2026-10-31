# Handoff: rail grace (rival track, then snapshot), 2026-10-31

Done (branch `wip/railgrace`): `src/combat/rivalAi.ts` (fast-weapon aim: `fastWeapon`, `noticed`, `frozen`, `snapped`, autocannon `acPhase`), sliders `aiRail*`, `aiSnapshot`, `aiSnapJitter`, `aiBurstAim`, `aiBurst` (aiRailHold removed), level presets; `Arsenal.railSnapped` + solid white line in `arsenalDraw.ts`, wired in `labs/duel/main.ts`; `duelSim` (`rail` counts, `freeDash`); `tools/rail-grace-probe.ts`; `tools/duel-check.ts` sections. Numbers: state.md Changes.
Left: Keith's play; draw a line for the autocannon burst; other fast weapons if any appear. Delete this note on merge.
Test: `npx tsx tools/duel-check.ts`, `npx tsx tools/rail-grace-probe.ts 0.15`; lab `labs/duel/?rival=3&rivalfit=mountR:rail-medium&rivallevel=recruit`.
