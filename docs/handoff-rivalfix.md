# Handoff: rivalfix (wip/rivalfix)

Done (all committed): rival aim lag, rail hold, cover/re-acquire, levels (Recruit/Veteran/Ace), `?rivallevel=` and panel buttons, health bar key clash (`hpBar*`), checks in `tools/duel-check.ts`, probe `tools/rival-probe.ts`.

Left: Keith plays it in a browser and tunes (`labs/duel/?rival=3&rivallevel=recruit`). Delete this note when merged.

Values: `RIVAL_LEVELS` in `src/combat/rivalAi.ts`. Missile swarms still can't be dodged (only the dash cut). Test: `npx tsx tools/duel-check.ts`, `npx tsx tools/rival-probe.ts`.
