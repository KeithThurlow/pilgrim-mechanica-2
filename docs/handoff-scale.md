# Handoff: the scale build (`wip/scale`)

Keith approved `docs/proposal-scale.md` on 2026-10-26 ("we just have to do it, and then I can see it"). Agent work,
pushed to `wip/scale` after every working step. Read this, then `git log`, when resuming.

## Order (the proposal's)

1. **Effects budget gate** (`src/fx/budget.ts`): merge, thin, trim, local player full. **Built** (step 1).
2. The register: already built by another agent (in main).
3. **Shots as data** (`src/game/shots.ts`): one projectile system, Protocols as fields, hits as events. Not started.
4. **Real Protocol behaviours** on it (split, fire rate, area, ricochet, chain), replacing `labs/stress/worst.ts`'s
   stand-ins. Not started.
5. **GPU particles**, one look at a time (sparks and grit, tracers and casings, then dust), each behind a GPU/CPU
   slider. Not started.

## Step 1: the effects budget (done)

- `src/fx/budget.ts`: `FxBudget.admit(x, z, own)` (thin), `part(rank)` (trim), `frame(alive)` (pressure from last
  frame's dust asks against `fxDustPerFrame` and the live pool against `fxLiveShare`), `hold` (an impact's own dust and
  smoke don't ask again). Sliders `FX_BUDGET_PARAMS`, spread into `MINIGUN_FX_DEFAULTS/PARAMS` so every lab with the
  minigun effects gets them: Performance group (gate) and a new **Effects** group (merge look), added to each lab's
  hits topic (combat labs, walker, convoy).
- `src/fx/dust.ts`: `budget` field; stomp, kick, hit, wheel and smoke ask it; `emit` only counts (blasts, plough and
  warband call it directly and are not thinned). **API unchanged** except `hit(..., k, n = 1)` (optional count
  multiplier for merged hits). No default values touched (the locomotion agent owns those).
- `src/fx/minigun.ts`: `shot(..., own = false)`; tracer arrivals gather by cell and surface (`land`, `flushMerged`);
  `impact(..., n, own, hits)`; far tracers not yours thin; `sparksAt` asks the budget; `onSandHit` gets `n`.
- `src/game/battlefield.ts`: `bf.fx` (the gate), focus from the sun target, `fx.frame()` at the end of update; rounds
  with `voice: "player"` are the local player's own.
- Labs set `bf.fx.own` to the player's mech position (combat lab shell, walker, convoy).
- Check: `tools/fxbudget-check.ts` (in `npm test`).

## Measuring

Scratch scripts (session scratchpad `scale/`): `build.mjs` (esbuild bundle of the labs into `scale/site`),
`stress.mjs "<query>" out.txt` (runs the stress lab to the end of its Run, writes the table), `checks.sh` (every
check). The box is shared: run A/B pairs back to back with `?set=fxBudget:0` vs on, same build.

## Known / rough

- The pilot on foot doesn't count as the local player yet (`fx.own` is the mech).
- Thinned impacts drop their ground mark and their sound too.
